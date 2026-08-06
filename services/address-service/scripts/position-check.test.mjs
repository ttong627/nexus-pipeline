/**
 * 배송완료 위치 검증 코어 (희망나르미 REQ-027 반영).
 *
 * ★존재 이유 = **배송지에 가지 않고 완료를 누르는 것**을 잡는 것.
 *   명단정제(ShareRouteView)는 완료 시 GPS 오차(errM)를 **기록만** 하고 판정이 없다.
 *   관리자가 지도에서 눈으로 보는 용도였다 → 판정 규칙을 여기서 처음 정의한다.
 *
 * ★★동시에 **시끄러운 경고를 만들지 않는 것**이 그만큼 중요하다(모듈⑧ 교훈).
 *   좌표가 없거나 GPS 가 부정확한 상황을 "위반"이라고 하면 경고가 쏟아지고,
 *   쏟아지는 경고는 곧 전부 무시된다. 그래서 '판정 불가'를 명시적으로 다룬다.
 *
 * 실행: node --test scripts/position-check.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_THRESHOLD_M,
  verifyDeliveryPosition,
} from '../src/delivery/positionCheck.js';

// 부천시청 부근 기준점과, 거기서 약 1.1km 떨어진 점
const SITE = { lat: 37.5035, lng: 126.7660 };
const NEAR = { lat: 37.5037, lng: 126.7663 };   // 약 35m
const FAR = { lat: 37.5135, lng: 126.7660 };    // 약 1.1km

/* ── 정상 판정 ─────────────────────────────────── */

test('배송지 근처에서 완료하면 ok 이고 거리를 함께 준다', () => {
  const r = verifyDeliveryPosition({
    siteLat: SITE.lat, siteLng: SITE.lng, actualLat: NEAR.lat, actualLng: NEAR.lng,
  });
  assert.equal(r.verdict, 'ok');
  assert.equal(r.checked, true);
  assert.ok(r.distanceM < 100, `거리가 이상하다: ${r.distanceM}`);
});

test('★멀리서 완료하면 far — 이게 이 모듈의 목적이다', () => {
  const r = verifyDeliveryPosition({
    siteLat: SITE.lat, siteLng: SITE.lng, actualLat: FAR.lat, actualLng: FAR.lng,
  });
  assert.equal(r.verdict, 'far');
  assert.equal(r.checked, true);
  assert.ok(r.distanceM > 900, `거리가 이상하다: ${r.distanceM}`);
});

test('임계값은 조정할 수 있다 — 출입구 좌표와 동 중심 좌표는 오차 규모가 다르다', () => {
  const args = { siteLat: SITE.lat, siteLng: SITE.lng, actualLat: FAR.lat, actualLng: FAR.lng };
  assert.equal(verifyDeliveryPosition({ ...args, thresholdM: 2000 }).verdict, 'ok');
  assert.equal(verifyDeliveryPosition({ ...args, thresholdM: 100 }).verdict, 'far');
});

test('기본 임계값이 응답에 실린다 — 판정 근거를 숨기지 않는다', () => {
  const r = verifyDeliveryPosition({
    siteLat: SITE.lat, siteLng: SITE.lng, actualLat: NEAR.lat, actualLng: NEAR.lng,
  });
  assert.equal(r.thresholdM, DEFAULT_THRESHOLD_M);
});

/* ── 판정 불가: 모르는 것을 위반이라 하지 않는다 ── */

test('★배송지 좌표가 없으면 위반이 아니라 판정 불가다', () => {
  const r = verifyDeliveryPosition({ actualLat: NEAR.lat, actualLng: NEAR.lng });
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.checked, false);
  assert.equal(r.reason, 'no_site_coord');
  assert.equal(r.distanceM, null);
});

test('★기사 위치가 없으면 판정 불가다 — GPS 거부는 흔한 일이다', () => {
  const r = verifyDeliveryPosition({ siteLat: SITE.lat, siteLng: SITE.lng });
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.reason, 'no_actual_coord');
});

test('★★GPS 정확도가 임계보다 나쁘면 판정하지 않는다 — 실내·지하 오탐 방지', () => {
  const r = verifyDeliveryPosition({
    siteLat: SITE.lat, siteLng: SITE.lng, actualLat: FAR.lat, actualLng: FAR.lng,
    accuracyM: 800,   // 오차 반경이 임계보다 크면 far 라고 말할 수 없다
  });
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.reason, 'gps_accuracy_too_low');
  assert.ok(r.distanceM > 0, '거리는 참고용으로 여전히 준다');
});

test('정확도가 충분히 좋으면 정상 판정한다', () => {
  const r = verifyDeliveryPosition({
    siteLat: SITE.lat, siteLng: SITE.lng, actualLat: NEAR.lat, actualLng: NEAR.lng,
    accuracyM: 20,
  });
  assert.equal(r.verdict, 'ok');
});

test('한국 밖 좌표는 판정하지 않는다 — 좌표 뒤바뀜·기기 오류가 훨씬 유력하다', () => {
  const r = verifyDeliveryPosition({
    siteLat: SITE.lat, siteLng: SITE.lng, actualLat: 126.7660, actualLng: 37.5035,  // 위경도 뒤바뀜
  });
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.reason, 'out_of_korea');
});

test('숫자가 아닌 입력도 판정 불가로 떨어진다(문자열·NaN·null)', () => {
  for (const bad of ['', 'abc', null, undefined, NaN]) {
    const r = verifyDeliveryPosition({
      siteLat: SITE.lat, siteLng: SITE.lng, actualLat: bad, actualLng: bad,
    });
    assert.equal(r.verdict, 'unverifiable', `입력 ${String(bad)} 가 판정됐다`);
  }
});

/* ── 계약: 코어는 판정만 한다 ───────────────────── */

test('★코어는 차단하지 않는다 — 완료를 막을지는 호출자(운영 정책)가 정한다', () => {
  const r = verifyDeliveryPosition({
    siteLat: SITE.lat, siteLng: SITE.lng, actualLat: FAR.lat, actualLng: FAR.lng,
  });
  assert.equal('blocked' in r, false, '코어가 차단 여부를 정하면 현장에서 배송이 막힌다');
  assert.equal('block' in r, false);
});

test('문자열 숫자도 받아준다 — 앱·폼에서 문자열로 오는 일이 흔하다', () => {
  const r = verifyDeliveryPosition({
    siteLat: String(SITE.lat), siteLng: String(SITE.lng),
    actualLat: String(NEAR.lat), actualLng: String(NEAR.lng),
  });
  assert.equal(r.verdict, 'ok');
});
