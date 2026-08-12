// ══════════════════════════════════════════════════════════════════
//  공유 문서 구조 회귀 — src/utils/shareDoc.js (2026-08-13 · Phase 1)
//
//  ★막는 것 1: 부모 문서에 배송건이 다시 들어가는 것.
//     배열은 부분 권한을 줄 수 없다 — 읽히면 1,524건이 통째로 새어나간다.
//  ★막는 것 2: 번호 없는 기사의 배송건이 조용히 사라지는 것.
//     그 집은 배송을 못 받는다. 보안을 조이다 배송을 빠뜨리면 그게 더 큰 사고다.
//  ★막는 것 3: 갱신이 마감일을 넘는 것(형 확정 C).
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chunk, mapDriverPhones, buildShareRecords, buildShareMeta, renewedExpiry, BATCH_LIMIT,
} from '../src/utils/shareDoc.js';

const ROSTER = [
  { id: 'r1', name: '홍길동', phone: '010-1234-5678', active: true },
  { id: 'r2', name: '김철수', phone: '+821023456789', active: true },
  { id: 'r3', name: '퇴사자', phone: '010-9999-8888', active: false },
];
const DRIVERS = [
  { id: 'd1', name: '홍길동', color: '#f00' },
  { id: 'd2', name: '김철수', color: '#0f0' },
  { id: 'd3', name: '미등록기사', color: '#00f' },
];
const REC = (id, driverId, extra = {}) => ({
  id, _driverId: driverId, 이름: `대상${id}`, 주소: `주소${id}`,
  _lat: 37.5, _lng: 127.0, 배송순번: 1, 포수: 2, 휴대폰: '010-0000-0000', ...extra,
});

// ── ① 부모 문서에 배송건이 없어야 한다 ────────────────────────────
test('★부모 문서에 records 가 없다 — 배열이면 통째로 새어나간다', () => {
  const meta = buildShareMeta({ city: '서울특별시 동대문구', monthId: '2026-07', drivers: DRIVERS, roster: ROSTER });
  assert.equal('records' in meta, false, '부모에 배송건을 다시 넣으면 안 된다');
  assert.equal(meta.city, '서울특별시 동대문구');
  assert.deepEqual(meta.drivers.map((d) => d.name), ['홍길동', '김철수', '미등록기사']);
});

test('부모에는 활성 기사 번호만 정규화해 담는다(읽기 권한 판정용)', () => {
  const meta = buildShareMeta({ drivers: DRIVERS, roster: ROSTER });
  assert.deepEqual(meta.driverPhones, ['+821012345678', '+821023456789'], '퇴사자 번호가 들어가면 안 된다');
});

// ── ② 건별 문서 ───────────────────────────────────────────────────
test('★배송건마다 소유 기사 번호가 붙는다 — 규칙이 이 값으로 거른다', () => {
  const { docs } = buildShareRecords([REC('a', 'd1'), REC('b', 'd2')], DRIVERS, ROSTER);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].driverPhone, '+821012345678');
  assert.equal(docs[1].driverPhone, '+821023456789');
});

test('기사 미배정 건은 아예 만들지 않는다', () => {
  const { docs } = buildShareRecords([REC('a', 'd1'), { id: 'x', 이름: '미배정' }], DRIVERS, ROSTER);
  assert.equal(docs.length, 1);
});

test('★번호를 못 찾은 건은 조용히 빠지지 않고 unassigned 로 드러난다', () => {
  const { docs, unassigned } = buildShareRecords([REC('a', 'd1'), REC('b', 'd3')], DRIVERS, ROSTER);
  assert.equal(docs.length, 2, '건 자체는 만든다 — 없애면 배송이 누락된다');
  assert.equal(docs[1].driverPhone, '', '번호를 지어내지 않는다');
  assert.equal(unassigned.length, 1);
  assert.equal(unassigned[0].id, 'b', '담당자가 누구를 고쳐야 하는지 알아야 한다');
});

test('필드가 그대로 넘어간다 — 기사 화면이 쓰던 값이 사라지면 퇴행이다', () => {
  const { docs } = buildShareRecords([REC('a', 'd1', { 특이사항: '문앞', 행정동: '전농1동' })], DRIVERS, ROSTER);
  const d = docs[0];
  assert.equal(d.이름, '대상a');
  assert.equal(d.주소, '주소a');
  assert.equal(d.행정동, '전농1동');
  assert.equal(d.특이사항, '문앞');
  assert.equal(d.포수, 2);
  assert.equal(d.lat, 37.5);
});

// ── ③ 이름 매칭의 한계 ────────────────────────────────────────────
test('★명부에 동명이인이 있으면 번호를 붙이지 않는다 — 찍으면 남의 배송을 준다', () => {
  const roster = [...ROSTER, { id: 'r9', name: '홍길동', phone: '010-7777-6666', active: true }];
  const map = mapDriverPhones(DRIVERS, roster);
  assert.equal(map.d1, '', '동명이인이면 비운다');
  assert.equal(map.d2, '+821023456789', '겹치지 않는 기사는 그대로');
});

test('비활성 기사는 명부 매칭에서 빠진다', () => {
  const map = mapDriverPhones([{ id: 'dx', name: '퇴사자' }], ROSTER);
  assert.equal(map.dx, '');
});

// ── ③-b org_drivers 실제 형태 (id 우선 매칭) ──────────────────────
// 소속사 피커로 고른 기사는 화면 id 가 곧 org_drivers 문서 id 다 → 이름이 겹쳐도 정확히 맞는다.
const ORG_ROSTER = [
  { id: 'od1', name: '홍길동', phone: '010-1234-5678', phoneE164: '+821012345678', status: 'active' },
  { id: 'od2', name: '홍길동', phone: '010-7777-6666', phoneE164: '+821077776666', status: 'active' },
  { id: 'od3', name: '퇴사', phone: '010-1111-2222', phoneE164: '+821011112222', status: 'inactive' },
];

test('★id 로 맞추면 동명이인이어도 정확히 고른다', () => {
  const map = mapDriverPhones([{ id: 'od1', name: '홍길동' }, { id: 'od2', name: '홍길동' }], ORG_ROSTER);
  assert.equal(map.od1, '+821012345678');
  assert.equal(map.od2, '+821077776666', '이름만 봤으면 둘 다 비었을 것이다');
});

test('id 가 없으면 이름으로 폴백하되, 동명이인이면 비운다', () => {
  const map = mapDriverPhones([{ id: 'manual1', name: '홍길동' }], ORG_ROSTER);
  assert.equal(map.manual1, '', '직접 입력 기사 + 동명이인이면 찍지 않는다');
});

test('org_drivers 의 status:inactive 도 비활성으로 본다', () => {
  const map = mapDriverPhones([{ id: 'od3', name: '퇴사' }], ORG_ROSTER);
  assert.equal(map.od3, '');
});

test('★저장된 phoneE164 를 우선 쓴다 — 백필된 정규화 결과가 정본이다', () => {
  const roster = [{ id: 'od9', name: '김', phone: '엉망', phoneE164: '+821012341234', status: 'active' }];
  assert.equal(mapDriverPhones([{ id: 'od9', name: '김' }], roster).od9, '+821012341234');
});

test('phoneE164 가 없어도 원문에서 뽑는다 — 백필 전 문서도 동작해야 한다', () => {
  const roster = [{ id: 'od8', name: '박', phone: '010-5555-4444', status: 'active' }];
  assert.equal(mapDriverPhones([{ id: 'od8', name: '박' }], roster).od8, '+821055554444');
});

// ── ④ 배치 ────────────────────────────────────────────────────────
test('배치 상한으로 자른다 — 1,524건이면 4배치', () => {
  const parts = chunk(Array.from({ length: 1524 }, (_, i) => i));
  assert.equal(parts.length, 4);
  assert.equal(parts[0].length, BATCH_LIMIT);
  assert.equal(parts.reduce((s, p) => s + p.length, 0), 1524, '한 건도 잃으면 안 된다');
});

test('빈 목록·이상 입력에도 죽지 않는다', () => {
  assert.deepEqual(chunk([]), []);
  assert.deepEqual(chunk(null), []);
  assert.deepEqual(buildShareRecords(null, null, null).docs, []);
});

// ── ⑤ 마감일 상한 (형 확정 C) ─────────────────────────────────────
const NOW = new Date('2026-08-13T00:00:00Z');

test('마감이 없으면 기본 기간(7일)만큼', () => {
  const meta = buildShareMeta({ now: NOW, ttlDays: 7 });
  assert.equal(meta.expiresAt.toISOString(), '2026-08-20T00:00:00.000Z');
});

test('★마감이 기본기간보다 이르면 마감이 만료다', () => {
  const meta = buildShareMeta({ now: NOW, ttlDays: 7, deadline: new Date('2026-08-18T14:59:59Z') });
  assert.equal(meta.expiresAt.toISOString(), '2026-08-18T14:59:59.000Z');
});

test('★접속 갱신은 마감일을 절대 넘지 않는다 — 무한연장 차단', () => {
  const dl = new Date('2026-08-18T14:59:59Z');
  // 마감 3일 전에 접속 → 7일 연장을 원해도 마감에서 멈춘다
  const r = renewedExpiry({ now: new Date('2026-08-15T00:00:00Z'), deadline: dl, ttlDays: 7 });
  assert.equal(r.toISOString(), dl.toISOString());
});

test('마감까지 여유가 있으면 기간만큼 늘어난다', () => {
  const r = renewedExpiry({ now: NOW, deadline: new Date('2026-09-30T00:00:00Z'), ttlDays: 7 });
  assert.equal(r.toISOString(), '2026-08-20T00:00:00.000Z');
});

test('마감이 없으면 기간만큼(마감 미지정 공유)', () => {
  const r = renewedExpiry({ now: NOW, ttlDays: 7 });
  assert.equal(r.toISOString(), '2026-08-20T00:00:00.000Z');
});
