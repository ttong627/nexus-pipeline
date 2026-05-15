import { useState } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Columns, Download, Trash2, Edit3 } from 'lucide-react';

export default function ResultGrid({
  step, setStep, filter, setFilter, gridData, filteredData, paginatedData,
  currentPage, setCurrentPage, itemsPerPage, colVis,
  handleCellEdit, handleAddressKeyDown, handleUpdateBaseList, setShowExportSetting, handleExport, handleExportErrors, handleExportDongSummary,
  handleDeleteRows, handleBatchSetNote, onHelp
}) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchNoteOpen, setBatchNoteOpen] = useState(false);
  const [batchNoteValue, setBatchNoteValue] = useState('');
  const [updateModalRow, setUpdateModalRow] = useState(null);

  if (step !== 5) return null;

  const pageIds = new Set(paginatedData.map(r => r.id));
  const allPageSelected = pageIds.size > 0 && [...pageIds].every(id => selectedIds.has(id));

  const toggleAll = () => {
    if (allPageSelected) {
      setSelectedIds(prev => { const n = new Set(prev); pageIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); pageIds.forEach(id => n.add(id)); return n; });
    }
  };

  const toggleRow = (id) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  return (
    <>
      {batchNoteOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0a0a0a] border border-purple-500/40 rounded-2xl p-6 shadow-[0_0_40px_rgba(168,85,247,0.2)]">
            <h3 className="text-base font-black text-purple-300 mb-2">특이사항 일괄 설정</h3>
            <p className="text-gray-500 text-xs mb-4">선택된 <span className="text-white font-bold">{selectedIds.size}건</span>의 특이사항을 아래 내용으로 덮어씁니다.</p>
            <textarea
              className="w-full bg-[#111] border border-[#444] text-white p-3 rounded-xl outline-none focus:border-purple-500 text-sm resize-none mb-4"
              rows={3}
              placeholder="특이사항 내용을 입력하세요..."
              value={batchNoteValue}
              onChange={e => setBatchNoteValue(e.target.value)}
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setBatchNoteOpen(false)} className="flex-1 py-2.5 bg-[#111] text-gray-400 font-bold rounded-xl border border-gray-700 hover:bg-[#222] text-sm transition-colors">취소</button>
              <button onClick={() => {
                handleBatchSetNote(selectedIds, batchNoteValue);
                setBatchNoteOpen(false);
                setSelectedIds(new Set());
              }} className="flex-1 py-2.5 bg-purple-700 text-white font-extrabold rounded-xl hover:bg-purple-600 text-sm transition-colors">적용</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col h-full bg-[#0a0a0a]/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#333] bg-gradient-to-r from-[#111] to-[#050505] shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="flex space-x-2 bg-black/50 p-1 rounded-lg border border-white/5">
              <button onClick={() => setFilter('ALL')} className={`px-5 py-2 text-xs rounded-md transition-all ${filter==='ALL' ? 'bg-[#222] border border-[#22c55e] text-[#22c55e] font-black shadow-[0_0_10px_rgba(34,197,94,0.2)]' : 'text-gray-400 hover:text-white'}`}>전체보기 ({gridData.length.toLocaleString()})</button>
              <button onClick={() => setFilter('ERROR')} className={`px-5 py-2 text-xs rounded-md flex items-center gap-1.5 transition-all ${filter==='ERROR' ? 'bg-red-950/50 border border-red-500 text-red-400 font-black shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'text-gray-400 hover:text-white'}`}><AlertTriangle size={14}/> 확인필요 ({gridData.filter(d=>d._에러).length.toLocaleString()})</button>
              <button onClick={() => setFilter('SUCCESS')} className={`px-5 py-2 text-xs rounded-md flex items-center gap-1.5 transition-all ${filter==='SUCCESS' ? 'bg-green-950/50 border border-green-500 text-green-400 font-black shadow-[0_0_10px_rgba(34,197,94,0.2)]' : 'text-gray-400 hover:text-white'}`}><CheckCircle size={14}/> 정제완료 ({gridData.filter(d=>!d._에러).length.toLocaleString()})</button>
            </div>
            {(() => {
              const matched = gridData.filter(d => d._이식됨);
              if (matched.length === 0) return null;
              const byBirth = matched.filter(d => d._매칭방식 === '이름+생년월일').length;
              const byPhone = matched.filter(d => d._매칭방식 === '이름+휴대폰').length;
              const byContact2 = matched.filter(d => d._매칭방식 === '이름+추가연락처').length;
              return (
                <div title={`①이름+생년월일: ${byBirth}건\n②이름+휴대폰: ${byPhone}건\n③이름+추가연락처: ${byContact2}건`}
                  className="flex items-center gap-1.5 bg-[#0d1a0f] border border-[#22c55e]/30 text-[#86efac] text-xs font-bold px-3 py-2 rounded-lg cursor-default">
                  <span className="drop-shadow-[0_0_4px_rgba(34,197,94,0.8)]">👑</span>
                  기준명단 이식 {matched.length.toLocaleString()}건
                  <span className="text-[#22c55e]/50 font-normal">
                    (①생년월일 {byBirth} · ②휴대폰 {byPhone} · ③추가연락처 {byContact2})
                  </span>
                </div>
              );
            })()}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setStep(3)} className="px-5 py-2 bg-gray-800 border border-gray-600 text-white font-extrabold rounded-lg hover:bg-gray-700 transition-all shadow-md flex items-center gap-2 text-xs">
              <ChevronLeft size={16} strokeWidth={3}/> 매핑으로 돌아가기
            </button>
            <div className="flex items-center space-x-3 text-xs text-gray-300 bg-black/60 px-4 py-1.5 rounded-lg border border-white/10 shadow-inner">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="hover:text-[#22c55e] disabled:opacity-20 transition-colors"><ChevronLeft size={16}/></button>
              <span className="font-mono font-bold">{currentPage} / {Math.ceil(filteredData.length / itemsPerPage) || 1} PAGE</span>
              <button onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredData.length / itemsPerPage), p + 1))} disabled={currentPage === Math.ceil(filteredData.length / itemsPerPage) || filteredData.length===0} className="hover:text-[#22c55e] disabled:opacity-20 transition-colors"><ChevronRight size={16}/></button>
            </div>

            {selectedIds.size > 0 && (
              <>
                <span className="text-xs text-amber-400 font-black border border-amber-500/40 bg-amber-950/20 px-3 py-2 rounded-lg">
                  {selectedIds.size.toLocaleString()}건 선택
                </span>
                <button
                  onClick={() => { setBatchNoteOpen(true); setBatchNoteValue(''); }}
                  className="px-4 py-2 bg-purple-900/60 border border-purple-500/60 text-purple-300 font-bold rounded-lg text-xs flex items-center gap-1.5 hover:bg-purple-800/60 transition-all"
                >
                  <Edit3 size={13}/> 특이사항 일괄
                </button>
                <button
                  onClick={() => {
                    if (!window.confirm(`선택한 ${selectedIds.size}건을 삭제하시겠습니까?`)) return;
                    handleDeleteRows(selectedIds);
                    setSelectedIds(new Set());
                  }}
                  className="px-4 py-2 bg-red-900/60 border border-red-500/60 text-red-400 font-bold rounded-lg text-xs flex items-center gap-1.5 hover:bg-red-800/60 transition-all"
                >
                  <Trash2 size={13}/> 선택 삭제
                </button>
              </>
            )}

            <button onClick={() => setShowExportSetting(true)} className="px-5 py-2 bg-[#111] border border-white/20 text-gray-300 font-bold rounded-lg hover:bg-[#222] transition-all text-xs flex items-center gap-1.5">
              <Columns size={14}/> 컬럼 설정
            </button>
            {gridData.filter(d => d._에러).length > 0 && (
              <button onClick={handleExportErrors} className="px-5 py-3 bg-red-950/60 border border-red-500/60 text-red-400 font-extrabold rounded-xl hover:bg-red-900/60 hover:scale-105 transition-all flex items-center gap-2 text-xs">
                <AlertTriangle size={14}/> 오류만 내보내기 ({gridData.filter(d => d._에러).length})
              </button>
            )}
            <button onClick={handleExportDongSummary} className="px-6 py-3 bg-blue-900/60 border border-blue-500/60 text-blue-300 font-extrabold rounded-xl hover:bg-blue-800/70 hover:scale-105 transition-all flex items-center gap-2 text-xs">
              <Download size={14}/> 행정동별 보고서
            </button>
            <button onClick={handleExport} className="px-8 py-3 bg-[#22c55e] text-black font-extrabold rounded-xl shadow-[0_0_15px_rgba(34,197,94,0.6)] hover:bg-[#86efac] hover:scale-105 transition-all flex items-center gap-2 uppercase tracking-tight text-xs">
              <Download size={16} strokeWidth={2.5}/> 표준 명단 패키징
            </button>
            <button
              onClick={onHelp}
              className="w-9 h-9 rounded-full bg-[#0d1a0f] border border-[#22c55e]/40 text-[#22c55e] font-black text-base hover:bg-[#22c55e]/20 hover:scale-110 transition-all shrink-0"
              style={{ animation: 'help-pulse 2.5s ease-in-out infinite' }}
              title="결과 화면 도움말"
            >?</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto relative scrollbar-thin scrollbar-thumb-[#555] scrollbar-track-black/50">
          <table className="w-full text-left text-[12px] whitespace-nowrap border-collapse">
            <thead className="sticky top-0 bg-[#0a100c] z-20 text-gray-400 shadow-[0_5px_15px_rgba(0,0,0,0.8)] border-b-2 border-[#333]">
              <tr>
                <th className="px-2 py-3 font-bold border-r border-[#222] text-center sticky left-0 bg-[#0a100c] z-30 shadow-[2px_0_5px_rgba(0,0,0,0.5)] w-10">
                  <input type="checkbox" checked={allPageSelected} onChange={toggleAll} className="accent-[#22c55e] w-4 h-4 cursor-pointer" />
                </th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center sticky left-10 bg-[#0a100c] z-30 shadow-[2px_0_5px_rgba(0,0,0,0.5)]">NO</th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">구분</th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">행정구역</th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">성명</th>
                {colVis.birth && <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">생년월일</th>}
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">포수</th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">메인(휴대폰)</th>
                {colVis.contact2 && <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">보조(유선)</th>}
                {colVis.sms && <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">문자수신</th>}
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-[#22c55e] bg-gradient-to-b from-[#0d1a0f] to-[#0a0a0a] text-sm min-w-[400px]">통합 주소 (클릭하여 텍스트 직접 수정)</th>
                {colVis.note && <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">특이사항 / 비고</th>}
                {colVis.driver && <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">기사</th>}
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">오류 사유</th>
              </tr>
            </thead>
            <tbody className="font-mono text-gray-200">
              {paginatedData.map((row, idx) => {
                const isSelected = selectedIds.has(row.id);
                return (
                  <tr key={row.id} className={`border-b border-[#222] group h-10 transition-colors ${isSelected ? 'bg-amber-950/20' : row._에러 ? 'bg-red-950/20 hover:bg-red-900/40' : 'bg-transparent hover:bg-[#0d1a0f]/60'}`}>
                    <td className={`px-2 py-1.5 border-r border-[#222] text-center sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.3)] ${isSelected ? 'bg-amber-950/40' : row._에러 ? 'bg-[#1a0505]' : 'bg-[#0a0a0a] group-hover:bg-[#0f1f12]'}`}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.id)} className="accent-[#22c55e] w-4 h-4 cursor-pointer" />
                    </td>
                    <td className={`px-4 py-1.5 border-r border-[#222] text-center sticky left-10 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.3)] font-bold ${isSelected ? 'bg-amber-950/40 text-amber-300' : row._에러 ? 'bg-[#1a0505] text-red-400 border-l-4 border-l-red-500' : 'bg-[#0a0a0a] group-hover:bg-[#0f1f12] text-gray-500'}`}>
                      <div className="flex items-center justify-center gap-1">
                        {row._이식됨 && <span title={`기준명단 이식됨 (${row._매칭방식 || ''})`} className="text-[#22c55e] text-xs drop-shadow-[0_0_5px_rgba(34,197,94,0.8)] animate-pulse">👑</span>}
                        {((currentPage - 1) * itemsPerPage + idx + 1).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-4 py-1.5 border-r border-[#222] text-center">
                      <span className={`px-2 py-1 rounded-md text-[10px] font-bold tracking-widest border ${
                        row.구분 === '기초수급자' ? 'bg-[#111] text-gray-300 border-gray-600' :
                        row.구분 === '차상위'     ? 'bg-[#0d1a0f] text-[#22c55e] border-[#22c55e]/40' :
                                                   'bg-[#050505] text-gray-500 border-gray-800'
                      }`}>{row.구분}</span>
                    </td>
                    <td className="px-4 py-1.5 border-r border-[#222] max-w-[120px] truncate text-gray-400">{row.행정동}</td>
                    <td className="px-4 py-1.5 border-r border-[#222] font-black text-white text-[13px] drop-shadow-md">{row.이름}</td>
                    {colVis.birth && <td className="px-4 py-1.5 border-r border-[#222] text-center text-gray-300 font-mono tracking-wider">{row.생년월일}</td>}
                    <td className="px-4 py-1.5 border-r border-[#222] text-center text-[#22c55e] font-black bg-black/20">{Number(row.포수).toLocaleString()}</td>
                    <td className="px-4 py-1.5 border-r border-[#222] text-gray-300 font-bold tracking-wider">{row.휴대폰}</td>
                    {colVis.contact2 && <td className="px-4 py-1.5 border-r border-[#222] text-gray-500 tracking-wider">{row.유선전화}</td>}
                    {colVis.sms && <td className="px-4 py-1.5 border-r border-[#222] text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${row.문자수신 === 'Y' ? 'bg-[#22c55e]/20 text-[#86efac] border border-[#22c55e]/30' : 'bg-transparent text-gray-600 border border-gray-700'}`}>{row.문자수신}</span></td>}

                    <td className="px-1 py-1 border-r border-l-2 border-l-[#22c55e]/50 border-r-[#222] relative bg-black/40 group-hover:bg-black/60 transition-colors">
                      <input className={`w-full h-full bg-transparent px-3 py-1.5 rounded outline-none focus:bg-[#0d1a0f] focus:ring-2 focus:ring-[#22c55e] shadow-inner font-bold transition-all ${row._에러 ? 'text-red-400 placeholder-red-800' : 'text-[#22c55e]'}`} value={row.주소} onChange={(e) => handleCellEdit(row.id, '주소', e.target.value)} onKeyDown={(e) => handleAddressKeyDown(e, row)} title={row._에러 ? `[오류사유] ${row._사유} (Enter키로 즉시 재정제)` : 'Enter키로 즉시 재정제'} placeholder="주소가 비어있습니다. 수정 후 Enter"/>
                    </td>

                    {colVis.note && (
                      <td className={`px-1 py-1 border-r border-[#222] bg-black/40 group-hover:bg-black/60 min-w-[180px] transition-colors ${row._이식됨 ? 'border-l-2 border-l-[#22c55e]/30 bg-[#22c55e]/5' : ''}`}>
                        <input className={`w-full h-full bg-transparent px-3 py-1.5 rounded outline-none focus:bg-[#0d1a0f] focus:ring-2 focus:ring-[#86efac] shadow-inner font-medium transition-all ${row._이식됨 ? 'text-[#86efac]' : 'text-gray-300'}`} value={row.특이사항} onChange={(e) => handleCellEdit(row.id, '특이사항', e.target.value)} placeholder=""/>
                      </td>
                    )}
                    {colVis.driver && (
                      <td className={`px-1 py-1 border-r border-[#222] bg-black/20 min-w-[80px] ${row._이식됨 ? 'border-l-2 border-l-[#22c55e]/30 bg-[#22c55e]/5' : ''}`}>
                        <input className={`w-full bg-transparent px-2 py-1.5 rounded outline-none focus:bg-[#0d1a0f] focus:ring-1 focus:ring-[#22c55e] text-xs font-mono transition-all ${row._이식됨 ? 'text-[#86efac]' : 'text-gray-300'}`} value={row.기사} onChange={(e) => handleCellEdit(row.id, '기사', e.target.value)} placeholder="기사"/>
                      </td>
                    )}
                    <td className={`px-4 py-1.5 text-xs font-bold ${row._에러 ? 'text-red-400' : 'text-gray-600'}`}>
                      <div className="flex items-center gap-2">
                        <span>{row._에러 ? row._사유 : '정상'}</span>
                        {row._업데이트필요 && (
                          <button
                            onClick={() => setUpdateModalRow(row)}
                            className="px-2 py-1 bg-amber-500 text-black font-extrabold rounded text-[10px] hover:bg-amber-400 transition-colors shadow-md"
                          >
                            클라우드 갱신
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredData.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-sm font-bold bg-black/80 backdrop-blur-sm z-40">
              <AlertTriangle size={48} className="text-[#333] mb-4"/>
              데이터가 없습니다.
            </div>
          )}
        </div>
      </div>

      {/* 기본명단 업데이트 항목 선택 모달 */}
      {updateModalRow && (
        <UpdateBaseListModal 
          row={updateModalRow} 
          onClose={() => setUpdateModalRow(null)} 
          onConfirm={(updates) => {
            handleUpdateBaseList(updateModalRow, updates);
            setUpdateModalRow(null);
          }} 
        />
      )}
    </>
  );
}

function UpdateBaseListModal({ row, onClose, onConfirm }) {
  // 모달이 열릴 때 업데이트할 초기값을 설정
  const [updates, setUpdates] = useState({
    address: row._업데이트데이터?.address || row.주소 || '',
    mobile: row._업데이트데이터?.mobile || row.휴대폰 || '',
    landline: row._업데이트데이터?.landline || row.유선전화 || '',
    sms: row.문자수신 || 'N',
    driver: row.기사 || '',
    seqNo: row.배송순번 || 0,
    note: row.특이사항 || '',
  });

  const [selected, setSelected] = useState({
    address: !!row._업데이트데이터?.address,
    mobile: !!row._업데이트데이터?.mobile,
    landline: !!row._업데이트데이터?.landline,
    sms: true,
    driver: true,
    seqNo: true,
    note: true,
  });

  const toggleSelect = (key) => setSelected(p => ({ ...p, [key]: !p[key] }));
  const handleChange = (key, val) => setUpdates(p => ({ ...p, [key]: val }));

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[600] flex items-center justify-center p-4">
      <div className="bg-[#111] border border-amber-500/30 rounded-2xl w-full max-w-lg overflow-hidden shadow-[0_0_50px_rgba(245,158,11,0.15)] animate-in fade-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-[#222] flex justify-between items-center bg-gradient-to-r from-amber-950/40 to-transparent">
          <h2 className="text-amber-400 font-black text-lg flex items-center gap-2">
            <AlertTriangle size={20} /> 기준명단 덮어쓰기
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={20} /></button>
        </div>
        
        <div className="p-6">
          <p className="text-sm text-gray-300 mb-4 font-bold">
            <span className="text-amber-400">[{row.이름}]</span> 님의 새로운 정보를 클라우드 기준명단에 업데이트합니다. 이름은 변경할 수 없으며, 체크된 항목만 반영됩니다.
          </p>

          <div className="space-y-3 max-h-[50vh] overflow-y-auto scrollbar-thin scrollbar-thumb-[#444] pr-2">
            {/* 고정 항목: 이름 */}
            <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-800 bg-black/40 opacity-70">
              <input type="checkbox" checked readOnly className="w-4 h-4 accent-gray-600" />
              <div className="flex-1">
                <span className="text-xs text-gray-500 font-bold">성명 (고정)</span>
                <input type="text" value={row.이름} readOnly className="w-full mt-1 bg-transparent text-gray-400 font-bold outline-none cursor-default" />
              </div>
            </div>

            {/* 선택적 업데이트 항목들 */}
            {[
              { key: 'address', label: '주소', color: 'text-yellow-400' },
              { key: 'mobile', label: '메인 연락처', color: 'text-green-400' },
              { key: 'landline', label: '보조 연락처', color: 'text-teal-400' },
              { key: 'sms', label: '문자수신 여부 (Y/N)', color: 'text-cyan-400' },
              { key: 'driver', label: '담당 기사', color: 'text-lime-400' },
              { key: 'seqNo', label: '배송 순번 (숫자)', color: 'text-rose-400' },
              { key: 'note', label: '특이사항', color: 'text-gray-300' },
            ].map(field => (
              <div key={field.key} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${selected[field.key] ? 'border-amber-500/30 bg-amber-950/10' : 'border-gray-800 bg-black/40'}`}>
                <input 
                  type="checkbox" 
                  checked={selected[field.key]} 
                  onChange={() => toggleSelect(field.key)} 
                  className="w-4 h-4 accent-amber-500 cursor-pointer" 
                />
                <div className="flex-1">
                  <span className={`text-[10px] font-black ${selected[field.key] ? field.color : 'text-gray-500'}`}>{field.label}</span>
                  <input 
                    type="text" 
                    value={updates[field.key]} 
                    onChange={e => handleChange(field.key, e.target.value)}
                    disabled={!selected[field.key]}
                    className={`w-full mt-1 bg-transparent font-bold outline-none border-b border-dashed transition-colors ${selected[field.key] ? 'text-gray-200 border-gray-600 focus:border-amber-500' : 'text-gray-600 border-transparent'}`} 
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 bg-black/60 border-t border-[#222] flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-800 text-gray-300 font-bold rounded-xl hover:bg-gray-700 transition-colors">취소</button>
          <button 
            onClick={() => {
              const finalUpdates = {};
              Object.keys(selected).forEach(k => {
                if (selected[k]) finalUpdates[k] = updates[k];
              });
              onConfirm(finalUpdates);
            }} 
            className="flex-[2] py-3 bg-gradient-to-r from-amber-600 to-amber-500 text-white font-black rounded-xl shadow-[0_0_15px_rgba(245,158,11,0.4)] hover:scale-[1.02] transition-transform"
          >
            체크된 항목 업데이트 실행
          </button>
        </div>
      </div>
    </div>
  );
}
