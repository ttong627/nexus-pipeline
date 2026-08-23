// '파일 합치기' 탭 화면 — UtilsModal(3,124줄)에서 분리(2026-08-23 Phase 4-2).
//   UtilsModal 은 11개 독립 도구의 상자이고 **탭끼리 상태를 공유하지 않는다**(점검 실측) — 그래서 화면부터 뗐다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다 —
//     워커·컬럼정의·미리보기 계산까지 옮기면 되돌리기가 어려워지고, 지금 목적은 '읽을 수 있게' 이지 재설계가 아니다.
import { ArrowRight, CheckCircle2, ChevronRight, Combine, Download, Eye, FileSpreadsheet, Loader2, RefreshCw, Upload } from 'lucide-react';

export default function FileMergeTab({
  mergeStep,
  setMergeStep,
  mergeFileA,
  mergeFileB,
  mergeResultA,
  mergeResultB,
  mergeMappingA,
  mergeMappingB,
  mergeSelectedSheetsA,
  mergeSelectedSheetsB,
  mergeBaseSheetA,
  mergeBaseSheetB,
  mergeActiveHeadersA,
  mergeActiveHeadersB,
  isAnalyzingMergeA,
  isAnalyzingMergeB,
  isExportingMerge,
  mergeFileName,
  setMergeFileName,
  handleMergeUpload,
  handleMergeMappingChange,
  getMergePreviewRows,
  exportFileMerge,
  resetFileMerge,
  OUTPUT_COLS,
  switchMergeBaseSheet,
  toggleMergeSheet,
}) {
  return (
            <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Combine size={18} className="text-violet-400" /> 파일 합치기
                </h3>
                {mergeStep >= 2 && <button onClick={resetFileMerge} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>}
              </div>
              <p className="text-sm text-gray-400 mb-3 leading-relaxed">
                형식이 다른 <span className="text-blue-400 font-bold">기초수급자</span>·<span className="text-amber-400 font-bold">차상위</span> 파일을 표준 컬럼으로 통일하고 <span className="text-blue-400 font-bold">3시트(기초수급자/차상위/합본)</span> 1개 파일로 합칩니다.
              </p>

              {/* Step indicator */}
              <div className="flex items-center gap-1 mb-4">
                {['파일 업로드', '컬럼 매핑', '미리보기'].map((label, idx) => {
                  const step = idx + 1;
                  const isActive = mergeStep === step;
                  const isDone = mergeStep > step;
                  return (
                    <div key={step} className="flex items-center gap-1">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black transition-colors ${isActive ? 'bg-violet-900/40 border border-violet-700/50 text-violet-300' : isDone ? 'text-gray-500 border border-transparent' : 'text-gray-700 border border-transparent'}`}>
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${isActive ? 'bg-violet-500 text-black' : isDone ? 'bg-gray-700 text-gray-400' : 'bg-gray-800 text-gray-600'}`}>{isDone ? '✓' : step}</span>
                        {label}
                      </div>
                      {idx < 2 && <ArrowRight size={10} className="text-gray-700 shrink-0" />}
                    </div>
                  );
                })}
              </div>

              {/* Step 1 — Upload two files */}
              {mergeStep === 1 && (
                <div className="flex flex-col flex-1">
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    {[
                      { which: 'A', label: '기초수급자 파일', color: 'blue',  file: mergeFileA,  result: mergeResultA,  analyzing: isAnalyzingMergeA },
                      { which: 'B', label: '차상위 파일',     color: 'amber', file: mergeFileB,  result: mergeResultB,  analyzing: isAnalyzingMergeB },
                    ].map(({ which, label, color, file, result, analyzing }) => (
                      <div key={which}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white ${color === 'blue' ? 'bg-blue-600' : 'bg-amber-600'}`}>{which}</span>
                          <p className={`text-[11px] font-black ${color === 'blue' ? 'text-blue-400' : 'text-amber-400'}`}>{label}</p>
                        </div>
                        <label className={`w-full py-8 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${file ? `border-${color}-500 bg-${color}-500/5` : 'border-gray-700 hover:border-gray-500 bg-black'}`}
                          style={{ borderColor: file ? (color === 'blue' ? '#3b82f6' : '#f59e0b') : undefined, backgroundColor: file ? (color === 'blue' ? 'rgba(59,130,246,0.05)' : 'rgba(245,158,11,0.05)') : undefined }}>
                          {analyzing
                            ? <RefreshCw size={24} className={`${color === 'blue' ? 'text-blue-400' : 'text-amber-400'} mb-2 animate-spin`} />
                            : <Upload size={24} className={file ? `${color === 'blue' ? 'text-blue-400' : 'text-amber-400'} mb-2` : 'text-gray-500 mb-2'} />
                          }
                          <span className={`font-bold text-xs text-center px-3 ${file ? (color === 'blue' ? 'text-blue-400' : 'text-amber-400') : 'text-gray-400'}`}>
                            {analyzing ? '분석 중...' : file ? file.name : `${label} 엑셀 선택`}
                          </span>
                          <input type="file" accept=".xlsx,.xls" onChange={e => handleMergeUpload(e, which)} className="hidden" disabled={analyzing} />
                        </label>
                        {result && (
                          <div className="mt-1.5">
                            <p className={`text-[10px] font-black text-center mb-1 ${color === 'blue' ? 'text-blue-400' : 'text-amber-400'}`}>
                              ✓ {result.totalRows.toLocaleString()}건 감지
                            </p>
                            <div className="flex gap-1 flex-wrap justify-center">
                              {result.sheets.map(s => (
                                <span key={s.name} className={`px-1.5 py-0.5 rounded text-[9px] border font-bold ${color === 'blue' ? 'border-blue-800/40 text-blue-500 bg-blue-950/20' : 'border-amber-800/40 text-amber-500 bg-amber-950/20'}`}>
                                  {s.name} ({s.rowCount.toLocaleString()}행)
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Output structure preview */}
                  <div className="border border-gray-800 rounded-xl p-3 mb-4">
                    <p className="text-[10px] text-gray-600 font-black mb-2 text-center">출력 파일 구조</p>
                    <div className="flex items-center justify-center gap-2">
                      <span className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-blue-900/20 border border-blue-700/30 text-blue-400">기초수급자 시트</span>
                      <span className="text-gray-600">+</span>
                      <span className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-amber-900/20 border border-amber-700/30 text-amber-400">차상위 시트</span>
                      <span className="text-gray-600">+</span>
                      <span className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-blue-900/20 border border-blue-700/30 text-blue-400">합본 시트</span>
                      <span className="text-gray-500 text-[10px]">→ 1개 파일</span>
                    </div>
                  </div>

                  {mergeResultA && mergeResultB ? (
                    <button onClick={() => setMergeStep(2)}
                      className="w-full py-3.5 bg-violet-700 hover:bg-violet-600 text-white font-extrabold rounded-xl text-sm transition-all flex items-center justify-center gap-2">
                      <ArrowRight size={16} /> 컬럼 매핑 설정하기
                    </button>
                  ) : (
                    <div className="w-full py-3 border border-gray-800 rounded-xl text-center text-xs text-gray-600 font-bold">
                      {!mergeResultA && !mergeResultB ? '두 파일을 모두 업로드하세요' : !mergeResultA ? '기초수급자 파일을 업로드하세요' : '차상위 파일을 업로드하세요'}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2 — Mapping */}
              {mergeStep === 2 && mergeResultA && mergeResultB && (
                <>
                  {/* Sheet selectors — 항상 표시 */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {[
                      { which: 'A', label: '기초수급자 파일', colorCls: 'text-blue-400', baseColor: 'blue',  result: mergeResultA, baseSheet: mergeBaseSheetA, selSheets: mergeSelectedSheetsA },
                      { which: 'B', label: '차상위 파일',     colorCls: 'text-amber-400', baseColor: 'amber', result: mergeResultB, baseSheet: mergeBaseSheetB, selSheets: mergeSelectedSheetsB },
                    ].map(({ which, label, colorCls, baseColor, result, baseSheet, selSheets }) => (
                      <div key={which} className="bg-black/20 border border-gray-800 rounded-xl p-2.5">
                        <p className={`text-[9px] font-black mb-2 ${colorCls}`}>{label} 시트</p>
                        {/* Base sheet */}
                        <p className="text-[9px] text-indigo-500 font-black mb-1">★ 매핑 기준</p>
                        <div className="flex gap-1 flex-wrap mb-2">
                          {result.sheets.map(s => {
                            const isBase = baseSheet === s.name;
                            return (
                              <button key={s.name} onClick={() => switchMergeBaseSheet(which, s.name)}
                                className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                                  isBase
                                    ? baseColor === 'blue'
                                      ? 'bg-blue-900/50 border-blue-500/60 text-blue-200 shadow-[0_0_8px_rgba(59,130,246,0.3)]'
                                      : 'bg-amber-900/50 border-amber-500/60 text-amber-200 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                                    : 'bg-black/30 border-gray-800 text-gray-600 hover:border-gray-600 hover:text-gray-400'
                                }`}>
                                {isBase ? '★ ' : ''}{s.name} <span className="opacity-60">({s.rowCount.toLocaleString()}행)</span>
                              </button>
                            );
                          })}
                        </div>
                        {/* Export sheets */}
                        <p className="text-[9px] text-gray-600 font-black mb-1">✓ 내보낼 시트</p>
                        <div className="flex gap-1 flex-wrap">
                          {result.sheets.map(s => {
                            const checked = selSheets.includes(s.name);
                            return (
                              <label key={s.name} className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold cursor-pointer transition-colors ${
                                checked
                                  ? baseColor === 'blue'
                                    ? 'bg-blue-900/30 border-blue-700/40 text-blue-300'
                                    : 'bg-amber-900/30 border-amber-700/40 text-amber-300'
                                  : 'bg-black/30 border-gray-800 text-gray-600 hover:border-gray-600'
                              }`}>
                                <input type="checkbox" checked={checked} onChange={() => toggleMergeSheet(which, s.name)} className="hidden" />
                                {checked ? '✓ ' : ''}{s.name} <span className="opacity-60 ml-0.5">({s.rowCount.toLocaleString()}행)</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Stats */}
                  <div className="flex gap-2 mb-2 flex-wrap">
                    <span className="px-2.5 py-1 rounded text-[10px] font-black border bg-blue-900/20 border-blue-700/30 text-blue-400">기초수급자 {mergeResultA.totalRows.toLocaleString()}건</span>
                    <span className="px-2.5 py-1 rounded text-[10px] font-black border bg-amber-900/20 border-amber-700/30 text-amber-400">차상위 {mergeResultB.totalRows.toLocaleString()}건</span>
                    <span className="px-2.5 py-1 rounded text-[10px] font-black border bg-blue-900/20 border-blue-700/30 text-blue-400">합본 {(mergeResultA.totalRows + mergeResultB.totalRows).toLocaleString()}건</span>
                  </div>

                  {/* Combined mapping table */}
                  <div className="flex-1 overflow-y-auto min-h-0 border border-gray-800 rounded-xl">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[#0d0d0d] z-10">
                        <tr className="border-b border-gray-800 text-gray-600">
                          <th className="px-2 py-2 text-left font-black w-[90px]">출력 컬럼</th>
                          <th className="px-2 py-2 text-left font-black text-blue-500">기초수급자 파일 원본</th>
                          <th className="px-2 py-2 text-left font-black text-amber-500">차상위 파일 원본</th>
                        </tr>
                      </thead>
                      <tbody>
                        {OUTPUT_COLS.map((col, ci) => {
                          const mA = mergeMappingA[col.key] || { srcIdx: -1, confidence: 0 };
                          const mB = mergeMappingB[col.key] || { srcIdx: -1, confidence: 0 };
                          const isGubun = col.key === 'gubun';
                          const borderClassA = mA.srcIdx === -1 ? 'border-gray-700' : mA.confidence >= 85 ? 'border-blue-700/50' : mA.confidence >= 72 ? 'border-yellow-700/50' : 'border-orange-700/50';
                          const borderClassB = mB.srcIdx === -1 ? 'border-gray-700' : mB.confidence >= 85 ? 'border-blue-700/50' : mB.confidence >= 72 ? 'border-yellow-700/50' : 'border-orange-700/50';
                          return (
                            <tr key={col.key} className={`border-b border-gray-900 ${ci % 2 === 0 ? 'bg-black/20' : 'bg-black/5'}`}>
                              <td className="px-2 py-1.5">
                                <span className="font-black text-white text-[11px]">{col.label}</span>
                                {col.transform && <span className="ml-1 text-[8px] text-indigo-400 opacity-70">{col.transform === 'phone' ? '☎' : col.transform === 'birth' ? '📅' : 'Y/N'}</span>}
                                {col.special === 'autoSeq'  && <span className="ml-1 text-[8px] text-blue-400 opacity-70">⚡</span>}
                                {col.special === 'fromAddr' && <span className="ml-1 text-[8px] text-teal-400 opacity-70">🔍</span>}
                              </td>
                              <td className="px-2 py-1.5">
                                {isGubun
                                  ? <span className="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-black bg-blue-900/20 border border-blue-700/30 text-blue-400">기초수급자 (자동)</span>
                                  : <select value={String(mA.srcIdx)} onChange={e => handleMergeMappingChange('A', col.key, e.target.value)}
                                      className={`w-full bg-[#0a0a0a] rounded-lg px-2 py-1 text-white outline-none transition-all text-[10px] border ${borderClassA}`}>
                                      <option value="-1">(비어두기)</option>
                                      {col.special === 'autoSeq'  && <option value="-3">⚡ 자동 생성</option>}
                                      {col.special === 'fromAddr' && <option value="-2">🔍 주소에서 추출</option>}
                                      {mergeActiveHeadersA.map((h, hi) => <option key={hi} value={String(hi)}>{h || `열${hi+1}`}</option>)}
                                    </select>
                                }
                              </td>
                              <td className="px-2 py-1.5">
                                {isGubun
                                  ? <span className="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-black bg-amber-900/20 border border-amber-700/30 text-amber-400">차상위 (자동)</span>
                                  : <select value={String(mB.srcIdx)} onChange={e => handleMergeMappingChange('B', col.key, e.target.value)}
                                      className={`w-full bg-[#0a0a0a] rounded-lg px-2 py-1 text-white outline-none transition-all text-[10px] border ${borderClassB}`}>
                                      <option value="-1">(비어두기)</option>
                                      {col.special === 'autoSeq'  && <option value="-3">⚡ 자동 생성</option>}
                                      {col.special === 'fromAddr' && <option value="-2">🔍 주소에서 추출</option>}
                                      {mergeActiveHeadersB.map((h, hi) => <option key={hi} value={String(hi)}>{h || `열${hi+1}`}</option>)}
                                    </select>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-800 shrink-0 flex gap-2">
                    <input value={mergeFileName} onChange={e => setMergeFileName(e.target.value)}
                      className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-xl px-3 py-2 text-white outline-none focus:border-violet-500 font-bold text-xs" placeholder="저장 파일 이름" />
                    <button onClick={() => setMergeStep(3)}
                      className="px-5 py-2 bg-violet-700 hover:bg-violet-600 text-white font-extrabold rounded-xl text-xs transition-all flex items-center gap-1.5">
                      <Eye size={13} /> 미리보기
                    </button>
                  </div>
                </>
              )}

              {/* Step 3 — Preview */}
              {mergeStep === 3 && (
                <>
                  <button onClick={() => setMergeStep(2)} className="text-sm text-gray-500 hover:text-gray-300 transition-colors mb-3 self-start flex items-center gap-1">
                    ← 매핑으로 돌아가기
                  </button>
                  <div className="flex gap-3 mb-2">
                    <span className="flex items-center gap-1 text-[11px] text-gray-500"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>기초수급자 {mergeResultA?.totalRows?.toLocaleString()}건</span>
                    <span className="flex items-center gap-1 text-[11px] text-gray-500"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>차상위 {mergeResultB?.totalRows?.toLocaleString()}건</span>
                    <span className="text-[11px] text-gray-600">· 각 3건 샘플</span>
                  </div>

                  <div className="flex-1 overflow-auto min-h-0 border border-gray-800 rounded-xl">
                    <table className="text-xs min-w-max">
                      <thead className="sticky top-0 bg-[#0d0d0d]">
                        <tr className="border-b border-gray-800">
                          <th className="px-2 py-2 w-5"></th>
                          {OUTPUT_COLS.map(col => (
                            <th key={col.key} className="px-3 py-2 text-left font-black text-gray-500 whitespace-nowrap">{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {getMergePreviewRows('A').map((row, ri) => (
                          <tr key={`a${ri}`} className="border-b border-gray-900 bg-blue-950/15">
                            <td className="px-2 py-1.5 text-center"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span></td>
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-gray-300 max-w-[130px] truncate" title={String(cell ?? '')}>
                                {cell !== '' && cell !== null ? String(cell) : <span className="text-gray-700">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr className="bg-gray-900/50">
                          <td colSpan={OUTPUT_COLS.length + 1} className="px-3 py-1 text-[10px] text-gray-600 text-center">···</td>
                        </tr>
                        {getMergePreviewRows('B').map((row, ri) => (
                          <tr key={`b${ri}`} className="border-b border-gray-900 bg-amber-950/15">
                            <td className="px-2 py-1.5 text-center"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span></td>
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-gray-300 max-w-[130px] truncate" title={String(cell ?? '')}>
                                {cell !== '' && cell !== null ? String(cell) : <span className="text-gray-700">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-800 shrink-0 flex gap-2">
                    <input value={mergeFileName} onChange={e => setMergeFileName(e.target.value)}
                      className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-xl px-3 py-2 text-white outline-none focus:border-violet-500 font-bold text-xs" placeholder="저장 파일 이름" />
                    <button onClick={exportFileMerge} disabled={isExportingMerge}
                      className="px-5 py-2 bg-[#3b82f6] hover:bg-[#93c5fd] text-black font-extrabold rounded-xl text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                      {isExportingMerge
                        ? <><RefreshCw size={13} className="animate-spin" /> 처리 중...</>
                        : <><Download size={13} /> {((mergeResultA?.totalRows||0)+(mergeResultB?.totalRows||0)).toLocaleString()}건 · 3시트 다운로드</>
                      }
                    </button>
                  </div>
                </>
              )}
            </div>
  );
}
