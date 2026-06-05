import { GripVertical, Eye, EyeOff } from 'lucide-react';

// ── 편집 모드 헤더 컨트롤 (grip 손잡이 + 표시/숨김 토글) ─────────────────────────
// 헤더 th 안에 라벨 앞에 렌더. grip은 드래그 affordance(th 전체가 draggable),
// 눈 버튼은 해당 칼럼 on/off 토글. 클릭이 정렬/드래그로 번지지 않게 stopPropagation.
export default function ColHeaderEditControls({ colKey, on, onToggle }) {
  return (
    <span className="inline-flex items-center gap-0.5 mr-1 align-middle">
      <GripVertical size={12} className="text-emerald-400/70 cursor-grab shrink-0" />
      <button
        type="button"
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggle(colKey); }}
        title={on ? '이 칼럼 숨기기' : '이 칼럼 표시'}
        className={`shrink-0 p-0.5 rounded transition-colors ${
          on ? 'text-emerald-400 hover:bg-emerald-400/15' : 'text-gray-600 hover:text-gray-300 hover:bg-white/10'
        }`}
      >
        {on ? <Eye size={11} /> : <EyeOff size={11} />}
      </button>
    </span>
  );
}
