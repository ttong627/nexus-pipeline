// ══════════════════════════════════════════════════════════════════
//  공유 문서 구조 — 메타(부모) + 건별(서브컬렉션)
//  회귀: scripts/share-doc.test.mjs
//
//  ★왜 쪼개는가 (계획 prompt_plan.md Phase 1 · 형 확정 B="자기 것만")
//    지금은 문서 하나에 `records[1524]` 가 **배열**로 들어 있다.
//    **배열은 부분 권한을 줄 수 없다** — 읽을 수 있으면 전부 읽힌다.
//    그래서 건별 문서로 나누고 보안규칙이 `driverPhone` 으로 거른다.
//    화면에서 거르는 방식은 우회된다(개발자도구로 원본을 그대로 본다).
//
//      route_shares/{shareId}                     ← 메타만
//      route_shares/{shareId}/records/{recordId}  ← 건별 · driverPhone 으로 소유 표시
//
//  ★번호 없는 기사는 **조용히 빠지면 안 된다**.
//    그 기사의 배송건은 누구에게도 안 보이고, 그러면 그 집은 배송을 못 받는다.
//    담당자가 생성 시점에 알아야 고칠 수 있다 → `unassigned` 로 돌려준다.
// ══════════════════════════════════════════════════════════════════
import { toE164Mobile } from './phone.js';
// (`activePhones` 는 휴대폰 인증 경로가 살아날 때 다시 쓴다 — 지금은 부모 문서에 번호를 넣지 않는다)

/** Firestore 배치 상한(500)보다 넉넉히 아래로 — 부모 문서 갱신분까지 한 배치에 들어간다. */
export const BATCH_LIMIT = 450;

/** 배열을 n개씩 자른다(배치 쓰기용). */
export function chunk(list, size = BATCH_LIMIT) {
  const arr = Array.isArray(list) ? list : [];
  const n = Math.max(1, Number(size) || BATCH_LIMIT);
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * 기사 id → 등록번호(E.164) 표. 명부에 **이름으로** 맞춘다.
 *
 * ⚠️화면의 기사는 세션 임시 객체(`{id:'d1', name:'기사1'}`)라 명부 id 와 다르다.
 *   지금 이어 붙일 수 있는 유일한 키가 **이름**이다. 그래서 이름이 겹치면 못 고른다
 *   → 겹치면 **비운다**(찍어서 붙이면 남의 배송을 준다).
 */
export function mapDriverPhones(drivers = [], roster = []) {
  const byId = new Map();
  const byName = new Map();
  for (const r of roster || []) {
    if (!r) continue;
    // 명부의 활성 판정: `status:'inactive'`(org_drivers) 또는 `active:false`
    if (r.active === false || r.status === 'inactive') continue;
    // ★비교키는 저장된 `phoneE164` 를 먼저 쓴다(정규화 결과가 이미 박혀 있다).
    //   없으면 원문에서 뽑는다 — 백필 전 문서도 동작해야 한다.
    const ph = toE164Mobile(r.phoneE164 || r.phone);
    if (!ph) continue;
    if (r.id) byId.set(String(r.id), ph);
    const nm = String(r.name || '').trim();
    if (!nm) continue;
    if (byName.has(nm)) { byName.set(nm, null); continue; }  // 동명이인 → 판단 불가
    byName.set(nm, ph);
  }
  const out = {};
  for (const d of drivers || []) {
    if (!d || !d.id) continue;
    // ★id 우선. 소속사 피커로 고른 기사는 화면 id 가 곧 명부 문서 id 라 정확히 맞는다.
    //   직접 입력한 기사만 이름으로 폴백하고, 그때는 동명이인이면 비운다.
    out[d.id] = byId.get(String(d.id)) || byName.get(String(d.name || '').trim()) || '';
  }
  return out;
}

/**
 * 배송건 → 서브컬렉션에 넣을 문서들. 번호를 못 찾은 건은 **따로 돌려준다**.
 *
 * @returns {{docs: Array, unassigned: Array}}
 */
export function buildShareRecords(records = [], drivers = [], roster = []) {
  const phoneOf = mapDriverPhones(drivers, roster);
  const docs = [];
  const unassigned = [];
  for (const r of records || []) {
    if (!r || !r._driverId) continue;
    const phone = phoneOf[r._driverId] || '';
    const doc = {
      id: r.id || '',
      driverId: r._driverId,
      driverPhone: phone,                 // ★규칙이 이 값으로 거른다
      lat: r._lat ?? null,
      lng: r._lng ?? null,
      isApt: r._isApt || false,
      배송순번: r.배송순번 ? parseInt(r.배송순번, 10) : null,
      이름: r.이름 || '',
      주소: r.주소 || '',
      행정동: r.행정동 || '',
      포수: parseInt(r.포수 ?? r['수량(포수)'], 10) || 1,
      특이사항: r.특이사항 || '',
      휴대폰: r.휴대폰 || '',
    };
    docs.push(doc);
    if (!phone) unassigned.push({ id: doc.id, 이름: doc.이름, driverId: doc.driverId });
  }
  return { docs, unassigned };
}

/**
 * 부모(메타) 문서. **여기에 배송건을 넣지 않는다** — 넣는 순간 다시 통째로 새어나간다.
 *
 * @param {object} p
 * @param {Date} p.now 기준 시각(주입 — 테스트 결정성)
 * @param {Date} p.deadline 담당자가 정한 마감(이 날짜를 **넘겨 갱신되지 않는다**, 형 확정 C)
 * @param {number} p.ttlDays 접속 시 갱신 폭(기본 7)
 */
export function buildShareMeta({ city = '', monthId = '', drivers = [],
  now = new Date(), deadline = null, ttlDays = 7, createdBy = '' } = {}) {
  const base = new Date(now.getTime() + Math.max(1, ttlDays) * 24 * 60 * 60 * 1000);
  // 만료는 마감을 넘지 않는다. 마감이 이미 지났으면 마감이 곧 만료다.
  const expires = deadline && deadline < base ? new Date(deadline) : base;
  return {
    city, monthId, createdBy,
    drivers: (drivers || []).map((d) => ({ id: d.id, name: d.name, color: d.color })),
    // ⛔`driverPhones` 는 더 이상 넣지 않는다(2026-08-24) — 휴대폰 인증 경로가 보류(비밀번호 입장으로 대체)라
    //   쓰이지도 않는데, 부모 문서는 그 공유의 **토큰을 가진 기사 전원**에게 읽힌다 → 명부 전화번호가 통째로 노출된다.
    //   휴대폰 인증을 되살릴 때만 다시 넣을 것(규칙의 phone 경로는 옛 문서 호환으로 남아 있다).
    deadline: deadline ? new Date(deadline) : null,
    expiresAt: expires,
    ttlDays: Math.max(1, ttlDays),
  };
}

/** 담당자가 지정할 수 있는 마감일 상한(일). 이보다 길게 열어두면 노출 창만 길어진다. */
export const MAX_DEADLINE_DAYS = 30;

/**
 * 담당자가 고른 마감일을 **받아도 되는 값으로** 다듬는다(Phase 3).
 *
 * ★왜 상한을 두는가: 마감일이 곧 접근 가능 기간의 진짜 천장이다(형 확정 C).
 *   담당자가 무심코 6개월을 넣으면 그 기간 내내 이름·주소·휴대폰이 열려 있다.
 * ★과거 날짜는 거절한다 — 만들자마자 못 쓰는 링크는 담당자를 헷갈리게만 한다.
 *
 * @param {string|Date} input `YYYY-MM-DD`(date input) 또는 Date
 * @param {Date} [now]
 * @returns {{ok:boolean, value:Date|null, error:string}}
 */
export function normalizeDeadline(input, now = new Date()) {
  if (!input) return { ok: true, value: null, error: '' };   // 미지정 = 기본 기간만 쓴다
  let d;
  if (input instanceof Date) {
    d = new Date(input);
  } else {
    const s = String(input).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { ok: false, value: null, error: '날짜 형식이 올바르지 않습니다(YYYY-MM-DD).' };
    // ★그 날 **끝까지** 쓸 수 있게 한다 — 마감일 당일에 배송이 있을 수 있다.
    //   로컬(KST) 기준 23:59:59 로 잡는다.
    d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 0);
  }
  if (Number.isNaN(d.getTime())) return { ok: false, value: null, error: '날짜를 읽을 수 없습니다.' };
  if (d <= now) return { ok: false, value: null, error: '이미 지난 날짜입니다. 오늘 이후로 정하세요.' };
  const max = new Date(now.getTime() + MAX_DEADLINE_DAYS * 24 * 60 * 60 * 1000);
  if (d > max) {
    return { ok: false, value: null, error: `마감일은 최대 ${MAX_DEADLINE_DAYS}일 이내로 정하세요(개인정보 노출 기간).` };
  }
  return { ok: true, value: d, error: '' };
}

/**
 * 접속 시 갱신값 — **마감일을 넘지 않는다**(형 확정 C).
 * ⚠️이 계산은 서버(Function)에서 돈다. 클라가 `expiresAt` 을 직접 쓰면 기사가
 *   자기 만료일을 늘릴 수 있고, 그 자체가 구멍이다.
 */
export function renewedExpiry({ now = new Date(), deadline = null, ttlDays = 7 } = {}) {
  const want = new Date(now.getTime() + Math.max(1, ttlDays) * 24 * 60 * 60 * 1000);
  if (!deadline) return want;
  const dl = new Date(deadline);
  return want > dl ? dl : want;
}
