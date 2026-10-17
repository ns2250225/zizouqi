import { Container, Sprite, type Texture } from 'pixi.js';

export interface ParticleOpts {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  ax?: number;
  ay?: number;
  life: number;
  scale?: number;
  scaleEnd?: number;
  alpha?: number;
  alphaEnd?: number;
  rotation?: number;
  spin?: number;
  tint?: number;
  add?: boolean;
  drag?: number;
  delay?: number;
}

interface Particle extends Required<Omit<ParticleOpts, 'tint' | 'add'>> {
  sprite: Sprite;
  age: number;
  active: boolean;
}

/** 粒子对象池：预分配 Sprite，按设备等级限制数量 */
export class ParticleManager {
  readonly layer = new Container();
  private pool: Particle[] = [];
  private active: Particle[] = [];
  max: number;
  /** 0~1 粒子密度系数，供特效按设备性能缩减数量 */
  density = 1;

  constructor(max: number) {
    this.max = max;
  }

  setMax(max: number) {
    this.max = max;
    this.density = max >= 1200 ? 1 : max >= 700 ? 0.7 : 0.45;
  }

  get count() {
    return this.active.length;
  }

  emit(tex: Texture, o: ParticleOpts) {
    if (this.active.length >= this.max) return;
    let p = this.pool.pop();
    if (!p) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      this.layer.addChild(sprite);
      p = { sprite } as Particle;
    }
    const s = p.sprite;
    s.texture = tex;
    s.visible = !(o.delay && o.delay > 0);
    s.blendMode = o.add === false ? 'normal' : 'add';
    s.tint = o.tint ?? 0xffffff;
    p.x = o.x;
    p.y = o.y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.ax = o.ax ?? 0;
    p.ay = o.ay ?? 0;
    p.life = o.life;
    p.scale = o.scale ?? 1;
    p.scaleEnd = o.scaleEnd ?? p.scale;
    p.alpha = o.alpha ?? 1;
    p.alphaEnd = o.alphaEnd ?? 0;
    p.rotation = o.rotation ?? 0;
    p.spin = o.spin ?? 0;
    p.drag = o.drag ?? 0;
    p.delay = o.delay ?? 0;
    p.age = 0;
    p.active = true;
    s.position.set(p.x, p.y);
    s.scale.set(p.scale);
    s.alpha = p.alpha;
    s.rotation = p.rotation;
    this.active.push(p);
  }

  /** 按密度系数缩减的批量发射 */
  burst(n: number, fn: (i: number) => void) {
    const count = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < count; i++) fn(i);
  }

  update(dt: number) {
    const arr = this.active;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay > 0) continue;
        p.sprite.visible = true;
      }
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.active = false;
        p.sprite.visible = false;
        arr[i] = arr[arr.length - 1];
        arr.pop();
        this.pool.push(p);
        continue;
      }
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
      const s = p.sprite;
      s.position.set(p.x, p.y);
      s.rotation = p.rotation;
      s.scale.set(p.scale + (p.scaleEnd - p.scale) * t);
      s.alpha = p.alpha + (p.alphaEnd - p.alpha) * t;
    }
  }

  clear() {
    for (const p of this.active) {
      p.active = false;
      p.sprite.visible = false;
      this.pool.push(p);
    }
    this.active.length = 0;
  }
}
