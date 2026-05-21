import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { db } from '../config/firebase.js';
import { getLocalCache, setLocalCache } from './dbCache.js';

// ══════════════════════════════════════════════════════════════════
//  TTong NEXUS — 주소 정제 엔진  (규칙 A-1 ~ A-20)
//  규칙 전문: CLAUDE.md §1
// ══════════════════════════════════════════════════════════════════

// ── 환경 변수 ─────────────────────────────────────────────────────
const JUSO_API_KEYS = [
  import.meta.env.VITE_JUSO_API_KEY_1,
  import.meta.env.VITE_JUSO_API_KEY_2,
  import.meta.env.VITE_JUSO_API_KEY_3,
].filter(Boolean);
const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY;

// ── A-13: 캐시 레이어 ─────────────────────────────────────────────
const MAX_API_CACHE   = 1000;
const apiCache        = new Map(); // 메모리 (최대 1000건)
const pendingRequests = new Map(); // JUSO 중복 요청 dedup
const coordCache      = new Map(); // Kakao 좌표
const kakaoPending    = new Map(); // Kakao POI 중복 요청 dedup
const kakaoCache      = new Map(); // Kakao POI

// ── A-2: 오타 사전 ────────────────────────────────────────────────
let typoDict   = {};
let _typoRegex = null;

// Firestore typo_dict 미로드 시에도 반드시 교정해야 하는 긴급 항목.
// 신규 오타는 Enter 재정제로 자동 등록 → 아래 목록은 최소화.
const BASE_TYPO_FIXES = {
  '부촌시': '부천시',
  '만안그': '만안구',
};

const _buildTypoRegex = () => {
  const keys = Object.keys(typoDict);
  if (!keys.length) { _typoRegex = null; return; }
  const esc = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  _typoRegex = new RegExp(esc.join('|'), 'g');
};

// ── A-9: 특수문자 구분자 사전 ─────────────────────────────────────
let specialChars      = new Set(['**', '/', '☆', '★', '*', '｜', '|', '~', '#', '§', '※']);
let _specialCharRegex = null;

const _buildSpecialCharRegex = () => {
  const sorted = [...specialChars].sort((a, b) => b.length - a.length); // 길이 내림차순 → '**'가 '*'보다 우선
  const esc    = sorted.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  _specialCharRegex = new RegExp(`(${esc.join('|')})(.*)`);
};
_buildSpecialCharRegex();

export const addSpecialChar = async (ch) => {
  if (!ch || specialChars.has(ch)) return;
  specialChars.add(ch);
  _buildSpecialCharRegex();
  try {
    await setDoc(doc(db, 'special_chars', ch), { addedAt: new Date().toISOString() });
  } catch (e) { console.error('[A-9] 특수문자 저장 오류:', e); }
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
    } catch (e) { console.error('[A-2] 사전 로드 오류:', e); }
  })();
  return typoDictReady;
};

export const addTypoRecord = async (wrongAddr, correctAddr) => {
  const w = wrongAddr?.trim(), c = correctAddr?.trim();
  if (!w || !c || w === c) return;
  typoDict[w] = c;
  _buildTypoRegex();
  try {
    await setDoc(doc(db, 'typo_dict', w), { correction: c });
  } catch (e) { console.error('[A-2] 오타 저장 오류:', e); }
};

// ── A-14: 비동기 풀 ───────────────────────────────────────────────
export const asyncPool = async (poolLimit, array, iteratorFn) => {
  const ret = [], executing = [];
  for (let i = 0; i < array.length; i++) {
    if (i % 50 === 0) await new Promise(r => setTimeout(r, 0)); // 50건마다 메인스레드 양보
    const p = Promise.resolve().then(() => iteratorFn(array[i]));
    ret.push(p);
    if (poolLimit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) await Promise.race(executing);
    }
  }
  return Promise.all(ret);
};

// ── Kakao: 좌표 취득 (도로명 → WGS84) ────────────────────────────
const fetchKakaoCoord = async (roadAddr) => {
  if (!KAKAO_REST_KEY || !roadAddr) return null;
  const key = `coord_${roadAddr}`;
  if (coordCache.has(key)) return coordCache.get(key);
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(roadAddr)}&size=1`,
      { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } }
    );
    if (!res.ok) { coordCache.set(key, null); return null; }
    const d = (await res.json()).documents?.[0];
    const coord = (d?.x && d?.y) ? { lat: parseFloat(d.y), lng: parseFloat(d.x) } : null;
    coordCache.set(key, coord);
    return coord;
  } catch { coordCache.set(key, null); return null; }
};

// ── Kakao: POI 키워드 검색 (주민센터 등) ──────────────────────────
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
        return (await res.json()).documents?.[0] || null;
      } catch { return null; }
    })().finally(() => kakaoPending.delete(key));
    kakaoPending.set(key, p);
  }
  const result = await kakaoPending.get(key);
  kakaoCache.set(key, result);
  return result;
};

// Kakao POI → JUSO 호환 구조 변환 (JUSO 미인덱스 케이스)
const kakaoDocToApiResult = (d) => {
  if (!d?.road_address_name) return null;
  return {
    roadAddrPart1: d.road_address_name,
    roadAddr:      d.road_address_name,
    bdNm:          d.place_name || '',
    bdKdcd:        '0',
    _fromKakao:    true,
  };
};

// ── A-13: JUSO API (3개 키 로테이션) ──────────────────────────────
let currentApiIdx = 0;

const fetchJusoAPI = async (keyword, retryCount = 0) => {
  if (retryCount >= JUSO_API_KEYS.length || !JUSO_API_KEYS[currentApiIdx]) return null;
  const url = `https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=${JUSO_API_KEYS[currentApiIdx]}&currentPage=1&countPerPage=1&keyword=${encodeURIComponent(keyword)}&resultType=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP_ERROR');
    const data = await res.json();
    const code = data.results?.common?.errorCode;
    if (code === 'E0005' || code === 'E0006') throw new Error('LIMIT');
    if (data.results?.juso?.length > 0) return data.results.juso[0];
  } catch {
    currentApiIdx = (currentApiIdx + 1) % JUSO_API_KEYS.length;
    return fetchJusoAPI(keyword, retryCount + 1);
  }
  return null;
};

// A-13: 메모리 → IndexedDB → API 순서로 조회
const lookupAddr = async (keyword) => {
  if (!keyword?.trim() || keyword.trim().length < 2) return null;
  const key = keyword.trim();
  const mem = apiCache.get(key);
  if (mem) return mem;
  const local = await getLocalCache(key);
  if (local) { _setApiCache(key, local); return local; }
  if (!pendingRequests.has(key)) {
    const p = fetchJusoAPI(key).finally(() => pendingRequests.delete(key));
    pendingRequests.set(key, p);
  }
  let r = null;
  try { r = await pendingRequests.get(key); } catch { r = null; }
  _setApiCache(key, r);
  if (r) await setLocalCache(key, r);
  return r;
};

const _setApiCache = (key, value) => {
  if (apiCache.size >= MAX_API_CACHE) apiCache.delete(apiCache.keys().next().value);
  apiCache.set(key, value);
};

// ── 공통 패턴 상수 ─────────────────────────────────────────────────
const DO_PATTERN    = /^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/;
const REGION_SUFFIX = /^[가-힣\d]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/;
const DONG_SUFFIX   = /^[가-힣\d]+(읍|면|동)$/;

// 공공기관 감지 — A-5 토큰 삭제 방지 + Fallback A 트리거
const CENTER_RE   = /(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/;
const CENTER_KWDS = ['주민센터', '행정복지센터', '동사무소', '읍사무소', '면사무소'];

// A-5: 지역 토큰 판별
const REGION_TOKEN_RE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$|^[가-힣\d]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동)$/;
// 접미어 없이 단독으로 쓰이는 기초시 목록
const KNOWN_CITY_RE   = /^(부천|수원|성남|안양|안산|용인|고양|창원|포항|청주|천안|전주|김해|김포|광명|시흥|하남|파주|구리|양주|오산|군포|의왕|과천|이천|여주|평택|화성|의정부|남양주|양평|가평|동두천|연천|포천|안성|광주|나주|순천|목포|여수|익산|군산)$/;

// A-8: 건물 유형어 (Fallback B 트리거)
const BLDG_TYPE_RE = /(아파트|빌라|빌딩|타워|오피스텔|주공|단지|복지관|경로당|요양원|노인|의원|병원|학교|교회|성당|사찰|회관|고시원|원룸|연립|다세대|모텔|호텔|상가|센터|하우스|파크|캐슬|힐스|래미안|자이|푸르지오|롯데|현대|삼성|sk뷰|이편한세상)/i;

// ── A-7: 주민센터 검색어 생성 (4단계 + 동명이인 보완) ─────────────
const generateCenterKeyword = (rawText, adminDong, cityLabel) => {
  // 1순위: 행정동 컬럼 — 가장 신뢰도 높음
  if (adminDong?.trim()) return `${adminDong.trim()} 주민센터`;
  // 2순위: 분리형 "XX동 주민센터"
  const sep = rawText.match(/([가-힣\d]+(동|읍|면|리))\s*(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/);
  if (sep) return `${sep[1]} 주민센터`;
  // 3순위: 부착형 "청량리주민센터" → 동이름 분리
  const att = rawText.match(/([가-힣\d]{2,})(주민센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/);
  if (att) {
    const dongName = /[동읍면리]$/.test(att[1]) ? att[1] : `${att[1]}동`;
    return `${dongName} 주민센터`;
  }
  // 4순위: 텍스트에서 동·읍·면 이름 직접 추출 (시군구보다 정확)
  const dongInText = rawText.match(/([가-힣\d]{2,}(동|읍|면))/);
  if (dongInText) return `${dongInText[1]} 주민센터`;
  // 5순위: cityLabel 마지막 레벨
  if (cityLabel) {
    const local = cityLabel.trim().split(/\s+/).pop();
    if (local) return `${local} 주민센터`;
  }
  return '주민센터';
};

// ══════════════════════════════════════════════════════════════════
//  processAddress — 메인 정제 함수
// ══════════════════════════════════════════════════════════════════
export const processAddress = async (inputAddr, inputName = '', adminDong = '', cityLabel = '', inputNote = '') => {
  const result = {
    정제된이름: inputName,
    주소: '',
    특이사항: '',
    확인필요: false,
    확인사유: '',
    도: '',
  };

  // ── A-1: 이름 5자 초과 → 5자 자르기 + 특이사항에 본명 추가 ──────
  if (inputName?.length > 5) {
    result.정제된이름 = inputName.substring(0, 5);
    result.특이사항   = `(본명:${inputName}) `;
  }

  // ── A-12 ①: 주소 공란 플래그 ─────────────────────────────────────
  if (!inputAddr?.trim()) {
    result.확인필요 = true;
    result.확인사유 = '주소 공란';
    return result;
  }

  await typoDictReady;

  // ── A-2: 오타 사전 적용 ───────────────────────────────────────────
  let text = inputAddr;
  for (const [w, c] of Object.entries(BASE_TYPO_FIXES)) text = text.replaceAll(w, c);
  if (_typoRegex) text = text.replace(_typoRegex, m => typoDict[m]);

  // ── A-3: 유니코드 정규화 ──────────────────────────────────────────
  text = text
    .normalize('NFC')
    .replace(/[​‌‍﻿­]/g, '')  // Zero-width / Soft-hyphen 제거
    .replace(/[　\xA0\t\n\r\f\v]/g, ' ')           // 전각 공백·NBSP·제어문자 → 공백
    .replace(/["""'''＂＇]/g, '')                        // 따옴표 전각·반각 모두 제거
    .replace(/\s{2,}/g, ' ')                            // 연속 공백 → 단일
    .trim();

  // ── A-4: 미닫힌 괄호 제거 ─────────────────────────────────────────
  text = text.replace(/\([^)]*$/, '').trim();

  // ── A-6: 통·반 제거 ───────────────────────────────────────────────
  text = text.replace(/\s*제?\d{1,2}통\s*제?\d{1,2}반\s*/g, ' ').trim();

  // ── A-15: 도로명 번호 뒤 "." → "," ───────────────────────────────
  // 예: "테헤란로 123. 456호" → "테헤란로 123, 456호"
  text = text.replace(/(\d)\.\s+(?=\S)/g, '$1, ');
  text = text.replace(/[,\s]+$/, '').replace(/,(?=\S)/g, ', ');

  // ── A-16: 번지 표기 제거 ──────────────────────────────────────────
  // 예: "테헤란로 123번지" → "테헤란로 123" / "신남리 123-5번지" → "신남리 123-5"
  text = text.replace(/(\d+)\s*번지/g, '$1');

  // ── A-21: 동사무소/읍사무소/면사무소 → 주민센터 정규화 ───────────────
  text = text.replace(/동사무소|읍사무소|면사무소/g, '주민센터');
  const normalizedInputNote = inputNote.replace(/동사무소|읍사무소|면사무소/g, '주민센터');

  // ── A-9: 특수문자 이후 내용 → 특이사항 (전체 텍스트 1차 적용) ─────
  // 위치 < 5자이면 주소 앞부분 → 건너뜀
  // '/' 가 숫자 사이에 있으면 지번 구분자 → 건너뜀 (A-9 예외)
  if (_specialCharRegex) {
    const spMatch = text.match(_specialCharRegex);
    if (spMatch) {
      const matchPos  = text.indexOf(spMatch[0]);
      const matchChar = spMatch[1];
      const isJibunSlash = matchChar === '/'
        && matchPos > 0
        && /\d$/.test(text[matchPos - 1])
        && /^\d/.test(spMatch[2]);
      if (matchPos >= 5 && !isJibunSlash) {
        const note = spMatch[2].trim();
        if (note) result.특이사항 += (result.특이사항 ? ' ' : '') + note;
        addSpecialChar(matchChar);
        text = text.slice(0, matchPos).replace(/\s+$/, '');
      }
    }
  }

  // 공공기관 키워드 포함 여부 사전 감지 (A-5 동 토큰 삭제 방지)
  const hasCenterKw = CENTER_RE.test(text);

  // ── A-5 + A-20: 지역 접두어 제거 ────────────────────────────────
  // 도로명·지번(동+숫자, 리+숫자) 발견 시 제거 중단
  const tokens   = text.split(/\s+/).filter(Boolean);
  const kept     = [];
  let stopRemove = false;
  for (let i = 0; i < tokens.length; i++) {
    const t     = tokens[i];
    const nextT = tokens[i + 1] || '';
    if (stopRemove) { kept.push(t); continue; }

    const isRoad    = /(로|길|대로)$/.test(t)
                   || (/(로|길|대로)/.test(t) && /^\d/.test(nextT))
                   || /(로|길|대로)\d+/.test(t);
    // A-20: 리(里)를 isJibun에 추가하여 신남리 123 같은 지번주소에서 stopRemove 작동
    const isJibun   = /[가-힣\d]+(동|읍|면|리)$/.test(t) && /^\d+(-\d+)?/.test(nextT);
    const isDongNum = /[가-힣\d]+(동|읍|면|리)\d+(-\d+)?/.test(t);
    if (isRoad || isJibun || isDongNum) { stopRemove = true; kept.push(t); continue; }

    const isRegion     = REGION_TOKEN_RE.test(t) || KNOWN_CITY_RE.test(t);
    // 주민센터 주소의 동·읍·면 토큰 삭제 금지
    const isCenterDong = isRegion && /[동읍면리]$/.test(t) && (hasCenterKw || CENTER_RE.test(nextT));
    if (!isRegion || isCenterDong) kept.push(t);
  }
  text = kept.join(' ');

  // ── 괄호 내부 보호 (쉼표 분리 전) ────────────────────────────────
  const parens = [];
  text = text.replace(/\(.*?\)/g, m => { parens.push(m); return `__P${parens.length - 1}__`; });

  // ── 본주소 / 상세주소 분리 ────────────────────────────────────────
  let mainAddr = '', detailAddr = '';
  const ci = text.indexOf(',');
  if (ci !== -1) {
    const before = text.slice(0, ci).replace(/\s+/g, ' ').trim();
    const after  = text.slice(ci + 1).replace(/\s+/g, ' ').trim();
    const afterHasRoad = /(로|길|대로)\s*\d/.test(after) || /\d+(로|길|대로)/.test(after);
    mainAddr   = afterHasRoad ? after  : before;
    detailAddr = afterHasRoad ? before : after;
  } else {
    mainAddr = text.replace(/\s+/g, ' ').trim();
  }

  // 도로명–번호 사이 공백 누락 보정 ("테헤란로123" → "테헤란로 123")
  // ※ 숫자 바로 뒤에 한글이 오면 번길·가길 계열 → 공백 추가 제외
  mainAddr = mainAddr
    .replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))(\d+)(?![가-힣])/g, '$1 $3')
    .replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))\s{2,}(\d+)(?![가-힣])/g, '$1 $3')
    // 로/대로/길 뒤 공백+숫자+길 계열 → 붙여쓰기
    // "사가정로 2길" → "사가정로2길", "답십리로 32길" → "답십리로32길"
    // "XX로 14번길" → "XX로14번길", "XX로 3가길" → "XX로3가길"
    .replace(/([가-힣]+(대로|로|길))\s+(\d+[가-힣]*길)/g, '$1$3');

  // 마지막 토큰이 상세주소 성격이면 분리
  // 분리 조건: 숫자로 시작하지 않는 문자열 OR 숫자+호(방호수) 패턴
  if (!detailAddr && mainAddr.includes(' ')) {
    const parts    = mainAddr.split(' ');
    const last     = parts[parts.length - 1];
    const isHoSuffix = /^\d+호$/.test(last); // "456호" 형태 → 상세주소
    if ((!(/^\d/.test(last)) || isHoSuffix) && !CENTER_RE.test(last) && !last.includes('__P')) {
      detailAddr = parts.pop();
      mainAddr   = parts.join(' ');
    }
  }

  // ── A-13: API 조회 — 시/구 컨텍스트 포함으로 오지역 매칭 방지 ──────
  // "왕산로 72" 같은 도로명이 전국 여러 곳에 존재할 때 틀린 지역 반환 방지
  // cityLabel에서 가장 하위 시·군·구 토큰을 추출해 검색 앞에 붙임
  // 예: "동대문구 왕산로 72" → 서울 동대문구 결과만 반환
  const baseSearch   = mainAddr.replace(/__P\d+__/g, '').trim();
  const districtTok  = cityLabel
    ? (cityLabel.trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '')
    : '';
  const searchKeyword = districtTok ? `${districtTok} ${baseSearch}` : baseSearch;
  let apiResult = await lookupAddr(searchKeyword);
  if (!apiResult && districtTok) apiResult = await lookupAddr(baseSearch); // districtTok 포함 실패 시 원문 재시도

  // ── Fallback A: 주민센터·행정복지센터·읍·면·동사무소 ───────────────
  if (!apiResult && CENTER_RE.test(text)) {
    const smartKw = generateCenterKeyword(text, adminDong, cityLabel);
    apiResult = await lookupAddr(smartKw);

    if (!apiResult) {
      for (const kw of CENTER_KWDS) {
        const v = smartKw.replace(/주민센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터/, kw);
        if (v !== smartKw) { apiResult = await lookupAddr(v); if (apiResult) break; }
      }
    }
    if (!apiResult && adminDong && !smartKw.startsWith(adminDong.trim())) {
      for (const kw of CENTER_KWDS) {
        apiResult = await lookupAddr(`${adminDong.trim()} ${kw}`);
        if (apiResult) break;
      }
    }
    // 시군구 + 동 + 공공기관 (동명이인 disambiguation)
    if (!apiResult && cityLabel) {
      const localSuffix = cityLabel.trim().split(/\s+/).pop();
      const dongMatch   = smartKw.match(/^([가-힣\d]+(동|읍|면|리))/);
      const dongName    = dongMatch?.[1] || adminDong?.trim();
      if (localSuffix && dongName) {
        for (const kw of CENTER_KWDS) {
          apiResult = await lookupAddr(`${localSuffix} ${dongName} ${kw}`);
          if (apiResult) break;
        }
      }
    }
    // 최후 수단: Kakao POI → 도로명 취득 → JUSO 재조회 (JUSO 미인덱스 대응)
    if (!apiResult) {
      const localPfx = cityLabel ? cityLabel.trim().split(/\s+/).pop() + ' ' : '';
      const queries  = [
        adminDong ? `${localPfx}${adminDong.trim()} 주민센터`    : smartKw,
        adminDong ? `${localPfx}${adminDong.trim()} 행정복지센터` : null,
      ].filter(Boolean);
      for (const q of queries) {
        const kd = await searchKakaoFull(q);
        if (kd?.road_address_name) {
          apiResult = await lookupAddr(kd.road_address_name) || kakaoDocToApiResult(kd);
          if (apiResult) break;
        }
      }
    }
  }

  // ── Fallback B (A-8): 건물명 전용 (도로명·지번 없음) ─────────────
  if (!apiResult && adminDong) {
    const hasRoadOrJibun = /(로|길|대로)\s*\d/.test(text) || /[가-힣\d]+(동|읍|면|리)\s*\d+/.test(text);
    if (!hasRoadOrJibun && BLDG_TYPE_RE.test(text)) {
      const bldName = text.replace(/\d+\s*(동|층|호).*$/g, '').replace(/__P\d+__/g, '').trim();
      if (bldName.length >= 2) apiResult = await lookupAddr(`${adminDong} ${bldName}`);
    }
  }

  // ── 결과 조립 ─────────────────────────────────────────────────────
  result.도 = DO_PATTERN.exec(text)?.[1] || '';

  let dongPart = '', buildingName = '', finalRoadAddr = mainAddr;

  if (apiResult) {
    const rawFinal = apiResult.roadAddrPart1 || mainAddr;
    result.도 = DO_PATTERN.exec(rawFinal)?.[1] || result.도;

    const rParts = rawFinal.split(/\s+/);
    let keepIdx = 0;
    for (let i = 0; i < rParts.length; i++) {
      if (REGION_SUFFIX.test(rParts[i])) keepIdx = i + 1; else break;
    }
    let remain = rParts.slice(keepIdx);
    if (remain.length > 0 && DONG_SUFFIX.test(remain[0])) dongPart = remain.shift();
    finalRoadAddr = remain.join(' ') || rawFinal;

    // ── dongPart 오지역 보정 ──────────────────────────────────────────
    // 도시(시/구) 지역인데 API가 '면'을 반환하면 오매칭으로 간주
    // 예: 서울 동대문구인데 dongPart='왕산면' → adminDong(용두동)으로 대체
    if (dongPart.endsWith('면') && cityLabel) {
      const lastTok = cityLabel.trim().split(/\s+/).pop() || '';
      const isUrban = /(특별시|광역시|특별자치시|시$|구$)/.test(lastTok);
      if (isUrban) {
        dongPart = (adminDong?.trim() && DONG_SUFFIX.test(adminDong.trim()))
          ? adminDong.trim()
          : '';
      }
    }
    // adminDong이 있고 API dongPart가 비어있으면 adminDong 사용
    if (!dongPart && adminDong?.trim() && DONG_SUFFIX.test(adminDong.trim())) {
      dongPart = adminDong.trim();
    }

    buildingName = apiResult.bdNm || '';
    if (!buildingName && parens.length > 0) {
      buildingName = parens.map(p => p.replace(/^\(|\)$/g, '').trim()).filter(Boolean).join(', ');
    }
    detailAddr = detailAddr.replace(/__P\d+__/g, '').replace(/\s+/g, ' ').trim();
  } else {
    // ── A-12 ②: 도로명 미발견 + API 실패 플래그 ─────────────────────
    if (!/(로|길|대로)/.test(finalRoadAddr)) {
      result.확인필요 = true;
      result.확인사유 = '도로명 미발견 및 API 변환 실패';
    }
    parens.forEach((p, i) => {
      finalRoadAddr = finalRoadAddr.replace(`__P${i}__`, p);
      detailAddr    = detailAddr.replace(`__P${i}__`, p);
    });
  }

  let finalDetail = detailAddr;
  if (!apiResult && parens.length > 0 && !finalRoadAddr.includes('(') && !finalDetail.includes('(')) {
    finalDetail += ' ' + parens.join(' ');
  }

  // ── finalDetail 전처리 (A-18 → A-19 → A-17 → A-10 순서) ─────────

  // A-18: 제(第) 접두어 제거 — 제101동 → 101동, 제205호 → 205호, 제3층 → 3층
  finalDetail = finalDetail.replace(/제\s*(\d+)\s*(동|호|층)\b/g, '$1$2');

  // A-19: 동호 붙여쓰기 분리 — 101동205호 → 101동 205호 (A-10에서 대시로 변환)
  finalDetail = finalDetail
    .replace(/([가-힣A-Za-z\d]+동)(\d+호)/g, '$1 $2')
    .replace(/([가-힣A-Za-z\d]+호)(\d+층)/g, '$1 $2');

  // A-17: 층 표기 정규화 — 3F → 3층, B1 → 지하1층
  // 앞에 한글이 있는 경우 제외 (예: '전자B동' 오탐 방지)
  finalDetail = finalDetail
    .replace(/(?<![가-힣])([Bb])(\d+)[Ff]?\b/g, '지하$2층')
    .replace(/(?<![가-힣])(\d+)[Ff]\b/g, '$1층');

  // A-10: 동호 형식 정규화 + 호수 4자리 패딩
  // "101동 203호"   → "101-  203호"  (3자리: 공백 1개)
  // "101동 21호"    → "101-   21호"  (2자리: 공백 2개)
  // "101동 1203호"  → "101-1203호"   (4자리: 패딩 없음)
  // "101동 3층 203호" → "101-  203호 3층"
  finalDetail = finalDetail.replace(
    /([가-힣A-Za-z\d]+)동\s*(?:(지하|[Bb])?\s*(\d+)\s*층\s*)?(?:제\s*)?(\d+)\s*호/g,
    (_, dong, flrPfx, flr, ho) => {
      const pad = ' '.repeat(Math.max(0, 4 - ho.length));
      return `${dong}-${pad}${ho}호${flr ? ` ${flrPfx || ''}${flr}층` : ''}`;
    }
  );

  // A-9 2차: 상세주소에 남아있는 특수문자 재처리
  if (_specialCharRegex) {
    const spMatch2 = finalDetail.match(_specialCharRegex);
    if (spMatch2) {
      const matchPos2   = finalDetail.indexOf(spMatch2[0]);
      const matchChar2  = spMatch2[1];
      const isJibunSlash2 = matchChar2 === '/'
        && matchPos2 > 0
        && /\d$/.test(finalDetail[matchPos2 - 1])
        && /^\d/.test(spMatch2[2]);
      if (!isJibunSlash2) {
        const note2 = spMatch2[2].trim();
        if (note2) result.특이사항 += (result.특이사항 ? ' ' : '') + note2;
        finalDetail = finalDetail.slice(0, matchPos2).trim();
      }
    }
  }

  finalDetail = finalDetail.replace(/^[,\s]+|[,\s]+$/g, '');

  // ── A-11: 최종 주소 형식 조합 ─────────────────────────────────────
  // 동호수 없음: "도로명주소, (동명) 건물명"
  // 동호수 있음: "도로명주소, 동호수 (동명) 건물명"
  // ※ () 안에는 동명만, 건물명은 () 뒤로 출력
  const parenStr   = dongPart ? `(${dongPart})` : '';
  const bldgStr    = buildingName ? ` ${buildingName}` : '';
  result.주소 = finalRoadAddr
    + (finalDetail ? ', ' + finalDetail : '')
    + (parenStr ? (finalDetail ? ' ' : ', ') + parenStr : '')
    + bldgStr;

  // ── A-12 ③: 변환 후 주소 3자 미만 플래그 ────────────────────────
  if (result.주소.length < 3) {
    result.확인필요 = true;
    result.확인사유 = '변환 후 주소 비정상';
  }

  // ── A-22: 특이사항에 주민센터 → 주민센터 주소를 result.주소 앞에 붙이기 ──
  // 단, 주소 자체가 이미 주민센터 주소인 경우(CENTER_RE) 중복 방지
  if (normalizedInputNote && /주민\s*센터/.test(normalizedInputNote) && result.주소 && !CENTER_RE.test(text)) {
    const ckw = generateCenterKeyword(normalizedInputNote, adminDong, cityLabel);
    const cres = await lookupAddr(ckw);
    if (cres) {
      const cRaw = (cres.roadAddrPart1 || cres.roadAddr || '').trim();
      if (cRaw) {
        const cParts   = cRaw.split(/\s+/);
        let cKeepIdx   = 0;
        for (let i = 0; i < cParts.length; i++) {
          if (REGION_SUFFIX.test(cParts[i])) cKeepIdx = i + 1; else break;
        }
        const cRemain  = cParts.slice(cKeepIdx);
        let cDong      = '';
        if (cRemain.length > 0 && DONG_SUFFIX.test(cRemain[0])) cDong = cRemain.shift();
        const cRoadShort  = cRemain.join(' ');
        const cParenStr   = [cDong, cres.bdNm].filter(Boolean).length
          ? ` (${[cDong, cres.bdNm].filter(Boolean).join(', ')})` : '';
        const centerAddr  = cRoadShort + cParenStr;
        // 이미 앞에 같은 주민센터 주소가 있으면 중복 추가 금지
        if (centerAddr && cRoadShort.length >= 5 && !result.주소.startsWith(cRoadShort.slice(0, 8))) {
          result.주소 = `${centerAddr}, ${result.주소}`;
        }
      }
    }
  }

  // ── 좌표 취득 (Kakao Geocoding) ──────────────────────────────────
  result.isApt = apiResult?.bdKdcd === '1';
  result.lat   = null;
  result.lng   = null;
  if (result.주소) {
    const coord = await fetchKakaoCoord(apiResult?.roadAddr || result.주소);
    if (coord) { result.lat = coord.lat; result.lng = coord.lng; }
  }

  return result;
};
