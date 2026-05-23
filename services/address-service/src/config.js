const csv = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const schema = process.env.ADDRESS_DB_SCHEMA || 'nexus_address';

if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
  throw new Error('ADDRESS_DB_SCHEMA 는 SQL 식별자만 허용합니다.');
}

export const config = {
  port: Number.parseInt(process.env.PORT || '8080', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  dbSchema: schema,
  activeVersion: process.env.ADDRESS_DB_VERSION || '202604',
  referenceDate: process.env.ADDRESS_REFERENCE_DATE || '2026-04-30',
  storageBucket: process.env.ADDRESS_SOURCE_BUCKET || '',
  storagePrefix: process.env.ADDRESS_SOURCE_PREFIX || 'address-source/202604',
  sourceEncoding: process.env.ADDRESS_SOURCE_ENCODING || 'cp949',
  allowedOrigins: csv(process.env.ADDRESS_ALLOWED_ORIGINS || '*'),
  jusoApiKeys: csv(process.env.JUSO_API_KEYS),
  kakaoRestKey: process.env.KAKAO_REST_KEY || '',
  importBatchSize: Number.parseInt(process.env.ADDRESS_IMPORT_BATCH_SIZE || '1000', 10),
};

export const requireConfig = (...keys) => {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) throw new Error(`필수 환경변수가 없습니다: ${missing.join(', ')}`);
};
