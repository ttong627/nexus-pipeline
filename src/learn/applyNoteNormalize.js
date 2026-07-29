// 특이사항(note) 정규화 재적용 — 승인된 note_normalize_dict를 정제 결과에 반영.
//   addressEngine·firestore 비의존(순수). 이름(nameTypoDict)·건물명(buildingAliasDict) 재적용과 동일 패턴.
//
// 형 규칙(안전 최우선):
//   - 완전일치 우선, 없으면 정규화 완전일치(공백·기호 무시) 폴백(D). 부분매칭 영구 금지(오적용 차단).
//   - 매핑값이 빈값/비정상이면 원본 보존(특이사항이 실수로 삭제되는 사고 방지).
//   - 특이사항 필드에만 개입 — 주소·좌표·이름에 영향 없음.
//   variantIndex 미전달 시 완전일치만(하위호환).
import { applyVariant } from './normalizeVariant.js';

export function applyNoteNormalize(note, dict, variantIndex) {
  return applyVariant(note, dict, variantIndex);
}

export default applyNoteNormalize;
