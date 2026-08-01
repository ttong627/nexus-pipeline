import { collection, getDocs, setDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase.js';
import { getLocalCache, setLocalCache } from './dbCache.js';
import { parseAptDong } from './routeSequenceEngine.js';
import { buildVariantIndex } from '../learn/normalizeVariant.js';
// P7 Phase2 ⓒ-1: 지역매칭 등 순수 헬퍼 — 클라·서버 공용 SSOT(purifyHelpers).
//   ※ 여기 남은 3개는 **이 파일의 IO 계층**(fetchKakaoLegalDong·lookupAddr)이 쓰는 것뿐이다.
//     규격화 본체가 쓰던 나머지 심볼은 전부 purifyCore.js로 함께 옮겨갔다.
import {
  extractSigungu,
  isCandidateInSelectedMunicipality,
  LEGAL_DONG_RE,
} from '../../services/address-service/src/shared/purifyHelpers.js';
// 학습사전 → 정규식 조립 규칙도 서버(dictStore)와 공유한다 — 복제하면 A-2·A-9가 갈라진다.
import {
  DEFAULT_SPECIAL_CHARS,
  buildTypoRegex,
  buildSpecialCharRegex,
} from '../../services/address-service/src/shared/dictRegex.js';
// Kakao 검색어 조립·법정동 채택(A-30·A-31)도 서버 어댑터와 공유 — 복제하면 괄호가 갈라진다.
import {
  kakaoAddressSearchUrl,
  kakaoKeywordSearchUrl,
  buildLegalDongQuery,
  pickLegalDongFromKakao,
} from '../../services/address-service/src/shared/kakaoQueries.js';
// P7 Phase2 ⓒ-1 본체: 정제 코어(A-1~A-34 전체)는 서버와 공유하는 단일 파일에 있다.
// 이 파일은 코어에 **클라 전용 IO·부수효과·학습사전을 주입**하는 어댑터 역할만 한다.
import { createProcessAddress } from '../../services/address-service/src/shared/purifyCore.js';

// ══════════════════════════════════════════════════════════════════
//  TTong NEXUS — 주소 정제 엔진  (규칙 A-1 ~ A-20)
//  규칙 전문: CLAUDE.md §1
// ══════════════════════════════════════════════════════════════════

// ── 환경 변수 ─────────────────────────────────────────────────────
// 클라이언트 직접 juso 호출 비활성화 — 서버(address-service)가 DB + juso fallback 전담.
// VITE_JUSO_API_KEY_* 참조를 제거해 빌드 번들에 키가 박히지 않도록 함 (키 노출 차단).
const JUSO_API_KEYS = [];
const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY;
const ADDRESS_MATCH_API_URL = String(import.meta.env.VITE_ADDRESS_MATCH_API_URL || '').replace(/\/+$/, '');
const ADDRESS_MATCH_TIMEOUT_MS = 3000; // 전국 DB가 1순위 — 대량(easy) burst·콜드스타트에 1200ms는 너무 짧아 JUSO로 새던 문제 해결
const COORD_SERVICE_TIMEOUT_MS = 700;
const KAKAO_TIMEOUT_MS = 2000; // Kakao 좌표/키워드 검색 — 타임아웃 없으면 응답 행(hang) 시 정제 전체가 무한 대기(무한로딩) → abort로 차단
const JUSO_TIMEOUT_MS = 1800;
let addressMatchCircuitOpenUntil = 0;
let addressMatchFailCount = 0;
let coordServiceCircuitOpenUntil = 0;
let coordServiceFailCount = 0;

const fetchWithTimeout = async (url, options = {}, timeoutMs = 1200) => {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
};

const markCircuitFailure = (kind) => {
  const now = Date.now();
  if (kind === 'coord') {
    coordServiceFailCount += 1;
    if (coordServiceFailCount >= 3) coordServiceCircuitOpenUntil = now + 120000;
    return;
  }
  // 전국 DB는 1순위 — 일시적 burst 실패 몇 건으로 2분씩 끊으면 그 사이 전부 JUSO로 새서 정제가 깨진다.
  // 임계값을 올리고(8), 열려도 짧게(20초)만 닫아 DB를 곧바로 재시도한다.
  addressMatchFailCount += 1;
  if (addressMatchFailCount >= 8) addressMatchCircuitOpenUntil = now + 20000;
};

const markCircuitSuccess = (kind) => {
  if (kind === 'coord') {
    coordServiceFailCount = 0;
    coordServiceCircuitOpenUntil = 0;
    return;
  }
  addressMatchFailCount = 0;
  addressMatchCircuitOpenUntil = 0;
};


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
let nameTypoDict = {};       // 이름 오타 사전(Phase 4) — 주소 typo와 분리, 이름에만 적용
let buildingAliasDict = {};  // 건물명 별칭 사전(Phase 4) — 승인된 별칭 → 표준 건물명
let noteNormalizeDict = {};  // 특이사항 정규화 사전(#5-A) — 승인된 표기(wrong) → 표준(correction), 완전일치만
let buildingAliasVariantIndex = {}; // 건물명 표기변이 정규화 인덱스(D) — 공백·기호 무시 완전일치 폴백
let noteNormalizeVariantIndex = {}; // 특이사항 표기변이 정규화 인덱스(D)

// 정규식 조립 규칙은 shared/dictRegex.js SSOT — 서버(dictStore)와 같은 파일을 쓴다.
const _buildTypoRegex = () => { _typoRegex = buildTypoRegex(typoDict); };

const dictDocId = (value) =>
  encodeURIComponent(String(value || '').trim()).replace(/\./g, '%2E').slice(0, 1400);

const saveDictOrSuggestion = async ({ dictName, suggestionName, docId, dictPayload, suggestionPayload }) => {
  try {
    await setDoc(doc(db, dictName, docId), dictPayload, { merge: true });
    return 'applied';
  } catch (e) {
    if (e?.code !== 'permission-denied') throw e;
    await addDoc(collection(db, suggestionName), {
      ...suggestionPayload,
      status: 'pending',
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.email || '',
      createdByUid: auth.currentUser?.uid || '',
      source: 'address-cleaning',
    });
    return 'suggested';
  }
};

// ── A-9: 특수문자 구분자 사전 ─────────────────────────────────────
const specialChars    = new Set(DEFAULT_SPECIAL_CHARS);   // 기본값도 shared SSOT
let _specialCharRegex = null;

const _buildSpecialCharRegex = () => { _specialCharRegex = buildSpecialCharRegex(specialChars); };
_buildSpecialCharRegex();

export const addSpecialChar = async (ch) => {
  if (!ch || specialChars.has(ch)) return;
  specialChars.add(ch);
  _buildSpecialCharRegex();
  try {
    await saveDictOrSuggestion({
      dictName: 'special_chars',
      suggestionName: 'special_char_suggestions',
      docId: dictDocId(ch),
      dictPayload: { char: ch, addedAt: new Date().toISOString() },
      suggestionPayload: { char: ch },
    });
  } catch (e) { console.error('[A-9] 특수문자 저장 오류:', e); }
};

export let typoDictReady = Promise.resolve();

export const loadTypoDict = async () => {
  typoDictReady = (async () => {
    try {
      const [typoSnap, spSnap, nameSnap, aliasSnap, noteNormSnap] = await Promise.all([
        getDocs(collection(db, 'typo_dict')),
        getDocs(collection(db, 'special_chars')),
        getDocs(collection(db, 'name_typo_dict')),      // Phase 4: 승인된 이름 오타
        getDocs(collection(db, 'building_alias')),      // Phase 4: 승인된 건물명 별칭
        getDocs(collection(db, 'note_normalize_dict')), // #5-A: 승인된 특이사항 정규화
      ]);
      typoSnap.forEach(d => {
        const data = d.data();
        const wrong = data.wrong || d.id;
        if (wrong && data.correction) typoDict[wrong] = data.correction;
      });
      spSnap.forEach(d => { specialChars.add(d.data().char || d.id); });
      nameSnap.forEach(d => {
        const x = d.data(); const w = x.wrong || d.id;
        if (w && x.correction) nameTypoDict[w] = x.correction;
      });
      aliasSnap.forEach(d => {
        const x = d.data(); const a = x.alias || d.id;
        if (a && x.canonical) buildingAliasDict[a] = x.canonical;
      });
      noteNormSnap.forEach(d => {
        const x = d.data(); const w = x.wrong || d.id;
        if (w && x.correction) noteNormalizeDict[w] = x.correction;
      });
      // D: 표기변이 정규화 인덱스(건물명·특이사항만, 이름 제외). 충돌 키는 buildVariantIndex가 배제.
      buildingAliasVariantIndex = buildVariantIndex(buildingAliasDict);
      noteNormalizeVariantIndex = buildVariantIndex(noteNormalizeDict);
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
    await saveDictOrSuggestion({
      dictName: 'typo_dict',
      suggestionName: 'typo_suggestions',
      docId: dictDocId(w),
      dictPayload: { wrong: w, correction: c, updatedAt: new Date().toISOString() },
      suggestionPayload: { wrong: w, correction: c },
    });
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
// cityPrefix: 시군구/시 등 지자체 토큰 — 도로명 단독 검색 시 타 지역 오매칭 방지
const fetchAddressServiceCoord = async (roadAddr, buildingMgtNo = '') => {
  if (!ADDRESS_MATCH_API_URL || !roadAddr) return null;
  if (Date.now() < coordServiceCircuitOpenUntil) return null;
  try {
    const res = await fetchWithTimeout(`${ADDRESS_MATCH_API_URL}/v1/address/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standardRoadAddress: roadAddr, buildingMgtNo }),
    }, COORD_SERVICE_TIMEOUT_MS);
    if (!res.ok) {
      markCircuitFailure('coord');
      return null;
    }
    const coord = (await res.json())?.data;
    markCircuitSuccess('coord');
    return coord?.lat && coord?.lng ? { lat: Number(coord.lat), lng: Number(coord.lng) } : null;
  } catch {
    markCircuitFailure('coord');
    return null;
  }
};

const fetchKakaoCoord = async (roadAddr, cityPrefix = '', buildingMgtNo = '') => {
  if (!roadAddr) return null;
  // JUSO roadAddr은 이미 전체 주소(도시명 포함) → 접두어 중복 추가 불필요
  // 도시명이 없는 짧은 주소(result.주소 fallback)에만 cityPrefix 붙임
  const hasCity = /특별시|광역시|특별자치시|도$|시$/.test(roadAddr.slice(0, 10));
  const queryAddr = (!hasCity && cityPrefix) ? `${cityPrefix} ${roadAddr}` : roadAddr;
  const key = `coord_${queryAddr}`;
  if (coordCache.has(key)) return coordCache.get(key);
  const serviceCoord = await fetchAddressServiceCoord(queryAddr, buildingMgtNo);
  if (serviceCoord) {
    coordCache.set(key, serviceCoord);
    return serviceCoord;
  }
  if (!KAKAO_REST_KEY) {
    coordCache.set(key, null);
    return null;
  }
  try {
    const res = await fetchWithTimeout(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(queryAddr)}&size=1`,
      { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } },
      KAKAO_TIMEOUT_MS
    );
    if (!res.ok) { coordCache.set(key, null); return null; }
    const d = (await res.json()).documents?.[0];
    const coord = (d?.x && d?.y) ? { lat: parseFloat(d.y), lng: parseFloat(d.x) } : null;
    coordCache.set(key, coord);
    return coord;
  } catch { coordCache.set(key, null); return null; }
};

// ── VWorld 아파트 동(棟)별 개별좌표 (서버 /v1/building/dong-coords 경유) ──
// 카카오는 아파트 단지를 1좌표로 주지만, VWorld는 동별 개별좌표를 준다(동선 정확도↑).
// 동번호가 있는 아파트만 호출한다 — 없으면 단지 centroid라 geocode와 같아 불필요 호출이 된다.
// 서버·프론트 모두 캐시 → 같은 아파트 반복 시 재호출 없음(대량 정제 성능 방어).
const dongCoordCache = new Map();
const fetchDongCoord = async (roadAddr, dongNo, sigungu = '') => {
  if (!ADDRESS_MATCH_API_URL || !roadAddr || !dongNo) return null;
  if (Date.now() < coordServiceCircuitOpenUntil) return null;
  const key = `dong_${roadAddr}#${dongNo}`;
  if (dongCoordCache.has(key)) return dongCoordCache.get(key);
  try {
    const res = await fetchWithTimeout(`${ADDRESS_MATCH_API_URL}/v1/building/dong-coords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roadAddress: roadAddr, dongNo: String(dongNo), sigungu }),
    }, COORD_SERVICE_TIMEOUT_MS);
    if (!res.ok) { dongCoordCache.set(key, null); return null; }
    const d = (await res.json())?.data;
    // 동(棟) 단위로 매칭된 것만 사용 — centroid/complex 폴백은 geocode와 다를 바 없어 무시
    const coord = (d?.lat && d?.lng && d.matched === 'dong')
      ? { lat: Number(d.lat), lng: Number(d.lng) } : null;
    dongCoordCache.set(key, coord);
    return coord;
  } catch { dongCoordCache.set(key, null); return null; }
};

// ── A-31: Kakao 법정동 조회 (형 지시 2026-07-21 · 절대 되돌리지 말 것) ──
// 괄호 `()` 안은 반드시 법정동이어야 한다. Kakao 주소검색 응답에서
//   region_3depth_name   = 법정동  ← 이것만 쓴다
//   region_3depth_h_name = 행정동  ← 쓰지 않는다
// 전국 주소DB(address-service)가 느리거나 못 찾는 동안에도 법정동을 확실히 채우는 소스.
const legalDongCache   = new Map();
const legalDongPending = new Map();
const fetchKakaoLegalDong = async (addr, cityLabel = '') => {
  if (!KAKAO_REST_KEY || !addr) return null;
  // 검색어 조립·채택 규칙은 shared/kakaoQueries.js SSOT — 서버 어댑터와 같은 파일을 쓴다.
  const query = buildLegalDongQuery(addr, cityLabel);
  if (!query) return null;
  const key   = `${cityLabel.trim()}::${query}`;
  if (legalDongCache.has(key)) return legalDongCache.get(key);
  if (!legalDongPending.has(key)) {
    const p = (async () => {
      try {
        const res = await fetchWithTimeout(
          kakaoAddressSearchUrl(query),
          { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } },
          KAKAO_TIMEOUT_MS
        );
        if (!res.ok) return null;
        return pickLegalDongFromKakao((await res.json()).documents?.[0], cityLabel);
      } catch { return null; }
    })().finally(() => legalDongPending.delete(key));
    legalDongPending.set(key, p);
  }
  const out = await legalDongPending.get(key);
  legalDongCache.set(key, out);
  return out;
};

// ── Kakao: POI 키워드 검색 (주민센터 등) ──────────────────────────
const searchKakaoFull = async (query) => {
  if (!KAKAO_REST_KEY || !query) return null;
  const key = query.trim();
  if (kakaoCache.has(key)) return kakaoCache.get(key);
  if (!kakaoPending.has(key)) {
    const p = (async () => {
      try {
        const res = await fetchWithTimeout(
          kakaoKeywordSearchUrl(key),
          { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } },
          KAKAO_TIMEOUT_MS
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

// ── A-13: JUSO API (3개 키 로테이션) ──────────────────────────────
let currentApiIdx = 0;

const fetchAddressMatchAPI = async (keyword, cityLabel = '') => {
  if (!ADDRESS_MATCH_API_URL || !keyword) return null;
  if (Date.now() < addressMatchCircuitOpenUntil) return null;
  try {
    const res = await fetchWithTimeout(`${ADDRESS_MATCH_API_URL}/v1/address/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: keyword, cityLabel, allowJusoFallback: false }),
    }, ADDRESS_MATCH_TIMEOUT_MS);
    if (!res.ok) {
      markCircuitFailure('address');
      return null;
    }
    markCircuitSuccess('address');
    return (await res.json())?.data || null;
  } catch {
    markCircuitFailure('address');
    return null;
  }
};

const fetchJusoAPI = async (keyword, retryCount = 0) => {
  if (retryCount >= JUSO_API_KEYS.length || !JUSO_API_KEYS[currentApiIdx]) return null;
  const url = `https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=${JUSO_API_KEYS[currentApiIdx]}&currentPage=1&countPerPage=1&keyword=${encodeURIComponent(keyword)}&resultType=json`;
  try {
    const res = await fetchWithTimeout(url, {}, JUSO_TIMEOUT_MS);
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

// 법정동 보유 여부 — 캐시 품질 게이트의 판정 기준.
// 주소매칭 서비스 URL이 비어 있던 '저하 모드' 시절에 저장된 캐시에는 법정동이 없다.
// 그걸 그대로 재사용하면 괄호가 영원히 행정동으로 남으므로, 캐시를 '완전/불완전'으로 나눈다.
const hasLegalDong = (rec) => !!String(rec?.legalDong || rec?.emdNm || '').trim();

// 법정동 보강 재조회를 이미 시도한 키 — 서비스가 법정동을 못 주는 주소를 매 행마다
// 재조회해 API를 두드리는 것을 막는다(1회만 시도).
const legalDongRetried = new Set();

// A-13: 메모리 → IndexedDB → API 순서로 조회
// 형 지시(2026-07-21): "있는 데이터는 활용하되 없는 데이터는 꼭 가져와라" —
// 캐시에 법정동이 없으면 캐시를 반환하지 않고 API를 한 번 더 태운다. 재조회가 실패하면
// 기존 캐시를 그대로 돌려주어 퇴행은 만들지 않는다.
const lookupAddr = async (keyword, cityLabel = '') => {
  if (!keyword?.trim() || keyword.trim().length < 2) return null;
  const key = `${cityLabel.trim()}::${keyword.trim()}`;

  // 불완전(법정동 없음) 캐시는 폴백으로만 들고 간다.
  let stale = null;
  if (apiCache.has(key)) {
    const hit = apiCache.get(key);
    if (hit === null) return null;              // 부정 캐시 보존 — 없는 주소를 매번 재조회하지 않는다
    if (hasLegalDong(hit)) return hit;
    stale = hit;
  }
  if (!stale) {
    const localByCity = await getLocalCache(key);
    if (localByCity && isCandidateInSelectedMunicipality(localByCity, cityLabel)) {
      if (hasLegalDong(localByCity)) { _setApiCache(key, localByCity); return localByCity; }
      stale = localByCity;
    }
  }
  if (!stale) {
    const localGeneric = await getLocalCache(keyword.trim());
    if (localGeneric && isCandidateInSelectedMunicipality(localGeneric, cityLabel)) {
      if (hasLegalDong(localGeneric)) { _setApiCache(key, localGeneric); return localGeneric; }
      stale = localGeneric;
    }
  }
  // 불완전 캐시를 이미 한 번 보강 시도했다면 그대로 사용(API 재난타 방지)
  if (stale && legalDongRetried.has(key)) return stale;
  if (stale) legalDongRetried.add(key);

  const online = await fetchAddressMatchAPI(keyword.trim(), cityLabel);
  if (online && isCandidateInSelectedMunicipality(online, cityLabel)) {
    _setApiCache(key, online);
    await setLocalCache(key, online);
    await setLocalCache(keyword.trim(), online);
    return online;
  }
  if (!pendingRequests.has(key)) {
    const p = fetchJusoAPI(keyword.trim())
      .then(r => isCandidateInSelectedMunicipality(r, cityLabel) ? r : null)
      .finally(() => pendingRequests.delete(key));
    pendingRequests.set(key, p);
  }
  let r = null;
  try { r = await pendingRequests.get(key); } catch { r = null; }
  if (r) {
    _setApiCache(key, r);
    await setLocalCache(key, r);
    await setLocalCache(keyword.trim(), r);
    return r;
  }
  // 온라인 조회 실패 → 법정동은 없어도 기존 캐시는 살려서 반환(주소 자체는 유효)
  if (stale) { _setApiCache(key, stale); return stale; }
  _setApiCache(key, null);
  return null;
};

const _setApiCache = (key, value) => {
  if (apiCache.size >= MAX_API_CACHE) apiCache.delete(apiCache.keys().next().value);
  apiCache.set(key, value);
};

// ══════════════════════════════════════════════════════════════════
//  processAddress — 공용 코어(purifyCore)에 클라 IO·부수효과·학습사전을 주입한 래퍼
//  본체 로직은 services/address-service/src/shared/purifyCore.js (클라·서버 SSOT).
//  ★사전은 로드가 비동기 → 값이 아니라 getter로 넘겨 **호출 시점 값**을 읽게 한다.
// ══════════════════════════════════════════════════════════════════
export const processAddress = createProcessAddress({
  io: { lookupAddr, searchKakaoFull, fetchKakaoLegalDong, fetchKakaoCoord, fetchDongCoord, parseAptDong },
  side: { addSpecialChar },
  dicts: {
    get ready()                     { return typoDictReady; },
    get typoDict()                  { return typoDict; },
    get typoRegex()                 { return _typoRegex; },
    get nameTypoDict()              { return nameTypoDict; },
    get specialCharRegex()          { return _specialCharRegex; },
    get buildingAliasDict()         { return buildingAliasDict; },
    get buildingAliasVariantIndex() { return buildingAliasVariantIndex; },
    get noteNormalizeDict()         { return noteNormalizeDict; },
    get noteNormalizeVariantIndex() { return noteNormalizeVariantIndex; },
  },
});
