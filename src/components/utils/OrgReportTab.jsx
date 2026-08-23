// 'orgReport' 탭 화면 — UtilsModal 에서 분리(2026-08-24 Phase 4-6).
//   UtilsModal 은 독립 도구들의 상자이고 탭끼리 상태를 공유하지 않는다(점검 실측) — 그래서 화면부터 뗀다.
//   ★상태·핸들러는 UtilsModal 에 그대로 있다. 여기는 받아서 그리기만 한다(되돌리기 쉬움).
import { Building2, Download, RefreshCw } from 'lucide-react';

export default function OrgReportTab({
  handleOrgRptCityChange,
  handleOrgRptExport,
  isAdmin,
  loadOrgRptAdminCities,
  orgRptCities,
  orgRptCity,
  orgRptExporting,
  orgRptLatestMonth,
  orgRptLoadingCities,
  orgRptLoadingMonth,
  user,
}) {
            const approvedCities = user?.citiesApproved || [];

            // 탭 진입 시 관리자 도시 목록 로드 (1회)
            if (isAdmin && orgRptCities.length === 0 && !orgRptLoadingCities) {
              loadOrgRptAdminCities();
            }

            const cityOptions = isAdmin
              ? orgRptCities
              : approvedCities.map(id => ({ id, lastMonthId: null }));

            return (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="mb-1">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Building2 size={18} className="text-blue-400" /> 소속사 전용 집계표
                  </h3>
                  <p className="text-sm text-gray-400 mt-1">
                    최근 등록된 월 명단 기준으로 소속사별 · 행정동별 집계표와 명단을 추출합니다.
                  </p>
                </div>

                <div className="mt-5 space-y-5">
                  {/* 지자체 선택 */}
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-2">지자체(시군구) 선택</label>
                    {!isAdmin && approvedCities.length === 0 ? (
                      <p className="text-sm text-yellow-400">승인된 지자체가 없습니다.</p>
                    ) : isAdmin && orgRptLoadingCities ? (
                      <div className="text-sm text-gray-500 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> 지자체 목록 로딩 중...</div>
                    ) : (
                      <select
                        value={orgRptCity}
                        onChange={e => handleOrgRptCityChange(e.target.value)}
                        className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500">
                        <option value="">-- 지자체 선택 --</option>
                        {cityOptions.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.id}{c.lastMonthId ? ` (${c.lastMonthId})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* 최신 월 정보 표시 */}
                  {orgRptCity && (
                    <div className="bg-[#0d0d0d] border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
                      {orgRptLoadingMonth ? (
                        <><RefreshCw size={14} className="animate-spin text-gray-500" /><span className="text-sm text-gray-500">월 정보 확인 중...</span></>
                      ) : orgRptLatestMonth ? (
                        <>
                          <span className="text-blue-400 font-black text-sm">📅 {orgRptLatestMonth.id}</span>
                          <span className="text-gray-500 text-xs">|</span>
                          <span className="text-white text-xs font-bold">{(orgRptLatestMonth.totalQty || 0).toLocaleString()}포</span>
                          <span className="text-amber-400 text-xs">수급자 {(orgRptLatestMonth.수급자Qty || 0).toLocaleString()}포</span>
                          <span className="text-blue-400 text-xs">차상위 {(orgRptLatestMonth.차상위Qty || 0).toLocaleString()}포</span>
                        </>
                      ) : (
                        <span className="text-yellow-400 text-sm">등록된 월 데이터가 없습니다.</span>
                      )}
                    </div>
                  )}

                  {/* 추출 안내 */}
                  {orgRptLatestMonth && (
                    <div className="bg-[#0d1117] border border-blue-900/40 rounded-xl p-4 space-y-1.5">
                      <p className="text-xs font-bold text-blue-300">📋 추출될 시트 구성</p>
                      <div className="text-xs text-gray-400 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block shrink-0" />
                          <span><b className="text-white">집계표 시트</b> — {isAdmin ? '소속사 × 행정동별' : '행정동별'} 수급자·차상위·전체 포수 집계</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500 inline-block shrink-0" />
                          <span><b className="text-white">명단 시트</b> — 소속사별 명단 (소속사 미설정 시 전체명단 1개)</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-600 mt-1">※ 소속사·행정동 배정은 메뉴 → 소속사 구역 설정에서 관리됩니다.</p>
                    </div>
                  )}

                  {/* 추출 버튼 */}
                  <button
                    onClick={handleOrgRptExport}
                    disabled={!orgRptCity || !orgRptLatestMonth || orgRptExporting}
                    className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 text-white font-black text-sm rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.99]">
                    {orgRptExporting
                      ? <><RefreshCw size={16} className="animate-spin" /> 집계 추출 중...</>
                      : <><Download size={16} /> 집계표 + 명단 다운로드</>}
                  </button>
                </div>
              </div>
            );
}
