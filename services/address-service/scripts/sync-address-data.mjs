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
//    ⑤ 좌표 미보유 건물 채우기 — 일일 쿼터·시간 예산 안에서(C-6·설계서 §3-5)
//    ⑥ 좌표 이상치 검증 — quality='outlier' 로 **표시만** 한다(좌표는 지우지 않는다)
//    ⑦ 실행 요약 출력(운영 로그·알림용)
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
//    node scripts/sync-address-data.mjs --apply --skip-coords               # 좌표 단계 제외
// ══════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { closePool, withClient } from '../src/db.js';
import { learnedRowFromJuso } from '../src/learnedStore.js';
import { availableSources, createQuotaCounter } from '../src/coords/coordFill.js';
import { countFillTargets, loadCoordRowsForCheck, loadFillTargets } from '../src/coords/coordQuery.js';
import { planOutlierMarks, OUTLIER_MIN_SAMPLE, OUTLIER_RADIUS_KM } from '../src/coords/coordOutlier.js';
import { DAILY_LIMITS, MAX_FILL_PER_CALL, fillCoords, markOutlierRows, touchCoordRows } from '../src/coords/coordWrite.js';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const APPLY = flag('apply');
const ENTRC_DIR = opt('entrc', null);
const SKIP_ENTRC = flag('skip-entrc') || !ENTRC_DIR;
const REFRESH_LIMIT = Number(opt('refresh-limit', 200)) || 200;
const SCHEMA = config.dbSchema;

// ── 좌표 단계(⑤⑥) 설정 ──────────────────────────────────────────
const SKIP_COORDS = flag('skip-coords');
const COORD_SIGUNGU = opt('coord-sigungu', '') || '';
/** 이 배치 한 번이 좌표 채움에 쓸 수 있는 최대 건수. 쿼터(§3-3)와 별개의 2차 상한. */
const COORD_LIMIT = Number(opt('coord-limit', process.env.COORD_FILL_DAILY_MAX || 20000)) || 20000;
/** 'none'·'outlier' 를 다시 태우기까지의 간격(일). 주소DB 갱신 주기(월)에 맞춘다. */
const COORD_RETRY_DAYS = Number(opt('coord-retry-days', process.env.COORD_FILL_RETRY_DAYS || 30)) || 30;
/**
 * ⑤에 허용할 시간(초).
 *
 * ★쿼터만으로는 부족하다. VWorld 는 **초당 2건**이 상한이라(vworld.js 실측: 초당 3.9 에서
 *   붕괴) 20,000건은 산술적으로 2.8시간이다. Job task-timeout 이 3600초이므로
 *   시간 상한이 없으면 배치는 ⑥에 닿지도 못한 채 **중간에 잘린다** — 그리고 잘린 실행은
 *   요약 로그를 남기지 않아 무엇이 됐는지 알 수 없다. 예산 안에서 끝내고 나머지는 이월한다.
 */
const COORD_BUDGET_SEC = Number(opt('coord-budget-sec', process.env.COORD_FILL_BUDGET_SEC || 1200)) || 1200;

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
// ★기준 버전은 env(ADDRESS_DB_VERSION)가 아니라 **DB의 published 버전**을 읽는다.
//   env 는 서비스·Job 이 따로 관리돼 월 적재 때 한쪽만 갱신되면 조용히 어긋난다
//   (2026-08-11 실측: Job 이 기본값 202604 로 돌아 편입 표시가 영원히 0건이 될 뻔했다).
const resolveActiveVersion = async (client) => {
  const { rows } = await client.query(`
    SELECT version_id FROM ${SCHEMA}.address_db_versions
    WHERE status = 'published'
    ORDER BY published_at DESC NULLS LAST, version_id DESC
    LIMIT 1
  `);
  return rows[0]?.version_id || config.activeVersion;
};

const promoteLearned = async () => {
  let count = 0;
  await withClient(async (client) => {
    const activeVersion = await resolveActiveVersion(client);
    summary.activeVersion = activeVersion;
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
    const { rows } = await client.query(sql, [activeVersion]);
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
      `, [activeVersion]);
    }
  });
  return { promoted: count };
};

// ── ⑤ 좌표 미보유 건물 채우기 (C-6 · 설계서 §3-5) ────────────────
// ★예행에서는 외부 API 를 부르지 않는다 — 대상 건수만 센다(fill-coords.mjs 와 같은 규칙).
const fillMissingCoords = async () => {
  if (SKIP_COORDS) return { skipped: '--skip-coords' };

  // ★키가 없으면 시작하지 않는다. 2026-08-11 실측: 키 없이 돌렸더니 채움률 0% 가 나왔고
  //   그 0% 가 "이 주소들은 좌표가 원래 없다"처럼 보였다(설계서 F9).
  const sources = availableSources(config);
  const pending = await countFillTargets({ retryDays: COORD_RETRY_DAYS, sigungu: COORD_SIGUNGU });
  if (!sources.length) return { skipped: '출처 키 없음(VWORLD_KEY·KAKAO_REST_KEY)', pending };
  // ★대상 0건도 note 경로로 보낸다. 요약 분기가 통계 필드를 기대하는데 여기서 빈 객체를
  //   돌려주면 로그에 `undefined 회전 undefined 초`가 찍힌다(2026-08-11 첫 예행 실측).
  //   숫자가 깨진 로그는 "0건이라 안 돈 것"인지 "고장 나서 안 돈 것"인지 구분을 지운다.
  if (!pending) return { sources, pending: 0, note: '채울 대상 없음 — 전부 확보됨' };
  if (!APPLY) return { sources, pending, note: '예행 — 외부 API·쓰기 없음' };

  const quota = createQuotaCounter(DAILY_LIMITS);
  const deadline = Date.now() + COORD_BUDGET_SEC * 1000;
  // ★한 바퀴만 돈다. 처리한 행은 touchCoordRows 로 목록 뒤로 가므로, 시작 시점의
  //   남은 건수만큼 처리하면 전부 한 번씩 본 것이다. 이 상한이 없으면 앵커를 못 만드는
  //   건들 사이를 계속 순환한다.
  const budget = Math.min(pending, COORD_LIMIT);
  const stat = {
    sources, pending, attempted: 0, filled: 0, none: 0, dongs: 0,
    skipped: 0, skipReasons: {}, bySource: {}, rounds: 0, carried: 0, stopped: null,
  };

  while (stat.attempted + stat.skipped < budget) {
    if (Date.now() >= deadline) { stat.stopped = 'time'; break; }
    if (quota.exhausted('vworld') && quota.exhausted('kakao')) { stat.stopped = 'quota'; break; }

    const take = Math.min(MAX_FILL_PER_CALL, budget - (stat.attempted + stat.skipped));
    const targets = await loadFillTargets({ limit: take, retryDays: COORD_RETRY_DAYS, sigungu: COORD_SIGUNGU });
    if (!targets.length) { stat.stopped = 'drained'; break; }

    const records = targets.map((t) => ({
      roadAddress: t.road_address,
      sigungu: t.sigungu || '',
      legalEmd: t.legal_emd || '',
      buildingName: t.building_name || '',
      isApartment: t.is_apartment === true,
    }));
    const { summary } = await fillCoords(records, { version: config.activeVersion, quota, retryNone: true });
    // ★성공·실패·건너뜀 무관하게 "봤다"를 찍는다. 안 찍으면 다음 라운드가 같은 행을 다시 꺼낸다.
    await touchCoordRows(targets.map((t) => t.coord_key));

    stat.rounds += 1;
    stat.attempted += summary.attempted;
    stat.filled += summary.filled;
    stat.none += summary.none;
    stat.dongs += summary.dongs;
    stat.skipped += summary.skipped;
    for (const [k, v] of Object.entries(summary.skipReasons || {})) stat.skipReasons[k] = (stat.skipReasons[k] || 0) + v;
    for (const [k, v] of Object.entries(summary.bySource || {})) stat.bySource[k] = (stat.bySource[k] || 0) + v;
    // ★쿼터 때문에 못 부른 건수는 **종료 사유와 따로** 센다. 여기에 stopped='quota' 를
    //   찍으면 실제로는 대상이 바닥나서(drained) 끝났는데도 로그가 "쿼터 소진"이라
    //   거짓 보고한다 — 그러면 한도부터 의심하느라 진짜 원인을 못 본다.
    stat.carried += summary.carried || 0;
  }
  if (!stat.stopped) stat.stopped = 'budget';   // 한 바퀴 다 돌았다

  stat.quota = quota.summary();
  stat.elapsedSec = Math.round((COORD_BUDGET_SEC * 1000 - (deadline - Date.now())) / 1000);
  // ★"가져온 것"이 아니라 **남은 것**을 다시 센다. 이월 건수를 눈으로 보지 못하면
  //   좌표가 안 늘어나는 걸 아무도 모른다(F7).
  stat.remaining = await countFillTargets({ retryDays: COORD_RETRY_DAYS, sigungu: COORD_SIGUNGU });
  return stat;
};

// ── ⑥ 좌표 이상치 검증 (C-6 · 설계서 F5) ────────────────────────
// 표시만 하고 좌표는 지우지 않는다. 판정 기준은 화면과 같은 detectCoordOutliers.
const verifyCoordOutliers = async () => {
  if (SKIP_COORDS) return { skipped: '--skip-coords' };
  const rows = await loadCoordRowsForCheck({ sigungu: COORD_SIGUNGU });
  if (!rows.length) return { checked: 0, marked: 0, note: '검증할 좌표 없음' };

  const { marks, stale, groups, checked } = planOutlierMarks(rows, {
    radiusKm: OUTLIER_RADIUS_KM, minSample: OUTLIER_MIN_SAMPLE,
  });
  const marked = APPLY ? await markOutlierRows(marks) : 0;
  return {
    scanned: rows.length,
    checked,
    groups: groups.length,
    groupsSkipped: groups.filter((g) => g.skipped).length,
    candidates: marks.length,
    marked,
    stale: stale.length,
    sample: marks.slice(0, 5).map((m) => `${m.sigungu} ${m.roadAddress} — ${m.distanceKm}km`),
  };
};

// ── 실행 ─────────────────────────────────────────────────────────
try {
  console.log(`[sync] 시작 — ${APPLY ? '실제 적용' : '예행(dry-run)'}`);
  summary.steps.schema = await ensureSchema();
  summary.steps.entrc = SKIP_ENTRC ? { skipped: '자료폴더 미지정' } : await loadEntrc();
  summary.steps.refresh = await refreshLearned();
  summary.steps.promote = await promoteLearned();
  summary.steps.coordFill = await fillMissingCoords();
  summary.steps.coordCheck = await verifyCoordOutliers();
  summary.finishedAt = new Date().toISOString();

  const cf = summary.steps.coordFill;
  const cc = summary.steps.coordCheck;

  console.log('\n══ 동기화 요약 ══');
  console.log(`  출입구 연계적재 : ${summary.steps.entrc.skipped || `exit ${summary.steps.entrc.exitCode}`}`);
  console.log(`  학습주소 재확인 : 확인 ${fmt(summary.steps.refresh.checked)} · 갱신 ${fmt(summary.steps.refresh.updated)}`
    + ` · 변화없음 ${fmt(summary.steps.refresh.unchanged)} · 미확인 ${fmt(summary.steps.refresh.unresolved)}`);
  console.log(`  정식DB 편입     : ${fmt(summary.steps.promote.promoted)}건 (기준 version ${summary.activeVersion || '?'})`);
  if (cf.skipped) {
    console.log(`  좌표 채움       : 건너뜀 — ${cf.skipped}${cf.pending != null ? ` (대상 ${fmt(cf.pending)}건 남음)` : ''}`);
  } else if (cf.note) {
    console.log(`  좌표 채움       : 대상 ${fmt(cf.pending)}건 · ${cf.note} (출처 ${cf.sources.join('·')})`);
  } else {
    console.log(`  좌표 채움       : 시도 ${fmt(cf.attempted)} · 확보 ${fmt(cf.filled)} · 못구함 ${fmt(cf.none)}`
      + ` · 동 ${fmt(cf.dongs)} · 건너뜀 ${fmt(cf.skipped)}${Object.keys(cf.skipReasons || {}).length ? ` ${JSON.stringify(cf.skipReasons)}` : ''}`);
    // ★남은 건수를 매번 찍는다. 0건 진행이 이틀 연속이면 무언가 막힌 것이다(F7).
    console.log(`                    출처 ${JSON.stringify(cf.bySource)} · 쿼터 ${JSON.stringify(cf.quota)}`
      + ` · 쿼터로 못부른 건 ${fmt(cf.carried)}`
      + ` · ${cf.rounds}회전 ${cf.elapsedSec}초${cf.stopped ? ` · 종료 ${cf.stopped}` : ''}`);
    console.log(`                    ★다음으로 이월 ${fmt(cf.remaining)}건`);
  }
  if (cc.skipped) {
    console.log(`  좌표 이상치     : 건너뜀 — ${cc.skipped}`);
  } else {
    console.log(`  좌표 이상치     : 검사 ${fmt(cc.checked)} / 조회 ${fmt(cc.scanned || 0)}`
      + ` · 지자체 ${fmt(cc.groups || 0)}(표본부족 ${fmt(cc.groupsSkipped || 0)})`
      + ` · 후보 ${fmt(cc.candidates || 0)} → 표시 ${fmt(cc.marked || 0)} · 해제후보 ${fmt(cc.stale || 0)}`);
    for (const s of cc.sample || []) console.log(`                    ${s}`);
  }
  if (!APPLY) console.log('\n  ※ 예행이라 DB는 바뀌지 않았습니다. 실제 적용은 --apply');
  console.log(JSON.stringify(summary));
} finally {
  await closePool();
}
