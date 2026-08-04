/**
 * 배송 순번·일정 코어 서비스 — `/v1/routing/*` 의 알맹이. 순수(네트워크·DB 무관).
 *
 * ★이 파일이 하는 일은 "조립"뿐이다
 *   순번 알고리즘은 `routeSequenceEngine.js`(운영 검증된 1,227줄)가, 일자 분할은
 *   `deliveryDaySplit.js` 가 한다. 여기서 로직을 다시 쓰지 않는다 —
 *   같은 로직이 3벌이던 걸 방금 1벌로 줄였는데 여기서 4벌째를 만들면 그 작업이 무의미해진다.
 *
 * ★입력은 반드시 정규화를 거친다
 *   엔진은 정부양곡 명단 컬럼명(`주소`·`포수`)에 결합돼 있다. 영문 키로 오면
 *   **예외 없이 조용히** 아파트를 못 알아보고 물량이 1로 계산된다(실측).
 *   그래서 모든 진입점이 `toEngineRecords` 를 먼저 통과시킨다. 이게 코어 API 의 계약이다.
 *
 * ★추천이지 확정이 아니다
 *   설계서 routing.mode = `recommend_then_confirm`. 순번은 사람이 확정한다.
 *   응답에 `mode: 'recommend'` 를 실어 소비자가 이를 UI 에 드러내게 한다.
 */
import {
  buildSequenceUnits, haversine, improvedSequence, measureSequence,
} from './routeSequenceEngine.js';
import { splitByDay, splitBySequence, summarizeDaySplit } from './deliveryDaySplit.js';
import { describeNormalization, toEngineRecords } from './recordSchema.js';

/** 좌표가 있는 건만 순번 대상이다. 없는 건은 버리지 않고 뒤에 붙여 돌려준다. */
const partitionByCoord = (records) => {
  const withCoord = [];
  const withoutCoord = [];
  for (const r of records) {
    if (Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))) withCoord.push(r);
    else withoutCoord.push(r);
  }
  return { withCoord, withoutCoord };
};

const toDepot = (depot) => {
  if (!depot) return null;
  const lat = Number(depot.lat ?? depot.latitude ?? depot['위도']);
  const lng = Number(depot.lng ?? depot.longitude ?? depot['경도']);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

/**
 * 배송 순번 추천.
 *
 * @param {object} input
 *   - records: 배송건 목록(스키마 자유 — 정규화가 흡수한다)
 *   - depot: 출발지 {lat,lng} (없으면 첫 지점에서 시작)
 * @returns {{mode, count, sequenced, unsequenced, measure, normalization}}
 */
export function recommendSequence({ records = [], depot = null } = {}) {
  const normalized = toEngineRecords(records);
  const { withCoord, withoutCoord } = partitionByCoord(normalized);
  const start = toDepot(depot);

  const ordered = withCoord.length ? improvedSequence(withCoord, start) : [];
  const sequenced = ordered.map((rec, i) => ({ ...rec, 순번: i + 1, seq: i + 1 }));

  return {
    mode: 'recommend',            // 설계서 recommend_then_confirm — 확정은 사람이 한다
    count: sequenced.length,
    sequenced,
    // ★좌표 없는 건을 조용히 버리지 않는다. 몇 건이 왜 빠졌는지 말해준다.
    unsequenced: withoutCoord.map((rec, i) => ({ ...rec, reason: 'no_coordinate', index: i })),
    measure: sequenced.length ? measureSequence(sequenced) : null,
    normalization: describeNormalization(records),
  };
}

/**
 * 순번 단위(아파트 동·도로 구간) 조회 — 왜 그 순서인지 설명하는 근거.
 * 순번만 주면 "왜 이 집 다음에 저 집인가"를 알 수 없다.
 */
export function sequenceUnits({ records = [] } = {}) {
  const normalized = toEngineRecords(records);
  const units = buildSequenceUnits(normalized);
  return {
    count: units.length,
    units: units.map((u) => ({
      key: u.key,
      type: u.type,                 // apt(아파트 동) | road(도로 구간)
      label: u.label,
      recordCount: Array.isArray(u.records) ? u.records.length : 0,
      lat: u.lat,
      lng: u.lng,
      hasCoord: u.hasCoord,
    })),
  };
}

/**
 * 배송일 분할 추천.
 * @param {object} input - records · numDays | maxLoadPerDay · maxPerDay · depot
 */
export function recommendDaySplit({
  records = [], numDays = null, maxLoadPerDay = null, maxPerDay = null, depot = null,
} = {}) {
  const normalized = toEngineRecords(records);
  const start = toDepot(depot);

  // maxPerDay 만 주면 순번 기준 분할, 그 외에는 물량/일수 기준 분할.
  const result = (maxPerDay && !numDays && !maxLoadPerDay)
    ? splitBySequence(normalized, { maxPerDay })
    : splitByDay(normalized, { numDays, maxLoadPerDay, depot: start });

  return {
    mode: 'recommend',
    result,
    summary: summarizeDaySplit(normalized),
    normalization: describeNormalization(records),
  };
}

/** 두 지점 거리(m) — 소비자가 자체 계산으로 갈라지지 않게 코어가 제공한다. */
export function distanceMeters({ from, to }) {
  const a = toDepot(from);
  const b = toDepot(to);
  if (!a || !b) return { ok: false, reason: 'invalid_points' };
  return { ok: true, meters: haversine(a.lat, a.lng, b.lat, b.lng) };
}
