// 저장 내역 — 지도가 저장된 명단(route_sessions) 목록을 자기 소속 지자체 기준으로 보여준다.
// 항목 클릭 → 해당 지자체·월을 루트맵으로 열어 확인·편집(기존 루트맵 플로우 재사용).
import React, { useState, useEffect } from 'react';
import { db } from '../config/firebase.js';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { HardDrive, X, RefreshCw, Edit3, MapPin } from 'lucide-react';

export default function SavedRecordsModal({ user, onClose, onEdit }) {
  const isAdmin = user?.role === 'admin';
  const [sessions, setSessions] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        let cities = user?.citiesApproved || [];
        if (isAdmin) {
          try { const snap = await getDocsFromServer(collection(db, 'cloud_lists')); cities = snap.docs.map(d => d.id); } catch { /* ignore */ }
        }
        cities = [...new Set(cities)];
        const all = [];
        await Promise.all(cities.map(async city => {
          try {
            const snap = await getDocsFromServer(collection(db, 'route_sessions', city, 'months'));
            snap.docs.forEach(d => {
              const data = d.data();
              all.push({
                city, monthId: d.id,
                savedAt: data.savedAt?.toMillis?.() || 0,
                savedAtLabel: data.savedAt?.toDate?.()?.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) || '',
                driverCount: data.drivers?.length || 0,
                assignedCount: data.assignedCount || 0,
                totalRecords: data.totalRecords || 0,
                status: data.status || 'draft',
              });
            });
          } catch { /* 세션 없는 도시 무시 */ }
        }));
        all.sort((a, b) => b.savedAt - a.savedAt);
        setSessions(all);
      } catch { setSessions([]); }
      finally { setLoading(false); }
    })();
  }, [isAdmin, user?.citiesApproved]);

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[600] flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] bg-[#0a0a0a] border border-cyan-500/30 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <HardDrive size={16} className="text-cyan-400 shrink-0" />
            <div>
              <div className="text-sm font-black text-white">저장 내역</div>
              <div className="text-[10px] text-gray-500">지도에 저장된 배정 명단 — 클릭하면 루트맵으로 열어 확인·편집</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white rounded-lg transition-colors"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-[200px] p-3">
          {loading ? (
            <div className="flex items-center justify-center p-10 text-gray-500 text-sm"><RefreshCw size={16} className="animate-spin mr-2" /> 불러오는 중...</div>
          ) : !sessions || sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-gray-600 text-sm gap-2">
              <MapPin size={28} className="text-gray-700" />
              저장된 배정 명단이 없습니다.
              <span className="text-[11px] text-gray-700">루트맵에서 배정 후 저장하면 여기에 표시됩니다.</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {sessions.map((s) => (
                <button
                  key={`${s.city}_${s.monthId}`}
                  onClick={() => { onEdit?.(s.city, s.monthId); onClose(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 bg-[#0d0d0d] hover:bg-[#141414] border border-[#1e1e1e] hover:border-cyan-600/40 rounded-xl text-left transition-colors group"
                >
                  <div className="w-9 h-9 rounded-lg bg-cyan-950/40 border border-cyan-700/30 flex items-center justify-center shrink-0">
                    <MapPin size={15} className="text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-[13px] font-black truncate">{s.city}</span>
                      <span className="text-cyan-400 text-[11px] font-bold">{s.monthId}</span>
                      {s.status === 'final'
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/50 border border-emerald-700/40 text-emerald-400 font-black">최종</span>
                        : <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-700/40 text-amber-400 font-black">임시</span>}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      기사 {s.driverCount}명 · 배정 {s.assignedCount.toLocaleString()}/{s.totalRecords.toLocaleString()}건
                      {s.savedAtLabel && <span className="text-gray-600"> · {s.savedAtLabel}</span>}
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] text-gray-600 group-hover:text-cyan-400 shrink-0 font-bold">
                    <Edit3 size={12} /> 편집
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
