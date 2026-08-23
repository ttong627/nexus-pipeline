import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as XLSX from 'xlsx';
import { db, collection, getDocs, getDocsFromServer, getDoc, setDoc, doc, deleteDoc, writeBatch, serverTimestamp, query, where, increment } from '../config/firebase.js';
import {
  Database, Upload, Trash2, ArrowLeft, AlertCircle,
  Download, Search, Save, Clock, RotateCcw, FileSpreadsheet, X, RefreshCw, Calendar, Columns
} from 'lucide-react';

import { normalizeBirth, parsePhoneNumbers, formatPhoneInput } from '../utils/parsers.js';
import CellInput, { ColEditToggle } from './CellInput.jsx';
import { parseDisplayedAddress } from '../utils/addressFormat.js';
import { REGIONS } from '../utils/regions.js';
import { useConfirmDelete } from '../contexts/ConfirmDeleteContext.jsx';
import ColResizeHandle from './ColResizeHandle.jsx';
import ColumnEditBar from './ColumnEditBar.jsx';
import ColHeaderEditControls from './ColHeaderEditControls.jsx';
import { useColumnEditor } from '../hooks/useColumnEditor.js';
import { orderFieldsByExport, getColWidth, colCellStyle } from '../utils/colOrder.js';
import { idbGet, idbSet, idbDel } from '../utils/idbCache.js';
import SpecialNoteImporter from './SpecialNoteImporter.jsx';
import { isTranslitBuildingDong } from '../../services/address-service/src/shared/dongTokens.js';
import { logAudit } from '../utils/audit.js';   // B-11 파괴적 작업 감사 로그

const FIELDS = [
  { key: 'name',     label: '이름',     minW: '90px'  },
  { key: 'realName', label: '본명',     minW: '90px'  },
  { key: 'birthKey', label: '생년월일', minW: '85px'  },
  { key: 'dong',     label: '읍면동',   minW: '75px'  },
  { key: 'legalDong', label: '법정동',  minW: '75px'  },
  { key: 'roadAddr',   label: '도로명주소',     minW: '150px' },
  { key: 'detailAddr', label: '상세주소',       minW: '90px'  },
  { key: 'parenInfo',  label: '(법정동,건물명)', minW: '160px' },
  { key: 'mobile',   label: '휴대폰',   minW: '110px' },
  { key: 'landline', label: '유선전화', minW: '110px' },
  { key: 'note',     label: '특이사항', minW: '220px' },
  { key: 'driver',   label: '기사',     minW: '70px'  },
  { key: 'seqNo',    label: '배송순번', minW: '70px'  },
];

// 3분할 컬럼 → parseDisplayedAddress 키 (저장값 없을 때 address에서 파생)
const SPLIT_DERIVE = { roadAddr: 'road', detailAddr: 'detail', parenInfo: 'paren' };

const ROW_HEIGHT = 36; // px — 가상스크롤 고정 행 높이

// ── 기본명단 레코드 캐시 (IndexedDB, 24h TTL) — 표시 즉시성용 ──────────────
// IndexedDB 비동기 — 큰 명단을 localStorage에 동기 저장하던 렉 제거. 4MB 한계 없음, 세션 간 지속.
// 세션을 닫았다 다시 열어도 즉시 표시. fetchRecords가 항상 서버값으로 백그라운드 갱신하므로 자가 치유.
const BASE_RECS_CACHE_KEY = 'base_recs_v2';
const BASE_RECS_CACHE_TTL = 24 * 60 * 60 * 1000;
const baseKey = (city) => `${BASE_RECS_CACHE_KEY}_${city}`;
// rev: 저장 버전. 불러올 때 도시문서 rev와 비교해 같으면 무거운 전체 재조회를 생략(읽기 비용↓).
async function readBaseCache(city) {
  const rec = await idbGet(baseKey(city));
  if (!rec || !rec.data) return null;
  if (Date.now() - rec.ts > BASE_RECS_CACHE_TTL) { idbDel(baseKey(city)); return null; }
  return rec; // { ts, data, rev }
}
function writeBaseCache(city, data, rev = null) {
  idbSet(baseKey(city), { ts: Date.now(), data, rev }); // fire-and-forget(비동기)
}

const fmtDate = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
};

export default function BaseListManager({ user, onBack, initialCity = '', exportColOrder = [], setExportColOrder, defaultExportCols = [] }) {
  const isAdmin = user?.role === 'admin';
  const citiesApproved = user?.citiesApproved || [];
  const confirmDelete = useConfirmDelete();

  // 칼럼 순서·표시 — exportColOrder(전역, 엑셀·정제결과와 공유) 기준으로 FIELDS 재정렬
  const editor = useColumnEditor({ exportColOrder, setExportColOrder, defaultExportCols });
  const orderedFields = useMemo(() => orderFieldsByExport(FIELDS, editor.cols, editor.editing), [editor.cols, editor.editing]);
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
  const loadedBaseRevRef = useRef(null);   // 현재 지자체 기본명단 저장 버전(rev) — 동시편집 충돌 검사용
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [userRequests, setUserRequests] = useState({});
  const [requestingCity, setRequestingCity] = useState(false);

  const [dirtyMap, setDirtyMap] = useState({});
  const [deletedIds, setDeletedIds] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null);
  // 칼럼 수정모드 — 이 칼럼의 모든 셀이 입력창이 되어 위아래로 연속 입력할 수 있다
  const [colEditMode, setColEditMode] = useState(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [saving, setSaving] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [searchInput, setSearchInput] = useState('');            // 화면 입력값(즉시 반영)
  const searchDebounceRef = useRef(null);                        // ★디바운스 — 87,674건에서 글자마다 전건 필터+정렬이 돌면 9초 멈춘다(점검 실측)
  const [malformedCities, setMalformedCities] = useState([]);    // 비정규 지자체명 의심 — 삭제하지 않고 표시만
  const baseCollatorRef = useRef(new Intl.Collator('ko', { numeric: true }));
  const [filterDong, setFilterDong] = useState('');
  const [showOnlyWithNote, setShowOnlyWithNote] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showNoteImporter, setShowNoteImporter] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [historyRecord, setHistoryRecord] = useState(null);
  const [newHistoryNote, setNewHistoryNote] = useState('');
  const [notifyManager, setNotifyManager] = useState(false);

  // ── 생년월일 업데이트 모달 ──────────────────────────────────────────
  const [showBirthModal, setShowBirthModal] = useState(false);
  const [birthPreview, setBirthPreview] = useState(null); // { toUpdate, noMatch }
  const [birthUpdating, setBirthUpdating] = useState(false);

  const hasCityAccess = isAdmin || citiesApproved.includes(selectedCity);
  const availableSidos = Object.keys(REGIONS);

  const filteredCities = useMemo(() => {
    if (!filterSido) return storedCities;
    return storedCities.filter(c => c.id.startsWith(filterSido));
  }, [storedCities, filterSido]);

  // ★입력은 즉시, 무거운 계산은 150ms 뒤에 — CloudListManager 와 같은 방식(UI-1 취지)
  const handleSearchChange = useCallback((val) => {
    setSearchInput(val);
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearchText(val), 150);
  }, []);
  const clearSearch = useCallback(() => {
    clearTimeout(searchDebounceRef.current);
    setSearchInput(''); setSearchText('');
  }, []);
  useEffect(() => () => clearTimeout(searchDebounceRef.current), []);

  // ★B-8: 구스키마(한국어 키) 레코드도 읽는다. 이 화면만 영문 키만 보는 바람에
  //   구스키마 레코드가 **빈 행**으로 보이고 「특이사항 없는 레코드 삭제」·「유령 정리」 대상으로 들어갔다(2026-08-23 점검).
  const recName     = (r) => r?.name     ?? r?.이름     ?? '';
  const recDong     = (r) => r?.dong     ?? r?.행정동   ?? '';
  const recMobile   = (r) => r?.mobile   ?? r?.휴대폰   ?? '';
  const recLandline = (r) => r?.landline ?? r?.유선전화 ?? '';
  const recNote     = (r) => r?.note     ?? r?.특이사항 ?? '';
  const recBirth    = (r) => r?.birthKey ?? r?.생년월일 ?? '';

  const displayRecords = useMemo(() => {
    // ★순서가 중요하다: **거른 뒤에** dirty 를 병합한다. 전건을 먼저 map 하면 검색 한 글자마다
    //   8만 개 객체를 새로 만들어 메인스레드가 멈춘다(점검 실측 8,998ms).
    const q = searchText.trim().toLowerCase();
    const coll = baseCollatorRef.current;
    const merged = (r) => (dirtyMap[r.id] ? { ...r, ...dirtyMap[r.id] } : r);
    return records
      .filter(r => !deletedIds.has(r.id))
      .filter(r => {
        const m = merged(r);
        const note = String(recNote(m) || '');
        const dong = String(recDong(m) || '');
        if (showOnlyWithNote && !note.trim()) return false;
        if (filterDong && dong !== filterDong) return false;
        if (!q) return true;
        return [recName(m), dong, recMobile(m), recLandline(m), note]
          .some(v => String(v || '').toLowerCase().includes(q));
      })
      .map(merged)
      .sort((a, b) => {
        const cmp = coll.compare(String(recDong(a) || ''), String(recDong(b) || ''));
        if (cmp !== 0) return cmp;
        return coll.compare(String(recName(a) || ''), String(recName(b) || ''));
      });
  }, [records, dirtyMap, deletedIds, searchText, filterDong, showOnlyWithNote]);

  // 가상스크롤 — 대량 명단도 렉 없이 렌더
  const scrollRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: displayRecords.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const vItems = rowVirtualizer.getVirtualItems();
  const vTotal = rowVirtualizer.getTotalSize();
  const padTop = vItems.length > 0 ? vItems[0].start : 0;
  const padBottom = vItems.length > 0 ? vTotal - vItems[vItems.length - 1].end : 0;


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
    setSearchText(''); setSearchInput('');
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

      // ⛔**자동 삭제 금지**(2026-08-23 점검 · M-1 · §19) — 예전엔 "공백 없는 ID = 비정규명"으로 보고
      //   화면을 여는 것만으로 확인·백업·audit 없이 지자체 문서와 records 전건을 지웠다.
      //   `세종특별자치시`처럼 시·군·구가 없는 광역단체는 정상인데도 공백이 없어 통째로 사라진다.
      //   → 지우지 않는다. 목록에서만 빼고(아래 filter) 담당자가 알 수 있게 표시만 한다.
      const malformed = all.filter(d => !d.id.includes(' '));
      if (malformed.length) console.warn('[base_lists] 비정규 지자체명 의심(삭제하지 않음):', malformed.map(d => d.id).join(', '));
      setMalformedCities(malformed.map(d => d.id));

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

  // ★늦게 온 응답이 **다른 지자체** 화면을 덮어쓰면, 그 화면에서 셀을 고칠 때
  //   A 지자체 사람이 B 지자체 문서로 저장된다(2026-08-23 점검). 요청 순번으로 막는다.
  const fetchSeqRef = useRef(0);
  const fetchRecords = async (cityId, force = false) => {
    const myTurn = ++fetchSeqRef.current;
    const stale = () => myTurn !== fetchSeqRef.current;
    // 캐시 우선 즉시 표시(체감 로딩 0) → 백그라운드에서 서버 최신값으로 갱신. force면 rev-skip 무시(항상 전체 조회).
    const cached = force ? null : await readBaseCache(cityId);
    if (stale()) return;
    if (cached) { setRecords(cached.data); setLoading(false); }
    else setLoading(true);
    try {
      // 도시문서 1건으로 updatedAt + rev 동시 획득(추가 읽기 없음). rev가 캐시와 같으면 전체 재조회 생략.
      const cityDoc = await getDoc(doc(db, 'base_lists', cityId));
      const serverRev = (cityDoc.exists() ? (cityDoc.data().rev ?? null) : null);
      if (cityDoc.exists() && cityDoc.data().updatedAt) {
        setLastUpdatedAt(fmtDate(cityDoc.data().updatedAt));
      } else setLastUpdatedAt('');
      loadedBaseRevRef.current = serverRev;
      if (cached && serverRev != null && cached.rev === serverRev) { setLoading(false); return; }
      const snap = await getDocsFromServer(collection(db, `base_lists/${cityId}/records`));
      const recs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (stale()) return;               // 그 사이 다른 지자체로 넘어갔다 — 이 응답은 버린다
      setRecords(recs);
      writeBaseCache(cityId, recs, serverRev);
    } catch (e) {
      console.error(e);
      if (!cached) alert('데이터를 불러오는데 실패했습니다.');
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

  const startEdit = (id, field) => setEditingCell({ id, field });

  /**
   * 셀 편집 확정 — 셀에서 빠져나오는 순간 그 칸만 즉시 DB에 저장한다(형 지시 2026-07-22).
   * @param {string} id 레코드 ID
   * @param {string} field 필드 키
   * @param {string} newVal 새 값
   * @param {'next'|'prev'|null} move Enter/Tab 이동 방향(칼럼 수정모드 연속 입력)
   */
  const commitEdit = async (id, field, newVal, move) => {
    const rec = records.find(r => r.id === id);
    const origVal = rec?.[field] ?? '';
    const changed = String(newVal) !== String(origVal);

    // 다음 칸으로 포커스 이동(칼럼 수정모드) — 저장을 기다리지 않는다
    if (colEditMode === field && move) {
      const idx = displayRecords.findIndex(r => r.id === id);
      const nextRec = displayRecords[move === 'next' ? idx + 1 : idx - 1];
      setEditingCell(nextRec ? { id: nextRec.id, field } : null);
    } else {
      setEditingCell(null);
    }

    if (!changed) return;

    // 화면 먼저 반영(낙관적) → 저장 실패 시 되돌린다
    setRecords(prev => prev.map(r => (r.id === id ? { ...r, [field]: newVal } : r)));
    setAutoSaving(true);
    try {
      await setDoc(doc(db, `base_lists/${selectedCity}/records`, id), { [field]: newVal, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      setRecords(prev => prev.map(r => (r.id === id ? { ...r, [field]: origVal } : r)));
      alert(`저장 실패 — 되돌렸습니다.
${e.message}`);
    } finally { setAutoSaving(false); }
  };

  const renderCell = (r, field) => {
    const id = r.id;
    const isEditing = editingCell?.id === id && editingCell?.field === field;
    const isDirty = dirtyMap[id]?.[field] !== undefined;
    let val = dirtyMap[id]?.[field] ?? r[field] ?? '';
    // 3분할 컬럼: 저장값 없으면 address에서 즉시 파생(기존 레코드 호환)
    if (!val && SPLIT_DERIVE[field] && r.address) val = parseDisplayedAddress(r.address)[SPLIT_DERIVE[field]] || '';
    // A-31 법정동: 저장값 없는 기존 레코드는 괄호(법정동, 건물명) 첫 토큰에서 파생
    if (!val && field === 'legalDong') {
      const paren = r.parenInfo || (r.address ? parseDisplayedAddress(r.address).paren : '');
      const tok = String(paren || '').split(',')[0].trim();
      // A-37: 괄호 첫 토큰이 음역 건물동(에이동 …)이면 법정동으로 표시하지 않는다(과거 저장분 방어)
      if (/^[가-힣\d]+(읍|면|동)$/.test(tok) && !isTranslitBuildingDong(tok)) val = tok;
    }
    // 칼럼 수정모드면 그 칼럼의 모든 셀이 입력창(현재 칸만 포커스) · 아니면 편집 중인 셀만
    const colMode = colEditMode === field;
    if (isEditing || colMode) {
      return (
        <CellInput
          initial={val}
          autoFocus={isEditing}
          format={field === 'mobile' || field === 'landline' ? formatPhoneInput : undefined}
          onCommit={(v, move) => commitEdit(id, field, v, move)}
          onCancel={() => setEditingCell(null)}
        />
      );
    }
    const noteStr = String(val || '');
    if (field === 'note' && noteStr.includes('◆')) {
      const parts = noteStr.split(/(◆[^◆]*)/).filter(Boolean);
      return (
        <span title={`${noteStr}
(더블클릭하면 수정)`} onDoubleClick={() => startEdit(id, field)}
          className={`cursor-text block truncate text-xs ${isDirty ? 'font-semibold' : ''}`}>
          {parts.map((p, i) => (
            <span key={i} className={p.startsWith('◆') ? 'text-amber-400' : isDirty ? 'text-blue-300' : 'text-gray-300'}>{p}</span>
          ))}
        </span>
      );
    }
    return (
      <span title={`${noteStr}
(더블클릭하면 수정)`} onDoubleClick={() => startEdit(id, field)}
        className={`cursor-text block truncate text-xs ${isDirty ? 'text-blue-300 font-semibold' : 'text-gray-300'} ${!val ? 'text-gray-700' : ''}`}>
        {val || '—'}
      </span>
    );
  };

  const handleSave = async () => {
    if (!hasChanges || saving) return;
    const modifiedEntries = Object.entries(dirtyMap).filter(([id]) => !deletedIds.has(id));
    const deletedArr = [...deletedIds];
    const _saveMsg = `변경사항을 저장하시겠습니까?\n수정: ${modifiedEntries.length}건 / 삭제: ${deletedArr.length}건`;
    if (!confirm(deletedArr.length > 0
      ? `⚠️ 삭제 ${deletedArr.length}건이 포함됩니다 — 삭제는 되돌릴 수 없습니다.\n\n${_saveMsg}`
      : _saveMsg)) return;
    setSaving(true);
    try {
      // 동시편집 충돌 검사 — 내가 불러온 후 다른 담당자가 먼저 저장했는지 확인
      let serverRev = null;
      try {
        const cityDoc = await getDoc(doc(db, 'base_lists', selectedCity));
        serverRev = cityDoc.exists() ? (cityDoc.data().rev ?? null) : null;
      } catch { serverRev = null; }
      if (loadedBaseRevRef.current != null && serverRev != null && serverRev !== loadedBaseRevRef.current) {
        const ok = window.confirm('⚠️ 다른 담당자가 이 기본명단을 먼저 저장했습니다.\n\n[확인] 내 변경사항으로 덮어쓰기\n[취소] 저장 중단 (최신 명단을 다시 불러오는 것을 권장)');
        if (!ok) { setSaving(false); return; }
      }
      const nextRev = (serverRev ?? loadedBaseRevRef.current ?? 0) + 1;
      // ★rev 는 화면 캐시 비교용 값이고, 실제 문서에는 `increment(1)` 로 올린다(2026-08-23 점검) —
      //   두 담당자가 동시에 저장하면 둘 다 같은 값을 읽고 같은 값을 써서 충돌 감지가 통과해 버렸다.

      const allOps = [
        ...modifiedEntries.map(([id, changes]) => ({ type: 'update', id, changes })),
        ...deletedArr.map(id => ({ type: 'delete', id })),
      ];
      const batches = [];
      for (let i = 0; i < allOps.length; i += 499) {
        const batch = writeBatch(db);
        allOps.slice(i, i + 499).forEach(op => {
          const ref = doc(db, `base_lists/${selectedCity}/records`, op.id);
          if (op.type === 'update') batch.update(ref, op.changes);
          else batch.delete(ref);
        });
        batches.push(batch);
      }
      // ★청크 하나가 실패해도 나머지는 이미 커밋된다 — 예전엔 "저장 오류" 한 줄만 띄워
      //   담당자는 전부 실패한 줄 알고 다시 눌렀고, 화면과 DB 가 갈라졌다(2026-08-23 점검).
      //   → allSettled 로 **몇 개가 들어갔고 몇 개가 실패했는지** 드러낸다.
      const _results = await Promise.allSettled(batches.map(b => b.commit()));
      const _failed = _results.filter(r => r.status === 'rejected');
      if (_failed.length) {
        const _msg = `저장이 부분적으로 실패했습니다 — 성공 ${_results.length - _failed.length}/${_results.length} 묶음.\n` +
          `실패 사유: ${_failed[0].reason?.message || _failed[0].reason}\n\n` +
          `화면을 새로고침해 실제 저장 상태를 확인한 뒤 다시 저장해 주세요.`;
        throw new Error(_msg);
      }
      await setDoc(doc(db, 'base_lists', selectedCity), { updatedAt: serverTimestamp(), rev: increment(1) }, { merge: true });

      // 저장 성공 → 서버 전체 재조회 대신 로컬 state·캐시 즉시 반영 (체감 속도 ↑, 결과 동일)
      const deletedSet = new Set(deletedArr);
      const changeById = Object.fromEntries(modifiedEntries);
      const merged = records
        .filter(r => !deletedSet.has(r.id))
        .map(r => changeById[r.id] ? { ...r, ...changeById[r.id] } : r);
      loadedBaseRevRef.current = nextRev;
      setRecords(merged);
      writeBaseCache(selectedCity, merged, nextRev);
      setDirtyMap({});
      setDeletedIds(new Set());
      fetchStoredCities().catch(() => {});  // 도시 목록·카운트는 백그라운드 동기화 (대기 X)
      alert(`저장 완료! (수정 ${modifiedEntries.length}건, 삭제 ${deletedArr.length}건)`);
    } catch (e) { alert('저장 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDeleteAllRecords = async () => {
    if (!selectedCity || !hasCityAccess) return;
    if (!(await confirmDelete({ target: `"${selectedCity}" 기본명단 전체`, count: records.length, dangerous: true }))) return;
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
      await logAudit('DELETE_BASE_ALL', { city: selectedCity, count: freshSnap.docs.length });
      alert(`"${selectedCity}" 기본명단 전체 삭제 완료 (${freshSnap.docs.length.toLocaleString()}건)`);
    } catch (e) { alert('삭제 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDeleteNoNote = async () => {
    if (!selectedCity || !hasCityAccess) return;
    const targets = records.filter(r => !String(recNote(r) || '').trim());
    if (!targets.length) { alert('특이사항 없는 레코드가 없습니다.'); return; }
    if (!(await confirmDelete({ target: '특이사항 없는 레코드', count: targets.length, dangerous: targets.length >= 50 }))) return;
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
      await fetchRecords(selectedCity, true);
      await fetchStoredCities();
      await logAudit('DELETE_BASE_NO_NOTE', { city: selectedCity, count: targets.length });
      alert(`특이사항 없는 레코드 ${targets.length.toLocaleString()}건 삭제 완료`);
    } catch (e) { alert('삭제 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  // ── 지자체 항목 자체 삭제 (카드 X 버튼) ──────────────────────────
  const handleDeleteCity = async (cityId) => {
    if (!(await confirmDelete({ target: `"${cityId}" 지자체 항목`, count: storedCities.find(c => c.id === cityId)?.recordCount, note: '소속 레코드도 함께 삭제됩니다.', dangerous: true }))) return;
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
      await logAudit('DELETE_BASE_CITY', { city: cityId });
      alert(`"${cityId}" 삭제 완료`);
    } catch (e) { alert('삭제 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleCleanGhosts = async () => {
    if (!selectedCity || !hasCityAccess) return;
    setSaving(true);
    try {
      const snap = await getDocsFromServer(collection(db, `base_lists/${selectedCity}/records`));
      const ghosts = snap.docs.filter(d => !String(recName(d.data()) || '').trim());
      if (ghosts.length === 0) { alert('유령 데이터가 없습니다.'); return; }
      if (!(await confirmDelete({ target: '이름 없는 유령 레코드', count: ghosts.length, dangerous: ghosts.length >= 50 }))) return;
      for (let i = 0; i < ghosts.length; i += 499) {
        const batch = writeBatch(db);
        ghosts.slice(i, i + 499).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await fetchRecords(selectedCity, true);
      await logAudit('DELETE_BASE_GHOSTS', { city: selectedCity, count: ghosts.length });
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
      await fetchRecords(selectedCity, true);
      await logAudit('MIGRATE_BASE_PHONE', { city: selectedCity, count: updates.length });
      alert(`✅ 전화번호 이동 완료: ${updates.length.toLocaleString()}건\n유선전화 → 휴대폰으로 이동했습니다.`);
    } catch (e) { alert('처리 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  // 분리 저장된 주소(roadAddr/detailAddr/parenInfo)를 정제 형식으로 합체: "도로명, 상세 (법정동, 건물명)".
  // 이미 합쳐진 address가 있으면 그대로 사용(정제 결과 원본).
  const combineAddr = (r) => {
    if (String(r.address || '').trim()) return r.address;
    const road = String(r.roadAddr || '').trim();
    const detail = String(r.detailAddr || '').trim();
    const paren = String(r.parenInfo || '').trim();
    let s = [road, detail].filter(Boolean).join(', ');
    if (paren) s += `${s ? ' ' : ''}(${paren})`;
    return s.trim();
  };
  // 정제결과(exportColOrder) 칼럼 키 → base_lists 영문 필드 값
  const baseVal = (r, key, idx) => {
    switch (key) {
      case 'NO':       return idx + 1;
      case '이름':     return recName(r) || '';
      case '생년월일': return recBirth(r) || '';
      case '행정동':   return recDong(r) || '';
      case '리':       return r.리 || '';
      case '주소':     return combineAddr(r);
      case '휴대폰':   return recMobile(r) || '';
      case '유선전화': return recLandline(r) || '';
      case '포수':     return r.qty ?? '';
      case '특이사항': return r.note || '';
      case '문자수신': return r.sms || '';
      case '기사':     return r.driver || '';
      case '배송순번': return r.seqNo ?? '';
      default:         return ''; // 구분·사유·품명 등 base_lists에 없는 칼럼
    }
  };

  const handleDownload = () => {
    if (!displayRecords.length) return alert('다운로드할 데이터가 없습니다.');
    // 정제결과 화면과 동일한 칼럼 구성(전역 exportColOrder 공유). 리는 읍/면 데이터 있을 때만.
    const hasEM = displayRecords.some(r => /(읍|면)$/.test(String(r.dong ?? '').trim()));
    const riOn = hasEM && displayRecords.some(r => String(r.리 ?? '').trim());
    const cols = (exportColOrder.length ? exportColOrder : defaultExportCols)
      .filter(c => c.on && (c.key !== '리' || riOn));
    const data = displayRecords.map((r, i) => {
      const row = {};
      cols.forEach(c => { row[c.label] = baseVal(r, c.key, i); });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = cols.map(c => ({ wch: c.key === '주소' ? 34 : Math.max(c.label.length + 2, 9) }));
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
          // 특이사항 정제: 무시 단어(공제/계좌/현금) 삭제 → 공백 정리
          const note = g('특이사항', '비고')
            .replace(/공제|계좌|현금/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          newRows.push({
            name,
            birthKey: normalizeBirth(g('생년월일', '주민번호')),
            mobile: phones.mobile.replace(/[^0-9-]/g, ''),
            note,
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
      await fetchRecords(selectedCity, true);
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

  // ── 생년월일 업데이트: 파일 파싱 → 미리보기 ─────────────────────────
  const handleBirthFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf);
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 2) { alert('데이터가 없습니다.'); return; }

      // 헤더 자동 감지 (상위 5행 중 키워드 최다 행)
      const NAME_KWS  = ['이름','성명','대상자','수령자'];
      const PHONE_KWS = ['휴대','핸드','모바일','연락','전화'];
      const BIRTH_KWS = ['생년','생일','주민'];
      const scoreRow = (r) => r.reduce((s, c) => {
        const v = String(c || '');
        return s + (NAME_KWS.some(k=>v.includes(k))?1:0) + (PHONE_KWS.some(k=>v.includes(k))?1:0) + (BIRTH_KWS.some(k=>v.includes(k))?1:0);
      }, 0);
      const hdrIdx = rows.slice(0, 5).reduce((best, r, i) => scoreRow(r) > scoreRow(rows[best]) ? i : best, 0);
      const header  = rows[hdrIdx].map(c => String(c || ''));
      const dataRows = rows.slice(hdrIdx + 1).filter(r => r.some(c => String(c).trim()));

      const colIdx = (kws) => header.findIndex(h => kws.some(k => h.includes(k)));
      const nameIdx  = colIdx(NAME_KWS);
      const phoneIdx = colIdx(PHONE_KWS);
      const birthIdx = colIdx(BIRTH_KWS);

      if (nameIdx < 0 || birthIdx < 0) {
        alert(`컬럼 자동 감지 실패:\n이름 컬럼: ${nameIdx >= 0 ? header[nameIdx] : '없음'}\n생년월일 컬럼: ${birthIdx >= 0 ? header[birthIdx] : '없음'}\n\n파일 헤더를 확인하세요.`);
        return;
      }

      // 현재 DB 레코드로 이름+휴대폰 인덱스 구성
      const digitKey = v => String(v || '').replace(/[^\d]/g, '');
      const byPhone  = {};
      const byBirth  = {};
      records.forEach(r => {
        const name = (r.name || '').trim();
        const ph   = digitKey(r.mobile || '');
        const bk   = digitKey(r.birthKey || '');
        if (ph.length >= 9) byPhone[`${name}__${ph}`] = r;
        if (bk)             byBirth[`${name}__${bk}`] = r;
      });

      const toUpdate = [];
      const noMatch  = [];

      dataRows.forEach(row => {
        const name    = String(row[nameIdx] || '').trim();
        const rawBirth = String(row[birthIdx] || '').trim();
        const rawPhone = phoneIdx >= 0 ? String(row[phoneIdx] || '') : '';
        if (!name || !rawBirth) return;

        const newBirth = normalizeBirth(rawBirth);
        if (!newBirth) return;

        const mKey = digitKey(rawPhone);
        let matched = null;
        if (mKey.length >= 9) matched = byPhone[`${name}__${mKey}`];
        if (!matched && newBirth) {
          // 이름+새생년월일로도 시도
          const bKey = digitKey(newBirth);
          matched = byBirth[`${name}__${bKey}`];
        }

        if (matched) {
          toUpdate.push({ id: matched.id, name, newBirth, oldBirth: matched.birthKey || '', phone: matched.mobile || '' });
        } else {
          noMatch.push({ name, rawBirth, rawPhone });
        }
      });

      setBirthPreview({ toUpdate, noMatch });
    } catch(e) { alert('파일 파싱 오류: ' + e.message); }
  };

  // ── 생년월일 업데이트: 확정 저장 ────────────────────────────────────
  const commitBirthUpdate = async () => {
    if (!birthPreview?.toUpdate?.length) return;
    setBirthUpdating(true);
    try {
      const CHUNK = 499;
      const ops = birthPreview.toUpdate;
      let done = 0;
      for (let i = 0; i < ops.length; i += CHUNK) {
        const batch = writeBatch(db);
        ops.slice(i, i + CHUNK).forEach(op => {
          const ref = doc(db, 'base_lists', selectedCity, 'records', op.id);
          batch.set(ref, { birthKey: op.newBirth, updatedAt: serverTimestamp() }, { merge: true });
        });
        await batch.commit();
        done += Math.min(CHUNK, ops.length - i);
      }
      // 로컬 레코드 업데이트
      setRecords(prev => {
        const map = Object.fromEntries(ops.map(o => [o.id, o.newBirth]));
        return prev.map(r => map[r.id] ? { ...r, birthKey: map[r.id] } : r);
      });
      alert(`✅ 생년월일 업데이트 완료 — ${done}건`);
      setShowBirthModal(false);
      setBirthPreview(null);
    } catch(e) { alert('저장 오류: ' + e.message); }
    finally { setBirthUpdating(false); }
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

        {isAdmin && (
          <button onClick={() => setShowNoteImporter(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-500/30 transition-colors shrink-0">
            <FileSpreadsheet size={13} /> 특이사항 이식
          </button>
        )}

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
                hasChanges && !saving ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_14px_rgba(16,185,129,0.25)]' : 'bg-white/5 text-gray-600 cursor-not-allowed'
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
                showUpload ? 'bg-emerald-900/30 text-emerald-300 border-emerald-500/30' : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/5'
              }`}>
              <Upload size={13} /> 엑셀 업로드
            </button>
            {records.length > 0 && (
              <button onClick={() => { setShowBirthModal(true); setBirthPreview(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-violet-950/40 hover:bg-violet-900/50 text-violet-300 border border-violet-500/30 transition-colors">
                <Calendar size={13} /> 생년월일 업데이트
              </button>
            )}
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

      {showNoteImporter && <SpecialNoteImporter onClose={() => setShowNoteImporter(false)} />}

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
                                  <span className="text-[13px] font-black text-white">{records.length.toLocaleString()}건 · {records.reduce((s,r)=>s+(parseInt(r.qty)||1),0).toLocaleString()}포</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[11px] text-gray-600">특이사항 있음</span>
                                  <span className="text-[13px] font-black text-blue-400">{noteCount.toLocaleString()}건</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-[11px] text-gray-600">검색 결과</span>
                                  <span className="text-[12px] font-bold text-gray-300">{displayRecords.length.toLocaleString()}건 · {displayRecords.reduce((s,r)=>s+(parseInt(r.qty)||1),0).toLocaleString()}포</span>
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
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400" />
                <input type="text" value={searchInput} onChange={e => handleSearchChange(e.target.value)}
                  placeholder="이름, 읍면동, 연락처, 특이사항..."
                  className="w-full bg-[#0a1410] border-2 border-emerald-500/50 rounded-xl pl-8 pr-7 py-1.5 text-xs font-bold text-white outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30 focus:bg-[#0c1a13] placeholder:text-gray-500 placeholder:font-normal shadow-[0_0_14px_rgba(16,185,129,0.18)] transition-all" />
                {searchInput && (
                  <button onClick={clearSearch} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
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
                <button onClick={() => { clearSearch(); setFilterDong(''); }}
                  className="text-[10px] text-gray-600 hover:text-red-400 border border-[#2a2a2a] hover:border-red-700/40 rounded-lg px-2 py-1.5 transition-colors">
                  초기화
                </button>
              )}
              {/* 칼럼 편집 토글 (헤더 직접 드래그·폭조절·표시/숨김) */}
              {setExportColOrder && exportColOrder.length > 0 && (
                <button
                  onClick={editor.editing ? editor.commit : editor.begin}
                  title="칼럼 편집 — 헤더를 끌어 이동, 가장자리로 폭조절, 👁로 표시/숨김"
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-colors shrink-0 ${
                    editor.editing
                      ? 'bg-emerald-500 border-emerald-400 text-black'
                      : 'bg-[#0d1a0d] border-[#1a3a1a] text-emerald-500/70 hover:text-emerald-300 hover:border-emerald-500/40'
                  }`}
                >
                  <Columns size={12} />
                  {editor.editing ? '완료' : '칼럼 편집'}
                </button>
              )}
              <span className="text-[11px] text-gray-600">
                {displayRecords.length.toLocaleString()}건 · {displayRecords.reduce((s,r)=>s+(parseInt(r.qty)||1),0).toLocaleString()}포 표시
                {records.length > 0 && ` (전체 ${records.length.toLocaleString()}건 · ${records.reduce((s,r)=>s+(parseInt(r.qty)||1),0).toLocaleString()}포 중)`}
              </span>
              {!searchText && !filterDong && records.length > 0 && (
                <p className="text-[10px] text-gray-700 ml-auto">셀 클릭하여 직접 수정 · 행 끝 🗑 으로 삭제 표시</p>
              )}
            </div>
          )}

          {/* Table area */}
          <div ref={scrollRef} className="flex-1 overflow-auto relative">
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
              <div className="h-full flex items-center justify-center gap-2 text-emerald-400 text-sm animate-pulse">
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
                    {orderedFields.map(f => {
                      const w = getColWidth(editor.cols, f.key);
                      const on = editor.isOn(f.key);
                      const dim = editor.editing && !on;
                      return (
                        <th key={f.key}
                          {...(editor.editing ? editor.dragProps(f.key) : {})}
                          style={{ ...(colCellStyle(w) || { minWidth: f.minW }), position: 'relative' }}
                          className={`px-3 py-2.5 text-center text-[10px] text-gray-600 font-bold uppercase tracking-wider overflow-hidden ${dim ? 'opacity-40' : ''}`}>
                          {editor.editing && <ColHeaderEditControls colKey={f.key} on={on} onToggle={editor.toggleKey} />}
                          {f.label}
                          {/* 칼럼 수정모드 토글 — 이 칼럼 전체가 입력창이 되어 Enter로 다음 행 연속 입력 */}
                          {!editor.editing && f.key !== 'history' && (
                            <ColEditToggle colKey={f.key} active={colEditMode === f.key} onToggle={setColEditMode} />
                          )}
                          {editor.editing && <ColResizeHandle colKey={f.key} currentWidth={w} onResize={editor.resizeKey} />}
                        </th>
                      );
                    })}
                    <th className="px-3 py-2.5 text-center text-[10px] text-gray-600 font-bold uppercase tracking-wider w-14">이력</th>
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {padTop > 0 && <tr><td style={{ height: padTop }} colSpan={orderedFields.length + 3} /></tr>}
                  {vItems.map(vRow => {
                    const r = displayRecords[vRow.index];
                    const idx = vRow.index;
                    const isDirtyRow = !!dirtyMap[r.id];
                    return (
                      <tr key={r.id} style={{ height: ROW_HEIGHT }} className={`border-b border-[#111] transition-colors group ${
                        isDirtyRow ? 'bg-blue-950/10 hover:bg-blue-950/15' : 'hover:bg-white/[0.025]'
                      }`}>
                        <td className="px-3 py-2 text-[10px] text-gray-700">
                          <span className="flex items-center gap-1">
                            {isDirtyRow && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />}
                            {idx + 1}
                          </span>
                        </td>
                        {orderedFields.map(f => {
                          const dim = editor.editing && !editor.isOn(f.key);
                          return (
                            <td key={f.key} style={colCellStyle(getColWidth(editor.cols, f.key)) || { minWidth: f.minW }} className={`px-3 py-2 max-w-0 overflow-hidden ${dim ? 'opacity-40' : ''}`}>
                              {renderCell(r, f.key)}
                            </td>
                          );
                        })}
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
                  {padBottom > 0 && <tr><td style={{ height: padBottom }} colSpan={orderedFields.length + 3} /></tr>}
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

      {editor.editing && (
        <ColumnEditBar onReset={editor.reset} onCancel={editor.cancel} onCommit={editor.commit} />
      )}

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

    {/* ── 생년월일 업데이트 모달 ──────────────────────────────────────── */}
    {showBirthModal && (
      <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
        <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">

          {/* 헤더 */}
          <div className="shrink-0 px-5 py-4 border-b border-[#1e1e1e] flex items-center gap-3">
            <Calendar size={16} className="text-violet-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black text-white">생년월일 업데이트</h3>
              <p className="text-[10px] text-gray-600 leading-tight">
                파일의 이름+휴대폰으로 기존 명단 매칭 → birthKey 일괄 갱신
              </p>
            </div>
            <button onClick={() => { setShowBirthModal(false); setBirthPreview(null); }}
              className="p-1.5 text-gray-600 hover:text-white transition-colors rounded-lg hover:bg-white/5">
              <X size={15} />
            </button>
          </div>

          {/* 바디 */}
          <div className="flex-1 overflow-auto p-5 space-y-4">

            {!birthPreview ? (
              /* ─ Step 1: 파일 선택 ─ */
              <div className="space-y-3">
                <div className="bg-[#111] border border-[#222] rounded-xl p-4 text-[11px] text-gray-500 space-y-1.5 leading-relaxed">
                  <p className="text-gray-400 font-bold">파일 조건</p>
                  <p>• 이름(성명) + 휴대폰(연락처) + 생년월일(주민번호) 컬럼 포함</p>
                  <p>• 이름+휴대폰으로 기존 명단 매칭 후 생년월일만 업데이트</p>
                  <p>• 생년월일 형식: 8자리(19750315) / 6자리(750315) / YY.MM.DD 모두 OK</p>
                  <p>• 현재 지자체: <span className="text-violet-300 font-bold">{selectedCity}</span> ({records.length.toLocaleString()}건 로드됨)</p>
                </div>
                <label className="w-full py-8 border-2 border-dashed border-[#2a2a2a] rounded-xl flex flex-col items-center gap-2 cursor-pointer hover:border-violet-500/40 hover:bg-violet-500/5 transition-all">
                  <Calendar size={24} className="text-violet-400" />
                  <span className="text-[12px] text-gray-400 font-bold">생년월일 포함 파일 선택</span>
                  <span className="text-[10px] text-gray-700">.xlsx / .xls</span>
                  <input type="file" accept=".xlsx,.xls" onChange={handleBirthFileSelect} className="hidden" />
                </label>
              </div>
            ) : (
              /* ─ Step 2: 미리보기 ─ */
              <div className="space-y-4">

                {/* 요약 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#0d1a0d] border border-[#1a3a1a] rounded-xl p-3 text-center">
                    <div className="text-2xl font-black text-green-400">{birthPreview.toUpdate.length.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">업데이트 예정</div>
                  </div>
                  <div className="bg-[#1a1a0a] border border-[#333] rounded-xl p-3 text-center">
                    <div className="text-2xl font-black text-gray-500">{birthPreview.noMatch.length.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-700 mt-0.5">미매칭 (제외)</div>
                  </div>
                </div>

                {/* 업데이트 미리보기 테이블 */}
                {birthPreview.toUpdate.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-600 font-bold mb-2 tracking-widest uppercase">업데이트 예정 ({Math.min(birthPreview.toUpdate.length, 50)}건 미리보기)</p>
                    <div className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl overflow-hidden">
                      <table className="w-full text-[10px] border-collapse">
                        <thead>
                          <tr className="border-b border-[#1e1e1e] bg-[#111]">
                            <th className="px-3 py-2 text-left text-gray-600 font-bold w-20">이름</th>
                            <th className="px-3 py-2 text-left text-gray-600 font-bold">휴대폰</th>
                            <th className="px-3 py-2 text-left text-gray-600 font-bold w-24">기존 생년월일</th>
                            <th className="px-3 py-2 text-left text-gray-600 font-bold w-24">신규 생년월일</th>
                          </tr>
                        </thead>
                        <tbody>
                          {birthPreview.toUpdate.slice(0, 50).map((r, i) => (
                            <tr key={i} className="border-b border-[#0e0e0e] hover:bg-white/[0.02]">
                              <td className="px-3 py-1.5 text-white font-bold">{r.name}</td>
                              <td className="px-3 py-1.5 text-gray-500">{r.phone}</td>
                              <td className="px-3 py-1.5 text-gray-600">{r.oldBirth || '(빈값)'}</td>
                              <td className="px-3 py-1.5 text-green-400 font-bold">{r.newBirth}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {birthPreview.toUpdate.length > 50 && (
                        <p className="px-3 py-2 text-[10px] text-gray-700 border-t border-[#1e1e1e]">
                          ... 외 {birthPreview.toUpdate.length - 50}건 더
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* 파일 재선택 */}
                <label className="flex items-center gap-2 text-[11px] text-gray-600 hover:text-violet-400 cursor-pointer transition-colors w-max">
                  <Upload size={12} />
                  다른 파일 선택하기
                  <input type="file" accept=".xlsx,.xls" onChange={handleBirthFileSelect} className="hidden" />
                </label>
              </div>
            )}
          </div>

          {/* 푸터 */}
          {birthPreview && (
            <div className="shrink-0 px-5 py-4 border-t border-[#1e1e1e] flex items-center justify-between gap-3">
              <p className="text-[10px] text-gray-600">
                {birthPreview.toUpdate.length}건 생년월일 업데이트 · 기존 데이터에 merge 저장
              </p>
              <div className="flex gap-2">
                <button onClick={() => setBirthPreview(null)}
                  className="px-3 py-1.5 rounded-xl text-[11px] text-gray-500 hover:text-white bg-white/5 hover:bg-white/10 transition-colors">
                  뒤로
                </button>
                <button
                  onClick={commitBirthUpdate}
                  disabled={birthUpdating || !birthPreview.toUpdate.length}
                  className="px-4 py-1.5 rounded-xl text-[11px] font-black bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {birthUpdating ? '저장 중...' : `${birthPreview.toUpdate.length}건 저장`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    </div>
  );
}
