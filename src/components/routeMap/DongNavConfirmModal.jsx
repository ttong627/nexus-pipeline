// 행정동 이동 확인 모달 — 미저장 변경이 있을 때 묻는다(RouteMapModal 에서 분리 · 2026-08-23 Phase 4-5).
//   ★이 확인이 없으면 동을 옮기는 순간 배정이 조용히 사라진다(수동 체크리스트 7번).
//   상태는 부모가 들고 있고 여기는 **묻고 고르는 것**만 한다 — 저장·이동은 콜백이 처리한다.
import { AlertCircle } from 'lucide-react';

export default function DongNavConfirmModal({ currentDong, targetDong, onSaveAndGo, onDiscardAndGo, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[700] flex items-center justify-center p-4">
      <div className="w-full max-w-xs bg-[#0d0d0d] border border-amber-500/40 rounded-2xl p-5 shadow-[0_0_40px_rgba(245,158,11,0.15)]">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle size={16} className="text-amber-400 shrink-0" />
          <span className="text-sm font-black text-white">미저장 변경이 있습니다</span>
        </div>
        <p className="text-[10px] text-gray-400 mb-4 leading-relaxed">
          <span className="text-amber-300 font-bold">{currentDong}</span> 배정 결과가 저장되지 않았습니다.<br />
          다음 행정동(<span className="text-white font-bold">{targetDong}</span>)으로 이동하면 현재 배정이 유실됩니다.
        </p>
        <div className="space-y-2">
          <button
            onClick={onSaveAndGo}
            className="w-full py-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 font-black rounded-xl text-xs transition-colors"
          >
            저장 후 이동
          </button>
          <button
            onClick={onDiscardAndGo}
            className="w-full py-2 bg-[#111] border border-[#2a2a2a] text-gray-400 hover:text-white hover:border-[#3a3a3a] font-bold rounded-xl text-xs transition-colors"
          >
            저장 안 하고 이동
          </button>
          <button
            onClick={onCancel}
            className="w-full py-1.5 text-gray-600 hover:text-gray-400 text-xs transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
