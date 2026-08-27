// 보관 기간(3개월)이 지난 배정을 정리한다. 기본 DRY-RUN, 반영은 --write.
//
//   왜: 형 지시 2026-08-27 — "명단은 1개월치만, 기사배정과 좌표·순번은 3개월치".
//   `route_assignments` 는 개인정보를 담지 않지만(매칭키 해시·기사·순번·좌표), 그래도 **정한 기간까지만** 둔다.
//
//   사용:  node scripts/purge-old-assignments.mjs [--base 2026-08] [--write]
//   원복:  백업 JSON + scripts/restore-from-backup.mjs
import admin from 'firebase-admin';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { isExpiredMonth, RETENTION_MONTHS } from '../src/utils/assignmentStore.js';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const baseArg = args[args.indexOf('--base') + 1];
const BASE = /^\d{4}-\d{2}$/.test(baseArg || '') ? baseArg : new Date().toISOString().slice(0, 7);

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const db = admin.firestore();

console.log(`기준월 ${BASE} · 보관 ${RETENTION_MONTHS}개월 (그 이전 달을 정리)`);
const cityRefs = await db.collection('route_assignments').listDocuments();
console.log(`지자체 ${cityRefs.length}곳`);

const targets = [];
for (const c of cityRefs) {
  const months = await c.collection('months').listDocuments();
  for (const m of months) {
    if (!isExpiredMonth(m.id, BASE)) continue;
    const recs = await m.collection('records').get();
    targets.push({ city: c.id, month: m.id, ref: m, count: recs.size, rows: recs.docs.map((d) => ({ id: d.id, ...d.data() })) });
  }
}

const total = targets.reduce((a, t) => a + t.count, 0);
console.log(`정리 대상 ${targets.length}개 월 · ${total.toLocaleString()}건`);
for (const t of targets) console.log(`  ${t.city} ${t.month} — ${t.count}건`);
if (!WRITE) { console.log('\nDRY-RUN — 반영하려면 --write'); process.exit(0); }
if (!targets.length) { console.log('\n대상 없음'); process.exit(0); }

const dir = path.join(os.homedir(), 'Desktop'); mkdirSync(dir, { recursive: true });
const backup = path.join(dir, `nexus_배정보관_정리백업_${BASE}_${Date.now()}.json`);
writeFileSync(backup, JSON.stringify(targets.map((t) => ({ path: `route_assignments/${t.city}/months/${t.month}`, rows: t.rows })), null, 1), 'utf8');
console.log(`\n백업: ${backup}`);

for (const t of targets) await db.recursiveDelete(t.ref);
await db.collection('audit_logs').add({
  action: 'purge_old_assignments', at: admin.firestore.FieldValue.serverTimestamp(),
  adminEmail: 'script:purge-old-assignments', baseMonth: BASE, months: targets.map((t) => `${t.city}/${t.month}`), rowCount: total, backup,
});
console.log(`반영 완료 — ${targets.length}개 월 · ${total.toLocaleString()}건 삭제 (audit_logs 기록)`);
process.exit(0);
