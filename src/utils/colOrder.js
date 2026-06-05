// ── 명단 칼럼 순서·표시 통일 유틸 ────────────────────────────────────────────
// exportColOrder(엑셀/정제결과 칼럼 설정, localStorage `nexus_export_cols_v2`)를
// 단일 소스로 두고, 키 네임스페이스가 다른 다른 명단 뷰의 필드 배열을
// 그 순서·표시(on)에 맞춰 투영한다.

// 뷰마다 키 이름이 달라 마스터(exportColOrder, 한글 키) 기준으로 정규화한다.
// 예) 기본명단(BaseListManager)은 영문 키(name·dong…), 오류목록은 `_사유`를 쓴다.
export const EXPORT_KEY_ALIAS = {
  name: '이름',
  birthKey: '생년월일',
  dong: '행정동',
  mobile: '휴대폰',
  landline: '유선전화',
  note: '특이사항',
  _사유: '사유',
};

// 뷰 필드 키 → 마스터(exportColOrder) 기준 정규 키
const canonKey = (key) => EXPORT_KEY_ALIAS[key] || key;

/**
 * 뷰 고유 필드 배열을 exportColOrder 순서·표시(on)에 맞춰 재정렬·필터한다.
 * - 불변: 원본 배열을 변형하지 않고 새 배열을 반환한다.
 * - on === false 인 칼럼은 제외(숨김).
 * - exportColOrder 에 없는 뷰 고유 필드는 원래 상대 순서로 뒤에 append(항상 표시).
 * - exportColOrder 가 비었거나 배열이 아니면 원본을 그대로 반환(안전 fallback).
 *
 * @param {Array<{key:string,label?:string}>} viewFields 뷰 고유 필드 배열
 * @param {Array<{key:string,on?:boolean}>} exportColOrder 마스터 칼럼 설정
 * @returns {Array} 재정렬·필터된 새 필드 배열
 */
export function orderFieldsByExport(viewFields, exportColOrder) {
  if (!Array.isArray(viewFields)) return [];
  if (!Array.isArray(exportColOrder) || exportColOrder.length === 0) return [...viewFields];

  const orderIdx = new Map();
  const onMap = new Map();
  exportColOrder.forEach((c, i) => {
    orderIdx.set(c.key, i);
    onMap.set(c.key, c.on !== false);
  });

  const inExport = [];
  const rest = [];
  for (const f of viewFields) {
    const k = canonKey(f.key);
    if (orderIdx.has(k)) {
      if (onMap.get(k)) inExport.push(f); // on=false 면 숨김
    } else {
      rest.push(f); // 마스터에 없는 뷰 고유 필드는 항상 표시
    }
  }

  inExport.sort((a, b) => orderIdx.get(canonKey(a.key)) - orderIdx.get(canonKey(b.key)));
  return [...inExport, ...rest];
}
