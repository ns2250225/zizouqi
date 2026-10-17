import { defineStore } from 'pinia';
import { dbGet, dbSet, SaveKeys } from '../game/data/SaveManager';
import type { GameMode, RunState } from '../game/core/types';
import { roundsWon } from '../game/core/GameManager';

export interface LeaderboardEntry {
  mode: GameMode;
  difficulty: string;
  score: number;
  rounds: number;
  result: string;
  date: string;
  dailyKey?: string;
  seed: number;
}

export interface StatsState {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  roundsPlayed: number;
  roundsWon: number;
  bestRound: number;
  bestEndless: number;
  totalKills: number;
  totalDamage: number;
  picks: Record<string, number>;
  seenCards: string[];
  seenUnits: string[];
  leaderboard: LeaderboardEntry[];
  recordedRuns: string[];
}

const empty = (): StatsState => ({
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  roundsPlayed: 0,
  roundsWon: 0,
  bestRound: 0,
  bestEndless: 0,
  totalKills: 0,
  totalDamage: 0,
  picks: {},
  seenCards: [],
  seenUnits: [],
  leaderboard: [],
  recordedRuns: [],
});

/** 分数：胜利回合数 × 100 + 剩余生命 × 50 + 击杀数，难度加成 */
export function scoreRun(run: RunState): number {
  const diffBonus: Record<string, number> = { easy: 0.7, normal: 1, hard: 1.4, nightmare: 2 };
  const base = roundsWon(run) * 100 + run.playerHp * 50 + run.totalKills + (run.result === 'win' ? 500 : 0);
  return Math.round(base * (diffBonus[run.difficulty] ?? 1));
}

export const useStats = defineStore('stats', {
  state: empty,
  actions: {
    async load() {
      const s = await dbGet<Partial<StatsState>>(SaveKeys.stats);
      if (s) this.$patch({ ...empty(), ...s });
    },
    async save() {
      await dbSet(SaveKeys.stats, this.$state);
    },
    markSeen(cards: string[]) {
      let changed = false;
      for (const id of cards) {
        if (!this.seenCards.includes(id)) {
          this.seenCards.push(id);
          changed = true;
        }
        if (id.startsWith('u_') && !this.seenUnits.includes(id.slice(2))) {
          this.seenUnits.push(id.slice(2));
          changed = true;
        }
      }
      if (changed) void this.save();
    },
    recordPick(cardId: string) {
      this.picks[cardId] = (this.picks[cardId] ?? 0) + 1;
    },
    recordRound(won: boolean, round: number) {
      this.roundsPlayed++;
      if (won) this.roundsWon++;
      this.bestRound = Math.max(this.bestRound, round);
      void this.save();
    },
    recordRun(run: RunState, dailyKey?: string) {
      if (this.recordedRuns.includes(run.id)) return;
      this.recordedRuns.push(run.id);
      if (this.recordedRuns.length > 200) this.recordedRuns.splice(0, 100);
      this.games++;
      if (run.result === 'win') this.wins++;
      else if (run.result === 'lose') this.losses++;
      else this.draws++;
      this.totalKills += run.totalKills;
      this.totalDamage += Math.round(run.totalDamage);
      if (run.mode === 'endless') this.bestEndless = Math.max(this.bestEndless, roundsWon(run));
      const entry: LeaderboardEntry = {
        mode: run.mode,
        difficulty: run.difficulty,
        score: run.mode === 'endless' ? roundsWon(run) * 100 + run.totalKills : scoreRun(run),
        rounds: run.round,
        result: run.result ?? 'draw',
        date: new Date().toISOString().slice(0, 10),
        dailyKey,
        seed: run.runSeed,
      };
      this.leaderboard.push(entry);
      this.leaderboard.sort((a, b) => b.score - a.score);
      // 每个模式保留前 20 名
      const keep: LeaderboardEntry[] = [];
      const counts: Record<string, number> = {};
      for (const e of this.leaderboard) {
        counts[e.mode] = (counts[e.mode] ?? 0) + 1;
        if (counts[e.mode] <= 20) keep.push(e);
      }
      this.leaderboard = keep;
      void this.save();
    },
    async resetAll() {
      this.$patch(empty());
      await this.save();
    },
  },
  getters: {
    favoriteCards(state): { id: string; count: number }[] {
      return Object.entries(state.picks)
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    },
  },
});
