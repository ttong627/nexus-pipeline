// 테스트 잔류물 정리 — 2026-08-27 점검
//
//   왜: E2E·진단 스크립트가 **형의 실제 지자체**에 남긴 것이 발견됐다.
//     ① `cloud_lists/서울특별시 동대문구/months/9999-02` — 옛 E2E 가 실제 지자체를 쓰던 시절의 잔류물.
//        형이 [기사 배정 · 루트맵]에서 동대문구를 열면 월 목록에 `9999-02` 가 보인다.
//     ② 테스트 계정 `e2e_observe_real` — 원인 관찰용 스크립트가 중간에 죽어 남았다.
//        `citiesApproved: [서울특별시 동대문구]` 로 **실제 명단 접근 권한**을 가진 채 살아 있다.
//
//   규칙: 파괴적 작업은 백업 + audit_logs + 담당자 확인(G-1/G-2). 기본 DRY-RUN, 반영은 --write.
//   사용:  node scripts/purge-test-residue.mjs [--write]

import admin from 'firebase-admin';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const WRITE = process.argv.includes('--write');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const db = admin.firestore();

// 지울 대상 — 테스트 흔적임이 명확한 것만 (실제 명단은 절대 대상이 아니다)
const TEST_MONTH_RE = /^9999-/;                       // 실제 명단은 YYYY-MM(2020~2100)뿐이다
const TEST_UIDS = ['e2e_test_manager', 'e2e_assign_manager', 'e2e_observe_real'];
const TEST_CITY_RE = /테스트특별시|검증구|E2E/;

const backup = { at: new Date().toISOString(), months: [], users: [], cities: [] };
let planned = 0;

console.log(`테스트 잔류물 정리 — ${WRITE ? '★실제 반영(--write)' : 'DRY-RUN'}\n`);

// ① 실제 지자체에 섞인 테스트 월
for (const cityRef of await db.collection('cloud_lists').listDocuments()) {
  if (TEST_CITY_RE.test(cityRef.id)) {                // 테스트 지자체 통째로
    const months = (await cityRef.collection('months').listDocuments()).map((m) => m.id);
    console.log(`🚨 테스트 지자체 통째: ${cityRef.id} (월 ${months.length}개)`);
    backup.cities.push({ city: cityRef.id, months });
    planned++;
    if (WRITE) await db.recursiveDelete(cityRef);
    continue;
  }
  for (const monthRef of await cityRef.collection('months').listDocuments()) {
    if (!TEST_MONTH_RE.test(monthRef.id)) continue;
    const recs = await monthRef.collection('records').get();
    const meta = (await monthRef.get()).data() || null;
    console.log(`🚨 테스트 월: ${cityRef.id} / ${monthRef.id} — 레코드 ${recs.size}건`);
    backup.months.push({
      city: cityRef.id, monthId: monthRef.id, meta,
      records: recs.docs.map((d) => ({ id: d.id, ...d.data() })),
    });
    planned++;
    if (WRITE) await db.recursiveDelete(monthRef);
  }
}

// ② 테스트 계정
for (const uid of TEST_UIDS) {
  const snap = await db.collection('users').doc(uid).get();
  let authUser = null;
  try { authUser = await admin.auth().getUser(uid); } catch { /* 없음 */ }
  if (!snap.exists && !authUser) continue;
  const data = snap.exists ? snap.data() : null;
  console.log(`🚨 테스트 계정: ${uid} — users=${snap.exists} auth=${!!authUser} 승인지자체=${JSON.stringify(data?.citiesApproved || [])}`);
  backup.users.push({ uid, users: data, auth: authUser ? { email: authUser.email, displayName: authUser.displayName } : null });
  planned++;
  if (WRITE) {
    if (snap.exists) await db.collection('users').doc(uid).delete();
    if (authUser) await admin.auth().deleteUser(uid).catch(() => {});
  }
}

if (planned === 0) { console.log('\n✅ 잔류물 없음 — 정리할 것이 없습니다.'); process.exit(0); }

// 백업은 바탕화면(리포에 커밋 금지 — 개인정보가 섞일 수 있다)
const dir = join(homedir(), 'Desktop', 'nexus-backups');
mkdirSync(dir, { recursive: true });
const file = join(dir, `test-residue-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
console.log(`\n백업: ${file}`);

if (!WRITE) { console.log(`\nDRY-RUN — 대상 ${planned}건. 반영하려면 --write`); process.exit(0); }

await db.collection('audit_logs').add({
  action: 'purge_test_residue',
  at: admin.firestore.FieldValue.serverTimestamp(),
  adminEmail: 'ttong627@gmail.com',
  counts: { months: backup.months.length, users: backup.users.length, cities: backup.cities.length },
  backupFile: file,
  note: '2026-08-27 점검 — E2E·진단 스크립트가 실제 지자체·계정에 남긴 흔적 정리',
});
console.log(`✅ 정리 완료 — ${planned}건 (audit_logs 기록됨)`);
process.exit(0);
