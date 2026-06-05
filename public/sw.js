// ── 최소 서비스워커 (네트워크 통과 전용) ──────────────────────────────────────
// 목적: PWA 설치(바로가기)만 가능하게 하는 fetch 핸들러 제공.
// 앱 파일을 절대 캐시하지 않는다 → 옛 버전을 잡는 일이 없어 크래시 루프/스테일 캐시 불가능.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
// fetch 핸들러 존재 = 설치 가능 조건 충족. respondWith 안 함 → 항상 네트워크 그대로.
self.addEventListener('fetch', () => {});
