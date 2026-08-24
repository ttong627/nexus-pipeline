// 만료된 공유 문서에서 **개인정보 성분만** 걷어낸다. 기본 DRY-RUN, 반영은 --write.
//
//   왜: `route_shares` 부모 문서에 옛 구조의 `records` 배열(이름·주소·좌표)이 그대로 남아 있다.
//       2026-08-24 실측 44개 문서 · 21,002명. 지금은 규칙이 막아 아무도 못 읽지만
//       (만료됐고, 만료필드 없는 건도 createdAt+7일 폴백이 지났다), **보관 자체가 목적 외**다.
//       이 프로젝트의 명시 목표가 개정 개인정보보호법(2026-09-11) 대응·최소보관이고,
//       만료일을 누가 늘리거나 규칙이 완화되면 그 순간 전부 열린다.
//
//   무엇을: 만료된 공유에서 `records`(명단 배열) · `driverPhones`(기사 번호) ·
//           `completions` 안의 이름/배송지 좌표만 제거한다.
//   무엇을 남기나: 문서 자체(city·monthId·createdBy·createdAt·expiresAt·drivers 이름/색)와
//           완료기록의 uid·시각·기사위치·오차·판정 — 사후 추적에 필요한 최소한.
//           ★문서를 통째로 지우지 않는 이유: 누가 언제 무엇을 배포했는지가 사라지면
//             유출 조사도 감사도 불가능해진다(G-1·G-2 취지).
//   ★유효기간이 남은 공유는 **건드리지 않는다** — 현장에서 기사 화면이 서 버린다.
//
//   사용:  node scripts/purge-expired-share-pii.mjs [--write]
//   원복:  node scripts/restore-from-backup.mjs "<백업.json>" --write
import admin from 'firebase-admin';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

const WRITE = process.argv.includes('--write');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const db = admin.firestore();

const PII_IN_COMPLETION = ['이름', 'name', '주소', 'destLat', 'destLng', 'addr'];
const now = Date.now();

const snap = await db.collection('route_shares').get();
const targets = [];
let alive = 0;

for (const d of snap.docs) {
  const v = d.data();
  const exp = v.expiresAt?.toMillis?.() || 0;
  const created = v.createdAt?.toMillis?.() || 0;
  // 규칙(isShareWithinTTL)과 같은 판정 — 만료필드가 없으면 createdAt+7일
  const isAlive = exp ? exp > now : (created ? created + 7 * 864e5 > now : false);
  if (isAlive) { alive++; continue; }

  const recs = Array.isArray(v.records) ? v.records.length : 0;
  const phones = v.driverPhones ? 1 : 0;
  const comp = v.completions && typeof v.completions === 'object' ? v.completions : null;
  const compPii = comp ? Object.keys(comp).filter((k) => PII_IN_COMPLETION.some((f) => comp[k]?.[f] !== undefined)) : [];
  if (!recs && !phones && !compPii.length) continue;

  targets.push({ id: d.id, city: v.city || '', monthId: v.monthId || '', recs, phones, compPii, ref: d.ref, data: v });
}

const totalPeople = targets.reduce((a, t) => a + t.recs, 0);
console.log(`route_shares ${snap.size}건 (유효 ${alive}건 = 손대지 않음)`);
console.log(`정리 대상 ${targets.length}건 · 명단배열 총 ${totalPeople.toLocaleString()}명\n`);
for (const t of targets.slice(0, 60)) {
  console.log(`  ${t.id}  ${t.city} ${t.monthId}  records=${t.recs}  driverPhones=${t.phones}  완료기록PII=${t.compPii.length}`);
}
if (targets.length > 60) console.log(`  … 외 ${targets.length - 60}건`);

if (!WRITE) { console.log('\nDRY-RUN — 반영하려면 --write'); process.exit(0); }
if (!targets.length) { console.log('\n대상 없음'); process.exit(0); }

const stamp = new Date().toISOString().slice(0, 10);
const dir = path.join(os.homedir(), 'Desktop'); mkdirSync(dir, { recursive: true });
const backup = path.join(dir, `nexus_만료공유_PII정리_백업_${stamp}_${Date.now()}.json`);
writeFileSync(backup, JSON.stringify(targets.map((t) => ({ path: `route_shares/${t.id}`, data: t.data })), null, 1), 'utf8');
console.log(`\n백업: ${backup}`);

let n = 0;
for (let i = 0; i < targets.length; i += 499) {
  const batch = db.batch();
  for (const t of targets.slice(i, i + 499)) {
    const upd = {};
    if (t.recs) upd.records = admin.firestore.FieldValue.delete();
    if (t.phones) upd.driverPhones = admin.firestore.FieldValue.delete();
    for (const k of t.compPii) for (const f of PII_IN_COMPLETION) upd[`completions.${k}.${f}`] = admin.firestore.FieldValue.delete();
    batch.update(t.ref, upd); n++;
  }
  await batch.commit();
}
await db.collection('audit_logs').add({
  action: 'purge_expired_share_pii', at: admin.firestore.FieldValue.serverTimestamp(),
  adminEmail: 'script:purge-expired-share-pii', docCount: n, peopleRemoved: totalPeople,
  backup, paths: targets.slice(0, 5000).map((t) => `route_shares/${t.id}`),
});
console.log(`반영 완료 — 문서 ${n}건 · 명단 ${totalPeople.toLocaleString()}명분 제거 (audit_logs 기록)`);
process.exit(0);
