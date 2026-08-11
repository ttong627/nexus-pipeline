// ══════════════════════════════════════════════════════════════════
//  좌표 저장소 — 입구 좌표 / 동(棟) 좌표 2종 구분 관리 (형 지시 2026-08-11)
//  설계서: 좌표관리_설계.md · 회귀: scripts/coord-store.test.mjs
//
//  ★DB를 쓰지 않는 순수 판정·변환만 여기 둔다. 쿼리는 server.js·배치가 담당한다.
//    그래야 규칙을 DB 없이 회귀로 고정할 수 있다.
// ══════════════════════════════════════════════════════════════════

/**
 * ★입구 좌표를 채울 수 있는 출처는 이 둘뿐이다 (설계서 F1).
 *
 * 지오코딩 결과(vworld·kakao)는 **건물·단지 대표점**이지 진입 지점이 아니다.
 * 그걸 입구 칸에 넣으면 "차가 못 들어가는 지점"이 목적지가 된다. 출입구 자료가
 * 끝내 안 들어오더라도 입구 칸은 비워 두는 것이 맞다 — 비어 있으면 중심 좌표로
 * 폴백하지만, 거짓으로 채워 두면 그게 정답인 줄 알고 쓴다.
 */
export const ENTRANCE_SOURCES = new Set(['juso_entrc', 'manual']);

const intOrNull = (v) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * 좌표 앵커 — {road_code}#{지하여부}#{본번}-{부번}
 *
 * ★address_mgt_no 를 쓰지 않는 이유(2026-08-11 실측): address_core 986,737 vs
 *   building_core 10,722,592 — 831만 건(77.5%)이 address_core 에 없다.
 *   address_mgt_no 는 address_core 에만 있어 그 키로는 대부분의 건물이 좌표를 못 갖는다.
 */
export const buildCoordKey = ({ roadCode = '', undergroundYn = '0', buildingMainNo = null, buildingSubNo = 0 } = {}) => {
  const code = String(roadCode ?? '').trim();
  const main = intOrNull(buildingMainNo);
  if (!code || main == null || main <= 0) return '';
  const under = String(undergroundYn ?? '0').trim() === '1' ? '1' : '0';
  const sub = intOrNull(buildingSubNo) || 0;
  return `${code}#${under}#${main}-${sub}`;
};

/** 동 표기 정규화 — '0101'·'101동' → '101', '가동' → '가' (클라 apartmentDong 과 정합) */
export const normalizeDongNo = (value) => {
  const s = String(value ?? '').trim().replace(/동$/, '').trim();
  if (!s) return '';
  return /^\d+$/.test(s) ? String(Number(s)) : s;
};

const point = (lat, lng, source, kind) =>
  (lat == null || lng == null) ? null : { lat: Number(lat), lng: Number(lng), source: source || '', kind };

/**
 * 용도에 맞는 좌표를 고른다.
 *
 *  purpose='navigation' : 입구 → 중심.  **동 좌표는 쓰지 않는다**(설계서 F2).
 *      동 앞은 차가 못 들어가는 경우가 많다. 내비 목적지는 진입 지점이어야 한다.
 *  purpose='sequence'   : 동 → 입구 → 중심.
 *      단지를 한 점으로 보면 단지 내부 동선이 통째로 사라진다
 *      (실측 2026-07-24: 은마아파트 동간 약 280m).
 *
 * ★quality='outlier' 는 좌표 없음으로 취급한다(DS-15). 이상 좌표 하나가
 *   기사 구역을 430km 로 부풀린 실측이 있다.
 */
export const pickDeliveryCoord = (row, { purpose = 'navigation', dong = null } = {}) => {
  if (!row) return null;
  if (row.quality === 'outlier' || row.quality === 'none') return null;

  if (purpose === 'sequence' && dong && dong.matched === 'dong' && dong.lat != null && dong.lng != null) {
    return point(dong.lat, dong.lng, dong.source || row.center_source || 'vworld', 'dong');
  }
  return point(row.entrance_lat, row.entrance_lng, row.entrance_source, 'entrance')
    || point(row.center_lat, row.center_lng, row.center_source, 'center');
};

/**
 * road_codes 후보 중 이 지자체의 도로를 고른다.
 *
 * ★도로명은 전국에서 겹친다 — 동대문구 황물로7길 ↔ 수원 황물로7길(A-35 실측).
 *   시군구로 좁히지 못하면 **키를 만들지 않는다**. 애매한 앵커로 좌표를 매달면
 *   다른 동네 건물의 좌표를 이 건물 것으로 쓰게 된다(A-30이 막아온 오매칭의 뒷문).
 *   후보가 2개 이상 남아도 마찬가지다 — 찍는 것보다 비우는 편이 되돌릴 수 있다.
 */
export const pickRoadCode = (candidates, sigunguTok) => {
  const want = String(sigunguTok ?? '').trim();
  if (!want) return '';
  const codes = new Set(
    (candidates || [])
      .filter((r) => String(r.sigungu ?? '').replace(/\s+/g, '').includes(want.replace(/\s+/g, '')))
      .map((r) => String(r.road_code ?? '').trim())
      .filter(Boolean),
  );
  return codes.size === 1 ? [...codes][0] : '';
};

/**
 * 요청한 동의 좌표를 고른다 — **matched='dong' 만** 돌려준다.
 *
 * ★`suspect`(이관 시 375건 격리)·`complex`·`centroid` 를 동 좌표라고 내주면
 *   호출부는 그것이 그 동의 위치인 줄 알고 쓴다. 실측 오염 사례: B동 좌표 하나가
 *   성암빌라·진아빌라·청양맨션·청정빌라·신한그린빌에 동시에 붙어 있었다(F3).
 */
export const pickTrustedDong = (dongRows, dongNo) => {
  const want = normalizeDongNo(dongNo);
  if (!want) return null;
  const hit = (dongRows || []).find((d) => normalizeDongNo(d.dong_no) === want && d.matched === 'dong');
  if (!hit) return null;
  return {
    no: normalizeDongNo(hit.dong_no),
    lat: Number(hit.lat),
    lng: Number(hit.lng),
    floors: intOrNull(hit.floors),
    source: hit.source || 'vworld',
  };
};

/**
 * 레코드 1건의 조회 결과.
 *
 * ★저장소에 행이 없는 것(`unknown` = 아직 안 해봤다)과 행은 있는데 좌표를 못 구한 것
 *   (`none` = 해봤는데 없다)을 구분한다. 뭉뚱그리면 채움 배치가 무엇을 다시 시도해야
 *   하는지 알 수 없고, "좌표가 원래 없는 주소"를 영원히 재시도하게 된다.
 */
export const coordResolveEntry = (record = {}, row = null, dongRows = []) => {
  const base = coordRowToResult(row, []);
  return {
    roadAddress: record.roadAddress || '',
    coordKey: base?.coordKey || '',
    entrance: base?.entrance || null,
    center: base?.center || null,
    dong: pickTrustedDong(dongRows, record.dongNo),
    dongCount: (dongRows || []).filter((d) => d.matched === 'dong').length,
    isApartment: base?.isApartment || false,
    buildingName: base?.buildingName || '',
    quality: base ? (base.quality || 'unverified') : 'unknown',
  };
};

/** DB 행 + 동 목록 → API 응답. 세 좌표가 **각자 자리에** 담긴다(섞지 않는다). */
export const coordRowToResult = (row, dongRows = []) => {
  if (!row || !row.coord_key) return null;
  const entrance = row.entrance_lat == null ? null
    : { lat: Number(row.entrance_lat), lng: Number(row.entrance_lng), source: row.entrance_source || '' };
  const center = row.center_lat == null ? null
    : { lat: Number(row.center_lat), lng: Number(row.center_lng), source: row.center_source || '' };
  return {
    coordKey: row.coord_key,
    roadAddress: row.road_address || '',
    sigungu: row.sigungu || '',
    buildingName: row.building_name || '',
    isApartment: Boolean(row.is_apartment),
    entrance,
    center,
    dongs: (dongRows || []).map((d) => ({
      dongNo: normalizeDongNo(d.dong_no),
      lat: Number(d.lat),
      lng: Number(d.lng),
      floors: intOrNull(d.floors),
      matched: d.matched || '',
      source: d.source || 'vworld',
    })),
    quality: row.quality || 'unverified',
    qualityNote: row.quality_note || '',
  };
};
