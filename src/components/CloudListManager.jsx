import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import CellInput, { ColEditToggle } from './CellInput.jsx';
import * as XLSX from 'xlsx';
import { db, storage, auth, collection, getDocs, getDocsFromServer, getDoc, setDoc, doc, deleteDoc, writeBatch, serverTimestamp, addDoc, Timestamp, ref, getDownloadURL, deleteObject, increment } from '../config/firebase.js';
import { normalizeBirth, formatPhoneInput } from '../utils/parsers.js';
import { deliveryCompare } from '../utils/sortRecords.js';
import { annotateCarryover } from '../utils/prevMonthCarryover.js';
import {
  Cloud, Trash2, ArrowLeft, Download, Calendar, FileSpreadsheet,
  AlertCircle, Search, Save, RotateCcw, X, CheckCircle, MapPin,
  Building2, DatabaseZap, Ghost, BookOpen, Phone, LayoutGrid,
  Wand2, AlertTriangle, List, Eraser, Columns, History, User,
} from 'lucide-react';
import OrgPresetModal from './OrgPresetModal.jsx';
import CoordBrushModal from './CoordBrushModal.jsx';
import ColResizeHandle from './ColResizeHandle.jsx';
import ColumnEditBar from './ColumnEditBar.jsx';
import ColHeaderEditControls from './ColHeaderEditControls.jsx';
import { useColumnEditor } from '../hooks/useColumnEditor.js';
import { processAddress, asyncPool } from '../engine/addressEngine.js';
import { guardAddressDetail, parseDisplayedAddress } from '../utils/addressFormat.js';
import { canUseCoords, canUseCoordsBg } from '../utils/tierUtils.js';
import { getCachedCoord, saveCoordCache, loadCityCoordCache, lookupCoordInCache } from '../utils/coordCache.js';
import { idbGet, idbSet, idbDel } from '../utils/idbCache.js';
import { orderFieldsByExport, hasRi, getColWidth, colCellStyle } from '../utils/colOrder.js';
import { getCityExportTemplate } from '../utils/cityExportTemplates.js';
import { useConfirmDelete } from '../contexts/ConfirmDeleteContext.jsx';
import DriverSequenceView from './DriverSequenceView.jsx';
import { isTranslitBuildingDong } from '../../services/address-service/src/shared/dongTokens.js';
import { logAudit } from '../utils/audit.js';   // B-11 파괴적 작업 감사 로그
import { kakaoSearchAddress, kakaoSearchKeyword } from '../utils/kakaoApi.js';   // ★REST 키는 서버에만 있다(2026-08-23 점검)
import AddrChangeModal from './cloudList/AddrChangeModal.jsx';   // 주소변경 확인 모달(2026-08-23 Phase 4-3 분리)

const ttl90 = () => Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000);

// ─── Records Cache (IndexedDB, 24h TTL) ───────────────────────────────────────
// IndexedDB 비동기 저장 — 큰 JSON을 localStorage에 동기 저장/읽기하며 생기던 렉 제거.
// 세션 간 지속 + 4MB 한계 없음(대형 명단도 캐시). 열 때마다 서버값으로 백그라운드 갱신(자가 치유).
const RECS_CACHE_KEY = 'cloud_recs_v4';
const RECS_CACHE_TTL = 24 * 60 * 60 * 1000;
const recsKey = (city, monthId) => `${RECS_CACHE_KEY}_${city}_${monthId}`;

// rev: 저장 버전. 불러올 때 메타 rev와 비교해 같으면 무거운 전체 재조회를 생략(읽기 비용↓).
async function readRecsCache(city, monthId) {
  const rec = await idbGet(recsKey(city, monthId));
  // 빈 배열 캐시는 무효 처리: []는 truthy(![] === false)라 과거엔 통과되어,
  // 메타엔 N건인데 화면엔 0건으로 굳던 버그 차단. 빈 캐시면 항상 서버 재조회.
  if (!rec || !Array.isArray(rec.data) || rec.data.length === 0) return null;
  if (Date.now() - rec.ts > RECS_CACHE_TTL) { idbDel(recsKey(city, monthId)); return null; }
  return rec; // { ts, data, rev }
}
function writeRecsCache(city, monthId, data, rev = null) {
  idbSet(recsKey(city, monthId), { ts: Date.now(), data, rev }); // fire-and-forget(비동기)
}
function bustRecsCache(city, monthId) {
  idbDel(recsKey(city, monthId));
}

// 서버(클라우드 함수) 좌표 지오코딩 — 브라우저 부하 없이 서버에서 좌표를 채운다.
const GEOCODE_FN_URL = 'https://asia-northeast3-logis-op.cloudfunctions.net/geocode';

const fmtTs = (ts) => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const CLOUD_FIELDS = [
  { key: '구분',     label: '구분',     minW: '90px',  type: 'select', opts: ['기초수급자', '차상위'] },
  { key: '이름',     label: '이름',     minW: '80px',  type: 'text' },
  { key: '본명',     label: '본명',     minW: '80px',  type: 'text' },
  { key: '생년월일', label: '생년월일', minW: '85px',  type: 'text' },
  { key: '행정동',   label: '읍면동',   minW: '75px',  type: 'text' },
  { key: '법정동',   label: '법정동',   minW: '75px',  type: 'text' },
  { key: '리',       label: '리',       minW: '60px',  type: 'text' },
  { key: '주소',     label: '주소',     minW: '210px', type: 'text' },
  { key: '건물명',   label: '건물명',   minW: '120px', type: 'text' },
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

  const base = text
    .replace(/\([^)]*\)/g, ' ')                                  // 괄호 제거
    .replace(/번지/g, '')                                         // 번지 표기 제거
    .replace(/(로|대로)\s+(\d+[가-힣]*(?:번?길|가))/g, '$1$2')     // '사가정로 2길' → '사가정로2길'
    .split(',')[0] || text;                                      // 쉼표 앞(도로명+번)만

  const spaced = base.match(/([가-힣A-Za-z0-9·.\-]+(?:대로|번길|로|길|가))\s*(\d+)(?:\s*-\s*(\d+))?/);
  if (spaced) return formatRoadKey(spaced[1], spaced[2], spaced[3]);
  const compact = base.replace(/\s+/g, '').match(/([가-힣A-Za-z0-9·.\-]+(?:대로|번길|로|길|가))(\d+)(?:-(\d+))?/);
  if (compact) return formatRoadKey(compact[1], compact[2], compact[3]);

  return '';
};

// 유사 비교용 핵심 문자열: 도로명+번 영역 글자만(상세·동호수·층·공백·구두점 제거)
const addressCompareCore = (addr) => {
  let t = String(addr || '')
    .normalize('NFC')
    .replace(/\([^)]*\)/g, ' ');
  t = (t.split(',')[0] || t)
    .replace(/번지/g, '')
    .replace(/지하\s*\d*\s*층|제?\s*\d+\s*층/g, '')
    .replace(/제?\s*\d+\s*(?:-\s*\d+\s*)?호/g, '')
    .replace(/(로|대로)\s+(\d+[가-힣]*(?:번?길|가))/g, '$1$2')
    .replace(/[\s·.\-'`]/g, '');
  return t.trim();
};

// 행정동/법정동 이름 정규화 — 끝 숫자 제거(정왕1동→정왕동), 공백 제거. 행정동↔법정동 번호차 흡수.
const normDongName = (s) => String(s || '').replace(/\s+/g, '').replace(/([가-힣]+?)\d+(동|가|읍|면)$/, '$1$2').trim();

// 저번달 대비 "이사(변동)" 판정 — 과탐 최소화(애매하면 변동 아님).
const hasRoadAddressChanged = (prevAddr, currentAddr) => {
  const prevKey = normalizeRoadAddressCompareKey(prevAddr);
  const currentKey = normalizeRoadAddressCompareKey(currentAddr);
  if (prevKey && currentKey) {
    if (prevKey === currentKey) return false;                    // 도로명+번 같음 → 변동 아님
    const pc = addressCompareCore(prevAddr), cc = addressCompareCore(currentAddr);
    if (pc && cc && (pc === cc || pc.includes(cc) || cc.includes(pc))) return false; // 추출오차 → 변동 아님
    return true;                                                 // 도로/번이 명확히 다름 → 이사
  }
  // 한쪽이라도 도로키 추출 실패 → 보수적으로 변동 아님(이사 과탐 0)
  return false;
};

// 셀 편집 입력 — 자체 상태 관리로 부모 리렌더 완전 차단
const VirtualTable = memo(function VirtualTable({ fields, exportColOrder, onColResize, editing, isOn, onToggle, dragProps, colEditMode, onColEditToggle, displayRecords, dirtyRecords, deletedRecordIds, loadingRecords, records, renderCell, setDeletedRecordIds }) {
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
                const on = isOn ? isOn(f.key) : true;
                const dim = editing && !on;
                return (
                  <th key={f.key}
                    {...(editing && dragProps ? dragProps(f.key) : {})}
                    style={{ ...(colCellStyle(w) || { minWidth: f.minW }), position: 'relative' }}
                    className={`px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider overflow-hidden ${dim ? 'opacity-40' : ''} ${f.key === '기사' || f.key === '배송순번' ? 'text-[#3b82f6]/60' : 'text-gray-600'}`}>
                    {editing && onToggle && <ColHeaderEditControls colKey={f.key} on={on} onToggle={onToggle} />}
                    {f.label}
                    {/* 칼럼 수정모드 토글 — 이 칼럼 전체가 입력창이 되어 Enter로 다음 행 연속 입력 */}
                    {!editing && onColEditToggle && (
                      <ColEditToggle colKey={f.key} active={colEditMode === f.key} onToggle={onColEditToggle} />
                    )}
                    {editing && onColResize && <ColResizeHandle colKey={f.key} currentWidth={w} onResize={onColResize} />}
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
                  {fields.map(f => {
                    const dim = editing && isOn && !isOn(f.key);
                    return (
                      <td key={f.key} style={colCellStyle(getColWidth(exportColOrder, f.key)) || { minWidth: f.minW }} className={`px-3 py-2 max-w-0 overflow-hidden ${dim ? 'opacity-40' : ''}`}>
                        {renderCell(r, f)}
                      </td>
                    );
                  })}
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
  // 월별 명단 삭제 권한: 관리자 또는 본인 승인 지자체 담당자 (CLAUDE.md 권한규칙 — base_lists 제외)
  const canDeleteCity = (cityId) => isAdmin || approvedCities.includes(cityId);
  const confirmDelete = useConfirmDelete();

  // 칼럼 순서·표시 — exportColOrder(전역, 엑셀·정제결과와 공유) 기준으로 CLOUD_FIELDS 재정렬
  const editor = useColumnEditor({ exportColOrder, setExportColOrder, defaultExportCols });
  // 편집 중엔 숨김 칼럼(on=false)도 포함해 흐리게 표시
  const orderedFields = useMemo(() => orderFieldsByExport(CLOUD_FIELDS, editor.cols, editor.editing), [editor.cols, editor.editing]);

  // City selection — initialCity에서 시도/시군구 파싱
  const initParts = initialCity.trim().split(/\s+/);
  const [selectedSido, setSelectedSido] = useState(initParts[0] || '');
  const [selectedSigungu, setSelectedSigungu] = useState(initParts.slice(1).join(' ') || '');
  const selectedCity = selectedSido && selectedSigungu ? `${selectedSido} ${selectedSigungu}` : '';

  // Month list
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [, setLoadingMonths] = useState(false);

  // Records
  const [records, setRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  // 리(里)는 데이터에 읍/면(리 보유 지역)이 있을 때만 표시. 동 지역(시/구 동만)은 리가 없으므로 숨긴다.
  // city 이름('군')이 아니라 '데이터의 읍/면 존재'로 판정 — 천안시·여주시처럼 시 안에 읍/면이 섞인 경우도 정확히 표시.
  const hasEupMyeon = useMemo(() => records.some(r => /(읍|면)$/.test(String(r.행정동 ?? '').trim())), [records]);
  const riPresent = useMemo(() => hasRi(records), [records]);
  const showRi = hasEupMyeon && riPresent;
  const displayFields = useMemo(
    () => (showRi ? orderedFields : orderedFields.filter(c => c.key !== '리')),
    [orderedFields, showRi]
  );

  // Inline edit state
  const [dirtyRecords, setDirtyRecords] = useState({});  // { [id]: { field: val } }
  const [showDriverSeq, setShowDriverSeq] = useState(false); // ③ 기사별 배송순번 뷰
  const [carryMap, setCarryMap] = useState({});              // ⑥ 전월 승계: id → { _isNew, _prevDriver, _prevSeqNo, _carryAmbiguous }
  const [carryLoading, setCarryLoading] = useState(false);   // ⑥ 전월 로드 진행중
  const [deletedRecordIds, setDeletedRecordIds] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null);  // { id, field }
  const [colEditMode, setColEditMode] = useState(null);   // 칼럼 전체 수정모드
  const [autoSaving, setAutoSaving] = useState(false);
  const [saving, setSaving] = useState(false);


  // UI — 검색은 150ms 디바운스로 displayRecords 재계산 최소화
  const [searchInput, setSearchInput] = useState('');
  const [searchText, setSearchText] = useState('');
  const [filterGubun, setFilterGubun] = useState('');
  const [filterDong, setFilterDong] = useState('');
  const searchDebounceRef = useRef(null);
  const loadedRevRef = useRef(null);   // 현재 보고 있는 월의 저장 버전(rev) — 동시편집 충돌 검사용 (CloudListManager 스코프)
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
    // getDocsFromServer: 로컬 캐시 우회 — 방금 저장한 새 월/건수가 캐시 miss로 누락돼
    // "저장했는데 사라짐"이 되던 문제 차단(레코드 조회와 동일 원칙, B-7).
    setTimeout(() => {
      getDocsFromServer(collection(db, 'cloud_lists', fullCity, 'months'))
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
      .sort(deliveryCompare);   // 공용 비교자(행정동→리→주소→이름) 재사용
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

  // ⑥ 전월 작업내역 승계 매칭 — 선택 월의 "전월" delivery_history 로드 → 강키(이름+생년월일)+양측유일만 승계 표시
  // 저장 스키마는 건드리지 않고 화면 표시용 carryMap(id→승계정보)만 계산. 동명이인 안전은 annotateCarryover가 보장.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCarryMap({});
      if (!selectedCity || !selectedMonth?.id || records.length === 0) return;
      const m = String(selectedMonth.id).match(/^(\d{4})-(\d{2})$/);
      if (!m) return;
      // 선택 월의 전월 ID (month는 1-based → -2로 전월 인덱스)
      const pd = new Date(Number(m[1]), Number(m[2]) - 2, 1);
      const prevId = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
      setCarryLoading(true);
      try {
        const snap = await getDocs(collection(db, 'delivery_history', selectedCity, 'months', prevId, 'records'));
        if (cancelled) return;
        const prevRecords = snap.docs.map(d => d.data());
        const map = {};
        annotateCarryover(prevRecords, records).forEach(r => {
          map[r.id] = { _isNew: r._isNew, _prevDriver: r._prevDriver, _prevSeqNo: r._prevSeqNo, _carryAmbiguous: r._carryAmbiguous };
        });
        if (!cancelled) setCarryMap(map);
      } catch (e) {
        console.warn('[⑥ 전월 승계] 로드 실패:', e);
      } finally {
        if (!cancelled) setCarryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCity, selectedMonth?.id, records.length]);

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
      // getDocsFromServer: 로컬 캐시 우회 — 저장 직후 새 월/갱신 건수가 캐시 miss로
      // 목록에 안 뜨던 "저장했는데 사라짐" 근본 차단(레코드 조회 518과 동일 원칙, B-7).
      const snap = await getDocsFromServer(collection(db, 'cloud_lists', selectedCity, 'months'));
      const data = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.id.localeCompare(a.id));
      setMonths(data);
    } catch (e) { console.error('[CloudListManager] fetchMonths:', e); }
    finally { setLoadingMonths(false); }
  };

  // cityId를 직접 받는 버전 (카드 클릭 시 state 갱신 전 호출 대응)
  const fetchRecordsFor = async (cityId, monthId, force = false) => {
    // 캐시 우선 즉시 표시(체감 0) → 서버 최신값으로 백그라운드 갱신(자가 치유). force면 캐시 무시.
    const cached = force ? null : await readRecsCache(cityId, monthId);
    if (cached) { setRecords(cached.data); setLoadingRecords(false); }
    else setLoadingRecords(true);
    try {
      // 가벼운 메타 rev + totalCount 1건만 읽어 캐시와 비교 → 같으면 무거운 전체 records 재조회 생략(읽기 비용↓)
      let serverRev = null, serverTotal = null;
      try {
        const metaSnap = await getDoc(doc(db, 'cloud_lists', cityId, 'months', monthId));
        if (metaSnap.exists()) {
          serverRev = metaSnap.data().rev ?? null;
          serverTotal = metaSnap.data().totalCount ?? null;
        }
      } catch { serverRev = null; }
      loadedRevRef.current = serverRev;
      // 캐시가 있고 서버 rev와 동일하면 그대로 사용 (전체 조회 생략) — 단 rev가 있을 때만(구버전 월은 항상 조회)
      // + 정합성 가드: 메타 totalCount > 0 인데 캐시 건수가 그보다 적으면(빈/부분 캐시) rev가 같아도 전체 재조회
      const cacheCovers = !serverTotal || (cached?.data?.length ?? 0) >= serverTotal;
      if (cached && serverRev != null && cached.rev === serverRev && cacheCovers) {
        setLoadingRecords(false);
        return;
      }
      // getDocsFromServer: Firestore SDK 로컬 캐시 우회 — 캐시에 빈 결과(0건)가 박혀도 항상 서버 최신을 읽는다.
      // (기본명단은 정상인데 이번달만 0건이던 원인 = getDocs가 빈 캐시를 반환. B-7 동일 원칙.)
      const snap = await getDocsFromServer(collection(db, 'cloud_lists', cityId, 'months', monthId, 'records'));
      const recs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRecords(recs);
      writeRecsCache(cityId, monthId, recs, serverRev);
    } catch (e) {
      // ★실패를 '0건'으로 보이게 두면 담당자는 명단이 사라진 줄 안다(M-1 취지 · 2026-08-23 점검)
      console.error('[CloudListManager] fetchRecords:', e);
      alert('명단을 불러오지 못했습니다.\n네트워크 상태를 확인하고 새로고침해 주세요.');
    }
    finally { setLoadingRecords(false); }
  };

  const fetchRecords = (monthId, force = false) => fetchRecordsFor(selectedCity, monthId, force);

  // ── 자가 치유(절대 되돌리지 말 것) ───────────────────────────────────────
  // 월은 선택됐고 메타 건수(totalCount)>0 인데 records가 비어 있으면 = 경쟁조건(fetchMonths가
  // 방금 채운 records를 비움)·일시 오류·스왑 등으로 비워진 상태 → 캐시 무시 강제 재조회.
  // city-month당 1회만(무한루프 차단), 로딩 중에는 대기. "건수는 뜨는데 레코드가 없습니다" 박멸.
  const healedKeyRef = useRef('');
  useEffect(() => {
    if (!selectedCity || !selectedMonth) return;
    const key = `${selectedCity}__${selectedMonth.id}`;
    const expected = selectedMonth.totalCount ?? 0;
    if (expected > 0 && records.length === 0 && !loadingRecords && healedKeyRef.current !== key) {
      healedKeyRef.current = key;
      fetchRecordsFor(selectedCity, selectedMonth.id, true);
    }
  }, [selectedCity, selectedMonth, records.length, loadingRecords]);

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
            totalQty: data.latestTotalQty ?? 0,          // 포수(도시 카드 표시용)
            수급자Qty: data['latest수급자Qty'] ?? 0,
            차상위Qty: data['latest차상위Qty'] ?? 0,
          } : null;
          return { id: cityId, sido, sigungu, latestMonth };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const sidoCmp = a.sido.localeCompare(b.sido, 'ko');
          if (sidoCmp !== 0) return sidoCmp;
          return a.sigungu.localeCompare(b.sigungu, 'ko');
        });

      // 카드 카운트/포수가 0인데 lastMonthId가 있으면 month 문서를 직접 읽어 자동 복구(구 저장분 포수 캐시 없음 대응)
      await Promise.all(
        cities
          .filter(c => c.latestMonth && (c.latestMonth.totalCount === 0 || !c.latestMonth.totalQty))
          .map(async (c) => {
            try {
              const monthSnap = await getDoc(doc(db, 'cloud_lists', c.id, 'months', c.latestMonth.id));
              if (!monthSnap.exists()) return;
              const m = monthSnap.data();
              const totalCount = m.totalCount ?? 0;
              const 수급자Count = m.수급자Count ?? 0;
              const 차상위Count = m.차상위Count ?? 0;
              const totalQty = m.totalQty ?? 0;
              const 수급자Qty = m.수급자Qty ?? 0;
              const 차상위Qty = m.차상위Qty ?? 0;
              c.latestMonth.totalCount = totalCount;
              c.latestMonth.수급자Count = 수급자Count;
              c.latestMonth.차상위Count = 차상위Count;
              c.latestMonth.totalQty = totalQty;
              c.latestMonth.수급자Qty = 수급자Qty;
              c.latestMonth.차상위Qty = 차상위Qty;
              // 최상위 문서 캐시도 동기화 (이후 로드 시 추가 읽기 불필요)
              if (totalCount > 0 || totalQty > 0) {
                setDoc(doc(db, 'cloud_lists', c.id), {
                  latestTotalCount: totalCount,
                  'latest수급자Count': 수급자Count,
                  'latest차상위Count': 차상위Count,
                  latestTotalQty: totalQty,
                  'latest수급자Qty': 수급자Qty,
                  'latest차상위Qty': 차상위Qty,
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

      const normDong = (v) => (v || '').replace(/\s/g, '').trim();
      // S-2(동명이인 안전 매칭, CLAUDE.md §1-4): 약키(이름+읍면동)는 '사람'이 유일할 때만.
      // 과거엔 특이사항 '값'이 1종이면 통과시켰는데, 같은 동 동명이인 중 1명만 비고가 있으면
      // 두 사람 모두에게 이식되는 오염 경로였다 — 인원 수 기준으로 교체.
      const byBirth = {}, byPhone = {}, byDongPersons = {};
      baseRecs.forEach(r => {
        const name = (r.name || r.이름 || '').trim();
        if (!name) return;
        const birth = r.birthKey || normalizeBirth(String(r.생년월일 || ''));
        const mobile = normPhone(r.mobile || r.휴대폰 || '');
        const dong = normDong(r.dong || r.읍면동 || r.행정동 || '');
        // 동명이인 인원 집계는 특이사항 유무와 무관하게 전원 기준
        if (dong) { const k = `${name}__${dong}`; (byDongPersons[k] || (byDongPersons[k] = { count: 0, note: '' })).count += 1; }
        const note = (r.note || r.특이사항 || '').trim();
        if (!note) return;
        if (birth) byBirth[`${name}__${birth}`] = note;
        if (mobile.length >= 9) byPhone[`${name}__${mobile}`] = note;
        if (dong) byDongPersons[`${name}__${dong}`].note = note;
      });
      // 읍면동+이름 fallback — 생년월일·휴대폰 없을 때 기본 매칭. 동명이인(사람 2+)은 무조건 제외
      const byDong = {};
      Object.entries(byDongPersons).forEach(([k, v]) => { if (v.count === 1 && v.note) byDong[k] = v.note; });

      const updates = [];
      let dongMatched = 0;
      records.forEach(r => {
        if ((r.특이사항 || '').trim()) return;
        const name = (r.이름 || '').trim();
        const birth = normalizeBirth(String(r.생년월일 || ''));
        const mobile = normPhone(r.휴대폰 || '');
        const dong = normDong(r.행정동 || r.읍면동 || '');
        let note = '';
        if (birth) note = byBirth[`${name}__${birth}`] || '';
        if (!note && mobile.length >= 9) note = byPhone[`${name}__${mobile}`] || '';
        if (!note && dong) { note = byDong[`${name}__${dong}`] || ''; if (note) dongMatched++; }
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
      // ★삭제 대상 조회는 서버에서 — 캐시가 최신이 아니면 **지우다 만다**(고아 레코드가 남는다 · §19).
      const rSnap = await getDocsFromServer(collection(db, 'cloud_lists', city, 'months', month.id, 'records'));
      for (let i = 0; i < rSnap.docs.length; i += 499) {   // ★499 — B-6/§19(500 절대 초과 금지). 여유 0이면 필드 하나만 늘어도 터진다
        const batch = writeBatch(db);
        rSnap.docs.slice(i, i + 499).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, 'cloud_lists', city, 'months', month.id));
      try { await deleteObject(ref(storage, `cloud_uploads/${city}/${month.id}/original.xlsx`)); } catch { /* 없어도 무시 */ }
      if (selectedMonth?.id === month.id) { setSelectedMonth(null); setRecords([]); }
      // 도시 상위 문서도 최신 월로 갱신
      const remainingSnap = await getDocsFromServer(collection(db, 'cloud_lists', city, 'months'));   // 방금 지운 월이 캐시에 남아 lastMonthId 가 어긋나는 것을 막는다
      const remaining = remainingSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.id.localeCompare(a.id));
      const newLatest = remaining[0] || null;
      await setDoc(doc(db, 'cloud_lists', city), {
        lastMonthId: newLatest?.id || null,
        latestTotalCount: newLatest?.totalCount ?? 0,
        'latest수급자Count': newLatest?.수급자Count ?? 0,
        'latest차상위Count': newLatest?.차상위Count ?? 0,
        lastUpdatedAt: serverTimestamp(),
      }, { merge: true });
      // 감사 로그 — 담당자/관리자 월 삭제 추적 (CLAUDE.md B-11)
      try {
        await addDoc(collection(db, 'audit_logs'), {
          action: 'DELETE_MONTHLY_LIST', city, monthId: month.id,
          count: rSnap.docs.length,
          timestamp: serverTimestamp(),
          adminEmail: user?.email || 'unknown',
          uid: user?.uid || auth.currentUser?.uid || 'unknown',
          expireAt: ttl90(),
        });
      } catch { /* 감사 로그 실패는 삭제 자체를 막지 않음 */ }
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

  /**
   * 셀 편집 확정 — 셀에서 빠져나오는 순간 그 칸만 즉시 DB에 저장한다(형 지시 2026-07-22).
   * @param {'next'|'prev'|null} move Enter/Tab 이동 방향(칼럼 수정모드 연속 입력)
   */
  const commitEdit = useCallback(async (id, field, newVal, move) => {
    const origVal = records.find(r => r.id === id)?.[field] ?? '';
    const value = field === '포수' ? Number(newVal) : newVal;
    const changed = String(newVal) !== String(origVal);

    if (colEditMode === field && move) {
      const idx = displayRecords.findIndex(r => r.id === id);
      const nextRec = displayRecords[move === 'next' ? idx + 1 : idx - 1];
      setEditingCell(nextRec ? { id: nextRec.id, field } : null);
    } else {
      setEditingCell(null);
    }
    if (!changed || !selectedCity || !selectedMonth?.id) return;

    setRecords(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
    setAutoSaving(true);
    try {
      await setDoc(doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id, 'records', id),
        { [field]: value, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      setRecords(prev => prev.map(r => (r.id === id ? { ...r, [field]: origVal } : r)));
      alert(`저장 실패 — 되돌렸습니다.
${e.message}`);
    } finally { setAutoSaving(false); }
  }, [records, colEditMode, displayRecords, selectedCity, selectedMonth]);

  const renderCell = useCallback((r, fieldDef) => {
    const { key, type, opts } = fieldDef;
    const id = r.id;
    const isEditing = editingCell?.id === id && editingCell?.field === key;
    const isDirty = dirtyRecords[id]?.[key] !== undefined;
    let val = dirtyRecords[id]?.[key] ?? r[key] ?? '';
    // A-31 법정동: 저장값 없는 기존 레코드는 저장된 legalDong → 괄호 첫 토큰 순으로 파생
    if (!val && key === '법정동') {
      const tok = String(r.legalDong || parseDisplayedAddress(r.주소 || '').paren || '').split(',')[0].trim();
      // A-37: 괄호 첫 토큰이 음역 건물동(에이동 …)이면 법정동으로 표시하지 않는다(과거 저장분 방어)
      if (/^[가-힣\d]+(읍|면|동)$/.test(tok) && !isTranslitBuildingDong(tok)) val = tok;
    }

    const colMode = colEditMode === key;
    if (isEditing || colMode) {
      return (
        <CellInput
          type={type}
          opts={opts}
          initial={val}
          autoFocus={isEditing}
          onCommit={(v, move) => commitEdit(id, key, v, move)}
          onCancel={cancelEdit}
          format={key === '휴대폰' || key === '유선전화' ? formatPhoneInput : undefined}
        />
      );
    }

    if (key === '구분') {
      return (
        <span
          onDoubleClick={() => startEdit(id, key)}
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
          onDoubleClick={() => startEdit(id, key)}
          className={`cursor-text block text-center text-xs font-bold ${isDirty ? 'text-blue-300' : 'text-blue-400'}`}
        >
          {val || '—'}
        </span>
      );
    }

    // ⑥ 기사·배송순번: 실제 값이 없고 전월 승계값이 있으면 흐리게 참고표시(더블클릭해 편집·승계버튼으로 확정)
    if (key === '기사' || key === '배송순번') {
      const carry = carryMap[id];
      const prevVal = key === '기사'
        ? (carry?._prevDriver || '')
        : (carry?._prevSeqNo != null ? String(carry._prevSeqNo) : '');
      if (!val && prevVal) {
        return (
          <span
            title={`전월 승계값: ${prevVal} — 더블클릭해 입력하거나 [전월 승계 적용]으로 채웁니다`}
            onDoubleClick={() => startEdit(id, key)}
            className="cursor-text block truncate text-xs italic text-amber-500/50"
          >
            {prevVal}<span className="text-[9px] not-italic ml-0.5 opacity-70">전월</span>
          </span>
        );
      }
    }

    return (
      <span
        title={String(val)}
        onDoubleClick={() => startEdit(id, key)}
        className={`cursor-text block truncate text-xs ${isDirty ? 'text-blue-300 font-semibold' : 'text-gray-300'} ${!val ? 'text-gray-700' : ''}`}
      >
        {val || '—'}
        {key === '이름' && carryMap[id]?._isNew && (
          <span className="ml-1 inline-flex px-1 py-0.5 rounded text-[8px] font-bold bg-emerald-900/50 text-emerald-400 align-middle">NEW</span>
        )}
      </span>
    );
  }, [editingCell, colEditMode, dirtyRecords, commitEdit, cancelEdit, startEdit, carryMap]);

  // ⑥ 전월 승계 요약 — NEW 인원수 / 승계 채울 수 있는 건수 (동명이인·약키 제외)
  const carryStats = useMemo(() => {
    let newCount = 0, carryable = 0;
    records.forEach(r => {
      if (deletedRecordIds.has(r.id)) return;
      const c = carryMap[r.id];
      if (!c) return;
      if (c._isNew) newCount++;
      if (c._carryAmbiguous) return;
      const curDriver = dirtyRecords[r.id]?.기사 ?? r.기사 ?? '';
      const curSeq = dirtyRecords[r.id]?.배송순번 ?? r.배송순번 ?? '';
      if ((c._prevDriver && !String(curDriver).trim()) || (c._prevSeqNo != null && !String(curSeq).trim())) carryable++;
    });
    return { newCount, carryable };
  }, [records, carryMap, dirtyRecords, deletedRecordIds]);

  // ⑥ 전월 승계 적용 — 빈 기사·순번 칸만 전월값으로 채움(동명이인·약키 제외). 실제 반영은 [저장]으로.
  const applyCarryover = useCallback(() => {
    const updates = {};
    let filled = 0;
    records.forEach(r => {
      if (deletedRecordIds.has(r.id)) return;
      const c = carryMap[r.id];
      if (!c || c._carryAmbiguous) return;
      const curDriver = dirtyRecords[r.id]?.기사 ?? r.기사 ?? '';
      const curSeq = dirtyRecords[r.id]?.배송순번 ?? r.배송순번 ?? '';
      const patch = {};
      if (c._prevDriver && !String(curDriver).trim()) patch.기사 = c._prevDriver;
      if (c._prevSeqNo != null && !String(curSeq).trim()) patch.배송순번 = String(c._prevSeqNo);
      if (Object.keys(patch).length) { updates[r.id] = patch; filled++; }
    });
    if (!filled) { alert('채울 전월 승계값이 없습니다. (동명이인·생년월일 없는 건은 안전상 제외)'); return; }
    if (!confirm(`전월 기사·순번을 빈 칸에 채웁니다: ${filled}건\n\n· 동명이인·생년월일 없는 건은 안전상 제외됩니다.\n· 채운 뒤 [저장]을 눌러야 실제 반영됩니다.`)) return;
    setDirtyRecords(prev => {
      const next = { ...prev };
      Object.entries(updates).forEach(([id, patch]) => { next[id] = { ...(next[id] || {}), ...patch }; });
      return next;
    });
  }, [records, carryMap, dirtyRecords, deletedRecordIds]);

  // ── Save edits ────────────────────────────────────────────────────
  const handleSaveEdits = async () => {
    if (!hasRecordChanges || saving) return;
    const modCount = Object.keys(dirtyRecords).length;
    const delCount = deletedRecordIds.size;
    const _saveMsg = `변경사항을 저장하시겠습니까?\n수정: ${modCount}건 / 삭제: ${delCount}건`;
    if (!confirm(delCount > 0
      ? `⚠️ 삭제 ${delCount}건이 포함됩니다 — 삭제는 되돌릴 수 없습니다.\n\n${_saveMsg}`
      : _saveMsg)) return;
    setSaving(true);
    try {
      // 동시편집 충돌 검사 — 내가 불러온 후 다른 담당자가 먼저 저장했는지 확인
      let serverRev = null;
      try {
        const metaSnap = await getDoc(doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id));
        serverRev = metaSnap.exists() ? (metaSnap.data().rev ?? null) : null;
      } catch { serverRev = null; }
      if (loadedRevRef.current != null && serverRev != null && serverRev !== loadedRevRef.current) {
        const ok = window.confirm('⚠️ 다른 담당자가 이 명단을 먼저 저장했습니다.\n\n[확인] 내 변경사항으로 덮어쓰기\n[취소] 저장 중단 (최신 명단을 다시 불러오는 것을 권장)');
        if (!ok) { setSaving(false); return; }
      }
      const nextRev = (serverRev ?? loadedRevRef.current ?? 0) + 1;
      // ★rev 는 화면 캐시 비교용 값이고, 실제 문서에는 `increment(1)` 로 올린다(2026-08-23 점검) —
      //   두 담당자가 동시에 저장하면 둘 다 같은 값을 읽고 같은 값을 써서 충돌 감지가 통과해 버렸다.

      const allOps = [
        ...Object.entries(dirtyRecords).map(([id, changes]) => ({ type: 'update', id, changes })),
        ...[...deletedRecordIds].map(id => ({ type: 'delete', id })),
      ];
      const batches = [];
      for (let i = 0; i < allOps.length; i += 499) {
        const batch = writeBatch(db);
        allOps.slice(i, i + 499).forEach(op => {
          const r = doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id, 'records', op.id);
          if (op.type === 'update') batch.update(r, op.changes); else batch.delete(r);
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
      // Update month meta counts
      const remaining = records
        .filter(r => !deletedRecordIds.has(r.id))
        .map(r => ({ ...r, ...dirtyRecords[r.id] }));
      const totalCount = remaining.length;
      const 수급자Count = remaining.filter(r => r.구분 === '기초수급자').length;
      const 차상위Count = remaining.filter(r => r.구분 === '차상위').length;
      // 월 메타 + 최상위 city 캐시 문서를 병렬 기록
      await Promise.all([
        setDoc(doc(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id), { totalCount, 수급자Count, 차상위Count, rev: increment(1) }, { merge: true }),
        setDoc(doc(db, 'cloud_lists', selectedCity), {
          latestTotalCount: totalCount,
          'latest수급자Count': 수급자Count,
          'latest차상위Count': 차상위Count,
          lastUpdatedAt: serverTimestamp(),
        }, { merge: true }),
      ]);
      // 저장 성공 → 서버 강제 재조회 대신 로컬 state·캐시 즉시 반영 (체감 속도 ↑, 결과 동일)
      loadedRevRef.current = nextRev;
      setRecords(remaining);
      writeRecsCache(selectedCity, selectedMonth.id, remaining, nextRev);
      setDirtyRecords({});
      setDeletedRecordIds(new Set());
      fetchMonths().catch(() => {});  // 월 목록·메타는 백그라운드 동기화 (대기 X)
      alert(`저장 완료! (수정 ${modCount}건, 삭제 ${delCount}건)`);
    } catch (e) { alert('저장 오류: ' + e.message); }
    finally { setSaving(false); }
  };

  // ── 좌표 받아오기 (VIP: 행정동 단위 수동 / VVIP: 업로드 후 백그라운드 자동) ──
  const [isFetchingCoords, setIsFetchingCoords] = useState(false);
  const [coordProgress, setCoordProgress] = useState(null); // { done, total } | null
  const bgCoordCancelRef = useRef(false);
  const [bgCoordState, setBgCoordState] = useState(null); // { done, total, success, isDone } | null
  const cloudGeoRef = useRef(false); // 클라우드 지오코딩 중복 실행 방지(수동 버튼)

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

    // 카카오 조회는 **서버 프록시**를 거친다 — 클라이언트 번들에 REST 키를 두면 누구나 가져다 쓴다(2026-08-23 점검).
    //   실패·미발견이면 빈 배열을 돌려주고, 일시 오류에는 지수 백오프로 3회까지 다시 시도한다.
    const kakaoDocs = async (query, keyword = false) => {
      const go = async () => {
        try {
          const data = keyword ? await kakaoSearchKeyword(query, { size: 5 }) : await kakaoSearchAddress(query, { size: 5 });
          return data?.documents || null;      // null = 호출 실패(재시도 대상)
        } catch { return null; }
      };
      let docs = await go();
      for (const delay of [2000, 4000, 8000]) {
        if (docs !== null) break;
        await new Promise(r => setTimeout(r, delay));
        docs = await go();
      }
      return docs || [];
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
    const getCoordKakao = async (주소, 행정동 = '') => {
      const road = cleanRoad(주소);
      const prefixedRoad = cityPrefix ? `${cityPrefix} ${road}` : road;

      // 1단계: 지자체+도로명으로 address 검색 (가장 정확)
      {
        const docs = await kakaoDocs(prefixedRoad, false);
        const d = docs.find(isInRegion);
        if (d?.x && d?.y) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 1 };
      }

      // 2단계: 지자체+도로명으로 keyword 검색 (address 파싱 실패 보완)
      {
        const docs = await kakaoDocs(prefixedRoad, true);
        const d = docs.find(isInRegion);
        if (d?.x && d?.y) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 2 };
      }

      // 3단계: 지자체+전체주소(건물명 포함) keyword 검색 (아파트 단지명 등)
      const fullQuery = cityPrefix ? `${cityPrefix} ${주소}` : 주소;
      if (fullQuery !== prefixedRoad) {
      {
        const docs = await kakaoDocs(fullQuery, true);
        const d = docs.find(isInRegion);
          if (d?.x && d?.y) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 3 };
        }
      }

      // 4단계: 행정동+건물명 keyword 검색 (건물명만 있는 경우 — 주민센터·구청 등)
      const isOnlyBuildingName = !/\d+(-\d+)?(로|길|번길|번지|가)\b/.test(road);
      if (isOnlyBuildingName) {
        const dongPrefix = 행정동?.trim() || sigungu;
        const step4Query = dongPrefix ? `${dongPrefix} ${road}` : `${sido} ${road}`;
        {
          const docs = await kakaoDocs(step4Query, true);
          const d = docs.find(isInRegion) || docs.find(doc => doc.category_group_code === 'PO3');
          if (d?.x && d?.y && isInRegion(d)) return { lat: parseFloat(d.y), lng: parseFloat(d.x), _step: 4 };
        }
      }

      return null;
    };

    // 영구 캐시 우선 — 같은 주소면 카카오 호출 없이 즉시 반환, 새로 받은 좌표는 캐시에 저장(API 최소화).
    //   ★도시 캐시를 한 번에 읽어 둔다(2026-08-23 Phase 1) — 레코드마다 getDoc 하던 N+1 제거.
    const cityCoordCache = await loadCityCoordCache(db, cityId);
    const getCoord = async (주소, 행정동 = '') => {
      const cached = lookupCoordInCache(cityCoordCache, 주소)
        || (cityCoordCache.size ? null : await getCachedCoord(db, cityId, 주소));
      if (cached) return { ...cached, _step: 0 };
      const r = await getCoordKakao(주소, 행정동);
      if (r?.lat && r?.lng) await saveCoordCache(db, cityId, 주소, r.lat, r.lng);
      return r;
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

  // 클라우드 함수로 서버에서 좌표 채우기 — 좌표 없는 건을 배치(200) 반복 호출로 처리.
  //   카카오 호출은 전부 서버에서 → 브라우저 네트워크 부하 없음. 실패 건은 그대로 남는다(확인 필요).
  const handleCloudGeocode = async (cityArg, monthArg, opts = {}) => {
    const city = cityArg || selectedCity;
    const month = monthArg || selectedMonth?.id;
    if (!city || !month || cloudGeoRef.current) return;
    const u = auth.currentUser;
    if (!u) { if (!opts.silent) alert('로그인이 필요합니다.'); return; }
    cloudGeoRef.current = true;
    setBgCoordState({ done: 0, total: 0, success: 0 });
    let totalSuccess = 0;
    try {
      for (let guard = 0; guard < 200; guard++) {
        if (bgCoordCancelRef.current) break;
        const token = await u.getIdToken();
        const res = await fetch(GEOCODE_FN_URL, {
          method: 'POST',
          // ★`X-Id-Token` — Cloud Run 이 Authorization 을 IAM 토큰으로 가로채 함수에 닿기 전에 401 을 낸다(2026-08-23 실측)
          headers: { 'Content-Type': 'application/json', 'X-Id-Token': token },
          body: JSON.stringify({ city, monthId: month, limit: 200 }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        totalSuccess += data.success || 0;
        const totalMissing = data.totalMissing || (totalSuccess + (data.remaining || 0));
        setBgCoordState({ done: totalSuccess, total: totalMissing, success: totalSuccess });
        if (!data.remaining || data.success === 0) break; // 끝났거나, 남은 건 전부 실패(에러로 남김)
      }
      bustRecsCache(city, month);
      await fetchRecordsFor(city, month, true); // 서버가 채운 좌표로 새로고침
      setBgCoordState(prev => prev ? { ...prev, isDone: true } : null);
      setTimeout(() => setBgCoordState(null), 8000);
      if (!opts.silent) alert(`클라우드 좌표 채우기 완료\n성공 ${totalSuccess}건 (실패 건은 확인 필요로 남습니다)`);
    } catch (e) {
      setBgCoordState(null);
      if (!opts.silent) alert('클라우드 좌표 채우기 실패: ' + e.message);
    } finally {
      cloudGeoRef.current = false;
    }
  };

  // ※ 명단 열 때의 클라이언트 자동 좌표 조회는 제거 — 좌표 매칭은 서버 스케줄 함수(geocodeAuto)가
  //    업로드 순서대로 자동·지속 처리한다. 브라우저는 좌표 조회를 하지 않는다.
  //    (수동 즉시 처리가 필요하면 "클라우드 좌표" 버튼으로 서버 함수를 호출)

  // ── DB 전체 초기화 (records만 삭제, 월 메타는 유지) ─────────────────────
  const [isClearing, setIsClearing] = useState(false);
  const handleClearAllRecords = async () => {
    if (!isAdmin || !selectedCity || !selectedMonth) return;
    const count = records.length;
    if (!(await confirmDelete({ target: `${selectedCity} ${selectedMonth.id} 월 레코드`, count, note: '월 항목은 유지되며 재업로드 가능합니다.', dangerous: true }))) return;
    setIsClearing(true);
    try {
      // ★월 초기화도 서버 조회 — 캐시 누락분이 그대로 남으면 '비웠는데 남아 있는' 상태가 된다.
      const snap = await getDocsFromServer(collection(db, 'cloud_lists', selectedCity, 'months', selectedMonth.id, 'records'));
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
      await logAudit('RESET_CLOUD_MONTH', { city: selectedCity, monthId: selectedMonth?.id || '' });
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
    if (!(await confirmDelete({ target: '유령데이터', count: ghosts.length, note: `예시:\n${preview}${ghosts.length > 5 ? `\n...외 ${ghosts.length - 5}건` : ''}`, dangerous: ghosts.length >= 50 }))) return;

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
      await logAudit('DELETE_CLOUD_GHOSTS', { city: selectedCity, monthId: selectedMonth?.id || '', count: ghosts.length });
      alert(`✅ 유령데이터 ${ghosts.length}건 삭제 완료\n남은 레코드: ${totalCount.toLocaleString()}건`);
    } catch (e) {
      alert('정리 오류: ' + e.message);
    } finally {
      setIsPurging(false);
    }
  };

  // ── 기사칸 정리: 등록 안 된 기사명 + 2명 이상 표시된 칸 비우기 (맵 매칭 등록기사 1명만 남김) ──
  const handleCleanDrivers = async () => {
    if (!selectedCity || !selectedMonth || !records.length) return;
    if (!confirm('이번달 명단의 기사칸에서 "등록 안 된 기사명"과 "2명 이상 표시된 칸"을 비웁니다.\n맵에서 매칭된 등록 기사 1명만 남깁니다. 계속할까요?')) return;
    // 유효(등록) 기사 = 맵 저장본(route_sessions)의 기사명
    const valid = new Set();
    try {
      const sess = await getDoc(doc(db, 'route_sessions', selectedCity, 'months', selectedMonth.id));
      if (sess.exists()) (sess.data().drivers || []).forEach(d => { const n = (d.name || '').trim(); if (n) valid.add(n); });
    } catch { /* 세션 없으면 빈 셋 */ }
    const changes = {};
    let cleared = 0;
    records.forEach(r => {
      const raw = String(dirtyRecords[r.id]?.기사 ?? r.기사 ?? '').trim();
      if (!raw) return;
      const names = raw.split(/[\s,/·|]+/).map(s => s.trim()).filter(Boolean);
      const isMulti = names.length >= 2;                                   // 2명 이상
      const isUnregistered = names.length === 1 && valid.size > 0 && !valid.has(names[0]); // 등록 안 된 단일 기사
      if (isMulti || isUnregistered) { changes[r.id] = { ...(dirtyRecords[r.id] || {}), 기사: '' }; cleared++; }
    });
    if (!cleared) { alert(valid.size ? '정리할 기사가 없습니다 (모두 등록된 단일 기사).' : '맵 저장본이 없어 등록 기준을 만들 수 없고, 2명 이상도 없습니다.'); return; }
    setDirtyRecords(prev => ({ ...prev, ...changes }));
    alert(`${cleared}건의 기사칸을 비웠습니다.\n상단 "변경사항 저장"으로 확정하세요.${valid.size ? '' : '\n(맵 저장본이 없어 단일 기사명은 검증하지 못해, 2명 이상만 정리했습니다.)'}`);
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

    // 기본명단(base_lists) 로드 — 도로명주소 비교 기준(이사/주민센터배송 판정)
    const baseMap = new Map();
    try {
      const baseSnap = await getDocsFromServer(collection(db, `base_lists/${selectedCity}/records`));
      baseSnap.docs.forEach(d => {
        const r = d.data();
        const digits = v => String(v || '').replace(/[^\d]/g, '');
        const name = (r.name || r.이름 || '').trim();
        if (!name) return;
        const road = r.roadAddr || parseDisplayedAddress(r.address || r.주소 || '').road || '';
        const dong = r.dong || r.행정동 || r.legalDong || '';
        // 법정동 — 동 단위 이사/주민센터배송 판정용(법정동↔법정동 비교, 행정동≠법정동 과탐 방지)
        const legalDong = r.legalDong || parseDisplayedAddress(r.address || r.주소 || '').paren.split(',')[0]?.trim() || '';
        const val = { road, dong, legalDong };
        const k1 = r.birthKey ? `${name}__${r.birthKey}` : null;
        const ph = digits(r.mobile || r.휴대폰 || '').slice(-7);
        const k2 = ph.length >= 7 ? `${name}__${ph}` : null;
        if (k1) baseMap.set(k1, val);
        if (k2 && !baseMap.has(k2)) baseMap.set(k2, val);
      });
    } catch (e) { console.warn('[주소정제] 기본명단 로드 실패:', e); }

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
        // 진행률 갱신은 25건마다(또는 마지막)만 — 건마다 setState 시 대형 테이블 전체 리렌더 폭발
        if (current % 25 === 0 || current === records.length) setRefineProgress({ current, total: records.length });

        const oldAddr = (rec.주소 || '').trim();
        // 상세주소(동·호수) 손실 방지 — 정제 결과가 기존 동/호수를 잃으면 복원/보존
        const newAddr = guardAddressDetail(oldAddr, (refined.주소 || '').trim());
        // 리(里) 백필: 주소가 안 바뀌어도 리가 비어있거나 다르면 채운다 (읍/면 배정 매칭용)
        const riNeedsUpdate = !!refined.리 && refined.리 !== (rec.리 || '');
        // A-31: 법정동 백필 — 주소가 그대로여도 법정동이 비었거나 다르면 채운다(빠짐 방지)
        const legalNeedsUpdate = !!refined.법정동 && refined.법정동 !== (rec.법정동 || '');
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
        if (!addrChanged && !riNeedsUpdate && !legalNeedsUpdate && !phoneSwap) return;

        if (addrChanged) {
          // 저번달 주소 매칭
          const digits = v => String(v || '').replace(/[^\d]/g, '');
          const ph = digits(rec.휴대폰 || '').slice(-7);
          const k1 = rec.생년월일 ? `${rec.이름}__${rec.생년월일}` : null;
          const k2 = ph.length >= 7 ? `${rec.이름}__${ph}` : null;
          const prevAddr = (k1 && prevMap.get(k1)) || (k2 && prevMap.get(k2)) || null;

          // 변경 유형 자동 감지 — 기본명단 도로명주소 비교 + 법정동 규칙
          //  · 도로명 같음 → 정제 (포맷/동호수만 변경)
          //  · 도로명 다름 + 새 주소 법정동 == 기본명단 법정동 → 이사 (같은 동 내 이동)
          //  · 도로명 다름 + 새 주소 법정동 != 기본명단 법정동 → 주민센터배송 (다른 동 → 관할 밖)
          // 법정동↔법정동 비교(둘 다 주소DB 법정동, 100% 정확). 행정동≠법정동 과탐 방지.
          // 비교 기준: 기본명단(base_lists) 우선, 없으면 저번달.
          const baseEntry = (k1 && baseMap.get(k1)) || (k2 && baseMap.get(k2)) || null;
          const baseRoad = baseEntry?.road || prevAddr || '';
          let changeType = '정제';
          if (refined.확인필요) {
            changeType = '오류';
          } else if (baseRoad && hasRoadAddressChanged(baseRoad, newAddr)) {
            const newLegal = normDongName(refined.legalDong || (parseDisplayedAddress(newAddr).paren.split(',')[0] || ''));
            const baseLegal = normDongName(baseEntry?.legalDong || '');
            // 양쪽 법정동을 알 때만 동 비교 → 다르면 주민센터배송, 같거나 불명이면 이사
            changeType = (newLegal && baseLegal && newLegal !== baseLegal) ? '주민센터배송' : '이사';
          }

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
          ...(legalNeedsUpdate ? { 법정동: refined.법정동 } : {}),
          ...(phoneUpdate || {}),
          ...(refined.확인필요 ? { 확인필요: true, 확인사유: refined.확인사유 || '' } : {}),
        };
      } catch {
        current++;
        // 진행률 갱신은 25건마다(또는 마지막)만 — 건마다 setState 시 대형 테이블 전체 리렌더 폭발
        if (current % 25 === 0 || current === records.length) setRefineProgress({ current, total: records.length });
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
      if (current % 25 === 0 || current === targets.length) setRefineProgress({ current, total: targets.length });
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
    // 지자체 전용 칼럼 형식 (예: 안양시 동안구 원본 업로드 형식) — 있으면 그 형식으로 내보냄
    const cityTpl = getCityExportTemplate(selectedCity);
    if (cityTpl) {
      const rows = cityTpl.buildRows(displayRecords, { sigungu: cityTpl.sigungu });
      const ws = XLSX.utils.json_to_sheet(rows, { header: cityTpl.headers });
      ws['!cols'] = cityTpl.colWidths.map((w) => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, cityTpl.sheetName);
      XLSX.writeFile(wb, `${selectedCity}_${selectedMonth.id}_배송명단.xlsx`);
      return;
    }
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
            {records.length > 0 && (
              <button
                onClick={handleCleanDrivers}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-rose-950/40 hover:bg-rose-900/50 text-rose-400 border border-rose-500/30 transition-colors"
                title="기사칸에서 등록 안 된 기사명·2명 이상 표시된 칸을 비웁니다 (맵에서 매칭된 등록 기사 1명만 남김). '변경사항 저장'으로 확정"
              >
                <Eraser size={13} /> 기사 정리
              </button>
            )}
            {records.length > 0 && (
              <button
                onClick={() => setShowDriverSeq(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-blue-950/40 hover:bg-blue-900/50 text-blue-400 border border-blue-500/30 transition-colors"
                title="기사별 담당 가구를 배송순번 순서로 봅니다"
              >
                <User size={13} /> 기사별 순번
              </button>
            )}
            {records.length > 0 && (carryStats.carryable > 0 || carryStats.newCount > 0) && (
              <button
                onClick={applyCarryover}
                disabled={carryStats.carryable === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={carryLoading ? '전월 내역 불러오는 중…' : '전월(선택 월의 지난달) 기사·순번을 빈 칸에 채웁니다. 동명이인·생년월일 없는 건은 안전상 제외. NEW=전월에 없던 신규 대상자'}
              >
                <History size={13} /> 전월 승계
                {carryStats.carryable > 0 && (
                  <span className="px-1 rounded bg-emerald-500/25 text-[9px] leading-none">{carryStats.carryable}</span>
                )}
                {carryStats.newCount > 0 && (
                  <span className="px-1 rounded bg-sky-500/25 text-sky-300 text-[9px] leading-none">NEW {carryStats.newCount}</span>
                )}
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
                        {/* 관리 버튼: 인라인 편집은 관리자만, 월 삭제는 담당자/관리자 */}
                        {(isAdmin || canDeleteCity(cityItem.id)) && m && (
                          <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 flex gap-1 transition-all">
                            {isAdmin && (
                              <button
                                onClick={e => { e.stopPropagation(); handleAdminMode(cityItem); }}
                                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-600 hover:text-gray-300 transition-all"
                                title="인라인 편집 모드"
                              >
                                <FileSpreadsheet size={12} />
                              </button>
                            )}
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
                                <p className="text-[22px] font-black text-white leading-none">{(m.totalQty||0).toLocaleString()}<span className="text-[13px] font-extrabold ml-0.5">포</span></p>
                                <p className="text-[10px] text-gray-400 mt-1 font-bold">전체 {(m.totalCount||0).toLocaleString()}명</p>
                              </div>
                              <div className="bg-black/40 rounded-xl p-2 text-center">
                                <p className="text-[22px] font-black text-amber-400 leading-none">{(m.수급자Qty||0).toLocaleString()}<span className="text-[13px] font-extrabold ml-0.5">포</span></p>
                                <p className="text-[10px] text-gray-400 mt-1 font-bold">수급자 {(m.수급자Count||0).toLocaleString()}명</p>
                              </div>
                              <div className="bg-black/40 rounded-xl p-2 text-center">
                                <p className="text-[22px] font-black text-blue-400 leading-none">{(m.차상위Qty||0).toLocaleString()}<span className="text-[13px] font-extrabold ml-0.5">포</span></p>
                                <p className="text-[10px] text-gray-400 mt-1 font-bold">차상위 {(m.차상위Count||0).toLocaleString()}명</p>
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
                    <span>전체 <span className="text-white font-bold">{(selectedMonth.totalCount||0).toLocaleString()}</span>명 · <span className="text-white font-bold">{records.reduce((s,r)=>s+(parseInt(r.포수)||1),0).toLocaleString()}</span>포</span>
                    <span className="text-amber-400">기초수급자 <span className="font-bold">{(selectedMonth.수급자Count||0).toLocaleString()}</span>명 · <span className="font-bold">{records.filter(r=>r.구분==='기초수급자').reduce((s,r)=>s+(parseInt(r.포수)||1),0).toLocaleString()}</span>포</span>
                    <span className="text-blue-400">차상위 <span className="font-bold">{(selectedMonth.차상위Count||0).toLocaleString()}</span>명 · <span className="font-bold">{records.filter(r=>r.구분==='차상위').reduce((s,r)=>s+(parseInt(r.포수)||1),0).toLocaleString()}</span>포</span>
                    {isAdmin && (
                      <span className="text-gray-600">업로드: {fmtTs(selectedMonth.uploadedAt)} · {selectedMonth.uploadedBy}</span>
                    )}
                  </div>
                  {canDeleteCity(selectedCity) && (
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
                {/* 클라우드 좌표 지금 채우기 — 서버 함수 즉시 호출(브라우저 부하 0). 평소엔 서버 스케줄이 자동 처리 */}
                {canUseCoordsBg(user) && (
                  <button
                    onClick={() => handleCloudGeocode()}
                    disabled={!!bgCoordState}
                    title="좌표 없는 건을 서버에서 지금 바로 채웁니다(브라우저 부하 없음). 평소엔 서버가 업로드 순서대로 자동 처리하며, 못 받은 건만 확인 필요로 남습니다."
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-colors shrink-0 bg-sky-950/40 hover:bg-sky-900/50 text-sky-400 border-sky-500/30 disabled:opacity-40"
                  >
                    {bgCoordState && !bgCoordState.isDone
                      ? <><span className="w-3 h-3 rounded-full border-2 border-sky-400 border-t-transparent animate-spin inline-block" /> {bgCoordState.total ? `${bgCoordState.done}/${bgCoordState.total}` : '처리중'}</>
                      : <><MapPin size={11} /> 클라우드 좌표</>}
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
                  {displayRecords.length.toLocaleString()}명 · {displayRecords.reduce((s, r) => s + (parseInt(r.포수) || 1), 0).toLocaleString()}포 표시
                  {(searchText || filterGubun || filterDong) && ` (전체 ${records.filter(r => !deletedRecordIds.has(r.id)).length.toLocaleString()}명 · ${records.filter(r => !deletedRecordIds.has(r.id)).reduce((s, r) => s + (parseInt(r.포수) || 1), 0).toLocaleString()}포 중)`}
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
                exportColOrder={editor.cols}
                onColResize={editor.resizeKey}
                editing={editor.editing}
                colEditMode={colEditMode}
                onColEditToggle={setColEditMode}
                isOn={editor.isOn}
                onToggle={editor.toggleKey}
                dragProps={editor.dragProps}
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

      {editor.editing && (
        <ColumnEditBar onReset={editor.reset} onCancel={editor.cancel} onCommit={editor.commit} />
      )}

      {/* ═══ ORG PRESET MODAL ═══ */}
      {showDriverSeq && (
        <DriverSequenceView
          records={records.filter(r => !deletedRecordIds.has(r.id)).map(r => ({ ...r, ...(dirtyRecords[r.id] || {}) }))}
          title={`기사별 배송순번 — ${selectedCity || ''} ${selectedMonth?.id || ''}`}
          onClose={() => setShowDriverSeq(false)}
        />
      )}
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
      {showAddrChanges && (
        <AddrChangeModal
          addrChanges={addrChanges} dongAddrWarnings={dongAddrWarnings}
          addrChangeTab={addrChangeTab} setAddrChangeTab={setAddrChangeTab}
          onClose={() => setShowAddrChanges(false)}
          onRevertAll={handleRevertAllAddrChanges} onRevert={handleRevertAddrChange}
          onReApply={handleReApplyAddrChange} onMarkType={handleMarkChangeType}
        />
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
