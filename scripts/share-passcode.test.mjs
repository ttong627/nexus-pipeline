// 공유링크 비밀번호(숫자 6자리) 회귀 — 클라(Web Crypto)·서버(node crypto) 해시 일치 + 입장 판정
//   node --test scripts/share-passcode.test.mjs
//
//   ★한쪽만 고치면 기사가 영영 못 연다 — 두 구현의 해시가 같은지 여기서 잠근다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { hashPasscode, newSalt, randomPasscode, isValidPasscode, DEFAULT_SHARE_PASSCODE } from '../src/utils/sharePasscode.js';
import { decideGate, gateMessage } from '../src/utils/shareGate.js';

const require = createRequire(import.meta.url);
const server = require('../functions/sharePasscode.js');

test('클라·서버 해시가 같다 (sha256 `${salt}:${passcode}` hex)', async () => {
  const salt = newSalt();
  for (const pc of ['000000', '123456', '999999', '042817']) {
    const a = await hashPasscode(pc, salt);
    const b = server.hashPasscode(pc, salt);
    assert.equal(a, b, `passcode ${pc}`);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(server.verifyPasscode(pc, salt, a), true);
    assert.equal(server.verifyPasscode('111111', salt, a), false);
  }
});

test('솔트는 매번 다르고 32 hex, 같은 비밀번호도 솔트가 다르면 해시가 다르다', async () => {
  const s1 = newSalt(), s2 = newSalt();
  assert.match(s1, /^[0-9a-f]{32}$/);
  assert.notEqual(s1, s2);
  assert.notEqual(await hashPasscode('123456', s1), await hashPasscode('123456', s2));
  assert.match(server.newSalt(), /^[0-9a-f]{32}$/);
});

test('비밀번호 형식 — 숫자 6자리만', () => {
  for (const ok of ['000000', '123456']) { assert.equal(isValidPasscode(ok), true); assert.equal(server.isValidPasscode(ok), true); }
  for (const bad of ['12345', '1234567', '12a456', '', null, undefined, ' 123456', '١٢٣٤٥٦']) {
    assert.equal(isValidPasscode(bad), false, String(bad));
    assert.equal(server.isValidPasscode(bad), false, String(bad));
  }
  for (let i = 0; i < 50; i++) assert.match(randomPasscode(), /^\d{6}$/);
});

test('verifyPasscode 는 형식 불량·해시 없음에 false (예외 없음)', () => {
  const salt = server.newSalt();
  const h = server.hashPasscode('123456', salt);
  assert.equal(server.verifyPasscode('12345', salt, h), false);
  assert.equal(server.verifyPasscode('123456', '', h), false);
  assert.equal(server.verifyPasscode('123456', salt, ''), false);
  assert.equal(server.verifyPasscode('123456', salt, 'zz'), false);
});

test('입장 판정 decideGate — 담당자 세션은 건드리지 않고, 토큰 있으면 바로, 아니면 probe', () => {
  assert.equal(decideGate({ isAnonymous: false, email: 'a@b.c' }, { email: 'a@b.c' }, 'sr_1'), 'staff');
  assert.equal(decideGate({ isAnonymous: false, email: null }, {}, 'sr_1'), 'staff', 'SSO 담당자(커스텀 토큰·email 없음)도 담당자 — 세션을 덮어쓰지 않는다');
  assert.equal(decideGate({ isAnonymous: false, email: null }, { shareId: 'sr_1' }, 'sr_1'), 'token');
  assert.equal(decideGate({ isAnonymous: false, email: null }, { shareId: 'sr_2' }, 'sr_1'), 'probe', '다른 공유의 토큰은 무효');
  assert.equal(decideGate(null, null, 'sr_1'), 'probe');
  assert.equal(decideGate({ isAnonymous: true }, {}, 'sr_1'), 'probe');
});

test('gateMessage — 코드별 문장, 비밀번호 필요(failed-precondition)는 빈 문자열(입력창만)', () => {
  assert.equal(gateMessage('functions/failed-precondition'), '');
  assert.match(gateMessage('functions/permission-denied'), /맞지 않습니다/);
  assert.match(gateMessage('functions/resource-exhausted', { minutes: 10 }), /10분/);
  assert.match(gateMessage('functions/not-found'), /만료/);
  assert.match(gateMessage('anything-else'), /다시 시도/);
});

test('기본 비밀번호 — 클라·서버 값이 같아야 한다(어긋나면 기사가 못 들어온다)', () => {
  // 형 지시 2026-08-25: "담당자가 비밀번호를 정하면 그 번호고, 안 정하거나 없는 경우는 181111".
  // 이 값이 두 곳에 나뉘어 있으므로(클라 발행 · 서버 검증) 한쪽만 고치면 조용히 안 열린다.
  assert.equal(DEFAULT_SHARE_PASSCODE, '181111');
  assert.equal(server.DEFAULT_SHARE_PASSCODE, DEFAULT_SHARE_PASSCODE, '클라·서버 기본번호가 다르다');
  assert.equal(isValidPasscode(DEFAULT_SHARE_PASSCODE), true, '기본번호가 6자리 규격을 벗어났다');
});

test('비밀번호 문서가 없는 공유는 기본번호로만 열린다 — 옛 자동통과 경로가 부활하면 안 된다', async () => {
  const src = await readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert.equal(/case 'legacy': return mint\(/.test(src), false, '비밀번호 없이 그냥 열어 주던 경로가 되살아났다');
  assert.match(src, /usingDefault/, '기본번호 경로가 사라졌다');
  assert.match(src, /if \(usingDefault\) Object\.assign\(secPatch/, '틀린 시도로 해시 없는 반쪽 문서가 생기는 것을 막는 코드가 없다');
});
