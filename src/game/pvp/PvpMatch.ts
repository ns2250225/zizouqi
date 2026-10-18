import { reactive } from 'vue';
import { BALANCE } from '../data/ConfigLoader';
import { createRun, pickCard } from '../core/GameManager';
import { generateOffer } from '../cards/CardDraw';
import { buildPlayerArmy } from '../cards/CardEffect';
import { hashSeed, Rng, randomSeed } from '../core/rng';
import type { ArmySpec, RunState } from '../core/types';

/**
 * PvP 本地对局状态。
 *
 * 服务器为双方分别下发独立的 draftSeed：候选卡由自己的种子 + 自己的对局状态（回合数、
 * 历史、永久成长）确定性生成，双方候选互不相同，且稀有度成长、前置条件卡等与单机一致；
 * 重抽次数只影响自己的候选（rerollCount 递增派生，断线重连后可精确恢复当前候选）。
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

  /** 由自己的 draftSeed 派生当前抽卡候选；rerollCount 只影响自己的候选 */
  refreshOffer() {
    const rng = new Rng(hashSeed(this.draftSeed, 'pvpdraw', this.rerollCount));
    const { offer, lucky } = generateOffer(this.run, rng);
    this.run.offer = offer;
    this.run.luckyOffer = lucky;
  }

  pick(cardId: string): { notes: string[]; streak: { tag: string; count: number } | null } {
    const res = pickCard(this.run, cardId);
    // pickCard 内部用 run.rngState 生成了下一个候选，PvP 中用自己的 draftSeed 派生覆盖
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

export function emptyArmySpec(): ArmySpec {
  return { units: [], mods: [], flags: {}, spells: [], synergies: [], combos: [], statMult: 1, boss: null };
}
