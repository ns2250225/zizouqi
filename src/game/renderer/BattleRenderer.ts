import {
  Application, BitmapText, Container, Graphics, Sprite, TilingSprite, type Texture,
} from 'pixi.js';
import { BattleSim } from '../battle/BattleSim';
import type { BattleUnit, Projectile, Zone } from '../battle/BattleTypes';
import type { BattleOutcome, BattleSetup, Team } from '../core/types';
import { EffectsLibrary } from '../effects/EffectsLibrary';
import { AudioManager } from '../audio/AudioManager';
import { SpriteManager } from './SpriteManager';
import { ParticleManager } from './ParticleManager';
import { AnimationManager } from './AnimationManager';
import { CameraManager } from './CameraManager';
import { lowerTier, profileFor, resolveProfile, type PerfProfile, type Quality } from '../../utils/performance';

export interface RendererSettings {
  shake: boolean;
  flash: boolean;
  damageNumbers: boolean;
  quality: Quality;
}

export interface RendererCallbacks {
  onLog?: (text: string, team: Team) => void;
  onCombo?: (name: string, color: string) => void;
  onRage?: () => void;
  onTick?: (info: { time: number; alive: [number, number]; hp: [number, number] }) => void;
  onEnd?: (outcome: BattleOutcome) => void;
}

const TEAM_COLOR: Record<Team, number> = { 0: 0x4aa3ff, 1: 0xff4a5a };

class UnitView {
  root = new Container();
  shadow: Sprite;
  ring: Graphics;
  body: Sprite;
  bar = new Graphics();
  badge: BitmapText | null = null;
  crown: Sprite | null = null;
  status: Sprite;
  lastHp = -1;
  lastShield = -1;
  lastSquad = 1;
  deathT = -1;
  spawnT = 0;
  baseTint: number;
  seen = 0;

  constructor(public unit: BattleUnit, tex: Texture, shadowTex: Texture, statusTex: Texture) {
    this.shadow = new Sprite(shadowTex);
    this.shadow.anchor.set(0.5);
    this.shadow.alpha = 0.7;
    this.ring = new Graphics();
    this.body = new Sprite(tex);
    this.body.anchor.set(0.5, 1);
    this.status = new Sprite(statusTex);
    this.status.anchor.set(0.5);
    this.status.visible = false;
    this.status.blendMode = 'add';
    this.baseTint = unit.cfg.sprite.tint ? parseInt(unit.cfg.sprite.tint.slice(1), 16) : 0xffffff;
    this.root.addChild(this.shadow, this.ring, this.body, this.status, this.bar);
  }
}

function mulTint(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (r << 16) | (g << 8) | bl;
}

/** 战斗渲染：战斗逻辑以固定步长推进，画面以插值方式渲染，两者解耦 */
export class BattleRenderer {
  app!: Application;
  readonly sprites = new SpriteManager();
  particles!: ParticleManager;
  readonly anim = new AnimationManager();
  camera!: CameraManager;
  fx!: EffectsLibrary;
  world = new Container();
  layers = {
    bg: new Container(),
    shadow: new Container(),
    ground: new Container(),
    units: new Container(),
    air: new Container(),
    fx: new Container(),
    screen: new Container(),
    ui: new Container(),
  };
  private bg: TilingSprite | null = null;
  private overlay = new Graphics();
  private rageOverlay = new Graphics();
  private sim: BattleSim | null = null;
  private mode: 'idle' | 'preview' | 'battle' | 'ended' = 'idle';
  private views = new Map<number, UnitView>();
  private projViews = new Map<number, Sprite>();
  private zoneViews = new Map<number, Container>();
  private acc = 0;
  speed = 1;
  paused = false;
  /** PvP 加入方视角：上下翻转战场（team 0 显示在上方），不影响模拟本身 */
  flip = false;
  private time = 0;
  private callbacks: RendererCallbacks = {};
  private settings: RendererSettings;
  private profile: PerfProfile;
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 60;
  private rage = false;
  private endTimer = -1;
  private lastDeath: { x: number; y: number } | null = null;
  private themeId = 'grassland';
  private destroyed = false;
  private tickInfoT = 0;

  private constructor(settings: RendererSettings) {
    this.settings = settings;
    this.profile = resolveProfile(settings.quality);
  }

  static async create(el: HTMLElement, settings: RendererSettings): Promise<BattleRenderer> {
    const r = new BattleRenderer(settings);
    await r.init(el);
    return r;
  }

  private async init(el: HTMLElement) {
    this.app = new Application();
    await this.app.init({
      resizeTo: el,
      backgroundColor: 0x0d0f1a,
      antialias: false,
      autoDensity: true,
      resolution: this.profile.resolution,
      powerPreference: 'high-performance',
    });
    el.appendChild(this.app.canvas);
    await this.sprites.load(this.app.renderer);
    this.particles = new ParticleManager(this.profile.maxParticles);
    this.particles.setMax(this.profile.maxParticles);
    this.camera = new CameraManager(this.world, () => this.size());
    this.camera.shakeEnabled = this.settings.shake;
    const L = this.layers;
    L.units.sortableChildren = true;
    this.world.addChild(L.bg, L.shadow, L.ground, L.units, L.air, this.particles.layer, L.fx, L.ui);
    L.bg.addChild(this.overlay);
    this.app.stage.addChild(this.world, L.screen);
    L.screen.addChild(this.rageOverlay);
    this.fx = new EffectsLibrary({
      sprites: this.sprites,
      particles: this.particles,
      anim: this.anim,
      camera: this.camera,
      layers: { ground: L.ground, units: L.units, air: L.air, fx: L.fx, screen: L.screen, ui: L.ui },
      sx: (x) => this.sx(x),
      sy: (y) => this.sy(y),
      len: (v) => this.len(v),
      unitScale: () => this.unitScale(),
      size: () => this.size(),
      findUnit: (uid) => this.views.get(uid)?.unit ?? this.sim?.findUnit(uid),
      unitPos: (uid) => {
        const v = this.views.get(uid);
        return v ? { x: v.root.x, y: v.root.y } : null;
      },
      settings: () => ({ flash: this.settings.flash, damageNumbers: this.settings.damageNumbers, maxDamageNumbers: this.profile.damageNumbers }),
      onLog: (t, team) => this.callbacks.onLog?.(t, team),
      onCombo: (n, c) => this.callbacks.onCombo?.(n, c),
      onRage: () => {
        this.rage = true;
        AudioManager.setIntensity(true);
        this.callbacks.onRage?.();
      },
      ghost: (uid, fromY, toY, tint) => this.ghost(uid, fromY, toY, tint),
    });
    this.setTheme(this.themeId);
    this.app.renderer.on('resize', () => this.layoutBackground());
    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
  }

  // ------------------------------------------------------------ 坐标
  size() {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }
  private get margin() {
    const { h } = this.size();
    return Math.max(26, h * 0.05);
  }
  sx(x: number) {
    const { w } = this.size();
    return w / 2 + x * Math.min(w * 0.4, 230);
  }
  sy(y: number) {
    const { h } = this.size();
    const m = this.margin;
    const v = m + (y / 1000) * (h - m * 2);
    return this.flip ? h - v : v;
  }
  len(v: number) {
    const { h } = this.size();
    return (v / 1000) * (h - this.margin * 2);
  }
  unitScale() {
    const { w, h } = this.size();
    return Math.max(1.4, Math.min(3, Math.min(w / 360, h / 720) * 2.1));
  }

  // ------------------------------------------------------------ 外部接口
  updateSettings(s: RendererSettings) {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    this.camera.shakeEnabled = s.shake;
    if (qualityChanged) {
      this.profile = resolveProfile(s.quality);
      this.particles.setMax(this.profile.maxParticles);
    }
  }

  get unitCap() {
    return this.profile.unitCap;
  }

  get tier() {
    return this.profile.tier;
  }

  setTheme(id: string) {
    this.themeId = id;
    const tex = this.sprites.background(id);
    if (this.bg) {
      this.bg.destroy();
      this.bg = null;
    }
    if (tex) {
      this.bg = new TilingSprite({ texture: tex, width: 10, height: 10 });
      this.layers.bg.addChildAt(this.bg, 0);
    }
    this.layoutBackground();
  }

  private layoutBackground() {
    const { w, h } = this.size();
    if (this.bg) {
      // 稍大于屏幕，避免震动时露边
      const k = Math.max(2, Math.round((w / 192) * 2) / 2);
      this.bg.tileScale.set(k);
      this.bg.position.set(-40, -40);
      this.bg.width = w + 80;
      this.bg.height = h + 80;
      this.bg.tilePosition.set(w / 2 + 40 - (192 * k) / 2, 0);
    }
    const g = this.overlay;
    g.clear();
    const bands = 10;
    for (let i = 0; i < bands; i++) {
      const a = 0.28 * (1 - i / bands);
      g.rect(-40, -40 + (i * h * 0.35) / bands, w + 80, (h * 0.35) / bands).fill({ color: 0x40081a, alpha: a });
      g.rect(-40, h + 40 - ((i + 1) * h * 0.35) / bands, w + 80, (h * 0.35) / bands).fill({ color: 0x08203f, alpha: a });
    }
    const mid = this.sy(500);
    g.rect(-40, mid - 1, w + 80, 2).fill({ color: 0xffffff, alpha: 0.12 });
    const half = Math.min(w * 0.4, 230) + 30;
    g.rect(w / 2 - half, -40, 2, h + 80).fill({ color: 0x000000, alpha: 0.15 });
    g.rect(w / 2 + half, -40, 2, h + 80).fill({ color: 0x000000, alpha: 0.15 });
  }

  /** 准备阶段：展示双方已部署的军队（不推进战斗逻辑） */
  showPreview(setup: BattleSetup) {
    this.resetScene();
    this.sim = new BattleSim(setup);
    this.sim.events.length = 0;
    this.mode = 'preview';
    this.syncViews(true);
  }

  startBattle(setup: BattleSetup, callbacks: RendererCallbacks) {
    this.resetScene();
    this.callbacks = callbacks;
    this.sim = new BattleSim(setup);
    this.sim.events.length = 0;
    this.mode = 'battle';
    this.acc = 0;
    this.time = 0;
    this.rage = false;
    this.endTimer = -1;
    this.lastDeath = null;
    this.paused = false;
    this.syncViews(true);
    for (const v of this.views.values()) v.spawnT = 0.35 + Math.random() * 0.2;
    this.fx.flash(0xffffff, 0.2);
    this.camera.punch(0.04, 0.15);
  }

  clear() {
    this.resetScene();
    this.sim = null;
    this.mode = 'idle';
  }

  get battleTime() {
    return this.sim?.time ?? 0;
  }

  get liveSim() {
    return this.sim;
  }

  private resetScene() {
    for (const v of this.views.values()) v.root.destroy({ children: true });
    this.views.clear();
    for (const s of this.projViews.values()) s.destroy();
    this.projViews.clear();
    for (const z of this.zoneViews.values()) z.destroy({ children: true });
    this.zoneViews.clear();
    this.particles.clear();
    this.anim.clear();
    this.fx.clear();
    this.camera.reset();
    this.rageOverlay.clear();
    this.rage = false;
  }

  destroy() {
    this.destroyed = true;
    this.resetScene();
    this.app.destroy(true, { children: true });
  }

  // ------------------------------------------------------------ 主循环
  private tick(realDt: number) {
    if (this.destroyed) return;
    realDt = Math.min(realDt, 0.1);
    this.measureFps(realDt);
    const sim = this.sim;
    this.camera.update(realDt);
    const ts = this.camera.timeScale;
    const fxDt = realDt * ts * (this.paused ? 0 : 1);
    this.time += realDt;
    if (sim && this.mode === 'battle' && !this.paused) {
      this.acc += realDt * this.speed * ts;
      let steps = 0;
      while (this.acc >= sim.dt && steps < 8 && !sim.finished) {
        sim.step();
        this.acc -= sim.dt;
        steps++;
        this.drainEvents();
      }
      if (steps >= 8) this.acc = 0;
      this.tickInfoT -= realDt;
      if (this.tickInfoT <= 0) {
        this.tickInfoT = 0.2;
        const hp: [number, number] = [0, 0];
        for (const t of [0, 1] as Team[]) for (const u of sim.teams[t].units) if (u.alive && !u.cfg.nonCombatant) hp[t] += u.hp;
        this.callbacks.onTick?.({ time: sim.time, alive: [sim.combatAlive(0), sim.combatAlive(1)], hp });
      }
      if (sim.finished) this.beginEnding();
    }
    if (this.mode === 'ended' && this.endTimer >= 0) {
      this.endTimer -= realDt;
      if (this.endTimer <= 0.9 && this.endTimer + realDt > 0.9) this.celebrate();
      if (this.endTimer <= 0) {
        this.endTimer = -1;
        if (sim?.outcome) this.callbacks.onEnd?.(sim.outcome);
      }
    }
    const alpha = sim && this.mode === 'battle' ? Math.min(1, this.acc / sim.dt) : 1;
    if (sim) {
      this.syncViews(false);
      this.renderUnits(alpha, realDt);
      this.renderProjectiles(alpha, fxDt);
      this.renderZones(fxDt);
    }
    this.particles.update(fxDt || (this.mode !== 'battle' ? realDt : 0));
    this.anim.update(this.paused ? 0 : realDt * ts);
    this.fx.update(realDt);
    if (this.rage) this.drawRage();
  }

  private measureFps(dt: number) {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 2) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      // 自动性能分级：帧率持续过低时降低粒子数量
      if (this.settings.quality === 'auto' && this.mode === 'battle' && this.fps < 40 && this.profile.tier !== 'low') {
        this.profile = profileFor(lowerTier(this.profile.tier));
        this.particles.setMax(this.profile.maxParticles);
      }
    }
  }

  private drainEvents() {
    const sim = this.sim!;
    for (const e of sim.events) {
      if (e.t === 'death') this.lastDeath = { x: this.sx(e.x), y: this.sy(e.y) };
      if (e.t === 'revive') {
        const v = this.views.get(e.uid);
        if (v) {
          v.deathT = -1;
          v.root.visible = true;
          v.root.alpha = 1;
          v.body.rotation = 0;
        }
      }
      this.fx.handle(e);
    }
    sim.events.length = 0;
  }

  private beginEnding() {
    if (this.mode !== 'battle') return;
    this.mode = 'ended';
    this.endTimer = 2.0;
    // 最后一击：击杀特写 + 慢动作
    if (this.lastDeath) this.camera.setZoom(1.14, this.lastDeath, 0.7);
    this.camera.slowmo(0.7, 0.3);
    AudioManager.play('explosion', { volume: 0.4 });
  }

  private celebrate() {
    const out = this.sim?.outcome;
    if (!out) return;
    const { w, h } = this.size();
    this.camera.setZoom(0.94, { x: w / 2, y: h / 2 }, 0.8);
    if (out.winner === 0) {
      const P = this.particles;
      P.burst(70, () =>
        P.emit(this.sprites.effect(Math.random() < 0.5 ? 'star_04' : 'star_07'), {
          x: Math.random() * w, y: h + 10, vx: (Math.random() - 0.5) * 120, vy: -300 - Math.random() * 300, ay: 260, life: 1.6,
          scale: 0.08 * this.unitScale(), scaleEnd: 0.02, tint: [0xffd23a, 0x4aa3ff, 0xffffff, 0x6dff8a][Math.floor(Math.random() * 4)], spin: 6,
        }),
      );
    }
  }

  private drawRage() {
    const { w, h } = this.size();
    const g = this.rageOverlay;
    g.clear();
    const a = 0.12 + Math.sin(this.time * 6) * 0.06;
    const t = Math.max(12, w * 0.04);
    g.rect(0, 0, w, t).fill({ color: 0xff1a1a, alpha: a });
    g.rect(0, h - t, w, t).fill({ color: 0xff1a1a, alpha: a });
    g.rect(0, 0, t, h).fill({ color: 0xff1a1a, alpha: a });
    g.rect(w - t, 0, t, h).fill({ color: 0xff1a1a, alpha: a });
  }

  // ------------------------------------------------------------ 单位
  private syncViews(initial: boolean) {
    const sim = this.sim!;
    for (const team of sim.teams) {
      for (const u of team.units) {
        if (u.removed) {
          const v = this.views.get(u.uid);
          if (v) {
            v.root.destroy({ children: true });
            this.views.delete(u.uid);
          }
          continue;
        }
        if (this.views.has(u.uid)) continue;
        if (!u.alive && !initial) continue;
        const v = new UnitView(u, this.sprites.unit(u.cfg), this.sprites.effect('shadow'), this.sprites.effect('star_06'));
        if (!initial) v.spawnT = 0.3;
        if (u.cfg.untargetable) v.body.alpha = 0.55;
        if (u.isBoss) {
          v.crown = new Sprite(this.sprites.effect('star_01'));
          v.crown.anchor.set(0.5);
          v.crown.tint = 0xffd23a;
          v.crown.blendMode = 'add';
          v.root.addChildAt(v.crown, 1);
        }
        this.layers.units.addChild(v.root);
        this.views.set(u.uid, v);
      }
    }
  }

  private renderUnits(alpha: number, dt: number) {
    const us = this.unitScale();
    const t = this.time;
    for (const v of this.views.values()) {
      const u = v.unit;
      const y = u.prevY + (u.y - u.prevY) * alpha;
      const sx = this.sx(u.x);
      const sy = this.sy(y);
      v.root.position.set(sx, sy);
      v.root.zIndex = sy + (u.flying ? 2000 : 0);
      const scale = us * u.cfg.sprite.scale * (u.isBoss ? 1.4 : 1);
      // 生成动画
      let pop = 1;
      if (v.spawnT > 0) {
        v.spawnT -= dt;
        pop = Math.max(0, 1 - v.spawnT / 0.35);
      }
      // 死亡动画：倒下、淡出
      if (!u.alive) {
        if (v.deathT < 0) v.deathT = 0;
        v.deathT += dt;
        const k = Math.min(1, v.deathT / 0.5);
        v.body.rotation = (u.team === 0 ? 1 : -1) * k * 1.4;
        v.root.alpha = 1 - k;
        v.bar.visible = false;
        v.status.visible = false;
        if (k >= 1) v.root.visible = false;
        continue;
      }
      v.bar.visible = true;
      const facing = (u.team === 1) !== this.flip ? -1 : 1;
      v.body.scale.set(scale * pop * facing, scale * pop);
      // 动作：行走摆动、攻击突进、施法放大、飞行悬浮
      let bob = 0;
      let lunge = 0;
      if (this.mode === 'battle') {
        if (u.state === 'MOVE') bob = Math.abs(Math.sin(t * 11 + u.uid)) * 2.2 * (us / 2);
        if (u.attackAnim > 0) lunge = (u.attackAnim / 0.18) * 5 * (us / 2) * (u.team === 0 ? -1 : 1);
      } else {
        bob = Math.abs(Math.sin(t * 2 + u.uid)) * 1.2;
      }
      const flyY = u.flying ? -14 * us + Math.sin(t * 3 + u.uid) * 3 : 0;
      v.body.position.set(0, -bob + lunge + flyY);
      if (u.castAnim > 0) v.body.scale.set(scale * facing * (1 + u.castAnim * 0.4), scale * (1 + u.castAnim * 0.4));
      v.shadow.scale.set((scale * (u.cfg.size >= 18 ? 1.3 : 1)) / 2.2, scale / 2.6);
      v.shadow.alpha = u.flying ? 0.35 : 0.7;
      // 阵营光圈
      if (v.ring.label !== `${u.team}`) {
        v.ring.label = `${u.team}`;
        v.ring.clear();
        v.ring.ellipse(0, 0, 7, 2.6).stroke({ width: 1.2, color: TEAM_COLOR[u.team], alpha: 0.9 });
      }
      v.ring.scale.set(scale * (u.cfg.size >= 18 ? 1.3 : 1) * 0.9);
      // 状态着色
      let st = 0xffffff;
      if (u.hitFlash > 0) st = 0xff9090;
      else if (u.freezeT > 0) st = 0x8fdcff;
      else if (u.burnT > 0) st = Math.sin(t * 20) > 0 ? 0xffb070 : 0xffffff;
      else if (u.poisonT > 0) st = 0xa8ff90;
      else if (u.slowT > 0) st = 0xc8e8ff;
      v.body.tint = mulTint(v.baseTint, st);
      const stunned = u.stunT > 0 || u.rootT > 0;
      v.status.visible = stunned;
      if (stunned) {
        v.status.position.set(0, -16 * scale + flyY);
        v.status.rotation = t * 6;
        v.status.scale.set(0.04 * us);
        v.status.tint = u.rootT > 0 ? 0x7ad860 : 0xffe060;
      }
      if (v.crown) {
        v.crown.position.set(0, -17 * scale + flyY);
        v.crown.scale.set(0.05 * us + Math.sin(t * 4) * 0.005);
      }
      // 生命条（仅在变化时重绘）
      if (u.hp !== v.lastHp || u.shield !== v.lastShield) {
        v.lastHp = u.hp;
        v.lastShield = u.shield;
        const bw = Math.max(14, 10 * scale * (u.cfg.size >= 18 ? 0.7 : 1));
        const bh = Math.max(2.5, us * 1.3);
        const by = -16 * scale - 4 + flyY;
        const g = v.bar;
        g.clear();
        g.rect(-bw / 2 - 1, by - 1, bw + 2, bh + 2).fill({ color: 0x000000, alpha: 0.7 });
        const ratio = Math.max(0, u.hp / u.maxHp);
        g.rect(-bw / 2, by, bw * ratio, bh).fill(u.team === 0 ? 0x5ad06a : 0xff4a5a);
        if (u.shield > 0) g.rect(-bw / 2, by - bh * 0.6, bw * Math.min(1, u.shield / u.maxHp), bh * 0.5).fill(0x9fe4ff);
        if (u.isBoss) g.rect(-bw / 2 - 1, by - 1, bw + 2, bh + 2).stroke({ width: 1, color: 0xffd23a });
      }
      if (u.squad > 1 && u.squad !== v.lastSquad) {
        v.lastSquad = u.squad;
        if (!v.badge) {
          v.badge = new BitmapText({ text: '', style: { fontFamily: 'DmgFont', fontSize: 40 } });
          v.badge.anchor.set(0, 0.5);
          v.root.addChild(v.badge);
        }
        v.badge.text = `×${u.squad}`;
        v.badge.scale.set(0.22);
        v.badge.tint = 0xffe08a;
        v.badge.position.set(6 * scale * 0.6, -6);
      }
    }
  }

  private ghost(uid: number, fromY: number, toY: number, tint: number) {
    const v = this.views.get(uid);
    if (!v) return;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const y = fromY + ((toY - fromY) * i) / n;
      const s = this.anim.pop(this.layers.units, v.body.texture, this.sx(v.unit.x), this.sy(y), {
        life: 0.35, scale: Math.abs(v.body.scale.y), tint, alpha: 0.5 * ((i + 1) / n), add: true, anchorY: 1, delay: i * 0.02,
      });
      s.zIndex = this.sy(y);
    }
  }

  // ------------------------------------------------------------ 投射物
  private projTexture(p: Projectile): { tex: Texture; scale: number; add: boolean; rot: boolean } {
    const S = this.sprites;
    switch (p.kind) {
      case 'arrow':
      case 'icearrow':
        return { tex: S.effect('proj_arrow'), scale: 0.8, add: false, rot: true };
      case 'bolt':
        return { tex: S.effect('proj_bolt'), scale: 0.8, add: false, rot: true };
      case 'bullet':
        return { tex: S.effect('proj_bullet'), scale: 0.8, add: true, rot: true };
      case 'javelin':
        return { tex: S.effect('proj_javelin'), scale: 0.8, add: false, rot: true };
      case 'shell':
        return { tex: S.effect('proj_shell'), scale: 0.9, add: false, rot: false };
      case 'rocket':
      case 'missile':
        return { tex: S.effect('proj_rocket'), scale: 0.7, add: false, rot: true };
      case 'fireball':
        return { tex: S.effect('flare_01'), scale: 0.12, add: true, rot: false };
      case 'iceshard':
        return { tex: S.effect('ice_shard'), scale: 0.25, add: true, rot: true };
      case 'spark':
        return { tex: S.effect('spark_04'), scale: 0.09, add: true, rot: false };
      case 'holy':
        return { tex: S.effect('light_01'), scale: 0.1, add: true, rot: false };
      case 'dark':
        return { tex: S.effect('magic_01'), scale: 0.1, add: true, rot: false };
      case 'poison':
        return { tex: S.effect('circle_05'), scale: 0.08, add: true, rot: false };
      case 'arcane':
        return { tex: S.effect('magic_03'), scale: 0.12, add: true, rot: false };
      default:
        return { tex: S.effect('proj_orb'), scale: 0.8, add: true, rot: false };
    }
  }

  private renderProjectiles(alpha: number, dt: number) {
    const sim = this.sim!;
    const us = this.unitScale();
    const seen = new Set<number>();
    for (const p of sim.projectiles) {
      if (!p.alive) continue;
      seen.add(p.id);
      let s = this.projViews.get(p.id);
      const info = this.projTexture(p);
      if (!s) {
        s = new Sprite(info.tex);
        s.anchor.set(0.5);
        s.blendMode = info.add ? 'add' : 'normal';
        this.layers.air.addChild(s);
        this.projViews.set(p.id, s);
      }
      s.tint = p.tint;
      const x = this.sx(p.prevX + (p.x - p.prevX) * alpha);
      let y = this.sy(p.prevY + (p.y - p.prevY) * alpha) - 10 * us;
      if (p.arc) {
        const prog = Math.min(1, p.traveled / Math.max(1, p.total));
        y -= Math.sin(prog * Math.PI) * this.len(90) * p.arc;
      }
      if (info.rot) {
        const dy = p.ty - p.y;
        const dx = (p.tx - p.x) * 200;
        s.rotation = Math.atan2(dy, dx) + Math.PI / 2;
      } else s.rotation += dt * 8;
      // 屏幕外不渲染
      const { w, h } = this.size();
      s.visible = x > -40 && x < w + 40 && y > -40 && y < h + 40;
      s.position.set(x, y);
      s.scale.set(info.scale * us);
      if (dt > 0 && (p.kind === 'fireball' || p.kind === 'rocket' || p.kind === 'missile' || p.kind === 'arcane') && Math.random() < this.particles.density) {
        this.particles.emit(this.sprites.effect(p.kind === 'fireball' ? 'flame_02' : p.kind === 'arcane' ? 'magic_05' : 'smoke_07'), {
          x, y, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 0.35, scale: 0.05 * us, scaleEnd: 0.01 * us,
          tint: p.kind === 'fireball' ? 0xff8030 : p.kind === 'arcane' ? 0xd78cff : 0xbbbbbb, add: p.kind !== 'rocket' && p.kind !== 'missile', alpha: 0.7,
        });
      }
    }
    for (const [id, s] of this.projViews) {
      if (!seen.has(id)) {
        s.destroy();
        this.projViews.delete(id);
      }
    }
  }

  // ------------------------------------------------------------ 区域效果
  private renderZones(dt: number) {
    const sim = this.sim!;
    const us = this.unitScale();
    const seen = new Set<number>();
    for (const z of sim.zones) {
      seen.add(z.id);
      let c = this.zoneViews.get(z.id);
      if (!c) {
        c = this.makeZone(z);
        this.layers.ground.addChild(c);
        this.zoneViews.set(z.id, c);
      }
      const x = this.sx(z.x);
      const y = this.sy(z.y);
      c.position.set(x, y);
      const r = this.len(z.radius);
      const life = 1 - z.t / z.duration;
      c.alpha = Math.min(1, life * 3);
      for (const [i, ch] of c.children.entries()) ch.rotation += dt * (z.kind === 'tornado' ? 9 + i * 3 : 1.5) * (i % 2 ? -1 : 1);
      c.scale.set(r / 60);
      if (dt > 0 && Math.random() < 0.5 * this.particles.density) {
        const tex = z.kind === 'fire' ? 'flame_01' : z.kind === 'poison' ? 'smoke_02' : z.kind === 'tornado' ? 'smoke_04' : 'magic_05';
        const col = z.kind === 'fire' ? 0xff7a2a : z.kind === 'poison' ? 0x7ad850 : z.kind === 'tornado' ? 0xd0f0ff : 0x8fdcff;
        this.particles.emit(this.sprites.effect(tex), {
          x: x + (Math.random() - 0.5) * r * 2, y: y + (Math.random() - 0.5) * r * 0.6, vy: z.kind === 'tornado' ? -120 : -30,
          life: 0.7, scale: 0.04 * us, scaleEnd: 0.1 * us, tint: col, alpha: 0.6,
        });
      }
    }
    for (const [id, c] of this.zoneViews) {
      if (!seen.has(id)) {
        c.destroy({ children: true });
        this.zoneViews.delete(id);
      }
    }
  }

  private makeZone(z: Zone): Container {
    const c = new Container();
    const S = this.sprites;
    const add = (tex: string, tint: number, sc: number, alpha: number, sy = 0.45) => {
      const s = new Sprite(S.effect(tex));
      s.anchor.set(0.5);
      s.tint = tint;
      s.blendMode = 'add';
      s.alpha = alpha;
      s.scale.set(sc, sc * sy);
      c.addChild(s);
      return s;
    };
    if (z.kind === 'tornado') {
      const a = add('twirl_03', 0xd0f0ff, 0.9, 0.8, 1.2);
      const b = add('twirl_01', 0x9fd8ff, 0.7, 0.7, 1.4);
      a.anchor.set(0.5, 0.8);
      b.anchor.set(0.5, 0.9);
    } else if (z.kind === 'poison') {
      add('smoke_07', 0x6ad040, 1.0, 0.5);
      add('smoke_04', 0x9aff70, 0.8, 0.4);
    } else if (z.kind === 'fire') {
      add('scorch_01', 0xff6a20, 0.9, 0.5);
      add('fire_02', 0xff8a30, 0.7, 0.6, 0.6);
    } else {
      add('symbol_01', 0x8fdcff, 1.0, 0.5);
      add('circle_05', 0x6ab8ff, 1.0, 0.3);
    }
    return c;
  }
}
