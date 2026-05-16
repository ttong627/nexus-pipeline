import React, { useState, useEffect, useMemo, useRef } from "react";
import { auth, onAuthStateChanged, setDoc, getDoc, updateDoc, increment, doc, db, serverTimestamp, addDoc, collection, getDocs, getDocsFromServer, writeBatch, query, where, onSnapshot, GoogleAuthProvider, signInWithPopup } from "./config/firebase.js";

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
import BaseListManager from "./components/BaseListManager.jsx";
import CloudListManager from "./components/CloudListManager.jsx";
import DbOverview from "./components/DbOverview.jsx";
import IntroScreen from "./components/IntroScreen.jsx";

import { processAddress, asyncPool, addTypoRecord, loadTypoDict } from "./engine/addressEngine.js";
import { parsePhoneNumbers, parseSMS, parseBirthDate, normalizeBirth, extractPhoneNote, formatPhone } from "./utils/parsers.js";
import { LogOut, ShieldCheck, CheckCircle, Database, Crown, Layers, UserCircle, Undo2, Menu, BarChart3, MapPin } from "lucide-react";
import RouteMapModal from "./components/RouteMapModal.jsx";
import RouteSetupModal from "./components/RouteSetupModal.jsx";
import ShareRouteView from "./components/ShareRouteView.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(true);
  const [authStatus, setAuthStatus] = useState('checking');
  const [authLoading, setAuthLoading] = useState(false);
  const [step, setStep] = useState(0); 
  const [activeTab, setActiveTab] = useState("audit");
  
  const [fileInfo, setFileInfo] = useState(null);
  const [worksheets, setWorksheets] = useState([]);
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [aiRules, setAiRules] = useState(null);
  const [mapDefs, setMapDefs] = useState({});
  const [gridData, setGridData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [paginatedData, setPaginatedData] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: '', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(500);

  const [isBaseUploading, setIsBaseUploading] = useState(false);
  const [engineProgress, setEngineProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [progressLogs, setProgressLogs] = useState([]);
  const [filter, setFilter] = useState({ text: "", showErrorsOnly: false });
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
  const [showIntro, setShowIntro] = useState(false);
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
  const [showUtils, setShowUtils] = useState(false);
  const [showCloudBase, setShowCloudBase] = useState(false);
  const [showRouteMap, setShowRouteMap] = useState(false);
  const [showRouteSetup, setShowRouteSetup] = useState(false);
  const [cloudRouteConfig, setCloudRouteConfig] = useState(null);
  const [routeSetupResult, setRouteSetupResult] = useState(null);
  const [shareParams] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('r');
    return r ? { shareId: r, driverId: p.get('d') || null } : null;
  });
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
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
    document.title = "NEXUS PIPELINE V4.0";

    const unsub = onAuthStateChanged(auth, async u => { 
      if (u) {
        const d = await getDoc(doc(db, "users", u.uid));
        let userData = d.exists() ? d.data() : {};
        
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
      }
    });
    return () => { unsub(); if (inqUnsubRef.current) inqUnsubRef.current(); };
  }, []);

  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const res = await signInWithPopup(auth, provider);
      const userRef = doc(db, "users", res.user.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          email: res.user.email,
          name: res.user.displayName,
          lastLogin: serverTimestamp(),
          role: "user",
          tier: "basic"
        });
      } else {
        await updateDoc(userRef, { lastLogin: serverTimestamp() });
      }
    } catch (error) {
      console.error("Login Error:", error);
      alert("로그인 중 오류가 발생했습니다: " + error.message);
    } finally {
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

  useEffect(() => {
    let res = sortedData;
    if (filter.showErrorsOnly) res = res.filter(r => r._에러);
    if (filter.showSuccessOnly) res = res.filter(r => !r._에러);
    if (filter.text) {
      const txt = filter.text.toLowerCase();
      res = res.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(txt)));
    }
    setFilteredData(res);
    setCurrentPage(1);
  }, [sortedData, filter]);

  useEffect(() => {
    const start = (currentPage - 1) * itemsPerPage;
    setPaginatedData(filteredData.slice(start, start + itemsPerPage));
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
      
      worker.postMessage({ action: "PARSE_TARGET", buffer, fileName: file.name, dynamicRules: aiRules });
      worker.onmessage = (evt) => {
        if (evt.data.ok && evt.data.action === "PARSE_TARGET") {
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
          alert("파일 분석 중 오류가 발생했습니다: " + evt.data.error);
        }
        worker.terminate();
      };
    } catch (err) {
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
    } catch (err) {
      alert("추가 파일을 읽는 중 오류가 발생했습니다.");
    }
  };

  const handleUnifiedDrop = (e) => { handleDrop(e); };
  const handleProcessStart = () => { setStep(3); };
  const handleMapChange = (sheetKey, type, value) => {
    setMapDefs(p => ({ ...p, [sheetKey]: { ...p[sheetKey], [type]: value } }));
  };

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
    setStep(4);
    setProgressLogs([]);
    const total = selectedSheets.reduce((acc, s) => acc + (s.bodyRows?.length || 0), 0);
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
            기사: getVal(row, 'driver') || (baseEntry && (importFields === null || importFields?.includes('driver')) ? baseEntry.driver : '') || "",
            배송순번: getVal(row, 'seqNo') || (baseEntry && (importFields === null || importFields?.includes('seqNo')) ? baseEntry.seqNo : '') || "",
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
    setStep(5);
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

      // 도시 상위 문서 생성 (없으면) — getDocs(collection('cloud_lists'))가 인식하려면 명시적 문서 필요
      await setDoc(doc(db, 'cloud_lists', city), {
        city, lastMonthId: monthStr, lastUpdatedAt: serverTimestamp(),
      }, { merge: true });

      const metaRef = doc(db, 'cloud_lists', city, 'months', monthStr);
      await setDoc(metaRef, {
        city, monthId: monthStr,
        totalCount: validData.length, 수급자Count, 차상위Count,
        uploadedAt: serverTimestamp(), uploadedBy: user?.email || 'unknown',
        hasOriginal: false,
      });

      // 필드 정규화 후 500건씩 배치 저장
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
      }

      await addDoc(collection(db, 'audit_logs'), {
        action: 'SAVE_MONTHLY_LIST', city, monthId: monthStr,
        count: validData.length, timestamp: serverTimestamp(),
        adminEmail: user?.email || 'unknown',
      });

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

      alert(`✅ ${city} ${monthStr} 월별 명단 ${validData.length}건이 클라우드에 저장되었습니다.`);
    } catch (e) {
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
      // ① 기존 DB 레코드 전체 로드 — 캐시 우회하여 서버 최신 데이터 직접 조회
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
          dong:    row.행정동   || '',
          address: row.주소     || '',
          mobile,  landline,
          note:    (row.특이사항 || '').replace(/\s*◆[^◆]*/g, '').trim() || '',
          driver:  row.기사     || '',
          seqNo:   parseInt(row.배송순번 || '0') || 0,
          sms:     row.문자수신 || '',
          ...(row._lat  ? { lat: row._lat, lng: row._lng } : {}),
          ...(row._isApt !== undefined ? { isApt: row._isApt } : {}),
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
        alert(`⚠️ 일부 오류 발생!\n신규: ${adds.length}건, 업데이트: ${updates.length}건\n성공: ${successCount}건, 실패 배치: ${errors.length}개\n\n${errors.join('\n')}`);
      } else {
        alert(`✅ 기본명단 저장 완료!\n신규 추가: ${adds.length}건\n기존 업데이트: ${updates.length}건\n\n[진단] 기존 DB: ${existing.length}건 / 생년월일 인덱스: ${Object.keys(liveByBirth).length}건 / 전화번호 인덱스: ${Object.keys(liveByPhone).length}건`);
      }
    } catch (e) {
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

  const handleBatchSetNote = (ids, note) => {
    const newData = gridData.map(r => ids.has(r.id) ? { ...r, 특이사항: note } : r);
    pushHistory(newData);
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
  const onHelp = () => setShowHelp(true);
  const onLogout = () => auth.signOut();

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

        {showIntro && <IntroScreen user={user} onComplete={() => setShowIntro(false)} />}

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
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all ${step === s ? "bg-[#22c55e] text-black shadow-[0_0_10px_rgba(34,197,94,0.5)]" : step > s ? "bg-[#166534] text-white" : "bg-[#222] text-gray-500"}`}>
                      {step > s ? <CheckCircle size={16} /> : s}
                    </div>
                    {s < 5 && <div className={`w-10 h-0.5 mx-1 ${step > s ? "bg-[#166534]" : "bg-[#222]"}`} />}
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
                className="px-4 py-2 bg-[#111] hover:bg-[#1a1a1a] border border-[#333] hover:border-[#22c55e]/50 text-gray-300 font-bold rounded-lg text-xs transition-all flex items-center gap-2"
              >
                <Menu size={16} /> 메뉴
              </button>
              {showHeaderMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowHeaderMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 w-52 bg-[#0d1a0f] border border-[#22c55e]/20 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-50 overflow-hidden">
                    <div className="p-1.5 space-y-0.5">
                      <button
                        onClick={() => { setStep(9); setDbNavCity(''); setShowHeaderMenu(false); }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-violet-300 hover:bg-violet-900/30 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <BarChart3 size={15} /> DB 현황 조회
                      </button>
                      <div className="my-0.5 border-t border-[#1a1a1a]" />
                      <button
                        onClick={() => { setStep(8); setDbNavCity(''); setShowHeaderMenu(false); }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-blue-300 hover:bg-blue-900/30 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <Database size={15} /> 이번달 배송명단
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
                        onClick={() => { setShowUpgrade(true); setShowHeaderMenu(false); }}
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
                <span className="text-[#22c55e] font-black">
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
                      <span className="text-[#22c55e] font-black">전체 {total.toLocaleString()}포</span>
                      <span className="ml-1 text-[10px] text-gray-600 italic">(예상)</span>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        )}

        <main className="flex-1 relative overflow-hidden bg-[#050505] flex flex-col">
          {step === 0 && <Dashboard user={user} onLogout={onLogout} onStart={(s) => setStep(typeof s === 'number' ? s : 1)} onHelp={onHelp} setFileInfo={setFileInfo} setWorksheets={setWorksheets} setBaseCount={setBaseCount} gridData={gridData} setGridData={setGridData} />}
          {step === 1 && <Step1_Upload handleDragOver={handleDragOver} handleDrop={handleDrop} handleFileUpload={handleFileUpload} handleUnifiedDrop={handleUnifiedDrop} isBaseUploading={isBaseUploading} step={step} onHelp={onHelp} onCloudFetch={() => setShowCloudBase(true)} />}
          {step === 2 && <Step2_SheetSelect step={step} setStep={setStep} fileInfo={fileInfo} setFileInfo={setFileInfo} worksheets={worksheets} setWorksheets={setWorksheets} setSelectedSheets={setSelectedSheets} onHelp={onHelp} handleSecondFileUpload={handleSecondFileUpload} />}
          {step === 3 && <Step3_Mapping step={step} setStep={setStep} selectedSheets={selectedSheets} worksheets={worksheets} mapDefs={mapDefs} setMapDefs={setMapDefs} startProcessing={handleAnalyzeAll} onHelp={onHelp} isBasePurifyMode={isBasePurifyMode} setIsBasePurifyMode={setIsBasePurifyMode} onOpenDbImport={() => setShowDbImport(true)} dbImportReady={dbImportReady} onUserMapping={handleUserMapping} />}
          {step === 4 && <LoadingScreen progress={engineProgress} logs={progressLogs} />}
          {step === 5 && <ResultGrid step={step} setStep={setStep} fileInfo={fileInfo} filter={filter} setFilter={setFilter} gridData={gridData} filteredData={filteredData} paginatedData={paginatedData} currentPage={currentPage} setCurrentPage={setCurrentPage} itemsPerPage={itemsPerPage} colVis={colVis} sortConfig={sortConfig} setSortConfig={setSortConfig} handleCellEdit={handleCellEdit} handleAddressKeyDown={handleAddressKeyDown} handleUpdateBaseList={handleUpdateBaseList} handleBatchSaveBaseList={handleBatchSaveBaseList} isSavingBaseList={isSavingBaseList} handleSaveMonthlyList={handleSaveMonthlyList} setShowExportSetting={setShowExportSetting} handleExport={handleExport} handleExportErrors={handleExportErrors} handleExportDongSummary={handleExportDongSummary} handleDeleteRows={handleDeleteRows} handleBatchSetNote={handleBatchSetNote} onHelp={onHelp} onOpenRouteMap={() => { setCloudRouteConfig(null); setShowRouteSetup(true); }} />}
          {step === 6 && <BaseListManager user={user} initialCity={dbNavCity} onBack={() => { setStep(0); setDbNavCity(''); }} />}
          {step === 7 && <AdminPanel user={user} onClose={() => setStep(0)} />}
          {step === 8 && <CloudListManager user={user} initialCity={dbNavCity} onBack={() => { setStep(0); setDbNavCity(''); }} onOpenRouteMap={(city, monthId, orgDongs) => { setCloudRouteConfig({ city, monthId, orgDongs }); setShowRouteSetup(true); }} />}
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
        {showUtils && <UtilsModal onClose={() => setShowUtils(false)} />}
        {showUpgrade && <UpgradeModal user={user} userTier={user?.tier || 'basic'} usedCount={baseCount} userMaxCities={user?.maxCities || 1} onClose={() => setShowUpgrade(false)} />}
        {showCloudBase && <CloudBaseModal user={user} onClose={() => setShowCloudBase(false)} onImport={(newBaseMap, city, count) => { setBaseMap(newBaseMap); setBaseCount(count); setImportFields(null); setDbImportReady(null); setShowCloudBase(false); }} />}
        {showDbImport && <DbImportModal defaultCity={fileInfo?.city || ''} onClose={() => setShowDbImport(false)} onImport={(newBaseMap, fields, _city, count) => { setBaseMap(newBaseMap); setImportFields(fields); setDbImportReady({ count, fields }); setShowDbImport(false); }} />}
        {showRouteSetup && (
          <RouteSetupModal
            mode={cloudRouteConfig ? 'cloud' : 'local'}
            allRecords={gridData}
            city={fileInfo?.city || ''}
            cloudCity={cloudRouteConfig?.city}
            cloudMonthId={cloudRouteConfig?.monthId}
            orgDongs={cloudRouteConfig?.orgDongs || null}
            onStart={({ selectedDongs, drivers, dongDriverMap }) => {
              setRouteSetupResult({ selectedDongs, drivers, dongDriverMap });
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
          />
        )}
        {profileModal.open && <ProfileSetupModal user={user} isNewUser={profileModal.isNew} onClose={() => { const wasNew = profileModal.isNew; setProfileModal({ open: false, isNew: false }); if (wasNew) setShowIntro(true); }} />}
      </div>
    </ErrorBoundary>
  );
}
