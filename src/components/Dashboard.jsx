import { useState, useEffect, useMemo, useCallback } from 'react';
import { FileSpreadsheet, CheckCircle, Database, ChevronRight, Truck, BookOpen, RefreshCw, Calendar, MapPin, Zap, AlertTriangle, Package } from 'lucide-react';
import { APP_VERSION } from '../version.js';
import { db } from '../config/firebase.js';
import {
  collection, getDocs, query, orderBy, limit, getCountFromServer
} from 'firebase/firestore';
import { documentId } from 'firebase/firestore';
import { WORKFLOW_MODES } from '../utils/workflow.js';

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

function getProcessedRows(user) {
  return Number(user?.totalRowsProcessed || user?.processedRows || user?.totalProcessedRows || 0);
}

function getProcessedFiles(user) {
  return Number(user?.totalFilesProcessed || user?.processedFiles || user?.totalProcessedFiles || 0);
}

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
    const snap = await getDocs(collection(db, 'cloud_lists', city, 'months'));
    if (snap.empty) return null;
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.id.localeCompare(a.id))[0] || null;
  }
}

async function checkBaseExists(city) {
  try {
    const snap = await getCountFromServer(collection(db, 'base_lists', city, 'records'));
    return snap.data().count > 0;
  } catch { return false; }
}

// ─── 스켈레톤 CityCard ────────────────────────────────────────────────────────
function SkeletonCityCard() {
  return (
    <div className="rounded-xl border border-[#151d1c] bg-[#090d0c] min-h-[160px] overflow-hidden">
      <div className="h-12 bg-[#0d1513] animate-pulse" />
      <div className="px-3 pt-3 pb-3 space-y-2.5">
        <div className="h-3.5 bg-[#0d1513] rounded-md w-3/4 animate-pulse" />
        <div className="h-2.5 bg-[#0a1110] rounded-md w-1/2 animate-pulse" style={{ animationDelay: '80ms' }} />
        <div className="h-2.5 bg-[#0a1110] rounded-md w-2/3 animate-pulse" style={{ animationDelay: '160ms' }} />
      </div>
    </div>
  );
}

// ─── 워크플로우 가이드 (빈 상태용) ──────────────────────────────────────────
function WorkflowGuide({ onStart, workflowMode, onWorkflowModeChange }) {
  const steps = [
    { icon: FileSpreadsheet, color: 'text-sky-400',     num: 1, label: '파일 업로드'  },
    { icon: CheckCircle,     color: 'text-emerald-400', num: 2, label: '주소 정제'    },
    { icon: Truck,           color: 'text-amber-400',   num: 3, label: '기사 배정'    },
    { icon: MapPin,          color: 'text-violet-400',  num: 4, label: '루트맵'       },
    { icon: Database,        color: 'text-cyan-400',    num: 5, label: '저장/출력'    },
  ];

  const purposeCards = [
    { mode: 'cleaningOnly', accent: 'emerald', icon: CheckCircle },
    { mode: 'geoOnly', accent: 'cyan', icon: MapPin },
    { mode: 'deliveryFull', accent: 'amber', icon: Truck },
  ];

  return (
    <div className="rounded-2xl border border-[#1a2725] bg-[#080d0c] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <Zap size={15} className="text-emerald-300" />
        </div>
        <div>
          <h2 className="text-sm font-black text-white">이번 명단으로 어떤 작업을 진행할까요?</h2>
          <p className="text-[11px] text-gray-500">목적을 먼저 고르면 필요한 메뉴만 열립니다. 나중에 더 깊은 작업으로 확장할 수 있습니다.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
        {purposeCards.map(({ mode, accent, icon: Icon }) => {
          const item = WORKFLOW_MODES[mode];
          const active = workflowMode === mode;
          const tone = {
            emerald: active ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200' : 'border-emerald-500/15 bg-[#0a1110] text-emerald-400/80 hover:border-emerald-400/35',
            cyan:    active ? 'border-cyan-400/60 bg-cyan-500/10 text-cyan-200'          : 'border-cyan-500/15 bg-[#091011] text-cyan-400/80 hover:border-cyan-400/35',
            amber:   active ? 'border-amber-400/60 bg-amber-500/10 text-amber-200'       : 'border-amber-500/15 bg-[#11100a] text-amber-400/80 hover:border-amber-400/35',
          }[accent];
          return (
            <button
              key={mode}
              onClick={() => onWorkflowModeChange?.(mode)}
              className={`text-left rounded-xl border p-4 transition-all ${tone}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-black/25 border border-white/10 flex items-center justify-center">
                  <Icon size={15} />
                </div>
                <span className="text-sm font-black text-white">{item.title}</span>
                {active && <span className="ml-auto text-[9px] font-black px-1.5 py-0.5 rounded bg-white/10 border border-white/10">선택됨</span>}
              </div>
              <p className="text-[11px] leading-relaxed text-gray-400">{item.description}</p>
            </button>
          );
        })}
      </div>

      {/* 파이프라인 단계 — 번호 스텝바 */}
      <div className="flex items-center gap-0 mb-5 overflow-x-auto">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center shrink-0">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl">
              <div className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-black ${s.color} border-current opacity-60`}>
                {s.num}
              </div>
              <div className="flex items-center gap-1.5">
                <s.icon size={13} className={s.color} />
                <span className={`text-[11px] font-bold ${s.color} hidden sm:block`}>{s.label}</span>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="w-5 h-px bg-[#1a2a2a] shrink-0" />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => onStart(1)}
          className="flex items-center gap-2.5 px-5 py-2.5 bg-emerald-400 text-black font-extrabold rounded-xl text-sm hover:bg-emerald-300 transition-all shadow-[0_0_20px_rgba(52,211,153,0.16)]"
        >
          <FileSpreadsheet size={15} />
          선택한 목적대로 시작
          <ChevronRight size={14} />
        </button>
        <span className="text-gray-600 text-xs">현재 선택: {WORKFLOW_MODES[workflowMode]?.title || WORKFLOW_MODES.cleaningOnly.title}</span>
      </div>
    </div>
  );
}

// ─── 진행 중인 작업 카드 ──────────────────────────────────────────────────────
function ActiveWorkCard({ fileInfo, gridData, onStart, onOpenRouteMap, workflowMode, onWorkflowModeChange }) {
  const errorCount = gridData.filter(r => r._에러).length;
  const driverCount = new Set(gridData.filter(r => r.기사).map(r => r.기사)).size;
  const totalQty = gridData.reduce((s, r) => s + (parseInt(r.포수) || 1), 0);
  const hasDriver = gridData.some(r => r.기사);

  return (
    <div className="rounded-2xl border border-[#1a2725] bg-[#080d0c] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <Zap size={16} className="text-emerald-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-emerald-300 font-black tracking-wide uppercase">진행 중인 작업</span>
              <span className="text-[10px] text-gray-500 border border-[#22312f] bg-[#0d1413] rounded px-1.5 py-0.5">{WORKFLOW_MODES[workflowMode]?.shortTitle || '정제 명단'}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {fileInfo?.city && (
                <span className="text-white font-black text-sm">{fileInfo.city}</span>
              )}
              {fileInfo?.month && (
                <span className="text-gray-500 text-xs">{fileInfo.month}</span>
              )}
            </div>
          </div>
        </div>

        {/* 통계 */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0d1520] border border-[#1a2a3a]">
            <Package size={11} className="text-[#3b82f6]" />
            <span className="text-[#3b82f6] text-[11px] font-black">{totalQty.toLocaleString()}</span>
            <span className="text-gray-600 text-[9px]">포</span>
          </div>
          {errorCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-950/30 border border-amber-700/30">
              <AlertTriangle size={11} className="text-amber-400" />
              <span className="text-amber-400 text-[11px] font-black">{errorCount}</span>
              <span className="text-gray-600 text-[9px]">확인필요</span>
            </div>
          )}
          {hasDriver && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-950/30 border border-green-800/30">
              <Truck size={11} className="text-green-400" />
              <span className="text-green-400 text-[11px] font-black">{driverCount}</span>
              <span className="text-gray-600 text-[9px]">기사</span>
            </div>
          )}
        </div>
      </div>

      {/* 액션 버튼 */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 mr-1">
          {Object.values(WORKFLOW_MODES).map(mode => (
            <button
              key={mode.id}
              onClick={() => onWorkflowModeChange?.(mode.id)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border transition-colors ${
                workflowMode === mode.id
                  ? 'bg-emerald-500/12 border-emerald-400/40 text-emerald-200'
                  : 'bg-[#0b0f0f] border-[#1a2725] text-gray-500 hover:text-gray-300 hover:border-[#2b3b38]'
              }`}
            >
              {mode.shortTitle}
            </button>
          ))}
        </div>
        <button
          onClick={() => onStart(5)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-400 text-black font-extrabold rounded-xl text-xs hover:bg-emerald-300 transition-all"
        >
          <CheckCircle size={13} /> 결과 확인 · 편집
        </button>
        {workflowMode !== 'cleaningOnly' && !hasDriver && (
          <button
            onClick={onOpenRouteMap}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-500/10 text-cyan-300 border border-cyan-500/25 font-bold rounded-xl text-xs hover:bg-cyan-500/15 transition-all"
          >
            <MapPin size={13} /> 기사 배정 · 루트맵
          </button>
        )}
        {hasDriver && (
          <button
            onClick={onOpenRouteMap}
            className="flex items-center gap-2 px-4 py-2 bg-green-950/40 text-green-400 border border-green-800/30 font-bold rounded-xl text-xs hover:bg-green-900/40 transition-all"
          >
            <MapPin size={13} /> 루트맵 확인
          </button>
        )}
        <button
          onClick={() => onStart(1)}
          className="flex items-center gap-2 px-4 py-2 bg-[#111] text-gray-400 border border-[#222] font-bold rounded-xl text-xs hover:bg-[#1a1a1a] hover:text-white transition-all"
        >
          <FileSpreadsheet size={13} /> 새 파일 처리
        </button>
      </div>
    </div>
  );
}

// ─── CityCard ─────────────────────────────────────────────────────────────────
function CityCard({ item, onCloudCard, onBaseCard }) {
  const { city, sigungu, cloud, base } = item;
  const hasCloud = !!cloud;
  const hasBase = !!base;
  const themeSeed = [...city].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4;
  const themes = [
    { band: 'from-emerald-500/24 via-cyan-400/10 to-transparent', dot: 'bg-emerald-300', line: 'border-emerald-400/25', text: 'text-emerald-300' },
    { band: 'from-cyan-500/24 via-sky-400/10 to-transparent', dot: 'bg-cyan-300', line: 'border-cyan-400/25', text: 'text-cyan-300' },
    { band: 'from-amber-400/24 via-lime-300/10 to-transparent', dot: 'bg-amber-300', line: 'border-amber-400/25', text: 'text-amber-300' },
    { band: 'from-rose-400/20 via-orange-300/10 to-transparent', dot: 'bg-rose-300', line: 'border-rose-400/25', text: 'text-rose-300' },
  ];
  const theme = themes[themeSeed];
  const status = hasCloud ? '배송명단' : hasBase ? '기본명단' : '준비 필요';

  const handleMain = () => {
    if (hasCloud) onCloudCard?.(city, cloud.monthId);
    else if (hasBase) onBaseCard?.(city);
  };

  return (
    <div
      className={`group relative flex min-h-[160px] flex-col rounded-xl border bg-[#090d0c] ${theme.line} hover:border-white/20 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,0,0,0.25)] transition-all cursor-pointer overflow-hidden`}
      onClick={handleMain}
    >
      <div className={`relative h-12 bg-gradient-to-r ${theme.band} border-b border-white/5 overflow-hidden`}>
        <div className="absolute inset-0 opacity-[0.22]" style={{
          backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,.16) 1px, transparent 1px), linear-gradient(45deg, rgba(255,255,255,.10) 1px, transparent 1px)',
          backgroundSize: '18px 18px, 28px 28px',
        }} />
        <div className="absolute right-3 top-2.5 flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/25">
          {hasCloud ? <Truck size={13} className={theme.text} /> : hasBase ? <BookOpen size={13} className={theme.text} /> : <Database size={13} className="text-gray-500" />}
        </div>
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${hasCloud || hasBase ? theme.dot : 'bg-gray-600'}`} />
          <span className={`text-[9px] font-black tracking-widest ${hasCloud || hasBase ? theme.text : 'text-gray-600'}`}>{status}</span>
        </div>
      </div>

      <div className="flex items-start justify-between gap-2 px-3 pt-3 pb-1.5">
        <div className="min-w-0">
          <span className="block text-white font-black text-[14px] group-hover:text-white transition-colors truncate leading-tight">
            {sigungu}
          </span>
          <span className="mt-1 block text-[11px] text-gray-600 truncate">{city}</span>
        </div>
        <ChevronRight size={13} className="mt-0.5 text-gray-600 group-hover:text-gray-300 transition-colors shrink-0" />
      </div>

      {hasCloud ? (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Calendar size={9} className="text-gray-600 shrink-0" />
              <span className="text-[10px] text-gray-500 font-bold">{cloud.monthId}</span>
            </div>
            <span className={`text-[11px] font-black ${theme.text} tabular-nums shrink-0 pl-1`}>
              {cloud.totalCount.toLocaleString()}명{cloud.totalQty > 0 ? ` · ${cloud.totalQty.toLocaleString()}포` : ''}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-1">
              {cloud.suCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/15 font-bold">
                  수급 {cloud.suCount.toLocaleString()}명{cloud.suQty > 0 ? `·${cloud.suQty.toLocaleString()}포` : ''}
                </span>
              )}
              {cloud.chaCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/15 font-bold">
                  차상위 {cloud.chaCount.toLocaleString()}명{cloud.chaQty > 0 ? `·${cloud.chaQty.toLocaleString()}포` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="px-3 pb-3 mt-auto">
          <span className={`inline-flex items-center rounded-md px-2 py-1 text-[10px] font-bold ${hasBase ? 'bg-violet-500/10 text-violet-300 border border-violet-500/15' : 'bg-white/5 text-gray-600 border border-white/5'}`}>
            {hasBase ? '기본명단 바로가기' : '배송명단 없음'}
          </span>
        </div>
      )}

      <div className="mt-auto px-2 pb-2.5 flex items-center gap-1 flex-wrap">
        {hasCloud && (
          <button
            onClick={e => { e.stopPropagation(); onCloudCard?.(city, cloud.monthId); }}
            className={`text-[10px] px-2 py-0.5 rounded-md bg-white/5 ${theme.text} border ${theme.line} font-bold hover:bg-white/10 transition-colors`}
          >
            → 배송명단
          </button>
        )}
        {hasBase && (
          <button
            onClick={e => { e.stopPropagation(); onBaseCard?.(city); }}
            className="text-[10px] px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-300 border border-violet-500/15 font-bold hover:bg-violet-500/15 transition-colors"
          >
            → 기본명단
          </button>
        )}
        {base?.updatedAt && (
          <span className="text-[10px] text-gray-700 ml-auto">{fmtDate(base.updatedAt)}</span>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard({ user, onStart, onCloudCard, onBaseCard, gridData = [], fileInfo = null, onOpenRouteMap, workflowMode = 'cleaningOnly', onWorkflowModeChange, stepStatus, onOpenIntro }) {
  const totalRows = getProcessedRows(user);
  const totalFiles = getProcessedFiles(user);
  const isAdmin = user?.role === 'admin';
  const approvedCities = user?.citiesApproved || [];
  const uid = user?.uid || 'guest';

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
            totalQty: latestMonth.totalQty || 0,
            suCount: latestMonth['수급자Count'] || latestMonth.suCount || 0,
            chaCount: latestMonth['차상위Count'] || latestMonth.chaCount || 0,
            suQty: latestMonth['수급자Qty'] || 0,
            chaQty: latestMonth['차상위Qty'] || 0,
          } : null;

          const base = baseExists ? { updatedAt: null } : null;

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
  const hasActiveWork = gridData.length > 0;

  return (
    <div className="flex-1 w-full h-full flex flex-col overflow-hidden bg-[#070807]">

      {/* ── 헤더 ── */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#17201f] bg-[#080b0a]">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-black text-white flex items-center gap-2.5">
            NEXUS <span className="text-emerald-300">PIPELINE</span>
            <span className="bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded text-[10px] tracking-widest border border-emerald-500/20">{APP_VERSION}</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {/* 통계 */}
          <div className="hidden lg:flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/20 border border-emerald-900/30">
              <Database size={11} className="text-emerald-500" />
              <span className="text-gray-500 text-[10px] font-bold">정제 누적</span>
              <span className="text-white text-[11px] font-black">{totalRows.toLocaleString()}</span>
              <span className="text-gray-600 text-[9px]">건</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/20 border border-emerald-900/30">
              <FileSpreadsheet size={11} className="text-emerald-500" />
              <span className="text-gray-500 text-[10px] font-bold">정제 파일</span>
              <span className="text-white text-[11px] font-black">{totalFiles.toLocaleString()}</span>
              <span className="text-gray-600 text-[9px]">개</span>
            </div>
          </div>
          <button
            onClick={onOpenIntro}
            className="flex items-center gap-2 px-4 py-2 bg-[#0a1520] hover:bg-[#0c2438] text-cyan-300 font-extrabold rounded-xl text-sm border border-cyan-500/40 hover:border-cyan-400 transition-all shadow-[0_0_20px_rgba(6,182,212,0.2)] mr-1"
          >
            <Zap size={14} className="text-emerald-400" />
            3D 인트로 감상
          </button>
          <button
            onClick={() => onStart(1)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-400 text-black font-extrabold rounded-xl text-sm hover:bg-emerald-300 transition-all shadow-[0_0_20px_rgba(52,211,153,0.14)]"
          >
            <FileSpreadsheet size={14} />
            새 명단 처리
            <ChevronRight size={13} />
          </button>
          <button
            onClick={() => window.open('/manual.html', '_blank')}
            className="w-8 h-8 rounded-full bg-emerald-950/30 border border-emerald-500/30 text-emerald-400 font-black text-sm hover:bg-emerald-500/15 transition-all flex items-center justify-center"
            title="사용설명서"
          >
            ?
          </button>
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* 진행 중인 작업 카드 또는 워크플로우 가이드 */}
        {hasActiveWork ? (
          <ActiveWorkCard
            fileInfo={fileInfo}
            gridData={gridData}
            onStart={onStart}
            onOpenRouteMap={onOpenRouteMap}
            workflowMode={workflowMode}
            onWorkflowModeChange={onWorkflowModeChange}
            stepStatus={stepStatus}
          />
        ) : (
          <WorkflowGuide onStart={onStart} workflowMode={workflowMode} onWorkflowModeChange={onWorkflowModeChange} />
        )}

        {/* 지자체 현황 */}
        {loading ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-black text-gray-600">지자체 현황</h2>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
              {Array.from({ length: 12 }).map((_, i) => <SkeletonCityCard key={i} />)}
            </div>
          </div>
        ) : cityItems.length > 0 ? (
          <div>
            {/* 요약 + 새로고침 */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-4 text-xs text-gray-600">
                <h2 className="text-sm font-black text-gray-300">지자체 현황</h2>
                <span className="flex items-center gap-1.5">
                  <Truck size={11} className="text-emerald-500" />
                  배송명단 <span className="text-white font-bold">{cloudCount}</span>개
                </span>
                <span className="flex items-center gap-1.5">
                  <BookOpen size={11} className="text-purple-400" />
                  기본명단 <span className="text-white font-bold">{baseCount}</span>개
                </span>
              </div>
              <button
                onClick={handleRefresh}
                className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                <RefreshCw size={11} /> 새로고침
              </button>
            </div>

            {grouped.map(([sido, items]) => (
              <div key={sido} className="mb-5">
                <div className="flex items-center gap-3 mb-2.5">
                  <div className="h-px flex-1 bg-[#0d1520]" />
                  <span className="text-[9px] font-black text-gray-700 tracking-widest px-2">{sido}</span>
                  <div className="h-px flex-1 bg-[#0d1520]" />
                </div>
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
        ) : null}
      </div>
    </div>
  );
}
