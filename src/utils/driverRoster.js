// ══════════════════════════════════════════════════════════════════
//  기사 명부 — 저장 전 검증과 인증 판정 (순수 로직)
//  회귀: scripts/driver-roster.test.mjs
//
//  ★이 파일이 하는 일 = "이 번호로 들어온 사람을 통과시킬 것인가"
//    배송지도 접근통제(계획 Phase 0~2)의 판정이 전부 여기서 갈린다.
//    Firestore 접근은 섞지 않는다 — 판정을 테스트로 잠글 수 있어야 하기 때문이다.
//
//  ⚠️`drivers` 컬렉션은 2026-08-13 실측 시점에 **0건**이었다. 기사는 화면 세션 안의
//    임시 객체였고 휴대폰 필드가 아예 없었다. 그래서 명부를 새로 만든다.
// ══════════════════════════════════════════════════════════════════
import { toE164Mobile, samePhone } from './phone.js';

/** 저장 시 쓰는 정규 형태로 다듬는다(문자열 트림·번호 정규화). */
export function normalizeDriver(input) {
  const src = input || {};
  return {
    name: String(src.name ?? '').trim(),
    phone: toE164Mobile(src.phone),          // ★항상 E.164. 못 읽으면 빈 값
    phoneRaw: String(src.phone ?? '').trim(), // 담당자가 뭘 입력했는지 보존(고칠 때 근거)
    active: src.active !== false,             // 기본 활성
    memo: String(src.memo ?? '').trim(),
  };
}

/**
 * 저장해도 되는가. **문제를 사유 목록으로** 돌려준다(하나만 알려주면 담당자가 여러 번 헛돈다).
 *
 * @param {object} input 입력값
 * @param {Array} [existing] 이미 등록된 기사들(중복 검사용)
 * @param {string} [selfId] 수정 중인 기사 id(자기 자신은 중복이 아니다)
 */
export function validateDriver(input, existing = [], selfId = '') {
  const d = normalizeDriver(input);
  const errors = [];

  if (!d.name) errors.push('이름을 입력하세요.');
  if (d.name.length > 30) errors.push('이름이 너무 깁니다(30자 이내).');

  if (!d.phoneRaw) {
    errors.push('휴대폰 번호를 입력하세요.');
  } else if (!d.phone) {
    // ★여기서 "대충 저장"하면 그 기사는 영영 인증을 못 통과한다 — 에러도 안 나고 조용히.
    errors.push(`휴대폰 번호를 읽을 수 없습니다: "${d.phoneRaw}" — 010으로 시작하는 휴대폰 번호여야 합니다.`);
  }

  if (d.phone) {
    const dup = (existing || []).find(
      (x) => x && String(x.id || '') !== String(selfId || '') && samePhone(x.phone, d.phone),
    );
    if (dup) {
      // ★같은 번호가 둘이면 인증이 들어왔을 때 **누구인지 정할 수 없다**.
      errors.push(`이미 등록된 번호입니다: ${dup.name || '(이름없음)'}`);
    }
  }

  return { ok: errors.length === 0, errors, value: d };
}

/**
 * 이 번호로 들어온 사람을 **통과시킬 것인가** — 인증 판정의 핵심.
 *
 * ★모르면 통과시키지 않는다. 비활성·미등록·번호 불명은 전부 거절이다.
 *
 * @param {string} tokenPhone Firebase Phone Auth 가 준 `token.phone_number`(E.164)
 * @param {Array} roster 등록된 기사 목록
 * @returns {{allowed:boolean, driver:object|null, reason:string}}
 */
export function resolveDriverByPhone(tokenPhone, roster = []) {
  const phone = toE164Mobile(tokenPhone);
  if (!phone) return { allowed: false, driver: null, reason: 'invalid_phone' };

  const hits = (roster || []).filter((d) => d && samePhone(d.phone, phone));
  if (!hits.length) return { allowed: false, driver: null, reason: 'not_registered' };
  if (hits.length > 1) {
    // 명부가 오염된 상태다. 아무나 고르면 **남의 배송**을 줄 수 있다 → 막고 사람이 고치게 한다.
    return { allowed: false, driver: null, reason: 'duplicate_registration' };
  }

  const driver = hits[0];
  if (driver.active === false) return { allowed: false, driver, reason: 'inactive' };
  return { allowed: true, driver, reason: 'ok' };
}

/** 거절 사유 → 기사 화면에 보여줄 말(막연한 '접근 불가'는 담당자에게 전화만 늘린다). */
export const DENY_MESSAGE = {
  invalid_phone: '휴대폰 번호를 확인할 수 없습니다. 담당자에게 문의하세요.',
  not_registered: '등록되지 않은 번호입니다. 담당자에게 기사 등록을 요청하세요.',
  duplicate_registration: '같은 번호가 중복 등록돼 있습니다. 담당자 확인이 필요합니다.',
  inactive: '비활성 처리된 계정입니다. 담당자에게 문의하세요.',
};

/** 명부에서 공유문서에 심을 번호 목록(정규화·중복제거·활성만). */
export function activePhones(roster = []) {
  const out = [];
  for (const d of roster || []) {
    if (!isActiveDriver(d)) continue;   // ★`status:'inactive'` 도 걸러야 한다(같은 뿌리의 결함)
    const p = toE164Mobile(d.phone);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

// ── 기사 활성 판정 (SSOT) ───────────────────────────────────────────────────
//   ★명부는 `status: 'active' | 'inactive'` 로 저장한다. 옛 데이터엔 `active: false` 도 있다.
//   한쪽만 보면 비활성 기사가 살아 있는 것처럼 보인다 — 실제로 그랬다(2026-08-27 형 지적:
//   "윤찬용은 비활성화 했는데 보이고 안광호는 안 보여").
export const isActiveDriver = (d) => !!d && d.active !== false && d.status !== 'inactive' && d.status !== 'deleted';

const sameDriver = (a, b) => {
  if (!a || !b) return false;
  const ida = String(a.id ?? a._docId ?? '');
  const idb = String(b.id ?? b._docId ?? '');
  if (ida && idb && ida === idb) return true;
  const digits = (v) => String(v ?? '').replace(/[^0-9]/g, '');
  const na = String(a.name ?? '').trim();
  const nb = String(b.name ?? '').trim();
  if (!na || na !== nb) return false;
  const pa = digits(a.phone);
  const pb = digits(b.phone);
  return !pa || !pb || pa === pb;   // 이름이 같고 번호가 없거나 같으면 같은 사람
};

/**
 * 복원한 기사 목록을 **현재 명부 기준**으로 정리한다.
 *   왜: 이어서 작업·프리셋·저장세션에서 되살린 목록은 **그때의 명부**다. 그 사이에 담당자가
 *   기사를 비활성화하거나 새로 넣으면 화면과 명부가 어긋난다(비활성이 보이고 신규가 안 보인다).
 *   - 명부에서 비활성이거나 사라진 기사 → 뺀다
 *   - 명부에 있는 활성 기사인데 목록에 없으면 → 뒤에 붙인다
 *   - 유지되는 기사의 이름·전화는 명부값으로 맞추되, 담당자가 화면에서 조정한 capacity·color 는 보존한다
 *   ★명부를 못 읽었으면(roster 비어 있음) **아무것도 하지 않는다** — 명부 조회 실패로 기사가 사라지면 안 된다.
 */
export function reconcileDriversWithRoster(restored = [], roster = []) {
  const list = Array.isArray(restored) ? restored.filter(Boolean) : [];
  const pool = Array.isArray(roster) ? roster.filter(Boolean) : [];
  if (!pool.length) return { drivers: list, removed: [], added: [], skipped: true };

  const kept = [];
  const removed = [];
  // ★id 를 명부 id 로 갈아끼우면 **동별 배정(dongDriverMap)이 통째로 무효가 된다** —
  //   배정은 옛 id 를 들고 있는데 기사 목록엔 새 id 만 남아 '없는 기사'로 판정돼 조용히 삭제됐다
  //   (형 실측 2026-08-27: 전농1동·휘경1동 배정이 화면을 여는 것만으로 사라지고 그대로 저장됨).
  //   그래서 **바뀐 id 의 대응표를 같이 돌려준다** — 호출부가 배정을 함께 옮긴다.
  const idMap = {};
  for (const d of list) {
    const match = pool.find((r) => sameDriver(d, r));
    if (!match) { removed.push({ name: d.name || '', reason: '명부에 없음', id: String(d.id ?? '') }); continue; }
    if (!isActiveDriver(match)) { removed.push({ name: match.name || d.name || '', reason: '비활성', id: String(d.id ?? '') }); continue; }
    const oldId = String(d.id ?? '');
    const newId = String(match.id ?? match._docId ?? d.id ?? '');
    if (oldId && newId && oldId !== newId) idMap[oldId] = newId;
    kept.push({
      ...d,
      id: newId,
      name: match.name ?? d.name ?? '',
      phone: match.phone ?? d.phone ?? '',
    });
  }

  const added = [];
  for (const r of pool) {
    if (!isActiveDriver(r)) continue;
    if (kept.some((d) => sameDriver(d, r))) continue;
    added.push({
      id: String(r.id ?? r._docId ?? ''),
      name: r.name || '',
      phone: r.phone || '',
      capacity: r.capacity ?? 100,
      color: r.color || '',
    });
  }
  return { drivers: [...kept, ...added], removed, added, skipped: false, idMap };
}

/**
 * 동별 배정의 기사 id 를 새 id 로 옮긴다 (`reconcileDriversWithRoster` 의 `idMap` 사용).
 *   ★배정을 잃지 않는 것이 목적이다 — 대응표에 없는 id 는 **그대로 둔다**(함부로 지우지 않는다).
 */
export function remapDongDriverMap(map = {}, idMap = {}) {
  const src = map || {};
  if (!idMap || !Object.keys(idMap).length) return src;
  const out = {};
  Object.entries(src).forEach(([dong, ids]) => {
    const next = [...new Set((Array.isArray(ids) ? ids : []).map((id) => idMap[id] || id))];
    if (next.length) out[dong] = next;
  });
  return out;
}

/**
 * 담당 기사가 모두 사라져 배정이 풀리는 행정동을 찾는다(조용히 지우지 않고 알리기 위해).
 * @param {object} map 동별 배정 (이미 remap 을 거친 것)
 * @param {Set<string>|string[]} keptIds 현재 유효한 기사 id
 */
export function dongsLosingDrivers(map = {}, keptIds = []) {
  const kept = keptIds instanceof Set ? keptIds : new Set(keptIds || []);
  return Object.entries(map || {})
    .filter(([, ids]) => Array.isArray(ids) && ids.length > 0 && !ids.some((id) => kept.has(id)))
    .map(([dong]) => dong);
}

/**
 * 기사 명부를 **어느 소속사에서** 읽을지 정한다.
 *   ★화면에서 고른 소속사가 1순위다(형 지시 2026-08-27:
 *     "지자체 선택 후 소속사를 선택하면 그 소속사의 해당 정보를 불러오는 게 맞다.
 *      소속사가 없다고 적용하지 않으면 안 되지").
 *   ⚠️예전엔 로그인 사용자의 `orgId` 만 봤다. **관리자 계정은 소속이 비어 있어서** 명부를 못 읽었고,
 *     "명부를 못 읽으면 아무것도 하지 않는다" 안전장치에 걸려 대조가 통째로 건너뛰어졌다 —
 *     그래서 화면에는 비활성 기사가 계속 뜨고 새로 넣은 기사가 안 떴다(실측 2회).
 *   @returns {{ kind:'org'|'company'|'personal'|'none', name:string }}
 */
export function resolveRosterSource({ orgs = [], selectedOrgId = null, user = {} } = {}) {
  const picked = (orgs || []).find((o) => o && (o.id === selectedOrgId || o.name === selectedOrgId));
  const pickedName = String(picked?.name || '').trim();
  if (pickedName) return { kind: 'org', name: pickedName };
  const myOrg = String(user?.orgId || '').trim();
  if (myOrg) return { kind: 'org', name: myOrg };
  const code = String(user?.companyCode || '').trim();
  if (code) return { kind: 'company', name: code };
  const uid = String(user?.uid || '').trim();
  if (uid) return { kind: 'personal', name: uid };
  return { kind: 'none', name: '' };
}
