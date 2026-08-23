// 'audit' 탭 화면 — UtilsModal 에서 분리(2026-08-24 Phase 4-6).
//   UtilsModal 은 독립 도구들의 상자이고 탭끼리 상태를 공유하지 않는다(점검 실측) — 그래서 화면부터 뗀다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다(되돌리기 쉬움).
import { Clock, Send } from 'lucide-react';

export default function AuditTab({
  fetchLogs,
  handleSendNotification,
  loadingLogs,
  logs,
}) {
  return (
            <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center mb-1">
                <h3 className="text-lg font-bold text-white">클라우드 변경 이력</h3>
                <button onClick={fetchLogs} className="text-sm text-[#3b82f6] hover:underline font-bold">새로고침</button>
              </div>
              <p className="text-sm text-gray-400 mb-4">기준명단 갱신 및 주요 변경 이력이 기록됩니다.</p>
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {loadingLogs ? (
                  <div className="flex justify-center items-center h-24 text-gray-500 text-sm">로딩 중...</div>
                ) : logs.length === 0 ? (
                  <div className="flex justify-center items-center h-24 text-gray-600 text-sm border-2 border-dashed border-gray-800 rounded-xl">기록된 이력이 없습니다.</div>
                ) : logs.map(log => (
                  <div key={log.id} className="bg-black/40 border border-gray-800 rounded-xl p-4 hover:border-gray-600 transition-all">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black bg-blue-900/50 text-blue-400 border border-blue-700/50">
                          {log.type === 'BASE_UPDATE' ? '기준명단 갱신' : log.type}
                        </span>
                        <span className="text-sm font-bold text-white">{log.targetName}</span>
                        <span className="text-[10px] text-gray-500">{log.city}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-500 font-mono">
                        <Clock size={10} />
                        {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : '방금 전'}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 font-mono bg-[#0a0a0a] p-2 rounded-lg mb-3">
                      {Object.entries(log.updates || {}).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="text-gray-500 w-16">{k}:</span>
                          <span className="text-[#3b82f6]">{v}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-gray-800/50">
                      <span className="text-[10px] text-gray-600">수정자: {log.userEmail}</span>
                      <button onClick={() => handleSendNotification(log)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-[#3b82f6]/20 hover:text-[#3b82f6] hover:border-[#3b82f6]/50 border border-gray-700 text-gray-300 rounded-lg text-[10px] font-bold transition-all">
                        <Send size={12} /> 담당자 알림 전송
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
  );
}
