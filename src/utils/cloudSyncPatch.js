// 지도 저장이 이번달 명단에 쓰는 값 (SSOT) — 2026-08-28
//
//   왜: 지도 [저장·확정]이 명단 레코드를 이렇게 갱신했다.
//       const patch = { 기사: driverName, 배송순번: r.배송순번 ? String(r.배송순번) : '' };
//   순번을 매기지 않은 채 저장하면 `배송순번: ''` 가 **기존 순번을 전부 지웠다**(G-4 위반).
//   실측 2026-08-28: 동대문구 2026-08 세 개 동 1,530건의 배송순번이 전부 비어 있었다.
//
//   규칙
//   ① 기사: 지도 화면이 주인이다 — 해제(빈값)도 반영한다. 다만 **배정을 한 건도 안 한 저장**이면
//      기사 필드를 아예 쓰지 않는다(작업하지 않은 것을 지우지 않는다).
//   ② 배송순번: **순번을 한 건도 안 매긴 저장이면 순번 필드를 쓰지 않는다.**
//      하나라도 매겼다면 그 상태를 그대로 반영한다(중간에 뺀 것도 반영해야 하므로).
//   ③ 좌표·아파트 표시는 값이 있을 때만 쓴다(원래 그랬다).

/**
 * 이번 저장이 어떤 필드를 다룰 자격이 있는지 판단한다.
 * @param {Array} recs 저장 대상 레코드
 * @returns {{writeDriver: boolean, writeSeq: boolean}}
 */
export function decideSyncFields(recs = []) {
  const list = Array.isArray(recs) ? recs : [];
  const writeDriver = list.some((r) => r && r._driverId);
  const writeSeq = list.some((r) => r && String(r.배송순번 ?? '').trim() !== '');
  return { writeDriver, writeSeq };
}

/**
 * 레코드 하나에 쓸 patch 를 만든다. 쓸 것이 없으면 null(= 건너뛴다).
 * @param {object} rec 레코드(_driverId·배송순번·_lat/_lng·_isApt)
 * @param {string} driverName 배정된 기사 이름(없으면 '')
 * @param {{writeDriver: boolean, writeSeq: boolean}} fields decideSyncFields 결과
 */
export function buildRecordPatch(rec, driverName, fields) {
  const r = rec || {};
  const { writeDriver = false, writeSeq = false } = fields || {};
  const patch = {};
  if (writeDriver) patch.기사 = driverName || '';
  if (writeSeq) patch.배송순번 = String(r.배송순번 ?? '').trim();
  if (r._lat !== undefined && r._lat !== null) { patch.lat = r._lat; patch.lng = r._lng; }
  if (r._isApt !== undefined) patch.isApt = r._isApt;
  return Object.keys(patch).length ? patch : null;
}
