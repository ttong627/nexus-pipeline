// 좌표 영구 캐시 (Firestore: coordinate_cache/{city}/addresses/{key})
// 한 번 받은 좌표를 주소(도로명) 기준으로 영구 재사용해 카카오 API 호출을 최소화한다.
// RouteMapModal/RouteSetupModal과 동일한 키(extractRoadAddress + addrToDocId)를 써서 캐시를 공유한다.
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, query, limit, orderBy, startAfter } from 'firebase/firestore';
import { idbGet, idbSet } from './idbCache.js';

// 도로명+상세까지의 주소 키 추출 (괄호 밖 첫 쉼표 전까지, 없으면 마지막 괄호까지).
// ※ RouteMapModal/RouteSetupModal의 extractRoadAddress와 동일해야 캐시가 공유된다.
export const extractRoadAddress = (addr) => {
  if (!addr) return addr;
  let depth = 0;
  for (let i = 0; i < addr.length; i++) {
    if (addr[i] === '(') depth++;
    else if (addr[i] === ')') depth--;
    else if (addr[i] === ',' && depth === 0) return addr.slice(0, i).trim();
  }
  const lastClose = addr.lastIndexOf(')');
  return lastClose > 0 ? addr.slice(0, lastClose + 1).trim() : addr.trim();
};

export const addrToDocId = (addr) => (addr || '').replace(/[/]/g, '_').slice(0, 400);

// ── 도시 캐시 일괄 로드 (2026-08-23 Phase 1) ─────────────────────────────
//   왜: 예전엔 **레코드마다** `getDoc` 을 한 번씩 했다(N+1). 실측으로 건당 27.8ms —
//   7,402건짜리 지자체면 **약 206초**를 캐시 조회에만 썼다. 같은 도시를 한 번에 읽으면 **637ms**(323배).
//   메모리는 7,402건에 약 255KB 라 부담이 없다.
//   ★키 규격은 위 `extractRoadAddress` + `addrToDocId` 그대로 — 여기서 키를 다르게 만들면
//     기존 캐시를 통째로 못 읽어 좌표를 **전량 다시 구매**하게 된다(회귀 `coord-cache.test.mjs` 가 잠근다).
const memCityCache = new Map();          // city → Map(key → {lat,lng})  (탭이 살아 있는 동안)
const IDB_PREFIX = 'coordCache:v1:';
const PAGE = 2000;

/** 도시 전체 좌표 캐시를 Map 으로 돌려준다. 두 번째 호출부터는 메모리/IndexedDB 에서 즉시. */
export async function loadCityCoordCache(db, city, { force = false } = {}) {
  if (!db || !city) return new Map();
  if (!force && memCityCache.has(city)) return memCityCache.get(city);
  if (!force) {
    try {
      const cached = await idbGet(IDB_PREFIX + city);
      if (cached && Array.isArray(cached.entries)) {
        const m = new Map(cached.entries);
        memCityCache.set(city, m);
        return m;
      }
    } catch { /* IndexedDB 실패는 무시 — 아래에서 서버로 간다 */ }
  }
  const out = new Map();
  try {
    const col = collection(db, 'coordinate_cache', city, 'addresses');
    let cursor = null;
    // 페이지로 끊어 읽는다 — 한 번에 다 받으려다 실패하면 아무것도 못 쓴다.
    for (let page = 0; page < 40; page++) {
      const q = cursor
        ? query(col, orderBy('__name__'), startAfter(cursor), limit(PAGE))
        : query(col, orderBy('__name__'), limit(PAGE));
      const snap = await getDocs(q);
      if (snap.empty) break;
      snap.forEach((d) => {
        const x = d.data();
        if (x?.lat && x?.lng) out.set(d.id, { lat: x.lat, lng: x.lng });
      });
      if (snap.size < PAGE) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
  } catch (e) {
    // 실패해도 화면은 살아 있어야 한다 — 개별 조회(getCachedCoord)로 폴백된다.
    console.warn('[coordCache] 도시 캐시 로드 실패:', city, e?.message || e);
    return out;
  }
  memCityCache.set(city, out);
  try { await idbSet(IDB_PREFIX + city, { at: Date.now(), entries: [...out.entries()] }); } catch { /* 용량 초과 등은 무시 */ }
  return out;
}

/** 일괄 로드한 Map 에서 주소로 좌표를 찾는다(개별 조회와 **같은 키 규격**). */
export function lookupCoordInCache(cacheMap, 주소) {
  if (!cacheMap || !주소) return null;
  const key = addrToDocId(extractRoadAddress(주소));
  if (!key) return null;
  return cacheMap.get(key) || null;
}

/** 새로 받은 좌표를 메모리 캐시에도 반영(같은 세션에서 재조회 안 하도록). */
export function primeCoordCache(city, 주소, lat, lng) {
  if (!city || !주소 || !lat || !lng) return;
  const key = addrToDocId(extractRoadAddress(주소));
  if (!key) return;
  if (!memCityCache.has(city)) memCityCache.set(city, new Map());
  memCityCache.get(city).set(key, { lat, lng });
}

/** 주소(raw) → 캐시된 좌표 { lat, lng } 또는 null. 카카오 호출 전에 먼저 조회. */
export async function getCachedCoord(db, city, 주소) {
  if (!db || !city || !주소) return null;
  const key = addrToDocId(extractRoadAddress(주소));
  if (!key) return null;
  try {
    const snap = await getDoc(doc(db, 'coordinate_cache', city, 'addresses', key));
    if (snap.exists()) {
      const d = snap.data();
      if (d?.lat && d?.lng) return { lat: d.lat, lng: d.lng };
    }
  } catch { /* 캐시 조회 실패는 무시 — 카카오로 폴백 */ }
  return null;
}

/** 새로 받은 좌표를 캐시에 영구 저장. 다음에 같은 주소면 API 없이 즉시 재사용. */
export async function saveCoordCache(db, city, 주소, lat, lng) {
  if (!db || !city || !주소 || !lat || !lng) return;
  const road = extractRoadAddress(주소);
  const key = addrToDocId(road);
  if (!key) return;
  try {
    await setDoc(
      doc(db, 'coordinate_cache', city, 'addresses', key),
      { address: road, lat, lng, fetchedAt: serverTimestamp() },
      { merge: true }
    );
    primeCoordCache(city, 주소, lat, lng);   // 같은 세션에서 다시 조회하지 않도록
  } catch { /* 캐시 저장 실패는 무시 — 좌표 자체는 cloud_lists에 저장됨 */ }
}
