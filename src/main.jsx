import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// 최소 SW 등록(public/sw.js, 네트워크 통과 전용) — 바로가기 설치만 가능, 앱 캐시 안 함.
// 옛 vite-plugin-pwa precache 잔재는 비워 스테일 버전/크래시 근본 차단(새 SW는 캐시를 안 만듦).
if ('serviceWorker' in navigator) {
  if (window.caches?.keys) caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {})
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// PWA 설치 프롬프트를 앱 로드 즉시 잡아둔다('바로가기 만들기' 버튼이 사용)
window.__pwaInstallPrompt = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  window.__pwaInstallPrompt = e
  window.dispatchEvent(new Event('pwa-installable'))
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
