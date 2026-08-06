/**
 * 이상좌표 격리 판정 — 순수 함수, 외부 의존은 거리계산(tmProjection)뿐.
 *
 * ★왜 필요한가 (실측 2026-08-01)
 *   국가 원본 좌표에 **실제로 오류가 있다**. 울산 중구 종가20길·병영성11길, 부산 서구
 *   초장로18번길, 경북 상주 성동로 … 변환하면 경도 130~131도대(동해 한복판)로 떨어진다.
 *   그대로 적재하면 배송지가 200km 밖에 찍힌다. "국가 정본이니까 맞겠지"가 가장 위험한 가정이다.
 *
 * ★왜 시도 경계박스로 하지 않는가
 *   1차 스캔에서 시도 박스를 썼더니 **정상 좌표를 무더기로 오탐**했다(경주 35.6·군위군
 *   대구편입 36.2·백령도 124.7·추자도 33.94 …). 행정구역 박스를 손으로 적는 순간
 *   도서·편입지역을 빠뜨리고, 그걸 맞추려 넉넉히 넓히면 진짜 사고를 놓친다.
 *   전국 실측 결과 시도박스 방식은 2,174건을 이탈로 보고했는데, 그 대부분이 멀쩡한 섬이었다.
 *
 * ★대신 쓰는 기준: **자기 도로의 중앙값에서 얼마나 떨어졌는가**
 *   같은 도로명코드를 가진 점들은 서로 붙어 있다. 섬이든 오지든 마찬가지다
 *   (가거도길은 가거도끼리, 백령도 두무진로는 백령도끼리 모인다). 그래서 도로 단위로 보면
 *   지리를 하드코딩하지 않고도 이상치가 드러난다. 자료가 스스로 기준을 만든다.
 *
 *   전국 6,407,110 좌표행 실측 분포(도로 중앙값 이격):
 *     정상 최대 45.9km (태안군 근흥면 가의도길 — 실재하는 섬)
 *     ─────── 여기가 빈 구간 ───────
 *     오류 최소 172.8km ~ 최대 188.6km (36건, 전부 바다 위)
 *   임계 50km/80km/100km 어디를 잡아도 결과가 **똑같이 36건**이다. 정상 꼬리와 오류가
 *   3배 이상 벌어져 있어서다. 그 한가운데인 **100km**를 쓴다. 45.9km 를 아슬아슬하게
 *   넘기는 임계(50km)를 고르면, 다음 달 자료에 60km 짜리 긴 도로가 하나 생기는 순간
 *   멀쩡한 주소가 격리된다.
 */
import { distanceM } from '../shared/tmProjection.js';

/** 격리 임계(m). 위 실측의 빈 구간 한가운데. */
export const QUARANTINE_DISTANCE_M = 100000;

/** 도로 기준점으로 인정할 최소 표본. 2점만 있어도 180km 이탈은 판별된다. */
export const MIN_POINTS_ROAD = 2;

/**
 * 읍면동 폴백 기준점의 최소 표본. 도로에 점이 하나뿐일 때(전국 3,235건 · 0.05%)만 쓴다.
 * 표본이 적으면 중앙값 자체가 이상치에 끌려가므로 30건을 하한으로 둔다.
 */
export const MIN_POINTS_EMD = 30;

export const COORD_OK = 'ok';
export const COORD_NONE = 'none';
export const COORD_QUARANTINED = 'quarantined';
export const COORD_UNVERIFIED = 'unverified';

const median = (sorted) => {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

/**
 * 그룹별 좌표를 모아 중앙값 기준점을 내주는 인덱스.
 *
 * 평균이 아니라 **중앙값**을 쓴다. 오류 좌표가 200km 밖에 있으면 평균은 통째로 끌려가
 * 기준점이 바다로 이동하고, 그러면 정상 좌표가 이상치로 뒤집힌다. 중앙값은 소수의
 * 극단값에 흔들리지 않는다(이 자료의 오류율은 0.0006%다).
 */
export function createClusterIndex() {
  const groups = new Map();
  const cache = new Map();

  return {
    add(key, lat, lng) {
      if (!key || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      let g = groups.get(key);
      if (!g) { g = { lat: [], lng: [] }; groups.set(key, g); }
      g.lat.push(lat);
      g.lng.push(lng);
    },

    /** @returns {{lat:number, lng:number, count:number}|null} 표본 미달이면 null */
    center(key, minPoints = 1) {
      if (!key) return null;
      const g = groups.get(key);
      if (!g || g.lat.length < minPoints) return null;
      let c = cache.get(key);
      if (!c) {
        c = {
          lat: median([...g.lat].sort((a, b) => a - b)),
          lng: median([...g.lng].sort((a, b) => a - b)),
          count: g.lat.length,
        };
        cache.set(key, c);
      }
      return c;
    },

    get size() { return groups.size; },
  };
}

/**
 * 좌표 한 점을 판정한다.
 *
 * @param {{lat:number, lng:number}|null} point 변환된 WGS84. null = 원본 무좌표.
 * @param {Array<{kind:string, center:{lat:number,lng:number,count:number}|null}>} refs
 *        우선순위 순서의 기준점 후보. 첫 번째로 center 가 있는 것을 쓴다.
 * @param {number} limitM 격리 임계
 * @returns {{status:string, reason:string|null, distanceM:number|null,
 *            refKind:string|null, refLat:number|null, refLng:number|null, refCount:number|null}}
 */
export function judgeCoord(point, refs = [], limitM = QUARANTINE_DISTANCE_M) {
  const none = {
    status: COORD_NONE, reason: null, distanceM: null,
    refKind: null, refLat: null, refLng: null, refCount: null,
  };
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return none;

  const ref = refs.find((r) => r && r.center);
  if (!ref) {
    // 대조군이 없다. **모르는 것을 안다고 하지 않는다** — 통과도 격리도 아닌 보류로 남긴다.
    return { ...none, status: COORD_UNVERIFIED, reason: 'no_reference' };
  }

  const d = distanceM(point.lat, point.lng, ref.center.lat, ref.center.lng);
  return {
    status: d > limitM ? COORD_QUARANTINED : COORD_OK,
    reason: d > limitM ? `far_from_${ref.kind}` : null,
    distanceM: d,
    refKind: ref.kind,
    refLat: ref.center.lat,
    refLng: ref.center.lng,
    refCount: ref.center.count,
  };
}

/** 출입구 레코드에서 대조군 키를 뽑는다(도로 → 읍면동 순). */
export function referenceKeys(rec) {
  const dong = String(rec.legalDongCode || '');
  return {
    road: rec.roadCode || null,
    emd: dong.length >= 8 ? dong.slice(0, 8) : null,
  };
}
