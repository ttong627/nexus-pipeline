// ══════════════════════════════════════════════════════════════════════════
//  특이사항 검증·정제 단일 규칙 (A-33) — 앱·스크립트 공용 SSOT
//
//  형 지시(2026-07-22): "특이사항엔 배송 도움 내용만 남기고, 본명·법정동·건물명은
//  제 컬럼으로 보내라. 단 데이터가 누락되면 안 된다."
//
//  ★ 원칙: 이 함수는 '삭제'가 아니라 '이동'이 기본이다(무손실 M-1).
//    - 본명·법정동·건물명·호수 → 해당 컬럼으로 이동(값 보존)
//    - 삭제는 딱 2가지: ①완전 무의미(기호·숫자반복·한글자) ②주소에 이미 통째로 존재
//    - 판단이 애매하면 무조건 특이사항에 그대로 둔다
//  ★ 호수 규칙(형 지시): 호수는 지우기 전에 반드시 상세주소 컬럼에 먼저 채운다.
// ══════════════════════════════════════════════════════════════════════════
import { TRANSLIT_DONG_ALL_ALT } from '../../services/address-service/src/shared/dongTokens.js';

const S = (v) => String(v ?? '').trim();
const nospace = (v) => S(v).replace(/\s/g, '');

/** 완전 무의미: 기호만 / 같은 숫자 반복(0000·8888) / 의미 없는 한두 글자 */
const SYMBOL_ONLY = /^[^가-힣A-Za-z0-9]+$/;
const REPEAT_DIGIT = /^(\d)\1{1,}$/;
const MEANINGLESS_WORD = /^(나|여|남|무|미|없음|없다|해당없음|없|x|X|-|없슴)$/;
/** 시스템이 만든 안내 문구(사람이 쓴 배송메모가 아님) */
const SYSTEM_NOTE = /^\[주소추정\]/;
/** 건물명 꼬리말 */
const BLD_TAIL = /(아파트|빌라|맨션|타워|하이츠|캐슬|파크|힐스|자이|푸르지오|래미안|편한세상|오피스텔|연립|빌딩|하우스|팰리스|플라자|원룸텔|빌|타운)$/;
/**
 * 특이사항 전체가 '상세주소 성분만'인지 판정한다.
 * ★ 호수가 섞여 있다고 통째로 상세주소로 보내면 안 된다 —
 *   `계단위 201호 정면`은 배송메모지 상세주소가 아니다(회귀 테스트로 고정).
 *   동/호/지하/옥탑 토큰을 모두 걷어내고 남는 글자가 없을 때만 상세주소로 본다.
 */
// A-37: 음역 영문동(에이동·에이치동 …)도 동호 성분 — 빠지면 `에이동 201호`가 '메모'로 남아 상세주소로 승격되지 않는다
const DONG_TOKEN_RE = new RegExp(`(?:${TRANSLIT_DONG_ALL_ALT}|[A-Za-z가-힣])?\\d{0,4}\\s*동`, 'g');
function isDetailOnly(note) {
  const rest = S(note)
    .replace(/지하|지층|반지하|옥탑/g, '')
    .replace(DONG_TOKEN_RE, '')                      // A동 · 가동 · 에이동 · 104동 · 2동
    .replace(/[A-Za-z가-힣]?\d{1,4}(-\d{1,4})?\s*호/g, '')  // 201호 · 104-202호 · 나102호
    .replace(/[A-Za-z0-9\-\s,]/g, '');
  return rest === '' && /\d/.test(nospace(note));
}

/** 특이사항의 `(본명:XXX)` 추출 — 중첩 괄호 `(본명:인순이(김병기))` 대응 */
export function extractRealName(note) {
  const src = S(note);
  const i = src.search(/\(\s*본명\s*[:：]/);
  if (i < 0) return null;
  let depth = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '(') depth++;
    else if (src[k] === ')') { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) end = src.length - 1;
  const realName = S(src.slice(i, end + 1).replace(/^\(\s*본명\s*[:：]\s*/, '').replace(/\)$/, ''));
  const rest = S((src.slice(0, i) + ' ' + src.slice(end + 1)).replace(/\s+/g, ' '));
  return { realName, rest };
}

/**
 * 특이사항 1건을 검증·정제한다. (순수함수 · 부작용 없음)
 *
 * @param {string} note 현재 특이사항
 * @param {object} ctx  { address, detailAddr, buildingName, legalDong, realName, dong, dongDict?:Set }
 * @returns {{note:string, realName?:string, legalDong?:string, buildingName?:string, detailAddr?:string, moved:string[]}}
 *          변경이 필요한 컬럼만 키로 담아 반환. moved = 어떤 규칙이 적용됐는지(감사용).
 */
export function sanitizeNote(note, ctx = {}) {
  const out = { note: S(note), moved: [] };
  if (!out.note) return out;

  const addrNS = nospace(ctx.address);
  const dongDict = ctx.dongDict instanceof Set ? ctx.dongDict : new Set();
  const knownDong = (t) => dongDict.has(t) || t === nospace(ctx.legalDong) || t === nospace(ctx.dong);

  // ① 본명 → 본명 컬럼
  const ex = extractRealName(out.note);
  if (ex && ex.realName) {
    if (!S(ctx.realName)) { out.realName = ex.realName; out.moved.push('본명→본명컬럼'); }
    else out.moved.push('본명중복제거');
    out.note = ex.rest;
  }

  const t = nospace(out.note);
  if (!t) return out;

  // ② 완전 무의미 / 시스템 문구 → 삭제
  if (SYMBOL_ONLY.test(t) || REPEAT_DIGIT.test(t) || MEANINGLESS_WORD.test(out.note) || SYSTEM_NOTE.test(out.note)) {
    out.note = ''; out.moved.push('삭제(무의미)');
    return out;
  }

  // ③ 호수·층 등 상세주소 성분 → 상세주소 컬럼에 먼저 채운 뒤에만 제거 (형 지시)
  if (isDetailOnly(out.note)) {
    const cur = S(ctx.detailAddr);
    if (!cur) { out.detailAddr = out.note; out.note = ''; out.moved.push('호수→상세주소'); return out; }
    if (nospace(cur).includes(t) || (addrNS && addrNS.includes(t))) { out.note = ''; out.moved.push('삭제(상세주소중복)'); return out; }
    return out;   // 상세주소에 다른 값이 있으면 건드리지 않는다(무손실)
  }

  // ④ 법정동 단독 → 법정동 컬럼
  if (/(동|가|읍|면|리)$/.test(t) && knownDong(t)) {
    if (!S(ctx.legalDong)) { out.legalDong = out.note; out.moved.push('법정동→법정동컬럼'); }
    else out.moved.push('삭제(법정동중복)');
    out.note = '';
    return out;
  }

  // ⑤ 건물명 단독 → 건물명 컬럼 (`내동, 성진그린타운` = 법정동,건물명 분해)
  if (BLD_TAIL.test(t) && t.length <= 12) {
    const parts = out.note.split(',').map(S).filter(Boolean);
    if (parts.length === 2 && knownDong(nospace(parts[0]))) {
      if (!S(ctx.legalDong)) out.legalDong = parts[0];
      if (!S(ctx.buildingName)) out.buildingName = parts[1];
    } else if (!S(ctx.buildingName)) {
      out.buildingName = out.note;
    }
    out.moved.push(out.buildingName ? '건물명→건물명컬럼' : '삭제(건물명중복)');
    out.note = '';
    return out;
  }

  // ⑥ 주소 문자열에 이미 통째로 존재 → 중복 삭제 (③④⑤에서 컬럼 보존을 먼저 시도한 뒤)
  if (t.length >= 3 && addrNS && addrNS.includes(t)) {
    out.note = ''; out.moved.push('삭제(주소중복)');
    return out;
  }

  return out;   // 그 외 전부 보존
}

/**
 * 두 특이사항을 합친다(무손실 병합). 중복 문구는 한 번만 남긴다.
 * @returns {string}
 */
export function mergeNotes(a, b) {
  // 비교 키는 공백·기호를 모두 걷어낸다 —
  // `9999#(E V없음)` 과 `9999# (E/V없음)` 은 같은 문구다(실데이터).
  const key = (s) => S(s).replace(/[^가-힣A-Za-z0-9]/g, '');
  const parts = [];
  const push = (tok) => {
    const k = key(tok);
    if (!k) return;
    if (parts.some(p => key(p).includes(k))) return;              // 이미 더 긴 문구가 있음
    for (let i = parts.length - 1; i >= 0; i--) {                 // 새 문구가 기존을 포함 → 교체
      if (k.includes(key(parts[i]))) parts.splice(i, 1);
    }
    parts.push(S(tok));
  };
  for (const chunk of [S(a), S(b)]) {
    if (!chunk) continue;
    chunk.split(/\s{2,}|\n+/).map(S).filter(Boolean).forEach(push);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * 이름 칸에 `홍길동(750315)` 처럼 생년월일이 붙어 오는 지자체(예: 용산구) 대응.
 * 괄호 안이 날짜 형식일 때만 분리한다. (본명·별명 괄호는 건드리지 않는다)
 *
 * @returns {{name:string, birth:string}} birth 는 분리됐을 때만 채워진다.
 */
export function splitNameBirth(rawName) {
  const src = S(rawName).replace(/\n/g, ' ');
  const m = src.match(/^(.*?)\s*[(（]\s*([0-9][0-9.\-/년월일\s]*)\s*[)）]\s*$/);
  if (!m) return { name: src, birth: '' };
  const name = S(m[1]);
  const digits = S(m[2]).replace(/[^\d]/g, '');
  // 생년월일로 볼 수 있는 자리수만 인정 (6=YYMMDD, 8=YYYYMMDD)
  if (!name || (digits.length !== 6 && digits.length !== 8)) return { name: src, birth: '' };
  return { name, birth: S(m[2]) };
}
