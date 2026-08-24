// 클라이언트 번들에 시크릿이 실리는 경로를 원천 차단 — 2026-08-24 정밀점검
//   node --test scripts/client-secret-guard.test.mjs
//
//   왜: 카카오 REST 키는 **도메인 제한이 불가능**하다. 번들에 한 번 실리면 페이지 소스만 봐도 누구나 가져다 쓰고,
//   쿼터가 소진되면 배송 당일 좌표매칭이 통째로 멈춘다(G-5). 값이 실렸는지는 빌드해 봐야 알지만,
//   **실릴 수 있는 문법**은 소스에서 지금 막을 수 있다.
//   `import.meta.env.VITE_*` 는 Vite 가 빌드 때 그 자리에 값을 박아 넣는다 — 클라 도달 모듈에서는 금지.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
// 클라이언트가 import 할 수 있는 범위 — services/ 도 재수출 스텁을 통해 번들에 들어온다.
const SCAN = ['src', 'services/address-service/src'];
const SECRET_ENV = /import\.meta\.env\.VITE_[A-Z_]*(?:REST_KEY|SECRET|PRIVATE|SERVICE_ACCOUNT)/;

const walk = async (dir, out = []) => {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') await walk(full, out); }
    else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
};

describe('클라이언트 시크릿 차단 — 번들에 실릴 수 있는 문법을 금지한다', () => {
  test('클라 도달 모듈은 import.meta.env 로 REST 키·시크릿을 읽지 않는다', async () => {
    const hits = [];
    for (const base of SCAN) {
      for (const f of await walk(path.join(ROOT, base))) {
        const src = await readFile(f, 'utf8');
        src.split('\n').forEach((line, i) => {
          if (SECRET_ENV.test(line) && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')) {
            hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
          }
        });
      }
    }
    assert.deepEqual(hits, [], `번들에 시크릿이 박히는 경로가 생겼다(G-5):\n  ${hits.join('\n  ')}`);
  });
});
