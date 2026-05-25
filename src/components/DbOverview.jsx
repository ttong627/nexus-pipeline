import { useState, useEffect } from 'react';
import {
  db, collection, getDocs, getCountFromServer, doc, getDoc,
} from '../config/firebase.js';
import {
  ArrowLeft, Database, Cloud, RefreshCw, ChevronDown, ChevronRight,
  ExternalLink, BarChart3, Calendar, Users, AlertCircle,
} from 'lucide-react';

const fmtTs = (ts) => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

export default function DbOverview({ onBack, onGoToBase, onGoToCloud }) {
  const [tab, setTab] = useState('base'); // 'base' | 'cloud'
  const [loading, setLoading] = useState(false);

  // 기본명단 데이터
  const [baseCities, setBaseCities] = useState([]); // [{ id, updatedAt, count, loading }]

  // 클라우드 명단 데이터
  const [cloudCities, setCloudCities] = useState([]); // [{ id, months: [], expanded }]
  const [loadingCloud, setLoadingCloud] = useState(false);

  useEffect(() => {
    if (tab === 'base') loadBase();
    else loadCloud();
  }, [tab]);

  // ── 기본명단 로드 ──────────────────────────────────────────────
  const loadBase = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'base_lists'));
      const cities = snap.docs
        .filter(d => !d.id.startsWith('__'))
        .map(d => ({ id: d.id, ...d.data(), count: null, countLoading: false }))
        .sort((a, b) => a.id.localeCompare(b.id, 'ko'));
      setBaseCities(cities);
      // 레코드 수 병렬 조회
      const withCounts = await Promise.all(
        cities.map(async (c) => {
          try {
            const snap = await getCountFromServer(collection(db, `base_lists/${c.id}/records`));
            return { ...c, count: snap.data().count };
          } catch {
            return { ...c, count: null };
          }
        })
      );
      setBaseCities(withCounts);
    } catch (e) {
      console.error('[DbOverview] loadBase:', e);
    } finally {
      setLoading(false);
    }
  };

  // ── 클라우드 명단 로드 ─────────────────────────────────────────
  const loadCloud = async () => {
    setLoadingCloud(true);
    try {
      // cloud_lists 상위 문서로 도시 목록 조회
      const citySnap = await getDocs(collection(db, 'cloud_lists'));
      let cityIds = citySnap.docs.filter(d => !d.id.startsWith('__')).map(d => d.id);

      // 레거시 데이터: 상위 문서 없이 서브컬렉션만 있는 경우 → base_lists에서 도시 목록 보완
      if (cityIds.length === 0) {
        const baseSnap = await getDocs(collection(db, 'base_lists'));
        cityIds = baseSnap.docs.filter(d => !d.id.startsWith('__')).map(d => d.id);
      } else {
        // 혹시 base_lists에만 있는 도시도 병합 (누락 방지)
        const baseSnap = await getDocs(collection(db, 'base_lists'));
        const baseIds = baseSnap.docs.filter(d => !d.id.startsWith('__')).map(d => d.id);
        const merged = new Set([...cityIds, ...baseIds]);
        cityIds = [...merged];
      }

      cityIds.sort((a, b) => a.localeCompare(b, 'ko'));

      const results = await Promise.all(
        cityIds.map(async (cityId) => {
          try {
            const monthSnap = await getDocs(collection(db, 'cloud_lists', cityId, 'months'));
            if (monthSnap.empty) return null;
            const months = monthSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .sort((a, b) => b.id.localeCompare(a.id));
            return { id: cityId, months, expanded: true };
          } catch { return null; }
        })
      );
      setCloudCities(results.filter(Boolean));
    } catch (e) {
      console.error('[DbOverview] loadCloud:', e);
    } finally {
      setLoadingCloud(false);
    }
  };

  const toggleExpand = (cityId) => {
    setCloudCities(prev => prev.map(c => c.id === cityId ? { ...c, expanded: !c.expanded } : c));
  };

  // ── 요약 통계 ──────────────────────────────────────────────────
  const baseTotalCount = baseCities.reduce((s, c) => s + (c.count || 0), 0);
  const cloudTotalCities = cloudCities.length;
  const cloudTotalMonths = cloudCities.reduce((s, c) => s + c.months.length, 0);
  const cloudTotalRecords = cloudCities.reduce((s, c) => s + c.months.reduce((ms, m) => ms + (m.totalCount || 0), 0), 0);

  return (
    <div className="absolute inset-0 bg-[#050505] flex flex-col">

      {/* ── HEADER ── */}
      <div className="h-14 shrink-0 bg-[#080808] border-b border-[#1a1a1a] flex items-center px-5 gap-3">
        <button onClick={onBack} className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2.5 flex-1">
          <BarChart3 size={17} className="text-violet-400 shrink-0" />
          <div>
            <h1 className="text-sm font-black text-white leading-tight">DB 현황 조회</h1>
            <p className="text-[10px] text-gray-600 leading-tight">전체 저장 데이터 · 지자체별 명단 확인 · 관리 화면 바로가기</p>
          </div>
        </div>
        <button
          onClick={() => tab === 'base' ? loadBase() : loadCloud()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 hover:bg-white/10 text-gray-400 border border-white/5 transition-colors"
        >
          <RefreshCw size={13} className={(loading || loadingCloud) ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>

      {/* ── TABS ── */}
      <div className="shrink-0 flex gap-0 border-b border-[#1a1a1a] bg-[#080808] px-5">
        <button
          onClick={() => setTab('base')}
          className={`px-5 py-3 text-xs font-black tracking-wide flex items-center gap-2 border-b-2 transition-all ${
            tab === 'base'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-600 hover:text-gray-400'
          }`}
        >
          <Database size={14} /> 기본명단
          {baseCities.length > 0 && (
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${tab === 'base' ? 'bg-blue-900/50 text-blue-400' : 'bg-white/5 text-gray-600'}`}>
              {baseCities.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('cloud')}
          className={`px-5 py-3 text-xs font-black tracking-wide flex items-center gap-2 border-b-2 transition-all ${
            tab === 'cloud'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-600 hover:text-gray-400'
          }`}
        >
          <Cloud size={14} /> 이번달 배송명단
          {cloudCities.length > 0 && (
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${tab === 'cloud' ? 'bg-blue-900/50 text-blue-400' : 'bg-white/5 text-gray-600'}`}>
              {cloudCities.length}
            </span>
          )}
        </button>
      </div>

      {/* ── CONTENT ── */}
      <div className="flex-1 overflow-auto">

        {/* ════ 기본명단 탭 ════ */}
        {tab === 'base' && (
          <div className="p-6 space-y-5">

            {/* 요약 카드 */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: '저장된 지자체', value: baseCities.length, color: 'text-blue-400', icon: <Database size={16} /> },
                { label: '전체 레코드 수', value: baseTotalCount.toLocaleString() + '건', color: 'text-white', icon: <Users size={16} /> },
                { label: '마지막 업데이트', value: baseCities.length > 0 ? fmtTs(baseCities.reduce((a, b) => (a.updatedAt?.seconds || 0) > (b.updatedAt?.seconds || 0) ? a : b).updatedAt) : '—', color: 'text-gray-300', icon: <Calendar size={16} /> },
              ].map((s, i) => (
                <div key={i} className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-900/20 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                    {s.icon}
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-600 font-bold tracking-wider uppercase mb-0.5">{s.label}</p>
                    <p className={`text-lg font-black ${s.color}`}>{s.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* 지자체 카드 그리드 */}
            {loading ? (
              <div className="flex items-center justify-center h-40 gap-2 text-emerald-400 text-sm animate-pulse">
                <Database size={18} /> 데이터 불러오는 중...
              </div>
            ) : baseCities.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-gray-700">
                <AlertCircle size={36} className="opacity-30" />
                <p className="text-sm">저장된 기본명단이 없습니다</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {baseCities.map(city => (
                  <div key={city.id} className="bg-[#0a0a0a] border border-[#1e1e1e] hover:border-blue-500/30 rounded-2xl p-5 flex flex-col gap-3 transition-all group">
                    {/* City header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                        <h3 className="text-sm font-black text-white leading-tight truncate">{city.id}</h3>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">레코드 수</span>
                        <span className={`font-black ${city.count !== null ? 'text-blue-400' : 'text-gray-700'}`}>
                          {city.count !== null ? city.count.toLocaleString() + '건' : '집계 중...'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">마지막 업데이트</span>
                        <span className="text-gray-400 font-bold">{fmtTs(city.updatedAt)}</span>
                      </div>
                      {city.author && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600">담당자</span>
                          <span className="text-gray-500 truncate max-w-[120px]">{city.author}</span>
                        </div>
                      )}
                    </div>

                    {/* Progress bar (relative to max) */}
                    {city.count !== null && baseTotalCount > 0 && (
                      <div className="w-full bg-[#1a1a1a] rounded-full h-1">
                        <div
                          className="bg-blue-500 h-1 rounded-full transition-all"
                          style={{ width: `${Math.max(2, Math.round((city.count / Math.max(...baseCities.map(c => c.count || 0))) * 100))}%` }}
                        />
                      </div>
                    )}

                    {/* Action button */}
                    <button
                      onClick={() => onGoToBase(city.id)}
                      className="w-full py-2 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-500/20 hover:border-blue-500/50 text-blue-400 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all"
                    >
                      <ExternalLink size={12} /> 기본명단 관리로 이동
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════ 클라우드 명단 탭 ════ */}
        {tab === 'cloud' && (
          <div className="p-6 space-y-5">

            {/* 요약 카드 */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: '저장된 지자체', value: cloudTotalCities, color: 'text-blue-400', icon: <Cloud size={16} /> },
                { label: '총 월 데이터', value: cloudTotalMonths + '개월', color: 'text-white', icon: <Calendar size={16} /> },
                { label: '전체 레코드 수', value: cloudTotalRecords.toLocaleString() + '건', color: 'text-blue-300', icon: <Users size={16} /> },
              ].map((s, i) => (
                <div key={i} className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-900/20 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                    {s.icon}
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-600 font-bold tracking-wider uppercase mb-0.5">{s.label}</p>
                    <p className={`text-lg font-black ${s.color}`}>{s.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* 지자체별 명단 */}
            {loadingCloud ? (
              <div className="flex items-center justify-center h-40 gap-2 text-blue-400 text-sm animate-pulse">
                <Cloud size={18} /> 데이터 불러오는 중...
              </div>
            ) : cloudCities.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-gray-700">
                <AlertCircle size={36} className="opacity-30" />
                <p className="text-sm">저장된 배송명단이 없습니다</p>
              </div>
            ) : (
              <div className="space-y-3">
                {cloudCities.map(city => {
                  const cityTotal = city.months.reduce((s, m) => s + (m.totalCount || 0), 0);
                  return (
                    <div key={city.id} className="bg-[#0a0a0a] border border-[#1e1e1e] hover:border-blue-500/20 rounded-2xl overflow-hidden transition-all">
                      {/* City header row */}
                      <div
                        className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-white/[0.02] transition-colors"
                        onClick={() => toggleExpand(city.id)}
                      >
                        <div className="flex items-center gap-3">
                          {city.expanded ? <ChevronDown size={15} className="text-blue-400 shrink-0" /> : <ChevronRight size={15} className="text-gray-600 shrink-0" />}
                          <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 shadow-[0_0_6px_rgba(59,130,246,0.8)]" />
                          <span className="text-sm font-black text-white">{city.id}</span>
                          <span className="text-[11px] text-gray-600">{city.months.length}개월 저장</span>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className="text-sm font-black text-blue-300">{cityTotal.toLocaleString()}건</span>
                          <button
                            onClick={e => { e.stopPropagation(); onGoToCloud(city.id); }}
                            className="px-3 py-1.5 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-500/20 hover:border-blue-500/50 text-blue-400 font-bold rounded-xl text-[11px] flex items-center gap-1.5 transition-all"
                          >
                            <ExternalLink size={11} /> 관리
                          </button>
                        </div>
                      </div>

                      {/* Month rows */}
                      {city.expanded && (
                        <div className="border-t border-[#1a1a1a]">
                          <div className="grid grid-cols-5 px-5 py-2 bg-[#0d0d0d] text-[10px] text-gray-700 font-bold uppercase tracking-wider">
                            <span>월</span>
                            <span className="text-center">전체</span>
                            <span className="text-center text-blue-700">수급자</span>
                            <span className="text-center text-amber-700">차상위</span>
                            <span className="text-center">업로드</span>
                          </div>
                          {city.months.map((m, idx) => (
                            <div
                              key={m.id}
                              className={`grid grid-cols-5 px-5 py-2.5 text-xs items-center ${idx % 2 === 0 ? 'bg-[#080808]' : 'bg-[#0a0a0a]'} border-t border-[#111] hover:bg-white/[0.02] transition-colors`}
                            >
                              <span className="font-bold text-white flex items-center gap-1.5">
                                <Calendar size={10} className="text-blue-400" />
                                {m.id}
                              </span>
                              <span className="text-center font-black text-white">{(m.totalCount || 0).toLocaleString()}</span>
                              <span className="text-center font-bold text-blue-400">{(m.수급자Count || 0).toLocaleString()}</span>
                              <span className="text-center font-bold text-amber-400">{(m.차상위Count || 0).toLocaleString()}</span>
                              <span className="text-center text-gray-600 text-[10px]">{fmtTs(m.uploadedAt)}</span>
                            </div>
                          ))}
                          {/* City subtotal */}
                          <div className="grid grid-cols-5 px-5 py-2.5 border-t border-[#1e1e1e] bg-blue-950/10 text-xs items-center">
                            <span className="text-gray-600 font-bold">합계</span>
                            <span className="text-center font-black text-blue-300">{cityTotal.toLocaleString()}</span>
                            <span className="text-center font-black text-blue-400">{city.months.reduce((s, m) => s + (m.수급자Count || 0), 0).toLocaleString()}</span>
                            <span className="text-center font-black text-amber-400">{city.months.reduce((s, m) => s + (m.차상위Count || 0), 0).toLocaleString()}</span>
                            <span />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
