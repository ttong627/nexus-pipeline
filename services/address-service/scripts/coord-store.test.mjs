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
  buildCoordKey, coordRowToResult, pickDeliveryCoord, normalizeDongNo, ENTRANCE_SOURCES,
  pickRoadCode, pickTrustedDong, coordResolveEntry,
} from '../src/coords/coordStore.js';

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

// ── ③ 배송에 쓸 좌표 고르기 ────────────────────────────────────────
const row = (o = {}) => ({
  coord_key: 'RC#0#16-0', road_address: '경기도 부천시 삼작로256번길 16',
  entrance_lat: null, entrance_lng: null, entrance_source: null,
  center_lat: null, center_lng: null, center_source: null,
  is_apartment: false, quality: 'ok', ...o,
});

test('내비 목적지는 입구 → 중심 순으로 고른다 (동 좌표는 쓰지 않는다 · F2)', () => {
  const both = row({ entrance_lat: 37.1, entrance_lng: 126.1, entrance_source: 'juso_entrc',
    center_lat: 37.2, center_lng: 126.2, center_source: 'vworld' });
  assert.deepEqual(pickDeliveryCoord(both, { purpose: 'navigation' }),
    { lat: 37.1, lng: 126.1, source: 'juso_entrc', kind: 'entrance' });

  const centerOnly = row({ center_lat: 37.2, center_lng: 126.2, center_source: 'kakao' });
  assert.deepEqual(pickDeliveryCoord(centerOnly, { purpose: 'navigation' }),
    { lat: 37.2, lng: 126.2, source: 'kakao', kind: 'center' });
});

test('★순번 계산에는 동 좌표를 우선한다 — 단지를 한 점으로 보면 내부 동선이 사라진다', () => {
  const apt = row({ is_apartment: true, center_lat: 37.2, center_lng: 126.2, center_source: 'vworld' });
  const dong = { dong_no: '101', lat: 37.25, lng: 126.25, matched: 'dong' };
  assert.deepEqual(pickDeliveryCoord(apt, { purpose: 'sequence', dong }),
    { lat: 37.25, lng: 126.25, source: 'vworld', kind: 'dong' });
});

test('★matched 가 dong 이 아니면 동 좌표로 신뢰하지 않는다 — 엉뚱한 동을 찍는다', () => {
  const apt = row({ is_apartment: true, center_lat: 37.2, center_lng: 126.2, center_source: 'vworld' });
  for (const m of ['complex', 'centroid', null]) {
    const r = pickDeliveryCoord(apt, { purpose: 'sequence', dong: { dong_no: '101', lat: 37.9, lng: 126.9, matched: m } });
    assert.equal(r.kind, 'center', `matched=${m} 인 동 좌표를 채택했다`);
  }
});

test('★이상치(outlier)는 좌표 없음으로 취급한다 — DS-15', () => {
  const bad = row({ center_lat: 37.2, center_lng: 126.2, center_source: 'kakao', quality: 'outlier' });
  assert.equal(pickDeliveryCoord(bad, { purpose: 'navigation' }), null);
});

test('좌표가 하나도 없으면 null (M-1: 예외로 죽지 않는다)', () => {
  assert.equal(pickDeliveryCoord(row(), { purpose: 'navigation' }), null);
  assert.equal(pickDeliveryCoord(null, { purpose: 'navigation' }), null);
  assert.equal(pickDeliveryCoord(undefined), null);
});

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
