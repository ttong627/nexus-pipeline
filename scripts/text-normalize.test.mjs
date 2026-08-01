// shared/textNormalize.js 순수함수 회귀 (P7 Phase2 규격화 SSOT)
//   node --test scripts/text-normalize.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeAddressPreamble,
  normalizeCenterName,
  stripLeadingAddressJunk,
} from '../services/address-service/src/shared/textNormalize.js';

test('A-3 유니코드: NFC·zero-width·NBSP·따옴표·연속공백 정규화', () => {
  assert.equal(normalizeAddressPreamble('왕산로​ 72,\t"201호"'), '왕산로 72, 201호');
  assert.equal(normalizeAddressPreamble('왕산로　72'), '왕산로 72'); // 전각공백 → 공백
  assert.equal(normalizeAddressPreamble('왕산로  72'), '왕산로 72');  // 연속공백 → 단일
});

test('A-4 미닫힌 괄호 제거', () => {
  assert.equal(normalizeAddressPreamble('왕산로 72, 201호 (장안동'), '왕산로 72, 201호');
});

test('A-6 통·반 제거', () => {
  // 프리앰블 단독 출력이라 콤마 앞 공백은 후속 단계(A-5·도로명 분리)가 정리한다.
  // 여기서는 통·반 토큰이 제거되는 것만 고정한다.
  assert.equal(normalizeAddressPreamble('왕산로 72 제3통 제2반, 201호'), '왕산로 72 , 201호');
  assert.equal(normalizeAddressPreamble('신흥리 123 제1통 제1반'), '신흥리 123');
});

test('A-15 도로명 번호 뒤 "." → ","', () => {
  assert.equal(normalizeAddressPreamble('테헤란로 123. 456호'), '테헤란로 123, 456호');
});

test('A-16 번지 표기 제거', () => {
  assert.equal(normalizeAddressPreamble('신흥리 123번지'), '신흥리 123');
  assert.equal(normalizeAddressPreamble('신남리 123-5번지'), '신남리 123-5');
});

test('A-21 동/읍/면사무소 → 주민센터 (주소·특이사항 공용)', () => {
  assert.equal(normalizeAddressPreamble('장안동사무소 앞'), '장안주민센터 앞');
  assert.equal(normalizeCenterName('읍사무소 옆'), '주민센터 옆');
  assert.equal(normalizeCenterName('면사무소'), '주민센터');
});

test('stripLeadingAddressJunk: 앞쪽 구분자 잡음 제거', () => {
  assert.equal(stripLeadingAddressJunk(',, 왕산로 72'), '왕산로 72');
  assert.equal(stripLeadingAddressJunk('·/ 테헤란로'), '테헤란로');
});

test('멱등성: 규격화 결과를 다시 넣어도 불변', () => {
  const once = normalizeAddressPreamble('왕산로 72 제1통 제1반, 201호 (장안동');
  assert.equal(normalizeAddressPreamble(once), once);
});

test('빈값·비문자 방어', () => {
  assert.equal(normalizeAddressPreamble(''), '');
  assert.equal(normalizeAddressPreamble(null), '');
  assert.equal(normalizeAddressPreamble(undefined), '');
  assert.equal(normalizeCenterName(null), '');
});

// ── 잠금장치: 클라 정제 경로가 shared SSOT를 쓰고 규격화를 재정의하지 않는다 ──
// P7 Phase2 ⓒ-1에서 정제 본체가 addressEngine.js → shared/purifyCore.js 로 이동했다.
// 클라 경로 = addressEngine.js(IO·사전 주입 어댑터) + purifyCore.js(코어). 둘 다 검사한다.
test('클라 정제 경로가 규격화 프리앰블을 shared에서 import 한다', () => {
  const adapter = readFileSync(new URL('../src/engine/addressEngine.js', import.meta.url), 'utf8');
  const core    = readFileSync(new URL('../services/address-service/src/shared/purifyCore.js', import.meta.url), 'utf8');
  assert.match(adapter, /from\s*['"][^'"]*shared\/purifyCore\.js['"]/, '⚠️ 클라가 공용 코어를 안 쓴다 — 복제되면 갈라진다');
  assert.match(core, /import\s*\{[^}]*normalizeAddressPreamble[^}]*\}\s*from\s*['"][^'"]*textNormalize\.js['"]/);
  assert.match(core, /normalizeAddressPreamble\(text\)/);
  // 프리앰블을 로컬에서 다시 정의(복제)하면 실패.
  for (const [name, src] of [['어댑터', adapter], ['코어', core]]) {
    assert.doesNotMatch(src, /const\s+stripLeadingAddressJunk\s*=/, `${name}에 stripLeadingAddressJunk 재정의가 남아 있다(복제 금지)`);
  }
});
