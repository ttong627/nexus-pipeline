// 특이사항(note) 정규화 재적용 순수함수 — 승인된 note_normalize_dict를 정제 결과에 반영.
//   addressEngine·firestore 비의존(순수). 이름(nameTypoDict)·건물명(buildingAliasDict) 재적용과 동일 패턴.
//
// 형 규칙(안전 최우선):
//   - 완전일치 치환만. 부분매칭 영구 금지(특이사항 일부만 겹쳐도 치환하지 않음 → 오적용 차단).
//   - 매핑값이 빈값/비정상이면 원본 보존(특이사항이 실수로 삭제되는 사고 방지).
//   - 특이사항 필드에만 개입 — 주소·좌표·이름에 영향 없음.
export function applyNoteNormalize(note, dict) {
  const raw = note ?? '';
  const key = String(raw).trim();
  if (!key) return '';                                  // 빈/null/undefined → 빈 문자열
  if (!dict || typeof dict !== 'object') return raw;    // 사전 없음 → 원본 그대로
  const mapped = dict[key];                             // 완전일치(전체 문자열)만 조회
  if (mapped && typeof mapped === 'string' && mapped.trim()) return mapped;
  return raw;                                           // 미일치 or 빈 매핑 → 원본 보존
}

export default applyNoteNormalize;
