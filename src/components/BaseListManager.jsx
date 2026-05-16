import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  db, collection, getDocs, getDocsFromServer, getDoc, setDoc, doc, deleteDoc, writeBatch, serverTimestamp, query, where
} from '../config/firebase.js';
import {
  Database, Upload, Trash2, ArrowLeft, AlertCircle, CheckCircle,
  Download, Search, Save, Clock, RotateCcw, FileSpreadsheet, X, RefreshCw, Layers, MapPin
} from 'lucide-react';

const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY;
import { normalizeBirth, parsePhoneNumbers } from '../utils/parsers.js';
import { REGIONS, getSigunguOptions } from '../utils/regions.js';

const FIELDS = [
  { key: 'name',     label: '성명',     minW: '90px'  },
  { key: 'birthKey', label: '생년월일', minW: '85px'  },
  { key: 'dong',     label: '행정동',   minW: '75px'  },
  { key: 'address',  label: '주소',     minW: '210px' },
  { key: 'mobile',   label: '휴대폰',   minW: '110px' },
  { key: 'landline', label: '유선전화', minW: '110px' },
  { key: 'driver',   label: '기사',     minW: '60px'  },
  { key: 'note',     label: '특이사항', minW: '140px' },
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

  // City selection — initialCity에서 시도/시군구 파싱
  const initParts = initialCity.trim().split(/\s+/);
  const [selectedSido, setSelectedSido] = useState(initParts[0] || '');
  const [selectedSigungu, setSelectedSigungu] = useState(initParts.slice(1).join(' ') || '');
  const selectedCity = selectedSido && selectedSigungu ? `${selectedSido} ${selectedSigungu}` : '';

  // Stored cities list (from base_lists collection)
  const [storedCities, setStoredCities] = useState([]);
  const [loadingCities, setLoadingCities] = useState(false);

  // Data
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [userRequests, setUserRequests] = useState({});
  const [requestingCity, setRequestingCity] = useState(false);

  // Inline edit state
  const [dirtyMap, setDirtyMap] = useState({});
  const [deletedIds, setDeletedIds] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // UI
  const [searchText, setSearchText] = useState('');
  const [showUpload, setShowUpload] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [targetMonth, setTargetMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [updateFields, setUpdateFields] = useState({
    birthKey: true, mobile: true, landline: true, dong: true,
    note: true, address: true, sms: true, driver: true, seqNo: true,
  });

  // Modals
  const [conflicts, setConflicts] = useState([]);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [dedupHolds, setDedupHolds] = useState([]); // 이름+행정동 일치 → 담당자 검토
  const [showDedupReview, setShowDedupReview] = useState(false);
  const [historyRecord, setHistoryRecord] = useState(null);
  const [newHistoryNote, setNewHistoryNote] = useState('');
  const [notifyManager, setNotifyManager] = useState(false);

  const hasCityAccess = isAdmin || citiesApproved.includes(selectedCity);

  const availableSidos = Object.keys(REGIONS);
  const availableSigungus = getSigunguOptions(selectedSido);

  // ── Derived display records ──────────────────────────────────────
  const displayRecords = useMemo(() => {
    return records
      .filter(r => !deletedIds.has(r.id))
      .map(r => ({ ...r, ...dirtyMap[r.id] }))
      .filter(r => {
        if (!searchText.trim()) return true;
        const q = searchText.toLowerCase();
        return [r.name, r.dong, r.address, r.mobile, r.note]
          .some(v => String(v || '').toLowerCase().includes(q));
      });
  }, [records, dirtyMap, deletedIds, searchText]);

  const hasChanges = Object.keys(dirtyMap).length > 0 || deletedIds.size > 0;

  // ── Effects ──────────────────────────────────────────────────────
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

  // ── Data fetching ─────────────────────────────────────────────────
  const fetchStoredCities = async () => {
    setLoadingCities(true);
    try {
      const snap = await getDocs(collection(db, 'base_lists'));
      setStoredCities(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => d.id && !d.id.startsWith('__'))
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

  // ── City access request ───────────────────────────────────────────
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

  // ── Inline editing ────────────────────────────────────────────────
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
          className="w-full bg-transparent text-white text-xs outline-none border-b border-green-400 py-0.5"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingCell(null); }}
        />
      );
    }
    const noteStr = String(val || '');
    if (field === 'note' && noteStr.includes('◆')) {
      const parts = noteStr.split(/(◆[^◆]*)/).filter(Boolean);
      return (
        <span
          title={noteStr}
          onClick={() => startEdit(id, field, val)}
          className={`cursor-text block truncate text-xs ${isDirty ? 'font-semibold' : ''}`}
        >
          {parts.map((p, i) => (
            <span key={i} className={p.startsWith('◆') ? 'text-amber-400' : isDirty ? 'text-green-300' : 'text-gray-300'}>{p}</span>
          ))}
        </span>
      );
    }
    return (
      <span
        title={noteStr}
        onClick={() => startEdit(id, field, val)}
        className={`cursor-text block truncate text-xs ${isDirty ? 'text-green-300 font-semibold' : 'text-gray-300'} ${!val ? 'text-gray-700' : ''}`}
      >
        {val || '—'}
      </span>
    );
  };

  // ── Save ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!hasChanges || saving) return;
    // 삭제 예정 레코드는 수정 목록에서 제외 (유령 데이터 방지)
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
          // update 사용: 문서가 없으면 실패 (set+merge는 없는 문서를 생성해 유령 데이터 유발)
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

  // ── Delete ALL records for this city ─────────────────────────────
  const handleDeleteAllRecords = async () => {
    if (!selectedCity || !hasCityAccess) return;
    if (!confirm(`⚠️ "${selectedCity}" 기본명단을 전체 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`)) return;
    setSaving(true);
    try {
      // 서버 최신 데이터로 삭제 — 메모리 상태가 스테일일 경우 누락 방지
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

  // ── 좌표 받아오기 (Kakao 지오코딩) ──────────────────────────────────
  const [isFetchingCoords, setIsFetchingCoords] = useState(false);
  const [coordProgress, setCoordProgress] = useState(null);
  const handleFetchCoords = async () => {
    if (!selectedCity || !hasCityAccess) return;
    const targets = records.filter(r => r.address && !r.lat && !r.lng);
    if (!targets.length) { alert('좌표가 없는 주소 데이터가 없습니다.'); return; }
    if (!window.confirm(`주소는 있지만 좌표가 없는 ${targets.length}건을 카카오 API로 조회합니다.\n계속하시겠습니까?`)) return;
    setIsFetchingCoords(true);
    setCoordProgress({ done: 0, total: targets.length });
    let successCount = 0;
    const updates = {};
    try {
      const concurrency = 10;
      const executing = new Set();
      for (const r of targets) {
        const p = (async () => {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 5000);
          try {
            const res = await fetch(
              `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(r.address)}&size=1`,
              { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` }, signal: controller.signal }
            );
            clearTimeout(tid);
            if (res.ok) {
              const data = await res.json();
              const d = data.documents?.[0];
              if (d?.x && d?.y) { updates[r.id] = { lat: parseFloat(d.y), lng: parseFloat(d.x) }; successCount++; }
            }
          } catch { clearTimeout(tid); }
          setCoordProgress(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
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
            batch.update(doc(db, `base_lists/${selectedCity}/records`, id), coord);
          });
          await batch.commit();
        }
        setRecords(prev => prev.map(r => updates[r.id] ? { ...r, ...updates[r.id] } : r));
      }
      alert(`✅ 좌표 보완 완료: ${successCount}/${targets.length}건 성공`);
    } catch (e) { alert('좌표 보완 실패: ' + e.message); }
    finally { setIsFetchingCoords(false); setCoordProgress(null); }
  };

  // ── Ghost record cleanup ──────────────────────────────────────────
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

  // ── Deduplicate ───────────────────────────────────────────────────
  const scoreRecord = (r) =>
    ['birthKey','mobile','landline','dong','address','note','driver','sms']
      .reduce((s, f) => s + (r[f] ? 1 : 0), 0);

  const handleDeduplicate = async () => {
    if (!selectedCity || !hasCityAccess || saving) return;
    if (!confirm(`"${selectedCity}" 기본명단 ${records.length.toLocaleString()}건에서 중복 데이터를 탐지합니다.\n계속하시겠습니까?`)) return;
    setSaving(true);
    try {
      const snap = await getDocsFromServer(collection(db, `base_lists/${selectedCity}/records`));
      const allRecs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const normPhone = (v) => (v || '').replace(/[^0-9-]/g, '');

      const processedIds = new Set();
      const autoDeleteIds = [];
      const mergeUpdates = []; // { id, note } — 살아남는 레코드 note append

      // ── Phase 1: 이름+생년월일 → 확정 중복, 자동 병합 ──────────────
      const birthGroups = {};
      allRecs.forEach(r => {
        const name = (r.name || '').trim();
        const birth = r.birthKey || normalizeBirth(String(r.생년월일 || ''));
        if (!name || !birth) return;
        const key = `${name}__${birth}`;
        (birthGroups[key] = birthGroups[key] || []).push(r);
      });
      Object.values(birthGroups).forEach(group => {
        if (group.length <= 1) return;
        const sorted = [...group].sort((a, b) => scoreRecord(b) - scoreRecord(a));
        const winner = sorted[0];
        const extraNotes = sorted.slice(1).map(r => (r.note || '').trim()).filter(Boolean);
        if (extraNotes.length > 0) {
          const allNotes = [(winner.note || '').trim(), ...extraNotes];
          const uniqueNotes = [...new Set(allNotes)].filter(Boolean);
          const merged = uniqueNotes.join(' ');
          if (merged !== (winner.note || '').trim()) {
            mergeUpdates.push({ id: winner.id, note: merged });
          }
        }
        sorted.slice(1).forEach(r => { autoDeleteIds.push(r.id); processedIds.add(r.id); });
        processedIds.add(winner.id);
      });

      // ── Phase 2: 이름+휴대폰(추가연락처) → 확정 중복, 자동 병합 ────
      const phoneGroups = {};
      allRecs.forEach(r => {
        if (processedIds.has(r.id)) return;
        const name = (r.name || '').trim();
        const mobile = normPhone(r.mobile || '');
        const land   = normPhone(r.landline || '');
        if (!name) return;
        if (mobile.length >= 9) {
          const key = `m:${name}__${mobile}`;
          (phoneGroups[key] = phoneGroups[key] || []).push(r);
        } else if (land.length >= 9) {
          const key = `l:${name}__${land}`;
          (phoneGroups[key] = phoneGroups[key] || []).push(r);
        }
      });
      Object.values(phoneGroups).forEach(group => {
        if (group.length <= 1) return;
        const sorted = [...group].sort((a, b) => scoreRecord(b) - scoreRecord(a));
        const winner = sorted[0];
        const extraNotes = sorted.slice(1).map(r => (r.note || '').trim()).filter(Boolean);
        if (extraNotes.length > 0) {
          const allNotes = [(winner.note || '').trim(), ...extraNotes];
          const uniqueNotes = [...new Set(allNotes)].filter(Boolean);
          const merged = uniqueNotes.join(' ');
          if (merged !== (winner.note || '').trim()) {
            mergeUpdates.push({ id: winner.id, note: merged });
          }
        }
        sorted.slice(1).forEach(r => { autoDeleteIds.push(r.id); processedIds.add(r.id); });
        processedIds.add(winner.id);
      });

      // ── Phase 3: 이름+행정동 → 불확실, 담당자 검토 보류 ────────────
      const dongGroups = {};
      allRecs.forEach(r => {
        if (processedIds.has(r.id)) return;
        const name = (r.name || '').trim();
        const dong = (r.dong || '').trim();
        if (!name || !dong) return;
        const key = `${name}__${dong}`;
        (dongGroups[key] = dongGroups[key] || []).push(r);
      });
      const holdGroups = Object.values(dongGroups).filter(g => g.length > 1);

      // 확정 중복 자동 정리 (note 병합 업데이트 → 삭제)
      if (autoDeleteIds.length > 0 || mergeUpdates.length > 0) {
        for (let i = 0; i < mergeUpdates.length; i += 499) {
          const batch = writeBatch(db);
          mergeUpdates.slice(i, i + 499).forEach(u =>
            batch.set(doc(db, `base_lists/${selectedCity}/records`, u.id), { note: u.note }, { merge: true })
          );
          await batch.commit();
        }
        for (let i = 0; i < autoDeleteIds.length; i += 499) {
          const batch = writeBatch(db);
          autoDeleteIds.slice(i, i + 499).forEach(id =>
            batch.delete(doc(db, `base_lists/${selectedCity}/records`, id))
          );
          await batch.commit();
        }
        await setDoc(doc(db, 'base_lists', selectedCity), { updatedAt: serverTimestamp() }, { merge: true });
      }

      if (holdGroups.length > 0) {
        await fetchRecords(selectedCity);
        setDedupHolds(holdGroups.map(group => ({ group, decision: null })));
        setShowDedupReview(true);
        if (autoDeleteIds.length > 0) {
          alert(
            `확정 중복 ${autoDeleteIds.length}건 자동 정리 완료!\n\n` +
            `이름+행정동이 동일한 ${holdGroups.length}개 그룹(` +
            `${holdGroups.reduce((s, g) => s + g.length, 0)}건)은 담당자 확인이 필요합니다.`
          );
        }
      } else {
        await fetchRecords(selectedCity);
        await fetchStoredCities();
        if (autoDeleteIds.length > 0) {
          alert(`✅ 중복 정리 완료!\n확정 중복 삭제: ${autoDeleteIds.length}건\n검토 필요: 없음`);
        } else {
          alert(`중복 데이터가 없습니다!\n전체 ${allRecs.length.toLocaleString()}건 모두 고유합니다.`);
        }
      }
    } catch (e) {
      alert('중복 정리 오류: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Dedup review 결정 적용 ────────────────────────────────────────
  const handleDedupReviewSubmit = async () => {
    const unresolved = dedupHolds.filter(h => h.decision === null).length;
    if (unresolved > 0) {
      if (!confirm(`${unresolved}개 그룹이 아직 미결정입니다.\n미결정 항목은 모두 "유지"로 처리됩니다. 계속하시겠습니까?`)) return;
    }
    const toDelete = [];
    dedupHolds.forEach(hold => {
      if (hold.decision !== 'merge') return;
      const sorted = [...hold.group].sort((a, b) => scoreRecord(b) - scoreRecord(a));
      sorted.slice(1).forEach(r => toDelete.push(r.id));
    });

    setSaving(true);
    try {
      if (toDelete.length > 0) {
        for (let i = 0; i < toDelete.length; i += 499) {
          const batch = writeBatch(db);
          toDelete.slice(i, i + 499).forEach(id =>
            batch.delete(doc(db, `base_lists/${selectedCity}/records`, id))
          );
          await batch.commit();
        }
        await setDoc(doc(db, 'base_lists', selectedCity), { updatedAt: serverTimestamp() }, { merge: true });
      }
      setShowDedupReview(false);
      setDedupHolds([]);
      await fetchRecords(selectedCity);
      await fetchStoredCities();
      alert(
        toDelete.length > 0
          ? `✅ 검토 완료!\n병합 삭제: ${toDelete.length}건`
          : '검토 완료! 모든 항목을 유지합니다.'
      );
    } catch (e) {
      alert('병합 오류: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Download ──────────────────────────────────────────────────────
  const handleDownload = () => {
    if (!displayRecords.length) return alert('다운로드할 데이터가 없습니다.');
    const data = displayRecords.map((r, i) => ({
      번호: i + 1,
      성명: r.name || '',
      생년월일: r.birthKey || '',
      행정동: r.dong || '',
      주소: r.address || '',
      휴대폰: r.mobile || '',
      유선전화: r.landline || '',
      문자수신: r.sms || '',
      기사: r.driver || '',
      배송순번: r.seqNo || '',
      특이사항: r.note || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    // 컬럼 너비 자동 조정
    const colWidths = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length, 10) }));
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '기본명단');
    const today = new Date();
    const ds = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    XLSX.writeFile(wb, `${selectedCity}_기본명단_${ds}.xlsx`, { bookType: 'xlsx', type: 'binary', compression: true });
  };

  // ── File upload ───────────────────────────────────────────────────
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
            dong: g('행정동', '읍면동'),
            note: g('특이사항', '비고'),
            address: g('주소', '거주지'),
            sms: g('문자수신여부', '문자'),
            driver: g('기사', '담당기사'),
            seqNo: parseInt(g('배송순번', '순번') || '0') || 0,
            birthKey: normalizeBirth(g('생년월일', '주민번호')),
            mobile: phones.mobile.replace(/[^0-9-]/g, ''),
            landline: phones.landline.replace(/[^0-9-]/g, ''),
          });
        });
      });
      await processMatching(newRows);
    } catch (err) {
      console.error(err);
      alert('업로드 중 오류: ' + err.message);
      setUploading(false);
    }
  };

  const processMatching = async (newRows) => {
    // 유령 레코드 방지: 메모리 상태 대신 서버 최신 데이터로 매칭
    const freshSnap = await getDocsFromServer(collection(db, `base_lists/${selectedCity}/records`));
    const currentRecs = freshSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    setRecords(currentRecs);

    const updates = [], adds = [], newConflicts = [];
    // 구버전(한국어 키) + 신버전(영문 키) 양쪽에서 값 추출하는 헬퍼
    const rName  = (r) => (r.name  || r.이름     || '').trim();
    const rBirth = (r) => (r.birthKey || normalizeBirth(String(r.생년월일 || '')));
    const rPhone = (r) => (r.mobile || r.휴대폰 || '').replace(/[^0-9-]/g, '');
    const rLand  = (r) => (r.landline || r.유선전화 || '').replace(/[^0-9-]/g, '');
    const rDong  = (r) => (r.dong  || r.행정동   || '');

    newRows.forEach(row => {
      let matched = null, possibleMatches = [];
      if (row.birthKey) matched = currentRecs.find(r => rName(r) === row.name && rBirth(r) === row.birthKey);
      if (!matched && row.mobile?.length >= 9) matched = currentRecs.find(r => rName(r) === row.name && rPhone(r) === row.mobile);
      if (!matched && row.landline?.length >= 9) matched = currentRecs.find(r => rName(r) === row.name && rLand(r) === row.landline);
      if (!matched && row.dong) {
        possibleMatches = currentRecs.filter(r => rName(r) === row.name && rDong(r) === row.dong);
        if (possibleMatches.length > 0) {
          const isDiff = possibleMatches.every(p => p.mobile && row.mobile && p.mobile !== row.mobile && p.landline && row.landline && p.landline !== row.landline);
          if (isDiff) possibleMatches = [];
          else if (possibleMatches.length === 1) matched = possibleMatches[0];
          else { newConflicts.push({ newRow: row, existingRows: possibleMatches, resolved: false, selectedId: null }); return; }
        }
      }
      if (matched) {
        let changed = false;
        const updatedData = {};
        ['birthKey', 'mobile', 'landline', 'dong', 'note', 'address', 'sms', 'driver', 'seqNo'].forEach(key => {
          if (updateFields[key] && row[key] !== undefined && row[key] !== matched[key]) { updatedData[key] = row[key]; changed = true; }
        });
        const months = matched.months || [];
        if (!months.includes(targetMonth)) { months.push(targetMonth); changed = true; }
        if (changed) updates.push({ ...matched, ...updatedData, id: matched.id, months });
      } else if (!possibleMatches.length) {
        adds.push({ ...row, months: [targetMonth], history: [{ date: new Date().toISOString().split('T')[0], note: `[${targetMonth}] 초기 등록`, author: user?.displayName || '관리자' }] });
      }
    });
    if (newConflicts.length) { setConflicts(newConflicts); setShowConflictModal(true); }
    else await commitBatch(adds, updates);
  };

  const commitBatch = async (adds, updates) => {
    try {
      // 500건 제한 분할 처리
      const allOps = [
        ...adds.map(a => ({ type: 'add', data: a })),
        ...updates.map(u => ({ type: 'update', data: u })),
      ];
      for (let i = 0; i < allOps.length; i += 499) {
        const batch = writeBatch(db);
        allOps.slice(i, i + 499).forEach(op => {
          if (op.type === 'add') {
            const rRef = doc(collection(db, `base_lists/${selectedCity}/records`));
            batch.set(rRef, { ...op.data, id: rRef.id });
          } else {
            batch.set(doc(db, `base_lists/${selectedCity}/records`, op.data.id), op.data, { merge: true });
          }
        });
        await batch.commit();
      }
      await setDoc(doc(db, 'base_lists', selectedCity), { city: selectedCity, updatedAt: serverTimestamp(), author: user.uid }, { merge: true });
      alert(`명단 업데이트 완료! (신규: ${adds.length}건, 업데이트: ${updates.length}건)`);
      await fetchRecords(selectedCity);
      await fetchStoredCities();
    } catch (e) { alert('DB 저장 오류: ' + e.message); }
    finally { setUploading(false); setShowConflictModal(false); }
  };

  // ── History ───────────────────────────────────────────────────────
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

  // ── City status badge ─────────────────────────────────────────────
  const renderCityStatus = () => {
    if (!selectedCity) return null;
    if (hasCityAccess) return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-green-400 font-bold">
        <CheckCircle size={11} /> 접근 승인됨
      </div>
    );
    const req = userRequests[selectedCity];
    if (req?.status === 'pending') return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-950/30 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
        <Clock size={11} /> 승인 대기 중
      </div>
    );
    if (req?.status === 'rejected') return (
      <div className="mt-2 flex flex-col gap-1.5">
        <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-500/20 rounded-lg px-2.5 py-1.5">
          신청 거절{req.rejectedReason ? ` — ${req.rejectedReason}` : ''}
        </p>
        <button disabled={requestingCity} onClick={() => handleRequestCity(selectedCity)}
          className="text-[11px] text-blue-300 font-bold bg-blue-950/30 border border-blue-500/20 rounded-lg px-2.5 py-1.5 hover:bg-blue-950/50 disabled:opacity-50 transition-colors">
          {requestingCity ? '신청 중...' : '재신청하기'}
        </button>
      </div>
    );
    return (
      <button disabled={requestingCity} onClick={() => handleRequestCity(selectedCity)}
        className="mt-2 w-full text-[11px] text-blue-300 font-bold bg-blue-950/30 border border-blue-500/20 rounded-lg px-2.5 py-1.5 hover:bg-blue-950/50 disabled:opacity-50 transition-colors">
        {requestingCity ? '신청 중...' : '접근 권한 신청하기'}
      </button>
    );
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
          <Database size={17} className="text-green-400 shrink-0" />
          <div>
            <h1 className="text-sm font-black text-white leading-tight">기본명단 관리</h1>
            <p className="text-[10px] text-gray-600 leading-tight">지자체별 대상자 기본 이력 조회 · 수정 · 삭제 · 다운로드</p>
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
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                hasChanges && !saving
                  ? 'bg-green-600 hover:bg-green-500 text-white shadow-[0_0_14px_rgba(34,197,94,0.25)]'
                  : 'bg-white/5 text-gray-600 cursor-not-allowed'
              }`}
            >
              <Save size={13} /> {saving ? '저장 중...' : '변경사항 저장'}
            </button>
            {hasChanges && (
              <button
                onClick={() => { setDirtyMap({}); setDeletedIds(new Set()); setEditingCell(null); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] text-gray-500 hover:text-gray-300 bg-white/5 hover:bg-white/10 transition-colors"
              >
                <RotateCcw size={12} /> 되돌리기
              </button>
            )}
            <button
              onClick={handleDownload}
              disabled={!displayRecords.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white/5 hover:bg-white/10 text-gray-300 transition-colors border border-white/5 disabled:opacity-40"
            >
              <Download size={13} /> xlsx 다운로드
            </button>
            <button
              onClick={() => setShowUpload(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors border ${
                showUpload ? 'bg-green-900/30 text-green-300 border-green-500/30' : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/5'
              }`}
            >
              <Upload size={13} /> 엑셀 업로드
            </button>
            {records.length > 0 && (
              <button
                onClick={handleDeduplicate}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-orange-950/40 hover:bg-orange-900/50 text-orange-400 border border-orange-500/30 transition-colors disabled:opacity-40"
              >
                <Layers size={13} /> 중복 정리
              </button>
            )}
            {records.length > 0 && (
              <button
                onClick={handleFetchCoords}
                disabled={saving || isFetchingCoords}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-blue-950/40 hover:bg-blue-900/50 text-blue-400 border border-blue-500/30 transition-colors disabled:opacity-40"
              >
                {isFetchingCoords ? <RefreshCw size={13} className="animate-spin" /> : <MapPin size={13} />}
                {isFetchingCoords ? (coordProgress ? `${coordProgress.done}/${coordProgress.total}건` : '준비중...') : '좌표 받아오기'}
              </button>
            )}
            <button
              onClick={handleCleanGhosts}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-purple-950/40 hover:bg-purple-900/50 text-purple-400 border border-purple-500/30 transition-colors disabled:opacity-40"
            >
              <X size={13} /> 유령 정리
            </button>
            {records.length > 0 && (
              <button
                onClick={handleDeleteAllRecords}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-500/30 transition-colors disabled:opacity-40"
              >
                <Trash2 size={13} /> 전체 삭제
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT SIDEBAR ── */}
        <div className="w-60 shrink-0 border-r border-[#181818] flex flex-col bg-[#080808] overflow-y-auto">

          {/* City selector */}
          <div className="p-4 border-b border-[#181818]">
            <p className="text-[10px] text-gray-600 font-bold mb-2.5 tracking-widest uppercase">지자체 선택</p>
            <div className="flex flex-col gap-2">
              <select
                value={selectedSido}
                onChange={e => { setSelectedSido(e.target.value); setSelectedSigungu(''); }}
                className="w-full bg-black border border-[#333] rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-green-500 cursor-pointer"
              >
                <option value="">시/도 선택</option>
                {availableSidos.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={selectedSigungu}
                onChange={e => setSelectedSigungu(e.target.value)}
                disabled={!selectedSido}
                className="w-full bg-black border border-[#333] rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-green-500 disabled:opacity-40 cursor-pointer"
              >
                <option value="">시/군/구 선택</option>
                {availableSigungus.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {renderCityStatus()}
          </div>

          {/* Stored cities quick-select */}
          <div className="p-4 border-b border-[#181818]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-gray-600 font-bold tracking-widest uppercase">저장된 지자체</p>
              <button onClick={fetchStoredCities} className="text-gray-700 hover:text-gray-400 transition-colors" title="새로고침">
                <RefreshCw size={11} className={loadingCities ? 'animate-spin' : ''} />
              </button>
            </div>
            {loadingCities ? (
              <p className="text-[10px] text-gray-700 animate-pulse">불러오는 중...</p>
            ) : storedCities.length === 0 ? (
              <p className="text-[10px] text-gray-800">저장된 지자체가 없습니다</p>
            ) : (
              <div className="space-y-1">
                {storedCities.map(c => (
                  <button
                    key={c.id}
                    onClick={() => {
                      const parts = c.id.trim().split(/\s+/);
                      setSelectedSido(parts[0] || '');
                      setSelectedSigungu(parts.slice(1).join(' ') || '');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-between gap-1 ${
                      selectedCity === c.id
                        ? 'bg-green-900/30 text-green-300 border border-green-500/30'
                        : 'bg-black/30 text-gray-500 hover:bg-white/5 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    <span className="truncate">{c.id}</span>
                    {c.updatedAt && (
                      <span className="text-[9px] text-gray-700 shrink-0">{fmtDate(c.updatedAt)}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Stats */}
          {selectedCity && hasCityAccess && (
            <div className="p-4 border-b border-[#181818]">
              <p className="text-[10px] text-gray-600 font-bold mb-3 tracking-widest uppercase">현황</p>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-gray-600">전체 등록</span>
                  <span className="text-sm font-black text-white">{records.length.toLocaleString()}건</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-gray-600">검색 결과</span>
                  <span className="text-sm font-bold text-green-400">{displayRecords.length.toLocaleString()}건</span>
                </div>
                {records.length > 0 && (() => {
                  const withCoord = records.filter(r => r.lat && r.lng).length;
                  const noCoord = records.filter(r => r.address && !r.lat && !r.lng).length;
                  const pct = records.length > 0 ? Math.round(withCoord / records.length * 100) : 0;
                  const noPct = records.length > 0 ? Math.round(noCoord / records.length * 100) : 0;
                  return (
                    <div className="pt-2 border-t border-[#1a1a1a] mt-1 space-y-1.5">
                      <p className="text-[10px] text-gray-600 font-bold mb-1">좌표 현황</p>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-gray-600">좌표 있음</span>
                        <span className="text-[11px] font-bold text-[#22c55e]">{withCoord.toLocaleString()}건 ({pct}%)</span>
                      </div>
                      <div className="w-full bg-[#1a1a1a] rounded-full h-1.5 overflow-hidden">
                        <div className="h-full rounded-full bg-[#22c55e]" style={{ width: `${pct}%` }} />
                      </div>
                      {noCoord > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-red-400">좌표 없음</span>
                          <span className="text-[11px] font-bold text-red-400">{noCoord.toLocaleString()}건 ({noPct}%)</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {deletedIds.size > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-red-500">삭제 예정</span>
                    <span className="text-sm font-bold text-red-400">{deletedIds.size}건</span>
                  </div>
                )}
                {lastUpdatedAt && (
                  <div className="pt-2 border-t border-[#1a1a1a] mt-2">
                    <p className="text-[10px] text-gray-600 mb-1">마지막 업데이트</p>
                    <p className="text-[11px] text-green-400 font-bold">{lastUpdatedAt}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Upload panel */}
          {selectedCity && hasCityAccess && showUpload && (
            <div className="p-4 border-b border-[#181818]">
              <p className="text-[10px] text-gray-600 font-bold mb-3 tracking-widest uppercase">월별 업로드</p>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-gray-600 block mb-1">업데이트 대상 월</label>
                  <input
                    type="month" value={targetMonth}
                    onChange={e => setTargetMonth(e.target.value)}
                    className="w-full bg-black border border-[#333] rounded-lg px-2.5 py-1.5 text-white text-xs outline-none focus:border-green-500"
                  />
                </div>
                <div>
                  <p className="text-[10px] text-gray-600 mb-2">갱신 허용 항목</p>
                  <div className="grid grid-cols-2 gap-y-1.5 gap-x-2">
                    {[
                      { k: 'birthKey', l: '생년월일' }, { k: 'mobile', l: '휴대폰' },
                      { k: 'landline', l: '유선전화' }, { k: 'dong', l: '행정동' },
                      { k: 'note', l: '특이사항' }, { k: 'address', l: '주소' },
                      { k: 'sms', l: '문자수신' }, { k: 'driver', l: '기사' },
                    ].map(({ k, l }) => (
                      <label key={k} className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer hover:text-gray-300 transition-colors">
                        <input type="checkbox" checked={updateFields[k]}
                          onChange={e => setUpdateFields(p => ({ ...p, [k]: e.target.checked }))}
                          className="accent-green-500 w-3 h-3" />
                        {l}
                      </label>
                    ))}
                  </div>
                </div>
                <label className={`w-full py-3 border-2 border-dashed border-[#2a2a2a] rounded-xl flex flex-col items-center gap-1.5 cursor-pointer hover:border-green-500/40 hover:bg-green-500/5 transition-all ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <Upload size={16} className="text-green-400" />
                  <span className="text-[11px] text-gray-400 font-bold">{uploading ? '처리 중...' : '파일 선택 (.xlsx/.xls)'}</span>
                  <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
            </div>
          )}

          {!selectedCity && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
              <Database size={30} className="text-gray-800" />
              <p className="text-[11px] text-gray-700 leading-relaxed">시/도와 시/군/구를 선택하거나<br />위 목록에서 지자체를 클릭하세요</p>
            </div>
          )}
          {selectedCity && !hasCityAccess && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
              <AlertCircle size={28} className="text-amber-800/50" />
              <p className="text-[11px] text-gray-700 leading-relaxed">이 지자체에 대한<br />접근 권한이 없습니다</p>
            </div>
          )}
        </div>

        {/* ── MAIN PANEL ── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Search toolbar */}
          {selectedCity && hasCityAccess && (
            <div className="h-11 shrink-0 border-b border-[#181818] flex items-center px-4 gap-3 bg-[#080808]">
              <div className="relative w-72">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
                <input
                  type="text" value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder="성명, 행정동, 주소, 연락처 검색..."
                  className="w-full bg-black/70 border border-[#2a2a2a] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white outline-none focus:border-green-500/50 placeholder:text-gray-700"
                />
                {searchText && (
                  <button onClick={() => setSearchText('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                    <X size={11} />
                  </button>
                )}
              </div>
              <span className="text-[11px] text-gray-600">
                {displayRecords.length.toLocaleString()}건 표시
                {searchText && ` (전체 ${records.length.toLocaleString()}건 중)`}
              </span>
              {!searchText && records.length > 0 && (
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
              <div className="h-full flex items-center justify-center gap-2 text-green-400 text-sm animate-pulse">
                <Database size={18} /> 명단 불러오는 중...
              </div>
            ) : records.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-700">
                <FileSpreadsheet size={44} className="opacity-20" />
                <p className="text-sm">등록된 명단이 없습니다</p>
                <p className="text-xs text-gray-800">우측 상단 "엑셀 업로드"로 명단을 추가하세요</p>
              </div>
            ) : displayRecords.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-700">
                <Search size={36} className="opacity-20" />
                <p className="text-sm">검색 결과가 없습니다</p>
              </div>
            ) : (
              <table className="w-full border-collapse" style={{ minWidth: '900px' }}>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#0c0c0c] border-b border-[#1e1e1e]">
                    <th className="px-3 py-2.5 text-left text-[10px] text-gray-700 font-bold uppercase tracking-wider w-9 shrink-0">#</th>
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
                      <tr
                        key={r.id}
                        className={`border-b border-[#111] transition-colors group ${
                          isDirtyRow ? 'bg-green-950/10 hover:bg-green-950/15' : 'hover:bg-white/[0.025]'
                        }`}
                      >
                        <td className="px-3 py-2 text-[10px] text-gray-700 shrink-0">
                          <span className="flex items-center gap-1">
                            {isDirtyRow && <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />}
                            {idx + 1}
                          </span>
                        </td>
                        {FIELDS.map(f => (
                          <td key={f.key} style={{ minWidth: f.minW }} className="px-3 py-2 max-w-0">
                            {renderCell(r, f.key)}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-center">
                          <button
                            onClick={() => setHistoryRecord(records.find(x => x.id === r.id) || r)}
                            className="px-2 py-0.5 bg-white/5 hover:bg-white/10 text-gray-600 hover:text-gray-300 rounded text-[10px] transition-colors whitespace-nowrap"
                          >
                            📝 {r.history?.length || 0}
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          <button
                            onClick={() => setDeletedIds(prev => new Set([...prev, r.id]))}
                            className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-700 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-all"
                            title="삭제 예정 표시"
                          >
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

      {/* ═══ DEDUP REVIEW MODAL ═══ */}
      {showDedupReview && dedupHolds.length > 0 && (
        <div className="absolute inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#0e0e0e] border border-orange-500/30 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.9)]">
            {/* 헤더 */}
            <div className="p-5 border-b border-[#1e1e1e] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="text-orange-400 shrink-0" size={18} />
                <div>
                  <h2 className="font-black text-orange-400 text-sm">이름+행정동 일치 — 담당자 검토 필요</h2>
                  <p className="text-[11px] text-gray-600 mt-0.5">
                    동일인인지 별개 인물인지 판단해 주세요 ·{' '}
                    <span className="text-orange-300 font-bold">
                      {dedupHolds.filter(h => h.decision !== null).length} / {dedupHolds.length}건 결정됨
                    </span>
                  </p>
                </div>
              </div>
              <button onClick={() => { setShowDedupReview(false); setDedupHolds([]); }}
                className="text-gray-600 hover:text-white transition-colors p-1">
                <X size={17} />
              </button>
            </div>

            {/* 그룹 목록 */}
            <div className="flex-1 overflow-auto p-5 space-y-4">
              {dedupHolds.map((hold, idx) => {
                const rep = hold.group[0];
                return (
                  <div key={idx} className={`rounded-xl border p-4 transition-all ${
                    hold.decision === 'merge' ? 'border-red-500/40 bg-red-950/10' :
                    hold.decision === 'keep'  ? 'border-green-500/30 bg-green-950/10' :
                    'border-orange-500/20 bg-black/40'
                  }`}>
                    {/* 그룹 헤더 */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-orange-400 bg-orange-950/40 border border-orange-500/20 rounded px-1.5 py-0.5">
                          그룹 {idx + 1}
                        </span>
                        <span className="text-white font-black text-sm">{rep.name}</span>
                        <span className="text-gray-500 text-xs">{rep.dong} · {hold.group.length}건</span>
                      </div>
                      {/* 결정 버튼 */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setDedupHolds(prev => prev.map((h, i) => i === idx ? { ...h, decision: 'merge' } : h))}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                            hold.decision === 'merge'
                              ? 'bg-red-600 text-white'
                              : 'bg-red-950/40 text-red-400 border border-red-500/30 hover:bg-red-900/50'
                          }`}
                        >
                          동일인 → 병합
                        </button>
                        <button
                          onClick={() => setDedupHolds(prev => prev.map((h, i) => i === idx ? { ...h, decision: 'keep' } : h))}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                            hold.decision === 'keep'
                              ? 'bg-green-700 text-white'
                              : 'bg-green-950/40 text-green-400 border border-green-500/30 hover:bg-green-900/50'
                          }`}
                        >
                          별개 인물 → 유지
                        </button>
                      </div>
                    </div>
                    {/* 레코드 카드들 */}
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(hold.group.length, 3)}, 1fr)` }}>
                      {hold.group.map((r, ri) => (
                        <div key={r.id} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3 text-[11px] space-y-1">
                          <p className="text-[10px] text-gray-600 font-bold mb-1.5">레코드 {ri + 1}</p>
                          {[
                            { label: '생년월일', val: r.birthKey },
                            { label: '휴대폰',   val: r.mobile },
                            { label: '유선전화', val: r.landline },
                            { label: '주소',     val: r.address },
                            { label: '특이사항', val: r.note },
                          ].map(({ label, val }) => (
                            <div key={label} className="flex gap-1.5">
                              <span className="text-gray-700 w-14 shrink-0">{label}</span>
                              <span className={val ? 'text-gray-300' : 'text-gray-800'}>
                                {val || '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    {hold.decision === 'merge' && (
                      <p className="mt-2 text-[10px] text-red-400">
                        ⚠ 데이터가 가장 많은 레코드 1건만 남기고 나머지 {hold.group.length - 1}건을 삭제합니다.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 푸터 */}
            <div className="p-4 border-t border-[#1e1e1e] flex items-center justify-between gap-3">
              <p className="text-[11px] text-gray-600">
                미결정 항목은 자동으로 <span className="text-green-400 font-bold">유지</span>로 처리됩니다
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDedupHolds(prev => prev.map(h => ({ ...h, decision: 'keep' })))}
                  className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl text-xs font-bold hover:bg-white/10 transition-colors"
                >
                  전부 유지
                </button>
                <button
                  onClick={handleDedupReviewSubmit}
                  disabled={saving}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
                >
                  {saving ? '처리 중...' : '검토 완료 · 적용'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ HISTORY MODAL ═══ */}
      {historyRecord && (
        <div className="absolute inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-2xl w-full max-w-lg max-h-[75vh] flex flex-col overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)]">
            <div className="p-4 border-b border-[#1e1e1e] flex justify-between items-center">
              <h2 className="font-bold text-white text-sm flex items-center gap-2">
                <span className="text-green-400">📝</span> {historyRecord.name} 이력 타임라인
              </h2>
              <button onClick={() => setHistoryRecord(null)} className="text-gray-600 hover:text-white transition-colors">
                <X size={17} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              {historyRecord.history?.length > 0 ? (
                <div className="space-y-3">
                  {historyRecord.history.map((h, i) => (
                    <div key={i} className="border-l-2 border-green-500/60 pl-4 py-0.5 relative">
                      <div className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-green-500" />
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
                <input
                  type="text" value={newHistoryNote}
                  onChange={e => setNewHistoryNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddHistory()}
                  placeholder="새 이력 메모 입력..."
                  className="flex-1 bg-black border border-[#333] rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-green-500"
                />
                <button onClick={handleAddHistory} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl text-xs transition-colors">
                  추가
                </button>
              </div>
              <label className="flex items-center gap-2 text-[10px] text-gray-600 cursor-pointer hover:text-gray-400 transition-colors w-max">
                <input type="checkbox" checked={notifyManager} onChange={e => setNotifyManager(e.target.checked)} className="accent-green-500" />
                저장 시 담당자에게 알림 전송
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CONFLICT MODAL ═══ */}
      {showConflictModal && conflicts.length > 0 && (
        <div className="absolute inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)]">
            <div className="p-5 border-b border-[#1e1e1e] flex items-center gap-2.5">
              <AlertCircle className="text-amber-400 shrink-0" size={18} />
              <h2 className="font-black text-amber-400 text-base">
                동명이인 충돌 해결 ({conflicts.filter(c => !c.resolved).length}건 남음)
              </h2>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-5">
              {conflicts.map((conflict, idx) => {
                if (conflict.resolved) return (
                  <div key={idx} className="p-3 bg-green-950/20 border border-green-500/20 rounded-xl text-xs text-green-500 flex items-center gap-2">
                    <CheckCircle size={12} /> 충돌 #{idx + 1} 해결 완료
                  </div>
                );
                return (
                  <div key={idx} className="bg-black/60 border border-amber-500/25 rounded-xl p-5">
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 bg-amber-500/15 text-amber-400 font-bold rounded text-[11px]">충돌</span>
                      <span className="font-bold text-white text-sm">{conflict.newRow.name}</span>
                      <span className="text-gray-500 text-xs">({conflict.newRow.dong}) — 휴대폰: {conflict.newRow.mobile || '-'}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {conflict.existingRows.map((ex, exIdx) => (
                        <div key={exIdx} onClick={() => {
                          const upd = [...conflicts];
                          upd[idx] = { ...upd[idx], resolved: true, selectedId: ex.id };
                          setConflicts(upd);
                        }} className="bg-[#141414] border border-[#2a2a2a] hover:border-green-500 rounded-xl p-4 cursor-pointer transition-all group">
                          <p className="font-bold text-green-400 text-xs mb-2 group-hover:text-green-300">기존 #{exIdx + 1}에 병합</p>
                          <p className="text-[11px] text-gray-500">휴대폰: {ex.mobile || '-'}</p>
                          <p className="text-[11px] text-gray-500">유선: {ex.landline || '-'}</p>
                          <p className="text-[11px] text-gray-600 mt-1 truncate">{ex.note || '-'}</p>
                        </div>
                      ))}
                      <div onClick={() => {
                        const upd = [...conflicts];
                        upd[idx] = { ...upd[idx], resolved: true, selectedId: 'NEW' };
                        setConflicts(upd);
                      }} className="bg-blue-950/10 border border-blue-500/20 hover:border-blue-500 rounded-xl p-4 cursor-pointer transition-all">
                        <p className="font-bold text-blue-400 text-xs mb-2">새 사람으로 등록</p>
                        <p className="text-[11px] text-gray-600">동명이인으로 분리 등록</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-4 border-t border-[#1e1e1e] flex justify-end gap-2">
              <button onClick={() => { setShowConflictModal(false); setUploading(false); }}
                className="px-4 py-2 bg-white/5 text-gray-400 rounded-xl text-sm font-bold hover:bg-white/10 transition-colors">
                취소
              </button>
              <button onClick={async () => {
                if (conflicts.some(c => !c.resolved)) {
                  if (!confirm('해결되지 않은 충돌이 있습니다. 무시하고 완료하시겠습니까?')) return;
                }
                const adds = [], updates = [];
                conflicts.forEach(c => {
                  if (!c.resolved) return;
                  if (c.selectedId === 'NEW') {
                    adds.push({ ...c.newRow, months: [targetMonth], history: [{ date: new Date().toISOString().split('T')[0], note: `[${targetMonth}] 동명이인 분리 등록`, author: user?.displayName || '관리자' }] });
                  } else {
                    const matched = c.existingRows.find(ex => ex.id === c.selectedId);
                    if (matched) {
                      const months = matched.months || [];
                      if (!months.includes(targetMonth)) months.push(targetMonth);
                      updates.push({ ...matched, ...c.newRow, id: matched.id, months });
                    }
                  }
                });
                await commitBatch(adds, updates);
              }} className="px-5 py-2 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-bold transition-colors">
                병합 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
