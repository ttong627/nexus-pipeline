import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../config/firebase.js';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { MapPin, X, Loader2, ChevronRight, Calendar, Database } from 'lucide-react';

export default function RouteQuickModal({ user, onClose, onConfirm }) {
  const isAdmin = user?.role === 'admin';
  const approvedCities = user?.citiesApproved || [];

  const [cityList, setCityList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        let cities;
        if (isAdmin) {
          const snap = await getDocsFromServer(collection(db, 'cloud_lists'));
          cities = snap.docs.map(d => d.id);
        } else {
          cities = approvedCities;
        }

        // 각 도시별 최신 월 병렬 조회
        const results = await Promise.all(
          cities.map(async city => {
            try {
              const snap = await getDocsFromServer(collection(db, 'cloud_lists', city, 'months'));
              const months = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => b.id.localeCompare(a.id));
              if (!months.length) return null;
              const latest = months[0];
              const sido = city.split(' ')[0] || city;
              const sigungu = city.slice(sido.length).trim() || city;
              return {
                city,
                sigungu,
                sido,
                latestMonthId: latest.id,
                totalCount: latest.totalCount || 0,
                suCount: latest['수급자Count'] || 0,
                chaCount: latest['차상위Count'] || 0,
              };
            } catch {
              return null;
            }
          })
        );

        setCityList(results.filter(Boolean).sort((a, b) => a.city.localeCompare(b.city, 'ko')));
      } catch (e) {
        console.error('지자체 목록 로드 실패:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 시/도별 그룹핑
  const grouped = useMemo(() => {
    const map = {};
    cityList.forEach(item => {
      if (!map[item.sido]) map[item.sido] = [];
      map[item.sido].push(item);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'ko'));
  }, [cityList]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#060c18] border border-[#3b82f6]/25 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.9),0_0_0_1px_rgba(59,130,246,0.1)] w-full max-w-2xl mx-4 flex flex-col"
        style={{ maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0f1a2e] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#3b82f6]/10 border border-[#3b82f6]/25 flex items-center justify-center">
              <MapPin size={14} className="text-[#3b82f6]" />
            </div>
            <span className="text-white font-black text-sm">기사 배정 / 루트맵</span>
            {!loading && cityList.length > 0 && (
              <span className="text-[11px] text-gray-600 font-medium">
                · 지자체 카드를 클릭하면 바로 시작됩니다
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 바디 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-500">
              <Loader2 size={22} className="animate-spin text-[#3b82f6]" />
              <span className="text-sm">배송명단 현황 불러오는 중...</span>
            </div>
          ) : cityList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-600">
              <Database size={28} className="opacity-30" />
              <span className="text-sm font-bold">업로드된 배송명단이 없습니다</span>
              <span className="text-xs text-gray-700">먼저 이번달 배송명단을 클라우드에 저장해주세요</span>
            </div>
          ) : (
            <div className="space-y-7">
              {grouped.map(([sido, items]) => (
                <div key={sido}>
                  {/* 광역시/도 구분선 */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[#0f1a2e]" />
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0f1a2e] border border-[#1a2e4a]">
                      <MapPin size={10} className="text-[#3b82f6]/60" />
                      <span className="text-[11px] font-black text-gray-400 tracking-wider">{sido}</span>
                    </div>
                    <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[#0f1a2e]" />
                  </div>

                  {/* 지자체 카드 그리드 */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {items.map(({ city, sigungu, latestMonthId, totalCount, suCount, chaCount }) => (
                      <button
                        key={city}
                        onClick={() => onConfirm(city, latestMonthId)}
                        className="flex flex-col gap-3 p-4 rounded-2xl border border-[#0f1a2e] text-left transition-all group"
                        style={{ background: '#060e1a' }}
                        onMouseEnter={e => {
                          e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)';
                          e.currentTarget.style.background = 'rgba(59,130,246,0.06)';
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 8px 24px rgba(59,130,246,0.12)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.borderColor = '';
                          e.currentTarget.style.background = '#060e1a';
                          e.currentTarget.style.transform = '';
                          e.currentTarget.style.boxShadow = '';
                        }}
                      >
                        {/* 지자체명 + 화살표 */}
                        <div className="flex items-center justify-between">
                          <span className="text-white font-black text-[15px] leading-tight">{sigungu}</span>
                          <div className="w-6 h-6 rounded-lg bg-[#3b82f6]/0 group-hover:bg-[#3b82f6]/15 border border-transparent group-hover:border-[#3b82f6]/30 flex items-center justify-center transition-all shrink-0">
                            <ChevronRight size={13} className="text-gray-600 group-hover:text-[#3b82f6] transition-colors" />
                          </div>
                        </div>

                        {/* 최신 월 + 건수 */}
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <Calendar size={10} className="text-gray-600" />
                            <span className="text-[11px] text-gray-500 font-bold">{latestMonthId}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {suCount > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-900/20 text-blue-400 font-bold border border-blue-800/20">
                                  수급 {suCount.toLocaleString()}
                                </span>
                              )}
                              {chaCount > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-purple-900/20 text-purple-400 font-bold border border-purple-800/20">
                                  차상위 {chaCount.toLocaleString()}
                                </span>
                              )}
                            </div>
                            <span className="text-[12px] font-black text-[#3b82f6]/80 tabular-nums">
                              {totalCount.toLocaleString()}건
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 푸터 */}
        {!loading && cityList.length > 0 && (
          <div className="shrink-0 px-6 py-3 border-t border-[#0f1a2e] flex items-center justify-between">
            <span className="text-[11px] text-gray-600">
              총 <span className="text-gray-400 font-bold">{cityList.length}</span>개 지자체 · 최신 배송월 자동 선택
            </span>
            <button
              onClick={onClose}
              className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors font-bold"
            >
              취소
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
