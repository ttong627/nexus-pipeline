/**
 * 행안부 출입구 자료 적재기 — 파일 → entrance_core(버전 독립).
 *
 * 이 모듈이 반드시 해야 하는 두 가지 (없으면 만들 이유가 없다):
 *
 *   ① **이상좌표 격리** — 국가 원본에 바다로 떨어지는 좌표가 실재한다(전국 36건 실측).
 *      그대로 넣으면 배송지가 200km 밖이 된다. 판정은 coordGuard 가 하고, 여기서는
 *      격리된 좌표를 **본 테이블에 쓰지 않고** 격리표에 증거를 남긴다.
 *
 *   ② **폐지(이동사유 63) 반영** — yyplus 의 juso-sync 는 Deletion 을 아예 읽지 않아
 *      폐지된 주소가 영구히 남는다. 실측하면 일변동 63 건 중 1,099 건이 전체분에 실재한다.
 *      = 반영하지 않으면 없어진 주소 1,099 개를 계속 정상 주소로 안내한다는 뜻이다.
 *
 * 적용 순서(중요): 전체분(entrc → RNENTDATA) → 일변동(날짜 오름차순).
 *   전체분은 스냅샷이라 폐지보다 과거일 수 있다. 그래서 **전체분은 is_retired 를 건드리지
 *   않는다**. 폐지 해제는 일변동의 신규(31)·변동(34) 만 할 수 있다. 그렇게 하지 않으면
 *   월 재적재 때마다 폐지 주소가 되살아난다 — 고치려던 바로 그 버그다.
 */
import path from 'node:path';

import { CHANGE_DELETE, entranceKey, parseEntranceLine } from './entrcParser.js';
import { readEntranceLines } from './entrcReader.js';
import { tmToWgs84 } from '../shared/tmProjection.js';
import {
  COORD_NONE, COORD_OK, COORD_QUARANTINED,
  MIN_POINTS_EMD, MIN_POINTS_ROAD,
  createClusterIndex, judgeCoord, referenceKeys,
} from './coordGuard.js';

export const SOURCE_FULL_SUMMARY = 'full-summary';   // entrc_{시도}.txt (건물명·용도 보유)
export const SOURCE_FULL_LINK = 'full-link';         // RNENTDATA_*.txt (관리번호 보유)
export const SOURCE_DAILY = 'daily';                 // AlterD.JUSUEC.YYYYMMDD.*.TXT (이동사유)

/**
 * 파일명으로 자료 종류와 기준일을 판별한다.
 *
 * 기준일을 파일명에서 뽑는 이유: 자료 안에 기준일이 없는 파일이 있고(entrc_*),
 * 적용 순서를 사람이 손으로 정하면 언젠가 틀린다. RNENTDATA_2607 → 2026-07-01,
 * AlterD.JUSUEC.20260702 → 2026-07-02.
 *
 * @returns {{kind:string, sourceDate:string|null}|null} null = 출입구 자료가 아님
 */
export function classifySource(fileName) {
  const base = path.basename(fileName);
  if (!/\.txt$/i.test(base)) return null;

  if (/^entrc_/i.test(base)) return { kind: SOURCE_FULL_SUMMARY, sourceDate: null };

  const link = /^RNENTDATA_(\d{2})(\d{2})_/i.exec(base);
  if (link) return { kind: SOURCE_FULL_LINK, sourceDate: `20${link[1]}-${link[2]}-01` };

  const daily = /^AlterD\.JUSUEC\.(\d{4})(\d{2})(\d{2})\./i.exec(base);
  if (daily) return { kind: SOURCE_DAILY, sourceDate: `${daily[1]}-${daily[2]}-${daily[3]}` };

  if (/rnadr_position/i.test(base)) return { kind: SOURCE_DAILY, sourceDate: null };
  return null;
}

/**
 * 처리하지 않은 파일이 왜 빠졌는지 말해준다.
 *
 * ★조용히 건너뛰지 않는다. yyplus 의 C7 버그가 정확히 이 모양이었다 — 필드 수가 안 맞는
 *   파일을 말없이 버려서, 18필드 전체분을 통째로 잃고도 아무도 몰랐다. 자료폴더에는
 *   출입구가 아닌 자료(동 도형 SHP 세트·삭제분)가 섞여 있고, 그건 다음 단계 담당이다.
 *   "안 읽었다"는 사실 자체는 화면에 남겨야 한다.
 */
export function skipReason(fileName) {
  const b = path.basename(fileName);
  if (/\.Deletion\.TXT$/i.test(b)) return '동 도형 일변동 삭제분(TI_*_DONG) — 300002 파서 단계';
  if (/^AlterD\.JUSUED\./i.test(b)) return '동 도형(SHP) 일변동 — 300002 파서 단계';
  if (/\.(shp|dbf|shx|prj)$/i.test(b)) return 'SHP 세트 — 300002 파서 단계';
  if (/\.(zip|pdf|xlsx?|csv)$/i.test(b)) return '압축·문서(원본 보관용)';
  return '출입구 자료로 판별되지 않음';
}

/** 적용 순서: 전체분 요약 → 전체분 연계 → 일변동(날짜 오름차순). */
const KIND_ORDER = { [SOURCE_FULL_SUMMARY]: 0, [SOURCE_FULL_LINK]: 1, [SOURCE_DAILY]: 2 };

export function orderSources(entries) {
  return [...entries].sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k !== 0) return k;
    const d = String(a.sourceDate || '').localeCompare(String(b.sourceDate || ''));
    if (d !== 0) return d;
    return a.file.localeCompare(b.file);
  });
}

export const ENTRANCE_COLUMNS = [
  'entrance_key', 'road_code', 'underground_yn', 'building_main_no', 'building_sub_no',
  'legal_dong_code', 'address_mgt_no', 'entrance_no',
  'sido', 'sigungu', 'emd', 'admin_dong', 'road_name', 'zip_code',
  'building_name', 'building_use', 'building_group_yn',
  'x', 'y', 'lat', 'lng', 'coord_status', 'coord_distance_m', 'coord_ref_kind',
  'source_file', 'source_kind', 'source_date',
];

/**
 * 파싱 레코드 + 좌표판정 → DB 행.
 * ★격리된 좌표는 lat/lng 에 넣지 않는다. 상태만 남기고 값은 버린다 —
 *   "일단 넣고 나중에 거르자"가 사고의 표준 경로다.
 */
export function toEntranceRow(rec, { geo, judgement, sourceFile, sourceKind, sourceDate }) {
  const usable = judgement.status === COORD_OK;
  return {
    entrance_key: entranceKey(rec),
    road_code: rec.roadCode,
    underground_yn: rec.undergroundYn || '0',
    building_main_no: rec.mainNo,
    building_sub_no: rec.subNo ?? 0,
    legal_dong_code: rec.legalDongCode,
    address_mgt_no: rec.addressMgtNo,
    entrance_no: rec.entranceNo,
    sido: rec.sido,
    sigungu: rec.sigungu,
    emd: rec.emd,
    admin_dong: rec.adminDong,
    road_name: rec.roadName,
    zip_code: rec.zipCode,
    building_name: rec.buildingName,
    building_use: rec.buildingUse,
    building_group_yn: rec.buildingGroupYn,
    x: usable ? rec.x : null,
    y: usable ? rec.y : null,
    lat: usable ? geo.lat : null,
    lng: usable ? geo.lng : null,
    coord_status: judgement.status,
    coord_distance_m: judgement.distanceM,
    coord_ref_kind: judgement.refKind,
    source_file: path.basename(sourceFile),
    source_kind: sourceKind,
    source_date: sourceDate,
  };
}

export function toQuarantineRow(rec, { geo, judgement, sourceFile }) {
  return {
    entrance_key: entranceKey(rec),
    reason: judgement.reason || 'unknown',
    x: rec.x,
    y: rec.y,
    lat: geo ? geo.lat : null,
    lng: geo ? geo.lng : null,
    ref_kind: judgement.refKind,
    ref_lat: judgement.refLat,
    ref_lng: judgement.refLng,
    ref_count: judgement.refCount,
    distance_m: judgement.distanceM,
    sido: rec.sido,
    sigungu: rec.sigungu,
    emd: rec.emd,
    road_name: rec.roadName,
    source_file: path.basename(sourceFile),
  };
}

export const QUARANTINE_COLUMNS = [
  'entrance_key', 'reason', 'x', 'y', 'lat', 'lng',
  'ref_kind', 'ref_lat', 'ref_lng', 'ref_count', 'distance_m',
  'sido', 'sigungu', 'emd', 'road_name', 'source_file',
];

/**
 * 전체분 upsert.
 *
 * COALESCE 를 쓰는 이유: 두 전체분이 **서로 다른 정보를 갖는다**. entrc 는 건물명·용도,
 * RNENTDATA 는 관리번호. 나중에 들어온 쪽이 NULL 로 덮으면 앞서 얻은 정보가 사라진다.
 *
 * 좌표는 CASE 로 지킨다: 이미 검증 통과한 좌표가 있는데 새 파일이 격리감 좌표를 들고 오면
 * 기존 값을 유지한다. 반대로 새 좌표가 정상이면 갱신한다(원본이 고쳐진 경우).
 */
export const ENTRANCE_UPSERT_SQL = `
  ON CONFLICT (entrance_key) DO UPDATE SET
    address_mgt_no    = COALESCE(EXCLUDED.address_mgt_no, entrance_core.address_mgt_no),
    entrance_no       = COALESCE(EXCLUDED.entrance_no, entrance_core.entrance_no),
    sido              = COALESCE(EXCLUDED.sido, entrance_core.sido),
    sigungu           = COALESCE(EXCLUDED.sigungu, entrance_core.sigungu),
    emd               = COALESCE(EXCLUDED.emd, entrance_core.emd),
    admin_dong        = COALESCE(EXCLUDED.admin_dong, entrance_core.admin_dong),
    road_name         = COALESCE(EXCLUDED.road_name, entrance_core.road_name),
    zip_code          = COALESCE(EXCLUDED.zip_code, entrance_core.zip_code),
    building_name     = COALESCE(EXCLUDED.building_name, entrance_core.building_name),
    building_use      = COALESCE(EXCLUDED.building_use, entrance_core.building_use),
    building_group_yn = COALESCE(EXCLUDED.building_group_yn, entrance_core.building_group_yn),
    x   = CASE WHEN EXCLUDED.coord_status = '${COORD_OK}' THEN EXCLUDED.x   ELSE entrance_core.x   END,
    y   = CASE WHEN EXCLUDED.coord_status = '${COORD_OK}' THEN EXCLUDED.y   ELSE entrance_core.y   END,
    lat = CASE WHEN EXCLUDED.coord_status = '${COORD_OK}' THEN EXCLUDED.lat ELSE entrance_core.lat END,
    lng = CASE WHEN EXCLUDED.coord_status = '${COORD_OK}' THEN EXCLUDED.lng ELSE entrance_core.lng END,
    coord_status = CASE
      WHEN EXCLUDED.coord_status = '${COORD_OK}' THEN EXCLUDED.coord_status
      WHEN entrance_core.coord_status = '${COORD_OK}' THEN entrance_core.coord_status
      ELSE EXCLUDED.coord_status END,
    coord_distance_m = CASE WHEN EXCLUDED.coord_status = '${COORD_OK}' THEN EXCLUDED.coord_distance_m ELSE entrance_core.coord_distance_m END,
    coord_ref_kind   = CASE WHEN EXCLUDED.coord_status = '${COORD_OK}' THEN EXCLUDED.coord_ref_kind   ELSE entrance_core.coord_ref_kind   END,
    source_file = EXCLUDED.source_file,
    source_kind = EXCLUDED.source_kind,
    source_date = COALESCE(EXCLUDED.source_date, entrance_core.source_date),
    updated_at  = now()
`;

/**
 * 일변동 upsert = 전체분과 같되 **폐지 해제**가 붙는다.
 * 31(신규)·34(변동)이 오면 그 주소는 다시 살아 있다는 국가의 공식 신호다.
 */
export const DAILY_UPSERT_SQL = `${ENTRANCE_UPSERT_SQL},
    is_retired = false,
    retired_at = null,
    retired_source = null
`;

const buildValues = (columns, rows) => {
  const values = [];
  const tuples = rows.map((row, r) => {
    const marks = columns.map((_, c) => `$${r * columns.length + c + 1}`);
    columns.forEach((col) => values.push(row[col] ?? null));
    return `(${marks.join(', ')})`;
  });
  return { text: `(${columns.join(', ')}) VALUES ${tuples.join(', ')}`, values };
};

export const insertEntranceRows = async (client, rows, conflictSql) => {
  if (!rows.length) return;
  const { text, values } = buildValues(ENTRANCE_COLUMNS, rows);
  await client.query(`INSERT INTO entrance_core ${text} ${conflictSql}`, values);
};

export const insertQuarantineRows = async (client, rows) => {
  if (!rows.length) return;
  const { text, values } = buildValues(QUARANTINE_COLUMNS, rows);
  await client.query(
    `INSERT INTO entrance_coord_quarantine ${text} ON CONFLICT (entrance_key, detected_at) DO NOTHING`,
    values,
  );
};

/**
 * 폐지 반영. 행이 없으면 아무 일도 일어나지 않는다(적용 건수를 그대로 보고한다 —
 * "지웠다"고 말하려면 실제로 몇 행이 바뀌었는지 세어야 한다).
 * @returns {number} 실제로 폐지 처리된 행 수
 */
export const retireEntrances = async (client, keys, { retiredAt, sourceFile }) => {
  if (!keys.length) return 0;
  const { rowCount } = await client.query(
    `UPDATE entrance_core
        SET is_retired = true, retired_at = $2, retired_source = $3, updated_at = now()
      WHERE entrance_key = ANY($1::text[])
        AND is_retired = false`,
    [keys, retiredAt, path.basename(sourceFile)],
  );
  return rowCount;
};

/**
 * 파일 1차 통과 — 좌표 대조군(도로·읍면동 중앙값)을 만든다.
 * 파일을 두 번 읽는 대신 레코드를 메모리에 들고 있으면 경기(103만행)에서 수백 MB 를 먹는다.
 * 월 1회 배치라 IO 를 한 번 더 쓰는 쪽이 낫다.
 */
export const buildClusters = async (filePath, { encoding, limit } = {}) => {
  const clusters = createClusterIndex();
  for await (const line of readEntranceLines(filePath, { encoding, limit })) {
    const rec = parseEntranceLine(line);
    if (!rec || rec.x === null || rec.y === null) continue;
    const geo = tmToWgs84(rec.x, rec.y, 5179);
    if (!geo) continue;
    const keys = referenceKeys(rec);
    clusters.add(keys.road, geo.lat, geo.lng);
    clusters.add(keys.emd, geo.lat, geo.lng);
  }
  return clusters;
};

/** 대조군 후보를 우선순위대로 만든다. 도로가 먼저다(가장 촘촘하고 섬에도 안전). */
export const refsFor = (rec, clusters) => {
  const keys = referenceKeys(rec);
  return [
    { kind: 'road', center: clusters.center(keys.road, MIN_POINTS_ROAD) },
    { kind: 'emd', center: clusters.center(keys.emd, MIN_POINTS_EMD) },
  ];
};

export const emptyStats = () => ({
  files: 0, lines: 0, parsed: 0, skipped: 0,
  noCoord: 0, projFail: 0, ok: 0, quarantined: 0, unverified: 0,
  upserted: 0, retireSeen: 0, retireApplied: 0,
});

/**
 * 파일 한 개 처리. 전체분이면 2-pass(대조군 생성 → 판정·적재), 일변동이면 1-pass.
 *
 * @param {object} deps
 *   - lookupClusters(rec): 일변동용 대조군 조회(비동기). 전체분에서는 쓰지 않는다.
 *   - onRows(rows, conflictSql): 적재 콜백. dry-run 이면 세기만 한다.
 *   - onQuarantine(rows)
 *   - onRetire(keys, meta) -> Promise<number>
 */
export const processFile = async (filePath, source, deps, opts = {}) => {
  const { encoding, limit, batchSize = 1000 } = opts;
  const stats = emptyStats();
  stats.files = 1;

  const isDaily = source.kind === SOURCE_DAILY;
  const clusters = isDaily ? null : await buildClusters(filePath, { encoding, limit });
  const conflictSql = isDaily ? DAILY_UPSERT_SQL : ENTRANCE_UPSERT_SQL;

  let rows = [];
  let quarantine = [];
  let retireKeys = [];

  const flush = async () => {
    if (rows.length) {
      await deps.onRows(rows, conflictSql);
      stats.upserted += rows.length;
      rows = [];
    }
    if (quarantine.length) {
      await deps.onQuarantine(quarantine);
      quarantine = [];
    }
  };

  for await (const line of readEntranceLines(filePath, { encoding, limit })) {
    stats.lines += 1;
    const rec = parseEntranceLine(line);
    if (!rec) { stats.skipped += 1; continue; }
    stats.parsed += 1;

    // ★폐지는 좌표 판정보다 먼저다. 없어진 주소의 좌표를 검증하는 건 의미가 없다.
    if (rec.changeReason === CHANGE_DELETE) {
      stats.retireSeen += 1;
      retireKeys.push(entranceKey(rec));
      if (retireKeys.length >= batchSize) {
        stats.retireApplied += await deps.onRetire(retireKeys, {
          retiredAt: source.sourceDate, sourceFile: filePath,
        });
        retireKeys = [];
      }
      continue;
    }

    let geo = null;
    let judgement;
    if (rec.x === null || rec.y === null) {
      stats.noCoord += 1;
      judgement = { status: COORD_NONE, reason: null, distanceM: null, refKind: null, refLat: null, refLng: null, refCount: null };
    } else {
      geo = tmToWgs84(rec.x, rec.y, 5179);
      if (!geo) {
        // 변환 자체가 한국 밖으로 떨어졌다 = 좌표계 오지정. 격리 대상이다.
        stats.projFail += 1;
        judgement = { status: COORD_QUARANTINED, reason: 'outside_korea', distanceM: null, refKind: null, refLat: null, refLng: null, refCount: null };
      } else {
        const refs = isDaily ? await deps.lookupClusters(rec) : refsFor(rec, clusters);
        judgement = judgeCoord(geo, refs);
      }
    }

    if (judgement.status === COORD_OK) stats.ok += 1;
    else if (judgement.status === COORD_QUARANTINED) {
      stats.quarantined += 1;
      quarantine.push(toQuarantineRow(rec, { geo, judgement, sourceFile: filePath }));
    } else if (judgement.status !== COORD_NONE) stats.unverified += 1;

    rows.push(toEntranceRow(rec, {
      geo, judgement, sourceFile: filePath, sourceKind: source.kind, sourceDate: source.sourceDate,
    }));
    if (rows.length >= batchSize) await flush();
  }

  await flush();
  if (retireKeys.length) {
    stats.retireApplied += await deps.onRetire(retireKeys, {
      retiredAt: source.sourceDate, sourceFile: filePath,
    });
  }
  return stats;
};

export const mergeStats = (into, add) => {
  for (const k of Object.keys(add)) into[k] = (into[k] || 0) + add[k];
  return into;
};
