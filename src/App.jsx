import React, { useState, useEffect, useMemo, useRef } from "react";
import { auth, onAuthStateChanged, setDoc, getDoc, updateDoc, increment, doc, db, serverTimestamp, addDoc, collection, getDocs, writeBatch } from "./config/firebase.js";

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

import { processAddress, asyncPool, addTypoRecord } from "./engine/addressEngine.js";
import { parsePhoneNumbers, parseSMS, parseBirthDate } from "./utils/parsers.js";
import { LogOut, ShieldCheck, CheckCircle, Database, Crown, Layers, UserCircle, Undo2 } from "lucide-react";

export default function App() {
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(true);
  const [step, setStep] = useState(0); 
  const [activeTab, setActiveTab] = useState("audit");
  
  const [fileInfo, setFileInfo] = useState(null);
  const [worksheets, setWorksheets] = useState([]);
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [mapDefs, setMapDefs] = useState({});
  const [gridData, setGridData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [paginatedData, setPaginatedData] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(500);

  const [isBaseUploading, setIsBaseUploading] = useState(false);
  const [engineProgress, setEngineProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [progressLogs, setProgressLogs] = useState([]);
  const [filter, setFilter] = useState({ text: "", showErrorsOnly: false });
  const [colVis, setColVis] = useState({});
  const [baseCount, setBaseCount] = useState(0);

  const [showExportSetting, setShowExportSetting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showUtils, setShowUtils] = useState(false);
  const [showCloudBase, setShowCloudBase] = useState(false);
  const [profileModal, setProfileModal] = useState({ open: false, isNew: false });

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
        setUser({ ...u, role: d.exists() ? d.data().role : "user" });
        setShowAuth(false);
      } else {
        setUser(null);
        setShowAuth(true);
      }
    });
    return () => unsub();
  }, []);

  const sortedData = useMemo(() => {
    return [...gridData].sort((a, b) => {
      let cmp = String(a.구분 || "").localeCompare(String(b.구분 || ""));
      if (cmp !== 0) return cmp;
      cmp = String(a.주소 || "").localeCompare(String(b.주소 || ""));
      if (cmp !== 0) return cmp;
      return String(a.이름 || "").localeCompare(String(b.이름 || ""));
    });
  }, [gridData]);

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
    setFileInfo({ name: file.name, size: file.size, file });
    
    const worker = new Worker(new URL("./excelWorker.js", import.meta.url), { type: "module" });
    worker.postMessage({ type: "PARSE_EXCEL", file });
    worker.onmessage = (evt) => {
      if (evt.data.type === "EXCEL_PARSED") {
        setWorksheets(evt.data.sheets);
        setStep(2);
      }
    };
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
      const sheetMap = mapDefs[sheet.name] || {};
      const CHUNK_SIZE = 500;
      for (let i = 0; i < sheet.bodyRows.length; i += CHUNK_SIZE) {
        const chunk = sheet.bodyRows.slice(i, i + CHUNK_SIZE);
        const chunkResults = await asyncPool(20, chunk, async (row) => {
          let addr = row[sheetMap.addr] || "";
          let name = row[sheetMap.name] || "";
          const processedRow = await processAddress(addr, name);
          count++;
          if (Date.now() - lastProgressTime > 200) {
            setEngineProgress({ current: count, total, percent: Math.round((count/total)*100) });
            lastProgressTime = Date.now();
          }
          return {
            id: window.crypto.randomUUID(),
            구분: sheet.type,
            행정동: row[sheetMap.admin] || "-",
            이름: processedRow.정제된이름 || name,
            생년월일: parseBirthDate(row[sheetMap.birth]),
            포수: 1,
            휴대폰: parsePhoneNumbers(row[sheetMap.phone1], row[sheetMap.phone2]).mobile,
            유선전화: parsePhoneNumbers(row[sheetMap.phone1], row[sheetMap.phone2]).landline,
            주소: processedRow.주소,
            문자수신: parseSMS(row[sheetMap.sms]),
            특이사항: row[sheetMap.note] || "",
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
      const ref = doc(db, "baselist", row.id || row.이름);
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

  const handleDeleteRows = (ids) => {
    const newData = gridData.filter(r => !ids.has(r.id));
    pushHistory(newData);
  };

  const handleBatchSetNote = (ids, note) => {
    const newData = gridData.map(r => ids.has(r.id) ? { ...r, 특이사항: note } : r);
    pushHistory(newData);
  };

  const handleExport = () => { /* Export logic */ };
  const handleExportErrors = () => { /* Export logic */ };
  const handleExportDongSummary = () => { /* Export logic */ };
  const onHelp = () => setShowHelp(true);
  const onLogout = () => auth.signOut();

  if (showAuth) return <AuthScreen />;

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
          
          <div className="flex items-center gap-3">
             <button onClick={() => setStep(0)} className="px-4 py-2 bg-[#111] hover:bg-[#222] border border-[#333] text-gray-300 font-bold rounded-lg text-xs transition-all flex items-center gap-2">
               대시보드
             </button>
             <button onClick={handleUndo} disabled={history.length === 0} className="px-4 py-2 bg-[#222] hover:bg-[#333] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-2">
               <Undo2 size={16} /> 실행취소
             </button>
             
             {/* RESTORED MODAL BUTTONS */}
             <button onClick={() => setShowCloudBase(true)} className="px-4 py-2 bg-blue-900/40 text-blue-300 border border-blue-500/50 hover:bg-blue-900/60 font-bold rounded-lg text-xs transition-all flex items-center gap-2">
               <Database size={16} /> 클라우드 명단
             </button>
             <button onClick={() => setShowUtils(true)} className="px-4 py-2 bg-yellow-900/40 text-yellow-300 border border-yellow-500/50 hover:bg-yellow-900/60 font-bold rounded-lg text-xs transition-all flex items-center gap-2">
               <Layers size={16} /> 부가서비스
             </button>
             <button onClick={() => setShowUpgrade(true)} className="px-4 py-2 bg-indigo-900/40 text-indigo-300 border border-indigo-500/50 hover:bg-indigo-900/60 font-bold rounded-lg text-xs transition-all flex items-center gap-2">
               <Crown size={16} /> 회원등급 관리
             </button>
             <button onClick={() => setProfileModal({ open: true, isNew: false })} className="px-4 py-2 bg-gray-800 text-gray-300 border border-gray-600 hover:bg-gray-700 font-bold rounded-lg text-xs transition-all flex items-center gap-2">
               <UserCircle size={16} /> 내 프로필
             </button>
             
             {user?.role === "admin" && (
               <button onClick={() => setStep(7)} className="px-4 py-2 bg-purple-900/40 text-purple-300 border border-purple-500/50 hover:bg-purple-900/60 font-bold rounded-lg text-xs transition-all flex items-center gap-2">
                 <ShieldCheck size={16} /> 관리자 패널
               </button>
             )}
             <button onClick={onLogout} className="px-4 py-2 bg-red-950/40 text-red-400 border border-red-500/50 hover:bg-red-900/60 font-bold rounded-lg text-xs transition-all flex items-center gap-2">
               <LogOut size={16} /> 로그아웃
             </button>
          </div>
        </header>

        <main className="flex-1 relative overflow-hidden bg-[#050505]">
          {step === 0 && <Dashboard user={user} onLogout={onLogout} onStart={(s) => setStep(typeof s === 'number' ? s : 1)} onHelp={onHelp} setFileInfo={setFileInfo} setWorksheets={setWorksheets} setBaseCount={setBaseCount} gridData={gridData} setGridData={setGridData} />}
          {step === 1 && <Step1_Upload handleDragOver={handleDragOver} handleDrop={handleDrop} handleFileUpload={handleFileUpload} handleUnifiedDrop={handleUnifiedDrop} isBaseUploading={isBaseUploading} step={step} onHelp={onHelp} onCloudFetch={() => {}} />}
          {step === 2 && <Step2_SheetSelect step={step} setStep={setStep} fileInfo={fileInfo} worksheets={worksheets} selectedSheets={selectedSheets} setSelectedSheets={setSelectedSheets} handleProcessStart={handleProcessStart} />}
          {step === 3 && <Step3_Mapping step={step} setStep={setStep} selectedSheets={selectedSheets} mapDefs={mapDefs} handleMapChange={handleMapChange} handleAnalyzeAll={handleAnalyzeAll} engineProgress={engineProgress} progressLogs={progressLogs} />}
          {step === 4 && <LoadingScreen progress={engineProgress} logs={progressLogs} />}
          {step === 5 && <ResultGrid step={step} setStep={setStep} filter={filter} setFilter={setFilter} gridData={gridData} filteredData={filteredData} paginatedData={paginatedData} currentPage={currentPage} setCurrentPage={setCurrentPage} itemsPerPage={itemsPerPage} colVis={colVis} handleCellEdit={handleCellEdit} handleAddressKeyDown={handleAddressKeyDown} handleUpdateBaseList={handleUpdateBaseList} setShowExportSetting={setShowExportSetting} handleExport={handleExport} handleExportErrors={handleExportErrors} handleExportDongSummary={handleExportDongSummary} handleDeleteRows={handleDeleteRows} handleBatchSetNote={handleBatchSetNote} onHelp={onHelp} />}
          {step === 6 && <BaseListManager user={user} onBack={() => setStep(0)} />}
          {step === 7 && <AdminPanel user={user} onClose={() => setStep(0)} />}
        </main>
        
        {/* RESTORED MODAL RENDERS */}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        {showUtils && <UtilsModal onClose={() => setShowUtils(false)} />}
        {showUpgrade && <UpgradeModal user={user} onClose={() => setShowUpgrade(false)} />}
        {showCloudBase && <CloudBaseModal user={user} onClose={() => setShowCloudBase(false)} onImport={(newBaseMap, city, count) => { /* Base Map Import logic */ }} />}
        {profileModal.open && <ProfileSetupModal user={user} isNewUser={profileModal.isNew} onClose={() => setProfileModal({ open: false, isNew: false })} />}
      </div>
    </ErrorBoundary>
  );
}
