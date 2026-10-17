<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../stores/game';
import { useStats } from '../stores/stats';
import { CARDS, CLASS_SYNERGIES, COMBOS, FACTION_SYNERGIES, UNITS } from '../game/data/ConfigLoader';
import { RARITIES, RARITY_NAMES, type Rarity } from '../game/core/types';
import Card from '../components/Card.vue';
import UnitIcon from '../components/UnitIcon.vue';
import CardDetail from '../components/CardDetail.vue';

const game = useGame();
const stats = useStats();
const tab = computed({ get: () => game.codexTab, set: (v) => (game.codexTab = v) });
const rarity = ref<Rarity | 'ALL'>('ALL');
const faction = ref('ALL');
const category = ref('ALL');
const detailCard = ref<string | null>(null);
const detailUnit = ref<string | null>(null);
const showSyn = ref(false);

const factionNames: Record<string, string> = {
  human: '人类', elf: '精灵', undead: '亡灵', mech: '机械', elemental: '元素', dragon: '龙族', holy: '神圣', orc: '兽人', demon: '恶魔', nature: '自然',
};
const categoryNames: Record<string, string> = {
  unit: '兵种', attack: '攻击', defense: '防御', speed: '攻速', magic: '魔法', summon: '召唤', tactic: '战术', growth: '成长',
};
const units = computed(() =>
  UNITS.filter((u) => !u.summon)
    .filter((u) => rarity.value === 'ALL' || u.rarity === rarity.value)
    .filter((u) => faction.value === 'ALL' || u.faction === faction.value),
);
const summons = computed(() => UNITS.filter((u) => u.summon));
const cards = computed(() =>
  CARDS.filter((c) => rarity.value === 'ALL' || c.rarity === rarity.value).filter((c) => category.value === 'ALL' || c.category === category.value),
);
const seenUnits = computed(() => new Set(stats.seenUnits));
const seenCards = computed(() => new Set(stats.seenCards));
</script>

<template>
  <div class="page">
    <div class="page-header">
      <button class="icon-btn" aria-label="返回" @click="game.view = 'menu'">←</button>
      <h2>{{ tab === 'units' ? '兵种图鉴' : '卡牌图鉴' }}</h2>
      <div class="tabs" style="margin-left: auto">
        <button class="tab" :class="{ active: tab === 'units' }" @click="tab = 'units'">兵种 {{ UNITS.filter((u) => !u.summon).length }}</button>
        <button class="tab" :class="{ active: tab === 'cards' }" @click="tab = 'cards'">卡牌 {{ CARDS.length }}</button>
      </div>
    </div>
    <div class="filters">
      <div class="tabs">
        <button class="tab" :class="{ active: rarity === 'ALL' }" @click="rarity = 'ALL'">全部</button>
        <button v-for="r in RARITIES" :key="r" class="tab" :class="[{ active: rarity === r }, `rarity-${r}`]" :style="{ color: rarity === r ? undefined : 'var(--rc)' }" @click="rarity = r">
          {{ RARITY_NAMES[r] }}
        </button>
      </div>
      <div v-if="tab === 'units'" class="tabs">
        <button class="tab" :class="{ active: faction === 'ALL' }" @click="faction = 'ALL'">全阵营</button>
        <button v-for="(n, k) in factionNames" :key="k" class="tab" :class="{ active: faction === k }" @click="faction = k">{{ n }}</button>
      </div>
      <div v-else class="tabs">
        <button class="tab" :class="{ active: category === 'ALL' }" @click="category = 'ALL'">全类型</button>
        <button v-for="(n, k) in categoryNames" :key="k" class="tab" :class="{ active: category === k }" @click="category = k">{{ n }}</button>
      </div>
      <button class="btn small ghost" @click="showSyn = !showSyn">{{ showSyn ? '收起' : '查看' }}羁绊与组合</button>
    </div>
    <div class="scroll">
      <div v-if="showSyn" class="syn-list">
        <div v-for="s in [...FACTION_SYNERGIES, ...CLASS_SYNERGIES]" :key="s.id" class="syn">
          <b>{{ s.icon }} {{ s.name }}</b><span>{{ s.tiers.join(' / ') }} 种：{{ s.desc }}</span>
        </div>
        <div v-for="c in COMBOS" :key="c.id" class="syn combo" :style="{ borderColor: c.color }">
          <b :style="{ color: c.color }">{{ c.icon }} {{ c.name }}</b><span>{{ c.desc }}</span>
        </div>
      </div>
      <div v-if="tab === 'units'" class="unit-grid">
        <button v-for="u in units" :key="u.id" class="unit-cell" :class="`rarity-${u.rarity}`" @click="detailUnit = u.id">
          <UnitIcon :unit="u.id" :size="56" />
          <div class="un">{{ u.name }}</div>
          <div class="um">{{ factionNames[u.faction] }} · {{ RARITY_NAMES[u.rarity] }}</div>
          <span v-if="!seenUnits.has(u.id)" class="new">未获得</span>
        </button>
        <div class="sub-title">召唤物</div>
        <div v-for="u in summons" :key="u.id" class="unit-cell summon">
          <UnitIcon :unit="u.id" :size="48" />
          <div class="un">{{ u.name }}</div>
          <div class="um">{{ u.desc }}</div>
        </div>
      </div>
      <div v-else class="card-grid">
        <div v-for="c in cards" :key="c.id" class="card-cell" :class="{ unseen: !seenCards.has(c.id) }" @click="detailCard = c.id">
          <Card :card-id="c.id" compact :show-info="false" />
        </div>
      </div>
    </div>
    <CardDetail v-if="detailCard || detailUnit" :card-id="detailCard" :unit-id="detailUnit" @close="detailCard = null; detailUnit = null" />
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}
.filters .tabs {
  flex-wrap: nowrap;
  overflow-x: auto;
}
.filters .tab {
  flex: none;
}
.unit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
}
.unit-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--rc, #888) 40%, transparent);
  background: rgba(255, 255, 255, 0.03);
  text-align: center;
}
.unit-cell.summon {
  cursor: default;
}
.un {
  font-weight: 800;
  font-size: 14px;
}
.um {
  font-size: 11px;
  color: var(--muted);
}
.new {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 9px;
  color: var(--muted);
}
.sub-title {
  grid-column: 1 / -1;
  margin-top: 10px;
  color: var(--muted);
  font-size: 13px;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 10px;
}
.card-cell {
  aspect-ratio: 0.7;
  cursor: pointer;
}
.card-cell.unseen {
  opacity: 0.7;
}
.syn-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 6px;
  margin-bottom: 12px;
}
.syn {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
}
.syn span {
  color: #c9cfee;
}
</style>
