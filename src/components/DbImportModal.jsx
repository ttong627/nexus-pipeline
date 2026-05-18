import { useState } from 'react';
import { db, collection, getDocs } from '../config/firebase.js';
import { Database, Download, X, CheckSquare, Square } from 'lucide-react';
import { normalizeBirth } from '../utils/parsers.js';
import { REGIONS, getSigunguOptions } from '../utils/regions.js';

const IMPORT_FIELDS = [
  { key: 'note',   label: '특이사항', desc: '수령자 메모·특이사항' },
  { key: 'seqNo',  label: '배송순번', desc: '기사 배송 순서' },
  { key: 'driver', label: '기사',     desc: '담당 배송 기사명' },
  { key: 'sms',    label: '문자수신', desc: '문자 수신 가능 여부' },
];

export default function DbImportModal({ onClose, onImport, defaultCity }) {
  const parsedParts = (defaultCity || '').trim().split(/\s+/);
  const initSido = parsedParts[0] || '';
  const initSigungu = parsedParts.slice(1).join(' ') || '';

  const [selectedSido, setSelectedSido] = useState(initSido);
  const [selectedSigungu, setSelectedSigungu] = useState(initSigungu);
  const selectedCity = selectedSido && selectedSigungu ? `${selectedSido} ${selectedSigungu}` : '';

  const [selectedMonth, setSelectedMonth] = useState('');
  const [checkedFields, setCheckedFields] = useState(new Set(['note', 'seqNo', 'driver']));
  const [loading, setLoading] = useState(false);
  const [fetchedCount, setFetchedCount] = useState(null);

  const toggleField = (key) => {
    setCheckedFields(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleFetch = async () => {
    if (!selectedCity) return alert('지자체를 선택해주세요.');
    if (checkedFields.size === 0) return alert('이식할 항목을 하나 이상 선택해주세요.');
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, `base_lists/${selectedCity}/records`));
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (records.length === 0) {
        alert('해당 지자체에 등록된 기본 명단이 없습니다.');
        return;
      }
      let filtered = records;
      if (selectedMonth) {
        filtered = records.filter(r => r.months && r.months.includes(selectedMonth));
        if (filtered.length === 0) {
          alert('해당 월에 해당하는 명단이 없습니다.');
          return;
        }
      }
      // 3순위 매칭 인덱스 구축 (D-1: 이름+생년월일 → 이름+휴대폰 → 이름+유선전화)
      const baseMapObj = {};
      const dk = v => String(v || '').replace(/[^\d]/g, '');
      filtered.forEach(r => {
        const nm = (r.name || r.이름 || '').trim();
        if (!nm) return;
        const bk = r.birthKey || normalizeBirth(r.birth || r.생년월일 || '');
        const ph = dk(r.mobile || r.휴대폰 || '');
        const ld = dk(r.landline || r.유선전화 || '');
        if (bk) {
          baseMapObj[`${nm}_${bk}`] = r;            // 1순위
        } else if (ph.length >= 9) {
          baseMapObj[`ph_${nm}_${ph}`] = r;         // 2순위 (생년월일 없을 때)
        } else if (ld.length >= 9) {
          baseMapObj[`ld_${nm}_${ld}`] = r;         // 3순위 (생년월일·휴대폰 모두 없을 때)
        }
      });
      setFetchedCount(filtered.length);
      onImport(baseMapObj, [...checkedFields], selectedCity, filtered.length);
    } catch (e) {
      console.error(e);
      alert('불러오기 실패: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[200] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-[#0a100c] border border-[#3b82f6]/30 rounded-2xl w-full max-w-md shadow-[0_0_40px_rgba(59,130,246,0.15)] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="p-5 border-b border-[#0f1a2e] flex justify-between items-center">
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            <Database size={18} className="text-[#3b82f6]" /> 기본명단 DB에서 이식하기
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <p className="text-sm text-gray-400 leading-relaxed">
            저장된 기본 명단에서 필요한 데이터를 받아와서 명단에 적용합니다.<br/>
            <span className="text-gray-600 text-xs">이름+생년월일 → 이름+휴대폰 → 이름+유선 순으로 자동 매칭됩니다.</span>
          </p>

          {/* 이식할 항목 체크 */}
          <div>
            <label className="text-xs font-black text-gray-400 mb-2 block tracking-wider">이식할 항목 선택</label>
            <div className="grid grid-cols-2 gap-2">
              {IMPORT_FIELDS.map(f => {
                const checked = checkedFields.has(f.key);
                return (
                  <button key={f.key} type="button" onClick={() => toggleField(f.key)}
                    className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${checked ? 'bg-[#3b82f6]/15 border-[#3b82f6]/50 text-[#3b82f6]' : 'bg-black/30 border-gray-800 text-gray-500 hover:border-gray-600'}`}>
                    {checked ? <CheckSquare size={14} className="shrink-0" /> : <Square size={14} className="shrink-0" />}
                    <div>
                      <div className="text-xs font-black">{f.label}</div>
                      <div className="text-[10px] opacity-60 leading-tight">{f.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 지자체 선택 */}
          <div>
            <label className="text-xs font-black text-gray-400 mb-2 block tracking-wider">지자체 선택</label>
            <div className="flex flex-col gap-2">
              <select value={selectedSido} onChange={e => { setSelectedSido(e.target.value); setSelectedSigungu(''); }}
                className="w-full bg-black/60 border border-[#2d4a35] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#3b82f6] transition-colors">
                <option value="">시/도 선택</option>
                {Object.keys(REGIONS).map(sido => <option key={sido} value={sido}>{sido}</option>)}
              </select>
              <select value={selectedSigungu} onChange={e => setSelectedSigungu(e.target.value)} disabled={!selectedSido}
                className="w-full bg-black/60 border border-[#2d4a35] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#3b82f6] transition-colors disabled:opacity-40">
                <option value="">시/군/구 선택</option>
                {getSigunguOptions(selectedSido).map(sg => <option key={sg} value={sg}>{sg}</option>)}
              </select>
            </div>
            {selectedCity && <p className="text-xs text-[#3b82f6] mt-1.5 font-bold">✓ {selectedCity}</p>}
          </div>

          {/* 월 선택 */}
          <div>
            <label className="text-xs font-black text-gray-400 mb-2 block tracking-wider">
              적용할 월 <span className="text-gray-600 font-normal">(선택사항)</span>
            </label>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="w-full bg-black/60 border border-[#2d4a35] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#3b82f6] transition-colors" />
            <p className="text-[11px] text-gray-600 mt-1.5">월 미선택 시 전체 명단을 불러옵니다.</p>
          </div>

          {fetchedCount !== null && (
            <div className="p-3 bg-[#3b82f6]/10 border border-[#3b82f6]/30 rounded-xl text-[#3b82f6] text-sm font-bold text-center">
              ✓ {fetchedCount.toLocaleString()}건 이식 준비 완료<br/>
              <span className="text-[11px] font-normal opacity-80">정제 시작 시 자동 적용됩니다</span>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-[#0f1a2e]">
          <button onClick={handleFetch} disabled={loading || !selectedCity || checkedFields.size === 0}
            className="w-full py-3 bg-[#3b82f6] text-black font-black rounded-xl flex items-center justify-center gap-2 hover:bg-[#1ea34d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? '불러오는 중...' : <><Download size={16} /> 명단 가져오기</>}
          </button>
        </div>
      </div>
    </div>
  );
}
