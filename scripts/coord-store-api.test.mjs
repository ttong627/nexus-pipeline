// ══════════════════════════════════════════════════════════════════
//  C-5 클라 좌표 저장소 연동 회귀 — 설계서 좌표관리_설계.md §3-4·§5
//
//  ★서버 pickDeliveryCoord 와 **같은 규칙**이어야 한다. 클라가 제 나름대로 고르면
//    화면과 배치가 서로 다른 좌표를 쓰면서 아무 에러도 안 난다.
//    - 내비 목적지: 입구 → 중심. **동 좌표는 쓰지 않는다**(차가 못 들어간다, F2)
//    - 순번 계산  : 동 → 입구 → 중심 (단지를 한 점으로 보면 내부 동선이 사라진다)
//    - outlier·none 은 좌표 없음으로 취급 (DS-15)
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickStoreCoord, storeEntryHasPoint, summarizeCoverage } from '../src/utils/coordStoreApi.js';

const entry = (over = {}) => ({
  coordKey: 'k1',
  entrance: null,
  center: { lat: 37.5, lng: 127.0, source: 'vworld' },
  dong: null,
  quality: 'unverified',
  ...over,
});

// ── ① 용도별 선택 ─────────────────────────────────────────────────
test('내비는 입구를 먼저 쓴다', () => {
  const e = entry({ entrance: { lat: 37.1, lng: 127.1, source: 'juso_entrc' } });
  const c = pickStoreCoord(e, 'navigation');
  assert.equal(c.lat, 37.1);
  assert.equal(c.kind, 'entrance');
});

test('입구가 없으면 중심으로 내려간다', () => {
  const c = pickStoreCoord(entry(), 'navigation');
  assert.equal(c.lat, 37.5);
  assert.equal(c.kind, 'center');
});

test('★내비는 동 좌표를 쓰지 않는다 — 차가 못 들어가는 지점이 목적지가 된다(F2)', () => {
  const e = entry({ dong: { no: '101', lat: 37.9, lng: 127.9 } });
  const c = pickStoreCoord(e, 'navigation');
  assert.equal(c.kind, 'center', '동 좌표가 있어도 내비는 중심을 쓴다');
  assert.notEqual(c.lat, 37.9);
});

test('★순번은 동 좌표를 먼저 쓴다 — 단지를 한 점으로 보면 내부 동선이 사라진다', () => {
  const e = entry({ dong: { no: '101', lat: 37.9, lng: 127.9 } });
  const c = pickStoreCoord(e, 'sequence');
  assert.equal(c.kind, 'dong');
  assert.equal(c.lat, 37.9);
});

test('순번이어도 동 좌표가 없으면 입구·중심으로 내려간다', () => {
  assert.equal(pickStoreCoord(entry(), 'sequence').kind, 'center');
});

// ── ② 못 믿을 좌표는 없는 것으로 ──────────────────────────────────
test('★outlier 는 좌표 없음으로 취급한다 — 이상 좌표 하나가 기사 구역을 430km 로 부풀렸다', () => {
  assert.equal(pickStoreCoord(entry({ quality: 'outlier' }), 'navigation'), null);
});

test('quality=none 은 좌표 없음이다', () => {
  assert.equal(pickStoreCoord(entry({ quality: 'none', center: null }), 'navigation'), null);
});

test('앵커를 못 만든 건(no_anchor)도 좌표 없음이다', () => {
  assert.equal(pickStoreCoord({ coordKey: '', quality: 'no_anchor' }, 'navigation'), null);
});

test('빈 응답에 안 터진다', () => {
  assert.equal(pickStoreCoord(null, 'navigation'), null);
  assert.equal(pickStoreCoord(undefined, 'sequence'), null);
});

// ── ③ 보유 판정·집계 ──────────────────────────────────────────────
test('입구·중심 중 하나라도 있으면 보유다', () => {
  assert.equal(storeEntryHasPoint(entry()), true);
  assert.equal(storeEntryHasPoint(entry({ center: null })), false);
  assert.equal(storeEntryHasPoint(entry({ center: null, entrance: { lat: 1, lng: 2 } })), true);
});

test('★동 좌표만 있는 건 내비용 보유가 아니다 — 그걸 보유로 세면 채움이 끝난 줄 안다', () => {
  assert.equal(storeEntryHasPoint(entry({ center: null, dong: { no: '101', lat: 37, lng: 127 } })), false);
});

test('미보유 집계는 사유를 나눠 센다 — 주소 문제와 좌표 문제는 다르다(A-36)', () => {
  const s = summarizeCoverage([
    entry(),
    entry({ center: null, quality: 'none' }),
    entry({ coordKey: '', quality: 'no_anchor', center: null }),
    entry({ quality: 'outlier' }),
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.withPoint, 1);
  assert.equal(s.noAnchor, 1, '주소를 특정 못 한 것');
  assert.equal(s.outlier, 1);
  assert.equal(s.missing, 3, '보유하지 않은 전체');
});

test('빈 목록도 집계된다', () => {
  const s = summarizeCoverage([]);
  assert.equal(s.total, 0);
  assert.equal(s.missing, 0);
});
