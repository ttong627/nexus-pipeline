// 학습사전 정규식 조립 SSOT 검증 — node --test scripts/dict-regex.test.mjs
//
//   A-2(오타 보정)·A-9(특수문자 분리)의 정규식 조립 규칙이 클라와 서버에 복제되면
//   같은 명단이 브라우저 정제와 서버 정제에서 다른 결과를 낸다.
//   → `services/address-service/src/shared/dictRegex.js` 단일 출처 + 이 잠금장치.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SPECIAL_CHARS, buildTypoRegex, buildSpecialCharRegex,
} from '../services/address-service/src/shared/dictRegex.js';

test('A-2 오타 정규식: 사전이 비면 null, 있으면 전역 치환', () => {
  assert.equal(buildTypoRegex({}), null);
  assert.equal(buildTypoRegex(null), null);
  const re = buildTypoRegex({ 재기로: '제기로', 왕산노: '왕산로' });
  assert.equal('재기로 5 왕산노 3'.replace(re, (m) => ({ 재기로: '제기로', 왕산노: '왕산로' }[m])), '제기로 5 왕산로 3');
});

test('A-2 오타 정규식: 정규식 메타문자가 든 키도 문자 그대로 매칭', () => {
  const re = buildTypoRegex({ 'A(1)': 'A1' });
  assert.match('101동 A(1)', re);
  assert.doesNotMatch('101동 A1', re, '메타문자가 이스케이프되지 않아 엉뚱한 문자열이 잡혔다');
});

test('A-9 특수문자: 길이 내림차순 — "**"가 "*"보다 먼저 잡힌다', () => {
  const re = buildSpecialCharRegex(DEFAULT_SPECIAL_CHARS);
  assert.equal('왕산로 72 **경비실 맡김'.match(re)[1], '**');
});

// ★★2026-08-01 서버 파리티 테스트가 실제로 검출한 사고 — 회귀 금지.
test('A-9 특수문자: 목록이 비면 null (절대 "모든 문자열 매칭" 정규식을 만들지 않는다)', () => {
  assert.equal(buildSpecialCharRegex([]), null);
  assert.equal(buildSpecialCharRegex(null), null);
  assert.equal(buildSpecialCharRegex(undefined), null);

  // 왜 치명적인가: 빈 목록으로 조립하면 `()(.*)`가 되어 모든 문자열의 0번 위치에서 매칭된다.
  // A-9 2차(상세주소)에는 위치 가드가 없어 상세주소가 통째로 특이사항으로 옮겨진다.
  const naive = new RegExp('()(.*)');            // 방어가 없을 때 만들어지던 정규식
  const detail = '101- 203호 3층';
  assert.equal(detail.match(naive)[2], detail, '이 정규식이 상세주소를 통째로 삼킨다(그래서 null이어야 한다)');
});

test('A-9 특수문자: 학습분이 기본값에 얹혀도 동작', () => {
  const re = buildSpecialCharRegex([...DEFAULT_SPECIAL_CHARS, '◆']);
  assert.equal('왕산로 72 ◆뒷문'.match(re)[1], '◆');
});

// ── 잠금장치: 클라·서버가 각자 조립하지 않고 SSOT를 쓴다 ──
test('클라·서버 어느 쪽도 정규식 조립을 재정의하지 않는다', () => {
  const client = readFileSync(new URL('../src/engine/addressEngine.js', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../services/address-service/src/dictStore.js', import.meta.url), 'utf8');
  for (const [name, src] of [['클라', client], ['서버 dictStore', store]]) {
    assert.match(src, /from\s+['"][^'"]*dictRegex\.js['"]/, `⚠️ ${name}가 SSOT를 안 쓴다`);
    assert.doesNotMatch(src, /new RegExp\(`\(\$\{/, `⚠️ ${name}가 특수문자 정규식을 직접 조립했다 — 복제 금지`);
  }
});
