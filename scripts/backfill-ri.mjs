// 리(里) 백필 — cloud_lists의 읍/면 레코드 중 리가 빈 건을 실엔진으로 재지오코딩해 리만 채운다.
// 주소·기타 필드는 절대 건드리지 않음(리 필드만 merge).
// 실행: node_modules/.bin/vite-node scripts/backfill-ri.mjs --city "충청남도 홍성군"            (dry-run)
//       node_modules/.bin/vite-node scripts/backfill-ri.mjs --city "충청남도 홍성군" --write     (실제 저장)
import fs from 'node:fs';
import admin from 'firebase-admin';
import { processAddress } from '../src/engine/addressEngine.js';

const ARGS = process.argv.slice(2);
const CITY = (() => { const i = ARGS.indexOf('--city'); return i >= 0 ? ARGS[i + 1] : '충청남도 홍성군'; })();
const WRITE = ARGS.includes('--write');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();

async function asyncPool(limit, items, fn) {
  const ret = [], executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    ret.push(p);
    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(ret);
}

console.log(`\n리(里) 백필 | ${CITY} | ${WRITE ? '★실제저장★' : 'dry-run'}\n`);
const months = await db.collection('cloud_lists').doc(CITY).collection('months').listDocuments();
let totalFilled = 0, totalStillEmpty = 0;
const samples = [];

for (const m of months) {
  const snap = await m.collection('records').get();
  const targets = snap.docs.filter(d => {
    const r = d.data();
    return !String(r.리 || '').trim() && /(읍|면)$/.test(String(r.행정동 || '').trim());
  });
  console.log(`[${m.id}] 전체 ${snap.size} · 리빈 읍/면 대상 ${targets.length}건 처리...`);

  const updates = [];
  let done = 0;
  await asyncPool(15, targets, async (doc) => {
    const r = doc.data();
    const roadPart = String(r.주소 || '').split(',')[0].trim();
    try {
      // cityLabel은 4번째 인자(필수) — 지역안전 매칭. 3번째 adminDong엔 행정동.
      const res = await processAddress(roadPart, '', r.행정동 || '', CITY);
      const ri = String(res.리 || '').trim();
      if (ri) { updates.push({ ref: doc.ref, ri }); if (samples.length < 12) samples.push(`${r.행정동} ${roadPart.slice(0, 26)} → ${ri}`); }
    } catch { /* 개별 실패는 건너뜀 */ }
    if (++done % 500 === 0) console.log(`   ...${done}/${targets.length}`);
  });

  totalFilled += updates.length;
  totalStillEmpty += targets.length - updates.length;
  console.log(`[${m.id}] 채울수있음 ${updates.length} · 그래도빈 ${targets.length - updates.length}`);

  if (WRITE && updates.length) {
    for (let i = 0; i < updates.length; i += 400) {
      const batch = db.batch();
      updates.slice(i, i + 400).forEach(u => batch.set(u.ref, { 리: u.ri }, { merge: true }));
      await batch.commit();
    }
    console.log(`[${m.id}] ✅ ${updates.length}건 리 저장 완료`);
  }
}

console.log(`\n샘플:`); samples.forEach(s => console.log('  -', s));
console.log(`\n합계: 리 채움 ${totalFilled}건 · 재지오코딩해도 빈 ${totalStillEmpty}건${WRITE ? ' (저장 완료)' : ' (dry-run)'}`);
await admin.app().delete().catch(() => {});
process.exit(0);
