import { Storage } from '@google-cloud/storage';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import iconv from 'iconv-lite';
import { closePool, withClient } from './db.js';
import { config, requireConfig } from './config.js';
import { cleanText, intOrNull, isApartmentText, joinAddress, normalizeSearchKey } from './normalize.js';
import { sourceLayout, toStoragePrefix } from './source-layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const storage = new Storage();
const counts = {};
const errors = [];

const sha = (value) => createHash('sha1').update(String(value)).digest('hex');

const recordCount = (key, amount) => {
  counts[key] = (counts[key] || 0) + amount;
};

const columnValue = (cols, index) => cleanText(cols[index] || '');

const roadAddressText = ({
  sido, sigungu, legalEupMyeon = '', roadName, undergroundYn, mainNo, subNo,
}) => joinAddress(
  sido,
  sigungu,
  legalEupMyeon,
  roadName,
  undergroundYn === '1' ? '지하' : '',
  mainNo === null ? '' : subNo ? `${mainNo}-${subNo}` : `${mainNo}`,
);

const batchInsert = async (client, table, columns, rows, conflictSql) => {
  if (!rows.length) return;
  const values = [];
  const tuples = rows.map((row, rowIndex) => {
    const marks = columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`);
    columns.forEach((column) => values.push(row[column] ?? null));
    return `(${marks.join(', ')})`;
  });
  await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} ${conflictSql}`,
    values,
  );
};

const flushRows = async (client, spec, rows) => {
  const insertRows = spec.dedupeKey
    ? [...new Map(rows.map((row) => [spec.dedupeKey(row), row])).values()]
    : rows;
  await batchInsert(client, spec.table, spec.columns, insertRows, spec.conflictSql);
  recordCount(spec.countKey, insertRows.length);
  rows.length = 0;
};

const parseRoadCode = (cols) => {
  const roadCode = columnValue(cols, 0);
  const emdSeq = columnValue(cols, 3);
  const roadName = columnValue(cols, 1);
  if (!roadCode || !emdSeq || !roadName) return null;
  return {
    version_id: config.activeVersion,
    road_code: roadCode,
    emd_seq: emdSeq,
    road_name: roadName,
    sido: columnValue(cols, 4),
    sigungu: columnValue(cols, 6),
    emd: columnValue(cols, 8),
    road_name_key: normalizeSearchKey(roadName),
    use_yn: columnValue(cols, 12),
  };
};

const parseAddressLink = (cols) => {
  const buildingMgtNo = columnValue(cols, 0);
  if (!buildingMgtNo) return null;
  return {
    version_id: config.activeVersion,
    building_mgt_no: buildingMgtNo,
    road_code: columnValue(cols, 1),
    emd_seq: columnValue(cols, 2),
    underground_yn: columnValue(cols, 3),
    building_main_no: intOrNull(cols[4]),
    building_sub_no: intOrNull(cols[5]) || 0,
    zip_no: columnValue(cols, 6),
  };
};

// 도로명주소 한글DB의 jibun_rnaddrkor 파일은 도로명 문자열 대신 도로명코드를 준다.
// 도로명은 road_codes 적재 후 hydrateRoadAddresses()에서 코드로 보강한다.
const parseRoadAddressKorean = (cols) => {
  const addressMgtNo = columnValue(cols, 0);
  const roadCode = columnValue(cols, 9);
  const mainNo = intOrNull(cols[11]);
  if (!addressMgtNo || !roadCode || mainNo === null) return null;
  const sido = columnValue(cols, 2);
  const sigungu = columnValue(cols, 3);
  const legalEupMyeon = /[읍면]$/.test(columnValue(cols, 4)) ? columnValue(cols, 4) : '';
  const subNo = intOrNull(cols[12]) || 0;
  const roadName = '';
  const roadAddress = roadAddressText({
    sido,
    sigungu,
    legalEupMyeon,
    roadName: roadCode,
    undergroundYn: columnValue(cols, 10),
    mainNo,
    subNo,
  });
  const buildingName = columnValue(cols, 13);
  return {
    version_id: config.activeVersion,
    address_mgt_no: addressMgtNo,
    legal_dong_code: columnValue(cols, 1),
    sido,
    sigungu,
    legal_emd: columnValue(cols, 4),
    legal_ri: columnValue(cols, 5),
    jibun_san_yn: columnValue(cols, 6),
    jibun_main_no: intOrNull(cols[7]),
    jibun_sub_no: intOrNull(cols[8]) || 0,
    road_code: roadCode,
    underground_yn: columnValue(cols, 10),
    building_main_no: mainNo,
    building_sub_no: subNo,
    building_name: buildingName,
    road_name: roadName,
    road_address: roadAddress,
    road_key: normalizeSearchKey(roadAddress),
    full_key: normalizeSearchKey(`${roadAddress} ${buildingName} ${columnValue(cols, 4)}`),
  };
};

const parseBuilding = (cols) => {
  const buildingMgtNo = columnValue(cols, 15);
  const roadName = columnValue(cols, 9);
  const mainNo = intOrNull(cols[11]);
  if (!buildingMgtNo || !roadName || mainNo === null) return null;
  const sido = columnValue(cols, 1);
  const sigungu = columnValue(cols, 2);
  const legalEupMyeon = /[읍면]$/.test(columnValue(cols, 3)) ? columnValue(cols, 3) : '';
  const buildingName = columnValue(cols, 25);
  const roadAddress = roadAddressText({
    sido,
    sigungu,
    legalEupMyeon,
    roadName,
    undergroundYn: columnValue(cols, 10),
    mainNo,
    subNo: intOrNull(cols[12]) || 0,
  });
  return {
    version_id: config.activeVersion,
    building_mgt_no: buildingMgtNo,
    legal_dong_code: columnValue(cols, 0),
    sido,
    sigungu,
    legal_emd: columnValue(cols, 3),
    legal_ri: columnValue(cols, 4),
    road_code: columnValue(cols, 8),
    road_name: roadName,
    underground_yn: columnValue(cols, 10),
    building_main_no: mainNo,
    building_sub_no: intOrNull(cols[12]) || 0,
    zip_no: columnValue(cols, 20),
    building_name: buildingName,
    building_name_key: normalizeSearchKey(buildingName),
    road_address: roadAddress,
    road_key: normalizeSearchKey(roadAddress),
    is_apartment: isApartmentText(buildingName),
  };
};

const parseDetailDisplay = (cols, fileName, lineNo, mode) => {
  const addressMgtNo = mode === 'dong' ? columnValue(cols, 8) : columnValue(cols, 16);
  const buildingMgtNo = mode === 'dong' ? columnValue(cols, 9) : columnValue(cols, 10);
  const roadCode = mode === 'dong' ? columnValue(cols, 4) : columnValue(cols, 12);
  if (!addressMgtNo && !buildingMgtNo && !roadCode) return null;
  const dong = mode === 'dong' ? columnValue(cols, 1) : columnValue(cols, 6);
  const floor = mode === 'floor-room' ? columnValue(cols, 7) : '';
  const ho = mode === 'floor-room' ? columnValue(cols, 8) : mode === 'building' ? columnValue(cols, 7) : '';
  const detailText = joinAddress(dong && `${dong}동`, floor && `${floor}층`, ho && `${ho}호`);
  return {
    version_id: config.activeVersion,
    detail_id: sha(`${fileName}:${lineNo}:${cols.join('|')}`),
    address_mgt_no: addressMgtNo,
    building_mgt_no: buildingMgtNo,
    legal_dong_code: mode === 'dong' ? columnValue(cols, 0) : columnValue(cols, 11),
    road_code: roadCode,
    underground_yn: mode === 'dong' ? columnValue(cols, 5) : columnValue(cols, 13),
    building_main_no: intOrNull(mode === 'dong' ? cols[6] : cols[14]),
    building_sub_no: intOrNull(mode === 'dong' ? cols[7] : cols[15]) || 0,
    dong_name: dong,
    floor_name: floor,
    ho_name: ho,
    detail_text: detailText,
  };
};

const parseDetailAddress = (cols, fileName, lineNo) => {
  const buildingMgtNo = columnValue(cols, 10);
  const roadCode = columnValue(cols, 12);
  if (!buildingMgtNo || !roadCode) return null;
  const dong = columnValue(cols, 6);
  const floor = columnValue(cols, 5);
  const ho = columnValue(cols, 8);
  return {
    version_id: config.activeVersion,
    detail_id: sha(`${fileName}:${lineNo}:${cols.join('|')}`),
    address_mgt_no: '',
    building_mgt_no: buildingMgtNo,
    legal_dong_code: columnValue(cols, 11),
    road_code: roadCode,
    underground_yn: columnValue(cols, 13),
    building_main_no: intOrNull(cols[14]),
    building_sub_no: intOrNull(cols[15]) || 0,
    dong_name: dong,
    floor_name: floor,
    ho_name: ho,
    detail_text: joinAddress(dong && `${dong}동`, floor && `${floor}층`, ho && `${ho}호`),
  };
};

const specs = {
  roadCodes: {
    table: 'road_codes',
    countKey: 'roadCodes',
    parser: parseRoadCode,
    columns: ['version_id', 'road_code', 'emd_seq', 'road_name', 'sido', 'sigungu', 'emd', 'road_name_key', 'use_yn'],
    conflictSql: 'ON CONFLICT (version_id, road_code, emd_seq) DO UPDATE SET road_name = EXCLUDED.road_name, road_name_key = EXCLUDED.road_name_key, use_yn = EXCLUDED.use_yn',
  },
  addressLinks: {
    table: 'address_building_links',
    countKey: 'addressLinks',
    parser: parseAddressLink,
    columns: ['version_id', 'building_mgt_no', 'road_code', 'emd_seq', 'underground_yn', 'building_main_no', 'building_sub_no', 'zip_no'],
    conflictSql: 'ON CONFLICT (version_id, building_mgt_no) DO UPDATE SET road_code = EXCLUDED.road_code, emd_seq = EXCLUDED.emd_seq, zip_no = EXCLUDED.zip_no',
  },
  roadAddressKorean: {
    table: 'address_core',
    countKey: 'addressCore',
    parser: parseRoadAddressKorean,
    dedupeKey: (row) => row.address_mgt_no,
    columns: ['version_id', 'address_mgt_no', 'legal_dong_code', 'sido', 'sigungu', 'legal_emd', 'legal_ri', 'jibun_san_yn', 'jibun_main_no', 'jibun_sub_no', 'road_code', 'underground_yn', 'building_main_no', 'building_sub_no', 'building_name', 'road_name', 'road_address', 'road_key', 'full_key'],
    conflictSql: 'ON CONFLICT (version_id, address_mgt_no) DO UPDATE SET road_address = EXCLUDED.road_address, building_name = EXCLUDED.building_name, road_key = EXCLUDED.road_key, full_key = EXCLUDED.full_key',
  },
  buildings: {
    table: 'building_core',
    countKey: 'buildingCore',
    parser: parseBuilding,
    columns: ['version_id', 'building_mgt_no', 'legal_dong_code', 'sido', 'sigungu', 'legal_emd', 'legal_ri', 'road_code', 'road_name', 'underground_yn', 'building_main_no', 'building_sub_no', 'zip_no', 'building_name', 'building_name_key', 'road_address', 'road_key', 'is_apartment'],
    conflictSql: 'ON CONFLICT (version_id, building_mgt_no) DO UPDATE SET road_address = EXCLUDED.road_address, building_name = EXCLUDED.building_name, building_name_key = EXCLUDED.building_name_key, zip_no = EXCLUDED.zip_no',
  },
  detailDongDisplays: {
    table: 'detail_core',
    countKey: 'detailDong',
    parser: (cols, fileName, lineNo) => parseDetailDisplay(cols, fileName, lineNo, 'dong'),
    columns: ['version_id', 'detail_id', 'address_mgt_no', 'building_mgt_no', 'legal_dong_code', 'road_code', 'underground_yn', 'building_main_no', 'building_sub_no', 'dong_name', 'floor_name', 'ho_name', 'detail_text'],
    conflictSql: 'ON CONFLICT (version_id, detail_id) DO NOTHING',
  },
  detailAddresses: {
    table: 'detail_core',
    countKey: 'detailAddress',
    parser: parseDetailAddress,
    columns: ['version_id', 'detail_id', 'address_mgt_no', 'building_mgt_no', 'legal_dong_code', 'road_code', 'underground_yn', 'building_main_no', 'building_sub_no', 'dong_name', 'floor_name', 'ho_name', 'detail_text'],
    conflictSql: 'ON CONFLICT (version_id, detail_id) DO NOTHING',
  },
  detailBuildingDisplays: {
    table: 'detail_core',
    countKey: 'detailBuilding',
    parser: (cols, fileName, lineNo) => parseDetailDisplay(cols, fileName, lineNo, 'building'),
    columns: ['version_id', 'detail_id', 'address_mgt_no', 'building_mgt_no', 'legal_dong_code', 'road_code', 'underground_yn', 'building_main_no', 'building_sub_no', 'dong_name', 'floor_name', 'ho_name', 'detail_text'],
    conflictSql: 'ON CONFLICT (version_id, detail_id) DO NOTHING',
  },
  detailFloorRoomDisplays: {
    table: 'detail_core',
    countKey: 'detailFloorRoom',
    parser: (cols, fileName, lineNo) => parseDetailDisplay(cols, fileName, lineNo, 'floor-room'),
    columns: ['version_id', 'detail_id', 'address_mgt_no', 'building_mgt_no', 'legal_dong_code', 'road_code', 'underground_yn', 'building_main_no', 'building_sub_no', 'dong_name', 'floor_name', 'ho_name', 'detail_text'],
    conflictSql: 'ON CONFLICT (version_id, detail_id) DO NOTHING',
  },
};

const applySchema = async (client) => {
  const schema = await readFile(join(here, '..', 'sql', 'schema.sql'), 'utf8');
  await client.query(schema);
  await client.query('SET search_path TO nexus_address, public');
};

const resetVersionData = async (client) => {
  const tables = [
    'address_search_keys',
    'detail_core',
    'building_core',
    'address_core',
    'address_building_links',
    'road_codes',
  ];
  for (const table of tables) {
    await client.query(`DELETE FROM ${table} WHERE version_id = $1`, [config.activeVersion]);
  }
};

const listFiles = async (kind) => {
  const prefix = toStoragePrefix(config.storagePrefix, sourceLayout[kind].prefix);
  const [files] = await storage.bucket(config.storageBucket).getFiles({ prefix });
  return files.filter((file) =>
    file.name.endsWith('.txt')
    && !file.name.includes('[자료건수]')
    && (!sourceLayout[kind].includes || file.name.includes(sourceLayout[kind].includes)));
};

const importFile = async (client, file, spec) => {
  const rows = [];
  const input = file.createReadStream().pipe(iconv.decodeStream(config.sourceEncoding));
  const rl = createInterface({ input, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (!line.trim()) continue;
    try {
      const row = spec.parser(line.split('|'), file.name, lineNo);
      if (!row) continue;
      rows.push(row);
      if (rows.length >= config.importBatchSize) await flushRows(client, spec, rows);
    } catch (error) {
      errors.push({ file: file.name, lineNo, message: error.message });
      if (errors.length > 1000) throw new Error('파싱 오류가 1000건을 초과했습니다.');
    }
  }
  await flushRows(client, spec, rows);
};

const hydrateRoadAddresses = async (client) => {
  await client.query(`
    WITH road_names AS (
      SELECT version_id, road_code, min(road_name) AS road_name
      FROM road_codes
      WHERE version_id = $1
      GROUP BY version_id, road_code
    )
    UPDATE address_core a
    SET
      road_name = r.road_name,
      road_address = concat_ws(
        ' ',
        nullif(a.sido, ''),
        nullif(a.sigungu, ''),
        CASE WHEN a.legal_emd ~ '(읍|면)$' THEN nullif(a.legal_emd, '') ELSE null END,
        r.road_name,
        CASE WHEN a.underground_yn = '1' THEN '지하' ELSE null END,
        CASE
          WHEN coalesce(a.building_sub_no, 0) > 0 THEN a.building_main_no::text || '-' || a.building_sub_no::text
          ELSE a.building_main_no::text
        END
      ),
      road_key = regexp_replace(lower(concat_ws(
        '',
        a.sido,
        a.sigungu,
        CASE WHEN a.legal_emd ~ '(읍|면)$' THEN a.legal_emd ELSE '' END,
        r.road_name,
        CASE WHEN a.underground_yn = '1' THEN '지하' ELSE '' END,
        a.building_main_no::text,
        CASE WHEN coalesce(a.building_sub_no, 0) > 0 THEN '-' || a.building_sub_no::text ELSE '' END
      )), '\\s+', '', 'g'),
      full_key = regexp_replace(lower(concat_ws(
        '',
        a.sido,
        a.sigungu,
        CASE WHEN a.legal_emd ~ '(읍|면)$' THEN a.legal_emd ELSE '' END,
        r.road_name,
        CASE WHEN a.underground_yn = '1' THEN '지하' ELSE '' END,
        a.building_main_no::text,
        CASE WHEN coalesce(a.building_sub_no, 0) > 0 THEN '-' || a.building_sub_no::text ELSE '' END,
        coalesce(a.building_name, ''),
        coalesce(a.legal_emd, '')
      )), '\\s+', '', 'g')
    FROM road_names r
    WHERE a.version_id = $1
      AND r.version_id = a.version_id
      AND r.road_code = a.road_code
  `, [config.activeVersion]);
};

const rebuildSearchKeys = async (client) => {
  await client.query('DELETE FROM address_search_keys WHERE version_id = $1', [config.activeVersion]);
  await client.query(`
    INSERT INTO address_search_keys (
      version_id, entity_type, entity_id, road_key, jibun_key, building_key, full_key, weight
    )
    SELECT
      version_id,
      'address',
      address_mgt_no,
      road_key,
      regexp_replace(concat_ws('', legal_emd, legal_ri, jibun_main_no::text, jibun_sub_no::text), '\\s+', '', 'g'),
      regexp_replace(lower(coalesce(building_name, '')), '\\s+', '', 'g'),
      full_key,
      120
    FROM address_core
    WHERE version_id = $1
  `, [config.activeVersion]);
  await client.query(`
    INSERT INTO address_search_keys (
      version_id, entity_type, entity_id, road_key, jibun_key, building_key, full_key, weight
    )
    SELECT
      version_id,
      'building',
      building_mgt_no,
      road_key,
      '',
      building_name_key,
      concat_ws('', road_key, building_name_key),
      CASE WHEN is_apartment THEN 115 ELSE 100 END
    FROM building_core
    WHERE version_id = $1 AND building_name_key <> ''
  `, [config.activeVersion]);
  const { rows } = await client.query(
    'SELECT count(*)::int AS count FROM address_search_keys WHERE version_id = $1',
    [config.activeVersion],
  );
  counts.searchKeys = rows[0]?.count || 0;
};

const publishVersion = async (client, status) => {
  await client.query(`
    INSERT INTO address_db_versions (
      version_id, reference_date, storage_prefix, imported_at, published_at, status, counts, errors
    ) VALUES ($1, $2, $3, now(), CASE WHEN $4 = 'published' THEN now() ELSE null END, $4, $5::jsonb, $6::jsonb)
    ON CONFLICT (version_id) DO UPDATE SET
      reference_date = EXCLUDED.reference_date,
      storage_prefix = EXCLUDED.storage_prefix,
      imported_at = now(),
      published_at = EXCLUDED.published_at,
      status = EXCLUDED.status,
      counts = EXCLUDED.counts,
      errors = EXCLUDED.errors
  `, [
    config.activeVersion,
    config.referenceDate,
    config.storagePrefix,
    status,
    JSON.stringify(counts),
    JSON.stringify(errors.slice(0, 100)),
  ]);
};

// 대량 적재/삭제 후 플래너 통계를 갱신한다. 없으면 stale 통계로 최악 실행계획(대형 중첩루프)이
// 선택돼 단건 조회가 수십 초씩 걸린다(2026-07-11 매칭 37s hang 사고). ANALYZE 필수.
const ANALYZE_TABLES = [
  'road_codes', 'address_core', 'address_building_links',
  'building_core', 'detail_core', 'address_search_keys',
];
const analyzeAll = async (client) => {
  await client.query('SET search_path TO nexus_address, public');
  for (const t of ANALYZE_TABLES) {
    console.log(`[address-import] ANALYZE ${t}`);
    await client.query(`ANALYZE ${t}`);
  }
  console.log('[address-import] ANALYZE 완료');
};

const run = async () => {
  requireConfig('databaseUrl', 'storageBucket');
  // ANALYZE_ONLY=1 → 재적재 없이 통계만 갱신(운영 hang 응급 복구용). 스키마 인덱스도 보장.
  if (process.env.ANALYZE_ONLY === '1') {
    await withClient(async (client) => {
      await applySchema(client);   // CREATE INDEX IF NOT EXISTS — 누락 인덱스 보강
      await analyzeAll(client);
    });
    console.log(JSON.stringify({ mode: 'analyze-only', version: config.activeVersion }, null, 2));
    return;
  }
  await withClient(async (client) => {
    await applySchema(client);
    await resetVersionData(client);
    await publishVersion(client, 'staging');
    for (const [kind, spec] of Object.entries(specs)) {
      const files = await listFiles(kind);
      if (!files.length) {
        errors.push({ kind, message: `${sourceLayout[kind].label} 파일이 없습니다.` });
        continue;
      }
      for (const file of files) {
        console.log(`[address-import] ${kind}: ${file.name}`);
        await importFile(client, file, spec);
      }
    }
    await hydrateRoadAddresses(client);
    await rebuildSearchKeys(client);
    await analyzeAll(client);   // 적재 직후 통계 갱신(영구 개선)
    await publishVersion(client, errors.length ? 'staging' : 'published');
  });
  console.log(JSON.stringify({ version: config.activeVersion, counts, errors: errors.slice(0, 20) }, null, 2));
};

run()
  .catch(async (error) => {
    console.error('[address-import] failed:', error);
    process.exitCode = 1;
  })
  .finally(closePool);
