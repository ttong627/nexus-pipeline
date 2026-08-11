// ══════════════════════════════════════════════════════════════════
//  C-6 ⑥ 좌표 이상치 검증 회귀 — 설계서 좌표관리_설계.md §3-5·F5
//
//  ★이 파일이 지키는 첫 번째 것은 **오판 차단**이다. 이상치 표시가 붙은 좌표는
//    순번 엔진이 좌표 없음으로 취급한다(F5). 잘못 붙으면 정상 배송지가 배송에서
//    빠진다 — 좌표가 틀린 것보다 나쁠 수 있다.
//
//  ★두 번째는 **좌표를 지우지 않는다**는 계약이다(형 지시·DS-15). 판정은 표본에 따라
//    달라지지만, 원본이 남아 있으면 되돌릴 수 있다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coordPoint, groupBySigungu, planOutlierMarks, OUTLIER_MIN_SAMPLE, OUTLIER_RADIUS_KM,
} from '../src/coords/coordOutlier.js';

/** 시흥시 정상 범위(37.38, 126.80 부근)에 흩어진 건물 한 채. */
const row = (n, { sigungu = '시흥시', lat = 37.38, lng = 126.80, quality = 'unverified', entrance = null } = {}) => ({
  coord_key: `41390${String(n).padStart(7, '0')}#0#${n}-0`,
  road_address: `정왕대로 ${n}`,
  sigungu,
  quality,
  entrance_lat: entrance?.lat ?? null,
  entrance_lng: entrance?.lng ?? null,
  center_lat: lat,
  center_lng: lng,
});

/** 정상 무리 — 중앙값 중심을 안정시킬 만큼 충분한 표본. */
const normalCluster = (count = OUTLIER_MIN_SAMPLE, opts = {}) => Array.from({ length: count }, (_, i) => row(i + 1, {
  ...opts,
  lat: 37.38 + i * 0.0005,
  lng: 126.80 + i * 0.0005,
}));

// ── ① 대표점 선택 ────────────────────────────────────────────────
test('입구 좌표가 있으면 그것으로 검증한다 — 기사에게 실제로 주는 점이 그것이다', () => {
  const r = row(1, { entrance: { lat: 37.40, lng: 126.82 } });
  assert.deepEqual(coordPoint(r), { lat: 37.40, lng: 126.82 });
});

test('입구가 없으면 중심 좌표를 쓴다', () => {
  assert.deepEqual(coordPoint(row(1, { lat: 37.38, lng: 126.80 })), { lat: 37.38, lng: 126.80 });
});

test('좌표가 없는 행은 검증 대상이 아니다 — quality=none 은 이상치가 아니라 미보유다', () => {
  assert.equal(coordPoint({ coord_key: 'x', center_lat: null, center_lng: null }), null);
  assert.equal(coordPoint(null), null);
});

// ── ② 그룹핑 ─────────────────────────────────────────────────────
test('★시군구가 비면 판정에서 뺀다 — 전국을 한 덩어리로 묶으면 서울과 부산이 서로를 이상치로 만든다', () => {
  const groups = groupBySigungu([row(1), row(2, { sigungu: '' }), row(3, { sigungu: '   ' })]);
  assert.equal(groups.size, 1);
  assert.equal(groups.get('시흥시').length, 1);
});

test('시군구별로 나눈다 — 중앙값 중심은 같은 지자체 안에서만 의미가 있다', () => {
  const groups = groupBySigungu([row(1), row(2), row(3, { sigungu: '부천시' })]);
  assert.deepEqual([...groups.keys()].sort(), ['부천시', '시흥시']);
});

// ── ③ ★오판 차단 (이 스킬의 존재 이유) ───────────────────────────
test('★표본이 적으면 판정하지 않는다 — 3건짜리 지자체는 그 3건 위치가 중심이 돼 버린다', () => {
  const rows = [row(1), row(2), row(3), row(4, { lat: 37.38, lng: 129.00 })];
  const { marks, groups } = planOutlierMarks(rows);
  assert.equal(marks.length, 0, '표본 부족이면 아무것도 표시하지 않아야 한다');
  assert.equal(groups[0].skipped, 'minSample');
});

test('★표본이 충분하면 멀리 튄 좌표를 잡는다 — 194km 밖', () => {
  const rows = [...normalCluster(), row(99, { lat: 37.38, lng: 129.00 })];
  const { marks } = planOutlierMarks(rows);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].coordKey, row(99).coord_key);
  assert.ok(marks[0].distanceKm > 25, `실제 거리 ${marks[0].distanceKm}km`);
});

test('정상 무리는 하나도 표시하지 않는다 — 같은 동네 안의 편차는 이상치가 아니다', () => {
  const { marks } = planOutlierMarks(normalCluster(30));
  assert.equal(marks.length, 0);
});

test('경계 안쪽(기준 25km 이내)은 표시하지 않는다', () => {
  // 위도 0.1도 ≈ 11km — 기준 안쪽이다
  const rows = [...normalCluster(), row(99, { lat: 37.48, lng: 126.80 })];
  assert.equal(planOutlierMarks(rows).marks.length, 0);
});

// ── ④ 중복 표시·해제 정책 ────────────────────────────────────────
test('★이미 outlier 인 행은 다시 쓰지 않는다 — 매일 updated_at 을 밀면 채움 배치의 순서가 무너진다', () => {
  const rows = [...normalCluster(), row(99, { lat: 37.38, lng: 129.00, quality: 'outlier' })];
  const { marks } = planOutlierMarks(rows);
  assert.equal(marks.length, 0);
});

test('이미 outlier 인데 이번 판정은 정상이면 해제후보로만 보고한다 — 자동으로 풀지 않는다', () => {
  const rows = normalCluster();
  rows[0] = { ...rows[0], quality: 'outlier' };
  const { marks, stale } = planOutlierMarks(rows);
  assert.equal(marks.length, 0);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].coordKey, rows[0].coord_key);
});

// ── ⑤ ★좌표 보존 계약 ────────────────────────────────────────────
test('★표시 계획에 좌표가 들어 있지 않다 — 이 단계는 좌표를 만지지 않는다(DS-15)', () => {
  const rows = [...normalCluster(), row(99, { lat: 37.38, lng: 129.00 })];
  const [mark] = planOutlierMarks(rows).marks;
  for (const banned of ['lat', 'lng', 'centerLat', 'centerLng', 'entranceLat', 'entranceLng']) {
    assert.equal(banned in mark, false, `${banned} 가 표시 계획에 있으면 좌표를 덮어쓸 수 있다`);
  }
  assert.deepEqual(Object.keys(mark).sort(), ['coordKey', 'distanceKm', 'note', 'roadAddress', 'sigungu']);
});

test('표시 사유에 근거(거리·기준·표본·중심)를 남긴다 — 사람이 판단하려면 숫자가 있어야 한다', () => {
  const rows = [...normalCluster(), row(99, { lat: 37.38, lng: 129.00 })];
  const [mark] = planOutlierMarks(rows).marks;
  assert.match(mark.note, /km/);
  assert.match(mark.note, /기준 25km/);
  assert.match(mark.note, /표본 \d+/);
});

// ── ⑥ 다중 지자체 ────────────────────────────────────────────────
test('한 지자체의 이상치가 다른 지자체 판정을 오염시키지 않는다', () => {
  const sihueng = [...normalCluster(), row(98, { lat: 37.38, lng: 129.00 })];
  const bucheon = normalCluster(OUTLIER_MIN_SAMPLE, { sigungu: '부천시' })
    .map((r, i) => ({ ...r, coord_key: `bucheon-${i}` }));
  const { marks, groups } = planOutlierMarks([...sihueng, ...bucheon]);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].sigungu, '시흥시');
  assert.equal(groups.find((g) => g.sigungu === '부천시').outliers, 0);
});

test('먼 것부터 정렬한다 — 로그 샘플에 가장 명백한 오류가 먼저 보여야 한다', () => {
  const rows = [
    ...normalCluster(),
    row(98, { lat: 37.38, lng: 127.30 }),   // 약 44km
    row(99, { lat: 37.38, lng: 129.00 }),   // 약 194km
  ];
  const { marks } = planOutlierMarks(rows);
  assert.equal(marks.length, 2);
  assert.ok(marks[0].distanceKm > marks[1].distanceKm);
});

// ── ⑦ 기본값 계약 ────────────────────────────────────────────────
test('기본 기준은 25km · 최소 표본 20 — 판정 함수 기본값(3)을 그대로 쓰지 않는다', () => {
  assert.equal(OUTLIER_RADIUS_KM, 25);
  assert.equal(OUTLIER_MIN_SAMPLE, 20);
});
