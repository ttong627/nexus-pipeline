// ══════════════════════════════════════════════════════════════════
//  C-5 좌표 저장소 클라 연동 — 설계서 좌표관리_설계.md §3-4
//  회귀: scripts/coord-store-api.test.mjs
//
//  ⛔⛔ **이 모듈은 지금 아무도 안 쓴다(휴면). 여기를 고쳐도 운영은 안 바뀐다.** ⛔⛔
//    유일한 호출부가 `App.jsx` `runSavedListBackgroundCoords` 인데 **그 함수 자체가
//    호출부 0건**이다(브라우저 지오코딩 중단 정책으로 호출이 빠졌다). 딸린 진행 패널
//    (`App.jsx` `bgSaveCoordState`)도 그래서 영영 안 뜬다. 2026-08-12 실측 확인.
//    지우지 않고 남긴 이유 = 형이 "저장 후 백그라운드 좌표 매칭"을 되살릴 수 있어서다.
//    **되살릴 때는 호출부부터 붙이고, 아래 규칙을 SSOT 와 대조할 것.**
//
//  ★실제로 도는 좌표 선택 규칙은 여기가 아니다 — 아래는 그 **사본**이다:
//      · 명단 lat/lng(동 → 입구 → 중심) = `functions/storeCoordPick.js`
//        (Cloud Function `geocodeAuto` 3분마다 · 회귀 `scripts/store-coord-pick.test.mjs`)
//      · 내비 목적지(입구 → 중심, 동 금지 = F2)
//        = `services/address-service/src/delivery/deliveryBrief.js` `pickCoordinate`
//    (예전 주석은 서버 `coordStore.pickDeliveryCoord` 를 지목했는데, 그 함수도 호출부가
//     0건이라 2026-08-12 에 지웠다. 죽은 코드를 SSOT 로 적어두면 고쳐도 안 바뀐다.)
//
//  ★정제 화면은 반드시 mode:'cache' 만 쓴다(F10). 채움(fill)은 외부 API 를 태워
//    화면이 멈춘다. 여기에 fill 을 부르는 함수를 두지 않는 이유다.
// ══════════════════════════════════════════════════════════════════

const API = String(import.meta?.env?.VITE_ADDRESS_MATCH_API_URL || '').replace(/\/+$/, '');

/** 저장소가 내준 좌표를 믿을 수 있는가. outlier·none 은 좌표 없음으로 본다(DS-15). */
const trustworthy = (entry) => Boolean(entry)
  && entry.quality !== 'outlier'
  && entry.quality !== 'none'
  && entry.quality !== 'no_anchor'
  && entry.quality !== 'unknown';

const point = (p, kind) => (p && p.lat != null && p.lng != null
  ? { lat: Number(p.lat), lng: Number(p.lng), source: p.source || '', kind }
  : null);

/**
 * 용도에 맞는 좌표를 고른다(휴면 — 위 배너 참조).
 *   `sequence` 는 `functions/storeCoordPick.js` 와, `navigation` 은 서버
 *   `deliveryBrief.pickCoordinate` 와 같은 뜻이어야 한다. 되살릴 때 대조할 것.
 *
 *  navigation : 입구 → 중심.  **동 좌표는 쓰지 않는다**(F2 — 동 앞은 차가 못 들어간다)
 *  sequence   : 동 → 입구 → 중심 (단지를 한 점으로 보면 내부 동선이 통째로 사라진다)
 */
export const pickStoreCoord = (entry, purpose = 'navigation') => {
  if (!trustworthy(entry)) return null;
  if (purpose === 'sequence') {
    const d = point(entry.dong, 'dong');
    if (d) return d;
  }
  return point(entry.entrance, 'entrance') || point(entry.center, 'center');
};

/**
 * 내비용 점을 가졌는가.
 *
 * ★동 좌표만 있는 건물은 **보유가 아니다**. 동 좌표는 순번용이라 내비 목적지가 못 된다.
 *   그걸 보유로 세면 채움이 끝나지 않았는데 끝난 줄 안다(설계서 F9 와 같은 함정).
 */
export const storeEntryHasPoint = (entry) => Boolean(pickStoreCoord(entry, 'navigation'));

/**
 * 미보유 집계 — **사유를 나눠 센다**.
 *
 * ★"좌표가 없다"를 한 덩어리로 세면 무엇을 해야 하는지 알 수 없다.
 *   no_anchor 는 주소를 특정 못 한 것이라 **좌표 문제가 아니라 주소 문제**다(A-36).
 *   좌표 채움을 아무리 돌려도 안 줄어든다.
 */
export const summarizeCoverage = (entries = []) => {
  const s = { total: 0, withPoint: 0, missing: 0, noAnchor: 0, outlier: 0, none: 0, unknown: 0 };
  for (const e of entries) {
    s.total += 1;
    if (storeEntryHasPoint(e)) { s.withPoint += 1; continue; }
    s.missing += 1;
    if (e?.quality === 'no_anchor') s.noAnchor += 1;
    else if (e?.quality === 'outlier') s.outlier += 1;
    else if (e?.quality === 'none') s.none += 1;
    else s.unknown += 1;
  }
  return s;
};

/** 한 번에 보내는 최대 건수 — 서버도 5000 에서 413 을 낸다. */
const CHUNK = 1000;

/**
 * 좌표 저장소 배치 조회(**조회 전용**).
 *
 * ★레코드마다 왕복하지 않는다. 명단 수천 건을 한 건씩 물으면 그것만으로 화면이 멈춘다.
 * ★실패하면 빈 배열이 아니라 **길이가 같은 null 배열**을 돌려준다. 길이가 어긋나면
 *   호출부가 인덱스로 맞추다가 **다른 사람의 좌표를 붙인다**.
 */
export const resolveCoordsBatch = async (records = [], { signal = null } = {}) => {
  const list = Array.isArray(records) ? records : [];
  if (!API || !list.length) return list.map(() => null);
  const out = new Array(list.length).fill(null);
  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK);
    try {
      const res = await fetch(`${API}/v1/coords/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'cache', records: slice }),
        signal,
      });
      if (!res.ok) continue;
      const data = await res.json();
      const coords = Array.isArray(data?.coords) ? data.coords : [];
      // 서버가 길이를 바꿔 보내면 인덱스 정렬이 깨진다 — 그 응답은 통째로 버린다.
      if (coords.length !== slice.length) continue;
      coords.forEach((c, k) => { out[i + k] = c; });
    } catch {
      // 좌표 조회 실패가 정제·화면을 막으면 안 된다. 못 받으면 null 로 두고 기존 경로가 받는다.
    }
  }
  return out;
};

/** 좌표 미보유가 남은 채로 순번을 돌리면 기사 구역이 찢어진다(F4) → 실행 전 확인용. */
export const fetchCoordStatus = async (sigungu = '') => {
  if (!API) return null;
  try {
    const res = await fetch(`${API}/v1/coords/status?sigungu=${encodeURIComponent(sigungu)}`);
    if (!res.ok) return null;
    return (await res.json())?.data || null;
  } catch {
    return null;
  }
};
