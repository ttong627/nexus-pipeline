// ══════════════════════════════════════════════════════════════════
//  C-5 좌표 저장소 클라 연동 — 설계서 좌표관리_설계.md §3-4
//  회귀: scripts/coord-store-api.test.mjs
//
//  ★선택 규칙은 서버 coordStore.js `pickDeliveryCoord` 와 **같아야 한다**.
//    클라가 제 나름대로 고르면 화면과 배치가 서로 다른 좌표를 쓰면서 아무 에러도
//    안 난다 — 가장 찾기 어려운 종류의 불일치다.
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
 * 용도에 맞는 좌표를 고른다 — 서버 pickDeliveryCoord 와 동일 규칙.
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
