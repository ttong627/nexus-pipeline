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
  vworldKey: process.env.VWORLD_KEY || '',
  importBatchSize: Number.parseInt(process.env.ADDRESS_IMPORT_BATCH_SIZE || '1000', 10),
  // P7 Phase2 ⓐ: 학습사전(Firestore) 로더. ADC를 쓰므로 키파일은 없다 —
  // 프로젝트는 보통 런타임이 알려주지만(GOOGLE_CLOUD_PROJECT), 명시 지정도 허용한다.
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
  dictTtlMs: Number.parseInt(process.env.ADDRESS_DICT_TTL_MS || '300000', 10),   // 5분
  // 정제(purify) 배치 동시성. ★purify는 운영 `/v1/address/match`와 **커넥션 풀을 공유**한다.
  // 2026-08-01 실측: 동시성 3으로 배치를 돌리자 match가 10초 뒤 500(풀 고갈)을 뱉었다.
  // 정제는 느려도 되지만 운영 매칭은 느려지면 안 된다 → 기본값 2 + 인스턴스당 배치 직렬화(purify.js).
  purifyConcurrency: Number.parseInt(process.env.ADDRESS_PURIFY_CONCURRENCY || '2', 10),
  purifyMaxRecords: Number.parseInt(process.env.ADDRESS_PURIFY_MAX_RECORDS || '500', 10),
};

export const requireConfig = (...keys) => {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) throw new Error(`필수 환경변수가 없습니다: ${missing.join(', ')}`);
};
