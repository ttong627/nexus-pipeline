import { useState, useEffect, useMemo, useCallback } from 'react';
import { FileSpreadsheet, CheckCircle, Database, ChevronRight, Truck, BookOpen, Loader2, RefreshCw, Calendar } from 'lucide-react';
import { APP_VERSION } from '../version.js';
import { db } from '../config/firebase.js';
import {
  collection, getDocs, getDoc, doc, query, orderBy, limit, getCountFromServer
} from 'firebase/firestore';
import { documentId } from 'firebase/firestore';

// ─── Cache (sessionStorage, 3분 TTL) ─────────────────────────────────────────
const CACHE_KEY = 'nexus_dash_v3';
const CACHE_TTL = 3 * 60 * 1000;

function readCache(uid) {
  try {
    const raw = sessionStorage.getItem(`${CACHE_KEY}_${uid}`);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch { return null; }
}
function writeCache(uid, data) {
  try { sessionStorage.setItem(`${CACHE_KEY}_${uid}`, JSON.stringify({ ts: Date.now(), data })); } catch {}
}
function bustCache(uid) {
  try { sessionStorage.removeItem(`${CACHE_KEY}_${uid}`); } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseSido(city) {
  const sido = city.split(' ')[0] || city;
  const sigungu = city.slice(sido.length).trim() || city;
  return { sido, sigungu };
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 최신 month 1건만 fetch (limit+orderBy on documentId for speed)
async function fetchLatestMonth(city) {
  try {
    const q = query(
      collection(db, 'cloud_lists', city, 'months'),
      orderBy(documentId(), 'desc'),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch {
    // index 없는 환경 fallback
    const snap = await getDocs(collection(db, 'cloud_lists', city, 'months'));
    if (snap.empty) return null;
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.id.localeCompare(a.id))[0] || null;
  }
}

// base 존재 여부만 확인 (count 집계 — 레코드 다운로드 없음)
async function checkBaseExists(city) {
  try {
    const snap = await getCountFromServer(collection(db, 'base_lists', city, 'records'));
    return snap.data().count > 0;
  } catch { return false; }
}

// ─── CityCard ─────────────────────────────────────────────────────────────────
function CityCard({ item, onCloudCard, onBaseCard }) {
  const { city, sigungu, cloud, base } = item;
  const hasCloud = !!cloud;
  const hasBase = !!base;

  const handleMain = () => {
    if (hasCloud) onCloudCard?.(city, cloud.monthId);
    else if (hasBase) onBaseCard?.(city);
  };

  return (
    <div
      className="group flex flex-col rounded-xl border border-[#111] bg-[#060b14] hover:border-[#3b82f6]/30 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(59,130,246,0.08)] transition-all cursor-pointer overflow-hidden"
      onClick={handleMain}
    >
      {/* 상단: 도시명 */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <span className="text-white font-black text-[13px] group-hover:text-[#93c5fd] transition-colors truncate leading-tight">
          {sigungu}
        </span>
        <ChevronRight size={11} className="text-gray-700 group-hover:text-[#3b82f6] transition-colors shrink-0 ml-1" />
      </div>

      {/* 중단: 클라우드 명단 정보 */}
      {hasCloud ? (
        <div className="px-3 pb-2 space-y-1">
          <div className="flex items-center gap-1">
            <Calendar size={9} className="text-gray-600 shrink-0" />
            <span className="text-[10px] text-gray-500 font-bold">{cloud.monthId}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-1">
              {cloud.suCount > 0 && (
                <span className="text-[8px] px-1 py-0.5 rounded bg-blue-900/25 text-blue-400 border border-blue-800/20 font-bold">
                  수급 {cloud.suCount.toLocaleString()}
                </span>
              )}
              {cloud.chaCount > 0 && (
                <span className="text-[8px] px-1 py-0.5 rounded bg-purple-900/25 text-purple-400 border border-purple-800/20 font-bold">
                  차상위 {cloud.chaCount.toLocaleString()}
                </span>
              )}
            </div>
            <span className="text-[11px] font-black text-[#3b82f6]/70 tabular-nums shrink-0 pl-1">
              {cloud.totalCount.toLocaleString()}포
            </span>
          </div>
        </div>
      ) : (
        <div className="px-3 pb-2">
          <span className="text-[10px] text-gray-700">배송명단 없음</span>
        </div>
      )}

      {/* 하단: 액션 배지 */}
      <div className="mt-auto px-2 pb-2.5 flex items-center gap-1 flex-wrap">
        {hasCloud && (
          <button
            onClick={e => { e.stopPropagation(); onCloudCard?.(city, cloud.monthId); }}
            className="text-[8px] px-1.5 py-0.5 rounded-md bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20 font-bold hover:bg-[#3b82f6]/20 transition-colors"
          >
            배송명단
          </button>
        )}
        {hasBase && (
          <button
            onClick={e => { e.stopPropagation(); onBaseCard?.(city); }}
            className="text-[8px] px-1.5 py-0.5 rounded-md bg-purple-900/20 text-purple-400 border border-purple-800/20 font-bold hover:bg-purple-900/30 transition-colors"
          >
            기본명단
          </button>
        )}
        {base?.updatedAt && (
          <span className="text-[8px] text-gray-700 ml-auto">{fmtDate(base.updatedAt)}</span>
        )}
      </div>
    </div>
  );
}


// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard({ user, onStart, onHelp, onCloudCard, onBaseCard }) {
  const totalRows = user?.totalRowsProcessed || 0;
  const totalFiles = user?.totalFilesProcessed || 0;
  const isAdmin = user?.role === 'admin';
  const approvedCities = user?.citiesApproved || [];
  const uid = user?.uid || 'guest';

  // cityItems: [{ city, sido, sigungu, cloud: {monthId,totalCount,suCount,chaCount}|null, base: {updatedAt}|null }]
  const [cityItems, setCityItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (force = false) => {
    setLoading(true);
    if (!force) {
      const cached = readCache(uid);
      if (cached) {
        setCityItems(cached);
        setLoading(false);
        return;
      }
    }

    try {
      // ── 1. 도시 목록 수집 ──────────────────────────────────────────────────
      let cities = [];
      if (isAdmin) {
        const [cloudSnap, baseSnap] = await Promise.all([
          getDocs(collection(db, 'cloud_lists')).catch(() => ({ docs: [] })),
          getDocs(collection(db, 'base_lists')).catch(() => ({ docs: [] })),
        ]);
        const citySet = new Set([
          ...cloudSnap.docs.map(d => d.id),
          ...baseSnap.docs.map(d => d.id),
        ]);
        cities = [...citySet].sort((a, b) => a.localeCompare(b, 'ko'));
      } else {
        cities = [...approvedCities].sort((a, b) => a.localeCompare(b, 'ko'));
      }

      // ── 2. 병렬로 각 도시 데이터 조회 (최적화) ──────────────────────────────
      const results = await Promise.all(
        cities.map(async city => {
          const { sido, sigungu } = parseSido(city);
          const [latestMonth, baseExists] = await Promise.all([
            fetchLatestMonth(city),
            checkBaseExists(city),
          ]);

          const cloud = latestMonth ? {
            monthId: latestMonth.id,
            totalCount: latestMonth.totalCount || 0,
            suCount: latestMonth['수급자Count'] || latestMonth.suCount || 0,
            chaCount: latestMonth['차상위Count'] || latestMonth.chaCount || 0,
          } : null;

          const base = baseExists ? {
            updatedAt: null,
          } : null;

          if (!cloud && !base) return null;
          return { city, sido, sigungu, cloud, base };
        })
      );

      const items = results.filter(Boolean);
      setCityItems(items);
      writeCache(uid, items);
    } catch (e) {
      console.error('대시보드 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, [uid, isAdmin, approvedCities]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = () => {
    bustCache(uid);
    loadData(true);
  };

  // 시/도별 그룹핑
  const grouped = useMemo(() => {
    const map = {};
    cityItems.forEach(item => {
      if (!map[item.sido]) map[item.sido] = [];
      map[item.sido].push(item);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'ko'));
  }, [cityItems]);

  const cloudCount = cityItems.filter(c => c.cloud).length;
  const baseCount = cityItems.filter(c => c.base).length;

  return (
    <div className="flex-1 w-full h-full flex flex-col overflow-hidden bg-transparent">

      {/* ── 헤더 ── */}
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
            onClick={() => window.open('/manual.html', '_blank')}
            className="w-9 h-9 rounded-full bg-[#060c18] border border-[#3b82f6]/50 text-[#3b82f6] font-black text-base hover:bg-[#3b82f6]/20 transition-all flex items-center justify-center"
            title="사용설명서"
          >
            ?
          </button>
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="flex-1 overflow-y-auto px-8 py-6">

        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500">
            <Loader2 size={24} className="animate-spin text-[#3b82f6]" />
            <span className="text-sm">지자체 현황 불러오는 중...</span>
          </div>
        ) : cityItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-600">
            <Database size={32} className="opacity-20" />
            <p className="text-sm">등록된 데이터가 없습니다</p>
            <p className="text-xs opacity-60">파이프라인에서 처리 후 클라우드 저장하면 나타납니다</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 요약 헤더 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs text-gray-600">
                <span className="flex items-center gap-1.5">
                  <Truck size={11} className="text-[#3b82f6]" />
                  배송명단 <span className="text-white font-bold">{cloudCount}</span>개 지자체
                </span>
                <span className="flex items-center gap-1.5">
                  <BookOpen size={11} className="text-purple-400" />
                  기본명단 <span className="text-white font-bold">{baseCount}</span>개 지자체
                </span>
              </div>
              <button
                onClick={handleRefresh}
                className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                <RefreshCw size={11} /> 새로고침
              </button>
            </div>

            {/* 시/도별 그룹 */}
            {grouped.map(([sido, items]) => (
              <div key={sido}>
                {/* 광역시/도 구분선 */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px flex-1 bg-[#0f1a2e]" />
                  <span className="text-[9px] font-black text-gray-600 tracking-widest px-2">{sido}</span>
                  <div className="h-px flex-1 bg-[#0f1a2e]" />
                </div>

                {/* 도시 카드 그리드 — 압축형 다열 */}
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
                  {items.map(item => (
                    <CityCard
                      key={item.city}
                      item={item}
                      onCloudCard={onCloudCard}
                      onBaseCard={onBaseCard}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
