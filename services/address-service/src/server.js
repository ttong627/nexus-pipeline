import { createServer } from 'node:http';
import { config, requireConfig } from './config.js';
import { query } from './db.js';
import { cleanText, formatRoadLookupQuery, normalizeSearchKey, parseRoadNumber, roadSideKey } from './normalize.js';

const ADDRESS_SCHEMA = config.dbSchema;
let currentJusoKey = 0;

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const allowOrigin = (origin) => {
  if (config.allowedOrigins.includes('*')) return '*';
  return config.allowedOrigins.includes(origin) ? origin : '';
};

const hasExplicitMunicipality = (value) => {
  const text = cleanText(value);
  return /(특별시|광역시|특별자치시|특별자치도|도)\s+/.test(text) && /(시|군|구)\s+/.test(text);
};

const corsHeaders = (req) => {
  const origin = allowOrigin(req.headers.origin || '');
  return origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    Vary: 'Origin',
  } : {};
};

const toAddressResult = (record, confidence = 0.98, source = 'national_address_db') => {
  const mainNo = Number(record.building_main_no);
  const subNo = Number(record.building_sub_no || 0);
  const buildingName = record.building_name || '';
  const groupBase = `${record.road_address}|${mainNo}|${subNo}`;
  return {
    standardRoadAddress: record.road_address,
    roadName: record.road_name || '',
    buildingMainNo: Number.isFinite(mainNo) ? mainNo : null,
    buildingSubNo: subNo || 0,
    buildingName,
    matchedSido: record.sido || '',
    matchedSigungu: record.sigungu || '',
    buildingMgtNo: record.building_mgt_no || '',
    addressMgtNo: record.address_mgt_no || '',
    isApartment: Boolean(record.is_apartment || /(아파트|주공|임대|LH|SH)/i.test(buildingName)),
    legalDong: record.legal_emd || '',
    roadAddrPart1: record.road_address,
    roadAddr: record.road_address,
    rn: record.road_name || '',
    buldMnnm: Number.isFinite(mainNo) ? `${mainNo}` : '',
    buldSlno: subNo ? `${subNo}` : '0',
    bdNm: buildingName,
    bdKdcd: record.is_apartment || /(아파트|주공|임대|LH|SH)/i.test(buildingName) ? '1' : '0',
    emdNm: record.legal_emd || '',
    zipNo: record.zip_no || '',
    bdMgtSn: record.building_mgt_no || '',
    _addressMgtNo: record.address_mgt_no || '',
    _matchSource: source,
    _matchConfidence: confidence,
    _routeHints: {
      apartmentGroupKey: normalizeSearchKey(groupBase),
      buildingGroupKey: record.building_mgt_no || '',
      roadSideKey: roadSideKey(record.road_name, mainNo),
    },
  };
};

const exactRoadMatch = async (version, queryText, cityLabel) => {
  const parsed = parseRoadNumber(queryText);
  if (!parsed) return null;
  const { rows } = await query(`
    SELECT
      a.address_mgt_no,
      a.road_address,
      a.sido,
      a.sigungu,
      a.road_name,
      a.legal_emd,
      a.building_main_no,
      a.building_sub_no,
      coalesce(nullif(a.building_name, ''), b.building_name, '') AS building_name,
      b.building_mgt_no,
      b.zip_no,
      coalesce(b.is_apartment, false) AS is_apartment,
      similarity(a.full_key, $7) AS score
    FROM ${ADDRESS_SCHEMA}.address_core a
    LEFT JOIN ${ADDRESS_SCHEMA}.building_core b
      ON b.version_id = a.version_id
     AND b.road_code = a.road_code
     AND b.underground_yn = a.underground_yn
     AND b.building_main_no = a.building_main_no
     AND b.building_sub_no = a.building_sub_no
    WHERE a.version_id = $1
      AND (a.road_name = $2 OR a.road_key = $8)
      AND a.building_main_no = $3
      AND a.building_sub_no = $4
      AND coalesce(a.underground_yn, '0') = $5
      AND ($6 = '' OR concat_ws(' ', a.sido, a.sigungu) ILIKE '%' || $6 || '%')
    ORDER BY score DESC, length(a.road_address) ASC
    LIMIT 5
  `, [
    version,
    parsed.roadName,
    parsed.buildingMainNo,
    parsed.buildingSubNo,
    parsed.undergroundYn,
    cleanText(cityLabel),
    normalizeSearchKey(queryText),
    normalizeSearchKey(parsed.roadName),
  ]);
  if (rows[0]) rows[0].candidate_count = rows.length;
  return rows[0] || null;
};

const exactBuildingRoadMatch = async (version, queryText, cityLabel) => {
  const parsed = parseRoadNumber(queryText);
  if (!parsed) return null;
  const { rows } = await query(`
    SELECT
      '' AS address_mgt_no,
      b.road_address,
      b.sido,
      b.sigungu,
      b.road_name,
      b.legal_emd,
      b.building_main_no,
      b.building_sub_no,
      b.building_name,
      b.building_mgt_no,
      b.zip_no,
      coalesce(b.is_apartment, false) AS is_apartment,
      similarity(concat_ws('', b.road_key, b.building_main_no::text, b.building_sub_no::text), $7) AS score
    FROM ${ADDRESS_SCHEMA}.building_core b
    WHERE b.version_id = $1
      AND (b.road_name = $2 OR b.road_key = $8)
      AND b.building_main_no = $3
      AND b.building_sub_no = $4
      AND coalesce(b.underground_yn, '0') = $5
      AND ($6 = '' OR concat_ws(' ', b.sido, b.sigungu) ILIKE '%' || $6 || '%')
    ORDER BY score DESC, length(b.road_address) ASC
    LIMIT 5
  `, [
    version,
    parsed.roadName,
    parsed.buildingMainNo,
    parsed.buildingSubNo,
    parsed.undergroundYn,
    cleanText(cityLabel),
    normalizeSearchKey(queryText),
    normalizeSearchKey(parsed.roadName),
  ]);
  if (rows[0]) rows[0].candidate_count = rows.length;
  return rows[0] || null;
};

const fuzzyMatch = async (version, normalized, cityLabel) => {
  const { rows } = await query(`
    SELECT
      a.address_mgt_no,
      a.road_address,
      a.sido,
      a.sigungu,
      a.road_name,
      a.legal_emd,
      a.building_main_no,
      a.building_sub_no,
      coalesce(nullif(a.building_name, ''), b.building_name, '') AS building_name,
      b.building_mgt_no,
      b.zip_no,
      coalesce(b.is_apartment, false) AS is_apartment,
      greatest(similarity(a.road_key, $2), similarity(a.full_key, $2)) AS score
    FROM ${ADDRESS_SCHEMA}.address_core a
    LEFT JOIN ${ADDRESS_SCHEMA}.building_core b
      ON b.version_id = a.version_id
     AND b.road_code = a.road_code
     AND b.underground_yn = a.underground_yn
     AND b.building_main_no = a.building_main_no
     AND b.building_sub_no = a.building_sub_no
    WHERE a.version_id = $1
      AND (a.road_key % $2 OR a.full_key % $2)
      AND ($3 = '' OR concat_ws(' ', a.sido, a.sigungu) ILIKE '%' || $3 || '%')
    ORDER BY score DESC, length(a.road_address) ASC
    LIMIT 5
  `, [version, normalized, cleanText(cityLabel)]);
  const winner = rows[0];
  return winner && Number(winner.score) >= 0.42 ? winner : null;
};

const buildingMatch = async (version, normalized, cityLabel) => {
  const { rows } = await query(`
    SELECT
      '' AS address_mgt_no,
      b.road_address,
      b.sido,
      b.sigungu,
      b.road_name,
      b.legal_emd,
      b.building_main_no,
      b.building_sub_no,
      b.building_name,
      b.building_mgt_no,
      b.zip_no,
      b.is_apartment,
      greatest(similarity(b.building_name_key, $2), similarity(concat_ws('', b.road_key, b.building_name_key), $2)) AS score
    FROM ${ADDRESS_SCHEMA}.building_core b
    WHERE b.version_id = $1
      AND b.building_name_key <> ''
      AND (b.building_name_key % $2 OR concat_ws('', b.road_key, b.building_name_key) % $2)
      AND ($3 = '' OR concat_ws(' ', b.sido, b.sigungu) ILIKE '%' || $3 || '%')
    ORDER BY score DESC, b.is_apartment DESC, length(b.road_address) ASC
    LIMIT 5
  `, [version, normalized, cleanText(cityLabel)]);
  const winner = rows[0];
  return winner && Number(winner.score) >= 0.45 ? winner : null;
};

const getFallbackCache = async (normalized) => {
  const { rows } = await query(`
    UPDATE ${ADDRESS_SCHEMA}.address_fallback_cache
    SET hit_count = hit_count + 1, last_used_at = now()
    WHERE normalized_query = $1
    RETURNING result
  `, [normalized]);
  return rows[0]?.result || null;
};

const setFallbackCache = async (rawQuery, normalized, result) => {
  await query(`
    INSERT INTO ${ADDRESS_SCHEMA}.address_fallback_cache (
      normalized_query, raw_query, result
    ) VALUES ($1, $2, $3::jsonb)
    ON CONFLICT (normalized_query) DO UPDATE SET
      raw_query = EXCLUDED.raw_query,
      result = EXCLUDED.result,
      hit_count = ${ADDRESS_SCHEMA}.address_fallback_cache.hit_count + 1,
      last_used_at = now()
  `, [normalized, rawQuery, JSON.stringify(result)]);
};

const fetchJuso = async (keyword) => {
  if (!config.jusoApiKeys.length) return null;
  for (let attempt = 0; attempt < config.jusoApiKeys.length; attempt++) {
    const apiKey = config.jusoApiKeys[currentJusoKey];
    currentJusoKey = (currentJusoKey + 1) % config.jusoApiKeys.length;
    const url = new URL('https://business.juso.go.kr/addrlink/addrLinkApi.do');
    url.searchParams.set('confmKey', apiKey);
    url.searchParams.set('currentPage', '1');
    url.searchParams.set('countPerPage', '1');
    url.searchParams.set('resultType', 'json');
    url.searchParams.set('keyword', keyword);
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const body = await response.json();
      const record = body.results?.juso?.[0];
      if (record) {
        return { ...record, _matchSource: 'juso_fallback', _matchConfidence: 0.72 };
      }
    } catch (error) {
      console.warn('[address-api] JUSO fallback failed:', error.message);
    }
  }
  return null;
};

const getJusoQueries = (rawQuery, cityLabel) => {
  const city = cleanText(cityLabel);
  const district = city ? (city.split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '') : '';
  return [
    city ? `${city} ${rawQuery}` : '',
    district ? `${district} ${rawQuery}` : '',
    rawQuery,
  ].filter((item, index, arr) => item && arr.indexOf(item) === index);
};

const matchAddress = async ({ queryText, cityLabel = '', version = config.activeVersion, allowJusoFallback = true }) => {
  const rawQuery = cleanText(queryText);
  const lookupQuery = formatRoadLookupQuery(rawQuery);
  const normalized = normalizeSearchKey(lookupQuery);
  if (normalized.length < 2) return null;
  const hasRoadNumber = Boolean(parseRoadNumber(rawQuery));
  const exact = await exactRoadMatch(version, rawQuery, cityLabel);
  if (exact) return toAddressResult(exact);
  const exactBuilding = await exactBuildingRoadMatch(version, rawQuery, cityLabel);
  if (exactBuilding) return toAddressResult(exactBuilding, 0.97);
  if (hasRoadNumber && cleanText(cityLabel)) {
    const outOfAreaExact = await exactRoadMatch(version, rawQuery, '')
      || await exactBuildingRoadMatch(version, rawQuery, '');
    if (outOfAreaExact && (hasExplicitMunicipality(rawQuery) || Number(outOfAreaExact.candidate_count || 0) <= 1)) {
      return toAddressResult(outOfAreaExact, 0.96);
    }
  }
  if (hasRoadNumber) {
    if (!allowJusoFallback) return null;
    const cached = await getFallbackCache(normalized);
    if (cached) return cached;
    for (const jusoQuery of getJusoQueries(lookupQuery, cityLabel)) {
      const fallback = await fetchJuso(jusoQuery);
      if (fallback) {
        await setFallbackCache(rawQuery, normalized, fallback);
        return fallback;
      }
    }
    return null;
  }
  const fuzzy = await fuzzyMatch(version, normalized, cityLabel);
  if (fuzzy) return toAddressResult(fuzzy, Math.min(0.94, Number(fuzzy.score) || 0.82));
  const building = await buildingMatch(version, normalized, cityLabel);
  if (building) return toAddressResult(building, Math.min(0.9, Number(building.score) || 0.78));
  if (!allowJusoFallback) return null;
  const cached = await getFallbackCache(normalized);
  if (cached) return cached;
  for (const jusoQuery of getJusoQueries(lookupQuery, cityLabel)) {
    const fallback = await fetchJuso(jusoQuery);
    if (fallback) {
      await setFallbackCache(rawQuery, normalized, fallback);
      return fallback;
    }
  }
  return null;
};

const geocode = async ({ standardRoadAddress, buildingMgtNo = '' }) => {
  if (!config.kakaoRestKey || !standardRoadAddress) return null;
  const normalized = normalizeSearchKey(standardRoadAddress);
  const cacheKey = buildingMgtNo || normalized;
  const { rows } = await query(`
    UPDATE ${ADDRESS_SCHEMA}.address_geocode_cache
    SET last_used_at = now()
    WHERE cache_key = $1
    RETURNING lat, lng, provider
  `, [cacheKey]);
  if (rows[0]?.lat && rows[0]?.lng) return rows[0];
  const url = new URL('https://dapi.kakao.com/v2/local/search/address.json');
  url.searchParams.set('query', standardRoadAddress);
  url.searchParams.set('size', '1');
  const response = await fetch(url, { headers: { Authorization: `KakaoAK ${config.kakaoRestKey}` } });
  const document = response.ok ? (await response.json()).documents?.[0] : null;
  const lat = document?.y ? Number.parseFloat(document.y) : null;
  const lng = document?.x ? Number.parseFloat(document.x) : null;
  await query(`
    INSERT INTO ${ADDRESS_SCHEMA}.address_geocode_cache (
      cache_key, standard_road_address, building_mgt_no, provider_query, lat, lng, failure_count
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (cache_key) DO UPDATE SET
      provider_query = EXCLUDED.provider_query,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      failure_count = ${ADDRESS_SCHEMA}.address_geocode_cache.failure_count + EXCLUDED.failure_count,
      last_used_at = now()
  `, [cacheKey, standardRoadAddress, buildingMgtNo || null, standardRoadAddress, lat, lng, lat && lng ? 0 : 1]);
  return lat && lng ? { lat, lng, provider: 'kakao' } : null;
};

const status = async () => {
  const { rows } = await query(`
    SELECT version_id, reference_date, imported_at, published_at, status, counts, errors
    FROM ${ADDRESS_SCHEMA}.address_db_versions
    WHERE version_id = $1
    LIMIT 1
  `, [config.activeVersion]);
  return rows[0] || null;
};

const server = createServer(async (req, res) => {
  const headers = corsHeaders(req);
  if (req.method === 'OPTIONS') return json(res, 204, {}, headers);
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return json(res, 200, { ok: true, version: config.activeVersion }, headers);
    }
    if (req.method === 'GET' && url.pathname === '/v1/address/db-status') {
      return json(res, 200, { ok: true, data: await status() }, headers);
    }
    if (req.method === 'POST' && url.pathname === '/v1/address/match') {
      const body = await readBody(req);
      const data = await matchAddress({
        queryText: body.query || body.address || '',
        cityLabel: body.cityLabel || '',
        version: body.version || config.activeVersion,
        allowJusoFallback: body.allowJusoFallback !== false,
      });
      return json(res, data ? 200 : 404, { ok: Boolean(data), data }, headers);
    }
    if (req.method === 'POST' && url.pathname === '/v1/address/geocode') {
      const body = await readBody(req);
      const data = await geocode({
        standardRoadAddress: body.standardRoadAddress || body.address || '',
        buildingMgtNo: body.buildingMgtNo || '',
      });
      return json(res, data ? 200 : 404, { ok: Boolean(data), data }, headers);
    }
    return json(res, 404, { ok: false, error: '존재하지 않는 주소 API 엔드포인트입니다.' }, headers);
  } catch (error) {
    console.error('[address-api]', error);
    return json(res, 500, { ok: false, error: error.message }, headers);
  }
});

requireConfig('databaseUrl');
server.listen(config.port, () => {
  console.log(`[address-api] listening on ${config.port}, version ${config.activeVersion}`);
});
