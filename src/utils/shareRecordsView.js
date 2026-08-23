// ══════════════════════════════════════════════════════════════════
//  기사 화면의 배송건 파생 — 정렬·순번배지·지도대상 (순수 로직)
//  회귀: scripts/share-records-view.test.mjs
//
//  ★왜 떼어냈나 (2026-08-13 · 계획 Phase 1 읽기측 이관)
//    `ShareRouteView` 는 지금 `shareData.records` **배열**을 읽는다.
//    Phase 1 에서 그 배열을 서브컬렉션으로 옮기는데, 완료버튼·GPS·순번이 전부
//    이 파생값에 걸려 있어 **하나만 어긋나도 현장 기능이 죽는다.**
//    그래서 출처를 바꾸기 **전에** 계산을 여기로 옮겨 회귀로 못 박는다.
//    (이관 후에도 이 함수는 그대로다 — 바뀌는 건 `records` 를 어디서 얻느냐뿐이다.)
//
//  ⚠️여기 규칙을 바꾸면 기사 화면의 순번·동선이 바뀐다. 표시 정렬과 동선 정보는 **다르다**.
// ══════════════════════════════════════════════════════════════════

/** 한 건의 안정 식별자. id 가 없던 옛 문서도 화면이 죽지 않게 이름+순번으로 만든다. */
export const recordUid = (r, i) => String(r?.id || `_idx${i}`);   // ★이름을 키로 쓰지 않는다 — 부모 문서 키(completions.{uid})에 수령자 이름이 박힌다(2026-08-23 점검)

/**
 * 기사 화면이 쓰는 파생값 일습.
 *
 * @param {Array}  records   그 기사의 배송건(이미 기사별로 걸러진 것도, 전체도 받는다)
 * @param {object} opts
 * @param {string} [opts.driverId]  주면 `driverId` 로 한 번 더 거른다(옛 배열 구조 호환)
 * @param {Array}  [opts.orderIds]  배송순번 발행 결과(담당자 발행 또는 기사 편집)
 * @returns {{all:Array, map:Array, hasOrder:boolean}}
 */
export function deriveDriverRecords(records = [], { driverId = '', orderIds = [] } = {}) {
  const src = Array.isArray(records) ? records : [];
  const base = (driverId ? src.filter((r) => r && r.driverId === driverId) : src.filter(Boolean))
    .map((r, i) => ({ ...r, _uid: recordUid(r, i) }));

  const ids = Array.isArray(orderIds) ? orderIds : [];
  const orderIndex = new Map(ids.map((id, i) => [id, i]));

  // ★순번 '발행 여부'. 미발행이면 번호 배지도 이동선도 표시하지 않는다 —
  //   없는 순번을 1,2,3 으로 보여주면 기사가 그 순서로 돈다.
  const hasOrder = ids.length > 0 || base.some((r) => parseInt(r.배송순번, 10) > 0);

  const all = base
    .slice()
    .sort((a, b) => {
      const ai = orderIndex.has(a._uid) ? orderIndex.get(a._uid) : 100000 + (parseInt(a.배송순번, 10) || 9999);
      const bi = orderIndex.has(b._uid) ? orderIndex.get(b._uid) : 100000 + (parseInt(b.배송순번, 10) || 9999);
      return ai - bi;
    })
    .map((r, i) => ({ ...r, _displaySeq: hasOrder ? i + 1 : null }));

  // 좌표 없는 건은 지도에 못 올린다(목록에는 남는다 — 빼면 그 집이 사라진다).
  const map = all.filter((r) => r.lat && r.lng);
  return { all, map, hasOrder };
}

/** 총 포수 — 포수가 비면 1로 본다(0으로 세면 물량이 줄어 보인다). */
export const totalQtyOf = (records = []) =>
  (Array.isArray(records) ? records : []).reduce((s, r) => s + (parseInt(r?.포수, 10) || 1), 0);
