import React, { useState } from 'react';
import { db, collection, getDocs, query, where } from '../config/firebase.js';
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
  const maxCities = TIER_QUOTAS[user?.tier || 'basic'] || 0;

  const handleFetch = async () => {
    if (!selectedCity) return alert('지자체를 입력해주세요.');
    if (maxCities === 0 && user?.role !== 'admin') {
      return alert('클라우드 기본 명단은 VIP 이상 등급만 이용할 수 있습니다.');
    }

    setLoading(true);
    try {
      // records 컬렉션 가져오기
      const snap = await getDocs(collection(db, `base_lists/${selectedCity}/records`));
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      if (records.length === 0) {
        alert('해당 지자체에 등록된 기본 명단이 없습니다.');
        setLoading(false);
        return;
      }

      // 월별 필터링
      let filtered = records;
      if (selectedMonth) {
        filtered = records.filter(r => r.months && r.months.includes(selectedMonth));
        if (filtered.length === 0) {
          alert('해당 월에 해당하는 명단이 없습니다.');
          setLoading(false);
          return;
        }
      }

      // 변환: baseMap 형태로. baseMap은 Key(name_birth) -> data
      const newBaseMapObj = {};
      filtered.forEach(r => {
        const birthKey = r.birthKey || normalizeBirth(r.birth || '');
        if (!birthKey || !r.name) return;
        
        const key = `${r.name}_${birthKey}`;
        newBaseMapObj[key] = r;
      });

      onImport(newBaseMapObj, selectedCity, filtered.length);
      onClose();

    } catch (e) {
      console.error(e);
      alert('데이터를 불러오는데 실패했습니다: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-[#111] border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
        <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Database className="text-[#22c55e]" /> 클라우드 명단 불러오기
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 space-y-5">
          {maxCities === 0 && user?.role !== 'admin' && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/50 rounded-lg flex items-start gap-2 text-amber-500 text-sm">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p>이 기능은 VIP 이상 등급 전용입니다. 이용하시려면 등급을 업그레이드 해주세요.</p>
            </div>
          )}

          <div>
            <label className="text-sm text-gray-400 font-bold mb-1 block">지자체 입력</label>
            <div className="flex flex-col gap-2">
              <select 
                value={selectedSido} 
                onChange={e => { setSelectedSido(e.target.value); setSelectedSigungu(''); }}
                disabled={maxCities === 0 && user?.role !== 'admin'}
                className="w-full bg-black border border-gray-700 rounded-xl px-4 py-3 text-white outline-none focus:border-[#22c55e]"
              >
                <option value="">시/도 선택</option>
                {Object.keys(REGIONS).map(sido => (
                  <option key={sido} value={sido}>{sido}</option>
                ))}
              </select>
              <select 
                value={selectedSigungu} 
                onChange={e => setSelectedSigungu(e.target.value)}
                disabled={!selectedSido || (maxCities === 0 && user?.role !== 'admin')}
                className="w-full bg-black border border-gray-700 rounded-xl px-4 py-3 text-white outline-none focus:border-[#22c55e] disabled:opacity-50"
              >
                <option value="">시/군/구 선택</option>
                {selectedSido && REGIONS[selectedSido].map(sigungu => (
                  <option key={sigungu} value={sigungu}>{sigungu}</option>
                ))}
              </select>
            </div>
            {selectedCity && (
              <p className="text-xs text-[#22c55e] mt-2 font-bold">선택됨: {selectedCity}</p>
            )}
          </div>

          <div>
            <label className="text-sm text-gray-400 font-bold mb-1 block">적용할 월 (선택사항)</label>
            <input 
              type="month" 
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="w-full bg-black border border-gray-700 rounded-xl px-4 py-3 text-white outline-none focus:border-[#22c55e]"
              disabled={maxCities === 0 && user?.role !== 'admin'}
            />
            <p className="text-xs text-gray-500 mt-1">월을 선택하지 않으면 해당 지자체의 모든 명단을 가져옵니다.</p>
          </div>
        </div>

        <div className="p-5 border-t border-gray-800 bg-gray-900/50">
          <button 
            onClick={handleFetch}
            disabled={loading || (maxCities === 0 && user?.role !== 'admin')}
            className={`w-full py-3 bg-[#22c55e] text-black font-black text-lg rounded-xl flex items-center justify-center gap-2 hover:bg-[#1ea34d] transition-colors ${(loading || (maxCities === 0 && user?.role !== 'admin')) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {loading ? '데이터 로딩 중...' : <><Download size={20} /> 명단 가져오기</>}
          </button>
        </div>
      </div>
    </div>
  );
}
