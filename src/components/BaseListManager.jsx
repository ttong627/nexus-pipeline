import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  db, collection, getDocs, getDocsFromServer, getDoc, setDoc, doc, deleteDoc, writeBatch, serverTimestamp, query, where
} from '../config/firebase.js';
import {
  Database, Upload, Trash2, ArrowLeft, AlertCircle,
  Download, Search, Save, Clock, RotateCcw, FileSpreadsheet, X, RefreshCw
} from 'lucide-react';

import { normalizeBirth, parsePhoneNumbers, formatPhoneInput } from '../utils/parsers.js';
import { REGIONS } from '../utils/regions.js';

const FIELDS = [
  { key: 'name',     label: '성명',     minW: '90px'  },
  { key: 'birthKey', label: '생년월일', minW: '85px'  },
  { key: 'dong',     label: '행정동',   minW: '75px'  },
  { key: 'mobile',   label: '휴대폰',   minW: '110px' },
  { key: 'landline', label: '유선전화', minW: '110px' },
  { key: 'note',     label: '특이사항', minW: '220px' },
];

const fmtDate = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
};

export default function BaseListManager({ user, onBack, initialCity = '' }) {
  const isAdmin = user?.role === 'admin';
  const citiesApproved = user?.citiesApproved || [];
  const TIER_QUOTAS = { basic: 0, vip: 2, vvip: 10, sapphire: 999 };
  const maxCities = TIER_QUOTAS[user?.tier || 'basic'] || 0;

  const [selectedCity, setSelectedCity] = useState(initialCity || '');
  const [filterSido, setFilterSido] = useState(() => {
    if (!initialCity) return '';
    return initialCity.trim().split(/\s+/)[0] || '';
  });

  const [storedCities, setStoredCities] = useState([]);
  const [loadingCities, setLoadingCities] = useState(false);

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [userRequests, setUserRequests] = useState({});
  const [requestingCity, setRequestingCity] = useState(false);

  const [dirtyMap, setDirtyMap] = useState({});
  const [deletedIds, setDeletedIds] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [filterDong, setFilterDong] = useState('');
  const [showOnlyWithNote, setShowOnlyWithNote] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [showDedupReview, setShowDedupReview] = useState(false);
  const [historyRecord, setHistoryRecord] = useState(null);
  const [newHistoryNote, setNewHistoryNote] = useState('');
  const [notifyManager, setNotifyManager] = useState(false);

  const hasCityAccess = isAdmin || citiesApproved.includes(selectedCity);
  const availableSidos = Object.keys(REGIONS);

  const filteredCities = useMemo(() => {
    if (!filterSido) return storedCities;
    return storedCities.filter(c => c.id.startsWith(filterSido));
  }, [storedCities, filterSido]);

  const displayRecords = useMemo(() => {
    return records
      .filter(r => !deletedIds.has(r.id))
      .map(r => ({ ...r, ...dirtyMap[r.id] }))
      .filter(r => {
        if (showOnlyWithNote && !(r.note || '').trim()) return false;
        if (filterDong && (r.dong || '') !== filterDong) return false;
        if (!searchText.trim()) return true;
        const q = searchText.toLowerCase();
        return [r.name, r.dong, r.mobile, r.landline, r.note]
          .some(v => String(v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => {
        let cmp = (a.dong || '').localeCompare(b.dong || '', 'ko', { numeric: true });
        if (cmp !== 0) return cmp;
        return (a.name || '').localeCompare(b.name || '', 'ko', { numeric: true });
      });
  }, [records, dirtyMap, deletedIds, searchText, filterDong, showOnlyWithNote]);

  const noteCount = useMemo(() =>
    records.filter(r => !deletedIds.has(r.id) && (dirtyMap[r.id]?.note ?? r.note ?? '').trim()).length,
  [records, dirtyMap, deletedIds]);

  const baseDongList = useMemo(() =>
    [...new Set(records.filter(r => !deletedIds.has(r.id)).map(r => r.dong).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })),
  [records, deletedIds]);

  const hasChanges = Object.keys(dirtyMap).length > 0 || deletedIds.size > 0;

  useEffect(() => {
    loadUserRequests();
    fetchStoredCities();
  }, []);

  useEffect(() => {
    setDirtyMap({});
    setDeletedIds(new Set());
    setEditingCell(null);
    setSearchText('');
    setShowUpload(false);
    if (!selectedCity) { setRecords([]); setLastUpdatedAt(''); return; }
    if (hasCityAccess) fetchRecords(selectedCity);
    else setRecords([]);
  }, [selectedCity]);

  const fetchStoredCities = async () => {
    setLoadingCities(true);
    try {
      const snap = await getDocs(collection(db, 'base_lists'));
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => d.id && !d.id.startsWith('__'));

      // "시/도 시/군/구" 형식이 아닌 항목(공백 없음) → 자동 삭제
      const malformed = all.filter(d => !d.id.includes(' '));
      for (const c of malformed) {
        try {
          const recSnap = await getDocsFromServer(collection(db, `base_lists/${c.id}/records`));
          for (let i = 0; i < recSnap.docs.length; i += 499) {
            const batch = writeBatch(db);
            recSnap.docs.slice(i, i + 499).forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
          await deleteDoc(doc(db, 'base_lists', c.id));
        } catch (e) { console.error(`[cleanup] ${c.id}:`, e); }
      }

      setStoredCities(
        all
          .filter(d => d.id.includes(' '))
          .sort((a, b) => a.id.localeCompare(b.id, 'ko'))
      );
    } catch (e) { console.error('[BaseListManager] fetchStoredCities:', e); }
    finally { setLoadingCities(false); }
  };

  const loadUserRequests = async () => {
    if (!user?.uid || isAdmin) return;
    try {
      const snap = await getDocs(query(collection(db, 'city_requests'), where('uid', '==', user.uid)));
      const map = {};
      snap.docs.forEach(d => {
        const data = d.data();
        map[data.cityId] = { status: data.status, id: d.id, rejectedReason: data.rejectedReason || '' };
      });
      setUserRequests(map);
    } catch (e) { console.error('[BaseListManager] loadUserRequests:', e); }
  };

  const fetchRecords = async (cityId) => {
    setLoading(true);
    try {
      const cityDoc = await getDoc(doc(db, 'base_lists', cityId));
      if (cityDoc.exists() && cityDoc.data().updatedAt) {
        setLastUpdatedAt(fmtDate(cityDoc.data().updatedAt));
      } else setLastUpdatedAt('');
      const snap = await getDocsFromServer(collection(db, `base_lists/${cityId}/records`));
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      alert('데이터를 불러오는데 실패했습니다.');
    } finally { setLoading(false); }
  };

  const handleRequestCity = async (cityId) => {
    if (citiesApproved.length >= maxCities)
      return alert(`현재 등급(${user?.tier})의 지자체 한도(${maxCities}개)를 초과했습니다.`);
    setRequestingCity(true);
    try {
      const requestId = `${user.uid}_${cityId.replace(/\s/g, '')}`;
      await setDoc(doc(db, 'city_requests', requestId), {
        uid: user.uid, userEmail: user.email || '',
        userName: user.realName || '', userRegion: user.region || '',
        userTier: user.tier || 'basic', cityId, status: 'pending',
        requestedAt: serverTimestamp(),
      });
      setUserRequests(prev => ({ ...prev, [cityId]: { status: 'pending', id: requestId, rejectedReason: '' } }));
      alert(`'${cityId}' 접근 승인을 신청했습니다.\n관리자 검토 후 이용 가능합니다.`);
    } catch (e) { alert('신청 중 오류: ' + e.message); }
    finally { setRequestingCity(false); }
  };

  const startEdit = (id, field, val) => {
    setEditingCell({ id, field });
    setEditValue(String(val ?? ''));
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const origVal = records.find(r => r.id === id)?.[field] ?? '';
    setDirtyMap(prev => {
      const prevEntry = prev[id] || {};
      if (String(editValue) === String(origVal) && prevEntry[field] === undefined) return prev;
      if (String(editValue) === String(origVal)) {
        const newEntry = { ...prevEntry };
        delete newEntry[field];
        const newMap = { ...prev };
        if (Object.keys(newEntry).length === 0) delete newMap[id]; else newMap[id] = newEntry;
        return newMap;
      }
      return { ...prev, [id]: { ...prevEntry, [field]: editValue } };
    });
    setEditingCell(null);
  };

  const renderCell = (r, field) => {
    const id = r.id;
    const isEditing = editingCell?.id === id && editingCell?.field === field;
    const isDirty = dirtyMap[id]?.[field] !== undefined;
    const val = dirtyMap[id]?.[field] ?? r[field] ?? '';
    if (isEditing) {
      return (
        <input
          autoFocus
          className="w-full bg-transparent text-white text-xs outline-none border-b border-blue-400 py-0.5"
          value={editValue}
          onChange={e => setEditValue(field === 'mobile' || field === 'landline' ? formatPhoneInput(e.target.value) : e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingCell(null); }}
        />
      );
    }
    const noteStr = String(val || '');
    if (field === 'note' && noteStr.includes('◆')) {
      const parts = noteStr.split(/(◆[^◆]*)/).filter(Boolean);
      return (
        <span title={noteStr} onClick={() => startEdit(id, field, val)}
          className={`cursor-text block truncate text-xs ${isDirty ? 'font-semibold' : ''}`}>
          {parts.map((p, i) => (
            <span key={i} className={p.startsWith('◆') ? 'text-amber-400' : isDirty ? 'text-blue-300' : 'text-gray-300'}>{p}</span>
          ))}
        </span>
      );
    }
    return (
      <span title={noteStr} onClick={() => startEdit(id, field, val)}
        className={`cursor-text block truncate text-xs ${isDirty ? 'text-blue-300 font-semibold' : 'text-gray-300'} ${!val ? 'text-gray-700' : ''}`}>
        {val || '—'}
      </span>
    );
  };

  const handleSave = async () => {
    if (!hasChanges || saving) return;
    const modifiedEntries = Object.entries(dirtyMap).filter(([id]) => !deletedIds.has(id));
    const deletedArr = [...deletedIds];
    if (!confirm(`변경사항을 저장하시겠습니까?\n수정: ${modifiedEntries.length}건 / 삭제: ${deletedArr.length}건`)) return;
    setSaving(true);
    try {
      const allOps = [
        ...modifiedEntries.map(([id, changes]) => ({ type: 'update', id, changes })),
        ...deletedArr.map(id => ({ type: 'delete', id })),
      ];
      for (let i = 0; i < allOps.length; i += 499) {
        const batch = writeBatch(db);
        allOps.slice(i, i + 499).forEach(op => {
          const ref = doc(db, `base_lists/${selectedCity}/records`, op.id);
          if (op.type === 'update') batch.update(ref, op.changes);
          else batch.delete(ref);
        });
        await batch.commit();
      }
      await setDoc(doc(db, 'base_lists', selectedCity), { updatedAt: serverTimestamp() }, { merge: true });
      setDirtyMap({});
      setDeletedIds(new Set());
      await fetchRecords(selectedCity);
      await fetchStoredCities();
      alert(`저장 완료! (수정 ${modifiedEntries.length}건, 삭제 ${deletedArr.length}건)`);
    } catch (e) { alert('저장 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDeleteAllRecords = async () => {
    if (!selectedCity || !hasCityAccess) return;
    if (!confirm(`⚠️ "${selectedCity}" 기본명단을 전체 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`)) return;
    setSaving(true);
    try {
      const freshSnap = await getDocsFromServer(collection(db, `base_lists/${selectedCity}/records`));
      for (let i = 0; i < freshSnap.docs.length; i += 499) {
        const batch = writeBatch(db);
        freshSnap.docs.slice(i, i + 499).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, 'base_lists', selectedCity));
      setRecords([]);
      setLastUpdatedAt('');
      setDirtyMap({});
      setDeletedIds(new Set());
      await fetchStoredCities();
      alert(`"${selectedCity}" 기본명단 전체 삭제 완료 (${freshSnap.docs.length.toLocaleString()}건)`);
    } catch (e) { alert('삭제 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDeleteNoNote = async () => {
    if (!selectedCity || !hasCityAccess) return;
    const targets = records.filter(r => !(r.note || '').trim());
    if (!targets.length) { alert('특이사항 없는 레코드가 없습니다.'); return; }
    if (!confirm(`특이사항이 없는 레코드 ${targets.length.toLocaleString()}건을 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`)) return;
    setSaving(true);
    try {
      for (let i = 0; i < targets.length; i += 499) {
        const batch = writeBatch(db);
        targets.slice(i, i + 499).forEach(r =>
          batch.delete(doc(db, `base_lists/${selectedCity}/records`, r.id))
        );
        await batch.commit();
      }
      await setDoc(doc(db, 'base_lists', selectedCity), { updatedAt: serverTimestamp() }, { merge: true });
      await fetchRecords(selectedCity);
      await fetchStoredCities();
      alert(`특이사항 없는 레코드 ${targets.length.toLocaleString()}건 삭제 완료`);
    } catch (e) { alert('삭제 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  // ── 지자체 항목 자체 삭제 (카드 X 버튼) ──────────────────────────
  const handleDeleteCity = async (cityId) => {
    if (!confirm(`"${cityId}" 지자체 항목을 삭제합니다.\n레코드 ${storedCities.find(c => c.id === cityId)?.recordCount ?? '전체'}건도 함께 삭제됩니다.\n계속하시겠습니까?`)) return;
    setSaving(true);
    try {
      const snap = await getDocsFromServer(collection(db, `base_lists/${cityId}/records`));
      for (let i = 0; i < snap.docs.length; i += 499) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + 499).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, 'base_lists', cityId));
      if (selectedCity === cityId) {
        setSelectedCity('');
        setRecords([]);
        setLastUpdatedAt('');
      }
      await fetchStoredCities();
      alert(`"${cityId}" 삭제 완료`);
    } catch (e) { alert('삭제 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleCleanGhosts = async () => {
    if (!selectedCity || !hasCityAccess) return;
    setSaving(true);
    try {
      const snap = await getDocsFromServer(collection(db, `base_lists/${selectedCity}/records`));
      const ghosts = snap.docs.filter(d => !d.data().name?.trim());
      if (ghosts.length === 0) { alert('유령 데이터가 없습니다.'); return; }
      if (!confirm(`이름이 없는 유령 레코드 ${ghosts.length}건을 삭제합니다.\n계속하시겠습니까?`)) return;
      for (let i = 0; i < ghosts.length; i += 499) {
        const batch = writeBatch(db);
        ghosts.slice(i, i + 499).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await fetchRecords(selectedCity);
      alert(`유령 데이터 ${ghosts.length}건 삭제 완료`);
    } catch (e) { alert('유령 정리 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  // ── 전화번호 이동 (유선전화 → 휴대폰) ────────────────────────────
  // 휴대폰이 비어있고 유선전화에 모바일 번호가 잘못 들어간 경우 교정
  const handleMovePhoneNumbers = async () => {
    if (!selectedCity || !hasCityAccess) return;

    // 모바일 번호 여부 판단 + 정규화된 숫자 반환
    const detectMobile = (phone) => {
      const digits = (phone || '').replace(/[^0-9]/g, '');
      // 표준 형식: 010/011/016/017/018/019 + 7~8자리
      if (/^01[016789]\d{7,8}$/.test(digits)) return digits;
      // 앞 0이 빠진 형식: 1[016789] + 7~8자리 → 앞에 0 붙임
      if (/^1[016789]\d{7,8}$/.test(digits)) return '0' + digits;
      return null;
    };

    const formatMobile = (digits) => {
      if (digits.length === 11) return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
      if (digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
      return digits;
    };

    const targets = records.filter(r => {
      const mobileDigits = (r.mobile || '').replace(/[^0-9]/g, '');
      return !mobileDigits && detectMobile(r.landline);
    });

    if (!targets.length) {
      alert('이동할 전화번호가 없습니다.\n(조건: 휴대폰 공란 + 유선전화에 모바일 번호 형식)');
      return;
    }
    if (!confirm(`유선전화 → 휴대폰으로 이동할 번호 ${targets.length.toLocaleString()}건\n계속하시겠습니까?`)) return;

    setSaving(true);
    try {
      const updates = targets.map(r => ({
        id: r.id,
        mobile: formatMobile(detectMobile(r.landline)),
        landline: '',
      }));

      for (let i = 0; i < updates.length; i += 499) {
        const batch = writeBatch(db);
        updates.slice(i, i + 499).forEach(u =>
          batch.update(doc(db, `base_lists/${selectedCity}/records`, u.id), { mobile: u.mobile, landline: u.landline })
        );
        await batch.commit();
      }
      await setDoc(doc(db, 'base_lists', selectedCity), { updatedAt: serverTimestamp() }, { merge: true });
      await fetchRecords(selectedCity);
      alert(`✅ 전화번호 이동 완료: ${updates.length.toLocaleString()}건\n유선전화 → 휴대폰으로 이동했습니다.`);
    } catch (e) { alert('처리 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDownload = () => {
    if (!displayRecords.length) return alert('다운로드할 데이터가 없습니다.');
    const data = displayRecords.map((r, i) => ({
      번호: i + 1,
      성명: r.name || '',
      생년월일: r.birthKey || '',
      행정동: r.dong || '',
      휴대폰: r.mobile || '',
      유선전화: r.landline || '',
      특이사항: r.note || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length, 10) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '기본명단');
    const today = new Date();
    const ds = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    XLSX.writeFile(wb, `${selectedCity}_기본명단_${ds}.xlsx`, { bookType: 'xlsx', type: 'binary', compression: true });
  };

  const handleFileUpload = async (e) => {
    if (!selectedCity) return alert('먼저 지자체를 선택해주세요.');
    if (!hasCityAccess) return alert('이 지자체에 대한 접근 권한이 없습니다.');
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); };
        worker.onerror = err => { worker.terminate(); reject(err); };
        worker.postMessage({ buffer, fileName: file.name }, [buffer]);
      });
      if (!result.ok) throw new Error(result.error);
      const validSheets = result.sheetsData.filter(s => s.type !== '제외');
      if (!validSheets.length) throw new Error('유효한 시트가 없습니다.');
      const newRows = [];
      validSheets.forEach(sheet => {
        const h = sheet.headers;
        sheet.bodyRows.forEach(row => {
          const g = (...keys) => {
            for (const k of keys) { const idx = h.indexOf(k); if (idx >= 0 && row[idx] != null) return String(row[idx]).trim(); }
            return '';
          };
          const name = g('성명', '이름', '대상자명');
          if (!name) return;
          const phones = parsePhoneNumbers(g('연락처', '휴대폰'), g('전화번호', '유선'));
          newRows.push({
            name,
            birthKey: normalizeBirth(g('생년월일', '주민번호')),
            mobile: phones.mobile.replace(/[^0-9-]/g, ''),
            note: g('특이사항', '비고'),
          });
        });
      });
      await processNoteMatching(newRows);
    } catch (err) {
      console.error(err);
      alert('업로드 중 오류: ' + err.message);
      setUploading(false);
    }
  };

  // ── 특이사항 매칭 업데이트 ────────────────────────────────────────
  // 신규 명단에서 특이사항 있는 행만 추출 → 기존 기본명단과 매칭 → 특이사항만 업데이트
  // Phase 1: 생년월일 있는 행 → 이름+생년월일 매칭
  // Phase 2: 생년월일 없는 행 → 이름+휴대폰 매칭
  const processNoteMatching = async (newRows) => {
    const normPhone = (v) => (v || '').replace(/[^0-9]/g, '');

    // 특이사항 있는 행만
    const noteRows = newRows.filter(r => (r.note || '').trim());
    if (!noteRows.length) {
      alert('업로드한 파일에 특이사항이 있는 데이터가 없습니다.');
      setUploading(false);
      return;
    }

    const freshSnap = await getDocsFromServer(collection(db, `base_lists/${selectedCity}/records`));
    const currentRecs = freshSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    setRecords(currentRecs);

    const updates = [];
    const matchedIds = new Set(); // 한 레코드에 중복 매칭 방지

    // Phase 1: 생년월일 있는 행 → 이름+생년월일 매칭
    noteRows
      .filter(r => r.birthKey)
      .forEach(row => {
        const matched = currentRecs.find(r =>
          (r.name || r.이름 || '').trim() === row.name.trim() &&
          (r.birthKey || normalizeBirth(String(r.생년월일 || ''))) === row.birthKey
        );
        if (!matched || matchedIds.has(matched.id)) return;

        const existingNote = (matched.note || '').trim();
        const newNote = row.note.trim();
        // 이미 동일 내용이면 skip (중복)
        if (existingNote === newNote || existingNote.includes(newNote)) return;

        matchedIds.add(matched.id);
        updates.push({ id: matched.id, note: newNote });
      });

    // Phase 2: 생년월일 없는 행 → 이름+휴대폰 매칭
    noteRows
      .filter(r => !r.birthKey && normPhone(r.mobile).length >= 9)
      .forEach(row => {
        const rowPhone = normPhone(row.mobile);
        const matched = currentRecs.find(r => {
          if ((r.name || r.이름 || '').trim() !== row.name.trim()) return false;
          return normPhone(r.mobile || r.휴대폰 || '') === rowPhone;
        });
        if (!matched || matchedIds.has(matched.id)) return;

        const existingNote = (matched.note || '').trim();
        const newNote = row.note.trim();
        if (existingNote === newNote || existingNote.includes(newNote)) return;

        matchedIds.add(matched.id);
        updates.push({ id: matched.id, note: newNote });
      });

    await commitNoteUpdates(updates, noteRows.length);
  };

  const commitNoteUpdates = async (updates, totalNoteRows) => {
    try {
      if (!updates.length) {
        alert(`매칭되는 신규 특이사항이 없습니다.\n(특이사항 있는 행: ${totalNoteRows}건)`);
        return;
      }
      for (let i = 0; i < updates.length; i += 499) {
        const batch = writeBatch(db);
        updates.slice(i, i + 499).forEach(u =>
          batch.update(doc(db, `base_lists/${selectedCity}/records`, u.id), { note: u.note })
        );
        await batch.commit();
      }
      await setDoc(doc(db, 'base_lists', selectedCity), { updatedAt: serverTimestamp() }, { merge: true });
      alert(`특이사항 업데이트 완료!\n업데이트: ${updates.length}건 / 처리 대상: ${totalNoteRows}건`);
      await fetchRecords(selectedCity);
      await fetchStoredCities();
    } catch (e) { alert('DB 저장 오류: ' + e.message); }
    finally { setUploading(false); }
  };

  const handleAddHistory = async () => {
    if (!newHistoryNote.trim() || !historyRecord) return;
    const updated = { ...historyRecord };
    const entry = { date: new Date().toISOString().split('T')[0], note: newHistoryNote, author: user?.displayName || '관리자' };
    updated.history = [entry, ...(updated.history || [])];
    try {
      await setDoc(doc(db, `base_lists/${selectedCity}/records`, updated.id), updated, { merge: true });
      if (notifyManager) {
        await setDoc(doc(collection(db, 'notifications')), {
          type: 'HISTORY_ALERT', city: selectedCity, recordName: updated.name,
          note: newHistoryNote, author: user?.displayName || '관리자', createdAt: new Date(), read: false,
        });
        alert('담당자에게 알림이 전송되었습니다.');
      }
      setHistoryRecord(updated);
      setNewHistoryNote('');
      setNotifyManager(false);
      setRecords(prev => prev.map(r => r.id === updated.id ? updated : r));
    } catch { alert('이력 저장 오류'); }
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
          <Database size={17} className="text-blue-400 shrink-0" />
          <div>
            <h1 className="text-sm font-black text-white leading-tight">기본명단 관리</h1>
            <p className="text-[10px] text-gray-600 leading-tight">특이사항 매칭 · 조회 · 수정 · 삭제 · 다운로드</p>
          </div>
        </div>

        {selectedCity && hasCityAccess && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {hasChanges && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                {Object.keys(dirtyMap).length > 0 && `수정 ${Object.keys(dirtyMap).length}건`}
                {Object.keys(dirtyMap).length > 0 && deletedIds.size > 0 && ' · '}
                {deletedIds.size > 0 && `삭제 예정 ${deletedIds.size}건`}
              </div>
            )}
            <button onClick={handleSave} disabled={!hasChanges || saving}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                hasChanges && !saving ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_14px_rgba(59,130,246,0.25)]' : 'bg-white/5 text-gray-600 cursor-not-allowed'
              }`}>
              <Save size={13} /> {saving ? '저장 중...' : '변경사항 저장'}
            </button>
            {hasChanges && (
              <button onClick={() => { setDirtyMap({}); setDeletedIds(new Set()); setEditingCell(null); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] text-gray-500 hover:text-gray-300 bg-white/5 hover:bg-white/10 transition-colors">
                <RotateCcw size={12} /> 되돌리기
              </button>
            )}
            <button onClick={handleDownload} disabled={!displayRecords.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 hover:bg-white/10 text-gray-300 transition-colors border border-white/5 disabled:opacity-40">
              <Download size={13} /> xlsx 다운로드
            </button>
            <button onClick={() => setShowUpload(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors border ${
                showUpload ? 'bg-blue-900/30 text-blue-300 border-blue-500/30' : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/5'
              }`}>
              <Upload size={13} /> 엑셀 업로드
            </button>
            {records.length > 0 && (
              <button onClick={handleMovePhoneNumbers} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-400 border border-cyan-500/30 transition-colors disabled:opacity-40">
                <RefreshCw size={13} /> 전화번호 이동
              </button>
            )}
            {records.filter(r => !(r.note || '').trim()).length > 0 && (
              <button onClick={handleDeleteNoNote} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-500/30 transition-colors disabled:opacity-40">
                <Trash2 size={13} /> 특이사항없음 삭제
              </button>
            )}
            {records.length > 0 && (
              <button onClick={handleCleanGhosts} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-purple-950/40 hover:bg-purple-900/50 text-purple-400 border border-purple-500/30 transition-colors disabled:opacity-40">
                <X size={13} /> 유령 정리
              </button>
            )}
            {records.length > 0 && (
              <button onClick={handleDeleteAllRecords} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-500/30 transition-colors disabled:opacity-40">
                <Trash2 size={13} /> 전체 삭제
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT SIDEBAR ── */}
        <div className="w-64 shrink-0 border-r border-[#181818] flex flex-col bg-[#080808]">

          {/* 광역지자체 필터 */}
          <div className="shrink-0 p-4 border-b border-[#181818]">
            <p className="text-[10px] text-gray-600 font-bold mb-2.5 tracking-widest uppercase">광역지자체</p>
            <select
              value={filterSido}
              onChange={e => setFilterSido(e.target.value)}
              className="w-full bg-black border border-[#333] rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="">전체 보기</option>
              {availableSidos.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* 스크롤 영역: 카드 목록 + 현황 + 업로드 */}
          <div className="flex-1 overflow-y-auto">

            {/* 지자체 카드 목록 */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-[10px] text-gray-600 font-bold tracking-widest uppercase">
                  저장된 지자체
                  {filteredCities.length > 0 && <span className="text-gray-700 ml-1">({filteredCities.length})</span>}
                </p>
                <button onClick={fetchStoredCities} className="text-gray-700 hover:text-gray-400 transition-colors" title="새로고침">
                  <RefreshCw size={11} className={loadingCities ? 'animate-spin' : ''} />
                </button>
              </div>

              {loadingCities ? (
                <div className="flex items-center justify-center py-8 text-[11px] text-gray-700 animate-pulse">불러오는 중...</div>
              ) : filteredCities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-gray-800">
                  <Database size={24} className="opacity-30" />
                  <p className="text-[11px]">저장된 지자체가 없습니다</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredCities.map(c => {
                    const isSelected = selectedCity === c.id;
                    const hasAccess = isAdmin || citiesApproved.includes(c.id);
                    const req = userRequests[c.id];
                    const parts = c.id.trim().split(/\s+/);
                    const sidoName = parts[0] || c.id;
                    const sigunguName = parts.slice(1).join(' ') || c.id;
                    return (
                      // 외부 div: hover 그룹 — 선택 버튼과 삭제 버튼을 분리
                      <div key={c.id} className="relative group">
                        {/* 선택/토글 버튼 */}
                        <button
                          onClick={() => setSelectedCity(prev => prev === c.id ? '' : c.id)}
                          className={`w-full text-left p-3 border transition-all ${
                            isSelected
                              ? 'bg-[#0d1629] border-[#1e3358] shadow-[0_0_12px_rgba(59,130,246,0.1)] rounded-t-xl border-b-0'
                              : 'bg-black/20 border-[#1a1a1a] hover:bg-white/[0.03] hover:border-[#2a2a2a] rounded-xl'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 pr-4">
                            <div className="min-w-0">
                              <p className={`text-[13px] font-black leading-tight truncate ${isSelected ? 'text-white' : 'text-gray-400'}`}>
                                {sigunguName}
                              </p>
                              <p className="text-[10px] text-gray-700 mt-0.5">{sidoName}</p>
                            </div>
                            <div className="shrink-0 text-right">
                              {c.updatedAt && (
                                <p className={`text-[10px] font-bold ${isSelected ? 'text-blue-400' : 'text-gray-700'}`}>
                                  {fmtDate(c.updatedAt)}
                                </p>
                              )}
                              {!hasAccess && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block ${
                                  req?.status === 'pending' ? 'bg-amber-950/40 text-amber-500' : 'bg-gray-900 text-gray-600'
                                }`}>
                                  {req?.status === 'pending' ? '승인대기' : '미승인'}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>

                        {/* 아코디언: 현황 인라인 */}
                        {isSelected && (
                          <div className="bg-[#0a1220] border border-[#1e3358] border-t-0 rounded-b-xl">
                            {hasAccess ? (
                              <div className="p-3 space-y-1.5">
                                <div className="flex justify-between items-center">
                                  <span className="text-[11px] text-gray-600">전체 등록</span>
                                  <span className="text-[13px] font-black text-white">{records.length.toLocaleString()}건</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[11px] text-gray-600">특이사항 있음</span>
                                  <span className="text-[13px] font-black text-blue-400">{noteCount.toLocaleString()}건</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[11px] text-gray-600">검색 결과</span>
                                  <span className="text-[12px] font-bold text-gray-300">{displayRecords.length.toLocaleString()}건</span>
                                </div>
                                {records.length > 0 && noteCount < records.length && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-[11px] text-gray-700">특이사항 없음</span>
                                    <span className="text-[11px] font-bold text-gray-700">{(records.length - noteCount).toLocaleString()}건</span>
                                  </div>
                                )}
                                {deletedIds.size > 0 && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-[11px] text-red-500">삭제 예정</span>
                                    <span className="text-[12px] font-bold text-red-400">{deletedIds.size}건</span>
                                  </div>
                                )}
                                {lastUpdatedAt && (
                                  <div className="pt-1.5 border-t border-[#1a2e4a]">
                                    <p className="text-[10px] text-gray-700">마지막 업데이트</p>
                                    <p className="text-[11px] text-blue-400 font-bold">{lastUpdatedAt}</p>
                                  </div>
                                )}
                                {showUpload && (
                                  <div className="pt-2 border-t border-[#1a2e4a]">
                                    <p className="text-[10px] text-gray-600 font-bold mb-1 tracking-widest uppercase">특이사항 업데이트</p>
                                    <p className="text-[10px] text-gray-700 mb-2 leading-relaxed">
                                      특이사항 있는 행만 자동 매칭<br />
                                      <span className="text-gray-800">① 이름+생년월일 → ② 이름+휴대폰</span>
                                    </p>
                                    <label className={`w-full py-3 border-2 border-dashed border-[#2a2a2a] rounded-xl flex flex-col items-center gap-1.5 cursor-pointer hover:border-blue-500/40 hover:bg-blue-500/5 transition-all ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                      <Upload size={16} className="text-blue-400" />
                                      <span className="text-[11px] text-gray-400 font-bold">{uploading ? '처리 중...' : '신규 명단 파일 선택'}</span>
                                      <span className="text-[10px] text-gray-700">.xlsx / .xls</span>
                                      <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
                                    </label>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="p-3 flex flex-col items-center gap-2 text-center">
                                <AlertCircle size={16} className="text-amber-800/50" />
                                <p className="text-[10px] text-gray-700 leading-relaxed">접근 권한이 없습니다</p>
                                {(() => {
                                  if (req?.status === 'pending') return (
                                    <div className="flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-950/30 border border-amber-500/20 rounded-lg px-2 py-1">
                                      <Clock size={10} /> 승인 대기 중
                                    </div>
                                  );
                                  if (req?.status === 'rejected') return (
                                    <div className="flex flex-col gap-1.5 w-full">
                                      <p className="text-[10px] text-red-400 bg-red-950/30 border border-red-500/20 rounded-lg px-2 py-1">
                                        신청 거절{req.rejectedReason ? ` — ${req.rejectedReason}` : ''}
                                      </p>
                                      <button disabled={requestingCity} onClick={() => handleRequestCity(c.id)}
                                        className="text-[10px] text-blue-300 font-bold bg-blue-950/30 border border-blue-500/20 rounded-lg px-2 py-1 hover:bg-blue-950/50 disabled:opacity-50 transition-colors">
                                        {requestingCity ? '신청 중...' : '재신청하기'}
                                      </button>
                                    </div>
                                  );
                                  return (
                                    <button disabled={requestingCity} onClick={() => handleRequestCity(c.id)}
                                      className="w-full text-[10px] text-blue-300 font-bold bg-blue-950/30 border border-blue-500/20 rounded-lg px-2 py-1 hover:bg-blue-950/50 disabled:opacity-50 transition-colors">
                                      {requestingCity ? '신청 중...' : '접근 권한 신청하기'}
                                    </button>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 삭제 버튼 — hover 시 우상단에 표시 */}
                        <button
                          onClick={() => handleDeleteCity(c.id)}
                          disabled={saving}
                          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded-md text-gray-700 hover:text-red-400 hover:bg-red-950/40 transition-all disabled:pointer-events-none z-10"
                          title={`"${c.id}" 삭제`}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── MAIN PANEL ── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Search toolbar */}
          {selectedCity && hasCityAccess && (
            <div className="shrink-0 border-b border-[#181818] flex items-center px-4 gap-2.5 bg-[#080808] py-2 flex-wrap">
              <div className="relative w-56">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
                <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
                  placeholder="성명, 행정동, 연락처, 특이사항..."
                  className="w-full bg-black/70 border border-[#2a2a2a] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white outline-none focus:border-blue-500/50 placeholder:text-gray-700" />
                {searchText && (
                  <button onClick={() => setSearchText('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                    <X size={11} />
                  </button>
                )}
              </div>
              <select value={filterDong} onChange={e => setFilterDong(e.target.value)}
                className="bg-black/70 border border-[#2a2a2a] rounded-xl px-2.5 py-1.5 text-xs text-white outline-none focus:border-blue-500/50 cursor-pointer">
                <option value="">행정동 전체</option>
                {baseDongList.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <button
                onClick={() => setShowOnlyWithNote(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-colors ${
                  showOnlyWithNote
                    ? 'bg-amber-950/30 text-amber-400 border-amber-500/30'
                    : 'bg-white/5 text-gray-500 border-[#2a2a2a] hover:text-gray-300'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full inline-block ${showOnlyWithNote ? 'bg-amber-400' : 'bg-gray-700'}`} />
                특이사항 있는 것만
              </button>
              {(searchText || filterDong) && (
                <button onClick={() => { setSearchText(''); setFilterDong(''); }}
                  className="text-[10px] text-gray-600 hover:text-red-400 border border-[#2a2a2a] hover:border-red-700/40 rounded-lg px-2 py-1.5 transition-colors">
                  초기화
                </button>
              )}
              <span className="text-[11px] text-gray-600">
                {displayRecords.length.toLocaleString()}건 표시
                {records.length > 0 && ` (전체 ${records.length.toLocaleString()}건 중)`}
              </span>
              {!searchText && !filterDong && records.length > 0 && (
                <p className="text-[10px] text-gray-700 ml-auto">셀 클릭하여 직접 수정 · 행 끝 🗑 으로 삭제 표시</p>
              )}
            </div>
          )}

          {/* Table area */}
          <div className="flex-1 overflow-auto relative">
            {!selectedCity ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-700">
                <Database size={44} className="opacity-20" />
                <p className="text-sm">좌측에서 지자체를 선택하세요</p>
              </div>
            ) : !hasCityAccess ? (
              <div className="h-full flex flex-col items-center justify-center gap-4">
                <AlertCircle size={44} className="text-amber-800/30" />
                <p className="text-sm text-gray-700">이 지자체에 대한 접근 권한이 필요합니다</p>
              </div>
            ) : loading ? (
              <div className="h-full flex items-center justify-center gap-2 text-blue-400 text-sm animate-pulse">
                <Database size={18} /> 명단 불러오는 중...
              </div>
            ) : records.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-700">
                <FileSpreadsheet size={44} className="opacity-20" />
                <p className="text-sm">등록된 명단이 없습니다</p>
                <p className="text-xs text-gray-800">상단 "엑셀 업로드"로 명단을 추가하세요</p>
              </div>
            ) : displayRecords.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-700">
                <Search size={36} className="opacity-20" />
                <p className="text-sm">표시할 데이터가 없습니다</p>
                {showOnlyWithNote && noteCount === 0 && (
                  <p className="text-xs text-gray-800">특이사항 있는 레코드가 없습니다</p>
                )}
              </div>
            ) : (
              <table className="w-full border-collapse" style={{ minWidth: '700px' }}>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#0c0c0c] border-b border-[#1e1e1e]">
                    <th className="px-3 py-2.5 text-left text-[10px] text-gray-700 font-bold uppercase tracking-wider w-9">#</th>
                    {FIELDS.map(f => (
                      <th key={f.key} style={{ minWidth: f.minW }} className="px-3 py-2.5 text-left text-[10px] text-gray-600 font-bold uppercase tracking-wider">
                        {f.label}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-center text-[10px] text-gray-600 font-bold uppercase tracking-wider w-14">이력</th>
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {displayRecords.map((r, idx) => {
                    const isDirtyRow = !!dirtyMap[r.id];
                    return (
                      <tr key={r.id} className={`border-b border-[#111] transition-colors group ${
                        isDirtyRow ? 'bg-blue-950/10 hover:bg-blue-950/15' : 'hover:bg-white/[0.025]'
                      }`}>
                        <td className="px-3 py-2 text-[10px] text-gray-700">
                          <span className="flex items-center gap-1">
                            {isDirtyRow && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />}
                            {idx + 1}
                          </span>
                        </td>
                        {FIELDS.map(f => (
                          <td key={f.key} style={{ minWidth: f.minW }} className="px-3 py-2 max-w-0">
                            {renderCell(r, f.key)}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-center">
                          <button onClick={() => setHistoryRecord(records.find(x => x.id === r.id) || r)}
                            className="px-2 py-0.5 bg-white/5 hover:bg-white/10 text-gray-600 hover:text-gray-300 rounded text-[10px] transition-colors whitespace-nowrap">
                            📝 {r.history?.length || 0}
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          <button onClick={() => setDeletedIds(prev => new Set([...prev, r.id]))}
                            className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-700 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-all" title="삭제 예정 표시">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {deletedIds.size > 0 && (
              <div className="sticky bottom-0 bg-red-950/90 backdrop-blur border-t border-red-500/30 px-4 py-2 flex items-center gap-2 text-xs text-red-300">
                <Trash2 size={12} />
                <span>{deletedIds.size}건 삭제 예정 — "변경사항 저장"으로 확정하거나 "되돌리기"로 취소</span>
              </div>
            )}
          </div>
        </div>
      </div>


      {/* ═══ HISTORY MODAL ═══ */}
      {historyRecord && (
        <div className="absolute inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-2xl w-full max-w-lg max-h-[75vh] flex flex-col overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)]">
            <div className="p-4 border-b border-[#1e1e1e] flex justify-between items-center">
              <h2 className="font-bold text-white text-sm flex items-center gap-2">
                <span className="text-blue-400">📝</span> {historyRecord.name} 이력 타임라인
              </h2>
              <button onClick={() => setHistoryRecord(null)} className="text-gray-600 hover:text-white transition-colors">
                <X size={17} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              {historyRecord.history?.length > 0 ? (
                <div className="space-y-3">
                  {historyRecord.history.map((h, i) => (
                    <div key={i} className="border-l-2 border-blue-500/60 pl-4 py-0.5 relative">
                      <div className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-blue-500" />
                      <div className="text-[10px] text-gray-600 mb-0.5">{h.date} · {h.author}</div>
                      <div className="text-xs text-gray-200">{h.note}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-700 text-xs text-center py-8">기록된 이력이 없습니다.</p>
              )}
            </div>
            <div className="p-4 border-t border-[#1e1e1e] flex flex-col gap-2">
              <div className="flex gap-2">
                <input type="text" value={newHistoryNote} onChange={e => setNewHistoryNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddHistory()}
                  placeholder="새 이력 메모 입력..."
                  className="flex-1 bg-black border border-[#333] rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-blue-500" />
                <button onClick={handleAddHistory} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors">
                  추가
                </button>
              </div>
              <label className="flex items-center gap-2 text-[10px] text-gray-600 cursor-pointer hover:text-gray-400 transition-colors w-max">
                <input type="checkbox" checked={notifyManager} onChange={e => setNotifyManager(e.target.checked)} className="accent-blue-500" />
                저장 시 담당자에게 알림 전송
              </label>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
