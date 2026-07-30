import { useState, useRef, memo, cloneElement } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Columns, Download, Trash2, Edit3, Database, X, MapPin, Users, UserX, StickyNote, Phone, BookOpen, Sparkles, ArrowLeftRight, Building2 } from 'lucide-react';
import { formatPhoneInput } from '../utils/parsers.js';
import { WORKFLOW_MODES } from '../utils/workflow.js';
import ColResizeHandle from './ColResizeHandle.jsx';
import ColumnEditBar from './ColumnEditBar.jsx';
import ColHeaderEditControls from './ColHeaderEditControls.jsx';
import { useColumnEditor } from '../hooks/useColumnEditor.js';
import AddressConfirmModal from './AddressConfirmModal.jsx';
import OrgPresetModal from './OrgPresetModal.jsx';
import { db, getDoc, doc } from '../config/firebase.js';
import { downloadOrgReport } from '../utils/orgReport.js';
import { hasRi, getColWidth, colCellStyle } from '../utils/colOrder.js';
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_HEIGHT = 40; // 본문 tr 높이(h-10 = 2.5rem). 가상화 estimateSize와 반드시 일치.
// 가상화(table-layout:fixed)에서 스크롤 중 칼럼폭이 흔들리지 않도록 칼럼별 기본 폭(px).
// 사용자가 칼럼을 리사이즈하면 getColWidth(editor.cols)가 우선한다.
const COL_W = {
  구분: 80, 행정동: 120, 리: 72, 이름: 96, 품명: 90, 생년월일: 100,
  포수: 64, 휴대폰: 132, 유선전화: 132, 문자수신: 76,
  주소: 440, 특이사항: 220, 기사: 104, 배송순번: 80, 사유: 170,
};

const ResultGrid = memo(function ResultGrid({
  step, setStep, filter, setFilter, dongList = [], driverList = [], gridData, filteredData, paginatedData, fileInfo = null,
  currentPage, setCurrentPage, itemsPerPage, setItemsPerPage, sortConfig, setSortConfig,
  handleCellEdit, handleAddressKeyDown, handleUpdateBaseList, handleBatchSaveBaseList, isSavingBaseList,
  handleSaveMonthlyList, handleExport, handleExportErrors, handleExportDongSummary,
  handleExportByDriver, handleDeleteRows, handleBatchSetNote, onHelp, onOpenRouteMap,
  purifyResult, onClosePurifyResult, onMovePhones, onRepurifyErrors, onReapplyFormat,
  onConfirmAddress, onMarkPhoneCheck,
  onFetchBaseNotes, isFetchingNotes,
  workflowMode = 'cleaningOnly', onWorkflowModeChange,
  addressDisplayMode = 'detailBeforeParen', onToggleAddressDisplayMode,   // A-11 기본: 상세 먼저, 건물명(괄호) 맨 뒤
  exportColOrder = [], setExportColOrder, defaultExportCols = [],
}) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchNoteOpen, setBatchNoteOpen] = useState(false);
  const [batchNoteValue, setBatchNoteValue] = useState('');
  const [updateModalRow, setUpdateModalRow] = useState(null);
  const [showAddrConfirm, setShowAddrConfirm] = useState(false);
  const [showOrgPreset, setShowOrgPreset] = useState(false);
  const searchInputRef = useRef(null);
  const editor = useColumnEditor({ exportColOrder, setExportColOrder, defaultExportCols });

  // 소속사 보고서 — 저장된 소속사 배분 있으면 즉시 엑셀 다운로드, 없으면 설정 모달
  const handleDownloadOrgReport = async () => {
    if (!fileInfo?.city) return alert('지자체 정보가 없어 소속사 보고서를 만들 수 없습니다.');
    if (!gridData.length) return alert('내보낼 데이터가 없습니다.');
    let orgs = [];
    try {
      const snap = await getDoc(doc(db, 'org_presets', fileInfo.city));
      orgs = snap.exists() ? (snap.data().orgs || []) : [];
    } catch { /* 무시 — 아래에서 미설정으로 처리 */ }
    if (!orgs.length) {
      alert('저장된 소속사 배분이 없습니다. 먼저 소속사와 담당 행정동을 설정해 주세요.');
      setShowOrgPreset(true);
      return;
    }
    const res = downloadOrgReport({ city: fileInfo.city, monthId: fileInfo.month || '미상', orgs, records: gridData });
    if (!res.ok) {
      if (res.reason === 'empty') { alert('소속사에 배정된 동에 해당하는 데이터가 없습니다. 배분을 확인해 주세요.'); setShowOrgPreset(true); }
      else alert('내보낼 데이터가 없습니다.');
    }
  };

  // 가상화 스크롤 컨테이너 + 가상화기. Hooks 규칙상 조기 반환(step !== 5)보다 먼저 호출해야 한다.
  // 편집 중에는 기존 규칙대로 상위 20행만 가상화 대상으로 둔다(폭조절 즉응 유지).
  const scrollRef = useRef(null);
  const virtualRows = editor.editing ? paginatedData.slice(0, 20) : paginatedData;
  const rowVirtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

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
  // 주소 확인 대상 = 오류이면서 아직 전화확인으로 분류되지 않은 건(담당자 확인 필요)
  const addrConfirmRows = gridData.filter(d => d._에러 && !d._전화확인);
  const inferredAddressCount = gridData.filter(d => d._주소추정 || (d._추정사유 || '').trim() || (d.특이사항 || '').includes('[주소추정]')).length;
  // 포수 합계 — 형 원칙: 포수 확인 최우선, 명(건) 옆에 포를 항상 병기. 빈 포수는 1로 계산(규칙 C-4)
  const poSum = (rows) => rows.reduce((s, r) => s + (parseInt(r.포수) || 1), 0);
  const totalPo = poSum(gridData);
  const errorPo = poSum(gridData.filter(d => d._에러));
  const successPo = poSum(gridData.filter(d => !d._에러));
  const inferredPo = poSum(gridData.filter(d => d._주소추정 || (d._추정사유 || '').trim() || (d.특이사항 || '').includes('[주소추정]')));
  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const modeInfo = WORKFLOW_MODES[workflowMode] || WORKFLOW_MODES.cleaningOnly;
  const isDetailBeforeParen = addressDisplayMode === 'detailBeforeParen';

  // 화면 칼럼은 exportColOrder(엑셀 다운로드 소스)의 순서·표시(on)를 그대로 따른다.
  // 체크박스 + NO는 sticky 고정이라 reorder 대상에서 제외한다.
  // 리(里)는 데이터가 있을 때만 표시(군 지역). 시/구 명단에선 숨김.
  // 리(里)는 데이터에 읍/면(리 보유 지역)이 있고 리 값이 있을 때만 표시. 동 지역(시/구 동만)은 숨긴다.
  // city 이름('군')이 아니라 '데이터의 읍/면 존재'로 판정 — 천안시·여주시처럼 시 안에 읍/면 섞인 경우 대응.
  const hasEupMyeon = gridData.some(r => /(읍|면)$/.test(String(r.행정동 ?? '').trim()));
  const riPresent = hasRi(gridData);
  const showRi = hasEupMyeon && riPresent;
  const visibleCols = editor.cols
    .filter(c => c.key !== 'NO' && (editor.editing || c.on !== false) && !(c.key === '리' && !showRi))
    .map(c => c.key);

  // 칼럼 폭: 사용자가 리사이즈한 값 우선, 없으면 기본폭(COL_W), 그래도 없으면 120px.
  const colWidthPx = (key) => getColWidth(editor.cols, key) ?? COL_W[key] ?? 120;
  const vItems = rowVirtualizer.getVirtualItems();
  const vTotal = rowVirtualizer.getTotalSize();
  const padTop = vItems.length ? vItems[0].start : 0;
  const padBottom = vItems.length ? vTotal - vItems[vItems.length - 1].end : 0;

  const renderHeaderCell = (key) => {
    switch (key) {
      case '구분':
        return <th key="구분" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center cursor-pointer hover:bg-[#222] transition-colors" onClick={() => handleSort('구분')}>구분 {sortConfig.key === '구분' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>;
      case '행정동':
        return <th key="행정동" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide cursor-pointer hover:bg-[#222] transition-colors" onClick={() => handleSort('행정동')}>읍면동 {sortConfig.key === '행정동' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>;
      case '리':
        return <th key="리" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center cursor-pointer hover:bg-[#222] transition-colors" onClick={() => handleSort('리')}>리 {sortConfig.key === '리' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>;
      case '이름':
        return <th key="이름" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide cursor-pointer hover:bg-[#222] transition-colors" onClick={() => handleSort('이름')}>이름 {sortConfig.key === '이름' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>;
      case '품명':
        return <th key="품명" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center cursor-pointer hover:bg-[#222] transition-colors" onClick={() => handleSort('품명')}>품명 {sortConfig.key === '품명' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>;
      case '생년월일':
        return <th key="생년월일" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">생년월일</th>;
      case '포수':
        return <th key="포수" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">포수</th>;
      case '휴대폰':
        return <th key="휴대폰" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">메인(휴대폰)</th>;
      case '유선전화':
        return <th key="유선전화" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">보조(유선)</th>;
      case '문자수신':
        return <th key="문자수신" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">문자수신</th>;
      case '주소':
        return <th key="주소" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-[#3b82f6] bg-gradient-to-b from-[#060c18] to-[#0a0a0a] text-sm min-w-[400px] cursor-pointer hover:from-[#112211]" onClick={() => handleSort('주소')}>통합 주소 (클릭하여 텍스트 직접 수정) {sortConfig.key === '주소' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}</th>;
      case '특이사항':
        return <th key="특이사항" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">특이사항 / 비고</th>;
      case '기사':
        return <th key="기사" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">기사</th>;
      case '배송순번':
        return <th key="배송순번" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center">배송순번</th>;
      case '사유':
        return <th key="사유" className="px-4 py-3 font-bold border-r border-[#222] tracking-wide">오류 사유</th>;
      default:
        return null;
    }
  };

  const renderBodyCell = (key, row) => {
    switch (key) {
      case '구분':
        return (
          <td key="구분" className="px-4 py-1.5 border-r border-[#222] text-center">
            <span className={`px-2 py-1 rounded-md text-xs font-bold tracking-widest border ${
              row.구분 === '기초수급자' ? 'bg-blue-950/60 text-blue-300 border-blue-600/50' :
              row.구분 === '차상위'     ? 'bg-amber-950/60 text-amber-300 border-amber-600/50' :
                                         'bg-[#050505] text-gray-500 border-gray-800'
            }`}>{row.구분}</span>
          </td>
        );
      case '행정동':
        return <td key="행정동" className="px-4 py-1.5 border-r border-[#222] max-w-[120px] truncate text-gray-400">{row.행정동}</td>;
      case '리':
        return <td key="리" className="px-4 py-1.5 border-r border-[#222] text-center text-emerald-300/80 max-w-[80px] truncate" title={row.리 || ''}>{row.리 || ''}</td>;
      case '이름':
        return <td key="이름" className="px-4 py-1.5 border-r border-[#222] font-black text-white text-[13px] drop-shadow-md">{row.이름}</td>;
      case '품명':
        return <td key="품명" className="px-4 py-1.5 border-r border-[#222] text-center text-fuchsia-400 font-bold">{row.품명}</td>;
      case '생년월일':
        return <td key="생년월일" className="px-4 py-1.5 border-r border-[#222] text-center text-gray-300 font-mono tracking-wider">{row.생년월일}</td>;
      case '포수':
        return <td key="포수" className="px-4 py-1.5 border-r border-[#222] text-center text-[#3b82f6] font-black bg-black/20">{row.포수 ? Number(row.포수).toLocaleString() : ""}</td>;
      case '휴대폰':
        return <td key="휴대폰" className="px-4 py-1.5 border-r border-[#222] text-gray-300 font-bold tracking-wider">{row.휴대폰}</td>;
      case '유선전화':
        return <td key="유선전화" className="px-4 py-1.5 border-r border-[#222] text-gray-500 tracking-wider">{row.유선전화}</td>;
      case '문자수신':
        return <td key="문자수신" className="px-4 py-1.5 border-r border-[#222] text-center"><span className={`px-2 py-0.5 rounded text-xs font-bold ${row.문자수신 === 'Y' ? 'bg-[#3b82f6]/20 text-[#93c5fd] border border-[#3b82f6]/30' : 'bg-transparent text-gray-600 border border-gray-700'}`}>{row.문자수신}</span></td>;
      case '주소':
        return (
          <td key="주소" className="px-1 py-1 border-r border-l-2 border-l-[#3b82f6]/50 border-r-[#222] relative bg-black/40 group-hover:bg-black/60 transition-colors">
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
        );
      case '특이사항':
        return (
          <td key="특이사항" className={`px-1 py-1 border-r border-[#222] bg-black/40 group-hover:bg-black/60 min-w-[180px] transition-colors ${row._이식됨 ? 'border-l-2 border-l-[#3b82f6]/30 bg-[#3b82f6]/5' : ''}`}>
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
        );
      case '기사':
        return (
          <td key="기사" className={`px-1 py-1 border-r border-[#222] bg-black/20 min-w-[80px] ${row._이식됨 ? 'border-l-2 border-l-[#3b82f6]/30 bg-[#3b82f6]/5' : ''}`}>
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
        );
      case '배송순번':
        return <td key="배송순번" className="px-4 py-1.5 border-r border-[#222] text-center text-gray-300 font-bold tabular-nums">{row.배송순번 || ''}</td>;
      case '사유':
        return (
          <td key="사유" className={`px-4 py-1.5 border-r border-[#222] text-xs font-bold ${row._에러 ? 'text-red-400' : 'text-gray-600'}`}>
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
        );
      default:
        return null;
    }
  };

  // 헤더 th: 가운데 정렬 + 폭 적용. 편집모드면 grip·눈·드래그·리사이즈 + 숨김칼럼 흐리게.
  const renderHeaderCellWithResize = (key) => {
    const th = renderHeaderCell(key);
    if (!th) return th;
    // table-layout:fixed에서 칼럼 폭은 첫 행(헤더)이 결정한다. 헤더는 가상화 대상이 아니므로
    // 스크롤 중에도 폭이 흔들리지 않고, ColResizeHandle의 th 폭 드래그 프리뷰도 그대로 동작한다.
    const w = colWidthPx(key);
    const on = editor.isOn(key);
    const dim = editor.editing && !on;
    const baseClass = `${th.props.className || ''}`.replace(/\btext-(left|right)\b/g, '').trim();
    const className = `${baseClass} text-center overflow-hidden ${dim ? 'opacity-40' : ''}`.trim();
    const props = { style: { ...(th.props.style || {}), ...(colCellStyle(w) || {}), position: 'relative' }, className };
    const children = [th.props.children];
    if (editor.editing) {
      Object.assign(props, editor.dragProps(key), { onClick: undefined, title: '드래그로 이동' });
      children.unshift(<ColHeaderEditControls key="__ce" colKey={key} on={on} onToggle={editor.toggleKey} />);
      children.push(<ColResizeHandle key="__rz" colKey={key} currentWidth={w} onResize={editor.resizeKey} />);
    }
    return cloneElement(th, props, ...children);
  };

  // 본문 td: 폭 적용 + 편집 중 숨김칼럼 흐리게
  const renderBodyCellWithWidth = (key, row) => {
    const td = renderBodyCell(key, row);
    if (!td) return td;
    const w = getColWidth(editor.cols, key);
    const dim = editor.editing && !editor.isOn(key);
    // table-layout:fixed에서 칼럼 폭을 넘는 내용이 옆칸을 침범하지 않도록 항상 overflow-hidden.
    const style = w ? { ...(td.props.style || {}), ...colCellStyle(w) } : td.props.style;
    const className = `${td.props.className || ''} overflow-hidden ${dim ? 'opacity-40' : ''}`.trim();
    return cloneElement(td, { style, className });
  };

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
            {purifyResult.quality?.hasIssues && (
              <div className="bg-black/40 border border-fuchsia-500/20 rounded-xl p-4 mb-4 space-y-2">
                <p className="text-xs text-fuchsia-300 font-black mb-2 flex items-center gap-1.5"><Sparkles size={13}/> 정밀 분석 (데이터 품질)</p>
                {purifyResult.quality.dupGroups > 0 && (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-fuchsia-400 font-bold">• 중복 의심 인물</span>
                      <span className="text-white font-black">{purifyResult.quality.dupGroups}명 · {purifyResult.quality.dupExtra}건 초과</span>
                    </div>
                    <p className="text-[11px] text-gray-500 leading-relaxed pl-2">
                      {purifyResult.quality.duplicates.slice(0, 12).map(d => `${d.name}(${d.count})`).join(' · ')}
                      {purifyResult.quality.duplicates.length > 12 ? ` 외 ${purifyResult.quality.duplicates.length - 12}명` : ''}
                    </p>
                  </>
                )}
                {purifyResult.quality.shortage?.headDiff > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-amber-400 font-bold">• 원본 대비 인원 부족</span>
                    <span className="text-white font-black">원본 {purifyResult.quality.shortage.declaredHead.toLocaleString()} → {purifyResult.quality.shortage.actualHead.toLocaleString()} ({purifyResult.quality.shortage.headDiff.toLocaleString()}건)</span>
                  </div>
                )}
                {purifyResult.quality.shortage?.qtyDiff > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-amber-400 font-bold">• 원본 대비 포수 부족</span>
                    <span className="text-white font-black">{purifyResult.quality.shortage.qtyDiff.toLocaleString()}포</span>
                  </div>
                )}
                {purifyResult.quality.qtyZero?.length > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-400 font-bold">• 포수 0 (누락 의심)</span>
                    <span className="text-white font-black">{purifyResult.quality.qtyZero.length}건</span>
                  </div>
                )}
                {purifyResult.quality.qtyHigh?.length > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-yellow-400 font-bold">• 포수 과다 (10↑)</span>
                    <span className="text-white font-black">{purifyResult.quality.qtyHigh.length}건</span>
                  </div>
                )}
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
                전체 <span className="font-mono font-black">{gridData.length.toLocaleString()}</span><span className="font-mono text-emerald-300/70">·{totalPo.toLocaleString()}포</span>
              </button>
              <button
                onClick={() => setFilter(f => ({ ...f, showErrorsOnly: !filter.showErrorsOnly, showSuccessOnly: false, inferredAddress: false }))}
                className={`px-4 py-1.5 text-xs rounded-md flex items-center gap-1.5 transition-all font-bold ${filter.showErrorsOnly ? 'bg-red-950/60 border border-red-500/50 text-red-400' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <AlertTriangle size={12}/> 확인필요 <span className="font-mono font-black">{errorCount.toLocaleString()}</span><span className="font-mono opacity-70">·{errorPo.toLocaleString()}포</span>
              </button>
              <button
                onClick={() => setFilter(f => ({ ...f, showSuccessOnly: !filter.showSuccessOnly, showErrorsOnly: false, inferredAddress: false }))}
                className={`px-4 py-1.5 text-xs rounded-md flex items-center gap-1.5 transition-all font-bold ${filter.showSuccessOnly ? 'bg-emerald-950/50 border border-emerald-500/35 text-emerald-300' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <CheckCircle size={12}/> 정제완료 <span className="font-mono font-black">{gridData.filter(d=>!d._에러).length.toLocaleString()}</span><span className="font-mono opacity-70">·{successPo.toLocaleString()}포</span>
              </button>
              {inferredAddressCount > 0 && (
                <button
                  onClick={() => setFilter(f => ({ ...f, inferredAddress: !f.inferredAddress, showErrorsOnly: false, showSuccessOnly: false }))}
                  title="오타 보정, 도로명 추정, 압축 주소 변환처럼 시스템이 임의 보정한 주소만 모아봅니다."
                  className={`px-4 py-1.5 text-xs rounded-md flex items-center gap-1.5 transition-all font-bold ${filter.inferredAddress ? 'bg-amber-950/60 border border-amber-400/50 text-amber-200' : 'text-gray-500 hover:text-amber-200'}`}
                >
                  <Sparkles size={12}/> 주소 추정 <span className="font-mono font-black">{inferredAddressCount.toLocaleString()}</span><span className="font-mono opacity-70">·{inferredPo.toLocaleString()}포</span>
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
            {gridData.length > 0 && onReapplyFormat && (
              <button
                onClick={onReapplyFormat}
                title="원본 입력 주소를 기준으로 최신 정제 규칙을 다시 적용합니다. 규칙으로 못 찾은 건은 기존 주소를 그대로 유지하고(망가뜨리지 않음), 특이사항·전화·구분은 변경하지 않습니다."
                className="px-3 py-1.5 bg-indigo-950/70 border border-indigo-500/50 text-indigo-300 text-xs font-bold rounded-lg flex items-center gap-1.5 hover:bg-indigo-900/70 hover:border-indigo-400/70 hover:text-indigo-200 transition-all shrink-0"
              >
                ↻ 도로명규칙 재적용
              </button>
            )}
            {addrConfirmRows.length > 0 && onConfirmAddress && (
              <button
                onClick={() => setShowAddrConfirm(true)}
                title="이번달 주소가 없거나 못 찾은 건을 담당자가 한 건씩 확인합니다."
                className="px-3 py-1.5 bg-amber-950/70 border border-amber-500/50 text-amber-300 text-xs font-bold rounded-lg flex items-center gap-1.5 hover:bg-amber-900/70 hover:border-amber-400/70 hover:text-amber-200 transition-all shrink-0"
              >
                <MapPin size={12}/> 주소 확인 <span className="font-mono font-black">{addrConfirmRows.length}</span>
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
            <button
              onClick={onHelp}
              className="w-8 h-8 rounded-full bg-emerald-950/30 border border-emerald-500/40 text-emerald-400 font-black text-sm hover:bg-emerald-500/20 hover:scale-110 transition-all shrink-0"
              title="결과 화면 도움말"
            >?</button>
            <div className="h-5 w-px bg-[#2a2a2a]"/>
            <button
              onClick={editor.editing ? editor.commit : editor.begin}
              title="칼럼 순서·폭·표시 편집 (헤더를 끌어 이동, 가장자리로 폭조절, 👁로 표시/숨김)"
              className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all ${
                editor.editing
                  ? 'bg-emerald-500 border-emerald-400 text-black'
                  : 'bg-[#0d1a0d] border-[#1a3a1a] text-emerald-500/70 hover:text-emerald-300 hover:border-emerald-500/40'
              }`}
            >
              <Columns size={13} />
              <span className="hidden sm:inline">{editor.editing ? '완료' : '칼럼 편집'}</span>
            </button>
            <button onClick={handleExport} className="px-5 py-2 bg-emerald-400 text-black font-black rounded-lg shadow-[0_0_12px_rgba(52,211,153,0.22)] hover:bg-emerald-300 transition-all flex items-center gap-2 text-xs">
              <Download size={14} strokeWidth={2.5}/> 명단 다운로드
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
            <button
              onClick={handleDownloadOrgReport}
              className="px-3 py-1.5 bg-[#111] border border-[#252525] text-gray-400 font-bold rounded-lg hover:bg-[#1a1a1a] hover:text-gray-200 transition-colors flex items-center gap-1.5 text-xs"
              title="소속사별 담당 행정동을 묶어 엑셀 시트로 분리해 즉시 다운로드 (배분 미설정 시 설정창)"
            >
              <Building2 size={12}/> 소속사 보고서
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

            {setItemsPerPage && (
              <select
                value={itemsPerPage}
                onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                className="bg-black/60 border border-[#1e1e1e] text-gray-300 rounded-lg px-2 py-1.5 text-xs font-bold outline-none hover:border-[#3b82f6]/40 cursor-pointer"
                title="페이지당 표시 행 수"
              >
                {[100, 200, 500, 1000].map(n => <option key={n} value={n} className="bg-[#0a0a0a]">{n.toLocaleString()}행</option>)}
              </select>
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
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input
              ref={searchInputRef}
              type="text"
              value={filter.text}
              onChange={e => setFilter(f => ({ ...f, text: e.target.value }))}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchInputRef.current?.focus(); }
              }}
              placeholder="이름·행정동·주소 검색  (Ctrl+F)"
              className="nexus-search-input bg-[#0a1410] border-2 border-emerald-500/50 rounded-xl pl-11 pr-9 py-2.5 text-sm font-bold text-white outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30 focus:bg-[#0c1a13] placeholder:text-gray-500 placeholder:font-normal w-80 shadow-[0_0_14px_rgba(16,185,129,0.18)] transition-all"
            />
            {filter.text && (
              <button onClick={() => setFilter(f => ({ ...f, text: '' }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-red-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
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

        <div ref={scrollRef} className="flex-1 overflow-auto relative scrollbar-thin scrollbar-thumb-[#555] scrollbar-track-black/50">
          <table className="w-full text-left text-[12px] whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed' }}>
            <thead className="sticky top-0 bg-[#0a100c] z-20 text-gray-400 shadow-[0_5px_15px_rgba(0,0,0,0.8)] border-b-2 border-[#333]">
              <tr>
                <th style={{ width: 40 }} className="px-2 py-3 font-bold border-r border-[#222] text-center sticky left-0 bg-[#0a100c] z-30 shadow-[2px_0_5px_rgba(0,0,0,0.5)] w-10">
                  <input type="checkbox" checked={allPageSelected} onChange={toggleAll} className="accent-[#3b82f6] w-4 h-4 cursor-pointer" />
                </th>
                <th style={{ width: 56 }} className="px-4 py-3 font-bold border-r border-[#222] tracking-wide text-center sticky left-10 bg-[#0a100c] z-30 shadow-[2px_0_5px_rgba(0,0,0,0.5)]">NO</th>
                {visibleCols.map(renderHeaderCellWithResize)}
              </tr>
            </thead>
            <tbody className="font-mono text-gray-200">
              {/* 가상화: 화면에 보이는 행만 렌더하고 위·아래를 빈 행 높이로 채워 전체 스크롤 높이를 유지.
                  편집 중에는 기존 규칙대로 상위 20행만 대상(폭조절 즉응). */}
              {padTop > 0 && (
                <tr aria-hidden="true"><td colSpan={visibleCols.length + 2} style={{ height: padTop, padding: 0, border: 0 }} /></tr>
              )}
              {vItems.map(vRow => {
                const row = virtualRows[vRow.index];
                const idx = vRow.index;
                const isSelected = selectedIds.has(row.id);
                return (
                  <tr key={row.id} style={{ height: ROW_HEIGHT }} className={`border-b border-[#222] group transition-colors ${isSelected ? 'bg-amber-950/20' : row._에러 ? 'bg-red-950/20 hover:bg-red-900/40' : 'bg-transparent hover:bg-[#060c18]/60'}`}>
                    <td className={`px-2 py-1.5 border-r border-[#222] text-center sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.3)] ${isSelected ? 'bg-amber-950/40' : row._에러 ? 'bg-[#1a0505]' : 'bg-[#0a0a0a] group-hover:bg-[#0f1f12]'}`}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer" />
                    </td>
                    <td className={`px-4 py-1.5 border-r border-[#222] text-center sticky left-10 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.3)] font-bold ${isSelected ? 'bg-amber-950/40 text-amber-300' : row._에러 ? 'bg-[#1a0505] text-red-400 border-l-4 border-l-red-500' : 'bg-[#0a0a0a] group-hover:bg-[#0f1f12] text-gray-500'}`}>
                      <div className="flex items-center justify-center gap-1">
                        {row._이식됨 && <span title={`고객 노트 이식됨 (${row._매칭방식 || ''})`} className="text-emerald-400 text-xs drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]">👑</span>}
                        {((currentPage - 1) * itemsPerPage + idx + 1).toLocaleString()}
                      </div>
                    </td>
                    {visibleCols.map(k => renderBodyCellWithWidth(k, row))}
                  </tr>
                );
              })}
              {padBottom > 0 && (
                <tr aria-hidden="true"><td colSpan={visibleCols.length + 2} style={{ height: padBottom, padding: 0, border: 0 }} /></tr>
              )}
              {editor.editing && paginatedData.length > 20 && (
                <tr>
                  <td colSpan={visibleCols.length + 2} className="px-4 py-2.5 text-center text-[11px] font-bold text-amber-400/80 bg-amber-950/15 border-b border-[#222]">
                    ⚡ 칼럼 편집 중 — 빠른 조작을 위해 상위 20행만 미리보기 (편집 완료 시 전체 복원)
                  </td>
                </tr>
              )}
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

      {editor.editing && (
        <ColumnEditBar onReset={editor.reset} onCancel={editor.cancel} onCommit={editor.commit} />
      )}

      {showAddrConfirm && addrConfirmRows.length > 0 && (
        <AddressConfirmModal
          rows={addrConfirmRows}
          onConfirm={onConfirmAddress}
          onPhoneCheck={onMarkPhoneCheck}
          onClose={() => setShowAddrConfirm(false)}
        />
      )}

      {showOrgPreset && fileInfo?.city && (
        <OrgPresetModal
          city={fileInfo.city}
          records={gridData}
          monthId={fileInfo.month || '미상'}
          onClose={() => setShowOrgPreset(false)}
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
