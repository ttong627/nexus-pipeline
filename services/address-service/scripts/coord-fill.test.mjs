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
  createCoordFiller,
  availableSources,
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

// ★2026-08-11 실측으로 드러남: VWorld 건물명이 **우리 단지명보다 짧게** 온다.
//   VWorld='여월휴먼시아'  vs  저장='여월휴먼시아2단지아파트'
//   포함 검사를 한 방향으로만 하면 `'여월휴먼시아'.includes('여월휴먼시아2단지아파트')`
//   = false 라 **BBOX 에 22건이나 있는데도 전부 기각**됐다.
//   보성·월곶이 성공한 건 이름이 우연히 정확히 같았기 때문이다.
test('★VWorld 이름이 더 짧아도 서로 포함하면 채택한다 — 여월휴먼시아 실측', () => {
  const cands = [{ buildName: '여월휴먼시아', dongNo: '104', lat: 37.51, lng: 126.806, floors: 15 }];
  const hit = acceptDongCandidate(cands, { wantDong: '104', complexName: '여월휴먼시아2단지아파트' });
  assert.equal(hit?.lat, 37.51);
});

test('공백·표기 차이는 무시한다', () => {
  const cands = [{ buildName: '월곶2차 풍림아이원', dongNo: '202', lat: 37.4, lng: 126.7 }];
  assert.ok(acceptDongCandidate(cands, { wantDong: '202', complexName: '월곶2차풍림아이원아파트' }));
});

test('★너무 짧은 이름으로는 역방향 매칭하지 않는다 — 삼성·대우·현대가 아무 데나 붙는다', () => {
  const cands = [{ buildName: '삼성', dongNo: '101', lat: 37.5, lng: 127.0 }];
  assert.equal(acceptDongCandidate(cands, { wantDong: '101', complexName: '삼성래미안아파트' }), null);
});

test('★역방향 매칭으로 후보가 둘이 되면 기각한다 — 1단지·2단지가 같이 잡힌다', () => {
  const cands = [
    { buildName: '여월휴먼시아', dongNo: '104', lat: 37.51, lng: 126.806 },
    { buildName: '여월휴먼시아', dongNo: '104', lat: 37.52, lng: 126.808 },
  ];
  assert.equal(acceptDongCandidate(cands, { wantDong: '104', complexName: '여월휴먼시아2단지아파트' }), null);
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

// ── ②-b 정기배치의 재시도 문 (C-6 ⑤) ─────────────────────────────
// 'none' 을 영영 다시 안 물으면 신축이 주소DB 에 등재된 뒤에도 좌표가 비어 있는 채로
// 남는다. 반대로 아무 경로나 다시 물으면 답 없는 주소에 매번 쿼터를 태운다.
// → **주기는 대상 SQL(loadFillTargets 의 retryDays)이 정하고, 이 플래그는 문만 연다.**
test('★retryNone 은 기본 꺼져 있다 — 정제·루트맵 경로가 none 을 다시 태우면 안 된다', () => {
  const { fill, skip } = classifyFillTargets([{ roadAddress: 'B로 2', coordKey: 'k2', quality: 'none' }]);
  assert.equal(fill.length, 0);
  assert.equal(skip[0].reason, 'tried_none');
});

test('정기배치가 retryNone 을 켜면 none 도 다시 채운다 — 주소DB는 월 단위로 갱신된다', () => {
  const { fill, skip } = classifyFillTargets(
    [{ roadAddress: 'B로 2', coordKey: 'k2', quality: 'none' }],
    { retryNone: true },
  );
  assert.equal(fill.length, 1);
  assert.equal(skip.length, 0);
});

test('★retryNone 을 켜도 앵커 없는 건은 여전히 제외다 — 주소를 못 찾는 건 좌표로 풀 수 없다', () => {
  const { fill, skip } = classifyFillTargets(
    [{ roadAddress: '없는로 999', coordKey: '', quality: 'no_anchor' }],
    { retryNone: true },
  );
  assert.equal(fill.length, 0);
  assert.equal(skip[0].reason, 'no_anchor');
});

// ── ②-c 동 정보가 없는 단지 재조회 억제 (2026-08-11 실측: 시흥 103개 단지) ──
// VWorld LT_C_SPBD 에 동이 아예 없는 단지는 물을 때마다 답이 같은데 BBOX 를 1~2콜씩 태운다.
// ★이 규칙이 과하면 **동 좌표가 영영 안 채워진다**. 아래 케이스들이 그 경계를 지킨다.
const DAY = 86400000;
const aptEntry = (over = {}) => ({
  roadAddress: 'A로 1', coordKey: 'k1', quality: 'unverified',
  center: { lat: 37, lng: 127 }, dongNo: '101', dong: null, dongCount: 0, dongProbedAt: null, ...over,
});

test('★물어본 적 없으면(dongProbedAt=null) 무조건 채운다 — 억제가 첫 조회를 막으면 안 된다', () => {
  const { fill } = classifyFillTargets([aptEntry()]);
  assert.equal(fill.length, 1);
});

test('★최근에 물어봤고 그 단지에 동이 하나도 없으면 건너뛴다 — 답은 매번 같다', () => {
  const now = Date.now();
  const { fill, skip } = classifyFillTargets([aptEntry({ dongProbedAt: now - 3 * DAY })], { now });
  assert.equal(fill.length, 0);
  assert.equal(skip[0].reason, 'dong_absent');
});

test('★주기가 지나면 다시 묻는다 — 영구 차단이 아니라 주기 대기다(VWorld 자료는 갱신된다)', () => {
  const now = Date.now();
  const { fill } = classifyFillTargets([aptEntry({ dongProbedAt: now - 400 * DAY })], { now });
  assert.equal(fill.length, 1);
});

test('★★단지에 동이 있는데 내 동만 없으면 억제하지 않는다 — 이름매칭 개선으로 살아날 수 있다', () => {
  const now = Date.now();
  const { fill } = classifyFillTargets([aptEntry({ dongProbedAt: now - 1 * DAY, dongCount: 12 })], { now });
  assert.equal(fill.length, 1, 'dongCount>0 은 코드로 고칠 여지가 있는 건이다');
});

test('★내비용 점이 없으면 억제와 무관하게 채운다 — 중심 좌표부터 얻어야 한다', () => {
  const now = Date.now();
  const { fill } = classifyFillTargets(
    [aptEntry({ dongProbedAt: now - 1 * DAY, center: null, quality: 'unknown' })], { now },
  );
  assert.equal(fill.length, 1);
});

test('동 좌표를 이미 가진 건은 종전대로 cached 로 건너뛴다(사유가 dong_absent 로 바뀌지 않는다)', () => {
  const now = Date.now();
  const { skip } = classifyFillTargets(
    [aptEntry({ dong: { no: '101', lat: 37.1, lng: 127.1 }, dongProbedAt: now - 1 * DAY })], { now },
  );
  assert.equal(skip[0].reason, 'cached');
});

// ★2026-08-11 운영 실측으로 드러남: 명단 기반 동 좌표 채움이 **한 건도 안 됐다**.
//   중심 좌표가 이미 있으면 `cached` 로 건너뛰었기 때문이다(4/4 skip). 내비용 점과
//   동 좌표는 **용도가 다른 별개의 값**이라, 하나가 있다고 다른 하나를 안 채우면
//   단지 내부 동선(은마아파트 동간 280m)이 영원히 살아나지 않는다.
test('★동 번호를 요청했는데 그 동 좌표가 없으면 중심이 있어도 채운다', () => {
  const { fill } = classifyFillTargets([
    { roadAddress: 'A로 1', coordKey: 'k1', quality: 'unverified', center: { lat: 37, lng: 127 }, dongNo: '101', dong: null },
  ]);
  assert.equal(fill.length, 1, '중심이 있어도 요청한 동이 비었으면 채움 대상이다');
});

test('요청한 동 좌표가 이미 있으면 건너뛴다', () => {
  const { fill, skip } = classifyFillTargets([
    { roadAddress: 'A로 1', coordKey: 'k1', quality: 'unverified', center: { lat: 37, lng: 127 }, dongNo: '101', dong: { no: '101', lat: 37.1, lng: 127.1 } },
  ]);
  assert.equal(fill.length, 0);
  assert.equal(skip[0].reason, 'cached');
});

test('동 번호를 안 보냈으면 중심만 있으면 충분하다 — 단독·상가', () => {
  const { fill } = classifyFillTargets([
    { roadAddress: 'A로 1', coordKey: 'k1', quality: 'unverified', center: { lat: 37, lng: 127 }, dongNo: '' },
  ]);
  assert.equal(fill.length, 0);
});

test('★이미 아는 중심이 있으면 지오코딩을 다시 하지 않는다 — 동만 필요할 때 호출 절반', async () => {
  const q = createQuotaCounter({ vworld: 10 });
  const fill = createCoordFiller({
    geocodeRoad: async () => { throw new Error('아는 중심이 있는데 지오코딩을 다시 했다'); },
    getBuildingsNear: async () => [{ buildName: '은마아파트', dongNo: '101', lat: 37.5, lng: 127.5, floors: 14 }],
  });
  const got = await fill({
    coordKey: 'k1', roadAddress: 'A로 1', isApartment: true, dongNo: '101',
    buildingName: '은마아파트', knownCenter: { lat: 37, lng: 127 },
  }, q);
  assert.equal(q.used('vworld'), 1, 'BBOX 1회만');
  assert.equal(got.dongs[0]?.dongNo, '101');
});

// ★2026-08-12 실제 사고: `probedDong` 을 ②출입구 return **아래**에 선언해 두는 바람에
//   그 경로를 타는 순간 `Cannot access 'probedDong' before initialization` 으로 터졌다.
//   C-7 적재 전에는 findEntrance 가 늘 null 이라 **한 번도 안 탔고**, 642만 행이 들어온
//   그날 처음 드러났다. 코드는 그대로인데 **데이터가 바뀌자** 터진 것이다.
//   → 출입구 자료가 있는 상태를 회귀로 상시 재현한다.
test('★출입구 자료가 있으면 그 좌표로 즉시 끝난다 — 지오코딩을 태우지 않는다', async () => {
  const q = createQuotaCounter({ vworld: 10, kakao: 10 });
  const fill = createCoordFiller({
    findEntrance: async () => ({ lat: 37.5665, lng: 126.9780 }),
    geocodeRoad: async () => { throw new Error('출입구 자료가 있는데 지오코딩을 했다'); },
    kakaoGeocode: async () => { throw new Error('출입구 자료가 있는데 카카오를 불렀다'); },
  });
  const got = await fill({ coordKey: 'k1', roadAddress: 'A로 1' }, q);
  assert.equal(got.source, 'juso_entrc');
  assert.deepEqual(got.point, { lat: 37.5665, lng: 126.9780 });
  assert.equal(q.used('vworld'), 0, '외부 지오코딩을 태우면 안 된다');
});

test('★출입구 경로도 probedDong 을 담아 돌려준다 — 호출부가 이 필드를 읽는다', async () => {
  const fill = createCoordFiller({ findEntrance: async () => ({ lat: 37.5, lng: 127.0 }) });
  const got = await fill({ coordKey: 'k1', roadAddress: 'A로 1', isApartment: true, dongNo: '101' }, null);
  assert.equal('probedDong' in got, true, 'coordWrite 가 이 값으로 dong_probed_at 을 쓴다');
  assert.equal(got.probedDong, false, 'BBOX 를 안 태웠으므로 false');
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

// ── ⑥ ★키가 없는 출처는 아예 없는 것으로 친다 (2026-08-11 실측으로 드러난 결함) ──
//  Job 에 VWORLD_KEY·KAKAO_REST_KEY 를 안 넣고 돌렸더니 채움률 0% 인데 요약엔
//  `vworld 100 · kakao 100 사용`이 찍혔다. 호출은 한 번도 없었다(1.1초에 200콜 불가).
//  키가 없으면 **출처가 없는 것**이고, 그 사실이 요약에 드러나야 한다.
test('★키가 없으면 그 출처는 목록에서 빠진다', () => {
  assert.deepEqual(availableSources({ vworldKey: '', kakaoRestKey: '' }), []);
  assert.deepEqual(availableSources({ vworldKey: 'v', kakaoRestKey: '' }), ['vworld']);
  assert.deepEqual(availableSources({ vworldKey: '', kakaoRestKey: 'k' }), ['kakao']);
  assert.deepEqual(availableSources({ vworldKey: 'v', kakaoRestKey: 'k' }), ['vworld', 'kakao']);
});

test('★출처가 하나도 없으면 채움을 시작하면 안 된다 — 0% 를 "채울 게 없다"로 오해한다(F9)', () => {
  assert.equal(availableSources({}).length, 0);
});

// ── ⑦ ★쓰지도 않은 쿼터를 썼다고 하지 않는다 ──
//  첫 운영 실행에서 채움률 0% 가 나왔는데 요약에는 `vworld 100 · kakao 100 사용`이
//  찍혀 있었다. 실제로는 Job 에 API 키가 없어 **호출 자체가 없었다**. 계측이 거짓말을
//  하면 "한도를 다 썼나?"를 먼저 의심하게 되고 진짜 원인(키 누락)이 가려진다.
//  설계서 §1-2 의 "적재했다는 주장" 과 같은 종류의 함정이다.
test('★출처가 없으면(키 미설정) 쿼터를 차감하지 않는다', async () => {
  const fill = createCoordFiller({});           // geocodeRoad·kakaoGeocode 미주입 = 키 없음
  const q = createQuotaCounter({ vworld: 10, kakao: 10 });
  const got = await fill({ coordKey: 'k1', roadAddress: 'A로 1' }, q);
  assert.equal(got.point, null);
  assert.equal(q.used('vworld'), 0, '호출하지 않았는데 쿼터를 차감하면 계측이 거짓말을 한다');
  assert.equal(q.used('kakao'), 0);
});

test('실제로 호출할 때만 쿼터를 차감한다', async () => {
  const fill = createCoordFiller({ geocodeRoad: async () => ({ lat: 37, lng: 127 }) });
  const q = createQuotaCounter({ vworld: 10, kakao: 10 });
  const got = await fill({ coordKey: 'k1', roadAddress: 'A로 1', isApartment: false }, q);
  assert.equal(got.source, 'vworld');
  assert.equal(q.used('vworld'), 1, '지오코딩 1회');
  assert.equal(q.used('kakao'), 0, 'vworld 로 끝났으면 kakao 는 안 부른다');
});

test('아파트가 아니면 동 BBOX 를 태우지 않는다 — 쿼터 낭비(R4)', async () => {
  const q = createQuotaCounter({ vworld: 10 });
  const fill = createCoordFiller({
    geocodeRoad: async () => ({ lat: 37, lng: 127 }),
    getBuildingsNear: async () => { throw new Error('단독·상가에 BBOX 를 태웠다'); },
  });
  await fill({ coordKey: 'k1', roadAddress: 'A로 1', isApartment: false }, q);
  assert.equal(q.used('vworld'), 1);
});

// ★2026-08-11 첫 실전 실행에서 드러남: 동 좌표 0건인데 VWorld 를 200회 썼다.
//   배치 경로(building_coord 기반)에는 **동 번호가 없다** — 동 번호는 명단에서 온다.
//   맞출 동이 없으면 BBOX 결과는 어차피 전부 기각되므로 호출 자체가 낭비다.
test('★아파트라도 동 번호가 없으면 BBOX 를 태우지 않는다 — 맞출 대상이 없다', async () => {
  const q = createQuotaCounter({ vworld: 10 });
  const fill = createCoordFiller({
    geocodeRoad: async () => ({ lat: 37, lng: 127 }),
    getBuildingsNear: async () => { throw new Error('동 번호가 없는데 BBOX 를 태웠다'); },
  });
  const got = await fill({ coordKey: 'k1', roadAddress: 'A로 1', isApartment: true, dongNo: '' }, q);
  assert.equal(got.source, 'vworld');
  assert.equal(q.used('vworld'), 1, '지오코딩 1회만 — BBOX 는 안 부른다');
});

test('동 번호가 있으면 아파트일 때 BBOX 를 태운다', async () => {
  const q = createQuotaCounter({ vworld: 10 });
  const fill = createCoordFiller({
    geocodeRoad: async () => ({ lat: 37, lng: 127 }),
    getBuildingsNear: async () => [{ buildName: '은마아파트', dongNo: '101', lat: 37.5, lng: 127.5, floors: 14 }],
  });
  const got = await fill({ coordKey: 'k1', roadAddress: 'A로 1', isApartment: true, dongNo: '101' }, q);
  assert.equal(q.used('vworld'), 2, '지오코딩 1 + BBOX 1');
  assert.equal(got.dongs[0]?.dongNo, '101');
  assert.equal(got.dongs[0]?.matched, 'dong');
});

// ★2026-08-11 프로브로 드러남: 여월휴먼시아2단지(동 104~212)는 좁은 BBOX(±250m)에서
//   후보 0개였다. 대단지는 지오코딩 대표점이 단지 한쪽에 찍혀 반대편 동이 범위 밖으로
//   벗어난다. matchDongCoord 는 2026-07-27 에 이걸 넓은 BBOX 2차 조회로 고쳤는데
//   (그게 "306동이 320동 위치에" 사고의 수정이었다), 새 채움 경로에는 그 단계가 없었다.
test('★좁은 BBOX 에서 못 찾으면 넓은 BBOX 로 한 번 더 본다 — 대단지', async () => {
  const seen = [];
  const q = createQuotaCounter({ vworld: 10 });
  const fill = createCoordFiller({
    getBuildingsNear: async (lng, lat, radius) => {
      seen.push(radius);
      // 넓게 볼 때만 그 동이 보인다
      return radius && radius > 0.004
        ? [{ buildName: '여월휴먼시아2단지아파트', dongNo: '104', lat: 37.5, lng: 127.5, floors: 15 }]
        : [];
    },
  });
  const got = await fill({
    coordKey: 'k1', roadAddress: 'A로 1', isApartment: true, dongNo: '104',
    buildingName: '여월휴먼시아2단지아파트', knownCenter: { lat: 37, lng: 127 },
  }, q);
  assert.equal(seen.length, 2, '좁게 한 번, 넓게 한 번');
  assert.ok(seen[1] > seen[0], '2차가 더 넓어야 한다');
  assert.equal(got.dongs[0]?.dongNo, '104', '넓힌 뒤 찾아야 한다');
});

test('좁은 BBOX 에서 찾으면 넓히지 않는다 — 인접 단지 오염을 부른다', async () => {
  const seen = [];
  const q = createQuotaCounter({ vworld: 10 });
  const fill = createCoordFiller({
    getBuildingsNear: async (lng, lat, radius) => {
      seen.push(radius);
      return [{ buildName: '은마아파트', dongNo: '101', lat: 37.5, lng: 127.5, floors: 14 }];
    },
  });
  await fill({
    coordKey: 'k1', roadAddress: 'A로 1', isApartment: true, dongNo: '101',
    buildingName: '은마아파트', knownCenter: { lat: 37, lng: 127 },
  }, q);
  assert.equal(seen.length, 1, '1차에서 찾았으면 2차는 없다');
});

test('★쿼터가 바닥나면 호출하지 않고 이월로 남긴다(F7)', async () => {
  const q = createQuotaCounter({ vworld: 0, kakao: 0 });
  const fill = createCoordFiller({
    geocodeRoad: async () => { throw new Error('쿼터 0 인데 호출했다'); },
    kakaoGeocode: async () => { throw new Error('쿼터 0 인데 호출했다'); },
  });
  const got = await fill({ coordKey: 'k1', roadAddress: 'A로 1' }, q);
  assert.equal(got.point, null);
  assert.deepEqual(got.carried, ['vworld', 'kakao']);
});
