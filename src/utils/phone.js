// ══════════════════════════════════════════════════════════════════
//  휴대폰 번호 정규화 — **E.164**(`+8210…`)로 통일
//  회귀: scripts/phone.test.mjs
//
//  ★왜 이게 설계 전체의 열쇠인가 (2026-08-13 · 배송지도 접근통제)
//    기사 인증은 Firebase Phone Auth 가 준 `token.phone_number`(항상 E.164)와
//    우리가 저장한 번호를 **문자 그대로 비교**해서 통과시킨다.
//    표기가 하나라도 흔들리면(`010-1234-5678` vs `+821012345678`) **영영 안 맞는다** —
//    에러도 안 나고, 그냥 그 기사가 자기 배송을 못 본다. 현장에서 배송이 선다.
//    그래서 저장·비교 양쪽 모두 반드시 이 함수를 통과시킨다.
//
//  ⚠️판단할 수 없는 값은 **지어내지 않고 빈 문자열**을 돌려준다.
//    억지로 `+82` 를 붙이면 **다른 사람 번호**가 될 수 있다.
// ══════════════════════════════════════════════════════════════════

/** 숫자만 남긴다(선행 + 는 따로 본다). */
const digits = (v) => String(v ?? '').replace(/[^\d]/g, '');

/**
 * 한국 휴대폰 번호 → E.164(`+8210XXXXXXXX`).
 *
 * 받아주는 표기: `010-1234-5678` · `01012345678` · `+82 10-1234-5678` ·
 *                `82 10 1234 5678` · `0010-…`(국제전화 접두) · 공백·점·괄호 섞임
 * 거르는 값: 자릿수 부적합 · 휴대폰 대역이 아닌 번호(02·031…) · 빈 값
 *
 * @param {string} [value]
 * @returns {string} E.164 문자열, 판단 불가면 `''`
 */
export function toE164Mobile(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let d = digits(raw);
  if (!d) return '';

  // 국제전화 접두(00·011 등)로 시작하면 떼어낸다 — `008210…` 같은 표기가 실제로 들어온다.
  d = d.replace(/^00+/, '');

  // `82` 로 시작하면 국가코드로 본다 → 국내형(0 + 나머지)으로 되돌려 한 갈래로 처리한다.
  if (d.startsWith('82')) {
    const rest = d.slice(2);
    if (!rest) return '';
    d = rest.startsWith('0') ? rest : `0${rest}`;
  }

  // 여기서부터 국내 표기 기준. 휴대폰 대역만 받는다.
  //  01[016789] + 7~8자리 = 총 10~11자리
  if (!/^01[016789]\d{7,8}$/.test(d)) return '';

  return `+82${d.slice(1)}`;
}

/**
 * 두 번호가 **같은 사람**인가 — 표기 차이를 흡수해 비교한다.
 * 한쪽이라도 판단 불가면 `false`(모르면 통과시키지 않는다).
 * @param {string} [a] @param {string} [b]
 */
export function samePhone(a, b) {
  const x = toE164Mobile(a);
  const y = toE164Mobile(b);
  return Boolean(x) && x === y;
}

/**
 * 화면 표시용 — `010-1234-5678`. 판단 불가면 원문을 그대로 돌려준다
 * (지우면 담당자가 무엇이 잘못됐는지 못 본다).
 * @param {string} [value]
 */
export function formatPhoneKo(value) {
  const e164 = toE164Mobile(value);
  if (!e164) return String(value ?? '');
  const d = `0${e164.slice(3)}`;              // +8210… → 010…
  return d.length === 11
    ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
    : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}
