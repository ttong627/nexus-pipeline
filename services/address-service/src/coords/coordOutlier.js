// ══════════════════════════════════════════════════════════════════
//  C-6 ⑥ 좌표 이상치 검증 (순수) — 설계서 좌표관리_설계.md §3-5·F5
//  회귀: scripts/coord-outlier.test.mjs
//
//  ★DB도 네트워크도 여기서 만지지 않는다. coordFill.js 와 같은 원칙 —
//    "이 좌표를 이상치로 볼 것인가"를 DB 없이 회귀로 고정할 수 있어야 한다.
//
//  ★판정 기준은 화면과 **같은 함수**를 쓴다(shared/coordValidator.js).
//    배치가 자기만의 기준을 복제하면 "화면에선 정상인데 배치가 outlier 로 찍는"
//    어긋남이 생기고, 그 어긋남은 에러 없이 기사 구역만 조용히 갉아먹는다.
//
//  ★좌표를 지우지 않는다(형 지시·DS-15). 표시만 한다. 지운 좌표는 되돌릴 방법이
//    없지만, 표시는 사람이 보고 판단할 수 있다.
// ══════════════════════════════════════════════════════════════════
import { detectCoordOutliers } from '../shared/coordValidator.js';

/** 시군구 하나는 보통 반경 15km 이내다. 25km 를 넘으면 다른 지자체로 튄 좌표다. */
export const OUTLIER_RADIUS_KM = 25;

/**
 * 판정에 필요한 최소 표본.
 *
 * ★기본 20 이다. `detectCoordOutliers` 자체 기본값은 3 이지만, 3건으로 잡은 중앙값은
 *   그 3건이 다 같은 아파트일 때 시군구 중심이 아니라 **그 아파트 위치**가 된다.
 *   그러면 정상 좌표가 무더기로 이상치로 찍히고, 순번 엔진은 그것들을 좌표 없음으로
 *   취급한다(F5) — 배송이 실제로 망가진다. 표본이 적으면 판정하지 않는 편이 안전하다.
 */
export const OUTLIER_MIN_SAMPLE = 20;

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n !== 0 ? n : null; };

/**
 * 건물 행의 대표점 — 입구 좌표가 있으면 그것, 없으면 중심 좌표.
 *
 * ★내비 목적지 선택 순서(입구 → 중심)와 같은 순서로 본다. 실제로 기사에게 주는 점을
 *   검증해야지, 안 쓰는 점을 검증하면 통과해도 의미가 없다.
 */
export const coordPoint = (row) => {
  const lat = num(row?.entrance_lat ?? row?.center_lat);
  const lng = num(row?.entrance_lng ?? row?.center_lng);
  return lat != null && lng != null ? { lat, lng } : null;
};

/** 시군구별로 나눈다 — 중앙값 중심은 같은 지자체 안에서만 의미가 있다. */
export const groupBySigungu = (rows = []) => {
  const groups = new Map();
  for (const row of rows) {
    if (!row?.coord_key) continue;
    const key = String(row.sigungu || '').trim();
    // ★시군구가 비어 있으면 어느 중심과 비교해야 할지 모른다. 전국을 한 덩어리로 묶어
    //   중앙값을 내면 서울·부산이 서로를 이상치로 만든다 → 판정에서 뺀다.
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
};

/**
 * 표시할 이상치를 계산한다. **쓰기 계획만 만들고 쓰지는 않는다.**
 *
 * @returns {{
 *   marks: Array<{coordKey:string, sigungu:string, roadAddress:string, distanceKm:number, note:string}>,
 *   stale: Array<{coordKey:string, sigungu:string}>,
 *   groups: Array<{sigungu:string, checked:number, outliers:number, skipped:string|null}>,
 *   checked:number
 * }}
 *   marks = 이번에 새로 `quality='outlier'` 로 찍을 것(이미 찍힌 건 제외 — 매일 같은 행을 갱신하면
 *           updated_at 이 밀려 채움 배치의 오래된 순 정렬이 망가진다)
 *   stale = 이미 outlier 인데 이번 판정은 정상 범위인 것. **자동 해제하지 않고 보고만 한다** —
 *           채움 경로가 outlier 를 재채움 대상으로 삼으므로(classifyFillTargets),
 *           좌표가 새로 잡히는 순간 writeCoordRow 가 quality 를 'unverified' 로 올려 자연 복구된다.
 */
export const planOutlierMarks = (rows = [], { radiusKm = OUTLIER_RADIUS_KM, minSample = OUTLIER_MIN_SAMPLE } = {}) => {
  const marks = [];
  const stale = [];
  const groups = [];
  let checked = 0;

  for (const [sigungu, list] of groupBySigungu(rows)) {
    const recs = [];
    for (const row of list) {
      const p = coordPoint(row);
      if (!p) continue;   // 좌표 없는 행(quality='none' 등)은 검증 대상이 아니다
      recs.push({ _lat: p.lat, _lng: p.lng, row });
    }
    if (recs.length < minSample) {
      groups.push({ sigungu, checked: recs.length, outliers: 0, skipped: 'minSample' });
      continue;
    }
    checked += recs.length;
    const { outliers, center } = detectCoordOutliers(recs, { radiusKm, minSample });
    const hit = new Set();
    for (const o of outliers) {
      const row = o.record?.row;
      if (!row) continue;
      hit.add(row.coord_key);
      if (row.quality === 'outlier') continue;   // 이미 표시됨 — 다시 쓰지 않는다
      marks.push({
        coordKey: row.coord_key,
        sigungu,
        roadAddress: row.road_address || '',
        distanceKm: o.distanceKm,
        note: `중앙값 중심에서 ${o.distanceKm}km (기준 ${radiusKm}km, 표본 ${recs.length}, 중심 ${center.lat.toFixed(5)},${center.lng.toFixed(5)})`,
      });
    }
    for (const r of recs) {
      if (r.row.quality === 'outlier' && !hit.has(r.row.coord_key)) stale.push({ coordKey: r.row.coord_key, sigungu });
    }
    groups.push({ sigungu, checked: recs.length, outliers: outliers.length, skipped: null });
  }

  // 먼 것(가장 명백한 오류)부터 — 로그 샘플에 진짜 문제가 먼저 보이게 한다.
  marks.sort((a, b) => b.distanceKm - a.distanceKm);
  groups.sort((a, b) => b.outliers - a.outliers);
  return { marks, stale, groups, checked };
};
