// Firestore 보안규칙 회귀 — 공유링크 비밀번호(CLAUDE.md §14-1 SH-1~SH-6) 경계 실측
//   npm run test:rules   (= firebase emulators:exec --only firestore … — Java 필요)
//
//   ★"규칙 문법이 통과했다" ≠ "규칙이 막는다". 여기 케이스는 전부 독립 검사가 실제로 뚫거나 뚫릴 뻔한 경로다:
//     - 기사 토큰이 users 문서를 만들어 관리자로 올라가는 체인 / 토큰 하나로 그 공유 전 건을 읽는 경로
//     - 타 담당자가 남의 공유에 비밀번호(secrets)를 걸어 기사를 잠그는 경로 / 생성자가 건별 문서를 못 읽던 결함
//     - SSO 담당자(email 클레임 없음)의 createdBy:'' 빈 문자열 동치로 서로의 공유를 읽고 지우던 구멍
//   에뮬레이터 로그의 "evaluation error" 는 진단용 eager 평가라 판정(ALLOW/DENY)만 본다.
import fs from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, writeBatch } from 'firebase/firestore';

const rules = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'demo-nexus-rules', firestore: { rules } });
const now = Date.now();
const fut = new Date(now + 86400000), past = new Date(now - 3600000);

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/admin1'), { role: 'admin', email: 'admin@x.com' });
  await setDoc(doc(db, 'base_lists/city1'), { secret: 'PII' });
  const shares = [
    ['sr_A', { expiresAt: fut, createdBy: 'owner@x.com', createdByUid: 'owneruid' }],
    ['sr_B', { expiresAt: fut, createdBy: 'owner@x.com', createdByUid: 'owneruid' }],
    ['sr_exp', { expiresAt: past, createdBy: 'owner@x.com', createdByUid: 'owneruid' }],
    ['sr_sso', { expiresAt: fut, createdBy: '', createdByUid: 'ssouid' }],   // SSO 담당자(email 없음)가 만든 공유
  ];
  for (const [id, extra] of shares) {
    await setDoc(doc(db, `route_shares/${id}`), { createdAt: new Date(now), city: 'c', monthId: 'm', drivers: [{ id: 'd1' }, { id: 'd2' }], driverPhones: ['+821011112222'], liveGps: {}, ...extra });
    await setDoc(doc(db, `route_shares/${id}/records/r1`), { driverId: 'd1', driverPhone: '+821011112222', name: 'A', received: false });
    await setDoc(doc(db, `route_shares/${id}/records/r2`), { driverId: 'd2', driverPhone: '+821033334444', name: 'B', received: false });
  }
  await setDoc(doc(db, 'route_share_secrets/sr_A'), { passcodeHash: 'h', passcodeSalt: 's', createdBy: 'owner@x.com', createdByUid: 'owneruid' });
  // 기업(회사코드) — 남의 기업 기사명부를 companyCode 자가변경으로 열던 경로 검증용
  await setDoc(doc(db, 'user_companies/CO_MINE'), { ownerUid: 'otheruid', name: '내 회사' });
  await setDoc(doc(db, 'user_companies/CO_THEIRS'), { ownerUid: 'someoneelse', name: '남의 회사' });
  await setDoc(doc(db, 'user_companies/CO_THEIRS/drivers/d9'), { name: '남의기사', phone: '010-0000-0000' });
  await setDoc(doc(db, 'users/otheruid'), { email: 'other@x.com', role: 'user', tier: 'basic' });
});

const C = {
  unauth: env.unauthenticatedContext(),
  tokA1: env.authenticatedContext('share_sr_A_d1', { shareId: 'sr_A', driverId: 'd1', role: 'driver' }),
  tokExp: env.authenticatedContext('share_sr_exp_d1', { shareId: 'sr_exp', driverId: 'd1', role: 'driver' }),
  owner: env.authenticatedContext('owneruid', { email: 'owner@x.com' }),
  ownerSso: env.authenticatedContext('owneruid', { firebase: { sign_in_provider: 'custom' } }),
  sso: env.authenticatedContext('ssouid', { firebase: { sign_in_provider: 'custom' } }),
  ssoOther: env.authenticatedContext('ssoother', { firebase: { sign_in_provider: 'custom' } }),
  other: env.authenticatedContext('otheruid', { email: 'other@x.com' }),
  admin: env.authenticatedContext('admin1', { email: 'admin@x.com' }),
  phoneD1: env.authenticatedContext('phone1', { phone_number: '+821011112222' }),
};

const rows = []; let bad = 0;
const run = async (label, who, expect, fn) => {
  let actual;
  try { const r = await fn(C[who].firestore()); actual = 'ALLOW' + (typeof r === 'number' ? `(${r})` : ''); }
  catch (e) {
    const denied = e?.code === 'permission-denied' || /permission|PERMISSION|insufficient/i.test(String(e?.message || e));
    actual = denied ? 'DENY' : `ERR:${String(e?.message || e).slice(0, 70)}`;
  }
  const ok = actual.startsWith(expect); if (!ok) bad++;
  rows.push(`${ok ? '✅' : '🚨'} [${who}] ${label} → ${actual} (기대 ${expect})`);
};
const rec = (db, s, r) => getDoc(doc(db, `route_shares/${s}/records/${r}`)).then((d) => (d.exists() ? 1 : 0));
const listRecs = (db, s, d) => getDocs(query(collection(db, `route_shares/${s}/records`), where('driverId', '==', d))).then((x) => x.size);
const listAll = (db, s) => getDocs(collection(db, `route_shares/${s}/records`)).then((x) => x.size);

// ── 무인증 ──
await run('무인증 공유 읽기', 'unauth', 'DENY', (db) => getDoc(doc(db, 'route_shares/sr_A')));
await run('무인증 레코드 목록', 'unauth', 'DENY', (db) => listRecs(db, 'sr_A', 'd1'));
await run('무인증 users 생성(role admin)', 'unauth', 'DENY', (db) => setDoc(doc(db, 'users/zzz'), { role: 'admin' }));
// ── 기사 토큰(공유 A · 기사 d1) ──
await run('토큰 공유 읽기', 'tokA1', 'ALLOW', (db) => getDoc(doc(db, 'route_shares/sr_A')));
await run('토큰 자기 레코드 get', 'tokA1', 'ALLOW', (db) => rec(db, 'sr_A', 'r1'));
await run('토큰 남(d2) 레코드 get', 'tokA1', 'DENY', (db) => rec(db, 'sr_A', 'r2'));
await run('토큰 자기 레코드 목록(where d1)', 'tokA1', 'ALLOW(1)', (db) => listRecs(db, 'sr_A', 'd1'));
await run('토큰 남 레코드 목록(where d2)', 'tokA1', 'DENY', (db) => listRecs(db, 'sr_A', 'd2'));
await run('토큰 전체 목록(where 없음)', 'tokA1', 'DENY', (db) => listAll(db, 'sr_A'));
await run('토큰 다른 공유 읽기', 'tokA1', 'DENY', (db) => getDoc(doc(db, 'route_shares/sr_B')));
await run('토큰 자기 레코드 received 수정', 'tokA1', 'ALLOW', (db) => updateDoc(doc(db, 'route_shares/sr_A/records/r1'), { received: true }));
await run('토큰 자기 레코드 driverId 변경', 'tokA1', 'DENY', (db) => updateDoc(doc(db, 'route_shares/sr_A/records/r1'), { driverId: 'd2' }));
await run('토큰 자기 레코드 주소 변경', 'tokA1', 'DENY', (db) => updateDoc(doc(db, 'route_shares/sr_A/records/r1'), { 주소: 'x' }));
await run('토큰 남 레코드 수정', 'tokA1', 'DENY', (db) => updateDoc(doc(db, 'route_shares/sr_A/records/r2'), { received: true }));
await run('토큰 공유 liveGps 수정', 'tokA1', 'ALLOW', (db) => updateDoc(doc(db, 'route_shares/sr_A'), { 'liveGps.d1': { lat: 1 } }));
await run('토큰 공유 drivers 변조', 'tokA1', 'DENY', (db) => updateDoc(doc(db, 'route_shares/sr_A'), { drivers: [] }));
await run('★토큰 users 자가생성(role admin)', 'tokA1', 'DENY', (db) => setDoc(doc(db, 'users/share_sr_A_d1'), { role: 'admin' }));
await run('★토큰 users 자가생성(role user)', 'tokA1', 'DENY', (db) => setDoc(doc(db, 'users/share_sr_A_d1'), { role: 'user' }));
await run('토큰 base_lists 읽기', 'tokA1', 'DENY', (db) => getDoc(doc(db, 'base_lists/city1')));
await run('토큰 secrets 읽기', 'tokA1', 'DENY', (db) => getDoc(doc(db, 'route_share_secrets/sr_A')));
await run('토큰 공유 생성', 'tokA1', 'DENY', (db) => setDoc(doc(db, 'route_shares/sr_new'), { createdBy: 'x' }));
await run('토큰 공유 삭제', 'tokA1', 'DENY', (db) => deleteDoc(doc(db, 'route_shares/sr_A')));
// ── 만료 공유의 토큰 ──
await run('만료 토큰 공유 읽기', 'tokExp', 'DENY', (db) => getDoc(doc(db, 'route_shares/sr_exp')));
await run('만료 토큰 레코드', 'tokExp', 'DENY', (db) => rec(db, 'sr_exp', 'r1'));
// ── 생성자(이메일 · SSO uid) ──
await run('생성자 공유 읽기', 'owner', 'ALLOW', (db) => getDoc(doc(db, 'route_shares/sr_A')));
await run('★생성자 레코드 전체 목록', 'owner', 'ALLOW(2)', (db) => listAll(db, 'sr_A'));
await run('생성자(uid·email 없음) 공유 읽기', 'ownerSso', 'ALLOW', (db) => getDoc(doc(db, 'route_shares/sr_A')));
await run('생성자(uid·email 없음) 레코드 목록', 'ownerSso', 'ALLOW(2)', (db) => listAll(db, 'sr_A'));
await run('생성자 secrets 재설정(update)', 'owner', 'ALLOW', (db) => updateDoc(doc(db, 'route_share_secrets/sr_A'), { passcodeHash: 'h2', passcodeSalt: 's2', updatedAt: new Date() }));
await run('★생성자 — 자기 옛 공유(secrets 없음)에 비밀번호 추가', 'owner', 'ALLOW', (db) => setDoc(doc(db, 'route_share_secrets/sr_B'), { passcodeHash: 'h', passcodeSalt: 's', createdBy: 'owner@x.com', createdByUid: 'owneruid', createdAt: new Date() }));
await run('★생성자 배치(공유+secrets) 생성', 'owner', 'ALLOW', async (db) => {
  const b = writeBatch(db);
  b.set(doc(db, 'route_shares/sr_C'), { createdBy: 'owner@x.com', createdByUid: 'owneruid', createdAt: new Date(), expiresAt: fut, city: 'c', monthId: 'm', drivers: [] });
  b.set(doc(db, 'route_share_secrets/sr_C'), { passcodeHash: 'h', passcodeSalt: 's', createdBy: 'owner@x.com', createdByUid: 'owneruid', createdAt: new Date() });
  await b.commit();
});
// ── SSO 담당자 — createdBy:'' 빈 문자열 동치 차단 ──
await run('★SSO 생성자(uid) 자기 공유 읽기', 'sso', 'ALLOW', (db) => getDoc(doc(db, 'route_shares/sr_sso')));
await run('★SSO 생성자 레코드 목록', 'sso', 'ALLOW(2)', (db) => listAll(db, 'sr_sso'));
await run('★다른 SSO 담당자(email 없음) 남의 공유 읽기', 'ssoOther', 'DENY', (db) => getDoc(doc(db, 'route_shares/sr_sso')));
await run('★다른 SSO 담당자 남의 레코드 목록', 'ssoOther', 'DENY', (db) => listAll(db, 'sr_sso'));
await run('★다른 SSO 담당자 남의 공유 삭제', 'ssoOther', 'DENY', (db) => deleteDoc(doc(db, 'route_shares/sr_sso')));
// ── 타 담당자(이메일) ──
await run('타 담당자 공유 읽기', 'other', 'DENY', (db) => getDoc(doc(db, 'route_shares/sr_A')));
await run('타 담당자 공유 삭제', 'other', 'DENY', (db) => deleteDoc(doc(db, 'route_shares/sr_A')));
await run('★타 담당자 secrets 생성(남의 공유)', 'other', 'DENY', (db) => setDoc(doc(db, 'route_share_secrets/sr_B'), { passcodeHash: 'h', passcodeSalt: 's', createdBy: 'other@x.com', createdByUid: 'otheruid' }));
await run('타 담당자 secrets 재설정', 'other', 'DENY', (db) => updateDoc(doc(db, 'route_share_secrets/sr_A'), { passcodeHash: 'h3', passcodeSalt: 's3', updatedAt: new Date() }));
await run('일반 사용자 users 생성(role user·tier basic)', 'other', 'ALLOW', (db) => setDoc(doc(db, 'users/otheruid'), { email: 'other@x.com', role: 'user', tier: 'basic', lastLogin: new Date() }));
await run('일반 사용자 users 생성(role admin)', 'other', 'DENY', (db) => setDoc(doc(db, 'users/otheruid2'), { email: 'other@x.com', role: 'admin', tier: 'sapphire' }));
// ── 관리자 · 휴대폰 인증(보류 경로) ──
await run('관리자 공유 목록(where city)', 'admin', 'ALLOW', (db) => getDocs(query(collection(db, 'route_shares'), where('city', '==', 'c'))).then((x) => x.size));
await run('관리자 secrets 읽기', 'admin', 'ALLOW', (db) => getDoc(doc(db, 'route_share_secrets/sr_A')));
await run('휴대폰 인증 공유 읽기', 'phoneD1', 'ALLOW', (db) => getDoc(doc(db, 'route_shares/sr_A')));
await run('휴대폰 인증 자기 레코드', 'phoneD1', 'ALLOW(1)', (db) => rec(db, 'sr_A', 'r1'));
await run('휴대폰 인증 남 레코드', 'phoneD1', 'DENY', (db) => rec(db, 'sr_A', 'r2'));

// ── 회사코드 자가변경(2026-08-23 점검) ──
await run('★companyCode 를 남의 기업 코드로 self-update', 'other', 'DENY', (db) => updateDoc(doc(db, 'users/otheruid'), { companyCode: 'CO_THEIRS' }));
await run('★companyCode 를 내가 소유한 기업으로 self-update', 'other', 'ALLOW', (db) => updateDoc(doc(db, 'users/otheruid'), { companyCode: 'CO_MINE' }));
await run('남의 기업 문서 읽기', 'other', 'DENY', (db) => getDoc(doc(db, 'user_companies/CO_THEIRS')));
await run('내 소유 기업 문서 읽기', 'other', 'ALLOW', (db) => getDoc(doc(db, 'user_companies/CO_MINE')));
await run('★남의 기업 기사명부 읽기', 'other', 'DENY', (db) => getDoc(doc(db, 'user_companies/CO_THEIRS/drivers/d9')));
// ── 열람기록(share_access_logs) ──
await run('★무인증 열람기록 생성', 'unauth', 'DENY', (db) => setDoc(doc(db, 'share_access_logs/l1'), { shareId: 'sr_A', at: new Date().toISOString(), count: 1 }));
await run('공유 토큰으로 열람기록 생성', 'tokA1', 'ALLOW', (db) => setDoc(doc(db, 'share_access_logs/l2'), { shareId: 'sr_A', at: new Date().toISOString(), count: 1, driverId: 'd1' }));
await run('담당자 세션으로 열람기록 생성', 'owner', 'ALLOW', (db) => setDoc(doc(db, 'share_access_logs/l3'), { shareId: 'sr_A', at: new Date().toISOString(), count: 1 }));

for (const r of rows) console.log(r);
console.log(`\n규칙 실측: ${rows.length}건 중 불일치 ${bad}`);
await env.cleanup();
process.exit(bad ? 1 : 0);
