// 자가학습 측정 집계 순수함수 — learn_candidates 배열을 대시보드 지표로 요약.
//   firestore 비의존(순수). 읽기전용 관측 — 학습이 실제 쌓이는지·무엇이 학습되는지 가시화.
//
//   반환: { total, byType, byField, byRisk:{low,high}, autoCount, reviewCount }
//     autoCount  = 저위험(자동 축적) 캡처 수
//     reviewCount= 고위험(검토 필요) 캡처 수
export function summarizeCandidates(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  const byType = {};
  const byField = {};
  let low = 0, high = 0;

  for (const c of list) {
    const t = (c && c.type) || 'unknown';
    const f = (c && c.field) || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
    byField[f] = (byField[f] || 0) + 1;
    if (c && c.risk === 'high') high += 1;
    else if (c && c.risk === 'low') low += 1;
  }

  return {
    total: list.length,
    byType,
    byField,
    byRisk: { low, high },
    autoCount: low,
    reviewCount: high,
  };
}

export default summarizeCandidates;
