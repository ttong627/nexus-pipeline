// ══════════════════════════════════════════════════════════════════
//  기사 화면 파생 회귀 — src/utils/shareRecordsView.js (2026-08-13)
//
//  ★이 회귀는 **이관 전에 현재 동작을 못 박기 위한 것**이다(계획 Phase 1 읽기측).
//    `shareData.records` 배열 → 서브컬렉션으로 출처를 바꿀 때, 순번 배지·지도 경로·
//    다음 배송지가 조용히 달라지면 기사가 엉뚱한 순서로 돈다.
//    바뀌어도 되는 것은 **데이터를 어디서 얻느냐**뿐이고, 아래 계산은 그대로여야 한다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDriverRecords, recordUid, totalQtyOf } from '../src/utils/shareRecordsView.js';

const R = (id, o = {}) => ({ id, driverId: 'd1', 이름: `대상${id}`, 주소: `주소${id}`, lat: 37.5, lng: 127.0, 포수: 1, ...o });

// ── ① 식별자 ──────────────────────────────────────────────────────
test('id 가 있으면 그것이 식별자', () => {
  assert.equal(recordUid({ id: 'abc' }), 'abc');
});

test('★id 가 없어도 화면이 죽지 않는다 — 폴백 키에 이름을 쓰지 않는다', () => {
  // 이 키는 부모 공유 문서의 `completions.{uid}` 필드명이 된다 —
  // 예전 폴백 `${이름}_${순번}` 은 **수령자 이름을 문서 키에 박았다**(2026-08-23 점검).
  assert.equal(recordUid({ 이름: '홍길동', 배송순번: 3 }, 0), '_idx0');
  assert.equal(recordUid({}, 7), '_idx7');
  assert.equal(recordUid({ id: 'abc' }, 2), 'abc');
});

// ── ② 기사별 필터 ────────────────────────────────────────────────
test('driverId 를 주면 그 기사 것만 남는다(옛 배열 구조 호환)', () => {
  const { all } = deriveDriverRecords([R('a'), R('b', { driverId: 'd2' })], { driverId: 'd1' });
  assert.deepEqual(all.map((r) => r.id), ['a']);
});

test('★driverId 를 안 주면 그대로 쓴다 — 서브컬렉션은 이미 걸러져 온다', () => {
  const { all } = deriveDriverRecords([R('a'), R('b', { driverId: 'd2' })], {});
  assert.equal(all.length, 2, '이관 후에는 규칙이 이미 걸렀으므로 다시 거르지 않는다');
});

// ── ③ 순번 발행 여부 (제일 민감) ─────────────────────────────────
test('★순번 미발행이면 번호 배지를 달지 않는다 — 없는 순번대로 돌면 안 된다', () => {
  const { all, hasOrder } = deriveDriverRecords([R('a'), R('b')], {});
  assert.equal(hasOrder, false);
  assert.deepEqual(all.map((r) => r._displaySeq), [null, null]);
});

test('저장된 배송순번이 있으면 발행된 것으로 본다', () => {
  const { hasOrder, all } = deriveDriverRecords([R('a', { 배송순번: 2 }), R('b', { 배송순번: 1 })], {});
  assert.equal(hasOrder, true);
  assert.deepEqual(all.map((r) => r.id), ['b', 'a'], '배송순번 오름차순');
  assert.deepEqual(all.map((r) => r._displaySeq), [1, 2]);
});

test('★발행된 orderIds 가 배송순번보다 우선한다 — 담당자 발행/기사 편집이 정답', () => {
  const { all } = deriveDriverRecords(
    [R('a', { 배송순번: 1 }), R('b', { 배송순번: 2 }), R('c', { 배송순번: 3 })],
    { orderIds: ['c', 'a'] },
  );
  assert.deepEqual(all.map((r) => r.id), ['c', 'a', 'b'], 'orderIds 에 없는 건은 배송순번으로 뒤에');
  assert.deepEqual(all.map((r) => r._displaySeq), [1, 2, 3]);
});

test('orderIds 만 있고 배송순번이 없어도 발행으로 본다', () => {
  const { hasOrder } = deriveDriverRecords([R('a'), R('b')], { orderIds: ['b', 'a'] });
  assert.equal(hasOrder, true);
});

test('배송순번이 없는 건은 뒤로 밀리되 사라지지 않는다', () => {
  const { all } = deriveDriverRecords([R('a'), R('b', { 배송순번: 1 })], {});
  assert.deepEqual(all.map((r) => r.id), ['b', 'a']);
  assert.equal(all.length, 2, '한 건도 잃으면 그 집이 배송에서 빠진다');
});

// ── ④ 지도 대상 ──────────────────────────────────────────────────
test('★좌표 없는 건은 지도에서만 빠지고 목록에는 남는다', () => {
  const { all, map } = deriveDriverRecords([R('a'), R('b', { lat: null, lng: null })], {});
  assert.equal(all.length, 2, '목록에서 빼면 그 집이 사라진다');
  assert.deepEqual(map.map((r) => r.id), ['a']);
});

// ── ⑤ 물량 ───────────────────────────────────────────────────────
test('포수가 비면 1로 센다 — 0으로 세면 물량이 줄어 보인다', () => {
  assert.equal(totalQtyOf([R('a', { 포수: 3 }), R('b', { 포수: null }), R('c', { 포수: '2' })]), 6);
});

// ── ⑥ 방어 ───────────────────────────────────────────────────────
test('이상 입력에도 죽지 않는다', () => {
  assert.deepEqual(deriveDriverRecords(null, {}).all, []);
  assert.deepEqual(deriveDriverRecords(undefined).all, []);
  assert.deepEqual(deriveDriverRecords([null, undefined], {}).all, []);
  assert.equal(totalQtyOf(null), 0);
});

test('원본 배열을 건드리지 않는다 — 정렬이 호출부 상태를 흔들면 안 된다', () => {
  const src = [R('a', { 배송순번: 2 }), R('b', { 배송순번: 1 })];
  deriveDriverRecords(src, {});
  assert.deepEqual(src.map((r) => r.id), ['a', 'b'], '입력 배열이 제자리 정렬되면 안 된다');
});
