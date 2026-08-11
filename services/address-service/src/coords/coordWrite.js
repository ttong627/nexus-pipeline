// ══════════════════════════════════════════════════════════════════
//  C-3 좌표 채움 실행부 — 설계서 좌표관리_설계.md §3-2·§3-3
//
//  ★판정은 여기 없다. 전부 coordFill.js(순수)가 한다. 여기는 **DB·외부 API 배선**만
//    담당한다. 규칙과 배선을 섞으면 규칙을 API 키 없이 회귀로 고정할 수 없다.
//
//  ★정제 화면은 이 경로를 절대 타면 안 된다(F10). 진입 통제는 server.js 의
//    mode 분기와 회귀(db-guard.test.mjs)가 맡는다.
// ══════════════════════════════════════════════════════════════════
import { config } from '../config.js';
import { query } from '../db.js';
import { findEntrance } from '../delivery/resolveDelivery.js';
import { geocodeRoad, getBuildingsNear } from '../vworld.js';
import { emptyOnMissingTable, resolveCoordKeys, loadCoordRows } from './coordQuery.js';
import { coordResolveEntry, normalizeDongNo, parseCoordKey, toDongNo } from './coordStore.js';
import {
  availableSources, buildCoordWrite, classifyFillTargets, createCoordFiller, createQuotaCounter,
} from './coordFill.js';

const S = config.dbSchema;

/** 설계서 §3-5 일일 상한. 여러 지자체를 하루에 몰아 돌리면 여기 걸린다(F7). */
export const DAILY_LIMITS = {
  vworld: Number(process.env.COORD_FILL_VWORLD_LIMIT || 20000),
  kakao: Number(process.env.COORD_FILL_KAKAO_LIMIT || 50000),
};

/**
 * 외부 API 동시성.
 *
 * ★기본 3을 넘기지 말 것. 2026-07-30·08-01 두 번 다 **배치 동시성이 운영 API 를 죽였다**
 *   (커넥션 풀 잠식 → /v1/address/match 가 10초 뒤 500). 좌표 채움도 같은 DB 를 쓴다.
 */
const CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.COORD_FILL_CONCURRENCY || 3)));

/** 한 번에 받는 최대 건수. 큰 명단은 나눠 보내야 Cloud SQL 1 vCPU 가 버틴다. */
export const MAX_FILL_PER_CALL = Math.max(1, Number(process.env.COORD_FILL_MAX || 200));

/** Kakao 주소검색 — VWorld 가 실패했을 때의 ④폴백(설계서 §3-2). */
const kakaoGeocode = async (roadAddress) => {
  if (!config.kakaoRestKey || !roadAddress) return null;
  try {
    const url = new URL('https://dapi.kakao.com/v2/local/search/address.json');
    url.searchParams.set('query', roadAddress);
    url.searchParams.set('size', '1');
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${config.kakaoRestKey}` } });
    const doc = res.ok ? (await res.json()).documents?.[0] : null;
    if (!doc?.y || !doc?.x) return null;
    return { lat: Number.parseFloat(doc.y), lng: Number.parseFloat(doc.x) };
  } catch (error) {
    console.error('[coords] kakaoGeocode 실패:', error.message);
    return null;
  }
};

/**
 * 출입구 좌표 조회 — 아직 `entrance_core` 가 없다(2026-08-11 실측: 테이블 자체가 없음).
 *
 * ★없다고 500 을 내면 좌표 채움 전체가 멈춘다. 없으면 **없다고** 답하고 ③으로 넘어간다.
 *   테이블이 생기는 순간(C-7) 코드 변경 없이 이 경로가 살아난다.
 */
const lookupEntrance = async (target) => {
  const anchor = parseCoordKey(target.coordKey);
  if (!anchor) return null;
  return emptyOnMissingTable('entrance', () => findEntrance(query, S, {
    addressMgtNo: null,
    roadCode: anchor.roadCode,
    undergroundYn: anchor.undergroundYn,
    mainNo: anchor.buildingMainNo,
    subNo: anchor.buildingSubNo,
    legalDongCode: null,
  }));
};

/**
 * 건물 행 기록. **채운 자리만 덮어쓴다.**
 *
 * ★COALESCE 로 기존 값을 지키는 이유: 이번에 중심 좌표만 구했다고 예전에 확보한
 *   입구 좌표를 null 로 밀어 버리면, 더 좋은 좌표를 잃고 되돌릴 방법이 없다.
 * ★quality 는 좌표가 새로 생겼을 때만 올린다 — 'none' 이 기존 'unverified' 를 덮으면
 *   좌표가 있는데 없는 것처럼 보인다.
 */
export const writeCoordRow = async (w) => {
  if (!w) return 0;
  const anchor = parseCoordKey(w.coordKey);
  if (!anchor) return 0;
  const gotPoint = w.entranceLat != null || w.centerLat != null;
  const { rowCount } = await query(`
    INSERT INTO ${S}.building_coord (
      coord_key, road_code, underground_yn, building_main_no, building_sub_no,
      road_address, sigungu, legal_emd, building_name, is_apartment,
      entrance_lat, entrance_lng, entrance_source, entrance_at,
      center_lat, center_lng, center_source, center_at, quality
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
              $11,$12,$13, CASE WHEN $11::double precision IS NULL THEN NULL ELSE now() END,
              $14,$15,$16, CASE WHEN $14::double precision IS NULL THEN NULL ELSE now() END, $17)
    ON CONFLICT (coord_key) DO UPDATE SET
      road_address  = CASE WHEN coalesce(EXCLUDED.road_address,'') <> '' THEN EXCLUDED.road_address
                           ELSE ${S}.building_coord.road_address END,
      sigungu       = coalesce(nullif(EXCLUDED.sigungu,''), ${S}.building_coord.sigungu),
      legal_emd     = coalesce(nullif(EXCLUDED.legal_emd,''), ${S}.building_coord.legal_emd),
      building_name = coalesce(nullif(EXCLUDED.building_name,''), ${S}.building_coord.building_name),
      is_apartment  = ${S}.building_coord.is_apartment OR EXCLUDED.is_apartment,
      entrance_lat    = coalesce(EXCLUDED.entrance_lat,    ${S}.building_coord.entrance_lat),
      entrance_lng    = coalesce(EXCLUDED.entrance_lng,    ${S}.building_coord.entrance_lng),
      entrance_source = coalesce(EXCLUDED.entrance_source, ${S}.building_coord.entrance_source),
      entrance_at     = coalesce(EXCLUDED.entrance_at,     ${S}.building_coord.entrance_at),
      center_lat      = coalesce(EXCLUDED.center_lat,      ${S}.building_coord.center_lat),
      center_lng      = coalesce(EXCLUDED.center_lng,      ${S}.building_coord.center_lng),
      center_source   = coalesce(EXCLUDED.center_source,   ${S}.building_coord.center_source),
      center_at       = coalesce(EXCLUDED.center_at,       ${S}.building_coord.center_at),
      quality = CASE WHEN $18 THEN EXCLUDED.quality ELSE ${S}.building_coord.quality END,
      updated_at = now()`,
  [w.coordKey, anchor.roadCode, anchor.undergroundYn, anchor.buildingMainNo, anchor.buildingSubNo,
    w.roadAddress, w.sigungu, w.legalEmd, w.buildingName, w.isApartment,
    w.entranceLat, w.entranceLng, w.entranceSource,
    w.centerLat, w.centerLng, w.centerSource, w.quality, gotPoint]);
  return rowCount || 0;
};

/** 동 좌표 기록 — acceptDongCandidate 를 통과한 것만 들어온다(matched='dong'). */
export const writeDongRows = async (coordKey, dongs = []) => {
  let n = 0;
  for (const d of dongs) {
    const no = normalizeDongNo(d.dongNo);
    if (!no || d.lat == null || d.lng == null) continue;
    const { rowCount } = await query(`
      INSERT INTO ${S}.building_dong_coord (coord_key, dong_no, lat, lng, floors, build_name, source, matched)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'dong')
      ON CONFLICT (coord_key, dong_no) DO UPDATE SET
        lat = EXCLUDED.lat, lng = EXCLUDED.lng,
        floors = coalesce(EXCLUDED.floors, ${S}.building_dong_coord.floors),
        build_name = coalesce(nullif(EXCLUDED.build_name,''), ${S}.building_dong_coord.build_name),
        matched = 'dong', updated_at = now()`,
    [coordKey, no, d.lat, d.lng, d.floors ?? null, d.buildName || '', d.source || 'vworld']);
    n += rowCount || 0;
  }
  return n;
};

/** 동시성 제한 실행 — 순서 보존. */
const mapPool = async (items, limit, fn) => {
  const out = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

/**
 * 채움 1회 실행 — 조회 → 대상 선별 → ②③④ 폴백 → 기록 → 재조회.
 *
 * ★끝에 다시 조회해서 돌려주는 이유: 방금 쓴 값을 **DB 에서 되읽어** 응답한다.
 *   메모리의 기대값을 돌려주면 "썼다고 했는데 실제로는 안 들어간" 경우를 못 잡는다.
 *   이번 사고(적재했다는 주장만 남고 테이블이 없던 것)가 정확히 그 종류다(F9).
 */
export const fillCoords = async (records, { version = config.activeVersion, quota = null } = {}) => {
  const q = quota || createQuotaCounter(DAILY_LIMITS);
  const keys = await resolveCoordKeys(records, version);
  const { byKey, dongsByKey } = await loadCoordRows(keys);
  const entries = records.map((record, i) => {
    const key = keys[i];
    const entry = coordResolveEntry(record, key ? byKey.get(key) || null : null, key ? dongsByKey.get(key) || [] : []);
    return key
      ? { ...entry, coordKey: entry.coordKey || key, record }
      : { ...entry, quality: 'no_anchor', record };
  });

  const { fill, skip } = classifyFillTargets(entries);
  // ★키가 없는 출처는 주입하지 않는다 — 주입하면 호출도 못 하면서 쿼터만 차감하고,
  //   요약이 "100건 썼다"고 거짓 보고한다(2026-08-11 첫 실행에서 실제로 그랬다).
  const sources = availableSources(config);
  const useVworld = sources.includes('vworld');
  const filler = createCoordFiller({
    findEntrance: lookupEntrance,
    geocodeRoad: useVworld ? geocodeRoad : null,
    getBuildingsNear: useVworld ? getBuildingsNear : null,
    kakaoGeocode: sources.includes('kakao') ? kakaoGeocode : null,
  });

  const stats = { attempted: fill.length, filled: 0, dongOnly: 0, none: 0, dongs: 0, carried: 0, bySource: {} };
  await mapPool(fill, CONCURRENCY, async (entry) => {
    const rec = entry.record || {};
    const dongNo = rec.dongNo || '';
    const target = {
      coordKey: entry.coordKey,
      roadAddress: rec.roadAddress || entry.roadAddress || '',
      buildingName: rec.buildingName || entry.buildingName || '',
      dongNo,
      // 동 번호가 붙어 온다는 것 자체가 단지형이라는 뜻이다(R4). 단독·상가엔 BBOX 를 안 태운다.
      isApartment: rec.isApartment ?? (entry.isApartment || Boolean(toDongNo(dongNo))),
      // 이미 확보한 중심이 있으면 그걸 BBOX 기준점으로 재사용한다 — 동 좌표만 필요해
      // 다시 온 건이 중심을 또 사면 호출이 두 배가 되고 답은 같다.
      knownCenter: entry.center || entry.entrance || null,
    };
    const got = await filler(target, q);
    if (got.carried.length) stats.carried += 1;
    const write = buildCoordWrite({
      coordKey: target.coordKey,
      roadAddress: target.roadAddress,
      sigungu: rec.sigungu || '',
      legalEmd: rec.legalEmd || '',
      buildingName: target.buildingName,
      isApartment: target.isApartment,
      point: got.point,
      source: got.source,
    });
    await emptyOnMissingTable('fill', async () => {
      await writeCoordRow(write);
      if (got.dongs.length) stats.dongs += await writeDongRows(target.coordKey, got.dongs);
      return true;
    });
    // ★"내비용 점을 새로 얻은 것"과 "동 좌표만 얻은 것"과 "아무것도 못 얻은 것"을
    //   나눠 센다. 동만 채운 건을 '못 구함'으로 세면 요약이 "0건 성공"이라 거짓말한다
    //   — 오늘 이미 두 번 겪은 유형이다(키 누락 은폐·BBOX 낭비).
    if (write?.quality !== 'none') {
      stats.filled += 1;
      stats.bySource[got.source] = (stats.bySource[got.source] || 0) + 1;
    } else if (got.dongs.length) {
      stats.dongOnly += 1;
    } else {
      stats.none += 1;
    }
  });

  // 방금 쓴 것을 DB 에서 되읽는다(F9).
  const { byKey: after, dongsByKey: dongAfter } = await loadCoordRows(keys);
  const coords = records.map((record, i) => {
    const key = keys[i];
    const entry = coordResolveEntry(record, key ? after.get(key) || null : null, key ? dongAfter.get(key) || [] : []);
    return key ? { ...entry, coordKey: entry.coordKey || key } : { ...entry, quality: 'no_anchor' };
  });

  return {
    coords,
    summary: {
      ...stats,
      // ★0% 가 나왔을 때 "채울 게 없었다"인지 "키가 없어 시도조차 못 했다"인지
      //   로그만 보고 갈리게 한다(F9).
      sources,
      skipped: skip.length,
      skipReasons: skip.reduce((acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] || 0) + 1 }), {}),
      quota: q.summary(),
    },
  };
};
