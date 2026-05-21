import { collection, getDocs, setDoc, doc } from 'firebase/firestore';
import { db } from '../config/firebase.js';
import { getLocalCache, setLocalCache } from './dbCache.js';

// ══════════════════════════════════════════════════════════════════
//  TTong NEXUS — 주소 정제 엔진  (규칙 A-1 ~ A-15)
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

// Firestore typo_dict 미로드 시에도 반드시 교정해야 하는 긴급 항목만 유지.
// 신규 오타는 Enter 재정제 시 자동 등록되므로 아래 목록은 최소화 유지.
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
// Firestore special_chars 컬렉션과 동기화. 자동 확장 가능.
let specialChars      = new Set(['**', '/', '☆', '★', '*', '｜', '|', '~', '#', '§', '※']);
let _specialCharRegex = null;

const _buildSpecialCharRegex = () => {
  // 길이 내림차순 정렬 → '**'가 '*'보다 먼저 매칭
  const sorted = [...specialChars].sort((a, b) => b.length - a.length);
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

// Kakao POI 결과 → JUSO 호환 구조 변환
// JUSO가 해당 도로명을 인덱싱하지 않는 경우(공공기관 일부) Kakao 결과 직접 사용
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

// 공공기관(주민센터·동사무소 등) 감지 — A-5 동 토큰 삭제 금지, Fallback A 트리거
const CENTER_RE   = /(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/;
const CENTER_KWDS = ['주민센터', '행정복지센터', '동사무소', '읍사무소', '면사무소'];

// A-5 지역 토큰 판별: 시·도·구 등 행정구역 접미어
const REGION_TOKEN_RE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$|^[가-힣\d]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동)$/;
// 접미어 없이 단독 사용되는 광역·기초 시 목록 (지속 확장)
const KNOWN_CITY_RE   = /^(부천|수원|성남|안양|안산|용인|고양|창원|포항|청주|천안|전주|김해|김포|광명|시흥|하남|파주|구리|양주|오산|군포|의왕|과천|이천|여주|평택|화성|의정부|남양주|양평|가평|동두천|연천|포천|안성)$/;

// ── A-7: 주민센터·행정복지센터 검색어 생성 (4단계) ─────────────────
const generateCenterKeyword = (rawText, adminDong, cityLabel) => {
  // 1순위: 행정동 컬럼 → 가장 신뢰도 높음
  if (adminDong?.trim()) return `${adminDong.trim()} 주민센터`;
  // 2순위: 분리형 "XX동 주민센터" 패턴
  const sep = rawText.match(/([가-힣\d]+(동|읍|면|리))\s*(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/);
  if (sep) return `${sep[1]} 주민센터`;
  // 3순위: 부착형 "청량리주민센터" → 동이름 분리
  const att = rawText.match(/([가-힣\d]{2,})(주민센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/);
  if (att) {
    const dongName = /[동읍면리]$/.test(att[1]) ? att[1] : `${att[1]}동`;
    return `${dongName} 주민센터`;
  }
  // 4순위: 시군구 마지막 레벨
  if (cityLabel) {
    const local = cityLabel.trim().split(/\s+/).pop();
    if (local) return `${local} 주민센터`;
  }
  return '주민센터';
};

// ══════════════════════════════════════════════════════════════════
//  processAddress — 메인 정제 함수
// ══════════════════════════════════════════════════════════════════
export const processAddress = async (inputAddr, inputName = '', adminDong = '', cityLabel = '') => {
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

  // ── A-12(1): 주소 공란 플래그 ─────────────────────────────────────
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
    .replace(/[​‌‍﻿]/g, '')  // Zero-width chars 제거
    .replace(/[　\xA0\t\n\r]/g, ' ')          // 전각 공백·NBSP·탭·개행 → 공백
    .replace(/["""''']/g, '')                      // 따옴표 전각·반각 모두 제거
    .replace(/\s{2,}/g, ' ')                       // 연속 공백 → 단일
    .trim();

  // ── A-4: 미닫힌 괄호 제거 ─────────────────────────────────────────
  text = text.replace(/\([^)]*$/, '').trim();

  // ── A-6: 통·반 제거 ───────────────────────────────────────────────
  text = text.replace(/\s*제?\d{1,2}통\s*제?\d{1,2}반\s*/g, ' ').trim();

  // ── A-15: 도로명 번호 뒤 구분자 "." → "," ─────────────────────────
  // 예: "테헤란로 123. 456호" → "테헤란로 123, 456호"
  text = text.replace(/(\d)\.\s+(?=\S)/g, '$1, ');
  text = text.replace(/[,\s]+$/, '').replace(/,(?=\S)/g, ', ');

  // ── A-9: 특수문자 이후 내용 → 특이사항 (전체 텍스트에 먼저 적용) ──
  // 쉼표 뒤 상세주소뿐 아니라 본주소 영역의 특수문자도 포착
  // 특수문자가 텍스트 앞부분(5자 미만 위치)에 있으면 주소 아님 → 건너뜀
  if (_specialCharRegex) {
    const spMatch = text.match(_specialCharRegex);
    if (spMatch && text.indexOf(spMatch[0]) >= 5) {
      const note = spMatch[2].trim();
      if (note) result.특이사항 += (result.특이사항 ? ' ' : '') + note;
      addSpecialChar(spMatch[1]);
      text = text.slice(0, text.indexOf(spMatch[0])).replace(/\s+$/, '');
    }
  }

  // 공공기관 키워드 포함 여부 사전 감지 (A-5 토큰 삭제 방지용)
  const hasCenterKw = CENTER_RE.test(text);

  // ── A-5: 지역 접두어 제거 ─────────────────────────────────────────
  // 도로명·지번 패턴 발견 시 제거 중단
  const tokens    = text.split(/\s+/).filter(Boolean);
  const kept      = [];
  let stopRemove  = false;
  for (let i = 0; i < tokens.length; i++) {
    const t     = tokens[i];
    const nextT = tokens[i + 1] || '';
    if (stopRemove) { kept.push(t); continue; }

    const isRoad    = /(로|길|대로)$/.test(t)
                   || (/(로|길|대로)/.test(t) && /^\d/.test(nextT))
                   || /(로|길|대로)\d+/.test(t);
    const isJibun   = /[가-힣\d]+(동|읍|면)$/.test(t) && /^\d+(-\d+)?/.test(nextT);
    const isDongNum = /[가-힣\d]+(동|읍|면)\d+(-\d+)?/.test(t);
    if (isRoad || isJibun || isDongNum) { stopRemove = true; kept.push(t); continue; }

    const isRegion    = REGION_TOKEN_RE.test(t) || KNOWN_CITY_RE.test(t);
    // 주민센터 주소에서 동·읍·면 토큰 삭제 절대 금지
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
    // 쉼표 뒤에 도로명 패턴이 있으면 뒤가 본주소
    const afterHasRoad = /(로|길|대로)\s*\d/.test(after) || /\d+(로|길|대로)/.test(after);
    mainAddr   = afterHasRoad ? after  : before;
    detailAddr = afterHasRoad ? before : after;
  } else {
    mainAddr = text.replace(/\s+/g, ' ').trim();
  }

  // 도로명–번호 사이 공백 누락 보정 (예: "테헤란로123" → "테헤란로 123")
  mainAddr = mainAddr
    .replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))(\d+)/g, '$1 $3')
    .replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))\s{2,}(\d+)/g, '$1 $3');

  // 마지막 토큰이 문자(숫자·공공기관·괄호 아님)이면 상세주소로 분리
  if (!detailAddr && mainAddr.includes(' ')) {
    const parts = mainAddr.split(' ');
    const last  = parts[parts.length - 1];
    if (!/^\d/.test(last) && !CENTER_RE.test(last) && !last.includes('__P')) {
      detailAddr = parts.pop();
      mainAddr   = parts.join(' ');
    }
  }

  // ── A-13: API 조회 (1차: 원문) ───────────────────────────────────
  const searchKeyword = mainAddr.replace(/__P\d+__/g, '').trim();
  let apiResult = await lookupAddr(searchKeyword);

  // ── Fallback A: 주민센터·행정복지센터·읍·면·동사무소 ───────────────
  if (!apiResult && CENTER_RE.test(text)) {
    const smartKw = generateCenterKeyword(text, adminDong, cityLabel);
    apiResult = await lookupAddr(smartKw);

    // 키워드 변형 순차 시도 (주민센터↔행정복지센터↔동사무소↔읍사무소↔면사무소)
    if (!apiResult) {
      for (const kw of CENTER_KWDS) {
        const v = smartKw.replace(/주민센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터/, kw);
        if (v !== smartKw) { apiResult = await lookupAddr(v); if (apiResult) break; }
      }
    }
    // adminDong이 smartKw에 반영되지 않은 경우 직접 시도
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
    // 최후 수단: Kakao POI → 도로명 취득 → JUSO 재조회
    // JUSO가 해당 도로명을 인덱싱하지 못할 경우 Kakao 결과 직접 사용
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

  // ── Fallback B: 건물명 전용 (도로명·지번 없음) ───────────────────
  // 예: "롯데아파트 3동 205호" → adminDong + 건물명 으로 검색
  if (!apiResult && adminDong) {
    const hasRoadOrJibun = /(로|길|대로)\s*\d/.test(text) || /[가-힣\d]+(동|읍|면)\s*\d+/.test(text);
    const hasBldgType    = /(아파트|빌라|빌딩|타워|오피스텔|주공|단지|복지관|경로당|요양원|노인|의원|병원|학교|교회|성당|사찰|회관)/.test(text);
    if (!hasRoadOrJibun && hasBldgType) {
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

    // 시·도·구 접미어 토큰 제거, 동명 분리
    const rParts = rawFinal.split(/\s+/);
    let keepIdx = 0;
    for (let i = 0; i < rParts.length; i++) {
      if (REGION_SUFFIX.test(rParts[i])) keepIdx = i + 1; else break;
    }
    let remain = rParts.slice(keepIdx);
    if (remain.length > 0 && DONG_SUFFIX.test(remain[0])) dongPart = remain.shift();
    finalRoadAddr = remain.join(' ') || rawFinal;

    buildingName = apiResult.bdNm || '';
    if (!buildingName && parens.length > 0) {
      buildingName = parens.map(p => p.replace(/^\(|\)$/g, '').trim()).filter(Boolean).join(', ');
    }
    detailAddr = detailAddr.replace(/__P\d+__/g, '').replace(/\s+/g, ' ').trim();
  } else {
    // ── A-12(2): 도로명 미발견 + API 실패 플래그 ─────────────────────
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

  // ── A-10: 동호 형식 정규화 ────────────────────────────────────────
  // "101동 203호" → "101-203호"
  // "101동 3층 203호" → "101-203호 3층"  (지하·B·b 포함)
  finalDetail = finalDetail.replace(
    /([가-힣A-Za-z\d]+)동\s*(?:(지하|[Bb])?\s*(\d+)\s*층\s*)?(?:제\s*)?(\d+)\s*호/g,
    (_, dong, flrPfx, flr, ho) => `${dong}-${ho}호${flr ? ` ${flrPfx || ''}${flr}층` : ''}`
  );

  // A-9(2차): 상세주소에 남아있는 특수문자 재처리
  if (_specialCharRegex) {
    const spMatch2 = finalDetail.match(_specialCharRegex);
    if (spMatch2) {
      const note2 = spMatch2[2].trim();
      if (note2) result.특이사항 += (result.특이사항 ? ' ' : '') + note2;
      finalDetail = finalDetail.slice(0, finalDetail.indexOf(spMatch2[0])).trim();
    }
  }

  finalDetail = finalDetail.replace(/^[,\s]+|[,\s]+$/g, '');

  // ── A-11: 최종 주소 형식 조합 ─────────────────────────────────────
  // "도로명주소, 상세주소 (동명, 건물명)"
  const parenParts = [dongPart, buildingName].filter(Boolean);
  const parenStr   = parenParts.length ? ` (${parenParts.join(', ')})` : '';
  result.주소 = finalRoadAddr + (finalDetail ? ', ' + finalDetail : '') + parenStr;

  // ── A-12(3): 변환 후 주소 3자 미만 플래그 ────────────────────────
  if (result.주소.length < 3) {
    result.확인필요 = true;
    result.확인사유 = '변환 후 주소 비정상';
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
