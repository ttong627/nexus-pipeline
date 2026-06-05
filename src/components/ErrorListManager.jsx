import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { ArrowLeft, AlertTriangle, Download, Search, X, RefreshCw, MapPin, Columns } from 'lucide-react';
import ColResizeHandle from './ColResizeHandle.jsx';
import ColumnEditBar from './ColumnEditBar.jsx';
import ColHeaderEditControls from './ColHeaderEditControls.jsx';
import { useColumnEditor } from '../hooks/useColumnEditor.js';
import { orderFieldsByExport, getColWidth, colCellStyle } from '../utils/colOrder.js';

const ADDR_FIELDS = [
  { key: '이름',     label: '이름',     minW: '80px' },
  { key: '생년월일', label: '생년월일', minW: '80px' },
  { key: '행정동',   label: '읍면동',   minW: '75px' },
  { key: '주소',     label: '주소',     minW: '240px' },
  { key: '휴대폰',   label: '휴대폰',   minW: '110px' },
  { key: '유선전화', label: '유선전화', minW: '110px' },
  { key: '특이사항', label: '특이사항', minW: '160px' },
  { key: '_사유',    label: '오류사유', minW: '140px' },
];

const COORD_FIELDS = [
  { key: '이름',     label: '이름',     minW: '80px' },
  { key: '행정동',   label: '읍면동',   minW: '75px' },
  { key: '주소',     label: '주소',     minW: '280px' },
  { key: '휴대폰',   label: '휴대폰',   minW: '110px' },
  { key: '특이사항', label: '특이사항', minW: '160px' },
];

export default function ErrorListManager({ gridData, onBack, handleCellEdit, handleAddressKeyDown, handleExportErrors, onRepurifyErrors, exportColOrder = [], setExportColOrder, defaultExportCols = [] }) {
  const [activeTab, setActiveTab] = useState('address');
  const [search, setSearch] = useState('');
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const editor = useColumnEditor({ exportColOrder, setExportColOrder, defaultExportCols });

  // 탭 1: 도로명주소 미매칭
  const addrErrorRows = useMemo(() =>
    (gridData || []).filter(r => r._에러),
  [gridData]);

  // 탭 2: 좌표 누락 (주소는 있으나 lat/lng 없는 것)
  const coordMissingRows = useMemo(() =>
    (gridData || []).filter(r => r.주소 && !r.lat && !r.lng),
  [gridData]);

  const currentRows = activeTab === 'address' ? addrErrorRows : coordMissingRows;
  // 칼럼 순서·표시 — exportColOrder(전역, 엑셀·정제결과와 공유) 기준으로 재정렬
  const currentFields = useMemo(
    () => orderFieldsByExport(activeTab === 'address' ? ADDR_FIELDS : COORD_FIELDS, editor.cols, editor.editing),
    [activeTab, editor.cols, editor.editing]
  );

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return currentRows;
    return currentRows.filter(r =>
      [r.이름, r.행정동, r.주소, r.휴대폰, r.특이사항, r._사유]
        .some(v => String(v || '').toLowerCase().includes(q))
    );
  }, [currentRows, search]);

  const startEdit = (id, field, val) => {
    setEditingCell({ id, field });
    setEditValue(String(val ?? ''));
  };

  const commitEdit = (id, field) => {
    if (handleCellEdit) handleCellEdit(id, field, editValue);
    setEditingCell(null);
  };

  const handleExportAddr = () => {
    if (!addrErrorRows.length) return;
    const data = addrErrorRows.map((r, i) => ({
      번호: i + 1, 구분: r.구분 || '', 이름: r.이름 || '',
      생년월일: r.생년월일 || '', 행정동: r.행정동 || '', 주소: r.주소 || '',
      휴대폰: r.휴대폰 || '', 유선전화: r.유선전화 || '',
      포수: r.포수 || '', 특이사항: r.특이사항 || '', 오류사유: r._사유 || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '주소오류명단');
    const now = new Date();
    const ts = `${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    XLSX.writeFile(wb, `[확인필요]오류명단_${ts}.xlsx`);
  };

  const handleExportCoord = () => {
    if (!coordMissingRows.length) return;
    const data = coordMissingRows.map((r, i) => ({
      번호: i + 1, 구분: r.구분 || '', 이름: r.이름 || '',
      행정동: r.행정동 || '', 주소: r.주소 || '',
      휴대폰: r.휴대폰 || '', 특이사항: r.특이사항 || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '좌표누락명단');
    const now = new Date();
    const ts = `${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    XLSX.writeFile(wb, `[좌표없음]명단_${ts}.xlsx`);
  };

  const isEmpty = currentRows.length === 0;

  return (
    <div className="absolute inset-0 bg-[#050505] flex flex-col">

      {/* 헤더 */}
      <div className="h-14 shrink-0 bg-[#080808] border-b border-[#1a1a1a] flex items-center px-5 gap-3">
        <button onClick={onBack} className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <AlertTriangle size={17} className="text-red-400 shrink-0" />
          <div>
            <h1 className="text-sm font-black text-white leading-tight">오류 명단 작업</h1>
            <p className="text-[10px] text-gray-600 leading-tight">
              주소오류 <span className="text-red-400 font-bold">{addrErrorRows.length.toLocaleString()}</span>건
              &nbsp;·&nbsp;
              좌표누락 <span className="text-amber-400 font-bold">{coordMissingRows.length.toLocaleString()}</span>건
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeTab === 'address' && addrErrorRows.length > 0 && onRepurifyErrors && (
            <button
              onClick={onRepurifyErrors}
              title="주소 수정 후 전체 오류 행을 API로 일괄 재처리합니다"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-orange-950/70 border border-orange-500/50 text-orange-300 hover:bg-orange-900/70 hover:text-orange-200 transition-colors"
            >
              ↺ 일괄 재정제 ({addrErrorRows.length})
            </button>
          )}
          {activeTab === 'address' && addrErrorRows.length > 0 && (
            <button
              onClick={handleExportAddr}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 hover:bg-white/10 text-gray-300 border border-white/5 transition-colors"
            >
              <Download size={13} /> xlsx 내보내기
            </button>
          )}
          {activeTab === 'coord' && coordMissingRows.length > 0 && (
            <button
              onClick={handleExportCoord}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 hover:bg-white/10 text-gray-300 border border-white/5 transition-colors"
            >
              <Download size={13} /> xlsx 내보내기
            </button>
          )}
          {/* 칼럼 편집 토글 (헤더 직접 드래그·폭조절·표시/숨김) */}
          {setExportColOrder && exportColOrder.length > 0 && (
            <button
              onClick={editor.editing ? editor.commit : editor.begin}
              title="칼럼 편집 — 헤더를 끌어 이동, 가장자리로 폭조절, 👁로 표시/숨김"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-colors shrink-0 ${
                editor.editing
                  ? 'bg-emerald-500 border-emerald-400 text-black'
                  : 'bg-[#0d1a0d] border-[#1a3a1a] text-emerald-500/70 hover:text-emerald-300 hover:border-emerald-500/40'
              }`}
            >
              <Columns size={13} />
              {editor.editing ? '완료' : '칼럼 편집'}
            </button>
          )}
        </div>
      </div>

      {/* 탭 바 */}
      <div className="shrink-0 bg-[#080808] border-b border-[#181818] flex items-end px-4 gap-1">
        <button
          onClick={() => { setActiveTab('address'); setSearch(''); setEditingCell(null); }}
          className={`px-4 py-2.5 text-[11px] font-bold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'address'
              ? 'text-red-300 border-red-500 bg-red-950/20'
              : 'text-gray-600 border-transparent hover:text-gray-400'
          }`}
        >
          <AlertTriangle size={11} />
          도로명주소 미매칭
          {addrErrorRows.length > 0 && (
            <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black ${activeTab === 'address' ? 'bg-red-500/30 text-red-300' : 'bg-gray-800 text-gray-500'}`}>
              {addrErrorRows.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setActiveTab('coord'); setSearch(''); setEditingCell(null); }}
          className={`px-4 py-2.5 text-[11px] font-bold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'coord'
              ? 'text-amber-300 border-amber-500 bg-amber-950/20'
              : 'text-gray-600 border-transparent hover:text-gray-400'
          }`}
        >
          <MapPin size={11} />
          좌표 누락
          {coordMissingRows.length > 0 && (
            <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black ${activeTab === 'coord' ? 'bg-amber-500/30 text-amber-300' : 'bg-gray-800 text-gray-500'}`}>
              {coordMissingRows.length}
            </span>
          )}
        </button>
      </div>

      {/* 검색바 */}
      <div className="shrink-0 border-b border-[#181818] bg-[#080808] px-4 py-2 flex items-center gap-3">
        <div className="relative w-64">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="이름, 주소, 오류사유 검색..."
            className="w-full bg-[#0a1410] border-2 border-emerald-500/50 rounded-xl pl-8 pr-7 py-1.5 text-xs font-bold text-white outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30 focus:bg-[#0c1a13] placeholder:text-gray-500 placeholder:font-normal shadow-[0_0_14px_rgba(16,185,129,0.18)] transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
              <X size={11} />
            </button>
          )}
        </div>
        <span className="text-[11px] text-gray-600">
          표시 <span className="text-gray-400 font-bold">{displayed.length}</span>건 / 전체 <span className={`font-bold ${activeTab === 'address' ? 'text-red-400' : 'text-amber-400'}`}>{currentRows.length}</span>건
        </span>
        {activeTab === 'address' && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/30 border border-amber-700/30 text-amber-400 text-[11px] font-bold">
            <RefreshCw size={11} />
            주소 셀 클릭 후 수정 → Enter키로 재정제
          </div>
        )}
        {activeTab === 'coord' && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-950/30 border border-blue-700/30 text-blue-400 text-[11px] font-bold">
            <MapPin size={11} />
            이번달 배송명단에서 좌표 받아오기로 보완 가능
          </div>
        )}
      </div>

      {/* 테이블 */}
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-700">
          {activeTab === 'address' ? (
            <>
              <AlertTriangle size={48} className="opacity-15" />
              <p className="text-sm">주소 오류 레코드가 없습니다</p>
              <p className="text-xs text-gray-800">주소 정제가 완료된 현재 명단에는 확인 필요 항목이 없습니다</p>
            </>
          ) : (
            <>
              <MapPin size={48} className="opacity-15" />
              <p className="text-sm">좌표 누락 레코드가 없습니다</p>
              <p className="text-xs text-gray-800">모든 레코드에 좌표가 있거나, 아직 주소가 없습니다</p>
            </>
          )}
          <button onClick={onBack} className="mt-2 px-4 py-2 rounded-xl bg-blue-900/30 text-blue-300 text-xs font-bold border border-blue-500/30 hover:bg-blue-900/50 transition-colors">
            명단으로 돌아가기
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse" style={{ minWidth: activeTab === 'address' ? '980px' : '840px' }}>
            <thead className="sticky top-0 z-10">
              <tr className={`border-b border-[#1e1e1e] ${activeTab === 'address' ? 'bg-[#0c0c0c]' : 'bg-[#0a0c0a]'}`}>
                <th className="px-3 py-2.5 text-left text-[10px] text-gray-700 font-bold w-9">#</th>
                {currentFields.map(f => {
                  const w = getColWidth(editor.cols, f.key);
                  const on = editor.isOn(f.key);
                  const dim = editor.editing && !on;
                  return (
                    <th key={f.key}
                      {...(editor.editing ? editor.dragProps(f.key) : {})}
                      style={{ ...(colCellStyle(w) || { minWidth: f.minW }), position: 'relative' }}
                      className={`px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider overflow-hidden ${dim ? 'opacity-40' : ''} ${
                        f.key === '_사유' ? 'text-red-600/70' : 'text-gray-600'
                      }`}>
                      {editor.editing && <ColHeaderEditControls colKey={f.key} on={on} onToggle={editor.toggleKey} />}
                      {f.label}
                      {editor.editing && <ColResizeHandle colKey={f.key} currentWidth={w} onResize={editor.resizeKey} />}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayed.map((r, idx) => (
                <tr key={r.id} className={`border-b border-[#111] group ${activeTab === 'address' ? 'hover:bg-red-950/5' : 'hover:bg-amber-950/5'}`}>
                  <td className="px-3 py-2 text-[10px] text-gray-700">{idx + 1}</td>
                  {currentFields.map(f => {
                    const isEditing = editingCell?.id === r.id && editingCell?.field === f.key;
                    const val = r[f.key] ?? '';
                    const isAddr = f.key === '주소';
                    const isReason = f.key === '_사유';
                    const isReadOnly = activeTab === 'coord'; // 좌표탭은 읽기 전용
                    const cellStyle = colCellStyle(getColWidth(editor.cols, f.key)) || { minWidth: f.minW };
                    const dim = editor.editing && !editor.isOn(f.key);

                    if (isEditing) {
                      return (
                        <td key={f.key} style={cellStyle} className={`px-3 py-1.5 max-w-0 overflow-hidden ${dim ? 'opacity-40' : ''}`}>
                          <input
                            autoFocus
                            className="w-full bg-transparent text-white text-xs outline-none border-b border-blue-400 py-0.5"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(r.id, f.key)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && isAddr) {
                                commitEdit(r.id, f.key);
                                if (handleAddressKeyDown) handleAddressKeyDown(e, r.id, editValue);
                              } else if (e.key === 'Enter') {
                                commitEdit(r.id, f.key);
                              } else if (e.key === 'Escape') {
                                setEditingCell(null);
                              }
                            }}
                          />
                        </td>
                      );
                    }

                    return (
                      <td key={f.key} style={cellStyle} className={`px-3 py-2 max-w-0 overflow-hidden ${dim ? 'opacity-40' : ''}`}>
                        <span
                          title={String(val)}
                          onClick={() => !isReason && !isReadOnly && startEdit(r.id, f.key, val)}
                          className={`block truncate text-xs ${
                            isReason
                              ? 'text-red-400/70 font-bold'
                              : isAddr && !isReadOnly
                              ? 'cursor-text text-amber-300/80 hover:text-amber-200'
                              : isReadOnly
                              ? 'text-gray-400'
                              : 'cursor-text text-gray-300 hover:text-white'
                          } ${!val ? 'text-gray-700' : ''}`}
                        >
                          {val || '—'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor.editing && (
        <ColumnEditBar onReset={editor.reset} onCancel={editor.cancel} onCommit={editor.commit} />
      )}
    </div>
  );
}
