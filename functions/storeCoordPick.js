// ══════════════════════════════════════════════════════════════════
//  좌표 저장소에서 **명단 lat/lng 로 쓸 좌표를 고르는 규칙** — 단일 출처(SSOT)
//  회귀: scripts/store-coord-pick.test.mjs
//
//  ★왜 파일로 뽑아냈나 (2026-08-12 · C-5 재발 방지)
//    같은 규칙이 네 군데 있었고 그중 **두 벌이 죽은 코드**였다.
//    죽은 쪽을 고친 사람은 고쳤다고 믿지만 운영은 그대로였다 —
//    에러가 안 나서 몇 달을 못 알아챈다. 지운 것:
//      · services/address-service/src/coords/coordStore.js `pickDeliveryCoord` (호출부 0)
//      · src/utils/coordStoreApi.js `pickStoreCoord` — ⚠️**아직 지우지 않았다**(2026-08-23 점검에서 확인).
//        파일은 남아 있고 규칙도 이곳과 다르다(purpose 분기). 호출부가 죽은 함수뿐이라 동작에는 영향이 없지만,
//        '지웠다'고 적어 두면 고쳐도 안 바뀌는 함정이 된다 — 실제로 지울 때 이 줄도 함께 지울 것.
//    이제 이 규칙은 **여기 한 곳**뿐이고, 부르는 곳은 `index.js` `storeCoordsFor`
//    (Cloud Function `geocodeAuto`, 3분마다) 하나다.
//
//  ★내비 목적지 규칙은 여기가 아니다 — 목적이 다르면 규칙도 다르다(설계서 F2).
//    내비는 **동 좌표를 쓰지 않는다**(동 앞은 차가 못 들어간다).
//      → services/address-service/src/delivery/deliveryBrief.js `pickCoordinate`
//    반면 명단 lat/lng 는 지도 표시·순번에 쓰이므로 **단지 안에서는 동 좌표가 맞다**
//    (실측 2026-07-24: 은마아파트 동간 약 280m — 단지를 한 점으로 보면 내부 동선이 사라진다).
// ══════════════════════════════════════════════════════════════════

/**
 * 좌표를 못 믿는 품질 — **좌표값이 있어도 없는 것으로 친다.**
 *
 *  outlier   : 이상치. 지우지 않고 표시만 한다(DS-15). 이상 좌표 하나가 기사 구역을
 *              430km 로 부풀린 실측이 있다. 값이 있다고 쓰면 그 사고가 그대로 난다.
 *  none      : 조회했는데 좌표가 없더라(= "아직 안 해봤다"와 구분되는 상태).
 *  no_anchor : 주소를 특정 못 했다. 좌표 문제가 아니라 **주소 문제**다(A-36).
 *  unknown   : 저장소에 행 자체가 없다.
 */
const STORE_BAD_QUALITY = new Set(['outlier', 'none', 'no_anchor', 'unknown']);

/**
 * 명단 좌표로 쓸 점을 고른다 — **동 → 입구 → 중심**.
 *
 * @param {object|null} entry `/v1/coords/resolve` 가 내주는 한 건
 *        (`coordResolveEntry`: {entrance, center, dong, quality, ...})
 *        ★`dong` 은 서버가 이미 `matched==='dong'` 인 것만 걸러 단수로 내준다
 *          (`pickTrustedDong`). 여기서 다시 거르지 않는 이유다.
 * @returns {{lat:number, lng:number}|null} 못 고르면 null — **아무거나 만들어내지 않는다.**
 */
function pickStoreCoord(entry) {
  if (!entry || STORE_BAD_QUALITY.has(entry.quality)) return null;
  const p = entry.dong || entry.entrance || entry.center;
  if (!p || p.lat == null || p.lng == null) return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  // 숫자가 아닌 값이 들어오면 지도에 NaN 핀이 꽂힌다 — 화면에선 "좌표 있음"으로 보인다.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

module.exports = { STORE_BAD_QUALITY, pickStoreCoord };
