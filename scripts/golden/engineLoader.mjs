// 골든 회귀 — 클라이언트 주소 엔진을 Node에서 로드하는 로더 (P7 Phase2 선행)
//
// 배경(핸드오프 2026-07-30): "클라 엔진이 firebase를 import해 node 단독 실행이 안 된다"고
// 기록돼 있었으나, 막힌 것은 `import.meta.env`(Vite 전용)일 뿐이다. 기존 백필 스크립트
// (backfill-ri.mjs 등)도 vite-node로 돌리고 있었다.
//
// 여기서는 **새 의존성을 추가하지 않는다**. 이미 devDependency인 `vite`의 SSR API
// (`ssrLoadModule`)로 같은 일을 한다 → vite-node 설치 불필요·버전 리스크 0·
// 프로덕션 코드 변경 0(엔진 리팩터 없이 골든 회귀 착수 가능).
//
// 주의: 이 로더는 .env를 읽어 import.meta.env를 채운다. 실제 API 키가 로드되므로
// RECORD 모드(실호출)에서만 의미가 있고, REPLAY 모드에서는 fetch가 카세트로 대체된다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

/**
 * 클라이언트 모듈을 Node(SSR)에서 로드한다.
 * @param {string} modulePath 프로젝트 루트 기준 경로 (예: '/src/engine/addressEngine.js')
 * @returns {Promise<{ mod: Record<string, unknown>, close: () => Promise<void> }>}
 */
// ★엔진의 카카오 호출은 **브라우저에선 서버 프록시**, **Node 에선 직접 호출**이다(2026-08-23 점검 · 번들에서 REST 키 제거).
//   골든 녹화·재생은 Node 경로를 타야 카세트 키(카카오 URL)가 그대로 맞는다 → .env 값을 process.env 로 올려 준다.
//   재생(replay) 모드에서는 fetch 가 카세트로 대체되므로 값의 진위는 상관없고, '있음' 자체가 경로를 정한다.
const seedNodeKakaoKey = () => {
  if (process.env.KAKAO_REST_KEY) return;
  try {
    const env = fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8');
    const v = (env.match(/^VITE_KAKAO_REST_KEY=(.*)$/m)?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
    if (v) process.env.KAKAO_REST_KEY = v;
  } catch { /* .env 가 없으면 프록시 경로로 가고, 재생 모드에서는 카세트 미스로 드러난다 */ }
};

export const loadClientModule = async (modulePath = '/src/engine/addressEngine.js') => {
  seedNodeKakaoKey();
  // configFile:false — react/tailwind/PWA 플러그인은 SSR 로드에 불필요하고
  // 부작용(서비스워커 생성 등)만 만든다. 엔진은 순수 .js라 플러그인 없이 로드된다.
  const server = await createServer({
    root: PROJECT_ROOT,
    envDir: PROJECT_ROOT,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });

  try {
    const mod = await server.ssrLoadModule(modulePath);
    return { mod, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
};
