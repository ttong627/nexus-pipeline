import { HANGUL, BRANCH_SUFFIX, ROAD_NAME_SOURCE, ROAD_NUMBER_TAIL, normalizeCommonRoadTypos } from './shared/roadTokens.js';

const EMPTY_PARENS_RE = /\([^)]*\)/g;
const QUOTE_RE = /["'`“”‘’]/g;

export const cleanText = (value) =>
  String(value || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\x00-\x1F\x7F\xA0\t\n\r\f\v]/g, ' ')
    .replace(QUOTE_RE, '')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeSearchKey = (value) =>
  cleanText(value)
    .replace(EMPTY_PARENS_RE, ' ')
    .replace(/[,\[\]{}]/g, ' ')
    .replace(/\s+/g, '')
    .toLowerCase();

// P7 Phase1(2026-07-30): \uB3C4\uB85C\uBA85 \uD1A0\uD070 \uC815\uC758\uB97C **\uD074\uB77C\u00B7\uC11C\uBC84 \uACF5\uC6A9 SSOT**(`./shared/roadTokens.js`)\uB85C \uD1B5\uD569.
//   \uC608\uC804\uC5D4 \uC774 \uD30C\uC77C\uACFC `src/engine/addressEngine.js`\uC5D0 \uAC19\uC740 \uD328\uD134\uC774 \uBCF5\uC81C\uB3FC \uD55C\uCABD\uB9CC \uACE0\uCE58\uBA74 \uC870\uC6A9\uD788 \uAC08\uB77C\uC84C\uB2E4.
//   \uD68C\uADC0 \uAC10\uC2DC = `scripts/road-regex-parity.test.mjs`.
const ROAD_ADDRESS_RE = new RegExp(`(${ROAD_NAME_SOURCE})${ROAD_NUMBER_TAIL}`, 'u');
const ROAD_BRANCH_SPACE_RE = new RegExp(`([${HANGUL}A-Za-z]+(?:\\uB300\\uB85C|\\uB85C))\\s+(\\d+[${HANGUL}0-9]*${BRANCH_SUFFIX})`, 'gu');

const normalizeBranchRoadSpacing = (value) =>
  normalizeCommonRoadTypos(cleanText(value)).replace(ROAD_BRANCH_SPACE_RE, '$1$2');

export const intOrNull = (value) => {
  const text = String(value ?? '').trim();
  if (!text || !/^\d+$/.test(text)) return null;
  return Number.parseInt(text, 10);
};

export const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';

export const joinAddress = (...parts) => cleanText(parts.filter(hasValue).join(' '));

export const parseRoadNumber = (value) => {
  const text = normalizeBranchRoadSpacing(value);
  const match = text.match(ROAD_ADDRESS_RE);
  if (!match) return null;
  return {
    roadName: normalizeBranchRoadSpacing(match[1]).replace(/\s+/g, ''),
    undergroundYn: match[2] ? '1' : '0',
    buildingMainNo: intOrNull(match[3]),
    buildingSubNo: intOrNull(match[4]) || 0,
  };
};

export const formatRoadLookupQuery = (value) => {
  const parsed = parseRoadNumber(value);
  if (!parsed) return cleanText(value);
  const underground = parsed.undergroundYn === '1' ? '\uC9C0\uD558 ' : '';
  const source = normalizeBranchRoadSpacing(value);
  const compactRoom = parsed.buildingSubNo >= 100 && /-\d{3,5}\s*\uD638(?:\s|$|[),/])/.test(source);
  const buildingSubNo = compactRoom ? Number.parseInt(String(parsed.buildingSubNo).slice(0, 1), 10) : parsed.buildingSubNo;
  const subNo = buildingSubNo ? `-${buildingSubNo}` : '';
  return `${parsed.roadName} ${underground}${parsed.buildingMainNo}${subNo}`.trim();
};

export const isApartmentText = (value) =>
  /(아파트|APT|주공|휴먼시아|자이|푸르지오|래미안|e편한|이편한|더샵|힐스테이트|LH|SH|임대)/i.test(value || '');

export const roadSideKey = (roadName, buildingMainNo) => {
  if (!/(대로|로)$/.test(roadName || '') || !Number.isFinite(buildingMainNo)) return '';
  return `${normalizeSearchKey(roadName)}:${buildingMainNo % 2 ? 'left' : 'right'}`;
};
