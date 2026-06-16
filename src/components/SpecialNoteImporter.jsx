import { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../config/firebase.js';
import { collection, getDocs, getDocsFromServer, writeBatch, doc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import {
  X, Upload, FileSpreadsheet, CheckCircle, AlertTriangle,
  Users, Loader2, Database, FileWarning, ArrowRight,
} from 'lucide-react';

// ── 유틸 ──────────────────────────────────────────────
const norm = (s) => String(s || '').replace(/\s/g, '').trim();
const digits = (s) => String(s || '').replace(/[^\d]/g, '');
const fmtNP = (n, p) => `${(n || 0).toLocaleString()}명 · ${(p || 0).toLocaleString()}포`;

// 시트(=읍면동)별 성명·비고·주소·전화·포수 추출
function parseSpecialNoteWorkbook(wb) {
  const out = [];
  (wb.SheetNames || []).forEach((sn) => {
    if (/^Sheet\d|xxxx|XL4|Poppy|^_/i.test(sn)) return;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    if (!rows.length) return;
    let nameCol = -1, bigoCol = -1, dongCol = -1, addrCol = -1, phoneCol = -1, qtyCol = -1, headerRow = -1;
    const scan = Math.min(rows.length, 8);
    for (let i = 0; i < scan; i++) {
      let foundName = false;
      (rows[i] || []).forEach((c, ci) => {
        const v = norm(c);
        if (nameCol < 0 && /성명|이름/.test(v)) { nameCol = ci; foundName = true; }
        if (bigoCol < 0 && /비고|특이사항|메모/.test(v)) bigoCol = ci;
        if (dongCol < 0 && /읍면동|행정동|동명/.test(v)) dongCol = ci;
        if (addrCol < 0 && /주소/.test(v)) addrCol = ci;
        if (phoneCol < 0 && /전화|연락|휴대|핸드/.test(v)) phoneCol = ci;
        if (qtyCol < 0 && /양곡수량|수량|포수/.test(v)) qtyCol = ci;
      });
      if (foundName) headerRow = i;
    }
    if (nameCol < 0) return;
    rows.slice(headerRow + 1).forEach((r) => {
      const name = String(r[nameCol] || '').trim();
      if (!name || /^(성명|이름|합계|소계|계|총계|가정)$/.test(norm(name))) return;
      const bigo = bigoCol >= 0 ? String(r[bigoCol] || '').trim() : '';
      const dong = (dongCol >= 0 ? String(r[dongCol] || '').trim() : '') || sn.trim();
      const addr = addrCol >= 0 ? String(r[addrCol] || '').trim() : '';
      const phone = phoneCol >= 0 ? String(r[phoneCol] || '').trim() : '';
      const qty = qtyCol >= 0 ? (parseInt(digits(r[qtyCol]), 10) || 0) : 0;
      out.push({ dong, name, addr, phone, bigo, qty, sheet: sn });
    });
  });
  return out;
}

// 기존 특이사항 + 비고 병합(중복 방지)
function mergeNote(existing, bigo) {
  const e = String(existing || '').trim();
  const b = String(bigo || '').trim();
  if (!b) return e;
  if (!e) return b;
  if (e.replace(/\s/g, '').includes(b.replace(/\s/g, ''))) return e;
  return `${e} ${b}`;
}

// 파일명 → base_lists 지자체 추정(연속 2글자 매칭 점수)
function guessCity(fileBase, cities) {
  const fb = norm(fileBase);
  let best = '', bestScore = 0;
  cities.forEach((c) => {
    const nc = norm(c);
    let score = 0;
    for (let i = 0; i < fb.length - 1; i++) if (nc.includes(fb.substr(i, 2))) score++;
    if (score > bestScore) { bestScore = score; best = c; }
  });
  return bestScore > 0 ? best : '';
}

export default function SpecialNoteImporter({ onClose }) {
  const [cities, setCities] = useState([]);          // base_lists 지자체 id 목록
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState([]);          // [{dong,name,addr,phone,bigo,qty,sheet}]
  const [targetCity, setTargetCity] = useState('');
  const [baseLoading, setBaseLoading] = useState(false);
  const [baseRecs, setBaseRecs] = useState(null);    // 선택 지자체 base 레코드
  const [result, setResult] = useState(null);        // {uniques, dups, nomatch, noBigo}
  const [dupPick, setDupPick] = useState({});        // idx → base.id | 'skip'
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(null);            // {applied, qty}
  const fileRef = useRef(null);

  // 지자체 목록 로드
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'base_lists'));
        setCities(snap.docs.map((d) => d.id).sort((a, b) => a.localeCompare(b, 'ko')));
      } catch (e) {
        console.error('지자체 목록 로드 실패:', e);
        setCities([]);
      } finally {
        setCitiesLoading(false);
      }
    })();
  }, []);

  // 파일 업로드 → 파싱
  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setParsing(true);
    setParsed([]); setResult(null); setBaseRecs(null); setDone(null); setDupPick({});
    setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const recs = parseSpecialNoteWorkbook(wb);
      setParsed(recs);
      const base = f.name.replace(/\.(xls|xlsx|csv)$/i, '').replace(/특이사항/g, '').trim();
      const guess = guessCity(base, cities);
      setTargetCity(guess || cities[0] || '');
    } catch (err) {
      console.error('파일 파싱 실패:', err);
      alert('파일을 읽지 못했습니다. xls/xlsx 파일인지 확인하세요.');
      setFileName('');
    } finally {
      setParsing(false);
    }
  };

  // 업로드 요약(명·포)
  const uploadSummary = useMemo(() => {
    const withBigo = parsed.filter((r) => r.bigo);
    const qty = parsed.reduce((s, r) => s + (r.qty || 0), 0);
    return { total: parsed.length, withBigo: withBigo.length, qty };
  }, [parsed]);

  // 매칭 분석
  const analyze = async () => {
    if (!targetCity) { alert('이식할 지자체를 선택하세요.'); return; }
    setBaseLoading(true); setResult(null); setDupPick({}); setDone(null);
    try {
      const snap = await getDocsFromServer(collection(db, `base_lists/${targetCity}/records`));
      const recs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setBaseRecs(recs);
      const index = new Map();
      recs.forEach((r) => {
        const k = norm(r.dong) + '|' + norm(r.name);
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(r);
      });
      const uniques = [], dups = [], nomatch = [];
      let noBigo = 0;
      parsed.forEach((rec, idx) => {
        if (!rec.bigo) { noBigo++; return; }
        const k = norm(rec.dong) + '|' + norm(rec.name);
        const m = index.get(k) || [];
        if (m.length === 1) uniques.push({ rec, base: m[0] });
        else if (m.length > 1) dups.push({ rec, candidates: m, idx });
        else nomatch.push({ rec });
      });
      // 동명이인 자동 추천(전화 끝 7자리 일치)
      const pick = {};
      dups.forEach(({ rec, candidates, idx }) => {
        const fp = digits(rec.phone);
        if (fp && fp.length >= 7) {
          const tail = fp.slice(-7);
          const hit = candidates.find((c) => digits(c.mobile).endsWith(tail) || digits(c.landline).endsWith(tail));
          if (hit) pick[idx] = hit.id;
        }
      });
      setDupPick(pick);
      setResult({ uniques, dups, nomatch, noBigo });
    } catch (err) {
      console.error('매칭 분석 실패:', err);
      alert('기본명단을 불러오지 못했습니다: ' + (err.message || err));
    } finally {
      setBaseLoading(false);
    }
  };

  // 이식 대상 집계(단일 + 해결된 동명이인) — docId별 비고 병합
  const buildTargets = () => {
    const map = new Map(); // baseId → {base, bigos:Set, qty}
    const add = (base, rec) => {
      if (!map.has(base.id)) map.set(base.id, { base, bigos: [], qty: 0 });
      const t = map.get(base.id);
      if (rec.bigo && !t.bigos.includes(rec.bigo)) t.bigos.push(rec.bigo);
      t.qty += rec.qty || 0;
    };
    result.uniques.forEach(({ rec, base }) => add(base, rec));
    result.dups.forEach(({ rec, candidates, idx }) => {
      const picked = dupPick[idx];
      if (!picked || picked === 'skip') return;
      const base = candidates.find((c) => c.id === picked);
      if (base) add(base, rec);
    });
    return [...map.values()].map(({ base, bigos, qty }) => ({
      id: base.id,
      newNote: bigos.reduce((acc, b) => mergeNote(acc, b), base.note || ''),
      changed: bigos.length > 0,
      qty,
    })).filter((t) => t.changed && t.newNote !== (baseRecs.find((r) => r.id === t.id)?.note || ''));
  };

  const targetCount = useMemo(() => {
    if (!result) return { n: 0, qty: 0 };
    const t = buildTargets();
    return { n: t.length, qty: t.reduce((s, x) => s + (x.qty || 0), 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, dupPick]);

  // 이식 실행 (499건씩 배치)
  const applyImport = async () => {
    const targets = buildTargets();
    if (!targets.length) { alert('이식할 대상이 없습니다.'); return; }
    const dupUnresolved = result.dups.filter(({ idx }) => !dupPick[idx]).length;
    const msg = `${targetCity}\n특이사항 이식: ${targets.length.toLocaleString()}명 · ${targets.reduce((s, x) => s + (x.qty || 0), 0).toLocaleString()}포`
      + (dupUnresolved ? `\n\n⚠ 미해결 동명이인 ${dupUnresolved}건은 이식되지 않습니다.` : '')
      + `\n\n진행할까요?`;
    if (!window.confirm(msg)) return;
    setApplying(true); setProgress(0);
    try {
      let appliedQty = 0;
      for (let i = 0; i < targets.length; i += 499) {
        const slice = targets.slice(i, i + 499);
        const batch = writeBatch(db);
        slice.forEach((t) => {
          batch.update(doc(db, `base_lists/${targetCity}/records/${t.id}`), { note: t.newNote });
          appliedQty += t.qty || 0;
        });
        await batch.commit();
        setProgress(Math.min(i + slice.length, targets.length));
      }
      setDone({ applied: targets.length, qty: appliedQty });
    } catch (err) {
      console.error('이식 실패:', err);
      alert('이식 중 오류: ' + (err.message || err));
    } finally {
      setApplying(false);
    }
  };

  const totalDupUnresolved = result ? result.dups.filter(({ idx }) => !dupPick[idx]).length : 0;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0a0d12] border border-[#1e2d3d] rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-[#131d2e] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-950/40 border border-emerald-700/40 flex items-center justify-center">
              <FileSpreadsheet size={18} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-white font-black text-base">특이사항 이식</h2>
              <p className="text-gray-500 text-[11px]">파일의 비고를 행정동+이름으로 매칭해 기본명단 특이사항에 이식</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white rounded-lg hover:bg-white/5"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* 1. 파일 업로드 */}
          <div>
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1.5">1. 특이사항 파일</div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={citiesLoading || parsing}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-emerald-700/50 bg-emerald-950/20 text-emerald-300 font-bold text-sm hover:bg-emerald-950/40 disabled:opacity-50"
            >
              {parsing ? <><Loader2 size={15} className="animate-spin" /> 파싱 중…</>
                : citiesLoading ? <><Loader2 size={15} className="animate-spin" /> 지자체 로드 중…</>
                  : <><Upload size={15} /> {fileName || '파일 선택 (xls / xlsx)'}</>}
            </button>
            <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={handleFile} />
            {parsed.length > 0 && (
              <div className="mt-2 rounded-xl bg-[#0d1420] border border-[#1e2d3d] px-3 py-2 text-[12px]">
                <span className="text-emerald-400 font-black">{fmtNP(uploadSummary.total, uploadSummary.qty)}</span>
                <span className="text-gray-500"> 읽음 · 비고 있는 행 </span>
                <span className="text-white font-bold">{uploadSummary.withBigo.toLocaleString()}명</span>
              </div>
            )}
          </div>

          {/* 2. 지자체 선택 */}
          {parsed.length > 0 && (
            <div>
              <div className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1.5">2. 이식할 지자체 (기본명단)</div>
              <div className="flex gap-2">
                <select
                  value={targetCity}
                  onChange={(e) => { setTargetCity(e.target.value); setResult(null); setBaseRecs(null); }}
                  className="flex-1 bg-[#0d1420] border border-[#1e2d3d] rounded-xl px-3 py-2.5 text-white text-sm font-bold focus:border-emerald-600 outline-none"
                >
                  {cities.length === 0 && <option value="">기본명단 지자체 없음</option>}
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button
                  onClick={analyze}
                  disabled={!targetCity || baseLoading}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                >
                  {baseLoading ? <Loader2 size={15} className="animate-spin" /> : <Database size={15} />} 매칭 분석
                </button>
              </div>
              <p className="text-gray-600 text-[10px] mt-1">파일명 「{fileName}」 기준 자동 추정 · 다르면 직접 선택</p>
            </div>
          )}

          {/* 3. 매칭 결과 */}
          {result && (
            <div className="space-y-3">
              <div className="text-[10px] font-black text-gray-500 uppercase tracking-wider">3. 매칭 결과 (행정동 + 이름)</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-emerald-950/30 border border-emerald-700/40 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-emerald-400 text-[10px] font-black mb-0.5"><CheckCircle size={11} /> 이식 대상</div>
                  <div className="text-white font-black text-[13px]">{fmtNP(targetCount.n, targetCount.qty)}</div>
                </div>
                <div className="rounded-xl bg-amber-950/30 border border-amber-700/40 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-amber-400 text-[10px] font-black mb-0.5"><Users size={11} /> 동명이인</div>
                  <div className="text-white font-black text-[13px]">{result.dups.length.toLocaleString()}건{totalDupUnresolved ? ` · 미해결 ${totalDupUnresolved}` : ''}</div>
                </div>
                <div className="rounded-xl bg-gray-800/40 border border-gray-700/40 px-3 py-2.5">
                  <div className="flex items-center gap-1 text-gray-400 text-[10px] font-black mb-0.5"><FileWarning size={11} /> 미매칭</div>
                  <div className="text-white font-black text-[13px]">{result.nomatch.length.toLocaleString()}명</div>
                </div>
              </div>
              {result.noBigo > 0 && (
                <p className="text-gray-600 text-[11px]">비고 없는 행 {result.noBigo.toLocaleString()}건은 이식 대상에서 제외됩니다.</p>
              )}

              {/* 동명이인 해결 */}
              {result.dups.length > 0 && (
                <div className="rounded-xl bg-amber-950/15 border border-amber-800/30 p-3">
                  <div className="flex items-center gap-1.5 text-amber-300 text-[12px] font-black mb-2">
                    <AlertTriangle size={13} /> 동명이인 확인 — 어느 분께 이식할지 선택
                  </div>
                  <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                    {result.dups.map(({ rec, candidates, idx }) => (
                      <div key={idx} className="rounded-lg bg-[#0d1420] border border-[#1e2d3d] p-2.5">
                        <div className="text-[12px] mb-1.5">
                          <span className="text-white font-black">{rec.name}</span>
                          <span className="text-gray-500"> · {rec.dong}</span>
                          {rec.phone && <span className="text-sky-400"> · {rec.phone}</span>}
                          <span className="text-emerald-400 font-bold"> · 비고: {rec.bigo}</span>
                          {rec.addr && <div className="text-gray-500 text-[10px] mt-0.5">{rec.addr}</div>}
                        </div>
                        <div className="space-y-1">
                          {candidates.map((c) => (
                            <label key={c.id} className={`flex items-start gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[11px] border ${dupPick[idx] === c.id ? 'bg-emerald-950/40 border-emerald-700/50' : 'bg-white/[0.02] border-transparent hover:bg-white/5'}`}>
                              <input type="radio" name={`dup-${idx}`} checked={dupPick[idx] === c.id} onChange={() => setDupPick((p) => ({ ...p, [idx]: c.id }))} className="mt-0.5 accent-emerald-500" />
                              <span className="flex-1">
                                <span className="text-white font-bold">{c.name}</span>
                                <span className="text-gray-500"> · {c.dong || '동 없음'}</span>
                                {(c.mobile || c.landline) && <span className="text-sky-400"> · {c.mobile || c.landline}</span>}
                                {c.address && <span className="text-gray-500 block text-[10px]">{c.address}</span>}
                                {(c.note || '').trim() && <span className="text-amber-400/80 block text-[10px]">기존: {c.note}</span>}
                              </span>
                            </label>
                          ))}
                          <label className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[11px] border ${dupPick[idx] === 'skip' ? 'bg-gray-700/40 border-gray-600/50' : 'bg-white/[0.02] border-transparent hover:bg-white/5'}`}>
                            <input type="radio" name={`dup-${idx}`} checked={dupPick[idx] === 'skip'} onChange={() => setDupPick((p) => ({ ...p, [idx]: 'skip' }))} className="accent-gray-400" />
                            <span className="text-gray-400">건너뛰기 (이식 안 함)</span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 미매칭 미리보기 */}
              {result.nomatch.length > 0 && (
                <details className="rounded-xl bg-gray-900/30 border border-gray-700/30 p-2.5">
                  <summary className="text-gray-400 text-[11px] font-bold cursor-pointer">미매칭 {result.nomatch.length}명 보기 (기본명단에 행정동+이름이 없음)</summary>
                  <div className="mt-2 max-h-40 overflow-y-auto text-[11px] space-y-0.5">
                    {result.nomatch.slice(0, 200).map((m, i) => (
                      <div key={i} className="text-gray-500"><span className="text-white">{m.rec.name}</span> · {m.rec.dong} · 비고: {m.rec.bigo}</div>
                    ))}
                    {result.nomatch.length > 200 && <div className="text-gray-600">… 외 {result.nomatch.length - 200}명</div>}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* 완료 */}
          {done && (
            <div className="rounded-xl bg-emerald-950/40 border border-emerald-700/50 p-4 text-center">
              <CheckCircle size={28} className="text-emerald-400 mx-auto mb-2" />
              <div className="text-white font-black text-sm">이식 완료</div>
              <div className="text-emerald-300 font-black text-lg mt-1">{fmtNP(done.applied, done.qty)}</div>
              <div className="text-gray-500 text-[11px] mt-1">{targetCity} 기본명단 특이사항에 반영됨</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#131d2e] flex items-center justify-between shrink-0">
          <div className="text-[11px] text-gray-500">
            {applying ? `이식 중… ${progress.toLocaleString()} / ${targetCount.n.toLocaleString()}`
              : result ? <>이식 대상 <span className="text-emerald-400 font-black">{fmtNP(targetCount.n, targetCount.qty)}</span></>
                : '파일을 올리고 지자체를 확인하세요'}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-bold text-sm">닫기</button>
            {result && !done && (
              <button
                onClick={applyImport}
                disabled={applying || targetCount.n === 0}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                {applying ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} 이식 실행
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
