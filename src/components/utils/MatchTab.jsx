// 'match' 탭 화면 — UtilsModal 에서 분리(2026-08-24 Phase 4-6).
//   UtilsModal 은 독립 도구들의 상자이고 탭끼리 상태를 공유하지 않는다(점검 실측) — 그래서 화면부터 뗀다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다(되돌리기 쉬움).
import { AlertCircle, CheckSquare, ChevronRight, Download, RefreshCw, Shuffle, Square, Upload } from 'lucide-react';   // ※KeyMapSection 은 이 파일 안에서 정의하는 지역 컴포넌트다(아이콘 아님)

export default function MatchTab({
  downloadMatchResult,
  fmtSize,
  handleMatchSourceSheetChange,
  handleMatchSourceUpload,
  handleMatchTargetSheetChange,
  handleMatchTargetUpload,
  isMatchAnalyzingSource,
  isMatchAnalyzingTarget,
  isMatchRunning,
  matchResultBlob,
  matchSourceFile,
  matchSourceHeaders,
  matchSourceKeyMap,
  matchSourceResult,
  matchSourceSheet,
  matchStats,
  matchStep,
  matchTargetFile,
  matchTargetHeaders,
  matchTargetKeyMap,
  matchTargetResult,
  matchTargetSheet,
  matchTransplantCols,
  resetMatch,
  runDataMatch,
  setMatchSourceKeyMap,
  setMatchStep,
  setMatchTargetKeyMap,
  setMatchTransplantCols,
}) {
            const KEY_ROWS = [
              { key: 'name', label: '이름 (필수)', required: true },
              { key: 'birth', label: '생년월일', required: false },
              { key: 'phone', label: '휴대폰', required: false },
              { key: 'landline', label: '유선전화', required: false },
            ];
            const KeyMapSection = ({ headers, keyMap, setKeyMap, title }) => (
              <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800 space-y-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">{title}</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {KEY_ROWS.map(({ key, label, required }) => (
                    <div key={key}>
                      <label className="text-[11px] text-gray-500 mb-1 block">{label}</label>
                      <select value={keyMap[key]} onChange={e => setKeyMap(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                        className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1.5 outline-none hover:border-gray-600">
                        {!required && <option value={-1}>— 없음 —</option>}
                        {required && keyMap[key] === -1 && <option value={-1}>— 선택 필요 —</option>}
                        {headers.map((h, i) => <option key={i} value={i}>{h || `열${i+1}`}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
            return (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-bold text-white">DATA 매칭</h3>
                    <p className="text-xs text-gray-400 mt-0.5">두 파일을 이름/생년월일/전화번호로 매칭하여 데이터를 이식합니다.</p>
                  </div>
                  {matchStep > 1 && <button onClick={resetMatch} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"><RefreshCw size={12}/> 처음부터</button>}
                </div>

                {/* Step indicator */}
                <div className="flex items-center gap-1.5 mb-5">
                  {['대상 파일', '소스 파일', '결과 확인'].map((label, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-colors
                        ${matchStep === i+1 ? 'bg-blue-600 text-white' : matchStep > i+1 ? 'bg-blue-900/50 text-blue-400 border border-blue-700/30' : 'bg-gray-800 text-gray-600'}`}>
                        {matchStep > i+1 ? <CheckSquare size={10}/> : <span className="w-3 text-center">{i+1}</span>}
                        <span>{label}</span>
                      </div>
                      {i < 2 && <div className={`h-px w-4 ${matchStep > i+1 ? 'bg-blue-600' : 'bg-gray-700'}`}/>}
                    </div>
                  ))}
                </div>

                {/* ── STEP 1: 대상 파일 ── */}
                {matchStep === 1 && (
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                    <label className={`w-full py-6 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${matchTargetFile ? 'border-blue-500 bg-blue-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                      {isMatchAnalyzingTarget ? (
                        <><RefreshCw size={24} className="text-blue-400 animate-spin mb-2"/><span className="text-blue-400 text-sm font-bold">분석 중...</span></>
                      ) : matchTargetFile ? (
                        <><Upload size={22} className="text-blue-400 mb-2"/><span className="text-blue-400 text-sm font-bold">{matchTargetFile.name}</span><span className="text-gray-500 text-xs mt-1">{fmtSize(matchTargetFile.size)}</span></>
                      ) : (
                        <><Upload size={24} className="text-gray-500 mb-2"/><span className="text-gray-400 text-sm font-bold">대상(신규) 파일 선택</span><span className="text-gray-600 text-xs mt-1">데이터를 받을 파일 — .xlsx / .xls</span></>
                      )}
                      <input type="file" accept=".xlsx,.xls" onChange={handleMatchTargetUpload} className="hidden" disabled={isMatchAnalyzingTarget}/>
                    </label>

                    {matchTargetResult && (
                      <>
                        {matchTargetResult.sheets?.length > 1 && (
                          <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
                            <p className="text-xs text-gray-400 mb-2 font-bold uppercase tracking-wide">시트 선택</p>
                            <div className="flex flex-wrap gap-2">
                              {matchTargetResult.sheets.map(s => (
                                <button key={s.name} onClick={() => handleMatchTargetSheetChange(s.name)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${matchTargetSheet === s.name ? 'bg-blue-600/30 text-blue-300 border-blue-500/40' : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'}`}>
                                  {s.name} ({s.rowCount}행)
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <KeyMapSection headers={matchTargetHeaders} keyMap={matchTargetKeyMap} setKeyMap={setMatchTargetKeyMap} title="매칭 키 컬럼 설정 (대상 파일)"/>
                        <div className="bg-gray-900/30 rounded-xl p-3 border border-gray-800/50">
                          <p className="text-[11px] text-gray-500 mb-2 font-bold">컬럼 미리보기</p>
                          <div className="flex flex-wrap gap-1.5">
                            {matchTargetHeaders.map((h, i) => <span key={i} className="px-2 py-0.5 bg-gray-800 text-gray-300 text-[11px] rounded-md">{h || `열${i+1}`}</span>)}
                          </div>
                        </div>
                        <button onClick={() => setMatchStep(2)} disabled={matchTargetKeyMap.name < 0}
                          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
                          다음: 소스 파일 선택 <ChevronRight size={16}/>
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* ── STEP 2: 소스 파일 ── */}
                {matchStep === 2 && (
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                    <label className={`w-full py-6 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${matchSourceFile ? 'border-amber-500 bg-amber-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                      {isMatchAnalyzingSource ? (
                        <><RefreshCw size={24} className="text-amber-400 animate-spin mb-2"/><span className="text-amber-400 text-sm font-bold">분석 중...</span></>
                      ) : matchSourceFile ? (
                        <><Upload size={22} className="text-amber-400 mb-2"/><span className="text-amber-400 text-sm font-bold">{matchSourceFile.name}</span><span className="text-gray-500 text-xs mt-1">{fmtSize(matchSourceFile.size)}</span></>
                      ) : (
                        <><Upload size={24} className="text-gray-500 mb-2"/><span className="text-gray-400 text-sm font-bold">소스(이식) 파일 선택</span><span className="text-gray-600 text-xs mt-1">데이터를 가져올 파일 — .xlsx / .xls</span></>
                      )}
                      <input type="file" accept=".xlsx,.xls" onChange={handleMatchSourceUpload} className="hidden" disabled={isMatchAnalyzingSource}/>
                    </label>

                    {matchSourceResult && (
                      <>
                        {matchSourceResult.sheets?.length > 1 && (
                          <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
                            <p className="text-xs text-gray-400 mb-2 font-bold uppercase tracking-wide">시트 선택</p>
                            <div className="flex flex-wrap gap-2">
                              {matchSourceResult.sheets.map(s => (
                                <button key={s.name} onClick={() => handleMatchSourceSheetChange(s.name)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${matchSourceSheet === s.name ? 'bg-amber-600/30 text-amber-300 border-amber-500/40' : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'}`}>
                                  {s.name} ({s.rowCount}행)
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <KeyMapSection headers={matchSourceHeaders} keyMap={matchSourceKeyMap} setKeyMap={setMatchSourceKeyMap} title="매칭 키 컬럼 설정 (소스 파일)"/>

                        {/* 이식 컬럼 선택 */}
                        <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
                          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">이식할 컬럼 선택 <span className="text-blue-400 ml-1">{matchTransplantCols.filter(c=>c.enabled).length}개 선택</span></p>
                            <div className="flex gap-3">
                              <button onClick={() => setMatchTransplantCols(prev => prev.map(c => ({...c, enabled: true})))} className="text-[11px] text-blue-400 hover:text-blue-300">전체선택</button>
                              <button onClick={() => setMatchTransplantCols(prev => prev.map(c => ({...c, enabled: false})))} className="text-[11px] text-gray-500 hover:text-gray-400">전체해제</button>
                            </div>
                          </div>
                          <div className="max-h-52 overflow-y-auto">
                            {matchTransplantCols.map((col, i) => (
                              <div key={i} className={`flex items-center gap-2.5 px-4 py-2 border-b border-gray-800/40 transition-colors ${col.enabled ? 'bg-gray-800/20' : 'hover:bg-gray-800/10'}`}>
                                <button onClick={() => setMatchTransplantCols(prev => prev.map((c, ci) => ci===i ? {...c, enabled: !c.enabled} : c))}
                                  className="shrink-0">
                                  {col.enabled ? <CheckSquare size={14} className="text-blue-400"/> : <Square size={14} className="text-gray-600"/>}
                                </button>
                                <span className={`text-xs flex-1 truncate ${col.enabled ? 'text-white' : 'text-gray-500'}`}>{col.srcLabel}</span>
                                {col.enabled && (
                                  <>
                                    <ChevronRight size={11} className="text-gray-600 shrink-0"/>
                                    <select value={col.tgtIdx} onChange={e => setMatchTransplantCols(prev => prev.map((c,ci)=>ci===i?{...c,tgtIdx:Number(e.target.value)}:c))}
                                      className="bg-gray-800 border border-gray-700 text-[11px] text-white rounded-lg px-2 py-1 outline-none max-w-[140px]">
                                      <option value={-1}>새 컬럼 추가</option>
                                      {matchTargetHeaders.map((h, hi) => <option key={hi} value={hi}>{h||`열${hi+1}`}</option>)}
                                    </select>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="bg-blue-950/30 rounded-xl p-3 border border-blue-800/30 flex gap-2 text-xs text-blue-300">
                          <AlertCircle size={14} className="shrink-0 mt-0.5"/>
                          <span>매칭 우선순위: <strong>이름+생년월일</strong> → <strong>이름+휴대폰</strong> → <strong>이름+유선전화</strong> 순으로 매칭합니다.</span>
                        </div>

                        <button onClick={runDataMatch} disabled={isMatchRunning || matchTransplantCols.filter(c=>c.enabled).length===0 || matchSourceKeyMap.name<0}
                          className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
                          {isMatchRunning ? <><RefreshCw size={14} className="animate-spin"/> 매칭 실행 중...</> : <><Shuffle size={14}/> 매칭 실행</>}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* ── STEP 3: 결과 ── */}
                {matchStep === 3 && matchStats && (
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-center">
                        <p className="text-2xl font-black text-white">{matchStats.total.toLocaleString()}</p>
                        <p className="text-xs text-gray-500 mt-1">전체 건수</p>
                      </div>
                      <div className="bg-emerald-950/50 rounded-xl p-4 border border-emerald-800/40 text-center">
                        <p className="text-2xl font-black text-emerald-400">{matchStats.matched.toLocaleString()}</p>
                        <p className="text-xs text-emerald-600 mt-1">매칭 성공</p>
                      </div>
                      <div className="bg-red-950/30 rounded-xl p-4 border border-red-800/30 text-center">
                        <p className="text-2xl font-black text-red-400">{(matchStats.total - matchStats.matched).toLocaleString()}</p>
                        <p className="text-xs text-red-700 mt-1">미매칭</p>
                      </div>
                    </div>

                    <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${matchStats.total > 0 ? (matchStats.matched/matchStats.total*100) : 0}%` }}/>
                        </div>
                        <span className="text-sm font-bold text-emerald-400">{matchStats.total > 0 ? (matchStats.matched/matchStats.total*100).toFixed(1) : 0}%</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>이식 컬럼: {matchTransplantCols.filter(c=>c.enabled).map(c=>c.srcLabel).join(', ')}</span>
                      </div>
                    </div>

                    <div className="bg-blue-950/20 rounded-xl p-3 border border-blue-800/20 text-xs text-blue-300">
                      출력 파일: <strong>매칭결과</strong> 시트(전체) + <strong>미매칭목록</strong> 시트(미매칭만) — 마지막 열에 매칭 방식 표시
                    </div>

                    <button onClick={downloadMatchResult}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
                      <Download size={16}/> {matchResultBlob?.fileName || '결과 다운로드'}
                    </button>

                    <button onClick={resetMatch} className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs font-bold rounded-xl transition-colors">
                      새 매칭 시작
                    </button>
                  </div>
                )}
              </div>
            );
}
