import { useState, useEffect, useMemo } from 'react';
import { X, MapPin, Play, ChevronRight, Truck, Building2, ChevronLeft, Plus, Trash2, Users, LayoutGrid, Navigation2, Crosshair, Loader2, CheckCircle, RefreshCw, CloudDownload } from 'lucide-react';
import { db, writeBatch } from '../config/firebase.js';
import { getDocs, collection, getDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY;

// 주소에서 괄호 밖 도로명 추출
const extractRoadAddress = (addr) => {
  if (!addr) return addr;
  let depth = 0;
  for (let i = 0; i < addr.length; i++) {
    if (addr[i] === '(') depth++;
    else if (addr[i] === ')') depth--;
    else if (addr[i] === ',' && depth === 0) return addr.slice(0, i).trim();
  }
  const lastClose = addr.lastIndexOf(')');
  return lastClose > 0 ? addr.slice(0, lastClose + 1).trim() : addr.trim();
};

const DRIVER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
  '#14b8a6', '#a855f7', '#84cc16', '#f43f5e',
  '#0ea5e9', '#d97706', '#22c55e', '#6366f1',
  '#e11d48', '#0891b2', '#65a30d', '#7c3aed',
  '#fb923c', '#34d399', '#60a5fa', '#f472b6',
  '#a78bfa', '#2dd4bf', '#facc15', '#fb7185',
  '#4ade80', '#38bdf8',
];

const ORG_COLOR_MAP = {
  blue: '#3b82f6', purple: '#a855f7', green: '#3b82f6', orange: '#f97316',
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
function ModalHeader({ onBack, title, badge, subtitle, onClose, stepLabel }) {
  return (
    <div className="shrink-0 flex items-center justify-between px-8 py-4 border-b border-[#0f1a2e]/60 bg-[#0a0f0a]">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack}
            className="p-2 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-gray-400 hover:text-white border border-[#2a2a2a] rounded-lg transition-colors">
            <ChevronLeft size={15} />
          </button>
        )}
        <div className="w-8 h-8 rounded-xl bg-blue-900/40 border border-blue-600/30 flex items-center justify-center">
          <Truck size={14} className="text-blue-400" />
        </div>
        <div>
          <h2 className="text-white font-bold text-sm flex items-center gap-2 flex-wrap">
            {title}
            {badge && <span className="text-[11px] font-black px-2 py-0.5 rounded-lg" style={badge.style}>{badge.text}</span>}
            {stepLabel && <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/30">{stepLabel}</span>}
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
  mode = 'local', allRecords = [], city, cloudCity, cloudMonthId, orgDongs, user, onStart, onClose,
  startAtMatch = false, restoreState = null,
}) {
  const effectiveCity = cloudCity || city || '';

  // ── 단계: 'org' | 'setup' | 'match'
  // startAtMatch=true: 지도에서 "이전 화면"으로 돌아온 경우 매칭 방식 선택(match) 단계부터 시작
  const [step, setStep] = useState(startAtMatch ? 'match' : 'org');

  // ── 소속사
  const [orgs, setOrgs] = useState([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [selectedOrgDongs, setSelectedOrgDongs] = useState(null);

  // ── 소속사 안정 키: driver_assignments를 소속사 '이름'으로 통일(id 변경/재생성에도 안 깨짐). 개인은 __personal__.
  const getOrgStableKey = () => selectedOrgId === '__personal__' ? '__personal__'
    : ((orgs.find(o => o.id === selectedOrgId)?.name) || selectedOrgId || 'all');
  // driver_assignments 읽기: 이름 키 우선, 비어있으면 id 키 폴백(기존 데이터 호환)
  const readOrgAssignment = async (city) => {
    const stableKey = getOrgStableKey();
    const legacyId = selectedOrgId || 'all';
    let snap = await getDoc(doc(db, 'driver_assignments', city, 'orgs', stableKey));
    if ((!snap.exists() || !(snap.data().drivers?.some(d => d.name?.trim()))) && legacyId !== stableKey) {
      const idSnap = await getDoc(doc(db, 'driver_assignments', city, 'orgs', legacyId));
      if (idSnap.exists()) snap = idSnap;
    }
    return snap;
  };

  // ── 기사 카드
  const [drivers, setDrivers] = useState([makeDriver(0), makeDriver(1)]);
  const [activeDriverIds, setActiveDriverIds] = useState(new Set());

  // ── 행정동 → 기사 매핑 {dong: [driverId, ...]}
  const [dongDriverMap, setDongDriverMap] = useState({});

  // ── 행정동 건수
  const [dongCounts, setDongCounts] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [recordRefs, setRecordRefs] = useState([]); // cloud 모드용 [{id, dong, 주소, lat, lng}]
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [saveError, setSaveError] = useState(''); // 저장 실패 메시지
  const [isFetchingCoords, setIsFetchingCoords] = useState(false);
  const [coordProgress, setCoordProgress] = useState(null); // { done, total, round }

  // ── Step 3 매칭 모드
  const [matchMode, setMatchMode] = useState(null); // null | 'all' | 'driver' | 'dong'
  const [dongSelection, setDongSelection] = useState(new Set()); // 행정동별 다중 선택

  // ── 기사매칭 프리셋 자동로드 여부
  const [savedAssignmentLoaded, setSavedAssignmentLoaded] = useState(false);

  // ── 소속사 기사 불러오기
  const [isLoadingOrgDrivers, setIsLoadingOrgDrivers] = useState(false);

  // ── 하루 기준 배송량 (포수)
  const [baseDailyQty, setBaseDailyQty] = useState(40);

  // ── 좌표 수동 보완 모달
  const [showCoordFix, setShowCoordFix] = useState(false);
  const [coordFixList, setCoordFixList] = useState([]);
  const [singleGeocodingId, setSingleGeocodingId] = useState(null);
  const [isSavingCoordFix, setIsSavingCoordFix] = useState(false);

  const openCoordFix = () => {
    setCoordFixList(noCoordTargets.map(r => ({ ...r })));
    setShowCoordFix(true);
  };

  const handleSingleGeocode = async (recordId) => {
    const target = coordFixList.find(r => r.id === recordId) ?? noCoordTargets.find(r => r.id === recordId);
    if (!target) return;
    setSingleGeocodingId(recordId);
    const addr = extractRoadAddress(target.주소);
    const tryFetch = async (url) => {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` }, signal: ctrl.signal });
        clearTimeout(tid);
        if (!res.ok) return null;
        const data = await res.json();
        const d = data.documents?.[0];
        return (d?.x && d?.y) ? { lat: parseFloat(d.y), lng: parseFloat(d.x) } : null;
      } catch { return null; }
    };
    let coord = await tryFetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(addr)}&size=1`);
    if (!coord) coord = await tryFetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(addr)}&size=1`);
    if (!coord) coord = await tryFetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent((target.dong ? `${target.dong} ` : '') + addr.slice(0, 32))}&size=1`);
    if (coord) {
      setCoordFixList(prev => prev.map(r => r.id === recordId ? { ...r, ...coord } : r));
    }
    setSingleGeocodingId(null);
  };

  const handleRetryAllFix = async () => {
    const missing = coordFixList.filter(r => !r.lat || !r.lng);
    for (const r of missing) await handleSingleGeocode(r.id);
  };

  const handleSaveCoordFixes = async () => {
    const fixed = coordFixList.filter(r => r.lat && r.lng);
    if (!fixed.length) return;
    setIsSavingCoordFix(true);
    try {
      for (let i = 0; i < fixed.length; i += 499) {
        const batch = writeBatch(db);
        fixed.slice(i, i + 499).forEach(r => {
          batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r.id), { lat: r.lat, lng: r.lng });
        });
        await batch.commit();
      }
      setRecordRefs(prev => prev.map(r => {
        const fix = fixed.find(f => f.id === r.id);
        return fix ? { ...r, lat: fix.lat, lng: fix.lng } : r;
      }));
      setShowCoordFix(false);
      alert(`✅ ${fixed.length}건 좌표 저장 완료`);
    } catch (e) { alert('저장 실패: ' + e.message); }
    finally { setIsSavingCoordFix(false); }
  };

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
    // 저장된 기사매칭 프리셋 자동로드
    if (effectiveCity) {
      (async () => {
        try {
          let snap;
          if (selectedOrgId === '__personal__') {
            const uid = user?.uid;
            if (!uid) return;
            snap = await getDoc(doc(db, 'user_driver_presets', uid, 'cities', effectiveCity));
          } else {
            const orgKey = selectedOrgId || 'all';
            snap = await getDoc(doc(db, 'driver_assignments', effectiveCity, 'orgs', orgKey));
          }
          const hasUsefulDrivers = snap?.exists() && snap.data().drivers?.some(d => d.name?.trim());
          if (hasUsefulDrivers) {
            const d = snap.data();
            setDrivers(d.drivers);
            if (d.dongDriverMap && Object.keys(d.dongDriverMap).length) setDongDriverMap(d.dongDriverMap);
            if (d.baseDailyQty) setBaseDailyQty(d.baseDailyQty);
            setSavedAssignmentLoaded(true);
          }
        } catch {}
      })();
    }
  }, [mode, allRecords, orgDongs, selectedOrgDongs]); // eslint-disable-line react-hooks/exhaustive-deps

  // 클라우드 행정동 건수 + recordRefs 수집
  useEffect(() => {
    if (mode !== 'cloud' || !cloudCity || !cloudMonthId) return;
    (async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records'));
        const counts = {};
        const refs = [];
        snap.docs.forEach(d => {
          const data = d.data();
          const dong = (data.행정동 || '').trim();
          if (!dong) return;
          if (orgDongs && !orgDongs.has(dong)) return;
          if (selectedOrgDongs && !selectedOrgDongs.has(dong)) return;
          counts[dong] = (counts[dong] || 0) + 1;
          refs.push({ id: d.id, dong, 이름: data.이름 || '', 주소: data.주소 || '', lat: data.lat || null, lng: data.lng || null });
        });
        setDongCounts(counts);
        setRecordRefs(refs);
        // "이전 화면" 복귀: 인메모리 원본 설정을 그대로 복원(DB 재로드 안 함 — 지도가 덮어쓴 손상본 방지).
        // 이게 단일 소스 오브 트루스. 휘경1동 누락·기사 왜곡의 근본 원인 제거.
        if (restoreState?.dongDriverMap && Object.keys(restoreState.dongDriverMap).length) {
          if (restoreState.drivers?.length) setDrivers(restoreState.drivers);
          setDongDriverMap(restoreState.dongDriverMap);
          if (restoreState.baseDailyQty) setBaseDailyQty(restoreState.baseDailyQty);
          if (restoreState.orgId && restoreState.orgId !== 'all') setSelectedOrgId(restoreState.orgId); // 소속사 보존
          setSavedAssignmentLoaded(true);
          return; // finally가 isLoading 해제
        }
        setDongDriverMap({});
        // 저장된 기사매칭 프리셋 자동로드 (driver_assignments → route_sessions fallback)
        try {
          let presetSnap;
          if (selectedOrgId === '__personal__') {
            const uid = user?.uid;
            if (uid) presetSnap = await getDoc(doc(db, 'user_driver_presets', uid, 'cities', effectiveCity));
          } else {
            const orgKey = selectedOrgId || 'all';
            presetSnap = await getDoc(doc(db, 'driver_assignments', effectiveCity, 'orgs', orgKey));
          }
          const hasUsefulDrivers = presetSnap?.exists() && presetSnap.data().drivers?.some(d => d.name?.trim());

          if (hasUsefulDrivers) {
            // 정상 경로: driver_assignments 에 이름 있는 기사 데이터 존재
            const d = presetSnap.data();
            setDrivers(d.drivers);
            if (d.dongDriverMap && Object.keys(d.dongDriverMap).length) setDongDriverMap(d.dongDriverMap);
            if (d.baseDailyQty) setBaseDailyQty(d.baseDailyQty);
            setSavedAssignmentLoaded(true);
          } else {
            // fallback: route_sessions 에서 기사명 로드 + cloud_lists 기사 필드로 dongDriverMap 재구성
            const sessionSnap = await getDoc(doc(db, 'route_sessions', effectiveCity, 'months', cloudMonthId));
            if (sessionSnap.exists() && sessionSnap.data().drivers?.some(d => d.name?.trim())) {
              const sessionData = sessionSnap.data();
              const loadedDrivers = sessionData.drivers;
              setDrivers(loadedDrivers);
              // 기사명 → driverId 역맵
              const nameToId = {};
              loadedDrivers.forEach(d => { if (d.name) nameToId[d.name] = d.id; });
              // snap.docs (cloud_lists 레코드)의 기사 필드로 dongDriverMap 재구성
              const newDongMap = {};
              snap.docs.forEach(recDoc => {
                const recData = recDoc.data();
                const dong = (recData.행정동 || '').trim();
                const driverName = (recData.기사 || '').trim();
                if (!dong || !driverName || !nameToId[driverName]) return;
                if (orgDongs && !orgDongs.has(dong)) return;
                if (selectedOrgDongs && !selectedOrgDongs.has(dong)) return;
                if (!newDongMap[dong]) newDongMap[dong] = [];
                if (!newDongMap[dong].includes(nameToId[driverName])) newDongMap[dong].push(nameToId[driverName]);
              });
              if (Object.keys(newDongMap).length > 0) setDongDriverMap(newDongMap);
              if (sessionData.baseDailyQty) setBaseDailyQty(sessionData.baseDailyQty);
              setSavedAssignmentLoaded(true);
            }
          }
        } catch {}
      } catch (e) { console.error('행정동 로드 실패:', e); }
      finally { setIsLoading(false); }
    })();
  }, [mode, cloudCity, cloudMonthId, orgDongs, selectedOrgDongs]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (drivers.length >= 30) return;
    setDrivers(prev => {
      const usedColors = new Set(prev.map(d => d.color));
      const nextColor = DRIVER_COLORS.find(c => !usedColors.has(c)) ?? DRIVER_COLORS[prev.length % DRIVER_COLORS.length];
      return [...prev, { id: `d_${++_seq}`, name: '', phone: '', capacity: 100, color: nextColor }];
    });
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
    setSavedAssignmentLoaded(false);
    setStep('setup');
  };

  // 개인 기사 선택
  const handleSelectPersonal = () => {
    setSelectedOrgId('__personal__');
    setSelectedOrgDongs(null);
    setDongDriverMap({});
    setSavedAssignmentLoaded(false);
    setStep('setup');
  };

  // ── 좌표 통계 (배정된 동 기준)
  const assignedRecordRefs = useMemo(() => recordRefs.filter(r => assignedDongs.has(r.dong)), [recordRefs, assignedDongs]);
  const coordCount = useMemo(() => assignedRecordRefs.filter(r => r.lat && r.lng).length, [assignedRecordRefs]);
  const coordPct = assignedRecordRefs.length > 0 ? Math.round(coordCount / assignedRecordRefs.length * 100) : 0;
  const noCoordTargets = useMemo(() => assignedRecordRefs.filter(r => !r.lat || !r.lng), [assignedRecordRefs]);

  // ── 전체 좌표지정 (Kakao 3라운드)
  const handleBulkGeocode = async () => {
    if (!noCoordTargets.length || isFetchingCoords || !cloudCity || !cloudMonthId) return;
    setIsFetchingCoords(true);
    const updates = {};
    const cacheCity = cloudCity;
    const addrToDocId = (addr) => (addr || '').replace(/[/]/g, '_').slice(0, 400);
    const getCached = async (city, addr) => {
      try {
        const snap = await getDoc(doc(db, 'coordinate_cache', city, 'addresses', addrToDocId(addr)));
        if (snap.exists()) { const d = snap.data(); return { lat: d.lat, lng: d.lng }; }
      } catch {}
      return null;
    };
    const saveCache = async (city, addr, lat, lng) => {
      try { await setDoc(doc(db, 'coordinate_cache', city, 'addresses', addrToDocId(addr)), { address: addr, lat, lng, fetchedAt: serverTimestamp() }, { merge: true }); } catch {}
    };
    const fetchCoord = async (url) => {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` }, signal: ctrl.signal });
        clearTimeout(tid);
        if (!res.ok) return null;
        const data = await res.json();
        const d = data.documents?.[0];
        return (d?.x && d?.y) ? { lat: parseFloat(d.y), lng: parseFloat(d.x) } : null;
      } catch { clearTimeout(tid); return null; }
    };
    // 캐시 라운드
    setCoordProgress({ done: 0, total: noCoordTargets.length, round: 0 });
    for (const r of noCoordTargets) {
      const cached = await getCached(cacheCity, extractRoadAddress(r.주소));
      if (cached) updates[r.id] = cached;
      setCoordProgress(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
    }
    const runRound = async (targets, round, queryFn) => {
      if (!targets.length) return;
      setCoordProgress({ done: 0, total: targets.length, round });
      const executing = new Set();
      for (const r of targets) {
        const p = (async () => {
          const coord = await fetchCoord(queryFn(r));
          if (coord) { updates[r.id] = coord; await saveCache(cacheCity, extractRoadAddress(r.주소), coord.lat, coord.lng); }
          setCoordProgress(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
        })().then(() => executing.delete(p));
        executing.add(p);
        if (executing.size >= 5) await Promise.race(executing);
      }
      await Promise.all(executing);
    };
    try {
      await runRound(noCoordTargets.filter(r => !updates[r.id]), 1, r => `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(extractRoadAddress(r.주소))}&size=1`);
      await runRound(noCoordTargets.filter(r => !updates[r.id]), 2, r => `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(extractRoadAddress(r.주소))}&size=1`);
      await runRound(noCoordTargets.filter(r => !updates[r.id]), 3, r => `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent((r.dong ? `${r.dong} ` : '') + extractRoadAddress(r.주소).slice(0, 35))}&size=1`);
      if (Object.keys(updates).length) {
        const entries = Object.entries(updates);
        for (let i = 0; i < entries.length; i += 499) {
          const batch = writeBatch(db);
          entries.slice(i, i + 499).forEach(([id, coord]) => {
            batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', id), { lat: coord.lat, lng: coord.lng });
          });
          await batch.commit();
        }
        setRecordRefs(prev => prev.map(r => updates[r.id] ? { ...r, ...updates[r.id] } : r));
      }
      const success = Object.keys(updates).length;
      const remain = noCoordTargets.length - success;
      alert(`✅ 좌표 지정 완료\n성공 ${success}/${noCoordTargets.length}건${remain > 0 ? `\n미완료 ${remain}건은 주소 재확인이 필요합니다.` : ' (100%!)'}`);
    } catch (e) { console.error('좌표 지정 실패:', e); }
    finally { setIsFetchingCoords(false); setCoordProgress(null); }
  };

  // ── cloud 기사 배정 일괄 저장 (행정동 → 기사명 매핑 후 records 업데이트)
  const saveDriverAssignment = async () => {
    if (mode !== 'cloud' || !cloudCity || !cloudMonthId || recordRefs.length === 0) return;
    const dongToName = {};
    Object.entries(dongDriverMap).forEach(([dong, ids]) => {
      if (!ids.length) return;
      const names = ids.map(id => drivers.find(d => d.id === id)?.name || '').filter(Boolean);
      dongToName[dong] = names.join('/');
    });
    const CHUNK = 499;
    for (let i = 0; i < recordRefs.length; i += CHUNK) {
      const batch = writeBatch(db);
      recordRefs.slice(i, i + CHUNK).forEach(({ id, dong }) => {
        batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', id), { 기사: dongToName[dong] || '' });
      });
      await batch.commit();
    }
  };

  // ── 기사매칭 프리셋 저장
  // 개인 모드: user_driver_presets/{uid}/cities/{city} (사용자 소유, 권한 보장)
  // 소속사 모드: driver_assignments/{city}/orgs/{orgKey} (소속사 관리 경로)
  const saveDriverAssignmentPreset = async () => {
    if (!effectiveCity) return;
    const namedDrivers = drivers.filter(d => d.name.trim());
    if (namedDrivers.length === 0) return;
    if (isPersonalDriverMode) {
      const uid = user?.uid;
      if (!uid) return;
      await setDoc(doc(db, 'user_driver_presets', uid, 'cities', effectiveCity), {
        city: effectiveCity,
        drivers,
        dongDriverMap,
        baseDailyQty,
        savedAt: serverTimestamp(),
      });
    } else {
      const orgKey = selectedOrgId || 'all';
      const orgObj = orgs.find(o => o.id === selectedOrgId);
      const orgName = orgObj?.name || '전체';
      await setDoc(doc(db, 'driver_assignments', effectiveCity, 'orgs', orgKey), {
        city: effectiveCity,
        orgId: selectedOrgId || null,
        orgName,
        drivers,
        dongDriverMap,
        baseDailyQty,
        savedAt: serverTimestamp(),
      });
    }
  };

  // ── "다음" 버튼 핸들러 — 배정 저장 후 매칭 단계 이동
  const handleNextStep = async () => {
    setIsSavingAssignment(true);
    setSaveError('');
    try {
      if (mode === 'cloud' && cloudCity && cloudMonthId && assignedDongs.size > 0) {
        await saveDriverAssignment();
      }
      await saveDriverAssignmentPreset();
    } catch (e) {
      console.error('기사 배정 저장 실패:', e);
      setSaveError(`저장 실패: ${e.code === 'permission-denied' ? '권한 없음 — 관리자에게 문의하세요' : e.message}`);
      setIsSavingAssignment(false);
      return; // 저장 실패 시 다음 단계로 넘어가지 않음
    }
    setIsSavingAssignment(false);
    setMatchMode(null);
    setStep('match');
  };

  // ── onStart 헬퍼
  const doStart = ({ selectedDongs, startDrivers, map }) => {
    const allNamedDrivers = drivers.filter(d => d.name.trim());
    const validDrivers = startDrivers.filter(d => d.name.trim());
    const finalDrivers = validDrivers.length > 0 ? validDrivers : [
      { id: 'd1', name: '기사1', phone: '', capacity: 100, color: DRIVER_COLORS[0] },
      { id: 'd2', name: '기사2', phone: '', capacity: 100, color: DRIVER_COLORS[1] },
    ];
    onStart({
      selectedDongs,
      drivers: finalDrivers,
      companyDrivers: allNamedDrivers.length ? allNamedDrivers : finalDrivers,
      dongDriverMap: Object.keys(dongDriverMap).length ? dongDriverMap : map,
      baseDailyQty,
      orgId: selectedOrgId || 'all',
    });
  };

  // ── 기사 마스터에서 불러오기 (소속사 또는 개인기사)
  const handleLoadOrgDrivers = async () => {
    if (!effectiveCity) return;

    // ── 개인 기사 모드 분기
    if (isPersonalDriverMode) {
      const uid = user?.uid;
      if (!uid) { alert('사용자 정보가 없습니다.'); return; }
      setIsLoadingOrgDrivers(true);
      try {
        const companyCode = user?.companyCode;
        const colPath = companyCode
          ? collection(db, 'user_companies', companyCode, 'drivers')
          : collection(db, 'user_drivers', uid, 'drivers');
        const snap = await getDocs(colPath);
        const loaded = snap.docs
          .map(d => ({ _docId: d.id, ...d.data() }))
          .filter(d => d.status !== 'inactive')
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
        if (!loaded.length) { alert('등록된 기사가 없습니다.\n메뉴 → 기사 관리에서 기사를 등록하세요.'); return; }
        const mapped = loaded.map((d, idx) => ({
          id: d._docId, name: d.name || '', phone: d.phone || '',
          capacity: d.capacity ?? 100, color: d.color || DRIVER_COLORS[idx % DRIVER_COLORS.length],
        }));
        setDrivers(mapped);
        const newDongMap = {};
        loaded.forEach(d => {
          const cityZone = (d.assignedZones || []).find(z => z.city === effectiveCity);
          if (!cityZone) return;
          cityZone.dongs.forEach(dong => {
            if (!newDongMap[dong]) newDongMap[dong] = [];
            if (!newDongMap[dong].includes(d._docId)) newDongMap[dong].push(d._docId);
          });
        });
        setDongDriverMap(newDongMap);
        setSavedAssignmentLoaded(Object.keys(newDongMap).length > 0);
      } catch (e) { alert('기사 불러오기 실패: ' + e.message); }
      finally { setIsLoadingOrgDrivers(false); }
      return;
    }

    // ── 소속사 기사 모드
    const orgObj = orgs.find(o => o.id === selectedOrgId);
    const orgName = orgObj?.name || user?.orgId || '';
    if (!orgName) {
      // 소속사 미선택 시: 이전 단계로 안내
      if (window.confirm('소속사가 선택되지 않았습니다.\n\n← 이전 화면에서 소속사 카드를 선택하면\n등록된 기사 명단을 자동으로 불러올 수 있습니다.\n\n이전 화면으로 돌아가시겠습니까?')) {
        setStep('org');
      }
      return;
    }
    setIsLoadingOrgDrivers(true);
    try {
      const snap = await getDocs(collection(db, 'org_drivers', orgName, 'drivers'));
      const loaded = snap.docs
        .map(d => ({ _docId: d.id, ...d.data() }))
        .filter(d => d.status !== 'inactive') // 비활성만 제외, zone 필터 없음
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
      if (!loaded.length) { alert('등록된 기사가 없습니다.\n메뉴 → 소속사 기사 관리에서 기사를 등록하세요.'); return; }
      const mapped = loaded.map((d, idx) => ({
        id: d._docId,
        name: d.name || '',
        phone: d.phone || '',
        capacity: d.capacity ?? 100,
        color: d.color || DRIVER_COLORS[idx % DRIVER_COLORS.length],
      }));
      setDrivers(mapped);

      // assignedZones → dongDriverMap 자동 재구성
      const newDongMap = {};
      loaded.forEach(d => {
        const cityZone = (d.assignedZones || []).find(z => z.city === effectiveCity);
        if (!cityZone) return;
        cityZone.dongs.forEach(dong => {
          if (!newDongMap[dong]) newDongMap[dong] = [];
          if (!newDongMap[dong].includes(d._docId)) newDongMap[dong].push(d._docId);
        });
      });
      setDongDriverMap(newDongMap);
      setSavedAssignmentLoaded(Object.keys(newDongMap).length > 0);
    } catch (e) {
      alert('기사 불러오기 실패: ' + e.message);
    } finally {
      setIsLoadingOrgDrivers(false);
    }
  };

  // 전체 시작 — 동에 배정된 기사만 전달 (저장된 프리셋 잔여 기사 제외)
  const handleStartAll = () => doStart({
    selectedDongs: assignedDongs,
    startDrivers: assignedDrivers.length > 0 ? assignedDrivers : drivers,
    map: dongDriverMap,
  });

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

  // 행정동별 시작 (다중 선택) — 선택한 '모든' 동 + 그 동들 담당 기사 전체 + 전체 매핑을 넘김
  const handleStartForSelectedDongs = () => {
    if (!dongSelection.size) return;
    const orderedSelection = dongList.filter(dong => dongSelection.has(dong));
    if (!orderedSelection.length) return;
    const map = {};
    const driverIdSet = new Set();
    orderedSelection.forEach(dong => {
      const ids = dongDriverMap[dong] || [];
      map[dong] = ids;
      ids.forEach(id => driverIdSet.add(id));
    });
    const dongDrivers = drivers.filter(d => driverIdSet.has(d.id));
    doStart({ selectedDongs: new Set(orderedSelection), startDrivers: dongDrivers, map });
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
  const isPersonalDriverMode = selectedOrgId === '__personal__';
  const activeDriverList = drivers.filter(d => activeDriverIds.has(d.id));
  const assignedDrivers = drivers.filter(d =>
    Object.values(dongDriverMap).some(ids => ids.includes(d.id))
  );

  const headerSubtitle = mode === 'cloud' ? `${cloudCity} · ${cloudMonthId}` : '로컬 데이터';
  const orgBadge = isPersonalDriverMode
    ? { text: '내 기사', style: { background: '#22c55e22', color: '#22c55e' } }
    : selectedOrg
      ? { text: selectedOrg.name, style: { background: (ORG_COLOR_MAP[selectedOrg.color] || '#6b7280') + '22', color: ORG_COLOR_MAP[selectedOrg.color] || '#6b7280' } }
      : null;

  // ══════════════════════════════════════
  // Step 1: 소속사 선택
  // ══════════════════════════════════════
  if (step === 'org') {
    return (
      <div className="fixed inset-0 z-[800] flex flex-col bg-[#060606]">
        <div className="shrink-0 flex items-center justify-between px-8 py-5 border-b border-[#0f1a2e]/60 bg-[#0a0f0a]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-900/40 border border-blue-600/30 flex items-center justify-center">
              <Truck size={17} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-white font-black text-base flex items-center gap-2">
                배송 구역 배정
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/30">1 / 3 소속사 선택</span>
              </h2>
              <p className="text-gray-500 text-[11px] mt-0.5">
                {effectiveCity || headerSubtitle} · 소속사 카드 클릭 → 전체는 &quot;전체 진행&quot; 클릭
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
                  className="flex flex-col items-center justify-center gap-3 p-7 rounded-2xl border-2 border-dashed border-[#2a3a2a] hover:border-blue-600/50 bg-black/20 hover:bg-blue-900/10 text-gray-400 hover:text-blue-300 transition-all group min-h-[160px]">
                  <div className="w-14 h-14 rounded-2xl bg-[#1a2e1a]/60 group-hover:bg-blue-900/30 border border-blue-800/30 flex items-center justify-center transition-all">
                    <MapPin size={24} className="text-blue-600 group-hover:text-blue-400" />
                  </div>
                  <div className="text-center">
                    <div className="text-white font-black text-sm">전체 진행</div>
                    <div className="text-gray-600 text-[10px] mt-0.5">소속사 구분 없이 전체</div>
                  </div>
                </button>

                {/* 내 기사 (개인 기사 명단) */}
                {user?.uid && (
                  <button onClick={handleSelectPersonal}
                    className="flex flex-col items-start gap-3 p-6 rounded-2xl border-2 transition-all hover:scale-[1.02] text-left min-h-[160px]"
                    style={{ background: '#22c55e10', borderColor: '#22c55e40' }}>
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
                      style={{ background: '#22c55e22', border: '1.5px solid #22c55e55' }}>
                      <Users size={22} style={{ color: '#22c55e' }} />
                    </div>
                    <div className="flex-1 min-w-0 w-full">
                      <div className="text-white font-black text-sm">내 기사</div>
                      <div className="text-[10px] mt-1" style={{ color: '#22c55e' }}>개인 기사 명단 사용</div>
                      <div className="text-[9px] text-gray-600 mt-0.5">소속사 없이 루트맵 진행</div>
                    </div>
                  </button>
                )}

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
          subtitle={`${headerSubtitle} · 기사 카드 클릭(활성화) → 행정동 클릭(배정) → 다음`}
          onClose={onClose}
          stepLabel="2 / 3 기사·행정동 배정"
        />

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* ── 좌측: 기사 카드 */}
          <div className="w-[46%] shrink-0 border-r border-[#1a1a1a] flex flex-col overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#1a1a1a] flex items-center justify-between shrink-0 gap-2">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-white font-black text-[13px]">기사 등록</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#1a1a1a] text-gray-500 font-bold">{drivers.length}/30명</span>
                {activeDriverIds.size > 0 && (
                  <span className="text-blue-400 font-bold text-[11px]">{activeDriverIds.size}명 선택</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {/* 소속사 기사 불러오기 — 소속사 선택 시 활성화 */}
                <button
                  onClick={handleLoadOrgDrivers}
                  disabled={isLoadingOrgDrivers || !effectiveCity}
                  title={selectedOrgId || user?.orgId
                    ? `${orgs.find(o=>o.id===selectedOrgId)?.name || user?.orgId || '소속사'} 기사 명단 불러오기`
                    : '← 이전에서 소속사를 선택하면 기사 명단이 자동 로드됩니다'}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-900/30 hover:bg-purple-700/40 text-purple-300 text-[11px] font-bold border border-purple-700/30 rounded-lg transition-colors disabled:opacity-40">
                  {isLoadingOrgDrivers
                    ? <><RefreshCw size={11} className="animate-spin" />불러오는 중...</>
                    : <><CloudDownload size={11} /> 기사 불러오기</>}
                </button>
                <button onClick={addDriver} disabled={drivers.length >= 30}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/30 hover:bg-blue-700/40 text-blue-400 text-[11px] font-bold border border-blue-700/30 rounded-lg transition-colors disabled:opacity-40">
                  <Plus size={12} /> 기사 추가
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <div className="grid grid-cols-3 gap-1.5">
                {drivers.map((driver, idx) => {
                  const isActive = activeDriverIds.has(driver.id);
                  const assignedDongNames = Object.entries(dongDriverMap)
                    .filter(([, ids]) => ids.includes(driver.id)).map(([d]) => d);
                  return (
                    <div key={driver.id} onClick={() => toggleDriverActive(driver.id)}
                      className="rounded-xl border p-2 cursor-pointer transition-all select-none"
                      style={{
                        background: isActive ? driver.color + '18' : '#0d0d0d',
                        borderColor: isActive ? driver.color + '70' : '#2a2a2a',
                        boxShadow: isActive ? `0 0 0 1px ${driver.color}30, 0 2px 12px ${driver.color}12` : 'none',
                      }}>
                      {/* 행 1: 번호 + 이름 + 삭제 */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[8px] font-black text-white"
                          style={{ background: driver.color }}>{idx + 1}</div>
                        <input value={driver.name} onChange={e => { e.stopPropagation(); updateDriver(driver.id, 'name', e.target.value); }}
                          onClick={e => e.stopPropagation()} placeholder="이름"
                          className="flex-1 min-w-0 bg-black/30 border border-[#2a2a2a] focus:border-blue-500/50 rounded px-1.5 py-0.5 text-[10px] text-white placeholder-gray-700 outline-none font-bold transition-colors" />
                        <button onClick={e => { e.stopPropagation(); removeDriver(driver.id); }}
                          className="p-0.5 text-gray-700 hover:text-red-400 transition-colors shrink-0"><Trash2 size={9} /></button>
                      </div>
                      {/* 행 2: 슬라이더 + % + 최대포수 */}
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input type="range" min={10} max={200} step={5} value={driver.capacity}
                          onChange={e => updateDriver(driver.id, 'capacity', parseInt(e.target.value))}
                          className="flex-1 h-1" style={{ accentColor: driver.color }} />
                        <span className="text-[9px] font-black w-6 text-right shrink-0" style={{ color: driver.color }}>{driver.capacity}%</span>
                      </div>
                      <div className="flex items-center justify-end mt-0.5" onClick={e => e.stopPropagation()}>
                        <span className="text-[8px] font-bold tabular-nums" style={{ color: driver.color + 'aa' }}>
                          최대 {Math.round(baseDailyQty * (driver.capacity || 100) / 100)}포
                        </span>
                      </div>
                      {/* 행 3: 배정 동 태그 */}
                      {assignedDongNames.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-1.5 pt-1 border-t border-[#1a1a1a]">
                          {assignedDongNames.map(d => (
                            <span key={d} className="text-[7px] px-1 py-0.5 rounded font-bold"
                              style={{ background: driver.color + '20', color: driver.color }}>{d}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {drivers.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-gray-700 text-sm gap-2">
                  <Plus size={20} className="opacity-40" />기사를 추가해주세요
                </div>
              )}
            </div>
          </div>

          {/* ── 우측: 행정동 배정 */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-6">
            {/* 하루 기준 배송량 입력 */}
            <div className="mb-3 shrink-0 px-4 py-2.5 rounded-xl bg-[#080f08] border border-[#1a2a1a] flex items-center gap-3">
              <span className="text-gray-400 text-[11px] font-bold shrink-0">기사 1인 하루 배송량</span>
              <input
                type="number" min={1} max={999} value={baseDailyQty}
                onChange={e => setBaseDailyQty(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 bg-[#111] border border-[#2a2a2a] text-white text-sm font-black rounded-lg px-2 py-1 text-center outline-none focus:border-blue-500/50 tabular-nums"
              />
              <span className="text-gray-600 text-[11px]">포 <span className="text-gray-700">(업무능력 100% 기준)</span></span>
              <div className="ml-auto flex items-center gap-2 text-[10px]">
                <span className="text-gray-600">전체 수용</span>
                <span className="font-black text-blue-400 tabular-nums">
                  {drivers.reduce((s, d) => s + Math.round(baseDailyQty * (d.capacity || 100) / 100), 0)}포
                </span>
                {totalSelected > 0 && (
                  <>
                    <span className="text-gray-700">/ 총 배송</span>
                    <span className={`font-black tabular-nums ${
                      totalSelected > drivers.reduce((s, d) => s + Math.round(baseDailyQty * (d.capacity || 100) / 100), 0)
                        ? 'text-red-400' : 'text-green-400'
                    }`}>{totalSelected}건</span>
                  </>
                )}
              </div>
            </div>

            {/* 이전 배정 자동로드 알림 */}
            {savedAssignmentLoaded && (
              <div className="mb-3 shrink-0 px-3 py-2 rounded-xl bg-blue-900/15 border border-blue-700/25 text-[11px] text-blue-300 font-bold flex items-center gap-2">
                <CheckCircle size={12} className="text-blue-400 shrink-0" />
                이전 기사 배정 내역이 자동 적용되었습니다
                <button
                  onClick={() => { setDrivers([makeDriver(0), makeDriver(1)]); setDongDriverMap({}); setSavedAssignmentLoaded(false); }}
                  className="ml-auto text-[10px] text-gray-500 hover:text-red-400 transition-colors shrink-0"
                >
                  초기화
                </button>
              </div>
            )}
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
              ) : '← 기사 카드를 클릭해 활성화 → 오른쪽 행정동 클릭으로 배정 (여러 명 동시 선택 가능)'}
            </div>

            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-blue-400" />
                <span className="text-white font-black text-[13px]">행정동 배정</span>
                {!isLoading && (
                  <span className="text-gray-600 text-[11px]">
                    배정 <span className="text-blue-400 font-bold">{totalSelected.toLocaleString()}</span>건 / 전체 {totalAll.toLocaleString()}건 · {assignedDongs.size}개 동
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleSelectAll} disabled={activeDriverIds.size === 0}
                  className="px-3 py-1.5 rounded-lg bg-blue-900/30 hover:bg-blue-700/40 text-blue-400 text-[11px] font-bold border border-blue-800/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
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
                            ? isActiveAll ? 'border-blue-500/60 bg-blue-900/20 hover:bg-blue-900/30' : 'border-[#2a4a2a] bg-blue-900/10 hover:bg-blue-900/15'
                            : activeDriverIds.size > 0
                            ? 'border-[#2a2a2a] bg-black/30 hover:border-[#4a4a4a] hover:bg-black/50'
                            : 'border-[#1a1a1a] bg-black/20 cursor-not-allowed'
                        }`}>
                        <div className="flex items-center justify-between w-full">
                          <span className={`text-[12px] font-bold truncate ${hasAssignment ? 'text-blue-200' : 'text-gray-500'}`}>{dong}</span>
                          <span className={`text-[10px] font-bold ml-2 shrink-0 tabular-nums ${hasAssignment ? 'text-blue-500' : 'text-gray-700'}`}>
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
        <div className="shrink-0 border-t border-[#0f1a2e]/60 bg-[#0a0f0a]">
          {saveError && (
            <div className="px-8 py-2 flex items-center gap-2 bg-red-950/40 border-b border-red-700/30">
              <span className="text-red-400 text-xs font-bold">⚠ {saveError}</span>
              <button onClick={() => setSaveError('')} className="ml-auto text-red-600 hover:text-red-400 text-xs">✕</button>
            </div>
          )}
          <div className="px-8 py-4 flex items-center justify-between gap-4">
            <div className="text-[11px] leading-relaxed">
              {(() => { const n = drivers.filter(d => d.name.trim()).length; return n > 0 ? <span className="text-blue-400/80">기사 {n}명</span> : <span className="text-gray-600">기사 미입력 → 기본 2명</span>; })()}
              {assignedDongs.size > 0 ? (
                <span className="ml-3">· 행정동 <span className="text-blue-400/80 font-bold">{assignedDongs.size}개</span> (<span className="text-blue-400/80">{totalSelected.toLocaleString()}</span>건)</span>
              ) : <span className="ml-3 text-amber-500/80 font-bold animate-pulse">← 기사 선택 후 행정동을 배정해주세요</span>}
            </div>
            <button onClick={handleNextStep} disabled={assignedDongs.size === 0 || isLoading || isSavingAssignment}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-black text-[13px] transition-all shrink-0 ${
                assignedDongs.size > 0 && !isLoading && !isSavingAssignment
                  ? 'bg-blue-700 hover:bg-blue-600 text-white shadow-[0_4px_20px_rgba(59,130,246,0.3)]'
                  : 'bg-gray-800/60 text-gray-600 cursor-not-allowed'
              }`}>
              {isSavingAssignment
                ? <><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" /> 저장 중...</>
                : <><Play size={14} /> 다음 — 매칭 방식 선택 <ChevronRight size={14} /></>
              }
            </button>
          </div>
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
      icon: <Navigation2 size={28} className="text-blue-400" />,
      label: '전체 한번에',
      desc: '배정된 모든 기사·행정동을 동시에 지도에서 배송순번 지정',
      color: '#3b82f6',
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
        subtitle={`${headerSubtitle} · 전체·기사별·행정동별 중 원하는 방식으로 루트맵 시작`}
        onClose={onClose}
        stepLabel="3 / 3 매칭 시작"
      />

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* 배정 요약 */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: '배정 기사', value: `${assignedDrivers.length}명`, color: '#3b82f6' },
              { label: '작업 행정동', value: `${assignedDongs.size}개`, color: '#3b82f6' },
              { label: '총 배송건', value: `${totalSelected.toLocaleString()}건`, color: '#f97316' },
            ].map(s => (
              <div key={s.label} className="bg-[#0d0d0d] border border-[#1e1e1e] rounded-2xl px-4 py-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: s.color + '18' }}>
                  <span className="text-base font-black" style={{ color: s.color }}>{s.value}</span>
                </div>
                <span className="text-gray-500 text-[11px] font-bold">{s.label}</span>
              </div>
            ))}
            {/* 좌표 현황 카드 — cloud 모드이고 레코드 있으면 항상 표시 */}
            {mode === 'cloud' && assignedRecordRefs.length > 0 && (
              <div className={`rounded-2xl px-4 py-3 flex flex-col gap-1.5 border ${
                coordPct === 100 ? 'bg-[#0a1a0a] border-blue-800/40' : 'bg-[#1a0a00] border-orange-800/40'
              }`}>
                <div className="flex items-center gap-2">
                  <Crosshair size={14} className={coordPct === 100 ? 'text-blue-400' : 'text-orange-400'} />
                  <span className="text-[10px] font-bold text-gray-500">좌표 현황</span>
                  <span className={`ml-auto text-[12px] font-black ${coordPct === 100 ? 'text-blue-400' : 'text-orange-400'}`}>
                    {coordPct}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${coordPct}%`, background: coordPct === 100 ? '#3b82f6' : '#f97316' }} />
                </div>
                <div className="text-[10px] font-bold" style={{ color: coordPct === 100 ? '#3b82f6' : '#f97316' }}>
                  {coordCount.toLocaleString()} / {assignedRecordRefs.length.toLocaleString()}건
                </div>
              </div>
            )}
          </div>

          {/* 전체 좌표지정 버튼 */}
          {mode === 'cloud' && noCoordTargets.length > 0 && (
            <div className="bg-[#120a00] border border-orange-800/30 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-orange-300 font-black text-sm mb-0.5">
                  좌표 미지정 <span className="text-orange-400">{noCoordTargets.length.toLocaleString()}건</span> 발견
                </div>
                <div className="text-gray-500 text-[11px]">Kakao 자동 지정 또는 수동 보완으로 루트맵 정확도를 높이세요.</div>
                {coordProgress && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 w-48 bg-[#1a1a1a] rounded-full overflow-hidden">
                      <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${coordProgress.total > 0 ? Math.round(coordProgress.done / coordProgress.total * 100) : 0}%` }} />
                    </div>
                    <span className="text-orange-400 text-[10px] font-bold">
                      {coordProgress.round === 0 ? '캐시 확인' : `${coordProgress.round}라운드`} {coordProgress.done}/{coordProgress.total}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={openCoordFix}
                  disabled={isFetchingCoords}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-black text-sm transition-all bg-[#1a1a1a] hover:bg-[#2a2a2a] text-orange-300 border border-orange-800/40 disabled:opacity-40"
                >
                  <RefreshCw size={14} /> 수동 보완
                </button>
                <button
                  onClick={handleBulkGeocode}
                  disabled={isFetchingCoords}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm transition-all bg-orange-700 hover:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed text-white"
                >
                  {isFetchingCoords
                    ? <><Loader2 size={14} className="animate-spin" /> 지정 중...</>
                    : <><Crosshair size={14} /> 전체 자동지정</>
                  }
                </button>
              </div>
            </div>
          )}

          {/* 기사별 배분 현황 */}
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(assignedDrivers.length, 3)}, 1fr)` }}>
            {assignedDrivers.map((d, idx) => {
              const dDongs = Object.entries(dongDriverMap).filter(([, ids]) => ids.includes(d.id)).map(([dong]) => dong);
              const cnt = dDongs.reduce((s, dong) => s + (dongCounts[dong] || 0), 0);
              const pct = totalSelected > 0 ? Math.round(cnt / totalSelected * 100) : 0;
              // 기사별 좌표 현황 (cloud 모드, recordRefs 있을 때)
              const driverRefs = mode === 'cloud' ? recordRefs.filter(r => dDongs.includes(r.dong)) : [];
              const driverCoordCount = driverRefs.filter(r => r.lat && r.lng).length;
              const driverCoordPct = driverRefs.length > 0 ? Math.round(driverCoordCount / driverRefs.length * 100) : null;
              return (
                <div key={d.id}
                  className="rounded-2xl p-4 flex flex-col gap-2"
                  style={{ background: d.color + '0e', border: `1.5px solid ${d.color}30` }}
                >
                  {/* 상단: 번호 + 이름 + 배분% 뱃지 */}
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-black shrink-0"
                      style={{ background: d.color }}>
                      {idx + 1}
                    </div>
                    <span className="text-white font-black text-[13px] flex-1 truncate">{d.name || `기사${idx+1}`}</span>
                    <span className="text-[12px] font-black px-2 py-0.5 rounded-lg"
                      style={{ background: d.color + '25', color: d.color }}>
                      {pct}%
                    </span>
                  </div>
                  {/* 배분 프로그레스바 */}
                  <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${d.color}cc, ${d.color})` }} />
                  </div>
                  {/* 동 + 건수 */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] truncate" style={{ color: d.color + 'aa' }}>
                      {dDongs.join(' · ') || '—'}
                    </span>
                    <span className="text-[11px] font-black shrink-0 ml-2" style={{ color: d.color }}>
                      {cnt.toLocaleString()}건
                    </span>
                  </div>
                  {/* 좌표 현황 (cloud 모드만) */}
                  {driverCoordPct !== null && (
                    <div className="flex items-center gap-1.5 pt-0.5 border-t border-[#1a1a1a]">
                      <Crosshair size={10} style={{ color: driverCoordPct === 100 ? '#3b82f6' : '#f97316' }} />
                      <div className="flex-1 h-1 rounded-full bg-[#1a1a1a] overflow-hidden">
                        <div className="h-full rounded-full"
                          style={{ width: `${driverCoordPct}%`, background: driverCoordPct === 100 ? '#3b82f6' : '#f97316' }} />
                      </div>
                      <span className="text-[10px] font-bold shrink-0"
                        style={{ color: driverCoordPct === 100 ? '#3b82f6' : '#f97316' }}>
                        {driverCoordCount}/{driverRefs.length} ({driverCoordPct}%)
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 모드 선택 카드 — 3D 강조 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-white font-black text-sm">배송 방식을 선택하세요</span>
              <span className="text-gray-600 text-[11px]">카드를 클릭하면 선택됩니다</span>
            </div>
            <div className="grid grid-cols-3 gap-5">
              {MATCH_MODES.map((m, idx) => {
                const isSelected = matchMode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => { setMatchMode(isSelected ? null : m.id); setDongSelection(new Set()); }}
                    className="relative flex flex-col items-start text-left select-none outline-none transition-all duration-150"
                    style={{
                      transform: isSelected ? 'translateY(4px)' : 'translateY(0)',
                    }}
                  >
                    {/* 3D 바닥 레이어 */}
                    <div
                      className="absolute inset-0 rounded-2xl"
                      style={{
                        background: isSelected ? m.color + 'cc' : m.color + '55',
                        transform: 'translateY(6px)',
                        filter: 'blur(1px)',
                        borderRadius: '16px',
                      }}
                    />
                    {/* 메인 카드 */}
                    <div
                      className="relative w-full rounded-2xl p-6 flex flex-col transition-all duration-150"
                      style={{
                        background: isSelected
                          ? `linear-gradient(135deg, ${m.color}28 0%, ${m.color}14 100%)`
                          : 'linear-gradient(135deg, #111 0%, #0a0a0a 100%)',
                        border: `2px solid ${isSelected ? m.color + 'cc' : m.color + '33'}`,
                        boxShadow: isSelected
                          ? `0 0 0 1px ${m.color}44, inset 0 1px 0 rgba(255,255,255,0.08), 0 0 32px ${m.color}30`
                          : `inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.4)`,
                      }}
                    >
                      {/* 선택 뱃지 */}
                      {isSelected && (
                        <div
                          className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center font-black text-[11px] text-black animate-pulse"
                          style={{ background: m.color }}
                        >✓</div>
                      )}
                      {/* 번호 + 아이콘 */}
                      <div className="flex items-center gap-3 mb-4">
                        <div
                          className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
                          style={{
                            background: isSelected ? m.color : m.color + '22',
                            color: isSelected ? '#000' : m.color,
                            boxShadow: isSelected ? `0 2px 8px ${m.color}66` : 'none',
                          }}
                        >{idx + 1}</div>
                        <div
                          className="w-12 h-12 rounded-2xl flex items-center justify-center"
                          style={{
                            background: isSelected ? m.color + '30' : m.color + '14',
                            border: `1.5px solid ${m.color}${isSelected ? '60' : '25'}`,
                          }}
                        >{m.icon}</div>
                      </div>
                      <div className="font-black text-white text-[15px] mb-1.5" style={{ textShadow: isSelected ? `0 0 20px ${m.color}80` : 'none' }}>
                        {m.label}
                      </div>
                      <div className="text-gray-500 text-[11px] leading-relaxed mb-4 flex-1">{m.desc}</div>
                      <div
                        className="text-[11px] font-bold px-3 py-1 rounded-lg self-start"
                        style={{
                          background: isSelected ? m.color + '30' : m.color + '15',
                          color: m.color,
                          border: `1px solid ${m.color}${isSelected ? '50' : '25'}`,
                        }}
                      >{m.stats}</div>
                      {/* 선택됐을 때 하단 "시작" 프롬프트 */}
                      {isSelected && (
                        <div
                          className="mt-3 w-full py-2 rounded-xl text-center font-black text-[12px] text-black transition-all"
                          style={{ background: `linear-gradient(90deg, ${m.color}dd, ${m.color})`, boxShadow: `0 2px 12px ${m.color}55` }}
                        >
                          ▼ 아래에서 시작하세요
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 전체 한번에 */}
          {matchMode === 'all' && (
            <div className="bg-[#0a1a0a] border-2 border-blue-600/50 rounded-2xl p-6 flex items-center justify-between"
              style={{ boxShadow: '0 0 32px rgba(59,130,246,0.15), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
              <div>
                <div className="text-white font-black text-sm mb-1">전체 {assignedDongs.size}개 동 · {totalSelected.toLocaleString()}건 동시 작업</div>
                <div className="text-gray-500 text-[11px]">모든 기사의 배송구역을 하나의 지도에서 순번 지정합니다</div>
              </div>
              <button onClick={handleStartAll}
                className="flex items-center gap-2 px-7 py-3.5 rounded-xl font-black text-[14px] transition-all shrink-0 text-black active:translate-y-[2px]"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  boxShadow: '0 6px 0 #14532d, 0 8px 20px rgba(59,130,246,0.35)',
                }}>
                <Play size={15} /> 전체 시작 <ChevronRight size={15} />
              </button>
            </div>
          )}

          {/* ── 기사별 */}
          {matchMode === 'driver' && (
            <div className="space-y-3">
              <div className="text-[11px] text-gray-400 font-bold px-1">기사 카드를 클릭하면 해당 기사의 행정동만 지도에 표시됩니다</div>
              <div className="grid grid-cols-2 gap-4">
                {assignedDrivers.map(d => {
                  const dDongs = Object.entries(dongDriverMap).filter(([, ids]) => ids.includes(d.id)).map(([dong]) => dong);
                  const cnt = dDongs.reduce((s, dong) => s + (dongCounts[dong] || 0), 0);
                  return (
                    <button
                      key={d.id}
                      onClick={() => handleStartForDriver(d.id)}
                      className="relative flex items-center gap-4 text-left outline-none select-none transition-all duration-150 active:translate-y-[3px]"
                    >
                      <div className="absolute inset-0 rounded-2xl" style={{ background: d.color + '88', transform: 'translateY(5px)', filter: 'blur(1px)' }} />
                      <div
                        className="relative w-full flex items-center gap-4 p-5 rounded-2xl"
                        style={{
                          background: `linear-gradient(135deg, ${d.color}18 0%, ${d.color}0a 100%)`,
                          border: `2px solid ${d.color}55`,
                          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 20px ${d.color}18`,
                        }}
                      >
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 font-black text-base text-black"
                          style={{ background: d.color, boxShadow: `0 3px 10px ${d.color}66` }}>
                          {drivers.indexOf(d) + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-white font-black text-[15px] truncate">{d.name}</div>
                          <div className="text-[11px] mt-0.5" style={{ color: d.color + 'cc' }}>{dDongs.join(' · ')}</div>
                          <div className="text-[11px] font-bold mt-1" style={{ color: d.color }}>{cnt.toLocaleString()}건 · 업무능력 {d.capacity}%</div>
                        </div>
                        <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-black text-[12px] text-black shrink-0"
                          style={{ background: d.color, boxShadow: `0 3px 8px ${d.color}55` }}>
                          시작 <ChevronRight size={13} />
                        </div>
                      </div>
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
                    className="text-[10px] px-2.5 py-1 bg-[#1a2a1a] border border-blue-700/30 text-blue-400 rounded-lg hover:bg-blue-900/20 transition-colors font-bold">
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
                        borderColor: isSelected ? '#3b82f6' : '#2a3a2a',
                        background: isSelected ? 'rgba(59,130,246,0.10)' : 'rgba(59,130,246,0.03)',
                        boxShadow: isSelected ? '0 0 0 1px rgba(59,130,246,0.2), inset 0 0 20px rgba(59,130,246,0.05)' : 'none',
                      }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {/* 체크박스 */}
                          <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all"
                            style={{ background: isSelected ? '#3b82f6' : 'transparent', border: `2px solid ${isSelected ? '#3b82f6' : '#3a4a3a'}` }}>
                            {isSelected && <span className="text-black text-[9px] font-black leading-none">✓</span>}
                          </div>
                          <span className="text-white font-black text-sm">{dong}</span>
                        </div>
                        <span className="font-black text-[11px]" style={{ color: isSelected ? '#3b82f6' : '#4a7a4a' }}>
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

              {/* 시작 버튼 */}
              <div className="pt-2 flex items-center justify-between">
                <span className="text-[12px] font-bold" style={{ color: dongSelection.size > 0 ? '#3b82f6' : '#4a6a4a' }}>
                  {dongSelection.size > 0
                    ? `✓ ${dongSelection.size}개 동 선택됨 · 총 ${[...dongSelection].reduce((s, d) => s + (dongCounts[d] || 0), 0).toLocaleString()}건`
                    : '동을 1개 이상 선택하세요'}
                </span>
                <button
                  onClick={handleStartForSelectedDongs}
                  disabled={dongSelection.size === 0}
                  className="relative flex items-center gap-2 outline-none select-none disabled:opacity-30 disabled:cursor-not-allowed transition-all active:translate-y-[3px]"
                >
                  {dongSelection.size > 0 && (
                    <div className="absolute inset-0 rounded-xl" style={{ background: '#14532d', transform: 'translateY(5px)' }} />
                  )}
                  <div className="relative flex items-center gap-2 px-7 py-3 rounded-xl font-black text-[13px] text-black"
                    style={{
                      background: dongSelection.size > 0 ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : '#1a2a1a',
                      color: dongSelection.size > 0 ? '#000' : '#4a6a4a',
                      boxShadow: dongSelection.size > 0 ? 'inset 0 1px 0 rgba(255,255,255,0.2)' : 'none',
                    }}>
                    <Play size={14} /> 선택한 {dongSelection.size}개 동 시작
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 좌표 수동 보완 모달 ── */}
      {showCoordFix && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="bg-[#0d0d0d] border border-orange-500/30 rounded-2xl w-[720px] max-w-[93vw] max-h-[82vh] flex flex-col shadow-[0_24px_80px_rgba(0,0,0,0.9)]">

            {/* 헤더 */}
            <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-orange-900/40 border border-orange-600/30 flex items-center justify-center">
                  <Crosshair size={16} className="text-orange-400" />
                </div>
                <div>
                  <h3 className="text-white font-black text-sm">좌표 수동 보완</h3>
                  <p className="text-gray-500 text-[11px] mt-0.5">
                    주소를 수정하거나 행 우측 "좌표받기"로 재시도 · {coordFixList.filter(r => r.lat && r.lng).length}/{coordFixList.length}건 완료
                  </p>
                </div>
              </div>
              <button onClick={() => setShowCoordFix(false)} className="p-2 text-gray-600 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* 레코드 목록 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
              {coordFixList.map((r, idx) => {
                const hasCoord = !!(r.lat && r.lng);
                const isGeocoding = singleGeocodingId === r.id;
                return (
                  <div key={r.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                      hasCoord ? 'border-green-500/25 bg-green-950/10' : 'border-[#2a2a2a] bg-black/20'
                    }`}>
                    <span className="text-[11px] text-gray-700 w-5 text-center shrink-0 tabular-nums">{idx + 1}</span>
                    <div className="w-20 shrink-0">
                      <div className="text-[12px] font-bold text-white truncate">{r.이름 || '—'}</div>
                      <div className="text-[9px] text-gray-600 truncate mt-0.5">{r.dong}</div>
                    </div>
                    <input
                      value={r.주소}
                      onChange={e => setCoordFixList(prev => prev.map(x => x.id === r.id ? { ...x, 주소: e.target.value } : x))}
                      className="flex-1 min-w-0 bg-black/40 border border-[#2a2a2a] focus:border-orange-500/50 rounded-lg px-3 py-1.5 text-[11px] text-white outline-none placeholder:text-gray-700 transition-colors"
                      placeholder="주소 입력..."
                    />
                    <div className="shrink-0 w-14 text-center">
                      {hasCoord
                        ? <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold justify-center"><CheckCircle size={12} /> 완료</span>
                        : <span className="text-[10px] text-gray-600">미지정</span>
                      }
                    </div>
                    <button
                      onClick={() => handleSingleGeocode(r.id)}
                      disabled={!!singleGeocodingId}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-900/30 hover:bg-orange-700/40 text-orange-300 text-[10px] font-bold border border-orange-700/30 transition-colors disabled:opacity-40 shrink-0"
                    >
                      {isGeocoding
                        ? <><Loader2 size={10} className="animate-spin" /> 검색중</>
                        : <><Crosshair size={10} /> 좌표받기</>
                      }
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 푸터 */}
            <div className="px-6 py-4 border-t border-[#1a1a1a] flex items-center justify-between shrink-0">
              <button
                onClick={handleRetryAllFix}
                disabled={!!singleGeocodingId || isSavingCoordFix}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#151515] hover:bg-[#222] text-gray-300 text-[12px] font-bold border border-[#2a2a2a] transition-colors disabled:opacity-40"
              >
                <RefreshCw size={13} /> 전체 재시도
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCoordFix(false)}
                  className="px-4 py-2 rounded-xl bg-[#151515] hover:bg-[#222] text-gray-400 text-[12px] font-bold border border-[#2a2a2a] transition-colors"
                >
                  닫기
                </button>
                <button
                  onClick={handleSaveCoordFixes}
                  disabled={!coordFixList.some(r => r.lat && r.lng) || isSavingCoordFix || !!singleGeocodingId}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl font-black text-[12px] transition-all disabled:opacity-30 disabled:cursor-not-allowed text-white"
                  style={{
                    background: coordFixList.some(r => r.lat && r.lng) ? 'linear-gradient(135deg, #c2410c, #ea580c)' : '#1a1a1a',
                    boxShadow: coordFixList.some(r => r.lat && r.lng) ? '0 4px 16px rgba(234,88,12,0.35)' : 'none',
                  }}
                >
                  {isSavingCoordFix
                    ? <><Loader2 size={13} className="animate-spin" /> 저장 중...</>
                    : <>저장 완료 ({coordFixList.filter(r => r.lat && r.lng).length}건)</>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
