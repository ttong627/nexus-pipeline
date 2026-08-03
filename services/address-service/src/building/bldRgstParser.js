/**
 * 건축물대장 표제부(getBrTitleInfo) 응답 파서 — 순수 함수, 의존 0.
 *
 * ★왜 태그별 전역 findall 을 쓰지 않는가
 *   형 PC 배치(batch_building.py:215-228)는 이렇게 읽는다:
 *     fl = re.findall(r'<grndFlrCnt>(.*?)</grndFlrCnt>', raw)
 *     el = re.findall(r'<rideUseElvtCnt>(.*?)</rideUseElvtCnt>', raw)
 *   응답이 3건인데 그중 하나에 `rideUseElvtCnt` 가 없으면 el 은 2개가 되고,
 *   **fl[2] 와 el[2] 가 서로 다른 건물의 값이 된다.** 배열 길이가 맞을 때만 우연히 맞는 구조다.
 *   그 배치는 max() 로 뭉개기 때문에 이 어긋남이 드러나지 않지만, 건물 단위로 저장하는
 *   우리는 그대로 오염된다. 그래서 **<item> 블록 단위로 끊어** 필드를 뽑는다.
 *   (어제 출입구 파서에서 "좌표는 꼬리에서 집는다"로 필드 밀림을 막은 것과 같은 원리다.)
 *
 * ★공공데이터포털 오류는 200 OK 로 온다
 *   한도초과·인증실패도 HTTP 200 에 XML 본문으로 실려온다. 이걸 "건물 없음"으로 읽고
 *   캐시하면 **영구 오답**이 된다(운영에서 이미 겪은 사고 유형). 그래서 본문을 먼저 판정한다.
 */

/** 응답 판정 결과 */
export const RESULT_OK = 'ok';
export const RESULT_EMPTY = 'empty';        // 정상 응답인데 그 지번에 건축물대장이 없음
export const RESULT_QUOTA = 'quota';        // 한도초과·접근거부 → 키를 바꿔야 한다
export const RESULT_ERROR = 'error';        // 그 외 오류 → 재시도 대상

const tag = (block, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? m[1].trim() : '';
};

const intOrNull = (v) => {
  const s = String(v ?? '').trim();
  if (!s || !/^-?\d+$/.test(s)) return null;
  return Number.parseInt(s, 10);
};

/** 한도·인증 오류 지문. 포털이 문구를 바꿔도 코드로 잡히도록 코드/문구를 함께 본다. */
const QUOTA_MARKS = [
  'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS',
  'SERVICE_ACCESS_DENIED',
  'SERVICE_KEY_IS_NOT_REGISTERED',
  'LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS',
];

/**
 * 응답 본문 판정. 파싱보다 **먼저** 부른다.
 * @returns {{status:string, detail:string}}
 */
export function classifyResponse(raw) {
  const body = String(raw ?? '');
  if (!body.trim()) return { status: RESULT_ERROR, detail: 'empty body' };

  for (const mark of QUOTA_MARKS) {
    if (body.includes(mark)) return { status: RESULT_QUOTA, detail: mark };
  }

  const code = tag(body, 'resultCode') || tag(body, 'returnReasonCode');
  const msg = tag(body, 'resultMsg') || tag(body, 'returnAuthMsg') || tag(body, 'errMsg');
  // 정상 코드: '00' 또는 '0'. 그 외 코드가 실려 있으면 오류다.
  if (code && !/^0+$/.test(code)) {
    return { status: RESULT_ERROR, detail: `${code} ${msg}`.trim() };
  }
  if (!code && msg) return { status: RESULT_ERROR, detail: msg };

  const total = intOrNull(tag(body, 'totalCount'));
  if (total === 0) return { status: RESULT_EMPTY, detail: 'totalCount=0' };
  if (!body.includes('<item>')) {
    return total === null
      ? { status: RESULT_ERROR, detail: 'totalCount 없음' }
      : { status: RESULT_EMPTY, detail: 'item 없음' };
  }
  return { status: RESULT_OK, detail: '' };
}

/**
 * <item> 블록을 잘라 건물별 레코드로 만든다.
 * @returns {object[]} 각 원소가 건물 한 채
 */
export function parseTitleItems(raw) {
  const body = String(raw ?? '');
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const b = m[1];
    items.push({
      mgmBldrgstPk: tag(b, 'mgmBldrgstPk'),
      bldNm: tag(b, 'bldNm'),
      dongNm: tag(b, 'dongNm'),
      // 층수·승강기 — 계단노동의 근거
      grndFlrCnt: intOrNull(tag(b, 'grndFlrCnt')),
      ugrndFlrCnt: intOrNull(tag(b, 'ugrndFlrCnt')),
      rideUseElvtCnt: intOrNull(tag(b, 'rideUseElvtCnt')),
      emgenUseElvtCnt: intOrNull(tag(b, 'emgenUseElvtCnt')),
      // 규모
      hhldCnt: intOrNull(tag(b, 'hhldCnt')),
      fmlyCnt: intOrNull(tag(b, 'fmlyCnt')),
      // 성격
      mainPurpsCdNm: tag(b, 'mainPurpsCdNm'),
      etcPurps: tag(b, 'etcPurps'),
      strctCdNm: tag(b, 'strctCdNm'),
      useAprDay: tag(b, 'useAprDay'),
      // 위치(검증용)
      platPlc: tag(b, 'platPlc'),
      newPlatPlc: tag(b, 'newPlatPlc'),
    });
  }
  return items;
}

/**
 * 건물 한 채 → building_ext 행.
 *
 * 승강기는 **null 과 0 을 구분한다**. 0 = "대장상 승강기 없음"(계단노동 확정),
 * null = "값이 비어 있음"(모름). 이걸 뭉개면 모르는 건물을 "엘베 없음"으로 단정해
 * 난이도를 부풀린다.
 */
export function toBuildingExtRow(item, decoded, buildingMgtNo) {
  return {
    building_mgt_no: buildingMgtNo,
    sigungu_cd: decoded.sigunguCd,
    bjdong_cd: decoded.bjdongCd,
    bun: decoded.bun,
    ji: decoded.ji,
    ground_floors: item.grndFlrCnt,
    basement_floors: item.ugrndFlrCnt,
    elevator_count: item.rideUseElvtCnt,
    emergency_elevator_count: item.emgenUseElvtCnt,
    household_count: item.hhldCnt,
    family_count: item.fmlyCnt,
    main_purpose: item.mainPurpsCdNm || null,
    etc_purpose: item.etcPurps || null,
    structure: item.strctCdNm || null,
    building_name: item.bldNm || null,
    dong_name: item.dongNm || null,
    approval_date: item.useAprDay || null,
    mgm_bldrgst_pk: item.mgmBldrgstPk || null,
  };
}

/**
 * 배송 관점 요약 — 이 건물이 기사에게 어떤 곳인가.
 * 저장값이 아니라 **표현**을 위한 파생값이다(설계서 L3 "건물 정보"를 사람 말로 바꾸는 자리).
 */
export function describeForDelivery(row) {
  const parts = [];
  const fl = row.ground_floors;
  const elev = row.elevator_count;
  if (fl !== null && fl !== undefined) parts.push(`지상 ${fl}층`);
  if (elev === null || elev === undefined) parts.push('엘베 정보없음');
  else if (elev > 0) parts.push(`엘베 ${elev}대`);
  else parts.push('엘베 없음');
  // 엘베 없는 다층 = 계단노동. 기사에게 가장 중요한 한 줄.
  if ((elev === 0) && fl !== null && fl >= 3) parts.push(`★계단 ${fl}층`);
  if (row.household_count) parts.push(`${row.household_count}세대`);
  if (row.main_purpose) parts.push(row.main_purpose);
  return parts.join(' · ');
}
