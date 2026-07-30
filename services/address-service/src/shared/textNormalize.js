// 주소 텍스트 규격화 — 클라·서버 공용 SSOT (P7 Phase2 선행: 규격화 서버 이관 발판)
//
// 배경: 규칙 A-3·A-4·A-6·A-15·A-16·A-21은 **외부 의존이 없는 순수 문자열 변형**이다.
//   그동안 이 로직은 클라 `src/engine/addressEngine.js` 안에 인라인으로만 있었고,
//   서버가 규격화를 하려면 같은 정규식을 복제할 수밖에 없었다(→ 도로명 토큰처럼 갈라질 위험).
//   Phase1(roadTokens SSOT)과 같은 방향으로 순수 규격화를 여기 모아 양쪽이 import 한다.
//
// ★불변 보증: 클라 출력이 그대로 유지되는지는 `scripts/address-golden.test.mjs`(offline)가 매번 검증.
// ★Docker: 서버 이미지 빌드 컨텍스트가 `services/address-service/`라 shared는 반드시 이 경로에 둔다.
//
// 순수하지 않아 여기 들어오지 않는 것(의도적 제외):
//   A-9 특수문자 분리(학습 사전 `special_chars` + firestore write 의존)
//   A-5 지역 접두어 제거(CENTER_RE·REGION_TOKEN_RE 등 다수 상태 의존)
//   A-2 오타 사전(firestore `typo_dict` 의존)

/** 앞쪽 구분자 잡음 제거(콤마·세미콜론·가운뎃점·슬래시 등). 순수. */
export const stripLeadingAddressJunk = (value) =>
  String(value || '').replace(/^[\s,;:：；ㆍ·/\\|]+/g, '').trimStart();

/** A-21: 구식 명칭(동/읍/면사무소) → '주민센터' 정규화. 주소·특이사항 양쪽에 쓴다. 순수. */
export const normalizeCenterName = (value) =>
  String(value || '').replace(/동사무소|읍사무소|면사무소/g, '주민센터');

/**
 * 주소 문자열 프리앰블 규격화(A-3·A-4·A-6·A-15·A-16·A-21) — 순수.
 * 입력은 오타 사전(A-2)이 이미 적용된 텍스트를 기대한다. 외부 호출·상태 접근 없음.
 * ※ 클라 원본(addressEngine.js processAddress)의 단계·정규식을 그대로 옮긴 것.
 *   순서를 바꾸거나 정규식을 '정리'하지 말 것 — offline 골든이 불변을 강제한다.
 * ※ 안 보이는 whitespace(전각공백·NBSP·zero-width)는 유니코드 이스케이프로 표기한다.
 *   리터럴로 두면 no-irregular-whitespace(services 경로 기본 error)에 걸린다. 정규식 의미는 동일.
 */
export const normalizeAddressPreamble = (input) => {
  let text = String(input || '');

  // ── A-3: 유니코드 정규화 ──────────────────────────────────────────
  text = text
    .normalize('NFC')
    .replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '')   // Zero-width / Soft-hyphen 제거
    .replace(/[\u3000\xA0\t\n\r\f\v]/g, ' ')            // 전각공백·NBSP·제어문자 → 공백
    .replace(/["\u201C\u201D'\u2018\u2019\uFF02\uFF07]/g, '')  // 따옴표 전각·반각 제거
    .replace(/\s{2,}/g, ' ')                            // 연속 공백 → 단일
    .trim();
  text = stripLeadingAddressJunk(text);

  // ── A-4: 미닫힌 괄호 제거 ─────────────────────────────────────────
  text = text.replace(/\([^)]*$/, '').trim();

  // ── A-6: 통·반 제거 ───────────────────────────────────────────────
  text = text.replace(/\s*제?\d{1,2}통\s*제?\d{1,2}반\s*/g, ' ').trim();

  // ── A-15: 도로명 번호 뒤 "." → "," ───────────────────────────────
  text = text.replace(/(\d)\.\s+(?=\S)/g, '$1, ');
  text = text.replace(/[,\s]+$/, '').replace(/,(?=\S)/g, ', ');
  text = stripLeadingAddressJunk(text);

  // ── A-16: 번지 표기 제거 ──────────────────────────────────────────
  text = text.replace(/(\d+)\s*번지/g, '$1');

  // ── A-21: 동/읍/면사무소 → 주민센터 ───────────────────────────────
  text = normalizeCenterName(text);

  return text;
};
