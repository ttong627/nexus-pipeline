import React from 'react';
import { Database, UploadCloud, Loader2 } from 'lucide-react';

export default function Step1_Upload({ handleDragOver, handleDrop, handleFileUpload, handleUnifiedDrop, isBaseUploading, step, onHelp, onCloudFetch }) {
  if (step !== 1) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      {/* 도움말 버튼 */}
      <button
        onClick={onHelp}
        className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-[#080f0c] border border-emerald-500/30 text-emerald-400 font-black text-base hover:bg-emerald-500/15 hover:border-emerald-400/60 transition-all"
        title="1단계 도움말"
      >?</button>

      <div className="w-full max-w-lg flex flex-col gap-4">

        {/* 메인 업로드 영역 */}
        <label
          onDragOver={handleDragOver}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation();
            if (e.dataTransfer?.files?.length >= 2) handleUnifiedDrop(e);
            else handleFileUpload(e);
          }}
          className={`
            relative flex flex-col items-center py-16 px-10
            bg-[#090f0d]/80 backdrop-blur-xl
            border-2 border-dashed rounded-2xl cursor-pointer
            transition-all duration-200 group
            ${isBaseUploading
              ? 'border-emerald-500/60 bg-emerald-950/10'
              : 'border-emerald-500/25 hover:border-emerald-400/70 hover:bg-emerald-950/10'
            }
          `}
          style={{ boxShadow: '0 0 0 1px rgba(16,185,129,0.04) inset, 0 20px 60px rgba(0,0,0,0.5)' }}
        >
          {/* 배경 glow — hover 시만 강조 */}
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          {isBaseUploading ? (
            <div className="relative mb-5">
              <Loader2 size={52} className="text-emerald-400 animate-spin" />
            </div>
          ) : (
            <div className="relative mb-5">
              <div className="w-16 h-16 rounded-2xl bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center group-hover:border-emerald-400/60 transition-colors">
                <UploadCloud size={32} className="text-emerald-400 group-hover:text-emerald-300 transition-colors" />
              </div>
            </div>
          )}

          <h3 className="text-xl font-black text-white mb-2 tracking-tight">
            {isBaseUploading ? '기초 명단 파싱 중...' : '엑셀 파일을 끌어다 놓거나 클릭하여 선택'}
          </h3>
          <p className="text-gray-500 text-center text-sm font-medium leading-relaxed">
            {isBaseUploading
              ? '잠시만 기다려 주세요'
              : '.xlsx · .xls · .csv 형식 지원 · 복수 파일 동시 업로드 가능'
            }
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

        {/* 클라우드 명단 불러오기 */}
        <button
          onClick={onCloudFetch}
          className="w-full py-3.5 bg-[#0a1410]/80 border border-emerald-500/20 rounded-xl text-emerald-400 font-bold text-sm hover:bg-emerald-950/30 hover:border-emerald-400/50 transition-all flex items-center justify-center gap-2.5 group"
        >
          <Database size={17} className="group-hover:scale-110 transition-transform shrink-0" />
          클라우드 기준 명단 불러오기 (CRM)
        </button>

      </div>
    </div>
  );
}
