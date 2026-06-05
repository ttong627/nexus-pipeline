import { useState, useMemo } from 'react';
import { CheckCircle, AlertTriangle, Sparkles, X } from 'lucide-react';

// 워커 신뢰도 라벨 → mapDefs 필드 키
const FIELD_MAP = [
  { label: '이름', key: 'name' },
  { label: '주소', key: 'address' },
  { label: '행정동', key: 'admin' },
  { label: '휴대폰', key: 'contact1' },
  { label: '유선전화', key: 'contact2' },
  { label: '포수', key: 'qty' },
  { label: '생년월일', key: 'birth' },
  { label: '문자수신', key: 'sms' },
  { label: '구분', key: 'type' },
];
const LABEL_TO_KEY = Object.fromEntries(FIELD_MAP.map(f => [f.label, f.key]));
const sheetKeyOf = (s) => (s.fileSource ? `${s.fileSource}::${s.name}` : s.name);

// ── 쉬운 정제 확인 카드 ───────────────────────────────────────────────────────
// 자동 매칭된 칼럼은 그냥 보여주고, 애매(노랑)한 칼럼만 1클릭으로 확인/수정 후 [정제 시작].
export default function EasyCleanConfirm({ city, month, sheets = [], mapDefs = {}, onConfirm, onAdvanced, onCancel }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(mapDefs || {})));

  const totalCount = useMemo(
    () => sheets.reduce((a, s) => a + (s.bodyRows?.length || s.rowsCount || 0), 0),
    [sheets]
  );

  const setMap = (sk, fieldKey, header) => {
    setDraft(prev => ({ ...prev, [sk]: { ...(prev[sk] || {}), [fieldKey]: header } }));
  };

  const sampleOf = (s, header) => {
    if (!header) return '';
    const idx = s.headers.indexOf(header);
    if (idx < 0) return '';
    return (s.bodyRows || []).map(r => String(r?.[idx] ?? '').trim()).filter(Boolean).slice(0, 3).join(', ');
  };

  const yellowBySheet = sheets.map(s => {
    const sk = sheetKeyOf(s);
    const amb = (s.ambiguousKeys || [])
      .map(lab => (LABEL_TO_KEY[lab] ? { label: lab, key: LABEL_TO_KEY[lab] } : null))
      .filter(Boolean);
    return { s, sk, amb };
  });
  const totalYellow = yellowBySheet.reduce((a, x) => a + x.amb.length, 0);

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-[#0a0f0e] border border-emerald-500/30 rounded-3xl p-7 shadow-[0_0_70px_rgba(16,185,129,0.18)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black text-emerald-200 flex items-center gap-2">
            <Sparkles size={20} /> 쉬운 정제 — 확인만 하면 끝!
          </h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={20} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-5 text-sm">
          <span className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-200 font-black">{city || '지자체 미정'}</span>
          {month && <span className="px-3 py-1.5 rounded-lg bg-[#11201c] border border-[#1c3a32] text-gray-300 font-bold">{month}</span>}
          <span className="px-3 py-1.5 rounded-lg bg-[#11201c] border border-[#1c3a32] text-gray-300 font-bold">총 {totalCount.toLocaleString()}명</span>
          <span className="px-3 py-1.5 rounded-lg bg-[#11201c] border border-[#1c3a32] text-gray-300 font-bold">시트 {sheets.length}개</span>
        </div>

        <div className="mb-5 rounded-2xl bg-[#0d1513] border border-[#1a2a26] p-4">
          <div className="flex items-center gap-2 text-emerald-300 text-sm font-black mb-2">
            <CheckCircle size={16} /> 칼럼이 자동으로 매칭됐어요
          </div>
          <p className="text-gray-500 text-xs leading-relaxed">
            이름·주소·연락처·행정동 등을 데이터 형식으로 자동 인식했습니다.{' '}
            {totalYellow > 0 ? '아래 노란 항목만 한 번만 확인해 주세요.' : '확인할 애매한 항목이 없습니다. 바로 시작하세요!'}
          </p>
        </div>

        {totalYellow > 0 && (
          <div className="space-y-4 mb-5">
            {yellowBySheet.filter(x => x.amb.length).map(({ s, sk, amb }) => (
              <div key={sk} className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-4">
                <div className="text-amber-300 text-xs font-black mb-3 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {s.name} — 확인 필요 {amb.length}개
                </div>
                <div className="space-y-3">
                  {amb.map(({ label, key }) => (
                    <div key={key} className="flex flex-col gap-1.5">
                      <span className="text-gray-300 text-sm font-bold">{label} 칼럼이 맞나요?</span>
                      <select
                        value={draft[sk]?.[key] || ''}
                        onChange={e => setMap(sk, key, e.target.value)}
                        className="bg-[#0a0f0e] border border-[#2a3a36] rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-400 outline-none"
                      >
                        <option value="">(없음 / 사용 안 함)</option>
                        {s.headers.filter(h => h && !String(h).startsWith('col_')).map((h, i) => (
                          <option key={i} value={h}>{h}</option>
                        ))}
                      </select>
                      {draft[sk]?.[key] && (
                        <span className="text-[11px] text-gray-500">예시: {sampleOf(s, draft[sk][key]) || '(값 없음)'}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => onConfirm(draft)}
            className="flex-1 py-3.5 bg-emerald-400 text-black font-black rounded-xl hover:bg-emerald-300 transition-all shadow-[0_0_24px_rgba(52,211,153,0.3)] flex items-center justify-center gap-2"
          >
            <Sparkles size={16} /> 정제 시작
          </button>
          <button
            onClick={onAdvanced}
            className="px-4 py-3.5 bg-[#0d1513] text-gray-400 border border-[#1a2a26] font-bold rounded-xl hover:text-gray-200 hover:border-[#2b3b36] transition-all text-sm"
          >
            직접 매핑(고급)
          </button>
        </div>
      </div>
    </div>
  );
}
