// ══════════════════════════════════════════════════════════════════
//  좌표 저장소 회귀 테스트 (형 지시 2026-08-11 · 설계서 좌표관리_설계.md)
//  "입구 좌표와 동좌표 2개를 구분 관리 해줘야해 아파트인경우는"
//
//  ★여기서 지키는 것은 두 가지다:
//    ① 앵커(coord_key)가 표기 흔들림에 안 흔들린다
//    ② 지오코딩 결과가 **입구 좌표 칸을 절대 못 채운다**(설계서 F1)
//       — 건물 중심이 입구로 둔갑하면 차가 못 들어가는 곳을 목적지로 준다
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoordKey, coordRowToResult, normalizeDongNo, ENTRANCE_SOURCES,
  pickRoadCode, pickRoadCodeByBuilding, roadCodeCandidates, pickTrustedDong, coordResolveEntry, toDongNo,
} from '../src/coords/coordStore.js';

// ── ⓿ 동 표기 통일 (2026-08-11) ──────────────────────────────────
//  경로마다 다른 함수를 써서 같은 값을 다르게 읽고 있었다:
//    /v1/building/dong-coords → parseDongNo  ('동' 접미사 필요 — '201' 은 빈 값)
//    mode:'fill'              → normalizeDongNo (맨 숫자 허용)
//  그래서 클라가 '201' 을 보내면 한쪽은 동 매칭을 아예 안 하고, 다른 쪽은 정상 동작했다.
//  toDongNo 하나로 받는다 — **값이면 정규화, 이름이면 추출**.
test('★맨 숫자 동을 받는다 — 이게 경로별 불일치의 원인이었다', () => {
  assert.equal(toDongNo('201'), '201');
  assert.equal(toDongNo('0101'), '101', '앞자리 0 정규화');
  assert.equal(toDongNo('101동'), '101');
});

test('한글·영문 단일 동도 값으로 받는다', () => {
  for (const [input, want] of [['가', '가'], ['가동', '가'], ['B', 'B'], ['B동', 'B']]) {
    assert.equal(toDongNo(input), want, `${input} → ${want}`);
  }
});

test('이름이 오면 그 안에서 동을 뽑는다', () => {
  assert.equal(toDongNo('은마아파트(28동)'), '28');
  assert.equal(toDongNo('여월휴먼시아 204동'), '204');
});

test('★동이 없는 이름은 빈 값 — 지어내지 않는다', () => {
  assert.equal(toDongNo('월곶2차풍림아이원아파트'), '');
  assert.equal(toDongNo(''), '');
  assert.equal(toDongNo(null), '');
});

test('★A-32 유지 — 동 뒤에 한글이 오면 동호수가 아니다', () => {
  assert.equal(toDongNo('장안2동우체국'), '', '행정동 이름을 동 번호로 읽으면 안 된다');
});

// ── ① 앵커 ────────────────────────────────────────────────────────
test('coord_key 는 도로코드+지하여부+본번-부번으로 만든다', () => {
  assert.equal(buildCoordKey({ roadCode: '411730123456', undergroundYn: '0', buildingMainNo: 16, buildingSubNo: 0 }),
    '411730123456#0#16-0');
  assert.equal(buildCoordKey({ roadCode: '411730123456', buildingMainNo: 261, buildingSubNo: 8 }),
    '411730123456#0#261-8');
  assert.equal(buildCoordKey({ roadCode: '411730123456', undergroundYn: '1', buildingMainNo: 5 }),
    '411730123456#1#5-0');
});

test('★표기 흔들림에 안 흔들린다 — 문자열/숫자, 공백, 빈 부번', () => {
  const a = buildCoordKey({ roadCode: '411730123456', undergroundYn: '0', buildingMainNo: 16, buildingSubNo: 0 });
  assert.equal(buildCoordKey({ roadCode: ' 411730123456 ', undergroundYn: '', buildingMainNo: '16', buildingSubNo: '' }), a);
  assert.equal(buildCoordKey({ roadCode: '411730123456', buildingMainNo: '16', buildingSubNo: null }), a);
});

test('★도로코드나 본번이 없으면 키를 만들지 않는다 — 애매한 앵커는 오염을 부른다', () => {
  assert.equal(buildCoordKey({ roadCode: '', buildingMainNo: 16 }), '');
  assert.equal(buildCoordKey({ roadCode: '411730123456' }), '');
  assert.equal(buildCoordKey({ roadCode: '411730123456', buildingMainNo: 0 }), '');
  assert.equal(buildCoordKey(), '');
});

// ── ② 입구 좌표 오염 차단 (설계서 F1) ──────────────────────────────
test('★입구 좌표를 채울 수 있는 출처는 출입구자료·수동뿐이다', () => {
  assert.deepEqual([...ENTRANCE_SOURCES].sort(), ['juso_entrc', 'manual']);
});

test('★지오코딩(vworld·kakao) 결과는 입구 좌표가 될 수 없다', () => {
  for (const src of ['vworld', 'kakao', 'juso', '', null]) {
    assert.equal(ENTRANCE_SOURCES.has(src), false, `${src} 가 입구 좌표로 허용됐다 — 중심이 입구로 둔갑한다`);
  }
});

// ── ③ 저장소 행 공용 픽스처 (아래 조회 테스트들이 함께 쓴다) ──────────
const row = (o = {}) => ({
  coord_key: 'RC#0#16-0', road_address: '경기도 부천시 삼작로256번길 16',
  entrance_lat: null, entrance_lng: null, entrance_source: null,
  center_lat: null, center_lng: null, center_source: null,
  is_apartment: false, quality: 'ok', ...o,
});

// ── 배송에 쓸 좌표 고르기 → **여기 없다**(2026-08-12 이관) ───────────
//
//  이 자리에 `pickDeliveryCoord` 회귀 5건이 있었다. 그런데 그 함수는 **호출부가
//  0건인 죽은 코드**였다 — 회귀는 초록인데 운영은 그 규칙을 안 지켜도 아무도 몰랐다.
//  *테스트가 통과한다*와 *운영이 그 규칙을 지킨다*는 다른 명제다(설계서 §6).
//
//  잠금은 실제로 도는 두 곳으로 옮겼다. 규칙을 고치려면 **거기**를 고쳐라:
//    · 명단 lat/lng(동 → 입구 → 중심) — `functions/storeCoordPick.js`
//         회귀 `scripts/store-coord-pick.test.mjs` (DS-15 outlier 차단 포함)
//    · 내비 목적지(입구 → 중심, 동 금지 = F2) — `src/delivery/deliveryBrief.js`
//         회귀 `scripts/delivery-brief.test.mjs`
//  동 신뢰 판정(`matched==='dong'` 만 채택)은 아래 ⑤ `pickTrustedDong` 이 계속 잠근다.

// ── ④ 동 표기 정규화 ──────────────────────────────────────────────
test('동 표기 정규화 — 앞자리 0 제거, 한글·영문 동은 그대로', () => {
  assert.equal(normalizeDongNo('0101'), '101');
  assert.equal(normalizeDongNo('101동'), '101');
  assert.equal(normalizeDongNo('가동'), '가');
  assert.equal(normalizeDongNo('B동'), 'B');
  assert.equal(normalizeDongNo(' 207 '), '207');
  assert.equal(normalizeDongNo(''), '');
  assert.equal(normalizeDongNo(null), '');
});

// ── ⑤ 응답 변환 ───────────────────────────────────────────────────
test('행 → API 응답 — 입구/중심/동이 각자 자리에 담긴다(섞이지 않는다)', () => {
  const r = coordRowToResult(row({
    entrance_lat: 37.1, entrance_lng: 126.1, entrance_source: 'juso_entrc',
    center_lat: 37.2, center_lng: 126.2, center_source: 'vworld', is_apartment: true,
  }), [{ dong_no: '101', lat: 37.25, lng: 126.25, floors: 15, matched: 'dong' }]);
  assert.equal(r.coordKey, 'RC#0#16-0');
  assert.deepEqual(r.entrance, { lat: 37.1, lng: 126.1, source: 'juso_entrc' });
  assert.deepEqual(r.center, { lat: 37.2, lng: 126.2, source: 'vworld' });
  assert.equal(r.dongs.length, 1);
  assert.equal(r.dongs[0].floors, 15);
  assert.equal(r.isApartment, true);
});

test('좌표가 없는 칸은 null 로 — 빈 객체로 만들면 있는 척이 된다', () => {
  const r = coordRowToResult(row(), []);
  assert.equal(r.entrance, null);
  assert.equal(r.center, null);
  assert.deepEqual(r.dongs, []);
});

test('입력 방어 — 빈 행이면 null', () => {
  assert.equal(coordRowToResult(null), null);
  assert.equal(coordRowToResult({}), null);
});

// ── ⑥ 앵커 해석 — 도로명은 전국에서 겹친다 (A-30·A-35) ─────────────
const rc = (sigungu, road_code) => ({ sigungu, road_code });

test('시군구가 일치하는 도로코드 하나면 그것을 쓴다', () => {
  assert.equal(pickRoadCode([rc('시흥시', '411730123456')], '시흥시'), '411730123456');
  // 표기 공백 차이를 흡수한다 ('부천시 오정구' ↔ '부천시오정구')
  assert.equal(pickRoadCode([rc('부천시 오정구', '41192999')], '오정구'), '41192999');
});

test('★시군구를 모르면 앵커를 만들지 않는다 — 찍는 것보다 비우는 편이 되돌릴 수 있다', () => {
  assert.equal(pickRoadCode([rc('시흥시', '411730123456')], ''), '');
  assert.equal(pickRoadCode([rc('시흥시', '411730123456')], null), '');
});

test('★같은 도로명이 여러 지자체에 있으면 남의 동네 좌표가 붙는다 — 후보가 갈리면 스킵', () => {
  const cands = [rc('동대문구', '11230111'), rc('수원시 팔달구', '41111222')];
  assert.equal(pickRoadCode(cands, '동대문구'), '11230111');
  assert.equal(pickRoadCode(cands, '성동구'), '');           // 아무것도 안 맞음
  // 같은 시군구에 도로코드가 둘이면 특정 실패 → 스킵
  assert.equal(pickRoadCode([rc('시흥시', 'A'), rc('시흥시', 'B')], '시흥시'), '');
  assert.equal(pickRoadCode([], '시흥시'), '');
});

// ── ⑥-A 세종특별자치시 — 원본에 시군구가 없다 (2026-08-12 원본 실측) ──
//  개선_도로명코드_전체분.txt 370,024행 중 **2,647행의 시군구 칸이 빈 값**이고
//  전부 세종시다. 시군구만 대조하면 세종 주소는 후보가 영영 0개 → 좌표를 못 붙인다.
test('★세종은 시군구 칸이 비어 있다 — 그때만 시도로 대조한다', () => {
  const sejong = [{ sigungu: '', sido: '세종특별자치시', road_code: '361100123456' }];
  assert.equal(pickRoadCode(sejong, '세종특별자치시'), '361100123456');
  // 시군구 값이 있는 행에는 이 폴백이 적용되지 않는다(다른 동네를 끌어오지 않는다)
  assert.deepEqual(roadCodeCandidates([{ sigungu: '시흥시', sido: '경기도', road_code: 'A' }], '경기도'), []);
});

// ── ⑥-B 같은 시군구·같은 도로명인데 코드가 둘 (2026-08-12 실측) ──────
//  동대문구 한천로58길이 그 경우였다. pickRoadCode 가 비우는 바람에 명단 266건이
//  두 달 내내 no_anchor 였다. 두 코드는 **번지 구간이 갈린다**(22~209 / 240 하나).
const link = (road_code, main, sub = 0, ug = '0') =>
  ({ road_code, building_main_no: main, building_sub_no: sub, underground_yn: ug });
const HANCHEON = ['112304115640', '112304121702'];
// 원본 주소_서울특별시.txt 실측분(세 코드에 걸린 23행 중 발췌)
const HANCHEON_LINKS = [
  link('112304115640', 47), link('112304115640', 75, 11), link('112304115640', 75, 45),
  link('112304115640', 107), link('112304115640', 135), link('112304115640', 139),
  link('112304121702', 240),
];

test('★번지가 실재하는 코드로 좁힌다 — 동대문구 한천로58길 266건이 여기서 막혀 있었다', () => {
  assert.equal(pickRoadCode(HANCHEON.map((c) => rc('동대문구', c)), '동대문구'), '', '시군구만으로는 못 고른다');
  for (const [main, sub] of [[47, 0], [75, 11], [75, 45], [107, 0], [135, 0], [139, 0]]) {
    assert.equal(
      pickRoadCodeByBuilding(HANCHEON, HANCHEON_LINKS, { buildingMainNo: main, buildingSubNo: sub }),
      '112304115640', `${main}-${sub}`,
    );
  }
  // 240번지는 다른 코드다 — 번지로 갈리는 것이 이 방법의 근거다
  assert.equal(pickRoadCodeByBuilding(HANCHEON, HANCHEON_LINKS, { buildingMainNo: 240 }), '112304121702');
});

test('★근거가 없으면 여전히 비운다 — 좁히는 것이지 찍는 것이 아니다(A-30 불변)', () => {
  // 실재하지 않는 번지
  assert.equal(pickRoadCodeByBuilding(HANCHEON, HANCHEON_LINKS, { buildingMainNo: 999 }), '');
  // 두 코드 모두에 그 번지가 있으면 못 고른다
  assert.equal(pickRoadCodeByBuilding(HANCHEON, [link(HANCHEON[0], 50), link(HANCHEON[1], 50)], { buildingMainNo: 50 }), '');
  // 부번·지하 여부가 다르면 다른 건물이다
  assert.equal(pickRoadCodeByBuilding(HANCHEON, HANCHEON_LINKS, { buildingMainNo: 75, buildingSubNo: 46 }), '');
  assert.equal(pickRoadCodeByBuilding(HANCHEON, HANCHEON_LINKS, { buildingMainNo: 135, undergroundYn: '1' }), '');
  // 입력 방어
  assert.equal(pickRoadCodeByBuilding([], HANCHEON_LINKS, { buildingMainNo: 135 }), '');
  assert.equal(pickRoadCodeByBuilding(HANCHEON, HANCHEON_LINKS, { buildingMainNo: null }), '');
  assert.equal(pickRoadCodeByBuilding(HANCHEON, [], { buildingMainNo: 135 }), '');
});

// ── ⑦ 동 좌표 신뢰 게이트 ──────────────────────────────────────────
const dongRow = (o = {}) => ({ dong_no: '101', lat: 37.25, lng: 126.25, floors: 15, matched: 'dong', source: 'vworld', ...o });

test('요청한 동의 좌표를 돌려준다 (표기 정규화 포함)', () => {
  const rows = [dongRow(), dongRow({ dong_no: '0102', lat: 37.26, lng: 126.26 })];
  assert.deepEqual(pickTrustedDong(rows, '101동'), { no: '101', lat: 37.25, lng: 126.25, floors: 15, source: 'vworld' });
  assert.equal(pickTrustedDong(rows, '102').lat, 37.26);
  assert.equal(pickTrustedDong(rows, '999'), null);
  assert.equal(pickTrustedDong(rows, ''), null);
});

test('★격리된(suspect) 동 좌표는 내주지 않는다 — 실측: B동 좌표 하나가 빌라 5곳에 붙어 있었다', () => {
  for (const m of ['suspect', 'complex', 'centroid', null]) {
    assert.equal(pickTrustedDong([dongRow({ matched: m })], '101'), null, `matched=${m} 를 동 좌표로 내줬다`);
  }
});

// ── ⑧ 조회 응답 — '아직 안 해봤다'와 '해봤는데 없다'는 다르다 ──────
test('★저장소에 행이 없으면 quality=unknown (none 과 구분해야 재시도 대상을 안다)', () => {
  const e = coordResolveEntry({ roadAddress: '경기도 시흥시 장곡로53번길 10', dongNo: '207' }, null, []);
  assert.equal(e.quality, 'unknown');
  assert.equal(e.coordKey, '');
  assert.equal(e.entrance, null);
  assert.equal(e.center, null);
  assert.equal(e.dong, null);
  assert.equal(e.roadAddress, '경기도 시흥시 장곡로53번길 10');
});

test('행은 있는데 좌표를 못 구한 건은 quality=none 그대로 (재시도 낭비 차단)', () => {
  assert.equal(coordResolveEntry({}, row({ quality: 'none' }), []).quality, 'none');
});

test('아파트 조회 — 중심·동이 각자 자리에 담기고 신뢰 가능한 동만 센다', () => {
  const e = coordResolveEntry(
    { roadAddress: '경기도 시흥시 장곡로53번길 10', dongNo: '101' },
    row({ center_lat: 37.2, center_lng: 126.2, center_source: 'vworld', is_apartment: true, building_name: '보성아파트' }),
    [dongRow(), dongRow({ dong_no: '102', matched: 'suspect' })],
  );
  assert.deepEqual(e.center, { lat: 37.2, lng: 126.2, source: 'vworld' });
  assert.equal(e.dong.no, '101');
  assert.equal(e.dongCount, 1, 'suspect 를 신뢰 가능한 동으로 셌다');
  assert.equal(e.isApartment, true);
  assert.equal(e.buildingName, '보성아파트');
});
