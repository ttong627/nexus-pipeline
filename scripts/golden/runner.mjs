// 골든 회귀 — 케이스 실행기 (P7 Phase2 선행). 녹화 스크립트와 테스트가 공용으로 쓴다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { loadClientModule, PROJECT_ROOT } from './engineLoader.mjs';
import { installCassette, saveCassette } from './cassette.mjs';

// 카세트 키에서 배포 URL을 토큰으로 치환한다(저장소에 인프라 주소 미노출 + 환경 변경에 불변).
const cassetteAliases = () => {
  const env = loadEnv('', PROJECT_ROOT, 'VITE_');
  const base = String(env.VITE_ADDRESS_MATCH_API_URL || '').replace(/\/+$/, '');
  return base ? [[base, '{ADDRESS_API}']] : [];
};

export const GOLDEN_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
export const CASES_PATH = path.join(GOLDEN_DIR, 'cases.json');
export const CASSETTE_PATH = path.join(GOLDEN_DIR, 'cassette.json');
// record·replay는 같은 스냅샷을 본다(녹화한 것을 재생해 검증하는 구조).
export const goldenPath = (mode) => path.join(GOLDEN_DIR, `golden-${mode === 'offline' ? 'offline' : 'api'}.json`);

// 좌표는 규격화(purify) 대상이 아니라 지오코딩이다. Phase2 이관 범위 밖이고
// 호출만 늘리므로 골든에서는 끈다(includeCoords:false).
const PROCESS_OPTIONS = { includeCoords: false };

export const loadCases = () => JSON.parse(fs.readFileSync(CASES_PATH, 'utf8')).cases;

export const selectCases = (cases, mode) =>
  (mode === 'offline' ? cases.filter((c) => c.tags.includes('offline')) : cases);

/** 결정적으로 비교 가능한 필드만 정렬해 담는다(입력 에코 제외). 서버 파리티도 이 함수를 쓴다. */
export const snapshot = (result) => {
  const out = {};
  for (const key of Object.keys(result).sort()) {
    if (key === '원주소' || key === '_learnBaseline') continue;
    const value = result[key];
    if (typeof value === 'function' || value === undefined) continue;
    out[key] = value;
  }
  return out;
};

/**
 * @param {'offline'|'replay'|'record'} mode
 * @returns {Promise<{ snapshots: object, misses: string[], cases: object[] }>}
 */
export const runCases = async (mode = 'offline') => {
  const cases = selectCases(loadCases(), mode);
  const { mod, close } = await loadClientModule('/src/engine/addressEngine.js');
  const cassette = installCassette({ mode, cassettePath: CASSETTE_PATH, aliases: cassetteAliases() });
  const snapshots = {};

  try {
    // ★순차 실행 — 주소 API 동시성 3 이하 규칙(2026-07-30 커넥션 풀 경합 장애) 준수.
    //   골든은 결정성이 목적이라 병렬로 얻을 이득도 없다.
    for (const testCase of cases) {
      const { addr = '', name = '', adminDong = '', cityLabel = '', note = '' } = testCase.input;
      try {
        const result = await mod.processAddress(addr, name, adminDong, cityLabel, note, PROCESS_OPTIONS);
        snapshots[testCase.id] = snapshot(result);
      } catch (error) {
        snapshots[testCase.id] = { _error: String(error?.message || error) };
      }
    }
    if (mode === 'record') saveCassette(CASSETTE_PATH, cassette.entries);
  } finally {
    cassette.restore();
    await close();
  }

  return { snapshots, misses: cassette.misses, cases };
};

export const readGolden = (mode) => {
  const file = goldenPath(mode);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

export const writeGolden = (mode, snapshots) => {
  fs.writeFileSync(goldenPath(mode), `${JSON.stringify(snapshots, null, 2)}\n`, 'utf8');
};

export { PROJECT_ROOT };
