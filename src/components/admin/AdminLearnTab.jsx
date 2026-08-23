// 관리자 · 자가학습 검토 탭 — AdminPanel(2,546줄)에서 분리(2026-08-23 Phase 4-4).
//   이 탭은 다른 탭과 상태를 공유하지 않는다(전부 `learn*` 접두어) — 그래서 가장 먼저 뗄 수 있었다.
//   ⚠️상태·조회는 여전히 AdminPanel 이 들고 있다(승인 시 다른 탭의 목록도 갱신되므로). 여기는 **표시와 클릭 전달**만 한다.
import { RefreshCw, ShieldAlert, Sparkles, TrendingUp } from 'lucide-react';
import { TYPE_LABELS } from './learnLabels.js';

export default function AdminLearnTab({
  learnLoading, learnStats, learnSug, learnCand, LEARN_SUG_DEFS,
  fetchLearn, approveSug, rejectSug, dismissCand,
}) {
  return (
      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#2d4a35] p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-white font-black text-lg flex items-center gap-2"><Sparkles size={18}/> 자가학습 검토</h3>
            <p className="text-gray-500 text-xs mt-1">직원이 정제 중 만든 저위험 규칙을 승인 · 고위험 수정은 확인만(자동 반영 안 함)</p>
          </div>
          <button onClick={fetchLearn} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#111] text-gray-300 border border-[#333] hover:bg-[#222] flex items-center gap-1.5"><RefreshCw size={13}/> 새로고침</button>
        </div>

        {learnLoading && <div className="text-gray-500 text-sm">불러오는 중…</div>}

        {/* 학습 현황(측정) — 읽기전용 지표: 누적 규칙 · 캡처 분포 */}
        {learnStats && (
          <div className="rounded-xl border border-[#333] bg-[#0d0d0d] p-4 space-y-4">
            <h4 className="text-emerald-400 font-bold text-sm flex items-center gap-1.5"><TrendingUp size={15}/> 학습 현황</h4>
            <div>
              <div className="text-gray-500 text-[11px] mb-1.5">누적 학습 규칙 (현재 정제에 적용 중인 사전)</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {[...new Set(LEARN_SUG_DEFS.map(d => d.dict))].map(name => {
                  const label = LEARN_SUG_DEFS.find(d => d.dict === name)?.label || name;
                  const cnt = learnStats.dictCounts[name];
                  return (
                    <div key={name} className="rounded-lg bg-[#111] border border-[#2a2a2a] px-3 py-2">
                      <div className="text-gray-400 text-[10px] truncate" title={label}>{label}</div>
                      <div className="text-white font-black text-lg font-mono">{cnt == null ? '—' : cnt}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-[11px] mb-1.5">
                캡처 분포 (표본 <span className="font-mono">{learnStats.summary.total}</span>건{learnStats.sampled ? '+' : ''}) ·
                저위험 자동 <span className="text-emerald-400 font-mono">{learnStats.summary.autoCount}</span> ·
                고위험 검토 <span className="text-amber-400 font-mono">{learnStats.summary.reviewCount}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(learnStats.summary.byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                  <span key={t} className="px-2 py-1 rounded-md bg-[#111] border border-[#2a2a2a] text-[11px] text-gray-300">
                    {TYPE_LABELS[t] || t} <span className="font-mono text-cyan-400">{n}</span>
                  </span>
                ))}
                {learnStats.summary.total === 0 && <span className="text-gray-600 text-xs">아직 캡처된 학습이 없습니다.</span>}
              </div>
            </div>
          </div>
        )}

        {/* 승인 대기 제안 */}
        <div>
          <h4 className="text-cyan-400 font-bold text-sm mb-2">승인 대기 제안 <span className="font-mono">{learnSug.length}</span></h4>
          {learnSug.length === 0 && !learnLoading && <div className="text-gray-600 text-xs">대기 중인 제안이 없습니다.</div>}
          <div className="space-y-1.5">
            {learnSug.map(item => (
              <div key={`${item.__col}_${item.__id}`} className="flex items-center gap-3 bg-[#0a0a0a] border border-[#222] rounded-lg px-3 py-2">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1a2a3a] text-cyan-300 shrink-0">{item.label}</span>
                <span className="text-sm text-gray-300 flex-1 truncate">
                  {item.before ? <><span className="text-red-400 line-through">{item.before}</span> <span className="text-gray-600">→</span> </> : null}
                  <span className="text-emerald-400 font-bold">{item.after}</span>
                </span>
                <button onClick={() => approveSug(item)} className="px-2.5 py-1 rounded text-xs font-bold bg-emerald-600/20 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-600/30 shrink-0">승인</button>
                <button onClick={() => rejectSug(item)} className="px-2.5 py-1 rounded text-xs font-bold bg-[#111] text-gray-400 border border-[#333] hover:text-red-300 shrink-0">거부</button>
              </div>
            ))}
          </div>
        </div>

        {/* 고위험 후보(검토) */}
        <div>
          <h4 className="text-amber-400 font-bold text-sm mb-2 flex items-center gap-1.5"><ShieldAlert size={15}/> 고위험 수정(검토) <span className="font-mono">{learnCand.length}</span></h4>
          <p className="text-gray-600 text-[11px] mb-2">주소 본번·이름 변경은 동명이인·변조 위험이 있어 자동 반영하지 않습니다. 내용 확인용이며, 확인 후 목록에서 지웁니다.</p>
          {learnCand.length === 0 && !learnLoading && <div className="text-gray-600 text-xs">검토할 고위험 수정이 없습니다.</div>}
          <div className="space-y-1.5">
            {learnCand.map(c => (
              <div key={c.id} className="flex items-center gap-3 bg-[#0a0a0a] border border-amber-900/30 rounded-lg px-3 py-2">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-300 shrink-0">{c.field === 'name' ? '이름' : c.field === 'address' ? '주소' : c.field}</span>
                <span className="text-sm text-gray-300 flex-1 truncate">
                  <span className="text-red-400 line-through">{c.before}</span> <span className="text-gray-600">→</span> <span className="text-amber-300 font-bold">{c.after}</span>
                  {c.city && <span className="text-gray-600 text-[11px] ml-2">{c.city}</span>}
                </span>
                <button onClick={() => dismissCand(c.id)} className="px-2.5 py-1 rounded text-xs font-bold bg-[#111] text-gray-400 border border-[#333] hover:text-red-300 shrink-0">확인함</button>
              </div>
            ))}
          </div>
        </div>
      </div>
  );
}
