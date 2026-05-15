import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { db } from '../config/firebase.js';
import { getLocalCache, setLocalCache } from './dbCache.js';

const JUSO_API_KEYS = [
  import.meta.env.VITE_JUSO_API_KEY_1,
  import.meta.env.VITE_JUSO_API_KEY_2
];
const MAX_API_CACHE = 1000;
const apiCache = new Map();
const pendingRequests = new Map();

const setApiCache = (key, value) => {
  if (apiCache.size >= MAX_API_CACHE) {
    apiCache.delete(apiCache.keys().next().value);
  }
  apiCache.set(key, value);
};
let currentApiIdx = 0;

let typoDict = {};
export let typoDictReady = Promise.resolve();

export const loadTypoDict = async () => {
  typoDictReady = (async () => {
    try {
      const snap = await getDocs(collection(db, 'typo_dict'));
      snap.forEach(d => { typoDict[d.id] = d.data().correction; });
    } catch (e) { console.error("Typo DB Load Error:", e); }
  })();
  return typoDictReady;
};

export const addTypoRecord = async (wrongAddr, correctAddr) => {
  try {
    const cleanWrong = wrongAddr.trim();
    const cleanCorrect = correctAddr.trim();
    if (!cleanWrong || !cleanCorrect || cleanWrong === cleanCorrect) return;
    
    // 로컬 메모리에 즉시 반영
    typoDict[cleanWrong] = cleanCorrect;
    
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

export const processAddress = async (inputAddr, inputName = "", adminDong = "") => {
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
  Object.keys(typoDict).forEach(wrong => {
    if (text.includes(wrong)) text = text.split(wrong).join(typoDict[wrong]);
  });
  text = text.replace(/부촌시/g, "부천시").replace(/만안그/g, "만안구");
  text = text.normalize('NFC').replace(/\u200B|\u200C|\u200D|\uFEFF/g, '').replace(/\u3000|\xA0|\t|\n|\r/g, ' ').replace(/["']/g, '');

  text = text.replace(/\([^)]*$/, '').trim();
  text = text.replace(/[,\s]+$/, '');
  text = text.replace(/,(?=\S)/g, ', ');

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
    if (!isRegion) newTokens.push(t);
  }

  text = newTokens.join(' ').replace(/\s*제?\d{1,2}통\s*제?\d{1,2}반\s*/g, ' ');
  let parens = [];
  text = text.replace(/\(.*?\)/g, (m) => { parens.push(m); return `__PAREN${parens.length - 1}__`; });

  let commaIdx = text.indexOf(',');
  let mainAddr = commaIdx !== -1 ? text.substring(0, commaIdx) : text;
  let detailAddr = commaIdx !== -1 ? text.substring(commaIdx + 1) : "";
  mainAddr = mainAddr.replace(/\s{2,}/g, ' ').trim();

  mainAddr = mainAddr.replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))(\d+)/g, '$1 $3');
  mainAddr = mainAddr.replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))\s{2,}(\d+)/g, '$1 $3');

  if (!detailAddr && mainAddr.includes(' ')) {
    let parts = mainAddr.split(' ');
    let lastIsNum = /^\d/.test(parts[parts.length-1]);
    if(!lastIsNum && !parts[parts.length-1].includes('__PAREN')) {
        detailAddr = parts.pop();
        mainAddr = parts.join(' ');
    }
  }

  let searchKeyword = mainAddr.replace(/__PAREN\d+__/g, '').trim();

  // 1차 조회: 원문 주소 그대로
  let apiResult = await lookupAddr(searchKeyword);

  // Fallback A: 주민센터 / 행정복지센터 / 동사무소 패턴
  // 예) "주민센터", "신정동 주민센터" → adminDong + "주민센터" 로 검색
  if (!apiResult && /(주민\s*센터|행정복지센터|동사무소)/.test(text)) {
    const dongMatch = text.match(/([가-힣]+(동|읍|면))\s*(주민\s*센터|행정복지센터|동사무소)/);
    const searchDong = dongMatch ? dongMatch[1] : adminDong;
    if (searchDong) apiResult = await lookupAddr(`${searchDong} 주민센터`);
  }

  // Fallback B: 건물명만 있는 경우 (도로명·지번 정보 없음)
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
  
  finalDetail = finalDetail.replace(/([가-힣A-Za-z\d]+)동\s*(?:(지하|[Bb]|제)?\s*(\d+)\s*층)?\s*(?:제)?\s*(\d+)(?:호)?/g, (m, dong, floorPrefix, floorNum, ho) => {
    let padLength = Math.max(0, 4 - ho.length);
    let pad = " ".repeat(padLength);
    let floorStr = floorNum ? ` ${(floorPrefix || '')}${floorNum}층` : "";
    return `${dong}-${pad}${ho}호${floorStr}`;
  });

  let spMatch = finalDetail.match(/(\*\*|\/|☆|★|\*)(.*)/);
  if (spMatch) {
    result.특이사항 += spMatch[0];
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

  return result;
};
