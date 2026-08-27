// 배정 보관·승계 회귀 — src/utils/assignmentStore.js (2026-08-27 형 지시)
//
//   왜 잠그나: 여기가 틀리면 **엉뚱한 사람에게 남의 기사·순번이 붙는다**.
//   2026-07-10 동명이인 주소오염 사고가 바로 약키 매칭에서 났다(S-1~S-6).
//   그래서 ①강키만 쓴다 ②같은 키가 2건 이상이면 아예 안 쓴다 ③이번 달 값이 있으면 덮지 않는다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  strongKeySource, normName, birthKey6, phoneKey8,
  buildAssignmentBatch, applyCarriedAssignments, isExpiredMonth, toAssignmentRecord, RETENTION_MONTHS,
} from '../src/utils/assignmentStore.js';

describe('매칭키 — 표기가 달라도 같은 사람이면 같은 키', () => {
  test('생년월일은 표기 무관 끝 6자리', () => {
    assert.equal(birthKey6('75.03.15'), '750315');
    assert.equal(birthKey6('19750315'), '750315');
    assert.equal(birthKey6('750315'), '750315');
  });
  test('휴대폰은 끝 8자리', () => {
    assert.equal(phoneKey8('010-9051-8881'), '90518881');
    assert.equal(phoneKey8('01090518881'), '90518881');
  });
  test('이름의 공백은 무시한다', () => {
    assert.equal(normName(' 홍 길동 '), '홍길동');
  });
  test('생년월일 우선, 없으면 휴대폰 — 둘 다 없으면 키 없음(승계 대상 아님)', () => {
    assert.equal(strongKeySource({ 이름: '홍길동', 생년월일: '750315', 휴대폰: '010-1111-2222' }), 'b:홍길동:750315');
    assert.equal(strongKeySource({ 이름: '홍길동', 생년월일: '', 휴대폰: '010-1111-2222' }), 'p:홍길동:11112222');
    assert.equal(strongKeySource({ 이름: '홍길동' }), null);
    assert.equal(strongKeySource({ 이름: '', 생년월일: '750315' }), null, '이름 없는 건은 키를 만들지 않는다');
  });
});

describe('저장 — 개인정보를 담지 않는다', () => {
  test('이름·주소·전화는 저장 대상이 아니다', () => {
    const row = toAssignmentRecord({ 이름: '홍길동', 주소: '왕산로 72', 휴대폰: '010-1111-2222', 기사: '가명현', 배송순번: '3', 행정동: '전농1동', lat: 37.5, lng: 127.0 }, 'HASH');
    assert.deepEqual(Object.keys(row).sort(), ['dong', 'driver', 'k', 'lat', 'lng', 'seq']);
    assert.equal(JSON.stringify(row).includes('홍길동'), false);
    assert.equal(JSON.stringify(row).includes('왕산로'), false);
    assert.equal(JSON.stringify(row).includes('1111'), false);
  });

  test('★같은 키가 2건 이상이면 둘 다 버린다 (S-2 — 누구 것인지 모르면 쓰지 않는다)', async () => {
    const b = await buildAssignmentBatch([
      { 이름: '홍길동', 생년월일: '750315', 기사: '가명현' },
      { 이름: '홍길동', 생년월일: '750315', 기사: '다른기사' },
      { 이름: '김철수', 휴대폰: '010-1111-2222', 기사: '이진만' },
    ]);
    assert.equal(b.rows.length, 1, '동명이인·중복은 승계하지 않는다');
    assert.equal(b.skippedDup, 1);
  });

  test('기사·순번·좌표가 모두 없으면 남기지 않는다', async () => {
    const b = await buildAssignmentBatch([{ 이름: '홍길동', 생년월일: '750315' }]);
    assert.equal(b.rows.length, 0);
  });
});

describe('승계 — 이번 달 값이 우선이고, 못 찾으면 손대지 않는다', () => {
  const carried = [
    { k: null, driver: 'X' },   // 무시돼야 한다
  ];

  test('빈 칸만 채운다 — 이번 달에 정한 값은 덮지 않는다', async () => {
    const b = await buildAssignmentBatch([{ 이름: '김철수', 휴대폰: '010-1111-2222', 기사: '이진만', 배송순번: '1', lat: 37.6, lng: 127.1 }]);
    const r = await applyCarriedAssignments(
      [{ 이름: '김철수', 휴대폰: '010-1111-2222', 기사: '박진성' }],   // 이번 달에 이미 정해 둔 기사
      b.rows,
    );
    assert.equal(r.records[0].기사, '박진성', '이번 달 값을 덮으면 담당자가 한 일이 사라진다');
    assert.equal(r.records[0].배송순번, '1', '비어 있던 순번은 채운다');
    assert.equal(r.carried, 1);
  });

  test('매칭 못 한 건은 그대로 둔다 (임의 배정 금지 · S-5)', async () => {
    const r = await applyCarriedAssignments([{ 이름: '모르는사람', 생년월일: '800101' }], carried);
    assert.equal(r.missed, 1);
    assert.equal(r.records[0].기사, undefined);
  });

  test('키가 없는 건(이름만 있는 사람)도 손대지 않는다', async () => {
    const r = await applyCarriedAssignments([{ 이름: '홍길동' }], [{ k: 'whatever', driver: '가명현' }]);
    assert.equal(r.carried, 0);
    assert.equal(r.records[0].기사, undefined);
  });
});

describe('보관 기간 — 명단은 1개월, 배정은 3개월', () => {
  test('기준월 포함 최근 3개월만 남긴다', () => {
    assert.equal(RETENTION_MONTHS, 3);
    assert.equal(isExpiredMonth('2026-08', '2026-08'), false);
    assert.equal(isExpiredMonth('2026-07', '2026-08'), false);
    assert.equal(isExpiredMonth('2026-06', '2026-08'), false);
    assert.equal(isExpiredMonth('2026-05', '2026-08'), true, '3개월을 넘긴 배정은 지운다');
  });
  test('해를 넘겨도 맞다', () => {
    assert.equal(isExpiredMonth('2025-12', '2026-02'), false);
    assert.equal(isExpiredMonth('2025-11', '2026-02'), true);
  });
  test('★형식을 모르면 지우지 않는다 — 지우는 쪽이 되돌릴 수 없다', () => {
    assert.equal(isExpiredMonth('이상한값', '2026-08'), false);
    assert.equal(isExpiredMonth('2026-08', ''), false);
  });
});
