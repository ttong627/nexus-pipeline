import pg from 'pg';
import { config, requireConfig } from './config.js';

let pool;

export const getPool = () => {
  requireConfig('databaseUrl');
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: Number.parseInt(process.env.PGPOOL_MAX || '8', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.PGSSL === 'disable' ? false : undefined,
    });
    pool.on('error', (err) => console.error('[pg-pool] idle client error:', err.message));
  }
  return pool;
};

// search_path를 매 쿼리 전 같은 클라이언트에 명시적으로 건다. pg_trgm GIN 인덱스가
// nexus_address 스키마에 있어 search_path 미설정 시 인덱스를 못 타는 경로가 있었다(2026-07-11).
//
// ★statement_timeout도 여기서 건다(2026-08-01). 이 함수는 **API 경로 전용**이다
//   (server.js만 사용 · import-job은 withClient만 사용) → 대량 적재·CREATE INDEX·ANALYZE는
//   영향받지 않는다. 아래 withClient에는 절대 넣지 말 것 — 적재가 중간에 끊긴다.
//   왜 필요한가: 퍼지·건물명 트리그램이 60~76초 돌며 커넥션을 붙잡는 사례를 실측했고,
//   클라는 3초에 abort하므로 그 시간은 **아무도 기다리지 않는 순수 낭비**이면서
//   다른 요청을 500(pool connect timeout)으로 만든다.
// options.timeoutMs — 이 쿼리에만 다른 상한을 건다.
//   ★폴백(퍼지·건물명)은 **클라가 3초에 abort** 하므로 15초까지 붙잡는 건 순수 낭비다.
//     실측(2026-08-05): buildingMatch 가 상한 15초를 다 쓰고 미매칭 처리됐다
//     (`[slow-query] query=15008ms`). 그동안 커넥션을 점유해 다른 요청을 위험하게 만든다.
export const query = async (text, values = [], options = {}) => {
  const t0 = Date.now();
  const client = await getPool().connect();
  const tConn = Date.now();                       // 커넥션 획득 완료 시각
  let tPath = tConn;
  try {
    await client.query(`SET search_path TO ${config.dbSchema}, public`);
    const limitMs = Number(options.timeoutMs ?? config.statementTimeoutMs);
    if (limitMs > 0) {
      await client.query(`SET statement_timeout = ${limitMs}`);
    }
    tPath = Date.now();                           // SET search_path 완료 시각
    return await client.query(text, values);
  } finally {
    const tEnd = Date.now();
    const total = tEnd - t0;
    client.release();
    // 병목 위치 분리 계측: connect(풀·커넥터) vs searchpath vs query(실행+전송). 관측성 유지.
    if (total > 3000) {
      console.log(`[slow-query] total=${total}ms connect=${tConn - t0}ms searchpath=${tPath - tConn}ms query=${tEnd - tPath}ms :: ${text.replace(/\s+/g, ' ').trim().slice(0, 80)}`);
    }
  }
};

export const withClient = async (work) => {
  const client = await getPool().connect();
  try {
    await client.query(`SET search_path TO ${config.dbSchema}, public`);
    return await work(client);
  } finally {
    client.release();
  }
};

export const closePool = async () => {
  if (pool) await pool.end();
  pool = null;
};
