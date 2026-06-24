'use strict';
// 전국 주소 DB 매칭 + 좌표 서비스
// - 모든 주소정보(도로명·법정동·지번·건물명·건물번호·상세)는 전국 DB(nexus_address)에서
// - 좌표는 geocode_cache 우선, 캐시미스만 카카오 1회 호출 후 DB 저장
// - JUSO API 미사용
const express = require('express');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8080;
const DB_VERSION = process.env.ADDRESS_DB_VERSION || '';
const KAKAO_KEY = process.env.KAKAO_REST_KEY || '';
const ALLOWED = (process.env.ADDRESS_ALLOWED_ORIGINS || 'https://logis-op.web.app')
  .split(',').map((s) => s.trim()).filter(Boolean);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});
pool.on('error', (e) => console.error('[pg pool error]', e.message));

// ── 정규화 ─────────────────────────────────────────────
const norm = (s) => String(s || '').replace(/\s+/g, '').trim();

// (query, cityLabel) → 도로명+번호 정규화 (시도/시군구 토큰 제거 후 도로명+번호 추출)
function buildRoadPart(query, cityLabel) {
  let q = norm(query);
  String(cityLabel || '').split(/\s+/).filter(Boolean).forEach((tok) => {
    const t = norm(tok);
    if (t && q.startsWith(t)) q = q.slice(t.length);
  });
  const mm = q.match(/^([가-힣A-Za-z0-9]+(?:대로|로|길))(\d+(?:-\d+)?)/);
  return mm ? mm[1] + mm[2] : '';
}

// address_core: 지번 포함 표준주소(98만). building_core: 전국 건물주소(1072만) — road_key 동일 포맷.
// 도시 주소 다수가 address_core에 없고 building_core에만 존재 → 둘 다 조회해야 DB 매칭율 극대화(JUSO 폴백 최소화).
// building_core는 jibun_* 컬럼이 없으므로 NULL 캐스팅으로 toApiResult 스키마를 통일.
const ADDR_SELECT = `SELECT sido, sigungu, legal_emd, legal_ri, jibun_san_yn, jibun_main_no, jibun_sub_no,
  road_name, road_address, building_name, building_main_no, building_sub_no, address_mgt_no
  FROM nexus_address.address_core`;
const BLDG_SELECT = `SELECT sido, sigungu, legal_emd, legal_ri,
  NULL::text AS jibun_san_yn, NULL::integer AS jibun_main_no, NULL::integer AS jibun_sub_no,
  road_name, road_address, building_name, building_main_no, building_sub_no, building_mgt_no AS address_mgt_no
  FROM nexus_address.building_core`;

// 단일 테이블 road_key 매칭: 1순위 정확 → 2순위 본번 동일·부번 임의
// DB_VERSION 설정 시 version_id로 격리(버전 공존 시 활성버전만 매칭, 무중단 버전 전환 보장).
const VER_COND = DB_VERSION ? 'version_id = $3 AND ' : '';
const verParams = (cityKey, roadPart) => DB_VERSION ? [cityKey, roadPart, DB_VERSION] : [cityKey, roadPart];
async function matchInTable(select, cityKey, roadPart) {
  // 정확 매칭만. `road_key LIKE cityKey%roadPart` 는 끝에 와일드카드가 없어 roadPart로 끝나는 행만 매칭한다
  // (= "박석로25번길32" 검색에 "박석로25번길32-5" 는 안 잡히는 정확 경계).
  // ⚠️ 유사매칭(근사매칭) 절대 금지 — 입력 건물번호와 다른 부번을 반환하면 도로명주소 변조가 된다.
  //   (과거 2순위 "본번 동일·부번 임의" LIKE ...'-%' 가 "박석로25번길 32" → "32-5"로 둔갑시켜 제거함)
  const r = await pool.query(
    `${select} WHERE ${VER_COND}road_key LIKE $1 || '%' || $2 ORDER BY length(road_key) ASC LIMIT 1`,
    verParams(cityKey, roadPart)
  );
  return r.rows[0] || null;
}

async function matchRow(query, cityLabel) {
  const cityKey = norm(cityLabel);
  const roadPart = buildRoadPart(query, cityLabel);
  if (!roadPart || roadPart.length < 2) return null;
  // 지번 포함 표준주소(address_core) 우선 → 미스 시 전국 건물주소(building_core) 폴백
  return (await matchInTable(ADDR_SELECT, cityKey, roadPart))
      || (await matchInTable(BLDG_SELECT, cityKey, roadPart));
}

// DB row → 엔진 호환(JUSO 형식) 응답
function toApiResult(row) {
  if (!row) return null;
  const san = row.jibun_san_yn === '1' ? '산 ' : '';
  const sub = row.jibun_sub_no ? `-${row.jibun_sub_no}` : '';
  // building_core 매칭은 jibun_* 컬럼이 없음 → 지번주소 생략(빈 문자열)
  const jibun = row.jibun_main_no == null ? '' :
    `${row.sido} ${row.sigungu} ${row.legal_emd}${row.legal_ri ? ' ' + row.legal_ri : ''} ${san}${row.jibun_main_no}${sub}`.replace(/\s+/g, ' ').trim();
  return {
    roadAddrPart1: row.road_address,
    roadAddr: row.road_address,
    standardRoadAddress: row.road_address,
    emdNm: row.legal_emd || '',
    liNm: row.legal_ri || '',
    legalDong: row.legal_emd || '',
    legalRi: row.legal_ri || '',
    bdNm: row.building_name || '',
    buildingName: row.building_name || '',
    roadName: row.road_name || '',
    rn: row.road_name || '',
    siNm: row.sido || '',
    sggNm: row.sigungu || '',
    matchedSido: row.sido || '',
    matchedSigungu: row.sigungu || '',
    buildingMainNo: row.building_main_no,
    buldMnnm: row.building_main_no,
    buildingSubNo: row.building_sub_no,
    buldSlno: row.building_sub_no,
    jibunAddr: jibun,
    bdMgtSn: row.address_mgt_no || '',
    _addressMgtNo: row.address_mgt_no || '',
    bdKdcd: '0',
    _matchSource: 'db',
    _matchConfidence: 1,
  };
}

// ── JUSO 폴백: 전국 DB에 없는 주소(신규·갱신분)를 JUSO API로 보완 ──
const JUSO_KEYS = (process.env.JUSO_API_KEYS || '').split(/[,\s]+/).filter(Boolean);
let jusoIdx = 0;
async function jusoFallback(query, cityLabel) {
  if (!JUSO_KEYS.length) return null;
  const kw = `${cityLabel || ''} ${query || ''}`.replace(/\s+/g, ' ').trim();
  if (kw.length < 2) return null;
  for (let attempt = 0; attempt < JUSO_KEYS.length; attempt++) {
    const key = JUSO_KEYS[jusoIdx % JUSO_KEYS.length];
    try {
      const res = await fetch(`https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=${key}&currentPage=1&countPerPage=1&keyword=${encodeURIComponent(kw)}&resultType=json`);
      if (!res.ok) { jusoIdx++; continue; }
      const j = await res.json();
      const code = j.results?.common?.errorCode;
      if (code !== '0') { jusoIdx++; continue; } // 키 만료/오류 → 다음 키
      const r = j.results.juso && j.results.juso[0];
      if (!r) return null;
      // 유사매칭 차단: 입력 도로명+건물번호와 JUSO 결과 건물번호가 정확히 일치할 때만 채택
      const reqPart = buildRoadPart(query, cityLabel);
      const gotPart = norm(`${r.rn || ''}${r.buldMnnm || ''}${r.buldSlno && String(r.buldSlno) !== '0' ? '-' + r.buldSlno : ''}`);
      if (reqPart && !gotPart.endsWith(reqPart)) return null;
      return {
        roadAddrPart1: r.roadAddrPart1 || r.roadAddr,
        roadAddr: r.roadAddr, standardRoadAddress: r.roadAddr,
        emdNm: r.emdNm || '', liNm: r.liNm || '', legalDong: r.emdNm || '', legalRi: r.liNm || '',
        bdNm: r.bdNm || '', buildingName: r.bdNm || '',
        roadName: r.rn || '', rn: r.rn || '',
        siNm: r.siNm || '', sggNm: r.sggNm || '', matchedSido: r.siNm || '', matchedSigungu: r.sggNm || '',
        buildingMainNo: r.buldMnnm, buldMnnm: r.buldMnnm, buildingSubNo: r.buldSlno, buldSlno: r.buldSlno,
        jibunAddr: r.jibunAddr || '', bdMgtSn: r.bdMgtSn || '', _addressMgtNo: r.bdMgtSn || '',
        bdKdcd: r.bdKdcd || '0', _matchSource: 'juso', _matchConfidence: 0.9,
      };
    } catch { jusoIdx++; }
  }
  return null;
}

// ── 카카오 주소검색 폴백: DB·JUSO 모두 미스 시 카카오 주소 API로 정확값 보완 ──
// 좌표용 KAKAO_KEY 재사용. 입력 건물번호와 일치하는 결과만 채택(유사매칭 금지 — 형 지시).
async function kakaoAddressFallback(query, cityLabel) {
  if (!KAKAO_KEY) return null;
  const kw = `${cityLabel || ''} ${query || ''}`.replace(/\s+/g, ' ').trim();
  if (kw.length < 2) return null;
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(kw)}&size=1`, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const d = j.documents && j.documents[0];
    const ra = d && d.road_address;
    if (!ra || !ra.address_name) return null;
    // 유사매칭 차단: 입력 도로명+건물번호와 카카오 결과 건물번호가 정확히 일치할 때만 채택
    const reqPart = buildRoadPart(query, cityLabel);
    const gotPart = norm(`${ra.road_name || ''}${ra.main_building_no || ''}${ra.sub_building_no ? '-' + ra.sub_building_no : ''}`);
    if (reqPart && !gotPart.endsWith(reqPart)) return null;
    const jb = d.address;
    return {
      roadAddrPart1: ra.address_name, roadAddr: ra.address_name, standardRoadAddress: ra.address_name,
      emdNm: ra.region_3depth_name || '', liNm: '', legalDong: ra.region_3depth_name || '', legalRi: '',
      bdNm: ra.building_name || '', buildingName: ra.building_name || '',
      roadName: ra.road_name || '', rn: ra.road_name || '',
      siNm: ra.region_1depth_name || '', sggNm: ra.region_2depth_name || '',
      matchedSido: ra.region_1depth_name || '', matchedSigungu: ra.region_2depth_name || '',
      buildingMainNo: ra.main_building_no || '', buldMnnm: ra.main_building_no || '',
      buildingSubNo: ra.sub_building_no || '', buldSlno: ra.sub_building_no || '',
      jibunAddr: jb ? jb.address_name : '', bdMgtSn: '', _addressMgtNo: '',
      bdKdcd: '0', _matchSource: 'kakao', _matchConfidence: 0.8,
    };
  } catch (e) {
    console.error('[kakao address fallback]', e.message);
    return null;
  }
}

// ── 좌표: geocode_cache 우선, 미스 시 카카오 1회 + 저장 ──
async function geocode(standardRoadAddress, buildingMgtNo) {
  const addr = String(standardRoadAddress || '').trim();
  if (!addr) return null;
  // 캐시 조회 (표준도로명주소 또는 building_mgt_no)
  let r = await pool.query(
    `SELECT lat, lng FROM nexus_address.address_geocode_cache
     WHERE standard_road_address = $1 OR ($2 <> '' AND building_mgt_no = $2)
     ORDER BY (standard_road_address = $1) DESC LIMIT 1`,
    [addr, String(buildingMgtNo || '')]
  );
  if (r.rows[0] && r.rows[0].lat != null && r.rows[0].lng != null) {
    pool.query(`UPDATE nexus_address.address_geocode_cache SET last_used_at = now() WHERE standard_road_address = $1`, [addr]).catch(() => {});
    return { lat: Number(r.rows[0].lat), lng: Number(r.rows[0].lng) };
  }
  // 카카오 1회
  if (!KAKAO_KEY) return null;
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(addr)}&size=1`, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const doc = j.documents && j.documents[0];
    if (!doc) return null;
    const lat = Number(doc.y), lng = Number(doc.x);
    if (!lat || !lng) return null;
    // DB 저장 (다음부턴 캐시 히트)
    const key = String(buildingMgtNo || '') || addr;
    pool.query(
      `INSERT INTO nexus_address.address_geocode_cache (cache_key, standard_road_address, building_mgt_no, provider, provider_query, lat, lng, failure_count, fetched_at, last_used_at)
       VALUES ($1, $2, $3, 'kakao', $2, $4, $5, 0, now(), now())
       ON CONFLICT (cache_key) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, last_used_at = now()`,
      [key, addr, String(buildingMgtNo || ''), lat, lng]
    ).catch((e) => console.error('[geocode cache insert]', e.message));
    return { lat, lng };
  } catch (e) {
    console.error('[kakao geocode]', e.message);
    return null;
  }
}

// ── 서버 ───────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED.includes(origin) || /localhost|127\.0\.0\.1/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED[0] || '*');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.get('/health', async (req, res) => {
  try {
    // 활성버전(DB_VERSION) 행수 — 버전 전환 검증용
    const r = DB_VERSION
      ? await pool.query('SELECT count(*) c FROM nexus_address.address_core WHERE version_id = $1', [DB_VERSION])
      : await pool.query('SELECT count(*) c FROM nexus_address.address_core');
    res.json({ ok: true, version: DB_VERSION, addressCount: Number(r.rows[0].c) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/v1/address/match', async (req, res) => {
  try {
    const { query, cityLabel } = req.body || {};
    const row = await matchRow(query, cityLabel);
    if (row) return res.json({ ok: true, data: toApiResult(row) });
    // 정확값 폴백 체인 (유사매칭 없이): DB 미스 → JUSO API → 카카오 주소검색
    const juso = await jusoFallback(query, cityLabel);
    if (juso) return res.json({ ok: true, data: juso });
    const kakao = await kakaoAddressFallback(query, cityLabel);
    res.json({ ok: !!kakao, data: kakao });
  } catch (e) {
    console.error('[match]', e.message);
    res.json({ ok: false, data: null });
  }
});

app.post('/v1/address/geocode', async (req, res) => {
  try {
    const { standardRoadAddress, buildingMgtNo } = req.body || {};
    const coord = await geocode(standardRoadAddress, buildingMgtNo);
    res.json({ ok: !!coord, data: coord });
  } catch (e) {
    console.error('[geocode]', e.message);
    res.json({ ok: false, data: null });
  }
});

app.use((req, res) => res.status(404).json({ ok: false, error: '존재하지 않는 주소 API 엔드포인트입니다.' }));

app.listen(PORT, () => console.log(`[nexus-address-service] listening on ${PORT}, db version ${DB_VERSION}`));
