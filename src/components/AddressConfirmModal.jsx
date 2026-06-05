import { useState } from 'react';
import { X, MapPin, Phone, ChevronRight, CheckCircle } from 'lucide-react';

// ── 주소 확인 모달 (카드 1건씩) ───────────────────────────────────────────────
// 이번달 주소가 없거나 미매칭인 건을 담당자가 한 건씩 처리.
// [이 주소로 정제] = 담당자가 입력한 이번달 실제 주소로 재정제(통과 시 오류 해제)
// [전화확인] = 미해결로 남기되 "확인 대기"로 표시(완료 게이트에서 조용히 안 넘어감)
// 저번달/기본명단 주소로 자동 채우지 않는다 — 담당자 확정만.
export default function AddressConfirmModal({ rows = [], onConfirm, onPhoneCheck, onClose }) {
  // 열 때의 목록을 고정 — 처리 중 gridData가 바뀌어도 인덱스가 흔들리지 않게.
  const [snapshot] = useState(rows);
  const [idx, setIdx] = useState(0);
  const [value, setValue] = useState(snapshot[0]?.주소 || '');
  const [busy, setBusy] = useState(false);

  const total = snapshot.length;
  const row = snapshot[idx];
  if (!row) return null;

  const goNext = () => {
    const ni = idx + 1;
    if (ni >= total) { onClose(); return; }
    setIdx(ni);
    setValue(snapshot[ni]?.주소 || '');
  };

  const handleConfirm = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try { await onConfirm(row, value.trim()); } finally { setBusy(false); }
    goNext();
  };
  const handlePhone = () => { onPhoneCheck(row.id); goNext(); };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[500] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#0a0f0a] border border-amber-500/40 rounded-2xl p-6 shadow-[0_0_50px_rgba(245,158,11,0.18)]">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-amber-300 font-black text-base flex items-center gap-2"><MapPin size={18} /> 주소 확인</h3>
          <span className="text-xs text-gray-500 font-bold tabular-nums">{idx + 1} / {total}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={18} /></button>
        </div>

        <div className="bg-black/40 border border-[#2a2a2a] rounded-xl p-4 mb-4 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-black text-lg">{row.이름}</span>
            <span className="text-xs text-gray-500">{row.행정동}</span>
            {row.구분 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950/50 text-blue-300 border border-blue-700/40">{row.구분}</span>}
            {(row.휴대폰 || row.유선전화) && <span className="text-[11px] text-gray-500">{row.휴대폰 || row.유선전화}</span>}
          </div>
          <p className="text-xs text-gray-500">이번달 원본: <span className={(row.주소 || '').trim() ? 'text-gray-300' : 'text-red-400 font-bold'}>{(row.주소 || '').trim() || '(주소 없음)'}</span></p>
          {row._사유 && <p className="text-[11px] text-amber-400/80">사유: {row._사유}</p>}
        </div>

        <label className="block text-[11px] text-gray-500 font-bold mb-1">이번달 실제 주소 입력 (담당자 확인 후)</label>
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
          placeholder="도로명 또는 지번 주소를 입력하세요"
          className="w-full bg-[#0a1410] border-2 border-emerald-500/40 rounded-xl px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30 mb-4"
        />

        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={!value.trim() || busy}
            className="flex-[2] py-3 bg-emerald-500 text-black font-black rounded-xl hover:bg-emerald-400 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5 text-sm"
          >
            <CheckCircle size={15} /> {busy ? '정제 중...' : '이 주소로 정제'}
          </button>
          <button
            onClick={handlePhone}
            className="flex-1 py-3 bg-[#1a1305] border border-amber-600/40 text-amber-300 font-bold rounded-xl hover:bg-[#241a08] transition-colors flex items-center justify-center gap-1.5 text-sm"
          >
            <Phone size={14} /> 전화확인
          </button>
          <button
            onClick={goNext}
            className="flex-1 py-3 bg-[#111] border border-gray-700 text-gray-400 font-bold rounded-xl hover:bg-[#1a1a1a] transition-colors flex items-center justify-center gap-1 text-sm"
          >
            건너뛰기 <ChevronRight size={14} />
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-3 text-center">전화확인으로 표시한 건은 "확인 대기"로 남아 저장 전 다시 알려드립니다.</p>
      </div>
    </div>
  );
}
