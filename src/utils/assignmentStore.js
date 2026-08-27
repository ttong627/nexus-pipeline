// 배정 보관 — **명단과 따로** 둔다. 형 지시 2026-08-27:
//   "명단은 1개월치만 저장이 되지만 기사배정과 좌표·순번은 3개월치가 저장이 되고,
//    새로운 명단이 저장되어도 안정적으로 매칭이 되도록 관리해줘."
//
//   왜 갈라야 하나: 지금은 이름·주소(개인정보)와 기사·순번·좌표가 `cloud_lists` 한 곳에 있다.
//   명단을 1개월 뒤 지우면 **배정·순번도 같이 사라진다**. 그래서 배정만 따로 3개월 보관한다.
//
//   ★여기에는 이름·주소·전화를 **저장하지 않는다**. 매칭키를 해시로만 남긴다.
//     ⚠️정직하게: 해시는 암호화가 아니다. 이름+생년월일은 경우의 수가 좁아 마음먹으면 되맞출 수 있다.
//     그래도 ①주소·전화가 없고 ②그 저장소만 봐서는 바로 못 읽는다 — 최소보관 취지에 맞는 선까지다.
//
//   매칭키는 **S-1 강키만** 쓴다(이름+생년월일 / 이름+휴대폰끝8). 이름 단독 같은 약키는 쓰지 않는다 —
//   동명이인 주소오염 사고(2026-07-10)가 그렇게 났다. 같은 키가 2건 이상이면 **승계하지 않는다**(S-2).

export const RETENTION_MONTHS = 3;

const onlyDigits = (v) => String(v ?? '').replace(/[^0-9]/g, '');
/** 이름 정규화 — 공백만 지운다(가운뎃점·괄호는 본명 표기라 건드리지 않는다) */
export const normName = (v) => String(v ?? '').replace(/\s+/g, '').trim();
/** 생년월일 끝 6자리(YYMMDD) — `75.03.15` · `19750315` 어느 표기든 같은 값이 된다 */
export const birthKey6 = (v) => onlyDigits(v).slice(-6);
/** 휴대폰 끝 8자리 — 표기(하이픈·공백)가 달라도 같은 값 */
export const phoneKey8 = (v) => onlyDigits(v).slice(-8);

/** 이 레코드의 강키 원문. 없으면 null (→ 승계 대상 아님) */
export const strongKeySource = (rec = {}) => {
  const name = normName(rec.이름 ?? rec.name);
  if (!name) return null;
  const b = birthKey6(rec.생년월일 ?? rec.birthKey);
  if (b.length === 6) return `b:${name}:${b}`;
  const p = phoneKey8(rec.휴대폰 ?? rec.연락처 ?? rec.mobile);
  if (p.length === 8) return `p:${name}:${p}`;
  return null;
};

/** sha256 hex — 브라우저·Node 공통(Web Crypto) */
export const sha256Hex = async (text) => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('이 환경에서는 안전한 해시를 쓸 수 없습니다');
  const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** 레코드 → 매칭키 해시(없으면 null) */
export const buildAssignmentKey = async (rec) => {
  const src = strongKeySource(rec);
  return src ? sha256Hex(src) : null;
};

/** 저장용 최소 필드 — 개인정보는 담지 않는다 */
export const toAssignmentRecord = (rec = {}, keyHash) => ({
  k: keyHash,
  driver: String(rec.기사 ?? '').trim(),
  seq: String(rec.배송순번 ?? '').trim(),
  dong: String(rec.행정동 ?? '').trim(),
  lat: Number.isFinite(Number(rec.lat ?? rec._lat)) ? Number(rec.lat ?? rec._lat) : null,
  lng: Number.isFinite(Number(rec.lng ?? rec._lng)) ? Number(rec.lng ?? rec._lng) : null,
});

/**
 * 저장할 배정 목록을 만든다.
 *   - 강키가 없는 건은 제외(승계할 방법이 없다)
 *   - 같은 키가 2건 이상이면 **둘 다 제외**(S-2 — 누구 것인지 모르면 쓰지 않는다)
 *   - 기사·순번이 둘 다 비면 남길 이유가 없다
 */
export const buildAssignmentBatch = async (records = []) => {
  const byKey = new Map();
  for (const r of records || []) {
    if (!r) continue;
    const key = await buildAssignmentKey(r);
    if (!key) continue;
    if (byKey.has(key)) { byKey.set(key, null); continue; }   // 중복 키 → 폐기 표시
    byKey.set(key, r);
  }
  const out = [];
  let skippedDup = 0;
  for (const [key, rec] of byKey) {
    if (!rec) { skippedDup += 1; continue; }
    const row = toAssignmentRecord(rec, key);
    if (!row.driver && !row.seq && row.lat == null) continue;   // 남길 게 없다
    out.push(row);
  }
  return { rows: out, skippedDup };
};

/**
 * 보관해 둔 배정을 새 명단에 이어 붙인다.
 *   ★기존 값이 있으면 덮지 않는다 — 이번 달에 담당자가 정한 것이 우선이다(M-1·G-4 취지).
 *   ★매칭 못 한 건은 그대로 둔다(임의 배정 금지 · S-5).
 */
export const applyCarriedAssignments = async (records = [], carried = []) => {
  const map = new Map();
  for (const row of carried || []) if (row?.k) map.set(row.k, row);
  let carriedCount = 0;
  let missed = 0;
  const out = [];
  for (const r of records || []) {
    const key = await buildAssignmentKey(r);
    const hit = key ? map.get(key) : null;
    if (!hit) { missed += 1; out.push(r); continue; }
    const next = { ...r };
    let touched = false;
    if (!String(next.기사 ?? '').trim() && hit.driver) { next.기사 = hit.driver; touched = true; }
    if (!String(next.배송순번 ?? '').trim() && hit.seq) { next.배송순번 = hit.seq; touched = true; }
    if (!Number.isFinite(Number(next.lat)) && Number.isFinite(Number(hit.lat))) { next.lat = hit.lat; next.lng = hit.lng; touched = true; }
    if (touched) carriedCount += 1;
    out.push(next);
  }
  return { records: out, carried: carriedCount, missed };
};

/** 보관 기간이 지난 월인가 — `YYYY-MM` 기준, 기준월 포함 최근 N개월만 남긴다 */
export const isExpiredMonth = (monthId, baseMonthId, months = RETENTION_MONTHS) => {
  const parse = (m) => {
    const x = /^(\d{4})-(\d{2})$/.exec(String(m ?? ''));
    return x ? Number(x[1]) * 12 + Number(x[2]) : null;
  };
  const a = parse(monthId);
  const b = parse(baseMonthId);
  if (a == null || b == null) return false;      // 알 수 없으면 지우지 않는다
  return b - a >= months;
};
