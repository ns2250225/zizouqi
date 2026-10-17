import type { ModEffect, StatKey, UnitConfig } from '../core/types';

/** 判断修正效果是否作用于某兵种：all | tag:x | unit:x | role:x */
export function matchTarget(target: string, u: UnitConfig): boolean {
  if (target === 'all') return true;
  const [k, v] = target.split(':');
  if (k === 'tag') return u.tags.includes(v);
  if (k === 'unit') return u.id === v;
  if (k === 'role') return u.role === v;
  return false;
}

/** 百分比类属性按倍率叠加，其余按数值叠加 */
const PERCENT_STATS: StatKey[] = ['hp', 'attack', 'attackSpeed', 'moveSpeed', 'attackRange'];

export interface ResolvedStats {
  maxHp: number;
  attack: number;
  defense: number;
  attackSpeed: number;
  moveSpeed: number;
  attackRange: number;
  critChance: number;
  critDamage: number;
  armorPenetration: number;
  knockbackResistance: number;
  damageTaken: number;
  cooldownMult: number;
}

export function resolveStats(u: UnitConfig, mods: ModEffect[], statMult = 1): ResolvedStats {
  const pct: Partial<Record<StatKey, number>> = {};
  const add: Partial<Record<StatKey, number>> = {};
  for (const m of mods) {
    if (!matchTarget(m.target, u)) continue;
    if (PERCENT_STATS.includes(m.stat)) pct[m.stat] = (pct[m.stat] ?? 0) + m.value;
    else add[m.stat] = (add[m.stat] ?? 0) + m.value;
  }
  const p = (k: StatKey) => Math.max(0.1, 1 + (pct[k] ?? 0));
  const a = (k: StatKey) => add[k] ?? 0;
  return {
    maxHp: u.hp * p('hp') * statMult,
    attack: u.attack * p('attack') * statMult,
    defense: u.defense + a('defense'),
    attackSpeed: u.attackSpeed * p('attackSpeed'),
    moveSpeed: u.moveSpeed * p('moveSpeed'),
    attackRange: u.attackRange * p('attackRange'),
    critChance: Math.min(0.95, u.critChance + a('critChance')),
    critDamage: u.critDamage + a('critDamage'),
    armorPenetration: u.armorPenetration + a('armorPenetration'),
    knockbackResistance: Math.min(1, u.knockbackResistance),
    damageTaken: Math.max(0.2, 1 + a('damageTaken')),
    cooldownMult: Math.max(0.4, 1 + a('cooldown')),
  };
}
