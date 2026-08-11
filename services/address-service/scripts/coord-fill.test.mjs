// ══════════════════════════════════════════════════════════════════
//  C-3 좌표 채움 파이프라인 회귀 (형 지시 2026-08-11 · 설계서 좌표관리_설계.md §3-2)
//
//  ★이 파일이 지키는 첫 번째 것은 **오염 재발 차단**이다.
//    C-4 이관에서 375건을 격리해야 했던 원인이 아직 코드에 남아 있었다:
//    pickDong 의 `|| byDong[0]` 폴백이 **단지명 검증에 실패해도 첫 건물을 채택**했다.
//    실측 오염: `B동` 좌표 하나가 성암빌라·진아빌라·청양맨션·청정빌라·신한그린빌에
//    동시에 붙어 있었다. 이 규칙 없이 C-3 로 새로 채우면 같은 오염이 그대로 재발한다.
//
//  ★두 번째는 F1 이다 — 지오코딩 결과는 **입구 좌표 칸을 절대 못 채운다**.
//    중심 좌표가 입구로 둔갑하면 차가 못 들어가는 곳을 목적지로 준다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAmbiguousDong,
  acceptDongCandidate,
  createQuotaCounter,
  classifyFillTargets,
  buildCoordWrite,
  FILL_SOURCES,
} from '../src/coords/coordFill.js';
import { buildCoordKey, parseCoordKey } from '../src/coords/coordStore.js';

// ── ⓿ 앵커 역파싱 — 채움은 키에서 도로코드·본번을 되꺼내 써야 한다 ──
test('★coord_key 왕복 — 만들고 되풀면 같은 키가 나온다', () => {
  for (const k of ['411730123456#0#16-0', '411730123456#1#261-8', '111100000001#0#1-0']) {
    assert.equal(buildCoordKey(parseCoordKey(k)), k, `${k} 왕복 실패`);
  }
});

test('망가진 키는 되풀지 않는다 — 잘못 푼 앵커로 쓰면 남의 건물에 좌표가 붙는다', () => {
  for (const bad of ['', 'abc', '411730123456#0', '#0#16-0', '411730123456#0#0-0']) {
    assert.equal(parseCoordKey(bad), null, `${bad} 는 null 이어야 한다`);
  }
});

// ── ① 모호한 동 표기 판정 ─────────────────────────────────────────
test('한글·영문 한 글자 동은 모호하다 — 가·나·A·B', () => {
  for (const d of ['가', '나', '다', 'A', 'B', 'b', '라']) {
    assert.equal(isAmbiguousDong(d), true, `${d} 는 모호해야 한다`);
  }
});

test('숫자 동·두 글자 이상은 모호하지 않다', () => {
  for (const d of ['101', '307', '1001', '가나', 'AB']) {
    assert.equal(isAmbiguousDong(d), false, `${d} 는 모호하지 않아야 한다`);
  }
});

test('빈 값은 모호로 취급한다 — 없는 동을 채택할 근거가 없다', () => {
  assert.equal(isAmbiguousDong(''), true);
  assert.equal(isAmbiguousDong(null), true);
  assert.equal(isAmbiguousDong(undefined), true);
});

// ── ② ★오염 차단 규칙 (형 지시) ───────────────────────────────────
const villa = (name, dongNo, lat) => ({ buildName: name, dongNo, lat, lng: 126.9, floors: 4 });

test('★단일 문자 동은 단지명 없으면 채택 금지 — 후보가 하나뿐이어도', () => {
  const cands = [villa('성암빌라', 'B', 37.1)];
  assert.equal(acceptDongCandidate(cands, { wantDong: 'B', complexName: '' }), null);
});

test('★단일 문자 동 + 단지명 불일치 → 채택 금지 (byDong[0] 폴백 금지)', () => {
  // 이것이 정확히 실측 오염의 재현이다: 진아빌라를 찾는데 성암빌라가 잡힌다.
  const cands = [villa('성암빌라', 'B', 37.1), villa('청양맨션', 'B', 37.2)];
  assert.equal(acceptDongCandidate(cands, { wantDong: 'B', complexName: '진아빌라' }), null);
});

test('단일 문자 동이라도 단지명이 일치하면 채택한다', () => {
  const cands = [villa('성암빌라', 'B', 37.1), villa('진아빌라', 'B', 37.2)];
  const hit = acceptDongCandidate(cands, { wantDong: 'B', complexName: '진아빌라' });
  assert.equal(hit?.buildName, '진아빌라');
  assert.equal(hit?.lat, 37.2);
});

test('★단지명이 일치하는 후보가 둘 이상이면 채택 금지 — 찍는 것보다 비운다', () => {
  const cands = [villa('진아빌라', 'B', 37.1), villa('진아빌라', 'B', 37.9)];
  assert.equal(acceptDongCandidate(cands, { wantDong: 'B', complexName: '진아빌라' }), null);
});

test('숫자 동은 단지명이 없어도 후보가 유일하면 채택한다', () => {
  const cands = [villa('은마아파트', '101', 37.5)];
  assert.equal(acceptDongCandidate(cands, { wantDong: '101', complexName: '' })?.lat, 37.5);
});

test('★숫자 동이라도 단지명 없이 후보가 둘이면 채택 금지 — 인접 단지의 같은 동번호(F3)', () => {
  const cands = [villa('은마아파트', '101', 37.5), villa('개포주공', '101', 37.6)];
  assert.equal(acceptDongCandidate(cands, { wantDong: '101', complexName: '' }), null);
});

test('좌표 없는 후보는 애초에 후보가 아니다', () => {
  const cands = [{ buildName: '은마아파트', dongNo: '101', lat: null, lng: null }];
  assert.equal(acceptDongCandidate(cands, { wantDong: '101', complexName: '' }), null);
});

// ── ③ 쿼터 카운터 (F7) ────────────────────────────────────────────
test('쿼터는 상한까지만 내주고 그 뒤로는 거절한다', () => {
  const q = createQuotaCounter({ vworld: 3, kakao: 1 });
  assert.equal(q.take('vworld', 2), true);
  assert.equal(q.remaining('vworld'), 1);
  assert.equal(q.take('vworld', 2), false, '남은 1 보다 많이 달라면 거절');
  assert.equal(q.take('vworld', 1), true);
  assert.equal(q.exhausted('vworld'), true);
  assert.equal(q.take('kakao', 1), true);
  assert.equal(q.exhausted('kakao'), true);
});

test('★쿼터 소진은 조용히 넘어가지 않는다 — 이월 건수를 셀 수 있어야 한다(F7)', () => {
  const q = createQuotaCounter({ vworld: 0 });
  assert.equal(q.take('vworld', 1), false);
  assert.equal(q.used('vworld'), 0);
  assert.equal(q.exhausted('vworld'), true);
});

test('모르는 출처는 쿼터를 못 쓴다 — 오타로 무제한이 되면 안 된다', () => {
  const q = createQuotaCounter({ vworld: 10 });
  assert.equal(q.take('vwrold', 1), false);
});

// ── ④ 채움 대상 선별 (재시도 낭비 차단) ───────────────────────────
test('캐시에 이미 좌표가 있으면 채우지 않는다', () => {
  const { fill, skip } = classifyFillTargets([
    { roadAddress: 'A로 1', coordKey: 'k1', quality: 'ok', center: { lat: 37, lng: 127 } },
  ]);
  assert.equal(fill.length, 0);
  assert.equal(skip.length, 1);
});

test('★앵커를 못 만든 건(no_anchor)은 채움 대상이 아니다 — 주소 문제이지 좌표 문제가 아니다(A-36)', () => {
  const { fill, skip } = classifyFillTargets([
    { roadAddress: '없는로 999', coordKey: '', quality: 'no_anchor' },
  ]);
  assert.equal(fill.length, 0, '앵커 없는 건에 외부 API 를 태우면 쿼터만 태운다');
  assert.equal(skip[0].reason, 'no_anchor');
});

test('저장소에 행이 없는 건(unknown)과 해봤는데 없는 건(none)을 구분한다', () => {
  const { fill } = classifyFillTargets([
    { roadAddress: 'A로 1', coordKey: 'k1', quality: 'unknown' },
    { roadAddress: 'B로 2', coordKey: 'k2', quality: 'none' },
  ]);
  assert.equal(fill.length, 1, 'unknown 만 채운다 — none 은 이미 해봤는데 없던 것');
  assert.equal(fill[0].coordKey, 'k1');
});

test('outlier 는 다시 채운다 — 이상 좌표를 그대로 두면 기사 구역이 부풀어 오른다(DS-15)', () => {
  const { fill } = classifyFillTargets([
    { roadAddress: 'A로 1', coordKey: 'k1', quality: 'outlier', center: { lat: 33, lng: 126 } },
  ]);
  assert.equal(fill.length, 1);
});

// ── ⑤ ★F1 — 지오코딩은 입구 칸을 못 채운다 ────────────────────────
test('★vworld·kakao 결과는 center_* 에만 들어간다 — entrance_* 는 건드리지 않는다(F1)', () => {
  for (const source of ['vworld', 'kakao']) {
    const w = buildCoordWrite({
      coordKey: 'k1', roadAddress: 'A로 1', point: { lat: 37.1, lng: 127.1 }, source,
    });
    assert.equal(w.centerLat, 37.1, `${source} 는 중심 좌표를 채운다`);
    assert.equal(w.centerSource, source);
    assert.equal(w.entranceLat, null, `${source} 가 입구 칸을 채우면 안 된다`);
    assert.equal(w.entranceSource, null);
  }
});

test('★출입구 자료·수동 확인만 입구 칸을 채운다', () => {
  const w = buildCoordWrite({
    coordKey: 'k1', roadAddress: 'A로 1', point: { lat: 37.1, lng: 127.1 }, source: 'juso_entrc',
  });
  assert.equal(w.entranceLat, 37.1);
  assert.equal(w.entranceSource, 'juso_entrc');
  assert.equal(w.centerLat, null, '입구 좌표를 중심 칸에도 복사하면 출처를 잃는다');
});

test('★좌표를 못 구해도 행은 만든다 — quality=none (안 해봤다와 구분)', () => {
  const w = buildCoordWrite({ coordKey: 'k1', roadAddress: 'A로 1', point: null, source: null });
  assert.equal(w.quality, 'none');
  assert.equal(w.centerLat, null);
  assert.equal(w.entranceLat, null);
  assert.equal(w.coordKey, 'k1', '행 자체는 만들어야 재시도 대상이 관리된다');
});

test('좌표를 구하면 quality=unverified — 이상치 검증(C-6) 전까지는 확정이 아니다', () => {
  const w = buildCoordWrite({
    coordKey: 'k1', roadAddress: 'A로 1', point: { lat: 37.1, lng: 127.1 }, source: 'vworld',
  });
  assert.equal(w.quality, 'unverified');
});

test('모르는 출처는 좌표를 기록하지 않는다 — 출처 없는 좌표는 나중에 재평가가 불가능하다', () => {
  const w = buildCoordWrite({
    coordKey: 'k1', roadAddress: 'A로 1', point: { lat: 37.1, lng: 127.1 }, source: 'somewhere',
  });
  assert.equal(w.quality, 'none');
  assert.equal(w.centerLat, null);
  assert.equal(w.entranceLat, null);
});

test('앵커가 없으면 쓰기 자체를 만들지 않는다', () => {
  assert.equal(buildCoordWrite({ coordKey: '', roadAddress: 'A로 1', point: null }), null);
});

test('채움 출처 목록은 폴백 순서 그대로다 — 출입구 → vworld → kakao(설계서 §3-2)', () => {
  assert.deepEqual(FILL_SOURCES, ['juso_entrc', 'vworld', 'kakao']);
});
