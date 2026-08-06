/**
 * 배송 브리프 검증 — 적재해둔 데이터를 꺼내 쓸 때 **거짓말하지 않는가**.
 *
 * 이 계층의 실패는 조용하다. 값이 그럴듯하게 나오고, 기사만 현장에서 헤맨다.
 * 그래서 "정보가 없을 때 없다고 말하는가"를 정보가 있을 때만큼 세게 검사한다.
 *
 * 실행: node --test scripts/delivery-brief.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COORD_RANK, STAIR_HEAVY, STAIR_NONE, STAIR_SEVERE, STAIR_UNKNOWN,
  assessStairLabor, buildDeliveryBrief, pickCoordinate,
} from '../src/delivery/deliveryBrief.js';
import { collectCoordinates } from '../src/delivery/resolveDelivery.js';

/* ───────────────── 좌표 서열 ───────────────── */

test('국가 출입구 좌표가 지오코딩 추정치를 이긴다', () => {
  const picked = pickCoordinate([
    { kind: 'kakao', lat: 37.1, lng: 127.1 },
    { kind: 'juso_entrance', lat: 37.2, lng: 127.2 },
    { kind: 'vworld', lat: 37.3, lng: 127.3 },
  ]);
  assert.equal(picked.kind, 'juso_entrance');
  assert.equal(picked.lat, 37.2);
  assert.equal(picked.alternatives, 2);
});

test('출입구가 없으면 VWorld가 카카오보다 앞선다', () => {
  const picked = pickCoordinate([
    { kind: 'kakao', lat: 37.1, lng: 127.1 },
    { kind: 'vworld', lat: 37.3, lng: 127.3 },
  ]);
  assert.equal(picked.kind, 'vworld');
});

test('좌표가 하나도 없으면 null — 아무거나 만들어내지 않는다', () => {
  assert.equal(pickCoordinate([]), null);
  assert.equal(pickCoordinate([{ kind: 'juso_entrance', lat: null, lng: null }]), null);
  assert.equal(pickCoordinate([{ kind: '알수없는출처', lat: 37, lng: 127 }]), null);
});

test('격리된 출입구 좌표는 후보에서 빠진다 — 적재기가 막고 조회가 한 번 더 막는다', () => {
  const quarantined = { lat: 35.57987, lng: 131.33452, coord_status: 'quarantined' };
  assert.deepEqual(collectCoordinates(quarantined, null), []);

  const ok = { lat: 35.5384, lng: 129.3114, coord_status: 'ok' };
  const got = collectCoordinates(ok, { kind: 'kakao', lat: 35.5, lng: 129.3 });
  assert.equal(got.length, 2);
  assert.equal(got[0].kind, 'juso_entrance');
});

test('coord_status가 ok가 아니면 좌표값이 있어도 쓰지 않는다', () => {
  const unverified = { lat: 37.5, lng: 127.0, coord_status: 'unverified' };
  assert.deepEqual(collectCoordinates(unverified, null), []);
});

/* ───────────────── 계단노동: null과 0을 뭉개지 않는다 ───────────────── */

test('승강기 0 = 엘베 없음(확정), null = 모름 — 절대 같지 않다', () => {
  const noElev = assessStairLabor({ elevator_count: 0, ground_floors: 4 });
  assert.equal(noElev.level, STAIR_HEAVY);

  const unknown = assessStairLabor({ elevator_count: null, ground_floors: 4 });
  assert.equal(unknown.level, STAIR_UNKNOWN,
    'null을 0으로 뭉개면 데이터 없는 건물을 전부 "엘베 없음"으로 단정한다');
});

test('계단노동 등급은 층수로 갈린다', () => {
  assert.equal(assessStairLabor({ elevator_count: 0, ground_floors: 6 }).level, STAIR_SEVERE);
  assert.equal(assessStairLabor({ elevator_count: 0, ground_floors: 3 }).level, STAIR_HEAVY);
  assert.equal(assessStairLabor({ elevator_count: 0, ground_floors: 2 }).level, 'light');
  assert.equal(assessStairLabor({ elevator_count: 0, ground_floors: 1 }).level, STAIR_NONE);
  assert.equal(assessStairLabor({ elevator_count: 2, ground_floors: 20 }).level, STAIR_NONE);
});

test('건축물대장이 없으면 unknown — 없는 걸 있다고 하지 않는다', () => {
  assert.equal(assessStairLabor(null).level, STAIR_UNKNOWN);
  assert.equal(assessStairLabor({ elevator_count: 0, ground_floors: null }).level, STAIR_UNKNOWN);
});

/* ───────────────── 브리프: 경고가 실제로 뜨는가 ───────────────── */

test('추정 좌표를 쓰면 추정이라고 말한다', () => {
  const b = buildDeliveryBrief({
    address: { buildingName: '한빛빌라' },
    coord: pickCoordinate([{ kind: 'kakao', lat: 37, lng: 127 }]),
    building: null,
  });
  const codes = b.warnings.map((w) => w.code);
  assert.ok(codes.includes('estimated_coordinate'));
});

test('국가 출입구 좌표면 추정 경고가 없다', () => {
  const b = buildDeliveryBrief({
    address: {},
    coord: pickCoordinate([{ kind: 'juso_entrance', lat: 37, lng: 127 }]),
    building: { elevator_count: 1, ground_floors: 15 },
  });
  assert.equal(b.warnings.filter((w) => w.code === 'estimated_coordinate').length, 0);
});

test('폐지된 주소는 경고한다 — yyplus가 놓쳐 영구 잔존하던 그 케이스', () => {
  const b = buildDeliveryBrief({
    address: {},
    coord: null,
    building: null,
    entrance: { is_retired: true, retired_at: '2026-07-22' },
  });
  const w = b.warnings.find((x) => x.code === 'retired_address');
  assert.ok(w, '폐지 주소를 조용히 넘기면 현장에서 원인을 알 수 없다');
  assert.ok(w.message.includes('2026-07-22'));
});

test('격리된 좌표의 건물은 신뢰하지 말라고 말한다', () => {
  const b = buildDeliveryBrief({
    address: {},
    coord: null,
    building: null,
    entrance: { coord_status: 'quarantined' },
  });
  assert.ok(b.warnings.some((w) => w.code === 'quarantined_coordinate'));
});

test('엘베 없는 고층은 계단노동을 경고한다', () => {
  const b = buildDeliveryBrief({
    address: {},
    coord: pickCoordinate([{ kind: 'juso_entrance', lat: 37, lng: 127 }]),
    building: { elevator_count: 0, ground_floors: 5, household_count: 8 },
  });
  const w = b.warnings.find((x) => x.code === 'stair_labor');
  assert.ok(w);
  assert.equal(b.stair.level, STAIR_SEVERE);
  assert.ok(b.summary.includes('엘베 없음'));
  assert.ok(b.summary.includes('8세대'));
});

test('coverage가 어디까지 실측인지 그대로 드러낸다', () => {
  const none = buildDeliveryBrief({ address: {}, coord: null, building: null, entrance: null });
  assert.deepEqual(none.coverage, { coordinate: null, building: false, entrance: false });
  assert.equal(none.summary, '정보 없음');
  assert.ok(none.warnings.some((w) => w.code === 'no_coordinate'));

  const full = buildDeliveryBrief({
    address: { buildingName: '가나아파트' },
    coord: pickCoordinate([{ kind: 'juso_entrance', lat: 37, lng: 127 }]),
    building: { elevator_count: 2, ground_floors: 15, dong_name: '101' },
    entrance: { is_retired: false, coord_status: 'ok' },
  });
  assert.deepEqual(full.coverage, { coordinate: 'juso_entrance', building: true, entrance: true });
  assert.ok(full.summary.includes('101동'));
});

test('좌표 서열 상수가 설계서 서열과 일치한다(출입구<동도형<VWorld<카카오)', () => {
  assert.ok(COORD_RANK.juso_entrance < COORD_RANK.juso_dong);
  assert.ok(COORD_RANK.juso_dong < COORD_RANK.vworld);
  assert.ok(COORD_RANK.vworld < COORD_RANK.kakao);
});
