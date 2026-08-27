// 배정 저장이 **건드릴 동**을 정한다 (SSOT) — 2026-08-27 점검
//
//   왜: 예전엔 저장할 때마다 **스코프 전체 레코드**의 기사 칸을 덮어썼다.
//   동 카드마다 [저장]을 누르는 흐름에서는 답십리1동만 배정하고 저장하면
//   전농1동·휘경1동 레코드의 기사 칸이 **빈값으로 지워졌다**(G-4·M-1 위반).
//   또 저장 1회에 1,530 writes 가 나갔다.
//
//   규칙: ①지금 배정된 동 ②직전 저장에는 있었는데 지금 풀린 동(지워야 하는 동) — 이 둘만 쓴다.
//        그 밖의 동은 **손대지 않는다**. 판단이 애매하면 건드리지 않는 쪽이 안전하다.

/**
 * @param {Record<string,string[]>} currentMap 지금 화면의 동별 배정
 * @param {Record<string,string[]>|null} savedMap 직전 저장 시점의 동별 배정 (모르면 null)
 * @returns {Set<string>} 이번 저장에서 레코드를 갱신할 동
 */
export function assignmentWriteDongs(currentMap = {}, savedMap = null) {
  const targets = new Set();
  Object.entries(currentMap || {}).forEach(([dong, ids]) => {
    if (dong && Array.isArray(ids) && ids.length > 0) targets.add(dong);
  });
  // 직전 저장에는 배정이 있었는데 지금은 없다 → 그 동의 기사 칸을 비워야 한다
  Object.entries(savedMap || {}).forEach(([dong, ids]) => {
    if (dong && Array.isArray(ids) && ids.length > 0) targets.add(dong);
  });
  return targets;
}
