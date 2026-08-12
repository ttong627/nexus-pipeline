// ══════════════════════════════════════════════════════════════════
//  기사 공유링크 ID 생성 — **추측 불가능해야 한다**
//  회귀: scripts/share-id.test.mjs
//
//  ★왜 바꿨나 (2026-08-13 · 개인정보 점검)
//    공유 문서(`route_shares`)에는 대상자 **이름·주소·휴대폰**이 담기고,
//    보안규칙상 **인증 없이** 읽힌다(`allow read: if isShareWithinTTL()`).
//    즉 **ID 를 아는 것 = 열람 권한**이다. 그러면 ID 자체가 사실상 비밀번호다.
//
//    예전 방식: `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
//      · `Date.now()` 는 **비밀이 아니다** — 배송 배정 시각을 아는 사람은 앞부분을 좁힐 수 있다.
//      · `Math.random()` 은 **암호학적 난수가 아니다**(V8 xorshift128+). 예측 가능성이 설계상 존재하고,
//        뒤 5자만 쓰므로 후보 공간도 36^5 ≈ 6천만에 불과하다.
//    지금 방식: `sr_` + `crypto.randomUUID()` — 122비트 CSPRNG.
//
//  ⚠️`crypto.randomUUID()` 는 **보안 컨텍스트(https·localhost)** 에서만 있다.
//    운영(logis-op.web.app)·개발(localhost) 둘 다 해당하지만, 없을 때 조용히 약한 값으로
//    떨어지면 그게 제일 위험하다 → `getRandomValues` 로 **같은 세기**를 유지하고,
//    그마저 없으면 **던진다**(약한 ID 를 만들어 내지 않는다).
// ══════════════════════════════════════════════════════════════════

/** 링크에서 알아보기 쉬우라고 붙이는 접두사(비밀이 아니다). */
const PREFIX = 'sr_';

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * 새 공유링크 ID.
 * @param {Crypto} [cryptoObj] 주입용(테스트). 기본은 전역 `crypto`.
 * @returns {string} 예: `sr_3f2a...`(UUID) — 접두사 제외 32자 이상
 */
export function newShareId(cryptoObj = globalThis.crypto) {
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return PREFIX + cryptoObj.randomUUID();
  }
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    // UUID API 가 없어도 세기는 유지한다(16바이트 = 128비트).
    return PREFIX + hex(cryptoObj.getRandomValues(new Uint8Array(16)));
  }
  // ★여기서 Math.random 으로 떨어지지 않는다 — 약한 ID 는 만들지 않는 편이 낫다.
  throw new Error('공유링크 ID를 만들 수 없습니다: 이 환경에 안전한 난수원(crypto)이 없습니다.');
}

/** 접두사 포함 여부만 보는 가벼운 판별(라우팅·로그용). */
export const isShareId = (v) => typeof v === 'string' && v.startsWith(PREFIX) && v.length > PREFIX.length + 20;
