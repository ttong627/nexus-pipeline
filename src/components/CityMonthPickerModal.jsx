import { useState, useEffect } from 'react';
import { MapPin, Calendar, CheckCircle, AlertCircle, ChevronRight, Clock, Database, RefreshCw } from 'lucide-react';
import { db } from '../config/firebase.js';
import { doc, getDoc } from 'firebase/firestore';

// ── 저장 구조: nexus_city_prefs_v2[userId][city] = { month, lastUsed }
const PREF_KEY = 'nexus_city_prefs_v2';

const loadAllPrefs = () => {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
};

const loadCityPref = (userId, city) => {
  if (!userId || !city) return null;
  return loadAllPrefs()?.[userId]?.[city] ?? null;
};

const saveCityPref = (userId, city, month) => {
  if (!userId || !city) return;
  try {
    const all = loadAllPrefs();
    if (!all[userId]) all[userId] = {};
    all[userId][city] = { month, lastUsed: Date.now() };
    localStorage.setItem(PREF_KEY, JSON.stringify(all));
  } catch {}
};

const toYYYYMM = (raw) => {
  if (!raw) return '';
  if (/^\d{4}-\d{2}$/.test(String(raw))) return String(raw);
  const m = String(raw).match(/(\d{4})[.-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  const m2 = String(raw).match(/(\d{1,2})월/);
  if (m2) return `${new Date().getFullYear()}-${m2[1].padStart(2, '0')}`;
  return '';
};

const formatMonthLabel = (yyyyMM) => {
  if (!yyyyMM) return '';
  const [y, m] = yyyyMM.split('-');
  return `${y}년 ${parseInt(m)}월`;
};

export default function CityMonthPickerModal({
  userId,
  detectedCity,
  detectedMonth,
  userCities = [],
  isAdmin,
  uploadGubuns = [],
  uploadCounts = null,
  onConfirm,
  onCancel,
}) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // 초기 지자체: 자동감지 > 없으면 목록 첫번째
  const initCity = detectedCity || (userCities[0] ?? '');

  // 초기 월: ① 파일 감지 ② 해당 지자체 저장 이력 ③ 현재 월
  const savedForInit = loadCityPref(userId, initCity);
  const initMonth =
    toYYYYMM(detectedMonth) ||
    (savedForInit?.month ?? '') ||
    currentMonth;

  const [city, setCity] = useState(initCity);
  const [month, setMonth] = useState(initMonth);
  const [savedPref, setSavedPref] = useState(savedForInit);
  const [existing, setExisting] = useState(null); // 선택 지자체·월의 기존 저장현황 { 수급자Count, 차상위Count, 수급자Qty, 차상위Qty, totalCount } | 'loading' | null

  // 선택한 지자체·월에 이미 저장된 명단(구분별 명·포)을 조회 — 차상위/수급자 추가 업로드 유도용
  useEffect(() => {
    if (!city || city.trim().length < 2 || !/^\d{4}-\d{2}$/.test(month)) { setExisting(null); return; }
    let cancelled = false;
    setExisting('loading');
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'cloud_lists', city.trim(), 'months', month));
        if (cancelled) return;
        if (snap.exists()) {
          const d = snap.data();
          setExisting({
            수급자Count: d.수급자Count || 0, 차상위Count: d.차상위Count || 0,
            수급자Qty: d.수급자Qty || 0, 차상위Qty: d.차상위Qty || 0,
            totalCount: d.totalCount || 0,
          });
        } else setExisting(null);
      } catch { if (!cancelled) setExisting(null); }
    })();
    return () => { cancelled = true; };
  }, [city, month]);

  // 지자체 변경 시 해당 지자체의 저장된 월로 자동 교체
  useEffect(() => {
    const pref = loadCityPref(userId, city);
    setSavedPref(pref);
    if (city !== detectedCity || !toYYYYMM(detectedMonth)) {
      // 파일 감지 월이 없거나 다른 지자체면 저장 이력 적용
      const fallback = toYYYYMM(detectedMonth) || pref?.month || currentMonth;
      setMonth(fallback);
    }
  }, [city]); // eslint-disable-line react-hooks/exhaustive-deps

  const autoDetected = !!detectedCity;
  const cityIsValid = city.trim().length >= 2;
  const detectedMonthYM = toYYYYMM(detectedMonth);
  const lastUsedLabel = savedPref?.lastUsed
    ? new Date(savedPref.lastUsed).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
    : null;

  const handleConfirm = () => {
    if (!cityIsValid || !month) return;
    saveCityPref(userId, city.trim(), month);
    onConfirm(city.trim(), month);
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleConfirm(); };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4" onKeyDown={handleKeyDown}>
      <div className="bg-[#0a0d12] border border-[#1e2d3d] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#131d2e]">
          <h2 className="text-white font-black text-base">지자체 · 적용 월 확인</h2>
          <p className="text-gray-500 text-[11px] mt-0.5">
            지자체별 설정이 저장되어 다음 업로드 시 자동 적용됩니다
          </p>
        </div>

        {/* 이번 업로드 구분·인원 — 수급자/차상위 어떤 걸 올리는지 항상 명확히 확인 */}
        <div className="px-6 pt-4">
          <div className="rounded-xl bg-emerald-950/30 border border-emerald-700/40 px-3 py-2.5">
            <div className="text-[10px] font-black text-emerald-500 uppercase tracking-wider mb-1">이번 업로드</div>
            {(uploadCounts && (uploadCounts.기초수급자 > 0 || uploadCounts.차상위 > 0)) ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] font-black">
                {uploadCounts.기초수급자 > 0 && <span className="text-purple-300">수급자 {uploadCounts.기초수급자.toLocaleString()}명</span>}
                {uploadCounts.차상위 > 0 && <span className="text-sky-300">차상위 {uploadCounts.차상위.toLocaleString()}명</span>}
                {uploadCounts.기초수급자 > 0 && uploadCounts.차상위 > 0 && <span className="text-gray-500 text-[11px] font-bold">(혼합)</span>}
              </div>
            ) : uploadGubuns.length > 0 ? (
              <div className="text-[13px] font-black text-emerald-300">{uploadGubuns.map(g => g === '기초수급자' ? '수급자' : g === '차상위' ? '차상위' : g).join(' · ')}</div>
            ) : (
              <div className="flex items-center gap-1 text-[12px] text-amber-400 font-bold"><AlertCircle size={11} /> 구분(수급자/차상위) 자동감지 실패 — 파일의 구분 칼럼을 확인하세요</div>
            )}
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* 지자체 */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin size={11} className="text-emerald-500" />지자체
            </label>

            {isAdmin ? (
              <>
                <input
                  type="text"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  list="city-datalist-picker"
                  placeholder="지자체명 입력 또는 선택"
                  className="w-full bg-[#060a0e] border border-[#1e2d3d] focus:border-emerald-500/60 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none transition-colors"
                  autoFocus
                />
                <datalist id="city-datalist-picker">
                  {userCities.map(c => <option key={c} value={c} />)}
                </datalist>
              </>
            ) : (
              <div className="relative">
                <select
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  className="w-full bg-[#060a0e] border border-[#1e2d3d] focus:border-emerald-500/60 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none appearance-none transition-colors pr-8"
                >
                  {!initCity && <option value="">-- 지자체 선택 --</option>}
                  {userCities.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 text-xs">▾</div>
              </div>
            )}

            {/* 상태 배지 */}
            {autoDetected && city === detectedCity && (
              <p className="flex items-center gap-1 text-[11px] text-emerald-400">
                <CheckCircle size={10} />파일에서 자동 감지됨
              </p>
            )}
            {autoDetected && city !== detectedCity && (
              <p className="flex items-center gap-1 text-[11px] text-amber-400">
                <AlertCircle size={10} />파일 감지값: {detectedCity}
              </p>
            )}
            {!autoDetected && (
              <p className="flex items-center gap-1 text-[11px] text-amber-500">
                <AlertCircle size={10} />자동 감지 불가 — 직접 선택해주세요
              </p>
            )}
            {savedPref && lastUsedLabel && (
              <p className="flex items-center gap-1 text-[11px] text-gray-500">
                <Clock size={10} />최근 작업: {lastUsedLabel}
              </p>
            )}
          </div>

          {/* 적용 월 */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar size={11} className="text-sky-500" />적용 월
            </label>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="w-full bg-[#060a0e] border border-[#1e2d3d] focus:border-sky-500/60 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none transition-colors [color-scheme:dark]"
            />
            {detectedMonthYM && detectedMonthYM === month ? (
              <p className="flex items-center gap-1 text-[11px] text-emerald-400">
                <CheckCircle size={10} />파일에서 자동 감지됨
              </p>
            ) : savedPref?.month === month && month !== currentMonth ? (
              <p className="flex items-center gap-1 text-[11px] text-sky-400">
                <CheckCircle size={10} />{city} 저장 이력 자동 적용 ({formatMonthLabel(month)})
              </p>
            ) : null}
          </div>

          {/* 기존 저장현황 + 교체/추가 안내 (수급자·차상위 명·포) */}
          {existing === 'loading' ? (
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500"><RefreshCw size={11} className="animate-spin" /> 기존 저장현황 확인 중...</div>
          ) : existing ? (
            <div className="rounded-xl border border-[#1e2d3d] bg-[#060a0e] p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-black text-gray-300"><Database size={11} className="text-cyan-400" /> 이 지자체 {formatMonthLabel(month)} 기존 저장</div>
              <div className="text-[11px] text-gray-400 flex flex-col gap-0.5">
                <span>수급자 <b className={existing.수급자Count ? 'text-emerald-400' : 'text-gray-600'}>{existing.수급자Count.toLocaleString()}명 · {existing.수급자Qty.toLocaleString()}포</b></span>
                <span>차상위 <b className={existing.차상위Count ? 'text-emerald-400' : 'text-gray-600'}>{existing.차상위Count.toLocaleString()}명 · {existing.차상위Qty.toLocaleString()}포</b></span>
              </div>
              {uploadGubuns.length > 0 && (() => {
                const has = g => (g === '기초수급자' ? existing.수급자Count : existing.차상위Count) > 0;
                const label = g => g === '기초수급자' ? '수급자' : '차상위';
                const replace = uploadGubuns.filter(has).map(label);
                const add = uploadGubuns.filter(g => !has(g)).map(label);
                const otherMissing = ['기초수급자', '차상위'].filter(g => !uploadGubuns.includes(g) && !has(g)).map(label);
                return (
                  <div className="text-[11px] space-y-0.5 pt-1.5 border-t border-[#131d2e]">
                    {replace.length > 0 && <p className="text-amber-400">⚠ {replace.join('·')}는 이미 있어 <b>새로 교체</b>됩니다.</p>}
                    {add.length > 0 && <p className="text-emerald-400">＋ {add.join('·')}를 <b>추가</b> 저장(기존 구분 유지)합니다.</p>}
                    {otherMissing.length > 0 && <p className="text-sky-400">💡 {otherMissing.join('·')}도 올리면 한 명단에 함께 저장됩니다.</p>}
                  </div>
                );
              })()}
            </div>
          ) : (city.trim().length >= 2 && /^\d{4}-\d{2}$/.test(month)) ? (
            <p className="flex items-center gap-1 text-[11px] text-gray-600"><Database size={10} /> 이 지자체·월에 저장된 명단이 아직 없습니다 (신규 저장).</p>
          ) : null}
        </div>

        {/* 버튼 */}
        <div className="px-6 pb-6 flex gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border border-[#1e2d3d] text-gray-400 text-sm font-bold hover:bg-white/5 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={!cityIsValid || !month}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-black flex items-center justify-center gap-1.5 transition-colors"
          >
            확인 · 다음 단계 <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
