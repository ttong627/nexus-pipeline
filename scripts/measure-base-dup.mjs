// 기본명단 안의 강키 충돌(동명이인) 실태 — 읽기 전용. 쓰기 없음.
//
//   왜: 형 지시 2026-09-03 "미스 매칭이나 오탐하면 절대 안돼."
//   매칭을 넓히기 전에 **같은 강키를 가진 사람이 실제로 몇이나 있는지** 알아야 한다.
//   이 수가 곧 '모호로 보류해야 하는 건수'이고, 가드가 없으면 그대로 오매칭이 된다.
//
//   사용: node scripts/measure-base-dup.mjs [--limit 20] [--show]

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { nameKey, birthKey, phoneKey, pick } from '../src/engine/baseMatcher.js';

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8')),
  ),
});
const db = admin.firestore();

const args = process.argv.slice(2);
const LIMIT = Number(args.includes('--limit') ? args[args.indexOf('--limit') + 1] : 20);
const SHOW = args.includes('--show');

const cities = (await db.collection('base_lists').listDocuments()).map((c) => c.id);
const T = { recs: 0, dupBirth: 0, dupPhone: 0, cities: 0, worst: [] };

for (const city of cities.slice(0, LIMIT)) {
  const snap = await db.collection(`base_lists/${city}/records`).get();
  if (snap.empty) continue;
  const recs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const byBirth = new Map(), byPhone = new Map();
  for (const r of recs) {
    const nm = nameKey(pick(r, 'name', '이름'));
    if (!nm) continue;
    const b = birthKey(pick(r, 'birthKey', 'birth', '생년월일'));
    const p = phoneKey(pick(r, 'mobile', '휴대폰'));
    if (b) { const k = `${nm}|${b}`; byBirth.set(k, (byBirth.get(k) || 0) + 1); }
    if (p) { const k = `${nm}|${p}`; byPhone.set(k, (byPhone.get(k) || 0) + 1); }
  }
  const dupB = [...byBirth.entries()].filter(([, v]) => v > 1);
  const dupP = [...byPhone.entries()].filter(([, v]) => v > 1);
  if (dupB.length || dupP.length) {
    console.log(`■ ${city} · ${recs.length.toLocaleString()}건 · 이름+생년월일 충돌 ${dupB.length} · 이름+휴대폰 충돌 ${dupP.length}`);
    if (SHOW) dupB.slice(0, 5).forEach(([k, v]) => console.log(`    ${k} × ${v}`));
  }
  T.recs += recs.length; T.dupBirth += dupB.length; T.dupPhone += dupP.length; T.cities++;
}

console.log(`\n합계 ${T.cities}곳 ${T.recs.toLocaleString()}건`);
console.log(`  이름+생년월일 충돌키 ${T.dupBirth.toLocaleString()} · 이름+휴대폰 충돌키 ${T.dupPhone.toLocaleString()}`);
console.log('  ※ 충돌키 = 가드가 없으면 그대로 오매칭이 되는 자리');
console.log('\n읽기 전용 — 쓰기 없음');
process.exit(0);
