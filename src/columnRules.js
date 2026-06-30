// @ts-check
// 포수(수량) 칼럼 매칭 공용 규칙 — 워커(excelWorker)와 UI(Step3_Mapping)가 함께 쓴다.
// CLAUDE.md §5. 단일 소스로 관리해 워커/UI 간 규칙이 어긋나지 않게 한다.

// 포수(수량)로 절대 매칭하면 안 되는 '가구원수/인원' 계열 헤더.
// '가구'·'세대'가 들어간 칼럼은 무조건 인원(가구원수) 계열 → 포수 매칭 절대 금지(부분일치 전면 차단).
// '가구'·'세대'만 남기면 가구원·가구수·가구당·세대원·세대수·세대당 등을 모두 포함한다.
export const HOUSEHOLD_EXCL = ['가구', '세대', '인원', '구성원', '동거인', '식구', '명수'];
export const HOUSEHOLD_RE = new RegExp(HOUSEHOLD_EXCL.join('|'));

// 헤더가 '가구원수/인원' 계열이면 true → 포수로 매칭 금지(저장된 매핑 복원 시에도 차단).
/** @param {unknown} h @returns {boolean} */
export const isHouseholdHeader = (h) => HOUSEHOLD_RE.test(String(h || '').replace(/\s+/g, ''));
