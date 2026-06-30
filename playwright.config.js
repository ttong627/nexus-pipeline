import { defineConfig } from '@playwright/test';

// 정제 스모크 — 빌드된 앱(vite preview)이 치명 오류 없이 뜨는지 배포 전 1회 검증.
// "빌드는 통과했는데 런타임에 죽는"(예: V6.79.3 lucide Map shadow) 회귀를 포착한다.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    timeout: 60000,
    reuseExistingServer: true,
  },
});
