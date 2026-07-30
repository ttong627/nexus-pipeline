// A-10 동호 형식 정규화 회귀 테스트 — node --test scripts/dong-ho-format.test.mjs
//   형 지시(2026-07-30):
//     ① '층을 호 뒤로' 이동은 **앞에 숫자 동(101동·1307동)이 붙을 때만** 적용
//     ② 동이 없거나 비숫자 동(가동·A동·B동·1-1동)이면 층 위치를 **원본 그대로 보존**
//     ③ 동 대신 대시로 쓰인 숫자 동(101-203호)도 숫자 동으로 인식해 **같은 형식**으로 저장
//   입력은 A-18(제 접두어 제거)·A-19(붙여쓰기 분리)를 거친 상세주소 문자열을 가정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDongHoDetail, DONG_DASH_HO_SRC } from '../src/engine/dongHoFormat.js';

// ── ① 숫자 동(대단지 아파트) — 기존 동작 유지: 대시 + 호 4자리 패딩 + 층은 호 뒤로 ──
test('숫자 동: 층을 호 뒤로 이동 + 대시 + 호 4자리 패딩', () => {
  assert.equal(normalizeDongHoDetail('101동 3층 203호'), '101- 203호 3층');
  assert.equal(normalizeDongHoDetail('1307동 2층 1502호'), '1307-1502호 2층');
  assert.equal(normalizeDongHoDetail('101동 지하1층 104호'), '101- 104호 지하1층');
});

test('숫자 동: 층 없으면 대시 + 패딩만', () => {
  assert.equal(normalizeDongHoDetail('101동 203호'), '101- 203호');
  assert.equal(normalizeDongHoDetail('102동 1203호'), '102-1203호');
});

test('숫자 동: 층이 이미 호 뒤면 그대로', () => {
  assert.equal(normalizeDongHoDetail('101동 203호 3층'), '101- 203호 3층');
});

// ── ② 비숫자 동(빌라·연립) — 층 이동 금지, 동 유지 ──
test('한글 동: 층을 옮기지 않고 원본 순서 보존', () => {
  assert.equal(normalizeDongHoDetail('가동 3층 101호'), '가동 3층 101호');
  assert.equal(normalizeDongHoDetail('나동 2층 201호'), '나동 2층 201호');
});

test('영문 동: 층을 옮기지 않고 원본 순서 보존', () => {
  assert.equal(normalizeDongHoDetail('A동 2층 305호'), 'A동 2층 305호');
  assert.equal(normalizeDongHoDetail('B동 지하1층 104호'), 'B동 지하1층 104호');
});

test('대시 동(1-1동): 층을 옮기지 않고 동 유지', () => {
  assert.equal(normalizeDongHoDetail('1-1동 3층 100호'), '1-1동 3층 100호');
});

test('비숫자 동: 층 없으면 기존과 동일(동 유지·패딩 없음)', () => {
  assert.equal(normalizeDongHoDetail('가동 101호'), '가동 101호');
  assert.equal(normalizeDongHoDetail('B동 104호'), 'B동 104호');
});

// ── ② 동이 없는 경우 — 층 이동 금지 + 호수 4자리 패딩(정렬용, 기존 동작) ──
test('동 없음: 층은 그대로, 호수만 4자리 우측정렬 패딩', () => {
  assert.equal(normalizeDongHoDetail('3층 101호'), '3층  101호');
  assert.equal(normalizeDongHoDetail('지하1층 102호'), '지하1층  102호');
  assert.equal(normalizeDongHoDetail('302호'), ' 302호');
  assert.equal(normalizeDongHoDetail('1008호'), '1008호');
});

// ── ③ 대시로 쓰인 숫자 동 — 숫자 동과 동일 형식으로 저장 ──
test('대시 숫자 동: 호 4자리 패딩 적용', () => {
  assert.equal(normalizeDongHoDetail('101-203호'), '101- 203호');
  assert.equal(normalizeDongHoDetail('101-1307호'), '101-1307호');
});

test('대시 숫자 동: 층을 호 뒤로 이동', () => {
  assert.equal(normalizeDongHoDetail('101-3층 203호'), '101- 203호 3층');
  assert.equal(normalizeDongHoDetail('1307-지하1층 1502호'), '1307-1502호 지하1층');
});

test('대시 숫자 동: 층이 이미 호 뒤면 그대로', () => {
  assert.equal(normalizeDongHoDetail('101-203호 3층'), '101- 203호 3층');
});

// ── 오적용 차단(형 안전방침: 지번 부번을 동으로 오인 금지) ──
test('지번 부번 형태(동 2자리 이하·호 2자리 이하)는 손대지 않음', () => {
  assert.equal(normalizeDongHoDetail('40-25호'), '40-25호');
  assert.equal(normalizeDongHoDetail('1-2호'), '1-2호');
});

test('호 표기 없는 대시(101-203)는 손대지 않음 — 지번과 구분 불가', () => {
  assert.equal(normalizeDongHoDetail('101-203'), '101-203');
});

// ── 멱등성(재정제 반복 시 표기 흔들림 금지) ──
// 실제 파이프라인은 정규화 직후 addressEngine의 normalizeAddressDetail이 연속 공백을 1칸으로 접는다
// (addressEngine.js:1338). 저장값 재정제 시 표기가 흔들리지 않는지는 그 단계까지 포함해 검증한다.
const collapse = (s) => String(s).replace(/\s+/g, ' ').replace(/^[\s,/]+|[\s,/]+$/g, '');
const pipeline = (s) => collapse(normalizeDongHoDetail(s));

test('멱등성: 파이프라인(공백 접기 포함) 두 번 통과해도 결과 동일', () => {
  for (const src of [
    '101동 3층 203호', '가동 3층 101호', 'A동 2층 305호', '3층 101호',
    '101-203호', '101-3층 203호', '1307동 2층 1502호', '1-1동 3층 100호',
    'B동 지하1층 104호', '302호', '1008호', '101동 203호',
  ]) {
    const once = pipeline(src);
    assert.equal(pipeline(once), once, `멱등 실패: ${JSON.stringify(src)}`);
  }
});

test('멱등성: 숫자 동 패딩(공백 1칸)은 공백 접기 후에도 보존', () => {
  assert.equal(pipeline('101동 3층 203호'), '101- 203호 3층');
  assert.equal(pipeline('101-3층 203호'), '101- 203호 3층');
});

// ── 빈값·잡값 방어 ──
test('빈값·null 방어', () => {
  assert.equal(normalizeDongHoDetail(''), '');
  assert.equal(normalizeDongHoDetail(null), '');
  assert.equal(normalizeDongHoDetail(undefined), '');
});

// ── 파서 인식용 정규식 소스(상세주소 판별에 주입) ──
test('DONG_DASH_HO_SRC: 대시 동호를 상세주소로 인식', () => {
  const re = new RegExp(`^(?:${DONG_DASH_HO_SRC})`, 'u');
  assert.equal(re.test('101-203호'), true);
  assert.equal(re.test('101- 203호'), true);
  assert.equal(re.test('101-3층 203호'), true);
  assert.equal(re.test('1307-1502호'), true);
  // 지번 오인 차단
  assert.equal(re.test('40-25호'), false);
  assert.equal(re.test('1-2호'), false);
  assert.equal(re.test('101-203'), false);
});
