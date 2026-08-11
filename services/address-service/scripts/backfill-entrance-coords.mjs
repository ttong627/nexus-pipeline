#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  C-7 마지막 단계 — `entrance_core` 의 입구 좌표를 `building_coord` 입구 칸에 붙인다.
//
//  ★적재만으로는 안 붙는다(2026-08-11 실측): 642만 행을 `entrance_core` 에 넣었는데
//    `/v1/coords/status` 의 `with_entrance` 는 **0** 이었다. 두 테이블은 별개다.
//    채움 경로(`fillCoords`)가 ②단계에서 `findEntrance` 로 붙이긴 하지만, 이미 중심 좌표를
//    가진 건물은 `classifyFillTargets` 가 `cached` 로 건너뛴다 — **기존 37,064건은
//    영영 입구 좌표를 못 받는다.** 그래서 한 번은 SQL 로 이어 줘야 한다.
//
//  ★외부 API 를 쓰지 않는다. 앵커(도로코드·지하여부·본번·부번) 조인 한 번이다.
//  ★F1 준수: 입구 칸에 들어가는 출처는 `juso_entrc` 뿐이다. 지오코딩 결과는 절대 못 들어온다.
//  ★기본 dry-run. 쓰기는 --apply.
//
//  사용:
//    node scripts/backfill-entrance-coords.mjs            # 예행(조인 성공률만 실측)
//    node scripts/backfill-entrance-coords.mjs --apply
// ══════════════════════════════════════════════════════════════════
import { config } from '../src/config.js';
import { closePool, withClient } from '../src/db.js';

const APPLY = process.argv.includes('--apply');
const S = config.dbSchema;
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const out = (l, v) => console.log(`${String(l).padEnd(46)} ${v}`);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');

/**
 * 앵커 하나에 `entrance_core` 행이 여럿일 수 있다(법정동코드가 PK 에 들어 있다).
 * ★DISTINCT ON 으로 **하나만** 고른다. 안 그러면 같은 건물이 여러 번 UPDATE 되면서
 *   마지막 것이 남는데, 그 "마지막"이 무엇인지는 아무도 정하지 않은 값이 된다.
 *   좌표가 있는 것 → 검증 통과한 것 → 출입구번호 순으로 안정적으로 고른다.
 */
const PICK = `
  SELECT DISTINCT ON (road_code, underground_yn, building_main_no, building_sub_no)
         road_code, underground_yn, building_main_no, building_sub_no, lat, lng
  FROM ${S}.entrance_core
  WHERE lat IS NOT NULL AND is_retired = false
  ORDER BY road_code, underground_yn, building_main_no, building_sub_no,
           (coord_status = 'ok') DESC, entrance_no NULLS LAST`;

await withClient(async (c) => {
  await c.query(`SET search_path TO ${S}, public`);
  console.log(`══ C-7 입구 좌표 붙이기 (${APPLY ? '실제' : '예행'}) ══`);

  const { rows: before } = await c.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE entrance_lat IS NOT NULL)::int AS with_entrance
    FROM ${S}.building_coord`);
  out('building_coord 전체', num(before[0].total));
  out('  이미 입구 좌표 보유', num(before[0].with_entrance));

  const { rows: src } = await c.query(`SELECT count(*)::int AS n FROM ${S}.entrance_core WHERE lat IS NOT NULL`);
  out('entrance_core 좌표 보유 행', num(src[0].n));

  // 조인 성공률 — "적재했다"가 아니라 "실제로 이어졌다"를 센다(설계서 §6·F9).
  const { rows: match } = await c.query(`
    SELECT count(*)::int AS n FROM ${S}.building_coord b
    WHERE EXISTS (
      SELECT 1 FROM ${S}.entrance_core e
      WHERE e.road_code = b.road_code AND e.underground_yn = b.underground_yn
        AND e.building_main_no = b.building_main_no AND e.building_sub_no = b.building_sub_no
        AND e.lat IS NOT NULL AND e.is_retired = false)`);
  out('★앵커가 이어지는 건물', `${num(match[0].n)} / ${num(before[0].total)} (${pct(match[0].n, before[0].total)})`);

  if (!APPLY) {
    const { rows: sample } = await c.query(`
      WITH pick AS (${PICK})
      SELECT b.road_address, b.building_name, p.lat, p.lng, b.center_lat, b.center_lng
      FROM ${S}.building_coord b JOIN pick p
        ON p.road_code = b.road_code AND p.underground_yn = b.underground_yn
       AND p.building_main_no = b.building_main_no AND p.building_sub_no = b.building_sub_no
      WHERE b.entrance_lat IS NULL LIMIT 5`);
    console.log('\n  샘플(입구 ↔ 기존 중심 — 지도에서 대조):');
    for (const s of sample) {
      console.log(`    ${s.road_address} | ${s.building_name || '-'}`);
      console.log(`      입구 ${s.lat},${s.lng}   중심 ${s.center_lat},${s.center_lng}`);
    }
    console.log('\n  ※ 예행이라 DB는 바뀌지 않았습니다. 실제 적용은 --apply');
    return;
  }

  // ★entrance_* 만 쓴다. 중심 좌표·품질은 건드리지 않는다.
  //   quality 는 좌표를 새로 얻었을 때만 'none' → 'unverified' 로 올린다(없던 점이 생겼으므로).
  const { rowCount } = await c.query(`
    WITH pick AS (${PICK})
    UPDATE ${S}.building_coord b
    SET entrance_lat = p.lat, entrance_lng = p.lng,
        entrance_source = 'juso_entrc', entrance_at = now(),
        quality = CASE WHEN b.quality = 'none' THEN 'unverified' ELSE b.quality END,
        updated_at = now()
    FROM pick p
    WHERE p.road_code = b.road_code AND p.underground_yn = b.underground_yn
      AND p.building_main_no = b.building_main_no AND p.building_sub_no = b.building_sub_no
      AND b.entrance_lat IS NULL`);
  out('\n입구 좌표를 새로 붙인 건물', num(rowCount));

  // 되읽기 — "썼다"가 아니라 "들어갔다"를 센다(F9).
  const { rows: after } = await c.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE entrance_lat IS NOT NULL)::int AS with_entrance,
           count(*) FILTER (WHERE entrance_source = 'juso_entrc')::int AS from_juso,
           count(*) FILTER (WHERE center_lat IS NULL AND entrance_lat IS NULL)::int AS no_point
    FROM ${S}.building_coord`);
  console.log('\n══ DB 실측(되읽기) ══');
  out('  building_coord 전체', num(after[0].total));
  out('  ├ 입구 좌표 보유', `${num(after[0].with_entrance)} (${pct(after[0].with_entrance, after[0].total)})`);
  out('  ├ 그중 출처 juso_entrc', num(after[0].from_juso));
  out('  └ 좌표 전무', num(after[0].no_point));

  // 입구와 중심이 얼마나 떨어져 있나 — 둘 다 있는 건물로 실측한다.
  // ★이 값이 곧 "지금까지 기사에게 얼마나 어긋난 목적지를 줬는가"다.
  const { rows: gap } = await c.query(`
    SELECT count(*)::int AS n,
           round(avg(dist)::numeric, 1) AS avg_m,
           round(max(dist)::numeric, 1) AS max_m,
           count(*) FILTER (WHERE dist > 50)::int AS over50
    FROM (
      SELECT 6371000 * 2 * asin(sqrt(
               power(sin(radians(entrance_lat - center_lat) / 2), 2) +
               cos(radians(center_lat)) * cos(radians(entrance_lat)) *
               power(sin(radians(entrance_lng - center_lng) / 2), 2))) AS dist
      FROM ${S}.building_coord
      WHERE entrance_lat IS NOT NULL AND center_lat IS NOT NULL) t`);
  out('  입구↔중심 거리(둘 다 보유)', `${num(gap[0].n)}건 · 평균 ${gap[0].avg_m}m · 최대 ${gap[0].max_m}m · 50m 초과 ${num(gap[0].over50)}`);
}).finally(closePool);
