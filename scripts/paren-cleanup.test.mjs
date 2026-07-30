// 괄호 정화(P1-b) 회귀 테스트 — node --test scripts/paren-cleanup.test.mjs
//   괄호 `()` 는 (법정동, 건물명)만 담는다(A-11/A-29). 실측 274건은 여기에 배송힌트·숫자코드·
//   잔재가 섞여 같은 건물의 표기가 갈렸다. 건물명이 아닌 값을 골라 특이사항으로 **이관**한다.
//   형 방침: 원문 삭제 금지(이관) · 건물명 후보는 절대 제거 금지 · 판단 불가면 보류(원본 보존).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyParenParts } from '../src/utils/parenCleanup.js';

const run = (paren, legalDong) => classifyParenParts(paren, legalDong);

// ── 정화 대상 (실측 케이스) ──
test('배송힌트가 섞인 괄호 — 힌트만 이관, 법정동만 남김', () => {
  const r = run('장안동, 5층 식당보관, E (장안동)', '장안동');
  assert.equal(r.building, '');
  assert.deepEqual(r.moved, ['5층 식당보관']);
  assert.equal(r.changed, true);
});

test('숫자 코드가 섞인 괄호 — 코드만 이관', () => {
  const r = run('신설동, 8652 (신설동)', '신설동');
  assert.equal(r.building, '');
  assert.deepEqual(r.moved, ['8652']);
  assert.equal(r.changed, true);
});

test('건물명 + 잡값이 함께 있으면 건물명은 남기고 잡값만 이관', () => {
  const r = run('장안동, 신궁전고시텔, 5층 식당보관', '장안동');
  assert.equal(r.building, '신궁전고시텔');
  assert.deepEqual(r.moved, ['5층 식당보관']);
});

test('법정동 중복은 이관하지 않고 제거', () => {
  const r = run('성정동, 성정동, 소나무빌', '성정동');
  assert.equal(r.building, '소나무빌');
  assert.deepEqual(r.moved, []);
  assert.equal(r.changed, true);
});

// ── 손대지 않아야 하는 정상 케이스 ──
test('정상 괄호(법정동, 건물명)는 변경 없음', () => {
  const r = run('권선동, 래미안', '권선동');
  assert.equal(r.building, '래미안');
  assert.deepEqual(r.moved, []);
  assert.equal(r.changed, false);
});

test('법정동만 있으면 변경 없음', () => {
  const r = run('권선동', '권선동');
  assert.equal(r.building, '');
  assert.equal(r.changed, false);
});

test('건물명 키워드에 없는 고유명 1개는 건드리지 않음(오판 방지)', () => {
  // '엔루체'는 BLDG_KW에 없지만 유일한 비법정동 값 → 건물명으로 보고 보존
  const r = run('호매실동, 호매실 엔루체(NLUCE)', '호매실동');
  assert.equal(r.building, '호매실 엔루체(NLUCE)');
  assert.equal(r.changed, false);
});

test('건물명 속 괄호 보존', () => {
  const r = run('제기동, (주)젠터스 에이동', '제기동');
  assert.equal(r.building, '(주)젠터스 에이동');
  assert.equal(r.changed, false);
});

test('콤마로 쪼개진 건물명 조각은 이관하지 않는다 — 이름의 일부다', () => {
  // '보성,유원아파트' = 한 단지 이름. '보성'을 빼내면 건물명 훼손
  const r = run('권선동, 보성,유원아파트', '권선동');
  assert.deepEqual(r.moved, [], `건물명 조각 이관됨: ${JSON.stringify(r.moved)}`);
  assert.equal(r.changed, false);
});

test('특수문자 잔재는 이관', () => {
  const r = run('상동, ◆상동, 상동대우마이빌', '상동');
  assert.equal(r.building, '상동대우마이빌');
  assert.deepEqual(r.moved, ['◆상동']);
});

// ── 보류(원본 보존) ──
test('건물명 후보가 2개 이상이면 보류 — 어느 쪽이 맞는지 알 수 없다', () => {
  const r = run('중동, 태림홈타운, 영안아파트', '중동');
  assert.equal(r.held, true);
  assert.equal(r.changed, false);
});

test('법정동을 확정 못 하면 보류', () => {
  const r = run('장안동, 5층 식당보관', '');
  assert.equal(r.held, true);
  assert.equal(r.changed, false);
});

// ── 이관값 위생 ──
test('1글자 잔재(E)는 이관하지 않고 버림 — 의미 없는 파편', () => {
  const r = run('장안동, E (장안동)', '장안동');
  assert.deepEqual(r.moved, []);
  assert.equal(r.changed, true);
});

test('빈값 방어', () => {
  const r = run('', '장안동');
  assert.equal(r.changed, false);
  assert.deepEqual(r.moved, []);
});
