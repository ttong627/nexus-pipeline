import { useMemo } from 'react';
import { X, User, MapPin, Printer } from 'lucide-react';

// 기사별 배송순번 목록 뷰 (③) — records를 기사명으로 그룹핑, 배송순번 오름차순 정렬해 표시.
//   명단(CloudListManager)·지도(RouteMapModal) 양쪽에서 재사용. records엔 한글 필드(기사·배송순번·이름·주소·휴대폰·포수) 가정.
export default function DriverSequenceView({ records = [], onClose, title = '기사별 배송순번' }) {
  const { groups, unassigned } = useMemo(() => {
    const map = new Map();
    const none = [];
    records.forEach(r => {
      const d = String(r.기사 || '').trim();
      if (!d || d.includes('/')) { none.push(r); return; } // 미배정·복수기사(/) 제외
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(r);
    });
    const seqNum = (r) => { const n = parseInt(r.배송순번, 10); return Number.isFinite(n) ? n : 99999; };
    for (const arr of map.values()) {
      arr.sort((a, b) => seqNum(a) - seqNum(b) || String(a.이름 || '').localeCompare(String(b.이름 || ''), 'ko'));
    }
    const g = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
    return { groups: g, unassigned: none };
  }, [records]);

  const total = records.length;
  const assigned = total - unassigned.length;

  const handlePrint = () => window.print();

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[660] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-800">{title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              기사 {groups.length}명 · 배정 {assigned}건{unassigned.length ? ` · 미배정 ${unassigned.length}건` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handlePrint} title="인쇄" className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-700"><Printer size={16} /></button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-700"><X size={18} /></button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {groups.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-10">배정된 기사가 없습니다.</p>
          )}
          {groups.map(([driver, list]) => (
            <div key={driver} className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50/60 border-b border-gray-100">
                <User size={15} className="text-blue-500" />
                <span className="font-bold text-gray-800 text-sm">{driver}</span>
                <span className="text-xs text-gray-500">{list.length}가구</span>
              </div>
              <ol className="divide-y divide-gray-50">
                {list.map((r, i) => (
                  <li key={r.id || i} className="flex items-start gap-3 px-4 py-2 text-sm">
                    <span className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-blue-500 text-white text-xs font-bold">
                      {r.배송순번 || (i + 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800">{r.이름 || '-'}</span>
                        {r.포수 != null && String(r.포수).trim() !== '' && <span className="text-[11px] text-gray-400">{r.포수}포</span>}
                        {r.휴대폰 && <span className="text-[11px] text-gray-400">{r.휴대폰}</span>}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <MapPin size={11} className="shrink-0" />
                        <span className="truncate">{r.주소 || ''}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}

          {unassigned.length > 0 && (
            <div className="border border-dashed border-gray-300 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 text-xs font-bold text-gray-500">미배정 {unassigned.length}건</div>
              <ol className="divide-y divide-gray-50 max-h-40 overflow-y-auto">
                {unassigned.slice(0, 200).map((r, i) => (
                  <li key={r.id || i} className="flex items-center gap-2 px-4 py-1.5 text-xs text-gray-500">
                    <span className="font-medium text-gray-700">{r.이름 || '-'}</span>
                    <span className="truncate">{r.주소 || ''}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
