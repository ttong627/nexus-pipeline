#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  C-1 좌표 스키마 적용 + C-4 기존 동(棟) 좌표 이관 (형 지시 2026-08-11)
//  설계서: 좌표관리_설계.md
//
//  하는 일:
//    ① sql/coords.sql 적용 (building_coord · building_dong_coord)
//    ② address_geocode_cache 의 dong:* 행(실측 2,375건)을 building_dong_coord 로 이관
//       ★원본은 지우지 않는다. 이관이 틀렸을 때 되돌릴 근거가 사라진다.
//    ③ 이관 전후 건수 대조 + 샘플 좌표 동일 확인 (증거 없이는 완료가 아니다)
//
//  기본 dry-run. 쓰기는 --apply 를 붙였을 때만.
// ══════════════════════════════════════════════════════════════════
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { closePool, withClient } from '../src/db.js';
import { buildCoordKey, normalizeDongNo } from '../src/coords/coordStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const S = config.dbSchema;
const V = config.activeVersion;
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const out = (l, v) => console.log(`${String(l).padEnd(44)} ${v}`);

await withClient(async (c) => {
  await c.query(`SET search_path TO ${S}, public`);

  console.log(`══ ① 스키마 적용 (${APPLY ? '실제' : '예행'}) ══`);
  if (APPLY) {
    await c.query(await readFile(join(here, '..', 'sql', 'coords.sql'), 'utf8'));
    out('sql/coords.sql', '적용 완료');
  } else {
    out('sql/coords.sql', '예행 — 적용 안 함');
  }
  const exists = async (t) => (await c.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`${S}.${t}`])).rows[0]?.ok === true;
  for (const t of ['building_coord', 'building_dong_coord']) {
    out(`  ${t}`, await exists(t) ? '존재' : '없음');
  }
  if (!await exists('building_dong_coord')) {
    console.log('\n테이블이 아직 없어 이관을 건너뜁니다. --apply 로 다시 실행하세요.');
    return;
  }

  console.log('\n══ ② 이관 대상 실측 ══');
  const { rows: src } = await c.query(`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE lat IS NOT NULL AND dong_no IS NOT NULL)::int AS usable
    FROM ${S}.address_geocode_cache WHERE cache_key LIKE 'dong:%'`);
  out('  address_geocode_cache dong:* 행', num(src[0].n));
  out('  좌표+동번호 모두 있는 행(이관 가능)', num(src[0].usable));

  const { rows: before } = await c.query(`SELECT count(*)::int AS n FROM ${S}.building_dong_coord`);
  out('  building_dong_coord 이관 전', num(before[0].n));

  // 동 좌표 원본을 도로명주소로 되짚어 road_code·본번-부번(=앵커)을 찾는다.
  //   ★address_core 결손(77.5%) 때문에 building_core 도 함께 본다.
  const { rows: cand } = await c.query(`
    SELECT g.cache_key, g.standard_road_address, g.lat, g.lng, g.dong_no, g.floors, g.provider,
           coalesce(a.road_code, b.road_code)               AS road_code,
           coalesce(a.underground_yn, b.underground_yn,'0') AS underground_yn,
           coalesce(a.building_main_no, b.building_main_no) AS main_no,
           coalesce(a.building_sub_no, b.building_sub_no,0) AS sub_no,
           coalesce(a.road_address, b.road_address, g.standard_road_address) AS road_address,
           coalesce(a.sigungu, b.sigungu)                   AS sigungu,
           coalesce(a.legal_emd, b.legal_emd)               AS legal_emd,
           coalesce(nullif(a.building_name,''), b.building_name) AS building_name
    FROM ${S}.address_geocode_cache g
    LEFT JOIN ${S}.address_core  a ON a.version_id = $1 AND a.road_address = g.standard_road_address
    LEFT JOIN ${S}.building_core b ON b.version_id = $1 AND b.road_address = g.standard_road_address
    WHERE g.cache_key LIKE 'dong:%' AND g.lat IS NOT NULL AND g.dong_no IS NOT NULL`, [V]);

  let mapped = 0; let unmapped = 0; let wroteBld = 0; let wroteDong = 0;
  for (const r of cand) {
    const key = buildCoordKey({
      roadCode: r.road_code, undergroundYn: r.underground_yn,
      buildingMainNo: r.main_no, buildingSubNo: r.sub_no,
    });
    if (!key) { unmapped++; continue; }
    mapped++;
    if (!APPLY) continue;
    // 건물 행 먼저(동 좌표의 부모). 중심 좌표는 여기서 채우지 않는다 —
    //   dong:* 캐시의 좌표는 **동 좌표**이지 건물 중심이 아니다(섞으면 안 된다).
    const bld = await c.query(`
      INSERT INTO ${S}.building_coord (
        coord_key, road_code, underground_yn, building_main_no, building_sub_no,
        road_address, sigungu, legal_emd, building_name, is_apartment, quality
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'unverified')
      ON CONFLICT (coord_key) DO UPDATE SET
        is_apartment = true,
        building_name = CASE WHEN coalesce(EXCLUDED.building_name,'') <> '' THEN EXCLUDED.building_name
                             ELSE ${S}.building_coord.building_name END,
        updated_at = now()`,
      [key, r.road_code, r.underground_yn || '0', r.main_no, r.sub_no || 0,
        r.road_address, r.sigungu, r.legal_emd, r.building_name]);
    wroteBld += bld.rowCount || 0;
    const dong = await c.query(`
      INSERT INTO ${S}.building_dong_coord (coord_key, dong_no, lat, lng, floors, source, matched)
      VALUES ($1,$2,$3,$4,$5,$6,'dong')
      ON CONFLICT (coord_key, dong_no) DO UPDATE SET
        lat = EXCLUDED.lat, lng = EXCLUDED.lng,
        floors = coalesce(EXCLUDED.floors, ${S}.building_dong_coord.floors),
        updated_at = now()`,
      [key, normalizeDongNo(r.dong_no), r.lat, r.lng, r.floors, r.provider || 'vworld']);
    wroteDong += dong.rowCount || 0;
  }

  // ══ ②-B 오염 격리 (2026-08-11 실측으로 드러남) ══════════════════
  //  같은 좌표가 **건물명이 다른** 여러 건물에 붙어 있으면 그 동 좌표는 못 믿는다.
  //  실측 표본: B동 좌표 하나가 성암빌라·진아빌라·청양맨션·청정빌라·신한그린빌에
  //  동시에 붙어 있었다(빌라 6곳, 주소 6개). VWorld 동 매칭이 '가동'·'B동' 같은
  //  흔한 표기에서 주변의 **다른 건물**을 집은 것이다(설계서 F3).
  //  → 지우지 않고 matched='suspect' 로 낮춘다. pickDeliveryCoord 는 matched='dong'
  //    만 채택하므로 즉시 배송 경로에서 빠지고, 원본은 재검증용으로 남는다.
  if (APPLY) {
    const { rowCount } = await c.query(`
      UPDATE ${S}.building_dong_coord d SET matched = 'suspect', updated_at = now()
      WHERE (d.lat, d.lng) IN (
        SELECT x.lat, x.lng
        FROM ${S}.building_dong_coord x JOIN ${S}.building_coord b USING (coord_key)
        GROUP BY x.lat, x.lng
        HAVING count(DISTINCT regexp_replace(coalesce(b.building_name,''), '\\s', '', 'g')) > 1)
        AND d.matched <> 'suspect'`);
    console.log('\n══ ②-B 오염 격리 ══');
    out('  건물명이 다른데 좌표가 같음 → suspect 강등', num(rowCount));
  }

  console.log('\n══ ③ 이관 결과 ══');
  out('  앵커 확보(이관 가능)', num(mapped));
  out('  앵커 못 찾음(주소DB 미등재)', num(unmapped));
  if (APPLY) {
    out('  building_coord 기록', num(wroteBld));
    out('  building_dong_coord 기록', num(wroteDong));
    const { rows: after } = await c.query(`SELECT count(*)::int AS n FROM ${S}.building_dong_coord`);
    out('  building_dong_coord 이관 후', num(after[0].n));
    const { rows: sample } = await c.query(`
      SELECT d.coord_key, d.dong_no, d.lat, d.lng, d.floors, b.road_address
      FROM ${S}.building_dong_coord d JOIN ${S}.building_coord b USING (coord_key)
      ORDER BY d.updated_at DESC LIMIT 5`);
    console.log('\n  샘플(육안 확인용):');
    for (const s of sample) console.log(`    ${s.road_address} | ${s.dong_no}동 | ${s.lat},${s.lng} | ${s.floors}층`);
  } else {
    console.log('\n  ※ 예행이라 DB는 바뀌지 않았습니다. 실제 적용은 --apply');
  }
}).finally(closePool);
