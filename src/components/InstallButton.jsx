import { useState, useEffect } from 'react';
import { Download, MoreVertical, ChevronRight, X } from 'lucide-react';

// ── 바로가기 만들기 (PWA 설치) 버튼 ──────────────────────────────────────────
// beforeinstallprompt(window.__pwaInstallPrompt)가 잡혀 있으면 네이티브 설치창.
// 아직 준비 안 됐으면 크롬 기본 '바로가기 만들기' 사용법을 안내창으로 표시(안전, SW 무관).
export default function InstallButton() {
  const [installed, setInstalled] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches
  );
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    const onInstalled = () => { setInstalled(true); window.__pwaInstallPrompt = null; };
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    const dp = window.__pwaInstallPrompt;
    if (dp) {
      try {
        dp.prompt();
        const { outcome } = await dp.userChoice;
        if (outcome === 'accepted') { window.__pwaInstallPrompt = null; setInstalled(true); }
      } catch { setGuideOpen(true); }
    } else {
      setGuideOpen(true);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        title="바탕화면·홈 화면에 바로가기 만들기"
        className="px-3 py-1.5 bg-[#1a1030] hover:bg-[#231542] text-purple-300 hover:text-purple-200 border border-purple-600/40 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shrink-0"
      >
        <Download size={13} />
        <span className="hidden sm:inline">바로가기 만들기</span>
      </button>

      {guideOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setGuideOpen(false)}
        >
          <div
            className="w-full max-w-md bg-[#0b0b12] border border-purple-600/30 rounded-3xl p-7 shadow-[0_0_60px_rgba(139,92,246,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-purple-200 flex items-center gap-2">
                <Download size={18} /> 바탕화면 바로가기 만들기
              </h2>
              <button onClick={() => setGuideOpen(false)} className="text-gray-500 hover:text-gray-300 transition-colors">
                <X size={20} />
              </button>
            </div>

            <p className="text-gray-400 text-sm mb-5 leading-relaxed">
              아래 순서대로 누르면 바탕화면에 아이콘이 생깁니다. 다음부턴 그 아이콘으로 바로 열 수 있어요.
            </p>

            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-3 bg-[#13131d] rounded-2xl px-4 py-3 border border-[#222]">
                <span className="w-6 h-6 shrink-0 rounded-full bg-purple-600/30 text-purple-200 text-xs font-black flex items-center justify-center">1</span>
                <span className="text-gray-200 text-sm flex items-center gap-1.5">
                  크롬 우측 상단 <MoreVertical size={15} className="inline text-purple-300" /> (점 3개) 클릭
                </span>
              </div>
              <div className="flex items-center gap-3 bg-[#13131d] rounded-2xl px-4 py-3 border border-[#222]">
                <span className="w-6 h-6 shrink-0 rounded-full bg-purple-600/30 text-purple-200 text-xs font-black flex items-center justify-center">2</span>
                <span className="text-gray-200 text-sm flex items-center gap-1 flex-wrap">
                  <b className="text-white">도구 더보기</b> <ChevronRight size={14} className="text-gray-500" /> <b className="text-white">바로가기 만들기</b>
                </span>
              </div>
              <div className="flex items-center gap-3 bg-[#13131d] rounded-2xl px-4 py-3 border border-[#222]">
                <span className="w-6 h-6 shrink-0 rounded-full bg-purple-600/30 text-purple-200 text-xs font-black flex items-center justify-center">3</span>
                <span className="text-gray-200 text-sm">
                  이름 확인 후 <b className="text-white">[만들기]</b> 클릭 → 끝!
                </span>
              </div>
            </div>

            <div className="text-[11px] text-gray-500 bg-black/30 rounded-xl px-4 py-3 mb-5 leading-relaxed">
              📱 <b className="text-gray-400">휴대폰</b>: 아이폰 사파리 → 공유 → <b className="text-gray-400">홈 화면에 추가</b> / 안드로이드 크롬 → 메뉴 → <b className="text-gray-400">홈 화면에 추가</b>
            </div>

            <button
              onClick={() => setGuideOpen(false)}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-extrabold rounded-xl transition-all shadow-[0_0_20px_rgba(139,92,246,0.4)]"
            >
              알겠어요
            </button>
          </div>
        </div>
      )}
    </>
  );
}
