import { collection, getDocs, setDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase.js';
import { getLocalCache, setLocalCache } from './dbCache.js';
import { parseAptDong } from './routeSequenceEngine.js';
import { applyNoteNormalize } from '../learn/applyNoteNormalize.js';
import { buildVariantIndex, applyVariant } from '../learn/normalizeVariant.js';
import { normalizeDongHoDetail, DONG_DASH_HO_SRC } from './dongHoFormat.js';

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
// A-31: `숫자+동/층/호` 뒤에 한글이 바로 붙으면(장안2동주민센터·신내1동우편취급국) 동호수가 아니라
// 건물명의 일부다. 가드가 없어 "장안2동주민센터"가 "장안"+"2동주민센터"로 쪼개져 상세주소가
// 오염되고 건물명 매칭이 깨졌다. DONG_UNIT_SRC(동 토큰) 규칙 자체는 그대로 둔다(A-10).
// 동(棟) 단위 토큰 — 상세주소(동호수)의 일부. 숫자동(101동)·대시동(1-1동)·영문동(B동)·단일한글동(가동~하동).
// 뒤에 공백/숫자/호/콤마/끝이 와야 매칭(건물명 중간의 '하동' 등 오절단 방지). 건물명으로 새는 버그 차단.
const DONG_UNIT_SRC = '(?:\\d+(?:-\\d+)?|[A-Za-z]+|[가나다라마바사아자차카타파하])\\uB3D9(?=\\s|\\d|\\uD638|,|$)';
// A-10 ③(형 지시 2026-07-30): 동 대신 대시로 쓰인 숫자 동(101-203호)도 상세주소(동호수)로 인식한다.
//   없으면 "101-"이 건물명 슬롯으로 새어 동 번호가 소실된다(실측 확인). 자리수 가드는 dongHoFormat.js 참조.
const DETAIL_START_RE = new RegExp(`^(?:\\uC9C0\\uD558|\\uC9C0\\uCE35|\\uC625\\uD0D1|${DONG_UNIT_SRC}|${DONG_DASH_HO_SRC}|\\d+\\s*(?:\\uB3D9|\\uCE35|\\uD638)(?![\\uAC00-\\uD7A3])|[A-Za-z]?\\d+\\s*\\uD638)`, 'u');
const DETAIL_MARKER_RE = new RegExp(`__P\\d+__|\\uC9C0\\uD558|\\uC9C0\\uCE35|\\uC625\\uD0D1|${DONG_UNIT_SRC}|${DONG_DASH_HO_SRC}|\\d+\\s*(?:\\uB3D9|\\uCE35|\\uD638)(?![\\uAC00-\\uD7A3])|[A-Za-z]?\\d+\\s*\\uD638`, 'u');
// 주소칸에 섞인 전화번호 패턴(지역번호 0XX 또는 휴대폰 01X) — 건물명/상세 오염 차단용. 한국 지번·건물번호는 0으로 시작 안 함.
const PHONE_IN_ADDR_RE = /(?:0\d{1,2}|01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/;

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

// 상세주소에 동일 호/동 토큰이 두 번 들어간 원본 오타만 1개로 정리.
// "201호, 201호"·"201호 201호"·"1층102호,1층102호" → 1개. 서로 다른 토큰(101동 502호)은 보존.
const _DETAIL_DUP_RE = /([0-9A-Za-z가-힣-]+[호동])\s*,?\s*\1(?![0-9A-Za-z가-힣])/gi;
const dedupeDetailTokens = (detail) => {
  let res = String(detail || '');
  let prev;
  do { prev = res; res = res.replace(_DETAIL_DUP_RE, '$1'); } while (prev !== res);
  return res;
};

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
const extractSigungu = (label) => {
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
const extractSido = (label) => {
  const toks = String(label || '').trim().split(/\s+/).filter(Boolean);
  return toks.find(t => SIDO_HEAD_RE.test(t) || SIDO_LEAD_RE.test(t)) || '';
};

// 선택 지자체(cityLabel) vs 매칭 결과(matchedSido/Sigungu) 동일 지역 판정.
// cityLabel은 자유 입력이라 시도가 없을 수 있음 → 시군구 토큰으로 비교, 시도는 둘 다 있을 때만 보조 비교.
const getMunicipalityMatch = (cityLabel, matchedSido, matchedSigungu) => {
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
let nameTypoDict = {};       // 이름 오타 사전(Phase 4) — 주소 typo와 분리, 이름에만 적용
let buildingAliasDict = {};  // 건물명 별칭 사전(Phase 4) — 승인된 별칭 → 표준 건물명
let noteNormalizeDict = {};  // 특이사항 정규화 사전(#5-A) — 승인된 표기(wrong) → 표준(correction), 완전일치만
let buildingAliasVariantIndex = {}; // 건물명 표기변이 정규화 인덱스(D) — 공백·기호 무시 완전일치 폴백
let noteNormalizeVariantIndex = {}; // 특이사항 표기변이 정규화 인덱스(D)

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
  if (!KAKAO_REST_KEY || !addr || addr.trim().length < 4) return null;
  const hasCity = /특별시|광역시|특별자치시|도$|시$/.test(addr.slice(0, 10));
  const sggPfx  = hasCity ? '' : (extractSigungu(cityLabel) || (cityLabel || '').trim().split(/\s+/).pop() || '');
  const query   = `${sggPfx ? `${sggPfx} ` : ''}${addr}`.trim();
  const key     = `${cityLabel.trim()}::${query}`;
  if (legalDongCache.has(key)) return legalDongCache.get(key);
  if (!legalDongPending.has(key)) {
    const p = (async () => {
      try {
        const res = await fetchWithTimeout(
          `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=1`,
          { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } },
          KAKAO_TIMEOUT_MS
        );
        if (!res.ok) return null;
        const d = (await res.json()).documents?.[0];
        if (!d) return null;
        const ra = d.road_address || null;
        const ad = d.address || null;
        // A-30: 지역 검증 — 전국 동명 오매칭 차단(시흥시 군자동 vs 광진구 군자동)
        const sido = ra?.region_1depth_name || ad?.region_1depth_name || '';
        const sgg  = ra?.region_2depth_name || ad?.region_2depth_name || '';
        if (!isCandidateInSelectedMunicipality({ matchedSido: sido, matchedSigungu: sgg }, cityLabel)) return null;
        const legal = String(ra?.region_3depth_name || ad?.region_3depth_name || '').trim();
        if (!legal || !LEGAL_DONG_RE.test(legal)) return null;
        return {
          legalDong:    legal,
          buildingName: String(ra?.building_name || '').trim(),
        };
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
          `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(key)}&size=1`,
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

// Kakao POI → JUSO 호환 구조 변환 (JUSO 미인덱스 케이스)
const kakaoDocToApiResult = (d) => {
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
const kakaoDocInMunicipality = (d, cityLabel) => {
  if (!d) return false;
  const addr = `${d.address_name || ''} ${d.road_address_name || ''}`.trim();
  if (!addr) return false;
  return isCandidateInSelectedMunicipality(
    { matchedSido: extractSido(addr), matchedSigungu: extractSigungu(addr) },
    cityLabel
  );
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

// ── 공통 패턴 상수 ─────────────────────────────────────────────────
const DO_PATTERN    = /^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/;
const REGION_SUFFIX = /^[가-힣\d]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/;
// 카카오 등 축약 도명(경기·서울·충남 …) — 접미어가 없어 REGION_SUFFIX로 안 잡힘. 시도 선두 토큰 제거용.
const REGION_LEAD   = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/;
const DONG_SUFFIX   = /^[가-힣\d]+(읍|면|동)$/;
// A-31: '법정동' 판정 전용 — 실제 법정동 표기는 동/읍/면 말고도 다음 형태가 있다.
//   · OO동            용두동, 장안동
//   · OO읍 / OO면      홍북읍, 광천면
//   · OO가            매산로2가, 을지로3가   ← 수원·서울 구도심 법정동(과거 누락 원인)
//   · "OO읍 OO리"      홍북읍 신경리          ← 읍/면 지역 법정동+법정리(두 토큰, 과거 누락 원인)
//   · OO리            신경리
// DONG_SUFFIX(동/읍/면)만 쓰면 위 '가'·'읍 리' 형태가 전부 버려져 법정동이 빈칸이 된다.
const LEGAL_DONG_RE = /^(?:[가-힣\d]+(?:읍|면)\s+)?[가-힣\d]+(?:동|읍|면|가|리)$/;

// 공공기관 감지 — A-5 토큰 삭제 방지 + Fallback A 트리거
const CENTER_RE   = /(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/;
const CENTER_KWDS = ['주민센터', '행정복지센터', '동사무소', '읍사무소', '면사무소'];

// A-5: 지역 토큰 판별
const REGION_TOKEN_RE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$|^[가-힣\d]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동)$/;
// 접미어 없이 단독으로 쓰이는 기초시 목록
const KNOWN_CITY_RE   = /^(부천|수원|성남|안양|안산|용인|고양|창원|포항|청주|천안|전주|김해|김포|광명|시흥|하남|파주|구리|양주|오산|군포|의왕|과천|이천|여주|평택|화성|의정부|남양주|양평|가평|동두천|연천|포천|안성|광주|나주|순천|목포|여수|익산|군산)$/;

// A-8: 건물 유형어 (Fallback B 트리거)
const BLDG_TYPE_RE = /(아파트|빌라|빌딩|타워|오피스텔|주공|단지|복지관|경로당|요양원|노인|의원|병원|학교|교회|성당|사찰|회관|고시원|원룸|연립|다세대|모텔|호텔|상가|센터|하우스|파크|캐슬|힐스|래미안|자이|푸르지오|롯데|현대|삼성|sk뷰|이편한세상)/i;

// ── A-7: 주민센터 검색어 생성 — 정의: 지자체(시군구) + 행정동 + 주민센터 ─────
// 주민센터는 반드시 "{시군구} {행정동} 주민센터" 형태로 검색한다(행정동 우선, 시군구 접두어 강제).
// 전국 동명(예: 시흥시 군자동 vs 서울 광진구 군자동) 오매칭 방지.
const generateCenterKeyword = (rawText, adminDong, cityLabel) => {
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

// ══════════════════════════════════════════════════════════════════
//  processAddress — 메인 정제 함수
// ══════════════════════════════════════════════════════════════════
export const processAddress = async (inputAddr, inputName = '', adminDong = '', cityLabel = '', inputNote = '', options = {}) => {
  const includeCoords = options.includeCoords !== false;
  const result = {
    정제된이름: inputName,
    주소: '',
    특이사항: '',
    본명: '',
    확인필요: false,
    확인사유: '',
    도: '',
    주소추정: false,
    추정사유: '',
    원주소: inputAddr || '',
  };

  // ── A-1: 이름 5자 초과 → 5자 자르기 + 본명 전용 필드에 원본명 보관 ──────
  // (특이사항 오염 방지: 본명은 특이사항이 아니라 별도 '본명' 컬럼으로 분리)
  if (inputName?.length > 5) {
    result.정제된이름 = inputName.substring(0, 5);
    result.본명       = inputName;
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
  // 학습 이름 오타 사전 적용 (Phase 4) — 정제된이름/본명에 승인된 이름 오타 치환(완전일치만).
  {
    const _bn = result.정제된이름;
    if (_bn && nameTypoDict[_bn]) result.정제된이름 = nameTypoDict[_bn];
    if (result.본명 && nameTypoDict[result.본명]) result.본명 = nameTypoDict[result.본명];
    if (_bn !== result.정제된이름) addCorrectionLog(_bn, result.정제된이름, '학습 이름 보정');
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

  // ── 주소칸에 섞인 전화번호 → 특이사항 분리 (괄호/상세 오염 차단) ─────
  // 예: "대실길131,042-841-1633" → 주소 "대실길 131" + 특이사항 "042-841-1633"
  {
    const phoneRe = new RegExp(PHONE_IN_ADDR_RE.source, 'g');
    const phones = text.match(phoneRe);
    if (phones) {
      phones.forEach(p => { result.특이사항 = appendUniqueNote(result.특이사항, p.trim()); });
      text = text.replace(phoneRe, ' ').replace(/[,\s]+$/,'').replace(/\s+/g, ' ').trim();
    }
  }

  // 공공기관 키워드 포함 여부 사전 감지 (A-5 동 토큰 삭제 방지)
  const hasCenterKw = CENTER_RE.test(text);
  // A-2: 지번주소 판별 — 도로명(로/길/대로)+번호가 없으면 지번 → 읍/면 보존
  const hasRoadName = /[가-힣\d]+(대로|로|길)\s*\d/.test(text);

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
    // A-2: 도로명(로/길/대로)이 없는 지번·건물명 주소면 읍/면/동(법정동) 보존
    // 광덕면 신흥리 123 → 광덕면 유지 / 용두동 행복아파트 → 용두동 유지 (동 손실·오매칭 방지)
    const isEmdInJibun = !hasRoadName && /[가-힣]{2,}(읍|면|동)$/.test(t);
    if (!isRegion || isCenterDong || isEmdInJibun) kept.push(t);
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
  if (inlineRoadOnly && inlineTail && !CENTER_RE.test(inlineTail)) {
    // 상세주소(동/호/층) 또는 빌라 동(棟: 가동·B동·에이동)이면 건물명이 아니라 상세주소 — 동 손실 방지
    const tailIsDetail = /\d+\s*(동|호|층)/.test(inlineTail)        // 101호·103동·가동 101호의 숫자
      || /[가-힣A-Za-z]+동(?:\s|$)/.test(inlineTail)                // 가동·나동·B동·에이동 (단독/선두)
      || /^\d+\s*(동|호|층)$/.test(inlineTail);
    if (tailIsDetail) {
      // 동(棟)+호수는 상세주소로 보존 (mainAddr는 도로명만 남겨 API 검색 정확도 유지)
      detailAddr = `${inlineTail.replace(/__P\d+__/g, '').trim()} ${detailAddr}`.replace(/\s+/g, ' ').trim();
      mainAddr   = inlineRoadOnly;
    } else {
      inlineBuildingName = inlineTail.replace(/__P\d+__/g, '').trim();
    }
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
    // 주민센터 정의: 지자체(시군구) + 행정동 + 주민센터. smartKw가 이미 "{시군구} {행정동} 주민센터".
    const smartKw = generateCenterKeyword(text, adminDong, cityLabel);
    const sgg = extractSigungu(cityLabel);
    const sggPfx = sgg ? `${sgg} ` : (cityLabel ? `${cityLabel.trim().split(/\s+/).pop()} ` : '');
    const dong = adminDong?.trim();
    // 지자체+행정동 + (주민센터/행정복지센터/동사무소…) 변형 — 모두 시군구 접두어 강제
    const centerQueries = [
      smartKw,
      ...(dong ? CENTER_KWDS.map(kw => `${sggPfx}${dong} ${kw}`) : []),
      smartKw.replace(/주민센터/, '행정복지센터'),
    ].filter((q, i, arr) => q && arr.indexOf(q) === i);
    for (const q of centerQueries) {
      apiResult = await lookupAddr(q, cityLabel);
      if (apiResult) break;
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
          apiResult = await lookupAddr(kd.road_address_name, cityLabel)
            || (kakaoDocInMunicipality(kd, cityLabel) ? kakaoDocToApiResult(kd) : null);
          if (apiResult) break;
        }
      }
    }
  }

  // ── Fallback B (A-8): 건물명 전용 (도로명·지번 없음) ─────────────
  // A-31 확장: 행정동 컬럼이 없어도 지자체(cityLabel)만으로 시도한다. 예전엔 adminDong이
  // 없으면 이 경로 자체를 건너뛰어, 명단에 아파트명·학교·우체국만 적힌 행이 전부 미매칭이었다.
  if (!apiResult && (adminDong || cityLabel)) {
    const hasRoadOrJibun = /(로|길|대로)\s*\d/.test(text) || /[가-힣\d]+(동|읍|면|리)\s*\d+/.test(text);
    // A-31: 건물 유형어(아파트·빌라…)가 없어도 시도한다. 실제 명단에는 유형어 없는 건물명이
    // 많다(더존에이스빌·동광팰리스·숲예찬·서울장안동우체국 등) — 예전엔 전부 미매칭이었다.
    // 대신 유형어가 없으면 Kakao POI 이름이 입력과 일치할 때만 채택한다(엉뚱한 장소 매칭 차단).
    if (!hasRoadOrJibun) {
      const needNameMatch = !BLDG_TYPE_RE.test(text);
      // A-31: 동호수 절단은 '공백/문두 + 숫자 + 동·층·호' 이고 뒤에 한글이 안 붙을 때만.
      // 예전 패턴(\d+\s*(동|층|호).*$)은 건물명 속 숫자동까지 잘라
      //   "서울장안2동우체국"→"서울장안", "신내1동우편취급국"→"신내" 로 망가뜨려 매칭을 놓쳤다.
      const bldName = text.replace(/(^|[\s,])\d+\s*(동|층|호)(?![가-힣]).*$/g, '').replace(/__P\d+__/g, '').trim();
      if (bldName.length >= 2) {
        const dongTok = adminDong?.trim() || '';
        const districtTokForBld = cityLabel
          ? (cityLabel.trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '')
          : '';
        const buildingQueries = [
          cityLabel && dongTok ? `${cityLabel.trim()} ${dongTok} ${bldName}` : '',
          districtTokForBld && dongTok ? `${districtTokForBld} ${dongTok} ${bldName}` : '',
          dongTok ? `${dongTok} ${bldName}` : '',
          cityLabel ? `${cityLabel.trim()} ${bldName}` : '',
          districtTokForBld ? `${districtTokForBld} ${bldName}` : '',
        ].filter((q, i, arr) => q && arr.indexOf(q) === i);
        for (const q of buildingQueries) {
          apiResult = await lookupAddr(q, cityLabel);
          if (apiResult) break;
        }
        // 전국 주소DB가 건물명을 못 찾으면 Kakao POI로 도로명주소를 얻어 재조회한다.
        // (주소DB는 건물명 인덱스가 약하고, 콜드스타트 지연으로 실패하는 일도 잦다)
        if (!apiResult) {
          const bldKey = normalizePlaceKey(bldName);
          for (const q of buildingQueries) {
            const kd = await searchKakaoFull(q);
            if (!kd?.road_address_name) continue;
            if (!kakaoDocInMunicipality(kd, cityLabel)) continue;   // A-30 지역검증
            if (needNameMatch) {
              // 유형어 없는 자유 건물명 → 이름이 서로 포함관계일 때만 신뢰
              const placeKey = normalizePlaceKey(kd.place_name);
              if (!placeKey || !(placeKey.includes(bldKey) || bldKey.includes(placeKey))) continue;
            }
            apiResult = await lookupAddr(kd.road_address_name, cityLabel) || kakaoDocToApiResult(kd);
            if (apiResult) break;
          }
        }
      }
    }
  }

  // ── 결과 조립 ─────────────────────────────────────────────────────
  result.도 = DO_PATTERN.exec(text)?.[1] || '';

  let dongPart = '', buildingName = '', finalRoadAddr = mainAddr;

  // ── 입력 건물번호 SSOT 가드 (유사매칭/변조 차단 · 절대 되돌리지 말 것) ──
  // 입력이 도로명주소이고 API 결과의 도로명 뒤 건물번호가 입력과 다르면 → API 결과 전부 폐기.
  // 도로명주소 건물번호는 절대 불변(이동·빈칸·법정동/건물명 보완만 허용). 서버 근사매칭이 뚫려도 여기서 최종 차단.
  // 예: 입력 "박석로25번길 32" → API "박석로25번길 32-5"(인접 부번 건물) 반환 시, 32-5·신한타운 모두 거부하고 원본 32 유지.
  if (apiResult && officialRoadParts && officialRoadParts.mainNo) {
    const inputNo = `${officialRoadParts.mainNo}${officialRoadParts.subNo ? '-' + officialRoadParts.subNo : ''}`;
    const rn = officialRoadParts.roadName || '';
    const cleanFinal = String(apiResult.roadAddrPart1 || '').replace(/\s+/g, '');
    const idx = rn ? cleanFinal.indexOf(rn) : -1;
    const apiNo = idx >= 0 ? (cleanFinal.slice(idx + rn.length).match(/^(\d+(?:-\d+)?)/)?.[1] || '') : '';
    if (apiNo && apiNo !== inputNo) {
      appendCheckReason(result, `도로명 건물번호 불일치(입력 ${inputNo} ≠ API ${apiNo}) — 유사매칭 거부, 원본 주소 유지`);
      apiResult = null; // API 결과 폐기 → 아래 else(원본 입력 유지) 경로로
    }
  }

  if (apiResult) {
    const rawFinal = apiResult.roadAddrPart1 || mainAddr;
    result.도 = DO_PATTERN.exec(rawFinal)?.[1] || result.도;

    const rParts = rawFinal.split(/\s+/);
    let keepIdx = 0;
    for (let i = 0; i < rParts.length; i++) {
      // 시도/시군구 토큰 제거 (축약 도명 '경기'·'충남' 등 포함 — 카카오 폴백 대응). 읍/면/동은 dongPart로 별도 처리.
      if (REGION_SUFFIX.test(rParts[i]) || REGION_LEAD.test(rParts[i])) keepIdx = i + 1; else break;
    }
    let remain = rParts.slice(keepIdx);
    if (remain.length > 0 && DONG_SUFFIX.test(remain[0])) dongPart = remain.shift();
    finalRoadAddr = remain.join(' ') || rawFinal;

    // ── A-24(개정): 괄호 동명은 '법정동'이 최우선 (절대 되돌리지 말 것) ──
    // 괄호 `()` 안은 법정동이어야 한다. 도로명주소(roadAddrPart1)에는 동(洞) 토큰이 없는
    // 경우가 대부분이라, 예전 우선순위(도로명 토큰 → adminDong → emdNm)에서는 사실상
    // adminDong(행정동 컬럼)이 채택돼 괄호에 행정동이 들어갔다.
    // 이제 주소DB가 확인한 법정동(legalDong/emdNm)을 무조건 먼저 쓴다.
    const apiLegalDong = String(apiResult.legalDong || apiResult.emdNm || '').trim();
    if (apiLegalDong && LEGAL_DONG_RE.test(apiLegalDong)) dongPart = apiLegalDong;

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
    // 법정동을 끝내 못 얻었을 때만 adminDong(행정동 컬럼) 폴백 — 괄호 공란 방지용 최후수단
    if (!dongPart && adminDong?.trim() && DONG_SUFFIX.test(adminDong.trim())) {
      dongPart = adminDong.trim();
    }
    // A-27: 행정동 번호 접미어 제거 — 도로명주소 () 내 동명은 법정동(번호 없음) 표기
    // 예: 답십리2동 → 답십리동, 청량리3동 → 청량리동, 신설1동 → 신설동
    if (dongPart) dongPart = dongPart.replace(/^([가-힣]+)\d+(동)$/, '$1$2');

    buildingName = apiResult.bdNm || inlineBuildingName || '';
    // 무손실(M-1): API 건물명(bdNm)이 채택되면서 버려지던 입력 문구를 특이사항으로 보존한다.
    // 예 "왕산로 72 뒷문으로 들어와서 계단 오른쪽" → 배송 안내가 통째로 사라지던 문제.
    // 단 채택된 건물명과 서로 포함관계면(같은 건물의 다른 표기) 중복이므로 넣지 않는다.
    if (inlineBuildingName && inlineBuildingName !== buildingName) {
      const keptKey = normalizePlaceKey(buildingName);
      const dropKey = normalizePlaceKey(inlineBuildingName);
      if (dropKey && !(keptKey && (keptKey.includes(dropKey) || dropKey.includes(keptKey)))) {
        result.특이사항 = appendUniqueNote(result.특이사항, inlineBuildingName);
      }
    }
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
      // 폴백: 도로명 오타(로/길 누락, 예 "대실남북82,401동104호")로 위 매칭 실패 시
      //   콤마 뒤 동/호 패턴을 상세로 보존 (DB는 매칭됐는데 상세가 버려지는 손실 차단)
      else {
        const cm = mainClean.match(/[,\s]\s*((?:\d+(?:-\d+)?|[A-Za-z]|[가나다라마바사아자차카타파하])?동?\s*\d*\s*호?.*)$/);
        const afterComma = mainClean.includes(',') ? mainClean.slice(mainClean.indexOf(',') + 1).trim() : '';
        const cand = (afterComma && /\d+\s*호|\d+\s*동/.test(afterComma)) ? afterComma : (cm?.[1] || '');
        if (cand && /\d+\s*호|\d+\s*동/.test(cand)) detailAddr = cand.replace(/^[,\s]+/, '').trim();
      }
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

  // ── 버그수정 #3/#4: 괄호(건물명)에서 건물 동(棟) 분리 → 상세주소로 이동 ──
  // 괄호 `()` 는 (법정동, 건물명)만 담는다. 빌라/아파트 건물 동(가동·B동·101동 등)이
  // bdNm/inline으로 buildingName에 섞이면, 같은 "101동"이 어떤 건 괄호(미변환)·어떤 건
  // 상세(A-10 대시변환)로 갈려 표기가 뒤죽박죽된다. 건물 동은 항상 detailAddr로 보내
  // A-10이 일관 정규화하도록 한다(법정동 dongPart·진짜 건물명은 보존).
  if (buildingName) {
    const bn = buildingName.trim();
    // 끝에 붙은 건물 동(棟)[+호] 분리:
    //  - 숫자동(101동)·영문동(B동)은 호수 동반 무관하게 건물 동으로 확정
    //  - 단일 한글동(가동·나동)은 "호수 동반" 시에만 — 법정동(사동·본동 등) 오인 방지
    //  - 앞 건물명은 보존: "푸르지오 101동" → 상세 "101동" / 괄호 건물명 "푸르지오"
    const m = bn.match(/^(.*?)\s*((?:\d+|[A-Za-z]+)동(?:\s*제?\s*\d+\s*호)?|[가-힣]동\s*제?\s*\d+\s*호)$/);
    if (m && m[2]) {
      detailAddr = `${m[2].trim()} ${detailAddr}`.replace(/\s+/g, ' ').trim();
      buildingName = m[1].trim();
    }
  }

  // 버그수정: 건물명 슬롯이 전화번호면 특이사항으로 이동(주소 괄호 오염 차단)
  if (buildingName && PHONE_IN_ADDR_RE.test(buildingName.replace(/\s/g, ''))) {
    const ph = buildingName.trim();
    result.특이사항 = appendUniqueNote(result.특이사항, ph);
    buildingName = '';
  }

  let finalDetail = detailAddr;

  // ── finalDetail 전처리 (A-18 → A-19 → A-17 → A-10 순서) ─────────

  // A-18: 제(第) 접두어 제거 — 제101동 → 101동, 제205호 → 205호, 제3층 → 3층
  finalDetail = finalDetail.replace(/제\s*(\d+)\s*(동|호|층)\b/g, '$1$2');

  // A-19: 동호 붙여쓰기 분리 — 101동205호 → 101동 205호 (A-10에서 대시로 변환)
  finalDetail = finalDetail
    .replace(/([가-힣A-Za-z\d-]+동)(\d+호)/g, '$1 $2')
    .replace(/([가-힣A-Za-z\d]+호)(\d+층)/g, '$1 $2');

  // A-17: 층/F 표기 변환 제거 — B동·F동 등 건물동 명칭과 혼동 오탐 발생
  // (3F→3층, B1→지하1층 모두 적용 안 함)

  // A-10: 동호 형식 정규화 (순수함수 src/engine/dongHoFormat.js — 회귀 scripts/dong-ho-format.test.mjs)
  //   숫자 동(대단지 아파트) → 대시 + 호수 4자리 패딩 + 층은 호 뒤로: "101동 3층 203호" → "101- 203호 3층"
  //   비숫자 동(빌라·연립 가동·A동·1-1동) → "동" 유지 + **층 위치 원본 보존**: "가동 3층 101호" 그대로
  //   동 없음 → 층 그대로 + 호수만 4자리 우측정렬 패딩
  //   대시로 쓰인 숫자 동(101-203호) → 숫자 동과 동일 형식으로 저장
  finalDetail = normalizeDongHoDetail(finalDetail);

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
  finalDetail = dedupeDetailTokens(finalDetail);   // 원본 오타로 상세가 두 번 들어간 경우 1개로 정리

  if (correctionLogs.length) {
    result.주소추정 = true;
    result.추정사유 = appendUniqueNote(result.추정사유, correctionLogs.join(' / '));
  }
  if (result.추정사유) {
    result.특이사항 = appendUniqueNote(result.특이사항, `[주소추정] ${result.추정사유}`);
  }

  // ── A-31: 법정동 빠짐 방지 보강조회 (형 지시 2026-07-21 · 절대 되돌리지 말 것) ──
  // 여기까지 와서 법정동을 못 얻었으면(=괄호가 비거나 행정동 폴백이면), 확정된 도로명주소로
  // 주소DB를 한 번 더 조회해 '실제 법정동'을 받아 채운다. 실패할 때만 기존 값을 유지한다.
  // lookupAddr이 부정 캐시까지 들고 있어 같은 주소가 반복돼도 추가 호출은 1회뿐이다.
  let legalDong = String(apiResult?.legalDong || apiResult?.emdNm || '').trim();
  // 읍/면만 온 경우(예 "홍북읍")는 법정리까지 있어야 완전하다 — 리는 정렬·기사배정 단위(§6)라
  // "홍북읍 신경리"로 보강한다. 보강 실패 시 "홍북읍"을 그대로 유지(퇴행 없음).
  const isBareEupMyeon = /^[가-힣\d]+(?:읍|면)$/.test(legalDong);
  if ((!legalDong || isBareEupMyeon) && finalRoadAddr && finalRoadAddr.trim().length >= 4) {
    // ① Kakao 주소검색 우선 — 전국 주소DB(address-service)는 응답이 느려(20초+) 3초 타임아웃에
    //    걸리는 일이 잦다. Kakao는 수백 ms 안에 법정동을 준다(형 지시 2026-07-21).
    const kl = await fetchKakaoLegalDong(finalRoadAddr, cityLabel);
    // 읍/면 보강 시에는 '더 구체적인 값(리 포함)'일 때만 교체 — 덮어써서 정보가 줄면 안 된다.
    if (kl?.legalDong && (!legalDong || /리$/.test(kl.legalDong))) {
      legalDong = kl.legalDong;
      if (!buildingName && kl.buildingName) buildingName = kl.buildingName;
    } else if (!legalDong && /(대로|로|길)\s*\d/.test(finalRoadAddr)) {
      // ② Kakao도 못 찾으면 전국 주소DB 재조회(캐시로 1회만 — 부정 캐시가 재난타를 막는다)
      const sggPfx = extractSigungu(cityLabel) || (cityLabel || '').trim().split(/\s+/).pop() || '';
      const probe  = await lookupAddr(`${sggPfx ? `${sggPfx} ` : ''}${finalRoadAddr}`.trim(), cityLabel);
      const probed = String(probe?.legalDong || probe?.emdNm || '').trim();
      if (probed) {
        legalDong = probed;
        if (!buildingName && probe?.bdNm) buildingName = probe.bdNm;
      }
    }
  }
  // ③ 그래도 없으면 지번주소 자체에서 법정동을 취한다 — 지번주소의 동/리는 정의상 법정동이므로
  //    API 없이도 확정할 수 있다(예 "장곡동 344"→장곡동, "상봉동 126-39"→상봉동).
  //    Kakao·주소DB에 미등재된 번지에서도 법정동이 빠지지 않게 하는 최종 방어선.
  if (!legalDong) {
    const jibunTok = String(finalRoadAddr || '').trim().match(/^([가-힣][가-힣\d]*(?:동|리|가))\s+산?\s*\d/);
    const tok = jibunTok?.[1] ? jibunTok[1].replace(/^([가-힣]+)\d+(동)$/, '$1$2') : '';
    if (tok && LEGAL_DONG_RE.test(tok)) legalDong = tok;
  }

  // 법정동을 얻었으면 괄호 동명은 무조건 법정동으로 교체(행정동 폴백값이 남아 있어도 덮어쓴다)
  if (legalDong && LEGAL_DONG_RE.test(legalDong)) {
    dongPart = legalDong.replace(/^([가-힣]+)\d+(동)$/, '$1$2');
  }

  // ── A-11: 최종 주소 형식 조합 ─────────────────────────────────────
  // 표준: "도로명주소(건물번호까지), (법정동, 건물명) 상세주소"
  // 도로명주소 바로 뒤 첫 구분자는 ","를 유지한다.
  // 이후 추가 구분이 필요하면 "/"를 쓰고, 괄호 내부의 법정동·건물명 구분 콤마는 예외로 유지한다.
  // 명단에 적힌 상세/부가 내용은 삭제하지 않고 finalDetail 또는 특이사항으로 보존한다.
  const parenParts  = [dongPart, buildingName].filter(Boolean);
  const parenInner  = parenParts.join(', ').replace(/,\s*$/, '').trim();
  const parenStr    = parenInner ? `(${parenInner})` : '';

  // A-11 형식: "도로명주소, 상세주소 (법정동, 건물명)" (상세 먼저, 괄호 마지막)
  result.주소 = finalRoadAddr || '';
  if (finalDetail) {
    // 도로명 뒤 첫 구분자는 쉼표 (A-11). 상세주소를 쉼표로 붙임.
    result.주소 += result.주소 ? `${ROAD_DETAIL_SEPARATOR}${finalDetail}` : finalDetail;
    if (parenStr) result.주소 += ` ${parenStr}`;          // 상세 뒤 공백 + (법정동, 건물명)
  } else if (parenStr) {
    // 상세 없으면 "도로명, (법정동, 건물명)"
    result.주소 += result.주소 ? `${ROAD_DETAIL_SEPARATOR}${parenStr}` : parenStr;
  }

  // ── 3분할 주소 노출 (기본명단 3컬럼 저장·도로명주소 비교용) ─────────
  // 도로명주소(콤마 앞) / 상세주소(동호수) / 괄호정보(법정동, 건물명). 표시 함수 parseDisplayedAddress 와 동일 분할.
  result.도로명주소 = finalRoadAddr || '';
  result.상세주소   = finalDetail || '';
  result.괄호정보   = parenInner || '';   // "법정동, 건물명" (괄호 기호 제외 내부 텍스트)

  // ── A-12 ③: 변환 후 주소 3자 미만 플래그 ────────────────────────
  if (result.주소.length < 3) {
    result.확인필요 = true;
    result.확인사유 = '변환 후 주소 비정상';
  }

  // ── A-22: 특이사항에 주민센터류 표현이 있으면 맨 뒤에 참고주소 붙이기 ──
  // 단, 주소 자체가 이미 주민센터 주소인 경우(CENTER_RE) 중복 방지
  if (normalizedInputNote && CENTER_RE.test(normalizedInputNote) && result.주소 && !CENTER_RE.test(text)) {
    const referenceDong = (adminDong || dongPart || '').trim();
    // A-13/A-22: 주민센터 검색어에 지자체(시군구) 접두어 강제 — 전국 동명(예: 시흥시 군자동 vs 서울 군자동) 오매칭 방지
    const districtPfx = (extractSigungu(cityLabel) || (cityLabel || '').trim().split(/\s+/).pop() || '').trim();
    const ckw = referenceDong
      ? `${districtPfx ? `${districtPfx} ` : ''}${referenceDong} 주민센터`
      : generateCenterKeyword(normalizedInputNote, adminDong, cityLabel);
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
          cres = await lookupAddr(kd.road_address_name, cityLabel)
            || (kakaoDocInMunicipality(kd, cityLabel) ? kakaoDocToApiResult(kd) : null);
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

  // ── 지역 가드: 타지역 도로명 충돌 매칭 폐기 (예: 홍성 "문화로" → 인천 "부평문화로") ──
  // matchedSigungu가 비어도 standardRoadAddress/jibunAddr에서 시군구를 추출해 입력 지자체와 대조.
  // 다르면 매칭 자체를 폐기 → 타지역 좌표·법정동·리가 붙는 것을 원천 차단. 절대 되돌리지 말 것.
  let crossRegionRejected = false;
  if (apiResult && extractSigungu(cityLabel)) {
    // 실제 매칭된 주소 텍스트(standardRoadAddress/jibun)의 시군구를 '우선' 신뢰.
    // matchedSigungu/sggNm은 입력 지자체로 잘못 채워질 수 있어 후순위.
    const refAddr = apiResult.standardRoadAddress || apiResult.roadAddr || apiResult.jibunAddr || '';
    const mSido = extractSido(refAddr) || apiResult.matchedSido || apiResult.siNm || '';
    const mSgg  = extractSigungu(refAddr) || apiResult.matchedSigungu || apiResult.sggNm || '';
    const region = getMunicipalityMatch(cityLabel, mSido, mSgg);
    if (region.comparable && !region.ok) {
      apiResult = null;
      crossRegionRejected = true;
      legalDong = '';   // A-31: 폐기된 타지역 매칭의 법정동은 쓰지 않는다
    }
  }

  // ── 좌표 취득 (Kakao Geocoding) ──────────────────────────────────
  result.isApt = apiResult?.bdKdcd === '1';
  result.standardRoadAddress = apiResult?.standardRoadAddress || apiResult?.roadAddr || '';
  result.roadName = apiResult?.roadName || apiResult?.rn || '';
  result.buildingMainNo = apiResult?.buildingMainNo ?? apiResult?.buldMnnm ?? '';
  result.buildingSubNo = apiResult?.buildingSubNo ?? apiResult?.buldSlno ?? '';
  // A-31: 괄호에 실제로 표시된 건물명을 컬럼에도 그대로 넣는다. 예전엔 API(bdNm)에서 온 값만
  // 담아서, 입력 문장에서 뽑힌 건물명(래미안크레시티 등)은 괄호엔 보이는데 컬럼은 비어 있었다.
  result.buildingName = buildingName || apiResult?.buildingName || apiResult?.bdNm || '';
  // 학습 건물명 별칭 적용 (Phase 4) — 승인된 별칭을 표준 건물명으로 치환(완전일치만).
  if (result.buildingName) {
    // 완전일치 우선 → 정규화 완전일치 폴백(D). 미일치 시 원본 보존.
    result.buildingName = applyVariant(result.buildingName, buildingAliasDict, buildingAliasVariantIndex);
  }
  // A-31: 보강조회까지 반영된 법정동. 한글 키(법정동)로도 노출 — 그리드·엑셀·DB 컬럼이 그대로 쓴다.
  result.legalDong = legalDong || apiResult?.legalDong || apiResult?.emdNm || '';
  result.법정동 = result.legalDong;
  // A-31: 읍/면 법정동은 "홍북읍 신경리" 형태로 오므로 리(里)를 여기서 먼저 확보해 둔다
  // (아래 기존 리 추출이 비었을 때만 쓰이도록 변수로만 보관).
  const legalRiFromDong = (result.legalDong.match(/\s([가-힣]{2,5}리)$/) || [])[1] || '';
  // 리(里): 읍/면 법정리 — 기사 배정 리 단위 매칭용. API liNm 우선, 없으면 지번주소(도로명 없음)에서 "OO리" 추출.
  result.리 = (apiResult?.liNm || apiResult?.legalRi || '').trim();
  // 지번주소(jibunAddr)에서 OO리 추출 — 도로명주소여도 지번주소엔 리가 포함됨(읍/면). 가장 확실한 소스.
  if (!result.리 && apiResult?.jibunAddr) {
    const m = String(apiResult.jibunAddr).match(/([가-힣]{2,5}리)(?=\s|\d|,|$)/);
    if (m) result.리 = m[1];
  }
  // 입력 지번주소(도로명 없음) 폴백 — 읍/면 다음의 OO리(산번지·번지없음 포함) 우선, 그다음 리+(산)번지.
  // '거리/처리/우리' 등 오탐 방지: ①읍/면 토큰 직후 리만, 또는 ②리 뒤 (산)숫자 동반일 때만.
  if (!result.리 && !/(대로|로|길)\s*\d/.test(inputAddr || '')) {
    const ia = inputAddr || '';
    const liMatch = ia.match(/(?:읍|면)\s*([가-힣]{2,4}리)(?=\s|\d|산|,|$)/)
                 || ia.match(/([가-힣]{2,4}리)\s*(?:산\s*)?\d/);
    // '거리/우리/머리/다리' 등 리로 끝나는 비(非)법정리 단어 오탐 제외
    const RI_FALSE = /(거리|우리|머리|다리|항아리|보따리|마무리|소쿠리|자리|무리|꼬리|뿌리)$/;
    if (liMatch && !RI_FALSE.test(liMatch[1])) result.리 = liMatch[1];
  }
  // 도로명 폴백 — 읍/면 지역 도로명은 보통 '법정리+번호+길' 형태(예: 신덕리1길 → 신덕리).
  // API가 리를 안 주고 지번도 없을 때, 도로명 앞부분의 'OO리'를 법정리로 사용. 동(洞) 지역은 제외(오탐 방지).
  if (!result.리) {
    const ctx = `${adminDong || ''} ${inputAddr || ''} ${result.legalDong || ''}`;
    if (/(읍|면)/.test(ctx)) {
      const rm = String(inputAddr || '').match(/([가-힣]{2,4}리)\s*\d/);  // 신덕리1길 → 신덕리
      const RI_FALSE2 = /(거리|우리|머리|다리|항아리|보따리|마무리|소쿠리|자리|무리|꼬리|뿌리)$/;
      if (rm && !RI_FALSE2.test(rm[1])) result.리 = rm[1];
    }
  }
  // A-31: 위 경로들이 모두 비면 법정동("홍북읍 신경리")에서 뽑아 둔 리를 쓴다 — 리 빠짐 방지
  if (!result.리 && legalRiFromDong) result.리 = legalRiFromDong;
  result.matchedSido = apiResult?.matchedSido || apiResult?.siNm || '';
  result.matchedSigungu = apiResult?.matchedSigungu || apiResult?.sggNm || '';
  result.detailAddress = finalDetail || '';
  result.addressMgtNo = apiResult?._addressMgtNo || '';
  result.buildingMgtNo = apiResult?.bdMgtSn || '';
  result.matchSource = apiResult?._matchSource || (apiResult ? 'juso_fallback' : '');
  result.matchConfidence = apiResult?._matchConfidence || null;
  result.routeHints = apiResult?._routeHints || null;
  appendCheckReason(result, getAreaIssue(cityLabel, adminDong, result.matchedSido, result.matchedSigungu, result.legalDong));
  if (crossRegionRejected) appendCheckReason(result, '타지역 오매칭 폐기: 도로명이 타 시군구와 충돌 — 지자체 확인 필요');
  if (apiResult?.jibunAddr && !result.standardRoadAddress) {
    appendCheckReason(result, `지번주소만 확인됨: ${apiResult.jibunAddr}`);
  } else if (!apiResult && text && !result.확인필요) {
    // A-12: 도로명(로/길/대로+번호)이 멀쩡히 파싱됐으면 DB 일시 미확인이어도 확인명단에 넣지 않는다(오탐 방지).
    // 타지역(관할 밖) 판별은 엔진이 단정하지 않고, 비교기능(base_lists 법정동↔법정동)이 담당 → CL-4 주민센터배송.
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
    const road = apiResult?.roadAddr || result.주소;
    // 아파트 동(棟)별 정밀좌표 우선 — 원주소/정제주소/특이사항에서 숫자 동번호를 찾으면 dong-coords 시도.
    // 동 단위 매칭 실패 시 아래 기존 좌표(단지 대표좌표)로 폴백.
    let coord = null;
    const sigungu = cityPrefix || (cityLabel || '').trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '';
    const dongNo = parseAptDong([inputAddr, result.주소, inputNote].filter(Boolean).join(' '));
    if (dongNo) coord = await fetchDongCoord(road, dongNo, sigungu);
    if (!coord) coord = await fetchKakaoCoord(road, cityPrefix, result.buildingMgtNo);
    if (coord) { result.lat = coord.lat; result.lng = coord.lng; }
  }

  // ── #5-A: 특이사항 정규화 재적용 (승인된 note_normalize_dict, 완전일치만·주소 무개입) ──
  result.특이사항 = applyNoteNormalize(result.특이사항, noteNormalizeDict, noteNormalizeVariantIndex);

  return result;
};
