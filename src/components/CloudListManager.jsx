import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as XLSX from 'xlsx';
import {
  db, storage,
  collection, getDocs, getDocsFromServer, getDoc, setDoc, doc, deleteDoc, writeBatch, serverTimestamp,
  ref, getDownloadURL, deleteObject,
} from '../config/firebase.js';
import { normalizeBirth, formatPhoneInput } from '../utils/parsers.js';
import {
  Cloud, Trash2, ArrowLeft, Download, Calendar, FileSpreadsheet,
  AlertCircle, ChevronRight, Search, Save, RotateCcw, X, CheckCircle, MapPin,
  Building2, DatabaseZap, Ghost, BookOpen, Phone, RefreshCw, LayoutGrid,
} from 'lucide-react';
import OrgPresetModal from './OrgPresetModal.jsx';
import { canUseCoords, canUseCoordsBg } from '../utils/tierUtils.js';

const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY;

// ─── Records Cache (sessionStorage, 10분 TTL) ─────────────────────────────────
const RECS_CACHE_KEY = 'cloud_recs_v2';
const RECS_CACHE_TTL = 10 * 60 * 1000;

function readRecsCache(city, monthId) {
  try {
    const raw = sessionStorage.getItem(`${RECS_CACHE_KEY}_${city}_${monthId}`);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > RECS_CACHE_TTL) { sessionStorage.removeItem(`${RECS_CACHE_KEY}_${city}_${monthId}`); return null; }
    return data;
  } catch { return null; }
}
function writeRecsCache(city, monthId, data) {
  try {
    const str = JSON.stringify({ ts: Date.now(), data });
    if (str.length > 4 * 1024 * 1024) return; // 4MB 초과 시 캐시 생략
    sessionStorage.setItem(`${RECS_CACHE_KEY}_${city}_${monthId}`, str);
  } catch { /* quota 초과 시 무시 */ }
}
function bustRecsCache(city, monthId) {
  try { sessionStorage.removeItem(`${RECS_CACHE_KEY}_${city}_${monthId}`); } catch {}
}

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
const CellInput = memo(function CellInput({ type, opts, initial, onCommit, onCancel, isPhone }) {
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
      onChange={e => { const v = isPhone ? formatPhoneInput(e.target.value) : e.target.value; setVal(v); }}
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
                <th key={f.key} style={{ minWidth: f.minW }} className={`px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider ${f.key === '기사' || f.key === '배송순번' ? 'text-[#3b82f6]/60' : 'text-gray-600'}`}>
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
                    {r.lat ? <span className="text-[#3b82f6] text-[10px]">✓</span> : <span className="text-gray-700 text-[10px]">✗</span>}
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

export default function CloudListManager({ user, onBack, initialCity = '', onOpenRouteMap, onOpenInResultGrid }) {
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


  // UI — 검색은 150ms 디바운스로 displayRecords 재계산 최소화
  const [searchInput, setSearchInput] = useState('');
  const [searchText, setSearchText] = useState('');
  const [filterGubun, setFilterGubun] = useState('');
  const [filterDong, setFilterDong] = useState('');
  const searchDebounceRef = useRef(null);
  const handleSearchChange = useCallback((val) => {
    setSearchInput(val);
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearchText(val), 150);
  }, []);
  const [deleteMonthConfirm, setDeleteMonthConfirm] = useState(null);
  const [showOrgPreset, setShowOrgPreset] = useState(false);

  // City cards (replaces sigungu dropdown)
  const [cityList, setCityList] = useState([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [expandedCityId, setExpandedCityId] = useState(initialCity || '');

  // 특이사항·전화번호 처리
  const [isFetchingNotes, setIsFetchingNotes] = useState(false);
  const [isMovingPhones, setIsMovingPhones] = useState(false);

  // 카드 클릭 → 관리 뷰 즉시 진입 (최신 월 자동 선택 + 캐시 우선)
  const handleOpenCity = (cityItem) => {
    if (!cityItem.latestMonth) return;
    const fullCity = `${cityItem.sido} ${cityItem.sigungu}`;
    setSelectedSido(cityItem.sido);
    setSelectedSigungu(cityItem.sigungu);
    setSelectedMonth(cityItem.latestMonth);
    setMonths([cityItem.latestMonth]); // 월 목록 즉시 세팅 (나머지는 백그라운드 fetchMonths가 채움)
    setRecords([]);
    setDirtyRecords({});
    setDeletedRecordIds(new Set());
    // fetchRecords는 selectedCity 갱신 전에 호출되므로 cityId 직접 전달
    fetchRecordsFor(fullCity, cityItem.latestMonth.id);
    // 백그라운드에서 전체 월 목록도 갱신 (다른 월로 전환 가능하게)
    setTimeout(() => {
      getDocs(collection(db, 'cloud_lists', fullCity, 'months'))
        .then(snap => {
          const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.id.localeCompare(a.id));
          if (data.length > 0) setMonths(data);
        })
        .catch(() => {});
    }, 100);
  };

  // 관리 모드 진입 (카드 편집 아이콘 클릭)
  const handleAdminMode = (cityItem) => {
    setSelectedSido(cityItem.sido);
    setSelectedSigungu(cityItem.sigungu);
  };


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

  // ── Derived display records — 행정동>주소>이름 정렬 + 구분·행정동 콤보 필터
  const displayRecords = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return records
      .filter(r => {
        if (deletedRecordIds.has(r.id)) return false;
        if (orgDongs && !orgDongs.has((r.행정동 || '').trim())) return false;
        const dirty = dirtyRecords[r.id] || {};
        const gubun = dirty.구분 ?? r.구분 ?? '';
        const dong = dirty.행정동 ?? r.행정동 ?? '';
        if (filterGubun && gubun !== filterGubun) return false;
        if (filterDong && dong !== filterDong) return false;
        if (!q) return true;
        return [
          dirty.이름 ?? r.이름, dirty.행정동 ?? r.행정동,
          dirty.주소 ?? r.주소, dirty.휴대폰 ?? r.휴대폰, dirty.특이사항 ?? r.특이사항,
        ].some(v => String(v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const da = dirtyRecords[a.id] || {}, db_ = dirtyRecords[b.id] || {};
        let cmp = (da.행정동 ?? a.행정동 ?? '').localeCompare(db_.행정동 ?? b.행정동 ?? '', 'ko', { numeric: true });
        if (cmp !== 0) return cmp;
        cmp = (da.주소 ?? a.주소 ?? '').localeCompare(db_.주소 ?? b.주소 ?? '', 'ko', { numeric: true });
        if (cmp !== 0) return cmp;
        return (da.이름 ?? a.이름 ?? '').localeCompare(db_.이름 ?? b.이름 ?? '', 'ko', { numeric: true });
      });
  }, [records, deletedRecordIds, searchText, orgDongs, dirtyRecords, filterGubun, filterDong]);

  // 시도별 그룹
  const citiesBySido = useMemo(() => {
    const map = {};
    cityList.forEach(c => {
      if (!map[c.sido]) map[c.sido] = [];
      map[c.sido].push(c);
    });
    return map;
  }, [cityList]);

  // 행정동 콤보박스 목록
  const cloudDongList = useMemo(() =>
    [...new Set(records.filter(r => !deletedRecordIds.has(r.id)).map(r => (dirtyRecords[r.id]?.행정동 ?? r.행정동)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })),
  [records, deletedRecordIds, dirtyRecords]);

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
    fetchAllCities();
  }, []);

  useEffect(() => {
    if (!selectedCity) { setMonths([]); setSelectedMonth(null); setRecords([]); return; }
    fetchMonths();
  }, [selectedCity]);

  // 월이 1개뿐이면 자동 선택 (관리 모드 진입 시)
  useEffect(() => {
    if (months.length === 1 && !selectedMonth) {
      handleSelectMonth(months[0]);
    }
  }, [months]);

  useEffect(() => {
    setDirtyRecords({});
    setDeletedRecordIds(new Set());
    setEditingCell(null);
    setSearchText('');
    setSearchInput('');
    setFilterGubun('');
    setFilterDong('');
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

  // cityId를 직접 받는 버전 (카드 클릭 시 state 갱신 전 호출 대응)
  const fetchRecordsFor = async (cityId, monthId, force = false) => {
    if (!force) {
      const cached = readRecsCache(cityId, monthId);
      if (cached) { setRecords(cached); setLoadingRecords(false); return; }
    }
    setLoadingRecords(true);
    try {
      const snap = await getDocs(collection(db, 'cloud_lists', cityId, 'months', monthId, 'records'));
      const recs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRecords(recs);
      writeRecsCache(cityId, monthId, recs);
    } catch (e) { console.error('[CloudListManager] fetchRecords:', e); }
    finally { setLoadingRecords(false); }
  };

  const fetchRecords = (monthId, force = false) => fetchRecordsFor(selectedCity, monthId, force);

  const fetchAllCities = useCallback(async () => {
    setLoadingCities(true);
    try {
      let docs;
      if (isAdmin) {
        // 관리자: cloud_lists 컬렉션 1회 읽기로 전체 도시 + 최신 통계 획득
        const snap = await getDocs(collection(db, 'cloud_lists'));
        docs = snap.docs;
      } else {
        // 일반 유저: 승인된 도시만 병렬 getDoc (보통 1~3개라 빠름)
        const results = await Promise.all(
          [...approvedCities].map(cityId => getDoc(doc(db, 'cloud_lists', cityId)))
        );
        docs = results.filter(d => d.exists());
      }
      const cities = docs
        .map(d => {
          const cityId = d.id;
          const data = d.data() || {};
          const spaceIdx = cityId.indexOf(' ');
          if (spaceIdx < 0) return null;
          const sido = cityId.slice(0, spaceIdx);
          const sigungu = cityId.slice(spaceIdx + 1);
          const lastMonthId = data.lastMonthId || null;
          const latestMonth = lastMonthId ? {
            id: lastMonthId,
            totalCount: data.latestTotalCount ?? 0,
            수급자Count: data['latest수급자Count'] ?? 0,
            차상위Count: data['latest차상위Count'] ?? 0,
          } : null;
          return { id: cityId, sido, sigungu, latestMonth };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const sidoCmp = a.sido.localeCompare(b.sido, 'ko');
          if (sidoCmp !== 0) return sidoCmp;
          return a.sigungu.localeCompare(b.sigungu, 'ko');
        });

      // 카드 카운트가 0인데 lastMonthId가 있으면 month 문서를 직접 읽어 자동 복구
      await Promise.all(
        cities
          .filter(c => c.latestMonth && c.latestMonth.totalCount === 0)
          .map(async (c) => {
            try {
              const monthSnap = await getDoc(doc(db, 'cloud_lists', c.id, 'months', c.latestMonth.id));
              if (!monthSnap.exists()) return;
              const m = monthSnap.data();
              const totalCount = m.totalCount ?? 0;
              const 수급자Count = m.수급자Count ?? 0;
              const 차상위Count = m.차상위Count ?? 0;
              c.latestMonth.totalCount = totalCount;
              c.latestMonth.수급자Count = 수급자Count;
              c.latestMonth.차상위Count = 차상위Count;
              // 최상위 문서 캐시도 동기화 (이후 로드 시 추가 읽기 불필요)
              if (totalCount > 0) {
                setDoc(doc(db, 'cloud_lists', c.id), {
                  latestTotalCount: totalCount,
                  'latest수급자Count': 수급자Count,
                  'latest차상위Count': 차상위Count,
                }, { merge: true }).catch(() => {});
              }
            } catch { /* 복구 실패 무시 */ }
          })
      );

      setCityList(cities);
    } catch (e) { console.error('[fetchAllCities]', e); }
    finally { setLoadingCities(false); }
  }, [isAdmin, approvedCities]);

  const handleSelectMonth = (month) => {
    setSelectedMonth(month);
    fetchRecordsFor(selectedCity, month.id);
  };

  const handleFetchBaseNotes = async () => {
    if (!selectedCity || !selectedMonth || !records.length) return;
    if (!confirm(`기본명단에서 특이사항을 불러와 현재 명단에 이식합니다.\n특이사항이 비어있는 레코드에만 적용됩니다. 계속하시겠습니까?`)) return;
    setIsFetchingNotes(true);
    try {
      const normPhone = (v) => (v || '').replace(/[^0-9]/g, '');
      const baseSnap = await getDocsFromServer(collection(db, `base_lists/${selectedCity}/records`));
      const baseRecs = baseSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const byBirth = {}, byPhone = {};
      baseRecs.forEach(r => {
        const name = (r.name || r.이름 || '').trim();
        const birth = r.birthKey || normalizeBirth(String(r.생년월일 || ''));
        const mobile = normPhone(r.mobile || r.휴대폰 || '');
        const note = (r.note || r.특이사항 || '').trim();
        if (!name || !note) return;
        if (birth) byBirth[`${name}__${birth}`] = note;
        if (mobile.length >= 9) byPhone[`${name}__${mobile}`] = note;
      });

      const updates = [];
      records.forEach(r => {
        if ((r.특이사항 || '').trim()) return;
        const name = (r.이름 || '').trim();
        const birth = normalizeBirth(String(r.생년월일 || ''));
        const mobile = normPhone(r.휴대폰 || '');
        let note = '';
        if (birth) note = byBirth[`${name}__${birth}`] || '';
        if (!note && mobile.length >= 9) note = byPhone[`${name}__${mobile}`] || '';
        if (note) updates.push({ id: r.id, 특이사항: note });
      });

      if (!updates.length) { alert('이식할 특이사항이 없습니다.\n(기본명단에 특이사항이 없거나 이미 모두 이식됨)'); return; }

      for (let i = 0; i < updates.length; i += 499) {
        const batch = writeBatch(db);
        updates.slice(i, i + 499).forEach(u =>
          batch.update(doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id, 'records', u.id), { 특이사항: u.특이사항 })
        );
        await batch.commit();
      }
      bustRecsCache(selectedCity, selectedMonth.id);
      await fetchRecords(selectedMonth.id, true);
      alert(`특이사항 이식 완료! ${updates.length}건 업데이트`);
    } catch (e) { alert('오류: ' + e.message); }
    finally { setIsFetchingNotes(false); }
  };

  const handleMovePhoneNumbers = async () => {
    if (!selectedCity || !selectedMonth || !records.length) return;
    const detectMobile = (phone) => {
      const digits = (phone || '').replace(/[^0-9]/g, '');
      if (/^01[016789]\d{7,8}$/.test(digits)) return digits;
      if (/^1[016789]\d{7,8}$/.test(digits)) return '0' + digits;
      return null;
    };
    const formatMobile = (digits) => {
      if (digits.length === 11) return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
      if (digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
      return digits;
    };
    const targets = records.filter(r => {
      const mobileDigits = (r.휴대폰 || '').replace(/[^0-9]/g, '');
      return !mobileDigits && detectMobile(r.유선전화);
    });
    if (!targets.length) { alert('이동할 전화번호가 없습니다.'); return; }
    if (!confirm(`유선전화에 있는 휴대폰 형식 번호 ${targets.length}건을 휴대폰으로 이동합니다.`)) return;
    setIsMovingPhones(true);
    try {
      for (let i = 0; i < targets.length; i += 499) {
        const batch = writeBatch(db);
        targets.slice(i, i + 499).forEach(r => {
          const digits = detectMobile(r.유선전화);
          batch.update(
            doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id, 'records', r.id),
            { 휴대폰: formatMobile(digits), 유선전화: '' }
          );
        });
        await batch.commit();
      }
      bustRecsCache(selectedCity, selectedMonth.id);
      await fetchRecords(selectedMonth.id, true);
      alert(`전화번호 이동 완료! ${targets.length}건`);
    } catch (e) { alert('오류: ' + e.message); }
    finally { setIsMovingPhones(false); }
  };

  // ── Delete month ──────────────────────────────────────────────────
  // deleteMonthConfirm: { month: {...}, city: string } | null
  const [isDeletingMonth, setIsDeletingMonth] = useState(false);
  const handleDeleteMonth = async () => {
    if (!deleteMonthConfirm) return;
    const { month, city } = deleteMonthConfirm;
    setDeleteMonthConfirm(null);
    setIsDeletingMonth(true);
    try {
      const rSnap = await getDocs(collection(db, 'cloud_lists', city, 'months', month.id, 'records'));
      for (let i = 0; i < rSnap.docs.length; i += 500) {
        const batch = writeBatch(db);
        rSnap.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, 'cloud_lists', city, 'months', month.id));
      try { await deleteObject(ref(storage, `cloud_uploads/${city}/${month.id}/original.xlsx`)); } catch { /* 없어도 무시 */ }
      if (selectedMonth?.id === month.id) { setSelectedMonth(null); setRecords([]); }
      // 도시 상위 문서도 최신 월로 갱신
      const remainingSnap = await getDocs(collection(db, 'cloud_lists', city, 'months'));
      const remaining = remainingSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.id.localeCompare(a.id));
      const newLatest = remaining[0] || null;
      await setDoc(doc(db, 'cloud_lists', city), {
        lastMonthId: newLatest?.id || null,
        latestTotalCount: newLatest?.totalCount ?? 0,
        'latest수급자Count': newLatest?.수급자Count ?? 0,
        'latest차상위Count': newLatest?.차상위Count ?? 0,
        lastUpdatedAt: serverTimestamp(),
      }, { merge: true });
      fetchMonths();
      fetchAllCities();
      alert(`${city} ${month.id} 명단이 삭제되었습니다.`);
    } catch (e) { alert('삭제 오류: ' + e.message); }
    finally { setIsDeletingMonth(false); }
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
          isPhone={key === '휴대폰' || key === '유선전화'}
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
          className={`cursor-text block text-center text-xs font-bold ${isDirty ? 'text-blue-300' : 'text-blue-400'}`}
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
      // 최상위 city 문서 캐시도 동기화
      await setDoc(doc(db, 'cloud_lists', selectedCity), {
        latestTotalCount: totalCount,
        'latest수급자Count': 수급자Count,
        'latest차상위Count': 차상위Count,
        lastUpdatedAt: serverTimestamp(),
      }, { merge: true });
      setDirtyRecords({});
      setDeletedRecordIds(new Set());
      bustRecsCache(selectedCity, selectedMonth.id);
      await fetchRecords(selectedMonth.id, true);
      await fetchMonths();
      alert(`저장 완료! (수정 ${modCount}건, 삭제 ${delCount}건)`);
    } catch (e) { alert('저장 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  // ── 좌표 받아오기 (VIP: 행정동 단위 수동 / VVIP: 업로드 후 백그라운드 자동) ──
  const [isFetchingCoords, setIsFetchingCoords] = useState(false);
  const [coordProgress, setCoordProgress] = useState(null); // { done, total } | null
  const bgCoordCancelRef = useRef(false);
  const [bgCoordState, setBgCoordState] = useState(null); // { done, total, success, isDone } | null

  // 공통 Kakao 지오코딩 엔진 — VIP 수동·VVIP 백그라운드 공유
  const _processCoords = async (targets, { cityId, monthId, concurrency, requestGap, cancelRef, onProgress }) => {
    const cityParts = cityId.split(/\s+/);
    const sido = cityParts[0] || '';
    const sigungu = cityParts[1] || '';
    const SIDO_SHORT = { '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구', '인천광역시': '인천', '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산', '세종특별자치시': '세종', '경기도': '경기', '강원특별자치도': '강원', '강원도': '강원', '충청북도': '충북', '충청남도': '충남', '전북특별자치도': '전북', '전라북도': '전북', '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주' };
    const sidoShort = SIDO_SHORT[sido] || sido;
    const cleanRoad = (addr) => addr.replace(/\s*\([^)]*\).*$/, '').replace(/,.*$/, '').trim();
    let successCount = 0;
    const updates = {};

    // Kakao API 호출 (429 지수 백오프 3회 재시도, 10s 타임아웃)
    const kakaoFetch = async (url) => {
      const go = async () => {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 10000);
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
      // 429 → 지수 백오프: 2s → 4s → 8s (최대 3회 재시도)
      for (const delay of [2000, 4000, 8000]) {
        if (res?.status !== 429) break;
        await new Promise(r => setTimeout(r, delay));
        res = await go();
      }
      return res;
    };

    // 검색 결과가 선택된 지자체 내인지 확인 (전체명·약칭 모두 허용)
    const isInRegion = (doc) => {
      if (!sido) return true;
      const addrStr = [
        doc.address_name || '',
        doc.road_address_name || '',
        doc.road_address?.address_name || '',
      ].join(' ');
      const hasSido = addrStr.includes(sido) || addrStr.includes(sidoShort);
      return hasSido && (!sigungu || addrStr.includes(sigungu));
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

    let doneCount = 0;
    const executing = new Set();
    let lastDispatch = 0;

    for (const r of targets) {
      if (cancelRef?.current) break;
      const now = Date.now();
      const gap = requestGap - (now - lastDispatch);
      if (gap > 0) await new Promise(res => setTimeout(res, gap));
      lastDispatch = Date.now();

      const p = (async () => {
        if (cancelRef?.current) return;
        const coord = await getCoord(r.주소, r.행정동);
        if (coord) { const { _step, ...latLng } = coord; updates[r.id] = latLng; successCount++; }
        doneCount++;
        onProgress?.(doneCount, successCount);
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
          batch.update(doc(db, 'cloud_lists', cityId, 'months', monthId, 'records', id), coord);
        });
        await batch.commit();
      }
      setRecords(prev => prev.map(r => updates[r.id] ? { ...r, ...updates[r.id] } : r));
    }
    return { success: successCount, total: targets.length };
  };

  // VIP: 단일 행정동 수동 좌표 매칭
  const handleFetchCoordsForDong = async () => {
    if (!selectedCity || !selectedMonth || !filterDong) return;
    const targets = records.filter(r => {
      const dong = dirtyRecords[r.id]?.행정동 ?? r.행정동;
      return r.주소 && !r.lat && !r.lng && dong === filterDong;
    });
    if (!targets.length) { alert(`[${filterDong}] 좌표가 없는 주소 데이터가 없습니다.`); return; }
    if (!window.confirm(`[${filterDong}] 좌표 없는 ${targets.length}건을 카카오 API로 조회합니다.\n계속하시겠습니까?`)) return;
    setIsFetchingCoords(true);
    setCoordProgress({ done: 0, total: targets.length });
    try {
      const result = await _processCoords(targets, {
        cityId: selectedCity, monthId: selectedMonth.id,
        concurrency: 3, requestGap: 80,
        cancelRef: { current: false },
        onProgress: (done) => setCoordProgress(prev => prev ? { ...prev, done } : prev),
      });
      alert(`✅ 좌표 보완 완료: ${result.success}/${result.total}건 성공`);
    } catch (e) { alert('좌표 보완 실패: ' + e.message); }
    finally { setIsFetchingCoords(false); setCoordProgress(null); }
  };

  // VVIP: 업로드 후 백그라운드 자동 좌표 매칭 (느리지만 안정적, 취소 가능)
  const triggerBgCoordFetch = async (cityId, monthId, allRecords) => {
    const targets = allRecords.filter(r => r.주소 && !r.lat && !r.lng);
    if (!targets.length) return;
    bgCoordCancelRef.current = false;
    setBgCoordState({ done: 0, total: targets.length, success: 0 });
    try {
      await _processCoords(targets, {
        cityId, monthId,
        concurrency: 1, requestGap: 1500,
        cancelRef: bgCoordCancelRef,
        onProgress: (done, success) => {
          if (!bgCoordCancelRef.current) setBgCoordState(prev => prev ? { ...prev, done, success } : null);
        },
      });
      if (!bgCoordCancelRef.current) {
        setBgCoordState(prev => prev ? { ...prev, isDone: true } : null);
        setTimeout(() => setBgCoordState(null), 8000);
      }
    } catch { setBgCoordState(null); }
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
      await setDoc(doc(db, 'cloud_lists', selectedCity), {
        latestTotalCount: 0, 'latest수급자Count': 0, 'latest차상위Count': 0, lastUpdatedAt: serverTimestamp(),
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
      await setDoc(doc(db, 'cloud_lists', selectedCity), {
        latestTotalCount: totalCount, 'latest수급자Count': 수급자Count, 'latest차상위Count': 차상위Count, lastUpdatedAt: serverTimestamp(),
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
        <button
          onClick={selectedMonth
            ? () => { setSelectedMonth(null); setMonths([]); setRecords([]); setSelectedSido(''); setSelectedSigungu(''); }
            : onBack}
          className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors"
        >
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
                onPointerDown={e => { e.preventDefault(); setShowOrgPreset(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-purple-950/40 hover:bg-purple-900/50 text-purple-400 border border-purple-500/30 transition-colors"
              >
                <Building2 size={13} /> 조직 배분
              </button>
            )}
            {onOpenRouteMap && (
              <button
                onClick={() => onOpenRouteMap(selectedCity, selectedMonth.id, orgDongs)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[#3b82f6]/15 hover:bg-[#3b82f6]/25 text-[#3b82f6] border border-[#3b82f6]/30 transition-colors"
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
            {records.length > 0 && (
              <button
                onClick={handleFetchBaseNotes}
                disabled={isFetchingNotes}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-amber-950/40 hover:bg-amber-900/50 text-amber-400 border border-amber-500/30 transition-colors disabled:opacity-40"
                title="기본명단에서 특이사항을 불러와 이식"
              >
                <BookOpen size={13} /> {isFetchingNotes ? '이식 중...' : '특이사항 불러오기'}
              </button>
            )}
            {records.length > 0 && (
              <button
                onClick={handleMovePhoneNumbers}
                disabled={isMovingPhones}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-400 border border-cyan-500/30 transition-colors disabled:opacity-40"
                title="유선전화에 있는 휴대폰 번호를 휴대폰으로 이동"
              >
                <Phone size={13} /> {isMovingPhones ? '이동 중...' : '전화번호 이동'}
              </button>
            )}
            {onOpenInResultGrid && records.length > 0 && (
              <button
                onClick={() => onOpenInResultGrid(selectedCity, selectedMonth.id, records)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-400 border border-emerald-500/40 transition-colors shadow-[0_0_10px_rgba(52,211,153,0.1)]"
                title="이 명단을 결과화면(Step 5)으로 불러옵니다"
              >
                <LayoutGrid size={13} /> 결과화면 열기
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

      {/* ── 카드 그리드 뷰 (월 미선택) ── */}
      {!selectedMonth ? (
        <div className="flex-1 overflow-y-auto p-6">
          {loadingCities ? (
            <div className="flex items-center justify-center h-40 text-gray-600 text-sm animate-pulse">불러오는 중...</div>
          ) : cityList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-60 gap-4 text-gray-700">
              <Calendar size={40} className="opacity-20" />
              <p className="text-sm">저장된 배송명단이 없습니다</p>
            </div>
          ) : (
            Object.entries(citiesBySido).map(([sido, cities]) => (
              <div key={sido} className="mb-10">
                <p className="text-[11px] text-gray-600 font-black tracking-widest uppercase mb-4 px-1 flex items-center gap-2">
                  <span className="flex-1 h-px bg-[#1a1a1a]" />
                  {sido}
                  <span className="flex-1 h-px bg-[#1a1a1a]" />
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                  {cities.map(cityItem => {
                    const m = cityItem.latestMonth;
                    return (
                      <button
                        key={cityItem.id}
                        onClick={() => handleOpenCity(cityItem)}
                        disabled={!m}
                        className={`group relative text-left p-5 rounded-2xl border transition-all duration-200 ${
                          m
                            ? 'bg-[#0c0c0c] border-[#1e1e1e] hover:bg-[#121a2a] hover:border-[#3b82f6]/40 hover:shadow-[0_0_20px_rgba(59,130,246,0.08)] cursor-pointer'
                            : 'bg-[#0a0a0a] border-[#181818] opacity-50 cursor-not-allowed'
                        }`}
                      >
                        {/* 관리 모드 버튼 (관리자만) */}
                        {isAdmin && m && (
                          <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 flex gap-1 transition-all">
                            <button
                              onClick={e => { e.stopPropagation(); handleAdminMode(cityItem); }}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-600 hover:text-gray-300 transition-all"
                              title="인라인 편집 모드"
                            >
                              <FileSpreadsheet size={12} />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); setDeleteMonthConfirm({ month: m, city: cityItem.id }); }}
                              className="p-1.5 rounded-lg bg-red-950/30 hover:bg-red-950/60 text-red-700 hover:text-red-400 transition-all"
                              title={`${m.id} 명단 삭제`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}

                        {/* 도시명 */}
                        <div className="mb-3">
                          <p className="text-lg font-black text-white leading-tight">{cityItem.sigungu}</p>
                          <p className="text-[11px] text-gray-600 mt-0.5">{cityItem.sido}</p>
                        </div>

                        {m ? (
                          <>
                            {/* 월 배지 */}
                            <div className="flex items-center gap-1.5 mb-3">
                              <Calendar size={11} className="text-blue-400" />
                              <span className="text-xs font-black text-blue-400">{m.id}</span>
                            </div>
                            {/* 통계 */}
                            <div className="grid grid-cols-3 gap-2">
                              <div className="bg-black/40 rounded-xl p-2 text-center">
                                <p className="text-[15px] font-black text-white">{(m.totalCount||0).toLocaleString()}</p>
                                <p className="text-[9px] text-gray-600 mt-0.5 font-bold">전체</p>
                              </div>
                              <div className="bg-black/40 rounded-xl p-2 text-center">
                                <p className="text-[15px] font-black text-amber-400">{(m.수급자Count||0).toLocaleString()}</p>
                                <p className="text-[9px] text-gray-600 mt-0.5 font-bold">수급자</p>
                              </div>
                              <div className="bg-black/40 rounded-xl p-2 text-center">
                                <p className="text-[15px] font-black text-blue-400">{(m.차상위Count||0).toLocaleString()}</p>
                                <p className="text-[9px] text-gray-600 mt-0.5 font-bold">차상위</p>
                              </div>
                            </div>
                          </>
                        ) : (
                          <p className="text-[11px] text-gray-700">저장된 명단 없음</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

      ) : (

        /* ── 관리 뷰 (월 선택됨) ── */
        <div className="flex-1 flex flex-col overflow-hidden">
          {loadingRecords ? (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-sm animate-pulse">레코드 불러오는 중...</div>
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
                  {isAdmin && (
                    <button
                      onClick={() => setDeleteMonthConfirm({ month: selectedMonth, city: selectedCity })}
                      disabled={isDeletingMonth}
                      className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold text-red-500 hover:text-red-300 bg-red-950/30 hover:bg-red-950/50 border border-red-700/30 transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={11} /> 이 월 삭제
                    </button>
                  )}
                </div>
              </div>

              {/* Search toolbar */}
              <div className="shrink-0 border-b border-[#181818] flex items-center px-4 gap-2.5 bg-[#080808] py-2 flex-wrap">
                {/* 텍스트 검색 */}
                <div className="relative w-56">
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
                {/* 구분 콤보박스 */}
                <select
                  value={filterGubun}
                  onChange={e => setFilterGubun(e.target.value)}
                  className="bg-black/70 border border-[#2a2a2a] rounded-xl px-2.5 py-1.5 text-xs text-white outline-none focus:border-blue-500/50 cursor-pointer"
                >
                  <option value="">구분 전체</option>
                  <option value="기초수급자">기초수급자</option>
                  <option value="차상위">차상위</option>
                </select>
                {/* 행정동 콤보박스 */}
                <select
                  value={filterDong}
                  onChange={e => setFilterDong(e.target.value)}
                  className="bg-black/70 border border-[#2a2a2a] rounded-xl px-2.5 py-1.5 text-xs text-white outline-none focus:border-blue-500/50 cursor-pointer"
                >
                  <option value="">행정동 전체</option>
                  {cloudDongList.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                {/* VIP+: 단일 행정동 선택 시 좌표 받아오기 버튼 */}
                {filterDong && canUseCoords(user) && (
                  <button
                    onClick={handleFetchCoordsForDong}
                    disabled={isFetchingCoords}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-blue-950/40 hover:bg-blue-900/50 text-blue-400 border border-blue-500/30 transition-colors disabled:opacity-40 shrink-0"
                  >
                    {isFetchingCoords
                      ? <><span className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin inline-block" /> {coordProgress ? `${coordProgress.done}/${coordProgress.total}건` : '준비중...'}</>
                      : <><MapPin size={11} /> {filterDong} 좌표받기</>}
                  </button>
                )}
                {/* 초기화 */}
                {(searchText || filterGubun || filterDong) && (
                  <button
                    onClick={() => { setSearchInput(''); setSearchText(''); setFilterGubun(''); setFilterDong(''); }}
                    className="text-[10px] text-gray-600 hover:text-red-400 border border-[#2a2a2a] hover:border-red-700/40 rounded-lg px-2 py-1.5 transition-colors"
                  >
                    초기화
                  </button>
                )}
                <span className="text-[11px] text-gray-600">
                  {displayRecords.length.toLocaleString()}건 표시
                  {(searchText || filterGubun || filterDong) && ` (전체 ${records.filter(r => !deletedRecordIds.has(r.id)).length.toLocaleString()}건 중)`}
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
                          <div className="h-full rounded-full bg-[#3b82f6]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-[#3b82f6] font-bold whitespace-nowrap">
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
      )}

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
            <p className="text-gray-300 text-sm font-bold mb-1">{deleteMonthConfirm.city} — {deleteMonthConfirm.month.id}</p>
            <p className="text-gray-600 text-xs mb-5 leading-relaxed">
              총 {(deleteMonthConfirm.month.totalCount||0).toLocaleString()}건의 데이터와 원본 파일이 영구 삭제됩니다.<br />이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteMonthConfirm(null)}
                className="flex-1 py-2.5 bg-white/5 border border-[#333] text-gray-400 font-bold rounded-xl text-sm hover:bg-white/10 transition-colors">
                취소
              </button>
              <button onClick={handleDeleteMonth}
                className="flex-1 py-2.5 bg-red-950/60 border border-red-500/50 text-red-400 font-bold rounded-xl text-sm hover:bg-red-900/60 transition-colors">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ VVIP 백그라운드 좌표 매칭 플로팅 표시기 ═══ */}
      {bgCoordState && (
        <div className="fixed bottom-5 right-5 z-[200] bg-[#111] border border-[#2a2a2a] rounded-2xl px-4 py-3 shadow-2xl text-xs flex items-center gap-3 min-w-[260px] max-w-xs">
          {bgCoordState.isDone ? (
            <>
              <CheckCircle size={14} className="text-green-400 shrink-0" />
              <span className="text-gray-300 flex-1">
                좌표 자동매칭 완료
                <span className="text-green-400 font-black ml-1">{bgCoordState.success}/{bgCoordState.total}건</span>
              </span>
              <button onClick={() => setBgCoordState(null)} className="text-gray-600 hover:text-white ml-1">
                <X size={12} />
              </button>
            </>
          ) : (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-gray-400 font-bold truncate">좌표 백그라운드 매칭 중</span>
                  <span className="text-blue-400 font-black ml-2 shrink-0">{bgCoordState.done}/{bgCoordState.total}</span>
                </div>
                <div className="w-full bg-[#222] rounded-full h-1">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${bgCoordState.total > 0 ? Math.round(bgCoordState.done / bgCoordState.total * 100) : 0}%` }}
                  />
                </div>
              </div>
              <button
                onClick={() => { bgCoordCancelRef.current = true; setBgCoordState(null); }}
                className="text-[10px] text-gray-600 hover:text-red-400 shrink-0 ml-1 font-bold"
              >
                중단
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
