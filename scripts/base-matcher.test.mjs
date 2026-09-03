// 기본명단 매칭 엔진 회귀 — 매칭률은 넓히되 오매칭은 0.
//   형 지시 2026-09-03: "매칭률을 높힐 수 있는 모든 방법을 다 적용. 미스매칭이나 오탐하면 절대 안돼."
//   실행: node --test scripts/base-matcher.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBaseIndex, matchBase, MATCH_REASON,
  nameKey, birthKey, phoneKey, allSamePerson, extractImportable, excelSerialToBirth,
} from '../src/engine/baseMatcher.js';

const idx = (recs) => buildBaseIndex(recs);

test('정규화 — 같은 사람의 표기 흔들림만 흡수한다', async (t) => {
  await t.test('이름: 공백·유니코드 정규화', () => {
    assert.equal(nameKey('홍 길동'), '홍길동');
    assert.equal(nameKey('  홍길동\t'), '홍길동');
    assert.equal(nameKey('홍길동'.normalize('NFD')), '홍길동');
  });
  await t.test('생년월일: 6·8자리·구분자 모두 같은 키', () => {
    assert.equal(birthKey('19750315'), '75.03.15');
    assert.equal(birthKey('750315'), '75.03.15');
    assert.equal(birthKey('75.03.15'), '75.03.15');
    assert.equal(birthKey('75-03-15'), '75.03.15');
  });
  await t.test('★비정형 생년월일은 키로 쓰지 않는다 — 양쪽이 어긋나던 뿌리', () => {
    assert.equal(birthKey('미상'), '');
    assert.equal(birthKey(''), '');
    assert.equal(birthKey(null), '');
  });
  await t.test('★엑셀 날짜 셀(숫자 일련값)을 생년월일로 되살린다', () => {
    // cellDates:false 로 읽으므로 날짜 서식 칸은 숫자로 온다. 27468 = 1975-03-15.
    assert.equal(birthKey('27468'), '75.03.15');
    assert.equal(excelSerialToBirth('27468', '27468'), '75.03.15');
  });
  await t.test('🚨 4자리는 건드리지 않는다 — 연도 표기와 구별할 수 없다', () => {
    assert.equal(birthKey('1975'), '');   // 없는 날짜를 지어내느니 빠지는 편이 낫다
    assert.equal(excelSerialToBirth('1975', '1975'), '');
  });
  await t.test('🚨 미래·범위 밖 일련값은 생년월일이 아니다', () => {
    assert.equal(birthKey('99999'), '');
    assert.equal(birthKey('00001'), '');
  });
  await t.test('전화: 끝 8자리 — 엑셀이 앞 0 을 날려도 살아남는다', () => {
    assert.equal(phoneKey('010-1234-5678'), '12345678');
    assert.equal(phoneKey('1012345678'), '12345678');   // 앞 0 유실
    assert.equal(phoneKey('01012345678'), '12345678');
    assert.equal(phoneKey('123'), '');                   // 너무 짧으면 키 없음
  });
});

test('★핵심 결함 — 생년월일이 있어도 전화 키를 함께 등록한다', () => {
  // 기본명단엔 생년월일+휴대폰이 다 있고, 그 달 명단은 생년월일 칸이 비어 왔다.
  // 예전 else-if 인덱스는 전화 키를 만들지 않아 통째로 놓쳤다.
  const base = [{ id: 'A', name: '김철수', birthKey: '75.03.15', mobile: '010-1111-2222' }];
  const r = matchBase(idx(base), { 이름: '김철수', 생년월일: '', 휴대폰: '010-1111-2222' });
  assert.equal(r.entry?.id, 'A');
  assert.equal(r.reason, MATCH_REASON.MOBILE);
});

test('A-1 — 기본명단의 5자 절단 이름과 원본 6자 이름이 만난다', () => {
  const base = [{ id: 'A', name: '황보영자민', birthKey: '60.01.02' }];        // 저장은 5자 절단본
  const r = matchBase(idx(base), { 이름: '황보영자민수', 생년월일: '60.01.02' }); // 조회는 원본
  assert.equal(r.entry?.id, 'A');
});

test('구·신 스키마 혼재(B-8)에서도 매칭된다', () => {
  const base = [{ id: 'A', 이름: '박영희', 생년월일: '19801225', 휴대폰: '010-3333-4444' }];
  const r = matchBase(idx(base), { 이름: '박영희', 생년월일: '80.12.25' });
  assert.equal(r.entry?.id, 'A');
});

test('🚨 오매칭 금지 — 같은 이름+같은 생년월일이 2건이면 절대 채택하지 않는다 (S-2)', () => {
  const base = [
    { id: 'A', name: '김옥순', birthKey: '45.06.01', mobile: '010-1111-1111' },
    { id: 'B', name: '김옥순', birthKey: '45.06.01', mobile: '010-2222-2222' },
  ];
  const r = matchBase(idx(base), { 이름: '김옥순', 생년월일: '45.06.01' });
  assert.equal(r.entry, null);
  assert.equal(r.reason, MATCH_REASON.AMBIGUOUS);
  assert.equal(r.candidates, 2);
});

test('🚨 모호하면 다음 단계로 내려가지 않는다 — 내려가면 그게 동명이인 오염이다', () => {
  const base = [
    { id: 'A', name: '이철수', birthKey: '50.01.01', landline: '02-123-4567' },
    { id: 'B', name: '이철수', birthKey: '50.01.01', landline: '02-999-8888' },
  ];
  // 생년월일 단계에서 2건 → 유선 단계로 내려가면 A 를 집게 되지만, 그러면 안 된다.
  const r = matchBase(idx(base), { 이름: '이철수', 생년월일: '50.01.01', 유선전화: '02-123-4567' });
  assert.equal(r.entry, null);
  assert.equal(r.reason, MATCH_REASON.AMBIGUOUS);
});

test('같은 사람의 중복 문서는 최신을 쓴다 (B-15) — 식별자가 어긋나지 않을 때만', () => {
  const base = [
    { id: 'old', name: '최민수', birthKey: '70.02.02', mobile: '010-5555-6666', updatedAt: 1000, note: '옛 메모' },
    { id: 'new', name: '최민수', birthKey: '70.02.02', mobile: '010-5555-6666', updatedAt: 2000, note: '새 메모' },
  ];
  const r = matchBase(idx(base), { 이름: '최민수', 생년월일: '70.02.02' });
  assert.equal(r.entry?.id, 'new');
});

test('식별자가 하나라도 어긋나면 다른 사람으로 본다', () => {
  assert.equal(allSamePerson([
    { birthKey: '70.02.02', mobile: '010-1111-1111' },
    { birthKey: '70.02.02', mobile: '010-2222-2222' },
  ]), false);
  // 한쪽에만 있는 값은 불일치가 아니다
  assert.equal(allSamePerson([
    { birthKey: '70.02.02', mobile: '010-1111-1111' },
    { birthKey: '70.02.02' },
  ]), true);
});

test('🚨 이름 단독으로는 절대 매칭하지 않는다 (S-1)', () => {
  const base = [{ id: 'A', name: '홍길동', birthKey: '80.01.01' }];
  const r = matchBase(idx(base), { 이름: '홍길동' });   // 식별자 없음
  assert.equal(r.entry, null);
  assert.equal(r.reason, MATCH_REASON.NO_KEY);
});

test('🚨 이름이 같고 식별자가 다르면 붙지 않는다 — 동명이인 기본형', () => {
  const base = [{ id: 'A', name: '김영수', birthKey: '55.05.05', mobile: '010-7777-8888' }];
  const r = matchBase(idx(base), { 이름: '김영수', 생년월일: '66.06.06', 휴대폰: '010-9999-0000' });
  assert.equal(r.entry, null);
  assert.equal(r.reason, MATCH_REASON.MISS);
});

test('강키가 하나도 없는 기본명단 레코드는 인덱스에 넣지 않는다 (B-1)', () => {
  const built = idx([{ id: 'A', name: '무연락' }]);
  assert.equal(built.indexed, 0);
  assert.equal(matchBase(built, { 이름: '무연락', 휴대폰: '010-1111-2222' }).entry, null);
});

test('가족 공용 전화 — 이름이 다르면 서로 섞이지 않는다', () => {
  const base = [
    { id: 'mom', name: '김어머니', mobile: '010-1234-5678' },
    { id: 'son', name: '김아들', mobile: '010-1234-5678' },
  ];
  const built = idx(base);
  assert.equal(matchBase(built, { 이름: '김아들', 휴대폰: '010-1234-5678' }).entry?.id, 'son');
  assert.equal(matchBase(built, { 이름: '김어머니', 휴대폰: '010-1234-5678' }).entry?.id, 'mom');
});

test('extractImportable — ◆·[기본]·(본명:) 을 걷어낸 순수 메모만 돌려준다', () => {
  const got = extractImportable({ note: '[기본] 쪽문으로 ◆옛이식 (본명:김철수)', driver: '박기사', seqNo: '12' });
  assert.equal(got.note, '쪽문으로');
  assert.equal(got.driver, '박기사');
  assert.equal(got.seqNo, '12');
});

test('빈 입력·null 이어도 죽지 않는다', () => {
  const built = idx(null);
  assert.equal(built.indexed, 0);
  assert.equal(matchBase(built, null).entry, null);
  assert.equal(matchBase(null, { 이름: '홍길동' }).entry, null);
  assert.equal(extractImportable(null), null);
});
