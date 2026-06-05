import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// 서비스워커는 등록하지 않는다(selfDestroying SW가 기존 등록을 자동 해제).
// 혹시 남아있는 SW가 있으면 즉시 해제 + 캐시 비우기(크래시/스테일 캐시 근본 차단).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {})
  if (window.caches?.keys) caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
