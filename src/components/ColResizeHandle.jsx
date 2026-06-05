import { useRef } from 'react';

// ── 칼럼 폭 드래그 핸들 (엑셀처럼) ──────────────────────────────────────────────
// 헤더 th 우측 끝에 얹는 드래그 영역. 부모 th 는 position:relative + 폭 style 적용.
// ★ 성능: 드래그 중에는 React state(setDraft)를 건드리지 않고 '해당 th 폭만 DOM으로' 즉시 반영한다.
//   (매 프레임 setState → 비가상화 그리드(수천 행) 전체 리렌더 → 렉·버벅임의 원인이었음)
//   놓는 순간(mouseup)에만 onResize(colKey, px)로 1회 커밋 → 전체 셀에 최종 폭 반영.
export default function ColResizeHandle({ colKey, currentWidth, minWidth = 40, onResize }) {
  const startX = useRef(0);
  const startW = useRef(0);
  const latest = useRef(0);

  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const thEl = e.currentTarget.parentElement; // 폭 style 이 적용되는 헤더 th
    startX.current = e.clientX;
    startW.current = currentWidth || thEl?.offsetWidth || 100;
    latest.current = startW.current;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev) => {
      const delta = ev.clientX - startX.current;
      latest.current = Math.max(minWidth, Math.round(startW.current + delta));
      // 드래그 중: 전체 그리드 리렌더 없이 해당 th 폭만 즉시 갱신 → 부드럽게 동작
      if (thEl) {
        thEl.style.width = `${latest.current}px`;
        thEl.style.minWidth = `${latest.current}px`;
        thEl.style.maxWidth = `${latest.current}px`;
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      onResize(colKey, latest.current); // 최종 폭 1회 커밋 (→ 모든 셀 반영)
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
