<script setup lang="ts">
import { computed } from 'vue';
import type { ActiveSynergy, Phase, RunState } from '../game/core/types';
import HealthBar from './HealthBar.vue';
import SynergyPanel from './SynergyPanel.vue';

const props = defineProps<{
  position: 'top' | 'bottom';
  run: RunState;
  phase: Phase;
  speed: number;
  paused: boolean;
  time: number;
  alive: [number, number];
  rage: boolean;
  power: number;
  synergies: ActiveSynergy[];
  combos: string[];
  replay: boolean;
}>();
defineEmits<{ pause: []; speed: []; settings: []; menu: []; fullscreen: [] }>();

const phaseName: Record<Phase, string> = {
  DRAW: '抽卡阶段',
  PREPARE: '准备阶段',
  BATTLE: '战斗阶段',
  RESULT: '结算阶段',
  GAME_OVER: '对局结束',
};
const modeName = computed(() => (props.run.mode === 'endless' ? '无尽模式' : props.run.mode === 'daily' ? '每日挑战' : ''));
const timeText = computed(() => {
  const t = Math.floor(props.time);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
});
const inBattle = computed(() => props.phase === 'BATTLE' || props.replay);
</script>

<template>
  <div v-if="position === 'top'" class="hud top">
    <button class="icon-btn" aria-label="菜单" @click="$emit('menu')">☰</button>
    <div class="side enemy">
      <div class="team-name">敌方 · 暗影军团</div>
      <HealthBar team="enemy" :hp="run.enemyHp" :max="run.maxHp" :infinite="run.mode === 'endless'" compact />
    </div>
    <div class="center">
      <div class="round">回合 {{ String(run.round).padStart(2, '0') }}</div>
      <div class="phase">{{ replay ? '战斗回放' : phaseName[phase] }}<template v-if="modeName"> · {{ modeName }}</template></div>
    </div>
    <div class="actions">
      <template v-if="inBattle">
        <button class="icon-btn" :aria-label="paused ? '继续' : '暂停'" @click="$emit('pause')">{{ paused ? '▶' : '⏸' }}</button>
        <button class="icon-btn speed" aria-label="倍速" @click="$emit('speed')">{{ speed }}×</button>
      </template>
      <button class="icon-btn" aria-label="全屏" @click="$emit('fullscreen')">⛶</button>
      <button class="icon-btn" aria-label="设置" @click="$emit('settings')">⚙</button>
    </div>
  </div>
  <div v-else class="hud bottom">
    <div class="row">
      <div class="side player">
        <div class="team-name">我方 · 星辉军团</div>
        <HealthBar team="player" :hp="run.playerHp" :max="run.maxHp" compact />
      </div>
      <div v-if="inBattle" class="battle-info">
        <span class="alive"><b class="p">{{ alive[0] }}</b> vs <b class="e">{{ alive[1] }}</b></span>
        <span class="timer" :class="{ rage }">{{ rage ? '🔥 狂暴 ' : '⏱ ' }}{{ timeText }}</span>
      </div>
      <div v-else class="power">⚔ 战力 <b>{{ power }}</b></div>
    </div>
    <SynergyPanel :synergies="synergies" :combos="combos" />
  </div>
</template>

<style scoped>
.hud {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  background: linear-gradient(180deg, rgba(10, 12, 26, 0.95), rgba(10, 12, 26, 0.82));
  border-bottom: 1px solid var(--line);
}
.hud.top {
  align-items: center;
  padding-top: calc(6px + var(--safe-top));
}
.hud.bottom {
  flex-direction: column;
  border-top: 1px solid var(--line);
  border-bottom: none;
  gap: 4px;
}
.side {
  flex: 1;
  min-width: 0;
}
.team-name {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  margin-bottom: 2px;
}
.enemy .team-name {
  color: #ff8a96;
}
.player .team-name {
  color: #8ac6ff;
}
.center {
  text-align: center;
  flex: none;
}
.round {
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 2px;
  color: var(--gold);
  text-shadow: 0 2px 0 #4a2a00;
}
.phase {
  font-size: 11px;
  color: var(--muted);
}
.actions {
  display: flex;
  gap: 4px;
  flex: none;
}
.speed {
  font-weight: 900;
  font-size: 14px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.battle-info,
.power {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  flex: none;
}
.power b {
  color: var(--gold);
}
.alive .p {
  color: var(--player);
}
.alive .e {
  color: var(--enemy);
}
.timer.rage {
  color: #ff5a3a;
  font-weight: 800;
  animation: blink 0.5s infinite alternate;
}
@keyframes blink {
  from { opacity: 0.6; }
  to { opacity: 1; }
}
@media (max-width: 420px) {
  .actions .icon-btn {
    min-width: 36px;
  }
}
</style>
