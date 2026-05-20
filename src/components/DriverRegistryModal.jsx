import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Edit2, UserX, UserCheck, Truck, BarChart3, RefreshCw, MapPin, ChevronDown, ChevronUp, Download, Check, Building2, CheckSquare, Square } from 'lucide-react';
import { db, auth } from '../config/firebase.js';
import { getDocs, getDoc, setDoc, addDoc, collection, doc, serverTimestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { formatPhoneInput } from '../utils/parsers.js';

const DRIVER_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#f97316','#ec4899',
  '#14b8a6','#a855f7','#84cc16','#f43f5e',
  '#0ea5e9','#d97706','#22c55e','#6366f1',
  '#e11d48','#0891b2','#65a30d','#7c3aed',
  '#fb923c','#34d399','#60a5fa','#f472b6',
];

const DEFAULT_FORM = { name: '', phone: '', capacity: 100, color: '#3b82f6', memo: '', assignedZones: [] };

const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
const getLast6Months = () => {
  const months = []; const d = new Date();
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth()-i, 1);
    months.push(`${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}`);
  }
  return months;
};

export default function DriverRegistryModal({ user, onClose }) {
  const isAdmin = user?.role === 'admin';

  // ── 소속사 선택
  const [orgList, setOrgList] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(isAdmin ? '' : (user?.orgId || ''));

  // ── 기사 목록
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  // ── 폼
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [isSaving, setIsSaving] = useState(false);

  // ── 지역매칭 피커
  const [showZonePicker, setShowZonePicker] = useState(false);
  const [zoneDongsPerCity, setZoneDongsPerCity] = useState({}); // { city: string[] }
  const [loadingZone, setLoadingZone] = useState(false);

  // ── 탭
  const [tab, setTab] = useState('drivers');

  // ── 실적 탭
  const [statsCity, setStatsCity] = useState(user?.citiesApproved?.[0] || '');
  const [statsMonth, setStatsMonth] = useState(currentMonth());
  const [statsData, setStatsData] = useState([]);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [driverHistory, setDriverHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [statsCities, setStatsCities] = useState([]); // 실적 탭 도시 목록

  // ── 관리자용 소속사 목록 로드
  useEffect(() => {
    if (!isAdmin) return;
    getDoc(doc(db, 'nexus_config', 'orgs')).then(snap => {
      if (snap.exists()) setOrgList(snap.data().list || []);
    }).catch(() => {});
  }, [isAdmin]);

  // ── 기사 목록 로드
  const loadDrivers = useCallback(async () => {
    if (!selectedOrg) { setDrivers([]); return; }
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'org_drivers', selectedOrg, 'drivers'));
      setDrivers(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.name||'').localeCompare(b.name||'', 'ko'))
      );
    } catch (e) {
      console.error('기사 로드:', e);
      setDrivers([]);
    }
    finally { setIsLoading(false); }
  }, [selectedOrg]);

  useEffect(() => { loadDrivers(); }, [loadDrivers]);

  // ── 실적 탭 도시 목록: 드라이버 assignedZones 집계 또는 citiesApproved
  useEffect(() => {
    const cities = isAdmin
      ? [...new Set(drivers.flatMap(d => (d.assignedZones||[]).map(z => z.city)))]
      : (user?.citiesApproved || []);
    setStatsCities(cities);
    if (!statsCity && cities.length) setStatsCity(cities[0]);
  }, [drivers, isAdmin, user?.citiesApproved]);

  // ── 실적 데이터 로드
  const loadStats = useCallback(async (city, month) => {
    if (!city || !month) return;
    setIsLoadingStats(true);
    try {
      const snap = await getDocs(collection(db, 'delivery_history', city, 'months', month, 'drivers'));
      setStatsData(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.driverName||'').localeCompare(b.driverName||'', 'ko'))
      );
    } catch { setStatsData([]); }
    finally { setIsLoadingStats(false); }
  }, []);

  useEffect(() => { if (tab === 'stats') loadStats(statsCity, statsMonth); }, [tab, statsCity, statsMonth, loadStats]);

  // ── 기사 6개월 이력
  const loadDriverHistory = useCallback(async (driver, city) => {
    setIsLoadingHistory(true); setSelectedDriver(driver);
    const months = getLast6Months();
    const history = [];
    for (const month of months) {
      try {
        const snap = await getDoc(doc(db, 'delivery_history', city, 'months', month, 'drivers', driver.id));
        history.push({ month, ...(snap.exists() ? snap.data() : { totalQty:0, totalCount:0, effectiveLoad:0, dongs:[] }) });
      } catch { history.push({ month, totalQty:0, totalCount:0, effectiveLoad:0, dongs:[] }); }
    }
    setDriverHistory(history); setIsLoadingHistory(false);
  }, []);

  // ── 지역매칭 피커: org의 행정동을 org_presets에서 로드
  const openZonePicker = async () => {
    if (showZonePicker) { setShowZonePicker(false); return; }
    if (!selectedOrg) { alert('소속사를 먼저 선택하세요.'); return; }
    setLoadingZone(true);
    try {
      let uniqueCities;
      if (isAdmin) {
        // 관리자: cloud_lists 전체 지자체 로드
        const snap = await getDocs(collection(db, 'cloud_lists'));
        uniqueCities = snap.docs.map(d => d.id);
      } else {
        uniqueCities = [...new Set(user?.citiesApproved || [])];
      }
      if (!uniqueCities.length) { alert('배정된 지자체가 없습니다.\n관리자에게 지자체 승인을 요청하세요.'); return; }
      // org_presets에서 해당 소속사 행정동 로드 (없으면 빈 배열)
      const result = {};
      for (const city of uniqueCities) {
        const snap = await getDoc(doc(db, 'org_presets', city));
        if (!snap.exists()) { result[city] = []; continue; }
        const org = (snap.data().orgs||[]).find(o => o.name === selectedOrg || o.id === selectedOrg);
        result[city] = org?.dongs || [];
      }
      setZoneDongsPerCity(result);
      setShowZonePicker(true);
    } catch (e) { alert('행정동 로드 실패: ' + e.message); }
    finally { setLoadingZone(false); }
  };

  // 지역매칭 체크박스 토글
  const toggleZoneDong = (city, dong) => {
    setForm(prev => {
      const zones = [...(prev.assignedZones || [])];
      const idx = zones.findIndex(z => z.city === city);
      if (idx < 0) {
        zones.push({ city, dongs: [dong] });
      } else {
        const dongs = [...zones[idx].dongs];
        const di = dongs.indexOf(dong);
        if (di < 0) dongs.push(dong);
        else dongs.splice(di, 1);
        if (dongs.length === 0) zones.splice(idx, 1);
        else zones[idx] = { city, dongs };
      }
      return { ...prev, assignedZones: zones };
    });
  };

  // 도시 전체 선택/해제
  const toggleAllCity = (city, allDongs) => {
    setForm(prev => {
      const zones = [...(prev.assignedZones||[])];
      const idx = zones.findIndex(z => z.city === city);
      const cur = idx >= 0 ? zones[idx].dongs : [];
      const allSelected = allDongs.every(d => cur.includes(d));
      if (allSelected) {
        if (idx >= 0) zones.splice(idx, 1);
      } else {
        if (idx < 0) zones.push({ city, dongs: [...allDongs] });
        else zones[idx] = { city, dongs: [...allDongs] };
      }
      return { ...prev, assignedZones: zones };
    });
  };

  const getSelectedDongs = (city) => (form.assignedZones||[]).find(z => z.city === city)?.dongs || [];

  // ── 폼 열기
  const openNew = () => {
    const usedColors = new Set(drivers.filter(d=>d.status!=='inactive').map(d=>d.color));
    const nextColor = DRIVER_COLORS.find(c=>!usedColors.has(c)) ?? DRIVER_COLORS[0];
    setForm({ ...DEFAULT_FORM, color: nextColor });
    setShowZonePicker(false);
    setEditingId('new');
  };

  const openEdit = (driver) => {
    setForm({
      name: driver.name||'', phone: driver.phone||'',
      capacity: driver.capacity??100, color: driver.color||'#3b82f6',
      memo: driver.memo||'', assignedZones: driver.assignedZones||[],
    });
    setShowZonePicker(false);
    setEditingId(driver.id);
  };

  // ── 저장
  const handleSave = async () => {
    if (!form.name.trim()) { alert('이름을 입력하세요.'); return; }
    if (!selectedOrg) { alert('소속사를 선택하세요.'); return; }
    setIsSaving(true);
    try {
      const payload = {
        name: form.name.trim(), phone: form.phone.trim(),
        capacity: parseInt(form.capacity)||100, color: form.color,
        memo: form.memo.trim(), status: 'active',
        assignedZones: form.assignedZones||[],
        org: selectedOrg,
      };
      if (editingId === 'new') {
        payload.joinedAt = serverTimestamp();
        payload.createdBy = auth.currentUser?.email||'';
        await addDoc(collection(db, 'org_drivers', selectedOrg, 'drivers'), payload);
      } else {
        payload.updatedAt = serverTimestamp();
        await setDoc(doc(db, 'org_drivers', selectedOrg, 'drivers', editingId), payload, { merge: true });
      }
      setEditingId(null); setShowZonePicker(false);
      await loadDrivers();
    } catch (e) { alert('저장 실패: ' + e.message); }
    finally { setIsSaving(false); }
  };

  // ── 상태 토글
  const handleToggleStatus = async (driver) => {
    const newStatus = driver.status === 'active' ? 'inactive' : 'active';
    try {
      await setDoc(doc(db, 'org_drivers', selectedOrg, 'drivers', driver.id), { status: newStatus, updatedAt: serverTimestamp() }, { merge: true });
      await loadDrivers();
    } catch (e) { alert('상태 변경 실패: ' + e.message); }
  };

  // ── 실적 엑셀
  const handleExportStats = () => {
    if (!statsData.length) return;
    const rows = [['기사명','배송건수','포수합계','유효부담','담당 행정동']];
    statsData.forEach(d => rows.push([d.driverName||'', d.totalCount||0, d.totalQty||0, d.effectiveLoad||0, (d.dongs||[]).join(' · ')]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:12},{wch:10},{wch:10},{wch:10},{wch:40}];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, statsMonth);
    XLSX.writeFile(wb, `[기사실적]${statsCity}-${statsMonth}.xlsx`);
  };

  const activeDrivers = drivers.filter(d => d.status !== 'inactive');
  const inactiveDrivers = drivers.filter(d => d.status === 'inactive');
  const maxQty = statsData.length ? Math.max(...statsData.map(d=>d.totalQty||0), 1) : 1;

  // ════════════════════════════════════════════════
  // 폼 패널 (기사 추가/수정)
  // ════════════════════════════════════════════════
  if (editingId !== null) {
    const totalAssigned = (form.assignedZones||[]).reduce((s,z)=>s+z.dongs.length,0);
    return createPortal(
      <div className="fixed inset-0 z-[900] flex flex-col bg-[#060606]">
        <div className="shrink-0 flex items-center justify-between px-8 py-4 border-b border-[#1a1a1a] bg-[#0a0a0a]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-900/40 border border-blue-600/30 flex items-center justify-center">
              <Truck size={14} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-white font-black text-sm">{editingId==='new'?'기사 추가':'기사 정보 수정'}</h2>
              <p className="text-gray-500 text-[11px]">{selectedOrg} · 소속사 기사 마스터</p>
            </div>
          </div>
          <button onClick={()=>{setEditingId(null);setShowZonePicker(false);}}
            className="p-2.5 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white border border-red-700/40 rounded-xl transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-8 flex items-start justify-center">
          <div className="w-full max-w-lg space-y-5">

            {/* 이름 */}
            <div>
              <label className="text-[11px] text-gray-400 font-bold mb-1.5 block">이름 <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))}
                placeholder="기사 이름" autoFocus
                className="w-full bg-[#111] border border-[#2a2a2a] text-white text-sm rounded-xl px-4 py-3 outline-none focus:border-blue-500/60 font-bold" />
            </div>

            {/* 전화번호 */}
            <div>
              <label className="text-[11px] text-gray-400 font-bold mb-1.5 block">전화번호</label>
              <input value={form.phone} onChange={e=>setForm(p=>({...p,phone:formatPhoneInput(e.target.value)}))}
                placeholder="010-0000-0000"
                className="w-full bg-[#111] border border-[#2a2a2a] text-white text-sm rounded-xl px-4 py-3 outline-none focus:border-blue-500/60" />
            </div>

            {/* 업무능력 */}
            <div>
              <label className="text-[11px] text-gray-400 font-bold mb-1.5 flex items-center justify-between">
                <span>업무능력</span>
                <span className="text-blue-400 font-black">{form.capacity}%</span>
              </label>
              <input type="range" min={10} max={200} step={5} value={form.capacity}
                onChange={e=>setForm(p=>({...p,capacity:parseInt(e.target.value)}))}
                className="w-full h-2 rounded-full" style={{accentColor:form.color}} />
              <div className="flex justify-between text-[10px] text-gray-700 mt-1">
                <span>10% (저)</span><span>100% (기준)</span><span>200% (최고)</span>
              </div>
            </div>

            {/* 색상 */}
            <div>
              <label className="text-[11px] text-gray-400 font-bold mb-1.5 block">지도 색상</label>
              <div className="grid grid-cols-8 gap-2">
                {DRIVER_COLORS.map(c=>(
                  <button key={c} onClick={()=>setForm(p=>({...p,color:c}))}
                    className="w-8 h-8 rounded-lg transition-all"
                    style={{background:c, outline:form.color===c?`3px solid ${c}`:'none', outlineOffset:'2px',
                      boxShadow:form.color===c?`0 0 12px ${c}80`:'none', transform:form.color===c?'scale(1.15)':'scale(1)'}} />
                ))}
              </div>
            </div>

            {/* 메모 */}
            <div>
              <label className="text-[11px] text-gray-400 font-bold mb-1.5 block">메모 (선택)</label>
              <textarea value={form.memo} onChange={e=>setForm(p=>({...p,memo:e.target.value}))}
                placeholder="특이사항, 담당구역 등..." rows={2}
                className="w-full bg-[#111] border border-[#2a2a2a] text-white text-sm rounded-xl px-4 py-3 outline-none focus:border-blue-500/60 resize-none" />
            </div>

            {/* 지역매칭 */}
            <div>
              <button onClick={openZonePicker} disabled={loadingZone}
                className="w-full flex items-center justify-between px-4 py-3 bg-[#0d1a0d] border border-emerald-700/40 rounded-xl text-emerald-400 text-[12px] font-bold hover:bg-[#0d200d] transition-colors disabled:opacity-50">
                <div className="flex items-center gap-2">
                  <MapPin size={13} />
                  <span>지역매칭 설정</span>
                  {totalAssigned > 0 && (
                    <span className="bg-emerald-900/50 border border-emerald-700/40 text-emerald-300 text-[10px] px-2 py-0.5 rounded-full font-black">
                      {totalAssigned}개 행정동 배정됨
                    </span>
                  )}
                </div>
                {loadingZone
                  ? <RefreshCw size={12} className="animate-spin" />
                  : showZonePicker ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
              </button>

              {/* 배정된 구역 요약 */}
              {!showZonePicker && totalAssigned > 0 && (
                <div className="mt-2 space-y-1.5">
                  {(form.assignedZones||[]).map(z=>(
                    <div key={z.city} className="px-3 py-2 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl">
                      <div className="text-[10px] text-gray-500 font-bold mb-1">{z.city}</div>
                      <div className="flex flex-wrap gap-1">
                        {z.dongs.map(d=>(
                          <span key={d} className="text-[10px] px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 rounded-md font-bold">{d}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 지역매칭 피커 패널 */}
              {showZonePicker && (
                <div className="mt-2 border border-[#2a2a2a] rounded-2xl overflow-hidden bg-[#0a0a0a]">
                  {Object.keys(zoneDongsPerCity).length === 0 ? (
                    <div className="p-6 text-center text-gray-600 text-[12px]">
                      배정된 행정동이 없습니다.<br/>관리자 → 조직 배분에서 소속사에 행정동을 배정하세요.
                    </div>
                  ) : (
                    Object.entries(zoneDongsPerCity).map(([city, allDongs]) => {
                      if (!allDongs.length) return null;
                      const selected = getSelectedDongs(city);
                      const allChk = allDongs.every(d=>selected.includes(d));
                      return (
                        <div key={city} className="border-b border-[#1a1a1a] last:border-b-0">
                          {/* 도시 헤더 */}
                          <div className="flex items-center justify-between px-4 py-2.5 bg-[#0d0d0d]">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-white font-black">{city}</span>
                              {selected.length > 0 && (
                                <span className="text-[9px] bg-emerald-900/40 text-emerald-400 border border-emerald-700/30 px-1.5 py-0.5 rounded-full font-bold">
                                  {selected.length}/{allDongs.length}
                                </span>
                              )}
                            </div>
                            <button onClick={()=>toggleAllCity(city, allDongs)}
                              className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-emerald-400 transition-colors font-bold">
                              {allChk ? <CheckSquare size={11} className="text-emerald-400"/> : <Square size={11}/>}
                              {allChk ? '전체 해제' : '전체 선택'}
                            </button>
                          </div>
                          {/* 행정동 체크박스 */}
                          <div className="grid grid-cols-3 gap-1 p-3">
                            {allDongs.sort((a,b)=>a.localeCompare(b,'ko')).map(dong=>{
                              const checked = selected.includes(dong);
                              return (
                                <button key={dong} onClick={()=>toggleZoneDong(city, dong)}
                                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all border text-left ${
                                    checked
                                      ? 'bg-emerald-900/30 border-emerald-600/40 text-emerald-300'
                                      : 'bg-[#111] border-[#222] text-gray-500 hover:border-[#333] hover:text-gray-300'
                                  }`}>
                                  {checked ? <Check size={10} className="shrink-0 text-emerald-400"/> : <div className="w-2.5 h-2.5 rounded border border-[#333] shrink-0"/>}
                                  <span className="truncate">{dong}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* 미리보기 */}
            <div className="p-4 rounded-xl border" style={{background:form.color+'10', borderColor:form.color+'40'}}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white"
                  style={{background:form.color}}>
                  {form.name ? form.name[0] : '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-black text-sm">{form.name||'이름 미입력'}</div>
                  <div className="text-[11px] mt-0.5" style={{color:form.color}}>업무능력 {form.capacity}%</div>
                </div>
                {form.phone && <div className="ml-auto text-[11px] text-gray-500">{form.phone}</div>}
              </div>
            </div>

            {/* 버튼 */}
            <div className="flex gap-3 pt-2">
              <button onClick={()=>{setEditingId(null);setShowZonePicker(false);}}
                className="flex-1 py-3 bg-[#1a1a1a] text-gray-400 rounded-xl font-bold text-sm hover:text-white transition-colors">
                취소
              </button>
              <button onClick={handleSave} disabled={isSaving||!form.name.trim()}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-sm disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
                {isSaving ? <><RefreshCw size={14} className="animate-spin"/>저장 중...</> : '저장'}
              </button>
            </div>
          </div>
        </div>
      </div>
    , document.body);
  }

  // ════════════════════════════════════════════════
  // 메인 모달
  // ════════════════════════════════════════════════
  return createPortal(
    <div className="fixed inset-0 z-[900] flex flex-col bg-[#060606]">

      {/* 헤더 */}
      <div className="shrink-0 flex items-center justify-between px-8 py-4 border-b border-[#1a1a1a] bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-900/40 border border-blue-600/30 flex items-center justify-center">
            <Truck size={14} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-white font-black text-sm flex items-center gap-2">
              소속사 기사 관리
              <span className="text-[10px] bg-purple-900/40 border border-purple-700/40 text-purple-300 px-2 py-0.5 rounded-lg font-black">VVIP</span>
            </h2>
            <p className="text-gray-500 text-[11px]">
              {selectedOrg ? `${selectedOrg} · 기사 ${activeDrivers.length}명` : '소속사를 선택하세요'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* 관리자: 소속사 드롭다운 */}
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Building2 size={13} className="text-gray-600" />
              <select value={selectedOrg} onChange={e=>setSelectedOrg(e.target.value)}
                className="bg-[#111] border border-[#2a2a2a] text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-blue-500/50 cursor-pointer">
                <option value="">소속사 선택</option>
                {orgList.map(org=><option key={org} value={org}>{org}</option>)}
              </select>
            </div>
          )}
          {/* 비관리자: 소속사명 표시 */}
          {!isAdmin && selectedOrg && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/20 border border-emerald-700/30 rounded-xl">
              <Building2 size={11} className="text-emerald-400" />
              <span className="text-emerald-300 text-[11px] font-bold">{selectedOrg}</span>
            </div>
          )}
          <button onClick={onClose}
            className="p-2.5 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white border border-red-700/40 rounded-xl transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="shrink-0 flex border-b border-[#1a1a1a] bg-[#0a0a0a]">
        {[
          { id: 'drivers', label: '기사 관리', icon: <Truck size={13}/> },
          { id: 'stats', label: '월별 실적', icon: <BarChart3 size={13}/> },
        ].map(t=>(
          <button key={t.id} onClick={()=>{setTab(t.id);setSelectedDriver(null);}}
            className={`flex items-center gap-2 px-6 py-3 text-[12px] font-bold border-b-2 transition-colors ${
              tab===t.id ? 'border-blue-500 text-blue-400 bg-blue-900/10' : 'border-transparent text-gray-600 hover:text-gray-300'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">

        {/* ══ 탭 1: 기사 관리 ══════════════════════════════════════════ */}
        {tab === 'drivers' && (
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {!selectedOrg ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-3">
                <Building2 size={32} className="opacity-20" />
                <div className="text-sm">{isAdmin ? '상단에서 소속사를 선택하세요' : '소속사 정보를 확인할 수 없습니다'}</div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-5">
                  <div className="text-gray-500 text-[12px]">
                    활성 <span className="text-blue-400 font-black">{activeDrivers.length}명</span>
                    {inactiveDrivers.length > 0 && <span> · 비활성 {inactiveDrivers.length}명</span>}
                  </div>
                  <button onClick={openNew}
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-600 text-white text-[12px] font-black rounded-xl transition-colors">
                    <Plus size={14}/> 기사 추가
                  </button>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center h-48 text-gray-600 text-sm animate-pulse">기사 목록 불러오는 중...</div>
                ) : (
                  <>
                    {activeDrivers.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-3">
                        <Truck size={32} className="opacity-20"/>
                        <div className="text-sm">등록된 기사가 없습니다</div>
                        <button onClick={openNew}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-900/40 border border-blue-700/40 text-blue-400 text-xs font-bold rounded-xl hover:bg-blue-800/40 transition-colors">
                          <Plus size={12}/> 첫 번째 기사 추가
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                        {activeDrivers.map(driver=>(
                          <DriverCard key={driver.id} driver={driver}
                            onEdit={()=>openEdit(driver)} onToggle={()=>handleToggleStatus(driver)} />
                        ))}
                      </div>
                    )}

                    {inactiveDrivers.length > 0 && (
                      <div className="border border-[#1a1a1a] rounded-2xl overflow-hidden">
                        <button onClick={()=>setShowInactive(v=>!v)}
                          className="w-full flex items-center justify-between px-5 py-3.5 bg-[#0d0d0d] text-gray-600 hover:text-gray-400 text-[12px] font-bold transition-colors">
                          <span>비활성 기사 {inactiveDrivers.length}명</span>
                          {showInactive ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                        </button>
                        {showInactive && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4 bg-[#080808]">
                            {inactiveDrivers.map(driver=>(
                              <DriverCard key={driver.id} driver={driver}
                                onEdit={()=>openEdit(driver)} onToggle={()=>handleToggleStatus(driver)} inactive />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ 탭 2: 월별 실적 ══════════════════════════════════════════ */}
        {tab === 'stats' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center gap-3 px-8 py-3.5 border-b border-[#1a1a1a] bg-[#0a0a0a] flex-wrap">
              {/* 도시 선택 */}
              {statsCities.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-[11px] font-bold">지자체</span>
                  <select value={statsCity} onChange={e=>{setStatsCity(e.target.value);setSelectedDriver(null);}}
                    className="bg-[#111] border border-[#2a2a2a] text-white text-[12px] rounded-lg px-3 py-1.5 outline-none focus:border-blue-500/50">
                    {statsCities.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-[11px] font-bold">기준 월</span>
                <input type="month" value={statsMonth}
                  onChange={e=>{setStatsMonth(e.target.value);setSelectedDriver(null);}}
                  className="bg-[#111] border border-[#2a2a2a] text-white text-[12px] rounded-lg px-3 py-1.5 outline-none focus:border-blue-500/50" />
              </div>
              <button onClick={()=>loadStats(statsCity, statsMonth)} disabled={isLoadingStats}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white text-[11px] font-bold rounded-lg transition-colors">
                <RefreshCw size={11} className={isLoadingStats?'animate-spin':''} />
                {isLoadingStats?'로딩...':'새로고침'}
              </button>
              <button onClick={handleExportStats} disabled={!statsData.length}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0d1520] border border-blue-500/30 text-blue-400 text-[11px] font-bold rounded-lg hover:bg-blue-900/20 transition-colors disabled:opacity-40">
                <Download size={11}/> 엑셀 다운로드
              </button>
              {statsData.length > 0 && (
                <span className="ml-auto text-[11px] text-gray-600">
                  총 <span className="text-blue-400 font-bold">{statsData.reduce((s,d)=>s+(d.totalQty||0),0).toLocaleString()}</span>포 /
                  <span className="text-blue-400 font-bold"> {statsData.reduce((s,d)=>s+(d.totalCount||0),0).toLocaleString()}</span>건
                </span>
              )}
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
              <div className={`overflow-y-auto ${selectedDriver?'w-[55%] border-r border-[#1a1a1a]':'w-full'} transition-all`}>
                <div className="px-8 py-6">
                  {isLoadingStats ? (
                    <div className="flex items-center justify-center h-48 text-gray-600 animate-pulse">실적 데이터 불러오는 중...</div>
                  ) : statsData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-2">
                      <BarChart3 size={28} className="opacity-20"/>
                      <div className="text-sm">{statsMonth} 실적 데이터가 없습니다</div>
                      <div className="text-[11px] text-gray-700">루트맵 → 최종저장 완료 후 집계됩니다</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-[1fr_80px_80px_80px_1fr] gap-3 px-4 py-2 text-[10px] text-gray-600 font-bold">
                        <div>기사명</div><div className="text-right">포수</div>
                        <div className="text-right">건수</div><div className="text-right">유효부담</div><div>행정동</div>
                      </div>
                      {statsData.map(d=>{
                        const isSelected = selectedDriver?.id === d.id;
                        const barPct = Math.round((d.totalQty||0)/maxQty*100);
                        const driverInfo = drivers.find(dr=>dr.id===d.id);
                        const color = driverInfo?.color||'#3b82f6';
                        return (
                          <button key={d.id}
                            onClick={()=>{ if(isSelected){setSelectedDriver(null);return;} loadDriverHistory({id:d.id,name:d.driverName,color}, statsCity); }}
                            className={`w-full grid grid-cols-[1fr_80px_80px_80px_1fr] gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                              isSelected?'border-blue-500/50 bg-blue-900/15':'border-[#1a1a1a] bg-[#0d0d0d] hover:border-[#2a2a2a] hover:bg-[#111]'}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-3 h-3 rounded-full shrink-0" style={{background:color}}/>
                              <span className="text-white font-bold text-[12px] truncate">{d.driverName}</span>
                            </div>
                            <div className="text-right">
                              <div className="text-white font-black text-[13px] tabular-nums">{(d.totalQty||0).toLocaleString()}</div>
                              <div className="h-1 rounded-full bg-[#1a1a1a] mt-1 overflow-hidden">
                                <div className="h-full rounded-full" style={{width:`${barPct}%`,background:color}}/>
                              </div>
                            </div>
                            <div className="text-right text-gray-400 font-bold text-[12px] tabular-nums">{(d.totalCount||0).toLocaleString()}</div>
                            <div className="text-right text-gray-500 text-[12px] tabular-nums">{Math.round(d.effectiveLoad||0).toLocaleString()}</div>
                            <div className="text-[10px] text-gray-600 truncate">
                              {(d.dongs||[]).slice(0,4).join(' · ')}{(d.dongs||[]).length>4?` +${(d.dongs||[]).length-4}`:''}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {selectedDriver && (
                <div className="overflow-y-auto" style={{width:'45%'}}>
                  <div className="px-6 py-6">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{background:selectedDriver.color||'#3b82f6'}}/>
                        <span className="text-white font-black text-sm">{selectedDriver.name} — 최근 6개월</span>
                      </div>
                      <button onClick={()=>setSelectedDriver(null)} className="text-gray-600 hover:text-gray-300">
                        <X size={14}/>
                      </button>
                    </div>
                    {isLoadingHistory ? (
                      <div className="flex items-center justify-center h-40 text-gray-600 animate-pulse">불러오는 중...</div>
                    ) : (
                      <>
                        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-5 mb-4">
                          <div className="flex items-end gap-2 h-28">
                            {(()=>{
                              const maxH = Math.max(...driverHistory.map(h=>h.totalQty||0), 1);
                              return driverHistory.map((h,i)=>{
                                const pct = Math.round((h.totalQty||0)/maxH*100);
                                const isCur = h.month === statsMonth;
                                return (
                                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                    <div className="text-[9px] text-gray-600 tabular-nums font-bold">{h.totalQty>0?h.totalQty:''}</div>
                                    <div className="w-full rounded-t-lg transition-all"
                                      style={{height:`${Math.max(pct*0.9,h.totalQty>0?6:0)}%`, minHeight:h.totalQty>0?'4px':'0',
                                        background:isCur?(selectedDriver.color||'#3b82f6'):(selectedDriver.color||'#3b82f6')+'55'}}/>
                                    <div className={`text-[9px] tabular-nums font-bold ${isCur?'text-blue-400':'text-gray-700'}`}>{h.month.slice(5)}월</div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-4">
                          {[
                            {label:'6개월 총 포수', value:driverHistory.reduce((s,h)=>s+(h.totalQty||0),0).toLocaleString()+'포', color:selectedDriver.color},
                            {label:'6개월 총 건수', value:driverHistory.reduce((s,h)=>s+(h.totalCount||0),0).toLocaleString()+'건', color:'#10b981'},
                            {label:'월평균 포수', value:Math.round(driverHistory.reduce((s,h)=>s+(h.totalQty||0),0)/Math.max(driverHistory.filter(h=>h.totalQty>0).length,1)).toLocaleString()+'포', color:'#f59e0b'},
                            {label:'참여 월수', value:driverHistory.filter(h=>h.totalQty>0).length+'개월', color:'#8b5cf6'},
                          ].map(s=>(
                            <div key={s.label} className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-3">
                              <div className="text-[10px] text-gray-600 font-bold mb-0.5">{s.label}</div>
                              <div className="text-sm font-black" style={{color:s.color}}>{s.value}</div>
                            </div>
                          ))}
                        </div>
                        {(()=>{
                          const cur = driverHistory.find(h=>h.month===statsMonth);
                          if (!cur?.dongs?.length) return null;
                          return (
                            <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
                              <div className="text-[10px] text-gray-500 font-bold mb-2 flex items-center gap-1.5">
                                <MapPin size={10}/>{statsMonth} 담당 행정동
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {cur.dongs.map(dong=>(
                                  <span key={dong} className="text-[10px] px-2 py-0.5 rounded-lg font-bold"
                                    style={{background:(selectedDriver.color||'#3b82f6')+'20', color:selectedDriver.color||'#3b82f6'}}>
                                    {dong}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  , document.body);
}

function DriverCard({ driver, onEdit, onToggle, inactive = false }) {
  const totalDongs = (driver.assignedZones||[]).reduce((s,z)=>s+z.dongs.length, 0);
  const cities = (driver.assignedZones||[]).map(z=>z.city);
  return (
    <div className="rounded-2xl border p-4 transition-all"
      style={{background:inactive?'#0a0a0a':(driver.color+'0d'), borderColor:inactive?'#1a1a1a':(driver.color+'35'), opacity:inactive?0.65:1}}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white text-base shrink-0"
          style={{background:inactive?'#2a2a2a':driver.color}}>
          {(driver.name||'?')[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-black text-[13px] truncate">{driver.name}</div>
          {driver.phone && <div className="text-gray-600 text-[10px] mt-0.5">{driver.phone}</div>}
        </div>
        {inactive && <span className="text-[9px] bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full font-bold shrink-0">비활성</span>}
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-600">업무능력</span>
          <span className="text-[11px] font-black" style={{color:inactive?'#555':driver.color}}>{driver.capacity??100}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[#1a1a1a] overflow-hidden">
          <div className="h-full rounded-full" style={{width:`${Math.min((driver.capacity||100)/2,100)}%`, background:inactive?'#2a2a2a':driver.color}}/>
        </div>
      </div>

      {/* 배정 구역 요약 */}
      {totalDongs > 0 && (
        <div className="mb-3 flex items-center gap-1.5 flex-wrap">
          <MapPin size={9} className="text-emerald-500 shrink-0"/>
          <span className="text-[10px] text-emerald-500 font-bold">{totalDongs}개 행정동</span>
          {cities.length > 0 && (
            <span className="text-[9px] text-gray-600 truncate">{cities.map(c=>c.split(' ').slice(-1)[0]).join(' · ')}</span>
          )}
        </div>
      )}

      {driver.memo && <div className="text-[10px] text-gray-600 mb-3 leading-relaxed truncate">{driver.memo}</div>}

      <div className="flex gap-1.5">
        <button onClick={onEdit}
          className="flex-1 py-1.5 bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white rounded-lg text-[10px] font-bold transition-colors flex items-center justify-center gap-1">
          <Edit2 size={9}/> 수정
        </button>
        <button onClick={onToggle}
          className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors flex items-center justify-center gap-1 border ${
            inactive?'bg-blue-900/30 border-blue-700/40 text-blue-400 hover:bg-blue-800/40'
                    :'bg-red-900/20 border-red-800/30 text-red-500 hover:bg-red-900/30'}`}>
          {inactive ? <><UserCheck size={9}/> 복구</> : <><UserX size={9}/> 비활성</>}
        </button>
      </div>
    </div>
  );
}
