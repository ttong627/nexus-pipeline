import { createServer } from 'node:http';
import { config, requireConfig } from './config.js';
import { query } from './db.js';
import { cleanText, formatRoadLookupQuery, normalizeSearchKey, parseRoadNumber, roadSideKey } from './normalize.js';
import { geocodeRoad, matchDongCoord, parseDongNo } from './vworld.js';
import { judgeCandidate } from './matchGuard.js';
import { learnedRoadKey, learnedRowFromJuso, learnedRowToResult, sigunguToken } from './learnedStore.js';
import { createPurifier } from './purify.js';
import {
  distanceMeters, recommendDaySplit, recommendLoadBalance, recommendSequence, sequenceUnits,
} from './routing/routingService.js';
import { buildDeliveryBrief, pickCoordinate } from './delivery/deliveryBrief.js';
import { verifyDeliveryPosition } from './delivery/positionCheck.js';
import { buildNavigationLinks } from './routing/navigation.js';
import { summarizeDrivers, validateAssignment } from './routing/driverCore.js';
import { buildGeoJson, buildKml, buildMapPayload } from './routing/mapExport.js';
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
    // ★출입구 2차 조회(도로코드+본·부번) 키 — 이걸 안 실어 보내면 findEntrance 의
    //   2차 경로가 영원히 안 탄다. 건물 매칭 주소는 address_mgt_no 가 비어 있어
    //   1차 경로도 못 쓰므로, 그 경우 이 키들이 유일한 출입구 조회 수단이다.
    roadCode: record.road_code || '',
    undergroundYn: record.underground_yn || '0',
    legalDongCode: record.legal_dong_code || '',
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
    _matchSource: record._matchKind ? `${source}:${record._matchKind}` : source,
    _matchConfidence: confidence,
    // 유사매칭으로 채택했으나 확신이 안 서는 건 — 호출부가 확인필요로 올린다(A-12).
    // 조용히 통과시키면 신축 오매칭이 그대로 배송으로 간다.
    _needsReview: Boolean(record._needsReview),
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
      a.road_code,
      a.underground_yn,
      a.legal_dong_code,
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
      b.road_code,
      b.underground_yn,
      '' AS legal_dong_code,
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

// ══════════════════════════════════════════════════════════════════
//  ★외부(JUSO)·학습 결과가 **물어본 그 주소**인지 검증한다 (형 지시 2026-08-11)
//  "해당주소로 찾고 그 주소를 규칙화 하고 정제 하는거야."
//  JUSO 는 키워드 검색이라 후보가 여럿이면 하나를 조용히 골라 돌려준다. 그게
//  물어본 도로명·건물번호와 다르면 그건 정제가 아니라 **주소 치환**이다 → 버린다.
// ══════════════════════════════════════════════════════════════════
const sameAddressAsQuery = (record, queryRoad) => {
  if (!queryRoad) return true;               // 번호 없는 질의는 애초에 여기까지 오지 않는다
  if (!record) return false;
  const verdict = judgeCandidate({
    rawQuery: '',
    kind: 'fuzzy',
    queryRoad,
    candidate: {
      score: 1,
      building_main_no: record.buldMnnm ?? record.building_main_no,
      building_sub_no: record.buldSlno ?? record.building_sub_no ?? 0,
      building_name: record.bdNm || record.building_name || '',
    },
  });
  if (!verdict.accept) {
    console.log(`[match] 외부 결과가 질의와 다른 주소 — 폐기(${verdict.reason}) :: ${record.roadAddr || ''}`);
  }
  return verdict.accept;
};

// ── 학습 주소(address_learned) ─────────────────────────────────────
// 형 지시 2026-08-11: 명단에 있는데 DB에 없으면 API로 찾아 **DB에 반영**한다.
// 버전독립 테이블이라 월 재적재에도 살아남는다(sql/learned.sql).
// ★키는 표기가 아니라 뜻이다 — 시군구+도로명+본번-부번(learnedStore.js 주석 참조).
// ★테이블이 아직 없어도(마이그레이션 전 배포) 매칭 전체가 죽으면 안 된다.
//   42P01(undefined_table)은 "학습분 없음"으로 조용히 넘긴다.
let learnedTableMissing = false;
const learnedMatch = async (rawQuery, cityLabel) => {
  if (learnedTableMissing) return null;
  //   시군구가 없으면 조회하지 않는다: 도로명은 전국에서 겹쳐(동대문구 황물로7길 ↔ 수원 황물로7길)
  //   지역 없이 묶으면 A-30이 막아온 타지역 오매칭이 학습분 뒷문으로 되살아난다.
  const parsed = parseRoadNumber(rawQuery);
  const sigungu = sigunguToken(cityLabel);
  if (!parsed || !sigungu) return null;
  const key = learnedRoadKey({
    sigungu,
    roadName: parsed.roadName,
    buildingMainNo: parsed.buildingMainNo,
    buildingSubNo: parsed.buildingSubNo,
  });
  if (!key) return null;
  try {
    return await nullOnQueryTimeout('learnedMatch', async () => {
      const { rows } = await query(`
        UPDATE ${ADDRESS_SCHEMA}.address_learned
        SET hit_count = hit_count + 1, last_used_at = now()
        WHERE road_key = $1
        RETURNING *
      `, [key], { timeoutMs: config.fallbackTimeoutMs });
      return learnedRowToResult(rows[0] || null);
    });
  } catch (error) {
    if (error?.code === '42P01') {
      learnedTableMissing = true;   // 매 요청마다 실패 로그를 쌓지 않는다
      console.warn('[address-learned] 테이블 없음 — 학습 조회를 건너뛴다(sql/learned.sql 적용 필요)');
      return null;
    }
    throw error;
  }
};

// 외부 API로 확인된 주소를 학습분에 적재한다. 실패해도 매칭 자체는 성공시켜야 하므로
// 예외를 삼킨다 — 학습은 부가기능이고, 여기서 던지면 정상 폴백이 500으로 둔갑한다.
const learnAddress = async (record, { source = 'juso', confidence = 0.72 } = {}) => {
  try {
    const row = learnedRowFromJuso(record, { source, confidence });
    if (!row) return;
    await query(`
      INSERT INTO ${ADDRESS_SCHEMA}.address_learned (
        road_key, road_address, road_name, building_main_no, building_sub_no,
        underground_yn, road_code, sido, sigungu, legal_emd, legal_dong_code,
        building_name, building_mgt_no, address_mgt_no, zip_no, is_apartment, source, confidence
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (road_key) DO UPDATE SET
        road_address = EXCLUDED.road_address,
        building_name = CASE WHEN EXCLUDED.building_name <> '' THEN EXCLUDED.building_name
                             ELSE ${ADDRESS_SCHEMA}.address_learned.building_name END,
        hit_count = ${ADDRESS_SCHEMA}.address_learned.hit_count + 1,
        last_used_at = now()
    `, [
      row.road_key, row.road_address, row.road_name, row.building_main_no, row.building_sub_no,
      row.underground_yn, row.road_code, row.sido, row.sigungu, row.legal_emd, row.legal_dong_code,
      row.building_name, row.building_mgt_no, row.address_mgt_no, row.zip_no, row.is_apartment,
      row.source, row.confidence,
    ]);
  } catch (error) {
    console.warn('[address-learned] 적재 실패(무시하고 진행):', error.message);
  }
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
  // ★학습 주소를 정확매칭 바로 뒤에 본다 — 퍼지(옆 건물)보다, 외부 API보다 앞이다.
  //   신축이라 전체분 DB엔 없지만 지난번에 API로 확인해 둔 주소는 여기서 즉시 잡힌다.
  const queryRoad = parseRoadNumber(rawQuery);
  const learned = await learnedMatch(rawQuery, cityLabel);
  if (learned && sameAddressAsQuery(learned, queryRoad)) return learned;

  if (hasRoadNumber) {
    if (!allowJusoFallback) return null;
    const cached = await getFallbackCache(normalized);
    // ★캐시가 학습을 가로막지 않게 한다(2026-08-11 배포 검증에서 실제로 걸림).
    //   캐시에 있으면 JUSO를 안 타므로 learnAddress 가 영영 호출되지 않아,
    //   이미 캐시된 주소는 **영원히 학습분에 못 들어갔다**.
    //   여기 도달했다는 건 위 learnedMatch 가 이미 빗나갔다는 뜻 → 지금 채워 넣는다.
    //   한 번 학습되면 다음부터는 learnedMatch 가 먼저 잡아 이 경로로 오지 않는다.
    if (cached) {
      if (!sameAddressAsQuery(cached, queryRoad)) return null;   // 치환된 캐시는 쓰지 않는다
      if (sigunguToken(cityLabel)) await learnAddress(cached);
      return cached;
    }
    for (const jusoQuery of getJusoQueries(lookupQuery, cityLabel)) {
      const fallback = await fetchJuso(jusoQuery);
      if (fallback) {
        // 물어본 주소와 다르면 정제가 아니라 치환이다 — 저장도 학습도 하지 않는다
        if (!sameAddressAsQuery(fallback, queryRoad)) continue;
        await setFallbackCache(rawQuery, normalized, fallback);
        await learnAddress(fallback);   // 캐시에만 두지 않고 DB(학습분)에 반영한다
        return fallback;
      }
    }
    return null;
  }
  // ══════════════════════════════════════════════════════════════
  //  ★건물명으로 주소를 찾는 것은 금지다 (형 지시 2026-08-11 · 절대 되돌리지 말 것)
  //
  //  "명단정제자나 해당주소를 바꾸거나 하면 안돼. 없는 건물이나 오타일경우만 기록을
  //   남기고 변경해야해. 건물명으로 주소 매칭한다던지하는 것은 절대 금지야.
  //   해당주소로 찾고 그 주소를 규칙화 하고 정제 하는거야."
  //
  //  여기까지 왔다는 건 **건물번호가 없다**는 뜻이다(hasRoadNumber=false).
  //  그 상태에서 fuzzy/building/JUSO 키워드로 찾으면 남의 주소를 가져다 붙이게 된다.
  //  실측(2026-08-11): "우남아파트"로 조회하니 도당동의 **다른** 우남아파트
  //  (부천로366번길 93)가 나왔다. 명단의 실제 주소는 삼작로256번길 16이다.
  //  이름이 같은 단지가 한 동네에 둘 있으면 무엇을 해도 구분할 수 없다.
  //
  //  → 주소를 지어내지 않고 **미매칭**으로 돌려준다. 호출부가 확인필요로 올리고
  //    담당자가 원본을 보고 판단한다(A-12). 미매칭은 되돌릴 수 있지만
  //    잘못 바뀐 주소는 그대로 배송으로 나간다.
  // ══════════════════════════════════════════════════════════════
  console.log(`[match] 건물번호 없음 — 주소 치환 금지로 미매칭 처리 :: ${rawQuery.slice(0, 40)}`);
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
    // 학습 주소 현황 — "명단엔 있는데 전체분 DB엔 아직 없는 주소"(신축 유력) 목록.
    // 담당자가 이 목록으로 실제 신축인지, 오타인지 판단한다(형 지시 2026-08-11).
    if (req.method === 'GET' && url.pathname === '/v1/address/learned-status') {
      try {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500);
        const { rows: sum } = await query(`
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE promoted_version_id IS NULL)::int AS pending,
                 coalesce(sum(hit_count), 0)::int AS hits
          FROM ${ADDRESS_SCHEMA}.address_learned
        `);
        const { rows: pending } = await query(`
          SELECT road_address, building_name, sigungu, source, hit_count, learned_at
          FROM ${ADDRESS_SCHEMA}.address_learned
          WHERE promoted_version_id IS NULL
          ORDER BY hit_count DESC, learned_at DESC
          LIMIT $1
        `, [limit]);
        return json(res, 200, { ok: true, data: { ...sum[0], pending } }, headers);
      } catch (error) {
        if (error?.code === '42P01') {
          return json(res, 200, { ok: true, data: { total: 0, pending: 0, hits: 0, pending_list: [], note: 'address_learned 미생성(sql/learned.sql 적용 필요)' } }, headers);
        }
        throw error;
      }
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
    // 배송완료 위치 검증(REQ-027) — 배송지에 가지 않고 완료를 누르는 것을 잡는다.
    // ★코어는 판정만 한다. 완료를 막을지는 호출자가 정한다(현장을 멈추는 것이 더 큰 사고일 수 있다).
    // ★DB 를 쓰지 않는 순수 계산이라 부하가 없다.
    if (req.method === 'POST' && url.pathname === '/v1/delivery/verify-position') {
      const body = await readBody(req);
      const data = verifyDeliveryPosition({
        siteLat: body.siteLat,
        siteLng: body.siteLng,
        actualLat: body.actualLat,
        actualLng: body.actualLng,
        accuracyM: body.accuracyM,
        thresholdM: body.thresholdM,
      });
      return json(res, 200, { ok: true, data }, headers);
    }
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
      // ★실패를 삼키되 **숨기지는 않는다** — 응답의 coverage 는 "없다"와 "못 읽었다"를
      //   똑같이 false 로 표시한다. 그러면 DB 장애 중에도 화면은 "정보 없음"으로만 보여
      //   원인을 영영 못 찾는다. 실패 사유를 응답에 실어 호출부가 구분하게 한다.
      const lookupErrors = [];
      const safe = (label, p) => p.catch((error) => {
        console.error(`[delivery-resolve] ${label} 조회 실패:`, error.message);
        lookupErrors.push({ source: label, message: String(error.message || error) });
        return null;
      });
      const [entrance, building, cached] = await Promise.all([
        safe('entrance', findEntrance(query, ADDRESS_SCHEMA, {
          addressMgtNo: address.addressMgtNo || address._addressMgtNo || '',
          // 매칭 결과가 1순위 — 호출부가 도로코드를 알 리 없다(body 는 폴백일 뿐).
          roadCode: address.roadCode || body.roadCode || '',
          undergroundYn: address.undergroundYn || body.undergroundYn || '0',
          mainNo: address.buildingMainNo,
          subNo: address.buildingSubNo,
          legalDongCode: address.legalDongCode || body.legalDongCode || '',
        })),
        safe('building_ext', findBuildingExt(query, ADDRESS_SCHEMA, address.buildingMgtNo)),
        safe('coord_cache', findCachedCoordinate(query, ADDRESS_SCHEMA, {
          buildingMgtNo: address.buildingMgtNo,
          standardRoadAddress: address.standardRoadAddress,
        })),
      ]);

      const coord = pickCoordinate(collectCoordinates(entrance, cached));
      const brief = buildDeliveryBrief({ address, coord, building, entrance });
      // ★네비 링크를 함께 싣는다 — 기사앱이 한 번 호출로 "어디로·어떻게 갈지"를 다 얻는다.
      //   코어가 고른 좌표(국가 출입구 우선)로 만들므로, 앱이 추정 좌표로 안내할 일이 없다.
      const navigation = buildNavigationLinks({
        lat: coord ? coord.lat : null,
        lng: coord ? coord.lng : null,
        // ⚠️수령인 이름을 넣지 않는다(PII) — 링크는 외부 앱·히스토리에 남는다.
        name: (building && building.building_name) || address.buildingName || '',
        address: address.standardRoadAddress || '',
      });
      return json(res, 200, {
        ok: true,
        data: {
          address,
          coordinate: coord,
          building,
          entrance,
          brief,
          navigation: { ...navigation, coordinateSource: coord ? coord.kind : null },
          // 빈 배열이면 "부가정보가 없다", 값이 있으면 "못 읽었다" — 화면이 구분해 말할 수 있다.
          lookupErrors,
          degraded: lookupErrors.length > 0,
        },
      }, headers);
    }
    // ★배송 순번·일정 코어(모듈 ⑦) — 클라 전용이던 엔진을 서버로 승격해 노출한다.
    //   여기까지 와야 스튜디오 생성물에 순번·일자분할이 이식된다.
    //   ⚠️DB 를 쓰지 않으므로 Cloud SQL 부하는 없지만, CPU 는 쓴다 → 건수 상한을 둔다.
    if (req.method === 'POST' && url.pathname.startsWith('/v1/routing/')) {
      const body = await readBody(req);
      const records = Array.isArray(body.records) ? body.records : [];
      // 상한 근거: 한 기사 하루 배송이 수백 건이다. 2,000건이면 여러 기사·여러 날을 한 번에
      // 넣는 규모라 배치로 처리해야 한다(순번 알고리즘은 건수의 제곱에 가깝게 무거워진다).
      if (records.length > 2000) {
        return json(res, 413, { ok: false, error: '한 번에 2000건까지 처리합니다.' }, headers);
      }
      const action = url.pathname.slice('/v1/routing/'.length);
      if (action === 'sequence') {
        return json(res, 200, { ok: true, data: recommendSequence({ records, depot: body.depot }) }, headers);
      }
      if (action === 'units') {
        return json(res, 200, { ok: true, data: sequenceUnits({ records }) }, headers);
      }
      if (action === 'day-split') {
        return json(res, 200, {
          ok: true,
          data: recommendDaySplit({
            records,
            numDays: body.numDays ?? null,
            maxLoadPerDay: body.maxLoadPerDay ?? null,
            maxPerDay: body.maxPerDay ?? null,
            depot: body.depot ?? null,
          }),
        }, headers);
      }
      if (action === 'load-balance') {
        return json(res, 200, {
          ok: true,
          data: recommendLoadBalance({
            records,
            drivers: body.drivers || [],
            driverPins: body.driverPins || {},
            strategy: body.strategy || 'pca',
          }),
        }, headers);
      }
      if (action === 'distance') {
        return json(res, 200, { ok: true, data: distanceMeters({ from: body.from, to: body.to }) }, headers);
      }
      return json(res, 404, { ok: false, error: `알 수 없는 routing 동작: ${action}` }, headers);
    }
    // ★배송지도 내보내기(모듈 ⑩) — 화면이 아니라 **데이터**를 코어가 만든다.
    //   앱마다 지도 화면은 달라도 KML/GeoJSON 규격은 하나여야 한다.
    //   ★★기본은 비식별이다. 수령인 이름·연락처는 includeContact 를 명시해야만 들어가고,
    //     들어가면 piiIncluded=true 로 알린다(KML 은 링크로 공유되는 파일이다).
    if (req.method === 'POST' && url.pathname.startsWith('/v1/map/')) {
      const body = await readBody(req);
      const records = Array.isArray(body.records) ? body.records : [];
      if (records.length > 5000) {
        return json(res, 413, { ok: false, error: '한 번에 5000건까지 처리합니다.' }, headers);
      }
      const opts = {
        records,
        title: body.title || '배송경로',
        color: body.color || '#3b82f6',
        includeContact: body.includeContact === true,   // ★명시적 true 만 허용
      };
      const action = url.pathname.slice('/v1/map/'.length);
      if (action === 'kml') return json(res, 200, { ok: true, data: buildKml(opts) }, headers);
      if (action === 'geojson') return json(res, 200, { ok: true, data: buildGeoJson(opts) }, headers);
      if (action === 'payload') return json(res, 200, { ok: true, data: buildMapPayload(opts) }, headers);
      return json(res, 404, { ok: false, error: `알 수 없는 map 동작: ${action}` }, headers);
    }
    // ★기사 관리(모듈 ⑧) — 코어는 기사 명부를 저장하지 않는다(각 앱이 자기 DB에 갖고 있다).
    //   코어가 주는 건 **판단**이다: 누가 얼마나 지고 있는가, 배정이 규칙을 어겼는가.
    if (req.method === 'POST' && url.pathname.startsWith('/v1/drivers/')) {
      const body = await readBody(req);
      const records = Array.isArray(body.records) ? body.records : [];
      if (records.length > 5000) {
        return json(res, 413, { ok: false, error: '한 번에 5000건까지 처리합니다.' }, headers);
      }
      const action = url.pathname.slice('/v1/drivers/'.length);
      if (action === 'summary') {
        return json(res, 200, {
          ok: true, data: summarizeDrivers({ records, drivers: body.drivers || [] }),
        }, headers);
      }
      if (action === 'validate') {
        return json(res, 200, {
          ok: true, data: validateAssignment({ records, drivers: body.drivers || [] }),
        }, headers);
      }
      return json(res, 404, { ok: false, error: `알 수 없는 drivers 동작: ${action}` }, headers);
    }
    // 좌표를 이미 아는 호출부용(순번 결과를 그대로 넘기는 경우 등).
    if (req.method === 'POST' && url.pathname === '/v1/navigation/links') {
      const body = await readBody(req);
      return json(res, 200, {
        ok: true,
        data: buildNavigationLinks({
          lat: body.lat, lng: body.lng, name: body.name || '', address: body.address || '',
        }),
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
