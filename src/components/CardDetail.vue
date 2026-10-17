<script setup lang="ts">
import { computed } from 'vue';
import { getCard, SKILL_MAP, UNIT_MAP } from '../game/data/ConfigLoader';
import { RARITY_NAMES } from '../game/core/types';
import Card from './Card.vue';

const props = defineProps<{ cardId?: string | null; unitId?: string | null }>();
defineEmits<{ close: [] }>();

const card = computed(() => (props.cardId ? getCard(props.cardId) : props.unitId ? getCard(`u_${props.unitId}`) : null));
const unit = computed(() => {
  const id = props.unitId ?? card.value?.unit;
  return id ? UNIT_MAP.get(id) : undefined;
});
const skills = computed(() => (unit.value?.skills ?? []).map((s) => SKILL_MAP.get(s)!).filter(Boolean));
const factionNames: Record<string, string> = {
  human: '人类', elf: '精灵', undead: '亡灵', mech: '机械', elemental: '元素', dragon: '龙族', holy: '神圣', orc: '兽人', demon: '恶魔', nature: '自然',
};
const classNames: Record<string, string> = {
  warrior: '战士', tank: '坦克', knight: '骑士', assassin: '刺客', archer: '弓手', gunner: '枪炮', explosive: '爆破', mage: '法师', legend: '传奇',
};
const targetNames: Record<string, string> = {
  NEAREST: '最近敌人', LOWEST_HP: '最低生命', HIGHEST_HP: '最高生命', BACKLINE: '优先后排', RANDOM: '随机', MOST_DANGEROUS: '最高威胁', AREA_CLUSTER: '最密集敌群',
};
const requirement = computed(() => {
  const r = card.value?.requires;
  if (!r) return '';
  const parts: string[] = [];
  if (r.tags) parts.push(`需要已选择：${r.tags.map((t) => classNames[t] ?? factionNames[t] ?? t).join('、')}类兵种`);
  if (r.cards) parts.push(`需要卡牌：${r.cards.map((c) => getCard(c).name).join('、')}`);
  if (r.minPicks) parts.push(`需要同一兵种卡选择 ${r.minPicks} 次以上`);
  return parts.join('；');
});
</script>

<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div v-if="card" class="detail panel">
      <div class="left">
        <Card :card-id="card.id" :show-info="false" />
      </div>
      <div class="right">
        <h3>{{ card.name }} <span class="r" :class="`rarity-${card.rarity}`">{{ RARITY_NAMES[card.rarity] }}</span></h3>
        <p class="desc">{{ card.description }}</p>
        <p v-if="card.minRound > 1" class="meta">第 {{ card.minRound }} 回合起出现</p>
        <p v-if="requirement" class="meta warn">{{ requirement }}</p>
        <template v-if="unit">
          <div class="tags">
            <span class="chip">{{ factionNames[unit.faction] ?? unit.faction }}</span>
            <span class="chip">{{ classNames[unit.unitClass] ?? unit.unitClass }}</span>
            <span class="chip">{{ unit.role === 'front' ? '前排' : unit.role === 'mid' ? '中排' : '后排' }}</span>
            <span v-if="unit.flying" class="chip">飞行</span>
            <span class="chip">目标：{{ targetNames[unit.targetPriority] }}</span>
          </div>
          <div class="grid">
            <div><b>生命</b>{{ unit.hp }}</div>
            <div><b>攻击</b>{{ unit.attack }}</div>
            <div><b>防御</b>{{ unit.defense }}</div>
            <div><b>攻速</b>{{ unit.attackSpeed }}/秒</div>
            <div><b>移速</b>{{ unit.moveSpeed }}</div>
            <div><b>射程</b>{{ unit.attackRange }}</div>
            <div><b>暴击</b>{{ Math.round(unit.critChance * 100) }}%</div>
            <div><b>暴伤</b>×{{ unit.critDamage }}</div>
            <div><b>穿甲</b>{{ unit.armorPenetration }}</div>
          </div>
          <div v-for="s in skills" :key="s.id" class="skill">
            <div class="sname">
              {{ s.name }}
              <span class="chip">{{ s.trigger === 'active' ? `主动 · ${s.cooldown}秒` : '被动' }}</span>
            </div>
            <div class="sdesc">{{ s.desc }}</div>
          </div>
        </template>
        <button class="btn small" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  gap: 16px;
  padding: 16px;
  width: min(620px, 100%);
  max-height: 88vh;
  overflow-y: auto;
}
.left {
  width: 170px;
  aspect-ratio: 0.68;
  flex: none;
}
.right {
  flex: 1;
  min-width: 0;
}
h3 {
  margin: 0 0 6px;
  font-size: 20px;
}
.r {
  font-size: 12px;
  color: var(--rc);
  border: 1px solid var(--rc);
  border-radius: 6px;
  padding: 1px 6px;
  vertical-align: middle;
}
.desc {
  margin: 0 0 6px;
  color: #d4daf6;
  font-size: 14px;
}
.meta {
  font-size: 12px;
  color: var(--muted);
  margin: 2px 0;
}
.meta.warn {
  color: #ffb070;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 8px 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px 10px;
  font-size: 13px;
  margin-bottom: 8px;
}
.grid b {
  color: var(--muted);
  font-weight: 500;
  margin-right: 6px;
}
.skill {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 6px 8px;
  margin-bottom: 6px;
}
.sname {
  font-weight: 800;
  font-size: 14px;
  display: flex;
  gap: 6px;
  align-items: center;
}
.sdesc {
  font-size: 12px;
  color: #c9cfee;
}
@media (max-width: 560px) {
  .detail {
    flex-direction: column;
    align-items: center;
  }
  .left {
    width: 140px;
  }
}
</style>
