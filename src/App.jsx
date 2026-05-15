import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, onAuthStateChanged, setDoc, getDoc, updateDoc, increment, doc, db, serverTimestamp, addDoc, collection, getDocs, writeBatch } from './config/firebase.js';

import Dashboard from './components/Dashboard.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import ProfileSetupModal from './components/ProfileSetupModal.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import Step1_Upload from './components/Step1_Upload.jsx';
import Step2_SheetSelect from './components/Step2_SheetSelect.jsx';
import Step3_Mapping from './components/Step3_Mapping.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import ResultGrid from './components/ResultGrid.jsx';
import HelpModal from './components/HelpModal.jsx';
import UpgradeModal from './components/UpgradeModal.jsx';
import UtilsModal from './components/UtilsModal.jsx';
import CloudBaseModal from './components/CloudBaseModal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import BaseListManager from './components/BaseListManager.jsx';

import { processAddress, asyncPool, addTypoRecord } from './engine/addressEngine.js';
import { getDB } from './engine/dbCache.js';
import { parsePhoneNumbers, parseSMS, parseBirthDate } from './utils/parsers.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(true);
  const [step, setStep] = useState(0); 
  const [activeTab, setActiveTab] = useState('audit');
  
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
  const [filter, setFilter] = useState({ text: '', showErrorsOnly: false });
  const [colVis, setColVis] = useState({});
  const [baseCount, setBaseCount] = useState(0);

  const [showExportSetting, setShowExportSetting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showUtils, setShowUtils] = useState(false);
  const [showCloudBase, setShowCloudBase] = useState(false);

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
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.type = 'image/png'; link.href = 'ttongpa.png';
    document.title = "NEXUS PIPELINE V4.0";

    const unsub = onAuthStateChanged(auth, async u => { 
      if (u) {
        const d = await getDoc(doc(db, 'users', u.uid));
        setUser({ ...u, role: d.exists() ? d.data().role : 'user' });
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
      let cmp = String(a.구분 || '').localeCompare(String(b.구분 || ''));
      if (cmp !== 0) return cmp;
      cmp = String(a.주소 || '').localeCompare(String(b.주소 || ''));
      if (cmp !== 0) return cmp;
      return String(a.이름 || '').localeCompare(String(b.이름 || ''));
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
    
    const worker = new Worker(new URL('./excelWorker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ type: 'PARSE_EXCEL', file });
    worker.onmessage = (evt) => {
      if (evt.data.type === 'EXCEL_PARSED') {
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
          let addr = row[sheetMap.addr] || '';
          let name = row[sheetMap.name] || '';
          const processedRow = await processAddress(addr, name);
          count++;
          if (Date.now() - lastProgressTime > 200) {
            setEngineProgress({ current: count, total, percent: Math.round((count/total)*100) });
            lastProgressTime = Date.now();
          }
          return {
            id: window.crypto.randomUUID(),
            구분: sheet.type,
            행정동: row[sheetMap.admin] || '-',
            이름: processedRow.정제된이름 || name,
            생년월일: parseBirthDate(row[sheetMap.birth]),
            포수: 1,
            휴대폰: parsePhoneNumbers(row[sheetMap.phone1], row[sheetMap.phone2]).mobile,
            유선전화: parsePhoneNumbers(row[sheetMap.phone1], row[sheetMap.phone2]).landline,
            주소: processedRow.주소,
            문자수신: parseSMS(row[sheetMap.sms]),
            특이사항: row[sheetMap.note] || '',
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
    if (e.key === 'Enter') {
      const res = await processAddress(row.주소, row.이름);
      handleCellEdit(row.id, '주소', res.주소);
      if (res.주소 !== row.주소 && row.주소) {
        addTypoRecord(row.주소, res.주소);
      }
    }
  };

  const handleUpdateBaseList = async (row, updates) => {
    if (!row) return;
    try {
      const ref = doc(db, 'baselist', row.id || row.이름);
      await setDoc(ref, { ...row, ...updates }, { merge: true });
      
      await addDoc(collection(db, 'audit_logs'), {
        action: 'UPDATE_BASELIST',
        targetName: row.이름,
        updates: updates,
        timestamp: serverTimestamp(),
        adminEmail: user?.email || 'unknown'
      });
      alert('기본명단 및 감사 로그가 성공적으로 업데이트 되었습니다.');
    } catch (e) {
      console.error(e);
      alert('업데이트 실패: ' + e.message);
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
        {step === 0 && <Dashboard user={user} onLogout={onLogout} setStep={setStep} setFileInfo={setFileInfo} setWorksheets={setWorksheets} setBaseCount={setBaseCount} gridData={gridData} setGridData={setGridData} />}
        {step === 1 && <Step1_Upload handleDragOver={handleDragOver} handleDrop={handleDrop} handleFileUpload={handleFileUpload} handleUnifiedDrop={handleUnifiedDrop} isBaseUploading={isBaseUploading} step={step} onHelp={onHelp} onCloudFetch={() => {}} />}
        {step === 2 && <Step2_SheetSelect step={step} setStep={setStep} fileInfo={fileInfo} worksheets={worksheets} selectedSheets={selectedSheets} setSelectedSheets={setSelectedSheets} handleProcessStart={handleProcessStart} />}
        {step === 3 && <Step3_Mapping step={step} setStep={setStep} selectedSheets={selectedSheets} mapDefs={mapDefs} handleMapChange={handleMapChange} handleAnalyzeAll={handleAnalyzeAll} engineProgress={engineProgress} progressLogs={progressLogs} />}
        {step === 4 && <LoadingScreen progress={engineProgress} logs={progressLogs} />}
        {step === 5 && <ResultGrid step={step} setStep={setStep} filter={filter} setFilter={setFilter} gridData={gridData} filteredData={filteredData} paginatedData={paginatedData} currentPage={currentPage} setCurrentPage={setCurrentPage} itemsPerPage={itemsPerPage} colVis={colVis} handleCellEdit={handleCellEdit} handleAddressKeyDown={handleAddressKeyDown} handleUpdateBaseList={handleUpdateBaseList} setShowExportSetting={setShowExportSetting} handleExport={handleExport} handleExportErrors={handleExportErrors} handleExportDongSummary={handleExportDongSummary} handleDeleteRows={handleDeleteRows} handleBatchSetNote={handleBatchSetNote} onHelp={onHelp} />}
        {step === 6 && <BaseListManager user={user} onBack={() => setStep(0)} />}
        {step === 7 && <AdminPanel user={user} onBack={() => setStep(0)} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </div>
    </ErrorBoundary>
  );
}
