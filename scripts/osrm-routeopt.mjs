// 실도로(OSRM) 순번 최적화 유틸 — yyplus routeOptim 이식(Node 배치/시뮬 전용).
// OSRM 행렬은 yyplus 공개 프록시(wssc.kr/api/route/table)를 재사용 → nexus 별도 OSRM 배포 불필요.
// 운영 엔진(src/engine/routeSequenceEngine.roadAwareTSP)은 건드리지 않는다(시뮬 비교 전용).
const OSRM_PROXY = process.env.OSRM_PROXY || 'https://wssc.kr/api/route/table';

/** 두 좌표 간 직선거리(m). 좌표 없으면 0. */
export function haversine(a, b) {
  if (!a || !b || a.lat == null || b.lat == null || a.lng == null || b.lng == null) return 0;
  const R = 6371000;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** NN→2-opt 직선거리 순번(폴백용). depot 없으면 첫 점에서 시작. */
export function optimizeRoute(points, depot) {
  const pts = (points || []).filter((p) => p.lat != null && p.lng != null);
  if (pts.length <= 1) return pts.map((p, i) => ({ ...p, sequence: i + 1 }));
  const start = (depot && depot.lat != null && depot.lng != null) ? depot : pts[0];
  const rem = [...pts]; const route = []; let cur = start;
  while (rem.length) { let bi = 0, bd = Infinity; rem.forEach((p, i) => { const d = haversine(cur, p); if (d < bd) { bd = d; bi = i; } }); cur = rem.splice(bi, 1)[0]; route.push(cur); }
  const full = [start, ...route, start];
  let improved = true, guard = 0;
  while (improved && guard < 80) {
    improved = false; guard += 1;
    for (let i = 1; i < full.length - 2; i += 1) for (let j = i + 1; j < full.length - 1; j += 1) {
      const a = full[i - 1], b = full[i], c = full[j], d = full[j + 1];
      if (haversine(a, c) + haversine(b, d) + 1e-6 < haversine(a, b) + haversine(c, d)) {
        let lo = i, hi = j; while (lo < hi) { const t = full[lo]; full[lo] = full[hi]; full[hi] = t; lo += 1; hi -= 1; } improved = true;
      }
    }
  }
  return full.slice(1, full.length - 1).map((p, i) => ({ ...p, sequence: i + 1 }));
}

/**
 * 실도로 거리행렬로 방문순서 최적화(NN→2-opt). matrix index 0=depot, 1..N=points[0..N-1].
 * 행렬이 안 맞으면 직선거리로 폴백.
 */
export function optimizeRouteByMatrix(points, matrix) {
  const pts = points || [];
  if (pts.length <= 1) return pts.map((p, i) => ({ ...p, sequence: i + 1 }));
  if (!Array.isArray(matrix) || matrix.length !== pts.length + 1) return optimizeRoute(pts, null);
  const N = pts.length + 1;
  const dist = (i, j) => { const row = matrix[i]; const v = row && row[j]; return (v == null ? Infinity : v); };
  const rem = [...Array(N).keys()].slice(1); const route = [0]; let cur = 0;
  while (rem.length) { let bi = 0, bd = Infinity; rem.forEach((p, i) => { const d = dist(cur, p); if (d < bd) { bd = d; bi = i; } }); cur = rem.splice(bi, 1)[0]; route.push(cur); }
  route.push(0);
  let improved = true, guard = 0;
  while (improved && guard < 80) {
    improved = false; guard += 1;
    for (let i = 1; i < route.length - 2; i += 1) for (let j = i + 1; j < route.length - 1; j += 1) {
      const a = route[i - 1], b = route[i], c = route[j], d = route[j + 1];
      if (dist(a, c) + dist(b, d) + 1e-6 < dist(a, b) + dist(c, d)) {
        let lo = i, hi = j; while (lo < hi) { const t = route[lo]; route[lo] = route[hi]; route[hi] = t; lo += 1; hi -= 1; } improved = true;
      }
    }
  }
  return route.slice(1, route.length - 1).map((idx, i) => ({ ...pts[idx - 1], sequence: i + 1 }));
}

/**
 * 출발지+가구 좌표로 실도로 거리/시간 행렬을 받아온다(wssc.kr/api/route/table → OSRM).
 * 실패 시 null → 호출측이 직선거리로 폴백. coords 0번=depot, 1..N=points.
 * @returns {{distances:number[][], durations:number[][], source:string}|null}
 */
export async function fetchRoadMatrix(depot, points) {
  try {
    if (!depot || depot.lat == null || depot.lng == null) return null;
    const pts = (points || []).filter((p) => p.lat != null && p.lng != null);
    if (pts.length < 2) return null;
    const coords = [{ lat: Number(depot.lat), lng: Number(depot.lng) }, ...pts.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))];
    const res = await fetch(OSRM_PROXY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coords }), signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (!data || !data.ok || !Array.isArray(data.distances)) return null;
    return { distances: data.distances, durations: data.durations, source: data.source };
  } catch { return null; }
}
