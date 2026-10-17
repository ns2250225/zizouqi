<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { assetUrl, getManifest } from '../game/data/AssetManager';

const props = withDefaults(defineProps<{ hp: number; max: number; team: 'player' | 'enemy'; infinite?: boolean; compact?: boolean }>(), {
  infinite: false,
  compact: false,
});
const heart = computed(() => (getManifest()?.ui.heart ? assetUrl(getManifest()!.ui.heart) : ''));
const empty = computed(() => (getManifest()?.ui.heart_empty ? assetUrl(getManifest()!.ui.heart_empty) : ''));
const breaking = ref<{ from: number; to: number } | null>(null);

// 扣血时播放心碎动画
watch(
  () => props.hp,
  (now, before) => {
    if (before !== undefined && now < before) {
      breaking.value = { from: now + 1, to: before };
      setTimeout(() => (breaking.value = null), 900);
    }
  },
);
</script>

<template>
  <div class="hp" :class="[team, { compact }]">
    <template v-if="infinite">
      <span class="inf">∞</span>
    </template>
    <template v-else>
      <span v-for="i in max" :key="i" class="pip" :class="{ lost: i > hp, breaking: breaking !== null && i >= breaking.from && i <= breaking.to }">
        <img v-if="heart" :src="i <= hp ? heart : empty" class="pixel" draggable="false" alt="" />
        <span v-else>{{ i <= hp ? '❤' : '·' }}</span>
      </span>
    </template>
  </div>
</template>

<style scoped>
.hp {
  display: flex;
  gap: 2px;
  align-items: center;
  flex-wrap: wrap;
}
.pip {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.compact .pip {
  width: 15px;
  height: 15px;
}
.pip img {
  width: 100%;
  height: 100%;
}
.enemy .pip:not(.lost) img {
  filter: hue-rotate(250deg) saturate(1.4);
}
.pip.lost {
  opacity: 0.55;
}
.pip.breaking {
  animation: break 0.9s ease-out;
}
.inf {
  font-size: 22px;
  font-weight: 900;
  color: var(--enemy);
}
@keyframes break {
  0% { transform: scale(1.6); filter: brightness(3); }
  40% { transform: scale(1.2) rotate(-12deg); }
  100% { transform: scale(1); }
}
</style>
