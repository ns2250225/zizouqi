import { defineStore } from 'pinia';
import { dbGet, dbSet, SaveKeys } from '../game/data/SaveManager';
import { AudioManager } from '../game/audio/AudioManager';
import type { Quality } from '../utils/performance';

export interface SettingsState {
  master: number;
  music: number;
  sfx: number;
  shake: boolean;
  flash: boolean;
  damageNumbers: boolean;
  quality: Quality;
  battleSpeed: number;
  autoNext: boolean;
  showLog: boolean;
}

const DEFAULTS: SettingsState = {
  master: 0.8,
  music: 0.5,
  sfx: 0.8,
  shake: true,
  flash: true,
  damageNumbers: true,
  quality: 'auto',
  battleSpeed: 1,
  autoNext: false,
  showLog: true,
};

export const useSettings = defineStore('settings', {
  state: (): SettingsState => ({ ...DEFAULTS }),
  actions: {
    async load() {
      const saved = await dbGet<Partial<SettingsState>>(SaveKeys.settings);
      if (saved) this.$patch({ ...DEFAULTS, ...saved });
      this.applyAudio();
    },
    async save() {
      this.applyAudio();
      await dbSet(SaveKeys.settings, this.$state);
    },
    applyAudio() {
      AudioManager.setVolumes(this.master, this.music, this.sfx);
    },
    reset() {
      this.$patch({ ...DEFAULTS });
      void this.save();
    },
  },
});
