import { createContext, useContext, useState, useCallback, useRef } from 'react';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';

// ══════════════════════════════════════════════════════════════════
//  삭제 확인 Context — Promise 기반 프리미엄 모달
//  사용: const confirmDelete = useConfirmDelete();
//        if (!(await confirmDelete({ target, count, note, dangerous }))) return;
//  반환: 사용자가 끝까지 확인하면 true, 취소하면 false
// ══════════════════════════════════════════════════════════════════
const ConfirmDeleteCtx = createContext(() => Promise.resolve(false));

export function useConfirmDelete() {
  return useContext(ConfirmDeleteCtx);
}

export function ConfirmDeleteProvider({ children }) {
  const [dialog, setDialog] = useState(null); // { target, count, note, dangerous, step }
  const resolveRef = useRef(null);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    resolveRef.current = resolve;
    setDialog({ count: null, note: '', dangerous: false, ...opts, step: 1 });
  }), []);

  const settle = useCallback((result) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setDialog(null);
    resolve?.(result);
  }, []);

  const handleCancel = useCallback(() => settle(false), [settle]);

  const handleProceed = useCallback(() => {
    setDialog((d) => {
      if (d?.dangerous && d.step === 1) return { ...d, step: 2 }; // 2단계 진입
      // 최종 확정 — resolve는 다음 틱에서 안전하게 처리
      queueMicrotask(() => {
        const resolve = resolveRef.current;
        resolveRef.current = null;
        resolve?.(true);
      });
      return null;
    });
  }, []);

  return (
    <ConfirmDeleteCtx.Provider value={confirm}>
      {children}
      {dialog && (
        <ConfirmDeleteModal
          target={dialog.target}
          count={dialog.count}
          note={dialog.note}
          dangerous={dialog.dangerous}
          step={dialog.step}
          onCancel={handleCancel}
          onProceed={handleProceed}
        />
      )}
    </ConfirmDeleteCtx.Provider>
  );
}
