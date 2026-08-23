// 자동 핀 배치 확인 모달 — 계산 결과를 **적용하기 전에** 기사별 배정 건수와 품질 점수를 보여 준다
//   (RouteMapModal 에서 분리 · 2026-08-23 Phase 4-5).
//   ★적용/재배정은 부모 콜백이 한다 — 이 컴포넌트는 보여주고 고르게만 한다.
import { MapPin } from 'lucide-react';

export default function AutoPinConfirmModal({ data, drivers, driverCount, onApply, onAdjustPins }) {
  if (!data) return null;
  const { clusterMap, pendingPins, diagnostics } = data;
  const score = diagnostics?.qualityScore;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[600] flex items-center justify-center p-4">
      <div className="w-full max-w-xs bg-[#0a0a0a] border border-emerald-500/30 rounded-2xl p-5 shadow-[0_0_50px_rgba(16,185,129,0.15)]">
        <div className="flex items-center gap-2 mb-1">
          <MapPin size={14} className="text-emerald-400 shrink-0" />
          <span className="text-sm font-black text-white">자동 핀 배치 완료</span>
        </div>
        <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
          기사별 배정 구역 중심에 핀을 자동 생성했습니다.<br />이대로 확정하거나 핀을 조정 후 재배정할 수 있습니다.
        </p>

        <div className="space-y-1.5 mb-4 bg-[#111] rounded-xl p-3">
          {drivers.slice(0, driverCount).filter(d => !d.isExternal).map(d => {
            const cnt = Object.values(clusterMap).filter(id => id === d.id).length;
            const isNew = !!pendingPins[d.id];
            return (
              <div key={d.id} className="flex items-center gap-2 text-[11px]">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                <span className="text-gray-200 flex-1 font-medium">{d.name}</span>
                <span className="text-gray-500">{cnt.toLocaleString()}건</span>
                {isNew && <span className="text-[9px] text-emerald-400 font-black">📍신규</span>}
              </div>
            );
          })}
          {score !== undefined && (
            <div className="mt-2 pt-2 border-t border-[#1e1e1e] flex items-center justify-between text-[9px]">
              <span className="text-gray-600">품질 점수</span>
              <span className={`font-black ${score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                {score}점
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onApply}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs transition-colors"
          >
            이대로 확정
          </button>
          <button
            onClick={onAdjustPins}
            className="w-full py-2 bg-[#111] border border-[#2a2a2a] text-gray-400 hover:text-white hover:border-emerald-500/40 font-bold rounded-xl text-xs transition-colors"
          >
            핀 조정 후 재배정
          </button>
        </div>
      </div>
    </div>
  );
}
