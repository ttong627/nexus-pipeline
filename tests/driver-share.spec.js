// 기사 공유 화면 E2E — **실제 브라우저로 화면을 그려서** 확인한다. 2026-08-24
//
//   왜 이게 있어야 하나: 2026-08-13~08-24 사이 기사 화면은 **열자마자 ReferenceError 로 죽어 있었다**.
//   그동안 서버·규칙·권한을 찌르는 실호출 검증은 전부 ✅ 였다 — 스크립트는 **화면을 그리지 않기 때문**이다.
//   기존 스모크(smoke.spec.js)도 `/` 셸만 봐서 이 경로를 한 번도 열지 않았다.
//   → 기사가 실제로 밟는 순서(링크 → 비밀번호 → 목록·지도)를 그대로 밟는다.
//
//   대상: 기본은 **운영**(배포된 것이 진짜 동작하는지). E2E_BASE 로 미리보기/로컬 지정 가능.
import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { hashPasscode, newSalt, DEFAULT_SHARE_PASSCODE } from '../src/utils/sharePasscode.js';

const BASE = (process.env.E2E_BASE || 'https://logis-op.web.app').replace(/\/+$/, '');
const PASS = '135790';
const WRONG = '246800';
const DRIVER = 'd1';
const NAMES = ['홍길동테스트', '김철수테스트', '이영희테스트'];
let SHARE = '';
let SHARE_NOSEC = '';   // 비밀번호 문서가 아예 없는 지도(옛 링크 · 담당자가 안 정한 경우)

// 화면을 죽이는 신호만 모은다(네트워크·firebase 경고는 정상 동작에도 나온다).
const watchFatal = (page) => {
  const fatal = [];
  page.on('pageerror', (e) => fatal.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/ReferenceError|TypeError|is not a constructor|Cannot access|Refused to/.test(t)) fatal.push(`console: ${t}`);
  });
  return fatal;
};

test.beforeAll(async () => {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
  }
  const db = admin.firestore();
  SHARE = `sr_e2e_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  await db.collection('route_shares').doc(SHARE).set({
    city: 'E2E테스트시', monthId: '0000-00', createdBy: 'e2e:playwright',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600_000),
    drivers: [{ id: DRIVER, name: '테스트기사', color: '#22c55e' }], _test: true,
  });
  // 기사 화면이 실제로 그릴 데이터 — 좌표까지 넣어야 지도 경로·핀 경로가 돈다.
  const batch = db.batch();
  NAMES.forEach((name, i) => {
    batch.set(db.collection('route_shares').doc(SHARE).collection('records').doc(`r${i + 1}`), {
      id: `r${i + 1}`, driverId: DRIVER, 이름: name, 주소: `서울특별시 동대문구 왕산로 ${70 + i * 2}`,
      포수: i + 1, 배송순번: String(i + 1), 행정동: '전농동',
      lat: 37.5794 + i * 0.001, lng: 127.0499 + i * 0.001,
    });
  });
  await batch.commit();
  const salt = newSalt();
  await db.collection('route_share_secrets').doc(SHARE).set({
    passcodeHash: await hashPasscode(PASS, salt), passcodeSalt: salt, ver: 0,
    createdBy: 'e2e:playwright', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ★비밀번호 문서를 **일부러 만들지 않는** 지도 — 형이 겪은 "기존 발행한 지도가 비밀번호를 묻는" 상황 그대로.
  //   기본번호(181111)로 열려야 한다(형 지시 2026-08-25).
  SHARE_NOSEC = `sr_e2e_${Date.now().toString(36)}nosec`;
  await db.collection('route_shares').doc(SHARE_NOSEC).set({
    city: 'E2E테스트시', monthId: '0000-00', createdBy: 'e2e:playwright',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600_000),
    drivers: [{ id: DRIVER, name: '테스트기사', color: '#22c55e' }], _test: true,
  });
  await db.collection('route_shares').doc(SHARE_NOSEC).collection('records').doc('r1').set({
    id: 'r1', driverId: DRIVER, 이름: NAMES[0], 주소: '서울특별시 동대문구 왕산로 70',
    포수: 1, 배송순번: '1', 행정동: '전농동', lat: 37.5794, lng: 127.0499,
  });
});

test.afterAll(async () => {
  if (!SHARE || !admin.apps.length) return;
  const db = admin.firestore();
  await db.recursiveDelete(db.collection('route_shares').doc(SHARE)).catch(() => {});
  await db.collection('route_share_secrets').doc(SHARE).delete().catch(() => {});
  await admin.auth().deleteUser(`share_${SHARE}_${DRIVER}`).catch(() => {});
  if (SHARE_NOSEC) {
    await db.recursiveDelete(db.collection('route_shares').doc(SHARE_NOSEC)).catch(() => {});
    // 기본번호로 열리면 서버가 비밀번호 문서를 만들어 굳힌다 — 그것도 지운다.
    await db.collection('route_share_secrets').doc(SHARE_NOSEC).delete().catch(() => {});
    await admin.auth().deleteUser(`share_${SHARE_NOSEC}_${DRIVER}`).catch(() => {});
    const l2 = await db.collection('share_access_logs').where('shareId', '==', SHARE_NOSEC).get().catch(() => null);
    if (l2) await Promise.all(l2.docs.map((d) => d.ref.delete().catch(() => {})));
  }
  // ★열람기록은 화면이 뜬 **뒤에** 쓰인다 — 바로 지우면 마지막 한 건이 뒤늦게 남는다(실측 3건).
  //   잠깐 기다렸다가 두 번 훑는다. 남겨두면 실행할 때마다 운영 로그에 테스트 흔적이 쌓인다.
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const logs = await db.collection('share_access_logs').where('shareId', '==', SHARE).get().catch(() => null);
    if (logs) await Promise.all(logs.docs.map((d) => d.ref.delete().catch(() => {})));
  }
});

test('① 기사 링크를 열면 비밀번호 창이 뜬다 (흰 화면이 아니다)', async ({ page }) => {
  const fatal = watchFatal(page);
  await page.goto(`${BASE}/?r=${SHARE}&d=${DRIVER}`, { waitUntil: 'domcontentloaded' });
  // ★이 화면이 08-13~08-24 동안 렌더 즉시 죽어 있었다 — 그래서 '내용이 있는가'부터 본다.
  await expect.poll(async () => (await page.locator('#root').innerHTML()).length, { timeout: 20000 }).toBeGreaterThan(200);
  await expect(page.locator('input[inputmode="numeric"], input[type="password"], input[type="tel"]').first()).toBeVisible({ timeout: 20000 });
  expect(fatal, `화면을 죽이는 오류:\n${fatal.join('\n')}`).toEqual([]);
});

test('② 올바른 비밀번호로 들어가면 내 배송 목록이 보인다', async ({ page }) => {
  const fatal = watchFatal(page);
  await page.goto(`${BASE}/?r=${SHARE}&d=${DRIVER}`, { waitUntil: 'domcontentloaded' });
  const input = page.locator('input[inputmode="numeric"], input[type="password"], input[type="tel"]').first();
  await input.waitFor({ timeout: 20000 });
  await input.fill(PASS);
  await page.keyboard.press('Enter');
  // 수급자 이름이 실제로 그려져야 한다(권한·구독·렌더가 전부 살아 있다는 뜻)
  await expect(page.getByText(NAMES[0], { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(NAMES[2], { exact: false }).first()).toBeVisible({ timeout: 15000 });
  expect(fatal, `화면을 죽이는 오류:\n${fatal.join('\n')}`).toEqual([]);
});

// ★HTTPS 에서만 의미가 있다: `vite preview`(http://localhost) 로 열면 지도 SDK 주소가 `http://dapi.kakao.com` 이 되고
//   카카오가 ORB 로 막는다(실측 `ERR_BLOCKED_BY_ORB`). 앱 결함이 아니라 환경 차이라 그때는 건너뛴다.
//   운영(https)에서는 200 으로 받고 `kakao.maps.Map` 까지 준비되는 것을 확인했다.
test('③ 지도(카카오 SDK)가 CSP 에 막히지 않고 실제로 뜬다', async ({ page }) => {
  test.skip(!BASE.startsWith('https://'), 'HTTP 로컬 미리보기에서는 카카오가 SDK 를 막는다(환경 차이)');
  const fatal = watchFatal(page);
  await page.goto(`${BASE}/?r=${SHARE}&d=${DRIVER}`, { waitUntil: 'domcontentloaded' });
  const input = page.locator('input[inputmode="numeric"], input[type="password"], input[type="tel"]').first();
  await input.waitFor({ timeout: 20000 });
  await input.fill(PASS);
  await page.keyboard.press('Enter');
  await expect(page.getByText(NAMES[0], { exact: false }).first()).toBeVisible({ timeout: 30000 });
  // ★CSP 에서 script-src 'unsafe-inline' 을 뺐다(2026-08-24). 지도 SDK 가 막히면 여기서 걸린다.
  await expect.poll(async () => page.evaluate(() => !!(window.kakao && window.kakao.maps && window.kakao.maps.Map)), { timeout: 30000 }).toBe(true);
  expect(fatal.filter((f) => /Refused to/.test(f)), `CSP 가 무언가를 막았다:\n${fatal.join('\n')}`).toEqual([]);
});

test('④ 틀린 비밀번호는 들어가지 못한다', async ({ page }) => {
  await page.goto(`${BASE}/?r=${SHARE}&d=${DRIVER}`, { waitUntil: 'domcontentloaded' });
  const input = page.locator('input[inputmode="numeric"], input[type="password"], input[type="tel"]').first();
  await input.waitFor({ timeout: 20000 });
  await input.fill(WRONG);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);
  await expect(page.getByText(NAMES[0], { exact: false })).toHaveCount(0);
});

test('⑤ 비밀번호를 안 정한 지도는 기본번호로 열린다 (형 지시 2026-08-25)', async ({ page }) => {
  const fatal = watchFatal(page);
  await page.goto(`${BASE}/?r=${SHARE_NOSEC}&d=${DRIVER}`, { waitUntil: 'domcontentloaded' });
  const input = page.locator('input[inputmode="numeric"], input[type="password"], input[type="tel"]').first();
  await input.waitFor({ timeout: 20000 });
  await input.fill(DEFAULT_SHARE_PASSCODE);
  await page.keyboard.press('Enter');
  await expect(page.getByText(NAMES[0], { exact: false }).first()).toBeVisible({ timeout: 30000 });
  expect(fatal, `화면을 죽이는 오류: ${fatal.join(' / ')}`).toEqual([]);
});

test('⑥ 비밀번호를 안 정한 지도도 아무 번호로나 열리지는 않는다', async ({ page }) => {
  await page.goto(`${BASE}/?r=${SHARE_NOSEC}&d=${DRIVER}`, { waitUntil: 'domcontentloaded' });
  const input = page.locator('input[inputmode="numeric"], input[type="password"], input[type="tel"]').first();
  await input.waitFor({ timeout: 20000 });
  await input.fill('999999');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);
  await expect(page.getByText(NAMES[0], { exact: false })).toHaveCount(0);
});
