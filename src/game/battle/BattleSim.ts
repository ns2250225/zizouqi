import { BALANCE, COMBOS, getUnit, SKILL_MAP } from '../data/ConfigLoader';
import { Rng } from '../core/rng';
import type {
  ArmySpec, BattleOutcome, BattleSetup, Element, Rarity, Team, UnitConfig, UnitDamageStat,
} from '../core/types';
import { resolveStats } from '../units/UnitStats';
import { castActive, castSpellAt, onAttackPassives } from '../skills/SkillSystem';
import type {
  BattleEvent, BattleUnit, DamagePacket, Delayed, Projectile, ProjectileKind, StatusApply, Zone,
} from './BattleTypes';
import { SpatialIndex } from './SpatialIndex';

const B = BALANCE.battle;
export const FIELD = B.fieldLength;

const PROJECTILE_SPEED: Record<ProjectileKind, number> = {
  arrow: 620, icearrow: 620, bolt: 680, bullet: 1200, javelin: 520, shell: 380, rocket: 460, fireball: 400,
  iceshard: 540, spark: 760, holy: 640, dark: 520, poison: 520, arcane: 560, missile: 420,
};
const PROJECTILE_TINT: Partial<Record<ProjectileKind, number>> = {
  icearrow: 0x9fe4ff, fireball: 0xff7a2a, iceshard: 0x9fe4ff, spark: 0xfff27a, holy: 0xfff3b0, dark: 0xb070ff,
  poison: 0x8fe860, arcane: 0xd78cff,
};
const RARITY_RANK: Record<Rarity, number> = { COMMON: 0, RARE: 1, EPIC: 2, LEGENDARY: 3, MYTHIC: 4 };

export interface TeamCtx {
  spec: ArmySpec;
  flags: Record<string, number>;
  units: BattleUnit[];
  index: SpatialIndex;
  mageSpellT: number;
  initialHp: number;
}

export class BattleSim {
  readonly setup: BattleSetup;
  readonly rng: Rng;
  readonly dt = B.dt;
  time = 0;
  finished = false;
  outcome: BattleOutcome | null = null;
  teams: [TeamCtx, TeamCtx];
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  delayed: Delayed[] = [];
  events: BattleEvent[] = [];
  rageAnnounced = false;
  private uidSeq = 1;
  private projSeq = 1;
  private zoneSeq = 1;
  stats = new Map<string, UnitDamageStat>();
  private unitById = new Map<number, BattleUnit>();
  kills: [number, number] = [0, 0];
  topSingle: { name: string; unit: string; team: Team; damage: number } | null = null;
  private unitDamage = new Map<number, number>();
  private openingDone = false;

  constructor(setup: BattleSetup) {
    this.setup = setup;
    this.rng = new Rng(setup.seed);
    this.teams = [this.makeTeam(setup.player), this.makeTeam(setup.enemy)];
    this.deploy(0);
    this.deploy(1);
    for (const t of [0, 1] as Team[]) {
      const ctx = this.teams[t];
      ctx.index.rebuild(ctx.units);
      ctx.initialHp = ctx.units.reduce((s, u) => s + (u.cfg.nonCombatant ? 0 : u.maxHp), 0);
    }
  }

  private makeTeam(spec: ArmySpec): TeamCtx {
    return { spec, flags: { ...spec.flags }, units: [], index: new SpatialIndex(), mageSpellT: 0, initialHp: 1 };
  }

  flag(team: Team, f: string): number {
    return this.teams[team].flags[f] ?? 0;
  }

  dirOf(team: Team): number {
    return team === 0 ? -1 : 1;
  }

  enemyOf(team: Team): Team {
    return team === 0 ? 1 : 0;
  }

  emit(e: BattleEvent) {
    this.events.push(e);
  }

  // ------------------------------------------------------------------ 部署
  private deploy(team: Team) {
    const ctx = this.teams[team];
    const groups: Record<'front' | 'mid' | 'back' | 'mine', UnitConfig[]> = { front: [], mid: [], back: [], mine: [] };
    for (const entry of ctx.spec.units) {
      const cfg = getUnit(entry.unit);
      for (let i = 0; i < entry.count; i++) {
        if (cfg.skills.includes('mine_trap')) groups.mine.push(cfg);
        else groups[cfg.role].push(cfg);
      }
    }
    if (ctx.spec.boss) groups.front.unshift(getUnit(ctx.spec.boss));
    const spawn = B.spawn as Record<string, number[]>;
    const ranges: Record<string, [number, number]> = {
      front: spawn.front as [number, number],
      mid: spawn.mid as [number, number],
      back: spawn.back as [number, number],
      mine: [470, 560],
    };
    let bossPlaced = false;
    for (const key of ['front', 'mid', 'back', 'mine'] as const) {
      const list = groups[key];
      if (!list.length) continue;
      // 大型单位优先放在中线
      const [y0, y1] = ranges[key];
      const lanes = key === 'mine' ? 5 : 7;
      const rows = Math.ceil(list.length / lanes);
      const step = Math.min(22, (y1 - y0) / Math.max(1, rows));
      list.forEach((cfg, i) => {
        const row = Math.floor(i / lanes);
        const lane = i % lanes;
        const laneX = (lane / (lanes - 1)) * 2 - 1;
        let y = y0 + row * step + this.rng.range(-4, 4);
        if (key === 'mine') y = this.rng.range(y0, y1);
        const x = cfg.size >= 18 ? this.rng.range(-0.25, 0.25) : laneX * 0.85 + this.rng.range(-0.06, 0.06);
        const isBoss = !bossPlaced && ctx.spec.boss === cfg.id && key === 'front' && i === 0;
        if (isBoss) bossPlaced = true;
        this.spawnUnit(cfg, team, team === 0 ? y : FIELD - y, x, { boss: isBoss, initial: true });
      });
    }
  }

  spawnUnit(
    cfg: UnitConfig, team: Team, y: number, x: number,
    opts: { summon?: boolean; boss?: boolean; initial?: boolean } = {},
  ): BattleUnit | null {
    const ctx = this.teams[team];
    const aliveCount = ctx.index.sorted.length || ctx.units.filter((u) => u.alive).length;
    if (!opts.initial && aliveCount >= this.setup.unitCap) {
      // 超出上限：编队合并，保留战斗数值
      const host = ctx.units.find((u) => u.alive && u.cfg.id === cfg.id);
      if (host) {
        const add = host.maxHp / host.squad;
        host.squad += 1;
        host.maxHp += add;
        host.hp += add;
        host.attack *= host.squad / (host.squad - 1);
        return null;
      }
    } else if (opts.initial && ctx.units.length >= this.setup.unitCap) {
      const host = ctx.units.find((u) => u.cfg.id === cfg.id && !u.isBoss);
      if (host) {
        const add = host.maxHp / host.squad;
        host.squad += 1;
        host.maxHp += add;
        host.hp += add;
        host.attack *= host.squad / (host.squad - 1);
        return null;
      }
    }
    const s = resolveStats(cfg, ctx.spec.mods, ctx.spec.statMult);
    let hpMult = 1;
    let atkMult = 1;
    if (opts.summon || cfg.summon) {
      hpMult += this.flag(team, 'summonHp');
      atkMult += this.flag(team, 'summonHp');
    }
    if (opts.boss) {
      hpMult *= BALANCE.enemy.bossStatMult;
      atkMult *= 1 + (BALANCE.enemy.bossStatMult - 1) * 0.4;
    }
    const passives: BattleUnit['passives'] = {};
    const actives: BattleUnit['actives'] = [];
    for (const sid of cfg.skills) {
      const def = SKILL_MAP.get(sid);
      if (!def) continue;
      if (def.trigger === 'active') actives.push({ def, timer: def.initialDelay + this.rng.range(0, 0.4) });
      else passives[def.kind] = def;
    }
    const revive = passives.revive;
    let revives = revive ? (revive.params.times as number) : 0;
    if (cfg.id === 'phoenix' && this.flag(team, 'eternalFlame')) revives += 1;
    const u: BattleUnit = {
      uid: this.uidSeq++,
      cfg,
      team,
      y,
      prevY: y,
      x,
      hp: s.maxHp * hpMult,
      maxHp: s.maxHp * hpMult,
      attack: s.attack * atkMult,
      defense: s.defense,
      attackSpeed: s.attackSpeed,
      moveSpeed: s.moveSpeed,
      attackRange: s.attackRange,
      critChance: s.critChance,
      critDamage: s.critDamage,
      armorPenetration: s.armorPenetration,
      knockbackResistance: opts.boss ? 1 : s.knockbackResistance,
      damageTaken: s.damageTaken,
      cooldownMult: s.cooldownMult,
      size: cfg.size * (opts.boss ? 1.4 : 1),
      flying: cfg.flying,
      alive: true,
      removed: false,
      state: 'SPAWN',
      atkTimer: this.rng.range(0.1, 0.6),
      passives,
      actives,
      targetUid: -1,
      retargetTimer: 0,
      stunT: 0,
      freezeT: 0,
      rootT: 0,
      slowT: 0,
      slowV: 0,
      burnT: 0,
      burnDps: 0,
      poisonT: 0,
      poisonDps: 0,
      hasteT: 0,
      shield: 0,
      revivesLeft: revives,
      cheatDeathUsed: false,
      ignoreBlock: false,
      isSummon: !!opts.summon || cfg.summon,
      isBoss: !!opts.boss,
      squad: 1,
      threat: 0,
      deadTime: 0,
      hitFlash: 0,
      attackAnim: 0,
      castAnim: 0,
      specialUsed: false,
      statKey: `${team}:${cfg.id}`,
    };
    u.threat = u.attack * u.attackSpeed * (1 + u.critChance) + (cfg.unitClass === 'mage' ? 20 : 0);
    // 开局护盾类效果
    let shieldPct = this.flag(team, 'startShield');
    if (cfg.faction === 'mech') shieldPct += this.flag(team, 'mechShield');
    if (cfg.role === 'front') shieldPct += this.flag(team, 'frontShield');
    if (shieldPct > 0 && opts.initial) u.shield = u.maxHp * shieldPct;
    ctx.units.push(u);
    this.unitById.set(u.uid, u);
    if (!opts.initial) ctx.index.rebuild(ctx.units);
    this.emit({ t: 'spawn', uid: u.uid, summon: !opts.initial });
    return u;
  }

  findUnit(uid: number): BattleUnit | undefined {
    return this.unitById.get(uid);
  }

  // ------------------------------------------------------------------ 主循环
  step() {
    if (this.finished) return;
    const dt = this.dt;
    this.time += dt;
    for (const ctx of this.teams) ctx.index.rebuild(ctx.units);

    if (!this.openingDone && this.time >= 0.6) {
      this.openingDone = true;
      this.opening(0);
      this.opening(1);
    }
    if (!this.rageAnnounced && this.time >= B.rageStart) {
      this.rageAnnounced = true;
      this.emit({ t: 'rage' });
      this.emit({ t: 'log', text: '狂暴阶段！双方伤害持续提升', team: 0 });
    }

    // 延迟效果（陨石落地等）
    if (this.delayed.length) {
      const due = this.delayed.filter((d) => d.at <= this.time);
      if (due.length) {
        this.delayed = this.delayed.filter((d) => d.at > this.time);
        due.forEach((d) => d.fn());
      }
    }

    for (const team of [0, 1] as Team[]) {
      const ctx = this.teams[team];
      const mageInterval = this.flag(team, 'mageSpell');
      if (mageInterval > 0) {
        ctx.mageSpellT += dt;
        if (ctx.mageSpellT >= mageInterval) {
          ctx.mageSpellT = 0;
          this.teamRandomSpell(team);
        }
      }
      const regen = this.flag(team, 'holyRegen');
      for (const u of ctx.units) {
        if (!u.alive) continue;
        if (regen > 0) this.heal(u, u.maxHp * regen * dt, null, true);
        this.updateUnit(u, dt);
      }
    }
    this.updateProjectiles(dt);
    this.updateZones(dt);
    this.cleanup();
    this.checkEnd();
  }

  private opening(team: Team) {
    const enemy = this.enemyOf(team);
    const scale = 1 + this.setup.round * 0.1;
    for (const sp of this.teams[team].spec.spells) {
      if (sp.spell === 'meteor_shower') {
        for (let i = 0; i < sp.value; i++) {
          const target = this.pickCluster(enemy);
          if (target) castSpellAt(this, null, team, 'meteor', target.y, target.x, 70 * scale, 0.5 + i * 0.45);
        }
        this.emit({ t: 'log', text: '陨石召唤：天降陨石！', team });
      }
      if (sp.spell === 'arrow_rain') {
        const idx = this.teams[enemy].index.sorted;
        if (idx.length) {
          this.emit({ t: 'arrowRain', team, y0: idx[0].y, y1: idx[idx.length - 1].y });
          this.delayed.push({
            at: this.time + 0.7,
            fn: () => {
              for (const u of [...this.teams[enemy].index.sorted]) {
                if (u.cfg.untargetable) continue;
                this.dealDamage(u, this.packet(null, team, 22 * scale, 1, 'physical', { label: '箭雨' }));
              }
            },
          });
        }
        this.emit({ t: 'log', text: '箭雨覆盖敌军全线！', team });
      }
    }
    if (this.flag(team, 'openingBombard')) {
      this.emit({ t: 'log', text: '开局轰炸！', team });
      for (let i = 0; i < 5; i++) {
        const target = this.pickCluster(enemy) ?? this.teams[enemy].index.sorted[0];
        if (!target) break;
        const y = target.y + this.rng.range(-30, 30);
        const x = this.rng.range(-0.8, 0.8);
        this.emit({ t: 'meteorWarn', x, y, radius: 60, delay: 0.5 + i * 0.25 });
        this.delayed.push({
          at: this.time + 0.5 + i * 0.25,
          fn: () => this.explode(null, team, y, x, 60, 45 * scale, 'explosive', 'explosion_mid', 1),
        });
      }
    }
    const chargeT = this.flag(team, 'chargeStart');
    if (chargeT > 0) {
      for (const u of this.teams[team].units) u.hasteT = chargeT;
      this.emit({ t: 'log', text: '全军冲锋！', team });
    }
    if (this.flag(team, 'knightCharge')) {
      for (const u of this.teams[team].units) {
        if (!u.alive || !u.cfg.tags.includes('knight')) continue;
        const def = SKILL_MAP.get('knight_charge')!;
        castActive(this, u, def, true);
      }
      this.emit({ t: 'log', text: '骑士团：开局冲锋！', team });
    }
    for (const id of this.teams[team].spec.combos) {
      const combo = COMBOS.find((c) => c.id === id);
      if (combo && team === 0) this.emit({ t: 'combo', name: combo.name, color: combo.color });
    }
  }

  private teamRandomSpell(team: Team) {
    const mages = this.teams[team].units.filter((u) => u.alive && u.cfg.unitClass === 'mage');
    if (!mages.length) return;
    const caster = this.rng.pick(mages);
    const spell = this.rng.pick(['meteor', 'chain_lightning', 'frost_nova', 'fireball']);
    const def = SKILL_MAP.get(spell);
    if (def) castActive(this, caster, def, true);
  }

  // ------------------------------------------------------------------ 单位 AI
  private updateUnit(u: BattleUnit, dt: number) {
    u.prevY = u.y;
    if (u.hitFlash > 0) u.hitFlash -= dt;
    if (u.attackAnim > 0) u.attackAnim -= dt;
    if (u.castAnim > 0) u.castAnim -= dt;
    this.tickStatus(u, dt);
    if (!u.alive) return;
    if (u.hasteT > 0) u.hasteT -= dt;

    // 地雷：敌人经过时触发
    const mine = u.passives.mine;
    if (mine) {
      const trig = mine.params.trigger as number;
      const foe = this.teams[this.enemyOf(u.team)].index.nearest(u.y, (e) => !e.flying && !e.cfg.untargetable);
      if (foe && Math.abs(foe.y - u.y) <= trig + foe.size * 0.5) {
        const radius = (mine.params.radius as number) * (1 + this.flag(u.team, 'explosiveRadius'));
        const dmg = (mine.params.flat as number) * (1 + this.setup.round * 0.08) * this.teams[u.team].spec.statMult;
        this.explode(u, u.team, u.y, u.x, radius, dmg, 'explosive', mine.fx ?? 'explosion_mid', 1);
        this.kill(u, null, true);
      }
      return;
    }

    if (u.stunT > 0 || u.freezeT > 0) {
      u.state = 'STUN';
      return;
    }

    // 主动技能
    for (const a of u.actives) {
      a.timer -= dt;
      if (a.timer <= 0) {
        if (castActive(this, u, a.def, false)) {
          a.timer = a.def.cooldown * u.cooldownMult;
          u.state = 'CAST';
          u.castAnim = 0.35;
        } else {
          a.timer = 0.3;
        }
        if (!u.alive) return;
      }
    }

    // 目标选择
    u.retargetTimer -= dt;
    let target = u.targetUid > 0 ? this.findAliveEnemy(u, u.targetUid) : null;
    if (!target || u.retargetTimer <= 0) {
      u.state = 'TARGET';
      target = this.selectTarget(u);
      u.targetUid = target ? target.uid : -1;
      u.retargetTimer = B.retargetInterval;
    }

    const inRange = target ? this.edgeDist(u, target) <= u.attackRange : false;
    // 自爆单位：接敌即爆
    const contact = u.passives.contactExplode;
    if (contact && target && this.edgeDist(u, target) <= (contact.params.trigger as number)) {
      const radius = (contact.params.radius as number) * (1 + this.flag(u.team, 'explosiveRadius'));
      this.explode(u, u.team, u.y, u.x, radius, u.attack * (contact.params.dmgMult as number), 'explosive', contact.fx ?? 'explosion_big', 1);
      this.kill(u, null, true);
      return;
    }

    if (target && inRange) {
      u.state = 'ATTACK';
      u.atkTimer -= dt * this.attackSpeedMult(u);
      if (u.atkTimer <= 0) {
        u.atkTimer += 1 / Math.max(0.05, u.attackSpeed);
        if (u.atkTimer < 0) u.atkTimer = 0;
        this.performAttack(u, target);
      }
      return;
    }
    u.atkTimer = Math.max(0, u.atkTimer - dt * 0.5);
    if (u.rootT > 0 || u.moveSpeed <= 0) {
      u.state = 'IDLE';
      return;
    }
    u.state = 'MOVE';
    this.move(u, dt, target);
  }

  attackSpeedMult(u: BattleUnit): number {
    let m = 1;
    const berserk = u.passives.berserk;
    if (berserk) m += (1 - u.hp / u.maxHp) * (berserk.params.maxBonus as number);
    if (u.slowT > 0) m *= 1 - u.slowV * 0.5;
    if (u.hasteT > 0) m *= 1.2;
    return m;
  }

  private move(u: BattleUnit, dt: number, target: BattleUnit | null) {
    const dir = this.dirOf(u.team);
    let speed = u.moveSpeed;
    if (u.slowT > 0) speed *= 1 - u.slowV;
    if (u.hasteT > 0) speed *= 1.6;
    let dy = dir * speed * dt;
    // 目标在身后（如被刺客越过）时回头
    if (target && Math.sign(target.y - u.y) !== dir && Math.abs(target.y - u.y) > 4) dy = -dy;
    let ny = u.y + dy;
    if (!u.flying && !u.ignoreBlock) {
      // 地面单位不能穿过敌方地面前排
      const enemy = this.teams[this.enemyOf(u.team)].index;
      const blocker = dir < 0
        ? enemy.last((e) => !e.flying && !e.cfg.untargetable)
        : enemy.first((e) => !e.flying && !e.cfg.untargetable);
      if (blocker) {
        const gap = (u.size + blocker.size) * 0.5;
        if (dir < 0 && ny < blocker.y + gap && u.y >= blocker.y) ny = Math.max(ny, blocker.y + gap);
        if (dir > 0 && ny > blocker.y - gap && u.y <= blocker.y) ny = Math.min(ny, blocker.y - gap);
      }
    }
    u.y = Math.min(FIELD - 10, Math.max(10, ny));
  }

  edgeDist(a: BattleUnit, b: BattleUnit): number {
    return Math.max(0, Math.abs(a.y - b.y) - (a.size + b.size) * 0.5);
  }

  private findAliveEnemy(u: BattleUnit, uid: number): BattleUnit | null {
    const e = this.unitById.get(uid);
    return e && e.alive && e.team !== u.team ? e : null;
  }

  targetable = (e: BattleUnit) => e.alive && !e.cfg.untargetable;

  selectTarget(u: BattleUnit): BattleUnit | null {
    const idx = this.teams[this.enemyOf(u.team)].index;
    const nearest = idx.nearest(u.y, this.targetable);
    if (!nearest) return null;
    const window = u.attackRange + 160;
    switch (u.cfg.targetPriority) {
      case 'LOWEST_HP':
      case 'HIGHEST_HP': {
        const cands = idx.inRange(u.y - window, u.y + window, this.targetable);
        if (!cands.length) return nearest;
        const sign = u.cfg.targetPriority === 'LOWEST_HP' ? 1 : -1;
        return cands.reduce((best, c) => (sign * (c.hp - best.hp) < 0 ? c : best));
      }
      case 'BACKLINE':
        return (u.team === 0 ? idx.first(this.targetable) : idx.last(this.targetable)) ?? nearest;
      case 'RANDOM': {
        const cands = idx.inRange(u.y - window, u.y + window, this.targetable);
        return cands.length ? this.rng.pick(cands) : nearest;
      }
      case 'MOST_DANGEROUS': {
        const cands = idx.inRange(u.y - window - 200, u.y + window + 200, this.targetable);
        if (!cands.length) return nearest;
        return cands.reduce((best, c) => (c.threat > best.threat ? c : best));
      }
      case 'AREA_CLUSTER':
        return this.pickCluster(this.enemyOf(u.team), u.y, window) ?? nearest;
      default:
        return nearest;
    }
  }

  /** 最密集敌群：对候选单位统计 ±60 范围内的单位数（二分查找） */
  pickCluster(team: Team, aroundY?: number, window?: number): BattleUnit | null {
    const idx = this.teams[team].index;
    const cands = aroundY === undefined
      ? idx.sorted.filter(this.targetable)
      : idx.inRange(aroundY - window!, aroundY + window!, this.targetable);
    let best: BattleUnit | null = null;
    let bestN = -1;
    const stride = Math.max(1, Math.floor(cands.length / 24));
    for (let i = 0; i < cands.length; i += stride) {
      const c = cands[i];
      const n = idx.countRange(c.y - 60, c.y + 60);
      if (n > bestN) {
        bestN = n;
        best = c;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ 攻击
  packet(src: BattleUnit | null, team: Team, attack: number, mult: number, element: Element, extra: Partial<DamagePacket> = {}): DamagePacket {
    return {
      src,
      team,
      attack,
      mult,
      element,
      pen: src?.armorPenetration ?? 0,
      critChance: src?.critChance ?? 0,
      critDamage: src?.critDamage ?? 1.5,
      isSkill: false,
      melee: false,
      ...extra,
    };
  }

  private performAttack(u: BattleUnit, target: BattleUnit) {
    u.attackAnim = 0.18;
    const cfg = u.cfg;
    const ranged = !!cfg.projectile;
    this.emit({ t: 'attack', uid: u.uid, tuid: target.uid, ranged });
    const base = this.packet(u, u.team, u.attack, 1, cfg.element, { melee: !ranged });

    const cone = u.passives.coneAttack;
    if (cone) {
      const len = cone.params.length as number;
      const dir = this.dirOf(u.team);
      const y0 = Math.min(u.y, u.y + dir * len);
      const y1 = Math.max(u.y, u.y + dir * len);
      this.emit({ t: 'cone', x: u.x, y0: u.y, y1: u.y + dir * len });
      const status: StatusApply = { status: cone.params.status, duration: cone.params.duration, power: cone.params.power, chance: 1 };
      for (const e of this.teams[this.enemyOf(u.team)].index.inRange(y0, y1, this.targetable)) {
        this.dealDamage(e, { ...base, melee: false });
        this.applyStatus(e, status, u);
      }
      return;
    }
    const line = u.passives.lineAttack;
    if (line) {
      const len = line.params.length as number;
      const dir = this.dirOf(u.team);
      this.emit({ t: 'beam', x: u.x, y0: u.y, y1: u.y + dir * len, fx: line.fx ?? 'rail', width: 6 });
      const y0 = Math.min(u.y, u.y + dir * len);
      const y1 = Math.max(u.y, u.y + dir * len);
      for (const e of this.teams[this.enemyOf(u.team)].index.inRange(y0, y1, this.targetable)) this.dealDamage(e, base);
      return;
    }

    let targets = [target];
    const multi = u.passives.multiTarget;
    if (multi) {
      const idx = this.teams[this.enemyOf(u.team)].index;
      const extra = idx
        .inRange(u.y - u.attackRange - 60, u.y + u.attackRange + 60, (e) => this.targetable(e) && e !== target)
        .sort((a, b) => Math.abs(a.y - u.y) - Math.abs(b.y - u.y))
        .slice(0, (multi.params.count as number) - 1);
      targets = [target, ...extra];
    }

    if (ranged) {
      const shot = u.passives.multiShot;
      const shots = shot ? (shot.params.count as number) : 1;
      const pct = shot ? (shot.params.dmgPct as number) : 1;
      for (const t of targets) {
        for (let i = 0; i < shots; i++) this.fireProjectile(u, t, { ...base, mult: base.mult * pct }, i * 0.15);
      }
      if (this.flag(u.team, 'arrowSplit') && cfg.tags.includes('archer')) {
        const other = this.teams[this.enemyOf(u.team)].index
          .inRange(target.y - 120, target.y + 120, (e) => this.targetable(e) && e !== target);
        if (other.length) this.fireProjectile(u, this.rng.pick(other), { ...base, mult: base.mult * 0.6 }, 0.3);
      }
      return;
    }

    // 近战
    for (const t of targets) this.meleeHit(u, t, base);
    const multiHit = u.passives.multiHit;
    if (multiHit && this.rng.chance(multiHit.params.chance as number)) {
      this.delayed.push({ at: this.time + 0.12, fn: () => target.alive && u.alive && this.meleeHit(u, target, base) });
    }
    const dbl = this.flag(u.team, 'doubleStrike');
    if (dbl > 0 && this.rng.chance(dbl)) {
      this.delayed.push({ at: this.time + 0.18, fn: () => target.alive && u.alive && this.meleeHit(u, target, base) });
    }
  }

  private meleeHit(u: BattleUnit, target: BattleUnit, base: DamagePacket) {
    this.emit({ t: 'slash', x: target.x, y: target.y, dir: this.dirOf(u.team), big: u.size >= 18 });
    this.dealDamage(target, base);
    onAttackPassives(this, u, target, base);
    const splash = u.passives.splash;
    if (splash) {
      const r = splash.params.radius as number;
      for (const e of this.teams[this.enemyOf(u.team)].index.inRange(target.y - r, target.y + r, this.targetable)) {
        if (e !== target) this.dealDamage(e, { ...base, mult: base.mult * (splash.params.pct as number) });
      }
    }
  }

  fireProjectile(
    u: BattleUnit, target: BattleUnit, packet: DamagePacket, delay = 0, kindOverride?: ProjectileKind,
    override?: Partial<Projectile>,
  ) {
    const launch = () => {
      if (!u.alive && delay > 0) return;
      const kind = (kindOverride ?? u.cfg.projectile ?? 'arrow') as ProjectileKind;
      const total = Math.abs(target.y - u.y) + 1;
      const p: Projectile = {
        id: this.projSeq++,
        kind,
        team: u.team,
        srcUid: u.uid,
        targetUid: target.uid,
        x: u.x,
        y: u.y,
        prevY: u.y,
        prevX: u.x,
        tx: target.x,
        ty: target.y,
        speed: PROJECTILE_SPEED[kind] ?? 600,
        alive: true,
        packet,
        pierceLeft: 0,
        piercePct: 1,
        arc: kind === 'shell' ? 1 : kind === 'javelin' ? 0.3 : 0,
        traveled: 0,
        total,
        tint: PROJECTILE_TINT[kind] ?? 0xffffff,
      };
      const splash = u.passives.splash;
      if (splash) {
        let radius = splash.params.radius as number;
        if (packet.element === 'explosive') radius *= 1 + this.flag(u.team, 'explosiveRadius');
        p.aoe = { radius, pct: splash.params.pct as number, fx: splash.fx ?? 'explosion_small' };
        if (this.flag(u.team, 'frostShell') && u.cfg.id === 'cannon') p.aoe.freeze = this.flag(u.team, 'frostShell');
      }
      const pierce = u.passives.pierce;
      if (pierce) {
        p.pierceLeft = pierce.params.count as number;
        p.piercePct = pierce.params.pct as number;
        p.hitSet = [];
      }
      const st = u.passives.onHitStatus;
      if (st) p.status = { status: st.params.status, duration: st.params.duration, power: st.params.power, chance: st.params.chance };
      if (this.flag(u.team, 'toxicBarrage') && u.cfg.id === 'gatling') {
        p.status = { status: 'poison', duration: 3, power: 0.6, chance: 1 };
        p.tint = 0x8fe860;
      }
      const chain = u.passives.chain;
      if (chain) p.chain = { jumps: chain.params.jumps as number, pct: chain.params.pct as number, range: chain.params.range as number };
      if (u.cfg.tags.includes('archer')) {
        const thunder = this.flag(u.team, 'thunderArrows');
        const enchant = this.flag(u.team, 'lightningEnchant');
        if ((thunder > 0 && this.rng.chance(thunder)) || (enchant > 0 && this.rng.chance(enchant))) {
          p.chain = { jumps: 3, pct: 0.7, range: 120 };
          p.tint = 0x9fe0ff;
        }
      } else if (u.cfg.tags.includes('ranged') && this.flag(u.team, 'lightningEnchant') > 0 && !p.chain) {
        if (this.rng.chance(this.flag(u.team, 'lightningEnchant'))) p.chain = { jumps: 2, pct: 0.5, range: 100 };
      }
      if (override) Object.assign(p, override);
      this.projectiles.push(p);
    };
    if (delay > 0) this.delayed.push({ at: this.time + delay, fn: launch });
    else launch();
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.prevY = p.y;
      p.prevX = p.x;
      const target = this.findUnitFast(p.targetUid, this.enemyOf(p.team));
      if (target && target.alive) {
        p.tx = target.x;
        p.ty = target.y;
      } else if (!p.aoe) {
        // 目标已死亡：尝试转向附近敌人，否则消失
        const alt = this.teams[this.enemyOf(p.team)].index.nearest(p.ty, this.targetable);
        if (alt && Math.abs(alt.y - p.ty) < 60) p.targetUid = alt.uid;
        else {
          p.alive = false;
          continue;
        }
      }
      const dy = p.ty - p.y;
      const dist = Math.abs(dy);
      const stepLen = p.speed * dt;
      p.traveled += stepLen;
      if (dist <= stepLen + 6) {
        p.y = p.ty;
        p.x = p.tx;
        this.projectileHit(p, target && target.alive ? target : null);
      } else {
        p.y += Math.sign(dy) * stepLen;
        p.x += (p.tx - p.x) * Math.min(1, stepLen / Math.max(1, dist));
      }
    }
    if (this.projectiles.length > 400 || this.projectiles.some((p) => !p.alive)) {
      this.projectiles = this.projectiles.filter((p) => p.alive);
    }
  }

  private findUnitFast(uid: number, team: Team): BattleUnit | undefined {
    const u = this.unitById.get(uid);
    return u && u.team === team ? u : undefined;
  }

  private projectileHit(p: Projectile, target: BattleUnit | null) {
    const src = p.packet.src;
    if (p.aoe) {
      this.emit({ t: 'explosion', x: p.x, y: p.y, radius: p.aoe.radius, fx: p.aoe.fx, element: p.packet.element, team: p.team });
      const r = p.aoe.radius;
      for (const e of this.teams[this.enemyOf(p.team)].index.inRange(p.y - r, p.y + r, this.targetable)) {
        const pkt = e === target ? p.packet : { ...p.packet, mult: p.packet.mult * p.aoe.pct };
        this.dealDamage(e, pkt);
        if (p.aoe.status) this.applyStatus(e, p.aoe.status, src);
        if (p.aoe.freeze) this.applyStatus(e, { status: 'freeze', duration: p.aoe.freeze, power: 0, chance: 1 }, src);
        if (p.status) this.applyStatus(e, p.status, src);
      }
      if (p.aoe.freeze) this.emit({ t: 'freeze', x: p.x, y: p.y, radius: r });
      if (p.packet.element === 'explosive' && this.flag(p.team, 'burningBlast')) this.addFireZone(p.team, p.y, p.x, r, src);
      p.alive = false;
      return;
    }
    if (!target) {
      p.alive = false;
      return;
    }
    this.dealDamage(target, p.packet);
    if (p.status) this.applyStatus(target, p.status, src);
    if (p.chain) this.chainLightning(src, p.team, target, p.chain.jumps + this.flag(p.team, 'chainBonus'), p.packet.attack * p.chain.pct, p.chain.range);
    if (p.pierceLeft > 0) {
      p.pierceLeft--;
      p.hitSet!.push(target.uid);
      const dir = this.dirOf(p.team);
      const next = this.teams[this.enemyOf(p.team)].index
        .inRange(Math.min(target.y, target.y + dir * 140), Math.max(target.y, target.y + dir * 140),
          (e) => this.targetable(e) && !p.hitSet!.includes(e.uid))
        .sort((a, b) => Math.abs(a.y - target.y) - Math.abs(b.y - target.y))[0];
      if (next) {
        p.targetUid = next.uid;
        p.packet = { ...p.packet, mult: p.packet.mult * p.piercePct };
        return;
      }
    }
    p.alive = false;
  }

  // ------------------------------------------------------------------ 伤害
  /** D = max(1, A·M·100/(100+max(0,F−P)))，再叠加暴击、元素、护盾等 */
  dealDamage(target: BattleUnit, pk: DamagePacket): number {
    if (!target.alive || target.cfg.untargetable) return 0;
    const F = target.defense;
    let dmg = Math.max(1, (pk.attack * pk.mult * 100) / (100 + Math.max(0, F - pk.pen)));
    let crit = false;
    if (pk.forceCrit || (pk.critChance > 0 && this.rng.chance(pk.critChance))) {
      crit = true;
      dmg *= pk.critDamage;
    }
    const team = pk.team;
    const el = pk.element;
    let amp = 1;
    if (el === 'fire') amp += this.flag(team, 'fireAmp');
    if (el === 'lightning') amp += this.flag(team, 'lightningAmp');
    if (el === 'ice') amp += this.flag(team, 'frostAmp') * 0.5;
    if (el !== 'physical' && el !== 'explosive') amp += this.flag(team, 'elementAmp');
    if (RARITY_RANK[target.cfg.rarity] >= 2 || target.isBoss) amp += this.flag(team, 'eliteSlayer');
    const anti = pk.src?.passives.antiTag;
    if (anti && target.cfg.tags.includes(anti.params.tag as string)) amp *= anti.params.mult as number;
    dmg *= amp;
    if (this.time > B.rageStart) dmg *= 1 + (this.time - B.rageStart) * B.rageRamp;
    dmg *= target.damageTaken;
    const dr = target.passives.damageReduction;
    if (dr) dmg *= 1 - (dr.params.pct as number);
    let blocked = false;
    const block = target.passives.block;
    if (block && this.rng.chance(block.params.chance as number)) {
      dmg *= 1 - (block.params.reduce as number);
      blocked = true;
    }
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
      dmg -= absorbed;
    }
    this.applyRawDamage(target, dmg, pk.src, team);
    target.hitFlash = 0.12;
    this.emit({ t: 'hit', uid: target.uid, dmg, crit, element: el, x: target.x, y: target.y, melee: pk.melee, blocked });
    // 吸血
    const ls = pk.src?.passives.lifesteal;
    if (ls && pk.src!.alive) this.heal(pk.src!, dmg * (ls.params.pct as number), pk.src);
    // 反伤
    if (pk.melee && pk.src && pk.src.alive) {
      const thorns = this.flag(target.team, 'thorns');
      if (thorns > 0) this.applyRawDamage(pk.src, dmg * thorns, target, target.team);
    }
    return dmg;
  }

  applyRawDamage(target: BattleUnit, dmg: number, src: BattleUnit | null, srcTeam: Team) {
    if (!target.alive) return;
    if (dmg >= target.hp) {
      const cd = this.flag(target.team, 'cheatDeath');
      const undying = this.flag(target.team, 'undyingLine') && target.cfg.id === 'shieldbearer';
      if (!target.cheatDeathUsed && ((cd > 0 && this.rng.chance(cd)) || undying)) {
        target.cheatDeathUsed = true;
        dmg = target.hp - 1;
        this.emit({ t: 'shield', uid: target.uid });
      }
    }
    const real = Math.min(target.hp, dmg);
    target.hp -= dmg;
    this.record(src, srcTeam, real, target);
    if (target.hp <= 0) this.kill(target, src, false);
  }

  private record(src: BattleUnit | null, srcTeam: Team, dmg: number, target: BattleUnit) {
    const tk = this.statFor(target);
    tk.taken += dmg;
    if (!src) return;
    const s = this.statFor(src);
    s.damage += dmg;
    const tot = (this.unitDamage.get(src.uid) ?? 0) + dmg;
    this.unitDamage.set(src.uid, tot);
    if (srcTeam === 0 && (!this.topSingle || tot > this.topSingle.damage)) {
      this.topSingle = { name: src.cfg.name, unit: src.cfg.id, team: src.team, damage: tot };
    }
  }

  statFor(u: BattleUnit): UnitDamageStat {
    let s = this.stats.get(u.statKey);
    if (!s) {
      s = { unit: u.cfg.id, name: u.cfg.name, team: u.team, damage: 0, kills: 0, healing: 0, taken: 0 };
      this.stats.set(u.statKey, s);
    }
    return s;
  }

  heal(u: BattleUnit, amount: number, src: BattleUnit | null, silent = false) {
    if (!u.alive || amount <= 0) return;
    const real = Math.min(u.maxHp - u.hp, amount);
    if (real <= 0) return;
    u.hp += real;
    if (src) this.statFor(src).healing += real;
    if (!silent && real >= 1) this.emit({ t: 'heal', uid: u.uid, amount: real, x: u.x, y: u.y });
  }

  kill(u: BattleUnit, killer: BattleUnit | null, silent: boolean) {
    if (!u.alive) return;
    // 复活类被动
    const revive = u.passives.revive;
    if (!silent && revive && u.revivesLeft > 0 && this.rng.chance(revive.params.chance as number)) {
      u.revivesLeft--;
      u.hp = u.maxHp * (revive.params.hpPct as number);
      u.stunT = 0.6;
      u.freezeT = 0;
      u.burnT = 0;
      u.poisonT = 0;
      this.emit({ t: 'revive', uid: u.uid, x: u.x, y: u.y, fx: revive.fx ?? 'undead_rise' });
      if (u.cfg.id === 'phoenix') {
        this.emit({ t: 'slowmo', duration: 0.3, scale: 0.35 });
        this.emit({ t: 'log', text: '凤凰浴火重生！', team: u.team });
        if (this.flag(u.team, 'eternalFlame')) {
          this.explode(u, u.team, u.y, u.x, 110, u.attack * 2.5, 'fire', 'phoenix_nova', 1);
        }
      }
      return;
    }
    u.alive = false;
    u.hp = 0;
    u.state = 'DEAD';
    u.deadTime = this.time;
    this.emit({ t: 'death', uid: u.uid, x: u.x, y: u.y });
    if (!u.cfg.nonCombatant) this.kills[this.enemyOf(u.team)]++;
    if (killer) {
      this.statFor(killer).kills++;
      const kh = killer.passives.onKillHeal;
      if (kh && killer.alive) this.heal(killer, killer.maxHp * (kh.params.pct as number), killer);
    }
    if (silent) return;
    const team = u.team;
    // 组合：亡灵巨人
    if (u.cfg.id === 'giant' && this.flag(team, 'undeadGiant')) {
      this.delayed.push({
        at: this.time + 0.8,
        fn: () => {
          this.spawnUnit(getUnit('undead_giant'), team, u.y, u.x, { summon: true });
          this.emit({ t: 'summon', x: u.x, y: u.y, fx: 'summon_dark' });
          this.emit({ t: 'log', text: '亡灵巨人从死亡中站起！', team });
        },
      });
    }
    // 组合：自爆蜘蛛
    if (u.cfg.id === 'mech_spider' && this.flag(team, 'spiderBombs')) {
      this.explode(u, team, u.y, u.x, 50 * (1 + this.flag(team, 'explosiveRadius')), u.attack * 3, 'explosive', 'explosion_small', 1);
    }
    // 亡灵：死亡概率召唤骷髅
    const ds = this.flag(team, 'deathSkeleton');
    if (ds > 0 && !u.isSummon && this.rng.chance(Math.min(0.9, ds))) {
      this.delayed.push({
        at: this.time + 0.5,
        fn: () => {
          this.spawnUnit(getUnit('skeleton'), team, u.y, u.x, { summon: true });
          this.emit({ t: 'summon', x: u.x, y: u.y, fx: 'summon_dark' });
        },
      });
    }
  }

  // ------------------------------------------------------------------ 状态
  applyStatus(u: BattleUnit, st: StatusApply, src: BattleUnit | null) {
    if (!u.alive || !this.rng.chance(st.chance)) return;
    const team = src ? src.team : this.enemyOf(u.team);
    const frostBonus = this.flag(team, 'frostAmp') > 0 ? 1 : 0;
    const ccResist = u.isBoss ? 0.5 : 1 - u.knockbackResistance * 0.3;
    switch (st.status) {
      case 'poison': {
        const dps = (src?.attack ?? 20) * st.power * (1 + this.flag(team, 'poisonAmp'));
        u.poisonDps = Math.max(u.poisonDps, dps);
        u.poisonT = Math.max(u.poisonT, st.duration);
        break;
      }
      case 'burn': {
        const dps = (src?.attack ?? 20) * st.power * (1 + this.flag(team, 'fireAmp'));
        u.burnDps = Math.max(u.burnDps, dps);
        u.burnT = Math.max(u.burnT, st.duration);
        break;
      }
      case 'slow':
        u.slowV = Math.max(u.slowT > 0 ? u.slowV : 0, st.power);
        u.slowT = Math.max(u.slowT, st.duration + frostBonus);
        break;
      case 'freeze':
        u.freezeT = Math.max(u.freezeT, (st.duration + frostBonus) * ccResist);
        break;
      case 'stun':
        u.stunT = Math.max(u.stunT, st.duration * ccResist);
        break;
    }
    (u as BattleUnit & { lastDotSrc?: BattleUnit | null }).lastDotSrc = src;
  }

  private tickStatus(u: BattleUnit, dt: number) {
    if (u.stunT > 0) u.stunT -= dt;
    if (u.freezeT > 0) u.freezeT -= dt;
    if (u.rootT > 0) u.rootT -= dt;
    if (u.slowT > 0) u.slowT -= dt;
    const src = (u as BattleUnit & { lastDotSrc?: BattleUnit | null }).lastDotSrc ?? null;
    const enemyTeam = this.enemyOf(u.team);
    if (u.burnT > 0) {
      u.burnT -= dt;
      this.applyRawDamage(u, u.burnDps * dt * this.rageMult(), src, enemyTeam);
    }
    if (u.alive && u.poisonT > 0) {
      u.poisonT -= dt;
      this.applyRawDamage(u, u.poisonDps * dt * this.rageMult(), src, enemyTeam);
    }
    // 光环类被动（每 0.5 秒结算，降低开销）
    if (!u.alive) return;
    const phase = Math.floor(this.time / 0.5) !== Math.floor((this.time - dt) / 0.5);
    if (!phase) return;
    const aura = u.passives.auraHeal;
    if (aura) {
      const r = aura.params.radius as number;
      for (const a of this.teams[u.team].index.inRange(u.y - r, u.y + r)) {
        this.heal(a, a.maxHp * (aura.params.pctPerSec as number) * 0.5, u, true);
      }
    }
    const burnAura = u.passives.burnAura;
    if (burnAura) {
      const r = burnAura.params.radius as number;
      for (const e of this.teams[enemyTeam].index.inRange(u.y - r, u.y + r, this.targetable)) {
        this.dealDamage(e, this.packet(u, u.team, u.attack, (burnAura.params.dmgMult as number) * 0.5, 'fire', { critChance: 0 }));
      }
    }
  }

  rageMult(): number {
    return this.time > B.rageStart ? 1 + (this.time - B.rageStart) * B.rageRamp : 1;
  }

  // ------------------------------------------------------------------ 范围效果
  explode(src: BattleUnit | null, team: Team, y: number, x: number, radius: number, attack: number, element: Element, fx: string, mult: number, status?: StatusApply) {
    this.emit({ t: 'explosion', x, y, radius, fx, element, team });
    if (radius >= 60) this.emit({ t: 'shake', power: Math.min(14, radius / 8) });
    const pk = this.packet(src, team, attack, mult, element, { isSkill: true, critChance: src ? src.critChance : 0 });
    for (const e of this.teams[this.enemyOf(team)].index.inRange(y - radius, y + radius, this.targetable)) {
      this.dealDamage(e, pk);
      if (status) this.applyStatus(e, status, src);
    }
    if (element === 'explosive' && this.flag(team, 'burningBlast')) this.addFireZone(team, y, x, radius * 0.8, src);
  }

  addFireZone(team: Team, y: number, x: number, radius: number, src: BattleUnit | null) {
    this.zones.push({
      id: this.zoneSeq++, kind: 'fire', team, y, x, radius, dir: 0, speed: 0, t: 0, duration: 3, tickT: 0,
      dps: (src?.attack ?? 20) * 0.6, push: 0, slow: 0, src, attack: src?.attack ?? 20,
    });
  }

  addZone(z: Omit<Zone, 'id' | 't' | 'tickT'>) {
    this.zones.push({ ...z, id: this.zoneSeq++, t: 0, tickT: 0 });
  }

  private updateZones(dt: number) {
    if (!this.zones.length) return;
    for (const z of this.zones) {
      z.t += dt;
      z.tickT -= dt;
      if (z.speed) z.y += z.dir * z.speed * dt;
      const enemy = this.teams[this.enemyOf(z.team)].index;
      if (z.kind === 'timeslow') {
        enemy.forRange(z.y - z.radius, z.y + z.radius, (e) => {
          e.slowV = Math.max(e.slowV, z.slow);
          e.slowT = Math.max(e.slowT, 0.2);
        });
      }
      if (z.tickT <= 0) {
        z.tickT = 0.5;
        const el: Element = z.kind === 'poison' ? 'poison' : z.kind === 'fire' ? 'fire' : z.kind === 'tornado' ? 'lightning' : 'ice';
        if (z.dps > 0) {
          for (const e of enemy.inRange(z.y - z.radius, z.y + z.radius, this.targetable)) {
            this.dealDamage(e, this.packet(z.src, z.team, z.attack, (z.dps / Math.max(1, z.attack)) * 0.5, el, { critChance: 0 }));
            if (z.push > 0 && e.alive && !e.isBoss) {
              e.y += z.dir * z.push * 0.5 * (1 - e.knockbackResistance);
              e.y = Math.min(FIELD - 10, Math.max(10, e.y));
              e.state = 'KNOCKBACK';
            }
          }
        }
      }
    }
    this.zones = this.zones.filter((z) => z.t < z.duration && z.y > -50 && z.y < FIELD + 50);
  }

  chainLightning(src: BattleUnit | null, team: Team, first: BattleUnit, jumps: number, attack: number, range: number) {
    const enemy = this.teams[this.enemyOf(team)].index;
    const hit = new Set<number>([first.uid]);
    const points = [{ x: first.x, y: first.y }];
    let cur = first;
    let dmg = attack;
    for (let i = 0; i < jumps; i++) {
      const next = enemy.nearest(cur.y, (e) => this.targetable(e) && !hit.has(e.uid) && Math.abs(e.y - cur.y) <= range);
      if (!next) break;
      hit.add(next.uid);
      points.push({ x: next.x, y: next.y });
      this.dealDamage(next, this.packet(src, team, dmg, 1, 'lightning', { isSkill: true, critChance: 0 }));
      dmg *= 0.85;
      cur = next;
    }
    if (points.length > 1) this.emit({ t: 'lightning', points });
  }

  // ------------------------------------------------------------------ 收尾
  private cleanup() {
    for (const ctx of this.teams) {
      let anyRemoved = false;
      for (const u of ctx.units) {
        if (!u.alive && !u.removed && this.time - u.deadTime > 6) {
          u.removed = true;
          anyRemoved = true;
        }
      }
      if (anyRemoved && ctx.units.length > 300) {
        for (const u of ctx.units) if (u.removed) this.unitById.delete(u.uid);
        ctx.units = ctx.units.filter((u) => !u.removed);
      }
    }
  }

  combatAlive(team: Team): number {
    let n = 0;
    for (const u of this.teams[team].units) if (u.alive && !u.cfg.nonCombatant) n++;
    return n;
  }

  private hpRatio(team: Team): number {
    let hp = 0;
    for (const u of this.teams[team].units) if (u.alive && !u.cfg.nonCombatant) hp += u.hp;
    return hp / Math.max(1, this.teams[team].initialHp);
  }

  private checkEnd() {
    const a = this.combatAlive(0);
    const b = this.combatAlive(1);
    let winner: Team | 'draw' | null = null;
    let reason: BattleOutcome['reason'] = 'wipe';
    if (a === 0 && b === 0) winner = 'draw';
    else if (a === 0) winner = 1;
    else if (b === 0) winner = 0;
    else if (this.time >= B.maxTime) {
      const ra = this.hpRatio(0);
      const rb = this.hpRatio(1);
      reason = 'timeout';
      if (Math.abs(ra - rb) < 0.001) winner = 'draw';
      else winner = ra > rb ? 0 : 1;
    }
    if (winner === null) return;
    if (winner === 'draw' && reason === 'wipe') reason = 'draw';
    this.finished = true;
    this.outcome = {
      winner,
      reason,
      time: this.time,
      survivors: [a, b],
      hpRatio: [this.hpRatio(0), this.hpRatio(1)],
      stats: [...this.stats.values()].sort((x, y) => y.damage - x.damage),
      topUnit: this.topSingle,
      kills: this.kills,
    };
  }

  /** 无渲染快速模拟到结束（用于离线结算或校验） */
  runToEnd(maxSteps = 100000): BattleOutcome {
    let n = 0;
    while (!this.finished && n++ < maxSteps) {
      this.step();
      this.events.length = 0;
    }
    return this.outcome!;
  }
}
