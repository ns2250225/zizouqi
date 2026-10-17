<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';
import { useGame } from './stores/game';
import { AudioManager } from './game/audio/AudioManager';
import MainMenu from './views/MainMenu.vue';
import GameView from './views/GameView.vue';
import CardCollection from './views/CardCollection.vue';
import Settings from './views/Settings.vue';
import StatsView from './views/StatsView.vue';
import Credits from './views/Credits.vue';

const game = useGame();

// 浏览器要求用户交互后才能播放音频：首次点击时开始菜单音乐
function unlockAudio() {
  if (game.view !== 'game') AudioManager.playBgm('menu');
  window.removeEventListener('pointerdown', unlockAudio);
}
onMounted(() => window.addEventListener('pointerdown', unlockAudio));
onBeforeUnmount(() => window.removeEventListener('pointerdown', unlockAudio));
</script>

<template>
  <MainMenu v-if="game.view === 'menu'" />
  <GameView v-else-if="game.view === 'game' && game.run" />
  <CardCollection v-else-if="game.view === 'codex'" />
  <Settings v-else-if="game.view === 'settings'" />
  <StatsView v-else-if="game.view === 'stats'" />
  <Credits v-else-if="game.view === 'credits'" />
  <MainMenu v-else />
  <div class="toasts">
    <TransitionGroup name="toast">
      <div v-for="t in game.toasts" :key="t.id" class="toast" :class="{ big: t.big }" :style="{ borderColor: t.color, color: t.color }">
        {{ t.text }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 50%;
  top: calc(64px + var(--safe-top));
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  z-index: 100;
  pointer-events: none;
  width: min(92vw, 420px);
}
.toast {
  padding: 8px 14px;
  border-radius: 8px;
  background: rgba(10, 12, 26, 0.92);
  border: 1px solid var(--gold);
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.toast.big {
  font-size: 18px;
  padding: 12px 20px;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-10px) scale(0.9);
}
.toast-leave-to {
  opacity: 0;
}
</style>
