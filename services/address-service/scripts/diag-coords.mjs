#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  좌표 실태 적대적 진단 (형 지시 2026-08-11)
//  "적재했다"는 기록을 믿지 않고 직접 센다. 조회가 비어 나오는 원인이
//  ①테이블 없음 ②좌표 없음 ③조인 키 불일치 ④지역 편중 중 무엇인지 가른다.
//  읽기 전용 — 아무것도 바꾸지 않는다.
// ══════════════════════════════════════════════════════════════════
import { closePool, withClient } from '../src/db.js';
import { config } from '../src/config.js';

const S = config.dbSchema;
const V = config.activeVersion;
const out = (label, v) => console.log(`${String(label).padEnd(48)} ${v}`);
const num = (n) => Number(n || 0).toLocaleString('ko-KR');

await withClient(async (c) => {
  await c.query(`SET search_path TO ${S}, public`);
  const exists = async (name) => (await c.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`${S}.${name}`])).rows[0]?.ok === true;

  console.log(`══════ ① 좌표 관련 테이블 존재 여부 (version ${V}) ══════`);
  const present = {};
  for (const t of ['entrance_core', 'building_ext', 'address_geocode_cache', 'address_learned',
    'entrance_coord_quarantine', 'entrance_load_runs', 'building_ext_runs']) {
    present[t] = await exists(t);
    if (!present[t]) { out(t, '❌ 테이블 없음'); continue; }
    const { rows } = await c.query(`SELECT count(*)::bigint AS n FROM ${S}.${t}`);
    out(`${t} 행수`, num(rows[0].n));
  }

  console.log('\n══════ ② 주소 본체 테이블 실태 ══════');
  for (const t of ['address_core', 'building_core', 'road_codes', 'address_building_links', 'detail_core']) {
    if (!await exists(t)) { out(`  ${t}`, '❌ 테이블 없음'); continue; }
    const { rows } = await c.query(`SELECT count(*)::bigint AS n FROM ${S}.${t} WHERE version_id = $1`, [V]);
    out(`  ${t}`, num(rows[0].n));
  }

  console.log('\n══════ ③ address_core 결손 — building_core 에만 있는 건물 ══════');
  const { rows: cov } = await c.query(`
    SELECT count(*)::bigint AS n FROM ${S}.building_core b
    WHERE b.version_id = $1 AND NOT EXISTS (
      SELECT 1 FROM ${S}.address_core a
      WHERE a.version_id = b.version_id AND a.road_code = b.road_code
        AND a.building_main_no = b.building_main_no AND a.building_sub_no = b.building_sub_no)`, [V]);
  out('  address_core 에 없는 건물 수', num(cov[0].n));

  console.log('\n══════ ④ 출입구 좌표 경로 ══════');
  if (!present.entrance_core) {
    out('  entrance_core', '❌ 없음 → 출입구 좌표 조회는 전면 불가(findEntrance 항상 null)');
  } else {
    const { rows: q } = await c.query(`
      SELECT coord_status, count(*)::bigint AS n, count(*) FILTER (WHERE lat IS NOT NULL)::bigint AS w
      FROM ${S}.entrance_core GROUP BY coord_status ORDER BY n DESC`);
    for (const r of q) out(`  coord_status=${r.coord_status}`, `${num(r.n)}건 (좌표있음 ${num(r.w)})`);
    const { rows: k } = await c.query(`
      SELECT count(*)::bigint AS total,
             count(*) FILTER (WHERE coalesce(address_mgt_no,'') <> '')::bigint AS amn,
             count(*) FILTER (WHERE coalesce(road_code,'') <> '')::bigint AS rc
      FROM ${S}.entrance_core`);
    out('  address_mgt_no 보유(1차 조인키)', `${num(k[0].amn)} / ${num(k[0].total)}`);
    out('  road_code 보유(2차 조인키)', `${num(k[0].rc)} / ${num(k[0].total)}`);
  }

  console.log('\n══════ ⑤ 지금 실제로 좌표를 갖고 있는 곳 = 지오코딩 캐시 ══════');
  if (!present.address_geocode_cache) { out('  address_geocode_cache', '❌ 없음'); } else {
    const { rows } = await c.query(`
      SELECT coalesce(provider,'(null)') AS p, count(*)::bigint AS n,
             count(*) FILTER (WHERE lat IS NOT NULL)::bigint AS ok
      FROM ${S}.address_geocode_cache GROUP BY 1 ORDER BY n DESC`);
    for (const r of rows) out(`  provider=${r.p}`, `${num(r.n)}건 (좌표있음 ${num(r.ok)})`);
    const { rows: d } = await c.query(`
      SELECT count(*) FILTER (WHERE cache_key LIKE 'dong:%')::bigint AS dong,
             count(*) FILTER (WHERE cache_key NOT LIKE 'dong:%')::bigint AS plain,
             count(*) FILTER (WHERE dong_no IS NOT NULL)::bigint AS with_dongno,
             count(*) FILTER (WHERE floors IS NOT NULL)::bigint AS with_floors
      FROM ${S}.address_geocode_cache`);
    out('  동(棟)좌표 캐시 dong:*', num(d[0].dong));
    out('  일반 주소 좌표', num(d[0].plain));
    out('  dong_no 채워진 행', num(d[0].with_dongno));
    out('  floors(지상층수) 채워진 행', num(d[0].with_floors));
    const { rows: s } = await c.query(`
      SELECT cache_key, standard_road_address, provider, dong_no, floors
      FROM ${S}.address_geocode_cache WHERE cache_key LIKE 'dong:%' ORDER BY last_used_at DESC LIMIT 3`);
    for (const r of s) out('  예시(dong)', `${r.standard_road_address} | 동${r.dong_no} | ${r.floors}층 | ${r.provider}`);
  }

  console.log('\n══════ ⑥ 적재 이력 ══════');
  for (const t of ['entrance_load_runs', 'building_ext_runs']) {
    if (!present[t]) { out(`  ${t}`, '❌ 테이블 없음 = 한 번도 적재 안 됨'); continue; }
    const { rows } = await c.query(`SELECT * FROM ${S}.${t} LIMIT 3`);
    if (!rows.length) { out(`  ${t}`, '이력 0건 = 한 번도 적재 안 됨'); continue; }
    for (const r of rows) out(`  ${t}`, JSON.stringify(r).slice(0, 140));
  }
  console.log('\n진단 끝.');
}).finally(closePool);
