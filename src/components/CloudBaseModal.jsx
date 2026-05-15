import { useState } from 'react';
import { db, collection, getDocs } from '../config/firebase.js';
import { Database, Download, X, AlertCircle } from 'lucide-react';
import { normalizeBirth } from '../utils/parsers.js';
import { REGIONS } from '../utils/regions.js';

export default function CloudBaseModal({ onClose, onImport, user }) {
  const [selectedSido, setSelectedSido] = useState('');
  const [selectedSigungu, setSelectedSigungu] = useState('');
  const selectedCity = selectedSido && selectedSigungu ? `${selectedSido} ${selectedSigungu}` : '';
  const [selectedMonth, setSelectedMonth] = useState('');
  const [loading, setLoading] = useState(false);

  const TIER_QUOTAS = { basic: 0, vip: 2, vvip: 10, sapphire: 999 };
  const maxCities = user?.role === 'admin' ? 999 : (TIER_QUOTAS[user?.tier || 'basic'] || 0);
  const canAccess = maxCities > 0;

  const handleFetch = async () => {
    if (!selectedCity) return alert('지자체를 선택해주세요.');
    if (!canAccess) return alert('클라우드 기본 명단은 VIP 이상 등급만 이용할 수 있습니다.');

    setLoading(true);
    try {
      const snap = await getDocs(collection(db, `base_lists/${selectedCity}/records`));
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (records.length === 0) {
        alert('해당 지자체에 등록된 기본 명단이 없습니다.');
        setLoading(false);
        return;
      }

      let filtered = records;
      if (selectedMonth) {
        filtered = records.filter(r => r.months && r.months.includes(selectedMonth));
        if (filtered.length === 0) {
          alert('해당 월에 해당하는 명단이 없습니다.');
          setLoading(false);
          return;
        }
      }

      const newBaseMapObj = {};
      filtered.forEach(r => {
        const birthKey = r.birthKey || normalizeBirth(r.birth || '');
        if (!birthKey || !r.name) return;
        newBaseMapObj[`${r.name}_${birthKey}`] = r;
      });

      onImport(newBaseMapObj, selectedCity, filtered.length);
    } catch (e) {
      console.error(e);
      alert('데이터를 불러오는데 실패했습니다: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-[#0a100c] border border-[#22c55e]/30 rounded-2xl w-full max-w-md shadow-[0_0_40px_rgba(34,197,94,0.15)] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="p-5 border-b border-[#1e2d22] flex justify-between items-center">
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            <Database size={18} className="text-[#22c55e]" /> 클라우드 기본명단 불러오기
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5">
          {!canAccess && (
            <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl flex items-start gap-2 text-amber-400 text-xs font-bold">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              이 기능은 VIP 이상 등급 전용입니다.
            </div>
          )}

          <div>
            <label className="text-xs font-black text-gray-400 mb-2 block tracking-wider">지자체 선택</label>
            <div className="flex flex-col gap-2">
              <select
                value={selectedSido}
                onChange={e => { setSelectedSido(e.target.value); setSelectedSigungu(''); }}
                disabled={!canAccess}
                className="w-full bg-black/60 border border-[#2d4a35] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#22c55e] transition-colors disabled:opacity-40"
              >
                <option value="">시/도 선택</option>
                {Object.keys(REGIONS).map(sido => (
                  <option key={sido} value={sido}>{sido}</option>
                ))}
              </select>
              <select
                value={selectedSigungu}
                onChange={e => setSelectedSigungu(e.target.value)}
                disabled={!selectedSido || !canAccess}
                className="w-full bg-black/60 border border-[#2d4a35] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#22c55e] transition-colors disabled:opacity-40"
              >
                <option value="">시/군/구 선택</option>
                {selectedSido && REGIONS[selectedSido].map(sigungu => (
                  <option key={sigungu} value={sigungu}>{sigungu}</option>
                ))}
              </select>
            </div>
            {selectedCity && (
              <p className="text-xs text-[#22c55e] mt-2 font-bold">✓ {selectedCity}</p>
            )}
          </div>

          <div>
            <label className="text-xs font-black text-gray-400 mb-2 block tracking-wider">적용할 월 <span className="text-gray-600 font-normal">(선택사항)</span></label>
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              disabled={!canAccess}
              className="w-full bg-black/60 border border-[#2d4a35] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#22c55e] transition-colors disabled:opacity-40"
            />
            <p className="text-[11px] text-gray-600 mt-1.5">월 미선택 시 전체 명단을 불러옵니다.</p>
          </div>
        </div>

        <div className="p-5 border-t border-[#1e2d22]">
          <button
            onClick={handleFetch}
            disabled={loading || !canAccess || !selectedCity}
            className="w-full py-3 bg-[#22c55e] text-black font-black rounded-xl flex items-center justify-center gap-2 hover:bg-[#1ea34d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? '불러오는 중...' : <><Download size={16} /> 명단 가져오기</>}
          </button>
        </div>
      </div>
    </div>
  );
}
