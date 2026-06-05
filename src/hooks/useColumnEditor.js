import { useState, useRef, useCallback } from 'react';
import { moveColTo, setColWidthInCols, toggleColOn, isColOn } from '../utils/colOrder.js';

// ── 칼럼 편집 모드 훅 ────────────────────────────────────────────────────────
// 편집 시작 시 exportColOrder를 draft로 복제 → 드래그/폭/숨김은 draft만 수정(미리보기).
// 완료(commit) 시에만 setExportColOrder로 커밋 → 기존 localStorage+Firestore 동기화가
// 1회 반영(전 명단·전 기기). 취소는 폐기, 기본복원은 defaultExportCols.
export function useColumnEditor({ exportColOrder = [], setExportColOrder, defaultExportCols = [] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const dragKeyRef = useRef(null);

  const begin = useCallback(() => {
    setDraft(Array.isArray(exportColOrder) ? exportColOrder.map(c => ({ ...c })) : []);
    setEditing(true);
  }, [exportColOrder]);

  const cancel = useCallback(() => { setEditing(false); setDraft(null); dragKeyRef.current = null; }, []);

  const commit = useCallback(() => {
    if (draft && setExportColOrder) setExportColOrder(draft);
    setEditing(false); setDraft(null); dragKeyRef.current = null;
  }, [draft, setExportColOrder]);

  const reset = useCallback(() => {
    if (Array.isArray(defaultExportCols) && defaultExportCols.length) {
      setDraft(defaultExportCols.map(c => ({ ...c })));
    }
  }, [defaultExportCols]);

  const moveKey = useCallback((dragKey, targetKey) => setDraft(d => moveColTo(d, dragKey, targetKey)), []);
  const toggleKey = useCallback((key) => setDraft(d => toggleColOn(d, key)), []);
  const resizeKey = useCallback((key, px) => setDraft(d => setColWidthInCols(d, key, px)), []);

  // 뷰는 항상 cols 로 순서·폭·표시를 계산(편집 중이면 draft, 아니면 실제값)
  const cols = editing ? (draft || exportColOrder) : exportColOrder;
  const isOn = useCallback((key) => isColOn(cols, key), [cols]);

  // 헤더 th 에 펼칠 드래그 props (편집 중에만 활성)
  const dragProps = useCallback((key) => (editing ? {
    draggable: true,
    onDragStart: (e) => { dragKeyRef.current = key; e.dataTransfer.effectAllowed = 'move'; },
    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    onDrop: (e) => {
      e.preventDefault();
      const dk = dragKeyRef.current;
      if (dk && dk !== key) moveKey(dk, key);
      dragKeyRef.current = null;
    },
  } : {}), [editing, moveKey]);

  return { editing, cols, begin, commit, cancel, reset, moveKey, toggleKey, resizeKey, isOn, dragProps };
}
