import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getDocs, getDoc, updateDoc, setDoc, deleteDoc, doc, collection, db, serverTimestamp, Timestamp, addDoc, query, where, orderBy, limit, writeBatch, onSnapshot, arrayUnion, arrayRemove } from '../config/firebase.js';
const ttl90 = () => Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000);
import { X, Users, BarChart2, Clock, ShieldOff, ShieldCheck, AlertTriangle, Crown, MessageSquare, CheckCircle2, MapPin, XCircle, Building2, ShieldAlert, Plus, ChevronDown, TrendingUp, AlertCircle, UserX, Activity, Zap, Trash2, Truck, Edit2, RefreshCw, UserCheck, ChevronRight } from 'lucide-react';
import { REGIONS, getSigunguOptions } from '../utils/regions.js';

const getProcessedRows = (u) => Number(u?.totalRowsProcessed || u?.processedRows || u?.totalProcessedRows || 0);
const getProcessedFiles = (u) => Number(u?.totalFilesProcessed || u?.processedFiles || u?.totalProcessedFiles || 0);

function OrgSelect({ value, options, onChange, onBulkAssign }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const dropRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 224 });

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, minWidth: Math.max(rect.width, 224) });
    }
    setOpen(o => !o);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={`w-full flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
          value
            ? 'border-purple-600/50 bg-purple-950/40 text-purple-200 hover:border-purple-400/70'
            : 'border-[#333] bg-black/60 text-gray-500 hover:border-[#555]'
        }`}
      >
        <span className="truncate max-w-[120px]">{value || '소속 없음'}</span>
        <ChevronDown size={10} className="shrink-0 opacity-60" />
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth, zIndex: 99999 }}
          className="bg-[#111a12] border border-[#3b82f6]/25 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.95)] overflow-hidden"
        >
          <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2d4a35] scrollbar-track-transparent">
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className={`w-full text-left px-4 py-3 text-[12px] font-bold transition-colors border-b border-[#0f1a2e] ${
                !value ? 'text-[#3b82f6] bg-[#3b82f6]/10' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
              }`}
            >
              소속 없음
            </button>
            {options.map(name => (
              <button
                key={name}
                onClick={() => { onChange(name); setOpen(false); }}
                className={`w-full text-left px-4 py-3 text-[12px] font-bold transition-colors ${
                  value === name
                    ? 'text-purple-200 bg-purple-900/40 border-l-2 border-purple-500'
                    : 'text-gray-300 hover:bg-white/5 hover:text-white border-l-2 border-transparent'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          {onBulkAssign && (
            <div className="border-t border-[#1a2a1a] p-2">
              <button
                onClick={() => { onBulkAssign(value); setOpen(false); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] font-black text-amber-400 bg-amber-950/30 border border-amber-700/30 rounded-lg hover:bg-amber-900/40 transition-colors"
              >
                <Users size={11}/> 소속 없는 사용자 전체 배정
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function CompanySelect({ value, companies, onChange }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const dropRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 220 });

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, minWidth: Math.max(rect.width, 220) });
    }
    setOpen(o => !o);
  };

  const selected = companies.find(c => c.id === value);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={`w-full flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
          value
            ? 'border-blue-600/50 bg-blue-950/40 text-blue-200 hover:border-blue-400/70'
            : 'border-[#333] bg-black/60 text-gray-500 hover:border-[#555]'
        }`}
      >
        <span className="truncate max-w-[130px]">{selected ? selected.name : '회사 없음'}</span>
        <ChevronDown size={10} className="shrink-0 opacity-60" />
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth, zIndex: 99999 }}
          className="bg-[#111a12] border border-blue-600/25 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.95)] overflow-hidden"
        >
          <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2d4a35]">
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className={`w-full text-left px-4 py-3 text-[12px] font-bold transition-colors border-b border-[#0f1a2e] ${
                !value ? 'text-blue-300 bg-blue-900/20' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
              }`}
            >회사 연결 없음</button>
            {companies.map(c => (
              <button
                key={c.id}
                onClick={() => { onChange(c.id); setOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-[12px] transition-colors hover:bg-white/5 ${
                  value === c.id ? 'text-blue-200 bg-blue-900/30 font-black' : 'text-gray-300 font-bold'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{c.name}</span>
                  <span className="text-[9px] text-gray-600 font-mono">{c.id}</span>
                </div>
                {c.cities?.length > 0 && (
                  <div className="text-[10px] text-gray-600 mt-0.5">{c.cities.slice(0, 3).join(', ')}{c.cities.length > 3 ? ` +${c.cities.length - 3}` : ''}</div>
                )}
              </button>
            ))}
            {companies.length === 0 && (
              <p className="px-4 py-3 text-gray-600 text-[11px]">등록된 회사 없음 — 소속사·회사 관리에서 추가하세요</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const fmt = (ts) => {
  if (!ts?.seconds) return '-';
  const d = new Date(ts.seconds * 1000);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const TIERS = {
  basic:    { label: '기본',     emoji: '⚪', color: 'text-gray-400',   bg: 'bg-gray-800/60',    border: 'border-gray-600/40' },
  vip:      { label: 'VIP',      emoji: '🔵', color: 'text-blue-300',   bg: 'bg-blue-950/60',    border: 'border-blue-600/40' },
  vvip:     { label: 'VVIP',     emoji: '🟣', color: 'text-purple-300', bg: 'bg-purple-950/60',  border: 'border-purple-600/40' },
  sapphire: { label: '사파이어', emoji: '💎', color: 'text-cyan-300',   bg: 'bg-cyan-950/60',    border: 'border-cyan-500/40' },
};

const TierBadge = ({ tier }) => {
  const t = TIERS[tier] || TIERS.basic;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black border ${t.bg} ${t.color} ${t.border}`}>
      {t.emoji} {t.label}
    </span>
  );
};

const TIER_DEFAULT_CITIES = { basic: 1, vip: 3, vvip: 10, sapphire: 999 };

const ROLES = {
  admin: { label: '최고관리자', emoji: '👑', color: 'text-amber-300', bg: 'bg-amber-950/60', border: 'border-amber-700/50' },
  user:  { label: '사용자',     emoji: '👤', color: 'text-gray-400',  bg: 'bg-gray-800/60',  border: 'border-gray-600/40' },
};

const RoleBadge = ({ role }) => {
  const r = ROLES[role] || ROLES.user;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black border ${r.bg} ${r.color} ${r.border}`}>
      {r.emoji} {r.label}
    </span>
  );
};

export default function AdminPanel({ onClose, user }) {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [migrationStatus, setMigrationStatus] = useState(null); // null | 'running' | { done, total, updated }
  const [banTarget, setBanTarget] = useState(null);
  const [banReason, setBanReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [tierTarget, setTierTarget] = useState(null);
  const [roleTarget, setRoleTarget] = useState(null);
  const [editingCity, setEditingCity] = useState({});
  const [allUsersCount, setAllUsersCount] = useState(0);
  const [allTotalRows, setAllTotalRows] = useState(0);
  const [allTotalFiles, setAllTotalFiles] = useState(0);
  const [allBannedCount, setAllBannedCount] = useState(0);
  const [editingCompany, setEditingCompany] = useState(null);
  const [editingRealName, setEditingRealName] = useState({});

  // 사용자 기사 관리 모달
  const [driverManageTarget, setDriverManageTarget] = useState(null); // 선택된 user 객체
  const [driverManageList, setDriverManageList] = useState([]);
  const [driverManageLoading, setDriverManageLoading] = useState(false);
  const [driverManageForm, setDriverManageForm] = useState(null); // null|{id,name,capacity,color,status,memo}
  const [driverManageSaving, setDriverManageSaving] = useState(false);

  // AI Advisor States
  const [aiLogs, setAiLogs] = useState([]);
  const [aiLogsAll, setAiLogsAll] = useState([]); // applied/rejected 포함 전체
  const [aiFilter, setAiFilter] = useState('applied'); // 'all' | 'applied' | 'pending'
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRules, setAiRules] = useState(null);
  const [userMappingStats, setUserMappingStats] = useState([]);

  const [inquiries, setInquiries] = useState([]);
  const [editingAiRule, setEditingAiRule] = useState(null);
  const [editingAiRuleNewField, setEditingAiRuleNewField] = useState('');

  // 소속사 글로벌 목록 (nexus_config/orgs)
  const [globalOrgs, setGlobalOrgs] = useState([]);
  const [orgCities, setOrgCities] = useState({}); // { orgName: string[] }
  const [newOrgInput, setNewOrgInput] = useState('');
  const [showOrgMgr, setShowOrgMgr] = useState(false);
  const [orgMgrTab, setOrgMgrTab] = useState('org'); // 'org' | 'company'

  // 소속사 지자체 picker (org manager modal)
  const [orgCityPicker, setOrgCityPicker] = useState(null); // orgName
  const [orgCityPickerSido, setOrgCityPickerSido] = useState('');
  const [orgCityPickerSigungu, setOrgCityPickerSigungu] = useState('');

  // 회사 목록 (user_companies)
  const [userCompanies, setUserCompanies] = useState([]);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [companyCityPicker, setCompanyCityPicker] = useState(null); // companyCode
  const [companyCityPickerSido, setCompanyCityPickerSido] = useState('');
  const [companyCityPickerSigungu, setCompanyCityPickerSigungu] = useState('');

  // 소속사 열 탭 모드: {uid: 'org'|'company'}
  const [orgCellMode, setOrgCellMode] = useState({});

  // 지자체 직접 추가 picker
  const [cityPickerUid, setCityPickerUid] = useState(null);
  const [cityPickerSido, setCityPickerSido] = useState('');
  const [cityPickerSigungu, setCityPickerSigungu] = useState('');

  // 운영 현황
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [tierUpgradeTarget, setTierUpgradeTarget] = useState(null); // { inq, matchedUser, newTier }

  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    try {
      // 최근 200건만 — audit_logs는 계속 쌓이므로 전체 로드 금지
      const snap = await getDocs(query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(200)));
      setAuditLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch { setAuditLogs([]); }
    finally { setAuditLoading(false); }
  };

  // DB 마이그레이션: 동사무소/읍사무소/면사무소 → 주민센터
  const runOfficeMigration = async () => {
    if (migrationStatus === 'running') return;
    if (!window.confirm('base_lists 전체를 스캔하여 "동사무소/읍사무소/면사무소"를 "주민센터"로 일괄 변경합니다.\n\n계속하시겠습니까?')) return;
    setMigrationStatus('running');
    const OFFICE_RE = /동사무소|읍사무소|면사무소/g;
    const replace   = (v) => typeof v === 'string' ? v.replace(OFFICE_RE, '주민센터') : v;
    let totalScanned = 0, totalUpdated = 0;
    try {
      // 모든 도시(base_lists 최상위 문서) 목록 조회
      const citySnap = await getDocs(collection(db, 'base_lists'));
      const cities   = citySnap.docs.map(d => d.id);
      for (const city of cities) {
        const recSnap = await getDocs(collection(db, 'base_lists', city, 'records'));
        const toUpdate = [];
        recSnap.docs.forEach(d => {
          const data = d.data();
          const newNote    = replace(data.note    || '');
          const newAddress = replace(data.address || '');
          if (newNote !== (data.note || '') || newAddress !== (data.address || '')) {
            toUpdate.push({ id: d.id, note: newNote, address: newAddress });
          }
          totalScanned++;
        });
        // 499건씩 배치 커밋
        for (let i = 0; i < toUpdate.length; i += 499) {
          const batch = writeBatch(db);
          toUpdate.slice(i, i + 499).forEach(({ id, note, address }) => {
            batch.set(doc(db, 'base_lists', city, 'records', id), { note, address }, { merge: true });
          });
          await batch.commit();
          totalUpdated += toUpdate.slice(i, i + 499).length;
        }
        setMigrationStatus({ done: totalScanned, updated: totalUpdated });
      }
      setMigrationStatus({ done: totalScanned, updated: totalUpdated, finished: true });
    } catch (e) {
      console.error('[Migration]', e);
      setMigrationStatus({ error: e.message || '오류 발생' });
    }
  };

  const handleTierUpgradeInquiry = async () => {
    if (!tierUpgradeTarget) return;
    const { inq, matchedUser, newTier } = tierUpgradeTarget;
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      const defaultMax = TIER_DEFAULT_CITIES[newTier] ?? 1;
      batch.update(doc(db, 'users', matchedUser.id), { tier: newTier, maxCities: defaultMax });
      batch.update(doc(db, 'inquiries', inq.id), { status: 'completed', completedAt: serverTimestamp(), approvedTier: newTier });
      await batch.commit();
      setUsers(prev => prev.map(u => u.id === matchedUser.id ? { ...u, tier: newTier, maxCities: defaultMax } : u));
      setInquiries(prev => prev.map(i => i.id === inq.id ? { ...i, status: 'completed', approvedTier: newTier } : i));
      setTierUpgradeTarget(null);
    } catch (e) { alert('처리 실패: ' + e.message); }
    finally { setProcessing(false); }
  };

  const loadGlobalOrgs = async () => {
    try {
      const snap = await getDoc(doc(db, 'nexus_config', 'orgs'));
      if (snap.exists()) {
        setGlobalOrgs(snap.data().list || []);
        setOrgCities(snap.data().cities || {});
      }
    } catch { setGlobalOrgs([]); }
  };

  const addGlobalOrg = async () => {
    const name = newOrgInput.trim();
    if (!name || globalOrgs.includes(name)) return;
    const next = [...globalOrgs, name].sort();
    try {
      await setDoc(doc(db, 'nexus_config', 'orgs'), { list: next }, { merge: true });
      setGlobalOrgs(next);
      setNewOrgInput('');
    } catch (e) { alert('소속사 추가 실패: ' + e.message); }
  };

  const removeGlobalOrg = async (name) => {
    if (!window.confirm(`'${name}' 소속사를 목록에서 제거하시겠습니까?\n(기존 배정된 유저의 소속은 유지됩니다)`)) return;
    const next = globalOrgs.filter(n => n !== name);
    try {
      await setDoc(doc(db, 'nexus_config', 'orgs'), { list: next }, { merge: true });
      setGlobalOrgs(next);
    } catch (e) { alert('소속사 제거 실패: ' + e.message); }
  };

  const saveUserOrg = async (uid, orgName) => {
    const cities = orgName ? (orgCities[orgName] || []) : undefined;
    try {
      await updateDoc(doc(db, 'users', uid), {
        orgId: orgName || null,
        ...(orgName && cities.length > 0 ? { citiesApproved: cities } : {}),
      });
      setUsers(prev => prev.map(u => u.id === uid
        ? { ...u, orgId: orgName || null, ...(orgName && cities.length > 0 ? { citiesApproved: cities } : {}) }
        : u));
    } catch (e) { alert('소속사 배정 실패: ' + e.message); }
  };

  // ── 소속사 지자체 관리 ──────────────────────────────────────────────────
  const updateOrgCities = async (orgName, cities) => {
    const newOrgCities = { ...orgCities, [orgName]: cities };
    try {
      await setDoc(doc(db, 'nexus_config', 'orgs'), { cities: newOrgCities }, { merge: true });
      setOrgCities(newOrgCities);
      const affected = users.filter(u => u.orgId === orgName);
      if (affected.length > 0) {
        const batch = writeBatch(db);
        affected.forEach(u => batch.update(doc(db, 'users', u.id), { citiesApproved: cities }));
        await batch.commit();
        setUsers(prev => prev.map(u => u.orgId === orgName ? { ...u, citiesApproved: cities } : u));
      }
    } catch (e) { alert('소속사 지자체 업데이트 실패: ' + e.message); }
  };

  // ── 회사(user_companies) CRUD ──────────────────────────────────────────
  const loadAllCompanies = async () => {
    try {
      const snap = await getDocs(collection(db, 'user_companies'));
      setUserCompanies(snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    } catch (e) { console.error(e); }
  };

  const addCompany = async () => {
    const name = newCompanyName.trim();
    if (!name) return;
    const ts = Date.now().toString(36).toUpperCase().slice(-5);
    const rand = Math.random().toString(36).substr(2, 4).toUpperCase();
    const code = `NX-${ts}${rand}`;
    try {
      await setDoc(doc(db, 'user_companies', code), {
        code, name, cities: [], createdAt: serverTimestamp(), createdBy: user?.email || 'admin',
      });
      setUserCompanies(prev => [...prev, { id: code, code, name, cities: [] }]
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setNewCompanyName('');
    } catch (e) { alert('회사 추가 실패: ' + e.message); }
  };

  const deleteCompany = async (code) => {
    const comp = userCompanies.find(c => c.id === code);
    if (!window.confirm(`'${comp?.name || code}' 회사를 삭제하시겠습니까?\n연결된 사용자의 회사코드는 초기화됩니다.`)) return;
    try {
      const affected = users.filter(u => u.companyCode === code);
      if (affected.length > 0) {
        const batch = writeBatch(db);
        affected.forEach(u => batch.update(doc(db, 'users', u.id), { companyCode: null }));
        await batch.commit();
        setUsers(prev => prev.map(u => u.companyCode === code ? { ...u, companyCode: null } : u));
      }
      await deleteDoc(doc(db, 'user_companies', code));
      setUserCompanies(prev => prev.filter(c => c.id !== code));
    } catch (e) { alert('회사 삭제 실패: ' + e.message); }
  };

  const updateCompanyName = async (id, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) { setEditingCompany(null); return; }
    try {
      await updateDoc(doc(db, 'user_companies', id), { name: trimmed });
      setUserCompanies(prev => prev.map(c => c.id === id ? { ...c, name: trimmed } : c)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setEditingCompany(null);
    } catch (e) { alert('회사명 수정 실패: ' + e.message); }
  };

  const saveUserCompany = async (uid, code) => {
    const company = userCompanies.find(c => c.id === code);
    const cities = company?.cities || [];
    try {
      await updateDoc(doc(db, 'users', uid), {
        companyCode: code || null,
        ...(code && cities.length > 0 ? { citiesApproved: cities } : {}),
      });
      setUsers(prev => prev.map(u => u.id === uid
        ? { ...u, companyCode: code || null, ...(code && cities.length > 0 ? { citiesApproved: cities } : {}) }
        : u));
    } catch (e) { alert('회사 배정 실패: ' + e.message); }
  };

  const updateCompanyCities = async (code, cities) => {
    try {
      await updateDoc(doc(db, 'user_companies', code), { cities });
      setUserCompanies(prev => prev.map(c => c.id === code ? { ...c, cities } : c));
      const affected = users.filter(u => u.companyCode === code);
      if (affected.length > 0) {
        const batch = writeBatch(db);
        affected.forEach(u => batch.update(doc(db, 'users', u.id), { citiesApproved: cities }));
        await batch.commit();
        setUsers(prev => prev.map(u => u.companyCode === code ? { ...u, citiesApproved: cities } : u));
      }
    } catch (e) { alert('회사 지자체 업데이트 실패: ' + e.message); }
  };

  const addCityToCompany = async (code, cityId) => {
    const comp = userCompanies.find(c => c.id === code);
    if (!comp || !cityId) return;
    const cities = [...new Set([...(comp.cities || []), cityId])];
    await updateCompanyCities(code, cities);
    setCompanyCityPickerSido(''); setCompanyCityPickerSigungu(''); setCompanyCityPicker(null);
  };

  const removeCityFromCompany = async (code, cityId) => {
    const comp = userCompanies.find(c => c.id === code);
    if (!comp) return;
    await updateCompanyCities(code, (comp.cities || []).filter(c => c !== cityId));
  };

  const handleBulkAssignOrg = async (orgName) => {
    const targets = users.filter(u => !u.orgId);
    if (!targets.length) { alert('소속이 없는 사용자가 없습니다.'); return; }
    if (!window.confirm(`소속 없는 사용자 ${targets.length}명에게\n"${orgName || '소속 없음'}"을 일괄 배정하시겠습니까?`)) return;
    try {
      const batch = writeBatch(db);
      targets.forEach(u => batch.update(doc(db, 'users', u.id), { orgId: orgName || null }));
      await batch.commit();
      setUsers(prev => prev.map(u => !u.orgId ? { ...u, orgId: orgName || null } : u));
    } catch (e) { alert('일괄 배정 실패: ' + e.message); }
  };

  const addCityToUser = async (uid, cityId) => {
    if (!cityId) return;
    try {
      await updateDoc(doc(db, 'users', uid), { citiesApproved: arrayUnion(cityId) });
      setUsers(prev => prev.map(u =>
        u.id === uid ? { ...u, citiesApproved: [...new Set([...(u.citiesApproved || []), cityId])] } : u
      ));
      setCityPickerUid(null);
      setCityPickerSido('');
      setCityPickerSigungu('');
    } catch (e) { alert('지자체 추가 실패: ' + e.message); }
  };

  const removeCityFromUser = async (uid, cityId) => {
    if (!window.confirm(`'${cityId}' 접근 권한을 제거하시겠습니까?`)) return;
    try {
      await updateDoc(doc(db, 'users', uid), { citiesApproved: arrayRemove(cityId) });
      setUsers(prev => prev.map(u =>
        u.id === uid ? { ...u, citiesApproved: (u.citiesApproved || []).filter(c => c !== cityId) } : u
      ));
    } catch (e) { alert('지자체 제거 실패: ' + e.message); }
  };

  const fetchUsers = () => {
    setLoading(true);
    getDocs(query(collection(db, 'users'), orderBy('lastLogin', 'desc'), limit(500))).then(snap => {
      const allList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllUsersCount(allList.length);
      setAllTotalRows(allList.reduce((s, u) => s + getProcessedRows(u), 0));
      setAllTotalFiles(allList.reduce((s, u) => s + getProcessedFiles(u), 0));
      setAllBannedCount(allList.filter(u => u.status === 'banned').length);
      setUsers(allList.filter(u => u.id !== user?.uid));
    }).finally(() => setLoading(false));
  };

  const FIELD_LABELS = {
    name: '성명', contact1: '연락처', address: '주소', qty: '포수', admin: '행정동',
    contact2: '보조연락처', birth: '생년월일', note: '특이사항', sms: '문자수신',
    type: '수급구분', driver: '기사', seqNo: '배송순번',
  };

  const fetchAiData = async () => {
    setAiLoading(true);
    try {
      const [logsSnap, rulesSnap] = await Promise.all([
        // 최근 1,000건만 — 전체 스캔 방지
        getDocs(query(collection(db, 'nexus_ai_logs'), orderBy('createdAt', 'desc'), limit(1000))),
        getDocs(collection(db, 'nexus_config'))
      ]);
      const allLogs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const nonMappingLogs = allLogs.filter(l => l.type !== 'user_mapping');
      setAiLogsAll(nonMappingLogs);
      const logs = nonMappingLogs.filter(l => l.status === 'pending');
      setAiLogs(logs);

      const mappingLogs = allLogs.filter(l => l.type === 'user_mapping' && l.columnName && l.mappedTo);
      const grouped = {};
      mappingLogs.forEach(l => {
        const col = l.columnName;
        if (!grouped[col]) grouped[col] = {};
        grouped[col][l.mappedTo] = (grouped[col][l.mappedTo] || 0) + 1;
      });
      const stats = Object.entries(grouped).map(([col, counts]) => {
        const total = Object.values(counts).reduce((s, n) => s + n, 0);
        const [topField, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        return {
          col, topField, topCount, total,
          confidence: Math.round((topCount / total) * 100),
          fieldLabel: FIELD_LABELS[topField] || topField,
        };
      }).sort((a, b) => b.total - a.total);
      setUserMappingStats(stats);

      const ruleDoc = rulesSnap.docs.find(d => d.id === 'ai_rules');
      if (ruleDoc) setAiRules(ruleDoc.data());
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchAiData();
    fetchInquiries();
    fetchAuditLogs();
    loadGlobalOrgs();
    loadAllCompanies();

  }, []);

  const fetchInquiries = () => {
    getDocs(collection(db, 'inquiries')).then(snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setInquiries(list);
    });
  };

  const handleDeleteInquiry = async (inqId) => {
    if (!window.confirm('이 문의를 영구 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, 'inquiries', inqId));
      setInquiries(prev => prev.filter(i => i.id !== inqId));
    } catch (e) { alert('삭제 실패: ' + e.message); }
  };

  const analyzeSuggestion = (colName) => {
    const rules = [
      { key: '이름', match: /명$|자$|성함|수령인/, score: 90 },
      { key: '연락처', match: /번호|폰|휴대|연락|전화/, score: 95 },
      { key: '주소', match: /거주지|소재지|배송지|위치/, score: 85 },
      { key: '수량', match: /갯수|개수|지원량|지급량|포/, score: 80 }
    ];
    let best = { key: '알수없음', score: 0, reason: '패턴 불일치' };
    for (const r of rules) {
      if (r.match.test(colName) && r.score > best.score) {
        best = { key: r.key, score: r.score, reason: `'${r.key}' 관련 키워드 감지됨` };
      }
    }
    if (colName.length > 8 && best.score > 0) {
      best.score -= 20;
      best.reason += ' (단축 필요)';
    }
    return best;
  };

  const handleAcceptAiSuggestion = async (colName, targetKey) => {
    setProcessing(true);
    try {
      const analysis = analyzeSuggestion(colName);
      if (analysis.score < 50) {
        if (!window.confirm(`AI 신뢰도가 ${analysis.score}%로 낮습니다. 정말 적용하시겠습니까?`)) {
          setProcessing(false);
          return;
        }
      }
      const ref = doc(db, 'nexus_config', 'ai_rules');
      let currentRules = aiRules?.reqKeys || [
        { k: '이름', kws: ['이름', '성명', '대상자', '수령자명'] },
        { k: '주소', kws: ['주소'] },
        { k: '수량', kws: ['포수', '수량', '구입량', '가구원수', '포'] },
        { k: '연락처', kws: ['휴대', '연락', '전화', '유선', '핸드폰', '핸드', '모바일', '휴폰'] }
      ];
      const targetRuleIdx = currentRules.findIndex(r => r.k === targetKey);
      if (targetRuleIdx >= 0) {
        if (!currentRules[targetRuleIdx].kws.includes(colName)) {
          currentRules[targetRuleIdx].kws.push(colName);
        }
      } else {
        currentRules.push({ k: targetKey, kws: [colName] });
      }
      const currentForced = aiRules?.forced || [];
      await setDoc(ref, { reqKeys: currentRules, forced: [...new Set([...currentForced, colName])] }, { merge: true });
      const logsToUpdate = aiLogs.filter(l => {
        const colList = Array.isArray(l.cols) ? l.cols : (l.columnName ? [l.columnName] : []);
        return colList.includes(colName);
      });
      for (const l of logsToUpdate) {
        await updateDoc(doc(db, 'nexus_ai_logs', l.id), { status: 'applied', appliedKey: targetKey, appliedCol: colName });
      }
      fetchAiData();
    } catch (err) {
      console.error(err);
      alert('규칙 업데이트 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectAiSuggestion = async (colName) => {
    setProcessing(true);
    try {
      const logsToUpdate = aiLogs.filter(l => {
        const colList = Array.isArray(l.cols) ? l.cols : (l.columnName ? [l.columnName] : []);
        return colList.includes(colName);
      });
      for (const l of logsToUpdate) {
        await updateDoc(doc(db, 'nexus_ai_logs', l.id), { status: 'rejected', rejectedCol: colName });
      }
      fetchAiData();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteAiRuleKeyword = async (ruleKey, keyword) => {
    if (!aiRules?.reqKeys) return;
    const newReqKeys = aiRules.reqKeys.map(r =>
      r.k === ruleKey ? { ...r, kws: r.kws.filter(kw => kw !== keyword) } : r
    ).filter(r => r.kws.length > 0);
    const newForced = (aiRules.forced || []).filter(f => f !== keyword);
    try {
      await setDoc(doc(db, 'nexus_config', 'ai_rules'), { reqKeys: newReqKeys, forced: newForced }, { merge: true });
      setAiRules(prev => ({ ...prev, reqKeys: newReqKeys, forced: newForced }));
    } catch (e) { alert('규칙 삭제 실패: ' + e.message); }
  };

  const handleDeleteAiLog = async (colName) => {
    const logsToUpdate = aiLogsAll.filter(l => {
      const colList = Array.isArray(l.cols) ? l.cols : (l.columnName ? [l.columnName] : []);
      return colList.includes(colName) && l.status === 'pending';
    });
    try {
      for (const l of logsToUpdate) {
        await updateDoc(doc(db, 'nexus_ai_logs', l.id), { status: 'rejected', rejectedCol: colName });
      }
      setAiLogs(prev => prev.filter(l => {
        const colList = Array.isArray(l.cols) ? l.cols : (l.columnName ? [l.columnName] : []);
        return !colList.includes(colName);
      }));
    } catch (e) { alert('제안 삭제 실패: ' + e.message); }
  };

  const buildSuggestions = (logs) => {
    const agg = {};
    logs.forEach(l => {
      const colList = Array.isArray(l.cols) ? l.cols : (l.columnName ? [l.columnName] : []);
      const appliedKey = l.appliedKey || null;
      colList.forEach(c => {
        if (!agg[c]) agg[c] = { count: 0, files: new Set(), status: l.status || 'pending', appliedKey };
        agg[c].count++;
        agg[c].files.add(l.fileName);
        if (l.status === 'applied') agg[c].status = 'applied';
      });
    });
    return Object.entries(agg)
      .map(([col, data]) => ({ col, count: data.count, files: [...data.files], status: data.status, appliedKey: data.appliedKey, analysis: analyzeSuggestion(col) }))
      .sort((a, b) => b.count - a.count);
  };

  const pendingAiSuggestions = buildSuggestions(aiLogs);
  const pendingSuggestionsCount = pendingAiSuggestions.length;
  const appliedRulesCount = (aiRules?.reqKeys || []).reduce((s, r) => s + r.kws.length, 0);

  const tierCounts = Object.keys(TIERS).reduce((acc, k) => {
    acc[k] = users.filter(u => (u.tier || 'basic') === k).length;
    return acc;
  }, {});
  const totalRows   = users.reduce((s, u) => s + getProcessedRows(u), 0);
  const totalFiles  = users.reduce((s, u) => s + getProcessedFiles(u), 0);
  const bannedCount = users.filter(u => u.status === 'banned').length;

  const nowSec = Date.now() / 1000;
  const churnRisk = users.filter(u => {
    const lastSec = u.lastLogin?.seconds || 0;
    return lastSec > 0 && (nowSec - lastSec) > 60 * 24 * 3600 && u.status !== 'banned';
  }).sort((a, b) => (a.lastLogin?.seconds || 0) - (b.lastLogin?.seconds || 0));

  const nearLimit = users.filter(u => {
    const max = u.maxCities ?? TIER_DEFAULT_CITIES[u.tier || 'basic'] ?? 1;
    const used = (u.citiesApproved || []).length;
    return max < 999 && max > 0 && used / max >= 0.8;
  });

  const cityUsageStats = (() => {
    const map = {};
    auditLogs.forEach(log => {
      const city = log.city || '미지정';
      if (!map[city]) map[city] = { city, sessions: 0, added: 0, updated: 0, lastSec: 0 };
      map[city].sessions++;
      map[city].added += log.addCount || 0;
      map[city].updated += log.updateCount || 0;
      const sec = log.timestamp?.seconds || log.createdAt?.seconds || 0;
      if (sec > map[city].lastSec) map[city].lastSec = sec;
    });
    return Object.values(map).sort((a, b) => b.sessions - a.sessions);
  })();

  const handleRoleChange = async () => {
    if (!roleTarget) return;
    setProcessing(true);
    try {
      await updateDoc(doc(db, 'users', roleTarget.user.id), { role: roleTarget.newRole });
      setUsers(prev => prev.map(u => u.id === roleTarget.user.id ? { ...u, role: roleTarget.newRole } : u));
      setRoleTarget(null);
    } catch (e) {
      alert('권한 변경 실패: ' + e.message);
    } finally { setProcessing(false); }
  };

  const handleBan = async () => {
    if (!banTarget) return;
    setProcessing(true);
    try {
      await updateDoc(doc(db, 'users', banTarget.id), {
        status: 'banned',
        bannedAt: serverTimestamp(),
        bannedReason: banReason.trim() || '관리자 제재',
      });
      setUsers(prev => prev.map(u => u.id === banTarget.id
        ? { ...u, status: 'banned', bannedReason: banReason.trim() || '관리자 제재' }
        : u
      ));
      setBanTarget(null); setBanReason('');
    } catch (e) {
      alert('제재 실패: ' + e.message);
    } finally { setProcessing(false); }
  };

  const handleUnban = async (uid) => {
    setProcessing(true);
    try {
      await updateDoc(doc(db, 'users', uid), { status: 'active', bannedAt: null, bannedReason: '' });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, status: 'active' } : u));
    } catch (e) {
      alert('제재 해제 실패: ' + e.message);
    } finally { setProcessing(false); }
  };

  // ── 사용자 기사 관리 ──────────────────────────────────────────────────────
  const getTargetDriversCol = (u) => {
    if (!u) return null;
    if (u.orgId) return collection(db, 'org_drivers', u.orgId, 'drivers');
    if (u.companyCode) return collection(db, 'user_companies', u.companyCode, 'drivers');
    return collection(db, 'user_drivers', u.id, 'drivers');
  };
  const getTargetDriverPath = (u) => {
    if (!u) return '';
    if (u.orgId) return `소속사: ${u.orgId}`;
    if (u.companyCode) return `회사: ${u.companyCode}`;
    return '개인';
  };

  const openDriverManage = async (u) => {
    setDriverManageTarget(u);
    setDriverManageList([]);
    setDriverManageForm(null);
    setDriverManageLoading(true);
    try {
      const col = getTargetDriversCol(u);
      if (!col) return;
      const snap = await getDocs(col);
      setDriverManageList(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')));
    } catch (e) { alert('기사 목록 로드 실패: ' + e.message); }
    finally { setDriverManageLoading(false); }
  };

  const saveTargetDriver = async () => {
    if (!driverManageTarget || !driverManageForm) return;
    if (!driverManageForm.name?.trim()) { alert('기사 이름을 입력하세요.'); return; }
    setDriverManageSaving(true);
    try {
      const col = getTargetDriversCol(driverManageTarget);
      const payload = {
        name: driverManageForm.name.trim(),
        capacity: parseInt(driverManageForm.capacity) || 100,
        color: driverManageForm.color || '#3b82f6',
        memo: driverManageForm.memo || '',
        status: driverManageForm.status || 'active',
        updatedAt: serverTimestamp(),
      };
      if (driverManageForm.id === 'new') {
        payload.createdAt = serverTimestamp();
        await addDoc(col, payload);
      } else {
        await setDoc(doc(db, col.path, driverManageForm.id), payload, { merge: true });
      }
      await openDriverManage(driverManageTarget);
      setDriverManageForm(null);
    } catch (e) { alert('저장 실패: ' + e.message); }
    finally { setDriverManageSaving(false); }
  };

  const deleteTargetDriver = async (driverId) => {
    if (!driverManageTarget || !window.confirm('이 기사를 삭제하시겠습니까?')) return;
    try {
      const col = getTargetDriversCol(driverManageTarget);
      await deleteDoc(doc(db, col.path, driverId));
      setDriverManageList(prev => prev.filter(d => d.id !== driverId));
    } catch (e) { alert('삭제 실패: ' + e.message); }
  };

  const toggleTargetDriverStatus = async (driver) => {
    if (!driverManageTarget) return;
    const newStatus = driver.status === 'active' ? 'inactive' : 'active';
    try {
      const col = getTargetDriversCol(driverManageTarget);
      await setDoc(doc(db, col.path, driver.id), { status: newStatus, updatedAt: serverTimestamp() }, { merge: true });
      setDriverManageList(prev => prev.map(d => d.id === driver.id ? { ...d, status: newStatus } : d));
    } catch (e) { alert('상태 변경 실패: ' + e.message); }
  };

  const DRIVER_COLORS_ADMIN = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#14b8a6','#a855f7','#84cc16','#f43f5e'];

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setProcessing(true);
    try {
      await deleteDoc(doc(db, 'users', deleteTarget.id));
      await addDoc(collection(db, 'audit_logs'), {
        action: 'DELETE_USER',
        targetUid: deleteTarget.id,
        targetEmail: deleteTarget.email || '',
        targetName: deleteTarget.realName || '',
        timestamp: serverTimestamp(),
        adminEmail: user?.email || 'unknown',
        expireAt: ttl90(),
      });
      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      alert('삭제 실패: ' + e.message);
    } finally { setProcessing(false); }
  };

  const handleTierChange = async () => {
    if (!tierTarget) return;
    setProcessing(true);
    try {
      const defaultMax = TIER_DEFAULT_CITIES[tierTarget.newTier] ?? 1;
      await updateDoc(doc(db, 'users', tierTarget.user.id), { tier: tierTarget.newTier, maxCities: defaultMax });
      setUsers(prev => prev.map(u => u.id === tierTarget.user.id ? { ...u, tier: tierTarget.newTier, maxCities: defaultMax } : u));
      setTierTarget(null);
    } catch (e) {
      alert('등급 변경 실패: ' + e.message);
    } finally { setProcessing(false); }
  };

  const saveCityLimit = async (uid, rawVal) => {
    const val = Math.max(1, Math.min(999, parseInt(rawVal, 10) || 1));
    setEditingCity(prev => ({ ...prev, [uid]: val }));
    try {
      await updateDoc(doc(db, 'users', uid), { maxCities: val });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, maxCities: val } : u));
    } catch (e) {
      alert('지자체 수 저장 실패: ' + e.message);
    }
    setEditingCity(prev => { const n = { ...prev }; delete n[uid]; return n; });
  };

  const saveRealName = async (uid, name) => {
    const trimmed = (name || '').trim();
    try {
      await updateDoc(doc(db, 'users', uid), { realName: trimmed || null });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, realName: trimmed || null } : u));
    } catch (e) { alert('성명 수정 실패: ' + e.message); }
    setEditingRealName(prev => { const n = { ...prev }; delete n[uid]; return n; });
  };

  const sidoList = Object.keys(REGIONS);

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[600] flex items-center justify-center p-2">
      <div className="w-full bg-[#0a100c] border border-[#3b82f6]/30 rounded-2xl shadow-[0_0_60px_rgba(59,130,246,0.2)] flex flex-col" style={{height:'calc(100vh - 16px)'}}>

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-[#0f1a2e] shrink-0">
          <div>
            <h2 className="text-xl font-black text-[#3b82f6] flex items-center gap-3"><Users size={22}/> 관리자 대시보드</h2>
            <p className="text-gray-500 text-xs mt-1">사용자 현황 · 등급·권한·소속사·지자체 관리 · AI Advisor</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'users' ? 'bg-[#3b82f6] text-black shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-[#111] text-gray-400 border border-[#333] hover:text-white hover:bg-[#222]'}`}
            >
              사용자 관리
            </button>
            <button
              onClick={() => setActiveTab('ai_advisor')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${activeTab === 'ai_advisor' ? 'bg-[#3b82f6] text-black shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-[#111] text-gray-400 border border-[#333] hover:text-white hover:bg-[#222]'}`}
            >
              <Crown size={16} /> NEXUS AI Advisor
              {pendingSuggestionsCount > 0 && (
                <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full ml-1">{pendingSuggestionsCount}</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('inquiries')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${activeTab === 'inquiries' ? 'bg-[#3b82f6] text-black shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-[#111] text-gray-400 border border-[#333] hover:text-white hover:bg-[#222]'}`}
            >
              <MessageSquare size={16} /> 문의 관리
              {inquiries.filter(i => i.status === 'pending').length > 0 && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full ml-1">
                  {inquiries.filter(i => i.status === 'pending').length}
                </span>
              )}
            </button>
            <button
              onClick={() => { setActiveTab('ops'); if (!auditLogs.length) fetchAuditLogs(); }}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${activeTab === 'ops' ? 'bg-[#3b82f6] text-black shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-[#111] text-gray-400 border border-[#333] hover:text-white hover:bg-[#222]'}`}
            >
              <Activity size={16} /> 운영 현황
              {(churnRisk.length > 0 || nearLimit.length > 0) && (
                <span className="bg-amber-500 text-black text-[10px] px-1.5 py-0.5 rounded-full ml-1 font-black">
                  {churnRisk.length + nearLimit.length}
                </span>
              )}
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1 ml-4"><X size={22}/></button>
          </div>
        </div>

        {activeTab === 'users' && (
          <>
            {/* Stats */}
            <div className="px-8 py-4 border-b border-[#0f1a2e] shrink-0 space-y-3">
              <div className="grid grid-cols-4 gap-3">
                {Object.entries(TIERS).map(([key, t]) => (
                  <div key={key} className={`rounded-xl p-3 border ${t.bg} ${t.border} flex items-center gap-3`}>
                    <span className="text-2xl">{t.emoji}</span>
                    <div>
                      <p className={`text-[11px] font-black ${t.color}`}>{t.label}</p>
                      <p className={`text-xl font-black ${t.color}`}>{tierCounts[key]}명</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <div className="grid grid-cols-4 gap-3 flex-1">
                  {[
                    { icon: <Users size={14}/>,     label: '총 사용자',      value: `${allUsersCount}명` },
                    { icon: <ShieldOff size={14}/>, label: '제재 중',        value: `${allBannedCount}명`, red: allBannedCount > 0 },
                    { icon: <BarChart2 size={14}/>, label: '정제 누적 행',   value: `${allTotalRows.toLocaleString()}행` },
                    { icon: <Clock size={14}/>,     label: '정제 누적 파일', value: `${allTotalFiles.toLocaleString()}건` },
                  ].map(({ icon, label, value, red }) => (
                    <div key={label} className="bg-black/50 rounded-xl p-3 border border-[#0f1a2e]">
                      <p className="text-gray-500 text-[10px] font-bold mb-1 flex items-center gap-1">{icon}{label}</p>
                      <p className={`text-xl font-black ${red ? 'text-red-400' : 'text-[#3b82f6]'}`}>{value}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={fetchUsers}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-2 bg-[#3b82f6]/10 border border-[#3b82f6]/30 text-[#3b82f6] text-xs font-black rounded-xl hover:bg-[#3b82f6]/20 transition-colors disabled:opacity-40"
                  >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''}/> 새로고침
                  </button>
                  <button
                    onClick={() => setShowOrgMgr(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-950/40 border border-purple-700/40 text-purple-300 text-xs font-black rounded-xl hover:bg-purple-900/50 transition-colors"
                  >
                    <Building2 size={14}/> 소속사·회사 관리
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#2d4a35]">
              {loading ? (
                <div className="flex items-center justify-center h-32 text-gray-500 text-sm">불러오는 중...</div>
              ) : (
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="sticky top-0 bg-[#0a100c] border-b border-[#0f1a2e] z-10">
                    <tr className="text-[#3b82f6] text-[11px] font-black tracking-wide">
                      <th className="px-4 py-3 text-left">상태</th>
                      <th className="px-4 py-3 text-left">등급</th>
                      <th className="px-4 py-3 text-left">성명</th>
                      <th className="px-4 py-3 text-left">이메일</th>
                      <th className="px-4 py-3 text-center">마지막접속</th>
                      <th className="px-4 py-3 text-center">로그인</th>
                      <th className="px-4 py-3 text-center">정제행</th>
                      <th className="px-4 py-3 text-center">정제파일</th>
                      <th className="px-4 py-3 text-center">지자체수량</th>
                      <th className="px-4 py-3 text-left">소속사</th>
                      <th className="px-4 py-3 text-left">승인 지자체</th>
                      <th className="px-4 py-3 text-center">등급변경</th>
                      <th className="px-4 py-3 text-center">권한</th>
                      <th className="px-4 py-3 text-center">제재</th>
                      <th className="px-4 py-3 text-center">기사</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#0f1a2e] text-gray-300">
                    {users.map(u => {
                      const isBanned = u.status === 'banned';
                      const hasProfile = u.profileCompleted;
                      const currentTier = u.tier || 'basic';
                      const approvedCities = u.citiesApproved || [];
                      const isPickingCity = cityPickerUid === u.id;

                      return (
                        <tr key={u.id} className={`hover:bg-white/5 transition-colors ${isBanned ? 'opacity-50' : ''}`}>
                          {/* 상태 */}
                          <td className="px-4 py-3">
                            {isBanned
                              ? <span className="px-2 py-0.5 rounded text-[10px] font-black bg-red-950/60 text-red-400 border border-red-800/50" title={u.bannedReason}>제재중</span>
                              : hasProfile
                                ? <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/30">활성</span>
                                : <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-950/40 text-amber-400 border border-amber-800/50">미등록</span>
                            }
                          </td>

                          {/* 등급 */}
                          <td className="px-4 py-3"><TierBadge tier={currentTier} /></td>

                          {/* 성명 */}
                          <td className="px-4 py-3">
                            {editingRealName[u.id] !== undefined ? (
                              <input
                                autoFocus
                                value={editingRealName[u.id]}
                                onChange={e => setEditingRealName(prev => ({ ...prev, [u.id]: e.target.value }))}
                                onBlur={() => saveRealName(u.id, editingRealName[u.id])}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveRealName(u.id, editingRealName[u.id]);
                                  if (e.key === 'Escape') setEditingRealName(prev => { const n = { ...prev }; delete n[u.id]; return n; });
                                }}
                                className="bg-black/60 border border-[#3b82f6]/50 text-white px-2 py-0.5 rounded text-sm outline-none w-24"
                              />
                            ) : (
                              <span
                                onClick={() => setEditingRealName(prev => ({ ...prev, [u.id]: u.realName || '' }))}
                                className="font-bold text-white cursor-pointer hover:text-[#3b82f6] transition-colors"
                                title="클릭하여 수정"
                              >
                                {u.realName || <span className="text-gray-500 text-xs italic">클릭하여 입력</span>}
                              </span>
                            )}
                          </td>

                          {/* 이메일 */}
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{u.email}</td>

                          {/* 마지막접속 */}
                          <td className="px-4 py-3 text-center font-mono text-xs text-gray-400">{fmt(u.lastLogin)}</td>

                          {/* 로그인 */}
                          <td className="px-4 py-3 text-center text-[#3b82f6] font-black">{(u.loginCount || 0).toLocaleString()}</td>

                          {/* 정제 누적 */}
                          <td className="px-4 py-3 text-center font-mono text-xs" title={`최근 정제: ${u.lastProcessedRows || 0}행 / 오류 ${u.lastProcessedErrorRows || 0}행`}>
                            {getProcessedRows(u).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-xs" title={u.lastProcessedCity ? `최근: ${u.lastProcessedCity} ${u.lastProcessedMonth || ''}` : '정제 기록 없음'}>
                            {getProcessedFiles(u).toLocaleString()}
                          </td>

                          {/* 지자체 수량 */}
                          <td className="px-4 py-3 text-center">
                            <input
                              type="number"
                              min={1} max={999}
                              value={editingCity[u.id] ?? (u.maxCities ?? TIER_DEFAULT_CITIES[currentTier] ?? 1)}
                              onChange={e => setEditingCity(prev => ({ ...prev, [u.id]: e.target.value }))}
                              onBlur={e => saveCityLimit(u.id, e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && saveCityLimit(u.id, e.target.value)}
                              className="w-14 text-center bg-black/60 border border-[#333] text-[#3b82f6] font-black text-sm rounded-lg px-1 py-1 outline-none focus:border-[#3b82f6] hover:border-[#555] transition-colors"
                            />
                          </td>

                          {/* 소속사/회사 */}
                          <td className="px-4 py-3 min-w-[175px]">
                            {/* 탭 토글 */}
                            <div className="flex gap-0.5 mb-1.5">
                              {['org', 'company'].map(mode => {
                                const isActive = (orgCellMode[u.id] || (u.companyCode && !u.orgId ? 'company' : 'org')) === mode;
                                return (
                                  <button
                                    key={mode}
                                    onClick={() => setOrgCellMode(prev => ({ ...prev, [u.id]: mode }))}
                                    className={`px-2 py-0.5 rounded text-[10px] font-black transition-colors border ${
                                      isActive
                                        ? mode === 'org'
                                          ? 'bg-purple-900/60 text-purple-300 border-purple-600/50'
                                          : 'bg-blue-900/60 text-blue-300 border-blue-600/50'
                                        : 'bg-black/30 text-gray-600 border-[#1a1a1a] hover:text-gray-400'
                                    }`}
                                  >{mode === 'org' ? '소속사' : '회사'}</button>
                                );
                              })}
                            </div>
                            {(orgCellMode[u.id] || (u.companyCode && !u.orgId ? 'company' : 'org')) === 'org' ? (
                              <OrgSelect
                                value={u.orgId || ''}
                                options={u.orgId && !globalOrgs.includes(u.orgId)
                                  ? [...globalOrgs, u.orgId].sort()
                                  : globalOrgs}
                                onChange={name => saveUserOrg(u.id, name)}
                                onBulkAssign={handleBulkAssignOrg}
                              />
                            ) : (
                              <CompanySelect
                                value={u.companyCode || ''}
                                companies={userCompanies}
                                onChange={code => saveUserCompany(u.id, code)}
                              />
                            )}
                          </td>

                          {/* 승인 지자체 */}
                          <td className="px-4 py-3 min-w-[240px]">
                            <div className="flex flex-col gap-1.5">
                              {/* 승인된 지자체 pills */}
                              <div className="flex flex-wrap gap-1">
                                {approvedCities.length === 0 && (
                                  <span className="text-gray-700 text-[10px]">없음</span>
                                )}
                                {approvedCities.map(city => (
                                  <span key={city} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-[#3b82f6]/10 border border-[#3b82f6]/30 text-[#3b82f6] font-bold">
                                    {city}
                                    <button
                                      onClick={() => removeCityFromUser(u.id, city)}
                                      className="ml-0.5 text-[#3b82f6]/60 hover:text-red-400 transition-colors leading-none"
                                      title="제거"
                                    >×</button>
                                  </span>
                                ))}
                              </div>

                              {/* 지자체 추가 picker */}
                              {isPickingCity ? (
                                <div className="flex gap-1 items-center">
                                  <select
                                    value={cityPickerSido}
                                    onChange={e => { setCityPickerSido(e.target.value); setCityPickerSigungu(''); }}
                                    className="flex-1 bg-black/70 border border-[#444] text-gray-300 text-[10px] px-1 py-0.5 rounded outline-none focus:border-[#3b82f6]"
                                  >
                                    <option value="">시/도</option>
                                    {sidoList.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                  <select
                                    value={cityPickerSigungu}
                                    onChange={e => setCityPickerSigungu(e.target.value)}
                                    disabled={!cityPickerSido}
                                    className="flex-1 bg-black/70 border border-[#444] text-gray-300 text-[10px] px-1 py-0.5 rounded outline-none focus:border-[#3b82f6] disabled:opacity-40"
                                  >
                                    <option value="">시/군/구</option>
                                    {cityPickerSido && getSigunguOptions(cityPickerSido).map(sg => (
                                      <option key={sg} value={sg}>{sg}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => {
                                      if (!cityPickerSido || !cityPickerSigungu) return;
                                      const cityId = `${cityPickerSido} ${cityPickerSigungu}`;
                                      if (!approvedCities.includes(cityId)) addCityToUser(u.id, cityId);
                                      else { setCityPickerUid(null); setCityPickerSido(''); setCityPickerSigungu(''); }
                                    }}
                                    disabled={!cityPickerSido || !cityPickerSigungu}
                                    className="px-2 py-0.5 bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/40 rounded text-[10px] font-black hover:bg-[#3b82f6]/30 disabled:opacity-40 shrink-0"
                                  >추가</button>
                                  <button
                                    onClick={() => { setCityPickerUid(null); setCityPickerSido(''); setCityPickerSigungu(''); }}
                                    className="px-1.5 py-0.5 bg-black/50 text-gray-500 border border-[#333] rounded text-[10px] hover:text-white shrink-0"
                                  >✕</button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setCityPickerUid(u.id); setCityPickerSido(''); setCityPickerSigungu(''); }}
                                  className="self-start flex items-center gap-1 px-2 py-0.5 bg-black/40 text-gray-500 border border-[#333] text-[10px] rounded hover:text-[#3b82f6] hover:border-[#3b82f6]/40 transition-colors"
                                >
                                  <Plus size={10}/> 지자체 추가
                                </button>
                              )}
                            </div>
                          </td>

                          {/* 등급변경 */}
                          <td className="px-4 py-3 text-center">
                            <select
                              value={currentTier}
                              onChange={e => setTierTarget({ user: u, newTier: e.target.value })}
                              disabled={processing}
                              className="bg-black/60 border border-[#333] text-gray-300 text-[11px] font-bold px-2 py-1 rounded-lg outline-none cursor-pointer focus:border-[#3b82f6] hover:border-[#555] transition-colors"
                            >
                              {Object.entries(TIERS).map(([key, t]) => (
                                <option key={key} value={key}>{t.emoji} {t.label}</option>
                              ))}
                            </select>
                          </td>

                          {/* 권한 */}
                          <td className="px-4 py-3 text-center">
                            <select
                              value={u.role || 'user'}
                              onChange={e => setRoleTarget({ user: u, newRole: e.target.value })}
                              disabled={processing}
                              className={`bg-black/60 border text-[11px] font-bold px-2 py-1 rounded-lg outline-none cursor-pointer transition-colors ${
                                (u.role === 'admin')
                                  ? 'border-amber-700/50 text-amber-300 focus:border-amber-500 hover:border-amber-600'
                                  : 'border-[#333] text-gray-400 focus:border-[#3b82f6] hover:border-[#555]'
                              }`}
                            >
                              {Object.entries(ROLES).map(([key, r]) => (
                                <option key={key} value={key}>{r.emoji} {r.label}</option>
                              ))}
                            </select>
                          </td>

                          {/* 제재 */}
                          <td className="px-4 py-3 text-center">
                            {isBanned
                              ? <button onClick={() => handleUnban(u.id)} disabled={processing} className="px-3 py-1 bg-[#3b82f6]/10 border border-[#3b82f6]/30 text-[#3b82f6] text-[11px] font-black rounded-lg hover:bg-[#3b82f6]/20 transition-colors disabled:opacity-40 flex items-center gap-1 mx-auto">
                                  <ShieldCheck size={11}/> 해제
                                </button>
                              : <button onClick={() => { setBanTarget(u); setBanReason(''); }} disabled={processing} className="px-3 py-1 bg-red-950/40 border border-red-800/50 text-red-400 text-[11px] font-black rounded-lg hover:bg-red-900/50 transition-colors disabled:opacity-40 flex items-center gap-1 mx-auto">
                                  <ShieldOff size={11}/> 제재
                                </button>
                            }
                          </td>

                          {/* 삭제 */}
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => setDeleteTarget(u)}
                              disabled={processing}
                              className="px-3 py-1 bg-red-950/60 border border-red-700/60 text-red-400 text-[11px] font-black rounded-lg hover:bg-red-900/70 hover:border-red-500/80 transition-colors disabled:opacity-40 flex items-center gap-1 mx-auto"
                              title="사용자 계정 영구 삭제"
                            >
                              <Trash2 size={11}/> 삭제
                            </button>
                          </td>

                          {/* 기사 관리 */}
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => openDriverManage(u)}
                              className="px-3 py-1 bg-emerald-950/40 border border-emerald-700/50 text-emerald-400 text-[11px] font-black rounded-lg hover:bg-emerald-900/60 hover:border-emerald-500/70 transition-colors flex items-center gap-1 mx-auto"
                              title="이 사용자의 기사 목록 관리"
                            >
                              <Truck size={11}/> 기사
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {users.length === 0 && (
                      <tr><td colSpan={14} className="px-6 py-10 text-center text-gray-600">등록된 사용자 없음</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {activeTab === 'ai_advisor' && (
          <div className="flex-1 p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2d4a35]">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Crown size={18} className="text-[#3b82f6]"/>
                <h3 className="text-base font-black text-[#3b82f6]">AI 자가 진화 분석</h3>
                <span className="text-gray-600 text-[11px]">칼럼 매핑 학습 현황</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={fetchAiData} disabled={aiLoading}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-black/40 border border-[#333] text-gray-500 text-[11px] font-black rounded-lg hover:text-[#3b82f6] hover:border-[#3b82f6]/40 transition-colors disabled:opacity-40">
                  <RefreshCw size={11} className={aiLoading ? 'animate-spin' : ''}/> 새로고침
                </button>
                <div className="flex items-center gap-0.5 bg-black/40 border border-[#1a1a2e] rounded-lg p-0.5">
                  {[
                    { key: 'applied', label: '반영됨', count: appliedRulesCount, color: 'text-emerald-400' },
                    { key: 'pending', label: '미반영',  count: pendingSuggestionsCount, color: 'text-amber-400' },
                    { key: 'all',     label: '전체',    count: appliedRulesCount + pendingSuggestionsCount, color: 'text-gray-400' },
                  ].map(t => (
                    <button key={t.key} onClick={() => setAiFilter(t.key)}
                      className={`px-3 py-1.5 rounded text-xs font-black transition-colors flex items-center gap-1.5 ${aiFilter === t.key ? 'bg-[#3b82f6] text-black' : 'text-gray-500 hover:text-white'}`}>
                      {t.label}
                      <span className={`text-[10px] ${aiFilter === t.key ? 'text-black/70' : t.color}`}>{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {aiLoading ? (
              <div className="flex items-center justify-center py-20 text-gray-500 text-sm">데이터를 불러오는 중...</div>
            ) : (
              <>
                {/* 반영된 칼럼 매핑 규칙 */}
                {(aiFilter === 'applied' || aiFilter === 'all') && (
                  <div className={aiFilter === 'all' ? 'mb-7' : ''}>
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 size={12} className="text-emerald-400"/>
                      <p className="text-[11px] font-black text-gray-300">반영된 칼럼 매핑 규칙</p>
                      <span className="text-gray-600 text-[10px]">— × 클릭으로 키워드 삭제</span>
                      {appliedRulesCount > 0 && (
                        <span className="bg-emerald-900/40 text-emerald-400 border border-emerald-700/30 text-[10px] px-1.5 py-0.5 rounded-full font-black ml-auto">{appliedRulesCount}개 키워드</span>
                      )}
                    </div>
                    {!aiRules?.reqKeys?.length ? (
                      <div className="bg-black/30 border border-[#0f1a2e] rounded-xl p-6 text-center">
                        <p className="text-gray-600 text-sm">설정된 매핑 규칙이 없습니다.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                        {(aiRules.reqKeys || []).map(rule => (
                          <div key={rule.k} className="bg-black/40 border border-[#0a2018] rounded-xl p-3 hover:border-emerald-800/40 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-emerald-400 font-black text-[11px]">{rule.k} 필드</span>
                              <span className="text-[9px] text-gray-700">{rule.kws.length}개</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {rule.kws.map(kw => {
                                const isForced = (aiRules.forced || []).includes(kw);
                                return (
                                  <span key={kw} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border group transition-colors cursor-default ${
                                    isForced ? 'bg-amber-950/40 text-amber-300 border-amber-700/40 hover:border-amber-500/60' : 'bg-[#071410] text-emerald-400/80 border-emerald-900/40 hover:border-emerald-700/50'
                                  }`}>
                                    {isForced && <span className="text-amber-400 text-[8px] mr-0.5">★</span>}
                                    {kw}
                                    <button onClick={() => handleDeleteAiRuleKeyword(rule.k, kw)}
                                      className="ml-0.5 opacity-30 group-hover:opacity-100 hover:text-red-400 transition-all leading-none"
                                      title="규칙에서 제거">×</button>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 미반영 AI 제안 */}
                {(aiFilter === 'pending' || aiFilter === 'all') && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle size={12} className="text-amber-400"/>
                      <p className="text-[11px] font-black text-gray-300">미반영 AI 제안</p>
                      <span className="text-gray-600 text-[10px]">— ★강력적용 시 칼럼 매핑 최우선 반영</span>
                      {pendingSuggestionsCount > 0 && (
                        <span className="bg-amber-900/40 text-amber-400 border border-amber-700/30 text-[10px] px-1.5 py-0.5 rounded-full font-black ml-auto">{pendingSuggestionsCount}건</span>
                      )}
                    </div>
                    {pendingSuggestionsCount === 0 ? (
                      <div className="bg-black/30 border border-[#0f1a2e] rounded-xl p-6 text-center">
                        <p className="text-gray-600 text-sm">새로 제안된 미인식 칼럼이 없습니다.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                        {pendingAiSuggestions.map((s, idx) => (
                          <div key={idx} className="bg-black/40 border border-[#1e1408] rounded-xl p-3 hover:border-amber-800/40 transition-colors">
                            <div className="flex items-start justify-between gap-1 mb-1">
                              <span className="text-white font-black text-sm leading-tight truncate flex-1" title={s.col}>{s.col}</span>
                              <span className={`text-[10px] font-black shrink-0 px-1 py-0.5 rounded ${
                                s.analysis.score >= 80 ? 'text-emerald-400 bg-emerald-950/40' : s.analysis.score >= 50 ? 'text-amber-400 bg-amber-950/40' : 'text-red-400 bg-red-950/40'
                              }`}>{Math.max(0, s.analysis.score)}%</span>
                            </div>
                            <p className="text-gray-600 text-[10px] mb-2.5">
                              → <span className="text-gray-300 font-bold">{s.analysis.key}</span>
                              <span className="text-gray-700 ml-1">· {s.count}회</span>
                            </p>
                            <div className="flex gap-1">
                              <button onClick={() => handleDeleteAiLog(s.col)} disabled={processing}
                                className="flex-1 py-1 rounded bg-black/60 text-gray-600 text-[10px] font-bold border border-[#1a1a1a] hover:text-red-400 hover:border-red-900/50 transition-colors disabled:opacity-30">삭제</button>
                              <button onClick={() => handleAcceptAiSuggestion(s.col, s.analysis.key)} disabled={processing || s.analysis.key === '알수없음'}
                                className={`py-1 px-2 rounded text-[10px] font-black border transition-all disabled:opacity-30 ${
                                  s.analysis.key === '알수없음'
                                    ? 'bg-black/30 text-gray-700 border-[#1a1a1a] cursor-not-allowed'
                                    : 'bg-amber-900/40 text-amber-300 border-amber-700/40 hover:bg-amber-800/50'
                                }`}
                                title={s.analysis.key !== '알수없음' ? `'${s.analysis.key}'로 강력 지침 적용` : '적용 불가'}>
                                {s.analysis.key === '알수없음' ? '—' : '★ 강력적용'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'inquiries' && (
          <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#2d4a35] p-6">
            <h3 className="text-xl font-black text-[#3b82f6] mb-4 flex items-center gap-2">
              <MessageSquare size={20} /> 승인 및 문의 내역
            </h3>
            {inquiries.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-gray-500 text-sm">접수된 문의가 없습니다.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {inquiries.map(inq => (
                  <div key={inq.id} className={`rounded-xl p-5 border ${inq.status === 'pending' ? 'bg-[#0f1a10] border-[#3b82f6]/40 shadow-[0_0_20px_rgba(59,130,246,0.1)]' : 'bg-[#111] border-[#333] opacity-70'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${inq.status === 'pending' ? 'bg-[#3b82f6]/20 text-[#3b82f6] border-[#3b82f6]/40' : 'bg-gray-800 text-gray-400 border-gray-600'}`}>
                        {inq.status === 'pending' ? '대기 중' : '처리 완료'}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-gray-500">{fmt(inq.createdAt)}</span>
                        <button
                          onClick={() => handleDeleteInquiry(inq.id)}
                          className="w-6 h-6 flex items-center justify-center text-gray-700 hover:text-red-400 hover:bg-red-950/30 rounded transition-colors"
                          title="문의 삭제"
                        ><Trash2 size={11}/></button>
                      </div>
                    </div>
                    <div className="mb-4">
                      <h4 className="text-white font-bold text-lg">{inq.realName}</h4>
                      <p className="text-gray-400 text-sm">{inq.contact}</p>
                      <p className="text-gray-500 text-xs">{inq.email}</p>
                    </div>
                    <div className="mb-4 bg-black/40 p-3 rounded-lg border border-white/5">
                      <p className="text-[#3b82f6] font-black text-sm mb-1">희망 등급: <span className="text-white">{inq.requestedPlan?.toUpperCase() || '-'}</span></p>
                      <p className="text-gray-400 text-xs whitespace-pre-wrap">{inq.message || '추가 내용 없음'}</p>
                    </div>
                    {inq.status === 'pending' && (() => {
                      const matchedUser = users.find(u => u.email === inq.email);
                      const planTier = inq.requestedPlan?.toLowerCase();
                      const validTier = ['vip','vvip','sapphire'].includes(planTier) ? planTier : null;
                      return (
                        <div className="flex flex-col gap-2">
                          {validTier && matchedUser && (
                            <button
                              onClick={() => setTierUpgradeTarget({ inq, matchedUser, newTier: validTier })}
                              disabled={processing}
                              className="w-full py-2.5 bg-amber-900/40 text-amber-300 font-black rounded-lg hover:bg-amber-800/50 border border-amber-600/40 transition-all flex justify-center items-center gap-2 disabled:opacity-50 text-sm"
                            >
                              <Crown size={15}/> {TIERS[validTier]?.label || validTier} 등급 승인 + 완료
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              setProcessing(true);
                              try {
                                await updateDoc(doc(db, 'inquiries', inq.id), { status: 'completed', completedAt: serverTimestamp() });
                                setInquiries(prev => prev.map(i => i.id === inq.id ? { ...i, status: 'completed' } : i));
                              } finally { setProcessing(false); }
                            }}
                            disabled={processing}
                            className="w-full py-2.5 bg-[#3b82f6]/20 text-[#3b82f6] font-black rounded-lg hover:bg-[#3b82f6] hover:text-black border border-[#3b82f6]/30 transition-all flex justify-center items-center gap-2 disabled:opacity-50 text-sm"
                          >
                            <CheckCircle2 size={15} /> 처리 완료로 표시
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}


        {activeTab === 'ops' && (
          <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#2d4a35] p-6 space-y-6">

            {/* 이탈 위험 */}
            {churnRisk.length > 0 && (
              <div>
                <h3 className="text-amber-400 font-black text-base flex items-center gap-2 mb-3">
                  <UserX size={18}/> 이탈 위험 사용자 <span className="text-[11px] text-amber-600 font-normal ml-1">— 60일 이상 미접속</span>
                  <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] px-2 py-0.5 rounded-full font-black">{churnRisk.length}명</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {churnRisk.map(u => {
                    const daysSince = Math.floor((nowSec - (u.lastLogin?.seconds || 0)) / 86400);
                    return (
                      <div key={u.id} className="bg-amber-950/20 border border-amber-700/30 rounded-xl p-4 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-white font-black text-sm">{u.realName || '이름없음'}</p>
                          <p className="text-gray-500 text-[11px] font-mono">{u.email}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <TierBadge tier={u.tier || 'basic'} />
                          <p className="text-amber-400 font-black text-sm mt-1">{daysSince}일 전</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 한도 근접 */}
            {nearLimit.length > 0 && (
              <div>
                <h3 className="text-red-400 font-black text-base flex items-center gap-2 mb-3">
                  <AlertCircle size={18}/> 지자체 한도 근접 <span className="text-[11px] text-red-600 font-normal ml-1">— 80% 이상 사용</span>
                  <span className="bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] px-2 py-0.5 rounded-full font-black">{nearLimit.length}명</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {nearLimit.map(u => {
                    const max = u.maxCities ?? TIER_DEFAULT_CITIES[u.tier || 'basic'] ?? 1;
                    const used = (u.citiesApproved || []).length;
                    const pct = Math.round((used / max) * 100);
                    return (
                      <div key={u.id} className="bg-red-950/20 border border-red-700/30 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-white font-black text-sm">{u.realName || '이름없음'}</p>
                            <p className="text-gray-500 text-[11px] font-mono">{u.email}</p>
                          </div>
                          <TierBadge tier={u.tier || 'basic'} />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-black/50 rounded-full h-2 overflow-hidden">
                            <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.min(100, pct)}%` }}/>
                          </div>
                          <span className="text-red-400 font-black text-xs shrink-0">{used}/{max} ({pct}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {churnRisk.length === 0 && nearLimit.length === 0 && (
              <div className="flex items-center gap-3 p-4 bg-[#3b82f6]/5 border border-[#3b82f6]/20 rounded-xl">
                <CheckCircle2 size={20} className="text-[#3b82f6] shrink-0"/>
                <p className="text-[#3b82f6] font-bold text-sm">이탈 위험 및 한도 근접 사용자가 없습니다.</p>
              </div>
            )}

            {/* 지자체별 업로드 통계 */}
            <div>
              <h3 className="text-[#3b82f6] font-black text-base flex items-center gap-2 mb-3">
                <TrendingUp size={18}/> 지자체별 업로드 통계
                <span className="text-gray-600 text-[11px] font-normal">— 전체 {auditLogs.length}건 배치 저장</span>
              </h3>
              {auditLoading ? (
                <div className="text-center text-gray-500 py-8 text-sm">불러오는 중...</div>
              ) : cityUsageStats.length === 0 ? (
                <div className="text-center text-gray-600 py-8 text-sm">기록된 데이터가 없습니다.</div>
              ) : (
                <div className="bg-black/40 border border-[#0f1a2e] rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-[#0a100c] border-b border-[#0f1a2e]">
                      <tr className="text-[#3b82f6] font-black">
                        <th className="px-4 py-2.5 text-left">지자체</th>
                        <th className="px-4 py-2.5 text-center">배치 횟수</th>
                        <th className="px-4 py-2.5 text-center">신규 저장</th>
                        <th className="px-4 py-2.5 text-center">업데이트</th>
                        <th className="px-4 py-2.5 text-center">마지막 업로드</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#0f1a2e]">
                      {cityUsageStats.map(s => (
                        <tr key={s.city} className="hover:bg-white/3 transition-colors">
                          <td className="px-4 py-2.5 text-white font-bold">{s.city}</td>
                          <td className="px-4 py-2.5 text-center text-[#3b82f6] font-black">{s.sessions.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-center text-blue-400">{s.added.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-center text-amber-400">{s.updated.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-center text-gray-500 font-mono">{s.lastSec > 0 ? fmt({ seconds: s.lastSec }) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* DB 마이그레이션 — 동사무소→주민센터 */}
            <div>
              <h3 className="text-orange-400 font-black text-base flex items-center gap-2 mb-3">
                <RefreshCw size={18}/> DB 마이그레이션
              </h3>
              <div className="bg-orange-950/20 border border-orange-700/30 rounded-xl p-4">
                <p className="text-orange-200/80 text-sm mb-1 font-bold">동사무소 / 읍사무소 / 면사무소 → 주민센터</p>
                <p className="text-gray-500 text-xs mb-4">base_lists 전체의 note·address 필드에서 구식 명칭을 일괄 변경합니다.</p>
                {migrationStatus === 'running' && (
                  <div className="flex items-center gap-2 text-orange-400 text-sm mb-3">
                    <RefreshCw size={14} className="animate-spin"/> 마이그레이션 진행 중...
                    {typeof migrationStatus === 'object' && <span className="text-xs text-gray-500">스캔 {migrationStatus.done}건 / 변경 {migrationStatus.updated}건</span>}
                  </div>
                )}
                {migrationStatus && migrationStatus !== 'running' && typeof migrationStatus === 'object' && (
                  <div className={`text-sm mb-3 font-bold ${migrationStatus.error ? 'text-red-400' : 'text-emerald-400'}`}>
                    {migrationStatus.error
                      ? `오류: ${migrationStatus.error}`
                      : `완료 — 스캔 ${migrationStatus.done}건 / 변경 ${migrationStatus.updated}건`}
                  </div>
                )}
                <button
                  onClick={runOfficeMigration}
                  disabled={migrationStatus === 'running'}
                  className="px-4 py-2 bg-orange-900/60 border border-orange-600/50 text-orange-300 font-black rounded-xl hover:bg-orange-800/60 transition-colors disabled:opacity-40 flex items-center gap-2 text-sm"
                >
                  <RefreshCw size={14} className={migrationStatus === 'running' ? 'animate-spin' : ''}/> 마이그레이션 실행
                </button>
              </div>
            </div>

            {/* 최근 배치 저장 로그 */}
            <div>
              <h3 className="text-gray-400 font-black text-base flex items-center gap-2 mb-3">
                <Zap size={18}/> 최근 배치 저장 로그
              </h3>
              <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-[#333]">
                {auditLogs.slice(0, 50).map(log => (
                  <div key={log.id} className="flex items-center justify-between px-4 py-2 bg-black/30 border border-[#0f1a2e] rounded-lg text-xs hover:bg-white/3">
                    <div className="flex items-center gap-3">
                      <span className="text-[#3b82f6] font-black">{log.city || '-'}</span>
                      <span className="text-gray-600 font-mono text-[10px]">{log.adminEmail || '-'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <span className="text-blue-400">+{log.addCount || 0}</span>
                      <span className="text-amber-400">~{log.updateCount || 0}</span>
                      <span className="text-gray-600 font-mono">{fmt(log.timestamp || log.createdAt)}</span>
                    </div>
                  </div>
                ))}
                {auditLogs.length === 0 && !auditLoading && (
                  <p className="text-center text-gray-700 py-6 text-xs">기록된 로그가 없습니다.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 소속사·회사 관리 모달 ── */}
        {showOrgMgr && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10 p-4">
            <div className="w-full max-w-2xl bg-[#0a100c] border border-purple-600/40 rounded-2xl shadow-[0_0_40px_rgba(168,85,247,0.15)] flex flex-col" style={{maxHeight:'80vh'}}>
              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a2e] shrink-0">
                <div className="flex items-center gap-2">
                  <Building2 size={18} className="text-purple-400"/>
                  <h3 className="text-white font-black">소속사·회사 관리</h3>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-0.5 bg-black/40 border border-[#333] rounded-lg p-0.5">
                    <button
                      onClick={() => setOrgMgrTab('org')}
                      className={`px-3 py-1.5 rounded text-xs font-black transition-colors ${orgMgrTab === 'org' ? 'bg-purple-900/70 text-purple-300' : 'text-gray-500 hover:text-white'}`}
                    >소속사</button>
                    <button
                      onClick={() => { setOrgMgrTab('company'); if (!userCompanies.length) loadAllCompanies(); }}
                      className={`px-3 py-1.5 rounded text-xs font-black transition-colors ${orgMgrTab === 'company' ? 'bg-blue-900/70 text-blue-300' : 'text-gray-500 hover:text-white'}`}
                    >회사 <span className="text-[10px] opacity-70">({userCompanies.length})</span></button>
                  </div>
                  <button onClick={() => setShowOrgMgr(false)} className="text-gray-600 hover:text-white transition-colors"><X size={18}/></button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2d4a35] p-5">
                {orgMgrTab === 'org' ? (
                  /* ─── 소속사 탭 ─── */
                  <div>
                    <div className="flex gap-2 mb-4">
                      <input value={newOrgInput} onChange={e => setNewOrgInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addGlobalOrg()}
                        placeholder="소속사 이름 입력" autoFocus
                        className="flex-1 bg-black/60 border border-[#333] focus:border-purple-500/60 text-white placeholder-gray-700 px-3 py-2 rounded-xl outline-none text-sm"
                      />
                      <button onClick={addGlobalOrg} disabled={!newOrgInput.trim()}
                        className="px-3 py-2 bg-purple-900/60 border border-purple-600/50 text-purple-300 font-black rounded-xl hover:bg-purple-800/60 transition-colors disabled:opacity-40 flex items-center gap-1">
                        <Plus size={14}/> 추가
                      </button>
                    </div>
                    <div className="space-y-2">
                      {globalOrgs.length === 0 && <p className="text-center text-gray-700 text-sm py-6">등록된 소속사가 없습니다</p>}
                      {globalOrgs.map(name => (
                        <div key={name} className="bg-black/40 border border-[#222] rounded-xl p-3 hover:border-purple-700/30 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <span className="text-white font-black">{name}</span>
                              <span className="text-gray-700 text-[10px] ml-2">{users.filter(u => u.orgId === name).length}명 배정</span>
                            </div>
                            <button onClick={() => removeGlobalOrg(name)} className="text-gray-600 hover:text-red-400 transition-colors"><X size={14}/></button>
                          </div>
                          {/* 소속사 지자체 pills */}
                          <div className="flex flex-wrap gap-1">
                            {(orgCities[name] || []).map(city => (
                              <span key={city} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-purple-900/30 text-purple-300 border border-purple-700/30">
                                {city}
                                <button onClick={() => updateOrgCities(name, (orgCities[name] || []).filter(c => c !== city))} className="ml-0.5 opacity-60 hover:opacity-100 hover:text-red-400">×</button>
                              </span>
                            ))}
                            {/* 지자체 추가 버튼 */}
                            {orgCityPicker === name ? (
                              <div className="flex gap-1 items-center flex-wrap">
                                <select value={orgCityPickerSido} onChange={e => { setOrgCityPickerSido(e.target.value); setOrgCityPickerSigungu(''); }}
                                  className="bg-black/70 border border-[#444] text-gray-300 text-[10px] px-1 py-0.5 rounded outline-none focus:border-purple-500">
                                  <option value="">시/도</option>{sidoList.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <select value={orgCityPickerSigungu} onChange={e => setOrgCityPickerSigungu(e.target.value)} disabled={!orgCityPickerSido}
                                  className="bg-black/70 border border-[#444] text-gray-300 text-[10px] px-1 py-0.5 rounded outline-none focus:border-purple-500 disabled:opacity-40">
                                  <option value="">시/군/구</option>{orgCityPickerSido && getSigunguOptions(orgCityPickerSido).map(sg => <option key={sg} value={sg}>{sg}</option>)}
                                </select>
                                <button onClick={() => {
                                  if (!orgCityPickerSido || !orgCityPickerSigungu) return;
                                  const cityId = `${orgCityPickerSido} ${orgCityPickerSigungu}`;
                                  const cur = orgCities[name] || [];
                                  if (!cur.includes(cityId)) updateOrgCities(name, [...cur, cityId]);
                                  setOrgCityPicker(null); setOrgCityPickerSido(''); setOrgCityPickerSigungu('');
                                }} disabled={!orgCityPickerSido || !orgCityPickerSigungu}
                                  className="px-2 py-0.5 bg-purple-900/40 text-purple-300 border border-purple-700/40 rounded text-[10px] font-black hover:bg-purple-800/50 disabled:opacity-40">추가</button>
                                <button onClick={() => { setOrgCityPicker(null); setOrgCityPickerSido(''); setOrgCityPickerSigungu(''); }}
                                  className="px-1.5 py-0.5 bg-black/40 text-gray-500 border border-[#333] rounded text-[10px]">✕</button>
                              </div>
                            ) : (
                              <button onClick={() => { setOrgCityPicker(name); setOrgCityPickerSido(''); setOrgCityPickerSigungu(''); }}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-black/40 text-gray-600 border border-[#222] hover:text-purple-400 hover:border-purple-700/40 transition-colors">
                                <Plus size={9}/> 지자체
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-gray-700 text-[10px] mt-3 text-center">제거해도 기존 배정된 유저의 소속은 유지됩니다</p>
                  </div>
                ) : (
                  /* ─── 회사 탭 ─── */
                  <div>
                    <div className="flex gap-2 mb-4">
                      <input value={newCompanyName} onChange={e => setNewCompanyName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCompany()}
                        placeholder="회사명 입력 (코드 자동 생성)"
                        className="flex-1 bg-black/60 border border-[#333] focus:border-blue-500/60 text-white placeholder-gray-700 px-3 py-2 rounded-xl outline-none text-sm"
                      />
                      <button onClick={addCompany} disabled={!newCompanyName.trim()}
                        className="px-3 py-2 bg-blue-900/60 border border-blue-600/50 text-blue-300 font-black rounded-xl hover:bg-blue-800/60 transition-colors disabled:opacity-40 flex items-center gap-1">
                        <Plus size={14}/> 추가
                      </button>
                    </div>
                    <div className="space-y-2">
                      {userCompanies.length === 0 && <p className="text-center text-gray-700 text-sm py-6">등록된 회사가 없습니다</p>}
                      {userCompanies.map(c => (
                        <div key={c.id} className="bg-black/40 border border-[#0f1a2e] rounded-xl p-3 hover:border-blue-700/30 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {editingCompany?.id === c.id ? (
                                <input
                                  autoFocus
                                  value={editingCompany.name}
                                  onChange={e => setEditingCompany(prev => ({ ...prev, name: e.target.value }))}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') updateCompanyName(c.id, editingCompany.name);
                                    if (e.key === 'Escape') setEditingCompany(null);
                                  }}
                                  onBlur={() => updateCompanyName(c.id, editingCompany.name)}
                                  className="flex-1 bg-black/60 border border-blue-500/60 text-white px-2 py-0.5 rounded text-sm outline-none min-w-0"
                                />
                              ) : (
                                <>
                                  <span className="text-white font-black">{c.name}</span>
                                  <button onClick={() => setEditingCompany({ id: c.id, name: c.name })} className="text-gray-600 hover:text-blue-400 transition-colors shrink-0" title="회사명 수정">
                                    <Edit2 size={11}/>
                                  </button>
                                </>
                              )}
                              <span className="font-mono text-[10px] text-blue-400/70 ml-1 bg-blue-950/30 px-1.5 py-0.5 rounded shrink-0">{c.id}</span>
                              <span className="text-gray-700 text-[10px] ml-1 shrink-0">{users.filter(u => u.companyCode === c.id).length}명 배정</span>
                            </div>
                            <button onClick={() => deleteCompany(c.id)} className="text-gray-600 hover:text-red-400 transition-colors ml-2" title="회사 삭제">
                              <Trash2 size={13}/>
                            </button>
                          </div>
                          {/* 회사 지자체 pills */}
                          <div className="flex flex-wrap gap-1">
                            {(c.cities || []).map(city => (
                              <span key={city} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-blue-900/30 text-blue-300 border border-blue-700/30">
                                {city}
                                <button onClick={() => removeCityFromCompany(c.id, city)} className="ml-0.5 opacity-60 hover:opacity-100 hover:text-red-400">×</button>
                              </span>
                            ))}
                            {/* 지자체 추가 버튼 */}
                            {companyCityPicker === c.id ? (
                              <div className="flex gap-1 items-center flex-wrap">
                                <select value={companyCityPickerSido} onChange={e => { setCompanyCityPickerSido(e.target.value); setCompanyCityPickerSigungu(''); }}
                                  className="bg-black/70 border border-[#444] text-gray-300 text-[10px] px-1 py-0.5 rounded outline-none focus:border-blue-500">
                                  <option value="">시/도</option>{sidoList.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <select value={companyCityPickerSigungu} onChange={e => setCompanyCityPickerSigungu(e.target.value)} disabled={!companyCityPickerSido}
                                  className="bg-black/70 border border-[#444] text-gray-300 text-[10px] px-1 py-0.5 rounded outline-none focus:border-blue-500 disabled:opacity-40">
                                  <option value="">시/군/구</option>{companyCityPickerSido && getSigunguOptions(companyCityPickerSido).map(sg => <option key={sg} value={sg}>{sg}</option>)}
                                </select>
                                <button onClick={() => addCityToCompany(c.id, `${companyCityPickerSido} ${companyCityPickerSigungu}`)}
                                  disabled={!companyCityPickerSido || !companyCityPickerSigungu}
                                  className="px-2 py-0.5 bg-blue-900/40 text-blue-300 border border-blue-700/40 rounded text-[10px] font-black hover:bg-blue-800/50 disabled:opacity-40">추가</button>
                                <button onClick={() => { setCompanyCityPicker(null); setCompanyCityPickerSido(''); setCompanyCityPickerSigungu(''); }}
                                  className="px-1.5 py-0.5 bg-black/40 text-gray-500 border border-[#333] rounded text-[10px]">✕</button>
                              </div>
                            ) : (
                              <button onClick={() => { setCompanyCityPicker(c.id); setCompanyCityPickerSido(''); setCompanyCityPickerSigungu(''); }}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-black/40 text-gray-600 border border-[#222] hover:text-blue-400 hover:border-blue-700/40 transition-colors">
                                <Plus size={9}/> 지자체
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-gray-700 text-[10px] mt-3 text-center">회사 지자체 변경 시 배정된 모든 사용자의 승인 지자체가 즉시 동기화됩니다</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 등급 변경 확인 모달 */}
        {tierTarget && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className="w-full max-w-sm bg-[#0a100c] border border-[#3b82f6]/40 rounded-2xl p-6 shadow-[0_0_40px_rgba(59,130,246,0.15)]">
              <div className="flex items-center gap-2 mb-4">
                <Crown size={18} className="text-[#3b82f6]"/>
                <h3 className="text-white font-black">등급 변경 확인</h3>
              </div>
              <p className="text-gray-400 text-sm mb-1">
                <span className="text-white font-bold">{tierTarget.user.realName || tierTarget.user.email}</span> 님의 등급을
              </p>
              <div className="flex items-center gap-3 my-4 px-2">
                <TierBadge tier={tierTarget.user.tier || 'basic'} />
                <span className="text-gray-600 text-lg">→</span>
                <TierBadge tier={tierTarget.newTier} />
              </div>
              <p className="text-gray-500 text-xs mb-2">으로 변경합니다. 변경 즉시 적용됩니다.</p>
              <p className="text-gray-600 text-[11px] mb-5">
                지자체 수 기본값: {TIER_DEFAULT_CITIES[tierTarget?.newTier] ?? 1}개로 자동 설정됩니다. (이후 개별 조정 가능)
              </p>
              <div className="flex gap-2">
                <button onClick={() => setTierTarget(null)} className="flex-1 py-2.5 bg-black/40 border border-[#333] text-gray-400 font-bold rounded-xl hover:bg-[#222] transition-colors text-sm">취소</button>
                <button onClick={handleTierChange} disabled={processing} className="flex-1 py-2.5 bg-[#3b82f6]/20 border border-[#3b82f6]/50 text-[#3b82f6] font-extrabold rounded-xl hover:bg-[#3b82f6]/30 transition-colors text-sm disabled:opacity-50">
                  {processing ? '처리 중...' : '변경 확인'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 권한 변경 확인 모달 */}
        {roleTarget && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className={`w-full max-w-sm rounded-2xl p-6 shadow-[0_0_40px_rgba(217,119,6,0.2)] border ${
              roleTarget.newRole === 'admin' ? 'bg-amber-950/30 border-amber-600/50' : 'bg-[#0a100c] border-[#333]'
            }`}>
              <div className="flex items-center gap-2 mb-4">
                <ShieldAlert size={18} className={roleTarget.newRole === 'admin' ? 'text-amber-400' : 'text-gray-400'}/>
                <h3 className="text-white font-black">권한 변경 확인</h3>
              </div>
              {roleTarget.newRole === 'admin' && (
                <div className="mb-4 bg-amber-900/20 border border-amber-700/40 rounded-xl p-3 text-xs text-amber-300 leading-relaxed">
                  ⚠️ 최고관리자로 지정하면 모든 사용자 데이터·설정·권한을 제어할 수 있습니다. 신중하게 결정하세요.
                </div>
              )}
              <p className="text-gray-400 text-sm mb-1">
                <span className="text-white font-bold">{roleTarget.user.realName || roleTarget.user.email}</span> 님의 권한을
              </p>
              <div className="flex items-center gap-3 my-4 px-2">
                <RoleBadge role={roleTarget.user.role || 'user'} />
                <span className="text-gray-600 text-lg">→</span>
                <RoleBadge role={roleTarget.newRole} />
              </div>
              <p className="text-gray-500 text-xs mb-5">으로 변경합니다. 변경 즉시 적용됩니다.</p>
              <div className="flex gap-2">
                <button onClick={() => setRoleTarget(null)} className="flex-1 py-2.5 bg-black/40 border border-[#333] text-gray-400 font-bold rounded-xl hover:bg-[#222] transition-colors text-sm">취소</button>
                <button
                  onClick={handleRoleChange}
                  disabled={processing}
                  className={`flex-1 py-2.5 font-extrabold rounded-xl transition-colors text-sm disabled:opacity-50 ${
                    roleTarget.newRole === 'admin'
                      ? 'bg-amber-900/60 border border-amber-600/60 text-amber-300 hover:bg-amber-800/60'
                      : 'bg-[#3b82f6]/20 border border-[#3b82f6]/50 text-[#3b82f6] hover:bg-[#3b82f6]/30'
                  }`}
                >
                  {processing ? '처리 중...' : '변경 확인'}
                </button>
              </div>
            </div>
          </div>
        )}


        {/* 등급 승인 확인 모달 */}
        {tierUpgradeTarget && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className="w-full max-w-sm bg-[#0a100c] border border-amber-600/40 rounded-2xl p-6 shadow-[0_0_40px_rgba(217,119,6,0.2)]">
              <div className="flex items-center gap-2 mb-4">
                <Crown size={18} className="text-amber-400"/>
                <h3 className="text-white font-black">등급 승인 확인</h3>
              </div>
              <p className="text-gray-400 text-sm mb-1">
                <span className="text-white font-bold">{tierUpgradeTarget.matchedUser?.realName || tierUpgradeTarget.inq.email}</span> 님의 등급을
              </p>
              <div className="flex items-center gap-3 my-4 px-2">
                <TierBadge tier={tierUpgradeTarget.matchedUser?.tier || 'basic'} />
                <span className="text-gray-600 text-lg">→</span>
                <TierBadge tier={tierUpgradeTarget.newTier} />
              </div>
              <p className="text-gray-500 text-xs mb-5">으로 변경하고 문의를 처리 완료로 표시합니다.</p>
              <div className="flex gap-2">
                <button onClick={() => setTierUpgradeTarget(null)} className="flex-1 py-2.5 bg-black/40 border border-[#333] text-gray-400 font-bold rounded-xl hover:bg-[#222] transition-colors text-sm">취소</button>
                <button onClick={handleTierUpgradeInquiry} disabled={processing} className="flex-1 py-2.5 bg-amber-900/50 border border-amber-600/60 text-amber-300 font-extrabold rounded-xl hover:bg-amber-800/50 transition-colors text-sm disabled:opacity-50">
                  {processing ? '처리 중...' : '승인 확정'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 제재 확인 모달 */}
        {banTarget && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
            <div className="w-full max-w-sm bg-[#0f1a10] border border-red-500/40 rounded-2xl p-6 shadow-[0_0_40px_rgba(239,68,68,0.2)]">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle size={20} className="text-red-400"/>
                <h3 className="text-white font-black">이용 제재 확인</h3>
              </div>
              <p className="text-gray-400 text-sm mb-1">
                <span className="text-white font-bold">{banTarget.realName || banTarget.email}</span> 님의 이용을 제재합니다.
              </p>
              {banTarget.region && <p className="text-gray-600 text-xs mb-4">소속: {banTarget.region}</p>}
              <div className="mb-4">
                <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">제재 사유 (선택)</label>
                <input
                  value={banReason}
                  onChange={e => setBanReason(e.target.value)}
                  placeholder="사유를 입력하면 기록됩니다"
                  className="w-full bg-black/50 border border-[#2d2d2d] focus:border-red-500/50 text-white p-3 rounded-xl outline-none text-sm placeholder-gray-700"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setBanTarget(null)} className="flex-1 py-2.5 bg-black/40 border border-[#333] text-gray-400 font-bold rounded-xl hover:bg-[#222] transition-colors text-sm">취소</button>
                <button onClick={handleBan} disabled={processing} className="flex-1 py-2.5 bg-red-950/60 border border-red-500/60 text-red-400 font-extrabold rounded-xl hover:bg-red-900/60 transition-colors text-sm disabled:opacity-50">
                  {processing ? '처리 중...' : '제재 실행'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 사용자 기사 관리 모달 ──────────────────────────────────────── */}
        {driverManageTarget && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[200]" onClick={e => { if (e.target === e.currentTarget) { setDriverManageTarget(null); setDriverManageForm(null); } }}>
            <div className="w-full max-w-xl bg-[#0a0a0a] border border-emerald-700/40 rounded-2xl shadow-[0_0_60px_rgba(16,185,129,0.15)] flex flex-col max-h-[85vh]">
              {/* 헤더 */}
              <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#1a1a1a]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-900/40 border border-emerald-600/30 flex items-center justify-center">
                    <Truck size={14} className="text-emerald-400"/>
                  </div>
                  <div>
                    <h3 className="text-white font-black text-sm flex items-center gap-2">
                      {driverManageTarget.realName || driverManageTarget.email}
                      <span className="text-[10px] bg-emerald-900/40 border border-emerald-700/40 text-emerald-300 px-2 py-0.5 rounded-lg font-black">
                        {getTargetDriverPath(driverManageTarget)}
                      </span>
                    </h3>
                    <p className="text-gray-500 text-[11px]">{driverManageTarget.email} · 기사 {driverManageList.filter(d => d.status !== 'inactive').length}명 활성</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDriverManageForm({ id: 'new', name: '', capacity: 100, color: '#3b82f6', memo: '', status: 'active' })}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-900/40 border border-emerald-600/40 text-emerald-300 text-[11px] font-black rounded-lg hover:bg-emerald-800/50 transition-colors"
                  ><Plus size={11}/> 기사 추가</button>
                  <button onClick={() => { setDriverManageTarget(null); setDriverManageForm(null); }} className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors">
                    <X size={14}/>
                  </button>
                </div>
              </div>

              {/* 기사 추가/수정 폼 */}
              {driverManageForm && (
                <div className="shrink-0 px-6 py-4 border-b border-[#1a1a1a] bg-emerald-950/20">
                  <div className="flex items-center gap-2 mb-3">
                    <Edit2 size={12} className="text-emerald-400"/>
                    <span className="text-emerald-300 text-[11px] font-black">{driverManageForm.id === 'new' ? '새 기사 추가' : '기사 정보 수정'}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <input
                      placeholder="기사 이름 *"
                      value={driverManageForm.name}
                      onChange={e => setDriverManageForm(prev => ({ ...prev, name: e.target.value }))}
                      className="flex-1 min-w-[120px] bg-black/60 border border-[#333] focus:border-emerald-500/60 text-white px-3 py-1.5 rounded-lg text-xs outline-none"
                    />
                    <input
                      type="number" min={1} max={200} placeholder="업무능력%"
                      value={driverManageForm.capacity}
                      onChange={e => setDriverManageForm(prev => ({ ...prev, capacity: e.target.value }))}
                      className="w-24 bg-black/60 border border-[#333] focus:border-emerald-500/60 text-white px-3 py-1.5 rounded-lg text-xs outline-none"
                    />
                    <input
                      placeholder="메모"
                      value={driverManageForm.memo}
                      onChange={e => setDriverManageForm(prev => ({ ...prev, memo: e.target.value }))}
                      className="flex-1 min-w-[100px] bg-black/60 border border-[#333] focus:border-emerald-500/60 text-white px-3 py-1.5 rounded-lg text-xs outline-none"
                    />
                    <div className="flex gap-1 items-center flex-wrap">
                      {DRIVER_COLORS_ADMIN.map(c => (
                        <button key={c} onClick={() => setDriverManageForm(prev => ({ ...prev, color: c }))}
                          className={`w-5 h-5 rounded-full border-2 transition-transform ${driverManageForm.color === c ? 'border-white scale-125' : 'border-transparent hover:scale-110'}`}
                          style={{ background: c }}/>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 justify-end">
                    <button onClick={() => setDriverManageForm(null)} className="px-4 py-1.5 bg-black/40 border border-[#333] text-gray-400 text-xs font-black rounded-lg hover:bg-[#1a1a1a] transition-colors">취소</button>
                    <button onClick={saveTargetDriver} disabled={driverManageSaving || !driverManageForm.name?.trim()}
                      className="px-4 py-1.5 bg-emerald-700/60 border border-emerald-600/50 text-emerald-200 text-xs font-black rounded-lg hover:bg-emerald-600/70 disabled:opacity-40 flex items-center gap-1 transition-colors">
                      {driverManageSaving ? <><RefreshCw size={10} className="animate-spin"/>저장 중...</> : '저장'}
                    </button>
                  </div>
                </div>
              )}

              {/* 기사 목록 */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                {driverManageLoading ? (
                  <div className="flex items-center justify-center h-20 text-gray-500 text-sm gap-2"><RefreshCw size={14} className="animate-spin"/> 불러오는 중...</div>
                ) : driverManageList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-24 text-gray-600">
                    <Truck size={28} className="mb-2 opacity-30"/>
                    <p className="text-sm">등록된 기사 없음</p>
                    <p className="text-[11px] mt-1">위 [기사 추가] 버튼으로 등록하세요</p>
                  </div>
                ) : (
                  driverManageList.map(driver => {
                    const isInactive = driver.status === 'inactive';
                    return (
                      <div key={driver.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${isInactive ? 'opacity-50 border-[#1a1a1a] bg-black/20' : 'border-[#1e1e1e] bg-[#0d0d0d] hover:border-[#2a2a2a]'}`}>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-white text-sm shrink-0" style={{ background: driver.color || '#3b82f6' }}>
                          {(driver.name || '?')[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-black text-sm">{driver.name}</span>
                            <span className="text-[10px] font-bold" style={{ color: driver.color || '#3b82f6' }}>업무능력 {driver.capacity || 100}%</span>
                            {isInactive && <span className="text-[10px] text-gray-600 font-bold">비활성</span>}
                          </div>
                          {driver.memo && <p className="text-gray-500 text-[11px] truncate">{driver.memo}</p>}
                          {driver.assignedZones?.length > 0 && (
                            <p className="text-[10px] text-gray-600 truncate">{driver.assignedZones.flatMap(z => z.dongs || []).slice(0, 5).join(' · ')}{driver.assignedZones.flatMap(z => z.dongs || []).length > 5 ? ' ...' : ''}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => setDriverManageForm({ ...driver })}
                            className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-blue-400 hover:bg-blue-900/30 rounded-lg transition-colors" title="수정">
                            <Edit2 size={12}/>
                          </button>
                          <button onClick={() => toggleTargetDriverStatus(driver)}
                            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${isInactive ? 'text-gray-600 hover:text-emerald-400 hover:bg-emerald-900/30' : 'text-emerald-500 hover:text-gray-500 hover:bg-black/40'}`}
                            title={isInactive ? '활성화' : '비활성화'}>
                            <UserCheck size={12}/>
                          </button>
                          <button onClick={() => deleteTargetDriver(driver.id)}
                            className="w-7 h-7 flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-colors" title="삭제">
                            <Trash2 size={12}/>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div className="absolute inset-0 bg-black/85 flex items-center justify-center z-10">
            <div className="w-full max-w-sm bg-[#130808] border border-red-600/50 rounded-2xl p-6 shadow-[0_0_40px_rgba(220,38,38,0.25)]">
              <div className="flex items-center gap-2 mb-4">
                <Trash2 size={20} className="text-red-500"/>
                <h3 className="text-white font-black">사용자 영구 삭제</h3>
              </div>
              <p className="text-gray-300 text-sm mb-1">
                <span className="text-red-400 font-black">{deleteTarget.realName || deleteTarget.email}</span> 님의 계정을 삭제합니다.
              </p>
              <p className="text-[11px] text-gray-600 mb-1">{deleteTarget.email}</p>
              <div className="bg-red-950/30 border border-red-800/30 rounded-xl p-3 mb-5 mt-3">
                <p className="text-xs text-red-400 font-bold leading-relaxed">
                  ⚠️ Firestore 사용자 문서가 영구 삭제됩니다.<br/>
                  Firebase Auth 계정은 별도 콘솔에서 삭제하세요.<br/>
                  이 작업은 되돌릴 수 없습니다.
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 bg-black/40 border border-[#333] text-gray-400 font-bold rounded-xl hover:bg-[#222] transition-colors text-sm">취소</button>
                <button onClick={handleDeleteUser} disabled={processing} className="flex-1 py-2.5 bg-red-900/70 border border-red-600/70 text-red-300 font-extrabold rounded-xl hover:bg-red-800/80 transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-1.5">
                  <Trash2 size={13}/> {processing ? '삭제 중...' : '영구 삭제'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
