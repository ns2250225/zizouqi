import { Container, Graphics, Sprite, type Texture } from 'pixi.js';

interface Transient {
  obj: Container;
  age: number;
  life: number;
  delay: number;
  update: (t: number, obj: Container) => void;
  release: () => void;
}

/** 管理帧动画（爆炸序列帧）与短暂存在的程序化图形（闪电、光束、冲击波），全部对象池复用 */
export class AnimationManager {
  private items: Transient[] = [];
  private spritePool: Sprite[] = [];
  private graphicsPool: Graphics[] = [];

  sprite(layer: Container, tex: Texture): Sprite {
    const s = this.spritePool.pop() ?? new Sprite();
    s.texture = tex;
    s.anchor.set(0.5);
    s.alpha = 1;
    s.rotation = 0;
    s.tint = 0xffffff;
    s.scale.set(1);
    s.blendMode = 'normal';
    s.visible = true;
    layer.addChild(s);
    return s;
  }

  graphics(layer: Container): Graphics {
    const g = this.graphicsPool.pop() ?? new Graphics();
    g.clear();
    g.alpha = 1;
    g.scale.set(1);
    g.rotation = 0;
    g.position.set(0, 0);
    g.blendMode = 'normal';
    g.visible = true;
    layer.addChild(g);
    return g;
  }

  /** 播放序列帧动画 */
  frames(layer: Container, frames: Texture[], x: number, y: number, opts: { scale?: number; fps?: number; tint?: number; add?: boolean; rotation?: number; delay?: number } = {}) {
    const s = this.sprite(layer, frames[0]);
    s.position.set(x, y);
    s.scale.set(opts.scale ?? 1);
    s.tint = opts.tint ?? 0xffffff;
    s.rotation = opts.rotation ?? 0;
    if (opts.add) s.blendMode = 'add';
    const fps = opts.fps ?? 24;
    const life = frames.length / fps;
    s.visible = !opts.delay;
    this.add(s, life, (t) => {
      const i = Math.min(frames.length - 1, Math.floor(t * frames.length));
      s.texture = frames[i];
      s.alpha = t > 0.75 ? 1 - (t - 0.75) * 4 : 1;
    }, () => this.releaseSprite(s), opts.delay ?? 0);
  }

  /** 单张贴图的淡出/缩放动画 */
  pop(layer: Container, tex: Texture, x: number, y: number, opts: {
    life: number; scale?: number; scaleEnd?: number; tint?: number; add?: boolean; rotation?: number; alpha?: number;
    spin?: number; delay?: number; vy?: number; anchorY?: number; scaleX?: number;
  }) {
    const s = this.sprite(layer, tex);
    s.position.set(x, y);
    if (opts.anchorY !== undefined) s.anchor.set(0.5, opts.anchorY);
    s.tint = opts.tint ?? 0xffffff;
    if (opts.add !== false) s.blendMode = 'add';
    s.rotation = opts.rotation ?? 0;
    const a0 = opts.alpha ?? 1;
    const sc0 = opts.scale ?? 1;
    const sc1 = opts.scaleEnd ?? sc0;
    s.visible = !opts.delay;
    this.add(s, opts.life, (t) => {
      const sc = sc0 + (sc1 - sc0) * t;
      s.scale.set(sc * (opts.scaleX ?? 1), sc);
      s.alpha = a0 * (1 - t * t);
      if (opts.spin) s.rotation += opts.spin / 60;
      if (opts.vy) s.y = y + opts.vy * t * opts.life;
    }, () => this.releaseSprite(s), opts.delay ?? 0);
    return s;
  }

  /** 每帧重绘的图形效果 */
  draw(layer: Container, life: number, fn: (g: Graphics, t: number) => void, opts: { add?: boolean; delay?: number } = {}) {
    const g = this.graphics(layer);
    if (opts.add) g.blendMode = 'add';
    g.visible = !opts.delay;
    this.add(g, life, (t) => {
      g.clear();
      fn(g, t);
    }, () => this.releaseGraphics(g), opts.delay ?? 0);
  }

  private add(obj: Container, life: number, update: Transient['update'], release: () => void, delay: number) {
    this.items.push({ obj, age: 0, life, delay, update, release });
    if (!delay) update(0, obj);
  }

  update(dt: number) {
    const arr = this.items;
    for (let i = arr.length - 1; i >= 0; i--) {
      const it = arr[i];
      if (it.delay > 0) {
        it.delay -= dt;
        if (it.delay > 0) continue;
        it.obj.visible = true;
      }
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) {
        it.release();
        arr[i] = arr[arr.length - 1];
        arr.pop();
        continue;
      }
      it.update(t, it.obj);
    }
  }

  clear() {
    for (const it of this.items) it.release();
    this.items.length = 0;
  }

  get count() {
    return this.items.length;
  }

  private releaseSprite(s: Sprite) {
    s.visible = false;
    s.anchor.set(0.5);
    s.removeFromParent();
    if (this.spritePool.length < 300) this.spritePool.push(s);
    else s.destroy();
  }

  private releaseGraphics(g: Graphics) {
    g.visible = false;
    g.clear();
    g.removeFromParent();
    if (this.graphicsPool.length < 120) this.graphicsPool.push(g);
    else g.destroy();
  }
}
