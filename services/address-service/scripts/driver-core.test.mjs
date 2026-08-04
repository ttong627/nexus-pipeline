/**
 * 기사 관리 코어 검증 (모듈 ⑧).
 *
 * ★이 모듈의 존재 이유는 통계가 아니라 **배정 위반 탐지**다.
 *   형 절대규칙: "각 동에는 그 동 소속 기사만 배정한다."
 *   어기면 기사가 자기 구역 밖으로 나가 그날 배송이 통째로 꼬인다.
 *   명단이 수백 건이라 사람이 눈으로 보면 반드시 놓친다.
 *
 * ★동시에 **시끄러운 경고를 만들지 않는 것**도 그만큼 중요하다.
 *   모르는 것을 위반이라고 하면 경고가 쏟아지고, 쏟아지는 경고는 곧 무시된다.
 *   그래서 "판단 보류"를 명시적으로 다룬다.
 *
 * 실행: node --test scripts/driver-core.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  recordDong, recordDriverKey, summarizeDrivers, toDriver, validateAssignment,
} from '../src/routing/driverCore.js';

/* ── 기사 정규화 ────────────────────────────────── */

test('앱마다 다른 기사 필드명을 하나로 모은다', () => {
  assert.equal(toDriver({ driverName: '김기사' }).name, '김기사');
  assert.equal(toDriver({ 기사명: '박기사' }).name, '박기사');
  assert.equal(toDriver({ name: '이기사' }).name, '이기사');
});

test('★id 가 없으면 이름을 키로 쓴다 — 실무 명단은 기사를 이름으로 지칭한다', () => {
  const d = toDriver({ driverName: '김기사' });
  assert.equal(d.id, '김기사');
  const withId = toDriver({ id: 'D1', driverName: '김기사' });
  assert.equal(withId.id, 'D1');
  assert.equal(withId.name, '김기사');
});

test('담당 동을 읽는다(dongs / 담당동)', () => {
  assert.deepEqual(toDriver({ name: 'A', dongs: ['중동', '상동'] }).dongs, ['중동', '상동']);
  assert.deepEqual(toDriver({ name: 'B', 담당동: ['소사동'] }).dongs, ['소사동']);
  assert.deepEqual(toDriver({ name: 'C' }).dongs, []);
});

test('배송건에서 기사·행정동을 뽑는다', () => {
  assert.equal(recordDriverKey({ 기사: '김기사' }), '김기사');
  assert.equal(recordDriverKey({ driver: '이기사' }), '이기사');
  assert.equal(recordDriverKey({}), '');
  assert.equal(recordDong({ 배정행정동: '중동' }), '중동');
  assert.equal(recordDong({ routeDong: '상동' }), '상동');
});

/* ── 부하 요약 ──────────────────────────────────── */

const RECORDS = [
  { id: 1, 주소: '경기 부천시 중동로 100', 포수: 2, 기사: '김기사', 배정행정동: '중동' },
  { id: 2, 주소: '경기 부천시 중동로 108', 포수: 1, 기사: '김기사', 배정행정동: '중동' },
  { id: 3, 주소: '경기 부천시 상동로 20', 포수: 3, 기사: '박기사', 배정행정동: '상동' },
  { id: 4, 주소: '경기 부천시 성주로 20 LH국민임대 105동', 포수: 25, 기사: '박기사', 배정행정동: '상동' },
  { id: 5, 주소: '경기 부천시 소사로 77', 포수: 1 },   // 미배정
];
const DRIVERS = [
  { id: 'D1', driverName: '김기사', dongs: ['중동'] },
  { id: 'D2', driverName: '박기사', dongs: ['상동'] },
];

test('기사별 건수·물량·체감부담·담당동을 낸다', () => {
  const out = summarizeDrivers({ records: RECORDS, drivers: DRIVERS });
  const kim = out.perDriver.find((d) => d.name === '김기사');
  const park = out.perDriver.find((d) => d.name === '박기사');
  assert.equal(kim.count, 2);
  assert.equal(kim.qty, 3);
  assert.deepEqual(kim.dongs, ['중동']);
  assert.equal(park.count, 2);
  assert.equal(park.qty, 28);
});

test('★건수가 같아도 체감부담은 다르다 — 그게 이 요약의 이유다', () => {
  const out = summarizeDrivers({ records: RECORDS, drivers: DRIVERS });
  const kim = out.perDriver.find((d) => d.name === '김기사');
  const park = out.perDriver.find((d) => d.name === '박기사');
  assert.equal(kim.count, park.count, '건수는 같다');
  assert.ok(park.effectiveLoad > kim.effectiveLoad, '체감부담은 달라야 한다');
  // LH임대 25포는 0.3배 할인 → 7.5. 그래도 김기사(3)보다 무겁다.
  assert.ok(park.effectiveLoad < 28, '임대 할인이 반영되지 않았다');
});

test('미배정 건을 따로 보고한다 — 조용히 빠지지 않는다', () => {
  const out = summarizeDrivers({ records: RECORDS, drivers: DRIVERS });
  assert.deepEqual(out.unassigned, [5]);
  assert.equal(out.totals.assigned, 4);
  assert.equal(out.totals.records, 5);
});

test('★명부에 없는 기사가 배정돼 있으면 드러낸다', () => {
  const out = summarizeDrivers({
    records: [...RECORDS, { id: 6, 주소: 'x', 포수: 1, 기사: '유령기사', 배정행정동: '중동' }],
    drivers: DRIVERS,
  });
  assert.deepEqual(out.unknownDrivers, ['유령기사']);
  const ghost = out.perDriver.find((d) => d.name === '유령기사');
  assert.equal(ghost.known, false, '집계는 하되 미확인으로 표시해야 한다');
});

test('부하 편차를 한 숫자로 준다', () => {
  const out = summarizeDrivers({ records: RECORDS, drivers: DRIVERS });
  assert.ok(out.totals.avgLoad > 0);
  assert.ok(out.totals.maxDeviationPct >= 0);
});

test('빈 입력에도 터지지 않는다', () => {
  const out = summarizeDrivers({});
  assert.deepEqual(out.perDriver, []);
  assert.equal(out.totals.records, 0);
  assert.equal(out.totals.maxDeviationPct, 0);
});

/* ── ★배정 위반 탐지 (형 절대규칙) ───────────────── */

test('★남의 동에 배정되면 위반으로 잡는다', () => {
  const bad = [
    { id: 1, 주소: '경기 부천시 중동로 100', 포수: 1, 기사: '김기사', 배정행정동: '중동' },
    { id: 2, 주소: '경기 부천시 상동로 20', 포수: 1, 기사: '김기사', 배정행정동: '상동' },  // 위반
  ];
  const out = validateAssignment({ records: bad, drivers: DRIVERS });
  assert.equal(out.ok, false);
  assert.equal(out.violations.length, 1);
  assert.equal(out.violations[0].recordId, 2);
  assert.equal(out.violations[0].driver, '김기사');
  assert.equal(out.violations[0].recordDong, '상동');
  assert.deepEqual(out.violations[0].allowedDongs, ['중동']);
});

test('정상 배정은 통과한다', () => {
  const out = validateAssignment({ records: RECORDS, drivers: DRIVERS });
  assert.equal(out.violations.length, 0);
  assert.equal(out.ok, true);
});

test('★담당 동이 없는 기사는 검증하지 않는다 — 모르는 걸 위반이라 하지 않는다', () => {
  const noDongs = [{ id: 'D9', driverName: '신입기사' }];
  const recs = [{ id: 1, 주소: 'x', 기사: '신입기사', 배정행정동: '어디든' }];
  const out = validateAssignment({ records: recs, drivers: noDongs });
  assert.equal(out.violations.length, 0);
  assert.equal(out.checked, 0);
  assert.ok(out.note, '검증하지 못했다는 사실을 말해야 한다');
});

test('★"위반 0"이 "검증 0"일 수 있다 — 그 차이를 드러낸다', () => {
  // 행정동 정보가 아예 없는 명단
  const recs = [{ id: 1, 주소: 'x', 기사: '김기사' }];
  const out = validateAssignment({ records: recs, drivers: DRIVERS });
  assert.equal(out.violations.length, 0);
  assert.equal(out.checked, 0);
  assert.ok(out.note.includes('검증된 건이 없습니다'),
    '검증을 못 한 것과 위반이 없는 것을 구분하지 않으면 안전하다고 착각한다');
});

test('명부에 없는 기사는 위반과 별도로 보고한다', () => {
  const recs = [{ id: 1, 주소: 'x', 기사: '유령기사', 배정행정동: '중동' }];
  const out = validateAssignment({ records: recs, drivers: DRIVERS });
  assert.equal(out.ok, false);
  assert.equal(out.violations.length, 0, '동 위반이 아니라 명부 문제다');
  assert.equal(out.unknownDrivers.length, 1);
  assert.equal(out.unknownDrivers[0].reason, 'driver_not_in_roster');
});

test('영문 키 명단도 정규화되어 검증된다', () => {
  const english = [
    { id: 1, address: '경기 부천시 중동로 100', qty: 1, driver: '김기사', dong: '상동' },
  ];
  const out = validateAssignment({ records: english, drivers: DRIVERS });
  assert.equal(out.violations.length, 1, '영문 키 명단에서 위반을 못 잡았다');
});
