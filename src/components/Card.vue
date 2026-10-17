<script setup lang="ts">
import { computed } from 'vue';
import { getCard, SKILL_MAP, UNIT_MAP } from '../game/data/ConfigLoader';
import { RARITY_NAMES } from '../game/core/types';
import UnitIcon from './UnitIcon.vue';

const props = withDefaults(defineProps<{ cardId: string; count?: number | null; compact?: boolean; showInfo?: boolean }>(), {
  count: null,
  compact: false,
  showInfo: true,
});
defineEmits<{ info: [] }>();

const card = computed(() => getCard(props.cardId));
const unit = computed(() => (card.value.unit ? UNIT_MAP.get(card.value.unit) : undefined));
const spawn = computed(() => {
  const e = card.value.effects.find((x) => x.kind === 'SPAWN');
  return e && e.kind === 'SPAWN' ? e.count : null;
});
const skills = computed(() => (unit.value ? unit.value.skills.map((s) => SKILL_MAP.get(s)?.name).filter(Boolean) : []));
const typeName: Record<string, string> = { UNIT: '兵种', BUFF: '增益', SPELL: '法术', SYNERGY: '成长' };
const permanent = computed(() => card.value.effects.some((e) => 'permanent' in e && e.permanent));
</script>

<template>
  <div class="card" :class="[`rarity-${card.rarity}`, { compact }]">
    <div class="frame">
      <div class="top">
        <span class="rarity">{{ RARITY_NAMES[card.rarity] }}</span>
        <span class="type">{{ typeName[card.type] }}<template v-if="!unit && permanent"> · 永久</template></span>
      </div>
      <div class="art">
        <UnitIcon v-if="unit" :unit="unit.id" :size="compact ? 54 : 78" />
        <span v-else class="emoji">{{ card.icon }}</span>
        <span v-if="unit" class="class-icon">{{ card.icon }}</span>
      </div>
      <div class="name">{{ card.name }}</div>
      <div v-if="spawn !== null" class="plus">+{{ count ?? spawn }}</div>
      <div class="desc">{{ unit ? unit.desc : card.description }}</div>
      <div v-if="unit && !compact" class="stats">
        <span>❤ {{ unit.hp }}</span>
        <span>⚔ {{ unit.attack }}</span>
        <span>{{ unit.attackRange > 60 ? '🎯' : '🗡' }} {{ unit.attackRange }}</span>
      </div>
      <div v-if="skills.length && !compact" class="skills">
        <span v-for="s in skills" :key="s" class="skill">{{ s }}</span>
      </div>
      <button v-if="showInfo" class="info" aria-label="详情" @click.stop="$emit('info')" @pointerdown.stop>ⓘ</button>
    </div>
  </div>
</template>

<style scoped>
.card {
  --rc: var(--common);
  width: 100%;
  height: 100%;
  border-radius: 12px;
  padding: 3px;
  background: linear-gradient(160deg, var(--rc), color-mix(in srgb, var(--rc) 30%, #000) 60%, var(--rc));
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 6px 18px rgba(0, 0, 0, 0.5), 0 0 16px color-mix(in srgb, var(--rc) 35%, transparent);
  position: relative;
}
.frame {
  position: relative;
  height: 100%;
  border-radius: 9px;
  background: radial-gradient(circle at 50% 25%, color-mix(in srgb, var(--rc) 22%, #1a1f38), #0f1224 75%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 7px 8px;
  overflow: hidden;
  text-align: center;
}
.top {
  width: 100%;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
}
.rarity {
  color: var(--rc);
}
.type {
  color: var(--muted);
}
.art {
  position: relative;
  margin: 4px 0 2px;
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.emoji {
  font-size: 46px;
  line-height: 1.2;
  filter: drop-shadow(0 0 10px color-mix(in srgb, var(--rc) 60%, transparent));
}
.compact .emoji {
  font-size: 34px;
}
.class-icon {
  position: absolute;
  right: -14px;
  top: -4px;
  font-size: 16px;
}
.name {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 1px;
}
.plus {
  font-size: 24px;
  font-weight: 900;
  color: var(--gold);
  line-height: 1.1;
  text-shadow: 0 2px 0 #4a2a00;
}
.desc {
  font-size: 11px;
  color: #c9cfee;
  line-height: 1.35;
  margin-top: 2px;
  flex: 1;
  overflow: hidden;
}
.stats {
  display: flex;
  gap: 6px;
  font-size: 10px;
  color: var(--muted);
  margin-top: 2px;
}
.skills {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  justify-content: center;
  margin-top: 3px;
}
.skill {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--rc) 25%, transparent);
}
.info {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.35);
  color: var(--muted);
  font-size: 15px;
}
.compact .name {
  font-size: 13px;
}
.compact .plus {
  font-size: 18px;
}
</style>
