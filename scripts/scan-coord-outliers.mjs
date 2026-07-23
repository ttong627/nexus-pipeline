// 전체 DB 좌표 오류 스캔 — READ ONLY (쓰기 없음)
// 지자체별로 좌표 중앙값 중심에서 임계 반경 벗어난 좌표(=주소와 안 맞는 오류) 집계.
// 사용: node scripts/scan-coord-outliers.mjs [--radius 25]
import fs from 'node:fs';
import admin from 'firebase-admin';
import { detectCoordOutliers } from '../src/engine/coordValidator.js';

const ARGS = process.argv.slice(2);
const RADIUS = Number((() => { const i = ARGS.indexOf('--radius'); return i >= 0 ? ARGS[i + 1] : 25; })());

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();
const S = (v) => String(v ?? '').trim();

async function eachMonthGroup(cb) {
  for (const [coll, nested] of [['cloud_lists', true], ['base_lists', false], ['delivery_history', true]]) {
    for (const c of await db.collection(coll).listDocuments()) {
      if (!nested) { const snap = await c.collection('records').get(); cb(`${coll}/${c.id}`, snap); continue; }
      for (const m of await c.collection('months').listDocuments()) {
        const snap = await m.collection('records').get();
        cb(`${coll}/${c.id}/${m.id}`, snap);
      }
    }
  }
}

const groups = [];
let totRec = 0, totCoord = 0, totOut = 0;
const samples = [];

await eachMonthGroup((path, snap) => {
  const recs = [];
  snap.forEach((d) => { const r = d.data(); recs.push({ id: d.id, _lat: Number(r.lat), _lng: Number(r.lng), 이름: r.이름 || '', 주소: r.주소 || '', 행정동: S(r.행정동 || r.dong) }); });
  totRec += recs.length;
  const { outliers, checked, center } = detectCoordOutliers(recs, { radiusKm: RADIUS });
  totCoord += checked;
  if (outliers.length) {
    totOut += outliers.length;
    groups.push({ path, checked, out: outliers.length, center });
    outliers.slice(0, 3).forEach((o) => { if (samples.length < 40) samples.push({ path, ...o }); });
  }
});

console.log('═'.repeat(70));
console.log(`좌표 오류 스캔 (거리 기반 · 임계 ${RADIUS}km) — READ ONLY`);
console.log('═'.repeat(70));
console.log(`전체 레코드 ${totRec.toLocaleString()} · 좌표 보유 ${totCoord.toLocaleString()} · 오류 후보 ${totOut.toLocaleString()}건`);
console.log(`영향 받은 명단(월/지자체): ${groups.length}개\n`);

console.log('오류 많은 명단 상위 15:');
groups.sort((a, b) => b.out - a.out).slice(0, 15).forEach((g) => console.log(`  ${String(g.out).padStart(4)}건 / ${g.checked}  ${g.path}`));

console.log('\n오류 좌표 샘플(거리 큰 것부터):');
samples.sort((a, b) => b.distanceKm - a.distanceKm).slice(0, 20).forEach((s) => {
  console.log(`  ${String(s.distanceKm).padStart(6)}km · ${s.record.이름} · ${s.record.주소} · [${s.path.split('/').slice(1).join('/')}]`);
});
process.exit(0);
