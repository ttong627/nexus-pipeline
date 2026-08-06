/**
 * TM 역변환 검증 — **실자료 좌표를 실제 지명과 대조**한다.
 *
 * 좌표 변환은 틀려도 예외가 안 난다. 그럴듯한 숫자가 나오고, 배송지가 몇 km 옆으로
 * 밀린 채 조용히 적재된다. 그래서 "숫자가 나온다"가 아니라 **"그 지명 위에 찍히는가"**
 * 를 검사해야 한다.
 *
 * 기준점은 형이 받은 행안부 실파일에서 뽑았다(공개 주소자료·PII 아님).
 * 실행: node --test scripts/tm-projection.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KR_BOUNDS, distanceM, tmToWgs84 } from '../src/shared/tmProjection.js';

/**
 * ★검증 전략 — 두 층으로 나눈다.
 *
 *  (A) 절대 기준점: 위치를 **확신할 수 있는** 주소 하나로 오차를 재는 앵커.
 *      서울 종로구 자하문로9길 7 = 경복궁 서쪽 서촌. 여기서 수백 m 이내면 변환식이 맞다.
 *      ⚠️ 앵커는 "내가 대충 아는 동네"가 아니라 확신 가능한 지점만 쓴다.
 *         처음엔 세종 반곡동 좌표를 어림짐작(36.48/127.29)으로 적었다가 2.8km 오차로
 *         테스트가 실패했는데, 틀린 건 코드가 아니라 **내 기대값**이었다.
 *         이런 앵커는 "허용오차를 늘려서" 통과시키면 안 된다 — 검증이 무의미해진다.
 *
 *  (B) 행정구역 대역: 나머지 지점은 점이 아니라 **그 시도 범위 안에 드는가**로 본다.
 *      느슨해 보이지만 좌표계 오지정·남북 반전·경도 밀림 같은 실제 사고는 전부 잡힌다.
 */
const ANCHOR = {
  label: '서울 종로구 자하문로9길 7 (서촌)',
  x: 953276.096598, y: 1953467.668452,
  lat: 37.5794, lng: 126.9708, tolM: 300,
};

/** 시도 대략 경위도 대역 — [설명, x, y, latMin, latMax, lngMin, lngMax] */
const REGION_CASES = [
  ['서울', 953276.096598, 1953467.668452, 37.40, 37.72, 126.75, 127.20],
  ['세종', 983296.172464, 1833330.968984, 36.40, 36.75, 127.15, 127.45],
];

test('★절대 기준점 — 확신 가능한 주소에서 오차가 작다', () => {
  const got = tmToWgs84(ANCHOR.x, ANCHOR.y, 5179);
  assert.ok(got, '변환 실패(null)');
  const off = distanceM(ANCHOR.lat, ANCHOR.lng, got.lat, got.lng);
  assert.ok(
    off <= ANCHOR.tolM,
    `${ANCHOR.label}: 기대(${ANCHOR.lat},${ANCHOR.lng}) vs 실제(${got.lat.toFixed(5)},${got.lng.toFixed(5)}) = ${Math.round(off)}m`,
  );
});

test('시도 대역 — 좌표가 해당 시도 안에 떨어진다', () => {
  for (const [label, x, y, latMin, latMax, lngMin, lngMax] of REGION_CASES) {
    const g = tmToWgs84(x, y);
    assert.ok(g, `${label}: 변환 실패`);
    assert.ok(g.lat >= latMin && g.lat <= latMax, `${label} 위도 이탈: ${g.lat.toFixed(5)}`);
    assert.ok(g.lng >= lngMin && g.lng <= lngMax, `${label} 경도 이탈: ${g.lng.toFixed(5)}`);
  }
});

test('남북 순서가 맞다(반전 사고 탐지)', () => {
  const seoul = tmToWgs84(953276.096598, 1953467.668452);
  const sejong = tmToWgs84(983296.172464, 1833330.968984);
  assert.ok(seoul.lat > sejong.lat, '서울이 세종보다 북쪽이어야 한다');
  assert.ok(seoul.lng < sejong.lng, '서울이 세종보다 서쪽이어야 한다');
});

test('한국 범위 밖 입력은 null 로 거른다(좌표계 오지정 신호)', () => {
  assert.equal(tmToWgs84(0, 0, 5179), null);
  assert.equal(tmToWgs84(1e9, 1e9, 5179), null);
  assert.equal(tmToWgs84(NaN, 100, 5179), null);
  assert.equal(tmToWgs84(100, 100, 9999), null, '모르는 EPSG 는 null');
});

test('결과가 항상 한국 경위도 범위 안이다', () => {
  for (const [, x, y] of REGION_CASES) {
    const g = tmToWgs84(x, y);
    assert.ok(g.lat >= KR_BOUNDS.latMin && g.lat <= KR_BOUNDS.latMax);
    assert.ok(g.lng >= KR_BOUNDS.lngMin && g.lng <= KR_BOUNDS.lngMax);
  }
});

test('★5186 으로 잘못 지정하면 다른 곳이 나온다 (좌표계 혼동 방지)', () => {
  const { x, y, lat, lng } = ANCHOR;
  const right = tmToWgs84(x, y, 5179);
  const wrong = tmToWgs84(x, y, 5186);
  // 5186 은 원점이 달라 같은 수치를 넣으면 엉뚱한 곳(또는 범위 밖)이 된다.
  if (wrong) {
    const gap = distanceM(right.lat, right.lng, wrong.lat, wrong.lng);
    assert.ok(gap > 10000, `좌표계가 달라도 결과가 같다면 파라미터가 안 먹은 것: ${Math.round(gap)}m`);
  }
  assert.ok(distanceM(lat, lng, right.lat, right.lng) < ANCHOR.tolM);
});

test('distanceM 이 상식적인 값을 준다', () => {
  assert.equal(Math.round(distanceM(37.5, 127.0, 37.5, 127.0)), 0);
  const d = distanceM(37.5, 127.0, 37.5, 127.01);   // 경도 0.01도 ≈ 880m(위도 37.5)
  assert.ok(d > 700 && d < 1000, `예상 밖 거리: ${Math.round(d)}m`);
});
