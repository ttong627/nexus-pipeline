// ══════════════════════════════════════════════════════════════════
//  VWorld 재시도·속도제한 회귀 (2026-08-11 실측 근거)
//
//  실측: 도로명 지오코딩 800건을 동시성 3(초당 약 20)으로 돌리자
//    - 346회째까지 **연속 성공** 후 붕괴
//    - 실패 사유 network 224 · not_json 180, HTTP **502 Bad Gateway**
//    - 본문 "The server returned an invalid or incomplete response"
//  40건 버스트(초당 27.5)는 멀쩡했다 → 버스트가 아니라 **지속 부하**에 서버가 뻗는다.
//  502 는 레이트리밋(429)이 아니라 과부하 응답이므로 처방은 **속도 제한 + 재시도**다.
//
//  ★재시도해도 답이 안 바뀌는 실패(키 없음·좌표 없음)는 재시도하지 않는다.
//    그걸 재시도하면 쿼터만 태우고 같은 답을 받는다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRetryGeocode, backoffDelayMs, createRateLimiter } from '../src/vworld.js';

// ── ① 무엇을 재시도하는가 ─────────────────────────────────────────
test('★서버가 뻗은 신호는 재시도한다 — 502·네트워크·타임아웃', () => {
  assert.equal(shouldRetryGeocode({ ok: false, reason: 'not_json', status: 502 }), true);
  assert.equal(shouldRetryGeocode({ ok: false, reason: 'not_json', status: 503 }), true);
  assert.equal(shouldRetryGeocode({ ok: false, reason: 'network' }), true);
  assert.equal(shouldRetryGeocode({ ok: false, reason: 'timeout' }), true);
});

test('★답이 안 바뀌는 실패는 재시도하지 않는다 — 쿼터만 태운다', () => {
  assert.equal(shouldRetryGeocode({ ok: false, reason: 'no_key' }), false);
  assert.equal(shouldRetryGeocode({ ok: false, reason: 'no_address' }), false);
  assert.equal(shouldRetryGeocode({ ok: false, reason: 'no_point', status: 200 }), false,
    '주소에 좌표가 없는 것은 서버 문제가 아니다');
  assert.equal(shouldRetryGeocode({ ok: false, reason: 'api_error', status: 200, errorCode: 'INVALID_KEY' }), false,
    '키가 틀린 걸 재시도하면 영원히 실패한다');
});

test('성공은 재시도 대상이 아니다', () => {
  assert.equal(shouldRetryGeocode({ ok: true, point: { lat: 37, lng: 127 } }), false);
});

test('4xx 는 재시도하지 않는다 — 우리 요청이 잘못된 것이다', () => {
  assert.equal(shouldRetryGeocode({ ok: false, reason: 'not_json', status: 400 }), false);
  assert.equal(shouldRetryGeocode({ ok: false, reason: 'not_json', status: 403 }), false);
});

// ── ② 백오프 ──────────────────────────────────────────────────────
test('백오프는 시도마다 늘어난다 — 뻗은 서버를 같은 속도로 다시 때리면 안 된다', () => {
  const d0 = backoffDelayMs(0);
  const d1 = backoffDelayMs(1);
  const d2 = backoffDelayMs(2);
  assert.ok(d0 > 0);
  assert.ok(d1 > d0, `${d1} > ${d0}`);
  assert.ok(d2 > d1, `${d2} > ${d1}`);
});

test('★백오프에 상한이 있다 — 무한정 기다리면 배치가 안 끝난다', () => {
  assert.ok(backoffDelayMs(20) <= 10000, '10초를 넘기면 안 된다');
  assert.equal(backoffDelayMs(20), backoffDelayMs(30), '상한에 도달하면 더 안 늘어난다');
});

// ── ③ 속도 제한 ───────────────────────────────────────────────────
test('★초당 허용량을 넘으면 기다리게 한다', async () => {
  let clock = 0;
  const slept = [];
  const limiter = createRateLimiter(5, {           // 초당 5회 = 200ms 간격
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); clock += ms; },
  });
  for (let i = 0; i < 3; i += 1) await limiter.acquire();
  assert.deepEqual(slept, [200, 200], '첫 호출은 즉시, 이후는 200ms 간격');
});

test('시간이 이미 흘렀으면 기다리지 않는다', async () => {
  let clock = 0;
  const slept = [];
  const limiter = createRateLimiter(5, {
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); clock += ms; },
  });
  await limiter.acquire();
  clock += 5000;                                    // 바깥에서 오래 걸렸다
  await limiter.acquire();
  assert.deepEqual(slept, [], '이미 간격이 지났으면 추가 대기 없음');
});

test('★동시 호출이어도 설정 속도를 지킨다 — 슬롯을 겹쳐 배정하면 안 된다', async () => {
  // 2026-08-11 실측: 동시성 3에서 설정 0.7/초가 실효 2.1/초로 나왔다(정확히 3배).
  // 동시 호출들이 같은 nextAt 을 읽고 함께 통과했기 때문이다 = 설정값이 거짓말을 한다.
  let clock = 0;
  const slept = [];
  const limiter = createRateLimiter(5, {            // 200ms 간격
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); },       // 대기해도 시계는 안 민다(동시 대기 재현)
  });
  await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
  assert.deepEqual(slept, [200, 400], '1번은 즉시, 2·3번은 각각 200·400ms 뒤 — 겹치지 않는다');
});

test('속도 제한이 0 이하이면 제한하지 않는다 — 끄는 스위치', async () => {
  const slept = [];
  const limiter = createRateLimiter(0, { now: () => 0, sleep: async (ms) => { slept.push(ms); } });
  await limiter.acquire();
  await limiter.acquire();
  assert.deepEqual(slept, []);
});
