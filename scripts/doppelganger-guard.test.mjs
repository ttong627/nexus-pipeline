// 동명이인 안전 매칭 회귀 테스트 — node --test scripts/doppelganger-guard.test.mjs
//   2026-06-24 사고(김옥순·심광흠) 픽스처 포함. addressEngine 임포트 금지(순수 Node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrigIndex, matchOrigForRecord, roadNo, baseNo } from './doppelganger-guard.mjs';

// ── 사고 재현: 동대문구 신설동 김옥순 2인 ─────────────────────────
// 원본(구청): A=집주소(55-3), B=신설동주민센터(도로명 없음 → 구판에서는 맵 탈락했었음)
const 김옥순원본 = [
  { name: '김옥순', dong: '신설동', detail: '천호대로 55-3, 지층 오른쪽', phone: '010-9108-4341' },
  { name: '김옥순', dong: '신설동', detail: '신설동주민센터', phone: '010-9923-1069' },
];

test('사고 재현 — 주민센터 요청자(B)는 skip, 동명이인 주소를 받지 않는다', () => {
  const idx = buildOrigIndex(김옥순원본);
  // B: 저장 주소가 이미 "천호대로 26"(과거 올바른 정제). 구판은 A의 55-3으로 덮었다.
  const b = matchOrigForRecord(
    { name: '김옥순', dong: '신설동', phone: '010-9923-1069', savedRoadNo: roadNo('천호대로 26'), recNameCount: 2 },
    idx,
  );
  assert.equal(b.action, 'skip');                      // ← 자동수리 금지 (구판: repair→55-3 오염)
  assert.match(b.reason, /주민센터류/);
});

test('사고 재현 — 집주소 동명이인(A)은 자기 원본과 정상 매칭', () => {
  const idx = buildOrigIndex(김옥순원본);
  const a = matchOrigForRecord(
    { name: '김옥순', dong: '신설동', phone: '010-9108-4341', savedRoadNo: roadNo('천호대로 55-3'), recNameCount: 2 },
    idx,
  );
  assert.equal(a.action, 'normal');
  assert.equal(a.orig.phone, '91084341');
});

test('전화 없는 원본 + 동명이인 → 약키 금지로 양쪽 모두 skip', () => {
  const idx = buildOrigIndex(김옥순원본.map(r => ({ ...r, phone: '' })));
  for (const ph of ['010-9108-4341', '010-9923-1069']) {
    const r = matchOrigForRecord(
      { name: '김옥순', dong: '신설동', phone: ph, savedRoadNo: roadNo('천호대로 55-3'), recNameCount: 2 },
      idx,
    );
    assert.equal(r.action, 'skip'); // 동명이인 + 강키 불성립 → 무조건 수동확인
  }
});

// ── 사고 재현: 심광흠 — 본번 상이 원본은 임의 채택 금지 (S-5) ──────
test('본번 상이 원본은 repair 금지(구판 origs[0] 폴백 제거)', () => {
  const idx = buildOrigIndex([
    { name: '심광흠', dong: '청량리동', detail: '제기로 26, 흥릉동아파트 105동 605호', phone: '010-5190-0020' },
  ]);
  const r = matchOrigForRecord(
    // 저장 주소는 과거 정제된 "제기로2가길 26"(실존) — 원본 축약 표기(제기로 26, 비실존)와 본번 상이
    { name: '심광흠', dong: '청량리동', phone: '010-5190-0020', savedRoadNo: roadNo('제기로2가길 26'), recNameCount: 1 },
    idx,
  );
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /본번 상이/);
});

// ── 정상 수리 회귀: 부번 제거(의도된 수리)는 계속 동작 ────────────
test('부번 차이(같은 본번)는 repair 후보 유지 — 기존 51건 회귀 없음', () => {
  const idx = buildOrigIndex([
    { name: '장경숙', dong: '청량리동', detail: '왕산로35길 24', phone: '010-7625-1561' },
  ]);
  const r = matchOrigForRecord(
    { name: '장경숙', dong: '청량리동', phone: '010-7625-1561', savedRoadNo: roadNo('왕산로35길 24-3'), recNameCount: 1 },
    idx,
  );
  assert.equal(r.action, 'repair');
  assert.equal(r.orig.rn, '왕산로35길24');
});

// ── S-2 양측 유일성: 원본 1건 + 레코드 동명이인 → skip ─────────────
test('원본엔 1명뿐이어도 레코드에 동명이인 있으면 약키 금지', () => {
  const idx = buildOrigIndex([
    { name: '박영순', dong: '청량리동', detail: '제기로 152', phone: '' },
  ]);
  const r = matchOrigForRecord(
    { name: '박영순', dong: '청량리동', phone: '010-0000-0000', savedRoadNo: roadNo('제기로 152-9'), recNameCount: 2 },
    idx,
  );
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /동명이인/);
});

// ── 강키 충돌(가족 공용 전화 동명) → skip ─────────────────────────
test('강키 충돌 시 채택하지 않는다', () => {
  const idx = buildOrigIndex([
    { name: '김동수', dong: '답십리1동', detail: '황물로 137', phone: '010-8245-6103' },
    { name: '김동수', dong: '답십리1동', detail: '황물로 200', phone: '010-8245-6103' },
  ]);
  const r = matchOrigForRecord(
    { name: '김동수', dong: '답십리1동', phone: '010-8245-6103', savedRoadNo: roadNo('황물로 137-4'), recNameCount: 2 },
    idx,
  );
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /강키 충돌/);
});

// ── S-4 원본 소비: 같은 원본이 두 레코드에 재사용되지 않는다 ───────
test('원본 소비 — 두 번째 동일 매칭은 후보 소진으로 skip', () => {
  const idx = buildOrigIndex([
    { name: '이몽룡', dong: '용두동', detail: '고산자로 391', phone: '' },
  ]);
  const first = matchOrigForRecord(
    { name: '이몽룡', dong: '용두동', phone: '', savedRoadNo: roadNo('고산자로 391-2'), recNameCount: 1 },
    idx,
  );
  assert.equal(first.action, 'repair');
  const second = matchOrigForRecord(
    { name: '이몽룡', dong: '용두동', phone: '', savedRoadNo: roadNo('고산자로 391-2'), recNameCount: 1 },
    idx,
  );
  assert.equal(second.action, 'skip'); // 소비됨 → 후보 0건
});

// ── 유틸 회귀 ─────────────────────────────────────────────────────
test('roadNo/baseNo 규약', () => {
  assert.equal(roadNo('서울특별시 동대문구 천호대로 55-3, 지층 오른쪽 (신설동)'), '천호대로55-3');
  assert.equal(roadNo('제기로2가길 26, 흥릉동아파트'), '제기로2가길26');
  assert.equal(roadNo('신설동주민센터'), null);
  assert.equal(baseNo('천호대로55-3'), '천호대로55');
});
