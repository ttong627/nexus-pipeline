// 학습 후보 문서 빌더 — classifyCorrection 결과 + 메타 → learn_candidates 문서(순수).
// firestore 비의존. 저위험=status 'auto', 고위험=status 'pending'.
// ruleKey 있으면 dedupById=true(같은 규칙은 한 문서에 count 누적), 없으면 매건 신규.

export function buildCandidate(cls, meta = {}) {
  if (!cls || cls.risk === 'none' || cls.risk === 'reject') return null;

  const ctx = meta.context || {};
  return {
    field: meta.field ?? '',
    before: meta.before ?? '',
    after: meta.after ?? '',
    type: cls.type,
    risk: cls.risk,
    ruleKey: cls.ruleKey ?? null,
    payload: cls.payload ?? null,
    reason: cls.reason ?? '',
    status: cls.risk === 'low' ? 'auto' : 'pending',
    city: ctx.cityLabel || ctx.city || '',
    month: ctx.month || '',
    uid: meta.uid || '',
    dedupById: !!cls.ruleKey,
  };
}

export default buildCandidate;
