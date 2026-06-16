// 정제 주소 표시 형식 변환 — 저장된 주소 문자열을 괄호(법정동, 건물명) 앞/뒤 배치로 재포맷.
// App.jsx의 저장 시 포맷(formatAddressForDisplayMode)과 동일 규칙을 문자열만으로 재현한다.
// 용도: 이미 저장된 r.주소를 화면에서 원하는 형식으로 표시(예: 루트맵 리스트).

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

const cleanAddressPiece = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .replace(/^[,\s/]+|[,\s/]+$/g, '')
  .trim();

// 주소 문자열 → { road, detail, paren }
export const parseDisplayedAddress = (address) => {
  const text = cleanAddressPiece(address);
  if (!text) return { road: '', detail: '', paren: '' };
  const sepIdx = findTopLevelSeparator(text);
  const road = sepIdx >= 0 ? cleanAddressPiece(text.slice(0, sepIdx)) : text;
  const rest = sepIdx >= 0 ? cleanAddressPiece(text.slice(sepIdx + 1)) : '';
  const parenMatch = rest.match(/\(([^)]*)\)/);
  const paren = parenMatch ? cleanAddressPiece(parenMatch[1]) : '';
  const detail = parenMatch
    ? cleanAddressPiece(`${rest.slice(0, parenMatch.index)} ${rest.slice(parenMatch.index + parenMatch[0].length)}`)
    : cleanAddressPiece(rest);
  return { road, detail, paren };
};

// ── 상세주소(동·호수) 손실 방지 가드 ──────────────────────────────
// 재처리(정제·재적용) 후 주소가 기존 동(棟)·호수를 잃으면 복원/보존한다.
// "아파트 동이 통째로 삭제되는" 손실을 코드로 차단(절대 망가뜨리지 않음).
const _detailNums = (a) => {
  const s = String(a || '');
  return {
    dong: s.match(/(\d+)\s*동/)?.[1] || s.match(/(\d+)\s*-\s*\d+\s*호/)?.[1] || '', // "102동" 또는 A-10 "102- 302호"
    ho: s.match(/(\d+)\s*호/)?.[1] || '',
  };
};
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
 * @param {string} address 저장된 주소 문자열
 * @param {'detailBeforeParen'|'parenBeforeDetail'} mode
 *   detailBeforeParen: "도로명, 동호수 (법정동, 건물명)"  (기본)
 *   parenBeforeDetail: "도로명, (법정동, 건물명) 동호수"
 */
export const formatAddressDisplay = (address, mode = 'detailBeforeParen') => {
  const { road, detail, paren } = parseDisplayedAddress(address);
  if (!road) return address || '';
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
