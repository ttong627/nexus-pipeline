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

test('느린 폴백은 상한 초과 시 500이 아니라 미매칭으로 돌려준다', () => {
  assert.match(server, /const nullOnQueryTimeout/, '상한 초과 처리기가 없다');
  assert.match(server, /'57014'/, 'Postgres query_canceled(57014) 코드로 판별해야 한다');
  // ※2026-08-11 형 지시로 fuzzyMatch·buildingMatch(건물명으로 주소 찾기)는 **폐지**됐다.
  //   남은 느린 경로는 학습주소 조회뿐이므로 그것이 상한을 미매칭으로 처리하는지 본다.
  assert.match(server, /nullOnQueryTimeout\('learnedMatch'/,
    '⚠️ learnedMatch가 상한 초과를 미매칭으로 처리하지 않는다 — 폴백 실패가 500으로 둔갑한다');
  // exact 매칭은 감싸지 않는다 — 7~14ms짜리가 상한에 걸리면 진짜 이상 신호다.
  assert.doesNotMatch(server, /const exactRoadMatch = async \([^)]*\) => nullOnQueryTimeout/,
    'exact 매칭까지 감싸면 진짜 DB 이상을 미매칭으로 덮어버린다');
});

// ══════════════════════════════════════════════════════════════════
//  ★건물명으로 주소를 찾는 경로가 되살아나지 않게 못을 박는다 (형 지시 2026-08-11)
//  "건물명으로 주소 매칭한다던지하는 것은 절대 금지야.
//   해당주소로 찾고 그 주소를 규칙화 하고 정제 하는거야."
//  실측 근거: "우남아파트"로 조회 → 도당동의 **다른** 우남아파트(부천로366번길 93)가
//  나왔다. 명단의 실제 주소는 삼작로256번길 16이다. 이름이 같은 단지가 한 동네에
//  둘 있으면 무엇을 해도 구분할 수 없다 → 주소를 지어내지 말고 확인필요로 넘긴다.
// ══════════════════════════════════════════════════════════════════
test('★건물명으로 주소를 찾는 경로가 없다 — 남의 주소로 바꿔치기 금지', () => {
  assert.doesNotMatch(server, /const buildingMatch = async/,
    '⚠️ buildingMatch(건물명→주소)가 되살아났다 — 명단의 주소가 다른 건물로 바뀐다');
  assert.doesNotMatch(server, /const fuzzyMatch = async/,
    '⚠️ fuzzyMatch(부분문자열→주소)가 되살아났다 — 건물번호 없는 질의가 임의 주소로 치환된다');
  assert.match(server, /주소 치환 금지로 미매칭 처리/,
    '건물번호 없는 질의를 미매칭으로 돌려보내는 방어선이 사라졌다');
});

test('★외부(JUSO)·학습 결과가 물어본 그 주소인지 검증한다', () => {
  assert.match(server, /const sameAddressAsQuery/, '외부 결과 검증기가 없다');
  // JUSO 는 키워드 검색이라 후보가 여럿이면 하나를 조용히 고른다. 검증 없이 쓰면 치환이다.
  assert.match(server, /if \(!sameAddressAsQuery\(fallback, queryRoad\)\) continue;/,
    '⚠️ JUSO 응답을 검증 없이 채택한다 — 물어본 주소와 다른 건물이 들어온다');
  assert.match(server, /sameAddressAsQuery\(cached, queryRoad\)/,
    '⚠️ 폴백 캐시를 검증 없이 재사용한다 — 과거에 치환된 값이 그대로 나간다');
});

// ══════════════════════════════════════════════════════════════════
//  ★좌표가 월 재적재로 증발하지 않게 못을 박는다 (설계서 좌표관리_설계.md F6)
//  좌표는 몇 달에 걸쳐 쌓인다(동 좌표 실측 2,373건 · VWorld 호출 비용).
//  버전 테이블에 섞이면 매달 통째로 지워지는데, 지워진 줄도 모른다 —
//  조회는 조용히 "좌표 없음"을 돌려주고 순번은 그대로 돌아가기 때문이다.
// ══════════════════════════════════════════════════════════════════
const coordsSql = read('../services/address-service/sql/coords.sql');
const schemaSql = read('../services/address-service/sql/schema.sql');

test('★좌표 테이블은 버전독립이다 — version_id 를 갖지 않는다', () => {
  assert.doesNotMatch(coordsSql, /version_id/,
    '⚠️ 좌표 테이블에 version_id 가 생겼다 — 월 재적재 대상이 되어 매달 증발한다');
  assert.match(coordsSql, /CREATE TABLE IF NOT EXISTS building_coord/, 'building_coord 정의가 없다');
  assert.match(coordsSql, /CREATE TABLE IF NOT EXISTS building_dong_coord/, 'building_dong_coord 정의가 없다');
});

test('★좌표 테이블이 schema.sql·재적재 삭제 목록에 들어가지 않았다', () => {
  for (const t of ['building_coord', 'building_dong_coord']) {
    assert.doesNotMatch(schemaSql, new RegExp(`CREATE TABLE[^;]*\b${t}\b`),
      `⚠️ ${t} 가 schema.sql 로 옮겨졌다 — resetVersionData 사정권에 들어간다`);
  }
  const resetBody = importJob.slice(
    importJob.indexOf('const resetVersionData'),
    importJob.indexOf('const listFiles'),
  );
  assert.doesNotMatch(resetBody, /building_coord|building_dong_coord/,
    '⚠️ 좌표 테이블이 월 재적재 삭제 목록에 올랐다 — 쌓인 좌표가 매달 사라진다');
});

test('★지오코딩 결과가 입구 좌표 칸을 채우지 못한다 (F1)', () => {
  const store = read('../services/address-service/src/coords/coordStore.js');
  assert.match(store, /export const ENTRANCE_SOURCES = new Set\(\['juso_entrc', 'manual'\]\)/,
    '⚠️ 입구 좌표 허용 출처가 바뀌었다 — vworld·kakao 가 들어오면 건물 중심이 입구로 둔갑한다');
});

test('★정제 화면이 쓰는 조회 경로는 외부 API를 태우지 않는다 (F10)', () => {
  const q = read('../services/address-service/src/coords/coordQuery.js');
  assert.doesNotMatch(q, /fetch\(|geocodeRoad|matchDongCoord/,
    '⚠️ 좌표 조회 경로에 외부 API 호출이 들어왔다 — 정제 중 화면이 멈춘다(무지연 원칙)');
  // C-3 이후: fill 이 구현됐으므로 "아직 없습니다" 대신 **두 갈래가 섞이지 않음**을 잠근다.
  // 조회(cache)가 채움(fillCoords)을 타면 정제 화면이 외부 API 를 태우게 된다.
  assert.match(server, /mode === 'fill'[\s\S]{0,600}?fillCoords\(/,
    '⚠️ fill 갈래가 fillCoords 를 부르지 않는다 — 조용히 cache 로 처리되면 채워진 줄 안다(F9)');
  const cacheBranch = server.slice(server.indexOf("const coords = await resolveCoords"));
  assert.doesNotMatch(cacheBranch.slice(0, 300), /fillCoords/,
    '⚠️ 조회 갈래에 채움이 섞였다 — 정제 중 외부 API 가 돈다(F10)');
});

test('★채움은 판정을 복제하지 않는다 — 동 채택 규칙은 coordFill 하나뿐이다 (F3)', () => {
  const vworld = read('../services/address-service/src/vworld.js');
  assert.match(vworld, /acceptDongCandidate/,
    '⚠️ vworld 가 자체 동 채택 로직으로 되돌아갔다 — 오염 격리 375건의 원인이 그것이다');
  // 주석에는 "예전엔 `|| byDong[0]` 이었다"는 경위가 적혀 있다 — 코드만 본다.
  const code = vworld.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\|\|\s*byDong\[0\]/,
    '⚠️ `|| byDong[0]` 폴백이 되살아났다 — 단지명 검증 실패해도 주변 아무 건물이나 집는다');
});

test('★채움 동시성은 3을 넘지 않는다 — 배치가 운영 API 를 두 번 죽였다', () => {
  const w = read('../services/address-service/src/coords/coordWrite.js');
  assert.match(w, /Math\.min\(3,/,
    '⚠️ 좌표 채움 동시성 상한이 풀렸다 — 커넥션 풀 잠식으로 /v1/address/match 가 500 을 낸다');
});
