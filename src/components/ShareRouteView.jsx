import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../config/firebase.js';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { MapPin, List, Map as MapIcon, RefreshCw, Building2, Phone, ChevronUp, ChevronDown, Navigation, Crosshair, Star, X, AlertCircle, Share2, Save } from 'lucide-react';

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;

// ── 외부 지도 열기 함수들 ──────────────────────────────────────────────────
const openKakaoMapFavorite = (r) => {
  const name = encodeURIComponent((r.이름 || '배송지') + ' ' + (r.주소 || ''));
  window.open(`https://map.kakao.com/link/map/${name},${r.lat},${r.lng}`, '_blank');
};
const openKakaoNavi = (r) => {
  const name = encodeURIComponent(r.이름 || '배송지');
  const naviScheme = `kakaonavi://route?ep=${r.lng},${r.lat}&by=CAR&appkey=${KAKAO_JS_KEY}`;
  const webFallback = `https://map.kakao.com/link/to/${name},${r.lat},${r.lng}`;
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  iframe.src = naviScheme;
  setTimeout(() => { document.body.removeChild(iframe); if (!document.hidden) window.open(webFallback, '_blank'); }, 1000);
};

// ── GPS 허용 가이드 (기기별) ─────────────────────────────────────────────
function GpsGuideModal({ onClose }) {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isSamsung = /SamsungBrowser/i.test(ua);
  // 카카오톡·네이버·인스타 등 인앱 브라우저 감지
  const isInApp = /KAKAOTALK|NAVER|Instagram|Line|WhatsApp|FB|FBAN/i.test(ua);
  const [tab, setTab] = useState(0);

  // iOS
  const iosSteps = [
    { icon: 'AA', title: '주소창 왼쪽 AA 탭', desc: 'Safari 주소창 왼쪽의 AA 아이콘을 탭합니다.' },
    { icon: '📍', title: '"웹사이트 설정" → "위치"', desc: '"웹사이트 설정" 탭 후 "위치"를 탭합니다.' },
    { icon: '✅', title: '"방문 중 허용" 선택', desc: '"허용" 또는 "방문 중 허용"을 선택합니다.' },
    { icon: '🔄', title: '새로고침', desc: '아래 새로고침 버튼을 탭하면 GPS가 켜집니다.' },
  ];

  // 삼성 인터넷
  const samsungSteps = [
    { icon: '🔒', title: '주소창 자물쇠 탭', desc: '주소창 왼쪽 자물쇠 🔒 아이콘을 탭합니다.' },
    { icon: '⚙️', title: '"사이트 권한" 탭', desc: '팝업에서 "사이트 권한" 또는 "권한"을 탭합니다.' },
    { icon: '📍', title: '"위치" → 허용', desc: '"위치" 항목을 "허용"으로 변경합니다.' },
    { icon: '🔄', title: '새로고침', desc: '아래 버튼을 탭해 GPS를 활성화합니다.' },
  ];

  // Chrome — 방법 A: 주소창 / 방법 B: Chrome 사이트 설정
  const chromeTabA = [
    { icon: '🔒', title: '주소창 왼쪽 아이콘 탭', desc: '🔒 또는 ⚠️ 또는 ℹ 아이콘을 탭합니다.' },
    { icon: '⚙️', title: '"권한" 탭', desc: '팝업에서 "권한" 항목을 탭합니다.' },
    { icon: '📍', title: '"위치" → "허용"으로 변경', desc: '위치 옆에 "차단됨"이라고 뜨면 탭해서 "허용"으로 바꿉니다.' },
    { icon: '🔄', title: '새로고침', desc: '아래 버튼을 탭하면 파란 점이 뜹니다.' },
  ];
  const chromeTabB = [
    { icon: '⋮', title: 'Chrome 오른쪽 상단 ⋮ 탭', desc: 'Chrome 앱 오른쪽 상단 점 세 개(⋮) 메뉴를 탭합니다.' },
    { icon: '⚙️', title: '"설정" → "사이트 설정"', desc: '"개인 정보 보호 및 보안" → "사이트 설정"을 탭합니다.' },
    { icon: '📍', title: '"위치" → "차단됨" 목록', desc: '"위치"를 탭하면 차단된 사이트 목록이 보입니다.' },
    { icon: '✅', title: 'logis-op.web.app 탭 → 초기화', desc: '목록에서 이 사이트를 찾아 탭 후 "초기화" 또는 "허용"으로 변경합니다.' },
    { icon: '🔄', title: '이 페이지로 돌아와 새로고침', desc: '아래 새로고침 버튼을 탭하면 GPS가 켜집니다.' },
  ];

  const tabs = !isIOS && !isSamsung ? [
    { label: '방법 A (주소창)', steps: chromeTabA },
    { label: '방법 B (폰 설정)', steps: chromeTabB },
  ] : null;

  const steps = isIOS ? iosSteps : isSamsung ? samsungSteps : (tabs[tab].steps);

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-end justify-center p-4"
      style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      onClick={onClose}>
      <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[#1a1a1a]">
          <div>
            <div className="text-white font-black text-sm">📍 내 위치 켜는 방법</div>
            <div className="text-gray-600 text-[10px] mt-0.5">
              {isIOS ? 'iPhone · Safari' : isSamsung ? 'Android · 삼성 인터넷' : 'Android · Chrome'}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-600 hover:text-white">
            <X size={15} />
          </button>
        </div>

        {/* 인앱 브라우저 경고 */}
        {isInApp && (
          <div className="mx-5 mt-3 px-3 py-2 bg-yellow-900/30 border border-yellow-600/30 rounded-xl text-yellow-400 text-[11px]">
            ⚠️ 앱 내 브라우저에서는 위치 허용이 안 될 수 있어요. Chrome 또는 삼성 인터넷으로 열어주세요.
          </div>
        )}

        {/* Chrome 사용자 핵심 안내 */}
        {!isIOS && !isSamsung && !isInApp && (
          <div className="mx-5 mt-3 px-3 py-2 bg-blue-900/20 border border-blue-600/20 rounded-xl text-blue-300 text-[11px]">
            💡 폰 설정에서 Chrome 위치를 켜도 안 되는 경우, <b>이 사이트</b>가 Chrome 내에서 차단된 것입니다. 아래 방법으로 해제하세요.
          </div>
        )}

        {/* Chrome 탭 선택 */}
        {tabs && (
          <div className="flex gap-1 mx-5 mt-3">
            {tabs.map((t, i) => (
              <button key={i} onClick={() => setTab(i)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === i ? 'bg-blue-600 text-white' : 'bg-[#1a1a1a] text-gray-500 border border-[#2a2a2a]'}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="px-5 py-4 space-y-3">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-[#1a56db]/20 border border-[#1a56db]/30 flex items-center justify-center text-[11px] font-black shrink-0 text-blue-400">{s.icon}</div>
              <div>
                <div className="text-white font-bold text-xs">{s.title}</div>
                <div className="text-gray-500 text-[11px] mt-0.5">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={() => window.location.reload()}
            className="flex-1 py-3 bg-[#3b82f6] hover:bg-blue-700 text-white font-black text-sm rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2">
            <RefreshCw size={14} /> 새로고침
          </button>
          <button onClick={onClose}
            className="px-4 py-3 bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 font-bold text-sm rounded-xl active:scale-[0.98] transition-all">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShareRouteView({ shareId, driverId }) {
  const [shareData, setShareData]     = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [isMapReady, setIsMapReady]   = useState(false);
  const [selectedId, setSelectedId]   = useState(null);
  const [layoutMode, setLayoutMode]   = useState('split');
  const [starredIds, setStarredIds]   = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`starred_${shareId}_${driverId}`) || '[]')); }
    catch { return new Set(); }
  });
  const [myLocation, setMyLocation]   = useState(null);
  const [gpsStatus, setGpsStatus]     = useState('idle'); // idle|loading|ok|denied|error
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [gpsUpdatedAt, setGpsUpdatedAt] = useState(null);
  const [followMyLocation, setFollowMyLocation] = useState(true);
  const [isMapCreated, setIsMapCreated] = useState(false);
  const [showGpsGuide, setShowGpsGuide] = useState(false);
  const [copiedLink, setCopiedLink]   = useState(false);
  const [orderEditMode, setOrderEditMode] = useState(false);
  const [localOrderIds, setLocalOrderIds] = useState([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isRequestingOrderApply, setIsRequestingOrderApply] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.indexOf('kakaotalk') > -1 || ua.indexOf('naver') > -1 || ua.indexOf('line') > -1 || ua.indexOf('instagram') > -1 || ua.indexOf('fban') > -1;
  });

  // ── 카카오톡 인앱 브라우저 자동 탈출 ─────────────────────────────────────────
  useEffect(() => {
    if (isInAppBrowser && navigator.userAgent.toLowerCase().indexOf('kakaotalk') > -1) {
      window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(window.location.href);
    }
  }, [isInAppBrowser]);

  const mapRef          = useRef(null);
  const kakaoMapRef     = useRef(null);
  const overlaysRef     = useRef([]);
  const myLocOverlayRef = useRef(null);
  const watchIdRef      = useRef(null);
  const selectedIdRef   = useRef(null);
  const driverGpsOverlayRef = useRef(null);
  const latestLocRef    = useRef(null);
  const followMyLocationRef = useRef(true);
  const lastBoundsKeyRef = useRef('');
  const isMobile        = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  useEffect(() => {
    followMyLocationRef.current = followMyLocation;
  }, [followMyLocation]);

  // ── Firestore 실시간 로드 ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'route_shares', shareId), (snap) => {
      if (!snap.exists()) { setError('공유 데이터를 찾을 수 없거나 만료되었습니다.'); setLoading(false); return; }
      setShareData(snap.data());
      setLoading(false);
    }, (err) => {
      setError('데이터 로드 실패: ' + err.message);
      setLoading(false);
    });
    return () => unsub();
  }, [shareId]);

  // ── Kakao Maps SDK ──────────────────────────────────────────────────
  useEffect(() => {
    if (window.kakao?.maps?.Map) { setIsMapReady(true); return; }
    const existing = document.getElementById('kakao-map-sdk');
    if (existing) { existing.onload = () => window.kakao.maps.load(() => setIsMapReady(true)); return; }
    const script = document.createElement('script');
    script.id = 'kakao-map-sdk';
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao.maps.load(() => setIsMapReady(true));
    script.onerror = () => console.warn('Kakao Maps SDK load failed');
    document.head.appendChild(script);
  }, []);

  // ── GPS 추적 ────────────────────────────────────────────────────────
  const applyGpsPosition = useCallback((pos) => {
    const next = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
      updatedAt: Date.now(),
    };
    latestLocRef.current = next;
    setMyLocation(next);
    setGpsAccuracy(next.accuracy);
    setGpsUpdatedAt(next.updatedAt);
    setGpsStatus('ok');
  }, []);

  const handleGpsError = useCallback((err) => {
    if (latestLocRef.current && err?.code !== 1) {
      setGpsStatus('ok');
      return;
    }
    setGpsStatus(err?.code === 1 ? 'denied' : 'error');
  }, []);

  const startGps = useCallback(() => {
    if (!navigator.geolocation) { setGpsStatus('error'); return; }
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    setGpsStatus('loading');

    navigator.geolocation.getCurrentPosition(
      applyGpsPosition,
      handleGpsError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      applyGpsPosition,
      handleGpsError,
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 }
    );
  }, [applyGpsPosition, handleGpsError]);

  useEffect(() => {
    startGps();
    let cleanup;
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(perm => {
        // 설정 변경 시 (denied→granted 포함) 자동 재시도
        const handler = () => startGps();
        perm.addEventListener('change', handler);
        cleanup = () => perm.removeEventListener('change', handler);
      }).catch(() => {});
    }
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      cleanup?.();
    };
  }, []); // eslint-disable-line

  // ── 내 위치 최신화 (Firestore 방송용) ──────────────────────────────────
  useEffect(() => {
    latestLocRef.current = myLocation;
  }, [myLocation]);

  // watchPosition can be throttled by mobile browsers, so force a fresh point too.
  useEffect(() => {
    if (!navigator.geolocation || (gpsStatus !== 'ok' && gpsStatus !== 'loading')) return;
    const interval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        applyGpsPosition,
        (err) => {
          if (!latestLocRef.current) handleGpsError(err);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
      );
    }, 10000);
    return () => clearInterval(interval);
  }, [gpsStatus, applyGpsPosition, handleGpsError]);

  // ── 실시간 위치 Firestore 방송 (모바일만 자동) ──────────────────────────
  useEffect(() => {
    if (!isMobile) return;
    const interval = setInterval(() => {
      const loc = latestLocRef.current;
      if (loc && gpsStatus === 'ok') {
        updateDoc(doc(db, 'route_shares', shareId), {
          [`liveGps.${driverId}`]: {
            lat: loc.lat,
            lng: loc.lng,
            accuracy: loc.accuracy ?? null,
            updatedAt: new Date().toISOString()
          }
        }).catch(e => console.warn('GPS Upload error:', e));
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [shareId, driverId, gpsStatus, isMobile]);

  // ── 기사 실시간 위치 (Firestore) 마커 표시 ─────────────────────────────
  useEffect(() => {
    if (!isMapCreated || !kakaoMapRef.current || !shareData) return;
    
    const driverLive = shareData.liveGps?.[driverId];
    if (driverLive && driverLive.lat && driverLive.lng) {
      const latlng = new window.kakao.maps.LatLng(driverLive.lat, driverLive.lng);
      if (driverGpsOverlayRef.current) {
        driverGpsOverlayRef.current.setPosition(latlng);
      } else {
        const content = `
          <style>
            @keyframes truck-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
            .driver-marker {
              position: relative;
              width: 50px; height: 50px;
              display: flex; align-items: center; justify-content: center;
              animation: truck-bounce 1.5s ease-in-out infinite;
            }
            .driver-marker-bg {
              position: absolute; inset: 5px;
              background: #10b981; border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            }
            .driver-marker-icon {
              position: relative; z-index: 10; font-size: 22px;
            }
            .driver-marker-pulse {
              position: absolute; inset: -5px;
              border-radius: 50%; background: rgba(16, 185, 129, 0.4);
              animation: gps-pulse 2s ease-out infinite;
              z-index: -1;
            }
          </style>
          <div class="driver-marker" title="기사 실시간 위치">
            <div class="driver-marker-pulse"></div>
            <div class="driver-marker-bg"></div>
            <div class="driver-marker-icon">🚚</div>
          </div>
        `;
        driverGpsOverlayRef.current = new window.kakao.maps.CustomOverlay({
          position: latlng, content, yAnchor: 0.8, xAnchor: 0.5, zIndex: 300,
        });
        driverGpsOverlayRef.current.setMap(kakaoMapRef.current);
      }
    }
  }, [isMapCreated, shareData?.liveGps, driverId]);

  // ── GPS 마커 실시간 업데이트 ─────────────────────────────────────────
  useEffect(() => {
    if (!isMapCreated || !kakaoMapRef.current || !myLocation) return;
    const latlng = new window.kakao.maps.LatLng(myLocation.lat, myLocation.lng);
    if (myLocOverlayRef.current) {
      myLocOverlayRef.current.setPosition(latlng);
    } else {
      const content = `
        <style>@keyframes gps-pulse{0%{transform:scale(1);opacity:0.8;}70%{transform:scale(2.8);opacity:0;}100%{transform:scale(2.8);opacity:0;}}</style>
        <div style="position:relative;width:24px;height:24px;">
          <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.3);animation:gps-pulse 2s ease-out infinite;"></div>
          <div style="position:absolute;inset:5px;border-radius:50%;background:#3b82f6;border:2.5px solid white;box-shadow:0 0 0 1px rgba(59,130,246,0.5),0 2px 8px rgba(0,0,0,0.4);"></div>
        </div>`;
      myLocOverlayRef.current = new window.kakao.maps.CustomOverlay({
        position: latlng, content, yAnchor: 0.5, xAnchor: 0.5, zIndex: 200,
      });
      myLocOverlayRef.current.setMap(kakaoMapRef.current);
    }
    if (followMyLocationRef.current) {
      kakaoMapRef.current.panTo(latlng);
      if (kakaoMapRef.current.getLevel() > 4) kakaoMapRef.current.setLevel(4);
    }
  }, [isMapCreated, myLocation]);

  // ── 파생 데이터 ──────────────────────────────────────────────────────
  const driver = shareData?.drivers?.find(d => d.id === driverId) || shareData?.drivers?.[0];
  const baseRecords = (shareData?.records || [])
    .filter(r => r.driverId === driver?.id)
    .map((r, i) => ({ ...r, _uid: r.id || `${r.이름}_${r.배송순번 || i}` }));
  const remoteOrderIds = Array.isArray(shareData?.driverOrder?.[driver?.id]) ? shareData.driverOrder[driver.id] : [];
  const activeOrderIds = localOrderIds.length ? localOrderIds : remoteOrderIds;
  const orderIndex = new Map(activeOrderIds.map((id, i) => [id, i]));
  const allRecords = baseRecords
    .sort((a, b) => {
      const ai = orderIndex.has(a._uid) ? orderIndex.get(a._uid) : 100000 + (parseInt(a.배송순번) || 9999);
      const bi = orderIndex.has(b._uid) ? orderIndex.get(b._uid) : 100000 + (parseInt(b.배송순번) || 9999);
      return ai - bi;
    })
    .map((r, i) => ({ ...r, _displaySeq: i + 1 }));
  const mapRecords = allRecords.filter(r => r.lat && r.lng);

  useEffect(() => {
    if (!driver?.id) return;
    const remote = Array.isArray(shareData?.driverOrder?.[driver.id]) ? shareData.driverOrder[driver.id] : null;
    if (remote?.length) {
      setLocalOrderIds(remote);
      try { localStorage.setItem(`route_order_${shareId}_${driver.id}`, JSON.stringify(remote)); } catch {}
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(`route_order_${shareId}_${driver.id}`) || '[]');
      if (Array.isArray(saved) && saved.length) setLocalOrderIds(saved);
    } catch {}
  }, [shareData?.driverOrder, driver?.id, shareId]);

  // ── 즐겨찾기 ────────────────────────────────────────────────────────
  const handleStarRecord = useCallback((r) => {
    setStarredIds(prev => {
      const next = new Set(prev);
      if (next.has(r._uid)) { next.delete(r._uid); }
      else { next.add(r._uid); if (r.lat && r.lng) openKakaoMapFavorite(r); }
      try { localStorage.setItem(`starred_${shareId}_${driverId}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [shareId, driverId]);

  const moveRecordOrder = useCallback(async (uid, delta) => {
    if (!driver?.id || isSavingOrder) return;
    const ids = allRecords.map(r => r._uid);
    const idx = ids.indexOf(uid);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= ids.length) return;
    [ids[idx], ids[nextIdx]] = [ids[nextIdx], ids[idx]];
    setLocalOrderIds(ids);
    try { localStorage.setItem(`route_order_${shareId}_${driver.id}`, JSON.stringify(ids)); } catch {}
    setIsSavingOrder(true);
    try {
      await updateDoc(doc(db, 'route_shares', shareId), {
        [`driverOrder.${driver.id}`]: ids,
      });
    } catch (e) {
      console.warn('Order save error:', e);
    } finally {
      setIsSavingOrder(false);
    }
  }, [allRecords, driver?.id, isSavingOrder, shareId]);

  const requestOrderApply = useCallback(async () => {
    if (!driver?.id || isRequestingOrderApply) return;
    const ids = allRecords.map(r => r._uid);
    if (!ids.length) return;
    setLocalOrderIds(ids);
    try { localStorage.setItem(`route_order_${shareId}_${driver.id}`, JSON.stringify(ids)); } catch {}
    setIsRequestingOrderApply(true);
    try {
      await updateDoc(doc(db, 'route_shares', shareId), {
        [`driverOrder.${driver.id}`]: ids,
        [`orderApplyRequests.${driver.id}`]: {
          status: 'requested',
          requestedAt: new Date().toISOString(),
          orderIds: ids,
          count: ids.length,
        },
      });
    } catch (e) {
      console.warn('Order apply request error:', e);
    } finally {
      setIsRequestingOrderApply(false);
    }
  }, [allRecords, driver?.id, isRequestingOrderApply, shareId]);

  // ── 링크 복사 ────────────────────────────────────────────────────────
  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // clipboard API 미지원 → share 시도
      if (navigator.share) {
        navigator.share({ title: `${driver?.name || '기사'} 배송루트`, url: window.location.href }).catch(() => {});
      }
    }
  }, [driver]);

  // ── 핀 클릭 → 목록 이동 ──────────────────────────────────────────────
  useEffect(() => {
    window._shareSelectRecord = (uid) => {
      selectedIdRef.current = uid;
      setSelectedId(uid);
      setLayoutMode(prev => prev === 'map' ? 'split' : prev);
    };
    return () => { delete window._shareSelectRecord; };
  }, []);

  useEffect(() => {
    if (!selectedId || layoutMode === 'map') return;
    const t = setTimeout(() => {
      document.getElementById(`share-rec-${selectedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(t);
  }, [selectedId, layoutMode]);

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

  const centerOnMyLocation = useCallback(() => {
    if (!myLocation || !kakaoMapRef.current) return;
    setFollowMyLocation(true);
    kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(myLocation.lat, myLocation.lng));
    kakaoMapRef.current.setLevel(4);
  }, [myLocation]);

  // ── 지도 초기화 + 마커 ───────────────────────────────────────────────
  useEffect(() => {
    if (!isMapReady || !shareData || !mapRef.current || !driver) return;
    if (!kakaoMapRef.current) {
      kakaoMapRef.current = new window.kakao.maps.Map(mapRef.current, {
        center: new window.kakao.maps.LatLng(37.5665, 126.9780), level: 7,
      });
      setIsMapCreated(true);
    }
    overlaysRef.current.forEach(o => { try { o.setMap(null); } catch {} });
    overlaysRef.current = [];
    if (!mapRecords.length) return;
    const driverColor = driver.color || '#3b82f6';
    if (mapRecords.length > 1) {
      const polyline = new window.kakao.maps.Polyline({
        path: mapRecords.map(r => new window.kakao.maps.LatLng(r.lat, r.lng)),
        strokeWeight: 2, strokeColor: driverColor, strokeOpacity: 0.5, strokeStyle: 'solid',
      });
      polyline.setMap(kakaoMapRef.current);
      overlaysRef.current.push(polyline);
    }
    mapRecords.forEach((r) => {
      const isSelected = r._uid === selectedId;
      const bg = isSelected ? '#fff' : driverColor;
      const fg = isSelected ? driverColor : '#fff';
      const size = isSelected ? 30 : 22;
      const shadow = isSelected ? `0 0 0 3px ${driverColor}, 0 4px 12px rgba(0,0,0,0.7)` : '0 2px 6px rgba(0,0,0,0.5)';
      const content = `
        <div onclick="window._shareSelectRecord('${r._uid}')"
          style="display:flex;align-items:center;justify-content:center;
            width:${size}px;height:${size}px;border-radius:50%;
            background:${bg};border:2px solid ${isSelected ? driverColor : 'white'};
            box-shadow:${shadow};cursor:pointer;
            font-size:${isSelected ? 11 : 9}px;font-weight:900;color:${fg};
            transition:all 0.2s;"
          title="${r.이름} | ${r.주소}">${r._displaySeq || r.배송순번 || '?'}</div>`;
      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(r.lat, r.lng),
        content, yAnchor: 0.5, xAnchor: 0.5, zIndex: isSelected ? 99 : 1,
      });
      overlay.setMap(kakaoMapRef.current);
      overlaysRef.current.push(overlay);
    });
    const firstRecord = mapRecords[0];
    const lastRecord = mapRecords[mapRecords.length - 1];
    const boundsKey = `${driver?.id || ''}:${mapRecords.length}:${firstRecord?._uid || ''}:${lastRecord?._uid || ''}:${firstRecord?.lat || ''}:${lastRecord?.lng || ''}`;
    if (!selectedId && lastBoundsKeyRef.current !== boundsKey) {
      const bounds = new window.kakao.maps.LatLngBounds();
      mapRecords.forEach(r => bounds.extend(new window.kakao.maps.LatLng(r.lat, r.lng)));
      kakaoMapRef.current.setBounds(bounds, 50, 50, 50, 50);
      lastBoundsKeyRef.current = boundsKey;
    }
  }, [isMapReady, shareData, driverId, selectedId]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => kakaoMapRef.current?.relayout(), 200);
    return () => clearTimeout(t);
  }, [layoutMode]);

  // ── 인앱 브라우저 차단 UI ──────────────────────────────────────────────
  if (isInAppBrowser) {
    const isKakao = navigator.userAgent.toLowerCase().indexOf('kakaotalk') > -1;
    return (
      <div className="fixed inset-0 bg-[#050505] flex flex-col items-center justify-center p-6 z-50 font-sans">
        <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mb-6">
          <AlertCircle size={32} className="text-yellow-500" />
        </div>
        <h2 className="text-white text-xl font-black mb-3 text-center">
          {isKakao ? '카카오톡 브라우저 감지됨' : '앱 내 브라우저 감지됨'}
        </h2>
        <p className="text-gray-400 text-center text-sm mb-8 leading-relaxed">
          현재 화면에서는 <strong className="text-blue-400">GPS(실시간 위치) 기능이 차단</strong>됩니다.<br/><br/>
          원활한 배송과 실시간 위치 공유를 위해<br/>
          반드시 <strong className="text-white">크롬, 사파리, 삼성인터넷</strong> 등<br/>
          기본 브라우저로 접속해주세요.
        </p>

        {isKakao && (
          <button 
            onClick={() => { window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(window.location.href); }}
            className="w-full max-w-xs py-4 bg-[#FEE500] hover:bg-[#FEE500]/90 text-black font-black rounded-xl shadow-lg mb-4 transition-all active:scale-95">
            기본 브라우저로 열기 (추천)
          </button>
        )}

        <div className="w-full max-w-xs bg-[#1a1a1a] rounded-xl p-4 border border-[#2a2a2a]">
          <div className="text-gray-400 text-xs mb-2 font-bold">수동으로 여는 방법:</div>
          <ol className="text-gray-500 text-[11px] space-y-2">
            <li>1. 화면 하단(또는 우측 상단)의 <strong>[⋮]</strong> 버튼 누르기</li>
            <li>2. <strong>[다른 브라우저로 열기]</strong> 선택</li>
          </ol>
        </div>

        <button 
          onClick={() => setIsInAppBrowser(false)}
          className="mt-8 text-gray-600 text-xs underline underline-offset-4 hover:text-gray-400 p-2">
          GPS 없이 그냥 보기 (관리자용)
        </button>
      </div>
    );
  }

  // ── 로딩 / 에러 ──────────────────────────────────────────────────────
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
  const driverLive = shareData?.liveGps?.[driverId];
  const isLiveActive = driverLive && (Date.now() - new Date(driverLive.updatedAt).getTime() < 120000);
  const gpsAgeSec = gpsUpdatedAt ? Math.max(0, Math.round((Date.now() - gpsUpdatedAt) / 1000)) : null;
  const gpsAgeLabel = gpsAgeSec == null ? '' : gpsAgeSec < 60 ? `${gpsAgeSec}s ago` : `${Math.floor(gpsAgeSec / 60)}m ago`;
  const orderApplyRequest = driver?.id ? shareData?.orderApplyRequests?.[driver.id] : null;
  const isOrderApplyRequested = orderApplyRequest?.status === 'requested';
  const nextRecord = selectedRecord || allRecords[0];

  return (
    <div className="fixed inset-0 bg-[#050505] flex flex-col" style={{ fontFamily: 'inherit' }}>

      {/* ── GPS 가이드 모달 ───────────────────────────────────────────── */}
      {showGpsGuide && <GpsGuideModal onClose={() => setShowGpsGuide(false)} />}

      {/* ── 헤더 ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-[#070707]/98 border-b border-[#1b1b1b] px-2.5 py-1.5 flex items-center gap-1.5 overflow-x-auto">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: driverColor }} />
        <div className="flex-1 min-w-0">
          <div className="text-white font-black text-[13px] truncate">{driver?.name || '기사'}</div>
          <div className="text-gray-600 text-[10px] flex flex-nowrap items-center gap-1.5 mt-0.5 overflow-hidden">
            <span className="text-white font-bold">{allRecords.length}건</span>
            <span className="text-blue-400 font-bold">{totalQty}포</span>
            
            {gpsStatus === 'ok'      && <span className="text-green-500 ml-1">● GPS</span>}
            {gpsStatus === 'loading' && <span className="text-yellow-500 ml-1">◌ GPS...</span>}
            {gpsStatus === 'denied'  && <button onClick={() => setShowGpsGuide(true)} className="text-orange-400 underline underline-offset-2 ml-1">⊘ 위치허용?</button>}
            {gpsStatus === 'error'   && <span className="text-red-500 ml-1">✕ GPS오류</span>}

            {isLiveActive && (
              <span className="text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded-full flex items-center gap-1 ml-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                LIVE
              </span>
            )}
          </div>
          {nextRecord && (
            <div className="mt-0.5 text-[10px] text-gray-500 truncate">
              다음 {nextRecord._displaySeq || nextRecord.배송순번 || 1}번 · <span className="text-gray-300 font-bold">{nextRecord.이름}</span> · {nextRecord.주소}
            </div>
          )}
        </div>

        {/* 링크 복사 버튼 */}
        <button
          onClick={handleCopyLink}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black shrink-0 transition-all active:scale-95 border ${
            copiedLink
              ? 'bg-green-500/20 border-green-500/40 text-green-400'
              : 'bg-[#1a1a1a] border-[#2a2a2a] text-gray-400 hover:text-white'
          }`}
        >
          <Share2 size={11} /> {copiedLink ? '복사됨!' : '공유'}
        </button>

        {/* 레이아웃 토글 */}
        <button
          onClick={() => setOrderEditMode(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black shrink-0 transition-all active:scale-95 border ${
            orderEditMode
              ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
              : 'bg-[#1a1a1a] border-[#2a2a2a] text-gray-400 hover:text-white'
          }`}
        >
          <ChevronUp size={10} /> 순번
        </button>

        <button
          onClick={requestOrderApply}
          disabled={isRequestingOrderApply || !allRecords.length}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black shrink-0 transition-all active:scale-95 border disabled:opacity-50 ${
            isOrderApplyRequested
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
              : 'bg-[#1a1a1a] border-[#2a2a2a] text-gray-400 hover:text-white'
          }`}
          title="현재 순번을 담당자에게 공식 반영 요청"
        >
          <Save size={10} /> {isOrderApplyRequested ? '요청됨' : '반영요청'}
        </button>

        <div className="flex rounded-lg overflow-hidden border border-[#2a2a2a] shrink-0">
          {[
            ['map',   <MapIcon size={11} key="map" />],
            ['split', <span key="split" className="flex"><ChevronDown size={10}/><ChevronUp size={10}/></span>],
            ['list',  <List size={11} key="list" />],
          ].map(([mode, icon]) => (
            <button key={mode} onClick={() => setLayoutMode(mode)}
              className={`px-2.5 py-1.5 flex items-center gap-1 transition-colors ${mode !== 'map' ? 'border-l border-[#2a2a2a]' : ''} ${layoutMode === mode ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500'}`}>
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* ── 바디 ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* 지도 영역 */}
        <div className={`relative flex flex-col transition-all ${
          layoutMode === 'map' ? 'flex-1' : layoutMode === 'split' ? 'h-[74%] shrink-0' : 'h-0 overflow-hidden'
        }`}>
          {!isMapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#080808] z-10">
              <RefreshCw size={20} className="text-[#3b82f6] animate-spin" />
            </div>
          )}
          <div ref={mapRef} className="flex-1 w-full h-full" />

          {gpsStatus === 'ok' && layoutMode !== 'list' && (
            <div className="absolute top-3 left-3 z-10 bg-[#050505]/90 border border-blue-500/30 rounded-full px-3 py-1.5 shadow-lg flex items-center gap-2 text-[10px] font-black text-blue-200">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-70"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              <span>내 위치</span>
              {gpsAccuracy != null && <span className="text-blue-400">±{gpsAccuracy}m</span>}
              {gpsAgeLabel && <span className="text-gray-500">{gpsAgeLabel}</span>}
              <span className={followMyLocation ? 'text-emerald-400' : 'text-gray-500'}>
                {followMyLocation ? '따라가기' : '고정'}
              </span>
            </div>
          )}

          {/* GPS 거부 배너 */}
          {(gpsStatus === 'denied' || gpsStatus === 'error') && layoutMode !== 'list' && (
            <div className="absolute bottom-16 left-3 right-3 z-20 bg-[#0d0d0d]/97 border border-orange-800/40 rounded-2xl p-3.5 shadow-2xl">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={15} className="text-orange-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-white font-black text-xs mb-1">
                    {gpsStatus === 'denied' ? '위치 권한이 거부되어 있습니다' : 'GPS 신호가 없습니다'}
                  </div>
                  {gpsStatus === 'denied' ? (
                    <button
                      onClick={() => setShowGpsGuide(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 border border-orange-500/40 text-orange-300 text-[11px] font-black rounded-xl active:scale-95 transition-all">
                      📍 위치 허용 방법 보기
                    </button>
                  ) : (
                    <button onClick={startGps}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 border border-orange-500/40 text-orange-400 text-[11px] font-black rounded-xl active:scale-95 transition-all">
                      <Crosshair size={11} /> 위치 다시 요청
                    </button>
                  )}
                </div>
                <button onClick={() => setGpsStatus('idle')} className="text-gray-700 hover:text-gray-400 p-0.5">
                  <X size={13} />
                </button>
              </div>
            </div>
          )}

          {/* GPS 버튼 */}
          <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
            {gpsStatus === 'ok' && (
              <button
                onClick={() => setFollowMyLocation(v => !v)}
                className={`h-9 px-3 rounded-full flex items-center gap-1.5 shadow-lg border text-[10px] font-black transition-all active:scale-95 ${
                  followMyLocation
                    ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300'
                    : 'bg-[#0a0a0a] border-[#333] text-gray-400'
                }`}
                title={followMyLocation ? '내 위치 따라가기 끄기' : '내 위치 따라가기 켜기'}
              >
                <Navigation size={13} />
                {followMyLocation ? '따라가기' : '고정'}
              </button>
            )}
            <button
              onClick={() => {
                if (gpsStatus === 'ok') centerOnMyLocation();
                else if (gpsStatus === 'denied') setShowGpsGuide(true);
                else startGps();
              }}
              className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg border transition-all active:scale-95 ${
                gpsStatus === 'ok'      ? 'bg-[#0a0a0a] border-[#3b82f6]/50 text-[#3b82f6] hover:bg-[#1a2a3a]'
                : gpsStatus === 'loading' ? 'bg-[#111] border-[#444] text-yellow-500'
                : 'bg-[#111] border-orange-800/40 text-orange-500 hover:bg-orange-900/20'
              }`}
              title={gpsStatus === 'ok' ? '내 위치로 이동' : '위치 허용 방법'}
            >
              <Crosshair size={16} className={gpsStatus === 'loading' ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* 선택 배송지 플로팅 내비 */}
          {selectedRecord?.lat && selectedRecord?.lng && layoutMode !== 'list' && (
            <div className="absolute bottom-3 left-3 z-10 flex gap-1.5">
              <button onClick={() => openKakaoNavi(selectedRecord)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#FEE500] text-[#1a1a1a] font-black text-xs shadow-lg hover:brightness-95 active:scale-95 transition-all">
                <Navigation size={12} /> 카카오
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
                <span className="font-black text-white">{selectedRecord._displaySeq || selectedRecord.배송순번}번</span>
                <span className="text-gray-400">{selectedRecord.이름}</span>
                <span className="text-gray-600 max-w-[100px] truncate">{selectedRecord.주소}</span>
              </div>
            )}
          </div>
        )}

        {/* 목록 영역 */}
        <div className={`bg-[#060606] overflow-y-auto transition-all ${
          layoutMode === 'list' ? 'flex-1' : layoutMode === 'split' ? 'flex-1 min-h-0' : 'h-0 overflow-hidden'
        }`}>
          <div className="sticky top-0 bg-[#0a0a0a] border-b border-[#1a1a1a] px-4 py-1.5 flex items-center gap-2 z-10">
            <MapPin size={10} className="text-gray-600" />
            <span className="text-[9px] text-gray-600 font-black tracking-widest uppercase">배송 순번 목록</span>
            <span className="ml-auto text-[9px] text-gray-700">{allRecords.length}건</span>
          </div>

          {allRecords.map((r, idx) => {
            const isSelected = r._uid === selectedId;
            const qty = parseInt(r.포수) || 1;
            const isMultiQty = qty > 1;
            return (
              <div key={r._uid} id={`share-rec-${r._uid}`} onClick={() => handleRecordClick(r)}
                className={`flex items-center gap-2 px-3 py-2 border-b cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#0d1e0d] border-[#1a3a1a]'
                    : isMultiQty
                      ? 'bg-amber-950/10 border-amber-500/20 hover:bg-amber-950/20'
                      : 'border-[#111] hover:bg-[#0f0f0f]'
                }`}
              >
                {orderEditMode && (
                  <div className="shrink-0 flex flex-col gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveRecordOrder(r._uid, -1); }}
                      disabled={idx === 0 || isSavingOrder}
                      className="w-7 h-6 rounded-lg border border-[#2a2a2a] bg-[#111] text-gray-400 disabled:opacity-25 active:scale-95 flex items-center justify-center"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveRecordOrder(r._uid, 1); }}
                      disabled={idx === allRecords.length - 1 || isSavingOrder}
                      className="w-7 h-6 rounded-lg border border-[#2a2a2a] bg-[#111] text-gray-400 disabled:opacity-25 active:scale-95 flex items-center justify-center"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                )}
                <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center font-black text-[11px]"
                  style={{
                    background: isSelected ? driverColor : `${driverColor}22`,
                    color: isSelected ? '#fff' : driverColor,
                    border: `2px solid ${isSelected ? driverColor : `${driverColor}44`}`,
                    boxShadow: isSelected ? `0 0 10px ${driverColor}60` : 'none',
                  }}>
                  {r._displaySeq || r.배송순번 || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`font-bold text-xs ${isSelected ? 'text-white' : 'text-gray-200'}`}>{r.이름}</span>
                    {isMultiQty && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-amber-500/20 text-amber-300 border border-amber-400/35 shadow-[0_0_10px_rgba(245,158,11,0.18)]">
                        {qty}포
                      </span>
                    )}
                    {r.isApt && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-orange-900/30 text-orange-600 rounded-full font-bold">
                        <Building2 size={8} className="inline" /> 아파트
                      </span>
                    )}
                  </div>
                  <div className="text-gray-600 text-[11px] truncate">{r.행정동 && `${r.행정동} · `}{r.주소}</div>
                  {r.특이사항 && <div className="text-amber-700 text-[10px] truncate mt-0.5">⚠ {r.특이사항}</div>}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {/* 카카오 내비 */}
                  {r.lat && r.lng && isSelected && (
                    <button onClick={(e) => { e.stopPropagation(); openKakaoNavi(r); }}
                      className="flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full bg-[#FEE500] text-[#1a1a1a] hover:brightness-95 active:scale-95 transition-all">
                      <Navigation size={9} /> 카카오
                    </button>
                  )}
                  {/* 카카오맵 즐겨찾기 */}
                  {r.lat && r.lng && (
                    <button onClick={(e) => { e.stopPropagation(); handleStarRecord(r); }}
                      className={`flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full transition-all active:scale-95 ${
                        starredIds.has(r._uid)
                          ? 'bg-[#FEE500] text-[#1a1a1a]'
                          : 'bg-[#1a1a1a] border border-[#2a2a2a] text-gray-500 hover:text-[#FEE500] hover:border-[#FEE500]/40'
                      }`}>
                      <Star size={9} className={starredIds.has(r._uid) ? 'fill-[#1a1a1a]' : ''} />
                      {starredIds.has(r._uid) ? '★' : '☆'}
                    </button>
                  )}
                  {!isSelected && r.lat && r.lng && <div className="text-[9px] text-gray-700">탭하여 지도</div>}
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
            <div className="flex items-center justify-center h-32 text-gray-700 text-sm">배송 데이터가 없습니다</div>
          )}
        </div>
      </div>
    </div>
  );
}
