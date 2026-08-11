#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  주소자료 정기 동기화 실행기 (형 지시 2026-08-11)
//  "연계프로그램으로 데이터를 수시 업데이트 할수 있도록 구성 해줘."
//
//  하는 일(순서 고정 — 뒤바뀌면 폐지된 주소가 되살아난다):
//    ① 버전독립 스키마 보장(learned.sql)
//    ② 출입구 연계자료 적재: 전체분 → 일변동(날짜 오름차순)
//       ※ 순서 규칙은 이미 entranceLoader 가 강제하고 회귀로 고정돼 있다
//         (scripts/entrance-loader.test.mjs "적용 순서는 전체분 → 일변동")
//    ③ 학습주소 재확인: 아직 전체분 DB에 없는 건(promoted NULL)을 JUSO로 다시 물어
//       주소가 바뀌었거나 정식 등재됐는지 갱신한다
//    ④ 편입 표시: 이번 전체분에 들어온 학습주소를 promoted_version_id 로 마킹
//    ⑤ 실행 요약 출력(운영 로그·알림용)
//
//  ★기본이 예행(dry-run)이다. 운영 DB 쓰기는 --apply 를 붙였을 때만 일어난다.
//  ★자료 수신 경로는 계정 인증이 걸린 영역이라 이 스크립트가 임의로 내려받지 않는다.
//    행안부 연계파일은 형이 지정한 위치(GCS 버킷 ADDRESS_SOURCE_BUCKET 또는 로컬 폴더)에
//    놓이고, 이 실행기는 그것을 **적용**만 한다. 다운로드 자동화는 자격증명이 준비된 뒤
//    별도 단계로 붙인다(없는 URL을 지어내면 조용히 빈 폴더를 도는 배치가 된다).
//
//  사용:
//    node scripts/sync-address-data.mjs --entrc "<연계자료폴더>"            # 예행
//    node scripts/sync-address-data.mjs --entrc "<연계자료폴더>" --apply    # 실제 적용
//    node scripts/sync-address-data.mjs --apply --skip-entrc                # 학습분만 갱신
// ══════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { closePool, withClient } from '../src/db.js';
import { learnedRowFromJuso } from '../src/learnedStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const APPLY = flag('apply');
const ENTRC_DIR = opt('entrc', null);
const SKIP_ENTRC = flag('skip-entrc') || !ENTRC_DIR;
const REFRESH_LIMIT = Number(opt('refresh-limit', 200)) || 200;
const SCHEMA = config.dbSchema;

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const summary = { startedAt: new Date().toISOString(), apply: APPLY, steps: {} };

// ── ① 스키마 보장 ────────────────────────────────────────────────
const ensureSchema = async () => {
  if (!APPLY) return { skipped: '예행' };
  const sql = await readFile(join(here, '..', 'sql', 'learned.sql'), 'utf8');
  await withClient(async (client) => { await client.query(sql); });
  return { applied: true };
};

// ── ② 출입구 연계자료 적재 (기존 실행기에 위임 — 로직 복제 금지) ──
const loadEntrc = () => new Promise((resolve) => {
  const args = [join(here, 'load-juso-entrc.mjs'), ENTRC_DIR];
  if (APPLY) args.push('--apply');
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  child.on('exit', (code) => resolve({ exitCode: code }));
  child.on('error', (e) => resolve({ error: String(e.message || e) }));
});

// ── ③ 학습주소 재확인 ────────────────────────────────────────────
// 신축은 몇 달 뒤 전체분에 편입된다. 그때까지 학습분이 옛 정보를 붙들고 있으면
// 건물명·법정동이 실제와 어긋난 채 배송에 쓰인다 → 주기적으로 다시 물어본다.
const fetchJuso = async (keyword) => {
  if (!config.jusoApiKeys.length) return null;
  for (const apiKey of config.jusoApiKeys) {
    const url = new URL('https://business.juso.go.kr/addrlink/addrLinkApi.do');
    url.searchParams.set('confmKey', apiKey);
    url.searchParams.set('currentPage', '1');
    url.searchParams.set('countPerPage', '1');
    url.searchParams.set('resultType', 'json');
    url.searchParams.set('keyword', keyword);
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const rec = (await r.json()).results?.juso?.[0];
      if (rec) return rec;
    } catch { /* 다음 키로 */ }
  }
  return null;
};

const refreshLearned = async () => {
  const stat = { checked: 0, updated: 0, unchanged: 0, unresolved: 0 };
  await withClient(async (client) => {
    const { rows } = await client.query(`
      SELECT road_key, road_address, building_name
      FROM ${SCHEMA}.address_learned
      WHERE promoted_version_id IS NULL
      ORDER BY hit_count DESC, last_used_at DESC
      LIMIT $1
    `, [REFRESH_LIMIT]);
    for (const row of rows) {
      stat.checked++;
      const rec = await fetchJuso(row.road_address);
      const next = learnedRowFromJuso(rec, { source: 'juso' });
      if (!next) { stat.unresolved++; continue; }
      const changed = next.road_address !== row.road_address
        || (next.building_name || '') !== (row.building_name || '');
      if (!changed) { stat.unchanged++; continue; }
      stat.updated++;
      if (!APPLY) continue;
      await client.query(`
        UPDATE ${SCHEMA}.address_learned
        SET road_address = $2, building_name = $3, legal_emd = $4,
            building_mgt_no = $5, zip_no = $6, last_used_at = now()
        WHERE road_key = $1
      `, [row.road_key, next.road_address, next.building_name, next.legal_emd,
        next.building_mgt_no, next.zip_no]);
    }
  });
  return stat;
};

// ── ④ 편입 표시 ──────────────────────────────────────────────────
const promoteLearned = async () => {
  let count = 0;
  await withClient(async (client) => {
    const sql = `
      SELECT count(*)::int AS n
      FROM ${SCHEMA}.address_learned l
      WHERE l.promoted_version_id IS DISTINCT FROM $1
        AND EXISTS (
          SELECT 1 FROM ${SCHEMA}.address_core a
          WHERE a.version_id = $1 AND a.road_name = l.road_name
            AND a.building_main_no = l.building_main_no
            AND a.building_sub_no = l.building_sub_no
        )`;
    const { rows } = await client.query(sql, [config.activeVersion]);
    count = rows[0]?.n || 0;
    if (APPLY && count) {
      await client.query(`
        UPDATE ${SCHEMA}.address_learned l
        SET promoted_version_id = $1
        WHERE l.promoted_version_id IS DISTINCT FROM $1
          AND EXISTS (
            SELECT 1 FROM ${SCHEMA}.address_core a
            WHERE a.version_id = $1 AND a.road_name = l.road_name
              AND a.building_main_no = l.building_main_no
              AND a.building_sub_no = l.building_sub_no
          )
      `, [config.activeVersion]);
    }
  });
  return { promoted: count };
};

// ── 실행 ─────────────────────────────────────────────────────────
try {
  console.log(`[sync] 시작 — ${APPLY ? '실제 적용' : '예행(dry-run)'} · version ${config.activeVersion}`);
  summary.steps.schema = await ensureSchema();
  summary.steps.entrc = SKIP_ENTRC ? { skipped: '자료폴더 미지정' } : await loadEntrc();
  summary.steps.refresh = await refreshLearned();
  summary.steps.promote = await promoteLearned();
  summary.finishedAt = new Date().toISOString();

  console.log('\n══ 동기화 요약 ══');
  console.log(`  출입구 연계적재 : ${summary.steps.entrc.skipped || `exit ${summary.steps.entrc.exitCode}`}`);
  console.log(`  학습주소 재확인 : 확인 ${fmt(summary.steps.refresh.checked)} · 갱신 ${fmt(summary.steps.refresh.updated)}`
    + ` · 변화없음 ${fmt(summary.steps.refresh.unchanged)} · 미확인 ${fmt(summary.steps.refresh.unresolved)}`);
  console.log(`  정식DB 편입     : ${fmt(summary.steps.promote.promoted)}건`);
  if (!APPLY) console.log('\n  ※ 예행이라 DB는 바뀌지 않았습니다. 실제 적용은 --apply');
  console.log(JSON.stringify(summary));
} finally {
  await closePool();
}
