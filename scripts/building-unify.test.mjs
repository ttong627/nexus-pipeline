// 건물명 통일(P1) 회귀 테스트 — node --test scripts/building-unify.test.mjs
//   형 방침(엄수):
//     · 빈 건물명으로 통일 금지 — 건물명을 지우는 방향은 정보 삭제다
//     · DB 정본이 있으면 무조건 그것 / 없으면 압도적 최다 표기만(동률·근소차는 보류)
//     · 괄호에서 빠지는 비건물명 값(5층 식당보관·8652)은 특이사항으로 이관(삭제 금지)
//     · 법정동은 필드값(정본 백필 완료, 보유율 100%)만 신뢰
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCanonicalBuilding, rebuildParen } from '../src/utils/buildingUnify.js';

// ── pickCanonicalBuilding ──────────────────────────────────
test('DB 정본 건물명이 있으면 무조건 채택', () => {
  const r = pickCanonicalBuilding({
    variants: [{ name: '파인빌', count: 2 }, { name: '화인빌', count: 10 }],
    dbName: '화인빌',
  });
  assert.equal(r.canonical, '화인빌');
  assert.equal(r.source, 'db');
});

test('DB 정본이 최다 표기와 달라도 DB 우선', () => {
  const r = pickCanonicalBuilding({
    variants: [{ name: '남경오피스텔', count: 9 }, { name: '성진남경오피스텔', count: 1 }],
    dbName: '성진남경오피스텔',
  });
  assert.equal(r.canonical, '성진남경오피스텔');
  assert.equal(r.source, 'db');
});

test('DB 정본 없으면 압도적 최다 표기 채택', () => {
  const r = pickCanonicalBuilding({
    variants: [{ name: '가든시티2차', count: 11 }, { name: '', count: 1 }],
    dbName: '',
  });
  assert.equal(r.canonical, '가든시티2차');
  assert.equal(r.source, 'majority');
});

test('빈 건물명으로는 통일하지 않음(정보 삭제 금지)', () => {
  const r = pickCanonicalBuilding({
    variants: [{ name: '', count: 20 }, { name: '소나무빌', count: 1 }],
    dbName: '',
  });
  // 빈값이 최다지만 채택 불가 → 유일한 비어있지 않은 표기를 채택
  assert.equal(r.canonical, '소나무빌');
  assert.equal(r.source, 'majority');
});

test('비어있지 않은 표기가 근소차면 보류(억지 통일 금지)', () => {
  const r = pickCanonicalBuilding({
    variants: [{ name: '태지빌라', count: 5 }, { name: '태지아트빌라', count: 4 }],
    dbName: '',
  });
  assert.equal(r, null);
});

test('비어있지 않은 표기가 동률이면 보류', () => {
  const r = pickCanonicalBuilding({
    variants: [{ name: '시그니처오피스텔', count: 3 }, { name: '시그니처아파트', count: 3 }],
    dbName: '',
  });
  assert.equal(r, null);
});

test('표기가 하나뿐이면 통일 불필요 → null', () => {
  assert.equal(pickCanonicalBuilding({ variants: [{ name: '래미안', count: 5 }], dbName: '' }), null);
});

test('모든 표기가 빈값이면 null(채울 것이 없음)', () => {
  assert.equal(pickCanonicalBuilding({ variants: [{ name: '', count: 5 }], dbName: '' }), null);
});

test('빈값 방어', () => {
  assert.equal(pickCanonicalBuilding({ variants: [], dbName: '' }), null);
  assert.equal(pickCanonicalBuilding({ variants: null, dbName: null }), null);
});

// ── 정답 후보 위생 검사 (dry-run에서 드러난 오염 채택 차단) ──
test('A-9 특수문자 잔재가 붙은 표기는 정답 후보에서 제외', () => {
  const r = pickCanonicalBuilding({
    variants: [{ name: '◆오렌지하우스', count: 5 }, { name: '오렌지하우스', count: 1 }],
    dbName: '',
  });
  assert.equal(r?.canonical, '오렌지하우스', '특수문자 없는 표기가 채택돼야 함');
});

test('법정동이 섞인 표기는 정답 후보에서 제외', () => {
  const r = pickCanonicalBuilding({
    variants: [{ name: '◆상동, 상동대우마이빌', count: 3 }, { name: '상동대우마이빌', count: 1 }],
    dbName: '',
    legalDong: '상동',
  });
  assert.equal(r?.canonical, '상동대우마이빌');
});

test('오염 표기만 있으면 보류(쓰레기를 정답으로 삼지 않음)', () => {
  const r = pickCanonicalBuilding({
    variants: [{ name: '◆상동, 상동대우마이빌', count: 3 }, { name: '', count: 1 }],
    dbName: '',
    legalDong: '상동',
  });
  assert.equal(r, null);
});

test('DB 정본은 위생 검사를 통과한 것으로 신뢰', () => {
  const r = pickCanonicalBuilding({
    variants: [{ name: '◆오렌지하우스', count: 5 }],
    dbName: '오렌지하우스',
  });
  assert.equal(r.canonical, '오렌지하우스');
  assert.equal(r.source, 'db');
});

// ── rebuildParen ───────────────────────────────────────────
test('괄호를 (법정동, 정답건물명)으로 재작성', () => {
  const r = rebuildParen('장한로29길 34, 101- 203호 (장안동)', '장안동', '가든시티2차');
  assert.equal(r.newAddr, '장한로29길 34, 101- 203호 (장안동, 가든시티2차)');
  assert.deepEqual(r.moved, []);
});

test('비건물명 값은 특이사항으로 이관(삭제 금지)', () => {
  const r = rebuildParen('답십리로 303, 539호 (장안동, 5층 식당보관, E (장안동))', '장안동', '신궁전고시텔');
  assert.equal(r.newAddr, '답십리로 303, 539호 (장안동, 신궁전고시텔)');
  assert.ok(r.moved.includes('5층 식당보관'), `이관 누락: ${JSON.stringify(r.moved)}`);
});

test('숫자 코드도 이관', () => {
  const r = rebuildParen('왕산로2길 34, 312호 (신설동, 8652 (신설동))', '신설동', '대명빌딩');
  assert.equal(r.newAddr, '왕산로2길 34, 312호 (신설동, 대명빌딩)');
  assert.ok(r.moved.includes('8652'), `이관 누락: ${JSON.stringify(r.moved)}`);
});

test('정답 건물명의 부분문자열은 이관하지 않음(중복 방지)', () => {
  const r = rebuildParen('길 1, 101호 (장안동, 가든시티)', '장안동', '가든시티2차');
  assert.equal(r.newAddr, '길 1, 101호 (장안동, 가든시티2차)');
  assert.deepEqual(r.moved, []);
});

test('법정동 중복은 이관하지 않고 제거', () => {
  const r = rebuildParen('양지8길 17, 307호 (성정동, 성정동, 소나무빌)', '성정동', '소나무빌');
  assert.equal(r.newAddr, '양지8길 17, 307호 (성정동, 소나무빌)');
  assert.deepEqual(r.moved, []);
});

test('상세주소·동호수는 손대지 않음', () => {
  const r = rebuildParen('권선로 472, 101- 203호 3층 (권선동, 래미안)', '권선동', '래미안아파트');
  assert.equal(r.newAddr, '권선로 472, 101- 203호 3층 (권선동, 래미안아파트)');
});

test('A-22 참고블록 보존', () => {
  const src = '약령시로 71, 401호 [참고: 제기동 주민센터 약령시로 71 ] (제기동, 제기동 주민센터)';
  const r = rebuildParen(src, '제기동', '제기동 행정복지센터');
  assert.ok(r.newAddr.includes('[참고: 제기동 주민센터 약령시로 71 ]'), r.newAddr);
  assert.ok(r.newAddr.endsWith('(제기동, 제기동 행정복지센터)'), r.newAddr);
});

test('건물명 속 괄호 보존(P0 depth 인식과 호환)', () => {
  const r = rebuildParen('회기로4길 37-2, 105호 (제기동, 젠터스)', '제기동', '(주)젠터스 에이동');
  assert.equal(r.newAddr, '회기로4길 37-2, 105호 (제기동, (주)젠터스 에이동)');
});

test('도로명 없으면 원본 보존(억지 재조립 금지)', () => {
  const r = rebuildParen('', '장안동', '래미안');
  assert.equal(r.newAddr, '');
  assert.deepEqual(r.moved, []);
});

test('이미 정답이면 변경 없음', () => {
  const src = '권선로 472, 101- 203호 (권선동, 래미안)';
  const r = rebuildParen(src, '권선동', '래미안');
  assert.equal(r.newAddr, src);
  assert.equal(r.changed, false);
});
