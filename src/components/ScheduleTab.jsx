import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../config/firebase.js';
import { doc, getDoc, setDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { Calendar, Plus, Trash2, ChevronLeft, ChevronRight, Check, Printer, FileSpreadsheet, FileText, SortAsc, Copy, Wand2, RefreshCw, Loader2 } from 'lucide-react';
import { REGIONS, getSigunguOptions } from '../utils/regions.js';

// ★보고서 HTML 은 innerHTML 로 렌더된다 — 이름·전화·비고를 그대로 넣으면 저장형 XSS 가 된다
//   (CSP 가 'unsafe-inline' 이라 실행된다 · 2026-08-23 점검). 같은 리포 RouteMapModal 의 escHtml 과 같은 규격.
const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ─── Constants ──────────────────────────────────────────────────────────────
const CHOSUNG_LIST = ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ','ㄲ','ㄸ','ㅃ','ㅆ','ㅉ'];
const HANGUL_START = 0xAC00;

// ─── Utilities ───────────────────────────────────────────────────────────────

function getCharChosung(ch) {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_START || code > 0xD7A3) return ch;
  return CHOSUNG_LIST[Math.floor((code - HANGUL_START) / 588)];
}

function getChosung(str) {
  return [...(str || '')].map(getCharChosung).join('');
}

function isChosungOnly(str) {
  return str.length > 0 && [...str].every(c => CHOSUNG_LIST.includes(c));
}

function formatDateRanges(dates) {
  if (!dates || dates.length === 0) return '';
  const sorted = [...dates].sort();
  const groups = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(end);
    const curr = new Date(sorted[i]);
    const diff = (curr - prev) / 86400000;
    if (diff === 1) {
      end = sorted[i];
    } else {
      groups.push([start, end]);
      start = sorted[i];
      end = sorted[i];
    }
  }
  groups.push([start, end]);
  return groups.map(([s, e]) => {
    const sm = parseInt(s.slice(5, 7));
    const sd = parseInt(s.slice(8, 10));
    if (s === e) return `${sm}/${sd}`;
    const em = parseInt(e.slice(5, 7));
    const ed = parseInt(e.slice(8, 10));
    if (sm === em) return `${sm}/${sd}-${ed}`;
    return `${sm}/${sd}~${em}/${ed}`;
  }).join(', ');
}

function makeRow(overrides = {}) {
  return {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    dong: '',
    driverName: '',
    phone: '',
    emergencyPhone: '',
    dates: [],
    completed: false,
    note: '',
    ...overrides,
  };
}

// ─── DriverAutocomplete ──────────────────────────────────────────────────────

function DriverAutocomplete({ value, onChange, drivers, placeholder = '기사 선택' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || '');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 200 });
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  const scored = useMemo(() => {
    const q = query.trim();
    if (!q) return drivers.slice(0, 8);
    const qLow = q.toLowerCase();
    const qCs = getChosung(q);
    const csOnly = isChosungOnly(q);
    const qDigits = q.replace(/[^0-9]/g, '');
    return drivers
      .map(d => {
        const name = d.name || '';
        const phone = (d.phone || '').replace(/[^0-9]/g, '');
        let score = 0;
        if (name === q) score = 100;
        else if (name.startsWith(q)) score = 80;
        else if (name.toLowerCase().includes(qLow)) score = 60;
        else if (qDigits.length >= 4 && phone.includes(qDigits)) score = 40;
        else if (csOnly && getChosung(name).includes(qCs)) score = 30;
        return score > 0 ? { ...d, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [query, drivers]);

  const updatePos = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: Math.max(r.width, 180) });
  }, []);

  const handleFocus = () => { updatePos(); setOpen(true); setHighlighted(0); };

  const handleBlur = (e) => {
    if (listRef.current?.contains(e.relatedTarget)) return;
    setOpen(false);
    onChange(query);
  };

  const select = (d) => {
    setQuery(d.name);
    onChange(d.name, d);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { updatePos(); setOpen(true); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, scored.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      if (scored[highlighted]) { e.preventDefault(); select(scored[highlighted]); }
      else { setOpen(false); onChange(query); }
    }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <>
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); updatePos(); setHighlighted(0); if (!open) setOpen(true); }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full bg-transparent text-white text-xs px-2 py-1.5 outline-none placeholder-gray-700"
        autoComplete="off"
      />
      {open && scored.length > 0 && createPortal(
        <div
          ref={listRef}
          style={{ position: 'absolute', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="bg-[#0d1117] border border-[#3b82f6]/30 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.8)] overflow-hidden"
        >
          {scored.map((d, i) => (
            <div
              key={d.id || d.name}
              onMouseDown={() => select(d)}
              onMouseEnter={() => setHighlighted(i)}
              className={`px-3 py-2 flex items-center gap-2 cursor-pointer text-xs transition-colors ${
                i === highlighted ? 'bg-[#3b82f6]/20 text-white' : 'text-gray-300 hover:bg-[#1a2333]'
              }`}
            >
              <span className="flex-1 font-bold truncate">{d.name}</span>
              {d.phone && <span className="text-gray-500 text-[10px] shrink-0">{d.phone}</span>}
              {d._src === 'org' && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-700/30 shrink-0">소속사</span>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ─── DeliveryDatePicker ──────────────────────────────────────────────────────

function DeliveryDatePicker({ value = [], onChange, year, month }) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(year);
  const [viewMonth, setViewMonth] = useState(month);
  const [draft, setDraft] = useState(value);
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { setViewYear(year); setViewMonth(month); }, [year, month]);

  const updatePos = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const left = Math.min(r.left + window.scrollX, window.innerWidth - 270);
    setPos({ top: r.bottom + window.scrollY + 2, left: Math.max(left, 4) });
  };

  const openPicker = () => { setDraft([...value]); updatePos(); setOpen(true); };

  const handleOutside = useCallback((e) => {
    if (popupRef.current && !popupRef.current.contains(e.target) && !triggerRef.current?.contains(e.target)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open, handleOutside]);

  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay();

  const toggleDate = (day) => {
    const ds = `${viewYear}-${String(viewMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    setDraft(prev => prev.includes(ds) ? prev.filter(d => d !== ds) : [...prev, ds]);
  };

  const prevMonth = () => {
    if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1); }
    else setViewMonth(m => m + 1);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPicker}
        className="w-full text-left text-xs px-2 py-1.5 truncate"
        title={value.join(', ')}
      >
        {value.length === 0
          ? <span className="text-gray-700">날짜 선택</span>
          : <span className="text-blue-300 font-medium">{formatDateRanges(value)}</span>
        }
      </button>
      {open && createPortal(
        <div
          ref={popupRef}
          style={{ position: 'absolute', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="bg-[#0d1117] border border-[#3b82f6]/30 rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.9)] p-3 w-64"
        >
          <div className="flex items-center justify-between mb-2">
            <button onClick={prevMonth} className="p-1 hover:bg-[#1a2333] rounded text-gray-400 hover:text-white transition-colors">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-bold text-white">{viewYear}년 {viewMonth}월</span>
            <button onClick={nextMonth} className="p-1 hover:bg-[#1a2333] rounded text-gray-400 hover:text-white transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {['일','월','화','수','목','금','토'].map((d, i) => (
              <div key={d} className={`text-center text-[9px] font-bold py-0.5 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'}`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const ds = `${viewYear}-${String(viewMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const sel = draft.includes(ds);
              const dow = (firstDow + i) % 7;
              return (
                <button
                  key={day}
                  onClick={() => toggleDate(day)}
                  className={`text-[11px] py-1 rounded-full transition-all font-medium ${
                    sel
                      ? 'bg-[#3b82f6] text-white font-black shadow-[0_0_8px_rgba(59,130,246,0.5)]'
                      : dow === 0 ? 'text-red-400 hover:bg-red-900/20'
                      : dow === 6 ? 'text-blue-400 hover:bg-blue-900/20'
                      : 'text-gray-300 hover:bg-[#1a2333]'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1a2333]">
            <button onClick={() => setDraft([])} className="text-[10px] text-gray-500 hover:text-red-400 transition-colors">초기화</button>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">{draft.length}개</span>
              <button
                onClick={() => { onChange([...draft].sort()); setOpen(false); }}
                className="px-3 py-1 bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[10px] font-bold rounded-lg transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── ScheduleTab ─────────────────────────────────────────────────────────────

export default function ScheduleTab({ user, onBack }) {
  const now = new Date();
  const [activeSubTab, setActiveSubTab] = useState('schedule');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [sido, setSido] = useState('');
  const [sigungu, setSigungu] = useState('');

  const [rows, setRows] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [personalDrivers, setPersonalDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [driverForm, setDriverForm] = useState({ name: '', phone: '', emergencyPhone: '' });
  const [editingDriverId, setEditingDriverId] = useState(null);
  const [bulkText, setBulkText] = useState('');
  const [driverSaving, setDriverSaving] = useState(false);

  const saveTimerRef = useRef(null);

  const uid = user?.uid;
  const orgId = user?.orgId || null;
  const isAdmin = user?.role === 'admin';
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const city = [sido, sigungu].filter(Boolean).join(' ');

  const sidoOptions = useMemo(() => Object.keys(REGIONS), []);
  const sigunguOptions = useMemo(() => getSigunguOptions(sido), [sido]);

  // ─── Load Drivers ──────────────────────────────────────────────────────────
  const loadDrivers = useCallback(async () => {
    if (!uid) return;
    const personal = [];
    const orgList = [];
    try {
      const pSnap = await getDoc(doc(db, 'schedule_drivers', uid));
      if (pSnap.exists()) {
        (pSnap.data().drivers || []).forEach(d => personal.push({ ...d, _src: 'personal' }));
      }
      setPersonalDrivers(personal.map(d => ({ ...d })));

      if (orgId) {
        const orgSnap = await getDocs(collection(db, 'org_drivers', orgId, 'drivers'));
        orgSnap.forEach(d => {
          const data = d.data();
          if (data.active !== false) {
            orgList.push({
              id: d.id,
              name: data.name || data['기사명'] || '',
              phone: data.phone || data['연락처'] || '',
              emergencyPhone: data.emergencyPhone || data['비상연락처'] || '',
              _src: 'org',
              org: orgId,
            });
          }
        });
      }
    } catch (e) {
      console.error('loadDrivers', e);
    }
    setDrivers([...personal, ...orgList]);
  }, [uid, orgId]);

  // ─── Load Schedule ─────────────────────────────────────────────────────────
  const loadSchedule = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'schedule_records', uid, 'months', monthKey));
      setRows(snap.exists() ? (snap.data().rows || []) : []);
    } catch (e) {
      console.error('loadSchedule', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [uid, monthKey]);

  // ─── Save Schedule ─────────────────────────────────────────────────────────
  const saveSchedule = useCallback(async (newRows) => {
    if (!uid) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'schedule_records', uid, 'months', monthKey), {
        rows: newRows,
        city,
        year,
        month,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('saveSchedule', e);
    } finally {
      setSaving(false);
    }
  }, [uid, monthKey, city, year, month]);

  const debouncedSave = useCallback((newRows) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveSchedule(newRows), 600);
  }, [saveSchedule]);

  useEffect(() => { loadDrivers(); }, [loadDrivers]);
  useEffect(() => { if (uid) loadSchedule(); }, [loadSchedule]);

  // ─── Row CRUD ──────────────────────────────────────────────────────────────
  const updateRowText = (id, field, value) => {
    setRows(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, [field]: value } : r);
      debouncedSave(updated);
      return updated;
    });
  };

  const updateRowImmediate = (id, fields) => {
    setRows(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, ...fields } : r);
      saveSchedule(updated);
      return updated;
    });
  };

  const addRow = () => {
    setRows(prev => {
      const updated = [...prev, makeRow()];
      saveSchedule(updated);
      return updated;
    });
  };

  const deleteRow = (id) => {
    if (!window.confirm('이 행을 삭제하시겠습니까?')) return;
    setRows(prev => {
      const updated = prev.filter(r => r.id !== id);
      saveSchedule(updated);
      return updated;
    });
  };

  const sortByDong = () => {
    setRows(prev => {
      const sorted = [...prev].sort((a, b) => (a.dong || '').localeCompare(b.dong || '', 'ko-KR', { numeric: true }));
      saveSchedule(sorted);
      return sorted;
    });
  };

  const handleDriverSelect = (rowId, driverName, driverObj) => {
    setRows(prev => {
      const row = prev.find(r => r.id === rowId);
      const fields = { driverName };
      if (driverObj) {
        if (driverObj.phone && !row?.phone) fields.phone = driverObj.phone;
        if (driverObj.emergencyPhone && !row?.emergencyPhone) fields.emergencyPhone = driverObj.emergencyPhone;
      }
      const updated = prev.map(r => r.id === rowId ? { ...r, ...fields } : r);
      saveSchedule(updated);
      return updated;
    });
  };

  const copyPreviousMonth = async () => {
    if (!uid) return;
    const prevM = month === 1 ? 12 : month - 1;
    const prevY = month === 1 ? year - 1 : year;
    const prevKey = `${prevY}-${String(prevM).padStart(2, '0')}`;
    try {
      const snap = await getDoc(doc(db, 'schedule_records', uid, 'months', prevKey));
      if (!snap.exists()) return alert(`${prevY}년 ${prevM}월 데이터가 없습니다.`);
      const prevRows = (snap.data().rows || []).map(r => makeRow({
        dong: r.dong || '',
        driverName: r.driverName || '',
        phone: r.phone || '',
        emergencyPhone: r.emergencyPhone || '',
        note: r.note || '',
      }));
      if (rows.length > 0 && !window.confirm('현재 데이터를 지우고 전월 데이터를 가져오시겠습니까?')) return;
      setRows(prevRows);
      await saveSchedule(prevRows);
    } catch (e) {
      alert('전월 데이터 로드 실패: ' + e.message);
    }
  };

  const autoGenerateDongs = async () => {
    if (!city) return alert('시/도 및 시/군/구를 먼저 선택해주세요.');
    try {
      const recordsRef = collection(db, 'cloud_lists', city, 'months', monthKey, 'records');
      const snap = await getDocs(recordsRef);
      if (snap.empty) return alert(`${city} ${monthKey} 배송명단 데이터가 없습니다.`);
      const dongSet = new Set();
      snap.forEach(d => {
        const dong = d.data()['행정동'] || d.data()['dong'] || '';
        if (dong) dongSet.add(dong.trim());
      });
      if (dongSet.size === 0) return alert('행정동 정보가 없습니다.');
      const dongs = [...dongSet].sort((a, b) => a.localeCompare(b, 'ko-KR'));
      if (rows.length > 0 && !window.confirm(`행정동 ${dongs.length}개를 자동생성합니다. 현재 데이터를 덮어쓸까요?`)) return;
      const generated = dongs.map(dong => makeRow({ dong }));
      setRows(generated);
      await saveSchedule(generated);
    } catch (e) {
      alert('자동생성 실패: ' + e.message);
    }
  };

  // DB에서 기사 배정 정보 가져와 없는 행만 추가 (기존 행 보존)
  const [importing, setImporting] = useState(false);
  const importFromCloudDB = async () => {
    if (!city) return alert('시/도 및 시/군/구를 먼저 선택해주세요.');
    setImporting(true);
    try {
      const recordsRef = collection(db, 'cloud_lists', city, 'months', monthKey, 'records');
      const snap = await getDocs(recordsRef);
      if (snap.empty) { alert(`${city} ${monthKey} 배송명단 데이터가 없습니다.`); return; }

      // 행정동별 기사 집계 (최다 배정 기사 선택)
      const dongDriverCount = {}; // { dong: { driver: count } }
      snap.forEach(d => {
        const data = d.data();
        const dong = (data['행정동'] || '').trim();
        const driver = (data['기사'] || '').trim();
        if (!dong) return;
        if (!dongDriverCount[dong]) dongDriverCount[dong] = {};
        if (driver) dongDriverCount[dong][driver] = (dongDriverCount[dong][driver] || 0) + 1;
      });

      // 동별 최다 기사 추출
      const dbPairs = Object.entries(dongDriverCount)
        .map(([dong, driverCounts]) => {
          const top = Object.entries(driverCounts).sort((a, b) => b[1] - a[1])[0];
          return { dong, driverName: top ? top[0] : '' };
        })
        .sort((a, b) => a.dong.localeCompare(b.dong, 'ko-KR'));

      if (dbPairs.length === 0) { alert('행정동 정보가 없습니다.'); return; }

      // 기존 행에서 빈 기사명 채우기 + 없는 dong 추가
      let updated = [...rows];
      let fillCount = 0;
      let addCount = 0;

      // 1) 기존 행 중 기사명이 비어있으면 DB에서 채우기
      updated = updated.map(row => {
        if (row.driverName) return row;
        const match = dbPairs.find(p => p.dong === row.dong);
        if (!match || !match.driverName) return row;
        const driverInfo = drivers.find(d => d.name === match.driverName);
        fillCount++;
        return {
          ...row,
          driverName: match.driverName,
          phone: row.phone || driverInfo?.phone || '',
          emergencyPhone: row.emergencyPhone || driverInfo?.emergencyPhone || '',
        };
      });

      // 2) 없는 dong만 신규 추가
      const existingDongs = new Set(updated.map(r => r.dong).filter(Boolean));
      const newRows = dbPairs
        .filter(p => !existingDongs.has(p.dong))
        .map(p => {
          const driverInfo = drivers.find(d => d.name === p.driverName);
          addCount++;
          return makeRow({
            dong: p.dong,
            driverName: p.driverName,
            phone: driverInfo?.phone || '',
            emergencyPhone: driverInfo?.emergencyPhone || '',
          });
        });

      updated = [...updated, ...newRows];
      setRows(updated);
      await saveSchedule(updated);
      alert(`DB 업데이트 완료!\n기사명 자동채우기: ${fillCount}건\n신규 행정동 추가: ${addCount}건\n기존 데이터 보존`);
    } catch (e) {
      alert('DB 업데이트 실패: ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  // ─── Export ────────────────────────────────────────────────────────────────
  const buildReportHtml = () => {
    const cityLabel = city || '지자체 미선택';
    const dateLabel = `${year}년 ${month}월`;
    const done = rows.filter(r => r.completed).length;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>${cityLabel} ${dateLabel} 배송일정</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:10pt;padding:16px;background:#fff;color:#000;}
h1{font-size:15pt;font-weight:bold;text-align:center;margin-bottom:4px;}
.sub{text-align:center;font-size:9pt;color:#555;margin-bottom:14px;}
table{width:100%;border-collapse:collapse;font-size:9.5pt;}
th{background:#1e3a5f;color:#fff;padding:5px 4px;text-align:center;border:1px solid #1e3a5f;font-weight:bold;}
td{padding:4px;border:1px solid #ccc;text-align:center;vertical-align:middle;}
tr:nth-child(even) td{background:#f7f9fc;}
.tl{text-align:left;}
.ok{color:#166534;font-weight:bold;}
.ng{color:#991b1b;}
.footer{margin-top:12px;font-size:8.5pt;color:#777;text-align:right;}
@media print{body{padding:8px;}button{display:none;}}
</style></head><body>
<h1>${cityLabel} ${dateLabel} 배송일정 보고서</h1>
<div class="sub">전체 ${rows.length}건 &nbsp;|&nbsp; 완료 ${done}건 &nbsp;|&nbsp; 미완료 ${rows.length - done}건 &nbsp;|&nbsp; ${new Date().toLocaleDateString('ko-KR')}</div>
<table><thead><tr>
<th style="width:28px">번호</th>
<th style="width:72px">배송동명</th>
<th style="width:65px">담당기사</th>
<th style="width:90px">연락처</th>
<th style="width:90px">비상연락처</th>
<th style="width:110px">배송일정</th>
<th style="width:38px">완료</th>
<th>비고</th>
</tr></thead><tbody>
${rows.map((r, i) => `<tr>
<td>${i + 1}</td>
<td class="tl">${r.dong || ''}</td>
<td>${escHtml(r.driverName)}</td>
<td>${escHtml(r.phone)}</td>
<td>${escHtml(r.emergencyPhone)}</td>
<td>${formatDateRanges(r.dates)}</td>
<td class="${r.completed ? 'ok' : 'ng'}">${r.completed ? '완료' : '-'}</td>
<td class="tl">${escHtml(r.note)}</td>
</tr>`).join('')}
</tbody></table>
<div class="footer">출력: ${new Date().toLocaleString('ko-KR')}</div>
</body></html>`;
  };

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=960,height=720');
    if (!w) return alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.');
    w.document.write(buildReportHtml());
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  };

  const handleExportPDF = async () => {
    setSaving(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-9999px;top:0;width:940px;background:#fff;';
      container.innerHTML = buildReportHtml();
      document.body.appendChild(container);
      const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      document.body.removeChild(container);
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = (canvas.height * pdfW) / canvas.width;
      const pageH = pdf.internal.pageSize.getHeight();
      let y = 0;
      while (y < pdfH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, -y, pdfW, pdfH);
        y += pageH;
      }
      pdf.save(`${city || '배송일정'}_${year}년${month}월_보고서.pdf`);
    } catch (e) {
      alert('PDF 내보내기 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleExportExcel = () => {
    const BOM = '﻿';
    const headers = ['번호', '배송동명', '담당기사', '연락처', '비상연락처', '배송일정', '완료여부', '비고'];
    const bodyRows = rows.map((r, i) => [
      i + 1, r.dong || '', r.driverName || '', r.phone || '', r.emergencyPhone || '',
      formatDateRanges(r.dates), r.completed ? '완료' : '미완료', r.note || '',
    ]);
    const tableHtml = `<table><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>${
      bodyRows.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')
    }</table>`;
    const blob = new Blob([BOM + `<html><head><meta charset="UTF-8"></head><body>${tableHtml}</body></html>`], {
      type: 'application/vnd.ms-excel;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${city || '배송일정'}_${year}년${month}월_배송일정.xls`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleReport = () => {
    handleExportExcel();
    handleExportPDF();
  };

  // ─── Driver Management ─────────────────────────────────────────────────────
  const persistPersonalDrivers = async (list) => {
    if (!uid) return;
    setDriverSaving(true);
    try {
      await setDoc(doc(db, 'schedule_drivers', uid), { drivers: list, updatedAt: serverTimestamp() });
      setPersonalDrivers(list);
      setDrivers(prev => [...list.map(d => ({ ...d, _src: 'personal' })), ...prev.filter(d => d._src === 'org')]);
    } catch (e) {
      alert('기사 저장 실패: ' + e.message);
    } finally {
      setDriverSaving(false);
    }
  };

  const submitDriverForm = async () => {
    if (!driverForm.name.trim()) return alert('기사 이름을 입력해주세요.');
    let updated;
    if (editingDriverId) {
      updated = personalDrivers.map(d => d.id === editingDriverId ? { ...d, ...driverForm } : d);
      setEditingDriverId(null);
    } else {
      updated = [...personalDrivers, { id: `drv_${Date.now()}`, ...driverForm }];
    }
    setDriverForm({ name: '', phone: '', emergencyPhone: '' });
    await persistPersonalDrivers(updated);
  };

  const deletePersonalDriver = async (id) => {
    if (!window.confirm('이 기사를 삭제하시겠습니까?')) return;
    await persistPersonalDrivers(personalDrivers.filter(d => d.id !== id));
  };

  const startEditDriver = (d) => {
    setEditingDriverId(d.id);
    setDriverForm({ name: d.name || '', phone: d.phone || '', emergencyPhone: d.emergencyPhone || '' });
  };

  const importBulkDrivers = async () => {
    if (!bulkText.trim()) return;
    const newOnes = bulkText.trim().split('\n')
      .filter(l => l.trim())
      .map(line => {
        const parts = line.split(/[\t,]/).map(p => p.trim());
        return { id: `drv_${Date.now()}_${Math.random().toString(36).slice(2,5)}`, name: parts[0] || '', phone: parts[1] || '', emergencyPhone: parts[2] || '' };
      })
      .filter(d => d.name);
    if (!newOnes.length) return alert('유효한 기사 정보가 없습니다.');
    await persistPersonalDrivers([...personalDrivers, ...newOnes]);
    setBulkText('');
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  const completedCount = rows.filter(r => r.completed).length;

  return (
    <div className="w-full h-full flex flex-col bg-[#050505] overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 px-5 py-3 border-b border-[#1a1a1a] flex items-center gap-3 bg-[#060606]">
        <button onClick={onBack} className="text-gray-600 hover:text-white transition-colors p-1">
          <ChevronLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[#3b82f6]" />
          <h1 className="text-white font-black text-sm">배송일정 관리</h1>
        </div>
        <div className="flex items-center gap-0.5 bg-[#111] border border-[#2a2a2a] rounded-lg p-0.5 ml-2">
          {[{ id: 'schedule', label: '배송일정' }, { id: 'drivers', label: '기사 관리' }].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveSubTab(t.id)}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                activeSubTab === t.id ? 'bg-[#3b82f6] text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {saving && <span className="text-[10px] text-emerald-400 animate-pulse ml-1">저장 중...</span>}
      </div>

      {/* ── Selectors ── */}
      <div className="shrink-0 px-5 py-2.5 border-b border-[#1a1a1a] flex items-center gap-2.5 flex-wrap bg-[#050505]">
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="bg-[#111] border border-[#2a2a2a] text-white text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-[#3b82f6]"
        >
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select
          value={month}
          onChange={e => setMonth(Number(e.target.value))}
          className="bg-[#111] border border-[#2a2a2a] text-white text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-[#3b82f6]"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
        </select>
        <div className="h-4 w-px bg-[#2a2a2a]" />
        <select
          value={sido}
          onChange={e => { setSido(e.target.value); setSigungu(''); }}
          className="bg-[#111] border border-[#2a2a2a] text-white text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-[#3b82f6]"
        >
          <option value="">시/도 선택</option>
          {sidoOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {sigunguOptions.length > 0 && (
          <select
            value={sigungu}
            onChange={e => setSigungu(e.target.value)}
            className="bg-[#111] border border-[#2a2a2a] text-white text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-[#3b82f6]"
          >
            <option value="">시/군/구 선택</option>
            {sigunguOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {city && <span className="text-[10px] font-bold text-blue-400 ml-1">{city}</span>}
      </div>

      {/* ── Schedule Sub-tab ── */}
      {activeSubTab === 'schedule' ? (
        <>
          {/* Toolbar */}
          <div className="shrink-0 px-5 py-2 border-b border-[#111] flex items-center gap-2 flex-wrap bg-[#060606]">
            <button
              onClick={copyPreviousMonth}
              className="px-3 py-1.5 bg-indigo-950/60 hover:bg-indigo-900/60 border border-indigo-700/40 text-indigo-300 text-[11px] font-bold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Copy size={11} /> 전월 가져오기
            </button>
            <button
              onClick={sortByDong}
              className="px-3 py-1.5 bg-amber-950/60 hover:bg-amber-900/60 border border-amber-700/40 text-amber-300 text-[11px] font-bold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <SortAsc size={11} /> 행정동 정렬
            </button>
            <button
              onClick={importFromCloudDB}
              disabled={!city || importing}
              className="px-3 py-1.5 bg-teal-950/60 hover:bg-teal-900/60 border border-teal-700/40 text-teal-300 text-[11px] font-bold rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-40"
              title={city ? `${city} ${monthKey} 배송명단에서 행정동·기사 정보를 가져와 없는 행만 추가합니다` : '시/도·시/군/구를 먼저 선택해주세요'}
            >
              {importing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              DB 업데이트
            </button>
            {isAdmin && (
              <button
                onClick={autoGenerateDongs}
                className="px-3 py-1.5 bg-[#3b82f6]/10 hover:bg-[#3b82f6]/20 border border-[#3b82f6]/30 text-[#3b82f6] text-[11px] font-bold rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Wand2 size={11} /> 행정동 자동생성
              </button>
            )}
            <button
              onClick={addRow}
              className="px-3 py-1.5 bg-[#111] hover:bg-[#1a1a1a] border border-[#2a2a2a] text-white text-[11px] font-bold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Plus size={11} /> 행 추가
            </button>
            <div className="flex-1" />
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 bg-gray-900/60 hover:bg-gray-800/60 border border-gray-700/40 text-gray-300 text-[11px] font-bold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Printer size={11} /> 인쇄
            </button>
            <button
              onClick={handleExportExcel}
              className="px-3 py-1.5 bg-green-950/60 hover:bg-green-900/60 border border-green-700/40 text-green-300 text-[11px] font-bold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <FileSpreadsheet size={11} /> 엑셀
            </button>
            <button
              onClick={handleReport}
              className="px-3 py-1.5 bg-purple-950/60 hover:bg-purple-900/60 border border-purple-700/40 text-purple-300 text-[11px] font-bold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <FileText size={11} /> 보고하기
            </button>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
                <span className="animate-pulse">불러오는 중...</span>
              </div>
            ) : (
              <table className="w-full border-collapse min-w-[760px]">
                <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
                  <tr className="border-b border-[#222]">
                    <th className="w-10 px-2 py-2.5 text-[10px] text-gray-600 font-bold text-center border-r border-[#1a1a1a]">번호</th>
                    <th className="w-24 px-2 py-2.5 text-[10px] text-gray-500 font-bold text-left border-r border-[#1a1a1a]">배송동명</th>
                    <th className="w-28 px-2 py-2.5 text-[10px] text-gray-500 font-bold text-left border-r border-[#1a1a1a]">담당기사</th>
                    <th className="w-28 px-2 py-2.5 text-[10px] text-gray-500 font-bold text-left border-r border-[#1a1a1a]">연락처</th>
                    <th className="w-28 px-2 py-2.5 text-[10px] text-gray-500 font-bold text-left border-r border-[#1a1a1a]">비상연락처</th>
                    <th className="w-36 px-2 py-2.5 text-[10px] text-gray-500 font-bold text-left border-r border-[#1a1a1a]">배송일정</th>
                    <th className="w-16 px-2 py-2.5 text-[10px] text-gray-500 font-bold text-center border-r border-[#1a1a1a]">완료</th>
                    <th className="px-2 py-2.5 text-[10px] text-gray-500 font-bold text-left border-r border-[#1a1a1a]">비고</th>
                    <th className="w-10 px-2 py-2.5 text-[10px] text-gray-600 font-bold text-center">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-20 text-center">
                        <div className="flex flex-col items-center gap-3 text-gray-700">
                          <Calendar size={36} className="opacity-30" />
                          <span className="text-sm">데이터가 없습니다</span>
                          <span className="text-xs opacity-60">행 추가 버튼을 누르거나 전월 가져오기로 시작하세요</span>
                        </div>
                      </td>
                    </tr>
                  ) : rows.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={`border-b border-[#111] transition-colors ${
                        row.completed ? 'bg-green-950/10' : 'hover:bg-[#0d0d0d]'
                      }`}
                    >
                      <td className="px-2 py-1 text-center text-[10px] text-gray-600 border-r border-[#111]">
                        {idx + 1}
                      </td>
                      <td className="p-0 border-r border-[#111]">
                        <input
                          value={row.dong}
                          onChange={e => updateRowText(row.id, 'dong', e.target.value)}
                          className="w-full bg-transparent text-white text-xs px-2 py-1.5 outline-none placeholder-gray-700"
                          placeholder="동명"
                        />
                      </td>
                      <td className="p-0 border-r border-[#111]">
                        <DriverAutocomplete
                          value={row.driverName}
                          onChange={(name, obj) => handleDriverSelect(row.id, name, obj)}
                          drivers={drivers}
                        />
                      </td>
                      <td className="p-0 border-r border-[#111]">
                        <input
                          value={row.phone}
                          onChange={e => updateRowText(row.id, 'phone', e.target.value)}
                          className="w-full bg-transparent text-white text-xs px-2 py-1.5 outline-none placeholder-gray-700"
                          placeholder="연락처"
                        />
                      </td>
                      <td className="p-0 border-r border-[#111]">
                        <input
                          value={row.emergencyPhone}
                          onChange={e => updateRowText(row.id, 'emergencyPhone', e.target.value)}
                          className="w-full bg-transparent text-white text-xs px-2 py-1.5 outline-none placeholder-gray-700"
                          placeholder="비상연락처"
                        />
                      </td>
                      <td className="p-0 border-r border-[#111]">
                        <DeliveryDatePicker
                          value={row.dates || []}
                          onChange={dates => updateRowImmediate(row.id, { dates })}
                          year={year}
                          month={month}
                        />
                      </td>
                      <td className="px-2 py-1 text-center border-r border-[#111]">
                        <button
                          onClick={() => updateRowImmediate(row.id, { completed: !row.completed })}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center mx-auto transition-all ${
                            row.completed
                              ? 'bg-green-500 border-green-400 text-white shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                              : 'border-[#333] text-transparent hover:border-green-600'
                          }`}
                          title={row.completed ? '완료 취소' : '완료 표시'}
                        >
                          <Check size={11} />
                        </button>
                      </td>
                      <td className="p-0 border-r border-[#111]">
                        <input
                          value={row.note}
                          onChange={e => updateRowText(row.id, 'note', e.target.value)}
                          className="w-full bg-transparent text-gray-400 text-xs px-2 py-1.5 outline-none placeholder-gray-700"
                          placeholder="비고"
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          onClick={() => deleteRow(row.id)}
                          className="w-6 h-6 flex items-center justify-center mx-auto text-gray-700 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer stats */}
          {rows.length > 0 && (
            <div className="shrink-0 px-5 py-2 border-t border-[#111] flex items-center gap-5 text-[10px] bg-[#060606]">
              <span className="text-gray-600">전체 <span className="text-white font-bold">{rows.length}</span></span>
              <span className="text-gray-600">완료 <span className="text-green-400 font-bold">{completedCount}</span></span>
              <span className="text-gray-600">미완료 <span className="text-red-400 font-bold">{rows.length - completedCount}</span></span>
              {rows.length > 0 && (
                <div className="flex-1 h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all"
                    style={{ width: `${Math.round((completedCount / rows.length) * 100)}%` }}
                  />
                </div>
              )}
              <span className="text-gray-600">{Math.round((completedCount / Math.max(rows.length, 1)) * 100)}%</span>
            </div>
          )}
        </>
      ) : (
        /* ── Driver Management Sub-tab ── */
        <div className="flex-1 overflow-auto py-6 px-5">
          <div className="max-w-xl mx-auto space-y-5">
            {/* Add/Edit Form */}
            <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl p-4">
              <h3 className="text-white font-bold text-sm mb-3">
                {editingDriverId ? '기사 수정' : '기사 추가'}
              </h3>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { key: 'name', label: '이름 *', placeholder: '홍길동' },
                  { key: 'phone', label: '연락처', placeholder: '010-0000-0000' },
                  { key: 'emergencyPhone', label: '비상연락처', placeholder: '비상연락처' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-[10px] text-gray-500 mb-1 block">{f.label}</label>
                    <input
                      value={driverForm[f.key]}
                      onChange={e => setDriverForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && submitDriverForm()}
                      placeholder={f.placeholder}
                      className="w-full bg-[#111] border border-[#333] text-white text-xs rounded-lg px-3 py-2 outline-none focus:border-[#3b82f6] transition-colors"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={submitDriverForm}
                  disabled={driverSaving}
                  className="px-4 py-1.5 bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  {editingDriverId ? '수정 완료' : '추가'}
                </button>
                {editingDriverId && (
                  <button
                    onClick={() => { setEditingDriverId(null); setDriverForm({ name: '', phone: '', emergencyPhone: '' }); }}
                    className="px-4 py-1.5 bg-[#1a1a1a] hover:bg-[#222] border border-[#333] text-gray-400 text-xs font-bold rounded-lg transition-colors"
                  >
                    취소
                  </button>
                )}
              </div>
            </div>

            {/* Bulk Import */}
            <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl p-4">
              <h3 className="text-white font-bold text-sm mb-1">일괄 입력</h3>
              <p className="text-[10px] text-gray-500 mb-2">한 줄에 한 명: 이름, 연락처, 비상연락처 (탭 또는 쉼표 구분)</p>
              <textarea
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                rows={4}
                className="w-full bg-[#111] border border-[#333] text-white text-xs rounded-lg px-3 py-2 outline-none focus:border-[#3b82f6] resize-none font-mono transition-colors"
                placeholder={'홍길동\t010-1234-5678\t010-9999-8888\n김철수\t010-2222-3333'}
              />
              <button
                onClick={importBulkDrivers}
                disabled={!bulkText.trim() || driverSaving}
                className="mt-2 px-4 py-1.5 bg-[#0d1f35] hover:bg-[#1a2f45] border border-[#3b82f6]/30 text-[#3b82f6] text-xs font-bold rounded-lg transition-colors disabled:opacity-40"
              >
                일괄 등록
              </button>
            </div>

            {/* Personal Driver List */}
            <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
                <h3 className="text-white font-bold text-sm">
                  내 기사 목록
                  <span className="text-gray-600 font-normal text-xs ml-2">({personalDrivers.length}명)</span>
                </h3>
              </div>
              {personalDrivers.length === 0 ? (
                <div className="py-10 text-center text-gray-700 text-xs">등록된 기사가 없습니다</div>
              ) : (
                <div className="divide-y divide-[#111]">
                  {personalDrivers.map(d => (
                    <div key={d.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-[#111] transition-colors">
                      <div className="w-8 h-8 rounded-full bg-[#1a2333] border border-[#3b82f6]/20 flex items-center justify-center text-[#3b82f6] text-xs font-black shrink-0">
                        {(d.name || '?')[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-xs font-bold">{d.name}</div>
                        <div className="text-gray-600 text-[10px] flex items-center gap-2 mt-0.5">
                          {d.phone && <span>{d.phone}</span>}
                          {d.emergencyPhone && <span>비상: {d.emergencyPhone}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startEditDriver(d)}
                          className="px-2 py-1 text-[10px] text-gray-500 hover:text-white border border-[#2a2a2a] hover:border-[#444] rounded transition-colors"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => deletePersonalDriver(d.id)}
                          className="px-2 py-1 text-[10px] text-gray-600 hover:text-red-400 border border-[#2a2a2a] hover:border-red-800/50 rounded transition-colors"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Org Drivers (read-only) */}
            {drivers.filter(d => d._src === 'org').length > 0 && (
              <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1a1a1a]">
                  <h3 className="text-white font-bold text-sm">
                    소속사 기사
                    <span className="text-gray-600 font-normal text-xs ml-2">
                      ({drivers.filter(d => d._src === 'org').length}명 · 읽기 전용)
                    </span>
                  </h3>
                </div>
                <div className="divide-y divide-[#111]">
                  {drivers.filter(d => d._src === 'org').map(d => (
                    <div key={d.id} className="px-4 py-2.5 flex items-center gap-3 opacity-70">
                      <div className="w-8 h-8 rounded-full bg-[#1a2a1a] border border-emerald-800/30 flex items-center justify-center text-emerald-500 text-xs font-black shrink-0">
                        {(d.name || '?')[0]}
                      </div>
                      <div className="flex-1">
                        <div className="text-white text-xs font-bold">{d.name || '이름 없음'}</div>
                        {d.phone && <div className="text-gray-600 text-[10px] mt-0.5">{d.phone}</div>}
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 bg-emerald-950/50 text-emerald-500 border border-emerald-800/30 rounded">소속사</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
