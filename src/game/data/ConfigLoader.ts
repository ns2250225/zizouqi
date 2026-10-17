import unitsJson from '../../data/units.json';
import cardsJson from '../../data/cards.json';
import skillsJson from '../../data/skills.json';
import synergiesJson from '../../data/synergies.json';
import balanceJson from '../../data/balance.json';
import type { Card, ComboDef, Rarity, SkillDef, SynergyDef, UnitConfig } from '../core/types';

export const UNITS: UnitConfig[] = (unitsJson as { units: UnitConfig[] }).units;
export const CARDS: Card[] = (cardsJson as { cards: Card[] }).cards;
export const SKILLS: SkillDef[] = (skillsJson as { skills: SkillDef[] }).skills;
export const FACTION_SYNERGIES: SynergyDef[] = synergiesJson.factions as SynergyDef[];
export const CLASS_SYNERGIES: SynergyDef[] = synergiesJson.classes as SynergyDef[];
export const COMBOS: ComboDef[] = synergiesJson.combos as ComboDef[];

export interface Tactic {
  id: string;
  name: string;
  icon: string;
  desc: string;
  pool: string[];
  rarityCap?: Rarity;
}
export interface RoundBracket {
  from: number;
  to: number;
  name: string;
  tactics: string[];
  rarityCap: Rarity;
  synergy: boolean;
  buffs: number;
  multiTactic?: boolean;
  budgetMult?: number;
}
export interface DailyModifier {
  id: string;
  name: string;
  desc: string;
  player?: any[];
  enemy?: any[];
  rarityBoost?: Partial<Record<Rarity, number>>;
  enemyMult?: number;
  startHp?: number;
  rerolls?: number;
}

type BalanceJson = typeof balanceJson;
export const BALANCE = balanceJson as unknown as Omit<BalanceJson, 'tactics' | 'roundBrackets' | 'dailyModifiers'> & {
  tactics: Tactic[];
  roundBrackets: RoundBracket[];
  dailyModifiers: DailyModifier[];
};

export const UNIT_MAP = new Map(UNITS.map((u) => [u.id, u]));
export const CARD_MAP = new Map(CARDS.map((c) => [c.id, c]));
export const SKILL_MAP = new Map(SKILLS.map((s) => [s.id, s]));

export function getUnit(id: string): UnitConfig {
  const u = UNIT_MAP.get(id);
  if (!u) throw new Error(`unknown unit ${id}`);
  return u;
}

export function getCard(id: string): Card {
  const c = CARD_MAP.get(id);
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
}

export const RARITY_POWER = BALANCE.rarity.power as Record<Rarity, number>;

/** 单个单位的战力估值，用于敌方预算与战力统计 */
export function unitPower(u: UnitConfig): number {
  const count = Math.max(1, u.cardCount || 2);
  return RARITY_POWER[u.rarity] / count;
}
