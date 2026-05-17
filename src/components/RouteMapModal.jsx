import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, MapPin, Navigation2, Plus, Minus, RefreshCw, Save, AlertTriangle, Map as MapIcon, List, Building2, Clock, FileSpreadsheet, Download, HardDrive, Maximize2, Minimize2, Columns, AlertCircle, Search, Crosshair, Share2, Link } from 'lucide-react';
import { db, auth } from '../config/firebase.js';
import { collection, serverTimestamp, getDocs, getDoc, setDoc, doc, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;
const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY;

const DRIVER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
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
const KAKAO_COLOR_MAP = { '#3b82f6':'blue','#3b82f6':'green','#f59e0b':'yellow','#ef4444':'red','#8b5cf6':'violet','#06b6d4':'blue','#f97316':'orange','#ec4899':'red','#14b8a6':'green','#a855f7':'violet','#84cc16':'green','#f43f5e':'red','#0ea5e9':'blue','#d97706':'yellow','#10b981':'green','#6366f1':'violet','#e11d48':'red','#0891b2':'blue','#65a30d':'green','#7c3aed':'violet' };

// ── 유효부담 자동 감지 상수 ──────────────────────────────────────────────────
const RENTAL_KEYWORDS = ['LH', 'SH', '임대', '행복주택', '국민임대', '영구임대', '공공임대', '보금자리', '매입임대'];
const STAIRS_KEYWORDS = ['빌라', '연립', '다세대', '단독주택'];
const HEAVY_NOTE_KW   = ['문앞', '거동불편', '직접전달', '현관앞', '직접'];
const MEDIUM_NOTE_KW  = ['전화필수', '골목', '경비실', '게이트'];

const getEffectiveLoad = (record) => {
  const qty  = parseInt(record.포수 || record['수량(포수)']) || 1;
  const addr = record.주소 || '';
  const note = record.특이사항 || '';
  const full = addr + ' ' + note;
  if (qty >= 20 && RENTAL_KEYWORDS.some(k => full.includes(k))) return qty * 0.3;
  if (STAIRS_KEYWORDS.some(k => addr.includes(k))) {
    const fl = parseInt(addr.match(/(\d+)\s*층/)?.[1] || '2');
    return qty * (1 + Math.min(fl, 5) * 0.1);
  }
  if (HEAVY_NOTE_KW.some(k => note.includes(k))) return qty * 1.5;
  if (MEDIUM_NOTE_KW.some(k => note.includes(k))) return qty * 1.2;
  return qty;
};

// 주소에서 아파트명 추출 (ex: "삼성래미안 101동 201호" → "삼성래미안")
const extractAptName = (addr) => {
  if (!addr) return null;
  const m = addr.match(/^(.+?)\s*\d+\s*동\s*\d+\s*호/);
  if (m) return m[1].trim();
  const m2 = addr.match(/^(.+?(?:아파트|아파|APT|apt))/i);
  if (m2) return m2[1].trim();
  return null;
};

// ── 2단계 동적 가중 보로노이 클러스터링 ──────────────────────────────────────
// Phase 1 (30회): 순수 지리 K-means++ → loadFactor 없이 centroid 안정 수렴
// Phase 2 (10회): 용량 보정 → 좁은 범위(0.6~1.4) + EMA 댐핑으로 진동 없이 균등화
//
// [진동 방지 이유]
// loadFactor = clamp(0.2~2.5)으로 매 이터레이션 갱신하면 centroid가 수렴 못하고
// 0.2↔2.5 사이를 진동 → 멀리 떨어진 점이 "가장 약한 경쟁자"에게 배정되는 침범 발생.
// Phase 1에서 지리적 centroid를 먼저 확정한 후 Phase 2에서 소폭 보정하면 구역 유지.
const kMeansCluster = (points, drivers, iterations = 30, pinCentroids = null) => {
  const k = drivers.length;
  if (!points.length || k === 0) return {};
  if (k === 1) return Object.fromEntries(points.map(p => [p.id, drivers[0].id]));

  const caps = drivers.map(d => parseFloat(d.capacity) || 100);
  const totalCap = caps.reduce((s, c) => s + c, 0);
  const totalEffLoad = points.reduce((s, p) => s + (p._effectiveLoad || 1), 0);
  const targetLoads = caps.map(c => totalEffLoad * c / totalCap);

  // Phase 1용: 순수 지리 영향력 (loadFactor 없음)
  const bestGeo = (p, centroids) => {
    let maxInf = -Infinity, bestI = 0;
    centroids.forEach((c, i) => {
      if (!c) return;
      const d = haversine(p._lat, p._lng, c.lat, c.lng) || 1;
      const inf = caps[i] / (d * d);
      if (inf > maxInf) { maxInf = inf; bestI = i; }
    });
    return bestI;
  };

  // Phase 2용: 용량 보정 영향력 (EMA 댐핑 loadFactor)
  const bestBalanced = (p, centroids, loadFactors) => {
    let maxInf = -Infinity, bestI = 0;
    centroids.forEach((c, i) => {
      if (!c) return;
      const d = haversine(p._lat, p._lng, c.lat, c.lng) || 1;
      const inf = caps[i] * loadFactors[i] / (d * d);
      if (inf > maxInf) { maxInf = inf; bestI = i; }
    });
    return bestI;
  };

  // EMA 댐핑: 이전값 60% + 신규값 40%, 범위 0.6~1.4 (진동 방지)
  const updateLoadFactors = (clusters, prev) =>
    clusters.map((pts, i) => {
      const cur = pts.reduce((s, p) => s + (p._effectiveLoad || 1), 0);
      const raw = cur > 0 ? Math.max(0.6, Math.min(1.4, targetLoads[i] / cur)) : 1.0;
      return prev[i] * 0.6 + raw * 0.4;
    });

  if (pinCentroids && pinCentroids.length === k && pinCentroids.every(c => c)) {
    // ── 핀 있음: Phase 1(4회 순수지리) → Phase 2(6회 용량보정)
    let loadFactors = new Array(k).fill(1.0);
    const clusterMap = {};
    for (let pass = 0; pass < 10; pass++) {
      const clusters = Array.from({ length: k }, () => []);
      points.forEach(p => {
        const i = pass < 4 ? bestGeo(p, pinCentroids) : bestBalanced(p, pinCentroids, loadFactors);
        clusters[i].push(p);
        clusterMap[p.id] = drivers[i].id;
      });
      if (pass >= 3) loadFactors = updateLoadFactors(clusters, loadFactors);
    }
    return clusterMap;
  }

  // ── 핀 없음: K-means++ 초기화
  const centroids = [{ lat: points[0]._lat, lng: points[0]._lng }];
  while (centroids.length < k) {
    const dists = points.map(p => Math.min(...centroids.map(c => haversine(p._lat, p._lng, c.lat, c.lng))));
    const sum = dists.reduce((a, b) => a + b * b, 0);
    let r = Math.random() * sum, pushed = false;
    for (let i = 0; i < points.length; i++) {
      r -= dists[i] * dists[i];
      if (r <= 0) { centroids.push({ lat: points[i]._lat, lng: points[i]._lng }); pushed = true; break; }
    }
    if (!pushed) centroids.push({ lat: points[points.length - 1]._lat, lng: points[points.length - 1]._lng });
  }

  // ── Phase 1: 순수 지리 K-means++ (centroid 안정 수렴)
  for (let iter = 0; iter < iterations; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    points.forEach(p => { clusters[bestGeo(p, centroids)].push(p); });
    centroids.forEach((c, i) => {
      if (!clusters[i].length) return;
      c.lat = clusters[i].reduce((s, p) => s + p._lat, 0) / clusters[i].length;
      c.lng = clusters[i].reduce((s, p) => s + p._lng, 0) / clusters[i].length;
    });
  }

  // ── Phase 2: 용량 보정 (안정된 centroid 기준, 소폭 drift 허용)
  let loadFactors = new Array(k).fill(1.0);
  for (let iter = 0; iter < 10; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    points.forEach(p => { clusters[bestBalanced(p, centroids, loadFactors)].push(p); });
    loadFactors = updateLoadFactors(clusters, loadFactors);
    // centroid 소폭 보정 (30% drift만 허용 → 구역 경계 유지하면서 균등화)
    centroids.forEach((c, i) => {
      if (!clusters[i].length) return;
      const newLat = clusters[i].reduce((s, p) => s + p._lat, 0) / clusters[i].length;
      const newLng = clusters[i].reduce((s, p) => s + p._lng, 0) / clusters[i].length;
      c.lat = c.lat * 0.7 + newLat * 0.3;
      c.lng = c.lng * 0.7 + newLng * 0.3;
    });
  }

  const result = {};
  points.forEach(p => { result[p.id] = drivers[bestBalanced(p, centroids, loadFactors)].id; });
  return result;
};


// ── 도로명 파싱 헬퍼 ─────────────────────────────────────────────────────
const parseRoadInfo = (addr) => {
  if (!addr) return { road: '', num: 9999, sub: 0 };
  // 도로명 + 건물번호 추출 (예: "강남대로 127-3")
  const m = addr.match(/([가-힣\w]+(?:대로|로|길|가))\s*(\d+)(?:-(\d+))?/);
  if (m) return { road: m[1], num: parseInt(m[2]) || 9999, sub: parseInt(m[3]) || 0 };
  return { road: '', num: 9999, sub: 0 };
};

// ── 도로 기반 TSP (도로명 그룹 → 건물번호 정렬 → 도로 간 뱀 패턴) ──────────
const roadAwareTSP = (points) => {
  if (!points.length) return [];

  // 좌표 없는 건 마지막에 붙임
  const withCoord = points.filter(p => p._lat && p._lng);
  const noCoord = points.filter(p => !p._lat || !p._lng);

  if (!withCoord.length) return [...noCoord];

  // 도로명으로 그룹화
  const roadMap = new Map();
  withCoord.forEach(p => {
    const { road } = parseRoadInfo(p.주소 || '');
    const key = road || '_none';
    if (!roadMap.has(key)) roadMap.set(key, []);
    roadMap.get(key).push(p);
  });

  // 각 도로 그룹 내 건물번호 오름차순 정렬
  roadMap.forEach(group => {
    group.sort((a, b) => {
      const rA = parseRoadInfo(a.주소 || '');
      const rB = parseRoadInfo(b.주소 || '');
      return rA.num !== rB.num ? rA.num - rB.num : rA.sub - rB.sub;
    });
  });

  // 도로 그룹의 무게중심 계산
  const roads = [...roadMap.values()].map(group => ({
    group,
    lat: group.reduce((s, p) => s + (p._lat || 0), 0) / group.length,
    lng: group.reduce((s, p) => s + (p._lng || 0), 0) / group.length,
  }));

  // 도로 간 최근접 이웃 TSP (가장 북쪽 도로부터 출발)
  const rem = [...roads];
  const startIdx = rem.reduce((mi, r, i) => r.lat > rem[mi].lat ? i : mi, 0);
  const orderedRoads = [rem.splice(startIdx, 1)[0]];
  while (rem.length) {
    const last = orderedRoads[orderedRoads.length - 1];
    let minD = Infinity, minI = 0;
    rem.forEach((r, i) => {
      const d = haversine(last.lat, last.lng, r.lat, r.lng);
      if (d < minD) { minD = d; minI = i; }
    });
    orderedRoads.push(rem.splice(minI, 1)[0]);
  }

  // 뱀 패턴: 짝수 도로는 정방향, 홀수 도로는 역방향 (U턴 최소화)
  const result = [];
  orderedRoads.forEach((road, i) => {
    result.push(...(i % 2 === 0 ? road.group : [...road.group].reverse()));
  });

  return [...result, ...noCoord];
};

// 하위호환용 (좌표 없는 단순 최근접 — 도로 정보 없을 때 폴백)
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

export default function RouteMapModal({ gridData, fileInfo, onClose, onSave, initialCloudCity = null, initialCloudMonthId = null, orgDongs = null, initialDrivers: initialDriversProp = null, selectedDongs: selectedDongsProp = null, baseDailyQty: baseDailyQtyProp = 40 }) {
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
  // layoutMode: 'split' | 'map' | 'list' | 'mapfull' | 'listfull'
  const [layoutMode, setLayoutMode] = useState('split');
  const [isSplitting, setIsSplitting] = useState(false);
  const [selectedDriverFilter, setSelectedDriverFilter] = useState('all');
  const [aptListExpanded, setAptListExpanded] = useState(true);
  const [aptMultiModal, setAptMultiModal] = useState(null); // { aptName, dongs: [{dong, records, assignedDriverId}] }

  const [isFetchingCoords, setIsFetchingCoords] = useState(false);
  const [hasRunGeocoding, setHasRunGeocoding] = useState(false);
  const [coordProgress, setCoordProgress] = useState(null);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  // 기사 핀 (거점 위치 → K-means 초기 중심)
  const [driverPins, setDriverPins] = useState({});       // { driverId: { lat, lng } }
  const [placingPinForDriver, setPlacingPinForDriver] = useState(null); // 핀 배치 모드 중인 driverId
  const [showErrorPanel, setShowErrorPanel] = useState(false);
  const [errorFixingId, setErrorFixingId] = useState(null); // 재처리 중인 record id
  const [errorAddrOverrides, setErrorAddrOverrides] = useState({}); // {id: 수정주소}

  // 세션 저장 상태
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingPrevMonth, setIsLoadingPrevMonth] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(''); // '' | 'draft' | 'final'
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const saveTimerRef = useRef(null);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  // 배송 일정 상태
  const [scheduleMode, setScheduleMode] = useState(false);
  const [selectedDateFilter, setSelectedDateFilter] = useState('all');

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

  // ── 공유 링크
  const [shareModal, setShareModal] = useState(null); // { links: [{driverId,name,color,url}] }
  const [isCreatingShare, setIsCreatingShare] = useState(false);

  // ── 페인트 브러시 모드 (2차 보정)
  const [isPaintMode, setIsPaintMode] = useState(false);
  const [paintDriverId, setPaintDriverId] = useState(null);
  const [paintRadiusPx, setPaintRadiusPx] = useState(50);
  const [paintCursorPx, setPaintCursorPx] = useState(null);
  const isPaintingRef = useRef(false);
  const pendingPaintRef = useRef(new Map()); // id → newDriverId (드래그 중 누적, mouseup 시 commit)
  const recordsRef = useRef([]);             // stale-closure 방지용 최신 records 미러

  const mapRef = useRef(null);
  const kakaoMapRef = useRef(null);
  const overlaysRef = useRef([]);
  const polylinesRef = useRef([]);
  const listPanelRef = useRef(null);
  const driverPinOverlaysRef = useRef([]);
  const mapClickListenerRef = useRef(null);
  const initialBoundsRef = useRef(null);

  const baseForFilter = isCloudMode ? records : gridData;
  const dongList = ['전체', ...[...new Set(baseForFilter.map(r => r.행정동).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'))];
  const filteredRecords = selectedDong === '전체' ? records : records.filter(r => r.행정동 === selectedDong);
  const [listFilterGubun, setListFilterGubun] = useState('');
  const displayRecords = (() => {
    let base = selectedDriverFilter === 'all' ? filteredRecords
      : selectedDriverFilter === 'none' ? filteredRecords.filter(r => !r._driverId)
      : filteredRecords.filter(r => r._driverId === selectedDriverFilter);
    if (listFilterGubun) base = base.filter(r => (r.구분 || '') === listFilterGubun);
    // 도로명 → 이름 순 정렬
    return [...base].sort((a, b) => {
      const rA = extractRoadAddress(a.주소 || '');
      const rB = extractRoadAddress(b.주소 || '');
      const cmp = rA.localeCompare(rB, 'ko', { numeric: true });
      return cmp !== 0 ? cmp : (a.이름 || '').localeCompare(b.이름 || '', 'ko');
    });
  })();

  const mapRecords = displayRecords.filter(r => r._lat && r._lng);
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
  const filteredQty = filteredRecords.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);

  // ── 토스트 알림 헬퍼 (다른 모든 useCallback보다 먼저 선언 필수) ──────────
  const showToast = useCallback((type, message, duration = 3500) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  // ── R-K: 기사별 평균 이동거리 (배송순번 기준, 미터) ─────────────────────
  const driverAvgDist = useMemo(() => {
    const result = {};
    drivers.forEach(d => {
      const dRecs = filteredRecords
        .filter(r => r._driverId === d.id && r._lat && r._lng)
        .sort((a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999));
      if (dRecs.length < 2) { result[d.id] = 0; return; }
      let total = 0;
      for (let i = 1; i < dRecs.length; i++)
        total += haversine(dRecs[i - 1]._lat, dRecs[i - 1]._lng, dRecs[i]._lat, dRecs[i]._lng);
      result[d.id] = Math.round(total / (dRecs.length - 1));
    });
    return result;
  }, [filteredRecords, drivers]);

  // ── 아파트 단지별 그룹핑 (임대 다기사 배정용) ───────────────────────────
  const aptComplexGroups = useMemo(() => {
    const groups = {};
    aptRecords.forEach(r => {
      const aptName = extractAptName(r.주소 || '') || '기타아파트';
      if (!groups[aptName]) groups[aptName] = [];
      groups[aptName].push(r);
    });
    return groups;
  }, [aptRecords]);

  const openAptMultiModal = useCallback((aptName) => {
    const members = aptComplexGroups[aptName] || [];
    const dongMap = {};
    members.forEach(r => {
      const dong = parseAptDong(r.주소) ?? 0;
      if (!dongMap[dong]) dongMap[dong] = [];
      dongMap[dong].push(r);
    });
    const totalQty = members.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
    const dongsArr = Object.entries(dongMap)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([dong, recs]) => {
        const qty = recs.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
        const currentDriverId = recs[0]?._driverId || null;
        return { dong: parseInt(dong) || 0, records: recs, qty, assignedDriverId: currentDriverId };
      });
    // 자동 균등 분할 제안: 절반 기준 2기사
    const half = Math.ceil(dongsArr.length / 2);
    const suggested = dongsArr.map((d, i) => ({
      ...d,
      assignedDriverId: i < half ? (drivers[0]?.id || null) : (drivers[1]?.id || null),
    }));
    setAptMultiModal({ aptName, totalQty, dongs: suggested });
  }, [aptComplexGroups, drivers]);

  const applyAptMultiAssignment = useCallback(() => {
    if (!aptMultiModal) return;
    const updates = {};
    aptMultiModal.dongs.forEach(d => {
      d.records.forEach(r => { updates[r.id] = d.assignedDriverId; });
    });
    setRecords(prev => prev.map(r => r.id in updates ? { ...r, _driverId: updates[r.id] } : r));
    setAptMultiModal(null);
    showToast('success', `${aptMultiModal.aptName} — ${aptMultiModal.dongs.length}개 동 배정 완료`);
  }, [aptMultiModal, showToast]);

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

  // ── Escape → mapfull 해제 / 핀 배치 모드 취소 ──────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        setLayoutMode(m => m === 'mapfull' ? 'split' : m);
        setPlacingPinForDriver(null);
        setIsPaintMode(false);
        setPaintCursorPx(null);
        isPaintingRef.current = false;
        if (kakaoMapRef.current) kakaoMapRef.current.setDraggable(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── 기사 핀 배치: 지도 클릭 → 해당 기사 핀 설정 ───────────────────────
  useEffect(() => {
    if (!kakaoMapRef.current || !isMapReady) return;
    // 기존 리스너 제거 (removeListener는 반드시 map, type, handler 3인자 필요)
    if (mapClickListenerRef.current) {
      window.kakao.maps.event.removeListener(kakaoMapRef.current, 'click', mapClickListenerRef.current);
      mapClickListenerRef.current = null;
    }
    if (!placingPinForDriver) return;
    // 핸들러 함수를 ref에 저장해야 동일 참조로 removeListener 가능
    const driverId = placingPinForDriver;
    let fired = false; // 단일 발화 보장 (더블클릭 방지)
    const handler = (mouseEvent) => {
      if (fired) return;
      fired = true;
      const lat = mouseEvent.latLng.getLat();
      const lng = mouseEvent.latLng.getLng();
      window.kakao.maps.event.removeListener(kakaoMapRef.current, 'click', handler);
      mapClickListenerRef.current = null;
      setDriverPins(prev => ({ ...prev, [driverId]: { lat, lng } }));
      setPlacingPinForDriver(null);
    };
    window.kakao.maps.event.addListener(kakaoMapRef.current, 'click', handler);
    mapClickListenerRef.current = handler;
    return () => {
      if (mapClickListenerRef.current) {
        window.kakao.maps.event.removeListener(kakaoMapRef.current, 'click', mapClickListenerRef.current);
        mapClickListenerRef.current = null;
      }
    };
  }, [placingPinForDriver, isMapReady]);

  // ── 기사 핀 오버레이 렌더링 ────────────────────────────────────────────
  useEffect(() => {
    if (!kakaoMapRef.current) return;
    driverPinOverlaysRef.current.forEach(o => o.setMap(null));
    driverPinOverlaysRef.current = [];
    drivers.forEach(d => {
      const pin = driverPins[d.id];
      if (!pin) return;
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;';
      el.innerHTML = `
        <div style="width:40px;height:40px;border-radius:50%;background:${d.color};display:flex;align-items:center;justify-content:center;border:4px solid rgba(255,255,255,0.95);box-shadow:0 0 0 3px ${d.color}70,0 4px 16px rgba(0,0,0,0.8);position:relative;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        </div>
        <div style="background:${d.color};color:white;font-size:10px;font-weight:900;padding:2px 8px;border-radius:10px;margin-top:3px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.6);">${escHtml(d.name)}</div>
      `;
      el.title = `${d.name} 거점 핀 — 우클릭으로 삭제`;
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        setDriverPins(prev => { const next = { ...prev }; delete next[d.id]; return next; });
      });
      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(pin.lat, pin.lng),
        content: el,
        yAnchor: 1.15,
        xAnchor: 0.5,
        zIndex: 30,
      });
      overlay.setMap(kakaoMapRef.current);
      driverPinOverlaysRef.current.push(overlay);
    });
  }, [driverPins, drivers]);

  // ── 변경 감지 ─────────────────────────────────────────────────────
  useEffect(() => { setHasUnsaved(true); }, [records, drivers]);
  useEffect(() => { recordsRef.current = records; }, [records]);

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

  // ── 마커 렌더링 (성능 최적화: 핀 데이터 시그니처 기반 갱신) ────────
  const mapPinSignature = useMemo(
    () => mapRecords.map(r => `${r.id}:${r._driverId||''}:${r.배송순번||''}:${!!r._에러}`).join('|'),
    [mapRecords]
  );

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

      // 옷핀(thumbtack) DOM 마커 — filter 대신 box-shadow 직접 적용 (GPU 성능 개선)
      const pinEl = document.createElement('div');
      pinEl.setAttribute('data-record-id', r.id);
      pinEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;';
      const glowColor = color + '55';
      pinEl.innerHTML = `<div style="width:32px;height:32px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:3px solid rgba(255,255,255,0.9);box-shadow:0 0 0 2px ${glowColor},0 3px 10px rgba(0,0,0,0.7);flex-shrink:0;position:relative;">${seq ? `<span style="font-size:10px;font-weight:900;color:white;line-height:1;">${seq}</span>` : `<div style="width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,0.35);"></div>`}</div><div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:12px solid ${color};margin-top:-1px;flex-shrink:0;"></div><div style="background:rgba(8,8,8,0.88);color:white;font-size:11px;font-weight:800;padding:2px 6px;border-radius:4px;margin-top:2px;white-space:nowrap;max-width:88px;overflow:hidden;text-overflow:ellipsis;border:1px solid ${color}45;">${name}${qty ? `·<span style="color:${color};">${qty}포</span>` : ''}</div>`;
      pinEl.addEventListener('click', (e) => {
        e.stopPropagation();
        setLayoutMode(prev => (prev === 'map' || prev === 'mapfull') ? 'split' : prev);
        handleSelectRecord(r);
      });
      // 우클릭: 배정 취소
      pinEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, _driverId: null } : pr));
      });

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
    // 브러시 페인트 중에는 setBounds 금지 — 지도 줌이 변하면 getBounds 기반 좌표 계산이 틀어짐
    if (!isPaintingRef.current) {
      kakaoMapRef.current.setBounds(bounds, 60, 60, 60, 60);
      initialBoundsRef.current = bounds;
    }

    const groups = drivers.map(d => mapRecords.filter(r => r._driverId === d.id));
    let cnt = 0;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++)
        groups[i].forEach(r1 => groups[j].forEach(r2 => {
          if (haversine(r1._lat, r1._lng, r2._lat, r2._lng) < 150) cnt++;
        }));
    setOverlapCount(cnt);
  }, [mapPinSignature, drivers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── K-means 지리적 클러스터 자동 배정 ─────────────────────────────────
  const handleAutoSplit = useCallback(() => {
    setIsSplitting(true);
    setTimeout(() => {
      try {
      const target = filteredRecords.filter(r => r._lat && r._lng);
      const activeDrivers = drivers.slice(0, Math.min(driverCount, drivers.length));
      if (!target.length || !activeDrivers.length) { setIsSplitting(false); return; }

      const withLoad = target.map(r => ({ ...r, _effectiveLoad: getEffectiveLoad(r) }));
      // 기사 핀이 전부 있으면 핀 위치를 초기 중심으로 사용
      const pinCentroids = activeDrivers.map(d => driverPins[d.id] || null);
      const clusterMap = kMeansCluster(withLoad, activeDrivers, 30, pinCentroids.every(c => c) ? pinCentroids : null);
      // ── 좌표 없는 레코드 → 같은 행정동 메인기사 자동 배정 (R-4 보완)
      const noCoordRecs = filteredRecords.filter(r => !r._lat || !r._lng);
      if (noCoordRecs.length > 0) {
        const dongDriverCount = {};
        target.forEach(r => {
          const did = clusterMap[r.id];
          if (!did || !r.행정동) return;
          if (!dongDriverCount[r.행정동]) dongDriverCount[r.행정동] = {};
          dongDriverCount[r.행정동][did] = (dongDriverCount[r.행정동][did] || 0) + 1;
        });
        noCoordRecs.forEach(r => {
          const dongMap = dongDriverCount[r.행정동];
          if (!dongMap) return;
          const best = Object.entries(dongMap).sort((a, b) => b[1] - a[1])[0]?.[0];
          if (best) clusterMap[r.id] = best;
        });
      }

      const allWithLoad = filteredRecords.map(r => ({ ...r, _effectiveLoad: getEffectiveLoad(r) }));

      // ── 이웃 그래프 1회 계산 → 스무딩 2회 모두 재사용 (성능 최적화)
      const snapRecs = allWithLoad.filter(r => r._lat && r._lng);
      const K_SMOOTH = Math.min(11, snapRecs.length - 1);
      const neighborIds = {};
      if (snapRecs.length > 1) {
        const cosLat = Math.cos(snapRecs[0]._lat * Math.PI / 180);
        const sqDist = (r, o) => {
          const dlat = r._lat - o._lat, dlng = (r._lng - o._lng) * cosLat;
          return dlat * dlat + dlng * dlng;
        };
        snapRecs.forEach(r => {
          neighborIds[r.id] = snapRecs
            .filter(o => o.id !== r.id)
            .map(o => [o.id, sqDist(r, o)])
            .sort((a, b) => a[1] - b[1])
            .slice(0, K_SMOOTH)
            .map(([id]) => id);
        });
      }

      // ── 공간 다수결 스무딩 헬퍼 (재사용)
      // threshold: 이웃 중 몇 표 이상이어야 변경 (단순 과반 → threshold=K/2+1)
      const runSmoothing = (rounds, threshold) => {
        const active = snapRecs.filter(r => clusterMap[r.id]);
        for (let round = 0; round < rounds; round++) {
          const patches = {};
          active.forEach(r => {
            if (!clusterMap[r.id]) return;
            const cur = clusterMap[r.id];
            const votes = {};
            (neighborIds[r.id] || []).forEach(nId => {
              const d = clusterMap[nId]; if (d) votes[d] = (votes[d] || 0) + 1;
            });
            const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
            if (best && best[0] !== cur && best[1] >= threshold) patches[r.id] = best[0];
          });
          if (!Object.keys(patches).length) break;
          Object.entries(patches).forEach(([id, dId]) => { clusterMap[id] = dId; });
        }
      };

      // ── 스무딩 1차: K-means 결과 정리 (threshold=K×0.5 → 과반)
      runSmoothing(20, Math.ceil(K_SMOOTH * 0.5));

      // ── 후처리 R-I: 아파트 단지 동일 기사 통일
      const aptGroups = {};
      filteredRecords.forEach(r => {
        if (!r._isApt) return;
        const aptName = extractAptName(r.주소 || '') || '기타아파트';
        if (!aptGroups[aptName]) aptGroups[aptName] = [];
        aptGroups[aptName].push(r.id);
      });
      Object.values(aptGroups).forEach(ids => {
        if (ids.length <= 1) return;
        const votes = {};
        ids.forEach(id => { const d = clusterMap[id]; if (d) votes[d] = (votes[d] || 0) + 1; });
        const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!winner) return;
        ids.forEach(id => { clusterMap[id] = winner; });
      });

      // ── 후처리 R-E: 동일 주소 동일 기사 통일
      const addrGroups = {};
      filteredRecords.forEach(r => {
        const addr = (r.주소 || '').trim();
        if (!addr) return;
        if (!addrGroups[addr]) addrGroups[addr] = [];
        addrGroups[addr].push(r.id);
      });
      Object.values(addrGroups).forEach(ids => {
        if (ids.length <= 1) return;
        const votes = {};
        ids.forEach(id => { const d = clusterMap[id]; if (d) votes[d] = (votes[d] || 0) + 1; });
        const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!winner) return;
        ids.forEach(id => { clusterMap[id] = winner; });
      });

      // ── 스무딩 2차: R-I/R-E 텔레포트 정리 (threshold=K×0.6 → 60% 강한 기준)
      // R-I/R-E가 구역 경계 너머로 핀을 보낸 경우 이웃 60% 이상이 다른 색이면 되돌림
      runSmoothing(15, Math.ceil(K_SMOOTH * 0.6));

      // ── 유효부담 최소 기사 / 최근접 기사 헬퍼 (R-A용)
      const getLoads = () => {
        const loads = {};
        activeDrivers.forEach(d => { loads[d.id] = 0; });
        allWithLoad.forEach(r => { if (clusterMap[r.id]) loads[clusterMap[r.id]] = (loads[clusterMap[r.id]] || 0) + r._effectiveLoad; });
        return loads;
      };
      const nearestDriverId = (lat, lng) => {
        const centroids = activeDrivers.map(d => {
          const dRecs = allWithLoad.filter(r => clusterMap[r.id] === d.id && r._lat && r._lng);
          if (!dRecs.length) return null;
          return { lat: dRecs.reduce((s, r) => s + r._lat, 0) / dRecs.length, lng: dRecs.reduce((s, r) => s + r._lng, 0) / dRecs.length };
        });
        let minD = Infinity, minId = null;
        activeDrivers.forEach((d, i) => {
          const c = centroids[i]; if (!c) return;
          const dist = haversine(lat, lng, c.lat, c.lng);
          if (dist < minD) { minD = dist; minId = d.id; }
        });
        return minId;
      };

      // ── 후처리 R-A: 전건 배정 보장 (미배정 → 최근접 기준 중심 기사 강제)
      const loads = getLoads();
      filteredRecords.filter(r => !clusterMap[r.id]).forEach(r => {
        const driverId = (r._lat && r._lng) ? nearestDriverId(r._lat, r._lng)
          : activeDrivers.slice().sort((a, b) => (loads[a.id] || 0) - (loads[b.id] || 0))[0]?.id;
        if (driverId) { clusterMap[r.id] = driverId; loads[driverId] = (loads[driverId] || 0) + (r._effectiveLoad || 1); }
      });

      setRecords(prev => prev.map(r => clusterMap[r.id] ? { ...r, _driverId: clusterMap[r.id] } : r));
      } catch (e) {
        console.error('자동 배정 오류:', e);
      } finally {
        setIsSplitting(false);
      }
    }, 0);
  }, [filteredRecords, drivers, driverCount, driverPins]);

  // ── 핀 DOM 색상 직접 업데이트 (React re-render 없이 즉시 시각 반영)
  const updatePinColorDOM = useCallback((recordId, color) => {
    const el = document.querySelector(`[data-record-id="${recordId}"]`);
    if (!el) return;
    const kids = el.children;
    if (kids[0]) {
      kids[0].style.background = color;
      kids[0].style.boxShadow = `0 0 0 2px ${color}55,0 3px 10px rgba(0,0,0,0.7)`;
    }
    if (kids[1]) kids[1].style.borderTopColor = color;
    if (kids[2]) kids[2].style.borderColor = color + '45';
  }, []);

  // ── 페인트 브러시: 드래그 중 DOM 조작만 (setRecords 없음 → 지도 줌 고정)
  // mouseup 시 commitPaint()가 pendingPaintRef를 한 번에 React state에 반영
  const applyPaint = useCallback((clientX, clientY) => {
    if (!kakaoMapRef.current || !paintDriverId || !mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const curX = clientX - rect.left;
    const curY = clientY - rect.top;
    const bounds = kakaoMapRef.current.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const cLat = ne.getLat() + (curY / rect.height) * (sw.getLat() - ne.getLat());
    const cLng = sw.getLng() + (curX / rect.width) * (ne.getLng() - sw.getLng());
    const latSpanM = haversine(sw.getLat(), sw.getLng(), ne.getLat(), sw.getLng());
    const radiusM = paintRadiusPx * (latSpanM / rect.height);
    const driver = drivers.find(d => d.id === paintDriverId);
    const color = driver?.color || '#3b82f6';
    recordsRef.current.forEach(r => {
      if (!r._lat || !r._lng || r._driverId === paintDriverId) return;
      if (haversine(cLat, cLng, r._lat, r._lng) > radiusM) return;
      if (!pendingPaintRef.current.has(r.id)) {
        pendingPaintRef.current.set(r.id, paintDriverId);
        updatePinColorDOM(r.id, color);
      }
    });
  }, [paintDriverId, paintRadiusPx, drivers, updatePinColorDOM]);

  // ── 드래그 종료 시 누적된 변경을 React state에 한 번만 반영
  const commitPaint = useCallback(() => {
    isPaintingRef.current = false;
    const pending = pendingPaintRef.current;
    if (pending.size === 0) return;
    setRecords(prev => prev.map(r => pending.has(r.id) ? { ...r, _driverId: pending.get(r.id) } : r));
    pending.clear();
  }, []);

  // ── 명단 ↔ 지도 양방향 선택 ───────────────────────────────────────────
  // 핀/행 선택 → 지도 panTo + 선택 핀 DOM 하이라이트 + 목록 스크롤
  const handleSelectRecord = useCallback((r) => {
    setSelectedRecordId(r.id);
    // 지도 이동
    if (r._lat && r._lng && kakaoMapRef.current) {
      const pos = new window.kakao.maps.LatLng(r._lat, r._lng);
      kakaoMapRef.current.panTo(pos);
      if (kakaoMapRef.current.getLevel() > 4) kakaoMapRef.current.setLevel(3);
    }
    // split 이상 레이아웃 보장 (지도가 보여야 panTo 효과가 있음)
    setLayoutMode(prev => (prev === 'list') ? 'split' : prev);
    // 목록 스크롤 (지도 측 클릭 시)
    setTimeout(() => {
      document.getElementById(`rec-${r.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }, []);

  // 선택된 핀 DOM 하이라이트 (scale + glow ring)
  useEffect(() => {
    document.querySelectorAll('[data-record-id]').forEach(el => {
      el.style.transform = '';
      el.style.transition = '';
      el.style.zIndex = '';
    });
    if (!selectedRecordId) return;
    const el = document.querySelector(`[data-record-id="${selectedRecordId}"]`);
    if (!el) return;
    el.style.transition = 'transform 0.15s ease';
    el.style.transform = 'scale(1.45)';
    el.style.zIndex = '999';
    const circle = el.children[0];
    if (circle) {
      circle.style.boxShadow = (circle.style.boxShadow || '') + ',0 0 0 4px rgba(255,255,255,0.9),0 0 0 6px rgba(59,130,246,0.7)';
    }
  }, [selectedRecordId]);

  // ── 전체 배정 초기화 ─────────────────────────────────────────────────
  const handleResetAssignments = useCallback(() => {
    setRecords(prev => prev.map(r => ({ ...r, _driverId: null })));
    showToast('success', '배정 전체 초기화 완료');
  }, [showToast]);


  // ── 배송순번 자동 정렬 (도로명 기반 — 도로 그룹 → 건물번호 → 뱀 패턴) ───
  const handleAutoSequence = useCallback(() => {
    setRecords(prev => {
      const updated = [...prev];
      drivers.forEach(driver => {
        const driverRecs = updated.filter(r => r._driverId === driver.id);
        if (!driverRecs.length) return;
        // 도로명 정보 있는 경우 roadAwareTSP, 전부 좌표 없으면 nearestNeighborTSP 폴백
        const hasAnyAddr = driverRecs.some(r => r.주소 && parseRoadInfo(r.주소).road);
        const ordered = hasAnyAddr ? roadAwareTSP(driverRecs) : nearestNeighborTSP(driverRecs.filter(r => r._lat && r._lng));
        ordered.forEach((r, i) => {
          const idx = updated.findIndex(u => u.id === r.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], 배송순번: String(i + 1) };
        });
      });
      return updated;
    });
    showToast('success', '도로명 기반 배송순번 적용 완료');
  }, [drivers, showToast]);

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
    if (loaded === 0) {
      showToast('error', '기사명이 일치하는 지난달 배정이 없습니다. 기사 이름을 확인하세요.');
    } else {
      showToast('success', `지난달 배정 ${loaded}건 적용 완료`);
    }
  }, [drivers, showToast]);

  // ── 1단계: 세션 수동 저장 (draft / final) ───────────────────────────
  const handleSaveSession = useCallback(async (isFinal = false) => {
    if (!isCloudMode || !cloudCity || !cloudMonthId) {
      if (isFinal) alert('클라우드 명단 로드 후 저장 가능합니다.');
      return;
    }
    // R-0: 최종 저장 시 기사 구역 겹침 차단
    if (isFinal && overlapCount > 0) {
      showToast('error', `기사 구역 겹침 ${overlapCount}건이 있습니다. [동선 겹침 자동 해소] 후 최종 저장하세요.`, 5000);
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
      // driver_assignments 동기화 — RouteSetupModal에서 다음번 기사구성 자동 로드용
      try {
        const dongDriverMap = {};
        records.forEach(r => {
          if (!r._driverId || !r.행정동) return;
          if (!dongDriverMap[r.행정동]) dongDriverMap[r.행정동] = [];
          if (!dongDriverMap[r.행정동].includes(r._driverId)) dongDriverMap[r.행정동].push(r._driverId);
        });
        await setDoc(
          doc(db, 'driver_assignments', cloudCity, 'orgs', 'all'),
          {
            drivers: drivers.map(d => ({ id: d.id, name: d.name, color: d.color, capacity: d.capacity || 100 })),
            dongDriverMap,
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser?.email || '',
          },
          { merge: true }
        );
      } catch (syncErr) {
        console.error('driver_assignments 동기화 실패:', syncErr);
      }
      setSessionStatus(isFinal ? 'final' : 'draft');
      setLastAutoSave(new Date());
      setHasUnsaved(false);
      if (isFinal) {
        await syncToBaseList();
        // delivery_history 자동 적재 (기사별 실적 집계)
        try {
          const histBatch = writeBatch(db);
          drivers.forEach(driver => {
            const driverRecs = records.filter(r => r._driverId === driver.id);
            if (!driverRecs.length) return;
            const totalQty = driverRecs.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
            const effectiveLoad = driverRecs.reduce((s, r) => s + getEffectiveLoad(r), 0);
            const dongs = [...new Set(driverRecs.map(r => r.행정동).filter(Boolean))];
            const ref = doc(db, 'delivery_history', cloudCity, 'months', cloudMonthId, 'drivers', driver.id);
            histBatch.set(ref, {
              driverName: driver.name,
              driverId: driver.id,
              totalQty,
              totalCount: driverRecs.length,
              effectiveLoad: Math.round(effectiveLoad * 10) / 10,
              dongs,
              uploadedAt: serverTimestamp(),
              uploadedBy: auth.currentUser?.email || '',
            });
          });
          await histBatch.commit();
        } catch (e) {
          console.error('delivery_history 적재 실패:', e);
        }
        showToast('success', `최종 저장 완료 — ${cloudCity} ${cloudMonthId} · ${records.filter(r => r._driverId).length}건 배정 확정`, 5000);
      } else {
        showToast('success', `임시저장 완료 — 배정현황이 저장되었습니다 (기본명단 미반영)`);
      }
    } catch (e) {
      showToast('error', `저장 실패: ${e.message}`);
    } finally {
      setIsSavingSession(false);
    }
  }, [isCloudMode, cloudCity, cloudMonthId, drivers, records, showToast, overlapCount]);

  // ── 1단계: 세션 불러오기 (이어서 작업) ──────────────────────────────
  const handleLoadSession = useCallback(async () => {
    if (!cloudCity || !cloudMonthId) { showToast('error', '먼저 클라우드 명단을 불러오세요.'); return; }
    setIsLoadingSession(true);
    try {
      const snap = await getDoc(doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId));
      if (!snap.exists()) { showToast('info', '저장된 세션이 없습니다. 새 작업을 시작하세요.'); return; }
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
      const savedAt = data.savedAt?.toDate?.()?.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) || '';
      showToast('success', `이어서 작업 로드 완료 — 기사 ${data.drivers?.length || 0}명 · 배정 ${data.assignedCount || 0}건${savedAt ? ` (${savedAt} 저장본)` : ''}`);
    } catch (e) {
      showToast('error', `세션 로드 실패: ${e.message}`);
    } finally {
      setIsLoadingSession(false);
    }
  }, [cloudCity, cloudMonthId, showToast]);

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
    if (!cloudCity || !cloudMonthId) { showToast('error', '먼저 클라우드 명단을 불러오세요.'); return; }
    const [year, month] = cloudMonthId.split('-').map(Number);
    const prevMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    setIsLoadingPrevMonth(true);
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
      showToast('success', `이전달(${prevMonth}) 승계 완료 — 좌표 ${coordApplied}건 · 기사배정 ${driverApplied}건 적용`);
    } catch (e) {
      showToast('error', `이전달 불러오기 실패: ${e.message}`);
    } finally {
      setIsLoadingPrevMonth(false);
    }
  }, [cloudCity, cloudMonthId, drivers, showToast]);

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

  // ── 기사 배송루트 공유 링크 생성 ─────────────────────────────────────
  const handleCreateShareLink = useCallback(async () => {
    const assignedDrivers = drivers.filter(d => records.some(r => r._driverId === d.id));
    if (!assignedDrivers.length) { showToast('error', '배정된 기사가 없습니다.'); return; }
    setIsCreatingShare(true);
    try {
      const shareRecords = records
        .filter(r => r._driverId)
        .map(r => ({
          driverId: r._driverId,
          lat: r._lat || null,
          lng: r._lng || null,
          isApt: r._isApt || false,
          배송순번: r.배송순번 || null,
          이름: r.이름 || '',
          주소: r.주소 || '',
          포수: parseInt(r.포수 || r['수량(포수)']) || 1,
          특이사항: r.특이사항 || '',
        }));
      const shareId = `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      await setDoc(doc(db, 'route_shares', shareId), {
        city: cloudCity || fileInfo?.city || '',
        monthId: cloudMonthId || '',
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || '',
        drivers: assignedDrivers.map(d => ({ id: d.id, name: d.name, color: d.color })),
        records: shareRecords,
      });
      const base = window.location.origin;
      setShareModal({
        links: assignedDrivers.map(d => ({
          driverId: d.id, name: d.name, color: d.color,
          url: `${base}/?r=${shareId}&d=${d.id}`,
        })),
      });
      showToast('success', '공유 링크가 생성되었습니다.');
    } catch (e) {
      showToast('error', '공유 링크 생성 실패: ' + e.message);
    } finally {
      setIsCreatingShare(false);
    }
  }, [records, drivers, cloudCity, cloudMonthId, fileInfo, showToast]);

  // ── 겹침 해소 (다중 패스 — 최대 20회 반복, 수렴 시 조기 종료) ───────────
  const handleResolveOverlap = useCallback(() => {
    const MAX_PASS = 20;
    let current = [...records];
    let totalMoved = 0;

    for (let pass = 0; pass < MAX_PASS; pass++) {
      const withCoord = current.filter(r => r._lat && r._lng && r._driverId);
      const updates = {};

      // 각 기사 쌍의 무게중심 미리 계산
      const centroids = {};
      drivers.forEach(d => {
        const g = withCoord.filter(r => r._driverId === d.id);
        if (!g.length) return;
        centroids[d.id] = {
          lat: g.reduce((s, r) => s + r._lat, 0) / g.length,
          lng: g.reduce((s, r) => s + r._lng, 0) / g.length,
        };
      });

      drivers.forEach((dA, i) => {
        drivers.slice(i + 1).forEach(dB => {
          const gA = withCoord.filter(r => r._driverId === dA.id);
          const gB = withCoord.filter(r => r._driverId === dB.id);
          const cA = centroids[dA.id];
          const cB = centroids[dB.id];
          if (!cA || !cB) return;

          gA.forEach(rA => {
            if (updates[rA.id]) return; // 이미 이번 패스에서 이동 확정
            gB.forEach(rB => {
              if (haversine(rA._lat, rA._lng, rB._lat, rB._lng) >= 150) return;
              // rA가 cA보다 cB에 더 가까우면 dB로 이동
              if (haversine(rA._lat, rA._lng, cA.lat, cA.lng) > haversine(rA._lat, rA._lng, cB.lat, cB.lng))
                updates[rA.id] = dB.id;
            });
          });

          gB.forEach(rB => {
            if (updates[rB.id]) return;
            gA.forEach(rA => {
              if (haversine(rB._lat, rB._lng, rA._lat, rA._lng) >= 150) return;
              if (haversine(rB._lat, rB._lng, cB.lat, cB.lng) > haversine(rB._lat, rB._lng, cA.lat, cA.lng))
                updates[rB.id] = dA.id;
            });
          });
        });
      });

      const movedThisPass = Object.keys(updates).length;
      if (!movedThisPass) break; // 수렴 — 더 이상 이동 없음

      totalMoved += movedThisPass;
      current = current.map(r => updates[r.id] ? { ...r, _driverId: updates[r.id] } : r);
    }

    if (!totalMoved) {
      showToast('info', '해소할 겹침이 없습니다.');
      return;
    }
    setRecords(current);
    showToast('success', `겹침 해소 완료 — 총 ${totalMoved}건 재배정`);
  }, [records, drivers, showToast]);

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
        .filter(r => r._driverId === driver.id && r._lat && r._lng)
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
      setHasRunGeocoding(true);

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

  // ── 클라우드 피커 모달 ──────────────────────────────────────────────
  const cloudPickerOverlay = showCloudPicker ? (
      <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-6">
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
  ) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" style={{ fontFamily: 'inherit' }}>

      {/* ── 헤더 ───────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-[#0a0a0a] border-b border-[#222] px-4 py-2 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-[#3b82f6]" />
          <span className="text-white font-black text-sm tracking-wide">배송 구역 배정</span>
          {isCloudMode
            ? <span className="text-blue-400 text-xs font-bold">[클라우드] {cloudCity} {cloudMonthId}</span>
            : <span className="text-gray-600 text-xs">{fileInfo?.city} {fileInfo?.month}</span>
          }
        </div>

        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-[#3b82f6]">
            지도 {withCoordCount.toLocaleString()}건
            {aptWithCoord > 0 && <span className="text-orange-400/80"> · 아파트좌표 {aptWithCoord.toLocaleString()}건</span>}
            <span className="text-[#3b82f6]/50"> ({withCoordPct}%)</span>
          </span>
          {aptCount > 0 && aptWithCoord < aptCount && (
            <span className="text-orange-400"><Building2 size={9} className="inline mr-0.5" />아파트 {aptCount.toLocaleString()}건</span>
          )}
          {totalNoCoord > 0 && (
            <button
              onClick={() => setShowErrorPanel(true)}
              className="flex items-center gap-1 px-2 py-0.5 bg-red-900/40 border border-red-600/50 rounded text-red-400 text-[10px] font-bold hover:bg-red-800/50 transition-colors animate-pulse"
            >
              <AlertCircle size={10} /> 미확인 {totalNoCoord.toLocaleString()}건
            </button>
          )}
        </div>

        {overlapCount > 0 && (
          <button onClick={handleResolveOverlap}
            className="flex items-center gap-1 px-2 py-0.5 bg-amber-900/40 border border-amber-700/40 rounded text-amber-400 text-[10px] hover:bg-amber-900/60">
            <AlertTriangle size={10} /> 동선 겹침 {overlapCount}건 — 자동 해소
          </button>
        )}
        {overlapCount === 0 && withCoordCount > 0 && (
          <span className="text-[10px] text-[#3b82f6]/60">✓ 동선 겹침 없음</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">

          {/* ── 그룹 1: 세션 관리 (클라우드 모드 전용) ─────────────── */}
          {isCloudMode && (
            <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
              <span className="text-[8px] text-gray-700 font-black tracking-widest mr-1">세션</span>
              {/* 저장 상태 뱃지 */}
              {hasUnsaved
                ? <span className="text-[9px] text-amber-400 animate-pulse font-bold mr-1">● 미저장</span>
                : sessionStatus
                  ? <span className={`text-[9px] font-bold mr-1 ${sessionStatus === 'final' ? 'text-[#3b82f6]' : 'text-amber-400/80'}`}>
                      {sessionStatus === 'final' ? '✓ 최종' : '✓ 임시'}{lastAutoSave ? ` ${lastAutoSave.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </span>
                  : null
              }
              {/* 이어서 작업 */}
              <button
                onClick={handleLoadSession}
                disabled={isLoadingSession}
                title="저장된 배정 현황을 불러와 이어서 작업합니다"
                className="px-2 py-1 bg-[#111] border border-[#2a2a2a] text-gray-400 hover:text-cyan-400 hover:border-cyan-500/40 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {isLoadingSession ? <RefreshCw size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                {isLoadingSession ? '로딩...' : '이어서 작업'}
              </button>
              {/* 임시저장 */}
              <button
                onClick={() => handleSaveSession(false)}
                disabled={isSavingSession}
                title="현재 배정 현황을 임시 저장합니다 (기본명단에 미반영, 언제든 재수정 가능)"
                className="px-2 py-1 bg-amber-950/40 border border-amber-600/40 text-amber-400 hover:bg-amber-900/30 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {isSavingSession ? <RefreshCw size={10} className="animate-spin" /> : <Save size={10} />}
                {isSavingSession ? '저장중...' : '임시저장'}
              </button>
              {/* 이전달 승계 */}
              <button
                onClick={handleLoadPrevMonth}
                disabled={isLoadingPrevMonth}
                title="전달 배정 데이터(좌표·기사)를 이번달 명단에 자동 이식합니다"
                className="px-2 py-1 bg-[#0d1520] border border-blue-500/30 text-blue-400 hover:bg-blue-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {isLoadingPrevMonth ? <RefreshCw size={10} className="animate-spin" /> : <Clock size={10} />}
                {isLoadingPrevMonth ? '불러오는중...' : '이전달 승계'}
              </button>
            </div>
          )}

          {/* ── 그룹 2: 도구 ─────────────────────────────────────────── */}
          <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
            <span className="text-[8px] text-gray-700 font-black tracking-widest mr-1">도구</span>
            {/* 좌표 매칭 */}
            <button
              onClick={handleFetchMissingCoords}
              disabled={isFetchingCoords}
              title={totalNoCoord > 0 ? `좌표 없는 ${totalNoCoord}건을 카카오 API로 자동 조회합니다` : '모든 주소의 좌표가 확인되었습니다'}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-colors disabled:opacity-50 ${
                totalNoCoord > 0
                  ? 'bg-red-900/30 border-red-600/50 text-red-400 hover:bg-red-800/40'
                  : 'bg-[#111] border-[#2a2a2a] text-gray-500 hover:text-gray-300'
              }`}
            >
              {isFetchingCoords
                ? <><RefreshCw size={10} className="animate-spin" />{coordProgress ? `${coordProgress.done}/${coordProgress.total}` : '처리중'}</>
                : <><MapPin size={10} />좌표 매칭{totalNoCoord > 0 ? ` (${totalNoCoord})` : ' ✓'}</>
              }
            </button>
            {/* 자동 순번 */}
            <button
              onClick={handleAutoSequence}
              title="기사별로 지도 경로 순서에 따라 배송 순번을 자동 부여합니다"
              className="px-2 py-1 bg-[#0d1520] border border-purple-500/30 text-purple-400 hover:bg-purple-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <Navigation2 size={10} /> 자동 순번
            </button>
          </div>

          {/* ── 그룹 3: 레이아웃 ─────────────────────────────────────── */}
          <div className="flex rounded-xl overflow-hidden border border-[#2a2a2a]">
            <button onClick={() => setLayoutMode('map')} title="지도만 표시"
              className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors ${layoutMode === 'map' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <MapIcon size={11} />
            </button>
            <button onClick={() => setLayoutMode('split')} title="지도 + 목록 분할"
              className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors border-x border-[#2a2a2a] ${layoutMode === 'split' || layoutMode === 'mapfull' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <Columns size={11} />
            </button>
            <button onClick={() => setLayoutMode('list')} title="목록만 표시 (좌측 패널 포함)"
              className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors border-r border-[#2a2a2a] ${layoutMode === 'list' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <List size={11} />
            </button>
            <button onClick={() => setLayoutMode('listfull')} title="목록 전체화면 — 넓게 펼쳐서 작업"
              className={`px-2.5 py-1.5 text-[10px] font-bold flex items-center gap-1 transition-colors ${layoutMode === 'listfull' ? 'bg-[#1a2e1a] text-[#3b82f6]' : 'bg-[#111] text-gray-500 hover:text-gray-300'}`}>
              <Maximize2 size={11} />
            </button>
          </div>

          {/* ── 그룹 4: 내보내기 ─────────────────────────────────────── */}
          <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
            <span className="text-[8px] text-gray-700 font-black tracking-widest mr-1">내보내기</span>
            <button
              onClick={() => setShowCloudPicker(true)}
              title="다른 지자체·월 명단을 클라우드에서 불러옵니다"
              className="px-2 py-1 bg-[#111] border border-[#2a2a2a] text-gray-400 hover:text-blue-400 hover:border-blue-500/40 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <HardDrive size={10} /> 명단 불러오기
            </button>
            {/* 카카오 맵 데이터 저장 (cloud_lists에 기사/순번 반영) */}
            {isCloudMode && (
              <button
                onClick={handleSaveToCloud}
                disabled={isSavingCloud}
                title="기사 배정과 배송 순번을 클라우드 월별 명단(cloud_lists)에 저장합니다"
                className="px-2 py-1 bg-[#0a1520] border border-cyan-600/40 text-cyan-400 hover:bg-cyan-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {isSavingCloud ? <RefreshCw size={10} className="animate-spin" /> : <HardDrive size={10} />}
                {isSavingCloud ? '저장중...' : '카카오맵 저장'}
              </button>
            )}
            <button
              onClick={handleExportDriverExcel}
              title="기사별 배송 목록을 엑셀 파일로 다운로드합니다"
              className="px-2 py-1 bg-[#0d1220] text-blue-400 border border-blue-500/30 hover:bg-blue-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <FileSpreadsheet size={10} /> 담당자 엑셀
            </button>
            <button
              onClick={handleDownloadRouteBundle}
              title="기사별 배송루트 엑셀 파일 묶음을 다운로드합니다"
              className="px-2 py-1 bg-[#060c18] text-blue-400 border border-blue-600/40 hover:bg-blue-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <Download size={10} /> 배송루트
            </button>
            {/* 기사 배송루트 공유 링크 생성 */}
            <button
              onClick={handleCreateShareLink}
              disabled={isCreatingShare}
              title="기사별 배송루트 카카오지도 공유 링크를 생성합니다 (기사가 모바일로 확인 가능)"
              className="px-2 py-1 bg-[#0d1a0d] border border-green-600/40 text-green-400 hover:bg-green-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              {isCreatingShare ? <RefreshCw size={10} className="animate-spin" /> : <Share2 size={10} />}
              {isCreatingShare ? '생성중...' : '공유'}
            </button>
          </div>

          {/* ── 그룹 5: 최종 저장 + 닫기 ────────────────────────────── */}
          {isCloudMode ? (
            <button
              onClick={() => handleSaveSession(true)}
              disabled={isSavingSession}
              title="배정을 최종 확정합니다 — 기본명단(base_lists)에도 기사/좌표 정보가 반영됩니다"
              className="px-3 py-1.5 bg-[#1a2e1a] text-[#3b82f6] border border-[#3b82f6]/50 hover:bg-[#3b82f6]/20 rounded-xl text-xs font-black flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              {isSavingSession ? <><RefreshCw size={12} className="animate-spin" />저장중...</> : <><Save size={12} />최종 저장</>}
            </button>
          ) : (
            <button
              onClick={handleSave}
              title="현재 배정 현황을 저장합니다"
              className="px-3 py-1.5 bg-[#1a2e1a] text-[#3b82f6] border border-[#3b82f6]/40 hover:bg-[#3b82f6]/20 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors"
            >
              <Save size={12} /> 저장
            </button>
          )}
          <button onClick={onClose} title="닫기" className="p-2 bg-red-900/40 hover:bg-red-700/60 text-red-400 hover:text-white border border-red-700/40 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── 바디 ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 relative">

        {/* 좌측 패널 — mapfull / listfull 모드에서 숨김 */}
        <div className={`w-60 shrink-0 bg-[#070707] border-r border-[#1a1a1a] flex flex-col overflow-hidden ${layoutMode === 'mapfull' || layoutMode === 'listfull' ? 'hidden' : ''}`}>

          {/* 행정동 필터 */}
          <div className="p-3 border-b border-[#1a1a1a]">
            <div className="text-[9px] text-gray-600 mb-1.5 font-black tracking-widest uppercase">행정동 필터</div>
            <select value={selectedDong} onChange={e => setSelectedDong(e.target.value)}
              className="w-full bg-[#111] text-white text-xs border border-[#2a2a2a] rounded px-2 py-1.5 focus:outline-none focus:border-[#3b82f6]/40">
              {dongList.map(d => <option key={d}>{d}</option>)}
            </select>
            <div className="mt-1 text-[9px] text-gray-700">
              {filteredRecords.length}건 · <span className="text-blue-400 font-black">{filteredQty}포</span> | 미배정 <span className={unassigned > 0 ? 'text-amber-500' : 'text-[#3b82f6]'}>{unassigned}건</span>
            </div>
          </div>

          {/* 자동 배정 */}
          <div className="p-3 border-b border-[#1a1a1a]">
            <div className="text-[9px] text-gray-600 mb-2 font-black tracking-widest uppercase">자동 배정</div>
            <div className="text-[8px] text-gray-700 mb-1.5 text-center">임대·계단·특이사항 자동 반영</div>
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
            <button
              onClick={handleAutoSplit}
              disabled={isSplitting || totalWithCoord === 0 || (totalNoCoord > 0 && !hasRunGeocoding)}
              title={totalNoCoord > 0 && !hasRunGeocoding ? `좌표 없는 ${totalNoCoord}건 있음 — 먼저 [좌표 매칭]을 실행하세요 (R-B)` : ''}
              className="w-full py-1.5 bg-[#3b82f6]/15 border border-[#3b82f6]/25 text-[#3b82f6] rounded text-xs font-bold hover:bg-[#3b82f6]/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-colors">
              {isSplitting ? <><RefreshCw size={11} className="animate-spin" /> 배정 중...</>
                : totalNoCoord > 0 && !hasRunGeocoding ? <><AlertCircle size={11} className="text-amber-400" /> 좌표 매칭 필요</>
                : <><Navigation2 size={11} /> 자동 {driverCount}등분</>}
            </button>

            {/* 배정 초기화 */}
            <button onClick={handleResetAssignments}
              className="w-full mt-2 py-1.5 bg-[#111] border border-[#333] text-gray-600 rounded text-[10px] font-bold hover:text-red-400 hover:border-red-800/50 flex items-center justify-center gap-1.5 transition-colors">
              <X size={10} /> 배정 전체 초기화
            </button>

            {/* 지난달 배정 불러오기 */}
            <button onClick={handleLoadLastMonth}
              className="w-full mt-1.5 py-1.5 bg-[#111] border border-[#2a2a2a] text-gray-500 rounded text-[10px] font-bold hover:text-gray-300 hover:border-[#3a3a3a] flex items-center justify-center gap-1.5 transition-colors">
              <Clock size={10} /> 지난달 배정 불러오기
            </button>
            <div className="text-[9px] text-gray-700 mt-1 text-center">기사명이 일치해야 적용됩니다</div>
          </div>

          {/* ── 2차 보정: 페인트 브러시 ─────────────────────────────── */}
          <div className="px-3 pb-3 border-t border-[#1a1a1a] pt-3">
            <div className="text-[9px] text-gray-600 mb-2 font-black tracking-widest uppercase">2차 보정</div>
            <button
              onClick={() => {
                const next = !isPaintMode;
                setIsPaintMode(next);
                setPaintCursorPx(null);
                isPaintingRef.current = false;
                // 브러시 ON → 지도 드래그 잠금, OFF → 복원
                if (kakaoMapRef.current) kakaoMapRef.current.setDraggable(!next);
              }}
              className={`w-full py-1.5 rounded text-[10px] font-black flex items-center justify-center gap-1.5 transition-all border ${
                isPaintMode
                  ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.25)]'
                  : 'bg-[#111] border-[#2a2a2a] text-gray-500 hover:text-amber-400 hover:border-amber-700/40'
              }`}>
              ✏️ {isPaintMode ? '브러시 모드 ON (Esc 종료)' : '브러시 보정 모드'}
            </button>
            {isPaintMode && (
              <div className="mt-2 space-y-2">
                {/* 기사 색상 선택 */}
                <div className="text-[8px] text-gray-600 mb-1">칠할 기사 선택</div>
                <div className="flex flex-wrap gap-1.5">
                  {drivers.map(d => (
                    <button key={d.id}
                      onClick={() => setPaintDriverId(d.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold transition-all border"
                      style={{
                        borderColor: paintDriverId === d.id ? d.color : 'transparent',
                        background: paintDriverId === d.id ? `${d.color}30` : '#111',
                        color: paintDriverId === d.id ? d.color : '#6b7280',
                        boxShadow: paintDriverId === d.id ? `0 0 8px ${d.color}50` : 'none',
                      }}>
                      <div className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                      {d.name}
                    </button>
                  ))}
                </div>
                {/* 브러시 크기 */}
                <div className="text-[8px] text-gray-600 mb-1">브러시 크기</div>
                <div className="flex gap-1">
                  {[['소', 30], ['중', 60], ['대', 100], ['특대', 160]].map(([label, px]) => (
                    <button key={label}
                      onClick={() => setPaintRadiusPx(px)}
                      className={`flex-1 py-0.5 rounded text-[9px] font-bold border transition-colors ${
                        paintRadiusPx === px ? 'bg-amber-500/20 border-amber-400/40 text-amber-300' : 'bg-[#111] border-[#222] text-gray-600 hover:text-gray-400'
                      }`}>{label}</button>
                  ))}
                </div>
                {paintDriverId
                  ? <div className="text-[8px] text-amber-400/80 text-center">지도 위에서 드래그하여 구역 칠하기</div>
                  : <div className="text-[8px] text-gray-600 text-center">↑ 기사를 먼저 선택하세요</div>
                }
              </div>
            )}
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
                  className="text-[10px] text-[#3b82f6] hover:text-[#93c5fd] disabled:text-gray-700 flex items-center gap-0.5">
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
                const driverQty = filteredRecords.filter(r => r._driverId === d.id).reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
                const isActive = selectedDriverFilter === d.id;
                const effLoad = Math.round(records.filter(r => r._driverId === d.id).reduce((s, r) => s + getEffectiveLoad(r), 0));
                const maxLoad = Math.round(baseDailyQtyProp * (d.capacity || 100) / 100);
                const loadPct = maxLoad > 0 ? Math.min(150, Math.round(effLoad / maxLoad * 100)) : 0;
                const isOver = effLoad > maxLoad;
                return (
                  <div key={d.id}
                    className={`p-2 rounded-lg border transition-colors cursor-pointer`}
                    style={{
                      borderColor: isActive ? d.color + '60' : '#1e1e1e',
                      background: isActive ? d.color + '10' : '#0d0d0d',
                    }}
                    onClick={() => setSelectedDriverFilter(isActive ? 'all' : d.id)}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                      <input value={d.name}
                        onChange={e => setDrivers(prev => prev.map(dr => dr.id === d.id ? { ...dr, name: e.target.value } : dr))}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 bg-transparent text-white text-xs focus:outline-none min-w-0" />
                      <span className="text-[10px] font-black shrink-0" style={{ color: d.color }}>{cnt}건{driverQty > 0 ? ` · ${driverQty}포` : ''}</span>
                      {/* 기사 핀 버튼 */}
                      <button
                        onClick={e => { e.stopPropagation(); setPlacingPinForDriver(prev => prev === d.id ? null : d.id); }}
                        title={driverPins[d.id] ? `${d.name} 핀 재설정 (우클릭으로 지도에서 삭제)` : `지도 클릭으로 ${d.name} 거점 핀 설정`}
                        className={`text-[9px] px-1 py-0.5 rounded transition-all shrink-0 ${
                          placingPinForDriver === d.id
                            ? 'bg-yellow-500/30 border border-yellow-400/60 text-yellow-300 animate-pulse'
                            : driverPins[d.id]
                            ? 'text-base leading-none'
                            : 'text-gray-700 hover:text-gray-400 border border-transparent hover:border-[#2a2a2a]'
                        }`}>
                        {driverPins[d.id] ? '📍' : <MapPin size={9} />}
                      </button>
                      <button onClick={e => { e.stopPropagation(); removeDriver(d.id); }}
                        className="text-gray-700 hover:text-red-400 transition-colors shrink-0">
                        <X size={10} />
                      </button>
                    </div>
                    {/* 유효부담 프로그레스바 */}
                    {cnt > 0 && (
                      <div className="mt-1.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[8px] text-gray-700">유효부담</span>
                          <span className={`text-[8px] font-black tabular-nums ${isOver ? 'text-red-400' : 'text-gray-500'}`}>
                            {effLoad} / {maxLoad}
                            {isOver && ' ⚠'}
                          </span>
                        </div>
                        <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(loadPct, 100)}%`,
                              background: isOver
                                ? 'linear-gradient(90deg,#b91c1c,#ef4444)'
                                : loadPct > 85
                                ? 'linear-gradient(90deg,#d97706,#f59e0b)'
                                : `linear-gradient(90deg,${d.color}99,${d.color})`,
                            }} />
                        </div>
                        {/* R-K: 평균 이동거리 */}
                        {driverAvgDist[d.id] > 0 && (
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[8px] text-gray-700">평균이동</span>
                            <span className="text-[8px] tabular-nums" style={{ color: d.color + 'bb' }}>
                              {driverAvgDist[d.id] >= 1000
                                ? `${(driverAvgDist[d.id] / 1000).toFixed(1)}km`
                                : `${driverAvgDist[d.id]}m`}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
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
            layoutMode === 'mapfull'  ? 'absolute inset-0 z-[60] bg-[#080808] flex flex-col' :
            layoutMode === 'list'     ? 'hidden' :
            layoutMode === 'listfull' ? 'hidden' :
            layoutMode === 'map'      ? 'flex-1 flex flex-col relative' :
            /* split */                 'flex-1 flex flex-col relative min-w-0'
          }>
            {!isMapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#080808] z-10">
                <RefreshCw size={22} className="text-[#3b82f6] animate-spin" />
              </div>
            )}
            <div ref={mapRef} className="flex-1 relative"
              onDoubleClick={() => { if (!isPaintMode) setLayoutMode('mapfull'); }}
              style={{ cursor: placingPinForDriver ? 'crosshair' : undefined }}
            >
              {/* ── 페인트 브러시 인터셉터: 지도 위를 완전히 덮어 카카오맵 이벤트 차단 */}
              {isPaintMode && (
                <div
                  style={{ position: 'absolute', inset: 0, zIndex: 200, cursor: 'none' }}
                  onMouseMove={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPaintCursorPx({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                    if (isPaintingRef.current) applyPaint(e.clientX, e.clientY);
                  }}
                  onMouseDown={e => {
                    if (!paintDriverId) return;
                    e.preventDefault();
                    isPaintingRef.current = true;
                    applyPaint(e.clientX, e.clientY);
                  }}
                  onMouseUp={() => { commitPaint(); }}
                  onMouseLeave={() => { commitPaint(); setPaintCursorPx(null); }}
                >
                  {/* 브러시 커서 원 */}
                  {paintCursorPx && (() => {
                    const d = drivers.find(dr => dr.id === paintDriverId);
                    const color = d?.color || '#ffffff';
                    return (
                      <div className="absolute pointer-events-none rounded-full"
                        style={{
                          left: paintCursorPx.x - paintRadiusPx, top: paintCursorPx.y - paintRadiusPx,
                          width: paintRadiusPx * 2, height: paintRadiusPx * 2,
                          border: `2.5px solid ${color}`,
                          background: `${color}22`,
                          boxShadow: `0 0 0 1px rgba(0,0,0,0.6), 0 0 20px ${color}55`,
                        }}
                      />
                    );
                  })()}
                </div>
              )}
            </div>

            {/* 핀 배치 모드 안내 배너 */}
            {placingPinForDriver && (() => {
              const d = drivers.find(dr => dr.id === placingPinForDriver);
              return (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full shadow-xl pointer-events-none animate-pulse"
                  style={{ background: d?.color || '#f59e0b', boxShadow: `0 0 20px ${d?.color || '#f59e0b'}80` }}>
                  <MapPin size={13} className="text-white shrink-0" />
                  <span className="text-white text-[11px] font-black whitespace-nowrap">
                    지도를 클릭하여 [{d?.name}] 거점 핀 설정 · Esc 취소
                  </span>
                </div>
              );
            })()}

            {/* 지도 오버레이 버튼 */}
            <div className="absolute top-2 right-2 z-10 flex gap-1.5">
              {/* 중심 이동 버튼 */}
              <button
                onClick={() => {
                  if (!kakaoMapRef.current || !initialBoundsRef.current) return;
                  kakaoMapRef.current.setBounds(initialBoundsRef.current, 60, 60, 60, 60);
                }}
                title="배송구역 전체 보기 (중심으로 이동)"
                className="px-2.5 py-1.5 bg-black/70 hover:bg-black/95 text-white/80 hover:text-white border border-white/15 rounded-lg text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm shadow-lg transition-all"
              >
                <Crosshair size={11} /> 전체 보기
              </button>
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

          </div>

          {/* 분할 구분선 */}
          {layoutMode === 'split' && (
            <div className="w-[3px] shrink-0 bg-[#1a1a1a] hover:bg-[#2a2a2a] cursor-col-resize transition-colors" />
          )}

          {/* ── 목록 패널 — split / list / listfull 모드 ── */}
          {(layoutMode === 'split' || layoutMode === 'list' || layoutMode === 'listfull') && (
            <div className={`overflow-auto bg-[#060606] flex flex-col ${
              layoutMode === 'split' ? 'w-[42%] shrink-0' : 'flex-1'
            }`}>
              {/* 목록 필터 바 */}
              <div className="px-3 py-2 border-b border-[#1a1a1a] sticky top-0 bg-[#060606] z-10 flex items-center gap-2 flex-wrap">
                <span className="text-[9px] text-gray-600 font-black tracking-widest">
                  전체 {displayRecords.length}건
                </span>
                <select
                  value={listFilterGubun}
                  onChange={e => setListFilterGubun(e.target.value)}
                  className="bg-[#111] border border-[#222] rounded-lg px-2 py-0.5 text-[10px] text-white outline-none focus:border-[#3b82f6]/40 cursor-pointer"
                >
                  <option value="">구분 전체</option>
                  <option value="기초수급자">기초수급자</option>
                  <option value="차상위">차상위</option>
                </select>
                <select
                  value={selectedDong}
                  onChange={e => setSelectedDong(e.target.value)}
                  className="bg-[#111] border border-[#222] rounded-lg px-2 py-0.5 text-[10px] text-white outline-none focus:border-[#3b82f6]/40 cursor-pointer"
                >
                  {dongList.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <table className="w-full border-collapse text-[10px]">
                <thead className="sticky top-[33px] bg-[#0a0a0a] z-10">
                  <tr className="border-b border-[#1a1a1a]">
                    <th className="w-1 p-0" />
                    <th className="px-2 py-1 text-left text-[9px] text-gray-700 font-black w-7">#</th>
                    <th className="px-1 py-1 text-left text-[9px] text-gray-700 font-black">기사</th>
                    <th className="px-1 py-1 text-left text-[9px] text-gray-700 font-black">이름</th>
                    <th className="px-1 py-1 text-left text-[9px] text-gray-700 font-black">주소</th>
                    <th className="px-1 py-1 text-center text-[9px] text-gray-700 font-black w-10">순</th>
                    <th className="px-1 py-1 text-center text-[9px] text-gray-700 font-black w-5">좌</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRecords.map((r, idx) => {
                    const driver = drivers.find(d => d.id === r._driverId);
                    const isSelected = selectedRecordId === r.id;
                    const roadAddr = extractRoadAddress(r.주소 || '');
                    return (
                      <tr
                        key={r.id} id={`rec-${r.id}`}
                        onClick={(e) => {
                          // select/input 클릭은 행 선택 제외
                          if (['SELECT','INPUT','OPTION'].includes(e.target.tagName)) return;
                          if (r._lat && r._lng) handleSelectRecord(r);
                          else setSelectedRecordId(r.id);
                        }}
                        className={`border-b transition-colors ${r._lat ? 'cursor-pointer' : ''} ${!r._lat ? 'opacity-50' : ''} ${isSelected ? 'bg-blue-900/20' : 'hover:bg-[#0f0f0f]'}`}
                        style={{
                          borderBottomColor: '#0e0e0e',
                          ...(isSelected ? { outline: '1px solid rgba(59,130,246,0.35)', outlineOffset: '-1px' } : {}),
                        }}>
                        {/* 기사 컬러 스트라이프 */}
                        <td className="w-1 p-0 rounded-l" style={{ background: driver?.color || 'transparent', opacity: driver ? 0.85 : 0 }} />
                        <td className="pl-2 pr-1 py-0.5 text-gray-600 tabular-nums text-[9px]">{idx + 1}</td>
                        <td className="px-1 py-0.5">
                          <select
                            value={r._driverId || ''}
                            onChange={e => setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, _driverId: e.target.value || null } : pr))}
                            className="bg-transparent border-0 text-[10px] font-bold focus:outline-none cursor-pointer max-w-[68px] truncate"
                            style={{ color: driver?.color || '#4b5563' }}>
                            <option value="" style={{ color: '#6b7280' }}>미배정</option>
                            {drivers.map(d => <option key={d.id} value={d.id} style={{ color: d.color }}>{d.name}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-0.5 text-white font-bold whitespace-nowrap">{r.이름}</td>
                        <td className="px-1 py-0.5 text-gray-500 max-w-0 w-full">
                          <span className="block truncate" title={r.주소}>{roadAddr}</span>
                        </td>
                        <td className="px-1 py-0.5 text-center">
                          <input
                            value={r.배송순번 || ''}
                            onChange={e => setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, 배송순번: e.target.value } : pr))}
                            className="w-9 bg-[#111] border border-[#1e1e1e] rounded px-1 py-0 text-[9px] text-[#3b82f6] text-center focus:outline-none focus:border-[#3b82f6]/40" />
                        </td>
                        <td className="px-1 py-0.5 text-center text-[9px]">
                          {r._lat ? <span className="text-[#3b82f6]">✓</span> : <span className="text-red-400">✗</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

            </div>
          )}
        </div>

        {/* 선택 핀 — 우측 목록으로 스크롤/하이라이트 처리됨 (팝업 없음) */}
      </div>

      {/* ── 토스트 알림 전 더미 시작 - 행정동 배정 오버레이 제거됨 */}
      {false && (
        <div>
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
                    const cntCoord = records.filter(r => r.행정동 === dong && r._lat && r._lng).length;
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
                              ? 'text-[#3b82f6] bg-[#3b82f6]/10 border border-[#3b82f6]/20'
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

      {/* ── 토스트 알림 ──────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.7)] font-bold text-sm border pointer-events-none
            ${toast.type === 'success' ? 'bg-[#061a0a] border-[#3b82f6]/50 text-[#60a5fa]' :
              toast.type === 'error'   ? 'bg-[#1a0606] border-red-600/50 text-red-400' :
                                         'bg-[#0d0d0d] border-[#333] text-gray-300'}`}
          style={{ animation: 'slideUpToast 0.25s ease-out' }}
        >
          {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'}
          <span>{toast.message}</span>
        </div>
      )}

      {/* ── 미확인 건 패널 ─────────────────────────────────────────── */}
      {showErrorPanel && (() => {
        const errorRecords = records.filter(r => !r._lat || !r._lng);

        const handleReprocess = async (r) => {
          const addrToUse = errorAddrOverrides[r.id]?.trim() || r.주소 || '';
          if (!addrToUse) return;
          setErrorFixingId(r.id);
          try {
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
            const road = extractRoadAddress(addrToUse);
            let coord =
              await fetchCoord(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(road)}&size=1`) ||
              await fetchCoord(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(road)}&size=1`) ||
              await fetchCoord(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent((r.행정동 ? `${r.행정동} ` : '') + road.slice(0, 35))}&size=1`);

            if (coord) {
              setRecords(prev => prev.map(x => x.id === r.id ? { ...x, _lat: coord.lat, _lng: coord.lng, 주소: errorAddrOverrides[r.id]?.trim() || x.주소 } : x));
              const cacheCity = isCloudMode ? cloudCity : (fileInfo?.city || '');
              if (cacheCity) await saveCoordCache(cacheCity, road, coord.lat, coord.lng);
              if (isCloudMode && cloudCity && cloudMonthId && r._cloudDocId) {
                const batch = writeBatch(db);
                batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId), { lat: coord.lat, lng: coord.lng, ...(errorAddrOverrides[r.id]?.trim() ? { 주소: errorAddrOverrides[r.id].trim() } : {}) });
                await batch.commit();
              }
            } else {
              alert(`❌ 좌표를 찾지 못했습니다.\n주소를 더 구체적으로 수정해 보세요.`);
            }
          } catch (e) {
            alert('재처리 실패: ' + e.message);
          } finally {
            setErrorFixingId(null);
          }
        };

        const handleExclude = (id) => {
          setRecords(prev => prev.filter(r => r.id !== id));
        };

        return (
          <div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-[#0d1117] border border-red-700/40 rounded-t-2xl sm:rounded-2xl shadow-[0_-20px_60px_rgba(0,0,0,0.8)] flex flex-col max-h-[80vh]">
              {/* 패널 헤더 */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a] shrink-0">
                <div className="flex items-center gap-2">
                  <AlertCircle size={16} className="text-red-400" />
                  <span className="text-white font-black text-sm">미확인 {errorRecords.length}건</span>
                  <span className="text-gray-500 text-xs">— 좌표를 찾지 못한 주소</span>
                </div>
                <button onClick={() => setShowErrorPanel(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>

              {/* 목록 */}
              <div className="overflow-y-auto flex-1 p-4 space-y-3">
                {errorRecords.length === 0 ? (
                  <div className="text-center py-10 text-gray-500 text-sm">모든 주소의 좌표가 확인되었습니다 ✓</div>
                ) : errorRecords.map(r => {
                  const isFixing = errorFixingId === r.id;
                  const overrideAddr = errorAddrOverrides[r.id] ?? '';
                  return (
                    <div key={r.id} className="bg-[#111] border border-[#222] rounded-xl p-4 space-y-3">
                      {/* 이름 · 행정동 · 오류사유 */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-white font-black text-sm">{r.이름 || r.name || '—'}</span>
                          {r.행정동 && <span className="ml-2 text-[10px] text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">{r.행정동}</span>}
                          {r._사유 && <div className="mt-1 text-[10px] text-red-400">{r._사유}</div>}
                        </div>
                        <button
                          onClick={() => handleExclude(r.id)}
                          disabled={isFixing}
                          className="shrink-0 text-[10px] text-gray-500 hover:text-red-400 border border-[#333] hover:border-red-700/50 rounded px-2 py-1 transition-colors disabled:opacity-40"
                        >
                          제외
                        </button>
                      </div>

                      {/* 현재 주소 */}
                      <div className="text-xs text-gray-400 bg-[#0a0a0a] rounded-lg px-3 py-2 break-all">
                        {r.주소 || <span className="text-gray-600 italic">주소 없음</span>}
                      </div>

                      {/* 주소 수정 입력 */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={overrideAddr}
                          onChange={e => setErrorAddrOverrides(prev => ({ ...prev, [r.id]: e.target.value }))}
                          placeholder="주소 수정 (비우면 원본 주소로 재처리)"
                          className="flex-1 bg-[#1a1a1a] border border-[#333] focus:border-red-600/60 rounded-lg px-3 py-2 text-white text-xs focus:outline-none placeholder-gray-600 transition-colors"
                          onKeyDown={e => { if (e.key === 'Enter' && !isFixing) handleReprocess(r); }}
                          disabled={isFixing}
                        />
                        <button
                          onClick={() => handleReprocess(r)}
                          disabled={isFixing}
                          className="shrink-0 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-black rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          {isFixing ? <><Search size={12} className="animate-spin" />처리중</> : <><Search size={12} />재처리</>}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 패널 푸터 */}
              <div className="shrink-0 px-5 py-4 border-t border-[#1a1a1a] flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {errorRecords.length > 0 ? `${errorRecords.length}건 남음 — 주소 수정 후 재처리하거나 제외하세요` : '처리 완료'}
                </span>
                <button
                  onClick={() => setShowErrorPanel(false)}
                  className="px-5 py-2 bg-[#1a1a1a] border border-[#333] text-gray-300 hover:text-white rounded-xl text-sm font-bold transition-colors"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 임대 아파트 다기사 배정 모달 ────────────────────────── */}
      {aptMultiModal && (
        <div className="absolute inset-0 z-[300] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-lg flex flex-col shadow-2xl">
            {/* 헤더 */}
            <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center gap-3">
              <Building2 size={16} className="text-orange-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-white truncate">{aptMultiModal.aptName}</h3>
                <p className="text-[10px] text-gray-500">총 {aptMultiModal.totalQty}포 · 동별 기사 배정</p>
              </div>
              <button onClick={() => setAptMultiModal(null)} className="p-1.5 text-gray-600 hover:text-white transition-colors shrink-0">
                <X size={14} />
              </button>
            </div>

            {/* 동별 배정 테이블 */}
            <div className="flex-1 overflow-auto max-h-[60vh] px-5 py-4 space-y-2">
              <p className="text-[10px] text-gray-500 mb-3">각 동의 담당 기사를 선택하세요. 동 단위로 일괄 적용됩니다.</p>
              {aptMultiModal.dongs.map((d, i) => {
                const assignedDriver = drivers.find(dr => dr.id === d.assignedDriverId);
                const dongLabel = d.dong > 0 ? `${d.dong}동` : '동 미확인';
                return (
                  <div key={i} className="flex items-center gap-3 bg-[#111] border border-[#1e1e1e] rounded-xl px-4 py-3">
                    <span className="text-orange-400 font-black text-sm w-16 shrink-0">{dongLabel}</span>
                    <span className="text-gray-500 text-[10px] w-20 shrink-0">{d.records.length}명 · {d.qty}포</span>
                    <select
                      value={d.assignedDriverId || ''}
                      onChange={e => setAptMultiModal(prev => ({
                        ...prev,
                        dongs: prev.dongs.map((dd, ii) => ii === i ? { ...dd, assignedDriverId: e.target.value || null } : dd),
                      }))}
                      className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-orange-500/40 transition-colors"
                      style={{ color: assignedDriver?.color || '#6b7280' }}
                    >
                      <option value="">미배정</option>
                      {drivers.map(dr => (
                        <option key={dr.id} value={dr.id} style={{ color: dr.color }}>{dr.name}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

            {/* 푸터 버튼 */}
            <div className="px-5 py-4 border-t border-[#1a1a1a] flex items-center justify-between gap-3">
              <button
                onClick={() => setAptMultiModal(null)}
                className="px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white text-xs font-bold rounded-xl transition-colors"
              >
                취소
              </button>
              <button
                onClick={applyAptMultiAssignment}
                className="flex-1 py-2 bg-orange-700 hover:bg-orange-600 text-white text-xs font-black rounded-xl transition-colors"
              >
                적용 ({aptMultiModal.dongs.length}개 동 일괄 배정)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 오버레이 패널 (지도 DOM 유지) ─────────────────────────── */}
      {cloudPickerOverlay}

      {/* ── 공유 링크 모달 ──────────────────────────────────────────── */}
      {shareModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <Share2 size={16} className="text-green-400" />
                <span className="text-white font-black text-sm">기사 배송루트 공유 링크</span>
              </div>
              <button onClick={() => setShareModal(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-[10px] text-gray-500">기사에게 링크를 전달하면 모바일에서 자신의 배송루트를 카카오지도로 확인할 수 있습니다.</p>
              {shareModal.links.map(l => (
                <div key={l.driverId} className="flex items-center gap-2 bg-[#111] border border-[#2a2a2a] rounded-xl p-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color }} />
                  <span className="text-white text-[11px] font-bold w-16 shrink-0">{l.name}</span>
                  <span className="text-gray-500 text-[9px] flex-1 truncate">{l.url}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(l.url);
                      showToast('success', `${l.name} 링크 복사됨`);
                    }}
                    className="px-2 py-1 bg-green-900/40 border border-green-600/40 text-green-400 hover:bg-green-800/40 rounded-lg text-[9px] font-bold flex items-center gap-1 shrink-0 transition-colors"
                  >
                    <Link size={9} /> 복사
                  </button>
                </div>
              ))}
            </div>
            <div className="px-5 pb-4 flex justify-end">
              <button
                onClick={() => {
                  const all = shareModal.links.map(l => `[${l.name}]\n${l.url}`).join('\n\n');
                  navigator.clipboard.writeText(all);
                  showToast('success', '전체 링크 복사됨');
                }}
                className="px-4 py-2 bg-green-700/30 border border-green-600/50 text-green-300 hover:bg-green-700/50 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors"
              >
                <Share2 size={12} /> 전체 복사
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
