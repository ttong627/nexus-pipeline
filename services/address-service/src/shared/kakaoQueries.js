// ══════════════════════════════════════════════════════════════════
//  Kakao 조회의 순수부 (클라·서버 공용 SSOT) — P7 Phase2 ⓒ-2
//
//  purifyCore는 Kakao 호출을 `deps.io`로 받는다. 그런데 "무엇을 물어보고(검색어 조립)
//  무엇을 채택할지(A-30 지역검증·법정동 판정)"는 **규칙**이지 IO가 아니다.
//  이걸 클라 어댑터와 서버 어댑터에 각각 적어두면, 같은 주소가 브라우저 정제와
//  서버 정제에서 다른 괄호(법정동)를 갖게 된다. → 규칙은 여기 한 곳.
//
//  ⚠️ URL 문자열은 골든 카세트의 키다. 바꾸면 녹화본이 전부 미스가 된다(형식 유지).
// ══════════════════════════════════════════════════════════════════
import { extractSigungu, isCandidateInSelectedMunicipality, LEGAL_DONG_RE } from './purifyHelpers.js';

// 주소 문자열 앞부분에 시/도 토큰이 이미 있는지 — 있으면 지자체 접두어를 덧붙이지 않는다.
const HAS_CITY_RE = /특별시|광역시|특별자치시|도$|시$/;

export const kakaoAddressSearchUrl = (query) =>
  `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=1`;

export const kakaoKeywordSearchUrl = (query) =>
  `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=1`;

/**
 * A-31: 법정동 보강조회용 검색어. 전국 동명 오매칭을 막기 위해 시군구 접두어를 강제한다.
 * @returns {string} 조회할 수 없으면 빈 문자열
 */
export const buildLegalDongQuery = (addr, cityLabel = '') => {
  const text = String(addr || '');
  if (text.trim().length < 4) return '';
  const hasCity = HAS_CITY_RE.test(text.slice(0, 10));
  const sggPfx = hasCity ? '' : (extractSigungu(cityLabel) || String(cityLabel || '').trim().split(/\s+/).pop() || '');
  return `${sggPfx ? `${sggPfx} ` : ''}${text}`.trim();
};

/**
 * Kakao 주소검색 응답에서 **법정동**만 채택한다.
 *   region_3depth_name   = 법정동  ← 이것만 쓴다
 *   region_3depth_h_name = 행정동  ← 쓰지 않는다 (형 지시 2026-07-21)
 * A-30 지역검증을 통과하지 못하면 채택하지 않는다(시흥시 군자동 vs 광진구 군자동).
 * @returns {{legalDong: string, buildingName: string}|null}
 */
export const pickLegalDongFromKakao = (doc, cityLabel = '') => {
  if (!doc) return null;
  const ra = doc.road_address || null;
  const ad = doc.address || null;
  const sido = ra?.region_1depth_name || ad?.region_1depth_name || '';
  const sgg = ra?.region_2depth_name || ad?.region_2depth_name || '';
  if (!isCandidateInSelectedMunicipality({ matchedSido: sido, matchedSigungu: sgg }, cityLabel)) return null;
  const legal = String(ra?.region_3depth_name || ad?.region_3depth_name || '').trim();
  if (!legal || !LEGAL_DONG_RE.test(legal)) return null;
  return {
    legalDong: legal,
    buildingName: String(ra?.building_name || '').trim(),
  };
};
