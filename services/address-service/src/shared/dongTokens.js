// @ts-check
// ══════════════════════════════════════════════════════════════════
//  A-37 한글 음역 영문동(에이동·비동·씨동·에이치동 …) = 건물 동(棟) — 클라·서버 공용 SSOT
// ══════════════════════════════════════════════════════════════════
// 형 지적(2026-08-23): "빌라나 아파트에 한글로 동이 붙으면(에이동·비동·씨동·에이치동 등)
//   읍면동으로 인식하는 것 같다." → 실측 결과 그대로였다(근거: scripts/translit-dong.test.mjs).
//
// 왜 생겼나: 동(棟) 토큰 판정(`DONG_UNIT_SRC`·A-29)이 숫자동(101동)·영문동(B동)·단일한글동(가동)만
//   알았다. `에이동`은 그 어디에도 없어 `[가-힣]+동`(법정동 모양)으로 흘러갔고, 경로에 따라
//   ①괄호 첫 토큰(법정동 자리)에 들어가거나 ②주소DB 건물명과 달라 `빌라명 에이동` 통째로
//   특이사항으로 밀리거나 ③건물명이 같으면 `에이동`만 조용히 삭제됐다. 셋 다 상세주소에서 동이 사라진다.
//
// ★ 두 등급으로 나눈다 — 행안부 주소DB(juso.sqlite 2026-06판, 전국 640만 행)로 실존 법정동과 대조한 결과:
//   · STRICT   : 실존 법정동과 겹치지 않는 음역(0건) → 호수 없이도 건물 동으로 확정.
//   · AMBIGUOUS: 실존 법정동이 있는 음역 — 이동(안산·의왕·김해·창원·포항), 지동(수원 팔달구),
//                오동(대전 동구·서구), 유동(인천·목포·광주 북구) → **호수(N호)가 뒤따를 때만** 건물 동.
//     (A-29의 단일 한글동 규칙과 같은 원칙: 호수 동반 시에만 — 법정동 오인 방지)
// ★ 앞글자 가드 `(?<![가-힣A-Za-z\d])` 필수 — 없으면 `대비동`·`신이동빌라` 안의 `비동`·`이동`이 잘린다.
// ★ 새 음역을 추가할 때는 반드시 juso DB로 실존 법정동 여부를 먼저 확인하고 등급을 정할 것.

/** 실존 법정동과 겹치지 않는 음역 — 긴 것 먼저(정규식 대안 순서) */
export const TRANSLIT_DONG_STRICT = Object.freeze([
  '에이치', '더블유', '에이', '에프', '아이', '제이', '케이', '에스', '브이', '엑스', '와이', '제트',
  '비', '씨', '디', '엘', '엠', '엔', '피', '큐', '알', '티',
]);
/** 실존 법정동이 있는 음역 — 호수 동반 시에만 건물 동 */
export const TRANSLIT_DONG_AMBIGUOUS = Object.freeze(['이', '지', '오', '유']);

const STRICT_ALT = TRANSLIT_DONG_STRICT.join('|');
const AMBIG_ALT  = TRANSLIT_DONG_AMBIGUOUS.join('|');
/** 전체 음역(strict+ambiguous) 대안 — 상세주소 성분 판정(noteSanitizer)처럼 문맥상 동호가 확실한 곳용 */
export const TRANSLIT_DONG_ALL_ALT = `${STRICT_ALT}|${AMBIG_ALT}`;
/** 앞글자 가드 — 다른 한글·영문·숫자에 붙어 있으면 단어의 일부다 */
const LEAD_GUARD = '(?<![가-힣A-Za-z\\d])';
const HO_AFTER   = '(?=\\s*\\d{1,4}\\s*호)';

/**
 * 동(棟) 단위 토큰 정규식 소스 조각 — `detailNormalize.js` `DONG_UNIT_SRC`에 합류한다.
 * strict: `에이동`(뒤에 공백/숫자/호/콤마/끝) · ambiguous: `이동 201호`(호수 동반)
 */
export const TRANSLIT_DONG_UNIT_SRC =
  `${LEAD_GUARD}(?:${STRICT_ALT})동(?=\\s|\\d|호|,|$)|${LEAD_GUARD}(?:${AMBIG_ALT})동${HO_AFTER}`;

const STRICT_TOKEN_RE = new RegExp(`^(?:${STRICT_ALT})동$`, 'u');
const AMBIG_TOKEN_RE  = new RegExp(`^(?:${AMBIG_ALT})동$`, 'u');
const HO_AFTER_RE     = /^\s*\d{1,4}\s*호/;

/**
 * 토큰 하나가 '음역 영문 건물 동'인가.
 * @param {unknown} token  `에이동`·`이동` 같은 단일 토큰(공백·콤마 없음)
 * @param {string} [after] 토큰 바로 뒤 텍스트 — ambiguous(이·지·오·유)는 여기에 `N호`가 있어야 건물 동
 */
export const isTranslitBuildingDong = (token, after = '') => {
  const t = String(token || '').trim();
  if (!t) return false;
  if (STRICT_TOKEN_RE.test(t)) return true;
  return AMBIG_TOKEN_RE.test(t) && HO_AFTER_RE.test(String(after || ''));
};

// A-29(건물 동 괄호 침범 차단)의 꼬리 분리 규칙 + A-37 음역 확장. 끝에 붙은 건물 동(棟)[+호]만 분리한다.
//  - 숫자동(101동)·영문동(B동)·strict 음역동(에이동)은 호수 동반 무관하게 건물 동으로 확정
//  - 단일 한글동(가동·나동 … 이동·지동 포함)은 "호수 동반" 시에만 — 법정동(사동·본동·이동 등) 오인 방지
//  - 앞 건물명은 보존: "푸르지오 101동" → head "푸르지오" / dong "101동"
const BUILDING_DONG_TAIL_RE = new RegExp(
  `^(.*?)\\s*((?:\\d+|[A-Za-z]+|${LEAD_GUARD}(?:${STRICT_ALT}))동(?:\\s*제?\\s*\\d+\\s*호)?|[가-힣]동\\s*제?\\s*\\d+\\s*호)$`,
  'u',
);
// guarded 판: 모든 동 토큰 앞에 경계(시작·공백·콤마)를 요구 — 괄호 문구(법정동·행정동이 흔함)에서
//   `답십리2동`→`2동`, `장안동 201호`→`안동 201호` 같은 오절단을 막는다. 건물명 경로(A-29)는 기존 판을 유지한다
//   (`래미안101동`처럼 붙여 쓴 건물동도 분리해야 하므로).
const BUILDING_DONG_TAIL_GUARDED_RE = new RegExp(
  `^(.*?)\\s*(${LEAD_GUARD}(?:\\d+|[A-Za-z]+|${STRICT_ALT})동(?:\\s*제?\\s*\\d+\\s*호)?|${LEAD_GUARD}[가-힣]동\\s*제?\\s*\\d+\\s*호)$`,
  'u',
);

/**
 * 문자열 끝의 건물 동(棟)[+호]을 떼어낸다. 없으면 null.
 * @param {unknown} text
 * @param {{ guarded?: boolean }} [opts] guarded=true 면 동 토큰 앞에 경계를 요구(괄호 문구용)
 * @returns {{ head: string, dong: string } | null}
 */
export const splitBuildingDongTail = (text, opts = {}) => {
  const re = opts.guarded ? BUILDING_DONG_TAIL_GUARDED_RE : BUILDING_DONG_TAIL_RE;
  const m = String(text || '').trim().match(re);
  if (!m || !m[2]) return null;
  return { head: m[1].trim(), dong: m[2].trim() };
};
