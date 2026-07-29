// 표기변이 정규화 완전일치 회귀 테스트 — node --test scripts/normalize-variant.test.mjs
//   형 규칙: 부분매칭 아님(공백·기호 제거 후 '전체' 완전일치). 정규화 키 충돌 시 미적용(오적용 차단).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVariantKey, buildVariantIndex, applyVariant } from '../src/learn/normalizeVariant.js';

// ── normalizeVariantKey ─────────────────────────────────
test('공백·기호 제거(문자·숫자 보존)', () => {
  assert.equal(normalizeVariantKey('계단 위 집'), '계단위집');
  assert.equal(normalizeVariantKey('빨간대문(2층)'), '빨간대문2층');
  assert.equal(normalizeVariantKey('가-1 동'), '가1동');
  assert.equal(normalizeVariantKey('  지하 '), '지하');
  assert.equal(normalizeVariantKey(''), '');
  assert.equal(normalizeVariantKey(null), '');
});

// ── buildVariantIndex ───────────────────────────────────
test('정규화 인덱스 구축 — 유일 키만', () => {
  const idx = buildVariantIndex({ '계단 위 집': '계단위집표준', '지하': '지하층' });
  assert.equal(idx['계단위집'], '계단위집표준');
  assert.equal(idx['지하'], '지하층');
});

test('정규화 키 충돌(다른 정답) → 그 키 배제(오적용 차단)', () => {
  const idx = buildVariantIndex({ 'A B': 'X', 'AB': 'Y' }); // 둘 다 nk 'AB'인데 정답 다름
  assert.equal('AB' in idx, false);
});

test('정규화 키 충돌이라도 정답 같으면 유지', () => {
  const idx = buildVariantIndex({ 'A B': 'Z', 'AB': 'Z' });
  assert.equal(idx['AB'], 'Z');
});

test('빈 정답/빈 dict → 안전', () => {
  assert.deepEqual(buildVariantIndex({ 'x': '' }), {});
  assert.deepEqual(buildVariantIndex(null), {});
});

// ── applyVariant ────────────────────────────────────────
const dict = { '계단 위 집': '계단위집표준' };
const idx = buildVariantIndex(dict);

test('원본 완전일치 우선', () => {
  const d2 = { '지하': '지하층' };
  assert.equal(applyVariant('지하', d2, buildVariantIndex(d2)), '지하층');
});

test('표기변이(공백 다름) → 정규화 완전일치 폴백으로 흡수', () => {
  assert.equal(applyVariant('계단위집', dict, idx), '계단위집표준'); // 공백 없이 입력
  assert.equal(applyVariant('계단  위  집', dict, idx), '계단위집표준');
});

test('부분불일치(정규화해도 다름) → 치환 안 함 (오적용 차단)', () => {
  assert.equal(applyVariant('계단위집 옆동', dict, idx), '계단위집 옆동');
  assert.equal(applyVariant('계단', dict, idx), '계단');
});

test('빈/누락 입력·사전 → 원본 안전 반환', () => {
  assert.equal(applyVariant('', dict, idx), '');
  assert.equal(applyVariant(null, dict, idx), '');
  assert.equal(applyVariant('계단위집', null, null), '계단위집');
});
