<script setup lang="ts">
import { computed } from 'vue';
import { unitImage } from '../game/data/AssetManager';
import { UNIT_MAP } from '../game/data/ConfigLoader';

const props = withDefaults(defineProps<{ unit: string; size?: number; count?: number | null; dim?: boolean }>(), {
  size: 40,
  count: null,
  dim: false,
});
const src = computed(() => unitImage(props.unit));
const cfg = computed(() => UNIT_MAP.get(props.unit));
</script>

<template>
  <div class="unit-icon" :class="[cfg ? `rarity-${cfg.rarity}` : '', { dim }]" :style="{ width: `${size}px`, height: `${size}px` }" :title="cfg?.name">
    <img v-if="src" :src="src" class="pixel" :alt="cfg?.name" draggable="false" />
    <span v-else class="fallback">{{ cfg?.name.slice(0, 1) }}</span>
    <span v-if="count !== null" class="count">{{ count }}</span>
  </div>
</template>

<style scoped>
.unit-icon {
  position: relative;
  border-radius: 8px;
  background: radial-gradient(circle at 50% 60%, color-mix(in srgb, var(--rc, #888) 35%, transparent), rgba(0, 0, 0, 0.35));
  border: 1px solid color-mix(in srgb, var(--rc, #888) 55%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.unit-icon img {
  width: 82%;
  height: 82%;
  object-fit: contain;
}
.unit-icon.dim {
  filter: grayscale(1) brightness(0.5);
}
.fallback {
  font-weight: 800;
}
.count {
  position: absolute;
  right: -4px;
  bottom: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: #0b0e1c;
  border: 1px solid var(--rc, #888);
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
