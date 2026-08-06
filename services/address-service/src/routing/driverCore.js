/**
 * 기사 관리 코어 (모듈 ⑧) — 순수 함수, 의존은 체감물량 계산뿐.
 *
 * ★기사 데이터는 코어가 저장하지 않는다
 *   기사 명부는 각 앱이 자기 DB에 갖고 있다(nexus=Firestore · 플랫폼=Cloud SQL · 생성물=SQLite).
 *   코어가 또 하나의 명부를 만들면 **네 번째 진실**이 생긴다. 그건 이 프로젝트가 계속
 *   겪어온 실패다(같은 로직 3벌·같은 명단 5시스템).
 *   대신 코어는 **판단**을 제공한다 — 누가 얼마나 지고 있는가, 배정이 규칙을 어겼는가.
 *
 * ★가장 중요한 기능은 통계가 아니라 **배정 위반 탐지**다
 *   형 절대규칙: "각 동에는 그 동 소속 기사만 배정한다."
 *   이걸 어기면 기사가 자기 구역 밖으로 나가고, 그날 배송이 통째로 꼬인다.
 *   사람이 눈으로 검수하면 반드시 놓친다 — 명단이 수백 건이다.
 */
import { getEffectiveLoad } from './routeSequenceEngine.js';
import { toEngineRecords } from './recordSchema.js';

/** 기사 식별자 후보 — 앱마다 이름이 다르다. */
const DRIVER_ID_KEYS = ['id', 'driverId', 'driver_id', '기사번호'];
const DRIVER_NAME_KEYS = ['driverName', 'name', '기사명', '이름', '기사'];

/** 배송건에 실린 기사 지칭 — 대부분 이름 문자열이다(id 가 아니라). */
const RECORD_DRIVER_KEYS = ['기사', '담당기사', 'driver', 'driverName', '배송기사', '기사명'];

/** 행정동 후보 — 배정 단위. */
const RECORD_DONG_KEYS = ['배정행정동', 'routeDong', '행정동', 'adminDong', 'dong', '읍면동'];

const firstOf = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

/**
 * 기사 레코드 정규화 — 앱마다 다른 필드명을 하나로 모은다.
 * ★`id` 가 없으면 이름을 키로 쓴다. 실무 명단이 기사를 **이름으로** 지칭하기 때문이다.
 */
export function toDriver(raw) {
  const name = firstOf(raw, DRIVER_NAME_KEYS);
  const id = firstOf(raw, DRIVER_ID_KEYS) || name;
  return {
    id,
    name: name || id,
    phone: firstOf(raw, ['phone', '전화번호', 'tel', '연락처']),
    car: firstOf(raw, ['car', '차량', 'vehicle', '차량번호']),
    // 담당 행정동 — 배정 검증의 기준. 비어 있으면 검증하지 않는다(모르는 걸 위반이라 하지 않는다).
    dongs: Array.isArray(raw?.dongs) ? raw.dongs.map((d) => String(d).trim()).filter(Boolean)
      : Array.isArray(raw?.담당동) ? raw.담당동.map((d) => String(d).trim()).filter(Boolean)
        : [],
    active: raw?.active !== false,
  };
}

export const toDrivers = (list) => (Array.isArray(list) ? list : []).map(toDriver);

/** 배송건이 지목한 기사(이름 또는 id). */
export const recordDriverKey = (rec) => firstOf(rec, RECORD_DRIVER_KEYS);
/** 배송건의 행정동. */
export const recordDong = (rec) => firstOf(rec, RECORD_DONG_KEYS);

/**
 * 기사별 부하 요약 — 누가 얼마나 지고 있는가.
 *
 * 건수만 보면 공평해 보이는 배정이 실제로는 한쪽에 쏠려 있을 수 있다.
 * 그래서 **체감물량**(임대 할인·계단 가중)을 함께 낸다 — 물량배분과 같은 기준값이다.
 */
export function summarizeDrivers({ records = [], drivers = [] } = {}) {
  const normalized = toEngineRecords(records);
  const roster = toDrivers(drivers);
  const byKey = new Map();
  for (const d of roster) {
    byKey.set(d.id, d);
    if (d.name && d.name !== d.id) byKey.set(d.name, d);
  }

  const stats = new Map();
  const unassigned = [];

  for (const rec of normalized) {
    const key = recordDriverKey(rec);
    if (!key) { unassigned.push(rec.id ?? null); continue; }
    const driver = byKey.get(key);
    const id = driver ? driver.id : key;          // 명부에 없는 이름도 집계는 한다(아래 unknown 표시)
    if (!stats.has(id)) {
      stats.set(id, {
        id,
        name: driver ? driver.name : key,
        known: Boolean(driver),                    // ★명부에 없는 기사 = 확인 필요 신호
        count: 0, qty: 0, effectiveLoad: 0, dongs: new Set(),
      });
    }
    const s = stats.get(id);
    s.count += 1;
    s.qty += Number(rec['포수'] ?? 0) || 0;
    s.effectiveLoad += getEffectiveLoad(rec);
    const dong = recordDong(rec);
    if (dong) s.dongs.add(dong);
  }

  const perDriver = [...stats.values()].map((s) => ({
    ...s,
    effectiveLoad: Number(s.effectiveLoad.toFixed(2)),
    dongs: [...s.dongs].sort(),
  })).sort((a, b) => b.effectiveLoad - a.effectiveLoad);

  const loads = perDriver.map((d) => d.effectiveLoad);
  const avg = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;

  return {
    perDriver,
    unassigned,
    totals: {
      records: normalized.length,
      assigned: normalized.length - unassigned.length,
      drivers: perDriver.length,
      avgLoad: Number(avg.toFixed(2)),
      // 부하 편차 — 배분이 잘 됐는지 한 숫자로 본다. 0에 가까울수록 고르다.
      maxDeviationPct: avg > 0
        ? Number((Math.max(...loads.map((l) => Math.abs(l - avg))) / avg * 100).toFixed(1))
        : 0,
    },
    // 명부에 없는 기사가 배정돼 있으면 먼저 확인해야 한다.
    unknownDrivers: perDriver.filter((d) => !d.known).map((d) => d.name),
  };
}

/**
 * ★배정 위반 탐지 — 형 절대규칙 "각 동에는 그 동 소속 기사만".
 *
 * 위반하면 기사가 자기 구역 밖으로 나가고 그날 배송이 꼬인다. 명단이 수백 건이라
 * 사람이 눈으로 보면 반드시 놓친다.
 *
 * ⚠️담당 동이 비어 있는 기사는 **검증하지 않는다**. 모르는 것을 위반이라고 하면
 *   경고가 시끄러워지고, 시끄러운 경고는 곧 무시된다.
 */
export function validateAssignment({ records = [], drivers = [] } = {}) {
  const normalized = toEngineRecords(records);
  const roster = toDrivers(drivers);
  const byKey = new Map();
  for (const d of roster) {
    byKey.set(d.id, d);
    if (d.name && d.name !== d.id) byKey.set(d.name, d);
  }

  const violations = [];
  const unknown = [];
  let checked = 0;

  for (const rec of normalized) {
    const key = recordDriverKey(rec);
    if (!key) continue;
    const driver = byKey.get(key);
    if (!driver) {
      unknown.push({ recordId: rec.id ?? null, driver: key, reason: 'driver_not_in_roster' });
      continue;
    }
    if (!driver.dongs.length) continue;            // 담당 동 미지정 → 판단 보류
    const dong = recordDong(rec);
    if (!dong) continue;                            // 배송건에 동 정보 없음 → 판단 보류
    checked += 1;
    if (!driver.dongs.includes(dong)) {
      violations.push({
        recordId: rec.id ?? null,
        address: rec['주소'] || '',
        driver: driver.name,
        recordDong: dong,
        allowedDongs: driver.dongs,
        reason: 'dong_out_of_scope',
      });
    }
  }

  return {
    ok: violations.length === 0 && unknown.length === 0,
    checked,
    violations,
    unknownDrivers: unknown,
    // 검증하지 못한 이유를 숨기지 않는다 — "위반 0"이 "검증 0"일 수도 있다.
    note: checked === 0
      ? '검증된 건이 없습니다(기사 담당동 또는 배송건 행정동 정보 부족)'
      : null,
  };
}
