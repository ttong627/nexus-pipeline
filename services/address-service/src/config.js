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
  // ★API 쿼리 상한(2026-08-01 실측). 퍼지·건물명 트리그램이 **60~76초** 돌면서 커넥션을
  //   붙잡는 사례를 로그에서 확인했다. 클라는 3초에 abort하는데 서버 쿼리는 끝까지 돌기 때문에,
  //   사용자가 이상한 주소 하나를 넣을 때마다 커넥션이 1분 넘게 묶이고 다른 요청이 500이 났다.
  //   → `db.js query()`(=API 경로)에만 statement_timeout을 건다.
  //   ⚠️ import-job은 `withClient`만 쓰므로 대량 적재·CREATE INDEX·ANALYZE는 영향받지 않는다.
  //   값 근거: 정상 쿼리 0.01~1초, 부하 중 관측 최대 11.4초 → 15초면 정상은 살리고 폭주만 끊는다.
  statementTimeoutMs: Number.parseInt(process.env.ADDRESS_STATEMENT_TIMEOUT_MS || '15000', 10),
  // 퍼지·건물명 **폴백 전용** 상한. 클라이언트가 3초에 abort 하므로 그보다 오래 붙잡을 이유가 없다.
  // exact 매칭(7~14ms)에는 적용하지 않는다 — 거기서 상한에 걸리면 그건 진짜 이상 신호다.
  fallbackTimeoutMs: Number.parseInt(process.env.ADDRESS_FALLBACK_TIMEOUT_MS || '2500', 10),
  // P7 Phase2 ⓐ: 학습사전(Firestore) 로더. ADC를 쓰므로 키파일은 없다 —
  // 프로젝트는 보통 런타임이 알려주지만(GOOGLE_CLOUD_PROJECT), 명시 지정도 허용한다.
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
  dictTtlMs: Number.parseInt(process.env.ADDRESS_DICT_TTL_MS || '300000', 10),   // 5분
  // 정제(purify) 배치 동시성·크기 상한.
  // ★purify는 운영 `/v1/address/match`와 **Cloud SQL 1대(db-custom-1-3840 · 1 vCPU)를 공유**한다.
  //   2026-08-01 실측(운영 리비전, match를 1초 간격으로 병행 호출):
  //     · 실존 주소 48건 → 0.6초, match 6/6 정상(중앙 0.58초)        ← 정상 명단
  //     · 실존 주소 30건 → 6.3초, match 10/10 정상(중앙 0.47초)
  //     · **없는 주소** 30건 → 133초, match 3/53 실패(500)            ← 퍼지·건물명 트리그램 폭주
  //     · 없는 주소 60건·동시성3 → 300초 초과(504), match 9/56 실패
  //   즉 병목은 커넥션 개수가 아니라 **DB CPU**다. 없는 주소가 많은 명단은 무거운 폴백 경로로
  //   빠져 DB를 점유하고 운영 매칭까지 끌어내린다. 정제는 느려도 되지만 매칭은 안 된다.
  // → 동시성 1 + 1회 50건 상한 + 인스턴스당 배치 직렬화(purify.js)로 폭발 반경을 묶는다.
  //   대량 백필이 필요하면 이 값을 올리지 말고 **점검 시간대**에 돌리거나 DB를 증설할 것.
  purifyConcurrency: Number.parseInt(process.env.ADDRESS_PURIFY_CONCURRENCY || '1', 10),
  purifyMaxRecords: Number.parseInt(process.env.ADDRESS_PURIFY_MAX_RECORDS || '50', 10),
};

export const requireConfig = (...keys) => {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length) throw new Error(`필수 환경변수가 없습니다: ${missing.join(', ')}`);
};
