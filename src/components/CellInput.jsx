// ══════════════════════════════════════════════════════════════════════════
//  CellInput — 표 셀 인라인 입력 (공용)
//
//  ★ 성능 원칙(절대 되돌리지 말 것): 입력값은 이 컴포넌트가 **자기 상태로만**
//    관리한다. 부모(명단 화면)에 setState 하면 글자 하나 칠 때마다 수천 행짜리
//    표 전체가 다시 계산돼 타이핑이 버벅거린다(2026-07-22 형 지적).
//    → onCommit 은 편집이 끝날 때(Enter·Tab·포커스 이탈) 단 한 번만 호출한다.
// ══════════════════════════════════════════════════════════════════════════
import { useState, useRef, useEffect, memo } from 'react';

/**
 * @param {object} p
 * @param {string} [p.type] 'select' | 'number' | 그 외 텍스트
 * @param {string[]} [p.opts] select 항목
 * @param {string} p.initial 초기값
 * @param {(v:string, move?:'next'|'prev'|null)=>void} p.onCommit 편집 확정
 * @param {()=>void} p.onCancel Esc
 * @param {boolean} [p.isPhone] 전화번호 자동 서식
 * @param {(v:string)=>string} [p.format] 입력 서식 함수(전화 등)
 * @param {boolean} [p.autoFocus] 포커스 여부(칼럼 수정모드에서는 현재 칸만 true)
 */
const CellInput = memo(function CellInput({ type, opts, initial, onCommit, onCancel, isPhone, format, autoFocus = true }) {
  const [val, setVal] = useState(String(initial ?? ''));
  const committed = useRef(false);
  const ref = useRef(null);

  // 칼럼 수정모드에서 다른 행 값으로 바뀌어 재사용될 때 동기화
  useEffect(() => { setVal(String(initial ?? '')); committed.current = false; }, [initial]);

  /** 중복 커밋 방지 — Enter 후 blur 가 연달아 오면 두 번 저장된다 */
  const commit = (v, move) => {
    if (committed.current) return;
    committed.current = true;
    onCommit(v, move);
  };

  if (type === 'select') {
    return (
      <select autoFocus={autoFocus} value={val} ref={ref}
        onChange={e => { setVal(e.target.value); commit(e.target.value, null); }}
        onBlur={() => commit(val, null)}
        className="w-full bg-[#111] border border-blue-500 rounded text-xs text-white outline-none px-1 py-0.5"
      >
        {(opts || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input autoFocus={autoFocus} ref={ref} type={type === 'number' ? 'number' : 'text'}
      className="w-full bg-[#0b1220] text-white text-xs outline-none border border-blue-500 rounded px-1 py-0.5"
      value={val}
      onChange={e => {
        const raw = e.target.value;
        setVal(format ? format(raw) : raw);   // ← 부모 setState 없음(버벅거림 방지)
      }}
      onBlur={() => commit(val, null)}
      onKeyDown={e => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(val, e.shiftKey ? 'prev' : 'next'); }
        else if (e.key === 'Tab') { e.preventDefault(); commit(val, e.shiftKey ? 'prev' : 'next'); }
        else if (e.key === 'Escape') { committed.current = true; onCancel(); }
        else if (e.key === 'ArrowDown' && e.ctrlKey) { e.preventDefault(); commit(val, 'next'); }
        else if (e.key === 'ArrowUp' && e.ctrlKey)   { e.preventDefault(); commit(val, 'prev'); }
      }}
    />
  );
});

export default CellInput;

/** 칼럼 헤더의 ✏️ 수정모드 토글 버튼 */
export const ColEditToggle = memo(function ColEditToggle({ colKey, active, onToggle }) {
  return (
    <button
      type="button"
      title={active ? '수정모드 끄기' : '이 칼럼 전체를 수정모드로 (Enter로 다음 행)'}
      onClick={(e) => { e.stopPropagation(); onToggle(active ? null : colKey); }}
      className={`ml-1 px-1 rounded text-[10px] leading-none align-middle transition-colors ${
        active ? 'bg-blue-500 text-white' : 'text-gray-500 hover:text-blue-400 hover:bg-blue-500/10'
      }`}
    >
      ✏️
    </button>
  );
});
