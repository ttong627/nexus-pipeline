// 열람기록(share_access_logs)이 **실제로 남는지** 운영 실호출로 확인 — 2026-08-24
//   node scripts/verify-access-log-live.mjs
//
//   왜 필요한가: 이 기록은 유출을 '인지'하는 유일한 수단이다(개정 개인정보보호법 72시간 통지의 전제).
//   그런데 08-08~08-23 에는 CSP 가 Functions 호출을 막아 **15일간 조용히 죽어 있었다** — 배포는 성공했고
//   로그도 정상으로 보였다. 지금도 운영 기록이 0건인데, 유효 공유가 없어 확인 기회가 없었을 뿐인지
//   경로가 또 죽은 것인지 구분이 안 된다. 그래서 기사 화면이 쓰는 **그 payload 그대로** 한 번 써 본다.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc } from 'firebase/firestore';
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
const cauth = getAuth(app);
const cdb = getFirestore(app);

const SHARE = `sr_test_${crypto.randomUUID().replace(/-/g, '')}`;
const PASS = '424242';
const results = [];
const ok = (n, c, x = '') => results.push([c ? '✅' : '🚨', n, x]);
let logId = '';

try {
  const expires = admin.firestore.Timestamp.fromMillis(Date.now() + 3600_000);
  await adb.collection('route_shares').doc(SHARE).set({
    city: 'TEST', monthId: '0000-00', createdBy: 'script:verify', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: expires, drivers: [{ id: 'd1', name: '테스트기사', color: '#0f0' }], _test: true,
  });
  const salt = newSalt();
  await adb.collection('route_share_secrets').doc(SHARE).set({
    passcodeHash: await hashPasscode(PASS, salt), passcodeSalt: salt, ver: 0,
    createdBy: 'script:verify', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const res = await fetch(FN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { shareId: SHARE, passcode: PASS, driverId: 'd1' } }),
  });
  const token = (await res.json().catch(() => ({})))?.result?.token;
  ok('비밀번호 입장(토큰 발급)', !!token);
  if (!token) throw new Error('토큰 없음 — 이후 검증 불가');
  await signInWithCustomToken(cauth, token);

  // ★기사 화면이 쓰는 payload 그대로
  let err = '';
  try {
    const ref = await addDoc(collection(cdb, 'share_access_logs'), {
      at: new Date().toISOString(), shareId: SHARE, count: 3,
      driverId: 'd1', driverName: '테스트기사',
      phone: cauth.currentUser?.phoneNumber || '', uid: cauth.currentUser?.uid || '',
      source: 'subcollection',
    });
    logId = ref.id;
  } catch (e) { err = e?.code || String(e?.message || e); }
  ok('★기사 토큰으로 열람기록 남기기', !!logId, err);

  if (logId) {
    const saved = await adb.collection('share_access_logs').doc(logId).get();
    ok('서버에 실제로 저장됨', saved.exists && saved.get('shareId') === SHARE);
    ok('누가·몇 건 열었는지 남는다', !!saved.get('uid') && saved.get('count') === 3,
      `uid=${saved.get('uid') ? '있음' : '없음'} count=${saved.get('count')}`);
  }
  await signOut(cauth);
} catch (e) {
  results.push(['🚨', '실행 중 예외', String(e?.message || e)]);
} finally {
  if (logId) await adb.collection('share_access_logs').doc(logId).delete().catch(() => {});
  await adb.recursiveDelete(adb.collection('route_shares').doc(SHARE)).catch(() => {});
  await adb.collection('route_share_secrets').doc(SHARE).delete().catch(() => {});
  await admin.auth().deleteUser(`share_${SHARE}_d1`).catch(() => {});
}

for (const [m, n, x] of results) console.log(`${m} ${n}${x ? `  — ${x}` : ''}`);
const fails = results.filter((r) => r[0] === '🚨').length;
console.log(`\n판정: ${fails ? `🚨 ${fails}건 실패` : '✅ 전부 통과'} (테스트 문서 정리 완료)`);
process.exit(fails ? 1 : 0);
