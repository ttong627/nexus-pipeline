// 학습 후보 문서 빌더 회귀 테스트 — node --test scripts/build-candidate.test.mjs
//   classifyCorrection 결과 → learn_candidates 문서. 저위험=auto, 고위험=pending.
//   firestore 비의존 순수 로직만 검증.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCorrection } from '../src/learn/classifyCorrection.js';
import { buildCandidate } from '../src/learn/buildCandidate.js';

test('저위험(주소 오타) → status auto, ruleKey로 dedup', () => {
  const cls = classifyCorrection({ field: 'address', before: '테해란로 123', after: '테헤란로 123' });
  const cand = buildCandidate(cls, {
    field: 'address', before: '테해란로 123', after: '테헤란로 123',
    context: { cityLabel: '수원시', month: '2026-07' }, uid: 'u1',
  });
  assert.equal(cand.status, 'auto');
  assert.equal(cand.risk, 'low');
  assert.equal(cand.type, 'typo');
  assert.equal(cand.dedupById, true);
  assert.equal(cand.ruleKey, 'addr:테해란로 123');
  assert.equal(cand.city, '수원시');
  assert.equal(cand.month, '2026-07');
  assert.equal(cand.uid, 'u1');
});

test('고위험(이름 교체) → status pending, ruleKey 없어 dedup 안 함', () => {
  const cls = classifyCorrection({ field: 'name', before: '김철수', after: '이영희' });
  const cand = buildCandidate(cls, { field: 'name', before: '김철수', after: '이영희', context: {}, uid: 'u2' });
  assert.equal(cand.status, 'pending');
  assert.equal(cand.risk, 'high');
  assert.equal(cand.type, 'name_change');
  assert.equal(cand.dedupById, false);
  assert.equal(cand.ruleKey, null);
});

test('건물명 별칭(저위험) → auto + payload 보존', () => {
  const cls = classifyCorrection({ field: 'buildingName', before: '래미안1차', after: '래미안아파트1차' });
  const cand = buildCandidate(cls, { field: 'buildingName', before: '래미안1차', after: '래미안아파트1차' });
  assert.equal(cand.status, 'auto');
  assert.deepEqual(cand.payload, { alias: '래미안1차', canonical: '래미안아파트1차' });
});

test('변경 없음(noop) → null (기록 안 함)', () => {
  const cls = classifyCorrection({ field: 'address', before: '성남대로 55', after: '성남대로 55' });
  assert.equal(buildCandidate(cls, { field: 'address', before: '성남대로 55', after: '성남대로 55' }), null);
});

test('거부(미지원 필드) → null', () => {
  const cls = classifyCorrection({ field: 'phone', before: '010-1', after: '010-2' });
  assert.equal(buildCandidate(cls, { field: 'phone', before: '010-1', after: '010-2' }), null);
});

test('meta 누락 시에도 안전(빈 문자열 폴백)', () => {
  const cls = classifyCorrection({ field: 'note', before: '', after: '계단위집' });
  const cand = buildCandidate(cls, { field: 'note', before: '', after: '계단위집' });
  assert.equal(cand.city, '');
  assert.equal(cand.month, '');
  assert.equal(cand.uid, '');
});
