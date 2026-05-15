import { FileSpreadsheet, CheckCircle, Database, ChevronRight } from 'lucide-react';

const CursorSVG = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 1L3 17L7.5 13L10.5 20L13 19L10 12L16 12Z" fill="white" stroke="#22c55e" strokeWidth="1.2" strokeLinejoin="round"/>
  </svg>
);

export default function Dashboard({ user, onStart, onHelp }) {
  const totalRows = user?.totalRowsProcessed || 0;
  const totalFiles = user?.totalFilesProcessed || 0;

  return (
    <div className="flex-1 w-full h-full overflow-hidden bg-transparent flex flex-col p-8 lg:p-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3">
            NEXUS <span className="text-[#22c55e]">PIPELINE</span> <span className="bg-[#22c55e]/20 text-[#22c55e] px-2 py-1 rounded text-sm tracking-widest ml-2 border border-[#22c55e]/30">V4.0</span>
          </h1>
          <p className="text-gray-400 mt-2 text-sm">최고의 속도와 정확도를 자랑하는 명단 정제 관제 센터</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-white font-bold">{user?.name || '관리자'}</p>
            <p className="text-[#22c55e] text-xs">System Operator</p>
          </div>
          {user?.photoURL ? (
            <img src={user.photoURL} alt="Profile" className="w-12 h-12 rounded-full border-2 border-[#22c55e]/50 shadow-[0_0_15px_rgba(34,197,94,0.3)]" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-[#111] border-2 border-[#22c55e]/50 flex items-center justify-center shadow-[0_0_15px_rgba(34,197,94,0.3)]">
              <span className="text-[#22c55e] font-bold text-lg">{user?.name?.charAt(0) || 'A'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-gradient-to-br from-[#0d1a0f] to-[#0a0a0a] border border-[#22c55e]/30 rounded-3xl p-6 shadow-[0_0_30px_rgba(34,197,94,0.1)] relative overflow-hidden group hover:border-[#22c55e]/60 transition-colors">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#22c55e]/10 rounded-full blur-2xl group-hover:bg-[#22c55e]/20 transition-all"></div>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-[#22c55e]/20 rounded-2xl flex items-center justify-center text-[#22c55e]">
              <Database size={24} />
            </div>
            <div>
              <p className="text-gray-400 text-sm font-bold">누적 정제 데이터</p>
              <h2 className="text-3xl font-black text-white">{totalRows.toLocaleString()}<span className="text-sm text-gray-500 ml-1 font-normal">건</span></h2>
            </div>
          </div>
          <div className="w-full bg-[#111] h-1.5 rounded-full overflow-hidden">
            <div className="bg-[#22c55e] h-full w-[85%] shadow-[0_0_10px_#22c55e]"></div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-[#0d1a0f] to-[#0a0a0a] border border-[#22c55e]/30 rounded-3xl p-6 shadow-[0_0_30px_rgba(34,197,94,0.1)] relative overflow-hidden group hover:border-[#22c55e]/60 transition-colors">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#22c55e]/10 rounded-full blur-2xl group-hover:bg-[#22c55e]/20 transition-all"></div>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-[#22c55e]/20 rounded-2xl flex items-center justify-center text-[#22c55e]">
              <FileSpreadsheet size={24} />
            </div>
            <div>
              <p className="text-gray-400 text-sm font-bold">처리한 파일 수</p>
              <h2 className="text-3xl font-black text-white">{totalFiles.toLocaleString()}<span className="text-sm text-gray-500 ml-1 font-normal">개</span></h2>
            </div>
          </div>
          <div className="w-full bg-[#111] h-1.5 rounded-full overflow-hidden">
            <div className="bg-[#22c55e] h-full w-[60%] shadow-[0_0_10px_#22c55e]"></div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-[#0d1a0f] to-[#0a0a0a] border border-[#22c55e]/30 rounded-3xl p-6 shadow-[0_0_30px_rgba(34,197,94,0.1)] relative overflow-hidden group hover:border-[#22c55e]/60 transition-colors">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#22c55e]/10 rounded-full blur-2xl group-hover:bg-[#22c55e]/20 transition-all"></div>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-[#22c55e]/20 rounded-2xl flex items-center justify-center text-[#22c55e]">
              <CheckCircle size={24} />
            </div>
            <div>
              <p className="text-gray-400 text-sm font-bold">정제 완료율</p>
              <h2 className="text-3xl font-black text-[#22c55e]">
                {totalRows > 0 ? '99%+' : '-'}
                <span className="text-sm text-gray-500 ml-1 font-normal">정확도</span>
              </h2>
            </div>
          </div>
          <p className="text-xs text-[#86efac] mt-2 flex items-center gap-1">
            <CheckCircle size={12} /> AI 주소 엔진 + 오타 사전 적용
          </p>
        </div>
      </div>

      {/* Main Action Area */}
      <div className="flex-1 bg-black/40 border border-white/5 rounded-3xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#22c55e]/5 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="w-20 h-20 bg-gradient-to-b from-[#22c55e]/20 to-transparent border border-[#22c55e]/50 rounded-full flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(34,197,94,0.2)]">
          <Database size={32} className="text-[#22c55e]" />
        </div>
        <h2 className="text-2xl font-black text-white mb-2">새로운 명단 정제 시작</h2>
        <p className="text-gray-400 text-sm mb-8 max-w-md">
          정제할 엑셀 파일을 업로드하고 파이프라인을 가동하세요. AI 주소 엔진과 오타 사전이 자동으로 가장 완벽한 명단으로 변환합니다.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <button
            onClick={onStart}
            className="group relative px-8 py-4 bg-[#22c55e] text-black font-extrabold rounded-2xl text-lg hover:scale-105 transition-all shadow-[0_0_30px_rgba(34,197,94,0.4)] flex items-center gap-3 overflow-hidden"
          >
            <span className="relative z-10">파이프라인 가동</span>
            <ChevronRight size={20} className="relative z-10 group-hover:translate-x-1 transition-transform" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
          </button>
          
          <button
            onClick={() => onStart(6)} // Step 6 is Base List Manager
            className="group relative px-8 py-4 bg-transparent border-2 border-[#22c55e]/50 text-[#22c55e] font-extrabold rounded-2xl text-lg hover:bg-[#22c55e]/10 transition-all flex items-center gap-3"
          >
            <span>기본 명단 관리</span>
            <Database size={20} className="group-hover:scale-110 transition-transform" />
          </button>
        </div>

        {/* 도움말 힌트 — 애니메이션 커서 + ? 버튼 */}
        <div className="relative mt-6 flex flex-col items-center gap-2">
          <div className="relative">
            {/* 애니메이션 커서 */}
            <div
              className="absolute pointer-events-none z-10"
              style={{ animation: 'cursor-hint 3s ease-in-out infinite', bottom: '100%', right: '100%' }}
            >
              <CursorSVG />
            </div>
            {/* ? 버튼 */}
            <button
              onClick={onHelp}
              className="w-11 h-11 rounded-full bg-[#0d1a0f] border border-[#22c55e]/50 text-[#22c55e] font-black text-lg hover:bg-[#22c55e]/20 hover:scale-110 transition-all"
              style={{ animation: 'help-pulse 2.5s ease-in-out infinite' }}
              title="도움말 보기"
            >
              ?
            </button>
          </div>
          <p className="text-gray-600 text-xs tracking-wide">이용 가이드</p>
        </div>
      </div>
      
    </div>
  );
}
