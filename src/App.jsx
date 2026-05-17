import { useState, useEffect, useMemo, useRef } from "react";
import { auth, onAuthStateChanged, signOut, setDoc, getDoc, updateDoc, doc, db, serverTimestamp, addDoc, collection, getDocs, getDocsFromServer, writeBatch, query, where, onSnapshot, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from "./config/firebase.js";
import { APP_VERSION } from "./version.js";

import Dashboard from "./components/Dashboard.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import ProfileSetupModal from "./components/ProfileSetupModal.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import Step1_Upload from "./components/Step1_Upload.jsx";
import Step2_SheetSelect from "./components/Step2_SheetSelect.jsx";
import Step3_Mapping from "./components/Step3_Mapping.jsx";
import LoadingScreen from "./components/LoadingScreen.jsx";
import ResultGrid from "./components/ResultGrid.jsx";
import HelpModal from "./components/HelpModal.jsx";
import UpgradeModal from "./components/UpgradeModal.jsx";
import UtilsModal from "./components/UtilsModal.jsx";
import CloudBaseModal from "./components/CloudBaseModal.jsx";
import DbImportModal from "./components/DbImportModal.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import GlobalLoadingBar from "./components/GlobalLoadingBar.jsx";
import BaseListManager from "./components/BaseListManager.jsx";
import CloudListManager from "./components/CloudListManager.jsx";
import ErrorListManager from "./components/ErrorListManager.jsx";
import DbOverview from "./components/DbOverview.jsx";
import IntroScreen from "./components/IntroScreen.jsx";
import PrevMonthCompareModal from "./components/PrevMonthCompareModal.jsx";

import { processAddress, asyncPool, addTypoRecord, loadTypoDict } from "./engine/addressEngine.js";
import { parsePhoneNumbers, parseSMS, parseBirthDate, normalizeBirth, extractPhoneNote, formatPhone } from "./utils/parsers.js";
import { canUseRouteMap, canUseDbOverview, canUseDriverRegistry, getMonthlyLimit } from "./utils/tierUtils.js";
import { LogOut, ShieldCheck, CheckCircle, Database, Crown, Layers, UserCircle, Undo2, Menu, BarChart3, MapPin, Truck } from "lucide-react";
import RouteMapModal from "./components/RouteMapModal.jsx";
import RouteSetupModal from "./components/RouteSetupModal.jsx";
import RouteQuickModal from "./components/RouteQuickModal.jsx";
import ShareRouteView from "./components/ShareRouteView.jsx";
import DriverRegistryModal from "./components/DriverRegistryModal.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(true);
  const [authStatus, setAuthStatus] = useState('checking');
  const [authLoading, setAuthLoading] = useState(false);
  const [step, setStep] = useState(0); 
  const [fileInfo, setFileInfo] = useState(null);
  const [worksheets, setWorksheets] = useState([]);
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [aiRules, setAiRules] = useState(null);
  const [mapDefs, setMapDefs] = useState({});
  const [gridData, setGridData] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: '', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 500;

  const isBaseUploading = false;
  const [engineProgress, setEngineProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [progressLogs, setProgressLogs] = useState([]);
  const [filter, _setFilter] = useState({ text: "", showErrorsOnly: false, showSuccessOnly: false, 구분: '', dong: '', driver: '', noDriver: false, hasNote: false });
  // setFilter는 항상 페이지를 1로 리셋 (React 18 자동 배칭으로 단일 렌더)
  const setFilter = (v) => { _setFilter(v); setCurrentPage(1); };
  const [purifyResult, setPurifyResult] = useState(null);
  const [prevMonthCompare, setPrevMonthCompare] = useState(null); // { warnings, changes, newCount, leftCount }
  const [showPrevCompare, setShowPrevCompare] = useState(false);
  const [colVis, setColVis] = useState({});
  const [baseCount, setBaseCount] = useState(0);
  const [baseMap, setBaseMap] = useState(null);
  const [importFields, setImportFields] = useState(null); // null = 전체 이식, Set = 선택 필드만
  const [dbImportReady, setDbImportReady] = useState(null); // { count, fields }
  const [showDbImport, setShowDbImport] = useState(false);
  const [dbNavCity, setDbNavCity] = useState(''); // DB Overview에서 지자체 선택 후 관리 화면 이동
  const [isBasePurifyMode, setIsBasePurifyMode] = useState(false);
  const [isSavingBaseList, setIsSavingBaseList] = useState(false);
  const isSavingBaseListRef = useRef(false);
  // ── 전역 로딩 게이지 ─────────────────────────────────────────────
  const [gLoad, setGLoad] = useState({ show: false });
  const gLoadTimerRef = useRef(null);
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

  const DEFAULT_EXPORT_COLS = [
    { key: 'NO',      label: 'NO',      on: true },
    { key: '구분',    label: '구분',    on: true },
    { key: '행정동',  label: '행정동',  on: true },
    { key: '이름',    label: '성명',    on: true },
    { key: '생년월일',label: '생년월일',on: true },
    { key: '포수',    label: '포수',    on: true },
    { key: '휴대폰',  label: '휴대폰',  on: true },
    { key: '유선전화',label: '유선전화',on: true },
    { key: '문자수신',label: '문자수신',on: true },
    { key: '주소',    label: '주소',    on: true },
    { key: '특이사항',label: '특이사항',on: true },
    { key: '기사',    label: '기사',    on: true },
    { key: '배송순번',label: '배송순번',on: true },
    { key: '사유',    label: '사유',    on: true },
  ];
  const [exportColOrder, setExportColOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('nexus_export_cols_v2');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return DEFAULT_EXPORT_COLS;
  });

  const [showExportSetting, setShowExportSetting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState('city_limit');
  const [showUtils, setShowUtils] = useState(false);
  const [showCloudBase, setShowCloudBase] = useState(false);
  const [showRouteMap, setShowRouteMap] = useState(false);
  const [showRouteSetup, setShowRouteSetup] = useState(false);
  const [showRouteQuick, setShowRouteQuick] = useState(false);
  const [cloudRouteConfig, setCloudRouteConfig] = useState(null);
  const [routeSetupResult, setRouteSetupResult] = useState(null);
  const [shareParams] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('r');
    return r ? { shareId: r, driverId: p.get('d') || null } : null;
  });
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showDriverRegistry, setShowDriverRegistry] = useState(false);
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
  
  const handleUndo = () => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setGridData(last);
      return prev.slice(0, -1);
    });
  };

  useEffect(() => {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.type = "image/png"; link.href = "ttongpa.png";
    document.title = `NEXUS PIPELINE ${APP_VERSION}`;

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
        
        const ADMIN_EMAILS = ['ttong627@gmail.com', 'admin@logis-op.com', 'jsh6270@gmail.com'];
        const isAdminEmail = ADMIN_EMAILS.includes(u.email);

        // 1. 최고 관리자 계정이 일반 유저로 꼬여있다면 복구 (Root Cause Fix)
        if (isAdminEmail && (userData.role !== 'admin' || userData.tier !== 'vvip')) {
          await setDoc(doc(db, "users", u.uid), { role: "admin", tier: "vvip" }, { merge: true });
          userData.role = 'admin';
          userData.tier = 'vvip';
        }

        // 2. 관리자가 아닌데 이전 찌꺼기 코드 탓에 관리자가 된 일반 유저 강등 (보안)
        if (!isAdminEmail && userData.role === 'admin') {
          await setDoc(doc(db, "users", u.uid), { role: "user", tier: "basic" }, { merge: true });
          userData.role = 'user';
          userData.tier = 'basic';
        }

        setUser({ ...u, ...userData });

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
        if (rulesDoc.exists()) setAiRules(rulesDoc.data());
        
        await loadTypoDict();
        
        setShowAuth(false);
        setAuthStatus('authenticated');
      } else {
        setUser(null);
        setShowAuth(true);
        setAuthStatus('unauthenticated');
        setAuthLoading(false);
      }
    });
    return () => { unsub(); if (inqUnsubRef.current) inqUnsubRef.current(); };
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
    
    try {
      const buffer = await file.arrayBuffer();
      const worker = new Worker(new URL("./excelWorker.js", import.meta.url), { type: "module" });
      
      gStart('파일 분석 중...', file.name);
      worker.postMessage({ action: "PARSE_TARGET", buffer, fileName: file.name, dynamicRules: aiRules });
      worker.onmessage = (evt) => {
        if (evt.data.ok && evt.data.action === "PARSE_TARGET") {
          gDone('파일 분석 완료!');
          const { sheetsData, detectedCity, monthStr } = evt.data;
          setFileInfo(prev => ({ ...prev, city: detectedCity, month: monthStr }));
          setWorksheets(sheetsData);
          
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
              note: getHeader('비고')
            };
          });
          setMapDefs(initialSel);
          
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
                  });
                } catch (e) {
                  console.error("AI Log upload failed:", e);
                }
              });
            }
          });

          setStep(2);
        } else if (!evt.data.ok) {
          setGLoad({ show: false });
        alert("파일 분석 중 오류가 발생했습니다: " + evt.data.error);
        }
        worker.terminate();
      };
    } catch {
      setGLoad({ show: false });
      alert("파일을 읽는 중 오류가 발생했습니다.");
    }
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
          setWorksheets(prev => [...prev, ...sheetsData]);
          
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
              admin: getHeader('행정동'),
              itemName: getHeader('품명'),
              note: getHeader('비고')
            };
          });
          setMapDefs(prev => ({ ...prev, ...initialSel }));
          
          sheetsData.forEach(sheet => {
            if (sheet.unmappedCols && sheet.unmappedCols.length > 0) {
              sheet.unmappedCols.forEach(async (col) => {
                try {
                  await addDoc(collection(db, "nexus_ai_logs"), {
                    columnName: String(col).slice(0, 100).replace(/[<>&"'`]/g, ''),
                    status: "pending", detectedAt: serverTimestamp(),
                    fileName: String(file.name).slice(0, 200), sheetName: String(sheet.name).slice(0, 100),
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
      });
    } catch (e) {
      console.error('user_mapping log failed:', e);
    }
  };

  const handleAnalyzeAll = async () => {
    if (!selectedSheets || selectedSheets.length === 0) return;
    const total = selectedSheets.reduce((acc, s) => acc + (s.bodyRows?.length || 0), 0);
    const monthlyLimit = getMonthlyLimit(user?.tier);
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
        const chunkResults = await asyncPool(20, chunk, async (row) => {
          let addr = getVal(row, 'address');
          let name = getVal(row, 'name');
          let adminDong = getVal(row, 'admin') || "";
          const processedRow = await processAddress(addr, name, adminDong, fileInfo?.city || "");
          count++;
          if (Date.now() - lastProgressTime > 200) {
            setEngineProgress({ current: count, total, percent: Math.round((count/total)*100) });
            lastProgressTime = Date.now();
          }
          // baseMap 이식: 이름+생년월일 키로 매칭
          const birthKey = parseBirthDate(getVal(row, 'birth'));
          const baseKey = `${name}_${birthKey}`;
          const baseEntry = baseMap ? (baseMap[baseKey] || null) : null;
          const { cleaned: c1, note: phoneNote1 } = extractPhoneNote(getVal(row, 'contact1'));
          const { cleaned: c2, note: phoneNote2 } = extractPhoneNote(getVal(row, 'contact2'));
          const phones = parsePhoneNumbers(c1, c2);
          const phoneNotes = [
            phoneNote1 && c1 ? `${phoneNote1}(${formatPhone(c1)})` : '',
            phoneNote2 && c2 ? `${phoneNote2}(${formatPhone(c2)})` : '',
          ].filter(Boolean).join(' ');

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
            이름: processedRow.정제된이름 || name,
            생년월일: birthKey,
            품명: getVal(row, 'itemName') || "",
            포수: getVal(row, 'qty') ? (parseInt(getVal(row, 'qty')) || 1) : "",
            휴대폰: phones.mobile,
            유선전화: phones.landline,
            주소: processedRow.주소,
            문자수신: parseSMS(getVal(row, 'sms')),
            특이사항: [
              processedRow.특이사항,
              phoneNotes,
              getVal(row, 'note'),
              baseEntry && (importFields === null || importFields?.includes('note')) && baseEntry.note
                ? `◆${baseEntry.note.replace(/^\[기본\]\s*/g, '')}` : '',
            ].filter(Boolean).join(' ').trim() || "",
            기사: getVal(row, 'driver') || "",
            배송순번: getVal(row, 'seqNo') || "",
            _에러: processedRow.확인필요,
            _사유: processedRow.확인사유,
            _lat: processedRow.lat || baseEntry?.lat || null,
            _lng: processedRow.lng || baseEntry?.lng || null,
            _isApt: processedRow.isApt !== undefined ? processedRow.isApt : (baseEntry?.isApt || false)
          };
        });
        results.push(...chunkResults);
      }
    }
    
    setEngineProgress({ current: total, total, percent: 100 });
    pushHistory(results);

    // 정제 결과 요약
    const errList = results.filter(r => r._에러);
    const apiFailCount = errList.filter(r => (r._사유 || '').includes('API') || (r._사유 || '').includes('응답')).length;
    const emptyAddrCount = errList.filter(r => (r._사유 || '').includes('공란') || (r._사유 || '').includes('비어')).length;
    const shortAddrCount = errList.filter(r => (r._사유 || '').includes('3자') || (r._사유 || '').includes('짧')).length;
    const otherErrCount = errList.length - apiFailCount - emptyAddrCount - shortAddrCount;
    setPurifyResult({
      totalCount: results.length,
      successCount: results.length - errList.length,
      errorCount: errList.length,
      apiFailCount,
      emptyAddrCount,
      shortAddrCount,
      otherErrCount,
      importedCount: results.filter(r => r._이식됨).length,
    });

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
              const addrChanged = prevAddr && curAddr && prevAddr !== curAddr && prevAddr.slice(0, 10) !== curAddr.slice(0, 10);
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

  const handleCellEdit = (id, field, value) => {
    // 타이핑마다 pushHistory 호출 시 stale closure + setHistory·setGridData 동시발동으로
    // 중복문자·화면잠김 발생 → 키 입력은 functional setGridData로만, 히스토리는 Enter(재정제)에서만 쌓음
    setGridData(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleAddressKeyDown = async (e, row) => {
    if (e.key === "Enter") {
      // adminDong·cityLabel 전달 → 주민센터 등 공공기관 검색 정확도 향상
      const res = await processAddress(row.주소, row.이름, row.행정동 || "", fileInfo?.city || "");
      const newData = gridData.map(r => r.id === row.id ? { ...r, 주소: res.주소 } : r);
      pushHistory(newData);
      if (res.주소 !== row.주소 && row.주소) {
        addTypoRecord(row.주소, res.주소);
      }
    }
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
        adminEmail: user?.email || "unknown"
      });
      alert("기본명단 및 감사 로그가 성공적으로 업데이트 되었습니다.");
    } catch (e) {
      console.error(e);
      alert("업데이트 실패: " + e.message);
    }
  };

  const handleSaveMonthlyList = async () => {
    const city = fileInfo?.city;
    if (!city) return alert('지자체 정보를 감지하지 못했습니다. 파일을 다시 확인해주세요.');
    const validData = gridData.filter(d => !d._에러);
    if (validData.length === 0) return alert('저장할 정상 명단이 없습니다.');

    const now = new Date();
    let initMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const rawMonth = fileInfo?.month || '';
    const mMatch = rawMonth.match(/(\d{1,2})월/);
    if (mMatch) initMonth = `${now.getFullYear()}-${String(mMatch[1]).padStart(2, '0')}`;

    const monthStr = window.prompt(
      `[${city}] 저장할 년월을 입력하세요 (예: ${initMonth})\n\n정상 데이터 ${validData.length}건이 저장됩니다.`,
      initMonth
    );
    if (!monthStr) return;
    if (!/^\d{4}-\d{2}$/.test(monthStr)) return alert('형식이 올바르지 않습니다. YYYY-MM 형식으로 입력해주세요.');

    try {
      // 기존 데이터 확인 → 중복 방지
      const existingSnap = await getDocs(collection(db, 'cloud_lists', city, 'months', monthStr, 'records'));
      if (existingSnap.docs.length > 0) {
        const ok = window.confirm(
          `[${city}] ${monthStr} 명단이 이미 ${existingSnap.docs.length}건 저장되어 있습니다.\n기존 데이터를 지우고 새로 저장하시겠습니까?`
        );
        if (!ok) return;
        for (let i = 0; i < existingSnap.docs.length; i += 500) {
          const batch = writeBatch(db);
          existingSnap.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }

      const 수급자Count = validData.filter(r => r.구분 === '기초수급자').length;
      const 차상위Count = validData.filter(r => r.구분 === '차상위').length;

      // 도시 상위 문서 — fetchAllCities 1회 읽기로 카드 통계 표시 가능하도록 통계 포함 저장
      await setDoc(doc(db, 'cloud_lists', city), {
        city, lastMonthId: monthStr, lastUpdatedAt: serverTimestamp(),
        latestTotalCount: validData.length, latest수급자Count: 수급자Count, latest차상위Count: 차상위Count,
      }, { merge: true });

      const metaRef = doc(db, 'cloud_lists', city, 'months', monthStr);
      await setDoc(metaRef, {
        city, monthId: monthStr,
        totalCount: validData.length, 수급자Count, 차상위Count,
        uploadedAt: serverTimestamp(), uploadedBy: user?.email || 'unknown',
        hasOriginal: false,
      });

      // 필드 정규화 후 500건씩 배치 저장
      gStart('클라우드 저장 중...', `${city} ${monthStr} · ${validData.length.toLocaleString()}건`, 0);
      for (let i = 0; i < validData.length; i += 500) {
        const batch = writeBatch(db);
        validData.slice(i, i + 500).forEach((r, j) => {
          const ref = doc(collection(db, 'cloud_lists', city, 'months', monthStr, 'records'));
          batch.set(ref, {
            구분: r.구분 || '',
            이름: r.이름 || '',
            생년월일: r.생년월일 || '',
            행정동: r.행정동 || '',
            주소: r.주소 || '',
            휴대폰: r.휴대폰 || '',
            유선전화: r.유선전화 || '',
            포수: parseInt(r.포수 || '1') || 1,
            특이사항: r.특이사항 || '',
            lat: r._lat || null,
            lng: r._lng || null,
            isApt: r._isApt || false,
            기사: r.기사 || '',
            배송순번: r.배송순번 || '',
            _idx: i + j,
          });
        });
        await batch.commit();
        gUpdate(Math.round(Math.min(i + 500, validData.length) / validData.length * 100));
      }

      await addDoc(collection(db, 'audit_logs'), {
        action: 'SAVE_MONTHLY_LIST', city, monthId: monthStr,
        count: validData.length, timestamp: serverTimestamp(),
        adminEmail: user?.email || 'unknown',
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
            const ref = doc(collection(db, 'delivery_history', city, 'months', monthStr, 'records'));
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

      gDone(`${city} ${monthStr} · ${validData.length.toLocaleString()}건 저장 완료`);
      alert(`✅ ${city} ${monthStr} 월별 명단 ${validData.length}건이 클라우드에 저장되었습니다.`);
    } catch (e) {
      setGLoad({ show: false });
      console.error(e);
      alert('저장 실패: ' + e.message);
    }
  };

  const handleBatchSaveBaseList = async (validData) => {
    if (isSavingBaseListRef.current) return;
    isSavingBaseListRef.current = true;
    setIsSavingBaseList(true);
    const city = fileInfo?.city || '기타';
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

        const payload = {
          name, birthKey,
          dong:    row.행정동 || '',
          address: row.주소   || '',
          mobile,  landline,
          note:    (row.특이사항 || '').replace(/\s*◆[^◆]*/g, '').trim() || '',
          sms:     row.문자수신 || '',
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
            const entry = { _isInFlight: true, data: payload };
            addEntries.push(entry);
            liveByBirth[`${name}__${birthKey}`] = entry;
            birthKeyedNames.add(name);
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

      // ③ 499개씩 배치 커밋
      const allOps = [
        ...updates.map(u => ({ type: 'update', id: u.id, data: u.data })),
        ...adds.map(a =>    ({ type: 'add',               data: a.data })),
      ];

      let successCount = 0;
      const errors = [];
      gStart('기본명단 저장 중...', `${city} · ${allOps.length.toLocaleString()}건`, 0);

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
        addCount: adds.length, updateCount: updates.length,
        successCount, errorCount: errors.length,
        timestamp: serverTimestamp(),
        adminEmail: user?.email || 'unknown',
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
    setFilter({ text: '', showErrorsOnly: false, showSuccessOnly: false, 구분: '', dong: '', driver: '', noDriver: false, hasNote: false });
    setCurrentPage(1);
    setSortConfig({ key: '', direction: 'asc' });
    pushHistory(mapped);
    setStep(5);
  };

  const handleBatchSetNote = (ids, note) => {
    const newData = gridData.map(r => ids.has(r.id) ? { ...r, 특이사항: note } : r);
    pushHistory(newData);
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
    const suCount  = filteredData.filter(r => r.구분 === '기초수급자').reduce((s,r) => s+(Number(r.포수)||0), 0);
    const chaCount = filteredData.filter(r => r.구분 === '차상위').reduce((s,r) => s+(Number(r.포수)||0), 0);
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

  const handleExport = () => {
    if (!filteredData.length) return alert('내보낼 데이터가 없습니다.');
    const activeCols = exportColOrder.filter(c => c.on);
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
    const activeCols = exportColOrder.filter(c => c.on);
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
    const activeCols = exportColOrder.filter(c => c.on);
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
    const activeCols = exportColOrder.filter(c => c.on);
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
  const onLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setShowAuth(true);
      setAuthStatus('unauthenticated');
      setAuthLoading(false);
      setStep(0);
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

  if (showAuth) return <AuthScreen authStatus={authStatus} authLoading={authLoading} handleGoogleLogin={handleGoogleLogin} />;

  return (
    <ErrorBoundary>
      <div className="w-full h-screen bg-[#050505] text-white flex flex-col font-sans overflow-hidden">

        {showIntro && <IntroScreen user={user} reason={introReason} meta={introMeta} onComplete={() => setShowIntro(false)} />}

        {/* HEADER RESTORED */}
        <header className="h-16 shrink-0 bg-[#0a0a0a] border-b border-[#222] flex items-center justify-between px-6 z-50">
          <button 
            onClick={() => setStep(0)} 
            className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer outline-none"
            title="초기 화면으로 이동"
          >
            <img src="/ttlogo1.png" alt="NEXUS PIPELINE Logo" className="h-10 object-contain" />
          </button>
          
          <div className="flex flex-1 items-center justify-center px-10">
            {step >= 1 && step <= 5 && (
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map(s => (
                  <div key={s} className="flex items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all ${step === s ? "bg-[#3b82f6] text-black shadow-[0_0_10px_rgba(59,130,246,0.5)]" : step > s ? "bg-[#1e3a8a] text-white" : "bg-[#222] text-gray-500"}`}>
                      {step > s ? <CheckCircle size={16} /> : s}
                    </div>
                    {s < 5 && <div className={`w-10 h-0.5 mx-1 ${step > s ? "bg-[#1e3a8a]" : "bg-[#222]"}`} />}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <button onClick={() => setStep(0)} className="px-4 py-2 bg-[#111] hover:bg-[#222] border border-[#333] text-gray-300 font-bold rounded-lg text-xs transition-all flex items-center gap-2">
              대시보드
            </button>
            <button onClick={handleUndo} disabled={history.length === 0} className="px-4 py-2 bg-[#222] hover:bg-[#333] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-2">
              <Undo2 size={16} /> 실행취소
            </button>

            {/* 메뉴 드롭다운 */}
            <div className="relative">
              <button
                onClick={() => setShowHeaderMenu(v => !v)}
                className="px-4 py-2 bg-[#111] hover:bg-[#1a1a1a] border border-[#333] hover:border-[#3b82f6]/50 text-gray-300 font-bold rounded-lg text-xs transition-all flex items-center gap-2"
              >
                <Menu size={16} /> 메뉴
              </button>
              {showHeaderMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowHeaderMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 w-52 bg-[#060c18] border border-[#3b82f6]/20 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-50 overflow-hidden">
                    <div className="p-1.5 space-y-0.5">
                      <button
                        onClick={() => {
                          if (!canUseDbOverview(user?.tier)) {
                            setUpgradeReason('dbOverview'); setShowUpgrade(true); setShowHeaderMenu(false);
                          } else {
                            setStep(9); setDbNavCity(''); setShowHeaderMenu(false);
                          }
                        }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-violet-300 hover:bg-violet-900/30 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <BarChart3 size={15} /> DB 현황 조회
                        {!canUseDbOverview(user?.tier) && <span className="ml-auto text-[9px] bg-purple-900/40 text-purple-400 border border-purple-700/40 px-1.5 py-0.5 rounded font-black">VVIP+</span>}
                      </button>
                      <button
                        onClick={() => {
                          if (!canUseDriverRegistry(user?.tier)) {
                            setUpgradeReason('city_limit'); setShowUpgrade(true); setShowHeaderMenu(false);
                          } else {
                            setShowDriverRegistry(true); setShowHeaderMenu(false);
                          }
                        }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-emerald-300 hover:bg-emerald-900/30 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <Truck size={15} /> 소속사 기사 관리
                        {!canUseDriverRegistry(user?.tier) && <span className="ml-auto text-[9px] bg-purple-900/40 text-purple-400 border border-purple-700/40 px-1.5 py-0.5 rounded font-black">VVIP+</span>}
                      </button>
                      <div className="my-0.5 border-t border-[#1a1a1a]" />
                      <button
                        onClick={() => { setStep(8); setDbNavCity(''); setShowHeaderMenu(false); }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-blue-300 hover:bg-blue-900/30 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <Database size={15} /> 이번달 배송명단
                      </button>
                      <button
                        onClick={() => {
                          if (!canUseRouteMap(user?.tier)) {
                            setUpgradeReason('routeMap'); setShowUpgrade(true); setShowHeaderMenu(false);
                          } else {
                            setShowRouteQuick(true); setShowHeaderMenu(false);
                          }
                        }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-[#3b82f6] hover:bg-[#3b82f6]/10 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <MapPin size={15} /> 기사 배정 / 루트맵
                        {!canUseRouteMap(user?.tier) && <span className="ml-auto text-[9px] bg-blue-900/40 text-blue-400 border border-blue-700/40 px-1.5 py-0.5 rounded font-black">VIP+</span>}
                      </button>
                      <button
                        onClick={() => { setStep(6); setDbNavCity(''); setShowHeaderMenu(false); }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-cyan-300 hover:bg-cyan-900/30 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <Database size={15} /> 기본명단 관리
                      </button>
                      <button
                        onClick={() => { setShowUtils(true); setShowHeaderMenu(false); }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-yellow-300 hover:bg-yellow-900/30 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <Layers size={15} /> 부가서비스
                      </button>
                      <button
                        onClick={() => { setUpgradeReason('city_limit'); setShowUpgrade(true); setShowHeaderMenu(false); }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-indigo-300 hover:bg-indigo-900/30 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <Crown size={15} /> 회원등급 관리
                      </button>
                      <button
                        onClick={() => { setProfileModal({ open: true, isNew: false }); setShowHeaderMenu(false); }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-gray-300 hover:bg-gray-800/60 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <UserCircle size={15} /> 내 프로필
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {canUseRouteMap(user?.tier) ? (
              <button
                onClick={() => { setShowRouteQuick(true); }}
                className="px-4 py-2 bg-[#050c18] border border-[#3b82f6]/40 text-[#3b82f6] font-bold rounded-lg text-xs transition-all flex items-center gap-2 hover:bg-[#0a1a30]"
              >
                <MapPin size={16} /> 기사배정/루트맵
              </button>
            ) : null}
            {gridData.some(r => r._에러) && (
              <button
                onClick={() => setStep(10)}
                className="px-4 py-2 bg-red-950/40 text-red-400 border border-red-500/40 hover:bg-red-900/50 font-bold rounded-lg text-xs transition-all flex items-center gap-2"
              >
                <span className="inline-flex items-center justify-center w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full">
                  {gridData.filter(r => r._에러).length}
                </span>
                오류 명단
              </button>
            )}
            {user?.role === "admin" && (
              <button onClick={() => setStep(7)} className="relative px-4 py-2 bg-purple-900/40 text-purple-300 border border-purple-500/50 hover:bg-purple-900/60 font-bold rounded-lg text-xs transition-all flex items-center gap-2">
                <ShieldCheck size={16} /> 관리자 패널
                {pendingInquiriesCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-pulse">
                    {pendingInquiriesCount}
                  </span>
                )}
              </button>
            )}
            <button onClick={onLogout} className="px-4 py-2 bg-red-950/40 text-red-400 border border-red-500/50 hover:bg-red-900/60 font-bold rounded-lg text-xs transition-all flex items-center gap-2">
              <LogOut size={16} /> 로그아웃
            </button>
          </div>
        </header>

        {/* ── 단계 2~5 공통 요약바 ─────────────────────────────────────── */}
        {step >= 2 && step <= 5 && fileInfo && (
          <div className="shrink-0 bg-black/70 border-b border-[#1e1e1e] px-5 py-2 flex items-center gap-2.5 text-xs flex-wrap">
            <span className="text-white font-black tracking-wide">{fileInfo.city || '지자체 미상'}</span>
            <span className="text-gray-700">|</span>
            <span className="text-gray-300 font-bold">{fileInfo.month || '-'}</span>
            <span className="text-gray-700">|</span>
            {step === 5 ? (
              <>
                <span className="text-blue-300 font-black">
                  수급자 {gridData.filter(d => d.구분 === '기초수급자').reduce((s, d) => s + (parseInt(d.포수) || 0), 0).toLocaleString()}포
                </span>
                <span className="text-gray-700">|</span>
                <span className="text-amber-300 font-black">
                  차상위 {gridData.filter(d => d.구분 === '차상위').reduce((s, d) => s + (parseInt(d.포수) || 0), 0).toLocaleString()}포
                </span>
                <span className="text-gray-700">|</span>
                <span className="text-[#3b82f6] font-black">
                  전체 {gridData.reduce((s, d) => s + (parseInt(d.포수) || 0), 0).toLocaleString()}포
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
                      <span className="text-blue-300 font-black">수급자 {su.toLocaleString()}포</span>
                      <span className="text-gray-700">|</span>
                      <span className="text-amber-300 font-black">차상위 {cha.toLocaleString()}포</span>
                      <span className="text-gray-700">|</span>
                      <span className="text-[#3b82f6] font-black">전체 {total.toLocaleString()}포</span>
                      <span className="ml-1 text-[10px] text-gray-600 italic">(예상)</span>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* ── 단계 진행 표시기 (step 1~5) ─────────────────────────────── */}
        {step >= 1 && step <= 5 && (
          <div className="shrink-0 bg-[#040404] border-b border-[#151515] px-6 py-2.5 flex items-center justify-center gap-0">
            {[
              { n: 1, label: '업로드' },
              { n: 2, label: '시트분류' },
              { n: 3, label: '컬럼매핑' },
              { n: 4, label: '주소정제' },
              { n: 5, label: '결과확인' },
            ].map(({ n, label }, i) => {
              const done = step > n;
              const active = step === n;
              return (
                <div key={n} className="flex items-center">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black transition-all ${
                      done    ? 'bg-[#3b82f6] text-black' :
                      active  ? 'bg-[#3b82f6]/20 border border-[#3b82f6] text-[#3b82f6]' :
                               'bg-[#111] border border-[#333] text-gray-600'
                    }`}>
                      {done ? '✓' : n}
                    </div>
                    <span className={`text-xs font-bold transition-all ${
                      done   ? 'text-[#3b82f6]/60' :
                      active ? 'text-[#3b82f6]' :
                               'text-gray-600'
                    }`}>{label}</span>
                  </div>
                  {i < 4 && (
                    <div className={`w-8 h-px mx-2 transition-all ${step > n ? 'bg-[#3b82f6]/40' : 'bg-[#222]'}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <main className="flex-1 relative overflow-hidden bg-[#050505] flex flex-col">
          {step === 0 && <Dashboard user={user} onLogout={onLogout} onStart={(s) => setStep(typeof s === 'number' ? s : 1)} onHelp={onHelp} setFileInfo={setFileInfo} setWorksheets={setWorksheets} setBaseCount={setBaseCount} gridData={gridData} setGridData={setGridData} onCloudCard={(city) => { setDbNavCity(city); setStep(8); }} onBaseCard={(city) => { setDbNavCity(city); setStep(6); }} />}
          {step === 1 && <Step1_Upload handleDragOver={handleDragOver} handleDrop={handleDrop} handleFileUpload={handleFileUpload} handleUnifiedDrop={handleUnifiedDrop} isBaseUploading={isBaseUploading} step={step} onHelp={onHelp} onCloudFetch={() => setShowCloudBase(true)} />}
          {step === 2 && <Step2_SheetSelect step={step} setStep={setStep} fileInfo={fileInfo} setFileInfo={setFileInfo} worksheets={worksheets} setWorksheets={setWorksheets} setSelectedSheets={setSelectedSheets} onHelp={onHelp} handleSecondFileUpload={handleSecondFileUpload} />}
          {step === 3 && <Step3_Mapping step={step} setStep={setStep} selectedSheets={selectedSheets} worksheets={worksheets} mapDefs={mapDefs} setMapDefs={setMapDefs} startProcessing={handleAnalyzeAll} onHelp={onHelp} isBasePurifyMode={isBasePurifyMode} setIsBasePurifyMode={setIsBasePurifyMode} onOpenDbImport={() => setShowDbImport(true)} dbImportReady={dbImportReady} onUserMapping={handleUserMapping} />}
          {step === 4 && <LoadingScreen progress={engineProgress} logs={progressLogs} />}
          {step === 5 && <ResultGrid step={step} setStep={setStep} fileInfo={fileInfo} filter={filter} setFilter={setFilter} dongList={gridDongList} driverList={gridDriverList} gridData={gridData} filteredData={filteredData} paginatedData={paginatedData} currentPage={currentPage} setCurrentPage={setCurrentPage} itemsPerPage={itemsPerPage} colVis={colVis} sortConfig={sortConfig} setSortConfig={setSortConfig} handleCellEdit={handleCellEdit} handleAddressKeyDown={handleAddressKeyDown} handleUpdateBaseList={handleUpdateBaseList} handleBatchSaveBaseList={handleBatchSaveBaseList} isSavingBaseList={isSavingBaseList} handleSaveMonthlyList={handleSaveMonthlyList} setShowExportSetting={setShowExportSetting} handleExport={handleExport} handleExportErrors={handleExportErrors} handleExportDongSummary={handleExportDongSummary} handleExportByDriver={handleExportByDriver} handleDeleteRows={handleDeleteRows} handleBatchSetNote={handleBatchSetNote} onHelp={onHelp} purifyResult={purifyResult} onClosePurifyResult={() => setPurifyResult(null)} onMovePhones={handleMovePhones} onOpenRouteMap={() => { if (!canUseRouteMap(user?.tier)) { setUpgradeReason('routeMap'); setShowUpgrade(true); } else { setCloudRouteConfig(null); setShowRouteSetup(true); } }} />}
          {step === 10 && <ErrorListManager gridData={gridData} onBack={() => setStep(gridData.length ? 5 : 0)} handleCellEdit={handleCellEdit} handleAddressKeyDown={handleAddressKeyDown} handleExportErrors={handleExportErrors} />}
          {step === 6 && <BaseListManager user={user} initialCity={dbNavCity} onBack={() => { setStep(0); setDbNavCity(''); }} />}
          {step === 7 && <AdminPanel user={user} onClose={() => setStep(0)} />}
          {step === 8 && <CloudListManager user={user} initialCity={dbNavCity} onBack={() => { setStep(0); setDbNavCity(''); }} onOpenRouteMap={(city, monthId, orgDongs) => { if (!canUseRouteMap(user?.tier)) { setUpgradeReason('routeMap'); setShowUpgrade(true); } else { setCloudRouteConfig({ city, monthId, orgDongs }); setShowRouteSetup(true); } }} onOpenInResultGrid={handleOpenInResultGrid} />}
          {step === 9 && (
            <DbOverview
              onBack={() => setStep(0)}
              onGoToBase={(city) => { setDbNavCity(city); setStep(6); }}
              onGoToCloud={(city) => { setDbNavCity(city); setStep(8); }}
            />
          )}
        </main>
        
        {/* RESTORED MODAL RENDERS */}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        {showUtils && <UtilsModal user={user} onClose={() => setShowUtils(false)} />}
        {showUpgrade && <UpgradeModal user={user} userTier={user?.tier || 'basic'} usedCount={baseCount} userMaxCities={user?.maxCities || 1} reason={upgradeReason} onClose={() => setShowUpgrade(false)} />}
        {showCloudBase && <CloudBaseModal user={user} onClose={() => setShowCloudBase(false)} onImport={(newBaseMap, city, count) => { setBaseMap(newBaseMap); setBaseCount(count); setImportFields(null); setDbImportReady(null); setShowCloudBase(false); }} />}
        {showDbImport && <DbImportModal defaultCity={fileInfo?.city || ''} onClose={() => setShowDbImport(false)} onImport={(newBaseMap, fields, _city, count) => { setBaseMap(newBaseMap); setImportFields(fields); setDbImportReady({ count, fields }); setShowDbImport(false); }} />}
        {showRouteQuick && (
          <RouteQuickModal
            user={user}
            onClose={() => setShowRouteQuick(false)}
            onConfirm={(city, monthId) => {
              setCloudRouteConfig({ city, monthId, orgDongs: null });
              setShowRouteQuick(false);
              setShowRouteSetup(true);
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
            orgDongs={cloudRouteConfig?.orgDongs || null}
            user={user}
            onStart={({ selectedDongs, drivers, dongDriverMap, baseDailyQty }) => {
              setRouteSetupResult({ selectedDongs, drivers, dongDriverMap, baseDailyQty });
              setShowRouteSetup(false);
              setShowRouteMap(true);
            }}
            onClose={() => { setShowRouteSetup(false); setCloudRouteConfig(null); setRouteSetupResult(null); }}
          />
        )}
        {showRouteMap && (
          <RouteMapModal
            gridData={cloudRouteConfig ? [] : gridData.filter(r => !routeSetupResult?.selectedDongs || routeSetupResult.selectedDongs.has(r.행정동))}
            fileInfo={fileInfo}
            onClose={() => { setShowRouteMap(false); setCloudRouteConfig(null); setRouteSetupResult(null); }}
            onSave={(updated) => pushHistory(updated)}
            initialCloudCity={cloudRouteConfig?.city || null}
            initialCloudMonthId={cloudRouteConfig?.monthId || null}
            orgDongs={cloudRouteConfig?.orgDongs || null}
            initialDrivers={routeSetupResult?.drivers || null}
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
        {profileModal.open && <ProfileSetupModal user={user} isNewUser={profileModal.isNew} onClose={(saved, savedRegion) => { const wasNew = profileModal.isNew; setProfileModal({ open: false, isNew: false }); if (saved) { setIntroReason(wasNew ? 'new' : 'region'); setIntroMeta({ region: savedRegion }); setShowIntro(true); } }} />}
        {showPrevCompare && prevMonthCompare && (
          <PrevMonthCompareModal
            data={prevMonthCompare}
            onClose={() => setShowPrevCompare(false)}
          />
        )}
        <GlobalLoadingBar state={gLoad} />
      </div>
    </ErrorBoundary>
  );
}
