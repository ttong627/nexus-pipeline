// DB 접근 계층 안전장치 검증 — node --test scripts/db-guard.test.mjs
//
//   2026-08-01 실측: 퍼지·건물명 트리그램 쿼리가 **60~76초** 돌면서 커넥션을 붙잡았다.
//   클라는 3초에 abort하므로 그 시간은 아무도 기다리지 않는 낭비이면서, 그 사이 다른 요청은
//   pool connect timeout으로 500이 났다(운영 /v1/address/match 장애).
//
//   → API 경로(`db.js query()`)에만 statement_timeout을 건다.
//     import-job은 `withClient`만 쓰므로 대량 적재·CREATE INDEX·ANALYZE는 영향받지 않는다.
//     **이 분리가 깨지면 적재가 중간에 끊긴다** — 그래서 소스 수준으로 잠근다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const db = read('../services/address-service/src/db.js');
const server = read('../services/address-service/src/server.js');
const importJob = read('../services/address-service/src/import-job.js');

// db.js를 query() / withClient() 두 구간으로 자른다.
const queryBody = db.slice(db.indexOf('export const query'), db.indexOf('export const withClient'));
const withClientBody = db.slice(db.indexOf('export const withClient'), db.indexOf('export const closePool'));

test('API 경로(query)는 statement_timeout을 건다', () => {
  assert.match(queryBody, /SET statement_timeout/, '⚠️ API 쿼리에 상한이 없다 — 60초짜리 쿼리가 커넥션을 붙잡는다');
  assert.match(queryBody, /config\.statementTimeoutMs/, '상한 값은 config에서 온다(환경변수로 조정 가능해야 함)');
});

test('★적재 경로(withClient)에는 statement_timeout을 걸지 않는다', () => {
  assert.doesNotMatch(withClientBody, /SET statement_timeout/,
    '⚠️ withClient에 상한이 붙었다 — import-job의 대량 INSERT·CREATE INDEX·ANALYZE가 중간에 끊긴다');
});

test('경로 분리 전제가 유지된다 — server는 query만, import-job은 withClient만', () => {
  assert.match(server, /import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s*'\.\/db\.js'/, 'server.js가 query를 쓰지 않는다');
  assert.doesNotMatch(server, /import\s*\{[^}]*withClient[^}]*\}\s*from\s*'\.\/db\.js'/,
    '⚠️ server.js가 withClient를 쓰기 시작했다 — 그 경로엔 상한이 없다. 전제 재검토 필요');
  assert.doesNotMatch(importJob, /import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s*'\.\/db\.js'/,
    '⚠️ import-job이 query를 쓰기 시작했다 — 상한에 걸려 적재가 끊긴다');
});

test('느린 폴백(퍼지·건물명)은 상한 초과 시 500이 아니라 미매칭으로 돌려준다', () => {
  assert.match(server, /const nullOnQueryTimeout/, '상한 초과 처리기가 없다');
  assert.match(server, /'57014'/, 'Postgres query_canceled(57014) 코드로 판별해야 한다');
  for (const fn of ['fuzzyMatch', 'buildingMatch']) {
    const re = new RegExp(`const ${fn} = async \\([^)]*\\) => nullOnQueryTimeout\\('${fn}'`);
    assert.match(server, re, `⚠️ ${fn}이 상한 초과를 미매칭으로 처리하지 않는다 — 폴백 실패가 500으로 둔갑한다`);
  }
  // exact 매칭은 감싸지 않는다 — 7~14ms짜리가 상한에 걸리면 진짜 이상 신호다.
  assert.doesNotMatch(server, /const exactRoadMatch = async \([^)]*\) => nullOnQueryTimeout/,
    'exact 매칭까지 감싸면 진짜 DB 이상을 미매칭으로 덮어버린다');
});
