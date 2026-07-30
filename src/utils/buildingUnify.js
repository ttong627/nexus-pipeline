// @ts-check
// ══════════════════════════════════════════════════════════════════
//  P1 건물명 통일 — 순수함수 (형 지시 2026-07-30)
// ══════════════════════════════════════════════════════════════════
// 배경(전수 실측 88,463건): 같은 건물(건물관리번호·DB 정본 동일)인데 괄호 표기가 갈린 그룹 73개/318건.
//   원인 ①비건물명 값이 건물명 자리에(`5층 식당보관`·`8652`) ②법정동 유/무 차이
//        ③건물명 별칭·오타(화인빌↔파인빌·유희주택↔숭의유희주택)
// 형 방침(엄수):
//   · **빈 건물명으로 통일 금지** — 건물명을 지우는 방향은 정보 삭제다
//   · DB 정본이 있으면 무조건 그것. 없으면 **압도적 최다 표기만**(동률·근소차는 보류)
//   · 괄호에서 빠지는 비건물명 값은 **특이사항으로 이관**(삭제 금지)
//   · 상세주소(동·호수)·A-22 참고블록·건물명 속 괄호는 보존

import {
  parseDisplayedAddress,
  splitParenInner,
  balanceParens,
  protectParenBlocks,
  cleanAddressPiece,
} from './addressFormat.js';

/** 최다 표기 채택 최소 점유율 — 근소차 통일을 막는 안전판 */
const MIN_MAJORITY_SHARE = 0.7;

/** A-22 참고주소 블록 — 통째로 보존해야 하는 원문 */
const REF_BLOCK_RE = /\[참고:[^\]]*\]/g;

/** 중복 판정용 비교키 — 공백·괄호·기호 제거(`DH(디에이치)빌딩` ⊇ `DH디에이치`) */
const cmpKey = (v) => String(v || '').replace(/[\s()[\]·,./\\-]/g, '');

// A-9 특수문자 잔재(◆★☆*|~#§※) — 이런 표기를 정답으로 삼으면 오염이 그룹 전체로 번진다.
const DIRTY_MARK_RE = /[◆★☆*|~#§※]/;

// 건물 '용도명'(이름이 아님) — DB가 고유명 대신 용도만 주는 경우가 있다.
// 이걸 정답으로 쓰면 실제 이름('영신빌라')을 용도명('다세대주택')으로 덮어써 정보가 열화된다.
const GENERIC_USE_RE = /^(다세대주택|단독주택|공동주택|연립주택|아파트|근린생활시설|제\d종근린생활시설|오피스텔|상가|주택|빌라|건물)$/;

/**
 * 고유명이 아니라 '용도명'인가 — 정답 후보에서 제외한다.
 * @param {string} name
 * @returns {boolean}
 */
export const isGenericUseName = (name) => GENERIC_USE_RE.test(cleanAddressPiece(name));

/**
 * 정답 후보로 쓸 수 있는 건물명인가 — 오염 표기를 정답으로 삼아 그룹에 번지게 하는 것을 막는다.
 * @param {string} name
 * @param {string} legalDong
 * @returns {boolean}
 */
const isCleanCandidate = (name, legalDong) => {
  const v = cleanAddressPiece(name);
  if (!v) return false;
  if (DIRTY_MARK_RE.test(v)) return false;                 // 특수문자 잔재
  if (v.includes(',')) return false;                       // 콤마 = 여러 값이 뭉친 오염
  if (isGenericUseName(v)) return false;                   // 용도명은 고유명이 아니다
  const dong = cleanAddressPiece(legalDong);
  if (dong && cmpKey(v).startsWith(cmpKey(dong)) && cmpKey(v) !== cmpKey(dong)) {
    // '상동대우마이빌'처럼 법정동이 이름 앞에 자연스럽게 붙는 경우는 허용해야 하므로
    // 법정동 '단독 토큰'으로 섞인 경우만 배제한다(예 '상동 상동대우마이빌').
    if (new RegExp(`^${dong}\\s`).test(v)) return false;
  }
  return true;
};

/**
 * 그룹의 정답 건물명을 고른다.
 * @param {{variants?: Array<{name: string, count: number}>|null, dbName?: string|null, legalDong?: string|null, minShare?: number}} input
 * @returns {{canonical: string, source: 'db'|'majority'}|null} 확정 불가면 null(보류 = 원본 보존)
 */
export const pickCanonicalBuilding = ({ variants, dbName, legalDong = '', minShare = MIN_MAJORITY_SHARE } = {}) => {
  const list = (Array.isArray(variants) ? variants : [])
    .map(v => ({ name: cleanAddressPiece(v?.name), count: Number(v?.count) || 0 }));

  // ① DB 정본 최우선 — 단, DB가 고유명 대신 '용도명'(다세대주택 등)을 준 경우는 정답으로 쓰지 않는다.
  //    실제 이름('영신빌라')을 용도명으로 덮어쓰면 정보가 열화된다.
  const dbRaw = cleanAddressPiece(dbName);
  const db = isGenericUseName(dbRaw) ? '' : dbRaw;
  if (db) {
    const allMatch = list.length > 0 && list.every(v => cmpKey(v.name) === cmpKey(db));
    if (allMatch) return null;                          // 이미 전부 정본 = 통일 불필요
    return { canonical: db, source: 'db' };
  }

  // 이하 DB 정본이 없는 경우 — 오염 표기를 정답으로 삼지 않도록 위생 검사를 통과한 것만 후보로 둔다.
  const named = list.filter(v => v.name && isCleanCandidate(v.name, legalDong));
  if (!named.length) return null;                       // 깨끗한 후보가 없다 → 보류(원본 보존)

  // ② 깨끗한 표기가 한 종류면 — 다른 표기(빈값·오염값)를 가진 레코드가 있을 때만 통일 가치가 있다
  const distinct = [...new Set(named.map(v => cmpKey(v.name)))];
  if (distinct.length === 1) {
    const others = list.filter(v => cmpKey(v.name) !== distinct[0]);
    return others.length ? { canonical: named[0].name, source: 'majority' } : null;
  }

  // ③ 비어있지 않은 표기 중 압도적 최다만 채택(동률·근소차는 보류)
  const sorted = [...named].sort((a, b) => b.count - a.count);
  const namedTotal = named.reduce((s, v) => s + v.count, 0);
  if (!namedTotal) return null;
  const top = sorted[0];
  const second = sorted[1];
  if (second && top.count === second.count) return null;                 // 동률 → 보류
  if (top.count / namedTotal < minShare) return null;                    // 근소차 → 보류
  return { canonical: top.name, source: 'majority' };
};

/**
 * 주소의 괄호를 `(법정동, 정답건물명)`으로 재작성한다.
 * 도로명·상세주소·참고블록은 그대로 두고, 괄호에서 빠지는 비건물명 값은 이관 목록으로 돌려준다.
 * @param {unknown} address
 * @param {unknown} legalDong 법정동(필드값 — 정본)
 * @param {unknown} canonical 정답 건물명
 * @returns {{newAddr: string, moved: string[], changed: boolean}}
 */
export const rebuildParen = (address, legalDong, canonical) => {
  const oldAddr = cleanAddressPiece(address);
  if (!oldAddr) return { newAddr: '', moved: [], changed: false };

  const { road, detail, paren } = parseDisplayedAddress(oldAddr);
  if (!road) return { newAddr: oldAddr, moved: [], changed: false };

  const dong = cleanAddressPiece(legalDong);
  const bldg = balanceParens(canonical);
  const bldgKey = cmpKey(bldg);

  // 괄호에서 빠지는 값 중 '의미 있는 원문'만 이관.
  //   오염 주소는 괄호 파싱이 통째로 한 토큰이 될 수 있어, 괄호 블록을 걷어낸 알맹이로 판정한다.
  const stripBlocks = (v) => cleanAddressPiece(protectParenBlocks(v).text.replace(/__P\d+__/g, ' '));
  const moved = [];
  for (const part of splitParenInner(paren)) {
    const core = stripBlocks(part).replace(/[()]/g, '').trim();
    if (!core) continue;
    if (cmpKey(core) === cmpKey(dong)) continue;                 // 법정동 → 제거(중복)
    if (bldgKey && bldgKey.includes(cmpKey(core))) continue;     // 정답 건물명에 포함 → 버림(중복)
    if (core.length < 2) continue;
    moved.push(core);
  }

  const inner = [dong, bldg].filter(Boolean).join(', ');
  let next = road;
  if (detail && inner) next = `${road}, ${detail} (${inner})`;
  else if (detail) next = `${road}, ${detail}`;
  else if (inner) next = `${road}, (${inner})`;
  next = cleanAddressPiece(next);

  return { newAddr: next, moved, changed: next !== oldAddr };
};

/** A-22 참고블록 정규식 재사용(백필 스크립트용) */
export const REF_BLOCK_PATTERN = REF_BLOCK_RE;
