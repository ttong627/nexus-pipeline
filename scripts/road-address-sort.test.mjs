// ══════════════════════════════════════════════════════════════════
//  도로명 주소 순 정렬 회귀 테스트 (형 지시 2026-08-06)
//  배경: 기사 화면 배송순번이 지리와 무관하게 뒤섞여 있었다(박진성 126건 실측
//        56.6km / 300m+ 점프 85회). 도로명 주소순으로만 정렬해도 8.8km·8회로 줄었다.
//  ★함정: 문자열 정렬은 "황물로10길" < "황물로7길" 로 뒤집힌다(V6.85 표시순번과 같은 함정).
//         도로명은 문자열, 건물번호(본번·부번)는 숫자로 비교해야 실제 도로를 따라간다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadAddress, roadAddressCompare, sortByRoadAddress } from '../src/utils/sortRecords.js';

const rec = (주소, extra = {}) => ({ 주소, 이름: extra.이름 || '홍길동', 행정동: extra.행정동 || '', ...extra });
const names = (arr) => arr.map(r => r.주소);

test('parseRoadAddress: 도로명·본번·부번 분해', () => {
  assert.deepEqual(parseRoadAddress('금곡로 137, 405- 402호 (금곡동, 삼익아파트)'), { road: '금곡로', num: 137, sub: 0 });
  assert.deepEqual(parseRoadAddress('금호로23번길 26, 303호'), { road: '금호로23번길', num: 26, sub: 0 });
  assert.deepEqual(parseRoadAddress('답십리로30길 28-5, 1층'), { road: '답십리로30길', num: 28, sub: 5 });
  assert.deepEqual(parseRoadAddress('전농로3가길 9, 1층'), { road: '전농로3가길', num: 9, sub: 0 });
  assert.deepEqual(parseRoadAddress('매산로2가 12'), { road: '매산로2가', num: 12, sub: 0 });
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
  assert.deepEqual(sorted.map(r => r.이름), ['이은희', '하다연', '최미나', '김관중', '박덕신']);
});
