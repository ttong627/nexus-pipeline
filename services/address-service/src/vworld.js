// VWorld 지오코더 + LT_C_SPBD 건물(동별) 좌표 모듈
// - 아파트 동(棟)별 개별 좌표 + 지상층수 확보 (Kakao 단지 1좌표 한계 보완)
// - 지역검증(시군구 대조)으로 전국 동명 오매칭 차단 (CLAUDE.md A-30 취지)
import { config } from './config.js';
import { cleanText } from './normalize.js';

const VWORLD_BASE = 'https://api.vworld.kr/req';
const DEFAULT_TIMEOUT_MS = 7000;
const BLD_LAYER = 'LT_C_SPBD';
const BBOX_DEG = 0.0025;   // 약 ±250m — 소규모 단지·정밀 1차 조회
const BBOX_LARGE = 0.0065; // 약 ±700m — 대형 단지(대표점이 단지 한쪽에 찍혀 반대편 동이 범위 밖일 때) 2차 확장 조회

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

// 폴리곤/멀티폴리곤 지오메트리 → centroid(좌표 평균) 근사
const geometryCentroid = (geometry) => {
  if (!geometry?.coordinates) return { lat: null, lng: null };
  const flat = JSON.stringify(geometry.coordinates).match(/-?\d+\.\d+/g)?.map(Number) || [];
  const xs = flat.filter((_, i) => i % 2 === 0);
  const ys = flat.filter((_, i) => i % 2 === 1);
  if (!xs.length) return { lat: null, lng: null };
  return {
    lng: xs.reduce((a, b) => a + b, 0) / xs.length,
    lat: ys.reduce((a, b) => a + b, 0) / ys.length,
  };
};

// 도로명주소 → 좌표 (지오코더 API)
export const geocodeRoad = async (roadAddress) => {
  if (!config.vworldKey || !roadAddress) return null;
  const url = `${VWORLD_BASE}/address?service=address&request=getCoord&version=2.0`
    + `&crs=epsg:4326&address=${encodeURIComponent(roadAddress)}&type=ROAD&format=json&key=${config.vworldKey}`;
  const t = withTimeout();
  try {
    const res = await fetch(url, { signal: t.signal });
    const json = await res.json();
    if (json.response?.status !== 'OK') return null;
    const p = json.response.result?.point;
    if (!p) return null;
    return { lat: Number.parseFloat(p.y), lng: Number.parseFloat(p.x) };
  } catch (error) {
    console.error('[vworld] geocodeRoad 실패:', error.message);
    return null;
  } finally {
    t.done();
  }
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

// BBOX 조회 건물 목록에서 원하는 동(棟)을 고른다 — 동번호 일치 + (단지명 있으면) 단지명 포함 우선.
//   단지명으로 좁혀 인접 단지의 같은 동번호 오채택을 차단(대형 BBOX 확장 시 특히 중요).
const pickDong = (buildings, { wantDong, complexName, sigungu }) => {
  if (!wantDong) return null;
  const regional = buildings.filter((b) => b.lat != null && sigunguMatches(b.sigungu, sigungu));
  const byDong = regional.filter((b) => b.dongNo === wantDong);
  if (!byDong.length) return null;
  const pick = complexName
    ? byDong.find((b) => cleanText(b.buildName).includes(cleanText(complexName))) || byDong[0]
    : byDong[0];
  return pick || null;
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
