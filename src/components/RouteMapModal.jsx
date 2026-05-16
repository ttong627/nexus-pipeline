import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, MapPin, Navigation2, Plus, Minus, RefreshCw, Save, AlertTriangle, Map, List, Building2, Share2, Copy, Check, Clock, FileSpreadsheet, Download, HardDrive, Maximize2, Minimize2, Columns } from 'lucide-react';
import { db, auth } from '../config/firebase.js';
import { addDoc, collection, serverTimestamp, getDocs, getDoc, setDoc, doc, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;
const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY;

const DRIVER_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
];

const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const parseAptDong = (addr) => { const m = addr?.match(/(\d+)\s*동/); return m ? parseInt(m[1]) : null; };
const parseFloorHo = (addr) => {
  const floor = addr?.match(/(\d+)\s*층/)?.[1] || '0';
  const ho = addr?.match(/(\d+)\s*호/)?.[1] || '0';
  return { floor: parseInt(floor), ho: parseInt(ho) };
};

// 카카오 공유 SDK 초기화
const initKakaoShare = () => {
  return new Promise((resolve) => {
    if (window.Kakao?.Share) { resolve(true); return; }
    const existing = document.getElementById('kakao-share-sdk');
    const onLoad = () => {
      try { if (!window.Kakao.isInitialized()) window.Kakao.init(KAKAO_JS_KEY); }
      catch { /* ignore */ }
      resolve(window.Kakao?.Share ? true : false);
    };
    if (existing) { existing.addEventListener('load', onLoad); return; }
    const script = document.createElement('script');
    script.id = 'kakao-share-sdk';
    script.src = 'https://developers.kakao.com/sdk/js/kakao.min.js';
    script.async = true;
    script.onload = onLoad;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
};

// Hex → KML 색상 변환 (KML은 aabbggrr 순서)
const hexToKmlColor = (hex) => {
  const h = (hex || '#888888').replace('#', '');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `ff${b}${g}${r}`;
};

const escXml = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escHtml = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// 주소에서 순수 도로명 추출: 괄호 밖 ","까지, 없으면 마지막 ")"까지
const extractRoadAddress = (addr) => {
  if (!addr) return addr;
  // 괄호 밖의 첫 번째 쉼표 위치 탐색
  let depth = 0;
  for (let i = 0; i < addr.length; i++) {
    if (addr[i] === '(') depth++;
    else if (addr[i] === ')') depth--;
    else if (addr[i] === ',' && depth === 0) {
      return addr.slice(0, i).trim();
    }
  }
  // 쉼표 없으면 마지막 ')' 까지
  const parenEnd = addr.lastIndexOf(')');
  if (parenEnd > -1) return addr.slice(0, parenEnd + 1).trim();
  return addr.trim();
};
const KAKAO_COLOR_MAP = { '#3b82f6':'blue','#22c55e':'green','#f59e0b':'yellow','#ef4444':'red','#8b5cf6':'violet','#06b6d4':'blue','#f97316':'orange','#ec4899':'red','#14b8a6':'green','#a855f7':'violet','#84cc16':'green','#f43f5e':'red','#0ea5e9':'blue','#d97706':'yellow','#10b981':'green','#6366f1':'violet','#e11d48':'red','#0891b2':'blue','#65a30d':'green','#7c3aed':'violet' };

// ── K-means++ 지리적 클러스터링 (업무능력% 가중치 반영) ─────────────────────
const kMeansCluster = (points, drivers, iterations = 30) => {
  const k = drivers.length;
  if (!points.length || k === 0) return {};
  if (k === 1) return Object.fromEntries(points.map(p => [p.id, drivers[0].id]));
  const totalCap = drivers.reduce((s, d) => s + (parseFloat(d.capacity) || 100), 0);
  const targetCounts = drivers.map(d => Math.round(points.length * (parseFloat(d.capacity) || 100) / totalCap));
  targetCounts[targetCounts.length - 1] += points.length - targetCounts.reduce((a, b) => a + b, 0);
  // K-means++ 초기화: 분산된 초기 중심 선택
  const centroids = [{ lat: points[0]._lat, lng: points[0]._lng }];
  while (centroids.length < k) {
    const dists = points.map(p => Math.min(...centroids.map(c => haversine(p._lat, p._lng, c.lat, c.lng))));
    const sum = dists.reduce((a, b) => a + b * b, 0);
    let r = Math.random() * sum;
    let pushed = false;
    for (let i = 0; i < points.length; i++) {
      r -= dists[i] * dists[i];
      if (r <= 0) { centroids.push({ lat: points[i]._lat, lng: points[i]._lng }); pushed = true; break; }
    }
    if (!pushed) centroids.push({ lat: points[points.length - 1]._lat, lng: points[points.length - 1]._lng });
  }
  // K-means 반복 (중심 수렴)
  for (let iter = 0; iter < iterations; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    points.forEach(p => {
      const dists = centroids.map(c => haversine(p._lat, p._lng, c.lat, c.lng));
      clusters[dists.indexOf(Math.min(...dists))].push(p);
    });
    centroids.forEach((c, i) => {
      if (!clusters[i].length) return;
      c.lat = clusters[i].reduce((s, p) => s + p._lat, 0) / clusters[i].length;
      c.lng = clusters[i].reduce((s, p) => s + p._lng, 0) / clusters[i].length;
    });
  }
  // 업무능력 용량 제한 배정 (가까운 중심 우선, 초과 시 다음 중심으로)
  const counts = new Array(k).fill(0);
  const result = {};
  const sorted = points.map(p => ({
    p,
    dists: centroids.map((c, ci) => ({ ci, d: haversine(p._lat, p._lng, c.lat, c.lng) })).sort((a, b) => a.d - b.d),
  })).sort((a, b) => a.dists[0].d - b.dists[0].d);
  for (const { p, dists } of sorted) {
    let assigned = false;
    for (const { ci } of dists) {
      if (counts[ci] < targetCounts[ci]) { result[p.id] = drivers[ci].id; counts[ci]++; assigned = true; break; }
    }
    if (!assigned) { result[p.id] = drivers[dists[0].ci].id; counts[dists[0].ci]++; }
  }
  return result;
};

// ── 최근접 이웃 TSP (북쪽 출발 → 시계방향 나선형) ──────────────────────────
const nearestNeighborTSP = (points) => {
  if (!points.length) return [];
  const rem = [...points];
  const startIdx = rem.reduce((mi, p, i) => p._lat > rem[mi]._lat ? i : mi, 0);
  const result = [rem.splice(startIdx, 1)[0]];
  while (rem.length) {
    const last = result[result.length - 1];
    let minD = Infinity, minI = 0;
    rem.forEach((p, i) => { const d = haversine(last._lat, last._lng, p._lat, p._lng); if (d < minD) { minD = d; minI = i; } });
    result.push(rem.splice(minI, 1)[0]);
  }
  return result;
};

export default function RouteMapModal({ gridData, fileInfo, onClose, onSave, initialCloudCity = null, initialCloudMonthId = null, orgDongs = null, initialDrivers: initialDriversProp = null, selectedDongs: selectedDongsProp = null }) {
  const defaultDrivers = [
    { id: 'd1', name: '기사1', color: DRIVER_COLORS[0] },
    { id: 'd2', name: '기사2', color: DRIVER_COLORS[1] },
  ];
  const startDrivers = initialDriversProp || defaultDrivers;

  const [drivers, setDrivers] = useState(startDrivers);
  const [records, setRecords] = useState(() =>
    gridData.map(r => ({
      ...r,
      _driverId: null,
      _lat: r._lat || null,
      _lng: r._lng || null,
      _isApt: r._isApt || false,
      _origDriver: r.기사 || '',
      _origSeqNo: r.배송순번 || '',
    }))
  );
  const [selectedDong, setSelectedDong] = useState('전체');
  const [driverCount, setDriverCount] = useState(startDrivers.length);
  const [overlapCount, setOverlapCount] = useState(0);
  const [isMapReady, setIsMapReady] = useState(false);
  // layoutMode: 'split' | 'map' | 'list' | 'mapfull'
  const [layoutMode, setLayoutMode] = useState('split');
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitMode, setSplitMode] = useState('boustrophedon');
  const [selectedDriverFilter, setSelectedDriverFilter] = useState('all');
  const [aptListExpanded, setAptListExpanded] = useState(true);
  const [showDongAssign, setShowDongAssign] = useState(false);
  const [workDongStep, setWorkDongStep] = useState('select'); // 'select' | 'assign'
  const [workDongSelection, setWorkDongSelection] = useState(new Set());
  const [dongAssignments, setDongAssignments] = useState({}); // {dong: [{id, driverId, rate}]}
  const [isFetchingCoords, setIsFetchingCoords] = useState(false);
  const [coordProgress, setCoordProgress] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);

  // 세션 저장 상태
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(''); // '' | 'draft' | 'final'
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const saveTimerRef = useRef(null);

  // Gemini AI 상태
  const [geminiPanel, setGeminiPanel] = useState(false);
  const [geminiKey, setGeminiKey] = useState(() => sessionStorage.getItem('nexus_gemini_key') || '');
  const [geminiPrompt, setGeminiPrompt] = useState('');
  const [geminiResult, setGeminiResult] = useState('');
  const [isGeminiLoading, setIsGeminiLoading] = useState(false);

  // 배송 일정 상태
  const [scheduleMode, setScheduleMode] = useState(false);
  const [selectedDateFilter, setSelectedDateFilter] = useState('all');

  // 공유 관련 상태
  const [sharePanel, setSharePanel] = useState(false);
  const [shareId, setShareId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedDriver, setCopiedDriver] = useState(null);

  // 클라우드 모드 상태
  const [isCloudMode, setIsCloudMode] = useState(false);
  const [cloudCity, setCloudCity] = useState('');
  const [cloudMonthId, setCloudMonthId] = useState('');
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [showCloudPicker, setShowCloudPicker] = useState(false);
  const [cloudPickerCity, setCloudPickerCity] = useState(fileInfo?.city || '');
  const [cloudPickerMonth, setCloudPickerMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const mapRef = useRef(null);
  const kakaoMapRef = useRef(null);
  const overlaysRef = useRef([]);
  const polylinesRef = useRef([]);

  const baseForFilter = isCloudMode ? records : gridData;
  const dongList = ['전체', ...[...new Set(baseForFilter.map(r => r.행정동).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'))];
  const filteredRecords = selectedDong === '전체' ? records : records.filter(r => r.행정동 === selectedDong);
  const displayRecords = selectedDriverFilter === 'all' ? filteredRecords
    : selectedDriverFilter === 'none' ? filteredRecords.filter(r => !r._driverId)
    : filteredRecords.filter(r => r._driverId === selectedDriverFilter);

  const mapRecords = displayRecords.filter(r => !r._isApt && r._lat && r._lng);
  const aptRecords = filteredRecords.filter(r => r._isApt);
  const withCoordCount = records.filter(r => !r._isApt && r._lat && r._lng).length;
  const aptCount = records.filter(r => r._isApt).length;
  const aptWithCoord = records.filter(r => r._isApt && r._lat && r._lng).length;
  const noCoordCount = records.filter(r => !r._isApt && (!r._lat || !r._lng)).length;
  const aptNoCoord = records.filter(r => r._isApt && (!r._lat || !r._lng)).length;
  const totalWithCoord = withCoordCount + aptWithCoord;
  const totalNoCoord = noCoordCount + aptNoCoord;
  const totalAll = records.length;
  const noCoordPct = totalAll > 0 ? Math.round(totalNoCoord / totalAll * 100) : 0;
  const withCoordPct = totalAll > 0 ? Math.round(totalWithCoord / totalAll * 100) : 0;
  const unassigned = filteredRecords.filter(r => !r._driverId).length;

  // ── 클라우드 명단에서 자동 로드 (CloudListManager에서 열린 경우) ──────
  useEffect(() => {
    if (!initialCloudCity || !initialCloudMonthId) return;
    setCloudPickerCity(initialCloudCity);
    setCloudPickerMonth(initialCloudMonthId);
    // 약간의 딜레이 후 자동 로드 (Kakao SDK 초기화 대기)
    const timer = setTimeout(async () => {
      setIsLoadingCloud(true);
      try {
        const snap = await getDocs(
          collection(db, 'cloud_lists', initialCloudCity, 'months', initialCloudMonthId, 'records')
        );
        if (!snap.empty) {
          let loaded = snap.docs.map(d => ({
            id: d.id,
            _cloudDocId: d.id,
            ...d.data(),
            _driverId: null,
            _lat: d.data().lat || null,
            _lng: d.data().lng || null,
            _isApt: d.data().isApt || false,
            _origDriver: d.data().기사 || '',
            _origSeqNo: d.data().배송순번 || '',
          }));
          // 조직 필터
          if (orgDongs) {
            loaded = loaded.filter(r => orgDongs.has((r.행정동 || '').trim()));
          }
          // 설정 화면에서 선택한 행정동만 로드
          if (selectedDongsProp) {
            loaded = loaded.filter(r => selectedDongsProp.has((r.행정동 || '').trim()));
          }
          setRecords(loaded);
          setIsCloudMode(true);
          setCloudCity(initialCloudCity);
          setCloudMonthId(initialCloudMonthId);
        }
      } catch (e) {
        console.error('클라우드 자동 로드 실패:', e);
      } finally {
        setIsLoadingCloud(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [initialCloudCity, initialCloudMonthId]);

  // ── Kakao Maps SDK 로딩 ─────────────────────────────────────────────
  useEffect(() => {
    if (window.kakao?.maps?.Map) { setIsMapReady(true); return; }
    const existing = document.getElementById('kakao-map-sdk');
    if (existing) { existing.onload = () => window.kakao.maps.load(() => setIsMapReady(true)); return; }
    const script = document.createElement('script');
    script.id = 'kakao-map-sdk';
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&libraries=clusterer&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao.maps.load(() => setIsMapReady(true));
    document.head.appendChild(script);
  }, []);

  // ── 지도 초기화 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMapReady || !mapRef.current || kakaoMapRef.current) return;
    kakaoMapRef.current = new window.kakao.maps.Map(mapRef.current, {
      center: new window.kakao.maps.LatLng(37.5665, 126.9780),
      level: 7,
    });
  }, [isMapReady]);

  // ── layoutMode 변경 시 카카오 지도 relayout ──────────────────────────
  useEffect(() => {
    if (!kakaoMapRef.current) return;
    const t = setTimeout(() => kakaoMapRef.current.relayout(), 60);
    return () => clearTimeout(t);
  }, [layoutMode]);

  // ── Escape → mapfull 해제 ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setLayoutMode(m => m === 'mapfull' ? 'split' : m); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── 변경 감지 ─────────────────────────────────────────────────────
  useEffect(() => { setHasUnsaved(true); }, [records, drivers]);

  // ── 5분 자동 임시저장 (클라우드 모드만) ──────────────────────────────
  useEffect(() => {
    if (!isCloudMode || !cloudCity || !cloudMonthId) return;
    if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    saveTimerRef.current = setInterval(async () => {
      try {
        await setDoc(
          doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId),
          {
            city: cloudCity, monthId: cloudMonthId,
            savedAt: serverTimestamp(),
            savedBy: auth.currentUser?.email || '',
            drivers: drivers.map(d => ({ id: d.id, name: d.name, color: d.color, capacity: d.capacity || 100, deliveryDate: d.deliveryDate || '' })),
            status: 'draft',
            totalRecords: records.length,
            assignedCount: records.filter(r => r._driverId).length,
          },
          { merge: true }
        );
        setLastAutoSave(new Date());
        setHasUnsaved(false);
        setSessionStatus('draft');
      } catch {}
    }, 5 * 60 * 1000);
    return () => clearInterval(saveTimerRef.current);
  }, [isCloudMode, cloudCity, cloudMonthId, drivers, records]);

  // ── 마커 렌더링 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!kakaoMapRef.current) return;
    overlaysRef.current.forEach(o => o.setMap(null));
    overlaysRef.current = [];
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];
    if (!mapRecords.length) return;

    mapRecords.forEach(r => {
      const driver = drivers.find(d => d.id === r._driverId);
      const color = r._에러 ? '#ef4444' : (driver?.color || '#6b7280');
      const seq = r.배송순번 || '';
      const name = escHtml((r.이름 || '').slice(0, 5));
      const qty = r.포수 || r['수량(포수)'] || '';

      // 옷핀(thumbtack) DOM 마커
      const pinEl = document.createElement('div');
      pinEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.7));';
      const glowColor = color + '60';
      pinEl.innerHTML = `<div style="width:32px;height:32px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:3px solid rgba(255,255,255,0.95);box-shadow:0 0 0 3px ${glowColor}, 0 4px 14px rgba(0,0,0,0.9);flex-shrink:0;position:relative;">${seq ? `<span style="font-size:10px;font-weight:900;color:white;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,0.5);">${seq}</span>` : `<div style="width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,0.4);"></div>`}</div><div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:14px solid ${color};margin-top:-2px;flex-shrink:0;"></div><div style="background:rgba(8,8,8,0.92);color:white;font-size:11px;font-weight:800;padding:2px 7px;border-radius:4px;margin-top:3px;white-space:nowrap;max-width:96px;overflow:hidden;text-overflow:ellipsis;border:1px solid ${color}50;box-shadow:0 2px 8px rgba(0,0,0,0.8);">${name}${qty ? `·<span style="color:${color};">${qty}포</span>` : ''}</div>`;
      pinEl.addEventListener('click', (e) => { e.stopPropagation(); setSelectedRecord(r); });

      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(r._lat, r._lng),
        content: pinEl,
        yAnchor: 0.63,
        xAnchor: 0.5,
        zIndex: r._에러 ? 10 : (seq ? 5 : 1),
      });
      overlay.setMap(kakaoMapRef.current);
      overlaysRef.current.push(overlay);
    });

    drivers.forEach(driver => {
      const dRecs = mapRecords.filter(r => r._driverId === driver.id && r.배송순번)
        .sort((a, b) => parseInt(a.배송순번) - parseInt(b.배송순번));
      if (dRecs.length < 2) return;
      // 메인 경로선 (solid)
      const polyline = new window.kakao.maps.Polyline({
        path: dRecs.map(r => new window.kakao.maps.LatLng(r._lat, r._lng)),
        strokeWeight: 3, strokeColor: driver.color, strokeOpacity: 0.7, strokeStyle: 'solid',
      });
      polyline.setMap(kakaoMapRef.current);
      polylinesRef.current.push(polyline);
      // 애니메이션 점선 (offset 효과)
      const dashed = new window.kakao.maps.Polyline({
        path: dRecs.map(r => new window.kakao.maps.LatLng(r._lat, r._lng)),
        strokeWeight: 2, strokeColor: '#ffffff', strokeOpacity: 0.35, strokeStyle: 'shortdash',
      });
      dashed.setMap(kakaoMapRef.current);
      polylinesRef.current.push(dashed);
    });

    const bounds = new window.kakao.maps.LatLngBounds();
    mapRecords.forEach(r => bounds.extend(new window.kakao.maps.LatLng(r._lat, r._lng)));
    kakaoMapRef.current.setBounds(bounds, 60, 60, 60, 60);

    const groups = drivers.map(d => mapRecords.filter(r => r._driverId === d.id));
    let cnt = 0;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++)
        groups[i].forEach(r1 => groups[j].forEach(r2 => {
          if (haversine(r1._lat, r1._lng, r2._lat, r2._lng) < 150) cnt++;
        }));
    setOverlapCount(cnt);
  }, [records, mapRecords, drivers]);

  // ── K-means 지리적 클러스터 자동 배정 ─────────────────────────────────
  const handleAutoSplit = useCallback(() => {
    setIsSplitting(true);
    setTimeout(() => {
      const target = filteredRecords.filter(r => !r._isApt && r._lat && r._lng);
      const activeDrivers = drivers.slice(0, Math.min(driverCount, drivers.length));
      if (!target.length || !activeDrivers.length) { setIsSplitting(false); return; }

      if (splitMode === 'apt') {
        // 아파트 전용: 동호수 기준 순서 배분
        const sorted = [...target].sort((a, b) => {
          const dA = parseAptDong(a.주소) ?? 999, dB = parseAptDong(b.주소) ?? 999;
          if (dA !== dB) return dA - dB;
          const { floor: fA, ho: hA } = parseFloorHo(a.주소);
          const { floor: fB, ho: hB } = parseFloorHo(b.주소);
          return fA !== fB ? fA - fB : hA - hB;
        });
        const chunkSize = Math.ceil(sorted.length / activeDrivers.length);
        const assignments = {};
        sorted.forEach((r, idx) => {
          const di = Math.min(Math.floor(idx / chunkSize), activeDrivers.length - 1);
          assignments[r.id] = { driverId: activeDrivers[di].id };
        });
        setRecords(prev => prev.map(r => {
          const a = assignments[r.id];
          return a ? { ...r, _driverId: a.driverId } : r;
        }));
      } else {
        // K-means++ 지리적 클러스터링 (업무능력 가중치 반영)
        const clusterMap = kMeansCluster(target, activeDrivers);
        setRecords(prev => prev.map(r => clusterMap[r.id] ? { ...r, _driverId: clusterMap[r.id] } : r));
      }
      setIsSplitting(false);
    }, 0);
  }, [filteredRecords, drivers, driverCount, splitMode]);

  // ── 작업 동 저장 ─────────────────────────────────────────────────────
  const handleSaveWorkDongs = useCallback(() => {
    const newAssignments = {};
    workDongSelection.forEach(dong => {
      newAssignments[dong] = dongAssignments[dong]?.length
        ? dongAssignments[dong]
        : [{ id: `${dong}_0`, driverId: drivers[0]?.id || '', rate: 100 }];
    });
    setDongAssignments(newAssignments);
    setWorkDongStep('assign');
  }, [workDongSelection, dongAssignments, drivers]);

  const addDriverToDong = (dong) => {
    setDongAssignments(prev => ({
      ...prev,
      [dong]: [...(prev[dong] || []), { id: `${dong}_${Date.now()}`, driverId: drivers[0]?.id || '', rate: 100 }],
    }));
  };

  const removeDriverFromDong = (dong, id) => {
    setDongAssignments(prev => ({
      ...prev,
      [dong]: (prev[dong] || []).filter(a => a.id !== id),
    }));
  };

  const updateDongAssignment = (dong, id, field, value) => {
    setDongAssignments(prev => ({
      ...prev,
      [dong]: (prev[dong] || []).map(a => a.id === id ? { ...a, [field]: value } : a),
    }));
  };

  // ── 지그재그 정렬 유틸 ───────────────────────────────────────────────
  const boustrophedonSort = (recs) => {
    if (!recs.length) return recs;
    const minLat = Math.min(...recs.map(r => r._lat));
    const maxLat = Math.max(...recs.map(r => r._lat));
    const blockSize = (maxLat - minLat) / 8 || 0.0001;
    return [...recs].sort((a, b) => {
      const bA = Math.floor((a._lat - minLat) / blockSize);
      const bB = Math.floor((b._lat - minLat) / blockSize);
      if (bA !== bB) return bB - bA;
      return bA % 2 === 0 ? a._lng - b._lng : b._lng - a._lng;
    });
  };

  // ── 다중기사 행정동 배분 (적용률 기반 지그재그) ──────────────────────
  const handleDongAssign = useCallback(() => {
    setRecords(prev => {
      const updated = [...prev];
      Object.entries(dongAssignments).forEach(([dong, assignments]) => {
        if (!assignments.length) return;
        const dongRecs = updated.filter(r => r.행정동 === dong && !r._isApt && r._lat && r._lng);
        const sorted = boustrophedonSort(dongRecs);
        if (!sorted.length) return;
        const totalRate = assignments.reduce((s, a) => s + (parseFloat(a.rate) || 100), 0);
        let cursor = 0;
        assignments.forEach((assignment, i) => {
          const isLast = i === assignments.length - 1;
          const count = isLast
            ? sorted.length - cursor
            : Math.round((parseFloat(assignment.rate) || 100) / totalRate * sorted.length);
          sorted.slice(cursor, cursor + count).forEach(r => {
            const idx = updated.findIndex(u => u.id === r.id);
            if (idx !== -1) updated[idx] = { ...updated[idx], _driverId: assignment.driverId };
          });
          cursor += count;
        });
      });
      return updated;
    });
  }, [dongAssignments]);

  // ── 배송순번 자동 정렬 (기사별 최근접 이웃 TSP — 북쪽 출발 시계방향) ───
  const handleAutoSequence = useCallback(() => {
    setRecords(prev => {
      const updated = [...prev];
      drivers.forEach(driver => {
        const driverRecs = updated.filter(r => r._driverId === driver.id && !r._isApt && r._lat && r._lng);
        if (!driverRecs.length) return;
        const ordered = nearestNeighborTSP(driverRecs);
        ordered.forEach((r, i) => {
          const idx = updated.findIndex(u => u.id === r.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], 배송순번: String(i + 1) };
        });
      });
      return updated;
    });
  }, [drivers]);

  // ── 지난달 배정 불러오기 ─────────────────────────────────────────────
  const handleLoadLastMonth = useCallback(() => {
    let loaded = 0;
    setRecords(prev => prev.map(r => {
      if (!r._origDriver) return r;
      const driver = drivers.find(d => d.name === r._origDriver);
      if (!driver) return r;
      loaded++;
      return { ...r, _driverId: driver.id, 배송순번: r._origSeqNo || r.배송순번 };
    }));
    if (loaded === 0) alert('기사명과 일치하는 지난달 배정 정보가 없습니다.\n기사 이름을 지난달과 동일하게 입력 후 다시 시도하세요.');
  }, [drivers]);

  // ── 1단계: 세션 수동 저장 (draft / final) ───────────────────────────
  const handleSaveSession = useCallback(async (isFinal = false) => {
    if (!isCloudMode || !cloudCity || !cloudMonthId) {
      if (isFinal) alert('클라우드 명단 로드 후 저장 가능합니다.');
      return;
    }
    setIsSavingSession(true);
    try {
      // route_sessions에 기사구성·배정 저장
      await setDoc(
        doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId),
        {
          city: cloudCity, monthId: cloudMonthId,
          savedAt: serverTimestamp(),
          savedBy: auth.currentUser?.email || '',
          drivers: drivers.map(d => ({ id: d.id, name: d.name, color: d.color, capacity: d.capacity || 100, deliveryDate: d.deliveryDate || '' })),
          status: isFinal ? 'final' : 'draft',
          totalRecords: records.length,
          assignedCount: records.filter(r => r._driverId).length,
        },
        { merge: true }
      );
      // cloud_lists 레코드에 기사/순번/좌표 동기화
      const CHUNK = 499;
      for (let i = 0; i < records.length; i += CHUNK) {
        const batch = writeBatch(db);
        records.slice(i, i + CHUNK).forEach(r => {
          if (!r._cloudDocId) return;
          const driverName = drivers.find(d => d.id === r._driverId)?.name || '';
          const ref = doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId);
          const patch = { 기사: driverName, 배송순번: r.배송순번 || '' };
          if (r._lat) { patch.lat = r._lat; patch.lng = r._lng; }
          if (r._isApt !== undefined) patch.isApt = r._isApt;
          batch.update(ref, patch);
        });
        await batch.commit();
      }
      setSessionStatus(isFinal ? 'final' : 'draft');
      setLastAutoSave(new Date());
      setHasUnsaved(false);
      if (isFinal) {
        await syncToBaseList();
        alert(`✅ 최종 저장 완료\n${cloudCity} ${cloudMonthId} · ${records.filter(r => r._driverId).length}건 배정`);
      }
    } catch (e) {
      if (isFinal) alert('저장 실패: ' + e.message);
    } finally {
      setIsSavingSession(false);
    }
  }, [isCloudMode, cloudCity, cloudMonthId, drivers, records]);

  // ── 1단계: 세션 불러오기 (이어서 작업) ──────────────────────────────
  const handleLoadSession = useCallback(async () => {
    if (!cloudCity || !cloudMonthId) { alert('먼저 클라우드 명단을 불러오세요.'); return; }
    try {
      const snap = await getDoc(doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId));
      if (!snap.exists()) { alert('저장된 세션이 없습니다.\n새 작업을 시작하세요.'); return; }
      const data = snap.data();
      if (data.drivers?.length) {
        setDrivers(data.drivers);
        setDriverCount(data.drivers.length);
      }
      // cloud_lists에서 기사/순번/좌표 재로드
      const recSnap = await getDocs(collection(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records'));
      setRecords(prev => prev.map(r => {
        const found = recSnap.docs.find(d => d.id === r._cloudDocId);
        if (!found) return r;
        const fd = found.data();
        const driver = data.drivers?.find(d => d.name === fd.기사);
        return {
          ...r,
          _driverId: driver?.id || r._driverId,
          배송순번: fd.배송순번 || r.배송순번,
          _lat: fd.lat || r._lat,
          _lng: fd.lng || r._lng,
          _isApt: fd.isApt ?? r._isApt,
        };
      }));
      setSessionStatus(data.status || 'draft');
      setHasUnsaved(false);
      const savedAt = data.savedAt?.toDate?.()?.toLocaleString('ko-KR') || '';
      alert(`✅ 세션 로드 완료\n${data.status === 'final' ? '최종' : '임시'} 저장본 · ${savedAt}\n기사 ${data.drivers?.length || 0}명 · 배정 ${data.assignedCount || 0}건`);
    } catch (e) {
      alert('세션 로드 실패: ' + e.message);
    }
  }, [cloudCity, cloudMonthId]);

  // ── 2단계: 좌표 캐시 유틸 ────────────────────────────────────────────
  const addrToDocId = (addr) => (addr || '').replace(/[/]/g, '_').slice(0, 400);

  const getCachedCoord = async (city, addr) => {
    try {
      const snap = await getDoc(doc(db, 'coordinate_cache', city, 'addresses', addrToDocId(addr)));
      if (snap.exists()) { const d = snap.data(); return { lat: d.lat, lng: d.lng }; }
    } catch {}
    return null;
  };

  const saveCoordCache = async (city, addr, lat, lng) => {
    try {
      await setDoc(
        doc(db, 'coordinate_cache', city, 'addresses', addrToDocId(addr)),
        { address: addr, lat, lng, fetchedAt: serverTimestamp() },
        { merge: true }
      );
    } catch {}
  };

  // ── 3단계: 이전달 좌표+배정 승계 ────────────────────────────────────
  const handleLoadPrevMonth = useCallback(async () => {
    if (!cloudCity || !cloudMonthId) { alert('먼저 클라우드 명단을 불러오세요.'); return; }
    const [year, month] = cloudMonthId.split('-').map(Number);
    const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    try {
      // 이전달 세션 불러오기 (기사 구성)
      const prevSession = await getDoc(doc(db, 'route_sessions', cloudCity, 'months', prevMonth));
      // 이전달 레코드 불러오기 (좌표+배정)
      const prevRecSnap = await getDocs(collection(db, 'cloud_lists', cloudCity, 'months', prevMonth, 'records'));
      if (prevRecSnap.empty && !prevSession.exists()) {
        alert(`이전달(${prevMonth}) 데이터가 없습니다.`);
        return;
      }
      // 이름_생년월일 → {lat, lng, 기사, 배송순번}
      const prevMap = {};
      prevRecSnap.docs.forEach(d => {
        const fd = d.data();
        const birthKey = (fd.생년월일 || fd.birthKey || '').replace(/[^0-9]/g, '');
        const key = `${fd.이름 || fd.name || ''}_${birthKey}`;
        if (key !== '_') prevMap[key] = { lat: fd.lat, lng: fd.lng, driverName: fd.기사 || '', seqNo: fd.배송순번 || '' };
      });

      // 기사 구성 승계
      if (prevSession.exists() && prevSession.data().drivers?.length) {
        const prevDrivers = prevSession.data().drivers.map(d => ({ ...d, deliveryDate: '' }));
        setDrivers(prevDrivers);
        setDriverCount(prevDrivers.length);
      }

      let coordApplied = 0, driverApplied = 0;
      setRecords(prev => {
        const updated = [...prev];
        const currentDrivers = prevSession.exists() ? prevSession.data().drivers || [] : drivers;
        updated.forEach((r, i) => {
          const birthKey = (r.생년월일 || '').replace(/[^0-9]/g, '');
          const key = `${r.이름 || ''}_${birthKey}`;
          const prev = prevMap[key];
          if (!prev) return;
          const patch = {};
          if (!r._lat && prev.lat) { patch._lat = prev.lat; patch._lng = prev.lng; coordApplied++; }
          if (!r._driverId && prev.driverName) {
            const driver = currentDrivers.find(d => d.name === prev.driverName);
            if (driver) { patch._driverId = driver.id; patch.배송순번 = prev.seqNo; driverApplied++; }
          }
          if (Object.keys(patch).length) updated[i] = { ...r, ...patch };
        });
        return updated;
      });
      alert(`✅ 이전달(${prevMonth}) 승계 완료\n좌표 ${coordApplied}건 · 기사배정 ${driverApplied}건 자동 적용`);
    } catch (e) {
      alert('이전달 불러오기 실패: ' + e.message);
    }
  }, [cloudCity, cloudMonthId, drivers]);

  // ── Gemini AI 배송 구역 최적화 ─────────────────────────────────────
  const handleGeminiOptimize = async () => {
    if (!geminiKey.trim()) { alert('Gemini API 키를 먼저 입력하세요.'); return; }
    if (!geminiPrompt.trim()) { alert('요청 내용을 입력하세요.'); return; }
    setIsGeminiLoading(true);
    setGeminiResult('');
    try {
      const driverSummary = drivers.map(d => ({
        id: d.id, name: d.name, capacity: d.capacity || 100,
        count: records.filter(r => r._driverId === d.id).length,
        dongs: [...new Set(records.filter(r => r._driverId === d.id).map(r => r.행정동).filter(Boolean))],
      }));
      const dongSummary = [...new Set(records.map(r => r.행정동).filter(Boolean))].map(dong => ({
        dong, count: records.filter(r => r.행정동 === dong).length,
        drivers: [...new Set(records.filter(r => r.행정동 === dong && r._driverId).map(r => drivers.find(d => d.id === r._driverId)?.name).filter(Boolean))],
      }));
      const prompt = `당신은 배송 구역 최적화 전문가입니다. 한국어로 응답하세요.

현재 기사 현황: ${JSON.stringify(driverSummary)}
행정동별 현황: ${JSON.stringify(dongSummary)}

사용자 요청: "${geminiPrompt}"

반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이):
{
  "message": "조정 내용 한 줄 요약",
  "dongChanges": [{ "dong": "행정동명", "driverName": "기사이름" }],
  "deliveryDates": [{ "driverName": "기사이름", "date": "YYYY-MM-DD", "reason": "이유" }]
}

주의: 기사명·행정동명은 위 목록에 있는 것만 사용. 변경 없으면 빈 배열.`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
          }),
        }
      );
      if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || `HTTP ${res.status}`); }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('응답 없음');
      const parsed = JSON.parse(text);

      // 행정동→기사 변경 적용
      if (parsed.dongChanges?.length) {
        setRecords(prev => {
          const updated = [...prev];
          parsed.dongChanges.forEach(({ dong, driverName }) => {
            const driver = drivers.find(d => d.name === driverName);
            if (!driver) return;
            updated.forEach((r, i) => { if (r.행정동 === dong) updated[i] = { ...r, _driverId: driver.id }; });
          });
          return updated;
        });
      }
      // 배송 날짜 배정 적용
      if (parsed.deliveryDates?.length) {
        setDrivers(prev => prev.map(d => {
          const found = parsed.deliveryDates.find(dd => dd.driverName === d.name);
          return found ? { ...d, deliveryDate: found.date } : d;
        }));
      }

      const changes = parsed.dongChanges?.length
        ? `변경: ${parsed.dongChanges.map(c => `${c.dong}→${c.driverName}`).join(', ')}`
        : '구역 변경 없음';
      const dates = parsed.deliveryDates?.length
        ? `\n일정: ${parsed.deliveryDates.map(d => `${d.driverName} ${d.date}`).join(', ')}`
        : '';
      setGeminiResult(`✅ ${parsed.message}\n${changes}${dates}`);
      setGeminiPrompt('');
    } catch (e) {
      setGeminiResult(`❌ 오류: ${e.message}`);
    } finally {
      setIsGeminiLoading(false);
    }
  };

  // ── 클라우드 명단 불러오기 ──────────────────────────────────────────
  const handleLoadFromCloud = async () => {
    if (!cloudPickerCity.trim() || !cloudPickerMonth.trim()) {
      alert('지자체명과 월(YYYY-MM)을 입력하세요.');
      return;
    }
    setIsLoadingCloud(true);
    try {
      const snap = await getDocs(
        collection(db, 'cloud_lists', cloudPickerCity.trim(), 'months', cloudPickerMonth.trim(), 'records')
      );
      if (snap.empty) {
        alert(`[${cloudPickerCity}] ${cloudPickerMonth} 저장된 데이터가 없습니다.\n먼저 해당 월 명단을 클라우드에 저장해 주세요.`);
        return;
      }
      const loaded = snap.docs.map(d => ({
        id: d.id,
        _cloudDocId: d.id,
        ...d.data(),
        _driverId: null,
        _lat: d.data().lat || null,
        _lng: d.data().lng || null,
        _isApt: d.data().isApt || false,
        _origDriver: d.data().기사 || '',
        _origSeqNo: d.data().배송순번 || '',
      }));
      setRecords(loaded);
      setIsCloudMode(true);
      setCloudCity(cloudPickerCity.trim());
      setCloudMonthId(cloudPickerMonth.trim());
      setShowCloudPicker(false);
      setSelectedDong('전체');
      setSelectedDriverFilter('all');
      overlaysRef.current.forEach(o => o.setMap(null));
      overlaysRef.current = [];
      polylinesRef.current.forEach(p => p.setMap(null));
      polylinesRef.current = [];
    } catch (e) {
      alert('불러오기 실패: ' + e.message);
    } finally {
      setIsLoadingCloud(false);
    }
  };

  // ── base_lists 드라이버 배정 sync-back ──────────────────────────────
  const syncToBaseList = async () => {
    const digitKey = v => String(v || '').replace(/[^\d]/g, '');
    try {
      const baseSnap = await getDocs(collection(db, 'base_lists', cloudCity, 'records'));
      if (baseSnap.empty) return; // base_lists 없으면 skip

      const byBirth = new Map(), byPhone = new Map(), byLandline = new Map();
      baseSnap.docs.forEach(d => {
        const b = d.data();
        const name = b.name || b.이름 || '';
        const bk = digitKey(b.birthKey || b.생년월일 || '');
        const ph = digitKey(b.mobile || b.휴대폰 || '');
        const ld = digitKey(b.landline || b.유선전화 || '');
        if (bk) byBirth.set(`${name}_${bk}`, d.ref);
        if (ph) byPhone.set(`${name}_${ph}`, d.ref);
        if (ld) byLandline.set(`${name}_${ld}`, d.ref);
      });

      const updates = [];
      records.forEach(r => {
        const driverName = drivers.find(d => d.id === r._driverId)?.name || '';
        const name = r.이름 || '';
        const bk = digitKey(r.생년월일 || '');
        const ph = digitKey(r.휴대폰 || '');
        const ld = digitKey(r.유선전화 || '');

        let ref = null;
        if (bk) ref = byBirth.get(`${name}_${bk}`);
        if (!ref && ph) ref = byPhone.get(`${name}_${ph}`);
        if (!ref && ld) ref = byLandline.get(`${name}_${ld}`);
        if (!ref) return;

        const patch = {};
        if (driverName) patch.driver = driverName;
        if (r.배송순번) patch.seqNo = String(r.배송순번);
        if (r._lat) patch.lat = r._lat;
        if (r._lng) patch.lng = r._lng;
        if (r._isApt !== undefined) patch.isApt = r._isApt;
        if (Object.keys(patch).length) updates.push({ ref, patch });
      });

      const CHUNK = 499;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const batch = writeBatch(db);
        updates.slice(i, i + CHUNK).forEach(u => batch.update(u.ref, u.patch));
        await batch.commit();
      }
      return updates.length;
    } catch (e) {
      console.error('base_lists sync 실패:', e);
      return 0;
    }
  };

  // ── 클라우드 명단에 기사 배정 저장 + base_lists sync ────────────────
  const handleSaveToCloud = async () => {
    if (!isCloudMode) return;
    setIsSavingCloud(true);
    try {
      // 1단계: cloud_lists에 기사/배송순번 저장
      const CHUNK = 499;
      for (let i = 0; i < records.length; i += CHUNK) {
        const batch = writeBatch(db);
        records.slice(i, i + CHUNK).forEach(r => {
          if (!r._cloudDocId) return;
          const driverName = drivers.find(d => d.id === r._driverId)?.name || '';
          const ref = doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId);
          batch.update(ref, { 기사: driverName, 배송순번: r.배송순번 || '' });
        });
        await batch.commit();
      }

      // 2단계: base_lists에 driver/seqNo/좌표 자동 반영
      const synced = await syncToBaseList();

      alert(`✅ ${cloudCity} ${cloudMonthId} 기사 배정 저장 완료\n월별 명단: ${records.length}건 / 기본명단 반영: ${synced}건`);
    } catch (e) {
      alert('클라우드 저장 실패: ' + e.message);
    } finally {
      setIsSavingCloud(false);
    }
  };

  // ── 겹침 해소 ────────────────────────────────────────────────────────
  const handleResolveOverlap = useCallback(() => {
    const withCoord = records.filter(r => !r._isApt && r._lat && r._lng && r._driverId);
    const updates = {};
    drivers.forEach((dA, i) => {
      drivers.slice(i + 1).forEach(dB => {
        const gA = withCoord.filter(r => r._driverId === dA.id);
        const gB = withCoord.filter(r => r._driverId === dB.id);
        gA.forEach(rA => gB.forEach(rB => {
          if (haversine(rA._lat, rA._lng, rB._lat, rB._lng) < 150) {
            const cA = { lat: gA.reduce((s, r) => s + r._lat, 0) / gA.length, lng: gA.reduce((s, r) => s + r._lng, 0) / gA.length };
            const cB = { lat: gB.reduce((s, r) => s + r._lat, 0) / gB.length, lng: gB.reduce((s, r) => s + r._lng, 0) / gB.length };
            if (haversine(rA._lat, rA._lng, cA.lat, cA.lng) > haversine(rA._lat, rA._lng, cB.lat, cB.lng))
              updates[rA.id] = dB.id;
          }
        }));
      });
    });
    if (!Object.keys(updates).length) return;
    setRecords(prev => prev.map(r => updates[r.id] ? { ...r, _driverId: updates[r.id] } : r));
  }, [records, drivers]);

  // ── KML 파일 생성 및 다운로드 (카카오맵 나만의지도 가져오기용) ───────────
  const handleDownloadDriverKML = useCallback((driver) => {
    const assigned = records.filter(r => r._driverId === driver.id);
    const normal = assigned
      .filter(r => !r._isApt && r._lat && r._lng)
      .sort((a, b) => (parseInt(a.배송순번) || 999) - (parseInt(b.배송순번) || 999));
    const apts = assigned
      .filter(r => r._isApt)
      .sort((a, b) => {
        const dA = parseAptDong(a.주소) ?? 999, dB = parseAptDong(b.주소) ?? 999;
        if (dA !== dB) return dA - dB;
        const { floor: fA, ho: hA } = parseFloorHo(a.주소);
        const { floor: fB, ho: hB } = parseFloorHo(b.주소);
        return fA !== fB ? fA - fB : hA - hB;
      });

    if (!normal.length && !apts.length) { alert('배정된 데이터가 없습니다.'); return; }

    const kmlColor = hexToKmlColor(driver.color);
    const city = fileInfo?.city || '';
    const month = fileInfo?.month || '';

    const aptSummary = apts.length > 0
      ? `\n\n[아파트 ${apts.length}건 - 지도 핀 제외]\n` +
        apts.map((r, i) => `${i + 1}. ${r.이름} | ${r.주소}`).join('\n')
      : '';

    const placemarks = normal.map(r => `
  <Placemark>
    <name>${escXml(r.배송순번 ? r.배송순번 + '. ' + r.이름 : r.이름)}</name>
    <description><![CDATA[주소: ${r.주소 || ''}<br/>행정동: ${r.행정동 || ''}<br/>포수: ${r.포수 || ''}<br/>특이사항: ${r.특이사항 || '-'}<br/>연락처: ${r.휴대폰 || r.유선전화 || '-'}]]></description>
    <styleUrl>#driverPin</styleUrl>
    <Point>
      <coordinates>${r._lng},${r._lat},0</coordinates>
    </Point>
  </Placemark>`).join('');

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escXml(driver.name)} 배송루트${month ? ' - ' + month : ''}</name>
    <description><![CDATA[${city} | 총 ${assigned.length}건 (지도 ${normal.length}건 + 아파트 ${apts.length}건)${aptSummary}]]></description>
    <Style id="driverPin">
      <IconStyle>
        <color>${kmlColor}</color>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/paddle/wht-circle.png</href>
        </Icon>
        <hotSpot x="32" y="1" xunits="pixels" yunits="pixels"/>
      </IconStyle>
      <LabelStyle><scale>0.75</scale></LabelStyle>
    </Style>
    ${placemarks}
  </Document>
</kml>`;

    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${driver.name}-배송루트${month ? '-' + month : ''}.kml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [records, fileInfo]);

  // ── 담당자용 기사별 엑셀 내보내기 ──────────────────────────────────────
  const handleExportDriverExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const now = new Date();
    const ts = String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
    const city = fileInfo?.city || '지자체';
    const month = fileInfo?.month || '';

    const COLS = ['배송순번','행정동','이름','주소','포수','특이사항','휴대폰'];

    const makeRow = (r) => [
      r.배송순번 || '',
      r.행정동 || '',
      r.이름 || '',
      r.주소 || '',
      r.포수 || '',
      r.특이사항 || '',
      r.휴대폰 || '',
    ];

    drivers.forEach(driver => {
      const assigned = records.filter(r => r._driverId === driver.id);
      if (!assigned.length) return;

      // 일반 배송 (좌표 있음 + 비아파트) — 배송순번 정렬
      const normal = assigned
        .filter(r => !r._isApt)
        .sort((a, b) => (parseInt(a.배송순번)||999) - (parseInt(b.배송순번)||999));

      // 아파트 — 동호수 정렬
      const apts = assigned
        .filter(r => r._isApt)
        .sort((a, b) => {
          const dA = parseAptDong(a.주소) ?? 999, dB = parseAptDong(b.주소) ?? 999;
          if (dA !== dB) return dA - dB;
          const { floor: fA, ho: hA } = parseFloorHo(a.주소);
          const { floor: fB, ho: hB } = parseFloorHo(b.주소);
          return fA !== fB ? fA - fB : hA - hB;
        });

      const rows = [COLS, ...normal.map(makeRow)];

      if (apts.length > 0) {
        rows.push(['', '', '', '', '', '', '']);
        rows.push(['[아파트]', '', '', '', '', '', '']);
        rows.push(COLS);
        apts.forEach(r => rows.push(makeRow(r)));
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);

      // 헤더 행 스타일 (굵기)
      const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: 'E2EFDA' } } };
      ['A1','B1','C1','D1','E1','F1','G1'].forEach(cell => {
        if (ws[cell]) ws[cell].s = headerStyle;
      });

      // 컬럼 너비
      ws['!cols'] = [
        { wch: 7 }, { wch: 10 }, { wch: 10 }, { wch: 40 },
        { wch: 6 }, { wch: 30 }, { wch: 15 },
      ];

      XLSX.utils.book_append_sheet(wb, ws, driver.name.slice(0, 31));
    });

    if (wb.SheetNames.length === 0) { alert('배정된 기사가 없습니다.'); return; }

    const fileName = `[담당자용]${city}-${month}-기사별배정-${ts}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }, [records, drivers, fileInfo]);

  // ── 배송루트 번들 다운로드 (엑셀 + 기사별 지도 이미지) ─────────────────
  const handleDownloadRouteBundle = useCallback(async () => {
    const hasAssigned = drivers.some(d => records.some(r => r._driverId === d.id));
    if (!hasAssigned) { alert('배정된 기사가 없습니다.'); return; }

    // 1) 담당자용 엑셀 (기존 함수 재사용)
    handleExportDriverExcel();

    // 2) 기사별 카카오 정적 지도 이미지 다운로드
    const city = fileInfo?.city || '';
    const month = fileInfo?.month || '';

    for (const driver of drivers) {
      const dRecs = records
        .filter(r => r._driverId === driver.id && !r._isApt && r._lat && r._lng)
        .sort((a, b) => (parseInt(a.배송순번) || 999) - (parseInt(b.배송순번) || 999))
        .slice(0, 80); // URL 길이 제한 대응
      if (!dRecs.length) continue;

      const centerLat = dRecs.reduce((s, r) => s + r._lat, 0) / dRecs.length;
      const centerLng = dRecs.reduce((s, r) => s + r._lng, 0) / dRecs.length;
      const kakaoColor = KAKAO_COLOR_MAP[driver.color] || 'gray';
      const posStr = dRecs.map(r => `${r._lng} ${r._lat}`).join('|');
      const markerParam = `type:pos|color:${kakaoColor}|size:small&pos=${posStr}`;
      const imgUrl = `https://dapi.kakao.com/v2/maps/staticmap?appkey=${KAKAO_REST_KEY}&center=${centerLng},${centerLat}&level=6&w=1200&h=900&markers=${encodeURIComponent(markerParam)}`;

      try {
        const res = await fetch(imgUrl, { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } });
        if (res.ok) {
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = `[지도]${driver.name}${city ? '-' + city : ''}${month ? '-' + month : ''}.png`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          await new Promise(r => setTimeout(r, 400));
        }
      } catch (e) {
        console.warn(`${driver.name} 지도 이미지 실패:`, e);
      }
    }
  }, [drivers, records, fileInfo, handleExportDriverExcel]);

  // ── 그리드 업데이트 (공통) ───────────────────────────────────────────
  const buildUpdatedGrid = useCallback(() => {
    return gridData.map(orig => {
      const rec = records.find(r => r.id === orig.id);
      if (!rec) return orig;
      const driverName = drivers.find(d => d.id === rec._driverId)?.name || '';
      return { ...orig, 기사: driverName || orig.기사, 배송순번: rec.배송순번 || orig.배송순번 };
    });
  }, [gridData, records, drivers]);

  // ── 저장 (세션 모드: gridData 업데이트 / 클라우드 모드: Firestore 저장) ──
  const handleSave = async () => {
    if (isCloudMode) {
      await handleSaveToCloud();
    } else {
      onSave(buildUpdatedGrid());
      onClose();
    }
  };

  // ── 공유 링크 생성 ──────────────────────────────────────────────────
  const handleShare = async () => {
    setIsSaving(true);
    try {
      const updated = buildUpdatedGrid();
      onSave(updated); // 그리드 업데이트 (기본명단 저장 시 자동으로 좌표도 저장됨)

      const sharePayload = {
        city: fileInfo?.city || '',
        month: fileInfo?.month || '',
        createdAt: serverTimestamp(),
        drivers: drivers.map(d => ({ id: d.id, name: d.name, color: d.color })),
        records: records
          .filter(r => r._driverId)
          .map(r => ({
            driverId: r._driverId,
            lat: r._lat || null,
            lng: r._lng || null,
            isApt: r._isApt || false,
            이름: r.이름 || '',
            주소: r.주소 || '',
            행정동: r.행정동 || '',
            배송순번: parseInt(r.배송순번 || '0') || 0,
          })),
      };

      const ref = await addDoc(collection(db, 'route_shares'), sharePayload);
      setShareId(ref.id);
      setSharePanel(true);
    } catch (e) {
      alert('공유 링크 생성 실패: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  // ── URL 복사 ────────────────────────────────────────────────────────
  const getShareUrl = (driverId) =>
    `${window.location.origin}/?r=${shareId}&d=${driverId}`;

  const handleCopyUrl = async (driver) => {
    const url = getShareUrl(driver.id);
    await navigator.clipboard.writeText(url);
    setCopiedDriver(driver.id);
    setTimeout(() => setCopiedDriver(null), 2000);
  };

  // ── 카카오 공유 ─────────────────────────────────────────────────────
  const handleKakaoShare = async (driver) => {
    const url = getShareUrl(driver.id);
    const cnt = records.filter(r => r._driverId === driver.id).length;
    try {
      const ok = await initKakaoShare();
      if (ok && window.Kakao?.Share) {
        window.Kakao.Share.sendDefault({
          objectType: 'feed',
          content: {
            title: `🚚 ${driver.name} 배송 루트`,
            description: `${fileInfo?.city || ''} ${fileInfo?.month || ''} | 총 ${cnt}건`,
            link: { mobileWebUrl: url, webUrl: url },
          },
          buttons: [{ title: '루트 보기', link: { mobileWebUrl: url, webUrl: url } }],
        });
      } else {
        await navigator.clipboard.writeText(url);
        alert('카카오 공유를 사용할 수 없어 링크를 클립보드에 복사했습니다.');
      }
    } catch {
      await navigator.clipboard.writeText(url);
      alert('링크를 클립보드에 복사했습니다.');
    }
  };

  // ── 좌표 보완 (Kakao 지오코딩 3라운드 순환) ────────────────────────
  const handleFetchMissingCoords = async () => {
    const targets = records.filter(r => (!r._lat || !r._lng) && r.주소);
    if (!targets.length) { alert('좌표 미수신 데이터가 없습니다.'); return; }
    if (!window.confirm(`좌표 없는 ${targets.length}건을 카카오 API로 조회합니다.\n(1라운드 도로명 → 2라운드 키워드 → 3라운드 행정동+주소)\n계속하시겠습니까?`)) return;
    setIsFetchingCoords(true);
    const updates = {};
    const concurrency = 10;

    const fetchCoord = async (url) => {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` }, signal: ctrl.signal });
        clearTimeout(tid);
        if (!res.ok) return null;
        const data = await res.json();
        const d = data.documents?.[0];
        return (d?.x && d?.y) ? { lat: parseFloat(d.y), lng: parseFloat(d.x) } : null;
      } catch { clearTimeout(tid); return null; }
    };

    // 2단계: 캐시에서 먼저 확인 (API 호출 전)
    const cacheCity = isCloudMode ? cloudCity : (fileInfo?.city || '');
    if (cacheCity) {
      setCoordProgress({ done: 0, total: targets.length, round: 0 });
      let cacheHits = 0;
      for (const r of targets) {
        const road = extractRoadAddress(r.주소);
        const cached = await getCachedCoord(cacheCity, road);
        if (cached) { updates[r.id] = cached; cacheHits++; }
        setCoordProgress(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
      }
      if (cacheHits > 0) console.log(`좌표 캐시 ${cacheHits}건 즉시 적용`);
    }

    const runRound = async (roundTargets, round, queryFn) => {
      if (!roundTargets.length) return;
      setCoordProgress({ done: 0, total: roundTargets.length, round });
      const executing = new Set();
      for (const r of roundTargets) {
        const p = (async () => {
          const coord = await fetchCoord(queryFn(r));
          if (coord) {
            updates[r.id] = coord;
            // 캐시에 저장
            if (cacheCity) await saveCoordCache(cacheCity, extractRoadAddress(r.주소), coord.lat, coord.lng);
          }
          setCoordProgress(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
        })().then(() => executing.delete(p));
        executing.add(p);
        if (executing.size >= concurrency) await Promise.race(executing);
      }
      await Promise.all(executing);
    };

    try {
      // 1라운드: 순수 도로명주소 추출 → address API (가장 정확)
      await runRound(targets, 1, r => {
        const road = extractRoadAddress(r.주소);
        return `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(road)}&size=1`;
      });

      // 2라운드: 캐시 미스 + 1라운드 실패 건 → keyword 검색
      const r2 = targets.filter(r => !updates[r.id]);
      await runRound(r2, 2, r => {
        const road = extractRoadAddress(r.주소);
        return `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(road)}&size=1`;
      });

      // 3라운드: 행정동 + 추출 도로명 조합 keyword
      const r3 = targets.filter(r => !updates[r.id]);
      await runRound(r3, 3, r => {
        const road = extractRoadAddress(r.주소).slice(0, 35);
        const q = r.행정동 ? `${r.행정동} ${road}` : road;
        return `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=1`;
      });

      setRecords(prev => prev.map(r => updates[r.id] ? { ...r, _lat: updates[r.id].lat, _lng: updates[r.id].lng } : r));

      // 클라우드 저장
      if (isCloudMode && cloudCity && cloudMonthId && Object.keys(updates).length) {
        const cloudUpdates = Object.entries(updates).flatMap(([id, coord]) => {
          const rec = records.find(r => r.id === id);
          return rec?._cloudDocId ? [{ docId: rec._cloudDocId, coord }] : [];
        });
        for (let i = 0; i < cloudUpdates.length; i += 499) {
          const batch = writeBatch(db);
          cloudUpdates.slice(i, i + 499).forEach(({ docId, coord }) => {
            batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', docId), { lat: coord.lat, lng: coord.lng });
          });
          await batch.commit();
        }
      }

      const success = Object.keys(updates).length;
      const remain = targets.length - success;
      alert(`✅ 좌표 보완 완료 (3라운드)\n성공: ${success}/${targets.length}건${remain > 0 ? `\n미수신 ${remain}건은 주소 재확인이 필요합니다.` : ' (100% 완료!)'}`);
    } catch (e) {
      alert('좌표 보완 실패: ' + e.message);
    } finally {
      setIsFetchingCoords(false);
      setCoordProgress(null);
    }
  };

  const addDriver = () => {
    if (drivers.length >= 8) return;
    const idx = drivers.length;
    setDrivers(prev => [...prev, { id: `d${Date.now()}`, name: `기사${idx + 1}`, color: DRIVER_COLORS[idx] }]);
    setDriverCount(c => c + 1);
  };

  const removeDriver = (id) => {
    setDrivers(prev => prev.filter(d => d.id !== id));
    setRecords(prev => prev.map(r => r._driverId === id ? { ...r, _driverId: null, 배송순번: '' } : r));
    setDriverCount(c => Math.max(1, c - 1));
  };

  // ── Gemini AI 패널 ──────────────────────────────────────────────────
  if (geminiPanel) {
    const QUICK_PROMPTS = [
      '기사별 업무능력에 맞게 균등하게 재배분해줘',
      '가장 많이 배정된 기사 일부를 적은 기사에게 이전해줘',
      '지리적으로 가장 가까운 행정동끼리 같은 기사로 묶어줘',
      '각 기사가 맡은 행정동을 내일 모레로 나눠서 일정 잡아줘',
    ];
    return (
      <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-lg bg-[#08080e] border border-purple-500/25 rounded-2xl overflow-hidden shadow-[0_0_60px_rgba(139,92,246,0.12)]">
          <div className="p-5 border-b border-[#1a1a1a]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-purple-400 text-base">✦</span>
              <span className="text-white font-black text-sm">Gemini AI 배송 최적화</span>
              <span className="ml-auto text-[9px] text-gray-600">세션 종료 시 키 자동 삭제</span>
            </div>
            <div className="text-gray-600 text-[10px]">자연어로 배송 구역·일정을 AI가 자동 조정합니다</div>
          </div>

          <div className="p-5 space-y-4">
            {/* API 키 */}
            <div>
              <div className="text-[10px] text-gray-500 mb-1.5 font-bold">Gemini API 키</div>
              <input
                type="password"
                value={geminiKey}
                onChange={e => { setGeminiKey(e.target.value); sessionStorage.setItem('nexus_gemini_key', e.target.value); }}
                placeholder="AIza..."
                className="w-full bg-[#111] border border-[#2a2a2a] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500/50 font-mono"
              />
              <div className="text-[9px] text-gray-700 mt-1">
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-400">Google AI Studio</a>에서 무료 발급 · 브라우저 세션에만 보관 (Firestore 저장 없음)
              </div>
            </div>

            {/* 빠른 요청 버튼 */}
            <div>
              <div className="text-[10px] text-gray-500 mb-1.5 font-bold">빠른 요청</div>
              <div className="grid grid-cols-2 gap-1.5">
                {QUICK_PROMPTS.map((q, i) => (
                  <button key={i} onClick={() => setGeminiPrompt(q)}
                    className="p-2 bg-[#0d0d18] border border-purple-500/15 rounded-lg text-[9px] text-purple-400/80 hover:border-purple-500/35 hover:text-purple-300 text-left transition-colors">
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* 요청 입력 */}
            <div>
              <div className="text-[10px] text-gray-500 mb-1.5 font-bold">요청 내용</div>
              <textarea
                value={geminiPrompt}
                onChange={e => setGeminiPrompt(e.target.value)}
                placeholder="예) 이진만 기사 부담이 너무 많아. 가까운 동 2개를 배영진한테 넘겨줘"
                rows={3}
                className="w-full bg-[#111] border border-[#2a2a2a] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500/50 resize-none"
              />
            </div>

            {/* 결과 */}
            {geminiResult && (
              <div className={`p-3 rounded-lg text-[11px] whitespace-pre-wrap border ${
                geminiResult.startsWith('✅') ? 'bg-purple-900/15 border-purple-500/20 text-purple-300' :
                geminiResult.startsWith('❌') ? 'bg-red-900/15 border-red-500/20 text-red-400' :
                'bg-[#111] border-[#222] text-gray-400'
              }`}>{geminiResult}</div>
            )}
          </div>

          <div className="p-4 border-t border-[#1a1a1a] flex gap-2">
            <button onClick={() => { setGeminiPanel(false); setGeminiResult(''); }}
              className="flex-1 py-2.5 bg-[#1a1a1a] text-gray-400 rounded-xl text-sm font-bold hover:text-white transition-colors">
              닫기
            </button>
            <button onClick={handleGeminiOptimize} disabled={isGeminiLoading || !geminiKey || !geminiPrompt}
              className="flex-1 py-2.5 bg-gradient-to-r from-purple-700/60 to-blue-700/60 text-white border border-purple-500/40 rounded-xl text-sm font-bold hover:from-purple-600/70 hover:to-blue-600/70 disabled:opacity-40 flex items-center justify-center gap-2 transition-all">
              {isGeminiLoading ? <><RefreshCw size={14} className="animate-spin" />분석 중...</> : <>✦ AI 최적화 실행</>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 공유 패널 ───────────────────────────────────────────────────────
  if (sharePanel && shareId) {
    return (
      <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-lg bg-[#0a0a0a] border border-[#22c55e]/20 rounded-2xl overflow-hidden shadow-[0_0_60px_rgba(34,197,94,0.1)]">
          <div className="p-5 border-b border-[#1a1a1a]">
            <div className="flex items-center gap-2 mb-1">
              <Share2 size={16} className="text-[#22c55e]" />
              <span className="text-white font-black text-sm">기사별 공유 링크</span>
            </div>
            <div className="text-gray-600 text-[10px]">
              링크를 기사에게 전달하면 본인 배송 루트만 지도에 표시됩니다
            </div>
          </div>

          <div className="p-5 space-y-3">
            {drivers.map(driver => {
              const cnt = records.filter(r => r._driverId === driver.id).length;
              if (cnt === 0) return null;
              const url = getShareUrl(driver.id);
              const isCopied = copiedDriver === driver.id;
              return (
                <div key={driver.id} className="p-3 bg-[#0d0d0d] border border-[#1e1e1e] rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: driver.color }} />
                    <span className="text-white font-black text-sm">{driver.name}</span>
                    <span className="text-gray-600 text-xs ml-auto">{cnt}건</span>
                  </div>
                  <div className="text-[9px] text-gray-700 bg-[#060606] px-2 py-1.5 rounded font-mono truncate mb-2">{url}</div>
                  <div className="flex gap-1.5">
                    <button onClick={() => handleCopyUrl(driver)}
                      className={`flex-1 py-1.5 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all ${isCopied ? 'bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30' : 'bg-[#1a1a1a] text-gray-400 border border-[#2a2a2a] hover:text-white'}`}>
                      {isCopied ? <><Check size={10} /> 복사됨</> : <><Copy size={10} /> 링크 복사</>}
                    </button>
                    <button onClick={() => handleDownloadDriverKML(driver)}
                      className="flex-1 py-1.5 bg-[#0d1a2e] text-blue-400 border border-blue-500/25 rounded text-[10px] font-bold hover:bg-blue-900/25 transition-colors flex items-center justify-center gap-1">
                      <Download size={10} /> KML
                    </button>
                    <button onClick={() => handleKakaoShare(driver)}
                      className="flex-1 py-1.5 bg-[#FEE500] text-[#3A1D1D] rounded text-[10px] font-black hover:bg-[#FFD700] transition-colors flex items-center justify-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 18 18" fill="currentColor"><path d="M9 1C4.58 1 1 3.92 1 7.5c0 2.35 1.47 4.41 3.67 5.58L3.75 17l4.08-2.73C8.27 14.42 8.63 14.5 9 14.5c4.42 0 8-2.92 8-6.5S13.42 1 9 1z"/></svg>
                      카카오톡
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-5 pb-3 space-y-2">
            <button onClick={handleExportDriverExcel}
              className="w-full py-2.5 bg-[#0d1520] border border-blue-500/20 text-blue-400 rounded-xl text-xs font-bold hover:bg-blue-900/20 transition-colors flex items-center justify-center gap-2">
              <FileSpreadsheet size={13} /> 담당자용 기사별 엑셀 다운로드
            </button>
            <div className="text-[9px] text-gray-700 text-center">기사에게 직접 전달 금지 — 담당자 검토 후 배포</div>

            <div className="bg-[#0a0f0a] border border-[#22c55e]/10 rounded-xl p-3">
              <div className="text-[9px] text-[#22c55e]/70 font-black mb-1.5">KML → 카카오맵 나만의 지도 등록 방법</div>
              <div className="space-y-0.5">
                {['① 위 기사 카드에서 KML 다운로드', '② 카카오맵 앱 실행 → 나만의 지도', '③ 우측 상단 [가져오기] → KML 파일 선택', '④ 핀 자동 등록 완료 → 카카오톡으로 공유'].map((t, i) => (
                  <div key={i} className="text-[9px] text-gray-600">{t}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-[#1a1a1a] flex items-center gap-2">
            <Clock size={11} className="text-gray-700" />
            <span className="text-[9px] text-gray-700">링크는 영구 유지됩니다</span>
            <button onClick={() => setSharePanel(false)}
              className="ml-auto px-4 py-2 bg-[#1a1a1a] text-gray-400 rounded-lg text-xs font-bold hover:text-white transition-colors">
              배정 화면으로 돌아가기
            </button>
            <button onClick={onClose}
              className="px-4 py-2 bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30 rounded-lg text-xs font-bold hover:bg-[#22c55e]/30 transition-colors">
              닫기
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 클라우드 피커 모달 ──────────────────────────────────────────────
  if (showCloudPicker) {
    return (
      <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-[#0a0a0a] border border-blue-500/20 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(59,130,246,0.1)]">
          <div className="p-5 border-b border-[#1a1a1a] flex items-center gap-2">
            <HardDrive size={16} className="text-blue-400" />
            <span className="text-white font-black text-sm">클라우드 명단 불러오기</span>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <div className="text-[10px] text-gray-500 mb-1.5 font-bold">지자체명</div>
              <input
                value={cloudPickerCity}
                onChange={e => setCloudPickerCity(e.target.value)}
                placeholder="예) 영양군"
                className="w-full bg-[#111] border border-[#2a2a2a] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <div className="text-[10px] text-gray-500 mb-1.5 font-bold">월 (YYYY-MM)</div>
              <input
                value={cloudPickerMonth}
                onChange={e => setCloudPickerMonth(e.target.value)}
                placeholder="예) 2026-05"
                className="w-full bg-[#111] border border-[#2a2a2a] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div className="text-[10px] text-gray-600">
              클라우드에 저장된 해당 월 명단(좌표 포함)을 불러옵니다.<br/>
              기사 배정 후 [클라우드 저장] 버튼으로 다시 저장하세요.
            </div>
          </div>
          <div className="p-4 border-t border-[#1a1a1a] flex gap-2">
            <button onClick={() => setShowCloudPicker(false)}
              className="flex-1 py-2 bg-[#1a1a1a] text-gray-400 rounded-lg text-sm font-bold hover:text-white transition-colors">
              취소
            </button>
            <button onClick={handleLoadFromCloud} disabled={isLoadingCloud}
              className="flex-1 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-bold hover:bg-blue-500/30 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
              {isLoadingCloud ? <RefreshCw size={13} className="animate-spin" /> : <HardDrive size={13} />}
              {isLoadingCloud ? '불러오는 중...' : '불러오기'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" style={{ fontFamily: 'inherit' }}>

      {/* ── 헤더 ───────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-[#0a0a0a] border-b border-[#222] px-4 py-2 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-[#22c55e]" />
          <span className="text-white font-black text-sm tracking-wide">배송 구역 배정</span>
          {isCloudMode
            ? <span className="text-blue-400 text-xs font-bold">[클라우드] {cloudCity} {cloudMonthId}</span>
            : <span className="text-gray-600 text-xs">{fileInfo?.city} {fileInfo?.month}</span>
          }
        </div>

        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-[#22c55e]">
            지도 {withCoordCount.toLocaleString()}건
            {aptWithCoord > 0 && <span className="text-orange-400/80"> · 아파트좌표 {aptWithCoord.toLocaleString()}건</span>}
            <span className="text-[#22c55e]/50"> ({withCoordPct}%)</span>
          </span>
          {aptCount > 0 && aptWithCoord < aptCount && (
            <span className="text-orange-400"><Building2 size={9} className="inline mr-0.5" />아파트 {aptCount.toLocaleString()}건</span>
          )}
          {totalNoCoord > 0 && (
            <span className="text-[10px] text-red-400/70">좌표없음 {totalNoCoord.toLocaleString()}건</span>
          )}
        </div>

        {overlapCount > 0 && (
          <button onClick={handleResolveOverlap}
            className="flex items-center gap-1 px-2 py-0.5 bg-amber-900/40 border border-amber-700/40 rounded text-amber-400 text-[10px] hover:bg-amber-900/60">
            <AlertTriangle size={10} /> 동선 겹침 {overlapCount}건 — 자동 해소
          </button>
        )}
        {overlapCount === 0 && withCoordCount > 0 && (
          <span className="text-[10px] text-[#22c55e]/60">✓ 동선 겹침 없음</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* 세션 상태 표시 + 저장 버튼 */}
          {isCloudMode && (
            <div className="flex items-center gap-1.5">
              {hasUnsaved && <span className="text-[9px] text-amber-400 animate-pulse">● 미저장</span>}
              {!hasUnsaved && sessionStatus && (
                <span className="text-[9px] text-[#22c55e]/70">
                  {sessionStatus === 'final' ? '✓ 최종저장' : '✓ 임시저장'}{lastAutoSave ? ` ${lastAutoSave.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
              )}
              <button onClick={handleLoadSession}
                className="px-2.5 py-1.5 bg-[#111] border border-[#2a2a2a] text-gray-400 hover:text-cyan-400 hover:border-cyan-500/40 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors">
                <RefreshCw size={11} /> 이어서 작업
              </button>
              <button onClick={() => handleSaveSession(false)} disabled={isSavingSession}
                className="px-2.5 py-1.5 bg-[#111] border border-amber-500/30 text-amber-400 hover:bg-amber-900/20 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors disabled:opacity-50">
                <Save size={11} /> 임시저장
              </button>
              <button onClick={handleLoadPrevMonth}
                className="px-2.5 py-1.5 bg-[#0d1520] border border-blue-500/30 text-blue-400 hover:bg-blue-900/20 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors">
                <Clock size={11} /> 이전달 승계
              </button>
            </div>
          )}
          {/* AI 최적화 버튼 */}
          <button onClick={() => setGeminiPanel(true)}
            className="px-3 py-1.5 bg-gradient-to-r from-purple-900/40 to-blue-900/40 border border-purple-500/40 text-purple-300 hover:border-purple-400/60 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors">
            ✦ AI 최적화
          </button>
          {/* 좌표 매칭 버튼 */}
          <button onClick={handleFetchMissingCoords} disabled={isFetchingCoords}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition-colors disabled:opacity-50 ${
              totalNoCoord > 0
                ? 'bg-red-900/30 border-red-600/50 text-red-400 hover:bg-red-800/40'
                : 'bg-[#111] border-[#2a2a2a] text-gray-500 hover:text-gray-300'
            }`}>
            {isFetchingCoords
              ? <><RefreshCw size={12} className="animate-spin" />{coordProgress ? `${coordProgress.done}/${coordProgress.total} [${coordProgress.round}R]` : '준비중...'}</>
              : <><MapPin size={12} />좌표 매칭{totalNoCoord > 0 ? ` (${totalNoCoord}건)` : ' ✓'}</>
            }
          </button>
          {/* 자동 순번 버튼 */}
          <button onClick={handleAutoSequence}
            className="px-3 py-1.5 bg-[#0d1520] border border-purple-500/30 text-purple-400 hover:bg-purple-900/20 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors">
            <Navigation2 size={12} /> 자동 순번
          </button>
          <div className="flex rounded-lg overflow-hidden border border-[#2a2a2a]" title="레이아웃 선택">
            <button onClick={() => setLayoutMode('map')} title="지도만"
              className={`px-2.5 py-1.5 text-xs font-bold flex items-center gap-1 transition-colors ${layoutMode === 'map' ? 'bg-[#1a2e1a] text-[#22c55e]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <Map size={12} />
            </button>
            <button onClick={() => setLayoutMode('split')} title="지도+목록 분할"
              className={`px-2.5 py-1.5 text-xs font-bold flex items-center gap-1 transition-colors border-x border-[#2a2a2a] ${layoutMode === 'split' || layoutMode === 'mapfull' ? 'bg-[#1a2e1a] text-[#22c55e]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <Columns size={12} />
            </button>
            <button onClick={() => setLayoutMode('list')} title="목록만"
              className={`px-2.5 py-1.5 text-xs font-bold flex items-center gap-1 transition-colors ${layoutMode === 'list' ? 'bg-[#1a2e1a] text-[#22c55e]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <List size={12} />
            </button>
          </div>
          <button onClick={() => setShowCloudPicker(true)}
            className="px-3 py-1.5 bg-[#111] border border-[#2a2a2a] text-gray-400 hover:text-blue-400 hover:border-blue-500/40 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors">
            <HardDrive size={12} /> 클라우드 불러오기
          </button>
          <button onClick={handleExportDriverExcel}
            className="px-3 py-1.5 bg-[#1a1a2e] text-blue-400 border border-blue-500/30 hover:bg-blue-900/20 rounded-lg text-xs font-bold flex items-center gap-1.5">
            <FileSpreadsheet size={12} /> 담당자용 엑셀
          </button>
          <button onClick={handleDownloadRouteBundle}
            className="px-3 py-1.5 bg-[#1a2510] text-emerald-400 border border-emerald-600/40 hover:bg-emerald-900/20 rounded-lg text-xs font-bold flex items-center gap-1.5">
            <Download size={12} /> 배송루트 다운로드
          </button>
          {isCloudMode ? (
            <button onClick={() => handleSaveSession(true)} disabled={isSavingSession}
              className="px-3 py-1.5 bg-[#1a2e1a] text-[#22c55e] border border-[#22c55e]/40 hover:bg-[#22c55e]/20 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
              {isSavingSession ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
              {isSavingSession ? '저장 중...' : '최종 저장'}
            </button>
          ) : (
            <button onClick={handleSave}
              className="px-3 py-1.5 bg-[#1a2a1a] text-[#22c55e] border border-[#22c55e]/30 hover:bg-[#22c55e]/20 rounded-lg text-xs font-bold flex items-center gap-1.5">
              <Save size={12} /> 저장
            </button>
          )}
          <button onClick={handleShare} disabled={isSaving}
            className="px-3 py-1.5 bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/50 hover:bg-[#22c55e]/30 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
            {isSaving ? <RefreshCw size={12} className="animate-spin" /> : <Share2 size={12} />}
            {isSaving ? '생성 중...' : '공유 링크'}
          </button>
          <button onClick={onClose} className="p-2 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white border border-red-700/40 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── 바디 ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 relative">

        {/* 좌측 패널 — mapfull 모드에서 숨김 */}
        <div className={`w-60 shrink-0 bg-[#070707] border-r border-[#1a1a1a] flex flex-col overflow-hidden ${layoutMode === 'mapfull' ? 'hidden' : ''}`}>

          {/* 행정동 필터 */}
          <div className="p-3 border-b border-[#1a1a1a]">
            <div className="text-[9px] text-gray-600 mb-1.5 font-black tracking-widest uppercase">행정동 필터</div>
            <select value={selectedDong} onChange={e => setSelectedDong(e.target.value)}
              className="w-full bg-[#111] text-white text-xs border border-[#2a2a2a] rounded px-2 py-1.5 focus:outline-none focus:border-[#22c55e]/40">
              {dongList.map(d => <option key={d}>{d}</option>)}
            </select>
            <div className="mt-1 text-[9px] text-gray-700">
              {filteredRecords.length}건 | 미배정 <span className={unassigned > 0 ? 'text-amber-500' : 'text-[#22c55e]'}>{unassigned}건</span>
            </div>
          </div>

          {/* 행정동-기사 배정 버튼 */}
          <div className="p-3 border-b border-[#1a1a1a]">
            <button onClick={() => setShowDongAssign(true)}
              className="w-full py-2.5 bg-purple-900/20 border border-purple-500/30 text-purple-400 rounded-lg text-xs font-bold hover:bg-purple-900/40 transition-colors flex items-center justify-center gap-2">
              <Navigation2 size={12} /> 행정동 기사 배정
              {Object.keys(dongAssignments).length > 0 && (
                <span className="bg-purple-800/40 px-1.5 py-0.5 rounded text-[9px]">
                  {Object.keys(dongAssignments).length}개 동
                </span>
              )}
            </button>
            {Object.keys(dongAssignments).length > 0 && (
              <div className="mt-2 space-y-0.5 max-h-24 overflow-y-auto">
                {Object.entries(dongAssignments).map(([dong, assignments]) => (
                  <div key={dong} className="flex items-center gap-1 px-1 text-[9px]">
                    <span className="text-gray-600 truncate flex-1">{dong}</span>
                    <span className="text-purple-500 shrink-0">
                      {assignments.map(a => drivers.find(d => d.id === a.driverId)?.name || '?').join('+')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 자동 배정 */}
          <div className="p-3 border-b border-[#1a1a1a]">
            <div className="text-[9px] text-gray-600 mb-2 font-black tracking-widest uppercase">자동 배정</div>
            <div className="flex gap-1 mb-2">
              {[['boustrophedon', 'K-means'], ['apt', '아파트동']].map(([v, l]) => (
                <button key={v} onClick={() => setSplitMode(v)}
                  className={`flex-1 py-1 text-[9px] font-bold rounded border transition-colors ${splitMode === v ? 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30' : 'bg-[#111] text-gray-600 border-[#222] hover:text-gray-400'}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setDriverCount(c => Math.max(1, c - 1))}
                className="w-7 h-7 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-gray-400 hover:text-white flex items-center justify-center">
                <Minus size={11} />
              </button>
              <span className="flex-1 text-center text-white font-black">{driverCount}명</span>
              <button onClick={() => setDriverCount(c => Math.min(8, c + 1))}
                className="w-7 h-7 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-gray-400 hover:text-white flex items-center justify-center">
                <Plus size={11} />
              </button>
            </div>
            <button onClick={handleAutoSplit} disabled={isSplitting || withCoordCount === 0}
              className="w-full py-1.5 bg-[#22c55e]/15 border border-[#22c55e]/25 text-[#22c55e] rounded text-xs font-bold hover:bg-[#22c55e]/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-colors">
              {isSplitting ? <><RefreshCw size={11} className="animate-spin" /> 배정 중...</> : <><Navigation2 size={11} /> 자동 {driverCount}등분</>}
            </button>

            {/* 지난달 배정 불러오기 */}
            <button onClick={handleLoadLastMonth}
              className="w-full mt-1.5 py-1.5 bg-[#111] border border-[#2a2a2a] text-gray-500 rounded text-[10px] font-bold hover:text-gray-300 hover:border-[#3a3a3a] flex items-center justify-center gap-1.5 transition-colors">
              <Clock size={10} /> 지난달 배정 불러오기
            </button>
            <div className="text-[9px] text-gray-700 mt-1 text-center">기사명이 일치해야 적용됩니다</div>
          </div>

          {/* 기사 목록 */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[9px] text-gray-600 font-black tracking-widest uppercase">기사 목록</div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setScheduleMode(v => !v)}
                  className={`text-[9px] px-1.5 py-0.5 rounded border font-bold transition-colors ${scheduleMode ? 'bg-purple-900/30 border-purple-500/40 text-purple-400' : 'bg-[#111] border-[#222] text-gray-600 hover:text-gray-400'}`}>
                  일정
                </button>
                <button onClick={addDriver} disabled={drivers.length >= 8}
                  className="text-[10px] text-[#22c55e] hover:text-[#86efac] disabled:text-gray-700 flex items-center gap-0.5">
                  <Plus size={10} /> 추가
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <button onClick={() => setSelectedDriverFilter(selectedDriverFilter === 'none' ? 'all' : 'none')}
                className={`w-full p-2 rounded-lg border text-left transition-colors ${selectedDriverFilter === 'none' ? 'bg-[#1a1a1a] border-gray-600' : 'bg-[#0d0d0d] border-[#1e1e1e] hover:border-[#2a2a2a]'}`}>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-600 shrink-0" />
                  <span className="text-gray-400 text-xs flex-1">미배정</span>
                  <span className="text-[10px] text-gray-600 font-bold">{unassigned}건</span>
                </div>
              </button>
              {drivers.map(d => {
                const cnt = filteredRecords.filter(r => r._driverId === d.id).length;
                const isActive = selectedDriverFilter === d.id;
                return (
                  <div key={d.id}
                    className={`p-2 rounded-lg border transition-colors cursor-pointer`}
                    style={{ borderColor: isActive ? d.color + '60' : '#1e1e1e', background: isActive ? d.color + '10' : '#0d0d0d' }}
                    onClick={() => setSelectedDriverFilter(isActive ? 'all' : d.id)}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                      <input value={d.name}
                        onChange={e => setDrivers(prev => prev.map(dr => dr.id === d.id ? { ...dr, name: e.target.value } : dr))}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 bg-transparent text-white text-xs focus:outline-none min-w-0" />
                      <span className="text-[10px] font-black shrink-0" style={{ color: d.color }}>{cnt}건</span>
                      <button onClick={e => { e.stopPropagation(); handleDownloadDriverKML(d); }}
                        title="KML 다운로드"
                        className="text-gray-700 hover:text-blue-400 transition-colors shrink-0">
                        <Download size={10} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); removeDriver(d.id); }}
                        className="text-gray-700 hover:text-red-400 transition-colors shrink-0">
                        <X size={10} />
                      </button>
                    </div>
                    {/* 배송일 배정 */}
                    {scheduleMode && (
                      <div className="mt-1.5 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <span className="text-[9px] text-gray-600">배송일</span>
                        <input type="date" value={d.deliveryDate || ''}
                          onChange={e => setDrivers(prev => prev.map(dr => dr.id === d.id ? { ...dr, deliveryDate: e.target.value } : dr))}
                          className="flex-1 bg-[#111] border border-[#2a2a2a] text-[9px] text-white rounded px-1 py-0.5 focus:outline-none focus:border-purple-500/40" />
                        {d.deliveryDate && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ background: d.color + '25', color: d.color }}>
                            {d.deliveryDate.slice(5)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-3 border-t border-[#1a1a1a] space-y-1">
            <div className="text-[9px] text-gray-700 font-black tracking-widest uppercase mb-1">범례</div>
            <div className="flex items-center gap-1.5 text-[9px] text-gray-600">
              <div className="w-2 h-2 rounded-full bg-[#ef4444]" />주소 확인필요
            </div>
            <div className="flex items-center gap-1.5 text-[9px] text-gray-600">
              <div className="w-2 h-2 rounded-full bg-gray-600" />미배정
            </div>
            {drivers.map(d => (
              <div key={d.id} className="flex items-center gap-1.5 text-[9px] text-gray-500">
                <div className="w-2 h-2 rounded-full" style={{ background: d.color }} />{d.name}
              </div>
            ))}
          </div>
        </div>

        {/* 지도 + 목록 영역 */}
        <div className="flex-1 min-w-0 flex min-h-0">

          {/* ── 지도 영역 — 항상 마운트, layoutMode로만 표시 제어 ── */}
          <div className={
            layoutMode === 'mapfull' ? 'absolute inset-0 z-[60] bg-[#080808] flex flex-col' :
            layoutMode === 'list'    ? 'hidden' :
            layoutMode === 'map'     ? 'flex-1 flex flex-col relative' :
            /* split */                'flex-1 flex flex-col relative min-w-0'
          }>
            {!isMapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#080808] z-10">
                <RefreshCw size={22} className="text-[#22c55e] animate-spin" />
              </div>
            )}
            <div ref={mapRef} className="flex-1" onDoubleClick={() => setLayoutMode('mapfull')} />

            {/* 지도 오버레이 버튼 */}
            <div className="absolute top-2 right-2 z-10 flex gap-1.5">
              {layoutMode === 'mapfull' ? (
                <button
                  onClick={() => setLayoutMode('split')}
                  className="px-2.5 py-1.5 bg-black/80 hover:bg-black text-white border border-white/20 rounded-lg text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm shadow-xl"
                >
                  <Minimize2 size={11} /> 분할보기 <span className="text-white/40 text-[9px]">Esc</span>
                </button>
              ) : (
                <button
                  onClick={() => setLayoutMode('mapfull')}
                  title="전체화면 (더블클릭도 가능)"
                  className="px-2.5 py-1.5 bg-black/70 hover:bg-black/95 text-white/80 hover:text-white border border-white/15 rounded-lg text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm shadow-lg transition-all"
                >
                  <Maximize2 size={11} /> 전체화면
                </button>
              )}
            </div>

            {/* 아파트 목록 — map / mapfull 모드: 지도 하단 */}
            {layoutMode !== 'split' && aptRecords.length > 0 && (
              <div className="shrink-0 border-t border-[#1a1a1a] bg-[#070707]" style={{ maxHeight: '200px' }}>
                <button onClick={() => setAptListExpanded(v => !v)}
                  className="w-full px-4 py-2 flex items-center gap-2 text-orange-400 text-[10px] font-black tracking-widest hover:bg-[#0f0f0f] transition-colors">
                  <Building2 size={11} />아파트 ({aptRecords.length}건) — 동호수 기준 수동 배정
                  <span className="ml-auto text-gray-600">{aptListExpanded ? '▲' : '▼'}</span>
                </button>
                {aptListExpanded && (
                  <div className="overflow-auto" style={{ maxHeight: '160px' }}>
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 bg-[#0d0d0d]">
                        <tr className="border-b border-[#1e1e1e]">
                          {['기사', '행정동', '이름', '주소', '배송순번'].map(h => (
                            <th key={h} className="px-3 py-1.5 text-left text-[9px] text-orange-800 font-black">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...aptRecords].sort((a, b) => {
                          const dA = parseAptDong(a.주소) ?? 999, dB = parseAptDong(b.주소) ?? 999;
                          if (dA !== dB) return dA - dB;
                          const { floor: fA, ho: hA } = parseFloorHo(a.주소);
                          const { floor: fB, ho: hB } = parseFloorHo(b.주소);
                          return fA !== fB ? fA - fB : hA - hB;
                        }).map(r => {
                          const driver = drivers.find(d => d.id === r._driverId);
                          return (
                            <tr key={r.id} className="border-b border-[#0f0f0f] hover:bg-[#0f0905]">
                              <td className="px-3 py-1">
                                <select value={r._driverId || ''}
                                  onChange={e => setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, _driverId: e.target.value || null } : pr))}
                                  className="bg-[#111] border border-[#222] rounded px-1 py-0.5 text-[9px] focus:outline-none"
                                  style={{ color: driver?.color || '#6b7280' }}>
                                  <option value="">미배정</option>
                                  {drivers.map(d => <option key={d.id} value={d.id} style={{ color: d.color }}>{d.name}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-1 text-gray-600 text-[9px]">{r.행정동}</td>
                              <td className="px-3 py-1 text-white text-[9px] font-bold">{r.이름}</td>
                              <td className="px-3 py-1 text-orange-900 text-[9px] max-w-xs truncate">{r.주소}</td>
                              <td className="px-3 py-1">
                                <input value={r.배송순번 || ''}
                                  onChange={e => setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, 배송순번: e.target.value } : pr))}
                                  className="w-12 bg-[#111] border border-[#222] rounded px-1 py-0.5 text-[9px] text-orange-400 text-center focus:outline-none" />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 분할 구분선 */}
          {layoutMode === 'split' && (
            <div className="w-[3px] shrink-0 bg-[#1a1a1a] hover:bg-[#2a2a2a] cursor-col-resize transition-colors" />
          )}

          {/* ── 목록 패널 — split / list 모드 ── */}
          {(layoutMode === 'split' || layoutMode === 'list') && (
            <div className={`overflow-auto bg-[#060606] flex flex-col ${
              layoutMode === 'split' ? 'w-[42%] shrink-0' : 'flex-1'
            }`}>
              <div className="px-4 py-2 text-[9px] text-gray-600 font-black tracking-widest border-b border-[#1a1a1a] sticky top-0 bg-[#060606] z-10">
                지도 핀 ({displayRecords.filter(r => !r._isApt).length}건)
              </div>
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-[29px] bg-[#0d0d0d] z-10">
                  <tr className="border-b border-[#1e1e1e]">
                    {['#', '기사', '행정동', '이름', '주소', '배송순번', '좌표'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] text-gray-600 font-black">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRecords.filter(r => !r._isApt).map((r, idx) => {
                    const driver = drivers.find(d => d.id === r._driverId);
                    return (
                      <tr key={r.id} className={`border-b border-[#111] hover:bg-[#0f0f0f] ${!r._lat ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-1.5 text-gray-700">{idx + 1}</td>
                        <td className="px-3 py-1.5">
                          <select value={r._driverId || ''}
                            onChange={e => setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, _driverId: e.target.value || null } : pr))}
                            className="bg-[#111] border border-[#222] rounded px-1 py-0.5 text-[10px] focus:outline-none"
                            style={{ color: driver?.color || '#6b7280' }}>
                            <option value="">미배정</option>
                            {drivers.map(d => <option key={d.id} value={d.id} style={{ color: d.color }}>{d.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-1.5 text-gray-400">{r.행정동}</td>
                        <td className="px-3 py-1.5 text-white font-bold">{r.이름}</td>
                        <td className="px-3 py-1.5 text-gray-400 max-w-xs truncate">{r.주소}</td>
                        <td className="px-3 py-1.5">
                          <input value={r.배송순번 || ''}
                            onChange={e => setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, 배송순번: e.target.value } : pr))}
                            className="w-14 bg-[#111] border border-[#222] rounded px-1 py-0.5 text-[10px] text-[#22c55e] text-center focus:outline-none" />
                        </td>
                        <td className="px-3 py-1.5 text-[9px]">
                          {r._lat ? <span className="text-[#22c55e]">✓</span> : <span className="text-red-400">✗</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {aptRecords.length > 0 && (
                <>
                  <div className="px-4 py-2 text-[9px] text-orange-700 font-black tracking-widest border-b border-t border-[#1a1a1a] bg-[#0a0805] sticky top-0 z-10">
                    <Building2 size={9} className="inline mr-1" />아파트 ({aptRecords.length}건)
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <tbody>
                      {[...aptRecords].sort((a, b) => {
                        const dA = parseAptDong(a.주소) ?? 999, dB = parseAptDong(b.주소) ?? 999;
                        if (dA !== dB) return dA - dB;
                        const { floor: fA, ho: hA } = parseFloorHo(a.주소);
                        const { floor: fB, ho: hB } = parseFloorHo(b.주소);
                        return fA !== fB ? fA - fB : hA - hB;
                      }).map((r, idx) => {
                        const driver = drivers.find(d => d.id === r._driverId);
                        return (
                          <tr key={r.id} className="border-b border-[#0f0f0f] hover:bg-[#0f0905]">
                            <td className="px-3 py-1.5 text-orange-900/60">{idx + 1}</td>
                            <td className="px-3 py-1.5">
                              <select value={r._driverId || ''}
                                onChange={e => setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, _driverId: e.target.value || null } : pr))}
                                className="bg-[#111] border border-[#222] rounded px-1 py-0.5 text-[10px] focus:outline-none"
                                style={{ color: driver?.color || '#6b7280' }}>
                                <option value="">미배정</option>
                                {drivers.map(d => <option key={d.id} value={d.id} style={{ color: d.color }}>{d.name}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-1.5 text-gray-500">{r.행정동}</td>
                            <td className="px-3 py-1.5 text-white font-bold">{r.이름}</td>
                            <td className="px-3 py-1.5 text-orange-900 max-w-xs truncate">{r.주소}</td>
                            <td className="px-3 py-1.5">
                              <input value={r.배송순번 || ''}
                                onChange={e => setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, 배송순번: e.target.value } : pr))}
                                className="w-14 bg-[#111] border border-[#222] rounded px-1 py-0.5 text-[10px] text-orange-400 text-center focus:outline-none" />
                            </td>
                            <td className="px-3 py-1.5 text-[9px] text-orange-800">APT</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── 선택 핀 상세정보 팝업 ── */}
        {selectedRecord && (
          <div className="absolute bottom-4 right-4 z-[80] w-72 bg-[#080808] border border-[#22c55e]/30 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.97)] overflow-hidden pointer-events-auto">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: drivers.find(d => d.id === selectedRecord._driverId)?.color || '#6b7280' }} />
                <span className="text-white font-black text-sm">{selectedRecord.이름}</span>
                {selectedRecord.배송순번 && <span className="text-[#22c55e] text-xs font-black">#{selectedRecord.배송순번}</span>}
              </div>
              <button onClick={() => setSelectedRecord(null)} className="text-gray-600 hover:text-white transition-colors"><X size={14} /></button>
            </div>
            <div className="px-4 py-3 space-y-1.5 text-[11px]">
              <div className="flex gap-2"><span className="text-gray-600 w-14 shrink-0">주소</span><span className="text-gray-300 leading-snug">{selectedRecord.주소}</span></div>
              <div className="flex gap-2"><span className="text-gray-600 w-14 shrink-0">행정동</span><span className="text-gray-400">{selectedRecord.행정동}</span></div>
              <div className="flex gap-2">
                <span className="text-gray-600 w-14 shrink-0">포수</span>
                <span className="text-[#22c55e] font-black">{selectedRecord.포수 || selectedRecord['수량(포수)'] || '-'}포</span>
              </div>
              {(selectedRecord.휴대폰 || selectedRecord.유선전화) && (
                <div className="flex gap-2"><span className="text-gray-600 w-14 shrink-0">연락처</span><span className="text-gray-400">{selectedRecord.휴대폰 || selectedRecord.유선전화}</span></div>
              )}
              {selectedRecord.특이사항 && (
                <div className="flex gap-2"><span className="text-gray-600 w-14 shrink-0">특이사항</span><span className="text-amber-400 leading-snug">{selectedRecord.특이사항}</span></div>
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-[#1a1a1a] flex items-center gap-2">
              <select
                value={selectedRecord._driverId || ''}
                onChange={e => {
                  const nid = e.target.value || null;
                  setRecords(prev => prev.map(r => r.id === selectedRecord.id ? { ...r, _driverId: nid } : r));
                  setSelectedRecord(prev => ({ ...prev, _driverId: nid }));
                }}
                className="flex-1 bg-[#111] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#22c55e]/40"
                style={{ color: drivers.find(d => d.id === selectedRecord._driverId)?.color || '#6b7280' }}
              >
                <option value="">미배정</option>
                {drivers.map(d => <option key={d.id} value={d.id} style={{ color: d.color }}>{d.name}</option>)}
              </select>
              <button
                onClick={() => {
                  setRecords(prev => prev.map(r => r.id === selectedRecord.id ? { ...r, 배송순번: String((parseInt(selectedRecord.배송순번) || 0) + 1) } : r));
                  setSelectedRecord(prev => ({ ...prev, 배송순번: String((parseInt(prev.배송순번) || 0) + 1) }));
                }}
                className="px-2.5 py-1.5 bg-[#1a2e1a] border border-[#22c55e]/25 text-[#22c55e] rounded-lg text-[10px] font-black hover:bg-[#22c55e]/20 transition-colors shrink-0"
                title="순번 +1"
              >
                순번 {selectedRecord.배송순번 || '-'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ 행정동-기사 배정 전체화면 오버레이 ═══ */}
      {showDongAssign && (
        <div className="absolute inset-0 z-[200] bg-[#050505] flex flex-col">

          {/* 헤더 */}
          <div className="shrink-0 h-14 bg-[#080808] border-b border-[#222] px-5 flex items-center gap-3">
            <Navigation2 size={16} className="text-purple-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-black text-white leading-tight">
                {workDongStep === 'select' ? '작업 행정동 선택' : '행정동별 기사 배치'}
              </h2>
              <p className="text-[10px] text-gray-600 leading-tight truncate">
                {workDongStep === 'select'
                  ? `${dongList.filter(d => d !== '전체').length}개 행정동 · 배정 작업할 동을 선택하세요`
                  : `${Object.keys(dongAssignments).length}개 동 · 기사를 배치하고 적용률 합계를 N×100%로 맞추세요`
                }
              </p>
            </div>
            {workDongStep === 'assign' && (
              <button onClick={() => setWorkDongStep('select')}
                className="flex items-center gap-1.5 text-[11px] text-purple-400 hover:text-purple-300 bg-purple-900/20 border border-purple-500/20 px-3 py-1.5 rounded-lg transition-colors shrink-0">
                ← 동 재선택
              </button>
            )}
            <button onClick={() => setShowDongAssign(false)}
              className="ml-auto p-2 text-gray-600 hover:text-white transition-colors shrink-0">
              <X size={16} />
            </button>
          </div>

          {/* 바디 */}
          <div className="flex-1 overflow-auto bg-[#060606]">
            {workDongStep === 'select' ? (

              /* ─ Step 1: 행정동 선택 ─ */
              <div className="p-5">
                <div className="max-w-4xl mx-auto space-y-3">

                  {/* 전체 선택 */}
                  <label className="flex items-center gap-3 p-4 bg-[#0d0d0d] rounded-xl border border-[#2a2a2a] cursor-pointer hover:border-purple-500/30 transition-colors group">
                    <input type="checkbox"
                      checked={dongList.filter(d => d !== '전체').length > 0 && workDongSelection.size === dongList.filter(d => d !== '전체').length}
                      onChange={e => {
                        const all = dongList.filter(d => d !== '전체');
                        setWorkDongSelection(e.target.checked ? new Set(all) : new Set());
                      }}
                      className="accent-purple-500 w-5 h-5 shrink-0" />
                    <span className="text-white font-black text-sm group-hover:text-purple-300 transition-colors">전체 선택</span>
                    <span className="text-gray-600 text-xs ml-auto">{dongList.filter(d => d !== '전체').length}개 행정동 전체</span>
                  </label>

                  {/* 동 목록 */}
                  <div className="grid grid-cols-2 gap-2">
                    {dongList.filter(d => d !== '전체').map(dong => {
                      const total = records.filter(r => r.행정동 === dong).length;
                      const withCoord = records.filter(r => r.행정동 === dong && r._lat && r._lng).length;
                      const noCoord = total - withCoord;
                      const isSelected = workDongSelection.has(dong);
                      return (
                        <label key={dong}
                          className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-purple-900/15 border-purple-500/40'
                              : 'bg-[#0a0a0a] border-[#1a1a1a] hover:border-[#2a2a2a]'
                          }`}>
                          <input type="checkbox"
                            checked={isSelected}
                            onChange={e => setWorkDongSelection(prev => {
                              const next = new Set(prev);
                              e.target.checked ? next.add(dong) : next.delete(dong);
                              return next;
                            })}
                            className="accent-purple-500 w-4 h-4 shrink-0" />
                          <span className={`text-sm font-bold flex-1 truncate ${isSelected ? 'text-purple-200' : 'text-gray-400'}`}>
                            {dong}
                          </span>
                          <div className="text-right shrink-0">
                            <div className="text-xs font-black text-white">{total}건</div>
                            <div className="text-[9px] text-gray-700">
                              지도 {withCoord}
                              {noCoord > 0 && <span className="text-red-800"> ✗{noCoord}</span>}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

            ) : (

              /* ─ Step 2: 기사 배치 ─ */
              <div className="p-5">
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                  {Object.entries(dongAssignments).map(([dong, assignments]) => {
                    const totalRate = assignments.reduce((s, a) => s + (parseFloat(a.rate) || 0), 0);
                    const targetRate = assignments.length * 100;
                    const isValid = Math.abs(totalRate - targetRate) < 1;
                    const cntCoord = records.filter(r => r.행정동 === dong && !r._isApt && r._lat && r._lng).length;
                    const cntAll = records.filter(r => r.행정동 === dong).length;
                    return (
                      <div key={dong} className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <div className="text-sm font-black text-white">{dong}</div>
                            <div className="text-[10px] text-gray-600 mt-0.5">전체 {cntAll}건 · 지도 {cntCoord}건</div>
                          </div>
                          <div className={`text-xs font-black px-2 py-0.5 rounded-lg shrink-0 ml-2 ${
                            isValid
                              ? 'text-[#22c55e] bg-[#22c55e]/10 border border-[#22c55e]/20'
                              : 'text-red-400 bg-red-900/20 border border-red-500/20'
                          }`}>
                            {totalRate}/{targetRate}%
                          </div>
                        </div>
                        <div className="space-y-2">
                          {assignments.map(a => {
                            const driver = drivers.find(d => d.id === a.driverId);
                            return (
                              <div key={a.id} className="flex items-center gap-2">
                                <select value={a.driverId}
                                  onChange={e => updateDongAssignment(dong, a.id, 'driverId', e.target.value)}
                                  className="flex-1 min-w-0 bg-[#111] border border-[#252525] rounded-lg px-2.5 py-2 text-sm font-bold focus:outline-none focus:border-purple-500/40"
                                  style={{ color: driver?.color || '#6b7280' }}>
                                  {drivers.map(d => (
                                    <option key={d.id} value={d.id} style={{ color: d.color }}>{d.name}</option>
                                  ))}
                                </select>
                                <div className="flex items-center gap-1 shrink-0">
                                  <input type="number" min="1" max="999"
                                    value={a.rate}
                                    onChange={e => updateDongAssignment(dong, a.id, 'rate', parseFloat(e.target.value) || 0)}
                                    className="w-16 bg-[#111] border border-[#252525] rounded-lg px-2 py-2 text-sm text-purple-300 text-center focus:outline-none focus:border-purple-500/40" />
                                  <span className="text-xs text-gray-600">%</span>
                                </div>
                                <button onClick={() => removeDriverFromDong(dong, a.id)}
                                  disabled={assignments.length <= 1}
                                  className="w-7 h-7 flex items-center justify-center text-gray-700 hover:text-red-400 disabled:opacity-30 hover:bg-red-900/20 rounded transition-colors shrink-0">
                                  <X size={13} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <button onClick={() => addDriverToDong(dong)}
                          className="mt-3 w-full py-1.5 text-xs text-purple-600 hover:text-purple-400 border border-dashed border-[#252525] hover:border-purple-800/50 rounded-lg transition-colors flex items-center justify-center gap-1.5">
                          <Plus size={11} /> 기사 추가
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 하단 액션 바 */}
          <div className="shrink-0 h-16 bg-[#080808] border-t border-[#222] px-5 flex items-center justify-between gap-4">
            {workDongStep === 'select' ? (
              <>
                <div className="text-sm text-gray-400">
                  <span className="text-purple-400 font-black text-base">{workDongSelection.size}</span>개 선택됨
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowDongAssign(false)}
                    className="px-5 py-2 bg-[#111] border border-[#2a2a2a] text-gray-400 rounded-lg text-sm font-bold hover:text-white transition-colors">
                    취소
                  </button>
                  <button onClick={handleSaveWorkDongs} disabled={workDongSelection.size === 0}
                    className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
                    다음 — 기사 배치 →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-gray-500 min-w-0 truncate">
                  기사 <span className="text-white font-black">{drivers.length}</span>명 ·
                  기사 N명이면 합계 N×100% 맞추세요
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={handleAutoSequence}
                    className="px-4 py-2 bg-[#111] border border-[#2a2a2a] text-gray-400 hover:text-white rounded-lg text-sm font-bold transition-colors">
                    순번 자동 정렬
                  </button>
                  <button onClick={() => { handleDongAssign(); setShowDongAssign(false); }}
                    className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-bold transition-colors flex items-center gap-2">
                    <Navigation2 size={14} /> 배정 적용 후 지도 보기
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
