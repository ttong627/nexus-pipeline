/**
 * 행안부 건물관리번호(25자) → 건축물대장 조회 파라미터. 순수 함수, 의존 0.
 *
 * ★이 모듈이 P7 전체를 성립시킨다
 *   `building_ext` 의 PK 는 building_mgt_no 인데, 건축물대장 API 는 **지번으로만** 조회된다.
 *   둘을 잇지 못하면 테이블을 만들어도 조인이 안 돼서 무용지물이다.
 *   다행히 건물관리번호 안에 조회에 필요한 값이 통째로 들어 있다:
 *
 *     4117310200  1   1384  0028  000627
 *     └법정동(10) └?  └본번  └부번 └건물일련번호
 *       │
 *       ├ [0:5]  = sigunguCd (시군구코드)
 *       └ [5:10] = bjdongCd  (법정동 뒷자리)
 *
 *   이 경로의 이점: 카카오 지오코딩을 거치지 않는다. 형 PC 배치는
 *   `주소 → 카카오 → 지번 → 건축물대장` 을 타는데, 카카오 호출이 추가로 들고
 *   지오코딩 오차가 개입한다. 국가 키에서 국가 키로 바로 가는 편이 정확하고 싸다.
 *
 * ⚠️ **11번째 자리는 platGbCd 가 아니다** (실측 2026-08-03)
 *   가설은 "11번째 = 대지구분 = platGbCd" 였다. 그대로 넣었더니 **0건**이 나왔고,
 *   `platGbCd=0` 으로 고정하니 1건이 정상 조회됐다(안양 동안구 관악대로 287, 지상2층·승강기0).
 *   가설을 검증 없이 믿었으면 전량 0건을 "건물 없음"으로 오독할 뻔했다.
 *   현재 확인된 사실은 이것뿐이다: **11번째=1 인 건은 platGbCd=0 으로 조회된다.**
 *   산(山) 지번 등 다른 값의 대응은 아직 실측되지 않았다 → 후보를 순서대로 시도하고
 *   무엇이 맞았는지 기록한다(`PLAT_GB_CANDIDATES`). 표본이 쌓이면 표를 확정한다.
 */

/** 건물관리번호 길이(행안부 규격) */
export const MGT_NO_LENGTH = 25;

const DIGITS_25 = /^\d{25}$/;

/**
 * 건물관리번호를 조회 좌표로 분해한다.
 * @returns {{sigunguCd:string, bjdongCd:string, landGb:string, bun:string, ji:string,
 *            serial:string}|null} 규격 위반이면 null(호출부가 집계해 버린다)
 */
export function decodeBuildingMgtNo(mgtNo) {
  const s = String(mgtNo ?? '').trim();
  if (!DIGITS_25.test(s)) return null;
  return {
    sigunguCd: s.slice(0, 5),
    bjdongCd: s.slice(5, 10),
    landGb: s.slice(10, 11),     // ★platGbCd 가 아니다(위 주석 참조). 원본 보존용.
    bun: s.slice(11, 15),
    ji: s.slice(15, 19),
    serial: s.slice(19, 25),
  };
}

/**
 * 시도할 platGbCd 후보를 우선순위대로 돌려준다.
 *
 * 실측된 것만 1순위로 두고, 나머지는 후보로 남긴다. "모르는 것을 안다고 하지 않는다".
 * 첫 후보에서 결과가 나오면 두 번째는 호출하지 않으므로, 표본이 흔한 케이스(대지)면
 * 실질 호출 수는 1회다.
 */
export function platGbCandidates(decoded) {
  if (!decoded) return [];
  // landGb='1' → platGbCd='0' 은 실측 확인됨. 그 외 값은 미확인이라 0·1 을 둘 다 시도한다.
  return decoded.landGb === '1' ? ['0'] : ['0', '1'];
}

/**
 * 건축물대장 표제부 조회 쿼리 파라미터.
 * bun·ji 는 4자리 0패딩 그대로 쓴다(API 가 문자열 비교라 패딩을 벗기면 안 맞는다).
 */
export function toBldRgstParams(decoded, platGbCd) {
  return {
    sigunguCd: decoded.sigunguCd,
    bjdongCd: decoded.bjdongCd,
    platGbCd,
    bun: decoded.bun,
    ji: decoded.ji,
  };
}

/**
 * 같은 지번의 여러 동 중 **이 건물관리번호에 해당하는 한 채**를 고른다.
 *
 * ★왜 필요한가
 *   건축물대장은 지번 단위로 응답한다 — 전남 나주 빛가람동 118 은 **22건**이 나온다.
 *   형 PC 배치는 이걸 `max(층수)` 하나로 눌러 저장하는데, 그러면 어느 동에 엘베가 있는지
 *   알 수 없다. 배송기사에게 필요한 건 평균이 아니라 **그 집 건물**이다.
 *
 * 매칭 근거는 건물일련번호(serial)다. 다만 건축물대장 응답에는 행안부 일련번호가 없으므로,
 * 응답이 1건이면 그것을 쓰고, 여러 건이면 동명(dongNm)·건물명으로 좁힌다.
 * **좁혀지지 않으면 단일 채택하지 않는다** — 설계서 P3 의 "다중 후보는 단일 채택 금지"와 같은 원칙.
 *
 * @param {object[]} items 건축물대장 표제부 목록
 * @param {{dongName?:string, buildingName?:string}} hint 행안부 쪽에서 아는 동·건물명
 * @returns {{item:object|null, ambiguous:boolean, candidates:number}}
 */
export function pickBuilding(items, hint = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return { item: null, ambiguous: false, candidates: 0 };
  if (list.length === 1) return { item: list[0], ambiguous: false, candidates: 1 };

  const norm = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();
  const wantDong = norm(hint.dongName);
  const wantName = norm(hint.buildingName);

  if (wantDong) {
    const hit = list.filter((it) => norm(it.dongNm) === wantDong);
    if (hit.length === 1) return { item: hit[0], ambiguous: false, candidates: list.length };
  }
  if (wantName) {
    const hit = list.filter((it) => norm(it.bldNm) === wantName);
    if (hit.length === 1) return { item: hit[0], ambiguous: false, candidates: list.length };
  }
  // 좁혀지지 않았다. 아무거나 고르면 엉뚱한 동의 엘베를 그 집 것이라고 말하게 된다.
  return { item: null, ambiguous: true, candidates: list.length };
}
