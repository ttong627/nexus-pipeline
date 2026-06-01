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
// 월 처리한도 = 권한지역(지자체) 1개당 1만건. 등급 무관, 관리자만 무제한.
export const PER_CITY_MONTHLY_LIMIT = 10000;

export function getApprovedCityCount(u) {
  if (!u || typeof u === 'string') return 1;
  return Math.max(1, Array.isArray(u.citiesApproved) ? u.citiesApproved.length : 0);
}

export function getMonthlyLimit(u) {
  const { isAdmin } = _resolve(u);
  if (isAdmin) return Infinity;
  return getApprovedCityCount(u) * PER_CITY_MONTHLY_LIMIT;
}
