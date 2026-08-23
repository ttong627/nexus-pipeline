// 'dedup' 탭 화면 — UtilsModal 에서 분리(2026-08-24 Phase 4-6).
//   UtilsModal 은 독립 도구들의 상자이고 탭끼리 상태를 공유하지 않는다(점검 실측) — 그래서 화면부터 뗀다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다(되돌리기 쉬움).
import { CheckSquare, Download, GitMerge, Square, Upload } from 'lucide-react';

export default function DedupTab({
  dedupFile,
  dedupResult,
  dedupSubTab,
  deleteRowNums,
  exportDedup,
  fmtPhone,
  handleDedupUpload,
  hasDedup,
  isAnalyzing,
  isExporting,
  resetDedup,
  runAnalysis,
  setDedupSubTab,
  setDeleteRowNums,
  toggleGroup,
  toggleRow,
}) {
  return (
            <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-white">중복 데이터 정리</h3>
                {dedupResult && (
                  <button onClick={resetDedup} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>
                )}
              </div>
              <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                이름+생년월일+전화 <span className="text-red-400 font-bold">(강한)</span> 또는 행정동+이름+전화 <span className="text-yellow-400 font-bold">(약한)</span> 중복을 탐지하고 직접 선택하여 정리합니다.
              </p>

              {/* 업로드 & 분석 */}
              {!dedupResult && (
                <div className="space-y-4">
                  <label className={`w-full py-6 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${dedupFile ? 'border-purple-500 bg-purple-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                    <Upload size={26} className={dedupFile ? 'text-purple-400 mb-2' : 'text-gray-500 mb-2'} />
                    <span className={`font-bold text-sm ${dedupFile ? 'text-purple-400' : 'text-gray-400'}`}>
                      {dedupFile ? dedupFile.name : '엑셀 파일 선택'}
                    </span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleDedupUpload} className="hidden" />
                  </label>
                  <button onClick={runAnalysis} disabled={!dedupFile || isAnalyzing}
                    className="w-full py-3.5 bg-purple-600 hover:bg-purple-500 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all">
                    {isAnalyzing ? '분석 중...' : <><GitMerge size={16} /> 중복 분석 시작</>}
                  </button>
                </div>
              )}

              {/* 결과 */}
              {dedupResult && (
                <>
                  {/* 요약 카드 */}
                  <div className="grid grid-cols-5 gap-2 mb-3">
                    {[
                      { label: '전체 행', val: dedupResult.totalRows, color: 'border-gray-700', tc: 'text-white' },
                      { label: '강한 중복', val: `${dedupResult.strongGroups.length}그룹`, color: 'border-red-800/40', tc: 'text-red-400' },
                      { label: '약한 중복', val: `${dedupResult.weakGroups.length}그룹`, color: 'border-yellow-800/40', tc: 'text-yellow-400' },
                      { label: '특이사항없음', val: `${dedupResult.noNoteRows?.length ?? 0}건`, color: 'border-orange-800/40', tc: 'text-orange-400' },
                      { label: '삭제 예정', val: `${deleteRowNums.size}건`, color: 'border-purple-800/40', tc: 'text-purple-400' },
                    ].map(c => (
                      <div key={c.label} className={`bg-black/40 border ${c.color} rounded-xl p-3 text-center`}>
                        <div className={`text-xl font-black ${c.tc}`}>{c.val}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* 서브탭 */}
                  {!hasDedup ? (
                    <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-500 text-sm font-bold">
                      중복 데이터가 없습니다 🎉
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2 mb-3 flex-wrap">
                        <button onClick={() => setDedupSubTab('strong')}
                          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${dedupSubTab === 'strong' ? 'bg-red-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                          강한 중복 ({dedupResult.strongGroups.length})
                        </button>
                        <button onClick={() => setDedupSubTab('weak')}
                          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${dedupSubTab === 'weak' ? 'bg-yellow-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                          약한 중복 ({dedupResult.weakGroups.length})
                        </button>
                        <button onClick={() => setDedupSubTab('nonote')}
                          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${dedupSubTab === 'nonote' ? 'bg-orange-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                          특이사항 없음 ({dedupResult.noNoteRows?.length ?? 0})
                        </button>
                      </div>

                      {/* 그룹/행 목록 */}
                      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                        {dedupSubTab === 'nonote' ? (
                          (dedupResult.noNoteRows?.length ?? 0) === 0 ? (
                            <div className="h-20 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-600 text-xs font-bold">
                              특이사항 없는 행이 없습니다 🎉
                            </div>
                          ) : (
                            <div className="border border-gray-800 rounded-xl overflow-hidden">
                              <div className="px-3 py-2 bg-orange-950/30 flex items-center justify-between">
                                <span className="text-xs font-bold text-orange-300">특이사항 없는 행 — {dedupResult.noNoteRows.length}건 (중복 제외)</span>
                                <button
                                  onClick={() => {
                                    const allChecked = dedupResult.noNoteRows.every(r => deleteRowNums.has(r._rowNum));
                                    setDeleteRowNums(prev => {
                                      const next = new Set(prev);
                                      dedupResult.noNoteRows.forEach(r => allChecked ? next.delete(r._rowNum) : next.add(r._rowNum));
                                      return next;
                                    });
                                  }}
                                  className="text-[10px] font-bold px-2 py-0.5 rounded text-orange-400 hover:text-orange-300 transition-colors"
                                >
                                  {dedupResult.noNoteRows.every(r => deleteRowNums.has(r._rowNum)) ? '전체 해제' : '전체 선택'}
                                </button>
                              </div>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-gray-800 bg-black/20 text-gray-500">
                                    <th className="px-3 py-2 w-16 text-center">삭제</th>
                                    <th className="px-3 py-2 w-10 text-left">행#</th>
                                    <th className="px-3 py-2 text-left">이름</th>
                                    <th className="px-3 py-2 text-left">생년월일</th>
                                    <th className="px-3 py-2 text-left">전화번호</th>
                                    <th className="px-3 py-2 text-left">행정동</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {dedupResult.noNoteRows.map(row => {
                                    const isChecked = deleteRowNums.has(row._rowNum);
                                    return (
                                      <tr key={row._rowNum} onClick={() => toggleRow(row._rowNum)}
                                        className={`border-b border-gray-900 cursor-pointer transition-colors
                                          ${isChecked ? 'bg-orange-950/25 hover:bg-orange-950/35' : 'bg-black/10 hover:bg-black/20'}`}>
                                        <td className="px-3 py-2 text-center">
                                          {isChecked
                                            ? <CheckSquare size={16} className="text-orange-400 mx-auto" />
                                            : <Square size={16} className="text-gray-600 mx-auto" />
                                          }
                                        </td>
                                        <td className="px-3 py-2 text-gray-500 font-mono">{row._rowNum}</td>
                                        <td className="px-3 py-2 text-white font-bold">{row.name}</td>
                                        <td className="px-3 py-2 text-gray-300">{row.birth}</td>
                                        <td className="px-3 py-2 text-gray-300">{fmtPhone(row.phone)}</td>
                                        <td className="px-3 py-2 text-gray-400">{row.dong}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )
                        ) : (dedupSubTab === 'strong' ? dedupResult.strongGroups : dedupResult.weakGroups).length === 0 ? (
                          <div className="h-20 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-600 text-xs font-bold">
                            {dedupSubTab === 'strong' ? '강한 중복 없음' : '약한 중복 없음'}
                          </div>
                        ) : (
                          (dedupSubTab === 'strong' ? dedupResult.strongGroups : dedupResult.weakGroups).map((group, gi) => {
                            const allNonKeepChecked = group.rows.every((r, i) => i === group.keepIdx || deleteRowNums.has(r._rowNum));
                            return (
                              <div key={gi} className="border border-gray-800 rounded-xl overflow-hidden">
                                {/* 그룹 헤더 */}
                                <div className={`px-3 py-2 flex items-center justify-between ${dedupSubTab === 'strong' ? 'bg-red-950/30' : 'bg-yellow-950/30'}`}>
                                  <span className="text-xs font-bold text-gray-300">
                                    그룹 {gi + 1} — <span className="text-white">{group.rows[0].name}</span>
                                    {group.rows[0].phone && <span className="text-gray-400"> | {fmtPhone(group.rows[0].phone)}</span>}
                                  </span>
                                  <button
                                    onClick={() => toggleGroup(group)}
                                    className={`text-[10px] font-bold px-2 py-0.5 rounded transition-colors ${allNonKeepChecked ? 'text-gray-400 hover:text-gray-200' : 'text-red-400 hover:text-red-300'}`}
                                  >
                                    {allNonKeepChecked ? '전체 해제' : '전체 선택'}
                                  </button>
                                </div>
                                {/* 행 테이블 */}
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-gray-800 bg-black/20 text-gray-500">
                                      <th className="px-3 py-2 w-16 text-center">삭제</th>
                                      <th className="px-3 py-2 w-10 text-left">행#</th>
                                      <th className="px-3 py-2 text-left">이름</th>
                                      <th className="px-3 py-2 text-left">생년월일</th>
                                      <th className="px-3 py-2 text-left">전화번호</th>
                                      <th className="px-3 py-2 text-left">행정동</th>
                                      <th className="px-3 py-2 text-left">특이사항</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.rows.map((row, ri) => {
                                      const isKeep = ri === group.keepIdx;
                                      const isChecked = deleteRowNums.has(row._rowNum);
                                      const hasNote = !!row.note;
                                      return (
                                        <tr key={row._rowNum} onClick={() => toggleRow(row._rowNum)}
                                          className={`border-b border-gray-900 cursor-pointer transition-colors
                                            ${isKeep ? 'bg-blue-950/20 hover:bg-blue-950/30' : isChecked ? 'bg-red-950/25 hover:bg-red-950/35' : 'bg-black/10 hover:bg-black/20'}`}>
                                          <td className="px-3 py-2 text-center">
                                            {isKeep
                                              ? <span className="text-xs bg-blue-900/50 text-blue-400 border border-blue-700/40 px-2 py-0.5 rounded font-bold">보존</span>
                                              : isChecked
                                                ? <CheckSquare size={16} className="text-red-400 mx-auto" />
                                                : <Square size={16} className="text-gray-600 mx-auto" />
                                            }
                                          </td>
                                          <td className="px-3 py-2 text-gray-500 font-mono">{row._rowNum}</td>
                                          <td className="px-3 py-2 text-white font-bold">{row.name}</td>
                                          <td className="px-3 py-2 text-gray-300">{row.birth}</td>
                                          <td className="px-3 py-2 text-gray-300">{fmtPhone(row.phone)}</td>
                                          <td className="px-3 py-2 text-gray-400">{row.dong}</td>
                                          <td className="px-3 py-2 max-w-[140px] truncate">
                                            {hasNote
                                              ? <span className="text-amber-300 font-medium" title={row.note}>{row.note}</span>
                                              : <span className="text-gray-700 text-xs">없음</span>
                                            }
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}

                  {/* 다운로드 */}
                  <div className="mt-3 pt-3 border-t border-gray-800">
                    <button onClick={exportDedup} disabled={deleteRowNums.size === 0 || isExporting}
                      className="w-full py-3 bg-[#3b82f6] hover:bg-[#93c5fd] text-black font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all text-sm">
                      {isExporting ? '처리 중...' : <><Download size={16} /> {deleteRowNums.size}건 삭제 후 다운로드 (정제본 + 삭제목록 시트)</>}
                    </button>
                  </div>
                </>
              )}
            </div>
  );
}
