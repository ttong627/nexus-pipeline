import { useState, useRef, useEffect } from 'react';
import { Columns, ChevronLeft, Database, CheckCircle, Loader2, X } from 'lucide-react';

const REQUIRED_KEYS = ['name', 'contact1', 'address', 'qty', 'admin'];
const FIELD_META = {
  name:     { label: '성명',       short: '[성명]',   color: 'text-blue-300',   bg: 'bg-blue-950/40',   border: 'border-blue-700/50' },
  contact1: { label: '연락처',     short: '[연락처]', color: 'text-blue-300',  bg: 'bg-blue-950/40',  border: 'border-blue-700/50' },
  address:  { label: '주소',       short: '[주소]',   color: 'text-yellow-300', bg: 'bg-yellow-950/30', border: 'border-yellow-700/50' },
  qty:      { label: '포수',       short: '[포수]',   color: 'text-orange-300', bg: 'bg-orange-950/40', border: 'border-orange-700/50' },
  admin:    { label: '행정동',     short: '[행정동]', color: 'text-purple-300', bg: 'bg-purple-950/40', border: 'border-purple-700/50' },
  contact2: { label: '보조연락처', short: '[보조]',   color: 'text-teal-300',   bg: 'bg-teal-950/30',   border: 'border-teal-700/50' },
  birth:    { label: '생년월일',   short: '[생년]',   color: 'text-pink-300',   bg: 'bg-pink-950/30',   border: 'border-pink-700/50' },
  note:     { label: '특이사항',   short: '[특이]',   color: 'text-gray-300',   bg: 'bg-gray-800/40',   border: 'border-gray-600/50' },
  sms:      { label: '문자수신',   short: '[문자]',   color: 'text-cyan-300',   bg: 'bg-cyan-950/30',   border: 'border-cyan-700/50' },
  type:     { label: '수급구분',   short: '[구분]',   color: 'text-amber-300',  bg: 'bg-amber-950/30',  border: 'border-amber-700/50' },
  driver:   { label: '기사',       short: '[기사]',   color: 'text-lime-300',   bg: 'bg-lime-950/30',   border: 'border-lime-700/50' },
  seqNo:    { label: '배송순번',   short: '[순번]',   color: 'text-rose-300',   bg: 'bg-rose-950/30',   border: 'border-rose-700/50' },
};
const OPTIONAL_KWS = {
  type:     ['구분', '유형', '계층', '자격', '수급'],
  contact2: ['유선', '자택전화', '전화', '추가연락', '보조연락'],
  birth:    ['생년', '생월', '주민'],
  note:     ['특이', '비고', '메모', '참고'],
  sms:      ['문자', '수신', 'SMS', '수신여부', '수신동의'],
  driver:   ['기사', '배송기사', '담당'],
  seqNo:    ['순번', '배송순번'],
};

function SheetMappingPanel({ sheet, mapDef, setMapDef, worksheets, importNote, setImportNote, onUserMapping }) {
  // ✅ 방어: headers/bodyRows 없을 경우 빈 배열로 폴백 (forEach crash 원천 차단)
  const headers = Array.isArray(sheet?.headers) ? sheet.headers.filter(h => !/^col_\d+$/.test(h)) : [];
  const bodyRows = Array.isArray(sheet?.bodyRows) ? sheet.bodyRows : [];

  const previewData = bodyRows.slice(0, 20).map(row => {
    const obj = {};
    headers.forEach((h, j) => { obj[h] = row[j]; });
    return obj;
  });

  const hasMixedSheet = (worksheets || []).some(s => s.selected && s.type === '혼합');
  const isMixedWithoutType = sheet.type === '혼합' && !mapDef.type && !(sheet.typeColIdx >= 0);
  const hasColumn = (key) => !!mapDef[key] || headers.some(h => (OPTIONAL_KWS[key] || []).some(k => h.includes(k)));
  const colToField = Object.fromEntries(
    Object.entries(mapDef).filter(([, v]) => v).map(([k, v]) => [v, k])
  );

  const updateMap = (key, val) => {
    setMapDef({ ...mapDef, [key]: val });
    if (val) onUserMapping?.(val, key);
  };

  // ✅ 방어: 헤더가 아예 없으면 매핑 불가 안내 표시
  if (headers.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm font-bold">
        이 시트에서 컬럼 헤더를 읽을 수 없습니다. 시트를 다시 선택해주세요.
      </div>
    );
  }


  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 좌측 매핑 패널 */}
      <div className="w-72 bg-black/40 border-r border-white/10 overflow-y-auto shrink-0 scrollbar-thin scrollbar-thumb-[#444]">
        <div className="p-4">
          <p className="text-[10px] text-gray-600 font-black tracking-widest mb-4">━━ 필수 항목 (미설정시 진행 불가)</p>
          {[
            { key: 'name',     label: '성명 (이름)' },
            { key: 'contact1', label: '연락처 (휴대폰)' },
            { key: 'address',  label: '주소' },
            { key: 'qty',      label: '수량 (포수)' },
            { key: 'admin',    label: '행정구역 (읍면동)' },
          ].map(({ key, label }) => {
            const meta = FIELD_META[key];
            const isMapped = !!mapDef[key];
            return (
              <div key={key} className={`mb-3 p-3 rounded-xl border transition-all ${isMapped ? `${meta.bg} ${meta.border}` : 'bg-red-950/20 border-red-800/40'}`}>
                <div className="flex items-center justify-between mb-2">
                  <label className={`text-xs font-black ${isMapped ? meta.color : 'text-red-400'}`}>{label}</label>
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${isMapped ? 'bg-blue-900/50 text-blue-400' : 'bg-red-900/50 text-red-400'}`}>{isMapped ? '✓ 연결됨' : '✕ 누락'}</span>
                </div>
                <select value={mapDef[key]} onChange={e => updateMap(key, e.target.value)} className="w-full bg-black/60 border border-white/10 text-white font-bold p-2 rounded-lg outline-none text-xs cursor-pointer focus:border-emerald-500">
                  <option value="">-- 컬럼 선택 --</option>
                  {headers.map(h => {
                    const sv = previewData.map(r => String(r[h] ?? '').trim()).find(Boolean) || '';
                    return <option key={h} value={h}>{h}{sv ? ` → ${sv.slice(0, 16)}` : ''}</option>;
                  })}
                </select>
              </div>
            );
          })}

          {isMixedWithoutType && (
            <div className="mb-3 p-3 rounded-xl border border-red-600/70 bg-red-950/30 text-red-300 text-[11px] font-bold flex items-start gap-2">
              <span className="text-red-400 shrink-0 mt-0.5">✕</span>
              <span>이 시트는 <b>혼합 명단</b>입니다.<br/>아래 <b>수급구분 열</b>을 반드시 매핑해야 진행할 수 있습니다.</span>
            </div>
          )}

          {/* 비고 자동포함 토글 */}
          <div className="mt-5 mb-3 p-3 rounded-xl border border-white/10 bg-black/30">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={importNote} onChange={e => setImportNote(e.target.checked)} className="accent-emerald-500 w-4 h-4 cursor-pointer" />
              <span className={`text-xs font-black ${importNote ? 'text-emerald-500' : 'text-gray-500'}`}>비고 → 특이사항 자동 포함</span>
            </label>
            <p className={`text-[10px] mt-1 ml-6 ${importNote ? 'text-gray-500' : 'text-gray-700'}`}>
              {importNote ? '비고 열 내용이 특이사항에 자동으로 포함됩니다.' : '비고 열을 가져오지 않습니다.'}
            </p>
          </div>

          <p className="text-[10px] text-gray-600 font-black tracking-widest mb-3">━━ 보조 항목 (데이터 있는 항목만 표시)</p>
          {[
            { key: 'type',     label: '수급구분 열 (혼합명단 필수)' },
            { key: 'contact2', label: '보조 연락처 (유선)' },
            { key: 'itemName', label: '품명' },
            { key: 'birth',    label: '생년월일' },
            { key: 'note',     label: '특이사항' },
            { key: 'sms',      label: '문자수신 여부' },
            { key: 'driver',   label: '기사 (담당 배송기사)' },
            { key: 'seqNo',    label: '배송순번 (기존 값)' },
          ].filter(({ key }) => hasColumn(key) || key === 'driver' || key === 'seqNo' || key === 'itemName' || key === 'type').map(({ key, label }) => {
            const meta = FIELD_META[key];
            const isMapped = !!mapDef[key];
            return (
              <div key={key} className={`mb-3 p-2.5 rounded-xl border transition-all ${isMapped ? `${meta.bg} ${meta.border}` : 'bg-black/30 border-white/5'}`}>
                <label className={`block text-[11px] font-bold mb-1.5 ${isMapped ? meta.color : 'text-gray-500'}`}>{label}</label>
                <select value={mapDef[key]} onChange={e => updateMap(key, e.target.value)} className="w-full bg-black/60 border border-white/10 text-gray-300 p-2 rounded-lg outline-none text-xs cursor-pointer focus:border-emerald-500">
                  <option value="">-- 사용 안함 --</option>
                  {headers.map(h => {
                    const sv = previewData.map(r => String(r[h] ?? '').trim()).find(Boolean) || '';
                    return <option key={h} value={h}>{h}{sv ? ` → ${sv.slice(0, 16)}` : ''}</option>;
                  })}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* 우측 컬럼 카드 패널 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#030303] p-5 scrollbar-thin scrollbar-thumb-[#444]">
        <p className="text-[10px] text-gray-600 font-black tracking-widest mb-4 pb-2 border-b border-[#1a1a1a]">
          컬럼 식별 카드 — 카드를 보고 좌측에서 올바른 표준 필드로 연결하세요
        </p>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))' }}>
          {headers.map(h => {
            const fieldKey = colToField[h];
            const meta = fieldKey ? FIELD_META[fieldKey] : null;
            const samples = previewData.map(r => String(r[h] ?? '').trim()).filter(Boolean).slice(0, 6);
            const hasEmpty = meta && previewData.some(r => !String(r[h] ?? '').trim());
            return (
              <div key={h} className={`rounded-xl border p-3 flex flex-col gap-2 transition-all ${meta ? `${meta.bg} ${meta.border} shadow-[0_0_12px_rgba(0,0,0,0.5)]` : 'bg-[#111] border-[#2a2a2a] hover:border-[#444]'}`}>
                <div className={`text-[11px] font-black leading-tight break-words min-h-[28px] ${meta ? meta.color : 'text-gray-300'}`} title={h}>{h}</div>
                <div className={`text-[9px] font-black px-1.5 py-0.5 rounded-md w-fit border ${meta ? `${meta.bg} ${meta.color} ${meta.border}` : 'bg-black/50 text-gray-600 border-[#2a2a2a]'}`}>
                  {meta ? `${meta.short} ✓` : '미매핑'}
                </div>
                <div className="flex flex-col gap-1 mt-0.5 min-h-[72px]">
                  {samples.length > 0 ? (
                    <>
                      {samples.map((s, i) => (
                        <div key={i} className={`text-[10px] font-mono truncate px-2 py-0.5 rounded ${meta ? `bg-black/40 ${meta.color} opacity-90` : 'bg-black/40 text-gray-400'}`} title={s}>{s}</div>
                      ))}
                      {hasEmpty && <div className="text-[9px] text-red-400 font-bold px-1 mt-0.5">⚠ 빈 값 있음</div>}
                    </>
                  ) : (
                    <div className="text-[10px] text-gray-700 italic px-1">데이터 없음</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {headers.length === 0 && (
          <div className="text-gray-600 text-sm font-bold text-center mt-20">컬럼 정보가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

const sheetKey = (sheet) => sheet.fileSource ? `${sheet.fileSource}::${sheet.name}` : sheet.name;

const COL_MAP_KEY = (city) => `nexus_col_map_v1_${city}`;

export default function Step3_Mapping({ step, setStep, mapDefs, setMapDefs, selectedSheets, worksheets, startProcessing, onHelp, importNote, setImportNote, baseFiles, baseCount, isBaseUploading, handleBaseUpload, handleRemoveBaseFile, handleAddTargetFile, handleRemoveTargetFile, isUploading, uploadFileName, isBasePurifyMode, setIsBasePurifyMode, onOpenDbImport, dbImportReady, onUserMapping, city }) {
  const [activeTab, setActiveTab] = useState(0);
  const addTargetRef = useRef(null);
  const addBaseRef = useRef(null);
  const skipFirstSaveRef = useRef(true); // 마운트 직후 자동매핑값이 저장값을 덮어쓰는 것 방지

  // 지자체별 저장된 칼럼 매핑 자동 불러오기 (마운트 시 1회)
  useEffect(() => {
    if (!city || !selectedSheets?.length) return;
    try {
      const saved = localStorage.getItem(COL_MAP_KEY(city));
      if (!saved) return;
      const savedMap = JSON.parse(saved); // { fieldKey: headerName }
      setMapDefs(prev => {
        const next = { ...prev };
        for (const sheet of selectedSheets) {
          const key = sheetKey(sheet);
          const current = prev[key] || {};
          const headers = Array.isArray(sheet.headers) ? sheet.headers : [];
          const merged = { ...current };
          for (const [fieldKey, headerName] of Object.entries(savedMap)) {
            // 저장된 헤더가 이 시트에 존재하면 자동 적용(저장값 우선).
            // 자동매핑이 다르게 잡아도 사용자가 저장해 둔 매핑이 이김 → 같은 지자체
            // 재업로드 시 재수정 불필요. (CLAUDE.md CM-1~CM-4)
            if (headerName && headers.includes(headerName)) {
              merged[fieldKey] = headerName;
            }
          }
          next[key] = merged;
        }
        return next;
      });
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  // mapDefs 변경 시 지자체별 자동 저장
  useEffect(() => {
    // 마운트 첫 실행은 스킵 — 저장값 로드(override)가 반영되기 전 자동매핑값으로
    // 덮어쓰는 것을 방지. 이후 사용자 편집·로드 반영 시점부터 저장.
    if (skipFirstSaveRef.current) { skipFirstSaveRef.current = false; return; }
    if (!city || !Object.keys(mapDefs).length) return;
    const combined = {};
    for (const sheetMap of Object.values(mapDefs)) {
      for (const [fieldKey, headerName] of Object.entries(sheetMap)) {
        if (headerName) combined[fieldKey] = headerName;
      }
    }
    if (Object.keys(combined).length) {
      try {
        localStorage.setItem(COL_MAP_KEY(city), JSON.stringify(combined));
      } catch { /* ignore */ }
    }
  }, [mapDefs, city]);

  if (step !== 3) return null;
  if (!selectedSheets || selectedSheets.length === 0) return null;

  const safeTab = Math.min(activeTab, selectedSheets.length - 1);
  const activeSheet = selectedSheets[safeTab];
  const currentMap = mapDefs[sheetKey(activeSheet)] || {};

  const setCurrentMap = (newMap) =>
    setMapDefs(prev => ({ ...prev, [sheetKey(activeSheet)]: newMap }));

  const isSheetComplete = (sheet) => {
    const m = mapDefs[sheetKey(sheet)] || {};
    if (isBasePurifyMode) return !!m['address'];
    if (!REQUIRED_KEYS.every(k => !!m[k])) return false;
    // 혼합 시트: 수급구분 열 미매핑 + 자동감지 컬럼도 없으면 진행 불가
    if (sheet.type === '혼합' && !m['type'] && !(sheet.typeColIdx >= 0)) return false;
    return true;
  };

  const allComplete = selectedSheets.every(isSheetComplete);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gradient-to-b from-[#1a1710] to-[#0a0a0a] px-6 py-4 border-b border-[#333] flex justify-between items-center shrink-0 shadow-lg">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-3 drop-shadow-md">
            <Columns size={24} className="text-emerald-500"/> 3단계: AI 헤더 매핑
          </h2>
          <p className="text-gray-400 mt-1.5 font-medium">자동 매핑을 확인하고 누락된 항목을 지정하세요.</p>
        </div>
        <div className="flex gap-4 items-center">
          {/* 기본명단 주소 정제 모드 토글 */}
          <label className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 cursor-pointer transition-all select-none ${
            isBasePurifyMode
              ? 'bg-amber-950/60 border-amber-500 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
              : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
          }`}>
            <input
              type="checkbox"
              checked={!!isBasePurifyMode}
              onChange={e => setIsBasePurifyMode && setIsBasePurifyMode(e.target.checked)}
              className="accent-amber-400 w-4 h-4"
            />
            <span className="text-[12px] font-black tracking-wide">기본명단 주소 정제 작업</span>
            {isBasePurifyMode && <span className="text-[10px] bg-amber-500/20 px-1.5 py-0.5 rounded">필수조건 주소만</span>}
          </label>
          <button onClick={() => setStep(2)} className="px-6 py-3 bg-gray-800 border border-gray-600 text-white font-extrabold rounded-xl hover:bg-gray-700 transition-all shadow-md flex items-center gap-2">
            <ChevronLeft size={18} strokeWidth={3}/> 시트 선택으로
          </button>
          <button
            onClick={startProcessing}
            disabled={!allComplete}
            className={`px-8 py-3 font-extrabold rounded-xl flex items-center gap-2 uppercase tracking-wide transition-all ${allComplete ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:bg-emerald-400 hover:scale-105' : 'bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed'}`}
          >
            {isBasePurifyMode ? '주소 정제 가동' : '12단계 정제 가동'} <Database size={18} strokeWidth={3}/>
          </button>
          <button
            onClick={onHelp}
            className="w-10 h-10 rounded-full bg-emerald-950/30 border border-emerald-500/40 text-emerald-400 font-black text-base hover:bg-emerald-500/20 hover:scale-110 transition-all shrink-0"
            title="3단계 도움말"
          >?</button>
        </div>
      </div>

      {/* 시트 탭 (선택된 시트 2개 이상일 때) */}
      {selectedSheets.length > 1 && (
        <div className="flex items-center gap-1 px-4 pt-3 pb-0 bg-black/60 border-b border-[#333] shrink-0 overflow-x-auto scrollbar-thin scrollbar-thumb-[#444]">
          {selectedSheets.map((sheet, i) => {
            const done = isSheetComplete(sheet);
            const isActive = i === safeTab;
            return (
              <button
                key={sheetKey(sheet)}
                onClick={() => setActiveTab(i)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg border border-b-0 text-xs font-bold shrink-0 transition-all ${
                  isActive
                    ? 'bg-[#0a0a0a] border-emerald-500/40 text-white'
                    : 'bg-black/40 border-[#333] text-gray-500 hover:text-gray-300 hover:bg-black/60'
                }`}
              >
                {done
                  ? <CheckCircle size={13} className="text-emerald-500"/>
                  : <span className="w-3 h-3 rounded-full border-2 border-red-500 shrink-0"/>
                }
                <span className="max-w-[120px] truncate">{sheet.name}</span>
                {sheet.fileSource && (
                  <span className="text-[9px] font-black px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">2</span>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-black ${
                  sheet.type === '차상위' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30' : 'bg-[#111] text-gray-400 border-gray-700'
                }`}>{sheet.type === '기초수급자' ? '수급' : sheet.type === '차상위' ? '차상위' : sheet.type === '혼합' ? '혼합' : '제외'}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 매핑 현황 바 — 시트별 독립 표시 */}
      <div className="bg-black/70 border-b border-white/5 shrink-0">
        {selectedSheets.length === 1 ? (
          <div className="px-6 py-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-gray-500 text-[11px] font-black tracking-widest mr-1">매핑현황</span>
            {Object.entries(FIELD_META).map(([key, meta]) => {
              const isRequired = REQUIRED_KEYS.includes(key);
              const isMapped = !!currentMap[key];
              if (!isRequired && !isMapped) return null;
              return (
                <span key={key} className={`px-2.5 py-1 rounded-md text-[11px] font-black flex items-center gap-1 border transition-all ${
                  isMapped ? `${meta.bg} ${meta.color} ${meta.border}` : 'bg-red-950/60 text-red-400 border-red-600/60 animate-pulse'
                }`}>
                  {isMapped ? '✓' : '✕'} {meta.label}
                  {isMapped && <span className="text-[9px] opacity-60 ml-0.5 max-w-[60px] truncate">{currentMap[key]}</span>}
                </span>
              );
            })}
          </div>
        ) : (
          selectedSheets.map((sheet, i) => {
            const sheetMap = mapDefs[sheetKey(sheet)] || {};
            const done = isSheetComplete(sheet);
            const isActive = i === safeTab;
            return (
              <div
                key={sheet.name}
                onClick={() => setActiveTab(i)}
                className={`px-4 py-1.5 flex items-center gap-2 flex-wrap border-b border-white/5 last:border-0 cursor-pointer transition-colors ${isActive ? 'bg-emerald-500/5' : 'hover:bg-white/[0.02]'}`}
              >
                <div className="flex items-center gap-1.5 mr-1 shrink-0">
                  {done
                    ? <CheckCircle size={11} className="text-emerald-500"/>
                    : <span className="w-2.5 h-2.5 rounded-full border-2 border-red-500 inline-block"/>
                  }
                  <span className={`text-[10px] font-black max-w-[100px] truncate ${isActive ? 'text-emerald-500' : done ? 'text-gray-400' : 'text-red-400'}`}>
                    {sheet.name}
                  </span>
                </div>
                {Object.entries(FIELD_META).map(([key, meta]) => {
                  const isRequired = REQUIRED_KEYS.includes(key);
                  const isMapped = !!sheetMap[key];
                  if (!isRequired && !isMapped) return null;
                  return (
                    <span key={key} className={`px-2 py-0.5 rounded text-[10px] font-black flex items-center gap-0.5 border transition-all ${
                      isMapped ? `${meta.bg} ${meta.color} ${meta.border}` : 'bg-red-950/60 text-red-400 border-red-600/60 animate-pulse'
                    }`}>
                      {isMapped ? '✓' : '✕'} {meta.label}
                    </span>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* 매핑 패널 */}
      <SheetMappingPanel
        key={sheetKey(activeSheet)}
        sheet={activeSheet}
        mapDef={currentMap}
        setMapDef={setCurrentMap}
        worksheets={worksheets}
        importNote={importNote}
        setImportNote={setImportNote}
        onUserMapping={onUserMapping}
      />

    </div>
  );
}
