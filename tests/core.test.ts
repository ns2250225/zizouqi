import { describe, expect, it } from 'vitest';
import { BattleSim } from '../src/game/battle/BattleSim';
import { buildBattleSetup, createRun, pickCard, startRound } from '../src/game/core/GameManager';
import { CARDS, UNITS } from '../src/game/data/ConfigLoader';

describe('配置', () => {
  it('至少 60 种兵种、100 张卡牌', () => {
    expect(UNITS.filter((u) => !u.summon).length).toBeGreaterThanOrEqual(60);
    expect(CARDS.length).toBeGreaterThanOrEqual(100);
  });
});

describe('回合循环', () => {
  it('每回合 3 次抽卡、每次 3 选 1，随后进入准备阶段', () => {
    const run = createRun({ mode: 'standard', difficulty: 'normal', seed: 42 });
    startRound(run);
    for (let i = 0; i < 3; i++) {
      expect(run.phase).toBe('DRAW');
      expect(run.offer.length).toBe(3);
      pickCard(run, run.offer[0]);
    }
    expect(run.phase).toBe('PREPARE');
  });

  it('同一种子的战斗结果可复现', () => {
    const run = createRun({ mode: 'standard', difficulty: 'normal', seed: 7 });
    startRound(run);
    for (let i = 0; i < 3; i++) pickCard(run, run.offer[0]);
    const setup = buildBattleSetup(run, 120);
    const a = new BattleSim(setup).runToEnd();
    const b = new BattleSim(JSON.parse(JSON.stringify(setup))).runToEnd();
    expect(a.winner).toBe(b.winner);
    expect(a.time).toBeCloseTo(b.time);
  });
});
