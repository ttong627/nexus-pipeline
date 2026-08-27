import { useState, useEffect, useMemo } from 'react';
import { db } from '../config/firebase.js';
import { collection, getDocs } from 'firebase/firestore';
import { fetchSavedCities } from '../utils/savedCities.js';   // 저장된 지자체 목록 SSOT
import {
  MapPin, Calendar, X, Loader2, ChevronRight, AlertCircle, CheckCircle,
  Clock, Database, RefreshCw, Layers, Users, Package, Globe,
} from 'lucide-react';

// ── 저장 구조 재사용: nexus_city_prefs_v2[userId][city] = { month, lastUsed }
const PREF_KEY = 'nexus_city_prefs_v2';

const loadAllPrefs = () => {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
};

const loadCityPref = (userId, city) => {
  if (!userId || !city) return null;
  return loadAllPrefs()?.[userId]?.[city] ?? null;
};

const saveCityPref = (userId, city, month) => {
  if (!userId || !city) return;
  try {
    const all = loadAllPrefs();
    if (!all[userId]) all[userId] = {};
    all[userId][city] = { month, lastUsed: Date.now() };
    localStorage.setItem(PREF_KEY, JSON.stringify(all));
  } catch {}
};

// RouteMapModal getRouteDong 과 동일 규칙 (배정행정동 > routeDong > 행정동)
const getRouteDong = (record) =>
  String(record?.배정행정동 || record?.routeDong || record?.행정동 || '').trim();

const formatMonthLabel = (yyyyMM) => {
  if (!yyyyMM) return '';
  const [y, m] = String(yyyyMM).split('-');
  if (!y || !m) return yyyyMM;
  return `${y}년 ${parseInt(m, 10)}월`;
};

export default function DongSelectModal({
  userId,
  userCities = [],
  isAdmin = false,
  onConfirm,
  onCancel,
}) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // 초기 지자체·월: 마지막 사용 이력 복원 (nexus_city_prefs_v2)
  const initCity = userCities[0] ?? '';
  const savedForInit = loadCityPref(userId, initCity);
  const initMonth = savedForInit?.month || currentMonth;

  const [city, setCity] = useState(initCity);
  const [month, setMonth] = useState(initMonth);
  const [savedPref, setSavedPref] = useState(savedForInit);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dongStats, setDongStats] = useState(null); // [{dong, count, assigned, unassigned}] | null

  // ── 저장된 지자체 목록 (형 지시 2026-08-27 "저장된 지자체 중에 고를 수 있게") ──────────
  //   예전엔 관리자에게 자유 입력창 + datalist 만 줬는데, 관리자 계정은 `citiesApproved` 가 비어 있어
  //   **고를 것이 하나도 없었다**(형 화면 실측). 실제로 명단이 저장된 지자체를 불러와 고르게 한다.
  const [cityOptions, setCityOptions] = useState(() => (userCities || []).filter(Boolean));
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [manualCity, setManualCity] = useState(false);   // 관리자 전용 — 목록에 없는 곳 직접 입력

  // ★배열을 그대로 의존성에 넣으면 안 된다 — 부모가 `user?.citiesApproved || []` 로 매 렌더 새 배열을
  //   넘기므로 목록을 무한히 다시 불러온다. 문자열 키로 고정한다.
  const userCitiesKey = (userCities || []).join('|');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetchSavedCities({ user: { citiesApproved: userCitiesKey ? userCitiesKey.split('|') : [] }, isAdmin });
      if (cancelled) return;
      setCityOptions(list);
      setCitiesLoading(false);
      // 아직 아무것도 안 고른 상태면 첫 지자체를 자동 선택한다(형이 바로 월만 확인하면 되게)
      setCity(prev => (prev ? prev : (list[0] || '')));
    })();
    return () => { cancelled = true; };
  }, [isAdmin, userCitiesKey]);

  const cityIsValid = city.trim().length >= 2;
  const monthIsValid = /^\d{4}-\d{2}$/.test(month);

  // 지자체 변경 시 해당 지자체 저장 월 자동 복원
  useEffect(() => {
    const pref = loadCityPref(userId, city);
    setSavedPref(pref);
    if (pref?.month) setMonth(pref.month);
  }, [city]); // eslint-disable-line react-hooks/exhaustive-deps

  // 선택 지자체·월의 행정동별 집계 로드
  useEffect(() => {
    if (!cityIsValid || !monthIsValid) { setDongStats(null); setLoadError(''); return; }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'cloud_lists', city.trim(), 'months', month, 'records'));
        if (cancelled) return;
        const map = {};
        snap.docs.forEach(d => {
          const data = d.data();
          const dong = getRouteDong(data);
          if (!dong) return;
          if (!map[dong]) map[dong] = { dong, count: 0, assigned: 0 };
          map[dong].count += 1;
          // 기사 배정 여부: 저장 레코드의 기사 필드 기준
          if (String(data.기사 || '').trim()) map[dong].assigned += 1;
        });
        const stats = Object.values(map)
          .map(s => ({ ...s, unassigned: s.count - s.assigned }))
          .sort((a, b) => a.dong.localeCompare(b.dong, 'ko'));
        setDongStats(stats);
      } catch (e) {
        if (!cancelled) { setDongStats(null); setLoadError('행정동 현황을 불러오지 못했습니다: ' + (e?.message || '알 수 없는 오류')); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [city, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    if (!dongStats) return null;
    return dongStats.reduce(
      (acc, s) => ({ count: acc.count + s.count, assigned: acc.assigned + s.assigned, unassigned: acc.unassigned + s.unassigned }),
      { count: 0, assigned: 0, unassigned: 0 }
    );
  }, [dongStats]);

  const lastUsedLabel = savedPref?.lastUsed
    ? new Date(savedPref.lastUsed).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
    : null;

  const handlePickDong = (dong) => {
    if (!cityIsValid || !monthIsValid || !dong) return;
    saveCityPref(userId, city.trim(), month);
    onConfirm(city.trim(), month, dong);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-[#060c18] border border-[#3b82f6]/25 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.9),0_0_0_1px_rgba(59,130,246,0.1)] w-full max-w-2xl mx-4 flex flex-col"
        style={{ maxHeight: '84vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#0f1a2e] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#3b82f6]/10 border border-[#3b82f6]/25 flex items-center justify-center">
              <Layers size={14} className="text-[#3b82f6]" />
            </div>
            <div>
              <span className="text-white font-black text-sm">동별 배송지도</span>
              <p className="text-gray-500 text-[11px] leading-tight">행정동을 골라 그 동의 배송 구성을 작업·공유합니다</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 지자체 · 월 선택 */}
        <div className="px-6 pt-5 pb-3 shrink-0 grid grid-cols-2 gap-3">
          {/* 지자체 */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin size={11} className="text-[#3b82f6]" />지자체
            </label>
            {manualCity ? (
              <>
                <input
                  type="text"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  list="dong-city-datalist"
                  placeholder="지자체명 입력 (예: 서울특별시 동대문구)"
                  className="w-full bg-[#060a0e] border border-[#1e2d3d] focus:border-[#3b82f6]/60 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none transition-colors"
                />
                <datalist id="dong-city-datalist">
                  {cityOptions.map(c => <option key={c} value={c} />)}
                </datalist>
              </>
            ) : (
              <div className="relative">
                <select
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  disabled={citiesLoading && cityOptions.length === 0}
                  className="w-full bg-[#060a0e] border border-[#1e2d3d] focus:border-[#3b82f6]/60 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none appearance-none transition-colors pr-8 disabled:opacity-50"
                >
                  <option value="">
                    {citiesLoading && cityOptions.length === 0
                      ? '지자체 불러오는 중…'
                      : cityOptions.length ? '-- 지자체 선택 --' : '저장된 지자체가 없습니다'}
                  </option>
                  {/* 목록에 없는 값이 이미 들어 있으면(직접 입력 후 전환) 사라지지 않게 같이 넣는다 */}
                  {city && !cityOptions.includes(city) && <option value={city}>{city}</option>}
                  {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 text-xs">▾</div>
              </div>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setManualCity(v => !v)}
                className="text-[10px] text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors"
              >
                {manualCity ? '목록에서 선택' : '목록에 없으면 직접 입력'}
              </button>
            )}
            {savedPref && lastUsedLabel && (
              <p className="flex items-center gap-1 text-[11px] text-gray-500">
                <Clock size={10} />최근 작업: {lastUsedLabel}
              </p>
            )}
          </div>

          {/* 적용 월 */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar size={11} className="text-sky-500" />적용 월
            </label>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="w-full bg-[#060a0e] border border-[#1e2d3d] focus:border-sky-500/60 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none transition-colors [color-scheme:dark]"
            />
            {savedPref?.month === month && month !== currentMonth && (
              <p className="flex items-center gap-1 text-[11px] text-sky-400">
                <CheckCircle size={10} />{city} 저장 이력 ({formatMonthLabel(month)})
              </p>
            )}
          </div>
        </div>

        {/* 행정동 카드 리스트 */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-500">
              <Loader2 size={22} className="animate-spin text-[#3b82f6]" />
              <span className="text-sm">행정동 현황 불러오는 중...</span>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-red-400">
              <AlertCircle size={26} className="opacity-60" />
              <span className="text-sm font-bold text-center px-4">{loadError}</span>
              <button
                onClick={() => setMonth(m => m)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1e2d3d] text-gray-400 text-xs font-bold hover:bg-white/5 transition-colors"
              >
                <RefreshCw size={12} /> 다시 시도
              </button>
            </div>
          ) : !cityIsValid || !monthIsValid ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-600">
              <MapPin size={28} className="opacity-30" />
              <span className="text-sm font-bold">지자체와 월을 선택해주세요</span>
            </div>
          ) : !dongStats || dongStats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-600">
              <Database size={28} className="opacity-30" />
              <span className="text-sm font-bold">이 지자체·월에 저장된 배송명단이 없습니다</span>
              <span className="text-xs text-gray-700">먼저 이번달 배송명단을 클라우드에 저장해주세요</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {dongStats.map(({ dong, count, assigned, unassigned }) => (
                <button
                  key={dong}
                  onClick={() => handlePickDong(dong)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-[#0f1a2e] text-left transition-all group"
                  style={{ background: '#060e1a' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)';
                    e.currentTarget.style.background = 'rgba(59,130,246,0.06)';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(59,130,246,0.12)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '';
                    e.currentTarget.style.background = '#060e1a';
                    e.currentTarget.style.boxShadow = '';
                  }}
                >
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-[#3b82f6]/10 border border-[#3b82f6]/20">
                    <MapPin size={15} className="text-[#3b82f6]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-white font-black text-sm">{dong}</span>
                      {unassigned === 0 ? (
                        <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle size={8} />배정완료
                        </span>
                      ) : assigned === 0 ? (
                        <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-black bg-amber-500/15 text-amber-400 border border-amber-500/20">
                          <Globe size={8} />미배정
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-black bg-sky-500/10 text-sky-400 border border-sky-500/15">
                          <Layers size={8} />진행중
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-gray-500">
                      <span className="flex items-center gap-1"><Package size={9} className="text-gray-600" />전체 <b className="text-gray-300 tabular-nums">{count.toLocaleString()}</b>건</span>
                      <span className="flex items-center gap-1"><Users size={9} className="text-gray-600" />배정 <b className="text-emerald-400 tabular-nums">{assigned.toLocaleString()}</b></span>
                      {unassigned > 0 && (
                        <span className="flex items-center gap-1">미배정 <b className="text-amber-400 tabular-nums">{unassigned.toLocaleString()}</b></span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-gray-700 group-hover:text-[#3b82f6] transition-colors shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="shrink-0 px-6 py-3 border-t border-[#0f1a2e] flex items-center justify-between">
          {totals && dongStats && dongStats.length > 0 ? (
            <span className="text-[11px] text-gray-600">
              총 <span className="text-gray-400 font-bold">{dongStats.length}</span>개 행정동 ·
              {' '}<span className="text-gray-400 font-bold">{totals.count.toLocaleString()}</span>건
              {totals.unassigned > 0 && <> · 미배정 <span className="text-amber-400 font-bold">{totals.unassigned.toLocaleString()}</span></>}
            </span>
          ) : (
            <span />
          )}
          <button
            onClick={onCancel}
            className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors font-bold"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
