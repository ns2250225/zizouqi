<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useGame } from '../stores/game';
import { useStats } from '../stores/stats';
import { BALANCE, UNITS } from '../game/data/ConfigLoader';
import { dailySeed, decodeRunCode } from '../game/core/GameManager';
import { unitImage } from '../game/data/AssetManager';
import { AudioManager } from '../game/audio/AudioManager';
import type { GameMode } from '../game/core/types';

const game = useGame();
const stats = useStats();
const showNew = ref(false);
const mode = ref<GameMode>('standard');
const difficulty = ref('normal');
const code = ref('');
const codeError = ref('');
const daily = dailySeed();
const dailyMod = computed(() => BALANCE.dailyModifiers.find((d) => d.id === daily.modifier));
const dailyDone = computed(() => stats.leaderboard.some((e) => e.mode === 'daily' && e.dailyKey === daily.key));

// 主菜单背景：双方兵种在单战线上行进
const marchers = ref<{ id: string; src: string; left: number; delay: number; dur: number; enemy: boolean }[]>([]);
onMounted(() => {
  const pool = UNITS.filter((u) => !u.summon);
  marchers.value = Array.from({ length: 14 }, (_, i) => {
    const u = pool[Math.floor(Math.random() * pool.length)];
    return { id: `${u.id}-${i}`, src: unitImage(u.id), left: 30 + Math.random() * 40, delay: -Math.random() * 8, dur: 7 + Math.random() * 5, enemy: i % 2 === 1 };
  });
});

function click(fn: () => void) {
  AudioManager.play('click');
  fn();
}

function open(view: 'codex' | 'stats' | 'settings' | 'credits', tab?: 'units' | 'cards') {
  click(() => {
    if (tab) game.codexTab = tab;
    game.view = view;
  });
}

function start() {
  codeError.value = '';
  let seed: number | undefined;
  let m = mode.value;
  let d = difficulty.value;
  let x: string | null = null;
  if (code.value.trim()) {
    const parsed = decodeRunCode(code.value);
    if (!parsed) {
      codeError.value = '对局码无效';
      return;
    }
    seed = parsed.seed;
    m = parsed.mode === 'daily' ? 'standard' : parsed.mode;
    d = parsed.difficulty;
    x = parsed.daily;
  }
  AudioManager.play('card_pick');
  showNew.value = false;
  game.newGame(m, d, seed, x);
}

async function continueGame() {
  AudioManager.play('card_pick');
  await game.continueGame();
}

onBeforeUnmount(() => (marchers.value = []));
</script>

<template>
  <div class="menu-page">
    <div class="lane">
      <img v-for="m in marchers" :key="m.id" :src="m.src" class="marcher pixel" :class="{ enemy: m.enemy }"
        :style="{ left: `${m.left}%`, animationDelay: `${m.delay}s`, animationDuration: `${m.dur}s` }" draggable="false" alt="" />
    </div>
    <div class="content">
      <div class="logo">
        <div class="sub">策略抽卡 · 自走棋 · 肉鸽</div>
        <h1>一线决战</h1>
        <div class="tagline">三选一构筑你的军团，在单条战线上决一死战</div>
      </div>
      <div class="buttons">
        <button class="btn primary big" @click="click(() => (showNew = true))">开始游戏</button>
        <button class="btn pvp" @click="click(() => (game.view = 'pvp'))">⚔ PvP 对战 · 好友邀请</button>
        <button class="btn" :disabled="!game.hasSave" @click="continueGame">继续游戏</button>
        <div class="row">
          <button class="btn" @click="open('codex', 'units')">兵种图鉴</button>
          <button class="btn" @click="open('codex', 'cards')">卡牌图鉴</button>
        </div>
        <div class="row">
          <button class="btn" @click="open('stats')">战绩统计</button>
          <button class="btn" @click="open('settings')">游戏设置</button>
        </div>
        <button class="btn ghost" @click="open('credits')">制作人员与素材授权</button>
      </div>
      <div class="foot">60 种兵种 · 100 张卡牌 · 素材均为 CC0 授权并已本地化</div>
    </div>

    <div v-if="showNew" class="modal-mask" @click.self="showNew = false">
      <div class="panel new-game">
        <h3>新的征程</h3>
        <div class="label">游戏模式</div>
        <div class="modes">
          <button class="mode" :class="{ active: mode === 'standard' }" @click="mode = 'standard'">
            <b>⚔ 标准模式</b><span>双方 8 格生命，敌军逐回合增强，先击溃敌方者胜</span>
          </button>
          <button class="mode" :class="{ active: mode === 'endless' }" @click="mode = 'endless'">
            <b>♾ 无尽模式</b><span>敌军无限，每回合强度为上回合的 1.5 倍，挑战最多胜利回合</span>
          </button>
          <button class="mode" :class="{ active: mode === 'daily' }" @click="mode = 'daily'">
            <b>📅 每日挑战</b><span>{{ daily.key }} · {{ dailyMod?.name }}：{{ dailyMod?.desc }}<template v-if="dailyDone">（今日已完成）</template></span>
          </button>
        </div>
        <div class="label">难度</div>
        <div class="tabs">
          <button v-for="d in BALANCE.difficulties" :key="d.id" class="tab" :class="{ active: difficulty === d.id }" :title="d.desc" @click="difficulty = d.id">
            {{ d.name }}
          </button>
        </div>
        <div class="diff-desc">{{ BALANCE.difficulties.find((d) => d.id === difficulty)?.desc }}</div>
        <div class="label">对局码（可选，输入好友分享的对局码以相同种子开局）</div>
        <input v-model="code" type="text" placeholder="留空则随机生成" />
        <div v-if="codeError" class="err">{{ codeError }}</div>
        <div class="actions">
          <button class="btn ghost" @click="showNew = false">取消</button>
          <button class="btn primary" @click="start">出征！</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-page {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(255, 74, 90, 0.25), transparent 55%),
    radial-gradient(ellipse at 50% 100%, rgba(74, 163, 255, 0.25), transparent 55%),
    var(--bg);
  overflow: hidden;
}
.lane {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: min(360px, 80vw);
  transform: translateX(-50%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.04) 20%, rgba(255, 255, 255, 0.04) 80%, transparent);
  opacity: 0.55;
}
.marcher {
  position: absolute;
  width: 40px;
  height: 40px;
  bottom: -50px;
  animation: march-up linear infinite;
}
.marcher.enemy {
  top: -50px;
  bottom: auto;
  animation-name: march-down;
  filter: drop-shadow(0 0 4px rgba(255, 74, 90, 0.8));
}
@keyframes march-up {
  from { transform: translateY(0); }
  to { transform: translateY(calc(-100vh - 100px)); }
}
@keyframes march-down {
  from { transform: translateY(0) scaleX(-1); }
  to { transform: translateY(calc(100vh + 100px)) scaleX(-1); }
}
.content {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: calc(20px + var(--safe-top)) 16px calc(20px + var(--safe-bottom));
}
.logo {
  text-align: center;
}
.logo h1 {
  margin: 4px 0;
  font-size: clamp(44px, 12vw, 76px);
  font-weight: 900;
  letter-spacing: 10px;
  background: linear-gradient(180deg, #fff6c8, #ffc23a 55%, #c8701a);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 4px 0 #3a1c00) drop-shadow(0 0 22px rgba(255, 194, 58, 0.35));
}
.sub {
  color: var(--muted);
  letter-spacing: 4px;
  font-size: 13px;
}
.tagline {
  color: #c9cfee;
  font-size: 14px;
}
.buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(340px, 100%);
}
.btn.big {
  min-height: 56px;
  font-size: 20px;
}
.row {
  display: flex;
  gap: 10px;
}
.row .btn {
  flex: 1;
}
.foot {
  font-size: 11px;
  color: var(--muted);
  text-align: center;
}
.new-game {
  width: min(460px, 100%);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 92vh;
  overflow-y: auto;
}
.new-game h3 {
  margin: 0;
  text-align: center;
  font-size: 20px;
}
.label {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
}
.modes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mode {
  text-align: left;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mode span {
  font-size: 12px;
  color: var(--muted);
}
.mode.active {
  border-color: var(--gold);
  background: rgba(255, 210, 58, 0.1);
}
.diff-desc {
  font-size: 12px;
  color: #c9cfee;
}
.err {
  color: #ff6a7a;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.actions .btn {
  flex: 1;
}
</style>
