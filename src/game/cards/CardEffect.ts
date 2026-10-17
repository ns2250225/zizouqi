import { BALANCE, getCard, getUnit } from '../data/ConfigLoader';
import type {
  ArmySpec, FlagEffect, ModEffect, Progression, RunState,
} from '../core/types';
import { computeCombos, computeSynergies, synergyEffects } from '../synergies/SynergyManager';

export function emptyProgression(): Progression {
  return { mods: [], flags: {}, spawns: [], rarityMult: {}, countBonus: [], upgrades: [] };
}

/** 选卡时立即生效的部分：永久成长、重抽次数等 */
export function applyCardOnPick(run: RunState, cardId: string): string[] {
  const card = getCard(cardId);
  const notes: string[] = [];
  const prog = run.progression;
  let permanent = false;
  for (const e of card.effects) {
    switch (e.kind) {
      case 'MOD':
        if (e.permanent) {
          prog.mods.push({ ...e });
          permanent = true;
        }
        break;
      case 'FLAG':
        if (e.permanent) {
          prog.flags[e.flag] = (prog.flags[e.flag] ?? 0) + e.value;
          permanent = true;
        }
        break;
      case 'PERM_SPAWN': {
        const ex = prog.spawns.find((s) => s.unit === e.unit);
        if (ex) ex.count += e.count;
        else prog.spawns.push({ unit: e.unit, count: e.count });
        permanent = true;
        break;
      }
      case 'REROLL':
        run.rerolls += e.value;
        notes.push(`获得 ${e.value} 次重抽`);
        break;
      case 'RARITY':
        for (const r of e.rarities) prog.rarityMult[r] = (prog.rarityMult[r] ?? 0) + e.value;
        permanent = true;
        break;
      case 'COUNT_BONUS':
        prog.countBonus.push({ value: e.value, minCount: e.minCount });
        permanent = true;
        break;
      case 'UPGRADE_TOP': {
        const counts = new Map<string, number>();
        for (const id of run.history) if (id.startsWith('u_')) counts.set(id, (counts.get(id) ?? 0) + 1);
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        if (top) {
          const unit = top[0].slice(2);
          prog.mods.push({ kind: 'MOD', target: `unit:${unit}`, stat: 'hp', value: e.value, permanent: true });
          prog.mods.push({ kind: 'MOD', target: `unit:${unit}`, stat: 'attack', value: e.value, permanent: true });
          prog.upgrades.push({ unit, value: e.value });
          notes.push(`${getUnit(unit).name} 永久强化 +${Math.round(e.value * 100)}%`);
        }
        permanent = true;
        break;
      }
      default:
        break;
    }
  }
  if (permanent) run.permanentBuffs.push(cardId);
  return notes;
}

/** 兵种卡的实际召唤数量（受精锐训练、双倍民兵影响） */
export function spawnCount(run: RunState, unit: string, base: number): number {
  let n = base;
  for (const b of run.progression.countBonus) if (base >= b.minCount) n += b.value;
  if (unit === 'militia' && (run.progression.flags.militiaDouble ?? 0) > 0) n *= 2;
  return n;
}

/** 同类兵种连续选择奖励：返回本回合每个职业的连选次数 */
export function pickStreaks(cards: string[]): { tag: string; count: number }[] {
  const out: { tag: string; count: number }[] = [];
  let last: string | null = null;
  let n = 0;
  for (const id of cards) {
    const c = getCard(id);
    const tag = c.unit ? getUnit(c.unit).unitClass : null;
    if (tag && tag === last) n++;
    else {
      if (last && n >= 2) out.push({ tag: last, count: n });
      last = tag;
      n = tag ? 1 : 0;
    }
  }
  if (last && n >= 2) out.push({ tag: last, count: n });
  return out;
}

/** 之前回合已选择的兵种卡（history 末尾是本回合的选择） */
export function veteranCards(run: RunState): string[] {
  return run.history.slice(0, run.history.length - run.selectedCards.length).filter((id) => id.startsWith('u_'));
}

/** 全军编制：继承兵种 + 本回合新增 */
export function armyRoster(run: RunState): { unit: string; count: number; fresh: number }[] {
  const army = buildPlayerArmy(run);
  const fresh = new Map<string, number>();
  for (const id of run.selectedCards) {
    for (const e of getCard(id).effects) if (e.kind === 'SPAWN') fresh.set(e.unit, (fresh.get(e.unit) ?? 0) + spawnCount(run, e.unit, e.count));
  }
  return army.units.map((u) => ({ ...u, fresh: fresh.get(u.unit) ?? 0 })).sort((a, b) => b.count - a.count);
}

/** 汇总本回合的玩家军队（兵种、修正、羁绊、组合、开局法术） */
export function buildPlayerArmy(run: RunState, cards: string[] = run.selectedCards, luckyIndex = -1): ArmySpec {
  const unitCounts = new Map<string, number>();
  const add = (unit: string, count: number) => unitCounts.set(unit, (unitCounts.get(unit) ?? 0) + count);
  for (const s of run.progression.spawns) add(s.unit, s.count);
  // 部队继承：之前回合选择的兵种卡全部保留进入本回合
  if (BALANCE.armyCarryOver) {
    for (const id of veteranCards(run)) {
      for (const e of getCard(id).effects) if (e.kind === 'SPAWN') add(e.unit, spawnCount(run, e.unit, e.count));
    }
  }
  const roundMods: ModEffect[] = [];
  const roundFlags: Record<string, number> = {};
  const spells: { spell: string; value: number }[] = [];
  cards.forEach((id, i) => {
    const card = getCard(id);
    const times = i === luckyIndex ? 2 : 1;
    for (let k = 0; k < times; k++) {
      for (const e of card.effects) {
        if (e.kind === 'SPAWN') add(e.unit, spawnCount(run, e.unit, e.count));
        else if (e.kind === 'MOD' && !e.permanent) roundMods.push(e);
        else if (e.kind === 'FLAG' && !e.permanent) roundFlags[e.flag] = (roundFlags[e.flag] ?? 0) + e.value;
        else if (e.kind === 'SPELL') spells.push({ spell: e.spell, value: e.value });
      }
    }
  });
  const units = [...unitCounts.entries()].map(([unit, count]) => ({ unit, count }));
  const unitIds = units.map((u) => u.unit);
  const synergies = computeSynergies(unitIds);
  const combos = computeCombos(units, [...run.history, ...cards]).map((c) => c.id);
  const syn = synergyEffects(synergies, combos);

  const streakBonus = BALANCE.comboStreakBonus as number[];
  const streakMods: ModEffect[] = pickStreaks(cards).map((s) => ({
    kind: 'MOD', target: `tag:${s.tag}`, stat: 'attack', value: streakBonus[Math.min(streakBonus.length - 1, s.count - 1)],
  }));

  const daily = run.dailyModifier ? BALANCE.dailyModifiers.find((d) => d.id === run.dailyModifier) : null;
  const dailyMods = (daily?.player ?? []).filter((e: ModEffect | FlagEffect) => e.kind === 'MOD') as ModEffect[];
  const flags: Record<string, number> = { ...run.progression.flags };
  const mergeFlags = (src: Record<string, number>) => {
    for (const [k, v] of Object.entries(src)) flags[k] = (flags[k] ?? 0) + v;
  };
  mergeFlags(roundFlags);
  mergeFlags(syn.flags);
  for (const e of (daily?.player ?? []) as FlagEffect[]) if (e.kind === 'FLAG') flags[e.flag] = (flags[e.flag] ?? 0) + e.value;

  return {
    units,
    mods: [...run.progression.mods, ...roundMods, ...syn.mods, ...streakMods, ...dailyMods],
    flags,
    spells,
    synergies,
    combos,
    statMult: 1,
    boss: null,
  };
}

/** 军队战力估算（用于 HUD 战力统计） */
export function armyPower(spec: ArmySpec): number {
  let p = 0;
  for (const u of spec.units) {
    const cfg = getUnit(u.unit);
    p += (cfg.hp * 0.15 + cfg.attack * cfg.attackSpeed * 2.2) * u.count;
  }
  const atk = spec.mods.filter((m) => m.target === 'all' && (m.stat === 'attack' || m.stat === 'hp')).reduce((s, m) => s + m.value, 0);
  return Math.round(p * (1 + atk * 0.5) * spec.statMult * (1 + spec.synergies.filter((s) => s.active).length * 0.05));
}
