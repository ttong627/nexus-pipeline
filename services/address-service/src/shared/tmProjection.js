/**
 * 횡축 메르카토르(TM) 역변환 — 한국 좌표계 → WGS84 경위도. 순수 함수, 의존성 0.
 *
 * ★왜 여기(shared/)에 두는가
 *   행안부 자료 좌표는 EPSG:5179(GRS80 UTM-K)인데 우리 앱·지도는 전부 WGS84 경위도를 쓴다.
 *   변환기가 없으면 국가 원본 좌표를 받아놓고도 배송에 못 쓴다.
 *   `shared/` 는 클라·서버 공용 순수 모듈의 지정 위치다(roadTokens.js 와 같은 이유:
 *   Docker 빌드 컨텍스트가 services/address-service/ 이고 Dockerfile 이 `COPY src ./src`
 *   라, 루트 src/ 에 두면 서버 이미지에 안 들어간다).
 *
 * ⚠️ yyplus(`wssc-unified/src/utils/utmk.js`)에 동등한 구현이 이미 있다. **복사해오지
 *    않았다** — 사본이 둘이면 한쪽만 고치는 사고가 난다(이 프로젝트가 routeWorker 로
 *    이미 겪었다). 나중에 yyplus 가 이쪽을 import 하도록 수렴시키는 게 목표다.
 *
 * 구현: 표준 TM 역변환(자오선 호장 → footpoint latitude 급수 → 경위도). proj4 불필요.
 */

/** GRS80 타원체 (한국 측지계 2000이 쓰는 타원체) */
const GRS80 = { a: 6378137.0, f: 1 / 298.257222101 };

/**
 * 한국에서 쓰이는 TM 좌표계 정의.
 *   5179 = Korea 2000 / Unified CS (UTM-K)  — 행안부 주소자료 표준
 *   5186 = Korea 2000 / Central Belt 2010   — 일부 구자료
 */
export const TM_PARAMS = {
  5179: { lat0: 38, lon0: 127.5, k0: 0.9996, x0: 1000000, y0: 2000000 },
  5186: { lat0: 38, lon0: 127.0, k0: 1.0, x0: 200000, y0: 600000 },
};

/** 대한민국 경위도 범위 — 변환 결과 검증용(밖이면 입력 좌표계가 틀린 것이다). */
export const KR_BOUNDS = { latMin: 32.5, latMax: 39.0, lngMin: 124.0, lngMax: 132.5 };

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** 자오선 호장 M(φ) — 적도부터 위도 φ 까지의 자오선 거리 */
function meridianArc(phi, a, e2) {
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const A = 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256;
  const B = (3 / 8) * (e2 + e4 / 4 + (15 * e6) / 128);
  const C = (15 / 256) * (e4 + (3 * e6) / 4);
  const D = (35 / 3072) * e6;
  return a * (A * phi - B * Math.sin(2 * phi) + C * Math.sin(4 * phi) - D * Math.sin(6 * phi));
}

/**
 * TM(x=easting, y=northing) → WGS84 {lat, lng}.
 * 한국 범위를 벗어나면 null(=입력 좌표계 오지정 신호).
 *
 * @param {number} x  동쪽 방향(행안부 자료의 X좌표)
 * @param {number} y  북쪽 방향(행안부 자료의 Y좌표)
 * @param {number} epsg 5179(기본) | 5186
 */
export function tmToWgs84(x, y, epsg = 5179) {
  const p = TM_PARAMS[epsg];
  if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  const { a, f } = GRS80;
  const e2 = 2 * f - f * f;              // 제1이심률의 제곱
  const ep2 = e2 / (1 - e2);             // 제2이심률의 제곱

  const M0 = meridianArc(p.lat0 * D2R, a, e2);
  const M = M0 + (y - p.y0) / p.k0;

  // footpoint latitude — M 에 해당하는 위도를 급수로 역산
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const C1 = ep2 * cos1 * cos1;
  const T1 = tan1 * tan1;
  const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
  const R1 = (a * (1 - e2)) / (1 - e2 * sin1 * sin1) ** 1.5;
  const D = (x - p.x0) / (N1 * p.k0);

  const D2 = D * D;
  const lat = phi1 - ((N1 * tan1) / R1) * (
    D2 / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D2 * D2) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D2 ** 3) / 720
  );
  const lng = p.lon0 * D2R + (
    D
    - ((1 + 2 * T1 + C1) * D2 * D) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D2 ** 2 * D) / 120
  ) / cos1;

  const latDeg = lat * R2D;
  const lngDeg = lng * R2D;
  if (
    !Number.isFinite(latDeg) || !Number.isFinite(lngDeg)
    || latDeg < KR_BOUNDS.latMin || latDeg > KR_BOUNDS.latMax
    || lngDeg < KR_BOUNDS.lngMin || lngDeg > KR_BOUNDS.lngMax
  ) return null;

  return { lat: latDeg, lng: lngDeg };
}

/** 두 지점 거리(m) — 변환 검증·이상탐지용 하버사인 */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const dLat = (lat2 - lat1) * D2R;
  const dLng = (lng2 - lng1) * D2R;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
