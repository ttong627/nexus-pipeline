// @ts-check
// ══════════════════════════════════════════════════════════════════
//  P1-b 괄호 정화 — 순수함수 (형 지시 2026-07-30)
// ══════════════════════════════════════════════════════════════════
// 괄호 `()` 는 (법정동, 건물명)만 담는다(A-11/A-29). 실측 274건은 여기에 배송힌트
// (`5층 식당보관`)·숫자코드(`8652`)·잔재(`E (장안동)`)가 섞여 같은 건물의 표기가 갈렸다.
// DB에 건물명이 없어 정답을 못 정하는 경우에도, 잡값만 걷어내면 표기가 통일된다.
//
// 형 방침(엄수):
//   · 원문 삭제 금지 — 걷어낸 값은 특이사항으로 **이관**
//   · 건물명 후보는 절대 제거 금지
//   · 판단 불가(건물명 후보 2개 이상·법정동 미확정)면 **보류**(원본 보존)
//   · 오판이 정상 주소를 훼손하므로, 비법정동 값이 **하나뿐이면 손대지 않는다**

import { splitParenInner, protectParenBlocks, cleanAddressPiece } from './addressFormat.js';

/** 이관할 가치가 있는 값인가 — 1글자 파편(E)·빈값은 버린다 */
const isMeaningful = (v) => cleanAddressPiece(v).length >= 2;

const cmpKey = (v) => String(v || '').replace(/[\s()[\]·,./\\-]/g, '');

/** 괄호 블록을 걷어낸 알맹이 — `E (장안동)` → `E`, `8652 (신설동)` → `8652` */
const core = (v) => cleanAddressPiece(protectParenBlocks(v).text.replace(/__P\d+__/g, ' '));

/**
 * 건물명일 수 없는 명백한 잡값인가 — 알맹이가 비었거나, 순수 숫자거나, 1글자 파편.
 * (건물명 판단은 보수적으로: 애매하면 잡값이 아니라고 본다 = 원본 보존)
 * @param {string} v
 * @returns {boolean}
 */
const isObviousJunk = (v) => {
  const c = core(v).replace(/[()]/g, '').trim();
  if (!c) return true;
  if (/^\d+$/.test(c)) return true;
  return c.length < 2;
};

// 배송힌트 키워드 — 괄호가 아니라 특이사항에 있어야 할 내용
const HINT_KW = /(층|보관|계단|위집|아랫집|옆집|뒤편|앞집|입구|주차|경비|현관|엘리베이터|승강기|식당|가게|점포|상가동|사무실|공장|창고|부재|경로당|센터경유)/;
// A-9 특수문자 잔재
const DIRTY_MARK_RE = /[◆★☆*|~#§※]/;

/**
 * 괄호에서 빼내야 할 '잡값'인가 — **화이트리스트 방식**(애매하면 잡값 아님 = 보존).
 * 한글 고유명사는 건물명의 일부일 수 있으므로(실측 '보성,유원아파트') 절대 잡값으로 보지 않는다.
 * @param {string} v
 * @returns {boolean}
 */
const isJunkValue = (v) => {
  const raw = cleanAddressPiece(v);
  if (!raw) return true;
  if (DIRTY_MARK_RE.test(raw)) return true;          // ◆ 등 특수문자 잔재
  if (isObviousJunk(raw)) return true;               // 순수 숫자·1글자 파편
  if (HINT_KW.test(raw)) return true;                // 배송힌트
  return false;                                      // 그 외 = 건물명(의 일부)일 수 있다 → 보존
};

/**
 * 괄호 내용을 (법정동, 건물명)으로 정화한다.
 * @param {unknown} paren 괄호 내부 텍스트(기호 제외)
 * @param {unknown} legalDong 법정동(필드값 — 정본)
 * @returns {{building: string, moved: string[], changed: boolean, held: boolean}}
 *   building: 괄호에 남길 건물명('' 이면 법정동만)
 *   moved: 특이사항으로 이관할 값들
 *   changed: 정화가 필요한가
 *   held: 판단 불가로 보류했는가(원본 보존)
 */
export const classifyParenParts = (paren, legalDong) => {
  const none = { building: '', moved: [], changed: false, held: false };
  const dong = cleanAddressPiece(legalDong);
  const parts = splitParenInner(paren);
  if (!parts.length) return none;
  if (!dong) return { ...none, held: true };          // 법정동 미확정 → 보류

  // 법정동과 같은 값은 전부 제거 대상(중복). 나머지가 판정 대상.
  const dupDong = parts.filter(p => cmpKey(p) === cmpKey(dong)).length > 1;
  const others = parts.filter(p => cmpKey(p) !== cmpKey(dong));

  // 비법정동 값이 하나뿐이면 원칙적으로 그것이 건물명이다 — 키워드에 없어도 손대지 않는다(오판 방지).
  // 단 **명백한 잡값**(알맹이가 순수 숫자거나 1글자 파편)이면 건물명일 수 없으므로 걷어낸다.
  if (others.length <= 1) {
    const only = cleanAddressPiece(others[0] || '');
    if (!only) return { building: '', moved: [], changed: dupDong, held: false };
    if (!isObviousJunk(only)) return { building: only, moved: [], changed: dupDong, held: false };
    const c = core(only).replace(/[()]/g, '').trim();
    return { building: '', moved: isMeaningful(c) ? [c] : [], changed: true, held: false };
  }

  // 둘 이상 — **잡값만** 골라낸다(화이트리스트). 잡값이 아닌 한글 고유명사는 건물명의 일부일 수
  // 있으므로(실측: '보성,유원아파트'가 콤마로 쪼개짐) 절대 빼내지 않는다.
  const junk = others.filter(isJunkValue);
  const keep = others.filter(p => !isJunkValue(p));
  if (keep.length > 1) return { ...none, held: true };     // 이름 조각인지 딴 건물인지 모름 → 보류
  if (!junk.length) return { building: cleanAddressPiece(keep[0] || ''), moved: [], changed: dupDong, held: false };

  const building = cleanAddressPiece(keep[0] || '');
  const bKey = cmpKey(building);
  const moved = [];
  for (const p of junk) {
    const c = core(p).replace(/[()]/g, '').trim() || cleanAddressPiece(p).replace(/[()]/g, '').trim();
    if (!c) continue;
    if (bKey && bKey.includes(cmpKey(c))) continue;        // 건물명 조각 → 버림(중복)
    if (cmpKey(c) === cmpKey(dong)) continue;              // 법정동 → 버림
    if (!isMeaningful(c)) continue;                        // 1글자 파편 → 버림
    moved.push(c);
  }
  return { building, moved, changed: true, held: false };
};
