// @ts-check
// ══════════════════════════════════════════════════════════════════
//  도로명 토큰 정의 — **클라·서버 공용 단일 출처(SSOT)**
// ══════════════════════════════════════════════════════════════════
// 형 지적(2026-07-30): 도로명 파싱 패턴이 클라(`src/engine/addressEngine.js`)와
// 서버(`services/address-service/src/normalize.js`)에 **복제**돼 있어, 한쪽만 고치면
// 조용히 갈라지고 매칭률이 떨어져도 원인이 안 보였다. 이 파일이 유일한 정의다.
//
// ★위치가 서버 쪽인 이유: 서버 Docker 빌드 컨텍스트가 `services/address-service/`이고
//   Dockerfile이 `COPY src ./src` 하므로, 이 경로에 있어야 **배포 파이프라인 변경 없이**
//   서버가 가져갈 수 있다. 클라(Vite)는 프로젝트 루트 내 상대경로로 import 가능하다.
//   반대로 루트 `src/`에 두면 서버 이미지에 포함되지 않는다.
//
// ⚠️ 여기를 고치면 클라·서버 양쪽 동작이 동시에 바뀐다. A-23(가지도로 접미사) 등
//    민감 규칙이 걸려 있으니 `scripts/road-regex-parity.test.mjs` 통과를 반드시 확인할 것.

/** 한글 음절 범위 */
export const HANGUL = '\\uAC00-\\uD7A3';

// A-23: 가지도로 접미사 — 번길·번가길·가길·나길…·길.
//   '길'을 마지막에 두어야 "홍양길 43번길"에서 '번길'이 먼저 잡힌다(순서 의존).
export const BRANCH_SUFFIX =
  '(?:\\uBC88\\uAE38|\\uBC88\\uAC00\\uAE38|\\uAC00\\uAE38|\\uB098\\uAE38|\\uB2E4\\uAE38|\\uB77C\\uAE38|\\uB9C8\\uAE38|\\uBC14\\uAE38|\\uC0AC\\uAE38|\\uC544\\uAE38|\\uC790\\uAE38|\\uCC28\\uAE38|\\uCE74\\uAE38|\\uD0C0\\uAE38|\\uD30C\\uAE38|\\uD558\\uAE38|\\uAE38)';

/** 도로명 본체 — ①대로/로 + 숫자 + 가지접미사(사가정로2길) ②대로/로/길 단독 */
export const ROAD_NAME_SOURCE =
  `(?:[${HANGUL}A-Za-z0-9]+(?:\\uB300\\uB85C|\\uB85C)\\s*\\d+[${HANGUL}0-9]*${BRANCH_SUFFIX}|[${HANGUL}A-Za-z0-9]+(?:\\uB300\\uB85C|\\uB85C|\\uAE38))`;

/** 도로명 뒤 건물번호(지하 접두·부번 포함) — 선행 구분자는 각자 조립한다 */
export const ROAD_NUMBER_TAIL = '\\s*(\\uC9C0\\uD558\\s*)?(\\d{1,5})(?:\\s*-\\s*(\\d{1,5}))?';

/** 공통 도로명 오타 보정 — 재기로 → 제기로 (양쪽 동일 적용)
 *  @param {string} [value] */
export const normalizeCommonRoadTypos = (value) =>
  String(value || '').replace(/재기로(?=\d*길|\s*\d)/g, '제기로');

/**
 * A-23 보강(2026-08-12) — **숫자와 가지접미사 사이 공백**을 붙인다: `봉우재로 36 번길` → `봉우재로36번길`.
 *
 * ★왜 여기(SSOT)에 두는가: 이 규칙이 필요한 곳이 **두 군데**다.
 *   ① `shared/detailNormalize.js` `normalizeRoadAddressSpacing` — 정제(purify) 경로
 *   ② `normalize.js` `normalizeBranchRoadSpacing` — 서버 주소매칭 경로
 *   두 파일엔 이미 비슷한 정규식이 **각자** 있었고 미묘하게 달랐다(②는 base 에 `길` 이 없다).
 *   새 규칙까지 복제하면 또 갈라진다 — 그래서 여기 한 벌만 둔다.
 *
 * ★실측 근거: 명단에 `봉우재로 36, (정왕동, 번길)` 처럼 저장돼 있었다. 붙이지 못하면 파서가
 *   `봉우재로 36` 까지만 도로로 보고 **`번길` 을 건물명 슬롯에 떨어뜨린다.** 실제 도로는
 *   `봉우재로36번길`(행안부 원본DB 7행)로 실재한다. 그 뒤 지오코딩이 도로명 조각으로 나가
 *   전국에서 아무 데나 맞았다(최대 201km 실측).
 *
 * ⚠️`(?![HANGUL])` 가드를 빼지 말 것 — 없으면 `중앙로 12 길동아파트` 가 `중앙로12길동아파트` 로,
 *   `시청로 20 길가온마을` 이 `시청로20길가온마을` 로 붙는다(가드 없는 안에서 실측된 퇴행 2건).
 *   **가지도로 토큰은 그 자리에서 끝나야 도로명이다.**
 *
 * 회귀: `scripts/road-branch-space.test.mjs`
 */
const BRANCH_SPACED_NUM_RE = new RegExp(
  `([${HANGUL}A-Za-z]+(?:\\uB300\\uB85C|\\uB85C|\\uAE38))\\s+(\\d+)\\s+([${HANGUL}0-9]*${BRANCH_SUFFIX})(?![${HANGUL}])`,
  'gu',
);

/** 위 규칙 적용 — `봉우재로 36 번길` → `봉우재로36번길`
 *  @param {string} [value] */
export const joinSpacedBranchRoad = (value) => String(value || '').replace(BRANCH_SPACED_NUM_RE, '$1$2$3');
