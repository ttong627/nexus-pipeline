import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Columns, Download, Trash2, Edit3, Database, X, MapPin, Users, UserX, StickyNote, User, Phone, BookOpen, Sparkles, ArrowLeftRight, GripVertical, RotateCcw, Eye, EyeOff } from 'lucide-react';
import { formatPhoneInput } from '../utils/parsers.js';
import { WORKFLOW_MODES } from '../utils/workflow.js';

// ── 칼럼 순서 조정 패널 ────────────────────────────────────────────────────────
const ColOrderPanel = memo(function ColOrderPanel({ cols, onChange, onReset, onClose, anchorRef }) {
  const panelRef = useRef(null);
  const dragIdx = useRef(null);
  const dragOverIdx = useRef(null);

  // 패널 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          anchorRef.current && !anchorRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  // Escape 닫기
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const move = useCallback((from, to) => {
    if (to < 0 || to >= cols.length) return;
    const next = [...cols];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  }, [cols, onChange]);

  const toggle = useCallback((idx) => {
    const next = cols.map((c, i) => i === idx ? { ...c, on: !c.on } : c);
    onChange(next);
  }, [cols, onChange]);

  const onDragStart = (idx) => { dragIdx.current = idx; };
  const onDragOver = (e, idx) => { e.preventDefault(); dragOverIdx.current = idx; };
  const onDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    move(dragIdx.current, idx);
    dragIdx.current = null;
    dragOverIdx.current = null;
  };

  const onCount = cols.filter(c => c.on).length;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-1 z-50 w-72 rounded-xl border border-[#2a3a2a] bg-[#0a100a] shadow-2xl shadow-black/60 overflow-hidden"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(52,211,153,0.12)' }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-[#0d1a0d] border-b border-[#1a2a1a]">
        <div className="flex items-center gap-2">
          <Columns size={12} className="text-emerald-400" />
          <span className="text-[11px] font-black text-white tracking-wide">칼럼 순서 / 표시</span>
          <span className="text-[9px] text-emerald-400 font-bold">{onCount}/{cols.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onReset}
            title="기본값으로 초기화"
            className="p-1 rounded text-gray-500 hover:text-amber-400 hover:bg-amber-400/10 transition-colors"
          >
            <RotateCcw size={11} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* 안내 */}
      <div className="px-3 py-1.5 bg-[#080e08] border-b border-[#131a13]">
        <p className="text-[9px] text-gray-600">드래그 또는 ← → 버튼으로 칼럼 순서를 조정하세요</p>
      </div>

      {/* 칼럼 목록 */}
      <div className="max-h-80 overflow-y-auto py-1 scrollbar-thin scrollbar-thumb-[#2a2a2a]">
        {cols.map((col, idx) => (
          <div
            key={col.key}
            draggable
            onDragStart={() => onDragStart(idx)}
            onDragOver={(e) => onDragOver(e, idx)}
            onDrop={(e) => onDrop(e, idx)}
            className={`flex items-center gap-2 px-2 py-1.5 mx-1 rounded-lg cursor-grab active:cursor-grabbing transition-colors select-none
              ${col.on ? 'hover:bg-emerald-500/8' : 'opacity-40 hover:bg-white/4'}`}
          >
            {/* 드래그 핸들 */}
            <GripVertical size={12} className="text-gray-700 shrink-0 cursor-grab" />

            {/* 순번 */}
            <span className="text-[9px] text-gray-700 w-4 text-right shrink-0 tabular-nums">{idx + 1}</span>

            {/* 칼럼명 */}
            <span className={`flex-1 text-[11px] font-bold truncate ${col.on ? 'text-white' : 'text-gray-600'}`}>
              {col.label}
            </span>

            {/* ← → 이동 버튼 */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => move(idx, idx - 1)}
                disabled={idx === 0}
                title="왼쪽으로 이동"
                className="w-5 h-5 flex items-center justify-center rounded text-gray-600 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={11} />
              </button>
              <button
                onClick={() => move(idx, idx + 1)}
                disabled={idx === cols.length - 1}
                title="오른쪽으로 이동"
                className="w-5 h-5 flex items-center justify-center rounded text-gray-600 hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={11} />
              </button>
            </div>

            {/* 표시/숨김 토글 */}
            <button
              onClick={() => toggle(idx)}
              title={col.on ? '이 칼럼 숨기기' : '이 칼럼 표시'}
              className={`w-5 h-5 flex items-center justify-center rounded transition-colors shrink-0 ${
                col.on ? 'text-emerald-400 hover:bg-emerald-400/10' : 'text-gray-700 hover:text-gray-400 hover:bg-white/5'
              }`}
            >
              {col.on ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
          </div>
        ))}
      </div>

      {/* 전체 토글 푸터 */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0d1a0d] border-t border-[#1a2a1a]">
        <button
          onClick={() => onChange(cols.map(c => ({ ...c, on: true })))}
          className="text-[9px] text-gray-500 hover:text-emerald-400 transition-colors font-bold"
        >
          전체 표시
        </button>
        <span className="text-[9px] text-gray-700">드래그로 순서 변경</span>
        <button
          onClick={() => onChange(cols.map((c, i) => ({ ...c, on: i < cols.length - 1 })))}
          className="text-[9px] text-gray-500 hover:text-amber-400 transition-colors font-bold"
        >
          사유 제외
        </button>
      </div>
    </div>
  );
});

const ResultGrid = memo(function ResultGrid({
  step, setStep, filter, setFilter, dongList = [], driverList = [], gridData, filteredData, paginatedData,
  currentPage, setCurrentPage, itemsPerPage, colVis, sortConfig, setSortConfig,
  handleCellEdit, handleAddressKeyDown, handleUpdateBaseList, handleBatchSaveBaseList, isSavingBaseList,
  handleSaveMonthlyList, setShowExportSetting, handleExport, handleExportErrors, handleExportDongSummary,
  handleExportByDriver, handleDeleteRows, handleBatchSetNote, onHelp, onOpenRouteMap,
  purifyResult, onClosePurifyResult, onMovePhones, onRepurifyErrors,
  onFetchBaseNotes, isFetchingNotes,
  workflowMode = 'cleaningOnly', onWorkflowModeChange,
  addressDisplayMode = 'parenBeforeDetail', onToggleAddressDisplayMode,
  exportColOrder = [], setExportColOrder, defaultExportCols = [],
}) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchNoteOpen, setBatchNoteOpen] = useState(false);
  const [batchNoteValue, setBatchNoteValue] = useState('');
  const [updateModalRow, setUpdateModalRow] = useState(null);
  const [showColSettings, setShowColSettings] = useState(false);
  const [showColOrder, setShowColOrder] = useState(false);
  const [localColVis, setLocalColVis] = useState({ birth: false, contact2: false, sms: false, note: true, driver: true });
  const searchInputRef = useRef(null);
  const colSettingsRef = useRef(null);
  const colOrderBtnRef = useRef(null);

  useEffect(() => {
    if (!showColSettings) return;
    const handleClick = (e) => {
      if (colSettingsRef.current && !colSettingsRef.current.contains(e.target)) setShowColSettings(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showColSettings]);

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

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const resetFilters = () => setFilter(f => ({ ...f, text: '', 구분: '', dong: '', driver: '', noDriver: false, hasNote: false, inferredAddress: false }));
  const hasActiveFilter = filter.text || filter.구분 || filter.dong || filter.driver || filter.noDriver || filter.hasNote || filter.inferredAddress;

  const errorCount = gridData.filter(d => d._에러).length;
  const inferredAddressCount = gridData.filter(d => d._주소추정 || (d._추정사유 || '').trim() || (d.특이사항 || '').includes('[주소추정]')).length;
  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const modeInfo = WORKFLOW_MODES[workflowMode] || WORKFLOW_MODES.cleaningOnly;
  const isDetailBeforeParen = addressDisplayMode === 'detailBeforeParen';

  return (
    <>
      {/* 정제 결과 요약 모달 */}
      {purifyResult && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#05080f] border border-[#3b82f6]/30 rounded-3xl p-6 shadow-[0_0_60px_rgba(59,130,246,0.15)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#3b82f6] to-transparent opacity-60" />
            <div className="flex justify-between items-start mb-5">
              <div>
                <span className="inline-block px-2 py-0.5 rounded text-xs font-black border border-[#3b82f6]/30 bg-[#3b82f6]/10 text-[#3b82f6] mb-2">정제 완료</span>
                <h3 className="text-white font-black text-lg">주소 정제 결과 요약</h3>
              </div>
              <button onClick={onClosePurifyResult} className="text-gray-500 hover:text-white transition-colors bg-white/5 rounded-full p-1.5"><X size={18}/></button>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-[#060c18] border border-[#3b82f6]/20 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-[#3b82f6]">{purifyResult.totalCount.toLocaleString()}</div>
                <div className="text-xs text-gray-500 mt-1 font-bold">전체</div>
              </div>
              <div className="bg-[#0a1505] border border-[#3b82f6]/30 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-[#93c5fd]">{purifyResult.successCount.toLocaleString()}</div>
                <div className="text-xs text-gray-500 mt-1 font-bold">✅ 정상</div>
              </div>
              <div className="bg-red-950/20 border border-red-500/20 rounded-xl p-3 text-center">
                <div className="text-2xl font-black text-red-400">{purifyResult.errorCount.toLocaleString()}</div>
                <div className="text-xs text-gray-500 mt-1 font-bold">⚠️ 확인필요</div>
              </div>
            </div>
            {purifyResult.errorCount > 0 && (
              <div className="bg-black/40 border border-[#2a2a2a] rounded-xl p-4 mb-4 space-y-2">
                <p className="text-xs text-gray-500 font-bold mb-2">확인필요 유형별</p>
                {purifyResult.apiFailCount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-orange-400 font-bold">• API 실패</span>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-black">{purifyResult.apiFailCount}건</span>
                      <button onClick={() => { setFilter(f => ({...f, showErrorsOnly: true})); onClosePurifyResult(); }}
                        className="px-2 py-0.5 bg-orange-900/40 border border-orange-500/30 text-orange-300 rounded text-xs font-bold hover:bg-orange-800/40">목록 보기</button>
                    </div>
                  </div>
                )}
                {purifyResult.emptyAddrCount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-400 font-bold">• 주소 공란</span>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-black">{purifyResult.emptyAddrCount}건</span>
                      <button onClick={() => { setFilter(f => ({...f, showErrorsOnly: true})); onClosePurifyResult(); }}
                        className="px-2 py-0.5 bg-red-900/40 border border-red-500/30 text-red-300 rounded text-xs font-bold hover:bg-red-800/40">목록 보기</button>
                    </div>
                  </div>
                )}
                {purifyResult.shortAddrCount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-yellow-400 font-bold">• 주소 너무 짧음</span>
                    <span className="text-white font-black">{purifyResult.shortAddrCount}건</span>
                  </div>
                )}
                {purifyResult.outOfMunicipalityCount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fuchsia-400 font-bold">• 타지역-지자체 벗어남</span>
                    <span className="text-white font-black">{purifyResult.outOfMunicipalityCount}건</span>
                  </div>
                )}
                {purifyResult.jibunOnlyCount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-cyan-400 font-bold">• 지번주소만 확인됨</span>
                    <span className="text-white font-black">{purifyResult.jibunOnlyCount}건</span>
                  </div>
                )}
                {purifyResult.addressMissingCount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-300 font-bold">• 주소 없음</span>
                    <span className="text-white font-black">{purifyResult.addressMissingCount}건</span>
                  </div>
                )}
                {purifyResult.otherErrCount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 font-bold">• 기타</span>
                    <span className="text-white font-black">{purifyResult.otherErrCount}건</span>
                  </div>
                )}
              </div>
            )}
            {purifyResult.importedCount > 0 && (
              <div className="flex items-center gap-2 bg-[#060c18] border border-[#3b82f6]/20 rounded-xl px-4 py-2.5 mb-4">
                <span className="text-[#3b82f6] text-sm drop-shadow-[0_0_4px_rgba(59,130,246,0.8)]">👑</span>
                <span className="text-[#93c5fd] text-xs font-bold">고객 노트 매칭 {purifyResult.importedCount.toLocaleString()}건 이식됨</span>
              </div>
            )}
            {purifyResult.inferredAddressCount > 0 && (
              <div className="flex items-center justify-between gap-3 bg-amber-950/20 border border-amber-500/25 rounded-xl px-4 py-2.5 mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles size={15} className="text-amber-300" />
                  <span className="text-amber-200 text-xs font-bold">주소 추정 변환 {purifyResult.inferredAddressCount.toLocaleString()}건</span>
                </div>
                <button
                  onClick={() => { setFilter(f => ({ ...f, inferredAddress: true, showErrorsOnly: false, showSuccessOnly: false })); onClosePurifyResult(); }}
                  className="px-2.5 py-1 bg-amber-500/15 border border-amber-400/35 text-amber-200 rounded-lg text-xs font-black hover:bg-amber-500/25 transition-colors"
                >
                  검수 목록
                </button>
              </div>
            )}
            <div className="flex gap-3">
              {purifyResult.errorCount > 0 && (
                <button onClick={() => { setFilter(f => ({...f, showErrorsOnly: true})); onClosePurifyResult(); }}
                  className="flex-1 py-3 bg-red-900/40 border border-red-500/40 text-red-300 font-bold rounded-xl text-sm hover:bg-red-800/40 transition-colors">
                  확인필요만 보기
                </button>
              )}
              <button onClick={onClosePurifyResult}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-sm transition-colors">
                확인
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 기사 입력용 datalist */}
      <datalist id="driver-list">
        {driverList.map(d => <option key={d} value={d} />)}
      </datalist>

      <div className="flex flex-col h-full bg-[#080b0a]/95 backdrop-blur-xl rounded-2xl border border-[#1a2725] shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden">

        {/* 작업 목적 컨트롤 */}
        <div className="shrink-0 px-5 py-3 border-b border-[#17201f] bg-[#090d0c] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black tracking-[0.16em] text-gray-600">작업 목적</span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-black">{modeInfo.title}</span>
            </div>
            <p className="mt-1 text-[11px] text-gray-500 truncate">{modeInfo.description}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {Object.values(WORKFLOW_MODES).map(mode => (
              <button
                key={mode.id}
                onClick={() => onWorkflowModeChange?.(mode.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-black border transition-colors ${
                  workflowMode === mode.id
                    ? 'bg-emerald-500/12 border-emerald-400/40 text-emerald-200'
                    : 'bg-[#0b0f0f] border-[#1a2725] text-gray-500 hover:text-gray-300 hover:border-[#2b3b38]'
                }`}
              >
                {mode.shortTitle}
              </button>
            ))}
          </div>
        </div>

        {/* ══ Row 1: 네비게이션 · 상태 탭 · 주요 CTA ══ */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-[#17201f] bg-[#070908] shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={() => setStep(3)} className="px-3 py-1.5 bg-[#111] border border-[#2a2a2a] text-gray-400 font-bold rounded-lg hover:bg-[#1a1a1a] hover:text-white transition-colors flex items-center gap-1.5 text-xs">
              <ChevronLeft size={14} strokeWidth={3}/> 매핑으로
            </button>
            <div className="h-5 w-px bg-[#2a2a2a]"/>
            <div className="flex bg-black/50 p-0.5 rounded-lg border border-[#1e1e1e] gap-0.5">
              <button
                onClick={() => setFilter(f => ({ ...f, showErrorsOnly: false, showSuccessOnly: false, inferredAddress: false }))}
                className={`px-4 py-1.5 text-xs rounded-md transition-all font-bold ${!filter.showErrorsOnly && !filter.showSuccessOnly && !filter.inferredAddress ? 'bg-[#101816] border border-emerald-500/35 text-emerald-300' : 'text-gray-500 hover:text-gray-300'}`}
              >
                전체 <span className="font-mono font-black">{gridData.length.toLocaleString()}</span>
              </button>
              <button
                onClick={() => setFilter(f => ({ ...f, showErrorsOnly: !filter.showErrorsOnly, showSuccessOnly: false, inferredAddress: false }))}
                className={`px-4 py-1.5 text-xs rounded-md flex items-center gap-1.5 transition-all font-bold ${filter.showErrorsOnly ? 'bg-red-950/60 border border-red-500/50 text-red-400' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <AlertTriangle size={12}/> 확인필요 <span className="font-mono font-black">{errorCount.toLocaleString()}</span>
              </button>
              <button
                onClick={() => setFilter(f => ({ ...f, showSuccessOnly: !filter.showSuccessOnly, showErrorsOnly: false, inferredAddress: false }))}
                className={`px-4 py-1.5 text-xs rounded-md flex items-center gap-1.5 transition-all font-bold ${filter.showSuccessOnly ? 'bg-emerald-950/50 border border-emerald-500/35 text-emerald-300' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <CheckCircle size={12}/> 정제완료 <span className="font-mono font-black">{gridData.filter(d=>!d._에러).length.toLocaleString()}</span>
              </button>
              {inferredAddressCount > 0 && (
                <button
                  onClick={() => setFilter(f => ({ ...f, inferredAddress: !f.inferredAddress, showErrorsOnly: false, showSuccessOnly: false }))}
                  title="오타 보정, 도로명 추정, 압축 주소 변환처럼 시스템이 임의 보정한 주소만 모아봅니다."
                  className={`px-4 py-1.5 text-xs rounded-md flex items-center gap-1.5 transition-all font-bold ${filter.inferredAddress ? 'bg-amber-950/60 border border-amber-400/50 text-amber-200' : 'text-gray-500 hover:text-amber-200'}`}
                >
                  <Sparkles size={12}/> 주소 추정 <span className="font-mono font-black">{inferredAddressCount.toLocaleString()}</span>
                </button>
              )}
            </div>
            {errorCount > 0 && onRepurifyErrors && (
              <button
                onClick={onRepurifyErrors}
                title="오류 행의 주소를 먼저 수정한 뒤 클릭하세요. 전체 오류 행을 API로 일괄 재처리합니다."
                className="px-3 py-1.5 bg-orange-950/70 border border-orange-500/50 text-orange-300 text-xs font-bold rounded-lg flex items-center gap-1.5 hover:bg-orange-900/70 hover:border-orange-400/70 hover:text-orange-200 transition-all shrink-0"
              >
                ↺ 오류 재정제 <span className="font-mono font-black">{errorCount}</span>
              </button>
            )}
            {(() => {
              const matched = gridData.filter(d => d._이식됨);
              if (matched.length === 0) return null;
              const byBirth = matched.filter(d => d._매칭방식 === '이름+생년월일').length;
              const byPhone = matched.filter(d => d._매칭방식 === '이름+휴대폰').length;
              const byContact2 = matched.filter(d => d._매칭방식 === '이름+추가연락처').length;
              return (
                <div
                  title={`①이름+생년월일: ${byBirth}건\n②이름+휴대폰: ${byPhone}건\n③이름+추가연락처: ${byContact2}건`}
                  className="flex items-center gap-1.5 bg-[#060c18] border border-[#3b82f6]/25 text-[#93c5fd] text-xs font-bold px-3 py-1.5 rounded-lg cursor-default"
                >
                  <span className="drop-shadow-[0_0_4px_rgba(59,130,246,0.8)]">👑</span>
                  고객 노트 이식 {matched.length.toLocaleString()}건
                </div>
              );
            })()}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onToggleAddressDisplayMode && (
              <button
                onClick={onToggleAddressDisplayMode}
                title={isDetailBeforeParen
                  ? '현재: 도로명주소, 상세주소 (법정동, 건물명). 클릭하면 도로명주소, (법정동, 건물명) 상세주소로 바뀝니다.'
                  : '현재: 도로명주소, (법정동, 건물명) 상세주소. 클릭하면 도로명주소, 상세주소 (법정동, 건물명)로 바뀝니다.'}
                className={`px-3 py-1.5 border text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
                  isDetailBeforeParen
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/15'
                    : 'bg-[#111] border-[#2a2a2a] text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-200'
                }`}
              >
                <ArrowLeftRight size={13}/>
                주소 형식
                <span className="text-[10px] font-black opacity-80">
                  {isDetailBeforeParen ? '상세앞' : '괄호앞'}
                </span>
              </button>
            )}
            <div className="relative" ref={colSettingsRef}>
              <button onClick={() => setShowColSettings(v => !v)} className="px-3 py-1.5 bg-[#111] border border-[#2a2a2a] text-gray-400 font-bold rounded-lg hover:bg-[#1a1a1a] transition-colors flex items-center gap-1.5 text-xs">
                <Columns size={13}/> 컬럼 설정
              </button>
              {showColSettings && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl shadow-2xl p-3 min-w-[160px] flex flex-col gap-2">
                  {[
                    { key: 'birth', label: '생년월일' },
                    { key: 'contact2', label: '유선전화' },
                    { key: 'sms', label: '문자수신' },
                    { key: 'note', label: '특이사항' },
                    { key: 'driver', label: '기사' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer text-xs text-gray-300 hover:text-white transition-colors">
                      <input
                        type="checkbox"
                        checked={localColVis[key]}
                        onChange={() => setLocalColVis(v => ({ ...v, [key]: !v[key] }))}
                        className="accent-[#3b82f6] w-3.5 h-3.5"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onHelp}
              className="w-8 h-8 rounded-full bg-emerald-950/30 border border-emerald-500/40 text-emerald-400 font-black text-sm hover:bg-emerald-500/20 hover:scale-110 transition-all shrink-0"
              title="결과 화면 도움말"
            >?</button>
            <div className="h-5 w-px bg-[#2a2a2a]"/>
            <div className="relative">
              <button
                ref={colOrderBtnRef}
                onClick={() => setShowColOrder(v => !v)}
                title="엑셀 칼럼 순서·표시 설정"
                className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all ${
                  showColOrder
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-[#0d1a0d] border-[#1a3a1a] text-emerald-500/70 hover:text-emerald-300 hover:border-emerald-500/40'
                }`}
              >
                <Columns size={13} />
                <span className="hidden sm:inline">칼럼</span>
                {exportColOrder.filter(c => !c.on).length > 0 && (
                  <span className="w-4 h-4 bg-amber-500 text-black text-[9px] font-black rounded-full flex items-center justify-center">
                    {exportColOrder.filter(c => !c.on).length}
                  </span>
                )}
              </button>
              {showColOrder && exportColOrder.length > 0 && (
                <ColOrderPanel
                  cols={exportColOrder}
                  onChange={(next) => setExportColOrder(next)}
                  onReset={() => setExportColOrder(defaultExportCols)}
                  onClose={() => setShowColOrder(false)}
                  anchorRef={colOrderBtnRef}
                />
              )}
            </div>
            <button onClick={handleExport} className="px-5 py-2 bg-emerald-400 text-black font-black rounded-lg shadow-[0_0_12px_rgba(52,211,153,0.22)] hover:bg-emerald-300 transition-all flex items-center gap-2 text-xs">
              <Download size={14} strokeWidth={2.5}/> 표준 명단 패키징
            </button>
          </div>
        </div>

        {/* ══ Row 2: 저장 · 내보내기 · 배송 배정 + 페이지네이션 ══ */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-[#141d1b] bg-[#060807] shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-700 font-black tracking-widest">저장</span>
            <button onClick={handleSaveMonthlyList} className="px-3 py-1.5 bg-[#060c18] border border-[#3b82f6]/20 text-[#93c5fd] font-bold rounded-lg hover:bg-[#0f1f13] transition-colors flex items-center gap-1.5 text-xs">
              <Database size={12}/> 해당월 명단
            </button>
            <button
              disabled={isSavingBaseList}
              onClick={() => {
                const allNamed = gridData.filter(d => (d.이름 || '').trim());
                if (allNamed.length === 0) return alert("저장할 명단이 없습니다.");
                const errCount = gridData.filter(d => d._에러).length;
                const msg = errCount > 0
                  ? `총 ${allNamed.length}건을 기본명단에 누적 저장합니다.\n주소 오류 ${errCount}건도 포함됩니다 (이름·연락처 기준으로 저장).`
                  : `총 ${allNamed.length}건을 기본명단에 누적 저장하시겠습니까?`;
                if (window.confirm(msg)) handleBatchSaveBaseList(allNamed);
              }}
              className={`px-3 py-1.5 border font-bold rounded-lg transition-colors flex items-center gap-1.5 text-xs ${isSavingBaseList ? 'bg-[#060c18]/50 border-[#3b82f6]/10 text-[#93c5fd]/40 cursor-not-allowed' : 'bg-[#060c18] border-[#3b82f6]/20 text-[#93c5fd] hover:bg-[#0f1f13]'}`}
            >
              <Database size={12}/> {isSavingBaseList ? '저장 중...' : '기본명단'}
            </button>

            <div className="h-4 w-px bg-[#222] mx-0.5"/>
            <span className="text-xs text-gray-700 font-black tracking-widest">내보내기</span>

            {errorCount > 0 && (
              <button onClick={handleExportErrors} className="px-3 py-1.5 bg-[#160808] border border-red-900/30 text-red-400/80 font-bold rounded-lg hover:bg-[#1c0a0a] transition-colors flex items-center gap-1.5 text-xs">
                <AlertTriangle size={12}/> 오류만 ({errorCount})
              </button>
            )}
            <button onClick={handleExportDongSummary} className="px-3 py-1.5 bg-[#111] border border-[#252525] text-gray-400 font-bold rounded-lg hover:bg-[#1a1a1a] hover:text-gray-200 transition-colors flex items-center gap-1.5 text-xs">
              <Download size={12}/> 행정동 보고서
            </button>
            {workflowMode === 'deliveryFull' && (
              <button onClick={handleExportByDriver} className="px-3 py-1.5 bg-[#111] border border-[#252525] text-gray-400 font-bold rounded-lg hover:bg-[#1a1a1a] hover:text-gray-200 transition-colors flex items-center gap-1.5 text-xs">
                <Users size={12}/> 기사별 배송표
              </button>
            )}

            {onMovePhones && (
              <>
                <div className="h-4 w-px bg-[#222] mx-0.5"/>
                <button onClick={onMovePhones} className="px-3 py-1.5 bg-[#051818] border border-cyan-800/30 text-cyan-400 font-bold rounded-lg hover:bg-[#0a2020] transition-colors flex items-center gap-1.5 text-xs" title="유선전화에 있는 휴대폰 번호를 휴대폰으로 이동">
                  <Phone size={12}/> 전화번호 이동
                </button>
              </>
            )}
            {onFetchBaseNotes && (
              <>
                <div className="h-4 w-px bg-[#222] mx-0.5"/>
                <button
                  onClick={onFetchBaseNotes}
                  disabled={isFetchingNotes}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-950/40 hover:bg-amber-900/50 text-amber-400 border border-amber-500/30 transition-colors disabled:opacity-40"
                  title="기본명단에서 특이사항을 불러와 이식"
                >
                  <BookOpen size={12}/> {isFetchingNotes ? '이식 중...' : '특이사항 불러오기'}
                </button>
              </>
            )}
            {onOpenRouteMap && workflowMode === 'deliveryFull' && (
              <>
                <div className="h-4 w-px bg-[#222] mx-0.5"/>
                <button onClick={onOpenRouteMap} className="px-3 py-1.5 bg-[#050c18] border border-blue-800/30 text-blue-400 font-bold rounded-lg hover:bg-[#0d1f14] transition-colors flex items-center gap-1.5 text-xs">
                  <MapPin size={12}/> 배송 구역 배정
                </button>
              </>
            )}
            {onOpenRouteMap && workflowMode === 'geoOnly' && (
              <>
                <div className="h-4 w-px bg-[#222] mx-0.5"/>
                <button onClick={() => onWorkflowModeChange?.('deliveryFull')} className="px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 font-bold rounded-lg hover:bg-cyan-500/15 transition-colors flex items-center gap-1.5 text-xs" title="현재 좌표 전용 지도 화면은 배송 배정 화면과 분리 준비 중입니다. 배송 배정 모드로 전환하면 지도 기능을 사용할 수 있습니다.">
                  <MapPin size={12}/> 배송 지도로 확장
                </button>
              </>
            )}
            {onOpenRouteMap && workflowMode === 'cleaningOnly' && (
              <>
                <div className="h-4 w-px bg-[#222] mx-0.5"/>
                <button onClick={() => onWorkflowModeChange?.('deliveryFull')} className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/25 text-amber-300 font-bold rounded-lg hover:bg-amber-500/15 transition-colors flex items-center gap-1.5 text-xs">
                  <MapPin size={12}/> 배송 작업 추가
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenRouteMap && workflowMode === 'deliveryFull' && (() => {
              const total = gridData.length;
              const aptCount = gridData.filter(d => d._isApt).length;
              const withCoord = gridData.filter(d => d._lat && d._lng).length;
              const noCoord = total - withCoord - aptCount;
              const pct = total > 0 ? Math.round(withCoord / (total - aptCount || 1) * 100) : 0;
              return (
                <div className="flex items-center gap-1 px-2.5 py-1.5 bg-black/40 border border-[#1e2e1e] rounded-lg text-xs font-bold shrink-0"
                  title={`전체 ${total.toLocaleString()}건 중\n좌표 있음: ${withCoord.toLocaleString()}건\n아파트(좌표 불필요): ${aptCount.toLocaleString()}건\n좌표 없음: ${Math.max(0, noCoord).toLocaleString()}건`}>
                  <MapPin size={11} className="text-blue-500 shrink-0" />
                  <span className="text-blue-400">{withCoord.toLocaleString()}</span>
                  <span className="text-gray-600">/{(total-aptCount).toLocaleString()}</span>
                  <span className="text-blue-600 ml-0.5">({pct}%)</span>
                  {aptCount > 0 && <span className="text-blue-400/60 ml-1">· 아파트 {aptCount}</span>}
                </div>
              );
            })()}

            {selectedIds.size > 0 && (
              <>
                <div className="h-4 w-px bg-[#222]"/>
                <span className="text-xs text-amber-400 font-black border border-amber-500/30 bg-amber-950/20 px-2.5 py-1.5 rounded-lg">
                  {selectedIds.size.toLocaleString()}건 선택
                </span>
                <button
                  onClick={() => { setBatchNoteOpen(true); setBatchNoteValue(''); }}
                  className="px-3 py-1.5 bg-[#1a1030] border border-purple-700/40 text-purple-300 font-bold rounded-lg hover:bg-[#1e1438] transition-colors flex items-center gap-1.5 text-xs"
                >
                  <Edit3 size={12}/> 특이사항 일괄
                </button>
                <button
                  onClick={() => {
                    if (!window.confirm(`선택한 ${selectedIds.size}건을 삭제하시겠습니까?`)) return;
                    handleDeleteRows(selectedIds);
                    setSelectedIds(new Set());
                  }}
                  className="px-3 py-1.5 bg-[#180808] border border-red-700/40 text-red-400 font-bold rounded-lg hover:bg-[#200a0a] transition-colors flex items-center gap-1.5 text-xs"
                >
                  <Trash2 size={12}/> 삭제
                </button>
              </>
            )}

            <div className="flex items-center gap-1 text-xs text-gray-400 bg-black/60 px-3 py-1.5 rounded-lg border border-[#1e1e1e]">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="hover:text-[#3b82f6] disabled:opacity-20 transition-colors"><ChevronLeft size={14}/></button>
              <span className="font-mono font-bold text-gray-300 px-1">{currentPage} / {totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || filteredData.length === 0} className="hover:text-[#3b82f6] disabled:opacity-20 transition-colors"><ChevronRight size={14}/></button>
            </div>
          </div>
        </div>

        {/* ══ Row 3: 검색 + 필터 ══ */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-[#141414] bg-[#030303] shrink-0 flex-wrap">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input
              ref={searchInputRef}
              type="text"
              value={filter.text}
              onChange={e => setFilter(f => ({ ...f, text: e.target.value }))}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchInputRef.current?.focus(); }
              }}
              placeholder="이름·행정동·주소 검색... (Ctrl+F)"
              className="nexus-search-input bg-black/60 border border-[#2a2a2a] rounded-lg pl-7 pr-6 py-1.5 text-xs text-white outline-none focus:border-[#3b82f6]/50 placeholder:text-gray-700 w-52"
            />
            {filter.text && (
              <button onClick={() => setFilter(f => ({ ...f, text: '' }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            )}
          </div>

          <select value={filter.구분} onChange={e => setFilter(f => ({ ...f, 구분: e.target.value }))}
            className="bg-black/60 border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-[#3b82f6]/50 cursor-pointer">
            <option value="">구분 전체</option>
            <option value="기초수급자">기초수급자</option>
            <option value="차상위">차상위</option>
          </select>

          <select value={filter.dong} onChange={e => setFilter(f => ({ ...f, dong: e.target.value }))}
            className="bg-black/60 border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-[#3b82f6]/50 cursor-pointer">
            <option value="">행정동 전체</option>
            {dongList.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          {driverList.length > 0 && (
            <select value={filter.driver} onChange={e => setFilter(f => ({ ...f, driver: e.target.value, noDriver: false }))}
              className="bg-black/60 border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-[#3b82f6]/50 cursor-pointer">
              <option value="">기사 전체</option>
              {driverList.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}

          <button
            onClick={() => setFilter(f => ({ ...f, noDriver: !f.noDriver, driver: '' }))}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${filter.noDriver ? 'bg-orange-900/40 border-orange-500/50 text-orange-300' : 'bg-black/40 border-[#2a2a2a] text-gray-500 hover:text-gray-300'}`}
          >
            <UserX size={12}/> 미배정{filter.noDriver && <span className="font-black ml-0.5">({filteredData.length})</span>}
          </button>

          <button
            onClick={() => setFilter(f => ({ ...f, hasNote: !f.hasNote }))}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${filter.hasNote ? 'bg-amber-900/40 border-amber-500/50 text-amber-300' : 'bg-black/40 border-[#2a2a2a] text-gray-500 hover:text-gray-300'}`}
          >
            <StickyNote size={12}/> 특이사항{filter.hasNote && <span className="font-black ml-0.5">({filteredData.length})</span>}
          </button>

          {inferredAddressCount > 0 && (
            <button
              onClick={() => setFilter(f => ({ ...f, inferredAddress: !f.inferredAddress, showErrorsOnly: false, showSuccessOnly: false }))}
              title="오타 보정·주소 추정 변환이 들어간 행만 담당자가 검수합니다."
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${filter.inferredAddress ? 'bg-amber-950/60 border-amber-400/50 text-amber-200' : 'bg-black/40 border-[#2a2a2a] text-gray-500 hover:text-amber-200'}`}
            >
              <Sparkles size={12}/> 주소 추정 변환{filter.inferredAddress && <span className="font-black ml-0.5">({filteredData.length})</span>}
            </button>
          )}

          {hasActiveFilter && (
            <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-red-400 border border-[#2a2a2a] hover:border-red-700/40 rounded-lg px-2.5 py-1.5 transition-colors">
              초기화
            </button>
          )}

          <span className="text-xs text-gray-700 ml-auto">
            {filteredData.length.toLocaleString()}건 표시 / 전체 {gridData.length.toLocaleString()}건
          </span>
        </div>

        <div className="flex-1 overflow-auto relative scrollbar-thin scrollbar-thumb-[#555] scrollbar-track-black/50">
          <table className="w-full text-left text-[12px] whitespace-nowrap border-collapse">
            <thead className="sticky top-0 bg-[#0a100c] z-20 text-gray-400 shadow-[0_5px_15px_rgba(0,0,0,0.8)] border-b-2 border-[#333]">
              <tr>
                <th className="px-2 py-3 font-bold border-r border-[#222] text-center sticky left-0 bg-[#0a100c] z-30 shadow-[2px_0_5px_rgba(0,0,0,0.5)] w-10">
                  <input type="checkbox" checked={allPageSelected} onChange={toggleAll} className="accent-[#3b82f6] w-4 h-4 cursor-pointer" />
                </th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center sticky left-10 bg-[#0a100c] z-30 shadow-[2px_0_5px_rgba(0,0,0,0.5)]">NO</th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center cursor-pointer hover:bg-[#222] transition-colors" onClick={() => handleSort('구분')}>구분 {sortConfig.key === '구분' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide cursor-pointer hover:bg-[#222] transition-colors" onClick={() => handleSort('행정동')}>행정구역 {sortConfig.key === '행정동' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide cursor-pointer hover:bg-[#222] transition-colors" onClick={() => handleSort('이름')}>성명 {sortConfig.key === '이름' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center cursor-pointer hover:bg-[#222] transition-colors" onClick={() => handleSort('품명')}>품명 {sortConfig.key === '품명' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>
                {localColVis.birth && <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">생년월일</th>}
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">포수</th>
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">메인(휴대폰)</th>
                {localColVis.contact2 && <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">보조(유선)</th>}
                {localColVis.sms && <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">문자수신</th>}
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-[#3b82f6] bg-gradient-to-b from-[#060c18] to-[#0a0a0a] text-sm min-w-[400px] cursor-pointer hover:from-[#112211]" onClick={() => handleSort('주소')}>통합 주소 (클릭하여 텍스트 직접 수정) {sortConfig.key === '주소' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>
                {localColVis.note && <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">특이사항 / 비고</th>}
                {localColVis.driver && <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">기사</th>}
                <th className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">오류 사유</th>
              </tr>
            </thead>
            <tbody className="font-mono text-gray-200">
              {paginatedData.map((row, idx) => {
                const isSelected = selectedIds.has(row.id);
                return (
                  <tr key={row.id} className={`border-b border-[#222] group h-10 transition-colors ${isSelected ? 'bg-amber-950/20' : row._에러 ? 'bg-red-950/20 hover:bg-red-900/40' : 'bg-transparent hover:bg-[#060c18]/60'}`}>
                    <td className={`px-2 py-1.5 border-r border-[#222] text-center sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.3)] ${isSelected ? 'bg-amber-950/40' : row._에러 ? 'bg-[#1a0505]' : 'bg-[#0a0a0a] group-hover:bg-[#0f1f12]'}`}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer" />
                    </td>
                    <td className={`px-4 py-1.5 border-r border-[#222] text-center sticky left-10 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.3)] font-bold ${isSelected ? 'bg-amber-950/40 text-amber-300' : row._에러 ? 'bg-[#1a0505] text-red-400 border-l-4 border-l-red-500' : 'bg-[#0a0a0a] group-hover:bg-[#0f1f12] text-gray-500'}`}>
                      <div className="flex items-center justify-center gap-1">
                        {row._이식됨 && <span title={`고객 노트 이식됨 (${row._매칭방식 || ''})`} className="text-emerald-400 text-xs drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]">👑</span>}
                        {((currentPage - 1) * itemsPerPage + idx + 1).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-4 py-1.5 border-r border-[#222] text-center">
                      <span className={`px-2 py-1 rounded-md text-xs font-bold tracking-widest border ${
                        row.구분 === '기초수급자' ? 'bg-blue-950/60 text-blue-300 border-blue-600/50' :
                        row.구분 === '차상위'     ? 'bg-amber-950/60 text-amber-300 border-amber-600/50' :
                                                   'bg-[#050505] text-gray-500 border-gray-800'
                      }`}>{row.구분}</span>
                    </td>
                    <td className="px-4 py-1.5 border-r border-[#222] max-w-[120px] truncate text-gray-400">{row.행정동}</td>
                    <td className="px-4 py-1.5 border-r border-[#222] font-black text-white text-[13px] drop-shadow-md">{row.이름}</td>
                    <td className="px-4 py-1.5 border-r border-[#222] text-center text-fuchsia-400 font-bold">{row.품명}</td>
                    {localColVis.birth && <td className="px-4 py-1.5 border-r border-[#222] text-center text-gray-300 font-mono tracking-wider">{row.생년월일}</td>}
                    <td className="px-4 py-1.5 border-r border-[#222] text-center text-[#3b82f6] font-black bg-black/20">{row.포수 ? Number(row.포수).toLocaleString() : ""}</td>
                    <td className="px-4 py-1.5 border-r border-[#222] text-gray-300 font-bold tracking-wider">{row.휴대폰}</td>
                    {localColVis.contact2 && <td className="px-4 py-1.5 border-r border-[#222] text-gray-500 tracking-wider">{row.유선전화}</td>}
                    {localColVis.sms && <td className="px-4 py-1.5 border-r border-[#222] text-center"><span className={`px-2 py-0.5 rounded text-xs font-bold ${row.문자수신 === 'Y' ? 'bg-[#3b82f6]/20 text-[#93c5fd] border border-[#3b82f6]/30' : 'bg-transparent text-gray-600 border border-gray-700'}`}>{row.문자수신}</span></td>}

                    <td className="px-1 py-1 border-r border-l-2 border-l-[#3b82f6]/50 border-r-[#222] relative bg-black/40 group-hover:bg-black/60 transition-colors">
                      <input
                        className={`w-full h-full bg-transparent px-3 py-1.5 rounded outline-none focus:bg-[#060c18] focus:ring-2 focus:ring-[#3b82f6] shadow-inner font-bold transition-all ${row._에러 ? 'text-red-400 placeholder-red-800' : 'text-[#3b82f6]'}`}
                        value={row.주소}
                        onChange={(e) => handleCellEdit(row.id, '주소', e.target.value)}
                        onKeyDown={(e) => {
                          handleAddressKeyDown(e, row);
                          if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                            e.preventDefault();
                            const curIdx = paginatedData.findIndex(r => r.id === row.id);
                            if (curIdx > 0) handleCellEdit(row.id, '주소', paginatedData[curIdx - 1].주소);
                          }
                        }}
                        title={row._에러 ? `[오류사유] ${row._사유} (Enter키로 즉시 재정제)` : 'Enter키로 즉시 재정제'}
                        placeholder="주소가 비어있습니다. 수정 후 Enter"
                      />
                    </td>

                    {localColVis.note && (
                      <td className={`px-1 py-1 border-r border-[#222] bg-black/40 group-hover:bg-black/60 min-w-[180px] transition-colors ${row._이식됨 ? 'border-l-2 border-l-[#3b82f6]/30 bg-[#3b82f6]/5' : ''}`}>
                        <input
                          className={`w-full h-full bg-transparent px-3 py-1.5 rounded outline-none focus:bg-[#060c18] focus:ring-2 focus:ring-[#93c5fd] shadow-inner font-medium transition-all ${row.특이사항?.includes('◆') ? 'text-amber-300' : row._이식됨 ? 'text-[#93c5fd]' : 'text-gray-300'}`}
                          value={row.특이사항}
                          onChange={(e) => handleCellEdit(row.id, '특이사항', e.target.value)}
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                              e.preventDefault();
                              const curIdx = paginatedData.findIndex(r => r.id === row.id);
                              if (curIdx > 0) handleCellEdit(row.id, '특이사항', paginatedData[curIdx - 1].특이사항);
                            }
                          }}
                          placeholder=""
                        />
                      </td>
                    )}
                    {localColVis.driver && (
                      <td className={`px-1 py-1 border-r border-[#222] bg-black/20 min-w-[80px] ${row._이식됨 ? 'border-l-2 border-l-[#3b82f6]/30 bg-[#3b82f6]/5' : ''}`}>
                        <input
                          list="driver-list"
                          className={`w-full bg-transparent px-2 py-1.5 rounded outline-none focus:bg-[#060c18] focus:ring-1 focus:ring-[#3b82f6] text-xs font-mono transition-all ${row._이식됨 ? 'text-[#93c5fd]' : 'text-gray-300'} ${!(row.기사 || '').trim() ? 'placeholder-orange-800' : ''}`}
                          value={row.기사}
                          onChange={(e) => handleCellEdit(row.id, '기사', e.target.value)}
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                              e.preventDefault();
                              const curIdx = paginatedData.findIndex(r => r.id === row.id);
                              if (curIdx > 0) handleCellEdit(row.id, '기사', paginatedData[curIdx - 1].기사);
                            }
                          }}
                          placeholder="기사"
                          title={!(row.기사 || '').trim() ? '미배정' : ''}
                        />
                      </td>
                    )}
                    <td className={`px-4 py-1.5 text-xs font-bold ${row._에러 ? 'text-red-400' : 'text-gray-600'}`}>
                      <div className="flex items-center gap-2">
                        {row._주소추정 && (
                          <span
                            title={`원주소: ${row._원주소 || row.주소 || ''}\n${row._추정사유 || '주소 추정 변환 또는 오타 보정이 적용되었습니다.'}`}
                            className="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-400/35 text-amber-200 text-[10px] font-black"
                          >
                            추정
                          </span>
                        )}
                        <span>{row._에러 ? row._사유 : '정상'}</span>
                        {row._업데이트필요 && (
                          <button
                            onClick={() => setUpdateModalRow(row)}
                            className="px-2 py-1 bg-amber-500 text-black font-extrabold rounded text-xs hover:bg-amber-400 transition-colors shadow-md"
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
});

export default ResultGrid;

function UpdateBaseListModal({ row, onClose, onConfirm }) {
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
  const PHONE_KEYS = new Set(['mobile', 'landline']);
  const handleChange = (key, val) => {
    const formatted = PHONE_KEYS.has(key) ? formatPhoneInput(val) : val;
    setUpdates(p => ({ ...p, [key]: formatted }));
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[600] flex items-center justify-center p-4">
      <div className="bg-[#111] border border-amber-500/30 rounded-2xl w-full max-w-lg overflow-hidden shadow-[0_0_50px_rgba(245,158,11,0.15)] animate-in fade-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-[#222] flex justify-between items-center bg-gradient-to-r from-amber-950/40 to-transparent">
          <h2 className="text-amber-400 font-black text-lg flex items-center gap-2">
            <AlertTriangle size={20} /> 기본명단 덮어쓰기
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-6">
          <p className="text-sm text-gray-300 mb-4 font-bold">
            <span className="text-amber-400">[{row.이름}]</span> 님의 새로운 정보를 기본명단에 업데이트합니다. 이름은 변경할 수 없으며, 체크된 항목만 반영됩니다.
          </p>

          <div className="space-y-3 max-h-[50vh] overflow-y-auto scrollbar-thin scrollbar-thumb-[#444] pr-2">
            <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-800 bg-black/40 opacity-70">
              <input type="checkbox" checked readOnly className="w-4 h-4 accent-gray-600" />
              <div className="flex-1">
                <span className="text-xs text-gray-500 font-bold">성명 (고정)</span>
                <input type="text" value={row.이름} readOnly className="w-full mt-1 bg-transparent text-gray-400 font-bold outline-none cursor-default" />
              </div>
            </div>

            {[
              { key: 'address', label: '주소', color: 'text-yellow-400' },
              { key: 'mobile', label: '메인 연락처', color: 'text-blue-400' },
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
                  <span className={`text-xs font-black ${selected[field.key] ? field.color : 'text-gray-500'}`}>{field.label}</span>
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
