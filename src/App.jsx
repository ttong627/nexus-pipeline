import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { auth, onAuthStateChanged, signOut, setDoc, getDoc, updateDoc, deleteDoc, doc, db, serverTimestamp, Timestamp, increment, addDoc, collection, getDocs, getDocsFromServer, writeBatch, query, where, onSnapshot, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from "./config/firebase.js";
const ttl90 = () => Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000);
import { APP_VERSION } from "./version.js";
import { cleanupExpiredCache } from "./engine/dbCache.js";
import { refreshSavedCols } from "./utils/colOrder.js";
import { HOUSEHOLD_EXCL, HOUSEHOLD_RE } from "./columnRules.js";

// 서버 AI 학습 규칙(nexus_config/ai_rules)이 '수량' 키워드에 가구·세대 칼럼을 끼워넣어
// 기본 제외(excl)를 무력화하는 것을 로드 시점에 차단(이중 방어, 워커 최종가드와 병행). CLAUDE.md §5
const sanitizeAiRules = (rules) => {
  if (!rules || !Array.isArray(rules.reqKeys)) return rules;
  const reqKeys = rules.reqKeys.map(r => {
    if (r?.k !== '수량') return r;
    const kws = Array.isArray(r.kws) ? r.kws.filter(k => !HOUSEHOLD_RE.test(String(k).replace(/\s+/g, ''))) : r.kws;
    const excl = Array.from(new Set([...(r.excl || []), ...HOUSEHOLD_EXCL]));
    return { ...r, kws, excl };
  });
  return { ...rules, reqKeys };
};

// ── 즉시 로드 (초기 화면에 필요)
import Dashboard from "./components/Dashboard.jsx";
import InstallButton from "./components/InstallButton.jsx";
import ProfileSetupModal from "./components/ProfileSetupModal.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import Step1_Upload from "./components/Step1_Upload.jsx";
import Step2_SheetSelect from "./components/Step2_SheetSelect.jsx";
import Step3_Mapping from "./components/Step3_Mapping.jsx";
import CityMonthPickerModal from "./components/CityMonthPickerModal.jsx";
import EasyCleanConfirm from "./components/EasyCleanConfirm.jsx";
import LoadingScreen from "./components/LoadingScreen.jsx";
import ResultGrid from "./components/ResultGrid.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import GlobalLoadingBar from "./components/GlobalLoadingBar.jsx";
import IntroScreen from "./components/IntroScreen.jsx";
import ShareRouteView from "./components/ShareRouteView.jsx";

const isChunkLoadError = (error) => {
  const message = String(error?.message || error || '');
  return /Failed to fetch dynamically imported module|dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(message);
};

let latestWorkSnapshot = null; // 진행 중 작업 스냅샷 — 스테일청크 복구 새로고침 시 보존(첫 화면 리셋 방지)
const recoverFromStaleChunk = async () => {
  const key = `nexus_chunk_recovery_${APP_VERSION}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch { /* ignore */ }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister()));
    }
  } catch { /* ignore */ }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(cacheKey => caches.delete(cacheKey)));
    }
  } catch { /* ignore */ }

  // 새로고침 후 진행 중이던 작업을 복구하도록 저장(정제하던 명단·단계가 첫 화면으로 날아가는 문제 방지)
  try {
    if (latestWorkSnapshot && latestWorkSnapshot.gridData?.length) {
      sessionStorage.setItem('nexus_work_recover', JSON.stringify(latestWorkSnapshot));
    }
  } catch { /* 용량 초과 등 무시 — 복구 없이 새로고침 */ }
  window.location.reload();
  return true;
};

const lazyWithChunkRecovery = (loader) => lazy(() =>
  loader().catch(async (error) => {
    if (isChunkLoadError(error)) {
      await recoverFromStaleChunk();
      return new Promise(() => {});
    }
    throw error;
  })
);

const mergeUniqueText = (...parts) => {
  const tokens = [];
  for (const part of parts) {
    const text = String(part || '').trim();
    if (!text) continue;
    if (tokens.some(existing => existing === text || existing.includes(text))) continue;
    tokens.push(text);
  }
  return tokens.join(' ').trim();
};

// 비고 → 특이사항: 배송에 필요한 '세부 주소·배송 안내'만 추출한다.
// 예) 가져옴: "2층 301호", "쪽문 돌아 첫번째 문", "경비실 맡김", "부재시 문앞"
//     버림:  "현금 공제", "환급 신청", "소득 자격" 등 행정·재정 잡음(쓰레기 데이터 방지)
const NOTE_JUNK_RE = /현금|공제|환급|환수|납부|미납|체납|정산|소득|재산|계좌|지원금|보조금|바우처|포인트|감액|증액|신청|자격|선정|해지|중지|자부담|본인부담|급여|연금|결제|등급|세대주|주민번호/;
const NOTE_DELIVERY_RE = /(\d+\s*층)|(\d+\s*호)|(\d+\s*동)|지하|반지하|지층|지하층|옥탑|옥상|문|경비|부재|계단|엘리베|승강기|E\/?V|현관|대문|쪽문|뒷문|우편함|택배|방문|호출|초인종|벨|인터폰|골목|주차|복도|단지|빌라|연립|다세대|상가|사무실|별채|돌아|첫번째|두번째|세번째|끝집|모퉁이|올라|내려|좌측|우측|왼쪽|오른쪽|맡(겨|김|기)/;
const extractDeliveryNote = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return '';
  // 쉼표·슬래시·세미콜론·줄바꿈·중점으로 세그먼트 분리 → 배송 신호 있고 잡음 없는 세그먼트만 유지
  const segs = text.split(/[,/;·\n]+/).map(s => s.trim()).filter(Boolean);
  const kept = segs.filter(s => NOTE_DELIVERY_RE.test(s) && !NOTE_JUNK_RE.test(s));
  return kept.join(' ').trim();
};

const ADDRESS_DISPLAY_MODES = {
  PAREN_BEFORE_DETAIL: 'parenBeforeDetail',
  DETAIL_BEFORE_PAREN: 'detailBeforeParen',
};

const findTopLevelSeparator = (value) => {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === ',' || ch === '/')) return i;
  }
  return -1;
};

const cleanAddressPiece = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .replace(/^[,\s/]+|[,\s/]+$/g, '')
  .trim();

const parseDisplayedAddress = (address) => {
  const text = cleanAddressPiece(address);
  if (!text) return { road: '', detail: '', paren: '' };
  const sepIdx = findTopLevelSeparator(text);
  const road = sepIdx >= 0 ? cleanAddressPiece(text.slice(0, sepIdx)) : text;
  const rest = sepIdx >= 0 ? cleanAddressPiece(text.slice(sepIdx + 1)) : '';
  const parenMatch = rest.match(/\(([^)]*)\)/);
  const paren = parenMatch ? cleanAddressPiece(parenMatch[1]) : '';
  const detail = parenMatch
    ? cleanAddressPiece(`${rest.slice(0, parenMatch.index)} ${rest.slice(parenMatch.index + parenMatch[0].length)}`)
    : cleanAddressPiece(rest);
  return { road, detail, paren };
};

const roadFromAddressMeta = (row) => {
  const roadName = cleanAddressPiece(row?._roadName || row?.roadName || '');
  const mainNo = cleanAddressPiece(row?._buildingMainNo ?? row?.buildingMainNo ?? '');
  const subNoRaw = cleanAddressPiece(row?._buildingSubNo ?? row?.buildingSubNo ?? '');
  const subNo = subNoRaw && subNoRaw !== '0' ? `-${subNoRaw}` : '';
  return roadName && mainNo ? `${roadName} ${mainNo}${subNo}` : '';
};

const addressPartsFromRow = (row) => {
  const parsed = parseDisplayedAddress(row?.주소 || '');
  const legalDong = cleanAddressPiece(row?._legalDong || row?.legalDong || '');
  const buildingName = cleanAddressPiece(row?._buildingName || row?.buildingName || '');
  const paren = parsed.paren || [legalDong, buildingName].filter(Boolean).join(', ');
  const metaDetail = cleanAddressPiece(row?._detailAddress || row?.detailAddress || '');
  const road = parsed.road || roadFromAddressMeta(row);
  // 괄호 없는 정제결과(예: "한빛로 49 201- 302호")는 parsed.road가 동·호수까지 먹는다.
  // 이때 _detailAddress를 다시 붙이면 "...201- 302호, 201- 302호" 중복 → road에 이미 있으면 사용 안 함.
  const detail = parsed.detail || (metaDetail && !road.includes(metaDetail) ? metaDetail : '');
  return { road, detail, paren };
};

const formatAddressForDisplayMode = (row, mode) => {
  const { road, detail, paren } = addressPartsFromRow(row);
  if (!road) return row?.주소 || '';
  const parenStr = paren ? `(${paren})` : '';
  if (mode === ADDRESS_DISPLAY_MODES.DETAIL_BEFORE_PAREN) {
    if (detail && parenStr) return `${road}, ${detail} ${parenStr}`;
    if (detail) return `${road}, ${detail}`;
    if (parenStr) return `${road}, ${parenStr}`;
    return road;
  }
  if (parenStr && detail) return `${road}, ${parenStr} ${detail}`;
  if (parenStr) return `${road}, ${parenStr}`;
  if (detail) return `${road}, ${detail}`;
  return road;
};

// ── 지연 로드 (버튼 클릭 시 처음 필요 — 초기 번들에서 제외)
const AdminPanel            = lazyWithChunkRecovery(() => import("./components/AdminPanel.jsx"));
const HelpModal             = lazyWithChunkRecovery(() => import("./components/HelpModal.jsx"));
const UpgradeModal          = lazyWithChunkRecovery(() => import("./components/UpgradeModal.jsx"));
const UtilsModal            = lazyWithChunkRecovery(() => import("./components/UtilsModal.jsx"));
const CloudBaseModal        = lazyWithChunkRecovery(() => import("./components/CloudBaseModal.jsx"));
const DbImportModal         = lazyWithChunkRecovery(() => import("./components/DbImportModal.jsx"));
const BaseListManager       = lazyWithChunkRecovery(() => import("./components/BaseListManager.jsx"));
const CloudListManager      = lazyWithChunkRecovery(() => import("./components/CloudListManager.jsx"));
const ErrorListManager      = lazyWithChunkRecovery(() => import("./components/ErrorListManager.jsx"));
const DbOverview            = lazyWithChunkRecovery(() => import("./components/DbOverview.jsx"));
const PrevMonthCompareModal = lazyWithChunkRecovery(() => import("./components/PrevMonthCompareModal.jsx"));
const RouteMapModal         = lazyWithChunkRecovery(() => import("./components/RouteMapModal.jsx"));
const RouteSetupModal       = lazyWithChunkRecovery(() => import("./components/RouteSetupModal.jsx"));
const RouteQuickModal       = lazyWithChunkRecovery(() => import("./components/RouteQuickModal.jsx"));
const DriverRegistryModal   = lazyWithChunkRecovery(() => import("./components/DriverRegistryModal.jsx"));
const SavedRecordsModal     = lazyWithChunkRecovery(() => import("./components/SavedRecordsModal.jsx"));
const ScheduleTab           = lazyWithChunkRecovery(() => import("./components/ScheduleTab.jsx"));

import { processAddress, asyncPool, addTypoRecord, loadTypoDict } from "./engine/addressEngine.js";
import { parsePhoneNumbers, parseSMS, parseBirthDate, normalizeBirth, extractPhoneNote, formatPhone } from "./utils/parsers.js";
import { canUseRouteMap, canUseDbOverview, getMonthlyLimit } from "./utils/tierUtils.js";
import { getCachedCoord, saveCoordCache } from "./utils/coordCache.js";
import { guardAddressDetail } from "./utils/addressFormat.js";
import { buildStepStatus, getVisibleWorkflowSteps, getWorkflowMeta, getWorkflowMode, WORKFLOW_STEP_LABELS } from "./utils/workflow.js";
import { LogOut, ShieldCheck, Database, Crown, Layers, UserCircle, Undo2, BarChart3, MapPin, Truck, CalendarDays, FileSpreadsheet, Home, ChevronLeft, ChevronRight, BookOpen, HardDrive, HelpCircle } from "lucide-react";

// 등급별 사용설명서 열기 — 게스트/일반(무료)=무료가이드, VIP↑(유료)=유료가이드(따라하기). 두 문서는 상호 링크됨.
const openManualFor = (tier) => {
  const paid = ['vip', 'vvip', 'sapphire'].includes(tier);
  window.open(paid ? '/manual-paid.html' : '/manual-free.html', '_blank', 'noopener');
};

export default function App() {
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(true);
  const [authStatus, setAuthStatus] = useState('checking');
  const [guestMode, setGuestMode] = useState(false); // 무료 체험: 로그인 없이 정제+다운로드
  const guestModeRef = useRef(false); // onAuthStateChanged 클로저에서 최신 guestMode 참조용
  const [authLoading, setAuthLoading] = useState(false);
  const [step, setStep] = useState(1); // 첫 화면 = 파일 업로드(명단 정제). 지자체 현황은 상단 버튼/홈으로 이동
  const [fileInfo, setFileInfo] = useState(null);
  const [worksheets, setWorksheets] = useState([]);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [pendingSetup, setPendingSetup] = useState(null); // { sheetsData, detectedCity, monthStr, initialSel }
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [cleanMode, setCleanMode] = useState('easy');      // 'easy'(초보) | 'advanced'(고급)
  const [showEasyConfirm, setShowEasyConfirm] = useState(false); // 쉬운 정제 확인 카드
  const [easyRun, setEasyRun] = useState(false);           // 쉬운 정제: 상태 세팅 후 자동 분석 트리거
  const [operatorName, setOperatorName] = useState('');    // 담당자 이름(업로드 전 확인)
  const [selectedCity, setSelectedCity] = useState('');    // 업로드 전 선택한 지자체
  const [analyzing, setAnalyzing] = useState(false);       // 파일 정밀 분석 중(3D 오버레이용)
  const [analysisSummary, setAnalysisSummary] = useState(null); // 정밀 분석 요약(명단/제외 시트·잡음행)
  const [aiRules, setAiRules] = useState(null);
  const [mapDefs, setMapDefs] = useState({});
  const [gridData, setGridData] = useState([]);
  const [addressDisplayMode, setAddressDisplayMode] = useState(ADDRESS_DISPLAY_MODES.DETAIL_BEFORE_PAREN);
  const [workflowMode, setWorkflowMode] = useState(() => {
    try { return localStorage.getItem('nexus_workflow_mode_v1') || 'cleaningOnly'; }
    catch { return 'cleaningOnly'; }
  });
  const [sortConfig, setSortConfig] = useState({ key: '', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(500);

  const isBaseUploading = false;
  const [engineProgress, setEngineProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [progressLogs, setProgressLogs] = useState([]);
  const [filter, _setFilter] = useState({ text: "", showErrorsOnly: false, showSuccessOnly: false, 구분: '', dong: '', driver: '', noDriver: false, hasNote: false, inferredAddress: false });
  // setFilter는 항상 페이지를 1로 리셋 (React 18 자동 배칭으로 단일 렌더)
  const setFilter = (v) => { _setFilter(v); setCurrentPage(1); };
  const [purifyResult, setPurifyResult] = useState(null);
  const [prevMonthCompare, setPrevMonthCompare] = useState(null); // { warnings, changes, newCount, leftCount }
  const [showPrevCompare, setShowPrevCompare] = useState(false);
  const [colVis] = useState({});
  const [baseCount, setBaseCount] = useState(0);
  const [baseMap, setBaseMap] = useState(null);
  const [importFields, setImportFields] = useState(null); // null = 전체 이식, Set = 선택 필드만
  const [dbImportReady, setDbImportReady] = useState(null); // { count, fields }
  const [showDbImport, setShowDbImport] = useState(false);
  const [dbNavCity, setDbNavCity] = useState(''); // DB Overview에서 지자체 선택 후 관리 화면 이동
  const [isBasePurifyMode, setIsBasePurifyMode] = useState(false);
  const [isSavingBaseList, setIsSavingBaseList] = useState(false);
  const isSavingBaseListRef = useRef(false);
  const [isFetchingNotes, setIsFetchingNotes] = useState(false);
  // ── 전역 로딩 게이지 ─────────────────────────────────────────────
  const [gLoad, setGLoad] = useState({ show: false });
  const gLoadTimerRef = useRef(null);
  const bgSaveCoordCancelRef = useRef(false);
  const [bgSaveCoordState, setBgSaveCoordState] = useState(null);
  const gStart = (msg, sub = '', pct = null) => setGLoad({ show: true, msg, sub, pct, done: false });
  const gUpdate = (pct, sub) => setGLoad(p => ({ ...p, pct, ...(sub !== undefined ? { sub } : {}) }));
  const gDone = (msg = '완료!') => {
    if (gLoadTimerRef.current) clearTimeout(gLoadTimerRef.current);
    setGLoad({ show: true, msg, sub: '', pct: 100, done: true });
    gLoadTimerRef.current = setTimeout(() => setGLoad({ show: false }), 2200);
  };

  const [showIntro, setShowIntro] = useState(false);
  const [introReason, setIntroReason] = useState('new'); // 'new' | 'region' | 'upgrade'
  const [introMeta, setIntroMeta] = useState({}); // { region, tier } 등 이유별 추가 정보
  const inqUnsubRef = useRef(null);
  const userUnsubRef = useRef(null); // user 문서 실시간 구독 해제용

  const DEFAULT_EXPORT_COLS = [
    { key: 'NO',      label: 'NO',      on: true },
    { key: '구분',    label: '구분',    on: true },
    { key: '행정동',  label: '읍면동',  on: true },
    { key: '리',      label: '리',      on: true },
    { key: '이름',    label: '이름',    on: true },
    { key: '주소',    label: '주소',    on: true },
    { key: '휴대폰',  label: '휴대폰',  on: true },
    { key: '유선전화',label: '유선전화',on: true },
    { key: '포수',    label: '포수',    on: true },
    { key: '특이사항',label: '특이사항',on: true },
    { key: '문자수신',label: '문자수신',on: true },
    { key: '생년월일',label: '생년월일',on: true },
    { key: '기사',    label: '기사',    on: true },
    { key: '배송순번',label: '배송순번',on: true },
    { key: '사유',    label: '사유',    on: true },
    { key: '품명',    label: '품명',    on: false },
  ];
  // 기본 칼럼 순서 버전 — 올리면 저장된 옛 순서를 1회 새 DEFAULT로 강제 교체(이후 편집·폭은 유지)
  const DEFAULT_COLS_VERSION = 2;
  const [exportColOrder, setExportColOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('nexus_export_cols_v2');
      const ver = localStorage.getItem('nexus_export_cols_ver');
      // 버전 일치할 때만 저장값 유지(라벨만 최신화). 불일치=구버전 → 새 DEFAULT 강제 적용
      if (saved && ver === String(DEFAULT_COLS_VERSION)) return refreshSavedCols(JSON.parse(saved), DEFAULT_EXPORT_COLS);
    } catch { /* ignore */ }
    return DEFAULT_EXPORT_COLS;
  });

  const [, setShowExportSetting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // 기기 간 칼럼설정 동기화용 refs
  const lastSyncedColsRef = useRef(null); // Firestore와 마지막 동기화한 칼럼설정 JSON (에코 루프 방지)
  const colSyncTimerRef = useRef(null);   // Firestore 쓰기 디바운스 타이머

  // exportColOrder 변경 시: localStorage 즉시 저장(+버전) + (로그인 시) Firestore 디바운스 저장
  useEffect(() => {
    try {
      localStorage.setItem('nexus_export_cols_v2', JSON.stringify(exportColOrder));
      localStorage.setItem('nexus_export_cols_ver', String(DEFAULT_COLS_VERSION));
    } catch { /* ignore */ }
    if (!user?.uid) return;
    const json = JSON.stringify(exportColOrder);
    if (json === lastSyncedColsRef.current) return; // 원격에서 받은 값이면 되쓰기 안 함
    clearTimeout(colSyncTimerRef.current);
    colSyncTimerRef.current = setTimeout(() => {
      lastSyncedColsRef.current = json;
      updateDoc(doc(db, 'users', user.uid), { exportColOrder, exportColsVer: DEFAULT_COLS_VERSION }).catch(() => {
        setDoc(doc(db, 'users', user.uid), { exportColOrder, exportColsVer: DEFAULT_COLS_VERSION }, { merge: true }).catch(() => { /* ignore */ });
      });
    }, 1500);
    return () => clearTimeout(colSyncTimerRef.current);
  }, [exportColOrder, user?.uid]);

  // 다른 기기에서 바뀐 칼럼설정을 user 문서 실시간 구독(onSnapshot)으로 수신 → 로컬 반영
  useEffect(() => {
    const remote = user?.exportColOrder;
    if (!Array.isArray(remote) || remote.length === 0) return;
    if (user?.exportColsVer !== DEFAULT_COLS_VERSION) return; // 구버전 서버값 무시 → 새 DEFAULT 유지 후 덮어씀
    const remoteJson = JSON.stringify(remote);
    if (remoteJson === lastSyncedColsRef.current) return; // 이미 반영됨(에코 방지)
    lastSyncedColsRef.current = remoteJson;
    // 라벨·메타는 DEFAULT 기준 최신화, on·width·순서는 원격값 유지(새 키 append)
    setExportColOrder(refreshSavedCols(remote, DEFAULT_EXPORT_COLS));
  }, [user?.exportColOrder, user?.exportColsVer]);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState('city_limit');
  const [showUtils, setShowUtils] = useState(false);
  const [showCloudBase, setShowCloudBase] = useState(false);
  const [showRouteMap, setShowRouteMap] = useState(false);
  const [showRouteSetup, setShowRouteSetup] = useState(false);
  const [showRouteQuick, setShowRouteQuick] = useState(false);
  const [cloudRouteConfig, setCloudRouteConfig] = useState(null);
  const [routeSetupResult, setRouteSetupResult] = useState(null);
  const [routeBackToMatch, setRouteBackToMatch] = useState(false); // 지도→이전화면 복귀 시 setup을 match 단계로
  const [shareParams] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('r');
    return r ? { shareId: r, driverId: p.get('d') || null } : null;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showDriverRegistry, setShowDriverRegistry] = useState(false);
  const [showSavedRecords, setShowSavedRecords] = useState(false);
  const [profileModal, setProfileModal] = useState({ open: false, isNew: false });
  const [pendingInquiriesCount, setPendingInquiriesCount] = useState(0);

  // History & Undo State
  const [history, setHistory] = useState([]);
  const pushHistory = (newData) => {
    setHistory(prev => {
      const next = [...prev, gridData];
      if (next.length > 10) next.shift(); // Keep last 10
      return next;
    });
    setGridData(newData);
  };

  const workflow = getWorkflowMode(workflowMode);
  const stepStatus = useMemo(
    () => buildStepStatus({ step, gridData, fileInfo, worksheets }),
    [step, gridData, fileInfo, worksheets]
  );
  const workflowSteps = useMemo(() => getVisibleWorkflowSteps(workflowMode), [workflowMode]);
  const workflowMeta = useMemo(() => getWorkflowMeta(workflowMode, stepStatus), [workflowMode, stepStatus]);
  const changeWorkflowMode = (mode) => {
    const next = getWorkflowMode(mode).id;
    setWorkflowMode(next);
    try { localStorage.setItem('nexus_workflow_mode_v1', next); } catch { /* ignore */ }
  };
  const openRouteFlow = () => {
    if (!canUseRouteMap(user)) {
      setUpgradeReason('routeMap');
      setShowUpgrade(true);
      return;
    }
    if (workflowMode !== 'deliveryFull') changeWorkflowMode('deliveryFull');
    setCloudRouteConfig(null);
    setShowRouteSetup(true);
  };
  
  const handleUndo = () => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setGridData(last);
      return prev.slice(0, -1);
    });
  };

  // ── 작업 보존: 스테일청크 복구 새로고침 대비 진행상태 스냅샷(module 변수에 최신 유지) ──
  useEffect(() => {
    if (gridData.length || step >= 2) latestWorkSnapshot = { gridData, fileInfo, step, mapDefs };
  }, [gridData, fileInfo, step, mapDefs]);

  // ── 복구 새로고침 후 진행상태 복원(로그인 확정 후 1회). workflowMode는 localStorage로 이미 생존 ──
  const workRestoredRef = useRef(false);
  useEffect(() => {
    if (workRestoredRef.current || !user) return;
    let raw = null;
    try { raw = sessionStorage.getItem('nexus_work_recover'); } catch { /* ignore */ }
    if (!raw) return;
    workRestoredRef.current = true;
    try {
      sessionStorage.removeItem('nexus_work_recover');
      const w = JSON.parse(raw);
      if (w?.gridData?.length) {
        setGridData(w.gridData);
        if (w.fileInfo) setFileInfo(w.fileInfo);
        if (w.mapDefs) setMapDefs(w.mapDefs);
        setStep(Number(w.step) || 5);
        // 복원 완료 — App엔 토스트 시스템이 없어 조용히 복구(작업이 그대로 돌아옴)
      }
    } catch { /* 복원 실패 무시 */ }
  }, [user]);

  useEffect(() => {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.type = "image/png"; link.href = "ttongpa.png";
    document.title = `NEXUS PIPELINE ${APP_VERSION}`;

    // 주소 캐시 만료 항목 백그라운드 정리 (비동기, 앱 동작과 무관)
    cleanupExpiredCache();

    // 리다이렉트 로그인 복귀 처리 (모바일/팝업 차단 환경 fallback)
    if (localStorage.getItem('nexus_auth_redirect_v1')) {
      localStorage.removeItem('nexus_auth_redirect_v1');
      getRedirectResult(auth).catch(err => {
        console.error('Redirect result error:', err);
        setAuthLoading(false);
        if (err?.code !== 'auth/null-user') {
          alert('Google 로그인에 실패했습니다.\n오류코드: ' + (err?.code || err?.message));
        }
      });
    }

    const unsub = onAuthStateChanged(auth, async u => {
      if (u) {
        // 유저 문서 없으면 즉시 생성 (신규 회원 — 리다이렉트 로그인 포함)
        const userRef = doc(db, "users", u.uid);
        const d = await getDoc(userRef);
        let userData = d.exists() ? d.data() : {};
        if (!d.exists()) {
          await setDoc(userRef, {
            email: u.email,
            name: u.displayName,
            lastLogin: serverTimestamp(),
            role: "user",
            tier: "basic"
          });
        } else {
          updateDoc(userRef, { lastLogin: serverTimestamp() }).catch(() => {});
        }
        
        const ADMIN_EMAILS = ['ttong627@gmail.com'];
        const isAdminEmail = ADMIN_EMAILS.includes(u.email);

        // 1. 최고 관리자 계정이 일반 유저로 꼬여있다면 복구 (Root Cause Fix)
        if (isAdminEmail && (userData.role !== 'admin' || userData.tier !== 'sapphire' || (userData.maxCities ?? 0) < 999)) {
          await setDoc(doc(db, "users", u.uid), { role: "admin", tier: "sapphire", maxCities: 999 }, { merge: true });
          userData.role = 'admin';
          userData.tier = 'sapphire';
          userData.maxCities = 999;
        }

        // 2. 관리자가 아닌데 이전 찌꺼기 코드 탓에 관리자가 된 일반 유저 강등 (보안)
        if (!isAdminEmail && userData.role === 'admin') {
          await setDoc(doc(db, "users", u.uid), { role: "user", tier: "basic" }, { merge: true });
          userData.role = 'user';
          userData.tier = 'basic';
        }

        // 3. 미매칭 사용자: 기업 자동생성 안 함.
        //    관리자가 기업에 매칭하기 전까지는 일반(basic) 1개만 허용하며, 매칭 시
        //    기업의 등급·지역·한도를 상속한다(모든 권한은 기업에서). 기사 데이터는
        //    companyCode 없으면 user_drivers/{uid} 폴백으로 정상 동작.

        setUser({ ...u, ...userData });

        // ── 세션 최초 진입 시 프리미엄 3D 인트로 강제 표출 ──
        const sessionKey = 'nexus_session_intro_shown';
        if (!sessionStorage.getItem(sessionKey)) {
          sessionStorage.setItem(sessionKey, '1');
          setIntroReason('new');
          setIntroMeta({ region: userData.citiesApproved?.[0] || '' });
          setShowIntro(true);
        }

        // 사용자 문서 실시간 구독 — totalRowsProcessed 등 통계 즉시 반영
        if (userUnsubRef.current) userUnsubRef.current();
        userUnsubRef.current = onSnapshot(doc(db, 'users', u.uid), snap => {
          if (snap.exists()) {
            setUser(prev => prev ? { ...prev, ...snap.data() } : null);
          }
        });

        // 티어 승급 감지 (관리자 제외)
        if (!isAdminEmail && userData.profileCompleted) {
          const TIER_RANK = { basic: 0, vip: 1, vvip: 2, sapphire: 3 };
          const storedTier = localStorage.getItem('nexus_last_tier_v1');
          const currentTier = userData.tier || 'basic';
          if (storedTier && (TIER_RANK[currentTier] ?? 0) > (TIER_RANK[storedTier] ?? 0)) {
            setIntroReason('upgrade');
            setIntroMeta({ tier: currentTier });
            setShowIntro(true);
          }
          localStorage.setItem('nexus_last_tier_v1', currentTier);
        }

        if (!userData.profileCompleted) {
          setProfileModal({ open: true, isNew: !d.exists() });
        }
        
        if (userData.role === 'admin') {
          const q = query(collection(db, "inquiries"), where("status", "==", "pending"));
          if (inqUnsubRef.current) inqUnsubRef.current();
          inqUnsubRef.current = onSnapshot(q, snap => setPendingInquiriesCount(snap.size));
        }
        
        const rulesDoc = await getDoc(doc(db, "nexus_config", "ai_rules"));
        if (rulesDoc.exists()) setAiRules(sanitizeAiRules(rulesDoc.data()));
        
        await loadTypoDict();
        
        setShowAuth(false);
        setAuthStatus('authenticated');
      } else {
        if (userUnsubRef.current) { userUnsubRef.current(); userUnsubRef.current = null; }
        setUser(null);
        if (!guestModeRef.current) setShowAuth(true); // 게스트 체험 중이면 로그인 화면으로 쫓아내지 않음
        setAuthStatus('unauthenticated');
        setAuthLoading(false);
      }
    });
    return () => { unsub(); if (inqUnsubRef.current) inqUnsubRef.current(); if (userUnsubRef.current) userUnsubRef.current(); };
  }, []);

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    try {
      if (isMobile) {
        localStorage.setItem('nexus_auth_redirect_v1', '1');
        await signInWithRedirect(auth, provider);
      } else {
        await signInWithPopup(auth, provider);
        setAuthLoading(false); // 팝업 성공 후 로딩 해제
      }
    } catch (error) {
      const isPopupIssue = error.code === 'auth/popup-blocked'
        || error.code === 'auth/popup-closed-by-user'
        || error.code === 'auth/cancelled-popup-request'
        || error.code === 'auth/internal-error';
      if (isPopupIssue && !isMobile) {
        // 팝업 실패 → redirect 자동 전환
        try {
          localStorage.setItem('nexus_auth_redirect_v1', '1');
          await signInWithRedirect(auth, provider);
          return;
        } catch (e2) {
          localStorage.removeItem('nexus_auth_redirect_v1');
          console.error('Redirect fallback error:', e2);
        }
      }
      localStorage.removeItem('nexus_auth_redirect_v1');
      console.error('Login error:', error);
      if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
        alert('Google 로그인에 실패했습니다.\n오류코드: ' + (error?.code || error?.message));
      }
      setAuthLoading(false);
    }
  };

  const sortedData = useMemo(() => {
    let result = [...gridData];
    if (sortConfig.key) {
      result.sort((a, b) => {
        let cmp = String(a[sortConfig.key] || "").localeCompare(String(b[sortConfig.key] || ""), undefined, { numeric: true, sensitivity: 'base' });
        return sortConfig.direction === 'asc' ? cmp : -cmp;
      });
    } else {
      result.sort((a, b) => {
        let cmp = String(a.행정동 || "").localeCompare(String(b.행정동 || ""), undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        // 리(里): 읍/면 하위 단위. 리 없으면 빈값으로 자연 통과(다음 키로 정렬)
        cmp = String(a.리 || "").localeCompare(String(b.리 || ""), undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        cmp = String(a.주소 || "").localeCompare(String(b.주소 || ""), undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return String(a.이름 || "").localeCompare(String(b.이름 || ""), undefined, { numeric: true, sensitivity: 'base' });
      });
    }
    return result;
  }, [gridData, sortConfig]);

  const gridDongList = useMemo(() =>
    [...new Set(gridData.map(r => r.행정동).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })),
  [gridData]);

  const gridDriverList = useMemo(() =>
    [...new Set(gridData.map(r => r.기사).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
  [gridData]);

  const filteredData = useMemo(() => {
    let res = sortedData;
    if (filter.showErrorsOnly) res = res.filter(r => r._에러);
    if (filter.showSuccessOnly) res = res.filter(r => !r._에러);
    if (filter.구분) res = res.filter(r => r.구분 === filter.구분);
    if (filter.dong) res = res.filter(r => (r.행정동 || '') === filter.dong);
    if (filter.driver) res = res.filter(r => (r.기사 || '') === filter.driver);
    if (filter.noDriver) res = res.filter(r => !(r.기사 || '').trim());
    if (filter.hasNote) res = res.filter(r => (r.특이사항 || '').trim());
    if (filter.inferredAddress) res = res.filter(r => r._주소추정 || (r._추정사유 || '').trim() || (r.특이사항 || '').includes('[주소추정]'));
    if (filter.text) {
      const txt = filter.text.toLowerCase();
      res = res.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(txt)));
    }
    return res;
  }, [sortedData, filter]);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(start, start + itemsPerPage);
  }, [filteredData, currentPage, itemsPerPage]);


  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (e) => { e.preventDefault(); handleFileUpload(e); };
  
  const handleFileUpload = async (e) => {
    const file = e.target.files ? e.target.files[0] : e.dataTransfer?.files[0];
    if (!file) return;
    
    // UI 로딩 상태 추가 가능
    setFileInfo({ name: file.name, size: file.size, file });
    
    setAnalyzing(true);
    try {
      const buffer = await file.arrayBuffer();
      const worker = new Worker(new URL("./excelWorker.js", import.meta.url), { type: "module" });

      gStart('파일 분석 중...', file.name);
      worker.postMessage({ action: "PARSE_TARGET", buffer, fileName: file.name, dynamicRules: aiRules });
      worker.onmessage = (evt) => {
        if (evt.data.ok && evt.data.action === "PARSE_TARGET") {
          gDone('파일 분석 완료!');
          setAnalyzing(false);
          const { sheetsData, detectedCity, monthStr, cityCandidates, analysisSummary } = evt.data;

          // §5-2 지자체 허가지역 대조 — 후보 중 userCities와 일치하는 정확한 지자체명 우선
          const approvedCities = user?.citiesApproved || [];
          const normCity = (s) => String(s || '').replace(/\s/g, '');
          const candList = (cityCandidates && cityCandidates.length) ? cityCandidates : (detectedCity ? [detectedCity] : []);
          // 업로드 전 담당자가 직접 고른 지자체(selectedCity)가 최우선
          let resolvedCity = selectedCity || detectedCity;
          const hit = approvedCities.find(uc => candList.some(c => {
            const nc = normCity(c), nu = normCity(uc);
            const cTok = String(c).split(/\s+/).pop(); // 시군구 토큰
            return nc === nu || nu.includes(normCity(cTok)) || nc.includes(nu);
          }));
          if (!selectedCity && hit) resolvedCity = hit;

          const initialSel = {};
          sheetsData.forEach(s => {
            const getHeader = (k) => {
              const idx = s.colIndices?.[k];
              return (idx !== undefined && idx !== -1) ? s.headers[idx] : "";
            };
            const sheetKey = s.fileSource ? `${s.fileSource}::${s.name}` : s.name;
            initialSel[sheetKey] = {
              name: getHeader('이름'),
              address: getHeader('주소'),
              qty: getHeader('수량'),
              contact1: getHeader('연락처'),
              contact2: getHeader('보조연락처'),
              admin: getHeader('행정동'),
              itemName: getHeader('품명'),
              note: getHeader('비고'),
              birth: getHeader('생년월일'),
              sms: getHeader('문자수신'),
              type: (s.typeColIdx >= 0) ? s.headers[s.typeColIdx] : "",
            };
          });

          // AI 자가 진화 서버 - 누락된 컬럼을 관리자 패널로 전송
          sheetsData.forEach(sheet => {
            if (sheet.unmappedCols && sheet.unmappedCols.length > 0) {
              sheet.unmappedCols.forEach(async (col) => {
                try {
                  await addDoc(collection(db, "nexus_ai_logs"), {
                    columnName: String(col).slice(0, 100).replace(/[<>&"'`]/g, ''),
                    status: "pending",
                    detectedAt: serverTimestamp(),
                    fileName: String(file.name).slice(0, 200),
                    sheetName: String(sheet.name).slice(0, 100),
                    expireAt: ttl90(),
                  });
                } catch (e) {
                  console.error("AI Log upload failed:", e);
                }
              });
            }
          });

          // 이번 업로드에 포함된 구분(수급자/차상위)별 인원 — 모달에서 "이번 업로드: 수급자 N명" 확인 + 기존현황 비교용
          const uploadCounts = { 기초수급자: 0, 차상위: 0 };
          sheetsData.forEach(sh => {
            const rows = sh.bodyRows || [];
            const ti = sh.typeColIdx;
            if (sh.type === '혼합' && ti >= 0) {
              rows.forEach(r => {
                const v = String(r[ti] || '');
                if (/차상위/.test(v)) uploadCounts.차상위++;
                else if (/수급|기초|생계|의료/.test(v)) uploadCounts.기초수급자++;
              });
            } else if (sh.type === '기초수급자') uploadCounts.기초수급자 += rows.length;
            else if (sh.type === '차상위') uploadCounts.차상위 += rows.length;
          });
          const uploadGubuns = [];
          if (uploadCounts.기초수급자 > 0) uploadGubuns.push('기초수급자');
          if (uploadCounts.차상위 > 0) uploadGubuns.push('차상위');
          // 지자체·적용월 확인 모달 표시 (허가지역 대조된 resolvedCity 사용)
          setPendingSetup({ sheetsData, detectedCity: resolvedCity, monthStr, initialSel, analysisSummary, uploadGubuns, uploadCounts });
          setShowCityPicker(true);
        } else if (!evt.data.ok) {
          setGLoad({ show: false });
          setAnalyzing(false);
        alert("파일 분석 중 오류가 발생했습니다: " + evt.data.error);
        }
        worker.terminate();
      };
    } catch {
      setGLoad({ show: false });
      setAnalyzing(false);
      alert("파일을 읽는 중 오류가 발생했습니다.");
    }
  };

  const handleCityMonthConfirm = (city, monthYYYYMM) => {
    const { sheetsData, initialSel, analysisSummary: summary } = pendingSetup || {};
    if (!sheetsData) return;
    setFileInfo(prev => ({ ...prev, city, month: monthYYYYMM, operatorName }));
    setWorksheets(sheetsData);
    setMapDefs(initialSel);
    setAnalysisSummary(summary || null);
    setShowCityPicker(false);
    setPendingSetup(null);
    if (cleanMode === 'easy') {
      // 명단 시트만 자동 선택(통계·안내 제외) + 워커의 중복시트 해제(selected===false) 반영 → 동일명단 2~3중 중복 방지.
      const roster = sheetsData.filter(s => s.isRosterSheet && s.selected !== false);
      const rosterAll = sheetsData.filter(s => s.isRosterSheet);
      setSelectedSheets(roster.length ? roster : (rosterAll.length ? rosterAll : sheetsData));
      setShowEasyConfirm(true);       // 쉬운 정제 확인 카드(요약 + 노랑만 확인)
    } else {
      setStep(2);                     // 고급: 시트선택 → 매핑 검토
    }
  };

  // 쉬운 정제 확인 카드 → [정제 시작]: 매핑 확정 후 자동 분석
  const handleEasyConfirm = (finalMapDefs, chosenSheetNames) => {
    if (finalMapDefs) setMapDefs(finalMapDefs);
    // 중복 시트군에서 사용자가 고른 시트만 처리(동일명단 2~3중 중복 방지)
    if (Array.isArray(chosenSheetNames) && chosenSheetNames.length) {
      const pick = worksheets.filter(s => chosenSheetNames.includes(s.name));
      if (pick.length) setSelectedSheets(pick);
    }
    setShowEasyConfirm(false);
    setEasyRun(true); // selectedSheets 준비되면 useEffect가 handleAnalyzeAll 실행
  };
  const handleEasyToAdvanced = () => {
    setShowEasyConfirm(false);
    setStep(2); // 고급 모드(시트선택/매핑)로 전환
  };

  const handleCityMonthCancel = () => {
    setShowCityPicker(false);
    setPendingSetup(null);
  };

  const handleSecondFileUpload = async (file) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const worker = new Worker(new URL("./excelWorker.js", import.meta.url), { type: "module" });
      worker.postMessage({ action: "PARSE_TARGET", buffer, fileName: file.name, dynamicRules: aiRules });
      worker.onmessage = (evt) => {
        if (evt.data.ok && evt.data.action === "PARSE_TARGET") {
          const { sheetsData } = evt.data;
          // 파일 출처 태깅 — 같은 시트명이라도 파일별 고유 key를 갖도록 (mapDefs 충돌 방지)
          const taggedSheets = sheetsData.map(s => ({ ...s, fileSource: file.name }));
          setWorksheets(prev => [...prev, ...taggedSheets]);

          const initialSel = {};
          taggedSheets.forEach(s => {
            const getHeader = (k) => {
              const idx = s.colIndices?.[k];
              return (idx !== undefined && idx !== -1) ? s.headers[idx] : "";
            };
            const sk = `${s.fileSource}::${s.name}`;
            initialSel[sk] = {
              name: getHeader('이름'),
              address: getHeader('주소'),
              qty: getHeader('수량'),
              contact1: getHeader('연락처'),
              contact2: getHeader('보조연락처'),
              admin: getHeader('행정동'),
              itemName: getHeader('품명'),
              note: getHeader('비고'),
              birth: getHeader('생년월일'),
              sms: getHeader('문자수신'),
              type: (s.typeColIdx >= 0) ? s.headers[s.typeColIdx] : "",
            };
          });
          setMapDefs(prev => ({ ...prev, ...initialSel }));

          taggedSheets.forEach(sheet => {
            if (sheet.unmappedCols && sheet.unmappedCols.length > 0) {
              sheet.unmappedCols.forEach(async (col) => {
                try {
                  await addDoc(collection(db, "nexus_ai_logs"), {
                    columnName: String(col).slice(0, 100).replace(/[<>&"'`]/g, ''),
                    status: "pending", detectedAt: serverTimestamp(),
                    fileName: String(file.name).slice(0, 200), sheetName: String(sheet.name).slice(0, 100),
                    expireAt: ttl90(),
                  });
                } catch (e) { console.error("AI Log upload failed:", e); }
              });
            }
          });
        } else if (!evt.data.ok) {
          alert("추가 파일 분석 중 오류가 발생했습니다: " + evt.data.error);
        }
        worker.terminate();
      };
    } catch {
      alert("추가 파일을 읽는 중 오류가 발생했습니다.");
    }
  };

  const handleUnifiedDrop = (e) => { handleDrop(e); };

  const handleUserMapping = async (columnName, mappedToField) => {
    try {
      await addDoc(collection(db, 'nexus_ai_logs'), {
        type: 'user_mapping',
        columnName: String(columnName).slice(0, 100),
        mappedTo: String(mappedToField).slice(0, 50),
        loggedAt: serverTimestamp(),
        userEmail: user?.email || 'unknown',
        city: fileInfo?.city || '',
        expireAt: ttl90(),
      });
    } catch (e) {
      console.error('user_mapping log failed:', e);
    }
  };

  // 같은 도로명+번호 주소의 () 건물명을 통일 (A-25)
  // 규칙: 동명은 각 레코드 유지, 건물명만 최빈값으로 통일
  // 예: "장한로27길 29, 805호 (장안동)"과 "장한로27길 29, 301호 (장안동, 두리빌딩)"
  //      → 둘 다 "(장안동, 두리빌딩)"으로 통일
  const unifyParenContent = (rows) => {
    const DONG_NAME_RE = /^[가-힣][가-힣\d]*(읍|면|동)$/; // 한글 시작 행정동명 (숫자 시작 건물동호 제외)

    // 도로명+번호 키 — 공백 제거 후 비교 (쉼표·괄호 위치 무관하게 같은 도로로 묶음)
    const getRoadKey = (addr) => {
      const clean = (addr || '').replace(/\s+/g, '');
      const m = clean.match(/[가-힣\d]+(대로|로|길)[가-힣\d]*\d+(?:-\d+)?/);
      return m ? m[0] : null;
    };

    // 동명 번호 접미어 제거 (답십리2동 → 답십리동) — 법정동 표기 통일
    const normDong = (d) => d ? d.replace(/^([가-힣]+)\d+(동)$/, '$1$2') : '';

    // () 내부 동명 / 건물명 분리
    const splitParenInner = (inner) => {
      const parts = inner.split(/,\s*/);
      const rawDong = parts.find(p => DONG_NAME_RE.test(p.trim())) || '';
      const dong = normDong(rawDong.trim());
      const bd   = parts.filter(p => p.trim() && !DONG_NAME_RE.test(p.trim())).join(', ');
      return { dong, bd };
    };

    // 그룹핑 (도로명+번호 기준)
    const groupMap = new Map();
    rows.forEach(row => {
      const key = getRoadKey(row.주소 || '');
      if (!key || key.length < 4) return;
      const pm    = (row.주소 || '').match(/\(([^)]*)\)/);
      const inner = pm ? pm[1].trim() : null;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push({ row, inner });
    });

    for (const [, entries] of groupMap) {
      if (entries.length < 2) continue;

      // 건물명 최빈값 (빈도 우선, 동률 시 길이 우선)
      const freq = new Map();
      for (const { inner } of entries) {
        if (!inner) continue;
        const { bd } = splitParenInner(inner);
        if (bd) freq.set(bd, (freq.get(bd) || 0) + 1);
      }
      if (!freq.size) continue;

      let bestBd = '', bestCnt = 0, bestLen = 0;
      for (const [bd, cnt] of freq) {
        if (cnt > bestCnt || (cnt === bestCnt && bd.length > bestLen)) {
          bestBd = bd; bestCnt = cnt; bestLen = bd.length;
        }
      }
      if (!bestBd) continue;

      // 건물명 보완 — 기존 건물명이 있으면 절대 덮어쓰지 않는다(은혜빌라↔밀림장 오변경 방지).
      // 같은 지번에 여러 빌라동(밀림장·은혜빌라)이 공존할 수 있으므로 최빈값 통일은 '빈 레코드 보완'에만 적용.
      for (const { row } of entries) {
        const addr = row.주소 || '';
        const pm   = addr.match(/\(([^)]*)\)/);
        if (!pm) {
          // 괄호 없는 레코드: `, (건물명)` 추가 (쉼표 필수)
          row.주소 = `${addr}, (${bestBd})`;
          continue;
        }
        const { dong, bd } = splitParenInner(pm[1]);
        if (bd) continue; // 이미 건물명 있음 → 원본 그대로 보존 (덮어쓰기 금지)
        const newInner = [dong, bestBd].filter(Boolean).join(', ');
        if (newInner !== pm[1].trim()) {
          row.주소 = addr.replace(/\([^)]*\)/, `(${newInner})`);
        }
      }
    }
  };

  const handleAnalyzeAll = async () => {
    if (!selectedSheets || selectedSheets.length === 0) return;
    const total = selectedSheets.reduce((acc, s) => acc + (s.bodyRows?.length || 0), 0);
    const monthlyLimit = getMonthlyLimit(user);
    if (monthlyLimit < Infinity && total > monthlyLimit) {
      setUpgradeReason('monthlyLimit');
      setShowUpgrade(true);
      return;
    }
    setStep(4);
    setProgressLogs([]);
    let count = 0;
    setEngineProgress({ current: 0, total, percent: 0 });

    const results = [];
    let lastProgressTime = Date.now();

    for (const sheet of selectedSheets) {
      const sheetKey = sheet.fileSource ? `${sheet.fileSource}::${sheet.name}` : sheet.name;
      const sheetMap = mapDefs[sheetKey] || {};
      
      const getVal = (row, fieldKey) => {
        const headerName = sheetMap[fieldKey];
        if (!headerName) return "";
        const idx = sheet.headers.indexOf(headerName);
        return idx >= 0 ? (row[idx] || "") : "";
      };

      const CHUNK_SIZE = 500;
      for (let i = 0; i < sheet.bodyRows.length; i += CHUNK_SIZE) {
        const chunk = sheet.bodyRows.slice(i, i + CHUNK_SIZE);
        // 동시성 30 — 정제는 includeCoords:false(좌표 서킷브레이커 무관)이고 매칭 API(Cloud Run)는 오토스케일이라 안전. 처리량 ↑
        const chunkResults = await asyncPool(30, chunk, async (row) => {
          let addr = getVal(row, 'address');
          let name = getVal(row, 'name');
          let adminDong = getVal(row, 'admin') || "";
          const processedRow = await processAddress(addr, name, adminDong, fileInfo?.city || "", getVal(row, 'note'), { includeCoords: false });
          count++;
          if (Date.now() - lastProgressTime > 200) {
            setEngineProgress({ current: count, total, percent: Math.round((count/total)*100) });
            lastProgressTime = Date.now();
          }
          // 전화번호 먼저 추출 (baseMap 3순위 매칭에 필요)
          const { cleaned: c1, note: phoneNote1 } = extractPhoneNote(getVal(row, 'contact1'));
          const { cleaned: c2, note: phoneNote2 } = extractPhoneNote(getVal(row, 'contact2'));
          const phones = parsePhoneNumbers(c1, c2);
          const phoneNotes = [
            phoneNote1 && c1 ? `${phoneNote1}(${formatPhone(c1)})` : '',
            phoneNote2 && c2 ? `${phoneNote2}(${formatPhone(c2)})` : '',
          ].filter(Boolean).join(' ');

          // baseMap 3순위 매칭: 이름+생년월일 → 이름+휴대폰 → 이름+유선전화
          const birthKey = parseBirthDate(getVal(row, 'birth'));
          let baseEntry = null;
          if (baseMap) {
            const dkf = v => String(v || '').replace(/[^\d]/g, '');
            const dph = dkf(phones.mobile);
            const dld = dkf(phones.landline);
            if (birthKey) baseEntry = baseMap[`${name}_${birthKey}`] || null;
            if (!baseEntry && dph.length >= 9) baseEntry = baseMap[`ph_${name}_${dph}`] || null;
            if (!baseEntry && dld.length >= 9) baseEntry = baseMap[`ld_${name}_${dld}`] || null;
          }

          const importedNote = baseEntry && (importFields === null || importFields?.includes('note')) && baseEntry.note
            ? `◆${baseEntry.note.replace(/^\[기본\]\s*/g, '')}`
            : '';
          const importedDriver = baseEntry && (importFields === null || importFields?.includes('driver'))
            ? (baseEntry.driver || baseEntry.기사 || '')
            : '';
          const importedSeqNo = baseEntry && (importFields === null || importFields?.includes('seqNo'))
            ? (baseEntry.seqNo || baseEntry.배송순번 || '')
            : '';
          const importedSms = baseEntry && (importFields === null || importFields?.includes('sms'))
            ? (baseEntry.sms || baseEntry.문자수신 || '')
            : '';
          const smsValue = parseSMS(getVal(row, 'sms') || importedSms);
          const hasImportedBase = Boolean(importedNote || importedDriver || importedSeqNo || importedSms);

          return {
            id: window.crypto.randomUUID(),
            구분: sheet.type === '혼합'
              ? (() => {
                  // Step3 수동 매핑 우선, 없으면 자동 감지 컬럼 사용
                  const mappedVal = getVal(row, 'type');
                  const v = String(mappedVal || (sheet.typeColIdx >= 0 ? row[sheet.typeColIdx] : '') || '').trim();
                  if (v.includes('차상위')) return '차상위';
                  return '기초수급자';
                })()
              : sheet.type,
            행정동: getVal(row, 'admin') || "",
            리: processedRow.리 || "",
            이름: processedRow.정제된이름 || name,
            생년월일: birthKey,
            품명: getVal(row, 'itemName') || "",
            포수: getVal(row, 'qty') ? (parseInt(getVal(row, 'qty')) || 1) : "",
            휴대폰: phones.mobile,
            유선전화: phones.landline,
            주소: processedRow.주소,
            문자수신: smsValue,
            특이사항: [
              processedRow.특이사항,
              phoneNotes,
              extractDeliveryNote(getVal(row, 'note')), // 비고: 배송 안내(층·호·문 등)만, 현금공제 등 잡음 제외
              importedNote,
            ].filter(Boolean).join(' ').trim() || "",
            기사: getVal(row, 'driver') || importedDriver || "",
            배송순번: getVal(row, 'seqNo') || importedSeqNo || "",
            _에러: processedRow.확인필요,
            _사유: processedRow.확인사유,
            _이식됨: hasImportedBase,
            _lat: processedRow.lat || baseEntry?.lat || null,
            _lng: processedRow.lng || baseEntry?.lng || null,
            _isApt: processedRow.isApt !== undefined ? processedRow.isApt : (baseEntry?.isApt || false),
            _addressMgtNo: processedRow.addressMgtNo || '',
            _buildingMgtNo: processedRow.buildingMgtNo || '',
            _standardRoadAddress: processedRow.standardRoadAddress || '',
            _roadName: processedRow.roadName || '',
            _buildingMainNo: processedRow.buildingMainNo ?? '',
            _buildingSubNo: processedRow.buildingSubNo ?? '',
            _buildingName: processedRow.buildingName || '',
            _legalDong: processedRow.legalDong || '',
            _matchedSido: processedRow.matchedSido || '',
            _matchedSigungu: processedRow.matchedSigungu || '',
            _detailAddress: processedRow.detailAddress || '',
            _addressMatchSource: processedRow.matchSource || '',
            _addressMatchConfidence: processedRow.matchConfidence ?? null,
            _routeHints: processedRow.routeHints || null,
            _주소추정: processedRow.주소추정 || false,
            _추정사유: processedRow.추정사유 || '',
            _원주소: processedRow.원주소 || getVal(row, 'address') || '',
            _addressDisplayMode: addressDisplayMode,
          };
        });
        results.push(...chunkResults);
      }
    }
    
    setEngineProgress({ current: total, total, percent: 100 });
    unifyParenContent(results); // 같은 도로명 주소 () 내용 통일
    results.forEach(r => {
      r.주소 = formatAddressForDisplayMode(r, addressDisplayMode);
      r._addressDisplayMode = addressDisplayMode;
    });
    pushHistory(results);

    // 정제 결과 요약
    const errList = results.filter(r => r._에러);
    const apiFailCount = errList.filter(r => (r._사유 || '').includes('API') || (r._사유 || '').includes('응답')).length;
    const emptyAddrCount = errList.filter(r => (r._사유 || '').includes('공란') || (r._사유 || '').includes('비어')).length;
    const shortAddrCount = errList.filter(r => (r._사유 || '').includes('3자') || (r._사유 || '').includes('짧')).length;
    const outOfMunicipalityCount = errList.filter(r => (r._사유 || '').includes('타지역-지자체')).length;
    const outOfAdminDongCount = 0;
    const jibunOnlyCount = errList.filter(r => (r._사유 || '').includes('지번주소만 확인')).length;
    const addressMissingCount = errList.filter(r => (r._사유 || '').includes('주소 없음')).length;
    const otherErrCount = errList.length - apiFailCount - emptyAddrCount - shortAddrCount
      - outOfMunicipalityCount - outOfAdminDongCount - jibunOnlyCount - addressMissingCount;
    setPurifyResult({
      totalCount: results.length,
      successCount: results.length - errList.length,
      errorCount: errList.length,
      apiFailCount,
      emptyAddrCount,
      shortAddrCount,
      outOfMunicipalityCount,
      outOfAdminDongCount,
      jibunOnlyCount,
      addressMissingCount,
      otherErrCount,
      importedCount: results.filter(r => r._이식됨).length,
      inferredAddressCount: results.filter(r => r._주소추정 || (r._추정사유 || '').trim()).length,
    });

    // 정제 누적 통계: 대시보드/관리자 화면에서 공통으로 읽는 users 문서 필드
    // 실패해도 정제 결과 자체는 유지되어야 하므로 통계 업데이트 오류는 차단하지 않는다.
    if (user?.uid && results.length > 0) {
      setDoc(doc(db, 'users', user.uid), {
        totalRowsProcessed: increment(results.length),
        totalFilesProcessed: increment(1),
        lastProcessedAt: serverTimestamp(),
        lastProcessedCity: fileInfo?.city || '',
        lastProcessedMonth: fileInfo?.month || '',
        lastProcessedRows: results.length,
        lastProcessedValidRows: results.length - errList.length,
        lastProcessedErrorRows: errList.length,
      }, { merge: true }).catch(e => console.warn('[정제 누적 통계 업데이트 실패]', e));
    }

    setStep(5);

    // 전월 delivery_history 로드 → 전월 비교 (비동기, 결과 화면 표시 후 실행)
    try {
      const city = fileInfo?.city;
      if (city) {
        const now = new Date();
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonthId = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
        const prevSnap = await getDocs(
          collection(db, 'delivery_history', city, 'months', prevMonthId, 'records')
        );
        if (!prevSnap.empty) {
          const prevRecords = prevSnap.docs.map(d => d.data());
          const prevMap = new Map();
          prevRecords.forEach(r => {
            const k = r.birthKey ? `${r.name}__${r.birthKey}` : `${r.name}__${(r.mobile || r.landline || '').replace(/[^\d]/g, '')}`;
            if (k.length > 3) prevMap.set(k, r);
          });

          // 주소 변경 판정: 도로명+번호가 다르면 변경(이사), 같으면 상세(동·호·층 숫자) 유사성 비교.
          // 괄호 내용·공백·쉼표·호/층 위치 등 포맷 차이는 무시 → 정제만 된 건은 변경으로 치지 않음.
          const roadCompareKey = (addr) => {
            const clean = String(addr || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, '');
            const m = clean.match(/[가-힣A-Za-z0-9]+(?:대로|로|길)\d+(?:-\d+)?/);
            return m ? m[0] : clean.slice(0, 12);
          };
          const detailCompareKey = (addr) => {
            const afterRoad = String(addr || '')
              .replace(/\([^)]*\)/g, ' ')
              .replace(/[가-힣A-Za-z0-9]+(?:대로|로|길)\s*\d+(?:-\d+)?/, ' ');
            return (afterRoad.match(/\d+/g) || []).join('-');
          };
          const isRealAddrChange = (prevAddr, curAddr) => {
            if (!prevAddr || !curAddr) return false;
            if (roadCompareKey(prevAddr) !== roadCompareKey(curAddr)) return true; // 도로명+번호 다름 → 이사
            return detailCompareKey(prevAddr) !== detailCompareKey(curAddr);          // 도로명 같음 → 상세 숫자 비교
          };

          const currentKeys = new Set();
          const changes = [];
          let dongStats = {};

          results.forEach(r => {
            const bk = r.생년월일 ? `${r.이름}__${r.생년월일}` : `${r.이름}__${(r.휴대폰 || r.유선전화 || '').replace(/[^\d]/g, '')}`;
            currentKeys.add(bk);
            const prev = prevMap.get(bk);
            const dong = r.행정동 || '미분류';
            if (!dongStats[dong]) dongStats[dong] = { total: 0, changed: 0 };
            dongStats[dong].total++;

            if (prev) {
              const prevAddr = (prev.address || '').trim();
              const curAddr = (r.주소 || '').trim();
              const addrChanged = isRealAddrChange(prevAddr, curAddr);
              if (addrChanged) {
                dongStats[dong].changed++;
                changes.push({ type: 'address', name: r.이름, dong, prevAddr, curAddr });
              }
            } else {
              changes.push({ type: 'new', name: r.이름, dong, prevAddr: '', curAddr: r.주소 || '' });
            }
          });

          const leftCount = [...prevMap.keys()].filter(k => !currentKeys.has(k)).length;

          // 경고 조건: 행정동 30% 이상 또는 20건 이상 변경
          const warnings = Object.entries(dongStats)
            .filter(([, v]) => v.changed > 0 && (v.changed / v.total >= 0.3 || v.changed >= 20))
            .map(([dong, v]) => ({ dong, changed: v.changed, total: v.total, rate: Math.round(v.changed / v.total * 100) }))
            .sort((a, b) => b.changed - a.changed);

          const newCount = changes.filter(c => c.type === 'new').length;
          const addrChangeCount = changes.filter(c => c.type === 'address').length;

          if (warnings.length > 0 || addrChangeCount > 0 || newCount > 0 || leftCount > 0) {
            setPrevMonthCompare({ warnings, changes, newCount, leftCount, addrChangeCount, prevMonthId });
            if (warnings.length > 0) setShowPrevCompare(true); // 경고 있으면 자동 표시
          }
        }
      }
    } catch (e) {
      console.warn('[전월 비교 로드 실패 — 무시]', e);
    }
  };

  // 쉬운 정제: 확인 카드 [정제 시작] 후 selectedSheets 준비되면 자동으로 엔진 실행
  useEffect(() => {
    if (easyRun && selectedSheets.length > 0) {
      setEasyRun(false);
      handleAnalyzeAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [easyRun, selectedSheets]);

  // 담당자 이름·지자체 기본값을 로그인 프로필에서 초기화(업로드 전 확인용)
  useEffect(() => {
    if (!user) return;
    setOperatorName(prev => prev || user.realName || '');
    setSelectedCity(prev => prev || (user.citiesApproved?.length === 1 ? user.citiesApproved[0] : ''));
  }, [user]);

  const handleCellEdit = (id, field, value) => {
    // 타이핑마다 pushHistory 호출 시 stale closure + setHistory·setGridData 동시발동으로
    // 중복문자·화면잠김 발생 → 키 입력은 functional setGridData로만, 히스토리는 Enter(재정제)에서만 쌓음
    setGridData(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleToggleAddressDisplayMode = () => {
    const nextMode = addressDisplayMode === ADDRESS_DISPLAY_MODES.PAREN_BEFORE_DETAIL
      ? ADDRESS_DISPLAY_MODES.DETAIL_BEFORE_PAREN
      : ADDRESS_DISPLAY_MODES.PAREN_BEFORE_DETAIL;
    const newData = gridData.map(row => ({
      ...row,
      주소: formatAddressForDisplayMode(row, nextMode),
      _addressDisplayMode: nextMode,
    }));
    setAddressDisplayMode(nextMode);
    pushHistory(newData);
  };

  const handleAddressKeyDown = async (e, row) => {
    if (e.key === "Enter") {
      const res = await processAddress(row.주소, row.이름, row.행정동 || "", fileInfo?.city || "", row.특이사항 || "", { includeCoords: false });
      const updatedRow = {
        ...row,
        주소: res.주소,
        특이사항: mergeUniqueText(row.특이사항, res.특이사항),
        _에러: res.확인필요 || false,
        _사유: res.확인사유 || '',
        _lat: res.lat || null,
        _lng: res.lng || null,
        _isApt: res.isApt !== undefined ? res.isApt : row._isApt,
        _addressMgtNo: res.addressMgtNo || '',
        _buildingMgtNo: res.buildingMgtNo || '',
        _standardRoadAddress: res.standardRoadAddress || '',
        _roadName: res.roadName || '',
        _buildingMainNo: res.buildingMainNo ?? '',
        _buildingSubNo: res.buildingSubNo ?? '',
        _buildingName: res.buildingName || '',
        _legalDong: res.legalDong || '',
        _matchedSido: res.matchedSido || '',
        _matchedSigungu: res.matchedSigungu || '',
        _detailAddress: res.detailAddress || '',
        _addressMatchSource: res.matchSource || '',
        _addressMatchConfidence: res.matchConfidence ?? null,
        _routeHints: res.routeHints || null,
        _주소추정: res.주소추정 || false,
        _추정사유: res.추정사유 || '',
        _원주소: res.원주소 || row.주소 || '',
        _addressDisplayMode: addressDisplayMode,
      };
      updatedRow.주소 = guardAddressDetail(row.주소, formatAddressForDisplayMode(updatedRow, addressDisplayMode));
      const newData = gridData.map(r => r.id === row.id ? updatedRow : r);
      pushHistory(newData);
      if (res.주소 !== row.주소 && row.주소) {
        addTypoRecord(row.주소, res.주소);
      }
    }
  };

  const handleRepurifyErrors = async () => {
    const errorRows = gridData.filter(r => r._에러);
    if (!errorRows.length) return;
    if (!window.confirm(`오류 ${errorRows.length}건을 일괄 재정제합니다.\n주소를 먼저 수정한 후 실행하세요.`)) return;

    gStart('오류 재정제 중...', `0 / ${errorRows.length}건`, 0);
    let done = 0;

    const repurified = await asyncPool(10, errorRows, async (row) => {
      const res = await processAddress(row.주소, row.이름, row.행정동 || '', fileInfo?.city || '', row.특이사항 || '', { includeCoords: false });
      done++;
      gUpdate(Math.round(done / errorRows.length * 100), `${done} / ${errorRows.length}건`);
      const updatedRow = {
        ...row,
        주소: res.주소,
        특이사항: mergeUniqueText(row.특이사항, res.특이사항),
        _에러: res.확인필요 || false,
        _사유: res.확인사유 || '',
        _lat: res.lat || null,
        _lng: res.lng || null,
        _isApt: res.isApt !== undefined ? res.isApt : row._isApt,
        _addressMgtNo: res.addressMgtNo || '',
        _buildingMgtNo: res.buildingMgtNo || '',
        _standardRoadAddress: res.standardRoadAddress || '',
        _roadName: res.roadName || '',
        _buildingMainNo: res.buildingMainNo ?? '',
        _buildingSubNo: res.buildingSubNo ?? '',
        _buildingName: res.buildingName || '',
        _legalDong: res.legalDong || '',
        _matchedSido: res.matchedSido || '',
        _matchedSigungu: res.matchedSigungu || '',
        _detailAddress: res.detailAddress || '',
        _addressMatchSource: res.matchSource || '',
        _addressMatchConfidence: res.matchConfidence ?? null,
        _routeHints: res.routeHints || null,
        _주소추정: res.주소추정 || false,
        _추정사유: res.추정사유 || '',
        _원주소: res.원주소 || row.주소 || '',
        _addressDisplayMode: addressDisplayMode,
      };
      updatedRow.주소 = guardAddressDetail(row.주소, formatAddressForDisplayMode(updatedRow, addressDisplayMode));
      return updatedRow;
    });

    const resultMap = new Map(repurified.map(r => [r.id, r]));
    const newData = gridData.map(r => resultMap.has(r.id) ? resultMap.get(r.id) : r);
    pushHistory(newData);

    const remaining = repurified.filter(r => r._에러).length;
    const fixed = errorRows.length - remaining;
    gDone(`재정제 완료 — ${fixed}건 해결 / ${remaining}건 남음`);
  };

  // 도로명주소 규칙 재적용 — 전국 DB 조회로 (법정동, 건물명) 채우고 형식 통일(정렬 획일화).
  // 매칭되면 DB 법정동/건물명, 미매칭이면 A-24로 행정동 fallback → 괄호 일관 표시. 특이사항은 보존(inputNote '').
  // 도로명주소 규칙 재적용 — 정제 규칙이 바뀌었을 때 "원본 입력 주소(_원주소)"에서 새 규칙으로 다시 정제한다.
  // [핵심 안전설계·절대 되돌리지 말 것]
  //   ① 재정제 입력은 반드시 _원주소(원본 엑셀 입력). 이미 정제된 row.주소를 재투입하면 비멱등 파싱으로 명단이 망가진다
  //      (1577b94 점검 → fac3fa6 퇴행 → d6f7e36 복구 이력 참고). _원주소 없으면 재정제 안 하고 형식만 통일(안전 fallback).
  //   ② 매칭 실패(빈 결과·3자 미만·확인필요)면 기존 주소를 그대로 보존 — DB 미매칭 시골/신규주소를 빈 값으로 덮어쓰지 않는다.
  //   ③ guardAddressDetail로 동(棟)·호수 손실까지 이중 방어. 특이사항·전화·구분 등 나머지 필드는 항상 보존.
  const handleReapplyFormat = async () => {
    if (!gridData.length) return;
    if (!window.confirm(`전체 ${gridData.length}건에 최신 주소 정제 규칙을 재적용합니다.\n· 원본 입력 주소를 기준으로 새 규칙으로 다시 정제\n· 규칙으로 못 찾은 건은 기존 주소를 그대로 유지(망가뜨리지 않음)\n· 특이사항·전화·구분은 변경하지 않습니다\n계속할까요?`)) return;
    gStart('최신 정제 규칙 재적용 중...', `0 / ${gridData.length}건`, 0);
    let done = 0, changed = 0, kept = 0;
    const tick = () => { done++; gUpdate(Math.round(done / gridData.length * 100), `${done} / ${gridData.length}건`); };
    const reformatted = await asyncPool(8, gridData, async (row) => {
      try {
        const sourceAddr = String(row._원주소 || '').trim();
        // _원주소 없음(저장 후 불러온 데이터 등) → 재정제 위험. 형식만 안전 통일.
        if (!sourceAddr) {
          const next = guardAddressDetail(row.주소, formatAddressForDisplayMode(row, addressDisplayMode));
          if (next && next !== row.주소) changed++;
          tick();
          return { ...row, 주소: next || row.주소, _addressDisplayMode: addressDisplayMode };
        }
        // ① 원본 입력에서 새 규칙으로 재정제 (정제 결과 재투입 금지)
        const res = await processAddress(sourceAddr, row.이름, row.행정동 || '', fileInfo?.city || '', '', { includeCoords: false });
        const candidate = String(res.주소 || '').trim();
        // ② 매칭 실패 보호 — 기존 주소 유지
        if (!candidate || candidate.length < 3 || res.확인필요) {
          kept++; tick();
          return row;
        }
        const updatedRow = {
          ...row,                                 // 특이사항·구분·전화 등 원본 보존
          주소: candidate,
          _원주소: sourceAddr,                     // 원본 유지(다음 재적용도 원본 기준)
          _legalDong: res.legalDong || row._legalDong || '',
          _buildingName: res.buildingName || row._buildingName || '',
          _detailAddress: res.detailAddress || row._detailAddress || '',
          _standardRoadAddress: res.standardRoadAddress || row._standardRoadAddress || '',
          _roadName: res.roadName || row._roadName || '',
          _buildingMainNo: res.buildingMainNo ?? row._buildingMainNo ?? '',
          _buildingSubNo: res.buildingSubNo ?? row._buildingSubNo ?? '',
          _matchedSido: res.matchedSido || row._matchedSido || '',
          _matchedSigungu: res.matchedSigungu || row._matchedSigungu || '',
          _lat: res.lat ?? row._lat ?? null,
          _lng: res.lng ?? row._lng ?? null,
          _addressDisplayMode: addressDisplayMode,
        };
        // ③ 동·호수 손실 이중 방어 + 표시형식 통일
        updatedRow.주소 = guardAddressDetail(row.주소, formatAddressForDisplayMode(updatedRow, addressDisplayMode));
        if (updatedRow.주소 !== row.주소) changed++;
        tick();
        return updatedRow;
      } catch {
        tick();
        return row;                               // 에러 시 기존 보존
      }
    });
    pushHistory(reformatted);
    gDone(`정제 규칙 재적용 완료 — ${changed.toLocaleString()}건 갱신 / ${kept.toLocaleString()}건 기존 유지(매칭 실패 보호)`);
  };

  // ── 주소 없음 → 담당자 확인: 담당자가 입력한 이번달 실제 주소로 단건 재정제 ──
  const handleConfirmAddress = async (row, newAddress) => {
    const res = await processAddress(newAddress, row.이름, row.행정동 || '', fileInfo?.city || '', row.특이사항 || '', { includeCoords: false });
    let updated = {
      ...row,
      주소: res.주소,
      특이사항: mergeUniqueText(row.특이사항, res.특이사항),
      _에러: res.확인필요 || false,
      _사유: res.확인사유 || '',
      _전화확인: false,
      _lat: res.lat || null,
      _lng: res.lng || null,
      _isApt: res.isApt !== undefined ? res.isApt : row._isApt,
      _addressMgtNo: res.addressMgtNo || '',
      _buildingMgtNo: res.buildingMgtNo || '',
      _standardRoadAddress: res.standardRoadAddress || '',
      _roadName: res.roadName || '',
      _buildingMainNo: res.buildingMainNo ?? '',
      _buildingSubNo: res.buildingSubNo ?? '',
      _buildingName: res.buildingName || '',
      _legalDong: res.legalDong || '',
      _matchedSido: res.matchedSido || '',
      _matchedSigungu: res.matchedSigungu || '',
      _detailAddress: res.detailAddress || '',
      _addressMatchSource: res.matchSource || '',
      _addressMatchConfidence: res.matchConfidence ?? null,
      _routeHints: res.routeHints || null,
      _주소추정: res.주소추정 || false,
      _추정사유: res.추정사유 || '',
      _원주소: row.주소 || newAddress,
      _addressDisplayMode: addressDisplayMode,
    };
    updated.주소 = formatAddressForDisplayMode(updated, addressDisplayMode);
    const newData = gridData.map(r => (r.id === row.id ? updated : r));
    pushHistory(newData);
    return !updated._에러;
  };

  // 담당자가 "전화확인 필요"로 표시(미해결로 명시 — 완료 게이트에서 조용히 안 넘어감)
  const handleMarkPhoneCheck = (rowId) => {
    const newData = gridData.map(r => (r.id === rowId ? { ...r, _전화확인: true, _사유: '담당자 전화확인 필요' } : r));
    pushHistory(newData);
  };

  const handleUpdateBaseList = async (row, updates) => {
    if (!row) return;
    try {
      const city = fileInfo?.city || '기타';
      const normPhone = (v) => (v || '').replace(/[^0-9-]/g, '');
      const name = (row.이름 || '').trim();
      const birthKey = row.생년월일 || '';
      const mobile = normPhone(row.휴대폰 || '');
      const colRef = collection(db, 'base_lists', city, 'records');

      let existingId = null;
      if (birthKey) {
        const snap = await getDocs(query(colRef, where('name', '==', name), where('birthKey', '==', birthKey)));
        if (!snap.empty) existingId = snap.docs[0].id;
      }
      if (!existingId && mobile.length >= 9) {
        const snap = await getDocs(query(colRef, where('name', '==', name), where('mobile', '==', mobile)));
        if (!snap.empty) existingId = snap.docs[0].id;
      }

      const ref = existingId
        ? doc(db, 'base_lists', city, 'records', existingId)
        : doc(colRef);
      await setDoc(ref, { name, birthKey, mobile, ...updates }, { merge: true });

      await addDoc(collection(db, "audit_logs"), {
        action: "UPDATE_BASELIST",
        targetName: row.이름,
        updates,
        timestamp: serverTimestamp(),
        adminEmail: user?.email || "unknown",
        expireAt: ttl90(),
      });
      alert("기본명단 및 감사 로그가 성공적으로 업데이트 되었습니다.");
    } catch (e) {
      console.error(e);
      alert("업데이트 실패: " + e.message);
    }
  };

  const runSavedListBackgroundCoords = async ({ city, monthId, records: savedRecords }) => {
    const targets = (savedRecords || []).filter(r => r.id && r.주소 && !r.lat && !r.lng);
    if (!city || !monthId || !targets.length) return;

    bgSaveCoordCancelRef.current = false;
    setBgSaveCoordState({ city, monthId, done: 0, total: targets.length, success: 0, isDone: false });

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const patches = [];
    const gridPatches = {};
    let done = 0;
    let success = 0;
    let lastUiAt = 0;

    const flushPatches = async () => {
      if (!patches.length) return;
      const items = patches.splice(0, patches.length);
      for (let i = 0; i < items.length; i += 240) {
        const batch = writeBatch(db);
        items.slice(i, i + 240).forEach(({ record, patch }) => {
          batch.update(doc(db, 'cloud_lists', city, 'months', monthId, 'records', record.id), patch);
          if (!record.확인필요) {
            batch.set(doc(db, 'delivery_history', city, 'months', monthId, 'records', record.id), {
              name: record.이름 || '',
              birthKey: record.생년월일 || '',
              dong: record.행정동 || '',
              address: record.주소 || '',
              lat: patch.lat,
              lng: patch.lng,
              mobile: record.휴대폰 || '',
              landline: record.유선전화 || '',
              gubun: record.구분 || '',
            }, { merge: true });
          }
        });
        await batch.commit();
      }
    };

    try {
      for (const record of targets) {
        if (bgSaveCoordCancelRef.current) break;

        // 영구 캐시(coordinate_cache) 우선 — 같은 주소면 카카오 호출 없이 즉시 적용(API 최소화).
        let coord = await getCachedCoord(db, city, record.주소);
        let source = 'cache';
        if (!coord) {
          await sleep(650);
          const result = await processAddress(
            record.주소,
            record.이름 || '',
            record.행정동 || '',
            city,
            record.특이사항 || '',
            { includeCoords: true }
          );
          if (result.lat && result.lng) {
            coord = { lat: result.lat, lng: result.lng };
            source = result.matchSource || 'background';
            await saveCoordCache(db, city, record.주소, coord.lat, coord.lng); // 다음 명단에서 재사용
          }
        }

        if (coord) {
          success++;
          const patch = {
            lat: coord.lat,
            lng: coord.lng,
            좌표상태: '좌표확인',
            배송상태: record.확인필요 ? '확인후배정가능' : '배송준비',
            좌표출처: source,
            좌표수정일시: serverTimestamp(),
            좌표수정자: user?.email || 'background',
          };
          patches.push({ record, patch });
          gridPatches[record.id] = { _lat: coord.lat, _lng: coord.lng };
        }

        done++;
        const now = Date.now();
        if (patches.length >= 40) await flushPatches();
        if (now - lastUiAt > 500 || done === targets.length) {
          setBgSaveCoordState(prev => prev ? { ...prev, done, success } : prev);
          lastUiAt = now;
        }
      }

      await flushPatches();
      if (Object.keys(gridPatches).length) {
        setGridData(prev => prev.map(r => gridPatches[r.id] ? { ...r, ...gridPatches[r.id] } : r));
      }
      setBgSaveCoordState(prev => prev ? { ...prev, done, success, isDone: true, canceled: bgSaveCoordCancelRef.current } : prev);
      setTimeout(() => setBgSaveCoordState(null), 9000);
    } catch (e) {
      console.warn('[저장 후 백그라운드 좌표 매칭 실패]', e);
      setBgSaveCoordState(prev => prev ? { ...prev, done, success, isDone: true, failed: true } : prev);
      setTimeout(() => setBgSaveCoordState(null), 9000);
    }
  };

  const handleSaveMonthlyList = async () => {
    if (guestMode) { requireLogin(); return; }
    const city = fileInfo?.city;
    if (!city) return alert('지자체 정보를 감지하지 못했습니다. 파일을 다시 확인해주세요.');
    const unconfirmedAddr = gridData.filter(r => r._에러 && !r._전화확인).length;
    if (unconfirmedAddr > 0 && !window.confirm(`주소 확인이 안 된 ${unconfirmedAddr}건이 있습니다.\n담당자 확인(주소 입력 또는 전화확인) 후 저장을 권장합니다.\n그래도 저장할까요?`)) return;
    // 헤더 키워드가 이름 자리에 들어온 행 제거 (Excel 파싱 오류 방어)
    const HEADER_NAME_RE = /^(이름|성명|대상자|수령자명)$/;
    const allData = gridData.filter(d => !HEADER_NAME_RE.test((d.이름 || '').trim()));
    const skippedCount = gridData.length - allData.length;
    const validData = allData.filter(d => !d._에러);
    const errorData = allData.filter(d => d._에러);
    if (allData.length === 0) return alert('저장할 명단이 없습니다.');
    if (skippedCount > 0) console.warn(`[저장 방어] 헤더 키워드 이름 행 ${skippedCount}건 제외됨`);

    const now = new Date();
    let initMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const rawMonth = fileInfo?.month || '';
    const mMatch = rawMonth.match(/(\d{1,2})월/);
    if (mMatch) initMonth = `${now.getFullYear()}-${String(mMatch[1]).padStart(2, '0')}`;
    else if (/^\d{4}-\d{2}$/.test(rawMonth)) initMonth = rawMonth;

    const monthStr = window.prompt(
      `[${city}] 저장할 년월을 입력하세요 (예: ${initMonth})\n\n전체 ${allData.length}건을 저장합니다.\n정상 ${validData.length}건 / 확인필요 ${errorData.length}건`,
      initMonth
    );
    if (!monthStr) return;
    if (!/^\d{4}-\d{2}$/.test(monthStr)) return alert('형식이 올바르지 않습니다. YYYY-MM 형식으로 입력해주세요.');

    try {
      // [1단계] 기존 데이터 확인 → 중복 방지
      let existingSnap;
      try {
        existingSnap = await getDocs(collection(db, 'cloud_lists', city, 'months', monthStr, 'records'));
      } catch (e) { throw new Error(`[1단계 기존명단 조회 권한 오류] ${e.message}\n계정: ${user?.email}`); }

      // 유지(보존)되는 기존 레코드의 구분·포수·확인필요 — 메타 합산용. 병합 저장 시에만 채워짐.
      let keptGubunData = [];
      if (existingSnap.docs.length > 0) {
        // 이번 업로드에 들어있는 구분(수급자/차상위) — 그 구분만 교체, 나머지 구분은 보존
        const uploadGubuns = new Set(allData.map(r => r.구분).filter(Boolean));
        const keptDocs = uploadGubuns.size > 0 ? existingSnap.docs.filter(d => !uploadGubuns.has(d.data().구분 || '')) : [];
        let toDelete;
        if (keptDocs.length > 0) {
          const mergeOk = window.confirm(
            `[${city}] ${monthStr}에 이미 ${existingSnap.docs.length}건이 저장되어 있습니다.\n\n` +
            `▶ [확인] 분리 저장 — 이번 업로드 구분(${[...uploadGubuns].join('·')}) ${existingSnap.docs.length - keptDocs.length}건만 교체하고,\n` +
            `   나머지 구분 ${keptDocs.length}건(예: 수급자↔차상위)은 그대로 유지합니다.\n\n` +
            `▶ [취소] 전체 교체 — 기존 ${existingSnap.docs.length}건을 모두 삭제 후 새로 저장.`
          );
          if (mergeOk) {
            toDelete = existingSnap.docs.filter(d => uploadGubuns.has(d.data().구분 || ''));
            keptGubunData = keptDocs.map(d => { const x = d.data(); return { 구분: x.구분 || '', 포수: parseInt(x.포수) || 1, 확인필요: !!x.확인필요 }; });
          } else {
            if (!window.confirm(`전체 교체합니다. 기존 ${existingSnap.docs.length}건을 모두 삭제할까요?`)) return;
            toDelete = existingSnap.docs;
          }
        } else {
          if (!window.confirm(`[${city}] ${monthStr} 명단이 이미 ${existingSnap.docs.length}건 저장되어 있습니다.\n기존 데이터를 지우고 새로 저장하시겠습니까?`)) return;
          toDelete = existingSnap.docs;
        }
        try {
          for (let i = 0; i < toDelete.length; i += 499) {
            const batch = writeBatch(db);
            toDelete.slice(i, i + 499).forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
        } catch (e) { throw new Error(`[2단계 기존명단 삭제 권한 오류] ${e.message}\n계정: ${user?.email}`); }
      }

      // 메타 합산 = 이번 업로드 + (분리 저장 시) 유지된 기존 구분 데이터 → 둘 다 카운트에 반영
      const combinedMeta = [
        ...allData.map(r => ({ 구분: r.구분 || '', 포수: parseInt(r.포수) || 1, 확인필요: !!r._에러 })),
        ...keptGubunData,
      ];
      const totalCountC = combinedMeta.length;
      const errorCountC = combinedMeta.filter(r => r.확인필요).length;
      const validCountC = totalCountC - errorCountC;
      const 수급자Count = combinedMeta.filter(r => r.구분 === '기초수급자').length;
      const 차상위Count = combinedMeta.filter(r => r.구분 === '차상위').length;
      const totalQty   = combinedMeta.reduce((s, r) => s + r.포수, 0);
      const 수급자Qty  = combinedMeta.filter(r => r.구분 === '기초수급자').reduce((s, r) => s + r.포수, 0);
      const 차상위Qty  = combinedMeta.filter(r => r.구분 === '차상위').reduce((s, r) => s + r.포수, 0);

      // [3단계] 도시 상위 문서
      try {
        await setDoc(doc(db, 'cloud_lists', city), {
          city, lastMonthId: monthStr, lastUpdatedAt: serverTimestamp(),
          latestTotalCount: totalCountC, latestValidCount: validCountC, latestErrorCount: errorCountC,
          latestNeedCheckCount: errorCountC, latest수급자Count: 수급자Count, latest차상위Count: 차상위Count,
          latestTotalQty: totalQty, latest수급자Qty: 수급자Qty, latest차상위Qty: 차상위Qty,
          latestWorkflowMeta: workflowMeta,
        }, { merge: true });
      } catch (e) { throw new Error(`[3단계 도시문서 저장 권한 오류] ${e.message}\n계정: ${user?.email}`); }

      // [4단계] 월별 메타 문서
      try {
        const metaRef = doc(db, 'cloud_lists', city, 'months', monthStr);
        await setDoc(metaRef, {
          city, monthId: monthStr,
          totalCount: totalCountC, validCount: validCountC, errorCount: errorCountC, needCheckCount: errorCountC,
          수급자Count, 차상위Count,
          totalQty, 수급자Qty, 차상위Qty,
          uploadedAt: serverTimestamp(), uploadedBy: user?.email || 'unknown',
          workflowMeta,
          hasOriginal: false,
          coordsDone: false, // 서버 스케줄 함수(geocodeAuto)가 좌표 자동 매칭하도록 표시
        });
      } catch (e) { throw new Error(`[4단계 월별메타 저장 권한 오류] ${e.message}\n계정: ${user?.email}`); }

      // [5단계] 레코드 499건씩 배치 저장 (규칙 C-5: 원본 명단 전건 보존)
      setGLoad({ show: true, msg: '클라우드 저장 중...', sub: `${city} ${monthStr} · 전체 ${allData.length.toLocaleString()}건`, pct: 0, done: false, blocking: true });
      try {
        for (let i = 0; i < allData.length; i += 499) {
          const batch = writeBatch(db);
          allData.slice(i, i + 499).forEach((r, j) => {
            const recordId = r.id || window.crypto.randomUUID();
            const ref = doc(db, 'cloud_lists', city, 'months', monthStr, 'records', recordId);
            const hasCoord = Boolean(r._lat && r._lng);
            const needCheck = Boolean(r._에러);
            const reason = r._사유 || '';
            const workStatus = needCheck
              ? (reason.includes('타지역-지자체') ? '타지역의심'
                : reason.includes('지번주소만 확인') ? '지번만확인'
                : reason.includes('주소 없음') ? '주소없음'
                : '주소확인필요')
              : '정상';
            const deliveryStatus = needCheck
              ? (hasCoord ? '확인후배정가능' : '주소확인필요')
              : (hasCoord ? '배송준비' : '좌표없음');
            const payload = {
              구분: r.구분 || '',
              이름: r.이름 || '',
              생년월일: r.생년월일 || '',
              행정동: r.행정동 || '',
              리: r.리 || '',
              주소: r.주소 || '',
              휴대폰: r.휴대폰 || '',
              유선전화: r.유선전화 || '',
              문자수신: r.문자수신 || 'N',
              포수: parseInt(r.포수 || '1') || 1,
              품명: r.품명 || '',
              특이사항: r.특이사항 || '',
              lat: r._lat || null,
              lng: r._lng || null,
              isApt: r._isApt || false,
              addressMgtNo: r._addressMgtNo || '',
              buildingMgtNo: r._buildingMgtNo || '',
              standardRoadAddress: r._standardRoadAddress || '',
              roadName: r._roadName || '',
              buildingMainNo: r._buildingMainNo ?? '',
              buildingSubNo: r._buildingSubNo ?? '',
              buildingName: r._buildingName || '',
              legalDong: r._legalDong || '',
              matchedSido: r._matchedSido || '',
              matchedSigungu: r._matchedSigungu || '',
              detailAddress: r._detailAddress || '',
              addressMatchSource: r._addressMatchSource || '',
              addressMatchConfidence: r._addressMatchConfidence ?? null,
              routeHints: r._routeHints || null,
              기사: r.기사 || '',
              배송순번: r.배송순번 || '',
              확인필요: needCheck,
              확인사유: reason,
              작업상태: workStatus,
              배송상태: deliveryStatus,
              좌표상태: hasCoord ? '좌표확인' : '좌표없음',
              workflowMode: workflowMode,
              _idx: i + j,
            };
            batch.set(ref, payload);
          });
          await batch.commit();
          gUpdate(Math.round(Math.min(i + 499, allData.length) / allData.length * 100));
          await new Promise(r => setTimeout(r, 0)); // 메인스레드 양보 — 대량 저장 중 UI 프리징 완화
        }
      } catch (e) { throw new Error(`[5단계 레코드 배치저장 권한 오류] ${e.message}\n계정: ${user?.email}`); }

      await addDoc(collection(db, 'audit_logs'), {
        action: 'SAVE_MONTHLY_LIST', city, monthId: monthStr,
        count: allData.length, validCount: validData.length, errorCount: errorData.length,
        workflowMeta,
        timestamp: serverTimestamp(),
        adminEmail: user?.email || 'unknown',
        expireAt: ttl90(),
      });

      // delivery_history 동시 저장 (전월 비교·기사/순번/좌표 복원 기반 데이터)
      try {
        const dhColRef = collection(db, 'delivery_history', city, 'months', monthStr, 'records');
        const existingDH = await getDocs(dhColRef);
        if (!existingDH.empty) {
          for (let i = 0; i < existingDH.docs.length; i += 499) {
            const b = writeBatch(db);
            existingDH.docs.slice(i, i + 499).forEach(d => b.delete(d.ref));
            await b.commit();
          }
        }
        await setDoc(doc(db, 'delivery_history', city), { city, lastMonthId: monthStr, lastUpdatedAt: serverTimestamp() }, { merge: true });
        await setDoc(doc(db, 'delivery_history', city, 'months', monthStr), { city, monthId: monthStr, totalCount: validData.length, savedAt: serverTimestamp(), savedBy: user?.email || 'unknown' });
        for (let i = 0; i < validData.length; i += 499) {
          const b = writeBatch(db);
          validData.slice(i, i + 499).forEach(r => {
            const recordId = r.id || window.crypto.randomUUID();
            const ref = doc(db, 'delivery_history', city, 'months', monthStr, 'records', recordId);
            b.set(ref, {
              name: r.이름 || '',
              birthKey: r.생년월일 || '',
              dong: r.행정동 || '',
              address: r.주소 || '',
              lat: r._lat || null,
              lng: r._lng || null,
              driver: r.기사 || '',
              seqNo: parseInt(r.배송순번 || '0') || 0,
              sms: r.문자수신 || 'N',
              gubun: r.구분 || '',
            });
          });
          await b.commit();
          await new Promise(r => setTimeout(r, 0)); // 메인스레드 양보
        }
      } catch (dhErr) {
        console.warn('[delivery_history 저장 실패 — 무시]', dhErr);
      }

      // base_lists에 좌표·특이사항 sync-back (기본명단 저장 없이 클라우드만 저장한 경우 커버)
      try {
        const digitKey = v => String(v || '').replace(/[^\d]/g, '');
        const baseSnap = await getDocs(collection(db, 'base_lists', city, 'records'));
        if (!baseSnap.empty) {
          const byBirth = new Map(), byPhone = new Map(), byLandline = new Map();
          baseSnap.docs.forEach(d => {
            const b = d.data();
            const nm = b.name || b.이름 || '';
            const bk = digitKey(b.birthKey || b.생년월일 || '');
            const ph = digitKey(b.mobile || b.휴대폰 || '');
            const ld = digitKey(b.landline || b.유선전화 || '');
            if (bk) byBirth.set(`${nm}_${bk}`, d.ref);
            if (ph) byPhone.set(`${nm}_${ph}`, d.ref);
            if (ld) byLandline.set(`${nm}_${ld}`, d.ref);
          });
          const syncUpdates = [];
          validData.forEach(r => {
            const nm = r.이름 || '';
            const bk = digitKey(r.생년월일 || '');
            const ph = digitKey(r.휴대폰 || '');
            const ld = digitKey(r.유선전화 || '');
            let ref = null;
            if (bk) ref = byBirth.get(`${nm}_${bk}`);
            if (!ref && ph) ref = byPhone.get(`${nm}_${ph}`);
            if (!ref && ld) ref = byLandline.get(`${nm}_${ld}`);
            if (!ref) return;
            const patch = {};
            if (r._lat) patch.lat = r._lat;
            if (r._lng) patch.lng = r._lng;
            if (r._isApt !== undefined) patch.isApt = r._isApt;
            if (Object.keys(patch).length) syncUpdates.push({ ref, patch });
          });
          for (let i = 0; i < syncUpdates.length; i += 499) {
            const b2 = writeBatch(db);
            syncUpdates.slice(i, i + 499).forEach(u => b2.update(u.ref, u.patch));
            await b2.commit();
          }
        }
      } catch { /* sync 실패는 무시 — 핵심 저장은 완료됨 */ }

      // [6단계] 구월 자동 정리 — 동일 지자체의 최신 1개월만 유지
      // ※ cloud_lists는 "현재 월 작업 공간"이며, 이력은 delivery_history에 보존됨
      try {
        const allMonthsSnap = await getDocs(collection(db, 'cloud_lists', city, 'months'));
        const oldMonths = allMonthsSnap.docs.filter(d => d.id !== monthStr);
        if (oldMonths.length > 0) {
          const oldMonthNames = oldMonths.map(d => d.id).join(', ');
          const confirmDelete = window.confirm(
            `[${city}] 구월 데이터 정리\n\n이전 월 데이터: ${oldMonthNames}\n\n이 데이터를 삭제하시겠습니까?\n\n✅ 배송 이력은 별도 delivery_history에 보존됩니다.\n⚠️ 삭제 후 cloud_lists에서는 복구할 수 없습니다.`
          );
          if (!confirmDelete) {
            gDone(`${city} ${monthStr} · 전체 ${totalCountC.toLocaleString()}명 ${totalQty.toLocaleString()}포 저장 완료 (구월 유지)`);
            setTimeout(() => {
              /* 좌표 매칭은 서버 스케줄 함수(geocodeAuto)가 업로드 순서대로 자동 처리 — 브라우저 지오코딩 중단 */
            }, 300);
            alert(
              `✅ ${city} ${monthStr} 저장 완료\n\n` +
              `전체 ${totalCountC.toLocaleString()}명 · ${totalQty.toLocaleString()}포\n` +
              `· 수급자 ${수급자Count.toLocaleString()}명 · ${수급자Qty.toLocaleString()}포\n` +
              `· 차상위 ${차상위Count.toLocaleString()}명 · ${차상위Qty.toLocaleString()}포\n\n` +
              `정상 ${validCountC.toLocaleString()}건 / 확인필요 ${errorCountC.toLocaleString()}건\n` +
              `이전 월 데이터(${oldMonthNames})는 유지됩니다.`
            );
            return;
          }
          for (const oldMonth of oldMonths) {
            const rSnap = await getDocs(collection(db, 'cloud_lists', city, 'months', oldMonth.id, 'records'));
            for (let i = 0; i < rSnap.docs.length; i += 499) {
              const b = writeBatch(db);
              rSnap.docs.slice(i, i + 499).forEach(d => b.delete(d.ref));
              await b.commit();
            }
            await deleteDoc(doc(db, 'cloud_lists', city, 'months', oldMonth.id));
          }
        }
      } catch { /* 구월 정리 실패는 무시 — 핵심 저장은 완료됨 */ }

      gDone(`${city} ${monthStr} · 전체 ${totalCountC.toLocaleString()}명 ${totalQty.toLocaleString()}포 저장 완료`);
      setTimeout(() => {
        /* 좌표 매칭은 서버 스케줄 함수(geocodeAuto)가 업로드 순서대로 자동 처리 — 브라우저 지오코딩 중단 */
      }, 300);
      alert(
        `✅ ${city} ${monthStr} 저장 완료\n\n` +
        `전체 ${totalCountC.toLocaleString()}명 · ${totalQty.toLocaleString()}포\n` +
        `· 수급자 ${수급자Count.toLocaleString()}명 · ${수급자Qty.toLocaleString()}포\n` +
        `· 차상위 ${차상위Count.toLocaleString()}명 · ${차상위Qty.toLocaleString()}포\n\n` +
        `정상 ${validCountC.toLocaleString()}건 / 확인필요 ${errorCountC.toLocaleString()}건`
      );
    } catch (e) {
      setGLoad({ show: false });
      console.error(e);
      alert('저장 실패: ' + e.message);
    }
  };

  const handleBatchSaveBaseList = async (rawValidData) => {
    if (guestMode) { requireLogin(); return; }
    const city = fileInfo?.city;
    if (!city) return alert('지자체 정보를 감지하지 못했습니다. 파일을 다시 확인해주세요.');
    if (isSavingBaseListRef.current) return;
    // 헤더 키워드 이름 행 제거 (방어)
    const HEADER_NAME_RE = /^(이름|성명|대상자|수령자명)$/;
    const validData = rawValidData.filter(d => !HEADER_NAME_RE.test((d.이름 || '').trim()));
    isSavingBaseListRef.current = true;
    setIsSavingBaseList(true);
    const normPhone  = (v) => (v || '').replace(/[^0-9-]/g, ''); // 저장용 (대시 유지)
    const digitKey   = (v) => (v || '').replace(/[^\d]/g, '');   // 인덱스 키용 (숫자만)

    try {
      const existingSnap = await getDocsFromServer(collection(db, 'base_lists', city, 'records'));
      const existing = existingSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // liveByBirth/liveByPhone: DB 기존 + 인플라이트 신규 합산 인덱스
      // 구버전(한국어 키) + 신버전(영문 키) 모두 지원 — 스키마 혼재 대응
      // ─── 매칭 인덱스 (우선순위별 분리) ───────────────────────────────────
      // 1순위: 이름+생년월일
      const liveByBirth    = {};
      // 2순위: 이름+휴대폰 (생년월일 없는 DB 레코드만)
      const liveByPhone    = {};
      // 3순위: 이름+유선전화 (생년월일·휴대폰 모두 없는 DB 레코드만)
      const liveByLandline = {};
      // 생년월일 있는 이름 목록 — 2·3순위 신규 추가 시 중복 방지
      const birthKeyedNames = new Set();

      existing.forEach(r => {
        const rName  = (r.name || r.이름 || '').trim();
        const rBirth = normalizeBirth(r.birthKey || String(r.생년월일 || ''));
        const rPhone = digitKey(r.mobile   || r.휴대폰   || '');
        const rLand  = digitKey(r.landline || r.유선전화  || '');
        if (!rName) return;
        if (rBirth) {
          liveByBirth[`${rName}__${rBirth}`] = r;
          birthKeyedNames.add(rName);
        } else if (rPhone.length >= 9) {
          liveByPhone[`${rName}__${rPhone}`] = r;       // 생년월일 없는 레코드만
        } else if (rLand.length >= 9) {
          liveByLandline[`${rName}__${rLand}`] = r;     // 생년월일·휴대폰 모두 없는 레코드만
        }
      });

      // ② 우선순위 매칭
      const updates    = [];
      const addEntries = [];

      validData.forEach(row => {
        const name    = (row.이름 || '').trim();
        if (!name) return;
        const birthKey = normalizeBirth(row.생년월일 || '');
        const mobile   = normPhone(row.휴대폰);
        const mKey     = digitKey(mobile);
        const landline = normPhone(row.유선전화);
        const lKey     = digitKey(landline);

        // 생년월일·휴대폰·유선전화 모두 없으면 제외
        if (!birthKey && mKey.length < 9 && lKey.length < 9) return;

        // 특이사항 정제: 기본명단에서 다시 가져온 이식 표시만 제거한다.
        // 원본 명단의 문구는 임의 삭제하지 않는다.
        const note = (row.특이사항 || '')
          .replace(/\s*◆[^◆]*/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        const _spl = parseDisplayedAddress(row.주소 || '');
        const payload = {
          name, birthKey,
          dong:    row.행정동 || '',
          address: row.주소   || '',
          // 3분할 주소(도로명주소 비교·표시용): 콤마앞=도로명 / 나머지=상세 / 괄호=법정동·건물명
          roadAddr:   _spl.road   || '',
          detailAddr: _spl.detail || '',
          parenInfo:  _spl.paren  || '',
          mobile,  landline,
          note,
          driver:  row.기사 || '',
          seqNo:   row.배송순번 || '',
          sms:     row.문자수신 || '',
          qty:     parseInt(row.포수 || '1') || 1,
          lat:     row._lat || null,
          lng:     row._lng || null,
          isApt:   row._isApt || false,
          addressMgtNo: row._addressMgtNo || '',
          buildingMgtNo: row._buildingMgtNo || '',
          standardRoadAddress: row._standardRoadAddress || '',
          roadName: row._roadName || '',
          buildingMainNo: row._buildingMainNo ?? '',
          buildingSubNo: row._buildingSubNo ?? '',
          buildingName: row._buildingName || '',
          legalDong: row._legalDong || '',
          matchedSido: row._matchedSido || '',
          matchedSigungu: row._matchedSigungu || '',
          detailAddress: row._detailAddress || '',
          addressMatchSource: row._addressMatchSource || '',
          addressMatchConfidence: row._addressMatchConfidence ?? null,
          routeHints: row._routeHints || null,
          updatedAt: serverTimestamp(),
        };

        if (birthKey) {
          // ── 1순위: 이름+생년월일 ────────────────────────────────────────
          const matched = liveByBirth[`${name}__${birthKey}`];
          if (matched) {
            if (matched._isInFlight) {
              matched.data = {
                ...matched.data, ...payload,
                birthKey: matched.data.birthKey || payload.birthKey,
                mobile:   matched.data.mobile   || payload.mobile,
                landline: matched.data.landline || payload.landline,
              };
            } else {
              updates.push({ id: matched.id, data: payload });
              liveByBirth[`${name}__${birthKey}`] = { ...matched, ...payload };
            }
          } else {
            // 동일인 교차 확인(중복 방지): 같은 사람이 기존엔 생년월일 없이 휴대폰/유선으로만
            // 저장돼 있던 경우, 생년월일이 새로 들어오면 1순위로는 안 잡혀 신규 추가→중복이 된다.
            // → 휴대폰/유선으로 동일인을 찾으면 새로 추가하지 않고 그 레코드에 병합 업데이트한다.
            const xMatch = (mKey.length >= 9 && liveByPhone[`${name}__${mKey}`])
                        || (lKey.length >= 9 && liveByLandline[`${name}__${lKey}`])
                        || null;
            if (xMatch) {
              if (xMatch._isInFlight) {
                // 같은 배치에서 먼저 휴대폰/유선으로 추가된 신규 → 같은 객체에 생년월일 병합
                xMatch.data = {
                  ...xMatch.data, ...payload,
                  mobile:   payload.mobile   || xMatch.data.mobile,
                  landline: payload.landline || xMatch.data.landline,
                };
                liveByBirth[`${name}__${birthKey}`] = xMatch;
              } else {
                // 기존 DB의 전화전용 레코드 → 생년월일 보강 업데이트(연락처는 빈값이면 기존값 보존)
                updates.push({ id: xMatch.id, data: {
                  ...payload,
                  mobile:   payload.mobile   || xMatch.mobile   || xMatch.휴대폰  || '',
                  landline: payload.landline || xMatch.landline || xMatch.유선전화 || '',
                } });
                liveByBirth[`${name}__${birthKey}`] = { ...xMatch, ...payload };
              }
              birthKeyedNames.add(name);
            } else {
              const entry = { _isInFlight: true, data: payload };
              addEntries.push(entry);
              liveByBirth[`${name}__${birthKey}`] = entry;
              birthKeyedNames.add(name);
            }
          }

        } else if (mKey.length >= 9) {
          // ── 2순위: 이름+휴대폰 (생년월일 없는 경우) ────────────────────
          const matched = liveByPhone[`${name}__${mKey}`];
          if (matched) {
            if (matched._isInFlight) {
              matched.data = {
                ...matched.data, ...payload,
                mobile:   matched.data.mobile   || payload.mobile,
                landline: matched.data.landline || payload.landline,
              };
            } else {
              updates.push({ id: matched.id, data: payload });
              liveByPhone[`${name}__${mKey}`] = { ...matched, ...payload };
            }
          } else {
            if (birthKeyedNames.has(name)) return; // 동명 생년월일 레코드 존재 → 추가 금지
            const entry = { _isInFlight: true, data: payload };
            addEntries.push(entry);
            liveByPhone[`${name}__${mKey}`] = entry;
          }

        } else {
          // ── 3순위: 이름+유선전화 (생년월일·휴대폰 모두 없는 경우) ────────
          const matched = liveByLandline[`${name}__${lKey}`];
          if (matched) {
            if (matched._isInFlight) {
              matched.data = {
                ...matched.data, ...payload,
                landline: matched.data.landline || payload.landline,
              };
            } else {
              updates.push({ id: matched.id, data: payload });
              liveByLandline[`${name}__${lKey}`] = { ...matched, ...payload };
            }
          } else {
            if (birthKeyedNames.has(name)) return; // 동명 생년월일 레코드 존재 → 추가 금지
            const entry = { _isInFlight: true, data: payload };
            addEntries.push(entry);
            liveByLandline[`${name}__${lKey}`] = entry;
          }
        }
      });

      const adds = addEntries.map(e => ({ data: e.data }));

      // 동일인이 엑셀에 여러 번 나올 때 같은 문서 ID가 배치에 중복 진입하면
      // Firebase "Every document must have a unique path" 에러 발생 → 마지막 값으로 중복 제거
      const deduped = new Map();
      updates.forEach(u => deduped.set(u.id, u));
      const dedupedUpdates = [...deduped.values()];

      // ③ 499개씩 배치 커밋
      const allOps = [
        ...dedupedUpdates.map(u => ({ type: 'update', id: u.id, data: u.data })),
        ...adds.map(a =>            ({ type: 'add',             data: a.data })),
      ];

      let successCount = 0;
      const errors = [];
      setGLoad({ show: true, msg: '기본명단 저장 중...', sub: `${city} · ${allOps.length.toLocaleString()}건`, pct: 0, done: false, blocking: true });

      for (let i = 0; i < allOps.length; i += 499) {
        try {
          const batch = writeBatch(db);
          allOps.slice(i, i + 499).forEach(op => {
            if (op.type === 'update') {
              batch.set(doc(db, 'base_lists', city, 'records', op.id), op.data, { merge: true });
            } else {
              const newRef = doc(collection(db, 'base_lists', city, 'records'));
              batch.set(newRef, { ...op.data, id: newRef.id });
            }
          });
          await batch.commit();
          successCount += Math.min(499, allOps.length - i);
          gUpdate(Math.round(Math.min(i + 499, allOps.length) / allOps.length * 100));
        } catch (batchErr) {
          console.error(`[배치 ${i}~${i+499}] 오류:`, batchErr);
          errors.push(`배치 ${Math.floor(i/499)+1}: ${batchErr.message}`);
        }
      }

      // ④ 상위 도시 문서 갱신 + 감사 로그
      await setDoc(doc(db, 'base_lists', city), {
        city, updatedAt: serverTimestamp(), author: user?.uid || '',
      }, { merge: true });

      await addDoc(collection(db, 'audit_logs'), {
        action: 'BATCH_SAVE_BASELIST', city,
        addCount: adds.length, updateCount: dedupedUpdates.length,
        successCount, errorCount: errors.length,
        timestamp: serverTimestamp(),
        adminEmail: user?.email || 'unknown',
        expireAt: ttl90(),
      });

      if (errors.length > 0) {
        setGLoad({ show: false });
        alert(`⚠️ 일부 오류 발생!\n신규: ${adds.length}건, 업데이트: ${updates.length}건\n성공: ${successCount}건, 실패 배치: ${errors.length}개\n\n${errors.join('\n')}`);
      } else {
        gDone(`기본명단 저장 완료 · 신규 ${adds.length}건 / 업데이트 ${updates.length}건`);
        alert(`✅ 기본명단 저장 완료!\n신규 추가: ${adds.length}건\n기존 업데이트: ${updates.length}건\n\n[진단] 기존 DB: ${existing.length}건 / 생년월일 인덱스: ${Object.keys(liveByBirth).length}건 / 전화번호 인덱스: ${Object.keys(liveByPhone).length}건`);
      }
    } catch (e) {
      setGLoad({ show: false });
      console.error('[handleBatchSaveBaseList]', e);
      alert('일괄 저장 실패: ' + e.message);
    } finally {
      isSavingBaseListRef.current = false;
      setIsSavingBaseList(false);
    }
  };

  const handleDeleteRows = (ids) => {
    const newData = gridData.filter(r => !ids.has(r.id));
    pushHistory(newData);
  };

  // 이번달 배송명단 → 결과화면으로 불러오기
  const handleOpenInResultGrid = (city, monthId, cloudRecords) => {
    const mapped = cloudRecords.map((r, idx) => ({
      ...r,
      id: r.id || `cloud_${idx}`,
      품명: r.품명 || '',
    }));
    setFileInfo({ city, month: monthId });
    setPurifyResult(null);
    setPrevMonthCompare(null);
    setFilter({ text: '', showErrorsOnly: false, showSuccessOnly: false, 구분: '', dong: '', driver: '', noDriver: false, hasNote: false, inferredAddress: false });
    setCurrentPage(1);
    setSortConfig({ key: '', direction: 'asc' });
    pushHistory(mapped);
    setStep(5);
  };

  const handleBatchSetNote = (ids, note) => {
    const newData = gridData.map(r => ids.has(r.id) ? { ...r, 특이사항: note } : r);
    pushHistory(newData);
  };

  const handleFetchBaseNotes = async () => {
    const city = fileInfo?.city;
    if (!city || !gridData.length) return;
    if (!confirm('기본명단에서 특이사항을 불러와 현재 명단에 이식합니다.\n비어있거나 기본명단과 내용이 다른 경우 모두 업데이트됩니다. 계속하시겠습니까?')) return;
    setIsFetchingNotes(true);
    try {
      const normPhone = (v) => (v || '').replace(/[^0-9]/g, '');
      const baseSnap = await getDocsFromServer(collection(db, `base_lists/${city}/records`));
      const baseRecs = baseSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const HEADER_NAME_RE = /^(이름|성명|대상자|수령자명)$/;
      const byBirth = {}, byPhone = {}, byLandline = {};
      baseRecs.forEach(r => {
        const name = (r.name || r.이름 || '').trim();
        const birth = r.birthKey || normalizeBirth(String(r.생년월일 || ''));
        const mobile = normPhone(r.mobile || r.휴대폰 || '');
        const landline = normPhone(r.landline || r.유선전화 || '');
        const note = (r.note || r.특이사항 || '').trim();
        if (!name || !note) return;
        if (HEADER_NAME_RE.test(name)) return; // 헤더 키워드 이름 매칭 차단
        if (birth) byBirth[`${name}__${birth}`] = note;
        else if (mobile.length >= 9) byPhone[`${name}__${mobile}`] = note;
        else if (landline.length >= 9) byLandline[`${name}__${landline}`] = note;
      });

      let count = 0;
      const newData = gridData.map(r => {
        const name = (r.이름 || '').trim();
        const birth = normalizeBirth(String(r.생년월일 || ''));
        const mobile = normPhone(r.휴대폰 || '');
        const landline = normPhone(r.유선전화 || '');
        let note = '';
        if (birth) note = byBirth[`${name}__${birth}`] || '';
        if (!note && mobile.length >= 9) note = byPhone[`${name}__${mobile}`] || '';
        if (!note && landline.length >= 9) note = byLandline[`${name}__${landline}`] || '';
        if (!note) return r; // 기본명단에 특이사항 없음
        const currentNote = (r.특이사항 || '').trim();
        if (currentNote.includes(note)) return r; // 이미 동일 내용 포함
        const preservedNote = currentNote.replace(/\s*◆[^◆]*/g, '').trim();
        const nextNote = [preservedNote, `◆${note}`].filter(Boolean).join(' ').trim();
        if (nextNote === currentNote) return r;
        count++;
        return { ...r, 특이사항: nextNote };
      });

      if (!count) { alert('업데이트할 특이사항이 없습니다.\n(기본명단에 특이사항이 없거나 이미 모두 동일)'); return; }
      pushHistory(newData);
      alert(`특이사항 이식 완료! ${count}건 업데이트`);
    } catch (e) { alert('오류: ' + e.message); }
    finally { setIsFetchingNotes(false); }
  };

  const handleMovePhones = () => {
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
    const targets = gridData.filter(r => {
      const mobileDigits = (r.휴대폰 || '').replace(/[^0-9]/g, '');
      return !mobileDigits && detectMobile(r.유선전화);
    });
    if (!targets.length) { alert('이동할 전화번호가 없습니다.'); return; }
    if (!window.confirm(`유선전화에 있는 휴대폰 형식 번호 ${targets.length}건을 휴대폰으로 이동합니다.`)) return;
    const targetIds = new Set(targets.map(r => r.id));
    const newData = gridData.map(r => {
      if (!targetIds.has(r.id)) return r;
      const digits = detectMobile(r.유선전화);
      return { ...r, 휴대폰: formatMobile(digits), 유선전화: '' };
    });
    pushHistory(newData);
    alert(`전화번호 이동 완료! ${targets.length}건`);
  };

  const _buildExportFileName = (prefix = '') => {
    const now = new Date();
    const mmdd = String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
    const timeSeq = String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0') + String(now.getSeconds()).padStart(2,'0');
    const safeCity = (fileInfo?.city || '지자체미상').replace(/[/\\*?:"<>|]/g,'_');
    const monthRaw = fileInfo?.month || '';
    const monthStr = monthRaw.match(/^\d{4}-\d{2}$/)
      ? `${parseInt(monthRaw.split('-')[1])}월`
      : (monthRaw.replace(/월/g,'').trim() ? `${monthRaw.replace(/월/g,'').trim()}월` : '미상');
    const suCount  = filteredData.filter(r => r.구분 === '기초수급자').reduce((s,r) => s+(Number(r.포수)||1), 0);
    const chaCount = filteredData.filter(r => r.구분 === '차상위').reduce((s,r) => s+(Number(r.포수)||1), 0);
    const total    = suCount + chaCount;
    const base = `${safeCity}-${monthStr}-기초${suCount},차상위${chaCount},전체${total}-${mmdd}${timeSeq}`;
    return `${prefix}${base}.xlsx`;
  };

  const _runExportWorker = (payload) => {
    const worker = new Worker(new URL('./excelWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.success || e.data.ok) {
        const blob = new Blob([e.data.wbout], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = e.data.fileName || payload.fileName || 'export.xlsx';
        a.click();
      } else {
        alert('내보내기 중 오류가 발생했습니다.');
      }
    };
    worker.onerror = () => { worker.terminate(); alert('내보내기 워커 오류'); };
    worker.postMessage(payload);
  };

  // 내보내기 칼럼: 리(里)는 데이터에 읍/면(리 보유 지역)이 실제로 있고 리 값이 있을 때만 포함(화면 규칙과 동일).
  // 동 지역(시/구 동만)은 리가 없으므로 칼럼 숨김. city 이름이 아니라 '데이터의 읍/면 존재'로 판정(천안시·여주시 등 시 안의 읍/면 대응).
  const _activeExportCols = () => {
    const hasEupMyeon = gridData.some(r => /(읍|면)$/.test(String(r.행정동 ?? '').trim()));
    const showRi = hasEupMyeon && gridData.some(r => String(r.리 ?? '').trim() !== '');
    return exportColOrder.filter(c => c.on && (c.key !== '리' || showRi));
  };

  const handleExport = () => {
    if (!filteredData.length) return alert('내보낼 데이터가 없습니다.');
    const unconfirmed = gridData.filter(r => r._에러 && !r._전화확인).length;
    if (unconfirmed > 0 && !window.confirm(`주소 확인이 안 된 ${unconfirmed}건이 있습니다.\n담당자 확인(주소 입력 또는 전화확인) 후 진행을 권장합니다.\n그래도 다운로드할까요?`)) return;
    const activeCols = _activeExportCols();
    const finalRows = filteredData.map((r, i) => {
      const row = {};
      activeCols.forEach(c => {
        if (c.key === 'NO') row[c.label] = i + 1;
        else if (c.key === '사유') row[c.label] = r._에러 ? r._사유 : '정상';
        else row[c.label] = r[c.key] ?? '';
      });
      return row;
    });
    _runExportWorker({ finalRows, exportCols: activeCols.map(c => c.label), fileName: _buildExportFileName() });
  };

  const handleExportErrors = () => {
    const errors = filteredData.filter(r => r._에러);
    if (!errors.length) return alert('확인 필요 항목이 없습니다.');
    const activeCols = _activeExportCols();
    const finalRows = errors.map((r, i) => {
      const row = {};
      activeCols.forEach(c => {
        if (c.key === 'NO') row[c.label] = i + 1;
        else if (c.key === '사유') row[c.label] = r._사유 || '';
        else row[c.label] = r[c.key] ?? '';
      });
      return row;
    });
    _runExportWorker({ finalRows, exportCols: activeCols.map(c => c.label), fileName: _buildExportFileName('[확인필요]') });
  };

  const handleExportDongSummary = () => {
    if (!filteredData.length) return alert('내보낼 데이터가 없습니다.');
    const activeCols = _activeExportCols();
    _runExportWorker({
      action: 'EXPORT_DONG_SUMMARY',
      rawRows: filteredData,
      activeCols,
      city: fileInfo?.city || '지자체미상',
      month: fileInfo?.month || '미상',
      fileName: _buildExportFileName('[행정동요약]'),
    });
  };

  const handleExportByDriver = () => {
    if (!filteredData.length) return alert('내보낼 데이터가 없습니다.');
    const activeCols = _activeExportCols();
    const worker = new Worker(new URL('./exportWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.success) {
        const blob = new Blob([e.data.wbout], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = e.data.fileName || _buildExportFileName('[기사별]');
        a.click();
      } else {
        alert('기사별 내보내기 오류: ' + e.data.error);
      }
    };
    worker.onerror = () => { worker.terminate(); alert('내보내기 워커 오류'); };
    worker.postMessage({
      action: 'EXPORT_DRIVER_SHEETS',
      rows: filteredData,
      activeCols,
      fileName: _buildExportFileName('[기사별]'),
    });
  };
  const onHelp = () => setShowHelp(true);
  const enterGuest = () => {
    guestModeRef.current = true;
    setGuestMode(true);
    setShowAuth(false);
    setStep(1); // 업로드 화면으로 진입
  };
  // 게스트가 로그인 필요 기능 클릭 시: 작업(gridData) 유지한 채 로그인 화면으로
  const requireLogin = () => {
    guestModeRef.current = false;
    setGuestMode(false);
    setShowAuth(true);
  };
  const guardGuest = (fn) => () => { if (guestMode) { requireLogin(); return; } fn(); };
  const onLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      guestModeRef.current = false;
      setGuestMode(false);
      setShowAuth(true);
      setAuthStatus('unauthenticated');
      setAuthLoading(false);
      setStep(1);
      setGridData([]);
      setFileInfo(null);
      setWorksheets([]);
    } catch (e) {
      console.error('Logout error:', e);
      setAuthLoading(false);
    }
  };

  // 공유 URL로 접근 시 로그인 없이 기사 전용 지도 표시
  if (shareParams) return (
    <ErrorBoundary>
      <ShareRouteView shareId={shareParams.shareId} driverId={shareParams.driverId} />
    </ErrorBoundary>
  );

  if (showAuth) return <AuthScreen authStatus={authStatus} authLoading={authLoading} handleGoogleLogin={handleGoogleLogin} onGuestStart={enterGuest} />;

  // Lazy 컴포넌트용 fallback — 투명하게 처리 (로딩 스피너 없음)
  const LazyFallback = null;

  // ── V5.0 사이드바 헬퍼 컴포넌트 ──────────────────────────────────────────────
  const SidebarSection = ({ label }) => sidebarCollapsed ? (
    <div className="my-1 mx-1.5 border-t border-[#0d1520]" />
  ) : (
    <div className="px-3 pt-3 pb-0.5">
      <span className="text-[8.5px] font-black tracking-[0.15em] text-gray-700 uppercase">{label}</span>
    </div>
  );

  const SidebarItem = ({ icon: Icon, label, active, onClick, badge, locked, recommended }) => (
    <button
      onClick={locked ? undefined : onClick}
      title={sidebarCollapsed ? label : undefined}
      className={`relative flex items-center rounded-xl transition-all group text-left w-full
        ${sidebarCollapsed ? 'justify-center h-9 w-9 mx-auto px-0' : 'gap-2.5 px-3 py-2.5'}
        ${active
          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shadow-[0_0_12px_rgba(16,185,129,0.08)]'
          : locked
          ? 'text-gray-700 cursor-default border border-transparent'
          : recommended
          ? 'text-emerald-300 bg-emerald-500/8 border border-emerald-500/15 hover:bg-emerald-500/12'
          : 'text-gray-500 hover:bg-white/5 hover:text-gray-200 border border-transparent'}
      `}
    >
      <Icon size={15} className="shrink-0" />
      {!sidebarCollapsed && (
        <>
          <span className="text-[11.5px] font-bold flex-1 truncate leading-none">{label}</span>
          {badge && <span className={`text-[9px] min-w-[16px] px-1 py-0.5 rounded-full font-black text-center ${badge.type === 'error' ? 'bg-amber-500 text-black' : 'bg-emerald-500/25 text-emerald-300'}`}>{badge.count}</span>}
          {locked && <span className="text-[8px] bg-purple-900/30 text-purple-500 border border-purple-800/30 px-1 py-0.5 rounded font-black">PRO</span>}
          {recommended && <span className="text-[8px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-1 py-0.5 rounded font-black">추천</span>}
        </>
      )}
      {sidebarCollapsed && badge && badge.count > 0 && (
        <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-red-500 rounded-full" />
      )}
    </button>
  );

  return (
    <ErrorBoundary>
    <Suspense fallback={LazyFallback}>
      <div className="w-full h-screen bg-[#070807] text-white flex flex-col font-sans overflow-hidden">

        {showIntro && <IntroScreen user={user} reason={introReason} meta={introMeta} onComplete={() => setShowIntro(false)} />}

        {/* ── V5.0 HEADER ── */}
        <header className="h-14 shrink-0 bg-[#080b0c] border-b border-[#17201f] flex items-center gap-4 px-4 z-50 shadow-[0_1px_0_rgba(45,212,191,0.05)]">
          {/* 로고 */}
          <button onClick={() => setStep(guestMode ? 1 : 0)} className="shrink-0 hover:opacity-80 transition-opacity outline-none" title="홈으로">
            <img src="/ttlogo1.png" alt="NEXUS PIPELINE" className="h-9 object-contain" />
          </button>

          {/* 가운데: 파이프라인 Step 1~3 진행 표시줄 또는 파일 정보 */}
          <div className="flex-1 flex items-center justify-center gap-3">
            {step >= 1 && step <= 3 ? (
              /* Step 1~3: 진행 표시줄 */
              <div className="flex items-center gap-1.5">
                {[
                  { n: 1, label: '업로드', active: step === 1, done: step > 1 },
                  { n: 2, label: '시트 분류', active: step === 2, done: step > 2 },
                  { n: 3, label: '컬럼 매핑', active: step === 3, done: false },
                ].map((s, i) => (
                  <div key={s.n} className="flex items-center gap-1.5">
                    {i > 0 && <div className={`w-6 h-px ${s.done || step > s.n ? 'bg-emerald-500/60' : 'bg-[#1e2d2b]'}`} />}
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                      s.active ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                      : s.done  ? 'text-emerald-500/70'
                      : 'text-gray-700'
                    }`}>
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${
                        s.done   ? 'bg-emerald-500 text-black'
                        : s.active ? 'border border-emerald-400 text-emerald-300'
                        : 'border border-[#2a2a2a] text-gray-700'
                      }`}>{s.done ? '✓' : s.n}</span>
                      <span className="hidden sm:block">{s.label}</span>
                    </div>
                  </div>
                ))}
                {fileInfo?.city && (
                  <div className="ml-2 flex items-center gap-1.5 text-xs text-gray-500 border-l border-[#1e2d2b] pl-3">
                    <span className="text-white font-bold">{fileInfo.city}</span>
                    {fileInfo.month && <span className="text-gray-600">{fileInfo.month}</span>}
                  </div>
                )}
              </div>
            ) : step >= 4 && step <= 5 && fileInfo ? (
              /* Step 4~5: 파일 정보 칩 */
              <div className="flex items-center gap-2 text-xs bg-[#0d1413]/90 px-3 py-1.5 rounded-lg border border-[#1c2b29]">
                <span className="text-emerald-300 font-black">{workflow.shortTitle}</span>
                <span className="text-[#253534]">·</span>
                <span className="text-white font-black">{fileInfo.city || '지자체 미상'}</span>
                {fileInfo.month && (
                  <>
                    <span className="text-[#1a2a3a]">·</span>
                    <span className="text-gray-400 font-bold">{fileInfo.month}</span>
                  </>
                )}
                {step === 5 && gridData.length > 0 && (
                  <>
                    <span className="text-[#1a2a3a]">·</span>
                    <span className="text-emerald-300 font-black">{gridData.length.toLocaleString()}건</span>
                    {gridData.filter(r => r._에러).length > 0 && (
                      <span className="text-amber-400 font-bold">· 확인필요 {gridData.filter(r => r._에러).length}건</span>
                    )}
                  </>
                )}
              </div>
            ) : null}
          </div>

          {/* 오른쪽: 액션 버튼 */}
          <div className="flex items-center gap-2 shrink-0">
            {gridData.some(r => r._에러) && (
              <button onClick={() => setStep(10)} className="px-3 py-1.5 bg-amber-950/40 text-amber-400 border border-amber-600/40 hover:bg-amber-900/40 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors">
                <span className="inline-flex items-center justify-center w-4 h-4 bg-amber-500 text-black text-[9px] font-black rounded-full">{gridData.filter(r => r._에러).length}</span>
                확인필요
              </button>
            )}
            <button onClick={handleUndo} disabled={history.length === 0} className="px-3 py-1.5 bg-[#0d1520] hover:bg-[#111c2d] disabled:opacity-30 text-gray-400 hover:text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 border border-[#1a2a3a]">
              <Undo2 size={13} /> 실행취소
            </button>
            <InstallButton />
            <div className="w-px h-5 bg-[#1a2a3a]" />
            {guestMode ? (
              <button onClick={requireLogin} className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-extrabold rounded-lg transition-colors flex items-center gap-1.5">
                로그인하고 전체 기능
              </button>
            ) : (
              <span className="text-gray-600 text-xs truncate max-w-[130px] hidden xl:block">{user?.realName || user?.email?.split('@')[0]}</span>
            )}
          </div>
        </header>

        {/* ── V5.0 BODY: 사이드바 + 메인 콘텐츠 ─────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── 좌측 사이드바 ── */}
          <aside className={`shrink-0 flex flex-col bg-gradient-to-b from-[#08100f] via-[#070b0b] to-[#050706] border-r border-[#17201f] transition-all duration-300 overflow-hidden z-30 ${sidebarCollapsed ? 'w-[52px]' : 'w-[210px]'}`}>

            {/* 토글 버튼 */}
            <div className={`flex py-2 px-1.5 ${sidebarCollapsed ? 'justify-center' : 'justify-end'}`}>
              <button
                onClick={() => setSidebarCollapsed(v => !v)}
                title={sidebarCollapsed ? '메뉴 펼치기' : '메뉴 접기'}
                className="p-1.5 rounded-lg text-gray-700 hover:text-gray-400 hover:bg-white/5 transition-colors"
              >
                {sidebarCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-2 space-y-0.5 scrollbar-none">

              {/* 홈 */}
              <SidebarItem icon={Home} label="홈 / 대시보드" active={step === 0} onClick={() => setStep(guestMode ? 1 : 0)} />

              {/* ── 파이프라인 ── */}
              <SidebarSection label="파이프라인" />
              {step >= 1 && step <= 5 && !sidebarCollapsed ? (
                <div className="px-1 py-1 space-y-0.5">
                  {[
                    { key: 'upload', n: 1 },
                    { key: 'cleaning', n: 4 },
                    { key: 'issues', n: 5 },
                    ...workflowSteps.filter(k => !['upload', 'cleaning', 'issues'].includes(k)).map(key => ({ key, n: 5 })),
                  ].map(({ key, n }) => {
                    const status = stepStatus[key];
                    const done = status === 'done';
                    const active = (key === 'upload' && step >= 1 && step <= 3) || (key === 'cleaning' && step === 4) || (key === 'issues' && step === 5);
                    const attention = status === 'attention';
                    return (
                      <div key={key} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold transition-colors cursor-default
                        ${active ? 'bg-cyan-500/12 text-cyan-300 border border-cyan-500/20' : attention ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20' : done ? 'text-emerald-500/80' : 'text-gray-700'}`
                      }>
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] shrink-0 font-black
                          ${done ? 'bg-emerald-500 text-black' : attention ? 'border border-amber-400 text-amber-300' : active ? 'border border-cyan-400 text-cyan-300' : 'border border-[#2a2a2a] text-gray-700'}`
                        }>{done ? '✓' : attention ? '!' : n}</div>
                        {WORKFLOW_STEP_LABELS[key] || key}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <SidebarItem
                  icon={FileSpreadsheet}
                  label="새 명단 처리"
                  active={step >= 1 && step <= 5}
                  onClick={() => setStep(step >= 1 && step <= 5 ? step : 1)}
                  recommended={step === 0 && gridData.length === 0}
                />
              )}

              {/* ── 배송 관리 ── */}
              <SidebarSection label="배송 관리" />
              <SidebarItem icon={Database} label="이번달 배송명단" active={step === 8} onClick={guardGuest(() => { setDbNavCity(''); setStep(8); })} />
              {(workflowMode === 'deliveryFull' || gridData.length === 0) ? (
                <SidebarItem
                  icon={MapPin}
                  label="기사 배정 · 루트맵"
                  active={showRouteQuick || showRouteSetup || showRouteMap}
                  onClick={() => { if (!canUseRouteMap(user)) { setUpgradeReason('routeMap'); setShowUpgrade(true); } else setShowRouteQuick(true); }}
                  locked={!canUseRouteMap(user)}
                  recommended={step === 5 && gridData.length > 0 && !gridData.some(r => r.기사)}
                />
              ) : (
                <SidebarItem
                  icon={MapPin}
                  label="배송 배정 추가"
                  active={false}
                  onClick={openRouteFlow}
                  locked={!canUseRouteMap(user)}
                />
              )}
              <SidebarItem icon={CalendarDays} label="배송일정" active={step === 11} onClick={guardGuest(() => setStep(11))} />

              {/* ── 데이터 관리 ── */}
              <SidebarSection label="데이터 관리" />
              <SidebarItem icon={BookOpen} label="기본명단 관리" active={step === 6} onClick={guardGuest(() => { setDbNavCity(''); setStep(6); })} />
              <SidebarItem
                icon={BarChart3}
                label="DB 현황 조회"
                active={step === 9}
                onClick={() => { if (!canUseDbOverview(user)) { setUpgradeReason('dbOverview'); setShowUpgrade(true); } else { setStep(9); setDbNavCity(''); } }}
                locked={!canUseDbOverview(user)}
              />
              <SidebarItem icon={Truck} label="기사 관리" active={showDriverRegistry} onClick={guardGuest(() => setShowDriverRegistry(true))} />
              <SidebarItem icon={HardDrive} label="저장 내역" active={showSavedRecords} onClick={guardGuest(() => setShowSavedRecords(true))} />

              {/* ── 설정 ── */}
              <SidebarSection label="설정" />
              <SidebarItem icon={Layers} label="부가서비스" active={showUtils} onClick={() => setShowUtils(true)} />
              <SidebarItem icon={HelpCircle} label="사용 가이드" active={false} onClick={() => openManualFor(user?.tier)} />
              <SidebarItem icon={Crown} label="회원등급" active={false} onClick={guardGuest(() => { setUpgradeReason('city_limit'); setShowUpgrade(true); })} />
              <SidebarItem icon={UserCircle} label="내 프로필" active={profileModal.open} onClick={guardGuest(() => setProfileModal({ open: true, isNew: false }))} />

              {/* ── 관리자 ── */}
              {user?.role === 'admin' && (
                <>
                  <SidebarSection label="관리자" />
                  <SidebarItem
                    icon={ShieldCheck}
                    label="관리자 패널"
                    active={step === 7}
                    onClick={() => setStep(7)}
                    badge={pendingInquiriesCount > 0 ? { count: pendingInquiriesCount, type: 'error' } : null}
                  />
                </>
              )}
            </nav>

            {/* 로그아웃 */}
            <div className="shrink-0 p-2 border-t border-[#0d1520]">
              <button
                onClick={onLogout}
                title="로그아웃"
                className={`flex items-center gap-2.5 py-2 rounded-xl text-red-500/70 hover:text-red-400 hover:bg-red-950/20 border border-transparent transition-all w-full ${sidebarCollapsed ? 'justify-center px-1' : 'px-3'}`}
              >
                <LogOut size={14} />
                {!sidebarCollapsed && <span className="text-[11.5px] font-bold">로그아웃</span>}
              </button>
            </div>
          </aside>

          {/* ── 메인 콘텐츠 영역 ── */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* ── 단계 2~5 공통 요약바 ─────────────────────────────────────── */}
        {step >= 2 && step <= 5 && fileInfo && (
          <div className="shrink-0 bg-[#070908]/92 border-b border-[#17201f] px-5 py-2 flex items-center gap-2.5 text-xs flex-wrap">
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-black">{workflow.title}</span>
            <span className="text-white font-black tracking-wide">{fileInfo.city || '지자체 미상'}</span>
            <span className="text-gray-700">|</span>
            <span className="text-gray-300 font-bold">{fileInfo.month || '-'}</span>
            <span className="text-gray-700">|</span>
            {step === 5 ? (
              <>
                <span className="text-emerald-300 font-black">
                  수급자 {gridData.filter(d => d.구분 === '기초수급자').reduce((s, d) => s + (parseInt(d.포수) || 1), 0).toLocaleString()}포
                </span>
                <span className="text-gray-700">|</span>
                <span className="text-amber-300 font-black">
                  차상위 {gridData.filter(d => d.구분 === '차상위').reduce((s, d) => s + (parseInt(d.포수) || 1), 0).toLocaleString()}포
                </span>
                <span className="text-gray-700">|</span>
                <span className="text-emerald-400 font-black">
                  전체 {gridData.reduce((s, d) => s + (parseInt(d.포수) || 1), 0).toLocaleString()}포
                </span>
                <span className="ml-1 text-[10px] text-gray-600">({gridData.length.toLocaleString()}명)</span>
              </>
            ) : (
              <>
                {(() => {
                  const sheets = worksheets.filter(s => s.selected !== false);
                  const su  = sheets.filter(s => s.type === '기초수급자').reduce((a, s) => a + (s.qty || 0), 0);
                  const cha = sheets.filter(s => s.type === '차상위').reduce((a, s) => a + (s.qty || 0), 0);
                  const mix = sheets.filter(s => s.type !== '기초수급자' && s.type !== '차상위').reduce((a, s) => a + (s.qty || 0), 0);
                  const total = su + cha + mix;
                  return (
                    <>
                      <span className="text-emerald-300 font-black">수급자 {su.toLocaleString()}포</span>
                      <span className="text-gray-700">|</span>
                      <span className="text-amber-300 font-black">차상위 {cha.toLocaleString()}포</span>
                      <span className="text-gray-700">|</span>
                      <span className="text-emerald-400 font-black">전체 {total.toLocaleString()}포</span>
                      <span className="ml-1 text-[10px] text-gray-600 italic">(예상)</span>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        )}

        <main className="flex-1 relative overflow-hidden bg-[#070807] flex flex-col">
          {step === 0 && <Dashboard user={user} onLogout={onLogout} onStart={(s) => setStep(typeof s === 'number' ? s : 1)} onHelp={onHelp} setFileInfo={setFileInfo} setWorksheets={setWorksheets} setBaseCount={setBaseCount} gridData={gridData} setGridData={setGridData} fileInfo={fileInfo} onCloudCard={(city) => { setDbNavCity(city); setStep(8); }} onBaseCard={(city) => { setDbNavCity(city); setStep(6); }} onOpenRouteMap={() => { if (!canUseRouteMap(user)) { setUpgradeReason('routeMap'); setShowUpgrade(true); } else setShowRouteQuick(true); }} workflowMode={workflowMode} onWorkflowModeChange={changeWorkflowMode} stepStatus={stepStatus} onOpenIntro={() => { setIntroReason('new'); setShowIntro(true); }} />}
          {step === 1 && <Step1_Upload handleDragOver={handleDragOver} handleDrop={handleDrop} handleFileUpload={handleFileUpload} handleUnifiedDrop={handleUnifiedDrop} isBaseUploading={isBaseUploading} step={step} onHelp={onHelp} onOpenDashboard={() => setStep(0)} cleanMode={cleanMode} setCleanMode={setCleanMode} analyzing={analyzing} />}
          {step === 2 && <Step2_SheetSelect step={step} setStep={setStep} fileInfo={fileInfo} setFileInfo={setFileInfo} worksheets={worksheets} setWorksheets={setWorksheets} setSelectedSheets={setSelectedSheets} onHelp={onHelp} handleSecondFileUpload={handleSecondFileUpload} userCities={user?.citiesApproved || []} isAdmin={user?.role === 'admin'} />}
          {step === 3 && <Step3_Mapping step={step} setStep={setStep} selectedSheets={selectedSheets} worksheets={worksheets} mapDefs={mapDefs} setMapDefs={setMapDefs} startProcessing={handleAnalyzeAll} onHelp={onHelp} isBasePurifyMode={isBasePurifyMode} setIsBasePurifyMode={setIsBasePurifyMode} onOpenDbImport={() => setShowDbImport(true)} dbImportReady={dbImportReady} onUserMapping={handleUserMapping} city={fileInfo?.city || ''} />}
          {step === 4 && <LoadingScreen progress={engineProgress} logs={progressLogs} />}
          {step === 5 && <ResultGrid step={step} setStep={setStep} fileInfo={fileInfo} filter={filter} setFilter={setFilter} dongList={gridDongList} driverList={gridDriverList} gridData={gridData} filteredData={filteredData} paginatedData={paginatedData} currentPage={currentPage} setCurrentPage={setCurrentPage} itemsPerPage={itemsPerPage} setItemsPerPage={setItemsPerPage} colVis={colVis} sortConfig={sortConfig} setSortConfig={setSortConfig} handleCellEdit={handleCellEdit} handleAddressKeyDown={handleAddressKeyDown} handleUpdateBaseList={handleUpdateBaseList} handleBatchSaveBaseList={handleBatchSaveBaseList} isSavingBaseList={isSavingBaseList} handleSaveMonthlyList={handleSaveMonthlyList} setShowExportSetting={setShowExportSetting} handleExport={handleExport} handleExportErrors={handleExportErrors} handleExportDongSummary={handleExportDongSummary} handleExportByDriver={handleExportByDriver} handleDeleteRows={handleDeleteRows} handleBatchSetNote={handleBatchSetNote} onHelp={onHelp} purifyResult={purifyResult} onClosePurifyResult={() => setPurifyResult(null)} onMovePhones={handleMovePhones} onRepurifyErrors={handleRepurifyErrors} onReapplyFormat={handleReapplyFormat} onConfirmAddress={handleConfirmAddress} onMarkPhoneCheck={handleMarkPhoneCheck} onOpenRouteMap={openRouteFlow} onFetchBaseNotes={handleFetchBaseNotes} isFetchingNotes={isFetchingNotes} workflowMode={workflowMode} onWorkflowModeChange={changeWorkflowMode} stepStatus={stepStatus} addressDisplayMode={addressDisplayMode} onToggleAddressDisplayMode={handleToggleAddressDisplayMode} exportColOrder={exportColOrder} setExportColOrder={setExportColOrder} defaultExportCols={DEFAULT_EXPORT_COLS} />}
          {step === 10 && <ErrorListManager gridData={gridData} onBack={() => setStep(gridData.length ? 5 : 0)} handleCellEdit={handleCellEdit} handleAddressKeyDown={handleAddressKeyDown} handleExportErrors={handleExportErrors} onRepurifyErrors={handleRepurifyErrors} exportColOrder={exportColOrder} setExportColOrder={setExportColOrder} defaultExportCols={DEFAULT_EXPORT_COLS} />}
          {step === 11 && <ScheduleTab user={user} onBack={() => setStep(0)} />}
          {step === 6 && <BaseListManager user={user} initialCity={dbNavCity} onBack={() => { setStep(0); setDbNavCity(''); }} exportColOrder={exportColOrder} setExportColOrder={setExportColOrder} defaultExportCols={DEFAULT_EXPORT_COLS} />}
          {step === 7 && <AdminPanel user={user} onClose={() => setStep(0)} />}
          {step === 8 && <CloudListManager user={user} initialCity={dbNavCity} onBack={() => { setStep(0); setDbNavCity(''); }} onOpenRouteMap={(city, monthId, orgDongs) => { if (!canUseRouteMap(user)) { setUpgradeReason('routeMap'); setShowUpgrade(true); } else { setCloudRouteConfig({ city, monthId, orgDongs }); setShowRouteSetup(true); } }} onOpenInResultGrid={handleOpenInResultGrid} exportColOrder={exportColOrder} setExportColOrder={setExportColOrder} defaultExportCols={DEFAULT_EXPORT_COLS} />}
          {step === 9 && (
            <DbOverview
              onBack={() => setStep(0)}
              onGoToBase={(city) => { setDbNavCity(city); setStep(6); }}
              onGoToCloud={(city) => { setDbNavCity(city); setStep(8); }}
            />
          )}
          {step === 11 && <ScheduleTab user={user} onBack={() => setStep(0)} />}
        </main>

          </div>{/* end 메인 콘텐츠 영역 */}

        </div>{/* end V5.0 BODY */}

        {/* 지자체·적용월 확인 모달 */}
        {showCityPicker && (
          <CityMonthPickerModal
            userId={user?.uid || ''}
            detectedCity={pendingSetup?.detectedCity || ''}
            detectedMonth={pendingSetup?.monthStr || ''}
            userCities={user?.citiesApproved || []}
            isAdmin={user?.role === 'admin'}
            uploadGubuns={pendingSetup?.uploadGubuns || []}
            uploadCounts={pendingSetup?.uploadCounts || null}
            onConfirm={handleCityMonthConfirm}
            onCancel={handleCityMonthCancel}
          />
        )}

        {/* 쉬운 정제 확인 카드 (초보 모드) */}
        {showEasyConfirm && (
          <EasyCleanConfirm
            city={fileInfo?.city || ''}
            month={fileInfo?.month || ''}
            sheets={selectedSheets}
            allSheets={worksheets}
            mapDefs={mapDefs}
            analysis={analysisSummary}
            onConfirm={handleEasyConfirm}
            onAdvanced={handleEasyToAdvanced}
            onCancel={() => { setShowEasyConfirm(false); setStep(0); }}
          />
        )}

        {/* RESTORED MODAL RENDERS */}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        {showUtils && <UtilsModal user={user} onClose={() => setShowUtils(false)} />}
        {showUpgrade && <UpgradeModal user={user} userTier={user?.tier || 'basic'} usedCount={baseCount} userMaxCities={user?.maxCities || 1} reason={upgradeReason} onClose={() => setShowUpgrade(false)} />}
        {showCloudBase && <CloudBaseModal user={user} onClose={() => setShowCloudBase(false)} onImport={(newBaseMap, _city, count) => { setBaseMap(newBaseMap); setBaseCount(count); setImportFields(null); setDbImportReady(null); setShowCloudBase(false); }} />}
        {showDbImport && <DbImportModal defaultCity={fileInfo?.city || ''} onClose={() => setShowDbImport(false)} onImport={(newBaseMap, fields, _city, count) => { setBaseMap(newBaseMap); setImportFields(fields); setDbImportReady({ count, fields }); setShowDbImport(false); }} />}
        {showRouteQuick && (
          <RouteQuickModal
            user={user}
            onClose={() => setShowRouteQuick(false)}
            onConfirm={(city, monthId) => {
              setCloudRouteConfig({ city, monthId, orgDongs: null });
              setRouteBackToMatch(false);
              setShowRouteQuick(false);
              setShowRouteSetup(true);
            }}
            onOpenSession={(city, monthId, drivers) => {
              setCloudRouteConfig({ city, monthId, orgDongs: null });
              setRouteSetupResult({ drivers: drivers || null, selectedDongs: null, baseDailyQty: 40 });
              setShowRouteQuick(false);
              setShowRouteMap(true);
            }}
          />
        )}
        {showRouteSetup && (
          <RouteSetupModal
            mode={cloudRouteConfig ? 'cloud' : 'local'}
            allRecords={gridData}
            city={fileInfo?.city || ''}
            cloudCity={cloudRouteConfig?.city}
            cloudMonthId={cloudRouteConfig?.monthId}
            orgDongs={routeSetupResult?.scopeDongs || cloudRouteConfig?.orgDongs || null}
            user={user}
            startAtMatch={routeBackToMatch}
            restoreState={routeBackToMatch ? routeSetupResult : null}
            onStart={({ selectedDongs, drivers, companyDrivers, dongDriverMap, baseDailyQty, orgId, scopeDongs }) => {
              const restoredScopeDongs = scopeDongs || cloudRouteConfig?.orgDongs || null;
              setRouteSetupResult({ selectedDongs, drivers, companyDrivers, dongDriverMap, baseDailyQty, orgId: orgId || 'all', scopeDongs: restoredScopeDongs });
              if (restoredScopeDongs && cloudRouteConfig) {
                setCloudRouteConfig(prev => prev ? { ...prev, orgDongs: restoredScopeDongs } : prev);
              }
              setRouteBackToMatch(false);
              setShowRouteSetup(false);
              setShowRouteMap(true);
            }}
            onClose={() => { setShowRouteSetup(false); setCloudRouteConfig(null); setRouteSetupResult(null); setRouteBackToMatch(false); }}
          />
        )}
        {showRouteMap && (
          <RouteMapModal
            gridData={cloudRouteConfig ? [] : gridData.filter(r => !routeSetupResult?.selectedDongs || routeSetupResult.selectedDongs.has(r.행정동))}
            fileInfo={fileInfo}
            onClose={() => { setShowRouteMap(false); setCloudRouteConfig(null); setRouteSetupResult(null); }}
            onBack={(restorePayload = null) => {
              if (restorePayload) {
                setRouteSetupResult(prev => ({
                  ...(prev || {}),
                  ...restorePayload,
                  selectedDongs: restorePayload.selectedDongs ?? prev?.selectedDongs ?? null,
                  drivers: restorePayload.drivers || prev?.drivers || null,
                  companyDrivers: restorePayload.companyDrivers || prev?.companyDrivers || restorePayload.drivers || prev?.drivers || null,
                  dongDriverMap: restorePayload.dongDriverMap || prev?.dongDriverMap || null,
                  baseDailyQty: restorePayload.baseDailyQty || prev?.baseDailyQty || 40,
                  orgId: restorePayload.orgId || prev?.orgId || 'all',
                  scopeDongs: restorePayload.scopeDongs || restorePayload.orgDongs || prev?.scopeDongs || null,
                }));
                const restoreScopeDongs = restorePayload.scopeDongs || restorePayload.orgDongs || null;
                if (restoreScopeDongs) {
                  setCloudRouteConfig(prev => prev ? { ...prev, orgDongs: restoreScopeDongs } : prev);
                }
              }
              setShowRouteMap(false);
              setRouteBackToMatch(true);
              setShowRouteSetup(true);
            }}
            onSave={(updated) => pushHistory(updated)}
            initialCloudCity={cloudRouteConfig?.city || null}
            initialCloudMonthId={cloudRouteConfig?.monthId || null}
            orgDongs={routeSetupResult?.scopeDongs || cloudRouteConfig?.orgDongs || null}
            initialDrivers={routeSetupResult?.drivers || null}
            companyDrivers={routeSetupResult?.companyDrivers || routeSetupResult?.drivers || null}
            setupDongDriverMap={routeSetupResult?.dongDriverMap || null}
            orgId={routeSetupResult?.orgId || 'all'}
            selectedDongs={routeSetupResult?.selectedDongs || null}
            baseDailyQty={routeSetupResult?.baseDailyQty || 40}
          />
        )}
        {showDriverRegistry && (
          <DriverRegistryModal
            user={user}
            onClose={() => setShowDriverRegistry(false)}
          />
        )}
        {showSavedRecords && (
          <SavedRecordsModal
            user={user}
            onClose={() => setShowSavedRecords(false)}
            onEdit={(city, monthId) => {
              setCloudRouteConfig({ city, monthId, orgDongs: null });
              setRouteBackToMatch(false);
              setShowSavedRecords(false);
              setShowRouteSetup(true);
            }}
          />
        )}
        {profileModal.open && <ProfileSetupModal user={user} isNewUser={profileModal.isNew} onClose={(saved, savedRegion) => { const wasNew = profileModal.isNew; setProfileModal({ open: false, isNew: false }); if (saved) { setIntroReason(wasNew ? 'new' : 'region'); setIntroMeta({ region: savedRegion }); setShowIntro(true); } }} />}
        {showPrevCompare && prevMonthCompare && (
          <PrevMonthCompareModal
            data={prevMonthCompare}
            onClose={() => setShowPrevCompare(false)}
          />
        )}
        {bgSaveCoordState && (
          <div className="fixed bottom-5 right-5 z-[250] min-w-[280px] max-w-sm rounded-2xl border border-[#243044] bg-[#0d1117] px-4 py-3 shadow-2xl text-xs">
            {bgSaveCoordState.isDone ? (
              <div className="flex items-center gap-3">
                <span className={`h-3.5 w-3.5 rounded-full ${bgSaveCoordState.failed ? 'bg-red-400' : bgSaveCoordState.canceled ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                <div className="min-w-0 flex-1">
                  <div className="font-black text-white">
                    {bgSaveCoordState.failed ? '좌표 백그라운드 처리 확인 필요' : bgSaveCoordState.canceled ? '좌표 백그라운드 중단됨' : '좌표 백그라운드 매칭 완료'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-400">
                    성공 {bgSaveCoordState.success.toLocaleString()} / 대상 {bgSaveCoordState.total.toLocaleString()}건
                  </div>
                </div>
                <button onClick={() => setBgSaveCoordState(null)} className="text-gray-500 hover:text-white">
                  ×
                </button>
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-3">
                  <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-black text-white">저장 후 좌표를 천천히 받는 중</div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {bgSaveCoordState.city} {bgSaveCoordState.monthId}
                    </div>
                  </div>
                  <button
                    onClick={() => { bgSaveCoordCancelRef.current = true; }}
                    className="rounded-lg border border-red-500/20 px-2 py-1 text-[10px] font-bold text-red-400 hover:bg-red-950/30"
                  >
                    중단
                  </button>
                </div>
                <div className="mb-1 flex items-center justify-between text-[11px] font-bold">
                  <span className="text-gray-500">진행 {bgSaveCoordState.done.toLocaleString()} / {bgSaveCoordState.total.toLocaleString()}</span>
                  <span className="text-emerald-300">성공 {bgSaveCoordState.success.toLocaleString()}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${bgSaveCoordState.total ? Math.round(bgSaveCoordState.done / bgSaveCoordState.total * 100) : 0}%` }}
                  />
                </div>
              </>
            )}
          </div>
        )}
        <GlobalLoadingBar state={gLoad} />
      </div>
    </Suspense>
    </ErrorBoundary>
  );
}
