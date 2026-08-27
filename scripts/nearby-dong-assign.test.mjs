// 인근 동 패턴 배정 회귀 — src/utils/nearbyDongAssign.js (2026-08-27 형 지시)
//
//   왜 잠그나: 배정이 틀리면 그 동 전체가 엉뚱한 기사에게 간다. 그래서 경계를 못 박는다.
//   ①제안만 한다(적용은 담당자가) ②이미 배정된 건은 절대 안 건드린다 ③먼 동은 제안하지 않는다
//   ④동 위치는 중앙값 — 좌표 하나가 튀어도 동이 통째로 끌려가면 안 된다(DS-15 교훈).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  dongCentroids, dongMajorityDriver, suggestNearbyAssignments, applyNearbySuggestions, distanceM,
} from '../src/utils/nearbyDongAssign.js';

const R = (dong, lat, lng, drv) => ({ 행정동: dong, _lat: lat, _lng: lng, _driverId: drv || '' });

describe('동 위치 — 중앙값이라 튄 좌표에 끌려가지 않는다', () => {
  test('좌표 하나가 멀리 튀어도 중앙값은 제자리', () => {
    const c = dongCentroids([R('A', 37.500, 127.000), R('A', 37.501, 127.001), R('A', 38.900, 128.900)]);
    const a = c.get('A');
    assert.ok(Math.abs(a.lat - 37.501) < 0.002, `평균이었으면 크게 밀렸다: ${a.lat}`);
    assert.equal(a.count, 3);
  });
  test('좌표가 하나도 없으면 hasCoord=false — 제안 대상에서 빠진다', () => {
    const c = dongCentroids([{ 행정동: 'B' }]);
    assert.equal(c.get('B').hasCoord, false);
  });
});

describe('동 대표 기사 — 가장 많이 배정된 사람', () => {
  test('다수결', () => {
    const m = dongMajorityDriver([R('A', 37.5, 127, 'd1'), R('A', 37.5, 127, 'd1'), R('A', 37.5, 127, 'd2')]);
    assert.equal(m.get('A').driverId, 'd1');
    assert.equal(m.get('A').count, 2);
  });
  test('아무도 배정 안 된 동은 대표가 없다', () => {
    assert.equal(dongMajorityDriver([R('A', 37.5, 127)]).has('A'), false);
  });
});

describe('제안 — 가장 가까운 배정 동의 기사', () => {
  const recs = [
    R('A', 37.500, 127.000, 'd1'), R('A', 37.501, 127.001, 'd1'),
    R('D', 37.502, 127.002, 'd2'),
    R('B', 37.503, 127.003),          // 미배정 — D 가 더 가깝다
    R('C', 37.900, 127.900),          // 미배정 — 너무 멀다
  ];
  test('가장 가까운 동의 기사를 제안한다', () => {
    const s = suggestNearbyAssignments(recs);
    const b = s.find((x) => x.dong === 'B');
    assert.equal(b.driverId, 'd2');
    assert.equal(b.fromDong, 'D');
    assert.ok(b.distanceM < 300);
  });
  test('★먼 동은 제안하지 않는다 — 끌고 가면 왕복이 늘어난다', () => {
    const s = suggestNearbyAssignments(recs);
    assert.equal(s.some((x) => x.dong === 'C'), false);
  });
  test('임계 거리를 늘리면 그때는 제안된다(값은 상수가 아니라 인자)', () => {
    const s = suggestNearbyAssignments(recs, { maxDistanceM: 200000 });
    assert.equal(s.some((x) => x.dong === 'C'), true);
  });
  test('★일부라도 배정된 동은 건드리지 않는다 — 담당자가 손대는 중일 수 있다', () => {
    const half = [...recs, R('E', 37.5005, 127.0005, 'd1'), R('E', 37.5006, 127.0006)];
    const s = suggestNearbyAssignments(half);
    assert.equal(s.some((x) => x.dong === 'E'), false);
  });
});

describe('적용 — 이미 배정된 건은 절대 안 건드린다', () => {
  test('미배정 건만 채운다', () => {
    const recs = [R('A', 37.5, 127, 'd1'), R('B', 37.5, 127), R('B', 37.5, 127, 'd9')];
    const r = applyNearbySuggestions(recs, [{ dong: 'B', driverId: 'd2' }]);
    assert.equal(r.applied, 1);
    assert.equal(r.records[0]._driverId, 'd1', '다른 동은 그대로');
    assert.equal(r.records[1]._driverId, 'd2', '미배정 건만 채운다');
    assert.equal(r.records[2]._driverId, 'd9', '이미 배정된 건은 유지');
  });
  test('제안이 없으면 아무것도 바뀌지 않는다', () => {
    const recs = [R('A', 37.5, 127)];
    assert.equal(applyNearbySuggestions(recs, []).applied, 0);
  });
});

describe('거리 계산', () => {
  test('같은 점은 0m, 위도 0.001도는 약 111m', () => {
    assert.equal(Math.round(distanceM({ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 })), 0);
    assert.ok(Math.abs(distanceM({ lat: 37.5, lng: 127 }, { lat: 37.501, lng: 127 }) - 111) < 3);
  });
});
