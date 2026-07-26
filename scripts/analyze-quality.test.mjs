// 정제결과 품질 분석 회귀 테스트 — node --test scripts/analyze-quality.test.mjs
//   중복 인물(이름+생년/전화 강키만)·원본 대비 누락·수량 이상. 동명이인 오탐 금지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeQuality } from '../src/analysis/analyzeQuality.js';

// ── 중복 인물 ────────────────────────────────────────────
test('동일인(이름+생년월일) 2건 → 중복 1그룹 count 2', () => {
  const r = analyzeQuality([
    { id: 'a', 이름: '김철수', 생년월일: '19800101', 주소: 'x', 포수: 1 },
    { id: 'b', 이름: '김철수', 생년월일: '19800101', 주소: 'y', 포수: 1 },
    { id: 'c', 이름: '이영희', 생년월일: '19900202', 주소: 'z', 포수: 1 },
  ]);
  assert.equal(r.dupGroups, 1);
  assert.equal(r.dupExtra, 1); // 3건 중 1건이 초과분
  assert.equal(r.duplicates[0].name, '김철수');
  assert.equal(r.duplicates[0].count, 2);
  assert.deepEqual(r.duplicates[0].ids.sort(), ['a', 'b']);
});

test('동명이인(이름 같고 생년·전화 다름) → 중복 아님', () => {
  const r = analyzeQuality([
    { id: 'a', 이름: '김옥순', 생년월일: '19400101', 휴대폰: '010-1111-2222' },
    { id: 'b', 이름: '김옥순', 생년월일: '19550303', 휴대폰: '010-3333-4444' },
  ]);
  assert.equal(r.dupGroups, 0);
});

test('이름만 같고 식별키 전혀 없음 → 중복 판정 제외(약키 금지)', () => {
  const r = analyzeQuality([
    { id: 'a', 이름: '박민수' },
    { id: 'b', 이름: '박민수' },
  ]);
  assert.equal(r.dupGroups, 0);
});

test('교차 키 병합 — 한 건은 생년, 다른 건은 휴대폰으로 연결', () => {
  const r = analyzeQuality([
    { id: 'a', 이름: '최지우', 생년월일: '19700505', 휴대폰: '010-5555-6666' },
    { id: 'b', 이름: '최지우', 휴대폰: '010-5555-6666' }, // 휴대폰으로 a와 동일인
  ]);
  assert.equal(r.dupGroups, 1);
  assert.equal(r.duplicates[0].count, 2);
});

// ── 원본 대비 누락 대조 ──────────────────────────────────
test('원본 신고 대비 누락 — declaredHead 100 vs 실제 97 → headDiff 3', () => {
  const rows = Array.from({ length: 97 }, (_, i) => ({ id: `r${i}`, 이름: `사람${i}`, 생년월일: `1980010${i % 10}`, 포수: 1 }));
  const r = analyzeQuality(rows, { declaredHead: 100, declaredQty: 100 });
  assert.equal(r.shortage.declaredHead, 100);
  assert.equal(r.shortage.actualHead, 97);
  assert.equal(r.shortage.headDiff, 3);
  assert.equal(r.shortage.actualQty, 97);
  assert.equal(r.shortage.qtyDiff, 3);
});

test('원본 신고값 없으면 shortage=null', () => {
  const r = analyzeQuality([{ id: 'a', 이름: '김철수', 생년월일: '19800101', 포수: 1 }]);
  assert.equal(r.shortage, null);
});

// ── 수량 이상 ────────────────────────────────────────────
test('포수 0/과다 → qtyZero·qtyHigh 분리', () => {
  const r = analyzeQuality([
    { id: 'a', 이름: '가', 생년월일: '19800101', 포수: 0 },
    { id: 'b', 이름: '나', 생년월일: '19800102', 포수: 1 },
    { id: 'c', 이름: '다', 생년월일: '19800103', 포수: 15 },
  ]);
  assert.deepEqual(r.qtyZero, ['a']);
  assert.deepEqual(r.qtyHigh, ['c']);
});

// ── 방어 ─────────────────────────────────────────────────
test('빈/비배열 입력 → 안전(0건)', () => {
  const r = analyzeQuality([]);
  assert.equal(r.dupGroups, 0);
  assert.equal(r.shortage, null);
  assert.deepEqual(r.qtyZero, []);
  const r2 = analyzeQuality(null, {});
  assert.equal(r2.dupGroups, 0);
});
