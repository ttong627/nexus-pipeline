import { useEffect, useRef, useCallback, memo } from 'react';
import { ChevronLeft, ChevronRight, Columns, X, GripVertical, RotateCcw, Eye, EyeOff } from 'lucide-react';

// ── 칼럼 순서 조정 패널 ────────────────────────────────────────────────────────
// exportColOrder(전역 칼럼 설정)를 드래그·← →·표시토글로 편집한다.
// ResultGrid·CloudListManager·BaseListManager 등 명단 화면에서 공유 사용.
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

export default ColOrderPanel;
