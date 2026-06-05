import { Zap } from 'lucide-react';

export default function LoadingScreen({ progress }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#070908]/95 backdrop-blur-xl z-50 p-4">
      <div className="w-[30rem] p-10 bg-[#090f0d] border border-emerald-500/15 rounded-3xl shadow-[0_0_80px_rgba(16,185,129,0.12)] flex flex-col items-center">
        {/* 아이콘 + 회전 링 */}
        <div className="relative mb-8">
          <div className="absolute inset-0 rounded-full border-2 border-emerald-500/20 border-t-emerald-400 animate-spin" style={{ width: 72, height: 72, margin: 'auto' }} />
          <div className="w-[72px] h-[72px] flex items-center justify-center">
            <Zap size={32} className="text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.8)]" />
          </div>
        </div>

        {/* 레이블 */}
        <div className="flex justify-between w-full text-sm mb-3 font-mono">
          <span className="text-emerald-400 font-black tracking-widest text-xs">NEXUS ADDRESS ENGINE</span>
          <span className="text-white font-bold tabular-nums">{progress.percent}%</span>
        </div>

        {/* 진행 바 */}
        <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden mb-5 border border-white/5">
          <div
            className="h-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-teal-300 rounded-full transition-all duration-300"
            style={{ width: `${progress.percent}%` }}
          />
        </div>

        <p className="text-center text-gray-400 text-sm font-medium">{progress.desc}</p>
      </div>
    </div>
  );
}
