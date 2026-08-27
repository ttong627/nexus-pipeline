import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, MapPin, Navigation2, Plus, Minus, RefreshCw, Save, AlertTriangle, Map as MapIcon, List, Building2, Clock, FileSpreadsheet, Download, HardDrive, Maximize2, Minimize2, Columns, AlertCircle, Search, Crosshair, Share2, Link, Eraser, ArrowLeftRight, ChevronLeft, User, Satellite, Grid3x3, Target, Box } from 'lucide-react';
import { db, auth } from '../config/firebase.js';
import { collection, serverTimestamp, Timestamp, getDocs, getDoc, setDoc, updateDoc, doc, writeBatch, query, where, limit, increment } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import CoordBrushModal from './CoordBrushModal.jsx';
import DriverSequenceView from './DriverSequenceView.jsx';
import DeliveryAccuracyView from './DeliveryAccuracyView.jsx';
import { formatAddressDisplay } from '../utils/addressFormat.js';
import { splitByDay, splitBySequence, summarizeDaySplit } from '../engine/deliveryDaySplit.js';
// ★parseAptDong 은 **SSOT 에서 가져온다** — 여기 복제본이 있었고(문자 단위 동일),
//   `호` optional 오탐 수정이 한쪽에만 적용될 뻔했다(2026-08-11). 다시 정의하지 말 것.
import { getEffectiveLoad, parseAptDong } from '../engine/routeSequenceEngine.js';
import Vworld3DView from './Vworld3DView.jsx';
import { annotateCarryover } from '../utils/prevMonthCarryover.js';
import { newShareId } from '../utils/shareId.js';
// 공유 문서 구조(메타/건별 분리) — 계획 Phase 1. 배열은 부분 권한을 줄 수 없다.
import { buildShareMeta, buildShareRecords, chunk, normalizeDeadline, MAX_DEADLINE_DAYS } from '../utils/shareDoc.js';
import { hashPasscode, newSalt, isValidPasscode } from '../utils/sharePasscode.js';
import { getDriversCollection } from '../utils/company.js';
import SharePasscodePrompt from './SharePasscodePrompt.jsx';
// ★순번 엔진은 SSOT 한 곳에만 산다 — 예전엔 이 파일에 41개 심볼이 문자 단위로 복제돼 있었다(2026-08-23 점검에서 제거).
//   복제는 드리프트 전엔 증상이 없다가, 다음 수정이 한쪽에만 들어가는 순간 화면과 서버 순번이 갈라진다.
//   회귀 `scripts/apt-dong-parse.test.mjs` 의 '전 심볼 가드'가 재정의를 막는다.
import { kakaoCoordOf, kakaoStaticMapBlob } from '../utils/kakaoApi.js';   // ★REST 키는 서버에만 있다(2026-08-23 점검)
import {
  RENTAL_LIKE_RE,
  analyzeSequenceQuality,
  extractRoadAddress,
  getAptGroupMeta,
  getSequenceAddress,
  haversine,
  isApartmentLike,
  isRentalLike,
  nearestNeighborTSP,
  parseFloorHo,
  parseRoadInfo,
  roadAwareTSP,
} from '../engine/routeSequenceEngine.js';

// ★순수 헬퍼·상수는 `routeMap/mapHelpers.js` 로 옮겼다(2026-08-23 Phase 4-1) — 이 파일이 5,850줄이라
//   읽기도 고치기도 어려웠고, 순수함수는 모듈에 있어야 회귀 테스트로 잠글 수 있다.
import { loadCityCoordCache, lookupCoordInCache } from '../utils/coordCache.js';   // ★좌표 캐시 SSOT(2026-08-23 Phase 1)
import {
  CULL_MIN_RECORDS,
  PIN_COMPACT_LEVEL,
  buildPinInnerHtml,
  isWithinPaddedBounds,
  pinZIndex,
  DRIVER_COLORS,
  KAKAO_COLOR_MAP,
  SHARE_LINK_TTL_DAYS,
  SHARE_TRANSITION_DUAL_WRITE,
  assessKakaoAreaMatch,
  buildAssignedRouteUnits,
  buildMapInsights,
  escHtml,
  getMixedRouteUnitIssues,
  getMixedRouteUnitKeys,
  getRouteDong,
  isCoordAssignable,
  mergeReason,
  revalidateAreaMatch,
  strongMatchKey,
} from './routeMap/mapHelpers.js';
import { isAdminEmail } from '../utils/admins.js';   // 관리자 판정 SSOT(화면 표시·질의 분기용 · 실권한은 규칙)
import AutoPinConfirmModal from './routeMap/AutoPinConfirmModal.jsx';   // 자동 핀 배치 확인(2026-08-23 Phase 4-5 분리)
import DongNavConfirmModal from './routeMap/DongNavConfirmModal.jsx';   // 행정동 이동 확인(2026-08-23 Phase 4-5 분리)

export const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;   // 지도 SDK 키(도메인 제한 가능 → 번들에 있어도 된다). 환경 의존이라 순수 모듈에 두지 않는다

export default function RouteMapModal({ gridData, fileInfo, onClose, onBack = null, onSave, initialCloudCity = null, initialCloudMonthId = null, orgDongs = null, initialDrivers: initialDriversProp = null, companyDrivers: companyDriversProp = null, setupDongDriverMap: setupDongDriverMapProp = null, orgId: orgIdProp = 'all', selectedDongs: selectedDongsProp = null, baseDailyQty: baseDailyQtyProp = 40 }) {
  const DEFAULT_START_ADDR = '경기도 수원시 장안구 정자천로188번길 39';
  const defaultDrivers = [
    { id: 'd1', name: '기사1', color: DRIVER_COLORS[0], startAddr: DEFAULT_START_ADDR },
    { id: 'd2', name: '기사2', color: DRIVER_COLORS[1], startAddr: DEFAULT_START_ADDR },
  ];
  const startDrivers = initialDriversProp || defaultDrivers;
  const companyDriverPool = companyDriversProp?.length ? companyDriversProp : initialDriversProp;
  const allKnownDrivers = useMemo(() => {
    const byId = new Map();
    [...(companyDriverPool || []), ...(startDrivers || [])].forEach(driver => {
      if (!driver?.id) return;
      byId.set(driver.id, { ...driver, ...byId.get(driver.id) });
    });
    return [...byId.values()];
  }, [companyDriverPool, startDrivers]);

  const [drivers, setDrivers] = useState(startDrivers);
  const [records, setRecords] = useState(() =>
    gridData.map(r => ({
      ...r,
      _driverId: null,
      _lat: r._lat || null,
      _lng: r._lng || null,
      _isApt: r._isApt || false,
      _origDriver: r.기사 || '',
      _origSeqNo: r.배송순번 || '',
    }))
  );
  const [driverCount, setDriverCount] = useState(startDrivers.length);
  const [overlapCount, setOverlapCount] = useState(0);
  const [isMapReady, setIsMapReady] = useState(false);
  // layoutMode: 'split' | 'map' | 'list' | 'mapfull' | 'listfull'
  const [layoutMode, setLayoutMode] = useState('split');
  const [isSplitting, setIsSplitting] = useState(false);
  const [autoSplitStrategy, setAutoSplitStrategy] = useState('dongGroup');
  const [routeAnalysis, setRouteAnalysis] = useState(null);
  const [showMapAnalysis, setShowMapAnalysis] = useState(false);
  const [selectedDriverFilter, setSelectedDriverFilter] = useState('all');
  const [aptMultiModal, setAptMultiModal] = useState(null); // { aptName, dongs: [{dong, records, assignedDriverId}] }

  const [isFetchingCoords, setIsFetchingCoords] = useState(false);
  const [hasRunGeocoding, setHasRunGeocoding] = useState(false);
  const [coordProgress, setCoordProgress] = useState(null);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [selectionPulseId, setSelectionPulseId] = useState(null);
  const selectionPulseTimerRef = useRef(null);
  // 기사 핀 (모든 기사 핀이 있으면 가까운 거점 배정에 사용)
  const [driverPins, setDriverPins] = useState({});       // { driverId: { lat, lng } }
  const [placingPinForDriver, setPlacingPinForDriver] = useState(null); // 핀 배치 모드 중인 driverId
  const [showErrorPanel, setShowErrorPanel] = useState(false);
  const [errorFixingId, setErrorFixingId] = useState(null); // 재처리 중인 record id
  const [errorAddrOverrides, setErrorAddrOverrides] = useState({}); // {id: 수정주소}

  // 세션 저장 상태
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingPrevMonth, setIsLoadingPrevMonth] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(''); // '' | 'draft' | 'final'
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const saveTimerRef = useRef(null);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  // ★언마운트 때 타이머를 정리한다 — 안 하면 닫힌 모달의 setToast 가 뒤늦게 호출된다(2026-08-23 점검)
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // 배송 일정 상태
  const [scheduleMode, setScheduleMode] = useState(false);
  // 일자 분할(수량 많을 때 여러 날로) — 형 지시 2026-07-23
  const [daySplitOpen, setDaySplitOpen] = useState(false);
  const [daySplitMode, setDaySplitMode] = useState('load'); // 'load'=하루최대물량 | 'days'=날짜개수
  const [daySplitVal, setDaySplitVal] = useState('500');
  const [daySplitSummary, setDaySplitSummary] = useState(null); // [{day,count,load,dongs}]

  // 클라우드 모드 상태
  const [isCloudMode, setIsCloudMode] = useState(false);
  const [cloudCity, setCloudCity] = useState('');
  const [cloudMonthId, setCloudMonthId] = useState('');
  const [carryMap, setCarryMap] = useState({}); // ⑥ 전월 승계: id → { _isNew, _prevDriver, _prevSeqNo, _carryAmbiguous }
  const [mapType, setMapType] = useState('roadmap');       // 배경지도: roadmap(일반) | hybrid(위성)
  // ── V월드 3D 입체 지도 ──────────────────────────────────────────────────
  //   ⭐역할 분담: **2D·위성·핀·순번 편집 = 카카오**(편집 기능이 전부 거기 붙어 있다)
  //               **3D 조망 = V월드**(카카오맵은 지도 기울기를 지원하지 않는다)
  //   ⛔3D 에서 순번을 편집하지 않는다 — 「어느 동인지·어디로 들어가는지」를 눈으로 보는 용도.
  const [show3D, setShow3D] = useState(false);
  const [view3DTarget, setView3DTarget] = useState(null);
  const [showCadastral, setShowCadastral] = useState(false); // 지적편집도 오버레이(카카오 USE_DISTRICT)
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [showCloudPicker, setShowCloudPicker] = useState(false);
  const [cloudPickerCity, setCloudPickerCity] = useState(fileInfo?.city || '');
  const [cloudPickerMonth, setCloudPickerMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // ── 공유 링크
  const [shareModal, setShareModal] = useState(null); // { links: [{driverId,name,color,url}] }
  const [isCreatingShare, setIsCreatingShare] = useState(false);
  const [askPasscode, setAskPasscode] = useState(false);   // 배포 순간 뜨는 암호 입력창
  // ★공유 사용일정(마감일) — 담당자가 정한다(계획 Phase 3, 형 확정 C).
  // ★기사 비밀번호(숫자 6자리 · 필수 · 2026-08-23 형 지시) — **지도를 배포할 때마다 그 자리에서 받는다.**
  //   미리 메뉴에 넣어 두는 방식이 아니다(형 지시): 미리 넣은 값은 다음 지도에 딸려가거나 안 넣은 채 배포된다.
  //   입력값은 `SharePasscodePrompt` 안에만 있고(부모 재렌더 방지 · UI-1), 확인을 누르는 순간 runCreateShare 로 넘어간다.
  //   평문은 저장하지 않는다(해시·솔트만 route_share_secrets 에). 기사는 이 번호를 넣어야 지도가 열린다(openShare Function).
  //   이 날짜가 접근 가능 기간의 **진짜 천장**이다. 접속해도 이 날을 넘겨 연장되지 않는다.
  //   기본 = 오늘+7일(로컬/KST 기준 날짜 문자열).
  const [shareDeadline, setShareDeadline] = useState(() => {
    const d = new Date(Date.now() + SHARE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  const [orderRequestModal, setOrderRequestModal] = useState(null); // { requests: [...] }
  const [isLoadingOrderRequests, setIsLoadingOrderRequests] = useState(false);
  const [isApplyingOrderRequest, setIsApplyingOrderRequest] = useState(false);

  // ── ②-B 배송완료 정확도 비교 (완료 GPS ↔ 동별좌표) ──────────────────────────
  const [completionData, setCompletionData] = useState([]); // [{key,name,at,lat,lng,dongLat,dongLng,errM,accuracy,driverId,driverName,shareId}]
  const [showCompletionCompare, setShowCompletionCompare] = useState(false); // 지도 오버레이 토글
  const [isLoadingCompletions, setIsLoadingCompletions] = useState(false);
  const [showAccuracy, setShowAccuracy] = useState(false); // 정확도 분석화면

  // ── 기사 배치 잠금 (브러시 보정 후 실수로 초기화 방지)
  const [isAssignmentLocked, setIsAssignmentLocked] = useState(false);

  // ── 같은 좌표 팝업
  const [samePointPopup, setSamePointPopup] = useState(null); // { recs, x, y }
  // ★핀을 누르면 그 자리에서 순번을 바로 넣는다(형 지시 2026-08-27 "좌표 클릭하고 바로 순번을 입력").
  //   목록으로 눈을 옮기지 않고 지도만 보며 순서를 매길 수 있어야 현장 감각대로 찍을 수 있다.
  const [seqPin, setSeqPin] = useState(null); // { id, name, x, y }

  // ── 좌표 삭제 브러시 모달
  const [showCoordBrush, setShowCoordBrush] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false); // 내보내기 드롭다운(KML·엑셀·배송루트·공유 통합)
  const [showSessionMenu, setShowSessionMenu] = useState(false); // 세션 드롭다운(이어서작업·저장본·이전달승계 통합 — 가끔 쓰는 동작 정리)
  const [savedView, setSavedView] = useState(null); // 저장본 보기 모달: null | { loading, rows, summary }
  const [showDriverSeq, setShowDriverSeq] = useState(false); // ③ 기사별 배송순번 뷰

  // ── 소속사 기사 추가 피커
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [pickerSelectedName, setPickerSelectedName] = useState('');
  // 모달이 열릴 때 지도에서 선택된 행정동을 캡처 (selectedDong '전체'면 첫 번째 동으로 대체)
  const [pickerDong, setPickerDong] = useState('');

  // ── 행정동 작업 큐 ─────────────────────────────────────────────────────────
  const [dongQueue, setDongQueue] = useState([]); // 작업 순서 행정동 배열
  const [activeDongIndex, setActiveDongIndex] = useState(0); // 현재 작업 중인 인덱스
  const [completedDongs, setCompletedDongs] = useState(new Set()); // 저장 완료된 동
  const [isDirty, setIsDirty] = useState(false); // 현재 동 미저장 변경 여부
  const [showDongNavConfirm, setShowDongNavConfirm] = useState(null); // { targetIndex }

  const [showDriverSwapModal, setShowDriverSwapModal] = useState(false);
  const [swapFromDriverId, setSwapFromDriverId] = useState('');
  const [swapToDriverId, setSwapToDriverId] = useState('');
  const [swapScope, setSwapScope] = useState('all'); // all | dong

  // ── 클릭 순번 배정 모드 (지도/목록 클릭 순서대로 1→2→3 순번 부여)
  const [isSeqClickMode, setIsSeqClickMode] = useState(false);
  const [seqClickNext, setSeqClickNext] = useState(1);
  const [isSeqDragMode, setIsSeqDragMode] = useState(false);
  const [showSequenceAnalysis, setShowSequenceAnalysis] = useState(false);
  const [sequenceAnalysis, setSequenceAnalysis] = useState(null);
  const [autoPinConfirmModal, setAutoPinConfirmModal] = useState(null); // { clusterMap, pendingPins, diagnostics, affectedIds }
  const [dragOverId, setDragOverId] = useState(null);
  const dragSrcIdRef = useRef(null);

  // ── 페인트 브러시 모드 (2차 보정)
  const [isPaintMode, setIsPaintMode] = useState(false);
  // ★기사가 2명 이상인 행정동은 **자동으로 나누지 않는다**(형 지시 2026-08-27).
  //   "행정동에 2명 이상의 기사가 있는 경우는 기사들을 브러쉬로 배정할 수 있게" —
  //   예전엔 진입하자마자 자동 N등분이 돌아서 담당자가 손대기 전에 이미 갈라져 있었다.
  //   이제 안내만 띄우고, 브러쉬로 칠할지 자동으로 나눌지는 담당자가 고른다.
  const [brushPrompt, setBrushPrompt] = useState(null); // { dong, driverIds }
  const [paintDriverId, setPaintDriverId] = useState(null);
  const [paintRadiusPx, setPaintRadiusPx] = useState(50);
  const paintCursorRef = useRef(null);   // 브러시 커서 원 — state 없이 DOM 직접 이동 (전체 리렌더 차단)
  const paintRafRef = useRef(0);          // applyPaint rAF 스로틀 (프레임당 1회)
  const paintLastPtRef = useRef(null);    // 마지막 마우스 좌표 (rAF 콜백에서 사용)
  const isPaintingRef = useRef(false);
  const pendingPaintRef = useRef(new Map()); // id → newDriverId (드래그 중 누적, mouseup 시 commit)
  const recordsRef = useRef([]);             // stale-closure 방지용 최신 records 미러
  const autoSaveDataRef = useRef({ records: [], drivers: [] }); // 자동저장용 최신값 (setInterval deps 제거용)
  const routeWorkerRef = useRef(null);       // 기사 배정 Web Worker

  const mapRef = useRef(null);
  const kakaoMapRef = useRef(null);
  const overlaysRef = useRef([]);
  const mapCoordCacheRef = useRef(new Map());   // 도시 좌표 캐시 1회 로드분(레코드마다 getDoc 하던 N+1 제거)
  const overlayByIdRef = useRef(new Map());     // 레코드 id → { overlay, el, rec, sameCount, coordKey } — 변경분만 갱신하려고 둔 색인
  const coordRecsMapRef = useRef(new Map());    // 같은 좌표 그룹(팝업용) — 리스너가 **최신** 목록을 보게 한다
  const structuralSigRef = useRef('');          // 구조(누가·어디에·몇 포)가 바뀌었는지
  const compactPinsRef  = useRef(false);        // 저줌 간이표시 중인가(Phase 3-5)
  const cullBoxRef = useRef(null);              // 마지막으로 붙일 때 쓴 화면 범위(컬링용)
  const polylinesRef = useRef([]);
  const driverPinOverlaysRef = useRef([]);
  const completionOverlaysRef = useRef([]); // ②-B 완료좌표 비교 오버레이(점·선·라벨)
  const mapClickListenerRef = useRef(null);
  const initialBoundsRef = useRef(null);
  // true 일 때만 setBounds 호출 — 초기 로드/명단 불러오기/세션 로드 후 한 번만 실행
  const shouldFitBoundsRef = useRef(true);

  useEffect(() => () => {
    if (selectionPulseTimerRef.current) clearTimeout(selectionPulseTimerRef.current);
  }, []);

  const baseForFilter = isCloudMode ? records : gridData;
  const dongList = [...new Set(baseForFilter.map(r => getRouteDong(r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  // 행정동별 실제 레코드 건수 (select option 라벨에 표시)
  const dongCounts = useMemo(() => {
    const counts = {};
    baseForFilter.forEach(r => {
      const d = getRouteDong(r);
      if (d) counts[d] = (counts[d] || 0) + 1;
    });
    return counts;
  }, [baseForFilter]);
  // 작업 큐 기반 — activeDong이 있으면 해당 동만, 없으면 전체
  const activeDong = dongQueue[activeDongIndex] ?? null;
  const selectedDong = activeDong ?? '전체'; // 기존 코드 호환 alias (setSelectedDong 없음)
  // ★`useMemo` 필수(2026-08-23 Phase 3-1) — 예전엔 매 렌더 새 배열이라, 이걸 deps 로 쓰는 `displayRecords`·
  //   `mapRecords` 의 메모가 **동 큐가 잡힌 상시 경로에서 전부 무력화**됐다(전건 정렬이 렌더마다 다시 돌았다).
  const filteredRecords = useMemo(
    () => (activeDong ? records.filter(r => getRouteDong(r) === activeDong) : records),
    [records, activeDong],
  );

  const hasDongSetupMapping = !!setupDongDriverMapProp && Object.keys(setupDongDriverMapProp).length > 0;

  // ── 공통: 동 → 매핑 기사ID 해석 (목록·단일배정·자동분할이 같은 결과를 내도록 단일화) ──
  // 좌표이탈 시 activeDong이 배정행정동(카카오 동명)으로 바뀌어 setup 키(원본 행정동)와 어긋날 수 있어,
  // dong + 레코드 원본 행정동/routeDong/배정행정동을 후보로, 공백/포맷 차이를 정규화해 매칭.
  const resolveDongMappedIds = useCallback((dong, dongRecs = []) => {
    if (!setupDongDriverMapProp) return [];
    const norm = (s) => String(s || '').replace(/\s+/g, '');
    const mapKeys = Object.keys(setupDongDriverMapProp);
    const cands = [dong, dongRecs[0]?.행정동, dongRecs[0]?.routeDong, dongRecs[0]?.배정행정동].filter(Boolean);
    for (const ck of cands) {
      if (setupDongDriverMapProp[ck]) return setupDongDriverMapProp[ck];
      const nk = norm(ck) ? mapKeys.find(k => norm(k) === norm(ck)) : null;
      if (nk) return setupDongDriverMapProp[nk];
    }
    return [];
  }, [setupDongDriverMapProp]);

  // ── 현재 동에 한정된 기사 목록 — 동이 바뀌면 그 동의 기사 구성으로 새로 표시 ──
  // setupDongDriverMap[현재동] 매핑 기사 + 현재 동에 실제 배정된 기사 + 외부기사. 매핑 없으면 전역 폴백.
  const dongScopedDrivers = useMemo(() => {
    if (!hasDongSetupMapping) return drivers; // 셋업 매핑 없으면 전역
    const ids = new Set(resolveDongMappedIds(activeDong, filteredRecords));
    filteredRecords.forEach(r => { if (r._driverId) ids.add(r._driverId); }); // 현재 동에 이미 배정된 기사도 포함(관리용)
    return allKnownDrivers.filter(d => d.isExternal || ids.has(d.id));
  }, [hasDongSetupMapping, drivers, allKnownDrivers, activeDong, resolveDongMappedIds, filteredRecords]);

  // 동을 바꿨을 때 해당 동 담당 기사가 현재 세션 drivers에 없으면 소속사 기사 풀에서 즉시 복구한다.
  useEffect(() => {
    if (!hasDongSetupMapping || !activeDong) return;
    const mappedIds = resolveDongMappedIds(activeDong, filteredRecords);
    if (!mappedIds.length) return;
    const currentIds = new Set(drivers.map(d => d.id));
    const missingDrivers = allKnownDrivers.filter(d => mappedIds.includes(d.id) && !currentIds.has(d.id));
    if (!missingDrivers.length) return;
    setDrivers(prev => [...prev, ...missingDrivers]);
  }, [hasDongSetupMapping, activeDong, filteredRecords, drivers, allKnownDrivers, resolveDongMappedIds]);

  // cloud_lists의 기사 문자열이 이미 저장되어 있으면 지도 내부 배정 키(_driverId)로 복원한다.
  // 매칭 풀 = allKnownDrivers(회사풀·시작기사) + drivers(현재 세션·route_sessions 저장본).
  //   재진입 시 저장본 기사가 회사풀에 없어도 route_sessions에서 로드된 drivers로 복원되게 함(이슈①).
  useEffect(() => {
    if (!records.length) return;
    const matchPool = [...allKnownDrivers, ...drivers];
    if (!matchPool.length) return;
    const nameToId = new Map();
    matchPool.forEach(d => {
      const name = String(d.name || '').trim();
      if (name && !nameToId.has(name)) nameToId.set(name, d.id);
    });
    let changed = false;
    const restored = records.map(r => {
      if (r._driverId) return r;
      const savedDriverRaw = String(r.기사 || r._origDriver || '').trim();
      if (!savedDriverRaw || savedDriverRaw.includes('/')) return r;
      const driverName = savedDriverRaw.trim();
      const driverId = nameToId.get(driverName);
      if (!driverId) return r;
      changed = true;
      return { ...r, _driverId: driverId };
    });
    if (changed) setRecords(restored);
  }, [records, allKnownDrivers, drivers]);

  const [listFilterGubun, setListFilterGubun] = useState('');
  // ★`useMemo` 필수 — 예전엔 즉시실행(IIFE)이라 **렌더마다** 전건 정렬이 돌았다. 이 컴포넌트는 상태가 89개라
  //   토스트 하나에도 재계산됐고, 3,000건에서 렌더당 103ms(8,000건 395ms)로 화면이 끊겼다(2026-08-23 점검 실측).
  //   비교자 안에서 extractRoadAddress 를 부르면 n·log n 번 재파싱되므로 **한 번만** 뽑아 쓴다.
  const displayRecords = useMemo(() => {
    let base = selectedDriverFilter === 'all' ? filteredRecords
      : selectedDriverFilter === 'none' ? filteredRecords.filter(r => !r._driverId)
      : filteredRecords.filter(r => r._driverId === selectedDriverFilter);
    if (listFilterGubun) base = base.filter(r => (r.구분 || '') === listFilterGubun);
    const coll = new Intl.Collator('ko', { numeric: true });
    // 도로명 → 이름 순 정렬 (도로명은 레코드당 1회만 파싱)
    return base
      .map(r => ({ r, _road: extractRoadAddress(r.주소 || ''), _nm: r.이름 || '' }))
      .sort((x, y) => {
        const cmp = coll.compare(x._road, y._road);
        return cmp !== 0 ? cmp : coll.compare(x._nm, y._nm);
      })
      .map(x => x.r);
  }, [filteredRecords, selectedDriverFilter, listFilterGubun]);
  // 드래그 순번 모드: 배송순번 기준 정렬로 전환
  const listRecords = isSeqDragMode
    ? [...displayRecords].sort((a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999))
    : displayRecords;

  const mapRecords = displayRecords.filter(r => r._lat && r._lng);
  const aptRecords = filteredRecords.filter(r => isApartmentLike(r));
  // 카운트는 현재 작업 동(filteredRecords) 기준 — 지도·리스트·매칭·자동분할 모두 동 단위로 동작하므로 통일.
  // activeDong 없으면(전체 보기) filteredRecords === records 라 전체 기준과 동일.
  const withCoordCount = filteredRecords.filter(r => !r._isApt && r._lat && r._lng).length;
  const aptCount = filteredRecords.filter(r => r._isApt).length;
  const aptWithCoord = filteredRecords.filter(r => r._isApt && r._lat && r._lng).length;
  const noCoordCount = filteredRecords.filter(r => !r._isApt && (!r._lat || !r._lng)).length;
  const aptNoCoord = filteredRecords.filter(r => r._isApt && (!r._lat || !r._lng)).length;
  const totalWithCoord = withCoordCount + aptWithCoord;
  const totalNoCoord = noCoordCount + aptNoCoord;
  // 지자체벗어남: 좌표는 있어서 지도에 표시되지만 지자체가 다른 건 (현재 작업 동 기준)
  const outCityCount = filteredRecords.filter(r => r.좌표검증상태 === '지자체벗어남' && r._lat && r._lng).length;
  const totalAll = filteredRecords.length;
  const withCoordPct = totalAll > 0 ? Math.round(totalWithCoord / totalAll * 100) : 0;
  const unassigned = filteredRecords.filter(r => !r._driverId).length;
  const filteredQty = filteredRecords.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);

  // ── 토스트 알림 헬퍼 (다른 모든 useCallback보다 먼저 선언 필수) ──────────
  const showToast = useCallback((type, message, duration = 3500) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  // ── R-K: 기사별 평균 이동거리 (배송순번 기준, 미터) ─────────────────────
  const driverAvgDist = useMemo(() => {
    const result = {};
    drivers.forEach(d => {
      const dRecs = filteredRecords
        .filter(r => r._driverId === d.id && r._lat && r._lng)
        .sort((a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999));
      if (dRecs.length < 2) { result[d.id] = 0; return; }
      let total = 0;
      for (let i = 1; i < dRecs.length; i++)
        total += haversine(dRecs[i - 1]._lat, dRecs[i - 1]._lng, dRecs[i]._lat, dRecs[i]._lng);
      result[d.id] = Math.round(total / (dRecs.length - 1));
    });
    return result;
  }, [filteredRecords, drivers]);

  // ── 아파트 단지별 그룹핑 (임대 다기사 배정용) ───────────────────────────
  const aptComplexGroups = useMemo(() => {
    const groups = {};
    aptRecords.forEach(r => {
      const aptMeta = getAptGroupMeta(r);
      if (!aptMeta) return;
      if (!groups[aptMeta.key]) groups[aptMeta.key] = { ...aptMeta, records: [] };
      groups[aptMeta.key].records.push(r);
    });
    return groups;
  }, [aptRecords]);

  // ── "+추가" 피커: 모달이 열린 행정동 소속 기사 제외
  // 행정동 선택 시: 해당 동 담당 기사와 이미 해당 동 레코드에 배정된 기사 제외 → 다른 동 담당 기사는 표시
  // 행정동 미선택('전체') 또는 배정 0건: 세션에 없는 기사만 표시 (fallback)
  const availableCompanyDrivers = useMemo(() => {
    if (!companyDriverPool?.length) return [];

    const activeDong = pickerDong && pickerDong !== '전체' ? pickerDong : null;
    const validCompanyDrivers = companyDriverPool.filter(d => !d.isExternal && (d.name || '').trim());

    if (activeDong) {
      // 현재 행정동에 소속된 기사 ID와 레코드가 배정된 기사 ID를 함께 제외
      const dongDriverIds = new Set(
        records
          .filter(r => getRouteDong(r) === activeDong && r._driverId)
          .map(r => r._driverId)
      );
      (setupDongDriverMapProp?.[activeDong] || []).forEach(id => dongDriverIds.add(id));
      const dongDriverNames = new Set(
        [...drivers, ...validCompanyDrivers]
          .filter(d => dongDriverIds.has(d.id))
          .map(d => (d.name || '').trim())
          .filter(Boolean)
      );
      return validCompanyDrivers.filter(d =>
        !dongDriverIds.has(d.id) &&
        !dongDriverNames.has((d.name || '').trim())
      );
    }

    // fallback: 배정 없거나 전체 보기 → 세션에 없는 기사
    const activeNames = new Set(drivers.filter(d => !d.isExternal).map(d => (d.name || '').trim()));
    return validCompanyDrivers.filter(d => !activeNames.has((d.name || '').trim()));
  }, [companyDriverPool, drivers, records, pickerDong, setupDongDriverMapProp]);

  // ── 50포↑ 임대 대형 단지 목록 (좌측 패널 패널에 표시)
  const largeAptComplexes = useMemo(() => {
    return Object.values(aptComplexGroups)
      .filter(({ label, road, building, records: recs }) => {
        const qty = recs.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
        const rentalText = [label, road, building, ...recs.map(r => r.주소 || '')].join(' ');
        const rentalDetected = RENTAL_LIKE_RE.test(rentalText) || recs.some(isRentalLike);
        // 50포 이상 아파트는 누락되면 배송 배정 리스크가 크므로 모두 노출하고,
        // 임대 키워드가 없으면 "대형단지"로 표시해 담당자가 직접 판단하게 한다.
        return qty >= 50 && (rentalDetected || recs.some(isApartmentLike));
      })
      .map(({ key, label, road, records: recs }) => ({
        aptKey: key,
        aptName: label,
        road,
        rentalDetected: recs.some(isRentalLike) || RENTAL_LIKE_RE.test([label, road, ...recs.map(r => r.주소 || '')].join(' ')),
        buildingCount: [...new Set(recs.map(r => parseAptDong([r._detailAddress, r.주소].filter(Boolean).join(' ')) ?? 0))].filter(Boolean).length,
        totalQty: recs.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0),
      }))
      .sort((a, b) => b.totalQty - a.totalQty);
  }, [aptComplexGroups]);

  const mapInsights = useMemo(() => buildMapInsights({
    records: filteredRecords,
    drivers,
    largeAptComplexes,
  }), [filteredRecords, drivers, largeAptComplexes]);

  const openAptMultiModal = useCallback((aptKey) => {
    const aptGroup = aptComplexGroups[aptKey];
    const members = aptGroup?.records || [];
    if (!members.length) return;
    const dongMap = {};
    members.forEach(r => {
      const dong = parseAptDong([r._detailAddress, r.detailAddress, r.주소, r.특이사항].filter(Boolean).join(' ')) ?? 0;
      if (!dongMap[dong]) dongMap[dong] = [];
      dongMap[dong].push(r);
    });
    const totalQty = members.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
    const dongsArr = Object.entries(dongMap)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([dong, recs]) => {
        const qty = recs.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
        const currentDriverId = recs[0]?._driverId || null;
        return { dong: parseInt(dong) || 0, records: recs, qty, assignedDriverId: currentDriverId };
      });
    // 자동 균등 분할 제안: 절반 기준 2기사
    const half = Math.ceil(dongsArr.length / 2);
    const currentDriverIds = [...new Set(members.map(r => r._driverId).filter(Boolean))];
    const firstDriverId = currentDriverIds[0] || drivers[0]?.id || null;
    const secondDriverId = drivers.find(d => d.id !== firstDriverId)?.id || drivers[1]?.id || firstDriverId;
    const suggested = dongsArr.map((d, i) => ({
      ...d,
      assignedDriverId: d.dong === 0
        ? (d.assignedDriverId || firstDriverId)
        : (i < half ? firstDriverId : secondDriverId),
    }));
    setAptMultiModal({ aptName: aptGroup.label, road: aptGroup.road, totalQty, dongs: suggested });
  }, [aptComplexGroups, drivers]);

  const applyAptMultiAssignment = useCallback(async () => {
    if (!aptMultiModal) return;
    const updates = {};
    aptMultiModal.dongs.forEach(d => {
      d.records.forEach(r => { updates[r.id] = d.assignedDriverId; });
    });
    setRecords(prev => prev.map(r => r.id in updates
      ? { ...r, _driverId: updates[r.id], 대형단지분할: Boolean(updates[r.id]), 배송상태: updates[r.id] ? '대형단지분할배정' : r.배송상태 }
      : r
    ));
    if (isCloudMode && cloudCity && cloudMonthId) {
      const cloudItems = aptMultiModal.dongs.flatMap(d =>
        d.records
          .filter(r => r._cloudDocId)
          .map(r => ({ docId: r._cloudDocId, driverId: d.assignedDriverId || '' }))
      );
      for (let i = 0; i < cloudItems.length; i += 499) {
        const batch = writeBatch(db);
        cloudItems.slice(i, i + 499).forEach(item => {
          const driverName = drivers.find(dr => dr.id === item.driverId)?.name || '';
          batch.set(
            doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', item.docId),
            {
              기사: driverName,
              배송순번: '',
              배송상태: driverName ? '대형단지분할배정' : '확인후배정가능',
              대형단지분할: Boolean(driverName),
              대형단지분할일시: serverTimestamp(),
              대형단지분할자: auth.currentUser?.email || '',
            },
            { merge: true }
          );
        });
        await batch.commit();
      }
    }
    setAptMultiModal(null);
    showToast('success', `${aptMultiModal.aptName} — ${aptMultiModal.dongs.length}개 동 배정 완료`);
  }, [aptMultiModal, isCloudMode, cloudCity, cloudMonthId, drivers, showToast]);

  // ── 좌표 삭제 브러시 적용 ─────────────────────────────────────────────
  const handleCoordBrushApply = useCallback(async (deletedIds, keepModalOpen = false) => {
    setRecords(prev => prev.map(r => deletedIds.has(r.id) ? {
      ...r,
      이전좌표: r._lat && r._lng ? { lat: r._lat, lng: r._lng, source: r.좌표출처 || '' } : r.이전좌표,
      _lat: null,
      _lng: null,
      _driverId: null,
      배송순번: '',
      좌표상태: '좌표없음',
      좌표검증상태: '',
      좌표확인지자체: '',
      좌표확인행정동: '',
      좌표오류지정: true,
      배정행정동: '',
      이관필요: false,
      배송상태: '주소확인필요',
    } : r));
    if (!keepModalOpen) setShowCoordBrush(false);
    if (isCloudMode && cloudCity && cloudMonthId && deletedIds.size) {
      const cloudItems = [];
      records.forEach(r => { if (deletedIds.has(r.id) && r._cloudDocId) cloudItems.push(r); });
      for (let i = 0; i < cloudItems.length; i += 499) {
        const batch = writeBatch(db);
        cloudItems.slice(i, i + 499).forEach(r => {
          batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId), {
            lat: null,
            lng: null,
            기사: '',
            배송순번: '',
            좌표상태: '좌표없음',
            좌표검증상태: '',
            좌표확인지자체: '',
            좌표확인행정동: '',
            좌표오류지정: true,
            좌표오류지정일시: serverTimestamp(),
            좌표오류지정자: auth.currentUser?.email || '',
            배정행정동: '',
            이관필요: false,
            배송상태: '주소확인필요',
            좌표수정일시: serverTimestamp(),
            좌표수정자: auth.currentUser?.email || '',
            ...(r._lat && r._lng ? { 이전좌표: { lat: r._lat, lng: r._lng, source: r.좌표출처 || '' } } : {}),
          });
        });
        await batch.commit();
      }
    }
    showToast('success', `좌표 ${deletedIds.size}건 삭제 완료`);
  }, [records, isCloudMode, cloudCity, cloudMonthId, showToast]);

  // ── Route Worker 초기화 / 정리 ──────────────────────────────────────────
  useEffect(() => {
    const worker = new Worker(new URL('../workers/routeWorker.js', import.meta.url), { type: 'module' });
      worker.onerror = (err) => {   // ★워커 로드 실패 시 진행 상태가 안 풀려 '분할중…'에서 굳던 자리(2026-08-23 점검)
        console.error('루트 워커 오류:', err);
        try { worker.terminate(); } catch { /* 이미 종료 */ }
        setIsSplitting?.(false);
        showToast?.('error', '자동 계산에 실패했습니다. 새로고침 후 다시 시도해 주세요.');
      };
    routeWorkerRef.current = worker;
    return () => { worker.terminate(); routeWorkerRef.current = null; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- 워커는 한 번만 만든다 — 넣으면 워커가 재생성된다

  // ── 클라우드 명단에서 자동 로드 (CloudListManager에서 열린 경우) ──────
  useEffect(() => {
    if (!initialCloudCity || !initialCloudMonthId) return;
    setCloudPickerCity(initialCloudCity);
    setCloudPickerMonth(initialCloudMonthId);
    // 약간의 딜레이 후 자동 로드 (Kakao SDK 초기화 대기)
    const timer = setTimeout(async () => {
      setIsLoadingCloud(true);
      try {
        const snap = await getDocs(
          collection(db, 'cloud_lists', initialCloudCity, 'months', initialCloudMonthId, 'records')
        );
        if (!snap.empty) {
          let loaded = snap.docs.map(d => ({
            id: d.id,
            _cloudDocId: d.id,
            ...d.data(),
            _driverId: null,
            _lat: d.data().lat || null,
            _lng: d.data().lng || null,
            _isApt: d.data().isApt || false,
            _origDriver: d.data().기사 || '',
            _origSeqNo: d.data().배송순번 || '',
          }));
          // 조직 필터 (접근 권한)
          if (orgDongs) {
            loaded = loaded.filter(r => orgDongs.has(String(r.행정동 || '').trim()));
          }

          // ── 오탐 자동 보정: 이전 geocoding에서 경기↔경기도 등 접미어 불일치로
          //   잘못 저장된 '지자체벗어남' 레코드를 현재 normalizeRegionKey로 재검증
          const falsePositiveDocIds = [];
          loaded = loaded.map(r => {
            if (r.좌표검증상태 !== '지자체벗어남' || !r._lat || !r._lng) return r;
            if (!revalidateAreaMatch(r.좌표확인지자체, initialCloudCity)) return r;
            falsePositiveDocIds.push(r._cloudDocId);
            const wasCityOnly = r.배송상태 === '타지자체확인필요';
            return {
              ...r,
              좌표검증상태: '정상',
              ...(wasCityOnly ? {
                확인필요: false,
                _에러: false,
                배송상태: '배송준비',
                _사유: '',
              } : {}),
            };
          });

          if (falsePositiveDocIds.length > 0) {
            // Firestore 백그라운드 일괄 수정
            (async () => {
              try {
                for (let i = 0; i < falsePositiveDocIds.length; i += 499) {
                  const batch = writeBatch(db);
                  falsePositiveDocIds.slice(i, i + 499).forEach(docId => {
                    if (!docId) return;
                    batch.update(doc(db, 'cloud_lists', initialCloudCity, 'months', initialCloudMonthId, 'records', docId), {
                      좌표검증상태: '정상',
                      확인필요: false,
                      _에러: false,
                      배송상태: '배송준비',
                      _사유: '',
                    });
                  });
                  await batch.commit();
                }
                showToast('success', `지자체이탈 오탐 ${falsePositiveDocIds.length}건 자동 보정 완료`);
              } catch (e) {
                console.error('오탐 자동 보정 실패:', e);
              }
            })();
          }

          // selectedDongsProp은 레코드 로드 필터가 아닌 큐 정의에만 사용
          // → 전체 레코드를 메모리에 올려두고 activeDong으로 뷰 필터
          setRecords(loaded);
          setIsCloudMode(true);
          setCloudCity(initialCloudCity);
          setCloudMonthId(initialCloudMonthId);
          // ★ 재진입 자동복원(이슈①): route_sessions에 저장된 기사구성을 로드해
          //   저장본의 기사·배송순번이 지도에 자동으로 복원되게 한다.
          //   (loaded records엔 이미 기사·배송순번 문자열이 있으나, 그 기사명을
          //    _driverId로 되돌리려면 drivers 풀에 저장본 기사가 있어야 함 → 여기서 채움)
          try {
            const sessSnap = await getDoc(doc(db, 'route_sessions', initialCloudCity, 'months', initialCloudMonthId));
            if (sessSnap.exists()) {
              const sessData = sessSnap.data();
              if (Array.isArray(sessData.drivers) && sessData.drivers.length) {
                setDrivers(sessData.drivers);
                setDriverCount(sessData.drivers.length);
              }
              if (sessData.status) setSessionStatus(sessData.status);
            }
          } catch (sessErr) {
            console.error('route_sessions 자동복원 실패:', sessErr);
          }
          // dongQueue: 설정에서 선택한 동 순서 (없으면 전체 동)
          const allDongs = [...new Set(loaded.map(r => getRouteDong(r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
          const queueDongs = selectedDongsProp
            ? allDongs.filter(d => selectedDongsProp.has(d))
            : allDongs;
          setDongQueue(queueDongs.length ? queueDongs : allDongs);
          setActiveDongIndex(0);
          setCompletedDongs(new Set());
          setIsDirty(false);
        }
      } catch (e) {
        console.error('클라우드 자동 로드 실패:', e);
      } finally {
        setIsLoadingCloud(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [initialCloudCity, initialCloudMonthId]);   // eslint-disable-line react-hooks/exhaustive-deps -- 워커는 한 번만 만든다 — 넣으면 워커가 재생성된다

  // ── activeDongIndex 변경 시 동별 임시 상태 초기화 + 지도 자동 이동 ────────
  useEffect(() => {
    if (!dongQueue.length) return;
    setDriverPins({});
    setSequenceAnalysis(null);
    setHasRunGeocoding(false);
    setSelectedDriverFilter('all');
    setIsDirty(false);
    // 새 동의 핀 범위로 지도 자동 이동 (오버레이 useEffect에서 setBounds 실행)
    shouldFitBoundsRef.current = true;
  }, [activeDongIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 단일 기사 동: 전체 동 레코드를 그 기사에 자동 배정 (R-L 1동=1기사, 이슈 4·1) ──
  // setup에서 이 동에 1명만 배정됐거나(setupDongDriverMap), 활성 기사가 1명일 때.
  // 진입·큐설정·좌표채움(records 변동) 시 반영. 좌표가 지자체 밖(배정불가)인 건은 제외.
  useEffect(() => {
    if (!dongQueue.length) return;
    const dong = dongQueue[activeDongIndex];
    const dongRecs = records.filter(r => getRouteDong(r) === dong);
    const mapped = resolveDongMappedIds(dong, dongRecs);
    // 맵핑(setupDongDriverMap)에서 이 동에 기사 '1명만' 확정된 경우에만 전체 동 자동 배정.
    // 2명 이상 배정된 동은 자동 입력하지 않는다(지도 자동분할로 배정). 맵핑 없으면 자동 입력 안 함.
    const soleDriverId = (Array.isArray(mapped) && mapped.length === 1) ? mapped[0] : null;
    if (!soleDriverId || !allKnownDrivers.some(d => d.id === soleDriverId)) return;
    const needsAssign = records.some(r => getRouteDong(r) === dong && r._driverId !== soleDriverId && isCoordAssignable(r));
    if (!needsAssign) return;
    setRecords(prev => prev.map(r =>
      (getRouteDong(r) === dong && r._driverId !== soleDriverId && isCoordAssignable(r))
        ? { ...r, _driverId: soleDriverId }
        : r
    ));
    setIsDirty(true);
  }, [activeDongIndex, dongQueue, records, allKnownDrivers, setupDongDriverMapProp]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 행정동 큐 이동 — 미저장 변경 있으면 확인 모달 표시 ──────────────────
  const handleDongNavigate = useCallback((targetIndex) => {
    if (targetIndex < 0 || targetIndex >= dongQueue.length) return;
    if (targetIndex === activeDongIndex) return;
    if (isDirty) {
      setShowDongNavConfirm({ targetIndex });
      return;
    }
    setActiveDongIndex(targetIndex);
  }, [activeDongIndex, dongQueue.length, isDirty]);

  // ── 큐에서 동 제외 ────────────────────────────────────────────────────
  const handleRemoveDongFromQueue = useCallback((dongToRemove) => {
    setDongQueue(prev => {
      const newQueue = prev.filter(d => d !== dongToRemove);
      const removedIdx = prev.indexOf(dongToRemove);
      const newIdx = Math.max(0, Math.min(removedIdx, newQueue.length - 1));
      setActiveDongIndex(newIdx);
      setIsDirty(false);
      return newQueue;
    });
  }, []);

  // ── 큐에 동 추가 ─────────────────────────────────────────────────────
  const handleAddDongToQueue = useCallback((dongToAdd) => {
    setDongQueue(prev => {
      if (prev.includes(dongToAdd)) return prev;
      const newQueue = [...prev, dongToAdd].sort((a, b) => a.localeCompare(b, 'ko'));
      const newIdx = newQueue.indexOf(dongToAdd);
      setActiveDongIndex(newIdx);
      return newQueue;
    });
  }, []);

  // ── Kakao Maps SDK 로딩 ─────────────────────────────────────────────
  useEffect(() => {
    if (window.kakao?.maps?.Map) { setIsMapReady(true); return; }
    const existing = document.getElementById('kakao-map-sdk');
    if (existing) { existing.onload = () => window.kakao.maps.load(() => setIsMapReady(true)); return; }
    const script = document.createElement('script');
    script.id = 'kakao-map-sdk';
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&libraries=clusterer&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao.maps.load(() => setIsMapReady(true));
    document.head.appendChild(script);
  }, []);

  // ── 지도 초기화 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMapReady || !mapRef.current || kakaoMapRef.current) return;
    kakaoMapRef.current = new window.kakao.maps.Map(mapRef.current, {
      center: new window.kakao.maps.LatLng(37.5665, 126.9780),
      level: 7,
    });
  }, [isMapReady]);

  // ── layoutMode 변경 시 카카오 지도 relayout ──────────────────────────
  useEffect(() => {
    if (!kakaoMapRef.current) return;
    const t = setTimeout(() => kakaoMapRef.current?.relayout(), 200);
    return () => clearTimeout(t);
  }, [layoutMode]);

  // ── 배경지도 타입(일반/위성) — 카카오 내장 HYBRID(위성+라벨) 활용 ──────
  useEffect(() => {
    const map = kakaoMapRef.current;
    if (!map || !window.kakao?.maps) return;
    const T = window.kakao.maps.MapTypeId;
    map.setMapTypeId(mapType === 'hybrid' ? T.HYBRID : T.ROADMAP);
  }, [mapType, isMapReady]);

  // ── 지적편집도 오버레이(카카오 USE_DISTRICT) 토글 ──────────────────────
  useEffect(() => {
    const map = kakaoMapRef.current;
    if (!map || !window.kakao?.maps) return;
    const T = window.kakao.maps.MapTypeId;
    if (showCadastral) map.addOverlayMapTypeId(T.USE_DISTRICT);
    else map.removeOverlayMapTypeId(T.USE_DISTRICT);
  }, [showCadastral, isMapReady]);

  // ── Escape → mapfull 해제 / 핀 배치 모드 취소 ──────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        setLayoutMode(m => m === 'mapfull' ? 'split' : m);
        setPlacingPinForDriver(null);
        setIsPaintMode(false);
        if (paintRafRef.current) { cancelAnimationFrame(paintRafRef.current); paintRafRef.current = 0; }
        isPaintingRef.current = false;
        if (kakaoMapRef.current) kakaoMapRef.current.setDraggable(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── 기사 핀 배치: 지도 클릭 → 해당 기사 핀 설정 ───────────────────────
  useEffect(() => {
    if (!kakaoMapRef.current || !isMapReady) return;
    // 기존 리스너 제거 (removeListener는 반드시 map, type, handler 3인자 필요)
    if (mapClickListenerRef.current) {
      window.kakao.maps.event.removeListener(kakaoMapRef.current, 'click', mapClickListenerRef.current);
      mapClickListenerRef.current = null;
    }
    if (!placingPinForDriver) return;
    // 핸들러 함수를 ref에 저장해야 동일 참조로 removeListener 가능
    const driverId = placingPinForDriver;
    let fired = false; // 단일 발화 보장 (더블클릭 방지)
    const handler = (mouseEvent) => {
      if (fired) return;
      fired = true;
      const lat = mouseEvent.latLng.getLat();
      const lng = mouseEvent.latLng.getLng();
      window.kakao.maps.event.removeListener(kakaoMapRef.current, 'click', handler);
      mapClickListenerRef.current = null;
      setDriverPins(prev => ({ ...prev, [driverId]: { lat, lng } }));
      setPlacingPinForDriver(null);
    };
    window.kakao.maps.event.addListener(kakaoMapRef.current, 'click', handler);
    mapClickListenerRef.current = handler;
    return () => {
      if (mapClickListenerRef.current) {
        window.kakao.maps.event.removeListener(kakaoMapRef.current, 'click', mapClickListenerRef.current);
        mapClickListenerRef.current = null;
      }
    };
  }, [placingPinForDriver, isMapReady]);

  // ── 기사 핀 오버레이 렌더링 ────────────────────────────────────────────
  useEffect(() => {
    if (!kakaoMapRef.current) return;
    driverPinOverlaysRef.current.forEach(o => o.setMap(null));
    driverPinOverlaysRef.current = [];
    drivers.forEach(d => {
      const pin = driverPins[d.id];
      if (!pin) return;
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;';
      el.innerHTML = `
        <div style="width:40px;height:40px;border-radius:50%;background:${d.color};display:flex;align-items:center;justify-content:center;border:4px solid rgba(255,255,255,0.95);box-shadow:0 0 0 3px ${d.color}70,0 4px 16px rgba(0,0,0,0.8);position:relative;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        </div>
        <div style="background:${d.color};color:white;font-size:10px;font-weight:900;padding:2px 8px;border-radius:10px;margin-top:3px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.6);">${escHtml(d.name)}</div>
      `;
      el.title = `${d.name} 거점 핀 — 우클릭으로 삭제`;
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        setDriverPins(prev => { const next = { ...prev }; delete next[d.id]; return next; });
      });
      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(pin.lat, pin.lng),
        content: el,
        yAnchor: 1.15,
        xAnchor: 0.5,
        zIndex: 30,
      });
      overlay.setMap(kakaoMapRef.current);
      driverPinOverlaysRef.current.push(overlay);
    });
  }, [driverPins, drivers]);

  // [제거됨] 경계선 짝대기(이동 경계) 기능 — 무거운 오버레이/드래그 재배정 로직 삭제.
  // 기사 구역 나누기는 자동 N등분(PCA 연속분할) + 브러시 수동보정으로 대체한다.

  // ⑥ 전월 작업내역 신규(NEW) 판정 — 클라우드 명단의 "전월" delivery_history 로드 → 강키+양측유일 매칭
  // 지도 명단 리스트에 NEW 배지를 띄우기 위한 표시용. 저장 스키마는 건드리지 않는다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCarryMap({});
      if (!cloudCity || !cloudMonthId || records.length === 0) return;
      const m = String(cloudMonthId).match(/^(\d{4})-(\d{2})$/);
      if (!m) return;
      const pd = new Date(Number(m[1]), Number(m[2]) - 2, 1);
      const prevId = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
      try {
        const snap = await getDocs(collection(db, 'delivery_history', cloudCity, 'months', prevId, 'records'));
        if (cancelled) return;
        const prevRecords = snap.docs.map(d => d.data());
        const map = {};
        annotateCarryover(prevRecords, records).forEach(r => {
          map[r.id] = { _isNew: r._isNew, _prevDriver: r._prevDriver, _prevSeqNo: r._prevSeqNo, _carryAmbiguous: r._carryAmbiguous };
        });
        if (!cancelled) setCarryMap(map);
      } catch (e) {
        console.warn('[⑥ 지도 전월 신규판정] 로드 실패:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [cloudCity, cloudMonthId, records.length]);   // eslint-disable-line react-hooks/exhaustive-deps -- records.length 로만 다시 계산한다(행 편집마다 재계산 방지)

  // ── 변경 감지 ─────────────────────────────────────────────────────
  useEffect(() => { setHasUnsaved(true); }, [records, drivers]);
  useEffect(() => { recordsRef.current = records; }, [records]);
  useEffect(() => {
    if (!['dongGroup', 'hilbert'].includes(autoSplitStrategy)) setAutoSplitStrategy('dongGroup');
  }, [autoSplitStrategy]);
  useEffect(() => { autoSaveDataRef.current = { records, drivers }; }, [records, drivers]);

  // ── 5분 자동 임시저장 (클라우드 모드만) ──────────────────────────────
  // autoSaveDataRef 로 최신값 참조 → deps에 records/drivers 제거 (타이머가 매 편집마다 리셋되던 버그 수정)
  useEffect(() => {
    if (!isCloudMode || !cloudCity || !cloudMonthId) return;
    if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    saveTimerRef.current = setInterval(async () => {
      const { records: r, drivers: d } = autoSaveDataRef.current;
      try {
        await setDoc(
          doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId),
          {
            city: cloudCity, monthId: cloudMonthId,
            savedAt: serverTimestamp(),
            savedBy: auth.currentUser?.email || '',
            // ★DS-9-5: 출발지(startAddr/startLat/startLng)는 세션 저장에 넣지 않는다 — 기사 집주소일 수 있다(2026-08-23 점검)
            drivers: d.map(dr => ({ id: dr.id, name: dr.name, color: dr.color, capacity: dr.capacity || 100, deliveryDate: dr.deliveryDate || '' })),
            status: 'draft',
            totalRecords: r.length,
            assignedCount: r.filter(rec => rec._driverId).length,
            selectedDongs: selectedDongsProp ? [...selectedDongsProp] : (orgDongs ? [...orgDongs] : null),
          },
          { merge: true }
        );
        setLastAutoSave(new Date());
        setHasUnsaved(false);
        setSessionStatus('draft');
      } catch (err) {
        // 자동저장 실패는 배송을 막지 않는다(미저장 표시는 그대로 남는다) — 다만 **조용히** 넘기지는 않는다.
        console.warn('[자동저장] 실패 — 미저장 상태 유지:', err);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(saveTimerRef.current);
  }, [isCloudMode, cloudCity, cloudMonthId]); // records·drivers는 autoSaveDataRef로 참조   // eslint-disable-line react-hooks/exhaustive-deps -- 열릴 때 설정값으로 한 번만 잡는다

  // ── 마커 렌더링 (성능 최적화: 핀 데이터 시그니처 기반 갱신) ────────
  const mapPinSignature = useMemo(
    () => mapRecords.map(r => `${r.id}:${r._driverId||''}:${r.배송순번||''}:${!!r._에러}`).join('|'),
    [mapRecords]
  );
  // ★구조 시그니처 — **누가·어디에·몇 포**만 담는다(2026-08-23 Phase 3-3).
  //   색(기사배정)·순번은 여기 없다: 그건 핀 DOM 만 고쳐 쓰면 되고 오버레이를 다시 만들 이유가 없다.
  //   구조가 바뀌면(추가·삭제·좌표변경·포수변경) 예전처럼 전량 재생성한다 — 안전한 쪽으로 폴백.
  const structuralSig = useMemo(
    () => mapRecords.map(r => `${r.id}:${r._lat}:${r._lng}:${r.포수 || r['수량(포수)'] || ''}`).join('|'),
    [mapRecords],
  );
  // 오버레이는 기사 id·색만 영향 — 기사명 편집 등으로는 재생성하지 않도록 시그니처화(재생성 최소화).
  const driverColorSig = useMemo(() => drivers.map(d => `${d.id}:${d.color}`).join('|'), [drivers]);

  // 현재 지도 화면 범위를 평범한 숫자 상자로 — 카카오 객체를 그대로 들고 다니지 않는다(테스트·비교가 쉬워진다).
  const readMapBox = useCallback(() => {
    const map = kakaoMapRef.current;
    if (!map?.getBounds) return null;
    try {
      const b = map.getBounds();
      const sw = b.getSouthWest(); const ne = b.getNorthEast();
      return { south: sw.getLat(), west: sw.getLng(), north: ne.getLat(), east: ne.getLng() };
    } catch { return null; }
  }, []);

  // ── 뷰포트 컬링 재평가 (지도를 멈췄을 때만) ─────────────────────────────
  //   ★핀을 다시 만들지 않는다 — 이미 만든 오버레이를 붙였다 뗄 뿐이다.
  //   평소 경로(수백 건)에서는 아예 동작하지 않는다(CULL_MIN_RECORDS 미만).
  useEffect(() => {
    const map = kakaoMapRef.current;
    if (!map || !window.kakao?.maps) return undefined;
    const onIdle = () => {
      if (overlayByIdRef.current.size < CULL_MIN_RECORDS) return;
      const box = readMapBox();
      if (!box) return;
      cullBoxRef.current = box;
      // 저줌 간이표시(Phase 3-5) — 화면에 붙어 있는 핀만 다시 그린다(떨어진 핀은 붙을 때 그려진다).
      const nextCompact = map.getLevel?.() >= PIN_COMPACT_LEVEL;
      compactPinsRef.current = nextCompact;
      overlayByIdRef.current.forEach((entry) => {
        const r = entry.rec;
        const want = isWithinPaddedBounds(r?._lat, r?._lng, box);
        if (want && entry.pin && entry.compact !== nextCompact) {
          entry.el.innerHTML = buildPinInnerHtml({ ...entry.pin, compact: nextCompact });
          entry.compact = nextCompact;
        }
        if (want === entry.attached) return;
        entry.overlay?.setMap(want ? map : null);
        entry.attached = want;
      });
    };
    window.kakao.maps.event.addListener(map, 'idle', onIdle);
    return () => { try { window.kakao.maps.event.removeListener(map, 'idle', onIdle); } catch { /* 지도 파괴됨 */ } };
  }, [isMapReady, readMapBox]);

  useEffect(() => {
    if (!kakaoMapRef.current) return;

    // ★구조가 그대로면 핀을 **다시 만들지 않는다**(2026-08-23 Phase 3-3).
    //   예전엔 색·순번 1건만 달라져도 전량(파괴 N + 생성 N + DOM 6~9N개)을 다시 만들었다 —
    //   우클릭 배정취소 1회·드롭다운 1회·순번 1칸 입력이 전부 그 비용을 치렀다.
    //   ⚠️경로선·전체범위 맞춤·×N 카운트는 **아래에서 전건 기준으로 그대로** 돈다(불변식 유지).
    const canPatch = structuralSigRef.current === structuralSig
      && overlayByIdRef.current.size === mapRecords.length
      && mapRecords.length > 0;

    if (!canPatch) {
      overlaysRef.current.forEach(o => o.setMap(null));
      overlaysRef.current = [];
      overlayByIdRef.current = new Map();
    }
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];
    structuralSigRef.current = structuralSig;
    if (!mapRecords.length) { overlayByIdRef.current = new Map(); return; }

    // 같은 좌표 그룹 카운트 (소수점 5자리 ≈ 1m 정밀도) — ★항상 **전건** 기준(부분집합으로 세면 ×N 이 틀어진다)
    const coordCountMap = new Map();
    const coordRecsMap  = new Map();
    mapRecords.forEach(r => {
      if (!r._lat || !r._lng) return;
      const key = `${r._lat.toFixed(5)},${r._lng.toFixed(5)}`;
      coordCountMap.set(key, (coordCountMap.get(key) || 0) + 1);
      if (!coordRecsMap.has(key)) coordRecsMap.set(key, []);
      coordRecsMap.get(key).push(r);
    });
    coordRecsMapRef.current = coordRecsMap;

    const driverColorById = new Map(drivers.map(d => [d.id, d.color]));
    // 컬링 여부·현재 화면 범위 — 평소(수백 건)엔 cullActive=false 라 예전과 완전히 같다.
    const cullActive = mapRecords.length >= CULL_MIN_RECORDS;
    const cullBox = cullActive ? readMapBox() : null;
    cullBoxRef.current = cullBox;
    // 저줌 간이표시(Phase 3-5) — 대량일 때만, 그리고 축소했을 때만. 평소 경로는 예전과 완전히 같다.
    const compactNow = cullActive && (kakaoMapRef.current?.getLevel?.() || 0) >= PIN_COMPACT_LEVEL;
    compactPinsRef.current = compactNow;

    if (canPatch) {
      // 변경분만 DOM 갱신 — 오버레이 객체는 그대로 두고 내용과 겹침순서만 바꾼다.
      mapRecords.forEach(r => {
        const entry = overlayByIdRef.current.get(r.id);
        if (!entry) return;
        const color = r._에러 ? '#ef4444' : (driverColorById.get(r._driverId) || '#6b7280');
        const seq = r.배송순번 || '';
        const qtyNum = parseInt(r.포수 || r['수량(포수)']) || 1;
        const prev = entry.rec;
        entry.rec = r;                                   // 리스너가 최신 레코드를 보게 한다(stale 방지)
        const prevColor = prev?._에러 ? '#ef4444' : (driverColorById.get(prev?._driverId) || '#6b7280');
        if (prevColor === color && String(prev?.배송순번 || '') === String(seq) && !!prev?._에러 === !!r._에러) return;
        entry.pin = {
          color, seq,
          name: escHtml((r.이름 || '').slice(0, 5)),
          dong: escHtml((r.행정동 || '').replace(/동$/, '').slice(0, 5)),
          qtyNum, sameCount: entry.sameCount,
        };
        entry.el.innerHTML = buildPinInnerHtml({ ...entry.pin, compact: entry.compact });
        entry.overlay?.setZIndex?.(pinZIndex({ isError: !!r._에러, sameCount: entry.sameCount, qtyNum, seq }));
      });
    }

    if (!canPatch) mapRecords.forEach(r => {
      const color = r._에러 ? '#ef4444' : (driverColorById.get(r._driverId) || '#6b7280');
      const seq = r.배송순번 || '';
      const name = escHtml((r.이름 || '').slice(0, 5));
      const dong = escHtml((r.행정동 || '').replace(/동$/, '').slice(0, 5));
      const qtyNum = parseInt(r.포수 || r['수량(포수)']) || 1;

      const coordKey = `${r._lat.toFixed(5)},${r._lng.toFixed(5)}`;
      const sameCount = coordCountMap.get(coordKey) || 1;
      // 핀 시각 규칙은 `routeMap/mapHelpers.js` 로 뺐다(2026-08-23 Phase 3-3) — 순수함수라 회귀로 잠긴다.
      //   ★여기에 핀 마크업을 다시 쓰지 말 것(불변식 7 · 템플릿 1벌). 3-3 추출 때 남아 있던
      //     ×N 배지 사본을 2026-08-24 에 제거했다 — 쓰이지도 않으면서 "고쳤는데 안 바뀐다"의 씨앗이었다.
      const pinEl = document.createElement('div');
      pinEl.setAttribute('data-record-id', r.id);
      pinEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;';
      const pinParams = { color, seq, name, dong, qtyNum, sameCount };
      pinEl.innerHTML = buildPinInnerHtml({ ...pinParams, compact: compactNow });
      // ★`pin` 을 남겨두는 이유: 줌이 바뀌어 표시 모드가 바뀔 때 **레코드를 다시 훑지 않고** 이 핀만 다시 그린다.
      const entry = { el: pinEl, rec: r, sameCount, coordKey, pin: pinParams, compact: compactNow };
      pinEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (entry.sameCount > 1) {
          // 같은 좌표 여러 명 → 팝업으로 목록 표시
          const rect = mapRef.current?.getBoundingClientRect();
          const mapCont = mapRef.current?.parentElement?.getBoundingClientRect();
          const ox = rect ? e.clientX - (mapCont?.left || 0) : e.clientX;
          const oy = rect ? e.clientY - (mapCont?.top  || 0) : e.clientY;
          setSamePointPopup({ recs: coordRecsMapRef.current.get(entry.coordKey) || [], x: ox, y: oy });
        } else {
          const rect = mapRef.current?.parentElement?.getBoundingClientRect();
          setSeqPin({
            id: entry.rec.id,
            name: entry.rec.이름 || '',
            x: e.clientX - (rect?.left || 0),
            y: e.clientY - (rect?.top || 0),
          });
          handleSelectRecord(entry.rec);
        }
      });
      // 우클릭: 배정 취소
      pinEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        setRecords(prev => prev.map(pr => pr.id === entry.rec.id ? { ...pr, _driverId: null } : pr));
      });

      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(r._lat, r._lng),
        content: pinEl,
        yAnchor: 0.63,
        xAnchor: 0.5,
        zIndex: pinZIndex({ isError: !!r._에러, sameCount, qtyNum, seq }),
      });
      // ★대량일 때만 화면 근처 핀만 붙인다(Phase 3-4) — 오버레이 객체는 버리지 않고 붙였다 뗀다.
      const visible = !cullActive || isWithinPaddedBounds(r._lat, r._lng, cullBox);
      overlay.setMap(visible ? kakaoMapRef.current : null);
      entry.attached = visible;
      overlaysRef.current.push(overlay);
      entry.overlay = overlay;
      overlayByIdRef.current.set(r.id, entry);   // 다음 변경 때 이 핀만 갱신하기 위한 색인
    });

    drivers.forEach(driver => {
      const dRecs = mapRecords.filter(r => r._driverId === driver.id && r.배송순번)
        .sort((a, b) => parseInt(a.배송순번) - parseInt(b.배송순번));
      if (dRecs.length < 2) return;
      // 메인 경로선 (solid)
      const polyline = new window.kakao.maps.Polyline({
        path: dRecs.map(r => new window.kakao.maps.LatLng(r._lat, r._lng)),
        strokeWeight: 3, strokeColor: driver.color, strokeOpacity: 0.7, strokeStyle: 'solid',
      });
      polyline.setMap(kakaoMapRef.current);
      polylinesRef.current.push(polyline);
      // 애니메이션 점선 (offset 효과)
      const dashed = new window.kakao.maps.Polyline({
        path: dRecs.map(r => new window.kakao.maps.LatLng(r._lat, r._lng)),
        strokeWeight: 2, strokeColor: '#ffffff', strokeOpacity: 0.35, strokeStyle: 'shortdash',
      });
      dashed.setMap(kakaoMapRef.current);
      polylinesRef.current.push(dashed);
    });

    const bounds = new window.kakao.maps.LatLngBounds();
    mapRecords.forEach(r => bounds.extend(new window.kakao.maps.LatLng(r._lat, r._lng)));
    // setBounds는 초기 로드/명단 불러오기/세션 로드 직후 1회만 — 자동순번·브러시 등 업데이트 시 줌 유지
    if (!isPaintingRef.current && shouldFitBoundsRef.current) {
      kakaoMapRef.current.setBounds(bounds, 60, 60, 60, 60);
      initialBoundsRef.current = bounds;
      shouldFitBoundsRef.current = false; // 이후 업데이트에서는 줌 고정
    }

  }, [mapPinSignature, driverColorSig, structuralSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 혼재(겹침) 집계 — **마커 렌더링과 분리**(2026-08-23 Phase 3-2) ─────────
  //   예전엔 마커 effect 끝에 얹혀 있어서, 핀을 다시 그릴 때마다 전건 주소파싱이 함께 돌았다.
  //   둘은 서로 필요 없는 계산이다: 마커는 화면, 혼재는 숫자 배지.
  //   경계에 가까운 정상 인접지는 혼재가 아니다 — 같은 아파트/동일주소 단위가 갈라진 경우만 센다(R-F).
  useEffect(() => {
    const routeUnits = buildAssignedRouteUnits(filteredRecords, drivers);
    const mixedKeys = getMixedRouteUnitKeys(routeUnits);
    setOverlapCount(routeUnits
      .filter(unit => mixedKeys.has(unit.key))
      .reduce((sum, unit) => sum + unit.records.length, 0));
  }, [filteredRecords, drivers]);

  // ── 도로주소 단위 연속 권역 자동 배정 ────────────────────────────────
  const handleAutoSplit = useCallback(() => {
    if (isAssignmentLocked) { showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.'); return; }
    // 자동분할 대상 기사 = 현재 동에 매핑된 기사만(셋업의 동↔기사 매칭 준수). 매핑 없으면 전역 활성 기사.
    const mappedIdsForSplit = hasDongSetupMapping ? resolveDongMappedIds(activeDong, filteredRecords) : [];
    const splitPool = (hasDongSetupMapping && mappedIdsForSplit.length)
      ? drivers.filter(d => mappedIdsForSplit.includes(d.id))
      : drivers.slice(0, Math.min(driverCount, drivers.length));
    const activeDrivers = splitPool.filter(d => !d.isExternal);
    const target = filteredRecords.filter(r => r._lat && r._lng && isCoordAssignable(r));
    if (!target.length || !activeDrivers.length) return;
    const safeAutoSplitStrategy = ['dongGroup', 'hilbert'].includes(autoSplitStrategy) ? autoSplitStrategy : 'dongGroup';
    const placedPinCount = activeDrivers.filter(d => !!driverPins[d.id]).length;
    const hasPartialPins = placedPinCount > 0 && placedPinCount < activeDrivers.length;
    if (hasPartialPins) {
      showToast('error', `핀 기준 배정은 기사 ${activeDrivers.length}명 전원의 핀이 필요합니다. 현재 ${placedPinCount}개입니다.`, 6000);
      return;
    }
    const effectiveStrategy = safeAutoSplitStrategy === 'dongGroup' && placedPinCount === activeDrivers.length
      ? 'seedVoronoi'
      : safeAutoSplitStrategy;
    setIsSplitting(true);

    const worker = routeWorkerRef.current;
    if (!worker) {
      showToast('error', 'Worker 초기화 실패. 잠시 후 다시 시도하세요.');
      setIsSplitting(false);
      return;
    }

    // 기존 미처리 리스너 제거 (이전 클릭이 완료 전에 다시 클릭한 경우 방지)
    if (worker._pendingAutoSplit) {
      worker.removeEventListener('message', worker._pendingAutoSplit);
      worker._pendingAutoSplit = null;
    }

    const noCoordRecs = filteredRecords.filter(r => !r._lat || !r._lng || !isCoordAssignable(r));
    const onMessage = (e) => {
      if (e.data.type !== 'autoSplitResult' && e.data.type !== 'autoSplitError') return;
      worker.removeEventListener('message', onMessage);
      worker._pendingAutoSplit = null;
      if (e.data.type === 'autoSplitError') {
        console.error('자동 배정 오류:', e.data.message);
        showToast('error', '자동 배정 중 오류가 발생했습니다.');
        setIsSplitting(false);
        return;
      }
      const { clusterMap, diagnostics } = e.data;
      setRouteAnalysis(diagnostics || null);
      setShowMapAnalysis(true);
      // 행정동 필터 밖의 수동 배정은 자동 배정이 덮어쓰지 않는다.
      const affectedIds = new Set(filteredRecords.map(r => r.id));

      // 핀은 사용자가 기사 수만큼 직접 꽂은 경우에만 사용한다.
      // 핀이 없으면 경계/힐베르트 기준으로 바로 배정하고, 자동 핀 생성은 하지 않는다.
      const PIN_FREE_STRATEGIES = new Set(['dongGroup', 'hilbert']);
      const noPinDrivers = activeDrivers.filter(d => !driverPins[d.id]);
      if (noPinDrivers.length > 0 && !PIN_FREE_STRATEGIES.has(effectiveStrategy)) {
        const pendingPins = {};
        noPinDrivers.forEach(d => {
          const assigned = target.filter(r => clusterMap[r.id] === d.id && r._lat && r._lng);
          if (!assigned.length) return;
          const lat = assigned.reduce((s, r) => s + r._lat, 0) / assigned.length;
          const lng = assigned.reduce((s, r) => s + r._lng, 0) / assigned.length;
          pendingPins[d.id] = { lat, lng };
        });
        if (Object.keys(pendingPins).length > 0) {
          setAutoPinConfirmModal({ clusterMap, pendingPins, diagnostics, affectedIds: [...affectedIds] });
          setIsSplitting(false);
          return; // 확인 모달에서 최종 적용
        }
      }

      // 각도 분할 또는 모든 기사에 이미 핀 있음 → 즉시 적용
      setRecords(prev => prev.map(r => affectedIds.has(r.id)
        ? { ...r, _driverId: clusterMap[r.id] || null }
        : r
      ));
      setIsDirty(true);
      setTimeout(() => {
        const balanceMsg = diagnostics?.load?.maxAbsDiffPct !== undefined
          ? `최대 편차 ${diagnostics.load.maxAbsDiffPct}%`
          : '분석 완료';
        const qScore = diagnostics?.qualityScore !== undefined ? ` · 품질 ${diagnostics.qualityScore}점` : '';
        const stratLabel = { hilbert: '힐베르트 곡선', seedVoronoi: '핀 전체 기준', dongGroup: '자동 경계' }[diagnostics?.strategy || 'dongGroup'] || '자동 경계';
        showToast('success', `자동 배정 완료 [${stratLabel}] — ${balanceMsg}${qScore}. 분석 안내를 확인하세요.`, 5000);
      }, 500);
      setIsSplitting(false);
    };
    worker._pendingAutoSplit = onMessage;
    worker.addEventListener('message', onMessage);

    worker.postMessage({
      type: 'autoSplit',
      target,
      noCoordRecs,
      allRecords: filteredRecords,
      activeDrivers,
      driverPins,
      strategy: effectiveStrategy,
    });
  }, [filteredRecords, drivers, driverCount, driverPins, showToast, isAssignmentLocked, autoSplitStrategy, hasDongSetupMapping, resolveDongMappedIds, activeDong]);

  // ── 다중기사 동: 진입 시 1회 자동 지리분할 (그 동 매핑 기사로만 — Part C) ──────────
  // 셋업의 동↔기사 매핑을 지도에 반영. 단일기사 동은 위 effect가, 2명 이상 동은 진입 시 여기서 분할.
  // 동별 1회만 시도(재진입·records 변동 중복 방지). 좌표 없으면 채워질 때까지 보류.
  const autoSplitAppliedRef = useRef(new Set());
  useEffect(() => {
    if (!dongQueue.length || isAssignmentLocked || !hasDongSetupMapping) return;
    const dong = dongQueue[activeDongIndex];
    if (!dong) return;
    const dongRecs = records.filter(r => getRouteDong(r) === dong);
    const mapped = resolveDongMappedIds(dong, dongRecs).filter(id => drivers.some(d => d.id === id));
    if (mapped.length < 2) return; // 1명 동은 단일배정 effect가 처리
    const assignable = dongRecs.filter(r => r._lat && r._lng && isCoordAssignable(r));
    if (!assignable.length) return; // 좌표 채워질 때까지 보류
    const mappedSet = new Set(mapped);
    const assignedMappedIds = new Set(assignable.map(r => r._driverId).filter(id => mappedSet.has(id)));
    if (
      assignable.every(r => r._driverId && mappedSet.has(r._driverId)) &&
      assignedMappedIds.size >= Math.min(mapped.length, assignable.length)
    ) {
      autoSplitAppliedRef.current.add(dong);
      return;
    } // 다기사 동이 실제 여러 기사로 나뉘어 있을 때만 이미 분할됨으로 인정
    if (autoSplitAppliedRef.current.has(dong)) return; // 이 동은 이미 1회 안내함
    autoSplitAppliedRef.current.add(dong);
    // ★자동으로 나누지 않는다 — 담당자가 브러쉬로 칠하거나, 원하면 자동 N등분을 직접 누른다.
    setBrushPrompt({ dong, driverIds: mapped });
  }, [activeDongIndex, dongQueue, records, drivers, hasDongSetupMapping, resolveDongMappedIds, isAssignmentLocked, handleAutoSplit]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 핀 DOM 색상 직접 업데이트 (React re-render 없이 즉시 시각 반영)
  const updatePinColorDOM = useCallback((recordId, color) => {
    const el = document.querySelector(`[data-record-id="${recordId}"]`);
    if (!el) return;
    const kids = el.children;
    if (kids[0]) {
      kids[0].style.background = color;
      kids[0].style.boxShadow = `0 0 0 2px ${color}55,0 3px 10px rgba(0,0,0,0.7)`;
    }
    if (kids[1]) kids[1].style.borderTopColor = color;
    if (kids[2]) kids[2].style.borderColor = color + '45';
  }, []);

  // ── 페인트 브러시: 드래그 중 DOM 조작만 (setRecords 없음 → 지도 줌 고정)
  // mouseup 시 commitPaint()가 pendingPaintRef를 한 번에 React state에 반영
  const applyPaint = useCallback((clientX, clientY) => {
    if (!kakaoMapRef.current || !paintDriverId || !mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const curX = clientX - rect.left;
    const curY = clientY - rect.top;
    const bounds = kakaoMapRef.current.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const cLat = ne.getLat() + (curY / rect.height) * (sw.getLat() - ne.getLat());
    const cLng = sw.getLng() + (curX / rect.width) * (ne.getLng() - sw.getLng());
    const latSpanM = haversine(sw.getLat(), sw.getLng(), ne.getLat(), sw.getLng());
    const radiusM = paintRadiusPx * (latSpanM / rect.height);
    const driver = drivers.find(d => d.id === paintDriverId);
    const color = driver?.color || '#3b82f6';
    recordsRef.current.forEach(r => {
      if (!r._lat || !r._lng || r._driverId === paintDriverId) return;
      if (haversine(cLat, cLng, r._lat, r._lng) > radiusM) return;
      if (!pendingPaintRef.current.has(r.id)) {
        pendingPaintRef.current.set(r.id, paintDriverId);
        updatePinColorDOM(r.id, color);
      }
    });
  }, [paintDriverId, paintRadiusPx, drivers, updatePinColorDOM]);

  // ── 드래그 종료 시 누적된 변경을 React state에 한 번만 반영
  const commitPaint = useCallback(() => {
    isPaintingRef.current = false;
    const pending = pendingPaintRef.current;
    if (pending.size === 0) return;
    // snapshot을 먼저 복사 후 clear — React updater는 비동기 실행되므로
    // pending(원본 Map)을 clear하기 전에 복사하지 않으면 updater 실행 시 빈 Map을 봄
    const snapshot = new Map(pending);
    pending.clear();
    setRecords(prev => prev.map(r => snapshot.has(r.id) ? { ...r, _driverId: snapshot.get(r.id) } : r));
  }, []);

  // ── 명단 ↔ 지도 양방향 선택 ───────────────────────────────────────────
  // 핀/행 선택 → 지도 panTo + 선택 핀 DOM 하이라이트 + 목록 스크롤
  const handleSelectRecord = useCallback((r) => {
    setSelectedRecordId(r.id);
    setSelectionPulseId(r.id);
    if (selectionPulseTimerRef.current) clearTimeout(selectionPulseTimerRef.current);
    selectionPulseTimerRef.current = setTimeout(() => setSelectionPulseId(null), 1800);
    // 지도 이동
    if (r._lat && r._lng && kakaoMapRef.current) {
      const pos = new window.kakao.maps.LatLng(r._lat, r._lng);
      kakaoMapRef.current.panTo(pos);
      if (kakaoMapRef.current.getLevel() > 4) kakaoMapRef.current.setLevel(3);
    }
    // split 이상 레이아웃 보장 (지도가 보여야 panTo 효과가 있음)
    setLayoutMode(prev => (prev === 'list') ? 'split' : prev);
    // 목록 스크롤 (지도 측 클릭 시)
    setTimeout(() => {
      document.getElementById(`rec-${r.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }, []);

  const focusAnalysisRecords = useCallback((recordIds, label = '분석 후보') => {
    const ids = new Set(recordIds || []);
    const first = records.find(r => ids.has(r.id));
    if (!first) {
      showToast('info', `${label} 항목이 없습니다.`);
      return;
    }
    setSelectedDriverFilter('all');
    setLayoutMode(prev => (prev === 'map' || prev === 'mapfull') ? 'split' : prev);
    handleSelectRecord(first);
    showToast('info', `${label} ${ids.size.toLocaleString()}건을 목록과 지도에서 확인하세요.`);
  }, [records, handleSelectRecord, showToast]);

  const handleRunSequenceAnalysis = useCallback(() => {
    const analysis = analyzeSequenceQuality(records, drivers);
    setSequenceAnalysis(analysis);
    setShowSequenceAnalysis(true);
    showToast(
      analysis.issueCount > 0 ? 'info' : 'success',
      analysis.hasSequence
        ? `순번 분석 완료 — 예상 정확도 ${analysis.avgAccuracy || 0}% · 확인 ${analysis.issueCount.toLocaleString()}건`
        : '배송순번이 없습니다. 먼저 [순번]을 실행하세요.',
      5000
    );
  }, [records, drivers, showToast]);

  const handleRunMapAnalysis = useCallback(() => {
    setShowMapAnalysis(true);
    const issueCount = mapInsights.mixedCount
      + mapInsights.mixedRoads.length
      + mapInsights.isolatedUnits.length
      + mapInsights.coordIssues.noCoord      // 미보유를 안 세면 "큰 신호 없음"으로 뜬다(F4)
      + mapInsights.coordIssues.outCity
      + mapInsights.coordIssues.outDong;
    showToast(issueCount > 0 ? 'info' : 'success', issueCount > 0
      ? `지도 분석 완료 — 확인 후보 ${issueCount.toLocaleString()}개가 있습니다.`
      : '지도 분석 완료 — 큰 혼재 신호는 없습니다.');
  }, [mapInsights, showToast]);

  // 선택된 핀 DOM 하이라이트 (scale + glow ring)
  useEffect(() => {
    document.querySelectorAll('[data-record-id]').forEach(el => {
      el.style.transform = '';
      el.style.transition = '';
      el.style.zIndex = '';
    });
    if (!selectedRecordId) return;
    const el = document.querySelector(`[data-record-id="${selectedRecordId}"]`);
    if (!el) return;
    el.style.transition = 'transform 0.15s ease';
    el.style.transform = 'scale(1.45)';
    el.style.zIndex = '999';
    const circle = el.children[0];
    if (circle) {
      circle.style.boxShadow = (circle.style.boxShadow || '') + ',0 0 0 4px rgba(255,255,255,0.9),0 0 0 6px rgba(59,130,246,0.7)';
    }
  }, [selectedRecordId]);

  // ── 전체 배정 초기화 ─────────────────────────────────────────────────
  const handleResetAssignments = useCallback(async () => {
    if (isAssignmentLocked) { showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.'); return; }
    if (!window.confirm('⚠️ 기사 배치와 배송순번을 전부 초기화합니다.\n\n클라우드 저장본의 기사/순번도 같이 비웁니다.\n정말 계속하시겠습니까?')) return;

    const resetRecords = records.map(r => ({ ...r, _driverId: null, 배송순번: '' }));
    setRecords(resetRecords);
    setRouteAnalysis(null);
    setShowMapAnalysis(false);
    setSequenceAnalysis(null);
    setShowSequenceAnalysis(false);
    setOverlapCount(0);

    if (isCloudMode && cloudCity && cloudMonthId) {
      try {
        const CHUNK = 499;
        for (let i = 0; i < resetRecords.length; i += CHUNK) {
          const batch = writeBatch(db);
          let hasOps = false;
          resetRecords.slice(i, i + CHUNK).forEach(r => {
            if (!r._cloudDocId) return;
            batch.set(
              doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId),
              { 기사: '', 배송순번: '' },
              { merge: true }
            );
            hasOps = true;
          });
          if (hasOps) await batch.commit();
        }
        await setDoc(
          doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId),
          {
            city: cloudCity,
            monthId: cloudMonthId,
            savedAt: serverTimestamp(),
            savedBy: auth.currentUser?.email || '',
            drivers: drivers.map(d => ({ id: d.id, name: d.name, color: d.color, capacity: d.capacity || 100, deliveryDate: d.deliveryDate || '' })),   // DS-9-5
            status: 'draft',
            totalRecords: resetRecords.length,
            assignedCount: 0,
            selectedDongs: selectedDongsProp ? [...selectedDongsProp] : (orgDongs ? [...orgDongs] : null),
          },
          { merge: true }
        );
        setSessionStatus('draft');
        setLastAutoSave(new Date());
        setHasUnsaved(false);
        showToast('success', '배정/순번 초기화 완료 — 클라우드 저장본까지 비웠습니다.');
      } catch (error) {
        showToast('error', `초기화 저장 실패: ${error.message}`);
      }
      return;
    }

    showToast('success', '배정/순번 초기화 완료');
  }, [records, drivers, isCloudMode, cloudCity, cloudMonthId, selectedDongsProp, orgDongs, showToast, isAssignmentLocked]);

  const openDriverSwapModal = useCallback(() => {
    if (isAssignmentLocked) {
      showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.');
      return;
    }
    const defaultScope = selectedDong === '전체' ? 'all' : 'dong';
    const scopeRecords = defaultScope === 'dong'
      ? records.filter(r => getRouteDong(r) === selectedDong)
      : records;
    const assignedDrivers = drivers.filter(d => scopeRecords.some(r => r._driverId === d.id));
    if (assignedDrivers.length < 2) {
      showToast('error', '맞교환하려면 배정된 기사가 2명 이상 필요합니다.');
      return;
    }
    const first = selectedDriverFilter !== 'all' && selectedDriverFilter !== 'none'
      && assignedDrivers.some(d => d.id === selectedDriverFilter)
      ? selectedDriverFilter
      : assignedDrivers[0].id;
    const second = assignedDrivers.find(d => d.id !== first)?.id || assignedDrivers[1]?.id || '';
    setSwapScope(defaultScope);
    setSwapFromDriverId(first);
    setSwapToDriverId(second);
    setShowDriverSwapModal(true);
  }, [drivers, records, selectedDong, selectedDriverFilter, showToast, isAssignmentLocked]);

  const handleSwapDriverAssignments = useCallback(() => {
    if (isAssignmentLocked) {
      showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.');
      return;
    }
    if (!swapFromDriverId || !swapToDriverId || swapFromDriverId === swapToDriverId) {
      showToast('error', '서로 다른 기사 2명을 선택하세요.');
      return;
    }
    const fromDriver = drivers.find(d => d.id === swapFromDriverId);
    const toDriver = drivers.find(d => d.id === swapToDriverId);
    if (!fromDriver || !toDriver) {
      showToast('error', '선택한 기사 정보를 찾을 수 없습니다.');
      return;
    }
    const useDongScope = swapScope === 'dong' && selectedDong !== '전체';
    const isInScope = (record) => !useDongScope || getRouteDong(record) === selectedDong;
    const scopedRecords = records.filter(isInScope);
    const fromCount = scopedRecords.filter(r => r._driverId === swapFromDriverId).length;
    const toCount = scopedRecords.filter(r => r._driverId === swapToDriverId).length;
    if (fromCount + toCount === 0) {
      showToast('error', '선택 범위에 교체할 배정 내역이 없습니다.');
      return;
    }

    const pendingPaint = new Map(pendingPaintRef.current);
    pendingPaintRef.current.clear();
    setRecords(prev => prev.map(record => {
      const paintedDriverId = pendingPaint.has(record.id) ? pendingPaint.get(record.id) : record._driverId;
      const baseRecord = paintedDriverId !== record._driverId ? { ...record, _driverId: paintedDriverId } : record;
      if (!isInScope(baseRecord)) return baseRecord;
      if (baseRecord._driverId === swapFromDriverId) return { ...baseRecord, _driverId: swapToDriverId };
      if (baseRecord._driverId === swapToDriverId) return { ...baseRecord, _driverId: swapFromDriverId };
      return baseRecord;
    }));
    setShowDriverSwapModal(false);
    setSelectedDriverFilter('all');
    const scopeLabel = useDongScope ? selectedDong : '전체';
    showToast('success', `${scopeLabel} 배정 교체 완료 — ${fromDriver.name} ${fromCount}건 ↔ ${toDriver.name} ${toCount}건`);
  }, [drivers, records, selectedDong, swapFromDriverId, swapToDriverId, swapScope, showToast, isAssignmentLocked]);


  // ── 기사 출발지 주소 지오코딩 ────────────────────────────────────────
  const handleGeocodeStartAddr = useCallback(async (driverId, addr) => {
    if (!addr?.trim()) return;
    try {
      const hit = await kakaoCoordOf(addr.trim());
      if (hit) {
        setDrivers(prev => prev.map(dr =>
          dr.id === driverId ? { ...dr, startLat: hit.lat, startLng: hit.lng } : dr
        ));
      }
    } catch { /* ignore */ }
  }, []);

  // 마운트 시 startAddr 있으면 자동 지오코딩
  useEffect(() => {
    drivers.forEach(d => {
      if (d.startAddr && !d.startLat) handleGeocodeStartAddr(d.id, d.startAddr);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 배송순번 자동 정렬 (도로명 기반 — 도로 그룹 → 건물번호 → 뱀 패턴) ───
  // ── 드래그 순번 재배정 ────────────────────────────────────────────────
  const handleSeqDrop = useCallback((dstId) => {
    const srcId = dragSrcIdRef.current;
    dragSrcIdRef.current = null;
    setDragOverId(null);
    if (!srcId || srcId === dstId) return;
    const srcRec = records.find(r => r.id === srcId);
    const dstRec = records.find(r => r.id === dstId);
    if (!srcRec || !dstRec || srcRec._driverId !== dstRec._driverId) return;
    // 해당 기사의 레코드를 순번순으로 정렬 후 재배치
    const driverRecs = records
      .filter(r => r._driverId === srcRec._driverId)
      .sort((a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999));
    const reordered = driverRecs.filter(r => r.id !== srcId);
    const insertAt = reordered.findIndex(r => r.id === dstId);
    reordered.splice(insertAt, 0, srcRec);
    const newSeqMap = {};
    reordered.forEach((r, i) => { newSeqMap[r.id] = String(i + 1); });
    setRecords(prev => prev.map(r => newSeqMap[r.id] !== undefined ? { ...r, 배송순번: newSeqMap[r.id] } : r));
  }, [records]);

  // ── 일자 분할 (형 지시 2026-07-23) — 수량 많으면 지역(동)별로 묶어 여러 날로 ──
  //   같은 동은 안 쪼개고, 가까운 동끼리 같은 날. 각 날 안의 순번은 [순번] 버튼이 담당.
  const handleDaySplit = useCallback(() => {
    const v = parseInt(daySplitVal, 10);
    if (!v || v <= 0) { showToast('error', '올바른 값을 입력하세요.'); return; }
    let split, msg;
    if (daySplitMode === 'seq') {
      // 배송순번 구간 분할 — 담당자가 정한 하루 가구수만큼 순번 순서대로 끊음(동 경계 무시, 순번이 곧 동선)
      split = splitBySequence(records, { maxPerDay: v });
      msg = `하루 최대 ${v}가구 · 배송순번 구간`;
    } else {
      const depot = drivers.find(d => d.startLat && d.startLng);
      const dp = depot ? { lat: depot.startLat, lng: depot.startLng } : null;
      const opts = daySplitMode === 'days'
        ? { numDays: v, getLoad: getEffectiveLoad, depot: dp }
        : { maxLoadPerDay: v, getLoad: getEffectiveLoad, depot: dp };
      split = splitByDay(records, opts);
      msg = `${daySplitMode === 'days' ? `${v}일 균등` : `하루 최대 ${v}포`} · 동 경계 보존`;
    }
    const byId = new Map(split.map(r => [r.id, r.배송일차]));
    setRecords(prev => prev.map(r => ({ ...r, 배송일차: byId.get(r.id) || 1 })));
    const summary = summarizeDaySplit(split);
    setDaySplitSummary(summary);
    showToast('success', `${summary.length}일로 분할 — ${msg}`);
  }, [records, drivers, daySplitMode, daySplitVal, showToast]);

  const handleAutoSequence = useCallback(() => {
    // pendingPaintRef 잔류분을 먼저 반영 (브러시 보정 직후 클릭 시 배치 유실 방지)
    const snapshot = new Map(pendingPaintRef.current);
    pendingPaintRef.current.clear();

    // ① 순수 계산 — updater 밖에서 records 직접 읽어 처리
    const current = snapshot.size > 0
      ? records.map(r => snapshot.has(r.id) ? { ...r, _driverId: snapshot.get(r.id) } : r)
      : records;

    const updated = [...current];
    const strategyUsed = { road: 0, coord: 0 };

    drivers.forEach(driver => {
      const driverRecs = updated.filter(r => r._driverId === driver.id);
      if (!driverRecs.length) return;
      const hasAnyAddr = driverRecs.some(r => parseRoadInfo(getSequenceAddress(r)).road || isApartmentLike(r));
      if (hasAnyAddr) strategyUsed.road++;
      else strategyUsed.coord++;
      const startPoint = (driver.startLat && driver.startLng)
        ? { lat: driver.startLat, lng: driver.startLng }
        : null;
      // nearestNeighborTSP에 전체 레코드를 넘겨야 noCoordUnits 스마트 삽입이 작동한다
      const ordered = hasAnyAddr ? roadAwareTSP(driverRecs, startPoint) : nearestNeighborTSP(driverRecs, startPoint);
      ordered.forEach((r, i) => {
        const idx = updated.findIndex(u => u.id === r.id);
        if (idx !== -1) updated[idx] = { ...updated[idx], 배송순번: String(i + 1) };
      });
    });

    const analysis = analyzeSequenceQuality(updated, drivers);
    analysis.strategyUsed = strategyUsed;

    // ② state 반영 — 모든 side effect를 updater 밖에서 한 번씩만 실행
    setRecords(updated);
    setSequenceAnalysis(analysis);
    setShowSequenceAnalysis(true);
    const stratMsg = strategyUsed.road > 0 && strategyUsed.coord > 0
      ? `도로망 ${strategyUsed.road}명 · 좌표 ${strategyUsed.coord}명`
      : strategyUsed.coord > 0 ? '좌표 fallback' : '도로망 TSP';
    showToast(
      analysis.issueCount > 0 ? 'info' : 'success',
      `순번 완료 [${stratMsg}] — 정확도 ${analysis.avgAccuracy || 0}% · 확인 ${analysis.issueCount.toLocaleString()}건`,
      5000
    );
  }, [records, drivers, showToast]);


  // ── 지난달 배정 불러오기 ─────────────────────────────────────────────
  const handleLoadLastMonth = useCallback(() => {
    if (isAssignmentLocked) { showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.'); return; }
    let loaded = 0;
    setRecords(prev => prev.map(r => {
      if (!r._origDriver) return r;
      const driver = drivers.find(d => d.name === r._origDriver);
      if (!driver) return r;
      loaded++;
      return { ...r, _driverId: driver.id, 배송순번: r._origSeqNo || r.배송순번 };
    }));
    if (loaded === 0) {
      showToast('error', '기사명이 일치하는 지난달 배정이 없습니다. 기사 이름을 확인하세요.');
    } else {
      showToast('success', `지난달 배정 ${loaded}건 적용 완료`);
    }
  }, [drivers, showToast, isAssignmentLocked]);

  // ── 1단계: 세션 수동 저장 (draft / final) ───────────────────────────
  // 이슈④: 저장 직전, _cloudDocId가 없는 '배정된' 레코드를 cloud_lists 기존문서에 강키(이름+휴대폰끝8·양측유일)로
  //   매칭해 문서ID를 복원한다. 매칭 실패분은 신규 문서를 만들지 않고(명단 오염 방지) 경고만 반환한다.
  //   → 로컬 gridData 유입 등으로 _cloudDocId가 빠진 배정이 저장에서 통째로 스킵되던 '유령저장'을 차단.
  const resolveMissingCloudDocIds = useCallback(async (recs) => {
    const missing = recs.filter(r => !r._cloudDocId && r._driverId);
    if (!missing.length) return { recs, matched: 0, unmatched: 0 };
    if (!cloudCity || !cloudMonthId) return { recs, matched: 0, unmatched: missing.length };
    let byStrong;
    try {
      const snap = await getDocs(collection(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records'));
      byStrong = new Map();
      const dupKeys = new Set();
      snap.forEach(d => {
        const k = strongMatchKey(d.data());
        if (!k) return;
        if (dupKeys.has(k)) return;
        if (byStrong.has(k)) { byStrong.delete(k); dupKeys.add(k); return; } // 양측유일: 충돌키(동명이인+동일전화 등)는 제외
        byStrong.set(k, d.id);
      });
    } catch (e) {
      console.error('안전매칭 인덱스 로드 실패:', e);
      return { recs, matched: 0, unmatched: missing.length };
    }
    let matched = 0, unmatched = 0;
    const out = recs.map(r => {
      if (r._cloudDocId || !r._driverId) return r;
      const k = strongMatchKey(r);
      const id = k ? byStrong.get(k) : null;
      if (id) { matched++; return { ...r, _cloudDocId: id }; }
      unmatched++;
      return r;
    });
    return { recs: out, matched, unmatched };
  }, [cloudCity, cloudMonthId]);

  const handleSaveSession = useCallback(async (isFinal = false) => {
    if (!isCloudMode || !cloudCity || !cloudMonthId) {
      if (isFinal) alert('클라우드 명단 로드 후 저장 가능합니다.');
      return;
    }
    // 동별 확정 — 미배정 검사는 현재 작업 동(filteredRecords) 기준 (좌측 카운트와 통일).
    const unassignedCount = filteredRecords.filter(r => !r._driverId).length;
    if (isFinal && unassignedCount > 0) {
      const scopeLabel = activeDong ? `${activeDong} ` : '';
      showToast('error', `${scopeLabel}미배정 ${unassignedCount}건이 남아 확정할 수 없습니다.`);
      return;
    }
    // R-0(완화): 혼재가 있어도 담당자 확인 후 최종 저장 허용 — 저장은 항상 가능해야 함.
    //   혼재 = 같은 아파트/동일주소 묶음이 여러 기사에 갈라졌거나, 한 기사 핀이 다른 기사 권역 안에 고립된 "섬".
    if (isFinal && overlapCount > 0) {
      const ok = window.confirm(`기사 구역 혼재 ${overlapCount}건이 있습니다.\n(같은 아파트·주소 묶음이 여러 기사에 갈라졌거나, 한 기사 핀이 다른 기사 권역 안에 고립된 상태)\n\n그래도 최종 저장할까요?`);
      if (!ok) return;
    }
    setIsSavingSession(true);
    try {
      // 이슈④ 유령저장 방지: _cloudDocId 없는 배정을 강키로 명단문서에 매칭해 문서ID 복원(실패분은 경고, 신규생성 없음)
      const { recs: saveRecs, matched: _mMatched, unmatched: _mUnmatched } = await resolveMissingCloudDocIds(records);
      if (_mMatched) setRecords(saveRecs);
      if (_mUnmatched) showToast('warning', `⚠️ 배정 ${_mUnmatched}건이 클라우드 명단과 매칭되지 않아 저장에서 제외됐습니다 — 클라우드 명단을 불러온 뒤 작업하세요(신규 문서는 만들지 않음)`);
      // route_sessions에 기사구성·배정 저장
      await setDoc(
        doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId),
        {
          city: cloudCity, monthId: cloudMonthId,
          orgId: orgIdProp || 'all',
          savedAt: serverTimestamp(),
          savedBy: auth.currentUser?.email || '',
          drivers: drivers.map(d => ({ id: d.id, name: d.name, color: d.color, capacity: d.capacity || 100, deliveryDate: d.deliveryDate || '' })),
          status: isFinal ? 'final' : 'draft',
          totalRecords: saveRecs.length,
          assignedCount: saveRecs.filter(r => r._driverId).length,
          selectedDongs: selectedDongsProp ? [...selectedDongsProp] : (orgDongs ? [...orgDongs] : null),
          activeDong: activeDong || null,
          completedDongs: [...completedDongs, ...(activeDong ? [activeDong] : [])],
        },
        { merge: true }
      );
      // cloud_lists 레코드에 기사/순번/좌표 동기화 — 499 청크 유지, commit만 병렬
      const CHUNK = 499;
      const driverNameById = new Map(drivers.map(d => [d.id, d.name || '']));
      const syncBatches = [];
      for (let i = 0; i < saveRecs.length; i += CHUNK) {
        const batch = writeBatch(db);
        let hasOps = false;
        saveRecs.slice(i, i + CHUNK).forEach(r => {
          if (!r._cloudDocId) return;
          const driverName = driverNameById.get(r._driverId) || '';
          const ref = doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId);
          const patch = { 기사: driverName, 배송순번: r.배송순번 ? String(r.배송순번) : '' };
          if (r._lat !== undefined && r._lat !== null) { patch.lat = r._lat; patch.lng = r._lng; }
          if (r._isApt !== undefined) patch.isApt = r._isApt;
          batch.set(ref, patch, { merge: true });
          hasOps = true;
        });
        if (hasOps) syncBatches.push(batch.commit());
      }
      await Promise.all(syncBatches);
      // 이번달 명단 화면이 방금 저장한 기사배정을 즉시 보도록 월 메타 rev +1 (캐시 stale 방지)
      await setDoc(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId), { rev: increment(1) }, { merge: true });
      // driver_assignments 동기화 — RouteSetupModal에서 다음번 기사구성 자동 로드용
      // ★ 근본 수정: 기존 저장본(전체 매핑·전체 기사)을 읽어 베이스로 삼고, 이번 세션에서 '작업한 동'만 갱신.
      //   "행정동별 작업"으로 일부 동만 작업·저장해도 전체 매핑이 부분집합으로 덮어써지지 않게 함(나머지 동·기사 전부 보존).
      try {
        const assignRef = doc(db, 'driver_assignments', cloudCity, 'orgs', orgIdProp || 'all');
        let baseMap = {};
        let baseDrivers = [];
        try {
          const existing = await getDoc(assignRef);
          if (existing.exists()) {
            baseMap = existing.data().dongDriverMap || {};
            baseDrivers = Array.isArray(existing.data().drivers) ? existing.data().drivers : [];
          }
        } catch { /* 없으면 빈 베이스 */ }
        // 베이스 = 기존 전체 저장본 + 이번 세션 셋업 매핑(작업 대상 동)
        const dongDriverMap = { ...baseMap, ...(setupDongDriverMapProp || {}) };
        const workedDongs = new Set();
        saveRecs.forEach(r => { if (r._driverId) { const rd = getRouteDong(r); if (rd) workedDongs.add(rd); } });
        workedDongs.forEach(d => { dongDriverMap[d] = []; }); // 작업한 동만 비우고 records로 재구성
        saveRecs.forEach(r => {
          const routeDong = getRouteDong(r);
          if (!r._driverId || !routeDong) return;
          if (!dongDriverMap[routeDong]) dongDriverMap[routeDong] = [];
          if (!dongDriverMap[routeDong].includes(r._driverId)) dongDriverMap[routeDong].push(r._driverId);
        });
        // 기사 명단 병합: 기존 + 이번 세션(id/name 갱신, 없으면 추가) → 부분 세션이 전체 기사를 날리지 않게
        const sessionDrivers = drivers.map(d => ({ id: d.id, name: d.name, color: d.color, capacity: d.capacity || 100 }));   // DS-9-5: 출발지 제외
        const mergedDrivers = [...baseDrivers];
        sessionDrivers.forEach(sd => {
          const i = mergedDrivers.findIndex(d => d.id === sd.id || (d.name && d.name === sd.name));
          if (i >= 0) mergedDrivers[i] = { ...mergedDrivers[i], ...sd };
          else mergedDrivers.push(sd);
        });
        await setDoc(assignRef, { drivers: mergedDrivers, dongDriverMap, updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email || '' }, { merge: true });
      } catch (syncErr) {
        console.error('driver_assignments 동기화 실패:', syncErr);
      }
      setSessionStatus(isFinal ? 'final' : 'draft');
      setLastAutoSave(new Date());
      setHasUnsaved(false);
      // 동 작업 완료 처리
      if (activeDong) setCompletedDongs(prev => new Set([...prev, activeDong]));
      setIsDirty(false);
      if (isFinal) {
        await syncToBaseList();
        // delivery_history 자동 적재 (기사별 실적 집계)
        try {
          const histBatch = writeBatch(db);
          drivers.forEach(driver => {
            const driverRecs = saveRecs.filter(r => r._driverId === driver.id);
            if (!driverRecs.length) return;
            const totalQty = driverRecs.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
            const effectiveLoad = driverRecs.reduce((s, r) => s + getEffectiveLoad(r), 0);
            const dongs = [...new Set(driverRecs.map(r => getRouteDong(r)).filter(Boolean))];
            const ref = doc(db, 'delivery_history', cloudCity, 'months', cloudMonthId, 'drivers', driver.id);
            histBatch.set(ref, {
              driverName: driver.name,
              driverId: driver.id,
              totalQty,
              totalCount: driverRecs.length,
              effectiveLoad: Math.round(effectiveLoad * 10) / 10,
              dongs,
              uploadedAt: serverTimestamp(),
              uploadedBy: auth.currentUser?.email || '',
            });
          });
          await histBatch.commit();
        } catch (e) {
          console.error('delivery_history 적재 실패:', e);
        }
        showToast('success', `${activeDong ? activeDong + ' ' : ''}저장·확정 완료 — 명단·기본명단 반영 ${filteredRecords.filter(r => r._driverId).length}건 (전체 확정 ${saveRecs.filter(r => r._driverId).length}건)`, 5000);
      } else {
        showToast('success', `임시저장 완료 — 배정현황이 저장되었습니다 (기본명단 미반영)`);
      }
    } catch (e) {
      showToast('error', `저장 실패: ${e.message}`);
    } finally {
      setIsSavingSession(false);
    }
  }, [isCloudMode, cloudCity, cloudMonthId, drivers, records, filteredRecords, showToast, overlapCount, activeDong, completedDongs, resolveMissingCloudDocIds]);   // eslint-disable-line react-hooks/exhaustive-deps -- 열릴 때 설정값으로 한 번만 잡는다

  // ── 1단계: 세션 불러오기 (이어서 작업) ──────────────────────────────
  const handleLoadSession = useCallback(async () => {
    if (!cloudCity || !cloudMonthId) { showToast('error', '먼저 클라우드 명단을 불러오세요.'); return; }
    setIsLoadingSession(true);
    try {
      const snap = await getDoc(doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId));
      if (!snap.exists()) { showToast('info', '저장된 세션이 없습니다. 새 작업을 시작하세요.'); return; }
      const data = snap.data();
      if (data.drivers?.length) {
        setDrivers(data.drivers);
        setDriverCount(data.drivers.length);
      }
      // cloud_lists에서 기사/순번/좌표 재로드
      const recSnap = await getDocs(collection(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records'));
      shouldFitBoundsRef.current = true; // 세션 로드 시 전체 범위로 줌 맞춤
      setRecords(prev => prev.map(r => {
        const found = recSnap.docs.find(d => d.id === r._cloudDocId);
        if (!found) return r;
        const fd = found.data();
        const driver = data.drivers?.find(d => d.name === fd.기사);
        return {
          ...r,
          _driverId: fd.기사 ? (driver?.id || null) : null,
          배송순번: fd.배송순번 || '',
          _lat: fd.lat || r._lat,
          _lng: fd.lng || r._lng,
          _isApt: fd.isApt ?? r._isApt,
        };
      }));
      setSessionStatus(data.status || 'draft');
      setHasUnsaved(false);
      const savedAt = data.savedAt?.toDate?.()?.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) || '';
      showToast('success', `이어서 작업 로드 완료 — 기사 ${data.drivers?.length || 0}명 · 배정 ${data.assignedCount || 0}건${savedAt ? ` (${savedAt} 저장본)` : ''}`);
    } catch (e) {
      showToast('error', `세션 로드 실패: ${e.message}`);
    } finally {
      setIsLoadingSession(false);
    }
  }, [cloudCity, cloudMonthId, showToast]);

  // ── 저장본 보기: 현재 지자체·월의 DB 저장본(기사·배송순번·좌표)을 그대로 조회해 표로 보여줌 ──
  const handleOpenSavedView = useCallback(async () => {
    if (!cloudCity || !cloudMonthId) { showToast('error', '클라우드 명단이 아닙니다.'); return; }
    setSavedView({ loading: true, rows: [], summary: { total: 0, assigned: 0, noCoord: 0, byDriver: {} } });
    try {
      const recSnap = await getDocs(collection(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records'));
      const rows = recSnap.docs.map(d => {
        const fd = d.data();
        return {
          id: d.id,
          name: fd.이름 || '',
          dong: fd.행정동 || '',
          addr: fd.주소 || '',
          driver: (fd.기사 || '').trim(),
          seq: fd.배송순번 || '',
          hasCoord: fd.lat != null && fd.lng != null,
        };
      });
      const byDriver = {};
      let assigned = 0, noCoord = 0;
      rows.forEach(r => {
        if (r.driver) { byDriver[r.driver] = (byDriver[r.driver] || 0) + 1; assigned++; }
        if (!r.hasCoord) noCoord++;
      });
      // 기사별 → 배송순번 순으로 정렬해 보기 편하게
      rows.sort((a, b) => (a.driver || 'ㅎ').localeCompare(b.driver || 'ㅎ', 'ko') || (parseInt(a.seq) || 9999) - (parseInt(b.seq) || 9999));
      setSavedView({ loading: false, rows, summary: { total: rows.length, assigned, noCoord, byDriver } });
    } catch (e) {
      showToast('error', `저장본 조회 실패: ${e.message}`);
      setSavedView(null);
    }
  }, [cloudCity, cloudMonthId, showToast]);

  // ── 2단계: 좌표 캐시 유틸 ────────────────────────────────────────────
  const addrToDocId = (addr) => (addr || '').replace(/[/]/g, '_').slice(0, 400);

  // ★좌표 캐시는 `src/utils/coordCache.js` SSOT 를 쓴다(2026-08-23 Phase 1) — 여기 사본이 있었다.
  //   시그니처가 달랐다: 유틸은 원주소를 받아 내부에서 도로명을 뽑고, 이 파일은 **이미 뽑힌 도로명**을 넘겼다.
  //   그래서 넘기기 전 도로명을 그대로 전달해도 같은 키가 나오도록 유틸 함수를 그대로 쓴다(키 회귀 `coord-cache.test.mjs`).
  const getCachedCoordLocal = (addr) => lookupCoordInCache(mapCoordCacheRef.current, addr);
  const saveCoordCacheLocal = async (city, addr, lat, lng) => { await saveCoordCacheLocal(db, city, addr, lat, lng); };

  // ── 3단계: 이전달 좌표+배정 승계 ────────────────────────────────────
  const handleLoadPrevMonth = useCallback(async () => {
    if (!cloudCity || !cloudMonthId) { showToast('error', '먼저 클라우드 명단을 불러오세요.'); return; }
    const [year, month] = cloudMonthId.split('-').map(Number);
    const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    setIsLoadingPrevMonth(true);
    try {
      // 이전달 세션 불러오기 (기사 구성)
      const prevSession = await getDoc(doc(db, 'route_sessions', cloudCity, 'months', prevMonth));
      // 이전달 레코드 불러오기 (좌표+배정)
      const prevRecSnap = await getDocs(collection(db, 'cloud_lists', cloudCity, 'months', prevMonth, 'records'));
      if (prevRecSnap.empty && !prevSession.exists()) {
        alert(`이전달(${prevMonth}) 데이터가 없습니다.`);
        return;
      }
      // 이름_생년월일 → {lat, lng, 기사, 배송순번}
      const prevMap = {};
      prevRecSnap.docs.forEach(d => {
        const fd = d.data();
        const birthKey = (fd.생년월일 || fd.birthKey || '').replace(/[^0-9]/g, '');
        const key = `${fd.이름 || fd.name || ''}_${birthKey}`;
        if (key !== '_') prevMap[key] = { lat: fd.lat, lng: fd.lng, driverName: fd.기사 || '', seqNo: fd.배송순번 || '' };
      });

      // 기사 구성 승계
      if (prevSession.exists() && prevSession.data().drivers?.length) {
        const prevDrivers = prevSession.data().drivers.map(d => ({ ...d, deliveryDate: '' }));
        setDrivers(prevDrivers);
        setDriverCount(prevDrivers.length);
      }

      let coordApplied = 0, driverApplied = 0;
      setRecords(prev => {
        const updated = [...prev];
        const currentDrivers = prevSession.exists() ? prevSession.data().drivers || [] : drivers;
        updated.forEach((r, i) => {
          const birthKey = (r.생년월일 || '').replace(/[^0-9]/g, '');
          const key = `${r.이름 || ''}_${birthKey}`;
          const prev = prevMap[key];
          if (!prev) return;
          const patch = {};
          if (!r._lat && prev.lat) { patch._lat = prev.lat; patch._lng = prev.lng; coordApplied++; }
          if (!r._driverId && prev.driverName) {
            const driver = currentDrivers.find(d => d.name === prev.driverName);
            if (driver) { patch._driverId = driver.id; patch.배송순번 = prev.seqNo; driverApplied++; }
          }
          if (Object.keys(patch).length) updated[i] = { ...r, ...patch };
        });
        return updated;
      });
      showToast('success', `이전달(${prevMonth}) 승계 완료 — 좌표 ${coordApplied}건 · 기사배정 ${driverApplied}건 적용`);
    } catch (e) {
      showToast('error', `이전달 불러오기 실패: ${e.message}`);
    } finally {
      setIsLoadingPrevMonth(false);
    }
  }, [cloudCity, cloudMonthId, drivers, showToast]);

  // ── 클라우드 명단 불러오기 ──────────────────────────────────────────
  const handleLoadFromCloud = async () => {
    if (!cloudPickerCity.trim() || !cloudPickerMonth.trim()) {
      alert('지자체명과 월(YYYY-MM)을 입력하세요.');
      return;
    }
    setIsLoadingCloud(true);
    try {
      const snap = await getDocs(
        collection(db, 'cloud_lists', cloudPickerCity.trim(), 'months', cloudPickerMonth.trim(), 'records')
      );
      if (snap.empty) {
        alert(`[${cloudPickerCity}] ${cloudPickerMonth} 저장된 데이터가 없습니다.\n먼저 해당 월 명단을 클라우드에 저장해 주세요.`);
        return;
      }
      const loaded = snap.docs.map(d => ({
        id: d.id,
        _cloudDocId: d.id,
        ...d.data(),
        _driverId: null,
        _lat: d.data().lat || null,
        _lng: d.data().lng || null,
        _isApt: d.data().isApt || false,
        _origDriver: d.data().기사 || '',
        _origSeqNo: d.data().배송순번 || '',
      }));
      shouldFitBoundsRef.current = true; // 새 명단 로드 시 전체 범위로 줌 맞춤
      setRecords(loaded);
      setIsCloudMode(true);
      setCloudCity(cloudPickerCity.trim());
      setCloudMonthId(cloudPickerMonth.trim());
      setShowCloudPicker(false);
      // dongQueue 초기화
      const pickerLoadedDongs = [...new Set(loaded.map(r => getRouteDong(r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
      setDongQueue(pickerLoadedDongs);
      setActiveDongIndex(0);
      setCompletedDongs(new Set());
      setIsDirty(false);
      setSelectedDriverFilter('all');
      overlaysRef.current.forEach(o => o.setMap(null));
      overlaysRef.current = [];
      polylinesRef.current.forEach(p => p.setMap(null));
      polylinesRef.current = [];
    } catch (e) {
      alert('불러오기 실패: ' + e.message);
    } finally {
      setIsLoadingCloud(false);
    }
  };

  // ── base_lists 드라이버 배정 sync-back ──────────────────────────────
  const syncToBaseList = async () => {
    const digitKey = v => String(v || '').replace(/[^\d]/g, '');
    try {
      const baseSnap = await getDocs(collection(db, 'base_lists', cloudCity, 'records'));
      if (baseSnap.empty) return; // base_lists 없으면 skip

      const byBirth = new Map(), byPhone = new Map(), byLandline = new Map();
      baseSnap.docs.forEach(d => {
        const b = d.data();
        const name = b.name || b.이름 || '';
        const bk = digitKey(b.birthKey || b.생년월일 || '');
        const ph = digitKey(b.mobile || b.휴대폰 || '');
        const ld = digitKey(b.landline || b.유선전화 || '');
        if (bk) byBirth.set(`${name}_${bk}`, d.ref);
        if (ph) byPhone.set(`${name}_${ph}`, d.ref);
        if (ld) byLandline.set(`${name}_${ld}`, d.ref);
      });

      const updates = [];
      records.forEach(r => {
        const driverName = drivers.find(d => d.id === r._driverId)?.name || '';
        const name = r.이름 || '';
        const bk = digitKey(r.생년월일 || '');
        const ph = digitKey(r.휴대폰 || '');
        const ld = digitKey(r.유선전화 || '');

        let ref = null;
        if (bk) ref = byBirth.get(`${name}_${bk}`);
        if (!ref && ph) ref = byPhone.get(`${name}_${ph}`);
        if (!ref && ld) ref = byLandline.get(`${name}_${ld}`);
        if (!ref) return;

        const patch = {};
        if (driverName) patch.driver = driverName;
        if (r.배송순번) patch.seqNo = String(r.배송순번);
        if (r._lat) patch.lat = r._lat;
        if (r._lng) patch.lng = r._lng;
        if (r._isApt !== undefined) patch.isApt = r._isApt;
        if (Object.keys(patch).length) updates.push({ ref, patch });
      });

      const CHUNK = 499;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const batch = writeBatch(db);
        updates.slice(i, i + CHUNK).forEach(u => batch.update(u.ref, u.patch));
        await batch.commit();
      }
      return updates.length;
    } catch (e) {
      console.error('base_lists sync 실패:', e);
      return 0;
    }
  };

  // ── cloud_lists records 일괄 패치 (공통 유틸) ──────────────────────────
  const patchCloudRecords = async (recs) => {
    const CHUNK = 499;
    let patchCount = 0;
    for (let i = 0; i < recs.length; i += CHUNK) {
      const batch = writeBatch(db);
      let hasOps = false;
      recs.slice(i, i + CHUNK).forEach(r => {
        if (!r._cloudDocId) return;
        const driverName = drivers.find(d => d.id === r._driverId)?.name || '';
        const ref = doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId);
        const patch = { 기사: driverName, 배송순번: r.배송순번 ? String(r.배송순번) : '' };
        if (r.배송일차 !== undefined) patch.배송일차 = r.배송일차 || ''; // 일자 분할 결과(형 지시 2026-07-23)
        if (r._lat !== undefined && r._lat !== null) { patch.lat = r._lat; patch.lng = r._lng; }
        if (r._isApt !== undefined) patch.isApt = r._isApt;
        batch.set(ref, patch, { merge: true });
        hasOps = true;
        patchCount++;
      });
      if (hasOps) await batch.commit();
    }
    return patchCount;
  };

  // ── 클라우드 명단에 기사 배정 저장 + base_lists sync + route_sessions 갱신 ─
  const handleSaveToCloud = async () => {
    if (!isCloudMode) return;
    if (!cloudCity || !cloudMonthId) {
      showToast('error', '클라우드 명단을 먼저 불러오세요.');
      return;
    }
    setIsSavingCloud(true);
    try {
      // 이슈④ 유령저장 방지: 강키 매칭으로 _cloudDocId 복원 후 저장(실패분은 경고, 신규생성 없음)
      const { recs: saveRecs, matched: _m2, unmatched: _u2 } = await resolveMissingCloudDocIds(records);
      if (_m2) setRecords(saveRecs);
      if (_u2) showToast('warning', `⚠️ 배정 ${_u2}건이 클라우드 명단과 매칭되지 않아 저장에서 제외됐습니다 — 클라우드 명단을 불러온 뒤 작업하세요(신규 문서는 만들지 않음)`);
      // 1단계: cloud_lists에 기사/배송순번/좌표 저장
      await patchCloudRecords(saveRecs);

      // 2단계: route_sessions도 갱신 — "이어서 작업" 복원이 DB 저장 이후 상태를 반영하도록
      await setDoc(
        doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId),
        {
          city: cloudCity, monthId: cloudMonthId,
          savedAt: serverTimestamp(),
          savedBy: auth.currentUser?.email || '',
          drivers: drivers.map(d => ({ id: d.id, name: d.name, color: d.color, capacity: d.capacity || 100, deliveryDate: d.deliveryDate || '' })),
          status: 'draft',
          totalRecords: saveRecs.length,
          assignedCount: saveRecs.filter(r => r._driverId).length,
          selectedDongs: selectedDongsProp ? [...selectedDongsProp] : (orgDongs ? [...orgDongs] : null),
        },
        { merge: true }
      );

      // 3단계: base_lists에 driver/seqNo/좌표 자동 반영
      const synced = await syncToBaseList();

      setLastAutoSave(new Date());
      setHasUnsaved(false);
      setSessionStatus('draft');
      showToast('success', `DB 저장 완료 — ${cloudCity} ${cloudMonthId} · 기본명단 반영: ${synced}건`);
    } catch (e) {
      showToast('error', 'DB 저장 실패: ' + e.message);
    } finally {
      setIsSavingCloud(false);
    }
  };

  // ── 기사 배송루트 공유 링크 생성 ─────────────────────────────────────
  //  ★[기사 공유 링크] → ①기사·마감일 검증 ②**암호창을 연다**(지도마다 받는다) ③받은 번호로 runCreateShare.
  //    검증을 암호보다 먼저 하는 이유: 번호까지 입력받고 나서 "기사가 없다"고 물리면 헛수고다.
  const handleCreateShareLink = useCallback(() => {
    const assignedDrivers = drivers.filter(d => records.some(r => r._driverId === d.id));
    if (!assignedDrivers.length) { showToast('error', '배정된 기사가 없습니다.'); return; }
    // ★사용일정 검증을 **만들기 전에** 한다 — 만든 뒤에 틀렸다고 하면 링크가 이미 나가 있다.
    const dl = normalizeDeadline(shareDeadline);
    if (!dl.ok) { showToast('error', `공유 마감일: ${dl.error}`); return; }
    setAskPasscode(true);
  }, [drivers, records, showToast, shareDeadline]);

  // 암호창에서 받은 번호로 실제 생성. 암호는 **인자로만** 들어온다 — 컴포넌트가 들고 있지 않으니 다음 지도로 샐 수 없다.
  const runCreateShare = useCallback(async (passcode) => {
    const assignedDrivers = drivers.filter(d => records.some(r => r._driverId === d.id));
    if (!assignedDrivers.length) { showToast('error', '배정된 기사가 없습니다.'); return; }
    const dl = normalizeDeadline(shareDeadline);
    if (!dl.ok) { showToast('error', `공유 마감일: ${dl.error}`); return; }
    // ★비밀번호도 만들기 전에 검증 — 없는 채로 나간 링크는 누구나 연다(창이 막지만 여기서도 막는다).
    if (!isValidPasscode(passcode)) { showToast('error', '기사 비밀번호: 숫자 6자리를 입력하세요'); return; }
    setIsCreatingShare(true);
    try {
      // ★소속사 명부(org_drivers)를 읽어 기사별 인증 번호를 붙인다(계획 Phase 1).
      //   명부를 못 읽어도 공유 생성 자체는 막지 않는다 — 대신 번호가 안 붙은 기사가
      //   `unassigned` 로 드러나 담당자가 그 자리에서 알게 된다.
      //   경로 해석은 `utils/company.js` 의 기존 규칙을 그대로 쓴다(소속사>기업>개인).
      let roster = [];
      try {
        const uid = auth.currentUser?.uid || '';
        const uSnap = uid ? await getDoc(doc(db, 'users', uid)) : null;
        const u = uSnap?.exists() ? uSnap.data() : {};
        const col = getDriversCollection({ orgId: u.orgId, companyCode: u.companyCode, uid });
        if (col) {
          const rosterSnap = await getDocs(col);
          roster = rosterSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
      } catch { /* 명부를 못 읽어도 계속한다 — 아래에서 미배정으로 드러난다 */ }

      const { docs: shareRecords, unassigned } = buildShareRecords(records, assignedDrivers, roster);
      if (unassigned.length) {
        // ★조용히 넘어가면 그 집은 배송을 못 받는다. 담당자가 지금 알아야 고칠 수 있다.
        const names = [...new Set(unassigned.map(u => {
          const d = assignedDrivers.find(x => x.id === u.driverId);
          return d?.name || u.driverId;
        }))];
        if (!window.confirm(
          `휴대폰이 등록되지 않은 기사가 있습니다: ${names.join(', ')}\n\n`
          + `해당 배송건 ${unassigned.length}건은 그 기사가 지도에서 볼 수 없습니다.\n`
          + '소속사 기사 관리에서 번호를 등록한 뒤 다시 만드는 것을 권합니다.\n\n그래도 생성할까요?')) {
          setIsCreatingShare(false); return;
        }
      }

      // ★ID 를 아는 것이 곧 열람 권한이다(공유 문서는 인증 없이 읽힌다) → CSPRNG 로 만든다.
      //   근거·회귀는 `src/utils/shareId.js` 주석과 `scripts/share-id.test.mjs` 참조.
      const shareId = newShareId();
      const meta = buildShareMeta({
        city: cloudCity || fileInfo?.city || '',
        monthId: cloudMonthId || '',
        drivers: assignedDrivers,
        roster,
        now: new Date(),
        deadline: dl.value,           // ★담당자가 정한 천장. 갱신도 이 날을 못 넘는다.
        ttlDays: SHARE_LINK_TTL_DAYS,
        createdBy: auth.currentUser?.email || '',
      });
      const expiresAtDate = meta.expiresAt;
      // 부모 = 메타만. ★배송건을 여기 넣으면 다시 통째로 새어나간다(계획 Phase 1).
      //
      // ★이중쓰기(SHARE_TRANSITION_DUAL_WRITE)는 **꺼졌다**(2026-08-23). 기사는 openShare 토큰(claims.driverId)으로
      //   서브컬렉션을 `where driverId` 로 읽으므로 부모 배열이 필요 없고, 배열이 있으면 토큰 하나로 전 기사 PII 가
      //   통째로 읽힌다(검사 실측). 다시 켜지 말 것 — 켜야 할 상황이면 규칙·토큰 설계가 깨진 것이다.
      // ★비밀번호는 평문 저장 금지 — 해시·솔트만, 그것도 기사가 못 읽는 별도 문서(규칙 route_share_secrets)에.
      //   검증은 openShare Function 만 한다. 공유 문서에 넣으면 토큰 가진 기사가 해시를 읽어 6자리를 즉시 역산한다.
      // ★공유 문서 + 비밀번호 문서는 **한 배치**로 쓴다 — 둘 중 하나만 남는 창(비밀번호 없는 공유 = 누구나 여는 링크)이 생기지 않게.
      //   규칙은 getAfter 로 같은 배치의 부모 소유자를 확인한다. createdByUid 는 SSO 담당자(email 클레임 없음)용 소유 키.
      const passcodeSalt = newSalt();
      const passcodeHash = await hashPasscode(passcode, passcodeSalt);
      const ownerUid = auth.currentUser?.uid || '';
      const metaBatch = writeBatch(db);
      metaBatch.set(doc(db, 'route_shares', shareId), {
        ...meta,
        createdByUid: ownerUid,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAtDate),
        deadline: meta.deadline ? Timestamp.fromDate(meta.deadline) : null,
        ...(SHARE_TRANSITION_DUAL_WRITE ? { records: shareRecords, _transitional: true } : {}),
      });
      metaBatch.set(doc(db, 'route_share_secrets', shareId), {
        passcodeHash,
        passcodeSalt,
        ver: 0,                     // 비밀번호 세대 — [변경] 때마다 오른다(옛 토큰을 끊는 근거)
        createdBy: auth.currentUser?.email || '',
        createdByUid: ownerUid,
        createdAt: serverTimestamp(),
      });
      await metaBatch.commit();
      // 건별 = 서브컬렉션 배치 쓰기(1,524건이면 4배치). 규칙이 driverPhone 으로 거른다.
      for (const part of chunk(shareRecords)) {
        const batch = writeBatch(db);
        for (const rec of part) {
          batch.set(doc(db, 'route_shares', shareId, 'records', String(rec.id || `${Date.now()}_${Math.random()}`)), rec);
        }
        await batch.commit();
      }
      const base = window.location.origin;
      setShareModal({
        shareId,
        passcode,   // 이 창에서만 보여준다 — 닫으면 다시 볼 수 없다(재설정만 가능)
        expiresAtLabel: expiresAtDate.toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        links: assignedDrivers.map(d => ({
          driverId: d.id, name: d.name, color: d.color,
          url: `${base}/?r=${shareId}&d=${d.id}`,
        })),
      });
      setAskPasscode(false);
      showToast('success', '공유 링크가 생성되었습니다.');
    } catch (e) {
      showToast('error', '공유 링크 생성 실패: ' + e.message);
    } finally {
      setIsCreatingShare(false);
    }
    // ★shareDeadline 을 deps 에 넣는다 — 빠지면 담당자가 날짜를 바꿔도
    //   **처음 값으로 만들어진다**(에러 없이 조용히 어긋나는 종류다).
  }, [records, drivers, cloudCity, cloudMonthId, fileInfo, showToast, shareDeadline]);

  // ── 기사 순번 반영 요청: 담당자 유선 확인 후 공식 명단에 승인 반영 ─────
  const handleLoadOrderApplyRequests = useCallback(async () => {
    if (!cloudCity || !cloudMonthId) {
      showToast('error', '클라우드 명단을 먼저 불러오세요.');
      return;
    }
    setIsLoadingOrderRequests(true);
    try {
      // ★규칙은 비관리자에게 **자기가 만든 · 기간 내** 공유만 허용한다(`isRouteOwner()` + `isShareWithinTTL()`).
      //   목록 질의는 그 조건을 **질의로 증명**해야 통과한다 — 안 그러면 담당자 화면엔 늘 "완료 기록 조회 실패"만 떴다(2026-08-24).
      //   관리자는 규칙이 먼저 통과시키므로 조건 없이 전부(만료분 포함) 본다.
      const _uid = auth.currentUser?.uid || '';
      const _isAdmin = isAdminEmail(auth.currentUser?.email);
      const _base = [
        collection(db, 'route_shares'),
        where('city', '==', cloudCity),
        where('monthId', '==', cloudMonthId),
      ];
      const snap = await getDocs(_isAdmin
        ? query(..._base, limit(30))
        : query(..._base, where('createdByUid', '==', _uid), where('expiresAt', '>', new Date()), limit(30)));
      const requests = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        Object.entries(data.orderApplyRequests || {}).forEach(([driverId, req]) => {
          if (req?.status !== 'requested') return;
          const driver = (data.drivers || []).find(d => d.id === driverId);
          const orderIds = Array.isArray(req.orderIds)
            ? req.orderIds
            : (Array.isArray(data.driverOrder?.[driverId]) ? data.driverOrder[driverId] : []);
          requests.push({
            shareId: docSnap.id,
            driverId,
            driverName: driver?.name || driverId,
            driverColor: driver?.color || '#3b82f6',
            orderIds,
            count: req.count || orderIds.length,
            requestedAt: req.requestedAt || '',
            createdAt: data.createdAt,
          });
        });
      });
      requests.sort((a, b) => {
        const at = Date.parse(a.requestedAt || '') || a.createdAt?.toDate?.()?.getTime?.() || 0;
        const bt = Date.parse(b.requestedAt || '') || b.createdAt?.toDate?.()?.getTime?.() || 0;
        return bt - at;
      });
      setOrderRequestModal({ requests });
      showToast(requests.length ? 'info' : 'success', requests.length ? `순번 반영 요청 ${requests.length}건 확인` : '대기 중인 순번 반영 요청이 없습니다.');
    } catch (e) {
      showToast('error', `순번 요청 조회 실패: ${e.message}`);
    } finally {
      setIsLoadingOrderRequests(false);
    }
  }, [cloudCity, cloudMonthId, showToast]);

  // ── ②-B 배송완료 기록 로드 (route_shares.completions 수집) ──────────────────
  const handleLoadCompletions = useCallback(async () => {
    if (!cloudCity || !cloudMonthId) {
      showToast('error', '클라우드 명단을 먼저 불러오세요.');
      return [];
    }
    setIsLoadingCompletions(true);
    try {
      const snap = await getDocs(query(
        collection(db, 'route_shares'),
        where('city', '==', cloudCity),
        where('monthId', '==', cloudMonthId),
        limit(30)
      ));
      const rows = [];
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const driversArr = data.drivers || [];
        // ★완료 기록은 이제 **건별 문서**에 산다(2026-08-23 Phase 2). 옛 공유는 부모 문서에 쌓여 있으므로
        //   둘을 합쳐 읽는다 — 이행기(옛 공유 만료 ≤30일)가 지나면 부모 쪽은 자연히 사라진다.
        const byId = new Map();
        try {
          const recSnap = await getDocs(collection(db, 'route_shares', docSnap.id, 'records'));
          recSnap.forEach(rs => byId.set(rs.id, rs.data()));
        } catch { /* 권한·네트워크 실패면 부모 기록만으로 표시(이름 없음) */ }
        const merged = new Map(Object.entries(data.completions || {}).filter(([, c]) => !!c));
        byId.forEach((rec, id) => { if (rec?.completion) merged.set(id, rec.completion); });
        const entries = [...merged.entries()];
        if (!entries.length) continue;
        for (const [key, c] of entries) {
          const driver = driversArr.find(d => d.id === c.driverId);
          const rec = byId.get(key) || {};
          const lat = Number(c.lat), lng = Number(c.lng);
          const dLat = Number(c.dongLat ?? rec.lat), dLng = Number(c.dongLng ?? rec.lng);
          rows.push({
            key: `${docSnap.id}_${key}`,
            name: c.name || rec.이름 || '',
            at: c.at || '',
            lat: Number.isFinite(lat) ? lat : null,
            lng: Number.isFinite(lng) ? lng : null,
            dongLat: Number.isFinite(dLat) ? dLat : null,
            dongLng: Number.isFinite(dLng) ? dLng : null,
            errM: Number.isFinite(c.errM) ? c.errM : null,
            accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
            driverId: c.driverId || null,
            driverName: driver?.name || '',
            shareId: docSnap.id,
          });
        }
      }
      setCompletionData(rows);
      return rows;
    } catch (e) {
      showToast('error', `완료 기록 조회 실패: ${e.message}`);
      return [];
    } finally {
      setIsLoadingCompletions(false);
    }
  }, [cloudCity, cloudMonthId, showToast]);

  // 완료비교 지도 토글 — 켤 때 최신 로드
  const toggleCompletionCompare = useCallback(async () => {
    if (showCompletionCompare) { setShowCompletionCompare(false); return; }
    const rows = await handleLoadCompletions();
    setShowCompletionCompare(true);
    const located = rows.filter(r => r.lat != null && r.dongLat != null).length;
    showToast(located ? 'info' : 'success',
      located ? `완료 ${rows.length}건 중 위치기록 ${located}건 표시` : '표시할 완료 위치기록이 없습니다.');
  }, [showCompletionCompare, handleLoadCompletions, showToast]);

  // 정확도 분석화면 — 열 때 최신 로드
  const openAccuracyView = useCallback(async () => {
    await handleLoadCompletions();
    setShowAccuracy(true);
  }, [handleLoadCompletions]);

  // ── ②-B 완료좌표 ↔ 동별좌표 비교 오버레이 (점·연결선·오차 라벨) ──────────────
  useEffect(() => {
    const map = kakaoMapRef.current;
    completionOverlaysRef.current.forEach(o => { try { o.setMap(null); } catch {} });
    completionOverlaysRef.current = [];
    if (!map || !showCompletionCompare || !window.kakao?.maps) return;
    // ★건당 오버레이 3개(선+점+라벨)라 상한이 없으면 월말에 지도가 통째로 느려진다(2026-08-23 점검).
    const COMPLETION_OVERLAY_MAX = 500;
    const completionForMap = completionData.slice(0, COMPLETION_OVERLAY_MAX);
    if (completionData.length > COMPLETION_OVERLAY_MAX) {
      console.warn(`[완료비교] ${completionData.length}건 중 ${COMPLETION_OVERLAY_MAX}건만 지도에 표시합니다(성능 상한).`);
    }
    completionForMap.forEach(c => {
      if (c.lat == null || c.lng == null || c.dongLat == null || c.dongLng == null) return;
      const color = c.errM != null && c.errM > 100 ? '#ef4444'
        : (c.errM != null && c.errM > 50 ? '#f59e0b' : '#22c55e');
      const donePos = new window.kakao.maps.LatLng(c.lat, c.lng);
      const dongPos = new window.kakao.maps.LatLng(c.dongLat, c.dongLng);
      const line = new window.kakao.maps.Polyline({
        path: [dongPos, donePos], strokeWeight: 3, strokeColor: color,
        strokeOpacity: 0.85, strokeStyle: c.errM != null && c.errM > 100 ? 'shortdash' : 'solid',
      });
      line.setMap(map);
      completionOverlaysRef.current.push(line);
      const dot = new window.kakao.maps.CustomOverlay({
        position: donePos, yAnchor: 0.5, xAnchor: 0.5, zIndex: 320,
        content: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.6);"></div>`,
      });
      dot.setMap(map);
      completionOverlaysRef.current.push(dot);
      if (c.errM != null) {
        const label = new window.kakao.maps.CustomOverlay({
          position: donePos, yAnchor: 2.1, xAnchor: 0.5, zIndex: 321,
          content: `<div style="padding:1px 6px;border-radius:6px;background:${color};color:#fff;font-size:10px;font-weight:900;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.5);">${c.errM}m</div>`,
        });
        label.setMap(map);
        completionOverlaysRef.current.push(label);
      }
    });
  }, [showCompletionCompare, completionData]);

  const handleApproveOrderRequest = useCallback(async (requestItem) => {
    if (!cloudCity || !cloudMonthId) {
      showToast('error', '클라우드 명단을 먼저 불러오세요.');
      return;
    }
    if (!requestItem?.orderIds?.length) {
      showToast('error', '반영할 순번 데이터가 없습니다.');
      return;
    }
    const ok = window.confirm(
      `${requestItem.driverName} 기사와 유선 확인이 끝났습니까?\n\n확인하면 이 기사에게 배정된 명단의 배송순번을 요청 순서로 공식 반영합니다.`
    );
    if (!ok) return;

    setIsApplyingOrderRequest(true);
    try {
      const driverRecords = records.filter(r => r._driverId === requestItem.driverId);
      const recordLookup = new Map();
      driverRecords.forEach((r, index) => {
        if (r.id) recordLookup.set(String(r.id), r);
        if (r._cloudDocId) recordLookup.set(String(r._cloudDocId), r);
        recordLookup.set(`${r.이름 || ''}_${r.배송순번 || index}`, r);
      });

      const seqByRecord = new Map();
      const usedRecords = new Set();
      requestItem.orderIds.forEach((uid, index) => {
        const target = recordLookup.get(String(uid));
        if (!target || usedRecords.has(target)) return;
        usedRecords.add(target);
        seqByRecord.set(target, String(index + 1));
      });

      if (!seqByRecord.size) {
        showToast('error', '요청 순번과 현재 명단을 매칭하지 못했습니다. 공유 링크를 다시 생성한 뒤 요청을 받아주세요.');
        return;
      }

      const nextRecords = records.map(r => seqByRecord.has(r)
        ? { ...r, 배송순번: seqByRecord.get(r) }
        : r
      );
      setRecords(nextRecords);
      setHasUnsaved(true);

      const changedRecords = nextRecords.filter((r, index) =>
        records[index]?._driverId === requestItem.driverId &&
        records[index]?.배송순번 !== r.배송순번 &&
        r._cloudDocId
      );
      const CHUNK = 499;
      for (let i = 0; i < changedRecords.length; i += CHUNK) {
        const batch = writeBatch(db);
        changedRecords.slice(i, i + CHUNK).forEach(r => {
          batch.set(
            doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId),
            { 배송순번: String(r.배송순번 || '') },
            { merge: true }
          );
        });
        await batch.commit();
      }

      await updateDoc(doc(db, 'route_shares', requestItem.shareId), {
        [`orderApplyRequests.${requestItem.driverId}.status`]: 'applied',
        [`orderApplyRequests.${requestItem.driverId}.appliedAt`]: new Date().toISOString(),
        [`orderApplyRequests.${requestItem.driverId}.appliedBy`]: auth.currentUser?.email || '',
        [`orderApplyRequests.${requestItem.driverId}.matchedCount`]: seqByRecord.size,
      });

      setOrderRequestModal(prev => prev
        ? { requests: prev.requests.filter(r => !(r.shareId === requestItem.shareId && r.driverId === requestItem.driverId)) }
        : prev
      );
      showToast('success', `${requestItem.driverName} 순번 ${seqByRecord.size}건 공식 반영 완료`);
    } catch (e) {
      showToast('error', `순번 승인 반영 실패: ${e.message}`);
    } finally {
      setIsApplyingOrderRequest(false);
    }
  }, [cloudCity, cloudMonthId, records, showToast]);

  // ── 겹침 해소 (아파트/동일주소 단위 보존 — 권역 안의 섬만 보정) ───────
  const handleResolveOverlap = useCallback(() => {
    if (isAssignmentLocked) { showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.'); return; }
    const MAX_PASS = 8;
    const affectedIds = new Set(filteredRecords.map(r => r.id));

    let current = [...records];
    let totalMoved = 0;

    for (let pass = 0; pass < MAX_PASS; pass++) {
      const currentScope = current.filter(r => affectedIds.has(r.id));
      const units = buildAssignedRouteUnits(currentScope, drivers);
      const mixedIssues = getMixedRouteUnitIssues(units);
      if (!mixedIssues.size) break;

      const updates = {};
      units.filter(unit => mixedIssues.has(unit.key)).forEach(unit => {
        const issue = mixedIssues.get(unit.key);
        const bestDriver = issue?.targetDriverId;
        if (!bestDriver) return;
        unit.records.forEach(record => {
          if (record._driverId !== bestDriver) updates[record.id] = bestDriver;
        });
      });

      const movedThisPass = Object.keys(updates).length;
      if (!movedThisPass) break;

      totalMoved += movedThisPass;
      current = current.map(r => updates[r.id] ? { ...r, _driverId: updates[r.id] } : r);
    }

    if (!totalMoved) {
      setOverlapCount(0);
      showToast('info', '해소할 겹침이 없습니다.');
      return;
    }
    setRecords(current);
    showToast('success', `혼재 보정 완료 — 아파트/동일주소 묶음을 지키며 ${totalMoved}건 재배정`);
  }, [records, filteredRecords, drivers, showToast, isAssignmentLocked]);

  // ── 배송순번 전체 초기화 ──────────────────────────────────────────────
  const handleClearSequence = useCallback(() => {
    if (!window.confirm('전체 배송순번을 초기화합니다. 계속하시겠습니까?')) return;
    // snapshot 먼저 복사 후 clear — updater 실행 전 clear 방지
    const snapshot = new Map(pendingPaintRef.current);
    pendingPaintRef.current.clear();
    setRecords(prev => {
      const withPaint = snapshot.size > 0
        ? prev.map(r => snapshot.has(r.id) ? { ...r, _driverId: snapshot.get(r.id) } : r)
        : prev;
      return withPaint.map(r => ({ ...r, 배송순번: '' }));
    });
    showToast('success', '배송순번 전체 초기화 완료');
  }, [showToast]);

  // ── KML 경로 파일 다운로드 (네이버 지도·Google Maps 가져오기 가능) ────────
  const handleDownloadKML = useCallback(() => {
    const city = cloudCity || fileInfo?.city || '지자체';
    const month = cloudMonthId || fileInfo?.month || '';
    const assignedDrivers = drivers.filter(d => records.some(r => r._driverId === d.id));
    if (!assignedDrivers.length) { showToast('error', '배정된 기사가 없습니다.'); return; }

    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const folders = assignedDrivers.map(driver => {
      const driverRecs = records
        .filter(r => r._driverId === driver.id && r._lat && r._lng)
        .sort((a, b) => (parseInt(a.배송순번) || 999) - (parseInt(b.배송순번) || 999));

      const placemarks = driverRecs.map(r => `    <Placemark>
      <name>${esc(r.배송순번 ? `${r.배송순번}. ` : '')}${esc(r.이름)}</name>
      <description>${esc(r.주소)} / 포수:${r.포수 || 1}${r.특이사항 ? ` / ${r.특이사항}` : ''}</description>
      <Point><coordinates>${r._lng},${r._lat},0</coordinates></Point>
    </Placemark>`).join('\n');

      const lineCoords = driverRecs.map(r => `${r._lng},${r._lat},0`).join(' ');
      const lineTag = driverRecs.length >= 2 ? `    <Placemark>
      <name>${esc(driver.name)} 경로</name>
      <LineString><tessellate>1</tessellate><coordinates>${lineCoords}</coordinates></LineString>
    </Placemark>` : '';

      return `  <Folder>
    <name>${esc(driver.name)} (${driverRecs.length}건)</name>
${placemarks}
${lineTag}
  </Folder>`;
    }).join('\n');

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${esc(city)} ${esc(month)} 배송경로</name>
${folders}
</Document>
</kml>`;

    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${city}-${month}-배송경로.kml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('success', `KML 파일 다운로드 완료 — 네이버 지도 "내 지도 가져오기"에서 열 수 있습니다`);
  }, [records, drivers, fileInfo, cloudCity, cloudMonthId, showToast]);

  // ── 담당자용 기사별 엑셀 내보내기 ──────────────────────────────────────
  const handleExportDriverExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const now = new Date();
    const ts = String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
    const city = cloudCity || fileInfo?.city || '지자체';
    const month = cloudMonthId || fileInfo?.month || '';

    const COLS = ['배송순번','행정동','이름','주소','포수','특이사항','휴대폰'];

    const makeRow = (r) => [
      r.배송순번 || '',
      r.행정동 || '',
      r.이름 || '',
      r.주소 || '',
      r.포수 || '',
      r.특이사항 || '',
      r.휴대폰 || '',
    ];

    drivers.forEach(driver => {
      const assigned = records.filter(r => r._driverId === driver.id);
      if (!assigned.length) return;

      // 일반 배송 (좌표 있음 + 비아파트) — 배송순번 정렬
      const normal = assigned
        .filter(r => !r._isApt)
        .sort((a, b) => (parseInt(a.배송순번)||999) - (parseInt(b.배송순번)||999));

      // 아파트 — 동호수 정렬
      const apts = assigned
        .filter(r => r._isApt)
        .sort((a, b) => {
          const dA = parseAptDong(a.주소) ?? 999, dB = parseAptDong(b.주소) ?? 999;
          if (dA !== dB) return dA - dB;
          const { floor: fA, ho: hA } = parseFloorHo(a.주소);
          const { floor: fB, ho: hB } = parseFloorHo(b.주소);
          return fA !== fB ? fA - fB : hA - hB;
        });

      const rows = [COLS, ...normal.map(makeRow)];

      if (apts.length > 0) {
        rows.push(['', '', '', '', '', '', '']);
        rows.push(['[아파트]', '', '', '', '', '', '']);
        rows.push(COLS);
        apts.forEach(r => rows.push(makeRow(r)));
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);

      // 헤더 행 스타일 (굵기)
      const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: 'E2EFDA' } } };
      ['A1','B1','C1','D1','E1','F1','G1'].forEach(cell => {
        if (ws[cell]) ws[cell].s = headerStyle;
      });

      // 컬럼 너비
      ws['!cols'] = [
        { wch: 7 }, { wch: 10 }, { wch: 10 }, { wch: 40 },
        { wch: 6 }, { wch: 30 }, { wch: 15 },
      ];

      XLSX.utils.book_append_sheet(wb, ws, driver.name.slice(0, 31));
    });

    if (wb.SheetNames.length === 0) { alert('배정된 기사가 없습니다.'); return; }

    const fileName = `[담당자용]${city}-${month}-기사별배정-${ts}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }, [records, drivers, fileInfo, cloudCity, cloudMonthId]);   // ★도시·월은 파일 이름에 들어간다 — 모달 안에서 월을 바꾸면(2103행) 옛 달 이름으로 나갔다(2026-08-24)

  // ── 배송루트 번들 다운로드 (엑셀 + 기사별 지도 이미지) ─────────────────
  const handleDownloadRouteBundle = useCallback(async () => {
    const hasAssigned = drivers.some(d => records.some(r => r._driverId === d.id));
    if (!hasAssigned) { alert('배정된 기사가 없습니다.'); return; }

    // 1) 담당자용 엑셀 (기존 함수 재사용)
    handleExportDriverExcel();

    // 2) 기사별 카카오 정적 지도 이미지 다운로드
    const city = cloudCity || fileInfo?.city || '';
    const month = cloudMonthId || fileInfo?.month || '';

    for (const driver of drivers) {
      const dRecs = records
        .filter(r => r._driverId === driver.id && r._lat && r._lng)
        .sort((a, b) => (parseInt(a.배송순번) || 999) - (parseInt(b.배송순번) || 999))
        .slice(0, 80); // URL 길이 제한 대응
      if (!dRecs.length) continue;

      const centerLat = dRecs.reduce((s, r) => s + r._lat, 0) / dRecs.length;
      const centerLng = dRecs.reduce((s, r) => s + r._lng, 0) / dRecs.length;
      const kakaoColor = KAKAO_COLOR_MAP[driver.color] || 'gray';
      const posStr = dRecs.map(r => `${r._lng} ${r._lat}`).join('|');
      const markerParam = `type:pos|color:${kakaoColor}|size:small&pos=${posStr}`;
      try {
        const blob = await kakaoStaticMapBlob({ centerLat, centerLng, level: 6, w: 1200, h: 900, markers: markerParam });
        if (blob) {
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = `[지도]${driver.name}${city ? '-' + city : ''}${month ? '-' + month : ''}.png`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          await new Promise(r => setTimeout(r, 400));
        }
      } catch (e) {
        console.warn(`${driver.name} 지도 이미지 실패:`, e);
      }
    }
  }, [drivers, records, fileInfo, cloudCity, cloudMonthId, handleExportDriverExcel]);   // ★위와 같은 이유(파일 이름의 도시·월)

  // ── 그리드 업데이트 (공통) ───────────────────────────────────────────
  const buildUpdatedGrid = useCallback(() => {
    return gridData.map(orig => {
      const rec = records.find(r => r.id === orig.id);
      if (!rec) return orig;
      const driverName = drivers.find(d => d.id === rec._driverId)?.name || '';
      return { ...orig, 기사: driverName || orig.기사, 배송순번: rec.배송순번 || orig.배송순번 };
    });
  }, [gridData, records, drivers]);

  // ── 저장 (세션 모드: gridData 업데이트 / 클라우드 모드: Firestore 저장) ──
  const handleSave = async () => {
    if (isCloudMode) {
      await handleSaveToCloud();
    } else {
      onSave(buildUpdatedGrid());
      onClose();
    }
  };

  // ── 좌표 보완/재매칭 (Kakao 지오코딩 다단계 순환) ─────────────────────
  const handleFetchMissingCoords = async (options = {}) => {
    const {
      recordIds = null,
      force = false,
      skipConfirm = false,
    } = options;
    const idSet = recordIds ? new Set(recordIds) : null;
    // 선택된 읍/면/동만 매칭 — 전체 매칭은 오래 걸려 작업이 끊기므로 현재 작업 동으로 한정.
    // activeDong 없거나(전체 보기) options.scope==='all'이면 전체 대상.
    const scopeDong = (!idSet && options.scope !== 'all' && activeDong) ? activeDong : null;
    const targets = records.filter(r =>
      (idSet ? idSet.has(r.id) : (!r._lat || !r._lng)) &&
      (scopeDong ? getRouteDong(r) === scopeDong : true) &&
      (r.주소 || r.원본주소 || r.지번주소 || r.jibunAddr || r.확인사유 || r._사유)
    );
    if (!targets.length) { alert(scopeDong ? `[${scopeDong}] 좌표 미수신 데이터가 없습니다.` : '좌표 미수신 데이터가 없습니다.'); return; }
    const scopeLabel = scopeDong ? `[${scopeDong}] ` : '[전체] ';
    const confirmText = force
      ? `${scopeLabel}선택한 ${targets.length}건의 기존 좌표를 버리고 다시 조회합니다.\n도로명·지번·원본주소·행정동 조합으로 재매칭합니다.\n계속하시겠습니까?`
      : `${scopeLabel}좌표 없는 ${targets.length}건을 카카오 API로 조회합니다.\n도로명·지번·원본주소·행정동 조합으로 조회합니다.\n계속하시겠습니까?`;
    if (!skipConfirm && !window.confirm(confirmText)) return;
    setIsFetchingCoords(true);
    const updates = {};
    const updateMeta = {};
    const areaMeta = {};
    const concurrency = 10;

    // ★서버 프록시 경유 — 클라이언트에는 REST 키가 없다(2026-08-23 점검)
    const fetchCoord = async (query, source, keyword = false) => {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      try {
        const hit = await kakaoCoordOf(query, { keyword, signal: ctrl.signal });
        clearTimeout(tid);
        return hit ? { ...hit, source } : null;
      } catch { clearTimeout(tid); return null; }
    };

    const getJibunFromReason = (r) => {
      const reasonText = r.확인사유 || r._사유 || '';
      const match = String(reasonText).match(/지번주소만 확인(?:됨)?:\s*(.+)$/);
      return match?.[1]?.trim() || '';
    };

    const uniq = (items) => [...new Set(items.map(v => String(v || '').replace(/\s+/g, ' ').trim()).filter(v => v.length >= 2))];

    // 2단계: 캐시에서 먼저 확인 (API 호출 전)
    const cacheCity = isCloudMode ? cloudCity : (fileInfo?.city || '');
    // ★도시 좌표 캐시를 **한 번에** 읽는다(2026-08-23 Phase 1) — 예전엔 레코드마다 getDoc 1회(건당 27.8ms)라
    //   7,402건이면 약 206초를 캐시 조회에만 썼다. 일괄 로드는 637ms.
    if (cacheCity) mapCoordCacheRef.current = await loadCityCoordCache(db, cacheCity);
    if (cacheCity && !force) {
      setCoordProgress({ done: 0, total: targets.length, round: 0 });
      for (const r of targets) {
        const road = extractRoadAddress(r.주소);
        const cached = getCachedCoordLocal(road);
        if (cached) {
          updates[r.id] = cached;
          updateMeta[r.id] = { source: 'cache', query: road };
          areaMeta[r.id] = { status: r.좌표검증상태 || '정상', routeDong: getRouteDong(r), transferNeeded: !!r.이관필요 };
        }
        setCoordProgress(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
      }
    }

    const runRound = async (roundTargets, round, label, queryBuilder) => {
      if (!roundTargets.length) return;
      setCoordProgress({ done: 0, total: roundTargets.length, round });
      const executing = new Set();
      for (const r of roundTargets) {
        const p = (async () => {
          const candidate = queryBuilder(r);
          const candidates = Array.isArray(candidate) ? candidate : [candidate];
          let coord = null;
          let used = null;
          for (const c of candidates.filter(Boolean)) {
            coord = await fetchCoord(c.query, c.source || label, !!c.keyword);
            if (coord) { used = c; break; }
          }
          if (coord) {
            updates[r.id] = coord;
            updateMeta[r.id] = { source: coord.source || label, query: used?.query || '' };
            areaMeta[r.id] = assessKakaoAreaMatch(r, coord.raw, cacheCity);
            // 캐시에 저장
            if (cacheCity) await saveCoordCacheLocal(cacheCity, extractRoadAddress(r.주소), coord.lat, coord.lng);
          }
          setCoordProgress(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
        })().then(() => executing.delete(p));
        executing.add(p);
        if (executing.size >= concurrency) await Promise.race(executing);
      }
      await Promise.all(executing);
    };

    // 지자체 토큰 추출 (시/군/구 — 다른 지자체 좌표 오매칭 방지)
    const cityTok = cacheCity
      ? (cacheCity.trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '')
      : '';
    const cityFull = cacheCity || '';
    // ★후보는 URL 이 아니라 (질의어, 검색종류)다 — 호출은 서버 프록시가 한다(클라에 REST 키 없음, 2026-08-23 점검)
    const makeAddressUrl = (query, source) => ({ source, query, keyword: false });
    const makeKeywordUrl = (query, source) => ({ source, query, keyword: true });

    try {
      // 1라운드: 지자체+도로명 → address API (가장 정확)
      await runRound(targets.filter(r => !updates[r.id]), 1, 'kakao-road', r => {
        const road = extractRoadAddress(r.주소);
        return uniq([cityFull && road ? `${cityFull} ${road}` : '', cityTok && road ? `${cityTok} ${road}` : road])
          .map(q => makeAddressUrl(q, 'kakao-road'));
      });

      // 2라운드: 지번주소/확인사유 지번 → address API
      const r2 = targets.filter(r => !updates[r.id]);
      await runRound(r2, 2, 'kakao-jibun', r => {
        const jibun = r.지번주소 || r.jibunAddr || getJibunFromReason(r);
        return uniq([cityFull && jibun ? `${cityFull} ${jibun}` : '', cityTok && jibun ? `${cityTok} ${jibun}` : jibun])
          .map(q => makeAddressUrl(q, 'kakao-jibun'));
      });

      // 3라운드: 원본주소/현재주소 → address API
      const r3 = targets.filter(r => !updates[r.id]);
      await runRound(r3, 3, 'kakao-original', r => {
        const original = r.원본주소 || r.originalAddress || r.rawAddress || r.주소 || '';
        return uniq([cityFull && original ? `${cityFull} ${original}` : '', cityTok && original ? `${cityTok} ${original}` : original])
          .map(q => makeAddressUrl(q, 'kakao-original'));
      });

      // 4라운드: 도로명/원본 키워드 검색
      const r4 = targets.filter(r => !updates[r.id]);
      await runRound(r4, 4, 'kakao-keyword', r => {
        const road = extractRoadAddress(r.주소).slice(0, 35);
        const original = String(r.원본주소 || r.originalAddress || r.주소 || '').slice(0, 45);
        return uniq([
          [cityFull || cityTok, getRouteDong(r), road].filter(Boolean).join(' '),
          [cityFull || cityTok, getRouteDong(r), original].filter(Boolean).join(' '),
          [getRouteDong(r), road].filter(Boolean).join(' '),
        ]).map(q => makeKeywordUrl(q, 'kakao-keyword'));
      });

      // 좌표가 수정된 레코드는 기존 배정도 초기화 — 잘못된 좌표 기반 배정 오염 방지
      setRecords(prev => prev.map(r => {
        if (!updates[r.id]) return r;
        const area = areaMeta[r.id] || { status: r.좌표검증상태 || '정상', routeDong: getRouteDong(r), transferNeeded: false };
        const isCityOut = area.status === '지자체벗어남';
        const isDongOut = area.status === '행정동벗어남';
        return {
            ...r,
            _lat: updates[r.id].lat,
            _lng: updates[r.id].lng,
            _driverId: null,
            좌표상태: updateMeta[r.id]?.source === 'kakao-jibun' ? '지번좌표확인' : (force ? '재매칭됨' : '좌표확인'),
            좌표출처: updateMeta[r.id]?.source || (force ? 'rematch' : 'kakao'),
            좌표검증상태: area.status,
            좌표확인지자체: [area.matchedSido, area.matchedSigungu].filter(Boolean).join(' '),
            좌표확인행정동: area.matchedDong || '',
            좌표오류지정: false,
            원행정동: isDongOut && !r.원행정동 ? r.행정동 || '' : r.원행정동,
            배정행정동: isDongOut ? area.routeDong : (r.배정행정동 || ''),
            이관필요: isDongOut,
            확인필요: isCityOut ? true : r.확인필요,
            확인사유: mergeReason(r.확인사유, area.reason),
            _에러: isCityOut ? true : r._에러,
            _사유: mergeReason(r._사유, area.reason),
            배송상태: isCityOut ? '타지자체확인필요' : (isDongOut ? '타동이관필요' : (r.확인필요 || r._에러 ? '확인후배정가능' : '배송준비')),
            이전좌표: force && r._lat && r._lng ? { lat: r._lat, lng: r._lng, source: r.좌표출처 || '' } : r.이전좌표,
          };
      }));
      setHasRunGeocoding(true);

      // 클라우드 저장
      if (isCloudMode && cloudCity && cloudMonthId && Object.keys(updates).length) {
        const cloudUpdates = Object.entries(updates).flatMap(([id, coord]) => {
          const rec = records.find(r => r.id === id);
          return rec?._cloudDocId ? [{ docId: rec._cloudDocId, coord, meta: updateMeta[id] || {}, rec }] : [];
        });
        for (let i = 0; i < cloudUpdates.length; i += 499) {
          const batch = writeBatch(db);
          cloudUpdates.slice(i, i + 499).forEach(({ docId, coord, meta, rec }) => {
            const area = areaMeta[rec.id] || { status: rec.좌표검증상태 || '정상', routeDong: getRouteDong(rec), transferNeeded: false };
            const isCityOut = area.status === '지자체벗어남';
            const isDongOut = area.status === '행정동벗어남';
            batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', docId), {
              lat: coord.lat,
              lng: coord.lng,
              좌표상태: meta.source === 'kakao-jibun' ? '지번좌표확인' : (force ? '재매칭됨' : '좌표확인'),
              좌표출처: meta.source || (force ? 'rematch' : 'kakao'),
              좌표검증상태: area.status,
              좌표확인지자체: [area.matchedSido, area.matchedSigungu].filter(Boolean).join(' '),
              좌표확인행정동: area.matchedDong || '',
              좌표오류지정: false,
              원행정동: isDongOut && !rec.원행정동 ? rec.행정동 || '' : rec.원행정동 || '',
              배정행정동: isDongOut ? area.routeDong : (rec.배정행정동 || ''),
              이관필요: isDongOut,
              확인필요: isCityOut ? true : !!rec.확인필요,
              확인사유: mergeReason(rec.확인사유, area.reason),
              _에러: isCityOut ? true : !!rec._에러,
              _사유: mergeReason(rec._사유, area.reason),
              좌표수정일시: serverTimestamp(),
              좌표수정자: auth.currentUser?.email || '',
              배송상태: isCityOut ? '타지자체확인필요' : (isDongOut ? '타동이관필요' : (rec.확인필요 || rec._에러 ? '확인후배정가능' : '배송준비')),
              ...(force && rec._lat && rec._lng ? { 이전좌표: { lat: rec._lat, lng: rec._lng, source: rec.좌표출처 || '' } } : {}),
            });
          });
          await batch.commit();
        }
      }

      const success = Object.keys(updates).length;
      const remain = targets.length - success;
      // 좌표가 선택 지자체 밖/타 행정동인 건수 — 담당자에게 명시적으로 알림(확인필요로도 표시됨)
      const outCity = Object.keys(updates).filter(id => areaMeta[id]?.status === '지자체벗어남').length;
      const dongOut = Object.keys(updates).filter(id => areaMeta[id]?.status === '행정동벗어남').length;
      const title = force ? '좌표 재매칭 완료' : '좌표 보완 완료';
      let msg = `✅ ${title}\n성공: ${success}/${targets.length}건${remain > 0 ? `\n미수신 ${remain}건은 주소 재확인이 필요합니다.` : ' (100% 완료!)'}`;
      if (outCity > 0) msg += `\n\n⚠ 지자체 이탈 ${outCity}건 — 선택한 지자체 밖 좌표입니다. 자동배정에서 제외되고 '확인필요'로 표시됩니다. 배정 전 담당자 확인 필요.`;
      if (dongOut > 0) msg += `\n↪ 타 행정동 ${dongOut}건 — 다른 동으로 이관이 필요합니다('확인필요' 표시).`;
      alert(msg);
    } catch (e) {
      alert('좌표 처리 실패: ' + e.message);
    } finally {
      setIsFetchingCoords(false);
      setCoordProgress(null);
    }
  };

  // ── 소속사 기사 추가 (피커에서 선택하거나 직접 입력)
  const addCompanyDriver = useCallback((driverInfo) => {
    if (!driverInfo) return;
    const driverName = (driverInfo.name || '').trim();
    const existing = drivers.find(d => d.id === driverInfo.id || ((d.name || '').trim() && (d.name || '').trim() === driverName));
    if (existing) {
      setSelectedDriverFilter(existing.id);
      setShowCompanyPicker(false);
      return;
    }
    if (drivers.length >= 8) return;
    const idx = drivers.length;
    setDrivers(prev => [...prev, {
      id: driverInfo.id || `d${Date.now()}`,
      name: driverName || `기사${idx + 1}`,
      phone: driverInfo.phone || '',
      color: driverInfo.color || DRIVER_COLORS[idx % DRIVER_COLORS.length],
      capacity: driverInfo.capacity || 100,
    }]);
    setDriverCount(c => c + 1);
    setShowCompanyPicker(false);
  }, [drivers]);

  const buildSetupRestorePayload = useCallback(() => {
    const mergedDriverMap = new Map();
    [...(allKnownDrivers || []), ...(drivers || [])].forEach(driver => {
      if (!driver?.id) return;
      mergedDriverMap.set(driver.id, { ...mergedDriverMap.get(driver.id), ...driver });
    });

    const mergedDrivers = [...mergedDriverMap.values()].filter(d => (d.name || '').trim());
    const nameToId = new Map();
    mergedDrivers.forEach(driver => {
      const name = String(driver.name || '').trim();
      if (name && !nameToId.has(name)) nameToId.set(name, driver.id);
    });
    const validDriverIds = new Set(mergedDrivers.map(driver => driver.id));
    const scopeDongSet = orgDongs ? new Set(orgDongs) : null;
    const recordDongSet = new Set(records.map(record => getRouteDong(record)).filter(Boolean));
    const isAllowedDong = (dong) => {
      if (!dong) return false;
      if (scopeDongSet && !scopeDongSet.has(dong)) return false;
      if (recordDongSet.size && !recordDongSet.has(dong)) return false;
      return true;
    };

    const restoredDongDriverMap = {};
    Object.entries(setupDongDriverMapProp || {}).forEach(([dong, ids]) => {
      if (!isAllowedDong(dong)) return;
      const cleanIds = [...new Set(Array.isArray(ids) ? ids : [])].filter(id => validDriverIds.has(id));
      if (cleanIds.length) restoredDongDriverMap[dong] = cleanIds;
    });

    records.forEach(record => {
      const routeDong = getRouteDong(record);
      if (!isAllowedDong(routeDong)) return;
      const savedDriverRaw = String(record.기사 || record._origDriver || '').trim();
      const savedDriverName = savedDriverRaw && !savedDriverRaw.includes('/') ? savedDriverRaw : '';
      const driverId = record._driverId || nameToId.get(savedDriverName);
      if (!driverId || !validDriverIds.has(driverId)) return;
      if (!restoredDongDriverMap[routeDong]) restoredDongDriverMap[routeDong] = [];
      if (!restoredDongDriverMap[routeDong].includes(driverId)) {
        restoredDongDriverMap[routeDong].push(driverId);
      }
    });

    const payloadSelectedDongs = selectedDongsProp || (dongQueue.length ? new Set(dongQueue) : null);
    const cleanSelectedDongs = payloadSelectedDongs
      ? new Set([...payloadSelectedDongs].filter(isAllowedDong))
      : null;
    const cleanScopeDongs = orgDongs
      ? new Set([...orgDongs].filter(dong => !recordDongSet.size || recordDongSet.has(dong)))
      : cleanSelectedDongs;

    return {
      selectedDongs: cleanSelectedDongs,
      scopeDongs: cleanScopeDongs,
      orgDongs: cleanScopeDongs,
      drivers: mergedDrivers.length ? mergedDrivers : drivers,
      companyDrivers: mergedDrivers.length ? mergedDrivers : allKnownDrivers,
      dongDriverMap: restoredDongDriverMap,
      baseDailyQty: baseDailyQtyProp,
      orgId: orgIdProp || 'all',
    };
  }, [allKnownDrivers, drivers, setupDongDriverMapProp, records, selectedDongsProp, dongQueue, orgDongs, baseDailyQtyProp, orgIdProp]);

  const removeDriver = (id) => {
    setDrivers(prev => prev.filter(d => d.id !== id));
    setRecords(prev => prev.map(r => r._driverId === id ? { ...r, _driverId: null, 배송순번: '' } : r));
    setDriverCount(c => Math.max(1, c - 1));
  };

  // ── 클라우드 피커 모달 ──────────────────────────────────────────────
  const cloudPickerOverlay = showCloudPicker ? (
      <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-[#0a0a0a] border border-blue-500/20 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(59,130,246,0.1)]">
          <div className="p-5 border-b border-[#1a1a1a] flex items-center gap-2">
            <HardDrive size={16} className="text-blue-400" />
            <span className="text-white font-black text-sm">클라우드 명단 불러오기</span>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <div className="text-[10px] text-gray-500 mb-1.5 font-bold">지자체명</div>
              <input
                value={cloudPickerCity}
                onChange={e => setCloudPickerCity(e.target.value)}
                placeholder="예) 영양군"
                className="w-full bg-[#111] border border-[#2a2a2a] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <div className="text-[10px] text-gray-500 mb-1.5 font-bold">월 (YYYY-MM)</div>
              <input
                value={cloudPickerMonth}
                onChange={e => setCloudPickerMonth(e.target.value)}
                placeholder="예) 2026-05"
                className="w-full bg-[#111] border border-[#2a2a2a] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div className="text-[10px] text-gray-600">
              클라우드에 저장된 해당 월 명단(좌표 포함)을 불러옵니다.<br/>
              기사 배정 후 [클라우드 저장] 버튼으로 다시 저장하세요.
            </div>
          </div>
          <div className="p-4 border-t border-[#1a1a1a] flex gap-2">
            <button onClick={() => setShowCloudPicker(false)}
              className="flex-1 py-2 bg-[#1a1a1a] text-gray-400 rounded-lg text-sm font-bold hover:text-white transition-colors">
              취소
            </button>
            <button onClick={handleLoadFromCloud} disabled={isLoadingCloud}
              className="flex-1 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-bold hover:bg-blue-500/30 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
              {isLoadingCloud ? <RefreshCw size={13} className="animate-spin" /> : <HardDrive size={13} />}
              {isLoadingCloud ? '불러오는 중...' : '불러오기'}
            </button>
          </div>
        </div>
      </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" style={{ fontFamily: 'inherit' }}>

      {/* ── 헤더 ───────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-[#0a0a0a] border-b border-[#222] px-4 py-2 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-[#3b82f6]" />
          <span className="text-white font-black text-sm tracking-wide">배송 구역 배정</span>
          {isCloudMode
            ? <span className="text-blue-400 text-xs font-bold">[클라우드] {cloudCity} {cloudMonthId}</span>
            : <span className="text-gray-600 text-xs">{fileInfo?.city} {fileInfo?.month}</span>
          }
        </div>

        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-[#3b82f6]">
            지도 {withCoordCount.toLocaleString()}건
            {aptWithCoord > 0 && <span className="text-orange-400/80"> · 아파트좌표 {aptWithCoord.toLocaleString()}건</span>}
            <span className="text-[#3b82f6]/50"> ({withCoordPct}%)</span>
          </span>
          {aptCount > 0 && aptWithCoord < aptCount && (
            <span className="text-orange-400"><Building2 size={9} className="inline mr-0.5" />아파트 {aptCount.toLocaleString()}건</span>
          )}
          {totalNoCoord > 0 && (
            <button
              onClick={() => setShowErrorPanel(true)}
              className="flex items-center gap-1 px-2 py-0.5 bg-red-900/40 border border-red-600/50 rounded text-red-400 text-[10px] font-bold hover:bg-red-800/50 transition-colors animate-pulse"
            >
              <AlertCircle size={10} /> 좌표없음 {totalNoCoord.toLocaleString()}건
            </button>
          )}
          {outCityCount > 0 && (
            <button
              onClick={() => setShowErrorPanel(true)}
              title="좌표는 지도에 표시 중 — 지자체가 다른 주소입니다. 클릭하여 확인하세요."
              className="flex items-center gap-1 px-2 py-0.5 bg-amber-900/40 border border-amber-600/50 rounded text-amber-400 text-[10px] font-bold hover:bg-amber-800/50 transition-colors"
            >
              <AlertTriangle size={10} /> 지자체이탈 {outCityCount.toLocaleString()}건
            </button>
          )}
        </div>

        {overlapCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-red-300 font-black">
            <AlertTriangle size={11} className="text-red-400" />
            혼재 {overlapCount.toLocaleString()}건
          </span>
        )}
        {overlapCount === 0 && withCoordCount > 0 && (
          <span className="text-[10px] text-emerald-500/70 font-bold">✓ 구역 정리됨</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">

          {/* ── 그룹 1: 세션 (상태 뱃지는 유지, 가끔 쓰는 동작은 드롭다운으로 정리) ── */}
          {isCloudMode && (
            <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
              <span className="text-[8px] text-gray-700 font-black tracking-widest mr-1">세션</span>
              {/* 저장 상태 뱃지 — 항상 보이게 유지 */}
              {hasUnsaved
                ? <span className="text-[9px] text-amber-400 animate-pulse font-bold mr-1">● 미저장</span>
                : sessionStatus
                  ? <span className={`text-[9px] font-bold mr-1 ${sessionStatus === 'final' ? 'text-[#3b82f6]' : 'text-amber-400/80'}`}>
                      {sessionStatus === 'final' ? '✓ 최종' : '✓ 임시'}{lastAutoSave ? ` ${lastAutoSave.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </span>
                  : null
              }
              {/* 이어서작업 · 저장본 · 이전달승계 — 드롭다운 통합 */}
              <div className="relative">
                <button
                  onClick={() => setShowSessionMenu(v => !v)}
                  title="이어서 작업 · 저장본 보기/편집 · 이전달 승계"
                  className="px-2 py-1 bg-[#111] border border-[#2a2a2a] text-gray-400 hover:text-cyan-400 hover:border-cyan-500/40 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
                >
                  {(isLoadingSession || isLoadingPrevMonth) ? <RefreshCw size={10} className="animate-spin" /> : <Clock size={10} />}
                  세션 <span className="text-[8px] leading-none">▾</span>
                </button>
                {showSessionMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowSessionMenu(false)} />
                    <div className="absolute right-0 mt-1 z-50 bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl p-1 shadow-2xl min-w-[168px]">
                      <button
                        onClick={() => { setShowSessionMenu(false); handleLoadSession(); }}
                        disabled={isLoadingSession}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-cyan-400 hover:bg-cyan-900/20 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw size={11} /> 이어서 작업
                      </button>
                      <button
                        onClick={() => { setShowSessionMenu(false); handleOpenSavedView(); }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-cyan-400 hover:bg-cyan-900/20 flex items-center gap-1.5 transition-colors"
                      >
                        <HardDrive size={11} /> 저장본 보기·편집
                      </button>
                      <button
                        onClick={() => { setShowSessionMenu(false); setShowDriverSeq(true); }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-blue-400 hover:bg-blue-900/20 flex items-center gap-1.5 transition-colors"
                      >
                        <User size={11} /> 기사별 순번
                      </button>
                      <button
                        onClick={() => { setShowSessionMenu(false); handleLoadPrevMonth(); }}
                        disabled={isLoadingPrevMonth}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-blue-400 hover:bg-blue-900/20 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <Clock size={11} /> 이전달 승계
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── 그룹 2: 좌표 ─────────────────────────────────────────── */}
          <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
            <span className="text-[8px] text-gray-700 font-black tracking-widest mr-1">좌표</span>
            <button
              onClick={handleFetchMissingCoords}
              disabled={isFetchingCoords}
              title={totalNoCoord > 0 ? `좌표 없는 ${totalNoCoord}건을 카카오 API로 자동 조회합니다` : '모든 주소의 좌표가 확인되었습니다'}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-colors disabled:opacity-50 ${
                totalNoCoord > 0
                  ? 'bg-red-900/30 border-red-600/50 text-red-400 hover:bg-red-800/40'
                  : 'bg-[#111] border-[#2a2a2a] text-gray-500 hover:text-gray-300'
              }`}
            >
              {isFetchingCoords
                ? <><RefreshCw size={10} className="animate-spin" />{coordProgress ? `${coordProgress.done}/${coordProgress.total}` : '처리중'}</>
                : <><MapPin size={10} />매칭{totalNoCoord > 0 ? ` ${totalNoCoord}` : ' ✓'}</>
              }
            </button>
            <button
              onClick={() => setShowCoordBrush(true)}
              title="잘못 찍힌 좌표를 지도나 목록에서 오류로 지정하고, 삭제 또는 삭제 후 즉시 재매칭합니다"
              className="px-2 py-1 bg-[#0d1a1a] border border-cyan-600/40 text-cyan-400 hover:bg-cyan-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <Eraser size={10} /> 오류지정
            </button>
          </div>

          {/* ── 그룹 3: 분석 ─────────────────────────────────────────── */}
          <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
            <span className="text-[8px] text-gray-700 font-black tracking-widest mr-1">분석</span>
            <button
              onClick={handleRunMapAnalysis}
              title="도로 좌우·혼재·외곽지·대형단지를 분석해 작업 후보를 보여줍니다"
              className={`px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 border transition-colors ${
                showMapAnalysis
                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                  : 'bg-[#0d1a14] border-emerald-600/30 text-emerald-400 hover:bg-emerald-900/20'
              }`}
            >
              <Search size={10} /> 지도 분석
            </button>
            {overlapCount > 0 && (
              <button
                onClick={handleResolveOverlap}
                title="아파트/동일주소 묶음을 유지한 채 권역 안에 섞인 배송지만 보정합니다"
                className="px-2 py-1 bg-red-950/70 border border-red-500/50 rounded-lg text-red-300 text-[10px] font-black hover:bg-red-900/60 transition-colors"
              >
                혼재 {overlapCount.toLocaleString()}
              </button>
            )}
          </div>

          {/* ── 그룹 4: 배정·순번 ───────────────────────────────────── */}
          <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
            <span className="text-[8px] text-gray-700 font-black tracking-widest mr-1">배정</span>
            <button
              onClick={() => { setIsAssignmentLocked(v => !v); showToast('info', isAssignmentLocked ? '🔓 기사 배치 잠금 해제' : '🔒 기사 배치 잠금 — 자동배정/이전달 승계 차단'); }}
              title={isAssignmentLocked ? '기사 배치 잠금 해제 — 자동배정·초기화 허용' : '기사 배치 잠금 — 브러시 보정 결과를 보호합니다'}
              className={`px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 border transition-colors ${isAssignmentLocked ? 'bg-amber-900/60 border-amber-500/70 text-amber-300 shadow-[0_0_6px_rgba(245,158,11,0.4)]' : 'bg-[#111] border-[#2a2a2a] text-gray-500 hover:text-amber-400 hover:border-amber-600/40'}`}
            >
              {isAssignmentLocked ? '잠금중' : '잠금'}
            </button>
            <button
              onClick={handleAutoSequence}
              title="표준주소·도로 좌우·아파트 묶음 기준으로 기사별 배송 순번을 자동 부여합니다"
              className="px-2 py-1 bg-[#0d1520] border border-purple-500/30 text-purple-400 hover:bg-purple-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <Navigation2 size={10} /> 순번
            </button>
            {/* 일자 분할 — 수량 많으면 지역(동)별로 여러 날로 나눔(형 지시 2026-07-23) */}
            <div className="relative">
              <button
                onClick={() => setDaySplitOpen(v => !v)}
                title="수량이 많을 때 지역(동)별로 묶어 여러 날로 나눕니다. 같은 동은 안 쪼갭니다."
                className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-colors ${daySplitOpen || daySplitSummary ? 'bg-teal-900/40 border-teal-500/50 text-teal-300' : 'bg-[#0d1a1a] border-teal-500/25 text-teal-400 hover:bg-teal-900/20'}`}
              >
                <Clock size={10} /> 일자분할{daySplitSummary ? `·${daySplitSummary.length}일` : ''}
              </button>
              {daySplitOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 w-64 bg-[#0b1220] border border-teal-500/40 rounded-xl p-3 shadow-2xl">
                  <div className="text-[10px] font-black text-teal-300 mb-2">📅 배송 일자 분할</div>
                  <div className="grid grid-cols-3 gap-1 mb-2">
                    <button onClick={() => { setDaySplitMode('load'); setDaySplitVal('500'); }} className={`py-1 rounded text-[10px] font-bold border ${daySplitMode === 'load' ? 'bg-teal-600 text-white border-teal-500' : 'bg-[#111] text-gray-400 border-[#2a2a2a]'}`}>하루 물량</button>
                    <button onClick={() => { setDaySplitMode('days'); setDaySplitVal('2'); }} className={`py-1 rounded text-[10px] font-bold border ${daySplitMode === 'days' ? 'bg-teal-600 text-white border-teal-500' : 'bg-[#111] text-gray-400 border-[#2a2a2a]'}`}>날짜 개수</button>
                    <button onClick={() => { setDaySplitMode('seq'); setDaySplitVal('100'); }} title="배송순번 순서대로 하루 가구수만큼 끊어 나눔(순번이 곧 동선)" className={`py-1 rounded text-[10px] font-bold border ${daySplitMode === 'seq' ? 'bg-teal-600 text-white border-teal-500' : 'bg-[#111] text-gray-400 border-[#2a2a2a]'}`}>순번 구간</button>
                  </div>
                  <div className="flex items-center gap-1 mb-2">
                    <input type="number" min="1" value={daySplitVal} onChange={e => setDaySplitVal(e.target.value)}
                      className="flex-1 bg-[#111] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white outline-none focus:border-teal-500" />
                    <span className="text-[10px] text-gray-500">{daySplitMode === 'days' ? '일로' : daySplitMode === 'seq' ? '가구/일' : '포/일'}</span>
                    <button onClick={handleDaySplit} className="px-3 py-1 bg-teal-500 text-white rounded text-[10px] font-black hover:bg-teal-400">분할</button>
                  </div>
                  {daySplitSummary && (
                    <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                      {daySplitSummary.map(s => (
                        <div key={s.day} className="flex items-center justify-between text-[10px] bg-black/30 rounded px-2 py-1">
                          <span className="text-teal-300 font-bold">{s.day}일차</span>
                          <span className="text-gray-400">{s.count}가구·{s.load}포·동{s.dongs.length}</span>
                        </div>
                      ))}
                      <p className="text-[9px] text-gray-600 mt-1">각 날짜 안에서 [순번] 버튼으로 방문순서를 매기세요.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* 관리자 AI순번(DS-6)은 결과가 불안정해 2026-08 부터 쓰지 않는다 — 죽은 코드는 2026-08-23 점검에서 제거했다(엔진에는 남아 있다) */}
            <button
              onClick={handleRunSequenceAnalysis}
              title="배송순번의 점프·도보 후보·좌표 없음·도로 재방문을 분석합니다"
              className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-colors ${
                showSequenceAnalysis
                  ? 'bg-violet-500/15 border-violet-400/40 text-violet-300'
                  : 'bg-[#140d20] border-violet-500/25 text-violet-400 hover:bg-violet-900/20'
              }`}
            >
              <Search size={10} /> 분석
            </button>
            <button
              onClick={() => setMapType(t => t === 'hybrid' ? 'roadmap' : 'hybrid')}
              title="배경지도를 위성사진으로 전환(카카오 하이브리드)"
              className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-colors ${
                mapType === 'hybrid'
                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                  : 'bg-[#0d1a14] border-emerald-500/25 text-emerald-400 hover:bg-emerald-900/20'
              }`}
            >
              <Satellite size={10} /> 위성
            </button>
            <button
              onClick={() => {
                // 보던 자리를 그대로 3D 로 연다 — 다시 찾아가게 만들지 않는다.
                const c = kakaoMapRef.current?.getCenter?.();
                const first = filteredRecords.find(r => r._lat && r._lng);
                setView3DTarget(
                  c ? { lat: c.getLat(), lng: c.getLng(), name: activeDong || '지도 중심' }
                    : first ? {
                      lat: Number(first._lat), lng: Number(first._lng),
                      name: first.이름 || '', addr: first.주소 || '',
                    } : null,
                );
                setShow3D(v => !v);
              }}
              title="V월드 3D 입체 지도 — 건물 높이·단지 배치를 눈으로 확인(카카오맵은 기울기 미지원)"
              className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-colors ${
                show3D
                  ? 'bg-sky-500/15 border-sky-400/40 text-sky-300'
                  : 'bg-[#0d1620] border-sky-500/25 text-sky-400 hover:bg-sky-900/20'
              }`}
            >
              <Box size={10} /> 3D
            </button>
            <button
              onClick={() => setShowCadastral(v => !v)}
              title="지적편집도(필지 경계) 오버레이 표시"
              className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-colors ${
                showCadastral
                  ? 'bg-amber-500/15 border-amber-400/40 text-amber-300'
                  : 'bg-[#1a160d] border-amber-500/25 text-amber-400 hover:bg-amber-900/20'
              }`}
            >
              <Grid3x3 size={10} /> 지적도
            </button>
            <button
              onClick={toggleCompletionCompare}
              disabled={isLoadingCompletions}
              title="기사앱 배송완료 GPS와 배송지 동별좌표의 오차를 지도에 선으로 표시"
              className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-colors disabled:opacity-40 ${
                showCompletionCompare
                  ? 'bg-teal-500/15 border-teal-400/40 text-teal-300'
                  : 'bg-[#0d1a18] border-teal-500/25 text-teal-400 hover:bg-teal-900/20'
              }`}
            >
              <Crosshair size={10} /> {isLoadingCompletions ? '로딩…' : '완료비교'}
            </button>
            <button
              onClick={openAccuracyView}
              disabled={isLoadingCompletions}
              title="배송 정확도 분석화면(오차 순위·평균·이상 건수) 열기"
              className="px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-colors disabled:opacity-40 bg-[#0d1a18] border-teal-500/25 text-teal-400 hover:bg-teal-900/20"
            >
              <Target size={10} /> 정확도
            </button>
            <button
              onClick={handleClearSequence}
              title="전체 배송순번을 지워 새로 지정할 수 있게 합니다"
              className="px-2 py-1 bg-[#1a0d0d] border border-red-700/30 text-red-400 hover:bg-red-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <X size={10} /> 초기화
            </button>
          </div>

          {/* ── 그룹 5: 레이아웃 ─────────────────────────────────────── */}
          <div className="flex rounded-xl overflow-hidden border border-[#2a2a2a]">
            <button onClick={() => setLayoutMode('map')} title="지도만 표시"
              className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors ${layoutMode === 'map' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <MapIcon size={11} />
            </button>
            <button onClick={() => setLayoutMode('split')} title="지도 + 목록 분할"
              className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors border-x border-[#2a2a2a] ${layoutMode === 'split' || layoutMode === 'mapfull' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <Columns size={11} />
            </button>
            <button onClick={() => setLayoutMode('list')} title="목록만 표시 (좌측 패널 포함)"
              className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors border-r border-[#2a2a2a] ${layoutMode === 'list' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <List size={11} />
            </button>
            <button onClick={() => setLayoutMode('listfull')} title="목록 전체화면 — 넓게 펼쳐서 작업"
              className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors ${layoutMode === 'listfull' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <Maximize2 size={11} />
            </button>
          </div>

          {/* ── 그룹 4: 내보내기 ─────────────────────────────────────── */}
          <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
            {/* 내보내기·공유 통합 드롭다운 (KML·담당자엑셀·배송루트·공유) */}
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(v => !v)}
                title="KML 경로·담당자 엑셀·배송루트 묶음·기사 공유 링크를 한 곳에서 내보냅니다"
                className="px-2 py-1 bg-[#0d1a0d] border border-emerald-600/40 text-emerald-400 hover:bg-emerald-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
              >
                {isCreatingShare ? <RefreshCw size={10} className="animate-spin" /> : <Download size={10} />}
                내보내기 <span className="text-[8px] leading-none">▾</span>
              </button>
              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                  <div className="absolute right-0 mt-1 z-50 bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl p-1 shadow-2xl min-w-[152px]">
                    <button onClick={() => { setShowExportMenu(false); handleDownloadKML(); }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-emerald-400 hover:bg-emerald-900/20 flex items-center gap-1.5 transition-colors">
                      <Download size={11} /> KML 경로
                    </button>
                    <button onClick={() => { setShowExportMenu(false); handleExportDriverExcel(); }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-blue-400 hover:bg-blue-900/20 flex items-center gap-1.5 transition-colors">
                      <FileSpreadsheet size={11} /> 담당자 엑셀
                    </button>
                    <button onClick={() => { setShowExportMenu(false); handleDownloadRouteBundle(); }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-blue-400 hover:bg-blue-900/20 flex items-center gap-1.5 transition-colors">
                      <Download size={11} /> 배송루트 묶음
                    </button>
                    {/* ★사용일정(마감일) — 이 날짜가 접근 가능 기간의 천장이다(계획 Phase 3).
                        접속해도 이 날을 넘겨 연장되지 않는다. 공유 문서에는 대상자
                        이름·주소·휴대폰이 담기므로 기간이 길수록 노출 창이 길어진다. */}
                    <div className="px-2.5 pt-1.5 pb-1 border-t border-[#1f1f1f] mt-1"
                      onClick={e => e.stopPropagation()}>
                      <div className="text-[9px] font-bold text-gray-500 mb-1">공유 마감일 (최대 {MAX_DEADLINE_DAYS}일)</div>
                      <input type="date" value={shareDeadline}
                        onChange={e => setShareDeadline(e.target.value)}
                        className="w-full bg-black/40 border border-[#2a2a2a] focus:border-green-500/50 rounded px-1.5 py-1 text-[11px] text-white outline-none font-bold" />
                    </div>
                    <button onClick={() => { setShowExportMenu(false); handleCreateShareLink(); }}
                      disabled={isCreatingShare}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-green-400 hover:bg-green-900/20 flex items-center gap-1.5 transition-colors disabled:opacity-50">
                      <Share2 size={11} /> 기사 공유 링크 <span className="text-[9px] text-gray-500 font-normal">(암호 입력)</span>
                    </button>
                  </div>
                </>
              )}
            </div>
            {isCloudMode && (
              <button
                onClick={handleLoadOrderApplyRequests}
                disabled={isLoadingOrderRequests}
                title="기사가 요청한 순번을 조회하고, 유선 확인 후 공식 명단에 반영합니다"
                className="px-2 py-1 bg-amber-950/35 border border-amber-600/45 text-amber-300 hover:bg-amber-900/35 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {isLoadingOrderRequests ? <RefreshCw size={10} className="animate-spin" /> : <Clock size={10} />}
                순번요청
              </button>
            )}
          </div>

          {/* ── 그룹 5: 최종 저장 + 닫기 ────────────────────────────── */}
          {isCloudMode ? (
            <button
              onClick={() => handleSaveSession(true)}
              disabled={isSavingSession}
              title="현재 동의 기사배정을 이번달 명단·기본명단에 즉시 반영하고 그 동을 확정합니다"
              className="px-3 py-1.5 bg-[#1a2e1a] text-[#3b82f6] border border-[#3b82f6]/50 hover:bg-[#3b82f6]/20 rounded-xl text-xs font-black flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              {isSavingSession ? <><RefreshCw size={12} className="animate-spin" />저장중...</> : <><Save size={12} />{activeDong ? '이 동 저장·확정' : '저장·확정'}</>}
            </button>
          ) : (
            <button
              onClick={handleSave}
              title="현재 배정 현황을 저장합니다"
              className="px-3 py-1.5 bg-[#1a2e1a] text-[#3b82f6] border border-[#3b82f6]/40 hover:bg-[#3b82f6]/20 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors"
            >
              <Save size={12} /> 저장
            </button>
          )}
          <button onClick={onClose} title="닫기" className="p-2 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white border border-red-700/40 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── 바디 ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 relative">

        {/* 좌측 패널 — mapfull / listfull 모드에서 숨김 */}
        <div className={`w-56 shrink-0 bg-[#070707] border-r border-[#1a1a1a] flex flex-col overflow-hidden ${layoutMode === 'mapfull' || layoutMode === 'listfull' ? 'hidden' : ''}`}>

          {/* 행정동 큐 네비게이터 */}
          <div className="p-2 border-b border-[#1a1a1a]">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[8px] text-gray-600 font-black tracking-widest uppercase">행정동 작업 큐</div>
              <div className="text-[8px] text-gray-700">
                <span className="text-emerald-400 font-black">{filteredQty}포</span> · 미배정 <span className={unassigned > 0 ? 'text-amber-500' : 'text-emerald-400'}>{unassigned}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 mb-1">
              <button
                onClick={() => handleDongNavigate(activeDongIndex - 1)}
                disabled={activeDongIndex === 0}
                className="w-6 h-6 flex items-center justify-center bg-[#111] border border-[#2a2a2a] rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xs"
              >‹</button>
              <div className="flex-1 text-center px-1">
                <div className="text-white text-[11px] font-black leading-tight truncate">
                  {activeDong || (dongQueue.length ? dongQueue[0] : '—')}
                  {isDirty && <span className="ml-1 text-amber-400 text-[8px]">●</span>}
                </div>
                <div className="text-[8px] text-gray-600">
                  {dongQueue.length ? `${activeDongIndex + 1} / ${dongQueue.length} 동` : '로드 전'}
                  {completedDongs.size > 0 && <span className="ml-1 text-emerald-500">{completedDongs.size}완료</span>}
                </div>
              </div>
              <button
                onClick={() => handleDongNavigate(activeDongIndex + 1)}
                disabled={!dongQueue.length || activeDongIndex >= dongQueue.length - 1}
                className="w-6 h-6 flex items-center justify-center bg-[#111] border border-[#2a2a2a] rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xs"
              >›</button>
              {/* 현재 동 큐에서 제외 */}
              {activeDong && dongQueue.length > 1 && (
                <button
                  onClick={() => handleRemoveDongFromQueue(activeDong)}
                  title={`${activeDong} 큐에서 제외`}
                  className="w-6 h-6 flex items-center justify-center bg-[#111] border border-[#2a2a2a] rounded text-gray-600 hover:text-red-400 hover:border-red-800/50 disabled:opacity-30 text-xs transition-colors"
                >✕</button>
              )}
            </div>
            {/* 동 목록 드롭다운 — 직접 이동 */}
            {dongQueue.length > 0 && (
              <select
                value={activeDong || ''}
                onChange={e => {
                  const idx = dongQueue.indexOf(e.target.value);
                  if (idx >= 0) handleDongNavigate(idx);
                }}
                className="w-full bg-[#111] text-white text-[10px] border border-[#2a2a2a] rounded px-2 py-1 focus:outline-none focus:border-emerald-500/40 mb-1"
              >
                {dongQueue.map((d, i) => (
                  <option key={d} value={d}>
                    {completedDongs.has(d) ? '✓ ' : ''}{d} ({dongCounts[d] || 0}건){i === activeDongIndex ? ' ◀' : ''}
                  </option>
                ))}
              </select>
            )}
            {/* 제외된 동 다시 추가 */}
            {(() => {
              const allDongs = [...new Set(records.map(r => getRouteDong(r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
              const excluded = allDongs.filter(d => !dongQueue.includes(d));
              if (!excluded.length) return null;
              return (
                <select
                  value=""
                  onChange={e => { if (e.target.value) handleAddDongToQueue(e.target.value); }}
                  className="w-full bg-[#0a1a0a] text-emerald-400 text-[10px] border border-emerald-900/40 rounded px-2 py-1 focus:outline-none focus:border-emerald-500/40 mb-1"
                >
                  <option value="">+ 제외된 동 추가…</option>
                  {excluded.map(d => (
                    <option key={d} value={d}>{d} ({dongCounts[d] || 0}건)</option>
                  ))}
                </select>
              );
            })()}
            <div className="mt-0.5 text-[8px] text-gray-700">{filteredRecords.length}건 · 좌표 {mapRecords.length}건</div>
          </div>

          {/* 자동 배정 */}
          <div className="p-2 border-b border-[#1a1a1a]">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[8px] text-gray-600 font-black tracking-widest uppercase">자동 배정</div>
              <span className="text-[8px] text-gray-700">임대·계단 반영</span>
            </div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <button onClick={() => setDriverCount(c => Math.max(1, c - 1))}
                className="w-7 h-7 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-gray-400 hover:text-white flex items-center justify-center shrink-0">
                <Minus size={11} />
              </button>
              <span className="w-10 text-center text-white font-black text-sm shrink-0">{driverCount}명</span>
              <button onClick={() => setDriverCount(c => Math.min(8, c + 1))}
                className="w-7 h-7 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-gray-400 hover:text-white flex items-center justify-center shrink-0">
                <Plus size={11} />
              </button>
              <button
                onClick={handleAutoSplit}
                disabled={isSplitting || totalWithCoord === 0 || (totalNoCoord > 0 && !hasRunGeocoding)}
                title={totalNoCoord > 0 && !hasRunGeocoding ? `좌표 없는 ${totalNoCoord}건 있음 — 먼저 [좌표 매칭]을 실행하세요 (R-B)` : ''}
                className="flex-1 h-7 bg-[#3b82f6]/15 border border-[#3b82f6]/25 text-[#3b82f6] rounded text-[10px] font-bold hover:bg-[#3b82f6]/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1 transition-colors">
                {isSplitting ? <><RefreshCw size={10} className="animate-spin" /> 배정</>
                  : totalNoCoord > 0 && !hasRunGeocoding ? <><AlertCircle size={10} className="text-amber-400" /> 좌표</>
                  : <><Navigation2 size={10} /> 자동</>}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button onClick={handleResetAssignments}
                className="py-1 bg-[#111] border border-[#333] text-gray-600 rounded text-[9px] font-bold hover:text-red-400 hover:border-red-800/50 flex items-center justify-center gap-1 transition-colors">
                <X size={9} /> 초기화
              </button>
              <button onClick={handleLoadLastMonth}
                className="py-1 bg-[#111] border border-[#2a2a2a] text-gray-500 rounded text-[9px] font-bold hover:text-gray-300 hover:border-[#3a3a3a] flex items-center justify-center gap-1 transition-colors">
                <Clock size={9} /> 지난달
              </button>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[8px] text-gray-600 shrink-0">배분 전략</span>
              <select
                value={['dongGroup', 'hilbert'].includes(autoSplitStrategy) ? autoSplitStrategy : 'dongGroup'}
                onChange={e => setAutoSplitStrategy(e.target.value)}
                className="flex-1 h-5 bg-[#111] border border-[#2a2a2a] text-gray-400 rounded text-[8px] px-1 cursor-pointer"
              >
                <option value="dongGroup">자동 (핀 전체 / 없으면 경계)</option>
                <option value="hilbert">힐베르트 곡선</option>
              </select>
            </div>
          </div>

          {/* ── 지도/배정 분석 안내 ─────────────────────────────────── */}
          <div className="p-2 border-b border-[#1a1a1a] bg-[#07110f]">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[8px] text-emerald-400 font-black tracking-widest uppercase">지도 분석</div>
              <button
                onClick={handleRunMapAnalysis}
                className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[8px] font-black hover:bg-emerald-500/25 transition-colors"
              >
                분석 실행
              </button>
            </div>

            <div className="grid grid-cols-4 gap-1 mb-1.5">
              <button
                onClick={() => focusAnalysisRecords(mapInsights.mixedRecords.map(r => r.id), '혼재 의심')}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${mapInsights.mixedCount ? 'bg-red-950/35 border-red-500/35 text-red-300 hover:bg-red-900/35' : 'bg-black/30 border-emerald-900/30 text-emerald-500'}`}
              >
                <div className="text-[10px] font-black tabular-nums">{mapInsights.mixedCount}</div>
                <div className="text-[8px] font-bold">혼재</div>
              </button>
              <button
                onClick={() => focusAnalysisRecords(mapInsights.mixedRoads[0]?.recordIds || [], '도로 분산')}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${mapInsights.mixedRoads.length ? 'bg-amber-950/35 border-amber-500/35 text-amber-300 hover:bg-amber-900/35' : 'bg-black/30 border-emerald-900/30 text-emerald-500'}`}
              >
                <div className="text-[10px] font-black tabular-nums">{mapInsights.mixedRoads.length}</div>
                <div className="text-[8px] font-bold">도로</div>
              </button>
              <button
                onClick={() => focusAnalysisRecords(mapInsights.isolatedUnits.flatMap(unit => unit.ids), '외곽 고립')}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${mapInsights.isolatedUnits.length ? 'bg-blue-950/35 border-blue-500/35 text-blue-300 hover:bg-blue-900/35' : 'bg-black/30 border-emerald-900/30 text-emerald-500'}`}
              >
                <div className="text-[10px] font-black tabular-nums">{mapInsights.isolatedUnits.length}</div>
                <div className="text-[8px] font-bold">외곽</div>
              </button>
              <button
                onClick={() => largeAptComplexes[0] ? openAptMultiModal(largeAptComplexes[0].aptKey) : showToast('info', '대형단지 후보가 없습니다.')}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${largeAptComplexes.length ? 'bg-orange-950/35 border-orange-500/35 text-orange-300 hover:bg-orange-900/35' : 'bg-black/30 border-emerald-900/30 text-emerald-500'}`}
              >
                <div className="text-[10px] font-black tabular-nums">{largeAptComplexes.length}</div>
                <div className="text-[8px] font-bold">단지</div>
              </button>
            </div>

            {showMapAnalysis && (
              <div className="max-h-20 overflow-y-auto pr-1 space-y-1 scrollbar-thin">
                <div className="space-y-1">
                  {mapInsights.actions.slice(0, 2).map((msg, idx) => (
                    <div key={idx} className="text-[8px] text-gray-500 leading-relaxed">• {msg}</div>
                  ))}
                </div>

                {mapInsights.mixedRoads.length > 0 && (
                  <div className="space-y-1">
                    {mapInsights.mixedRoads.slice(0, 2).map(road => (
                      <button
                        key={road.key}
                        onClick={() => focusAnalysisRecords(road.recordIds, road.label)}
                        className="w-full flex items-center justify-between gap-2 text-[8px] bg-black/30 hover:bg-amber-950/25 border border-amber-900/20 rounded px-2 py-1 transition-colors"
                      >
                        <span className="text-gray-300 truncate">{road.label}</span>
                        <span className="text-amber-400 font-black shrink-0">{road.qty}포 · {road.driverCount}기사</span>
                      </button>
                    ))}
                  </div>
                )}

                {routeAnalysis?.qualityScore !== undefined && (
                  <div className="mb-1.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[8px] text-gray-600 font-black tracking-widest">배정 품질</div>
                      <span className="text-[8px] text-gray-500">
                        {{ hilbert: '힐베르트 곡선', seedVoronoi: '핀 전체 기준', dongGroup: '자동 경계' }[routeAnalysis?.strategy] || '자동 경계'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`text-[22px] font-black tabular-nums leading-none ${routeAnalysis.qualityScore >= 80 ? 'text-emerald-400' : routeAnalysis.qualityScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                        {routeAnalysis.qualityScore}
                      </div>
                      <div className="flex-1">
                        <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${routeAnalysis.qualityScore >= 80 ? 'bg-emerald-500' : routeAnalysis.qualityScore >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${routeAnalysis.qualityScore}%` }}
                          />
                        </div>
                        <div className="text-[7px] text-gray-600 mt-0.5">점 / 100점</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <div className="rounded bg-black/30 border border-gray-800/50 px-1 py-0.5 text-center">
                        <div className={`text-[9px] font-black tabular-nums ${(routeAnalysis.splitUnitCount || 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{routeAnalysis.splitUnitCount ?? 0}</div>
                        <div className="text-[7px] text-gray-600">분리단지</div>
                      </div>
                      <div className="rounded bg-black/30 border border-gray-800/50 px-1 py-0.5 text-center">
                        <div className={`text-[9px] font-black tabular-nums ${(routeAnalysis.islandCount || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{routeAnalysis.islandCount ?? 0}</div>
                        <div className="text-[7px] text-gray-600">고립구역</div>
                      </div>
                      <div className="rounded bg-black/30 border border-gray-800/50 px-1 py-0.5 text-center">
                        <div className={`text-[9px] font-black tabular-nums ${(routeAnalysis.mixedUnitCount || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{routeAnalysis.mixedUnitCount ?? 0}</div>
                        <div className="text-[7px] text-gray-600">혼재유닛</div>
                      </div>
                    </div>
                  </div>
                )}

                {routeAnalysis && routeAnalysis.load?.stats?.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[8px] text-gray-600 font-black tracking-widest">기사별 부담</div>
                      <span className={`text-[8px] font-black ${routeAnalysis.load?.maxAbsDiffPct > 25 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        최대 편차 {routeAnalysis.load?.maxAbsDiffPct ?? 0}%
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {(routeAnalysis.load?.stats || []).slice(0, 2).map(stat => (
                        <div key={stat.driverId} className="rounded-md bg-black/35 border border-emerald-900/30 px-1.5 py-1">
                          <div className="text-[9px] text-white font-bold truncate">{stat.driverName}</div>
                          <div className="text-[8px] text-gray-500 tabular-nums">
                            {stat.qty}포 · 부담 {stat.load}/{stat.targetLoad}
                          </div>
                          <div className={`text-[8px] font-black ${Math.abs(stat.diffPct) > 25 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {stat.diffPct > 0 ? '+' : ''}{stat.diffPct}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 배송순번 분석 ─────────────────────────────────────── */}
          <div className="p-2 border-b border-[#1a1a1a] bg-[#0d0a16]">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[8px] text-violet-400 font-black tracking-widest uppercase">순번 분석</div>
              <button
                onClick={handleRunSequenceAnalysis}
                className="px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[8px] font-black hover:bg-violet-500/25 transition-colors"
              >
                분석 실행
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1 mb-1.5">
              <button
                onClick={() => {
                  const ids = (sequenceAnalysis?.driverStats || []).flatMap(stat => stat.jumpIds || []);
                  focusAnalysisRecords(ids, '순번 점프');
                }}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${
                  (sequenceAnalysis?.driverStats || []).some(stat => stat.jumpCount > 0)
                    ? 'bg-red-950/35 border-red-500/35 text-red-300 hover:bg-red-900/35'
                    : 'bg-black/30 border-violet-900/30 text-violet-400'
                }`}
              >
                <div className="text-[10px] font-black tabular-nums">{(sequenceAnalysis?.driverStats || []).reduce((s, stat) => s + stat.jumpCount, 0)}</div>
                <div className="text-[8px] font-bold">점프</div>
              </button>
              <button
                onClick={() => {
                  const ids = (sequenceAnalysis?.driverStats || []).flatMap(stat => stat.walkIds || []);
                  focusAnalysisRecords(ids, '도보 후보');
                }}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${
                  (sequenceAnalysis?.driverStats || []).some(stat => stat.walkCount > 0)
                    ? 'bg-cyan-950/35 border-cyan-500/35 text-cyan-300 hover:bg-cyan-900/35'
                    : 'bg-black/30 border-violet-900/30 text-violet-400'
                }`}
              >
                <div className="text-[10px] font-black tabular-nums">{(sequenceAnalysis?.driverStats || []).reduce((s, stat) => s + stat.walkCount, 0)}</div>
                <div className="text-[8px] font-bold">도보</div>
              </button>
              <button
                onClick={() => {
                  const ids = (sequenceAnalysis?.driverStats || []).flatMap(stat => stat.noCoordIds || []);
                  focusAnalysisRecords(ids, '좌표 없는 순번');
                }}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${
                  (sequenceAnalysis?.driverStats || []).some(stat => stat.noCoordCount > 0)
                    ? 'bg-amber-950/35 border-amber-500/35 text-amber-300 hover:bg-amber-900/35'
                    : 'bg-black/30 border-violet-900/30 text-violet-400'
                }`}
              >
                <div className="text-[10px] font-black tabular-nums">{(sequenceAnalysis?.driverStats || []).reduce((s, stat) => s + stat.noCoordCount, 0)}</div>
                <div className="text-[8px] font-bold">좌표</div>
              </button>
              <div className={`rounded-md border px-1 py-1 text-center ${
                sequenceAnalysis?.avgAccuracy >= 90
                  ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                  : sequenceAnalysis?.avgAccuracy
                  ? 'bg-orange-950/30 border-orange-500/30 text-orange-300'
                  : 'bg-black/30 border-violet-900/30 text-violet-400'
              }`}>
                <div className="text-[10px] font-black tabular-nums">{sequenceAnalysis?.avgAccuracy || 0}%</div>
                <div className="text-[8px] font-bold">정확도</div>
              </div>
            </div>
            {showSequenceAnalysis && (
              <div className="max-h-32 overflow-y-auto pr-1 space-y-1">
                {sequenceAnalysis?.strategyUsed && (
                  <div className="text-[7px] text-gray-600 pb-0.5">
                    {sequenceAnalysis.strategyUsed.road > 0 && <span className="text-violet-400">도로망 {sequenceAnalysis.strategyUsed.road}명</span>}
                    {sequenceAnalysis.strategyUsed.road > 0 && sequenceAnalysis.strategyUsed.coord > 0 && <span className="mx-1">·</span>}
                    {sequenceAnalysis.strategyUsed.coord > 0 && <span className="text-amber-400">좌표 fallback {sequenceAnalysis.strategyUsed.coord}명</span>}
                  </div>
                )}
                {(sequenceAnalysis?.driverStats || []).map(stat => (
                  <button
                    key={stat.driverId}
                    onClick={() => {
                      const ids = [...(stat.jumpIds || []), ...(stat.noCoordIds || []), ...(stat.noRoadIds || [])];
                      focusAnalysisRecords(ids, `${stat.driverName} 순번 확인`);
                    }}
                    className="w-full rounded-md bg-black/35 border border-violet-900/25 px-2 py-1 text-left hover:bg-violet-950/25 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stat.color }} />
                      <span className="text-[9px] text-white font-bold truncate flex-1">{stat.driverName}</span>
                      <span className={`text-[8px] font-black tabular-nums ${
                        stat.avgDist < 200 ? 'text-emerald-400' : stat.avgDist < 400 ? 'text-amber-400' : 'text-red-400'
                      }`}>{stat.avgDist}m</span>
                      <span className={`text-[8px] font-black tabular-nums ${stat.accuracy >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>{stat.accuracy}%</span>
                    </div>
                    <div className="mt-0.5 text-[8px] text-gray-600 flex items-center justify-between">
                      <span>총 {stat.totalDistKm}km · 약 {stat.estimatedMinutes}분 · {stat.count}건</span>
                      {(stat.jumpCount > 0 || stat.noCoordCount > 0) && (
                        <span className="text-amber-500">점프 {stat.jumpCount}{stat.noCoordCount > 0 ? ` · 좌표없음 ${stat.noCoordCount}` : ''}</span>
                      )}
                    </div>
                  </button>
                ))}
                {!(sequenceAnalysis?.driverStats || []).length && (
                  <div className="text-[8px] text-gray-600 leading-relaxed">순번 실행 후 분석하면 기사별 이동거리·정확도가 표시됩니다.</div>
                )}
              </div>
            )}
          </div>

          {/* ── 2차 보정: 페인트 브러시 ─────────────────────────────── */}
          <div className="order-5 px-2 py-2 border-t border-[#1a1a1a]">
            <button
              onClick={() => {
                const next = !isPaintMode;
                setIsPaintMode(next);
                if (paintRafRef.current) { cancelAnimationFrame(paintRafRef.current); paintRafRef.current = 0; }
                isPaintingRef.current = false;
                // 브러시 ON → 지도 드래그 잠금, OFF → 복원
                if (kakaoMapRef.current) kakaoMapRef.current.setDraggable(!next);
              }}
              className={`w-full py-1 rounded text-[9px] font-black flex items-center justify-center gap-1 transition-all border ${
                isPaintMode
                  ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.25)]'
                  : 'bg-[#111] border-[#2a2a2a] text-gray-500 hover:text-amber-400 hover:border-amber-700/40'
              }`}>
              {isPaintMode ? '브러시 ON (Esc)' : '브러시 보정'}
            </button>
            {isPaintMode && (
              <div className="mt-1.5 space-y-1.5 max-h-28 overflow-y-auto pr-1">
                {/* 기사 색상 선택 */}
                <div className="flex flex-wrap gap-1">
                  {drivers.map(d => (
                    <button key={d.id}
                      onClick={() => setPaintDriverId(d.id)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold transition-all border"
                      style={{
                        borderColor: paintDriverId === d.id ? d.color : 'transparent',
                        background: paintDriverId === d.id ? `${d.color}30` : '#111',
                        color: paintDriverId === d.id ? d.color : '#6b7280',
                        boxShadow: paintDriverId === d.id ? `0 0 8px ${d.color}50` : 'none',
                      }}>
                      <div className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                      {d.name}
                    </button>
                  ))}
                </div>
                {/* 브러시 크기 */}
                <div className="flex gap-1">
                  {[['소', 30], ['중', 60], ['대', 100], ['특대', 160]].map(([label, px]) => (
                    <button key={label}
                      onClick={() => setPaintRadiusPx(px)}
                      className={`flex-1 py-0.5 rounded text-[9px] font-bold border transition-colors ${
                        paintRadiusPx === px ? 'bg-amber-500/20 border-amber-400/40 text-amber-300' : 'bg-[#111] border-[#222] text-gray-600 hover:text-gray-400'
                      }`}>{label}</button>
                  ))}
                </div>
                {paintDriverId
                  ? <div className="text-[8px] text-amber-400/80 text-center">지도 위에서 드래그하여 구역 칠하기</div>
                  : <div className="text-[8px] text-gray-600 text-center">↑ 기사를 먼저 선택하세요</div>
                }
              </div>
            )}
          </div>

          {/* ── 대형 아파트/임대단지 배정 ───────────────────────────── */}
          {largeAptComplexes.length > 0 && (
            <div className="order-6 px-2 py-2 border-t border-[#1a1a1a]">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[8px] text-gray-600 font-black tracking-widest uppercase">대형단지</div>
                <span className="text-[9px] text-orange-400 font-bold">{largeAptComplexes.length}개</span>
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                {largeAptComplexes.slice(0, 4).map(({ aptKey, aptName, totalQty, rentalDetected, buildingCount }) => (
                  <div key={aptKey} className="flex items-center gap-1.5 bg-[#111] border border-orange-700/20 rounded-lg px-1.5 py-1">
                    <Building2 size={10} className="text-orange-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[9px] text-white font-bold truncate">{aptName}</div>
                      <div className="flex items-center gap-1 text-[8px]">
                        <span className="text-orange-400">{totalQty}포</span>
                        {buildingCount > 0 && <span className="text-gray-600">· {buildingCount}개 동</span>}
                        <span className={rentalDetected ? 'text-emerald-400' : 'text-amber-500'}>
                          · {rentalDetected ? '임대감지' : '대형단지'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => openAptMultiModal(aptKey)}
                      className="shrink-0 px-1.5 py-0.5 bg-orange-500/20 border border-orange-400/40 text-orange-300 rounded text-[8px] font-bold hover:bg-orange-500/30 transition-colors"
                    >
                      분할
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 기사 목록 */}
          <div className="order-4 flex-1 min-h-0 overflow-y-auto p-2">
            <div className="flex items-center justify-between mb-1.5 sticky top-0 bg-[#070707]/95 z-10 pb-1">
              <div className="text-[9px] text-gray-600 font-black tracking-widest uppercase">기사 목록</div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={openDriverSwapModal}
                  title="두 기사에게 배정된 구역 전체를 서로 맞바꿉니다"
                  className="text-[9px] px-1.5 py-0.5 rounded border font-bold transition-colors bg-[#111] border-[#222] text-cyan-400 hover:border-cyan-500/40 hover:bg-cyan-950/20 flex items-center gap-0.5"
                >
                  <ArrowLeftRight size={9} /> 교체
                </button>
                <button onClick={() => setScheduleMode(v => !v)}
                  className={`text-[9px] px-1.5 py-0.5 rounded border font-bold transition-colors ${scheduleMode ? 'bg-purple-900/30 border-purple-500/40 text-purple-400' : 'bg-[#111] border-[#222] text-gray-600 hover:text-gray-400'}`}>
                  일정
                </button>
                <button
                  onClick={() => {
                    // 지도에서 선택된 동을 모달에 반영 ('전체'거나 비어있으면 첫 번째 동으로)
                    const initDong = (selectedDong && selectedDong !== '전체')
                      ? selectedDong
                      : (dongList[0] || '');
                    setPickerDong(initDong);
                    setPickerSelectedName('');
                    setShowCompanyPicker(true);
                  }}
                  disabled={drivers.length >= 8}
                  title="소속사 기사 추가 — 이사·외곽 레코드를 다른 기사에게 배정할 때 사용"
                  className="text-[10px] text-[#3b82f6] hover:text-[#93c5fd] disabled:text-gray-700 flex items-center gap-0.5">
                  <Plus size={10} /> 추가
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <button onClick={() => setSelectedDriverFilter(selectedDriverFilter === 'none' ? 'all' : 'none')}
                className={`w-full px-2 py-1.5 rounded-lg border text-left transition-colors ${selectedDriverFilter === 'none' ? 'bg-[#1a1a1a] border-gray-600' : 'bg-[#0d0d0d] border-[#1e1e1e] hover:border-[#2a2a2a]'}`}>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-600 shrink-0" />
                  <span className="text-gray-400 text-xs flex-1">미배정</span>
                  <span className="text-[10px] text-gray-600 font-bold">{unassigned}건</span>
                </div>
              </button>
              {hasDongSetupMapping && dongScopedDrivers.filter(d => !d.isExternal).length === 0 && (
                <div className="px-2 py-2.5 text-center text-[10px] text-gray-600 border border-dashed border-[#262626] rounded-lg">
                  이 동에 배정된 기사 없음
                  <div className="text-[9px] text-gray-700 mt-0.5">[추가]로 기사를 배정하거나 설정에서 매핑하세요</div>
                </div>
              )}
              {dongScopedDrivers.map(d => {
                const cnt = filteredRecords.filter(r => r._driverId === d.id).length;
                const driverQty = filteredRecords.filter(r => r._driverId === d.id).reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
                const isActive = selectedDriverFilter === d.id;
                const effLoad = Math.round(records.filter(r => r._driverId === d.id).reduce((s, r) => s + getEffectiveLoad(r), 0));
                const maxLoad = Math.round(baseDailyQtyProp * (d.capacity || 100) / 100);
                const loadPct = maxLoad > 0 ? Math.min(150, Math.round(effLoad / maxLoad * 100)) : 0;
                const isOver = effLoad > maxLoad;
                const zoneNo = drivers.findIndex(dr => dr.id === d.id) + 1;
                return (
                  <div key={d.id}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer`}
                    style={{
                      borderColor: isActive ? d.color + '60' : (d.isExternal ? '#7c3aed40' : '#1e1e1e'),
                      borderStyle: d.isExternal ? 'dashed' : 'solid',
                      background: isActive ? d.color + '10' : (d.isExternal ? '#1a0a2e' : '#0d0d0d'),
                    }}
                    onClick={() => setSelectedDriverFilter(isActive ? 'all' : d.id)}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-[8px] font-black px-1 py-0.5 rounded bg-black/40 border border-white/5 text-gray-500 shrink-0">{zoneNo}구역</span>
                      <input value={d.name}
                        onChange={e => setDrivers(prev => prev.map(dr => dr.id === d.id ? { ...dr, name: e.target.value } : dr))}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 bg-transparent text-white text-xs focus:outline-none min-w-0" />
                      {d.isExternal && (
                        <span className="text-[8px] font-black px-1 py-0.5 rounded bg-purple-900/40 text-purple-400 border border-purple-500/30 shrink-0">외부</span>
                      )}
                      <span className="text-[10px] font-black shrink-0" style={{ color: d.color }}>{cnt}건{driverQty > 0 ? ` · ${driverQty}포` : ''}</span>
                      {/* 기사 핀 버튼 */}
                      <button
                        onClick={e => { e.stopPropagation(); setPlacingPinForDriver(prev => prev === d.id ? null : d.id); }}
                        title={driverPins[d.id] ? `${d.name} 핀 재설정 (우클릭으로 지도에서 삭제)` : `지도 클릭으로 ${d.name} 거점 핀 설정`}
                        className={`text-[9px] px-1 py-0.5 rounded transition-all shrink-0 ${
                          placingPinForDriver === d.id
                            ? 'bg-yellow-500/30 border border-yellow-400/60 text-yellow-300 animate-pulse'
                            : driverPins[d.id]
                            ? 'text-base leading-none'
                            : 'text-gray-700 hover:text-gray-400 border border-transparent hover:border-[#2a2a2a]'
                        }`}>
                        {driverPins[d.id] ? '📍' : <MapPin size={9} />}
                      </button>
                      <button onClick={e => { e.stopPropagation(); removeDriver(d.id); }}
                        className="text-gray-700 hover:text-red-400 transition-colors shrink-0">
                        <X size={10} />
                      </button>
                    </div>
                    {/* 유효부담 프로그레스바 */}
                    {cnt > 0 && (
                      <div className="mt-1.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[8px] text-gray-700">유효부담</span>
                          <span className={`text-[8px] font-black tabular-nums ${isOver ? 'text-red-400' : 'text-gray-500'}`}>
                            {effLoad} / {maxLoad}
                            {isOver && ' ⚠'}
                          </span>
                        </div>
                        <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(loadPct, 100)}%`,
                              background: isOver
                                ? 'linear-gradient(90deg,#b91c1c,#ef4444)'
                                : loadPct > 85
                                ? 'linear-gradient(90deg,#d97706,#f59e0b)'
                                : `linear-gradient(90deg,${d.color}99,${d.color})`,
                            }} />
                        </div>
                        {/* R-K: 평균 이동거리 */}
                        {driverAvgDist[d.id] > 0 && (
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[8px] text-gray-700">평균이동</span>
                            <span className="text-[8px] tabular-nums" style={{ color: d.color + 'bb' }}>
                              {driverAvgDist[d.id] >= 1000
                                ? `${(driverAvgDist[d.id] / 1000).toFixed(1)}km`
                                : `${driverAvgDist[d.id]}m`}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {/* 출발지 */}
                    <div className="mt-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <span className="text-[8px] text-gray-600 shrink-0 w-7">출발지</span>
                      <input
                        value={d.startAddr || ''}
                        onChange={e => setDrivers(prev => prev.map(dr =>
                          dr.id === d.id ? { ...dr, startAddr: e.target.value, startLat: null, startLng: null } : dr
                        ))}
                        onBlur={e => handleGeocodeStartAddr(d.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="출발 주소 입력"
                        className="flex-1 bg-[#111] border border-[#2a2a2a] text-[8px] text-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500/40 min-w-0 truncate"
                      />
                      <span
                        title={d.startLat ? `좌표확인 완료 (${d.startLat?.toFixed(4)}, ${d.startLng?.toFixed(4)})` : '주소 입력 후 포커스 이동 시 자동 변환'}
                        className={`text-[9px] shrink-0 font-black ${d.startLat ? 'text-emerald-400' : 'text-gray-700'}`}>
                        {d.startLat ? '✓' : '?'}
                      </span>
                    </div>
                    {/* 배송일 배정 */}
                    {scheduleMode && (
                      <div className="mt-1.5 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <span className="text-[9px] text-gray-600">배송일</span>
                        <input type="date" value={d.deliveryDate || ''}
                          onChange={e => setDrivers(prev => prev.map(dr => dr.id === d.id ? { ...dr, deliveryDate: e.target.value } : dr))}
                          className="flex-1 bg-[#111] border border-[#2a2a2a] text-[9px] text-white rounded px-1 py-0.5 focus:outline-none focus:border-purple-500/40" />
                        {d.deliveryDate && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ background: d.color + '25', color: d.color }}>
                            {d.deliveryDate.slice(5)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="order-7 px-2 py-1.5 border-t border-[#1a1a1a]">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[8px] text-gray-700 font-black tracking-widest uppercase mr-0.5">범례</span>
              <span title="주소 확인필요" className="w-2 h-2 rounded-full bg-[#ef4444]" />
              <span title="미배정" className="w-2 h-2 rounded-full bg-gray-600" />
              {drivers.map(d => (
                <span key={d.id} title={d.name} className="w-2 h-2 rounded-full" style={{ background: d.color }} />
              ))}
            </div>
          </div>
        </div>

        {/* 지도 + 목록 영역 */}
        <div className="flex-1 min-w-0 flex min-h-0">

          {/* ── 지도 영역 — 항상 마운트, layoutMode로만 표시 제어 ── */}
          <div className={
            layoutMode === 'mapfull'  ? 'absolute inset-0 z-[60] bg-[#080808] flex flex-col' :
            layoutMode === 'list'     ? 'hidden' :
            layoutMode === 'listfull' ? 'hidden' :
            layoutMode === 'map'      ? 'flex-1 flex flex-col relative' :
            /* split */                 'flex-1 flex flex-col relative min-w-0'
          }>
            {!isMapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#080808] z-10">
                <RefreshCw size={22} className="text-[#3b82f6] animate-spin" />
              </div>
            )}
            <div ref={mapRef} className="flex-1 relative"
              onDoubleClick={() => { if (!isPaintMode) setLayoutMode('mapfull'); }}
              onClick={() => { if (samePointPopup) setSamePointPopup(null); if (seqPin) setSeqPin(null); }}
              style={{ cursor: placingPinForDriver ? 'crosshair' : undefined }}
            >
              {/* ── V월드 3D 조망 — 카카오 지도 위에 덮는다(끄면 그대로 2D 로 돌아온다).
                     ⛔한 번 켠 뒤에는 DOM 을 유지한다(Vworld3DView 내부 규칙) — 재진입이 즉시다.
                     페인트 인터셉터(z-200)보다 위에 둬야 3D 중에 지도 클릭이 새지 않는다. */}
              <div className="absolute inset-0 z-[250]" style={{ pointerEvents: show3D ? 'auto' : 'none' }}>
                <Vworld3DView
                  active={show3D}
                  target={view3DTarget}
                  onExit={() => setShow3D(false)}
                />
              </div>
              {/* ── 페인트 브러시 인터셉터: 지도 위를 완전히 덮어 카카오맵 이벤트 차단 */}
              {isPaintMode && (
                <div
                  style={{ position: 'absolute', inset: 0, zIndex: 200, cursor: 'none' }}
                  onMouseMove={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    // 커서 원: state 변경 없이 DOM transform 직접 갱신 → 전체 리렌더 차단
                    const cur = paintCursorRef.current;
                    if (cur) {
                      cur.style.transform = `translate(${x - paintRadiusPx}px, ${y - paintRadiusPx}px)`;
                      cur.style.opacity = '1';
                    }
                    // 색칠: requestAnimationFrame으로 프레임당 1회만 (970+건 거리계산 폭주 방지)
                    if (isPaintingRef.current) {
                      paintLastPtRef.current = { x: e.clientX, y: e.clientY };
                      if (!paintRafRef.current) {
                        paintRafRef.current = requestAnimationFrame(() => {
                          paintRafRef.current = 0;
                          const p = paintLastPtRef.current;
                          if (p) applyPaint(p.x, p.y);
                        });
                      }
                    }
                  }}
                  onMouseDown={e => {
                    if (!paintDriverId) return;
                    e.preventDefault();
                    isPaintingRef.current = true;
                    applyPaint(e.clientX, e.clientY);
                  }}
                  onMouseUp={() => {
                    if (paintRafRef.current) { cancelAnimationFrame(paintRafRef.current); paintRafRef.current = 0; }
                    commitPaint();
                  }}
                  onMouseLeave={() => {
                    if (paintRafRef.current) { cancelAnimationFrame(paintRafRef.current); paintRafRef.current = 0; }
                    commitPaint();
                    if (paintCursorRef.current) paintCursorRef.current.style.opacity = '0';
                  }}
                >
                  {/* 브러시 커서 원 — 위치는 ref로 직접 제어, 색/크기만 React가 렌더 */}
                  {(() => {
                    const d = drivers.find(dr => dr.id === paintDriverId);
                    const color = d?.color || '#ffffff';
                    return (
                      <div ref={paintCursorRef} className="absolute top-0 left-0 pointer-events-none rounded-full"
                        style={{
                          width: paintRadiusPx * 2, height: paintRadiusPx * 2,
                          border: `2.5px solid ${color}`,
                          background: `${color}22`,
                          boxShadow: `0 0 0 1px rgba(0,0,0,0.6), 0 0 20px ${color}55`,
                          opacity: 0,
                          willChange: 'transform',
                        }}
                      />
                    );
                  })()}
                </div>
              )}
            </div>

            {/* ── 같은 좌표 팝업 ─────────────────────────────────────── */}
            {/* ★기사가 2명 이상인 동 — 자동으로 나누지 않고 담당자가 고르게 한다(형 지시 2026-08-27) */}
            {brushPrompt && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[330] pointer-events-auto">
                <div className="bg-[#0e0e0e] border border-amber-500/50 rounded-xl shadow-2xl px-3 py-2 flex items-center gap-2 max-w-[92vw]">
                  <span className="text-[11px] font-black text-amber-300 whitespace-nowrap">
                    {brushPrompt.dong} · 기사 {brushPrompt.driverIds.length}명
                  </span>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">브러쉬로 나눠 주세요</span>
                  <button type="button"
                    onClick={() => {
                      const first = brushPrompt.driverIds.find(id => drivers.some(d => d.id === id)) || null;
                      setPaintDriverId(first);
                      setIsPaintMode(true);
                      if (kakaoMapRef.current) kakaoMapRef.current.setDraggable(false);   // 브러시 중엔 지도 드래그 잠금
                      setBrushPrompt(null);
                    }}
                    className="px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-[11px] font-black text-black whitespace-nowrap">
                    브러쉬 시작
                  </button>
                  <button type="button"
                    onClick={() => { setBrushPrompt(null); handleAutoSplit(); }}
                    className="px-2 py-1 rounded-lg border border-[#2a2a2a] text-[11px] font-bold text-gray-300 hover:text-white whitespace-nowrap">
                    자동으로 나누기
                  </button>
                  <button type="button" onClick={() => setBrushPrompt(null)}
                    className="text-gray-500 hover:text-white text-[11px] px-1">✕</button>
                </div>
              </div>
            )}

            {/* ★핀에서 바로 순번 입력 — 숫자 넣고 Enter 면 그 집의 배송순번이 된다(비우고 Enter 면 지운다). */}
            {seqPin && (
              <div className="absolute z-[320] pointer-events-auto"
                style={{ left: seqPin.x, top: seqPin.y, transform: 'translate(-50%, -130%)' }}>
                <form
                  onSubmit={async (ev) => {
                    ev.preventDefault();
                    const raw = String(new FormData(ev.currentTarget).get('seq') ?? '').replace(/[^0-9]/g, '');
                    const target = records.find(r => r.id === seqPin.id);
                    const before = target?.배송순번 ?? '';
                    // ★화면부터 바꾸고(기다림 없이) 저장한다 — 실패하면 되돌리고 알린다(UI-1 ④ 낙관적 갱신).
                    setRecords(prev => prev.map(r => (r.id === seqPin.id ? { ...r, 배송순번: raw } : r)));
                    setSeqPin(null);
                    const docId = target?._cloudDocId || target?.id;
                    if (!isCloudMode || !cloudCity || !cloudMonthId || !docId) return;   // 로컬 명단은 기존처럼 저장 버튼으로
                    try {
                      await setDoc(
                        doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', docId),
                        { 배송순번: raw, 배송순번수정일시: serverTimestamp() },
                        { merge: true },
                      );
                    } catch (err) {
                      console.error('[핀 순번 저장] 실패:', err);
                      setRecords(prev => prev.map(r => (r.id === seqPin.id ? { ...r, 배송순번: before } : r)));
                      alert('순번 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
                    }
                  }}
                  className="bg-[#0e0e0e] border border-emerald-500/50 rounded-xl shadow-2xl px-3 py-2 flex items-center gap-2"
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <span className="text-[10px] font-black text-emerald-300 whitespace-nowrap max-w-[90px] overflow-hidden text-ellipsis">{seqPin.name || '순번'}</span>
                  <input
                    name="seq" autoFocus type="text" inputMode="numeric" maxLength={4}
                    defaultValue={records.find(r => r.id === seqPin.id)?.배송순번 || ''}
                    onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.preventDefault(); setSeqPin(null); } }}
                    className="w-16 bg-black/60 border border-[#2a2a2a] focus:border-emerald-500/70 rounded-lg px-2 py-1 text-center text-[13px] font-black text-white outline-none"
                    placeholder="순번"
                  />
                  <button type="submit" className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[11px] font-black text-black">확인</button>
                  <button type="button" onClick={() => setSeqPin(null)} className="text-gray-500 hover:text-white text-[11px]">✕</button>
                </form>
              </div>
            )}

            {samePointPopup && (
              <div
                className="absolute z-[300] pointer-events-auto"
                style={{ left: samePointPopup.x, top: samePointPopup.y, transform: 'translate(-50%, -110%)' }}
              >
                <div className="bg-[#0e0e0e] border border-purple-500/40 rounded-xl shadow-2xl overflow-hidden min-w-[180px] max-w-[260px]">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-purple-900/30">
                    <span className="text-[10px] font-black text-purple-300 tracking-widest uppercase">같은 위치 {samePointPopup.recs.length}명</span>
                    <button onClick={() => setSamePointPopup(null)} className="text-gray-500 hover:text-white transition-colors ml-2">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  <div className="py-1 max-h-[220px] overflow-y-auto">
                    {samePointPopup.recs.map((rec, i) => {
                      const drv = drivers.find(d => d.id === rec._driverId);
                      const qty = parseInt(rec.포수 || rec['수량(포수)']) || 1;
                      return (
                        <button
                          key={rec.id}
                          onClick={() => { setSamePointPopup(null); setLayoutMode(prev => (prev === 'map' || prev === 'mapfull') ? 'split' : prev); handleSelectRecord(rec); }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors text-left"
                        >
                          <span className="text-[10px] text-gray-500 w-4 shrink-0">{i + 1}</span>
                          <span className="text-[11px] font-bold text-white shrink-0">{rec.이름 || '-'}</span>
                          <span className="text-[10px] text-gray-400 flex-1 truncate">{(rec.주소 || '').slice(0, 20)}</span>
                          <span className="text-[10px] font-bold shrink-0" style={{ color: drv?.color || '#6b7280' }}>{qty}포</span>
                          {rec.배송순번 && <span className="text-[9px] text-gray-600 shrink-0">#{rec.배송순번}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 핀 배치 모드 안내 배너 */}
            {placingPinForDriver && (() => {
              const d = drivers.find(dr => dr.id === placingPinForDriver);
              return (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full shadow-xl pointer-events-none animate-pulse"
                  style={{ background: d?.color || '#f59e0b', boxShadow: `0 0 20px ${d?.color || '#f59e0b'}80` }}>
                  <MapPin size={13} className="text-white shrink-0" />
                  <span className="text-white text-[11px] font-black whitespace-nowrap">
                    지도를 클릭하여 [{d?.name}] 거점 핀 설정 · Esc 취소
                  </span>
                </div>
              );
            })()}

            {/* 지도 오버레이 버튼 */}
            <div className="absolute top-2 right-2 z-10 flex gap-1.5">
              {/* 이전 화면 — 매칭 방식 선택(setup match 단계)으로 돌아가기. 지도를 닫지 않음 */}
              {onBack && (
                <button
                  onClick={() => { if (isDirty && !window.confirm('저장하지 않은 배정 변경이 있습니다.\n이전 화면(매칭 방식 선택)으로 돌아가시겠습니까?\n(저장 안 한 변경은 사라집니다)')) return; onBack(buildSetupRestorePayload()); }}
                  title="이전 화면(매칭 방식 선택)으로 돌아가기"
                  className="px-2.5 py-1.5 bg-black/70 hover:bg-blue-900/60 text-white/80 hover:text-white border border-white/15 hover:border-blue-500/40 rounded-lg text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm shadow-lg transition-all"
                >
                  <ChevronLeft size={11} /> 이전 화면
                </button>
              )}
              {/* 닫기 — 지도 전체 종료(X와 동일) */}
              <button
                onClick={onClose}
                title="닫기 (지도 전체 종료)"
                className="px-2.5 py-1.5 bg-black/70 hover:bg-red-900/60 text-white/80 hover:text-white border border-white/15 hover:border-red-500/40 rounded-lg text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm shadow-lg transition-all"
              >
                <X size={11} /> 닫기
              </button>
              {/* 중심 이동 버튼 */}
              <button
                onClick={() => {
                  if (!kakaoMapRef.current) return;
                  const recs = mapRecords.length ? mapRecords : (initialBoundsRef.current ? null : null);
                  if (recs && recs.length) {
                    const b = new window.kakao.maps.LatLngBounds();
                    recs.forEach(r => b.extend(new window.kakao.maps.LatLng(r._lat, r._lng)));
                    kakaoMapRef.current.setBounds(b, 60, 60, 60, 60);
                  } else if (initialBoundsRef.current) {
                    kakaoMapRef.current.setBounds(initialBoundsRef.current, 60, 60, 60, 60);
                  }
                }}
                title="배송구역 전체 보기 (중심으로 이동)"
                className="px-2.5 py-1.5 bg-black/70 hover:bg-black/95 text-white/80 hover:text-white border border-white/15 rounded-lg text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm shadow-lg transition-all"
              >
                <Crosshair size={11} /> 전체 보기
              </button>
              {layoutMode === 'mapfull' ? (
                <button
                  onClick={() => setLayoutMode('split')}
                  className="px-2.5 py-1.5 bg-black/80 hover:bg-black text-white border border-white/20 rounded-lg text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm shadow-xl"
                >
                  <Minimize2 size={11} /> 분할보기 <span className="text-white/40 text-[9px]">Esc</span>
                </button>
              ) : (
                <button
                  onClick={() => setLayoutMode('mapfull')}
                  title="전체화면 (더블클릭도 가능)"
                  className="px-2.5 py-1.5 bg-black/70 hover:bg-black/95 text-white/80 hover:text-white border border-white/15 rounded-lg text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm shadow-lg transition-all"
                >
                  <Maximize2 size={11} /> 전체화면
                </button>
              )}
            </div>

          </div>

          {/* 분할 구분선 */}
          {layoutMode === 'split' && (
            <div className="w-[3px] shrink-0 bg-[#1a1a1a] hover:bg-[#2a2a2a] cursor-col-resize transition-colors" />
          )}

          {/* ── 목록 패널 — split / list / listfull 모드 ── */}
          {(layoutMode === 'split' || layoutMode === 'list' || layoutMode === 'listfull') && (
            <div className={`overflow-auto bg-[#060606] flex flex-col ${
              layoutMode === 'split' ? 'w-[30%] shrink-0' : 'flex-1'
            }`}>
              {/* 목록 필터 바 */}
              <div className="px-3 py-2 border-b border-[#1a1a1a] sticky top-0 bg-[#060606] z-10 flex items-center gap-2 flex-wrap">
                <span className="text-[9px] text-gray-600 font-black tracking-widest">
                  전체 {displayRecords.length}건
                </span>
                <select
                  value={listFilterGubun}
                  onChange={e => setListFilterGubun(e.target.value)}
                  className="bg-[#111] border border-[#222] rounded-lg px-2 py-0.5 text-[10px] text-white outline-none focus:border-[#3b82f6]/40 cursor-pointer"
                >
                  <option value="">구분 전체</option>
                  <option value="기초수급자">기초수급자</option>
                  <option value="차상위">차상위</option>
                </select>
                <select
                  value={activeDong || ''}
                  onChange={e => {
                    const idx = dongQueue.indexOf(e.target.value);
                    if (idx >= 0) handleDongNavigate(idx);
                  }}
                  className="bg-[#111] border border-[#222] rounded-lg px-2 py-0.5 text-[10px] text-white outline-none focus:border-emerald-500/40 cursor-pointer"
                >
                  {dongQueue.map(d => (
                    <option key={d} value={d}>
                      {`${completedDongs.has(d) ? '✓ ' : ''}${d} (${dongCounts[d] || 0}건)`}
                    </option>
                  ))}
                </select>
                {/* 순번 편집 버튼 그룹 */}
                <div className="ml-auto flex gap-1 shrink-0">
                  <button
                    onClick={() => { setIsSeqClickMode(v => !v); setSeqClickNext(1); if (isSeqDragMode) setIsSeqDragMode(false); }}
                    title={isSeqClickMode ? `클릭 순번 모드 ON — 행을 클릭하면 ${seqClickNext}번째 순번이 배정됩니다.` : '클릭 순번: 행을 클릭하는 순서대로 1→2→3 자동 배정'}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 transition-colors ${
                      isSeqClickMode
                        ? 'bg-amber-500/20 border border-amber-400/50 text-amber-300 animate-pulse'
                        : 'bg-[#111] border border-[#222] text-gray-500 hover:text-amber-400 hover:border-amber-500/30'
                    }`}
                  >
                    {isSeqClickMode ? `▶${seqClickNext}번` : '클릭'}
                  </button>
                  <button
                    onClick={() => { setIsSeqDragMode(v => !v); if (isSeqClickMode) setIsSeqClickMode(false); }}
                    title={isSeqDragMode ? '드래그 모드 ON — 행을 드래그해서 순번을 조정하세요.' : '드래그 순번: 행을 드래그해서 순서 세밀 조정'}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 transition-colors ${
                      isSeqDragMode
                        ? 'bg-purple-500/20 border border-purple-400/50 text-purple-300'
                        : 'bg-[#111] border border-[#222] text-gray-500 hover:text-purple-400 hover:border-purple-500/30'
                    }`}
                  >
                    ⠿ 드래그
                  </button>
                </div>
              </div>
              <table className="w-full border-collapse text-[10px]">
                <thead className="sticky top-[33px] bg-[#0a0a0a] z-10">
                  <tr className="border-b border-[#1a1a1a]">
                    <th className="w-1 p-0" />
                    {isSeqDragMode && <th className="w-5 p-0" />}
                    <th className="px-2 py-1 text-left text-[9px] text-gray-700 font-black w-7">#</th>
                    <th className="px-1 py-1 text-left text-[9px] text-gray-700 font-black">기사</th>
                    <th className="px-1 py-1 text-left text-[9px] text-gray-700 font-black">이름</th>
                    <th className="px-1 py-1 text-left text-[9px] text-gray-700 font-black">주소</th>
                    <th className="px-1 py-1 text-center text-[9px] text-gray-700 font-black w-10">순</th>
                    <th className="px-1 py-1 text-center text-[9px] text-gray-700 font-black w-5">좌</th>
                  </tr>
                </thead>
                <tbody>
                  {listRecords.map((r, idx) => {
                    const driver = drivers.find(d => d.id === r._driverId);
                    const isSelected = selectedRecordId === r.id;
                    const isSelectionPulse = selectionPulseId === r.id;
                    const isDragOver = isSeqDragMode && dragOverId === r.id;
                    return (
                      <tr
                        key={r.id} id={`rec-${r.id}`}
                        draggable={isSeqDragMode}
                        onDragStart={isSeqDragMode ? () => { dragSrcIdRef.current = r.id; } : undefined}
                        onDragOver={isSeqDragMode ? (e) => { e.preventDefault(); setDragOverId(r.id); } : undefined}
                        onDragLeave={isSeqDragMode ? () => setDragOverId(null) : undefined}
                        onDrop={isSeqDragMode ? () => handleSeqDrop(r.id) : undefined}
                        onDragEnd={isSeqDragMode ? () => { dragSrcIdRef.current = null; setDragOverId(null); } : undefined}
                        onClick={(e) => {
                          if (['SELECT','INPUT','OPTION'].includes(e.target.tagName)) return;
                          if (isSeqDragMode) return;
                          if (isSeqClickMode) {
                            setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, 배송순번: String(seqClickNext) } : pr));
                            setSeqClickNext(n => n + 1);
                            return;
                          }
                          if (r._lat && r._lng) handleSelectRecord(r);
                          else setSelectedRecordId(r.id);
                        }}
                        className={`border-b transition-colors cursor-pointer ${!r._lat ? 'opacity-50' : ''} ${isSeqDragMode ? 'hover:bg-purple-900/10' : isSeqClickMode ? 'hover:bg-amber-900/20' : isSelected ? 'bg-blue-500/20' : 'hover:bg-[#0f0f0f]'}`}
                        style={{
                          borderBottomColor: isDragOver ? '#a855f7' : '#0e0e0e',
                          borderBottomWidth: isDragOver ? '2px' : '1px',
                          ...(isSelected && !isSeqDragMode ? {
                            outline: '2px solid rgba(59,130,246,0.75)',
                            outlineOffset: '-2px',
                            boxShadow: isSelectionPulse
                              ? 'inset 0 0 0 9999px rgba(59,130,246,0.10), 0 0 18px rgba(59,130,246,0.45)'
                              : 'inset 0 0 0 9999px rgba(59,130,246,0.04)',
                          } : {}),
                          cursor: isSeqDragMode ? 'grab' : 'pointer',
                        }}>
                        {/* 기사 컬러 스트라이프 */}
                        <td
                          className="w-1 p-0 rounded-l"
                          style={{
                            background: isSelected ? '#60a5fa' : (driver?.color || 'transparent'),
                            opacity: isSelected ? 1 : (driver ? 0.85 : 0),
                            boxShadow: isSelected ? '0 0 10px rgba(96,165,250,0.8)' : 'none',
                          }}
                        />
                        {/* 드래그 핸들 */}
                        {isSeqDragMode && (
                          <td className="w-5 px-1 text-center text-gray-600 select-none" style={{ cursor: 'grab', fontSize: 11 }}>⠿</td>
                        )}
                        <td className="pl-2 pr-1 py-0.5 text-gray-600 tabular-nums text-[9px]">{idx + 1}</td>
                        <td className="px-1 py-0.5">
                          <select
                            value={r._driverId || ''}
                            onChange={e => setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, _driverId: e.target.value || null } : pr))}
                            className="bg-transparent border-0 text-[10px] font-bold focus:outline-none cursor-pointer max-w-[68px] truncate"
                            style={{ color: driver?.color || '#4b5563' }}>
                            <option value="" style={{ color: '#6b7280' }}>미배정</option>
                            {drivers.map(d => <option key={d.id} value={d.id} style={{ color: d.color }}>{d.name}</option>)}
                          </select>
                        </td>
                        <td className={`px-1 py-0.5 font-bold whitespace-nowrap ${isSelected ? 'text-blue-100' : 'text-white'}`}>
                          <span className="inline-flex items-center gap-1">
                            {isSelected && (
                              <span className="px-1 py-0 rounded bg-blue-500 text-white text-[8px] font-black leading-4 shadow-[0_0_8px_rgba(59,130,246,0.55)]">
                                선택
                              </span>
                            )}
                            {r.이름}
                            {carryMap[r.id]?._isNew && (
                              <span className="px-1 py-0 rounded bg-emerald-500/25 text-emerald-300 text-[8px] font-black leading-4" title="전월(지난달) 명단에 없던 신규 대상자">
                                NEW
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-1 py-0.5 text-gray-500 max-w-0 w-full">
                          <span className="block truncate" title={formatAddressDisplay(r.주소)}>{formatAddressDisplay(r.주소)}</span>
                        </td>
                        <td className="px-1 py-0.5 text-center">
                          <input
                            value={r.배송순번 || ''}
                            onChange={e => setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, 배송순번: e.target.value } : pr))}
                            className="w-9 bg-[#111] border border-[#1e1e1e] rounded px-1 py-0 text-[9px] text-[#3b82f6] text-center focus:outline-none focus:border-[#3b82f6]/40" />
                        </td>
                        <td className="px-1 py-0.5 text-center text-[9px]">
                          {r._lat ? <span className="text-[#3b82f6]">✓</span> : <span className="text-red-400">✗</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

            </div>
          )}
        </div>

        {/* 선택 핀 — 우측 목록으로 스크롤/하이라이트 처리됨 (팝업 없음) */}
      </div>

      {/* ── 토스트 알림 ──────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.7)] font-bold text-sm border pointer-events-none
            ${toast.type === 'success' ? 'bg-[#051a0c] border-emerald-500/50 text-emerald-300' :
              toast.type === 'error'   ? 'bg-[#1a0606] border-red-600/50 text-red-400' :
                                         'bg-[#0d0d0d] border-[#333] text-gray-300'}`}
          style={{ animation: 'slideUpToast 0.25s ease-out' }}
        >
          {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'}
          <span>{toast.message}</span>
        </div>
      )}

      {/* ── 미확인 건 패널 ─────────────────────────────────────────── */}
      {showErrorPanel && (() => {
        // 좌표없음: 진짜 좌표 미수신 / 지자체이탈: 좌표는 있고 지도에 표시 중이나 지자체 불일치
        const noCoordRecords = records.filter(r => !r._lat || !r._lng);
        const outCityRecords = records.filter(r => r.좌표검증상태 === '지자체벗어남' && r._lat && r._lng);
        const errorRecords = [...noCoordRecords, ...outCityRecords];

        const handleReprocess = async (r) => {
          const addrToUse = errorAddrOverrides[r.id]?.trim() || r.주소 || '';
          if (!addrToUse) return;
          setErrorFixingId(r.id);
          try {
            const fetchCoord = async (query, keyword = false) => {
              const ctrl = new AbortController();
              const tid = setTimeout(() => ctrl.abort(), 8000);
              try {
                const hit = await kakaoCoordOf(query, { keyword, signal: ctrl.signal });
                clearTimeout(tid);
                return hit;
              } catch { clearTimeout(tid); return null; }
            };
            const road = extractRoadAddress(addrToUse);
            let coord =
              await fetchCoord(road) ||
              await fetchCoord(road, true) ||
              await fetchCoord((getRouteDong(r) ? `${getRouteDong(r)} ` : '') + road.slice(0, 35), true);

            if (coord) {
              const cacheCity = isCloudMode ? cloudCity : (fileInfo?.city || '');
              const area = assessKakaoAreaMatch(r, coord.raw, cacheCity);
              const isCityOut = area.status === '지자체벗어남';
              const isDongOut = area.status === '행정동벗어남';
              setRecords(prev => prev.map(x => x.id === r.id ? {
                ...x,
                _lat: coord.lat,
                _lng: coord.lng,
                _driverId: null,
                주소: errorAddrOverrides[r.id]?.trim() || x.주소,
                좌표검증상태: area.status,
                좌표확인지자체: [area.matchedSido, area.matchedSigungu].filter(Boolean).join(' '),
                좌표확인행정동: area.matchedDong || '',
                좌표오류지정: false,
                원행정동: isDongOut && !x.원행정동 ? x.행정동 || '' : x.원행정동,
                배정행정동: isDongOut ? area.routeDong : (x.배정행정동 || ''),
                이관필요: isDongOut,
                확인필요: isCityOut ? true : x.확인필요,
                확인사유: mergeReason(x.확인사유, area.reason),
                _에러: isCityOut ? true : x._에러,
                _사유: mergeReason(x._사유, area.reason),
                배송상태: isCityOut ? '타지자체확인필요' : (isDongOut ? '타동이관필요' : (x.확인필요 || x._에러 ? '확인후배정가능' : '배송준비')),
              } : x));
              if (cacheCity) await saveCoordCacheLocal(cacheCity, road, coord.lat, coord.lng);
              if (isCloudMode && cloudCity && cloudMonthId && r._cloudDocId) {
                const batch = writeBatch(db);
                batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId), {
                  lat: coord.lat,
                  lng: coord.lng,
                  ...(errorAddrOverrides[r.id]?.trim() ? { 주소: errorAddrOverrides[r.id].trim() } : {}),
                  좌표검증상태: area.status,
                  좌표확인지자체: [area.matchedSido, area.matchedSigungu].filter(Boolean).join(' '),
                  좌표확인행정동: area.matchedDong || '',
                  좌표오류지정: false,
                  원행정동: isDongOut && !r.원행정동 ? r.행정동 || '' : r.원행정동 || '',
                  배정행정동: isDongOut ? area.routeDong : (r.배정행정동 || ''),
                  이관필요: isDongOut,
                  확인필요: isCityOut ? true : !!r.확인필요,
                  확인사유: mergeReason(r.확인사유, area.reason),
                  _에러: isCityOut ? true : !!r._에러,
                  _사유: area.reason ? [r._사유, area.reason].filter(Boolean).join(' / ') : r._사유 || '',
                  배송상태: isCityOut ? '타지자체확인필요' : (isDongOut ? '타동이관필요' : (r.확인필요 || r._에러 ? '확인후배정가능' : '배송준비')),
                });
                await batch.commit();
              }
            } else {
              alert(`❌ 좌표를 찾지 못했습니다.\n주소를 더 구체적으로 수정해 보세요.`);
            }
          } catch (e) {
            alert('재처리 실패: ' + e.message);
          } finally {
            setErrorFixingId(null);
          }
        };

        const handleExclude = (id) => {
          setRecords(prev => prev.filter(r => r.id !== id));
        };

        return (
          <div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-[#0d1117] border border-red-700/40 rounded-t-2xl sm:rounded-2xl shadow-[0_-20px_60px_rgba(0,0,0,0.8)] flex flex-col max-h-[80vh]">
              {/* 패널 헤더 */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a] shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertCircle size={16} className="text-red-400" />
                  <span className="text-white font-black text-sm">좌표 문제 {errorRecords.length}건</span>
                  {noCoordRecords.length > 0 && (
                    <span className="text-[10px] text-red-400 bg-red-900/30 px-2 py-0.5 rounded-full">
                      좌표없음 {noCoordRecords.length}건
                    </span>
                  )}
                  {outCityRecords.length > 0 && (
                    <span className="text-[10px] text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded-full" title="좌표는 지도에 표시 중입니다">
                      지자체이탈 {outCityRecords.length}건 (지도표시 ✓)
                    </span>
                  )}
                </div>
                <button onClick={() => setShowErrorPanel(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>

              {/* 목록 */}
              <div className="overflow-y-auto flex-1 p-4 space-y-3">
                {errorRecords.length === 0 ? (
                  <div className="text-center py-10 text-gray-500 text-sm">모든 주소의 좌표가 확인되었습니다 ✓</div>
                ) : errorRecords.map(r => {
                  const isFixing = errorFixingId === r.id;
                  const overrideAddr = errorAddrOverrides[r.id] ?? '';
                  const isOutCity = r.좌표검증상태 === '지자체벗어남' && r._lat && r._lng;
                  return (
                    <div key={r.id} className={`bg-[#111] border rounded-xl p-4 space-y-3 ${isOutCity ? 'border-amber-700/40' : 'border-[#222]'}`}>
                      {/* 이름 · 행정동 · 타입 뱃지 · 오류사유 */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-white font-black text-sm">{r.이름 || r.name || '—'}</span>
                          {r.행정동 && <span className="ml-2 text-[10px] text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">{r.행정동}</span>}
                          {isOutCity
                            ? <span className="ml-2 text-[10px] text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded">지자체이탈 · 지도표시 ✓</span>
                            : <span className="ml-2 text-[10px] text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">좌표없음</span>
                          }
                          {r.좌표확인지자체 && <span className="ml-1 text-[10px] text-gray-500">({r.좌표확인지자체})</span>}
                          {r._사유 && <div className="mt-1 text-[10px] text-red-400">{r._사유}</div>}
                        </div>
                        <button
                          onClick={() => handleExclude(r.id)}
                          disabled={isFixing}
                          className="shrink-0 text-[10px] text-gray-500 hover:text-red-400 border border-[#333] hover:border-red-700/50 rounded px-2 py-1 transition-colors disabled:opacity-40"
                        >
                          제외
                        </button>
                      </div>

                      {/* 현재 주소 */}
                      <div className="text-xs text-gray-400 bg-[#0a0a0a] rounded-lg px-3 py-2 break-all">
                        {formatAddressDisplay(r.주소) || <span className="text-gray-600 italic">주소 없음</span>}
                      </div>

                      {/* 지자체이탈: 안내 / 좌표없음: 주소수정 재처리 */}
                      {isOutCity ? (
                        <div className="text-[11px] text-amber-400/80 bg-amber-900/20 rounded-lg px-3 py-2 border border-amber-700/30">
                          좌표는 지도에 이미 표시 중입니다. 주소를 수정하여 재처리하면 올바른 지자체 좌표로 교체됩니다.
                          <div className="flex gap-2 mt-2">
                            <input
                              type="text"
                              value={overrideAddr}
                              onChange={e => setErrorAddrOverrides(prev => ({ ...prev, [r.id]: e.target.value }))}
                              placeholder="주소 수정 후 재처리 (선택사항)"
                              className="flex-1 bg-[#1a1a1a] border border-amber-700/40 focus:border-amber-500/60 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none placeholder-gray-600 transition-colors"
                              onKeyDown={e => { if (e.key === 'Enter' && !isFixing) handleReprocess(r); }}
                              disabled={isFixing}
                            />
                            <button
                              onClick={() => handleReprocess(r)}
                              disabled={isFixing}
                              className="shrink-0 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-black rounded-lg transition-colors flex items-center gap-1"
                            >
                              {isFixing ? <><Search size={11} className="animate-spin" />처리중</> : <><Search size={11} />재처리</>}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={overrideAddr}
                            onChange={e => setErrorAddrOverrides(prev => ({ ...prev, [r.id]: e.target.value }))}
                            placeholder="주소 수정 (비우면 원본 주소로 재처리)"
                            className="flex-1 bg-[#1a1a1a] border border-[#333] focus:border-red-600/60 rounded-lg px-3 py-2 text-white text-xs focus:outline-none placeholder-gray-600 transition-colors"
                            onKeyDown={e => { if (e.key === 'Enter' && !isFixing) handleReprocess(r); }}
                            disabled={isFixing}
                          />
                          <button
                            onClick={() => handleReprocess(r)}
                            disabled={isFixing}
                            className="shrink-0 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-black rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            {isFixing ? <><Search size={12} className="animate-spin" />처리중</> : <><Search size={12} />재처리</>}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 패널 푸터 */}
              <div className="shrink-0 px-5 py-4 border-t border-[#1a1a1a] flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {errorRecords.length > 0 ? `${errorRecords.length}건 남음 — 주소 수정 후 재처리하거나 제외하세요` : '처리 완료'}
                </span>
                <button
                  onClick={() => setShowErrorPanel(false)}
                  className="px-5 py-2 bg-[#1a1a1a] border border-[#333] text-gray-300 hover:text-white rounded-xl text-sm font-bold transition-colors"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 기사 배정 맞교환 모달 ─────────────────────────────────── */}
      {showDriverSwapModal && (() => {
        const useDongScope = swapScope === 'dong' && selectedDong !== '전체';
        const scopeRecords = useDongScope ? records.filter(r => getRouteDong(r) === selectedDong) : records;
        const scopeLabel = useDongScope ? selectedDong : '전체';
        const driverStats = drivers.map((driver, index) => {
          const assigned = scopeRecords.filter(r => r._driverId === driver.id);
          const qty = assigned.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
          return {
            ...driver,
            zoneNo: index + 1,
            count: assigned.length,
            qty,
            effectiveLoad: Math.round(assigned.reduce((s, r) => s + getEffectiveLoad(r), 0)),
          };
        });
        const fromStat = driverStats.find(d => d.id === swapFromDriverId);
        const toStat = driverStats.find(d => d.id === swapToDriverId);
        const assignedOptions = driverStats.filter(d => d.count > 0);
        return (
          <div
            className="absolute inset-0 z-[280] bg-black/75 flex items-center justify-center p-4"
            onClick={() => setShowDriverSwapModal(false)}
          >
            <div
              className="bg-[#0d0d0d] border border-cyan-500/30 rounded-2xl w-full max-w-md shadow-2xl shadow-cyan-950/20"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center shrink-0">
                  <ArrowLeftRight size={15} className="text-cyan-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-black text-white">기사 배정 교체</h3>
                  <p className="text-[10px] text-gray-500">두 기사에게 배정된 명단만 서로 맞바꿉니다. 좌표와 순번은 유지됩니다.</p>
                </div>
                <button onClick={() => setShowDriverSwapModal(false)} className="p-1.5 text-gray-600 hover:text-white transition-colors">
                  <X size={14} />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">
                <div>
                  <div className="text-[9px] text-gray-600 font-black tracking-widest uppercase mb-1.5">적용 범위</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setSwapScope('all')}
                      className={`py-2 rounded-xl border text-xs font-black transition-colors ${swapScope === 'all' ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300' : 'bg-[#111] border-[#262626] text-gray-500 hover:text-gray-300'}`}
                    >
                      전체 명단
                    </button>
                    <button
                      onClick={() => setSwapScope('dong')}
                      disabled={selectedDong === '전체'}
                      className={`py-2 rounded-xl border text-xs font-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${swapScope === 'dong' && selectedDong !== '전체' ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300' : 'bg-[#111] border-[#262626] text-gray-500 hover:text-gray-300'}`}
                    >
                      현재 행정동
                    </button>
                  </div>
                  <div className="mt-1.5 text-[10px] text-gray-600">
                    현재 범위: <span className="text-cyan-300 font-bold">{scopeLabel}</span>
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
                  <div>
                    <label className="block text-[9px] text-gray-600 font-black tracking-widest uppercase mb-1">기사 A</label>
                    <select
                      value={swapFromDriverId}
                      onChange={e => setSwapFromDriverId(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/40"
                    >
                      {assignedOptions.map(d => (
                        <option key={d.id} value={d.id}>{d.zoneNo}구역 {d.name} · {d.count}건</option>
                      ))}
                    </select>
                  </div>
                  <div className="pb-2 text-cyan-400">
                    <ArrowLeftRight size={16} />
                  </div>
                  <div>
                    <label className="block text-[9px] text-gray-600 font-black tracking-widest uppercase mb-1">기사 B</label>
                    <select
                      value={swapToDriverId}
                      onChange={e => setSwapToDriverId(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/40"
                    >
                      {assignedOptions.map(d => (
                        <option key={d.id} value={d.id}>{d.zoneNo}구역 {d.name} · {d.count}건</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {[fromStat, toStat].map((stat, idx) => (
                    <div key={stat?.id || idx} className="rounded-xl bg-[#111] border border-[#242424] p-3 min-w-0">
                      {stat ? (
                        <>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stat.color }} />
                            <span className="text-white text-xs font-black truncate">{stat.zoneNo}구역 {stat.name}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-gray-600">배정</span>
                            <span className="text-cyan-300 font-black">{stat.count}건 · {stat.qty}포</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] mt-0.5">
                            <span className="text-gray-600">유효부담</span>
                            <span className="text-gray-300 font-bold">{stat.effectiveLoad}</span>
                          </div>
                        </>
                      ) : (
                        <div className="text-[10px] text-gray-600">기사를 선택하세요.</div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-xl bg-cyan-950/10 border border-cyan-500/20 px-3 py-2 text-[10px] text-gray-400 leading-relaxed">
                  예: <span className="text-cyan-300 font-bold">1구역 기사1</span>과 <span className="text-cyan-300 font-bold">3구역 기사3</span>을 선택하면,
                  기사1에게 있던 명단은 기사3으로, 기사3에게 있던 명단은 기사1로 이동합니다.
                </div>
              </div>

              <div className="px-5 py-4 border-t border-[#1a1a1a] flex items-center justify-between gap-3">
                <button
                  onClick={() => setShowDriverSwapModal(false)}
                  className="px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white text-xs font-bold rounded-xl transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleSwapDriverAssignments}
                  disabled={!swapFromDriverId || !swapToDriverId || swapFromDriverId === swapToDriverId}
                  className="flex-1 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-black rounded-xl transition-colors flex items-center justify-center gap-1.5"
                >
                  <ArrowLeftRight size={12} /> 배정 맞교환
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 임대 아파트 다기사 배정 모달 ────────────────────────── */}
      {aptMultiModal && (
        <div className="absolute inset-0 z-[300] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-lg flex flex-col shadow-2xl">
            {/* 헤더 */}
            <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center gap-3">
              <Building2 size={16} className="text-orange-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-white truncate">{aptMultiModal.aptName}</h3>
                {aptMultiModal.road && aptMultiModal.road !== aptMultiModal.aptName && (
                  <p className="text-[10px] text-gray-600 truncate">{aptMultiModal.road}</p>
                )}
                <p className="text-[10px] text-gray-500">총 {aptMultiModal.totalQty}포 · 동별 기사 배정</p>
              </div>
              <button onClick={() => setAptMultiModal(null)} className="p-1.5 text-gray-600 hover:text-white transition-colors shrink-0">
                <X size={14} />
              </button>
            </div>

            {/* 동별 배정 테이블 */}
            <div className="flex-1 overflow-auto max-h-[60vh] px-5 py-4 space-y-2">
              <p className="text-[10px] text-gray-500 mb-3">각 동의 담당 기사를 선택하세요. 동 단위로 일괄 적용됩니다.</p>
              {aptMultiModal.dongs.map((d, i) => {
                const assignedDriver = drivers.find(dr => dr.id === d.assignedDriverId);
                const dongLabel = d.dong > 0 ? `${d.dong}동` : '동 미확인';
                return (
                  <div key={i} className="flex items-center gap-3 bg-[#111] border border-[#1e1e1e] rounded-xl px-4 py-3">
                    <span className="text-orange-400 font-black text-sm w-16 shrink-0">{dongLabel}</span>
                    <span className="text-gray-500 text-[10px] w-20 shrink-0">{d.records.length}명 · {d.qty}포</span>
                    <select
                      value={d.assignedDriverId || ''}
                      onChange={e => setAptMultiModal(prev => ({
                        ...prev,
                        dongs: prev.dongs.map((dd, ii) => ii === i ? { ...dd, assignedDriverId: e.target.value || null } : dd),
                      }))}
                      className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-orange-500/40 transition-colors"
                      style={{ color: assignedDriver?.color || '#6b7280' }}
                    >
                      <option value="">미배정</option>
                      {drivers.map(dr => (
                        <option key={dr.id} value={dr.id} style={{ color: dr.color }}>{dr.name}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

            {/* 푸터 버튼 */}
            <div className="px-5 py-4 border-t border-[#1a1a1a] flex items-center justify-between gap-3">
              <button
                onClick={() => setAptMultiModal(null)}
                className="px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white text-xs font-bold rounded-xl transition-colors"
              >
                취소
              </button>
              <button
                onClick={applyAptMultiAssignment}
                className="flex-1 py-2 bg-orange-700 hover:bg-orange-600 text-white text-xs font-black rounded-xl transition-colors"
              >
                적용 ({aptMultiModal.dongs.length}개 동 일괄 배정)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 소속사 기사 추가 피커 ─────────────────────────────────────── */}
      {showCompanyPicker && (() => {
        const hasCompanyList = companyDriverPool?.length > 0;
        const hasAvailable = availableCompanyDrivers.length > 0;
        // 콤보박스 확정값: 선택된 기사 객체
        const selectedDriver = hasAvailable
          ? availableCompanyDrivers.find(d => d.name === pickerSelectedName) || availableCompanyDrivers[0]
          : null;

        return (
          <div
            className="absolute inset-0 z-[250] bg-black/70 flex items-start justify-center pt-24"
            onClick={() => setShowCompanyPicker(false)}
          >
            <div
              className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-72 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* 헤더 */}
              <div className="px-4 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-black text-sm">소속사 기사 추가</span>
                    {pickerDong && pickerDong !== '전체' && (
                      <span className="text-[10px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 rounded px-1.5 py-0.5 font-bold">
                        {pickerDong}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5">
                    세션 기사 제외 · 미배정 기사만 표시
                  </div>
                </div>
                <button onClick={() => setShowCompanyPicker(false)} className="text-gray-600 hover:text-white transition-colors">
                  <X size={14} />
                </button>
              </div>

              <div className="px-4 py-4 space-y-3">
                {/* ── 소속사 콤보박스 (기사 목록이 있을 때) */}
                {hasCompanyList && (
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1.5 font-bold">소속사 기사 선택</div>
                    {hasAvailable ? (
                      <select
                        value={pickerSelectedName || (availableCompanyDrivers[0]?.name ?? '')}
                        onChange={e => setPickerSelectedName(e.target.value)}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none cursor-pointer"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
                      >
                        {availableCompanyDrivers.map(d => (
                          <option key={d.id || d.name} value={d.name}>
                            {d.name}{d.capacity && d.capacity !== 100 ? ` (${d.capacity}%)` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="w-full bg-[#111] border border-[#1a1a1a] rounded-lg px-3 py-2 text-[11px] text-gray-600">
                        모든 소속사 기사가 이미 배정되어 있습니다
                      </div>
                    )}
                    {hasAvailable && (
                      <button
                        onClick={() => addCompanyDriver(selectedDriver)}
                        className="mt-2 w-full py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-black rounded-lg transition-colors"
                      >
                        선택 기사 추가
                      </button>
                    )}
                  </div>
                )}

                {/* ── 구분선 */}
                {hasCompanyList && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-[#1a1a1a]" />
                    <span className="text-[9px] text-gray-700">또는 직접 입력</span>
                    <div className="flex-1 h-px bg-[#1a1a1a]" />
                  </div>
                )}

                {/* ── 직접 입력 */}
                <div>
                  {!hasCompanyList && (
                    <div className="text-[10px] text-gray-600 mb-2 leading-relaxed">
                      소속사 기사 목록이 없습니다.<br />기사 이름을 직접 입력하세요.
                    </div>
                  )}
                  <input
                    autoFocus={!hasCompanyList}
                    id="company-driver-name-input"
                    placeholder={`기사${drivers.length + 1}`}
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/40"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const name = e.target.value.trim() || `기사${drivers.length + 1}`;
                        addCompanyDriver({ name });
                      } else if (e.key === 'Escape') {
                        setShowCompanyPicker(false);
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById('company-driver-name-input');
                      addCompanyDriver({ name: (input?.value || '').trim() || `기사${drivers.length + 1}` });
                    }}
                    className="mt-2 w-full py-2 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-white text-xs font-black rounded-lg transition-colors"
                  >
                    추가
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 좌표 삭제 브러시 모달 ──────────────────────────────────── */}
      {showCoordBrush && (
        <CoordBrushModal
          records={records.map(r => ({ ...r, lat: r._lat, lng: r._lng }))}
          selectedCity={isCloudMode ? cloudCity : (fileInfo?.city || '')}
          onClose={() => setShowCoordBrush(false)}
          onApplyDelete={handleCoordBrushApply}
          onApplyRematch={async (ids) => {
            await handleCoordBrushApply(ids, true);
            setShowCoordBrush(false);
            await handleFetchMissingCoords({ recordIds: ids, force: true, skipConfirm: true, reason: 'brush-rematch' });
          }}
        />
      )}

      {/* ── 오버레이 패널 (지도 DOM 유지) ─────────────────────────── */}
      {cloudPickerOverlay}

      {/* ── 기사 순번 반영 요청 승인 모달 ─────────────────────────── */}
      {orderRequestModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[210] flex items-center justify-center p-4">
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-amber-300" />
                <span className="text-white font-black text-sm">기사 순번 반영 요청</span>
              </div>
              <button onClick={() => setOrderRequestModal(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-100 leading-relaxed">
                기사 요청은 바로 원본을 바꾸지 않습니다. 담당자가 기사와 유선 확인 후 [확인 후 반영]을 누르면 해당 기사 명단의 배송순번만 공식 월별 명단에 저장됩니다.
              </div>
              {orderRequestModal.requests.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-xs font-bold">
                  대기 중인 순번 반영 요청이 없습니다.
                </div>
              ) : orderRequestModal.requests.map(req => (
                <div key={`${req.shareId}_${req.driverId}`} className="bg-[#111] border border-[#2a2a2a] rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: req.driverColor }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-white text-xs font-black truncate">{req.driverName}</div>
                      <div className="text-[9px] text-gray-500 truncate">
                        요청 {req.count?.toLocaleString?.() || req.orderIds.length}건
                        {req.requestedAt ? ` · ${new Date(req.requestedAt).toLocaleString('ko-KR')}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleApproveOrderRequest(req)}
                      disabled={isApplyingOrderRequest}
                      className="px-3 py-1.5 bg-amber-600/20 border border-amber-500/40 text-amber-200 hover:bg-amber-600/30 rounded-lg text-[10px] font-black flex items-center gap-1.5 shrink-0 transition-colors disabled:opacity-50"
                    >
                      {isApplyingOrderRequest ? <RefreshCw size={10} className="animate-spin" /> : <Save size={10} />}
                      확인 후 반영
                    </button>
                  </div>
                  <div className="mt-2 text-[9px] text-gray-600 truncate">공유ID: {req.shareId}</div>
                </div>
              ))}
            </div>
            <div className="px-5 pb-4 flex gap-2 justify-end">
              <button
                onClick={handleLoadOrderApplyRequests}
                disabled={isLoadingOrderRequests}
                className="px-4 py-2 bg-[#111] border border-[#2a2a2a] text-gray-300 hover:text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {isLoadingOrderRequests ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                새로고침
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 행정동 이동 미저장 확인 모달 ────────────────────────────────── */}
      {showDongNavConfirm && (
        <DongNavConfirmModal
          currentDong={activeDong}
          targetDong={dongQueue[showDongNavConfirm.targetIndex]}
          onSaveAndGo={async () => {
            await handleSaveSession(false);
            setShowDongNavConfirm(null);
            setActiveDongIndex(showDongNavConfirm.targetIndex);
          }}
          onDiscardAndGo={() => {
            const { targetIndex } = showDongNavConfirm;
            setShowDongNavConfirm(null);
            setIsDirty(false);
            setActiveDongIndex(targetIndex);
          }}
          onCancel={() => setShowDongNavConfirm(null)}
        />
      )}

      {/* ── 자동 핀 확인 모달 ──────────────────────────────────────────── */}
      {autoPinConfirmModal && (
        <AutoPinConfirmModal
          data={autoPinConfirmModal} drivers={drivers} driverCount={driverCount}
          onApply={() => {
            const { clusterMap, pendingPins, diagnostics, affectedIds } = autoPinConfirmModal;
            const idSet = new Set(affectedIds);
            setDriverPins(prev => ({ ...prev, ...pendingPins }));
            setRecords(prev => prev.map(r => (idSet.has(r.id) ? { ...r, _driverId: clusterMap[r.id] || null } : r)));
            const balanceMsg = diagnostics?.load?.maxAbsDiffPct !== undefined
              ? `최대 편차 ${diagnostics.load.maxAbsDiffPct}%` : '분석 완료';
            const qScore = diagnostics?.qualityScore !== undefined ? ` · 품질 ${diagnostics.qualityScore}점` : '';
            const stratLabel = { hilbert: '힐베르트 곡선', seedVoronoi: '핀 전체 기준', dongGroup: '자동 경계' }[diagnostics?.strategy || 'dongGroup'] || '자동 경계';
            setTimeout(() => showToast('success', `자동 배정 완료 [${stratLabel}] — ${balanceMsg}${qScore} · 핀 자동 설정`, 5000), 200);
            setAutoPinConfirmModal(null);
          }}
          onAdjustPins={() => {
            const { clusterMap, pendingPins, affectedIds } = autoPinConfirmModal;
            const idSet = new Set(affectedIds);
            setDriverPins(prev => ({ ...prev, ...pendingPins }));
            setRecords(prev => prev.map(r => (idSet.has(r.id) ? { ...r, _driverId: clusterMap[r.id] || null } : r)));
            showToast('info', '핀이 지도에 표시됩니다. [핀 꽂기]로 조정 후 [자동 N등분]을 다시 누르세요.', 7000);
            setAutoPinConfirmModal(null);
          }}
        />
      )}

      {/* ── 공유 링크 모달 ──────────────────────────────────────────── */}
      {/* 지도 배포 순간에 그 지도의 암호를 받는다(형 지시 2026-08-23) — 입력값은 이 컴포넌트 안에만 있다 */}
      <SharePasscodePrompt
        open={askPasscode}
        busy={isCreatingShare}
        driverCount={drivers.filter(d => records.some(r => r._driverId === d.id)).length}
        onCancel={() => setAskPasscode(false)}
        onConfirm={(code) => runCreateShare(code)}
      />

      {shareModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <Share2 size={16} className="text-green-400" />
                <span className="text-white font-black text-sm">기사 배송루트 공유</span>
              </div>
              <button onClick={() => setShareModal(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-[10px] text-gray-500">링크 전달 → 기사가 모바일에서 배송루트 카카오지도 확인 및 <span className="text-green-400">● 내 위치 실시간 표시</span> 가능.</p>
              {shareModal.passcode && (
                <div className="rounded-xl border border-green-500/30 bg-green-950/20 px-3 py-2 text-[11px] text-green-200 flex items-center justify-between gap-2">
                  <span>기사 비밀번호 <span className="font-black text-lg tracking-[0.3em] text-green-100 ml-1">{shareModal.passcode}</span></span>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => { navigator.clipboard.writeText(shareModal.passcode); showToast('success', '비밀번호 복사됨'); }}
                      className="px-2 py-1 bg-green-900/40 border border-green-600/40 text-green-300 hover:bg-green-800/40 rounded-lg text-[9px] font-bold transition-colors"
                    >복사</button>
                    <button
                      onClick={async () => {
                        // 재설정: 새 해시·솔트로 교체. ⚠️이미 발급된 기사 토큰은 살아 있다(비밀번호는 '입장' 열쇠이지 세션 열쇠가 아니다).
                        const np = window.prompt('새 기사 비밀번호(숫자 6자리)를 입력하세요. 바꾸는 즉시 **이미 열어 둔 기사 화면도 끊기고**, 새 번호로 다시 들어가야 합니다.', '');   // ★미리 만들어 넣어 주지 않는다 — 담당자가 직접 넣는다(형 지시)
                        if (np === null) return;
                        if (!isValidPasscode(np)) { showToast('error', '숫자 6자리만 가능합니다'); return; }
                        try {
                          const s = newSalt();
                          await updateDoc(doc(db, 'route_share_secrets', shareModal.shareId), {
                            passcodeHash: await hashPasscode(np, s), passcodeSalt: s, updatedAt: serverTimestamp(),
                            ver: increment(1),   // ★세대를 올리면 **이미 입장한 기사 토큰도 즉시 끊긴다**(규칙이 대조한다)
                          });
                          setShareModal(m => ({ ...m, passcode: np }));
                          showToast('success', '비밀번호를 바꿨습니다');
                        } catch (e) { showToast('error', '비밀번호 변경 실패: ' + e.message); }
                      }}
                      className="px-2 py-1 bg-[#111] border border-[#2a2a2a] text-gray-300 hover:text-white hover:border-green-500/40 rounded-lg text-[9px] font-bold transition-colors"
                    >변경</button>
                  </div>
                </div>
              )}
              {shareModal.passcode && (
                <p className="text-[9px] text-gray-500">기사는 링크를 열고 이 번호를 넣어야 지도가 보입니다. 링크와 번호는 <span className="text-amber-300">따로</span> 전달하세요. 이 창을 닫으면 번호를 다시 볼 수 없습니다.</p>
              )}
              {shareModal.expiresAtLabel && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-200">
                  이 배송 URL은 <span className="font-black text-amber-100">{shareModal.expiresAtLabel}</span>까지 사용할 수 있습니다. 만료 후에는 새 공유 링크를 다시 생성하세요.
                </div>
              )}
              {shareModal.links.map(l => (
                <div key={l.driverId} className="bg-[#111] border border-[#2a2a2a] rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color }} />
                    <span className="text-white text-[11px] font-bold w-16 shrink-0">{l.name}</span>
                    <span className="text-gray-500 text-[9px] flex-1 truncate">{l.url}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(l.url);
                        showToast('success', `${l.name} 링크 복사됨`);
                      }}
                      className="px-2 py-1 bg-green-900/40 border border-green-600/40 text-green-400 hover:bg-green-800/40 rounded-lg text-[9px] font-bold flex items-center gap-1 shrink-0 transition-colors"
                    >
                      <Link size={9} /> 복사
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 pb-4 flex gap-2 justify-end">
              <button
                onClick={() => {
                  const all = shareModal.links.map(l => `[${l.name}]\n${l.url}`).join('\n\n');
                  navigator.clipboard.writeText(all);
                  showToast('success', '전체 링크 복사됨');
                }}
                className="px-4 py-2 bg-green-700/30 border border-green-600/50 text-green-300 hover:bg-green-700/50 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors"
              >
                <Share2 size={12} /> 전체 복사
              </button>
            </div>
          </div>
        </div>
      )}

      {showDriverSeq && (
        <DriverSequenceView
          records={records.map(r => ({ ...r, 기사: drivers.find(d => d.id === r._driverId)?.name || r.기사 || '' }))}
          title={`기사별 배송순번 — ${cloudCity || ''} ${cloudMonthId || ''}`}
          onClose={() => setShowDriverSeq(false)}
        />
      )}

      {showAccuracy && (
        <DeliveryAccuracyView
          completions={completionData}
          onClose={() => setShowAccuracy(false)}
          onFocus={(c) => {
            if (c.lat != null && c.lng != null && kakaoMapRef.current && window.kakao?.maps) {
              setShowAccuracy(false);
              setShowCompletionCompare(true);
              kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(c.lat, c.lng));
              kakaoMapRef.current.setLevel(3);
            }
          }}
        />
      )}
      {/* ── 저장본 보기/편집 모달 ─────────────────────────────────────────── */}
      {savedView && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[650] flex items-center justify-center p-4" onClick={() => setSavedView(null)}>
          <div className="w-full max-w-3xl max-h-[85vh] bg-[#0a0a0a] border border-cyan-500/30 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <HardDrive size={16} className="text-cyan-400 shrink-0" />
                <div>
                  <div className="text-sm font-black text-white">저장본 — {cloudCity} {cloudMonthId}</div>
                  <div className="text-[10px] text-gray-500">DB에 저장된 기사·배송순번·좌표입니다</div>
                </div>
              </div>
              <button onClick={() => setSavedView(null)} className="p-1.5 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white rounded-lg transition-colors"><X size={14} /></button>
            </div>

            {savedView.loading ? (
              <div className="flex-1 flex items-center justify-center p-10 text-gray-500 text-sm"><RefreshCw size={16} className="animate-spin mr-2" /> 저장본 불러오는 중...</div>
            ) : (
              <>
                <div className="px-4 py-2 border-b border-[#1a1a1a] flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-gray-400">전체 <b className="text-white">{savedView.summary.total.toLocaleString()}</b></span>
                  <span className="text-gray-400">배정 <b className="text-emerald-400">{savedView.summary.assigned.toLocaleString()}</b></span>
                  <span className="text-gray-400">미배정 <b className="text-amber-400">{(savedView.summary.total - savedView.summary.assigned).toLocaleString()}</b></span>
                  <span className="text-gray-400">좌표없음 <b className={savedView.summary.noCoord > 0 ? 'text-red-400' : 'text-emerald-400'}>{savedView.summary.noCoord.toLocaleString()}</b></span>
                  <span className="mx-1 text-gray-700">|</span>
                  {Object.entries(savedView.summary.byDriver).sort((a, b) => b[1] - a[1]).map(([dn, c]) => (
                    <span key={dn} className="px-1.5 py-0.5 rounded bg-[#111] border border-[#222] text-gray-300">{dn} <b className="text-cyan-400">{c}</b></span>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-[#0d0d0d] text-gray-500 z-10">
                      <tr className="border-b border-[#1a1a1a]">
                        <th className="text-left px-3 py-1.5 font-bold">기사</th>
                        <th className="text-left px-2 py-1.5 font-bold w-10">순번</th>
                        <th className="text-left px-2 py-1.5 font-bold">이름</th>
                        <th className="text-left px-3 py-1.5 font-bold">주소</th>
                        <th className="text-center px-2 py-1.5 font-bold w-12">좌표</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedView.rows.map((r, i) => (
                        <tr key={r.id || i} className="border-b border-[#141414] hover:bg-[#101010]">
                          <td className="px-3 py-1 font-bold text-cyan-300">{r.driver || <span className="text-gray-600">미배정</span>}</td>
                          <td className="px-2 py-1 text-gray-400">{r.seq || '-'}</td>
                          <td className="px-2 py-1 text-gray-200 whitespace-nowrap">{r.name}</td>
                          <td className="px-3 py-1 text-gray-400 truncate max-w-[280px]" title={r.addr}>{r.addr}</td>
                          <td className="px-2 py-1 text-center">{r.hasCoord ? <span className="text-emerald-500">●</span> : <span className="text-red-500">○</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-3 border-t border-[#1a1a1a] flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-600">편집하려면 저장본을 지도로 불러온 뒤 수정하고 다시 저장하세요.</span>
                  <button
                    onClick={() => { setSavedView(null); handleLoadSession(); }}
                    disabled={isLoadingSession}
                    className="px-3 py-1.5 bg-cyan-950/50 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/50 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={12} /> 이 저장본 불러와 편집
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
