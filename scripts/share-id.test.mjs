// ══════════════════════════════════════════════════════════════════
//  공유링크 ID 회귀 — src/utils/shareId.js (2026-08-13 · 개인정보 점검)
//
//  ★막는 것: 공유 문서(`route_shares`)는 **인증 없이** 읽히므로 ID 를 아는 것이 곧 열람 권한이다.
//    ID 가 시각 기반이거나 `Math.random` 이면 추측 가능성이 생긴다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newShareId, isShareId } from '../src/utils/shareId.js';

test('접두사 sr_ 를 유지한다 — 기존 링크 형식과 알아보기', () => {
  assert.ok(newShareId().startsWith('sr_'));
  assert.equal(isShareId(newShareId()), true);
});

test('★시각이 ID 에 안 들어간다 — 예전엔 Date.now() 가 앞부분이었다', () => {
  // 예전 형식: sr_<Date.now().toString(36)>_<random5>
  const nowB36 = Date.now().toString(36);
  for (let i = 0; i < 50; i += 1) {
    assert.equal(newShareId().includes(nowB36), false, 'ID 에 현재 시각이 들어갔다 — 앞부분을 좁힐 수 있다');
  }
});

test('★후보 공간이 충분하다 — 접두사 제외 32자 이상(128비트급)', () => {
  const body = newShareId().slice('sr_'.length).replace(/-/g, '');
  assert.ok(body.length >= 32, `엔트로피가 부족하다(${body.length}자) — 예전 방식은 5자였다`);
});

test('★매번 다른 값 — 1,000회 전부 고유', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) seen.add(newShareId());
  assert.equal(seen.size, 1000);
});

// ── 난수원이 없을 때의 태도 ────────────────────────────────────────
test('randomUUID 가 없으면 getRandomValues 로 같은 세기를 유지한다', () => {
  const fake = { getRandomValues: (arr) => { arr.forEach((_, i) => { arr[i] = (i * 7 + 3) & 0xff; }); return arr; } };
  const id = newShareId(fake);
  assert.ok(id.startsWith('sr_'));
  assert.equal(id.slice(3).length, 32, '16바이트=32 hex 자리를 유지해야 한다');
});

test('★안전한 난수원이 없으면 던진다 — 약한 ID 를 만들어 내지 않는다', () => {
  assert.throws(() => newShareId({}), /안전한 난수원/);
  assert.throws(() => newShareId(null), /안전한 난수원/);
});

test('isShareId 는 짧거나 형식이 다른 값을 거른다', () => {
  assert.equal(isShareId('sr_short'), false);
  assert.equal(isShareId('other_0123456789012345678901234567'), false);
  assert.equal(isShareId(''), false);
  assert.equal(isShareId(null), false);
});
