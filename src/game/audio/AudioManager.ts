import { Howl, Howler } from 'howler';
import { assetUrl, type AssetManifest } from '../data/AssetManager';

interface SfxState {
  howl: Howl;
  playing: number;
  lastAt: number;
}

/** 音效与 BGM 管理：限制同一音效同时播放数量，支持战况动态切换音乐 */
class AudioManagerImpl {
  private sfx = new Map<string, SfxState>();
  private bgm = new Map<string, Howl>();
  private currentBgm: { key: string; howl: Howl; id: number } | null = null;
  private master = 0.8;
  private music = 0.5;
  private effects = 0.8;
  private ready = false;
  maxConcurrent = 5;

  init(manifest: AssetManifest | null) {
    if (this.ready || !manifest) return;
    this.ready = true;
    for (const [key, files] of Object.entries(manifest.audio.sfx)) {
      const howl = new Howl({ src: files.map(assetUrl), preload: true, volume: 1 });
      this.sfx.set(key, { howl, playing: 0, lastAt: 0 });
    }
    for (const [key, files] of Object.entries(manifest.audio.bgm)) {
      this.bgm.set(key, new Howl({ src: files.map(assetUrl), html5: true, loop: true, preload: key === 'menu', volume: 0 }));
    }
  }

  setVolumes(master: number, music: number, effects: number) {
    this.master = master;
    this.music = music;
    this.effects = effects;
    Howler.volume(master);
    if (this.currentBgm) this.currentBgm.howl.volume(this.music, this.currentBgm.id);
  }

  play(key: string, opts: { volume?: number; rate?: number } = {}) {
    const s = this.sfx.get(key);
    if (!s || this.effects <= 0 || this.master <= 0) return;
    const now = performance.now();
    // 同一音效 40ms 内只播放一次，且同时最多 maxConcurrent 个
    if (now - s.lastAt < 40 || s.playing >= this.maxConcurrent) return;
    s.lastAt = now;
    s.playing++;
    const id = s.howl.play();
    s.howl.volume((opts.volume ?? 1) * this.effects, id);
    if (opts.rate) s.howl.rate(opts.rate, id);
    const done = () => {
      s.playing = Math.max(0, s.playing - 1);
    };
    s.howl.once('end', done, id);
    s.howl.once('stop', done, id);
  }

  playBgm(key: string, rate = 1) {
    if (this.currentBgm?.key === key) {
      this.currentBgm.howl.rate(rate, this.currentBgm.id);
      return;
    }
    const next = this.bgm.get(key);
    const prev = this.currentBgm;
    if (prev) {
      prev.howl.fade(prev.howl.volume(prev.id) as number, 0, 600, prev.id);
      const h = prev.howl;
      const pid = prev.id;
      setTimeout(() => h.stop(pid), 650);
    }
    if (!next) {
      this.currentBgm = null;
      return;
    }
    const id = next.play();
    next.volume(0, id);
    next.rate(rate, id);
    next.fade(0, this.music, 800, id);
    this.currentBgm = { key, howl: next, id };
  }

  /** 狂暴阶段：切换为节奏更快的战斗曲并提高音量 */
  setIntensity(rage: boolean) {
    if (rage) {
      this.playBgm('rage', 1.06);
      if (this.currentBgm) this.currentBgm.howl.fade(this.music, Math.min(1, this.music * 1.25), 400, this.currentBgm.id);
    }
  }

  stopBgm() {
    if (this.currentBgm) {
      const { howl, id } = this.currentBgm;
      howl.fade(howl.volume(id) as number, 0, 400, id);
      setTimeout(() => howl.stop(id), 420);
      this.currentBgm = null;
    }
  }
}

export const AudioManager = new AudioManagerImpl();
