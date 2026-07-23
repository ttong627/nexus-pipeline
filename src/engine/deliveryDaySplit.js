// ══════════════════════════════════════════════════════════════════════════
//  수량 기반 배송 일자 분할 (배송일차)
//
//  형 지시(2026-07-23): "수량 많은 경우는 일자도 나눌 수 있게" —
//   ① 하루 최대 물량(포수) 자동 분할  ② 날짜 개수 직접 지정  (둘 다 지원)
//   ③ 지역(동·권역)별로 묶어서 — 가까운 곳끼리 같은 날(동선 최소화)
//
//  설계: 행정동을 권역 단위로 본다(같은 동은 절대 쪼개지 않음 → 기사 동선·관리 단순).
//   동을 지리적 최근접 순서로 정렬한 뒤, 그 순서대로 날짜에 배분한다.
//   → 1일차=한쪽, 다음 날=인접 권역 식으로 자연히 뭉친다. 각 날 안의 방문순번은
//   기존 배송순번 엔진(roadAwareTSP)이 담당(여기서는 '어느 날 어느 동'만 정한다).
// ══════════════════════════════════════════════════════════════════════════
import { haversine } from './routeSequenceEngine.js';

const S = (v) => String(v ?? '').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n !== 0 ? n : null; };
const getLat = (r) => num(r?._lat ?? r?.lat);
const getLng = (r) => num(r?._lng ?? r?.lng);
const defaultLoad = (r) => (parseInt(r?.포수 ?? r?.['수량(포수)'], 10) || 1);
const dongOf = (r) => S(r?.행정동 || r?.dong || r?.배정행정동) || '(미분류)';

/** 행정동별로 묶어 물량합·중심좌표 산출 */
function buildDongGroups(records, getLoad) {
  const map = new Map();
  records.forEach((r, idx) => {
    const key = dongOf(r);
    if (!map.has(key)) map.set(key, { dong: key, records: [], load: 0, lat: 0, lng: 0, coordN: 0 });
    const g = map.get(key);
    g.records.push({ r, idx });
    g.load += Math.max(0, Number(getLoad(r)) || 0);
    const la = getLat(r); const ln = getLng(r);
    if (la != null && ln != null) { g.lat += la; g.lng += ln; g.coordN += 1; }
  });
  return [...map.values()].map((g) => ({
    ...g,
    lat: g.coordN ? g.lat / g.coordN : null,
    lng: g.coordN ? g.lng / g.coordN : null,
  }));
}

/** 동을 지리적 최근접 체인으로 정렬(출발지 또는 최서단부터). 좌표 없는 동은 맨 뒤. */
function orderDongsByProximity(groups, depot) {
  const withCoord = groups.filter((g) => g.lat != null);
  const noCoord = groups.filter((g) => g.lat == null).sort((a, b) => a.dong.localeCompare(b.dong, 'ko'));
  if (!withCoord.length) return noCoord;

  const remain = [...withCoord];
  let startIdx = 0;
  if (depot && num(depot.lat) != null) {
    startIdx = remain.reduce((best, g, i) => (haversine(depot.lat, depot.lng, g.lat, g.lng) < haversine(depot.lat, depot.lng, remain[best].lat, remain[best].lng) ? i : best), 0);
  } else {
    // 출발지 없으면 최서단(경도 최소)부터 — 결정론적
    startIdx = remain.reduce((best, g, i) => (g.lng < remain[best].lng ? i : best), 0);
  }
  const ordered = [remain.splice(startIdx, 1)[0]];
  while (remain.length) {
    const last = ordered[ordered.length - 1];
    const ni = remain.reduce((best, g, i) => (haversine(last.lat, last.lng, g.lat, g.lng) < haversine(last.lat, last.lng, remain[best].lat, remain[best].lng) ? i : best), 0);
    ordered.push(remain.splice(ni, 1)[0]);
  }
  return [...ordered, ...noCoord];
}

/**
 * 배송을 여러 날로 나눈다. 같은 동은 같은 날(권역 보존), 가까운 동끼리 인접 날.
 *
 * @param {Array} records 정제된 명단 레코드
 * @param {object} opts
 * @param {number} [opts.maxLoadPerDay] 하루 최대 물량(포수). 이 값 기준으로 자동 일수 산출.
 * @param {number} [opts.numDays] 날짜 개수 직접 지정(총물량을 균등 배분).
 *                                maxLoadPerDay 와 동시 지정 시 maxLoadPerDay 우선.
 * @param {(r)=>number} [opts.getLoad] 체감물량 함수(기본 포수). getEffectiveLoad 주입 가능.
 * @param {{lat,lng}} [opts.depot] 출발지(최근접 동부터 1일차).
 * @returns {Array} records 복사본에 `배송일차`(1..N) 부여
 */
export function splitByDay(records = [], { maxLoadPerDay = null, numDays = null, getLoad = defaultLoad, depot = null } = {}) {
  if (!records.length) return [];

  const groups = buildDongGroups(records, getLoad);
  const ordered = orderDongsByProximity(groups, depot);
  const totalLoad = ordered.reduce((a, g) => a + g.load, 0);

  // 하루 목표 물량 결정
  let cap;
  if (maxLoadPerDay && maxLoadPerDay > 0) {
    cap = maxLoadPerDay;
  } else if (numDays && numDays > 1) {
    cap = totalLoad / numDays;      // 균등 목표
  } else {
    cap = Infinity;                 // 분할 안 함 → 전부 1일차
  }

  // numDays 모드는 정확히 N일을 지킨다(마지막 날엔 초과해도 계속 담아 N+1일이 생기지 않게).
  //  maxLoadPerDay 모드는 상한이 하드 제약이라 필요한 만큼 날짜가 늘어난다(일수 자동).
  const hardCap = !!(maxLoadPerDay && maxLoadPerDay > 0);
  const dayLimit = (!hardCap && numDays && numDays > 1) ? numDays : Infinity;

  // 체인 순서대로 누적 배분. 같은 동은 통째로 한 날에.
  const dayOfDong = new Map();
  let day = 1; let acc = 0;
  ordered.forEach((g) => {
    // 이번 동을 넣으면 상한 초과 && 이미 이 날에 담긴 게 있음 → 다음 날로 (동은 안 쪼갬)
    // 단, numDays 모드에서 이미 마지막 날이면 넘기지 않고 계속 담는다(정확히 N일 보장).
    if (acc > 0 && acc + g.load > cap && Number.isFinite(cap) && day < dayLimit) {
      day += 1; acc = 0;
    }
    dayOfDong.set(g.dong, day);
    acc += g.load;
  });

  return records.map((r) => ({ ...r, 배송일차: dayOfDong.get(dongOf(r)) || 1 }));
}

/** 분할 결과 요약(화면·검증용) */
export function summarizeDaySplit(records) {
  const byDay = new Map();
  records.forEach((r) => {
    const d = r.배송일차 || 1;
    if (!byDay.has(d)) byDay.set(d, { day: d, count: 0, load: 0, dongs: new Set() });
    const s = byDay.get(d);
    s.count += 1; s.load += defaultLoad(r); s.dongs.add(dongOf(r));
  });
  return [...byDay.values()].sort((a, b) => a.day - b.day).map((s) => ({ ...s, dongs: [...s.dongs] }));
}
