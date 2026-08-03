import { createServer } from 'node:http';
import { config, requireConfig } from './config.js';
import { query } from './db.js';
import { cleanText, formatRoadLookupQuery, normalizeSearchKey, parseRoadNumber, roadSideKey } from './normalize.js';
import { geocodeRoad, matchDongCoord, parseDongNo } from './vworld.js';
import { createPurifier } from './purify.js';
import { buildDeliveryBrief, pickCoordinate } from './delivery/deliveryBrief.js';
import {
  collectCoordinates, findBuildingExt, findCachedCoordinate, findEntrance,
} from './delivery/resolveDelivery.js';

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

// 퍼지·건물명 폴백은 statement_timeout(57014)에 걸릴 수 있다. 그건 장애가 아니라
// "상한 안에 쓸 만한 후보를 못 찾았다"는 뜻이므로 **미매칭(null)** 으로 돌려준다.
// 여기서 throw하면 정상 폴백 실패가 500으로 둔갑해, 이전보다 사용자 경험이 나빠진다.
// ※ exact 매칭(7~14ms)은 감싸지 않는다 — 거기서 상한에 걸리면 진짜 이상 신호다.
const nullOnQueryTimeout = async (label, run) => {
  try {
    return await run();
  } catch (error) {
    if (error?.code === '57014') {
      console.warn(`[address-api] ${label} 쿼리 상한 초과 — 미매칭 처리(커넥션 점유 차단)`);
      return null;
    }
    throw error;
  }
};

const fuzzyMatch = async (version, normalized, cityLabel) => nullOnQueryTimeout('fuzzyMatch', async () => {
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
});

const buildingMatch = async (version, normalized, cityLabel) => nullOnQueryTimeout('buildingMatch', async () => {
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
      greatest(similarity(b.building_name_key, $2), similarity((coalesce(b.road_key, '') || coalesce(b.building_name_key, '')), $2)) AS score
    FROM ${ADDRESS_SCHEMA}.building_core b
    WHERE b.version_id = $1
      AND b.building_name_key <> ''
      -- concat_ws는 STABLE이라 인덱스 불가 → 동등한 불변식(coalesce||coalesce)으로 교체.
      --   이 식에 GIN 트리그램 인덱스(building_core_roadbld_trgm)를 태워 28s seq scan → ~0.4s.
      AND (b.building_name_key % $2 OR (coalesce(b.road_key, '') || coalesce(b.building_name_key, '')) % $2)
      AND ($3 = '' OR concat_ws(' ', b.sido, b.sigungu) ILIKE '%' || $3 || '%')
    ORDER BY score DESC, b.is_apartment DESC, length(b.road_address) ASC
    LIMIT 5
  `, [version, normalized, cleanText(cityLabel)]);
  const winner = rows[0];
  return winner && Number(winner.score) >= 0.45 ? winner : null;
});

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
  if (!standardRoadAddress) return null;
  const normalized = normalizeSearchKey(standardRoadAddress);
  const cacheKey = buildingMgtNo || normalized;
  const { rows } = await query(`
    UPDATE ${ADDRESS_SCHEMA}.address_geocode_cache
    SET last_used_at = now()
    WHERE cache_key = $1
    RETURNING lat, lng, provider
  `, [cacheKey]);
  if (rows[0]?.lat && rows[0]?.lng) return rows[0];

  // 폴백 체인: VWorld 지오코더(정부 정합성 우선) → Kakao
  let lat = null;
  let lng = null;
  let provider = null;
  const vw = await geocodeRoad(standardRoadAddress);
  if (vw?.lat && vw?.lng) {
    lat = vw.lat;
    lng = vw.lng;
    provider = 'vworld';
  }
  if (lat == null && config.kakaoRestKey) {
    const url = new URL('https://dapi.kakao.com/v2/local/search/address.json');
    url.searchParams.set('query', standardRoadAddress);
    url.searchParams.set('size', '1');
    const response = await fetch(url, { headers: { Authorization: `KakaoAK ${config.kakaoRestKey}` } });
    const document = response.ok ? (await response.json()).documents?.[0] : null;
    if (document?.y && document?.x) {
      lat = Number.parseFloat(document.y);
      lng = Number.parseFloat(document.x);
      provider = 'kakao';
    }
  }
  await query(`
    INSERT INTO ${ADDRESS_SCHEMA}.address_geocode_cache (
      cache_key, standard_road_address, building_mgt_no, provider_query, lat, lng, failure_count, provider
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (cache_key) DO UPDATE SET
      provider_query = EXCLUDED.provider_query,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      provider = EXCLUDED.provider,
      failure_count = ${ADDRESS_SCHEMA}.address_geocode_cache.failure_count + EXCLUDED.failure_count,
      last_used_at = now()
  `, [cacheKey, standardRoadAddress, buildingMgtNo || null, standardRoadAddress, lat, lng, lat && lng ? 0 : 1, provider || 'kakao']);
  return lat && lng ? { lat, lng, provider } : null;
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

// P7 Phase2 ⓒ-2: 정제기(공용 코어 + 서버 deps). matchAddress를 in-process로 넘겨
// 자기 자신에게 HTTP를 치지 않는다. 학습사전은 dictStore가 TTL 캐시로 관리한다.
const purifier = createPurifier({ matchAddress });

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
    // ★적재해둔 국가 데이터를 실제로 꺼내 쓰는 자리(설계서 P4 ⓔ "조회 연결").
    //   출입구 좌표 1,281만 건을 적재하고도 읽는 코드가 0건이었다. 여기서 해소한다.
    //   match(주소 확정) → entrance_core(측량 좌표) → building_ext(엘베·층) → 기사용 브리프.
    if (req.method === 'POST' && url.pathname === '/v1/delivery/resolve') {
      const body = await readBody(req);
      const address = await matchAddress({
        queryText: body.query || body.address || '',
        cityLabel: body.cityLabel || '',
        version: body.version || config.activeVersion,
        allowJusoFallback: body.allowJusoFallback !== false,
      });
      if (!address) return json(res, 404, { ok: false, data: null }, headers);

      // 각 조회는 독립이고 하나가 없어도 나머지는 유효하다 → 실패를 전파하지 않고 null 로 떨어뜨린다.
      // (설계서 §연쇄장애: 부가정보 조회 실패가 주소 확정까지 깨뜨리면 안 된다)
      const safe = (p) => p.catch((error) => {
        console.error('[delivery-resolve] 부가조회 실패:', error.message);
        return null;
      });
      const [entrance, building, cached] = await Promise.all([
        safe(findEntrance(query, ADDRESS_SCHEMA, {
          addressMgtNo: address.addressMgtNo || address._addressMgtNo || '',
          roadCode: body.roadCode || '',
          undergroundYn: body.undergroundYn || '0',
          mainNo: address.buildingMainNo,
          subNo: address.buildingSubNo,
          legalDongCode: body.legalDongCode || '',
        })),
        safe(findBuildingExt(query, ADDRESS_SCHEMA, address.buildingMgtNo)),
        safe(findCachedCoordinate(query, ADDRESS_SCHEMA, {
          buildingMgtNo: address.buildingMgtNo,
          standardRoadAddress: address.standardRoadAddress,
        })),
      ]);

      const coord = pickCoordinate(collectCoordinates(entrance, cached));
      const brief = buildDeliveryBrief({ address, coord, building, entrance });
      return json(res, 200, {
        ok: true,
        data: {
          address,
          coordinate: coord,
          building,
          entrance,
          brief,
        },
      }, headers);
    }
    if (req.method === 'POST' && url.pathname === '/v1/address/geocode') {
      const body = await readBody(req);
      const data = await geocode({
        standardRoadAddress: body.standardRoadAddress || body.address || '',
        buildingMgtNo: body.buildingMgtNo || '',
      });
      return json(res, data ? 200 : 404, { ok: Boolean(data), data }, headers);
    }
    if (req.method === 'POST' && url.pathname === '/v1/building/dong-coords') {
      const body = await readBody(req);
      const road = body.roadAddress || body.standardRoadAddress || '';
      const dongNo = parseDongNo(body.dongNo || body.complexName || '');
      const complexKey = normalizeSearchKey(body.complexName || body.buildingName || '');
      // 캐시 키에 단지명 포함(2026-07-27): 같은 도로명에 걸친 인접 단지가 같은 동번호를 가질 때 좌표 오염 차단.
      const cacheKey = (dongNo && road) ? `dong:${normalizeSearchKey(road)}#${dongNo}#${complexKey}#v3` : ''; // v3: bbox중심 복구·면적중심 버그값 무효화
      // 캐시 조회 (같은 아파트 반복 조회 시 VWorld 재호출 방지)
      if (cacheKey) {
        const { rows } = await query(`
          UPDATE ${ADDRESS_SCHEMA}.address_geocode_cache SET last_used_at = now()
          WHERE cache_key = $1 RETURNING lat, lng, floors, match_type, dong_no
        `, [cacheKey]);
        if (rows[0]?.lat && rows[0]?.lng) {
          return json(res, 200, { ok: true, data: {
            lat: rows[0].lat, lng: rows[0].lng, floors: rows[0].floors,
            buildName: body.complexName || '', matched: rows[0].match_type || 'dong',
            dongNo: rows[0].dong_no || dongNo, cached: true,
          } }, headers);
        }
      }
      const data = await matchDongCoord({
        roadAddress: road,
        complexName: body.complexName || body.buildingName || '',
        dongNo: body.dongNo || '',
        sigungu: body.sigungu || '',
      });
      // 캐시 저장 (동/단지 매칭 성공분만 — centroid 폴백은 재시도 여지 남김)
      if (data && cacheKey && (data.matched === 'dong' || data.matched === 'complex')) {
        await query(`
          INSERT INTO ${ADDRESS_SCHEMA}.address_geocode_cache
            (cache_key, standard_road_address, provider_query, provider, lat, lng, dong_no, floors, match_type)
          VALUES ($1, $2, $3, 'vworld', $4, $5, $6, $7, $8)
          ON CONFLICT (cache_key) DO UPDATE SET
            lat = EXCLUDED.lat, lng = EXCLUDED.lng, floors = EXCLUDED.floors,
            match_type = EXCLUDED.match_type, last_used_at = now()
        `, [cacheKey, road, road, data.lat, data.lng, data.dongNo || dongNo, data.floors, data.matched]);
      }
      return json(res, data ? 200 : 404, { ok: Boolean(data), data }, headers);
    }
    // ── P7 Phase2 ⓒ-2: 주소 규격화(정제) 배치 — 클라와 **같은 코어**(shared/purifyCore.js) ──
    // 클라 processAddress와 동일한 키를 돌려준다. 좌표는 범위 밖(includeCoords:false 고정).
    if (req.method === 'POST' && url.pathname === '/v1/address/purify') {
      const body = await readBody(req);
      const records = Array.isArray(body.records) ? body.records : [];
      if (!records.length) {
        return json(res, 400, { ok: false, error: 'records 배열이 필요합니다.' }, headers);
      }
      if (records.length > config.purifyMaxRecords) {
        // 한 요청이 커넥션 풀을 오래 붙잡지 않도록 상한을 둔다(2026-07-30 풀 경합 사고 방지).
        return json(res, 413, {
          ok: false,
          error: `한 번에 최대 ${config.purifyMaxRecords}건까지 정제합니다(요청 ${records.length}건).`,
        }, headers);
      }
      const data = await purifier.purifyRecords(records);
      return json(res, 200, { ok: true, count: data.length, data }, headers);
    }
    if (req.method === 'GET' && url.pathname === '/v1/address/dict-status') {
      // 학습사전이 실제로 로드됐는지 확인용(권한 미부여 시 전부 0으로 보인다).
      await purifier.dictStore.refresh();
      return json(res, 200, { ok: true, data: purifier.dictStore.stats() }, headers);
    }
    return json(res, 404, { ok: false, error: '존재하지 않는 주소 API 엔드포인트입니다.' }, headers);
  } catch (error) {
    console.error('[address-api]', error);
    return json(res, 500, { ok: false, error: error.message }, headers);
  }
});

// 기존 실DB에 동별좌표 캐시 컬럼 자동 마이그레이션 (idempotent)
const ensureGeocodeColumns = async () => {
  await query(`
    ALTER TABLE ${ADDRESS_SCHEMA}.address_geocode_cache
      ADD COLUMN IF NOT EXISTS dong_no text,
      ADD COLUMN IF NOT EXISTS floors integer,
      ADD COLUMN IF NOT EXISTS match_type text
  `);
};

// 2차 방어선 — 서드파티 라이브러리가 우리 try/catch 밖에서 던지는 비동기 예외로
// API 프로세스가 통째로 죽는 것을 막는다(2026-08-01 firebase-admin ADC 미설정 시 실측).
// 삼키기가 아니라 **기록하고 계속 서비스**하는 것이 목적이다 — 요청 하나의 실패가
// 전체 정지로 번지면 안 된다. 원인 수정은 각 호출부에서 별도로 한다.
process.on('unhandledRejection', (reason) => {
  console.error('[address-api] 처리되지 않은 비동기 예외(서비스는 계속):', reason?.message || reason);
});

requireConfig('databaseUrl');
try {
  await ensureGeocodeColumns();
} catch (error) {
  console.error('[migrate] geocode 캐시 컬럼 마이그레이션 실패:', error.message);
}
server.listen(config.port, () => {
  console.log(`[address-api] listening on ${config.port}, version ${config.activeVersion}`);
});
