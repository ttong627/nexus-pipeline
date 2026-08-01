/**
 * 행안부 출입구 자료 적재 실행기.
 *
 *   node scripts/load-juso-entrc.mjs "<자료폴더>"                 # 예행(기본) — DB 접근 없음
 *   node scripts/load-juso-entrc.mjs "<자료폴더>" --apply         # 실제 적재
 *   node scripts/load-juso-entrc.mjs "<자료폴더>" --only daily    # 종류 한정
 *   node scripts/load-juso-entrc.mjs "<자료폴더>" --limit 20000   # 파일당 앞 N줄(빠른 확인)
 *
 * ★기본이 예행인 이유: 이 스크립트는 운영 DB 를 건드린다. 쓰기는 항상 형이 명시적으로
 *   `--apply` 를 붙였을 때만 일어난다. 예행에서도 격리·폐지 건수는 실제와 같게 센다
 *   (일변동 좌표 판정만 DB 대조군이 없어 '보류'로 집계된다 — 아래 출력에 명시).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { closePool, withClient } from '../src/db.js';
import {
  MIN_POINTS_EMD, MIN_POINTS_ROAD, createClusterIndex, referenceKeys,
} from '../src/entrance/coordGuard.js';
import {
  SOURCE_DAILY,
  classifySource, emptyStats, insertEntranceRows, insertQuarantineRows,
  mergeStats, orderSources, processFile, retireEntrances, skipReason,
} from '../src/entrance/entranceLoader.js';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

if (!dir) {
  console.error('사용법: node scripts/load-juso-entrc.mjs <자료폴더> [--apply] [--only full-summary|full-link|daily] [--limit N]');
  process.exit(2);
}

const APPLY = flag('apply');
const LIMIT = Number(opt('limit', 0)) || 0;
const BATCH = Number(opt('batch', config.importBatchSize)) || 1000;
const ONLY = opt('only', null);

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

const entries = [];
const skipped = {};
for (const name of (await readdir(dir)).sort()) {
  const src = classifySource(name);
  if (!src) {
    const why = skipReason(name);
    skipped[why] = (skipped[why] || 0) + 1;
    continue;
  }
  if (ONLY && src.kind !== ONLY) continue;
  const fp = path.join(dir, name);
  const { size } = await stat(fp);
  if (!size) continue;
  entries.push({ file: fp, ...src });
}

if (!entries.length) {
  console.error(`출입구 자료를 찾지 못했습니다: ${dir}`);
  process.exit(1);
}

const ordered = orderSources(entries);
console.log(`대상 ${ordered.length}개 파일 · 모드 ${APPLY ? '★실제 적재(--apply)' : '예행(dry-run)'}` + (LIMIT ? ` · 파일당 앞 ${fmt(LIMIT)}줄` : ''));
console.log('적용 순서: 전체분(요약 → 연계) → 일변동(날짜순). 전체분은 폐지를 해제하지 않는다.');
for (const [why, n] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
  console.log(`  · 미처리 ${String(n).padStart(4)}개 — ${why}`);
}
console.log('');

const total = emptyStats();
const perKind = {};
const quarantineSamples = [];

/** 예행용 — 아무것도 쓰지 않고 세기만 한다. */
const dryDeps = {
  onRows: async () => {},
  onQuarantine: async (rows) => {
    for (const r of rows) if (quarantineSamples.length < 40) quarantineSamples.push(r);
  },
  onRetire: async () => 0,
  lookupClusters: async () => [],
};

const makeDbDeps = (client) => {
  const cache = new Map();
  const centerFrom = async (key, sql, params, minPoints) => {
    if (cache.has(key)) return cache.get(key);
    const { rows } = await client.query(sql, params);
    const idx = createClusterIndex();
    for (const r of rows) idx.add(key, Number(r.lat), Number(r.lng));
    const c = idx.center(key, minPoints);
    cache.set(key, c);
    return c;
  };
  return {
    onRows: (rows, conflictSql) => insertEntranceRows(client, rows, conflictSql),
    onQuarantine: async (rows) => {
      for (const r of rows) if (quarantineSamples.length < 40) quarantineSamples.push(r);
      await insertQuarantineRows(client, rows);
    },
    onRetire: (keys, meta) => retireEntrances(client, keys, meta),
    // 일변동은 파일 안에 대조군이 없다(하루 수백 줄). 이미 적재된 같은 도로의 좌표를 기준 삼는다.
    lookupClusters: async (rec) => {
      const keys = referenceKeys(rec);
      const road = keys.road
        ? await centerFrom(`road:${keys.road}`,
          'SELECT lat, lng FROM entrance_core WHERE road_code = $1 AND lat IS NOT NULL LIMIT 5000',
          [keys.road], MIN_POINTS_ROAD)
        : null;
      if (road) return [{ kind: 'road', center: road }];
      // 법정동코드는 10자리 숫자다. LIKE 대신 범위조건을 써야 인덱스를 탄다(6백만 행 seq scan 방지).
      const emd = keys.emd
        ? await centerFrom(`emd:${keys.emd}`,
          'SELECT lat, lng FROM entrance_core WHERE legal_dong_code >= $1 AND legal_dong_code <= $2 AND lat IS NOT NULL LIMIT 5000',
          [`${keys.emd}00`, `${keys.emd}99`], MIN_POINTS_EMD)
        : null;
      return emd ? [{ kind: 'emd', center: emd }] : [];
    },
  };
};

const runAll = async (deps) => {
  for (const src of ordered) {
    const t0 = Date.now();
    const st = await processFile(src.file, src, deps, { limit: LIMIT, batchSize: BATCH });
    mergeStats(total, st);
    perKind[src.kind] = mergeStats(perKind[src.kind] || emptyStats(), st);
    console.log(
      `${path.basename(src.file).slice(0, 42).padEnd(44)}${fmt(st.lines).padStart(10)}행` +
      ` · 정상 ${fmt(st.ok).padStart(9)} · 무좌표 ${fmt(st.noCoord).padStart(6)}` +
      ` · 격리 ${fmt(st.quarantined).padStart(4)} · 보류 ${fmt(st.unverified).padStart(6)}` +
      ` · 폐지 ${fmt(st.retireSeen).padStart(4)}${APPLY ? `/${fmt(st.retireApplied)}` : ''}` +
      ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
  }
};

// 실행 식별자는 **한국시간** 기준으로 찍는다. toISOString(UTC)으로 날짜를 파생시키면
// 자정 전후 9시간 동안 전날 run_id 가 나온다(형이 여러 번 지적한 KST 규칙).
const kstStamp = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
};
const runId = `entrance-${kstStamp()}`;

try {
  if (APPLY) {
    await withClient(async (client) => {
      const schema = await readFile(join(here, '..', 'sql', 'entrance.sql'), 'utf8');
      await client.query(schema);
      await client.query('SET search_path TO nexus_address, public');
      await client.query(
        `INSERT INTO entrance_load_runs (run_id, source_dir, mode) VALUES ($1, $2, $3)
         ON CONFLICT (run_id) DO UPDATE SET started_at = now(), source_dir = EXCLUDED.source_dir`,
        [runId, dir, ONLY || 'all'],
      );
      await runAll(makeDbDeps(client));
      await client.query(
        'UPDATE entrance_load_runs SET finished_at = now(), counts = $2::jsonb WHERE run_id = $1',
        [runId, JSON.stringify(total)],
      );
      console.log('\n[ANALYZE] entrance_core — 대량 적재 후 플래너 통계 갱신');
      await client.query('ANALYZE entrance_core');
    });
  } else {
    await runAll(dryDeps);
  }
} finally {
  if (APPLY) await closePool();
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(4) : '0.0000');
console.log('\n' + '='.repeat(72));
for (const [kind, st] of Object.entries(perKind)) {
  console.log(`[${kind}] 파일 ${st.files} · 행 ${fmt(st.lines)} · 파싱 ${fmt(st.parsed)} · 폐기 ${fmt(st.skipped)}`);
}
console.log(`총 ${fmt(total.lines)}행 / 파싱 ${fmt(total.parsed)} / 폐기 ${fmt(total.skipped)}`);
console.log(`  좌표 정상   ${fmt(total.ok)}`);
console.log(`  무좌표      ${fmt(total.noCoord)}  ← 비공개·공개제한 건물(명세상 정상)`);
console.log(`  ★격리      ${fmt(total.quarantined)} (${pct(total.quarantined, total.parsed)}%)  ← 본 테이블에 좌표를 넣지 않음`);
console.log(`  판정보류    ${fmt(total.unverified)}  ← 대조군 표본 부족(좌표는 보관, 상태만 표시)`);
console.log(`  변환실패    ${fmt(total.projFail)}  ← 한국 밖으로 떨어진 변환(격리에 포함)`);
console.log(`  ★폐지(63)  발견 ${fmt(total.retireSeen)}${APPLY ? ` · 실제 반영 ${fmt(total.retireApplied)}` : ' (예행이라 미반영)'}`);
console.log(`  적재(upsert) ${fmt(total.upserted)}${APPLY ? '' : ' — 예행이라 쓰지 않음'}`);

if (!APPLY && perKind[SOURCE_DAILY]) {
  console.log('\n⚠️ 예행에서는 일변동 좌표의 대조군(DB 기적재 좌표)이 없어 전부 "판정보류"로 집계됩니다.');
}

if (quarantineSamples.length) {
  console.log('\n[격리 표본 — 국가 원본 좌표 오류]');
  for (const q of quarantineSamples.slice(0, 20)) {
    const d = q.distance_m ? `${(q.distance_m / 1000).toFixed(1)}km` : q.reason;
    console.log(`  ${d.padStart(8)} ${q.sido || ''} ${q.sigungu || ''} ${q.emd || ''} ${q.road_name || ''}` +
      ` -> ${q.lat === null ? 'x' : q.lat.toFixed(5)},${q.lng === null ? 'x' : q.lng.toFixed(5)} [${q.source_file}]`);
  }
}
