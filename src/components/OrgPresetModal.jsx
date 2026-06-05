import { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  db,
  setDoc, doc, getDoc,
} from '../config/firebase.js';
import {
  X, Plus, Trash2, Save, Download, Building2, ChevronDown, ChevronUp,
  CheckSquare, Square,
} from 'lucide-react';

const PRESET_COLORS = [
  { id: 'blue',   label: '파랑', bg: 'bg-blue-900/40',   border: 'border-blue-500/50',   text: 'text-blue-400',   hex: '#3b82f6' },
  { id: 'purple', label: '보라', bg: 'bg-purple-900/40', border: 'border-purple-500/50', text: 'text-purple-400', hex: '#a855f7' },
  { id: 'green',  label: '초록', bg: 'bg-blue-900/40',  border: 'border-blue-500/50',  text: 'text-blue-400',  hex: '#3b82f6' },
  { id: 'orange', label: '주황', bg: 'bg-orange-900/40', border: 'border-orange-500/50', text: 'text-orange-400', hex: '#f97316' },
  { id: 'pink',   label: '분홍', bg: 'bg-pink-900/40',   border: 'border-pink-500/50',   text: 'text-pink-400',   hex: '#ec4899' },
  { id: 'cyan',   label: '하늘', bg: 'bg-cyan-900/40',   border: 'border-cyan-500/50',   text: 'text-cyan-400',   hex: '#06b6d4' },
  { id: 'yellow', label: '노랑', bg: 'bg-yellow-900/40', border: 'border-yellow-500/50', text: 'text-yellow-400', hex: '#eab308' },
  { id: 'red',    label: '빨강', bg: 'bg-red-900/40',    border: 'border-red-500/50',    text: 'text-red-400',    hex: '#ef4444' },
  { id: 'teal',   label: '청록', bg: 'bg-teal-900/40',   border: 'border-teal-500/50',   text: 'text-teal-400',   hex: '#14b8a6' },
  { id: 'lime',   label: '연두', bg: 'bg-lime-900/40',   border: 'border-lime-500/50',   text: 'text-lime-400',   hex: '#84cc16' },
  { id: 'indigo', label: '남색', bg: 'bg-indigo-900/40', border: 'border-indigo-500/50', text: 'text-indigo-400', hex: '#6366f1' },
  { id: 'rose',   label: '장미', bg: 'bg-rose-900/40',   border: 'border-rose-500/50',   text: 'text-rose-400',   hex: '#f43f5e' },
];

const colorById = (id) => PRESET_COLORS.find(c => c.id === id) || PRESET_COLORS[0];

// 세션 캐시 — 모달을 닫았다가 다시 열어도 DB 재조회 안 함
const _sessionCache = {};

export default function OrgPresetModal({ city, records, monthId, onClose }) {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedOrg, setExpandedOrg] = useState(null);
  const [editingOrgId, setEditingOrgId] = useState(null);
  const [editName, setEditName] = useState('');

  // 전역 소속사 목록 (nexus_config/orgs)
  const [globalOrgs, setGlobalOrgs] = useState([]);

  useEffect(() => {
    getDoc(doc(db, 'nexus_config', 'orgs')).then(snap => {
      setGlobalOrgs(snap.exists() ? (snap.data().list || []) : []);
    }).catch(() => setGlobalOrgs([]));
  }, []);

  const allDongs = useMemo(() => {
    const set = new Set();
    (records || []).forEach(r => { if (r.행정동) set.add(r.행정동.trim()); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [records]);

  const dongCounts = useMemo(() => {
    const map = {};
    (records || []).forEach(r => {
      if (r.행정동) { const d = r.행정동.trim(); map[d] = (map[d] || 0) + 1; }
    });
    return map;
  }, [records]);

  const assignedDongs = useMemo(() => {
    const map = {};
    orgs.forEach(org => { (org.dongs || []).forEach(d => { map[d] = org.id; }); });
    return map;
  }, [orgs]);

  // ── Load (세션 캐시 우선, 오픈 시 1회만) ──
  useEffect(() => {
    if (!city) return;
    if (_sessionCache[city]) {
      setOrgs(_sessionCache[city]);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'org_presets', city));
        const loaded = snap.exists() ? (snap.data().orgs || []) : [];
        _sessionCache[city] = loaded;
        setOrgs(loaded);
      } catch (e) {
        console.error('[OrgPresetModal] load:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [city]);

  // ── Save ──
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'org_presets', city), { orgs, updatedAt: new Date().toISOString() });
      _sessionCache[city] = orgs;
      alert('조직 배분 프리셋이 저장되었습니다.');
    } catch (e) {
      alert('저장 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddOrg = (orgName) => {
    const name = orgName || `조직 ${orgs.length + 1}`;
    const id = `org_${Date.now()}`;
    const usedColors = new Set(orgs.map(o => o.color));
    const nextColor = PRESET_COLORS.find(c => !usedColors.has(c.id))?.id || PRESET_COLORS[0].id;
    setOrgs(prev => [...prev, { id, name, color: nextColor, dongs: [] }]);
    setExpandedOrg(id);
  };

  // 이미 추가된 소속사 이름 목록
  const usedOrgNames = new Set(orgs.map(o => o.name));
  // 아직 추가 안 된 전역 소속사 목록
  const availableOrgs = globalOrgs.filter(n => !usedOrgNames.has(n));

  const handleRemoveOrg = (orgId) => {
    if (!confirm('이 조직을 삭제하시겠습니까?')) return;
    setOrgs(prev => prev.filter(o => o.id !== orgId));
    if (expandedOrg === orgId) setExpandedOrg(null);
  };

  const toggleDong = useCallback((orgId, dong) => {
    setOrgs(prev => prev.map(org => {
      if (org.id !== orgId) return org;
      const has = (org.dongs || []).includes(dong);
      return { ...org, dongs: has ? org.dongs.filter(d => d !== dong) : [...(org.dongs || []), dong] };
    }));
  }, []);

  const selectAllUnassigned = useCallback((orgId) => {
    setOrgs(prev => {
      const org = prev.find(o => o.id === orgId);
      if (!org) return prev;
      const assigned = {};
      prev.forEach(o => (o.dongs || []).forEach(d => { assigned[d] = o.id; }));
      const unassigned = allDongs.filter(d => !assigned[d] || assigned[d] === orgId);
      return prev.map(o => o.id === orgId ? { ...o, dongs: unassigned } : o);
    });
  }, [allDongs]);

  const changeColor = useCallback((orgId, colorId) => {
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, color: colorId } : o));
  }, []);

  const commitRename = useCallback((orgId) => {
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, name: editName.trim() || o.name } : o));
    setEditingOrgId(null);
  }, [editName]);

  const handleDownload = () => {
    if (!records?.length) return alert('레코드가 없습니다.');
    const wb = XLSX.utils.book_new();
    const unassignedDongs = allDongs.filter(d => !assignedDongs[d]);
    const makeSheetData = (recs) =>
      recs.map((r, i) => ({
        번호: i + 1, 구분: r.구분 || '', 이름: r.이름 || '', 생년월일: r.생년월일 || '',
        행정동: r.행정동 || '', 주소: r.주소 || '', 휴대폰: r.휴대폰 || '',
        유선전화: r.유선전화 || '', 포수: r.포수 || '', 특이사항: r.특이사항 || '',
        기사: r.기사 || '', 배송순번: r.배송순번 || '',
      }));

    orgs.forEach(org => {
      const orgRecs = records.filter(r => (org.dongs || []).includes((r.행정동 || '').trim()));
      if (!orgRecs.length) return;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(makeSheetData(orgRecs)), org.name.slice(0, 31));
    });
    if (unassignedDongs.length) {
      const unRecs = records.filter(r => unassignedDongs.includes((r.행정동 || '').trim()));
      if (unRecs.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(makeSheetData(unRecs)), '미배정');
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(makeSheetData(records)), '전체');
    if (wb.SheetNames.length === 0) return alert('다운로드할 데이터가 없습니다.');
    XLSX.writeFile(wb, `${city}_${monthId}_조직배분.xlsx`);
  };

  const totalAssigned = useMemo(() => {
    const set = new Set();
    orgs.forEach(o => (o.dongs || []).forEach(d => set.add(d)));
    return set.size;
  }, [orgs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#0a0a0a] border border-[#2a2a2a] rounded-2xl flex flex-col shadow-2xl overflow-hidden">

        {/* ── 헤더 ── */}
        <div className="h-14 shrink-0 flex items-center px-5 gap-3 border-b border-[#1a1a1a] bg-[#080808]">
          <Building2 size={16} className="text-purple-400" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black text-white">조직 배분 설정</h2>
            <p className="text-[10px] text-gray-600">
              {city} · {monthId} · 전체 {allDongs.length}개 행정동, {(records||[]).length}건 · 배정 {totalAssigned}/{allDongs.length}개
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-blue-900/30 border border-blue-500/30 text-blue-400 hover:bg-blue-900/50 transition-colors">
              <Download size={12} /> 조직별 다운로드
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-purple-900/30 border border-purple-500/30 text-purple-400 hover:bg-purple-900/50 transition-colors disabled:opacity-50">
              <Save size={12} /> {saving ? '저장 중...' : '프리셋 저장'}
            </button>
            <button onClick={onClose}
              className="p-2 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white border border-red-700/40 rounded-lg transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── 바디 ── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-600 text-sm animate-pulse">불러오는 중...</div>
          ) : (
            <>
              {/* 소속사 추가 — 전역 소속사 콤보박스 */}
              <div className="flex items-center gap-2">
                <Plus size={14} className="shrink-0 text-purple-400" />
                <select
                  value=""
                  onChange={e => { if (e.target.value) handleAddOrg(e.target.value); }}
                  className="flex-1 bg-black/40 border border-dashed border-[#444] hover:border-purple-500/60 text-gray-400 hover:text-purple-300 rounded-xl text-xs px-3 py-2.5 cursor-pointer transition-colors appearance-none outline-none focus:border-purple-500/60"
                  style={{ colorScheme: 'dark' }}
                >
                  <option value="" disabled>소속사 추가...</option>
                  {availableOrgs.length === 0
                    ? <option value="" disabled>추가 가능한 소속사 없음</option>
                    : availableOrgs.map(name => <option key={name} value={name}>{name}</option>)
                  }
                </select>
              </div>

              {orgs.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-700">
                  <Building2 size={32} className="opacity-20" />
                  <p className="text-xs">조직을 추가하여 행정동을 배분하세요</p>
                </div>
              )}

              {orgs.map(org => {
                const col = colorById(org.color);
                const isExpanded = expandedOrg === org.id;
                const orgDongs = org.dongs || [];
                const orgRecCount = records ? records.filter(r => orgDongs.includes((r.행정동||'').trim())).length : 0;

                return (
                  <div key={org.id} className={`border rounded-xl overflow-hidden ${col.border} ${col.bg}`}>

                    {/* ── 조직 헤더 행 ── */}
                    {/*
                      구조: [색선택 패널] [아코디언 트리거 영역]
                      중첩 button 금지 — 아코디언은 div+onClick, 내부 액션은 별도 div+stopPropagation
                    */}
                    <div className="flex items-stretch">

                      {/* 색 선택 패널 — 아코디언과 완전 분리 */}
                      <div className="flex items-center gap-0.5 px-2 py-2 bg-black/20 shrink-0 border-r border-white/5">
                        {PRESET_COLORS.map(c => (
                          <div
                            key={c.id}
                            role="button"
                            tabIndex={0}
                            title={c.label}
                            onPointerDown={e => { e.stopPropagation(); e.preventDefault(); changeColor(org.id, c.id); }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') changeColor(org.id, c.id); }}
                            className="flex items-center justify-center cursor-pointer rounded-full"
                            style={{ width: 26, height: 26 }}
                          >
                            <span
                              className="block rounded-full transition-all duration-150"
                              style={{
                                width:  org.color === c.id ? 18 : 11,
                                height: org.color === c.id ? 18 : 11,
                                backgroundColor: c.hex,
                                boxShadow: org.color === c.id ? `0 0 0 2.5px white` : 'none',
                                opacity: org.color === c.id ? 1 : 0.75,
                              }}
                            />
                          </div>
                        ))}
                      </div>

                      {/* 아코디언 트리거 — div로 구현, 내부에 button 없음 */}
                      <div
                        className="flex flex-1 items-center gap-3 px-4 py-3 cursor-pointer select-none"
                        onClick={() => setExpandedOrg(isExpanded ? null : org.id)}
                      >
                        {/* 이름 — 더블클릭으로 편집 */}
                        <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                          {editingOrgId === org.id ? (
                            <div className="flex flex-col gap-1">
                              {/* 소속사 목록에서 선택 */}
                              {globalOrgs.length > 0 && (
                                <select
                                  autoFocus
                                  value={editName}
                                  onChange={e => setEditName(e.target.value)}
                                  onBlur={() => commitRename(org.id)}
                                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') commitRename(org.id); }}
                                  className="bg-[#111] border border-purple-500/60 text-white text-xs font-bold rounded-lg px-2 py-1 outline-none w-52"
                                >
                                  {globalOrgs.map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                              )}
                              {/* 직접 입력도 가능 */}
                              <input
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                onBlur={() => commitRename(org.id)}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') commitRename(org.id); }}
                                placeholder="직접 입력..."
                                className="bg-transparent border-b border-white/30 text-white text-xs font-bold outline-none w-48 px-0 placeholder-gray-600"
                              />
                            </div>
                          ) : (
                            <span
                              className={`text-sm font-bold ${col.text}`}
                              onDoubleClick={e => { e.stopPropagation(); setEditingOrgId(org.id); setEditName(org.name); }}
                              title="더블클릭하여 소속사 변경"
                            >
                              {org.name}
                            </span>
                          )}
                        </div>

                        {/* 통계 */}
                        <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-gray-500 pointer-events-none">
                          <span>{orgDongs.length}개 동</span>
                          <span>·</span>
                          <span>{orgRecCount.toLocaleString()}건</span>
                        </div>

                        {/* 액션 아이콘 — stopPropagation으로 아코디언 토글 차단 */}
                        <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                          <span
                            role="button"
                            tabIndex={0}
                            title="이름 변경"
                            onPointerDown={e => { e.stopPropagation(); e.preventDefault(); setEditingOrgId(org.id); setEditName(org.name); }}
                            onKeyDown={e => { if (e.key === 'Enter') { setEditingOrgId(org.id); setEditName(org.name); } }}
                            className="p-1.5 text-gray-600 hover:text-white transition-colors cursor-pointer rounded text-sm"
                          >✏️</span>
                          <span
                            role="button"
                            tabIndex={0}
                            title="조직 삭제"
                            onPointerDown={e => { e.stopPropagation(); e.preventDefault(); handleRemoveOrg(org.id); }}
                            onKeyDown={e => { if (e.key === 'Enter') handleRemoveOrg(org.id); }}
                            className="p-1.5 text-gray-700 hover:text-red-400 transition-colors cursor-pointer rounded"
                          ><Trash2 size={12} /></span>
                        </div>

                        {isExpanded
                          ? <ChevronUp size={14} className="text-gray-500 shrink-0 pointer-events-none" />
                          : <ChevronDown size={14} className="text-gray-500 shrink-0 pointer-events-none" />}
                      </div>
                    </div>

                    {/* ── 행정동 선택 (펼침) ── */}
                    {isExpanded && (
                      <div className="border-t border-white/5 px-4 pb-4 pt-3">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[11px] text-gray-500">행정동 선택 (이름 더블클릭으로 수정)</span>
                          <button onClick={() => selectAllUnassigned(org.id)}
                            className="text-[11px] text-gray-500 hover:text-white transition-colors">
                            미배정 전체 선택
                          </button>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                          {allDongs.map(dong => {
                            const isSelected = orgDongs.includes(dong);
                            const isAssignedElsewhere = assignedDongs[dong] && assignedDongs[dong] !== org.id;
                            const elseOrg = isAssignedElsewhere ? orgs.find(o => o.id === assignedDongs[dong]) : null;
                            const elseCol = elseOrg ? colorById(elseOrg.color) : null;
                            const cnt = dongCounts[dong] || 0;

                            return (
                              <button
                                key={dong}
                                onClick={() => !isAssignedElsewhere && toggleDong(org.id, dong)}
                                disabled={isAssignedElsewhere}
                                title={isAssignedElsewhere ? `${elseOrg?.name}에 배정됨` : `${cnt}건`}
                                className={`relative p-2 rounded-lg border text-left transition-all ${
                                  isSelected
                                    ? `${col.bg} ${col.border} ${col.text}`
                                    : isAssignedElsewhere
                                    ? 'bg-white/3 border-white/5 text-gray-700 cursor-not-allowed'
                                    : 'bg-white/5 border-white/5 text-gray-400 hover:border-white/20 hover:text-gray-200'
                                }`}
                              >
                                <div className="flex items-center gap-1 mb-0.5">
                                  {isSelected
                                    ? <CheckSquare size={10} />
                                    : isAssignedElsewhere
                                    ? <span style={{ color: elseCol?.hex }} className="text-[9px] font-bold">●</span>
                                    : <Square size={10} />
                                  }
                                  <span className="text-[11px] font-bold truncate">{dong}</span>
                                </div>
                                <span className="text-[10px] opacity-60">{cnt}건</span>
                                {isAssignedElsewhere && (
                                  <span className="text-[9px] opacity-50 block truncate">{elseOrg?.name}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 미배정 요약 */}
              {allDongs.length > 0 && (() => {
                const unassigned = allDongs.filter(d => !assignedDongs[d]);
                if (!unassigned.length) return null;
                return (
                  <div className="border border-dashed border-[#333] rounded-xl p-4">
                    <p className="text-xs text-gray-600 mb-2">미배정 행정동 ({unassigned.length}개)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {unassigned.map(d => (
                        <span key={d} className="text-[11px] text-gray-600 bg-white/5 px-2 py-0.5 rounded">
                          {d} <span className="opacity-50">({dongCounts[d]||0})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
