// 'driverReport' 탭 화면 — UtilsModal 에서 분리(2026-08-24 Phase 4-6).
//   UtilsModal 은 독립 도구들의 상자이고 탭끼리 상태를 공유하지 않는다(점검 실측) — 그래서 화면부터 뗀다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다(되돌리기 쉬움).
import { Download, RefreshCw, Truck } from 'lucide-react';

export default function DriverReportTab({
  driverRptCities,
  driverRptCity,
  driverRptExporting,
  driverRptLoadingCities,
  driverRptLoadingMonths,
  driverRptMonth,
  driverRptMonths,
  handleDriverRptCityChange,
  handleDriverRptExport,
  setDriverRptMonth,
}) {
            const selectedMonthMeta = driverRptMonths.find(m => m.id === driverRptMonth);

            return (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="mb-1">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Truck size={18} className="text-emerald-400" /> 기사별 명단 다운로드
                  </h3>
                  <p className="text-sm text-gray-400 mt-1">
                    클라우드에 등록된 월별 명단을 선택해 기사별 전용 명단을 생성합니다. 같은 행정동을 여러 기사가 나눠 맡은 경우도 기사-행정동 시트로 분리됩니다.
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-[1.05fr_0.95fr] gap-5">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-2">등록된 명단 지자체</label>
                      {driverRptLoadingCities ? (
                        <div className="text-sm text-gray-500 flex items-center gap-2 h-12 px-4 rounded-xl border border-gray-800 bg-black/30">
                          <RefreshCw size={14} className="animate-spin" /> 지자체 목록 확인 중...
                        </div>
                      ) : (
                        <select
                          value={driverRptCity}
                          onChange={e => handleDriverRptCityChange(e.target.value)}
                          className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500">
                          <option value="">-- 지자체 선택 --</option>
                          {driverRptCities.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.id}{c.lastMonthId ? ` · 최신 ${c.lastMonthId}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-2">등록된 월별 명단</label>
                      {driverRptLoadingMonths ? (
                        <div className="text-sm text-gray-500 flex items-center gap-2 h-12 px-4 rounded-xl border border-gray-800 bg-black/30">
                          <RefreshCw size={14} className="animate-spin" /> 월별 명단 확인 중...
                        </div>
                      ) : (
                        <select
                          value={driverRptMonth}
                          onChange={e => setDriverRptMonth(e.target.value)}
                          disabled={!driverRptCity || driverRptMonths.length === 0}
                          className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50">
                          <option value="">-- 월 선택 --</option>
                          {driverRptMonths.map(m => (
                            <option key={m.id} value={m.id}>
                              {m.id} · {Number(m.totalQty || 0).toLocaleString()}포 / {Number(m.totalCount || 0).toLocaleString()}건
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {selectedMonthMeta && (
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: '전체', value: `${Number(selectedMonthMeta.totalQty || 0).toLocaleString()}포`, color: 'text-white' },
                          { label: '수급자', value: `${Number(selectedMonthMeta.수급자Qty || 0).toLocaleString()}포`, color: 'text-amber-300' },
                          { label: '차상위', value: `${Number(selectedMonthMeta.차상위Qty || 0).toLocaleString()}포`, color: 'text-blue-300' },
                          { label: '건수', value: `${Number(selectedMonthMeta.totalCount || 0).toLocaleString()}건`, color: 'text-emerald-300' },
                        ].map(item => (
                          <div key={item.label} className="bg-black/35 border border-gray-800 rounded-xl p-3">
                            <div className={`text-sm font-black ${item.color}`}>{item.value}</div>
                            <div className="text-[10px] text-gray-600 mt-1">{item.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-[#07110f] border border-emerald-900/40 rounded-2xl p-4 flex flex-col justify-between">
                    <div>
                      <p className="text-xs font-black text-emerald-300 mb-3">생성되는 엑셀 구성</p>
                      <div className="space-y-2 text-xs text-gray-400">
                        <div className="flex gap-2">
                          <span className="mt-1 w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                          <span><b className="text-white">요약표</b> — 기사, 행정동, 수급자 포, 차상위 포, 합계, 건수와 전체 합계</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="mt-1 w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                          <span><b className="text-white">전체명단</b> — 기사명 순으로 정렬된 전체 배송 명단</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="mt-1 w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                          <span><b className="text-white">기사-행정동 시트</b> — 기사별로 실제 배정된 행정동 단위 명단 분리</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-600 mt-4 leading-relaxed">
                        등록 기사 목록의 배정 행정동도 요약표에 반영합니다. 명단에만 존재하는 기사명도 누락하지 않고 포함합니다.
                      </p>
                    </div>

                    <button
                      onClick={handleDriverRptExport}
                      disabled={!driverRptCity || !driverRptMonth || driverRptExporting}
                      className="mt-5 w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-black text-sm rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.99]">
                      {driverRptExporting
                        ? <><RefreshCw size={16} className="animate-spin" /> 기사별 명단 생성 중...</>
                        : <><Download size={16} /> 기사별 명단 다운로드</>
                      }
                    </button>
                  </div>
                </div>
              </div>
            );
}
