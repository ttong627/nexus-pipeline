/**
 * 배송 브리프 — 모아둔 국가 데이터를 **기사가 읽을 한 줄**로 바꾸는 순수 모듈.
 *
 * ★이 모듈이 존재하는 이유 (설계서 v4 핵심결론)
 *   "문제는 9테이블 중 5개만 조회하고 detail_core 를 한 번도 안 본다는 것.
 *    형 질문('행안부 왜 안 써')의 답 = **안 쓰는 게 아니라 사놓고 안 꺼냄**."
 *   출입구 좌표 1,281만 건을 적재해놓고도(2026-08-01) **읽는 코드가 0건**이었다.
 *   적재는 자산이 아니다. 꺼내 써야 자산이다. 여기가 꺼내는 자리다.
 *
 * 의존 0 — DB·네트워크를 모른다. 그래서 테스트가 실측 값으로 가능하다.
 */

/**
 * 좌표 출처 서열 (설계서 v2 §좌표 서열 역전).
 *
 * ★yyplus 주석이 이미 정답을 적어놨다 — "**카카오·VWorld 는 추정이다**".
 *   국가 출입구 좌표는 실제 건물 출입구를 측량한 값이고, 지오코딩은 주소 문자열을
 *   좌표로 '추정'한 값이다. 둘을 같은 자격으로 쓰면 정확한 걸 갖고도 추정치를 배송에 쓴다.
 *   숫자가 낮을수록 우선.
 */
export const COORD_RANK = {
  juso_entrance: 1,     // 국가 출입구 좌표(entrance_core) — 측량값
  juso_dong: 2,         // 국가 동 도형(300002) — 아파트 동별
  vworld: 3,            // VWorld 지오코딩 — 추정
  kakao: 4,             // 카카오 지오코딩 — 추정
};

export const COORD_LABEL = {
  juso_entrance: '국가 출입구(측량)',
  juso_dong: '국가 동도형',
  vworld: 'VWorld 추정',
  kakao: '카카오 추정',
};

/**
 * 후보 좌표 중 가장 신뢰도 높은 것을 고른다.
 * @param {Array<{kind:string, lat:number, lng:number}>} candidates
 * @returns {{kind, lat, lng, rank, label, alternatives:number}|null}
 */
export function pickCoordinate(candidates = []) {
  const valid = candidates.filter(
    (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && COORD_RANK[c.kind],
  );
  if (!valid.length) return null;
  valid.sort((a, b) => COORD_RANK[a.kind] - COORD_RANK[b.kind]);
  const best = valid[0];
  return {
    kind: best.kind,
    lat: best.lat,
    lng: best.lng,
    rank: COORD_RANK[best.kind],
    label: COORD_LABEL[best.kind],
    alternatives: valid.length - 1,
  };
}

/** 계단노동 등급 — 엘베 없는 층수가 곧 노동량이다. */
export const STAIR_NONE = 'none';        // 엘베 있음 또는 저층
export const STAIR_LIGHT = 'light';      // 계단 2층
export const STAIR_HEAVY = 'heavy';      // 계단 3~4층
export const STAIR_SEVERE = 'severe';    // 계단 5층 이상
export const STAIR_UNKNOWN = 'unknown';  // 건축물대장 미확보

/**
 * 계단노동 판정.
 *
 * ★null 과 0 을 절대 뭉개지 않는다
 *   elevator_count = 0 은 "대장상 승강기 없음"(계단노동 확정)이고,
 *   null 은 "모름"이다. 뭉개면 데이터가 없는 건물을 전부 "엘베 없음"으로 단정해
 *   난이도를 부풀리고, 기사에게 거짓 경고를 보낸다.
 */
export function assessStairLabor(building) {
  if (!building) return { level: STAIR_UNKNOWN, floors: null, reason: '건축물대장 미확보' };

  const elev = building.elevator_count;
  const floors = building.ground_floors;

  if (elev === null || elev === undefined) {
    return { level: STAIR_UNKNOWN, floors: floors ?? null, reason: '승강기 정보 없음' };
  }
  if (elev > 0) {
    return { level: STAIR_NONE, floors: floors ?? null, reason: `승강기 ${elev}대` };
  }
  if (floors === null || floors === undefined) {
    return { level: STAIR_UNKNOWN, floors: null, reason: '승강기 없음(층수 미상)' };
  }
  if (floors >= 5) return { level: STAIR_SEVERE, floors, reason: `엘베 없는 ${floors}층` };
  if (floors >= 3) return { level: STAIR_HEAVY, floors, reason: `엘베 없는 ${floors}층` };
  if (floors === 2) return { level: STAIR_LIGHT, floors, reason: '엘베 없는 2층' };
  return { level: STAIR_NONE, floors, reason: '1층' };
}

/**
 * 기사에게 보여줄 한 줄 + 경고 목록.
 *
 * @param {object} input
 *  - address: 매칭된 주소(standardRoadAddress·buildingName)
 *  - coord:   pickCoordinate 결과
 *  - building: building_ext 행(없을 수 있음)
 *  - entrance: entrance_core 행(없을 수 있음) — 폐지 여부·좌표상태가 여기 있다
 */
export function buildDeliveryBrief({ address = {}, coord = null, building = null, entrance = null } = {}) {
  const stair = assessStairLabor(building);
  const warnings = [];
  const facts = [];

  // ── 좌표 신뢰도 ────────────────────────────────
  if (!coord) {
    warnings.push({ code: 'no_coordinate', message: '좌표를 찾지 못했습니다. 현장 확인 필요.' });
  } else if (coord.rank >= COORD_RANK.vworld) {
    // 추정 좌표를 쓰고 있다는 사실 자체를 숨기지 않는다.
    warnings.push({
      code: 'estimated_coordinate',
      message: `좌표가 ${coord.label}입니다. 국가 출입구 좌표가 없어 추정치를 씁니다.`,
    });
  }

  // ── 폐지 주소 ──────────────────────────────────
  // yyplus 는 삭제분을 안 읽어 폐지 주소가 영구히 남는다. 우리는 말해준다.
  if (entrance && entrance.is_retired) {
    warnings.push({
      code: 'retired_address',
      message: `폐지된 도로명주소입니다(${entrance.retired_at || '일자미상'}). 주소 정정이 필요합니다.`,
    });
  }

  // ── 좌표 격리 ──────────────────────────────────
  if (entrance && entrance.coord_status === 'quarantined') {
    warnings.push({
      code: 'quarantined_coordinate',
      message: '국가 원본 좌표가 이상치로 격리된 건물입니다. 출입구 좌표를 신뢰하지 마십시오.',
    });
  }

  // ── 계단노동 ───────────────────────────────────
  if (stair.level === STAIR_SEVERE || stair.level === STAIR_HEAVY) {
    warnings.push({ code: 'stair_labor', message: `${stair.reason} — 계단 운반 준비 필요` });
  }

  if (address.buildingName) facts.push(address.buildingName);
  if (building) {
    if (building.dong_name) facts.push(`${building.dong_name}동`);
    if (building.ground_floors !== null && building.ground_floors !== undefined) {
      facts.push(`지상 ${building.ground_floors}층`);
    }
    if (building.elevator_count !== null && building.elevator_count !== undefined) {
      facts.push(building.elevator_count > 0 ? `엘베 ${building.elevator_count}대` : '엘베 없음');
    }
    if (building.household_count) facts.push(`${building.household_count}세대`);
    if (building.main_purpose) facts.push(building.main_purpose);
  }
  if (coord) facts.push(coord.label);

  return {
    summary: facts.join(' · ') || '정보 없음',
    stair,
    warnings,
    // 데이터가 어디까지 실측인지 그대로 노출한다 — 화면이 이걸 보고 배지를 띄운다.
    coverage: {
      coordinate: coord ? coord.kind : null,
      building: Boolean(building),
      entrance: Boolean(entrance),
    },
  };
}
