import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Eraser } from 'lucide-react';

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;

const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export default function CoordBrushModal({ records, selectedCity, onClose, onApplyDelete }) {
  const [isMapReady, setIsMapReady] = useState(false);
  const [brushRadiusPx, setBrushRadiusPx] = useState(50);
  const [cursorPx, setCursorPx] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const mapRef = useRef(null);
  const kakaoMapRef = useRef(null);
  const isPaintingRef = useRef(false);
  const pendingRef = useRef(new Set());
  const recordsRef = useRef([]);

  const coordRecords = useMemo(() => records.filter(r => r.lat && r.lng), [records]);

  useEffect(() => { recordsRef.current = coordRecords; }, [coordRecords]);

  // ── Kakao SDK 로딩 ────────────────────────────────────────────────────
  useEffect(() => {
    if (window.kakao?.maps?.Map) { setIsMapReady(true); return; }
    const existing = document.getElementById('kakao-map-sdk');
    if (existing) {
      if (window.kakao?.maps) {
        window.kakao.maps.load(() => setIsMapReady(true));
      } else {
        existing.addEventListener('load', () => window.kakao.maps.load(() => setIsMapReady(true)), { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.id = 'kakao-map-sdk';
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&libraries=clusterer&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao.maps.load(() => setIsMapReady(true));
    document.head.appendChild(script);
  }, []);

  // ── 지도 초기화 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMapReady || !mapRef.current || kakaoMapRef.current) return;
    kakaoMapRef.current = new window.kakao.maps.Map(mapRef.current, {
      center: new window.kakao.maps.LatLng(37.5665, 126.9780),
      level: 7,
    });
  }, [isMapReady]);

  // ── 핀 오버레이 렌더링 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!kakaoMapRef.current || !isMapReady || !coordRecords.length) return;

    const bounds = new window.kakao.maps.LatLngBounds();
    // 기존 오버레이 정리 (DOM 요소에 data-coord-id가 있는 것들)
    document.querySelectorAll('[data-coord-id]').forEach(el => {
      // CustomOverlay content는 직접 setMap(null) 불가 → 부모에서 제거
      el.remove();
    });

    coordRecords.forEach(r => {
      const pos = new window.kakao.maps.LatLng(r.lat, r.lng);
      bounds.extend(pos);

      const el = document.createElement('div');
      el.setAttribute('data-coord-id', r.id);
      el.style.cssText = [
        'width:10px', 'height:10px',
        'background:#06b6d4',
        'border:2px solid rgba(255,255,255,0.55)',
        'border-radius:50%',
        'box-shadow:0 0 6px rgba(6,182,212,0.85)',
        'pointer-events:none',
        'transform:translate(-50%,-50%)',
      ].join(';');

      new window.kakao.maps.CustomOverlay({
        position: pos,
        content: el,
        zIndex: 5,
        map: kakaoMapRef.current,
      });
    });

    kakaoMapRef.current.setBounds(bounds, 60, 60, 60, 60);
  }, [isMapReady, coordRecords]);

  // ── DOM 핀 색상 갱신 ──────────────────────────────────────────────────
  const updatePinDOM = useCallback((id, selected) => {
    const el = document.querySelector(`[data-coord-id="${id}"]`);
    if (!el) return;
    if (selected) {
      el.style.background = '#ef4444';
      el.style.boxShadow = '0 0 8px rgba(239,68,68,0.9)';
      el.style.borderColor = 'rgba(255,200,200,0.7)';
    } else {
      el.style.background = '#06b6d4';
      el.style.boxShadow = '0 0 6px rgba(6,182,212,0.85)';
      el.style.borderColor = 'rgba(255,255,255,0.55)';
    }
  }, []);

  // ── 브러시 드래그 — DOM만 조작 (React state 갱신 없음 → 지도 줌 고정) ──
  const applyBrush = useCallback((clientX, clientY) => {
    if (!kakaoMapRef.current || !mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const curX = clientX - rect.left;
    const curY = clientY - rect.top;
    const sw = kakaoMapRef.current.getBounds().getSouthWest();
    const ne = kakaoMapRef.current.getBounds().getNorthEast();
    const cLat = ne.getLat() + (curY / rect.height) * (sw.getLat() - ne.getLat());
    const cLng = sw.getLng() + (curX / rect.width) * (ne.getLng() - sw.getLng());
    const latSpanM = haversine(sw.getLat(), sw.getLng(), ne.getLat(), sw.getLng());
    const radiusM = brushRadiusPx * (latSpanM / rect.height);

    recordsRef.current.forEach(r => {
      if (haversine(cLat, cLng, r.lat, r.lng) > radiusM) return;
      if (!pendingRef.current.has(r.id)) {
        pendingRef.current.add(r.id);
        updatePinDOM(r.id, true);
      }
    });
  }, [brushRadiusPx, updatePinDOM]);

  // ── 드래그 종료 → React state에 한 번만 반영 ─────────────────────────
  const commitBrush = useCallback(() => {
    isPaintingRef.current = false;
    if (kakaoMapRef.current) kakaoMapRef.current.setDraggable(true);
    const pending = new Set(pendingRef.current);
    if (!pending.size) return;
    pendingRef.current.clear();
    setSelectedIds(prev => new Set([...prev, ...pending]));
  }, []);

  // ── 선택 초기화 ────────────────────────────────────────────────────────
  const handleClearSelection = useCallback(() => {
    pendingRef.current.clear();
    setSelectedIds(prev => {
      prev.forEach(id => updatePinDOM(id, false));
      return new Set();
    });
  }, [updatePinDOM]);

  // ── 삭제 적용 ─────────────────────────────────────────────────────────
  const handleApply = () => {
    if (!selectedIds.size) return;
    onApplyDelete(new Set(selectedIds));
  };

  // ── ESC 닫기 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex flex-col z-[200]">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-[#0e0e0e] shrink-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Eraser size={16} className="text-cyan-400" />
          <h2 className="text-sm font-black text-white">좌표 삭제 브러시</h2>
          {selectedCity && <span className="text-[10px] text-gray-500">{selectedCity}</span>}
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
            좌표 {coordRecords.length.toLocaleString()}건
          </span>
          {selectedIds.size > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30">
              선택 {selectedIds.size}건
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-colors shrink-0">
          <X size={15} />
        </button>
      </div>

      {/* 본문 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 좌측 컨트롤 */}
        <div className="w-52 bg-[#0a0a0a] border-r border-white/5 p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
          <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-3">
            <div className="text-[9px] text-gray-600 font-black tracking-widest uppercase mb-2">사용법</div>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              지도 위에서 드래그하면 브러시 반경 내 핀이{' '}
              <span className="text-red-400 font-bold">빨간색</span>으로 선택됩니다.
              <br />
              <span className="text-red-400 font-bold">삭제 적용</span> 클릭 시 해당 레코드의 좌표가 삭제됩니다.
            </p>
          </div>

          {/* 브러시 반경 */}
          <div>
            <div className="text-[9px] text-gray-600 font-black tracking-widest uppercase mb-2">브러시 반경</div>
            <div className="flex gap-1">
              {[{ label: 'S', px: 30 }, { label: 'M', px: 50 }, { label: 'L', px: 80 }, { label: 'XL', px: 120 }].map(({ label, px }) => (
                <button key={label}
                  onClick={() => setBrushRadiusPx(px)}
                  className={`flex-1 py-1 rounded text-[10px] font-bold border transition-colors ${
                    brushRadiusPx === px
                      ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300'
                      : 'bg-[#111] border-[#222] text-gray-600 hover:text-gray-400'
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>

          {selectedIds.size > 0 && (
            <button
              onClick={handleClearSelection}
              className="w-full py-2 rounded-xl text-[11px] font-bold bg-[#111] hover:bg-white/5 text-gray-400 border border-[#2a2a2a] transition-colors"
            >
              선택 초기화 ({selectedIds.size}건)
            </button>
          )}

          <button
            onClick={handleApply}
            disabled={!selectedIds.size}
            className="w-full py-2.5 rounded-xl text-[11px] font-black bg-red-950/50 hover:bg-red-900/60 text-red-400 border border-red-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <Eraser size={12} />
            {selectedIds.size > 0 ? `삭제 적용 (${selectedIds.size}건)` : '삭제 적용'}
          </button>

          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl text-[10px] font-bold bg-[#111] hover:bg-white/5 text-gray-600 border border-[#222] transition-colors"
          >
            취소
          </button>

          <div className="mt-auto pt-4 border-t border-white/5 text-[9px] text-gray-700 leading-relaxed">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 shrink-0" />
              좌표 있는 레코드
            </div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
              삭제 선택된 레코드
            </div>
            <div className="text-gray-800 mt-1.5">Esc 키로 닫기</div>
          </div>
        </div>

        {/* 지도 영역 */}
        <div className="flex-1 relative overflow-hidden">
          {!isMapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a] z-10">
              <div className="flex items-center gap-3 text-gray-500 text-sm">
                <span className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                지도 로딩 중...
              </div>
            </div>
          )}

          <div ref={mapRef} className="w-full h-full" />

          {/* 브러시 인터셉터 — 지도 전체를 덮어 카카오맵 이벤트 차단 */}
          <div
            className="absolute inset-0 z-[100]"
            style={{ cursor: 'none' }}
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              setCursorPx({ x: e.clientX - rect.left, y: e.clientY - rect.top });
              if (isPaintingRef.current) applyBrush(e.clientX, e.clientY);
            }}
            onMouseDown={e => {
              e.preventDefault();
              isPaintingRef.current = true;
              if (kakaoMapRef.current) kakaoMapRef.current.setDraggable(false);
              applyBrush(e.clientX, e.clientY);
            }}
            onMouseUp={() => commitBrush()}
            onMouseLeave={() => { commitBrush(); setCursorPx(null); }}
          >
            {cursorPx && (
              <div
                className="absolute pointer-events-none rounded-full"
                style={{
                  left: cursorPx.x - brushRadiusPx,
                  top: cursorPx.y - brushRadiusPx,
                  width: brushRadiusPx * 2,
                  height: brushRadiusPx * 2,
                  border: '2.5px solid #ef4444',
                  background: 'rgba(239,68,68,0.07)',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 0 18px rgba(239,68,68,0.3)',
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
