import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as XLSX from 'xlsx';
import {
  db, storage,
  collection, getDocs, getDoc, setDoc, doc, deleteDoc, writeBatch, serverTimestamp,
  ref, uploadBytes, getDownloadURL, deleteObject,
} from '../config/firebase.js';
import {
  Cloud, Upload, Trash2, ArrowLeft, Download, Calendar, FileSpreadsheet,
  AlertCircle, ChevronRight, Search, Save, RotateCcw, X, CheckCircle, MapPin,
  Building2, DatabaseZap, Ghost,
} from 'lucide-react';
import OrgPresetModal from './OrgPresetModal.jsx';
import { REGIONS, getSigunguOptions } from '../utils/regions.js';

const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY;

const fmtTs = (ts) => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const CLOUD_FIELDS = [
  { key: '구분',     label: '구분',     minW: '90px',  type: 'select', opts: ['기초수급자', '차상위'] },
  { key: '이름',     label: '이름',     minW: '80px',  type: 'text' },
  { key: '생년월일', label: '생년월일', minW: '85px',  type: 'text' },
  { key: '행정동',   label: '행정동',   minW: '75px',  type: 'text' },
  { key: '주소',     label: '주소',     minW: '210px', type: 'text' },
  { key: '휴대폰',   label: '휴대폰',   minW: '110px', type: 'text' },
  { key: '유선전화', label: '유선전화', minW: '110px', type: 'text' },
  { key: '포수',     label: '포수',     minW: '50px',  type: 'number' },
  { key: '특이사항', label: '특이사항', minW: '140px', type: 'text' },
  { key: '기사',     label: '기사',     minW: '70px',  type: 'text' },
  { key: '배송순번', label: '순번',     minW: '50px',  type: 'text' },
];

const ROW_HEIGHT = 36; // px — 고정 행 높이

// 셀 편집 입력 — 자체 상태 관리로 부모 리렌더 완전 차단
const CellInput = memo(function CellInput({ type, opts, initial, onCommit, onCancel }) {
  const [val, setVal] = useState(String(initial ?? ''));
  if (type === 'select') {
    return (
      <select autoFocus value={val}
        onChange={e => { setVal(e.target.value); onCommit(e.target.value); }}
        onBlur={() => onCommit(val)}
        className="w-full bg-[#111] border border-blue-500 rounded text-xs text-white outline-none px-1 py-0.5"
      >
        {(opts || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input autoFocus type={type === 'number' ? 'number' : 'text'}
      className="w-full bg-transparent text-white text-xs outline-none border-b border-blue-400 py-0.5"
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => onCommit(val)}
      onKeyDown={e => { if (e.key === 'Enter') onCommit(val); if (e.key === 'Escape') onCancel(); }}
    />
  );
});

const VirtualTable = memo(function VirtualTable({ displayRecords, dirtyRecords, deletedRecordIds, loadingRecords, records, renderCell, setDeletedRecordIds }) {
  const scrollRef = useRef(null);

  const virtualizer = useVirtualizer({
    count: displayRecords.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const vItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = vItems.length > 0 ? vItems[0].start : 0;
  const paddingBottom = vItems.length > 0 ? totalSize - vItems[vItems.length - 1].end : 0;

  if (loadingRecords) return (
    <div className="flex-1 flex items-center justify-center gap-2 text-blue-400 text-sm animate-pulse">
      <Cloud size={18} /> 데이터 불러오는 중...
    </div>
  );
  if (records.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-700">
      <FileSpreadsheet size={40} className="opacity-20" />
      <p className="text-sm">레코드가 없습니다.</p>
    </div>
  );
  if (displayRecords.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-700">
      <Search size={36} className="opacity-20" />
      <p className="text-sm">검색 결과가 없습니다</p>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <table className="w-full border-collapse" style={{ minWidth: '960px' }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#0c0c0c] border-b border-[#1e1e1e]">
              <th className="px-3 py-2.5 text-left text-[10px] text-gray-700 font-bold uppercase tracking-wider w-9">#</th>
              {CLOUD_FIELDS.map(f => (
                <th key={f.key} style={{ minWidth: f.minW }} className={`px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider ${f.key === '기사' || f.key === '배송순번' ? 'text-[#22c55e]/60' : 'text-gray-600'}`}>
                  {f.label}
                </th>
              ))}
              <th className="px-3 py-2.5 text-[10px] text-blue-600/60 font-bold w-12">좌표</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && <tr><td style={{ height: paddingTop }} colSpan={CLOUD_FIELDS.length + 3} /></tr>}
            {vItems.map(vRow => {
              const r = displayRecords[vRow.index];
              const isDirtyRow = !!dirtyRecords[r.id];
              return (
                <tr
                  key={r.id}
                  style={{ height: ROW_HEIGHT }}
                  className={`border-b border-[#111] group ${isDirtyRow ? 'bg-blue-950/10 hover:bg-blue-950/15' : 'hover:bg-white/[0.025]'}`}
                >
                  <td className="px-3 py-2 shrink-0">
                    <span className="flex items-center gap-1 text-[10px] text-gray-700">
                      {isDirtyRow && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block shrink-0" />}
                      {vRow.index + 1}
                    </span>
                  </td>
                  {CLOUD_FIELDS.map(f => (
                    <td key={f.key} style={{ minWidth: f.minW }} className="px-3 py-2 max-w-0">
                      {renderCell(r, f)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center">
                    {r.lat ? <span className="text-[#22c55e] text-[10px]">✓</span> : <span className="text-gray-700 text-[10px]">✗</span>}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => setDeletedRecordIds(prev => new Set([...prev, r.id]))}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-700 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-all"
                      title="삭제 예정 표시"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {paddingBottom > 0 && <tr><td style={{ height: paddingBottom }} colSpan={CLOUD_FIELDS.length + 3} /></tr>}
          </tbody>
        </table>
      </div>
      {deletedRecordIds.size > 0 && (
        <div className="shrink-0 bg-red-950/90 backdrop-blur border-t border-red-500/30 px-4 py-2 flex items-center gap-2 text-xs text-red-300">
          <Trash2 size={12} />
          <span>{deletedRecordIds.size}건 삭제 예정 — "변경사항 저장"으로 확정하거나 "되돌리기"로 취소</span>
        </div>
      )}
    </div>
  );
});  // end VirtualTable (memo)

export default function CloudListManager({ user, onBack, initialCity = '', onOpenRouteMap }) {
  const isAdmin = user?.role === 'admin';
  const approvedCities = user?.citiesApproved || [];

  // City selection — initialCity에서 시도/시군구 파싱
  const initParts = initialCity.trim().split(/\s+/);
  const [selectedSido, setSelectedSido] = useState(initParts[0] || '');
  const [selectedSigungu, setSelectedSigungu] = useState(initParts.slice(1).join(' ') || '');
  const selectedCity = selectedSido && selectedSigungu ? `${selectedSido} ${selectedSigungu}` : '';

  // Month list
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [loadingMonths, setLoadingMonths] = useState(false);

  // Records
  const [records, setRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  // Inline edit state
  const [dirtyRecords, setDirtyRecords] = useState({});  // { [id]: { field: val } }
  const [deletedRecordIds, setDeletedRecordIds] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null);  // { id, field }
  const [saving, setSaving] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  // UI — 검색은 150ms 디바운스로 displayRecords 재계산 최소화
  const [searchInput, setSearchInput] = useState('');
  const [searchText, setSearchText] = useState('');
  const searchDebounceRef = useRef(null);
  const handleSearchChange = useCallback((val) => {
    setSearchInput(val);
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearchText(val), 150);
  }, []);
  const [deleteMonthConfirm, setDeleteMonthConfirm] = useState(null);
  const [showOrgPreset, setShowOrgPreset] = useState(false);

  // City options
  const availableSidos = isAdmin
    ? Object.keys(REGIONS)
    : [...new Set(approvedCities.map(c => c.split(' ')[0]).filter(Boolean))];

  const availableSigungus = isAdmin
    ? getSigunguOptions(selectedSido)
    : approvedCities.filter(c => c.startsWith(selectedSido + ' ')).map(c => c.slice(selectedSido.length + 1));

  // ── 조직 필터 — 비관리자가 orgAssignment 있을 때 해당 dongs만 접근 ──
  const [orgDongs, setOrgDongs] = useState(null); // null=제한없음, Set=허용 동 목록

  useEffect(() => {
    if (isAdmin || !selectedCity) { setOrgDongs(null); return; }
    const userOrgId = user?.orgId; // 유저에 1개 배정된 글로벌 조직명
    if (!userOrgId) { setOrgDongs(null); return; }

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'org_presets', selectedCity));
        if (!snap.exists()) { setOrgDongs(null); return; }
        // 이름 일치 우선, id 일치 폴백 (이전 데이터 호환)
        const org = (snap.data().orgs || []).find(o => o.name === userOrgId || o.id === userOrgId);
        setOrgDongs(org ? new Set(org.dongs || []) : null);
      } catch { setOrgDongs(null); }
    })();
  }, [selectedCity, user?.orgId, isAdmin]);

  // ── Derived display records — dirty 병합 제거(renderCell에서 직접 읽음)
  const displayRecords = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return records
      .filter(r => {
        if (deletedRecordIds.has(r.id)) return false;
        if (orgDongs && !orgDongs.has((r.행정동 || '').trim())) return false;
        if (!q) return true;
        const dirty = dirtyRecords[r.id] || {};
        return [
          dirty.이름 ?? r.이름, dirty.행정동 ?? r.행정동,
          dirty.주소 ?? r.주소, dirty.휴대폰 ?? r.휴대폰, dirty.특이사항 ?? r.특이사항,
        ].some(v => String(v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => (a._idx || 0) - (b._idx || 0));
  }, [records, deletedRecordIds, searchText, orgDongs, dirtyRecords]);

  const hasRecordChanges = Object.keys(dirtyRecords).length > 0 || deletedRecordIds.size > 0;

  // ── Auto-select first approved city for VIP (initialCity 없을 때만) ──
  useEffect(() => {
    if (initialCity) return; // DB Overview에서 도시 지정한 경우 스킵
    if (!isAdmin && approvedCities.length > 0 && !selectedSido) {
      const first = approvedCities[0];
      const idx = first.indexOf(' ');
      if (idx > 0) { setSelectedSido(first.slice(0, idx)); setSelectedSigungu(first.slice(idx + 1)); }
    }
  }, []);

  // ── Effects ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCity) { setMonths([]); setSelectedMonth(null); setRecords([]); return; }
    fetchMonths();
  }, [selectedCity]);

  useEffect(() => {
    setDirtyRecords({});
    setDeletedRecordIds(new Set());
    setEditingCell(null);
    setSearchText('');
    setSearchInput('');
  }, [selectedMonth?.id]);

  // ── Data fetching ─────────────────────────────────────────────────
  const fetchMonths = async () => {
    setLoadingMonths(true);
    setSelectedMonth(null);
    setRecords([]);
    try {
      const snap = await getDocs(collection(db, 'cloud_lists', selectedCity, 'months'));
      const data = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.id.localeCompare(a.id));
      setMonths(data);
    } catch (e) { console.error('[CloudListManager] fetchMonths:', e); }
    finally { setLoadingMonths(false); }
  };

  const fetchRecords = async (monthId) => {
    setLoadingRecords(true);
    try {
      const snap = await getDocs(collection(db, 'cloud_lists', selectedCity, 'months', monthId, 'records'));
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error('[CloudListManager] fetchRecords:', e); }
    finally { setLoadingRecords(false); }
  };

  const handleSelectMonth = (month) => {
    setSelectedMonth(month);
    fetchRecords(month.id);
  };

  // ── Upload ────────────────────────────────────────────────────────
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCity) return;
    e.target.value = '';

    const monthStr = window.prompt('업로드할 년월을 입력하세요 (예: 2024-03)', new Date().toISOString().slice(0, 7));
    if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) { alert('올바른 형식이 아닙니다 (예: 2024-03)'); return; }

    setUploading(true);
    setUploadStatus('파일 분석 중...');
    try {
      const buffer = await file.arrayBuffer();
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); };
        worker.onerror = err => { worker.terminate(); reject(err); };
        worker.postMessage({ buffer, fileName: file.name });
      });
      if (!result.ok) throw new Error(result.error || '파싱 실패');

      const validSheets = (result.sheetsData || []).filter(s => s.type !== '제외');
      if (!validSheets.length) throw new Error('유효한 시트가 없습니다.');

      setUploadStatus('데이터 추출 중...');
      const newRecords = [];
      validSheets.forEach(sheet => {
        const h = sheet.headers || [];
        sheet.bodyRows.forEach(row => {
          const g = (...keys) => { for (const k of keys) { const i = h.indexOf(k); if (i >= 0 && row[i] != null) return String(row[i]).trim(); } return ''; };
          const name = g('성명', '이름', '대상자명', '수령자명');
          if (!name) return;
          newRecords.push({
            구분: sheet.type || '전체', 이름: name,
            생년월일: g('생년월일', '주민번호'),
            행정동: g('행정동', '읍면동'),
            주소: g('주소', '거주지', '배송지'),
            휴대폰: g('휴대폰', '연락처', '휴대전화'),
            유선전화: g('유선전화', '전화번호', '유선'),
            포수: parseInt(g('포수', '수량', '지원량') || '1') || 1,
            특이사항: g('특이사항', '비고'),
          });
        });
      });
      if (!newRecords.length) throw new Error('추출된 데이터가 없습니다.');

      // 조직 필터 — 비관리자이고 orgDongs 있으면 내 행정동 레코드만 저장
      let filteredRecords = newRecords;
      if (!isAdmin && orgDongs) {
        const outside = newRecords.filter(r => !orgDongs.has((r.행정동 || '').trim()));
        filteredRecords = newRecords.filter(r => orgDongs.has((r.행정동 || '').trim()));
        if (filteredRecords.length === 0) throw new Error('업로드한 파일에 귀 조직 담당 행정동 데이터가 없습니다.');
        if (outside.length > 0 && !window.confirm(
          `담당 행정동 외 ${outside.length}건은 제외됩니다.\n귀 조직 담당: ${filteredRecords.length}건만 저장합니다.\n계속하시겠습니까?`
        )) return;
      }
      const recordsToSave = isAdmin ? newRecords : filteredRecords;

      const 수급자Count = recordsToSave.filter(r => r.구분 === '기초수급자').length;
      const 차상위Count = newRecords.filter(r => r.구분 === '차상위').length;

      // ── 같은 달 기존 레코드 먼저 삭제 (중복 방지) ──────────────────
      const existingMonth = months.find(m => m.id === monthStr);
      if (existingMonth) {
        setUploadStatus('기존 데이터 초기화 중...');
        const oldSnap = await getDocs(collection(db, 'cloud_lists', selectedCity, 'months', monthStr, 'records'));
        for (let i = 0; i < oldSnap.docs.length; i += 499) {
          const batch = writeBatch(db);
          oldSnap.docs.slice(i, i + 499).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }

      setUploadStatus(`Firestore 저장 중... (${recordsToSave.length}건)`);
      const metaRef = doc(db, 'cloud_lists', selectedCity, 'months', monthStr);
      await setDoc(metaRef, {
        city: selectedCity, monthId: monthStr,
        totalCount: recordsToSave.length, 수급자Count, 차상위Count,
        uploadedAt: serverTimestamp(), uploadedBy: user.email, hasOriginal: false,
      });
      for (let i = 0; i < recordsToSave.length; i += 500) {
        const batch = writeBatch(db);
        recordsToSave.slice(i, i + 500).forEach((r, j) => {
          batch.set(doc(collection(db, 'cloud_lists', selectedCity, 'months', monthStr, 'records')), { ...r, _idx: i + j });
        });
        await batch.commit();
        setUploadStatus(`Firestore 저장 중... (${Math.min(i + 500, recordsToSave.length)}/${recordsToSave.length}건)`);
      }

      setUploadStatus('원본 파일 보관 중...');
      try {
        const storageRef = ref(storage, `cloud_uploads/${selectedCity}/${monthStr}/original.xlsx`);
        await uploadBytes(storageRef, file);
        await setDoc(metaRef, { hasOriginal: true }, { merge: true });
      } catch { /* Storage 미활성화 시 무시 */ }

      // ── 이전 달 자동 정리 ──────────────────────────────────────────
      const otherMonths = months.filter(m => m.id !== monthStr);
      if (otherMonths.length > 0) {
        setUploadStatus(`이전 달 정리 중... (${otherMonths.length}개월)`);
        for (const oldMonth of otherMonths) {
          const rSnap = await getDocs(collection(db, 'cloud_lists', selectedCity, 'months', oldMonth.id, 'records'));
          for (let i = 0; i < rSnap.docs.length; i += 499) {
            const batch = writeBatch(db);
            rSnap.docs.slice(i, i + 499).forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
          await deleteDoc(doc(db, 'cloud_lists', selectedCity, 'months', oldMonth.id));
          try { await deleteObject(ref(storage, `cloud_uploads/${selectedCity}/${oldMonth.id}/original.xlsx`)); } catch { /* 없으면 무시 */ }
        }
      }

      setUploadStatus('완료!');
      const cleanupMsg = otherMonths.length > 0 ? `\n이전 달 ${otherMonths.length}개월 데이터 자동 삭제됨` : '';
      alert(`${monthStr} 배송명단 업로드 완료!\n전체 ${recordsToSave.length}건 (기초 ${수급자Count}, 차상위 ${차상위Count})${cleanupMsg}`);
      fetchMonths();
      setSelectedMonth(null);
      setRecords([]);
    } catch (err) {
      console.error('[CloudListManager] handleUpload:', err);
      alert('업로드 오류: ' + err.message);
    } finally { setUploading(false); setUploadStatus(''); }
  };

  // ── Delete month ──────────────────────────────────────────────────
  const handleDeleteMonth = async (month) => {
    setDeleteMonthConfirm(null);
    try {
      const rSnap = await getDocs(collection(db, 'cloud_lists', selectedCity, 'months', month.id, 'records'));
      for (let i = 0; i < rSnap.docs.length; i += 500) {
        const batch = writeBatch(db);
        rSnap.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, 'cloud_lists', selectedCity, 'months', month.id));
      try { await deleteObject(ref(storage, `cloud_uploads/${selectedCity}/${month.id}/original.xlsx`)); } catch { /* 없어도 무시 */ }
      if (selectedMonth?.id === month.id) { setSelectedMonth(null); setRecords([]); }
      fetchMonths();
      alert(`${month.id} 명단이 삭제되었습니다.`);
    } catch (e) { alert('삭제 오류: ' + e.message); }
  };

  // ── Download original ─────────────────────────────────────────────
  const handleDownloadOriginal = async (month) => {
    try {
      const url = await getDownloadURL(ref(storage, `cloud_uploads/${selectedCity}/${month.id}/original.xlsx`));
      const a = document.createElement('a');
      a.href = url; a.download = `${selectedCity}_${month.id}_원본.xlsx`; a.target = '_blank'; a.click();
    } catch { alert('원본 파일이 없거나 다운로드에 실패했습니다.'); }
  };

  // ── Inline editing — editValue 부모 상태 제거, CellInput이 자체 관리 ──
  const startEdit = useCallback((id, field) => {
    setEditingCell({ id, field });
  }, []);

  const cancelEdit = useCallback(() => setEditingCell(null), []);

  const commitEdit = useCallback((id, field, newVal) => {
    const origVal = records.find(r => r.id === id)?.[field] ?? '';
    setDirtyRecords(prev => {
      const prevEntry = prev[id] || {};
      if (String(newVal) === String(origVal) && prevEntry[field] === undefined) return prev;
      if (String(newVal) === String(origVal)) {
        const newEntry = { ...prevEntry };
        delete newEntry[field];
        const newMap = { ...prev };
        if (!Object.keys(newEntry).length) delete newMap[id]; else newMap[id] = newEntry;
        return newMap;
      }
      return { ...prev, [id]: { ...prevEntry, [field]: field === '포수' ? Number(newVal) : newVal } };
    });
    setEditingCell(null);
  }, [records]);

  const renderCell = useCallback((r, fieldDef) => {
    const { key, type, opts } = fieldDef;
    const id = r.id;
    const isEditing = editingCell?.id === id && editingCell?.field === key;
    const isDirty = dirtyRecords[id]?.[key] !== undefined;
    const val = dirtyRecords[id]?.[key] ?? r[key] ?? '';

    if (isEditing) {
      return (
        <CellInput
          type={type}
          opts={opts}
          initial={val}
          onCommit={(v) => commitEdit(id, key, v)}
          onCancel={cancelEdit}
        />
      );
    }

    if (key === '구분') {
      return (
        <span
          onClick={() => startEdit(id, key)}
          className={`cursor-pointer inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${
            val === '기초수급자' ? 'bg-amber-900/40 text-amber-400' :
            val === '차상위'    ? 'bg-blue-900/40 text-blue-400'  :
                                  'bg-gray-800 text-gray-400'
          } ${isDirty ? 'ring-1 ring-blue-500' : ''}`}
        >
          {val || '—'}
        </span>
      );
    }

    if (key === '포수') {
      return (
        <span
          onClick={() => startEdit(id, key)}
          className={`cursor-text block text-center text-xs font-bold ${isDirty ? 'text-blue-300' : 'text-green-400'}`}
        >
          {val || '—'}
        </span>
      );
    }

    return (
      <span
        title={String(val)}
        onClick={() => startEdit(id, key)}
        className={`cursor-text block truncate text-xs ${isDirty ? 'text-blue-300 font-semibold' : 'text-gray-300'} ${!val ? 'text-gray-700' : ''}`}
      >
        {val || '—'}
      </span>
    );
  }, [editingCell, dirtyRecords, commitEdit, cancelEdit, startEdit]);

  // ── Save edits ────────────────────────────────────────────────────
  const handleSaveEdits = async () => {
    if (!hasRecordChanges || saving) return;
    const modCount = Object.keys(dirtyRecords).length;
    const delCount = deletedRecordIds.size;
    if (!confirm(`변경사항을 저장하시겠습니까?\n수정: ${modCount}건 / 삭제: ${delCount}건`)) return;
    setSaving(true);
    try {
      const allOps = [
        ...Object.entries(dirtyRecords).map(([id, changes]) => ({ type: 'update', id, changes })),
        ...[...deletedRecordIds].map(id => ({ type: 'delete', id })),
      ];
      for (let i = 0; i < allOps.length; i += 499) {
        const batch = writeBatch(db);
        allOps.slice(i, i + 499).forEach(op => {
          const r = doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id, 'records', op.id);
          if (op.type === 'update') batch.update(r, op.changes); else batch.delete(r);
        });
        await batch.commit();
      }
      // Update month meta counts
      const remaining = records
        .filter(r => !deletedRecordIds.has(r.id))
        .map(r => ({ ...r, ...dirtyRecords[r.id] }));
      const totalCount = remaining.length;
      const 수급자Count = remaining.filter(r => r.구분 === '기초수급자').length;
      const 차상위Count = remaining.filter(r => r.구분 === '차상위').length;
      await setDoc(doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id), { totalCount, 수급자Count, 차상위Count }, { merge: true });
      setDirtyRecords({});
      setDeletedRecordIds(new Set());
      await fetchRecords(selectedMonth.id);
      await fetchMonths();
      alert(`저장 완료! (수정 ${modCount}건, 삭제 ${delCount}건)`);
    } catch (e) { alert('저장 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  // ── 좌표 받아오기 (Kakao 지오코딩, 3단계 폴백) ───────────────────────
  const [isFetchingCoords, setIsFetchingCoords] = useState(false);
  const [coordProgress, setCoordProgress] = useState(null);

  const handleFetchCoords = async () => {
    if (!selectedCity || !selectedMonth) return;
    const targets = records.filter(r => r.주소 && !r.lat && !r.lng);
    if (!targets.length) { alert('좌표가 없는 주소 데이터가 없습니다.'); return; }
    if (!window.confirm(`주소는 있지만 좌표가 없는 ${targets.length}건을 카카오 API로 조회합니다.\n계속하시겠습니까?`)) return;

    setIsFetchingCoords(true);
    setCoordProgress({ done: 0, total: targets.length, step1: 0, step2: 0 });
    let successCount = 0;
    const updates = {};

    // 도로명만 추출: "서울 동대문구 천호대로 26, 101호 (신설동, 빌딩명)" → "서울 동대문구 천호대로 26"
    const cleanRoad = (addr) => addr.replace(/\s*\([^)]*\).*$/, '').replace(/,.*$/, '').trim();

    // Kakao API 호출 (429 시 1회 재시도)
    const kakaoFetch = async (url) => {
      const go = async () => {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 6000);
        try {
          const res = await fetch(url, {
            headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` },
            signal: ctrl.signal,
          });
          clearTimeout(tid);
          return res;
        } catch { clearTimeout(tid); return null; }
      };
      let res = await go();
      if (res?.status === 429) {
        await new Promise(r => setTimeout(r, 1200)); // rate-limit 대기
        res = await go();
      }
      return res;
    };

    // 지역 필터: selectedCity(예: "경기도 수원시 팔달구")에서 시도·시군구 추출
    const cityParts = selectedCity.split(/\s+/);
    const sido    = cityParts[0] || '';   // "경기도"
    const sigungu = cityParts[1] || '';   // "수원시"

    // 검색 결과가 선택된 지자체 내인지 확인
    // address 검색(road_address.address_name)과 keyword 검색(road_address_name) 모두 커버
    const isInRegion = (doc) => {
      if (!sido) return true;
      const addrStr = [
        doc.address_name || '',
        doc.road_address_name || '',
        doc.road_address?.address_name || '',
      ].join(' ');
      return addrStr.includes(sido) && (!sigungu || addrStr.includes(sigungu));
    };

    // 단건 좌표 조회 (행정동 정보도 받아 건물명 전용 폴백에 활용)
    //   1) 도로명 address 검색 (이미 도시명 포함 → 지역 이탈 없음)
    //   2) 전체 주소 keyword 검색 → 지역 내 결과만 채택
    //   3) 시군구 접두 + 도로명 keyword 검색 → 지역 내 결과만 채택
    //   4) 행정동 + 건물명 keyword 검색 → 건물명만 있는 경우 전용 (주민센터·구청 등)
    const getCoord = async (주소, 행정동 = '') => {
      const road = cleanRoad(주소);

      // 1단계: 도로명만으로 address 검색 — 전국 동명 도로 대비 지역 필터 적용
      const res1 = await kakaoFetch(
        `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(road)}&size=5`
      );
      if (res1?.ok) {
        const docs = (await res1.json()).documents || [];
        const d = docs.find(isInRegion);
        if (d?.x && d?.y) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 1 };
      }

      // 2단계: 원본 전체로 keyword 검색 (아파트·건물명 포함) → 지역 내 결과만
      const res2 = await kakaoFetch(
        `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(주소)}&size=5`
      );
      if (res2?.ok) {
        const docs = (await res2.json()).documents || [];
        const d = docs.find(isInRegion);
        if (d?.x && d?.y) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 2 };
      }

      // 3단계: 시군구명 + 도로명으로 keyword 검색 → 지역 내 결과만
      const step3Query = sigungu ? `${sigungu} ${road}` : road;
      if (step3Query !== 주소) {
        const res3 = await kakaoFetch(
          `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(step3Query)}&size=5`
        );
        if (res3?.ok) {
          const docs = (await res3.json()).documents || [];
          const d = docs.find(isInRegion);
          if (d?.x && d?.y) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 3 };
        }
      }

      // 4단계: 행정동 + 건물명 keyword 검색 (주민센터·행정복지관·구청 등 건물명만 있는 경우)
      // 도로번호 패턴이 없으면 건물명 전용으로 판단
      const isOnlyBuildingName = !/\d+(-\d+)?(로|길|번길|번지|가)\b/.test(road);
      if (isOnlyBuildingName) {
        const dongPrefix = 행정동?.trim() || sigungu;
        const step4Query = dongPrefix ? `${dongPrefix} ${road}` : `${sido} ${road}`;
        const res4 = await kakaoFetch(
          `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(step4Query)}&size=5`
        );
        if (res4?.ok) {
          const docs = (await res4.json()).documents || [];
          const d = docs.find(isInRegion) || docs.find(doc => doc.category_group_code === 'PO3'); // 공공기관 우선
          if (d?.x && d?.y && isInRegion(d)) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 4 };
        }
      }

      return null;
    };

    try {
      const concurrency = 5; // Kakao rate-limit 여유 있게
      const executing = new Set();
      let step1Hit = 0, step2Hit = 0;

      for (const r of targets) {
        const p = (async () => {
          const coord = await getCoord(r.주소, r.행정동);
          if (coord) {
            const { _step, ...latLng } = coord;
            updates[r.id] = latLng;
            successCount++;
            if (_step === 1) step1Hit++;
            else step2Hit++;
          }
          setCoordProgress(prev => prev
            ? { ...prev, done: prev.done + 1, step1: step1Hit, step2: step2Hit }
            : prev
          );
        })().then(() => { executing.delete(p); });
        executing.add(p);
        if (executing.size >= concurrency) await Promise.race(executing);
      }
      await Promise.all(executing);

      if (Object.keys(updates).length) {
        const entries = Object.entries(updates);
        for (let i = 0; i < entries.length; i += 499) {
          const batch = writeBatch(db);
          entries.slice(i, i + 499).forEach(([id, coord]) => {
            batch.update(doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id, 'records', id), coord);
          });
          await batch.commit();
        }
        setRecords(prev => prev.map(r => updates[r.id] ? { ...r, ...updates[r.id] } : r));
      }
      alert(`✅ 좌표 보완 완료: ${successCount}/${targets.length}건 성공\n(주소검색: ${step1Hit}건 / 키워드검색: ${step2Hit}건)`);
    } catch (e) { alert('좌표 보완 실패: ' + e.message); }
    finally { setIsFetchingCoords(false); setCoordProgress(null); }
  };

  // ── DB 전체 초기화 (records만 삭제, 월 메타는 유지) ─────────────────────
  const [isClearing, setIsClearing] = useState(false);
  const handleClearAllRecords = async () => {
    if (!isAdmin || !selectedCity || !selectedMonth) return;
    const count = records.length;
    if (!window.confirm(
      `⚠️ 경고: ${selectedCity} ${selectedMonth.id} 월의 레코드 ${count.toLocaleString()}건을 전부 삭제합니다.\n\n월 항목은 유지되며 재업로드 가능합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`
    )) return;
    setIsClearing(true);
    try {
      const snap = await getDocs(collection(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id, 'records'));
      for (let i = 0; i < snap.docs.length; i += 499) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + 499).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await setDoc(doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id), {
        totalCount: 0, 수급자Count: 0, 차상위Count: 0,
      }, { merge: true });
      setRecords([]);
      setDirtyRecords({});
      setDeletedRecordIds(new Set());
      await fetchMonths();
      alert(`✅ ${selectedMonth.id} 레코드 ${count.toLocaleString()}건 전체 삭제 완료`);
    } catch (e) {
      alert('삭제 오류: ' + e.message);
    } finally {
      setIsClearing(false);
    }
  };

  // ── 유령데이터 정리 (이름 없거나 주소+행정동 모두 없는 행) ────────────────
  const [isPurging, setIsPurging] = useState(false);
  const handlePurgeGhostData = async () => {
    if (!isAdmin || !selectedCity || !selectedMonth) return;
    const ghosts = records.filter(r => {
      const name = (r.이름 || '').trim();
      const addr = (r.주소 || '').trim();
      const dong = (r.행정동 || '').trim();
      return !name || (!addr && !dong);
    });
    if (!ghosts.length) { alert('유령데이터가 없습니다. 모든 레코드에 이름과 주소/행정동이 있습니다.'); return; }

    const preview = ghosts.slice(0, 5).map(r =>
      `• ${r.이름 || '(이름없음)'} / ${r.행정동 || ''} ${r.주소 || '(주소없음)'}`
    ).join('\n');
    if (!window.confirm(
      `유령데이터 ${ghosts.length}건을 삭제합니다.\n\n예시:\n${preview}${ghosts.length > 5 ? `\n...외 ${ghosts.length - 5}건` : ''}\n\n계속하시겠습니까?`
    )) return;

    setIsPurging(true);
    try {
      const ids = ghosts.map(r => r.id);
      for (let i = 0; i < ids.length; i += 499) {
        const batch = writeBatch(db);
        ids.slice(i, i + 499).forEach(id => {
          batch.delete(doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id, 'records', id));
        });
        await batch.commit();
      }
      const remaining = records.filter(r => !ids.includes(r.id));
      const totalCount = remaining.length;
      const 수급자Count = remaining.filter(r => r.구분 === '기초수급자').length;
      const 차상위Count = remaining.filter(r => r.구분 === '차상위').length;
      await setDoc(doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id), {
        totalCount, 수급자Count, 차상위Count,
      }, { merge: true });
      setRecords(remaining);
      setDirtyRecords({});
      setDeletedRecordIds(new Set());
      await fetchMonths();
      alert(`✅ 유령데이터 ${ghosts.length}건 삭제 완료\n남은 레코드: ${totalCount.toLocaleString()}건`);
    } catch (e) {
      alert('정리 오류: ' + e.message);
    } finally {
      setIsPurging(false);
    }
  };

  // ── Download xlsx ─────────────────────────────────────────────────
  const handleDownloadXlsx = () => {
    if (!displayRecords.length) return alert('다운로드할 데이터가 없습니다.');
    const data = displayRecords.map((r, i) => ({
      번호: i + 1,
      구분: r.구분 || '', 이름: r.이름 || '', 생년월일: r.생년월일 || '',
      행정동: r.행정동 || '', 주소: r.주소 || '',
      휴대폰: r.휴대폰 || '', 유선전화: r.유선전화 || '',
      포수: r.포수 || '', 특이사항: r.특이사항 || '',
      기사: r.기사 || '', 배송순번: r.배송순번 || '',
      좌표: r.lat ? 'Y' : 'N',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, selectedMonth.id);
    XLSX.writeFile(wb, `${selectedCity}_${selectedMonth.id}_월별명단.xlsx`);
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="absolute inset-0 bg-[#050505] flex flex-col">

      {/* ── HEADER ── */}
      <div className="h-14 shrink-0 bg-[#080808] border-b border-[#1a1a1a] flex items-center px-5 gap-3">
        <button onClick={onBack} className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <Cloud size={17} className="text-blue-400 shrink-0" />
          <div>
            <h1 className="text-sm font-black text-white leading-tight">이번달 배송명단</h1>
            <p className="text-[10px] text-gray-600 leading-tight">
              {isAdmin ? '월별 배송명단 · 기사 배정 · 루트맵 · 조회 · 수정 · 다운로드' : `승인된 지자체 ${approvedCities.length}개 조회 가능`}
            </p>
          </div>
        </div>

        {/* Action buttons (shown when month selected) */}
        {selectedMonth && (
          <div className="flex items-center gap-2 shrink-0">
            {hasRecordChanges && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                {Object.keys(dirtyRecords).length > 0 && `수정 ${Object.keys(dirtyRecords).length}건`}
                {Object.keys(dirtyRecords).length > 0 && deletedRecordIds.size > 0 && ' · '}
                {deletedRecordIds.size > 0 && `삭제 ${deletedRecordIds.size}건`}
              </div>
            )}
            <button
              onClick={handleSaveEdits}
              disabled={!hasRecordChanges || saving}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                hasRecordChanges && !saving
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_14px_rgba(59,130,246,0.25)]'
                  : 'bg-white/5 text-gray-600 cursor-not-allowed'
              }`}
            >
              <Save size={13} /> {saving ? '저장 중...' : '변경사항 저장'}
            </button>
            {hasRecordChanges && (
              <button
                onClick={() => { setDirtyRecords({}); setDeletedRecordIds(new Set()); setEditingCell(null); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] text-gray-500 hover:text-gray-300 bg-white/5 hover:bg-white/10 transition-colors"
              >
                <RotateCcw size={12} /> 되돌리기
              </button>
            )}
            {records.length > 0 && (
              <button
                onClick={handleFetchCoords}
                disabled={isFetchingCoords}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-blue-950/40 hover:bg-blue-900/50 text-blue-400 border border-blue-500/30 transition-colors disabled:opacity-40"
              >
                {isFetchingCoords
                  ? <><span className="animate-spin inline-block">↻</span> {coordProgress ? `${coordProgress.done}/${coordProgress.total}건` : '준비중...'}</>
                  : <><MapPin size={13} /> 좌표 받아오기</>}
              </button>
            )}
            {records.length > 0 && (
              <button
                onPointerDown={e => { e.preventDefault(); setShowOrgPreset(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-purple-950/40 hover:bg-purple-900/50 text-purple-400 border border-purple-500/30 transition-colors"
              >
                <Building2 size={13} /> 조직 배분
              </button>
            )}
            {onOpenRouteMap && (
              <button
                onClick={() => onOpenRouteMap(selectedCity, selectedMonth.id, orgDongs)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[#22c55e]/15 hover:bg-[#22c55e]/25 text-[#22c55e] border border-[#22c55e]/30 transition-colors"
              >
                <MapPin size={13} /> 루트맵 배정
              </button>
            )}
            {isAdmin && records.length > 0 && (
              <button
                onClick={handlePurgeGhostData}
                disabled={isPurging}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-orange-950/40 hover:bg-orange-900/50 text-orange-400 border border-orange-500/30 transition-colors disabled:opacity-40"
                title="이름 없거나 주소+행정동 모두 없는 유령 레코드 삭제"
              >
                <Ghost size={13} /> {isPurging ? '정리 중...' : '유령 정리'}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={handleClearAllRecords}
                disabled={isClearing || !records.length}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-500/30 transition-colors disabled:opacity-40"
                title="이 월의 레코드 전체 삭제 (월 항목은 유지)"
              >
                <DatabaseZap size={13} /> {isClearing ? '삭제 중...' : 'DB 초기화'}
              </button>
            )}
            <button
              onClick={handleDownloadXlsx}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 hover:bg-white/10 text-gray-300 transition-colors border border-white/5"
            >
              <Download size={13} /> xlsx 다운로드
            </button>
            {selectedMonth.hasOriginal && (
              <button
                onClick={() => handleDownloadOriginal(selectedMonth)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 hover:bg-white/10 text-gray-400 transition-colors border border-white/5"
              >
                <Download size={13} /> 원본 xlsx
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT PANEL ── */}
        <div className="w-64 shrink-0 border-r border-[#181818] flex flex-col bg-[#080808]">

          {/* City selector */}
          <div className="p-4 border-b border-[#181818]">
            <p className="text-[10px] text-gray-600 font-bold mb-2.5 tracking-widest uppercase">지자체 선택</p>
            <div className="flex flex-col gap-2">
              <select
                value={selectedSido}
                onChange={e => { setSelectedSido(e.target.value); setSelectedSigungu(''); }}
                className="w-full bg-black border border-[#333] rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="">시/도 선택</option>
                {availableSidos.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={selectedSigungu}
                onChange={e => setSelectedSigungu(e.target.value)}
                disabled={!selectedSido}
                className="w-full bg-black border border-[#333] rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-blue-500 disabled:opacity-40 cursor-pointer"
              >
                <option value="">시/군/구 선택</option>
                {availableSigungus.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Upload button (admin only) */}
            {selectedCity && isAdmin && (
              <label className={`mt-3 w-full cursor-pointer flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-all border ${uploading ? 'bg-white/5 text-gray-600 border-white/5 pointer-events-none' : 'bg-blue-900/20 text-blue-300 border-blue-500/25 hover:bg-blue-900/35'}`}>
                <Upload size={12} />
                {uploading ? uploadStatus || '처리 중...' : '새 월 배송명단 업로드'}
                <input type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" disabled={uploading} />
              </label>
            )}
          </div>

          {/* Month list */}
          <div className="flex-1 overflow-auto">
            {!selectedCity ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 px-4 text-center">
                <Cloud size={28} className="text-gray-800" />
                <p className="text-[11px] text-gray-700">지자체를 선택하세요</p>
              </div>
            ) : loadingMonths ? (
              <div className="flex items-center justify-center h-20 text-gray-600 text-xs animate-pulse">불러오는 중...</div>
            ) : months.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 px-4 text-center">
                <Calendar size={28} className="text-gray-800" />
                <p className="text-[11px] text-gray-700">저장된 배송명단이 없습니다</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {months.map(m => (
                  <div
                    key={m.id}
                    onClick={() => handleSelectMonth(m)}
                    className={`p-3 rounded-xl cursor-pointer transition-all group border ${
                      selectedMonth?.id === m.id
                        ? 'bg-blue-900/25 border-blue-500/35'
                        : 'hover:bg-white/[0.04] border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white flex items-center gap-1.5 mb-0.5">
                          <Calendar size={10} className="text-blue-400 shrink-0" />
                          {m.id}
                        </div>
                        <div className="text-[10px] text-gray-600 truncate">
                          전체 {(m.totalCount||0).toLocaleString()} · 수급 {(m.수급자Count||0).toLocaleString()} · 차상위 {(m.차상위Count||0).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                        {m.hasOriginal && (
                          <button onClick={e => { e.stopPropagation(); handleDownloadOriginal(m); }}
                            className="p-1 text-gray-600 hover:text-blue-400 transition-colors" title="원본 다운로드">
                            <Download size={11} />
                          </button>
                        )}
                        {isAdmin && (
                          <button onClick={e => { e.stopPropagation(); setDeleteMonthConfirm(m); }}
                            className="p-1 text-gray-600 hover:text-red-400 transition-colors" title="삭제">
                            <Trash2 size={11} />
                          </button>
                        )}
                        <ChevronRight size={11} className="text-gray-700" />
                      </div>
                    </div>
                    {selectedMonth?.id === m.id && (
                      <div className="mt-1.5 text-[10px] text-gray-600">
                        {fmtTs(m.uploadedAt)} · {m.uploadedBy}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedMonth ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-700">
              <FileSpreadsheet size={48} className="opacity-15" />
              <p className="text-sm">좌측에서 월별 명단을 선택하세요</p>
              <p className="text-xs text-gray-800">명단을 선택하면 상세 데이터가 표시됩니다</p>
            </div>
          ) : (
            <>
              {/* Month header */}
              <div className="px-5 py-3 border-b border-[#181818] bg-[#080808] shrink-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <h2 className="text-sm font-black text-white">
                    {selectedCity} — <span className="text-blue-400">{selectedMonth.id}</span>
                  </h2>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    <span>전체 <span className="text-white font-bold">{(selectedMonth.totalCount||0).toLocaleString()}</span>명</span>
                    <span className="text-amber-400">기초수급자 <span className="font-bold">{(selectedMonth.수급자Count||0).toLocaleString()}</span>명</span>
                    <span className="text-blue-400">차상위 <span className="font-bold">{(selectedMonth.차상위Count||0).toLocaleString()}</span>명</span>
                    {isAdmin && (
                      <span className="text-gray-600">업로드: {fmtTs(selectedMonth.uploadedAt)} · {selectedMonth.uploadedBy}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Search toolbar */}
              <div className="h-11 shrink-0 border-b border-[#181818] flex items-center px-4 gap-3 bg-[#080808]">
                <div className="relative w-72">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
                  <input
                    type="text" value={searchInput}
                    onChange={e => handleSearchChange(e.target.value)}
                    placeholder="이름, 행정동, 주소, 연락처 검색..."
                    className="w-full bg-black/70 border border-[#2a2a2a] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white outline-none focus:border-blue-500/50 placeholder:text-gray-700"
                  />
                  {searchInput && (
                    <button onClick={() => { setSearchInput(''); setSearchText(''); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                      <X size={11} />
                    </button>
                  )}
                </div>
                <span className="text-[11px] text-gray-600">
                  {displayRecords.length.toLocaleString()}건 표시
                  {searchText && ` (전체 ${records.filter(r => !deletedRecordIds.has(r.id)).length.toLocaleString()}건 중)`}
                </span>
                {records.length > 0 && (() => {
                  const withCoord = records.filter(r => r.lat && r.lng).length;
                  const noCoord = records.filter(r => r.주소 && !r.lat && !r.lng).length;
                  const pct = records.length > 0 ? Math.round(withCoord / records.length * 100) : 0;
                  const noPct = records.length > 0 ? Math.round(noCoord / records.length * 100) : 0;
                  return (
                    <div className="flex items-center gap-2 ml-auto">
                      <div className="flex items-center gap-1.5">
                        <div className="w-24 bg-[#1a1a1a] rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full bg-[#22c55e]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-[#22c55e] font-bold whitespace-nowrap">
                          좌표 {withCoord.toLocaleString()}건 ({pct}%)
                        </span>
                        {noCoord > 0 && (
                          <span className="text-[10px] text-red-400 font-bold whitespace-nowrap">
                            · 없음 {noCoord.toLocaleString()}건 ({noPct}%)
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {!searchText && records.length > 0 && (
                  <p className="text-[10px] text-gray-700 ml-auto">셀을 클릭하여 직접 수정 · 행 끝 🗑 으로 삭제</p>
                )}
              </div>

              {/* Records table — Virtual Scroll */}
              <VirtualTable
                displayRecords={displayRecords}
                dirtyRecords={dirtyRecords}
                deletedRecordIds={deletedRecordIds}
                loadingRecords={loadingRecords}
                records={records}
                renderCell={renderCell}
                setDeletedRecordIds={setDeletedRecordIds}
              />
            </>
          )}
        </div>
      </div>

      {/* ═══ ORG PRESET MODAL ═══ */}
      {showOrgPreset && selectedCity && selectedMonth && (
        <OrgPresetModal
          city={selectedCity}
          records={records}
          monthId={selectedMonth.id}
          onClose={() => setShowOrgPreset(false)}
        />
      )}

      {/* ═══ DELETE MONTH CONFIRM MODAL ═══ */}
      {deleteMonthConfirm && (
        <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[100]">
          <div className="bg-[#0e0e0e] border border-red-500/30 rounded-2xl p-6 w-full max-w-sm shadow-[0_0_30px_rgba(239,68,68,0.15)]">
            <div className="flex items-center gap-2.5 mb-3">
              <AlertCircle className="text-red-400 shrink-0" size={18} />
              <h3 className="text-white font-black text-sm">월 명단 삭제 확인</h3>
            </div>
            <p className="text-gray-300 text-sm font-bold mb-1">{selectedCity} — {deleteMonthConfirm.id}</p>
            <p className="text-gray-600 text-xs mb-5 leading-relaxed">
              총 {(deleteMonthConfirm.totalCount||0).toLocaleString()}건의 데이터와 원본 파일이 영구 삭제됩니다.<br />이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteMonthConfirm(null)}
                className="flex-1 py-2.5 bg-white/5 border border-[#333] text-gray-400 font-bold rounded-xl text-sm hover:bg-white/10 transition-colors">
                취소
              </button>
              <button onClick={() => handleDeleteMonth(deleteMonthConfirm)}
                className="flex-1 py-2.5 bg-red-950/60 border border-red-500/50 text-red-400 font-bold rounded-xl text-sm hover:bg-red-900/60 transition-colors">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
