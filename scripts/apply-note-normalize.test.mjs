// 특이사항 재적용(정규화) 회귀 테스트 — node --test scripts/apply-note-normalize.test.mjs
//   형 규칙: 완전일치 치환만(부분매칭 오적용 영구 금지). 특이사항 필드만 개입(주소·좌표 무영향).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNoteNormalize } from '../src/learn/applyNoteNormalize.js';

const dict = { '계단위집': '계단 위 집', '빨간대문집': '빨간 대문 집' };

test('완전일치 → 표준값으로 치환', () => {
  assert.equal(applyNoteNormalize('계단위집', dict), '계단 위 집');
});

test('dict에 없음 → 원본 유지', () => {
  assert.equal(applyNoteNormalize('파란대문집', dict), '파란대문집');
});

test('부분일치(dict 키가 특이사항의 일부) → 치환 안 함 (오적용 차단)', () => {
  // "계단위집 옆동"은 키 "계단위집"을 포함하지만 전체가 아니므로 치환 금지
  assert.equal(applyNoteNormalize('계단위집 옆동', dict), '계단위집 옆동');
});

test('앞뒤 공백 있는 특이사항 → 트림 후 완전일치면 치환', () => {
  assert.equal(applyNoteNormalize('  계단위집  ', dict), '계단 위 집');
});

test('빈 특이사항 → 빈 문자열 유지', () => {
  assert.equal(applyNoteNormalize('', dict), '');
});

test('빈/누락 dict → 원본 안전 반환', () => {
  assert.equal(applyNoteNormalize('계단위집', {}), '계단위집');
  assert.equal(applyNoteNormalize('계단위집', null), '계단위집');
  assert.equal(applyNoteNormalize('계단위집', undefined), '계단위집');
});

test('null/undefined 특이사항 → 빈 문자열', () => {
  assert.equal(applyNoteNormalize(null, dict), '');
  assert.equal(applyNoteNormalize(undefined, dict), '');
});

test('매핑값이 비정상(빈값) → 원본 유지 (특이사항 삭제 방지)', () => {
  assert.equal(applyNoteNormalize('계단위집', { '계단위집': '' }), '계단위집');
});
