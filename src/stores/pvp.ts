import { defineStore } from 'pinia';
import { BALANCE } from '../game/data/ConfigLoader';
import { PvpClient } from '../game/pvp/PvpClient';
import { PvpMatch } from '../game/pvp/PvpMatch';
import type { PvpRole, PvpSnapshot, PvpWinner, ServerMsg } from '../game/pvp/protocol';
import type { ArmySpec, BattleOutcome } from '../game/core/types';
import { useGame } from './game';

export type PvpPhase = 'idle' | 'connecting' | 'waiting' | 'draft' | 'battle' | 'roundEnd' | 'gameOver';

const DRAFT_AUTO_PICK_MS = 40_000; // 抽卡超时自动选卡（早于服务器的 45 秒兜底）
const SID_KEY = 'pvp_session';

interface SavedSession {
  code: string;
  sid: string;
  role: PvpRole;
  name: string;
}

export const usePvp = defineStore('pvp', {
  state: () => ({
    phase: 'idle' as PvpPhase,
    error: '',
    role: null as PvpRole | null,
    code: '',
    myName: '',
    peerName: '',
    round: 0,
    hp: [BALANCE.startHp, BALANCE.startHp] as [number, number],
    match: null as PvpMatch | null,
    /** 待渲染的战斗数据（battle 消息到达后由 PvpView 消费） */
    battleData: null as { round: number; battleSeed: number; armyA: ArmySpec; armyB: ArmySpec } | null,
    lastRoundEnd: null as { round: number; winner: PvpWinner; hp: [number, number] } | null,
    localOutcome: null as BattleOutcome | null,
    gameOverInfo: null as { winner: PvpWinner; reason: string } | null,
    peerPicks: 0,
    peerOffline: false,
    rematchMine: false,
    rematchPeer: false,
    pendingCode: '',
    lastOutcomeReported: false,
  }),

  getters: {
    /** 渲染视角：双方客户端运行同一模拟（房主为我方），加入方翻转显示 */
    flipped: (s) => s.role === 'B',
    myHp(): number {
      return this.role === 'B' ? this.hp[1] : this.hp[0];
    },
    oppHp(): number {
      return this.role === 'B' ? this.hp[0] : this.hp[1];
    },
    myArmy(): ArmySpec | null {
      return this.battleData ? (this.role === 'B' ? this.battleData.armyB : this.battleData.armyA) : null;
    },
  },

  actions: {
    // ------------------------------------------------------------- 连接与房间
    client(): PvpClient {
      if (!this._client) {
        const c = new PvpClient();
        c.onMessage = (m) => this.onMessage(m);
        c.onClose = () => {
          if (this.phase !== 'idle' && this.phase !== 'gameOver') this.peerOffline = true;
        };
        this._client = c;
      }
      return this._client;
    },

    savedSession(): SavedSession | null {
      try {
        const raw = localStorage.getItem(SID_KEY);
        return raw ? (JSON.parse(raw) as SavedSession) : null;
      } catch {
        return null;
      }
    },

    saveSession(code: string, sid: string, role: PvpRole, name: string) {
      try {
        localStorage.setItem(SID_KEY, JSON.stringify({ code, sid, role, name } satisfies SavedSession));
      } catch {
        /* ignore */
      }
    },

    async createRoom(name: string) {
      this.reset();
      this.myName = name;
      this.phase = 'connecting';
      try {
        await this.client().connect();
        this._client!.send({ t: 'create', name });
      } catch (e) {
        this.phase = 'idle';
        this.error = e instanceof Error ? e.message : '连接失败';
      }
    },

    async joinRoom(code: string, name: string) {
      this.reset();
      this.myName = name;
      this.phase = 'connecting';
      try {
        await this.client().connect();
        const saved = this.savedSession();
        const sid = saved && saved.code === code && saved.name === name ? saved.sid : undefined;
        this._client!.send({ t: 'join', code, name, sid });
      } catch (e) {
        this.phase = 'idle';
        this.error = e instanceof Error ? e.message : '连接失败';
      }
    },

    /** 用保存的会话重新加入上次房间（断线/刷新恢复） */
    async reconnect() {
      const saved = this.savedSession();
      if (!saved) return false;
      await this.joinRoom(saved.code, saved.name);
      return true;
    },

    pick(cardId: string) {
      if (!this.match || this.phase !== 'draft') return;
      const res = this.match.pick(cardId);
      const game = useGame();
      for (const n of res.notes) game.toast(n, '#ffd23a');
      if (res.streak) game.toast(`连选同类兵种 ×${res.streak.count}：本回合攻击提升！`, '#6dff8a');
      this._client?.send({ t: 'pick', round: this.round, draw: this.match.run.drawCount, card: cardId });
      if (this.match.run.phase === 'PREPARE') this.submitArmy();
    },

    reroll(): boolean {
      if (!this.match || this.phase !== 'draft') return false;
      if (!this.match.reroll()) return false;
      this._client?.send({ t: 'reroll', round: this.round });
      return true;
    },

    submitArmy() {
      if (!this.match) return;
      this.stopAutoPick();
      this._client?.send({ t: 'army', round: this.round, army: this.match.buildArmy() });
    },

    /** 抽卡超时：自动随机选满剩余次数并提交军队 */
    autoPickRest() {
      if (!this.match || this.phase !== 'draft') return;
      const game = useGame();
      while (this.match.run.phase === 'DRAW') {
        const id = this.match.autoPick();
        if (!id) break;
        this._client?.send({ t: 'pick', round: this.round, draw: this.match.run.drawCount, card: id });
      }
      game.toast('超时自动选卡', '#ff9a5a');
      this.submitArmy();
    },

    stopAutoPick() {
      if (this._autoPickTimer) {
        clearTimeout(this._autoPickTimer);
        this._autoPickTimer = null;
      }
    },

    reportOutcome(outcome: BattleOutcome) {
      if (this.phase !== 'battle' || this.lastOutcomeReported) return;
      this.lastOutcomeReported = true;
      this.localOutcome = outcome;
      this._client?.send({ t: 'result', round: this.round, winner: outcome.winner });
    },

    requestRematch() {
      this.rematchMine = true;
      this._client?.send({ t: 'rematch' });
    },

    async leave() {
      this._client?.send({ t: 'leave' });
      await this.disconnect();
      const game = useGame();
      game.view = 'menu';
    },

    async disconnect() {
      this.stopAutoPick();
      this._client?.close();
      this._client = null;
      this.reset();
    },

    reset() {
      this.stopAutoPick();
      this.phase = 'idle';
      this.error = '';
      this.role = null;
      this.code = '';
      this.peerName = '';
      this.round = 0;
      this.match = null;
      this.battleData = null;
      this.lastRoundEnd = null;
      this.localOutcome = null;
      this.gameOverInfo = null;
      this.peerPicks = 0;
      this.peerOffline = false;
      this.rematchMine = false;
      this.rematchPeer = false;
      this.lastOutcomeReported = false;
    },

    // ------------------------------------------------------------- 消息处理
    onMessage(m: ServerMsg) {
      const game = useGame();
      switch (m.t) {
        case 'created':
          this.code = m.code;
          this.role = m.role;
          this.myName = m.name;
          this.saveSession(m.code, m.sid, m.role, m.name);
          this.phase = 'waiting';
          break;
        case 'joined': {
          this.code = m.code;
          this.role = m.role;
          this.saveSession(m.code, m.sid, m.role, m.name);
          this.applySnapshot(m.snapshot);
          break;
        }
        case 'start':
          this.peerName = this.role === 'A' ? m.names.B : m.names.A;
          break;
        case 'round':
          this.onRound(m.round, m.draftSeed, m.hp, m.fresh);
          break;
        case 'peerPick':
          this.peerPicks = m.draw;
          game.toast(`对方已选卡（${m.draw}/3）`, '#9fe4ff');
          break;
        case 'peerReroll':
          game.toast('对方使用了重抽', '#9fe4ff');
          break;
        case 'battle':
          this.phase = 'battle';
          this.lastOutcomeReported = false;
          this.localOutcome = null;
          this.battleData = { round: m.round, battleSeed: m.battleSeed, armyA: m.armyA, armyB: m.armyB };
          break;
        case 'roundEnd':
          this.phase = 'roundEnd';
          this.lastRoundEnd = { round: m.round, winner: m.winner, hp: m.hp };
          this.hp = [m.hp[0], m.hp[1]];
          this.syncHpToRun();
          break;
        case 'gameOver':
          this.phase = 'gameOver';
          this.gameOverInfo = { winner: m.winner, reason: m.reason };
          this.hp = [m.hp[0], m.hp[1]];
          this.syncHpToRun();
          break;
        case 'rematchStart':
          this.rematchPeer = false;
          this.rematchMine = false;
          this.gameOverInfo = null;
          this.lastRoundEnd = null;
          break;
        case 'rematchOffer':
          this.rematchPeer = true;
          game.toast('对方想再来一局！', '#ffd23a');
          break;
        case 'peerLeft':
          this.peerOffline = true;
          game.toast('对方断线，等待重连…', '#ff9a5a');
          break;
        case 'peerRejoined':
          this.peerOffline = false;
          game.toast('对方已重新连接', '#6dff8a');
          break;
        case 'error':
          this.error = m.msg;
          if (this.phase === 'connecting') this.phase = 'idle';
          break;
        default:
          break;
      }
    },

    onRound(round: number, draftSeed: number, hp: [number, number], fresh: boolean) {
      this.round = round;
      this.hp = [hp[0], hp[1]];
      this.phase = 'draft';
      this.battleData = null;
      this.lastRoundEnd = null;
      this.localOutcome = null;
      this.peerPicks = 0;
      this.peerOffline = false;
      this.lastOutcomeReported = false;
      if (fresh || !this.match) this.match = new PvpMatch();
      this.match.startRound(round, draftSeed);
      this.syncHpToRun();
      this.stopAutoPick();
      this._autoPickTimer = window.setTimeout(() => this.autoPickRest(), DRAFT_AUTO_PICK_MS);
    },

    /** HUD 使用 RunState：playerHp = 我的生命，enemyHp = 对方生命 */
    syncHpToRun() {
      const run = this.match?.run;
      if (!run) return;
      run.playerHp = this.myHp;
      run.enemyHp = this.oppHp;
      run.maxHp = BALANCE.startHp;
    },

    applySnapshot(snap: PvpSnapshot) {
      this.hp = [snap.hp[0], snap.hp[1]];
      if (snap.names.A && snap.names.B) this.peerName = this.role === 'A' ? snap.names.B : snap.names.A;
      switch (snap.state) {
        case 'waiting':
          this.phase = 'waiting';
          break;
        case 'draft': {
          this.match = new PvpMatch();
          this.match.startRound(snap.round, snap.draftSeed);
          this.syncHpToRun();
          const picks = snap.picks;
          for (const card of picks.cards) this.match.pick(card);
          this.match.rerollCount = picks.rerolls;
          if (picks.rerolls > 0 && this.match.run.phase === 'DRAW') this.match.refreshOffer();
          this.round = snap.round;
          this.peerPicks = snap.oppPickCount;
          this.phase = 'draft';
          if (this.match.run.phase === 'PREPARE') this.submitArmy();
          else this._autoPickTimer = window.setTimeout(() => this.autoPickRest(), 20_000);
          break;
        }
        case 'battle':
          if (snap.armies.A && snap.armies.B) {
            this.match = new PvpMatch();
            this.match.startRound(snap.round, snap.draftSeed);
            this.syncHpToRun();
            this.round = snap.round;
            this.phase = 'battle';
            this.lastOutcomeReported = false;
            this.battleData = { round: snap.round, battleSeed: snap.battleSeed, armyA: snap.armies.A, armyB: snap.armies.B };
          } else {
            this.phase = 'waiting';
          }
          break;
        case 'roundEnd':
          this.phase = 'roundEnd';
          this.lastRoundEnd = snap.lastRoundEnd;
          break;
        case 'gameOver':
          this.phase = 'gameOver';
          this.gameOverInfo = snap.gameOverInfo ? { winner: snap.gameOverInfo.winner, reason: snap.gameOverInfo.reason } : null;
          break;
        default:
          this.phase = 'waiting';
      }
    },
  },
});

declare module 'pinia' {
  export interface PiniaCustomProperties {
    _client?: PvpClient | null;
    _autoPickTimer?: number | null;
  }
}
