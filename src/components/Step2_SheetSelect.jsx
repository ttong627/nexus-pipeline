import { useRef, useState, useEffect } from 'react';
import { FileSpreadsheet, ChevronLeft, ArrowRight, AlertTriangle, FilePlus } from 'lucide-react';
import { REGIONS, getSigunguOptions } from '../utils/regions.js';

export default function Step2_SheetSelect({ step, setStep, fileInfo, setFileInfo, worksheets, setWorksheets, setSelectedSheets, onHelp, handleSecondFileUpload, userCities = [], isAdmin = false }) {
  // 지자체 선택 상태
  const [selectedSido, setSelectedSido] = useState('');
  const [selectedSigungu, setSelectedSigungu] = useState('');

  // 해당월 (YYYY-MM 형식)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // fileInfo.city가 감지되면 시/도·시/군/구 드롭다운 초기값 세팅
  // 검증 기준은 드롭다운과 동일한 getSigunguOptions — "천안시"처럼 구로 분리된 시의
  // 단독명(부모명)도 인식해야 자동 감지값이 드롭다운에 정상 반영된다.
  useEffect(() => {
    if (!fileInfo?.city) return;
    const city = fileInfo.city.trim();
    for (const sido of Object.keys(REGIONS)) {
      const options = getSigunguOptions(sido);
      // "시/도 시/군/구" 형식이면 분리
      if (city.startsWith(sido + ' ')) {
        const sigungu = city.slice(sido.length + 1).trim();
        if (options.includes(sigungu)) {
          setSelectedSido(sido);
          setSelectedSigungu(sigungu);
          return;
        }
      }
      // 시/도 생략, 시/군/구만 있는 경우
      if (options.includes(city)) {
        setSelectedSido(sido);
        setSelectedSigungu(city);
        return;
      }
    }
  }, []);

  // fileInfo.month 자동 감지값 → selectedMonth 초기화
  useEffect(() => {
    const m = fileInfo?.month || '';
    if (m.match(/^\d{4}-\d{2}$/)) {
      setSelectedMonth(m);
    } else {
      // "5월" → 현재 년도 + "05" 변환 시도
      const match = m.match(/(\d{1,2})월?$/);
      if (match) {
        const mo = String(parseInt(match[1])).padStart(2, '0');
        const yr = new Date().getFullYear();
        setSelectedMonth(`${yr}-${mo}`);
      }
    }
  }, []);

  // 지자체·월 변경 시 fileInfo 동기화
  useEffect(() => {
    const city = selectedSido && selectedSigungu ? `${selectedSido} ${selectedSigungu}` : (selectedSigungu || selectedSido || '');
    setFileInfo(prev => ({ ...(prev || {}), city, month: selectedMonth }));
  }, [selectedSido, selectedSigungu, selectedMonth]);
  const secondFileInputRef = useRef(null);

  if (step !== 2) return null;

  const handleDrop = (e) => {
    e.preventDefault();
    // Second file upload logic here if needed
  };

  const handleSheetUpdate = (idx, field, value) => {
    const newSheets = [...worksheets];
    newSheets[idx][field] = value;
    setWorksheets(newSheets);
  };

  const proceedToMapping = () => {
    const city = selectedSido && selectedSigungu ? `${selectedSido} ${selectedSigungu}` : '';
    if (!city) {
      alert('지자체(시/도 + 시/군/구)를 반드시 선택해주세요.');
      return;
    }
    if (!selectedMonth) {
      alert('해당 월을 반드시 선택해주세요.');
      return;
    }
    // 지자체 정합성 하드 검증: 권한 지자체 목록이 있으면 정확히 일치해야 진행.
    // 표현 흔들림("천안시" vs "충청남도 천안시")·권한 외 지자체 오저장 방지.
    // 관리자/권한목록 없음은 표준값(시/도 시/군/구) 강제만 적용(드롭다운이 보장).
    if (!isAdmin && userCities.length > 0 && !userCities.includes(city)) {
      alert(
        `권한 지자체가 아닙니다: "${city}"\n\n`
        + `허용된 지자체:\n${userCities.join('\n')}\n\n`
        + `위 목록에서 정확히 선택해주세요. (다르면 명단·매핑이 엉뚱한 지자체로 저장됩니다)`
      );
      return;
    }
    setSelectedSheets(worksheets.filter(s => s.selected));
    setStep(3);
  };

  const cityLabel = selectedSido && selectedSigungu ? `${selectedSido} ${selectedSigungu}` : '';
  const monthLabel = selectedMonth ? `${parseInt(selectedMonth.split('-')[1])}월` : '';
  const canProceed = !!cityLabel && !!selectedMonth && worksheets.some(s => s.selected);

  const firstFileSheets  = worksheets.filter(s => !s.fileSource);
  const secondFileSheets = worksheets.filter(s => !!s.fileSource);
  const secondFileName   = secondFileSheets[0]?.fileSource || '';

  const renderRows = (sheets, startIdx) =>
    sheets.map((ws, i) => {
      const idx = startIdx + i;
      return (
        <tr key={idx} className={`transition-all duration-200 ${!ws.selected ? 'opacity-40 bg-black' : ws.type === '혼합' ? 'bg-[#060c18]/40 hover:bg-[#060c18]/80' : 'hover:bg-[#111]'}`}>
          <td className="px-6 py-4 text-center">
            <input type="checkbox" checked={ws.selected} onChange={(e) => handleSheetUpdate(idx, 'selected', e.target.checked)} className="w-5 h-5 accent-emerald-500 cursor-pointer" />
          </td>
          <td className="px-6 py-4 font-mono font-bold text-white text-base">
            <div className="flex items-center gap-2">
              {ws.fileSource && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 shrink-0">파일2</span>
              )}
              {ws.name}
            </div>
          </td>
          <td className="px-6 py-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                {ws.missingKeys.length > 0 ?
                  <span className="bg-[#1a0505] text-red-400 border border-red-900/50 px-2 py-0.5 rounded text-[11px] font-bold">🔴 누락: {ws.missingKeys.join(', ')}</span> :
                  ws.emptyWarnings.length > 0 ?
                    <span className="bg-amber-950/40 text-amber-400 border border-amber-500/40 px-2 py-0.5 rounded text-[11px] font-bold">⚠️ 치명적 ({ws.emptyWarnings.join(', ')})</span> :
                    <span className="bg-[#111] text-gray-400 border border-gray-700 px-2 py-0.5 rounded text-[11px] font-bold">✔️ 완벽</span>
                }
                <span className="text-gray-300 text-xs font-medium">헤더: <b>{ws.headerRowIdx}행</b> / 명단시작: <b>{ws.dataStartRowIdx === -1 ? '-' : ws.dataStartRowIdx}행</b></span>
              </div>
              <div className="text-[11px] text-gray-500 max-w-[220px] truncate" title={ws.mappedKeys.join(', ')}>
                인식 완료: {ws.mappedKeys.join(', ')}
              </div>
            </div>
          </td>
          <td className="px-6 py-4 text-center font-mono text-gray-400 bg-black/20">{ws.rowsCount.toLocaleString()} 행</td>
          <td className="px-6 py-4">
            <select value={ws.type} onChange={(e) => handleSheetUpdate(idx, 'type', e.target.value)} disabled={!ws.selected} className="bg-[#111] border border-[#444] text-white px-4 py-2 rounded-lg outline-none focus:border-emerald-500 font-bold">
              <option value="기초수급자">기초수급자</option>
              <option value="차상위">차상위</option>
              <option value="혼합">🔀 혼합 (자동구분)</option>
              <option value="제외">🚫 제외</option>
            </select>
          </td>
          <td className="px-6 py-4 text-right font-black text-emerald-500 text-base">{ws.qty.toLocaleString()} 포</td>
        </tr>
      );
    });

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] max-w-6xl mx-auto w-full overflow-hidden">

      {/* ── 상단 헤더 ── */}
      <div className="bg-gradient-to-b from-[#080f0d] to-[#090f0d] px-8 pt-5 pb-4 border-b border-[#1a2d29] shrink-0 shadow-lg">
        {/* 타이틀 + 버튼 행 */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-3 drop-shadow-md">
              <FileSpreadsheet size={24} className="text-emerald-500" /> 2단계: 워크시트 분류
            </h2>
            <p className="text-gray-400 mt-1 text-sm font-medium">지자체·월을 확인하고, 시트 분류(수급/차상위)를 완료하세요.</p>
          </div>
          <div className="flex gap-3 items-center">
            <button onClick={() => setStep(1)} className="px-5 py-2.5 bg-gray-800 border border-gray-600 text-white font-extrabold rounded-xl hover:bg-gray-700 transition-all shadow-md flex items-center gap-2 text-sm">
              <ChevronLeft size={16} strokeWidth={3} /> 업로드로 돌아가기
            </button>
            <button
              onClick={proceedToMapping}
              disabled={!canProceed}
              className={`px-7 py-2.5 font-extrabold rounded-xl flex items-center gap-2 uppercase tracking-wide text-sm transition-all ${
                canProceed
                  ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)] hover:bg-emerald-400 hover:scale-105'
                  : 'bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed'
              }`}
            >
              컬럼 매핑 진행 <ArrowRight size={16} strokeWidth={3} />
            </button>
            <button
              onClick={onHelp}
              className="w-9 h-9 rounded-full bg-emerald-950/30 border border-emerald-500/40 text-emerald-400 font-black text-base hover:bg-emerald-500/15 transition-all shrink-0"
              title="2단계 도움말"
            >?</button>
          </div>
        </div>

        {/* ── 지자체 + 해당월 입력 바 ── */}
        <div className="flex flex-wrap items-end gap-4 bg-black/40 border border-emerald-500/20 rounded-2xl px-5 py-3.5">
          {/* 시/도 */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-emerald-500 font-black tracking-widest uppercase">시 / 도</label>
            <select
              value={selectedSido}
              onChange={e => { setSelectedSido(e.target.value); setSelectedSigungu(''); }}
              className="bg-black border border-[#444] text-white rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-500 cursor-pointer min-w-[130px]"
            >
              <option value="">선택</option>
              {Object.keys(REGIONS).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* 시/군/구 */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-emerald-500 font-black tracking-widest uppercase">시 / 군 / 구</label>
            <select
              value={selectedSigungu}
              onChange={e => setSelectedSigungu(e.target.value)}
              disabled={!selectedSido}
              className="bg-black border border-[#444] text-white rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-40 min-w-[130px]"
            >
              <option value="">선택</option>
              {getSigunguOptions(selectedSido).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* 구분선 */}
          <div className="h-8 w-px bg-[#333] self-end mb-1" />

          {/* 해당 월 */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-emerald-500 font-black tracking-widest uppercase">해당 월</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-black border border-[#444] text-white rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-500 cursor-pointer"
            />
          </div>

          {/* 확인 배지 */}
          <div className="flex items-end pb-1 ml-2">
            {cityLabel && selectedMonth ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs font-black text-emerald-500">
                <span>✓</span>
                <span>{cityLabel} · {monthLabel}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-red-950/30 border border-red-500/30 rounded-xl text-xs font-bold text-red-400">
                <span>!</span>
                <span>{!cityLabel ? '지자체 미선택' : '월 미선택'}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {worksheets.length > 0 && worksheets.every(ws => ws.rowsCount === 0) && (
        <div className="bg-yellow-950/80 border-b border-yellow-500/50 px-8 py-3 flex items-center gap-3 text-yellow-400 font-bold shadow-inner">
          <AlertTriangle className="animate-pulse" size={18} />
          <span>시트에서 유효한 데이터 행을 찾지 못했습니다. 헤더 행이 상단 20행 이내에 있는지 확인하거나, 시트 선택 후 직접 매핑을 진행해주세요.</span>
        </div>
      )}

      <div className="flex-1 overflow-auto p-8 scrollbar-thin scrollbar-thumb-[#444] scrollbar-track-transparent">
        <div className="border border-white/10 rounded-xl overflow-hidden shadow-[0_0_20px_rgba(0,0,0,0.5)] bg-black/40">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-[#111] border-b border-[#333] text-emerald-500 font-extrabold text-sm tracking-wide">
              <tr>
                <th className="px-6 py-4 w-20 text-center">선택</th>
                <th className="px-6 py-4">엑셀 시트명</th>
                <th className="px-6 py-4">🤖 AI 구조 분석 리포트</th>
                <th className="px-6 py-4 text-center">유효 행 개수</th>
                <th className="px-6 py-4">분류 매칭</th>
                <th className="px-6 py-4 text-right">예상 포수</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-gray-200 text-sm">
              {renderRows(firstFileSheets, 0)}
              {secondFileSheets.length > 0 && (
                <>
                  <tr>
                    <td colSpan={6} className="px-6 py-2 bg-emerald-950/20 border-y border-emerald-500/15">
                      <span className="text-[11px] font-black text-emerald-500 tracking-widest">📄 추가 파일 — {secondFileName}</span>
                    </td>
                  </tr>
                  {renderRows(secondFileSheets, firstFileSheets.length)}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* 추가 파일 드롭존 */}
        <div className="mt-6">
          <p className="text-[11px] text-gray-600 font-black tracking-widest mb-3">
            ━━ 추가 파일 {secondFileName ? `(현재: ${secondFileName} — 다시 드롭하면 교체)` : '(양식이 다른 차상위/수급자 파일이 있는 경우)'}
          </p>
          <label
            className={`flex items-center justify-center gap-3 w-full border-2 border-dashed rounded-xl p-5 cursor-pointer transition-all group ${secondFileName ? 'border-emerald-500/40 bg-[#060c18]/40 hover:border-emerald-500/70' : 'border-[#333] hover:border-emerald-500/50'}`}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onMouseDown={(e) => { e.preventDefault(); if (secondFileInputRef.current) { secondFileInputRef.current.value = ''; secondFileInputRef.current.click(); } }}
          >
            <FilePlus size={20} className={`shrink-0 transition-colors ${secondFileName ? 'text-emerald-500' : 'text-gray-600 group-hover:text-emerald-500'}`} />
            <div>
              <p className={`text-sm font-bold transition-colors ${secondFileName ? 'text-emerald-300' : 'text-gray-500 group-hover:text-emerald-400'}`}>
                {secondFileName ? `${secondFileName} 로드됨 — 교체하려면 클릭하거나 드래그` : '다른 양식의 명단 파일 추가 (드래그 또는 클릭)'}
              </p>
              <p className="text-[11px] text-gray-700 mt-0.5">기초수급자·차상위가 별도 파일에 분리된 경우 / 업로드 시 시트 목록에 추가됩니다</p>
            </div>
            <input ref={secondFileInputRef} type="file" className="hidden" accept=".xlsx,.xls,.csv"
              onChange={e => { if (e.target.files?.[0]) handleSecondFileUpload(e.target.files[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>
    </div>
  );
}
