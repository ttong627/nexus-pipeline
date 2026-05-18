import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../config/firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import { MapPin, List, Map as MapIcon, RefreshCw, Building2, Phone, ChevronUp, ChevronDown, Navigation, Crosshair, Star, Download, X, BookMarked, Check } from 'lucide-react';

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;

// 카카오맵 즐겨찾기 추가 URL (지도에서 ★ 탭으로 저장 가능)
const openKakaoMapFavorite = (r) => {
  const name = encodeURIComponent((r.이름 || '배송지') + ' ' + (r.주소 || ''));
  // map.kakao.com/link/map 는 해당 위치 상세 페이지 → 앱에서 ★ 저장 가능
  const url = `https://map.kakao.com/link/map/${name},${r.lat},${r.lng}`;
  window.open(url, '_blank');
};

// 카카오맵 목적지 링크 (웹/앱 공통)
const openKakaoMap = (r) => {
  const name = encodeURIComponent((r.이름 || '배송지') + ' ' + (r.주소 || ''));
  const url = `https://map.kakao.com/link/to/${name},${r.lat},${r.lng}`;
  window.open(url, '_blank');
};

// 카카오 내비 앱 연결 (설치된 경우) → 미설치 시 카카오맵 웹으로 폴백
const openKakaoNavi = (r) => {
  const name = encodeURIComponent(r.이름 || '배송지');
  // 카카오 내비 앱 URL 스킴 (lng, lat 순서 주의)
  const naviScheme = `kakaonavi://route?ep=${r.lng},${r.lat}&by=CAR&appkey=${KAKAO_JS_KEY}`;
  const webFallback = `https://map.kakao.com/link/to/${name},${r.lat},${r.lng}`;

  // 앱 열기 시도 → 1초 후 앱이 없으면 웹으로 열기
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  iframe.src = naviScheme;
  setTimeout(() => {
    document.body.removeChild(iframe);
    // 포커스가 유지되면 앱이 없다는 의미 → 웹 열기
    if (!document.hidden) window.open(webFallback, '_blank');
  }, 1000);
};

// 기사별 KML 다운로드 — Cloud Function API 미들웨어 호출
const downloadKml = async (shareId, driverId, driverName) => {
  const url = `/api/fav/kml?shareId=${shareId}&driverId=${encodeURIComponent(driverId)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${driverName || '기사'}_배송루트.kml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    // Cloud Function 미배포 시 클라이언트 폴백
    return null;
  }
};

// 클라이언트사이드 KML 생성 폴백 (Cloud Function 미사용 시)
const generateKmlLocal = (records, driverName, city, monthId) => {
  const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const sorted = [...records].sort((a,b)=>(parseInt(a.배송순번)||9999)-(parseInt(b.배송순번)||9999));
  const placemarks = sorted.map(r=>`
  <Placemark>
    <name>${esc((r.배송순번?r.배송순번+'. ':'')+r.이름)}</name>
    <description>${esc(r.주소)}${(r.포수||1)>1?` / ${r.포수}포`:''}${r.특이사항?'\n⚠ '+r.특이사항:''}${r.휴대폰?'\n📞 '+r.휴대폰:''}</description>
    <Point><coordinates>${r.lng},${r.lat},0</coordinates></Point>
  </Placemark>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${esc(`${driverName} 배송루트 - ${city} ${monthId}`)}</name>
${placemarks}
</Document>
</kml>`;
};

export default function ShareRouteView({ shareId, driverId }) {
  const [shareData, setShareData]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [layoutMode, setLayoutMode] = useState('split');

  // 즐겨찾기 상태
  const [starredIds, setStarredIds]   = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`starred_${shareId}_${driverId}`) || '[]')); }
    catch { return new Set(); }
  });
  const [showKmlGuide, setShowKmlGuide] = useState(false);
  const [kmlDownloading, setKmlDownloading] = useState(false);

  // 현재 위치 상태
  const [myLocation, setMyLocation] = useState(null); // { lat, lng, accuracy }
  const [gpsStatus, setGpsStatus]   = useState('idle'); // 'idle' | 'loading' | 'ok' | 'denied' | 'error'

  const mapRef          = useRef(null);
  const kakaoMapRef     = useRef(null);
  const overlaysRef     = useRef([]);
  const myLocOverlayRef = useRef(null);
  const watchIdRef      = useRef(null);
  const listRef         = useRef(null);
  const selectedIdRef   = useRef(null);

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

  // ── GPS 현재위치 추적 ─────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('error'); return; }
    setGpsStatus('loading');

    const onSuccess = (pos) => {
      setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      setGpsStatus('ok');
    };
    const onError = (err) => {
      setGpsStatus(err.code === 1 ? 'denied' : 'error');
    };

    watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      maximumAge: 8000,
      timeout: 15000,
    });

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // ── 현재위치 마커 지도 렌더링 ─────────────────────────────────────
  useEffect(() => {
    if (!isMapReady || !kakaoMapRef.current || !myLocation) return;

    if (myLocOverlayRef.current) {
      try { myLocOverlayRef.current.setMap(null); } catch {}
    }

    const content = `
      <div style="position:relative;width:24px;height:24px;transform:translate(-50%,-50%)">
        <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.25);animation:gps-pulse 2s ease-out infinite;"></div>
        <div style="position:absolute;inset:5px;border-radius:50%;background:#3b82f6;border:2.5px solid white;box-shadow:0 0 0 1px rgba(59,130,246,0.5),0 2px 8px rgba(0,0,0,0.4);"></div>
      </div>`;

    myLocOverlayRef.current = new window.kakao.maps.CustomOverlay({
      position: new window.kakao.maps.LatLng(myLocation.lat, myLocation.lng),
      content,
      yAnchor: 0, xAnchor: 0,
      zIndex: 200,
    });
    myLocOverlayRef.current.setMap(kakaoMapRef.current);
  }, [isMapReady, myLocation]);

  // ── 파생 데이터 계산 ─────────────────────────────────────────────
  const driver = shareData?.drivers?.find(d => d.id === driverId) || shareData?.drivers?.[0];
  const allRecords = (shareData?.records || [])
    .filter(r => r.driverId === driver?.id)
    .map((r, i) => ({ ...r, _uid: r.id || `${r.이름}_${r.배송순번 || i}` }))
    .sort((a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999));
  const mapRecords = allRecords.filter(r => r.lat && r.lng);

  // ── 즐겨찾기 토글 ────────────────────────────────────────────────
  const handleStarRecord = useCallback((r) => {
    setStarredIds(prev => {
      const next = new Set(prev);
      if (next.has(r._uid)) next.delete(r._uid);
      else {
        next.add(r._uid);
        // 즐겨찾기 탭 → 카카오맵으로 해당 위치 열기 (사용자가 ★ 탭해서 저장)
        if (r.lat && r.lng) openKakaoMapFavorite(r);
      }
      try { localStorage.setItem(`starred_${shareId}_${driverId}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [shareId, driverId]);

  // ── KML 다운로드 (API 미들웨어 → 폴백: 클라이언트 생성) ──────────
  const handleDownloadKml = useCallback(async () => {
    if (kmlDownloading) return;
    setKmlDownloading(true);
    try {
      const result = await downloadKml(shareId, driver?.id || driverId, driver?.name);
      if (result === null) {
        // Cloud Function 미배포 시 클라이언트 폴백
        const mapRecs = allRecords.filter(r => r.lat && r.lng);
        if (!mapRecs.length) { alert('좌표 데이터가 없어 KML을 생성할 수 없습니다.'); return; }
        const kml = generateKmlLocal(
          mapRecs, driver?.name || '기사',
          shareData?.city || '', shareData?.monthId || ''
        );
        const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${driver?.name || '기사'}_배송루트.kml`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      setShowKmlGuide(true);
    } finally {
      setKmlDownloading(false);
    }
  }, [shareId, driverId, driver, allRecords, shareData, kmlDownloading]);

  // ── 핀 클릭 → 목록 이동 ──────────────────────────────────────────
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

  // ── 내 위치로 지도 이동 ───────────────────────────────────────────
  const centerOnMyLocation = useCallback(() => {
    if (!myLocation || !kakaoMapRef.current) return;
    kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(myLocation.lat, myLocation.lng));
    kakaoMapRef.current.setLevel(4);
  }, [myLocation]);

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

    // 배송지 핀
    mapRecords.forEach((r) => {
      const isSelected = r._uid === selectedId;
      const seq = r.배송순번 || '?';
      const bg = isSelected ? '#fff' : driverColor;
      const fg = isSelected ? driverColor : '#fff';
      const size = isSelected ? 30 : 22;
      const shadow = isSelected
        ? `0 0 0 3px ${driverColor}, 0 4px 12px rgba(0,0,0,0.7)`
        : '0 2px 6px rgba(0,0,0,0.5)';

      const content = `
        <div onclick="window._shareSelectRecord('${r._uid}')"
          style="display:flex;align-items:center;justify-content:center;
            width:${size}px;height:${size}px;border-radius:50%;
            background:${bg};border:2px solid ${isSelected ? driverColor : 'white'};
            box-shadow:${shadow};cursor:pointer;
            font-size:${isSelected ? 11 : 9}px;font-weight:900;color:${fg};
            transition:all 0.2s;position:relative;"
          title="${r.이름} | ${r.주소}">${seq}</div>`;

      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(r.lat, r.lng),
        content, yAnchor: 0.5, xAnchor: 0.5, zIndex: isSelected ? 99 : 1,
      });
      overlay.setMap(kakaoMapRef.current);
      overlaysRef.current.push(overlay);
    });

    // 초기 bounds
    if (!selectedId) {
      const bounds = new window.kakao.maps.LatLngBounds();
      mapRecords.forEach(r => bounds.extend(new window.kakao.maps.LatLng(r.lat, r.lng)));
      kakaoMapRef.current.setBounds(bounds, 50, 50, 50, 50);
    }
  }, [isMapReady, shareData, driverId, selectedId]); // eslint-disable-line

  // ── layoutMode 변경 시 relayout ──────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => kakaoMapRef.current?.relayout(), 200);
    return () => clearTimeout(t);
  }, [layoutMode]);

  // ── 로딩 / 에러 ──────────────────────────────────────────────────
  if (loading) return (
    <div className="fixed inset-0 bg-[#050505] flex items-center justify-center">
      <RefreshCw size={24} className="text-[#3b82f6] animate-spin" />
    </div>
  );
  if (error) return (
    <div className="fixed inset-0 bg-[#050505] flex items-center justify-center p-8">
      <div className="text-center">
        <div className="text-red-400 text-4xl mb-4">⚠️</div>
        <div className="text-white font-bold mb-2">공유 링크 오류</div>
        <div className="text-gray-500 text-sm">{error}</div>
      </div>
    </div>
  );
  if (!shareData) return null;

  const driverColor = driver?.color || '#3b82f6';
  const totalQty = allRecords.reduce((s, r) => s + (parseInt(r.포수) || 1), 0);
  const selectedRecord = allRecords.find(r => r._uid === selectedId);

  return (
    <div className="fixed inset-0 bg-[#050505] flex flex-col" style={{ fontFamily: 'inherit' }}>

      {/* GPS 펄스 애니메이션 (전역 한 번만) */}
      <style>{`
        @keyframes gps-pulse {
          0%   { transform: scale(1);   opacity: 0.7; }
          70%  { transform: scale(2.5); opacity: 0; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      `}</style>

      {/* ── 헤더 ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-[#0a0a0a] border-b border-[#222] px-4 py-2.5 flex items-center gap-3">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: driverColor }} />
        <div className="flex-1 min-w-0">
          <div className="text-white font-black text-sm">{driver?.name || '기사'} 배송 루트</div>
          <div className="text-gray-600 text-[10px]">
            {shareData.city} {shareData.monthId || shareData.month} &nbsp;·&nbsp;
            총 <span className="text-white font-bold">{allRecords.length}건</span>&nbsp;
            <span className="text-blue-400 font-bold">{totalQty}포</span>
            {gpsStatus === 'ok' && <span className="ml-2 text-green-500">● GPS</span>}
            {gpsStatus === 'loading' && <span className="ml-2 text-yellow-500">◌ GPS...</span>}
            {gpsStatus === 'denied' && <span className="ml-2 text-red-500">✕ 위치권한</span>}
          </div>
        </div>

        {/* 즐겨찾기 KML 저장 버튼 */}
        <button
          onClick={handleDownloadKml}
          disabled={kmlDownloading}
          title="배송지 전체를 KML로 저장 → 카카오맵 나만의 지도에 가져오기"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#FEE500]/10 border border-[#FEE500]/30 text-[#FEE500] hover:bg-[#FEE500]/20 active:scale-95 transition-all text-[10px] font-black shrink-0"
        >
          {kmlDownloading
            ? <RefreshCw size={11} className="animate-spin" />
            : <Star size={11} />}
          즐겨찾기
        </button>

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

      {/* ── 바디 ─────────────────────────────────────────────────────── */}
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

          {/* 지도 위 버튼들 */}
          <div className="absolute bottom-3 right-3 flex flex-col gap-2 z-10">
            {/* 내 위치로 버튼 */}
            <button
              onClick={centerOnMyLocation}
              disabled={gpsStatus !== 'ok'}
              className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg border transition-all ${
                gpsStatus === 'ok'
                  ? 'bg-[#0a0a0a] border-[#3b82f6]/50 text-[#3b82f6] hover:bg-[#1a2a3a] active:scale-95'
                  : 'bg-[#111] border-[#333] text-gray-600 cursor-not-allowed'
              }`}
              title="내 위치로 이동"
            >
              <Crosshair size={16} />
            </button>
          </div>

          {/* 선택된 배송지 카카오 내비 플로팅 버튼 */}
          {selectedRecord?.lat && selectedRecord?.lng && (layoutMode === 'map' || layoutMode === 'split') && (
            <div className="absolute bottom-3 left-3 z-10 flex gap-2">
              <button
                onClick={() => openKakaoNavi(selectedRecord)}
                className="flex items-center gap-2 px-3 py-2 rounded-full bg-[#FEE500] text-[#1a1a1a] font-black text-xs shadow-lg hover:brightness-95 active:scale-95 transition-all"
              >
                <Navigation size={13} />
                카카오 내비
              </button>
              <button
                onClick={() => openKakaoMap(selectedRecord)}
                className="flex items-center gap-2 px-3 py-2 rounded-full bg-[#0a0a0a] border border-[#333] text-gray-300 font-bold text-xs shadow-lg hover:bg-[#151515] active:scale-95 transition-all"
              >
                <MapPin size={12} />
                지도 열기
              </button>
            </div>
          )}
        </div>

        {/* split 구분선 */}
        {layoutMode === 'split' && (
          <div className="shrink-0 h-px bg-[#1a1a1a] relative flex items-center justify-center">
            {selectedRecord && (
              <div className="absolute bg-[#0f1a0f] border border-[#2a2a2a] rounded-full px-3 py-0.5 flex items-center gap-2 text-[10px] z-10">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: driverColor }} />
                <span className="font-black text-white">{selectedRecord.배송순번}번</span>
                <span className="text-gray-400">{selectedRecord.이름}</span>
                <span className="text-gray-600 max-w-[120px] truncate">{selectedRecord.주소}</span>
              </div>
            )}
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
                  isSelected ? 'bg-[#0d1e0d] border-[#1a3a1a]' : 'border-[#111] hover:bg-[#0f0f0f]'
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
                  <div className="text-gray-600 text-xs truncate">
                    {r.행정동 && `${r.행정동} · `}{r.주소}
                  </div>
                  {r.특이사항 && (
                    <div className="text-amber-700 text-[10px] truncate mt-0.5">⚠ {r.특이사항}</div>
                  )}
                </div>

                {/* 우측 액션 */}
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {/* ★ 즐겨찾기 버튼 — 탭 시 카카오맵 해당 위치 오픈 (앱에서 ★ 저장 가능) */}
                  {r.lat && r.lng && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStarRecord(r); }}
                      title="카카오맵에서 이 위치를 즐겨찾기에 추가"
                      className={`flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full transition-all active:scale-95 ${
                        starredIds.has(r._uid)
                          ? 'bg-[#FEE500]/20 text-[#FEE500] border border-[#FEE500]/50'
                          : 'bg-[#1a1a1a] border border-[#2a2a2a] text-gray-500 hover:text-[#FEE500] hover:border-[#FEE500]/40'
                      }`}
                    >
                      {starredIds.has(r._uid)
                        ? <><Check size={9} /> 저장됨</>
                        : <><Star size={9} /> 즐겨찾기</>}
                    </button>
                  )}
                  {r.lat && r.lng && isSelected && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openKakaoNavi(r); }}
                      className="flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full bg-[#FEE500] text-[#1a1a1a] hover:brightness-95 active:scale-95 transition-all"
                    >
                      <Navigation size={9} /> 내비
                    </button>
                  )}
                  {r.lat && r.lng && !isSelected && (
                    <div className="text-[9px] text-gray-700">탭하여 지도</div>
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

      {/* ── KML 가이드 모달 (다운로드 직후 표시) ──────────────────────── */}
      {showKmlGuide && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end justify-center p-4">
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-sm shadow-2xl pb-safe">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <BookMarked size={16} className="text-[#FEE500]" />
                <span className="text-white font-black text-sm">카카오맵 즐겨찾기 저장 방법</span>
              </div>
              <button onClick={() => setShowKmlGuide(false)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">

              {/* 방법 1: 즉시 즐겨찾기 */}
              <div className="bg-[#111] border border-[#FEE500]/20 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full bg-[#FEE500] text-[#1a1a1a] flex items-center justify-center text-[10px] font-black shrink-0">1</div>
                  <span className="text-[#FEE500] font-black text-xs">목록에서 즉시 즐겨찾기</span>
                </div>
                <p className="text-gray-400 text-[11px] leading-relaxed">
                  각 배송지 오른쪽 <span className="text-[#FEE500] font-bold">★ 즐겨찾기</span> 버튼을 탭하면 카카오맵에서 해당 위치가 열립니다.<br />
                  앱 상단의 <span className="bg-white/10 px-1 rounded text-white font-bold">저장</span> 버튼을 눌러 즐겨찾기에 추가하세요.
                </p>
              </div>

              {/* 방법 2: KML 가져오기 */}
              <div className="bg-[#111] border border-blue-500/20 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-black shrink-0">2</div>
                  <span className="text-blue-400 font-black text-xs">KML 파일로 전체 가져오기 (PC 권장)</span>
                </div>
                <ol className="text-gray-400 text-[11px] leading-loose space-y-0.5">
                  <li>① KML 파일이 다운로드됩니다 <span className="text-green-400 font-bold">✓</span></li>
                  <li>② 카카오맵 PC 버전 접속</li>
                  <li>③ 좌측 메뉴 → <span className="text-white font-bold">나만의 지도</span></li>
                  <li>④ <span className="text-white font-bold">지도 만들기</span> → 파일 가져오기</li>
                  <li>⑤ KML 파일 선택 → 전체 배송지 한번에 지도에 추가</li>
                </ol>
              </div>

              <p className="text-[10px] text-gray-700 text-center">나만의 지도는 카카오맵 앱에서도 확인할 수 있습니다</p>
            </div>
            <div className="px-5 pb-5">
              <button
                onClick={() => setShowKmlGuide(false)}
                className="w-full py-2.5 bg-[#FEE500] text-[#1a1a1a] font-black text-sm rounded-xl hover:brightness-95 active:scale-95 transition-all"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
