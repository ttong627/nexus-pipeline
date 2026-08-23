// 복구 스크립트 백업(JSON: [{ path, data }]) 원복 — 기본 DRY-RUN, 반영은 --write.
//
//   repair-onechar-paren · repair-dash-dong-note · repurify-month 가 바탕화면에 남기는 백업은 **문서 전체**를 JSON 으로 직렬화한다.
//   Firestore Timestamp 는 `{ _seconds, _nanoseconds }` 로 풀려 있으므로 그대로 set 하면 맵으로 들어가 타입이 깨진다 →
//   여기서 Timestamp 로 되감아 **문서 전체를 set(merge 없음)** 해 백업 시점 상태로 되돌린다.
//   ⚠️ merge 없는 전체 set 이라 **백업 시점 이후의 정당한 편집(화면 셀 자동저장 등)도 함께 되돌아간다** — 백업 직후에만 쓸 것.
//   ⚠️ GeoPoint(`_latitude/_longitude`)·DocumentReference 는 되감지 않는다(현 백업엔 없음) — 발견되면 중단한다.
//
//   사용:  node scripts/restore-from-backup.mjs "<백업.json>"            # dry-run(건수·경로·되감기 검증)
//          node scripts/restore-from-backup.mjs "<백업.json>" --write    # 원복(형 확인 후)
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('사용: node scripts/restore-from-backup.mjs "<백업.json>" [--write]'); process.exit(2); }

const isTs = (v) => v && typeof v === 'object' && typeof v._seconds === 'number' && typeof v._nanoseconds === 'number' && Object.keys(v).length === 2;
const isSpecial = (v) => v && typeof v === 'object' && (('_latitude' in v && '_longitude' in v) || '_path' in v || '_firestore' in v);
const revive = (v, where) => {
  if (Array.isArray(v)) return v.map((x, i) => revive(x, `${where}[${i}]`));
  if (isTs(v)) return new admin.firestore.Timestamp(v._seconds, v._nanoseconds);
  if (isSpecial(v)) throw new Error(`되감을 수 없는 특수형(GeoPoint/Reference) 발견: ${where}`);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x, `${where}.${k}`)]));
  return v;
};

const items = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(items) || !items.every((x) => x && typeof x.path === 'string' && x.data && typeof x.data === 'object')) {
  console.error('백업 형식이 아닙니다(배열의 각 항목에 path·data 필요)'); process.exit(2);
}
// ★전건을 먼저 되감아 검증한다 — 배치 도중 실패하면 앞 배치만 커밋된 어중간한 상태가 되므로
const revived = items.map((x) => ({ path: x.path, data: revive(x.data, x.path) }));
console.log(`백업 ${items.length}건 · 모드 ${WRITE ? '★WRITE(원복)' : 'dry-run'} · 파일 ${file} · 되감기 검증 OK`);
const byCol = {}; for (const x of items) { const c = x.path.split('/')[0]; byCol[c] = (byCol[c] || 0) + 1; }
console.log('컬렉션별:', JSON.stringify(byCol));
for (const x of items.slice(0, 5)) console.log('  예:', x.path);

if (WRITE) {
  for (let i = 0; i < revived.length; i += 499) {
    const batch = db.batch();
    for (const x of revived.slice(i, i + 499)) batch.set(db.doc(x.path), x.data);   // merge 없음 = 백업 시점 문서 전체로 복원
    await batch.commit();
    console.log(`  원복 ${Math.min(i + 499, revived.length)}/${revived.length}`);
  }
  const paths = items.map((x) => x.path);
  await db.collection('audit_logs').add({
    action: 'restore-from-backup', adminEmail: 'script:restore-from-backup', backup: file, count: items.length,
    paths: paths.length <= 5000 ? paths : paths.slice(0, 5000), pathsTruncated: paths.length > 5000,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('원복 완료 (audit_logs 기록)');
}
process.exit(0);
