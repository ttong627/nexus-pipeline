// 'dong' 탭 화면 — UtilsModal 에서 분리(2026-08-24 Phase 4-6).
//   UtilsModal 은 독립 도구들의 상자이고 탭끼리 상태를 공유하지 않는다(점검 실측) — 그래서 화면부터 뗀다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다(되돌리기 쉬움).
import { Download, RefreshCw, SplitSquareHorizontal, Upload } from 'lucide-react';

export default function DongTab({
  dongFile,
  dongFileName,
  dongOptions,
  dongResult,
  exportDongSplit,
  handleDongUpload,
  isAnalyzingDong,
  isExportingDong,
  resetDong,
  selectedColIdxs,
  setDongFileName,
  setDongOptions,
  setSelectedColIdxs,
  toggleColIdx,
}) {
  return (
            <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <SplitSquareHorizontal size={18} className="text-teal-400" /> 행정동별 분리 내보내기
                </h3>
                {dongResult && <button onClick={resetDong} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>}
              </div>
              <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                엑셀 파일을 업로드하면 <span className="text-teal-400 font-bold">행정동별 시트</span>로 분리된 파일을 자동 생성합니다. 요약표·합본·구분 분리 옵션을 선택하세요.
              </p>

              {/* 업로드 */}
              {!dongResult && (
                <div className="space-y-4">
                  <label className={`w-full py-7 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${dongFile ? 'border-teal-500 bg-teal-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                    {isAnalyzingDong
                      ? <RefreshCw size={28} className="text-teal-400 mb-2 animate-spin" />
                      : <Upload size={28} className={dongFile ? 'text-teal-400 mb-2' : 'text-gray-500 mb-2'} />
                    }
                    <span className={`font-bold text-sm ${dongFile ? 'text-teal-400' : 'text-gray-400'}`}>
                      {isAnalyzingDong ? '분석 중...' : dongFile ? dongFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                    </span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleDongUpload} className="hidden" disabled={isAnalyzingDong} />
                  </label>
                </div>
              )}

              {/* 분석 결과 */}
              {dongResult && (
                <>
                  {/* 자동 감지 요약 */}
                  <div className="flex gap-2 mb-3 flex-wrap">
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-black border bg-black/40 border-teal-700/40 text-teal-400">
                      총 {dongResult.totalRows.toLocaleString()}건
                    </span>
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${dongResult.hasDong ? 'bg-black/40 border-blue-700/40 text-blue-400' : 'bg-red-950/30 border-red-700/40 text-red-400'}`}>
                      행정동 {dongResult.hasDong ? '✓ 감지됨' : '✗ 미감지'}
                    </span>
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${dongResult.hasGubun ? 'bg-black/40 border-blue-700/40 text-blue-400' : 'bg-black/40 border-gray-700 text-gray-600'}`}>
                      구분(수급/차상위) {dongResult.hasGubun ? '✓ 감지됨' : '미감지'}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-black border bg-black/40 border-gray-700 text-gray-500">
                      시트: {dongResult.sheetName}
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
                    {/* 행정동 분포 테이블 */}
                    <div className="border border-gray-800 rounded-xl overflow-hidden">
                      <div className="px-3 py-2 bg-teal-950/30 flex items-center justify-between">
                        <span className="text-xs font-black text-teal-300">행정동 분포 ({dongResult.dongStats.length}개 동)</span>
                        <span className="text-[10px] text-gray-600">
                          합계 수급자 {dongResult.dongStats.reduce((s,d)=>s+d.su명,0)}명 / 차상위 {dongResult.dongStats.reduce((s,d)=>s+d.cha명,0)}명
                        </span>
                      </div>
                      <div className="max-h-[180px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-[#0d0d0d]">
                            <tr className="border-b border-gray-800 text-gray-600">
                              <th className="px-3 py-1.5 text-left font-black">행정동</th>
                              <th className="px-3 py-1.5 text-right font-black text-blue-500">수급자(명)</th>
                              <th className="px-3 py-1.5 text-right font-black text-blue-400">수급자(포)</th>
                              <th className="px-3 py-1.5 text-right font-black text-amber-500">차상위(명)</th>
                              <th className="px-3 py-1.5 text-right font-black text-amber-400">차상위(포)</th>
                              <th className="px-3 py-1.5 text-right font-black text-teal-400">합계(명)</th>
                              <th className="px-3 py-1.5 text-right font-black text-teal-300">합계(포)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dongResult.dongStats.map(d => (
                              <tr key={d.dong} className="border-b border-gray-900 hover:bg-teal-950/10 transition-colors">
                                <td className="px-3 py-1.5 font-bold text-white">{d.dong}</td>
                                <td className="px-3 py-1.5 text-right text-blue-400">{d.su명.toLocaleString()}</td>
                                <td className="px-3 py-1.5 text-right text-blue-300">{d.su포.toLocaleString()}</td>
                                <td className="px-3 py-1.5 text-right text-amber-400">{d.cha명.toLocaleString()}</td>
                                <td className="px-3 py-1.5 text-right text-amber-300">{d.cha포.toLocaleString()}</td>
                                <td className="px-3 py-1.5 text-right font-black text-teal-400">{d.total명.toLocaleString()}</td>
                                <td className="px-3 py-1.5 text-right font-black text-teal-300">{d.total포.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* 컬럼 선택 */}
                    <div className="border border-gray-800 rounded-xl overflow-hidden">
                      <div className="px-3 py-2 bg-gray-900/50 flex items-center justify-between">
                        <span className="text-xs font-black text-gray-300">포함할 컬럼 선택 ({selectedColIdxs.length}/{dongResult.headers.length})</span>
                        <div className="flex gap-2">
                          <button onClick={() => setSelectedColIdxs(dongResult.headers.map((_, i) => i))} className="text-[10px] text-blue-400 hover:text-blue-300 font-bold transition-colors">전체 선택</button>
                          <button onClick={() => setSelectedColIdxs([])} className="text-[10px] text-gray-500 hover:text-gray-300 font-bold transition-colors">전체 해제</button>
                        </div>
                      </div>
                      <div className="p-3 flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto">
                        {dongResult.headers.map((h, i) => {
                          const isKey = Object.values(dongResult.colMap).includes(i);
                          const isSel = selectedColIdxs.includes(i);
                          return (
                            <button key={i} onClick={() => toggleColIdx(i)}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                                isSel
                                  ? isKey ? 'bg-teal-900/40 border-teal-600/50 text-teal-300' : 'bg-blue-900/30 border-blue-700/40 text-blue-400'
                                  : 'bg-black/30 border-gray-800 text-gray-600 hover:border-gray-600'
                              }`}
                            >
                              {isSel ? '✓ ' : ''}{h || `열${i+1}`}
                              {isKey && <span className="ml-1 text-[8px] opacity-60">●</span>}
                            </button>
                          );
                        })}
                      </div>
                      <p className="px-3 pb-2 text-[10px] text-gray-700">● 핵심 컬럼(자동 감지됨)</p>
                    </div>

                    {/* 옵션 */}
                    <div className="border border-gray-800 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-black text-gray-400 mb-2">내보내기 옵션</p>
                      {[
                        { key: 'includeSummary', label: '요약 시트 포함', desc: '행정동별 수급자/차상위/합계 집계표' },
                        { key: 'includeAll',     label: '합본 시트 포함', desc: '전체 명단을 하나의 시트로' },
                        { key: 'splitGubun',     label: '구분별 분리',    desc: '각 행정동 내에서 기초수급자/차상위 시트 분리' },
                        { key: 'sortRows',       label: '자동 정렬',      desc: '행정동 > 주소 > 이름 순으로 정렬' },
                      ].map(opt => (
                        <label key={opt.key} className="flex items-center gap-3 cursor-pointer group">
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${dongOptions[opt.key] ? 'bg-teal-500 border-teal-500' : 'border-gray-600 group-hover:border-gray-400'}`}
                            onClick={() => setDongOptions(p => ({ ...p, [opt.key]: !p[opt.key] }))}>
                            {dongOptions[opt.key] && <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                          </div>
                          <div>
                            <span className="text-xs font-bold text-white">{opt.label}</span>
                            <span className="text-[10px] text-gray-600 ml-2">{opt.desc}</span>
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* 파일명 */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-500">저장 파일 이름</label>
                      <input value={dongFileName} onChange={e => setDongFileName(e.target.value)}
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded-xl px-4 py-2 text-white outline-none focus:border-teal-500 font-bold text-sm" />
                    </div>
                  </div>

                  {/* 다운로드 */}
                  <div className="mt-3 pt-3 border-t border-gray-800 shrink-0">
                    <button onClick={exportDongSplit} disabled={isExportingDong || !selectedColIdxs.length || !dongResult.hasDong}
                      className="w-full py-3 bg-teal-600 hover:bg-teal-500 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all text-sm">
                      {isExportingDong
                        ? <><RefreshCw size={15} className="animate-spin" /> 생성 중...</>
                        : <><Download size={15} /> {dongResult.dongStats.length}개 행정동 분리 다운로드</>
                      }
                    </button>
                  </div>
                </>
              )}
            </div>
  );
}
