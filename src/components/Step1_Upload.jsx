import React from 'react';
import { Database, FileSpreadsheet, CheckCircle, UploadCloud, Loader2 } from 'lucide-react';

export default function Step1_Upload({ handleDragOver, handleDrop, handleFileUpload, handleUnifiedDrop, isBaseUploading, step, onHelp, onCloudFetch }) {
  if (step !== 1) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      {/* 도움말 버튼 */}
      <button
        onClick={onHelp}
        className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-[#0d1a0f] border border-[#22c55e]/40 text-[#22c55e] font-black text-base hover:bg-[#22c55e]/20 hover:scale-110 transition-all"
        style={{ animation: 'help-pulse 2.5s ease-in-out infinite' }}
        title="1단계 도움말"
      >?</button>
      <div className="w-full max-w-2xl relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-[#22c55e] via-[#86efac] to-[#166534] rounded-[2.5rem] blur opacity-20 group-hover:opacity-70 transition duration-1000 animate-pulse"></div>
        <label 
          onDragOver={handleDragOver} 
          onDrop={(e) => { 
            e.preventDefault(); e.stopPropagation(); 
            if (e.dataTransfer?.files?.length >= 2) handleUnifiedDrop(e);
            else handleFileUpload(e); 
          }} 
          className="relative flex flex-col items-center py-20 px-12 bg-[#0a0a0a]/80 backdrop-blur-xl border-2 border-dashed border-[#22c55e]/40 hover:border-[#22c55e] hover:bg-[#111]/90 rounded-[2rem] cursor-pointer shadow-[0_10px_40px_rgba(0,0,0,0.8)] transform group-hover:-translate-y-2 transition-all duration-300"
        >
          {isBaseUploading ? (
            <div className="w-24 h-24 mb-6 flex items-center justify-center">
              <Loader2 size={64} className="text-[#22c55e] animate-spin" />
            </div>
          ) : (
            <img src="ttlogo.jpg" alt="Logo" className="w-24 h-24 rounded-full border-4 border-[#22c55e]/50 shadow-[0_0_20px_rgba(34,197,94,0.8)] mb-6 drop-shadow-2xl" onError={(e) => e.target.style.display='none'} />
          )}
          
          <h3 className="text-3xl font-black text-white mb-3 tracking-tight drop-shadow-[0_2px_4px_rgba(0,0,0,1)]">
            {isBaseUploading ? '기초 명단 파싱 중...' : '명단 엑셀 드롭'}
          </h3>
          <p className="text-gray-400 text-center text-base font-medium leading-relaxed">
            파일을 드래그하거나 클릭하여 업로드하면 분석이 시작됩니다.
          </p>
          <input type="file" multiple className="hidden" accept=".xlsx,.xls,.csv" onChange={(e) => { 
            if (e.target.files.length >= 2) handleUnifiedDrop(e);
            else handleFileUpload(e); 
            e.target.value = ''; 
          }} disabled={isBaseUploading} />
        </label>
        
        <button 
          onClick={onCloudFetch}
          className="mt-6 w-full py-4 bg-gradient-to-r from-[#22c55e]/10 to-[#166534]/10 border border-[#22c55e]/30 rounded-2xl text-[#22c55e] font-bold text-lg hover:bg-[#22c55e]/20 hover:border-[#22c55e] transition-all flex items-center justify-center gap-2 group"
        >
          <Database size={20} className="group-hover:scale-110 transition-transform" />
          클라우드 기준 명단 불러오기 (CRM)
        </button>
      </div>
    </div>
  );
}
