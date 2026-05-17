import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../config/firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import { MapPin, List, Map as MapIcon, RefreshCw, Building2, Phone, ChevronUp, ChevronDown } from 'lucide-react';

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;

export default function ShareRouteView({ shareId, driverId }) {
  const [shareData, setShareData]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState(null);   // 선택된 레코드 ID
  // layoutMode: 'split' | 'map' | 'list'
  const [layoutMode, setLayoutMode] = useState('split');

  const mapRef      = useRef(null);
  const kakaoMapRef = useRef(null);
  const overlaysRef = useRef([]);
  const listRef     = useRef(null);
  const selectedIdRef = useRef(null);

  // ── Firestore 데이터 로드 ─────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'route_shares', shareId));
        if (!snap.exists()) { setError('공유 데이터를 찾을 수 없거나 만료되었습니다.'); return; }
        setShareData(snap.data());
      } catch (e) {
        setError('데이터 로드 실패: ' + e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [shareId]);

  // ── Kakao Maps SDK 로딩 ───────────────────────────────────────────
  useEffect(() => {
    if (window.kakao?.maps?.Map) { setIsMapReady(true); return; }
    const existing = document.getElementById('kakao-map-sdk');
    if (existing) { existing.onload = () => window.kakao.maps.load(() => setIsMapReady(true)); return; }
    const script = document.createElement('script');
    script.id = 'kakao-map-sdk';
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao.maps.load(() => setIsMapReady(true));
    document.head.appendChild(script);
  }, []);

  // ── 파생 데이터 계산 ─────────────────────────────────────────────
  const driver = shareData?.drivers?.find(d => d.id === driverId) || shareData?.drivers?.[0];
  const allRecords = (shareData?.records || [])
    .filter(r => r.driverId === driver?.id)
    .map((r, i) => ({ ...r, _uid: r.id || `${r.이름}_${r.배송순번 || i}` }))
    .sort((a, b) => {
      const sa = parseInt(a.배송순번) || 9999;
      const sb = parseInt(b.배송순번) || 9999;
      return sa - sb;
    });
  const mapRecords = allRecords.filter(r => r.lat && r.lng);

  // ── 핀 클릭 → 목록 이동 (window 글로벌 함수) ──────────────────────
  useEffect(() => {
    window._shareSelectRecord = (uid) => {
      selectedIdRef.current = uid;
      setSelectedId(uid);
      setLayoutMode(prev => prev === 'map' ? 'split' : prev);
    };
    return () => { delete window._shareSelectRecord; };
  }, []);

  // ── selectedId 바뀌면 목록 스크롤 ──────────────────────────────────
  useEffect(() => {
    if (!selectedId || layoutMode === 'map') return;
    const t = setTimeout(() => {
      document.getElementById(`share-rec-${selectedId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(t);
  }, [selectedId, layoutMode]);

  // ── 목록 클릭 → 지도 이동 ──────────────────────────────────────────
  const handleRecordClick = useCallback((r) => {
    setSelectedId(r._uid);
    if (r.lat && r.lng && kakaoMapRef.current) {
      setLayoutMode(prev => prev === 'list' ? 'split' : prev);
      setTimeout(() => {
        kakaoMapRef.current?.panTo(new window.kakao.maps.LatLng(r.lat, r.lng));
        if (kakaoMapRef.current?.getLevel() > 4) kakaoMapRef.current.setLevel(3);
        kakaoMapRef.current?.relayout();
      }, layoutMode === 'list' ? 250 : 50);
    }
  }, [layoutMode]);

  // ── 지도 초기화 + 마커 렌더링 ─────────────────────────────────────
  useEffect(() => {
    if (!isMapReady || !shareData || !mapRef.current || !driver) return;

    if (!kakaoMapRef.current) {
      kakaoMapRef.current = new window.kakao.maps.Map(mapRef.current, {
        center: new window.kakao.maps.LatLng(37.5665, 126.9780),
        level: 7,
      });
    }

    overlaysRef.current.forEach(o => { try { o.setMap(null); } catch {} });
    overlaysRef.current = [];

    if (!mapRecords.length) return;

    const driverColor = driver.color || '#3b82f6';

    // 경로 폴리라인
    if (mapRecords.length > 1) {
      const polyline = new window.kakao.maps.Polyline({
        path: mapRecords.map(r => new window.kakao.maps.LatLng(r.lat, r.lng)),
        strokeWeight: 2, strokeColor: driverColor,
        strokeOpacity: 0.5, strokeStyle: 'solid',
      });
      polyline.setMap(kakaoMapRef.current);
      overlaysRef.current.push(polyline);
    }

    // 핀 오버레이 (선택 여부에 따라 크기/스타일 변화)
    mapRecords.forEach((r) => {
      const isSelected = r._uid === selectedId;
      const seq = r.배송순번 || '?';
      const bg = isSelected ? '#fff' : driverColor;
      const fg = isSelected ? driverColor : '#fff';
      const size = isSelected ? 30 : 22;
      const shadow = isSelected
        ? `0 0 0 3px ${driverColor}, 0 4px 12px rgba(0,0,0,0.7)`
        : '0 2px 6px rgba(0,0,0,0.5)';
      const z = isSelected ? 99 : 1;

      const content = `
        <div onclick="window._shareSelectRecord('${r._uid}')"
          style="display:flex;align-items:center;justify-content:center;
            width:${size}px;height:${size}px;border-radius:50%;
            background:${bg};border:2px solid ${isSelected ? driverColor : 'white'};
            box-shadow:${shadow};cursor:pointer;
            font-size:${isSelected ? 11 : 9}px;font-weight:900;color:${fg};
            transition:all 0.2s;z-index:${z};position:relative;"
          title="${r.이름} | ${r.주소}">${seq}</div>`;

      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(r.lat, r.lng),
        content, yAnchor: 0.5, xAnchor: 0.5, zIndex: z,
      });
      overlay.setMap(kakaoMapRef.current);
      overlaysRef.current.push(overlay);
    });

    // 초기 bounds (selectedId 없을 때만)
    if (!selectedId) {
      const bounds = new window.kakao.maps.LatLngBounds();
      mapRecords.forEach(r => bounds.extend(new window.kakao.maps.LatLng(r.lat, r.lng)));
      kakaoMapRef.current.setBounds(bounds, 50, 50, 50, 50);
    }
  }, [isMapReady, shareData, driverId, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── layoutMode 변경 시 relayout ──────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => kakaoMapRef.current?.relayout(), 200);
    return () => clearTimeout(t);
  }, [layoutMode]);

  // ── 로딩 / 에러 화면 ─────────────────────────────────────────────
  if (loading) return (
    <div className="fixed inset-0 bg-[#050505] flex items-center justify-center">
      <div className="text-center">
        <RefreshCw size={24} className="text-[#3b82f6] animate-spin mx-auto mb-3" />
        <div className="text-gray-400 text-sm">배송 정보 로딩 중...</div>
      </div>
    </div>
  );
  if (error) return (
    <div className="fixed inset-0 bg-[#050505] flex items-center justify-center">
      <div className="text-center p-8">
        <div className="text-red-400 text-4xl mb-4">⚠️</div>
        <div className="text-white font-bold mb-2">공유 링크 오류</div>
        <div className="text-gray-500 text-sm">{error}</div>
      </div>
    </div>
  );
  if (!shareData) return null;

  const driverColor = driver?.color || '#3b82f6';
  const totalQty = allRecords.reduce((s, r) => s + (parseInt(r.포수) || 1), 0);

  return (
    <div className="fixed inset-0 bg-[#050505] flex flex-col" style={{ fontFamily: 'inherit' }}>

      {/* ── 헤더 ────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-[#0a0a0a] border-b border-[#222] px-4 py-2.5 flex items-center gap-3">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: driverColor }} />
        <div className="flex-1 min-w-0">
          <div className="text-white font-black text-sm">{driver?.name || '기사'} 배송 루트</div>
          <div className="text-gray-600 text-[10px]">
            {shareData.city} {shareData.monthId || shareData.month} &nbsp;·&nbsp;
            총 <span className="text-white font-bold">{allRecords.length}건</span>&nbsp;
            <span className="text-blue-400 font-bold">{totalQty}포</span>
          </div>
        </div>

        {/* 레이아웃 토글 */}
        <div className="flex rounded-lg overflow-hidden border border-[#2a2a2a] shrink-0">
          <button onClick={() => setLayoutMode('map')}
            className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors ${layoutMode === 'map' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500'}`}>
            <MapIcon size={11} />
          </button>
          <button onClick={() => setLayoutMode('split')}
            className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors border-x border-[#2a2a2a] ${layoutMode === 'split' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500'}`}>
            <ChevronDown size={10} /><ChevronUp size={10} />
          </button>
          <button onClick={() => setLayoutMode('list')}
            className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors ${layoutMode === 'list' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500'}`}>
            <List size={11} />
          </button>
        </div>
      </div>

      {/* ── 바디 ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* 지도 영역 */}
        <div className={`relative flex flex-col transition-all ${
          layoutMode === 'map'   ? 'flex-1' :
          layoutMode === 'split' ? 'h-[45%] shrink-0' :
          'h-0 overflow-hidden'
        }`}>
          {!isMapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#080808] z-10">
              <RefreshCw size={20} className="text-[#3b82f6] animate-spin" />
            </div>
          )}
          <div ref={mapRef} className="flex-1 w-full h-full" />
        </div>

        {/* split 구분선 + 선택 레코드 요약 배지 */}
        {layoutMode === 'split' && (
          <div className="shrink-0 h-px bg-[#1a1a1a] relative flex items-center justify-center">
            {selectedId && (() => {
              const sel = allRecords.find(r => r._uid === selectedId);
              return sel ? (
                <div className="absolute bg-[#0f1a0f] border border-[#2a2a2a] rounded-full px-3 py-0.5 flex items-center gap-2 text-[10px] z-10">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: driverColor }} />
                  <span className="font-black text-white">{sel.배송순번}번</span>
                  <span className="text-gray-400">{sel.이름}</span>
                  <span className="text-gray-600 max-w-[120px] truncate">{sel.주소}</span>
                </div>
              ) : null;
            })()}
          </div>
        )}

        {/* 목록 영역 */}
        <div
          ref={listRef}
          className={`bg-[#060606] overflow-y-auto transition-all ${
            layoutMode === 'list'  ? 'flex-1' :
            layoutMode === 'split' ? 'flex-1 min-h-0' :
            'h-0 overflow-hidden'
          }`}
        >
          {/* 목록 헤더 */}
          <div className="sticky top-0 bg-[#0a0a0a] border-b border-[#1a1a1a] px-4 py-1.5 flex items-center gap-2 z-10">
            <MapPin size={10} className="text-gray-600" />
            <span className="text-[9px] text-gray-600 font-black tracking-widest uppercase">배송 순번 목록</span>
            <span className="ml-auto text-[9px] text-gray-700">{allRecords.length}건</span>
          </div>

          {allRecords.map((r) => {
            const isSelected = r._uid === selectedId;
            return (
              <div
                key={r._uid}
                id={`share-rec-${r._uid}`}
                onClick={() => handleRecordClick(r)}
                className={`flex items-center gap-3 px-4 py-3 border-b cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#0d1e0d] border-[#1a3a1a]'
                    : 'border-[#111] hover:bg-[#0f0f0f]'
                }`}
              >
                {/* 순번 배지 */}
                <div
                  className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center font-black text-xs transition-all"
                  style={{
                    background: isSelected ? driverColor : `${driverColor}22`,
                    color: isSelected ? '#fff' : driverColor,
                    border: `2px solid ${isSelected ? driverColor : `${driverColor}44`}`,
                    boxShadow: isSelected ? `0 0 10px ${driverColor}60` : 'none',
                  }}
                >
                  {r.배송순번 || '?'}
                </div>

                {/* 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`font-bold text-sm ${isSelected ? 'text-white' : 'text-gray-200'}`}>
                      {r.이름}
                    </span>
                    {r.포수 > 1 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                        style={{ background: `${driverColor}20`, color: driverColor }}>
                        {r.포수}포
                      </span>
                    )}
                    {r.isApt && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-orange-900/30 text-orange-600 rounded-full font-bold">
                        <Building2 size={8} className="inline" /> 아파트
                      </span>
                    )}
                  </div>
                  <div className="text-gray-600 text-xs truncate">{r.행정동 && `${r.행정동} · `}{r.주소}</div>
                  {r.특이사항 && (
                    <div className="text-amber-700 text-[10px] truncate mt-0.5">⚠ {r.특이사항}</div>
                  )}
                </div>

                {/* 우측 액션 */}
                <div className="shrink-0 flex flex-col items-end gap-1">
                  {r.lat && r.lng && (
                    <div className="text-[9px] text-gray-700 font-bold">
                      {isSelected ? '📍 선택됨' : '탭하여 지도'}
                    </div>
                  )}
                  {r.휴대폰 && (
                    <a href={`tel:${r.휴대폰}`} onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1 text-[9px] text-blue-500 hover:text-blue-400 font-bold">
                      <Phone size={9} /> {r.휴대폰}
                    </a>
                  )}
                </div>
              </div>
            );
          })}

          {allRecords.length === 0 && (
            <div className="flex items-center justify-center h-32 text-gray-700 text-sm">
              배송 데이터가 없습니다
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
