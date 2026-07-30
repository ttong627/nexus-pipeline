// @ts-check
// ══════════════════════════════════════════════════════════════════
//  A-10 동호(棟戶) 형식 정규화 — 순수함수 (addressEngine에서 분리, 회귀테스트 대상)
// ══════════════════════════════════════════════════════════════════
// 형 지시(2026-07-30) · 절대 되돌리지 말 것:
//   ① '층을 호 뒤로 보내는' 규칙은 **앞에 숫자 동(101동·1307동)이 붙을 때만** 적용한다.
//   ② 동이 없거나 비숫자 동(가동·A동·B동·1-1동)이면 층 위치를 **원본 그대로 보존**한다.
//   ③ 동 대신 대시로 쓰인 숫자 동(101-203호)도 숫자 동으로 인식해 **같은 형식**으로 저장한다.
//
// 입력은 A-18(제 접두어 제거)·A-19(붙여쓰기 분리)를 거친 상세주소 문자열.
// 출력 규격: 숫자 동 → `101- 203호 3층`(대시 + 호수 4자리 우측정렬 + 층은 호 뒤)
//            비숫자 동 → `가동 3층 101호`(동 유지 + 원본 순서 유지)
//            동 없음  → `3층  101호`(층 그대로 + 호수만 4자리 우측정렬)

// 대시로 쓰인 숫자 동 인식 소스 — **동 3~4자리 + 호 3~4자리만**.
// 지번 부번(40-25)·다가구 호수(1-2호)를 동으로 오인하면 주소 변조 사고가 되므로 자리수로 차단한다.
// 호 표기('호')가 없는 대시(101-203)는 지번과 구분 불가라 대상에서 제외한다.
export const DONG_DASH_HO_SRC = '\\d{3,4}\\s*-\\s*(?:(?:지하|[Bb])?\\s*\\d+\\s*층\\s*)?(?:제\\s*)?\\d{3,4}\\s*호';

/** 호수 4자리 우측정렬 패딩 — 정렬 시 302 < 1008 자연정렬 */
const padHo = (ho) => `${' '.repeat(Math.max(0, 4 - String(ho).length))}${ho}`;

/** 층 표기 조립 — 없으면 빈 문자열 */
const floorText = (prefix, floor) => (floor ? `${prefix || ''}${floor}층` : '');

// 호수 앞에 동(棟) 토큰이 이미 있는지 — 있으면 '동 없는 호수' 패딩 대상이 아니다.
// (A-10 확장의 원래 의도 = 동이 없는 건물만 패딩. 층이 동과 호 사이에 남을 수 있어
//  2글자 룩비하인드로는 판별이 깨지므로 앞 구간 전체를 본다.)
const HAS_DONG_BEFORE_RE = /[\d가-힣A-Za-z]동(?=\s|\d|호|,|$)|\d{3,4}\s*-\s*/;

// 명시적 '동' + [층] + 호
const DONG_HO_RE = /([가-힣A-Za-z\d-]+)동\s*(?:(지하|[Bb])?\s*(\d+)\s*층\s*)?(?:제\s*)?(\d+)\s*호/g;
// 대시로 쓰인 숫자 동 + [층] + 호
const DASH_HO_RE = new RegExp(`(^|[\\s,(])(\\d{3,4})\\s*-\\s*(?:(지하|[Bb])?\\s*(\\d+)\\s*층\\s*)?(?:제\\s*)?(\\d{3,4})\\s*호`, 'g');
// 동(棟) 없이 호수만
const BARE_HO_RE = /(^|[\s,(])(\d{1,3})\s*호/g;

/**
 * 상세주소의 동호 표기를 규격화한다.
 * @param {unknown} detail A-18·A-19를 거친 상세주소
 * @returns {string} 규격화된 상세주소
 */
export const normalizeDongHoDetail = (detail) => {
  const src = String(detail || '');
  if (!src) return '';

  // ① 명시적 '동' — 숫자 동만 대시 변환 + 층을 호 뒤로. 비숫자 동은 층 위치 보존.
  let out = src.replace(DONG_HO_RE, (_, dong, floorPrefix, floor, ho) => {
    const flr = floorText(floorPrefix, floor);
    if (/^\d+$/.test(dong)) {
      // 순수 숫자 동(대단지 아파트): 101동 3층 203호 → 101- 203호 3층
      return `${dong}-${padHo(ho)}호${flr ? ` ${flr}` : ''}`;
    }
    // 한글/영문/대시 동(빌라·연립·1-1동): 층을 옮기지 않는다 — 가동 3층 101호 그대로
    return `${dong}동 ${flr ? `${flr} ` : ''}${ho}호`;
  });

  // ② 대시로 쓰인 숫자 동 — ①과 동일 형식으로 저장(멱등: ① 결과를 다시 통과해도 불변).
  out = out.replace(DASH_HO_RE, (_, pre, dong, floorPrefix, floor, ho) => {
    const flr = floorText(floorPrefix, floor);
    return `${pre}${dong}-${padHo(ho)}호${flr ? ` ${flr}` : ''}`;
  });

  // ③ 동(棟) 없이 호수만 있는 건물(예: RYUJIN VILL 302호) — 호수 4자리 우측정렬 패딩.
  const beforeBare = out;
  out = out.replace(BARE_HO_RE, (m, pre, ho, offset) => {
    if (HAS_DONG_BEFORE_RE.test(beforeBare.slice(0, offset + pre.length))) return m;
    return `${pre}${padHo(ho)}호`;
  });

  return out;
};
