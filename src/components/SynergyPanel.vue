<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ActiveSynergy } from '../game/core/types';
import { COMBOS } from '../game/data/ConfigLoader';

const props = defineProps<{ synergies: ActiveSynergy[]; combos: string[]; compact?: boolean }>();
const open = ref<string | null>(null);
const comboDefs = computed(() => props.combos.map((id) => COMBOS.find((c) => c.id === id)!).filter(Boolean));
</script>

<template>
  <div class="synergy-panel" :class="{ compact }">
    <span v-if="!synergies.length && !comboDefs.length" class="empty">选择 3 种同阵营/职业兵种可激活羁绊</span>
    <button
      v-for="s in synergies"
      :key="s.id"
      class="syn"
      :class="{ active: s.active, tier2: s.tier >= 2 }"
      @click="open = open === s.id ? null : s.id"
    >
      <span>{{ s.icon }}</span>
      <span class="n">{{ s.name }}</span>
      <span class="c">{{ s.count }}<template v-if="s.next">/{{ s.next }}</template></span>
      <span v-if="open === s.id" class="tip">{{ s.desc }}</span>
    </button>
    <button v-for="c in comboDefs" :key="c.id" class="syn combo" :style="{ borderColor: c.color, color: c.color }" @click="open = open === c.id ? null : c.id">
      <span>{{ c.icon }}</span>
      <span class="n">{{ c.name }}</span>
      <span v-if="open === c.id" class="tip">{{ c.desc }}</span>
    </button>
  </div>
</template>

<style scoped>
.synergy-panel {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}
.empty {
  font-size: 11px;
  color: var(--muted);
}
.syn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 7px;
  min-height: 28px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  color: var(--muted);
}
.syn.active {
  color: #fff;
  border-color: var(--player);
  background: rgba(74, 163, 255, 0.18);
}
.syn.tier2 {
  border-color: var(--gold);
  background: rgba(255, 210, 58, 0.18);
}
.syn.combo {
  background: rgba(255, 255, 255, 0.08);
  font-weight: 800;
  animation: glow 1.2s infinite alternate;
}
.c {
  font-weight: 800;
}
.tip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: max-content;
  max-width: 220px;
  padding: 6px 8px;
  border-radius: 6px;
  background: #0b0e1c;
  border: 1px solid var(--line);
  color: #fff;
  font-size: 12px;
  white-space: normal;
  text-align: left;
}
.compact .n {
  display: none;
}
@keyframes glow {
  from { box-shadow: 0 0 0 transparent; }
  to { box-shadow: 0 0 10px currentColor; }
}
</style>
