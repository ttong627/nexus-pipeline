// 인근 행정동 패턴 배정 — 형 지시 2026-08-27:
//   "기사 배정 패턴에 따라서 인근 지역도 마찬가지로 배정을 해줘야 해."
//
//   무엇을 하나: **아직 아무도 배정 안 된 행정동**을, 이미 배정된 **가장 가까운 동**의 기사에게 제안한다.
//   왜 이렇게: 기사 구역은 이어져 있어야 한다(R-0 배타적 구역·R-J 외곽 묶음의 취지).
//   떨어진 동을 남겨 두면 나중에 누군가 한 번 더 왕복한다.
//
//   ★제안만 한다. 바로 적용하지 않는다 — 담당자가 보고 누른다(임의 배정 금지 · M-1·S-5 취지).
//   ★동의 위치는 **중앙값**으로 잡는다. 평균은 좌표 하나가 튀면 통째로 끌려간다(DS-15 에서 겪었다).

const median = (nums) => {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
export const distanceM = (a, b) => {
  if (!a || !b) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

/** 행정동별 중앙 좌표와 건수 */
export const dongCentroids = (records = [], { getDong, getLat, getLng } = {}) => {
  const gd = getDong || ((r) => String(r?.행정동 ?? '').trim());
  const gy = getLat || ((r) => Number(r?._lat ?? r?.lat));
  const gx = getLng || ((r) => Number(r?._lng ?? r?.lng));
  const bag = new Map();
  for (const r of records || []) {
    const d = gd(r);
    if (!d) continue;
    if (!bag.has(d)) bag.set(d, { lats: [], lngs: [], count: 0 });
    const b = bag.get(d);
    b.count += 1;
    const y = gy(r); const x = gx(r);
    if (Number.isFinite(y) && Number.isFinite(x)) { b.lats.push(y); b.lngs.push(x); }
  }
  const out = new Map();
  for (const [d, b] of bag) {
    const lat = median(b.lats); const lng = median(b.lngs);
    out.set(d, { lat, lng, count: b.count, hasCoord: lat != null && lng != null });
  }
  return out;
};

/** 동별 대표 기사 = 그 동에서 가장 많이 배정된 기사(동률이면 먼저 나온 쪽) */
export const dongMajorityDriver = (records = [], { getDong, getDriverId } = {}) => {
  const gd = getDong || ((r) => String(r?.행정동 ?? '').trim());
  const gi = getDriverId || ((r) => r?._driverId || '');
  const bag = new Map();
  for (const r of records || []) {
    const d = gd(r); const id = gi(r);
    if (!d || !id) continue;
    if (!bag.has(d)) bag.set(d, new Map());
    const m = bag.get(d);
    m.set(id, (m.get(id) || 0) + 1);
  }
  const out = new Map();
  for (const [d, m] of bag) {
    let best = null; let bestN = 0;
    for (const [id, n] of m) if (n > bestN) { best = id; bestN = n; }
    if (best) out.set(d, { driverId: best, count: bestN });
  }
  return out;
};

/**
 * 미배정 동에 인근 기사 배정을 제안한다.
 *   @param maxDistanceM 이 거리를 넘으면 제안하지 않는다(엉뚱한 곳까지 끌고 가면 왕복이 늘어난다)
 *   @returns [{ dong, driverId, fromDong, distanceM, count }]
 */
export const suggestNearbyAssignments = (records = [], opts = {}) => {
  const { maxDistanceM = 3000 } = opts;
  const centroids = dongCentroids(records, opts);
  const majority = dongMajorityDriver(records, opts);
  const gd = opts.getDong || ((r) => String(r?.행정동 ?? '').trim());
  const gi = opts.getDriverId || ((r) => r?._driverId || '');

  // 그 동에 배정된 건이 **하나도 없을 때만** 미배정 동으로 본다(일부만 배정된 동은 담당자가 손대는 중일 수 있다)
  const anyAssigned = new Set();
  for (const r of records || []) { const d = gd(r); if (d && gi(r)) anyAssigned.add(d); }

  const out = [];
  for (const [dong, c] of centroids) {
    if (anyAssigned.has(dong) || !c.hasCoord) continue;
    let best = null;
    for (const [other, oc] of centroids) {
      if (other === dong || !oc.hasCoord) continue;
      const mj = majority.get(other);
      if (!mj) continue;
      const dist = distanceM(c, oc);
      if (dist > maxDistanceM) continue;
      if (!best || dist < best.distanceM) best = { dong, driverId: mj.driverId, fromDong: other, distanceM: Math.round(dist), count: c.count };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
};

/** 제안을 실제로 적용한다 — **이미 배정된 건은 건드리지 않는다** */
export const applyNearbySuggestions = (records = [], suggestions = [], opts = {}) => {
  const gd = opts.getDong || ((r) => String(r?.행정동 ?? '').trim());
  const gi = opts.getDriverId || ((r) => r?._driverId || '');
  const byDong = new Map(suggestions.map((s) => [s.dong, s.driverId]));
  let applied = 0;
  const out = (records || []).map((r) => {
    const d = gd(r);
    const id = byDong.get(d);
    if (!id || gi(r)) return r;      // 배정된 건은 그대로
    applied += 1;
    return { ...r, _driverId: id };
  });
  return { records: out, applied };
};
