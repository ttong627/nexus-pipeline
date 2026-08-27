// 동별 기사 배정 저장 E2E — 형 실측 사고 재발방지. 2026-08-27
//
//   형 증상: "동별 기사가 배정이 된 내역을 저장하고 다음달에도 계속 반영되도록 해줘 · 지금은 저장 버튼이 없네"
//            "다음을 눌러도 저장이 안돼 내가 몇번을 다음 눌렀는데 아직도 저장이 안돼고 있어"
//   실제로 배정한 3개 동 중 2개가 **저장되기 전에 화면에서 사라지고** 1개만 저장됐다.
//   원인: 행정동 로드 effect 의 의존성이 `Set` 객체(orgDongs·selectedOrgDongs)라 내용이 같아도
//         매번 새 객체 → 수시로 다시 돌았고, 그 첫 줄의 `setDongDriverMap({})` 가
//         **방금 손으로 한 배정을 지우고** DB 의 옛 내용으로 되돌렸다.
//   → 화면을 안 그리는 단위 테스트로는 절대 못 잡는다(G-12). 실제 브라우저로 배정→저장→재확인한다.
//
//   ★형의 실제 데이터는 절대 건드리지 않는다 — 테스트 전용 지자체·소속사를 만들고 끝나면 지운다.
import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { APP_VERSION } from '../src/version.js';

const BASE = (process.env.E2E_BASE || 'https://logis-op.web.app').replace(/\/+$/, '');
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const E = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
const API_KEY = E('VITE_FIREBASE_API_KEY');
const UID = 'e2e_assign_manager';
const CITY = '테스트특별시 검증구';          // ★실제 지자체가 아니다(격리)
const MONTH = '9999-02';
const ORG_NAME = 'E2E 검증조합';
const ORG_ID = 'org_e2e_verify';
const DONGS = ['가검증동', '나검증동', '다검증동'];
const DRIVER = 'E2E배정기사';
let session = null;

const db = () => admin.firestore();
const monthRef = () => db().collection('cloud_lists').doc(CITY).collection('months').doc(MONTH);
const presetRef = () => db().collection('driver_assignments').doc(CITY).collection('orgs').doc(ORG_NAME);

/** 테스트가 만든 것을 남김없이 지운다 — 시작 전에도 부른다(지난 실행이 중간에 죽었을 수 있다) */
const cleanupAll = async () => {
  await db().recursiveDelete(db().collection('cloud_lists').doc(CITY)).catch(() => {});
  await db().recursiveDelete(db().collection('driver_assignments').doc(CITY)).catch(() => {});
  await db().recursiveDelete(db().collection('org_drivers').doc(ORG_NAME)).catch(() => {});
  await db().recursiveDelete(db().collection('route_sessions').doc(CITY)).catch(() => {});
  await db().recursiveDelete(db().collection('route_assignments').doc(CITY)).catch(() => {});
  await db().collection('org_presets').doc(CITY).delete().catch(() => {});
  await admin.auth().deleteUser(UID).catch(() => {});
  await db().collection('users').doc(UID).delete().catch(() => {});
};

test.beforeAll(async () => {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
  }
  // ★실제 지자체에는 절대 쓰지 않는다(2026-08-27 점검 — 옛 버전이 동대문구에 9999-02 를 남겼다)
  const real = (await db().collection('cloud_lists').listDocuments()).map((d) => d.id);
  expect(real, `테스트 지자체명이 실제 지자체와 겹친다: ${CITY}`).not.toContain(CITY);
  await cleanupAll();   // 지난 실행 잔류물 제거
  try { await admin.auth().getUser(UID); } catch { await admin.auth().createUser({ uid: UID, email: 'e2e-assign@example.com', displayName: 'E2E 배정담당자' }); }
  await db().collection('users').doc(UID).set({
    email: 'e2e-assign@example.com', name: 'E2E 배정담당자', role: 'user', tier: 'sapphire',
    citiesApproved: [CITY], _test: true, profileCompleted: true, region: CITY,
    orgId: ORG_NAME,   // ★형과 같은 조건 — 소속사가 정해져 있어 '자동선택'이 뒤늦게 도착한다
  }, { merge: true });
  // 테스트 전용 소속사(담당 행정동 3개) — 형의 실제 소속사와 같은 구조
  await db().collection('org_presets').doc(CITY).set({ orgs: [{ id: ORG_ID, name: ORG_NAME, dongs: DONGS }], _test: true });
  // 테스트 전용 기사 명부 1명
  await db().collection('org_drivers').doc(ORG_NAME).collection('drivers').doc('e2e_drv_1')
    .set({ name: DRIVER, phone: '010-0000-0001', status: 'active', _test: true });
  await monthRef().set({
    city: CITY, monthId: MONTH, totalCount: DONGS.length * 2, uploadedBy: UID,
    uploadedAt: admin.firestore.FieldValue.serverTimestamp(), _test: true,
  });
  const batch = db().batch();
  DONGS.forEach((dong, di) => {
    for (let i = 0; i < 2; i++) {
      batch.set(monthRef().collection('records').doc(`r_${di}_${i}`), {
        이름: `검증${di}${i}E2E`, 주소: `${CITY} 검증로 ${70 + di * 2 + i}`,
        포수: 1, 행정동: dong, lat: 37.579 + di * 0.001, lng: 127.049 + i * 0.001, _test: true,
      });
    }
  });
  await batch.commit();
  // ★형과 같은 조건: 이미 저장된 배정이 1개 동만 있다(예전 저장분)
  await seedPreset();

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
  await cleanupAll();
});

const seedPreset = async () => {
  await presetRef().set({
    city: CITY, orgId: ORG_ID, orgName: ORG_NAME,
    drivers: [{ id: 'e2e_drv_1', name: DRIVER, phone: '010-0000-0001', capacity: 100, color: '#60a5fa' }],
    dongDriverMap: { [DONGS[0]]: ['e2e_drv_1'] },
    baseDailyQty: 40, savedAt: admin.firestore.FieldValue.serverTimestamp(), _test: true,
  });
};

// 테스트끼리 저장분이 섞이지 않게 매번 같은 출발점으로 되돌린다
test.beforeEach(async () => { if (admin.apps.length) await seedPreset(); });

const signIn = async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ apiKey, uid, idToken, refreshToken, expiresIn, appVersion }) => {
    try {
      localStorage.setItem('nexus_whatsnew_seen_v1', appVersion);
      localStorage.setItem('nexus_last_tier_v1', 'sapphire');
      localStorage.setItem('nexus_welcome_tour_v2', '1');
    } catch { /* 프라이빗 모드 */ }
    const user = {
      uid, email: 'e2e-assign@example.com', emailVerified: true, displayName: 'E2E 배정담당자',
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
  await expect(page.getByText('E2E 배정담당자', { exact: false }).first()).toBeVisible({ timeout: 30000 });
  for (let i = 0; i < 6; i++) {
    const overlay = page.locator('div.fixed.inset-0').filter({ has: page.locator('button') });
    if (!(await overlay.count())) break;
    const btn = page.getByRole('button', { name: /시스템 가동 시작|시작하기|닫기|확인|나중에|건너뛰기|바로 시작/ }).first();
    if (await btn.count() && await btn.isVisible().catch(() => false)) await btn.click({ timeout: 5000 }).catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1000);
  }
};

/** 기사 배정 · 루트맵 → 지자체·월 → 소속사 → 2단계(기사·행정동 배정) */
const openStep2 = async (page) => {
  await page.getByRole('button', { name: /기사 배정/ }).first().click({ timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: new RegExp(MONTH) }).first().click({ timeout: 20000 });
  await page.waitForTimeout(3000);
  // 형과 같은 조건이면 소속사는 자동선택된다 — 화면이 뜨면 눌러 주고, 이미 지나갔으면 그대로 진행
  const orgBtn = page.getByRole('button', { name: new RegExp(ORG_NAME) }).first();
  if (await orgBtn.count() && await orgBtn.isVisible().catch(() => false)) {
    await orgBtn.click({ timeout: 20000 }).catch(() => {});
  }
  await expect(page.getByText('행정동 배정', { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);
};

const dongCard = (page, dong) => page.locator(`[data-testid="dong-card"][data-dong="${dong}"]`);

/** 기사 카드를 활성화한다 — 카드 가운데는 입력칸·슬라이더라 모서리를 눌러야 한다 */
const activateDriver = async (page) => {
  const card = page.locator('[data-testid="driver-card"]').first();
  await card.waitFor({ timeout: 20000 });
  // 이름이 빈 기사는 배정 대상이 아니다 — 이름을 넣어야 배정이 유효해진다
  if (!(await card.getAttribute('data-driver-name'))) {
    await card.getByRole('textbox', { name: '이름' }).fill(DRIVER);
    await page.waitForTimeout(600);
  }
  await card.click({ timeout: 15000, position: { x: 4, y: 4 } });
  // 활성화되면 동 카드가 클릭 가능해진다(tabIndex 0)
  await expect(page.locator('[data-testid="dong-card"]').first(), '기사 카드가 활성화되지 않았다')
    .toHaveAttribute('tabindex', '0', { timeout: 10000 });
};

test('동별 배정 여러 개가 저장까지 살아남는다 (형 실측 사고 재현·검증)', async ({ page }) => {
  test.slow();
  const fatal = [];
  page.on('pageerror', (e) => fatal.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signIn(page);
  await openStep2(page);

  // 기사 카드 클릭 → 활성화
  await activateDriver(page);

  // 동 2개를 배정한다 (형의 화면에서 사라지던 자리)
  for (const dong of [DONGS[1], DONGS[2]]) {
    const card = dongCard(page, dong);
    await card.waitFor({ timeout: 20000 });
    await card.click({ timeout: 15000 });
    await expect(card, `${dong} 배정이 클릭 직후 사라졌다`).toHaveAttribute('data-assigned', '1', { timeout: 10000 });
  }

  // ★잠시 기다려도 유지돼야 한다 — 예전엔 화면이 스스로 다시 읽으며 배정을 지웠다
  await page.waitForTimeout(6000);
  for (const dong of [DONGS[1], DONGS[2]]) {
    await expect(dongCard(page, dong), `${dong} 배정이 저장 전에 사라졌다`).toHaveAttribute('data-assigned', '1');
  }

  // 전체 저장
  await page.getByRole('button', { name: /전체 저장/ }).first().click({ timeout: 15000 });
  await expect(page.getByText(/저장됨/).first()).toBeVisible({ timeout: 30000 });

  // 저장된 내용을 DB 에서 직접 확인한다(화면 문구가 아니라 실제 저장분)
  await expect.poll(async () => {
    const snap = await presetRef().get();
    return Object.keys(snap.data()?.dongDriverMap || {}).sort().join(',');
  }, { timeout: 30000, message: '저장된 동이 배정한 것과 다르다' }).toBe([...DONGS].sort().join(','));

  expect(fatal, '화면을 죽이는 오류: ' + fatal.join(' / ')).toEqual([]);
});

test('저장하면 기사 선택이 풀린다 (형 지시 — 바로 다음 기사 배정으로)', async ({ page }) => {
  test.slow();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signIn(page);
  await openStep2(page);
  await activateDriver(page);
  const card = dongCard(page, DONGS[1]);
  await card.waitFor({ timeout: 20000 });
  await card.click({ timeout: 15000 });
  await expect(card).toHaveAttribute('data-assigned', '1', { timeout: 10000 });
  // 동 카드의 [저장] 을 누른다
  await card.getByRole('button', { name: /^저장$/ }).click({ timeout: 15000 });
  await expect(page.getByText(/저장됨/).first()).toBeVisible({ timeout: 30000 });
  // 기사 선택이 풀리면 동 카드는 다시 '클릭 불가'(tabIndex -1) 상태가 된다
  await expect(card, '저장 후에도 기사 선택이 그대로다').toHaveAttribute('tabindex', '-1', { timeout: 15000 });
});

test('다시 열어도 배정이 그대로다 — 다음 달 명단에도 이 배정이 적용된다', async ({ page }) => {
  test.slow();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signIn(page);
  await openStep2(page);
  await activateDriver(page);
  const target = dongCard(page, DONGS[1]);
  await target.waitFor({ timeout: 20000 });
  await target.click({ timeout: 15000 });
  await expect(target).toHaveAttribute('data-assigned', '1', { timeout: 10000 });
  await page.getByRole('button', { name: /전체 저장/ }).first().click({ timeout: 15000 });
  await expect(page.getByText(/저장됨/).first()).toBeVisible({ timeout: 30000 });
  // 저장 자체는 됐는지 먼저 확인(여기서 갈리면 저장 문제, 아래에서 갈리면 다시 읽기 문제)
  await expect.poll(async () => {
    const snap = await presetRef().get();
    return Object.keys(snap.data()?.dongDriverMap || {}).sort().join(',');
  }, { timeout: 30000, message: '저장이 안 됐다' }).toBe([DONGS[0], DONGS[1]].sort().join(','));

  // 화면을 완전히 새로 열어도 그대로여야 한다(다음 달 명단도 같은 저장분을 읽는다)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await openStep2(page);
  for (const dong of [DONGS[0], DONGS[1]]) {
    const card = dongCard(page, dong);
    await card.waitFor({ timeout: 20000 });
    await expect(card, `${dong} 배정이 사라졌다`).toHaveAttribute('data-assigned', '1', { timeout: 20000 });
  }
});

// ── 저장이 '배정 안 한 동'의 기사 칸을 지우지 않는다 (2026-08-27 점검 · 긴급 1) ──────────
//   예전엔 저장할 때마다 스코프 전체 레코드를 `기사: ''` 로 덮어썼다. 동 카드마다 [저장]을 누르는
//   흐름에서는 답십리1동만 배정하고 저장하면 전농1동·휘경1동 1,140건의 기사 칸이 지워졌다(G-4·M-1 위반).
test('저장해도 다른 동의 기사 칸은 그대로다 (긴급 1 재발방지)', async ({ page }) => {
  test.slow();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.setViewportSize({ width: 1920, height: 1080 });

  // 다른 동(DONGS[1])의 레코드에 기사 이름을 미리 넣어 둔다 — 이게 지워지면 안 된다
  const KEEP = '보존확인기사';
  const others = await monthRef().collection('records').where('행정동', '==', DONGS[1]).get();
  const pre = db().batch();
  others.docs.forEach((d) => pre.update(d.ref, { 기사: KEEP }));
  await pre.commit();
  expect(others.size, '대조할 레코드가 없다').toBeGreaterThan(0);

  await signIn(page);
  await openStep2(page);
  await activateDriver(page);
  // DONGS[1] 은 건드리지 않고 DONGS[2] 만 배정해 저장한다
  const card = dongCard(page, DONGS[2]);
  await card.waitFor({ timeout: 20000 });
  await card.click({ timeout: 15000 });
  await expect(card).toHaveAttribute('data-assigned', '1', { timeout: 10000 });
  await page.getByRole('button', { name: /전체 저장/ }).first().click({ timeout: 15000 });
  await expect(page.getByText(/저장됨/).first()).toBeVisible({ timeout: 30000 });

  // 저장이 끝난 뒤에도 다른 동의 기사 칸이 살아 있어야 한다
  await page.waitForTimeout(3000);
  const after = await monthRef().collection('records').where('행정동', '==', DONGS[1]).get();
  const wiped = after.docs.filter((d) => String(d.data().기사 || '').trim() !== KEEP);
  expect(wiped.length, `배정하지 않은 ${DONGS[1]} 의 기사 칸이 ${wiped.length}건 지워졌다`).toBe(0);
});
