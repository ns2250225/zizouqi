import { reactive } from 'vue';
import { BALANCE } from '../data/ConfigLoader';
import { createRun, pickCard } from '../core/GameManager';
import { generateOffer } from '../cards/CardDraw';
import { buildPlayerArmy, emptyProgression } from '../cards/CardEffect';
import { hashSeed, Rng, randomSeed } from '../core/rng';
import type { ArmySpec, RunState } from '../core/types';

/**
 * PvP 本地对局状态。
 *
 * 抽卡候选由服务器下发的 draftSeed 确定性生成（基于中立的虚拟 RunState，不含任何玩家私有
 * 成长），保证双方看到的候选完全一致；选卡后的军队构建、羁绊、连选奖励等仍基于各自的
 * RunState 独立累积。
 */
export class PvpMatch {
  /** reactive 包装使视图能跟踪类内部的直接属性修改 */
  readonly run: RunState;
  draftSeed = 0;
  rerollCount = 0;

  constructor() {
    this.run = reactive(createRun({ mode: 'standard', difficulty: 'pvp', seed: randomSeed() }));
    this.run.rerolls = this.rerollsPerRound();
  }

  rerollsPerRound(): number {
    return BALANCE.startRerolls + BALANCE.rerollsPerRound;
  }

  startRound(round: number, draftSeed: number) {
    this.draftSeed = draftSeed;
    this.rerollCount = 0;
    const run = this.run;
    run.round = round;
    run.phase = 'DRAW';
    run.drawCount = 0;
    run.selectedCards = [];
    run.lastOutcome = null;
    run.lastPickStreak = null;
    run.offer = [];
    run.luckyOffer = false;
    run.rerolls = this.rerollsPerRound();
    this.refreshOffer();
  }

  /** 由 draftSeed 派生当前抽卡候选（双方一致）；rerollCount 只影响自己的候选 */
  refreshOffer() {
    const rng = new Rng(hashSeed(this.draftSeed, 'pvpdraw', this.rerollCount));
    const { offer, lucky } = generateOffer(neutralRun(this.run.round), rng);
    this.run.offer = offer;
    this.run.luckyOffer = lucky;
  }

  pick(cardId: string): { notes: string[]; streak: { tag: string; count: number } | null } {
    const res = pickCard(this.run, cardId);
    // pickCard 内部用 run.rngState 生成了下一个候选，PvP 中用共享 draftSeed 覆盖
    if (this.run.phase === 'DRAW') this.refreshOffer();
    return res;
  }

  reroll(): boolean {
    if (this.run.rerolls <= 0 || this.run.phase !== 'DRAW') return false;
    this.run.rerolls -= 1;
    this.rerollCount += 1;
    this.refreshOffer();
    return true;
  }

  /** 随机选一张（抽卡超时自动选卡用，仅影响自己的军队） */
  autoPick(): string | null {
    if (this.run.phase !== 'DRAW' || !this.run.offer.length) return null;
    const id = this.run.offer[Math.floor(Math.random() * this.run.offer.length)];
    this.pick(id);
    return id;
  }

  buildArmy(): ArmySpec {
    return buildPlayerArmy(this.run);
  }
}

/** 抽卡池所用的中立状态：仅回合数有效，历史/成长/每日修正为空（前置条件卡在 PvP 中自然禁用） */
export function neutralRun(round: number): RunState {
  const r = createRun({ mode: 'standard', difficulty: 'pvp', seed: 0 });
  r.round = round;
  r.history = [];
  r.progression = emptyProgression();
  r.dailyModifier = null;
  return r;
}

export function emptyArmySpec(): ArmySpec {
  return { units: [], mods: [], flags: {}, spells: [], synergies: [], combos: [], statMult: 1, boss: null };
}
