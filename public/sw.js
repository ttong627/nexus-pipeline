// ── 자가제거 서비스워커 (새로고침 없음) ──────────────────────────────────────
// 과거에 설치된 서비스워커를 스스로 해제하고 모든 캐시를 비운다.
// navigate/reload 를 하지 않으므로 새로고침 churn·크래시 루프가 원천 불가능.
// 앱(main.jsx)은 더 이상 SW를 등록하지 않는다 → 정리 후 다시 생기지 않음.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { await self.registration.unregister(); } catch (e) { /* ignore */ }
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* ignore */ }
  })());
});
