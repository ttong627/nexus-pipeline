// ══════════════════════════════════════════════════════════════════
//  A-23 보강 회귀 — 숫자와 가지접미사 사이 공백 (2026-08-12)
//  대상: services/address-service/src/shared/detailNormalize.js
//        `normalizeRoadAddressSpacing`
//
//  ★막는 사고
//    `봉우재로 36 번길 3` 처럼 **숫자와 `번길` 사이에 공백**이 있으면 도로명이 안 붙었다.
//    그러면 파서가 `봉우재로 36` 까지만 도로로 보고 **`번길` 을 건물명 슬롯에 떨어뜨린다.**
//    실제 명단에 이렇게 저장돼 있었다(2026-08-12 전수 실측):
//      `봉우재로 36, (정왕동, 번길)` · `봉우재로 37, (정왕동, 번길)` · `정왕대로 233, (정왕동, 번안길)`
//    실제 도로는 `봉우재로36번길`·`봉우재로37번길`·`정왕대로233번안길` 로 전부 실재한다
//    (행안부 도로명주소 원본DB 대조 — 각 7·20·47행).
//    정제주소를 못 만들면 지오코딩이 도로명 조각으로 나가 **전국에서 아무 데나 맞는다**(최대 201km 실측).
//
//  ★건물명 칸의 `번길`·`번안길` 은 건물이 아니라 잘려나간 도로명 꼬리다 — 탐지 신호로 쓸 수 있다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoadAddressSpacing } from '../services/address-service/src/shared/detailNormalize.js';
import { joinSpacedBranchRoad } from '../services/address-service/src/shared/roadTokens.js';
import { parseRoadNumber, formatRoadLookupQuery } from '../services/address-service/src/normalize.js';

// ── ① 붙여야 하는 것 ──────────────────────────────────────────────
test('★숫자와 가지접미사 사이 공백을 붙인다 — 실제 명단에서 깨져 있던 형태', () => {
  assert.equal(normalizeRoadAddressSpacing('봉우재로 36 번길 3'), '봉우재로36번길 3');
  assert.equal(normalizeRoadAddressSpacing('봉우재로 37 번길 5'), '봉우재로37번길 5');
  assert.equal(normalizeRoadAddressSpacing('정왕대로 233 번안길 12'), '정왕대로233번안길 12');
  assert.equal(normalizeRoadAddressSpacing('신천로 25 번길 1-1'), '신천로25번길 1-1');
});

test('번길 외 가지접미사도 같이 붙인다', () => {
  assert.equal(normalizeRoadAddressSpacing('중앙로 3 가길 7'), '중앙로3가길 7');
  assert.equal(normalizeRoadAddressSpacing('한밭대로 10 나길'), '한밭대로10나길');
});

// ── ② 절대 붙이면 안 되는 것 (가드 없으면 여기서 터진다) ──────────
test('★가지접미사 뒤에 한글이 오면 도로명이 아니라 건물명이다 — 붙이지 않는다', () => {
  // 가드를 빼면 "중앙로12길동아파트"·"시청로20길가온마을"로 붙어버린다(실측된 퇴행)
  assert.equal(normalizeRoadAddressSpacing('중앙로 12 길동아파트'), '중앙로 12 길동아파트');
  assert.equal(normalizeRoadAddressSpacing('시청로 20 길가온마을'), '시청로 20 길가온마을');
  assert.equal(normalizeRoadAddressSpacing('중앙로 8 나길동아파트'), '중앙로 8 나길동아파트');
});

test('가지접미사가 아닌 낱말은 건드리지 않는다', () => {
  assert.equal(normalizeRoadAddressSpacing('테헤란로 123 번영빌딩'), '테헤란로 123 번영빌딩');
  assert.equal(normalizeRoadAddressSpacing('평천로 739 번지'), '평천로 739 번지');
  assert.equal(normalizeRoadAddressSpacing('새말로 5 번영로'), '새말로 5 번영로');
});

test('건물명·상세주소가 뒤따르는 정상 주소는 불변', () => {
  assert.equal(normalizeRoadAddressSpacing('부천로 245 성원아파트'), '부천로 245 성원아파트');
  assert.equal(normalizeRoadAddressSpacing('삼작로 280 한남빌리지'), '삼작로 280 한남빌리지');
  assert.equal(normalizeRoadAddressSpacing('마지로 134 102호'), '마지로 134 102호');
  assert.equal(normalizeRoadAddressSpacing('역곡로 65 3층302호'), '역곡로 65 3층302호');
});

// ── ③ 기존 A-23 동작 보존 (퇴행 감시) ─────────────────────────────
test('기존 A-23 동작은 그대로다 — 붙어 있는 형태', () => {
  assert.equal(normalizeRoadAddressSpacing('사가정로 2길'), '사가정로2길');
  assert.equal(normalizeRoadAddressSpacing('홍양길 43번길'), '홍양길43번길');
  assert.equal(normalizeRoadAddressSpacing('봉우재로 36번길 3'), '봉우재로36번길 3');
  assert.equal(normalizeRoadAddressSpacing('봉우재로36번길 3'), '봉우재로36번길 3');
});

// ── ④ ★정제 경로와 서버 매칭 경로가 같은 규칙을 쓰는가 ──────────────
//    두 경로에 각자 정규식이 있었고 미묘하게 달랐다. 규칙이 갈리면
//    정제는 `봉우재로36번길` 로 보는데 매칭은 `봉우재로 36` 으로 봐서 **조용히 어긋난다.**
test('★서버 매칭 경로(parseRoadNumber)도 같은 도로명을 뽑는다', () => {
  assert.deepEqual(
    { r: parseRoadNumber('봉우재로 36 번길 3')?.roadName, n: parseRoadNumber('봉우재로 36 번길 3')?.buildingMainNo },
    { r: '봉우재로36번길', n: 3 },
    '매칭 경로가 `봉우재로`+36 으로 읽으면 전혀 다른 도로를 찾는다',
  );
  assert.equal(parseRoadNumber('정왕대로 233 번안길 12')?.roadName, '정왕대로233번안길');
  assert.equal(formatRoadLookupQuery('봉우재로 36 번길 3'), '봉우재로36번길 3');
});

test('서버 매칭 경로도 건물명은 안 붙인다 — 같은 가드가 걸려 있어야 한다', () => {
  assert.equal(parseRoadNumber('중앙로 12 길동아파트')?.roadName, '중앙로');
  assert.equal(parseRoadNumber('중앙로 12 길동아파트')?.buildingMainNo, 12);
});

test('규칙 본체는 한 곳에만 있다 — joinSpacedBranchRoad 가 SSOT', () => {
  assert.equal(joinSpacedBranchRoad('봉우재로 36 번길 3'), '봉우재로36번길 3');
  assert.equal(joinSpacedBranchRoad('중앙로 12 길동아파트'), '중앙로 12 길동아파트');
});
