// ══════════════════════════════════════════════════════════════════
//  공용 정렬 — CLAUDE.md §6 기본 정렬 규칙 (모든 리스트·내보내기 파일 공통)
//  순서: 행정동(읍면동) → 리(里) → 주소(도로 주행순) → 이름
//  모두 오름차순, 한국어 numeric (숫자 자연 정렬). 리 없으면 빈값으로 자연 통과.
// ══════════════════════════════════════════════════════════════════
const cmp = (a, b) =>
  String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true, sensitivity: 'base' });

// ══════════════════════════════════════════════════════════════════
//  도로명 주소 순 정렬 (형 지시 2026-08-06) — 회귀 scripts/road-address-sort.test.mjs
//  ★도로명은 문자열, 건물번호(본번·부번)는 숫자로 비교한다.
//    주소 전체를 문자열로만 비교하면 "황물로10길"이 "황물로7길"보다 앞서
//    도로를 거슬러 올라가게 된다(V6.85 표시순번과 같은 함정).
//  실측 근거(권선구 2026-07 공유본): 뒤섞인 배송순번 대비 도로명순 정렬만으로
//    박진성 56.6km→8.8km · 이진만 78.0km→2.9km · 배영진 20.8km→1.9km.
//
//  ★가지도로 분기 정렬 (형 현장 지시 2026-08-11)
//    "실제로 삼작로를 주행하면 삼작로 258 보다 삼작로256번길이 먼저 나온다."
//    가지도로(N번길)는 모도로의 건물번호 N 지점에서 갈라진다. 따라서 도로명을 문자열로
//    묶으면(삼작로 전체 → 삼작로256번길 전체) 256 지점을 지나쳐 267까지 갔다가
//    되돌아오는 역주행이 된다. → 가지도로를 모도로 번호축의 N 자리에 끼워 넣는다.
//
//    ※'N번길'과 'N길'은 다르다:
//      · N번길 = 기초번호 방식. 숫자가 곧 모도로 건물번호 → 즉시 끼워 넣을 수 있다.
//      · N길   = 일련번호 방식일 수 있다(서울 등 1길·2길·3길…). 숫자를 건물번호로 쓰면
//                엉뚱한 자리에 꽂히므로, 실제 분기 건물번호를 담은 branchIndex를 받았을
//                때만 끼워 넣고 없으면 현행(모도로 뒤 별도 그룹)을 유지한다.
//    branchIndex 형식: { '사가정로2길': 40 }  ← 사가정로 40번 건물 앞에서 갈라짐
// ══════════════════════════════════════════════════════════════════
const ROAD_RE = /([가-힣A-Za-z0-9]+(?:대로|로|길|가))\s*(\d+)(?:\s*-\s*(\d+))?/;
// 도로명이 없는 주소(지번·주민센터 등)는 정렬 맨 뒤로 — 중간에 끼면 동선이 끊긴다.
const NO_ROAD_KEY = '힣힣';
// 가지도로: 모도로(…로/…대로) + 숫자 + (번|가)? + 길
const BRANCH_RE = /^(.+?(?:대로|로))(\d+)(번|가)?길$/;

// 도로명 문자열 → 모도로·분기번호. 끼워 넣을 근거가 없으면 null(=가지도로로 취급하지 않음).
const resolveBranch = (road, branchIndex) => {
  const m = road.match(BRANCH_RE);
  if (!m) return null;
  const [, parentRoad, digits, kind] = m;
  // 분기표(주소DB 조회 결과)가 있으면 그것이 진실 — N번길·N길 모두 여기서 확정된다.
  const known = branchIndex ? Number(branchIndex[road]) : NaN;
  if (Number.isFinite(known)) return { parentRoad, branchNo: known, isBranch: 1 };
  // 표가 없으면 기초번호가 확실한 'N번길'만 끼워 넣는다.
  if (kind === '번') return { parentRoad, branchNo: parseInt(digits, 10) || 0, isBranch: 1 };
  return null;
};

export const parseRoadAddress = (addr, branchIndex = null) => {
  const m = String(addr || '').match(ROAD_RE);
  if (!m) {
    return {
      road: '', num: Number.MAX_SAFE_INTEGER, sub: 0,
      parentRoad: '', branchNo: Number.MAX_SAFE_INTEGER, isBranch: 0,
    };
  }
  const road = m[1];
  const num = parseInt(m[2], 10) || 0;
  const sub = parseInt(m[3], 10) || 0;
  const branch = resolveBranch(road, branchIndex);
  // 모도로 본번은 자기 번호가 곧 분기위치 — 가지도로와 같은 번호축에서 비교된다.
  return branch
    ? { road, num, sub, ...branch }
    : { road, num, sub, parentRoad: road, branchNo: num, isBranch: 0 };
};

// 주소 두 개를 도로 주행순으로 비교 — 모도로 → 분기번호 → 모도로 본번 우선 → 본번 → 부번 → 상세
const compareRoadAddr = (addrA, addrB, branchIndex) => {
  const ra = parseRoadAddress(addrA, branchIndex);
  const rb = parseRoadAddress(addrB, branchIndex);
  return cmp(ra.parentRoad || NO_ROAD_KEY, rb.parentRoad || NO_ROAD_KEY)
    || (ra.branchNo - rb.branchNo)
    || (ra.isBranch - rb.isBranch)   // 같은 번호면 큰길 건물 먼저, 그다음 골목으로 들어간다
    || (ra.num - rb.num)
    || (ra.sub - rb.sub)
    || cmp(addrA, addrB);            // 동·호수 등 상세는 자연 정렬
};

// ── 배송 기본 정렬(행정동→리→주소→이름) ─────────────────────────────
export const makeDeliveryCompare = (branchIndex = null) => (a, b) =>
  cmp(a?.행정동, b?.행정동)
  || cmp(a?.리, b?.리)
  || compareRoadAddr(a?.주소, b?.주소, branchIndex)
  || cmp(a?.이름, b?.이름);

// .sort() 콜백으로 재사용(중복 제거 일원화)
export const deliveryCompare = makeDeliveryCompare();

// 배송 기본 정렬: 원본 배열을 변형하지 않고 정렬된 새 배열 반환 (불변)
export function sortByDeliveryOrder(records, { branchIndex = null } = {}) {
  return [...(records || [])].sort(branchIndex ? makeDeliveryCompare(branchIndex) : deliveryCompare);
}

// ── 도로명 주소순 정렬(행정동→주소→이름) ────────────────────────────
export const makeRoadAddressCompare = (branchIndex = null) => (a, b) =>
  cmp(a?.행정동, b?.행정동)
  || compareRoadAddr(a?.주소, b?.주소, branchIndex)
  || cmp(a?.이름, b?.이름);

export const roadAddressCompare = makeRoadAddressCompare();

// 도로명 주소순 정렬: 원본 배열을 변형하지 않고 정렬된 새 배열 반환 (불변)
export function sortByRoadAddress(records, { branchIndex = null } = {}) {
  return [...(records || [])].sort(branchIndex ? makeRoadAddressCompare(branchIndex) : roadAddressCompare);
}
