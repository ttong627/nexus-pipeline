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

/**
 * coord_key → 앵커 구성요소 (buildCoordKey 의 역함수).
 *
 * ★C-3 채움이 쓴다: 조회는 키만 돌려주는데, 채움은 출입구 자료를 찾을 때
 *   road_code·본번·부번이 각각 필요하다. 키를 직접 쪼개 쓰면 형식이 바뀔 때
 *   조용히 어긋나므로 **역함수를 만들고 왕복을 회귀로 못 박는다**.
 *   형식이 아니면 null — 잘못 푼 앵커로 쓰면 남의 건물에 좌표가 붙는다.
 */
export const parseCoordKey = (key) => {
  const m = /^(\d+)#([01])#(\d+)-(\d+)$/.exec(String(key ?? '').trim());
  if (!m) return null;
  const buildingMainNo = Number(m[3]);
  if (!buildingMainNo) return null;
  return {
    roadCode: m[1],
    undergroundYn: m[2],
    buildingMainNo,
    buildingSubNo: Number(m[4]),
  };
};

/** 동 표기 정규화 — '0101'·'101동' → '101', '가동' → '가' (클라 apartmentDong 과 정합) */
export const normalizeDongNo = (value) => {
  const s = String(value ?? '').trim().replace(/동$/, '').trim();
  if (!s) return '';
  return /^\d+$/.test(s) ? String(Number(s)) : s;
};

/**
 * 이름 문자열에서 동(棟)을 뽑는다 — `"은마아파트(28동)"` → `"28"`, `"가동"` → `"가"`.
 *
 * ★A-32: `동` 뒤에 한글이 오면 동호수가 아니다(`장안2동우체국`). 행정동 이름을
 *   동 번호로 읽으면 엉뚱한 건물에 좌표가 붙는다.
 * ★VWorld `buld_nm_dc` 를 읽는 것이 주 용도라 **'동' 글자가 있어야** 인식한다.
 *   맨 숫자('201')는 여기서 못 읽는다 — 그건 이름이 아니라 값이다. toDongNo 를 쓸 것.
 */
export const parseDongNo = (value) => {
  const s = String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const num = s.match(/(\d{1,4})\s*동(?![가-힣])/);
  if (num) return String(Number(num[1]));
  const ko = s.match(/([가-힣A-Za-z])\s*동(?![가-힣])/);
  return ko ? ko[1] : '';
};

/** 값 형태인가 — 맨 숫자(1~4자리)나 한글·영문 한 글자, 뒤에 '동'은 선택. */
const DONG_VALUE_RE = /^(\d{1,4}|[가-힣A-Za-z])\s*동?$/;

/**
 * 동 표기 단일 입구 — **값이면 정규화, 이름이면 추출**.
 *
 * ★2026-08-11 실측으로 드러난 불일치: 같은 값을 경로마다 다르게 읽고 있었다.
 *     `/v1/building/dong-coords` → parseDongNo   ('동' 필요 — `'201'` 은 **빈 값**)
 *     `mode:'fill'`              → normalizeDongNo (맨 숫자 허용)
 *   그래서 클라가 `'201'` 을 보내면 한쪽은 동 매칭을 **아예 시도조차 안 하고**
 *   조용히 centroid 로 떨어졌다. 에러도 안 난다. 두 경로가 하나를 쓰게 한다.
 */
export const toDongNo = (value) => {
  const s = String(value ?? '').normalize('NFC').trim();
  if (!s) return '';
  return DONG_VALUE_RE.test(s) ? normalizeDongNo(s) : parseDongNo(s);
};

/*
 * ★여기 있던 `pickDeliveryCoord` 를 지웠다(2026-08-12) — **호출부가 0건이었다.**
 *
 *   이 파일은 좌표를 **저장·조회**하는 자리다. "어느 좌표를 쓸 것인가"를 여기서도
 *   한 벌 더 정의해두니, 살아 있는 규칙과 갈라져도 아무 에러가 안 났다. C-5 사고
 *   (죽은 경로에 코드를 넣고 완료로 기록)가 다시 일어날 자리라 제거한다.
 *
 *   좌표 선택 규칙은 **목적별로 한 벌씩만** 있다. 고치려면 아래를 고쳐라:
 *     · 내비 목적지(입구 → 중심, 동 좌표 금지 = F2)
 *         → `src/delivery/deliveryBrief.js` `pickCoordinate` (`server.js` `/v1/delivery/resolve`)
 *     · 명단 lat/lng = 지도·순번(동 → 입구 → 중심)
 *         → `functions/index.js` `storeCoordsFor` (Cloud Function `geocodeAuto`, 3분마다)
 *
 *   `/v1/coords/resolve` 는 **고르지 않는다** — `entrance`·`center`·`dong`(신뢰분만)을
 *   그대로 내주고 고르는 일은 호출부가 한다(`coordResolveEntry`).
 */

const compact = (v) => String(v ?? '').replace(/\s+/g, '').trim();

/**
 * road_codes 후보 중 이 지자체의 도로만 남긴다 — 코드 목록(중복 제거).
 *
 * ★도로명은 전국에서 겹친다 — 동대문구 황물로7길 ↔ 수원 황물로7길(A-35 실측).
 *   시군구로 좁히지 못하면 키를 만들지 않는다.
 * ★세종특별자치시는 시군구가 없다 — 원본 도로명코드 2,647행의 시군구 칸이 **빈 값**이다
 *   (2026-08-12 원본 실측). 시군구만 대조하면 세종 주소는 후보가 영영 0개다.
 *   빈 칸일 때만 시도로 대조한다(값이 있는 행에는 이 폴백이 적용되지 않는다).
 */
export const roadCodeCandidates = (candidates, sigunguTok) => {
  const want = compact(sigunguTok);
  if (!want) return [];
  return [...new Set(
    (candidates || [])
      .filter((r) => {
        const sgg = compact(r.sigungu);
        return sgg ? sgg.includes(want) : compact(r.sido) === want;
      })
      .map((r) => String(r.road_code ?? '').trim())
      .filter(Boolean),
  )];
};

/**
 * road_codes 후보 중 이 지자체의 도로를 고른다.
 *
 * ★애매한 앵커로 좌표를 매달면 다른 동네 건물의 좌표를 이 건물 것으로 쓰게 된다
 *   (A-30이 막아온 오매칭의 뒷문). 후보가 2개 이상 남으면 비운다 —
 *   찍는 것보다 비우는 편이 되돌릴 수 있다. 번지로 좁히려면 pickRoadCodeByBuilding.
 */
export const pickRoadCode = (candidates, sigunguTok) => {
  const codes = roadCodeCandidates(candidates, sigunguTok);
  return codes.length === 1 ? codes[0] : '';
};

/**
 * 후보 도로코드가 둘 이상일 때 **그 번지가 실재하는 코드**로 좁힌다.
 *
 * ★2026-08-12 실측 — 동대문구 `한천로58길`이 그 경우였다. 같은 시군구·같은 도로명인데
 *   도로명코드가 둘(`112304115640`·`112304121702`)이라 pickRoadCode 가 비웠고,
 *   명단 **266건이 두 달 내내 `no_anchor`** 였다(전 명단 채움에서 동대문만 98.3%).
 *   두 코드는 **번지 구간이 갈린다**(본번 22~209 / 240 하나) — 본번·부번까지 보면
 *   유일하게 결정된다. 실제로 명단 6개 주소 전부 115640 에만 실재했다.
 * ★근거는 '실재하는 주소'(address_building_links)라 찍는 것이 아니다. 그래도 둘 이상
 *   남으면 그때는 비운다(A-30 불변).
 * ★전국 규모: (시군구, 도로명) 174,005종 중 코드가 갈리는 것 **52종**(0.03%).
 */
export const pickRoadCodeByBuilding = (codes, links, {
  undergroundYn = '0', buildingMainNo = null, buildingSubNo = 0,
} = {}) => {
  const main = intOrNull(buildingMainNo);
  const allow = new Set(codes || []);
  if (main == null || main <= 0 || !allow.size) return '';
  const under = String(undergroundYn ?? '0').trim() === '1' ? '1' : '0';
  const sub = intOrNull(buildingSubNo) || 0;
  const hit = new Set(
    (links || [])
      .filter((l) => allow.has(String(l.road_code ?? '').trim())
        && intOrNull(l.building_main_no) === main
        && (intOrNull(l.building_sub_no) || 0) === sub
        && (String(l.underground_yn ?? '0').trim() === '1' ? '1' : '0') === under)
      .map((l) => String(l.road_code).trim()),
  );
  return hit.size === 1 ? [...hit][0] : '';
};

/**
 * 요청한 동의 좌표를 고른다 — **matched='dong' 만** 돌려준다.
 *
 * ★`suspect`(이관 시 375건 격리)·`complex`·`centroid` 를 동 좌표라고 내주면
 *   호출부는 그것이 그 동의 위치인 줄 알고 쓴다. 실측 오염 사례: B동 좌표 하나가
 *   성암빌라·진아빌라·청양맨션·청정빌라·신한그린빌에 동시에 붙어 있었다(F3).
 */
export const pickTrustedDong = (dongRows, dongNo) => {
  const want = toDongNo(dongNo);   // 요청 값
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
    dongProbedAt: base?.dongProbedAt ?? null,
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
    // 동 목록을 마지막으로 물어본 시각(ms). "물어봤는데 없더라"를 재조회 판정에 쓴다.
    dongProbedAt: row.dong_probed_at ? new Date(row.dong_probed_at).getTime() : null,
  };
};
