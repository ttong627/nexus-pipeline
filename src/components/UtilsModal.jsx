import { useState, useEffect, useRef } from 'react';
import { X, Layers, History, GitMerge, Trash2, Sparkles, SplitSquareHorizontal, SlidersHorizontal, Combine, Shuffle, Palette, Building2, Truck } from 'lucide-react';
import { db, collection, query, orderBy, limit, getDocs, addDoc, serverTimestamp, doc, getDoc } from '../config/firebase.js';
import * as XLSX from 'xlsx';
import MergerTab from './utils/MergerTab.jsx';   // 'merger' 탭(2026-08-24 Phase 4-6 분리)
import AuditTab from './utils/AuditTab.jsx';   // 'audit' 탭(2026-08-24 Phase 4-6 분리)
import OrgReportTab from './utils/OrgReportTab.jsx';   // 'orgReport' 탭(2026-08-24 Phase 4-6 분리)
import CleanTab from './utils/CleanTab.jsx';   // 'clean' 탭(2026-08-24 Phase 4-6 분리)
import DriverReportTab from './utils/DriverReportTab.jsx';   // 'driverReport' 탭(2026-08-24 Phase 4-6 분리)
import FormatTab from './utils/FormatTab.jsx';   // 'format' 탭(2026-08-24 Phase 4-6 분리)
import DongTab from './utils/DongTab.jsx';   // 'dong' 탭(2026-08-24 Phase 4-6 분리)
import MatchTab from './utils/MatchTab.jsx';   // 'match' 탭(2026-08-24 Phase 4-6 분리)
import DedupTab from './utils/DedupTab.jsx';   // 'dedup' 탭(2026-08-24 Phase 4-6 분리)
import RemapTab from './utils/RemapTab.jsx';   // 'remap' 탭(2026-08-24 Phase 4-6 분리)
import FileMergeTab from './utils/FileMergeTab.jsx';   // 파일 합치기 탭(2026-08-23 Phase 4-2 분리)
import { ADMIN_EMAILS } from '../utils/admins.js';   // 관리자 목록 SSOT(2026-08-23 점검: 세 벌이 갈라져 있었다)


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

const getQtyForReport = (r) => parseInt(r?.포수 || r?.['수량(포수)'] || 1, 10) || 1;
const isChasForReport = (r) => String(r?.구분 || '').includes('차상위');
const normalizeDriverName = (v) => String(v || '').trim() || '미배정';
const normalizeDongName = (v) => String(v || '').trim() || '미분류';
const safeSheetName = (name, used = new Set()) => {
  const base = String(name || '시트')
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28) || '시트';
  let sheetName = base;
  let seq = 2;
  while (used.has(sheetName)) {
    const suffix = `_${seq++}`;
    sheetName = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(sheetName);
  return sheetName;
};

const makeDeliveryListSheet = (records, includeDriver = true) => {
  const headers = includeDriver
    ? ['NO', '기사', '행정동', '배송순번', '구분', '성명', '생년월일', '포수', '주소', '휴대폰', '유선전화', '문자수신', '품명', '특이사항']
    : ['NO', '행정동', '배송순번', '구분', '성명', '생년월일', '포수', '주소', '휴대폰', '유선전화', '문자수신', '품명', '특이사항'];
  const sorted = [...records].sort((a, b) => {
    const driverCmp = normalizeDriverName(a.기사).localeCompare(normalizeDriverName(b.기사), 'ko', { numeric: true });
    if (includeDriver && driverCmp) return driverCmp;
    const dongCmp = normalizeDongName(a.행정동).localeCompare(normalizeDongName(b.행정동), 'ko', { numeric: true });
    if (dongCmp) return dongCmp;
    const seqA = parseInt(a.배송순번 || '999999', 10) || 999999;
    const seqB = parseInt(b.배송순번 || '999999', 10) || 999999;
    if (seqA !== seqB) return seqA - seqB;
    return String(a.이름 || '').localeCompare(String(b.이름 || ''), 'ko', { numeric: true });
  });
  const rows = [headers];
  sorted.forEach((r, i) => {
    const common = [
      i + 1,
      normalizeDongName(r.행정동),
      r.배송순번 || '',
      r.구분 || '',
      r.이름 || '',
      r.생년월일 || '',
      getQtyForReport(r),
      r.주소 || '',
      r.휴대폰 || '',
      r.유선전화 || '',
      r.문자수신 || '',
      r.품명 || '',
      r.특이사항 || '',
    ];
    rows.push(includeDriver ? [common[0], normalizeDriverName(r.기사), ...common.slice(1)] : common);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = includeDriver
    ? [{ wch: 5 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 42 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 34 }]
    : [{ wch: 5 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 42 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 34 }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: headers.length - 1 } }) };
  return ws;
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

  // ── 기사별 명단 다운로드 ─────────────────────────────────────────────
  const [driverRptCity, setDriverRptCity] = useState('');
  const [driverRptCities, setDriverRptCities] = useState([]);
  const [driverRptMonths, setDriverRptMonths] = useState([]);
  const [driverRptMonth, setDriverRptMonth] = useState('');
  const [driverRptLoadingCities, setDriverRptLoadingCities] = useState(false);
  const [driverRptLoadingMonths, setDriverRptLoadingMonths] = useState(false);
  const [driverRptExporting, setDriverRptExporting] = useState(false);

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

  const loadDriverRptCities = async () => {
    setDriverRptLoadingCities(true);
    try {
      if (isAdmin) {
        const snap = await getDocs(collection(db, 'cloud_lists'));
        const cities = snap.docs
          .map(d => ({ id: d.id, lastMonthId: d.data().lastMonthId, totalQty: d.data().latestTotalQty || d.data().latestTotalCount || 0 }))
          .filter(c => c.id)
          .sort((a, b) => a.id.localeCompare(b.id, 'ko'));
        setDriverRptCities(cities);
      } else {
        setDriverRptCities((user?.citiesApproved || []).map(id => ({ id })));
      }
    } catch (e) {
      console.error('[기사별 명단 지자체 로드 실패]', e);
      setDriverRptCities([]);
    } finally {
      setDriverRptLoadingCities(false);
    }
  };

  const handleDriverRptCityChange = async (cityId) => {
    setDriverRptCity(cityId);
    setDriverRptMonth('');
    setDriverRptMonths([]);
    if (!cityId) return;
    setDriverRptLoadingMonths(true);
    try {
      const monthSnap = await getDocs(collection(db, 'cloud_lists', cityId, 'months'));
      const months = monthSnap.docs
        .map(d => ({
          id: d.id,
          totalCount: d.data().totalCount || 0,
          totalQty: d.data().totalQty || d.data().totalCount || 0,
          수급자Qty: d.data().수급자Qty || d.data().수급자Count || 0,
          차상위Qty: d.data().차상위Qty || d.data().차상위Count || 0,
        }))
        .sort((a, b) => b.id.localeCompare(a.id));
      setDriverRptMonths(months);
      const currentMonth = new Date();
      const currentMonthId = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      setDriverRptMonth((months.find(m => m.id === currentMonthId) || months[0])?.id || '');
    } catch (e) {
      console.error('[기사별 명단 월 로드 실패]', e);
      setDriverRptMonths([]);
    } finally {
      setDriverRptLoadingMonths(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'driverReport' && driverRptCities.length === 0 && !driverRptLoadingCities) {
      loadDriverRptCities();
    }
  }, [activeTab]);

  const loadRegisteredDriversForReport = async () => {
    const sources = [];
    if (user?.orgId) sources.push(['org_drivers', user.orgId]);
    if (user?.companyCode) sources.push(['user_companies', user.companyCode]);
    if (user?.uid) sources.push(['user_drivers', user.uid]);

    const byName = new Map();
    for (const [base, key] of sources) {
      try {
        const snap = await getDocs(collection(db, base, key, 'drivers'));
        snap.docs.forEach(d => {
          const data = { id: d.id, ...d.data() };
          const name = normalizeDriverName(data.name || data.driverName || data.기사);
          if (!name || name === '미배정' || byName.has(name)) return;
          byName.set(name, data);
        });
      } catch {
        // 권한이 없는 기사 저장소는 건너뛴다. 명단의 기사명은 별도로 포함된다.
      }
    }
    return [...byName.values()].sort((a, b) => normalizeDriverName(a.name).localeCompare(normalizeDriverName(b.name), 'ko', { numeric: true }));
  };

  const handleDriverRptExport = async () => {
    if (!driverRptCity || !driverRptMonth) return alert('지자체와 월을 선택하세요.');
    setDriverRptExporting(true);
    try {
      const [recSnap, registeredDrivers] = await Promise.all([
        getDocs(collection(db, 'cloud_lists', driverRptCity, 'months', driverRptMonth, 'records')),
        loadRegisteredDriversForReport(),
      ]);
      const allRecs = recSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!allRecs.length) return alert('선택한 월에 저장된 명단이 없습니다.');

      const wb = XLSX.utils.book_new();
      const usedSheetNames = new Set();
      const registeredByName = new Map();
      registeredDrivers.forEach(d => registeredByName.set(normalizeDriverName(d.name || d.driverName || d.기사), d));

      const driverDongMap = new Map();
      const ensureStat = (driver, dong) => {
        const key = `${driver}__${dong}`;
        if (!driverDongMap.has(key)) driverDongMap.set(key, {
          driver,
          dong,
          bas: 0,
          supp: 0,
          total: 0,
          count: 0,
          records: [],
          registered: Boolean(registeredByName.has(driver)),
        });
        return driverDongMap.get(key);
      };

      registeredDrivers.forEach(driver => {
        const driverName = normalizeDriverName(driver.name || driver.driverName || driver.기사);
        const zone = (driver.assignedZones || []).find(z => z.city === driverRptCity);
        const dongs = zone?.dongs?.length ? zone.dongs : ['배정행정동 없음'];
        dongs.forEach(dong => ensureStat(driverName, normalizeDongName(dong)).registered = true);
      });

      allRecs.forEach(record => {
        const driver = normalizeDriverName(record.기사 || record.driver);
        const dong = normalizeDongName(record.배정행정동 || record.행정동 || record.dong);
        const qty = getQtyForReport(record);
        const stat = ensureStat(driver, dong);
        stat.count += 1;
        stat.total += qty;
        if (isChasForReport(record)) stat.supp += qty;
        else stat.bas += qty;
        stat.records.push(record);
      });

      const summaryStats = [...driverDongMap.values()].sort((a, b) => {
        if (a.driver === '미배정') return 1;
        if (b.driver === '미배정') return -1;
        const driverCmp = a.driver.localeCompare(b.driver, 'ko', { numeric: true });
        if (driverCmp) return driverCmp;
        return a.dong.localeCompare(b.dong, 'ko', { numeric: true });
      });

      let grandBas = 0, grandSupp = 0, grandTotal = 0;
      const summaryRows = [['기사', '행정동', '수급자 포', '차상위 포', '합계', '건수']];
      summaryStats.forEach(stat => {
        summaryRows.push([stat.driver, stat.dong, stat.bas, stat.supp, stat.total, stat.count]);
        grandBas += stat.bas;
        grandSupp += stat.supp;
        grandTotal += stat.total;
      });
      summaryRows.push(['전체 합계', '', grandBas, grandSupp, grandTotal, allRecs.length]);
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
      summaryWs['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 }];
      summaryWs['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(summaryRows.length - 2, 0), c: 5 } }) };
      XLSX.utils.book_append_sheet(wb, summaryWs, safeSheetName('요약표', usedSheetNames));

      XLSX.utils.book_append_sheet(wb, makeDeliveryListSheet(allRecs, true), safeSheetName('전체명단', usedSheetNames));

      summaryStats
        .filter(stat => stat.records.length > 0)
        .forEach(stat => {
          const sheetName = safeSheetName(`${stat.driver}-${stat.dong}`, usedSheetNames);
          XLSX.utils.book_append_sheet(wb, makeDeliveryListSheet(stat.records, false), sheetName);
        });

      const ts = new Date().toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      }).replace(/[.\s:]/g, '');
      XLSX.writeFile(wb, `${driverRptCity}_${driverRptMonth}_기사별명단_${ts}.xlsx`);
    } catch (e) {
      alert('기사별 명단 다운로드 실패: ' + e.message);
      console.error(e);
    } finally {
      setDriverRptExporting(false);
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
    { id: 'driverReport', label: '기사명단',  icon: <Truck size={14} /> },
    { id: 'orgReport', label: '소속사전용',   icon: <Building2 size={14} /> },
    { id: 'audit',     label: '이력 관리',    icon: <History size={14} /> },
  ];

  const hasDedup = dedupResult && (
    dedupResult.strongGroups.length > 0 ||
    dedupResult.weakGroups.length > 0 ||
    (dedupResult.noNoteRows?.length ?? 0) > 0
  );
  const contentH = (activeTab === 'dedup' && dedupResult) || (activeTab === 'dong' && dongResult) || (activeTab === 'remap' && remapStep >= 2) || (activeTab === 'filemerge' && mergeStep >= 2) || (activeTab === 'match' && matchStep >= 2) || activeTab === 'format' || activeTab === 'driverReport' || activeTab === 'orgReport' ? 'h-[76vh] max-h-[820px] min-h-[640px]' : 'h-[620px]';

  return (
    <div className="absolute inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#111] border border-gray-700 rounded-3xl w-full max-w-7xl flex flex-col overflow-hidden shadow-2xl">

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
              <MergerTab
                executeMerge={executeMerge}
                handleMergerUpload={handleMergerUpload}
                isMerging={isMerging}
                mergerFile={mergerFile}
                mergerFileName={mergerFileName}
                setMergerFileName={setMergerFileName}
              />
            )}

            {/* ── 중복 데이터 정리 ── */}
            {activeTab === 'dedup' && (
              <DedupTab
                dedupFile={dedupFile}
                dedupResult={dedupResult}
                dedupSubTab={dedupSubTab}
                deleteRowNums={deleteRowNums}
                exportDedup={exportDedup}
                fmtPhone={fmtPhone}
                handleDedupUpload={handleDedupUpload}
                hasDedup={hasDedup}
                isAnalyzing={isAnalyzing}
                isExporting={isExporting}
                resetDedup={resetDedup}
                runAnalysis={runAnalysis}
                setDedupSubTab={setDedupSubTab}
                setDeleteRowNums={setDeleteRowNums}
                toggleGroup={toggleGroup}
                toggleRow={toggleRow}
              />
            )}

            {/* ── 찌꺼기 삭제 ── */}
            {activeTab === 'clean' && (
              <CleanTab
                cleanFile={cleanFile}
                cleanResult={cleanResult}
                exportClean={exportClean}
                fmtSize={fmtSize}
                handleCleanUpload={handleCleanUpload}
                isAnalyzingClean={isAnalyzingClean}
                isExportingClean={isExportingClean}
                resetClean={resetClean}
                runCleanAnalysis={runCleanAnalysis}
              />
            )}

            {/* ── 행정동 분리 ── */}
            {activeTab === 'dong' && (
              <DongTab
                dongFile={dongFile}
                dongFileName={dongFileName}
                dongOptions={dongOptions}
                dongResult={dongResult}
                exportDongSplit={exportDongSplit}
                handleDongUpload={handleDongUpload}
                isAnalyzingDong={isAnalyzingDong}
                isExportingDong={isExportingDong}
                resetDong={resetDong}
                selectedColIdxs={selectedColIdxs}
                setDongFileName={setDongFileName}
                setDongOptions={setDongOptions}
                setSelectedColIdxs={setSelectedColIdxs}
                toggleColIdx={toggleColIdx}
              />
            )}

            {/* ── 컬럼 재배치 ── */}
            {activeTab === 'remap' && (
              <RemapTab
                OUTPUT_COLS={OUTPUT_COLS}
                exportRemap={exportRemap}
                getPreviewRows={getPreviewRows}
                getRemapSampleVal={getRemapSampleVal}
                handleMappingChange={handleMappingChange}
                handleRemapUpload={handleRemapUpload}
                isAnalyzingRemap={isAnalyzingRemap}
                isExportingRemap={isExportingRemap}
                moveRemapCol={moveRemapCol}
                name={name}
                remapActiveHeaders={remapActiveHeaders}
                remapBaseSheet={remapBaseSheet}
                remapColOrder={remapColOrder}
                remapFile={remapFile}
                remapFileName={remapFileName}
                remapMapping={remapMapping}
                remapResult={remapResult}
                remapSelectedSheets={remapSelectedSheets}
                remapStep={remapStep}
                resetRemap={resetRemap}
                setRemapFileName={setRemapFileName}
                setRemapStep={setRemapStep}
                switchRemapBaseSheet={switchRemapBaseSheet}
                toggleRemapSheet={toggleRemapSheet}
              />
            )}

            {/* ── 파일 합치기 ── */}
            {activeTab === 'filemerge' && (
              <FileMergeTab
                switchMergeBaseSheet={switchMergeBaseSheet}
                toggleMergeSheet={toggleMergeSheet}
                mergeStep={mergeStep}
                setMergeStep={setMergeStep}
                mergeFileA={mergeFileA}
                mergeFileB={mergeFileB}
                mergeResultA={mergeResultA}
                mergeResultB={mergeResultB}
                mergeMappingA={mergeMappingA}
                mergeMappingB={mergeMappingB}
                mergeSelectedSheetsA={mergeSelectedSheetsA}
                mergeSelectedSheetsB={mergeSelectedSheetsB}
                mergeBaseSheetA={mergeBaseSheetA}
                mergeBaseSheetB={mergeBaseSheetB}
                mergeActiveHeadersA={mergeActiveHeadersA}
                mergeActiveHeadersB={mergeActiveHeadersB}
                isAnalyzingMergeA={isAnalyzingMergeA}
                isAnalyzingMergeB={isAnalyzingMergeB}
                isExportingMerge={isExportingMerge}
                mergeFileName={mergeFileName}
                setMergeFileName={setMergeFileName}
                handleMergeUpload={handleMergeUpload}
                handleMergeMappingChange={handleMergeMappingChange}
                getMergePreviewRows={getMergePreviewRows}
                exportFileMerge={exportFileMerge}
                resetFileMerge={resetFileMerge}
                OUTPUT_COLS={OUTPUT_COLS}
              />
            )}

            {/* ── DATA 매칭 ── */}
            {activeTab === 'match' && (
              <MatchTab
                downloadMatchResult={downloadMatchResult}
                fmtSize={fmtSize}
                handleMatchSourceSheetChange={handleMatchSourceSheetChange}
                handleMatchSourceUpload={handleMatchSourceUpload}
                handleMatchTargetSheetChange={handleMatchTargetSheetChange}
                handleMatchTargetUpload={handleMatchTargetUpload}
                isMatchAnalyzingSource={isMatchAnalyzingSource}
                isMatchAnalyzingTarget={isMatchAnalyzingTarget}
                isMatchRunning={isMatchRunning}
                matchResultBlob={matchResultBlob}
                matchSourceFile={matchSourceFile}
                matchSourceHeaders={matchSourceHeaders}
                matchSourceKeyMap={matchSourceKeyMap}
                matchSourceResult={matchSourceResult}
                matchSourceSheet={matchSourceSheet}
                matchStats={matchStats}
                matchStep={matchStep}
                matchTargetFile={matchTargetFile}
                matchTargetHeaders={matchTargetHeaders}
                matchTargetKeyMap={matchTargetKeyMap}
                matchTargetResult={matchTargetResult}
                matchTargetSheet={matchTargetSheet}
                matchTransplantCols={matchTransplantCols}
                resetMatch={resetMatch}
                runDataMatch={runDataMatch}
                setMatchSourceKeyMap={setMatchSourceKeyMap}
                setMatchStep={setMatchStep}
                setMatchTargetKeyMap={setMatchTargetKeyMap}
                setMatchTransplantCols={setMatchTransplantCols}
              />
            )}

            {/* ── 스타일 서식 ── */}
            {activeTab === 'format' && (
              <FormatTab
                STYLE_PRESETS={STYLE_PRESETS}
                fmtSize={fmtSize}
                formatFile={formatFile}
                formatInfo={formatInfo}
                handleFormatUpload={handleFormatUpload}
                isFormatAnalyzing={isFormatAnalyzing}
                isFormatProcessing={isFormatProcessing}
                resetFormat={resetFormat}
                runFormatExcel={runFormatExcel}
                selectedStyleId={selectedStyleId}
                setSelectedStyleId={setSelectedStyleId}
              />
            )}

            {/* ── 기사별 명단 ── */}
            {activeTab === 'driverReport' && (
              <DriverReportTab
                driverRptCities={driverRptCities}
                driverRptCity={driverRptCity}
                driverRptExporting={driverRptExporting}
                driverRptLoadingCities={driverRptLoadingCities}
                driverRptLoadingMonths={driverRptLoadingMonths}
                driverRptMonth={driverRptMonth}
                driverRptMonths={driverRptMonths}
                handleDriverRptCityChange={handleDriverRptCityChange}
                handleDriverRptExport={handleDriverRptExport}
                setDriverRptMonth={setDriverRptMonth}
              />
            )}

            {/* ── 소속사전용 ── */}
            {activeTab === 'orgReport' && (
              <OrgReportTab
                handleOrgRptCityChange={handleOrgRptCityChange}
                handleOrgRptExport={handleOrgRptExport}
                isAdmin={isAdmin}
                loadOrgRptAdminCities={loadOrgRptAdminCities}
                orgRptCities={orgRptCities}
                orgRptCity={orgRptCity}
                orgRptExporting={orgRptExporting}
                orgRptLatestMonth={orgRptLatestMonth}
                orgRptLoadingCities={orgRptLoadingCities}
                orgRptLoadingMonth={orgRptLoadingMonth}
                user={user}
              />
            )}

            {activeTab === 'audit' && (
              <AuditTab
                fetchLogs={fetchLogs}
                handleSendNotification={handleSendNotification}
                loadingLogs={loadingLogs}
                logs={logs}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
