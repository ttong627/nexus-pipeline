// ══════════════════════════════════════════════════════════════════
//  도로명 주소 순 정렬 회귀 테스트 (형 지시 2026-08-06)
//  배경: 기사 화면 배송순번이 지리와 무관하게 뒤섞여 있었다(박진성 126건 실측
//        56.6km / 300m+ 점프 85회). 도로명 주소순으로만 정렬해도 8.8km·8회로 줄었다.
//  ★함정: 문자열 정렬은 "황물로10길" < "황물로7길" 로 뒤집힌다(V6.85 표시순번과 같은 함정).
//         도로명은 문자열, 건물번호(본번·부번)는 숫자로 비교해야 실제 도로를 따라간다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadAddress, roadAddressCompare, sortByRoadAddress, deliveryCompare } from '../src/utils/sortRecords.js';

const rec = (주소, extra = {}) => ({ 주소, 이름: extra.이름 || '홍길동', 행정동: extra.행정동 || '', ...extra });
const names = (arr) => arr.map(r => r.주소);
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));

test('parseRoadAddress: 도로명·본번·부번 분해', () => {
  const base = ['road', 'num', 'sub'];
  assert.deepEqual(pick(parseRoadAddress('금곡로 137, 405- 402호 (금곡동, 삼익아파트)'), base), { road: '금곡로', num: 137, sub: 0 });
  assert.deepEqual(pick(parseRoadAddress('금호로23번길 26, 303호'), base), { road: '금호로23번길', num: 26, sub: 0 });
  assert.deepEqual(pick(parseRoadAddress('답십리로30길 28-5, 1층'), base), { road: '답십리로30길', num: 28, sub: 5 });
  assert.deepEqual(pick(parseRoadAddress('전농로3가길 9, 1층'), base), { road: '전농로3가길', num: 9, sub: 0 });
  assert.deepEqual(pick(parseRoadAddress('매산로2가 12'), base), { road: '매산로2가', num: 12, sub: 0 });
});

// ══════════════════════════════════════════════════════════════════
//  ★가지도로 분기 정렬 (형 현장 지시 2026-08-11)
//  "실제로 삼작로를 주행하면 삼작로 258 보다 삼작로256번길이 먼저 나온다."
//  N번길은 모도로의 건물번호 N 지점에서 갈라지므로, 모도로 번호 N 자리에 끼워 넣어야
//  주행 순서와 같아진다. 도로명을 문자열로 묶으면 "삼작로" 전체 → "삼작로256번길" 전체가 되어
//  256 지점을 지나친 뒤 되돌아오는 역주행이 된다.
// ══════════════════════════════════════════════════════════════════
test('parseRoadAddress: N번길은 기초번호 — 모도로 + 분기번호로 분해', () => {
  const b = ['parentRoad', 'branchNo', 'isBranch'];
  assert.deepEqual(pick(parseRoadAddress('삼작로256번길 16'), b), { parentRoad: '삼작로', branchNo: 256, isBranch: 1 });
  assert.deepEqual(pick(parseRoadAddress('금호로23번길 26'), b), { parentRoad: '금호로', branchNo: 23, isBranch: 1 });
  assert.deepEqual(pick(parseRoadAddress('강남대로12번길 5'), b), { parentRoad: '강남대로', branchNo: 12, isBranch: 1 });
  // 모도로 본번은 자기 번호가 곧 분기위치 — 같은 축에서 비교된다
  assert.deepEqual(pick(parseRoadAddress('삼작로 258'), b), { parentRoad: '삼작로', branchNo: 258, isBranch: 0 });
});

// ★서울식 'N길'은 일련번호(1길·2길·3길…)일 수 있어 N을 모도로 건물번호로 쓰면 엉뚱한 곳에 꽂힌다.
//   분기 건물번호를 확인하기 전까지는 현행(모도로 뒤에 별도 그룹)을 그대로 유지한다 — 함부로 끼워넣지 않는다.
test('parseRoadAddress: N길은 분기점 미확인 → 현행 유지(자기 자신이 모도로)', () => {
  const b = ['parentRoad', 'branchNo', 'isBranch'];
  assert.deepEqual(pick(parseRoadAddress('사가정로2길 92'), b), { parentRoad: '사가정로2길', branchNo: 92, isBranch: 0 });
  assert.deepEqual(pick(parseRoadAddress('전농로3가길 9'), b), { parentRoad: '전농로3가길', branchNo: 9, isBranch: 0 });
  // '매산로2가'는 법정동 표기지 가지도로가 아니다 — 분기로 오인하면 안 된다
  assert.deepEqual(pick(parseRoadAddress('매산로2가 12'), b), { parentRoad: '매산로2가', branchNo: 12, isBranch: 0 });
});

// ★형 지시 2단계: 'N길'의 실제 분기 건물번호를 조회해 넘겨주면 그 자리에 끼워 넣는다.
test('분기점 표를 주면 N길도 그 건물번호 자리에 들어간다 (2단계 연동 지점)', () => {
  const branchIndex = { '사가정로2길': 40 };   // 사가정로 40번 건물 앞에서 갈라짐
  const r = parseRoadAddress('사가정로2길 92', branchIndex);
  assert.deepEqual(pick(r, ['parentRoad', 'branchNo', 'isBranch']), { parentRoad: '사가정로', branchNo: 40, isBranch: 1 });

  const sorted = sortByRoadAddress(
    [rec('사가정로 55'), rec('사가정로2길 92'), rec('사가정로 21')],
    { branchIndex },
  );
  assert.deepEqual(names(sorted), ['사가정로 21', '사가정로2길 92', '사가정로 55']);
});

test('★형 지시: 삼작로256번길이 삼작로 258보다 먼저 (주행 순서)', () => {
  const sorted = sortByRoadAddress([
    rec('삼작로 258, 601호'), rec('삼작로256번길 16, 가동 205호'),
    rec('삼작로 267, 1- 113호'), rec('삼작로256번길 11-10, 4동 4- 501호'),
    rec('삼작로 250'),
  ]);
  assert.deepEqual(names(sorted), [
    '삼작로 250',                       // 250 지점
    '삼작로256번길 11-10, 4동 4- 501호',  // 256 지점에서 갈라지는 가지도로(부번 11-10)
    '삼작로256번길 16, 가동 205호',       // 같은 가지도로 안에서는 번호순
    '삼작로 258, 601호',                // 다시 모도로 258
    '삼작로 267, 1- 113호',
  ]);
});

test('가지도로와 모도로 본번이 같은 번호면 모도로 먼저 (골목에 들어가기 전에 큰길 건물)', () => {
  const sorted = sortByRoadAddress([rec('삼작로256번길 3'), rec('삼작로 256'), rec('삼작로 257')]);
  assert.deepEqual(names(sorted), ['삼작로 256', '삼작로256번길 3', '삼작로 257']);
});

test('★정제화면·엑셀(deliveryCompare)에도 같은 법칙이 걸린다 — 화면과 배송표 순서가 갈라지면 안 된다', () => {
  const rows = [
    rec('삼작로 258, 601호', { 행정동: '도당동' }),
    rec('삼작로256번길 16, 가동 205호', { 행정동: '도당동' }),
    rec('삼작로 267, 1- 113호', { 행정동: '도당동' }),
  ];
  assert.deepEqual(names([...rows].sort(deliveryCompare)), [
    '삼작로256번길 16, 가동 205호', '삼작로 258, 601호', '삼작로 267, 1- 113호',
  ]);
});

test('parseRoadAddress: 도로명이 없으면 road 빈값 + 번호는 최대값(뒤로 밀림)', () => {
  const r = parseRoadAddress('장곡동 344');
  assert.equal(r.road, '');
  assert.equal(r.num, Number.MAX_SAFE_INTEGER);
});

test('★건물번호는 숫자로 비교 — 7번지가 10번지보다 먼저', () => {
  const sorted = sortByRoadAddress([rec('금곡로 10'), rec('금곡로 7'), rec('금곡로 137'), rec('금곡로 45')]);
  assert.deepEqual(names(sorted), ['금곡로 7', '금곡로 10', '금곡로 45', '금곡로 137']);
});

test('★도로명 안의 숫자도 자연 정렬 — 사가정로2길 < 사가정로10길', () => {
  const sorted = sortByRoadAddress([rec('사가정로10길 5'), rec('사가정로2길 92'), rec('사가정로 21')]);
  assert.deepEqual(names(sorted), ['사가정로 21', '사가정로2길 92', '사가정로10길 5']);
});

test('부번(-N)까지 숫자 비교 — 28-5 가 28-12 보다 먼저', () => {
  const sorted = sortByRoadAddress([rec('답십리로30길 28-12'), rec('답십리로30길 28-5'), rec('답십리로30길 28')]);
  assert.deepEqual(names(sorted), ['답십리로30길 28', '답십리로30길 28-5', '답십리로30길 28-12']);
});

test('같은 건물이면 동·호수 자연 정렬 (302호 < 1008호)', () => {
  const sorted = sortByRoadAddress([
    rec('금곡로 229, 1034호'), rec('금곡로 229, 613호'), rec('금곡로 229, 831호'),
  ]);
  assert.deepEqual(names(sorted), ['금곡로 229, 613호', '금곡로 229, 831호', '금곡로 229, 1034호']);
});

test('행정동이 다르면 행정동 먼저 (동 단위로 묶여야 동선이 안 끊긴다)', () => {
  const sorted = sortByRoadAddress([
    rec('가로 1', { 행정동: '을동' }), rec('나로 1', { 행정동: '갑동' }),
  ]);
  assert.deepEqual(sorted.map(r => r.행정동), ['갑동', '을동']);
});

test('★도로명 없는 주소(지번·주민센터)는 맨 뒤로 — 앞에 끼어들면 동선이 끊긴다', () => {
  const sorted = sortByRoadAddress([rec('장곡동 344'), rec('금곡로 7'), rec('금곡동 주민센터')]);
  assert.equal(sorted[0].주소, '금곡로 7');
  assert.equal(sorted.length, 3);
  assert.ok(!sorted.slice(1).some(r => r.주소 === '금곡로 7'));
});

test('같은 주소면 이름순 — 순서가 실행마다 흔들리지 않는다', () => {
  const sorted = sortByRoadAddress([
    rec('금곡로 7', { 이름: '홍길동' }), rec('금곡로 7', { 이름: '강감찬' }),
  ]);
  assert.deepEqual(sorted.map(r => r.이름), ['강감찬', '홍길동']);
});

test('불변 — 원본 배열을 건드리지 않는다', () => {
  const src = [rec('금곡로 137'), rec('금곡로 7')];
  const before = names(src);
  sortByRoadAddress(src);
  assert.deepEqual(names(src), before);
});

test('빈값·null 방어 (M-1 무손실: 어떤 입력도 건수를 잃지 않는다)', () => {
  assert.deepEqual(sortByRoadAddress(null), []);
  assert.deepEqual(sortByRoadAddress(undefined), []);
  const withHoles = [rec('금곡로 7'), { 이름: '주소없음' }, rec('금곡로 3')];
  assert.equal(sortByRoadAddress(withHoles).length, 3);
});

test('roadAddressCompare는 .sort() 콜백으로 그대로 쓸 수 있다', () => {
  const arr = [rec('나로 2'), rec('가로 10'), rec('가로 2')];
  assert.deepEqual(names([...arr].sort(roadAddressCompare)), ['가로 2', '가로 10', '나로 2']);
});

test('실데이터 형태 — 박진성 기사 앞 구간이 도로·번호 순으로 늘어선다', () => {
  const sorted = sortByRoadAddress([
    rec('금호로23번길 26, 303호 (금곡동, 현대아파트)', { 이름: '김관중', 행정동: '금곡동' }),
    rec('서수원로 607, 108- 403호 (금곡동, 강남아파트)', { 이름: '박덕신', 행정동: '금곡동' }),
    rec('금곡로196번길 98, 411호 (금곡동, 나천8차)', { 이름: '하다연', 행정동: '금곡동' }),
    rec('금곡로 229, 334호 (금곡동, 코오롱3차)', { 이름: '이은희', 행정동: '금곡동' }),
    rec('금호로 45, 102- 104호 (금곡동, 삼익1차)', { 이름: '최미나', 행정동: '금곡동' }),
  ]);
  // 번길은 모도로 분기번호 자리로 들어간다: 금곡로196번길(196) < 금곡로 229, 금호로23번길(23) < 금호로 45
  assert.deepEqual(sorted.map(r => r.이름), ['하다연', '이은희', '김관중', '최미나', '박덕신']);
});
