/**
 * 배송완료 위치 검증 (희망나르미 REQ-027 반영).
 *
 * ★목적 = **배송지에 가지 않고 완료를 누르는 것**을 잡는 것.
 *   명단정제는 완료 시 GPS 오차(errM)를 기록만 하고 판정이 없었다(관리자가 눈으로 보는 용도).
 *   판정 규칙을 여기서 처음 정의한다 — 그래서 이 파일은 '승격'이 아니라 '신설'이다.
 *
 * ★★설계 원칙 — 시끄러운 경고를 만들지 않는다(모듈 ⑧ 교훈).
 *   좌표가 없거나 GPS 가 부정확한 상황을 '위반'이라 하면 경고가 쏟아지고, 쏟아지는 경고는
 *   곧 전부 무시된다. "위반 0" 과 "검증 0" 은 완전히 다른 말이므로 `checked` 로 구분한다.
 *
 * ★코어는 **판정만** 한다. 완료를 막을지(차단)는 호출자(운영 정책)가 정한다.
 *   기사가 배송을 못 하게 막는 것이 오배송보다 더 큰 사고일 수 있기 때문이다.
 */
import { KR } from '../routing/navigation.js';
import { haversine } from '../routing/routeSequenceEngine.js';

/**
 * 기본 임계 거리(m).
 * 근거: 코어가 주는 좌표는 국가 출입구(측량) 기준이라 오차가 작다. 단지가 큰 아파트와
 * 도심 GPS 반사를 감안해 150m 로 둔다.
 * ⚠️ 동(洞) 중심 좌표처럼 대표점을 쓰는 호출자는 반드시 크게 올려 잡아야 한다
 *    — 그러지 않으면 정상 배송이 전부 'far' 로 뜬다.
 */
export const DEFAULT_THRESHOLD_M = 150;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const inKorea = (lat, lng) =>
  lat >= KR.latMin && lat <= KR.latMax && lng >= KR.lngMin && lng <= KR.lngMax;

const unverifiable = (reason, distanceM, thresholdM) => ({
  checked: false,
  verdict: 'unverifiable',
  distanceM,
  thresholdM,
  reason,
});

/**
 * 완료 위치가 배송지와 얼마나 떨어졌는지 판정한다.
 *
 * @returns {{checked:boolean, verdict:'ok'|'far'|'unverifiable',
 *            distanceM:number|null, thresholdM:number, reason:string|null}}
 */
export function verifyDeliveryPosition({
  siteLat, siteLng, actualLat, actualLng, accuracyM, thresholdM,
} = {}) {
  const limit = num(thresholdM) ?? DEFAULT_THRESHOLD_M;

  const sLat = num(siteLat);
  const sLng = num(siteLng);
  if (sLat === null || sLng === null) return unverifiable('no_site_coord', null, limit);

  const aLat = num(actualLat);
  const aLng = num(actualLng);
  if (aLat === null || aLng === null) return unverifiable('no_actual_coord', null, limit);

  // 위경도 뒤바뀜·기기 오류가 '먼 거리'보다 훨씬 유력하다 — 위반이라 부르지 않는다.
  if (!inKorea(sLat, sLng) || !inKorea(aLat, aLng)) {
    return unverifiable('out_of_korea', null, limit);
  }

  // ⚠️코어의 haversine 은 **미터**를 반환한다(R=6371000).
  //   명단정제의 haversineKm(coordValidator.js)은 km 라 이름이 비슷해도 계약이 다르다.
  //   처음에 km 로 착각해 1000 을 곱했고, 34m 거리가 34km 로 계산돼 테스트가 잡았다.
  const distanceM = Math.round(haversine(sLat, sLng, aLat, aLng));

  // ★오차 반경이 임계보다 크면 '멀다'고 말할 수 없다(실내·지하·터널).
  //   거리는 참고용으로 그대로 실어 보낸다 — 숨기면 원인을 못 찾는다.
  const acc = num(accuracyM);
  if (acc !== null && acc > limit) {
    return { ...unverifiable('gps_accuracy_too_low', distanceM, limit) };
  }

  return {
    checked: true,
    verdict: distanceM <= limit ? 'ok' : 'far',
    distanceM,
    thresholdM: limit,
    reason: null,
  };
}
