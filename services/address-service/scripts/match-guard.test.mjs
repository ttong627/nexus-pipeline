// ══════════════════════════════════════════════════════════════════
//  유사매칭 채택 게이트 회귀 테스트 (형 지시 2026-08-11)
//  배경: "신축 건물의 경우 다른 건물로 유사 매칭하는 오류가 발생하고 있어."
//  원인: 주소DB는 월 전체분(현재 202605 = 2026-05-31 기준)이라 그 이후 신축이 없다.
//        건물번호가 없는 질의(건물명만)는 fuzzyMatch(≥0.42) → buildingMatch(≥0.45)로
//        내려가는데, 두 곳 모두 **트리그램 점수만 보고** 이름 포함관계·차수·번호를
//        전혀 검증하지 않아 이름이 절반만 닮은 **인접 단지를 그대로 채택**했다.
//  원칙: 오매칭(엉뚱한 집에 배송) > 미매칭(확인필요로 담당자 처리).
//        애매하면 버리고 확인필요로 넘긴다(A-12).
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeCandidate, buildingNameKey, parseComplexPhase } from '../src/matchGuard.js';

const cand = (o = {}) => ({
  score: 0.9, building_name: '', road_address: '', building_main_no: null, building_sub_no: 0, ...o,
});

test('건물명 정규화 — 유형어를 걷어내면 같은 단지가 같아진다', () => {
  assert.equal(buildingNameKey('무지개마을주공아파트2단지'), buildingNameKey('무지개주공2단지'));
  assert.equal(buildingNameKey('삼보아파트'), '삼보');
  assert.equal(buildingNameKey('우남APT'), '우남');
  assert.equal(buildingNameKey(''), '');
});

test('차수 파싱 — 1차와 2차는 다른 단지다', () => {
  assert.equal(parseComplexPhase('현대아파트 2차'), 2);
  assert.equal(parseComplexPhase('삼익1차'), 1);
  assert.equal(parseComplexPhase('무지개아파트'), null);
});

// ── 핵심: 신축이 인접 단지로 둔갑하는 것을 막는다 ──────────────────
// ※2026-08-11 형 지시로 **건물명으로 주소를 찾는 경로 자체가 폐지**됐다.
//   이 게이트는 이제 외부(JUSO)·학습 결과가 '물어본 그 주소'인지 검증하는 데 쓰인다.
//   아래 건물명 규칙은 그 검증에서 건물명 비교가 필요할 때를 위해 남긴다.
test('건물명 포함관계가 없으면 버린다', () => {
  const r = judgeCandidate({
    rawQuery: '한울에코팰리스', kind: 'building',
    candidate: cand({ score: 0.52, building_name: '한울마을주공' }),
  });
  assert.equal(r.accept, false);
  assert.match(r.reason, /포함관계/);
});

test('★차수가 다르면 버린다 — 1차 신청자를 2차로 보내면 안 된다', () => {
  const r = judgeCandidate({
    rawQuery: '삼익아파트 2차', kind: 'building',
    candidate: cand({ score: 0.88, building_name: '삼익아파트 1차' }),
  });
  assert.equal(r.accept, false);
  assert.match(r.reason, /차수/);
});

test('★질의에 건물번호가 있으면 본번이 같아야 한다 — 옆 건물 채택 차단', () => {
  const r = judgeCandidate({
    rawQuery: '삼작로 258', kind: 'fuzzy',
    queryRoad: { buildingMainNo: 258, buildingSubNo: 0 },
    candidate: cand({ score: 0.93, building_main_no: 256, building_sub_no: 0 }),
  });
  assert.equal(r.accept, false);
  assert.match(r.reason, /본번/);
});

test('부번까지 본다 — 261-6 과 261-8 은 다른 건물', () => {
  const r = judgeCandidate({
    rawQuery: '삼작로 261-8', kind: 'fuzzy',
    queryRoad: { buildingMainNo: 261, buildingSubNo: 8 },
    candidate: cand({ score: 0.95, building_main_no: 261, building_sub_no: 6 }),
  });
  assert.equal(r.accept, false);
  assert.match(r.reason, /부번/);
});

test('유사도 미달은 그대로 버린다', () => {
  assert.equal(judgeCandidate({ rawQuery: '삼보', kind: 'building',
    candidate: cand({ score: 0.30, building_name: '삼보' }) }).accept, false);
  assert.equal(judgeCandidate({ rawQuery: '삼보', kind: 'fuzzy',
    candidate: cand({ score: 0.30 }) }).accept, false);
});

// ── 정상 건은 계속 통과해야 한다(미매칭 폭증 방지) ─────────────────
test('같은 단지의 표기 차이는 통과한다 — 미매칭이 늘면 그것도 사고다', () => {
  const r = judgeCandidate({
    rawQuery: '무지개마을주공아파트2단지', kind: 'building',
    candidate: cand({ score: 0.86, building_name: '무지개주공2단지' }),
  });
  assert.equal(r.accept, true, r.reason);
});

test('본번이 일치하면 통과한다', () => {
  const r = judgeCandidate({
    rawQuery: '삼작로 258', kind: 'fuzzy',
    queryRoad: { buildingMainNo: 258, buildingSubNo: 0 },
    candidate: cand({ score: 0.9, building_main_no: 258, building_sub_no: 0 }),
  });
  assert.equal(r.accept, true, r.reason);
});

test('질의에 번호가 없으면 번호 규칙은 건너뛴다', () => {
  const r = judgeCandidate({
    rawQuery: '우남APT', kind: 'building',
    candidate: cand({ score: 0.8, building_name: '우남아파트', building_main_no: 16 }),
  });
  assert.equal(r.accept, true, r.reason);
});

// ── 채택하되 확인이 필요한 구간 ───────────────────────────────────
test('★한쪽이 크게 길면 채택하되 확인필요로 표시한다 (삼보 vs 삼보그린)', () => {
  const r = judgeCandidate({
    rawQuery: '삼보아파트', kind: 'building',
    candidate: cand({ score: 0.55, building_name: '삼보그린타운아파트' }),
  });
  assert.equal(r.accept, true, r.reason);
  assert.equal(r.needsReview, true);
});

test('점수가 높고 이름이 사실상 같으면 확인필요 아님', () => {
  const r = judgeCandidate({
    rawQuery: '우남아파트', kind: 'building',
    candidate: cand({ score: 0.95, building_name: '우남아파트' }),
  });
  assert.equal(r.accept, true);
  assert.equal(r.needsReview, false);
});

test('입력 방어 — 후보가 없거나 점수가 없으면 버린다(M-1: 예외로 죽지 않는다)', () => {
  assert.equal(judgeCandidate({ rawQuery: 'x', kind: 'building', candidate: null }).accept, false);
  assert.equal(judgeCandidate({ rawQuery: 'x', kind: 'building', candidate: cand({ score: NaN }) }).accept, false);
  assert.equal(judgeCandidate({}).accept, false);
});
