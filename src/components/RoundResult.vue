<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { RoundRecord, RunState } from '../game/core/types';
import { encodeRunCode, roundsWon } from '../game/core/GameManager';
import { scoreRun } from '../stores/stats';
import HealthBar from './HealthBar.vue';
import BattleStats from './BattleStats.vue';
import UnitIcon from './UnitIcon.vue';

const props = defineProps<{ run: RunState; loss: { player: number; enemy: number }; autoNext: boolean }>();
const emit = defineEmits<{ next: []; replay: [rec: RoundRecord]; menu: []; restart: [] }>();

const outcome = computed(() => props.run.lastOutcome!);
const over = computed(() => props.run.phase === 'GAME_OVER');
const showStats = ref(false);
const countdown = ref(props.autoNext && !over.value ? 4 : 0);
const copied = ref(false);
let timer: number | null = null;

const title = computed(() => {
  if (over.value) {
    if (props.run.mode === 'endless') return '无尽征途结束';
    return props.run.result === 'win' ? '最终胜利！' : props.run.result === 'lose' ? '最终失败' : '同归于尽';
  }
  const w = outcome.value.winner;
  return w === 0 ? '回合胜利' : w === 1 ? '回合失败' : '平局';
});
const cls = computed(() => {
  if (over.value) return props.run.result === 'win' ? 'win' : props.run.result === 'lose' ? 'lose' : 'draw';
  const w = outcome.value.winner;
  return w === 0 ? 'win' : w === 1 ? 'lose' : 'draw';
});
const reason = computed(() => {
  const o = outcome.value;
  if (o.reason === 'timeout') return `90 秒超时，按剩余生命比例判定（${Math.round(o.hpRatio[0] * 100)}% : ${Math.round(o.hpRatio[1] * 100)}%）`;
  if (o.reason === 'draw') return '双方同时全军覆没';
  return o.winner === 0 ? '敌方部队已被全部消灭' : '我方部队已被全部消灭';
});
const lastRecord = computed(() => props.run.rounds[props.run.rounds.length - 1]);
const code = computed(() => encodeRunCode(props.run.mode, props.run.difficulty, props.run.runSeed, props.run.dailyModifier));
const score = computed(() => (props.run.mode === 'endless' ? roundsWon(props.run) * 100 + props.run.totalKills : scoreRun(props.run)));

async function copyCode() {
  try {
    await navigator.clipboard.writeText(code.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

onMounted(() => {
  if (countdown.value > 0) {
    timer = window.setInterval(() => {
      countdown.value--;
      if (countdown.value <= 0) {
        if (timer) clearInterval(timer);
        emit('next');
      }
    }, 1000);
  }
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
function stopAuto() {
  if (timer) clearInterval(timer);
  countdown.value = 0;
}
</script>

<template>
  <div class="modal-mask" @click="stopAuto">
    <div class="result panel" :class="cls">
      <div class="banner">{{ title }}</div>
      <div class="reason">{{ reason }} · 用时 {{ Math.round(outcome.time) }} 秒</div>
      <div class="hps">
        <div>
          <div class="lbl">我方生命 <span v-if="loss.player" class="minus">-{{ loss.player }}</span></div>
          <HealthBar team="player" :hp="run.playerHp" :max="run.maxHp" />
        </div>
        <div>
          <div class="lbl">敌方生命 <span v-if="loss.enemy && run.mode !== 'endless'" class="minus">-{{ loss.enemy }}</span></div>
          <HealthBar team="enemy" :hp="run.enemyHp" :max="run.maxHp" :infinite="run.mode === 'endless'" />
        </div>
      </div>
      <div v-if="outcome.topUnit" class="mvp">
        <UnitIcon :unit="outcome.topUnit.unit" :size="44" />
        <div>
          <div class="lbl">本回合最高伤害</div>
          <div class="mvp-name">{{ outcome.topUnit.name }} · {{ Math.round(outcome.topUnit.damage) }} 伤害</div>
        </div>
        <div class="kills">击杀 <b>{{ outcome.kills[0] }}</b> / 阵亡 <b>{{ outcome.kills[1] }}</b></div>
      </div>
      <button class="btn small ghost" @click.stop="showStats = !showStats">{{ showStats ? '收起' : '查看' }}详细战斗统计</button>
      <BattleStats v-if="showStats" :outcome="outcome" />

      <div v-if="over" class="final">
        <div class="score">得分 <b>{{ score }}</b> · 共 {{ run.round }} 回合 · 胜 {{ roundsWon(run) }} · 击杀 {{ run.totalKills }}</div>
        <div class="code">
          <span>对局码：</span><code>{{ code }}</code>
          <button class="btn small ghost" @click.stop="copyCode">{{ copied ? '已复制' : '复制分享' }}</button>
        </div>
      </div>

      <div class="buttons">
        <button v-if="lastRecord" class="btn ghost" @click.stop="emit('replay', lastRecord)">🎬 回放</button>
        <template v-if="!over">
          <button class="btn primary" @click.stop="emit('next')">下一回合<template v-if="countdown > 0">（{{ countdown }}）</template></button>
        </template>
        <template v-else>
          <button class="btn" @click.stop="emit('menu')">主菜单</button>
          <button class="btn primary" @click.stop="emit('restart')">再来一局</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result {
  width: min(440px, 100%);
  padding: 18px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 92vh;
  overflow-y: auto;
  animation: pop 0.35s cubic-bezier(0.2, 1.6, 0.4, 1);
}
.banner {
  text-align: center;
  font-size: 30px;
  font-weight: 900;
  letter-spacing: 6px;
}
.win .banner {
  color: var(--gold);
  text-shadow: 0 0 18px rgba(255, 210, 58, 0.6), 0 3px 0 #5a3a00;
}
.lose .banner {
  color: #ff5a6a;
  text-shadow: 0 3px 0 #4a0010;
}
.draw .banner {
  color: #c9cfee;
}
.win {
  border-color: rgba(255, 210, 58, 0.6);
}
.reason {
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}
.hps {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.lbl {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 3px;
}
.minus {
  color: #ff5a6a;
  font-weight: 900;
  font-size: 14px;
  animation: pop 0.5s;
}
.mvp {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 8px;
}
.mvp-name {
  font-weight: 800;
  font-size: 14px;
}
.kills {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
  text-align: right;
}
.final {
  background: rgba(255, 210, 58, 0.06);
  border: 1px solid rgba(255, 210, 58, 0.25);
  border-radius: 8px;
  padding: 8px;
  font-size: 13px;
}
.score b {
  color: var(--gold);
  font-size: 18px;
}
.code {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
code {
  font-size: 11px;
  word-break: break-all;
  user-select: all;
  -webkit-user-select: all;
  background: #0b0e1c;
  padding: 3px 6px;
  border-radius: 4px;
  max-width: 220px;
}
.buttons {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.buttons .btn {
  flex: 1;
  min-width: 110px;
}
@keyframes pop {
  from { transform: scale(0.8); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
</style>
