import { useRef } from 'react';

// ── 칼럼 폭 드래그 핸들 (엑셀처럼) ──────────────────────────────────────────────
// 헤더 th 우측 끝에 얹는 4px 폭 드래그 영역.
// 부모 th 는 position:relative + 폭 style 적용. 드래그 시 onResize(colKey, px) 호출.
// colKey 는 뷰의 원본 필드 키(별칭 정규화는 onResize 쪽 setColWidthInCols 에서 처리).
export default function ColResizeHandle({ colKey, currentWidth, minWidth = 40, onResize }) {
  const startX = useRef(0);
  const startW = useRef(0);
  const latest = useRef(0);
  const rafId = useRef(null);

  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startW.current = currentWidth || e.currentTarget.parentElement?.offsetWidth || 100;
    latest.current = startW.current;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev) => {
      const delta = ev.clientX - startX.current;
      latest.current = Math.max(minWidth, Math.round(startW.current + delta));
      if (rafId.current == null) {
        rafId.current = requestAnimationFrame(() => {
          rafId.current = null;
          onResize(colKey, latest.current);
        });
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (rafId.current != null) { cancelAnimationFrame(rafId.current); rafId.current = null; }
      onResize(colKey, latest.current); // 최종 폭 커밋
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <span
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
      title="드래그하여 칼럼 폭 조절"
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none z-20 hover:bg-emerald-400/40 active:bg-emerald-400/60"
      style={{ touchAction: 'none' }}
    />
  );
}
