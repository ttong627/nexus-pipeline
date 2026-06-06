// 저장 내역 뷰어 — 사이드바에서 DB에 저장된 배정(기사·배송순번·좌표)을 지자체·월별로 조회.
// "편집" → 해당 지자체·월을 루트맵으로 열어 수정(기존 루트맵 플로우 재사용).
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../config/firebase.js';
import { collection, getDocs } from 'firebase/firestore';
import { HardDrive, X, RefreshCw, Edit3 } from 'lucide-react';

export default function SavedRecordsModal({ user, onClose, onEdit }) {
  const isAdmin = user?.role === 'admin';
  const [cities, setCities] = useState([]);
  const [city, setCity] = useState('');
  const [months, setMonths] = useState([]);
  const [monthId, setMonthId] = useState('');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);

  // 지자체 목록 — 기업/일반은 승인 지자체만, 관리자는 전체
  useEffect(() => {
    (async () => {
      let cs = user?.citiesApproved || [];
      if (isAdmin) {
        try { const snap = await getDocs(collection(db, 'cloud_lists')); cs = snap.docs.map(d => d.id); } catch { /* ignore */ }
      }
      cs = [...new Set(cs)].sort((a, b) => a.localeCompare(b, 'ko'));
      setCities(cs);
      if (cs.length === 1) setCity(cs[0]);
    })();
  }, [isAdmin, user?.citiesApproved]);

  // 월 목록
  useEffect(() => {
    if (!city) { setMonths([]); setMonthId(''); return; }
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'cloud_lists', city, 'months'));
        const ms = snap.docs.map(d => d.id).sort((a, b) => b.localeCompare(a));
        setMonths(ms);
        setMonthId(ms[0] || '');
      } catch { setMonths([]); setMonthId(''); }
    })();
  }, [city]);

  const loadRecords = useCallback(async () => {
    if (!city || !monthId) return;
    setLoading(true);
    setRows(null);
    try {
      const snap = await getDocs(collection(db, 'cloud_lists', city, 'months', monthId, 'records'));
      const rs = snap.docs.map(d => {
        const fd = d.data();
        return { id: d.id, name: fd.이름 || '', dong: fd.행정동 || '', addr: fd.주소 || '', driver: (fd.기사 || '').trim(), seq: fd.배송순번 || '', hasCoord: fd.lat != null && fd.lng != null };
      });
      rs.sort((a, b) => (a.driver || 'ㅎ').localeCompare(b.driver || 'ㅎ', 'ko') || (parseInt(a.seq) || 9999) - (parseInt(b.seq) || 9999));
      setRows(rs);
    } catch (e) { alert('저장본 조회 실패: ' + e.message); }
    finally { setLoading(false); }
  }, [city, monthId]);

  useEffect(() => { if (city && monthId) loadRecords(); }, [city, monthId, loadRecords]);

  const summary = rows ? (() => {
    const byDriver = {}; let assigned = 0, noCoord = 0;
    rows.forEach(r => { if (r.driver) { byDriver[r.driver] = (byDriver[r.driver] || 0) + 1; assigned++; } if (!r.hasCoord) noCoord++; });
    return { total: rows.length, assigned, noCoord, byDriver };
  })() : null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[600] flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[88vh] bg-[#0a0a0a] border border-cyan-500/30 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <HardDrive size={16} className="text-cyan-400 shrink-0" />
            <div>
              <div className="text-sm font-black text-white">저장 내역</div>
              <div className="text-[10px] text-gray-500">DB에 저장된 배정(기사·배송순번·좌표)을 지자체·월별로 확인하고 편집합니다</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white rounded-lg transition-colors"><X size={14} /></button>
        </div>

        <div className="px-4 py-3 border-b border-[#1a1a1a] flex flex-wrap items-center gap-2">
          <select value={city} onChange={e => setCity(e.target.value)} className="bg-black/70 border border-[#2a2a2a] rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500/50 cursor-pointer">
            <option value="">지자체 선택</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={monthId} onChange={e => setMonthId(e.target.value)} disabled={!city} className="bg-black/70 border border-[#2a2a2a] rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500/50 cursor-pointer disabled:opacity-40">
            <option value="">월 선택</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {city && monthId && (
            <button onClick={() => { onEdit?.(city, monthId); onClose(); }} className="ml-auto px-3 py-1.5 bg-cyan-950/50 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/50 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors">
              <Edit3 size={12} /> 이 저장본 편집(루트맵)
            </button>
          )}
        </div>

        {summary && (
          <div className="px-4 py-2 border-b border-[#1a1a1a] flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-gray-400">전체 <b className="text-white">{summary.total.toLocaleString()}</b></span>
            <span className="text-gray-400">배정 <b className="text-emerald-400">{summary.assigned.toLocaleString()}</b></span>
            <span className="text-gray-400">미배정 <b className="text-amber-400">{(summary.total - summary.assigned).toLocaleString()}</b></span>
            <span className="text-gray-400">좌표없음 <b className={summary.noCoord > 0 ? 'text-red-400' : 'text-emerald-400'}>{summary.noCoord.toLocaleString()}</b></span>
            <span className="mx-1 text-gray-700">|</span>
            {Object.entries(summary.byDriver).sort((a, b) => b[1] - a[1]).map(([dn, c]) => (
              <span key={dn} className="px-1.5 py-0.5 rounded bg-[#111] border border-[#222] text-gray-300">{dn} <b className="text-cyan-400">{c}</b></span>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center p-10 text-gray-500 text-sm"><RefreshCw size={16} className="animate-spin mr-2" /> 불러오는 중...</div>
          ) : !rows ? (
            <div className="flex items-center justify-center p-10 text-gray-600 text-sm">지자체와 월을 선택하세요.</div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center p-10 text-gray-600 text-sm">저장된 레코드가 없습니다.</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[#0d0d0d] text-gray-500 z-10">
                <tr className="border-b border-[#1a1a1a]">
                  <th className="text-left px-3 py-1.5 font-bold">기사</th>
                  <th className="text-left px-2 py-1.5 font-bold w-10">순번</th>
                  <th className="text-left px-2 py-1.5 font-bold">이름</th>
                  <th className="text-left px-3 py-1.5 font-bold">주소</th>
                  <th className="text-center px-2 py-1.5 font-bold w-12">좌표</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id || i} className="border-b border-[#141414] hover:bg-[#101010]">
                    <td className="px-3 py-1 font-bold text-cyan-300">{r.driver || <span className="text-gray-600">미배정</span>}</td>
                    <td className="px-2 py-1 text-gray-400">{r.seq || '-'}</td>
                    <td className="px-2 py-1 text-gray-200 whitespace-nowrap">{r.name}</td>
                    <td className="px-3 py-1 text-gray-400 truncate max-w-[280px]" title={r.addr}>{r.addr}</td>
                    <td className="px-2 py-1 text-center">{r.hasCoord ? <span className="text-emerald-500">●</span> : <span className="text-red-500">○</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
