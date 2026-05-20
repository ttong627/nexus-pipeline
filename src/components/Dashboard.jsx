import { useState, useEffect, useMemo } from 'react';
import { FileSpreadsheet, CheckCircle, Database, ChevronRight, Truck, BookOpen, Loader2, RefreshCw, Calendar, AlertTriangle } from 'lucide-react';
import { APP_VERSION } from '../version.js';
import { db } from '../config/firebase.js';
import { collection, getDocs } from 'firebase/firestore';


function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ── 도시 카드 ─────────────────────────────────────────────────────────────────
function CityCard({ city, sigungu, cloud, base, curMonth, onCloudCard, onBaseCard }) {
  const hasCloud = !!cloud;
  const hasBase = !!base;
  const isCurrentMonth = cloud?.latestMonthId === curMonth;

  // 상태 점: 둘 다 있고 이번달이면 초록, 이번달 아니면 노랑, 클라우드만 파랑, 기본만 보라
  const dotColor = hasCloud && hasBase && isCurrentMonth
    ? '#22c55e'
    : hasCloud && hasBase
    ? '#eab308'
    : hasCloud
    ? '#3b82f6'
    : '#a855f7';

  return (
    <div className="rounded-xl border border-[#111a2e] overflow-hidden flex flex-col" style={{ background: '#06090f' }}>

      {/* ── 카드 헤더 ── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#0f1520]">
        <span className="text-white font-black text-[12px] truncate">{sigungu}</span>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {hasCloud && !isCurrentMonth && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-amber-900/30 text-amber-500 font-bold border border-amber-700/20">
              이전달
            </span>
          )}
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: dotColor, boxShadow: `0 0 5px ${dotColor}80` }}
          />
        </div>
      </div>

      {/* ── 이번달 배송명단 ── */}
      <button
        className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors border-b border-[#0f1520]
          ${hasCloud ? 'hover:bg-[#3b82f6]/[0.04] cursor-pointer' : 'cursor-default'}`}
        onClick={hasCloud ? () => onCloudCard?.(city) : undefined}
        disabled={!hasCloud}
      >
        <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors
          ${hasCloud ? 'bg-[#3b82f6]/10 border border-[#3b82f6]/20' : 'bg-[#111] border border-[#1a1a1a]'}`}>
          <Truck size={10} className={hasCloud ? 'text-[#3b82f6]' : 'text-gray-700'} />
        </div>
        <div className="flex-1 min-w-0">
          {hasCloud ? (
            <>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[9px] font-bold text-gray-500">{cloud.latestMonthId}</span>
                <span className="text-[11px] font-black text-white tabular-nums">{(cloud.totalQty || cloud.totalCount || 0).toLocaleString()}<span className="text-gray-600 font-bold ml-0.5 text-[9px]">포</span></span>
              </div>
              <div className="flex flex-wrap gap-1">
                {(cloud.suQty || cloud.suCount) > 0 && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-blue-950/60 text-blue-400 font-bold border border-blue-800/20">
                    수급 {(cloud.suQty || cloud.suCount || 0).toLocaleString()}포
                  </span>
                )}
                {(cloud.chaQty || cloud.chaCount) > 0 && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-purple-950/60 text-purple-400 font-bold border border-purple-800/20">
                    차상위 {(cloud.chaQty || cloud.chaCount || 0).toLocaleString()}포
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="text-[10px] text-gray-700 font-bold">미업로드</span>
          )}
        </div>
        {hasCloud && <ChevronRight size={11} className="text-gray-700 shrink-0 mt-0.5" />}
      </button>

      {/* ── 기본명단 ── */}
      <button
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors
          ${hasBase ? 'hover:bg-purple-500/[0.04] cursor-pointer' : 'cursor-default'}`}
        onClick={hasBase ? () => onBaseCard?.(city) : undefined}
        disabled={!hasBase}
      >
        <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors
          ${hasBase ? 'bg-purple-950/40 border border-purple-800/20' : 'bg-[#111] border border-[#1a1a1a]'}`}>
          <BookOpen size={10} className={hasBase ? 'text-purple-400' : 'text-gray-700'} />
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {hasBase ? (
            <>
              <span className="text-[9px] font-black text-purple-400/80">기본명단</span>
              {base.updatedAt && (
                <span className="text-[9px] text-gray-600">{fmtDate(base.updatedAt)}</span>
              )}
            </>
          ) : (
            <span className="text-[10px] text-gray-700 font-bold">미등록</span>
          )}
        </div>
        {hasBase && <ChevronRight size={11} className="text-gray-700 shrink-0" />}
      </button>
    </div>
  );
}

// ── 메인 대시보드 ──────────────────────────────────────────────────────────────
export default function Dashboard({ user, onStart, onHelp, onCloudCard, onBaseCard }) {
  const totalRows = user?.totalRowsProcessed || 0;
  const totalFiles = user?.totalFilesProcessed || 0;
  const isAdmin = user?.role === 'admin';
  const approvedCities = user?.citiesApproved || [];

  const [cloudData, setCloudData] = useState([]);
  const [baseData, setBaseData] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      // ── cloud_lists ──
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
              totalQty: latest.totalQty ?? latest.totalCount ?? 0,
              suQty: latest['수급자Qty'] ?? latest['수급자Count'] ?? 0,
              chaQty: latest['차상위Qty'] ?? latest['차상위Count'] ?? 0,
            };
          } catch { return null; }
        })
      );
      setCloudData(cloudResults.filter(Boolean).sort((a, b) => a.city.localeCompare(b.city, 'ko')));

      // ── base_lists ──
      const parseCity = id => {
        const sido = id.split(' ')[0] || id;
        const sigungu = id.slice(sido.length).trim() || id;
        return { sido, sigungu };
      };

      if (isAdmin) {
        const baseSnap = await getDocs(collection(db, 'base_lists')).catch(() => ({ docs: [] }));
        const cityMap = {};
        baseSnap.docs.forEach(d => {
          cityMap[d.id] = { city: d.id, ...parseCity(d.id), updatedAt: d.data().updatedAt || null };
        });
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

  // ── cloudData + baseData 통합 ──
  const allCities = useMemo(() => {
    const map = {};
    cloudData.forEach(c => {
      map[c.city] = { city: c.city, sigungu: c.sigungu, sido: c.sido, cloud: c, base: null };
    });
    baseData.forEach(b => {
      if (map[b.city]) {
        map[b.city].base = b;
      } else {
        map[b.city] = { city: b.city, sigungu: b.sigungu, sido: b.sido, cloud: null, base: b };
      }
    });
    return Object.values(map).sort((a, b) => a.city.localeCompare(b.city, 'ko'));
  }, [cloudData, baseData]);

  const groupedCities = useMemo(() => {
    const map = {};
    allCities.forEach(item => {
      if (!map[item.sido]) map[item.sido] = [];
      map[item.sido].push(item);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'ko'));
  }, [allCities]);

  const curMonth = getCurrentMonth();

  // 요약 통계
  const summary = useMemo(() => {
    const thisMonthCount = allCities.filter(c => c.cloud?.latestMonthId === curMonth).length;
    const totalQty = cloudData.reduce((s, c) => s + (c.latestMonthId === curMonth ? (c.totalQty || c.totalCount || 0) : 0), 0);
    return { total: allCities.length, thisMonth: thisMonthCount, totalQty };
  }, [allCities, cloudData, curMonth]);

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

        <div className="flex items-center gap-3">
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

          <button
            onClick={() => onStart()}
            className="flex items-center gap-2 px-5 py-2 bg-[#3b82f6] text-black font-extrabold rounded-xl text-sm hover:bg-[#60a5fa] transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]"
          >
            <FileSpreadsheet size={15} />
            파이프라인 가동
            <ChevronRight size={14} />
          </button>

          <button
            onClick={onHelp}
            className="relative w-9 h-9 rounded-full bg-[#060c18] border border-[#3b82f6]/50 text-[#3b82f6] font-black text-base hover:bg-[#3b82f6]/20 transition-all"
            style={{ animation: 'help-pulse 2.5s ease-in-out infinite' }}
          >
            <span className="absolute inset-0 flex items-center justify-center pointer-events-none text-[#3b82f6] text-lg font-black">?</span>
            <span className="sr-only">도움말</span>
          </button>
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500">
            <Loader2 size={24} className="animate-spin text-[#3b82f6]" />
            <span className="text-sm">등록 현황 불러오는 중...</span>
          </div>
        ) : allCities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-600">
            <div className="w-14 h-14 rounded-2xl bg-[#060c18] border border-[#0f1a2e] flex items-center justify-center">
              <Database size={24} className="opacity-20" />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-gray-500 mb-1">등록된 지자체가 없습니다</p>
              <p className="text-xs text-gray-700">파이프라인을 가동해서 명단을 클라우드에 저장하면 여기에 나타납니다</p>
            </div>
            <button
              onClick={() => onStart()}
              className="flex items-center gap-2 px-4 py-2 bg-[#3b82f6]/10 border border-[#3b82f6]/30 text-[#3b82f6] font-bold rounded-xl text-sm hover:bg-[#3b82f6]/20 transition-colors"
            >
              <FileSpreadsheet size={14} /> 파이프라인 가동
            </button>
          </div>
        ) : (
          <>
            {/* ── 이번달 요약 바 ── */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl bg-[#060c18] border border-[#0f1a2e]">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-600 tracking-widest">지자체</span>
                  <span className="text-white font-black text-sm">{summary.total}</span>
                  <span className="text-gray-700 text-[10px]">개</span>
                </div>
                <div className="w-px h-4 bg-[#151515]" />
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" style={{ boxShadow: '0 0 4px #22c55e80' }} />
                  <span className="text-[10px] font-bold text-gray-600">{curMonth} 업로드</span>
                  <span className="text-white font-black text-sm">{summary.thisMonth}</span>
                  <span className="text-gray-700 text-[10px]">개</span>
                </div>
                {summary.totalQty > 0 && (
                  <>
                    <div className="w-px h-4 bg-[#151515]" />
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-600">이번달 총</span>
                      <span className="text-[#3b82f6] font-black text-sm">{summary.totalQty.toLocaleString()}</span>
                      <span className="text-gray-700 text-[10px]">포</span>
                    </div>
                  </>
                )}
              </div>

              {/* 범례 */}
              <div className="flex items-center gap-3 text-[10px] text-gray-600 font-bold ml-auto">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500" style={{ boxShadow: '0 0 4px #22c55e80' }} />
                  이번달+기본명단
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  이전달+기본명단
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  배송명단만
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  기본명단만
                </div>
                <button
                  onClick={loadData}
                  className="flex items-center gap-1 text-gray-600 hover:text-gray-400 transition-colors ml-2"
                >
                  <RefreshCw size={11} /> 새로고침
                </button>
              </div>
            </div>

            {/* ── 도시 카드 그리드 ── */}
            <div className="space-y-6">
              {groupedCities.map(([sido, items]) => (
                <div key={sido}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-px flex-1 bg-[#0f1a2e]" />
                    <span className="text-[10px] font-black text-gray-600 tracking-widest px-2">{sido}</span>
                    <div className="h-px flex-1 bg-[#0f1a2e]" />
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                    {items.map(({ city, sigungu, cloud, base }) => (
                      <CityCard
                        key={city}
                        city={city}
                        sigungu={sigungu}
                        cloud={cloud}
                        base={base}
                        curMonth={curMonth}
                        onCloudCard={onCloudCard}
                        onBaseCard={onBaseCard}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
