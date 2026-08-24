// 담당자 화면 크래시 그물 E2E — 로그인 상태를 만들어 **주요 메뉴를 전부 열어 본다**. 2026-08-24
//
//   왜: 지도는 담당자 전용이라 로그인 없이는 못 연다. 그래서 지금까지 자동 검증이 하나도 없었고,
//   기사 화면이 08-13~08-24 동안 흰 화면이었던 것도 이런 그물이 없어서 아무도 몰랐다.
//   Google 로그인은 자동화할 수 없으므로 **커스텀 토큰으로 세션을 만들어** 넣는다(테스트 전용 계정, 끝나면 삭제).
import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { APP_VERSION } from '../src/version.js';

const BASE = (process.env.E2E_BASE || 'https://logis-op.web.app').replace(/\/+$/, '');
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const E = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
const API_KEY = E('VITE_FIREBASE_API_KEY');
const UID = 'e2e_test_manager';
const CITY = '서울특별시 동대문구';
const MONTH = '9999-01';
const PEOPLE = [['홍길동E2E', 37.5794, 127.0499], ['김철수E2E', 37.5804, 127.0509], ['이영희E2E', 37.5814, 127.0519]];
let session = null;

const db = () => admin.firestore();
const monthRef = () => db().collection('cloud_lists').doc(CITY).collection('months').doc(MONTH);

test.beforeAll(async () => {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
  }
  try { await admin.auth().getUser(UID); } catch { await admin.auth().createUser({ uid: UID, email: 'e2e-test@example.com', displayName: 'E2E 테스트담당자' }); }
  await db().collection('users').doc(UID).set({
    email: 'e2e-test@example.com', name: 'E2E 테스트담당자', role: 'user', tier: 'sapphire',
    citiesApproved: [CITY], _test: true,
    // ★없으면 프로필 설정 화면이 z-999 로 전체를 덮어 사이드바 클릭이 전부 막힌다(실측).
    profileCompleted: true, region: CITY,
  }, { merge: true });
  await monthRef().set({ city: CITY, monthId: MONTH, totalCount: PEOPLE.length, uploadedBy: UID, uploadedAt: admin.firestore.FieldValue.serverTimestamp(), _test: true });
  const batch = db().batch();
  PEOPLE.forEach(([name, lat, lng], i) => {
    batch.set(monthRef().collection('records').doc(`r${i + 1}`), {
      이름: name, 주소: `서울특별시 동대문구 왕산로 ${70 + i * 2}`, 포수: i + 1,
      행정동: '전농동', lat, lng, 배송순번: String(i + 1), _test: true,
    });
  });
  await batch.commit();
  const custom = await admin.auth().createCustomToken(UID);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  session = await res.json();
  expect(session.idToken, '테스트 세션을 만들지 못했다').toBeTruthy();
});

test.afterAll(async () => {
  if (!admin.apps.length) return;
  await db().recursiveDelete(monthRef()).catch(() => {});
  await admin.auth().deleteUser(UID).catch(() => {});
  await db().collection('users').doc(UID).delete().catch(() => {});
});

// 로그인 세션을 브라우저에 심는다(Firebase JS SDK 가 읽는 IndexedDB 자리에 그대로).
const signIn = async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ apiKey, uid, idToken, refreshToken, expiresIn, appVersion }) => {
    // ★첫 접속용 안내창들을 미리 꺼 둔다 — 켜져 있으면 전체 화면을 덮어 사이드바 클릭이 전부 막힌다(실측).
    try {
      localStorage.setItem('nexus_whatsnew_seen_v1', appVersion);  // 새 버전 변경내역 팝업(현재 버전과 같아야 안 뜬다)
      localStorage.setItem('nexus_last_tier_v1', 'sapphire');     // 등급 변경 인트로
      localStorage.setItem('nexus_welcome_tour_v2', '1');        // 첫 진입 가이드 투어
    } catch { /* 사파리 프라이빗 등 */ }
    const user = {
      uid, email: 'e2e-test@example.com', emailVerified: true, displayName: 'E2E 테스트담당자',
      isAnonymous: false, providerData: [], apiKey, appName: '[DEFAULT]',
      stsTokenManager: { refreshToken, accessToken: idToken, expirationTime: Date.now() + Number(expiresIn) * 1000 },
      createdAt: String(Date.now()), lastLoginAt: String(Date.now()),
    };
    await new Promise((res, rej) => {
      const rq = indexedDB.open('firebaseLocalStorageDb', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); };
      rq.onsuccess = () => {
        const tx = rq.result.transaction('firebaseLocalStorage', 'readwrite');
        tx.objectStore('firebaseLocalStorage').put({ fbase_key: `firebase:authUser:${apiKey}:[DEFAULT]`, value: user });
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      };
      rq.onerror = () => rej(rq.error);
    });
  }, { apiKey: API_KEY, uid: UID, idToken: session.idToken, refreshToken: session.refreshToken, expiresIn: session.expiresIn, appVersion: APP_VERSION });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('E2E 테스트담당자', { exact: false }).first()).toBeVisible({ timeout: 30000 });
  // ★그래도 남는 안내창이 있으면 걷어낸다(인트로·투어 등 — 전부 전체화면을 덮는다).
  for (let i = 0; i < 6; i++) {
    const overlay = page.locator('div.fixed.inset-0').filter({ has: page.locator('button') });
    if (!(await overlay.count())) break;
    const btn = page.getByRole('button', { name: /시스템 가동 시작|시작하기|닫기|확인|나중에|건너뛰기|바로 시작/ }).first();
    if (await btn.count() && await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 5000 }).catch(() => {}); }
    else { await page.keyboard.press('Escape').catch(() => {}); }
    await page.waitForTimeout(1200);
    if (await page.getByRole('button', { name: /기사 배정/ }).first().isEnabled().catch(() => false)) {
      const blocked = await page.evaluate(() => {
        const el = document.elementFromPoint(100, 400);
        return !!el && !!el.closest('div.fixed.inset-0');
      });
      if (!blocked) break;
    }
  }
};

test('담당자 로그인 → 주요 메뉴를 모두 열어도 화면이 죽지 않는다', async ({ page }) => {
  test.slow();
  const fatal = [];
  page.on('pageerror', (e) => fatal.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/ReferenceError|TypeError|is not a constructor|Cannot access|Refused to/.test(m.text())) fatal.push('console: ' + m.text());
  });
  // ★확인창은 무조건 '취소' — 자동 수락하면 로그아웃·삭제 같은 것을 눌러 버린다(실측으로 데었다).
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.setViewportSize({ width: 1920, height: 1080 });

  await signIn(page);

  // 담당자가 실제로 누르는 메뉴들 — 하나라도 렌더에서 죽으면 그 화면은 흰 화면이 된다.
  //   (기사 화면이 2026-08-13~08-24 동안 그랬다. 그때 이런 그물이 없었다.)
  const MENUS = ['이번달 배송명단', '기본명단 관리', 'DB 현황 조회', '기사 관리', '저장 내역', '부가서비스', '회원등급', '지자체 현황 대시보드'];
  const dead = [];
  for (const name of MENUS) {
    const btn = page.getByRole('button', { name, exact: false }).first();
    if (!(await btn.count())) continue;
    await btn.click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const len = (await page.locator('body').innerText()).length;
    if (len < 80) dead.push(name + ': 화면이 비었다(길이 ' + len + ')');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);
  }

  expect(dead, '열자마자 비는 화면: ' + dead.join(' / ')).toEqual([]);
  expect(fatal, '화면을 죽이는 오류: ' + fatal.join(' / ')).toEqual([]);
});
