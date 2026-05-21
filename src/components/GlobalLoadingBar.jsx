import { CheckCircle2, Loader2, Database, Shield } from 'lucide-react';

export default function GlobalLoadingBar({ state }) {
  if (!state?.show) return null;

  const { msg, sub, pct, done, blocking } = state;

  // ── 전체화면 잠금 모드 (DB 저장 전용) ────────────────────────────
  if (blocking) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md select-none">
        {/* 배경 클릭 차단 — pointer-events-auto 로 이벤트 흡수 */}
        <div
          className="absolute inset-0"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        />

        {/* 중앙 카드 */}
        <div className="relative z-10 w-[520px] max-w-[92vw] bg-[#0a0a0a] border border-[#252525] rounded-3xl shadow-[0_30px_100px_rgba(0,0,0,0.95)] overflow-hidden">

          {/* 상단 컬러 스트라이프 */}
          <div
            className="h-1.5 w-full"
            style={{
              background: done
                ? 'linear-gradient(90deg,#15803d,#4ade80)'
                : 'linear-gradient(90deg,#1e3a8a,#3b82f6,#60a5fa,#3b82f6,#1e3a8a)',
              backgroundSize: '300% 100%',
              animation: done ? 'none' : 'shimmer-bar 2s linear infinite',
            }}
          />

          <div className="px-9 py-8">
            {/* 아이콘 + 제목 */}
            <div className="flex items-center gap-4 mb-6">
              <div className={`p-3 rounded-2xl ${done ? 'bg-green-950/50' : 'bg-blue-950/50'}`}>
                {done
                  ? <CheckCircle2 size={26} className="text-green-400" />
                  : <Database size={26} className={`text-blue-400 ${pct < 100 ? 'animate-pulse' : ''}`} />
                }
              </div>
              <div>
                <div className="text-white font-black text-[18px] leading-tight">{msg}</div>
                {sub && (
                  <div className="text-gray-400 text-[13px] mt-1">{sub}</div>
                )}
              </div>
              {pct !== null && pct !== undefined && (
                <div
                  className="ml-auto text-[32px] font-black tabular-nums leading-none"
                  style={{ color: done ? '#4ade80' : '#60a5fa' }}
                >
                  {pct}%
                </div>
              )}
            </div>

            {/* 프로그레스 바 */}
            {pct !== null && pct !== undefined && (
              <>
                <div className="h-3 bg-[#141414] rounded-full overflow-hidden border border-[#1e1e1e]">
                  <div
                    className="h-full rounded-full transition-all duration-400 ease-out"
                    style={{
                      width: `${pct}%`,
                      background: done
                        ? 'linear-gradient(90deg,#15803d,#4ade80)'
                        : 'linear-gradient(90deg,#1e3a8a,#3b82f6,#60a5fa)',
                    }}
                  />
                </div>
                {!done && (
                  <div className="flex items-center gap-2 mt-3.5">
                    <Shield size={12} className="text-amber-500 shrink-0" />
                    <span className="text-amber-500/80 text-[11px] font-medium">
                      저장이 완료될 때까지 창을 닫거나 다른 작업을 하지 마세요
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 기존 소형 토스트 모드 (파일 분석, 주소 정제 등) ──────────────
  return (
    <div
      className={`fixed bottom-6 left-1/2 z-[9999] pointer-events-none transition-all duration-300 ${
        state.show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
      style={{ transform: 'translateX(-50%)' }}
    >
      <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded-2xl px-5 py-3.5 shadow-[0_8px_40px_rgba(0,0,0,0.7)] min-w-[300px] max-w-[460px]">
        <div className="flex items-center gap-3">
          {done
            ? <CheckCircle2 size={17} className="text-green-400 shrink-0" />
            : <Loader2 size={17} className="text-blue-400 animate-spin shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold text-[13px] leading-tight truncate">{msg}</div>
            {sub && <div className="text-gray-500 text-[11px] mt-0.5 truncate">{sub}</div>}
          </div>
          {pct !== null && pct !== undefined && (
            <span
              className="text-[12px] font-black shrink-0 tabular-nums"
              style={{ color: done ? '#4ade80' : '#3b82f6' }}
            >
              {pct}%
            </span>
          )}
        </div>

        {pct !== null && pct !== undefined && (
          <div className="mt-2.5 h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${pct}%`,
                background: done
                  ? 'linear-gradient(90deg, #16a34a, #4ade80)'
                  : 'linear-gradient(90deg, #1d4ed8, #3b82f6)',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
