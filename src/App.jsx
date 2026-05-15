import React, { useState, useEffect, useMemo, useRef } from "react";
import { auth, onAuthStateChanged, setDoc, getDoc, updateDoc, increment, doc, db, serverTimestamp, addDoc, collection, getDocs, writeBatch, query, where, onSnapshot, GoogleAuthProvider, signInWithPopup } from "./config/firebase.js";

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
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import BaseListManager from "./components/BaseListManager.jsx";

import { processAddress, asyncPool, addTypoRecord, loadTypoDict } from "./engine/addressEngine.js";
import { parsePhoneNumbers, parseSMS, parseBirthDate } from "./utils/parsers.js";
import { LogOut, ShieldCheck, CheckCircle, Database, Crown, Layers, UserCircle, Undo2, Menu } from "lucide-react";

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
  const [isBasePurifyMode, setIsBasePurifyMode] = useState(false);
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
        let cmp = String(a.구분 || "").localeCompare(String(b.구분 || ""), undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        cmp = String(a.행정동 || "").localeCompare(String(b.행정동 || ""), undefined, { numeric: true, sensitivity: 'base' });
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
                    columnName: col,
                    status: "pending",
                    detectedAt: serverTimestamp(),
                    fileName: file.name,
                    sheetName: sheet.name
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
                    columnName: col, status: "pending", detectedAt: serverTimestamp(),
                    fileName: file.name, sheetName: sheet.name
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

  const handleAnalyzeAll = async () => {
    setStep(4);
    setProgressLogs([]);
    const total = selectedSheets.reduce((acc, s) => acc + s.bodyRows.length, 0);
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
          const processedRow = await processAddress(addr, name);
          count++;
          if (Date.now() - lastProgressTime > 200) {
            setEngineProgress({ current: count, total, percent: Math.round((count/total)*100) });
            lastProgressTime = Date.now();
          }
          // baseMap 이식: 이름+생년월일 키로 매칭
          const birthKey = parseBirthDate(getVal(row, 'birth'));
          const baseKey = `${name}_${birthKey}`;
          const baseEntry = baseMap ? (baseMap[baseKey] || null) : null;

          return {
            id: window.crypto.randomUUID(),
            구분: sheet.type,
            행정동: getVal(row, 'admin') || "",
            이름: processedRow.정제된이름 || name,
            생년월일: birthKey,
            품명: getVal(row, 'itemName') || "",
            포수: getVal(row, 'qty') ? (parseInt(getVal(row, 'qty')) || 1) : "",
            휴대폰: parsePhoneNumbers(getVal(row, 'contact1'), getVal(row, 'contact2')).mobile,
            유선전화: parsePhoneNumbers(getVal(row, 'contact1'), getVal(row, 'contact2')).landline,
            주소: processedRow.주소,
            문자수신: parseSMS(getVal(row, 'sms')),
            특이사항: getVal(row, 'note') || baseEntry?.note || "",
            기사: getVal(row, 'driver') || baseEntry?.driver || "",
            배송순번: getVal(row, 'seqNo') || baseEntry?.seqNo || "",
            _에러: processedRow.확인필요,
            _사유: processedRow.확인사유
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
    const newData = gridData.map(r => r.id === id ? { ...r, [field]: value } : r);
    pushHistory(newData);
  };

  const handleAddressKeyDown = async (e, row) => {
    if (e.key === "Enter") {
      const res = await processAddress(row.주소, row.이름);
      handleCellEdit(row.id, "주소", res.주소);
      if (res.주소 !== row.주소 && row.주소) {
        addTypoRecord(row.주소, res.주소);
      }
    }
  };

  const handleUpdateBaseList = async (row, updates) => {
    if (!row) return;
    try {
      const ref = doc(db, "base_lists", row.id || row.이름);
      await setDoc(ref, { ...row, ...updates }, { merge: true });
      
      await addDoc(collection(db, "audit_logs"), {
        action: "UPDATE_BASELIST",
        targetName: row.이름,
        updates: updates,
        timestamp: serverTimestamp(),
        adminEmail: user?.email || "unknown"
      });
      alert("기본명단 및 감사 로그가 성공적으로 업데이트 되었습니다.");
    } catch (e) {
      console.error(e);
      alert("업데이트 실패: " + e.message);
    }
  };

  const handleBatchSaveBaseList = async (validData) => {
    try {
      let count = 0;
      for (let i = 0; i < validData.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = validData.slice(i, i + 500);
        chunk.forEach(row => {
          // 이름과 휴대폰을 조합하여 고유 ID로 사용 (누적 시 중복 방지)
          const docId = row.이름 + "_" + (row.휴대폰 || row.id);
          const ref = doc(db, "base_lists", docId);
          batch.set(ref, row, { merge: true });
        });
        await batch.commit();
        count += chunk.length;
      }
      
      await addDoc(collection(db, "audit_logs"), {
        action: "BATCH_SAVE_BASELIST",
        count: count,
        timestamp: serverTimestamp(),
        adminEmail: user?.email || "unknown"
      });
      alert(`총 ${count}건의 정상 명단이 기본 명단에 성공적으로 누적 저장되었습니다.`);
    } catch (e) {
      console.error(e);
      alert("일괄 저장 실패: " + e.message);
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
    const cleanMonth = (fileInfo?.month || '').replace(/월/g,'').trim();
    const monthStr = cleanMonth ? `${cleanMonth}월` : '미상';
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

  if (showAuth) return <AuthScreen authStatus={authStatus} authLoading={authLoading} handleGoogleLogin={handleGoogleLogin} />;

  return (
    <ErrorBoundary>
      <div className="w-full h-screen bg-[#050505] text-white flex flex-col font-sans overflow-hidden">
        
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
                        onClick={() => { setShowCloudBase(true); setShowHeaderMenu(false); }}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-blue-300 hover:bg-blue-900/30 rounded-lg text-xs font-bold transition-colors text-left"
                      >
                        <Database size={15} /> 클라우드 명단
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

        <main className="flex-1 relative overflow-hidden bg-[#050505]">
          {step === 0 && <Dashboard user={user} onLogout={onLogout} onStart={(s) => setStep(typeof s === 'number' ? s : 1)} onHelp={onHelp} setFileInfo={setFileInfo} setWorksheets={setWorksheets} setBaseCount={setBaseCount} gridData={gridData} setGridData={setGridData} />}
          {step === 1 && <Step1_Upload handleDragOver={handleDragOver} handleDrop={handleDrop} handleFileUpload={handleFileUpload} handleUnifiedDrop={handleUnifiedDrop} isBaseUploading={isBaseUploading} step={step} onHelp={onHelp} onCloudFetch={() => setShowCloudBase(true)} />}
          {step === 2 && <Step2_SheetSelect step={step} setStep={setStep} fileInfo={fileInfo} worksheets={worksheets} setWorksheets={setWorksheets} setSelectedSheets={setSelectedSheets} onHelp={onHelp} handleSecondFileUpload={handleSecondFileUpload} />}
          {step === 3 && <Step3_Mapping step={step} setStep={setStep} selectedSheets={selectedSheets} worksheets={worksheets} mapDefs={mapDefs} setMapDefs={setMapDefs} startProcessing={handleAnalyzeAll} onHelp={onHelp} isBasePurifyMode={isBasePurifyMode} setIsBasePurifyMode={setIsBasePurifyMode} />}
          {step === 4 && <LoadingScreen progress={engineProgress} logs={progressLogs} />}
          {step === 5 && <ResultGrid step={step} setStep={setStep} filter={filter} setFilter={setFilter} gridData={gridData} filteredData={filteredData} paginatedData={paginatedData} currentPage={currentPage} setCurrentPage={setCurrentPage} itemsPerPage={itemsPerPage} colVis={colVis} sortConfig={sortConfig} setSortConfig={setSortConfig} handleCellEdit={handleCellEdit} handleAddressKeyDown={handleAddressKeyDown} handleUpdateBaseList={handleUpdateBaseList} handleBatchSaveBaseList={handleBatchSaveBaseList} setShowExportSetting={setShowExportSetting} handleExport={handleExport} handleExportErrors={handleExportErrors} handleExportDongSummary={handleExportDongSummary} handleDeleteRows={handleDeleteRows} handleBatchSetNote={handleBatchSetNote} onHelp={onHelp} />}
          {step === 6 && <BaseListManager user={user} onBack={() => setStep(0)} />}
          {step === 7 && <AdminPanel user={user} onClose={() => setStep(0)} />}
        </main>
        
        {/* RESTORED MODAL RENDERS */}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        {showUtils && <UtilsModal onClose={() => setShowUtils(false)} />}
        {showUpgrade && <UpgradeModal user={user} userTier={user?.tier || 'basic'} usedCount={baseCount} userMaxCities={user?.maxCities || 1} onClose={() => setShowUpgrade(false)} />}
        {showCloudBase && <CloudBaseModal user={user} onClose={() => setShowCloudBase(false)} onImport={(newBaseMap, city, count) => { setBaseMap(newBaseMap); setBaseCount(count); setShowCloudBase(false); }} />}
        {profileModal.open && <ProfileSetupModal user={user} isNewUser={profileModal.isNew} onClose={() => setProfileModal({ open: false, isNew: false })} />}
      </div>
    </ErrorBoundary>
  );
}
