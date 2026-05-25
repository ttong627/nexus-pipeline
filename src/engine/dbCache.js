// IndexedDB 영구 스토리지 — 연결을 한 번만 열고 재사용
// TTL: 90일 (주소 데이터는 장기간 유효하나 무한 누적 방지)
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;

let _dbPromise = null;

export const getDB = () => {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("NexusJusoDB", 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("jusoCache")) {
          db.createObjectStore("jusoCache", { keyPath: "keyword" });
        }
        // v2: cachedAt 인덱스 추가 (TTL 정리용)
        const store = e.target.transaction.objectStore("jusoCache");
        if (!store.indexNames.contains("cachedAt")) {
          store.createIndex("cachedAt", "cachedAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { _dbPromise = null; reject(req.error); };
    });
  }
  return _dbPromise;
};

export const getLocalCache = async (keyword) => {
  try {
    const db = await getDB();
    return new Promise(resolve => {
      const req = db.transaction("jusoCache", "readonly").objectStore("jusoCache").get(keyword);
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry) return resolve(null);
        // TTL 만료 체크 — cachedAt 없는 구버전 항목은 유효로 간주
        if (entry.cachedAt && Date.now() - entry.cachedAt > CACHE_TTL_MS) return resolve(null);
        resolve(entry.data || null);
      };
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
};

export const setLocalCache = async (keyword, data) => {
  try {
    const db = await getDB();
    return new Promise(resolve => {
      const tx = db.transaction("jusoCache", "readwrite");
      tx.objectStore("jusoCache").put({ keyword, data, cachedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { return null; }
};

// 앱 시작 시 1회 비동기 호출 — 만료 항목 삭제 + MAX_CACHE_ENTRIES 초과 시 오래된 것부터 제거
export const cleanupExpiredCache = async () => {
  try {
    const db = await getDB();
    const expireThreshold = Date.now() - CACHE_TTL_MS;

    // 1단계: TTL 만료 항목 삭제
    await new Promise(resolve => {
      const tx = db.transaction("jusoCache", "readwrite");
      const store = tx.objectStore("jusoCache");
      const index = store.index("cachedAt");
      const range = IDBKeyRange.upperBound(expireThreshold);
      const req = index.openCursor(range);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });

    // 2단계: 총 개수가 MAX_CACHE_ENTRIES 초과 시 가장 오래된 것부터 제거
    await new Promise(resolve => {
      const tx = db.transaction("jusoCache", "readwrite");
      const store = tx.objectStore("jusoCache");
      const countReq = store.count();
      countReq.onsuccess = () => {
        const total = countReq.result;
        if (total <= MAX_CACHE_ENTRIES) return resolve();
        const toDelete = total - MAX_CACHE_ENTRIES;
        let deleted = 0;
        const idx = store.index("cachedAt");
        const curReq = idx.openCursor();
        curReq.onsuccess = (e) => {
          const c = e.target.result;
          if (c && deleted < toDelete) { c.delete(); deleted++; c.continue(); }
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* 정리 실패는 무시 — 앱 동작에 영향 없음 */ }
};
