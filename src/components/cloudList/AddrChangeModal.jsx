// 주소변경 확인 모달(CL-5~CL-8) — CloudListManager(2,500줄)에서 분리(2026-08-23 Phase 4-3).
//   이 모달은 명단 데이터(`records`·`dirtyRecords`)를 직접 건드리지 않는다 — 변경 목록을 보여주고
//   되돌리기/재적용/유형변경을 **콜백으로 넘길 뿐**이다. 그래서 가장 먼저 뗄 수 있었다.
import { X, AlertTriangle, Building2, List } from 'lucide-react';

export default function AddrChangeModal({
  addrChanges, dongAddrWarnings, addrChangeTab, setAddrChangeTab, onClose,
  onRevertAll, onRevert, onReApply, onMarkType,
}) {
      const pendingCount  = addrChanges.filter(c => c.status === 'pending').length;
      const revertedCount = addrChanges.filter(c => c.status === 'reverted').length;
      const warnDongs = Object.entries(dongAddrWarnings).filter(([, c]) => c >= 10);

      // 행정동 요약 계산
      const dongStats = {};
      addrChanges.forEach(c => {
        const d = c.행정동 || '미분류';
        if (!dongStats[d]) dongStats[d] = { total: 0, 정제: 0, 이사: 0, 주민센터배송: 0, 오류: 0, reverted: 0 };
        dongStats[d].total++;
        if (c.status === 'reverted') dongStats[d].reverted++;
        else dongStats[d][c.changeType] = (dongStats[d][c.changeType] || 0) + 1;
      });

      return (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[150] p-4">
          <div className="bg-[#0e0e0e] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2 flex-wrap">
                <AlertTriangle size={15} className="text-amber-400 shrink-0" />
                <h2 className="text-sm font-black text-white">주소 변경 확인</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  전체 {addrChanges.length}건
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/15 text-green-400 border border-green-500/30">
                  적용 {pendingCount}건
                </span>
                {revertedCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-500/15 text-gray-400 border border-gray-500/30">
                    원복 {revertedCount}건
                  </span>
                )}
                {warnDongs.map(([dong, cnt]) => (
                  <span key={dong} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                    ⚠ {dong} 이상 {cnt}건
                  </span>
                ))}
              </div>
              <button onClick={() => onClose()} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-colors shrink-0">
                <X size={15} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-5 pt-2 border-b border-white/5">
              <button
                onClick={() => setAddrChangeTab('dong')}
                className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-t-lg transition-colors ${addrChangeTab === 'dong' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <Building2 size={11} /> 행정동 요약
              </button>
              <button
                onClick={() => setAddrChangeTab('list')}
                className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-t-lg transition-colors ${addrChangeTab === 'list' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <List size={11} /> 전체 목록 ({addrChanges.length})
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4">
              {addrChangeTab === 'dong' ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 text-[10px] font-bold uppercase tracking-wider border-b border-white/10">
                      <th className="text-left pb-2.5 font-bold">행정동</th>
                      <th className="text-center pb-2.5 font-bold">전체</th>
                      <th className="text-center pb-2.5 font-bold">정제</th>
                      <th className="text-center pb-2.5 font-bold">이사</th>
                      <th className="text-center pb-2.5 font-bold">주민센터</th>
                      <th className="text-center pb-2.5 font-bold">오류</th>
                      <th className="text-center pb-2.5 font-bold">원복</th>
                      <th className="text-left pb-2.5 font-bold">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(dongStats)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([dong, s]) => {
                        const warn = dongAddrWarnings[dong] >= 10;
                        return (
                          <tr key={dong} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${warn ? 'bg-red-950/10' : ''}`}>
                            <td className="py-2 font-bold text-white">
                              {warn && <span className="text-red-400 mr-1">⚠</span>}
                              {dong}
                            </td>
                            <td className="py-2 text-center text-gray-300 font-black">{s.total}</td>
                            <td className="py-2 text-center"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-400">{s.정제 || 0}</span></td>
                            <td className="py-2 text-center"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-400">{s.이사 || 0}</span></td>
                            <td className="py-2 text-center"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-400">{s.주민센터배송 || 0}</span></td>
                            <td className="py-2 text-center"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-400">{s.오류 || 0}</span></td>
                            <td className="py-2 text-center text-gray-600">{s.reverted || 0}</td>
                            <td className="py-2">
                              {warn
                                ? <span className="text-[10px] font-bold text-red-400">행정동 주소이상</span>
                                : <span className="text-[10px] text-gray-600">정상 범위</span>}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 text-[10px] border-b border-white/10">
                      <th className="text-left py-2 pr-3 font-bold">이름</th>
                      <th className="text-left py-2 pr-3 font-bold">행정동</th>
                      <th className="text-left py-2 pr-3 font-bold min-w-[160px]">기존 주소</th>
                      <th className="text-left py-2 pr-3 font-bold min-w-[160px]">정제 주소</th>
                      <th className="text-left py-2 pr-3 font-bold min-w-[140px]">저번달 주소</th>
                      <th className="text-center py-2 pr-3 font-bold">유형</th>
                      <th className="text-center py-2 font-bold">처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {addrChanges.map(c => (
                      <tr key={c.rowId} className={`border-b border-white/5 transition-colors hover:bg-white/3 ${c.status === 'reverted' ? 'opacity-40' : ''}`}>
                        <td className="py-1.5 pr-3 font-bold text-white whitespace-nowrap">{c.이름}</td>
                        <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap">{c.행정동}</td>
                        <td className="py-1.5 pr-3 text-gray-500 line-through max-w-[200px] truncate" title={c.oldAddr}>{c.oldAddr}</td>
                        <td className={`py-1.5 pr-3 max-w-[200px] truncate ${c.status === 'reverted' ? 'text-gray-600 line-through' : 'text-green-400 font-bold'}`} title={c.newAddr}>{c.newAddr}</td>
                        <td className="py-1.5 pr-3 text-blue-300 max-w-[180px] truncate" title={c.prevAddr || '-'}>{c.prevAddr || <span className="text-gray-600">-</span>}</td>
                        <td className="py-1.5 pr-3 text-center">
                          <select
                            value={c.changeType}
                            onChange={e => onMarkType(c.rowId, e.target.value)}
                            disabled={c.status === 'reverted'}
                            className="text-[10px] font-bold rounded px-1 py-0.5 bg-transparent border border-white/10 text-gray-300 cursor-pointer disabled:opacity-50"
                          >
                            <option value="정제">🔧 정제</option>
                            <option value="이사">🚚 이사</option>
                            <option value="주민센터배송">🏢 주민센터배송</option>
                            <option value="오류">⚠ 오류</option>
                          </select>
                        </td>
                        <td className="py-1.5 text-center">
                          {c.status === 'reverted' ? (
                            <button
                              onClick={() => onReApply(c)}
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-950/40 hover:bg-green-900/50 text-green-400 border border-green-500/20 transition-colors"
                            >재적용</button>
                          ) : (
                            <button
                              onClick={() => onRevert(c.rowId)}
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950/30 hover:bg-red-900/40 text-red-400 border border-red-500/20 transition-colors"
                            >원복</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
              <p className="text-[11px] text-gray-500">
                ※ 닫기 후 <span className="text-blue-400 font-bold">변경사항 저장</span> 버튼을 눌러야 Firestore에 반영됩니다.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={onRevertAll}
                  className="px-3 py-1.5 rounded-xl text-[11px] bg-red-950/30 hover:bg-red-900/40 text-red-400 border border-red-500/20 font-bold transition-colors"
                >
                  전체 원복
                </button>
                <button
                  onClick={() => onClose()}
                  className="px-4 py-1.5 rounded-xl text-[11px] bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        </div>
      );
}
