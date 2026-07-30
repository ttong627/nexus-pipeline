// ══════════════════════════════════════════════════════════════════
//  purifyHelpers — 주소 정제 순수 유닛 (클라·서버 공용 SSOT)
//  P7 Phase2 ⓒ-1: processAddress가 쓰는 지역매칭·상수·도로명파서·Kakao 순수변환을
//  addressEngine 인라인에서 여기로 이관. 외부 I/O·firebase·import.meta.env 무의존(순수).
//  IO/SIDE/DICT(lookupAddr·Kakao·좌표·사전)는 호출부(클라/서버)에서 주입한다.
//  구현·정규식은 이 파일이 단일 소스. 클라는 상대경로(../../services/...)로 import.
// ══════════════════════════════════════════════════════════════════
// ── 구분자 ────────────────────────────────────────────────────────
export const ROAD_DETAIL_SEPARATOR = ', ';
export const ADDRESS_EXTRA_SEPARATOR = ' / ';

export const normalizePlaceKey = (value) => String(value || '').replace(/\s+/g, '').trim();

export const appendCheckReason = (result, reason) => {
  if (!reason) return;
  result.확인필요 = true;
  result.확인사유 = result.확인사유 ? `${result.확인사유} / ${reason}` : reason;
};

// ── 지역(시도·시군구) 매칭 ────────────────────────────────────────
// 시도 토큰 판별 — "경기도/서울특별시/세종특별자치시" 또는 축약 도명("경기·서울")
const SIDO_HEAD_RE = /(특별시|광역시|특별자치시|특별자치도|도)$/;
const SIDO_LEAD_RE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/;

// 시도 축약 정규화 — cityLabel은 정규 풀네임("서울특별시"), Kakao/JUSO 결과는 축약("서울")이라
// 그대로 비교하면 오차단된다. 표준 약칭키로 정규화해 "서울특별시"↔"서울", "경기도"↔"경기" 등을 일치시킨다.
// (2026-07-16 주민센터 84건 게이트 오차단 사고 재발방지 · A-30 시군구 비교는 유지)
const SIDO_ALIAS = {
  '서울특별시': '서울', '서울시': '서울',
  '부산광역시': '부산', '대구광역시': '대구', '인천광역시': '인천', '광주광역시': '광주',
  '대전광역시': '대전', '울산광역시': '울산',
  '세종특별자치시': '세종', '세종시': '세종',
  '경기도': '경기', '강원도': '강원', '강원특별자치도': '강원',
  '충청북도': '충북', '충청남도': '충남', '전라북도': '전북', '전북특별자치도': '전북',
  '전라남도': '전남', '경상북도': '경북', '경상남도': '경남',
  '제주특별자치도': '제주', '제주도': '제주',
};
const normalizeSido = (s) => { const k = String(s || '').replace(/\s/g, ''); return SIDO_ALIAS[k] || k; };

// cityLabel/주소에서 시군구 토큰 추출 — 자유 입력(시도 유무·순서 무관) 견고 대응.
// "경기도 시흥시"→"시흥시", "시흥시"→"시흥시", "안양시 동안구"→"안양시 동안구", "강원 춘천"(시 누락)→"춘천"
export const extractSigungu = (label) => {
  const toks = String(label || '').trim().split(/\s+/).filter(Boolean);
  const body = toks.filter(t => !(SIDO_HEAD_RE.test(t) || SIDO_LEAD_RE.test(t)));
  for (let i = 0; i < body.length; i++) {
    if (/시$/.test(body[i]) && body[i + 1] && /구$/.test(body[i + 1])) return `${body[i]} ${body[i + 1]}`;
  }
  const single = body.find(t => /(시|군|구)$/.test(t));
  if (single) return single;
  // 시/군/구 접미어가 없는 단독 토큰(예: "춘천")도 비교 후보로 사용 — includes 양방향 매칭이 흡수
  return body.length === 1 ? body[0] : '';
};
export const extractSido = (label) => {
  const toks = String(label || '').trim().split(/\s+/).filter(Boolean);
  return toks.find(t => SIDO_HEAD_RE.test(t) || SIDO_LEAD_RE.test(t)) || '';
};

// 선택 지자체(cityLabel) vs 매칭 결과(matchedSido/Sigungu) 동일 지역 판정.
// cityLabel은 자유 입력이라 시도가 없을 수 있음 → 시군구 토큰으로 비교, 시도는 둘 다 있을 때만 보조 비교.
export const getMunicipalityMatch = (cityLabel, matchedSido, matchedSigungu) => {
  const selectedSido = extractSido(cityLabel);
  const selectedSigungu = extractSigungu(cityLabel);

  // 시군구를 못 뽑거나(예: "세종특별자치시" 단독·빈값) 매칭 결과 시군구가 없으면 비교 불가 → 통과(안전)
  if (!selectedSigungu || !matchedSigungu) {
    return { comparable: false, ok: true, selectedSido, selectedSigungu };
  }

  const selectedSigunguKey = normalizePlaceKey(selectedSigungu);
  const matchedSigunguKey = normalizePlaceKey(matchedSigungu);
  const sigunguOk = selectedSigunguKey === matchedSigunguKey
    || selectedSigunguKey.includes(matchedSigunguKey)
    || matchedSigunguKey.includes(selectedSigunguKey);

  // 시도는 cityLabel에 명시됐고 매칭 결과에도 있을 때만 비교 — 시군구 단독 입력이면 시군구로만 판정.
  // 축약 정규화(normalizeSido)로 "서울특별시"↔"서울" 등을 일치시켜 게이트 오차단을 막는다.
  const sidoOk = (!selectedSido || !matchedSido)
    ? true
    : normalizeSido(selectedSido) === normalizeSido(matchedSido);

  return { comparable: true, ok: sidoOk && sigunguOk, selectedSido, selectedSigungu };
};

export const getAreaIssue = (cityLabel, inputAdminDong, matchedSido, matchedSigungu) => {
  const match = getMunicipalityMatch(cityLabel, matchedSido, matchedSigungu);

  if (match.comparable && !match.ok) {
    return `타지역-지자체 벗어남: 선택 ${match.selectedSido} ${match.selectedSigungu}, 확인 ${matchedSido} ${matchedSigungu}`;
  }

  return null;
};

const getCandidateSido = (candidate) => candidate?.matchedSido || candidate?.siNm || candidate?.sido || '';
const getCandidateSigungu = (candidate) => candidate?.matchedSigungu || candidate?.sggNm || candidate?.sigungu || '';
export const isCandidateInSelectedMunicipality = (candidate, cityLabel) => {
  if (!candidate) return false;
  const match = getMunicipalityMatch(cityLabel, getCandidateSido(candidate), getCandidateSigungu(candidate));
  return !match.comparable || match.ok;
};

// ── 공통 패턴 상수 ─────────────────────────────────────────────────
export const DO_PATTERN    = /^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/;
export const REGION_SUFFIX = /^[가-힣\d]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/;
// 카카오 등 축약 도명(경기·서울·충남 …) — 접미어가 없어 REGION_SUFFIX로 안 잡힘. 시도 선두 토큰 제거용.
export const REGION_LEAD   = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/;
export const DONG_SUFFIX   = /^[가-힣\d]+(읍|면|동)$/;
// A-31: '법정동' 판정 전용 — 실제 법정동 표기는 동/읍/면 말고도 다음 형태가 있다.
//   · OO동            용두동, 장안동
//   · OO읍 / OO면      홍북읍, 광천면
//   · OO가            매산로2가, 을지로3가   ← 수원·서울 구도심 법정동(과거 누락 원인)
//   · "OO읍 OO리"      홍북읍 신경리          ← 읍/면 지역 법정동+법정리(두 토큰, 과거 누락 원인)
//   · OO리            신경리
// DONG_SUFFIX(동/읍/면)만 쓰면 위 '가'·'읍 리' 형태가 전부 버려져 법정동이 빈칸이 된다.
export const LEGAL_DONG_RE = /^(?:[가-힣\d]+(?:읍|면)\s+)?[가-힣\d]+(?:동|읍|면|가|리)$/;

// 공공기관 감지 — A-5 토큰 삭제 방지 + Fallback A 트리거
export const CENTER_RE   = /(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/;
export const CENTER_KWDS = ['주민센터', '행정복지센터', '동사무소', '읍사무소', '면사무소'];

// A-5: 지역 토큰 판별
export const REGION_TOKEN_RE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$|^[가-힣\d]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동)$/;
// 접미어 없이 단독으로 쓰이는 기초시 목록
export const KNOWN_CITY_RE   = /^(부천|수원|성남|안양|안산|용인|고양|창원|포항|청주|천안|전주|김해|김포|광명|시흥|하남|파주|구리|양주|오산|군포|의왕|과천|이천|여주|평택|화성|의정부|남양주|양평|가평|동두천|연천|포천|안성|광주|나주|순천|목포|여수|익산|군산)$/;

// A-8: 건물 유형어 (Fallback B 트리거)
export const BLDG_TYPE_RE = /(아파트|빌라|빌딩|타워|오피스텔|주공|단지|복지관|경로당|요양원|노인|의원|병원|학교|교회|성당|사찰|회관|고시원|원룸|연립|다세대|모텔|호텔|상가|센터|하우스|파크|캐슬|힐스|래미안|자이|푸르지오|롯데|현대|삼성|sk뷰|이편한세상)/i;

// Firestore typo_dict 미로드 시에도 반드시 교정해야 하는 긴급 항목.
// 신규 오타는 Enter 재정제로 자동 등록 → 아래 목록은 최소화.
export const BASE_TYPO_FIXES = {
  '부촌시': '부천시',
  '만안그': '만안구',
};

// ── Kakao POI 순수 변환 (I/O 아님 — 문서→구조 변환·지역검증만) ────
// Kakao POI → JUSO 호환 구조 변환 (JUSO 미인덱스 케이스)
export const kakaoDocToApiResult = (d) => {
  if (!d?.road_address_name) return null;
  // A-31: POI 지번주소(address_name)에서 법정동 토큰 추출 — 이 경로에서도 괄호가 법정동이 되도록.
  // 예 "서울 동대문구 용두동 39-1" → 용두동  (예전엔 비어 있어서 행정동 폴백이 괄호에 들어갔다)
  const legal = String(d.address_name || '').trim().split(/\s+/).find(t => DONG_SUFFIX.test(t)) || '';
  return {
    roadAddrPart1: d.road_address_name,
    roadAddr:      d.road_address_name,
    bdNm:          d.place_name || '',
    bdKdcd:        '0',
    legalDong:     legal,
    emdNm:         legal,
    _fromKakao:    true,
  };
};

// Kakao POI 문서가 선택 지자체에 속하는지 검사 — kakaoDocToApiResult 직행(지역필터 우회) 방지.
// Kakao address_name/road_address_name 문자열에서 시도·시군구 토큰을 뽑아 getMunicipalityMatch로 대조.
export const kakaoDocInMunicipality = (d, cityLabel) => {
  if (!d) return false;
  const addr = `${d.address_name || ''} ${d.road_address_name || ''}`.trim();
  if (!addr) return false;
  return isCandidateInSelectedMunicipality(
    { matchedSido: extractSido(addr), matchedSigungu: extractSigungu(addr) },
    cityLabel
  );
};

// ── A-7: 주민센터 검색어 생성 — 정의: 지자체(시군구) + 행정동 + 주민센터 ─────
// 주민센터는 반드시 "{시군구} {행정동} 주민센터" 형태로 검색한다(행정동 우선, 시군구 접두어 강제).
// 전국 동명(예: 시흥시 군자동 vs 서울 광진구 군자동) 오매칭 방지.
export const generateCenterKeyword = (rawText, adminDong, cityLabel) => {
  const sgg = extractSigungu(cityLabel);          // 시군구 토큰 (예: 시흥시)
  const pfx = sgg ? `${sgg} ` : '';
  // 1순위: 행정동 컬럼 — 지자체 + 행정동 + 주민센터 (가장 신뢰도 높음)
  if (adminDong?.trim()) return `${pfx}${adminDong.trim()} 주민센터`;
  // 2순위: 분리형 "XX동 주민센터" → 지자체 + 동 + 주민센터
  const sep = rawText.match(/([가-힣\d]+(동|읍|면|리))\s*(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/);
  if (sep) return `${pfx}${sep[1]} 주민센터`;
  // 3순위: 부착형 "청량리주민센터" → 동이름 분리
  const att = rawText.match(/([가-힣\d]{2,})(주민센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/);
  if (att) {
    const dongName = /[동읍면리]$/.test(att[1]) ? att[1] : `${att[1]}동`;
    return `${pfx}${dongName} 주민센터`;
  }
  // 4순위: 텍스트에서 동·읍·면 이름 직접 추출
  const dongInText = rawText.match(/([가-힣\d]{2,}(동|읍|면))/);
  if (dongInText) return `${pfx}${dongInText[1]} 주민센터`;
  // 5순위: 시군구만 (행정동 불명)
  if (sgg) return `${sgg} 주민센터`;
  if (cityLabel) {
    const local = cityLabel.trim().split(/\s+/).pop();
    if (local) return `${local} 주민센터`;
  }
  return '주민센터';
};
