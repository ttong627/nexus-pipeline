// ══════════════════════════════════════════════════════════════════
//  학습 주소 저장소 (형 지시 2026-08-11)
//  "명단에 있는데 DB에 없는 경우는 API로 검색해서 DB업데이트까지 해주던지."
//
//  주소DB는 월 전체분이라 그달 이후 신축이 없다. 기존에는 JUSO 폴백 결과를
//  address_fallback_cache(질의문자열 키)에만 넣어 두 가지 문제가 있었다:
//    ① 표기가 조금만 달라지면 캐시가 빗나가 외부 API를 또 두드린다
//    ② DB 자체는 영원히 신축을 모른다 → 다른 경로(퍼지)가 옆 건물을 집는다
//  → 확인된 주소를 **도로명+본번-부번 키**로 정규화해 address_learned 에 쌓고,
//    정확매칭 직후 이 표를 본다(외부 API보다 앞).
//
//  ★변환 로직은 DB를 쓰지 않는 순수 함수 — 회귀 scripts/learned-store.test.mjs
//  ★테이블은 버전독립(sql/learned.sql). schema.sql 에 두면 월 재적재 때 증발한다.
// ══════════════════════════════════════════════════════════════════
import { cleanText, normalizeSearchKey } from './normalize.js';

const APARTMENT_RE = /(아파트|주공|임대|LH|SH)/i;
const REVIEW_BELOW = 0.6;   // 이 아래로 학습된 건은 담당자 확인 대상

const intOrNull = (v) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

/** 도로명주소 문자열 → 학습 키(표기 흔들림 흡수) */
export const learnedKey = (roadAddress) => normalizeSearchKey(cleanText(roadAddress));

/**
 * JUSO addrLinkApi 응답 1건 → address_learned 행.
 * 도로명주소나 본번이 없으면 **학습하지 않는다**(null) — 건물이 특정되지 않은 값을
 * DB에 넣으면 다음 조회가 그 쓰레기를 정답으로 믿는다.
 */
export const learnedRowFromJuso = (record, { source = 'juso', confidence = 0.72 } = {}) => {
  if (!record) return null;
  const roadAddress = cleanText(record.roadAddr || record.roadAddrPart1 || record.standardRoadAddress || '');
  if (!roadAddress) return null;
  const mainNo = intOrNull(record.buldMnnm ?? record.buildingMainNo);
  if (mainNo == null || mainNo <= 0) return null;

  const buildingName = cleanText(record.bdNm || record.buildingName || '');
  return {
    road_key: learnedKey(roadAddress),
    road_address: roadAddress,
    road_name: cleanText(record.rn || record.roadName || ''),
    building_main_no: mainNo,
    building_sub_no: intOrNull(record.buldSlno ?? record.buildingSubNo) || 0,
    underground_yn: String(record.udrtYn ?? record.undergroundYn ?? '0') === '1' ? '1' : '0',
    road_code: cleanText(record.rnMgtSn || record.roadCode || ''),
    sido: cleanText(record.siNm || record.matchedSido || ''),
    sigungu: cleanText(record.sggNm || record.matchedSigungu || ''),
    legal_emd: cleanText(record.emdNm || record.legalDong || ''),
    legal_dong_code: cleanText(record.admCd || record.legalDongCode || ''),
    building_name: buildingName,
    building_mgt_no: cleanText(record.bdMgtSn || record.buildingMgtNo || ''),
    address_mgt_no: cleanText(record.admCd && record.bdMgtSn ? '' : (record._addressMgtNo || '')),
    zip_no: cleanText(record.zipNo || ''),
    is_apartment: String(record.bdKdcd || '') === '1' || APARTMENT_RE.test(buildingName),
    source,
    confidence,
  };
};

/**
 * address_learned 행 → 매칭 결과. 기존 소비자(purifyCore)가 읽는 **JUSO 호환 필드명**을
 * 그대로 낸다 — 새 형태를 만들면 소비부를 전부 고쳐야 하고 한쪽만 고치면 조용히 갈라진다.
 */
export const learnedRowToResult = (row) => {
  if (!row || !row.road_address) return null;
  const mainNo = intOrNull(row.building_main_no);
  const subNo = intOrNull(row.building_sub_no) || 0;
  const buildingName = row.building_name || '';
  const confidence = Number(row.confidence ?? 0.72);
  return {
    standardRoadAddress: row.road_address,
    roadAddr: row.road_address,
    roadAddrPart1: row.road_address,
    roadName: row.road_name || '',
    rn: row.road_name || '',
    buildingMainNo: mainNo,
    buildingSubNo: subNo,
    buldMnnm: mainNo == null ? '' : `${mainNo}`,
    buldSlno: `${subNo}`,
    buildingName,
    bdNm: buildingName,
    bdKdcd: row.is_apartment ? '1' : '0',
    matchedSido: row.sido || '',
    matchedSigungu: row.sigungu || '',
    legalDong: row.legal_emd || '',
    emdNm: row.legal_emd || '',
    legalDongCode: row.legal_dong_code || '',
    roadCode: row.road_code || '',
    undergroundYn: row.underground_yn || '0',
    zipNo: row.zip_no || '',
    bdMgtSn: row.building_mgt_no || '',
    buildingMgtNo: row.building_mgt_no || '',
    addressMgtNo: row.address_mgt_no || '',
    _addressMgtNo: row.address_mgt_no || '',
    isApartment: Boolean(row.is_apartment),
    _matchSource: `address_learned:${row.source || 'juso'}`,
    _matchConfidence: confidence,
    // 낮은 신뢰도로 배운 건은 조용히 통과시키지 않는다(A-12).
    _needsReview: confidence < REVIEW_BELOW,
    _routeHints: {
      apartmentGroupKey: normalizeSearchKey(`${row.road_address}|${mainNo}|${subNo}`),
      buildingGroupKey: row.building_mgt_no || '',
      roadSideKey: `${row.road_name || ''}#${mainNo == null ? '' : (mainNo % 2 === 0 ? 'even' : 'odd')}`,
    },
  };
};
