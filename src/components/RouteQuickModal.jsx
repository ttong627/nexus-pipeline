import { useState, useEffect, useMemo } from 'react';
import { db } from '../config/firebase.js';
import { collection, getDocsFromServer, deleteDoc, doc } from 'firebase/firestore';
import { MapPin, X, Loader2, ChevronRight, Calendar, Database, History, CheckCircle2, Clock, Users, Package, Trash2, Globe, Layers } from 'lucide-react';

export default function RouteQuickModal({ user, onClose, onConfirm, onOpenSession }) {
  const isAdmin = user?.role === 'admin';
  const approvedCities = user?.citiesApproved || [];

  const [activeTab, setActiveTab] = useState('new');
  const [cityList, setCityList] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [deletingKey, setDeletingKey] = useState(null); // 삭제 중인 세션 key

  // 새 배정: cloud_lists 기준 지자체 목록
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
                city, sigungu, sido,
                latestMonthId: latest.id,
                totalCount: latest.totalCount || 0,
                suCount: latest['수급자Count'] || 0,
                chaCount: latest['차상위Count'] || 0,
              };
            } catch { return null; }
          })
        );
        setCityList(results.filter(Boolean).sort((a, b) => a.city.localeCompare(b.city, 'ko')));
      } catch (e) {
        console.error('지자체 목록 로드 실패:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- 최초 진입 시 한 번만 초기화한다

  // 저장된 내역: route_sessions 기준
  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      let cities;
      if (isAdmin) {
        const snap = await getDocsFromServer(collection(db, 'cloud_lists'));
        cities = snap.docs.map(d => d.id);
      } else {
        cities = approvedCities;
      }

      const allSessions = [];
      await Promise.all(
        cities.map(async city => {
          try {
            const snap = await getDocsFromServer(collection(db, 'route_sessions', city, 'months'));
            snap.docs.forEach(d => {
              allSessions.push({ city, monthId: d.id, ...d.data() });
            });
          } catch { /* 세션 없는 도시 무시 */ }
        })
      );

      allSessions.sort((a, b) => {
        const aTime = a.savedAt?.toMillis?.() || 0;
        const bTime = b.savedAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
      setSessions(allSessions);
    } catch (e) {
      console.error('루트 세션 로드 실패:', e);
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'saved') return;
    loadSessions();
  }, [activeTab]);   // eslint-disable-line react-hooks/exhaustive-deps -- 함수 신원이 매 렌더 바뀐다 — 넣으면 계속 다시 실행된다

  // 세션 삭제
  const handleDeleteSession = async (e, session) => {
    e.stopPropagation();
    const sigungu = session.city?.split(' ').slice(1).join(' ') || session.city;
    if (!window.confirm(`[${sigungu}] ${session.monthId} 루트 세션을 삭제하시겠습니까?\n\n기사 배정·배송순번 정보가 모두 사라집니다.`)) return;
    const key = `${session.city}_${session.monthId}`;
    setDeletingKey(key);
    try {
      await deleteDoc(doc(db, 'route_sessions', session.city, 'months', session.monthId));
      setSessions(prev => prev.filter(s => !(s.city === session.city && s.monthId === session.monthId)));
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    } finally {
      setDeletingKey(null);
    }
  };

  // 새 배정 탭: 시/도별 그룹핑
  const grouped = useMemo(() => {
    const map = {};
    cityList.forEach(item => {
      if (!map[item.sido]) map[item.sido] = [];
      map[item.sido].push(item);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'ko'));
  }, [cityList]);

  // 저장된 내역: 도시별 그룹핑
  const groupedSessions = useMemo(() => {
    const map = {};
    sessions.forEach(s => {
      const sido = s.city?.split(' ')[0] || '기타';
      if (!map[sido]) map[sido] = [];
      map[sido].push(s);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'ko'));
  }, [sessions]);

  const formatSavedAt = (savedAt) => {
    if (!savedAt) return '날짜 미상';
    const d = savedAt.toDate?.() || new Date(savedAt);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${hh}:${mm}`;
  };

  // selectedDongs → 표시 텍스트
  const getDongLabel = (selectedDongs) => {
    if (!selectedDongs || selectedDongs.length === 0) return null; // 전체
    if (selectedDongs.length <= 3) return selectedDongs.join(', ');
    return `${selectedDongs[0]} 외 ${selectedDongs.length - 1}개 행정동`;
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#060c18] border border-[#3b82f6]/25 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.9),0_0_0_1px_rgba(59,130,246,0.1)] w-full max-w-2xl mx-4 flex flex-col"
        style={{ maxHeight: '82vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0f1a2e] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#3b82f6]/10 border border-[#3b82f6]/25 flex items-center justify-center">
              <MapPin size={14} className="text-[#3b82f6]" />
            </div>
            <span className="text-white font-black text-sm">기사 배정 / 루트맵</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 탭 */}
        <div className="flex shrink-0 px-6 pt-3 gap-2">
          <button
            onClick={() => setActiveTab('new')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-black transition-all border ${
              activeTab === 'new'
                ? 'bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30'
                : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            <MapPin size={12} />
            새 배정 시작
          </button>
          <button
            onClick={() => setActiveTab('saved')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-black transition-all border ${
              activeTab === 'saved'
                ? 'bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30'
                : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            <History size={12} />
            저장된 내역
            {sessions.length > 0 && (
              <span className="text-[9px] min-w-[16px] px-1 py-0.5 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] font-black text-center">{sessions.length}</span>
            )}
          </button>
        </div>

        {/* 바디 */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── 새 배정 시작 탭 ── */}
          {activeTab === 'new' && (
            loading ? (
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
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[#0f1a2e]" />
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0f1a2e] border border-[#1a2e4a]">
                        <MapPin size={10} className="text-[#3b82f6]/60" />
                        <span className="text-[11px] font-black text-gray-400 tracking-wider">{sido}</span>
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[#0f1a2e]" />
                    </div>
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
                          <div className="flex items-center justify-between">
                            <span className="text-white font-black text-[15px] leading-tight">{sigungu}</span>
                            <div className="w-6 h-6 rounded-lg group-hover:bg-[#3b82f6]/15 border border-transparent group-hover:border-[#3b82f6]/30 flex items-center justify-center transition-all shrink-0">
                              <ChevronRight size={13} className="text-gray-600 group-hover:text-[#3b82f6] transition-colors" />
                            </div>
                          </div>
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
            )
          )}

          {/* ── 저장된 내역 탭 ── */}
          {activeTab === 'saved' && (
            sessionsLoading ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-500">
                <Loader2 size={22} className="animate-spin text-[#3b82f6]" />
                <span className="text-sm">저장된 루트 내역 불러오는 중...</span>
              </div>
            ) : sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-600">
                <History size={28} className="opacity-30" />
                <span className="text-sm font-bold">저장된 루트 내역이 없습니다</span>
                <span className="text-xs text-gray-700">루트맵에서 배정을 완료한 후 저장하면 여기에 표시됩니다</span>
              </div>
            ) : (
              <div className="space-y-7">
                {groupedSessions.map(([sido, items]) => (
                  <div key={sido}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[#0f1a2e]" />
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0f1a2e] border border-[#1a2e4a]">
                        <MapPin size={10} className="text-[#3b82f6]/60" />
                        <span className="text-[11px] font-black text-gray-400 tracking-wider">{sido}</span>
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[#0f1a2e]" />
                    </div>

                    <div className="space-y-2">
                      {items.map((session, idx) => {
                        const sigungu = session.city?.split(' ').slice(1).join(' ') || session.city;
                        const isFinal = session.status === 'final';
                        const driverCount = Array.isArray(session.drivers) ? session.drivers.length : 0;
                        const assignedCount = session.assignedCount || 0;
                        const totalRecords = session.totalRecords || 0;
                        const dongLabel = getDongLabel(session.selectedDongs);
                        const sessionKey = `${session.city}_${session.monthId}`;
                        const isDeleting = deletingKey === sessionKey;
                        return (
                          <button
                            key={`${sessionKey}_${idx}`}
                            onClick={() => !isDeleting && onOpenSession?.(session.city, session.monthId, session.drivers)}
                            disabled={isDeleting}
                            className="w-full flex items-center gap-4 p-4 rounded-xl border border-[#0f1a2e] text-left transition-all group disabled:opacity-50"
                            style={{ background: '#060e1a' }}
                            onMouseEnter={e => {
                              if (isDeleting) return;
                              e.currentTarget.style.borderColor = isFinal ? 'rgba(34,197,94,0.4)' : 'rgba(59,130,246,0.4)';
                              e.currentTarget.style.background = isFinal ? 'rgba(34,197,94,0.04)' : 'rgba(59,130,246,0.05)';
                              e.currentTarget.style.boxShadow = isFinal ? '0 4px 16px rgba(34,197,94,0.08)' : '0 4px 16px rgba(59,130,246,0.10)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.borderColor = '';
                              e.currentTarget.style.background = '#060e1a';
                              e.currentTarget.style.boxShadow = '';
                            }}
                          >
                            {/* 상태 아이콘 */}
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isFinal ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-[#3b82f6]/10 border border-[#3b82f6]/20'}`}>
                              {isDeleting
                                ? <Loader2 size={15} className="animate-spin text-gray-500" />
                                : isFinal
                                ? <CheckCircle2 size={15} className="text-emerald-400" />
                                : <Clock size={15} className="text-[#3b82f6]" />
                              }
                            </div>

                            {/* 지자체 + 월 + 범위 */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <span className="text-white font-black text-sm">{sigungu}</span>
                                {/* 최종/임시 배지 */}
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${isFinal ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/15 text-amber-400 border border-amber-500/20'}`}>
                                  {isFinal ? '최종' : '임시'}
                                </span>
                                {/* 전체 / 행정동 구분 배지 */}
                                {dongLabel ? (
                                  <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-black bg-violet-500/10 text-violet-400 border border-violet-500/15 max-w-[160px] truncate" title={session.selectedDongs?.join(', ')}>
                                    <Layers size={8} className="shrink-0" />
                                    {dongLabel}
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-black bg-sky-500/10 text-sky-400 border border-sky-500/15">
                                    <Globe size={8} />
                                    전체
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                                <Calendar size={9} className="shrink-0" />
                                <span className="font-bold">{session.monthId}</span>
                                <span className="text-gray-700">·</span>
                                <Clock size={9} className="shrink-0" />
                                <span>{formatSavedAt(session.savedAt)}</span>
                              </div>
                            </div>

                            {/* 통계 */}
                            <div className="flex items-center gap-3 shrink-0">
                              {driverCount > 0 && (
                                <div className="flex items-center gap-1 text-[11px] text-gray-400">
                                  <Users size={11} className="text-gray-600" />
                                  <span className="font-bold">{driverCount}명</span>
                                </div>
                              )}
                              {totalRecords > 0 && (
                                <div className="flex items-center gap-1 text-[11px] text-gray-400">
                                  <Package size={11} className="text-gray-600" />
                                  <span className="font-bold tabular-nums">
                                    {assignedCount > 0 ? `${assignedCount}/` : ''}{totalRecords.toLocaleString()}
                                  </span>
                                </div>
                              )}
                              {/* 삭제 버튼 */}
                              <button
                                onClick={(e) => handleDeleteSession(e, session)}
                                disabled={isDeleting}
                                title="세션 삭제"
                                className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-700 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-0"
                              >
                                <Trash2 size={12} />
                              </button>
                              <ChevronRight size={13} className="text-gray-700 group-hover:text-[#3b82f6] transition-colors" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* 푸터 */}
        <div className="shrink-0 px-6 py-3 border-t border-[#0f1a2e] flex items-center justify-between">
          {activeTab === 'new' && !loading && cityList.length > 0 ? (
            <span className="text-[11px] text-gray-600">
              총 <span className="text-gray-400 font-bold">{cityList.length}</span>개 지자체 · 최신 배송월 자동 선택
            </span>
          ) : activeTab === 'saved' && !sessionsLoading && sessions.length > 0 ? (
            <span className="text-[11px] text-gray-600">
              총 <span className="text-gray-400 font-bold">{sessions.length}</span>개 저장된 루트 내역
            </span>
          ) : (
            <span />
          )}
          <button
            onClick={onClose}
            className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors font-bold"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
