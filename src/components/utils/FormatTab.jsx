// 'format' 탭 화면 — UtilsModal 에서 분리(2026-08-24 Phase 4-6).
//   UtilsModal 은 독립 도구들의 상자이고 탭끼리 상태를 공유하지 않는다(점검 실측) — 그래서 화면부터 뗀다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다(되돌리기 쉬움).
import { Palette, RefreshCw, Upload, Wand2 } from 'lucide-react';

export default function FormatTab({
  STYLE_PRESETS,
  fmtSize,
  formatFile,
  formatInfo,
  handleFormatUpload,
  isFormatAnalyzing,
  isFormatProcessing,
  resetFormat,
  runFormatExcel,
  selectedStyleId,
  setSelectedStyleId,
}) {
            const SAMPLE_HEADERS = ['이름', '주소', '포수', '행정동', '특이사항'];
            const SAMPLE_ROWS = [
              ['홍길동', '서울시 강남구 역삼동 123', '2', '역삼1동', '—'],
              ['김철수', '부산시 해운대구 우동 456', '3', '우1동', '3층'],
              ['이영희', '대구시 달서구 용산동 789', '1', '용산2동', '문앞'],
              ['박민수', '인천시 남동구 논현동 321', '4', '논현1동', '—'],
            ];
            const sel = STYLE_PRESETS.find(p => p.id === selectedStyleId) || STYLE_PRESETS[0];
            return (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2"><Palette size={18} className="text-purple-400"/> 스타일 서식 적용</h3>
                    <p className="text-xs text-gray-400 mt-0.5">데이터만 있는 엑셀에 10가지 프리미엄 서식을 입혀 완성도 높은 문서로 변환합니다.</p>
                  </div>
                  {formatFile && <button onClick={resetFormat} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"><RefreshCw size={12}/> 초기화</button>}
                </div>

                {/* File Upload */}
                <label className={`w-full py-4 border-2 border-dashed rounded-xl flex items-center justify-center gap-3 cursor-pointer transition-colors mb-4 ${formatFile ? 'border-purple-500 bg-purple-500/5' : 'border-gray-700 hover:border-gray-500 bg-black/40'}`}>
                  {isFormatAnalyzing ? (
                    <><RefreshCw size={18} className="text-purple-400 animate-spin"/><span className="text-purple-400 text-sm font-bold">분석 중...</span></>
                  ) : formatFile ? (
                    <><Palette size={18} className="text-purple-400"/>
                      <div><p className="text-purple-300 text-sm font-bold">{formatFile.name}</p>
                        <p className="text-gray-500 text-xs">{fmtSize(formatFile.size)}{formatInfo ? ` · ${formatInfo.sheets?.length || 1}개 시트 · ${(formatInfo.totalRows||0).toLocaleString()}행` : ''}</p>
                      </div>
                      <span className="ml-auto text-xs text-gray-500 pr-2">클릭하여 변경</span>
                    </>
                  ) : (
                    <><Upload size={18} className="text-gray-500"/><div className="text-center"><p className="text-gray-400 text-sm font-bold">엑셀 파일 선택</p><p className="text-gray-600 text-xs">.xlsx / .xls — 모든 시트에 서식 적용</p></div></>
                  )}
                  <input type="file" accept=".xlsx,.xls" onChange={handleFormatUpload} className="hidden"/>
                </label>

                {/* Main 2-column layout */}
                <div className="flex gap-4 flex-1 min-h-0">
                  {/* Left: Style cards */}
                  <div className="w-[270px] shrink-0 overflow-y-auto pr-1 space-y-1.5">
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">스타일 선택</p>
                    {STYLE_PRESETS.map(preset => (
                      <button key={preset.id} onClick={() => setSelectedStyleId(preset.id)}
                        className={`w-full flex items-stretch rounded-xl overflow-hidden transition-all border ${selectedStyleId === preset.id ? 'border-purple-500 shadow-lg shadow-purple-500/20' : 'border-gray-800 hover:border-gray-600'}`}>
                        {/* Color swatch strip */}
                        <div className="w-10 shrink-0 flex flex-col">
                          <div className="flex-1" style={{ background: preset.headerBg }}/>
                          <div className="flex-1" style={{ background: preset.evenBg || '#f0f0f0' }}/>
                          <div className="flex-1" style={{ background: preset.oddBg }}/>
                        </div>
                        {/* Info */}
                        <div className={`flex-1 px-3 py-2 text-left transition-colors ${selectedStyleId === preset.id ? 'bg-purple-950/40' : 'bg-gray-900 hover:bg-gray-800'}`}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-600 font-bold">#{preset.id}</span>
                            <span className={`text-xs font-bold ${selectedStyleId === preset.id ? 'text-purple-200' : 'text-gray-200'}`}>{preset.name}</span>
                            {selectedStyleId === preset.id && <span className="ml-auto text-purple-400 text-[10px] font-black">✓</span>}
                          </div>
                          <p className="text-[10px] text-gray-500 mt-0.5">{preset.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Right: Preview + Apply */}
                  <div className="flex-1 flex flex-col gap-3 min-w-0">
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">미리보기 — {sel.name}</p>
                    {/* CSS Preview Table */}
                    <div className="rounded-xl overflow-hidden border flex-1" style={{ borderColor: sel.border }}>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr>
                            {SAMPLE_HEADERS.map((h, i) => (
                              <th key={i} className="px-3 py-2 text-center font-bold whitespace-nowrap"
                                style={{ background: sel.headerBg, color: sel.headerFg, borderBottom: `2px solid ${sel.accent}`, fontSize: '11px' }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {SAMPLE_ROWS.map((row, ri) => (
                            <tr key={ri} style={{ background: ri % 2 === 0 ? sel.evenBg : sel.oddBg }}>
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-1.5 whitespace-nowrap truncate max-w-[120px]"
                                  style={{ borderBottom: `1px solid ${sel.border}`, color: '#1f2937', fontSize: '10px' }}>
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* Footer preview bar */}
                      <div className="h-6 flex items-center px-3 gap-2" style={{ background: sel.headerBg + '22' }}>
                        <div className="h-1.5 rounded-full flex-1" style={{ background: sel.accent + '40' }}/>
                        <div className="h-1.5 rounded-full w-12" style={{ background: sel.accent + '60' }}/>
                      </div>
                    </div>

                    {/* Style detail badges */}
                    <div className="flex gap-1.5 flex-wrap">
                      {[
                        { label: '헤더 고정', desc: '프리즈 파인' },
                        { label: '열폭 자동', desc: '콘텐츠 기반' },
                        { label: '교차 행', desc: '홀짝 채색' },
                        { label: '전체 시트', desc: '일괄 적용' },
                      ].map((b, i) => (
                        <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] border" style={{ borderColor: sel.border, color: sel.accent, background: sel.evenBg }}>
                          <span className="font-bold">{b.label}</span>
                          <span className="text-gray-500">· {b.desc}</span>
                        </div>
                      ))}
                    </div>

                    {/* Apply button */}
                    <button onClick={runFormatExcel} disabled={!formatFile || isFormatProcessing}
                      className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all disabled:opacity-40"
                      style={{ background: isFormatProcessing ? sel.headerBg + 'aa' : sel.headerBg, color: sel.headerFg }}>
                      {isFormatProcessing
                        ? <><RefreshCw size={15} className="animate-spin"/> 서식 적용 중...</>
                        : <><Wand2 size={15}/> [{sel.name}] 서식 적용 후 다운로드</>
                      }
                    </button>
                    {!formatFile && <p className="text-center text-xs text-gray-600">파일을 먼저 업로드하세요</p>}
                  </div>
                </div>
              </div>
            );
}
