import { CLASS_SYNERGIES, COMBOS, FACTION_SYNERGIES, getUnit } from '../data/ConfigLoader';
import type { ActiveSynergy, ComboDef, FlagEffect, ModEffect, SynergyDef } from '../core/types';

/** 统计阵容中满足某标签的不同兵种数量（召唤物不计） */
function distinctTagCount(unitIds: string[], tag: string): number {
  const set = new Set<string>();
  for (const id of unitIds) {
    const u = getUnit(id);
    if (!u.summon && u.tags.includes(tag)) set.add(id);
  }
  return set.size;
}

function evaluate(def: SynergyDef, unitIds: string[]): ActiveSynergy {
  const count = distinctTagCount(unitIds, def.tag);
  let tier = 0;
  def.tiers.forEach((need, i) => {
    if (count >= need) tier = i + 1;
  });
  const next = tier < def.tiers.length ? def.tiers[tier] : null;
  return { id: def.id, name: def.name, icon: def.icon, tier, count, next, desc: def.desc, active: tier > 0 };
}

/** 计算阵营羁绊与职业羁绊（含未激活但已有进度的，用于 UI 展示） */
export function computeSynergies(unitIds: string[]): ActiveSynergy[] {
  const out: ActiveSynergy[] = [];
  for (const def of [...FACTION_SYNERGIES, ...CLASS_SYNERGIES]) {
    const s = evaluate(def, unitIds);
    if (s.count > 0) out.push(s);
  }
  out.sort((a, b) => Number(b.active) - Number(a.active) || b.count - a.count);
  return out;
}

/** 卡牌组合进化：兵种 + 兵种 / 兵种数量 + 法术卡 */
export function computeCombos(units: { unit: string; count: number }[], cards: string[]): ComboDef[] {
  const present = new Set(units.map((u) => u.unit));
  const tagUnits = (tag: string) =>
    units.reduce((n, u) => n + (getUnit(u.unit).tags.includes(tag) ? u.count : 0), 0);
  return COMBOS.filter((c) => {
    const r = c.requires;
    if (r.units && !r.units.every((u) => present.has(u))) return false;
    if (r.cards && !r.cards.every((id) => cards.includes(id))) return false;
    if (r.tagCount && !Object.entries(r.tagCount).every(([t, n]) => tagUnits(t) >= n)) return false;
    return true;
  });
}

export function synergyEffects(active: ActiveSynergy[], combos: string[]): { mods: ModEffect[]; flags: Record<string, number> } {
  const mods: ModEffect[] = [];
  const flags: Record<string, number> = {};
  const defs = [...FACTION_SYNERGIES, ...CLASS_SYNERGIES];
  for (const s of active) {
    if (!s.active) continue;
    const def = defs.find((d) => d.id === s.id);
    if (!def) continue;
    for (const e of def.effects[s.tier - 1] ?? []) applyEffect(e, mods, flags);
  }
  for (const id of combos) {
    const def = COMBOS.find((c) => c.id === id);
    def?.effects.forEach((e) => applyEffect(e, mods, flags));
  }
  return { mods, flags };
}

function applyEffect(e: ModEffect | FlagEffect, mods: ModEffect[], flags: Record<string, number>) {
  if (e.kind === 'MOD') mods.push(e);
  else flags[e.flag] = (flags[e.flag] ?? 0) + e.value;
}

export function synergyDefs(): SynergyDef[] {
  return [...FACTION_SYNERGIES, ...CLASS_SYNERGIES];
}
