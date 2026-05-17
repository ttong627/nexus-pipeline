import { CheckCircle2, Loader2 } from 'lucide-react';

export default function GlobalLoadingBar({ state }) {
  if (!state?.show) return null;

  const { msg, sub, pct, done } = state;

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
