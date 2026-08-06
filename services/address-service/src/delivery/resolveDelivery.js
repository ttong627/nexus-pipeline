/**
 * 배송 조회 — entrance_core(출입구 좌표) · building_ext(건물) 를 실제로 **꺼내 쓰는** 계층.
 *
 * ★P4 ⓔ "조회 연결(현재 읽는 코드 0건)" 이 여기서 해소된다.
 *   2026-08-01 에 출입구 1,281만 건을 적재했지만 그걸 읽는 코드가 한 줄도 없었다.
 *
 * DB 접근은 주입받는다(`query`) — 테스트에서 가짜 질의로 대체하기 위해서다.
 * 어제 격리 판정기를 순수 모듈로 뽑아 실측값으로 검증했던 것과 같은 이유다.
 */

/**
 * 출입구 좌표 조회.
 *
 * ★조회 순서에 이유가 있다
 *   1순위 = 주소관리번호 직결. RNENTDATA(연계 전체분)에서 확보한 값이라 **주소와 1:1**이다.
 *   2순위 = 도로명코드+본번/부번. entrc(위치정보요약DB)에는 관리번호가 없어서
 *           이 경로가 아니면 요약DB 쪽 건물을 영영 못 찾는다.
 *   두 전체분이 서로 다른 정보를 갖는다는 사실(적재기에서 COALESCE 병합한 이유)이
 *   조회에서도 그대로 반복된다.
 *
 * ⚠️ 폐지된 주소도 **빼지 않고 가져온다**. 숨기면 "주소가 없다"가 되고, 그러면 현장에서
 *    왜 안 나오는지 알 수 없다. 폐지 사실을 실어 보내 화면이 경고하게 한다.
 */
export const findEntrance = async (query, schema, { addressMgtNo, roadCode, undergroundYn, mainNo, subNo, legalDongCode }) => {
  if (addressMgtNo) {
    const { rows } = await query(
      `SELECT entrance_key, lat, lng, coord_status, is_retired, retired_at,
              building_name, building_group_yn, entrance_no
         FROM ${schema}.entrance_core
        WHERE address_mgt_no = $1
        ORDER BY (lat IS NOT NULL) DESC, is_retired ASC
        LIMIT 1`,
      [addressMgtNo],
    );
    if (rows[0]) return rows[0];
  }
  if (!roadCode || mainNo === null || mainNo === undefined) return null;
  const { rows } = await query(
    `SELECT entrance_key, lat, lng, coord_status, is_retired, retired_at,
            building_name, building_group_yn, entrance_no
       FROM ${schema}.entrance_core
      WHERE road_code = $1
        AND underground_yn = $2
        AND building_main_no = $3
        AND building_sub_no = $4
        ${legalDongCode ? 'AND legal_dong_code = $5' : ''}
      ORDER BY (lat IS NOT NULL) DESC, is_retired ASC
      LIMIT 1`,
    legalDongCode
      ? [roadCode, undergroundYn || '0', mainNo, subNo || 0, legalDongCode]
      : [roadCode, undergroundYn || '0', mainNo, subNo || 0],
  );
  return rows[0] || null;
};

/** 건물 부가정보(엘베·층수·세대수) 조회. 없으면 null — 없는 게 정상인 단계다. */
export const findBuildingExt = async (query, schema, buildingMgtNo) => {
  if (!buildingMgtNo) return null;
  const { rows } = await query(
    `SELECT building_mgt_no, ground_floors, basement_floors, elevator_count,
            emergency_elevator_count, household_count, family_count,
            main_purpose, structure, building_name, dong_name, approval_date, sourced_at
       FROM ${schema}.building_ext
      WHERE building_mgt_no = $1
      LIMIT 1`,
    [buildingMgtNo],
  );
  return rows[0] || null;
};

/**
 * 기존 지오코드 캐시에서 추정 좌표를 얻는다(출입구 좌표가 없을 때의 폴백).
 * 여기서 얻은 좌표는 반드시 kind='kakao'|'vworld' 로 표시해 **추정임을 잃지 않는다**.
 */
export const findCachedCoordinate = async (query, schema, { buildingMgtNo, standardRoadAddress }) => {
  const conds = [];
  const params = [];
  if (buildingMgtNo) { params.push(buildingMgtNo); conds.push(`building_mgt_no = $${params.length}`); }
  if (standardRoadAddress) { params.push(standardRoadAddress); conds.push(`standard_road_address = $${params.length}`); }
  if (!conds.length) return null;
  const { rows } = await query(
    `SELECT lat, lng, provider FROM ${schema}.address_geocode_cache
      WHERE (${conds.join(' OR ')}) AND lat IS NOT NULL
      ORDER BY last_used_at DESC LIMIT 1`,
    params,
  );
  const r = rows[0];
  if (!r) return null;
  return { kind: r.provider === 'vworld' ? 'vworld' : 'kakao', lat: Number(r.lat), lng: Number(r.lng) };
};

/**
 * 좌표 후보를 모은다. 출입구가 격리된 좌표면 **후보에 넣지 않는다** —
 * 적재기가 본 테이블에 좌표를 안 넣었으므로 lat 이 NULL 이지만, 상태로도 한 번 더 막는다.
 */
export const collectCoordinates = (entrance, cached) => {
  const list = [];
  if (entrance && entrance.lat !== null && entrance.lat !== undefined && entrance.coord_status === 'ok') {
    list.push({ kind: 'juso_entrance', lat: Number(entrance.lat), lng: Number(entrance.lng) });
  }
  if (cached) list.push(cached);
  return list;
};
