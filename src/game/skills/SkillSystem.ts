import { getUnit, SKILL_MAP } from '../data/ConfigLoader';
import type { SkillDef, Team } from '../core/types';
import type { BattleSim } from '../battle/BattleSim';
import type { BattleUnit, DamagePacket, ProjectileKind, StatusApply } from '../battle/BattleTypes';

const clampY = (y: number) => Math.min(990, Math.max(10, y));

function statusOf(p: Record<string, any>): StatusApply | undefined {
  if (!p.status) return undefined;
  return { status: p.status, duration: p.duration ?? 2, power: p.power ?? 0.3, chance: 1 };
}

/** 近战命中后的被动（远程被动在投射物命中时处理） */
export function onAttackPassives(sim: BattleSim, u: BattleUnit, target: BattleUnit, pk: DamagePacket) {
  if (!pk.melee) return;
  const st = u.passives.onHitStatus;
  if (st && target.alive) sim.applyStatus(target, statusOf(st.params)!, u);
  const chain = u.passives.chain;
  if (chain && target.alive) {
    sim.chainLightning(u, u.team, target, (chain.params.jumps as number) + sim.flag(u.team, 'chainBonus'), u.attack * (chain.params.pct as number), chain.params.range as number);
  }
}

/** 释放法术（陨石等），可由单位、羁绊或开局战术卡触发 */
export function castSpellAt(sim: BattleSim, src: BattleUnit | null, team: Team, spell: string, y: number, x: number, attack: number, delay: number) {
  if (spell === 'meteor') {
    const def = SKILL_MAP.get('meteor')!;
    const radius = (def.params.radius as number) * (1 + sim.flag(team, 'elementAmp') * 0.5);
    sim.emit({ t: 'meteorWarn', x, y, radius, delay });
    sim.delayed.push({
      at: sim.time + delay,
      fn: () => {
        sim.explode(src, team, y, x, radius, attack, 'fire', 'meteor', 1, { status: 'stun', duration: def.params.stun, power: 0, chance: 1 });
        sim.emit({ t: 'shake', power: 16 });
        sim.emit({ t: 'flash', color: 0xffa040, alpha: 0.25 });
      },
    });
  }
}

/** 主动技能：返回 true 表示本次成功释放 */
export function castActive(sim: BattleSim, u: BattleUnit, def: SkillDef, forced: boolean): boolean {
  const p = def.params;
  const team = u.team;
  const enemyTeam = sim.enemyOf(team);
  const eidx = sim.teams[enemyTeam].index;
  const aidx = sim.teams[team].index;
  const dir = sim.dirOf(team);
  const el = def.element ?? u.cfg.element;
  const pk = (mult: number, extra: Partial<DamagePacket> = {}) => sim.packet(u, team, u.attack, mult, el, { isSkill: true, ...extra });
  const nearest = eidx.nearest(u.y, sim.targetable);
  if (!nearest) return false;
  const inReach = (t: BattleUnit, extra = 0) => sim.edgeDist(u, t) <= u.attackRange + extra;
  let casted = true;
  let fxY = u.y;

  switch (def.kind) {
    case 'dash': {
      const back = team === 0 ? eidx.first(sim.targetable) : eidx.last(sim.targetable);
      if (!back) return false;
      const from = u.y;
      u.y = clampY(back.y + dir * (back.size * 0.5 + 8));
      u.ignoreBlock = true;
      u.targetUid = back.uid;
      sim.emit({ t: 'dash', uid: u.uid, x: u.x, fromY: from, toY: u.y });
      sim.dealDamage(back, pk(p.dmgMult as number, { melee: true }));
      fxY = u.y;
      break;
    }
    case 'charge': {
      const d = sim.edgeDist(u, nearest);
      const range = p.range as number;
      if (!forced && (d < 25 || d > range)) return false;
      const from = u.y;
      const maxMove = forced ? range * 1.6 : range;
      const desired = nearest.y - dir * ((u.size + nearest.size) * 0.5);
      const move = Math.min(Math.abs(desired - u.y), maxMove);
      u.y = clampY(u.y + Math.sign(desired - u.y) * move);
      sim.emit({ t: 'charge', uid: u.uid, x: u.x, fromY: from, toY: u.y });
      const hitY = u.y + dir * (u.size * 0.5 + 10);
      const r = p.radius as number;
      for (const e of eidx.inRange(hitY - r, hitY + r, sim.targetable)) {
        sim.dealDamage(e, pk(p.dmgMult as number, { melee: true }));
        if (e.alive && !e.isBoss) {
          e.y = clampY(e.y + dir * (p.knockback as number) * (1 - e.knockbackResistance));
          e.state = 'KNOCKBACK';
          sim.applyStatus(e, { status: 'stun', duration: p.stun as number, power: 0, chance: 1 }, u);
        }
      }
      sim.emit({ t: 'stomp', x: u.x, y: hitY, radius: r + 10, big: false });
      sim.emit({ t: 'shake', power: 5 });
      if (sim.flag(team, 'thunderCharge') && u.cfg.tags.includes('knight')) {
        const near = eidx.inRange(hitY - 120, hitY + 120, sim.targetable).slice(0, 3);
        for (const e of near) {
          sim.emit({ t: 'lightning', points: [{ x: e.x, y: e.y - 260 }, { x: e.x, y: e.y }], big: true });
          sim.dealDamage(e, sim.packet(u, team, u.attack, 1.5, 'lightning', { isSkill: true }));
        }
      }
      fxY = u.y;
      break;
    }
    case 'iaido': {
      const t = sim.selectTarget(u);
      if (!t || !inReach(t, 10)) return false;
      sim.emit({ t: 'slash', x: t.x, y: t.y, dir, big: true });
      sim.emit({ t: 'flash', color: 0xffffff, alpha: 0.12 });
      sim.dealDamage(t, pk(p.dmgMult as number, { forceCrit: true, melee: true }));
      fxY = t.y;
      break;
    }
    case 'stomp': {
      const r = p.radius as number;
      const hits = eidx.inRange(u.y - r, u.y + r, sim.targetable);
      if (!hits.length && !forced) return false;
      for (const e of hits) {
        sim.dealDamage(e, pk(p.dmgMult as number));
        sim.applyStatus(e, { status: 'stun', duration: p.stun as number, power: 0, chance: 1 }, u);
      }
      sim.emit({ t: 'stomp', x: u.x, y: u.y, radius: r, big: !!p.shake });
      if (p.shake) sim.emit({ t: 'shake', power: 10 });
      break;
    }
    case 'aoeAt': {
      const t = forced ? (sim.pickCluster(enemyTeam) ?? nearest) : sim.selectTarget(u);
      if (!t || (!forced && !inReach(t, 40))) return false;
      sim.fireProjectile(u, t, pk(p.dmgMult as number), 0, (p.projectile ?? 'fireball') as ProjectileKind, {
        aoe: { radius: (p.radius as number) * (1 + sim.flag(team, 'elementAmp') * 0.5), pct: 1, fx: def.fx ?? 'fireball', status: statusOf(p) },
        speed: 420,
        tint: 0xff8a3a,
        chain: undefined,
        pierceLeft: 0,
      });
      fxY = t.y;
      break;
    }
    case 'freezeArea': {
      const t = forced ? (sim.pickCluster(enemyTeam) ?? nearest) : sim.selectTarget(u);
      if (!t || (!forced && !inReach(t, 40))) return false;
      const r = (p.radius as number) * (1 + sim.flag(team, 'frostAmp'));
      for (const e of eidx.inRange(t.y - r, t.y + r, sim.targetable)) {
        sim.dealDamage(e, pk(p.dmgMult as number));
        sim.applyStatus(e, { status: 'freeze', duration: p.duration as number, power: 0, chance: 1 }, u);
      }
      sim.emit({ t: 'freeze', x: t.x, y: t.y, radius: r });
      fxY = t.y;
      break;
    }
    case 'chainLightning': {
      const t = forced ? nearest : sim.selectTarget(u);
      if (!t || (!forced && !inReach(t, 40))) return false;
      sim.emit({ t: 'lightning', points: [{ x: u.x, y: u.y }, { x: t.x, y: t.y }] });
      sim.dealDamage(t, pk(p.dmgMult as number));
      sim.chainLightning(u, team, t, (p.jumps as number) + sim.flag(team, 'chainBonus'), u.attack * (p.dmgMult as number) * 0.85, p.range as number);
      fxY = t.y;
      break;
    }
    case 'healAllies': {
      const allies = aidx.sorted.filter((a) => a.alive && !a.cfg.nonCombatant && a.hp < a.maxHp * 0.95);
      if (!allies.length) return false;
      allies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      let pct = p.pct as number;
      if (u.cfg.id === 'priest' && sim.flag(team, 'undyingLine')) pct *= 1.5;
      for (const a of allies.slice(0, p.count as number)) sim.heal(a, a.maxHp * pct, u);
      break;
    }
    case 'summon': {
      const base = (p.count as number) + sim.flag(team, 'summonBonus');
      const n = Math.round(base * (1 + sim.flag(team, 'summonMult')));
      const cfg = getUnit(p.unit as string);
      for (let i = 0; i < n; i++) {
        sim.spawnUnit(cfg, team, clampY(u.y + dir * (18 + i * 6)), Math.max(-0.9, Math.min(0.9, u.x + sim.rng.range(-0.5, 0.5))), { summon: true });
      }
      sim.emit({ t: 'summon', x: u.x, y: u.y + dir * 20, fx: def.fx ?? 'summon_dark' });
      break;
    }
    case 'tornado': {
      if (Math.abs(nearest.y - u.y) > 450) return false;
      sim.addZone({
        kind: 'tornado', team, y: u.y + dir * 20, x: u.x, radius: p.radius as number, dir, speed: p.speed as number,
        duration: p.duration as number, dps: u.attack * (p.dmgMult as number), push: p.push as number, slow: 0, src: u, attack: u.attack,
      });
      break;
    }
    case 'poisonCloud': {
      const t = forced ? (sim.pickCluster(enemyTeam) ?? nearest) : sim.selectTarget(u);
      if (!t || (!forced && !inReach(t, 40))) return false;
      sim.addZone({
        kind: 'poison', team, y: t.y, x: t.x, radius: p.radius as number, dir: 0, speed: 0, duration: p.duration as number,
        dps: u.attack * (p.dmgMult as number) * (1 + sim.flag(team, 'poisonAmp')), push: 0, slow: 0, src: u, attack: u.attack,
      });
      fxY = t.y;
      break;
    }
    case 'beam': {
      const len = p.length as number;
      if (Math.abs(nearest.y - u.y) > len && !forced) return false;
      const y1 = u.y + dir * len;
      sim.emit({ t: 'beam', x: u.x, y0: u.y, y1, fx: def.fx ?? 'holy_beam', width: def.fx === 'laser' ? 18 : 10 });
      for (const e of eidx.inRange(Math.min(u.y, y1), Math.max(u.y, y1), sim.targetable)) sim.dealDamage(e, pk(p.dmgMult as number));
      if (p.slowmo) sim.emit({ t: 'slowmo', duration: 0.2, scale: 0.4 });
      if (def.fx === 'laser') sim.emit({ t: 'shake', power: 6 });
      break;
    }
    case 'timeSlow': {
      const t = forced ? nearest : sim.selectTarget(u);
      if (!t || (!forced && !inReach(t, 100))) return false;
      sim.addZone({
        kind: 'timeslow', team, y: t.y, x: t.x, radius: p.radius as number, dir: 0, speed: 0, duration: p.duration as number,
        dps: 0, push: 0, slow: p.slow as number, src: u, attack: u.attack,
      });
      fxY = t.y;
      break;
    }
    case 'randomSpell': {
      const pool = p.pool as string[];
      const sub = SKILL_MAP.get(sim.rng.pick(pool));
      if (!sub || (!forced && !inReach(nearest, 60))) return false;
      castActive(sim, u, sub, true);
      return true;
    }
    case 'meteor': {
      const t = sim.pickCluster(enemyTeam) ?? nearest;
      if (!forced && Math.abs(t.y - u.y) > u.attackRange + 250) return false;
      castSpellAt(sim, u, team, 'meteor', t.y, t.x, u.attack * (p.dmgMult as number), 0.8);
      fxY = t.y;
      break;
    }
    case 'missiles': {
      const cands = eidx.inRange(u.y - u.attackRange - 120, u.y + u.attackRange + 120, sim.targetable);
      if (!cands.length) return false;
      const n = p.count as number;
      const radius = (p.radius as number) * (1 + sim.flag(team, 'explosiveRadius'));
      for (let i = 0; i < n; i++) {
        const t = sim.rng.pick(cands);
        sim.fireProjectile(u, t, pk(p.dmgMult as number), i * 0.12, 'missile', {
          aoe: { radius, pct: 1, fx: 'explosion_small' },
          pierceLeft: 0,
          status: undefined,
        });
      }
      break;
    }
    case 'breath': {
      const amp = sim.flag(team, 'breathAmp');
      const len = (p.length as number) * (1 + amp);
      if (Math.abs(nearest.y - u.y) > len) return false;
      const y1 = u.y + dir * len;
      sim.emit({ t: 'breath', x: u.x, y0: u.y, y1, fx: def.fx ?? 'fire_breath' });
      const st = statusOf(p);
      for (const e of eidx.inRange(Math.min(u.y, y1), Math.max(u.y, y1), sim.targetable)) {
        sim.dealDamage(e, pk((p.dmgMult as number) * (1 + amp * 0.5)));
        if (st) sim.applyStatus(e, st, u);
      }
      if (st?.status === 'freeze') sim.emit({ t: 'freeze', x: u.x, y: (u.y + y1) / 2, radius: len / 2 });
      sim.emit({ t: 'shake', power: 8 });
      if (p.slowmo) sim.emit({ t: 'slowmo', duration: 0.25, scale: 0.35 });
      break;
    }
    case 'globalLightning': {
      const all = eidx.sorted.filter(sim.targetable);
      if (!all.length) return false;
      const n = Math.min(all.length, p.count as number);
      sim.rng.shuffle(all);
      sim.emit({ t: 'flash', color: 0xcfe8ff, alpha: 0.45 });
      sim.emit({ t: 'slowmo', duration: 0.3, scale: 0.3 });
      for (let i = 0; i < n; i++) {
        const e = all[i];
        sim.emit({ t: 'lightning', points: [{ x: e.x + sim.rng.range(-0.2, 0.2), y: e.y - 320 }, { x: e.x, y: e.y }], big: true });
        sim.dealDamage(e, pk(p.dmgMult as number));
        sim.applyStatus(e, { status: 'stun', duration: p.stun as number, power: 0, chance: 1 }, u);
      }
      sim.emit({ t: 'shake', power: 12 });
      break;
    }
    case 'resurrect': {
      const dead = sim.teams[team].units
        .filter((d) => !d.alive && !d.removed && !d.cfg.nonCombatant && !d.isSummon)
        .sort((a, b) => b.deadTime - a.deadTime)
        .slice(0, p.count as number);
      if (!dead.length) return false;
      for (const d of dead) {
        d.alive = true;
        d.hp = d.maxHp * (p.hpPct as number);
        d.state = 'SPAWN';
        d.burnT = d.poisonT = d.freezeT = d.stunT = 0;
        sim.emit({ t: 'revive', uid: d.uid, x: d.x, y: d.y, fx: 'resurrect' });
      }
      if (p.slowmo) sim.emit({ t: 'slowmo', duration: 0.25, scale: 0.4 });
      break;
    }
    case 'entangle': {
      const r = p.radius as number;
      const hits = eidx.inRange(u.y - r, u.y + r, sim.targetable);
      if (!hits.length && !forced) return false;
      for (const e of hits) {
        e.rootT = Math.max(e.rootT, p.stun as number);
        sim.applyStatus(e, { status: 'stun', duration: (p.stun as number) * 0.6, power: 0, chance: 1 }, u);
      }
      for (const a of aidx.inRange(u.y - r, u.y + r)) {
        a.shield += a.maxHp * (p.shieldPct as number);
        sim.emit({ t: 'shield', uid: a.uid });
      }
      sim.emit({ t: 'entangle', x: u.x, y: u.y, radius: r });
      break;
    }
    default:
      casted = false;
  }
  if (casted) {
    sim.emit({ t: 'cast', uid: u.uid, name: def.name, fx: def.fx, team, x: u.x, y: fxY });
    if (u.cfg.rarity === 'LEGENDARY' || u.cfg.rarity === 'MYTHIC' || u.isBoss) {
      sim.emit({ t: 'log', text: `${u.cfg.name} 释放【${def.name}】`, team });
    }
  }
  return casted;
}
