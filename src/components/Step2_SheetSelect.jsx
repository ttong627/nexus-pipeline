import { useRef } from 'react';
import { FileSpreadsheet, ChevronLeft, ArrowRight, AlertTriangle, FilePlus } from 'lucide-react';

export default function Step2_SheetSelect({ step, setStep, fileInfo, worksheets, setWorksheets, setSelectedSheets, onHelp, handleSecondFileUpload }) {
  const secondFileInputRef = useRef(null);

  if (step !== 2) return null;

  const handleDrop = (e) => {
    e.preventDefault();
    // Second file upload logic here if needed
  };

  const handleSheetUpdate = (idx, field, value) => {
    const newSheets = [...worksheets];
    newSheets[idx][field] = value;
    setWorksheets(newSheets);
  };

  const proceedToMapping = () => {
    setSelectedSheets(worksheets.filter(s => s.selected));
    setStep(3);
  };

  const firstFileSheets  = worksheets.filter(s => !s.fileSource);
  const secondFileSheets = worksheets.filter(s => !!s.fileSource);
  const secondFileName   = secondFileSheets[0]?.fileSource || '';

  const renderRows = (sheets, startIdx) =>
    sheets.map((ws, i) => {
      const idx = startIdx + i;
      return (
        <tr key={idx} className={`transition-all duration-200 ${!ws.selected ? 'opacity-40 bg-black' : ws.type === '혼합' ? 'bg-[#1a1710]/40 hover:bg-[#1a1710]/80' : 'hover:bg-[#111]'}`}>
          <td className="px-6 py-4 text-center">
            <input type="checkbox" checked={ws.selected} onChange={(e) => handleSheetUpdate(idx, 'selected', e.target.checked)} className="w-5 h-5 accent-[#d4af37] cursor-pointer" />
          </td>
          <td className="px-6 py-4 font-mono font-bold text-white text-base">
            <div className="flex items-center gap-2">
              {ws.fileSource && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30 shrink-0">파일2</span>
              )}
              {ws.name}
            </div>
          </td>
          <td className="px-6 py-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                {ws.missingKeys.length > 0 ?
                  <span className="bg-[#1a0505] text-red-400 border border-red-900/50 px-2 py-0.5 rounded text-[11px] font-bold">🔴 누락: {ws.missingKeys.join(', ')}</span> :
                  ws.emptyWarnings.length > 0 ?
                    <span className="bg-[#1a1710] text-[#d4af37] border border-[#d4af37]/40 px-2 py-0.5 rounded text-[11px] font-bold">⚠️ 치명적 ({ws.emptyWarnings.join(', ')})</span> :
                    <span className="bg-[#111] text-gray-400 border border-gray-700 px-2 py-0.5 rounded text-[11px] font-bold">✔️ 완벽</span>
                }
                <span className="text-gray-300 text-xs font-medium">헤더: <b>{ws.headerRowIdx}행</b> / 명단시작: <b>{ws.dataStartRowIdx === -1 ? '-' : ws.dataStartRowIdx}행</b></span>
              </div>
              <div className="text-[11px] text-gray-500 max-w-[220px] truncate" title={ws.mappedKeys.join(', ')}>
                인식 완료: {ws.mappedKeys.join(', ')}
              </div>
            </div>
          </td>
          <td className="px-6 py-4 text-center font-mono text-gray-400 bg-black/20">{ws.rowsCount.toLocaleString()} 행</td>
          <td className="px-6 py-4">
            <select value={ws.type} onChange={(e) => handleSheetUpdate(idx, 'type', e.target.value)} disabled={!ws.selected} className="bg-[#111] border border-[#444] text-white px-4 py-2 rounded-lg outline-none focus:border-[#d4af37] font-bold">
              <option value="기초수급자">기초수급자</option>
              <option value="차상위">차상위</option>
              <option value="혼합">🔀 혼합 (자동구분)</option>
              <option value="제외">🚫 제외</option>
            </select>
          </td>
          <td className="px-6 py-4 text-right font-black text-[#d4af37] text-base">{ws.qty.toLocaleString()} 포</td>
        </tr>
      );
    });

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] max-w-6xl mx-auto w-full overflow-hidden">
      <div className="bg-gradient-to-b from-[#1a1710] to-[#0a0a0a] px-8 py-5 border-b border-[#333] flex justify-between items-center shrink-0 shadow-lg">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-3 drop-shadow-md"><FileSpreadsheet size={24} className="text-[#d4af37]" /> 2단계: 워크시트 분류</h2>
          <p className="text-gray-400 mt-1.5 font-medium">처리할 대상을 켜고 분류(수급/차상위)를 확인하세요.</p>
        </div>
        <div className="flex gap-4">
          <button onClick={() => setStep(1)} className="px-6 py-3 bg-gray-800 border border-gray-600 text-white font-extrabold rounded-xl hover:bg-gray-700 transition-all shadow-md flex items-center gap-2">
            <ChevronLeft size={18} strokeWidth={3} /> 업로드로 돌아가기
          </button>
          <button onClick={proceedToMapping} className="px-8 py-3 bg-[#d4af37] text-black font-extrabold rounded-xl shadow-[0_0_15px_rgba(212,175,55,0.6)] hover:bg-[#f3e5ab] hover:scale-105 transition-all flex items-center gap-2 uppercase tracking-wide">
            컬럼 매핑 진행 <ArrowRight size={18} strokeWidth={3} />
          </button>
          <button
            onClick={onHelp}
            className="w-10 h-10 rounded-full bg-[#0d1a0f] border border-[#22c55e]/40 text-[#22c55e] font-black text-base hover:bg-[#22c55e]/20 hover:scale-110 transition-all shrink-0"
            style={{ animation: 'help-pulse 2.5s ease-in-out infinite' }}
            title="2단계 도움말"
          >?</button>
        </div>
      </div>

      {worksheets.length > 0 && worksheets.every(ws => ws.rowsCount === 0) && (
        <div className="bg-yellow-950/80 border-b border-yellow-500/50 px-8 py-3 flex items-center gap-3 text-yellow-400 font-bold shadow-inner">
          <AlertTriangle className="animate-pulse" size={18} />
          <span>시트에서 유효한 데이터 행을 찾지 못했습니다. 헤더 행이 상단 20행 이내에 있는지 확인하거나, 시트 선택 후 직접 매핑을 진행해주세요.</span>
        </div>
      )}

      <div className="flex-1 overflow-auto p-8 scrollbar-thin scrollbar-thumb-[#444] scrollbar-track-transparent">
        <div className="border border-white/10 rounded-xl overflow-hidden shadow-[0_0_20px_rgba(0,0,0,0.5)] bg-black/40">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-[#111] border-b border-[#333] text-[#d4af37] font-extrabold text-sm tracking-wide">
              <tr>
                <th className="px-6 py-4 w-20 text-center">선택</th>
                <th className="px-6 py-4">엑셀 시트명</th>
                <th className="px-6 py-4">🤖 AI 구조 분석 리포트</th>
                <th className="px-6 py-4 text-center">유효 행 개수</th>
                <th className="px-6 py-4">분류 매칭</th>
                <th className="px-6 py-4 text-right">예상 포수</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-gray-200 text-sm">
              {renderRows(firstFileSheets, 0)}
              {secondFileSheets.length > 0 && (
                <>
                  <tr>
                    <td colSpan={6} className="px-6 py-2 bg-[#0d1a0f]/80 border-y border-[#22c55e]/20">
                      <span className="text-[11px] font-black text-[#22c55e] tracking-widest">📄 추가 파일 — {secondFileName}</span>
                    </td>
                  </tr>
                  {renderRows(secondFileSheets, firstFileSheets.length)}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* 추가 파일 드롭존 */}
        <div className="mt-6">
          <p className="text-[11px] text-gray-600 font-black tracking-widest mb-3">
            ━━ 추가 파일 {secondFileName ? `(현재: ${secondFileName} — 다시 드롭하면 교체)` : '(양식이 다른 차상위/수급자 파일이 있는 경우)'}
          </p>
          <label
            className={`flex items-center justify-center gap-3 w-full border-2 border-dashed rounded-xl p-5 cursor-pointer transition-all group ${secondFileName ? 'border-[#22c55e]/40 bg-[#0d1a0f]/40 hover:border-[#22c55e]/70' : 'border-[#333] hover:border-[#22c55e]/50'}`}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => secondFileInputRef.current?.click()}
          >
            <FilePlus size={20} className={`shrink-0 transition-colors ${secondFileName ? 'text-[#22c55e]' : 'text-gray-600 group-hover:text-[#22c55e]'}`} />
            <div>
              <p className={`text-sm font-bold transition-colors ${secondFileName ? 'text-[#86efac]' : 'text-gray-500 group-hover:text-[#22c55e]'}`}>
                {secondFileName ? `${secondFileName} 로드됨 — 교체하려면 클릭하거나 드래그` : '다른 양식의 명단 파일 추가 (드래그 또는 클릭)'}
              </p>
              <p className="text-[11px] text-gray-700 mt-0.5">기초수급자·차상위가 별도 파일에 분리된 경우 / 업로드 시 시트 목록에 추가됩니다</p>
            </div>
            <input ref={secondFileInputRef} type="file" className="hidden" accept=".xlsx,.xls,.csv"
              onChange={e => { if (e.target.files?.[0]) handleSecondFileUpload(e.target.files[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>
    </div>
  );
}
