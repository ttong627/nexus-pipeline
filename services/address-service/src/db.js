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
  }
  return pool;
};

export const query = async (text, values = []) => getPool().query(text, values);

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
