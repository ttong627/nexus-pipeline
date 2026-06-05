import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// 서비스워커 영구 미사용 — 남아있는 SW/캐시는 즉시 해제·삭제(크래시 재발 원천 차단).
// 등록도 새로고침도 하지 않는다. PWA 설치 기능 없음.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {})
}
if (window.caches?.keys) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
