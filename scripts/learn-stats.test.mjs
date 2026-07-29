// 자가학습 집계(측정 대시보드) 회귀 테스트 — node --test scripts/learn-stats.test.mjs
//   learn_candidates 배열 → 유형별·위험별·필드별 집계. 순수함수(firestore 비의존).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCandidates } from '../src/analysis/learnStats.js';

test('빈 배열 → 0 집계(안전)', () => {
  const s = summarizeCandidates([]);
  assert.equal(s.total, 0);
  assert.deepEqual(s.byType, {});
  assert.deepEqual(s.byField, {});
  assert.deepEqual(s.byRisk, { low: 0, high: 0 });
  assert.equal(s.autoCount, 0);
  assert.equal(s.reviewCount, 0);
});

test('누락/비배열 입력 → 빈 집계(방어)', () => {
  assert.equal(summarizeCandidates().total, 0);
  assert.equal(summarizeCandidates(null).total, 0);
  assert.equal(summarizeCandidates('x').total, 0);
});

test('혼합 후보 → 유형·위험·필드별 정확 집계', () => {
  const cands = [
    { type: 'typo', risk: 'low', field: 'address' },
    { type: 'typo', risk: 'low', field: 'name' },
    { type: 'name_change', risk: 'high', field: 'name' },
    { type: 'building_alias', risk: 'low', field: 'buildingName' },
    { type: 'note_normalize', risk: 'low', field: 'note' },
    { type: 'address_change', risk: 'high', field: 'address' },
  ];
  const s = summarizeCandidates(cands);
  assert.equal(s.total, 6);
  assert.deepEqual(s.byRisk, { low: 4, high: 2 });
  assert.equal(s.autoCount, 4);   // 저위험 자동
  assert.equal(s.reviewCount, 2); // 고위험 검토
  assert.equal(s.byType.typo, 2);
  assert.equal(s.byType.name_change, 1);
  assert.equal(s.byType.note_normalize, 1);
  assert.equal(s.byField.address, 2);
  assert.equal(s.byField.name, 2);
  assert.equal(s.byField.note, 1);
});

test('type/field 누락 항목 → unknown으로 집계(유실 방지)', () => {
  const s = summarizeCandidates([{ risk: 'low' }, { risk: 'high', type: 'typo' }]);
  assert.equal(s.total, 2);
  assert.equal(s.byType.unknown, 1);
  assert.equal(s.byField.unknown, 2);
  assert.equal(s.byType.typo, 1);
});
