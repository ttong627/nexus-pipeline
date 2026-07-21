// ── 명단 칼럼 순서·표시 통일 유틸 ────────────────────────────────────────────
// exportColOrder(엑셀/정제결과 칼럼 설정, localStorage `nexus_export_cols_v2`)를
// 단일 소스로 두고, 키 네임스페이스가 다른 다른 명단 뷰의 필드 배열을
// 그 순서·표시(on)에 맞춰 투영한다.

// 뷰마다 키 이름이 달라 마스터(exportColOrder, 한글 키) 기준으로 정규화한다.
// 예) 기본명단(BaseListManager)은 영문 키(name·dong…), 오류목록은 `_사유`를 쓴다.
export const EXPORT_KEY_ALIAS = {
  name: '이름',
  realName: '본명',
  birthKey: '생년월일',
  dong: '행정동',
  mobile: '휴대폰',
  landline: '유선전화',
  buildingName: '건물명',
  note: '특이사항',
  _사유: '사유',
};

// 뷰 필드 키 → 마스터(exportColOrder) 기준 정규 키
const canonKey = (key) => EXPORT_KEY_ALIAS[key] || key;

/**
 * 뷰 고유 필드 배열을 exportColOrder 순서·표시(on)에 맞춰 재정렬·필터한다.
 * - 불변: 원본 배열을 변형하지 않고 새 배열을 반환한다.
 * - on === false 인 칼럼은 제외(숨김).
 * - exportColOrder 에 없는 뷰 고유 필드는 원래 상대 순서로 뒤에 append(항상 표시).
 * - exportColOrder 가 비었거나 배열이 아니면 원본을 그대로 반환(안전 fallback).
 *
 * @param {Array<{key:string,label?:string}>} viewFields 뷰 고유 필드 배열
 * @param {Array<{key:string,on?:boolean}>} exportColOrder 마스터 칼럼 설정
 * @returns {Array} 재정렬·필터된 새 필드 배열
 */
export function orderFieldsByExport(viewFields, exportColOrder, includeHidden = false) {
  if (!Array.isArray(viewFields)) return [];
  if (!Array.isArray(exportColOrder) || exportColOrder.length === 0) return [...viewFields];

  const orderIdx = new Map();
  const onMap = new Map();
  exportColOrder.forEach((c, i) => {
    orderIdx.set(c.key, i);
    onMap.set(c.key, c.on !== false);
  });

  const inExport = [];
  const rest = [];
  for (const f of viewFields) {
    const k = canonKey(f.key);
    if (orderIdx.has(k)) {
      if (includeHidden || onMap.get(k)) inExport.push(f); // 편집모드(includeHidden)면 off도 포함
    } else {
      rest.push(f); // 마스터에 없는 뷰 고유 필드는 항상 표시
    }
  }

  inExport.sort((a, b) => orderIdx.get(canonKey(a.key)) - orderIdx.get(canonKey(b.key)));
  return [...inExport, ...rest];
}

/** cols 에서 dragKey 토큰을 targetKey 위치로 이동한 새 배열(불변). canonical 키 기준. */
export function moveColTo(cols, dragKey, targetKey) {
  if (!Array.isArray(cols)) return cols;
  const dk = canonKey(dragKey);
  const tk = canonKey(targetKey);
  const from = cols.findIndex(c => c.key === dk);
  const to = cols.findIndex(c => c.key === tk);
  if (from < 0 || to < 0 || from === to) return cols;
  const next = [...cols];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** canonical 키의 on 여부(없으면 true 취급). */
export function isColOn(cols, key) {
  if (!Array.isArray(cols)) return true;
  const k = canonKey(key);
  const col = cols.find(c => c.key === k);
  return col ? col.on !== false : true;
}

/** canonical 키의 on 을 토글한 새 배열(불변). */
export function toggleColOn(cols, key) {
  if (!Array.isArray(cols)) return cols;
  const k = canonKey(key);
  return cols.map(c => (c.key === k ? { ...c, on: c.on === false } : c));
}

/**
 * 저장된 칼럼설정(saved)을 defaultCols 기준으로 정규화한다.
 * - label·기본 메타는 defaultCols에서 최신화(옛 라벨 자동 교정).
 * - on·width 는 저장값을 유지(사용자의 표시/폭 보존).
 * - defaultCols 에 없는 키는 제거, 새로 생긴 키는 뒤에 append.
 * - 불변: 새 배열/객체 반환.
 */
export function refreshSavedCols(saved, defaultCols) {
  if (!Array.isArray(defaultCols) || defaultCols.length === 0) {
    return Array.isArray(saved) ? saved.map(c => ({ ...c })) : [];
  }
  if (!Array.isArray(saved) || saved.length === 0) return defaultCols.map(c => ({ ...c }));

  const defByKey = new Map(defaultCols.map(c => [c.key, c]));
  const kept = saved
    .filter(c => defByKey.has(c.key))
    .map(c => {
      const merged = { ...defByKey.get(c.key), on: c.on !== false };
      if (c.width != null) merged.width = c.width;
      return merged;
    });
  const keptKeys = new Set(kept.map(c => c.key));
  const added = defaultCols.filter(d => !keptKeys.has(d.key)).map(c => ({ ...c }));
  return [...kept, ...added];
}

/** 레코드 중 리(里) 값이 하나라도 있으면 true (군 지역 판정용). */
export function hasRi(records) {
  if (!Array.isArray(records)) return false;
  return records.some(r => r && String(r.리 ?? '').trim() !== '');
}

/** exportColOrder에서 canonical 키 기준 칼럼 폭(px) 조회. 없으면 null. */
export function getColWidth(exportColOrder, key) {
  if (!Array.isArray(exportColOrder)) return null;
  const k = canonKey(key);
  const col = exportColOrder.find(c => c.key === k);
  return col && col.width != null ? col.width : null;
}

/** exportColOrder의 canonical 키 칼럼에 폭(px)을 설정한 새 배열 반환. */
export function setColWidthInCols(exportColOrder, key, px) {
  if (!Array.isArray(exportColOrder)) return exportColOrder;
  const k = canonKey(key);
  return exportColOrder.map(c => (c.key === k ? { ...c, width: px } : c));
}

/** 폭(px)을 th/td 인라인 style로. 폭 없으면 undefined(기본폭 유지). */
export function colCellStyle(width) {
  if (!width) return undefined;
  return { width, minWidth: width, maxWidth: width };
}
