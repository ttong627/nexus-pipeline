// 카카오 프록시(/api/kakao) **운영 실호출 검증** — 배포 직후 돌린다.
//   배경(2026-08-23 점검): REST 키가 클라이언트 번들에 실려 있었다(도메인 제한 불가 → 누구나 도용).
//   이제 키는 서버에만 있고 브라우저는 이 프록시만 부른다. 프록시가 죽으면 **좌표 매칭이 통째로 멈추므로**
//   "배포됐다"가 아니라 "조회가 된다"를 확인해야 한다.
//
//   하는 일: ①무인증 거부 ②관리자 토큰으로 주소·키워드 조회 성공 ③공유(기사) 토큰 거부 ④허용 안 된 op 거부
//   사용: node scripts/verify-kakao-proxy-live.mjs
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const E = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
const PROJECT = E('VITE_FIREBASE_PROJECT_ID') || 'logis-op';
const API_KEY = E('VITE_FIREBASE_API_KEY');
const URL_PROXY = `https://asia-northeast3-${PROJECT}.cloudfunctions.net/api/kakao`;

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });

const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? '✅' : '🚨', name, extra]);

// 커스텀 토큰 → ID 토큰 (Identity Toolkit)
const idTokenFor = async (uid, claims = {}) => {
  const custom = await admin.auth().createCustomToken(uid, claims);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`ID 토큰 교환 실패: ${JSON.stringify(j.error || j).slice(0, 160)}`);
  return j.idToken;
};

const callProxy = async (body, token) => {
  const r = await fetch(URL_PROXY, {
    method: 'POST',
    // ★`X-Id-Token` — Cloud Run 이 Authorization 을 IAM 토큰으로 가로채 함수에 닿기 전에 401 을 낸다(2026-08-23 실측)
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Id-Token': token } : {}) },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
};

const TEST_UID = 'verify_kakao_proxy_tmp';
try {
  console.log(`대상 ${URL_PROXY}`);

  const anon = await callProxy({ op: 'address', params: { query: '동대문구 왕산로 72' } });
  ok('무인증 거부(401)', anon.status === 401, JSON.stringify(anon.body).slice(0, 60));

  const staff = await idTokenFor(TEST_UID);
  const hit = await callProxy({ op: 'address', params: { query: '서울 동대문구 왕산로 72' } }, staff);
  const doc = hit.body?.documents?.[0];
  ok('로그인 토큰으로 주소 조회 성공', hit.status === 200 && !!doc?.x && !!doc?.y,
    doc ? `좌표 확인(${Number(doc.y).toFixed(4)}, ${Number(doc.x).toFixed(4)})` : JSON.stringify(hit.body).slice(0, 80));

  const kw = await callProxy({ op: 'keyword', params: { query: '동대문구청', size: 3 } }, staff);
  ok('키워드 조회 성공', kw.status === 200 && Array.isArray(kw.body?.documents) && kw.body.documents.length > 0,
    `${kw.body?.documents?.length ?? 0}건`);

  const shareTok = await idTokenFor('share_verify_tmp', { shareId: 'sr_verify0000', driverId: 'd1', role: 'driver' });
  const shareTry = await callProxy({ op: 'address', params: { query: '왕산로 72' } }, shareTok);
  ok('기사(공유) 토큰 거부(403)', shareTry.status === 403, JSON.stringify(shareTry.body).slice(0, 60));

  const badOp = await callProxy({ op: 'directions', params: { query: 'x' } }, staff);
  ok('허용 안 된 op 거부(400)', badOp.status === 400, JSON.stringify(badOp.body).slice(0, 60));
} catch (e) {
  results.push(['🚨', '실행 중 예외', String(e?.message || e)]);
} finally {
  for (const uid of [TEST_UID, 'share_verify_tmp']) await admin.auth().deleteUser(uid).catch(() => {});
}

for (const [m, n, x] of results) console.log(`${m} ${n}${x ? `  — ${x}` : ''}`);
const fails = results.filter((r) => r[0] === '🚨').length;
console.log(`\n판정: ${fails ? `🚨 ${fails}건 실패` : '✅ 전부 통과'}`);
process.exit(fails ? 1 : 0);
