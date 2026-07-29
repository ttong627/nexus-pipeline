// 자가학습 위험분류 회귀 테스트 — node --test scripts/classify-correction.test.mjs
//   저위험(자동)/고위험(검토)/거부 게이트. 동명이인·본번불변 안전 픽스처.
//   addressEngine 임포트 금지(순수 Node). 형 규칙: 이름 약키 매칭 영구 금지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCorrection } from '../src/learn/classifyCorrection.js';

// ── noop ────────────────────────────────────────────────
test('before===after → noop (학습 안 함)', () => {
  const r = classifyCorrection({ field: 'address', before: '성남대로 55', after: '성남대로 55' });
  assert.equal(r.type, 'noop');
  assert.equal(r.risk, 'none');
});

test('공백만 다른 것 → noop', () => {
  const r = classifyCorrection({ field: 'name', before: '박옥순 ', after: '박옥순' });
  assert.equal(r.type, 'noop');
});

// ── 이름 오타 (저위험) vs 이름 교체 (고위험, 동명이인) ──────────
test('이름 오타(성 보존·1글자) → typo·low', () => {
  const r = classifyCorrection({ field: 'name', before: '홍길똥', after: '홍길동' });
  assert.equal(r.type, 'typo');
  assert.equal(r.risk, 'low');
  assert.equal(r.ruleKey, 'name:홍길똥');
  assert.deepEqual(r.payload, { wrong: '홍길똥', correct: '홍길동' });
});

test('이름 성(첫글자) 교체 → name_change·high (동명이인 위험, 자동금지)', () => {
  const r = classifyCorrection({ field: 'name', before: '김철수', after: '이영희' });
  assert.equal(r.type, 'name_change');
  assert.equal(r.risk, 'high');
});

test('이름 전면 상이(길이·글자 크게 다름) → name_change·high', () => {
  const r = classifyCorrection({ field: 'name', before: '박옥순', after: '정미경아' });
  assert.equal(r.type, 'name_change');
  assert.equal(r.risk, 'high');
});

// ── 주소 오타 (본번 불변=저위험) vs 본번 변경 (고위험) ─────────
test('도로명 오타·본번 불변 → typo·low', () => {
  const r = classifyCorrection({ field: 'address', before: '테해란로 123', after: '테헤란로 123' });
  assert.equal(r.type, 'typo');
  assert.equal(r.risk, 'low');
});

test('주소 본번 변경 → address_change·high (변조 위험, 검토 필요)', () => {
  const r = classifyCorrection({ field: 'address', before: '테헤란로 123', after: '테헤란로 456' });
  assert.equal(r.type, 'address_change');
  assert.equal(r.risk, 'high');
});

test('주소 본번(하이픈 포함) 변경 → high', () => {
  const r = classifyCorrection({ field: 'address', before: '천호대로 55-3', after: '천호대로 26' });
  assert.equal(r.type, 'address_change');
  assert.equal(r.risk, 'high');
});

test('주소 글자 크게 상이(도로명 자체 교체) → address_change·high', () => {
  const r = classifyCorrection({ field: 'address', before: '성남대로 100', after: '분당로 100' });
  // 본번 같아도 도로명이 완전히 다르면 오타로 볼 수 없음 → 고위험
  assert.equal(r.risk, 'high');
});

// ── 건물명 별칭 (저위험) ──────────────────────────────────
test('건물명 별칭 표준화 → building_alias·low', () => {
  const r = classifyCorrection({ field: 'buildingName', before: '래미안1차', after: '래미안아파트1차' });
  assert.equal(r.type, 'building_alias');
  assert.equal(r.risk, 'low');
  assert.equal(r.ruleKey, 'bldg:래미안1차');
  assert.deepEqual(r.payload, { alias: '래미안1차', canonical: '래미안아파트1차' });
});

// ── 특이사항/배송힌트 이동 (저위험, "이동≠삭제") ──────────────
test('빈 특이사항에 배송힌트 추가 → note_move·low (힌트 축적, 매핑 아님)', () => {
  const r = classifyCorrection({ field: 'note', before: '', after: '계단위집' });
  assert.equal(r.type, 'note_move');
  assert.equal(r.risk, 'low');
  assert.deepEqual(r.payload, { hint: '계단위집' });
});

// ── 특이사항 정규화 매핑 (저위험, before≠after 둘 다 있음 → 재적용 대상) ──
test('특이사항 표기 정규화(before≠after) → note_normalize·low·{wrong,correct}', () => {
  const r = classifyCorrection({ field: 'note', before: '계단위집', after: '계단 위 집' });
  assert.equal(r.type, 'note_normalize');
  assert.equal(r.risk, 'low');
  assert.equal(r.ruleKey, 'note_norm:계단위집');
  assert.deepEqual(r.payload, { wrong: '계단위집', correct: '계단 위 집' });
});

test('특이사항 공백만 다른 것 → noop (학습 안 함)', () => {
  const r = classifyCorrection({ field: 'note', before: '지하 ', after: '지하' });
  assert.equal(r.type, 'noop');
  assert.equal(r.risk, 'none');
});

test('특이사항 삭제(after 빈값) → note_move 유지·힌트 없음', () => {
  const r = classifyCorrection({ field: 'note', before: '오타내용', after: '' });
  assert.equal(r.type, 'note_move');
  assert.equal(r.risk, 'low');
  assert.deepEqual(r.payload, { hint: '' });
});

// ── 컬럼 매핑 (저위험) ────────────────────────────────────
test('컬럼 헤더 매핑 학습 → column_map·low', () => {
  const r = classifyCorrection({ field: 'column', before: '수령자명', after: 'name' });
  assert.equal(r.type, 'column_map');
  assert.equal(r.risk, 'low');
  assert.equal(r.ruleKey, 'col:name:수령자명');
});

// ── 방어: 알 수 없는 필드 → reject (자동/검토 어디에도 안 넣음) ──
test('미지원 필드 → reject', () => {
  const r = classifyCorrection({ field: 'phone', before: '010-1', after: '010-2' });
  assert.equal(r.risk, 'reject');
});
