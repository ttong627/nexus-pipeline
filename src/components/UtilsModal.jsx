import { useState, useEffect, useRef } from 'react';
import { X, Layers, Download, Upload, Clock, Send, History, GitMerge, CheckSquare, Square, Trash2, Sparkles, FileX, SplitSquareHorizontal, RefreshCw, SlidersHorizontal, ArrowRight, ArrowUp, ArrowDown, Eye, Combine, Shuffle, ChevronRight, AlertCircle, Palette, Wand2, Building2 } from 'lucide-react';
import { db, collection, query, orderBy, limit, getDocs, addDoc, serverTimestamp, doc, getDoc } from '../config/firebase.js';
import * as XLSX from 'xlsx';

const ADMIN_EMAILS = ['ttong627@gmail.com'];

const fmtPhone = (v) => {
  const d = String(v ?? '').replace(/[^0-9]/g, '');
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return v;
};

const OUTPUT_COLS = [
  { key: 'seqNo',     label: '순번',        kws: ['순번', '번호', '연번'],              special: 'autoSeq' },
  { key: 'metro',     label: '광역시도',     kws: ['광역시도', '시도'],                 special: 'fromAddr' },
  { key: 'sigungu',   label: '시군구',       kws: ['시군구'],                           special: 'fromAddr' },
  { key: 'gubun',     label: '수급구분',     kws: ['구분', '유형', '계층', '수급구분'] },
  { key: 'dong',      label: '읍면동',       kws: ['행정동', '읍면동', '동명', '관할'] },
  { key: 'name',      label: '수령자명',     kws: ['이름', '성명', '수령자', '대상자'] },
  { key: 'mobile',    label: '휴대폰',       kws: ['휴대', '핸드폰', '모바일'],         transform: 'phone' },
  { key: 'landline',  label: '자택전화',     kws: ['유선', '자택전화'],                 transform: 'phone' },
  { key: 'address',   label: '주소',         kws: ['주소', '도로명', '지번'] },
  { key: 'driver',    label: '기사',         kws: ['기사', '담당기사'] },
  { key: 'note',      label: '특이사항',     kws: ['특이사항', '비고', '메모'] },
  { key: 'seqNoDlv',  label: '배송순번',     kws: ['배송순번'],                         special: 'autoSeq' },
  { key: 'birth',     label: '생년월일',     kws: ['생년월일', '생년', '생일'],          transform: 'birth' },
  { key: 'sms',       label: '문자수신여부', kws: ['문자수신', '수신동의', 'SMS'],       transform: 'sms' },
];
const scoreKw = (h, kws) => {
  const lh = String(h || '').trim().toLowerCase();
  if (!lh || lh.startsWith('col_')) return 0;
  if (kws.some(k => lh === k.toLowerCase())) return 95;
  if (kws.some(k => lh.startsWith(k.toLowerCase()) || k.toLowerCase().startsWith(lh))) return 85;
  if (kws.some(k => lh.includes(k.toLowerCase()))) return 72;
  if (kws.some(k => k.toLowerCase().includes(lh) && lh.length >= 2)) return 58;
  return 0;
};
const buildRemapSuggestion = (headers) => {
  const used = new Set();
  const result = {};
  OUTPUT_COLS.forEach(col => {
    if (col.special === 'autoSeq') {
      let bIdx = -1, bSc = 0;
      headers.forEach((h, i) => { if (used.has(i)) return; const s = scoreKw(h, col.kws); if (s > bSc) { bSc = s; bIdx = i; } });
      if (bSc >= 72) { result[col.key] = { srcIdx: bIdx, confidence: bSc }; used.add(bIdx); }
      else result[col.key] = { srcIdx: -3, confidence: 100 };
      return;
    }
    if (col.special === 'fromAddr') {
      let bIdx = -1, bSc = 0;
      headers.forEach((h, i) => { if (used.has(i)) return; const s = scoreKw(h, col.kws); if (s > bSc) { bSc = s; bIdx = i; } });
      if (bSc >= 85) { result[col.key] = { srcIdx: bIdx, confidence: bSc }; used.add(bIdx); }
      else result[col.key] = { srcIdx: -2, confidence: 90 };
      return;
    }
    let bIdx = -1, bSc = 0;
    headers.forEach((h, i) => { if (used.has(i)) return; const s = scoreKw(h, col.kws); if (s > bSc) { bSc = s; bIdx = i; } });
    if (bSc >= 58) { result[col.key] = { srcIdx: bIdx, confidence: bSc }; used.add(bIdx); }
    else result[col.key] = { srcIdx: -1, confidence: 0 };
  });
  return result;
};
const applyRemapTransform = (col, raw) => {
  if (raw === null || raw === undefined || raw === '') return '';
  const v = String(raw);
  if (col.transform === 'phone') {
    const d = v.replace(/[^0-9]/g, '');
    if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
    if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
    if (d.length === 9 && d.startsWith('02')) return `02-${d.slice(2,5)}-${d.slice(5)}`;
    return v;
  }
  if (col.transform === 'birth') {
    const d = v.replace(/[^0-9]/g, '');
    if (d.length === 8) return `${d.slice(2,4)}.${d.slice(4,6)}.${d.slice(6,8)}`;
    if (d.length === 6) return `${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`;
    return v.replace(/[-/]/g, '.');
  }
  if (col.transform === 'sms') {
    const s = v.trim();
    if (!s || s === '-') return '';
    if (/거부|거절|불가|불허|미동의|미수신|수신\s*불가/.test(s)) return 'N';
    if (/^(N|n|X|x|×|0|아니오?|불|없음)$/.test(s)) return 'N';
    if (/^(Y|y|O|o|○|ㅇ|1|예|동의|수신|가능|허용|yes|YES)$/.test(s)) return 'Y';
    if (/동의|수신|가능|허용/.test(s)) return 'Y';
    return 'N';
  }
  if (col.key === 'gubun') {
    if (/차상위/.test(v)) return '차상위';
    if (/수급|기초|생계|의료/.test(v)) return '기초수급자';
    return v;
  }
  return v;
};
const extractMetroStr = (addr) => {
  const m = String(addr||'').match(/^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/);
  return m ? m[1] : '';
};
const extractSigunguStr = (addr) => {
  const m = String(addr||'').match(/(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)\s+([^\s]+(?:시|군|구))/);
  return m ? m[1] : '';
};

export default function UtilsModal({ onClose, user }) {
  const isAdmin = user?.role === 'admin' || ADMIN_EMAILS.includes(user?.email);
  const [activeTab, setActiveTab] = useState('merger');

  // Sheet Merger
  const [mergerFile, setMergerFile] = useState(null);
  const [mergerFileName, setMergerFileName] = useState('');
  const [isMerging, setIsMerging] = useState(false);

  // Audit Log
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Dedup
  const [dedupFile, setDedupFile] = useState(null);
  const dedupBufferRef = useRef(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dedupResult, setDedupResult] = useState(null);
  const [deleteRowNums, setDeleteRowNums] = useState(new Set());
  const [dedupSubTab, setDedupSubTab] = useState('strong');
  const [isExporting, setIsExporting] = useState(false);

  // Dong Split (행정동 분리)
  const [dongFile, setDongFile] = useState(null);
  const dongBufferRef = useRef(null);
  const [isAnalyzingDong, setIsAnalyzingDong] = useState(false);
  const [dongResult, setDongResult] = useState(null);
  const [selectedColIdxs, setSelectedColIdxs] = useState([]);
  const [dongOptions, setDongOptions] = useState({ includeSummary: true, includeAll: true, splitGubun: false, sortRows: true });
  const [dongFileName, setDongFileName] = useState('');
  const [isExportingDong, setIsExportingDong] = useState(false);

  // Clean (찌꺼기 삭제)
  const [cleanFile, setCleanFile] = useState(null);
  const cleanBufferRef = useRef(null);
  const [isAnalyzingClean, setIsAnalyzingClean] = useState(false);
  const [cleanResult, setCleanResult] = useState(null);
  const [isExportingClean, setIsExportingClean] = useState(false);

  // Remap (컬럼 재배치)
  const [remapFile, setRemapFile] = useState(null);
  const remapBufferRef = useRef(null);
  const [isAnalyzingRemap, setIsAnalyzingRemap] = useState(false);
  const [remapResult, setRemapResult] = useState(null);
  const [remapMapping, setRemapMapping] = useState({});
  const [remapSelectedSheets, setRemapSelectedSheets] = useState([]);
  const [remapStep, setRemapStep] = useState(1);
  const [isExportingRemap, setIsExportingRemap] = useState(false);
  const [remapFileName, setRemapFileName] = useState('');
  const [remapBaseSheet, setRemapBaseSheet] = useState('');
  const [remapColOrder, setRemapColOrder] = useState(OUTPUT_COLS.map(c => c.key));

  // File Merge (파일 합치기)
  const [mergeFileA, setMergeFileA] = useState(null);
  const [mergeFileB, setMergeFileB] = useState(null);
  const mergeBufferRefA = useRef(null);
  const mergeBufferRefB = useRef(null);
  const [isAnalyzingMergeA, setIsAnalyzingMergeA] = useState(false);
  const [isAnalyzingMergeB, setIsAnalyzingMergeB] = useState(false);
  const [mergeResultA, setMergeResultA] = useState(null);
  const [mergeResultB, setMergeResultB] = useState(null);
  const [mergeMappingA, setMergeMappingA] = useState({});
  const [mergeMappingB, setMergeMappingB] = useState({});
  const [mergeSelectedSheetsA, setMergeSelectedSheetsA] = useState([]);
  const [mergeSelectedSheetsB, setMergeSelectedSheetsB] = useState([]);
  const [mergeBaseSheetA, setMergeBaseSheetA] = useState('');
  const [mergeBaseSheetB, setMergeBaseSheetB] = useState('');
  const [mergeStep, setMergeStep] = useState(1);
  const [isExportingMerge, setIsExportingMerge] = useState(false);
  const [mergeFileName, setMergeFileName] = useState('');

  // 스타일 서식 ─────────────────────────────────────────────────────────
  const [formatFile, setFormatFile] = useState(null);
  const formatBufferRef = useRef(null);
  const [isFormatAnalyzing, setIsFormatAnalyzing] = useState(false);
  const [isFormatProcessing, setIsFormatProcessing] = useState(false);
  const [selectedStyleId, setSelectedStyleId] = useState(1);
  const [formatInfo, setFormatInfo] = useState(null); // { sheets, totalRows }

  // DATA 매칭 ───────────────────────────────────────────────────────────
  const [matchStep, setMatchStep] = useState(1);
  const matchTargetBufferRef = useRef(null);
  const matchSourceBufferRef = useRef(null);
  const [matchTargetFile, setMatchTargetFile] = useState(null);
  const [matchSourceFile, setMatchSourceFile] = useState(null);
  const [matchTargetResult, setMatchTargetResult] = useState(null);
  const [matchSourceResult, setMatchSourceResult] = useState(null);
  const [matchTargetSheet, setMatchTargetSheet] = useState('');
  const [matchSourceSheet, setMatchSourceSheet] = useState('');
  const [matchTargetKeyMap, setMatchTargetKeyMap] = useState({ name: -1, birth: -1, phone: -1, landline: -1 });
  const [matchSourceKeyMap, setMatchSourceKeyMap] = useState({ name: -1, birth: -1, phone: -1, landline: -1 });
  const [matchTransplantCols, setMatchTransplantCols] = useState([]);
  const [isMatchAnalyzingTarget, setIsMatchAnalyzingTarget] = useState(false);
  const [isMatchAnalyzingSource, setIsMatchAnalyzingSource] = useState(false);
  const [isMatchRunning, setIsMatchRunning] = useState(false);
  const [matchStats, setMatchStats] = useState(null);
  const [matchResultBlob, setMatchResultBlob] = useState(null);

  // ── 소속사전용 집계 ───────────────────────────────────────────────────
  const [orgRptCity, setOrgRptCity] = useState('');
  const [orgRptCities, setOrgRptCities] = useState([]); // 관리자용 전체 지자체 목록
  const [orgRptLoadingCities, setOrgRptLoadingCities] = useState(false);
  const [orgRptLatestMonth, setOrgRptLatestMonth] = useState(null); // { id, totalCount }
  const [orgRptLoadingMonth, setOrgRptLoadingMonth] = useState(false);
  const [orgRptExporting, setOrgRptExporting] = useState(false);

  // ── Remap computed values ─────────────────────────────────────────────
  const remapActiveSheet = remapResult?.sheets?.find(s => s.name === remapBaseSheet);
  const remapActiveHeaders = remapActiveSheet?.headers ?? remapResult?.headers ?? [];
  const remapActiveSampleRows = remapActiveSheet?.sampleRows ?? remapResult?.sampleRows ?? [];

  // ── DATA 매칭 computed values ─────────────────────────────────────────
  const matchTargetActiveSheet = matchTargetResult?.sheets?.find(s => s.name === matchTargetSheet);
  const matchTargetHeaders = matchTargetActiveSheet?.headers ?? matchTargetResult?.headers ?? [];
  const matchSourceActiveSheet = matchSourceResult?.sheets?.find(s => s.name === matchSourceSheet);
  const matchSourceHeaders = matchSourceActiveSheet?.headers ?? matchSourceResult?.headers ?? [];

  // ── File Merge computed values ────────────────────────────────────────
  const mergeActiveSheetA = mergeResultA?.sheets?.find(s => s.name === mergeBaseSheetA);
  const mergeActiveHeadersA = mergeActiveSheetA?.headers ?? mergeResultA?.headers ?? [];
  const mergeActiveSampleRowsA = mergeActiveSheetA?.sampleRows ?? mergeResultA?.sampleRows ?? [];
  const mergeActiveSheetB = mergeResultB?.sheets?.find(s => s.name === mergeBaseSheetB);
  const mergeActiveHeadersB = mergeActiveSheetB?.headers ?? mergeResultB?.headers ?? [];
  const mergeActiveSampleRowsB = mergeActiveSheetB?.sampleRows ?? mergeResultB?.sampleRows ?? [];

  // ── Dong Split ───────────────────────────────────────────────────────
  const handleDongUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setDongFile(file);
    setDongResult(null);
    setSelectedColIdxs([]);
    dongBufferRef.current = await file.arrayBuffer();
    setIsAnalyzingDong(true);
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({ action: 'ANALYZE_DONG_SPLIT', buffer: dongBufferRef.current.slice(0) }, [dongBufferRef.current.slice(0)]);
      });
      if (!result.ok) throw new Error(result.error || '분석 실패');
      setDongResult(result);
      const KEY_COLS = ['dong', 'name', 'gubun', 'qty', 'addr', 'birth', 'mobile', 'landline', 'note', 'driver', 'seqNo'];
      const preSelected = new Set(KEY_COLS.map(k => result.colMap[k]).filter(v => v !== null && v !== undefined));
      setSelectedColIdxs(result.headers.map((_, i) => i).filter(i => preSelected.has(i)));
      setDongFileName(file.name.replace(/\.[^/.]+$/, '') + '_행정동분리');
    } catch (e) { alert('분석 오류: ' + e.message); }
    finally { setIsAnalyzingDong(false); }
  };

  const toggleColIdx = (idx) => setSelectedColIdxs(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx].sort((a, b) => a - b));

  const exportDongSplit = async () => {
    if (!dongBufferRef.current || !dongResult) return;
    if (!selectedColIdxs.length) return alert('내보낼 컬럼을 1개 이상 선택하세요.');
    if (!dongResult.hasDong) return alert('행정동 컬럼을 찾을 수 없습니다. 파일을 확인하세요.');
    setIsExportingDong(true);
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        const buf = dongBufferRef.current.slice(0);
        w.postMessage({ action: 'EXPORT_DONG_SPLIT', buffer: buf, colMap: dongResult.colMap, selectedColIdxs, options: dongOptions, fileName: `${dongFileName || '행정동분리'}.xlsx` }, [buf]);
      });
      if (!result.ok) throw new Error(result.error || '내보내기 실패');
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.fileName; a.click();
    } catch (e) { alert('내보내기 오류: ' + e.message); }
    finally { setIsExportingDong(false); }
  };

  const resetDong = () => { setDongFile(null); setDongResult(null); setSelectedColIdxs([]); dongBufferRef.current = null; };

  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(50));
      const snap = await getDocs(q);
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLogs(isAdmin ? all : all.filter(l => l.userEmail === user?.email || l.adminEmail === user?.email));
    } catch (e) { console.error(e); }
    finally { setLoadingLogs(false); }
  };

  useEffect(() => { if (activeTab === 'audit') fetchLogs(); }, [activeTab]);

  const handleSendNotification = async (log) => {
    try {
      await addDoc(collection(db, 'notifications'), {
        title: '기준명단 업데이트 알림',
        message: `[${log.targetName}] 님의 정보가 업데이트 되었습니다. (수정자: ${log.userEmail})`,
        read: false, timestamp: serverTimestamp(), type: 'AUDIT_ALERT', logId: log.id
      });
      alert('담당자에게 알림이 전송되었습니다!');
    } catch (e) { alert('알림 전송 실패: ' + e.message); }
  };

  const handleMergerUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setMergerFile(file);
    setMergerFileName(file.name.replace(/\.[^/.]+$/, '') + '_통합');
  };

  const executeMerge = async () => {
    if (!mergerFile) return alert('엑셀 파일을 먼저 첨부해주세요.');
    if (!mergerFileName.trim()) return alert('파일 이름을 입력해주세요.');
    setIsMerging(true);
    try {
      const buffer = await mergerFile.arrayBuffer();
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({ action: 'MERGE_SHEETS', buffer, fileName: `${mergerFileName}.xlsx` }, [buffer]);
      });
      if (!result.ok) throw new Error(result.error);
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.fileName; a.click();
      alert('시트 병합이 완료되었습니다!');
      setMergerFile(null); setMergerFileName('');
    } catch (e) { alert('오류: ' + e.message); }
    finally { setIsMerging(false); }
  };

  // ── Dedup ────────────────────────────────────────────────────────────────
  const handleDedupUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setDedupFile(file);
    setDedupResult(null);
    setDeleteRowNums(new Set());
    dedupBufferRef.current = await file.arrayBuffer();
  };

  const runAnalysis = async () => {
    if (!dedupBufferRef.current) return;
    setIsAnalyzing(true);
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({ action: 'ANALYZE_DEDUP', buffer: dedupBufferRef.current.slice(0) }, [dedupBufferRef.current.slice(0)]);
      });
      if (!result.ok) throw new Error(result.error);
      setDedupResult(result);
      setDeleteRowNums(new Set(result.recommendedDeletes));
      setDedupSubTab('strong');
    } catch (e) { alert('분석 오류: ' + e.message); }
    finally { setIsAnalyzing(false); }
  };

  const toggleRow = (rowNum) => {
    setDeleteRowNums(prev => {
      const next = new Set(prev);
      next.has(rowNum) ? next.delete(rowNum) : next.add(rowNum);
      return next;
    });
  };

  const toggleGroup = (group) => {
    const allChecked = group.rows.every((r, i) => i === group.keepIdx || deleteRowNums.has(r._rowNum));
    setDeleteRowNums(prev => {
      const next = new Set(prev);
      group.rows.forEach((r, i) => {
        if (i === group.keepIdx) return;
        allChecked ? next.delete(r._rowNum) : next.add(r._rowNum);
      });
      return next;
    });
  };

  const exportDedup = async () => {
    if (!dedupBufferRef.current || !dedupResult) return;
    setIsExporting(true);
    try {
      const baseName = dedupFile.name.replace(/\.[^/.]+$/, '');
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        const buf = dedupBufferRef.current.slice(0);
        w.postMessage({ action: 'EXPORT_DEDUP', buffer: buf, deleteRowNums: [...deleteRowNums], fileName: `${baseName}_정제본.xlsx` }, [buf]);
      });
      if (!result.ok) throw new Error(result.error);
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.fileName; a.click();
    } catch (e) { alert('내보내기 오류: ' + e.message); }
    finally { setIsExporting(false); }
  };

  const resetDedup = () => { setDedupFile(null); setDedupResult(null); setDeleteRowNums(new Set()); dedupBufferRef.current = null; };

  // ── Clean ────────────────────────────────────────────────────────────────
  const handleCleanUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCleanFile(file);
    setCleanResult(null);
    cleanBufferRef.current = await file.arrayBuffer();
  };

  const runCleanAnalysis = async () => {
    if (!cleanBufferRef.current) return;
    setIsAnalyzingClean(true);
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({ action: 'ANALYZE_CLEAN', buffer: cleanBufferRef.current.slice(0) }, [cleanBufferRef.current.slice(0)]);
      });
      if (!result.ok) throw new Error(result.error);
      setCleanResult(result);
    } catch (e) { alert('분석 오류: ' + e.message); }
    finally { setIsAnalyzingClean(false); }
  };

  const exportClean = async () => {
    if (!cleanBufferRef.current || !cleanResult) return;
    setIsExportingClean(true);
    try {
      const baseName = cleanFile.name.replace(/\.[^/.]+$/, '');
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        const buf = cleanBufferRef.current.slice(0);
        w.postMessage({ action: 'EXPORT_CLEAN', buffer: buf, fileName: `${baseName}_정제본.xlsx` }, [buf]);
      });
      if (!result.ok) throw new Error(result.error);
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.fileName; a.click();
    } catch (e) { alert('내보내기 오류: ' + e.message); }
    finally { setIsExportingClean(false); }
  };

  const resetClean = () => { setCleanFile(null); setCleanResult(null); cleanBufferRef.current = null; };

  // ── Remap ─────────────────────────────────────────────────────────────────
  const handleRemapUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRemapFile(file);
    setRemapResult(null);
    setRemapMapping({});
    setRemapSelectedSheets([]);
    setRemapStep(1);
    remapBufferRef.current = await file.arrayBuffer();
    setIsAnalyzingRemap(true);
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (ev) => { w.terminate(); reject(ev); };
        w.postMessage({ action: 'ANALYZE_REMAP', buffer: remapBufferRef.current.slice(0) }, [remapBufferRef.current.slice(0)]);
      });
      if (!result.ok) throw new Error(result.error || '분석 실패');
      setRemapResult(result);
      setRemapMapping(buildRemapSuggestion(result.headers));
      setRemapSelectedSheets(result.sheets.map(s => s.name));
      setRemapBaseSheet(result.sheetName);
      setRemapColOrder(OUTPUT_COLS.map(c => c.key));
      setRemapFileName(file.name.replace(/\.[^/.]+$/, '') + '_재배치');
      setRemapStep(2);
    } catch (err) { alert('분석 오류: ' + err.message); }
    finally { setIsAnalyzingRemap(false); }
  };
  const toggleRemapSheet = (name) => {
    setRemapSelectedSheets(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };
  const switchRemapBaseSheet = (name) => {
    setRemapBaseSheet(name);
    const sheetData = remapResult?.sheets?.find(s => s.name === name);
    if (sheetData?.headers) setRemapMapping(buildRemapSuggestion(sheetData.headers));
  };
  const moveRemapCol = (key, dir) => {
    setRemapColOrder(prev => {
      const arr = [...prev];
      const idx = arr.indexOf(key);
      const newIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  };
  const handleMappingChange = (colKey, val) => {
    setRemapMapping(prev => ({ ...prev, [colKey]: { srcIdx: Number(val), confidence: 100 } }));
  };
  const getRemapSampleVal = (colKey, srcIdx) => {
    if (!remapActiveSampleRows?.length) return '';
    const row = remapActiveSampleRows[0];
    const col = OUTPUT_COLS.find(c => c.key === colKey);
    if (srcIdx === -3) return '1';
    if (srcIdx === -2) {
      const addrIdx = remapMapping['address']?.srcIdx ?? -1;
      const addr = addrIdx >= 0 ? String(row[addrIdx] || '') : '';
      if (colKey === 'metro') return extractMetroStr(addr);
      if (colKey === 'sigungu') return extractSigunguStr(addr);
      return '';
    }
    if (srcIdx < 0 || !col) return '';
    return applyRemapTransform(col, row[srcIdx] ?? '');
  };
  const getPreviewRows = () => {
    if (!remapActiveSampleRows?.length) return [];
    const orderedCols = remapColOrder.map(key => OUTPUT_COLS.find(c => c.key === key)).filter(Boolean);
    return remapActiveSampleRows.slice(0, 5).map((row, i) => {
      return orderedCols.map(col => {
        const m = remapMapping[col.key] || {};
        const srcIdx = m.srcIdx ?? -1;
        if (srcIdx === -3) return i + 1;
        if (srcIdx === -2) {
          const addrIdx = remapMapping['address']?.srcIdx ?? -1;
          const addr = addrIdx >= 0 ? String(row[addrIdx] || '') : '';
          if (col.key === 'metro') return extractMetroStr(addr);
          if (col.key === 'sigungu') return extractSigunguStr(addr);
          return '';
        }
        if (srcIdx < 0) return '';
        return applyRemapTransform(col, row[srcIdx] ?? '');
      });
    });
  };
  const exportRemap = async () => {
    if (!remapBufferRef.current || !remapResult) return;
    if (!remapSelectedSheets.length) return alert('시트를 1개 이상 선택하세요.');
    setIsExportingRemap(true);
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (ev) => { w.terminate(); reject(ev); };
        const buf = remapBufferRef.current.slice(0);
        w.postMessage({
          action: 'EXPORT_REMAP', buffer: buf,
          mapping: remapMapping,
          outputCols: OUTPUT_COLS.map(c => ({ key: c.key, label: c.label })),
          addrSrcIdx: remapMapping['address']?.srcIdx ?? -1,
          selectedSheets: remapSelectedSheets,
          colOrder: remapColOrder,
          fileName: `${remapFileName || '컬럼재배치'}.xlsx`,
        }, [buf]);
      });
      if (!result.ok) throw new Error(result.error || '내보내기 실패');
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.fileName; a.click();
    } catch (err) { alert('내보내기 오류: ' + err.message); }
    finally { setIsExportingRemap(false); }
  };
  const resetRemap = () => {
    setRemapFile(null); setRemapResult(null); setRemapMapping({});
    setRemapSelectedSheets([]); setRemapStep(1); remapBufferRef.current = null; setRemapFileName('');
    setRemapBaseSheet(''); setRemapColOrder(OUTPUT_COLS.map(c => c.key));
  };

  // ── File Merge ────────────────────────────────────────────────────────────
  const handleMergeUpload = async (e, which) => {
    const file = e.target.files[0];
    if (!file) return;
    const setFile       = which === 'A' ? setMergeFileA       : setMergeFileB;
    const setResult     = which === 'A' ? setMergeResultA     : setMergeResultB;
    const setMapping    = which === 'A' ? setMergeMappingA    : setMergeMappingB;
    const setSelSheets  = which === 'A' ? setMergeSelectedSheetsA : setMergeSelectedSheetsB;
    const bufRef        = which === 'A' ? mergeBufferRefA     : mergeBufferRefB;
    const setAnalyzing  = which === 'A' ? setIsAnalyzingMergeA : setIsAnalyzingMergeB;
    setFile(file); setResult(null); setMapping({}); setSelSheets([]);
    bufRef.current = await file.arrayBuffer();
    setAnalyzing(true);
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (ev) => { w.terminate(); reject(ev); };
        w.postMessage({ action: 'ANALYZE_REMAP', buffer: bufRef.current.slice(0) }, [bufRef.current.slice(0)]);
      });
      if (!result.ok) throw new Error(result.error || '분석 실패');
      setResult(result);
      const sug = buildRemapSuggestion(result.headers);
      sug.gubun = { srcIdx: which === 'A' ? -4 : -5, confidence: 100 };
      setMapping(sug);
      setSelSheets(result.sheets.map(s => s.name));
      const setBaseSheet = which === 'A' ? setMergeBaseSheetA : setMergeBaseSheetB;
      setBaseSheet(result.sheetName);
    } catch (err) { alert('분석 오류: ' + err.message); }
    finally { setAnalyzing(false); }
  };
  const toggleMergeSheet = (which, name) => {
    const setter = which === 'A' ? setMergeSelectedSheetsA : setMergeSelectedSheetsB;
    setter(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };
  const switchMergeBaseSheet = (which, name) => {
    const setBaseSheet = which === 'A' ? setMergeBaseSheetA : setMergeBaseSheetB;
    const setMapping   = which === 'A' ? setMergeMappingA   : setMergeMappingB;
    const result       = which === 'A' ? mergeResultA       : mergeResultB;
    setBaseSheet(name);
    const sheetData = result?.sheets?.find(s => s.name === name);
    if (sheetData?.headers) {
      const sug = buildRemapSuggestion(sheetData.headers);
      sug.gubun = { srcIdx: which === 'A' ? -4 : -5, confidence: 100 };
      setMapping(sug);
    }
  };
  const handleMergeMappingChange = (which, colKey, val) => {
    const setter = which === 'A' ? setMergeMappingA : setMergeMappingB;
    setter(prev => ({ ...prev, [colKey]: { srcIdx: Number(val), confidence: 100 } }));
  };
  const getMergePreviewRows = (which) => {
    const mapping = which === 'A' ? mergeMappingA : mergeMappingB;
    const fixedGubun = which === 'A' ? '기초수급자' : '차상위';
    const activeSampleRows = which === 'A' ? mergeActiveSampleRowsA : mergeActiveSampleRowsB;
    if (!activeSampleRows?.length) return [];
    return activeSampleRows.slice(0, 3).map((row, i) => {
      return OUTPUT_COLS.map(col => {
        if (col.key === 'gubun') return fixedGubun;
        const m = mapping[col.key] || {};
        const srcIdx = m.srcIdx ?? -1;
        if (srcIdx === -3) return i + 1;
        if (srcIdx === -2) {
          const addrIdx = mapping['address']?.srcIdx ?? -1;
          const addr = addrIdx >= 0 ? String(row[addrIdx] || '') : '';
          if (col.key === 'metro') return extractMetroStr(addr);
          if (col.key === 'sigungu') return extractSigunguStr(addr);
          return '';
        }
        if (srcIdx < 0) return '';
        return applyRemapTransform(col, row[srcIdx] ?? '');
      });
    });
  };
  const exportFileMerge = async () => {
    if (!mergeBufferRefA.current || !mergeBufferRefB.current) return;
    if (!mergeSelectedSheetsA.length || !mergeSelectedSheetsB.length) return alert('시트를 1개 이상 선택하세요.');
    setIsExportingMerge(true);
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (ev) => { w.terminate(); reject(ev); };
        const bufA = mergeBufferRefA.current.slice(0);
        const bufB = mergeBufferRefB.current.slice(0);
        w.postMessage({
          action: 'EXPORT_MERGE', bufferA: bufA, bufferB: bufB,
          mappingA: mergeMappingA, mappingB: mergeMappingB,
          selectedSheetsA: mergeSelectedSheetsA, selectedSheetsB: mergeSelectedSheetsB,
          outputCols: OUTPUT_COLS.map(c => ({ key: c.key, label: c.label })),
          addrSrcIdxA: mergeMappingA['address']?.srcIdx ?? -1,
          addrSrcIdxB: mergeMappingB['address']?.srcIdx ?? -1,
          fileName: `${mergeFileName || '수급자차상위합본'}.xlsx`,
        }, [bufA, bufB]);
      });
      if (!result.ok) throw new Error(result.error || '내보내기 실패');
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.fileName; a.click();
    } catch (err) { alert('내보내기 오류: ' + err.message); }
    finally { setIsExportingMerge(false); }
  };
  const resetFileMerge = () => {
    setMergeFileA(null); setMergeFileB(null);
    setMergeResultA(null); setMergeResultB(null);
    setMergeMappingA({}); setMergeMappingB({});
    setMergeSelectedSheetsA([]); setMergeSelectedSheetsB([]);
    setMergeBaseSheetA(''); setMergeBaseSheetB('');
    setMergeStep(1); mergeBufferRefA.current = null; mergeBufferRefB.current = null; setMergeFileName('');
  };

  // ── 스타일 서식 PRESETS & 핸들러 ────────────────────────────────────────
  const STYLE_PRESETS = [
    { id:1,  name:'모던 블루',     desc:'신뢰감 있는 파란 헤더',    headerBg:'#1e40af', headerFg:'#ffffff', evenBg:'#eff6ff', oddBg:'#ffffff', border:'#bfdbfe', accent:'#1d4ed8' },
    { id:2,  name:'다크 프리미엄', desc:'고급 다크 + 골드 포인트',   headerBg:'#0f172a', headerFg:'#fbbf24', evenBg:'#f8fafc', oddBg:'#ffffff', border:'#e2e8f0', accent:'#fbbf24' },
    { id:3,  name:'에메랄드',      desc:'청량한 에메랄드 그린',      headerBg:'#065f46', headerFg:'#ffffff', evenBg:'#ecfdf5', oddBg:'#ffffff', border:'#a7f3d0', accent:'#059669' },
    { id:4,  name:'로즈 엘레강스', desc:'우아한 로즈 핑크',          headerBg:'#9d174d', headerFg:'#ffffff', evenBg:'#fdf2f8', oddBg:'#ffffff', border:'#fbcfe8', accent:'#be185d' },
    { id:5,  name:'선셋 오렌지',   desc:'활기찬 오렌지 에너지',      headerBg:'#9a3412', headerFg:'#ffffff', evenBg:'#fff7ed', oddBg:'#ffffff', border:'#fed7aa', accent:'#c2410c' },
    { id:6,  name:'퍼플 갤럭시',   desc:'신비로운 보라 그라디언트',  headerBg:'#4c1d95', headerFg:'#ffffff', evenBg:'#faf5ff', oddBg:'#ffffff', border:'#ddd6fe', accent:'#6d28d9' },
    { id:7,  name:'스틸 그레이',   desc:'세련된 프로페셔널 톤',      headerBg:'#1f2937', headerFg:'#f9fafb', evenBg:'#f3f4f6', oddBg:'#ffffff', border:'#d1d5db', accent:'#4b5563' },
    { id:8,  name:'루비 레드',     desc:'강렬한 레드 임팩트',        headerBg:'#7f1d1d', headerFg:'#ffffff', evenBg:'#fef2f2', oddBg:'#ffffff', border:'#fecaca', accent:'#b91c1c' },
    { id:9,  name:'오션 딥',       desc:'깊고 고요한 시안 오션',     headerBg:'#0c4a6e', headerFg:'#e0f2fe', evenBg:'#f0f9ff', oddBg:'#ffffff', border:'#bae6fd', accent:'#0369a1' },
    { id:10, name:'골드 럭셔리',   desc:'품격 있는 골드 프리미엄',   headerBg:'#78350f', headerFg:'#fef3c7', evenBg:'#fffbeb', oddBg:'#ffffff', border:'#fde68a', accent:'#b45309' },
  ];

  const handleFormatUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setFormatFile(file); setFormatInfo(null);
    setIsFormatAnalyzing(true);
    try {
      formatBufferRef.current = await file.arrayBuffer();
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({ action: 'ANALYZE_REMAP', buffer: formatBufferRef.current.slice(0) }, [formatBufferRef.current.slice(0)]);
      });
      if (!result.ok) throw new Error(result.error || '분석 실패');
      setFormatInfo({ sheets: result.sheets || [{ name: result.sheetName, rowCount: result.totalRows }], totalRows: result.totalRows || 0 });
    } catch (e) { alert('파일 분석 오류: ' + e.message); }
    finally { setIsFormatAnalyzing(false); }
  };

  const runFormatExcel = async () => {
    if (!formatBufferRef.current) return;
    setIsFormatProcessing(true);
    try {
      const buf = formatBufferRef.current.slice(0);
      const now = new Date();
      const ts = `${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
      const preset = STYLE_PRESETS.find(p => p.id === selectedStyleId);
      const baseName = (formatFile?.name || '').replace(/\.[^/.]+$/, '');
      const fileName = `${baseName}_${preset?.name || '서식적용'}_${ts}.xlsx`;
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../formatWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (ev) => { w.terminate(); reject(new Error(ev.message || '워커 오류')); };
        w.postMessage({ buffer: buf, presetId: selectedStyleId, fileName }, [buf]);
      });
      if (!result.ok) throw new Error(result.error || '서식 적용 실패');
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.fileName; a.click();
    } catch (e) { alert('서식 적용 오류: ' + e.message); }
    finally { setIsFormatProcessing(false); }
  };

  const resetFormat = () => {
    setFormatFile(null); setFormatInfo(null);
    formatBufferRef.current = null;
  };

  // ── DATA 매칭 핸들러 ──────────────────────────────────────────────────
  const autoDetectMatchKeyMap = (headers) => {
    const find = (...kws) => {
      const idx = headers.findIndex(h => {
        const hn = String(h).toLowerCase().replace(/\s+/g, '');
        return kws.some(k => hn.includes(k.toLowerCase().replace(/\s+/g, '')));
      });
      return idx >= 0 ? idx : -1;
    };
    return {
      name:     find('이름','성명','대상자','수령자명'),
      birth:    find('생년월일','생년'),
      phone:    find('휴대','핸드폰','모바일','연락처'),
      landline: find('유선','자택전화'),
    };
  };

  const analyzeMatchFile = async (bufRef, file, setFile, setResult, setSheet, setKeyMap, extraCb) => {
    setFile(file);
    setResult(null);
    bufRef.current = await file.arrayBuffer();
    try {
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({ action: 'ANALYZE_REMAP', buffer: bufRef.current.slice(0) }, [bufRef.current.slice(0)]);
      });
      if (!result.ok) throw new Error(result.error || '분석 실패');
      setResult(result);
      const firstName = result.sheets?.[0]?.name || '';
      setSheet(firstName);
      const headers = result.sheets?.[0]?.headers ?? result.headers ?? [];
      setKeyMap(autoDetectMatchKeyMap(headers));
      if (extraCb) extraCb(headers, result);
    } catch (e) { alert('파일 분석 오류: ' + e.message); }
  };

  const handleMatchTargetUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setIsMatchAnalyzingTarget(true);
    await analyzeMatchFile(matchTargetBufferRef, file, setMatchTargetFile, setMatchTargetResult, setMatchTargetSheet, setMatchTargetKeyMap);
    setIsMatchAnalyzingTarget(false);
  };

  const handleMatchSourceUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setIsMatchAnalyzingSource(true);
    const tgtHeaders = (matchTargetResult?.sheets?.find(s => s.name === matchTargetSheet) || matchTargetResult)?.headers ?? [];
    await analyzeMatchFile(matchSourceBufferRef, file, setMatchSourceFile, setMatchSourceResult, setMatchSourceSheet, setMatchSourceKeyMap, (srcHeaders) => {
      const INTERESTING = ['특이사항','비고','메모','기사','담당기사','배송순번','순번','운전자','driver','note'];
      const cols = srcHeaders.map((h, i) => {
        const tgtIdx = tgtHeaders.findIndex(th => String(th).trim() === String(h).trim());
        const enabled = INTERESTING.some(kw => String(h).toLowerCase().includes(kw.toLowerCase()));
        return { srcIdx: i, srcLabel: h || `열${i+1}`, enabled, tgtIdx };
      });
      setMatchTransplantCols(cols);
    });
    setIsMatchAnalyzingSource(false);
  };

  const handleMatchTargetSheetChange = (name) => {
    setMatchTargetSheet(name);
    const sheet = matchTargetResult?.sheets?.find(s => s.name === name);
    if (sheet) setMatchTargetKeyMap(autoDetectMatchKeyMap(sheet.headers));
  };

  const handleMatchSourceSheetChange = (name) => {
    setMatchSourceSheet(name);
    const sheet = matchSourceResult?.sheets?.find(s => s.name === name);
    const tgtHeaders = (matchTargetResult?.sheets?.find(s => s.name === matchTargetSheet) || matchTargetResult)?.headers ?? [];
    if (sheet) {
      setMatchSourceKeyMap(autoDetectMatchKeyMap(sheet.headers));
      const INTERESTING = ['특이사항','비고','메모','기사','담당기사','배송순번','순번','운전자','driver','note'];
      const cols = sheet.headers.map((h, i) => {
        const tgtIdx = tgtHeaders.findIndex(th => String(th).trim() === String(h).trim());
        const enabled = INTERESTING.some(kw => String(h).toLowerCase().includes(kw.toLowerCase()));
        return { srcIdx: i, srcLabel: h || `열${i+1}`, enabled, tgtIdx };
      });
      setMatchTransplantCols(cols);
    }
  };

  const runDataMatch = async () => {
    const enabledCols = matchTransplantCols.filter(c => c.enabled);
    if (!enabledCols.length) return alert('이식할 컬럼을 1개 이상 선택하세요.');
    if (matchTargetKeyMap.name < 0) return alert('대상 파일의 [이름] 컬럼을 지정하세요.');
    if (matchSourceKeyMap.name < 0) return alert('소스 파일의 [이름] 컬럼을 지정하세요.');
    setIsMatchRunning(true);
    try {
      const tBuf = matchTargetBufferRef.current.slice(0);
      const sBuf = matchSourceBufferRef.current.slice(0);
      const now = new Date();
      const ts = `${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
      const baseName = (matchTargetFile?.name || '').replace(/\.[^/.]+$/, '');
      const fileName = `${baseName}_매칭결과_${ts}.xlsx`;
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('../excelWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({
          action: 'DATA_MATCH',
          targetBuffer: tBuf,
          sourceBuffer: sBuf,
          targetSheet: matchTargetSheet,
          sourceSheet: matchSourceSheet,
          targetKeyMap: matchTargetKeyMap,
          sourceKeyMap: matchSourceKeyMap,
          transplantFields: enabledCols.map(c => ({ srcIdx: c.srcIdx, tgtIdx: c.tgtIdx, label: c.srcLabel })),
          fileName,
        }, [tBuf, sBuf]);
      });
      if (!result.ok) throw new Error(result.error || '매칭 실패');
      const blob = new Blob([result.wbout], { type: 'application/octet-stream' });
      setMatchResultBlob({ blob, fileName: result.fileName });
      setMatchStats({ matched: result.matched, total: result.total });
      setMatchStep(3);
    } catch (e) { alert('매칭 오류: ' + e.message); }
    finally { setIsMatchRunning(false); }
  };

  const downloadMatchResult = () => {
    if (!matchResultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(matchResultBlob.blob);
    a.download = matchResultBlob.fileName;
    a.click();
  };

  const resetMatch = () => {
    setMatchStep(1); setMatchStats(null); setMatchResultBlob(null);
    setMatchTargetFile(null); setMatchSourceFile(null);
    setMatchTargetResult(null); setMatchSourceResult(null);
    setMatchTargetSheet(''); setMatchSourceSheet('');
    setMatchTargetKeyMap({ name:-1, birth:-1, phone:-1, landline:-1 });
    setMatchSourceKeyMap({ name:-1, birth:-1, phone:-1, landline:-1 });
    setMatchTransplantCols([]);
    matchTargetBufferRef.current = null; matchSourceBufferRef.current = null;
  };

  const fmtSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;

  // ── 소속사전용: 관리자용 전체 지자체 목록 로드 ───────────────────────
  const loadOrgRptAdminCities = async () => {
    setOrgRptLoadingCities(true);
    try {
      const snap = await getDocs(collection(db, 'cloud_lists'));
      const cities = snap.docs
        .map(d => ({ id: d.id, lastMonthId: d.data().lastMonthId, totalQty: d.data().latestTotalQty || d.data().latestTotalCount || 0 }))
        .filter(c => c.lastMonthId)
        .sort((a, b) => a.id.localeCompare(b.id, 'ko'));
      setOrgRptCities(cities);
    } catch (e) { console.error(e); }
    finally { setOrgRptLoadingCities(false); }
  };

  // ── 소속사전용: 지자체 선택 시 최신 월 자동 감지 ─────────────────────
  const handleOrgRptCityChange = async (cityId) => {
    setOrgRptCity(cityId);
    setOrgRptLatestMonth(null);
    if (!cityId) return;
    setOrgRptLoadingMonth(true);
    try {
      const cityDoc = await getDoc(doc(db, 'cloud_lists', cityId));
      if (cityDoc.exists()) {
        const d = cityDoc.data();
        const monthId = d.lastMonthId;
        if (monthId) {
          setOrgRptLatestMonth({
            id: monthId,
            totalCount: d.latestTotalCount || 0,
            totalQty: d.latestTotalQty || d.latestTotalCount || 0,
            수급자Qty: d['latest수급자Qty'] || d['latest수급자Count'] || 0,
            차상위Qty: d['latest차상위Qty'] || d['latest차상위Count'] || 0,
          });
        }
      }
    } catch (e) { console.error(e); }
    finally { setOrgRptLoadingMonth(false); }
  };

  // ── 소속사전용: 집계표 + 명단 엑셀 추출 ────────────────────────────────
  const handleOrgRptExport = async () => {
    if (!orgRptCity || !orgRptLatestMonth) return;
    setOrgRptExporting(true);
    const monthId = orgRptLatestMonth.id;
    try {
      // 1. 소속사 프리셋 로드
      const presetSnap = await getDoc(doc(db, 'org_presets', orgRptCity));
      const orgs = presetSnap.exists() ? (presetSnap.data().orgs || []) : [];

      // 2. 레코드 로드
      const recSnap = await getDocs(collection(db, 'cloud_lists', orgRptCity, 'months', monthId, 'records'));
      const allRecs = recSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 3. 행정동 → 소속사 매핑
      const dongToOrg = {};
      orgs.forEach(org => {
        (org.dongs || []).forEach(d => { dongToOrg[d] = org; });
      });

      // 4. 각 레코드에 소속사 할당
      const getQty = (r) => parseInt(r.포수 || r['수량(포수)'] || 1) || 1;
      const isSupp = (r) => (r.구분 || '') === '차상위';

      // 5. 소속사별 행정동별 집계
      const orgDongMap = {}; // orgId → dongName → { supp, bas, total }
      const unassigned = [];
      allRecs.forEach(r => {
        const dong = (r.행정동 || '').trim();
        const org = dongToOrg[dong];
        const qty = getQty(r);
        const suppQty = isSupp(r) ? qty : 0;
        const basQty = isSupp(r) ? 0 : qty;
        if (org) {
          if (!orgDongMap[org.id]) orgDongMap[org.id] = {};
          if (!orgDongMap[org.id][dong]) orgDongMap[org.id][dong] = { supp: 0, bas: 0, total: 0 };
          orgDongMap[org.id][dong].supp += suppQty;
          orgDongMap[org.id][dong].bas += basQty;
          orgDongMap[org.id][dong].total += qty;
        } else {
          unassigned.push(r);
        }
      });

      // ── 소속사 없는 경우: 행정동 집계 + 전체명단 2시트 ──
      if (orgs.length === 0) {
        const wb = XLSX.utils.book_new();
        const getQty2 = (r) => parseInt(r.포수 || r['수량(포수)'] || 1) || 1;
        const isSupp2 = (r) => (r.구분 || '') === '차상위';

        // 행정동별 집계
        const dongMap = {};
        allRecs.forEach(r => {
          const d = (r.행정동 || '미분류').trim();
          const qty = getQty2(r);
          if (!dongMap[d]) dongMap[d] = { bas: 0, supp: 0, total: 0 };
          if (isSupp2(r)) dongMap[d].supp += qty; else dongMap[d].bas += qty;
          dongMap[d].total += qty;
        });
        const sortedDongs = Object.keys(dongMap).sort((a, b) => a.localeCompare(b, 'ko'));
        let gBas = 0, gSupp = 0, gTotal = 0;
        const sumAoa = [['행정동', '수급자(포)', '차상위(포)', '전체(포)']];
        sortedDongs.forEach(d => {
          const { bas, supp, total } = dongMap[d];
          sumAoa.push([d, bas, supp, total]);
          gBas += bas; gSupp += supp; gTotal += total;
        });
        sumAoa.push(['합계', gBas, gSupp, gTotal]);
        const sumWs = XLSX.utils.aoa_to_sheet(sumAoa);
        sumWs['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, sumWs, '행정동집계');

        // 전체명단
        const sorted2 = [...allRecs].sort((a, b) => {
          const da = a.행정동 || '', db2 = b.행정동 || '';
          if (da !== db2) return da.localeCompare(db2, 'ko');
          const sa = parseInt(a.배송순번) || 9999, sb = parseInt(b.배송순번) || 9999;
          if (sa !== sb) return sa - sb;
          return (a.이름 || '').localeCompare(b.이름 || '', 'ko');
        });
        const allAoa = [['번호', '구분', '이름', '생년월일', '행정동', '주소', '휴대폰', '유선전화', '문자수신', '포수', '품명', '특이사항', '기사', '배송순번']];
        sorted2.forEach((r, i) => {
          allAoa.push([i + 1, r.구분 || '', r.이름 || '', r.생년월일 || '', r.행정동 || '',
            r.주소 || '', r.휴대폰 || '', r.유선전화 || '', r.문자수신 || '',
            getQty2(r), r.품명 || '', r.특이사항 || '', r.기사 || '', r.배송순번 || '']);
        });
        const allWs = XLSX.utils.aoa_to_sheet(allAoa);
        allWs['!cols'] = [{ wch: 5 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 14 },
          { wch: 35 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 7 }];
        XLSX.utils.book_append_sheet(wb, allWs, '전체명단');

        const ts = new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/\. /g, '').replace('.', '');
        XLSX.writeFile(wb, `${orgRptCity}_${monthId}_행정동집계_${ts}.xlsx`);
        return;
      }

      // ── 워크북 생성 ──
      const wb = XLSX.utils.book_new();
      const s = (v, bold, bg, align, sz) => ({
        v, t: typeof v === 'number' ? 'n' : 's',
        s: {
          font: { bold: !!bold, sz: sz || 10, name: '맑은 고딕' },
          fill: bg ? { fgColor: { rgb: bg } } : undefined,
          alignment: { horizontal: align || 'left', vertical: 'center', wrapText: true },
          border: {
            top: { style: 'thin', color: { rgb: 'CCCCCC' } },
            bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
            left: { style: 'thin', color: { rgb: 'CCCCCC' } },
            right: { style: 'thin', color: { rgb: 'CCCCCC' } },
          },
        },
      });

      // ── [시트1] 전체 집계표 ──
      const summaryRows = [
        [s('소속사', true, 'E8F0FE', 'center', 11), s('행정동', true, 'E8F0FE', 'center', 11),
         s('수급자(포)', true, 'E8F0FE', 'center', 11), s('차상위(포)', true, 'E8F0FE', 'center', 11),
         s('전체(포)', true, 'E8F0FE', 'center', 11)],
      ];

      let grandBas = 0, grandSupp = 0, grandTotal = 0;

      orgs.forEach(org => {
        const dongData = orgDongMap[org.id] || {};
        // 해당 소속사 행정동 순서: org.dongs 순서 기준
        const validDongs = (org.dongs || []).filter(d => dongData[d]);
        let orgBas = 0, orgSupp = 0, orgTotal = 0;

        validDongs.forEach(dong => {
          const { bas, supp, total } = dongData[dong];
          summaryRows.push([
            s(org.name, false, null, 'center'),
            s(dong, false, null, 'left'),
            s(bas, false, null, 'center'),
            s(supp, false, null, 'center'),
            s(total, false, null, 'center'),
          ]);
          orgBas += bas; orgSupp += supp; orgTotal += total;
        });

        // 소속사 소계
        if (validDongs.length > 0) {
          summaryRows.push([
            s(`${org.name} 소계`, true, 'EEF2FF', 'center'),
            s('', true, 'EEF2FF'),
            s(orgBas, true, 'EEF2FF', 'center'),
            s(orgSupp, true, 'EEF2FF', 'center'),
            s(orgTotal, true, 'EEF2FF', 'center'),
          ]);
        }
        grandBas += orgBas; grandSupp += orgSupp; grandTotal += orgTotal;
      });

      // 미배정 행정동이 있으면 추가
      if (unassigned.length > 0) {
        const unDongMap = {};
        unassigned.forEach(r => {
          const d = (r.행정동 || '미분류').trim();
          const qty = getQty(r);
          if (!unDongMap[d]) unDongMap[d] = { bas: 0, supp: 0, total: 0 };
          if (isSupp(r)) unDongMap[d].supp += qty; else unDongMap[d].bas += qty;
          unDongMap[d].total += qty;
        });
        let uBas = 0, uSupp = 0, uTotal = 0;
        Object.entries(unDongMap).forEach(([dong, v]) => {
          summaryRows.push([s('미배정', false, 'FFF3CD', 'center'), s(dong), s(v.bas, false, 'FFF3CD', 'center'), s(v.supp, false, 'FFF3CD', 'center'), s(v.total, false, 'FFF3CD', 'center')]);
          uBas += v.bas; uSupp += v.supp; uTotal += v.total;
        });
        summaryRows.push([s('미배정 소계', true, 'FFF3CD', 'center'), s('', true, 'FFF3CD'), s(uBas, true, 'FFF3CD', 'center'), s(uSupp, true, 'FFF3CD', 'center'), s(uTotal, true, 'FFF3CD', 'center')]);
        grandBas += uBas; grandSupp += uSupp; grandTotal += uTotal;
      }

      // 전체 합계
      summaryRows.push([
        s('전체 합계', true, '1E40AF', 'center', 12),
        s('', true, '1E40AF'),
        s(grandBas, true, '1E40AF', 'center', 12),
        s(grandSupp, true, '1E40AF', 'center', 12),
        s(grandTotal, true, '1E40AF', 'center', 12),
      ]);

      // 합계 행 폰트색 흰색으로
      const lastRow = summaryRows[summaryRows.length - 1];
      lastRow.forEach(cell => { if (cell.s?.font) cell.s.font.color = { rgb: 'FFFFFF' }; });

      const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows.map(row => row.map(c => c.v)));
      // 셀 스타일 적용 (xlsx-js-style 없이 기본 xlsx로 처리)
      summaryWs['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, summaryWs, '전체집계');

      // ── [시트2] 전체명단 ──
      const makeRecSheet = (recs) => {
        const sorted = [...recs].sort((a, b) => {
          const da = (a.행정동 || ''), db = (b.행정동 || '');
          if (da !== db) return da.localeCompare(db, 'ko');
          const sa = parseInt(a.배송순번) || 9999, sb = parseInt(b.배송순번) || 9999;
          if (sa !== sb) return sa - sb;
          return (a.이름 || '').localeCompare(b.이름 || '', 'ko');
        });
        const aoa = [['번호', '구분', '이름', '생년월일', '행정동', '주소', '휴대폰', '유선전화', '문자수신', '포수', '품명', '특이사항', '기사', '배송순번']];
        sorted.forEach((r, i) => {
          aoa.push([i + 1, r.구분 || '', r.이름 || '', r.생년월일 || '', r.행정동 || '',
            r.주소 || '', r.휴대폰 || '', r.유선전화 || '', r.문자수신 || '',
            getQty(r), r.품명 || '', r.특이사항 || '', r.기사 || '', r.배송순번 || '']);
        });
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 5 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 14 },
          { wch: 35 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 7 }];
        return ws;
      };

      XLSX.utils.book_append_sheet(wb, makeRecSheet(allRecs), '전체명단');

      // ── [시트3~] 소속사별 명단 시트 ──
      const orgSheetOrder = [...orgs];
      if (unassigned.length > 0) orgSheetOrder.push({ id: '__unassigned__', name: '미배정', dongs: [] });

      orgSheetOrder.forEach(org => {
        const recs = org.id === '__unassigned__'
          ? unassigned
          : allRecs.filter(r => dongToOrg[(r.행정동 || '').trim()]?.id === org.id);
        if (recs.length === 0) return;
        const sheetName = (org.name + '명단').slice(0, 30);
        XLSX.utils.book_append_sheet(wb, makeRecSheet(recs), sheetName);
      });

      // ── 파일 저장 ──
      const ts = new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/\. /g, '').replace('.', '');
      const fileName = `${orgRptCity}_${monthId}_소속사집계_${ts}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      alert('집계 추출 실패: ' + e.message);
      console.error(e);
    } finally {
      setOrgRptExporting(false);
    }
  };

  const TABS = [
    { id: 'merger', label: '시트 병합',    icon: <GitMerge size={14} /> },
    { id: 'dedup',  label: '중복 정리',    icon: <Trash2 size={14} /> },
    { id: 'clean',  label: '찌꺼기 삭제',  icon: <Sparkles size={14} /> },
    { id: 'dong',   label: '행정동 분리',  icon: <SplitSquareHorizontal size={14} /> },
    { id: 'remap',     label: '컬럼 재배치',  icon: <SlidersHorizontal size={14} /> },
    { id: 'filemerge', label: '파일 합치기',  icon: <Combine size={14} /> },
    { id: 'match',     label: 'DATA 매칭',    icon: <Shuffle size={14} /> },
    { id: 'format',    label: '스타일 서식',  icon: <Palette size={14} /> },
    { id: 'orgReport', label: '소속사전용',   icon: <Building2 size={14} /> },
    { id: 'audit',     label: '이력 관리',    icon: <History size={14} /> },
  ];

  const hasDedup = dedupResult && (
    dedupResult.strongGroups.length > 0 ||
    dedupResult.weakGroups.length > 0 ||
    (dedupResult.noNoteRows?.length ?? 0) > 0
  );
  const contentH = (activeTab === 'dedup' && dedupResult) || (activeTab === 'dong' && dongResult) || (activeTab === 'remap' && remapStep >= 2) || (activeTab === 'filemerge' && mergeStep >= 2) || (activeTab === 'match' && matchStep >= 2) || activeTab === 'format' ? 'h-[640px]' : 'h-[520px]';

  return (
    <div className="absolute inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#111] border border-gray-700 rounded-3xl w-full max-w-4xl flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="px-7 py-5 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
          <h2 className="text-2xl font-black text-white flex items-center gap-3">
            <Layers className="text-[#3b82f6]" size={24} /> 부가 서비스
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        <div className={`flex ${contentH} transition-all duration-300`}>
          {/* Sidebar */}
          <div className="w-52 border-r border-gray-800 bg-black/30 p-4 flex flex-col gap-2">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`w-full text-left px-4 py-3 rounded-xl font-bold text-sm transition-colors flex items-center gap-2.5
                  ${activeTab === t.id ? 'bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30' : 'text-gray-400 hover:bg-gray-800'}`}
              >
                {t.icon} {t.label}
              </button>
            ))}
            <div className="mt-auto"><p className="text-[10px] text-gray-700 text-center">추가 기능 업데이트 예정</p></div>
          </div>

          {/* Content */}
          <div className="flex-1 p-7 overflow-y-auto flex flex-col">

            {/* ── 시트 병합 ── */}
            {activeTab === 'merger' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <h3 className="text-lg font-bold text-white mb-1">여러 시트를 하나로 합치기</h3>
                <p className="text-sm text-gray-400 mb-5">엑셀 파일 내 모든 시트를 단일 통합시트로 병합합니다.</p>
                <div className="space-y-4">
                  <label className={`w-full py-7 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${mergerFile ? 'border-[#3b82f6] bg-[#3b82f6]/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                    <Upload size={28} className={mergerFile ? 'text-[#3b82f6] mb-2' : 'text-gray-500 mb-2'} />
                    <span className={`font-bold text-sm ${mergerFile ? 'text-[#3b82f6]' : 'text-gray-400'}`}>
                      {mergerFile ? mergerFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                    </span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleMergerUpload} className="hidden" />
                  </label>
                  {mergerFile && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-400">저장 파일 이름</label>
                      <input value={mergerFileName} onChange={e => setMergerFileName(e.target.value)}
                        className="w-full bg-[#0a0a0a] border border-gray-700 rounded-xl px-4 py-2.5 text-white outline-none focus:border-[#3b82f6] font-bold text-sm" />
                    </div>
                  )}
                  <button onClick={executeMerge} disabled={!mergerFile || isMerging}
                    className="w-full py-3.5 bg-[#3b82f6] text-black font-extrabold rounded-xl hover:bg-[#93c5fd] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {isMerging ? '병합 중...' : <><Download size={16} /> 병합 및 다운로드</>}
                  </button>
                </div>
              </div>
            )}

            {/* ── 중복 데이터 정리 ── */}
            {activeTab === 'dedup' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-white">중복 데이터 정리</h3>
                  {dedupResult && (
                    <button onClick={resetDedup} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>
                  )}
                </div>
                <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                  이름+생년월일+전화 <span className="text-red-400 font-bold">(강한)</span> 또는 행정동+이름+전화 <span className="text-yellow-400 font-bold">(약한)</span> 중복을 탐지하고 직접 선택하여 정리합니다.
                </p>

                {/* 업로드 & 분석 */}
                {!dedupResult && (
                  <div className="space-y-4">
                    <label className={`w-full py-6 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${dedupFile ? 'border-purple-500 bg-purple-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                      <Upload size={26} className={dedupFile ? 'text-purple-400 mb-2' : 'text-gray-500 mb-2'} />
                      <span className={`font-bold text-sm ${dedupFile ? 'text-purple-400' : 'text-gray-400'}`}>
                        {dedupFile ? dedupFile.name : '엑셀 파일 선택'}
                      </span>
                      <input type="file" accept=".xlsx,.xls" onChange={handleDedupUpload} className="hidden" />
                    </label>
                    <button onClick={runAnalysis} disabled={!dedupFile || isAnalyzing}
                      className="w-full py-3.5 bg-purple-600 hover:bg-purple-500 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all">
                      {isAnalyzing ? '분석 중...' : <><GitMerge size={16} /> 중복 분석 시작</>}
                    </button>
                  </div>
                )}

                {/* 결과 */}
                {dedupResult && (
                  <>
                    {/* 요약 카드 */}
                    <div className="grid grid-cols-5 gap-2 mb-3">
                      {[
                        { label: '전체 행', val: dedupResult.totalRows, color: 'border-gray-700', tc: 'text-white' },
                        { label: '강한 중복', val: `${dedupResult.strongGroups.length}그룹`, color: 'border-red-800/40', tc: 'text-red-400' },
                        { label: '약한 중복', val: `${dedupResult.weakGroups.length}그룹`, color: 'border-yellow-800/40', tc: 'text-yellow-400' },
                        { label: '특이사항없음', val: `${dedupResult.noNoteRows?.length ?? 0}건`, color: 'border-orange-800/40', tc: 'text-orange-400' },
                        { label: '삭제 예정', val: `${deleteRowNums.size}건`, color: 'border-purple-800/40', tc: 'text-purple-400' },
                      ].map(c => (
                        <div key={c.label} className={`bg-black/40 border ${c.color} rounded-xl p-3 text-center`}>
                          <div className={`text-xl font-black ${c.tc}`}>{c.val}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{c.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* 서브탭 */}
                    {!hasDedup ? (
                      <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-500 text-sm font-bold">
                        중복 데이터가 없습니다 🎉
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-2 mb-3 flex-wrap">
                          <button onClick={() => setDedupSubTab('strong')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${dedupSubTab === 'strong' ? 'bg-red-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                            강한 중복 ({dedupResult.strongGroups.length})
                          </button>
                          <button onClick={() => setDedupSubTab('weak')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${dedupSubTab === 'weak' ? 'bg-yellow-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                            약한 중복 ({dedupResult.weakGroups.length})
                          </button>
                          <button onClick={() => setDedupSubTab('nonote')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${dedupSubTab === 'nonote' ? 'bg-orange-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                            특이사항 없음 ({dedupResult.noNoteRows?.length ?? 0})
                          </button>
                        </div>

                        {/* 그룹/행 목록 */}
                        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                          {dedupSubTab === 'nonote' ? (
                            (dedupResult.noNoteRows?.length ?? 0) === 0 ? (
                              <div className="h-20 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-600 text-xs font-bold">
                                특이사항 없는 행이 없습니다 🎉
                              </div>
                            ) : (
                              <div className="border border-gray-800 rounded-xl overflow-hidden">
                                <div className="px-3 py-2 bg-orange-950/30 flex items-center justify-between">
                                  <span className="text-xs font-bold text-orange-300">특이사항 없는 행 — {dedupResult.noNoteRows.length}건 (중복 제외)</span>
                                  <button
                                    onClick={() => {
                                      const allChecked = dedupResult.noNoteRows.every(r => deleteRowNums.has(r._rowNum));
                                      setDeleteRowNums(prev => {
                                        const next = new Set(prev);
                                        dedupResult.noNoteRows.forEach(r => allChecked ? next.delete(r._rowNum) : next.add(r._rowNum));
                                        return next;
                                      });
                                    }}
                                    className="text-[10px] font-bold px-2 py-0.5 rounded text-orange-400 hover:text-orange-300 transition-colors"
                                  >
                                    {dedupResult.noNoteRows.every(r => deleteRowNums.has(r._rowNum)) ? '전체 해제' : '전체 선택'}
                                  </button>
                                </div>
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-gray-800 bg-black/20 text-gray-500">
                                      <th className="px-3 py-2 w-16 text-center">삭제</th>
                                      <th className="px-3 py-2 w-10 text-left">행#</th>
                                      <th className="px-3 py-2 text-left">이름</th>
                                      <th className="px-3 py-2 text-left">생년월일</th>
                                      <th className="px-3 py-2 text-left">전화번호</th>
                                      <th className="px-3 py-2 text-left">행정동</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dedupResult.noNoteRows.map(row => {
                                      const isChecked = deleteRowNums.has(row._rowNum);
                                      return (
                                        <tr key={row._rowNum} onClick={() => toggleRow(row._rowNum)}
                                          className={`border-b border-gray-900 cursor-pointer transition-colors
                                            ${isChecked ? 'bg-orange-950/25 hover:bg-orange-950/35' : 'bg-black/10 hover:bg-black/20'}`}>
                                          <td className="px-3 py-2 text-center">
                                            {isChecked
                                              ? <CheckSquare size={16} className="text-orange-400 mx-auto" />
                                              : <Square size={16} className="text-gray-600 mx-auto" />
                                            }
                                          </td>
                                          <td className="px-3 py-2 text-gray-500 font-mono">{row._rowNum}</td>
                                          <td className="px-3 py-2 text-white font-bold">{row.name}</td>
                                          <td className="px-3 py-2 text-gray-300">{row.birth}</td>
                                          <td className="px-3 py-2 text-gray-300">{fmtPhone(row.phone)}</td>
                                          <td className="px-3 py-2 text-gray-400">{row.dong}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )
                          ) : (dedupSubTab === 'strong' ? dedupResult.strongGroups : dedupResult.weakGroups).length === 0 ? (
                            <div className="h-20 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-xl text-gray-600 text-xs font-bold">
                              {dedupSubTab === 'strong' ? '강한 중복 없음' : '약한 중복 없음'}
                            </div>
                          ) : (
                            (dedupSubTab === 'strong' ? dedupResult.strongGroups : dedupResult.weakGroups).map((group, gi) => {
                              const allNonKeepChecked = group.rows.every((r, i) => i === group.keepIdx || deleteRowNums.has(r._rowNum));
                              return (
                                <div key={gi} className="border border-gray-800 rounded-xl overflow-hidden">
                                  {/* 그룹 헤더 */}
                                  <div className={`px-3 py-2 flex items-center justify-between ${dedupSubTab === 'strong' ? 'bg-red-950/30' : 'bg-yellow-950/30'}`}>
                                    <span className="text-xs font-bold text-gray-300">
                                      그룹 {gi + 1} — <span className="text-white">{group.rows[0].name}</span>
                                      {group.rows[0].phone && <span className="text-gray-400"> | {fmtPhone(group.rows[0].phone)}</span>}
                                    </span>
                                    <button
                                      onClick={() => toggleGroup(group)}
                                      className={`text-[10px] font-bold px-2 py-0.5 rounded transition-colors ${allNonKeepChecked ? 'text-gray-400 hover:text-gray-200' : 'text-red-400 hover:text-red-300'}`}
                                    >
                                      {allNonKeepChecked ? '전체 해제' : '전체 선택'}
                                    </button>
                                  </div>
                                  {/* 행 테이블 */}
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b border-gray-800 bg-black/20 text-gray-500">
                                        <th className="px-3 py-2 w-16 text-center">삭제</th>
                                        <th className="px-3 py-2 w-10 text-left">행#</th>
                                        <th className="px-3 py-2 text-left">이름</th>
                                        <th className="px-3 py-2 text-left">생년월일</th>
                                        <th className="px-3 py-2 text-left">전화번호</th>
                                        <th className="px-3 py-2 text-left">행정동</th>
                                        <th className="px-3 py-2 text-left">특이사항</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.rows.map((row, ri) => {
                                        const isKeep = ri === group.keepIdx;
                                        const isChecked = deleteRowNums.has(row._rowNum);
                                        const hasNote = !!row.note;
                                        return (
                                          <tr key={row._rowNum} onClick={() => toggleRow(row._rowNum)}
                                            className={`border-b border-gray-900 cursor-pointer transition-colors
                                              ${isKeep ? 'bg-blue-950/20 hover:bg-blue-950/30' : isChecked ? 'bg-red-950/25 hover:bg-red-950/35' : 'bg-black/10 hover:bg-black/20'}`}>
                                            <td className="px-3 py-2 text-center">
                                              {isKeep
                                                ? <span className="text-xs bg-blue-900/50 text-blue-400 border border-blue-700/40 px-2 py-0.5 rounded font-bold">보존</span>
                                                : isChecked
                                                  ? <CheckSquare size={16} className="text-red-400 mx-auto" />
                                                  : <Square size={16} className="text-gray-600 mx-auto" />
                                              }
                                            </td>
                                            <td className="px-3 py-2 text-gray-500 font-mono">{row._rowNum}</td>
                                            <td className="px-3 py-2 text-white font-bold">{row.name}</td>
                                            <td className="px-3 py-2 text-gray-300">{row.birth}</td>
                                            <td className="px-3 py-2 text-gray-300">{fmtPhone(row.phone)}</td>
                                            <td className="px-3 py-2 text-gray-400">{row.dong}</td>
                                            <td className="px-3 py-2 max-w-[140px] truncate">
                                              {hasNote
                                                ? <span className="text-amber-300 font-medium" title={row.note}>{row.note}</span>
                                                : <span className="text-gray-700 text-xs">없음</span>
                                              }
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </>
                    )}

                    {/* 다운로드 */}
                    <div className="mt-3 pt-3 border-t border-gray-800">
                      <button onClick={exportDedup} disabled={deleteRowNums.size === 0 || isExporting}
                        className="w-full py-3 bg-[#3b82f6] hover:bg-[#93c5fd] text-black font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all text-sm">
                        {isExporting ? '처리 중...' : <><Download size={16} /> {deleteRowNums.size}건 삭제 후 다운로드 (정제본 + 삭제목록 시트)</>}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── 찌꺼기 삭제 ── */}
            {activeTab === 'clean' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2"><Sparkles size={18} className="text-blue-400" /> 찌꺼기 데이터 삭제</h3>
                  {cleanResult && <button onClick={resetClean} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>}
                </div>
                <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                  빈 행, 유령 열, 숨겨진 행/열, 빈 시트를 제거하여 파일 크기를 최소화합니다.
                </p>

                {/* 업로드 */}
                {!cleanResult && (
                  <div className="space-y-4">
                    <label className={`w-full py-7 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${cleanFile ? 'border-blue-500 bg-blue-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                      <Upload size={28} className={cleanFile ? 'text-blue-400 mb-2' : 'text-gray-500 mb-2'} />
                      <span className={`font-bold text-sm ${cleanFile ? 'text-blue-400' : 'text-gray-400'}`}>
                        {cleanFile ? cleanFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                      </span>
                      <input type="file" accept=".xlsx,.xls" onChange={handleCleanUpload} className="hidden" />
                    </label>
                    <button onClick={runCleanAnalysis} disabled={!cleanFile || isAnalyzingClean}
                      className="w-full py-3.5 bg-blue-700 hover:bg-blue-600 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all">
                      {isAnalyzingClean ? '분석 중...' : <><Sparkles size={16} /> 찌꺼기 분석 시작</>}
                    </button>
                  </div>
                )}

                {/* 분석 결과 */}
                {cleanResult && (
                  <>
                    {/* Before / After 카드 */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-red-950/20 border border-red-800/40 rounded-xl p-4 text-center">
                        <div className="text-xs text-red-400 font-black mb-1">원본 파일 크기</div>
                        <div className="text-2xl font-black text-red-300">{fmtSize(cleanResult.originalSize)}</div>
                      </div>
                      <div className="bg-blue-950/20 border border-blue-800/40 rounded-xl p-4 text-center">
                        <div className="text-xs text-blue-400 font-black mb-1">정제 후 예상 크기</div>
                        <div className="text-2xl font-black text-blue-300">크게 감소 ↓</div>
                      </div>
                    </div>

                    {/* 제거 항목 요약 */}
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {[
                        { label: '빈 행', val: cleanResult.totalEmptyRows, icon: '🗑', color: 'text-red-400', border: 'border-red-800/40' },
                        { label: '유령 열', val: cleanResult.totalGhostCols, icon: '👻', color: 'text-orange-400', border: 'border-orange-800/40' },
                        { label: '숨김 행', val: cleanResult.totalHiddenRows, icon: '🙈', color: 'text-yellow-400', border: 'border-yellow-800/40' },
                        { label: '숨김 열', val: cleanResult.totalHiddenCols, icon: '🙈', color: 'text-yellow-400', border: 'border-yellow-800/40' },
                        { label: '빈 시트', val: cleanResult.emptySheets, icon: '📄', color: 'text-gray-400', border: 'border-gray-700' },
                        { label: '처리 시트', val: cleanResult.sheets?.length ?? 0, icon: '📊', color: 'text-blue-400', border: 'border-blue-800/40' },
                      ].map(c => (
                        <div key={c.label} className={`bg-black/40 border ${c.border} rounded-xl p-2.5 text-center`}>
                          <div className={`text-lg font-black ${c.color}`}>{c.val}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{c.icon} {c.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* 시트별 상세 */}
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 mb-3">
                      {cleanResult.sheets?.map((s, i) => (
                        <div key={i} className={`border rounded-xl p-3 ${s.isEmptySheet ? 'border-red-800/40 bg-red-950/10' : 'border-gray-800 bg-black/20'}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-white flex items-center gap-2">
                              {s.isEmptySheet ? <FileX size={14} className="text-red-400" /> : <Sparkles size={14} className="text-blue-400" />}
                              {s.sheetName}
                              {s.isEmptySheet && <span className="text-[10px] text-red-400 font-black bg-red-900/30 px-1.5 py-0.5 rounded">빈 시트 — 삭제됨</span>}
                            </span>
                            <span className="text-xs text-gray-500">{s.totalRows}행</span>
                          </div>
                          {!s.isEmptySheet && (
                            <div className="flex gap-3 mt-2 flex-wrap">
                              {s.innerEmptyRows > 0 && <span className="text-[10px] text-red-400">빈 행 {s.innerEmptyRows}개</span>}
                              {s.trailingRows > 0 && <span className="text-[10px] text-orange-400">트레일링 {s.trailingRows}행</span>}
                              {s.ghostCols > 0 && <span className="text-[10px] text-yellow-400">유령 열 {s.ghostCols}개</span>}
                              {s.hiddenRows > 0 && <span className="text-[10px] text-gray-400">숨김 행 {s.hiddenRows}개</span>}
                              {s.hiddenCols > 0 && <span className="text-[10px] text-gray-400">숨김 열 {s.hiddenCols}개</span>}
                              {s.innerEmptyRows === 0 && s.trailingRows === 0 && s.ghostCols === 0 && s.hiddenRows === 0 && s.hiddenCols === 0 &&
                                <span className="text-[10px] text-blue-400">찌꺼기 없음 ✓</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 다운로드 */}
                    <div className="pt-3 border-t border-gray-800">
                      <button onClick={exportClean} disabled={isExportingClean}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all text-sm">
                        {isExportingClean ? '처리 중...' : <><Download size={16} /> 찌꺼기 제거 후 다운로드</>}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── 행정동 분리 ── */}
            {activeTab === 'dong' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <SplitSquareHorizontal size={18} className="text-teal-400" /> 행정동별 분리 내보내기
                  </h3>
                  {dongResult && <button onClick={resetDong} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>}
                </div>
                <p className="text-sm text-gray-400 mb-4 leading-relaxed">
                  엑셀 파일을 업로드하면 <span className="text-teal-400 font-bold">행정동별 시트</span>로 분리된 파일을 자동 생성합니다. 요약표·합본·구분 분리 옵션을 선택하세요.
                </p>

                {/* 업로드 */}
                {!dongResult && (
                  <div className="space-y-4">
                    <label className={`w-full py-7 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${dongFile ? 'border-teal-500 bg-teal-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                      {isAnalyzingDong
                        ? <RefreshCw size={28} className="text-teal-400 mb-2 animate-spin" />
                        : <Upload size={28} className={dongFile ? 'text-teal-400 mb-2' : 'text-gray-500 mb-2'} />
                      }
                      <span className={`font-bold text-sm ${dongFile ? 'text-teal-400' : 'text-gray-400'}`}>
                        {isAnalyzingDong ? '분석 중...' : dongFile ? dongFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                      </span>
                      <input type="file" accept=".xlsx,.xls" onChange={handleDongUpload} className="hidden" disabled={isAnalyzingDong} />
                    </label>
                  </div>
                )}

                {/* 분석 결과 */}
                {dongResult && (
                  <>
                    {/* 자동 감지 요약 */}
                    <div className="flex gap-2 mb-3 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-black border bg-black/40 border-teal-700/40 text-teal-400">
                        총 {dongResult.totalRows.toLocaleString()}건
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${dongResult.hasDong ? 'bg-black/40 border-blue-700/40 text-blue-400' : 'bg-red-950/30 border-red-700/40 text-red-400'}`}>
                        행정동 {dongResult.hasDong ? '✓ 감지됨' : '✗ 미감지'}
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${dongResult.hasGubun ? 'bg-black/40 border-blue-700/40 text-blue-400' : 'bg-black/40 border-gray-700 text-gray-600'}`}>
                        구분(수급/차상위) {dongResult.hasGubun ? '✓ 감지됨' : '미감지'}
                      </span>
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-black border bg-black/40 border-gray-700 text-gray-500">
                        시트: {dongResult.sheetName}
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
                      {/* 행정동 분포 테이블 */}
                      <div className="border border-gray-800 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 bg-teal-950/30 flex items-center justify-between">
                          <span className="text-xs font-black text-teal-300">행정동 분포 ({dongResult.dongStats.length}개 동)</span>
                          <span className="text-[10px] text-gray-600">
                            합계 수급자 {dongResult.dongStats.reduce((s,d)=>s+d.su명,0)}명 / 차상위 {dongResult.dongStats.reduce((s,d)=>s+d.cha명,0)}명
                          </span>
                        </div>
                        <div className="max-h-[180px] overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-[#0d0d0d]">
                              <tr className="border-b border-gray-800 text-gray-600">
                                <th className="px-3 py-1.5 text-left font-black">행정동</th>
                                <th className="px-3 py-1.5 text-right font-black text-blue-500">수급자(명)</th>
                                <th className="px-3 py-1.5 text-right font-black text-blue-400">수급자(포)</th>
                                <th className="px-3 py-1.5 text-right font-black text-amber-500">차상위(명)</th>
                                <th className="px-3 py-1.5 text-right font-black text-amber-400">차상위(포)</th>
                                <th className="px-3 py-1.5 text-right font-black text-teal-400">합계(명)</th>
                                <th className="px-3 py-1.5 text-right font-black text-teal-300">합계(포)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dongResult.dongStats.map(d => (
                                <tr key={d.dong} className="border-b border-gray-900 hover:bg-teal-950/10 transition-colors">
                                  <td className="px-3 py-1.5 font-bold text-white">{d.dong}</td>
                                  <td className="px-3 py-1.5 text-right text-blue-400">{d.su명.toLocaleString()}</td>
                                  <td className="px-3 py-1.5 text-right text-blue-300">{d.su포.toLocaleString()}</td>
                                  <td className="px-3 py-1.5 text-right text-amber-400">{d.cha명.toLocaleString()}</td>
                                  <td className="px-3 py-1.5 text-right text-amber-300">{d.cha포.toLocaleString()}</td>
                                  <td className="px-3 py-1.5 text-right font-black text-teal-400">{d.total명.toLocaleString()}</td>
                                  <td className="px-3 py-1.5 text-right font-black text-teal-300">{d.total포.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* 컬럼 선택 */}
                      <div className="border border-gray-800 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 bg-gray-900/50 flex items-center justify-between">
                          <span className="text-xs font-black text-gray-300">포함할 컬럼 선택 ({selectedColIdxs.length}/{dongResult.headers.length})</span>
                          <div className="flex gap-2">
                            <button onClick={() => setSelectedColIdxs(dongResult.headers.map((_, i) => i))} className="text-[10px] text-blue-400 hover:text-blue-300 font-bold transition-colors">전체 선택</button>
                            <button onClick={() => setSelectedColIdxs([])} className="text-[10px] text-gray-500 hover:text-gray-300 font-bold transition-colors">전체 해제</button>
                          </div>
                        </div>
                        <div className="p-3 flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto">
                          {dongResult.headers.map((h, i) => {
                            const isKey = Object.values(dongResult.colMap).includes(i);
                            const isSel = selectedColIdxs.includes(i);
                            return (
                              <button key={i} onClick={() => toggleColIdx(i)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                                  isSel
                                    ? isKey ? 'bg-teal-900/40 border-teal-600/50 text-teal-300' : 'bg-blue-900/30 border-blue-700/40 text-blue-400'
                                    : 'bg-black/30 border-gray-800 text-gray-600 hover:border-gray-600'
                                }`}
                              >
                                {isSel ? '✓ ' : ''}{h || `열${i+1}`}
                                {isKey && <span className="ml-1 text-[8px] opacity-60">●</span>}
                              </button>
                            );
                          })}
                        </div>
                        <p className="px-3 pb-2 text-[10px] text-gray-700">● 핵심 컬럼(자동 감지됨)</p>
                      </div>

                      {/* 옵션 */}
                      <div className="border border-gray-800 rounded-xl p-3 space-y-2">
                        <p className="text-xs font-black text-gray-400 mb-2">내보내기 옵션</p>
                        {[
                          { key: 'includeSummary', label: '요약 시트 포함', desc: '행정동별 수급자/차상위/합계 집계표' },
                          { key: 'includeAll',     label: '합본 시트 포함', desc: '전체 명단을 하나의 시트로' },
                          { key: 'splitGubun',     label: '구분별 분리',    desc: '각 행정동 내에서 기초수급자/차상위 시트 분리' },
                          { key: 'sortRows',       label: '자동 정렬',      desc: '행정동 > 주소 > 이름 순으로 정렬' },
                        ].map(opt => (
                          <label key={opt.key} className="flex items-center gap-3 cursor-pointer group">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${dongOptions[opt.key] ? 'bg-teal-500 border-teal-500' : 'border-gray-600 group-hover:border-gray-400'}`}
                              onClick={() => setDongOptions(p => ({ ...p, [opt.key]: !p[opt.key] }))}>
                              {dongOptions[opt.key] && <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                            </div>
                            <div>
                              <span className="text-xs font-bold text-white">{opt.label}</span>
                              <span className="text-[10px] text-gray-600 ml-2">{opt.desc}</span>
                            </div>
                          </label>
                        ))}
                      </div>

                      {/* 파일명 */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500">저장 파일 이름</label>
                        <input value={dongFileName} onChange={e => setDongFileName(e.target.value)}
                          className="w-full bg-[#0a0a0a] border border-gray-700 rounded-xl px-4 py-2 text-white outline-none focus:border-teal-500 font-bold text-sm" />
                      </div>
                    </div>

                    {/* 다운로드 */}
                    <div className="mt-3 pt-3 border-t border-gray-800 shrink-0">
                      <button onClick={exportDongSplit} disabled={isExportingDong || !selectedColIdxs.length || !dongResult.hasDong}
                        className="w-full py-3 bg-teal-600 hover:bg-teal-500 text-white font-extrabold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all text-sm">
                        {isExportingDong
                          ? <><RefreshCw size={15} className="animate-spin" /> 생성 중...</>
                          : <><Download size={15} /> {dongResult.dongStats.length}개 행정동 분리 다운로드</>
                        }
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── 컬럼 재배치 ── */}
            {activeTab === 'remap' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <SlidersHorizontal size={18} className="text-indigo-400" /> 컬럼 재배치
                  </h3>
                  {remapStep >= 2 && <button onClick={resetRemap} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>}
                </div>
                <p className="text-sm text-gray-400 mb-3 leading-relaxed">
                  어떤 형식의 엑셀이든 <span className="text-indigo-400 font-bold">14개 표준 컬럼</span>으로 재배치합니다. 전화번호·생년월일·수급구분 자동 정규화, 여러 시트 합산 지원.
                </p>

                {/* Step indicator */}
                <div className="flex items-center gap-1 mb-4">
                  {['파일 업로드', '컬럼 매핑', '미리보기'].map((label, idx) => {
                    const step = idx + 1;
                    const isActive = remapStep === step;
                    const isDone = remapStep > step;
                    return (
                      <div key={step} className="flex items-center gap-1">
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black transition-colors
                          ${isActive ? 'bg-indigo-900/40 border border-indigo-700/50 text-indigo-300' : isDone ? 'text-gray-500 border border-transparent' : 'text-gray-700 border border-transparent'}`}>
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${isActive ? 'bg-indigo-500 text-black' : isDone ? 'bg-gray-700 text-gray-400' : 'bg-gray-800 text-gray-600'}`}>
                            {isDone ? '✓' : step}
                          </span>
                          {label}
                        </div>
                        {idx < 2 && <ArrowRight size={10} className="text-gray-700 shrink-0" />}
                      </div>
                    );
                  })}
                </div>

                {/* Step 1 — Upload */}
                {remapStep === 1 && (
                  <label className={`w-full py-10 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${remapFile && !isAnalyzingRemap ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                    {isAnalyzingRemap
                      ? <RefreshCw size={28} className="text-indigo-400 mb-2 animate-spin" />
                      : <Upload size={28} className={remapFile ? 'text-indigo-400 mb-2' : 'text-gray-500 mb-2'} />
                    }
                    <span className={`font-bold text-sm ${remapFile ? 'text-indigo-400' : 'text-gray-400'}`}>
                      {isAnalyzingRemap ? '컬럼 자동 분석 중...' : remapFile ? remapFile.name : '이곳을 클릭하여 엑셀 파일 선택'}
                    </span>
                    <span className="text-[10px] text-gray-600 mt-1">형식 무관 · .xlsx / .xls · 여러 시트 합산 가능</span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleRemapUpload} className="hidden" disabled={isAnalyzingRemap} />
                  </label>
                )}

                {/* Step 2 — Mapping */}
                {remapStep === 2 && remapResult && (
                  <>
                    {/* Sheet selector — 항상 표시 */}
                    <div className="mb-3 bg-black/20 border border-gray-800 rounded-xl p-3">
                      <p className="text-[10px] font-black text-gray-400 mb-2">시트 선택</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[9px] text-indigo-500 font-black mb-1.5">★ 매핑 기준 시트 (헤더·샘플 출처)</p>
                          <div className="flex gap-1 flex-wrap">
                            {remapResult.sheets.map(s => {
                              const isBase = remapBaseSheet === s.name;
                              return (
                                <button key={s.name} onClick={() => switchRemapBaseSheet(s.name)}
                                  className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                                    isBase ? 'bg-indigo-900/50 border-indigo-500/60 text-indigo-200 shadow-[0_0_8px_rgba(99,102,241,0.3)]' : 'bg-black/30 border-gray-800 text-gray-600 hover:border-indigo-700/40 hover:text-gray-400'
                                  }`}>
                                  {isBase ? '★ ' : ''}{s.name} <span className="opacity-60">({s.rowCount.toLocaleString()}행)</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <p className="text-[9px] text-gray-500 font-black mb-1.5">✓ 내보낼 시트 (복수 선택 = 합산)</p>
                          <div className="flex gap-1 flex-wrap">
                            {remapResult.sheets.map(s => {
                              const checked = remapSelectedSheets.includes(s.name);
                              return (
                                <label key={s.name} className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold cursor-pointer transition-colors ${
                                  checked ? 'bg-indigo-900/30 border-indigo-700/40 text-indigo-300' : 'bg-black/30 border-gray-800 text-gray-600 hover:border-gray-600'
                                }`}>
                                  <input type="checkbox" checked={checked} onChange={() => toggleRemapSheet(s.name)} className="hidden" />
                                  {checked ? '✓ ' : ''}{s.name} <span className="opacity-60 ml-0.5">({s.rowCount.toLocaleString()}행)</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-black border bg-black/40 border-indigo-700/40 text-indigo-400">
                        기준: {(remapResult.sheets.find(s => s.name === remapBaseSheet)?.rowCount ?? remapResult.totalRows).toLocaleString()}건
                      </span>
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-black border bg-black/40 border-gray-700 text-gray-500">
                        원본 {remapActiveHeaders.length}개 컬럼
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border bg-black/40 ${
                        Object.values(remapMapping).filter(m => m.srcIdx !== -1).length >= 10
                          ? 'border-blue-700/40 text-blue-400' : 'border-yellow-700/40 text-yellow-400'
                      }`}>
                        {Object.values(remapMapping).filter(m => m.srcIdx !== -1).length} / {OUTPUT_COLS.length}개 매핑됨
                      </span>
                      {remapSelectedSheets.length > 1 && (
                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-black border bg-purple-900/20 border-purple-700/40 text-purple-400">
                          {remapSelectedSheets.length}개 시트 합산
                        </span>
                      )}
                    </div>

                    {/* Mapping table with reorder buttons */}
                    <div className="flex-1 overflow-y-auto min-h-0 border border-gray-800 rounded-xl">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-[#0d0d0d] z-10">
                          <tr className="border-b border-gray-800 text-gray-600">
                            <th className="px-1 py-2 w-[30px] text-center font-black">순서</th>
                            <th className="px-3 py-2 text-left font-black w-[100px]">출력 컬럼</th>
                            <th className="px-3 py-2 text-left font-black">원본 컬럼</th>
                            <th className="px-3 py-2 text-center font-black w-[58px]">신뢰도</th>
                            <th className="px-3 py-2 text-left font-black w-[100px]">샘플값</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const orderedCols = remapColOrder.map(key => OUTPUT_COLS.find(c => c.key === key)).filter(Boolean);
                            return orderedCols.map((col, ci) => {
                              const m = remapMapping[col.key] || { srcIdx: -1, confidence: 0 };
                              const sampleVal = getRemapSampleVal(col.key, m.srcIdx);
                              return (
                                <tr key={col.key} className={`border-b border-gray-900 ${ci % 2 === 0 ? 'bg-black/20' : 'bg-black/5'}`}>
                                  <td className="px-1 py-1 text-center">
                                    <div className="flex flex-col gap-0 items-center">
                                      <button onClick={() => moveRemapCol(col.key, 'up')} disabled={ci === 0}
                                        className="p-0.5 rounded hover:bg-indigo-900/40 text-gray-600 hover:text-indigo-300 disabled:opacity-20 transition-colors">
                                        <ArrowUp size={9} />
                                      </button>
                                      <button onClick={() => moveRemapCol(col.key, 'down')} disabled={ci === orderedCols.length - 1}
                                        className="p-0.5 rounded hover:bg-indigo-900/40 text-gray-600 hover:text-indigo-300 disabled:opacity-20 transition-colors">
                                        <ArrowDown size={9} />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className="font-black text-white text-[11px]">{col.label}</span>
                                    {col.transform && (
                                      <span className="ml-1 text-[8px] text-indigo-400 opacity-70">
                                        {col.transform === 'phone' ? '☎' : col.transform === 'birth' ? '📅' : 'Y/N'}
                                      </span>
                                    )}
                                    {col.special === 'autoSeq' && <span className="ml-1 text-[8px] text-blue-400 opacity-70">⚡</span>}
                                    {col.special === 'fromAddr' && <span className="ml-1 text-[8px] text-teal-400 opacity-70">🔍</span>}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <select
                                      value={String(m.srcIdx)}
                                      onChange={e => handleMappingChange(col.key, e.target.value)}
                                      className="w-full bg-[#0a0a0a] border border-gray-700 focus:border-indigo-500 rounded-lg px-2 py-1 text-white outline-none transition-all text-[11px]"
                                    >
                                      <option value="-1">(비어두기)</option>
                                      {col.special === 'autoSeq' && <option value="-3">⚡ 자동 생성 (1, 2, 3...)</option>}
                                      {col.special === 'fromAddr' && <option value="-2">🔍 주소에서 자동 추출</option>}
                                      {remapActiveHeaders.map((h, hi) => (
                                        <option key={hi} value={String(hi)}>{h || `열${hi+1}`}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    {m.srcIdx === -3
                                      ? <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-blue-900/30 border border-blue-700/40 text-blue-300">자동</span>
                                      : m.srcIdx === -2
                                      ? <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-teal-900/30 border border-teal-700/40 text-teal-300">추출</span>
                                      : m.srcIdx === -1
                                      ? <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-gray-900/30 border border-gray-700 text-gray-600">빈값</span>
                                      : m.confidence >= 85
                                      ? <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-blue-900/30 border border-blue-700/40 text-blue-400">{m.confidence}%</span>
                                      : m.confidence >= 72
                                      ? <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-yellow-900/30 border border-yellow-700/40 text-yellow-400">{m.confidence}%</span>
                                      : <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-orange-900/30 border border-orange-700/40 text-orange-400">{m.confidence}%</span>
                                    }
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <span className="text-gray-400 truncate block font-mono text-[10px] max-w-[90px]" title={String(sampleVal)}>
                                      {sampleVal !== '' && sampleVal !== undefined ? String(sampleVal) : <span className="text-gray-700">—</span>}
                                    </span>
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>

                    {/* File name + preview button */}
                    <div className="mt-3 pt-3 border-t border-gray-800 shrink-0 flex gap-2">
                      <input value={remapFileName} onChange={e => setRemapFileName(e.target.value)}
                        className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-xl px-3 py-2 text-white outline-none focus:border-indigo-500 font-bold text-xs" placeholder="저장 파일 이름" />
                      <button onClick={() => setRemapStep(3)}
                        className="px-5 py-2 bg-indigo-700 hover:bg-indigo-600 text-white font-extrabold rounded-xl text-xs transition-all flex items-center gap-1.5">
                        <Eye size={13} /> 미리보기
                      </button>
                    </div>
                  </>
                )}

                {/* Step 3 — Preview */}
                {remapStep === 3 && (
                  <>
                    <button onClick={() => setRemapStep(2)} className="text-sm text-gray-500 hover:text-gray-300 transition-colors mb-3 self-start flex items-center gap-1">
                      ← 매핑으로 돌아가기
                    </button>
                    <p className="text-[11px] text-gray-500 mb-2">
                      처음 5건 변환 결과 미리보기 · 전체 <span className="text-white font-bold">{remapResult?.totalRows?.toLocaleString()}건</span>
                      {remapSelectedSheets.length > 1 && <span className="text-purple-400 ml-1">({remapSelectedSheets.length}개 시트 합산)</span>}
                    </p>

                    {/* Preview table — horizontal scroll */}
                    <div className="flex-1 overflow-auto min-h-0 border border-gray-800 rounded-xl">
                      <table className="text-xs min-w-max">
                        <thead className="sticky top-0 bg-[#0d0d0d]">
                          <tr className="border-b border-gray-800">
                            {remapColOrder.map(key => OUTPUT_COLS.find(c => c.key === key)).filter(Boolean).map(col => (
                              <th key={col.key} className="px-3 py-2 text-left font-black text-gray-500 whitespace-nowrap">{col.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {getPreviewRows().map((row, ri) => (
                            <tr key={ri} className={`border-b border-gray-900 ${ri % 2 === 0 ? 'bg-black/20' : 'bg-black/5'}`}>
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-gray-300 max-w-[150px] truncate" title={String(cell ?? '')}>
                                  {cell !== '' && cell !== null && cell !== undefined ? String(cell) : <span className="text-gray-700">—</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* File name + export button */}
                    <div className="mt-3 pt-3 border-t border-gray-800 shrink-0 flex gap-2">
                      <input value={remapFileName} onChange={e => setRemapFileName(e.target.value)}
                        className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-xl px-3 py-2 text-white outline-none focus:border-indigo-500 font-bold text-xs" placeholder="저장 파일 이름" />
                      <button onClick={exportRemap} disabled={isExportingRemap}
                        className="px-5 py-2 bg-[#3b82f6] hover:bg-[#93c5fd] text-black font-extrabold rounded-xl text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                        {isExportingRemap ? <><RefreshCw size={13} className="animate-spin" /> 처리 중...</> : <><Download size={13} /> {remapResult?.totalRows?.toLocaleString()}건 다운로드</>}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── 파일 합치기 ── */}
            {activeTab === 'filemerge' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Combine size={18} className="text-violet-400" /> 파일 합치기
                  </h3>
                  {mergeStep >= 2 && <button onClick={resetFileMerge} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">파일 다시 선택</button>}
                </div>
                <p className="text-sm text-gray-400 mb-3 leading-relaxed">
                  형식이 다른 <span className="text-blue-400 font-bold">기초수급자</span>·<span className="text-amber-400 font-bold">차상위</span> 파일을 표준 컬럼으로 통일하고 <span className="text-blue-400 font-bold">3시트(기초수급자/차상위/합본)</span> 1개 파일로 합칩니다.
                </p>

                {/* Step indicator */}
                <div className="flex items-center gap-1 mb-4">
                  {['파일 업로드', '컬럼 매핑', '미리보기'].map((label, idx) => {
                    const step = idx + 1;
                    const isActive = mergeStep === step;
                    const isDone = mergeStep > step;
                    return (
                      <div key={step} className="flex items-center gap-1">
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black transition-colors ${isActive ? 'bg-violet-900/40 border border-violet-700/50 text-violet-300' : isDone ? 'text-gray-500 border border-transparent' : 'text-gray-700 border border-transparent'}`}>
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${isActive ? 'bg-violet-500 text-black' : isDone ? 'bg-gray-700 text-gray-400' : 'bg-gray-800 text-gray-600'}`}>{isDone ? '✓' : step}</span>
                          {label}
                        </div>
                        {idx < 2 && <ArrowRight size={10} className="text-gray-700 shrink-0" />}
                      </div>
                    );
                  })}
                </div>

                {/* Step 1 — Upload two files */}
                {mergeStep === 1 && (
                  <div className="flex flex-col flex-1">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      {[
                        { which: 'A', label: '기초수급자 파일', color: 'blue',  file: mergeFileA,  result: mergeResultA,  analyzing: isAnalyzingMergeA },
                        { which: 'B', label: '차상위 파일',     color: 'amber', file: mergeFileB,  result: mergeResultB,  analyzing: isAnalyzingMergeB },
                      ].map(({ which, label, color, file, result, analyzing }) => (
                        <div key={which}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white ${color === 'blue' ? 'bg-blue-600' : 'bg-amber-600'}`}>{which}</span>
                            <p className={`text-[11px] font-black ${color === 'blue' ? 'text-blue-400' : 'text-amber-400'}`}>{label}</p>
                          </div>
                          <label className={`w-full py-8 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${file ? `border-${color}-500 bg-${color}-500/5` : 'border-gray-700 hover:border-gray-500 bg-black'}`}
                            style={{ borderColor: file ? (color === 'blue' ? '#3b82f6' : '#f59e0b') : undefined, backgroundColor: file ? (color === 'blue' ? 'rgba(59,130,246,0.05)' : 'rgba(245,158,11,0.05)') : undefined }}>
                            {analyzing
                              ? <RefreshCw size={24} className={`${color === 'blue' ? 'text-blue-400' : 'text-amber-400'} mb-2 animate-spin`} />
                              : <Upload size={24} className={file ? `${color === 'blue' ? 'text-blue-400' : 'text-amber-400'} mb-2` : 'text-gray-500 mb-2'} />
                            }
                            <span className={`font-bold text-xs text-center px-3 ${file ? (color === 'blue' ? 'text-blue-400' : 'text-amber-400') : 'text-gray-400'}`}>
                              {analyzing ? '분석 중...' : file ? file.name : `${label} 엑셀 선택`}
                            </span>
                            <input type="file" accept=".xlsx,.xls" onChange={e => handleMergeUpload(e, which)} className="hidden" disabled={analyzing} />
                          </label>
                          {result && (
                            <div className="mt-1.5">
                              <p className={`text-[10px] font-black text-center mb-1 ${color === 'blue' ? 'text-blue-400' : 'text-amber-400'}`}>
                                ✓ {result.totalRows.toLocaleString()}건 감지
                              </p>
                              <div className="flex gap-1 flex-wrap justify-center">
                                {result.sheets.map(s => (
                                  <span key={s.name} className={`px-1.5 py-0.5 rounded text-[9px] border font-bold ${color === 'blue' ? 'border-blue-800/40 text-blue-500 bg-blue-950/20' : 'border-amber-800/40 text-amber-500 bg-amber-950/20'}`}>
                                    {s.name} ({s.rowCount.toLocaleString()}행)
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Output structure preview */}
                    <div className="border border-gray-800 rounded-xl p-3 mb-4">
                      <p className="text-[10px] text-gray-600 font-black mb-2 text-center">출력 파일 구조</p>
                      <div className="flex items-center justify-center gap-2">
                        <span className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-blue-900/20 border border-blue-700/30 text-blue-400">기초수급자 시트</span>
                        <span className="text-gray-600">+</span>
                        <span className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-amber-900/20 border border-amber-700/30 text-amber-400">차상위 시트</span>
                        <span className="text-gray-600">+</span>
                        <span className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-blue-900/20 border border-blue-700/30 text-blue-400">합본 시트</span>
                        <span className="text-gray-500 text-[10px]">→ 1개 파일</span>
                      </div>
                    </div>

                    {mergeResultA && mergeResultB ? (
                      <button onClick={() => setMergeStep(2)}
                        className="w-full py-3.5 bg-violet-700 hover:bg-violet-600 text-white font-extrabold rounded-xl text-sm transition-all flex items-center justify-center gap-2">
                        <ArrowRight size={16} /> 컬럼 매핑 설정하기
                      </button>
                    ) : (
                      <div className="w-full py-3 border border-gray-800 rounded-xl text-center text-xs text-gray-600 font-bold">
                        {!mergeResultA && !mergeResultB ? '두 파일을 모두 업로드하세요' : !mergeResultA ? '기초수급자 파일을 업로드하세요' : '차상위 파일을 업로드하세요'}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2 — Mapping */}
                {mergeStep === 2 && mergeResultA && mergeResultB && (
                  <>
                    {/* Sheet selectors — 항상 표시 */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {[
                        { which: 'A', label: '기초수급자 파일', colorCls: 'text-blue-400', baseColor: 'blue',  result: mergeResultA, baseSheet: mergeBaseSheetA, selSheets: mergeSelectedSheetsA },
                        { which: 'B', label: '차상위 파일',     colorCls: 'text-amber-400', baseColor: 'amber', result: mergeResultB, baseSheet: mergeBaseSheetB, selSheets: mergeSelectedSheetsB },
                      ].map(({ which, label, colorCls, baseColor, result, baseSheet, selSheets }) => (
                        <div key={which} className="bg-black/20 border border-gray-800 rounded-xl p-2.5">
                          <p className={`text-[9px] font-black mb-2 ${colorCls}`}>{label} 시트</p>
                          {/* Base sheet */}
                          <p className="text-[9px] text-indigo-500 font-black mb-1">★ 매핑 기준</p>
                          <div className="flex gap-1 flex-wrap mb-2">
                            {result.sheets.map(s => {
                              const isBase = baseSheet === s.name;
                              return (
                                <button key={s.name} onClick={() => switchMergeBaseSheet(which, s.name)}
                                  className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                                    isBase
                                      ? baseColor === 'blue'
                                        ? 'bg-blue-900/50 border-blue-500/60 text-blue-200 shadow-[0_0_8px_rgba(59,130,246,0.3)]'
                                        : 'bg-amber-900/50 border-amber-500/60 text-amber-200 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                                      : 'bg-black/30 border-gray-800 text-gray-600 hover:border-gray-600 hover:text-gray-400'
                                  }`}>
                                  {isBase ? '★ ' : ''}{s.name} <span className="opacity-60">({s.rowCount.toLocaleString()}행)</span>
                                </button>
                              );
                            })}
                          </div>
                          {/* Export sheets */}
                          <p className="text-[9px] text-gray-600 font-black mb-1">✓ 내보낼 시트</p>
                          <div className="flex gap-1 flex-wrap">
                            {result.sheets.map(s => {
                              const checked = selSheets.includes(s.name);
                              return (
                                <label key={s.name} className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold cursor-pointer transition-colors ${
                                  checked
                                    ? baseColor === 'blue'
                                      ? 'bg-blue-900/30 border-blue-700/40 text-blue-300'
                                      : 'bg-amber-900/30 border-amber-700/40 text-amber-300'
                                    : 'bg-black/30 border-gray-800 text-gray-600 hover:border-gray-600'
                                }`}>
                                  <input type="checkbox" checked={checked} onChange={() => toggleMergeSheet(which, s.name)} className="hidden" />
                                  {checked ? '✓ ' : ''}{s.name} <span className="opacity-60 ml-0.5">({s.rowCount.toLocaleString()}행)</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Stats */}
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded text-[10px] font-black border bg-blue-900/20 border-blue-700/30 text-blue-400">기초수급자 {mergeResultA.totalRows.toLocaleString()}건</span>
                      <span className="px-2.5 py-1 rounded text-[10px] font-black border bg-amber-900/20 border-amber-700/30 text-amber-400">차상위 {mergeResultB.totalRows.toLocaleString()}건</span>
                      <span className="px-2.5 py-1 rounded text-[10px] font-black border bg-blue-900/20 border-blue-700/30 text-blue-400">합본 {(mergeResultA.totalRows + mergeResultB.totalRows).toLocaleString()}건</span>
                    </div>

                    {/* Combined mapping table */}
                    <div className="flex-1 overflow-y-auto min-h-0 border border-gray-800 rounded-xl">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-[#0d0d0d] z-10">
                          <tr className="border-b border-gray-800 text-gray-600">
                            <th className="px-2 py-2 text-left font-black w-[90px]">출력 컬럼</th>
                            <th className="px-2 py-2 text-left font-black text-blue-500">기초수급자 파일 원본</th>
                            <th className="px-2 py-2 text-left font-black text-amber-500">차상위 파일 원본</th>
                          </tr>
                        </thead>
                        <tbody>
                          {OUTPUT_COLS.map((col, ci) => {
                            const mA = mergeMappingA[col.key] || { srcIdx: -1, confidence: 0 };
                            const mB = mergeMappingB[col.key] || { srcIdx: -1, confidence: 0 };
                            const isGubun = col.key === 'gubun';
                            const borderClassA = mA.srcIdx === -1 ? 'border-gray-700' : mA.confidence >= 85 ? 'border-blue-700/50' : mA.confidence >= 72 ? 'border-yellow-700/50' : 'border-orange-700/50';
                            const borderClassB = mB.srcIdx === -1 ? 'border-gray-700' : mB.confidence >= 85 ? 'border-blue-700/50' : mB.confidence >= 72 ? 'border-yellow-700/50' : 'border-orange-700/50';
                            return (
                              <tr key={col.key} className={`border-b border-gray-900 ${ci % 2 === 0 ? 'bg-black/20' : 'bg-black/5'}`}>
                                <td className="px-2 py-1.5">
                                  <span className="font-black text-white text-[11px]">{col.label}</span>
                                  {col.transform && <span className="ml-1 text-[8px] text-indigo-400 opacity-70">{col.transform === 'phone' ? '☎' : col.transform === 'birth' ? '📅' : 'Y/N'}</span>}
                                  {col.special === 'autoSeq'  && <span className="ml-1 text-[8px] text-blue-400 opacity-70">⚡</span>}
                                  {col.special === 'fromAddr' && <span className="ml-1 text-[8px] text-teal-400 opacity-70">🔍</span>}
                                </td>
                                <td className="px-2 py-1.5">
                                  {isGubun
                                    ? <span className="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-black bg-blue-900/20 border border-blue-700/30 text-blue-400">기초수급자 (자동)</span>
                                    : <select value={String(mA.srcIdx)} onChange={e => handleMergeMappingChange('A', col.key, e.target.value)}
                                        className={`w-full bg-[#0a0a0a] rounded-lg px-2 py-1 text-white outline-none transition-all text-[10px] border ${borderClassA}`}>
                                        <option value="-1">(비어두기)</option>
                                        {col.special === 'autoSeq'  && <option value="-3">⚡ 자동 생성</option>}
                                        {col.special === 'fromAddr' && <option value="-2">🔍 주소에서 추출</option>}
                                        {mergeActiveHeadersA.map((h, hi) => <option key={hi} value={String(hi)}>{h || `열${hi+1}`}</option>)}
                                      </select>
                                  }
                                </td>
                                <td className="px-2 py-1.5">
                                  {isGubun
                                    ? <span className="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-black bg-amber-900/20 border border-amber-700/30 text-amber-400">차상위 (자동)</span>
                                    : <select value={String(mB.srcIdx)} onChange={e => handleMergeMappingChange('B', col.key, e.target.value)}
                                        className={`w-full bg-[#0a0a0a] rounded-lg px-2 py-1 text-white outline-none transition-all text-[10px] border ${borderClassB}`}>
                                        <option value="-1">(비어두기)</option>
                                        {col.special === 'autoSeq'  && <option value="-3">⚡ 자동 생성</option>}
                                        {col.special === 'fromAddr' && <option value="-2">🔍 주소에서 추출</option>}
                                        {mergeActiveHeadersB.map((h, hi) => <option key={hi} value={String(hi)}>{h || `열${hi+1}`}</option>)}
                                      </select>
                                  }
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-800 shrink-0 flex gap-2">
                      <input value={mergeFileName} onChange={e => setMergeFileName(e.target.value)}
                        className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-xl px-3 py-2 text-white outline-none focus:border-violet-500 font-bold text-xs" placeholder="저장 파일 이름" />
                      <button onClick={() => setMergeStep(3)}
                        className="px-5 py-2 bg-violet-700 hover:bg-violet-600 text-white font-extrabold rounded-xl text-xs transition-all flex items-center gap-1.5">
                        <Eye size={13} /> 미리보기
                      </button>
                    </div>
                  </>
                )}

                {/* Step 3 — Preview */}
                {mergeStep === 3 && (
                  <>
                    <button onClick={() => setMergeStep(2)} className="text-sm text-gray-500 hover:text-gray-300 transition-colors mb-3 self-start flex items-center gap-1">
                      ← 매핑으로 돌아가기
                    </button>
                    <div className="flex gap-3 mb-2">
                      <span className="flex items-center gap-1 text-[11px] text-gray-500"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>기초수급자 {mergeResultA?.totalRows?.toLocaleString()}건</span>
                      <span className="flex items-center gap-1 text-[11px] text-gray-500"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>차상위 {mergeResultB?.totalRows?.toLocaleString()}건</span>
                      <span className="text-[11px] text-gray-600">· 각 3건 샘플</span>
                    </div>

                    <div className="flex-1 overflow-auto min-h-0 border border-gray-800 rounded-xl">
                      <table className="text-xs min-w-max">
                        <thead className="sticky top-0 bg-[#0d0d0d]">
                          <tr className="border-b border-gray-800">
                            <th className="px-2 py-2 w-5"></th>
                            {OUTPUT_COLS.map(col => (
                              <th key={col.key} className="px-3 py-2 text-left font-black text-gray-500 whitespace-nowrap">{col.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {getMergePreviewRows('A').map((row, ri) => (
                            <tr key={`a${ri}`} className="border-b border-gray-900 bg-blue-950/15">
                              <td className="px-2 py-1.5 text-center"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span></td>
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-gray-300 max-w-[130px] truncate" title={String(cell ?? '')}>
                                  {cell !== '' && cell !== null ? String(cell) : <span className="text-gray-700">—</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                          <tr className="bg-gray-900/50">
                            <td colSpan={OUTPUT_COLS.length + 1} className="px-3 py-1 text-[10px] text-gray-600 text-center">···</td>
                          </tr>
                          {getMergePreviewRows('B').map((row, ri) => (
                            <tr key={`b${ri}`} className="border-b border-gray-900 bg-amber-950/15">
                              <td className="px-2 py-1.5 text-center"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span></td>
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-gray-300 max-w-[130px] truncate" title={String(cell ?? '')}>
                                  {cell !== '' && cell !== null ? String(cell) : <span className="text-gray-700">—</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-800 shrink-0 flex gap-2">
                      <input value={mergeFileName} onChange={e => setMergeFileName(e.target.value)}
                        className="flex-1 bg-[#0a0a0a] border border-gray-700 rounded-xl px-3 py-2 text-white outline-none focus:border-violet-500 font-bold text-xs" placeholder="저장 파일 이름" />
                      <button onClick={exportFileMerge} disabled={isExportingMerge}
                        className="px-5 py-2 bg-[#3b82f6] hover:bg-[#93c5fd] text-black font-extrabold rounded-xl text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                        {isExportingMerge
                          ? <><RefreshCw size={13} className="animate-spin" /> 처리 중...</>
                          : <><Download size={13} /> {((mergeResultA?.totalRows||0)+(mergeResultB?.totalRows||0)).toLocaleString()}건 · 3시트 다운로드</>
                        }
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── DATA 매칭 ── */}
            {activeTab === 'match' && (() => {
              const KEY_ROWS = [
                { key: 'name', label: '이름 (필수)', required: true },
                { key: 'birth', label: '생년월일', required: false },
                { key: 'phone', label: '휴대폰', required: false },
                { key: 'landline', label: '유선전화', required: false },
              ];
              const KeyMapSection = ({ headers, keyMap, setKeyMap, title }) => (
                <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800 space-y-3">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">{title}</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {KEY_ROWS.map(({ key, label, required }) => (
                      <div key={key}>
                        <label className="text-[11px] text-gray-500 mb-1 block">{label}</label>
                        <select value={keyMap[key]} onChange={e => setKeyMap(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                          className="w-full bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1.5 outline-none hover:border-gray-600">
                          {!required && <option value={-1}>— 없음 —</option>}
                          {required && keyMap[key] === -1 && <option value={-1}>— 선택 필요 —</option>}
                          {headers.map((h, i) => <option key={i} value={i}>{h || `열${i+1}`}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              );
              return (
                <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-bold text-white">DATA 매칭</h3>
                      <p className="text-xs text-gray-400 mt-0.5">두 파일을 이름/생년월일/전화번호로 매칭하여 데이터를 이식합니다.</p>
                    </div>
                    {matchStep > 1 && <button onClick={resetMatch} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"><RefreshCw size={12}/> 처음부터</button>}
                  </div>

                  {/* Step indicator */}
                  <div className="flex items-center gap-1.5 mb-5">
                    {['대상 파일', '소스 파일', '결과 확인'].map((label, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-colors
                          ${matchStep === i+1 ? 'bg-blue-600 text-white' : matchStep > i+1 ? 'bg-blue-900/50 text-blue-400 border border-blue-700/30' : 'bg-gray-800 text-gray-600'}`}>
                          {matchStep > i+1 ? <CheckSquare size={10}/> : <span className="w-3 text-center">{i+1}</span>}
                          <span>{label}</span>
                        </div>
                        {i < 2 && <div className={`h-px w-4 ${matchStep > i+1 ? 'bg-blue-600' : 'bg-gray-700'}`}/>}
                      </div>
                    ))}
                  </div>

                  {/* ── STEP 1: 대상 파일 ── */}
                  {matchStep === 1 && (
                    <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                      <label className={`w-full py-6 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${matchTargetFile ? 'border-blue-500 bg-blue-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                        {isMatchAnalyzingTarget ? (
                          <><RefreshCw size={24} className="text-blue-400 animate-spin mb-2"/><span className="text-blue-400 text-sm font-bold">분석 중...</span></>
                        ) : matchTargetFile ? (
                          <><Upload size={22} className="text-blue-400 mb-2"/><span className="text-blue-400 text-sm font-bold">{matchTargetFile.name}</span><span className="text-gray-500 text-xs mt-1">{fmtSize(matchTargetFile.size)}</span></>
                        ) : (
                          <><Upload size={24} className="text-gray-500 mb-2"/><span className="text-gray-400 text-sm font-bold">대상(신규) 파일 선택</span><span className="text-gray-600 text-xs mt-1">데이터를 받을 파일 — .xlsx / .xls</span></>
                        )}
                        <input type="file" accept=".xlsx,.xls" onChange={handleMatchTargetUpload} className="hidden" disabled={isMatchAnalyzingTarget}/>
                      </label>

                      {matchTargetResult && (
                        <>
                          {matchTargetResult.sheets?.length > 1 && (
                            <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
                              <p className="text-xs text-gray-400 mb-2 font-bold uppercase tracking-wide">시트 선택</p>
                              <div className="flex flex-wrap gap-2">
                                {matchTargetResult.sheets.map(s => (
                                  <button key={s.name} onClick={() => handleMatchTargetSheetChange(s.name)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${matchTargetSheet === s.name ? 'bg-blue-600/30 text-blue-300 border-blue-500/40' : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'}`}>
                                    {s.name} ({s.rowCount}행)
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <KeyMapSection headers={matchTargetHeaders} keyMap={matchTargetKeyMap} setKeyMap={setMatchTargetKeyMap} title="매칭 키 컬럼 설정 (대상 파일)"/>
                          <div className="bg-gray-900/30 rounded-xl p-3 border border-gray-800/50">
                            <p className="text-[11px] text-gray-500 mb-2 font-bold">컬럼 미리보기</p>
                            <div className="flex flex-wrap gap-1.5">
                              {matchTargetHeaders.map((h, i) => <span key={i} className="px-2 py-0.5 bg-gray-800 text-gray-300 text-[11px] rounded-md">{h || `열${i+1}`}</span>)}
                            </div>
                          </div>
                          <button onClick={() => setMatchStep(2)} disabled={matchTargetKeyMap.name < 0}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
                            다음: 소스 파일 선택 <ChevronRight size={16}/>
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* ── STEP 2: 소스 파일 ── */}
                  {matchStep === 2 && (
                    <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                      <label className={`w-full py-6 border-2 border-dashed rounded-xl flex flex-col items-center cursor-pointer transition-colors ${matchSourceFile ? 'border-amber-500 bg-amber-500/5' : 'border-gray-700 hover:border-gray-500 bg-black'}`}>
                        {isMatchAnalyzingSource ? (
                          <><RefreshCw size={24} className="text-amber-400 animate-spin mb-2"/><span className="text-amber-400 text-sm font-bold">분석 중...</span></>
                        ) : matchSourceFile ? (
                          <><Upload size={22} className="text-amber-400 mb-2"/><span className="text-amber-400 text-sm font-bold">{matchSourceFile.name}</span><span className="text-gray-500 text-xs mt-1">{fmtSize(matchSourceFile.size)}</span></>
                        ) : (
                          <><Upload size={24} className="text-gray-500 mb-2"/><span className="text-gray-400 text-sm font-bold">소스(이식) 파일 선택</span><span className="text-gray-600 text-xs mt-1">데이터를 가져올 파일 — .xlsx / .xls</span></>
                        )}
                        <input type="file" accept=".xlsx,.xls" onChange={handleMatchSourceUpload} className="hidden" disabled={isMatchAnalyzingSource}/>
                      </label>

                      {matchSourceResult && (
                        <>
                          {matchSourceResult.sheets?.length > 1 && (
                            <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
                              <p className="text-xs text-gray-400 mb-2 font-bold uppercase tracking-wide">시트 선택</p>
                              <div className="flex flex-wrap gap-2">
                                {matchSourceResult.sheets.map(s => (
                                  <button key={s.name} onClick={() => handleMatchSourceSheetChange(s.name)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${matchSourceSheet === s.name ? 'bg-amber-600/30 text-amber-300 border-amber-500/40' : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'}`}>
                                    {s.name} ({s.rowCount}행)
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <KeyMapSection headers={matchSourceHeaders} keyMap={matchSourceKeyMap} setKeyMap={setMatchSourceKeyMap} title="매칭 키 컬럼 설정 (소스 파일)"/>

                          {/* 이식 컬럼 선택 */}
                          <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">이식할 컬럼 선택 <span className="text-blue-400 ml-1">{matchTransplantCols.filter(c=>c.enabled).length}개 선택</span></p>
                              <div className="flex gap-3">
                                <button onClick={() => setMatchTransplantCols(prev => prev.map(c => ({...c, enabled: true})))} className="text-[11px] text-blue-400 hover:text-blue-300">전체선택</button>
                                <button onClick={() => setMatchTransplantCols(prev => prev.map(c => ({...c, enabled: false})))} className="text-[11px] text-gray-500 hover:text-gray-400">전체해제</button>
                              </div>
                            </div>
                            <div className="max-h-52 overflow-y-auto">
                              {matchTransplantCols.map((col, i) => (
                                <div key={i} className={`flex items-center gap-2.5 px-4 py-2 border-b border-gray-800/40 transition-colors ${col.enabled ? 'bg-gray-800/20' : 'hover:bg-gray-800/10'}`}>
                                  <button onClick={() => setMatchTransplantCols(prev => prev.map((c, ci) => ci===i ? {...c, enabled: !c.enabled} : c))}
                                    className="shrink-0">
                                    {col.enabled ? <CheckSquare size={14} className="text-blue-400"/> : <Square size={14} className="text-gray-600"/>}
                                  </button>
                                  <span className={`text-xs flex-1 truncate ${col.enabled ? 'text-white' : 'text-gray-500'}`}>{col.srcLabel}</span>
                                  {col.enabled && (
                                    <>
                                      <ChevronRight size={11} className="text-gray-600 shrink-0"/>
                                      <select value={col.tgtIdx} onChange={e => setMatchTransplantCols(prev => prev.map((c,ci)=>ci===i?{...c,tgtIdx:Number(e.target.value)}:c))}
                                        className="bg-gray-800 border border-gray-700 text-[11px] text-white rounded-lg px-2 py-1 outline-none max-w-[140px]">
                                        <option value={-1}>새 컬럼 추가</option>
                                        {matchTargetHeaders.map((h, hi) => <option key={hi} value={hi}>{h||`열${hi+1}`}</option>)}
                                      </select>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="bg-blue-950/30 rounded-xl p-3 border border-blue-800/30 flex gap-2 text-xs text-blue-300">
                            <AlertCircle size={14} className="shrink-0 mt-0.5"/>
                            <span>매칭 우선순위: <strong>이름+생년월일</strong> → <strong>이름+휴대폰</strong> → <strong>이름+유선전화</strong> 순으로 매칭합니다.</span>
                          </div>

                          <button onClick={runDataMatch} disabled={isMatchRunning || matchTransplantCols.filter(c=>c.enabled).length===0 || matchSourceKeyMap.name<0}
                            className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
                            {isMatchRunning ? <><RefreshCw size={14} className="animate-spin"/> 매칭 실행 중...</> : <><Shuffle size={14}/> 매칭 실행</>}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* ── STEP 3: 결과 ── */}
                  {matchStep === 3 && matchStats && (
                    <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-center">
                          <p className="text-2xl font-black text-white">{matchStats.total.toLocaleString()}</p>
                          <p className="text-xs text-gray-500 mt-1">전체 건수</p>
                        </div>
                        <div className="bg-emerald-950/50 rounded-xl p-4 border border-emerald-800/40 text-center">
                          <p className="text-2xl font-black text-emerald-400">{matchStats.matched.toLocaleString()}</p>
                          <p className="text-xs text-emerald-600 mt-1">매칭 성공</p>
                        </div>
                        <div className="bg-red-950/30 rounded-xl p-4 border border-red-800/30 text-center">
                          <p className="text-2xl font-black text-red-400">{(matchStats.total - matchStats.matched).toLocaleString()}</p>
                          <p className="text-xs text-red-700 mt-1">미매칭</p>
                        </div>
                      </div>

                      <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${matchStats.total > 0 ? (matchStats.matched/matchStats.total*100) : 0}%` }}/>
                          </div>
                          <span className="text-sm font-bold text-emerald-400">{matchStats.total > 0 ? (matchStats.matched/matchStats.total*100).toFixed(1) : 0}%</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>이식 컬럼: {matchTransplantCols.filter(c=>c.enabled).map(c=>c.srcLabel).join(', ')}</span>
                        </div>
                      </div>

                      <div className="bg-blue-950/20 rounded-xl p-3 border border-blue-800/20 text-xs text-blue-300">
                        출력 파일: <strong>매칭결과</strong> 시트(전체) + <strong>미매칭목록</strong> 시트(미매칭만) — 마지막 열에 매칭 방식 표시
                      </div>

                      <button onClick={downloadMatchResult}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
                        <Download size={16}/> {matchResultBlob?.fileName || '결과 다운로드'}
                      </button>

                      <button onClick={resetMatch} className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs font-bold rounded-xl transition-colors">
                        새 매칭 시작
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── 스타일 서식 ── */}
            {activeTab === 'format' && (() => {
              const SAMPLE_HEADERS = ['이름', '주소', '포수', '행정동', '특이사항'];
              const SAMPLE_ROWS = [
                ['홍길동', '서울시 강남구 역삼동 123', '2', '역삼1동', '—'],
                ['김철수', '부산시 해운대구 우동 456', '3', '우1동', '3층'],
                ['이영희', '대구시 달서구 용산동 789', '1', '용산2동', '문앞'],
                ['박민수', '인천시 남동구 논현동 321', '4', '논현1동', '—'],
              ];
              const sel = STYLE_PRESETS.find(p => p.id === selectedStyleId) || STYLE_PRESETS[0];
              return (
                <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white flex items-center gap-2"><Palette size={18} className="text-purple-400"/> 스타일 서식 적용</h3>
                      <p className="text-xs text-gray-400 mt-0.5">데이터만 있는 엑셀에 10가지 프리미엄 서식을 입혀 완성도 높은 문서로 변환합니다.</p>
                    </div>
                    {formatFile && <button onClick={resetFormat} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"><RefreshCw size={12}/> 초기화</button>}
                  </div>

                  {/* File Upload */}
                  <label className={`w-full py-4 border-2 border-dashed rounded-xl flex items-center justify-center gap-3 cursor-pointer transition-colors mb-4 ${formatFile ? 'border-purple-500 bg-purple-500/5' : 'border-gray-700 hover:border-gray-500 bg-black/40'}`}>
                    {isFormatAnalyzing ? (
                      <><RefreshCw size={18} className="text-purple-400 animate-spin"/><span className="text-purple-400 text-sm font-bold">분석 중...</span></>
                    ) : formatFile ? (
                      <><Palette size={18} className="text-purple-400"/>
                        <div><p className="text-purple-300 text-sm font-bold">{formatFile.name}</p>
                          <p className="text-gray-500 text-xs">{fmtSize(formatFile.size)}{formatInfo ? ` · ${formatInfo.sheets?.length || 1}개 시트 · ${(formatInfo.totalRows||0).toLocaleString()}행` : ''}</p>
                        </div>
                        <span className="ml-auto text-xs text-gray-500 pr-2">클릭하여 변경</span>
                      </>
                    ) : (
                      <><Upload size={18} className="text-gray-500"/><div className="text-center"><p className="text-gray-400 text-sm font-bold">엑셀 파일 선택</p><p className="text-gray-600 text-xs">.xlsx / .xls — 모든 시트에 서식 적용</p></div></>
                    )}
                    <input type="file" accept=".xlsx,.xls" onChange={handleFormatUpload} className="hidden"/>
                  </label>

                  {/* Main 2-column layout */}
                  <div className="flex gap-4 flex-1 min-h-0">
                    {/* Left: Style cards */}
                    <div className="w-[270px] shrink-0 overflow-y-auto pr-1 space-y-1.5">
                      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">스타일 선택</p>
                      {STYLE_PRESETS.map(preset => (
                        <button key={preset.id} onClick={() => setSelectedStyleId(preset.id)}
                          className={`w-full flex items-stretch rounded-xl overflow-hidden transition-all border ${selectedStyleId === preset.id ? 'border-purple-500 shadow-lg shadow-purple-500/20' : 'border-gray-800 hover:border-gray-600'}`}>
                          {/* Color swatch strip */}
                          <div className="w-10 shrink-0 flex flex-col">
                            <div className="flex-1" style={{ background: preset.headerBg }}/>
                            <div className="flex-1" style={{ background: preset.evenBg || '#f0f0f0' }}/>
                            <div className="flex-1" style={{ background: preset.oddBg }}/>
                          </div>
                          {/* Info */}
                          <div className={`flex-1 px-3 py-2 text-left transition-colors ${selectedStyleId === preset.id ? 'bg-purple-950/40' : 'bg-gray-900 hover:bg-gray-800'}`}>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-600 font-bold">#{preset.id}</span>
                              <span className={`text-xs font-bold ${selectedStyleId === preset.id ? 'text-purple-200' : 'text-gray-200'}`}>{preset.name}</span>
                              {selectedStyleId === preset.id && <span className="ml-auto text-purple-400 text-[10px] font-black">✓</span>}
                            </div>
                            <p className="text-[10px] text-gray-500 mt-0.5">{preset.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Right: Preview + Apply */}
                    <div className="flex-1 flex flex-col gap-3 min-w-0">
                      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">미리보기 — {sel.name}</p>
                      {/* CSS Preview Table */}
                      <div className="rounded-xl overflow-hidden border flex-1" style={{ borderColor: sel.border }}>
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr>
                              {SAMPLE_HEADERS.map((h, i) => (
                                <th key={i} className="px-3 py-2 text-center font-bold whitespace-nowrap"
                                  style={{ background: sel.headerBg, color: sel.headerFg, borderBottom: `2px solid ${sel.accent}`, fontSize: '11px' }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {SAMPLE_ROWS.map((row, ri) => (
                              <tr key={ri} style={{ background: ri % 2 === 0 ? sel.evenBg : sel.oddBg }}>
                                {row.map((cell, ci) => (
                                  <td key={ci} className="px-3 py-1.5 whitespace-nowrap truncate max-w-[120px]"
                                    style={{ borderBottom: `1px solid ${sel.border}`, color: '#1f2937', fontSize: '10px' }}>
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {/* Footer preview bar */}
                        <div className="h-6 flex items-center px-3 gap-2" style={{ background: sel.headerBg + '22' }}>
                          <div className="h-1.5 rounded-full flex-1" style={{ background: sel.accent + '40' }}/>
                          <div className="h-1.5 rounded-full w-12" style={{ background: sel.accent + '60' }}/>
                        </div>
                      </div>

                      {/* Style detail badges */}
                      <div className="flex gap-1.5 flex-wrap">
                        {[
                          { label: '헤더 고정', desc: '프리즈 파인' },
                          { label: '열폭 자동', desc: '콘텐츠 기반' },
                          { label: '교차 행', desc: '홀짝 채색' },
                          { label: '전체 시트', desc: '일괄 적용' },
                        ].map((b, i) => (
                          <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] border" style={{ borderColor: sel.border, color: sel.accent, background: sel.evenBg }}>
                            <span className="font-bold">{b.label}</span>
                            <span className="text-gray-500">· {b.desc}</span>
                          </div>
                        ))}
                      </div>

                      {/* Apply button */}
                      <button onClick={runFormatExcel} disabled={!formatFile || isFormatProcessing}
                        className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all disabled:opacity-40"
                        style={{ background: isFormatProcessing ? sel.headerBg + 'aa' : sel.headerBg, color: sel.headerFg }}>
                        {isFormatProcessing
                          ? <><RefreshCw size={15} className="animate-spin"/> 서식 적용 중...</>
                          : <><Wand2 size={15}/> [{sel.name}] 서식 적용 후 다운로드</>
                        }
                      </button>
                      {!formatFile && <p className="text-center text-xs text-gray-600">파일을 먼저 업로드하세요</p>}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── 소속사전용 ── */}
            {activeTab === 'orgReport' && (() => {
              const approvedCities = user?.citiesApproved || [];

              // 탭 진입 시 관리자 도시 목록 로드 (1회)
              if (isAdmin && orgRptCities.length === 0 && !orgRptLoadingCities) {
                loadOrgRptAdminCities();
              }

              const cityOptions = isAdmin
                ? orgRptCities
                : approvedCities.map(id => ({ id, lastMonthId: null }));

              return (
                <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                  <div className="mb-1">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Building2 size={18} className="text-blue-400" /> 소속사 전용 집계표
                    </h3>
                    <p className="text-sm text-gray-400 mt-1">
                      최근 등록된 월 명단 기준으로 소속사별 · 행정동별 집계표와 명단을 추출합니다.
                    </p>
                  </div>

                  <div className="mt-5 space-y-5">
                    {/* 지자체 선택 */}
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-2">지자체(시군구) 선택</label>
                      {!isAdmin && approvedCities.length === 0 ? (
                        <p className="text-sm text-yellow-400">승인된 지자체가 없습니다.</p>
                      ) : isAdmin && orgRptLoadingCities ? (
                        <div className="text-sm text-gray-500 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> 지자체 목록 로딩 중...</div>
                      ) : (
                        <select
                          value={orgRptCity}
                          onChange={e => handleOrgRptCityChange(e.target.value)}
                          className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500">
                          <option value="">-- 지자체 선택 --</option>
                          {cityOptions.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.id}{c.lastMonthId ? ` (${c.lastMonthId})` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* 최신 월 정보 표시 */}
                    {orgRptCity && (
                      <div className="bg-[#0d0d0d] border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
                        {orgRptLoadingMonth ? (
                          <><RefreshCw size={14} className="animate-spin text-gray-500" /><span className="text-sm text-gray-500">월 정보 확인 중...</span></>
                        ) : orgRptLatestMonth ? (
                          <>
                            <span className="text-blue-400 font-black text-sm">📅 {orgRptLatestMonth.id}</span>
                            <span className="text-gray-500 text-xs">|</span>
                            <span className="text-white text-xs font-bold">{(orgRptLatestMonth.totalQty || 0).toLocaleString()}포</span>
                            <span className="text-amber-400 text-xs">수급자 {(orgRptLatestMonth.수급자Qty || 0).toLocaleString()}포</span>
                            <span className="text-blue-400 text-xs">차상위 {(orgRptLatestMonth.차상위Qty || 0).toLocaleString()}포</span>
                          </>
                        ) : (
                          <span className="text-yellow-400 text-sm">등록된 월 데이터가 없습니다.</span>
                        )}
                      </div>
                    )}

                    {/* 추출 안내 */}
                    {orgRptLatestMonth && (
                      <div className="bg-[#0d1117] border border-blue-900/40 rounded-xl p-4 space-y-1.5">
                        <p className="text-xs font-bold text-blue-300">📋 추출될 시트 구성</p>
                        <div className="text-xs text-gray-400 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block shrink-0" />
                            <span><b className="text-white">집계표 시트</b> — {isAdmin ? '소속사 × 행정동별' : '행정동별'} 수급자·차상위·전체 포수 집계</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500 inline-block shrink-0" />
                            <span><b className="text-white">명단 시트</b> — 소속사별 명단 (소속사 미설정 시 전체명단 1개)</span>
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-600 mt-1">※ 소속사·행정동 배정은 메뉴 → 소속사 구역 설정에서 관리됩니다.</p>
                      </div>
                    )}

                    {/* 추출 버튼 */}
                    <button
                      onClick={handleOrgRptExport}
                      disabled={!orgRptCity || !orgRptLatestMonth || orgRptExporting}
                      className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 text-white font-black text-sm rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.99]">
                      {orgRptExporting
                        ? <><RefreshCw size={16} className="animate-spin" /> 집계 추출 중...</>
                        : <><Download size={16} /> 집계표 + 명단 다운로드</>}
                    </button>
                  </div>
                </div>
              );
            })()}

            {activeTab === 'audit' && (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-lg font-bold text-white">클라우드 변경 이력</h3>
                  <button onClick={fetchLogs} className="text-sm text-[#3b82f6] hover:underline font-bold">새로고침</button>
                </div>
                <p className="text-sm text-gray-400 mb-4">기준명단 갱신 및 주요 변경 이력이 기록됩니다.</p>
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {loadingLogs ? (
                    <div className="flex justify-center items-center h-24 text-gray-500 text-sm">로딩 중...</div>
                  ) : logs.length === 0 ? (
                    <div className="flex justify-center items-center h-24 text-gray-600 text-sm border-2 border-dashed border-gray-800 rounded-xl">기록된 이력이 없습니다.</div>
                  ) : logs.map(log => (
                    <div key={log.id} className="bg-black/40 border border-gray-800 rounded-xl p-4 hover:border-gray-600 transition-all">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-blue-900/50 text-blue-400 border border-blue-700/50">
                            {log.type === 'BASE_UPDATE' ? '기준명단 갱신' : log.type}
                          </span>
                          <span className="text-sm font-bold text-white">{log.targetName}</span>
                          <span className="text-[10px] text-gray-500">{log.city}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-gray-500 font-mono">
                          <Clock size={10} />
                          {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : '방금 전'}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 font-mono bg-[#0a0a0a] p-2 rounded-lg mb-3">
                        {Object.entries(log.updates || {}).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-2">
                            <span className="text-gray-500 w-16">{k}:</span>
                            <span className="text-[#3b82f6]">{v}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-gray-800/50">
                        <span className="text-[10px] text-gray-600">수정자: {log.userEmail}</span>
                        <button onClick={() => handleSendNotification(log)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-[#3b82f6]/20 hover:text-[#3b82f6] hover:border-[#3b82f6]/50 border border-gray-700 text-gray-300 rounded-lg text-[10px] font-bold transition-all">
                          <Send size={12} /> 담당자 알림 전송
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
