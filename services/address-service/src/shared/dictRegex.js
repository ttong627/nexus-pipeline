// ══════════════════════════════════════════════════════════════════
//  학습사전 → 정규식 조립 (클라·서버 공용 SSOT)
//
//  purifyCore는 사전을 `deps.dicts.typoRegex` / `deps.dicts.specialCharRegex` 형태의
//  **완성된 정규식**으로 받는다. 그 정규식을 만드는 규칙이 클라와 서버에 각각 복제되면
//  A-2(오타 보정)·A-9(특수문자 분리)가 조용히 갈라진다 — 같은 명단을 클라에서 정제할 때와
//  서버에서 정제할 때 결과가 달라지고, 원인은 화면에 안 보인다.
//  → 조립 규칙을 여기 한 곳에 둔다.
// ══════════════════════════════════════════════════════════════════

// A-9: 특수문자 구분자 기본값. Firestore `special_chars`에 학습분이 쌓이면 여기에 합집합으로 얹는다.
export const DEFAULT_SPECIAL_CHARS = ['**', '/', '☆', '★', '*', '｜', '|', '~', '#', '§', '※', '=>', '->'];

const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A-2: 학습 오타 사전 → 치환용 전역 정규식.
 * 사전이 비면 null (호출부가 `if (typoRegex)`로 건너뛴다).
 */
export const buildTypoRegex = (typoDict) => {
  const keys = Object.keys(typoDict || {});
  if (!keys.length) return null;
  return new RegExp(keys.map(escapeRe).join('|'), 'g');
};

/**
 * A-9: 특수문자 구분자 → "구분자 + 이후 전체" 캡처 정규식.
 * ★길이 내림차순 정렬이 규칙의 일부다 — '**'가 '*'보다 먼저 잡혀야 한다.
 *
 * ★★빈 목록이면 **null**을 돌려준다(정규식을 만들지 않는다).
 *   빈 목록으로 조립하면 `()(.*)` 가 되는데, 이건 **모든 문자열의 0번 위치에서 매칭**된다.
 *   A-9 2차(상세주소) 단계에는 위치 가드가 없어서 상세주소가 통째로 특이사항으로 옮겨지고
 *   `201호`가 전부 사라진다(2026-08-01 서버 파리티 테스트가 35케이스 중 28건에서 검출).
 *   호출부는 모두 `if (specialCharRegex)`로 감싸므로 null이면 A-9를 건너뛴다 = 안전.
 */
export const buildSpecialCharRegex = (specialChars) => {
  const sorted = [...(specialChars || [])].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!sorted.length) return null;
  return new RegExp(`(${sorted.map(escapeRe).join('|')})(.*)`);
};
