// ══════════════════════════════════════════════════════════════════
//  학습 주소 매핑 회귀 테스트 (형 지시 2026-08-11)
//  "명단에 있는데 DB에 없는 경우는 API로 검색해서 DB업데이트까지 해주던지."
//  JUSO 응답 ↔ address_learned 행 ↔ 매칭 결과(JUSO 호환 형태) 3자 변환을 고정한다.
//  ★DB 없이 검증 가능한 순수 함수만 여기서 다룬다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnedRowFromJuso, learnedRowToResult, learnedRoadKey, sigunguToken } from '../src/learnedStore.js';

// 실제 JUSO addrLinkApi 응답 1건의 형태
const JUSO = {
  roadAddr: '경기도 부천시 삼작로256번길 16',
  roadAddrPart1: '경기도 부천시 삼작로256번길 16',
  rn: '삼작로256번길',
  buldMnnm: '16',
  buldSlno: '0',
  udrtYn: '0',
  rnMgtSn: '411730123456',
  siNm: '경기도',
  sggNm: '부천시',
  emdNm: '도당동',
  admCd: '4119010300',
  bdNm: '우남아파트',
  bdKdcd: '1',
  bdMgtSn: '4119010300100160000012345',
  zipNo: '14544',
};

// ★2026-08-11 배포 검증에서 실제로 걸린 함정을 회귀로 고정한다.
//   처음엔 키를 주소 문자열로 만들었는데, 적재는 JUSO 결과
//   (`부산광역시 해운대구 센텀중앙로 97 (재송동)`)로 하고 조회는 명단 원문
//   (`부산 해운대구 센텀중앙로 97`)으로 해서 시도 축약·법정동 괄호 하나에 키가 어긋났다.
//   → 학습분이 영원히 안 걸린다. 표기가 아니라 **뜻**으로 묶어야 한다.
test('★학습 키는 표기가 아니라 뜻이다 — 시도 축약·법정동 괄호가 달라도 같은 키', () => {
  const stored = learnedRoadKey({ sigungu: '해운대구', roadName: '센텀중앙로', buildingMainNo: 97, buildingSubNo: 0 });
  const looked = learnedRoadKey({ sigungu: '해운대구', roadName: '센텀중앙로', buildingMainNo: '97' });
  assert.equal(stored, looked);
  assert.ok(stored.length > 0);
});

test('★시군구가 키에 들어간다 — 전국에 겹치는 도로명이 섞이면 안 된다(A-30)', () => {
  const seoul = learnedRoadKey({ sigungu: '동대문구', roadName: '황물로7길', buildingMainNo: 17 });
  const suwon = learnedRoadKey({ sigungu: '팔달구', roadName: '황물로7길', buildingMainNo: 17 });
  assert.notEqual(seoul, suwon);
});

test('★도로명이나 본번이 없으면 키를 만들지 않는다 — 애매한 키로 잘못 걸리면 오매칭', () => {
  assert.equal(learnedRoadKey({ sigungu: '해운대구', roadName: '', buildingMainNo: 97 }), '');
  assert.equal(learnedRoadKey({ sigungu: '해운대구', roadName: '센텀중앙로' }), '');
  assert.equal(learnedRoadKey({ sigungu: '해운대구', roadName: '센텀중앙로', buildingMainNo: 0 }), '');
  assert.equal(learnedRoadKey(), '');
});

test('시군구 토큰 추출 — 라벨 형태가 달라도 같은 값', () => {
  assert.equal(sigunguToken('경기도 부천시'), '부천시');
  assert.equal(sigunguToken('부천시'), '부천시');
  assert.equal(sigunguToken('서울특별시 동대문구'), '동대문구');
  assert.equal(sigunguToken(''), '');
});

test('JUSO 응답 → 학습행 변환', () => {
  const row = learnedRowFromJuso(JUSO, { source: 'juso' });
  assert.equal(row.road_address, '경기도 부천시 삼작로256번길 16');
  assert.equal(row.road_name, '삼작로256번길');
  assert.equal(row.building_main_no, 16);
  assert.equal(row.building_sub_no, 0);
  assert.equal(row.sido, '경기도');
  assert.equal(row.sigungu, '부천시');
  assert.equal(row.legal_emd, '도당동');
  assert.equal(row.building_name, '우남아파트');
  assert.equal(row.building_mgt_no, '4119010300100160000012345');
  assert.equal(row.zip_no, '14544');
  assert.equal(row.is_apartment, true);
  assert.equal(row.source, 'juso');
  assert.equal(row.road_key, learnedRoadKey({ sigungu: '부천시', roadName: '삼작로256번길', buildingMainNo: 16 }));
});

test('★적재 키와 조회 키가 실제로 맞물린다 — 명단 원문으로도 학습분이 걸려야 한다', () => {
  // 적재: JUSO 결과(정식 시도명 + 법정동 괄호)
  const row = learnedRowFromJuso({ ...JUSO, roadAddr: '부산광역시 해운대구 센텀중앙로 97 (재송동)', rn: '센텀중앙로', buldMnnm: '97', buldSlno: '0', siNm: '부산광역시', sggNm: '해운대구' });
  // 조회: 명단 원문(시도 축약, 괄호 없음) — 서버가 parseRoadNumber + cityLabel 로 만드는 키
  const lookup = learnedRoadKey({ sigungu: sigunguToken('부산광역시 해운대구'), roadName: '센텀중앙로', buildingMainNo: 97, buildingSubNo: 0 });
  assert.equal(row.road_key, lookup);
});

test('도로명이 없는 JUSO 응답은 학습하지 않는다 — 의미 키를 만들 수 없다', () => {
  assert.equal(learnedRowFromJuso({ ...JUSO, rn: '' }), null);
});

test('부번이 있는 주소 — 261-8', () => {
  const row = learnedRowFromJuso({ ...JUSO, roadAddr: '경기도 부천시 삼작로 261-8', rn: '삼작로', buldMnnm: '261', buldSlno: '8' });
  assert.equal(row.building_main_no, 261);
  assert.equal(row.building_sub_no, 8);
});

test('아파트가 아니면 is_apartment=false', () => {
  const row = learnedRowFromJuso({ ...JUSO, bdKdcd: '0', bdNm: '경동주택' });
  assert.equal(row.is_apartment, false);
});

test('★도로명주소가 없으면 학습하지 않는다 — 쓰레기를 DB에 넣지 않는다', () => {
  assert.equal(learnedRowFromJuso({ ...JUSO, roadAddr: '', roadAddrPart1: '' }), null);
  assert.equal(learnedRowFromJuso(null), null);
  assert.equal(learnedRowFromJuso({}), null);
});

test('★본번이 없으면 학습하지 않는다 — 건물이 특정되지 않은 주소', () => {
  assert.equal(learnedRowFromJuso({ ...JUSO, buldMnnm: '' }), null);
  assert.equal(learnedRowFromJuso({ ...JUSO, buldMnnm: '0' }), null);
});

test('학습행 → 매칭 결과(JUSO 호환 형태) 변환 — 기존 소비자가 그대로 읽는다', () => {
  const row = learnedRowFromJuso(JUSO, { source: 'juso' });
  const r = learnedRowToResult(row);
  assert.equal(r.roadAddr, '경기도 부천시 삼작로256번길 16');
  assert.equal(r.roadAddrPart1, '경기도 부천시 삼작로256번길 16');
  assert.equal(r.standardRoadAddress, '경기도 부천시 삼작로256번길 16');
  assert.equal(r.rn, '삼작로256번길');
  assert.equal(r.buldMnnm, '16');
  assert.equal(r.buldSlno, '0');
  assert.equal(r.bdNm, '우남아파트');
  assert.equal(r.emdNm, '도당동');
  assert.equal(r.legalDong, '도당동');
  assert.equal(r.zipNo, '14544');
  assert.equal(r._matchSource, 'address_learned:juso');
  assert.equal(r._needsReview, false);
});

test('★신뢰도가 낮게 학습된 건은 확인필요로 올라간다', () => {
  const row = { ...learnedRowFromJuso(JUSO), confidence: 0.5 };
  assert.equal(learnedRowToResult(row)._needsReview, true);
});

test('routeHints 를 실어 보낸다 — 아파트 묶음·도로측면이 끊기면 안 된다(R-E·R-I)', () => {
  const r = learnedRowToResult(learnedRowFromJuso(JUSO));
  assert.ok(r._routeHints);
  assert.ok(r._routeHints.apartmentGroupKey);
  assert.equal(r._routeHints.buildingGroupKey, '4119010300100160000012345');
});

test('입력 방어 — 빈 행이면 null (M-1: 예외로 죽지 않는다)', () => {
  assert.equal(learnedRowToResult(null), null);
  assert.equal(learnedRowToResult({}), null);
});
