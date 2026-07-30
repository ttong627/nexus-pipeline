// 괄호 중첩 안전처리 회귀 테스트 — node --test scripts/paren-safe.test.mjs
//   근본원인(2026-07-30 실측): 건물명에 괄호가 포함되면(예 '호매실 엔루체(NLUCE)', '경희연립(마)')
//   ①A-11 조립이 (법정동, 건물명)으로 감싸 괄호 짝이 깨지고 ②파서의 괄호 추출이 중첩을 못 읽어
//   ③재정제마다 잔재가 누적됐다. depth 인식으로 왕복(조립→파싱→재조립)이 안정되는지 검증한다.
//   형 방침: 건물명 훼손 금지(괄호 유지) · 명단 원문 삭제 금지 · 멱등성 필수.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTopLevelParen,
  splitParenInner,
  balanceParens,
  protectParenBlocks,
  parseDisplayedAddress,
  formatAddressDisplay,
} from '../src/utils/addressFormat.js';

// ── extractTopLevelParen: depth 인식 최상위 괄호 블록 ──
test('중첩 괄호를 하나의 최상위 블록으로 추출', () => {
  const r = extractTopLevelParen('101- 203호 (호매실동, 호매실 엔루체(NLUCE))');
  assert.equal(r.inner, '호매실동, 호매실 엔루체(NLUCE)');
  assert.equal(r.before.trim(), '101- 203호');
  assert.equal(r.after.trim(), '');
});

test('단순 괄호도 동일하게 추출', () => {
  const r = extractTopLevelParen('302호 (장안동, 가든시티2차)');
  assert.equal(r.inner, '장안동, 가든시티2차');
  assert.equal(r.before.trim(), '302호');
});

test('괄호 없으면 inner 빈값·before는 원문', () => {
  const r = extractTopLevelParen('권선로 472 101- 203호');
  assert.equal(r.inner, '');
  assert.equal(r.before, '권선로 472 101- 203호');
  assert.equal(r.found, false);
});

test('짝 없는 여는 괄호 — 끝까지를 내부로 간주(정보 보존)', () => {
  const r = extractTopLevelParen('302호 (장안동, 주함해븐빌');
  assert.equal(r.found, true);
  assert.equal(r.inner, '장안동, 주함해븐빌');
});

test('짝 없는 닫는 괄호는 괄호로 오인하지 않음', () => {
  const r = extractTopLevelParen('302호 ) 장안동');
  assert.equal(r.found, false);
});

// ── splitParenInner: depth 인식 콤마 분리 (법정동, 건물명) ──
test('괄호 내부를 법정동/건물명으로 분리 — 건물명 속 괄호 보존', () => {
  assert.deepEqual(splitParenInner('호매실동, 호매실 엔루체(NLUCE)'), ['호매실동', '호매실 엔루체(NLUCE)']);
  assert.deepEqual(splitParenInner('이문동, 경희연립(마)'), ['이문동', '경희연립(마)']);
});

test('건물명 속 괄호 안의 콤마는 분리 기준이 아님', () => {
  assert.deepEqual(splitParenInner('장안동, 주함빌(A,B동)'), ['장안동', '주함빌(A,B동)']);
});

test('법정동만 있으면 1개', () => {
  assert.deepEqual(splitParenInner('권선동'), ['권선동']);
  assert.deepEqual(splitParenInner(''), []);
});

// ── balanceParens: 괄호 짝 불균형 안전화 ──
test('괄호 짝이 맞으면 원본 그대로(건물명 훼손 금지)', () => {
  assert.equal(balanceParens('호매실 엔루체(NLUCE)'), '호매실 엔루체(NLUCE)');
  assert.equal(balanceParens('경희연립(마)'), '경희연립(마)');
  assert.equal(balanceParens('가든시티2차'), '가든시티2차');
});

test('짝 안 맞는 괄호만 제거 — 내용은 보존(삭제 금지)', () => {
  assert.equal(balanceParens('엔루체(NLUCE'), '엔루체 NLUCE');
  assert.equal(balanceParens('경희연립마)'), '경희연립마');
});

test('빈값 방어', () => {
  assert.equal(balanceParens(''), '');
  assert.equal(balanceParens(null), '');
});

// ── protectParenBlocks: 엔진 전처리용 depth 인식 보호 ──
test('중첩 괄호 전체를 하나의 토큰으로 보호', () => {
  const r = protectParenBlocks('호매실로166번길 70 (호매실동, 호매실 엔루체(NLUCE)) 203호');
  assert.equal(r.text, '호매실로166번길 70 __P0__ 203호');
  assert.deepEqual(r.blocks, ['(호매실동, 호매실 엔루체(NLUCE))']);
});

test('빈 괄호는 공백으로 제거', () => {
  const r = protectParenBlocks('권선로 472 ( ) 203호');
  assert.equal(r.text.replace(/\s+/g, ' ').trim(), '권선로 472 203호');
  assert.deepEqual(r.blocks, []);
});

test('괄호 여러 개 각각 보호', () => {
  const r = protectParenBlocks('길 1 (가) 2 (나)');
  assert.equal(r.text, '길 1 __P0__ 2 __P1__');
  assert.deepEqual(r.blocks, ['(가)', '(나)']);
});

// ── parseDisplayedAddress: 중첩 괄호 정상 파싱 (핵심 회귀) ──
test('중첩 괄호 주소를 정확히 분해', () => {
  const a = '호매실로166번길 70, 2001- 1704호 (호매실동, 호매실 엔루체(NLUCE))';
  const p = parseDisplayedAddress(a);
  assert.equal(p.road, '호매실로166번길 70');
  assert.equal(p.detail, '2001- 1704호');
  assert.equal(p.paren, '호매실동, 호매실 엔루체(NLUCE)');
});

test('중첩 없는 기존 주소 파싱 불변(퇴행 금지)', () => {
  const p = parseDisplayedAddress('권선로 472, 101- 203호 3층 (권선동, 래미안)');
  assert.equal(p.road, '권선로 472');
  assert.equal(p.detail, '101- 203호 3층');
  assert.equal(p.paren, '권선동, 래미안');
});

test('괄호 먼저 오는 형식도 파싱', () => {
  const p = parseDisplayedAddress('권선로 472, (권선동, 래미안) 101- 203호');
  assert.equal(p.road, '권선로 472');
  assert.equal(p.detail, '101- 203호');
  assert.equal(p.paren, '권선동, 래미안');
});

// ── 왕복 멱등성 (잔재 누적 차단의 핵심 증거) ──
test('멱등성: 조립→파싱→재조립을 3회 반복해도 불변', () => {
  const cases = [
    '호매실로166번길 70, 2001- 1704호 (호매실동, 호매실 엔루체(NLUCE))',
    '이문로9길 84, 302호 (이문동, 경희연립(마))',
    '권선로 472, 101- 203호 3층 (권선동, 래미안)',
    '왕산로2길 34, 312호 (신설동)',
    '사가정로23길 20, 104- 301호 (장안동, 주함해븐빌)',
  ];
  for (const src of cases) {
    let cur = src;
    for (let i = 0; i < 3; i++) {
      const next = formatAddressDisplay(cur, 'detailBeforeParen');
      assert.equal(next, cur, `왕복 ${i + 1}회차에서 변형: ${JSON.stringify(src)} → ${JSON.stringify(next)}`);
      cur = next;
    }
  }
});

test('멱등성: 중첩 괄호 건물명이 왕복 중 훼손되지 않음', () => {
  const src = '호매실로166번길 70, 2001- 1704호 (호매실동, 호매실 엔루체(NLUCE))';
  const out = formatAddressDisplay(formatAddressDisplay(src));
  assert.ok(out.includes('호매실 엔루체(NLUCE)'), `건물명 훼손: ${out}`);
});
