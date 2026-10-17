import { BALANCE, getUnit, RARITY_POWER, UNITS, type RoundBracket, type Tactic } from '../data/ConfigLoader';
import type { ArmySpec, EnemyPlan, FlagEffect, ModEffect, Rarity, RunState, UnitConfig } from '../core/types';
import { RARITIES } from '../core/types';
import type { Rng } from '../core/rng';
import { computeCombos, computeSynergies, synergyEffects } from '../synergies/SynergyManager';
import { resolveStats } from '../units/UnitStats';

const E = BALANCE.enemy;

export function bracketFor(round: number): RoundBracket {
  return BALANCE.roundBrackets.find((b) => round >= b.from && round <= b.to) ?? BALANCE.roundBrackets[BALANCE.roundBrackets.length - 1];
}

export function difficultyMult(id: string): number {
  return BALANCE.difficulties.find((d) => d.id === id)?.mult ?? 1;
}

/** 敌方战力预算：随回合增长，并受难度与每日挑战影响 */
export function enemyBudget(run: RunState): number {
  const r = run.round - 1;
  const daily = run.dailyModifier ? BALANCE.dailyModifiers.find((d) => d.id === run.dailyModifier) : null;
  const carry = BALANCE.armyCarryOver ? E.budgetCarryOver * r : 0;
  return (E.baseBudget + E.budgetPerRound * r + E.budgetQuadratic * r * r + carry) * difficultyMult(run.difficulty) * (daily?.enemyMult ?? 1);
}

const rank = (r: Rarity) => RARITIES.indexOf(r);

/** 混合军团：根据玩家上一回合阵容做出针对性调整 */
function counterPool(run: RunState): string[] {
  const last = run.rounds[run.rounds.length - 1];
  if (!last) return ['militia', 'archer', 'swordsman', 'spearman', 'crossbowman', 'barbarian'];
  let ranged = 0;
  let melee = 0;
  let mage = 0;
  let flying = 0;
  for (const u of last.setup.player.units) {
    const cfg = getUnit(u.unit);
    if (cfg.unitClass === 'mage') mage += u.count;
    else if (cfg.projectile) ranged += u.count;
    else melee += u.count;
    if (cfg.flying) flying += u.count;
  }
  const pool: string[] = [];
  if (ranged >= melee) pool.push('assassin', 'heavy_knight', 'mech_spider', 'bomb_bot', 'samurai', 'death_knight');
  if (melee > ranged) pool.push('fire_mage', 'artillery', 'cannon', 'plague_witch', 'spearman', 'barbarian', 'giant');
  if (mage > 2) pool.push('assassin', 'sniper', 'longbowman');
  if (flying > 0) pool.push('archer', 'longbowman', 'sniper', 'elf_marksman');
  pool.push('swordsman', 'shieldbearer', 'archer');
  return pool;
}

function pickTactic(run: RunState, rng: Rng, bracket: RoundBracket): Tactic {
  const id = rng.pick(bracket.tactics);
  return BALANCE.tactics.find((t) => t.id === id) ?? BALANCE.tactics.find((t) => t.id === 'mixed')!;
}

/**
 * 军队强度（兰彻斯特平方律）：总生命 × 总秒伤。属性倍率 s 同时作用于生命与攻击，强度按 s² 变化。
 * statMult 取 1 时的强度，已计入强化修正、开局护盾与 Boss 加成。
 */
export function armyStrength(army: ArmySpec): number {
  let hp = 0;
  let dps = 0;
  const shield = 1 + (army.flags.startShield ?? 0);
  const add = (id: string, count: number, hpMult: number, atkMult: number) => {
    const cfg = getUnit(id);
    if (cfg.nonCombatant) return;
    const st = resolveStats(cfg, army.mods, 1);
    hp += (st.maxHp * hpMult * shield * count) / st.damageTaken;
    dps += st.attack * atkMult * st.attackSpeed * (1 + st.critChance * (st.critDamage - 1)) * count;
  };
  for (const u of army.units) add(u.unit, u.count, 1, 1);
  if (army.boss) add(army.boss, 1, E.bossStatMult, 1 + (E.bossStatMult - 1) * 0.4);
  return hp * dps;
}

export function generateEnemyPlan(run: RunState, rng: Rng): EnemyPlan {
  const bracket = bracketFor(run.round);
  const tactic = pickTactic(run, rng, bracket);
  let poolIds = tactic.id === 'mixed' ? counterPool(run) : [...tactic.pool];
  let tacticName = tactic.name;
  if (bracket.multiTactic) {
    const second = pickTactic(run, rng, bracket);
    if (second.id !== tactic.id) {
      poolIds = [...poolIds, ...(second.id === 'mixed' ? counterPool(run) : second.pool)];
      tacticName = `${tactic.name} + ${second.name}`;
    }
  }
  let cap = rank(bracket.rarityCap);
  if (tactic.rarityCap) cap = Math.min(cap, rank(tactic.rarityCap));
  // 传奇单位在 21 回合前仅以极低概率出现
  let pool: UnitConfig[] = [...new Set(poolIds)].map(getUnit).filter((u) => rank(u.rarity) <= cap);
  if (!pool.length) pool = UNITS.filter((u) => !u.summon && rank(u.rarity) <= Math.max(cap, 0));
  if (tactic.id === 'legend' && run.round < 21) pool = pool.filter((u) => u.rarity !== 'MYTHIC');

  // 羁绊阵容：优先挑选同阵营/同职业的兵种
  if (bracket.synergy && pool.length > 3) {
    const tagCounts = new Map<string, UnitConfig[]>();
    for (const u of pool) for (const t of [u.faction, u.unitClass]) tagCounts.set(t, [...(tagCounts.get(t) ?? []), u]);
    const groups = [...tagCounts.values()].filter((g) => g.length >= 3);
    if (groups.length) {
      const g = rng.pick(groups);
      pool = [...g, ...g, ...pool];
    }
  }

  let budget = enemyBudget(run) * (bracket.budgetMult ?? 1);
  const counts = new Map<string, number>();
  let guard = 0;
  while (budget > 4 && guard++ < 400) {
    const cands = pool.filter((u) => RARITY_POWER[u.rarity] <= budget + 6);
    if (!cands.length) break;
    const u = rng.pick(cands);
    const count = Math.max(1, u.cardCount);
    counts.set(u.id, (counts.get(u.id) ?? 0) + count);
    budget -= RARITY_POWER[u.rarity];
  }
  if (!counts.size) counts.set('militia', 5);

  const isBoss = run.round % E.bossInterval === 0;
  let boss: string | null = null;
  if (isBoss) {
    const list = BALANCE.bosses;
    boss = list[Math.min(list.length - 1, Math.floor(run.round / E.bossInterval) - 1)] ?? list[0];
  }

  const units = [...counts.entries()].map(([unit, count]) => ({ unit, count }));
  const synergies = computeSynergies(units.map((u) => u.unit));
  const combos = computeCombos(units, []).map((c) => c.id);
  const syn = synergyEffects(synergies, combos);

  const mods: ModEffect[] = [...syn.mods];
  const flags: Record<string, number> = { ...syn.flags };
  const buffNames: string[] = [];
  const buffPool = [...BALANCE.enemyBuffPool];
  rng.shuffle(buffPool);
  const buffCount = bracket.buffs + Math.floor(Math.max(0, run.round - 26) / 4);
  for (let i = 0; i < buffCount; i++) {
    const b = buffPool[i % buffPool.length];
    buffNames.push(b.name);
    const e = b.effect as ModEffect | FlagEffect;
    if (e.kind === 'MOD') mods.push(e);
    else flags[e.flag] = (flags[e.flag] ?? 0) + e.value;
  }
  const daily = run.dailyModifier ? BALANCE.dailyModifiers.find((d) => d.id === run.dailyModifier) : null;
  for (const e of (daily?.enemy ?? []) as (ModEffect | FlagEffect)[]) {
    if (e.kind === 'MOD') mods.push(e);
    else flags[e.flag] = (flags[e.flag] ?? 0) + e.value;
  }

  const diff = difficultyMult(run.difficulty);
  let statMult = (1 + E.statGrowthPerRound * (run.round - 1)) * (1 + (diff - 1) * 0.5);
  if (run.mode === 'standard') {
    // 标准模式额外强化：整体属性倍率 + 逐回合递增
    statMult *= E.standardStatMult * (1 + E.standardGrowthPerRound * (run.round - 1));
  }
  const army: ArmySpec = { units, mods, flags, spells: [], synergies, combos, statMult, boss };
  let strengthScale: number | undefined;
  if (run.mode === 'endless') {
    // 无尽模式：每回合敌军强度精确为上一回合的 endlessGrowth 倍
    const raw = Math.max(1, armyStrength(army));
    if (run.round <= 1 || !run.endlessBase) run.endlessBase = raw * statMult * statMult;
    strengthScale = Math.pow(E.endlessGrowth, run.round - 1);
    statMult = Math.sqrt((run.endlessBase * strengthScale) / raw);
    army.statMult = statMult;
  }
  const preview = [...units]
    .sort((a, b) => RARITY_POWER[getUnit(b.unit).rarity] * b.count - RARITY_POWER[getUnit(a.unit).rarity] * a.count)
    .slice(0, 5);
  if (boss) preview.unshift({ unit: boss, count: 1 });
  return {
    tacticId: tactic.id,
    tacticName,
    tacticIcon: tactic.icon,
    tacticDesc: tactic.id === 'mixed' ? '针对你上一回合的阵容调整' : tactic.desc,
    bracketName: bracket.name,
    army,
    preview,
    isBoss,
    buffNames,
    strengthScale,
  };
}
