#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  VWorld 지오코더 실패 원인 진단 (읽기 전용 · 쓰기 없음)
//
//  왜 만들었나: 2026-08-11 C-3 전량 채움에서 geocodeRoad 가 1,343회 중 947회(70%)
//  실패했다. 로그엔 `Unexpected token '<', "<html><bod"...` 와 `fetch failed` 만
//  남아 **스로틀인지 한도 초과인지 키 문제인지 갈리지 않았다**.
//  동 좌표는 VWorld 만 줄 수 있으므로(Kakao 는 단지 1좌표) C-5 전에 규명해야 한다.
//
//  검증할 가설: "동시성 3(초당 약 14요청) 버스트 스로틀링"
//    성공·실패가 뒤섞여 나온 것이 근거 — 하드 한도였다면 어느 시점 이후 전부 실패한다.
//
//  방법: 같은 주소 집합을 **동시성만 바꿔가며** 돌리고 실패율·사유·상태코드를 센다.
//        동시성이 낮을수록 성공률이 오르면 스로틀, 그대로면 한도·키 문제다.
// ══════════════════════════════════════════════════════════════════
import { config } from '../src/config.js';
import { closePool, withClient } from '../src/db.js';
import { geocodeRoad, geocodeRoadDetailed } from '../src/vworld.js';

const arg = (name, dflt = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const N = Math.max(1, Number(arg('n', '40')));
const LEVELS = arg('levels', '1,3').split(',').map((x) => Math.max(1, Number(x.trim()))).filter(Boolean);
const PAUSE_MS = Math.max(0, Number(arg('pause', '5000')));
const VIA = arg('via', 'raw');
const S = config.dbSchema;
const out = (l, v) => console.log(`${String(l).padEnd(40)} ${v}`);
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const runPool = async (items, limit, fn) => {
  const res = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return res;
};

await withClient(async (c) => {
  await c.query(`SET search_path TO ${S}, public`);
  if (!config.vworldKey) {
    console.log('⛔ VWORLD_KEY 가 없습니다. 진단할 수 없습니다.');
    process.exitCode = 2;
    return;
  }
  // 실주소를 쓴다 — 지어낸 주소는 '없는 주소' 경로를 타서 스로틀 판정을 흐린다.
  const { rows } = await c.query(`
    SELECT road_address FROM ${S}.building_coord
    WHERE road_address <> '' ORDER BY coord_key LIMIT $1`, [N]);
  const addrs = rows.map((r) => r.road_address);
  console.log(`══ VWorld 진단 · 주소 ${addrs.length}건 · 동시성 ${LEVELS.join(', ')} ══`);

  for (const level of LEVELS) {
    const started = Date.now();
    // --via=hardened 는 운영이 실제로 쓰는 경로(속도제한+재시도)를 잰다.
    // 기본 raw 는 서버 원래 거동을 잰다 — 둘을 같은 조건으로 비교해야 처방 효과가 증명된다.
    const probe = VIA === 'hardened'
      ? async (a) => { const p = await geocodeRoad(a); return p ? { ok: true, point: p } : { ok: false, reason: 'failed_after_retry' }; }
      : (a) => geocodeRoadDetailed(a);
    const results = await runPool(addrs, level, probe);
    const secs = (Date.now() - started) / 1000;
    const ok = results.filter((r) => r.ok).length;
    const reasons = {};
    const statuses = {};
    const snippets = new Set();
    const errs = new Set();
    for (const r of results) {
      if (r.ok) continue;
      reasons[r.reason] = (reasons[r.reason] || 0) + 1;
      if (r.status) statuses[r.status] = (statuses[r.status] || 0) + 1;
      if (r.snippet) snippets.add(r.snippet);
      if (r.errorCode || r.errorText) errs.add(`${r.errorCode} ${r.errorText}`.trim());
      if (r.message) errs.add(r.message);
    }
    // ★"언제부터" 실패했는지가 핵심이다. 처음부터 섞여 실패하면 주소·네트워크 문제이고,
    //   N 회쯤부터 무너지면 **분당·시간당 한도**다(2026-08-11 1,343건 실행이 그랬는지 확인).
    const firstFail = results.findIndex((r) => !r.ok);
    const okBefore = firstFail < 0 ? results.length : firstFail;
    const times = results.filter((r) => r.ms != null).map((r) => r.ms).sort((a, b) => a - b);
    console.log(`\n── 동시성 ${level} ──`);
    out('  성공', `${ok} / ${addrs.length} (${(ok / addrs.length * 100).toFixed(1)}%)`);
    out('  소요', `${secs.toFixed(1)}초 (초당 ${(addrs.length / secs).toFixed(1)}요청)`);
    out('  ★첫 실패 전 연속 성공', firstFail < 0 ? '전부 성공' : `${okBefore}회째까지 성공 후 붕괴`);
    out('  실패 사유', JSON.stringify(reasons));
    out('  HTTP 상태', Object.keys(statuses).length ? JSON.stringify(statuses) : '(응답 없음)');
    if (times.length) out('  응답시간 중앙/최대', `${times[Math.floor(times.length / 2)]}ms / ${times[times.length - 1]}ms`);
    for (const s of [...snippets].slice(0, 3)) console.log(`  ▸ 본문: ${s}`);
    for (const e of [...errs].slice(0, 3)) console.log(`  ▸ 오류: ${e}`);
    if (level !== LEVELS[LEVELS.length - 1] && PAUSE_MS) {
      console.log(`  (다음 단계 전 ${PAUSE_MS / 1000}초 대기 — 스로틀 창을 비운다)`);
      await sleep(PAUSE_MS);
    }
  }

  console.log('\n══ 판정 기준 ══');
  console.log('  동시성이 낮을수록 성공률이 오른다        → 버스트 스로틀링 (동시성·백오프로 해결)');
  console.log('  동시성과 무관하게 실패율이 같다          → 일 한도 초과 또는 키 문제');
  console.log('  HTTP 429/403 + HTML 본문                → WAF·레이트리밋 (본문 문구 확인)');
}).finally(closePool);
