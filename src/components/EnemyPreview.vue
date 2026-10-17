<script setup lang="ts">
import type { EnemyPlan } from '../game/core/types';
import UnitIcon from './UnitIcon.vue';

defineProps<{ plan: EnemyPlan; compact?: boolean }>();
defineEmits<{ unit: [id: string] }>();
</script>

<template>
  <div class="enemy-preview" :class="{ boss: plan.isBoss, compact }">
    <div class="title">
      <span class="icon">{{ plan.tacticIcon }}</span>
      <div>
        <div class="name">敌军预告 · {{ plan.tacticName }}<span v-if="plan.isBoss" class="boss-tag">BOSS</span></div>
        <div class="sub">{{ plan.tacticDesc }} · {{ plan.bracketName }}</div>
      </div>
    </div>
    <div class="units">
      <UnitIcon v-for="(u, i) in plan.preview" :key="u.unit + i" :unit="u.unit" :count="u.count" :size="compact ? 30 : 36" @click="$emit('unit', u.unit)" />
    </div>
    <div v-if="plan.strengthScale || plan.buffNames.length || plan.army.synergies.some((s) => s.active)" class="buffs">
      <span v-if="plan.strengthScale" class="chip bad strong">♾ 强度 ×{{ plan.strengthScale >= 100 ? Math.round(plan.strengthScale) : plan.strengthScale.toFixed(2) }}</span>
      <span v-for="b in plan.buffNames" :key="b" class="chip bad">{{ b }}</span>
      <span v-for="s in plan.army.synergies.filter((x) => x.active)" :key="s.id" class="chip bad">{{ s.icon }} {{ s.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.enemy-preview {
  background: rgba(40, 8, 20, 0.78);
  border: 1px solid rgba(255, 74, 90, 0.4);
  border-radius: 10px;
  padding: 6px 8px;
  backdrop-filter: blur(2px);
}
.enemy-preview.boss {
  border-color: var(--gold);
  box-shadow: 0 0 16px rgba(255, 210, 58, 0.35);
}
.title {
  display: flex;
  gap: 6px;
  align-items: center;
}
.icon {
  font-size: 20px;
}
.name {
  font-size: 13px;
  font-weight: 800;
  color: #ffb0b8;
}
.sub {
  font-size: 11px;
  color: var(--muted);
}
.boss-tag {
  margin-left: 6px;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--gold);
  color: #2a1700;
}
.units {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.buffs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.chip.bad {
  border-color: rgba(255, 74, 90, 0.5);
  color: #ffb0b8;
}
.chip.strong {
  color: var(--gold);
  border-color: var(--gold);
  font-weight: 800;
}
.compact .sub {
  display: none;
}
</style>
