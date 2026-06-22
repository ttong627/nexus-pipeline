// ══════════════════════════════════════════════════════════════════
//  공용 정렬 — CLAUDE.md §6 기본 정렬 규칙 (모든 리스트·내보내기 파일 공통)
//  순서: 행정동(읍면동) → 리(里) → 주소(도로명) → 이름
//  모두 오름차순, 한국어 numeric (숫자 자연 정렬). 리 없으면 빈값으로 자연 통과.
// ══════════════════════════════════════════════════════════════════
const cmp = (a, b) =>
  String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true, sensitivity: 'base' });

// 배송 기본 정렬 비교자 — 행정동→리→주소→이름. .sort() 콜백으로 재사용(중복 제거 일원화)
export const deliveryCompare = (a, b) =>
  cmp(a?.행정동, b?.행정동)
  || cmp(a?.리, b?.리)
  || cmp(a?.주소, b?.주소)
  || cmp(a?.이름, b?.이름);

// 배송 기본 정렬: 원본 배열을 변형하지 않고 정렬된 새 배열 반환 (불변)
export function sortByDeliveryOrder(records) {
  return [...(records || [])].sort(deliveryCompare);
}
