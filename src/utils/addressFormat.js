// @ts-check
// 정제 주소 표시 형식 변환 — 저장된 주소 문자열을 괄호(법정동, 건물명) 앞/뒤 배치로 재포맷.
// App.jsx의 저장 시 포맷(formatAddressForDisplayMode)과 동일 규칙을 문자열만으로 재현한다.
// 용도: 이미 저장된 r.주소를 화면에서 원하는 형식으로 표시(예: 루트맵 리스트).

/**
 * 괄호 깊이를 추적하며 최상위(괄호 밖) 첫 구분자(',' 또는 '/') 위치를 찾는다.
 * @param {string} value
 * @returns {number} 위치, 없으면 -1
 */
const findTopLevelSeparator = (value) => {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === ',' || ch === '/')) return i;
  }
  return -1;
};

/**
 * 공백 정규화 + 앞뒤 구분자(쉼표/슬래시/공백) 제거.
 * @param {unknown} value
 * @returns {string}
 */
export const cleanAddressPiece = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .replace(/^[,\s/]+|[,\s/]+$/g, '')
  .trim();

// ── 괄호 중첩 안전처리 (P0, 형 지시 2026-07-30 · 절대 되돌리지 말 것) ──────
// 근본원인: 건물명에 괄호가 포함되면(`호매실 엔루체(NLUCE)`·`경희연립(마)`) A-11이
// `(법정동, 건물명)`으로 감싸며 괄호 짝이 깨지고, 예전 추출식 `/\(([^)]*)\)/` 가 중첩을
// 못 읽어 재정제마다 잔재가 누적됐다(실측 743건). 아래는 전부 depth를 세어 처리한다.
// 원칙: 건물명 훼손 금지(괄호 유지) · 명단 원문 삭제 금지 · 멱등성 보장.

/**
 * depth를 세어 최상위 괄호 블록을 추출한다.
 * 짝 없는 여는 괄호는 끝까지를 내부로 간주(정보 보존), 짝 없는 닫는 괄호는 괄호로 보지 않는다.
 * @param {unknown} value
 * @returns {{ found: boolean, before: string, inner: string, after: string }}
 */
export const extractTopLevelParen = (value) => {
  const text = String(value || '');
  const open = text.indexOf('(');
  if (open < 0) return { found: false, before: text, inner: '', after: '' };
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) {
        return {
          found: true,
          before: text.slice(0, open),
          inner: text.slice(open + 1, i),
          after: text.slice(i + 1),
        };
      }
    }
  }
  // 짝 없는 여는 괄호 — 끝까지를 내부로 본다(내용 유실 방지)
  return { found: true, before: text.slice(0, open), inner: text.slice(open + 1), after: '' };
};

/**
 * 괄호 내부를 최상위 쉼표로만 분리한다(건물명 속 괄호의 쉼표는 무시).
 * @param {unknown} inner
 * @returns {string[]} 예: ['법정동', '건물명']
 */
export const splitParenInner = (inner) => {
  const text = String(inner || '');
  const parts = [];
  let depth = 0;
  let buf = '';
  for (const ch of text) {
    if (ch === '(') { depth++; buf += ch; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); buf += ch; continue; }
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts.map(p => cleanAddressPiece(p)).filter(Boolean);
};

/**
 * 괄호 짝이 맞으면 원본 그대로. 짝이 안 맞는 괄호 기호만 공백으로 바꾼다(내용은 보존).
 * @param {unknown} value
 * @returns {string}
 */
export const balanceParens = (value) => {
  const text = String(value || '');
  if (!text) return '';
  const chars = [...text];
  const drop = new Set();
  const stack = [];
  chars.forEach((ch, i) => {
    if (ch === '(') stack.push(i);
    else if (ch === ')') { if (stack.length) stack.pop(); else drop.add(i); }
  });
  stack.forEach(i => drop.add(i));
  if (!drop.size) return text;
  return cleanAddressPiece(chars.map((ch, i) => (drop.has(i) ? ' ' : ch)).join(''));
};

/**
 * 텍스트의 괄호 블록을 `__P{n}__` 토큰으로 치환해 보호한다(중첩 괄호는 하나의 블록).
 * 내용이 빈 괄호는 공백으로 제거한다.
 * @param {unknown} value
 * @returns {{ text: string, blocks: string[] }}
 */
export const protectParenBlocks = (value) => {
  let rest = String(value || '');
  const blocks = [];
  let out = '';
  for (;;) {
    const seg = extractTopLevelParen(rest);
    if (!seg.found) { out += rest; break; }
    out += seg.before;
    if (seg.inner.trim()) {
      out += `__P${blocks.length}__`;
      blocks.push(`(${seg.inner})`);
    } else {
      out += ' ';
    }
    rest = seg.after;
  }
  return { text: out, blocks };
};

/**
 * 주소 문자열 → { road, detail, paren }
 * @param {unknown} address
 * @returns {{ road: string, detail: string, paren: string }}
 */
export const parseDisplayedAddress = (address) => {
  const text = cleanAddressPiece(address);
  if (!text) return { road: '', detail: '', paren: '' };
  const sepIdx = findTopLevelSeparator(text);
  const road = sepIdx >= 0 ? cleanAddressPiece(text.slice(0, sepIdx)) : text;
  const rest = sepIdx >= 0 ? cleanAddressPiece(text.slice(sepIdx + 1)) : '';
  const seg = extractTopLevelParen(rest);
  const paren = seg.found ? cleanAddressPiece(seg.inner) : '';
  const detail = seg.found
    ? cleanAddressPiece(`${seg.before} ${seg.after}`)
    : cleanAddressPiece(rest);
  return { road, detail, paren };
};

// ── 상세주소(동·호수) 손실 방지 가드 ──────────────────────────────
// 재처리(정제·재적용) 후 주소가 기존 동(棟)·호수를 잃으면 복원/보존한다.
// "아파트 동이 통째로 삭제되는" 손실을 코드로 차단(절대 망가뜨리지 않음).
/**
 * @param {unknown} a
 * @returns {{ dong: string, ho: string }}
 */
const _detailNums = (a) => {
  const s = String(a || '');
  return {
    dong: s.match(/(\d+)\s*동/)?.[1] || s.match(/(\d+)\s*-\s*\d+\s*호/)?.[1] || '', // "102동" 또는 A-10 "102- 302호"
    ho: s.match(/(\d+)\s*호/)?.[1] || '',
  };
};
/**
 * 재처리 후 주소가 기존 동·호수를 잃으면 복원/보존한다.
 * @param {string} oldAddr
 * @param {string} newAddr
 * @returns {string}
 */
export const guardAddressDetail = (oldAddr, newAddr) => {
  if (!oldAddr || !newAddr) return newAddr || oldAddr || '';
  const o = _detailNums(oldAddr), n = _detailNums(newAddr);
  // ① 동이 손실됐고 호수는 동일 → 새 주소에 동 복원(A-10 형식: 102- 302호)
  if (o.dong && !n.dong && o.ho && o.ho === n.ho) {
    const pad = ' '.repeat(Math.max(0, 4 - o.ho.length));
    return newAddr.replace(new RegExp(`${n.ho}\\s*호`), `${o.dong}-${pad}${o.ho}호`);
  }
  // ② 호수 자체가 손실 → 새 주소 신뢰 불가, 기존 주소 보존
  if (o.ho && !n.ho) return oldAddr;
  return newAddr;
};

/**
 * 주소 문자열을 표시 형식으로 재포맷.
 * @param {unknown} address 저장된 주소 문자열
 * @param {'detailBeforeParen'|'parenBeforeDetail'} [mode]
 *   detailBeforeParen: "도로명, 동호수 (법정동, 건물명)" (기본)
 *   parenBeforeDetail: "도로명, (법정동, 건물명) 동호수"
 * @returns {string}
 */
export const formatAddressDisplay = (address, mode = 'detailBeforeParen') => {
  const { road, detail, paren } = parseDisplayedAddress(address);
  if (!road) return String(address || '');
  const parenStr = paren ? `(${paren})` : '';
  if (mode === 'detailBeforeParen') {
    if (detail && parenStr) return `${road}, ${detail} ${parenStr}`;
    if (detail) return `${road}, ${detail}`;
    if (parenStr) return `${road}, ${parenStr}`;
    return road;
  }
  if (parenStr && detail) return `${road}, ${parenStr} ${detail}`;
  if (parenStr) return `${road}, ${parenStr}`;
  if (detail) return `${road}, ${detail}`;
  return road;
};
