/**
 * 배송 레코드 정규화 — 코어 API 의 **입력 계약**. 순수 함수, 의존 0.
 *
 * ★왜 필요한가 (실측 2026-08-03, 특성화 테스트가 잡아낸 갭 2개)
 *   순번·배차 엔진(`src/engine/routeSequenceEngine.js`)은 **정부양곡 쌀배송 명단의
 *   컬럼명에 그대로 결합**돼 있다:
 *     · `getRecordSearchText`(:125) 는 `record.주소` 를 본다
 *     · `getEffectiveLoad`(:91) 는 `record.포수` · `record['수량(포수)']` 를 본다
 *
 *   그래서 다른 스키마로 부르면 **예외가 아니라 조용히 틀린 답**이 나온다:
 *     · `{address: '...아파트 101동'}` → isApartmentLike **false** (아파트를 못 알아봄)
 *     · `{qty: 4}` → getEffectiveLoad **1** (수량 4가 1로 계산됨)
 *
 *   스캐폴드가 생성하는 배송 프로그램은 영문 키(`address`·`qty`)를 쓴다. 정규화 없이
 *   코어에 연결하면 **생성된 모든 프로그램에서 아파트 묶음이 실패하고 물량배분이
 *   실제 부하와 무관해진다.** 아무도 모른 채로.
 *
 * ★왜 엔진을 안 고치고 여기서 변환하는가
 *   엔진은 운영 중인 nexus 앱이 쓰는 코드다(무시험 1,227줄). 거기를 건드리면 회귀 위험이
 *   생긴다. 경계에서 정규화하면 **엔진 무변경 = 운영 회귀 0** 으로 같은 목적을 이룬다.
 *   나중에 엔진을 서버로 승격할 때 이 모듈이 그대로 입력 계약이 된다.
 *
 * ★관대하게 받고 엄격하게 넘긴다
 *   들어오는 이름은 여러 가지를 받아준다(사업마다 컬럼명이 다르다). 하지만 엔진에는
 *   **엔진이 아는 이름 하나**로만 넘긴다. 이 비대칭이 이 모듈의 존재 이유다.
 */

/** 주소 후보 키 — 앞에 있을수록 우선. */
const ADDRESS_KEYS = [
  '주소', 'address', 'addr', '도로명주소', 'roadAddress', 'road_address',
  'standardRoadAddress', 'standard_road_address',
];

/**
 * 물량 후보 키.
 * ★`포수`가 1순위인 이유: 엔진의 체감물량 규칙(임대+20포↑ 할인, 계단 가중)이
 *   포대 수를 전제로 튜닝돼 있다. 다른 이름으로 들어와도 같은 규칙을 태우려면 여기로 모은다.
 */
const LOAD_KEYS = [
  '포수', '수량(포수)', '수량', 'qty', 'quantity', 'load', 'count', 'amount',
];

const NOTE_KEYS = ['특이사항', 'note', 'memo', 'remark', '비고', 'notes'];
const NAME_KEYS = ['이름', 'name', '성명', '수령인', 'recipient'];
const BUILDING_KEYS = ['건물명', 'buildingName', 'building_name', 'bdNm', '_buildingName'];
const DETAIL_KEYS = ['상세주소', 'addressDetail', 'address_detail', 'detail'];
const PHONE_KEYS = ['전화번호', 'phone', 'tel', '연락처', 'mobile'];
const DRIVER_KEYS = ['기사', 'driver', '담당기사', 'driverName'];
const SEQ_KEYS = ['순번', 'seq', 'sequence', 'order'];

const firstOf = (record, keys) => {
  for (const k of keys) {
    const v = record?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
};

const numOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const coord = (record, keys) => {
  const v = firstOf(record, keys);
  const n = numOrNull(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 임의 스키마 배송 레코드 → **엔진이 이해하는 레코드**.
 *
 * 원본 필드는 지우지 않고 얹는다(호출부가 자기 필드를 계속 쓸 수 있게).
 * 이미 한글 키로 온 레코드는 사실상 그대로 통과한다 — 기존 nexus 명단이 그렇다.
 *
 * @param {object} record
 * @returns {object} 엔진 호환 레코드(주소·특이사항·포수 … + 원본 필드 보존)
 */
export function toEngineRecord(record) {
  if (!record || typeof record !== 'object') return {};

  const address = firstOf(record, ADDRESS_KEYS);
  const load = numOrNull(firstOf(record, LOAD_KEYS));
  const note = firstOf(record, NOTE_KEYS);
  const name = firstOf(record, NAME_KEYS);
  const building = firstOf(record, BUILDING_KEYS);
  const detail = firstOf(record, DETAIL_KEYS);
  const phone = firstOf(record, PHONE_KEYS);
  const driver = firstOf(record, DRIVER_KEYS);
  const seq = numOrNull(firstOf(record, SEQ_KEYS));

  const out = { ...record };
  if (address !== undefined) out['주소'] = String(address);
  // ★물량이 없으면 1로 채우지 않는다 — 엔진이 이미 `|| 1` 폴백을 갖고 있고,
  //   여기서 채우면 "값이 없었다"는 사실이 사라진다.
  if (load !== null) out['포수'] = load;
  if (note !== undefined) out['특이사항'] = String(note);
  if (name !== undefined) out['이름'] = String(name);
  if (building !== undefined) out.buildingName = String(building);
  if (detail !== undefined) out['상세주소'] = String(detail);
  if (phone !== undefined) out['전화번호'] = String(phone);
  if (driver !== undefined) out['기사'] = String(driver);
  if (seq !== null) out['순번'] = seq;

  const lat = coord(record, ['lat', 'latitude', '위도', 'y']);
  const lng = coord(record, ['lng', 'lon', 'longitude', '경도', 'x']);
  if (lat !== null) out.lat = lat;
  if (lng !== null) out.lng = lng;

  return out;
}

/** 목록 정규화. */
export function toEngineRecords(records) {
  return (Array.isArray(records) ? records : []).map(toEngineRecord);
}

/**
 * 물량배분(loadBalance)용 추가 변환.
 *
 * ★배분 엔진은 좌표를 `_lat`·`_lng`(언더스코어 접두)로 읽는다 — nexus 명단이 정제 결과를
 *   그 이름으로 싣기 때문이다. 일반 `lat`/`lng` 로 주면 **좌표가 없다고 판단해 전건이
 *   배분에서 빠진다**(예외가 아니라 조용히). 그래서 경계에서 한 번 더 맞춰준다.
 *   ⚠️원본 `_lat` 이 있으면 그걸 우선한다(정제된 좌표가 더 정확하다).
 */
export function toLoadBalanceRecord(record) {
  const rec = toEngineRecord(record);
  const lat = rec._lat ?? rec.lat;
  const lng = rec._lng ?? rec.lng;
  if (Number.isFinite(Number(lat))) rec._lat = Number(lat);
  if (Number.isFinite(Number(lng))) rec._lng = Number(lng);
  return rec;
}

export function toLoadBalanceRecords(records) {
  return (Array.isArray(records) ? records : []).map(toLoadBalanceRecord);
}

/**
 * 정규화가 실제로 무엇을 채웠는지 보고한다.
 *
 * ★조용한 실패를 막는 장치다. 주소를 못 찾았는데 그냥 넘어가면 순번이 엉망이 되고
 *   원인을 못 찾는다. 호출부(코어 API)가 이 보고를 응답에 실어 "몇 건이 주소 없이 들어왔는지"
 *   를 알려줄 수 있다.
 */
export function describeNormalization(records) {
  const list = Array.isArray(records) ? records : [];
  const report = {
    total: list.length, withAddress: 0, withLoad: 0, withCoord: 0, missingAddress: [],
  };
  list.forEach((raw, i) => {
    const rec = toEngineRecord(raw);
    if (rec['주소']) report.withAddress += 1;
    else if (report.missingAddress.length < 20) report.missingAddress.push(i);
    if (rec['포수'] !== undefined) report.withLoad += 1;
    if (Number.isFinite(rec.lat) && Number.isFinite(rec.lng)) report.withCoord += 1;
  });
  return report;
}

/** 코어 API 응답에 실을 입력 계약 설명(문서 대신 코드가 진실을 말한다). */
export const INPUT_CONTRACT = {
  address: ADDRESS_KEYS,
  load: LOAD_KEYS,
  note: NOTE_KEYS,
  name: NAME_KEYS,
  building: BUILDING_KEYS,
};
