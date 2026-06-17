// cloud_lists 정리 — 손상(�)·URL인코딩 지자체 문서 삭제 (전부 garbage=주소만 있는 불완전레코드, 정규문서에 실데이터 존재).
// 실행: vite-node scripts/repair-cloud-lists.mjs          (dry-run)
//       vite-node scripts/repair-cloud-lists.mjs --write  (실제 삭제)
import fs from 'node:fs';
import admin from 'firebase-admin';
const WRITE = process.argv.includes('--write');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();

const refs = await db.collection('cloud_lists').listDocuments();
console.log(`\ncloud_lists 정리 | ${WRITE ? '★실제삭제★' : 'dry-run'}\n`);
let delDocs = 0, delRecs = 0, kept = [];
for (const ref of refs) {
  const bad = ref.id.includes('�') || /%[0-9A-Fa-f]{2}/.test(ref.id);
  if (!bad) { kept.push(ref.id); continue; }
  // 안전 재확인: 완전 레코드(이름+연락처) 있으면 건너뜀(보존)
  const months = await ref.collection('months').listDocuments();
  let recs = 0, hasComplete = false;
  for (const m of months) {
    const rs = await m.collection('records').get();
    recs += rs.size;
    for (const d of rs.docs) { const r = d.data(); if ((r.이름 || r.name || '').trim() && String(r.휴대폰 || r.mobile || r.유선전화 || r.landline || r.생년월일 || '').trim()) { hasComplete = true; break; } }
  }
  if (hasComplete) { console.log(`  ⚠️ 보존(완전레코드 포함): "${ref.id}" ${recs}건 — 수동확인`); continue; }
  delDocs++; delRecs += recs;
  console.log(`  🗑️ "${ref.id}" : ${recs}건 garbage${WRITE ? ' 삭제' : ' 삭제예정'}`);
  if (WRITE) { await db.recursiveDelete(ref); }
}
console.log(`\n정규 유지 ${kept.length}개: ${kept.join(', ')}`);
console.log(`삭제 ${delDocs}개 문서 · ${delRecs}건${WRITE ? ' (완료)' : ' (dry-run)'}`);
await admin.app().delete().catch(() => {});
process.exit(0);
