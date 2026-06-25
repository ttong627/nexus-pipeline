import { useState } from 'react';
import { Sparkles, X, ListChecks, ChevronRight } from 'lucide-react';
import { APP_VERSION, APP_BUILD, CHANGELOG } from '../version.js';

/**
 * WhatsNewModal — 업데이트 내역 팝업
 *
 * - 새 버전 첫 접속 시 자동 표시(App.jsx에서 localStorage 비교로 제어)
 * - "이 버전 다시 안 보기"(auto=true일 때만) → onDontShowAgain
 * - "전체 업데이트 내역 보기" ⇄ "이번 버전만 보기" 토글
 *
 * Props:
 *   onClose          () => void        닫기
 *   onDontShowAgain  () => void        이 버전 다시 안 보기(자동 표시에서만 노출)
 *   auto             bool              자동 표시 여부(다시 안 보기 버튼 노출 조건)
 *   startAll         bool              처음부터 전체 내역으로 열기(수동 열기 시 true)
 */
export default function WhatsNewModal({ onClose, onDontShowAgain, auto = false, startAll = false }) {
  const [showAll, setShowAll] = useState(!!startAll);

  const latest = CHANGELOG[0] || { v: APP_VERSION, date: APP_BUILD, items: [] };
  const list = showAll ? CHANGELOG : [latest];

  return (
    <div
      className="fixed inset-0 z-[760] flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-[#0f1c18] to-[#0a0f0d] shadow-2xl shadow-emerald-950/40 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="relative px-6 pt-6 pb-5 border-b border-white/10 bg-emerald-500/[0.04]">
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white transition-all flex items-center justify-center"
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-300 shrink-0">
              <Sparkles size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">무엇이 새로워졌나요</h2>
              <p className="text-xs text-emerald-300/80 mt-0.5 tracking-wide">
                NEXUS PIPELINE {APP_VERSION} · {APP_BUILD}
              </p>
            </div>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {list.map((rel, idx) => (
            <section key={`${rel.v}-${rel.date}`}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-widest border ${
                    idx === 0 && !showAll
                      ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40'
                      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  }`}
                >
                  {rel.v}
                </span>
                <span className="text-[11px] text-gray-500">{rel.date}</span>
                {idx === 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/25">
                    최신
                  </span>
                )}
              </div>
              <ul className="space-y-2.5">
                {rel.items.map((item, i) => (
                  <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-gray-300">
                    <ChevronRight size={15} className="mt-0.5 shrink-0 text-emerald-400/70" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {!showAll && CHANGELOG.length > 1 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/10 text-sm text-gray-400 hover:text-emerald-300 hover:border-emerald-500/30 hover:bg-emerald-500/[0.04] transition-all"
            >
              <ListChecks size={16} />
              전체 업데이트 내역 보기 ({CHANGELOG.length}개 버전)
            </button>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-white/10 bg-black/20 flex items-center justify-between gap-3">
          <div>
            {auto && (
              <button
                type="button"
                onClick={onDontShowAgain}
                className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-4 decoration-gray-600 transition-colors"
              >
                이 버전 다시 보지 않기
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showAll && (
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
              >
                최신 버전만
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-emerald-950 bg-emerald-400 hover:bg-emerald-300 transition-all"
            >
              확인
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
