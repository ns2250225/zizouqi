<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useGame } from '../stores/game';
import { usePvp } from '../stores/pvp';
import { useSettings } from '../stores/settings';
import { BattleRenderer, type RendererSettings } from '../game/renderer/BattleRenderer';
import { themeFor } from '../game/core/GameManager';
import { armyPower, armyRoster, buildPlayerArmy, spawnCount } from '../game/cards/CardEffect';
import { emptyArmySpec } from '../game/pvp/PvpMatch';
import { getCard } from '../game/data/ConfigLoader';
import { AudioManager } from '../game/audio/AudioManager';
import type { ArmySpec, BattleOutcome, BattleSetup } from '../game/core/types';
import BattleHUD from '../components/BattleHUD.vue';
import CardSelection from '../components/CardSelection.vue';
import CardDetail from '../components/CardDetail.vue';
import Settings from './Settings.vue';

const game = useGame();
const pvp = usePvp();
const settings = useSettings();

const PVP_UNIT_CAP = 90; // 双方固定，保证战斗模拟输入一致
const host = ref<HTMLElement | null>(null);
const root = ref<HTMLElement | null>(null);
let renderer: BattleRenderer | null = null;
const ready = ref(false);
const loadError = ref('');
const landscape = ref(false);
const detailCard = ref<string | null>(null);
const detailUnit = ref<string | null>(null);
const showSettings = ref(false);
const showMenu = ref(false);

// ---------------------------------------------------------------- 大厅表单
const name = ref(localStorage.getItem('pvp_name') || '');
const joinCode = ref('');
const qrData = ref('');
const copied = ref(false);

const inRoom = computed(() => pvp.phase !== 'idle' && pvp.phase !== 'connecting');
const run = computed(() => pvp.match?.run ?? null);
const phase = computed(() => pvp.phase);
const draftPhase = computed(() => phase.value === 'draft' && !!run.value);
const battlePhase = computed(() => phase.value === 'battle');
const myArmySpec = computed<ArmySpec | null>(() => (run.value ? buildPlayerArmy(run.value) : null));
const power = computed(() => (myArmySpec.value ? armyPower(myArmySpec.value) : 0));
const roster = computed(() => (run.value ? armyRoster(run.value) : []));
const showResultOverlay = computed(() => phase.value === 'roundEnd' || phase.value === 'battle' && !!pvp.localOutcome);
const shareUrl = computed(() => `${location.origin}${location.pathname}?pvp=${pvp.code}`);

const roundWinnerText = computed(() => {
  const w = pvp.lastRoundEnd?.winner;
  if (w == null) return '';
  if (w === 'draw') return '平局';
  const iWon = (pvp.role === 'A' && w === 0) || (pvp.role === 'B' && w === 1);
  return iWon ? '本回合胜利！' : '本回合失败';
});

const finalText = computed(() => {
  const w = pvp.gameOverInfo?.winner;
  if (w == null) return '';
  if (w === 'draw') return '平局';
  const iWon = (pvp.role === 'A' && w === 0) || (pvp.role === 'B' && w === 1);
  return iWon ? '🏆 胜利！' : '💀 战败';
});

const finalReason = computed(() => {
  switch (pvp.gameOverInfo?.reason) {
    case 'disconnect': return '对方掉线超时';
    case 'forfeit': return '对方退出对局';
    default: return '双方生命格决出胜负';
  }
});

// ---------------------------------------------------------------- 渲染器
function rendererSettings(): RendererSettings {
  return { shake: settings.shake, flash: settings.flash, damageNumbers: settings.damageNumbers, quality: settings.quality };
}

function updateLayout() {
  landscape.value = window.innerWidth > window.innerHeight && window.innerWidth >= 820;
}

function refreshPreview() {
  if (!renderer || !myArmySpec.value) return;
  renderer.setTheme(themeFor(pvp.round || 1));
  renderer.showPreview({ seed: 0, round: pvp.round || 1, player: myArmySpec.value, enemy: emptyArmySpec(), unitCap: PVP_UNIT_CAP });
}

function runPvpBattle(setup: BattleSetup, onEnd: (o: BattleOutcome) => void) {
  if (!renderer) return;
  renderer.paused = false;
  renderer.speed = game.speed;
  renderer.setTheme(themeFor(setup.round));
  renderer.startBattle(setup, {
    onLog: (t, team) => game.log(t, team),
    onRage: () => (game.rage = true),
    onTick: (info) => (game.battleInfo = info),
    onEnd,
  });
  AudioManager.play('battle_start');
  AudioManager.playBgm('battle');
}

function countFor(cardId: string): number | null {
  if (!run.value) return null;
  const c = getCard(cardId);
  const e = c.effects.find((x) => x.kind === 'SPAWN');
  if (!e || e.kind !== 'SPAWN') return null;
  return spawnCount(run.value, e.unit, e.count) * (run.value.luckyOffer ? 2 : 1);
}

function cycleSpeed() {
  game.speed = game.speed >= 3 ? 1 : game.speed + 1;
}

// ---------------------------------------------------------------- 邀请
async function copyShare() {
  copied.value = false;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
  } catch {
    const input = document.querySelector<HTMLInputElement>('#share-url');
    input?.select();
    document.execCommand?.('copy');
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 1600);
}

function selectShareUrl(e: Event) {
  (e.target as HTMLInputElement).select();
}

watch(
  () => pvp.phase,
  async (p) => {
    if (p === 'waiting' && !qrData.value) {
      try {
        const QR = await import('qrcode');
        qrData.value = await QR.toDataURL(shareUrl.value, {
          margin: 1,
          width: 240,
          color: { dark: '#0d0f1a', light: '#f2f4fa' },
        });
      } catch {
        qrData.value = '';
      }
    }
  },
);

// ---------------------------------------------------------------- 阶段联动
watch(
  () => pvp.battleData,
  (data) => {
    if (!data) return;
    // 双方使用完全相同的模拟输入：A 军为我方视角（team 0），B 军为敌方（team 1）
    const setup: BattleSetup = {
      seed: data.battleSeed,
      round: data.round,
      player: data.armyA,
      enemy: data.armyB,
      unitCap: PVP_UNIT_CAP,
    };
    game.battleLog = [];
    game.rage = false;
    runPvpBattle(setup, (o) => pvp.reportOutcome(o));
  },
);

watch(
  () => [pvp.round, run.value?.selectedCards.length, run.value?.drawCount],
  () => {
    if (draftPhase.value) refreshPreview();
  },
);
watch(
  () => pvp.phase,
  (p) => {
    game.battleInfo = { time: 0, alive: [0, 0], hp: [0, 0] };
    if (p === 'draft') {
      void nextTick(refreshPreview);
      AudioManager.playBgm('menu');
    } else if (p === 'roundEnd') {
      AudioManager.playBgm('menu');
    } else if (p === 'gameOver') {
      AudioManager.playBgm('menu');
      AudioManager.play('victory', { volume: 0.9 });
    }
  },
);
watch(
  () => [settings.shake, settings.flash, settings.damageNumbers, settings.quality],
  () => renderer?.updateSettings(rendererSettings()),
);
watch(
  () => game.speed,
  (s) => renderer && (renderer.speed = s),
);

onMounted(async () => {
  updateLayout();
  window.addEventListener('resize', updateLayout);
  game.speed = settings.battleSpeed;
  if (pvp.pendingCode) {
    joinCode.value = pvp.pendingCode;
    pvp.pendingCode = '';
  }
  try {
    renderer = await BattleRenderer.create(host.value!, rendererSettings());
    renderer.flip = pvp.flipped;
    ready.value = true;
    refreshPreview();
  } catch (e) {
    console.error(e);
    loadError.value = '图形初始化失败，请确认浏览器支持 WebGL。';
  }
});

watch(
  () => pvp.role,
  () => {
    if (renderer) renderer.flip = pvp.flipped;
    refreshPreview();
  },
);

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateLayout);
  renderer?.destroy();
  renderer = null;
});

// ---------------------------------------------------------------- 动作
function saveName() {
  if (name.value.trim()) localStorage.setItem('pvp_name', name.value.trim());
}

async function create() {
  saveName();
  AudioManager.play('card_pick');
  await pvp.createRoom(name.value.trim() || '指挥官');
}

async function join() {
  saveName();
  const code = joinCode.value.trim().toUpperCase();
  if (!code) return;
  AudioManager.play('card_pick');
  await pvp.joinRoom(code, name.value.trim() || '指挥官');
}

async function exitToMenu() {
  showMenu.value = false;
  await pvp.leave();
  AudioManager.playBgm('menu');
}

function fullscreen() {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement || d.webkitFullscreenElement) {
    (document.exitFullscreen ?? d.webkitExitFullscreen)?.call(document);
  } else {
    (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
  }
}

/** 战斗存活数展示：翻转视角时交换敌我顺序，与屏幕上下对应 */
const aliveView = computed<[number, number]>(() =>
  pvp.flipped ? [game.battleInfo.alive[1], game.battleInfo.alive[0]] : [game.battleInfo.alive[0], game.battleInfo.alive[1]],
);
</script>

<template>
  <div ref="root" class="pvp" :class="{ landscape }">
    <!-- 战场（大厅阶段也在底层，保持渲染器存活） -->
    <main class="stage">
      <BattleHUD
        v-if="inRoom && run"
        position="top" :run="run" :phase="phase === 'draft' ? 'DRAW' : phase === 'battle' ? 'BATTLE' : 'RESULT'"
        :speed="game.speed" :paused="false" :time="game.battleInfo.time" :alive="aliveView" :rage="game.rage"
        :power="power" :synergies="myArmySpec?.synergies ?? []" :combos="myArmySpec?.combos ?? []" :replay="false"
        :top-name="`敌方 · ${pvp.peerName || '等待加入'}`" bottom-name="我方军团"
        @speed="cycleSpeed" @settings="showSettings = true" @menu="showMenu = true" @fullscreen="fullscreen"
      />
      <div class="field">
        <div ref="host" class="canvas-host" />
        <div v-if="!ready && !loadError" class="loading">载入战场…</div>
        <div v-if="loadError" class="loading">{{ loadError }}</div>
        <div v-if="draftPhase && pvp.peerPicks > 0" class="peer-chip">对方已选 {{ pvp.peerPicks }}/3</div>
        <div v-if="draftPhase && run" class="chips">
          <span class="chip army">⚔ 战力 {{ power }} · 全军 {{ roster.reduce((n, r) => n + r.count, 0) }} 人</span>
        </div>
        <Transition name="fade">
          <div v-if="pvp.peerOffline && phase !== 'gameOver'" class="offline">⚠ 对方连接中断，等待重连…</div>
        </Transition>
      </div>
      <BattleHUD
        v-if="inRoom && run"
        position="bottom" :run="run" :phase="phase === 'draft' ? 'DRAW' : phase === 'battle' ? 'BATTLE' : 'RESULT'"
        :speed="game.speed" :paused="false" :time="game.battleInfo.time" :alive="aliveView" :rage="game.rage"
        :power="power" :synergies="myArmySpec?.synergies ?? []" :combos="myArmySpec?.combos ?? []" :replay="false"
      />
      <Transition name="cards">
        <div v-if="draftPhase && run && run.offer.length" class="card-area">
          <CardSelection
            :offer="run.offer" :draw-count="run.drawCount" :draws="3" :rerolls="run.rerolls" :lucky="run.luckyOffer" :count-for="countFor"
            @pick="pvp.pick($event)" @reroll="pvp.reroll()" @info="detailCard = $event" @shake="void 0" @rift="void 0"
          />
          <div v-if="run.drawCount >= 3" class="waiting-battle">军队已提交 · 等待对方…</div>
        </div>
      </Transition>
    </main>

    <!-- 大厅 -->
    <div v-if="!inRoom" class="overlay lobby">
      <div class="panel lobby-panel">
        <h3>⚔ PvP 对战</h3>
        <p class="hint">与好友实时对战：双方从相同的候选卡中构筑军团，在单条战线上决出胜负！</p>
        <div class="label">你的昵称</div>
        <input v-model="name" type="text" maxlength="16" placeholder="指挥官" />
        <template v-if="phase === 'idle'">
          <button class="btn primary" :disabled="!name.trim()" @click="create">创建房间（邀请好友）</button>
          <div class="join-row">
            <input v-model="joinCode" class="code-input" type="text" maxlength="6" placeholder="房间码" @keyup.enter="join" />
            <button class="btn" :disabled="!joinCode.trim() || !name.trim()" @click="join">加入</button>
          </div>
          <button class="btn ghost" @click="game.view = 'menu'">返回主菜单</button>
        </template>
        <template v-else>
          <div class="connecting">连接服务器中…</div>
        </template>
        <div v-if="pvp.error" class="err">{{ pvp.error }} <button class="btn small ghost" @click="pvp.error = ''; pvp.phase = 'idle'">重试</button></div>
      </div>
    </div>

    <!-- 等待玩家加入 -->
    <div v-else-if="phase === 'waiting'" class="overlay">
      <div class="panel lobby-panel">
        <h3>等待对手加入</h3>
        <div class="code-big">{{ pvp.code }}</div>
        <div class="label">把链接或二维码分享给好友，对方打开即可加入对战</div>
        <div class="share-row">
          <input id="share-url" type="text" readonly :value="shareUrl" @focus="selectShareUrl" />
          <button class="btn small" @click="copyShare">{{ copied ? '✓ 已复制' : '复制' }}</button>
        </div>
        <img v-if="qrData" :src="qrData" class="qr" alt="邀请二维码" />
        <div class="pulse">● 等待对方加入…</div>
        <button class="btn ghost" @click="exitToMenu">取消并返回</button>
      </div>
    </div>

    <!-- 回合结算 -->
    <Transition name="fade">
      <div v-if="showResultOverlay && phase !== 'gameOver'" class="overlay result" @click.self="void 0">
        <div class="panel result-panel">
          <template v-if="phase === 'battle'">
            <h3>{{ pvp.localOutcome?.winner === 'draw' ? '⚖ 平局' : ((pvp.role === 'A' && pvp.localOutcome?.winner === 0) || (pvp.role === 'B' && pvp.localOutcome?.winner === 1)) ? '⚔ 本回合胜利！' : '💀 本回合失败' }}</h3>
            <p class="hint">等待对方结算…</p>
          </template>
          <template v-else>
            <h3>{{ roundWinnerText }}</h3>
            <p class="hint">下一回合即将开始…</p>
          </template>
        </div>
      </div>
    </Transition>

    <!-- 对局结束 -->
    <div v-if="phase === 'gameOver'" class="overlay result">
      <div class="panel result-panel">
        <h3 class="final">{{ finalText }}</h3>
        <p class="hint">{{ finalReason }} · 最终生命 {{ pvp.myHp }} : {{ pvp.oppHp }}（我 : 对方）</p>
        <button class="btn primary" :disabled="pvp.rematchMine" @click="pvp.requestRematch()">
          {{ pvp.rematchMine ? '等待对方同意…' : pvp.rematchPeer ? '接受再战！' : '再来一局' }}
        </button>
        <button class="btn ghost" @click="exitToMenu">返回主菜单</button>
      </div>
    </div>

    <CardDetail v-if="detailCard || detailUnit" :card-id="detailCard" :unit-id="detailUnit" @close="detailCard = null; detailUnit = null" />

    <div v-if="showMenu" class="modal-mask" @click.self="showMenu = false">
      <div class="panel menu">
        <h3>PvP 菜单</h3>
        <button class="btn primary" @click="showMenu = false">继续游戏</button>
        <button class="btn" @click="showMenu = false; showSettings = true">游戏设置</button>
        <button class="btn danger" @click="exitToMenu">认输并返回主菜单</button>
      </div>
    </div>
    <div v-if="showSettings" class="modal-mask" @click.self="showSettings = false">
      <div class="settings-modal panel">
        <Settings modal @close="showSettings = false" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pvp {
  position: absolute;
  inset: 0;
  display: flex;
  background: var(--bg);
}
.stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.field {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.canvas-host {
  position: absolute;
  inset: 0;
}
.canvas-host :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
}
.peer-chip {
  position: absolute;
  right: 10px;
  top: 10px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(10, 20, 50, 0.85);
  border: 1px solid rgba(74, 163, 255, 0.5);
  font-size: 12px;
  color: #9fe4ff;
}
.chips {
  position: absolute;
  left: 8px;
  top: 8px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  pointer-events: none;
}
.chips .chip {
  background: rgba(10, 20, 50, 0.85);
  border-color: rgba(255, 210, 58, 0.6);
  color: var(--gold);
}
.offline {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 8px;
  background: rgba(60, 10, 10, 0.9);
  border: 1px solid #ff5a5a;
  color: #ffb0b0;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}
.card-area {
  background: linear-gradient(180deg, rgba(14, 16, 34, 0.96), #0b0d1c);
  border-top: 1px solid var(--line);
  padding-bottom: var(--safe-bottom);
  position: relative;
}
.waiting-battle {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  padding: 4px 0 8px;
  letter-spacing: 2px;
}
.cards-enter-active,
.cards-leave-active {
  transition: transform 0.35s ease, opacity 0.35s;
}
.cards-enter-from,
.cards-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 8, 18, 0.72);
  backdrop-filter: blur(3px);
  z-index: 30;
  padding: 16px;
}
.lobby-panel,
.result-panel {
  width: min(440px, 100%);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 92vh;
  overflow-y: auto;
}
.lobby-panel h3 {
  margin: 0;
  text-align: center;
  font-size: 22px;
}
.hint {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
}
.label {
  font-size: 12px;
  color: var(--muted);
}
input {
  width: 100%;
}
.join-row {
  display: flex;
  gap: 8px;
}
.code-input {
  flex: 1;
  text-transform: uppercase;
  letter-spacing: 4px;
  font-weight: 800;
}
.code-big {
  text-align: center;
  font-size: 44px;
  font-weight: 900;
  letter-spacing: 10px;
  color: var(--gold);
  text-shadow: 0 0 24px rgba(255, 210, 58, 0.4);
  user-select: all;
}
.share-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.share-row input {
  flex: 1;
  font-size: 12px;
}
.qr {
  align-self: center;
  width: 200px;
  height: 200px;
  border-radius: 10px;
  image-rendering: pixelated;
}
.pulse {
  text-align: center;
  color: #6dff8a;
  animation: pulse 1.2s infinite alternate;
}
@keyframes pulse {
  from { opacity: 0.45; }
  to { opacity: 1; }
}
.connecting {
  text-align: center;
  color: var(--muted);
  padding: 12px 0;
}
.err {
  color: #ff6a7a;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.result-panel {
  text-align: center;
}
.result-panel h3 {
  font-size: 26px;
}
.result-panel .final {
  font-size: 40px;
  letter-spacing: 6px;
  color: var(--gold);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.menu {
  width: min(320px, 100%);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.menu h3 {
  margin: 0 0 4px;
  text-align: center;
}
.settings-modal {
  width: min(520px, 100%);
  max-height: 90vh;
  overflow: hidden;
  position: relative;
  display: flex;
}
@media (max-width: 520px) {
  .code-big {
    font-size: 34px;
    letter-spacing: 6px;
  }
}
</style>
