// 'merger' 탭 화면 — UtilsModal 에서 분리(2026-08-24 Phase 4-6).
//   UtilsModal 은 독립 도구들의 상자이고 탭끼리 상태를 공유하지 않는다(점검 실측) — 그래서 화면부터 뗀다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다(되돌리기 쉬움).
import { Download, Upload } from 'lucide-react';

export default function MergerTab({
  executeMerge,
  handleMergerUpload,
  isMerging,
  mergerFile,
  mergerFileName,
  setMergerFileName,
}) {
  return (
            <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-bold text-white mb-1">여러 시트를 하나로 합치기</h3>
              <p className="text-sm text-gray-400 mb-5">엑셀 파일 내 모든 시트를 단일 통합시트로 병합합니다.</p>
              <div className="space-y-4">
                <label className={`w-full py-7 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${mergerFile ? 'border-[#3b82f6] bg-[#3b82f6]/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                  <Upload size={28} className={mergerFile ? 'text-[#3b82f6] mb-2' : 'text-gray-500 mb-2'} />
                  <span className={`font-bold text-sm ${mergerFile ? 'text-[#3b82f6]' : 'text-gray-400'}`}>
                    {mergerFile ? mergerFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                  </span>
                  <input type="file" accept=".xlsx,.xls" onChange={handleMergerUpload} className="hidden" />
                </label>
                {mergerFile && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-400">저장 파일 이름</label>
                    <input value={mergerFileName} onChange={e => setMergerFileName(e.target.value)}
                      className="w-full bg-[#0a0a0a] border border-gray-700 rounded-xl px-4 py-2.5 text-white outline-none focus:border-[#3b82f6] font-bold text-sm" />
                  </div>
                )}
                <button onClick={executeMerge} disabled={!mergerFile || isMerging}
                  className="w-full py-3.5 bg-[#3b82f6] text-black font-extrabold rounded-xl hover:bg-[#93c5fd] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {isMerging ? '병합 중...' : <><Download size={16} /> 병합 및 다운로드</>}
                </button>
              </div>
            </div>
  );
}
