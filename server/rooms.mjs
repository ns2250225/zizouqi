import crypto from 'node:crypto';

/** 房间状态机：只负责房间管理、信令转发与超时裁判，战斗模拟完全由双方客户端确定性执行 */

export const START_HP = 8;
export const DRAFT_MS = 45_000; // 每回合抽卡时限（客户端 40 秒会自动选卡，此处兜底）
export const BATTLE_MS = 150_000; // 战斗结果上报时限（90 秒战斗 + 狂暴 + 余量）
export const ROUND_SHOW_MS = 4_000; // 回合结算展示时长，由服务器统一控制保证双方同步
export const DISCONNECT_GRACE_MS = 60_000; // 断线重连等待
export const LOBBY_TTL_MS = 30 * 60_000; // 无人加入的房间保留时长
export const CLOSED_TTL_MS = 10 * 60_000; // 结束后的房间保留时长（供查看战绩/再战）
export const MAX_ROOMS = 500;
export const MAX_NAME_LEN = 16;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode() {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return s;
}

export function newSeed() {
  return crypto.randomBytes(4).readUInt32LE(0);
}

export function newSid() {
  return crypto.randomBytes(12).toString('base64url');
}

export function emptyArmy() {
  return { units: [], mods: [], flags: {}, spells: [], synergies: [], combos: [], statMult: 1, boss: null };
}

export function sanitizeName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim();
  return (s || `玩家${crypto.randomBytes(2).toString('hex').toUpperCase()}`).slice(0, MAX_NAME_LEN);
}

export class Room {
  constructor(code) {
    this.code = code;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.state = 'waiting'; // waiting | draft | battle | roundEnd | gameOver
    this.round = 0;
    this.hp = [START_HP, START_HP];
    this.players = { A: null, B: null }; // { sid, name, ws, connected }
    this.draftSeedA = 0;
    this.draftSeedB = 0;
    this.battleSeed = 0;
    this.picks = { A: { cards: [], rerolls: 0 }, B: { cards: [], rerolls: 0 } };
    this.armies = { A: null, B: null };
    this.results = { A: null, B: null };
    this.lastRoundEnd = null;
    this.gameOverInfo = null;
    this.rematch = { A: false, B: false };
    this.timers = {};
  }

  touch() {
    this.lastActivity = Date.now();
  }

  clearTimer(key) {
    if (this.timers[key]) {
      clearTimeout(this.timers[key]);
      delete this.timers[key];
    }
  }

  clearPhaseTimers() {
    // 只清理阶段定时器；断线判负定时器独立管理，不能被回合推进误清
    for (const key of ['draft', 'battle', 'show']) this.clearTimer(key);
  }

  clearDisconnectTimers() {
    for (const key of ['disconnect_A', 'disconnect_B']) this.clearTimer(key);
  }

  clearAllTimers() {
    this.clearPhaseTimers();
    this.clearDisconnectTimers();
  }

  bothConnected() {
    return this.players.A?.connected && this.players.B?.connected;
  }

  send(side, msg) {
    const p = this.players[side];
    if (p?.ws && p.connected) {
      try {
        p.ws.send(JSON.stringify(msg));
      } catch {
        /* 连接已损坏时由 close 处理 */
      }
    }
  }

  broadcast(msg) {
    this.send('A', msg);
    this.send('B', msg);
  }

  snapshotFor(side) {
    const opp = side === 'A' ? 'B' : 'A';
    const snap = {
      state: this.state,
      round: this.round,
      hp: this.hp,
      names: { A: this.players.A?.name ?? '', B: this.players.B?.name ?? '' },
      draftSeedA: this.draftSeedA,
      draftSeedB: this.draftSeedB,
      picks: this.picks[side],
      oppPickCount: this.picks[opp].cards.length,
      armies: this.armies,
      battleSeed: this.battleSeed,
      lastRoundEnd: this.lastRoundEnd,
      gameOverInfo: this.gameOverInfo,
    };
    return snap;
  }

  attach(side, ws, name, sid) {
    const existing = this.players[side];
    const rejoin = !!existing && existing.sid === sid;
    this.players[side] = { sid, name, ws, connected: true };
    this.touch();
    if (rejoin) {
      this.clearTimer(`disconnect_${side}`);
      this.broadcast({ t: 'peerRejoined' });
    }
    return { rejoin };
  }

  bindHost(ws, name, sid) {
    this.players.A = { sid, name, ws, connected: true };
    this.touch();
  }

  begin() {
    this.state = 'draft';
    this.round = 0;
    this.hp = [START_HP, START_HP];
    this.broadcast({ t: 'start', names: { A: this.players.A.name, B: this.players.B.name } });
    this.startRound();
  }

  startRound() {
    this.clearPhaseTimers();
    this.round += 1;
    this.state = 'draft';
    // 双方各自独立的候选种子：候选卡互不相同，且受各自成长状态影响
    this.draftSeedA = newSeed();
    this.draftSeedB = newSeed();
    this.picks = { A: { cards: [], rerolls: 0 }, B: { cards: [], rerolls: 0 } };
    this.armies = { A: null, B: null };
    this.results = { A: null, B: null };
    this.touch();
    this.broadcast({
      t: 'round',
      round: this.round,
      draftSeedA: this.draftSeedA,
      draftSeedB: this.draftSeedB,
      hp: this.hp,
      fresh: this.round === 1,
    });
    this.timers.draft = setTimeout(() => {
      // 客户端会自动选卡并提交；仍缺军队时用其历史军队或空军队兜底，保证对局继续
      if (!this.armies.A) this.armies.A = emptyArmy();
      if (!this.armies.B) this.armies.B = emptyArmy();
      this.startBattle();
    }, DRAFT_MS);
  }

  startBattle() {
    this.clearPhaseTimers();
    this.state = 'battle';
    this.battleSeed = newSeed();
    this.touch();
    this.broadcast({ t: 'battle', round: this.round, battleSeed: this.battleSeed, armyA: this.armies.A, armyB: this.armies.B });
    this.timers.battle = setTimeout(() => this.endBattle(), BATTLE_MS);
  }

  endBattle() {
    this.clearTimer('battle');
    let winner = this.results.A ?? this.results.B ?? 'draw';
    if (this.results.A !== null && this.results.B !== null && this.results.A !== this.results.B) {
      winner = this.results.A; // 双方确定性模拟下不会发生；以房主为准
    }
    if (winner === 0) this.hp[1] = Math.max(0, this.hp[1] - 1);
    else if (winner === 1) this.hp[0] = Math.max(0, this.hp[0] - 1);
    else {
      this.hp[0] = Math.max(0, this.hp[0] - 1);
      this.hp[1] = Math.max(0, this.hp[1] - 1);
    }
    this.state = 'roundEnd';
    this.lastRoundEnd = { round: this.round, winner, hp: [...this.hp] };
    this.touch();
    this.broadcast({ t: 'roundEnd', round: this.round, winner, hp: this.hp });
    if (this.hp[0] <= 0 || this.hp[1] <= 0) {
      this.state = 'gameOver';
      this.clearDisconnectTimers();
      const finalWinner = this.hp[0] <= 0 && this.hp[1] <= 0 ? 'draw' : this.hp[0] <= 0 ? 1 : 0;
      this.gameOverInfo = { winner: finalWinner, hp: [...this.hp], reason: 'hp' };
      this.broadcast({ t: 'gameOver', ...this.gameOverInfo });
      this.timers.closed = setTimeout(() => this.closed = true, CLOSED_TTL_MS);
    } else {
      this.timers.show = setTimeout(() => this.startRound(), ROUND_SHOW_MS);
    }
  }

  disconnect(side) {
    const p = this.players[side];
    if (!p) return;
    p.connected = false;
    this.touch();
    if (this.state === 'waiting') {
      if (side === 'A') this.closed = true; // 房主离开等待房，直接销毁
      else this.players.B = null;
      return;
    }
    if (this.state === 'gameOver') return;
    this.broadcast({ t: 'peerLeft', grace: DISCONNECT_GRACE_MS });
    this.timers[`disconnect_${side}`] = setTimeout(() => {
      if (this.players[side]?.connected) return;
      this.clearPhaseTimers();
      this.clearTimer(`disconnect_${side === 'A' ? 'B' : 'A'}`);
      this.state = 'gameOver';
      const winner = side === 'A' ? 1 : 0;
      this.gameOverInfo = { winner, hp: [...this.hp], reason: 'disconnect' };
      this.broadcast({ t: 'gameOver', ...this.gameOverInfo });
      this.timers.closed = setTimeout(() => (this.closed = true), CLOSED_TTL_MS);
    }, DISCONNECT_GRACE_MS);
  }

  handle(side, msg) {
    this.touch();
    const opp = side === 'A' ? 'B' : 'A';
    switch (msg.t) {
      case 'pick': {
        if (this.state !== 'draft' || msg.round !== this.round) return;
        const cards = this.picks[side].cards;
        if (cards.length >= 3 || typeof msg.card !== 'string') return;
        cards.push(msg.card);
        this.send(opp, { t: 'peerPick', round: this.round, draw: cards.length });
        break;
      }
      case 'reroll': {
        if (this.state !== 'draft' || msg.round !== this.round) return;
        this.picks[side].rerolls += 1;
        this.send(opp, { t: 'peerReroll', round: this.round });
        break;
      }
      case 'army': {
        if (this.state !== 'draft' || msg.round !== this.round) return;
        if (!msg.army || typeof msg.army !== 'object' || !Array.isArray(msg.army.units)) return;
        this.armies[side] = msg.army;
        if (this.armies.A && this.armies.B) this.startBattle();
        break;
      }
      case 'result': {
        if (this.state !== 'battle' || msg.round !== this.round) return;
        if (msg.winner !== 0 && msg.winner !== 1 && msg.winner !== 'draw') return;
        this.results[side] = msg.winner;
        if (this.results.A !== null && this.results.B !== null) this.endBattle();
        break;
      }
      case 'rematch': {
        if (this.state !== 'gameOver') return;
        this.rematch[side] = true;
        if (this.rematch.A && this.rematch.B) {
          this.clearAllTimers();
          this.hp = [START_HP, START_HP];
          this.round = 0;
          this.rematch = { A: false, B: false };
          this.lastRoundEnd = null;
          this.gameOverInfo = null;
          this.broadcast({ t: 'rematchStart' });
          this.startRound();
        } else {
          this.send(opp, { t: 'rematchOffer' });
        }
        break;
      }
      case 'leave': {
        // 主动退出：进行中对局直接判负，其余情况视为断开
        if (this.state === 'draft' || this.state === 'battle' || this.state === 'roundEnd') {
          this.clearAllTimers();
          this.state = 'gameOver';
          const winner = opp === 'A' ? 0 : 1; // 对手获胜
          this.gameOverInfo = { winner, hp: [...this.hp], reason: 'forfeit' };
          this.broadcast({ t: 'gameOver', ...this.gameOverInfo });
          this.timers.closed = setTimeout(() => (this.closed = true), CLOSED_TTL_MS);
        } else if (this.state === 'waiting' && side === 'A') {
          this.closed = true;
        } else if (this.state === 'gameOver') {
          this.timers.closed ??= setTimeout(() => (this.closed = true), CLOSED_TTL_MS);
        }
        break;
      }
      default:
        break;
    }
  }

  destroy() {
    this.clearAllTimers();
    this.closed = true;
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  normalizeCode(code) {
    return String(code ?? '').trim().toUpperCase().slice(0, 8);
  }

  create() {
    if (this.rooms.size >= MAX_ROOMS) return null;
    let code = newCode();
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 20) code = newCode();
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    const room = this.rooms.get(this.normalizeCode(code));
    if (!room || room.closed) return null;
    return room;
  }

  remove(code) {
    const room = this.rooms.get(code);
    if (room) room.destroy();
    this.rooms.delete(code);
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const idle = now - room.lastActivity;
      if (room.closed || (room.state === 'waiting' && idle > LOBBY_TTL_MS) || (room.state === 'gameOver' && idle > CLOSED_TTL_MS)) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }

  stop() {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }
}
