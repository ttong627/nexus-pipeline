// ══════════════════════════════════════════════════════════════════════════
//  특이사항 정제 보정 — 컬럼에 안 담긴 채 지워진 값을 제자리 컬럼에 복원
//  형 지시(2026-07-22): "호수는 상세주소에 먼저 저장해줘야 해"
//
//  clean-special-notes.mjs 의 '삭제(주소중복)' 규칙이, 값이 주소 문자열에만 있고
//  전용 컬럼(상세주소·건물명·법정동)에는 비어 있는 경우까지 지워버렸다.
//  → 백업본을 근거로 해당 컬럼에 값을 복원한다. (삭제 아님 · 복원 전용)
//
//  실행: node scripts/fix-note-column-restore.mjs             (dry-run)
//        node scripts/fix-note-column-restore.mjs --write     (반영)
// ══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import admin from 'firebase-admin';

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const BACKUP = ARGS.find(a => a.endsWith('.json')) || '_tmp_backup_notes_2026-07-22T05-32-17-822Z.json';

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();

const S = (v) => String(v ?? '').trim();
const ns = (v) => S(v).replace(/\s/g, '');
const gn = (r) => S(r.note || r['특이사항'] || r['비고']);
const ga = (r) => S(r.address || r['주소'] || r.standardRoadAddress);
const gd = (r) => S(r.detailAddr || r.detailAddress || r['상세주소']);
const gb = (r) => S(r.buildingName || r['건물명']);
const gl = (r) => S(r.legalDong || r['법정동']);

/** 호수·층 등 상세주소 성분인가 */
const isDetailPart = (n) => /\d호|^(지하|지층|옥탑|반지하)/.test(ns(n));

const backup = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
const fixes = [];

for (const { path, before: r } of backup) {
  const note = gn(r), addr = ga(r);
  if (!note || !addr) continue;
  if (!(ns(note).length >= 3 && ns(addr).includes(ns(note)))) continue;   // '주소중복' 삭제분만 대상

  if (isDetailPart(note)) {
    if (!gd(r)) fixes.push({ path, r, field: 'detail', value: note });      // 호수 → 상세주소
    continue;
  }
  const parts = note.split(',').map(S).filter(Boolean);
  if (parts.length === 2) {
    if (!gl(r) || !gb(r)) fixes.push({ path, r, field: 'legal+bld', value: parts });  // 법정동,건물명
  } else if (!gb(r)) {
    fixes.push({ path, r, field: 'building', value: note });                // 건물명 → 건물명컬럼
  }
}

const tally = fixes.reduce((m, f) => ({ ...m, [f.field]: (m[f.field] || 0) + 1 }), {});
console.log(`[모드] ${WRITE ? '★실제 반영' : 'dry-run(쓰기 없음)'} · 백업원본 ${BACKUP}`);
console.log(`복원 대상 ${fixes.length}건 ·`, JSON.stringify(tally));
fixes.slice(0, 10).forEach(f => console.log(`   · ${f.field}: [${Array.isArray(f.value) ? f.value.join(' | ') : f.value}]`));

if (!WRITE) { console.log('\n(dry-run) 반영하려면 --write'); process.exit(0); }

/** 레코드 스키마(B-8)에 맞춰 필드명 선택 */
function payload(r, f) {
  const ko = Object.prototype.hasOwnProperty.call(r, '특이사항');
  const p = {};
  if (f.field === 'detail') p[Object.prototype.hasOwnProperty.call(r, 'detailAddr') ? 'detailAddr' : (ko ? '상세주소' : 'detailAddress')] = f.value;
  if (f.field === 'building') p[ko ? '건물명' : 'buildingName'] = f.value;
  if (f.field === 'legal+bld') {
    if (!gl(r)) p[ko ? '법정동' : 'legalDong'] = f.value[0];
    if (!gb(r)) p[ko ? '건물명' : 'buildingName'] = f.value[1];
  }
  return p;
}

let done = 0;
for (let i = 0; i < fixes.length; i += 499) {
  const chunk = fixes.slice(i, i + 499);
  const batch = db.batch();
  chunk.forEach(f => batch.update(db.doc(f.path), payload(f.r, f)));
  await batch.commit();
  done += chunk.length;
  console.log(`  커밋 ${done}/${fixes.length}`);
}
await db.collection('audit_logs').add({
  action: 'fix-note-column-restore', updateCount: fixes.length, tally, source: BACKUP,
  adminEmail: 'script:fix-note-column-restore', createdAt: admin.firestore.FieldValue.serverTimestamp(),
});
console.log(`✅ 복원 완료 ${fixes.length}건 (삭제 0건 · 컬럼 채우기만)`);
process.exit(0);
