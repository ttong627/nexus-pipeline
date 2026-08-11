// ══════════════════════════════════════════════════════════════════
//  좌표 저장소 조회 (C-2) — 설계서 좌표관리_설계.md §3-4
//
//  ★조회 전용이다. 없으면 **없다고 답한다** — 외부 API를 태우지 않는다.
//    정제 화면이 이 경로를 쓰기 때문이다(F10: 정제 중 외부 API = 화면 정지).
//    채움(mode:'fill')은 C-3에서 배치·루트맵 전용으로 붙인다.
//
//  ★server.js 가 아니라 여기 두는 이유: 검증 스크립트가 **같은 코드**를 타야 한다.
//    스크립트가 로직을 베껴 쓰면 "검증 통과 · 운영 실패"가 난다(server.js 는
//    import 만으로 포트를 여는 진입점이라 스크립트가 불러올 수 없다).
// ══════════════════════════════════════════════════════════════════
import { config } from '../config.js';
import { query } from '../db.js';
import { cleanText, normalizeSearchKey, parseRoadNumber } from '../normalize.js';
import { sigunguToken } from '../learnedStore.js';
import { buildCoordKey, coordResolveEntry, pickRoadCode } from './coordStore.js';

const S = config.dbSchema;

/**
 * 좌표 테이블이 아직 없어도 서비스는 죽지 않는다.
 *
 * ★A-35에서 겪은 함정과 같다: 스키마 적용(Job)과 서비스 배포는 순서가 보장되지 않는다.
 *   테이블이 없다고 500을 내면 좌표와 무관한 화면까지 같이 멈춘다. 없으면 **없다고**
 *   답하고(quality='unknown'), 대신 로그를 남겨 적용 누락을 사람이 알아채게 한다.
 */
export const emptyOnMissingTable = async (label, run) => {
  try {
    return await run();
  } catch (error) {
    if (error?.code !== '42P01') throw error;
    console.warn(`[coords] ${label}: 좌표 테이블 없음(42P01) — sql/coords.sql 적용 필요`);
    return null;
  }
};

/**
 * 도로명주소 → coord_key. 시군구로 도로를 특정하지 못하면 **키를 만들지 않는다**(A-30·A-35).
 *
 * road_codes 를 쓰는 이유: 앵커에 필요한 건 road_code 하나인데, address_core 는
 * 77.5%가 결손이라(실측) 거기서 찾으면 대부분 앵커를 못 만든다. road_codes 는
 * 도로 대장이라 결손이 없다.
 */
export const resolveCoordKeys = async (records, version = config.activeVersion) => {
  const parsed = records.map((r) => {
    const road = cleanText(r?.roadAddress || r?.standardRoadAddress || '');
    const p = parseRoadNumber(road);
    return p ? { ...p, sigunguTok: sigunguToken(r?.sigungu || road) } : null;
  });
  const names = [...new Set(parsed.filter(Boolean).map((p) => normalizeSearchKey(p.roadName)))];
  if (!names.length) return parsed.map(() => '');

  const { rows } = await query(`
    SELECT road_name_key, sigungu, road_code
    FROM ${S}.road_codes
    WHERE version_id = $1 AND road_name_key = ANY($2::text[])
  `, [version, names]);
  const byRoad = new Map();
  for (const row of rows) {
    const list = byRoad.get(row.road_name_key) || [];
    list.push(row);
    byRoad.set(row.road_name_key, list);
  }
  return parsed.map((p) => {
    if (!p) return '';
    const roadCode = pickRoadCode(byRoad.get(normalizeSearchKey(p.roadName)) || [], p.sigunguTok);
    return roadCode ? buildCoordKey({ ...p, roadCode }) : '';
  });
};

/** coord_key 목록 → 건물 행·동 행. 두 번의 쿼리로 끝낸다(레코드마다 왕복하지 않는다). */
export const loadCoordRows = async (keys) => {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return { byKey: new Map(), dongsByKey: new Map() };
  const loaded = await emptyOnMissingTable('resolve', () => Promise.all([
    query(`SELECT * FROM ${S}.building_coord WHERE coord_key = ANY($1::text[])`, [unique]),
    query(`
      SELECT coord_key, dong_no, lat, lng, floors, matched, source
      FROM ${S}.building_dong_coord WHERE coord_key = ANY($1::text[])
    `, [unique]),
  ]));
  if (!loaded) return { byKey: new Map(), dongsByKey: new Map() };
  const [{ rows: bldRows }, { rows: dongRows }] = loaded;
  const byKey = new Map(bldRows.map((r) => [r.coord_key, r]));
  const dongsByKey = new Map();
  for (const d of dongRows) {
    const list = dongsByKey.get(d.coord_key) || [];
    list.push(d);
    dongsByKey.set(d.coord_key, list);
  }
  return { byKey, dongsByKey };
};

export const resolveCoords = async (records, version = config.activeVersion) => {
  const keys = await resolveCoordKeys(records, version);
  const { byKey, dongsByKey } = await loadCoordRows(keys);
  return records.map((record, i) => {
    const key = keys[i];
    const entry = coordResolveEntry(record, key ? byKey.get(key) || null : null, key ? dongsByKey.get(key) || [] : []);
    // 앵커를 못 만든 건은 저장소 문제가 아니라 **주소를 특정 못 한 것**이다.
    // 둘을 뭉뚱그리면 채움 배치가 영원히 헛돈다.
    return key ? { ...entry, coordKey: entry.coordKey || key } : { ...entry, quality: 'no_anchor' };
  });
};

/** 좌표 미보유가 남은 채로 순번을 돌리면 기사 구역이 찢어진다(F4·R-B) → 실행 전 확인용. */
export const coordStatus = async (sigungu = '') => {
  const tok = cleanText(sigungu);
  return emptyOnMissingTable('status', async () => {
    const { rows } = await query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE entrance_lat IS NOT NULL)::int AS with_entrance,
             count(*) FILTER (WHERE center_lat IS NOT NULL)::int   AS with_center,
             count(*) FILTER (WHERE quality = 'outlier')::int      AS outlier,
             count(*) FILTER (WHERE center_lat IS NULL AND entrance_lat IS NULL)::int AS no_point
      FROM ${S}.building_coord
      WHERE ($1 = '' OR sigungu ILIKE '%' || $1 || '%')
    `, [tok]);
    // ★'좌표 전무'와 '내비용 점만 없음'은 다르다. 동 좌표만 있는 건물(이관분 1,261건)을
    //   전무로 세면 C-3 채움이 끝나도 지표가 안 떨어져 완료 판정이 영원히 안 선다(F9).
    const { rows: bare } = await query(`
      SELECT count(*)::int AS n FROM ${S}.building_coord b
      WHERE b.center_lat IS NULL AND b.entrance_lat IS NULL
        AND ($1 = '' OR b.sigungu ILIKE '%' || $1 || '%')
        AND NOT EXISTS (
          SELECT 1 FROM ${S}.building_dong_coord d
          WHERE d.coord_key = b.coord_key AND d.matched = 'dong')
    `, [tok]);
    // matched='dong' 만 센다 — 격리분(suspect)을 보유로 세면 채움이 끝난 줄 안다.
    const { rows: dong } = await query(`
      SELECT count(*)::int AS dong_rows, count(DISTINCT d.coord_key)::int AS with_dong
      FROM ${S}.building_dong_coord d
      JOIN ${S}.building_coord b USING (coord_key)
      WHERE d.matched = 'dong' AND ($1 = '' OR b.sigungu ILIKE '%' || $1 || '%')
    `, [tok]);
    const { rows: pending } = await query(`
      SELECT road_address FROM ${S}.building_coord
      WHERE center_lat IS NULL AND entrance_lat IS NULL
        AND ($1 = '' OR sigungu ILIKE '%' || $1 || '%')
      ORDER BY updated_at DESC LIMIT 5
    `, [tok]);
    return {
      sigungu: tok,
      ...rows[0],
      ...dong[0],
      noCoordAtAll: bare[0].n,          // 입구·중심·동 전부 없음 = 진짜 미보유
      pendingSample: pending.map((p) => p.road_address),
    };
  });
};
