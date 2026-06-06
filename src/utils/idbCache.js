// IndexedDB 키-값 캐시 — 비동기(메인스레드 블로킹 없음), 대용량(localStorage 4MB 한계 없음),
// 세션 간 지속. 명단 캐시처럼 큰 JSON을 동기 직렬화/저장하던 렉을 제거한다.
// 값은 구조화 복제(structured clone)로 그대로 저장 — JSON.stringify/parse 불필요.

const DB_NAME = 'nexus_cache';
const STORE = 'kv';
const DB_VERSION = 1;

let dbPromise = null;
function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
  return dbPromise;
}

/** key의 값 반환(없으면 null). 실패 시 null(안전 폴백). */
export async function idbGet(key) {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

/** key에 value 저장(구조화 복제). 실패는 무시. */
export async function idbSet(key, value) {
  try {
    const db = await getDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* quota/접근 실패 무시 */ }
}

/** key 삭제. 실패는 무시. */
export async function idbDel(key) {
  try {
    const db = await getDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}
