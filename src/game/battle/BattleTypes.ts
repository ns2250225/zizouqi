import type { Element, SkillDef, SkillKind, Team, UnitConfig, UnitState } from '../core/types';

export interface BattleUnit {
  uid: number;
  cfg: UnitConfig;
  team: Team;
  /** 逻辑坐标（单战线，0 = 顶端，1000 = 底端） */
  y: number;
  prevY: number;
  /** 视觉横向偏移（-1 ~ 1），不参与寻路 */
  x: number;
  hp: number;
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
  size: number;
  flying: boolean;
  alive: boolean;
  removed: boolean;
  state: UnitState;
  atkTimer: number;
  passives: Partial<Record<SkillKind, SkillDef>>;
  actives: { def: SkillDef; timer: number }[];
  targetUid: number;
  retargetTimer: number;
  stunT: number;
  freezeT: number;
  rootT: number;
  slowT: number;
  slowV: number;
  burnT: number;
  burnDps: number;
  poisonT: number;
  poisonDps: number;
  hasteT: number;
  shield: number;
  revivesLeft: number;
  cheatDeathUsed: boolean;
  ignoreBlock: boolean;
  isSummon: boolean;
  isBoss: boolean;
  squad: number;
  threat: number;
  deadTime: number;
  /** 渲染提示 */
  hitFlash: number;
  attackAnim: number;
  castAnim: number;
  specialUsed: boolean;
  statKey: string;
}

export type ProjectileKind =
  | 'arrow' | 'icearrow' | 'bolt' | 'bullet' | 'javelin' | 'shell' | 'rocket' | 'fireball' | 'iceshard' | 'spark'
  | 'holy' | 'dark' | 'poison' | 'arcane' | 'missile';

export interface DamagePacket {
  src: BattleUnit | null;
  team: Team;
  attack: number;
  mult: number;
  element: Element;
  pen: number;
  critChance: number;
  critDamage: number;
  isSkill: boolean;
  melee: boolean;
  label?: string;
  forceCrit?: boolean;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  team: Team;
  srcUid: number;
  targetUid: number;
  x: number;
  y: number;
  prevY: number;
  prevX: number;
  tx: number;
  ty: number;
  speed: number;
  alive: boolean;
  packet: DamagePacket;
  /** 命中后的范围伤害 */
  aoe?: { radius: number; pct: number; fx: string; status?: StatusApply; freeze?: number };
  status?: StatusApply;
  chain?: { jumps: number; pct: number; range: number };
  pierceLeft: number;
  piercePct: number;
  hitSet?: number[];
  arc: number;
  traveled: number;
  total: number;
  tint: number;
}

export interface StatusApply {
  status: 'poison' | 'burn' | 'slow' | 'freeze' | 'stun';
  duration: number;
  power: number;
  chance: number;
}

export interface Zone {
  id: number;
  kind: 'tornado' | 'poison' | 'fire' | 'timeslow';
  team: Team;
  y: number;
  x: number;
  radius: number;
  dir: number;
  speed: number;
  t: number;
  duration: number;
  tickT: number;
  dps: number;
  push: number;
  slow: number;
  src: BattleUnit | null;
  attack: number;
}

export interface Delayed {
  at: number;
  fn: () => void;
}

export type BattleEvent =
  | { t: 'spawn'; uid: number; summon: boolean }
  | { t: 'attack'; uid: number; tuid: number; ranged: boolean }
  | { t: 'hit'; uid: number; dmg: number; crit: boolean; element: Element; x: number; y: number; melee: boolean; blocked?: boolean }
  | { t: 'heal'; uid: number; amount: number; x: number; y: number }
  | { t: 'death'; uid: number; x: number; y: number }
  | { t: 'revive'; uid: number; x: number; y: number; fx: string }
  | { t: 'explosion'; x: number; y: number; radius: number; fx: string; element: Element; team: Team }
  | { t: 'lightning'; points: { x: number; y: number }[]; color?: number; big?: boolean }
  | { t: 'beam'; x: number; y0: number; y1: number; fx: string; width: number }
  | { t: 'breath'; x: number; y0: number; y1: number; fx: string }
  | { t: 'cone'; x: number; y0: number; y1: number }
  | { t: 'charge'; uid: number; x: number; fromY: number; toY: number }
  | { t: 'dash'; uid: number; x: number; fromY: number; toY: number }
  | { t: 'stomp'; x: number; y: number; radius: number; big: boolean }
  | { t: 'freeze'; x: number; y: number; radius: number }
  | { t: 'shield'; uid: number }
  | { t: 'cast'; uid: number; name: string; fx: string | null; team: Team; x: number; y: number }
  | { t: 'summon'; x: number; y: number; fx: string }
  | { t: 'meteorWarn'; x: number; y: number; radius: number; delay: number }
  | { t: 'arrowRain'; team: Team; y0: number; y1: number }
  | { t: 'slash'; x: number; y: number; dir: number; big: boolean }
  | { t: 'entangle'; x: number; y: number; radius: number }
  | { t: 'shake'; power: number }
  | { t: 'slowmo'; duration: number; scale: number }
  | { t: 'flash'; color: number; alpha: number }
  | { t: 'rage' }
  | { t: 'combo'; name: string; color: string }
  | { t: 'log'; text: string; team: Team };
