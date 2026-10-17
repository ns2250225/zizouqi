<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BattleOutcome, Team } from '../game/core/types';

const props = defineProps<{ outcome: BattleOutcome }>();
const tab = ref<Team>(0);
const rows = computed(() => props.outcome.stats.filter((s) => s.team === tab.value));
const max = computed(() => Math.max(1, ...rows.value.map((r) => r.damage)));
const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
</script>

<template>
  <div class="battle-stats">
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 0 }" @click="tab = 0">我方</button>
      <button class="tab" :class="{ active: tab === 1 }" @click="tab = 1">敌方</button>
    </div>
    <table>
      <thead>
        <tr><th>兵种</th><th>伤害</th><th>击杀</th><th>治疗</th><th>承伤</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.unit">
          <td class="n">{{ r.name }}</td>
          <td class="d">
            <div class="bar" :class="tab === 0 ? 'p' : 'e'" :style="{ width: `${(r.damage / max) * 100}%` }" />
            <span>{{ fmt(r.damage) }}</span>
          </td>
          <td>{{ r.kills }}</td>
          <td>{{ fmt(r.healing) }}</td>
          <td>{{ fmt(r.taken) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.battle-stats {
  max-height: 40vh;
  overflow-y: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: 6px;
}
th {
  color: var(--muted);
  font-weight: 500;
  text-align: left;
  padding: 4px;
  position: sticky;
  top: 0;
  background: var(--panel-solid);
}
td {
  padding: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
.n {
  white-space: nowrap;
}
.d {
  position: relative;
  width: 40%;
}
.bar {
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  border-radius: 3px;
  opacity: 0.35;
}
.bar.p {
  background: var(--player);
}
.bar.e {
  background: var(--enemy);
}
.d span {
  position: relative;
}
</style>
