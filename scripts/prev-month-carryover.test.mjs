// 전월 승계 매칭 회귀 테스트 — 동명이인 안전(S-1~S-6) 고정
// 실행: node scripts/prev-month-carryover.test.mjs
import assert from 'node:assert/strict';
import { carryStrongKey, annotateCarryover } from '../src/utils/prevMonthCarryover.js';

let pass = 0, fail = 0;
const t = (label, fn) => { try { fn(); pass++; console.log(`  ✅ ${label}`); } catch (e) { fail++; console.log(`  ❌ ${label}\n     ${e.message}`); } };

// 전월 delivery_history 형태(name·birthKey·driver·seqNo)
const P = (name, birthKey, driver, seqNo) => ({ name, birthKey, driver, seqNo });
// 이번달 records 형태(이름·생년월일)
const C = (이름, 생년월일, extra = {}) => ({ 이름, 생년월일, 기사: '', 배송순번: '', ...extra });

console.log('\n── carryStrongKey ──');
t('이름+생년월일 → 강키 생성', () => {
  assert.equal(carryStrongKey('홍길동', '900101'), '홍길동__900101');
});
t('생년월일 없으면 null(약키·승계불가)', () => {
  assert.equal(carryStrongKey('홍길동', ''), null);
  assert.equal(carryStrongKey('홍길동', null), null);
});
t('생년월일 6자리 미만이면 null', () => {
  assert.equal(carryStrongKey('홍길동', '900'), null);
});
t('이름 없으면 null', () => {
  assert.equal(carryStrongKey('', '900101'), null);
});
t('생년월일 하이픈·공백 정규화', () => {
  assert.equal(carryStrongKey('홍길동', '1990-01-01'), '홍길동__19900101');
});

console.log('\n── annotateCarryover: 정상 승계 ──');
t('강키 매칭+양측유일 → 기사·순번 승계', () => {
  const prev = [P('홍길동', '900101', '김기사', 3)];
  const cur = [C('홍길동', '900101')];
  const [r] = annotateCarryover(prev, cur);
  assert.equal(r._prevDriver, '김기사');
  assert.equal(r._prevSeqNo, 3);
  assert.equal(r._isNew, false);
  assert.equal(r._carryAmbiguous, false);
});
t('전월에 없는 사람 → _isNew=true, 승계 없음', () => {
  const prev = [P('홍길동', '900101', '김기사', 3)];
  const cur = [C('신입자', '950505')];
  const [r] = annotateCarryover(prev, cur);
  assert.equal(r._isNew, true);
  assert.equal(r._prevDriver, '');
  assert.equal(r._prevSeqNo, null);
});

console.log('\n── annotateCarryover: 동명이인 안전(S-1~S-6) ──');
t('같은 이름+같은 생년월일 2명(동명이인 중복키) → 승계 보류·ambiguous', () => {
  const prev = [P('김옥순', '450101', '박기사', 1), P('김옥순', '450101', '이기사', 2)];
  const cur = [C('김옥순', '450101')];
  const [r] = annotateCarryover(prev, cur);
  assert.equal(r._carryAmbiguous, true, '동명이인 중복키는 승계 금지');
  assert.equal(r._prevDriver, '', '기사 승계 안 함');
  assert.equal(r._prevSeqNo, null);
  assert.equal(r._isNew, false, '전월에 존재하므로 NEW 아님');
});
t('이번달에 같은 강키 2명 → 양측유일 아님·승계 보류', () => {
  const prev = [P('김옥순', '450101', '박기사', 1)];
  const cur = [C('김옥순', '450101'), C('김옥순', '450101')];
  const rs = annotateCarryover(prev, cur);
  assert.equal(rs[0]._carryAmbiguous, true);
  assert.equal(rs[0]._prevDriver, '');
});
t('이름 같고 생년월일 다르면 서로 다른 키 → 각자 정상 승계', () => {
  const prev = [P('김옥순', '450101', '박기사', 1), P('김옥순', '600202', '이기사', 5)];
  const cur = [C('김옥순', '450101'), C('김옥순', '600202')];
  const rs = annotateCarryover(prev, cur);
  assert.equal(rs[0]._prevDriver, '박기사');
  assert.equal(rs[0]._prevSeqNo, 1);
  assert.equal(rs[1]._prevDriver, '이기사');
  assert.equal(rs[1]._prevSeqNo, 5);
});
t('생년월일 없는 이번달 사람 → ambiguous(승계·NEW 둘 다 안 함)', () => {
  const prev = [P('홍길동', '900101', '김기사', 3)];
  const cur = [C('무생년', '')];
  const [r] = annotateCarryover(prev, cur);
  assert.equal(r._carryAmbiguous, true);
  assert.equal(r._isNew, false, '약키는 신규 오탐 방지 위해 NEW 안 붙임');
  assert.equal(r._prevDriver, '');
});

console.log('\n── annotateCarryover: 값 정규화·불변성 ──');
t('seqNo 0/빈값은 _prevSeqNo=null', () => {
  const prev = [P('가', '900101', '김기사', 0), P('나', '900202', '박기사', '')];
  const cur = [C('가', '900101'), C('나', '900202')];
  const rs = annotateCarryover(prev, cur);
  assert.equal(rs[0]._prevSeqNo, null);
  assert.equal(rs[1]._prevSeqNo, null);
});
t('원본 배열·객체 불변(immutable)', () => {
  const prev = [P('홍길동', '900101', '김기사', 3)];
  const cur = [C('홍길동', '900101')];
  const snapshot = JSON.stringify(cur);
  annotateCarryover(prev, cur);
  assert.equal(JSON.stringify(cur), snapshot, '입력 cur 변형되면 안 됨');
});
t('빈 입력 안전', () => {
  assert.deepEqual(annotateCarryover([], []), []);
  const [r] = annotateCarryover([], [C('가', '900101')]);
  assert.equal(r._isNew, true);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
