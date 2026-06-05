import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { registerSW } from 'virtual:pwa-register'

// 서비스워커 등록(autoUpdate). 워크박스 설정상 HTML(index)은 항상 네트워크 우선이라
// 옛 버전/청크를 잡는 일이 없음 → 스테일·크래시 루프 불가. 청크 에러는 ErrorBoundary가 1회 복구.
registerSW({ immediate: true })

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
