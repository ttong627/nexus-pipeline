// 공유링크 비밀번호(숫자 6자리) — 서버 측 SSOT (CommonJS · functions 는 ESM 을 못 쓴다)
//   클라(src/utils/sharePasscode.js · Web Crypto)와 **같은 규격**: sha256(`${salt}:${passcode}`) hex.
//   회귀 scripts/share-passcode.test.mjs 가 양쪽 해시가 같은지 잠근다 — 한쪽만 고치면 기사가 영영 못 연다.
'use strict';
const crypto = require('crypto');

const PASSCODE_RE = /^\d{6}$/;
const isValidPasscode = (v) => PASSCODE_RE.test(String(v ?? ''));
const newSalt = () => crypto.randomBytes(16).toString('hex');
const hashPasscode = (passcode, salt) =>
  crypto.createHash('sha256').update(`${String(salt)}:${String(passcode)}`, 'utf8').digest('hex');
// 비교는 상수시간 — 한 글자씩 빨리 틀리는 차이로 답을 좁히지 못하게
const verifyPasscode = (passcode, salt, hash) => {
  if (!isValidPasscode(passcode) || !salt || !hash) return false;
  const a = Buffer.from(hashPasscode(passcode, salt), 'hex');
  const b = Buffer.from(String(hash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = { PASSCODE_RE, isValidPasscode, newSalt, hashPasscode, verifyPasscode };
