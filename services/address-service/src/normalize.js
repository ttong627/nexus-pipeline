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

const HANGUL = '\\uAC00-\\uD7A3';
const BRANCH_SUFFIX =
  '(?:\\uBC88\\uAE38|\\uBC88\\uAC00\\uAE38|\\uAC00\\uAE38|\\uB098\\uAE38|\\uB2E4\\uAE38|\\uB77C\\uAE38|\\uB9C8\\uAE38|\\uBC14\\uAE38|\\uC0AC\\uAE38|\\uC544\\uAE38|\\uC790\\uAE38|\\uCC28\\uAE38|\\uCE74\\uAE38|\\uD0C0\\uAE38|\\uD30C\\uAE38|\\uD558\\uAE38|\\uAE38)';
const ROAD_NAME_SOURCE =
  `(?:[${HANGUL}A-Za-z0-9]+(?:\\uB300\\uB85C|\\uB85C)\\s*\\d+[${HANGUL}0-9]*${BRANCH_SUFFIX}|[${HANGUL}A-Za-z0-9]+(?:\\uB300\\uB85C|\\uB85C|\\uAE38))`;
const ROAD_ADDRESS_RE = new RegExp(`(${ROAD_NAME_SOURCE})\\s*(\\uC9C0\\uD558\\s*)?(\\d{1,5})(?:\\s*-\\s*(\\d{1,5}))?`, 'u');
const ROAD_BRANCH_SPACE_RE = new RegExp(`([${HANGUL}A-Za-z]+(?:\\uB300\\uB85C|\\uB85C))\\s+(\\d+[${HANGUL}0-9]*${BRANCH_SUFFIX})`, 'gu');

const normalizeCommonRoadTypos = (value) =>
  String(value || '').replace(/\uC7AC\uAE30\uB85C(?=\d*\uAE38|\s*\d)/g, '\uC81C\uAE30\uB85C');

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
