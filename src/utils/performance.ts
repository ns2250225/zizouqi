export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type ResolvedQuality = 'low' | 'medium' | 'high';

export interface PerfProfile {
  tier: ResolvedQuality;
  maxParticles: number;
  unitCap: number;
  damageNumbers: number;
  resolution: number;
}

const PROFILES: Record<ResolvedQuality, Omit<PerfProfile, 'tier' | 'resolution'>> = {
  high: { maxParticles: 1500, unitCap: 120, damageNumbers: 60 },
  medium: { maxParticles: 800, unitCap: 90, damageNumbers: 40 },
  low: { maxParticles: 400, unitCap: 60, damageNumbers: 24 },
};

export function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}

/** 根据设备信息自动分级；运行中 FPS 过低时可再降级 */
export function detectTier(): ResolvedQuality {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (isMobile()) return cores >= 8 && mem >= 6 ? 'medium' : 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  return cores >= 4 ? 'medium' : 'low';
}

export function resolveProfile(q: Quality): PerfProfile {
  const tier = q === 'auto' ? detectTier() : q;
  const dpr = window.devicePixelRatio || 1;
  return {
    tier,
    ...PROFILES[tier],
    resolution: Math.min(dpr, tier === 'high' ? 2 : tier === 'medium' ? 1.5 : 1),
  };
}

export function lowerTier(t: ResolvedQuality): ResolvedQuality {
  return t === 'high' ? 'medium' : 'low';
}

export function profileFor(tier: ResolvedQuality): PerfProfile {
  const dpr = window.devicePixelRatio || 1;
  return { tier, ...PROFILES[tier], resolution: Math.min(dpr, tier === 'high' ? 2 : tier === 'medium' ? 1.5 : 1) };
}
