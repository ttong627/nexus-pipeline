// ══════════════════════════════════════════════════════════════════
//  공용 정렬 — CLAUDE.md §6 기본 정렬 규칙 (모든 리스트·내보내기 파일 공통)
//  순서: 행정동(읍면동) → 리(里) → 주소(도로명) → 이름
//  모두 오름차순, 한국어 numeric (숫자 자연 정렬). 리 없으면 빈값으로 자연 통과.
// ══════════════════════════════════════════════════════════════════
const cmp = (a, b) =>
  String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true, sensitivity: 'base' });

// 배송 기본 정렬 비교자 — 행정동→리→주소→이름. .sort() 콜백으로 재사용(중복 제거 일원화)
export const deliveryCompare = (a, b) =>
  cmp(a?.행정동, b?.행정동)
  || cmp(a?.리, b?.리)
  || cmp(a?.주소, b?.주소)
  || cmp(a?.이름, b?.이름);

// 배송 기본 정렬: 원본 배열을 변형하지 않고 정렬된 새 배열 반환 (불변)
export function sortByDeliveryOrder(records) {
  return [...(records || [])].sort(deliveryCompare);
}

// ══════════════════════════════════════════════════════════════════
//  도로명 주소 순 정렬 (형 지시 2026-08-06) — 회귀 scripts/road-address-sort.test.mjs
//  ★도로명은 문자열, 건물번호(본번·부번)는 숫자로 비교한다.
//    주소 전체를 문자열로만 비교하면 "황물로10길"이 "황물로7길"보다 앞서
//    도로를 거슬러 올라가게 된다(V6.85 표시순번과 같은 함정).
//  실측 근거(권선구 2026-07 공유본): 뒤섞인 배송순번 대비 도로명순 정렬만으로
//    박진성 56.6km→8.8km · 이진만 78.0km→2.9km · 배영진 20.8km→1.9km.
// ══════════════════════════════════════════════════════════════════
const ROAD_RE = /([가-힣A-Za-z0-9]+(?:대로|로|길|가))\s*(\d+)(?:\s*-\s*(\d+))?/;
// 도로명이 없는 주소(지번·주민센터 등)는 정렬 맨 뒤로 — 중간에 끼면 동선이 끊긴다.
const NO_ROAD_KEY = '힣힣';

export const parseRoadAddress = (addr) => {
  const m = String(addr || '').match(ROAD_RE);
  if (!m) return { road: '', num: Number.MAX_SAFE_INTEGER, sub: 0 };
  return { road: m[1], num: parseInt(m[2], 10) || 0, sub: parseInt(m[3], 10) || 0 };
};

// 도로명 주소순 비교자 — 행정동 → 도로명 → 본번 → 부번 → 상세(동·호) → 이름
export const roadAddressCompare = (a, b) => {
  const ra = parseRoadAddress(a?.주소);
  const rb = parseRoadAddress(b?.주소);
  return cmp(a?.행정동, b?.행정동)
    || cmp(ra.road || NO_ROAD_KEY, rb.road || NO_ROAD_KEY)
    || (ra.num - rb.num)
    || (ra.sub - rb.sub)
    || cmp(a?.주소, b?.주소)
    || cmp(a?.이름, b?.이름);
};

// 도로명 주소순 정렬: 원본 배열을 변형하지 않고 정렬된 새 배열 반환 (불변)
export function sortByRoadAddress(records) {
  return [...(records || [])].sort(roadAddressCompare);
}
