/**
 * 출입구 파서 테스트 — 픽스처는 **형이 받은 실제 파일에서 그대로 뽑은 줄**이다.
 * (공개 주소자료라 PII 아님. 이름·전화 없음.)
 *
 * 실행: node --test scripts/entrc-parser.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHANGE_DELETE,
  CHANGE_INSERT,
  detectLayout,
  entranceKey,
  isBuildingGroup,
  parseEntranceLine,
  parseEntranceLines,
} from '../src/entrance/entrcParser.js';

// 실측: entrc_sejong.txt 1행 (위치정보요약DB 전체분, 18필드)
const ENTRC = '36110|32169|3611010100|세종특별자치시||반곡동|361102000002|한누리대로|0|1811|0|수루배마을5단지 상가동|30145|근린생활시설|0|반곡동|983296.172464|1833330.968984';

// 실측: RNENTDATA_2607_36110.txt 1행 (연계 자료, 19필드)
const LINK = '36110101200000200181100000|3611010100|세종특별자치시||반곡동||361102000002|한누리대로|0|1811|0|30145|20181204||32169|RM|01|983296.172464|1833330.968984';

// 실측: AlterD.JUSUEC.20260717...TXT 1행 (연계 일변동 — 14번 필드에 이동사유코드 31)
const LINK_ALTER = '11110108410030400000700000|1111010800|서울특별시|종로구|통인동||111104100304|자하문로9길|0|7|0|03040|20260716|31|35756|RM|01|953276.096598|1953467.668452';

test('레이아웃 판별 — 1번 필드 생김새로 구분한다(필드 수로는 구분 불가)', () => {
  assert.equal(detectLayout(ENTRC), 'entrc');
  assert.equal(detectLayout(LINK), 'link');
  assert.equal(detectLayout(LINK_ALTER), 'link');
  assert.equal(detectLayout(''), null);
  assert.equal(detectLayout('a|b|c'), null);
});

test('★entrc 18필드가 버려지지 않는다 (C7 회귀 방지)', () => {
  // yyplus juso-sync 는 "19필드 미만이면 폐기"라 이 줄을 통째로 버렸다.
  const rec = parseEntranceLine(ENTRC);
  assert.ok(rec, 'entrc 18필드 줄이 폐기되면 안 된다');
  assert.equal(rec.layout, 'entrc');
});

test('entrc — 명세 §1 컬럼이 제자리에 들어간다', () => {
  const r = parseEntranceLine(ENTRC);
  assert.equal(r.entranceNo, '32169');
  assert.equal(r.legalDongCode, '3611010100');
  assert.equal(r.sido, '세종특별자치시');
  assert.equal(r.sigungu, null);          // 세종은 시군구가 없다(빈 필드)
  assert.equal(r.emd, '반곡동');
  assert.equal(r.roadCode, '361102000002');
  assert.equal(r.roadName, '한누리대로');
  assert.equal(r.mainNo, 1811);
  assert.equal(r.subNo, 0);
  assert.equal(r.zipCode, '30145');
  // ★연계 자료에는 없는 정보
  assert.equal(r.buildingName, '수루배마을5단지 상가동');
  assert.equal(r.buildingUse, '근린생활시설');
  assert.equal(r.buildingGroupYn, '0');
  assert.equal(r.adminDong, '반곡동');
  assert.equal(r.x, 983296.172464);
  assert.equal(r.y, 1833330.968984);
});

test('link — 관리번호가 잡히고 건물정보는 null 이다', () => {
  const r = parseEntranceLine(LINK);
  assert.equal(r.addressMgtNo, '36110101200000200181100000');
  assert.equal(r.entranceNo, '32169');
  assert.equal(r.roadCode, '361102000002');
  assert.equal(r.mainNo, 1811);
  assert.equal(r.buildingName, null, '연계 자료엔 건물명이 없다');
  assert.equal(r.buildingUse, null);
  assert.equal(r.x, 983296.172464);
  assert.equal(r.y, 1833330.968984);
});

test('★두 데이터셋의 같은 출입구는 좌표가 일치한다 (교차검증)', () => {
  const a = parseEntranceLine(ENTRC);
  const b = parseEntranceLine(LINK);
  assert.equal(a.entranceNo, b.entranceNo);
  assert.equal(a.x, b.x);
  assert.equal(a.y, b.y);
  assert.equal(entranceKey(a), entranceKey(b), 'PK도 같아야 조인이 된다');
});

test('일변동 — 이동사유코드를 읽는다(31 생성)', () => {
  const r = parseEntranceLine(LINK_ALTER);
  assert.equal(r.changeReason, CHANGE_INSERT);
  assert.equal(r.sigungu, '종로구');
  assert.equal(r.roadName, '자하문로9길');
});

test('★entrc 변동분(19필드)은 꼬리의 이동사유코드를 읽고 좌표를 밀리지 않게 집는다', () => {
  const mod = `${ENTRC}|${CHANGE_DELETE}`;
  const r = parseEntranceLine(mod);
  assert.equal(r.layout, 'entrc', '19필드여도 1번 필드가 관리번호가 아니면 entrc');
  assert.equal(r.changeReason, CHANGE_DELETE);
  assert.equal(r.x, 983296.172464, '좌표가 한 칸 밀리면 안 된다');
  assert.equal(r.y, 1833330.968984);
});

test('건물군 여부 — 300002 동 도형 연결 대상 판별', () => {
  assert.equal(isBuildingGroup(parseEntranceLine(ENTRC)), false);
  const grp = ENTRC.split('|');
  grp[14] = '1';   // 건물군여부
  assert.equal(isBuildingGroup(parseEntranceLine(grp.join('|'))), true);
});

test('좌표 없는 건물(비공개·공개제한)은 폐기하지 않고 null 로 살린다', () => {
  const f = ENTRC.split('|');
  f[16] = ''; f[17] = '';
  const r = parseEntranceLine(f.join('|'));
  assert.ok(r, '좌표가 없다고 주소까지 버리면 안 된다');
  assert.equal(r.x, null);
  assert.equal(r.y, null);
  assert.equal(r.buildingName, '수루배마을5단지 상가동');
});

test('집계 — 레이아웃·사유·무좌표를 센다', () => {
  const f = ENTRC.split('|'); f[16] = ''; f[17] = '';
  const { records, stats } = parseEntranceLines([
    ENTRC, LINK, LINK_ALTER, f.join('|'), '', '깨진|줄',
  ]);
  assert.equal(records.length, 4);
  assert.equal(stats.ok, 4);
  assert.equal(stats.skipped, 1);          // '깨진|줄'
  assert.equal(stats.noCoord, 1);
  assert.equal(stats.byLayout.entrc, 2);
  assert.equal(stats.byLayout.link, 2);
  assert.equal(stats.byReason[CHANGE_INSERT], 1);
});
