import { AlertCircle, AlertTriangle } from 'lucide-react';

// ══════════════════════════════════════════════════════════════════
//  프리미엄 삭제 확인 모달 — 월삭제 모달 디자인 통일
//  · dangerous=true: step 1(경고) → step 2(최종 확인) 2단계
//  · ConfirmDeleteContext가 Promise 기반으로 제어
// ══════════════════════════════════════════════════════════════════
export default function ConfirmDeleteModal({
  target, count = null, note = '', dangerous = false, step = 1, onCancel, onProceed,
}) {
  const countStr = count != null ? `${Number(count).toLocaleString()}건` : '';
  const isFinal = dangerous && step === 2;

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[200] p-4"
      onClick={onCancel}
    >
      <div
        className={`bg-[#0e0e0e] border rounded-2xl p-6 w-full max-w-sm shadow-[0_0_40px_rgba(239,68,68,0.2)] ${isFinal ? 'border-red-500/60' : 'border-red-500/30'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-3">
          {isFinal
            ? <AlertTriangle className="text-red-500 shrink-0" size={20} />
            : <AlertCircle className="text-red-400 shrink-0" size={18} />}
          <h3 className="text-white font-black text-sm">{isFinal ? '최종 확인' : '삭제 확인'}</h3>
        </div>

        <p className="text-gray-200 text-sm font-bold mb-2 leading-snug">
          {target}{countStr && <span className="text-red-400"> {countStr}</span>}
        </p>

        {note && !isFinal && (
          <p className="text-gray-500 text-[11px] mb-2 leading-relaxed whitespace-pre-line max-h-32 overflow-y-auto">{note}</p>
        )}

        <p className="text-gray-500 text-xs mb-5 leading-relaxed">
          {isFinal
            ? `${countStr ? countStr + '이(가) ' : ''}영구 삭제됩니다. 정말 진행하시겠습니까?`
            : '이 작업은 되돌릴 수 없습니다.'}
        </p>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-white/5 border border-[#333] text-gray-400 font-bold rounded-xl text-sm hover:bg-white/10 transition-colors"
          >
            취소
          </button>
          <button
            onClick={onProceed}
            className={`flex-1 py-2.5 font-bold rounded-xl text-sm transition-colors border ${
              isFinal
                ? 'bg-red-600/80 border-red-500 text-white hover:bg-red-600'
                : 'bg-red-950/60 border-red-500/50 text-red-400 hover:bg-red-900/60'
            }`}
          >
            {dangerous && step === 1 ? '계속' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  );
}
