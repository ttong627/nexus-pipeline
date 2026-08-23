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
// A-10 ③ 멱등 보강(2026-08-23 · 동대문구 08 재정제 dry-run 실측): 1~2자리 동(`3동 302호`→`3- 302호`)은 **자기 출력형**을
//   다시 못 읽어 재정제 때 `302호`로 동이 소실됐다(동 `3-`는 특이사항으로 밀림). 자기 출력형 두 가지만 추가로 인식한다 —
//   ⓐ `N-` + 공백 패딩 + 3~4자리 호(`3- 302호`) ⓑ `N-` + 4자리 호(`10-1203호`, 패딩 없음). `12-301호`(대시 바로 3자리)·`1-2호`·`40-25호`는 여전히 미개입.
const SELF_DASH_HO_SRC = '\\d{1,2}-(?:\\s+\\d{3,4}|\\d{4})\\s*호';
export const DONG_DASH_HO_SRC = `(?:\\d{3,4}\\s*-\\s*(?:(?:지하|[Bb])?\\s*\\d+\\s*층\\s*)?(?:제\\s*)?\\d{3,4}\\s*호|${SELF_DASH_HO_SRC})`;

/** 호수 4자리 우측정렬 패딩 — 정렬 시 302 < 1008 자연정렬
 *  @param {string|number} ho */
const padHo = (ho) => `${' '.repeat(Math.max(0, 4 - String(ho).length))}${ho}`;

/** 층 표기 조립 — 없으면 빈 문자열
 *  @param {string} [prefix] @param {string|number} [floor] */
const floorText = (prefix, floor) => (floor ? `${prefix || ''}${floor}층` : '');

// 호수 앞에 동(棟) 토큰이 이미 있는지 — 있으면 '동 없는 호수' 패딩 대상이 아니다.
// (A-10 확장의 원래 의도 = 동이 없는 건물만 패딩. 층이 동과 호 사이에 남을 수 있어
//  2글자 룩비하인드로는 판별이 깨지므로 앞 구간 전체를 본다.)
const HAS_DONG_BEFORE_RE = /[\d가-힣A-Za-z]동(?=\s|\d|호|,|$)|\d{3,4}\s*-\s*|\d{1,2}-\s+|\d{1,2}-(?=\d{4}\s*호)/;

// 명시적 '동' + [층] + 호
const DONG_HO_RE = /([가-힣A-Za-z\d-]+)동\s*(?:(지하|[Bb])?\s*(\d+)\s*층\s*)?(?:제\s*)?(\d+)\s*호/g;
// 대시로 쓰인 숫자 동 + [층] + 호 — 동은 1~4자리를 잡되, 1~2자리는 replacer 에서 자기 출력형(ⓐⓑ)일 때만 채택한다
const DASH_HO_RE = new RegExp(`(^|[\\s,(])(\\d{1,4})(\\s*-\\s*)(?:(지하|[Bb])?\\s*(\\d+)\\s*층\\s*)?(?:제\\s*)?(\\d{3,4})\\s*호`, 'g');
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
  out = out.replace(DASH_HO_RE, (m, pre, dong, dash, floorPrefix, floor, ho) => {
    // 1~2자리 동은 자기 출력형(ⓐ 대시+공백 패딩 / ⓑ 대시+4자리 호, 층 없음)일 때만 — 그 외(`12-301호`)는 지번·호수 오인 위험이라 미개입
    if (dong.length <= 2) {
      const selfFmt = !floor && (/^-\s+$/.test(dash) || (dash === '-' && ho.length === 4));
      if (!selfFmt) return m;
    }
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
