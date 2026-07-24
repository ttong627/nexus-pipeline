import { useMemo } from 'react';
import { X, CheckCircle2, MapPin, AlertTriangle, Crosshair, Target } from 'lucide-react';

// ── 배송 정확도 분석화면 ────────────────────────────────────────────────────
// 기사앱 "배송완료"가 캡처한 GPS(lat/lng)와 배송지 동별좌표(dongLat/dongLng)의
// 오차(errM)를 집계·나열해 "실제로 그 동에 배송했는지"를 검증한다.
// completion 문서 자체 데이터만으로 완결 — 원본 record 매칭 불필요.
//
// props.completions: [{ key, name, at, lat, lng, dongLat, dongLng, errM,
//                       accuracy, driverId, driverName, shareId }]
export default function DeliveryAccuracyView({ completions = [], onClose, onFocus }) {
  const { rows, stats } = useMemo(() => {
    const withLoc = completions.filter(c => Number.isFinite(c.errM));
    const noLoc = completions.filter(c => !Number.isFinite(c.errM));
    const sorted = [...withLoc].sort((a, b) => b.errM - a.errM);
    const errs = withLoc.map(c => c.errM);
    const sum = errs.reduce((s, e) => s + e, 0);
    const avg = errs.length ? Math.round(sum / errs.length) : null;
    const max = errs.length ? Math.max(...errs) : null;
    const over100 = withLoc.filter(c => c.errM > 100).length;
    const over50 = withLoc.filter(c => c.errM > 50 && c.errM <= 100).length;
    return {
      rows: [...sorted, ...noLoc], // 위치기록 없는 건은 맨 아래
      stats: {
        total: completions.length,
        located: withLoc.length,
        noLoc: noLoc.length,
        avg, max, over100, over50,
      },
    };
  }, [completions]);

  const errColor = (errM) => {
    if (!Number.isFinite(errM)) return { text: 'text-gray-500', bg: 'bg-[#141414]', border: 'border-[#242424]' };
    if (errM > 100) return { text: 'text-red-400', bg: 'bg-red-950/25', border: 'border-red-500/30' };
    if (errM > 50) return { text: 'text-amber-400', bg: 'bg-amber-950/20', border: 'border-amber-500/25' };
    return { text: 'text-emerald-400', bg: 'bg-emerald-950/20', border: 'border-emerald-500/25' };
  };

  const fmtTime = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[660] flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}>
      <div className="bg-[#080808] border border-[#222] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <Target size={16} className="text-emerald-400" />
            </div>
            <div>
              <div className="text-white font-black text-sm">배송 정확도 분석</div>
              <div className="text-gray-600 text-[10px]">완료 GPS ↔ 동별좌표 오차 검증</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-[#1a1a1a]">
            <X size={16} />
          </button>
        </div>

        {/* 통계 요약 */}
        <div className="shrink-0 grid grid-cols-4 gap-2 px-5 py-4 border-b border-[#141414]">
          <Stat label="완료" value={stats.total} unit="건" tone="white" />
          <Stat label="평균오차" value={stats.avg != null ? stats.avg : '—'} unit={stats.avg != null ? 'm' : ''} tone="emerald" />
          <Stat label="최대오차" value={stats.max != null ? stats.max : '—'} unit={stats.max != null ? 'm' : ''} tone={stats.max > 100 ? 'red' : 'amber'} />
          <Stat label="이상(>100m)" value={stats.over100} unit="건" tone={stats.over100 > 0 ? 'red' : 'gray'} />
        </div>

        {/* 위치기록 없음 안내 */}
        {stats.noLoc > 0 && (
          <div className="shrink-0 mx-5 mt-3 px-3 py-2 bg-orange-950/25 border border-orange-600/25 rounded-xl text-orange-400 text-[11px] flex items-center gap-2">
            <AlertTriangle size={13} className="shrink-0" />
            {stats.noLoc}건은 GPS 없이 완료 처리돼 오차를 계산할 수 없습니다(위치 미허용/미측정).
          </div>
        )}

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-700 gap-2">
              <CheckCircle2 size={28} className="opacity-40" />
              <div className="text-sm">완료 기록이 없습니다</div>
              <div className="text-[11px] text-gray-800">기사앱에서 배송완료를 누르면 여기에 집계됩니다</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {rows.map((c, i) => {
                const col = errColor(c.errM);
                const canFocus = onFocus && Number.isFinite(c.lat) && Number.isFinite(c.lng);
                return (
                  <div key={c.key || i}
                    onClick={canFocus ? () => onFocus(c) : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${col.bg} ${col.border} ${canFocus ? 'cursor-pointer active:scale-[0.99]' : ''} transition-all`}>
                    <div className={`w-10 shrink-0 text-right font-black text-sm ${col.text}`}>
                      {Number.isFinite(c.errM) ? `${c.errM}` : '—'}
                      {Number.isFinite(c.errM) && <span className="text-[9px] text-gray-600 ml-0.5">m</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-100 font-bold text-xs truncate">{c.name || '(이름 없음)'}</span>
                        {c.driverName && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-[#1a1a1a] text-gray-400 rounded-full border border-[#2a2a2a] shrink-0">
                            {c.driverName}
                          </span>
                        )}
                        {c.errM > 100 && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded-full border border-red-500/30 shrink-0">
                            이상
                          </span>
                        )}
                      </div>
                      <div className="text-gray-600 text-[10px] mt-0.5 flex items-center gap-2">
                        <span>{fmtTime(c.at)}</span>
                        {Number.isFinite(c.accuracy) && (
                          <span className="flex items-center gap-0.5"><Crosshair size={8} />±{c.accuracy}m</span>
                        )}
                        {!Number.isFinite(c.errM) && <span className="text-orange-600">위치 기록 없음</span>}
                      </div>
                    </div>
                    {canFocus && <MapPin size={13} className="text-gray-600 shrink-0" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="shrink-0 px-5 py-3 border-t border-[#141414] text-[10px] text-gray-700 flex items-center justify-between">
          <span>오차 = 완료 시점 기사 GPS와 배송지 동별좌표의 직선거리</span>
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />양호</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />주의</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />이상</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, tone }) {
  const toneMap = {
    white: 'text-white', emerald: 'text-emerald-400', red: 'text-red-400',
    amber: 'text-amber-400', gray: 'text-gray-500',
  };
  return (
    <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl px-2 py-2.5 text-center">
      <div className={`font-black text-lg leading-none ${toneMap[tone] || 'text-white'}`}>
        {value}<span className="text-[10px] text-gray-600 ml-0.5">{unit}</span>
      </div>
      <div className="text-gray-600 text-[9px] mt-1 font-bold tracking-wide">{label}</div>
    </div>
  );
}
