import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattleSim } from '../src/game/battle/BattleSim';
import { hashSeed } from '../src/game/core/rng';
import type { ArmySpec } from '../src/game/core/types';
import { PvpMatch } from '../src/game/pvp/PvpMatch';
import { getCard } from '../src/game/data/ConfigLoader';
import { Room, START_HP } from '../server/rooms.mjs';

function armyOf(entries: { unit: string; count: number }[]): ArmySpec {
  return { units: entries, mods: [], flags: {}, spells: [], synergies: [], combos: [], statMult: 1, boss: null };
}

describe('PvP 抽卡同步', () => {
  it('同一玩家相同 draftSeed 可复现相同候选（含幸运三连判定）', () => {
    for (const round of [1, 3, 12]) {
      for (const seed of [1, 987654321, 42]) {
        const a = new PvpMatch();
        a.startRound(round, seed);
        const b = new PvpMatch();
        b.startRound(round, seed);
        expect(b.run.offer).toEqual(a.run.offer);
        expect(a.run.offer.length).toBe(3);
      }
    }
  });

  it('双方使用各自的 draftSeed，候选互不相同', () => {
    const a = new PvpMatch();
    a.startRound(1, 111111111);
    const b = new PvpMatch();
    b.startRound(1, 222222222);
    expect(a.run.offer).not.toEqual(b.run.offer);
  });

  it('个人成长影响候选池：稀有度提升后能抽到高稀有度卡', () => {
    const m = new PvpMatch();
    m.startRound(8, 555);
    m.run.progression.rarityMult.MYTHIC = 1000;
    m.refreshOffer();
    expect(m.run.offer.some((id) => getCard(id).rarity === 'MYTHIC')).toBe(true);
  });

  it('重抽只影响自己的候选，且同参数可复现', () => {
    const seed = hashSeed('room', 'draft');
    const host = new PvpMatch();
    host.startRound(1, seed);
    const guest = new PvpMatch();
    guest.startRound(1, seed);
    expect(host.run.offer).toEqual(guest.run.offer); // 未重抽时同种子同状态一致
    const before = [...host.run.offer];
    expect(host.reroll()).toBe(true);
    expect(host.run.offer).not.toEqual(before);
    expect(host.run.rerolls).toBe(guest.run.rerolls - 1);
    const host2 = new PvpMatch();
    host2.startRound(1, seed);
    host2.reroll();
    expect(host.run.offer).toEqual(host2.run.offer);
  });

  it('断线重连后按快照可精确恢复当前候选与进度', () => {
    const seed = 778899;
    const m = new PvpMatch();
    m.startRound(2, seed);
    m.pick(m.run.offer[1]);
    m.reroll();
    const restored = new PvpMatch();
    restored.startRound(2, seed);
    for (const card of [...m.run.history]) restored.pick(card);
    restored.rerollCount = m.rerollCount;
    if (restored.run.phase === 'DRAW') restored.refreshOffer();
    expect(restored.run.offer).toEqual(m.run.offer);
    expect(restored.run.drawCount).toBe(m.run.drawCount);
  });

  it('三次选卡后进入准备阶段并可构建军队', () => {
    const seed = hashSeed('room', 'draft2');
    const host = new PvpMatch();
    host.startRound(1, seed);
    const guest = new PvpMatch();
    guest.startRound(1, seed);
    for (const m of [host, guest]) {
      for (let i = 0; i < 3; i++) m.pick(m.run.offer[0]);
      expect(m.run.phase).toBe('PREPARE');
      expect(m.buildArmy().units.length).toBeGreaterThan(0);
    }
  });
});

describe('PvP 战斗确定性', () => {
  it('双方客户端以相同输入运行战斗，结果完全一致', () => {
    const setup = {
      seed: hashSeed('battle', 1),
      round: 3,
      player: armyOf([
        { unit: 'militia', count: 6 },
        { unit: 'archer', count: 4 },
        { unit: 'heavy_knight', count: 2 },
      ]),
      enemy: armyOf([
        { unit: 'swordsman', count: 5 },
        { unit: 'fire_mage', count: 2 },
        { unit: 'giant', count: 1 },
      ]),
      unitCap: 90,
    };
    const a = new BattleSim(JSON.parse(JSON.stringify(setup))).runToEnd();
    const b = new BattleSim(JSON.parse(JSON.stringify(setup))).runToEnd();
    expect(a.winner).toBe(b.winner);
    expect(a.time).toBeCloseTo(b.time, 3);
    expect(a.survivors).toEqual(b.survivors);
  });
});

describe('PvP 房间状态机', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeWs() {
    const inbox: any[] = [];
    return { inbox, ws: { send: (d: string) => inbox.push(JSON.parse(d)) } as any };
  }

  it('创建 → 军队提交 → 开战 → 结算扣血 → 下一回合', () => {
    const room = new Room('TEST01');
    const a = fakeWs();
    const b = fakeWs();
    room.bindHost(a.ws, 'Alice', 'sidA');
    room.attach('B', b.ws, 'Bob', 'sidB');
    room.begin();
    expect(room.state).toBe('draft');
    expect(room.round).toBe(1);

    const armyA = armyOf([{ unit: 'militia', count: 4 }]);
    const armyB = armyOf([{ unit: 'archer', count: 4 }]);
    room.handle('A', { t: 'army', round: 1, army: armyA });
    expect(room.state).toBe('draft'); // 等待对方
    room.handle('B', { t: 'army', round: 1, army: armyB });
    expect(room.state).toBe('battle');
    const battleMsg = a.inbox.find((m) => m.t === 'battle');
    expect(battleMsg.armyA).toEqual(armyA);
    expect(battleMsg.armyB).toEqual(armyB);

    room.handle('A', { t: 'result', round: 1, winner: 0 });
    room.handle('B', { t: 'result', round: 1, winner: 0 });
    expect(room.state).toBe('roundEnd');
    expect(room.hp).toEqual([START_HP, START_HP - 1]);
    expect(room.lastRoundEnd?.winner).toBe(0);

    vi.advanceTimersByTime(5_000);
    expect(room.state).toBe('draft');
    expect(room.round).toBe(2);
  });

  it('战斗结果上报不一致时以房主为准；单方上报超时后用已收到的结果', () => {
    const room = new Room('TEST02');
    const a = fakeWs();
    const b = fakeWs();
    room.bindHost(a.ws, 'Alice', 'sidA');
    room.attach('B', b.ws, 'Bob', 'sidB');
    room.begin();
    room.handle('A', { t: 'army', round: 1, army: armyOf([{ unit: 'militia', count: 2 }]) });
    room.handle('B', { t: 'army', round: 1, army: armyOf([{ unit: 'militia', count: 2 }]) });

    room.handle('A', { t: 'result', round: 1, winner: 1 });
    room.handle('B', { t: 'result', round: 1, winner: 0 });
    expect(room.lastRoundEnd?.winner).toBe(1); // 房主权威

    const room2 = new Room('TEST03');
    const c = fakeWs();
    const d = fakeWs();
    room2.bindHost(c.ws, 'A2', 'sidA');
    room2.attach('B', d.ws, 'B2', 'sidB');
    room2.begin();
    room2.handle('A', { t: 'army', round: 1, army: armyOf([{ unit: 'militia', count: 2 }]) });
    room2.handle('B', { t: 'army', round: 1, army: armyOf([{ unit: 'militia', count: 2 }]) });
    room2.handle('B', { t: 'result', round: 1, winner: 0 });
    vi.advanceTimersByTime(200_000); // 超时裁判
    expect(room2.lastRoundEnd?.winner).toBe(0);
  });

  it('抽卡超时兜底：缺失军队按空军队处理，对局继续', () => {
    const room = new Room('TEST04');
    const a = fakeWs();
    const b = fakeWs();
    room.bindHost(a.ws, 'Alice', 'sidA');
    room.attach('B', b.ws, 'Bob', 'sidB');
    room.begin();
    room.handle('A', { t: 'army', round: 1, army: armyOf([{ unit: 'militia', count: 3 }]) });
    vi.advanceTimersByTime(60_000);
    expect(room.state).toBe('battle');
    const battleMsg = a.inbox.find((m) => m.t === 'battle');
    expect(battleMsg.armyB.units).toEqual([]);
  });

  it('主动认输：对局中退出判负', () => {
    const room = new Room('TEST05');
    const a = fakeWs();
    const b = fakeWs();
    room.bindHost(a.ws, 'Alice', 'sidA');
    room.attach('B', b.ws, 'Bob', 'sidB');
    room.begin();
    room.handle('B', { t: 'leave' });
    expect(room.state).toBe('gameOver');
    expect(room.gameOverInfo?.winner).toBe(0);
  });

  it('断线超时判负，重连可恢复快照', () => {
    const room = new Room('TEST06');
    const a = fakeWs();
    const b = fakeWs();
    room.bindHost(a.ws, 'Alice', 'sidA');
    room.attach('B', b.ws, 'Bob', 'sidB');
    room.begin();
    room.disconnect('B'); // Bob 掉线
    const snap = room.snapshotFor('B');
    expect(snap.state).toBe('draft');

    vi.advanceTimersByTime(61_000); // 未重连
    expect(room.state).toBe('gameOver');
    expect(room.gameOverInfo?.winner).toBe(0); // 判 A 胜

    // 重连流程：同 sid 回到房间并拿到快照
    const room2 = new Room('TEST07');
    const c = fakeWs();
    const d = fakeWs();
    room2.bindHost(c.ws, 'Alice', 'sidA');
    room2.attach('B', d.ws, 'Bob', 'sidB');
    room2.begin();
    room2.disconnect('B');
    const res = room2.attach('B', d.ws, 'Bob', 'sidB');
    expect(res.rejoin).toBe(true);
    vi.advanceTimersByTime(70_000);
    expect(room2.state).not.toBe('gameOver');
    expect(room2.snapshotFor('B').state).toBe(room2.state);
  });
});
