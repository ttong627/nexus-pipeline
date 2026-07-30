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
export const query = async (text, values = []) => {
  const t0 = Date.now();
  const client = await getPool().connect();
  const tConn = Date.now();                       // 커넥션 획득 완료 시각
  let tPath = tConn;
  try {
    await client.query(`SET search_path TO ${config.dbSchema}, public`);
    tPath = Date.now();                           // SET search_path 완료 시각
    return await client.query(text, values);
  } finally {
    const tEnd = Date.now();
    client.release();
    const total = tEnd - t0;
    // 병목 위치를 분리 계측: connect(풀·커넥터) vs searchpath vs query(실행+전송).
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
