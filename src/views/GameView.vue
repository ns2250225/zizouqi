<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useGame } from '../stores/game';
import { useSettings } from '../stores/settings';
import { BattleRenderer, type RendererSettings } from '../game/renderer/BattleRenderer';
import { buildBattleSetup, themeFor } from '../game/core/GameManager';
import { armyPower, armyRoster, buildPlayerArmy, spawnCount } from '../game/cards/CardEffect';
import UnitIcon from '../components/UnitIcon.vue';
import { getCard } from '../game/data/ConfigLoader';
import { AudioManager } from '../game/audio/AudioManager';
import type { BattleSetup, RoundRecord } from '../game/core/types';
import BattleHUD from '../components/BattleHUD.vue';
import CardSelection from '../components/CardSelection.vue';
import CardDetail from '../components/CardDetail.vue';
import EnemyPreview from '../components/EnemyPreview.vue';
import RoundResult from '../components/RoundResult.vue';
import Settings from './Settings.vue';

const game = useGame();
const settings = useSettings();
const run = computed(() => game.run!);
const host = ref<HTMLElement | null>(null);
const root = ref<HTMLElement | null>(null);
let renderer: BattleRenderer | null = null;
const ready = ref(false);
const loadError = ref('');
const landscape = ref(false);
const countdown = ref(0);
let countdownTimer: number | null = null;
const detailCard = ref<string | null>(null);
const detailUnit = ref<string | null>(null);
const showSettings = ref(false);
const showMenu = ref(false);
const comboBanner = ref<{ name: string; color: string; id: number } | null>(null);
const rift = ref(false);

const army = computed(() => (game.run ? buildPlayerArmy(game.run) : { synergies: [], combos: [], units: [], mods: [], flags: {}, spells: [], statMult: 1 }));
const roster = computed(() => (game.run ? armyRoster(game.run) : []));
const rosterTotal = computed(() => roster.value.reduce((n, r) => n + r.count, 0));
const rosterFresh = computed(() => roster.value.reduce((n, r) => n + r.fresh, 0));
const power = computed(() => (game.run ? armyPower(army.value) : 0));
const phase = computed(() => game.run?.phase ?? 'DRAW');
const drawing = computed(() => phase.value === 'DRAW' && !game.replay);
const showResult = computed(() => (phase.value === 'RESULT' || phase.value === 'GAME_OVER') && !game.replay && !!game.run?.lastOutcome);
const roundCards = computed(() => {
  const map = new Map<string, number>();
  for (const id of game.run?.selectedCards ?? []) map.set(id, (map.get(id) ?? 0) + 1);
  return [...map.entries()].map(([id, n]) => ({ id, n, card: getCard(id) }));
});

function rendererSettings(): RendererSettings {
  return { shake: settings.shake, flash: settings.flash, damageNumbers: settings.damageNumbers, quality: settings.quality };
}

function updateLayout() {
  landscape.value = window.innerWidth > window.innerHeight && window.innerWidth >= 820;
}

function countFor(cardId: string): number | null {
  const c = getCard(cardId);
  const e = c.effects.find((x) => x.kind === 'SPAWN');
  if (!e || e.kind !== 'SPAWN') return null;
  return spawnCount(run.value, e.unit, e.count) * (run.value.luckyOffer ? 2 : 1);
}

function refreshPreview() {
  if (!renderer || !game.run) return;
  renderer.setTheme(themeFor(run.value.round));
  renderer.showPreview(buildBattleSetup(run.value, renderer.unitCap));
}

function startCountdown() {
  stopCountdown();
  countdown.value = 3;
  AudioManager.play('tick');
  countdownTimer = window.setInterval(() => {
    countdown.value--;
    if (countdown.value > 0) AudioManager.play('tick');
    else {
      stopCountdown();
      startBattle();
    }
  }, 1000);
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  countdown.value = 0;
}

function callbacks(onEnd: (o: import('../game/core/types').BattleOutcome) => void) {
  return {
    onLog: (t: string, team: 0 | 1) => game.log(t, team),
    onCombo: (name: string, color: string) => {
      comboBanner.value = { name, color, id: Date.now() };
      setTimeout(() => (comboBanner.value = null), 1800);
    },
    onRage: () => {
      game.rage = true;
    },
    onTick: (info: { time: number; alive: [number, number]; hp: [number, number] }) => {
      game.battleInfo = info;
    },
    onEnd,
  };
}

function runBattle(setup: BattleSetup, onEnd: (o: import('../game/core/types').BattleOutcome) => void) {
  if (!renderer) return;
  game.rage = false;
  game.paused = false;
  renderer.paused = false;
  renderer.speed = game.speed;
  renderer.setTheme(themeFor(setup.round));
  renderer.startBattle(setup, callbacks(onEnd));
  AudioManager.play('battle_start');
  AudioManager.playBgm('battle');
}

function startBattle() {
  if (!renderer) return;
  const setup = game.beginBattle(renderer.unitCap);
  if (!setup) return;
  runBattle(setup, (o) => {
    game.finishBattle(o);
    AudioManager.playBgm('menu');
  });
}

function enterPhase() {
  if (!renderer || !game.run) return;
  stopCountdown();
  switch (phase.value) {
    case 'DRAW':
      refreshPreview();
      AudioManager.playBgm('menu');
      break;
    case 'PREPARE':
      refreshPreview();
      startCountdown();
      break;
    case 'BATTLE':
      startBattle();
      break;
    default:
      break;
  }
}

function onPick(id: string) {
  game.pick(id);
}

function cycleSpeed() {
  game.speed = game.speed >= 3 ? 1 : game.speed + 1;
}

function togglePause() {
  game.paused = !game.paused;
}

function onReplay(rec: RoundRecord) {
  game.startReplay(rec);
  runBattle(rec.setup, () => {
    game.stopReplay();
    game.toast('回放结束', '#9fe4ff');
    AudioManager.playBgm('menu');
  });
}

function shakeScreen() {
  const el = root.value;
  if (!el || !settings.shake) return;
  el.classList.remove('shaking');
  void el.offsetWidth;
  el.classList.add('shaking');
}

function onRift() {
  rift.value = true;
  setTimeout(() => (rift.value = false), 1400);
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

function restart() {
  const r = run.value;
  game.newGame(r.mode, r.difficulty);
}

async function abandon() {
  showMenu.value = false;
  await game.abandon();
}

function exitToMenu() {
  showMenu.value = false;
  game.toMenu();
  AudioManager.playBgm('menu');
}

watch(phase, () => {
  game.battleInfo = { time: 0, alive: [0, 0], hp: [0, 0] };
  void nextTick(enterPhase);
});
watch(
  () => game.run?.selectedCards.length,
  () => {
    if (phase.value === 'DRAW') refreshPreview();
  },
);
watch(
  () => game.run?.round,
  () => refreshPreview(),
);
watch(
  () => [settings.shake, settings.flash, settings.damageNumbers, settings.quality],
  () => renderer?.updateSettings(rendererSettings()),
);
watch(
  () => game.speed,
  (s) => renderer && (renderer.speed = s),
);
watch(
  () => game.paused,
  (p) => renderer && (renderer.paused = p),
);

onMounted(async () => {
  updateLayout();
  window.addEventListener('resize', updateLayout);
  game.speed = settings.battleSpeed;
  try {
    renderer = await BattleRenderer.create(host.value!, rendererSettings());
    ready.value = true;
    enterPhase();
  } catch (e) {
    console.error(e);
    loadError.value = '图形初始化失败，请确认浏览器支持 WebGL。';
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateLayout);
  stopCountdown();
  renderer?.destroy();
  renderer = null;
});
</script>

<template>
  <div ref="root" class="game" :class="{ landscape, battle: !drawing }">
    <aside v-if="landscape" class="side-left">
      <EnemyPreview v-if="run.enemyPlan" :plan="run.enemyPlan" @unit="detailUnit = $event" />
      <div class="panel round-army">
        <div class="ttl">本回合阵容</div>
        <div v-if="!roundCards.length" class="muted">尚未选择卡牌</div>
        <div v-for="c in roundCards" :key="c.id" class="army-row" @click="detailCard = c.id">
          <span>{{ c.card.icon }}</span><span>{{ c.card.name }}</span><span v-if="c.n > 1" class="muted">×{{ c.n }}</span>
        </div>
        <div class="ttl perm">全军编制 · {{ rosterTotal }} 人<span v-if="rosterFresh" class="fresh">（本回合 +{{ rosterFresh }}）</span></div>
        <div class="roster">
          <UnitIcon v-for="r in roster" :key="r.unit" :unit="r.unit" :count="r.count" :size="34" :class="{ isfresh: r.fresh > 0 }" @click="detailUnit = r.unit" />
        </div>
        <div v-if="run.permanentBuffs.length" class="ttl perm">永久成长 · {{ run.permanentBuffs.length }}</div>
        <div class="perm-list">
          <span v-for="(id, i) in run.permanentBuffs" :key="id + i" class="chip" @click="detailCard = id">{{ getCard(id).icon }} {{ getCard(id).name }}</span>
        </div>
      </div>
      <div v-if="!drawing && settings.showLog" class="panel log-panel">
        <div class="ttl">战斗信息</div>
        <div v-for="l in game.battleLog" :key="l.id" class="log" :class="l.team === 0 ? 'p' : 'e'">{{ l.text }}</div>
      </div>
    </aside>

    <main class="center">
      <BattleHUD
        position="top" :run="run" :phase="phase" :speed="game.speed" :paused="game.paused" :time="game.battleInfo.time"
        :alive="game.battleInfo.alive" :rage="game.rage" :power="power" :synergies="army.synergies" :combos="army.combos" :replay="!!game.replay"
        @pause="togglePause" @speed="cycleSpeed" @settings="showSettings = true" @menu="showMenu = true" @fullscreen="fullscreen"
      />
      <div class="field">
        <div ref="host" class="canvas-host" />
        <div v-if="!ready && !loadError" class="loading">载入战场…</div>
        <div v-if="loadError" class="loading">{{ loadError }}</div>
        <EnemyPreview v-if="!landscape && drawing && run.enemyPlan" class="enemy-overlay" :plan="run.enemyPlan" compact @unit="detailUnit = $event" />
        <div v-if="!landscape && (drawing || phase === 'PREPARE') && (roundCards.length || rosterTotal)" class="added">
          <span class="chip army">🛡 全军 {{ rosterTotal }} 人<template v-if="rosterFresh"> · 本回合 +{{ rosterFresh }}</template></span>
          <span v-for="c in roundCards" :key="c.id" class="chip">{{ c.card.icon }} {{ c.card.name }}<template v-if="c.n > 1"> ×{{ c.n }}</template></span>
        </div>
        <div v-if="!landscape && !drawing && settings.showLog" class="log-overlay">
          <TransitionGroup name="log">
            <div v-for="l in game.battleLog" :key="l.id" class="log" :class="l.team === 0 ? 'p' : 'e'">{{ l.text }}</div>
          </TransitionGroup>
        </div>
        <Transition name="cd">
          <div v-if="countdown > 0" :key="countdown" class="countdown">{{ countdown }}</div>
        </Transition>
        <div v-if="phase === 'PREPARE' && countdown > 0" class="prepare-tip">即将开战</div>
        <Transition name="combo">
          <div v-if="comboBanner" :key="comboBanner.id" class="combo-banner" :style="{ color: comboBanner.color, borderColor: comboBanner.color }">
            组合进化 · {{ comboBanner.name }}
          </div>
        </Transition>
        <div v-if="game.paused" class="paused" @click="togglePause">⏸ 已暂停 · 点击继续</div>
        <div v-if="game.replay" class="replay-tag">🎬 回放第 {{ game.replay.round }} 回合 <button class="btn small ghost" @click="game.stopReplay(); refreshPreview()">退出</button></div>
      </div>
      <BattleHUD
        v-if="!landscape || !drawing"
        position="bottom" :run="run" :phase="phase" :speed="game.speed" :paused="game.paused" :time="game.battleInfo.time"
        :alive="game.battleInfo.alive" :rage="game.rage" :power="power" :synergies="army.synergies" :combos="army.combos" :replay="!!game.replay"
      />
      <Transition name="cards">
        <div v-if="!landscape && drawing && run.offer.length" class="card-area">
          <CardSelection
            :offer="run.offer" :draw-count="run.drawCount" :draws="3" :rerolls="run.rerolls" :lucky="run.luckyOffer" :count-for="countFor"
            @pick="onPick" @reroll="game.reroll()" @info="detailCard = $event" @shake="shakeScreen" @rift="onRift"
          />
        </div>
      </Transition>
    </main>

    <aside v-if="landscape" class="side-right">
      <BattleHUD
        v-if="drawing"
        position="bottom" :run="run" :phase="phase" :speed="game.speed" :paused="game.paused" :time="0"
        :alive="[0, 0]" :rage="false" :power="power" :synergies="army.synergies" :combos="army.combos" :replay="false"
      />
      <CardSelection
        v-if="drawing && run.offer.length"
        :offer="run.offer" :draw-count="run.drawCount" :draws="3" :rerolls="run.rerolls" :lucky="run.luckyOffer" :count-for="countFor"
        @pick="onPick" @reroll="game.reroll()" @info="detailCard = $event" @shake="shakeScreen" @rift="onRift"
      />
      <div v-else class="panel waiting">
        <template v-if="phase === 'PREPARE'">卡牌已选择完毕，准备开战！</template>
        <template v-else-if="phase === 'BATTLE' || game.replay">自动战斗进行中…</template>
        <template v-else-if="phase === 'DRAW'">
          <button class="btn primary" @click="game.nextRound()">开始下一回合</button>
        </template>
        <template v-else>等待下一回合</template>
      </div>
    </aside>

    <div v-if="rift" class="rift" />

    <RoundResult
      v-if="showResult" :key="`${run.round}-${phase}`" :run="run" :loss="game.lastLoss" :auto-next="settings.autoNext"
      @next="game.nextRound()" @replay="onReplay" @menu="exitToMenu" @restart="restart"
    />
    <CardDetail v-if="detailCard || detailUnit" :card-id="detailCard" :unit-id="detailUnit" @close="detailCard = null; detailUnit = null" />

    <div v-if="showMenu" class="modal-mask" @click.self="showMenu = false">
      <div class="panel menu">
        <h3>游戏菜单</h3>
        <button class="btn primary" @click="showMenu = false">继续游戏</button>
        <button class="btn" @click="showMenu = false; showSettings = true">游戏设置</button>
        <button class="btn" @click="exitToMenu">保存并返回主菜单</button>
        <button class="btn danger" @click="abandon">放弃本局</button>
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
.game {
  position: absolute;
  inset: 0;
  display: flex;
  background: var(--bg);
}
.center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.landscape .center {
  flex: none;
  width: min(62vh, 560px);
  border-left: 1px solid var(--line);
  border-right: 1px solid var(--line);
}
.side-left,
.side-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: calc(10px + var(--safe-top)) 12px calc(10px + var(--safe-bottom));
  overflow-y: auto;
}
.side-right {
  justify-content: center;
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
.enemy-overlay {
  position: absolute;
  left: 8px;
  top: 8px;
  max-width: calc(100% - 16px);
}
.added {
  position: absolute;
  left: 8px;
  bottom: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  pointer-events: none;
}
.added .chip {
  background: rgba(10, 20, 50, 0.85);
  border-color: rgba(74, 163, 255, 0.5);
}
.log-overlay {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  pointer-events: none;
  max-width: 70%;
}
.log {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(8, 10, 22, 0.75);
  border-left: 3px solid var(--player);
}
.log.e {
  border-left-color: var(--enemy);
}
.log-enter-active,
.log-leave-active {
  transition: all 0.25s;
}
.log-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}
.log-leave-to {
  opacity: 0;
}
.countdown {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 96px;
  font-weight: 900;
  color: var(--gold);
  text-shadow: 0 0 30px rgba(255, 210, 58, 0.8), 0 6px 0 #5a3a00;
  pointer-events: none;
}
.prepare-tip {
  position: absolute;
  left: 0;
  right: 0;
  top: 32%;
  text-align: center;
  font-weight: 800;
  letter-spacing: 6px;
  color: #fff;
  text-shadow: 0 2px 8px #000;
}
.cd-enter-active {
  transition: all 0.35s cubic-bezier(0.2, 1.8, 0.4, 1);
}
.cd-enter-from {
  transform: translate(-50%, -50%) scale(2.2);
  opacity: 0;
}
.cd-leave-active {
  transition: all 0.2s;
  position: absolute;
}
.cd-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.6);
}
.combo-banner {
  position: absolute;
  top: 38%;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 22px;
  border: 2px solid;
  border-radius: 10px;
  background: rgba(8, 10, 22, 0.88);
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 3px;
  white-space: nowrap;
  box-shadow: 0 0 30px currentColor;
  pointer-events: none;
}
.combo-enter-active,
.combo-leave-active {
  transition: all 0.4s;
}
.combo-enter-from {
  opacity: 0;
  transform: translateX(-50%) scale(1.8);
}
.combo-leave-to {
  opacity: 0;
}
.paused {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  font-size: 18px;
  font-weight: 800;
  cursor: pointer;
}
.replay-tag {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  align-items: center;
  background: rgba(8, 10, 22, 0.85);
  padding: 4px 4px 4px 12px;
  border-radius: 8px;
  font-size: 13px;
}
.card-area {
  background: linear-gradient(180deg, rgba(14, 16, 34, 0.96), #0b0d1c);
  border-top: 1px solid var(--line);
  padding-bottom: var(--safe-bottom);
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
.round-army,
.log-panel,
.waiting {
  padding: 10px;
}
.waiting {
  text-align: center;
  color: var(--muted);
  padding: 24px;
}
.ttl {
  font-size: 13px;
  font-weight: 800;
  margin-bottom: 6px;
}
.ttl.perm {
  margin-top: 10px;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.army-row {
  display: flex;
  gap: 6px;
  font-size: 13px;
  padding: 3px 0;
  cursor: pointer;
}
.fresh {
  color: var(--good);
  font-weight: 500;
}
.roster {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.roster .isfresh {
  box-shadow: 0 0 8px rgba(109, 255, 138, 0.6);
}
.added .chip.army {
  border-color: rgba(255, 210, 58, 0.6);
  color: var(--gold);
}
.perm-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.perm-list .chip {
  cursor: pointer;
}
.rift {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 40;
  background:
    linear-gradient(115deg, transparent 47%, rgba(255, 40, 60, 0.95) 49%, #fff 50%, rgba(255, 40, 60, 0.95) 51%, transparent 53%),
    radial-gradient(circle at 50% 50%, rgba(255, 30, 50, 0.45), rgba(40, 0, 10, 0.75));
  animation: rift 1.4s ease-out forwards;
}
@keyframes rift {
  0% { opacity: 0; transform: scaleY(0.1); }
  15% { opacity: 1; transform: scaleY(1); }
  70% { opacity: 0.8; }
  100% { opacity: 0; }
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
</style>
