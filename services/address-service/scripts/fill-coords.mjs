#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  C-3 좌표 채움 실행기 — 설계서 좌표관리_설계.md §3-2·§6
//
//  하는 일:
//    ① 좌표 미보유 건물(building_coord 에 행은 있으나 입구·중심 둘 다 없음)을 꺼내
//    ② ②출입구자료 → ③VWorld(+아파트면 동) → ④Kakao 폴백으로 채우고
//    ③ 채움률·출처 분포·앵커 일치를 **로그로 남긴다** (증거 없이는 완료가 아니다)
//
//  기본 dry-run. 외부 API 호출과 쓰기는 --apply 를 붙였을 때만.
//
//  ★앵커 왕복을 매번 센다: 이 스크립트는 저장된 road_address 로 키를 **다시** 만든다.
//    저장된 키와 어긋나면 같은 건물에 행이 두 개 생기면서도 에러가 안 난다(A-35 유형).
// ══════════════════════════════════════════════════════════════════
import { config } from '../src/config.js';
import { closePool, query, withClient } from '../src/db.js';
import { fillCoords, DAILY_LIMITS } from '../src/coords/coordWrite.js';
import { availableSources, classifyFillTargets, createQuotaCounter } from '../src/coords/coordFill.js';
import { resolveCoordKeys } from '../src/coords/coordQuery.js';
import { coordResolveEntry } from '../src/coords/coordStore.js';

const arg = (name, dflt = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const APPLY = process.argv.includes('--apply');
const LIMIT = Math.max(1, Number(arg('limit', '100')));
const SIGUNGU = arg('sigungu', '');
const S = config.dbSchema;
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const out = (l, v) => console.log(`${String(l).padEnd(46)} ${v}`);

await withClient(async (c) => {
  await c.query(`SET search_path TO ${S}, public`);

  console.log(`══ C-3 좌표 채움 (${APPLY ? '실제' : '예행'}) · 최대 ${num(LIMIT)}건${SIGUNGU ? ` · ${SIGUNGU}` : ''} ══`);

  // ★선행 차단(2026-08-11 실측): 키 없이 돌렸더니 채움률 0% 가 나왔고, 그 0% 가
  //   "이 주소들은 좌표가 원래 없다"처럼 보였다. 출처가 없으면 시작조차 하지 않는다(F9).
  const sources = availableSources(config);
  out('쓸 수 있는 출처', sources.length ? sources.join(', ') : '(없음)');
  if (!sources.length) {
    console.log('\n⛔ VWORLD_KEY·KAKAO_REST_KEY 가 하나도 없습니다. 채움을 시작하지 않습니다.');
    console.log('   Job 이라면 --set-secrets 로 ADDRESS_VWORLD_KEY·ADDRESS_KAKAO_REST_KEY 를 주입하세요.');
    process.exitCode = 2;
    return;
  }

  // ① 대상 — 입구·중심 둘 다 없는 건물. 동 좌표만 있는 건(C-4 이관분)도 여기 포함된다:
  //    동 좌표는 순번용이고 내비용 점이 아직 없기 때문이다.
  const { rows: targets } = await c.query(`
    SELECT coord_key, road_address, sigungu, legal_emd, building_name, is_apartment
    FROM ${S}.building_coord
    WHERE center_lat IS NULL AND entrance_lat IS NULL
      AND ($1 = '' OR sigungu ILIKE '%' || $1 || '%')
    ORDER BY updated_at ASC
    LIMIT $2`, [SIGUNGU, LIMIT]);
  out('대상(입구·중심 둘 다 없음)', num(targets.length));
  if (!targets.length) {
    console.log('\n채울 대상이 없습니다.');
    return;
  }

  const records = targets.map((t) => ({
    roadAddress: t.road_address,
    sigungu: t.sigungu || '',
    legalEmd: t.legal_emd || '',
    buildingName: t.building_name || '',
    isApartment: t.is_apartment === true,
  }));

  // ② 앵커 왕복 — 저장된 키와 다시 만든 키가 같은가 (같아야 같은 행을 갱신한다)
  const keys = await resolveCoordKeys(records, config.activeVersion);
  let sameKey = 0; let lostKey = 0; let diffKey = 0;
  const drift = [];
  targets.forEach((t, i) => {
    if (!keys[i]) { lostKey += 1; return; }
    if (keys[i] === t.coord_key) { sameKey += 1; return; }
    diffKey += 1;
    if (drift.length < 5) drift.push(`${t.road_address}  저장=${t.coord_key}  재생성=${keys[i]}`);
  });
  console.log('\n══ ② 앵커 왕복 ══');
  out('  저장된 키와 일치', `${num(sameKey)} / ${num(targets.length)}`);
  out('  키를 다시 못 만듦(주소DB 미등재)', num(lostKey));
  out('  ★키가 달라짐(행 중복 위험)', num(diffKey));
  for (const d of drift) console.log(`     ${d}`);
  if (diffKey > 0 && APPLY) {
    console.log('\n⛔ 앵커가 어긋난 건이 있어 중단합니다. 같은 건물에 행이 둘 생깁니다.');
    console.log('   먼저 왜 달라지는지 확인하세요(road_codes 후보 중복·시군구 토큰 등).');
    return;
  }

  if (!APPLY) {
    // 예행에서는 외부 API 를 부르지 않는다 — 무엇이 대상인지만 보여준다.
    const entries = records.map((r, i) => {
      const e = coordResolveEntry(r, null, []);
      return keys[i] ? { ...e, coordKey: keys[i], quality: 'unknown' } : { ...e, quality: 'no_anchor' };
    });
    const { fill, skip } = classifyFillTargets(entries);
    console.log('\n══ ③ 예행 결과 ══');
    out('  채움 시도 대상', num(fill.length));
    out('  건너뜀', num(skip.length));
    const q = createQuotaCounter(DAILY_LIMITS);
    out('  예상 VWorld 호출(지오코딩+아파트 BBOX)',
      num(fill.reduce((n, f, i) => n + 1 + (records[i]?.isApartment ? 1 : 0), 0)));
    out('  일일 한도', `vworld ${num(q.remaining('vworld'))} · kakao ${num(q.remaining('kakao'))}`);
    console.log('\n  샘플(대상 5건):');
    for (const f of fill.slice(0, 5)) console.log(`    ${f.roadAddress}`);
    console.log('\n  ※ 예행이라 외부 API 호출도 DB 쓰기도 없었습니다. 실제 실행은 --apply');
    return;
  }

  // ③ 실제 채움
  console.log('\n══ ③ 채움 실행 ══');
  const started = Date.now();
  const { coords, summary } = await fillCoords(records, { version: config.activeVersion });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  const filledNow = coords.filter((x) => x.center || x.entrance).length;
  out('  시도', num(summary.attempted));
  out('  좌표 확보', `${num(summary.filled)} (${(summary.filled / Math.max(1, summary.attempted) * 100).toFixed(1)}%)`);
  out('  못 구함(quality=none)', num(summary.none));
  out('  동 좌표 기록', num(summary.dongs));
  out('  쿼터 소진으로 이월', num(summary.carried));
  out('  건너뜀', `${num(summary.skipped)} ${JSON.stringify(summary.skipReasons)}`);
  out('  출처 분포', JSON.stringify(summary.bySource));
  out('  쿼터 사용', JSON.stringify(summary.quota));
  out('  소요', `${secs}초`);

  // ④ DB 되읽기 — "썼다"가 아니라 "들어갔다"를 센다(F9)
  console.log('\n══ ④ DB 실측(되읽기) ══');
  out('  응답에 좌표가 담긴 건', `${num(filledNow)} / ${num(coords.length)}`);
  const { rows: after } = await query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE center_lat IS NOT NULL)::int AS with_center,
           count(*) FILTER (WHERE entrance_lat IS NOT NULL)::int AS with_entrance,
           count(*) FILTER (WHERE quality = 'none')::int AS none
    FROM ${S}.building_coord
    WHERE ($1 = '' OR sigungu ILIKE '%' || $1 || '%')`, [SIGUNGU]);
  out('  building_coord 전체', num(after[0].total));
  out('  ├ 중심 좌표 보유', num(after[0].with_center));
  out('  ├ 입구 좌표 보유', num(after[0].with_entrance));
  out('  └ quality=none', num(after[0].none));

  const { rows: sample } = await query(`
    SELECT road_address, building_name, center_lat, center_lng, center_source, quality
    FROM ${S}.building_coord
    WHERE center_lat IS NOT NULL AND ($1 = '' OR sigungu ILIKE '%' || $1 || '%')
    ORDER BY updated_at DESC LIMIT 5`, [SIGUNGU]);
  console.log('\n  샘플(육안 확인용 — 지도에서 대조):');
  for (const s of sample) {
    console.log(`    ${s.road_address} | ${s.building_name || '-'} | ${s.center_lat},${s.center_lng} | ${s.center_source}`);
  }
}).finally(closePool);
