// 지자체명 순수 헬퍼 — 2026-08-27
//   ★파이어베이스를 import 하지 않는다(그래야 node --test 로 규칙을 못 박을 수 있다).
//     저장소 접근이 필요한 `fetchSavedCities` 는 `savedCities.js` 에 있다.

/** 한국어 가나다 정렬 + 공백 정리 + 중복 제거 */
export const normalizeCityList = (list = []) =>
  [...new Set((list || []).map((c) => String(c || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));

/**
 * 승인 목록 + 실제 저장된 지자체를 합친다.
 * @param {string[]} approved 사용자의 `citiesApproved`
 * @param {string[]} saved `cloud_lists` 문서 ID (B-14 정규 지자체명)
 * @param {boolean} isAdmin 관리자면 저장된 전체를 본다
 */
export const mergeCityLists = (approved = [], saved = [], isAdmin = false) => {
  const app = normalizeCityList(approved);
  const sav = normalizeCityList(saved);
  if (isAdmin) return normalizeCityList([...sav, ...app]);   // 관리자: 저장된 전체(+승인분)
  if (!app.length) return sav;                               // 승인 정보가 없어도 고를 것은 준다
  const savedSet = new Set(sav);
  const withData = app.filter((c) => savedSet.has(c));
  // 담당 지자체 중 실제 명단이 있는 곳을 앞세우되, 승인분은 하나도 빠뜨리지 않는다(M-1 정신)
  return withData.length ? normalizeCityList([...withData, ...app]) : app;
};

/**
 * 정규 지자체명을 시/도 + 시/군/구로 나눈다 (B-14: 도 포함 풀네임).
 *   `충청남도 천안시 동남구` → { sido: '충청남도', sigungu: '천안시 동남구' }
 *   `세종특별자치시`         → { sido: '세종특별자치시', sigungu: '' }
 */
export const splitCityName = (city) => {
  const s = String(city || '').trim().replace(/\s+/g, ' ');
  if (!s) return { sido: '', sigungu: '' };
  const i = s.indexOf(' ');
  if (i < 0) return { sido: s, sigungu: '' };
  return { sido: s.slice(0, i), sigungu: s.slice(i + 1).trim() };
};
