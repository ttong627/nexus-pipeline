// 비밀번호 **변경 시 기존 토큰 무효화**(ver 세대) 운영 실호출 검증 — 2026-08-24
//   node scripts/verify-passcode-rotation-live.mjs
//
//   왜 실호출로 확인하나: 이 기능은 서버(토큰에 ver)·규칙(문서 ver 와 대조)·클라(변경 시 ver+1) **세 곳이 맞물려야** 동작한다.
//   하나만 어긋나도 "바꿨는데 옛 화면이 계속 열리는" 상태가 되고, 그건 번호가 샜을 때 가장 필요한 순간에 드러난다.
//
//   흐름: 테스트 공유 생성 → 비밀번호 A 로 입장(토큰 획득) → 담당자가 번호를 B 로 변경(ver+1)
//        → **옛 토큰으로 읽기 거부** 확인 → 새 번호로 다시 입장해 읽기 성공 확인 → 정리
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
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
// ★두 번째 입장은 **독립 클라이언트**로 한다(2026-08-24).
//   같은 앱 인스턴스에서 signOut→signIn 을 하면 Firestore 가 옛 ID 토큰을 붙든 채 질의해
//   서버는 ver=0 토큰으로 보고 거부한다 — 기능이 아니라 SDK 토큰 캐시의 문제였다.
//   실제 기사 화면은 링크를 새로 여는(=새 클라이언트) 흐름이라 이쪽이 현실과도 맞다.
const app2 = initializeApp({
  apiKey: E('VITE_FIREBASE_API_KEY'), authDomain: E('VITE_FIREBASE_AUTH_DOMAIN'), projectId: PROJECT,
  storageBucket: E('VITE_FIREBASE_STORAGE_BUCKET'), messagingSenderId: E('VITE_FIREBASE_MESSAGING_SENDER_ID'), appId: E('VITE_FIREBASE_APP_ID'),
}, 'second');
const cauth2 = getAuth(app2);
const cdb2 = getFirestore(app2);

const SHARE = `sr_test_${crypto.randomUUID().replace(/-/g, '')}`;
const PASS_A = '111111';
const PASS_B = '222222';
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? '✅' : '🚨', name, extra]);

const open = async (passcode) => {
  const res = await fetch(FN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { shareId: SHARE, passcode, driverId: 'd1' } }),
  });
  return (await res.json().catch(() => ({}))).result || null;
};
let lastErr = '';
const canReadWith = async (fdb) => {
  try { lastErr = ''; return (await getDoc(doc(fdb, 'route_shares', SHARE))).exists(); }
  catch (e) { lastErr = e?.code || String(e?.message || e); return false; }
};
const canRead = () => canReadWith(cdb);
// 실패했을 때 추측하지 않도록, 그 순간의 문서 ver 와 토큰 ver 를 같이 찍는다.
const diag = async (au = cauth) => {
  const docVer = (await adb.collection('route_share_secrets').doc(SHARE).get()).get('ver');
  const cl = await au.currentUser?.getIdTokenResult(false);
  return `err=${lastErr} 문서ver=${docVer} 토큰ver=${cl?.claims?.ver} shareId=${cl?.claims?.shareId === SHARE} driverId=${cl?.claims?.driverId}`;
};

try {
  console.log(`대상 ${SHARE}`);
  const expires = admin.firestore.Timestamp.fromMillis(Date.now() + 3600_000);
  await adb.collection('route_shares').doc(SHARE).set({
    city: 'TEST', monthId: '0000-00', createdBy: 'script:verify', createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: expires, drivers: [{ id: 'd1', name: '테스트기사', color: '#0f0' }], _test: true,
  });
  await adb.collection('route_shares').doc(SHARE).collection('records').doc('r1')
    .set({ id: 'r1', driverId: 'd1', 이름: '테스트', 주소: '테스트로 1', 포수: 1 });

  const saltA = newSalt();
  await adb.collection('route_share_secrets').doc(SHARE).set({
    passcodeHash: await hashPasscode(PASS_A, saltA), passcodeSalt: saltA, ver: 0,
    createdBy: 'script:verify', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 1) 옛 번호로 입장
  const first = await open(PASS_A);
  ok('첫 번호로 입장(토큰 발급)', !!first?.token);
  if (!first?.token) throw new Error('토큰을 못 받아 이후 검증 불가');
  await signInWithCustomToken(cauth, first.token);
  ok('입장한 토큰으로 공유 읽기', await canRead());

  // 2) 담당자가 번호를 바꾼다(ver+1)
  const saltB = newSalt();
  await adb.collection('route_share_secrets').doc(SHARE).update({
    passcodeHash: await hashPasscode(PASS_B, saltB), passcodeSalt: saltB,
    ver: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await new Promise((r) => setTimeout(r, 1500));   // 규칙이 새 문서를 보도록 잠깐 둔다

  // 3) ★옛 토큰은 즉시 끊겨야 한다
  ok('★번호 변경 후 옛 토큰으로 읽기 거부', !(await canRead()));
  await signOut(cauth);

  // 4) 옛 번호는 더 이상 통하지 않고, 새 번호로는 다시 들어가진다
  const withOld = await open(PASS_A);
  ok('옛 번호로는 입장 불가', !withOld?.token);
  const second = await open(PASS_B);
  ok('새 번호로 입장', !!second?.token);
  if (second?.token) {
    await signInWithCustomToken(cauth2, second.token);          // 독립 클라이언트(위 주석 참조)
    const r2 = await canReadWith(cdb2);
    ok('새 토큰으로 공유 읽기', r2, r2 ? '' : await diag(cauth2));
    await signOut(cauth2);
  }
} catch (e) {
  results.push(['🚨', '실행 중 예외', String(e?.message || e)]);
} finally {
  await adb.recursiveDelete(adb.collection('route_shares').doc(SHARE)).catch(() => {});
  await adb.collection('route_share_secrets').doc(SHARE).delete().catch(() => {});
  await admin.auth().deleteUser(`share_${SHARE}_d1`).catch(() => {});
}

for (const [m, n, x] of results) console.log(`${m} ${n}${x ? `  — ${x}` : ''}`);
const fails = results.filter((r) => r[0] === '🚨').length;
console.log(`\n판정: ${fails ? `🚨 ${fails}건 실패` : '✅ 전부 통과'} (테스트 문서 정리 완료)`);
process.exit(fails ? 1 : 0);
