export const TIER_ORDER = ['basic', 'vip', 'vvip', 'sapphire'];
export const TIER_LABELS = { basic: '일반', vip: 'VIP', vvip: 'VVIP', sapphire: '사파이어' };

// user 객체 또는 tier 문자열 모두 허용 — admin role이면 모든 tier 체크 우회
function _resolve(userOrTier) {
  if (!userOrTier || typeof userOrTier === 'string') return { tier: userOrTier, isAdmin: false };
  return { tier: userOrTier.tier, isAdmin: userOrTier.role === 'admin' };
}

export function tierAtLeast(userOrTier, required) {
  const { tier, isAdmin } = _resolve(userOrTier);
  if (isAdmin) return true;
  return TIER_ORDER.indexOf(tier || 'basic') >= TIER_ORDER.indexOf(required);
}

export function canUseCoords(u)         { return tierAtLeast(u, 'vip'); }
export function canUseCoordsBg(u)       { return tierAtLeast(u, 'vvip'); }
export function canUseRouteMap(u)       { return tierAtLeast(u, 'vip'); }
export function canUseAI(u)             { return tierAtLeast(u, 'vvip'); }
export function canUseDbOverview(u)     { return tierAtLeast(u, 'vvip'); }
export function canUseDriverRegistry(u) { return tierAtLeast(u, 'vvip'); }

export function getMaxCities(u) {
  const { tier, isAdmin } = _resolve(u);
  if (isAdmin) return Infinity;
  return ({ basic: 1, vip: 5, vvip: 20, sapphire: Infinity }[tier || 'basic'] ?? 1);
}
export function getMonthlyLimit(u) {
  const { tier, isAdmin } = _resolve(u);
  if (isAdmin) return Infinity;
  return ({ basic: 500, vip: 3000, vvip: 10000, sapphire: Infinity }[tier || 'basic'] ?? 500);
}
