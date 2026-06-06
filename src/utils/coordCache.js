// 좌표 영구 캐시 (Firestore: coordinate_cache/{city}/addresses/{key})
// 한 번 받은 좌표를 주소(도로명) 기준으로 영구 재사용해 카카오 API 호출을 최소화한다.
// RouteMapModal/RouteSetupModal과 동일한 키(extractRoadAddress + addrToDocId)를 써서 캐시를 공유한다.
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

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

const addrToDocId = (addr) => (addr || '').replace(/[/]/g, '_').slice(0, 400);

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
  } catch { /* 캐시 저장 실패는 무시 — 좌표 자체는 cloud_lists에 저장됨 */ }
}
