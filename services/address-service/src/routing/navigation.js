/**
 * 네비게이션 링크 생성 (모듈 ⑥) — 순수 함수, 의존 0.
 *
 * ★왜 코어에 두는가
 *   기사앱이 자기가 아는 좌표로 링크를 만들면, 그 좌표가 **추정치일 수 있다**.
 *   코어는 좌표 서열을 안다(국가 출입구 측량값 > 동도형 > VWorld > 카카오 추정).
 *   같은 주소라도 코어가 고른 좌표로 안내해야 기사가 정확한 출입구 앞에 선다.
 *   즉 이 모듈의 가치는 링크 문자열이 아니라 **어떤 좌표를 쓰느냐**에 있다.
 *
 * ★앱 스킴 vs 웹 링크
 *   앱 스킴(`tmap://`·`nmap://`)은 앱이 설치돼 있어야 열린다. 안 깔려 있으면 아무 일도
 *   안 일어나고 기사는 "버튼이 고장났다"고 느낀다. 그래서 **웹 링크를 항상 함께** 준다 —
 *   호출부가 앱 시도 후 일정 시간 내 전환이 없으면 웹으로 폴백하면 된다.
 *
 * ⚠️앱 스킴은 각 사의 공식 링크 규격을 따랐으나 **실기기 검증은 별도**다.
 *   OS·앱 버전에 따라 동작이 다를 수 있어, 형이 실제 폰에서 한 번 확인해야 확정이다.
 *   웹 링크(map.kakao.com·google.com/maps)는 브라우저에서 바로 확인 가능하다.
 */

/** 좌표가 한국 안에 있는지 — 엉뚱한 좌표로 안내하면 기사가 엉뚱한 곳으로 간다. */
const KR = { latMin: 32.5, latMax: 39.0, lngMin: 124.0, lngMax: 132.5 };

const validCoord = (lat, lng) => {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b)
    && a >= KR.latMin && a <= KR.latMax && b >= KR.lngMin && b <= KR.lngMax
    ? { lat: a, lng: b }
    : null;
};

/** 링크에 들어갈 이름 — 쉼표는 카카오 링크 규격의 구분자라 반드시 제거한다. */
const safeName = (value, fallback = '배송지') => {
  const s = String(value ?? '').replace(/[,\r\n]+/g, ' ').trim();
  return s || fallback;
};

/**
 * 네비게이션 링크 묶음.
 *
 * @param {object} input
 *   - lat/lng: 목적지 좌표(코어가 고른 최선의 좌표를 넣을 것)
 *   - name: 표시 이름(수령인명 금지 — PII. 건물명·주소를 쓴다)
 *   - address: 웹 검색 폴백용 주소
 * @returns {{ok:boolean, reason?:string, coordinate?:object, links?:object}}
 */
export function buildNavigationLinks({ lat, lng, name = '', address = '' } = {}) {
  const coord = validCoord(lat, lng);
  if (!coord) {
    // 좌표가 없으면 링크를 만들지 않는다. 대신 주소 검색 링크만 준다 —
    // 잘못된 좌표로 안내하는 것보다 "검색해서 찾아가라"가 낫다.
    const q = encodeURIComponent(String(address || name || '').trim());
    return {
      ok: false,
      reason: 'invalid_coordinate',
      links: q ? {
        kakaoSearchWeb: `https://map.kakao.com/link/search/${q}`,
        googleSearchWeb: `https://www.google.com/maps/search/?api=1&query=${q}`,
      } : {},
    };
  }

  const { lat: y, lng: x } = coord;
  const label = safeName(name || address);
  const enc = encodeURIComponent(label);

  return {
    ok: true,
    coordinate: { lat: y, lng: x },
    label,
    links: {
      // ── 웹(항상 동작·폴백용) ─────────────────────────────
      // 카카오맵 링크 규격: /link/to/{이름},{위도},{경도}
      kakaoWeb: `https://map.kakao.com/link/to/${enc},${y},${x}`,
      googleWeb: `https://www.google.com/maps/dir/?api=1&destination=${y},${x}`,

      // ── 앱 스킴(설치돼 있을 때) ───────────────────────────
      // ⚠️goalx=경도, goaly=위도 순서다. 뒤집으면 바다로 안내한다.
      tmapApp: `tmap://route?goalname=${enc}&goalx=${x}&goaly=${y}`,
      naverApp: `nmap://route/car?dlat=${y}&dlng=${x}&dname=${enc}&appname=wellshare.delivery`,
      kakaoApp: `kakaomap://route?ep=${y},${x}&by=CAR`,
    },
  };
}

/**
 * 배송 브리프(resolveDelivery 응답) → 네비 링크.
 * 코어가 고른 좌표를 그대로 쓰므로 호출부가 좌표를 다시 고를 필요가 없다.
 */
export function navigationFromBrief(resolved, fallbackName = '') {
  const data = (resolved && resolved.data) || resolved || {};
  const coord = data.coordinate || {};
  const address = (data.address && data.address.standardRoadAddress) || '';
  const building = (data.building && data.building.building_name)
    || (data.address && data.address.buildingName) || '';
  const out = buildNavigationLinks({
    lat: coord.lat, lng: coord.lng,
    name: building || fallbackName || address,
    address,
  });
  // 좌표 출처를 함께 알려준다 — 추정치로 안내하는지 기사가 알 수 있어야 한다.
  return { ...out, coordinateSource: coord.kind || null, coordinateLabel: coord.label || null };
}
