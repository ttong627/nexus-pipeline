import React, { useState, useEffect, useMemo } from 'react';
import { X, MapPin, Play, ChevronRight, Truck, Building2, ChevronLeft, Plus, Trash2, Phone, Percent, Users, LayoutGrid, Navigation2 } from 'lucide-react';
import { db } from '../config/firebase.js';
import { getDocs, collection, getDoc, doc } from 'firebase/firestore';

const DRIVER_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
  '#14b8a6', '#a855f7', '#84cc16', '#f43f5e',
  '#0ea5e9', '#d97706', '#10b981', '#6366f1',
  '#e11d48', '#0891b2', '#65a30d', '#7c3aed',
];

const ORG_COLOR_MAP = {
  blue: '#3b82f6', purple: '#a855f7', green: '#22c55e', orange: '#f97316',
  pink: '#ec4899', cyan: '#06b6d4', yellow: '#eab308', red: '#ef4444',
  teal: '#14b8a6', lime: '#84cc16', indigo: '#6366f1', rose: '#f43f5e',
};

let _seq = 0;
const makeDriver = (idx) => ({
  id: `d_${++_seq}`,
  name: '', phone: '', capacity: 100,
  color: DRIVER_COLORS[idx % DRIVER_COLORS.length],
});

// ── 공통 헤더 컴포넌트
function ModalHeader({ onBack, title, badge, subtitle, onClose }) {
  return (
    <div className="shrink-0 flex items-center justify-between px-8 py-4 border-b border-[#1e2d22]/60 bg-[#0a0f0a]">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack}
            className="p-2 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-gray-400 hover:text-white border border-[#2a2a2a] rounded-lg transition-colors">
            <ChevronLeft size={15} />
          </button>
        )}
        <div className="w-8 h-8 rounded-xl bg-green-900/40 border border-green-600/30 flex items-center justify-center">
          <Truck size={14} className="text-green-400" />
        </div>
        <div>
          <h2 className="text-white font-bold text-sm flex items-center gap-2">
            {title}
            {badge && <span className="text-[11px] font-black px-2 py-0.5 rounded-lg" style={badge.style}>{badge.text}</span>}
          </h2>
          {subtitle && <p className="text-gray-500 text-[11px] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <button onClick={onClose}
        className="p-2.5 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white border border-red-700/40 rounded-xl transition-colors">
        <X size={16} />
      </button>
    </div>
  );
}

export default function RouteSetupModal({
  mode = 'local', allRecords = [], city, cloudCity, cloudMonthId, orgDongs, onStart, onClose,
}) {
  const effectiveCity = cloudCity || city || '';

  // ── 단계: 'org' | 'setup' | 'match'
  const [step, setStep] = useState('org');

  // ── 소속사
  const [orgs, setOrgs] = useState([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [selectedOrgDongs, setSelectedOrgDongs] = useState(null);

  // ── 기사 카드
  const [drivers, setDrivers] = useState([makeDriver(0), makeDriver(1)]);
  const [activeDriverIds, setActiveDriverIds] = useState(new Set());

  // ── 행정동 → 기사 매핑 {dong: [driverId, ...]}
  const [dongDriverMap, setDongDriverMap] = useState({});

  // ── 행정동 건수
  const [dongCounts, setDongCounts] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // ── Step 3 매칭 모드
  const [matchMode, setMatchMode] = useState(null); // null | 'all' | 'driver' | 'dong'
  const [dongSelection, setDongSelection] = useState(new Set()); // 행정동별 다중 선택

  // 소속사 로드
  useEffect(() => {
    if (!effectiveCity) { setIsLoadingOrgs(false); return; }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'org_presets', effectiveCity));
        setOrgs(snap.exists() ? (snap.data().orgs || []) : []);
      } catch { setOrgs([]); }
      finally { setIsLoadingOrgs(false); }
    })();
  }, [effectiveCity]);

  // 로컬 행정동 건수
  useEffect(() => {
    if (mode !== 'local') return;
    const base = orgDongs ? allRecords.filter(r => orgDongs.has((r.행정동 || '').trim())) : allRecords;
    const filtered = selectedOrgDongs ? base.filter(r => selectedOrgDongs.has((r.행정동 || '').trim())) : base;
    const counts = {};
    filtered.forEach(r => { const d = (r.행정동 || '').trim(); if (d) counts[d] = (counts[d] || 0) + 1; });
    setDongCounts(counts);
    setDongDriverMap({});
  }, [mode, allRecords, orgDongs, selectedOrgDongs]);

  // 클라우드 행정동 건수
  useEffect(() => {
    if (mode !== 'cloud' || !cloudCity || !cloudMonthId) return;
    (async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records'));
        const counts = {};
        snap.docs.forEach(d => {
          const dong = (d.data().행정동 || '').trim();
          if (!dong) return;
          if (orgDongs && !orgDongs.has(dong)) return;
          if (selectedOrgDongs && !selectedOrgDongs.has(dong)) return;
          counts[dong] = (counts[dong] || 0) + 1;
        });
        setDongCounts(counts);
        setDongDriverMap({});
      } catch (e) { console.error('행정동 로드 실패:', e); }
      finally { setIsLoading(false); }
    })();
  }, [mode, cloudCity, cloudMonthId, orgDongs, selectedOrgDongs]);

  const dongList = useMemo(
    () => Object.keys(dongCounts).sort((a, b) => a.localeCompare(b, 'ko')),
    [dongCounts]
  );

  const assignedDongs = useMemo(() =>
    new Set(Object.entries(dongDriverMap).filter(([, ids]) => ids.length > 0).map(([d]) => d)),
    [dongDriverMap]
  );

  const totalSelected = useMemo(() =>
    [...assignedDongs].reduce((s, d) => s + (dongCounts[d] || 0), 0),
    [assignedDongs, dongCounts]
  );
  const totalAll = useMemo(() => Object.values(dongCounts).reduce((s, v) => s + v, 0), [dongCounts]);

  // 기사 카드 토글
  const toggleDriverActive = (id) => setActiveDriverIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // 행정동 클릭 → 활성 기사 배정/해제
  const handleDongClick = (dong) => {
    if (activeDriverIds.size === 0) return;
    setDongDriverMap(prev => {
      const cur = new Set(prev[dong] || []);
      const active = [...activeDriverIds];
      const allAssigned = active.every(id => cur.has(id));
      if (allAssigned) active.forEach(id => cur.delete(id));
      else active.forEach(id => cur.add(id));
      return { ...prev, [dong]: [...cur] };
    });
  };

  const handleSelectAll = () => {
    if (activeDriverIds.size === 0) return;
    setDongDriverMap(prev => {
      const next = { ...prev };
      dongList.forEach(dong => {
        const cur = new Set(next[dong] || []);
        activeDriverIds.forEach(id => cur.add(id));
        next[dong] = [...cur];
      });
      return next;
    });
  };
  const handleClearAll = () => setDongDriverMap({});

  // 기사 카드 조작
  const addDriver = () => {
    if (drivers.length >= 20) return;
    setDrivers(prev => [...prev, makeDriver(prev.length)]);
  };
  const removeDriver = (id) => {
    setDrivers(prev => prev.filter(d => d.id !== id));
    setActiveDriverIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    setDongDriverMap(prev => {
      const next = {};
      Object.entries(prev).forEach(([dong, ids]) => { next[dong] = ids.filter(i => i !== id); });
      return next;
    });
  };
  const updateDriver = (id, field, value) =>
    setDrivers(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));

  // 소속사 선택
  const handleSelectOrg = (org) => {
    setSelectedOrgId(org?.id || null);
    setSelectedOrgDongs(org ? new Set(org.dongs || []) : null);
    setDongDriverMap({});
    setStep('setup');
  };

  // ── onStart 헬퍼
  const doStart = ({ selectedDongs, startDrivers, map }) => {
    const validDrivers = startDrivers.filter(d => d.name.trim());
    const finalDrivers = validDrivers.length > 0 ? validDrivers : [
      { id: 'd1', name: '기사1', phone: '', capacity: 100, color: DRIVER_COLORS[0] },
      { id: 'd2', name: '기사2', phone: '', capacity: 100, color: DRIVER_COLORS[1] },
    ];
    onStart({ selectedDongs, drivers: finalDrivers, dongDriverMap: map });
  };

  // 전체 시작
  const handleStartAll = () => doStart({ selectedDongs: assignedDongs, startDrivers: drivers, map: dongDriverMap });

  // 기사별 시작
  const handleStartForDriver = (driverId) => {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) return;
    const driverDongs = Object.entries(dongDriverMap)
      .filter(([, ids]) => ids.includes(driverId)).map(([d]) => d);
    const filteredMap = {};
    driverDongs.forEach(dong => { filteredMap[dong] = [driverId]; });
    doStart({ selectedDongs: new Set(driverDongs), startDrivers: [driver], map: filteredMap });
  };

  // 행정동별 시작 (단일)
  const handleStartForDong = (dong) => {
    const ids = dongDriverMap[dong] || [];
    const dongDrivers = drivers.filter(d => ids.includes(d.id));
    doStart({ selectedDongs: new Set([dong]), startDrivers: dongDrivers, map: { [dong]: ids } });
  };

  // 행정동별 시작 (다중 선택)
  const handleStartForSelectedDongs = () => {
    if (!dongSelection.size) return;
    const dongs = [...dongSelection];
    const allIds = new Set(dongs.flatMap(dong => dongDriverMap[dong] || []));
    const dongDrivers = drivers.filter(d => allIds.has(d.id));
    const map = Object.fromEntries(dongs.map(dong => [dong, dongDriverMap[dong] || []]));
    doStart({ selectedDongs: new Set(dongs), startDrivers: dongDrivers, map });
  };

  // 행정동 선택 토글
  const toggleDongSelect = (dong) => {
    setDongSelection(prev => {
      const next = new Set(prev);
      next.has(dong) ? next.delete(dong) : next.add(dong);
      return next;
    });
  };

  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const activeDriverList = drivers.filter(d => activeDriverIds.has(d.id));
  const assignedDrivers = drivers.filter(d =>
    Object.values(dongDriverMap).some(ids => ids.includes(d.id))
  );

  const headerSubtitle = mode === 'cloud' ? `${cloudCity} · ${cloudMonthId}` : '로컬 데이터';
  const orgBadge = selectedOrg ? {
    text: selectedOrg.name,
    style: { background: (ORG_COLOR_MAP[selectedOrg.color] || '#6b7280') + '22', color: ORG_COLOR_MAP[selectedOrg.color] || '#6b7280' },
  } : null;

  // ══════════════════════════════════════
  // Step 1: 소속사 선택
  // ══════════════════════════════════════
  if (step === 'org') {
    return (
      <div className="fixed inset-0 z-[800] flex flex-col bg-[#060606]">
        <div className="shrink-0 flex items-center justify-between px-8 py-5 border-b border-[#1e2d22]/60 bg-[#0a0f0a]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-900/40 border border-green-600/30 flex items-center justify-center">
              <Truck size={17} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-white font-black text-base">배송 구역 배정</h2>
              <p className="text-gray-500 text-[11px] mt-0.5">
                {effectiveCity || headerSubtitle} · 소속사를 선택하거나 전체 진행을 클릭하세요
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2.5 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white border border-red-700/40 rounded-xl transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-8">
          <div className="max-w-5xl mx-auto">
            <div className="mb-6 flex items-center gap-3">
              <Building2 size={15} className="text-purple-400" />
              <span className="text-white font-black text-sm">소속사 선택</span>
              <span className="text-gray-600 text-[11px]">담당 소속사를 선택하면 해당 행정동만 불러옵니다</span>
            </div>
            {isLoadingOrgs ? (
              <div className="flex items-center justify-center h-56 text-gray-600 text-sm animate-pulse">소속사 목록 불러오는 중...</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                <button onClick={() => handleSelectOrg(null)}
                  className="flex flex-col items-center justify-center gap-3 p-7 rounded-2xl border-2 border-dashed border-[#2a3a2a] hover:border-green-600/50 bg-black/20 hover:bg-green-900/10 text-gray-400 hover:text-green-300 transition-all group min-h-[160px]">
                  <div className="w-14 h-14 rounded-2xl bg-[#1a2e1a]/60 group-hover:bg-green-900/30 border border-green-800/30 flex items-center justify-center transition-all">
                    <MapPin size={24} className="text-green-600 group-hover:text-green-400" />
                  </div>
                  <div className="text-center">
                    <div className="text-white font-black text-sm">전체 진행</div>
                    <div className="text-gray-600 text-[10px] mt-0.5">소속사 구분 없이 전체</div>
                  </div>
                </button>
                {orgs.map(org => {
                  const hex = ORG_COLOR_MAP[org.color] || '#6b7280';
                  const dongCnt = org.dongs?.length || 0;
                  const recCnt = allRecords.filter(r => (org.dongs || []).includes((r.행정동 || '').trim())).length;
                  return (
                    <button key={org.id} onClick={() => handleSelectOrg(org)}
                      className="flex flex-col items-start gap-3 p-6 rounded-2xl border transition-all hover:scale-[1.02] text-left min-h-[160px]"
                      style={{ background: hex + '0d', borderColor: hex + '40' }}>
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                        style={{ background: hex + '22', border: `1.5px solid ${hex}55` }}>
                        <Building2 size={22} style={{ color: hex }} />
                      </div>
                      <div className="flex-1 min-w-0 w-full">
                        <div className="text-white font-black text-sm truncate">{org.name}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: hex + '22', color: hex }}>{dongCnt}개 동</span>
                          {recCnt > 0 && <span className="text-[10px] text-gray-600 font-bold">{recCnt.toLocaleString()}건</span>}
                        </div>
                        {dongCnt > 0 && (
                          <div className="mt-2 text-[9px] text-gray-600 leading-relaxed line-clamp-2">
                            {(org.dongs || []).slice(0, 5).join(' · ')}{dongCnt > 5 ? ` +${dongCnt - 5}` : ''}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
                {orgs.length === 0 && <div className="col-span-full flex items-center justify-center h-40 text-gray-600 text-sm">등록된 소속사 없음 — 전체 진행을 선택하세요</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════
  // Step 2: 기사 카드 선택 + 행정동 배정
  // ══════════════════════════════════════
  if (step === 'setup') {
    return (
      <div className="fixed inset-0 z-[800] flex flex-col bg-[#060606]">
        <ModalHeader
          onBack={() => setStep('org')}
          title="작업 설정"
          badge={orgBadge}
          subtitle={`${headerSubtitle} · 기사 선택 → 행정동 클릭으로 배정`}
          onClose={onClose}
        />

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* ── 좌측: 기사 카드 */}
          <div className="w-80 shrink-0 border-r border-[#1a1a1a] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-[#1a1a1a] flex items-center justify-between shrink-0">
              <div>
                <span className="text-white font-black text-[13px]">기사 등록</span>
                <span className="text-gray-600 text-[11px] ml-2">
                  {activeDriverIds.size > 0
                    ? <span className="text-blue-400 font-bold">{activeDriverIds.size}명 선택됨</span>
                    : '클릭하여 선택'}
                </span>
              </div>
              <button onClick={addDriver} disabled={drivers.length >= 20}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/30 hover:bg-blue-700/40 text-blue-400 text-[11px] font-bold border border-blue-700/30 rounded-lg transition-colors disabled:opacity-40">
                <Plus size={12} /> 기사 추가
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {drivers.map((driver, idx) => {
                const isActive = activeDriverIds.has(driver.id);
                const assignedDongNames = Object.entries(dongDriverMap)
                  .filter(([, ids]) => ids.includes(driver.id)).map(([d]) => d);
                return (
                  <div key={driver.id} onClick={() => toggleDriverActive(driver.id)}
                    className="rounded-2xl border p-4 space-y-3 cursor-pointer transition-all select-none hover:scale-[1.01]"
                    style={{
                      background: isActive ? driver.color + '18' : '#0d0d0d',
                      borderColor: isActive ? driver.color + '70' : '#2a2a2a',
                      boxShadow: isActive ? `0 0 0 1px ${driver.color}35, 0 4px 20px ${driver.color}15` : 'none',
                    }}>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-black text-white"
                        style={{ background: driver.color }}>{idx + 1}</div>
                      <input value={driver.name} onChange={e => { e.stopPropagation(); updateDriver(driver.id, 'name', e.target.value); }}
                        onClick={e => e.stopPropagation()} placeholder="기사 이름"
                        className="flex-1 bg-black/30 border border-[#2a2a2a] focus:border-blue-500/50 rounded-lg px-3 py-1.5 text-[12px] text-white placeholder-gray-700 outline-none font-bold transition-colors" />
                      <button onClick={e => { e.stopPropagation(); removeDriver(driver.id); }}
                        className="p-1.5 text-gray-700 hover:text-red-400 transition-colors shrink-0"><Trash2 size={12} /></button>
                    </div>
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <Phone size={11} className="text-gray-600 shrink-0" />
                      <input value={driver.phone} onChange={e => updateDriver(driver.id, 'phone', e.target.value)}
                        placeholder="연락처 (선택)"
                        className="flex-1 bg-black/20 border border-[#1e1e1e] focus:border-[#2a2a2a] rounded-lg px-3 py-1.5 text-[11px] text-gray-300 placeholder-gray-700 outline-none transition-colors" />
                    </div>
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <Percent size={11} className="text-gray-600 shrink-0" />
                      <input type="range" min={10} max={200} step={5} value={driver.capacity}
                        onChange={e => updateDriver(driver.id, 'capacity', parseInt(e.target.value))}
                        className="flex-1 h-1.5" style={{ accentColor: driver.color }} />
                      <span className="text-[11px] font-black w-10 text-right shrink-0" style={{ color: driver.color }}>{driver.capacity}%</span>
                    </div>
                    <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(driver.capacity, 100)}%`, background: driver.color, opacity: 0.7 }} />
                    </div>
                    {assignedDongNames.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {assignedDongNames.map(d => (
                          <span key={d} className="text-[9px] px-1.5 py-0.5 rounded-md font-bold"
                            style={{ background: driver.color + '20', color: driver.color }}>{d}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {drivers.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-gray-700 text-sm gap-2">
                  <Plus size={20} className="opacity-40" />기사를 추가해주세요
                </div>
              )}
            </div>
          </div>

          {/* ── 우측: 행정동 배정 */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-6">
            <div className={`mb-4 shrink-0 px-4 py-2.5 rounded-xl border text-[11px] font-bold transition-all ${
              activeDriverIds.size > 0
                ? 'bg-blue-900/15 border-blue-700/30 text-blue-300'
                : 'bg-amber-900/10 border-amber-700/20 text-amber-500/80 animate-pulse'
            }`}>
              {activeDriverIds.size > 0 ? (
                <span>
                  선택된 기사:{' '}
                  {activeDriverList.map((d, i) => (
                    <span key={d.id}>
                      <span className="font-black" style={{ color: d.color }}>{d.name || `기사${drivers.indexOf(d) + 1}`}</span>
                      {i < activeDriverList.length - 1 && <span className="text-blue-500"> + </span>}
                    </span>
                  ))}
                  <span className="text-blue-500/70 ml-2">— 행정동 클릭 배정 (다시 클릭 해제)</span>
                </span>
              ) : '← 왼쪽에서 기사 카드를 클릭해 선택하세요 · 여러 명 동시 선택 가능'}
            </div>

            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-green-400" />
                <span className="text-white font-black text-[13px]">행정동 배정</span>
                {!isLoading && (
                  <span className="text-gray-600 text-[11px]">
                    배정 <span className="text-green-400 font-bold">{totalSelected.toLocaleString()}</span>건 / 전체 {totalAll.toLocaleString()}건 · {assignedDongs.size}개 동
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleSelectAll} disabled={activeDriverIds.size === 0}
                  className="px-3 py-1.5 rounded-lg bg-green-900/30 hover:bg-green-700/40 text-green-400 text-[11px] font-bold border border-green-800/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  전체 선택
                </button>
                <button onClick={handleClearAll}
                  className="px-3 py-1.5 rounded-lg bg-gray-800/60 hover:bg-gray-700/60 text-gray-400 text-[11px] font-bold border border-[#333] transition-colors">
                  전체 해제
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              {isLoading ? (
                <div className="flex items-center justify-center h-48 text-gray-600 text-sm animate-pulse">행정동 목록 불러오는 중...</div>
              ) : dongList.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-gray-600 text-sm">행정동 데이터가 없습니다</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                  {dongList.map(dong => {
                    const assignedIds = dongDriverMap[dong] || [];
                    const hasAssignment = assignedIds.length > 0;
                    const activeAssignedCount = assignedIds.filter(id => activeDriverIds.has(id)).length;
                    const isActiveAll = activeDriverIds.size > 0 && activeAssignedCount === activeDriverIds.size;
                    return (
                      <button key={dong} onClick={() => handleDongClick(dong)}
                        disabled={activeDriverIds.size === 0}
                        className={`flex flex-col px-3 py-2.5 rounded-xl border text-left transition-all ${
                          hasAssignment
                            ? isActiveAll ? 'border-green-500/60 bg-green-900/20 hover:bg-green-900/30' : 'border-[#2a4a2a] bg-green-900/10 hover:bg-green-900/15'
                            : activeDriverIds.size > 0
                            ? 'border-[#2a2a2a] bg-black/30 hover:border-[#4a4a4a] hover:bg-black/50'
                            : 'border-[#1a1a1a] bg-black/20 cursor-not-allowed'
                        }`}>
                        <div className="flex items-center justify-between w-full">
                          <span className={`text-[12px] font-bold truncate ${hasAssignment ? 'text-green-200' : 'text-gray-500'}`}>{dong}</span>
                          <span className={`text-[10px] font-bold ml-2 shrink-0 tabular-nums ${hasAssignment ? 'text-green-500' : 'text-gray-700'}`}>
                            {(dongCounts[dong] || 0).toLocaleString()}
                          </span>
                        </div>
                        {assignedIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {assignedIds.map(id => {
                              const d = drivers.find(dr => dr.id === id);
                              if (!d) return null;
                              const isCurrentActive = activeDriverIds.has(id);
                              return (
                                <span key={id} className="flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-full transition-all"
                                  style={{ background: d.color + (isCurrentActive ? '35' : '18'), color: d.color, border: `1px solid ${d.color}${isCurrentActive ? '60' : '30'}` }}>
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.color }} />
                                  {d.name || `기사${drivers.indexOf(d) + 1}`}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="shrink-0 px-8 py-4 border-t border-[#1e2d22]/60 flex items-center justify-between gap-4 bg-[#0a0f0a]">
          <div className="text-[11px] leading-relaxed">
            {(() => { const n = drivers.filter(d => d.name.trim()).length; return n > 0 ? <span className="text-blue-400/80">기사 {n}명</span> : <span className="text-gray-600">기사 미입력 → 기본 2명</span>; })()}
            {assignedDongs.size > 0 ? (
              <span className="ml-3">· 행정동 <span className="text-green-400/80 font-bold">{assignedDongs.size}개</span> (<span className="text-green-400/80">{totalSelected.toLocaleString()}</span>건)</span>
            ) : <span className="ml-3 text-amber-500/80 font-bold animate-pulse">← 기사 선택 후 행정동을 배정해주세요</span>}
          </div>
          <button onClick={() => { setMatchMode(null); setStep('match'); }} disabled={assignedDongs.size === 0 || isLoading}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-black text-[13px] transition-all shrink-0 ${
              assignedDongs.size > 0 && !isLoading
                ? 'bg-green-700 hover:bg-green-600 text-white shadow-[0_4px_20px_rgba(34,197,94,0.3)]'
                : 'bg-gray-800/60 text-gray-600 cursor-not-allowed'
            }`}>
            <Play size={14} /> 다음 — 매칭 방식 선택 <ChevronRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════
  // Step 3: 배송구역 매칭 방식 선택
  // ══════════════════════════════════════
  const MATCH_MODES = [
    {
      id: 'all',
      icon: <Navigation2 size={28} className="text-green-400" />,
      label: '전체 한번에',
      desc: '배정된 모든 기사·행정동을 동시에 지도에서 배송순번 지정',
      color: '#22c55e',
      stats: `${assignedDrivers.length}기사 · ${assignedDongs.size}개 동 · ${totalSelected.toLocaleString()}건`,
    },
    {
      id: 'driver',
      icon: <Users size={28} className="text-blue-400" />,
      label: '기사별 작업',
      desc: '기사 한 명씩 선택해 해당 기사의 행정동만 지도에 표시',
      color: '#3b82f6',
      stats: `${assignedDrivers.length}명 선택 가능`,
    },
    {
      id: 'dong',
      icon: <LayoutGrid size={28} className="text-orange-400" />,
      label: '행정동별 작업',
      desc: '행정동을 하나씩 선택해 해당 동의 기사들과 함께 작업',
      color: '#f97316',
      stats: `${assignedDongs.size}개 동 선택 가능`,
    },
  ];

  return (
    <div className="fixed inset-0 z-[800] flex flex-col bg-[#060606]">
      <ModalHeader
        onBack={() => setStep('setup')}
        title="매칭 방식 선택"
        badge={orgBadge}
        subtitle={`${headerSubtitle} · 배송구역 매칭을 어떻게 진행할지 선택하세요`}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* 배정 요약 */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: '배정 기사', value: `${assignedDrivers.length}명`, color: '#3b82f6' },
              { label: '작업 행정동', value: `${assignedDongs.size}개`, color: '#22c55e' },
              { label: '총 배송건', value: `${totalSelected.toLocaleString()}건`, color: '#f97316' },
            ].map(s => (
              <div key={s.label} className="bg-[#0d0d0d] border border-[#1e1e1e] rounded-2xl px-5 py-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: s.color + '18' }}>
                  <span className="text-lg font-black" style={{ color: s.color }}>{s.value}</span>
                </div>
                <span className="text-gray-500 text-[11px] font-bold">{s.label}</span>
              </div>
            ))}
          </div>

          {/* 기사별 배정 미리보기 */}
          <div className="flex flex-wrap gap-2">
            {assignedDrivers.map(d => {
              const dDongs = Object.entries(dongDriverMap).filter(([, ids]) => ids.includes(d.id)).map(([dong]) => dong);
              const cnt = dDongs.reduce((s, dong) => s + (dongCounts[dong] || 0), 0);
              return (
                <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[11px] font-bold"
                  style={{ background: d.color + '12', borderColor: d.color + '35', color: d.color }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                  {d.name} — {dDongs.join('·')} ({cnt.toLocaleString()}건)
                </div>
              );
            })}
          </div>

          {/* 모드 선택 카드 */}
          <div className="grid grid-cols-3 gap-4">
            {MATCH_MODES.map(mode => (
              <button key={mode.id} onClick={() => { setMatchMode(matchMode === mode.id ? null : mode.id); setDongSelection(new Set()); }}
                className={`flex flex-col items-start p-6 rounded-2xl border-2 text-left transition-all ${
                  matchMode === mode.id
                    ? 'scale-[1.02]'
                    : 'border-[#2a2a2a] bg-black/20 hover:border-[#3a3a3a] hover:bg-black/30'
                }`}
                style={matchMode === mode.id ? {
                  background: mode.color + '12',
                  borderColor: mode.color + '60',
                  boxShadow: `0 4px 24px ${mode.color}18`,
                } : {}}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: mode.color + '18', border: `1px solid ${mode.color}30` }}>
                  {mode.icon}
                </div>
                <div className="font-black text-white text-sm mb-1">{mode.label}</div>
                <div className="text-gray-500 text-[10px] leading-relaxed mb-3">{mode.desc}</div>
                <div className="text-[10px] font-bold px-2 py-0.5 rounded-lg" style={{ background: mode.color + '20', color: mode.color }}>
                  {mode.stats}
                </div>
              </button>
            ))}
          </div>

          {/* ── 전체 한번에 */}
          {matchMode === 'all' && (
            <div className="bg-[#0a1a0a] border border-green-800/30 rounded-2xl p-6 flex items-center justify-between">
              <div>
                <div className="text-white font-black text-sm mb-1">전체 {assignedDongs.size}개 동 · {totalSelected.toLocaleString()}건 동시 작업</div>
                <div className="text-gray-500 text-[11px]">모든 기사의 배송구역을 하나의 지도에서 순번 지정합니다</div>
              </div>
              <button onClick={handleStartAll}
                className="flex items-center gap-2 px-6 py-3 bg-green-700 hover:bg-green-600 text-white rounded-xl font-black text-[13px] shadow-[0_4px_20px_rgba(34,197,94,0.3)] transition-all shrink-0">
                <Play size={14} /> 전체 시작 <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* ── 기사별 */}
          {matchMode === 'driver' && (
            <div className="space-y-3">
              <div className="text-[11px] text-gray-500 font-bold px-1">기사를 선택하면 해당 기사의 행정동만 지도에 표시됩니다</div>
              <div className="grid grid-cols-2 gap-3">
                {assignedDrivers.map(d => {
                  const dDongs = Object.entries(dongDriverMap).filter(([, ids]) => ids.includes(d.id)).map(([dong]) => dong);
                  const cnt = dDongs.reduce((s, dong) => s + (dongCounts[dong] || 0), 0);
                  return (
                    <button key={d.id} onClick={() => handleStartForDriver(d.id)}
                      className="flex items-center gap-4 p-4 rounded-2xl border text-left transition-all hover:scale-[1.02]"
                      style={{ background: d.color + '0e', borderColor: d.color + '40' }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: d.color + '25' }}>
                        <span className="text-sm font-black" style={{ color: d.color }}>{drivers.indexOf(d) + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-black text-sm truncate">{d.name}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{dDongs.join(' · ')}</div>
                        <div className="text-[10px] font-bold mt-1" style={{ color: d.color }}>{cnt.toLocaleString()}건 · 업무능력 {d.capacity}%</div>
                      </div>
                      <ChevronRight size={14} style={{ color: d.color }} className="shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 행정동별 (다중 선택) */}
          {matchMode === 'dong' && (
            <div className="space-y-3">
              {/* 안내 + 전체선택 컨트롤 */}
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] text-gray-500 font-bold">
                  행정동을 여러 개 선택 후 시작하세요
                  {dongSelection.size > 0 && <span className="ml-2 text-orange-400 font-black">{dongSelection.size}개 선택됨</span>}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setDongSelection(new Set(assignedDongs))}
                    className="text-[10px] px-2.5 py-1 bg-[#1a2a1a] border border-green-700/30 text-green-400 rounded-lg hover:bg-green-900/20 transition-colors font-bold">
                    전체 선택
                  </button>
                  <button onClick={() => setDongSelection(new Set())}
                    className="text-[10px] px-2.5 py-1 bg-[#1a1a1a] border border-[#2a2a2a] text-gray-500 rounded-lg hover:text-gray-300 transition-colors font-bold">
                    선택 해제
                  </button>
                </div>
              </div>

              {/* 동 카드 그리드 */}
              <div className="grid grid-cols-3 gap-3">
                {[...assignedDongs].sort((a, b) => a.localeCompare(b, 'ko')).map(dong => {
                  const ids = dongDriverMap[dong] || [];
                  const dongDriversList = drivers.filter(d => ids.includes(d.id));
                  const cnt = dongCounts[dong] || 0;
                  const isSelected = dongSelection.has(dong);
                  return (
                    <button key={dong} onClick={() => toggleDongSelect(dong)}
                      className="flex flex-col p-4 rounded-2xl border-2 text-left transition-all hover:scale-[1.01]"
                      style={{
                        borderColor: isSelected ? '#22c55e' : '#2a3a2a',
                        background: isSelected ? 'rgba(34,197,94,0.10)' : 'rgba(34,197,94,0.03)',
                        boxShadow: isSelected ? '0 0 0 1px rgba(34,197,94,0.2), inset 0 0 20px rgba(34,197,94,0.05)' : 'none',
                      }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {/* 체크박스 */}
                          <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all"
                            style={{ background: isSelected ? '#22c55e' : 'transparent', border: `2px solid ${isSelected ? '#22c55e' : '#3a4a3a'}` }}>
                            {isSelected && <span className="text-black text-[9px] font-black leading-none">✓</span>}
                          </div>
                          <span className="text-white font-black text-sm">{dong}</span>
                        </div>
                        <span className="font-black text-[11px]" style={{ color: isSelected ? '#22c55e' : '#4a7a4a' }}>
                          {cnt.toLocaleString()}건
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {dongDriversList.map(d => (
                          <span key={d.id} className="text-[9px] px-1.5 py-0.5 rounded-full font-black flex items-center gap-1"
                            style={{ background: d.color + '22', color: d.color, border: `1px solid ${d.color}35` }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.color }} />
                            {d.name}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* 시작 버튼 (선택된 동이 있을 때만 활성화) */}
              <div className="pt-2 flex items-center justify-between">
                <span className="text-[11px] text-gray-600">
                  {dongSelection.size > 0
                    ? `선택 ${dongSelection.size}개 동 · 총 ${[...dongSelection].reduce((s, d) => s + (dongCounts[d] || 0), 0).toLocaleString()}건`
                    : '동을 1개 이상 선택하세요'}
                </span>
                <button
                  onClick={handleStartForSelectedDongs}
                  disabled={dongSelection.size === 0}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl font-black text-[13px] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: dongSelection.size > 0 ? 'linear-gradient(135deg, #166534, #15803d)' : '#1a2a1a',
                    color: dongSelection.size > 0 ? 'white' : '#4a6a4a',
                    border: `1px solid ${dongSelection.size > 0 ? 'rgba(34,197,94,0.5)' : '#2a3a2a'}`,
                    boxShadow: dongSelection.size > 0 ? '0 0 20px rgba(34,197,94,0.2)' : 'none',
                  }}>
                  <Play size={14} /> 선택한 {dongSelection.size}개 동 시작
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
