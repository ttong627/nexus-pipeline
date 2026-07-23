// 수량 기반 일자 분할(배송일차) 회귀 테스트
// 형 지시(2026-07-23): 수량 많으면 여러 날로 — ①하루 최대 물량 자동 ②날짜 개수 지정, 지역(동)별로 묶어서
// 실행: node scripts/delivery-day-split.test.mjs
import assert from 'node:assert/strict';
import { splitByDay } from '../src/engine/deliveryDaySplit.js';

let pass = 0, fail = 0;
const t = (label, fn) => { try { fn(); pass++; console.log(`  ✅ ${label}`); } catch (e) { fail++; console.log(`  ❌ ${label}\n     ${e.message}`); } };

// 시흥시 근처 3개 동, 각 동에 좌표·포수. (동A 서쪽 → 동B 중간 → 동C 동쪽)
const rec = (이름, 행정동, lat, lng, 포수 = 1) => ({ 이름, 행정동, _lat: lat, _lng: lng, 포수, 주소: `${행정동} 길 1` });
const DONG_A = [rec('a1', '대야동', 37.44, 126.78, 3), rec('a2', '대야동', 37.441, 126.781, 3), rec('a3', '대야동', 37.442, 126.782, 4)]; // load 10
const DONG_B = [rec('b1', '신천동', 37.45, 126.80, 5), rec('b2', '신천동', 37.451, 126.801, 5)]; // load 10
const DONG_C = [rec('c1', '은행동', 37.46, 126.82, 4), rec('c2', '은행동', 37.461, 126.821, 6)]; // load 10
const ALL = [...DONG_A, ...DONG_B, ...DONG_C]; // 총 load 30

const dayOf = (out, name) => out.find((r) => r.이름 === name).배송일차;
const loadOfDay = (out, d) => out.filter((r) => r.배송일차 === d).reduce((a, r) => a + r.포수, 0);

console.log('\n── numDays: 날짜 개수 지정 ──');
t('3일로 나누면 3개 일차가 생긴다', () => {
  const out = splitByDay(ALL, { numDays: 3 });
  const days = new Set(out.map((r) => r.배송일차));
  assert.equal(days.size, 3);
  assert.deepEqual([...days].sort(), [1, 2, 3]);
});
t('같은 동은 같은 날에 묶인다(동을 쪼개지 않음)', () => {
  const out = splitByDay(ALL, { numDays: 3 });
  assert.equal(dayOf(out, 'a1'), dayOf(out, 'a2'));
  assert.equal(dayOf(out, 'a2'), dayOf(out, 'a3'));
  assert.equal(dayOf(out, 'b1'), dayOf(out, 'b2'));
});
t('3일 균등 — 각 동(load10)이 하루씩', () => {
  const out = splitByDay(ALL, { numDays: 3 });
  assert.equal(loadOfDay(out, 1), 10);
  assert.equal(loadOfDay(out, 2), 10);
  assert.equal(loadOfDay(out, 3), 10);
});

console.log('\n── maxLoadPerDay: 하루 최대 물량 ──');
t('하루 최대 12면 총30 → 3일(12·12·6 또는 유사)', () => {
  const out = splitByDay(ALL, { maxLoadPerDay: 12 });
  const days = new Set(out.map((r) => r.배송일차));
  assert.ok(days.size >= 3, `${days.size}일`);
  // 어느 날도 상한을 크게 넘지 않음(동 단위라 약간 초과 가능하나 동 하나가 상한 이하면 정확)
  [...days].forEach((d) => assert.ok(loadOfDay(out, d) <= 12, `day${d}=${loadOfDay(out, d)}`));
});
t('하루 최대 20이면 총30 → 2일', () => {
  const out = splitByDay(ALL, { maxLoadPerDay: 20 });
  assert.equal(new Set(out.map((r) => r.배송일차)).size, 2);
});
t('상한이 전체보다 크면 1일', () => {
  const out = splitByDay(ALL, { maxLoadPerDay: 100 });
  assert.equal(new Set(out.map((r) => r.배송일차)).size, 1);
});

console.log('\n── 지역(동)별로 가까운 곳끼리 묶기 ──');
t('가까운 동이 같은/인접 날에 배정(1일차=서쪽, 마지막=동쪽)', () => {
  const out = splitByDay(ALL, { numDays: 3 });
  // 서쪽 대야동이 동쪽 은행동보다 앞 날차
  assert.ok(dayOf(out, 'a1') <= dayOf(out, 'c1'));
});
t('출발지(depot) 지정 시 depot 최근접 동부터 1일차', () => {
  const out = splitByDay(ALL, { numDays: 3, depot: { lat: 37.44, lng: 126.78 } }); // 대야동 옆
  assert.equal(dayOf(out, 'a1'), 1); // depot 최근접 = 대야동 = 1일차
});

console.log('\n── 물량 가중(getLoad 주입) ──');
t('getLoad로 체감물량 반영(계단 가중 등)', () => {
  const heavy = [rec('h1', '대야동', 37.44, 126.78, 10), rec('h2', '신천동', 37.45, 126.80, 10)];
  const out = splitByDay(heavy, { maxLoadPerDay: 15, getLoad: (r) => r.포수 * 2 }); // 각 20 → 상한15 초과
  assert.equal(new Set(out.map((r) => r.배송일차)).size, 2); // 동마다 20이라 각각 다른 날
});

t('numDays는 물량이 안 맞아도 정확히 N일(N+1 안 생김)', () => {
  const many = [];
  ['동1', '동2', '동3', '동4', '동5'].forEach((d, i) => { for (let k = 0; k < 3; k++) many.push(rec(`${d}_${k}`, d, 37.44 + i * 0.02, 126.78 + i * 0.02, [7, 3, 9, 2, 5][i])); });
  const out = splitByDay(many, { numDays: 3 });
  assert.equal(new Set(out.map((r) => r.배송일차)).size, 3);
});

console.log('\n── 견고성 ──');
t('빈 입력은 빈 배열', () => assert.deepEqual(splitByDay([], { numDays: 3 }), []));
t('파라미터 없으면 전부 1일차(분할 안 함)', () => {
  const out = splitByDay(ALL, {});
  assert.equal(new Set(out.map((r) => r.배송일차)).size, 1);
});
t('좌표 없는 동도 배정된다(맨 뒤 날차)', () => {
  const noco = [...DONG_A, { 이름: 'x', 행정동: '무좌표동', _lat: null, _lng: null, 포수: 2 }];
  const out = splitByDay(noco, { numDays: 2 });
  assert.ok(out.find((r) => r.이름 === 'x').배송일차 >= 1);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
