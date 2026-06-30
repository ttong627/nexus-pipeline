import { test, expect } from '@playwright/test';

// 스모크: 빌드된 앱이 JS 크래시 없이 셸을 렌더하는지 검증한다.
// 이번 사고(lucide Map shadow → "is not a constructor" → 정제 중단)처럼
// "빌드는 됐는데 런타임에 죽는" 회귀를 배포 전에 잡는 것이 목적이다.
test('앱 셸이 치명 오류 없이 로드된다', async ({ page }) => {
  /** @type {string[]} */
  const fatal = [];
  page.on('pageerror', (e) => fatal.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    // 런타임 크래시 신호만 치명으로 본다(네트워크/firebase 경고는 무시).
    if (/is not a constructor|TypeError|ReferenceError|주소정제 중 오류/.test(t)) {
      fatal.push(`console: ${t}`);
    }
  });

  await page.goto('/');
  await expect(page.locator('#root')).toBeVisible();

  // 흰 화면/크래시가 아니라 실제 UI가 렌더됐는지(셸 내용 존재).
  await expect
    .poll(async () => (await page.locator('#root').innerHTML()).length, { timeout: 10000 })
    .toBeGreaterThan(100);

  expect(fatal, `치명 런타임 오류:\n${fatal.join('\n')}`).toEqual([]);
});
