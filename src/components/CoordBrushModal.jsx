import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Eraser, Search } from 'lucide-react';
import { loadKakaoMapsSdk } from '../utils/kakaoSdk.js';   // 지도 SDK 로더 SSOT

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

export default function CoordBrushModal({ records, selectedCity, onClose, onApplyDelete, onApplyRematch }) {
  const [isMapReady, setIsMapReady] = useState(false);
  const [brushRadiusPx, setBrushRadiusPx] = useState(50);
  const [cursorPx, setCursorPx] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [searchText, setSearchText] = useState('');
  const [viewMode, setViewMode] = useState('split'); // 'split' | 'map' | 'list'
  const [isBrushMode, setIsBrushMode] = useState(false);

  const mapRef = useRef(null);
  const kakaoMapRef = useRef(null);
  const isPaintingRef = useRef(false);
  const pendingRef = useRef(new Set());
  const recordsRef = useRef([]);
  const listRef = useRef(null);

  const coordRecords = useMemo(() => records.filter(r => r.lat && r.lng), [records]);
  useEffect(() => { recordsRef.current = coordRecords; }, [coordRecords]);

  const filteredRecords = useMemo(() => {
    if (!searchText.trim()) return coordRecords;
    const q = searchText.trim().toLowerCase();
    return coordRecords.filter(r =>
      (r.이름 || '').toLowerCase().includes(q) ||
      (r.주소 || '').toLowerCase().includes(q) ||
      (r.행정동 || '').toLowerCase().includes(q)
    );
  }, [coordRecords, searchText]);

  // ── Kakao SDK ────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    loadKakaoMapsSdk(KAKAO_JS_KEY, ['clusterer'])
      .then(() => { if (alive) setIsMapReady(true); })
      .catch((e) => console.warn('[지도 SDK]', e));
    return () => { alive = false; };
  }, []);

  // ── 지도 초기화 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMapReady || !mapRef.current || kakaoMapRef.current) return;
    kakaoMapRef.current = new window.kakao.maps.Map(mapRef.current, {
      center: new window.kakao.maps.LatLng(37.5665, 126.9780),
      level: 7,
    });
  }, [isMapReady]);

  // ── 핀 DOM 색상 유틸 ─────────────────────────────────────────────────────
  const setPinColor = useCallback((id, selected) => {
    const el = document.querySelector(`[data-coord-id="${id}"]`);
    if (!el) return;
    if (selected) {
      el.style.background = '#ef4444';
      el.style.boxShadow = '0 0 8px rgba(239,68,68,0.9)';
      el.style.borderColor = 'rgba(255,200,200,0.7)';
      el.style.zIndex = '10';
    } else {
      el.style.background = '#06b6d4';
      el.style.boxShadow = '0 0 6px rgba(6,182,212,0.85)';
      el.style.borderColor = 'rgba(255,255,255,0.55)';
      el.style.zIndex = '5';
    }
  }, []);

  // ── 핀 오버레이 렌더링 ───────────────────────────────────────────────────
  useEffect(() => {
    if (!kakaoMapRef.current || !isMapReady || !coordRecords.length) return;

    // 기존 핀 제거
    document.querySelectorAll('[data-coord-id]').forEach(el => el.remove());

    const bounds = new window.kakao.maps.LatLngBounds();

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
        'transform:translate(-50%,-50%)',
        'cursor:pointer',
        'transition:background 0.1s,box-shadow 0.1s',
        'position:relative',
      ].join(';');

      // 클릭: 개별 토글 선택
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(r.id)) { next.delete(r.id); setPinColor(r.id, false); }
          else { next.add(r.id); setPinColor(r.id, true); }
          return next;
        });
      });

      new window.kakao.maps.CustomOverlay({
        position: pos,
        content: el,
        zIndex: 5,
        map: kakaoMapRef.current,
      });
    });

    kakaoMapRef.current.relayout();
    kakaoMapRef.current.setBounds(bounds, 80, 80, 80, 80);
    // 너무 넓게 펼쳐지지 않도록 최대 레벨 제한
    setTimeout(() => {
      if (kakaoMapRef.current && kakaoMapRef.current.getLevel() > 7)
        kakaoMapRef.current.setLevel(7);
    }, 350);
  }, [isMapReady, coordRecords, setPinColor]);

  // ── viewMode 전환 시 지도 relayout ───────────────────────────────────────
  useEffect(() => {
    if (!kakaoMapRef.current) return;
    setTimeout(() => kakaoMapRef.current?.relayout(), 50);
  }, [viewMode]);

  // ── 브러시 ───────────────────────────────────────────────────────────────
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
        setPinColor(r.id, true);
      }
    });
  }, [brushRadiusPx, setPinColor]);

  const commitBrush = useCallback(() => {
    isPaintingRef.current = false;
    if (kakaoMapRef.current) kakaoMapRef.current.setDraggable(true);
    const pending = new Set(pendingRef.current);
    if (!pending.size) return;
    pendingRef.current.clear();
    setSelectedIds(prev => new Set([...prev, ...pending]));
  }, []);

  // ── 선택 초기화 ──────────────────────────────────────────────────────────
  const handleClearSelection = useCallback(() => {
    pendingRef.current.clear();
    setSelectedIds(prev => {
      prev.forEach(id => setPinColor(id, false));
      return new Set();
    });
  }, [setPinColor]);

  // ── 개별 토글 (목록 클릭) ────────────────────────────────────────────────
  const toggleRecord = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); setPinColor(id, false); }
      else { next.add(id); setPinColor(id, true); }
      return next;
    });
  }, [setPinColor]);

  // ── 지도 중심 이동 ───────────────────────────────────────────────────────
  const centerOnRecord = useCallback((r) => {
    if (!kakaoMapRef.current) return;
    kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(r.lat, r.lng));
    if (kakaoMapRef.current.getLevel() > 4) kakaoMapRef.current.setLevel(4);
  }, []);

  // ── 전체 선택 (필터된 목록) ──────────────────────────────────────────────
  const selectAllFiltered = useCallback(() => {
    const newIds = new Set(filteredRecords.map(r => r.id));
    setSelectedIds(prev => new Set([...prev, ...newIds]));
    filteredRecords.forEach(r => setPinColor(r.id, true));
  }, [filteredRecords, setPinColor]);

  // ── 삭제 적용 ────────────────────────────────────────────────────────────
  const handleApply = () => {
    if (!selectedIds.size) return;
    onApplyDelete(new Set(selectedIds));
  };

  const handleRematch = () => {
    if (!selectedIds.size || !onApplyRematch) return;
    onApplyRematch(new Set(selectedIds));
  };

  // ── ESC 닫기 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex flex-col z-[200]">

      {/* ── 헤더 ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/10 bg-[#0e0e0e] shrink-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Eraser size={15} className="text-cyan-400" />
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
        <div className="flex items-center gap-2">
          {/* 뷰 모드 */}
          <div className="flex rounded-lg overflow-hidden border border-[#2a2a2a]">
            {[['분할', 'split'], ['목록', 'list'], ['지도', 'map']].map(([label, mode]) => (
              <button key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-2.5 py-1 text-[10px] font-bold transition-colors border-r last:border-r-0 border-[#2a2a2a] ${viewMode === mode ? 'bg-cyan-900/40 text-cyan-300' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-colors">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* ── 본문 ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── 목록 패널 ─────────────────────────────────────────────────── */}
        {viewMode !== 'map' && (
          <div className={`flex flex-col bg-[#0a0a0a] border-r border-[#1a1a1a] shrink-0 ${viewMode === 'split' ? 'w-[340px]' : 'flex-1'}`}>

            {/* 검색 + 필터 */}
            <div className="px-3 pt-3 pb-2 border-b border-[#1a1a1a] space-y-2">
              <div className="relative">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
                <input
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder="이름·주소·행정동 검색..."
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg pl-7 pr-3 py-1.5 text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/40"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-600">{filteredRecords.length}건 표시</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={selectAllFiltered}
                    className="px-2 py-0.5 text-[9px] bg-red-900/30 border border-red-600/30 text-red-400 rounded font-bold hover:bg-red-900/50 transition-colors"
                  >
                    전체선택
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={handleClearSelection}
                      className="px-2 py-0.5 text-[9px] bg-[#1a1a1a] border border-[#333] text-gray-500 rounded font-bold hover:text-gray-300 transition-colors"
                    >
                      선택해제
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 레코드 목록 */}
            <div ref={listRef} className="flex-1 overflow-y-auto">
              {filteredRecords.map(r => {
                const isSelected = selectedIds.has(r.id);
                return (
                  <div
                    key={r.id}
                    className={`px-3 py-2 border-b border-[#0f0f0f] cursor-pointer hover:bg-[#111] transition-colors flex items-start gap-2 ${isSelected ? 'bg-red-950/25 hover:bg-red-950/35' : ''}`}
                    onClick={() => { toggleRecord(r.id); centerOnRecord(r); }}
                  >
                    <div className={`w-2.5 h-2.5 rounded-full mt-0.5 shrink-0 transition-colors ${isSelected ? 'bg-red-500' : 'bg-cyan-500'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[11px] text-white font-bold truncate">{r.이름 || '(이름없음)'}</span>
                        {r.행정동 && <span className="text-[9px] text-gray-600 shrink-0">{r.행정동}</span>}
                        {r.포수 && <span className="text-[9px] text-amber-600 shrink-0">{r.포수}포</span>}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">{r.주소 || '(주소없음)'}</div>
                      <div className="text-[9px] text-gray-700 tabular-nums mt-0.5">
                        {Number(r.lat).toFixed(5)}, {Number(r.lng).toFixed(5)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 지도 패널 ─────────────────────────────────────────────────── */}
        {viewMode !== 'list' && (
          <div className="flex-1 flex flex-col relative min-w-0 min-h-0">

            {/* 지도 툴바 */}
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border-b border-[#1a1a1a] flex-wrap">
              <button
                onClick={() => {
                  const next = !isBrushMode;
                  setIsBrushMode(next);
                  setCursorPx(null);
                  isPaintingRef.current = false;
                  if (kakaoMapRef.current) kakaoMapRef.current.setDraggable(!next === false ? false : true);
                }}
                className={`px-3 py-1 rounded-lg text-[10px] font-black flex items-center gap-1.5 border transition-all ${
                  isBrushMode
                    ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.2)]'
                    : 'bg-[#111] border-[#2a2a2a] text-gray-500 hover:text-amber-400 hover:border-amber-600/40'
                }`}
              >
                <Eraser size={11} /> {isBrushMode ? '브러시 ON — 드래그로 일괄선택' : '브러시 모드'}
              </button>

              {isBrushMode && (
                <>
                  <span className="text-[9px] text-gray-600">반경:</span>
                  {[['S', 30], ['M', 60], ['L', 100], ['XL', 160]].map(([label, px]) => (
                    <button key={label}
                      onClick={() => setBrushRadiusPx(px)}
                      className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-colors ${brushRadiusPx === px ? 'bg-amber-500/20 border-amber-400/40 text-amber-300' : 'bg-[#111] border-[#222] text-gray-600 hover:text-gray-400'}`}
                    >{label}</button>
                  ))}
                </>
              )}

              {!isBrushMode && (
                <span className="text-[9px] text-gray-700">
                  핀 클릭으로 개별 선택 · 브러시 모드 ON 시 드래그로 일괄 선택
                </span>
              )}
            </div>

            {/* 지도 */}
            <div ref={mapRef} className="flex-1 relative" style={{ cursor: isBrushMode ? 'none' : 'default' }}>

              {/* 브러시 인터셉터 — isBrushMode 시 지도 위를 덮어 카카오맵 이벤트 차단 */}
              {isBrushMode && (
                <div
                  style={{ position: 'absolute', inset: 0, zIndex: 200, cursor: 'none' }}
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
                  onWheel={e => {
                    if (!kakaoMapRef.current) return;
                    const lv = kakaoMapRef.current.getLevel();
                    kakaoMapRef.current.setLevel(e.deltaY > 0 ? lv + 1 : lv - 1);
                  }}
                >
                  {cursorPx && (
                    <div className="absolute pointer-events-none rounded-full"
                      style={{
                        left: cursorPx.x - brushRadiusPx,
                        top: cursorPx.y - brushRadiusPx,
                        width: brushRadiusPx * 2,
                        height: brushRadiusPx * 2,
                        border: '2.5px solid #ef4444',
                        background: 'rgba(239,68,68,0.12)',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 0 18px rgba(239,68,68,0.35)',
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 하단 액션바 ──────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-[#1a1a1a] bg-[#0a0a0a]">
        <div className="text-[10px] text-gray-600">
          {selectedIds.size > 0
            ? <span className="text-red-400 font-bold">선택 {selectedIds.size}건 — 삭제 적용 시 좌표 초기화 (재매칭 가능)</span>
            : '목록 클릭 또는 브러시 드래그로 삭제할 좌표를 선택하세요'}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearSelection}
            disabled={!selectedIds.size}
            className="px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white text-xs font-bold rounded-xl disabled:opacity-30 transition-colors"
          >
            선택 초기화
          </button>
          <button
            onClick={handleApply}
            disabled={!selectedIds.size}
            className="px-5 py-2 bg-red-800 hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-black rounded-xl flex items-center gap-1.5 transition-colors"
          >
            <Eraser size={12} /> 삭제 적용 ({selectedIds.size}건)
          </button>
          {onApplyRematch && (
            <button
              onClick={handleRematch}
              disabled={!selectedIds.size}
              className="px-5 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-black rounded-xl flex items-center gap-1.5 transition-colors"
              title="선택한 좌표를 초기화한 뒤 도로명·지번·원본주소 기준으로 즉시 다시 조회합니다"
            >
              <Search size={12} /> 삭제 후 재매칭 ({selectedIds.size}건)
            </button>
          )}
          <button onClick={onClose}
            className="px-4 py-2 bg-[#111] border border-[#2a2a2a] text-gray-500 hover:text-white text-xs font-bold rounded-xl transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
