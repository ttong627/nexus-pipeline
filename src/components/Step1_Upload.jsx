import React from 'react';
import { UploadCloud, Loader2, Sparkles, Settings2, LayoutDashboard } from 'lucide-react';

export default function Step1_Upload({
  handleDragOver, handleDrop, handleFileUpload, handleUnifiedDrop, isBaseUploading, step, onHelp, onOpenDashboard,
  cleanMode = 'easy', setCleanMode,
}) {
  if (step !== 1) return null;
  const isEasy = cleanMode === 'easy';

  return (
    <div className="absolute inset-0 overflow-y-auto">
      {/* ── 상단 바: 대시보드 메뉴 + 도움말 ── */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-5 py-3 bg-[#070807]/80 backdrop-blur-md border-b border-[#141d1c]">
        <button
          onClick={onOpenDashboard}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0a1410] border border-emerald-500/25 text-emerald-300 font-bold text-sm hover:bg-emerald-950/30 hover:border-emerald-400/50 transition-all"
          title="지자체 현황 대시보드로 이동"
        >
          <LayoutDashboard size={16} /> 지자체 현황 대시보드
        </button>
        <button
          onClick={onHelp}
          className="w-9 h-9 rounded-full bg-[#080f0c] border border-emerald-500/30 text-emerald-400 font-black text-base hover:bg-emerald-500/15 hover:border-emerald-400/60 transition-all"
          title="1단계 도움말"
        >?</button>
      </div>

      {/* ── 본문 ── */}
      <div className="min-h-[calc(100%-58px)] flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-3xl flex flex-col gap-7">

          {/* 헤더 */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 mb-4">
              <Sparkles size={26} className="text-emerald-300" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">명단 정제 시작하기</h1>
            <p className="text-gray-500 text-sm sm:text-base mt-2.5 leading-relaxed">
              엑셀 명단을 올리면 주소·연락처를 자동으로 정제합니다.<br className="hidden sm:block" />
              방식을 고르고 파일을 올려주세요.
            </p>
          </div>

          {/* ── 정제 방식 선택 ── */}
          <div>
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

          {/* ── 파일 업로드 ── */}
          <label
            onDragOver={handleDragOver}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              if (e.dataTransfer?.files?.length >= 2) handleUnifiedDrop(e);
              else handleFileUpload(e);
            }}
            className={`
              relative flex flex-col items-center py-20 px-10
              bg-[#090f0d]/80 backdrop-blur-xl
              border-2 border-dashed rounded-3xl cursor-pointer transition-all duration-200 group
              ${isBaseUploading
                ? 'border-emerald-500/60 bg-emerald-950/10'
                : 'border-emerald-500/30 hover:border-emerald-400/70 hover:bg-emerald-950/10'}
            `}
            style={{ boxShadow: '0 0 0 1px rgba(16,185,129,0.04) inset, 0 24px 70px rgba(0,0,0,0.5)' }}
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
              {isBaseUploading ? '기초 명단 파싱 중...' : '엑셀 파일을 끌어다 놓거나 클릭하여 선택'}
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

        </div>
      </div>
    </div>
  );
}
