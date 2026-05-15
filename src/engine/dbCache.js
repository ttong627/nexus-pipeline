// IndexedDB 영구 스토리지 — 연결을 한 번만 열고 재사용
let _dbPromise = null;

export const getDB = () => {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("NexusJusoDB", 1);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore("jusoCache", { keyPath: "keyword" });
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
      req.onsuccess = () => resolve(req.result?.data || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
};

export const setLocalCache = async (keyword, data) => {
  try {
    const db = await getDB();
    return new Promise(resolve => {
      const tx = db.transaction("jusoCache", "readwrite");
      tx.objectStore("jusoCache").put({ keyword, data });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // 에러 발생 시 무한 대기 방지
      tx.onabort = () => resolve(); // 트랜잭션 중단 시에도 스무스하게 진행
    });
  } catch {
    return null; // Promise Hang 방지
  }
};