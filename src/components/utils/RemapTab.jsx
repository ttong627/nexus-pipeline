// 'remap' 탭 화면 — UtilsModal 에서 분리(2026-08-24 Phase 4-6).
//   UtilsModal 은 독립 도구들의 상자이고 탭끼리 상태를 공유하지 않는다(점검 실측) — 그래서 화면부터 뗀다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다(되돌리기 쉬움).
import { ArrowDown, ArrowRight, ArrowUp, Download, Eye, RefreshCw, SlidersHorizontal, Upload } from 'lucide-react';

export default function RemapTab({
  OUTPUT_COLS,
  exportRemap,
  getPreviewRows,
  getRemapSampleVal,
  handleMappingChange,
  handleRemapUpload,
  isAnalyzingRemap,
  isExportingRemap,
  moveRemapCol,
  name,
  remapActiveHeaders,
  remapBaseSheet,
  remapColOrder,
  remapFile,
  remapFileName,
  remapMapping,
  remapResult,
  remapSelectedSheets,
  remapStep,
  resetRemap,
  setRemapFileName,
  setRemapStep,
  switchRemapBaseSheet,
  toggleRemapSheet,
}) {
  return (
            <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <SlidersHorizontal size={18} className="text-indigo-400" /> 컬럼 재배치
                </h3>
                {remapStep >= 2 && <button onClick={resetRemap} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>}
              </div>
              <p className="text-sm text-gray-400 mb-3 leading-relaxed">
                어떤 형식의 엑셀이든 <span className="text-indigo-400 font-bold">14개 표준 컬럼</span>으로 재배치합니다. 전화번호·생년월일·수급구분 자동 정규화, 여러 시트 합산 지원.
              </p>

              {/* Step indicator */}
              <div className="flex items-center gap-1 mb-4">
                {['파일 업로드', '컬럼 매핑', '미리보기'].map((label, idx) => {
                  const step = idx + 1;
                  const isActive = remapStep === step;
                  const isDone = remapStep > step;
                  return (
                    <div key={step} className="flex items-center gap-1">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black transition-colors
                        ${isActive ? 'bg-indigo-900/40 border border-indigo-700/50 text-indigo-300' : isDone ? 'text-gray-500 border border-transparent' : 'text-gray-700 border border-transparent'}`}>
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${isActive ? 'bg-indigo-500 text-black' : isDone ? 'bg-gray-700 text-gray-400' : 'bg-gray-800 text-gray-600'}`}>
                          {isDone ? '✓' : step}
                        </span>
                        {label}
                      </div>
                      {idx < 2 && <ArrowRight size={10} className="text-gray-700 shrink-0" />}
                    </div>
                  );
                })}
              </div>

              {/* Step 1 — Upload */}
              {remapStep === 1 && (
                <label className={`w-full py-10 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${remapFile && !isAnalyzingRemap ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                  {isAnalyzingRemap
                    ? <RefreshCw size={28} className="text-indigo-400 mb-2 animate-spin" />
                    : <Upload size={28} className={remapFile ? 'text-indigo-400 mb-2' : 'text-gray-500 mb-2'} />
                  }
                  <span className={`font-bold text-sm ${remapFile ? 'text-indigo-400' : 'text-gray-400'}`}>
                    {isAnalyzingRemap ? '컬럼 자동 분석 중...' : remapFile ? remapFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                  </span>
                  <span className="text-[10px] text-gray-600 mt-1">형식 무관 · .xlsx / .xls · 여러 시트 합산 가능</span>
                  <input type="file" accept=".xlsx,.xls" onChange={handleRemapUpload} className="hidden" disabled={isAnalyzingRemap} />
                </label>
              )}

              {/* Step 2 — Mapping */}
              {remapStep === 2 && remapResult && (
                <>
                  {/* Sheet selector — 항상 표시 */}
                  <div className="mb-3 bg-black/20 border border-gray-800 rounded-xl p-3">
                    <p className="text-[10px] font-black text-gray-400 mb-2">시트 선택</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[9px] text-indigo-500 font-black mb-1.5">★ 매핑 기준 시트 (헤더·샘플 출처)</p>
                        <div className="flex gap-1 flex-wrap">
                          {remapResult.sheets.map(s => {
                            const isBase = remapBaseSheet === s.name;
                            return (
                              <button key={s.name} onClick={() => switchRemapBaseSheet(s.name)}
                                className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                                  isBase ? 'bg-indigo-900/50 border-indigo-500/60 text-indigo-200 shadow-[0_0_8px_rgba(99,102,241,0.3)]' : 'bg-black/30 border-gray-800 text-gray-600 hover:border-indigo-700/40 hover:text-gray-400'
                                }`}>
                                {isBase ? '★ ' : ''}{s.name} <span className="opacity-60">({s.rowCount.toLocaleString()}행)</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="text-[9px] text-gray-500 font-black mb-1.5">✓ 내보낼 시트 (복수 선택 = 합산)</p>
                        <div className="flex gap-1 flex-wrap">
                          {remapResult.sheets.map(s => {
                            const checked = remapSelectedSheets.includes(s.name);
                            return (
                              <label key={s.name} className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold cursor-pointer transition-colors ${
                                checked ? 'bg-indigo-900/30 border-indigo-700/40 text-indigo-300' : 'bg-black/30 border-gray-800 text-gray-600 hover:border-gray-600'
                              }`}>
                                <input type="checkbox" checked={checked} onChange={() => toggleRemapSheet(s.name)} className="hidden" />
                                {checked ? '✓ ' : ''}{s.name} <span className="opacity-60 ml-0.5">({s.rowCount.toLocaleString()}행)</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex gap-2 mb-2 flex-wrap">
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-black border bg-black/40 border-indigo-700/40 text-indigo-400">
                      기준: {(remapResult.sheets.find(s => s.name === remapBaseSheet)?.rowCount ?? remapResult.totalRows).toLocaleString()}건
                    </span>
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-black border bg-black/40 border-gray-700 text-gray-500">
                      원본 {remapActiveHeaders.length}개 컬럼
                    </span>
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border bg-black/40 ${
                      Object.values(remapMapping).filter(m => m.srcIdx !== -1).length >= 10
                        ? 'border-blue-700/40 text-blue-400' : 'border-yellow-700/40 text-yellow-400'
                    }`}>
                      {Object.values(remapMapping).filter(m => m.srcIdx !== -1).length} / {OUTPUT_COLS.length}개 매핑됨
                    </span>
                    {remapSelectedSheets.length > 1 && (
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-black border bg-purple-900/20 border-purple-700/40 text-purple-400">
                        {remapSelectedSheets.length}개 시트 합산
                      </span>
                    )}
                  </div>

                  {/* Mapping table with reorder buttons */}
                  <div className="flex-1 overflow-y-auto min-h-0 border border-gray-800 rounded-xl">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#0d0d0d] z-10">
                        <tr className="border-b border-gray-800 text-gray-600">
                          <th className="px-1 py-2 w-[30px] text-center font-black">순서</th>
                          <th className="px-3 py-2 text-left font-black w-[100px]">출력 컬럼</th>
                          <th className="px-3 py-2 text-left font-black">원본 컬럼</th>
                          <th className="px-3 py-2 text-center font-black w-[58px]">신뢰도</th>
                          <th className="px-3 py-2 text-left font-black w-[100px]">샘플값</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const orderedCols = remapColOrder.map(key => OUTPUT_COLS.find(c => c.key === key)).filter(Boolean);
                          return orderedCols.map((col, ci) => {
                            const m = remapMapping[col.key] || { srcIdx: -1, confidence: 0 };
                            const sampleVal = getRemapSampleVal(col.key, m.srcIdx);
                            return (
                              <tr key={col.key} className={`border-b border-gray-900 ${ci % 2 === 0 ? 'bg-black/20' : 'bg-black/5'}`}>
                                <td className="px-1 py-1 text-center">
                                  <div className="flex flex-col gap-0 items-center">
                                    <button onClick={() => moveRemapCol(col.key, 'up')} disabled={ci === 0}
                                      className="p-0.5 rounded hover:bg-indigo-900/40 text-gray-600 hover:text-indigo-300 disabled:opacity-20 transition-colors">
                                      <ArrowUp size={9} />
                                    </button>
                                    <button onClick={() => moveRemapCol(col.key, 'down')} disabled={ci === orderedCols.length - 1}
                                      className="p-0.5 rounded hover:bg-indigo-900/40 text-gray-600 hover:text-indigo-300 disabled:opacity-20 transition-colors">
                                      <ArrowDown size={9} />
                                    </button>
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <span className="font-black text-white text-[11px]">{col.label}</span>
                                  {col.transform && (
                                    <span className="ml-1 text-[8px] text-indigo-400 opacity-70">
                                      {col.transform === 'phone' ? '☎' : col.transform === 'birth' ? '📅' : 'Y/N'}
                                    </span>
                                  )}
                                  {col.special === 'autoSeq' && <span className="ml-1 text-[8px] text-blue-400 opacity-70">⚡</span>}
                                  {col.special === 'fromAddr' && <span className="ml-1 text-[8px] text-teal-400 opacity-70">🔍</span>}
                                </td>
                                <td className="px-2 py-1.5">
                                  <select
                                    value={String(m.srcIdx)}
                                    onChange={e => handleMappingChange(col.key, e.target.value)}
                                    className="w-full bg-[#0a0a0a] border border-gray-700 focus:border-indigo-500 rounded-lg px-2 py-1 text-white outline-none transition-all text-[11px]"
                                  >
                                    <option value="-1">(비어두기)</option>
                                    {col.special === 'autoSeq' && <option value="-3">⚡ 자동 생성 (1, 2, 3...)</option>}
                                    {col.special === 'fromAddr' && <option value="-2">🔍 주소에서 자동 추출</option>}
                                    {remapActiveHeaders.map((h, hi) => (
                                      <option key={hi} value={String(hi)}>{h || `열${hi+1}`}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                  {m.srcIdx === -3
                                    ? <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-blue-900/30 border border-blue-700/40 text-blue-300">자동</span>
                                    : m.srcIdx === -2
                                    ? <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-teal-900/30 border border-teal-700/40 text-teal-300">추출</span>
                                    : m.srcIdx === -1
                                    ? <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-gray-900/30 border border-gray-700 text-gray-600">빈값</span>
                                    : m.confidence >= 85
                                    ? <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-blue-900/30 border border-blue-700/40 text-blue-400">{m.confidence}%</span>
                                    : m.confidence >= 72
                                    ? <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-yellow-900/30 border border-yellow-700/40 text-yellow-400">{m.confidence}%</span>
                                    : <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-orange-900/30 border border-orange-700/40 text-orange-400">{m.confidence}%</span>
                                  }
                                </td>
                                <td className="px-3 py-1.5">
                                  <span className="text-gray-400 truncate block font-mono text-[10px] max-w-[90px]" title={String(sampleVal)}>
                                    {sampleVal !== '' && sampleVal !== undefined ? String(sampleVal) : <span className="text-gray-700">—</span>}
                                  </span>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>

                  {/* File name + preview button */}
                  <div className="mt-3 pt-3 border-t border-gray-800 shrink-0 flex gap-2">
                    <input value={remapFileName} onChange={e => setRemapFileName(e.target.value)}
                      className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-xl px-3 py-2 text-white outline-none focus:border-indigo-500 font-bold text-xs" placeholder="저장 파일 이름" />
                    <button onClick={() => setRemapStep(3)}
                      className="px-5 py-2 bg-indigo-700 hover:bg-indigo-600 text-white font-extrabold rounded-xl text-xs transition-all flex items-center gap-1.5">
                      <Eye size={13} /> 미리보기
                    </button>
                  </div>
                </>
              )}

              {/* Step 3 — Preview */}
              {remapStep === 3 && (
                <>
                  <button onClick={() => setRemapStep(2)} className="text-sm text-gray-500 hover:text-gray-300 transition-colors mb-3 self-start flex items-center gap-1">
                    ← 매핑으로 돌아가기
                  </button>
                  <p className="text-[11px] text-gray-500 mb-2">
                    처음 5건 변환 결과 미리보기 · 전체 <span className="text-white font-bold">{remapResult?.totalRows?.toLocaleString()}건</span>
                    {remapSelectedSheets.length > 1 && <span className="text-purple-400 ml-1">({remapSelectedSheets.length}개 시트 합산)</span>}
                  </p>

                  {/* Preview table — horizontal scroll */}
                  <div className="flex-1 overflow-auto min-h-0 border border-gray-800 rounded-xl">
                    <table className="text-xs min-w-max">
                      <thead className="sticky top-0 bg-[#0d0d0d]">
                        <tr className="border-b border-gray-800">
                          {remapColOrder.map(key => OUTPUT_COLS.find(c => c.key === key)).filter(Boolean).map(col => (
                            <th key={col.key} className="px-3 py-2 text-left font-black text-gray-500 whitespace-nowrap">{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {getPreviewRows().map((row, ri) => (
                          <tr key={ri} className={`border-b border-gray-900 ${ri % 2 === 0 ? 'bg-black/20' : 'bg-black/5'}`}>
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-gray-300 max-w-[150px] truncate" title={String(cell ?? '')}>
                                {cell !== '' && cell !== null && cell !== undefined ? String(cell) : <span className="text-gray-700">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* File name + export button */}
                  <div className="mt-3 pt-3 border-t border-gray-800 shrink-0 flex gap-2">
                    <input value={remapFileName} onChange={e => setRemapFileName(e.target.value)}
                      className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-xl px-3 py-2 text-white outline-none focus:border-indigo-500 font-bold text-xs" placeholder="저장 파일 이름" />
                    <button onClick={exportRemap} disabled={isExportingRemap}
                      className="px-5 py-2 bg-[#3b82f6] hover:bg-[#93c5fd] text-black font-extrabold rounded-xl text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                      {isExportingRemap ? <><RefreshCw size={13} className="animate-spin" /> 처리 중...</> : <><Download size={13} /> {remapResult?.totalRows?.toLocaleString()}건 다운로드</>}
                    </button>
                  </div>
                </>
              )}
            </div>
  );
}
