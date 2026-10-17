<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import gsap from 'gsap';
import Card from './Card.vue';
import { getCard } from '../game/data/ConfigLoader';
import { assetUrl, getManifest } from '../game/data/AssetManager';
import { AudioManager } from '../game/audio/AudioManager';
import type { Rarity } from '../game/core/types';

const props = defineProps<{
  offer: string[];
  drawCount: number;
  draws: number;
  rerolls: number;
  lucky: boolean;
  countFor: (cardId: string) => number | null;
}>();
const emit = defineEmits<{ pick: [id: string]; reroll: []; info: [id: string]; shake: []; rift: [] }>();

const display = ref<string[]>([]);
const cardEls = ref<HTMLElement[]>([]);
const fxLayer = ref<HTMLElement | null>(null);
const busy = ref(true);
const chosen = ref<number | null>(null);
const cardBack = getManifest()?.ui.card_back ? assetUrl(getManifest()!.ui.card_back) : '';
const RARITY_COLOR: Record<Rarity, string> = {
  COMMON: '#e8ecf6', RARE: '#4aa3ff', EPIC: '#b45cff', LEGENDARY: '#ffc23a', MYTHIC: '#ff3b4e',
};
let pressTimer: number | null = null;
let longPressed = false;
let timeline: gsap.core.Timeline | null = null;

function setEl(el: unknown, i: number) {
  if (el) cardEls.value[i] = el as HTMLElement;
}

async function enter() {
  display.value = [...props.offer];
  chosen.value = null;
  busy.value = true;
  await nextTick();
  timeline?.kill();
  const els = cardEls.value.slice(0, display.value.length);
  timeline = gsap.timeline({
    onComplete: () => {
      busy.value = false;
    },
  });
  els.forEach((el, i) => {
    const inner = el.querySelector('.inner') as HTMLElement;
    gsap.set(el, { opacity: 1, clearProps: 'filter' });
    timeline!.fromTo(
      el,
      { x: 140 + (2 - i) * 40, y: 220, rotate: 18, scale: 0.55, opacity: 0 },
      { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(1.3)', onStart: () => AudioManager.play('draw_flip', { volume: 0.7 }) },
      i * 0.12,
    );
    timeline!.fromTo(inner, { rotateY: 180 }, { rotateY: 0, duration: 0.4, ease: 'power2.out', onComplete: () => reveal(el, display.value[i]) }, i * 0.12 + 0.3);
  });
}

/** 翻牌后的稀有度特效 */
function reveal(el: HTMLElement, cardId: string) {
  const rarity = getCard(cardId).rarity;
  const color = RARITY_COLOR[rarity];
  const n = rarity === 'COMMON' ? 10 : rarity === 'RARE' ? 14 : rarity === 'EPIC' ? 18 : 30;
  burst(el, color, n, rarity === 'LEGENDARY' || rarity === 'MYTHIC' ? 140 : 80);
  el.classList.remove('glow-RARE', 'glow-EPIC', 'glow-LEGENDARY', 'glow-MYTHIC');
  if (rarity !== 'COMMON') el.classList.add(`glow-${rarity}`);
  if (rarity === 'EPIC') lightning(el);
  if (rarity === 'LEGENDARY') {
    AudioManager.play('legend_appear');
    emit('shake');
  }
  if (rarity === 'MYTHIC') {
    AudioManager.play('mythic_appear');
    AudioManager.play('explosion_big', { volume: 0.6 });
    emit('rift');
    emit('shake');
  }
}

function burst(el: HTMLElement, color: string, n: number, dist: number) {
  const layer = fxLayer.value;
  if (!layer) return;
  const lr = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const cx = r.left - lr.left + r.width / 2;
  const cy = r.top - lr.top + r.height / 2;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'spark';
    p.style.background = color;
    p.style.boxShadow = `0 0 8px ${color}`;
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    layer.appendChild(p);
    const a = Math.random() * Math.PI * 2;
    const d = dist * (0.5 + Math.random() * 0.8);
    gsap.to(p, {
      x: Math.cos(a) * d, y: Math.sin(a) * d, opacity: 0, scale: 0.2, duration: 0.6 + Math.random() * 0.4, ease: 'power2.out',
      onComplete: () => p.remove(),
    });
  }
}

function lightning(el: HTMLElement) {
  const layer = fxLayer.value;
  if (!layer) return;
  const lr = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'bolt');
  svg.setAttribute('width', `${r.width + 40}`);
  svg.setAttribute('height', `${r.height + 40}`);
  svg.style.left = `${r.left - lr.left - 20}px`;
  svg.style.top = `${r.top - lr.top - 20}px`;
  for (let k = 0; k < 3; k++) {
    const pts: string[] = [];
    let x = Math.random() * (r.width + 40);
    for (let y = 0; y <= r.height + 40; y += 18) {
      x += (Math.random() - 0.5) * 30;
      pts.push(`${x},${y}`);
    }
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', pts.join(' '));
    svg.appendChild(pl);
  }
  layer.appendChild(svg);
  gsap.fromTo(svg, { opacity: 1 }, { opacity: 0, duration: 0.5, ease: 'steps(5)', onComplete: () => svg.remove() });
}

/** 未被选择的卡牌化为碎片 */
function shatter(el: HTMLElement, cardId: string) {
  const layer = fxLayer.value;
  if (!layer) return;
  const lr = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const color = RARITY_COLOR[getCard(cardId).rarity];
  const cols = 3;
  const rows = 4;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const s = document.createElement('div');
      s.className = 'shard';
      const w = r.width / cols;
      const h = r.height / rows;
      s.style.width = `${w}px`;
      s.style.height = `${h}px`;
      s.style.left = `${r.left - lr.left + i * w}px`;
      s.style.top = `${r.top - lr.top + j * h}px`;
      s.style.background = `linear-gradient(${Math.random() * 360}deg, ${color}, #141a33)`;
      s.style.clipPath = Math.random() < 0.5 ? 'polygon(0 0, 100% 10%, 80% 100%, 5% 85%)' : 'polygon(10% 0, 100% 0, 90% 90%, 0 100%)';
      layer.appendChild(s);
      gsap.to(s, {
        x: (i - 1) * 60 + (Math.random() - 0.5) * 80, y: (j - 1.5) * 50 + 80 + Math.random() * 60, rotate: (Math.random() - 0.5) * 360,
        opacity: 0, scale: 0.4, duration: 0.6, ease: 'power2.in', onComplete: () => s.remove(),
      });
    }
  }
  gsap.set(el, { opacity: 0 });
}

function onPointerDown(i: number) {
  longPressed = false;
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    longPressed = true;
    emit('info', display.value[i]);
  }, 480);
}

function onPointerUp() {
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = null;
}

function choose(i: number) {
  if (longPressed) {
    longPressed = false;
    return;
  }
  if (busy.value || chosen.value !== null) return;
  chosen.value = i;
  busy.value = true;
  const id = display.value[i];
  AudioManager.play('card_pick');
  AudioManager.play('card_shatter', { volume: 0.5 });
  cardEls.value.forEach((el, k) => {
    if (k === i) gsap.to(el, { scale: 1.12, y: -16, duration: 0.25, ease: 'back.out(2)' });
    else shatter(el, display.value[k]);
  });
  burst(cardEls.value[i], RARITY_COLOR[getCard(id).rarity], 16, 90);
  window.setTimeout(() => {
    gsap.to(cardEls.value[i], {
      y: -80, scale: 0.4, opacity: 0, duration: 0.25, ease: 'power2.in',
      onComplete: () => emit('pick', id),
    });
  }, 380);
}

function reroll() {
  if (busy.value || props.rerolls <= 0) return;
  busy.value = true;
  cardEls.value.forEach((el) => gsap.to(el, { y: 160, opacity: 0, rotate: 10, duration: 0.25, ease: 'power2.in' }));
  window.setTimeout(() => emit('reroll'), 260);
}

watch(
  () => props.offer.join('|') + `#${props.drawCount}#${props.rerolls}`,
  () => {
    if (props.offer.length) void enter();
    else display.value = [];
  },
);
onMounted(() => {
  if (props.offer.length) void enter();
});
onBeforeUnmount(() => {
  timeline?.kill();
  if (pressTimer) clearTimeout(pressTimer);
});
</script>

<template>
  <div class="selection">
    <div class="head">
      <div class="progress">
        <span class="label">本回合抽卡</span>
        <span class="count">第 {{ Math.min(drawCount + 1, draws) }} / {{ draws }} 次</span>
        <span class="dots"><i v-for="k in draws" :key="k" :class="{ done: k <= drawCount }" /></span>
      </div>
      <button class="btn small ghost reroll" :disabled="rerolls <= 0 || busy" @click="reroll">🎲 重抽 ×{{ rerolls }}</button>
    </div>
    <div v-if="lucky" class="lucky">✨ 幸运三连！本次选择效果翻倍 ✨</div>
    <div class="cards">
      <div
        v-for="(id, i) in display"
        :key="`${id}-${i}-${drawCount}`"
        :ref="(el) => setEl(el, i)"
        class="slot"
        :class="{ chosen: chosen === i }"
        @click="choose(i)"
        @pointerdown="onPointerDown(i)"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
        @contextmenu.prevent
      >
        <div class="inner">
          <div class="face front">
            <Card :card-id="id" :count="countFor(id)" @info="emit('info', id)" />
          </div>
          <div class="face back" :style="cardBack ? { backgroundImage: `url(${cardBack})` } : {}" />
        </div>
      </div>
    </div>
    <div class="hint">点击选择 · 长按或 ⓘ 查看详情 · 选完 3 次卡牌后自动开战</div>
    <div ref="fxLayer" class="fx-layer" />
  </div>
</template>

<style scoped>
.selection {
  position: relative;
  padding: 8px 10px 10px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.label {
  color: var(--muted);
}
.count {
  font-weight: 800;
  color: var(--gold);
}
.dots {
  display: inline-flex;
  gap: 4px;
}
.dots i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid var(--gold);
}
.dots i.done {
  background: var(--gold);
}
.lucky {
  text-align: center;
  color: var(--gold);
  font-weight: 800;
  font-size: 13px;
  margin-bottom: 4px;
  animation: pulse 0.8s infinite alternate;
}
.cards {
  display: flex;
  justify-content: center;
  gap: clamp(6px, 2vw, 14px);
  perspective: 900px;
  min-height: 150px;
}
.slot {
  width: min(31%, 172px);
  aspect-ratio: 0.68;
  cursor: pointer;
  border-radius: 12px;
  touch-action: manipulation;
}
.inner {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
}
.face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  border-radius: 12px;
}
.back {
  transform: rotateY(180deg);
  background: #241a4a center / cover no-repeat;
  image-rendering: pixelated;
  border: 3px solid #c9a24a;
}
.slot:hover:not(.chosen) .front {
  filter: brightness(1.12);
}
.slot.glow-RARE .front { box-shadow: 0 0 22px 4px rgba(74, 163, 255, 0.55); }
.slot.glow-EPIC .front { box-shadow: 0 0 24px 6px rgba(180, 92, 255, 0.6); }
.slot.glow-LEGENDARY .front { box-shadow: 0 0 30px 8px rgba(255, 194, 58, 0.7); animation: legend 1.2s infinite alternate; }
.slot.glow-MYTHIC .front { box-shadow: 0 0 34px 10px rgba(255, 59, 78, 0.75); animation: mythic 0.6s infinite alternate; }
.slot.chosen .front {
  box-shadow: 0 0 36px 10px rgba(255, 230, 140, 0.85);
}
.hint {
  text-align: center;
  font-size: 11px;
  color: var(--muted);
  margin-top: 6px;
}
.fx-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
:deep(.spark) {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin: -3px 0 0 -3px;
}
:deep(.shard) {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.3);
}
:deep(.bolt) {
  position: absolute;
  pointer-events: none;
}
:deep(.bolt polyline) {
  fill: none;
  stroke: #d9a8ff;
  stroke-width: 3;
  filter: drop-shadow(0 0 6px #b45cff);
}
@keyframes legend {
  from { filter: brightness(1); }
  to { filter: brightness(1.2); }
}
@keyframes mythic {
  from { filter: brightness(1) hue-rotate(0deg); }
  to { filter: brightness(1.25) hue-rotate(-12deg); }
}
@keyframes pulse {
  from { opacity: 0.6; }
  to { opacity: 1; }
}
</style>
