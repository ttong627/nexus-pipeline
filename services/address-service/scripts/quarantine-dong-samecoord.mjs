#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  C-4-c 동 좌표 오염 격리 ② — **같은 건물의 서로 다른 동이 한 점**
//
//  왜 필요한가: C-4 는 "같은 좌표인데 **건물명이 다름**"만 잡았고, C-4-b 는 같은 규칙을
//  구 캐시에 적용했다. 그런데 2026-08-11 여월 진단에서 **다른 패턴**이 나왔다:
//    여월휴먼시아2단지(여월로 65)의 동 104·107·110·112 가 **모두 같은 좌표**
//    (37.510744570761744, 126.80629384935709) 였다.
//  건물명이 같으니 C-4 규칙에 안 걸린다. 하지만 한 단지의 네 동이 한 점일 수는 없다.
//  (그 동들은 VWorld 상 1단지 계열로 보인다 — 2단지 주소에 남의 동이 붙은 것.)
//
//  판정: 같은 `coord_key` 안에서 **좌표가 같은 동이 2개 이상**이면 그 그룹 전부 못 믿는다.
//  ★지우지 않는다. `matched='suspect'` 로 낮춘다 — pickTrustedDong 이 'dong' 만 채택하므로
//    즉시 배송 경로에서 빠지고, 원본은 재검증용으로 남는다.
//
//  같은 개념을 구 캐시(address_geocode_cache)에도 적용한다 — 이관 원본이 거기이므로
//  거기를 안 고치면 재조회 때 같은 값이 다시 들어온다.
//
//  기본 dry-run. 쓰기는 --apply 를 붙였을 때만.
// ══════════════════════════════════════════════════════════════════
import { config } from '../src/config.js';
import { closePool, withClient } from '../src/db.js';

const APPLY = process.argv.includes('--apply');
const S = config.dbSchema;
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const out = (l, v) => console.log(`${String(l).padEnd(50)} ${v}`);

// 구 캐시 키 = `dong:{도로키}#{동번호}#{단지키}#v3` → 도로키+단지키가 "같은 건물" 단위.
const ROAD_PART = "split_part(cache_key, '#', 1)";
const COMPLEX_PART = "split_part(cache_key, '#', 3)";

await withClient(async (c) => {
  await c.query(`SET search_path TO ${S}, public`);
  console.log(`══ C-4-c 같은 좌표를 공유하는 동 격리 (${APPLY ? '실제' : '예행'}) ══`);

  // ── ① building_dong_coord ────────────────────────────────────────
  console.log('\n── ① building_dong_coord ──');
  const { rows: tot } = await c.query(`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE matched = 'dong')::int AS trusted
    FROM ${S}.building_dong_coord`);
  out('전체 행 / 그중 matched=dong', `${num(tot[0].n)} / ${num(tot[0].trusted)}`);

  const { rows: grp } = await c.query(`
    SELECT d.coord_key, d.lat, d.lng, count(*)::int AS dongs,
           array_agg(d.dong_no ORDER BY d.dong_no) AS dong_list,
           max(b.road_address) AS road_address, max(b.building_name) AS building_name
    FROM ${S}.building_dong_coord d JOIN ${S}.building_coord b USING (coord_key)
    WHERE d.matched = 'dong'
    GROUP BY d.coord_key, d.lat, d.lng
    HAVING count(*) > 1
    ORDER BY count(*) DESC`);
  const affected = grp.reduce((n, g) => n + g.dongs, 0);
  out('★한 점에 동이 2개 이상인 그룹', num(grp.length));
  out('  그 그룹에 속한 동 행', num(affected));
  console.log('\n  최다 표본(최대 6그룹):');
  for (const g of grp.slice(0, 6)) {
    console.log(`    ${g.road_address} | ${g.building_name || '-'}`);
    console.log(`      ${g.lat},${g.lng} ← 동 ${g.dongs}개: ${(g.dong_list || []).join(', ')}`);
  }

  // ── ② address_geocode_cache (이관 원본) ──────────────────────────
  console.log('\n── ② address_geocode_cache (구 캐시 · 이관 원본) ──');
  const { rows: cgrp } = await c.query(`
    SELECT ${ROAD_PART} AS road_key, ${COMPLEX_PART} AS complex_key, lat, lng,
           count(*)::int AS dongs, array_agg(dong_no ORDER BY dong_no) AS dong_list,
           max(standard_road_address) AS road_address
    FROM ${S}.address_geocode_cache
    WHERE cache_key LIKE 'dong:%' AND lat IS NOT NULL AND match_type IS DISTINCT FROM 'suspect'
    GROUP BY ${ROAD_PART}, ${COMPLEX_PART}, lat, lng
    HAVING count(*) > 1
    ORDER BY count(*) DESC`);
  const caffected = cgrp.reduce((n, g) => n + g.dongs, 0);
  out('★한 점에 동이 2개 이상인 그룹', num(cgrp.length));
  out('  그 그룹에 속한 캐시 행', num(caffected));
  for (const g of cgrp.slice(0, 4)) {
    console.log(`    ${g.road_address} | 동 ${g.dongs}개: ${(g.dong_list || []).join(', ')}`);
  }

  if (!APPLY) {
    console.log('\n  ※ 예행이라 DB는 바뀌지 않았습니다. 실제 적용은 --apply');
    console.log('  ※ 적용해도 좌표는 지우지 않습니다 — matched/match_type 만 suspect 로 낮춥니다.');
    return;
  }

  const r1 = await c.query(`
    UPDATE ${S}.building_dong_coord d SET matched = 'suspect', updated_at = now()
    WHERE d.matched = 'dong'
      AND (d.coord_key, d.lat, d.lng) IN (
        SELECT coord_key, lat, lng FROM ${S}.building_dong_coord
        WHERE matched = 'dong'
        GROUP BY coord_key, lat, lng HAVING count(*) > 1)`);
  const r2 = await c.query(`
    UPDATE ${S}.address_geocode_cache g SET match_type = 'suspect'
    WHERE g.cache_key LIKE 'dong:%' AND g.lat IS NOT NULL AND g.match_type IS DISTINCT FROM 'suspect'
      AND (${ROAD_PART}, ${COMPLEX_PART}, g.lat, g.lng) IN (
        SELECT ${ROAD_PART}, ${COMPLEX_PART}, lat, lng FROM ${S}.address_geocode_cache
        WHERE cache_key LIKE 'dong:%' AND lat IS NOT NULL
        GROUP BY ${ROAD_PART}, ${COMPLEX_PART}, lat, lng HAVING count(*) > 1)`);

  console.log('\n══ 적용 결과 ══');
  out('  building_dong_coord suspect 강등', num(r1.rowCount));
  out('  address_geocode_cache suspect 강등', num(r2.rowCount));

  const { rows: after } = await c.query(`
    SELECT count(*) FILTER (WHERE matched = 'dong')::int AS trusted,
           count(*) FILTER (WHERE matched = 'suspect')::int AS suspect
    FROM ${S}.building_dong_coord`);
  out('  남은 신뢰 동 좌표(matched=dong)', num(after[0].trusted));
  out('  격리된 동 좌표(suspect)', num(after[0].suspect));

  // 재실행 시 0 이어야 한다 — 아니면 판정이 불안정하다는 뜻이다.
  const { rows: left } = await c.query(`
    SELECT count(*)::int AS n FROM ${S}.building_dong_coord d
    WHERE d.matched = 'dong'
      AND (d.coord_key, d.lat, d.lng) IN (
        SELECT coord_key, lat, lng FROM ${S}.building_dong_coord
        WHERE matched = 'dong'
        GROUP BY coord_key, lat, lng HAVING count(*) > 1)`);
  out('  ★잔여 오염(0이어야 함)', num(left[0].n));
}).finally(closePool);
