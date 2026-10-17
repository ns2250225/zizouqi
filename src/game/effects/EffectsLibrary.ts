import { BitmapFont, BitmapText, Container, type Graphics } from 'pixi.js';
import type { Element, Team } from '../core/types';
import type { BattleEvent, BattleUnit } from '../battle/BattleTypes';
import type { SpriteManager } from '../renderer/SpriteManager';
import type { ParticleManager } from '../renderer/ParticleManager';
import type { AnimationManager } from '../renderer/AnimationManager';
import type { CameraManager } from '../renderer/CameraManager';
import { AudioManager } from '../audio/AudioManager';

export const ELEMENT_COLOR: Record<Element, number> = {
  physical: 0xffffff,
  fire: 0xff7a2a,
  ice: 0x8fdcff,
  lightning: 0xbfe6ff,
  poison: 0x8fe860,
  holy: 0xfff0a0,
  dark: 0xb070ff,
  explosive: 0xffa040,
};

export interface FxContext {
  sprites: SpriteManager;
  particles: ParticleManager;
  anim: AnimationManager;
  camera: CameraManager;
  layers: { ground: Container; units: Container; air: Container; fx: Container; screen: Container; ui: Container };
  sx: (x: number) => number;
  sy: (y: number) => number;
  /** 逻辑长度 → 像素 */
  len: (v: number) => number;
  unitScale: () => number;
  size: () => { w: number; h: number };
  findUnit: (uid: number) => BattleUnit | undefined;
  unitPos: (uid: number) => { x: number; y: number } | null;
  settings: () => { flash: boolean; damageNumbers: boolean; maxDamageNumbers: number };
  onLog: (text: string, team: Team) => void;
  onCombo: (name: string, color: string) => void;
  onRage: () => void;
  ghost: (uid: number, fromY: number, toY: number, tint: number) => void;
}

let fontInstalled = false;
function ensureFont() {
  if (fontInstalled) return;
  fontInstalled = true;
  BitmapFont.install({
    name: 'DmgFont',
    style: { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: 40, fill: '#ffffff', fontWeight: 'bold', stroke: { color: '#1a0f08', width: 7 } },
    chars: [['0', '9'], '+!-×'],
    resolution: 1,
  });
}

interface DmgNum {
  text: BitmapText;
  age: number;
  life: number;
  vx: number;
  vy: number;
  scale: number;
  active: boolean;
}

/** 技能特效库：每种核心技能都有对应的视觉反馈 */
export class EffectsLibrary {
  private nums: DmgNum[] = [];
  private numLayer = new Container();
  private sfxTimer = new Map<string, number>();

  constructor(private c: FxContext) {
    ensureFont();
    c.layers.ui.addChild(this.numLayer);
  }

  private tex(n: string) {
    return this.c.sprites.effect(n);
  }

  private sfx(key: string, minGap = 60, volume = 1) {
    const now = performance.now();
    if (now - (this.sfxTimer.get(key) ?? 0) < minGap) return;
    this.sfxTimer.set(key, now);
    AudioManager.play(key, { volume });
  }

  // ------------------------------------------------------------ 伤害数字
  damageNumber(x: number, y: number, value: number, kind: 'normal' | 'crit' | 'heal' | 'blocked' | 'enemy') {
    const s = this.c.settings();
    if (!s.damageNumbers) return;
    let n = this.nums.find((d) => !d.active);
    const activeCount = this.nums.filter((d) => d.active).length;
    if (!n) {
      if (activeCount >= s.maxDamageNumbers) return;
      const text = new BitmapText({ text: '0', style: { fontFamily: 'DmgFont', fontSize: 40 } });
      text.anchor.set(0.5);
      this.numLayer.addChild(text);
      n = { text, age: 0, life: 0.8, vx: 0, vy: 0, scale: 0.4, active: false };
      this.nums.push(n);
    }
    const base = Math.max(0.28, Math.min(0.5, this.c.unitScale() * 0.16));
    n.active = true;
    n.age = 0;
    n.text.visible = true;
    n.text.text = kind === 'heal' ? `+${Math.round(value)}` : kind === 'crit' ? `${Math.round(value)}!` : `${Math.round(value)}`;
    n.text.tint = kind === 'crit' ? 0xffd23a : kind === 'heal' ? 0x6dff8a : kind === 'blocked' ? 0x9aa4b8 : kind === 'enemy' ? 0xff8a8a : 0xffffff;
    n.scale = kind === 'crit' ? base * 1.6 : kind === 'blocked' ? base * 0.75 : base;
    n.life = kind === 'crit' ? 1.0 : 0.75;
    n.vx = (Math.random() - 0.5) * 30;
    n.vy = kind === 'heal' ? -40 : -70;
    n.text.position.set(x + (Math.random() - 0.5) * 10, y - 10);
    n.text.scale.set(n.scale * (kind === 'crit' ? 1.6 : 1));
    n.text.alpha = 1;
  }

  update(dt: number) {
    for (const n of this.nums) {
      if (!n.active) continue;
      n.age += dt;
      const t = n.age / n.life;
      if (t >= 1) {
        n.active = false;
        n.text.visible = false;
        continue;
      }
      n.text.x += n.vx * dt;
      n.text.y += n.vy * dt;
      n.vy += 60 * dt;
      const pop = t < 0.15 ? 1 + (0.15 - t) * 3 : 1;
      n.text.scale.set(n.scale * pop);
      n.text.alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
    }
  }

  clear() {
    for (const n of this.nums) {
      n.active = false;
      n.text.visible = false;
    }
  }

  // ------------------------------------------------------------ 事件分发
  handle(e: BattleEvent) {
    const c = this.c;
    const L = c.layers;
    const P = c.particles;
    const us = c.unitScale();
    switch (e.t) {
      case 'hit': {
        const x = c.sx(e.x);
        const y = c.sy(e.y) - 8 * us;
        const col = ELEMENT_COLOR[e.element];
        P.burst(e.crit ? 6 : 3, () =>
          P.emit(this.tex(e.melee ? 'spark_03' : 'spark_01'), {
            x, y, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160, life: 0.25, scale: 0.08 * us, scaleEnd: 0, tint: col, drag: 4,
          }),
        );
        const target = c.findUnit(e.uid);
        const isEnemy = target?.team === 1;
        if (e.crit) {
          c.anim.pop(L.fx, this.tex('star_06'), x, y, { life: 0.22, scale: 0.12 * us, scaleEnd: 0.35 * us, tint: 0xffd23a });
          c.camera.punch(0.012, 0.05);
          this.damageNumber(x, y, e.dmg, 'crit');
        } else if (e.dmg >= 1) {
          this.damageNumber(x, y, e.dmg, e.blocked ? 'blocked' : isEnemy ? 'normal' : 'enemy');
        }
        if (e.blocked) c.anim.pop(L.fx, this.tex('circle_02'), x, y, { life: 0.2, scale: 0.12 * us, scaleEnd: 0.2 * us, tint: 0x9fc8ff });
        if (e.melee) {
          this.sfx(Math.random() < 0.5 ? 'melee_hit' : 'melee_hit2', 70, 0.5);
          c.camera.shake(0.8);
        }
        break;
      }
      case 'attack': {
        const u = c.findUnit(e.uid);
        if (!u || !e.ranged) break;
        const p = u.cfg.projectile;
        if (p === 'arrow' || p === 'icearrow' || p === 'bolt' || p === 'javelin') this.sfx('bow_shot', 90, 0.35);
        else if (p === 'bullet') {
          this.sfx('gun_shot', 70, 0.3);
          const pos = c.unitPos(u.uid);
          if (pos) c.anim.pop(L.fx, this.tex('muzzle_01'), pos.x, pos.y - 10 * us, { life: 0.08, scale: 0.1 * us, tint: 0xffe08a, rotation: u.team === 0 ? 0 : Math.PI });
        } else if (p === 'shell' || p === 'rocket') this.sfx('cannon_shot', 120, 0.45);
        else if (p) this.sfx('magic_cast', 150, 0.25);
        break;
      }
      case 'slash': {
        const x = c.sx(e.x);
        const y = c.sy(e.y) - 8 * us;
        const big = e.big;
        c.anim.pop(L.fx, this.tex(big ? 'slash_03' : Math.random() < 0.5 ? 'slash_01' : 'slash_02'), x, y, {
          life: big ? 0.28 : 0.16, scale: (big ? 0.28 : 0.12) * us, scaleEnd: (big ? 0.36 : 0.16) * us,
          rotation: Math.random() * Math.PI * 2, tint: big ? 0xfff6c0 : 0xffffff,
        });
        break;
      }
      case 'heal': {
        const x = c.sx(e.x);
        const y = c.sy(e.y);
        P.burst(3, () =>
          P.emit(this.tex('light_01'), { x: x + (Math.random() - 0.5) * 14 * us, y, vy: -50, life: 0.6, scale: 0.05 * us, scaleEnd: 0.02 * us, tint: 0x6dff8a }),
        );
        if (e.amount > 8) this.damageNumber(x, y - 14 * us, e.amount, 'heal');
        this.sfx('heal', 300, 0.35);
        break;
      }
      case 'death': {
        const x = c.sx(e.x);
        const y = c.sy(e.y);
        P.burst(6, () =>
          P.emit(this.tex('smoke_01'), {
            x, y: y - 6 * us, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 40, life: 0.6, scale: 0.05 * us, scaleEnd: 0.12 * us,
            alpha: 0.5, tint: 0x999999, add: false,
          }),
        );
        this.sfx('death', 120, 0.35);
        break;
      }
      case 'revive': {
        const x = c.sx(e.x);
        const y = c.sy(e.y);
        const phoenix = e.fx === 'phoenix';
        const color = phoenix ? 0xff9a2a : e.fx === 'resurrect' ? 0xfff3a0 : 0x9cffb0;
        c.anim.pop(L.ground, this.tex('light_03'), x, y, { life: 0.9, scale: 0.15 * us, scaleEnd: 0.5 * us, tint: color, anchorY: 0.9, scaleX: 0.5 });
        P.burst(phoenix ? 40 : 16, () =>
          P.emit(this.tex(phoenix ? 'flame_02' : 'star_04'), {
            x: x + (Math.random() - 0.5) * 30 * us, y, vx: (Math.random() - 0.5) * 80, vy: -60 - Math.random() * 120, life: 0.9,
            scale: 0.06 * us, scaleEnd: 0, tint: color, spin: 4,
          }),
        );
        if (phoenix) {
          this.ring(x, y, 70, 0xffa040, 0.5);
          c.camera.shake(8);
        }
        this.sfx('revive', 200, 0.6);
        break;
      }
      case 'explosion':
        this.explosion(e.x, e.y, e.radius, e.fx, e.element);
        break;
      case 'lightning':
        this.lightning(e.points, !!e.big);
        break;
      case 'beam':
        this.beam(e.x, e.y0, e.y1, e.fx, e.width);
        break;
      case 'breath':
        this.breath(e.x, e.y0, e.y1, e.fx);
        break;
      case 'cone': {
        const x = c.sx(e.x);
        const y0 = c.sy(e.y0);
        const y1 = c.sy(e.y1);
        P.burst(4, () => {
          const t = Math.random();
          P.emit(this.tex(Math.random() < 0.5 ? 'flame_01' : 'fire_02'), {
            x: x + (Math.random() - 0.5) * 10 * us, y: y0, vx: (Math.random() - 0.5) * 50, vy: (y1 - y0) * (1.8 + t),
            life: 0.32, scale: 0.05 * us, scaleEnd: 0.14 * us, tint: 0xff8a3a,
          });
        });
        this.sfx('fire_cast', 260, 0.25);
        break;
      }
      case 'charge':
      case 'dash': {
        const u = c.findUnit(e.uid);
        c.ghost(e.uid, e.fromY, e.toY, e.t === 'dash' ? 0x9d6bff : 0xbfdcff);
        const x = c.sx(e.x);
        const y = c.sy(e.toY);
        if (e.t === 'charge') {
          c.anim.pop(L.ground, this.tex('scorch_02'), x, y, { life: 1.2, scale: 0.12 * us, scaleEnd: 0.14 * us, tint: 0x553322, add: false, alpha: 0.7 });
          this.ring(x, y, 40, 0xdff0ff, 0.3);
          this.sfx('melee_heavy', 100, 0.7);
        } else {
          P.burst(10, () =>
            P.emit(this.tex('smoke_04'), { x, y, vx: (Math.random() - 0.5) * 100, vy: (Math.random() - 0.5) * 100, life: 0.4, scale: 0.04 * us, scaleEnd: 0.1 * us, tint: 0x6a3cff }),
          );
        }
        void u;
        break;
      }
      case 'stomp': {
        const x = c.sx(e.x);
        const y = c.sy(e.y);
        this.ring(x, y, e.radius, 0xd8c8a0, e.big ? 0.5 : 0.3, true);
        c.anim.pop(L.ground, this.tex('scorch_01'), x, y, { life: 1.5, scale: c.len(e.radius) / 90, tint: 0x3a2a1a, add: false, alpha: 0.6 });
        P.burst(e.big ? 18 : 8, () => {
          const a = Math.random() * Math.PI * 2;
          P.emit(this.tex('dirt_01'), {
            x, y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 60 - 60, ay: 300, life: 0.6, scale: 0.05 * us, scaleEnd: 0.02 * us, tint: 0xb89a70, add: false,
          });
        });
        this.sfx('stomp', 150, e.big ? 0.8 : 0.4);
        break;
      }
      case 'freeze': {
        const x = c.sx(e.x);
        const y = c.sy(e.y);
        this.ring(x, y, e.radius, 0x9fe4ff, 0.4);
        c.anim.pop(L.ground, this.tex('circle_05'), x, y, { life: 0.9, scale: c.len(e.radius) / 55, tint: 0x9fe4ff, alpha: 0.5, scaleX: 1.6 });
        P.burst(16, () => {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * c.len(e.radius);
          P.emit(this.tex('ice_crystal'), {
            x: x + Math.cos(a) * r * 1.5, y: y + Math.sin(a) * r * 0.5, vy: -30, life: 0.8, scale: 0.12 * us, scaleEnd: 0.04 * us, tint: 0xcff4ff, spin: 3,
          });
        });
        this.sfx('frost_cast', 150, 0.5);
        break;
      }
      case 'shield': {
        const p = c.unitPos(e.uid);
        if (p) c.anim.pop(L.fx, this.tex('circle_03'), p.x, p.y - 8 * us, { life: 0.5, scale: 0.12 * us, scaleEnd: 0.2 * us, tint: 0x7fd8ff });
        break;
      }
      case 'cast': {
        const p = c.unitPos(e.uid);
        if (!p) break;
        const col = this.fxColor(e.fx);
        c.anim.pop(L.ground, this.tex('twirl_02'), p.x, p.y, { life: 0.5, scale: 0.1 * us, scaleEnd: 0.18 * us, tint: col, spin: 6, scaleX: 1.6 });
        if (e.fx === 'fireball' || e.fx === 'fire_breath') this.sfx('fire_cast', 150, 0.4);
        else if (e.fx === 'frost' || e.fx === 'frost_breath') this.sfx('frost_cast', 150, 0.4);
        else if (e.fx === 'lightning' || e.fx === 'global_lightning') this.sfx('lightning', 100, 0.55);
        else if (e.fx === 'laser') this.sfx('laser', 150, 0.6);
        else if (e.fx?.startsWith('heal')) this.sfx('heal', 200, 0.5);
        else this.sfx('magic_cast', 120, 0.4);
        break;
      }
      case 'summon': {
        const x = c.sx(e.x);
        const y = c.sy(e.y);
        const col = this.fxColor(e.fx);
        c.anim.pop(L.ground, this.tex('magic_04'), x, y, { life: 0.9, scale: 0.18 * us, scaleEnd: 0.24 * us, tint: col, spin: 2, scaleX: 1.6 });
        P.burst(12, () =>
          P.emit(this.tex('magic_02'), { x: x + (Math.random() - 0.5) * 30 * us, y, vy: -80 - Math.random() * 60, life: 0.7, scale: 0.04 * us, scaleEnd: 0, tint: col }),
        );
        this.sfx('summon', 150, 0.45);
        break;
      }
      case 'meteorWarn':
        this.meteor(e.x, e.y, e.radius, e.delay);
        break;
      case 'arrowRain': {
        const { w } = c.size();
        const y0 = c.sy(e.y0);
        const y1 = c.sy(e.y1);
        for (let i = 0; i < 46 * P.density + 10; i++) {
          const tx = w * 0.5 + (Math.random() - 0.5) * c.len(380);
          const ty = y0 + Math.random() * (y1 - y0);
          const d = Math.random() * 0.5;
          c.anim.pop(L.air, this.tex('proj_arrow'), tx, ty - 200, { life: 0.35, scale: us * 0.7, delay: d, vy: 200 / 0.35, rotation: Math.PI, add: false });
          P.emit(this.tex('dirt_02'), { x: tx, y: ty, life: 0.3, scale: 0.03 * us, scaleEnd: 0.06 * us, tint: 0xc8b090, alpha: 0.8, add: false, delay: d + 0.35 });
        }
        this.sfx('bow_shot', 0, 0.8);
        break;
      }
      case 'entangle': {
        const x = c.sx(e.x);
        const y = c.sy(e.y);
        this.ring(x, y, e.radius, 0x7ad860, 0.6);
        P.burst(20, () => {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * c.len(e.radius);
          P.emit(this.tex('twirl_01'), { x: x + Math.cos(a) * r * 1.4, y: y + Math.sin(a) * r * 0.5, life: 0.9, scale: 0.02 * us, scaleEnd: 0.08 * us, tint: 0x6ac850, spin: 5 });
        });
        this.sfx('summon', 150, 0.4);
        break;
      }
      case 'shake':
        c.camera.shake(e.power);
        break;
      case 'slowmo':
        c.camera.slowmo(e.duration, e.scale);
        c.camera.punch(0.04, e.duration);
        break;
      case 'flash':
        this.flash(e.color, e.alpha);
        break;
      case 'rage':
        c.onRage();
        this.flash(0xff2020, 0.25);
        AudioManager.play('rage', { volume: 0.8 });
        break;
      case 'combo':
        c.onCombo(e.name, e.color);
        this.flash(parseInt(e.color.slice(1), 16), 0.2);
        AudioManager.play('combo', { volume: 0.8 });
        break;
      case 'log':
        c.onLog(e.text, e.team);
        break;
      case 'spawn':
        break;
    }
  }

  fxColor(fx: string | null): number {
    if (!fx) return 0xd78cff;
    if (fx.includes('fire') || fx === 'fireball' || fx === 'meteor') return 0xff7a2a;
    if (fx.includes('frost') || fx === 'time') return 0x8fdcff;
    if (fx.includes('lightning') || fx === 'tornado' || fx === 'laser' || fx === 'rail') return 0xbfe6ff;
    if (fx.includes('poison')) return 0x8fe860;
    if (fx.includes('heal') || fx.includes('holy') || fx === 'resurrect') return 0xfff0a0;
    if (fx.includes('dark') || fx === 'drain' || fx === 'shadow') return 0xb070ff;
    if (fx.includes('nature') || fx === 'entangle') return 0x7ad860;
    return 0xd78cff;
  }

  flash(color: number, alpha: number) {
    if (!this.c.settings().flash) return;
    const { w, h } = this.c.size();
    this.c.anim.draw(this.c.layers.screen, 0.3, (g, t) => {
      g.rect(0, 0, w, h).fill({ color, alpha: alpha * (1 - t) });
    });
  }

  ring(x: number, y: number, radius: number, color: number, life: number, ground = false) {
    const r = this.c.len(radius);
    this.c.anim.draw(ground ? this.c.layers.ground : this.c.layers.fx, life, (g, t) => {
      const rr = r * (0.3 + t * 0.9);
      g.ellipse(x, y, rr * 1.5, rr * 0.55).stroke({ width: 3 + (1 - t) * 5, color, alpha: 0.9 * (1 - t) });
    }, { add: true });
  }

  explosion(lx: number, ly: number, radius: number, fx: string, element: Element) {
    const c = this.c;
    const P = c.particles;
    const x = c.sx(lx);
    const y = c.sy(ly);
    const us = c.unitScale();
    const r = c.len(radius);
    const col = ELEMENT_COLOR[element];
    const big = fx === 'explosion_big' || fx === 'meteor' || fx === 'phoenix_nova';
    const mid = fx === 'explosion_mid' || fx === 'fireball';
    const scale = Math.max(0.35, (r * 2.2) / 96);
    c.anim.frames(c.layers.fx, c.sprites.frames('pixel_explosion_', 10), x, y - r * 0.2, {
      scale, fps: 26, tint: element === 'fire' || element === 'explosive' ? 0xffffff : col,
    });
    if (mid || big) {
      c.anim.frames(c.layers.fx, c.sprites.frames('smoke_explosion_', 9), x, y - r * 0.3, { scale: (r * 2.4) / 144, fps: 20, delay: 0.05 });
      c.anim.pop(c.layers.ground, this.tex('scorch_03'), x, y, { life: 2.5, scale: r / 70, tint: 0x2a1a10, add: false, alpha: 0.55, scaleX: 1.5 });
    }
    if (big) {
      c.anim.frames(c.layers.fx, c.sprites.frames('smoke_flash_', 9), x, y - r * 0.2, { scale: (r * 2.8) / 144, fps: 24, add: true });
      this.ring(x, y, radius * 1.2, 0xffe0a0, 0.45, true);
      P.burst(14, () =>
        P.emit(this.tex('black_smoke_1'), {
          x: x + (Math.random() - 0.5) * r, y: y - Math.random() * r * 0.5, vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 40,
          life: 1.4, scale: (r / 160) * 0.6, scaleEnd: r / 160, alpha: 0.55, add: false,
        }),
      );
      this.sfx('explosion_big', 120, 0.8);
      c.camera.shake(Math.min(18, 6 + radius / 10));
    } else {
      this.sfx('explosion', 80, mid ? 0.6 : 0.4);
    }
    P.burst(big ? 26 : mid ? 14 : 7, () => {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 220;
      P.emit(this.tex(Math.random() < 0.5 ? 'spark_02' : 'flame_03'), {
        x, y: y - 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 60, ay: 260, life: 0.55, scale: 0.05 * us, scaleEnd: 0, tint: col, drag: 2,
      });
    });
    if (big || mid) {
      P.burst(big ? 10 : 5, () => {
        const a = Math.random() * Math.PI * 2;
        P.emit(this.tex('dirt_03'), {
          x, y, vx: Math.cos(a) * 160, vy: -120 - Math.random() * 100, ay: 420, life: 0.8, scale: 0.05 * us, scaleEnd: 0.03 * us, tint: 0x6a5040, add: false, spin: 8,
        });
      });
    }
    if (fx === 'phoenix_nova') {
      P.burst(36, () => {
        const a = Math.random() * Math.PI * 2;
        P.emit(this.tex('flame_05'), { x, y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 120, life: 0.7, scale: 0.08 * us, scaleEnd: 0, tint: 0xffb030, drag: 2 });
      });
    }
  }

  lightning(points: { x: number; y: number }[], big: boolean) {
    const c = this.c;
    const pts = points.map((p) => ({ x: c.sx(p.x), y: c.sy(p.y) - 10 * c.unitScale() }));
    // 预先生成分叉折线
    const path: { x: number; y: number }[] = [];
    const branches: { x: number; y: number }[][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const segs = 7;
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const jitter = k === 0 || k === segs ? 0 : (Math.random() - 0.5) * (big ? 34 : 18);
        const p = { x: a.x + (b.x - a.x) * t + jitter, y: a.y + (b.y - a.y) * t + jitter * 0.3 };
        path.push(p);
        if (k > 0 && k < segs && Math.random() < 0.3) {
          branches.push([p, { x: p.x + (Math.random() - 0.5) * 40, y: p.y + (Math.random() - 0.2) * 30 }]);
        }
      }
    }
    const drawPath = (g: Graphics, ps: { x: number; y: number }[], width: number, color: number, alpha: number) => {
      g.moveTo(ps[0].x, ps[0].y);
      for (let i = 1; i < ps.length; i++) g.lineTo(ps[i].x, ps[i].y);
      g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
    };
    c.anim.draw(c.layers.fx, big ? 0.35 : 0.25, (g, t) => {
      const a = t < 0.2 ? 1 : 1 - (t - 0.2) / 0.8;
      drawPath(g, path, big ? 12 : 7, 0x5aa8ff, 0.35 * a);
      drawPath(g, path, big ? 5 : 3, 0xbfe6ff, 0.9 * a);
      drawPath(g, path, big ? 2 : 1.2, 0xffffff, a);
      for (const br of branches) drawPath(g, br, 1.5, 0xbfe6ff, 0.7 * a);
    }, { add: true });
    const end = pts[pts.length - 1];
    c.anim.pop(c.layers.fx, this.tex('light_02'), end.x, end.y, { life: 0.25, scale: (big ? 0.35 : 0.18) * c.unitScale(), tint: 0xbfe6ff });
    c.particles.burst(big ? 10 : 4, () =>
      c.particles.emit(this.tex('spark_05'), {
        x: end.x, y: end.y, vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.5) * 220, life: 0.3, scale: 0.05 * c.unitScale(), scaleEnd: 0, tint: 0xbfe6ff,
      }),
    );
    if (big) {
      this.flash(0xcfe8ff, 0.12);
      c.camera.shake(4);
    }
    this.sfx('lightning', 70, big ? 0.7 : 0.45);
  }

  beam(lx: number, ly0: number, ly1: number, fx: string, width: number) {
    const c = this.c;
    const x = c.sx(lx);
    const y0 = c.sy(ly0);
    const y1 = c.sy(ly1);
    const color = fx === 'holy_beam' ? 0xfff0a0 : fx === 'laser' ? 0xff4a6a : 0x8fd8ff;
    const w = width * c.unitScale() * 0.5;
    const life = fx === 'laser' ? 0.7 : fx === 'rail' ? 0.25 : 0.45;
    c.anim.draw(c.layers.fx, life, (g, t) => {
      const grow = t < 0.15 ? t / 0.15 : 1;
      const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      const ww = w * (fx === 'laser' ? 1 + Math.sin(t * 60) * 0.15 : 1) * fade;
      const yy = y0 + (y1 - y0) * grow;
      g.rect(x - ww * 1.6, Math.min(y0, yy), ww * 3.2, Math.abs(yy - y0)).fill({ color, alpha: 0.25 * fade });
      g.rect(x - ww * 0.6, Math.min(y0, yy), ww * 1.2, Math.abs(yy - y0)).fill({ color, alpha: 0.8 * fade });
      g.rect(x - ww * 0.2, Math.min(y0, yy), ww * 0.4, Math.abs(yy - y0)).fill({ color: 0xffffff, alpha: fade });
    }, { add: true });
    c.anim.pop(c.layers.fx, this.tex('flare_01'), x, y0, { life: life, scale: 0.12 * c.unitScale(), scaleEnd: 0.3 * c.unitScale(), tint: color });
    const P = c.particles;
    P.burst(fx === 'laser' ? 20 : 8, () => {
      const t = Math.random();
      P.emit(this.tex('spark_06'), {
        x: x + (Math.random() - 0.5) * w * 2, y: y0 + (y1 - y0) * t, vx: (Math.random() - 0.5) * 140, life: 0.35, scale: 0.05 * c.unitScale(), scaleEnd: 0, tint: color,
      });
    });
    if (fx === 'laser') {
      this.flash(0xff4a6a, 0.12);
      this.sfx('laser', 100, 0.7);
    } else if (fx === 'rail') this.sfx('laser', 100, 0.4);
    else this.sfx('magic_cast', 100, 0.45);
  }

  breath(lx: number, ly0: number, ly1: number, fx: string) {
    const c = this.c;
    const x = c.sx(lx);
    const y0 = c.sy(ly0);
    const y1 = c.sy(ly1);
    const frost = fx === 'frost_breath';
    const col = frost ? 0x9fe4ff : 0xff7a2a;
    const us = c.unitScale();
    // 扇形龙息的半透明底
    c.anim.draw(c.layers.ground, 0.6, (g, t) => {
      const a = (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8) * 0.35;
      const spread = Math.abs(y1 - y0) * 0.45;
      g.moveTo(x, y0).lineTo(x - spread, y1).lineTo(x + spread, y1).closePath().fill({ color: col, alpha: a });
    }, { add: true });
    const P = c.particles;
    P.burst(46, (i) => {
      const t = Math.random();
      const spread = (Math.random() - 0.5) * Math.abs(y1 - y0) * 0.9 * t;
      P.emit(this.tex(frost ? (Math.random() < 0.5 ? 'ice_crystal' : 'smoke_02') : Math.random() < 0.5 ? 'flame_04' : 'fire_01'), {
        x, y: y0, vx: spread * 2.2, vy: (y1 - y0) * 2.2 * (0.6 + t * 0.5), life: 0.45, scale: 0.04 * us, scaleEnd: 0.18 * us,
        tint: col, delay: (i % 12) * 0.02, drag: 1, spin: frost ? 2 : 0,
      });
    });
    this.sfx(frost ? 'frost_cast' : 'fire_cast', 100, 0.8);
  }

  meteor(lx: number, ly: number, radius: number, delay: number) {
    const c = this.c;
    const x = c.sx(lx);
    const y = c.sy(ly);
    const r = c.len(radius);
    const us = c.unitScale();
    c.anim.draw(c.layers.ground, delay, (g, t) => {
      g.ellipse(x, y, r * 1.5 * t, r * 0.55 * t).fill({ color: 0xff3020, alpha: 0.18 });
      g.ellipse(x, y, r * 1.5, r * 0.55).stroke({ width: 2, color: 0xff5030, alpha: 0.7 * (0.5 + Math.sin(t * 30) * 0.5) });
    });
    const startY = y - c.size().h * 0.6;
    const startX = x - 80;
    c.anim.draw(c.layers.air, delay, (g, t) => {
      const px = startX + (x - startX) * t;
      const py = startY + (y - startY) * t * t;
      g.circle(px, py, 9 * us * 0.6).fill({ color: 0xffd080 });
      g.circle(px, py, 15 * us * 0.6).fill({ color: 0xff6020, alpha: 0.6 });
    }, { add: true });
    const P = c.particles;
    const n = Math.round(14 * P.density);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      P.emit(this.tex('flame_06'), {
        x: startX + (x - startX) * t, y: startY + (y - startY) * t * t, life: 0.4, scale: 0.08 * us, scaleEnd: 0.02 * us, tint: 0xff8030, delay: t * delay,
      });
    }
  }
}
