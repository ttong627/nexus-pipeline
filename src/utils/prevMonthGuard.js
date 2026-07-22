// ══════════════════════════════════════════════════════════════════════════
//  M-10 전월 대비 주소 대량변동 게이트 — 판정 로직 (순수함수)
//
//  형 지시(2026-07-22): "정제할 때 이전달과 주소가 많은 변동이 생기면
//                        이건 명단이 잘못된 것임을 담당자한테 확인시켜야 해"
//
//  행정동별 경고(30%↑·20건↑)는 특정 동에 몰린 경우만 잡는다. 명단 전체가
//  통째로 틀어진 경우(다른 달 파일·다른 지자체·주소 칼럼 밀림)는 동마다
//  30% 미만이라 안 걸리고 그대로 저장돼 버린다 → 전체 비율로 한 번 더 막는다.
// ══════════════════════════════════════════════════════════════════════════

/** 표본이 너무 적으면 비율이 요동친다 — 이 인원 미만이면 판정하지 않는다 */
export const MIN_COMPARED = 30;
/** 전월과 대조된 인원 중 이 비율 이상이 이사 → 명단 오류 의심 */
export const RATE_THRESHOLD = 0.15;
/** 비율이 낮아도 절대 건수가 이만큼이면 확인시킨다 */
export const COUNT_THRESHOLD = 100;

/**
 * 전월 대비 주소 변동이 '담당자 확인이 필요한 수준'인지 판정한다.
 *
 * @param {object} p
 * @param {number} p.comparedCount 전월과 동일인으로 대조된 인원 수
 * @param {number} p.addrChangeCount 그중 주소가 실제로 바뀐 인원 수
 * @returns {{rate:number, critical:boolean, reason:string}}
 */
export function evaluateAddrChange({ comparedCount = 0, addrChangeCount = 0 } = {}) {
  const compared = Math.max(0, Number(comparedCount) || 0);
  const changed = Math.max(0, Number(addrChangeCount) || 0);
  const rate = compared > 0 ? changed / compared : 0;

  if (compared < MIN_COMPARED) return { rate, critical: false, reason: '표본 부족' };
  if (rate >= RATE_THRESHOLD) return { rate, critical: true, reason: `변동률 ${Math.round(rate * 100)}%` };
  if (changed >= COUNT_THRESHOLD) return { rate, critical: true, reason: `변동 ${changed}건` };
  return { rate, critical: false, reason: '정상 범위' };
}
