import { useState, useEffect } from 'react';
import { getDocs, updateDoc, doc, collection, db, serverTimestamp } from '../config/firebase.js';
import { X, Users, BarChart2, Clock, ShieldOff, ShieldCheck, AlertTriangle, Crown, MessageSquare, CheckCircle2 } from 'lucide-react';

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

export default function AdminPanel({ onClose, adminUid }) {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banTarget, setBanTarget] = useState(null);
  const [banReason, setBanReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [tierTarget, setTierTarget] = useState(null); // { user, newTier }
  const [editingCity, setEditingCity] = useState({}); // { uid: draftValue }

  // AI Advisor States
  const [aiLogs, setAiLogs] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRules, setAiRules] = useState(null);

  const [inquiries, setInquiries] = useState([]);

  const fetchUsers = () => {
    setLoading(true);
    getDocs(collection(db, 'users')).then(snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.id !== adminUid)
        .sort((a, b) => (b.lastLogin?.seconds || 0) - (a.lastLogin?.seconds || 0));
      setUsers(list);
    }).finally(() => setLoading(false));
  };

  const fetchAiData = async () => {
    setAiLoading(true);
    try {
      const [logsSnap, rulesSnap] = await Promise.all([
        getDocs(collection(db, 'nexus_ai_logs')),
        getDocs(collection(db, 'nexus_config'))
      ]);
      const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(l => l.status === 'pending');
      setAiLogs(logs);
      
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
  }, []);

  const fetchInquiries = () => {
    getDocs(collection(db, 'inquiries')).then(snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setInquiries(list);
    });
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
      if (r.match.test(colName)) {
        if (r.score > best.score) {
          best = { key: r.key, score: r.score, reason: `'${r.key}' 관련 키워드 감지됨` };
        }
      }
    }
    // 글자 수 기반 페널티 (너무 길면 오탐 확률 높음)
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
      // 기존 룰 가져와서 업데이트
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

      await updateDoc(ref, { reqKeys: currentRules });
      
      // 로그 상태 업데이트
      const logsToUpdate = aiLogs.filter(l => l.cols.includes(colName));
      for (const l of logsToUpdate) {
        await updateDoc(doc(db, 'nexus_ai_logs', l.id), { status: 'applied', appliedKey: targetKey, appliedCol: colName });
      }
      
      alert(`'${colName}' 컬럼이 '${targetKey}' 규칙에 성공적으로 추가되었습니다!`);
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
      const logsToUpdate = aiLogs.filter(l => l.cols.includes(colName));
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

  // 미인식 컬럼 집계
  const aggregatedCols = {};
  aiLogs.forEach(l => {
    const colList = Array.isArray(l.cols) ? l.cols : (l.columnName ? [l.columnName] : []);
    colList.forEach(c => {
      if (!aggregatedCols[c]) aggregatedCols[c] = { count: 0, files: new Set() };
      aggregatedCols[c].count++;
      aggregatedCols[c].files.add(l.fileName);
    });
  });
  const aiSuggestions = Object.entries(aggregatedCols)
    .map(([col, data]) => ({ col, count: data.count, files: [...data.files], analysis: analyzeSuggestion(col) }))
    .sort((a, b) => b.count - a.count);

  const tierCounts = Object.keys(TIERS).reduce((acc, k) => {
    acc[k] = users.filter(u => (u.tier || 'basic') === k).length;
    return acc;
  }, {});
  const totalRows   = users.reduce((s, u) => s + (u.totalRowsProcessed  || 0), 0);
  const totalFiles  = users.reduce((s, u) => s + (u.totalFilesProcessed || 0), 0);
  const bannedCount = users.filter(u => u.status === 'banned').length;

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
    } finally { setProcessing(false); }
  };

  const handleUnban = async (uid) => {
    setProcessing(true);
    try {
      await updateDoc(doc(db, 'users', uid), { status: 'active', bannedAt: null, bannedReason: '' });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, status: 'active' } : u));
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
    } finally { setProcessing(false); }
  };

  const saveCityLimit = async (uid, rawVal) => {
    const val = Math.max(1, Math.min(999, parseInt(rawVal, 10) || 1));
    setEditingCity(prev => ({ ...prev, [uid]: val }));
    try {
      await updateDoc(doc(db, 'users', uid), { maxCities: val });
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, maxCities: val } : u));
    } catch { /* silent */ }
    setEditingCity(prev => { const n = { ...prev }; delete n[uid]; return n; });
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[600] flex items-center justify-center p-4">
      <div className="w-full max-w-7xl bg-[#0a100c] border border-[#22c55e]/30 rounded-3xl shadow-[0_0_60px_rgba(34,197,94,0.2)] flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-[#1e2d22] shrink-0">
          <div>
            <h2 className="text-xl font-black text-[#22c55e] flex items-center gap-3"><Users size={22}/> 관리자 대시보드</h2>
            <p className="text-gray-500 text-xs mt-1">사용자 현황 · 등급 관리 · 이용 통계 · 제재 관리 · AI Advisor</p>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'users' ? 'bg-[#22c55e] text-black shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'bg-[#111] text-gray-400 border border-[#333] hover:text-white hover:bg-[#222]'}`}
            >
              사용자 관리
            </button>
            <button
              onClick={() => setActiveTab('ai_advisor')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${activeTab === 'ai_advisor' ? 'bg-[#22c55e] text-black shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'bg-[#111] text-gray-400 border border-[#333] hover:text-white hover:bg-[#222]'}`}
            >
              <Crown size={16} /> NEXUS AI Advisor
              {aiSuggestions.length > 0 && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full ml-1">
                  {aiSuggestions.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('inquiries')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 ${activeTab === 'inquiries' ? 'bg-[#22c55e] text-black shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'bg-[#111] text-gray-400 border border-[#333] hover:text-white hover:bg-[#222]'}`}
            >
              <MessageSquare size={16} /> 승인/문의 관리
              {inquiries.filter(i => i.status === 'pending').length > 0 && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full ml-1">
                  {inquiries.filter(i => i.status === 'pending').length}
                </span>
              )}
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1 ml-4"><X size={22}/></button>
          </div>
        </div>

        {activeTab === 'users' && (
          <>
            {/* Stats — 등급 분포 + 이용 통계 */}
            <div className="px-8 py-4 border-b border-[#1e2d22] shrink-0 space-y-3">
              {/* 등급 분포 */}
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
              {/* 이용 통계 */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { icon: <Users size={14}/>,     label: '총 사용자',      value: `${users.length}명` },
                  { icon: <ShieldOff size={14}/>, label: '제재 중',        value: `${bannedCount}명`, red: bannedCount > 0 },
                  { icon: <BarChart2 size={14}/>, label: '누적 처리 행',   value: `${totalRows.toLocaleString()}행` },
                  { icon: <Clock size={14}/>,     label: '누적 처리 파일', value: `${totalFiles.toLocaleString()}건` },
                ].map(({ icon, label, value, red }) => (
                  <div key={label} className="bg-black/50 rounded-xl p-3 border border-[#1e2d22]">
                    <p className="text-gray-500 text-[10px] font-bold mb-1 flex items-center gap-1">{icon}{label}</p>
                    <p className={`text-xl font-black ${red ? 'text-red-400' : 'text-[#22c55e]'}`}>{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#2d4a35]">
              {loading ? (
                <div className="flex items-center justify-center h-32 text-gray-500 text-sm">불러오는 중...</div>
              ) : (
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="sticky top-0 bg-[#0a100c] border-b border-[#1e2d22] z-10">
                    <tr className="text-[#22c55e] text-[11px] font-black tracking-wide">
                      <th className="px-4 py-3 text-left">상태</th>
                      <th className="px-4 py-3 text-left">등급</th>
                      <th className="px-4 py-3 text-left">성명</th>
                      <th className="px-4 py-3 text-left">소속 지역</th>
                      <th className="px-4 py-3 text-left">이메일</th>
                      <th className="px-4 py-3 text-center">마지막 접속</th>
                      <th className="px-4 py-3 text-center">로그인</th>
                      <th className="px-4 py-3 text-center">처리 행</th>
                      <th className="px-4 py-3 text-center">지자체 수</th>
                      <th className="px-4 py-3 text-center">등급 변경</th>
                      <th className="px-4 py-3 text-center">제재</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2d22] text-gray-300">
                    {users.map(u => {
                      const isBanned = u.status === 'banned';
                      const hasProfile = u.profileCompleted;
                      const currentTier = u.tier || 'basic';
                      return (
                        <tr key={u.id} className={`hover:bg-white/5 transition-colors ${isBanned ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-3">
                            {isBanned
                              ? <span className="px-2 py-0.5 rounded text-[10px] font-black bg-red-950/60 text-red-400 border border-red-800/50" title={u.bannedReason}>제재중</span>
                              : hasProfile
                                ? <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30">활성</span>
                                : <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-950/40 text-amber-400 border border-amber-800/50">미등록</span>
                            }
                          </td>
                          <td className="px-4 py-3"><TierBadge tier={currentTier} /></td>
                          <td className="px-4 py-3 font-bold text-white">{u.realName || <span className="text-gray-600 text-xs">-</span>}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{u.region || <span className="text-gray-600">-</span>}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{u.email}</td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-gray-400">{fmt(u.lastLogin)}</td>
                          <td className="px-4 py-3 text-center text-[#22c55e] font-black">{(u.loginCount || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-center font-mono text-xs">{(u.totalRowsProcessed || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="number"
                              min={1} max={999}
                              value={editingCity[u.id] ?? (u.maxCities ?? TIER_DEFAULT_CITIES[currentTier] ?? 1)}
                              onChange={e => setEditingCity(prev => ({ ...prev, [u.id]: e.target.value }))}
                              onBlur={e => saveCityLimit(u.id, e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && saveCityLimit(u.id, e.target.value)}
                              className="w-14 text-center bg-black/60 border border-[#333] text-[#22c55e] font-black text-sm rounded-lg px-1 py-1 outline-none focus:border-[#22c55e] hover:border-[#555] transition-colors"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <select
                              value={currentTier}
                              onChange={e => setTierTarget({ user: u, newTier: e.target.value })}
                              disabled={processing}
                              className="bg-black/60 border border-[#333] text-gray-300 text-[11px] font-bold px-2 py-1 rounded-lg outline-none cursor-pointer focus:border-[#22c55e] hover:border-[#555] transition-colors"
                            >
                              {Object.entries(TIERS).map(([key, t]) => (
                                <option key={key} value={key}>{t.emoji} {t.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isBanned
                              ? <button onClick={() => handleUnban(u.id)} disabled={processing} className="px-3 py-1 bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] text-[11px] font-black rounded-lg hover:bg-[#22c55e]/20 transition-colors disabled:opacity-40 flex items-center gap-1 mx-auto">
                                  <ShieldCheck size={11}/> 해제
                                </button>
                              : <button onClick={() => { setBanTarget(u); setBanReason(''); }} disabled={processing} className="px-3 py-1 bg-red-950/40 border border-red-800/50 text-red-400 text-[11px] font-black rounded-lg hover:bg-red-900/50 transition-colors disabled:opacity-40 flex items-center gap-1 mx-auto">
                                  <ShieldOff size={11}/> 제재
                                </button>
                            }
                          </td>
                        </tr>
                      );
                    })}
                    {users.length === 0 && (
                      <tr><td colSpan={11} className="px-6 py-10 text-center text-gray-600">등록된 사용자 없음</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
        
        {activeTab === 'ai_advisor' && (
          <div className="flex-1 p-8 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2d4a35]">
            <div className="mb-6 border border-[#1e2d22] bg-[#0a100c] p-6 rounded-2xl flex items-start gap-4 shadow-lg shadow-[#0a100c]/50">
              <div className="w-12 h-12 bg-[#22c55e]/10 rounded-full flex items-center justify-center shrink-0 border border-[#22c55e]/30">
                <Crown size={24} className="text-[#22c55e]"/>
              </div>
              <div>
                <h3 className="text-xl font-black text-[#22c55e] mb-1">AI 자가 진화 분석 리포트</h3>
                <p className="text-gray-400 text-sm leading-relaxed">
                  현장에서 업로드된 엑셀 파일 중 시스템이 인식하지 못한 **미분류 컬럼**을 AI가 자동으로 수집하고 분석합니다.<br/>
                  제안된 항목을 확인하고 <b>[적용]</b>을 누르시면, 이후부터 해당 컬럼 이름도 즉시 데이터 추출 엔진에 인식됩니다.
                </p>
              </div>
            </div>

            {aiLoading ? (
              <div className="flex items-center justify-center py-20 text-gray-500 text-sm">분석 데이터를 불러오는 중...</div>
            ) : aiSuggestions.length === 0 ? (
              <div className="bg-black/40 border border-[#1e2d22] rounded-2xl p-10 text-center">
                <p className="text-gray-500 font-bold">새로 제안된 미인식 컬럼이 없습니다.</p>
                <p className="text-gray-600 text-xs mt-2">시스템이 이미 대부분의 컬럼을 완벽하게 인식하고 있습니다.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {aiSuggestions.map((s, idx) => (
                  <div key={idx} className="bg-black/40 border border-[#1e2d22] rounded-xl p-5 hover:bg-black/60 transition-colors">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h4 className="text-white font-black text-lg mb-1">{s.col}</h4>
                        <p className="text-gray-500 text-xs flex items-center gap-1">
                          발생 <strong className="text-[#22c55e]">{s.count}</strong>회 
                          <span className="text-gray-700">|</span> 
                          발견된 파일: {s.files.length}개
                        </p>
                      </div>
                      
                      <div className={`px-2 py-1 rounded text-[10px] font-black border ${
                        s.analysis.score >= 80 ? 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30' :
                        s.analysis.score >= 50 ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                        'bg-red-500/10 text-red-400 border-red-500/30'
                      }`}>
                        신뢰도 {Math.max(0, s.analysis.score)}%
                      </div>
                    </div>
                    
                    <div className="bg-black border border-[#1e2d22] p-3 rounded-lg mb-4 text-xs">
                      <p className="text-gray-400 mb-1">AI 매핑 제안 대상: <strong className="text-white">{s.analysis.key}</strong></p>
                      <p className="text-gray-500">사유: {s.analysis.reason}</p>
                    </div>

                    <div className="flex gap-2 mt-auto">
                      <button 
                        onClick={() => handleRejectAiSuggestion(s.col)}
                        disabled={processing}
                        className="flex-1 py-2 rounded-lg bg-black/50 text-gray-400 text-xs font-bold border border-[#333] hover:text-white hover:bg-red-950/30 hover:border-red-900/50 transition-colors"
                      >
                        무시 (오탐)
                      </button>
                      <button 
                        onClick={() => handleAcceptAiSuggestion(s.col, s.analysis.key)}
                        disabled={processing || s.analysis.key === '알수없음'}
                        className="flex-2 py-2 px-6 rounded-lg bg-[#22c55e]/10 text-[#22c55e] text-xs font-black border border-[#22c55e]/30 hover:bg-[#22c55e] hover:text-black hover:border-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0)] hover:shadow-[0_0_15px_rgba(34,197,94,0.3)] transition-all disabled:opacity-30 disabled:hover:bg-[#22c55e]/10 disabled:hover:text-[#22c55e] disabled:cursor-not-allowed"
                      >
                        {s.analysis.key === '알수없음' ? '적용 불가' : `'${s.analysis.key}' 규칙으로 적용`}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'inquiries' && (
          <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#2d4a35] p-6">
            <h3 className="text-xl font-black text-[#22c55e] mb-4 flex items-center gap-2">
              <MessageSquare size={20} /> 승인 및 문의 내역
            </h3>
            {inquiries.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-gray-500 text-sm">접수된 문의가 없습니다.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {inquiries.map(inq => (
                  <div key={inq.id} className={`rounded-xl p-5 border ${inq.status === 'pending' ? 'bg-[#0f1a10] border-[#22c55e]/40 shadow-[0_0_20px_rgba(34,197,94,0.1)]' : 'bg-[#111] border-[#333] opacity-70'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${inq.status === 'pending' ? 'bg-[#22c55e]/20 text-[#22c55e] border-[#22c55e]/40' : 'bg-gray-800 text-gray-400 border-gray-600'}`}>
                        {inq.status === 'pending' ? '대기 중' : '처리 완료'}
                      </span>
                      <span className="text-[10px] font-mono text-gray-500">{fmt(inq.createdAt)}</span>
                    </div>
                    <div className="mb-4">
                      <h4 className="text-white font-bold text-lg">{inq.realName}</h4>
                      <p className="text-gray-400 text-sm">{inq.contact}</p>
                      <p className="text-gray-500 text-xs">{inq.email}</p>
                    </div>
                    <div className="mb-4 bg-black/40 p-3 rounded-lg border border-white/5">
                      <p className="text-[#22c55e] font-black text-sm mb-1">희망 등급: <span className="text-white">{inq.requestedPlan?.toUpperCase() || '-'}</span></p>
                      <p className="text-gray-400 text-xs whitespace-pre-wrap">{inq.message || '추가 내용 없음'}</p>
                    </div>
                    {inq.status === 'pending' && (
                      <button
                        onClick={async () => {
                          setProcessing(true);
                          try {
                            await updateDoc(doc(db, 'inquiries', inq.id), { status: 'completed', completedAt: serverTimestamp() });
                            setInquiries(prev => prev.map(i => i.id === inq.id ? { ...i, status: 'completed' } : i));
                          } finally {
                            setProcessing(false);
                          }
                        }}
                        disabled={processing}
                        className="w-full py-2.5 bg-[#22c55e]/20 text-[#22c55e] font-black rounded-lg hover:bg-[#22c55e] hover:text-black border border-[#22c55e]/30 transition-all flex justify-center items-center gap-2 disabled:opacity-50"
                      >
                        <CheckCircle2 size={16} /> 처리 완료로 표시
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 등급 변경 확인 모달 */}
      {tierTarget && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
          <div className="w-full max-w-sm bg-[#0a100c] border border-[#22c55e]/40 rounded-2xl p-6 shadow-[0_0_40px_rgba(34,197,94,0.15)]">
            <div className="flex items-center gap-2 mb-4">
              <Crown size={18} className="text-[#22c55e]"/>
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
              <button onClick={() => setTierTarget(null)} className="flex-1 py-2.5 bg-black/40 border border-[#333] text-gray-400 font-bold rounded-xl hover:bg-[#222] transition-colors text-sm">
                취소
              </button>
              <button onClick={handleTierChange} disabled={processing} className="flex-1 py-2.5 bg-[#22c55e]/20 border border-[#22c55e]/50 text-[#22c55e] font-extrabold rounded-xl hover:bg-[#22c55e]/30 transition-colors text-sm disabled:opacity-50">
                {processing ? '처리 중...' : '변경 확인'}
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
    </div>
  );
}
