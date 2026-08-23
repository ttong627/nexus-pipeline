// ══════════════════════════════════════════════════════════════════
//  상세주소·도로명 텍스트 정규화 — 순수 유닛 (A-17·18·19·23 잔여)
//  addressEngine에서 분리한 클라·서버 공용 SSOT (P7 Phase2 ⓑ-2).
//  서버 Docker 빌드 컨텍스트(`COPY src ./src`)에 포함돼, 다음 세션
//  `/v1/address/purify`가 클라 processAddress와 동일한 규격화를 공용한다.
//  회귀 감시 = scripts/address-golden.test.mjs(offline) + road-regex-parity.
// ══════════════════════════════════════════════════════════════════
import { HANGUL, BRANCH_SUFFIX, ROAD_NAME_SOURCE, ROAD_NUMBER_TAIL, joinSpacedBranchRoad } from './roadTokens.js';
import { DONG_DASH_HO_SRC } from './dongHoFormat.js';
import { TRANSLIT_DONG_UNIT_SRC } from './dongTokens.js';

// ※ 선행 구분자 캡처는 클라만 필요하다(문장 중간에서 도로명을 찾으므로). 서버는 정제된 질의를 받는다.
export const ROAD_ADDRESS_RE = new RegExp(`(^|[\\s,/\\(])(${ROAD_NAME_SOURCE})${ROAD_NUMBER_TAIL}`, 'u');
// A-23: 베이스 도로명이 로·대로·길로 끝나는 경우 모두 처리 — "홍양길 43번길" → "홍양길43번길"
// (길=길 추가. 누락 시 파서가 "홍양길"에서 끊겨 "번길 40-25"가 괄호로 오분류됨)
const ROAD_BRANCH_SPACE_RE = new RegExp(`([${HANGUL}A-Za-z]+(?:\\uB300\\uB85C|\\uB85C|\\uAE38))\\s+(\\d+[${HANGUL}0-9]*${BRANCH_SUFFIX})`, 'gu');
// A-23 보강(2026-08-12): 숫자와 가지접미사 사이 공백("봉우재로 36 번길")은 **공용 SSOT**가 처리한다
//   → `roadTokens.js` `joinSpacedBranchRoad` (근거·퇴행 경고는 거기 주석에 있다).
//   여기서 또 정의하지 말 것 — `normalize.js` 와 갈라진다.
const ROAD_NUMBER_SPACE_RE = new RegExp(`([${HANGUL}A-Za-z0-9]+(?:\\uB300\\uB85C|\\uB85C|\\uAE38))\\s{2,}(\\d{1,5})(?![${HANGUL}A-Za-z0-9])`, 'gu');
// A-31: `숫자+동/층/호` 뒤에 한글이 바로 붙으면(장안2동주민센터·신내1동우편취급국) 동호수가 아니라
// 건물명의 일부다. 가드가 없어 "장안2동주민센터"가 "장안"+"2동주민센터"로 쪼개져 상세주소가
// 오염되고 건물명 매칭이 깨졌다. DONG_UNIT_SRC(동 토큰) 규칙 자체는 그대로 둔다(A-10).
// 동(棟) 단위 토큰 — 상세주소(동호수)의 일부. 숫자동(101동)·대시동(1-1동)·영문동(B동)·단일한글동(가동~하동).
// 뒤에 공백/숫자/호/콤마/끝이 와야 매칭(건물명 중간의 '하동' 등 오절단 방지). 건물명으로 새는 버그 차단.
// A-37(2026-08-23): 한글 음역 영문동(에이동·비동·씨동·에이치동 …)도 동(棟) 토큰이다 — 빠져 있어 `[가-힣]+동`
//   (법정동 모양)으로 흘러가 괄호·특이사항으로 새거나 삭제됐다. 등급(strict/ambiguous)·앞글자 가드는 dongTokens.js(SSOT).
const DONG_UNIT_SRC = `(?:(?:\\d+(?:-\\d+)?|[A-Za-z]+|[가나다라마바사아자차카타파하])\\uB3D9(?=\\s|\\d|\\uD638|,|$)|${TRANSLIT_DONG_UNIT_SRC})`;
// A-10 ③(형 지시 2026-07-30): 동 대신 대시로 쓰인 숫자 동(101-203호)도 상세주소(동호수)로 인식한다.
//   없으면 "101-"이 건물명 슬롯으로 새어 동 번호가 소실된다(실측 확인). 자리수 가드는 dongHoFormat.js 참조.
const DETAIL_START_RE = new RegExp(`^(?:\\uC9C0\\uD558|\\uC9C0\\uCE35|\\uC625\\uD0D1|${DONG_UNIT_SRC}|${DONG_DASH_HO_SRC}|\\d+\\s*(?:\\uB3D9|\\uCE35|\\uD638)(?![\\uAC00-\\uD7A3])|[A-Za-z]?\\d+\\s*\\uD638)`, 'u');
const DETAIL_MARKER_RE = new RegExp(`__P\\d+__|\\uC9C0\\uD558|\\uC9C0\\uCE35|\\uC625\\uD0D1|${DONG_UNIT_SRC}|${DONG_DASH_HO_SRC}|\\d+\\s*(?:\\uB3D9|\\uCE35|\\uD638)(?![\\uAC00-\\uD7A3])|[A-Za-z]?\\d+\\s*\\uD638`, 'u');
// 주소칸에 섞인 전화번호 패턴(지역번호 0XX 또는 휴대폰 01X) — 건물명/상세 오염 차단용. 한국 지번·건물번호는 0으로 시작 안 함.
export const PHONE_IN_ADDR_RE = /(?:0\d{1,2}|01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/;

export const normalizeRoadAddressSpacing = (value) =>
  // ★붙어 있는 형태(`36번길`)를 먼저 처리하고, 그다음 숫자–접미사가 떨어진 형태(`36 번길`)를 붙인다.
  joinSpacedBranchRoad(String(value || '').replace(ROAD_BRANCH_SPACE_RE, '$1$2'))
    .replace(ROAD_NUMBER_SPACE_RE, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

export const stripAddressDelimiters = (value) => String(value || '').replace(/^[\s,;:：；ㆍ·/\\|]+|[\s,;:：；ㆍ·/\\|]+$/g, '').trim();
export const normalizeAddressDetail = (value) =>
  stripAddressDelimiters(String(value || '')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' '));

// 상세주소에 동일 호/동 토큰이 두 번 들어간 원본 오타만 1개로 정리.
// "201호, 201호"·"201호 201호"·"1층102호,1층102호" → 1개. 서로 다른 토큰(101동 502호)은 보존.
const _DETAIL_DUP_RE = /([0-9A-Za-z가-힣-]+[호동])\s*,?\s*\1(?![0-9A-Za-z가-힣])/gi;
export const dedupeDetailTokens = (detail) => {
  let res = String(detail || '');
  let prev;
  do { prev = res; res = res.replace(_DETAIL_DUP_RE, '$1'); } while (prev !== res);
  return res;
};

export const appendUniqueNote = (base, note) => {
  const cleanNote = String(note || '').trim();
  if (!cleanNote) return base || '';
  const cleanBase = String(base || '').trim();
  if (cleanBase.includes(cleanNote)) return cleanBase;
  return [cleanBase, cleanNote].filter(Boolean).join(' ').trim();
};

export const splitInlineBuildingTail = (tail) => {
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
