#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  C-4-b 구(舊) 동 좌표 캐시 오염 격리 — 설계서 좌표관리_설계.md
//
//  왜 필요한가: C-4 는 `building_dong_coord` 쪽 오염 375건만 격리했다. 그런데
//  `/v1/building/dong-coords` 는 **`address_geocode_cache` 의 `dong:*` 행을 먼저**
//  돌려준다. 그 행들은 오염을 만든 **옛 pickDong**(`|| byDong[0]` 폴백)이 만든 것이고,
//  `address_geocode_cache` 는 월 재적재 삭제 목록(resetVersionData)에도 없어서
//  **영구 잔존**한다. 즉 pickDong 을 고쳤어도 캐시 히트는 여전히 오염을 서빙한다.
//
//  판정(C-4 와 같은 기준): **같은 좌표가 단지명이 다른 여러 캐시 행에 붙어 있으면**
//  그 동 좌표는 못 믿는다. 한 점이 여러 단지의 동일 수는 없다.
//    실측 근거: `B동` 좌표 하나가 성암빌라·진아빌라·청양맨션·청정빌라·신한그린빌에
//    동시에 붙어 있었다(설계서 F3).
//
//  ★지우지 않는다. `match_type='suspect'` 로 낮춘다.
//    - 클라는 `matched === 'dong'` 만 채택하므로 즉시 배송 경로에서 빠진다
//    - 서버는 suspect 캐시를 **미스로 취급**해 고쳐진 규칙으로 다시 계산한다
//    - 원본 좌표는 남으므로 판단이 틀렸을 때 되돌릴 수 있다
//
//  기본 dry-run. 쓰기는 --apply 를 붙였을 때만.
// ══════════════════════════════════════════════════════════════════
import { config } from '../src/config.js';
import { closePool, withClient } from '../src/db.js';

const APPLY = process.argv.includes('--apply');
const S = config.dbSchema;
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const out = (l, v) => console.log(`${String(l).padEnd(48)} ${v}`);

// cache_key = `dong:{도로키}#{동번호}#{단지키}#v3` → 3번째 조각이 단지키.
// 빈 단지키는 세지 않는다: 같은 건물을 단지명 없이 한 번, 있이 한 번 조회하면
// 좌표가 같은 게 정상인데 그걸 오염으로 몰면 멀쩡한 캐시를 죽인다.
const COMPLEX = "NULLIF(split_part(cache_key, '#', 3), '')";

await withClient(async (c) => {
  await c.query(`SET search_path TO ${S}, public`);
  console.log(`══ C-4-b 구 동 좌표 캐시 격리 (${APPLY ? '실제' : '예행'}) ══`);

  const { rows: tot } = await c.query(`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE lat IS NOT NULL)::int AS with_coord,
           count(*) FILTER (WHERE match_type = 'suspect')::int AS already
    FROM ${S}.address_geocode_cache WHERE cache_key LIKE 'dong:%'`);
  out('dong:* 캐시 행', num(tot[0].n));
  out('  좌표 보유', num(tot[0].with_coord));
  out('  이미 suspect', num(tot[0].already));

  // 오염 그룹: 같은 좌표 + 단지키가 2개 이상
  const { rows: grp } = await c.query(`
    SELECT lat, lng, count(*)::int AS rows_n, count(DISTINCT ${COMPLEX})::int AS complexes,
           array_agg(DISTINCT ${COMPLEX}) FILTER (WHERE ${COMPLEX} IS NOT NULL) AS names
    FROM ${S}.address_geocode_cache
    WHERE cache_key LIKE 'dong:%' AND lat IS NOT NULL AND match_type IS DISTINCT FROM 'suspect'
    GROUP BY lat, lng
    HAVING count(DISTINCT ${COMPLEX}) > 1
    ORDER BY count(*) DESC`);

  const affected = grp.reduce((n, g) => n + g.rows_n, 0);
  console.log('\n══ 오염 판정 ══');
  out('  같은 좌표 · 단지명 다름 (그룹)', num(grp.length));
  out('  그 그룹에 속한 캐시 행', num(affected));
  console.log('\n  최다 오염 표본(최대 5그룹):');
  for (const g of grp.slice(0, 5)) {
    console.log(`    ${g.lat},${g.lng} — ${g.rows_n}행 / 단지 ${g.complexes}종: ${(g.names || []).slice(0, 6).join(', ')}`);
  }

  if (!APPLY) {
    console.log('\n  ※ 예행이라 DB는 바뀌지 않았습니다. 실제 적용은 --apply');
    console.log('  ※ 적용해도 좌표는 지우지 않습니다 — match_type 만 suspect 로 낮춥니다.');
    return;
  }

  const { rowCount } = await c.query(`
    UPDATE ${S}.address_geocode_cache SET match_type = 'suspect'
    WHERE cache_key LIKE 'dong:%' AND lat IS NOT NULL AND match_type IS DISTINCT FROM 'suspect'
      AND (lat, lng) IN (
        SELECT lat, lng FROM ${S}.address_geocode_cache
        WHERE cache_key LIKE 'dong:%' AND lat IS NOT NULL
        GROUP BY lat, lng HAVING count(DISTINCT ${COMPLEX}) > 1)`);

  console.log('\n══ 적용 결과 ══');
  out('  suspect 로 강등', num(rowCount));
  const { rows: after } = await c.query(`
    SELECT count(*) FILTER (WHERE match_type = 'suspect')::int AS suspect,
           count(*) FILTER (WHERE match_type IS DISTINCT FROM 'suspect')::int AS trusted
    FROM ${S}.address_geocode_cache WHERE cache_key LIKE 'dong:%' AND lat IS NOT NULL`);
  out('  격리 후 suspect', num(after[0].suspect));
  out('  남은 신뢰 캐시', num(after[0].trusted));

  // 재실행 시 0 이어야 한다 — 아니면 판정이 불안정하다는 뜻이다.
  const { rows: left } = await c.query(`
    SELECT count(*)::int AS n FROM ${S}.address_geocode_cache
    WHERE cache_key LIKE 'dong:%' AND lat IS NOT NULL AND match_type IS DISTINCT FROM 'suspect'
      AND (lat, lng) IN (
        SELECT lat, lng FROM ${S}.address_geocode_cache
        WHERE cache_key LIKE 'dong:%' AND lat IS NOT NULL
        GROUP BY lat, lng HAVING count(DISTINCT ${COMPLEX}) > 1)`);
  out('  ★잔여 오염(0이어야 함)', num(left[0].n));
}).finally(closePool);
