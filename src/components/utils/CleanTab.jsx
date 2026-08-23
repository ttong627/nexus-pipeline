// 'clean' 탭 화면 — UtilsModal 에서 분리(2026-08-24 Phase 4-6).
//   UtilsModal 은 독립 도구들의 상자이고 탭끼리 상태를 공유하지 않는다(점검 실측) — 그래서 화면부터 뗀다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다(되돌리기 쉬움).
import { Download, FileX, Sparkles, Upload } from 'lucide-react';

export default function CleanTab({
  cleanFile,
  cleanResult,
  exportClean,
  fmtSize,
  handleCleanUpload,
  isAnalyzingClean,
  isExportingClean,
  resetClean,
  runCleanAnalysis,
}) {
  return (
            <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><Sparkles size={18} className="text-blue-400" /> 찌꺼기 데이터 삭제</h3>
                {cleanResult && <button onClick={resetClean} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>}
              </div>
              <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                빈 행, 유령 열, 숨겨진 행/열, 빈 시트를 제거하여 파일 크기를 최소화합니다.
              </p>

              {/* 업로드 */}
              {!cleanResult && (
                <div className="space-y-4">
                  <label className={`w-full py-7 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${cleanFile ? 'border-blue-500 bg-blue-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                    <Upload size={28} className={cleanFile ? 'text-blue-400 mb-2' : 'text-gray-500 mb-2'} />
                    <span className={`font-bold text-sm ${cleanFile ? 'text-blue-400' : 'text-gray-400'}`}>
                      {cleanFile ? cleanFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                    </span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleCleanUpload} className="hidden" />
                  </label>
                  <button onClick={runCleanAnalysis} disabled={!cleanFile || isAnalyzingClean}
                    className="w-full py-3.5 bg-blue-700 hover:bg-blue-600 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all">
                    {isAnalyzingClean ? '분석 중...' : <><Sparkles size={16} /> 찌꺼기 분석 시작</>}
                  </button>
                </div>
              )}

              {/* 분석 결과 */}
              {cleanResult && (
                <>
                  {/* Before / After 카드 */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-red-950/20 border border-red-800/40 rounded-xl p-4 text-center">
                      <div className="text-xs text-red-400 font-black mb-1">원본 파일 크기</div>
                      <div className="text-2xl font-black text-red-300">{fmtSize(cleanResult.originalSize)}</div>
                    </div>
                    <div className="bg-blue-950/20 border border-blue-800/40 rounded-xl p-4 text-center">
                      <div className="text-xs text-blue-400 font-black mb-1">정제 후 예상 크기</div>
                      <div className="text-2xl font-black text-blue-300">크게 감소 ↓</div>
                    </div>
                  </div>

                  {/* 제거 항목 요약 */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                      { label: '빈 행', val: cleanResult.totalEmptyRows, icon: '🗑', color: 'text-red-400', border: 'border-red-800/40' },
                      { label: '유령 열', val: cleanResult.totalGhostCols, icon: '👻', color: 'text-orange-400', border: 'border-orange-800/40' },
                      { label: '숨김 행', val: cleanResult.totalHiddenRows, icon: '🙈', color: 'text-yellow-400', border: 'border-yellow-800/40' },
                      { label: '숨김 열', val: cleanResult.totalHiddenCols, icon: '🙈', color: 'text-yellow-400', border: 'border-yellow-800/40' },
                      { label: '빈 시트', val: cleanResult.emptySheets, icon: '📄', color: 'text-gray-400', border: 'border-gray-700' },
                      { label: '처리 시트', val: cleanResult.sheets?.length ?? 0, icon: '📊', color: 'text-blue-400', border: 'border-blue-800/40' },
                    ].map(c => (
                      <div key={c.label} className={`bg-black/40 border ${c.border} rounded-xl p-2.5 text-center`}>
                        <div className={`text-lg font-black ${c.color}`}>{c.val}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{c.icon} {c.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* 시트별 상세 */}
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 mb-3">
                    {cleanResult.sheets?.map((s, i) => (
                      <div key={i} className={`border rounded-xl p-3 ${s.isEmptySheet ? 'border-red-800/40 bg-red-950/10' : 'border-gray-800 bg-black/20'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-white flex items-center gap-2">
                            {s.isEmptySheet ? <FileX size={14} className="text-red-400" /> : <Sparkles size={14} className="text-blue-400" />}
                            {s.sheetName}
                            {s.isEmptySheet && <span className="text-[10px] text-red-400 font-black bg-red-900/30 px-1.5 py-0.5 rounded">빈 시트 — 삭제됨</span>}
                          </span>
                          <span className="text-xs text-gray-500">{s.totalRows}행</span>
                        </div>
                        {!s.isEmptySheet && (
                          <div className="flex gap-3 mt-2 flex-wrap">
                            {s.innerEmptyRows > 0 && <span className="text-[10px] text-red-400">빈 행 {s.innerEmptyRows}개</span>}
                            {s.trailingRows > 0 && <span className="text-[10px] text-orange-400">트레일링 {s.trailingRows}행</span>}
                            {s.ghostCols > 0 && <span className="text-[10px] text-yellow-400">유령 열 {s.ghostCols}개</span>}
                            {s.hiddenRows > 0 && <span className="text-[10px] text-gray-400">숨김 행 {s.hiddenRows}개</span>}
                            {s.hiddenCols > 0 && <span className="text-[10px] text-gray-400">숨김 열 {s.hiddenCols}개</span>}
                            {s.innerEmptyRows === 0 && s.trailingRows === 0 && s.ghostCols === 0 && s.hiddenRows === 0 && s.hiddenCols === 0 &&
                              <span className="text-[10px] text-blue-400">찌꺼기 없음 ✓</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* 다운로드 */}
                  <div className="pt-3 border-t border-gray-800">
                    <button onClick={exportClean} disabled={isExportingClean}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all text-sm">
                      {isExportingClean ? '처리 중...' : <><Download size={16} /> 찌꺼기 제거 후 다운로드</>}
                    </button>
                  </div>
                </>
              )}
            </div>
  );
}
