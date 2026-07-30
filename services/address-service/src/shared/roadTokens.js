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

/** 공통 도로명 오타 보정 — 재기로 → 제기로 (양쪽 동일 적용) */
export const normalizeCommonRoadTypos = (value) =>
  String(value || '').replace(/재기로(?=\d*길|\s*\d)/g, '제기로');
