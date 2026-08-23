// 공유링크 비밀번호(SH-1~6) **운영 실호출 검증** — 배포 직후 반드시 돌린다(CLAUDE.md SH-6).
//   "배포됐다" ≠ "동작한다": 커스텀 토큰 서명 IAM 이 없으면 배포는 성공하고 호출만 죽는다.
//
//   하는 일(자기 테스트 문서만 만들고 지운다 · 실명단은 건드리지 않는다):
//     1. admin 으로 테스트 공유 `route_shares/sr_test…`(만료 +1h) + 레코드 2건 + secrets(비밀번호 해시) 생성
//     2. openShare 호출: 빈 비밀번호 → PASSCODE_REQUIRED / 오답 → permission-denied / 정답 → 토큰
//     3. 클라 SDK 로 토큰 로그인 → 공유·레코드 읽기 성공 / 로그아웃 후 무토큰 읽기 → 거부 / 다른 공유 토큰 → 거부
//     4. 오답 5회 → resource-exhausted(잠금) · secrets 없는 옛 공유 → 빈 비밀번호로 토큰(이행기)
//     5. 테스트 문서 전부 삭제
//   사용: node scripts/verify-share-passcode-live.mjs
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { hashPasscode, newSalt } from '../src/utils/sharePasscode.js';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const E = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
const PROJECT = E('VITE_FIREBASE_PROJECT_ID') || 'logis-op';
const FN_URL = `https://asia-northeast3-${PROJECT}.cloudfunctions.net/openShare`;

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const adb = admin.firestore();
const app = initializeApp({
  apiKey: E('VITE_FIREBASE_API_KEY'), authDomain: E('VITE_FIREBASE_AUTH_DOMAIN'), projectId: PROJECT,
  storageBucket: E('VITE_FIREBASE_STORAGE_BUCKET'), messagingSenderId: E('VITE_FIREBASE_MESSAGING_SENDER_ID'), appId: E('VITE_FIREBASE_APP_ID'),
});
const cauth = getAuth(app); const cdb = getFirestore(app);

const rid = () => `sr_test_${crypto.randomUUID().replace(/-/g, '')}`;
const SHARE = rid(), LEGACY = rid(), OTHER = rid();
const PASS = '482917', WRONG = '000000';
const results = []; const ok = (name, cond, extra = '') => { results.push([cond ? '✅' : '🚨', name, extra]); };

const callOpen = async (shareId, passcode, driverId = 'd1') => {
  const res = await fetch(FN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { shareId, passcode, driverId } }) });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, result: j.result, error: j.error };
};
const canRead = async (shareId) => {
  try { const s = await getDoc(doc(cdb, 'route_shares', shareId)); return s.exists(); } catch { return false; }
};
const canReadRecords = async (shareId, driverId = 'd1') => {
  try { const s = await getDocs(query(collection(cdb, 'route_shares', shareId, 'records'), where('driverId', '==', driverId))); return s.size; } catch { return -1; }
};
const canReadAllRecords = async (shareId) => {
  try { const s = await getDocs(collection(cdb, 'route_shares', shareId, 'records')); return s.size; } catch { return -1; }
};

const expires = admin.firestore.Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);
const mkShare = async (id) => {
  await adb.collection('route_shares').doc(id).set({ city: 'TEST', monthId: '0000-00', createdBy: 'script:verify', createdAt: admin.firestore.FieldValue.serverTimestamp(), expiresAt: expires, drivers: [{ id: 'd1', name: '테스트기사', color: '#0f0' }], driverPhones: [], _test: true });
  const b = adb.batch();
  b.set(adb.collection('route_shares').doc(id).collection('records').doc('r1'), { id: 'r1', driverId: 'd1', driverPhone: '', 이름: '테스트', 주소: '테스트로 1', 포수: 1 });
  b.set(adb.collection('route_shares').doc(id).collection('records').doc('r2'), { id: 'r2', driverId: 'd1', driverPhone: '', 이름: '테스트', 주소: '테스트로 2', 포수: 1 });
  b.set(adb.collection('route_shares').doc(id).collection('records').doc('r3'), { id: 'r3', driverId: 'd2', driverPhone: '', 이름: '테스트', 주소: '테스트로 3', 포수: 1 });   // 남의 기사 건 — 토큰 d1 로는 안 보여야 한다
  await b.commit();
};
const cleanup = async () => {
  for (const id of [SHARE, LEGACY, OTHER]) {
    await adb.recursiveDelete(adb.collection('route_shares').doc(id)).catch(() => {});
    await adb.collection('route_share_secrets').doc(id).delete().catch(() => {});
    // 잠금 테스트가 남긴 시도 문서(route_share_attempts/{id}_{ipHash})도 지운다 — 안 지우면 TTL 없이 쌓인다(검사 지적)
    const att = await adb.collection('route_share_attempts')
      .where(admin.firestore.FieldPath.documentId(), '>=', `${id}_`)
      .where(admin.firestore.FieldPath.documentId(), '<', `${id}_`).get().catch(() => null);
    for (const d of att?.docs || []) await d.ref.delete().catch(() => {});
    for (const d of ['d1', 'x']) await admin.auth().deleteUser(`share_${id}_${d}`).catch(() => {});
  }
};

try {
  console.log(`대상 ${FN_URL}`);
  await mkShare(SHARE); await mkShare(LEGACY); await mkShare(OTHER);
  const salt = newSalt();
  await adb.collection('route_share_secrets').doc(SHARE).set({ passcodeHash: await hashPasscode(PASS, salt), passcodeSalt: salt, createdBy: 'script:verify', createdAt: admin.firestore.FieldValue.serverTimestamp() });
  const salt2 = newSalt();
  await adb.collection('route_share_secrets').doc(OTHER).set({ passcodeHash: await hashPasscode(PASS, salt2), passcodeSalt: salt2, createdBy: 'script:verify', createdAt: admin.firestore.FieldValue.serverTimestamp() });

  // 무토큰 읽기 거부
  ok('무토큰 공유 읽기 거부', !(await canRead(SHARE)));
  ok('무토큰 레코드 읽기 거부', (await canReadRecords(SHARE)) === -1);

  // probe(빈 비밀번호) → PASSCODE_REQUIRED
  const p = await callOpen(SHARE, '');
  ok('빈 비밀번호 → failed-precondition(PASSCODE_REQUIRED)', p.error?.status === 'FAILED_PRECONDITION', JSON.stringify(p.error || p.result).slice(0, 80));
  // 오답
  const w = await callOpen(SHARE, WRONG);
  ok('오답 → permission-denied', w.error?.status === 'PERMISSION_DENIED', JSON.stringify(w.error).slice(0, 80));
  // 정답 → 토큰 → 읽기 OK
  const g = await callOpen(SHARE, PASS);
  ok('정답 → 토큰 발급', typeof g.result?.token === 'string' && g.result.legacy === false, JSON.stringify(g.error || '').slice(0, 120));
  if (g.result?.token) {
    await signInWithCustomToken(cauth, g.result.token);
    const claims = (await cauth.currentUser.getIdTokenResult()).claims;
    ok('토큰 claims.shareId 일치', claims.shareId === SHARE, `uid=${cauth.currentUser.uid}`);
    ok('토큰으로 공유 읽기 OK', await canRead(SHARE));
    ok('토큰(d1)으로 자기 레코드 2건 읽기 OK', (await canReadRecords(SHARE, 'd1')) === 2);
    ok('토큰(d1)으로 남(d2) 레코드 거부', (await canReadRecords(SHARE, 'd2')) === -1);
    ok('토큰으로 전체 목록(where 없음) 거부', (await canReadAllRecords(SHARE)) === -1);
    ok('다른 공유는 같은 토큰으로 거부', !(await canRead(OTHER)));
    await signOut(cauth);
    ok('로그아웃 후 다시 거부', !(await canRead(SHARE)));
  }
  // 잠금: 오답 5회 → 이후 resource-exhausted
  for (let i = 0; i < 5; i++) await callOpen(OTHER, WRONG);
  const locked = await callOpen(OTHER, PASS);
  ok('오답 5회 후 정답도 잠금(resource-exhausted)', locked.error?.status === 'RESOURCE_EXHAUSTED', JSON.stringify(locked.error || locked.result).slice(0, 100));
  // 옛 링크(secrets 없음) → 빈 비밀번호로 토큰(legacy)
  const l = await callOpen(LEGACY, '');
  ok('secrets 없는 옛 공유 → 빈 비밀번호로 토큰(legacy=true)', typeof l.result?.token === 'string' && l.result.legacy === true, JSON.stringify(l.error || '').slice(0, 120));
  if (l.result?.token) { await signInWithCustomToken(cauth, l.result.token); ok('옛 공유 토큰으로 읽기 OK', await canRead(LEGACY)); await signOut(cauth); }
  // 형식 불량
  const bad = await callOpen('not-a-share', PASS);
  ok('잘못된 shareId → invalid-argument', bad.error?.status === 'INVALID_ARGUMENT');
} catch (e) {
  results.push(['🚨', '실행 중 예외', String(e?.message || e)]);
} finally {
  await cleanup();
}
for (const [m, n, x] of results) console.log(`${m} ${n}${x ? `  — ${x}` : ''}`);
const fails = results.filter((r) => r[0] === '🚨').length;
console.log(`\n판정: ${fails ? `🚨 ${fails}건 실패` : '✅ 전부 통과'} (테스트 문서 정리 완료)`);
process.exit(fails ? 1 : 0);
