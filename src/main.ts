import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './styles/main.css';
import { loadManifest } from './game/data/AssetManager';
import { AudioManager } from './game/audio/AudioManager';
import { useSettings } from './stores/settings';
import { useStats } from './stores/stats';
import { useGame } from './stores/game';

async function boot() {
  const manifest = await loadManifest();
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  AudioManager.init(manifest);
  await Promise.all([useSettings().load(), useStats().load(), useGame().init()]);
  app.mount('#app');
}

void boot();
