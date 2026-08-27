// 공유링크 비밀번호(숫자 6자리) — 클라 측 (Web Crypto · ESM)
//   서버(functions/sharePasscode.js)와 **같은 규격**: sha256(`${salt}:${passcode}`) hex.
//   담당자 화면은 해시·솔트만 `route_share_secrets/{shareId}` 에 쓴다(평문 저장 금지). 기사 화면은 검증을
//   Function(`openShare`)에 맡기고 토큰만 받는다 — 해시가 클라에 내려오면 6자리는 즉시 뚫린다.
//   회귀 scripts/share-passcode.test.mjs (서버 구현과 해시 일치).

// ★기본 비밀번호(형 지시 2026-08-25): *"담당자가 비밀번호를 정하면 그 번호고,
//   비밀번호를 안 정하거나 없는 경우는 181111 로 기본 디폴트 비번 정해줘."*
//   - 담당자가 발행 창에서 번호를 넣으면 그 번호가 그 지도의 비밀번호다(기존과 동일).
//   - 비워 두면 이 번호로 발행된다. 비밀번호 문서가 아예 없는 옛 지도도 이 번호로 열린다.
//   ⚠️모든 지도가 같은 번호가 되면 한 번 새는 순간 전부 열린다 — 중요한 명단은 발행할 때 따로 정할 것.
export const DEFAULT_SHARE_PASSCODE = '181111';

export const PASSCODE_RE = /^\d{6}$/;
export const isValidPasscode = (v) => PASSCODE_RE.test(String(v ?? ''));

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const cryptoApi = () => (typeof globalThis !== 'undefined' && globalThis.crypto) || null;

/** 16바이트 무작위 솔트(hex 32자) */
export const newSalt = () => {
  const c = cryptoApi();
  if (!c?.getRandomValues) throw new Error('보안 난수 생성기를 쓸 수 없습니다(비밀번호 저장 중단)');
  return hex(c.getRandomValues(new Uint8Array(16)));
};

/** 6자리 무작위 비밀번호 — 담당자가 직접 정하기 귀찮을 때(앞자리 0 허용) */
export const randomPasscode = () => {
  const c = cryptoApi();
  if (!c?.getRandomValues) throw new Error('보안 난수 생성기를 쓸 수 없습니다');
  const n = c.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
};

/** sha256(`${salt}:${passcode}`) hex — 서버와 동일 */
export const hashPasscode = async (passcode, salt) => {
  const c = cryptoApi();
  if (!c?.subtle) throw new Error('이 브라우저는 안전한 해시를 지원하지 않습니다');
  const data = new TextEncoder().encode(`${String(salt)}:${String(passcode)}`);
  return hex(new Uint8Array(await c.subtle.digest('SHA-256', data)));
};
