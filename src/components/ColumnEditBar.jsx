import { Check, X, RotateCcw, Move } from 'lucide-react';

// ── 칼럼 편집 플로팅 바 ──────────────────────────────────────────────────────
// 편집 모드에서 화면 하단 중앙에 떠서 기본복원/취소/완료(저장) 제공.
export default function ColumnEditBar({ onReset, onCancel, onCommit }) {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2 px-3 py-2 rounded-2xl border border-emerald-500/40 bg-[#0a140d]/95 backdrop-blur-xl"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(16,185,129,0.15)' }}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-black text-emerald-300 px-1">
        <Move size={13} /> 칼럼 편집 중 — 헤더를 끌어 순서·폭 조절, 👁로 표시/숨김
      </span>
      <div className="h-5 w-px bg-emerald-500/20" />
      <button
        onClick={onReset}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-gray-400 hover:text-amber-300 hover:bg-amber-400/10 transition-colors"
      >
        <RotateCcw size={12} /> 기본값
      </button>
      <button
        onClick={onCancel}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X size={12} /> 취소
      </button>
      <button
        onClick={onCommit}
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-black bg-emerald-500 text-black hover:bg-emerald-400 transition-colors"
        style={{ boxShadow: '0 0 12px rgba(16,185,129,0.3)' }}
      >
        <Check size={13} strokeWidth={3} /> 완료(저장)
      </button>
    </div>
  );
}
