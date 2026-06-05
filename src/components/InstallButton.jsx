import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';

// ── 바로가기 만들기 (PWA 설치) 버튼 ──────────────────────────────────────────
// main.jsx에서 미리 잡아둔 beforeinstallprompt(window.__pwaInstallPrompt)를 사용.
// 설치 가능하면 네이티브 설치창, 아니면 수동 안내. 이미 설치된 경우 숨김.
export default function InstallButton() {
  const [available, setAvailable] = useState(() => !!window.__pwaInstallPrompt);
  const [installed, setInstalled] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches
  );

  useEffect(() => {
    const onAvail = () => setAvailable(!!window.__pwaInstallPrompt);
    const onInstalled = () => { setInstalled(true); setAvailable(false); window.__pwaInstallPrompt = null; };
    window.addEventListener('pwa-installable', onAvail);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('pwa-installable', onAvail);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    const dp = window.__pwaInstallPrompt;
    if (dp) {
      dp.prompt();
      try {
        const { outcome } = await dp.userChoice;
        if (outcome === 'accepted') { setAvailable(false); window.__pwaInstallPrompt = null; }
      } catch { /* ignore */ }
    } else {
      alert(
        '바로가기 만들기\n\n' +
        '• 크롬/엣지(PC): 주소창 오른쪽 설치(⊕) 아이콘 또는 메뉴 → "앱 설치"\n' +
        '• 아이폰 사파리: 공유 → "홈 화면에 추가"\n' +
        '• 안드로이드 크롬: 메뉴 → "앱 설치 / 홈 화면에 추가"\n\n' +
        '설치하면 바탕화면·홈에서 바로 열 수 있어요.'
      );
    }
  };

  return (
    <button
      onClick={handleClick}
      title="바탕화면·홈 화면에 바로가기 설치"
      className="px-3 py-1.5 bg-[#1a1030] hover:bg-[#231542] text-purple-300 hover:text-purple-200 border border-purple-600/40 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shrink-0"
    >
      <Download size={13} />
      <span className="hidden sm:inline">바로가기 만들기</span>
    </button>
  );
}
