export const TIER_ORDER = ['basic', 'vip', 'vvip', 'sapphire'];
export const TIER_LABELS = { basic: '일반', vip: 'VIP', vvip: 'VVIP', sapphire: '사파이어' };

export function tierAtLeast(userTier, required) {
  return TIER_ORDER.indexOf(userTier || 'basic') >= TIER_ORDER.indexOf(required);
}

export function canUseCoords(tier)         { return tierAtLeast(tier, 'vip'); }
export function canUseCoordsBg(tier)       { return tierAtLeast(tier, 'vvip'); }
export function canUseRouteMap(tier)       { return tierAtLeast(tier, 'vip'); }
export function canUseAI(tier)             { return tierAtLeast(tier, 'vvip'); }
export function canUseDbOverview(tier)     { return tierAtLeast(tier, 'vvip'); }
export function canUseDriverRegistry(tier) { return tierAtLeast(tier, 'vvip'); }

export function getMaxCities(tier)    { return ({ basic: 1, vip: 5, vvip: 20, sapphire: Infinity }[tier || 'basic'] ?? 1); }
export function getMonthlyLimit(tier) { return ({ basic: 500, vip: 3000, vvip: 10000, sapphire: Infinity }[tier || 'basic'] ?? 500); }
