// ══════════════════════════════════════════════════════════════════
//  명단 좌표 선택 규칙 회귀 — functions/storeCoordPick.js (2026-08-12)
//
//  ★이 테스트가 존재하는 이유
//    이 규칙을 잠그던 회귀는 원래 `coordStore.pickDeliveryCoord` 에 붙어 있었는데,
//    **그 함수는 호출부가 0건인 죽은 코드**였다. 즉 회귀는 통과하는데 운영은 그 규칙을
//    안 지켜도 아무도 몰랐다. 죽은 함수를 지우면서 잠금을 **실제로 도는 쪽**으로 옮긴다.
//    (Cloud Function `geocodeAuto` → `storeCoordsFor` → `pickStoreCoord`)
//
//  잠그는 것 3가지:
//    ① 고르는 순서 = 동 → 입구 → 중심
//    ② 못 믿는 품질(outlier·none·no_anchor·unknown)은 **좌표값이 있어도** 안 쓴다(DS-15·A-36)
//    ③ 못 고르면 null — 아무거나 만들어내지 않는다(M-1)
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mod from '../functions/storeCoordPick.js';

const { pickStoreCoord, STORE_BAD_QUALITY } = mod;

/** `/v1/coords/resolve` 가 내주는 한 건의 모양(`coordResolveEntry`). */
const entry = (o = {}) => ({
  roadAddress: '경기도 부천시 삼작로256번길 16',
  entrance: null, center: null, dong: null, quality: 'ok', ...o,
});

const ENTRANCE = { lat: 37.1, lng: 126.1, source: 'juso_entrc' };
const CENTER = { lat: 37.2, lng: 126.2, source: 'vworld' };
const DONG = { no: '101', lat: 37.25, lng: 126.25, source: 'vworld' };

// ── ① 고르는 순서 ──────────────────────────────────────────────────
test('동 → 입구 → 중심 순으로 고른다', () => {
  assert.deepEqual(
    pickStoreCoord(entry({ dong: DONG, entrance: ENTRANCE, center: CENTER })),
    { lat: 37.25, lng: 126.25 },
    '동 좌표가 있는데 안 썼다 — 단지를 한 점으로 보면 내부 동선이 통째로 사라진다',
  );
  assert.deepEqual(
    pickStoreCoord(entry({ entrance: ENTRANCE, center: CENTER })),
    { lat: 37.1, lng: 126.1 },
    '동이 없으면 입구다 — 입구는 측량값이고 중심은 추정이다',
  );
  assert.deepEqual(
    pickStoreCoord(entry({ center: CENTER })),
    { lat: 37.2, lng: 126.2 },
    '중심밖에 없으면 중심',
  );
});

// ── ② 못 믿는 품질 ────────────────────────────────────────────────
test('★못 믿는 품질은 좌표값이 있어도 쓰지 않는다 (DS-15 · A-36)', () => {
  for (const quality of ['outlier', 'none', 'no_anchor', 'unknown']) {
    assert.equal(
      pickStoreCoord(entry({ quality, entrance: ENTRANCE, center: CENTER })), null,
      `quality=${quality} 인데 좌표를 내줬다 — 이상 좌표 하나가 기사 구역을 430km 로 부풀린 실측이 있다`,
    );
  }
});

test('못 믿는 품질 목록이 줄어들지 않았는지 — 하나라도 빠지면 나쁜 좌표가 배송으로 나간다', () => {
  for (const quality of ['outlier', 'none', 'no_anchor', 'unknown']) {
    assert.equal(STORE_BAD_QUALITY.has(quality), true, `${quality} 가 목록에서 빠졌다`);
  }
});

test('정상 품질은 그대로 쓴다 — 과잉 차단이면 채움이 끝나지 않는다', () => {
  for (const quality of ['ok', 'unverified', 'verified']) {
    assert.deepEqual(pickStoreCoord(entry({ quality, center: CENTER })), { lat: 37.2, lng: 126.2 });
  }
});

// ── ③ 못 고르면 null ──────────────────────────────────────────────
test('좌표가 하나도 없으면 null — 예외로 죽지도, 지어내지도 않는다 (M-1)', () => {
  assert.equal(pickStoreCoord(entry()), null);
  assert.equal(pickStoreCoord(null), null);
  assert.equal(pickStoreCoord(undefined), null);
});

test('★lat/lng 가 숫자가 아니면 버린다 — NaN 핀은 화면에서 "좌표 있음"으로 보인다', () => {
  assert.equal(pickStoreCoord(entry({ center: { lat: 'abc', lng: 126.2 } })), null);
  assert.equal(pickStoreCoord(entry({ center: { lat: 37.2, lng: null } })), null);
  assert.equal(pickStoreCoord(entry({ dong: { no: '101', lat: undefined, lng: 126.2 } })), null);
});

test('숫자 문자열은 숫자로 바꿔 내준다 — DB 가 문자열로 주는 경우가 있다', () => {
  assert.deepEqual(pickStoreCoord(entry({ center: { lat: '37.2', lng: '126.2' } })), { lat: 37.2, lng: 126.2 });
});

// ── ④ 목적별 규칙 분리가 유지되는가 ────────────────────────────────
test('★내비 규칙과 섞이지 않았는지 — 명단 좌표는 동을 쓰고, 내비는 안 쓴다(F2)', () => {
  // 이 모듈은 **명단용**이다. 동 좌표를 우선하는 것이 옳다.
  // 내비 목적지 규칙은 services/address-service/src/delivery/deliveryBrief.js 에 따로 있고,
  // 그쪽은 동 좌표를 목적지로 쓰지 않는다(동 앞은 차가 못 들어간다).
  // 둘이 한 함수로 합쳐지면 이 테스트가 깨진다 — 합치지 말라는 뜻이다.
  assert.deepEqual(pickStoreCoord(entry({ dong: DONG, entrance: ENTRANCE })), { lat: 37.25, lng: 126.25 });
});
