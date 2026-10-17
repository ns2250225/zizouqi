import { Assets, Graphics, Rectangle, Texture, type Renderer, type Spritesheet } from 'pixi.js';
import { assetUrl, getManifest } from '../data/AssetManager';
import type { UnitConfig } from '../core/types';

/** 纹理加载与查找。任何素材缺失时都返回程序化生成的兜底纹理，保证不会白屏。 */
export class SpriteManager {
  private sheets: Partial<Record<'dungeon' | 'onebit', Texture>> = {};
  private unitCache = new Map<string, Texture>();
  private fx: Record<string, Texture> = {};
  private bgs: Record<string, Texture> = {};
  private fallback = new Map<string, Texture>();
  private renderer!: Renderer;

  async load(renderer: Renderer) {
    this.renderer = renderer;
    const m = getManifest();
    if (!m) return;
    const tasks: Promise<void>[] = [];
    const loadTex = async (url: string, nearest: boolean) => {
      const t = (await Assets.load(url)) as Texture;
      if (nearest) t.source.scaleMode = 'nearest';
      return t;
    };
    tasks.push(loadTex(assetUrl(m.atlases.units_dungeon.image), true).then((t) => void (this.sheets.dungeon = t)).catch(() => undefined));
    tasks.push(loadTex(assetUrl(m.atlases.units_onebit.image), true).then((t) => void (this.sheets.onebit = t)).catch(() => undefined));
    tasks.push(
      (Assets.load(assetUrl(m.atlases.effects.json)) as Promise<Spritesheet>)
        .then((sheet) => {
          this.fx = { ...sheet.textures };
        })
        .catch(() => undefined),
    );
    for (const [id, rel] of Object.entries(m.backgrounds)) {
      tasks.push(loadTex(assetUrl(rel), true).then((t) => void (this.bgs[id] = t)).catch(() => undefined));
    }
    await Promise.all(tasks);
  }

  unit(cfg: UnitConfig): Texture {
    const key = `${cfg.sprite.sheet}:${cfg.sprite.index}`;
    const cached = this.unitCache.get(key);
    if (cached) return cached;
    const sheet = this.sheets[cfg.sprite.sheet];
    if (!sheet) return this.procedural(`unit:${cfg.role}`, () => this.drawFallbackUnit(cfg));
    const cols = cfg.sprite.sheet === 'dungeon' ? 12 : 49;
    const r = Math.floor(cfg.sprite.index / cols);
    const c = cfg.sprite.index % cols;
    const tex = new Texture({ source: sheet.source, frame: new Rectangle(c * 16, r * 16, 16, 16) });
    this.unitCache.set(key, tex);
    return tex;
  }

  effect(name: string): Texture {
    return this.fx[name] ?? this.procedural(`fx:${name}`, () => this.drawFallbackParticle(name));
  }

  has(name: string): boolean {
    return !!this.fx[name];
  }

  frames(prefix: string, count: number): Texture[] {
    const out: Texture[] = [];
    for (let i = 0; i < count; i++) {
      const t = this.fx[`${prefix}${String(i).padStart(2, '0')}`];
      if (t) out.push(t);
    }
    return out.length ? out : [this.effect('circle_05')];
  }

  background(id: string): Texture | null {
    return this.bgs[id] ?? this.bgs.grassland ?? null;
  }

  private procedural(key: string, draw: () => Graphics): Texture {
    let t = this.fallback.get(key);
    if (!t) {
      const g = draw();
      t = this.renderer.generateTexture(g);
      g.destroy();
      this.fallback.set(key, t);
    }
    return t;
  }

  private drawFallbackUnit(cfg: UnitConfig): Graphics {
    const g = new Graphics();
    const color = cfg.role === 'front' ? 0xd0d0e0 : cfg.role === 'mid' ? 0xa0e0a0 : 0xc0a0ff;
    g.rect(4, 2, 8, 8).fill(color);
    g.rect(3, 10, 10, 5).fill(color);
    g.rect(6, 5, 1, 1).fill(0x000000);
    g.rect(9, 5, 1, 1).fill(0x000000);
    return g;
  }

  private drawFallbackParticle(name: string): Graphics {
    const g = new Graphics();
    if (name.startsWith('proj_')) {
      g.rect(0, 0, 4, 14).fill(0xffffff);
    } else {
      g.circle(32, 32, 30).fill({ color: 0xffffff, alpha: 0.35 });
      g.circle(32, 32, 16).fill({ color: 0xffffff, alpha: 0.8 });
    }
    return g;
  }
}
