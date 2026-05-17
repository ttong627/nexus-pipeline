import { useState, useEffect, useMemo } from 'react';
import { FileSpreadsheet, CheckCircle, Database, ChevronRight, Truck, BookOpen, Loader2, RefreshCw, Calendar } from 'lucide-react';
import { APP_VERSION } from '../version.js';
import { db } from '../config/firebase.js';
import { collection, getDocs, getDocsFromServer } from 'firebase/firestore';

const CursorSVG = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 1L3 17L7.5 13L10.5 20L13 19L10 12L16 12Z" fill="white" stroke="#3b82f6" strokeWidth="1.2" strokeLinejoin="round"/>
  </svg>
);

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function Dashboard({ user, onStart, onHelp, onCloudCard, onBaseCard }) {
  const totalRows = user?.totalRowsProcessed || 0;
  const totalFiles = user?.totalFilesProcessed || 0;
  const isAdmin = user?.role === 'admin';
  const approvedCities = user?.citiesApproved || [];

  const [cloudData, setCloudData] = useState([]);   // [{city, sigungu, sido, latestMonthId, totalCount, suCount, chaCount}]
  const [baseData, setBaseData] = useState([]);      // [{city, sigungu, sido, updatedAt}]
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      // ── cloud_lists: 배송명단 데이터 ──
      let cities;
      if (isAdmin) {
        const snap = await getDocs(collection(db, 'cloud_lists'));
        cities = snap.docs.map(d => d.id);
      } else {
        cities = approvedCities;
      }

      const cloudResults = await Promise.all(
        cities.map(async city => {
          try {
            const snap = await getDocs(collection(db, 'cloud_lists', city, 'months'));
            const months = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .sort((a, b) => b.id.localeCompare(a.id));
            if (!months.length) return null;
            const latest = months[0];
            const sido = city.split(' ')[0] || city;
            const sigungu = city.slice(sido.length).trim() || city;
            return {
              city, sigungu, sido,
              latestMonthId: latest.id,
              totalCount: latest.totalCount || 0,
              suCount: latest['수급자Count'] || 0,
              chaCount: latest['차상위Count'] || 0,
            };
          } catch { return null; }
        })
      );
      setCloudData(cloudResults.filter(Boolean).sort((a, b) => a.city.localeCompare(b.city, 'ko')));

      // ── base_lists: 기본명단 데이터 ──
      const parseCity = id => {
        const sido = id.split(' ')[0] || id;
        const sigungu = id.slice(sido.length).trim() || id;
        return { sido, sigungu };
      };

      if (isAdmin) {
        const baseSnap = await getDocs(collection(db, 'base_lists')).catch(() => ({ docs: [] }));
        const cityMap = {};
        baseSnap.docs.forEach(d => { cityMap[d.id] = { city: d.id, ...parseCity(d.id), updatedAt: d.data().updatedAt || null }; });
        setBaseData(Object.values(cityMap).sort((a, b) => a.city.localeCompare(b.city, 'ko')));
      } else {
        const results = await Promise.all(
          approvedCities.map(async city => {
            try {
              const baseSnap = await getDocs(collection(db, 'base_lists', city, 'records')).catch(() => null);
              if (!baseSnap || baseSnap.empty) return null;
              return { city, ...parseCity(city), updatedAt: null };
            } catch { return null; }
          })
        );
        setBaseData(results.filter(Boolean).sort((a, b) => a.city.localeCompare(b.city, 'ko')));
      }
    } catch (e) {
      console.error('대시보드 데이터 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // 시/도별 그룹핑
  const groupBySido = (list) => {
    const map = {};
    list.forEach(item => {
      if (!map[item.sido]) map[item.sido] = [];
      map[item.sido].push(item);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'ko'));
  };

  const cloudGrouped = useMemo(() => groupBySido(cloudData), [cloudData]);
  const baseGrouped = useMemo(() => groupBySido(baseData), [baseData]);

  return (
    <div className="flex-1 w-full h-full flex flex-col overflow-hidden bg-transparent">

      {/* ── 상단 헤더 바 ── */}
      <div className="shrink-0 flex items-center justify-between px-8 py-5 border-b border-[#0f1a2e]">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-black text-white flex items-center gap-2.5">
            NEXUS <span className="text-[#3b82f6]">PIPELINE</span>
            <span className="bg-[#3b82f6]/15 text-[#3b82f6] px-2 py-0.5 rounded text-[11px] tracking-widest border border-[#3b82f6]/30">{APP_VERSION}</span>
          </h1>
        </div>

        {/* 통계 + 버튼 */}
        <div className="flex items-center gap-3">
          {/* 통계 컴팩트 */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#060c18] border border-[#0f1a2e]">
              <Database size={12} className="text-[#3b82f6]" />
              <span className="text-gray-400 text-[11px] font-bold">누적</span>
              <span className="text-white text-[12px] font-black">{totalRows.toLocaleString()}</span>
              <span className="text-gray-600 text-[10px]">건</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#060c18] border border-[#0f1a2e]">
              <FileSpreadsheet size={12} className="text-[#3b82f6]" />
              <span className="text-gray-400 text-[11px] font-bold">파일</span>
              <span className="text-white text-[12px] font-black">{totalFiles.toLocaleString()}</span>
              <span className="text-gray-600 text-[10px]">개</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#060c18] border border-[#0f1a2e]">
              <CheckCircle size={12} className="text-[#3b82f6]" />
              <span className="text-gray-400 text-[11px] font-bold">정확도</span>
              <span className="text-[#3b82f6] text-[12px] font-black">{totalRows > 0 ? '99%+' : '-'}</span>
            </div>
          </div>

          {/* 파이프라인 가동 CTA */}
          <button
            onClick={() => onStart()}
            className="flex items-center gap-2 px-5 py-2 bg-[#3b82f6] text-black font-extrabold rounded-xl text-sm hover:bg-[#60a5fa] transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]"
          >
            <FileSpreadsheet size={15} />
            파이프라인 가동
            <ChevronRight size={14} />
          </button>

          {/* 도움말 */}
          <button
            onClick={onHelp}
            className="relative w-9 h-9 rounded-full bg-[#060c18] border border-[#3b82f6]/50 text-[#3b82f6] font-black text-base hover:bg-[#3b82f6]/20 transition-all"
            style={{ animation: 'help-pulse 2.5s ease-in-out infinite' }}
          >
            <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <CursorSVG />
            </span>
            <span className="sr-only">도움말</span>
          </button>
        </div>
      </div>

      {/* ── DB 현황 카드 영역 ── */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-8">

        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500">
            <Loader2 size={24} className="animate-spin text-[#3b82f6]" />
            <span className="text-sm">등록 현황 불러오는 중...</span>
          </div>
        ) : (
          <>
            {/* ── 이번달 배송명단 ── */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[#3b82f6]/10 border border-[#3b82f6]/25 flex items-center justify-center">
                    <Truck size={14} className="text-[#3b82f6]" />
                  </div>
                  <span className="text-white font-black text-sm">이번달 배송명단</span>
                  {cloudData.length > 0 && (
                    <span className="text-[11px] text-gray-600 font-medium">
                      {cloudData.length}개 지자체 등록됨
                    </span>
                  )}
                </div>
                <button
                  onClick={loadData}
                  className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
                >
                  <RefreshCw size={11} /> 새로고침
                </button>
              </div>

              {cloudData.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-4 rounded-2xl border border-dashed border-[#0f1a2e] text-gray-600 text-sm">
                  <Truck size={16} className="opacity-30" />
                  <span>등록된 배송명단이 없습니다 · 파이프라인에서 클라우드 저장 후 나타납니다</span>
                </div>
              ) : (
                <div className="space-y-5">
                  {cloudGrouped.map(([sido, items]) => (
                    <div key={sido}>
                      {/* 광역시/도 구분선 */}
                      <div className="flex items-center gap-3 mb-3">
                        <div className="h-px flex-1 bg-[#0f1a2e]" />
                        <span className="text-[10px] font-black text-gray-600 tracking-widest px-2">{sido}</span>
                        <div className="h-px flex-1 bg-[#0f1a2e]" />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                        {items.map(({ city, sigungu, latestMonthId, totalCount, suCount, chaCount }) => (
                          <button
                            key={city}
                            onClick={() => onCloudCard && onCloudCard(city, latestMonthId)}
                            className="group flex flex-col gap-2.5 p-3.5 rounded-2xl border border-[#0f1a2e] text-left transition-all hover:border-[#3b82f6]/40 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(59,130,246,0.1)]"
                            style={{ background: '#060e1a' }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-white font-black text-[13px] group-hover:text-[#93c5fd] transition-colors truncate">{sigungu}</span>
                              <ChevronRight size={12} className="text-gray-700 group-hover:text-[#3b82f6] transition-colors shrink-0 ml-1" />
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar size={9} className="text-gray-700" />
                              <span className="text-[10px] text-gray-600 font-bold">{latestMonthId}</span>
                            </div>
                            <div className="flex items-end justify-between gap-1">
                              <div className="flex flex-wrap gap-1">
                                {suCount > 0 && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-blue-900/20 text-blue-400 font-bold border border-blue-800/20">
                                    수급 {suCount.toLocaleString()}
                                  </span>
                                )}
                                {chaCount > 0 && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-purple-900/20 text-purple-400 font-bold border border-purple-800/20">
                                    차상위 {chaCount.toLocaleString()}
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] font-black text-[#3b82f6]/70 tabular-nums shrink-0">{totalCount.toLocaleString()}건</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 기본명단 ── */}
            <section>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-lg bg-purple-900/20 border border-purple-800/25 flex items-center justify-center">
                  <BookOpen size={14} className="text-purple-400" />
                </div>
                <span className="text-white font-black text-sm">기본명단</span>
                {baseData.length > 0 && (
                  <span className="text-[11px] text-gray-600 font-medium">
                    {baseData.length}개 지자체 등록됨
                  </span>
                )}
              </div>

              {baseData.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-4 rounded-2xl border border-dashed border-[#0f1a2e] text-gray-600 text-sm">
                  <BookOpen size={16} className="opacity-30" />
                  <span>등록된 기본명단이 없습니다 · 고객 노트 관리에서 저장 후 나타납니다</span>
                </div>
              ) : (
                <div className="space-y-5">
                  {baseGrouped.map(([sido, items]) => (
                    <div key={sido}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="h-px flex-1 bg-[#0f1a2e]" />
                        <span className="text-[10px] font-black text-gray-600 tracking-widest px-2">{sido}</span>
                        <div className="h-px flex-1 bg-[#0f1a2e]" />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                        {items.map(({ city, sigungu, updatedAt }) => (
                          <button
                            key={city}
                            onClick={() => onBaseCard && onBaseCard(city)}
                            className="group flex flex-col gap-2.5 p-3.5 rounded-2xl border border-[#0f1a2e] text-left transition-all hover:border-purple-600/40 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(168,85,247,0.1)]"
                            style={{ background: '#080612' }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-white font-black text-[13px] group-hover:text-purple-300 transition-colors truncate">{sigungu}</span>
                              <ChevronRight size={12} className="text-gray-700 group-hover:text-purple-400 transition-colors shrink-0 ml-1" />
                            </div>
                            {updatedAt && (
                              <div className="flex items-center gap-1">
                                <RefreshCw size={9} className="text-gray-700" />
                                <span className="text-[10px] text-gray-600 font-bold">{fmtDate(updatedAt)} 업데이트</span>
                              </div>
                            )}
                            <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-purple-900/20 text-purple-400 font-bold border border-purple-800/20 self-start">
                              기본명단
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
