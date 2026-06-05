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
  Wand2, AlertTriangle, List, Eraser, Columns,
} from 'lucide-react';
import OrgPresetModal from './OrgPresetModal.jsx';
import CoordBrushModal from './CoordBrushModal.jsx';
import ColOrderPanel from './ColOrderPanel.jsx';
import ColResizeHandle from './ColResizeHandle.jsx';
import { processAddress, asyncPool } from '../engine/addressEngine.js';
import { canUseCoords, canUseCoordsBg } from '../utils/tierUtils.js';
import { orderFieldsByExport, hasRi, getColWidth, setColWidthInCols, colCellStyle } from '../utils/colOrder.js';

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
  { key: '행정동',   label: '읍면동',   minW: '75px',  type: 'text' },
  { key: '리',       label: '리',       minW: '60px',  type: 'text' },
  { key: '주소',     label: '주소',     minW: '210px', type: 'text' },
  { key: '휴대폰',   label: '휴대폰',   minW: '110px', type: 'text' },
  { key: '유선전화', label: '유선전화', minW: '110px', type: 'text' },
  { key: '포수',     label: '포수',     minW: '50px',  type: 'number' },
  { key: '특이사항', label: '특이사항', minW: '140px', type: 'text' },
  { key: '기사',     label: '기사',     minW: '70px',  type: 'text' },
  { key: '배송순번', label: '순번',     minW: '50px',  type: 'text' },
];

const ROW_HEIGHT = 36; // px — 고정 행 높이

const normalizeRoadAddressCompareKey = (addr) => {
  const text = String(addr || '')
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';

  const formatRoadKey = (road, mainNo, subNo) => {
    const adminSuffixCount = (road.match(/특별시|광역시|특별자치시|특별자치도|자치도|도|시|군|구|읍|면|리/g) || []).length;
    const roadName = adminSuffixCount >= 2
      ? road.replace(/^(?:[가-힣]+?(?:특별시|광역시|특별자치시|특별자치도|자치도|도|시|군|구|읍|면|리))+/, '') || road
      : road;
    const main = String(Number(mainNo));
    const sub = subNo ? `-${Number(subNo)}` : '';
    return `${roadName} ${main}${sub}`;
  };

  const candidates = [
    text,
    text.replace(/\([^)]*\)/g, ' '),
    text.split(',')[0] || text,
  ];

  for (const candidate of candidates) {
    const spaced = candidate.replace(/\s+/g, ' ').trim();
    const spacedMatch = spaced.match(/([가-힣A-Za-z0-9·.\-]+(?:대로|로|길|가))\s*(\d+)(?:\s*-\s*(\d+))?/);
    if (spacedMatch) return formatRoadKey(spacedMatch[1], spacedMatch[2], spacedMatch[3]);

    const compact = candidate.replace(/\s+/g, '');
    const compactMatch = compact.match(/([가-힣A-Za-z0-9·.\-]+(?:대로|로|길|가))(\d+)(?:-(\d+))?/);
    if (compactMatch) return formatRoadKey(compactMatch[1], compactMatch[2], compactMatch[3]);
  }

  return '';
};

const hasRoadAddressChanged = (prevAddr, currentAddr) => {
  const prevKey = normalizeRoadAddressCompareKey(prevAddr);
  const currentKey = normalizeRoadAddressCompareKey(currentAddr);
  return Boolean(prevKey && currentKey && prevKey !== currentKey);
};

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

const VirtualTable = memo(function VirtualTable({ fields, exportColOrder, onColResize, displayRecords, dirtyRecords, deletedRecordIds, loadingRecords, records, renderCell, setDeletedRecordIds }) {
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
    <div className="flex-1 flex items-center justify-center gap-2 text-emerald-400 text-sm animate-pulse">
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
              {fields.map(f => {
                const w = getColWidth(exportColOrder, f.key);
                return (
                  <th key={f.key} style={{ ...(colCellStyle(w) || { minWidth: f.minW }), position: 'relative' }} className={`px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider overflow-hidden ${f.key === '기사' || f.key === '배송순번' ? 'text-[#3b82f6]/60' : 'text-gray-600'}`}>
                    {f.label}
                    {onColResize && <ColResizeHandle colKey={f.key} currentWidth={w} onResize={onColResize} />}
                  </th>
                );
              })}
              <th className="px-3 py-2.5 text-[10px] text-blue-600/60 font-bold w-12">좌표</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && <tr><td style={{ height: paddingTop }} colSpan={fields.length + 3} /></tr>}
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
                  {fields.map(f => (
                    <td key={f.key} style={colCellStyle(getColWidth(exportColOrder, f.key)) || { minWidth: f.minW }} className="px-3 py-2 max-w-0 overflow-hidden">
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
            {paddingBottom > 0 && <tr><td style={{ height: paddingBottom }} colSpan={fields.length + 3} /></tr>}
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

export default function CloudListManager({ user, onBack, initialCity = '', onOpenRouteMap, onOpenInResultGrid, exportColOrder = [], setExportColOrder, defaultExportCols = [] }) {
  const isAdmin = user?.role === 'admin';
  const approvedCities = user?.citiesApproved || [];

  // 칼럼 순서·표시 — exportColOrder(전역, 엑셀·정제결과와 공유) 기준으로 CLOUD_FIELDS 재정렬
  const orderedFields = useMemo(() => orderFieldsByExport(CLOUD_FIELDS, exportColOrder), [exportColOrder]);
  const [showColOrder, setShowColOrder] = useState(false);
  const colOrderBtnRef = useRef(null);
  // 칼럼 폭 드래그 → exportColOrder에 저장(계정 동기화)
  const handleColResize = (key, px) => { if (setExportColOrder) setExportColOrder(prev => setColWidthInCols(prev, key, px)); };

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

  // 리(里)는 데이터가 있을 때만 표시(군 지역). 시/구 명단에선 칼럼 숨김.
  const riPresent = useMemo(() => hasRi(records), [records]);
  const displayFields = useMemo(
    () => (riPresent ? orderedFields : orderedFields.filter(c => c.key !== '리')),
    [orderedFields, riPresent]
  );

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
  //   ★ Phase 5(무리프레시 편집): dirtyRecords(편집 버퍼)를 의존성에서 제외.
  //   정렬·필터·검색을 "확정된 레코드 값" 기준으로 고정해 편집 중 행이 점프/소멸하지
  //   않게 한다(끊김 제거). 편집값은 renderCell이 셀에만 즉시 반영하고, [변경사항 저장]
  //   으로 records가 갱신되는 순간 자연스럽게 재정렬된다.
  const displayRecords = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return records
      .filter(r => {
        if (deletedRecordIds.has(r.id)) return false;
        if (orgDongs && !orgDongs.has((r.행정동 || '').trim())) return false;
        if (filterGubun && (r.구분 ?? '') !== filterGubun) return false;
        if (filterDong && (r.행정동 ?? '') !== filterDong) return false;
        if (!q) return true;
        return [r.이름, r.행정동, r.주소, r.휴대폰, r.특이사항]
          .some(v => String(v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => {
        let cmp = (a.행정동 ?? '').localeCompare(b.행정동 ?? '', 'ko', { numeric: true });
        if (cmp !== 0) return cmp;
        // 리(里): 읍/면 하위 단위. 리 없으면 빈값으로 자연 통과
        cmp = (a.리 ?? '').localeCompare(b.리 ?? '', 'ko', { numeric: true });
        if (cmp !== 0) return cmp;
        cmp = (a.주소 ?? '').localeCompare(b.주소 ?? '', 'ko', { numeric: true });
        if (cmp !== 0) return cmp;
        return (a.이름 ?? '').localeCompare(b.이름 ?? '', 'ko', { numeric: true });
      });
  }, [records, deletedRecordIds, searchText, orgDongs, filterGubun, filterDong]);

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
    // 지자체 접두어 — 항상 포함하여 타 지역 동명 도로 오매칭 완전 차단
    // 예) "장한로27길 29" → "동대문구 장한로27길 29"
    const cityPrefix = sigungu || sido; // 시군구 우선, 없으면 시도

    //   1) 지자체+도로명 address 검색
    //   2) 지자체+도로명 keyword 검색 (파싱 실패 보완)
    //   3) 지자체+전체주소(건물명 포함) keyword 검색
    //   4) 행정동+건물명 keyword 검색 (건물명 전용)
    // ※ 모든 단계에 반드시 지자체 컨텍스트 포함 — 도로명 단독 검색 금지
    const getCoord = async (주소, 행정동 = '') => {
      const road = cleanRoad(주소);
      const prefixedRoad = cityPrefix ? `${cityPrefix} ${road}` : road;

      // 1단계: 지자체+도로명으로 address 검색 (가장 정확)
      const res1 = await kakaoFetch(
        `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(prefixedRoad)}&size=5`
      );
      if (res1?.ok) {
        const docs = (await res1.json()).documents || [];
        const d = docs.find(isInRegion);
        if (d?.x && d?.y) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 1 };
      }

      // 2단계: 지자체+도로명으로 keyword 검색 (address 파싱 실패 보완)
      const res2 = await kakaoFetch(
        `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(prefixedRoad)}&size=5`
      );
      if (res2?.ok) {
        const docs = (await res2.json()).documents || [];
        const d = docs.find(isInRegion);
        if (d?.x && d?.y) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 2 };
      }

      // 3단계: 지자체+전체주소(건물명 포함) keyword 검색 (아파트 단지명 등)
      const fullQuery = cityPrefix ? `${cityPrefix} ${주소}` : 주소;
      if (fullQuery !== prefixedRoad) {
        const res3 = await kakaoFetch(
          `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(fullQuery)}&size=5`
        );
        if (res3?.ok) {
          const docs = (await res3.json()).documents || [];
          const d = docs.find(isInRegion);
          if (d?.x && d?.y) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 3 };
        }
      }

      // 4단계: 행정동+건물명 keyword 검색 (건물명만 있는 경우 — 주민센터·구청 등)
      const isOnlyBuildingName = !/\d+(-\d+)?(로|길|번길|번지|가)\b/.test(road);
      if (isOnlyBuildingName) {
        const dongPrefix = 행정동?.trim() || sigungu;
        const step4Query = dongPrefix ? `${dongPrefix} ${road}` : `${sido} ${road}`;
        const res4 = await kakaoFetch(
          `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(step4Query)}&size=5`
        );
        if (res4?.ok) {
          const docs = (await res4.json()).documents || [];
          const d = docs.find(isInRegion) || docs.find(doc => doc.category_group_code === 'PO3');
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

  // ── 좌표 삭제 브러시 ─────────────────────────────────────────────────
  const [showCoordBrush, setShowCoordBrush] = useState(false);

  const handleCoordBrushApply = useCallback((deletedIds) => {
    setDirtyRecords(prev => {
      const next = { ...prev };
      deletedIds.forEach(id => {
        next[id] = { ...(next[id] || {}), lat: null, lng: null };
      });
      return next;
    });
    setRecords(prev => prev.map(r => deletedIds.has(r.id) ? { ...r, lat: null, lng: null } : r));
    setShowCoordBrush(false);
  }, []);

  // ── 주소 정제 ───────────────────────────────────────────────────────
  const [isRefiningAddr, setIsRefiningAddr] = useState(false);
  const [isFillingRi, setIsFillingRi] = useState(false); // 리(里) 채우기
  const [refineProgress, setRefineProgress] = useState(null); // null | {current, total}
  const [addrChanges, setAddrChanges] = useState([]);         // 변경된 주소 목록
  const [showAddrChanges, setShowAddrChanges] = useState(false);
  const [dongAddrWarnings, setDongAddrWarnings] = useState({}); // {dong: count}
  const [addrChangeTab, setAddrChangeTab] = useState('dong');  // 'dong' | 'list'

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

  // ── 주소 정제 (저장된 명단에 addressEngine 직접 적용) ────────────────
  const handleRefineAddresses = async () => {
    if (!records.length || isRefiningAddr) return;
    if (!confirm(`${records.length.toLocaleString()}건의 주소를 정제합니다.\n기존 주소와 다른 경우 변경 목록에 표시되며, '변경사항 저장'으로 확정됩니다. 계속할까요?`)) return;

    setIsRefiningAddr(true);
    setRefineProgress({ current: 0, total: records.length });
    setAddrChanges([]);
    setDongAddrWarnings({});

    // 저번달 delivery_history 로드 (name+birthKey 또는 name+phone 키)
    const prevMap = new Map();
    try {
      const now = new Date();
      const pd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevId = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
      const prevSnap = await getDocs(collection(db, 'delivery_history', selectedCity, 'months', prevId, 'records'));
      prevSnap.docs.forEach(d => {
        const r = d.data();
        const digits = v => String(v || '').replace(/[^\d]/g, '');
        const k1 = r.birthKey ? `${r.name}__${r.birthKey}` : null;
        const ph = digits(r.mobile || '').slice(-7);
        const k2 = ph.length >= 7 ? `${r.name}__${ph}` : null;
        if (k1) prevMap.set(k1, r.address || '');
        if (k2) prevMap.set(k2, r.address || '');
      });
    } catch (e) { console.warn('[주소정제] 저번달 로드 실패:', e); }

    const changes = [];
    const dirtyUpdates = {};
    let current = 0;

    // 휴대폰/유선 스왑 판별 — 휴대폰칸이 휴대폰형식 아니고 유선칸이 휴대폰형식이면 맞바꿈
    const detectMobile = (phone) => {
      const d = String(phone || '').replace(/[^0-9]/g, '');
      if (/^01[016789]\d{7,8}$/.test(d)) return d;
      if (/^1[016789]\d{7,8}$/.test(d)) return '0' + d;
      return null;
    };
    const fmtMobile = (d) => d.length === 11 ? `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`
      : d.length === 10 ? `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}` : d;

    await asyncPool(20, records, async (rec) => {
      try {
        // A-21: 주소·특이사항 내 동사무소/읍사무소/면사무소 → 주민센터 정규화
        const normNote = (rec.특이사항 || '').replace(/동사무소|읍사무소|면사무소/g, '주민센터');
        const normAddr = (rec.주소 || '').replace(/동사무소|읍사무소|면사무소/g, '주민센터');
        if (normNote !== (rec.특이사항 || '') || normAddr !== (rec.주소 || '')) {
          dirtyUpdates[rec.id] = {
            ...(dirtyUpdates[rec.id] || {}),
            ...(normNote !== (rec.특이사항 || '') ? { 특이사항: normNote } : {}),
            ...(normAddr !== (rec.주소 || '') ? { 주소: normAddr } : {}),
          };
        }

        const refined = await processAddress(
          normAddr, rec.이름 || '', rec.행정동 || '', selectedCity, normNote, { includeCoords: false }
        );
        current++;
        setRefineProgress({ current, total: records.length });

        const oldAddr = (rec.주소 || '').trim();
        const newAddr = (refined.주소 || '').trim();
        // 리(里) 백필: 주소가 안 바뀌어도 리가 비어있거나 다르면 채운다 (읍/면 배정 매칭용)
        const riNeedsUpdate = !!refined.리 && refined.리 !== (rec.리 || '');
        const addrChanged = !!newAddr && (newAddr !== oldAddr || refined.확인필요);
        // 전화번호 교정: 휴대폰칸은 휴대폰형식만 유지.
        //  ① 휴대폰칸이 비휴대폰/빈값 + 유선칸 휴대폰형식 → 맞바꿈(휴대폰←유선, 유선←기존 휴대폰칸값)
        //  ② 유선에 휴대폰 없고 휴대폰칸에 비휴대폰 값 있고 유선 비었으면 → 유선으로 이동(휴대폰 비움)
        const curMob = String(rec.휴대폰 || '');
        const curLand = String(rec.유선전화 || '');
        const landAsMobile = detectMobile(curLand);
        let phoneUpdate = null;
        if (!detectMobile(curMob)) {
          if (landAsMobile) phoneUpdate = { 휴대폰: fmtMobile(landAsMobile), 유선전화: curMob };
          else if (curMob && !curLand) phoneUpdate = { 휴대폰: '', 유선전화: curMob };
        }
        const phoneSwap = !!phoneUpdate;
        if (!addrChanged && !riNeedsUpdate && !phoneSwap) return;

        if (addrChanged) {
          // 저번달 주소 매칭
          const digits = v => String(v || '').replace(/[^\d]/g, '');
          const ph = digits(rec.휴대폰 || '').slice(-7);
          const k1 = rec.생년월일 ? `${rec.이름}__${rec.생년월일}` : null;
          const k2 = ph.length >= 7 ? `${rec.이름}__${ph}` : null;
          const prevAddr = (k1 && prevMap.get(k1)) || (k2 && prevMap.get(k2)) || null;

          // 변경 유형 자동 감지 — 도로명+번호 기준 유사값 비교
          // 도로명+건물번호가 둘 다 잡힌 경우에만 이사로 본다. 상세주소/괄호/띄어쓰기는 무시.
          let changeType = '정제';
          if (refined.확인필요) changeType = '오류';
          else if (prevAddr && hasRoadAddressChanged(prevAddr, newAddr)) changeType = '이사';

          changes.push({
            rowId: rec.id,
            이름: rec.이름 || '',
            생년월일: rec.생년월일 || '',
            행정동: rec.행정동 || '미분류',
            oldAddr,
            newAddr,
            prevAddr: prevAddr || null,
            changeType,
            status: 'pending',   // pending | reverted
            _에러: !!refined.확인필요,
          });
        }

        dirtyUpdates[rec.id] = {
          ...(dirtyUpdates[rec.id] || {}),
          ...(addrChanged ? { 주소: newAddr } : {}),
          ...(riNeedsUpdate ? { 리: refined.리 } : {}),
          ...(phoneUpdate || {}),
          ...(refined.확인필요 ? { 확인필요: true, 확인사유: refined.확인사유 || '' } : {}),
        };
      } catch {
        current++;
        setRefineProgress({ current, total: records.length });
      }
    });

    // dirtyRecords에 변경사항 반영 (기존 저장 메커니즘 활용)
    if (Object.keys(dirtyUpdates).length > 0) {
      setDirtyRecords(prev => ({ ...prev, ...dirtyUpdates }));
    }

    // 행정동별 저번달 대비 주소 변경 건수 (경고 기준: 10건+)
    const dongCount = {};
    records.forEach(rec => {
      const digits = v => String(v || '').replace(/[^\d]/g, '');
      const ph = digits(rec.휴대폰 || '').slice(-7);
      const k1 = rec.생년월일 ? `${rec.이름}__${rec.생년월일}` : null;
      const k2 = ph.length >= 7 ? `${rec.이름}__${ph}` : null;
      const prevAddr = (k1 && prevMap.get(k1)) || (k2 && prevMap.get(k2)) || null;
      if (!prevAddr) return;
      const currentAddr = (dirtyUpdates[rec.id]?.주소 || rec.주소 || '').trim();
      if (hasRoadAddressChanged(prevAddr, currentAddr)) {
        const dong = rec.행정동 || '미분류';
        dongCount[dong] = (dongCount[dong] || 0) + 1;
      }
    });
    setDongAddrWarnings(dongCount);

    setAddrChanges(changes);
    setIsRefiningAddr(false);
    setRefineProgress(null);
    setAddrChangeTab('dong');

    if (changes.length > 0) {
      setShowAddrChanges(true);
    } else {
      const riCount = Object.values(dirtyUpdates).filter(u => u.리 !== undefined).length;
      const phCount = Object.values(dirtyUpdates).filter(u => u.휴대폰 !== undefined).length;
      const msgs = [];
      if (riCount > 0) msgs.push(`리(里) ${riCount}건`);
      if (phCount > 0) msgs.push(`전화번호 교정 ${phCount}건`);
      alert(msgs.length
        ? `주소 변경은 없으나 ${msgs.join(', ')}을 처리했습니다.\n[변경사항 저장]으로 확정하세요.`
        : '변경된 주소가 없습니다. 이미 모두 정제된 상태입니다.');
    }
  };

  // ── 리(里) 채우기 — 읍/면 주소에서 리만 추출해 채움 (주소·다른 항목 불변) ────
  const handleFillRi = async () => {
    if (!records.length || isFillingRi) return;
    const targets = records.filter(r =>
      !deletedRecordIds.has(r.id) && !String(dirtyRecords[r.id]?.리 ?? r.리 ?? '').trim()
    );
    if (!targets.length) { alert('리(里)가 비어있는 레코드가 없습니다.\n(이미 채워졌거나 동 단위 지역입니다)'); return; }
    if (!confirm(`${targets.length.toLocaleString()}건에서 리(里)를 추출해 채웁니다.\n주소·다른 항목은 변경하지 않습니다. 계속할까요?`)) return;
    setIsFillingRi(true);
    setRefineProgress({ current: 0, total: targets.length });
    const dirtyUpdates = {};
    let filled = 0, current = 0;
    await asyncPool(10, targets, async (rec) => {
      try {
        const refined = await processAddress(rec.주소 || '', rec.이름 || '', rec.행정동 || '', selectedCity, rec.특이사항 || '', { includeCoords: false });
        const ri = (refined.리 || '').trim();
        if (ri) { dirtyUpdates[rec.id] = { ...(dirtyUpdates[rec.id] || {}), 리: ri }; filled++; }
      } catch { /* skip */ }
      current++;
      setRefineProgress({ current, total: targets.length });
    });
    if (Object.keys(dirtyUpdates).length) setDirtyRecords(prev => ({ ...prev, ...dirtyUpdates }));
    setIsFillingRi(false);
    setRefineProgress(null);
    alert(filled > 0
      ? `리(里) ${filled}건을 채웠습니다.\n[변경사항 저장]으로 확정하세요.`
      : '추출된 리(里)가 없습니다.\n(읍/면 지역만 리가 있습니다)');
  };

  // 개별 변경 원복 (dirtyRecords에서 주소 제거)
  const handleRevertAddrChange = (rowId) => {
    setAddrChanges(prev => prev.map(c => c.rowId === rowId ? { ...c, status: 'reverted' } : c));
    setDirtyRecords(prev => {
      const entry = { ...(prev[rowId] || {}) };
      delete entry.주소; delete entry.확인필요; delete entry.확인사유;
      const next = { ...prev };
      if (!Object.keys(entry).length) delete next[rowId]; else next[rowId] = entry;
      return next;
    });
  };

  // 원복된 항목 재적용
  const handleReApplyAddrChange = (change) => {
    setAddrChanges(prev => prev.map(c => c.rowId === change.rowId ? { ...c, status: 'pending' } : c));
    setDirtyRecords(prev => ({
      ...prev,
      [change.rowId]: {
        ...(prev[change.rowId] || {}),
        주소: change.newAddr,
        ...(change._에러 ? { 확인필요: true } : {}),
      },
    }));
  };

  // 변경 유형 수동 지정
  const handleMarkChangeType = (rowId, type) => {
    setAddrChanges(prev => prev.map(c => c.rowId === rowId ? { ...c, changeType: type } : c));
  };

  // 전체 원복
  const handleRevertAllAddrChanges = () => {
    if (!confirm('모든 주소 정제 변경사항을 원복하시겠습니까?')) return;
    setAddrChanges(prev => prev.map(c => ({ ...c, status: 'reverted' })));
    setDirtyRecords(prev => {
      const next = { ...prev };
      addrChanges.forEach(({ rowId }) => {
        const entry = { ...(next[rowId] || {}) };
        delete entry.주소; delete entry.확인필요; delete entry.확인사유;
        if (!Object.keys(entry).length) delete next[rowId]; else next[rowId] = entry;
      });
      return next;
    });
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
          <h1 className="text-sm font-black text-white leading-tight truncate">이번달 배송명단</h1>
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
            {records.length > 0 && (
              <button
                onClick={handleRefineAddresses}
                disabled={isRefiningAddr}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-violet-950/40 hover:bg-violet-900/50 text-violet-400 border border-violet-500/30 transition-colors disabled:opacity-40"
                title="저장된 명단의 주소를 정제합니다"
              >
                <Wand2 size={13} /> {isRefiningAddr ? '정제 중...' : '주소 정제'}
              </button>
            )}
            {records.length > 0 && (
              <button
                onClick={handleFillRi}
                disabled={isFillingRi || isRefiningAddr}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-500/30 transition-colors disabled:opacity-40"
                title="읍/면 주소에서 리(里)를 추출해 리 컬럼을 채웁니다 (주소 불변)"
              >
                <MapPin size={13} /> {isFillingRi ? '리 채우는 중...' : '리 채우기'}
              </button>
            )}
            {addrChanges.length > 0 && (
              <button
                onClick={() => setShowAddrChanges(true)}
                className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-amber-950/40 hover:bg-amber-900/50 text-amber-400 border border-amber-500/30 transition-colors"
                title="주소 정제로 변경된 항목 확인"
              >
                <AlertTriangle size={13} />
                주소변경확인
                <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-black text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center leading-none">
                  {addrChanges.filter(c => c.status === 'pending').length}
                </span>
              </button>
            )}
            {records.some(r => r.lat && r.lng) && (
              <button
                onClick={() => setShowCoordBrush(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-400 border border-cyan-500/30 transition-colors"
                title="잘못 매칭된 좌표를 브러시로 선택해 삭제"
              >
                <Eraser size={13} /> 좌표 삭제 브러시
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
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400" />
                  <input
                    type="text" value={searchInput}
                    onChange={e => handleSearchChange(e.target.value)}
                    placeholder="이름, 읍면동, 주소, 연락처 검색..."
                    className="w-full bg-[#0a1410] border-2 border-emerald-500/50 rounded-xl pl-8 pr-7 py-1.5 text-xs font-bold text-white outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30 focus:bg-[#0c1a13] placeholder:text-gray-500 placeholder:font-normal shadow-[0_0_14px_rgba(16,185,129,0.18)] transition-all"
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
                {/* 칼럼 순서·표시 (엑셀·정제결과와 공유) */}
                {setExportColOrder && exportColOrder.length > 0 && (
                  <div className="relative shrink-0">
                    <button
                      ref={colOrderBtnRef}
                      onClick={() => setShowColOrder(v => !v)}
                      title="칼럼 순서·표시 설정 (엑셀·정제결과 화면과 공유)"
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-colors ${
                        showColOrder
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                          : 'bg-[#0d1a0d] border-[#1a3a1a] text-emerald-500/70 hover:text-emerald-300 hover:border-emerald-500/40'
                      }`}
                    >
                      <Columns size={12} />
                      칼럼
                      {exportColOrder.filter(c => !c.on).length > 0 && (
                        <span className="w-4 h-4 bg-amber-500 text-black text-[9px] font-black rounded-full flex items-center justify-center">
                          {exportColOrder.filter(c => !c.on).length}
                        </span>
                      )}
                    </button>
                    {showColOrder && (
                      <ColOrderPanel
                        cols={exportColOrder}
                        onChange={(next) => setExportColOrder(next)}
                        onReset={() => setExportColOrder(defaultExportCols)}
                        onClose={() => setShowColOrder(false)}
                        anchorRef={colOrderBtnRef}
                      />
                    )}
                  </div>
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
                fields={displayFields}
                exportColOrder={exportColOrder}
                onColResize={handleColResize}
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

      {/* ═══ 좌표 삭제 브러시 ═══ */}
      {showCoordBrush && selectedCity && (
        <CoordBrushModal
          records={records}
          selectedCity={selectedCity}
          onClose={() => setShowCoordBrush(false)}
          onApplyDelete={handleCoordBrushApply}
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

      {/* ═══ 주소 정제 진행 플로팅 표시기 ═══ */}
      {isRefiningAddr && refineProgress && (
        <div className="fixed bottom-5 right-5 z-[210] bg-[#111] border border-violet-500/30 rounded-2xl px-4 py-3 shadow-2xl text-xs flex items-center gap-3 min-w-[280px]">
          <span className="w-3.5 h-3.5 rounded-full border-2 border-violet-400 border-t-transparent animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-violet-300 font-bold">주소 정제 중</span>
              <span className="text-violet-400 font-black ml-2">
                {refineProgress.current}/{refineProgress.total}
                <span className="text-gray-500 ml-1">({Math.round(refineProgress.current / refineProgress.total * 100)}%)</span>
              </span>
            </div>
            <div className="w-full bg-[#222] rounded-full h-1.5">
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-300"
                style={{ width: `${refineProgress.total > 0 ? Math.round(refineProgress.current / refineProgress.total * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══ 주소 변경 확인 모달 ═══ */}
      {showAddrChanges && (() => {
        const pendingCount  = addrChanges.filter(c => c.status === 'pending').length;
        const revertedCount = addrChanges.filter(c => c.status === 'reverted').length;
        const warnDongs = Object.entries(dongAddrWarnings).filter(([, c]) => c >= 10);

        // 행정동 요약 계산
        const dongStats = {};
        addrChanges.forEach(c => {
          const d = c.행정동 || '미분류';
          if (!dongStats[d]) dongStats[d] = { total: 0, 정제: 0, 이사: 0, 오류: 0, reverted: 0 };
          dongStats[d].total++;
          if (c.status === 'reverted') dongStats[d].reverted++;
          else dongStats[d][c.changeType] = (dongStats[d][c.changeType] || 0) + 1;
        });

        return (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[150] p-4">
            <div className="bg-[#0e0e0e] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl">

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertTriangle size={15} className="text-amber-400 shrink-0" />
                  <h2 className="text-sm font-black text-white">주소 변경 확인</h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    전체 {addrChanges.length}건
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/15 text-green-400 border border-green-500/30">
                    적용 {pendingCount}건
                  </span>
                  {revertedCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-500/15 text-gray-400 border border-gray-500/30">
                      원복 {revertedCount}건
                    </span>
                  )}
                  {warnDongs.map(([dong, cnt]) => (
                    <span key={dong} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">
                      ⚠ {dong} 이상 {cnt}건
                    </span>
                  ))}
                </div>
                <button onClick={() => setShowAddrChanges(false)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-colors shrink-0">
                  <X size={15} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 px-5 pt-2 border-b border-white/5">
                <button
                  onClick={() => setAddrChangeTab('dong')}
                  className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-t-lg transition-colors ${addrChangeTab === 'dong' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  <Building2 size={11} /> 행정동 요약
                </button>
                <button
                  onClick={() => setAddrChangeTab('list')}
                  className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-t-lg transition-colors ${addrChangeTab === 'list' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  <List size={11} /> 전체 목록 ({addrChanges.length})
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-auto p-4">
                {addrChangeTab === 'dong' ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 text-[10px] font-bold uppercase tracking-wider border-b border-white/10">
                        <th className="text-left pb-2.5 font-bold">행정동</th>
                        <th className="text-center pb-2.5 font-bold">전체</th>
                        <th className="text-center pb-2.5 font-bold">정제</th>
                        <th className="text-center pb-2.5 font-bold">이사</th>
                        <th className="text-center pb-2.5 font-bold">오류</th>
                        <th className="text-center pb-2.5 font-bold">원복</th>
                        <th className="text-left pb-2.5 font-bold">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(dongStats)
                        .sort((a, b) => b[1].total - a[1].total)
                        .map(([dong, s]) => {
                          const warn = dongAddrWarnings[dong] >= 10;
                          return (
                            <tr key={dong} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${warn ? 'bg-red-950/10' : ''}`}>
                              <td className="py-2 font-bold text-white">
                                {warn && <span className="text-red-400 mr-1">⚠</span>}
                                {dong}
                              </td>
                              <td className="py-2 text-center text-gray-300 font-black">{s.total}</td>
                              <td className="py-2 text-center"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-400">{s.정제 || 0}</span></td>
                              <td className="py-2 text-center"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-400">{s.이사 || 0}</span></td>
                              <td className="py-2 text-center"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-400">{s.오류 || 0}</span></td>
                              <td className="py-2 text-center text-gray-600">{s.reverted || 0}</td>
                              <td className="py-2">
                                {warn
                                  ? <span className="text-[10px] font-bold text-red-400">행정동 주소이상</span>
                                  : <span className="text-[10px] text-gray-600">정상 범위</span>}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 text-[10px] border-b border-white/10">
                        <th className="text-left py-2 pr-3 font-bold">이름</th>
                        <th className="text-left py-2 pr-3 font-bold">행정동</th>
                        <th className="text-left py-2 pr-3 font-bold min-w-[160px]">기존 주소</th>
                        <th className="text-left py-2 pr-3 font-bold min-w-[160px]">정제 주소</th>
                        <th className="text-left py-2 pr-3 font-bold min-w-[140px]">저번달 주소</th>
                        <th className="text-center py-2 pr-3 font-bold">유형</th>
                        <th className="text-center py-2 font-bold">처리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {addrChanges.map(c => (
                        <tr key={c.rowId} className={`border-b border-white/5 transition-colors hover:bg-white/3 ${c.status === 'reverted' ? 'opacity-40' : ''}`}>
                          <td className="py-1.5 pr-3 font-bold text-white whitespace-nowrap">{c.이름}</td>
                          <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap">{c.행정동}</td>
                          <td className="py-1.5 pr-3 text-gray-500 line-through max-w-[200px] truncate" title={c.oldAddr}>{c.oldAddr}</td>
                          <td className={`py-1.5 pr-3 max-w-[200px] truncate ${c.status === 'reverted' ? 'text-gray-600 line-through' : 'text-green-400 font-bold'}`} title={c.newAddr}>{c.newAddr}</td>
                          <td className="py-1.5 pr-3 text-blue-300 max-w-[180px] truncate" title={c.prevAddr || '-'}>{c.prevAddr || <span className="text-gray-600">-</span>}</td>
                          <td className="py-1.5 pr-3 text-center">
                            <select
                              value={c.changeType}
                              onChange={e => handleMarkChangeType(c.rowId, e.target.value)}
                              disabled={c.status === 'reverted'}
                              className="text-[10px] font-bold rounded px-1 py-0.5 bg-transparent border border-white/10 text-gray-300 cursor-pointer disabled:opacity-50"
                            >
                              <option value="정제">🔧 정제</option>
                              <option value="이사">🚚 이사</option>
                              <option value="오류">⚠ 오류</option>
                            </select>
                          </td>
                          <td className="py-1.5 text-center">
                            {c.status === 'reverted' ? (
                              <button
                                onClick={() => handleReApplyAddrChange(c)}
                                className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-950/40 hover:bg-green-900/50 text-green-400 border border-green-500/20 transition-colors"
                              >재적용</button>
                            ) : (
                              <button
                                onClick={() => handleRevertAddrChange(c.rowId)}
                                className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950/30 hover:bg-red-900/40 text-red-400 border border-red-500/20 transition-colors"
                              >원복</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
                <p className="text-[11px] text-gray-500">
                  ※ 닫기 후 <span className="text-blue-400 font-bold">변경사항 저장</span> 버튼을 눌러야 Firestore에 반영됩니다.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleRevertAllAddrChanges}
                    className="px-3 py-1.5 rounded-xl text-[11px] bg-red-950/30 hover:bg-red-900/40 text-red-400 border border-red-500/20 font-bold transition-colors"
                  >
                    전체 원복
                  </button>
                  <button
                    onClick={() => setShowAddrChanges(false)}
                    className="px-4 py-1.5 rounded-xl text-[11px] bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors"
                  >
                    확인
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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
