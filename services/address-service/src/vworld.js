// VWorld 지오코더 + LT_C_SPBD 건물(동별) 좌표 모듈
// - 아파트 동(棟)별 개별 좌표 + 지상층수 확보 (Kakao 단지 1좌표 한계 보완)
// - 지역검증(시군구 대조)으로 전국 동명 오매칭 차단 (CLAUDE.md A-30 취지)
import { config } from './config.js';
import { cleanText } from './normalize.js';
import { acceptDongCandidate, BBOX_NARROW_DEG, BBOX_WIDE_DEG } from './coords/coordFill.js';

const VWORLD_BASE = 'https://api.vworld.kr/req';
const DEFAULT_TIMEOUT_MS = 7000;
const BLD_LAYER = 'LT_C_SPBD';
// 반경 정의는 coords/coordFill.js 가 SSOT — 동 채택 규칙과 같은 자리에 둔다.
const BBOX_DEG = BBOX_NARROW_DEG;
const BBOX_LARGE = BBOX_WIDE_DEG;

const withTimeout = (ms = DEFAULT_TIMEOUT_MS) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
};

// 문자열에서 동(棟) 번호 추출: "은마아파트(28동)"→"28", "201동"→"201", "가동"→"가"
export const parseDongNo = (value) => {
  const s = cleanText(value);
  if (!s) return '';
  const num = s.match(/(\d{1,4})\s*동(?![가-힣])/); // A-32: 동 뒤 한글이면 동호수 아님(장안2동우체국 오탐 차단). 4자리 동(1001동 등) 허용.
  if (num) return String(Number(num[1])); // 앞자리 0 정규화("0306"→"306")로 클라(apartmentDong)와 정합
  const ko = s.match(/([가-힣A-Za-z])\s*동(?![가-힣])/); // 가동/나동/B동
  return ko ? ko[1] : '';
};

// 폴리곤/멀티폴리곤 지오메트리 → 대표 좌표(정점 bbox 중심). 면적가중 shoelace는 일부 단지에서 크게 발산해 폐기.
const geometryCentroid = (geometry) => {
  if (!geometry?.coordinates) return { lat: null, lng: null };
  const flat = JSON.stringify(geometry.coordinates).match(/-?\d+\.\d+/g)?.map(Number) || [];
  const xs = flat.filter((_, i) => i % 2 === 0);
  const ys = flat.filter((_, i) => i % 2 === 1);
  if (!xs.length) return { lat: null, lng: null };
  return {
    lng: (Math.min(...xs) + Math.max(...xs)) / 2,
    lat: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
};

/**
 * 재시도 판정 — **서버가 뻗은 신호만** 다시 시도한다.
 *
 * ★2026-08-11 실측: 800건을 초당 20으로 돌리자 346회째까지 연속 성공 후 붕괴,
 *   실패 180건이 **HTTP 502 Bad Gateway**("The server returned an invalid or
 *   incomplete response"), 224건이 네트워크 끊김이었다. 40건 버스트(초당 27.5)는
 *   멀쩡했으므로 버스트가 아니라 **지속 부하**에 VWorld 백엔드가 뻗는다.
 *   502 는 레이트리밋(429)이 아니라 과부하 응답이라 **기다렸다 다시 하면 된다**.
 *
 * ★반대로 키가 틀렸거나(api_error) 그 주소에 좌표가 없는 것(no_point)은 몇 번을
 *   다시 해도 같은 답이다. 재시도하면 쿼터만 태운다.
 */
export const shouldRetryGeocode = (result) => {
  if (!result || result.ok) return false;
  if (result.reason === 'network' || result.reason === 'timeout') return true;
  if (result.reason === 'not_json') return Number(result.status) >= 500;
  return false;
};

const BACKOFF_BASE_MS = 300;
const BACKOFF_MAX_MS = 10000;

/** 지수 백오프 — 뻗은 서버를 같은 속도로 다시 때리면 회복할 틈을 안 준다. 상한 10초. */
export const backoffDelayMs = (attempt) => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (2 ** Math.max(0, attempt)));

/**
 * 초당 요청 수 제한. 시계·대기를 주입받아 회귀에서 실시간 없이 검증한다.
 *
 * ★동시성만 낮춰서는 부족하다 — 동시성 3 이어도 응답이 빠르면 초당 20을 넘긴다.
 *   막아야 하는 건 동시 개수가 아니라 **초당 유입량**이다.
 */
export const createRateLimiter = (perSecond, { now = () => Date.now(), sleep = null } = {}) => {
  const rate = Number(perSecond) || 0;
  const wait = sleep || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  if (rate <= 0) return { acquire: async () => {} };
  const gap = Math.ceil(1000 / rate);
  let nextAt = null;
  return {
    // ★슬롯을 **동기적으로** 예약한 뒤 그 시각까지 기다린다.
    //   await 뒤에 nextAt 을 갱신하면 동시 호출들이 같은 값을 읽고 함께 통과해
    //   실효 속도가 동시성 배수로 뛴다(실측: 설정 0.7/초 → 실제 2.1/초, 정확히 3배).
    //   JS 는 단일 스레드라 예약이 await 이전에 끝나면 경합이 없다.
    acquire() {
      const t = now();
      const at = (nextAt === null || nextAt <= t) ? t : nextAt;
      nextAt = at + gap;
      const delay = at - t;
      return delay > 0 ? wait(delay) : Promise.resolve();
    },
  };
};

/**
 * 도로명주소 → 좌표 (지오코더 API) — **원인까지 돌려주는** 버전.
 *
 * ★2026-08-11 실측: 1,343건 채움에서 947건(70%)이 실패했는데 로그엔 `error.message`
 *   뿐이라 스로틀인지 한도 초과인지 키 문제인지 갈리지 않았다. `<html><bod...` 라는
 *   파싱 오류 문자열만 남아 **HTTP 상태도 응답 본문도 모르는 상태**였다.
 *   동 좌표는 VWorld 만 줄 수 있으므로(Kakao 는 단지 1좌표), 이 실패를 규명하지 않으면
 *   C-5 에서 동 좌표 70%가 조용히 비고 정상 기각과 구분되지 않는다.
 *   → 실패 사유를 구조화해서 돌려준다. 부르는 쪽이 재시도할지 포기할지 판단할 수 있다.
 */
export const geocodeRoadDetailed = async (roadAddress) => {
  if (!config.vworldKey) return { ok: false, reason: 'no_key' };
  if (!roadAddress) return { ok: false, reason: 'no_address' };
  const url = `${VWORLD_BASE}/address?service=address&request=getCoord&version=2.0`
    + `&crs=epsg:4326&address=${encodeURIComponent(roadAddress)}&type=ROAD&format=json&key=${config.vworldKey}`;
  const t = withTimeout();
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: t.signal });
    const body = await res.text();
    const ms = Date.now() - started;
    let json = null;
    try { json = JSON.parse(body); } catch { /* JSON 이 아니면 아래에서 본문으로 판정한다 */ }
    if (!json) {
      // ★본문 앞부분을 남긴다. 키가 URL 에 있으므로 **응답만** 남기고 URL 은 남기지 않는다.
      return {
        ok: false, reason: 'not_json', status: res.status, ms,
        snippet: body.slice(0, 160).replace(/\s+/g, ' ').trim(),
      };
    }
    const st = json.response?.status;
    if (st !== 'OK') {
      return {
        ok: false, reason: st === 'ERROR' ? 'api_error' : `status_${st || 'unknown'}`,
        status: res.status, ms,
        errorCode: json.response?.error?.code || '',
        errorText: json.response?.error?.text || '',
      };
    }
    const p = json.response.result?.point;
    if (!p) return { ok: false, reason: 'no_point', status: res.status, ms };
    return { ok: true, point: { lat: Number.parseFloat(p.y), lng: Number.parseFloat(p.x) }, status: res.status, ms };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === 'AbortError' ? 'timeout' : 'network',
      ms: Date.now() - started,
      message: error?.message || '',
    };
  } finally {
    t.done();
  }
};

/**
 * 프로세스 전역 속도 제한. 동시성이 아니라 **초당 유입량**을 막는다.
 *
 * ★기본 2/초는 **실측으로 정한 값**이다(2026-08-11, 600건 연속).
 *   - 초당 20  → 346회째 502 붕괴 (성공 49.5%)
 *   - 초당 3.9 → 379회째 502 붕괴 (성공 57.5%) ← 속도를 5배 낮춰도 붕괴 지점 그대로
 *   - 초당 2.1 → **600/600 전부 성공**
 *   붕괴가 속도가 아니라 **누적 횟수**에 걸려 있었다 = VWorld 쪽 토큰버킷(버스트 약 370
 *   + 낮은 재충전). keep-alive 커넥션 재사용 가설은 `connection: close` 로 검증했으나
 *   무효였다(58.9%, 붕괴 368회 — 차이 없음)라서 되돌렸다.
 *   동 좌표는 VWorld 만 줄 수 있으므로(Kakao 는 단지 1좌표) C-5 에서는 이 속도가 생명줄이다.
 */
const geocodeLimiter = createRateLimiter(Number(process.env.VWORLD_RATE_PER_SEC || 2));
const GEOCODE_ATTEMPTS = Math.max(1, Number(process.env.VWORLD_RETRY_ATTEMPTS || 3));
const sleepMs = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * 도로명주소 → 좌표 (기존 계약 유지: 성공하면 {lat,lng}, 실패하면 null).
 *
 * ★재시도는 **502·네트워크·타임아웃에만**. 키 오류·좌표 없음은 즉시 포기한다(같은 답).
 */
export const geocodeRoad = async (roadAddress) => {
  let last = null;
  for (let attempt = 0; attempt < GEOCODE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleepMs(backoffDelayMs(attempt - 1));
    await geocodeLimiter.acquire();
    last = await geocodeRoadDetailed(roadAddress);
    if (last.ok) return last.point;
    if (!shouldRetryGeocode(last)) break;
  }
  if (last && last.reason !== 'no_key' && last.reason !== 'no_address') {
    console.error('[vworld] geocodeRoad 실패:', last.reason, last.status ?? '',
      last.errorCode || last.snippet || last.message || '');
  }
  return null;
};

// 좌표 주변 건물(각 동) 목록 — LT_C_SPBD BBOX 조회
export const getBuildingsNear = async (lng, lat, radiusDeg = BBOX_DEG) => {
  if (!config.vworldKey || lng == null || lat == null) return [];
  const box = `BOX(${(lng - radiusDeg).toFixed(6)},${(lat - radiusDeg).toFixed(6)},`
    + `${(lng + radiusDeg).toFixed(6)},${(lat + radiusDeg).toFixed(6)})`;
  const url = `${VWORLD_BASE}/data?service=data&request=GetFeature&data=${BLD_LAYER}&key=${config.vworldKey}`
    + `&domain=localhost&geomFilter=${encodeURIComponent(box)}&crs=EPSG:4326`
    + `&geometry=true&attribute=true&size=1000&format=json`;
  const t = withTimeout(9000);
  try {
    const res = await fetch(url, { signal: t.signal });
    const json = await res.json();
    if (json.response?.status !== 'OK') return [];
    const feats = json.response.result?.featureCollection?.features || [];
    return feats.map((f) => {
      const p = f.properties || {};
      const c = geometryCentroid(f.geometry);
      const name = p.buld_nm_dc || p.buld_nm || '';
      const floorsRaw = p.gro_flo_co ?? '';
      return {
        name,
        buildName: p.buld_nm || '',
        dongNo: parseDongNo(name),
        floors: floorsRaw === '' ? null : Number.parseInt(floorsRaw, 10),
        roadName: p.rd_nm || '',
        sido: p.sido || '',
        sigungu: p.sigungu || '',
        lat: c.lat,
        lng: c.lng,
      };
    });
  } catch (error) {
    console.error('[vworld] getBuildingsNear 실패:', error.message);
    return [];
  } finally {
    t.done();
  }
};

// 시군구 토큰 일치 검증 (A-30 오매칭 차단) — "동남구"⊂"천안시 동남구" 부분일치 허용
const sigunguMatches = (bldSigungu, wantSigungu) => {
  if (!wantSigungu) return true; // 지자체 정보 없으면 통과
  const a = cleanText(bldSigungu);
  const b = cleanText(wantSigungu);
  if (!a) return true;
  return a.includes(b) || b.includes(a) || b.split(/\s+/).some((tok) => tok && a.includes(tok));
};

// BBOX 조회 건물 목록에서 원하는 동(棟)을 고른다 — 지역검증(A-30) 후 채택 판정은 coordFill 로 위임.
//   ★2026-08-11 근본수정: 예전엔 `단지명 일치 || byDong[0]` 이라 **단지명 검증에 실패해도
//   주변 아무 건물이나 집었다**. 그게 C-4 이관에서 375건을 격리해야 했던 오염의 원인이다
//   (실측: `B동` 좌표 하나가 성암빌라·진아빌라·청양맨션·청정빌라·신한그린빌에 동시에 붙음).
//   판정 규칙은 acceptDongCandidate 하나만 쓴다 — 여기에 복제하면 둘이 갈라진다.
const pickDong = (buildings, { wantDong, complexName, sigungu }) => {
  const regional = buildings.filter((b) => b.lat != null && sigunguMatches(b.sigungu, sigungu));
  return acceptDongCandidate(regional, { wantDong, complexName });
};

// 도로명 + 단지명 + 동번호 → 특정 동의 좌표·층수
// 반환: { lat, lng, floors, buildName, matched:'dong'|'complex'|'centroid', dongNo }
// ★대형 단지 대응(2026-07-27 근본수정): geocodeRoad 대표점이 단지 한쪽에 찍히면 반대편 동이 ±250m 밖으로
//   벗어나 동 매칭이 조용히 실패하고 대표점(=다른 동 위치)으로 회귀했다("306동이 320동 위치에" 원인).
//   → 좁은 BBOX로 먼저 정밀 조회하고, 동을 못 찾고 동번호가 있으면 넓은 BBOX(±700m)로 한 번 더 조회한다.
//   소규모 단지는 좁게(정확), 대단지만 넓게 — 인접 단지 오염은 단지명 필터(pickDong)로 방어.
export const matchDongCoord = async ({ roadAddress, complexName = '', dongNo = '', sigungu = '' }) => {
  const center = await geocodeRoad(roadAddress);
  if (!center) return null;

  const wantDong = parseDongNo(dongNo) || parseDongNo(complexName);

  // 1차: 좁은 BBOX(±250m) 정밀 조회
  let all = await getBuildingsNear(center.lng, center.lat, BBOX_DEG);
  let pick = pickDong(all, { wantDong, complexName, sigungu });

  // 2차: 동을 못 찾았고 동번호가 있으면 넓은 BBOX(±700m)로 확장 조회 — 대단지 커버
  if (!pick && wantDong) {
    all = await getBuildingsNear(center.lng, center.lat, BBOX_LARGE);
    pick = pickDong(all, { wantDong, complexName, sigungu });
  }
  if (pick) {
    return { lat: pick.lat, lng: pick.lng, floors: pick.floors, buildName: pick.buildName, matched: 'dong', dongNo: wantDong };
  }

  // 2순위: 단지명 일치(동 못 찾음) — (마지막으로 조회한) 범위 내 단지 첫 건물
  const regional = all.filter((b) => b.lat != null && sigunguMatches(b.sigungu, sigungu));
  if (complexName) {
    const byName = regional.filter((b) => cleanText(b.buildName).includes(cleanText(complexName)));
    if (byName[0]) {
      return { lat: byName[0].lat, lng: byName[0].lng, floors: byName[0].floors, buildName: byName[0].buildName, matched: 'complex', dongNo: '' };
    }
  }
  // 3순위: 단지 중심좌표 폴백(지오코더 좌표)
  return { lat: center.lat, lng: center.lng, floors: null, buildName: complexName, matched: 'centroid', dongNo: '' };
};
