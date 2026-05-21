import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { db } from '../config/firebase.js';
import { getLocalCache, setLocalCache } from './dbCache.js';

const JUSO_API_KEYS = [
  import.meta.env.VITE_JUSO_API_KEY_1,
  import.meta.env.VITE_JUSO_API_KEY_2,
  import.meta.env.VITE_JUSO_API_KEY_3,
].filter(Boolean);
const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY;

const MAX_API_CACHE = 1000;
const apiCache = new Map();
const pendingRequests = new Map();
const coordCache = new Map();

// Kakao 지오코딩 — 도로명주소 → WGS84 좌표 (아파트 포함, 커버리지 높음)
const fetchKakaoCoord = async (roadAddr) => {
  if (!KAKAO_REST_KEY || !roadAddr) return null;
  const cacheKey = `kakao_${roadAddr}`;
  if (coordCache.has(cacheKey)) return coordCache.get(cacheKey);
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(roadAddr)}&size=1`,
      { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } }
    );
    if (!res.ok) { coordCache.set(cacheKey, null); return null; }
    const data = await res.json();
    const d = data.documents?.[0];
    if (!d?.x || !d?.y) { coordCache.set(cacheKey, null); return null; }
    const coord = { lat: parseFloat(d.y), lng: parseFloat(d.x) };
    coordCache.set(cacheKey, coord);
    return coord;
  } catch { return null; }
};

const setApiCache = (key, value) => {
  if (apiCache.size >= MAX_API_CACHE) {
    apiCache.delete(apiCache.keys().next().value);
  }
  apiCache.set(key, value);
};
let currentApiIdx = 0;

let typoDict = {};
let _typoRegex = null;

const _buildTypoRegex = () => {
  const keys = Object.keys(typoDict);
  if (keys.length === 0) { _typoRegex = null; return; }
  const escaped = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  _typoRegex = new RegExp(escaped.join('|'), 'g');
};

// 특수문자 구분자 사전 (Firestore 연동, 자동 확장)
let specialChars = new Set(['**', '/', '☆', '★', '*', '｜', '|', '~', '#', '§', '※']);
let _specialCharRegex = null;

const _buildSpecialCharRegex = () => {
  const sorted = [...specialChars].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  _specialCharRegex = new RegExp(`(${escaped.join('|')})(.*)`);
};
_buildSpecialCharRegex();

export const addSpecialChar = async (ch) => {
  if (!ch || specialChars.has(ch)) return;
  specialChars.add(ch);
  _buildSpecialCharRegex();
  try {
    await setDoc(doc(db, 'special_chars', ch), { addedAt: new Date().toISOString() });
  } catch (e) { console.error("특수문자 저장 오류:", e); }
};

export let typoDictReady = Promise.resolve();

export const loadTypoDict = async () => {
  typoDictReady = (async () => {
    try {
      const [typoSnap, spSnap] = await Promise.all([
        getDocs(collection(db, 'typo_dict')),
        getDocs(collection(db, 'special_chars')),
      ]);
      typoSnap.forEach(d => { typoDict[d.id] = d.data().correction; });
      spSnap.forEach(d => { specialChars.add(d.id); });
      _buildTypoRegex();
      _buildSpecialCharRegex();
    } catch (e) { console.error("사전 로드 오류:", e); }
  })();
  return typoDictReady;
};

export const addTypoRecord = async (wrongAddr, correctAddr) => {
  try {
    const cleanWrong = wrongAddr.trim();
    const cleanCorrect = correctAddr.trim();
    if (!cleanWrong || !cleanCorrect || cleanWrong === cleanCorrect) return;

    // 로컬 메모리에 즉시 반영 후 regex 재빌드
    typoDict[cleanWrong] = cleanCorrect;
    _buildTypoRegex();

    // Firestore 백그라운드 저장
    await setDoc(doc(db, 'typo_dict', cleanWrong), { correction: cleanCorrect });
  } catch (e) {
    console.error("오타 사전 업데이트 실패:", e);
  }
};

export const asyncPool = async (poolLimit, array, iteratorFn) => {
  const ret = []; const executing = [];
  for (let i = 0; i < array.length; i++) {
    // 비동기 논블로킹 엔진: 50건마다 메인 스레드 양보 (화면 프리징 제로)
    if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
    
    const item = array[i];
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    if (poolLimit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) await Promise.race(executing);
    }
  }
  return Promise.all(ret);
};

const fetchJusoAPI = async (keyword, retryCount = 0) => {
  if (retryCount >= JUSO_API_KEYS.length || !JUSO_API_KEYS[currentApiIdx]) return null;
  const url = `https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=${JUSO_API_KEYS[currentApiIdx]}&currentPage=1&countPerPage=1&keyword=${encodeURIComponent(keyword)}&resultType=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP_ERROR");
    const data = await res.json();
    if (data.results?.common?.errorCode === "E0005" || data.results?.common?.errorCode === "E0006") throw new Error("LIMIT");
    if (data.results?.juso?.length > 0) return data.results.juso[0];
  } catch {
    currentApiIdx = (currentApiIdx + 1) % JUSO_API_KEYS.length;
    return fetchJusoAPI(keyword, retryCount + 1);
  }
  return null;
};

const DO_PATTERN = /^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/;

// Kakao Local API — 주민센터·행정복지센터 등 POI 검색 후 전체 문서 반환
// JUSO pendingRequests와 동일하게 같은 쿼리 동시 요청 dedup — 8개 동시처리 시 1번만 호출
const kakaoPending = new Map();
const kakaoCache  = new Map();
const searchKakaoFull = async (query) => {
  if (!KAKAO_REST_KEY || !query) return null;
  const key = query.trim();
  if (kakaoCache.has(key)) return kakaoCache.get(key);
  if (!kakaoPending.has(key)) {
    const p = (async () => {
      try {
        const res = await fetch(
          `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(key)}&size=1`,
          { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.documents?.[0] || null;
      } catch { return null; }
    })().finally(() => kakaoPending.delete(key));
    kakaoPending.set(key, p);
  }
  const result = await kakaoPending.get(key);
  kakaoCache.set(key, result);
  return result;
};

// Kakao 문서 → JUSO 호환 합성 apiResult 생성
// JUSO가 해당 도로명을 인덱싱하지 않는 경우(공공기관 일부)에 Kakao 결과를 직접 사용
const kakaoDocToApiResult = (doc) => {
  if (!doc?.road_address_name) return null;
  return {
    roadAddrPart1: doc.road_address_name,
    roadAddr:      doc.road_address_name,
    bdNm:          doc.place_name || '',
    bdKdcd:        '0',
    _fromKakao:    true,
  };
};


// 캐시+API 조회 공통 헬퍼
const lookupAddr = async (keyword) => {
  if (!keyword || keyword.trim().length < 2) return null;
  const key = keyword.trim();
  let r = apiCache.get(key);
  if (r) return r;
  const cached = await getLocalCache(key);
  if (cached) { setApiCache(key, cached); return cached; }
  if (!pendingRequests.has(key)) {
    const p = fetchJusoAPI(key).finally(() => pendingRequests.delete(key));
    pendingRequests.set(key, p);
  }
  try {
    r = await pendingRequests.get(key);
    setApiCache(key, r);
    if (r) await setLocalCache(key, r);
  } catch { r = null; }
  return r;
};

// 주민센터/행정복지센터/동사무소 → JUSO API 검색어를 지능적으로 생성
// 우선순위: adminDong > 분리형(XX동 주민센터) > 부착형(청량리주민센터) > 시군구
const generateCenterSearchKeyword = (rawText, adminDong, cityLabel) => {
  // 1순위: 행정동 컬럼값이 있으면 가장 신뢰도 높음
  if (adminDong && adminDong.trim()) {
    return `${adminDong.trim()} 주민센터`;
  }

  // 2순위: 분리형 "XX동 주민센터" 패턴
  const sepMatch = rawText.match(/([가-힣\d]+(동|읍|면|리))\s*(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/);
  if (sepMatch) return `${sepMatch[1]} 주민센터`;

  // 3순위: 부착형 "청량리주민센터" → 동이름 추출 후 분리
  const attMatch = rawText.match(/([가-힣\d]{2,})(주민센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/);
  if (attMatch) {
    const rawDong = attMatch[1];
    const dongName = /[동읍면리]$/.test(rawDong) ? rawDong : `${rawDong}동`;
    return `${dongName} 주민센터`;
  }

  // 4순위: 시군구 마지막 레벨(구/시/군) + 주민센터
  if (cityLabel) {
    const parts = cityLabel.trim().split(/\s+/);
    const local = parts[parts.length - 1];
    if (local) return `${local} 주민센터`;
  }

  return '주민센터';
};

export const processAddress = async (inputAddr, inputName = "", adminDong = "", cityLabel = "") => {
  let result = { 정제된이름: inputName, 주소: "", 특이사항: "", 확인필요: false, 확인사유: "", 도: "" };
  
  if (inputName && inputName.length > 5) {
    result.정제된이름 = inputName.substring(0, 5);
    result.특이사항 = `(본명:${inputName}) `;
  }

  if (!inputAddr || inputAddr.trim() === "") {
    result.확인필요 = true; result.확인사유 = "주소 공란";
    return result;
  }

  await typoDictReady;

  let text = inputAddr;
  if (_typoRegex) text = text.replace(_typoRegex, m => typoDict[m]);
  text = text.replace(/부촌시/g, "부천시").replace(/만안그/g, "만안구");
  text = text.normalize('NFC').replace(/\u200B|\u200C|\u200D|\uFEFF/g, '').replace(/\u3000|\xA0|\t|\n|\r/g, ' ').replace(/["']/g, '');

  text = text.replace(/\([^)]*$/, '').trim();
  text = text.replace(/[,\s]+$/, '');
  text = text.replace(/,(?=\S)/g, ', ');
  // A-15: 도로명 번호 뒤 구분자 "." → "," (예: "테헤란로 123. 456호" → "테헤란로 123, 456호")
  text = text.replace(/(\d)\.\s+(?=\S)/g, '$1, ');

  // 주소 전체에 공공기관 키워드 포함 여부 사전 감지
  // → 해당 주소는 읍·면·동 토큰 삭제 절대 금지 (지우면 "주민센터"만 남아 API 오탐)
  const PUBLIC_OFFICE_RE = /(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/;
  const hasCenterKeyword = PUBLIC_OFFICE_RE.test(text);

  let tokens = text.split(/\s+/).filter(Boolean);
  let newTokens = []; let stopRemoval = false;
  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i], nextT = tokens[i + 1] || "";
    if (stopRemoval) { newTokens.push(t); continue; }
    let isRoad = /(로|길|대로)$/.test(t) || (/(로|길|대로)/.test(t) && /^\d/.test(nextT)) || /(로|길|대로)\d+/.test(t);
    let isJibun = /[가-힣\d]+(동|읍|면)$/.test(t) && nextT.match(/^\d+(?:-\d+)?/);
    if (isRoad || isJibun || /[가-힣\d]+(동|읍|면)\d+(?:-\d+)?/.test(t)) {
      stopRemoval = true; newTokens.push(t); continue;
    }
    let isRegion = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/.test(t) ||
                   /^[가-힣\d]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동)$/.test(t) ||
                   /^(부천|수원|성남|안양|안산|용인|고양|창원|포항|청주|천안|전주)$/.test(t);
    // 규칙: 주소 어디에든 공공기관(주민센터·읍사무소·면사무소·동사무소 등)이 있으면
    //       읍·면·동으로 끝나는 지역 토큰은 절대 삭제하지 않음
    const isCenterDong = isRegion && /[동읍면리]$/.test(t) &&
      (hasCenterKeyword || PUBLIC_OFFICE_RE.test(nextT));
    if (!isRegion || isCenterDong) newTokens.push(t);
  }

  text = newTokens.join(' ').replace(/\s*제?\d{1,2}통\s*제?\d{1,2}반\s*/g, ' ');
  let parens = [];
  text = text.replace(/\(.*?\)/g, (m) => { parens.push(m); return `__PAREN${parens.length - 1}__`; });

  let mainAddr, detailAddr;
  const commaIdx = text.indexOf(',');
  if (commaIdx !== -1) {
    const beforeComma = text.substring(0, commaIdx).replace(/\s{2,}/g, ' ').trim();
    const afterComma  = text.substring(commaIdx + 1).replace(/\s{2,}/g, ' ').trim();
    // 쉼표 뒤에 도로명 패턴이 있으면 뒤가 본주소, 앞이 상세(아파트명 등)
    const afterHasRoad = /(로|길|대로)\s*\d/.test(afterComma) || /\d+(로|길|대로)/.test(afterComma) ||
                         /(로|길|대로)$/.test(afterComma.split(' ').slice(-1)[0]);
    if (afterHasRoad) {
      mainAddr   = afterComma;
      detailAddr = beforeComma;
    } else {
      mainAddr   = beforeComma;
      detailAddr = afterComma;
    }
  } else {
    mainAddr   = text.replace(/\s{2,}/g, ' ').trim();
    detailAddr = "";
  }

  mainAddr = mainAddr.replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))(\d+)/g, '$1 $3');
  mainAddr = mainAddr.replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))\s{2,}(\d+)/g, '$1 $3');

  if (!detailAddr && mainAddr.includes(' ')) {
    let parts = mainAddr.split(' ');
    let lastToken = parts[parts.length - 1];
    let lastIsNum = /^\d/.test(lastToken);
    // 공공기관 키워드(주민센터·사무소 등)는 절대로 detailAddr로 분리하지 않음
    // → 분리되면 searchKeyword="신설동"이 되어 엉뚱한 도로주소에 히트 → Fallback 미실행
    let lastIsCenterKw = PUBLIC_OFFICE_RE.test(lastToken);
    if (!lastIsNum && !lastIsCenterKw && !lastToken.includes('__PAREN')) {
      detailAddr = parts.pop();
      mainAddr = parts.join(' ');
    }
  }

  let searchKeyword = mainAddr.replace(/__PAREN\d+__/g, '').trim();

  // 1차 조회: 원문 주소 그대로
  let apiResult = await lookupAddr(searchKeyword);

  // ─── Fallback A: 주민센터 / 행정복지센터 / 읍·면·동사무소 패턴 ───────────────
  // AI 검색어 생성 로직: adminDong > 분리형 > 부착형(청량리주민센터→청량리동 주민센터) > 시군구
  if (!apiResult && PUBLIC_OFFICE_RE.test(text)) {
    const CENTER_KW = ['주민센터', '행정복지센터', '동사무소', '읍사무소', '면사무소'];

    // AI가 생성한 최적 검색어로 1차 시도
    const smartKeyword = generateCenterSearchKeyword(text, adminDong, cityLabel);
    apiResult = await lookupAddr(smartKeyword);

    // 검색어 변형(주민센터↔행정복지센터↔동사무소↔읍사무소↔면사무소) 순차 시도
    if (!apiResult) {
      for (const ckw of CENTER_KW) {
        const variant = smartKeyword.replace(/주민센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터/, ckw);
        if (variant !== smartKeyword) {
          apiResult = await lookupAddr(variant);
          if (apiResult) break;
        }
      }
    }

    // adminDong이 smartKeyword에 반영되지 않은 경우 직접 시도
    if (!apiResult && adminDong && !smartKeyword.startsWith(adminDong.trim())) {
      for (const ckw of CENTER_KW) {
        apiResult = await lookupAddr(`${adminDong.trim()} ${ckw}`);
        if (apiResult) break;
      }
    }

    // ── 수단 3: 시군구 + 동 + 공공기관 (지역이 동명이인일 때 disambiguation) ──
    // 예) "신설동 주민센터" 단독으로 못 찾을 때 → "동대문구 신설동 주민센터"
    if (!apiResult && cityLabel) {
      const cityParts = cityLabel.trim().split(/\s+/);
      const localSuffix = cityParts[cityParts.length - 1]; // "동대문구"
      const dongMatch = smartKeyword.match(/^([가-힣\d]+(동|읍|면|리))/);
      const dongName = (dongMatch && dongMatch[1]) || adminDong?.trim();
      if (localSuffix && dongName) {
        for (const ckw of ['주민센터', '행정복지센터', '동사무소', '읍사무소', '면사무소']) {
          apiResult = await lookupAddr(`${localSuffix} ${dongName} ${ckw}`);
          if (apiResult) break;
        }
      }
    }

    // ── 최후 수단: Kakao Local Search → 도로명 취득 → JUSO 재조회 ──────────────
    // JUSO API는 건물명 인덱싱이 약해 주민센터·행정복지센터를 못 찾는 경우 발생
    // Kakao POI 검색은 실명 등록된 공공기관을 정확히 반환
    // JUSO 재조회마저 실패하면(천호대로 26 등 JUSO 미인덱스) Kakao 결과를 직접 사용
    if (!apiResult) {
      const localPrefix = cityLabel ? cityLabel.trim().split(/\s+/).pop() + ' ' : '';
      const kakaoQuery = adminDong
        ? `${localPrefix}${adminDong.trim()} 주민센터`
        : smartKeyword;

      const kakaoDoc = await searchKakaoFull(kakaoQuery);
      if (kakaoDoc?.road_address_name) {
        apiResult = await lookupAddr(kakaoDoc.road_address_name);
        // JUSO가 해당 도로명을 인덱싱하지 않으면 Kakao 결과 직접 사용
        if (!apiResult) apiResult = kakaoDocToApiResult(kakaoDoc);
      }

      // 변형어(행정복지센터)로도 시도
      if (!apiResult && adminDong) {
        const kakaoQuery2 = `${localPrefix}${adminDong.trim()} 행정복지센터`;
        const kakaoDoc2 = await searchKakaoFull(kakaoQuery2);
        if (kakaoDoc2?.road_address_name) {
          apiResult = await lookupAddr(kakaoDoc2.road_address_name);
          if (!apiResult) apiResult = kakaoDocToApiResult(kakaoDoc2);
        }
      }
    }
  }

  // ─── Fallback B: 건물명만 있는 경우 (도로명·지번 정보 없음) ──────────────────
  // 예) "롯데아파트", "현대빌라 3동 205호" → adminDong + 건물명 으로 검색
  if (!apiResult && adminDong) {
    const hasRoadOrJibun = /(로|길|대로)\s*\d/.test(text) || /[가-힣\d]+(동|읍|면)\s*\d+/.test(text);
    const hasBuildingType = /(아파트|빌라|빌딩|타워|오피스텔|주공|단지|복지관|경로당|요양원|노인|의원|병원|학교|교회|성당|사찰|회관)/.test(text);
    if (!hasRoadOrJibun && hasBuildingType) {
      // 동·호수 등 숫자 정보는 제거하고 건물 이름만 추출
      const bldName = text.replace(/\d+\s*(동|층|호).*$/g, '').replace(/__PAREN\d+__/g, '').trim();
      if (bldName.length >= 2) apiResult = await lookupAddr(`${adminDong} ${bldName}`);
    }
  }

  result.도 = DO_PATTERN.exec(text)?.[1] || '';

  const REGION_SUFFIX = /^[가-힣\d]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/;
  const DONG_SUFFIX   = /^[가-힣\d]+(읍|면|동)$/;
  let dongPart = '';
  let buildingName = '';
  let finalRoadAddr = mainAddr;
  if (apiResult) {
    const rawFinal = apiResult.roadAddrPart1 || mainAddr;
    result.도 = DO_PATTERN.exec(rawFinal)?.[1] || result.도;

    const rParts = rawFinal.split(/\s+/);
    let keepIdx = 0;
    for (let i = 0; i < rParts.length; i++) {
      if (REGION_SUFFIX.test(rParts[i])) keepIdx = i + 1;
      else break;
    }
    let remainParts = rParts.slice(keepIdx);

    if (remainParts.length > 0 && DONG_SUFFIX.test(remainParts[0])) {
      dongPart = remainParts[0];
      remainParts = remainParts.slice(1);
    }
    finalRoadAddr = remainParts.join(' ') || rawFinal;

    buildingName = apiResult.bdNm || '';
    if (!buildingName && parens.length > 0) {
      buildingName = parens.map(p => p.replace(/^\(|\)$/g, '').trim()).filter(Boolean).join(', ');
    }
    detailAddr = detailAddr.replace(/__PAREN\d+__/g, '').replace(/\s+/g, ' ').trim();
  } else {
    if (!/(로|길|대로)/.test(finalRoadAddr)) {
      result.확인필요 = true; result.확인사유 = "도로명 미발견 및 API 변환 실패";
    }
    parens.forEach((p, i) => {
      finalRoadAddr = finalRoadAddr.replace(`__PAREN${i}__`, p);
      detailAddr = detailAddr.replace(`__PAREN${i}__`, p);
    });
  }

  let finalDetail = detailAddr;
  if (!apiResult && parens.length > 0 && !finalRoadAddr.includes('(') && !finalDetail.includes('(')) {
     finalDetail += " " + parens.join(' ');
  }
  
  finalDetail = finalDetail.replace(/([가-힣A-Za-z\d]+)동\s*(?:(지하|[Bb]|제)?\s*(\d+)\s*층)?\s*(?:제)?\s*(\d+)(?:호)?/g, (_m, dong, floorPrefix, floorNum, ho) => {
    let padLength = Math.max(0, 4 - ho.length);
    let pad = " ".repeat(padLength);
    let floorStr = floorNum ? ` ${(floorPrefix || '')}${floorNum}층` : "";
    return `${dong}-${pad}${ho}호${floorStr}`;
  });

  const spMatch = _specialCharRegex ? finalDetail.match(_specialCharRegex) : null;
  if (spMatch) {
    addSpecialChar(spMatch[1]);
    result.특이사항 += (result.특이사항 ? ' ' : '') + spMatch[2].trim();
    finalDetail = finalDetail.replace(spMatch[0], '').trim();
  }
  
  finalDetail = finalDetail.replace(/^[,\s]+|[,\s]+$/g, '');
  
  const parenParts = [dongPart, buildingName].filter(Boolean);
  const parenStr = parenParts.length > 0 ? ` (${parenParts.join(', ')})` : '';
  result.주소 = finalRoadAddr + (finalDetail ? ", " + finalDetail : "") + parenStr;

  if (result.주소.length < 3) {
      result.확인필요 = true;
      result.확인사유 = "변환 후 주소 비정상";
  }

  // 아파트 여부 판별 (bdKdcd === '1') + 카카오 지오코딩으로 좌표 취득 (아파트 포함)
  const isApt = apiResult?.bdKdcd === '1';
  result.isApt = isApt;
  result.lat = null;
  result.lng = null;
  if (result.주소) {
    const roadAddr = apiResult?.roadAddr || result.주소;
    const coord = await fetchKakaoCoord(roadAddr);
    if (coord) { result.lat = coord.lat; result.lng = coord.lng; }
  }

  return result;
};
