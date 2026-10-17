import { BALANCE, CARDS, getUnit } from '../data/ConfigLoader';
import type { Card, Rarity, RunState } from '../core/types';
import { RARITIES } from '../core/types';
import type { Rng } from '../core/rng';

const R = BALANCE.rarity;

/** 当前回合各稀有度的抽取权重：基础权重随回合推移向高稀有度倾斜，并受成长效果与每日挑战影响 */
export function rarityWeights(run: RunState): Record<Rarity, number> {
  const out = {} as Record<Rarity, number>;
  const daily = run.dailyModifier ? BALANCE.dailyModifiers.find((d) => d.id === run.dailyModifier) : null;
  for (const r of RARITIES) {
    const base = (R.baseWeights as Record<Rarity, number>)[r] + (R.perRound as Record<Rarity, number>)[r] * (run.round - 1);
    const clamped = Math.min((R.maxWeights as Record<Rarity, number>)[r], Math.max((R.minWeights as Record<Rarity, number>)[r], base));
    const boost = 1 + (run.progression.rarityMult[r] ?? 0);
    const dailyBoost = daily?.rarityBoost?.[r] ?? 1;
    out[r] = clamped * boost * dailyBoost;
  }
  return out;
}

export function rarityPercents(run: RunState): Record<Rarity, number> {
  const w = rarityWeights(run);
  const total = RARITIES.reduce((s, r) => s + w[r], 0);
  const out = {} as Record<Rarity, number>;
  for (const r of RARITIES) out[r] = (w[r] / total) * 100;
  return out;
}

/** 卡牌是否满足前置条件 */
export function isEligible(card: Card, run: RunState): boolean {
  if (card.minRound > run.round) return false;
  const req = card.requires;
  if (!req) return true;
  if (req.cards && !req.cards.every((id) => run.history.includes(id))) return false;
  if (req.tags) {
    const picked = run.history.filter((id) => id.startsWith('u_'));
    const ok = req.tags.every((tag) => picked.some((id) => getUnit(id.slice(2)).tags.includes(tag)));
    if (!ok) return false;
  }
  if (req.minPicks) {
    const counts = new Map<string, number>();
    for (const id of run.history) if (id.startsWith('u_')) counts.set(id, (counts.get(id) ?? 0) + 1);
    if (![...counts.values()].some((n) => n >= req.minPicks!)) return false;
  }
  return true;
}

export function eligibleCards(run: RunState): Card[] {
  return CARDS.filter((c) => isEligible(c, run));
}

/** 生成一组三选一候选卡：先按稀有度权重抽稀有度，再在该稀有度内按卡牌权重抽卡；同组默认不重复 */
export function generateOffer(run: RunState, rng: Rng): { offer: string[]; lucky: boolean } {
  const pool = eligibleCards(run);
  const weights = rarityWeights(run);
  const count = BALANCE.optionsPerDraw;
  // 特殊事件：幸运三连，三张相同兵种卡，选择后效果翻倍
  if (run.round >= 3 && rng.chance(BALANCE.luckyEventChance)) {
    const units = pool.filter((c) => c.type === 'UNIT' && c.rarity !== 'MYTHIC');
    if (units.length) {
      const c = rng.pick(units);
      return { offer: Array(count).fill(c.id), lucky: true };
    }
  }
  const offer: string[] = [];
  let guard = 0;
  while (offer.length < count && guard++ < 50) {
    const available = RARITIES.filter((r) => pool.some((c) => c.rarity === r && !offer.includes(c.id)));
    const rarity = rng.weighted(available, (r) => weights[r]);
    if (!rarity) break;
    const cands = pool.filter((c) => c.rarity === rarity && !offer.includes(c.id));
    const card = rng.weighted(cands, (c) => c.weight);
    if (card) offer.push(card.id);
  }
  return { offer, lucky: false };
}
