// 지도 저장이 명단에 쓰는 값 회귀 — 2026-08-28
//   node --test scripts/cloud-sync-patch.test.mjs
//
//   사고: 순번을 안 매긴 채 [저장·확정]을 누르면 `배송순번: ''` 가 기존 순번을 전부 지웠다(G-4 위반).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideSyncFields, buildRecordPatch } from '../src/utils/cloudSyncPatch.js';

const R = (o = {}) => ({ _driverId: null, 배송순번: '', ...o });

describe('이번 저장이 다룰 필드', () => {
  test('순번을 한 건도 안 매겼으면 순번은 쓰지 않는다 — 이게 없어서 1,530건이 지워졌다', () => {
    assert.deepEqual(decideSyncFields([R({ _driverId: 'd1' }), R({ _driverId: 'd2' })]),
      { writeDriver: true, writeSeq: false });
  });
  test('순번이 하나라도 있으면 순번을 반영한다(중간에 뺀 것도 반영해야 한다)', () => {
    assert.equal(decideSyncFields([R({ _driverId: 'd1', 배송순번: '3' }), R({ _driverId: 'd1' })]).writeSeq, true);
  });
  test('숫자 순번도 인식한다', () => {
    assert.equal(decideSyncFields([R({ 배송순번: 7 })]).writeSeq, true);
  });
  test('공백만 있는 순번은 매긴 것이 아니다', () => {
    assert.equal(decideSyncFields([R({ 배송순번: '   ' })]).writeSeq, false);
  });
  test('배정이 하나도 없으면 기사도 쓰지 않는다(작업 안 한 것을 지우지 않는다)', () => {
    assert.deepEqual(decideSyncFields([R(), R()]), { writeDriver: false, writeSeq: false });
  });
  test('빈 입력도 안전', () => {
    assert.deepEqual(decideSyncFields(), { writeDriver: false, writeSeq: false });
    assert.deepEqual(decideSyncFields(null), { writeDriver: false, writeSeq: false });
  });
});

describe('레코드 patch', () => {
  const F = (d, s) => ({ writeDriver: d, writeSeq: s });

  test('순번을 안 다루는 저장은 순번 키가 아예 없다(빈값 덮어쓰기 차단)', () => {
    const p = buildRecordPatch(R({ _driverId: 'd1' }), '박진성', F(true, false));
    assert.deepEqual(p, { 기사: '박진성' });
    assert.ok(!('배송순번' in p));
  });

  test('순번을 다루는 저장은 뺀 순번도 반영한다', () => {
    assert.deepEqual(buildRecordPatch(R({ _driverId: 'd1' }), '박진성', F(true, true)),
      { 기사: '박진성', 배송순번: '' });
  });

  test('기사 해제는 반영한다(지도 화면이 기사 칸의 주인)', () => {
    assert.deepEqual(buildRecordPatch(R(), '', F(true, false)), { 기사: '' });
  });

  test('좌표는 값이 있을 때만 쓴다', () => {
    assert.deepEqual(buildRecordPatch(R({ _lat: 37.5, _lng: 127.0 }), '', F(false, false)),
      { lat: 37.5, lng: 127.0 });
    assert.equal(buildRecordPatch(R({ _lat: null }), '', F(false, false)), null);
  });

  test('아파트 표시도 값이 있을 때만', () => {
    assert.deepEqual(buildRecordPatch(R({ _isApt: true }), '', F(false, false)), { isApt: true });
  });

  test('쓸 것이 없으면 null — 헛쓰기 0', () => {
    assert.equal(buildRecordPatch(R(), '', F(false, false)), null);
  });

  test('순번은 문자열로 정규화한다(숫자 7 → "7")', () => {
    assert.equal(buildRecordPatch(R({ 배송순번: 7 }), '', F(false, true)).배송순번, '7');
  });
});
