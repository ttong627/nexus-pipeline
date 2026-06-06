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
