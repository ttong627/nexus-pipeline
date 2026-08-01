/**
 * 이상좌표 격리기 + 적재기 규칙 검증.
 *
 * ★검증 전략 — "탐지기 자체를 의심한다"
 *   cp949 리더 때 배운 교훈이다. 탐지기를 만들어놓고 "0건 나왔으니 깨끗하다"고 읽었는데,
 *   사실은 탐지기가 아무것도 못 잡는 상태였다. 그래서 여기서는
 *     (A) **실제 오류 좌표**(전국 실측에서 나온 바다 위 좌표)를 넣어 격리되는지
 *     (B) **실제 정상 좌표**(가장 극단적인 정상 사례 = 섬)를 넣어 통과하는지
 *   둘 다 본다. 한쪽만 보면 항상 통과시키는 탐지기도 만점을 받는다.
 *
 * 실행: node --test scripts/entrance-loader.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COORD_OK, COORD_QUARANTINED, COORD_UNVERIFIED,
  MIN_POINTS_EMD, MIN_POINTS_ROAD, QUARANTINE_DISTANCE_M,
  createClusterIndex, judgeCoord, referenceKeys,
} from '../src/entrance/coordGuard.js';
import {
  SOURCE_DAILY, SOURCE_FULL_LINK, SOURCE_FULL_SUMMARY,
  classifySource, orderSources, toEntranceRow,
} from '../src/entrance/entranceLoader.js';
import { parseEntranceLine } from '../src/entrance/entrcParser.js';

/* ────────────────────────── 중앙값 기준점 ────────────────────────── */

test('기준점은 평균이 아니라 중앙값이다 — 이상치 하나에 끌려가면 안 된다', () => {
  const idx = createClusterIndex();
  // 정상 9점(서울시청 부근) + 오류 1점(동해 한복판)
  for (let i = 0; i < 9; i += 1) idx.add('R1', 37.566 + i * 0.0001, 126.978 + i * 0.0001);
  idx.add('R1', 35.58, 131.33);

  const c = idx.center('R1', MIN_POINTS_ROAD);
  assert.equal(c.count, 10);
  assert.ok(Math.abs(c.lat - 37.566) < 0.01, `중앙값이 이상치에 끌렸다: ${c.lat}`);
  assert.ok(Math.abs(c.lng - 126.978) < 0.01, `중앙값이 이상치에 끌렸다: ${c.lng}`);
});

test('표본이 하한 미만이면 기준점을 만들지 않는다(모르는 건 모른다고 한다)', () => {
  const idx = createClusterIndex();
  idx.add('R1', 37.5, 127.0);
  assert.equal(idx.center('R1', MIN_POINTS_ROAD), null);
  assert.notEqual(idx.center('R1', 1), null);
});

/* ─────────────────── (A) 실제 오류 좌표는 격리된다 ─────────────────── */

/**
 * 전국 실측에서 나온 오류 좌표(EPSG:5179 변환 결과). 전부 육지가 아니라 동해 위다.
 * 도로 중앙값에서 172~189km 떨어져 있었고, 정상 자료의 최대 이격은 45.9km 였다.
 */
const REAL_ERRORS = [
  ['울산 중구 종가20길', 35.57987, 131.33452, 35.5384, 129.3114],
  ['경북 상주 성동로', 36.41362, 130.17408, 36.4152, 128.1590],
  ['강원 양양 동해대로', 37.93415, 130.78490, 37.9330, 128.7590],
  ['부산 서구 초장로18번길', 35.09200, 131.02008, 35.0940, 129.0230],
];

for (const [label, lat, lng, refLat, refLng] of REAL_ERRORS) {
  test(`격리: ${label} — 자기 도로 중앙값에서 100km 넘게 떨어졌다`, () => {
    const j = judgeCoord({ lat, lng }, [{ kind: 'road', center: { lat: refLat, lng: refLng, count: 50 } }]);
    assert.equal(j.status, COORD_QUARANTINED);
    assert.equal(j.reason, 'far_from_road');
    assert.ok(j.distanceM > QUARANTINE_DISTANCE_M, `${label}: ${j.distanceM}m`);
  });
}

/* ─────────────── (B) 극단적인 정상 좌표는 통과해야 한다 ─────────────── */

/**
 * 거리 기반 탐지기가 가장 잘 틀리는 곳은 **섬**이다. 시도 경계박스 방식이 실제로
 * 백령도·가거도·독도·추자도를 오탐했다. 도로 단위로 보면 섬도 자기들끼리 모여 있다.
 */
const REAL_ISLANDS = [
  ['인천 옹진 백령면 두무진로', 37.97476, 124.61849, 37.9750, 124.6180],
  ['전남 신안 흑산면 가거도길', 34.07289, 125.09496, 34.0730, 125.0950],
  ['경북 울릉 독도이사부길', 37.23935, 131.86992, 37.2394, 131.8690],
  ['충남 태안 근흥면 가의도길', 36.62607, 125.55912, 36.6260, 125.5590],
];

for (const [label, lat, lng, refLat, refLng] of REAL_ISLANDS) {
  test(`통과: ${label} — 섬이라도 자기 도로 옆이면 정상이다`, () => {
    const j = judgeCoord({ lat, lng }, [{ kind: 'road', center: { lat: refLat, lng: refLng, count: 20 } }]);
    assert.equal(j.status, COORD_OK, `${label} 오탐: ${j.distanceM}m`);
  });
}

test('정상 최대 이격(가의도 45.9km)은 통과하고, 실측 최소 오류(172.8km)는 격리된다', () => {
  const ref = { kind: 'road', center: { lat: 36.75, lng: 126.13, count: 61 } };  // 태안군 근흥면 일대
  const legit = judgeCoord({ lat: 36.62607, lng: 125.55912 }, [ref]);
  assert.ok(legit.distanceM < QUARANTINE_DISTANCE_M);
  assert.equal(legit.status, COORD_OK);
  // 172.8km 짜리 실제 오류(강릉 사천면 한과마을길)
  const bad = judgeCoord({ lat: 37.80911, lng: 130.79744 },
    [{ kind: 'road', center: { lat: 37.8090, lng: 128.7900, count: 119 } }]);
  assert.equal(bad.status, COORD_QUARANTINED);
});

/* ───────────────────────── 판정 보류 ───────────────────────── */

test('대조군이 없으면 통과도 격리도 아닌 보류다', () => {
  const j = judgeCoord({ lat: 37.5, lng: 127.0 }, [{ kind: 'road', center: null }, { kind: 'emd', center: null }]);
  assert.equal(j.status, COORD_UNVERIFIED);
  assert.equal(j.reason, 'no_reference');
});

test('도로 표본이 없으면 읍면동으로 폴백한다', () => {
  const j = judgeCoord({ lat: 37.5, lng: 127.0 },
    [{ kind: 'road', center: null }, { kind: 'emd', center: { lat: 37.51, lng: 127.01, count: MIN_POINTS_EMD } }]);
  assert.equal(j.status, COORD_OK);
  assert.equal(j.refKind, 'emd');
});

test('좌표가 없으면 none — 격리가 아니다(비공개 건물은 정상이다)', () => {
  assert.equal(judgeCoord(null, []).status, 'none');
});

/* ───────────────────── 격리 좌표는 본 테이블에 안 들어간다 ───────────────────── */

const ENTRC_LINE = [
  '31110', '1', '3111010100', '울산광역시', '중구', '약사동',
  '311103007001', '종가20길', '0', '10', '0',
  '테스트빌딩', '44400', '주택', '0', '약사동',
  '1347318.0', '1683000.0',
].join('|');

test('격리 판정이면 lat/lng/x/y 를 행에 담지 않는다', () => {
  const rec = parseEntranceLine(ENTRC_LINE);
  assert.ok(rec);
  const row = toEntranceRow(rec, {
    geo: { lat: 35.57987, lng: 131.33452 },
    judgement: { status: COORD_QUARANTINED, reason: 'far_from_road', distanceM: 180900, refKind: 'road', refLat: null, refLng: null, refCount: 16 },
    sourceFile: 'C:/x/entrc_ulsan.txt', sourceKind: SOURCE_FULL_SUMMARY, sourceDate: null,
  });
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
  assert.equal(row.x, null);
  assert.equal(row.y, null);
  assert.equal(row.coord_status, COORD_QUARANTINED);
  assert.equal(row.coord_distance_m, 180900);
  // 주소 자체는 살아 있어야 한다 — 좌표만 못 믿는 것이지 주소가 없는 게 아니다.
  assert.equal(row.road_name, '종가20길');
  assert.equal(row.building_name, '테스트빌딩');
  assert.equal(row.source_file, 'entrc_ulsan.txt');
});

test('정상 판정이면 원본 좌표와 변환 좌표를 함께 담는다', () => {
  const rec = parseEntranceLine(ENTRC_LINE);
  const row = toEntranceRow(rec, {
    geo: { lat: 35.5384, lng: 129.3114 },
    judgement: { status: COORD_OK, reason: null, distanceM: 120, refKind: 'road', refLat: 35.5, refLng: 129.3, refCount: 16 },
    sourceFile: 'entrc_ulsan.txt', sourceKind: SOURCE_FULL_SUMMARY, sourceDate: null,
  });
  assert.equal(row.lat, 35.5384);
  assert.equal(row.x, 1347318);
  assert.equal(row.coord_status, COORD_OK);
});

/* ───────────────────────── 자료 분류·적용 순서 ───────────────────────── */

test('파일명으로 자료 종류와 기준일을 판별한다', () => {
  assert.deepEqual(classifySource('entrc_ulsan.txt'), { kind: SOURCE_FULL_SUMMARY, sourceDate: null });
  assert.deepEqual(classifySource('RNENTDATA_2607_31000.txt'), { kind: SOURCE_FULL_LINK, sourceDate: '2026-07-01' });
  assert.deepEqual(classifySource('AlterD.JUSUEC.20260702.TH_SGCO_RNADR_POSITION.TXT'),
    { kind: SOURCE_DAILY, sourceDate: '2026-07-02' });
  assert.equal(classifySource('300002.shp'), null);
  assert.equal(classifySource('[레이아웃]위치정보요약DB.pdf'), null);
});

test('적용 순서는 전체분 → 일변동(날짜 오름차순)이다 — 뒤바뀌면 폐지가 되살아난다', () => {
  const shuffled = [
    { file: 'AlterD.JUSUEC.20260730.TXT', kind: SOURCE_DAILY, sourceDate: '2026-07-30' },
    { file: 'entrc_seoul.txt', kind: SOURCE_FULL_SUMMARY, sourceDate: null },
    { file: 'AlterD.JUSUEC.20260702.TXT', kind: SOURCE_DAILY, sourceDate: '2026-07-02' },
    { file: 'RNENTDATA_2607_11000.txt', kind: SOURCE_FULL_LINK, sourceDate: '2026-07-01' },
  ];
  assert.deepEqual(orderSources(shuffled).map((e) => e.file), [
    'entrc_seoul.txt',
    'RNENTDATA_2607_11000.txt',
    'AlterD.JUSUEC.20260702.TXT',
    'AlterD.JUSUEC.20260730.TXT',
  ]);
});

test('대조군 키는 도로명코드와 법정동 8자리(읍면동)다', () => {
  const rec = parseEntranceLine(ENTRC_LINE);
  assert.deepEqual(referenceKeys(rec), { road: '311103007001', emd: '31110101' });
  assert.deepEqual(referenceKeys({ roadCode: 'R', legalDongCode: '123' }), { road: 'R', emd: null });
});
