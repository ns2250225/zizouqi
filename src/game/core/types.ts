export type Rarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';
export const RARITIES: Rarity[] = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];
export const RARITY_NAMES: Record<Rarity, string> = {
  COMMON: '普通',
  RARE: '稀有',
  EPIC: '史诗',
  LEGENDARY: '传说',
  MYTHIC: '神话',
};
export const RARITY_COLORS: Record<Rarity, string> = {
  COMMON: '#d8dce6',
  RARE: '#4aa3ff',
  EPIC: '#b45cff',
  LEGENDARY: '#ffc23a',
  MYTHIC: '#ff3b4e',
};

/** 0 = 我方（下方，向 Y 负方向推进），1 = 敌方（上方，向 Y 正方向推进） */
export type Team = 0 | 1;

export type TargetPriority =
  | 'NEAREST'
  | 'LOWEST_HP'
  | 'HIGHEST_HP'
  | 'BACKLINE'
  | 'RANDOM'
  | 'MOST_DANGEROUS'
  | 'AREA_CLUSTER';

export type Element = 'physical' | 'fire' | 'ice' | 'lightning' | 'poison' | 'holy' | 'dark' | 'explosive';
export type Role = 'front' | 'mid' | 'back';

export type UnitState = 'SPAWN' | 'IDLE' | 'MOVE' | 'TARGET' | 'ATTACK' | 'CAST' | 'STUN' | 'KNOCKBACK' | 'DEAD';

export interface SpriteRef {
  sheet: 'dungeon' | 'onebit';
  index: number;
  tint?: string;
  scale: number;
}

export interface UnitStats {
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
}

export interface UnitConfig {
  id: string;
  name: string;
  faction: string;
  unitClass: string;
  tags: string[];
  role: Role;
  rarity: Rarity;
  cardCount: number;
  hp: number;
  attack: number;
  defense: number;
  attackSpeed: number;
  moveSpeed: number;
  attackRange: number;
  critChance: number;
  critDamage: number;
  armorPenetration: number;
  knockbackResistance: number;
  size: number;
  element: Element;
  projectile: string | null;
  skills: string[];
  targetPriority: TargetPriority;
  spriteAtlas: string;
  animationSet: string;
  sprite: SpriteRef;
  flying: boolean;
  summon: boolean;
  desc: string;
  nonCombatant?: boolean;
  untargetable?: boolean;
}

export type SkillKind =
  | 'multiHit' | 'block' | 'antiTag' | 'berserk' | 'dash' | 'charge' | 'auraHeal' | 'iaido' | 'splash'
  | 'onKillHeal' | 'stomp' | 'revive' | 'damageReduction' | 'multiShot' | 'pierce' | 'onHitStatus' | 'chain'
  | 'aoeAt' | 'freezeArea' | 'chainLightning' | 'healAllies' | 'summon' | 'tornado' | 'poisonCloud' | 'beam'
  | 'lifesteal' | 'timeSlow' | 'randomSpell' | 'meteor' | 'contactExplode' | 'mine' | 'coneAttack' | 'lineAttack'
  | 'missiles' | 'breath' | 'globalLightning' | 'burnAura' | 'resurrect' | 'multiTarget' | 'entangle';

export interface SkillDef {
  id: string;
  name: string;
  kind: SkillKind;
  trigger: 'passive' | 'active';
  cooldown: number;
  initialDelay: number;
  fx: string | null;
  element: Element | null;
  params: Record<string, any>;
  desc: string;
}

export type StatKey =
  | 'hp' | 'attack' | 'defense' | 'attackSpeed' | 'moveSpeed' | 'attackRange' | 'critChance' | 'critDamage'
  | 'armorPenetration' | 'damageTaken' | 'cooldown';

export interface ModEffect {
  kind: 'MOD';
  /** all | tag:<tag> | unit:<id> | role:<role> */
  target: string;
  stat: StatKey;
  value: number;
  permanent?: boolean;
}
export interface FlagEffect { kind: 'FLAG'; flag: string; value: number; permanent?: boolean }
export interface SpawnEffect { kind: 'SPAWN'; unit: string; count: number }
export interface PermSpawnEffect { kind: 'PERM_SPAWN'; unit: string; count: number; permanent?: boolean }
export interface SpellEffect { kind: 'SPELL'; spell: string; value: number; permanent?: boolean }
export interface RerollEffect { kind: 'REROLL'; value: number; permanent?: boolean }
export interface RarityEffect { kind: 'RARITY'; rarities: Rarity[]; value: number; permanent?: boolean }
export interface CountBonusEffect { kind: 'COUNT_BONUS'; value: number; minCount: number; permanent?: boolean }
export interface UpgradeTopEffect { kind: 'UPGRADE_TOP'; value: number; permanent?: boolean }

export type CardEffect =
  | ModEffect | FlagEffect | SpawnEffect | PermSpawnEffect | SpellEffect | RerollEffect | RarityEffect
  | CountBonusEffect | UpgradeTopEffect;

export interface Card {
  id: string;
  name: string;
  description: string;
  type: 'UNIT' | 'BUFF' | 'SPELL' | 'SYNERGY';
  rarity: Rarity;
  icon: string;
  unit: string | null;
  effects: CardEffect[];
  weight: number;
  minRound: number;
  tags: string[];
  category: string;
  requires: { tags?: string[]; cards?: string[]; minPicks?: number } | null;
}

export interface SynergyDef {
  id: string;
  name: string;
  icon: string;
  tag: string;
  tiers: number[];
  desc: string;
  effects: (ModEffect | FlagEffect)[][];
}

export interface ComboDef {
  id: string;
  name: string;
  icon: string;
  fx: string;
  color: string;
  requires: { units?: string[]; cards?: string[]; tagCount?: Record<string, number> };
  desc: string;
  effects: (ModEffect | FlagEffect)[];
}

export interface ActiveSynergy {
  id: string;
  name: string;
  icon: string;
  tier: number;
  count: number;
  next: number | null;
  desc: string;
  active: boolean;
}

/** 一方军队的完整输入（战斗只依赖它与随机种子，保证可复现） */
export interface ArmySpec {
  units: { unit: string; count: number }[];
  mods: ModEffect[];
  flags: Record<string, number>;
  spells: { spell: string; value: number }[];
  synergies: ActiveSynergy[];
  combos: string[];
  statMult: number;
  boss?: string | null;
}

export interface BattleSetup {
  seed: number;
  round: number;
  player: ArmySpec;
  enemy: ArmySpec;
  unitCap: number;
}

export interface UnitDamageStat {
  unit: string;
  name: string;
  team: Team;
  damage: number;
  kills: number;
  healing: number;
  taken: number;
}

export interface BattleOutcome {
  winner: Team | 'draw';
  reason: 'wipe' | 'timeout' | 'draw';
  time: number;
  survivors: [number, number];
  hpRatio: [number, number];
  stats: UnitDamageStat[];
  topUnit: { name: string; unit: string; team: Team; damage: number } | null;
  kills: [number, number];
}

export interface EnemyPlan {
  tacticId: string;
  tacticName: string;
  tacticIcon: string;
  tacticDesc: string;
  bracketName: string;
  army: ArmySpec;
  preview: { unit: string; count: number }[];
  isBoss: boolean;
  buffNames: string[];
  /** 无尽模式：本回合敌军强度相对第 1 回合的倍数 */
  strengthScale?: number;
}

export type GameMode = 'standard' | 'endless' | 'daily';
export type Phase = 'DRAW' | 'PREPARE' | 'BATTLE' | 'RESULT' | 'GAME_OVER';

export interface RoundRecord {
  round: number;
  winner: Team | 'draw';
  seed: number;
  setup: BattleSetup;
  topUnit: string | null;
  playerCards: string[];
  enemyTactic: string;
}

/** 本局永久成长（由永久卡牌累积） */
export interface Progression {
  mods: ModEffect[];
  flags: Record<string, number>;
  spawns: { unit: string; count: number }[];
  rarityMult: Partial<Record<Rarity, number>>;
  countBonus: { value: number; minCount: number }[];
  upgrades: { unit: string; value: number }[];
}

export interface RunState {
  version: number;
  id: string;
  mode: GameMode;
  difficulty: string;
  runSeed: number;
  rngState: number;
  round: number;
  maxHp: number;
  playerHp: number;
  enemyHp: number;
  phase: Phase;
  drawCount: number;
  offer: string[];
  luckyOffer: boolean;
  selectedCards: string[];
  history: string[];
  permanentBuffs: string[];
  progression: Progression;
  rerolls: number;
  enemyPlan: EnemyPlan | null;
  lastOutcome: BattleOutcome | null;
  rounds: RoundRecord[];
  dailyModifier: string | null;
  totalKills: number;
  totalDamage: number;
  startedAt: number;
  result: 'win' | 'lose' | 'draw' | null;
  lastPickStreak: { tag: string; count: number } | null;
  /** 无尽模式：第 1 回合敌军强度基准 */
  endlessBase?: number;
  /** 战斗单位（运行期，由战斗模拟器管理，不存档） */
  playerUnits?: unknown[];
  enemyUnits?: unknown[];
}
