import { collection, getDocs, setDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase.js';
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
const ADDRESS_MATCH_API_URL = String(import.meta.env.VITE_ADDRESS_MATCH_API_URL || '').replace(/\/+$/, '');
const ADDRESS_MATCH_TIMEOUT_MS = 3000; // 전국 DB가 1순위 — 대량(easy) burst·콜드스타트에 1200ms는 너무 짧아 JUSO로 새던 문제 해결
const COORD_SERVICE_TIMEOUT_MS = 700;
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

const normalizePlaceKey = (value) => String(value || '').replace(/\s+/g, '').trim();
const ROAD_DETAIL_SEPARATOR = ', ';
const ADDRESS_EXTRA_SEPARATOR = ' / ';

const HANGUL = '\\uAC00-\\uD7A3';
const BRANCH_SUFFIX =
  '(?:\\uBC88\\uAE38|\\uBC88\\uAC00\\uAE38|\\uAC00\\uAE38|\\uB098\\uAE38|\\uB2E4\\uAE38|\\uB77C\\uAE38|\\uB9C8\\uAE38|\\uBC14\\uAE38|\\uC0AC\\uAE38|\\uC544\\uAE38|\\uC790\\uAE38|\\uCC28\\uAE38|\\uCE74\\uAE38|\\uD0C0\\uAE38|\\uD30C\\uAE38|\\uD558\\uAE38|\\uAE38)';
const ROAD_NAME_SOURCE =
  `(?:[${HANGUL}A-Za-z0-9]+(?:\\uB300\\uB85C|\\uB85C)\\s*\\d+[${HANGUL}0-9]*${BRANCH_SUFFIX}|[${HANGUL}A-Za-z0-9]+(?:\\uB300\\uB85C|\\uB85C|\\uAE38))`;
const ROAD_ADDRESS_RE = new RegExp(`(^|[\\s,/\\(])(${ROAD_NAME_SOURCE})\\s*(\\uC9C0\\uD558\\s*)?(\\d{1,5})(?:\\s*-\\s*(\\d{1,5}))?`, 'u');
// A-23: 베이스 도로명이 로·대로·길로 끝나는 경우 모두 처리 — "홍양길 43번길" → "홍양길43번길"
// (길=길 추가. 누락 시 파서가 "홍양길"에서 끊겨 "번길 40-25"가 괄호로 오분류됨)
const ROAD_BRANCH_SPACE_RE = new RegExp(`([${HANGUL}A-Za-z]+(?:\\uB300\\uB85C|\\uB85C|\\uAE38))\\s+(\\d+[${HANGUL}0-9]*${BRANCH_SUFFIX})`, 'gu');
const ROAD_NUMBER_SPACE_RE = new RegExp(`([${HANGUL}A-Za-z0-9]+(?:\\uB300\\uB85C|\\uB85C|\\uAE38))\\s{2,}(\\d{1,5})(?![${HANGUL}A-Za-z0-9])`, 'gu');
const DETAIL_START_RE = new RegExp(`^(?:\\uC9C0\\uD558|\\uC9C0\\uCE35|\\uC625\\uD0D1|\\d+\\s*(?:\\uB3D9|\\uCE35|\\uD638)|[A-Za-z]?\\d+\\s*\\uD638)`, 'u');
const DETAIL_MARKER_RE = new RegExp(`__P\\d+__|\\uC9C0\\uD558|\\uC9C0\\uCE35|\\uC625\\uD0D1|\\d+\\s*(?:\\uB3D9|\\uCE35|\\uD638)|[A-Za-z]?\\d+\\s*\\uD638`, 'u');

const normalizeRoadAddressSpacing = (value) =>
  String(value || '')
    .replace(ROAD_BRANCH_SPACE_RE, '$1$2')
    .replace(ROAD_NUMBER_SPACE_RE, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

const stripAddressDelimiters = (value) => String(value || '').replace(/^[\s,;:：；ㆍ·/\\|]+|[\s,;:：；ㆍ·/\\|]+$/g, '').trim();
const stripLeadingAddressJunk = (value) => String(value || '').replace(/^[\s,;:：；ㆍ·/\\|]+/g, '').trimStart();
const normalizeAddressDetail = (value) =>
  stripAddressDelimiters(String(value || '')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' '));

const appendUniqueNote = (base, note) => {
  const cleanNote = String(note || '').trim();
  if (!cleanNote) return base || '';
  const cleanBase = String(base || '').trim();
  if (cleanBase.includes(cleanNote)) return cleanBase;
  return [cleanBase, cleanNote].filter(Boolean).join(' ').trim();
};

const splitInlineBuildingTail = (tail) => {
  const cleanTail = stripAddressDelimiters(tail);
  if (!cleanTail) return { inlineBuildingName: '', detail: '' };
  if (DETAIL_START_RE.test(cleanTail) || cleanTail.startsWith('__P')) {
    return { inlineBuildingName: '', detail: normalizeAddressDetail(cleanTail) };
  }

  const marker = cleanTail.search(DETAIL_MARKER_RE);
  const comma = cleanTail.indexOf(',');
  const slash = cleanTail.indexOf('/');
  const stops = [marker, comma, slash].filter(v => v >= 0);
  const cut = stops.length ? Math.min(...stops) : -1;
  const inlineBuildingName = stripAddressDelimiters(cut >= 0 ? cleanTail.slice(0, cut) : cleanTail);
  const detail = normalizeAddressDetail(cut >= 0 ? cleanTail.slice(cut) : '');
  return { inlineBuildingName, detail };
};

const parseOfficialRoadAddressText = (value) => {
  const normalized = normalizeRoadAddressSpacing(stripLeadingAddressJunk(value));
  const match = ROAD_ADDRESS_RE.exec(normalized);
  if (!match) return null;

  const leading = match[1] || '';
  const start = match.index + leading.length;
  const end = match.index + match[0].length;
  const roadName = normalizeRoadAddressSpacing(match[2] || '').replace(/\s+/g, '');
  const underground = match[3] ? '\uC9C0\uD558 ' : '';
  const mainNo = match[4] || '';
  let subNoValue = match[5] || '';
  let compactRoomDetail = '';
  let inferenceReason = '';
  let tail = normalized.slice(end);
  if (subNoValue.length >= 3 && /^\s*\uD638(?:\s|$|[),/])/.test(tail)) {
    compactRoomDetail = `${subNoValue.slice(1)}\uD638`;
    inferenceReason = `주소 추정 변환(부번+호수 압축, 40층 이상 호수 가능성 낮음): ${roadName} ${mainNo}-${subNoValue}호 → ${roadName} ${mainNo}-${subNoValue.slice(0, 1)}, ${compactRoomDetail}`;
    subNoValue = subNoValue.slice(0, 1);
    tail = tail.replace(/^\s*\uD638/, ' ');
  }
  const subNo = subNoValue ? `-${subNoValue}` : '';
  const searchAddress = `${roadName} ${underground}${mainNo}${subNo}`.trim();
  const prefix = stripAddressDelimiters(normalized.slice(0, start));
  const splitTail = splitInlineBuildingTail(tail);
  const detail = normalizeAddressDetail([prefix, compactRoomDetail, splitTail.detail].filter(Boolean).join(' '));

  return {
    searchAddress,
    detail,
    inlineBuildingName: splitTail.inlineBuildingName,
    roadName,
    mainNo,
    subNo: subNoValue,
    inferenceReason,
  };
};

const appendCheckReason = (result, reason) => {
  if (!reason) return;
  result.확인필요 = true;
  result.확인사유 = result.확인사유 ? `${result.확인사유} / ${reason}` : reason;
};

// ── A-13: 캐시 레이어 ─────────────────────────────────────────────
const getMunicipalityMatch = (cityLabel, matchedSido, matchedSigungu) => {
  const cityParts = String(cityLabel || '').trim().split(/\s+/).filter(Boolean);
  const selectedSido = cityParts[0] || '';
  const selectedSigungu = cityParts.slice(1).join(' ');
  if (!selectedSido || !selectedSigungu || !matchedSido || !matchedSigungu) {
    return { comparable: false, ok: true, selectedSido, selectedSigungu };
  }

  const selectedSidoKey = normalizePlaceKey(selectedSido);
  const selectedSigunguKey = normalizePlaceKey(selectedSigungu);
  const matchedSidoKey = normalizePlaceKey(matchedSido);
  const matchedSigunguKey = normalizePlaceKey(matchedSigungu);
  const sidoOk = selectedSidoKey === matchedSidoKey;
  const sigunguOk = selectedSigunguKey === matchedSigunguKey
    || selectedSigunguKey.includes(matchedSigunguKey)
    || matchedSigunguKey.includes(selectedSigunguKey);

  return { comparable: true, ok: sidoOk && sigunguOk, selectedSido, selectedSigungu };
};

const getAreaIssue = (cityLabel, inputAdminDong, matchedSido, matchedSigungu) => {
  const match = getMunicipalityMatch(cityLabel, matchedSido, matchedSigungu);

  if (match.comparable && !match.ok) {
    return `타지역-지자체 벗어남: 선택 ${match.selectedSido} ${match.selectedSigungu}, 확인 ${matchedSido} ${matchedSigungu}`;
  }

  return null;
};

const getCandidateSido = (candidate) => candidate?.matchedSido || candidate?.siNm || candidate?.sido || '';
const getCandidateSigungu = (candidate) => candidate?.matchedSigungu || candidate?.sggNm || candidate?.sigungu || '';
const isCandidateInSelectedMunicipality = (candidate, cityLabel) => {
  if (!candidate) return false;
  const match = getMunicipalityMatch(cityLabel, getCandidateSido(candidate), getCandidateSigungu(candidate));
  return !match.comparable || match.ok;
};

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
let specialChars      = new Set(['**', '/', '☆', '★', '*', '｜', '|', '~', '#', '§', '※', '=>', '->']);
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
      const [typoSnap, spSnap] = await Promise.all([
        getDocs(collection(db, 'typo_dict')),
        getDocs(collection(db, 'special_chars')),
      ]);
      typoSnap.forEach(d => {
        const data = d.data();
        const wrong = data.wrong || d.id;
        if (wrong && data.correction) typoDict[wrong] = data.correction;
      });
      spSnap.forEach(d => { specialChars.add(d.data().char || d.id); });
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
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(queryAddr)}&size=1`,
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

// A-13: 메모리 → IndexedDB → API 순서로 조회
const lookupAddr = async (keyword, cityLabel = '') => {
  if (!keyword?.trim() || keyword.trim().length < 2) return null;
  const key = `${cityLabel.trim()}::${keyword.trim()}`;
  if (apiCache.has(key)) return apiCache.get(key);
  const localByCity = await getLocalCache(key);
  if (localByCity && isCandidateInSelectedMunicipality(localByCity, cityLabel)) {
    _setApiCache(key, localByCity);
    return localByCity;
  }
  const localGeneric = await getLocalCache(keyword.trim());
  if (localGeneric && isCandidateInSelectedMunicipality(localGeneric, cityLabel)) {
    _setApiCache(key, localGeneric);
    return localGeneric;
  }
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
  _setApiCache(key, r);
  if (r) {
    await setLocalCache(key, r);
    await setLocalCache(keyword.trim(), r);
  }
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
export const processAddress = async (inputAddr, inputName = '', adminDong = '', cityLabel = '', inputNote = '', options = {}) => {
  const includeCoords = options.includeCoords !== false;
  const result = {
    정제된이름: inputName,
    주소: '',
    특이사항: '',
    확인필요: false,
    확인사유: '',
    도: '',
    주소추정: false,
    추정사유: '',
    원주소: inputAddr || '',
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
  const correctionLogs = [];
  const addCorrectionLog = (from, to, reason = '오타 보정') => {
    if (!from || !to || from === to) return;
    const log = `${reason}: ${from} → ${to}`;
    if (!correctionLogs.includes(log)) correctionLogs.push(log);
  };
  for (const [w, c] of Object.entries(BASE_TYPO_FIXES)) {
    if (w && c && text.includes(w)) {
      text = text.replaceAll(w, c);
      addCorrectionLog(w, c);
    }
  }
  if (_typoRegex) {
    text = text.replace(_typoRegex, m => {
      const fixed = typoDict[m] || m;
      addCorrectionLog(m, fixed, '학습 오타 보정');
      return fixed;
    });
  }
  const beforeCommonRoadTypo = text;
  text = text.replace(/\uC7AC\uAE30\uB85C(?=\d*\uAE38|\s*\d)/g, '\uC81C\uAE30\uB85C');
  if (beforeCommonRoadTypo !== text) addCorrectionLog('재기로', '제기로', '도로명 오타 보정');

  // ── A-3: 유니코드 정규화 ──────────────────────────────────────────
  text = text
    .normalize('NFC')
    .replace(/[​‌‍﻿­]/g, '')  // Zero-width / Soft-hyphen 제거
    .replace(/[　\xA0\t\n\r\f\v]/g, ' ')           // 전각 공백·NBSP·제어문자 → 공백
    .replace(/["""'''＂＇]/g, '')                        // 따옴표 전각·반각 모두 제거
    .replace(/\s{2,}/g, ' ')                            // 연속 공백 → 단일
    .trim();
  text = stripLeadingAddressJunk(text);

  // ── A-4: 미닫힌 괄호 제거 ─────────────────────────────────────────
  text = text.replace(/\([^)]*$/, '').trim();

  // ── A-6: 통·반 제거 ───────────────────────────────────────────────
  text = text.replace(/\s*제?\d{1,2}통\s*제?\d{1,2}반\s*/g, ' ').trim();

  // ── A-15: 도로명 번호 뒤 "." → "," ───────────────────────────────
  // 예: "테헤란로 123. 456호" → "테헤란로 123, 456호"
  text = text.replace(/(\d)\.\s+(?=\S)/g, '$1, ');
  text = text.replace(/[,\s]+$/, '').replace(/,(?=\S)/g, ', ');
  text = stripLeadingAddressJunk(text);

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
  text = text.replace(/\(.*?\)/g, m => {
    if (!m.replace(/[()]/g, '').trim()) return ' ';
    parens.push(m);
    return `__P${parens.length - 1}__`;
  });
  // A-28: 짝 없는 닫는 괄호 제거 — 중첩 괄호(삼화에코빌(6차)) 입력 시 non-greedy 추출 후
  // 바깥 ')' 가 text에 잔류하여 "103- 501호 ) (장안동)" 형태로 출력되는 버그 방지
  text = text.replace(/\)/g, '');

  // ── 본주소 / 상세주소 분리 ────────────────────────────────────────
  let mainAddr = '', detailAddr = '';
  const officialRoadParts = parseOfficialRoadAddressText(text);
  if (officialRoadParts) {
    mainAddr = officialRoadParts.searchAddress;
    detailAddr = officialRoadParts.detail;
    if (officialRoadParts.inferenceReason) {
      result.주소추정 = true;
      result.추정사유 = appendUniqueNote(result.추정사유, officialRoadParts.inferenceReason);
    }
  } else {
    mainAddr = text.replace(/\s+/g, ' ').trim();
  }

  // 도로명–번호 사이 공백 누락 보정 ("테헤란로123" → "테헤란로 123")
  // ※ 숫자 바로 뒤에 한글이 오면 번길·가길 계열 → 공백 추가 제외
  mainAddr = normalizeRoadAddressSpacing(mainAddr)
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

  // 도로명+건물번호 뒤에 건물명이 붙은 경우 API 검색어에서는 건물명을 분리한다.
  // 예: "황물로 71 마이룸고시텔" → 검색 "황물로 71", 표시 괄호 건물명 "마이룸고시텔"
  let inlineBuildingName = officialRoadParts?.inlineBuildingName || '';
  const inlineRoadMatch = mainAddr
    .replace(/__P\d+__/g, '')
    .trim()
    .match(/^(.+?(?:대로|로|길)[가-힣\d]*\s*\d+(?:-\d+)?)(?:\s+(.+))?$/);
  const inlineRoadOnly = inlineRoadMatch?.[1]?.trim() || '';
  const inlineTail = inlineRoadMatch?.[2]?.trim() || '';
  if (inlineRoadOnly && inlineTail && !CENTER_RE.test(inlineTail) && !/^\d+\s*(동|호|층)$/.test(inlineTail)) {
    inlineBuildingName = inlineTail.replace(/__P\d+__/g, '').trim();
  }

  // ── A-13: API 조회 — 시/구 컨텍스트 포함으로 오지역 매칭 방지 ──────
  // "왕산로 72" 같은 도로명이 전국 여러 곳에 존재할 때 틀린 지역 반환 방지
  // cityLabel에서 가장 하위 시·군·구 토큰을 추출해 검색 앞에 붙임
  // 예: "동대문구 왕산로 72" → 서울 동대문구 결과만 반환
  const baseSearch   = mainAddr.replace(/__P\d+__/g, '').trim();
  const searchBases  = [inlineRoadOnly || '', baseSearch].filter((v, i, arr) => v && arr.indexOf(v) === i);
  const districtTok  = cityLabel
    ? (cityLabel.trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '')
    : '';
  let apiResult = null;
  for (const s of searchBases) {
    const searchKeyword = districtTok ? `${districtTok} ${s}` : s;
    apiResult = await lookupAddr(searchKeyword, cityLabel);
    if (!apiResult && districtTok) apiResult = await lookupAddr(s, cityLabel); // districtTok 포함 실패 시 원문 재시도
    if (apiResult) break;
  }

  // ── Fallback A: 주민센터·행정복지센터·읍·면·동사무소 ───────────────
  if (!apiResult && CENTER_RE.test(text)) {
    const smartKw = generateCenterKeyword(text, adminDong, cityLabel);
    const centerPrimaryQueries = [
      cityLabel ? `${cityLabel.trim()} ${smartKw}` : '',
      cityLabel && adminDong ? `${cityLabel.trim()} ${adminDong.trim()} 주민센터` : '',
      cityLabel && adminDong ? `${cityLabel.trim()} ${adminDong.trim()} 행정복지센터` : '',
      smartKw,
    ].filter((q, i, arr) => q && arr.indexOf(q) === i);
    for (const q of centerPrimaryQueries) {
      apiResult = await lookupAddr(q, cityLabel);
      if (apiResult) break;
    }

    if (!apiResult) {
      for (const kw of CENTER_KWDS) {
        const v = smartKw.replace(/주민센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터/, kw);
        if (v !== smartKw) { apiResult = await lookupAddr(v, cityLabel); if (apiResult) break; }
      }
    }
    if (!apiResult && adminDong && !smartKw.startsWith(adminDong.trim())) {
      for (const kw of CENTER_KWDS) {
        apiResult = await lookupAddr(`${adminDong.trim()} ${kw}`, cityLabel);
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
          apiResult = await lookupAddr(`${localSuffix} ${dongName} ${kw}`, cityLabel);
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
          apiResult = await lookupAddr(kd.road_address_name, cityLabel) || kakaoDocToApiResult(kd);
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
      if (bldName.length >= 2) {
        const districtTokForBld = cityLabel
          ? (cityLabel.trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '')
          : '';
        const buildingQueries = [
          cityLabel ? `${cityLabel.trim()} ${adminDong.trim()} ${bldName}` : '',
          districtTokForBld ? `${districtTokForBld} ${adminDong.trim()} ${bldName}` : '',
          `${adminDong.trim()} ${bldName}`,
          cityLabel ? `${cityLabel.trim()} ${bldName}` : '',
        ].filter((q, i, arr) => q && arr.indexOf(q) === i);
        for (const q of buildingQueries) {
          apiResult = await lookupAddr(q, cityLabel);
          if (apiResult) break;
        }
      }
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
    // adminDong도 없으면 JUSO API emdNm(읍면동명) 사용 — 도로명 뒤 (행정동) 미표시 방지
    if (!dongPart && apiResult.emdNm?.trim() && DONG_SUFFIX.test(apiResult.emdNm.trim())) {
      dongPart = apiResult.emdNm.trim();
    }
    // A-27: 행정동 번호 접미어 제거 — 도로명주소 () 내 동명은 법정동(번호 없음) 표기
    // 예: 답십리2동 → 답십리동, 청량리3동 → 청량리동, 신설1동 → 신설동
    if (dongPart) dongPart = dongPart.replace(/^([가-힣]+)\d+(동)$/, '$1$2');

    buildingName = apiResult.bdNm || inlineBuildingName || '';
    // 괄호 분류: 긴 문장(3단어↑ or 10자↑+공백) → 특이사항, 동명 토큰 → 제거, 나머지 → buildingName
    parens.forEach(p => {
      const inner = p.replace(/^\(|\)$/g, '').trim();
      if (!inner) return;
      // 주소 괄호(법정동+건물명)는 특이사항으로 보내지 않는다 — 법정동 토큰(OO동/읍/면) 포함 시 주소괄호로 간주.
      const isAddrParen = /[가-힣]{2,}\d*(읍|면|동)(?![가-힣])/.test(inner);
      const wordCount = inner.split(/\s+/).length;
      if (!isAddrParen && (wordCount >= 3 || (inner.length >= 10 && /\s/.test(inner)))) {
        result.특이사항 += (result.특이사항 ? ' ' : '') + inner;
        return;
      }
      if (!buildingName) {
        const toks = inner.split(/[,\s]+/)
          .filter(tok => tok && !/^[가-힣][가-힣\d]*(읍|면|동)$/.test(tok.trim()));
        const candidate = toks.join(' ').trim();
        if (candidate) buildingName = candidate;
      }
    });
    detailAddr = detailAddr.replace(/__P\d+__/g, '').replace(/\s+/g, ' ').trim();
    // mainAddr에서 도로명+번호 이후 내용(지층·호 등)을 detailAddr로 이동 (A-11 쉼표 누락 방지)
    if (!detailAddr) {
      const mainClean = mainAddr.replace(/__P\d+__/g, '').replace(/\s+/g, ' ').trim();
      const roadNumMatch = mainClean.match(/^[가-힣\d]+(대로|로|길)[가-힣\d]*\s*\d+(?:-\d+)?\s+(.*)/);
      if (roadNumMatch?.[2]) detailAddr = roadNumMatch[2].trim();
    }
  } else {
    // ── A-12 ②: 도로명 미발견 + API 실패 플래그 ─────────────────────
    if (!/(로|길|대로)/.test(finalRoadAddr)) {
      result.확인필요 = true;
      result.확인사유 = '도로명 미발견 및 API 변환 실패';
    }
    // 괄호에서 dong/building/특이사항 추출 후 도로명 이후 내용 → detailAddr 이동
    parens.forEach((p, i) => {
      const inner = p.replace(/^\(|\)$/g, '').trim();
      const wordCount = inner ? inner.split(/\s+/).length : 0;
      if (!inner) {
        finalRoadAddr = finalRoadAddr.replace(`__P${i}__`, '');
        detailAddr    = detailAddr.replace(`__P${i}__`, '');
        return;
      }
      const isAddrParen = /[가-힣]{2,}\d*(읍|면|동)(?![가-힣])/.test(inner);
      if (!isAddrParen && (wordCount >= 3 || (inner.length >= 10 && /\s/.test(inner)))) {
        result.특이사항 += (result.특이사항 ? ' ' : '') + inner;
      } else if (!dongPart && DONG_SUFFIX.test(inner)) {
        dongPart = inner.replace(/^([가-힣]+)\d+(동)$/, '$1$2');
      } else if (!dongPart) {
        const dongTok = inner.split(/[,\s]+/).find(t => DONG_SUFFIX.test(t.trim()));
        if (dongTok) {
          dongPart = dongTok.trim().replace(/^([가-힣]+)\d+(동)$/, '$1$2');
          const rest = inner.replace(dongTok, '').replace(/^[,\s]+|[,\s]+$/g, '').trim();
          if (rest && !buildingName) buildingName = rest;
        } else if (!buildingName) {
          buildingName = inner;
        }
      } else if (!buildingName) {
        buildingName = inner;
      }
      finalRoadAddr = finalRoadAddr.replace(`__P${i}__`, '');
      detailAddr    = detailAddr.replace(`__P${i}__`, '');
    });
    if (!detailAddr) {
      const mainCleanNA = finalRoadAddr.replace(/\s+/g, ' ').trim();
      const roadMatchNA = mainCleanNA.match(/^([가-힣\d]+(대로|로|길)[가-힣\d]*\s*\d+(?:-\d+)?)\s+(.*)/);
      if (roadMatchNA?.[3]) {
        detailAddr    = roadMatchNA[3].trim();
        finalRoadAddr = roadMatchNA[1];
      }
    }
    if (!buildingName && inlineBuildingName) {
      buildingName = inlineBuildingName;
      if (inlineRoadOnly) finalRoadAddr = inlineRoadOnly;
    }
    finalRoadAddr = finalRoadAddr.replace(/\s+/g, ' ').trim();
    detailAddr    = detailAddr.replace(/\s+/g, ' ').trim();
  }

  let finalDetail = detailAddr;

  // ── finalDetail 전처리 (A-18 → A-19 → A-17 → A-10 순서) ─────────

  // A-18: 제(第) 접두어 제거 — 제101동 → 101동, 제205호 → 205호, 제3층 → 3층
  finalDetail = finalDetail.replace(/제\s*(\d+)\s*(동|호|층)\b/g, '$1$2');

  // A-19: 동호 붙여쓰기 분리 — 101동205호 → 101동 205호 (A-10에서 대시로 변환)
  finalDetail = finalDetail
    .replace(/([가-힣A-Za-z\d]+동)(\d+호)/g, '$1 $2')
    .replace(/([가-힣A-Za-z\d]+호)(\d+층)/g, '$1 $2');

  // A-17: 층/F 표기 변환 제거 — B동·F동 등 건물동 명칭과 혼동 오탐 발생
  // (3F→3층, B1→지하1층 모두 적용 안 함)

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

  finalDetail = normalizeAddressDetail(finalDetail);

  if (correctionLogs.length) {
    result.주소추정 = true;
    result.추정사유 = appendUniqueNote(result.추정사유, correctionLogs.join(' / '));
  }
  if (result.추정사유) {
    result.특이사항 = appendUniqueNote(result.특이사항, `[주소추정] ${result.추정사유}`);
  }

  // ── A-11: 최종 주소 형식 조합 ─────────────────────────────────────
  // 표준: "도로명주소(건물번호까지), (법정동, 건물명) 상세주소"
  // 도로명주소 바로 뒤 첫 구분자는 ","를 유지한다.
  // 이후 추가 구분이 필요하면 "/"를 쓰고, 괄호 내부의 법정동·건물명 구분 콤마는 예외로 유지한다.
  // 명단에 적힌 상세/부가 내용은 삭제하지 않고 finalDetail 또는 특이사항으로 보존한다.
  const parenParts  = [dongPart, buildingName].filter(Boolean);
  const parenInner  = parenParts.join(', ').replace(/,\s*$/, '').trim();
  const parenStr    = parenInner ? `(${parenInner})` : '';

  result.주소 = [finalRoadAddr, parenStr].filter(Boolean).join(ROAD_DETAIL_SEPARATOR);
  if (finalDetail) {
    // 괄호 있으면 "(법정동, 건물명) 상세"(앞 공백), 괄호 없으면 "도로명, 상세"(쉼표).
    // A-11: 도로명주소 바로 뒤 첫 구분자는 쉼표. 괄호 없을 때 공백으로 붙이면 표시단계에서 동호수 중복 유발.
    const detailSep = parenStr ? ' ' : ROAD_DETAIL_SEPARATOR;
    result.주소 += result.주소 ? `${detailSep}${finalDetail}` : finalDetail;
  }

  // ── A-12 ③: 변환 후 주소 3자 미만 플래그 ────────────────────────
  if (result.주소.length < 3) {
    result.확인필요 = true;
    result.확인사유 = '변환 후 주소 비정상';
  }

  // ── A-22: 특이사항에 주민센터류 표현이 있으면 맨 뒤에 참고주소 붙이기 ──
  // 단, 주소 자체가 이미 주민센터 주소인 경우(CENTER_RE) 중복 방지
  if (normalizedInputNote && CENTER_RE.test(normalizedInputNote) && result.주소 && !CENTER_RE.test(text)) {
    const referenceDong = (adminDong || dongPart || '').trim();
    const ckw = referenceDong ? `${referenceDong} 주민센터` : generateCenterKeyword(normalizedInputNote, adminDong, cityLabel);
    let cres = await lookupAddr(ckw, cityLabel);
    // JUSO 실패 시 Kakao POI 검색으로 주민센터 도로명 취득 후 재조회
    if (!cres) {
      const localPfx = cityLabel ? cityLabel.trim().split(/\s+/).pop() + ' ' : '';
      const queries = [
        ckw,
        referenceDong ? `${localPfx}${referenceDong} 주민센터` : null,
        referenceDong ? `${localPfx}${referenceDong} 행정복지센터` : null,
        adminDong?.trim() ? `${localPfx}${adminDong.trim()} 주민센터` : null,
        dongPart          ? `${localPfx}${dongPart} 주민센터`          : null,
      ].filter((q, i, arr) => q && arr.indexOf(q) === i);
      for (const q of queries) {
        const kd = await searchKakaoFull(q);
        if (kd?.road_address_name) {
          cres = await lookupAddr(kd.road_address_name, cityLabel) || kakaoDocToApiResult(kd);
          if (cres) break;
        }
      }
    }
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
        const centerLabel = `${referenceDong || cDong || '해당행정동'} 주민센터`;
        const centerSuffix = `[참고: ${centerLabel} ${centerAddr}]`;
        // 이미 같은 주민센터 주소가 있으면 중복 추가 금지
        if (centerAddr && cRoadShort.length >= 5 && !result.주소.includes(centerAddr)) {
          result.주소 = `${result.주소}${ADDRESS_EXTRA_SEPARATOR}${centerSuffix}`;
        }
      }
    }
  }

  // ── 좌표 취득 (Kakao Geocoding) ──────────────────────────────────
  result.isApt = apiResult?.bdKdcd === '1';
  result.standardRoadAddress = apiResult?.standardRoadAddress || apiResult?.roadAddr || '';
  result.roadName = apiResult?.roadName || apiResult?.rn || '';
  result.buildingMainNo = apiResult?.buildingMainNo ?? apiResult?.buldMnnm ?? '';
  result.buildingSubNo = apiResult?.buildingSubNo ?? apiResult?.buldSlno ?? '';
  result.buildingName = apiResult?.buildingName || apiResult?.bdNm || '';
  result.legalDong = apiResult?.legalDong || apiResult?.emdNm || '';
  // 리(里): 읍/면 법정리 — 기사 배정 리 단위 매칭용. API liNm 우선, 없으면 지번주소(도로명 없음)에서 "OO리" 추출.
  result.리 = (apiResult?.liNm || apiResult?.legalRi || '').trim();
  // 지번주소(jibunAddr)에서 OO리 추출 — 도로명주소여도 지번주소엔 리가 포함됨(읍/면). 가장 확실한 소스.
  if (!result.리 && apiResult?.jibunAddr) {
    const m = String(apiResult.jibunAddr).match(/([가-힣]{2,5}리)(?=\s|\d|,|$)/);
    if (m) result.리 = m[1];
  }
  // 입력 지번주소(도로명 없음) 폴백
  if (!result.리 && !/(대로|로|길)\s*\d/.test(inputAddr || '')) {
    const liMatch = (inputAddr || '').match(/([가-힣]{2,4}리)\s*\d/);
    if (liMatch) result.리 = liMatch[1];
  }
  result.matchedSido = apiResult?.matchedSido || apiResult?.siNm || '';
  result.matchedSigungu = apiResult?.matchedSigungu || apiResult?.sggNm || '';
  result.detailAddress = finalDetail || '';
  result.addressMgtNo = apiResult?._addressMgtNo || '';
  result.buildingMgtNo = apiResult?.bdMgtSn || '';
  result.matchSource = apiResult?._matchSource || (apiResult ? 'juso_fallback' : '');
  result.matchConfidence = apiResult?._matchConfidence || null;
  result.routeHints = apiResult?._routeHints || null;
  appendCheckReason(result, getAreaIssue(cityLabel, adminDong, result.matchedSido, result.matchedSigungu, result.legalDong));
  if (apiResult?.jibunAddr && !result.standardRoadAddress) {
    appendCheckReason(result, `지번주소만 확인됨: ${apiResult.jibunAddr}`);
  } else if (!apiResult && text && !result.확인필요) {
    // A-12: '도로명 미발견 AND API실패'만 확인필요. 도로명(로/길/대로+번호)이 멀쩡히 파싱됐으면
    // DB/JUSO가 일시 미확인(대량 burst 등)이어도 멀쩡한 주소를 확인명단에 넣지 않는다.
    if (!/(대로|로|길)\s*\d+(?:-\d+)?/.test(result.주소 || '')) {
      appendCheckReason(result, '주소 없음: 전국 주소DB/JUSO에서 확인되지 않음');
    }
  }
  result.lat   = null;
  result.lng   = null;
  if (includeCoords && result.주소) {
    // JUSO roadAddr이 있으면 도시명 포함 전체 주소 → cityPrefix 불필요
    // 없으면 result.주소(도시명 없음)에 cityLabel에서 추출한 시군구 접두어 추가
    const cityPrefix = !apiResult?.roadAddr && cityLabel
      ? (cityLabel.trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '')
      : '';
    const coord = await fetchKakaoCoord(apiResult?.roadAddr || result.주소, cityPrefix, result.buildingMgtNo);
    if (coord) { result.lat = coord.lat; result.lng = coord.lng; }
  }

  return result;
};
