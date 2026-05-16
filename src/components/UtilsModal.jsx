import { useState, useEffect, useRef } from 'react';
import { X, Layers, Download, Upload, Clock, Send, History, GitMerge, CheckSquare, Square, Trash2, Sparkles, FileX } from 'lucide-react';
import { db, collection, query, orderBy, limit, getDocs, addDoc, serverTimestamp } from '../config/firebase.js';

const fmtPhone = (v) => {
  const d = String(v ?? '').replace(/[^0-9]/g, '');
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return v;
};

export default function UtilsModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('merger');

  // Sheet Merger
  const [mergerFile, setMergerFile] = useState(null);
  const [mergerFileName, setMergerFileName] = useState('');
  const [isMerging, setIsMerging] = useState(false);

  // Audit Log
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Dedup
  const [dedupFile, setDedupFile] = useState(null);
  const dedupBufferRef = useRef(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dedupResult, setDedupResult] = useState(null);
  const [deleteRowNums, setDeleteRowNums] = useState(new Set());
  const [dedupSubTab, setDedupSubTab] = useState('strong');
  const [isExporting, setIsExporting] = useState(false);

  // Clean (찌꺼기 삭제)
  const [cleanFile, setCleanFile] = useState(null);
  const cleanBufferRef = useRef(null);
  const [isAnalyzingClean, setIsAnalyzingClean] = useState(false);
  const [cleanResult, setCleanResult] = useState(null);
  const [isExportingClean, setIsExportingClean] = useState(false);

  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(50));
      const snap = await getDocs(q);
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    finally { setLoadingLogs(false); }
  };

  useEffect(() => { if (activeTab === 'audit') fetchLogs(); }, [activeTab]);

  const handleSendNotification = async (log) => {
    try {
      await addDoc(collection(db, 'notifications'), {
        title: '기준명단 업데이트 알림',
        message: `[${log.targetName}] 님의 정보가 업데이트 되었습니다. (수정자: ${log.userEmail})`,
        read: false, timestamp: serverTimestamp(), type: 'AUDIT_ALERT', logId: log.id
      });
      alert('담당자에게 알림이 전송되었습니다!');
    } catch (e) { alert('알림 전송 실패: ' + e.message); }
  };

  const handleMergerUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setMergerFile(file);
    setMergerFileName(file.name.replace(/\.[^/.]+$/, '') + '_통합');
  };

  const executeMerge = async () => {
    if (!mergerFile) return alert('엑셀 파일을 먼저 첨부해주세요.');
    if (!mergerFileName.trim()) return alert('파일 이름을 입력해주세요.');
    setIsMerging(true);
    try {
      const buffer = await mergerFile.arrayBuffer();
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({ action: 'MERGE_SHEETS', buffer, fileName: `${mergerFileName}.xlsx` }, [buffer]);
      });
      if (!result.ok) throw new Error(result.error);
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.fileName; a.click();
      alert('시트 병합이 완료되었습니다!');
      setMergerFile(null); setMergerFileName('');
    } catch (e) { alert('오류: ' + e.message); }
    finally { setIsMerging(false); }
  };

  // ── Dedup ────────────────────────────────────────────────────────────────
  const handleDedupUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setDedupFile(file);
    setDedupResult(null);
    setDeleteRowNums(new Set());
    dedupBufferRef.current = await file.arrayBuffer();
  };

  const runAnalysis = async () => {
    if (!dedupBufferRef.current) return;
    setIsAnalyzing(true);
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({ action: 'ANALYZE_DEDUP', buffer: dedupBufferRef.current.slice(0) }, [dedupBufferRef.current.slice(0)]);
      });
      if (!result.ok) throw new Error(result.error);
      setDedupResult(result);
      setDeleteRowNums(new Set(result.recommendedDeletes));
      setDedupSubTab('strong');
    } catch (e) { alert('분석 오류: ' + e.message); }
    finally { setIsAnalyzing(false); }
  };

  const toggleRow = (rowNum) => {
    setDeleteRowNums(prev => {
      const next = new Set(prev);
      next.has(rowNum) ? next.delete(rowNum) : next.add(rowNum);
      return next;
    });
  };

  const toggleGroup = (group) => {
    const allChecked = group.rows.every((r, i) => i === group.keepIdx || deleteRowNums.has(r._rowNum));
    setDeleteRowNums(prev => {
      const next = new Set(prev);
      group.rows.forEach((r, i) => {
        if (i === group.keepIdx) return;
        allChecked ? next.delete(r._rowNum) : next.add(r._rowNum);
      });
      return next;
    });
  };

  const exportDedup = async () => {
    if (!dedupBufferRef.current || !dedupResult) return;
    setIsExporting(true);
    try {
      const baseName = dedupFile.name.replace(/\.[^/.]+$/, '');
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        const buf = dedupBufferRef.current.slice(0);
        w.postMessage({ action: 'EXPORT_DEDUP', buffer: buf, deleteRowNums: [...deleteRowNums], fileName: `${baseName}_정제본.xlsx` }, [buf]);
      });
      if (!result.ok) throw new Error(result.error);
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.fileName; a.click();
    } catch (e) { alert('내보내기 오류: ' + e.message); }
    finally { setIsExporting(false); }
  };

  const resetDedup = () => { setDedupFile(null); setDedupResult(null); setDeleteRowNums(new Set()); dedupBufferRef.current = null; };

  // ── Clean ────────────────────────────────────────────────────────────────
  const handleCleanUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCleanFile(file);
    setCleanResult(null);
    cleanBufferRef.current = await file.arrayBuffer();
  };

  const runCleanAnalysis = async () => {
    if (!cleanBufferRef.current) return;
    setIsAnalyzingClean(true);
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({ action: 'ANALYZE_CLEAN', buffer: cleanBufferRef.current.slice(0) }, [cleanBufferRef.current.slice(0)]);
      });
      if (!result.ok) throw new Error(result.error);
      setCleanResult(result);
    } catch (e) { alert('분석 오류: ' + e.message); }
    finally { setIsAnalyzingClean(false); }
  };

  const exportClean = async () => {
    if (!cleanBufferRef.current || !cleanResult) return;
    setIsExportingClean(true);
    try {
      const baseName = cleanFile.name.replace(/\.[^/.]+$/, '');
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        const buf = cleanBufferRef.current.slice(0);
        w.postMessage({ action: 'EXPORT_CLEAN', buffer: buf, fileName: `${baseName}_정제본.xlsx` }, [buf]);
      });
      if (!result.ok) throw new Error(result.error);
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.fileName; a.click();
    } catch (e) { alert('내보내기 오류: ' + e.message); }
    finally { setIsExportingClean(false); }
  };

  const resetClean = () => { setCleanFile(null); setCleanResult(null); cleanBufferRef.current = null; };

  const fmtSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;

  const TABS = [
    { id: 'merger', label: '시트 병합', icon: <GitMerge size={14} /> },
    { id: 'dedup',  label: '중복 정리', icon: <Trash2 size={14} /> },
    { id: 'clean',  label: '찌꺼기 삭제', icon: <Sparkles size={14} /> },
    { id: 'audit',  label: '이력 관리', icon: <History size={14} /> },
  ];

  const hasDedup = dedupResult && (
    dedupResult.strongGroups.length > 0 ||
    dedupResult.weakGroups.length > 0 ||
    (dedupResult.noNoteRows?.length ?? 0) > 0
  );
  const contentH = activeTab === 'dedup' && dedupResult ? 'h-[640px]' : 'h-[520px]';

  return (
    <div className="absolute inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#111] border border-gray-700 rounded-3xl w-full max-w-4xl flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="px-7 py-5 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
          <h2 className="text-2xl font-black text-white flex items-center gap-3">
            <Layers className="text-[#22c55e]" size={24} /> 관리자 부가 기능
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        <div className={`flex ${contentH} transition-all duration-300`}>
          {/* Sidebar */}
          <div className="w-52 border-r border-gray-800 bg-black/30 p-4 flex flex-col gap-2">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`w-full text-left px-4 py-3 rounded-xl font-bold text-sm transition-colors flex items-center gap-2.5
                  ${activeTab === t.id ? 'bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30' : 'text-gray-400 hover:bg-gray-800'}`}
              >
                {t.icon} {t.label}
              </button>
            ))}
            <div className="mt-auto"><p className="text-[10px] text-gray-700 text-center">추가 기능 업데이트 예정</p></div>
          </div>

          {/* Content */}
          <div className="flex-1 p-7 overflow-y-auto flex flex-col">

            {/* ── 시트 병합 ── */}
            {activeTab === 'merger' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <h3 className="text-lg font-bold text-white mb-1">여러 시트를 하나로 합치기</h3>
                <p className="text-sm text-gray-400 mb-5">엑셀 파일 내 모든 시트를 단일 통합시트로 병합합니다.</p>
                <div className="space-y-4">
                  <label className={`w-full py-7 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${mergerFile ? 'border-[#22c55e] bg-[#22c55e]/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                    <Upload size={28} className={mergerFile ? 'text-[#22c55e] mb-2' : 'text-gray-500 mb-2'} />
                    <span className={`font-bold text-sm ${mergerFile ? 'text-[#22c55e]' : 'text-gray-400'}`}>
                      {mergerFile ? mergerFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                    </span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleMergerUpload} className="hidden" />
                  </label>
                  {mergerFile && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-400">저장 파일 이름</label>
                      <input value={mergerFileName} onChange={e => setMergerFileName(e.target.value)}
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded-xl px-4 py-2.5 text-white outline-none focus:border-[#22c55e] font-bold text-sm" />
                    </div>
                  )}
                  <button onClick={executeMerge} disabled={!mergerFile || isMerging}
                    className="w-full py-3.5 bg-[#22c55e] text-black font-extrabold rounded-xl hover:bg-[#86efac] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {isMerging ? '병합 중...' : <><Download size={16} /> 병합 및 다운로드</>}
                  </button>
                </div>
              </div>
            )}

            {/* ── 중복 데이터 정리 ── */}
            {activeTab === 'dedup' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-white">중복 데이터 정리</h3>
                  {dedupResult && (
                    <button onClick={resetDedup} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>
                  )}
                </div>
                <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                  이름+생년월일+전화 <span className="text-red-400 font-bold">(강한)</span> 또는 행정동+이름+전화 <span className="text-yellow-400 font-bold">(약한)</span> 중복을 탐지하고 직접 선택하여 정리합니다.
                </p>

                {/* 업로드 & 분석 */}
                {!dedupResult && (
                  <div className="space-y-4">
                    <label className={`w-full py-6 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${dedupFile ? 'border-purple-500 bg-purple-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                      <Upload size={26} className={dedupFile ? 'text-purple-400 mb-2' : 'text-gray-500 mb-2'} />
                      <span className={`font-bold text-sm ${dedupFile ? 'text-purple-400' : 'text-gray-400'}`}>
                        {dedupFile ? dedupFile.name : '엑셀 파일 선택'}
                      </span>
                      <input type="file" accept=".xlsx,.xls" onChange={handleDedupUpload} className="hidden" />
                    </label>
                    <button onClick={runAnalysis} disabled={!dedupFile || isAnalyzing}
                      className="w-full py-3.5 bg-purple-600 hover:bg-purple-500 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all">
                      {isAnalyzing ? '분석 중...' : <><GitMerge size={16} /> 중복 분석 시작</>}
                    </button>
                  </div>
                )}

                {/* 결과 */}
                {dedupResult && (
                  <>
                    {/* 요약 카드 */}
                    <div className="grid grid-cols-5 gap-2 mb-3">
                      {[
                        { label: '전체 행', val: dedupResult.totalRows, color: 'border-gray-700', tc: 'text-white' },
                        { label: '강한 중복', val: `${dedupResult.strongGroups.length}그룹`, color: 'border-red-800/40', tc: 'text-red-400' },
                        { label: '약한 중복', val: `${dedupResult.weakGroups.length}그룹`, color: 'border-yellow-800/40', tc: 'text-yellow-400' },
                        { label: '특이사항없음', val: `${dedupResult.noNoteRows?.length ?? 0}건`, color: 'border-orange-800/40', tc: 'text-orange-400' },
                        { label: '삭제 예정', val: `${deleteRowNums.size}건`, color: 'border-purple-800/40', tc: 'text-purple-400' },
                      ].map(c => (
                        <div key={c.label} className={`bg-black/40 border ${c.color} rounded-xl p-3 text-center`}>
                          <div className={`text-xl font-black ${c.tc}`}>{c.val}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* 서브탭 */}
                    {!hasDedup ? (
                      <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-500 text-sm font-bold">
                        중복 데이터가 없습니다 🎉
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-2 mb-3 flex-wrap">
                          <button onClick={() => setDedupSubTab('strong')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${dedupSubTab === 'strong' ? 'bg-red-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                            강한 중복 ({dedupResult.strongGroups.length})
                          </button>
                          <button onClick={() => setDedupSubTab('weak')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${dedupSubTab === 'weak' ? 'bg-yellow-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                            약한 중복 ({dedupResult.weakGroups.length})
                          </button>
                          <button onClick={() => setDedupSubTab('nonote')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${dedupSubTab === 'nonote' ? 'bg-orange-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                            특이사항 없음 ({dedupResult.noNoteRows?.length ?? 0})
                          </button>
                        </div>

                        {/* 그룹/행 목록 */}
                        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                          {dedupSubTab === 'nonote' ? (
                            (dedupResult.noNoteRows?.length ?? 0) === 0 ? (
                              <div className="h-20 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-600 text-xs font-bold">
                                특이사항 없는 행이 없습니다 🎉
                              </div>
                            ) : (
                              <div className="border border-gray-800 rounded-xl overflow-hidden">
                                <div className="px-3 py-2 bg-orange-950/30 flex items-center justify-between">
                                  <span className="text-xs font-bold text-orange-300">특이사항 없는 행 — {dedupResult.noNoteRows.length}건 (중복 제외)</span>
                                  <button
                                    onClick={() => {
                                      const allChecked = dedupResult.noNoteRows.every(r => deleteRowNums.has(r._rowNum));
                                      setDeleteRowNums(prev => {
                                        const next = new Set(prev);
                                        dedupResult.noNoteRows.forEach(r => allChecked ? next.delete(r._rowNum) : next.add(r._rowNum));
                                        return next;
                                      });
                                    }}
                                    className="text-[10px] font-bold px-2 py-0.5 rounded text-orange-400 hover:text-orange-300 transition-colors"
                                  >
                                    {dedupResult.noNoteRows.every(r => deleteRowNums.has(r._rowNum)) ? '전체 해제' : '전체 선택'}
                                  </button>
                                </div>
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-gray-800 bg-black/20 text-gray-500">
                                      <th className="px-3 py-2 w-16 text-center">삭제</th>
                                      <th className="px-3 py-2 w-10 text-left">행#</th>
                                      <th className="px-3 py-2 text-left">이름</th>
                                      <th className="px-3 py-2 text-left">생년월일</th>
                                      <th className="px-3 py-2 text-left">전화번호</th>
                                      <th className="px-3 py-2 text-left">행정동</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dedupResult.noNoteRows.map(row => {
                                      const isChecked = deleteRowNums.has(row._rowNum);
                                      return (
                                        <tr key={row._rowNum} onClick={() => toggleRow(row._rowNum)}
                                          className={`border-b border-gray-900 cursor-pointer transition-colors
                                            ${isChecked ? 'bg-orange-950/25 hover:bg-orange-950/35' : 'bg-black/10 hover:bg-black/20'}`}>
                                          <td className="px-3 py-2 text-center">
                                            {isChecked
                                              ? <CheckSquare size={16} className="text-orange-400 mx-auto" />
                                              : <Square size={16} className="text-gray-600 mx-auto" />
                                            }
                                          </td>
                                          <td className="px-3 py-2 text-gray-500 font-mono">{row._rowNum}</td>
                                          <td className="px-3 py-2 text-white font-bold">{row.name}</td>
                                          <td className="px-3 py-2 text-gray-300">{row.birth}</td>
                                          <td className="px-3 py-2 text-gray-300">{fmtPhone(row.phone)}</td>
                                          <td className="px-3 py-2 text-gray-400">{row.dong}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )
                          ) : (dedupSubTab === 'strong' ? dedupResult.strongGroups : dedupResult.weakGroups).length === 0 ? (
                            <div className="h-20 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-600 text-xs font-bold">
                              {dedupSubTab === 'strong' ? '강한 중복 없음' : '약한 중복 없음'}
                            </div>
                          ) : (
                            (dedupSubTab === 'strong' ? dedupResult.strongGroups : dedupResult.weakGroups).map((group, gi) => {
                              const allNonKeepChecked = group.rows.every((r, i) => i === group.keepIdx || deleteRowNums.has(r._rowNum));
                              return (
                                <div key={gi} className="border border-gray-800 rounded-xl overflow-hidden">
                                  {/* 그룹 헤더 */}
                                  <div className={`px-3 py-2 flex items-center justify-between ${dedupSubTab === 'strong' ? 'bg-red-950/30' : 'bg-yellow-950/30'}`}>
                                    <span className="text-xs font-bold text-gray-300">
                                      그룹 {gi + 1} — <span className="text-white">{group.rows[0].name}</span>
                                      {group.rows[0].phone && <span className="text-gray-400"> | {fmtPhone(group.rows[0].phone)}</span>}
                                    </span>
                                    <button
                                      onClick={() => toggleGroup(group)}
                                      className={`text-[10px] font-bold px-2 py-0.5 rounded transition-colors ${allNonKeepChecked ? 'text-gray-400 hover:text-gray-200' : 'text-red-400 hover:text-red-300'}`}
                                    >
                                      {allNonKeepChecked ? '전체 해제' : '전체 선택'}
                                    </button>
                                  </div>
                                  {/* 행 테이블 */}
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b border-gray-800 bg-black/20 text-gray-500">
                                        <th className="px-3 py-2 w-16 text-center">삭제</th>
                                        <th className="px-3 py-2 w-10 text-left">행#</th>
                                        <th className="px-3 py-2 text-left">이름</th>
                                        <th className="px-3 py-2 text-left">생년월일</th>
                                        <th className="px-3 py-2 text-left">전화번호</th>
                                        <th className="px-3 py-2 text-left">행정동</th>
                                        <th className="px-3 py-2 text-left">특이사항</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.rows.map((row, ri) => {
                                        const isKeep = ri === group.keepIdx;
                                        const isChecked = deleteRowNums.has(row._rowNum);
                                        const hasNote = !!row.note;
                                        return (
                                          <tr key={row._rowNum} onClick={() => toggleRow(row._rowNum)}
                                            className={`border-b border-gray-900 cursor-pointer transition-colors
                                              ${isKeep ? 'bg-green-950/20 hover:bg-green-950/30' : isChecked ? 'bg-red-950/25 hover:bg-red-950/35' : 'bg-black/10 hover:bg-black/20'}`}>
                                            <td className="px-3 py-2 text-center">
                                              {isKeep
                                                ? <span className="text-xs bg-green-900/50 text-green-400 border border-green-700/40 px-2 py-0.5 rounded font-bold">보존</span>
                                                : isChecked
                                                  ? <CheckSquare size={16} className="text-red-400 mx-auto" />
                                                  : <Square size={16} className="text-gray-600 mx-auto" />
                                              }
                                            </td>
                                            <td className="px-3 py-2 text-gray-500 font-mono">{row._rowNum}</td>
                                            <td className="px-3 py-2 text-white font-bold">{row.name}</td>
                                            <td className="px-3 py-2 text-gray-300">{row.birth}</td>
                                            <td className="px-3 py-2 text-gray-300">{fmtPhone(row.phone)}</td>
                                            <td className="px-3 py-2 text-gray-400">{row.dong}</td>
                                            <td className="px-3 py-2 max-w-[140px] truncate">
                                              {hasNote
                                                ? <span className="text-amber-300 font-medium" title={row.note}>{row.note}</span>
                                                : <span className="text-gray-700 text-xs">없음</span>
                                              }
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </>
                    )}

                    {/* 다운로드 */}
                    <div className="mt-3 pt-3 border-t border-gray-800">
                      <button onClick={exportDedup} disabled={deleteRowNums.size === 0 || isExporting}
                        className="w-full py-3 bg-[#22c55e] hover:bg-[#86efac] text-black font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all text-sm">
                        {isExporting ? '처리 중...' : <><Download size={16} /> {deleteRowNums.size}건 삭제 후 다운로드 (정제본 + 삭제목록 시트)</>}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── 찌꺼기 삭제 ── */}
            {activeTab === 'clean' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2"><Sparkles size={18} className="text-emerald-400" /> 찌꺼기 데이터 삭제</h3>
                  {cleanResult && <button onClick={resetClean} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>}
                </div>
                <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                  빈 행, 유령 열, 숨겨진 행/열, 빈 시트를 제거하여 파일 크기를 최소화합니다.
                </p>

                {/* 업로드 */}
                {!cleanResult && (
                  <div className="space-y-4">
                    <label className={`w-full py-7 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${cleanFile ? 'border-emerald-500 bg-emerald-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                      <Upload size={28} className={cleanFile ? 'text-emerald-400 mb-2' : 'text-gray-500 mb-2'} />
                      <span className={`font-bold text-sm ${cleanFile ? 'text-emerald-400' : 'text-gray-400'}`}>
                        {cleanFile ? cleanFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                      </span>
                      <input type="file" accept=".xlsx,.xls" onChange={handleCleanUpload} className="hidden" />
                    </label>
                    <button onClick={runCleanAnalysis} disabled={!cleanFile || isAnalyzingClean}
                      className="w-full py-3.5 bg-emerald-700 hover:bg-emerald-600 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all">
                      {isAnalyzingClean ? '분석 중...' : <><Sparkles size={16} /> 찌꺼기 분석 시작</>}
                    </button>
                  </div>
                )}

                {/* 분석 결과 */}
                {cleanResult && (
                  <>
                    {/* Before / After 카드 */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-red-950/20 border border-red-800/40 rounded-xl p-4 text-center">
                        <div className="text-xs text-red-400 font-black mb-1">원본 파일 크기</div>
                        <div className="text-2xl font-black text-red-300">{fmtSize(cleanResult.originalSize)}</div>
                      </div>
                      <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-xl p-4 text-center">
                        <div className="text-xs text-emerald-400 font-black mb-1">정제 후 예상 크기</div>
                        <div className="text-2xl font-black text-emerald-300">크게 감소 ↓</div>
                      </div>
                    </div>

                    {/* 제거 항목 요약 */}
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {[
                        { label: '빈 행', val: cleanResult.totalEmptyRows, icon: '🗑', color: 'text-red-400', border: 'border-red-800/40' },
                        { label: '유령 열', val: cleanResult.totalGhostCols, icon: '👻', color: 'text-orange-400', border: 'border-orange-800/40' },
                        { label: '숨김 행', val: cleanResult.totalHiddenRows, icon: '🙈', color: 'text-yellow-400', border: 'border-yellow-800/40' },
                        { label: '숨김 열', val: cleanResult.totalHiddenCols, icon: '🙈', color: 'text-yellow-400', border: 'border-yellow-800/40' },
                        { label: '빈 시트', val: cleanResult.emptySheets, icon: '📄', color: 'text-gray-400', border: 'border-gray-700' },
                        { label: '처리 시트', val: cleanResult.sheets?.length ?? 0, icon: '📊', color: 'text-emerald-400', border: 'border-emerald-800/40' },
                      ].map(c => (
                        <div key={c.label} className={`bg-black/40 border ${c.border} rounded-xl p-2.5 text-center`}>
                          <div className={`text-lg font-black ${c.color}`}>{c.val}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{c.icon} {c.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* 시트별 상세 */}
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 mb-3">
                      {cleanResult.sheets?.map((s, i) => (
                        <div key={i} className={`border rounded-xl p-3 ${s.isEmptySheet ? 'border-red-800/40 bg-red-950/10' : 'border-gray-800 bg-black/20'}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-white flex items-center gap-2">
                              {s.isEmptySheet ? <FileX size={14} className="text-red-400" /> : <Sparkles size={14} className="text-emerald-400" />}
                              {s.sheetName}
                              {s.isEmptySheet && <span className="text-[10px] text-red-400 font-black bg-red-900/30 px-1.5 py-0.5 rounded">빈 시트 — 삭제됨</span>}
                            </span>
                            <span className="text-xs text-gray-500">{s.totalRows}행</span>
                          </div>
                          {!s.isEmptySheet && (
                            <div className="flex gap-3 mt-2 flex-wrap">
                              {s.innerEmptyRows > 0 && <span className="text-[10px] text-red-400">빈 행 {s.innerEmptyRows}개</span>}
                              {s.trailingRows > 0 && <span className="text-[10px] text-orange-400">트레일링 {s.trailingRows}행</span>}
                              {s.ghostCols > 0 && <span className="text-[10px] text-yellow-400">유령 열 {s.ghostCols}개</span>}
                              {s.hiddenRows > 0 && <span className="text-[10px] text-gray-400">숨김 행 {s.hiddenRows}개</span>}
                              {s.hiddenCols > 0 && <span className="text-[10px] text-gray-400">숨김 열 {s.hiddenCols}개</span>}
                              {s.innerEmptyRows === 0 && s.trailingRows === 0 && s.ghostCols === 0 && s.hiddenRows === 0 && s.hiddenCols === 0 &&
                                <span className="text-[10px] text-emerald-400">찌꺼기 없음 ✓</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 다운로드 */}
                    <div className="pt-3 border-t border-gray-800">
                      <button onClick={exportClean} disabled={isExportingClean}
                        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all text-sm">
                        {isExportingClean ? '처리 중...' : <><Download size={16} /> 찌꺼기 제거 후 다운로드</>}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── 이력 관리 ── */}
            {activeTab === 'audit' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-lg font-bold text-white">클라우드 변경 이력</h3>
                  <button onClick={fetchLogs} className="text-sm text-[#22c55e] hover:underline font-bold">새로고침</button>
                </div>
                <p className="text-sm text-gray-400 mb-4">기준명단 갱신 및 주요 변경 이력이 기록됩니다.</p>
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {loadingLogs ? (
                    <div className="flex justify-center items-center h-24 text-gray-500 text-sm">로딩 중...</div>
                  ) : logs.length === 0 ? (
                    <div className="flex justify-center items-center h-24 text-gray-600 text-sm border-2 border-dashed border-gray-800 rounded-xl">기록된 이력이 없습니다.</div>
                  ) : logs.map(log => (
                    <div key={log.id} className="bg-black/40 border border-gray-800 rounded-xl p-4 hover:border-gray-600 transition-all">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-blue-900/50 text-blue-400 border border-blue-700/50">
                            {log.type === 'BASE_UPDATE' ? '기준명단 갱신' : log.type}
                          </span>
                          <span className="text-sm font-bold text-white">{log.targetName}</span>
                          <span className="text-[10px] text-gray-500">{log.city}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-gray-500 font-mono">
                          <Clock size={10} />
                          {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : '방금 전'}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 font-mono bg-[#0a0a0a] p-2 rounded-lg mb-3">
                        {Object.entries(log.updates || {}).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-2">
                            <span className="text-gray-500 w-16">{k}:</span>
                            <span className="text-[#22c55e]">{v}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-gray-800/50">
                        <span className="text-[10px] text-gray-600">수정자: {log.userEmail}</span>
                        <button onClick={() => handleSendNotification(log)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-[#22c55e]/20 hover:text-[#22c55e] hover:border-[#22c55e]/50 border border-gray-700 text-gray-300 rounded-lg text-[10px] font-bold transition-all">
                          <Send size={12} /> 담당자 알림 전송
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
