import { useState } from 'react';
import { UploadCloud, Loader2, Sparkles, Settings2, LayoutDashboard, ScanSearch } from 'lucide-react';

export default function Step1_Upload({
  handleDragOver, handleFileUpload, handleUnifiedDrop, isBaseUploading, step, onHelp, onOpenDashboard,
  cleanMode = 'easy', setCleanMode, analyzing = false,
}) {
  // Hooks는 항상 최상단에서 무조건 호출 (React Hooks 규칙 — 조기 반환 이전)
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [dragActive, setDragActive] = useState(false);
  if (step !== 1) return null;
  const isEasy = cleanMode === 'easy';
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const onMove = (e) => {
    if (reduceMotion) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ rx: +(-py * 5).toFixed(2), ry: +(px * 5).toFixed(2) });
  };
  const onLeave = () => setTilt({ rx: 0, ry: 0 });

  return (
    <div
      className="absolute inset-0 overflow-y-auto"
      style={{ perspective: '1200px' }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <style>{`
        @keyframes nx-grid { from { background-position: 0 0; } to { background-position: 0 40px; } }
        @keyframes nx-pulse { 0%,100% { transform: scale(1); opacity:.55; } 50% { transform: scale(1.12); opacity:1; } }
        @keyframes nx-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
      `}</style>

      {/* 은은한 3D 그리드 배경 */}
      {!reduceMotion && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div style={{
            position: 'absolute', left: '-30%', right: '-30%', bottom: '-10%', height: '70%',
            transform: 'perspective(500px) rotateX(60deg)',
            backgroundImage: 'linear-gradient(rgba(16,185,129,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.22) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            animation: 'nx-grid 5s linear infinite',
            maskImage: 'linear-gradient(to top, black, transparent)',
            WebkitMaskImage: 'linear-gradient(to top, black, transparent)',
          }} />
        </div>
      )}

      {/* 상단 바: 대시보드 메뉴 + 도움말 */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-5 py-3 bg-[#070807]/80 backdrop-blur-md border-b border-[#141d1c]">
        <button
          onClick={onOpenDashboard}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0a1410] border border-emerald-500/25 text-emerald-300 font-bold text-sm hover:bg-emerald-950/30 hover:border-emerald-400/50 transition-all"
          title="지자체 현황 대시보드로 이동"
        >
          <LayoutDashboard size={16} /> 지자체 현황 대시보드
        </button>
        <button
          type="button"
          onClick={onHelp}
          className="w-9 h-9 rounded-full bg-[#080f0c] border border-emerald-500/30 text-emerald-400 font-black text-base hover:bg-emerald-500/15 hover:border-emerald-400/60 transition-all"
          title="1단계 도움말"
          aria-label="1단계 도움말 열기"
        >?</button>
      </div>

      {/* 본문 — 마우스 추종 3D 틸트 */}
      <div className="min-h-[calc(100%-58px)] flex items-center justify-center px-6 py-8 relative">
        <div
          className="w-full max-w-3xl flex flex-col gap-7 relative"
          style={{
            transformStyle: 'preserve-3d',
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
            transition: 'transform 0.15s ease-out',
          }}
        >
          {/* 헤더 */}
          <div className="text-center" style={{ transform: 'translateZ(35px)' }}>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 mb-4" style={reduceMotion ? undefined : { animation: 'nx-float 4s ease-in-out infinite' }}>
              <Sparkles size={26} className="text-emerald-300" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow-[0_4px_20px_rgba(16,185,129,0.25)]">명단 정제 시작하기</h1>
            <p className="text-gray-500 text-sm sm:text-base mt-2.5 leading-relaxed">
              파일을 올리면 <b className="text-emerald-300/90">전체 시트를 정밀 분석</b>해 진짜 명단만 골라 정제합니다.<br className="hidden sm:block" />
              방식을 고르고 파일을 올려주세요.
            </p>
          </div>

          {/* 정제 방식 선택 */}
          <div style={{ transform: 'translateZ(20px)' }}>
            <p className="text-center text-gray-500 text-xs font-black tracking-widest uppercase mb-3">정제 방식 선택</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <button
                onClick={() => setCleanMode?.('easy')}
                className={`text-left rounded-2xl border p-5 transition-all ${isEasy
                  ? 'border-emerald-400/70 bg-emerald-500/10 shadow-[0_0_30px_rgba(52,211,153,0.2)]'
                  : 'border-[#1a2725] bg-[#0a0f0e] hover:border-emerald-500/40 hover:bg-emerald-950/10'}`}
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isEasy ? 'bg-emerald-500/20 border border-emerald-400/40' : 'bg-black/30 border border-white/10'}`}>
                    <Sparkles size={20} className={isEasy ? 'text-emerald-300' : 'text-gray-500'} />
                  </div>
                  <span className={`text-lg font-black ${isEasy ? 'text-emerald-200' : 'text-gray-300'}`}>쉬운 정제</span>
                  {isEasy && <span className="ml-auto text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">추천</span>}
                </div>
                <p className="text-[13px] text-gray-400 leading-relaxed">파일만 올리면 칼럼 자동 매칭 → 애매한 것만 확인 → 바로 정제</p>
              </button>
              <button
                onClick={() => setCleanMode?.('advanced')}
                className={`text-left rounded-2xl border p-5 transition-all ${!isEasy
                  ? 'border-cyan-400/70 bg-cyan-500/10 shadow-[0_0_30px_rgba(6,182,212,0.2)]'
                  : 'border-[#1a2725] bg-[#0a0f0e] hover:border-cyan-500/40 hover:bg-cyan-950/10'}`}
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${!isEasy ? 'bg-cyan-500/20 border border-cyan-400/40' : 'bg-black/30 border border-white/10'}`}>
                    <Settings2 size={20} className={!isEasy ? 'text-cyan-300' : 'text-gray-500'} />
                  </div>
                  <span className={`text-lg font-black ${!isEasy ? 'text-cyan-200' : 'text-gray-300'}`}>고급 정제</span>
                </div>
                <p className="text-[13px] text-gray-400 leading-relaxed">시트 선택·컬럼 매핑을 직접 확인하고 조정합니다</p>
              </button>
            </div>
          </div>

          {/* 파일 업로드 */}
          <label
            onDragOver={(e) => { handleDragOver?.(e); if (!reduceMotion) setDragActive(true); }}
            onDragEnter={() => { if (!reduceMotion) setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              setDragActive(false);
              if (e.dataTransfer?.files?.length >= 2) handleUnifiedDrop(e);
              else handleFileUpload(e);
            }}
            className={`
              relative flex flex-col items-center py-20 px-10
              bg-[#090f0d]/80 backdrop-blur-xl
              border-2 border-dashed rounded-3xl cursor-pointer transition-all duration-200 group
              ${isBaseUploading
                ? 'border-emerald-500/60 bg-emerald-950/10'
                : dragActive
                  ? 'border-emerald-400 bg-emerald-950/20 shadow-[0_0_50px_rgba(52,211,153,0.35)]'
                  : 'border-emerald-500/30 hover:border-emerald-400/70 hover:bg-emerald-950/10'}
            `}
            style={{
              transformStyle: 'preserve-3d',
              transform: `translateZ(${dragActive ? 70 : 40}px) scale(${dragActive ? 1.02 : 1})`,
              transition: 'transform 0.18s ease-out, box-shadow 0.18s, border-color 0.18s, background 0.18s',
              boxShadow: '0 0 0 1px rgba(16,185,129,0.04) inset, 0 24px 70px rgba(0,0,0,0.5)',
            }}
          >
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-b from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

            {isBaseUploading ? (
              <div className="relative mb-6"><Loader2 size={60} className="text-emerald-400 animate-spin" /></div>
            ) : (
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-3xl bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center group-hover:border-emerald-400/60 group-hover:scale-105 transition-all">
                  <UploadCloud size={40} className="text-emerald-400 group-hover:text-emerald-300 transition-colors" />
                </div>
              </div>
            )}

            <h3 className="text-2xl font-black text-white mb-2.5 tracking-tight text-center">
              {isBaseUploading ? '기초 명단 파싱 중...' : dragActive ? '여기에 놓으세요!' : '엑셀 파일을 끌어다 놓거나 클릭하여 선택'}
            </h3>
            <p className="text-gray-500 text-center text-sm font-medium leading-relaxed">
              {isBaseUploading ? '잠시만 기다려 주세요' : '.xlsx · .xls · .csv 형식 지원 · 복수 파일 동시 업로드 가능'}
            </p>

            <input
              type="file"
              multiple
              className="hidden"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                if (e.target.files.length >= 2) handleUnifiedDrop(e);
                else handleFileUpload(e);
                e.target.value = '';
              }}
              disabled={isBaseUploading}
            />
          </label>

          {/* 정밀 분석 오버레이 */}
          {analyzing && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#070807]/88 backdrop-blur-sm rounded-3xl" style={{ transform: 'translateZ(80px)' }}>
              <div className="text-center px-6">
                <div className="mx-auto mb-5 w-20 h-20 rounded-3xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center" style={reduceMotion ? undefined : { animation: 'nx-pulse 1.2s ease-in-out infinite' }}>
                  <ScanSearch size={36} className="text-emerald-300" />
                </div>
                <h3 className="text-xl font-black text-emerald-200 mb-2">명단 정밀 분석 중…</h3>
                <p className="text-gray-400 text-sm leading-relaxed">전체 시트 읽는 중 · 찌꺼기 제거 · 진짜 명단 탐지 · 헤더/데이터행 정밀 매칭</p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
