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

const SELECT_COLS = `SELECT sido, sigungu, legal_emd, legal_ri, jibun_san_yn, jibun_main_no, jibun_sub_no,
  road_name, road_address, building_name, building_main_no, building_sub_no, address_mgt_no
  FROM nexus_address.address_core`;

async function matchRow(query, cityLabel) {
  const cityKey = norm(cityLabel);
  const roadPart = buildRoadPart(query, cityLabel);
  if (!roadPart || roadPart.length < 2) return null;
  // 1순위: 정확 매칭 (읍/면 emd는 % 와일드카드로 흡수)
  let r = await pool.query(
    `${SELECT_COLS} WHERE road_key LIKE $1 || '%' || $2 ORDER BY length(road_key) ASC LIMIT 1`,
    [cityKey, roadPart]
  );
  if (r.rows[0]) return r.rows[0];
  // 2순위: 본번 동일 + 부번 임의 (상세 부번 누락 대응 — 법정동·도로명 동일 보장)
  if (!/-/.test(roadPart)) {
    r = await pool.query(
      `${SELECT_COLS} WHERE road_key LIKE $1 || '%' || $2 || '-%' ORDER BY length(road_key) ASC LIMIT 1`,
      [cityKey, roadPart]
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}

// DB row → 엔진 호환(JUSO 형식) 응답
function toApiResult(row) {
  if (!row) return null;
  const san = row.jibun_san_yn === '1' ? '산 ' : '';
  const sub = row.jibun_sub_no ? `-${row.jibun_sub_no}` : '';
  const jibun = `${row.sido} ${row.sigungu} ${row.legal_emd}${row.legal_ri ? ' ' + row.legal_ri : ''} ${san}${row.jibun_main_no}${sub}`.replace(/\s+/g, ' ').trim();
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
    const r = await pool.query('SELECT count(*) c FROM nexus_address.address_core');
    res.json({ ok: true, version: DB_VERSION, addressCount: Number(r.rows[0].c) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/v1/address/match', async (req, res) => {
  try {
    const { query, cityLabel } = req.body || {};
    const row = await matchRow(query, cityLabel);
    res.json({ ok: !!row, data: toApiResult(row) });
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
