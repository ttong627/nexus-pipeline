// 배정 저장 범위 회귀 — 2026-08-27 점검
//   node --test scripts/assignment-write-scope.test.mjs
//
//   형이 동 카드마다 [저장]을 누르는 흐름에서, 저장이 **배정하지 않은 동의 기사 칸을 지우면 안 된다**.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assignmentWriteDongs } from '../src/utils/assignmentWriteScope.js';

const S = (m, s) => [...assignmentWriteDongs(m, s)].sort();

describe('저장이 건드리는 동', () => {
  test('배정된 동만 쓴다 — 나머지는 손대지 않는다(이 규칙이 없어서 1,140건이 지워졌다)', () => {
    assert.deepEqual(S({ 답십리1동: ['d1'] }, null), ['답십리1동']);
  });

  test('배정이 풀린 동은 지우기 위해 포함한다', () => {
    assert.deepEqual(S({ 답십리1동: ['d1'] }, { 답십리1동: ['d1'], 전농1동: ['d2'] }), ['답십리1동', '전농1동']);
  });

  test('전부 해제해도 옛 배정 동은 정리 대상이다', () => {
    assert.deepEqual(S({}, { 전농1동: ['d2'], 휘경1동: ['d3'] }), ['전농1동', '휘경1동']);
  });

  test('직전 저장을 모르면(첫 저장) 배정된 동만 쓴다 — 모르는 동을 함부로 비우지 않는다', () => {
    assert.deepEqual(S({ 휘경1동: ['d3'] }, null), ['휘경1동']);
  });

  test('빈 배열은 배정이 아니다', () => {
    assert.deepEqual(S({ 전농1동: [], 답십리1동: ['d1'] }, { 휘경1동: [] }), ['답십리1동']);
  });

  test('아무것도 없으면 아무것도 쓰지 않는다(불필요한 쓰기 0)', () => {
    assert.deepEqual(S({}, {}), []);
    assert.deepEqual(S(null, null), []);
  });

  test('같은 동이 양쪽에 있어도 한 번만', () => {
    assert.deepEqual(S({ 전농1동: ['d1'] }, { 전농1동: ['d2'] }), ['전농1동']);
  });
});
