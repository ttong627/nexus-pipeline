// ══════════════════════════════════════════════════════════════════
//  학습 주소 매핑 회귀 테스트 (형 지시 2026-08-11)
//  "명단에 있는데 DB에 없는 경우는 API로 검색해서 DB업데이트까지 해주던지."
//  JUSO 응답 ↔ address_learned 행 ↔ 매칭 결과(JUSO 호환 형태) 3자 변환을 고정한다.
//  ★DB 없이 검증 가능한 순수 함수만 여기서 다룬다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnedRowFromJuso, learnedRowToResult, learnedKey } from '../src/learnedStore.js';

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

test('학습 키 — 도로명+본번-부번을 정규화한다(표기 흔들림 흡수)', () => {
  const a = learnedKey('경기도 부천시 삼작로256번길 16');
  assert.equal(a, learnedKey('경기도 부천시 삼작로256번길 16 '));
  assert.equal(a, learnedKey('경기도 부천시  삼작로256번길, 16'));
  assert.ok(a.length > 0);
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
  assert.equal(row.road_key, learnedKey('경기도 부천시 삼작로256번길 16'));
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
