// ══════════════════════════════════════════════════════════════════
//  기사 명부 — 저장 전 검증과 인증 판정 (순수 로직)
//  회귀: scripts/driver-roster.test.mjs
//
//  ★이 파일이 하는 일 = "이 번호로 들어온 사람을 통과시킬 것인가"
//    배송지도 접근통제(계획 Phase 0~2)의 판정이 전부 여기서 갈린다.
//    Firestore 접근은 섞지 않는다 — 판정을 테스트로 잠글 수 있어야 하기 때문이다.
//
//  ⚠️`drivers` 컬렉션은 2026-08-13 실측 시점에 **0건**이었다. 기사는 화면 세션 안의
//    임시 객체였고 휴대폰 필드가 아예 없었다. 그래서 명부를 새로 만든다.
// ══════════════════════════════════════════════════════════════════
import { toE164Mobile, samePhone } from './phone.js';

/** 저장 시 쓰는 정규 형태로 다듬는다(문자열 트림·번호 정규화). */
export function normalizeDriver(input) {
  const src = input || {};
  return {
    name: String(src.name ?? '').trim(),
    phone: toE164Mobile(src.phone),          // ★항상 E.164. 못 읽으면 빈 값
    phoneRaw: String(src.phone ?? '').trim(), // 담당자가 뭘 입력했는지 보존(고칠 때 근거)
    active: src.active !== false,             // 기본 활성
    memo: String(src.memo ?? '').trim(),
  };
}

/**
 * 저장해도 되는가. **문제를 사유 목록으로** 돌려준다(하나만 알려주면 담당자가 여러 번 헛돈다).
 *
 * @param {object} input 입력값
 * @param {Array} [existing] 이미 등록된 기사들(중복 검사용)
 * @param {string} [selfId] 수정 중인 기사 id(자기 자신은 중복이 아니다)
 */
export function validateDriver(input, existing = [], selfId = '') {
  const d = normalizeDriver(input);
  const errors = [];

  if (!d.name) errors.push('이름을 입력하세요.');
  if (d.name.length > 30) errors.push('이름이 너무 깁니다(30자 이내).');

  if (!d.phoneRaw) {
    errors.push('휴대폰 번호를 입력하세요.');
  } else if (!d.phone) {
    // ★여기서 "대충 저장"하면 그 기사는 영영 인증을 못 통과한다 — 에러도 안 나고 조용히.
    errors.push(`휴대폰 번호를 읽을 수 없습니다: "${d.phoneRaw}" — 010으로 시작하는 휴대폰 번호여야 합니다.`);
  }

  if (d.phone) {
    const dup = (existing || []).find(
      (x) => x && String(x.id || '') !== String(selfId || '') && samePhone(x.phone, d.phone),
    );
    if (dup) {
      // ★같은 번호가 둘이면 인증이 들어왔을 때 **누구인지 정할 수 없다**.
      errors.push(`이미 등록된 번호입니다: ${dup.name || '(이름없음)'}`);
    }
  }

  return { ok: errors.length === 0, errors, value: d };
}

/**
 * 이 번호로 들어온 사람을 **통과시킬 것인가** — 인증 판정의 핵심.
 *
 * ★모르면 통과시키지 않는다. 비활성·미등록·번호 불명은 전부 거절이다.
 *
 * @param {string} tokenPhone Firebase Phone Auth 가 준 `token.phone_number`(E.164)
 * @param {Array} roster 등록된 기사 목록
 * @returns {{allowed:boolean, driver:object|null, reason:string}}
 */
export function resolveDriverByPhone(tokenPhone, roster = []) {
  const phone = toE164Mobile(tokenPhone);
  if (!phone) return { allowed: false, driver: null, reason: 'invalid_phone' };

  const hits = (roster || []).filter((d) => d && samePhone(d.phone, phone));
  if (!hits.length) return { allowed: false, driver: null, reason: 'not_registered' };
  if (hits.length > 1) {
    // 명부가 오염된 상태다. 아무나 고르면 **남의 배송**을 줄 수 있다 → 막고 사람이 고치게 한다.
    return { allowed: false, driver: null, reason: 'duplicate_registration' };
  }

  const driver = hits[0];
  if (driver.active === false) return { allowed: false, driver, reason: 'inactive' };
  return { allowed: true, driver, reason: 'ok' };
}

/** 거절 사유 → 기사 화면에 보여줄 말(막연한 '접근 불가'는 담당자에게 전화만 늘린다). */
export const DENY_MESSAGE = {
  invalid_phone: '휴대폰 번호를 확인할 수 없습니다. 담당자에게 문의하세요.',
  not_registered: '등록되지 않은 번호입니다. 담당자에게 기사 등록을 요청하세요.',
  duplicate_registration: '같은 번호가 중복 등록돼 있습니다. 담당자 확인이 필요합니다.',
  inactive: '비활성 처리된 계정입니다. 담당자에게 문의하세요.',
};

/** 명부에서 공유문서에 심을 번호 목록(정규화·중복제거·활성만). */
export function activePhones(roster = []) {
  const out = [];
  for (const d of roster || []) {
    if (!d || d.active === false) continue;
    const p = toE164Mobile(d.phone);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
