import { defineStore } from 'pinia';
import {
  buildBattleSetup, createRun, dailySeed, pickCard, repairRun, rerollOffer, resolveRound, SAVE_VERSION, startRound,
} from '../game/core/GameManager';
import type { BattleOutcome, BattleSetup, GameMode, RoundRecord, RunState, Team } from '../game/core/types';
import { dbDelete, dbGet, dbSet, SaveKeys } from '../game/data/SaveManager';
import { randomSeed } from '../game/core/rng';
import { getCard } from '../game/data/ConfigLoader';
import { AudioManager } from '../game/audio/AudioManager';
import { useStats } from './stats';

export type View = 'menu' | 'game' | 'pvp' | 'codex' | 'stats' | 'settings' | 'credits';

export interface Toast {
  id: number;
  text: string;
  color?: string;
  big?: boolean;
}

let toastSeq = 1;

export const useGame = defineStore('game', {
  state: () => ({
    view: 'menu' as View,
    codexTab: 'units' as 'units' | 'cards',
    run: null as RunState | null,
    hasSave: false,
    toasts: [] as Toast[],
    battleLog: [] as { id: number; text: string; team: Team }[],
    battleInfo: { time: 0, alive: [0, 0] as [number, number], hp: [0, 0] as [number, number] },
    rage: false,
    speed: 1,
    paused: false,
    /** 正在播放的录像（不影响对局） */
    replay: null as RoundRecord | null,
    lastLoss: { player: 0, enemy: 0 },
    currentSetup: null as BattleSetup | null,
    dailyKey: '' as string,
    loaded: false,
  }),
  actions: {
    async init() {
      const save = await dbGet<RunState>(SaveKeys.run);
      this.hasSave = !!save && save.version === SAVE_VERSION && save.phase !== 'GAME_OVER';
      this.loaded = true;
    },

    toast(text: string, color?: string, big = false, ms = 2200) {
      const t = { id: toastSeq++, text, color, big };
      this.toasts.push(t);
      setTimeout(() => {
        this.toasts = this.toasts.filter((x) => x.id !== t.id);
      }, ms);
    },

    log(text: string, team: Team) {
      this.battleLog.push({ id: toastSeq++, text, team });
      if (this.battleLog.length > 6) this.battleLog.shift();
    },

    async save() {
      if (!this.run) return;
      if (this.run.phase === 'GAME_OVER') await dbDelete(SaveKeys.run);
      else await dbSet(SaveKeys.run, this.run);
      this.hasSave = this.run.phase !== 'GAME_OVER';
    },

    newGame(mode: GameMode, difficulty: string, seed?: number, dailyModifier?: string | null) {
      let s = seed ?? randomSeed();
      let mod = dailyModifier ?? null;
      if (mode === 'daily') {
        const d = dailySeed();
        s = d.seed;
        mod = d.modifier;
        this.dailyKey = d.key;
      }
      this.run = createRun({ mode, difficulty, seed: s, dailyModifier: mod });
      startRound(this.run);
      this.afterRoundStart();
      this.view = 'game';
      void this.save();
    },

    async continueGame() {
      const save = await dbGet<RunState>(SaveKeys.run);
      if (!save || save.version !== SAVE_VERSION) {
        this.hasSave = false;
        return;
      }
      // 战斗中刷新：回到开战前的安全存档点，同一种子重新开战
      if (save.phase === 'BATTLE') save.phase = 'PREPARE';
      if (save.mode === 'daily') this.dailyKey = dailySeed().key;
      if (repairRun(save)) await dbSet(SaveKeys.run, save);
      this.run = save;
      this.view = 'game';
    },

    afterRoundStart() {
      const run = this.run!;
      this.battleLog = [];
      this.rage = false;
      this.paused = false;
      useStats().markSeen(run.offer);
      if (run.enemyPlan?.isBoss) this.toast(`⚠ Boss 回合：${run.enemyPlan.preview[0] ? getCard('u_' + run.enemyPlan.preview[0].unit).name : ''}`, '#ff4a5a', true, 2600);
    },

    pick(cardId: string) {
      const run = this.run;
      if (!run) return;
      const { notes, streak } = pickCard(run, cardId);
      useStats().recordPick(cardId);
      for (const n of notes) this.toast(n, '#ffd23a');
      if (streak) this.toast(`连选同类兵种 ×${streak.count}：本回合攻击提升！`, '#6dff8a');
      if (run.phase === 'DRAW') useStats().markSeen(run.offer);
      void this.save();
    },

    reroll(): boolean {
      if (!this.run) return false;
      const ok = rerollOffer(this.run);
      if (ok) {
        AudioManager.play('reroll');
        useStats().markSeen(this.run.offer);
        void this.save();
      }
      return ok;
    },

    beginBattle(unitCap: number): BattleSetup | null {
      const run = this.run;
      if (!run || (run.phase !== 'PREPARE' && run.phase !== 'BATTLE')) return null;
      run.phase = 'BATTLE';
      this.battleLog = [];
      this.rage = false;
      this.speed = this.speed || 1;
      const setup = buildBattleSetup(run, unitCap);
      this.currentSetup = setup;
      void this.save();
      return setup;
    },

    finishBattle(outcome: BattleOutcome) {
      const run = this.run;
      if (!run || !this.currentSetup) return;
      const loss = resolveRound(run, this.currentSetup, outcome);
      this.lastLoss = { player: loss.playerLoss, enemy: loss.enemyLoss };
      const stats = useStats();
      stats.recordRound(outcome.winner === 0, run.round);
      if (run.phase === 'GAME_OVER') stats.recordRun(run, run.mode === 'daily' ? this.dailyKey : undefined);
      if (loss.playerLoss || loss.enemyLoss) AudioManager.play('hp_loss', { volume: 0.8 });
      AudioManager.play(outcome.winner === 0 ? 'victory' : 'defeat', { volume: 0.9 });
      void this.save();
    },

    nextRound() {
      const run = this.run;
      if (!run) return;
      if (repairRun(run)) {
        this.afterRoundStart();
        void this.save();
        return;
      }
      if (run.phase !== 'RESULT') return;
      startRound(run);
      this.afterRoundStart();
      void this.save();
    },

    startReplay(rec: RoundRecord) {
      this.replay = rec;
    },

    stopReplay() {
      this.replay = null;
    },

    async abandon() {
      this.run = null;
      this.replay = null;
      await dbDelete(SaveKeys.run);
      this.hasSave = false;
      this.view = 'menu';
    },

    toMenu() {
      this.view = 'menu';
      this.replay = null;
      if (this.run?.phase === 'GAME_OVER') this.run = null;
    },
  },
});
