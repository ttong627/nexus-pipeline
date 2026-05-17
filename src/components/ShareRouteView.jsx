import React, { useState, useEffect, useRef } from 'react';
import { db } from '../config/firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import { MapPin, List, Map, RefreshCw, Building2 } from 'lucide-react';

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;

const parseAptDong = (addr) => { const m = addr?.match(/(\d+)\s*동/); return m ? parseInt(m[1]) : null; };
const parseFloorHo = (addr) => {
  const floor = addr?.match(/(\d+)\s*층/)?.[1] || '0';
  const ho = addr?.match(/(\d+)\s*호/)?.[1] || '0';
  return { floor: parseInt(floor), ho: parseInt(ho) };
};

export default function ShareRouteView({ shareId, driverId }) {
  const [shareData, setShareData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [activeView, setActiveView] = useState('map');
  const mapRef = useRef(null);
  const kakaoMapRef = useRef(null);
  const overlaysRef = useRef([]);

  // Firestore에서 공유 데이터 로드
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

  // Kakao Maps SDK 로딩
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

  // 지도 초기화 + 마커 렌더링
  useEffect(() => {
    if (!isMapReady || !shareData || !mapRef.current) return;

    const driver = shareData.drivers?.find(d => d.id === driverId) || shareData.drivers?.[0];
    if (!driver) return;

    const myRecords = (shareData.records || [])
      .filter(r => r.driverId === driver.id && r.lat && r.lng && !r.isApt)
      .sort((a, b) => (a.배송순번 || 0) - (b.배송순번 || 0));

    if (!kakaoMapRef.current) {
      kakaoMapRef.current = new window.kakao.maps.Map(mapRef.current, {
        center: new window.kakao.maps.LatLng(37.5665, 126.9780),
        level: 7,
      });
    }

    overlaysRef.current.forEach(o => o.setMap(null));
    overlaysRef.current = [];

    if (!myRecords.length) return;

    myRecords.forEach((r, idx) => {
      const seq = r.배송순번 || (idx + 1);
      const content = `
        <div style="display:flex;align-items:center;justify-content:center;
          width:22px;height:22px;border-radius:50%;background:${driver.color || '#3b82f6'};
          border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.5);cursor:pointer;
          font-size:9px;font-weight:900;color:white;line-height:1;"
          title="${r.이름} | ${r.주소}">${seq}</div>`;
      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(r.lat, r.lng),
        content, yAnchor: 0.5, xAnchor: 0.5, zIndex: 1,
      });
      overlay.setMap(kakaoMapRef.current);
      overlaysRef.current.push(overlay);
    });

    if (myRecords.length > 1) {
      const polyline = new window.kakao.maps.Polyline({
        path: myRecords.map(r => new window.kakao.maps.LatLng(r.lat, r.lng)),
        strokeWeight: 2, strokeColor: driver.color || '#3b82f6',
        strokeOpacity: 0.6, strokeStyle: 'solid',
      });
      polyline.setMap(kakaoMapRef.current);
      overlaysRef.current.push(polyline);
    }

    const bounds = new window.kakao.maps.LatLngBounds();
    myRecords.forEach(r => bounds.extend(new window.kakao.maps.LatLng(r.lat, r.lng)));
    kakaoMapRef.current.setBounds(bounds, 50, 50, 50, 50);
  }, [isMapReady, shareData, driverId]);

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

  const driver = shareData.drivers?.find(d => d.id === driverId) || shareData.drivers?.[0];
  const allRecords = (shareData.records || []).filter(r => r.driverId === driver?.id);
  const mapRecords = allRecords.filter(r => r.lat && r.lng && !r.isApt)
    .sort((a, b) => (a.배송순번 || 0) - (b.배송순번 || 0));
  const aptRecords = allRecords.filter(r => r.isApt)
    .sort((a, b) => {
      const dA = parseAptDong(a.주소) ?? 999, dB = parseAptDong(b.주소) ?? 999;
      if (dA !== dB) return dA - dB;
      const { floor: fA, ho: hA } = parseFloorHo(a.주소);
      const { floor: fB, ho: hB } = parseFloorHo(b.주소);
      return fA !== fB ? fA - fB : hA - hB;
    });

  return (
    <div className="fixed inset-0 bg-[#050505] flex flex-col" style={{ fontFamily: 'inherit' }}>
      {/* 헤더 */}
      <div className="shrink-0 bg-[#0a0a0a] border-b border-[#222] px-4 py-3 flex items-center gap-3">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: driver?.color || '#3b82f6' }} />
        <div>
          <div className="text-white font-black text-sm">{driver?.name || '기사'} 배송 루트</div>
          <div className="text-gray-600 text-[10px]">
            {shareData.city} {shareData.month} | 총 {allRecords.length}건
            {aptRecords.length > 0 && <span className="text-orange-600 ml-2">아파트 {aptRecords.length}건 포함</span>}
          </div>
        </div>
        <div className="ml-auto flex rounded-lg overflow-hidden border border-[#2a2a2a]">
          <button onClick={() => setActiveView('map')}
            className={`px-3 py-1.5 text-xs font-bold flex items-center gap-1 transition-colors ${activeView === 'map' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500'}`}>
            <Map size={12} /> 지도
          </button>
          <button onClick={() => setActiveView('list')}
            className={`px-3 py-1.5 text-xs font-bold flex items-center gap-1 transition-colors ${activeView === 'list' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500'}`}>
            <List size={12} /> 목록
          </button>
        </div>
      </div>

      {/* 지도 뷰 */}
      <div className={`flex-1 relative flex flex-col ${activeView !== 'map' ? 'hidden' : ''}`}>
        {!isMapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#080808] z-10">
            <RefreshCw size={20} className="text-[#3b82f6] animate-spin" />
          </div>
        )}
        <div ref={mapRef} className="flex-1" />

        {aptRecords.length > 0 && (
          <div className="shrink-0 border-t border-[#1a1a1a] bg-[#070707]" style={{ maxHeight: '180px' }}>
            <div className="px-4 py-2 text-[9px] text-orange-700 font-black tracking-widest">
              <Building2 size={9} className="inline mr-1" />아파트 ({aptRecords.length}건) — 동호수 정렬
            </div>
            <div className="overflow-auto" style={{ maxHeight: '140px' }}>
              {aptRecords.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-1.5 border-b border-[#0f0f0f] hover:bg-[#0f0905]">
                  <span className="text-orange-800 font-black text-[10px] w-6 shrink-0">{r.배송순번 || (i + 1)}</span>
                  <span className="text-white text-xs font-bold w-16 shrink-0">{r.이름}</span>
                  <span className="text-orange-900 text-[10px] flex-1 truncate">{r.주소}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 목록 뷰 */}
      {activeView === 'list' && (
        <div className="flex-1 overflow-auto bg-[#060606]">
          {mapRecords.map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[#111] hover:bg-[#0f0f0f]">
              <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white font-black text-xs"
                style={{ background: driver?.color || '#3b82f6' }}>
                {r.배송순번 || (i + 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-bold text-sm">{r.이름}</div>
                <div className="text-gray-500 text-xs truncate">{r.행정동} | {r.주소}</div>
              </div>
              <a href={`https://map.kakao.com/link/to/${encodeURIComponent(r.이름 + ' ' + (r.행정동 || ''))},${r.lat},${r.lng}`}
                target="_blank" rel="noopener noreferrer"
                className="shrink-0 px-2 py-1 bg-[#1a2a1a] text-[#3b82f6] text-[9px] font-bold rounded border border-[#3b82f6]/20 hover:bg-[#3b82f6]/20">
                지도
              </a>
            </div>
          ))}

          {aptRecords.length > 0 && (
            <>
              <div className="px-4 py-2 text-[9px] text-orange-700 font-black tracking-widest border-t border-[#1a1a1a] bg-[#0a0805]">
                <Building2 size={9} className="inline mr-1" />아파트 ({aptRecords.length}건)
              </div>
              {aptRecords.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[#0f0f0f] hover:bg-[#0f0905]">
                  <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-orange-400 font-black text-xs bg-orange-900/20 border border-orange-800/30">
                    {r.배송순번 || (i + 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-bold text-sm">{r.이름}</div>
                    <div className="text-orange-900 text-xs truncate">{r.행정동} | {r.주소}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
