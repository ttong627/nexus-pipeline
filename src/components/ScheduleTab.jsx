import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  db, collection, doc, getDoc, setDoc, updateDoc, deleteDoc,
  getDocs, writeBatch, serverTimestamp
} from '../config/firebase.js';
import { REGIONS } from '../utils/regions.js';
import {
  ArrowLeft, Plus, Trash2, Printer, FileSpreadsheet, Send,
  ChevronLeft, ChevronRight, Search, Check, X, Pencil, Save,
  CalendarDays, Users, Download, RefreshCw, LayoutList
} from 'lucide-react';

/* ── 유틸 ──────────────────────────────────────────────────────── */
function getChosung(ch) {
  const code = ch.charCodeAt(0) - 0xAC00;
  if (code < 0 || code > 11171) return ch;
  const CHOSEONG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  return CHOSEONG[Math.floor(code / 28 / 21)];
}
function matchChosung(str, q) {
  if (!q?.trim()) return true;
  if (/^[ㄱ-ㅎ]+$/.test(q)) return [...str].map(getChosung).join('').includes(q);
  return str.toLowerCase().includes(q.toLowerCase());
}
function formatDateRanges(dates) {
  if (!dates?.length) return '';
  const sorted = [...dates].sort();
  const groups = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if ((new Date(sorted[i]) - new Date(end)) / 86400000 === 1) { end = sorted[i]; }
    else { groups.push([start, end]); start = end = sorted[i]; }
  }
  groups.push([start, end]);
  return groups.map(([s, e]) => {
    const sm = s.slice(5).replace('-', '/'), em = e.slice(5).replace('-', '/');
    return s === e ? sm : `${sm}~${em}`;
  }).join(', ');
}
function getCompletionDate(dates) {
  if (!dates?.length) return '';
  const last = [...dates].sort().pop();
  const [, m, d] = last.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}
function newId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/* ── 보고서 HTML ───────────────────────────────────────────────── */
function buildReportHtml(items, meta) {
  const padCount = Math.max(0, 35 - items.length);
  const row = (r, i) => {
    const done = !!r.completed;
    const bg = done ? 'background:#fffbe6;' : '';
    const dtBg = done ? 'background:#FFB300;color:#7a2900;' : '';
    return `<tr style="${bg}">
      <td style="text-align:center;border:1px solid #ccc;padding:2px 1px;font-size:10px;">${i + 1}</td>
      <td style="border:1px solid #ccc;padding:2px 4px;font-size:10px;">${r.dong||''}</td>
      <td style="border:1px solid #ccc;padding:2px 4px;font-size:10px;">${r.driverName||''}</td>
      <td style="border:1px solid #ccc;padding:2px 4px;font-size:10px;">${r.phone||''}</td>
      <td style="border:1px solid #ccc;padding:2px 4px;font-size:10px;">${r.emergency||''}</td>
      <td style="${dtBg}border:1px solid #ccc;padding:2px 4px;font-size:10px;">${formatDateRanges(r.dates)}</td>
      <td style="${dtBg}border:1px solid #ccc;padding:2px 4px;font-size:10px;text-align:center;">${done ? getCompletionDate(r.dates) : ''}</td>
      <td style="border:1px solid #ccc;padding:2px 4px;font-size:10px;">${r.note||''}</td>
    </tr>`;
  };
  const pad = Array.from({ length: padCount }, (_, i) =>
    `<tr><td style="border:1px solid #ccc;padding:2px 1px;font-size:10px;text-align:center;">${items.length+i+1}</td>
    ${'<td style="border:1px solid #ccc;padding:6px 4px;"></td>'.repeat(7)}</tr>`
  ).join('');
  return `<div style="font-family:Arial,sans-serif;padding:10px;max-width:780px;margin:0 auto;">
    <h2 style="text-align:center;font-size:15px;margin:0 0 4px;">${meta.title}</h2>
    <p style="text-align:center;font-size:11px;color:#555;margin:0 0 10px;">${meta.sub}</p>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <colgroup><col style="width:26px"><col style="width:72px"><col style="width:58px"><col style="width:88px"><col style="width:88px"><col style="width:88px"><col style="width:50px"><col></colgroup>
      <thead><tr style="background:#e8f0fe;">
        <th style="border:1px solid #aaa;padding:4px 2px;font-size:10px;text-align:center;">번호</th>
        <th style="border:1px solid #aaa;padding:4px;font-size:10px;">배송동명</th>
        <th style="border:1px solid #aaa;padding:4px;font-size:10px;">담당자</th>
        <th style="border:1px solid #aaa;padding:4px;font-size:10px;">연락처</th>
        <th style="border:1px solid #aaa;padding:4px;font-size:10px;">비상연락처</th>
        <th style="border:1px solid #aaa;padding:4px;font-size:10px;">배송일정</th>
        <th style="border:1px solid #aaa;padding:4px;font-size:10px;">완료일</th>
        <th style="border:1px solid #aaa;padding:4px;font-size:10px;">비고</th>
      </tr></thead>
      <tbody>${items.map(row).join('')}${pad}</tbody>
    </table>
    <p style="font-size:9px;color:#999;margin-top:6px;text-align:right;">출력: ${new Date().toLocaleString('ko-KR')}</p>
  </div>`;
}

/* ── 달력 팝업 ────────────────────────────────────────────────── */
function DeliveryDatePicker({ value = [], onChange, onClose }) {
  const today = new Date();
  const [vy, setVy] = useState(today.getFullYear());
  const [vm, setVm] = useState(today.getMonth());
  const sel = useMemo(() => new Set(value), [value]);
  const firstDay = new Date(vy, vm, 1).getDay();
  const days = new Date(vy, vm + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const toKey = d => `${vy}-${String(vm + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const toggle = d => { const k = toKey(d); const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); onChange([...n].sort()); };
  const prevM = () => vm === 0 ? (setVy(y => y-1), setVm(11)) : setVm(m => m-1);
  const nextM = () => vm === 11 ? (setVy(y => y+1), setVm(0)) : setVm(m => m+1);
  return (
    <div className="absolute z-50 bg-[#0d1626] border border-[#1e3a5f] rounded-xl shadow-2xl p-3 w-64" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevM} className="text-gray-400 hover:text-white p-1"><ChevronLeft size={14}/></button>
        <span className="text-xs font-bold text-white">{vy}년 {vm+1}월</span>
        <button onClick={nextM} className="text-gray-400 hover:text-white p-1"><ChevronRight size={14}/></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {['일','월','화','수','목','금','토'].map(d => <div key={d} className="text-center text-[10px] text-gray-500 font-bold py-0.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => d === null ? <div key={i}/> : (
          <button key={i} onClick={() => toggle(d)}
            className={`w-full aspect-square flex items-center justify-center text-[11px] rounded font-bold transition-all
              ${sel.has(toKey(d)) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-[#1a2540]'}`}>
            {d}
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-between items-center">
        <button onClick={() => onChange([])} className="text-[10px] text-red-400 hover:text-red-300">초기화</button>
        <button onClick={onClose} className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg font-bold">확인</button>
      </div>
    </div>
  );
}

/* ── 기사 자동완성 ─────────────────────────────────────────────── */
function DriverAutocomplete({ value, onChange, drivers, placeholder = '담당자' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value || '');
  const [idx, setIdx] = useState(0);
  const ref = useRef(null);
  const filtered = useMemo(() => drivers.filter(d => matchChosung(d.name, q)).slice(0, 8), [drivers, q]);
  useEffect(() => { setQ(value || ''); }, [value]);
  const select = n => { setQ(n); onChange(n); setOpen(false); };
  return (
    <div className="relative">
      <input ref={ref} value={q} onChange={e => { setQ(e.target.value); setOpen(true); setIdx(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (!open || !filtered.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i+1, filtered.length-1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i-1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); filtered[idx] && select(filtered[idx].name); }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        className="w-full bg-transparent text-white text-xs px-2 py-1 outline-none"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-[#0d1626] border border-[#1e3a5f] rounded-lg shadow-xl min-w-[140px] overflow-hidden">
          {filtered.map((d, i) => (
            <button key={d.id||d.name} onMouseDown={() => select(d.name)}
              className={`w-full text-left px-3 py-1.5 text-xs ${i===idx?'bg-blue-700 text-white':'text-gray-200 hover:bg-[#1a2540]'}`}>
              {d.name}{d.phone && <span className="ml-2 text-gray-500">{d.phone}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   메인 컴포넌트
   ════════════════════════════════════════════════════════════════ */
export default function ScheduleTab({ user, onBack }) {
  const isAdmin = user?.role === 'admin';
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const sidoList = useMemo(() => Object.keys(REGIONS), []);
  const [sido, setSido] = useState(sidoList[0] || '');
  const [sigungu, setSigungu] = useState('');
  const sigunguList = useMemo(() => REGIONS[sido] || [], [sido]);
  useEffect(() => { if (sigunguList.length) setSigungu(sigunguList[0]); }, [sido]);

  const [subTab, setSubTab] = useState('schedule');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingIds, setSavingIds] = useState(new Set()); // 저장 중인 row id 집합
  const [toast, setToast] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editBuf, setEditBuf] = useState({});
  const [datePicker, setDatePicker] = useState(null);
  const [driverQ, setDriverQ] = useState('');
  const [driverEditId, setDriverEditId] = useState(null);
  const [driverEditBuf, setDriverEditBuf] = useState({});
  const [bulkText, setBulkText] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const dragIdx = useRef(null);

  /* ── Firestore 경로 ── */
  // 서브컬렉션: schedule_records/{docId}/items/{rowId}
  const docId = useMemo(() =>
    `${year}-${String(month).padStart(2,'0')}-${sido} ${sigungu}`,
    [year, month, sido, sigungu]
  );
  const itemsCol = useCallback(() =>
    collection(db, 'schedule_records', docId, 'items'),
    [docId]
  );
  const itemRef = useCallback((id) =>
    doc(db, 'schedule_records', docId, 'items', id),
    [docId]
  );

  /* ── 토스트 ── */
  const toastTimer = useRef(null);
  const showToast = useCallback((msg, type = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  /* ── 저장 상태 추적 ── */
  const startSaving = id => setSavingIds(p => new Set([...p, id]));
  const stopSaving = id => setSavingIds(p => { const n = new Set(p); n.delete(id); return n; });

  /* ── 데이터 로드 ──────────────────────────────────────────────── */
  const loadRecords = useCallback(async () => {
    if (!sido || !sigungu) return;
    setLoading(true);
    try {
      // 1. 신규 서브컬렉션 형식 시도
      const snap = await getDocs(itemsCol());
      if (!snap.empty) {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        items.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        setRecords(items);
        return;
      }
      // 2. 구형식(단일 문서 records 배열) 마이그레이션
      const metaSnap = await getDoc(doc(db, 'schedule_records', docId));
      if (metaSnap.exists() && metaSnap.data().records?.length) {
        const old = metaSnap.data().records;
        const items = old.map((r, i) => ({ ...r, id: r.id || newId(), seq: i }));
        // 배치로 서브컬렉션에 저장
        for (let i = 0; i < items.length; i += 499) {
          const batch = writeBatch(db);
          items.slice(i, i + 499).forEach(r => batch.set(itemRef(r.id), r));
          await batch.commit();
        }
        setRecords(items);
        showToast('데이터 형식 업그레이드 완료');
        return;
      }
      setRecords([]);
    } catch (e) {
      showToast('로드 실패: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [docId, itemsCol, itemRef, showToast]);

  // 지역/월 변경 시 편집 취소 + 새 로드
  useEffect(() => {
    setEditingId(null);
    setEditBuf({});
    setDatePicker(null);
    loadRecords();
  }, [docId]);

  /* ── 기사 로드: schedule_drivers 우선, 비어있으면 드라이버 레지스트리에서 자동 병합 ── */
  const loadDrivers = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const snap = await getDoc(doc(db, 'schedule_drivers', user.uid));
      const localDrivers = snap.exists() ? snap.data().drivers || [] : [];
      if (localDrivers.length) { setDrivers(localDrivers); return; }

      // 드라이버 레지스트리에서 매칭된 지자체 기사 자동 로드
      const city = `${sido} ${sigungu}`;
      const companyCode = user?.companyCode;
      let regDrivers = [];
      if (companyCode) {
        const regSnap = await getDocs(collection(db, 'user_companies', companyCode, 'drivers'));
        regDrivers = regSnap.docs.map(d => ({ id: d.id, name: d.data().name || '', phone: d.data().phone || '', emergency: '', note: '' }));
      }
      if (!regDrivers.length) {
        // org_drivers fallback
        const presetSnap = await getDoc(doc(db, 'driver_assignments', city, 'orgs', 'all'));
        if (presetSnap.exists() && presetSnap.data().drivers?.length) {
          regDrivers = presetSnap.data().drivers.map(d => ({ id: d.id, name: d.name || '', phone: d.phone || '', emergency: '', note: '' }));
        }
      }
      if (regDrivers.length) setDrivers(regDrivers);
    } catch { /* 기사 없으면 빈 배열 */ }
  }, [user?.uid, user?.companyCode, sido, sigungu]);
  useEffect(() => { loadDrivers(); }, [loadDrivers]);

  const saveDrivers = useCallback(async (next) => {
    try {
      await setDoc(doc(db, 'schedule_drivers', user.uid), { drivers: next, updatedAt: serverTimestamp() });
      setDrivers(next);
    } catch (e) { showToast('기사 저장 실패', 'error'); }
  }, [user?.uid, showToast]);

  /* ── 행 추가 ────────────────────────────────────────────────── */
  const addRow = useCallback(async () => {
    const id = newId();
    const seq = records.length > 0 ? Math.max(...records.map(r => r.seq ?? 0)) + 1 : 0;
    const newRow = { id, dong: '', driverName: '', phone: '', emergency: '', dates: [], completed: false, note: '', seq };
    setRecords(p => [...p, newRow]); // 낙관적
    setEditingId(id);
    setEditBuf(newRow);
    startSaving(id);
    try {
      await setDoc(itemRef(id), { ...newRow, createdAt: serverTimestamp() });
    } catch (e) {
      setRecords(p => p.filter(r => r.id !== id)); // 롤백
      showToast('행 추가 실패', 'error');
    } finally { stopSaving(id); }
  }, [records, itemRef, showToast]);

  /* ── 행 삭제 ── */
  const deleteRow = useCallback(async (id) => {
    if (!window.confirm('이 행을 삭제할까요?')) return;
    const prev = records;
    setRecords(p => p.filter(r => r.id !== id)); // 낙관적
    try {
      await deleteDoc(itemRef(id));
    } catch (e) {
      setRecords(prev); // 롤백
      showToast('삭제 실패', 'error');
    }
  }, [records, itemRef, showToast]);

  /* ── 편집 저장 (변경된 행 1개만 write) ── */
  const commitEdit = useCallback(async () => {
    if (!editingId) return;
    const updated = { ...editBuf };
    setRecords(p => p.map(r => r.id === editingId ? { ...r, ...updated } : r)); // 낙관적
    setEditingId(null);
    setEditBuf({});
    setDatePicker(null);
    startSaving(editingId);
    try {
      await setDoc(itemRef(editingId), { ...updated, updatedAt: serverTimestamp() });
    } catch (e) {
      showToast('저장 실패: ' + e.message, 'error');
      await loadRecords(); // 에러 시 서버 데이터로 복원
    } finally { stopSaving(editingId); }
  }, [editingId, editBuf, itemRef, loadRecords, showToast]);

  /* ── 완료 토글 (completed 필드만 updateDoc) ── */
  const toggleComplete = useCallback(async (id) => {
    const row = records.find(r => r.id === id);
    if (!row) return;
    const newVal = !row.completed;
    setRecords(p => p.map(r => r.id === id ? { ...r, completed: newVal } : r)); // 낙관적
    try {
      await updateDoc(itemRef(id), { completed: newVal, updatedAt: serverTimestamp() });
    } catch (e) {
      setRecords(p => p.map(r => r.id === id ? { ...r, completed: !newVal } : r)); // 롤백
      showToast('완료 처리 실패', 'error');
    }
  }, [records, itemRef, showToast]);

  /* ── 행정동 정렬 (seq 필드만 batch update) ── */
  const sortByDong = useCallback(async () => {
    const sorted = [...records].sort((a, b) => a.dong.localeCompare(b.dong, 'ko'));
    const withSeq = sorted.map((r, i) => ({ ...r, seq: i }));
    setRecords(withSeq);
    try {
      for (let i = 0; i < withSeq.length; i += 499) {
        const batch = writeBatch(db);
        withSeq.slice(i, i + 499).forEach(r => batch.update(itemRef(r.id), { seq: r.seq }));
        await batch.commit();
      }
    } catch { showToast('정렬 저장 실패', 'error'); await loadRecords(); }
  }, [records, itemRef, loadRecords, showToast]);

  /* ── 드래그 순서 변경 후 seq 배치 저장 ── */
  const handleDragStart = useCallback(i => { dragIdx.current = i; }, []);
  const handleDragOver = useCallback((e, i) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === i) return;
    setRecords(p => {
      const next = [...p];
      const [moved] = next.splice(dragIdx.current, 1);
      next.splice(i, 0, moved);
      dragIdx.current = i;
      return next;
    });
  }, []);
  const handleDrop = useCallback(async () => {
    const idx = dragIdx.current;
    dragIdx.current = null;
    // seq 배치 업데이트 (변경된 것만)
    try {
      const withSeq = records.map((r, i) => ({ id: r.id, seq: i }));
      for (let i = 0; i < withSeq.length; i += 499) {
        const batch = writeBatch(db);
        withSeq.slice(i, i + 499).forEach(({ id, seq }) => batch.update(itemRef(id), { seq }));
        await batch.commit();
      }
    } catch { /* 순서 저장 실패해도 UI는 유지 */ }
  }, [records, itemRef]);

  /* ── 전월 가져오기 ── */
  const loadPrevMonth = useCallback(async () => {
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    const prevDocId = `${py}-${String(pm).padStart(2,'0')}-${sido} ${sigungu}`;
    try {
      // 신규 형식 먼저 시도
      const snap = await getDocs(collection(db, 'schedule_records', prevDocId, 'items'));
      let prevRecs = [];
      if (!snap.empty) {
        prevRecs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        prevRecs.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      } else {
        // 구형식 fallback
        const metaSnap = await getDoc(doc(db, 'schedule_records', prevDocId));
        if (!metaSnap.exists()) { showToast('전월 데이터가 없습니다', 'error'); return; }
        prevRecs = metaSnap.data().records || [];
      }
      if (!prevRecs.length) { showToast('전월 데이터가 없습니다', 'error'); return; }
      if (!window.confirm(`전월(${py}년 ${pm}월) 데이터 ${prevRecs.length}개를 가져옵니다.\n현재 데이터에 추가됩니다.`)) return;

      const maxSeq = records.length ? Math.max(...records.map(r => r.seq ?? 0)) + 1 : 0;
      const newRecs = prevRecs.map((r, i) => ({
        ...r, id: newId(), dates: [], completed: false, seq: maxSeq + i
      }));
      // 배치 저장
      for (let i = 0; i < newRecs.length; i += 499) {
        const batch = writeBatch(db);
        newRecs.slice(i, i + 499).forEach(r => batch.set(itemRef(r.id), { ...r, createdAt: serverTimestamp() }));
        await batch.commit();
      }
      setRecords(p => [...p, ...newRecs]);
      showToast(`${newRecs.length}개 가져오기 완료`);
    } catch (e) { showToast('전월 로드 실패: ' + e.message, 'error'); }
  }, [year, month, sido, sigungu, records, itemRef, showToast]);

  /* ── DB에서 행정동 가져오기 (cloud_lists → schedule_records) ── */
  const autoGenDongs = useCallback(async () => {
    try {
      const monthId = `${year}-${String(month).padStart(2,'0')}`;
      const city = `${sido} ${sigungu}`;
      const snap = await getDocs(collection(db, 'cloud_lists', city, 'months', monthId, 'records'));
      if (snap.empty) { showToast('cloud_lists에 데이터가 없습니다', 'error'); return; }
      const dongSet = new Set();
      snap.forEach(d => { const v = d.data()['행정동']; if (v) dongSet.add(v); });
      const existDongs = new Set(records.map(r => r.dong));
      const newDongs = [...dongSet].filter(d => !existDongs.has(d)).sort((a, b) => a.localeCompare(b, 'ko'));
      if (!newDongs.length) { showToast('추가할 새 행정동이 없습니다'); return; }
      const maxSeq = records.length ? Math.max(...records.map(r => r.seq ?? 0)) + 1 : 0;
      const newRows = newDongs.map((dong, i) => ({
        id: newId(), dong, driverName: '', phone: '', emergency: '', dates: [], completed: false, note: '', seq: maxSeq + i
      }));
      for (let i = 0; i < newRows.length; i += 499) {
        const batch = writeBatch(db);
        newRows.slice(i, i + 499).forEach(r => batch.set(itemRef(r.id), { ...r, createdAt: serverTimestamp() }));
        await batch.commit();
      }
      setRecords(p => [...p, ...newRows]);
      showToast(`${newRows.length}개 행정동 추가 완료`);
    } catch (e) { showToast('자동생성 실패: ' + e.message, 'error'); }
  }, [isAdmin, year, month, sido, sigungu, records, itemRef, showToast]);

  /* ── 내보내기 ── */
  const reportMeta = useMemo(() => ({
    title: `${year}년 ${month}월 배송일정 — ${sido} ${sigungu}`,
    sub: `총 ${records.length}개 지역 | 완료 ${records.filter(r => r.completed).length}개`
  }), [year, month, sido, sigungu, records]);

  const handlePrint = useCallback(() => {
    const html = buildReportHtml(records, reportMeta);
    const w = window.open('', '_blank', 'width=900,height=700');
    w.document.write(`<html><head><title>배송일정</title><style>@page{size:A4;margin:10mm;}body{margin:0;}</style></head><body>${html}</body></html>`);
    w.document.close(); w.focus(); w.print();
  }, [records, reportMeta]);

  const handleExportExcel = useCallback(() => {
    const html = buildReportHtml(records, reportMeta);
    const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `배송일정-${year}년${month}월-${sigungu}.xls` });
    a.click(); URL.revokeObjectURL(a.href);
  }, [records, reportMeta, year, month, sigungu]);

  const handleExportPDF = useCallback(async () => {
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'), import('html2canvas')
      ]);
      const html = buildReportHtml(records, reportMeta);
      const container = Object.assign(document.createElement('div'), {
        style: 'position:absolute;left:-9999px;top:0;width:780px;background:#fff;'
      });
      container.innerHTML = html;
      document.body.appendChild(container);
      const canvas = await html2canvas(container, { scale: 1.5, useCORS: true });
      document.body.removeChild(container);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
      const ratio = pw / canvas.width;
      const ih = canvas.height * ratio;
      let py = 0;
      while (py < ih) { if (py > 0) pdf.addPage(); pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, -py, pw, ih); py += ph; }
      pdf.save(`배송일정-${year}년${month}월-${sigungu}.pdf`);
    } catch (e) { showToast('PDF 생성 실패: ' + e.message, 'error'); }
  }, [records, reportMeta, year, month, sigungu, showToast]);

  const handleReport = useCallback(async () => {
    await Promise.all([handleExportPDF(), handleExportExcel()]);
    showToast('PDF + Excel 내보내기 완료');
  }, [handleExportPDF, handleExportExcel, showToast]);

  /* ── 기사 관리 ── */
  const filteredDrivers = useMemo(() => drivers.filter(d => matchChosung(d.name + (d.phone || ''), driverQ)), [drivers, driverQ]);

  const addDriver = useCallback(() => {
    const id = newId();
    const newD = { id, name: '', phone: '', emergency: '', note: '' };
    setDrivers(p => [...p, newD]);
    setDriverEditId(id);
    setDriverEditBuf(newD);
  }, []);

  const commitDriverEdit = useCallback(() => {
    if (!driverEditId) return;
    const next = drivers.map(d => d.id === driverEditId ? { ...d, ...driverEditBuf } : d);
    saveDrivers(next);
    setDriverEditId(null);
    setDriverEditBuf({});
  }, [driverEditId, driverEditBuf, drivers, saveDrivers]);

  const deleteDriver = useCallback((id) => {
    if (!window.confirm('삭제하시겠습니까?')) return;
    saveDrivers(drivers.filter(d => d.id !== id));
  }, [drivers, saveDrivers]);

  const handleBulkImport = useCallback(async () => {
    const newDrivers = bulkText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const p = line.split(/[\t,]/).map(s => s.trim());
      return { id: newId(), name: p[0]||'', phone: p[1]||'', emergency: p[2]||'', note: p[3]||'' };
    }).filter(d => d.name);
    if (!newDrivers.length) { showToast('유효한 데이터가 없습니다', 'error'); return; }
    await saveDrivers([...drivers, ...newDrivers]);
    setBulkText(''); setShowBulk(false);
    showToast(`${newDrivers.length}명 추가 완료`);
  }, [bulkText, drivers, saveDrivers, showToast]);

  /* ── 통계 ── */
  const stats = useMemo(() => ({
    total: records.length,
    done: records.filter(r => r.completed).length,
    saving: savingIds.size > 0,
  }), [records, savingIds]);

  /* ── 월 이동 ── */
  const prevMonth = () => month === 1 ? (setYear(y => y-1), setMonth(12)) : setMonth(m => m-1);
  const nextMonth = () => month === 12 ? (setYear(y => y+1), setMonth(1)) : setMonth(m => m+1);

  /* ── 렌더 ── */
  return (
    <div className="flex flex-col h-full bg-[#050505] text-white overflow-hidden">

      {/* 토스트 */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[999] px-5 py-2.5 rounded-xl text-sm font-bold shadow-2xl border
          ${toast.type==='error'?'bg-red-950 border-red-500/50 text-red-300':'bg-emerald-950 border-emerald-500/50 text-emerald-300'}`}
          style={{ animation: 'slideUpToast 0.3s ease' }}>
          {toast.msg}
        </div>
      )}

      {/* 툴바 */}
      <div className="shrink-0 bg-[#0a0a0a] border-b border-[#1a1a1a] px-5 py-3 flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-xs font-bold px-3 py-1.5 rounded-lg bg-[#111] hover:bg-[#1a1a1a] border border-[#2a2a2a] transition-all">
          <ArrowLeft size={14}/> 뒤로
        </button>
        <div className="w-px h-6 bg-[#222]"/>

        {/* 서브탭 */}
        <div className="flex bg-[#111] border border-[#222] rounded-lg overflow-hidden">
          {[['schedule','배송일정',<CalendarDays size={13}/>],['drivers','기사 관리',<Users size={13}/>]].map(([k,l,ic]) => (
            <button key={k} onClick={() => setSubTab(k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all ${subTab===k?'bg-blue-700 text-white':'text-gray-400 hover:text-white hover:bg-[#1a1a1a]'}`}>
              {ic}{l}
            </button>
          ))}
        </div>
        <div className="w-px h-6 bg-[#222]"/>

        {/* 연/월 */}
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="p-1 text-gray-400 hover:text-white"><ChevronLeft size={14}/></button>
          <span className="text-xs font-bold text-white min-w-[64px] text-center">{year}년 {month}월</span>
          <button onClick={nextMonth} className="p-1 text-gray-400 hover:text-white"><ChevronRight size={14}/></button>
        </div>

        {/* 지역 */}
        <select value={sido} onChange={e => setSido(e.target.value)} className="bg-[#111] border border-[#2a2a2a] text-white text-xs rounded-lg px-2 py-1.5 outline-none">
          {sidoList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sigungu} onChange={e => setSigungu(e.target.value)} className="bg-[#111] border border-[#2a2a2a] text-white text-xs rounded-lg px-2 py-1.5 outline-none">
          {sigunguList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="w-px h-6 bg-[#222]"/>

        {subTab === 'schedule' && (<>
          <button onClick={loadPrevMonth} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#111] hover:bg-[#1a1a1a] border border-[#2a2a2a] text-gray-300 transition-all">
            <RefreshCw size={13}/> 전월 가져오기
          </button>
          <button onClick={sortByDong} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#111] hover:bg-[#1a1a1a] border border-[#2a2a2a] text-gray-300 transition-all">
            <LayoutList size={13}/> 행정동 정렬
          </button>
          <button onClick={autoGenDongs} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-950/60 hover:bg-indigo-900/60 border border-indigo-700/40 text-indigo-300 transition-all">
            <RefreshCw size={13}/> DB 가져오기
          </button>
          <button onClick={addRow} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-700/40 text-emerald-300 transition-all">
            <Plus size={13}/> 행 추가
          </button>
          <div className="flex-1"/>
          <button onClick={handlePrint} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#111] hover:bg-[#1a1a1a] border border-[#2a2a2a] text-gray-300 transition-all">
            <Printer size={13}/> 인쇄
          </button>
          <button onClick={handleExportExcel} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#111] hover:bg-[#1a1a1a] border border-[#2a2a2a] text-emerald-300 transition-all">
            <FileSpreadsheet size={13}/> 엑셀
          </button>
          <button onClick={handleReport} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white border border-blue-500 transition-all shadow-[0_0_12px_rgba(59,130,246,0.3)]">
            <Send size={13}/> 보고하기
          </button>
        </>)}

        {subTab === 'drivers' && (<>
          <button onClick={addDriver} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-700/40 text-emerald-300 transition-all">
            <Plus size={13}/> 기사 추가
          </button>
          <button onClick={() => setShowBulk(v => !v)} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#111] hover:bg-[#1a1a1a] border border-[#2a2a2a] text-gray-300 transition-all">
            <Download size={13}/> 일괄 입력
          </button>
          <div className="flex-1"/>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"/>
            <input value={driverQ} onChange={e => setDriverQ(e.target.value)} placeholder="기사 검색"
              className="pl-7 pr-3 py-1.5 text-xs bg-[#111] border border-[#2a2a2a] rounded-lg text-white outline-none w-40"/>
          </div>
        </>)}
      </div>

      {/* 컨텐츠 */}
      <div className="flex-1 overflow-auto p-4" onClick={() => { if (datePicker) setDatePicker(null); }}>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"/>
          </div>

        ) : subTab === 'schedule' ? (

          /* ── 배송일정 테이블 ── */
          <div className="rounded-xl border border-[#1a2540] overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#0d1626] text-gray-400 uppercase tracking-wide">
                  {['번호','배송동명','담당자','연락처','비상연락처','배송일정','완료','비고','관리'].map(h => (
                    <th key={h} className="border border-[#1a2540] px-2 py-2.5 font-bold text-left first:text-center">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!records.length && (
                  <tr><td colSpan={9} className="py-16 text-center text-gray-600">
                    <div className="flex flex-col items-center gap-3">
                      <CalendarDays size={36} className="text-gray-700"/>
                      <p className="text-sm">행을 추가하거나 전월 데이터를 가져오세요.</p>
                    </div>
                  </td></tr>
                )}
                {records.map((r, idx) => {
                  const isEditing = editingId === r.id;
                  const isSaving_ = savingIds.has(r.id);
                  const isComplete = !!r.completed;
                  return (
                    <tr key={r.id} draggable onDragStart={() => handleDragStart(idx)}
                      onDragOver={e => handleDragOver(e, idx)} onDrop={handleDrop}
                      className={`transition-colors border-b border-[#111a2e] cursor-grab active:cursor-grabbing
                        ${isComplete?'bg-amber-950/30':idx%2===0?'bg-[#070b14]':'bg-[#050a12]'}
                        ${isEditing?'ring-1 ring-inset ring-blue-500':'hover:bg-[#0d1626]/60'}
                        ${isSaving_?'opacity-70':''}`}>

                      <td className="border border-[#111a2e] px-2 py-1.5 text-center text-gray-500 w-10">
                        {isSaving_ ? <RefreshCw size={11} className="animate-spin mx-auto text-blue-400"/> : idx+1}
                      </td>

                      <td className="border border-[#111a2e] px-1 py-1 w-28">
                        {isEditing
                          ? <input value={editBuf.dong||''} onChange={e=>setEditBuf(b=>({...b,dong:e.target.value}))} autoFocus placeholder="동명"
                              className="w-full bg-transparent text-white text-xs px-2 py-1 outline-none border-b border-blue-500"/>
                          : <span className="px-2 py-1 block">{r.dong||<span className="text-gray-700">—</span>}</span>}
                      </td>

                      <td className="border border-[#111a2e] px-1 py-1 w-28">
                        {isEditing
                          ? <DriverAutocomplete value={editBuf.driverName||''} onChange={v=>setEditBuf(b=>({...b,driverName:v}))} drivers={drivers}/>
                          : <span className="px-2 py-1 block text-blue-200">{r.driverName||<span className="text-gray-700">—</span>}</span>}
                      </td>

                      <td className="border border-[#111a2e] px-1 py-1 w-32">
                        {isEditing
                          ? <input value={editBuf.phone||''} onChange={e=>setEditBuf(b=>({...b,phone:e.target.value}))} placeholder="010-0000-0000"
                              className="w-full bg-transparent text-white text-xs px-2 py-1 outline-none"/>
                          : <span className="px-2 py-1 block text-gray-300">{r.phone||<span className="text-gray-700">—</span>}</span>}
                      </td>

                      <td className="border border-[#111a2e] px-1 py-1 w-32">
                        {isEditing
                          ? <input value={editBuf.emergency||''} onChange={e=>setEditBuf(b=>({...b,emergency:e.target.value}))} placeholder="비상연락처"
                              className="w-full bg-transparent text-white text-xs px-2 py-1 outline-none"/>
                          : <span className="px-2 py-1 block text-gray-400">{r.emergency||<span className="text-gray-700">—</span>}</span>}
                      </td>

                      <td className={`border border-[#111a2e] px-1 py-1 relative ${isComplete?'bg-amber-900/30':''}`}>
                        {isEditing ? (
                          <div className="relative" onClick={e=>e.stopPropagation()}>
                            <button onClick={() => setDatePicker(datePicker===r.id?null:r.id)}
                              className="w-full text-left text-xs px-2 py-1 text-blue-300 hover:text-blue-200 flex items-center gap-1">
                              <CalendarDays size={11}/>
                              {editBuf.dates?.length>0?formatDateRanges(editBuf.dates):'날짜 선택'}
                            </button>
                            {datePicker===r.id && (
                              <DeliveryDatePicker value={editBuf.dates||[]}
                                onChange={v=>setEditBuf(b=>({...b,dates:v}))} onClose={()=>setDatePicker(null)}/>
                            )}
                          </div>
                        ) : (
                          <button onClick={e=>{e.stopPropagation();setEditingId(r.id);setEditBuf({...r});setDatePicker(r.id);}}
                            className="px-2 py-1 block w-full text-left text-gray-300 hover:text-blue-300 transition-colors">
                            {r.dates?.length>0?formatDateRanges(r.dates):<span className="text-gray-700">—</span>}
                          </button>
                        )}
                      </td>

                      <td className={`border border-[#111a2e] px-2 py-1 text-center w-16 ${isComplete?'bg-amber-900/40':''}`}>
                        <button onClick={()=>toggleComplete(r.id)}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center mx-auto transition-all
                            ${isComplete?'bg-amber-400 border-amber-400 text-amber-900':'border-gray-600 text-transparent hover:border-amber-400'}`}>
                          {isComplete && <Check size={12}/>}
                        </button>
                      </td>

                      <td className="border border-[#111a2e] px-1 py-1">
                        {isEditing
                          ? <input value={editBuf.note||''} onChange={e=>setEditBuf(b=>({...b,note:e.target.value}))} placeholder="비고"
                              className="w-full bg-transparent text-white text-xs px-2 py-1 outline-none"/>
                          : <span className="px-2 py-1 block text-gray-400 truncate max-w-[180px]">{r.note||''}</span>}
                      </td>

                      <td className="border border-[#111a2e] px-2 py-1 text-center w-16">
                        <div className="flex items-center justify-center gap-1">
                          {isEditing ? (<>
                            <button onClick={commitEdit} title="저장" className="p-1 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/30 rounded transition-all"><Save size={13}/></button>
                            <button onClick={()=>{setEditingId(null);setEditBuf({});setDatePicker(null);}} title="취소" className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-all"><X size={13}/></button>
                          </>) : (<>
                            <button onClick={()=>{setEditingId(r.id);setEditBuf({...r});}} title="편집" className="p-1 text-gray-500 hover:text-blue-300 hover:bg-blue-900/30 rounded transition-all"><Pencil size={13}/></button>
                            <button onClick={()=>deleteRow(r.id)} title="삭제" className="p-1 text-gray-600 hover:text-red-400 hover:bg-red-900/30 rounded transition-all"><Trash2 size={13}/></button>
                          </>)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {records.length > 0 && (
              <div className="flex items-center gap-4 px-4 py-2.5 bg-[#0a0f1a] border-t border-[#1a2540] text-xs text-gray-500">
                <span>총 <b className="text-white">{stats.total}</b>개</span>
                <span>완료 <b className="text-amber-400">{stats.done}</b></span>
                <span>미완료 <b className="text-gray-300">{stats.total - stats.done}</b></span>
                {stats.saving && (
                  <span className="text-blue-400 flex items-center gap-1">
                    <RefreshCw size={11} className="animate-spin"/> 저장 중...
                  </span>
                )}
              </div>
            )}
          </div>

        ) : (

          /* ── 기사 관리 탭 ── */
          <div className="space-y-4">
            {showBulk && (
              <div className="bg-[#0a0f1a] border border-[#1a2540] rounded-xl p-4 space-y-2">
                <p className="text-xs text-gray-400 font-bold">한 줄에 한 명 — 이름, 연락처, 비상연락처, 비고 순서 (탭/쉼표 구분)</p>
                <textarea value={bulkText} onChange={e=>setBulkText(e.target.value)} rows={5}
                  placeholder="홍길동&#9;010-1234-5678&#10;김철수&#9;010-9999-8888"
                  className="w-full bg-[#060c18] border border-[#1a2540] text-white text-xs rounded-lg p-3 outline-none resize-none font-mono"/>
                <div className="flex gap-2">
                  <button onClick={handleBulkImport} className="text-xs font-bold px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg transition-all">추가</button>
                  <button onClick={()=>{setShowBulk(false);setBulkText('');}} className="text-xs font-bold px-4 py-1.5 bg-[#111] hover:bg-[#1a1a1a] text-gray-300 rounded-lg border border-[#2a2a2a] transition-all">취소</button>
                </div>
              </div>
            )}
            <div className="rounded-xl border border-[#1a2540] overflow-hidden">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#0d1626] text-gray-400 uppercase tracking-wide">
                    {['번호','이름','연락처','비상연락처','비고','관리'].map(h => <th key={h} className="border border-[#1a2540] px-3 py-2.5 font-bold text-left">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {!filteredDrivers.length && (
                    <tr><td colSpan={6} className="py-12 text-center text-gray-600">
                      <div className="flex flex-col items-center gap-3"><Users size={32} className="text-gray-700"/><p>등록된 기사가 없습니다.</p></div>
                    </td></tr>
                  )}
                  {filteredDrivers.map((d, idx) => {
                    const isEdit = driverEditId === d.id;
                    return (
                      <tr key={d.id} className={`border-b border-[#111a2e] transition-colors ${idx%2===0?'bg-[#070b14]':'bg-[#050a12]'} ${isEdit?'ring-1 ring-inset ring-blue-500':'hover:bg-[#0d1626]/60'}`}>
                        <td className="border border-[#111a2e] px-3 py-2 text-gray-600 w-10">{idx+1}</td>
                        <td className="border border-[#111a2e] px-1 py-1 w-32">
                          {isEdit?<input value={driverEditBuf.name||''} onChange={e=>setDriverEditBuf(b=>({...b,name:e.target.value}))} autoFocus placeholder="이름" className="w-full bg-transparent text-white text-xs px-2 py-1 outline-none border-b border-blue-500"/>:<span className="px-2 py-1 block font-bold text-white">{d.name}</span>}
                        </td>
                        <td className="border border-[#111a2e] px-1 py-1 w-36">
                          {isEdit?<input value={driverEditBuf.phone||''} onChange={e=>setDriverEditBuf(b=>({...b,phone:e.target.value}))} placeholder="010-0000-0000" className="w-full bg-transparent text-white text-xs px-2 py-1 outline-none"/>:<span className="px-2 py-1 block text-gray-300">{d.phone||'—'}</span>}
                        </td>
                        <td className="border border-[#111a2e] px-1 py-1 w-36">
                          {isEdit?<input value={driverEditBuf.emergency||''} onChange={e=>setDriverEditBuf(b=>({...b,emergency:e.target.value}))} placeholder="비상연락처" className="w-full bg-transparent text-white text-xs px-2 py-1 outline-none"/>:<span className="px-2 py-1 block text-gray-400">{d.emergency||'—'}</span>}
                        </td>
                        <td className="border border-[#111a2e] px-1 py-1">
                          {isEdit?<input value={driverEditBuf.note||''} onChange={e=>setDriverEditBuf(b=>({...b,note:e.target.value}))} placeholder="비고" className="w-full bg-transparent text-white text-xs px-2 py-1 outline-none"/>:<span className="px-2 py-1 block text-gray-500">{d.note||''}</span>}
                        </td>
                        <td className="border border-[#111a2e] px-2 py-1 text-center w-20">
                          <div className="flex items-center justify-center gap-1">
                            {isEdit?(<>
                              <button onClick={commitDriverEdit} title="저장" className="p-1 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/30 rounded"><Save size={13}/></button>
                              <button onClick={()=>{setDriverEditId(null);setDriverEditBuf({});}} title="취소" className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded"><X size={13}/></button>
                            </>):(<>
                              <button onClick={()=>{setDriverEditId(d.id);setDriverEditBuf({...d});}} title="편집" className="p-1 text-gray-500 hover:text-blue-300 hover:bg-blue-900/30 rounded"><Pencil size={13}/></button>
                              <button onClick={()=>deleteDriver(d.id)} title="삭제" className="p-1 text-gray-600 hover:text-red-400 hover:bg-red-900/30 rounded"><Trash2 size={13}/></button>
                            </>)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {drivers.length > 0 && (
                <div className="px-4 py-2 bg-[#0a0f1a] border-t border-[#1a2540] text-xs text-gray-500">
                  총 <b className="text-white">{drivers.length}</b>명{driverQ&&` | 검색 ${filteredDrivers.length}명`}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
