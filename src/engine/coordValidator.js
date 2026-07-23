// ══════════════════════════════════════════════════════════════════════════
//  좌표 오류 검출 (거리 기반) — 배송순번·배정 왜곡의 최대 원인 제거
//
//  형 지시(2026-07-23): 배송순번이 "먼거리 갔다 다시 와"의 진짜 원인은 순번
//  알고리즘이 아니라 **좌표 오류**였다(실측: 시흥시 안금순 좌표가 190km 밖 →
//  기사 구역 총거리를 938km로 부풀림. 오류 제거만으로 426km, 55% 단축).
//
//  기존 nexus 검증(`좌표검증상태='지자체벗어남'`)은 Kakao 역지오코딩 기반이라
//  ①이미 저장된 좌표는 재검증 안 되고 ②전건 API 호출이 느리다. 여기서는
//  **API 없이 거리만으로** 명백한 오류(다른 시/도로 튄 좌표)를 즉시 잡는다.
// ══════════════════════════════════════════════════════════════════════════

/** 두 좌표 사이 거리(km). haversine 직선거리. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = (x) => (Number(x) * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n !== 0 ? n : null; };
const getLat = (r) => num(r?._lat ?? r?.lat);
const getLng = (r) => num(r?._lng ?? r?.lng);
const hasCoord = (r) => getLat(r) != null && getLng(r) != null;

/** 좌표 배열의 중앙값 중심 — 평균과 달리 오류 좌표 몇 개에 흔들리지 않는다. */
export function medianCenter(records = []) {
  const lats = []; const lngs = [];
  for (const r of records) {
    if (!hasCoord(r)) continue;
    lats.push(getLat(r)); lngs.push(getLng(r));
  }
  if (!lats.length) return null;
  const med = (arr) => { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return { lat: med(lats), lng: med(lngs) };
}

/**
 * 지자체(또는 한 명단) 좌표 중앙값 중심에서 임계 반경을 벗어난 좌표를 오류로 검출한다.
 *
 * @param {Array} records 레코드들(같은 지자체 단위로 넘긴다)
 * @param {object} opts
 * @param {number} [opts.radiusKm=25] 이 거리 초과면 오류 후보(시군구 하나는 보통 반경 15km 이내)
 * @param {number} [opts.minSample=3] 좌표 표본이 이 미만이면 중심이 불안정 → 판정 보류
 * @returns {{ center:{lat,lng}|null, outliers: Array<{record, distanceKm}>, checked:number }}
 */
export function detectCoordOutliers(records = [], { radiusKm = 25, minSample = 3 } = {}) {
  const coordRecs = records.filter(hasCoord);
  if (coordRecs.length < minSample) return { center: null, outliers: [], checked: coordRecs.length };

  const center = medianCenter(coordRecs);
  const outliers = [];
  for (const r of coordRecs) {
    const d = haversineKm(getLat(r), getLng(r), center.lat, center.lng);
    if (d > radiusKm) outliers.push({ record: r, distanceKm: Math.round(d * 10) / 10 });
  }
  outliers.sort((a, b) => b.distanceKm - a.distanceKm); // 먼 것(가장 명백한 오류)부터
  return { center, outliers, checked: coordRecs.length };
}
