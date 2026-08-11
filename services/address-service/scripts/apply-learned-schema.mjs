#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  address_learned 테이블 즉시 적용 (형 지시 2026-08-11)
//
//  월 전체분 적재(import-job)를 기다리지 않고 지금 만든다. 테이블이 없으면
//  서버는 학습 조회를 조용히 건너뛰도록 방어돼 있으므로(42P01 처리),
//  이 스크립트는 **언제 돌려도 안전**하고 여러 번 돌려도 무해하다(IF NOT EXISTS).
//
//  사용:  node scripts/apply-learned-schema.mjs          # 확인만(dry-run)
//         node scripts/apply-learned-schema.mjs --apply  # 실제 적용
//  전제:  ADDRESS_DATABASE_URL 환경변수(운영은 Secret Manager)
// ══════════════════════════════════════════════════════════════════
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes('--apply');
const url = process.env.ADDRESS_DATABASE_URL || process.env.DATABASE_URL;

if (!url) {
  console.error('ADDRESS_DATABASE_URL 이 없습니다. 값은 출력하지 말고 환경변수로만 주입하세요.');
  process.exit(1);
}

const sql = await readFile(join(here, '..', 'sql', 'learned.sql'), 'utf8');

if (!apply) {
  console.log('[dry-run] 아래 DDL을 적용합니다. 실제 적용은 --apply 를 붙이세요.\n');
  console.log(sql.split('\n').filter(l => /^(CREATE|SET)/.test(l.trim())).join('\n'));
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10000 });
const client = await pool.connect();
try {
  await client.query(sql);
  // 초기 배포(2026-08-11) 때 키를 주소 문자열로 만든 행이 남아 있으면 정리한다.
  //   의미 키는 `시군구#도로명#본번-부번` 형태라 '#'을 반드시 포함한다. 없는 행은
  //   조회 키와 절대 맞물리지 않는 죽은 행이므로 남겨둘 이유가 없다(재학습되면 다시 들어온다).
  const { rowCount: purged } = await client.query(`
    DELETE FROM nexus_address.address_learned WHERE road_key NOT LIKE '%#%'
  `);
  if (purged) console.log(`구버전 문자열 키 행 ${purged}건 정리(재조회 시 새 키로 다시 학습됨)`);
  const { rows } = await client.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE promoted_version_id IS NULL)::int AS pending
    FROM nexus_address.address_learned
  `);
  console.log(`적용 완료. address_learned 총 ${rows[0].total}건 (미편입 ${rows[0].pending}건)`);
} finally {
  client.release();
  await pool.end();
}
