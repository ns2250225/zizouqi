<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../stores/game';
import { useStats } from '../stores/stats';
import { getCard, BALANCE } from '../game/data/ConfigLoader';
import { dailySeed, encodeRunCode } from '../game/core/GameManager';
import type { GameMode } from '../game/core/types';

const game = useGame();
const stats = useStats();
const board = ref<GameMode>('standard');
const today = dailySeed().key;
const entries = computed(() =>
  stats.leaderboard.filter((e) => e.mode === board.value && (board.value !== 'daily' || e.dailyKey === today)).slice(0, 10),
);
const winRate = computed(() => (stats.games ? Math.round((stats.wins / stats.games) * 100) : 0));
const diffName = (id: string) => BALANCE.difficulties.find((d) => d.id === id)?.name ?? id;
const resultName: Record<string, string> = { win: '胜利', lose: '失败', draw: '平局' };
const recent = computed(() => (game.run ? [...game.run.rounds].reverse().slice(0, 10) : []));
const fmt = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(Math.round(n)));

function copySeed(seed: number, mode: GameMode, diff: string) {
  void navigator.clipboard?.writeText(encodeRunCode(mode === 'daily' ? 'standard' : mode, diff, seed, null)).then(() => game.toast('对局码已复制'));
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <button class="icon-btn" aria-label="返回" @click="game.view = 'menu'">←</button>
      <h2>战绩统计</h2>
    </div>
    <div class="scroll">
      <div class="grid">
        <div class="stat"><b>{{ stats.games }}</b><span>总对局</span></div>
        <div class="stat"><b>{{ winRate }}%</b><span>胜率</span></div>
        <div class="stat"><b>{{ stats.wins }} / {{ stats.losses }} / {{ stats.draws }}</b><span>胜 / 负 / 平</span></div>
        <div class="stat"><b>{{ stats.bestRound }}</b><span>最高回合</span></div>
        <div class="stat"><b>{{ stats.bestEndless }}</b><span>无尽最佳胜场</span></div>
        <div class="stat"><b>{{ stats.roundsWon }} / {{ stats.roundsPlayed }}</b><span>回合胜 / 总回合</span></div>
        <div class="stat"><b>{{ fmt(stats.totalKills) }}</b><span>累计击杀</span></div>
        <div class="stat"><b>{{ fmt(stats.totalDamage) }}</b><span>累计伤害</span></div>
        <div class="stat"><b>{{ stats.seenCards.length }} / 100</b><span>已发现卡牌</span></div>
      </div>

      <section>
        <h4>最常选择的卡牌</h4>
        <div v-if="!stats.favoriteCards.length" class="muted">暂无数据</div>
        <div class="fav">
          <span v-for="f in stats.favoriteCards" :key="f.id" class="chip">{{ getCard(f.id).icon }} {{ getCard(f.id).name }} ×{{ f.count }}</span>
        </div>
      </section>

      <section>
        <h4>排行榜（本地）</h4>
        <div class="tabs">
          <button class="tab" :class="{ active: board === 'standard' }" @click="board = 'standard'">标准模式</button>
          <button class="tab" :class="{ active: board === 'endless' }" @click="board = 'endless'">无尽模式</button>
          <button class="tab" :class="{ active: board === 'daily' }" @click="board = 'daily'">今日挑战</button>
        </div>
        <table v-if="entries.length">
          <thead>
            <tr><th>#</th><th>得分</th><th>回合</th><th>结果</th><th>难度</th><th>日期</th><th /></tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in entries" :key="i">
              <td>{{ i + 1 }}</td>
              <td class="score">{{ e.score }}</td>
              <td>{{ e.rounds }}</td>
              <td>{{ resultName[e.result] ?? e.result }}</td>
              <td>{{ diffName(e.difficulty) }}</td>
              <td>{{ e.date }}</td>
              <td><button class="btn small ghost" @click="copySeed(e.seed, e.mode, e.difficulty)">对局码</button></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="muted">暂无记录，完成一局游戏后上榜。</div>
      </section>

      <section v-if="recent.length">
        <h4>当前对局 · 回合记录</h4>
        <div v-for="r in recent" :key="r.round" class="rec">
          <span>第 {{ r.round }} 回合</span>
          <span :class="r.winner === 0 ? 'w' : r.winner === 1 ? 'l' : ''">{{ r.winner === 0 ? '胜' : r.winner === 1 ? '负' : '平' }}</span>
          <span class="muted">vs {{ r.enemyTactic }}</span>
          <span class="muted">MVP：{{ r.topUnit ?? '-' }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
}
.stat b {
  font-size: 20px;
  color: var(--gold);
}
.stat span {
  font-size: 12px;
  color: var(--muted);
}
section {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
h4 {
  margin: 0 0 8px;
  color: var(--gold);
}
.fav {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: 8px;
}
th {
  text-align: left;
  color: var(--muted);
  font-weight: 500;
  padding: 4px;
}
td {
  padding: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
.score {
  color: var(--gold);
  font-weight: 800;
}
.rec {
  display: flex;
  gap: 10px;
  font-size: 13px;
  padding: 4px 0;
  flex-wrap: wrap;
}
.w {
  color: var(--good);
  font-weight: 800;
}
.l {
  color: #ff6a7a;
  font-weight: 800;
}
</style>
