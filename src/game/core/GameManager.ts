import { BALANCE, getCard } from '../data/ConfigLoader';
import { generateOffer } from '../cards/CardDraw';
import { applyCardOnPick, buildPlayerArmy, emptyProgression, pickStreaks } from '../cards/CardEffect';
import { generateEnemyPlan } from '../enemy/EnemyGenerator';
import { hashSeed, Rng } from './rng';
import type { BattleOutcome, BattleSetup, GameMode, RunState } from './types';

export const SAVE_VERSION = 2;

/** RoundManager / PhaseManager / VictoryManager 的纯函数实现，状态全部保存在 RunState 中，便于存档与恢复 */
export function createRun(opts: { mode: GameMode; difficulty: string; seed: number; dailyModifier?: string | null }): RunState {
  const daily = opts.dailyModifier ? BALANCE.dailyModifiers.find((d) => d.id === opts.dailyModifier) : null;
  const hp = daily?.startHp ?? BALANCE.startHp;
  return {
    version: SAVE_VERSION,
    id: `${Date.now().toString(36)}-${opts.seed.toString(36)}`,
    mode: opts.mode,
    difficulty: opts.difficulty,
    runSeed: opts.seed,
    rngState: hashSeed(opts.seed, 'draw'),
    round: 0,
    maxHp: hp,
    playerHp: hp,
    enemyHp: opts.mode === 'endless' ? 999 : hp,
    phase: 'DRAW',
    drawCount: 0,
    offer: [],
    luckyOffer: false,
    selectedCards: [],
    history: [],
    permanentBuffs: [],
    progression: emptyProgression(),
    rerolls: BALANCE.startRerolls + (daily?.rerolls ?? 0),
    enemyPlan: null,
    lastOutcome: null,
    rounds: [],
    dailyModifier: opts.dailyModifier ?? null,
    totalKills: 0,
    totalDamage: 0,
    startedAt: Date.now(),
    result: null,
    lastPickStreak: null,
  };
}

function withRng<T>(run: RunState, fn: (rng: Rng) => T): T {
  const rng = new Rng(run.rngState);
  const out = fn(rng);
  run.rngState = rng.state;
  return out;
}

/** 回合开始：刷新状态、生成敌军预告、发出第一组候选卡 */
export function startRound(run: RunState) {
  run.round += 1;
  run.phase = 'DRAW';
  run.drawCount = 0;
  run.selectedCards = [];
  run.lastOutcome = null;
  run.lastPickStreak = null;
  run.rerolls += BALANCE.rerollsPerRound;
  withRng(run, (rng) => {
    run.enemyPlan = generateEnemyPlan(run, rng);
    const { offer, lucky } = generateOffer(run, rng);
    run.offer = offer;
    run.luckyOffer = lucky;
  });
}

/** 修复回合开始中途失败的存档（回合数已增加但没有候选卡）：回退回合数并重新开始该回合 */
export function repairRun(run: RunState): boolean {
  if (run.phase !== 'DRAW' || run.offer.length > 0) return false;
  run.round = Math.max(0, run.round - 1);
  startRound(run);
  return true;
}

export function rerollOffer(run: RunState): boolean {
  if (run.phase !== 'DRAW' || run.rerolls <= 0) return false;
  run.rerolls -= 1;
  withRng(run, (rng) => {
    const { offer, lucky } = generateOffer(run, rng);
    run.offer = offer;
    run.luckyOffer = lucky;
  });
  return true;
}

/** 选择一张卡：记录到本回合阵容并立即应用永久效果，随后进入下一次抽卡或准备阶段 */
export function pickCard(run: RunState, cardId: string): { notes: string[]; streak: { tag: string; count: number } | null } {
  if (run.phase !== 'DRAW' || !run.offer.includes(cardId)) return { notes: [], streak: null };
  const times = run.luckyOffer ? 2 : 1;
  const notes: string[] = [];
  for (let i = 0; i < times; i++) {
    run.selectedCards.push(cardId);
    run.history.push(cardId);
    notes.push(...applyCardOnPick(run, cardId));
  }
  if (run.luckyOffer) notes.push('幸运三连：效果翻倍！');
  run.drawCount += 1;
  const streaks = pickStreaks(run.selectedCards);
  const lastCard = getCard(cardId);
  const streak = streaks.find((s) => lastCard.unit && s.count >= 2) ?? null;
  run.lastPickStreak = streak;
  if (run.drawCount >= BALANCE.drawsPerRound) {
    run.phase = 'PREPARE';
    run.offer = [];
    run.luckyOffer = false;
  } else {
    withRng(run, (rng) => {
      const { offer, lucky } = generateOffer(run, rng);
      run.offer = offer;
      run.luckyOffer = lucky;
    });
  }
  return { notes, streak };
}

export function battleSeed(run: RunState): number {
  return hashSeed(run.runSeed, 'battle', run.round);
}

export function buildBattleSetup(run: RunState, unitCap: number): BattleSetup {
  return {
    seed: battleSeed(run),
    round: run.round,
    player: buildPlayerArmy(run),
    enemy: run.enemyPlan!.army,
    unitCap,
  };
}

/** 结算：败方扣 1 格生命（Boss 回合扣 2 格），平局双方各扣 1 格 */
export function resolveRound(run: RunState, setup: BattleSetup, outcome: BattleOutcome): { playerLoss: number; enemyLoss: number } {
  let playerLoss = 0;
  let enemyLoss = 0;
  const bossBonus = run.enemyPlan?.isBoss ? BALANCE.enemy.bossHpLoss : 1;
  if (outcome.winner === 0) enemyLoss = bossBonus;
  else if (outcome.winner === 1) playerLoss = 1;
  else {
    playerLoss = 1;
    enemyLoss = 1;
  }
  run.playerHp = Math.max(0, run.playerHp - playerLoss);
  if (run.mode !== 'endless') run.enemyHp = Math.max(0, run.enemyHp - enemyLoss);
  run.lastOutcome = outcome;
  run.totalKills += outcome.kills[0];
  run.totalDamage += outcome.stats.filter((s) => s.team === 0).reduce((s, x) => s + x.damage, 0);
  run.rounds.push({
    round: run.round,
    winner: outcome.winner,
    seed: setup.seed,
    setup,
    topUnit: outcome.topUnit?.name ?? null,
    playerCards: [...run.selectedCards],
    enemyTactic: run.enemyPlan?.tacticName ?? '',
  });
  // 只保留最近 30 回合的录像，控制存档体积
  if (run.rounds.length > 30) run.rounds.splice(0, run.rounds.length - 30);
  const playerDead = run.playerHp <= 0;
  const enemyDead = run.enemyHp <= 0;
  if (playerDead || enemyDead) {
    run.phase = 'GAME_OVER';
    run.result = playerDead && enemyDead ? 'draw' : playerDead ? 'lose' : 'win';
    if (run.mode === 'endless' && playerDead) run.result = 'lose';
  } else {
    run.phase = 'RESULT';
  }
  return { playerLoss, enemyLoss };
}

export function roundsWon(run: RunState): number {
  return run.rounds.filter((r) => r.winner === 0).length;
}

export function themeFor(round: number): string {
  const themes = BALANCE.themes;
  let id = themes[0].id;
  // 26 回合后主题循环
  const r = round > 25 ? ((round - 1) % 25) + 1 : round;
  for (const t of themes) if (r >= t.fromRound) id = t.id;
  return id;
}

/** 对局码：用于分享相同种子的对局 */
export function encodeRunCode(mode: GameMode, difficulty: string, seed: number, daily: string | null): string {
  return btoa(JSON.stringify({ m: mode, d: difficulty, s: seed, x: daily })).replace(/=+$/, '');
}

export function decodeRunCode(code: string): { mode: GameMode; difficulty: string; seed: number; daily: string | null } | null {
  try {
    const pad = code.trim() + '==='.slice((code.trim().length + 3) % 4);
    const o = JSON.parse(atob(pad));
    if (typeof o.s !== 'number') return null;
    return { mode: o.m ?? 'standard', difficulty: o.d ?? 'normal', seed: o.s >>> 0, daily: o.x ?? null };
  } catch {
    return null;
  }
}

export function dailySeed(date = new Date()): { seed: number; key: string; modifier: string } {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const seed = hashSeed('daily', key);
  const mods = BALANCE.dailyModifiers;
  return { seed, key, modifier: mods[seed % mods.length].id };
}
