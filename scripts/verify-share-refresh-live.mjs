// 저장 시 **기사 지도 자동 갱신**이 운영에서 실제로 도는지 확인 — 2026-08-27
//   node scripts/verify-share-refresh-live.mjs
//
//   왜 실호출인가: 이 기능은 ①색인 ②보안규칙 ③질의 조건 세 곳이 맞아야 돈다.
//   하나만 어긋나도 **조용히 0건**이 되어 "저장했는데 기사 폰은 옛날 그대로"가 된다.
//   실제로 같은 종류(완료기록 조회)가 그렇게 죽어 있던 적이 있다.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, setDoc, doc, deleteDoc, getDoc } from 'firebase/firestore';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const E = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
const PROJECT = E('VITE_FIREBASE_PROJECT_ID') || 'logis-op';
const CITY = 'E2E검증시';
const MONTH = '9999-09';
const UID = 'e2e_share_refresh';

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const adb = admin.firestore();
const app = initializeApp({
  apiKey: E('VITE_FIREBASE_API_KEY'), authDomain: E('VITE_FIREBASE_AUTH_DOMAIN'), projectId: PROJECT,
  storageBucket: E('VITE_FIREBASE_STORAGE_BUCKET'), messagingSenderId: E('VITE_FIREBASE_MESSAGING_SENDER_ID'), appId: E('VITE_FIREBASE_APP_ID'),
});
const cauth = getAuth(app);
const cdb = getFirestore(app);

const results = [];
const ok = (n, c, x = '') => results.push([c ? '✅' : '🚨', n, x]);
const SHARE = `sr_ref_${Date.now().toString(36)}`;

try {
  try { await admin.auth().getUser(UID); } catch { await admin.auth().createUser({ uid: UID, email: 'e2e-refresh@example.com' }); }
  await adb.collection('users').doc(UID).set({ email: 'e2e-refresh@example.com', role: 'user', tier: 'sapphire', citiesApproved: [CITY], profileCompleted: true, _test: true }, { merge: true });
  await adb.collection('route_shares').doc(SHARE).set({
    city: CITY, monthId: MONTH, createdBy: 'e2e-refresh@example.com', createdByUid: UID,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600_000),
    drivers: [{ id: 'd1', name: '테스트기사', color: '#0f0' }], _test: true,
  });
  await adb.collection('route_shares').doc(SHARE).collection('records').doc('old1')
    .set({ id: 'old1', driverId: 'd1', 이름: '옛건', 주소: '옛주소', 배송순번: '9' });
  await adb.collection('route_sessions').doc(CITY).collection('months').doc(MONTH)
    .set({ city: CITY, monthId: MONTH, shareIds: [SHARE], _test: true }, { merge: true });

  const token = await admin.auth().createCustomToken(UID);
  await signInWithCustomToken(cauth, token);

  // ★저장 직후 코드가 쓰는 것과 **같은 경로** — 목록 질의가 아니라 세션 문서의 `shareIds` 이정표.
  //   (route_shares 목록 질의는 보안규칙이 막는다. 단일 문서 읽기만 통과한다 — 2026-08-27 실측)
  const sess = await getDoc(doc(cdb, 'route_sessions', CITY, 'months', MONTH));
  const ids = Array.isArray(sess.data()?.shareIds) ? sess.data().shareIds : [];
  ok('세션 문서의 공유 이정표 읽기', ids.includes(SHARE), `shareIds ${ids.length}개`);

  const sd = await getDoc(doc(cdb, 'route_shares', SHARE));
  const alive = sd.exists() && (sd.data()?.expiresAt?.toMillis?.() || 0) > Date.now();
  ok('★공유 문서 단일 읽기 + 유효기간 판정', alive);

  if (alive) {
    const sid = SHARE;
    await setDoc(doc(cdb, 'route_shares', sid, 'records', 'new1'), { id: 'new1', driverId: 'd1', 이름: '새건', 주소: '새주소', 배송순번: '1' });
    ok('새 배정 쓰기', true);
    await deleteDoc(doc(cdb, 'route_shares', sid, 'records', 'old1'));
    const after = await adb.collection('route_shares').doc(sid).collection('records').get();
    ok('빠진 건 삭제 — 기사 화면에 헛걸음이 남지 않는다', after.size === 1 && after.docs[0].id === 'new1',
      `남은 문서 ${after.docs.map((d) => d.id).join(',')}`);
  }
  await signOut(cauth);
} catch (e) {
  results.push(['🚨', '실행 중 예외', String(e?.message || e).slice(0, 160)]);
} finally {
  await adb.recursiveDelete(adb.collection('route_shares').doc(SHARE)).catch(() => {});
  await adb.recursiveDelete(adb.collection('route_sessions').doc(CITY)).catch(() => {});
  await adb.collection('users').doc(UID).delete().catch(() => {});
  await admin.auth().deleteUser(UID).catch(() => {});
}

for (const [m, n, x] of results) console.log(`${m} ${n}${x ? `  — ${x}` : ''}`);
const fails = results.filter((r) => r[0] === '🚨').length;
console.log(`\n판정: ${fails ? `🚨 ${fails}건 실패` : '✅ 전부 통과'} (테스트 문서 정리 완료)`);
process.exit(fails ? 1 : 0);
