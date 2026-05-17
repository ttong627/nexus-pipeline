import { useState } from 'react';
import { X, AlertTriangle, UserPlus, UserMinus, MapPin, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';

export default function PrevMonthCompareModal({ data, onClose }) {
  const [filterType, setFilterType] = useState('all'); // all | new | left | address
  const [expandedWarnings, setExpandedWarnings] = useState(true);

  if (!data) return null;
  const { warnings, changes, newCount, leftCount, addrChangeCount, prevMonthId } = data;

  const filtered = (() => {
    if (filterType === 'new') return changes.filter(c => c.type === 'new');
    if (filterType === 'address') return changes.filter(c => c.type === 'address');
    return changes;
  })();

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[500] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#05080f] border border-[#3b82f6]/20 rounded-3xl shadow-[0_0_60px_rgba(59,130,246,0.1)] flex flex-col max-h-[85vh] overflow-hidden">

        {/* 헤더 */}
        <div className="px-6 py-5 border-b border-[#0f1a2e] flex items-start justify-between shrink-0">
          <div>
            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-black border border-[#3b82f6]/30 bg-[#3b82f6]/10 text-[#3b82f6] mb-2">전월 비교</span>
            <h2 className="text-white text-lg font-black">전월 대비 변경 현황</h2>
            <p className="text-gray-500 text-xs mt-1">{prevMonthId} 월 데이터와 비교</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors p-1">
            <X size={20}/>
          </button>
        </div>

        {/* 요약 배지 */}
        <div className="px-6 py-4 shrink-0 border-b border-[#0f1a2e]">
          {warnings.length > 0 && (
            <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-3 mb-3">
              <button
                onClick={() => setExpandedWarnings(v => !v)}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-400"/>
                  <span className="text-amber-300 font-black text-sm">⚠️ 주소 대량 변경 감지 — {warnings.length}개 행정동</span>
                </div>
                {expandedWarnings ? <ChevronUp size={14} className="text-amber-400"/> : <ChevronDown size={14} className="text-amber-400"/>}
              </button>
              {expandedWarnings && (
                <div className="mt-2 space-y-1.5">
                  {warnings.map(w => (
                    <div key={w.dong} className="flex items-center justify-between text-xs bg-black/30 rounded-lg px-3 py-2">
                      <span className="text-amber-200 font-bold">{w.dong}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400">{w.total}명 중</span>
                        <span className="text-amber-400 font-black">{w.changed}건 변경 ({w.rate}%)</span>
                        {w.rate >= 40 && <span className="px-1.5 py-0.5 bg-red-900/40 border border-red-500/40 text-red-400 text-[9px] font-black rounded">주의</span>}
                      </div>
                    </div>
                  ))}
                  <p className="text-amber-600 text-[10px] mt-1.5 font-medium">
                    원본 엑셀 파일의 주소 데이터를 확인해주세요.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setFilterType(filterType === 'new' ? 'all' : 'new')}
              className={`rounded-xl p-3 text-center border transition-all ${filterType === 'new' ? 'bg-blue-900/40 border-blue-500/50' : 'bg-black/30 border-[#2a2a2a] hover:border-blue-500/30'}`}
            >
              <div className="text-lg font-black text-blue-400">{newCount.toLocaleString()}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 flex items-center justify-center gap-1"><UserPlus size={10}/> 신규</div>
            </button>
            <button
              onClick={() => setFilterType(filterType === 'left' ? 'all' : 'left')}
              className={`rounded-xl p-3 text-center border transition-all ${filterType === 'left' ? 'bg-red-900/40 border-red-500/50' : 'bg-black/30 border-[#2a2a2a] hover:border-red-500/30'}`}
            >
              <div className="text-lg font-black text-red-400">{leftCount.toLocaleString()}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 flex items-center justify-center gap-1"><UserMinus size={10}/> 탈퇴</div>
            </button>
            <button
              onClick={() => setFilterType(filterType === 'address' ? 'all' : 'address')}
              className={`rounded-xl p-3 text-center border transition-all ${filterType === 'address' ? 'bg-amber-900/40 border-amber-500/50' : 'bg-black/30 border-[#2a2a2a] hover:border-amber-500/30'}`}
            >
              <div className="text-lg font-black text-amber-400">{addrChangeCount.toLocaleString()}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 flex items-center justify-center gap-1"><MapPin size={10}/> 주소변경</div>
            </button>
          </div>
        </div>

        {/* 상세 목록 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#333] px-4 py-2">
          {filtered.length === 0 ? (
            <div className="text-center text-gray-600 text-sm py-8">해당 항목이 없습니다.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#05080f] z-10">
                <tr className="text-gray-500 border-b border-[#2a2a2a]">
                  <th className="py-2 text-left px-2 font-bold">유형</th>
                  <th className="py-2 text-left px-2 font-bold">이름</th>
                  <th className="py-2 text-left px-2 font-bold">행정동</th>
                  <th className="py-2 text-left px-2 font-bold">이전 주소 → 현재 주소</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((c, i) => (
                  <tr key={i} className="border-b border-[#1a1a1a] hover:bg-white/3">
                    <td className="py-2 px-2">
                      {c.type === 'new'
                        ? <span className="px-1.5 py-0.5 bg-blue-900/40 border border-blue-600/40 text-blue-400 rounded text-[9px] font-black">신규</span>
                        : <span className="px-1.5 py-0.5 bg-amber-900/40 border border-amber-600/40 text-amber-400 rounded text-[9px] font-black">주소변경</span>
                      }
                    </td>
                    <td className="py-2 px-2 font-bold text-white">{c.name}</td>
                    <td className="py-2 px-2 text-gray-400">{c.dong}</td>
                    <td className="py-2 px-2">
                      {c.type === 'new'
                        ? <span className="text-blue-400 font-mono">{c.curAddr.slice(0, 40)}</span>
                        : (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-gray-500 font-mono line-through">{c.prevAddr.slice(0, 25)}</span>
                            <ArrowRight size={10} className="text-amber-500 shrink-0"/>
                            <span className="text-amber-300 font-mono">{c.curAddr.slice(0, 25)}</span>
                          </div>
                        )
                      }
                    </td>
                  </tr>
                ))}
                {filtered.length > 200 && (
                  <tr><td colSpan={4} className="text-center text-gray-600 py-3 text-[10px]">... 총 {filtered.length}건 중 200건만 표시</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-[#0f1a2e] shrink-0 flex gap-3">
          {warnings.length > 0 && (
            <button
              onClick={() => {
                alert('원본 엑셀 파일을 확인하신 후 필요시 재업로드해주세요.');
              }}
              className="flex-1 py-2.5 bg-amber-900/40 border border-amber-500/40 text-amber-300 font-bold rounded-xl text-sm hover:bg-amber-800/40 transition-colors"
            >
              원본 확인 후 재업로드
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-[#3b82f6] text-black font-black rounded-xl text-sm hover:bg-[#93c5fd] transition-colors"
          >
            이대로 계속 진행
          </button>
        </div>
      </div>
    </div>
  );
}
