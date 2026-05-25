import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, MapPin, Navigation2, Plus, Minus, RefreshCw, Save, AlertTriangle, Map as MapIcon, List, Building2, Clock, FileSpreadsheet, Download, HardDrive, Maximize2, Minimize2, Columns, AlertCircle, Search, Crosshair, Share2, Link, Eraser, ArrowLeftRight } from 'lucide-react';
import { db, auth } from '../config/firebase.js';
import { collection, serverTimestamp, Timestamp, getDocs, getDoc, setDoc, updateDoc, doc, writeBatch, query, where, limit } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import CoordBrushModal from './CoordBrushModal.jsx';

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;
const KAKAO_REST_KEY = import.meta.env.VITE_KAKAO_REST_KEY;
const ADMIN_EMAILS = ['ttong627@gmail.com', 'admin@logis-op.com', 'jsh6270@gmail.com'];
const SHARE_LINK_TTL_DAYS = 45;

const DRIVER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
];

// DS-14: 배송 예상속도 (정차·엘리베이터·인터폰 포함 도심 평균)
const SEQUENCE_ESTIMATED_SPEED_KMH = 10;

const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getLineSide = (lineStart, lineEnd, point) => {
  const ax = Number(lineStart?.lng);
  const ay = Number(lineStart?.lat);
  const bx = Number(lineEnd?.lng);
  const by = Number(lineEnd?.lat);
  const px = Number(point?.lng);
  const py = Number(point?.lat);
  if (![ax, ay, bx, by, px, py].every(Number.isFinite)) return 0;
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
};

const parseAptDong = (addr) => {
  const text = String(addr || '');
  const m = text.match(/(?:^|[\s,(])(\d{1,4})\s*동(?:[\s,)]|$)/) || text.match(/(?:^|[\s,(])(\d{3,4})\s*[-]\s*\d{1,4}\s*호?/);
  return m ? parseInt(m[1], 10) : null;
};
const parseFloorHo = (addr) => {
  const floor = addr?.match(/(\d+)\s*층/)?.[1] || '0';
  const ho = addr?.match(/(\d+)\s*호/)?.[1] || '0';
  return { floor: parseInt(floor), ho: parseInt(ho) };
};

// DS-12: 호수에서 층 번호 추론 (양수=지상, 음수=지하, null=추론불가)
const parseInferredFloor = (text) => {
  const s = String(text || '');
  if (!s) return null;
  // 가/나/다... + digits + 호 → 건물동 표기, skip
  if (/[가나다라마바사아자차카타파하]\d+호/.test(s)) return null;
  // 상가 포함 → skip
  if (/상가/.test(s)) return null;
  // 지하 prefix → 음수 층
  if (/지하/.test(s)) {
    const m = s.match(/지하\s*(\d+)/);
    return m ? -(parseInt(m[1])) : -1;
  }
  // B동이 있으면 B는 건물동 표기 → 지하 오인 금지, 호수 inference로 낙하
  // B + digits + 호 (동 없음) → 지하
  if (/B\d+호/.test(s) && !/B\s*동/.test(s)) {
    const m = s.match(/B(\d)/);
    return m ? -(parseInt(m[1])) : -1;
  }
  // 층 명시
  const floorMatch = s.match(/(\d+)\s*층/);
  if (floorMatch) return parseInt(floorMatch[1]);
  // 호수에서 추론: 동 표기 제거 후 \d+호 추출
  const stripped = s.replace(/[A-Za-z가-힣]\s*동\s*/g, '').replace(/\d+\s*동\s*/g, '');
  const hoMatch = stripped.match(/(\d+)\s*호/);
  if (!hoMatch) return null;
  const n = hoMatch[1];
  if (n.length === 3) return parseInt(n[0]);
  if (n.length === 4) return parseInt(n.slice(0, 2));
  if (n.length >= 5) return parseInt(n.slice(0, n.length - 2));
  return null;
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

const normalizeRegionKey = (value) => String(value || '').replace(/\s+/g, '').trim();

const getRouteDong = (record) =>
  String(record?.배정행정동 || record?.routeDong || record?.행정동 || '').trim();

const getKakaoAreaMeta = (raw) => {
  const road = raw?.road_address || {};
  const addr = raw?.address || {};
  const sido = road.region_1depth_name || addr.region_1depth_name || '';
  const sigungu = road.region_2depth_name || addr.region_2depth_name || '';
  const dong = road.region_3depth_h_name || road.region_3depth_name || addr.region_3depth_h_name || addr.region_3depth_name || '';
  return { sido, sigungu, dong };
};

const isCoordAssignable = (record) => record?.좌표검증상태 !== '지자체벗어남';

const assessKakaoAreaMatch = (record, raw, cityLabel = '') => {
  const { sido, sigungu, dong } = getKakaoAreaMeta(raw);
  const parts = String(cityLabel || '').trim().split(/\s+/).filter(Boolean);
  const selectedSido = parts[0] || '';
  const selectedSigungu = parts.slice(1).join(' ');
  const selectedSidoKey = normalizeRegionKey(selectedSido);
  const selectedSigunguKey = normalizeRegionKey(selectedSigungu);
  const matchedSidoKey = normalizeRegionKey(sido);
  const matchedSigunguKey = normalizeRegionKey(sigungu);
  const inputDong = String(record?.행정동 || '').trim();

  const cityOk = !selectedSidoKey || !selectedSigunguKey || !matchedSidoKey || !matchedSigunguKey
    ? true
    : selectedSidoKey === matchedSidoKey && (
      selectedSigunguKey === matchedSigunguKey ||
      selectedSigunguKey.includes(matchedSigunguKey) ||
      matchedSigunguKey.includes(selectedSigunguKey)
    );

  if (!cityOk) {
    return {
      status: '지자체벗어남',
      transferNeeded: false,
      matchedSido: sido,
      matchedSigungu: sigungu,
      matchedDong: dong,
      routeDong: inputDong,
      reason: `좌표 지자체 벗어남: 선택 ${selectedSido} ${selectedSigungu}, 확인 ${sido} ${sigungu}`,
    };
  }
  return {
    status: '정상',
    transferNeeded: false,
    matchedSido: sido,
    matchedSigungu: sigungu,
    matchedDong: dong,
    routeDong: inputDong,
    reason: '',
  };
};
const KAKAO_COLOR_MAP = { '#3b82f6':'blue','#f59e0b':'yellow','#ef4444':'red','#8b5cf6':'violet','#06b6d4':'blue','#f97316':'orange','#ec4899':'red','#14b8a6':'green','#a855f7':'violet','#84cc16':'green','#f43f5e':'red','#0ea5e9':'blue','#d97706':'yellow','#10b981':'green','#6366f1':'violet','#e11d48':'red','#0891b2':'blue','#65a30d':'green','#7c3aed':'violet' };

// ── 유효부담 자동 감지 상수 ──────────────────────────────────────────────────
const RENTAL_KEYWORDS = ['LH', 'SH', '임대', '행복주택', '국민임대', '영구임대', '공공임대', '보금자리', '매입임대'];
const STAIRS_KEYWORDS = ['빌라', '연립', '다세대', '단독주택'];
const HEAVY_NOTE_KW   = ['문앞', '거동불편', '직접전달', '현관앞', '직접'];
const MEDIUM_NOTE_KW  = ['전화필수', '골목', '경비실', '게이트'];

const getEffectiveLoad = (record) => {
  const qty  = parseInt(record.포수 || record['수량(포수)']) || 1;
  const addr = record.주소 || '';
  const note = record.특이사항 || '';
  const full = [
    addr,
    note,
    record._buildingName,
    record.buildingName,
    record._standardRoadAddress,
    record.standardRoadAddress,
    record?._routeHints?.apartmentGroupKey,
    record?.routeHints?.apartmentGroupKey,
  ].filter(Boolean).join(' ');
  if (qty >= 20 && RENTAL_KEYWORDS.some(k => full.includes(k))) return qty * 0.3;
  if (STAIRS_KEYWORDS.some(k => addr.includes(k))) {
    const fl = parseInt(addr.match(/(\d+)\s*층/)?.[1] || '2');
    return qty * (1 + Math.min(fl, 5) * 0.1);
  }
  if (HEAVY_NOTE_KW.some(k => note.includes(k))) return qty * 1.5;
  if (MEDIUM_NOTE_KW.some(k => note.includes(k))) return qty * 1.2;
  return qty;
};

const normalizeAptGroupPart = (value) =>
  String(value || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[()]/g, '')
    .trim();

const APT_LIKE_RE = /아파트|APT|Apartment|주공|휴먼시아|휴먼시아|뜨란채|마을|단지|타운|빌리지|하이츠|아이파크|자이|래미안|푸르지오|힐스테이트|롯데캐슬|더샵|e편한세상|이편한세상|센트럴|리버|파크|LH|SH|임대|행복주택|국민임대|영구임대|공공임대|매입임대/i;
const RENTAL_LIKE_RE = /LH|SH|임대|행복주택|국민임대|영구임대|공공임대|보금자리|매입임대|주공|휴먼시아|뜨란채/i;

const getRecordSearchText = (record) => [
  record?.주소,
  record?.특이사항,
  record?._buildingName,
  record?.buildingName,
  record?._standardRoadAddress,
  record?.standardRoadAddress,
  record?._routeHints?.apartmentGroupKey,
  record?.routeHints?.apartmentGroupKey,
].filter(Boolean).join(' ');

const isApartmentLike = (record) => {
  if (!record) return false;
  if (record._isApt || record.isApt) return true;
  if (record?._routeHints?.apartmentGroupKey || record?.routeHints?.apartmentGroupKey) return true;
  return APT_LIKE_RE.test(getRecordSearchText(record));
};

const isRentalLike = (record) => RENTAL_LIKE_RE.test(getRecordSearchText(record));

const extractBuildingName = (addr) => {
  const parenMatches = [...String(addr || '').matchAll(/\(([^()]*)\)/g)];
  for (let i = parenMatches.length - 1; i >= 0; i--) {
    const parts = parenMatches[i][1].split(',').map(normalizeAptGroupPart).filter(Boolean);
    const building = parts.find(part => !/(동|읍|면|리)$/.test(part));
    if (building) return building;
  }
  return '';
};

// JUSO 정제 결과의 도로명주소를 아파트 단지 키로 우선 사용한다.
// 건물명은 표시/임대 판별 보조이며, 도로명주소를 못 읽을 때만 그룹 키 폴백으로 쓴다.
const getAptGroupMeta = (record) => {
  if (!isApartmentLike(record)) return null;
  const hintedKey = normalizeAptGroupPart(record?._routeHints?.apartmentGroupKey || record?.routeHints?.apartmentGroupKey || '');
  const hintedBuilding = normalizeAptGroupPart(record?._buildingName || record?.buildingName || '');
  const hintedRoad = normalizeAptGroupPart(record?._standardRoadAddress || record?.standardRoadAddress || '');
  if (hintedKey) {
    return {
      key: `db:${hintedKey}`,
      road: hintedRoad,
      building: hintedBuilding,
      label: hintedBuilding || hintedRoad || hintedKey,
    };
  }
  const road = normalizeAptGroupPart(extractRoadAddress(record.주소 || ''));
  const building = normalizeAptGroupPart(extractBuildingName(record.주소 || ''));
  if (road.length >= 4) return { key: `road:${road}`, road, building, label: building || road };
  if (building) return { key: `building:${building}`, road: '', building, label: building };
  return null;
};

const getRouteUnitKey = (record) => {
  if (!record) return '';
  const aptMeta = getAptGroupMeta(record);
  if (aptMeta) {
    const splitDong = (record.대형단지분할 || record.largeComplexSplit)
      ? parseAptDong([record._detailAddress, record.detailAddress, record.주소, record.특이사항].filter(Boolean).join(' '))
      : null;
    return splitDong ? `apt-split:${aptMeta.key}:dong:${splitDong}` : `apt:${aptMeta.key}`;
  }
  const addr = normalizeAptGroupPart(record._addressKey || record.주소 || '');
  if (addr) return `addr:${addr}`;
  if (record._lat && record._lng) return `coord:${Number(record._lat).toFixed(5)},${Number(record._lng).toFixed(5)}`;
  return `record:${record.id}`;
};

const buildAssignedRouteUnits = (records, drivers) => {
  const activeDriverIds = new Set(drivers.filter(d => !d.isExternal).map(d => d.id));
  const buckets = new Map();
  records.forEach(record => {
    if (!record?._lat || !record?._lng || !record?._driverId || !activeDriverIds.has(record._driverId)) return;
    const key = getRouteUnitKey(record);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  });

  return [...buckets.entries()].map(([key, recs]) => {
    const load = recs.reduce((s, r) => s + getEffectiveLoad(r), 0) || recs.length || 1;
    const driverVotes = {};
    recs.forEach(r => { driverVotes[r._driverId] = (driverVotes[r._driverId] || 0) + 1; });
    const driverIds = Object.keys(driverVotes);
    const driverId = driverIds.sort((a, b) => driverVotes[b] - driverVotes[a])[0] || '';
    return {
      key,
      ids: recs.map(r => r.id),
      records: recs,
      driverId,
      driverIds,
      lat: recs.reduce((s, r) => s + Number(r._lat) * getEffectiveLoad(r), 0) / load,
      lng: recs.reduce((s, r) => s + Number(r._lng) * getEffectiveLoad(r), 0) / load,
      load,
    };
  });
};

const getMajorityDriverId = (records) => {
  const votes = {};
  records.forEach(record => {
    if (!record._driverId) return;
    votes[record._driverId] = (votes[record._driverId] || 0) + 1;
  });
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

const getMixedRouteUnitIssues = (units) => {
  const issues = new Map();
  units.forEach(unit => {
    if (unit.driverIds.length <= 1) return;
    const targetDriverId = getMajorityDriverId(unit.records) || unit.driverId;
    if (!targetDriverId) return;
    if (unit.records.some(record => record._driverId !== targetDriverId)) {
      issues.set(unit.key, { type: 'split-unit', targetDriverId });
    }
  });
  units.forEach(unit => {
    if (issues.has(unit.key)) return;
    let sameLoad = 0;
    let otherLoad = 0;
    let otherCount = 0;
    const votes = {};
    units.forEach(neighbor => {
      if (neighbor.key === unit.key) return;
      const dist = haversine(unit.lat, unit.lng, neighbor.lat, neighbor.lng);
      if (dist <= 180) {
        if (neighbor.driverId === unit.driverId) sameLoad += neighbor.load || 1;
        else {
          otherLoad += neighbor.load || 1;
          otherCount++;
        }
      }
      if (dist <= 450 && neighbor.driverId && neighbor.driverId !== unit.driverId) {
        votes[neighbor.driverId] = (votes[neighbor.driverId] || 0) + (neighbor.load || 1);
      }
    });
    if (otherCount < 3 || otherLoad <= Math.max(3, sameLoad * 1.6)) return;
    const targetDriverId = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    if (targetDriverId && targetDriverId !== unit.driverId) {
      issues.set(unit.key, { type: 'isolated-unit', targetDriverId });
    }
  });
  return issues;
};

const getMixedRouteUnitKeys = (units) => {
  return new Set(getMixedRouteUnitIssues(units).keys());
};

const getRecordQty = (record) => parseInt(record?.포수 || record?.['수량(포수)']) || 1;

const getSideLabel = (side) => {
  if (side === 'left') return '좌측(홀수)';
  if (side === 'right') return '우측(짝수)';
  return '양측/골목';
};

const buildMapInsights = ({ records, drivers, largeAptComplexes = [] }) => {
  const activeDriverIds = new Set(drivers.filter(d => !d.isExternal).map(d => d.id));
  const assignedUnits = buildAssignedRouteUnits(records, drivers);
  const mixedKeys = getMixedRouteUnitKeys(assignedUnits);
  const mixedRecords = assignedUnits
    .filter(unit => mixedKeys.has(unit.key))
    .flatMap(unit => unit.records);

  const roadBuckets = new Map();
  records.forEach(record => {
    if (!record?._lat || !record?._lng || !record?._driverId || !activeDriverIds.has(record._driverId)) return;
    const roadInfo = parseRoadInfo(record._standardRoadAddress || record.standardRoadAddress || record.주소 || '');
    if (!roadInfo.road) return;
    const sideLabel = getSideLabel(roadInfo.side);
    const key = `${roadInfo.road}:${roadInfo.side || 'both'}`;
    if (!roadBuckets.has(key)) {
      roadBuckets.set(key, {
        key,
        road: roadInfo.road,
        side: roadInfo.side || '',
        label: `${roadInfo.road} ${sideLabel}`,
        count: 0,
        qty: 0,
        load: 0,
        driverIds: new Set(),
        recordIds: [],
      });
    }
    const bucket = roadBuckets.get(key);
    bucket.count += 1;
    bucket.qty += getRecordQty(record);
    bucket.load += getEffectiveLoad(record);
    bucket.driverIds.add(record._driverId);
    bucket.recordIds.push(record.id);
  });

  const roadStats = [...roadBuckets.values()]
    .map(bucket => ({
      ...bucket,
      load: Math.round(bucket.load * 10) / 10,
      driverCount: bucket.driverIds.size,
      driverIds: [...bucket.driverIds],
    }))
    .sort((a, b) => {
      if (b.driverCount !== a.driverCount) return b.driverCount - a.driverCount;
      return b.load - a.load;
    });

  const mixedRoads = roadStats.filter(road => road.driverCount > 1 && road.count >= 2);
  const driverLoadStats = drivers.filter(d => !d.isExternal).map(driver => {
    const assigned = records.filter(r => r._driverId === driver.id);
    const qty = assigned.reduce((sum, record) => sum + getRecordQty(record), 0);
    const load = assigned.reduce((sum, record) => sum + getEffectiveLoad(record), 0);
    return {
      driverId: driver.id,
      driverName: driver.name,
      color: driver.color,
      count: assigned.length,
      qty,
      load: Math.round(load * 10) / 10,
    };
  });
  const avgLoad = driverLoadStats.length
    ? driverLoadStats.reduce((sum, stat) => sum + stat.load, 0) / driverLoadStats.length
    : 0;
  const loadWarnings = driverLoadStats
    .map(stat => ({
      ...stat,
      diffPct: avgLoad ? Math.round(((stat.load - avgLoad) / avgLoad) * 100) : 0,
    }))
    .filter(stat => Math.abs(stat.diffPct) >= 25)
    .sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));

  const isolatedUnits = assignedUnits
    .map(unit => {
      let sameCount = 0;
      let nearestSame = Infinity;
      assignedUnits.forEach(other => {
        if (other.key === unit.key || other.driverId !== unit.driverId) return;
        const dist = haversine(unit.lat, unit.lng, other.lat, other.lng);
        if (dist <= 300) sameCount += 1;
        nearestSame = Math.min(nearestSame, dist);
      });
      return { ...unit, sameCount, nearestSame };
    })
    .filter(unit => unit.driverId && (unit.sameCount < 2 || unit.nearestSame > 450))
    .sort((a, b) => (b.load || 0) - (a.load || 0))
    .slice(0, 8);

  const coordIssues = {
    noCoord: records.filter(r => !r._lat || !r._lng).length,
    outCity: records.filter(r => r.좌표검증상태 === '지자체벗어남').length,
    outDong: 0,
  };

  const actions = [];
  if (mixedRecords.length) actions.push(`혼재 의심 ${mixedRecords.length}건은 묶음 보정으로 먼저 정리하세요.`);
  if (mixedRoads.length) actions.push(`주요 도로 ${mixedRoads.length}개가 여러 기사에게 나뉘었습니다. 홀짝 좌우 기준 경계를 확인하세요.`);
  if (isolatedUnits.length) actions.push(`외곽 고립 묶음 ${isolatedUnits.length}개는 같은 방향 권역 기사에게 붙이는 편이 좋습니다.`);
  if (largeAptComplexes.length) actions.push(`50포 이상 대형단지 ${largeAptComplexes.length}개는 동 단위 분할 여부를 확인하세요.`);
  if (coordIssues.outCity) actions.push(`지자체 이탈 좌표 ${coordIssues.outCity}건은 배정 전 재검증이 필요합니다.`);
  if (!actions.length) actions.push('현재 지도 기준으로 큰 혼재 신호는 없습니다. 자동 순번 전 기사별 포수와 동선을 마지막 확인하세요.');

  return {
    mixedRecords,
    mixedCount: mixedRecords.length,
    roadStats,
    mixedRoads,
    isolatedUnits,
    coordIssues,
    driverLoadStats,
    loadWarnings,
    actions,
  };
};

// ── 도로명 파싱 헬퍼 ─────────────────────────────────────────────────────
const parseRoadInfo = (addr) => {
  if (!addr) return { road: '', side: '', num: 9999, sub: 0 };
  // 도로명 + 건물번호 추출 (예: "강남대로 127-3")
  const m = addr.match(/([가-힣\w]+(?:대로|로|길|가))\s*(\d+)(?:-(\d+))?/);
  if (m) {
    const num = parseInt(m[2]) || 9999;
    const side = /(?:대로|로)$/.test(m[1]) && num !== 9999
      ? (num % 2 ? 'left' : 'right')
      : '';
    return { road: m[1], side, num, sub: parseInt(m[3]) || 0 };
  }
  return { road: '', side: '', num: 9999, sub: 0 };
};

const getSequenceAddress = (record) =>
  record?._standardRoadAddress ||
  record?.standardRoadAddress ||
  record?._addressKey ||
  extractRoadAddress(record?.주소 || '') ||
  record?.주소 ||
  '';

const getSequenceUnitMeta = (record) => {
  const aptMeta = getAptGroupMeta(record);
  if (aptMeta) {
    const dong = parseAptDong([record._detailAddress, record.detailAddress, record.주소, record.특이사항].filter(Boolean).join(' ')) || 0;
    return {
      key: `apt:${aptMeta.key}:${dong || 'all'}`,
      type: 'apt',
      label: dong ? `${aptMeta.label} ${dong}동` : aptMeta.label,
      sortNo: dong || 9999,
    };
  }
  const roadInfo = parseRoadInfo(getSequenceAddress(record));
  if (roadInfo.road) {
    return {
      key: `road:${roadInfo.road}:${roadInfo.side || 'both'}`,
      type: 'road',
      label: `${roadInfo.road} ${getSideLabel(roadInfo.side)}`,
      roadInfo,
      sortNo: roadInfo.num,
    };
  }
  if (record._lat && record._lng) {
    return {
      key: `near:${Number(record._lat).toFixed(4)},${Number(record._lng).toFixed(4)}`,
      type: 'near',
      label: '좌표기반',
      sortNo: 9999,
    };
  }
  return { key: `no-coord:${record.id}`, type: 'no_coord', label: '좌표없음', sortNo: 9999 };
};

const sortSequenceUnitRecords = (records) => {
  return [...records].sort((a, b) => {
    const aptA = getAptGroupMeta(a);
    const aptB = getAptGroupMeta(b);
    if (aptA || aptB) {
      const dongA = parseAptDong([a._detailAddress, a.detailAddress, a.주소, a.특이사항].filter(Boolean).join(' ')) || 9999;
      const dongB = parseAptDong([b._detailAddress, b.detailAddress, b.주소, b.특이사항].filter(Boolean).join(' ')) || 9999;
      if (dongA !== dongB) return dongA - dongB;
      // DS-12: 호수에서 층 추론 → 층 오름차순 정렬
      const addrA = [a._detailAddress, a.detailAddress, a.주소].filter(Boolean).join(' ');
      const addrB = [b._detailAddress, b.detailAddress, b.주소].filter(Boolean).join(' ');
      const iFloorA = parseInferredFloor(addrA);
      const iFloorB = parseInferredFloor(addrB);
      if (iFloorA !== null && iFloorB !== null && iFloorA !== iFloorB) return iFloorA - iFloorB;
      // 층 추론 실패 시 기존 parseFloorHo fallback
      const fA = parseFloorHo(addrA);
      const fB = parseFloorHo(addrB);
      if (fA.ho !== fB.ho) return fA.ho - fB.ho;
      return fA.floor - fB.floor;
    }
    const rA = parseRoadInfo(getSequenceAddress(a));
    const rB = parseRoadInfo(getSequenceAddress(b));
    if (rA.road !== rB.road) return rA.road.localeCompare(rB.road, 'ko', { numeric: true });
    if (rA.side !== rB.side) return String(rA.side).localeCompare(String(rB.side));
    if (rA.num !== rB.num) return rA.num - rB.num;
    if (rA.sub !== rB.sub) return rA.sub - rB.sub;
    return String(a.이름 || '').localeCompare(String(b.이름 || ''), 'ko');
  });
};

const buildSequenceUnits = (records) => {
  const buckets = new Map();
  records.forEach(record => {
    const meta = getSequenceUnitMeta(record);
    if (!buckets.has(meta.key)) buckets.set(meta.key, { ...meta, records: [] });
    buckets.get(meta.key).records.push(record);
  });
  return [...buckets.values()]
    .map(unit => {
      const sorted = sortSequenceUnitRecords(unit.records);
      const withCoord = sorted.filter(r => r._lat && r._lng);
      const first = withCoord[0] || sorted[0];
      const last = withCoord[withCoord.length - 1] || sorted[sorted.length - 1];
      const load = sorted.reduce((s, r) => s + getEffectiveLoad(r), 0) || sorted.length || 1;
      return {
        ...unit,
        records: sorted,
        lat: withCoord.length ? withCoord.reduce((s, r) => s + Number(r._lat) * getEffectiveLoad(r), 0) / load : null,
        lng: withCoord.length ? withCoord.reduce((s, r) => s + Number(r._lng) * getEffectiveLoad(r), 0) / load : null,
        sLat: first?._lat || null,
        sLng: first?._lng || null,
        eLat: last?._lat || null,
        eLng: last?._lng || null,
        hasCoord: withCoord.length > 0,
        noCoordCount: sorted.length - withCoord.length,
      };
    });
};

const getUnitStraightDistance = (from, to) => {
  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) return Infinity;
  return haversine(from.lat, from.lng, to.lat, to.lng);
};

const getUnitEdgeKey = (from, to) => [
  Number(from?.lat || 0).toFixed(5),
  Number(from?.lng || 0).toFixed(5),
  Number(to?.lat || 0).toFixed(5),
  Number(to?.lng || 0).toFixed(5),
].join(',');

const getLocalRouteEdge = (from, to) => {
  const straight = getUnitStraightDistance(from, to);
  const fromRoad = from?.roadInfo || parseRoadInfo(from?.records?.[0] ? getSequenceAddress(from.records[0]) : '');
  const toRoad = to?.roadInfo || parseRoadInfo(to?.records?.[0] ? getSequenceAddress(to.records[0]) : '');
  const sameRoad = fromRoad.road && fromRoad.road === toRoad.road;
  const sameSide = sameRoad && fromRoad.side === toRoad.side;
  const sameApt = from?.type === 'apt' && to?.type === 'apt' && from.key.split(':').slice(0, 3).join(':') === to.key.split(':').slice(0, 3).join(':');
  const crossSide = sameRoad && fromRoad.side && toRoad.side && fromRoad.side !== toRoad.side;
  const roadPenalty = crossSide ? 1.85 : sameSide ? 1.05 : sameRoad ? 1.2 : 1.35;
  const aptPenalty = sameApt ? 0.65 : 1;
  const carDistance = Math.round(straight * roadPenalty * aptPenalty);
  const duration = Math.round(carDistance / 7.5 + (crossSide ? 45 : 0) + (sameApt ? -20 : 0));
  const walkCandidate = straight <= 120 && (sameApt || crossSide || carDistance > straight * 2.4);
  return {
    source: 'local',
    straight,
    carDistance,
    duration: Math.max(20, duration),
    walkCandidate,
  };
};

const fetchKakaoDirectionsEdge = async (from, to, signal) => {
  if (!KAKAO_REST_KEY || !from?.lng || !from?.lat || !to?.lng || !to?.lat) return null;
  const url = `https://apis-navi.kakaomobility.com/v1/directions?origin=${from.lng},${from.lat}&destination=${to.lng},${to.lat}&priority=RECOMMEND&summary=true`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` },
    signal,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const summary = data?.routes?.[0]?.summary;
  if (!summary?.distance) return null;
  const straight = getUnitStraightDistance(from, to);
  const carDistance = Number(summary.distance) || straight;
  const duration = Number(summary.duration) || Math.round(carDistance / 7);
  return {
    source: 'kakao',
    straight,
    carDistance,
    duration,
    walkCandidate: straight <= 120 && carDistance > straight * 3.2,
  };
};

const getAdvancedEdgeCost = async (from, to, cache, useApi = false) => {
  const key = getUnitEdgeKey(from, to);
  if (cache?.has(key)) return cache.get(key);
  let edge = null;
  if (useApi) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 1200);
    try {
      edge = await fetchKakaoDirectionsEdge(from, to, ctrl.signal);
    } catch {
      edge = null;
    } finally {
      clearTimeout(tid);
    }
  }
  if (!edge) edge = getLocalRouteEdge(from, to);
  cache?.set(key, edge);
  return edge;
};

const scoreAdvancedEdge = (from, to, edge) => {
  const fromRoad = from?.roadInfo || parseRoadInfo(from?.records?.[0] ? getSequenceAddress(from.records[0]) : '');
  const toRoad = to?.roadInfo || parseRoadInfo(to?.records?.[0] ? getSequenceAddress(to.records[0]) : '');
  const sameRoad = fromRoad.road && fromRoad.road === toRoad.road;
  const sameSide = sameRoad && fromRoad.side === toRoad.side;
  const crossSide = sameRoad && fromRoad.side && toRoad.side && fromRoad.side !== toRoad.side;
  const sameApt = from?.type === 'apt' && to?.type === 'apt' && from.key.split(':').slice(0, 3).join(':') === to.key.split(':').slice(0, 3).join(':');
  let score = edge.duration || edge.carDistance || edge.straight || 999999;
  if (sameApt) score -= 90;
  if (sameSide) score -= 55;
  else if (sameRoad) score -= 20;
  if (crossSide) score += 80;
  if (edge.walkCandidate) score -= 45;
  return score;
};

const advancedRoadSequence = async (points, options = {}) => {
  if (!points.length) return [];
  const cache = options.edgeCache || new Map();
  const units = buildSequenceUnits(points);
  const noCoordUnits = units.filter(unit => !unit.hasCoord);
  const rem = units.filter(unit => unit.hasCoord);
  if (!rem.length) return noCoordUnits.flatMap(unit => unit.records);

  const startIdx = rem.reduce((mi, unit, i) => unit.lat > rem[mi].lat ? i : mi, 0);
  const ordered = [rem.splice(startIdx, 1)[0]];
  const usedEdges = [];

  while (rem.length) {
    const last = ordered[ordered.length - 1];
    const candidates = rem
      .map((unit, index) => ({ unit, index, straight: getUnitStraightDistance(last, unit) }))
      .sort((a, b) => a.straight - b.straight)
      .slice(0, options.candidateLimit || 6);

    let best = null;
    for (const candidate of candidates) {
      const edge = await getAdvancedEdgeCost(last, candidate.unit, cache, options.useApi);
      const score = scoreAdvancedEdge(last, candidate.unit, edge);
      if (!best || score < best.score) best = { ...candidate, edge, score };
    }
    if (!best) break;
    ordered.push(rem.splice(best.index, 1)[0]);
    usedEdges.push(best.edge);
  }

  const result = [];
  let prevLat = ordered[0].lat;
  let prevLng = ordered[0].lng;
  ordered.forEach(unit => {
    const fwdD = unit.sLat && unit.sLng ? haversine(prevLat, prevLng, unit.sLat, unit.sLng) : 0;
    const revD = unit.eLat && unit.eLng ? haversine(prevLat, prevLng, unit.eLat, unit.eLng) : fwdD;
    const group = revD < fwdD ? [...unit.records].reverse() : unit.records;
    result.push(...group);
    const last = group[group.length - 1];
    prevLat = last?._lat || unit.lat;
    prevLng = last?._lng || unit.lng;
  });
  return [...result, ...noCoordUnits.flatMap(unit => unit.records)];
};

// ── 2-opt 교차 제거 (도로 그룹 배열 in-place 최적화) ────────────────────────
// edge (i→i+1) 과 edge (j→j+1) 을 바꿨을 때 총 거리가 줄면 구간 반전 적용
const twoOptRoads = (roads) => {
  const n = roads.length;
  if (n < 4) return;
  let improved = true;
  let pass = 0;
  while (improved && pass++ < 50) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        const a = roads[i], b = roads[i + 1], c = roads[j];
        const d = j + 1 < n ? roads[j + 1] : null;
        const oldD = haversine(a.lat, a.lng, b.lat, b.lng)
                   + (d ? haversine(c.lat, c.lng, d.lat, d.lng) : 0);
        const newD = haversine(a.lat, a.lng, c.lat, c.lng)
                   + (d ? haversine(b.lat, b.lng, d.lat, d.lng) : 0);
        if (newD < oldD - 1) {
          roads.splice(i + 1, j - i, ...roads.slice(i + 1, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
};

// ── 도로 기반 TSP + 2-opt 교차 제거 + 진입 방향 최적화 ─────────────────────
// ① 도로명 그룹화 → ② 건물번호 오름차순 → ③ 최근접 이웃 초기 순서
// ④ 2-opt 교차 제거 → ⑤ 각 도로 진입 방향(정/역방향) 최소거리로 선택
const roadAwareTSP = (points, startPoint = null) => {
  if (!points.length) return [];

  // buildSequenceUnits 1회만 호출 → coordUnits / noCoordUnits 분리
  const allUnits = buildSequenceUnits(points);
  const coordUnits = allUnits.filter(u => u.hasCoord).map(u => ({ ...u, group: u.records }));
  const noCoordUnits = allUnits.filter(u => !u.hasCoord);

  if (!coordUnits.length) return noCoordUnits.flatMap(u => u.records);

  if (coordUnits.length === 1) {
    return [...coordUnits[0].group, ...noCoordUnits.flatMap(u => u.records)];
  }

  // ③ 최근접 이웃 초기 순서 (출발점 지정 시 출발점 기준, 없으면 가장 북쪽)
  const rem = [...coordUnits];
  const startIdx = startPoint
    ? rem.reduce((mi, r, i) => haversine(startPoint.lat, startPoint.lng, r.lat, r.lng) < haversine(startPoint.lat, startPoint.lng, rem[mi].lat, rem[mi].lng) ? i : mi, 0)
    : rem.reduce((mi, r, i) => r.lat > rem[mi].lat ? i : mi, 0);
  const ordered = [rem.splice(startIdx, 1)[0]];
  while (rem.length) {
    const last = ordered[ordered.length - 1];
    let minD = Infinity, minI = 0;
    rem.forEach((r, i) => {
      const d = haversine(last.lat, last.lng, r.lat, r.lng);
      if (d < minD) { minD = d; minI = i; }
    });
    ordered.push(rem.splice(minI, 1)[0]);
  }

  // ④ 2-opt 교차 제거
  twoOptRoads(ordered);

  // ⑤ 진입 방향 최적화
  const result = [];
  let prevLat = ordered[0].lat, prevLng = ordered[0].lng;
  ordered.forEach(road => {
    const fwdD = road.sLat && road.sLng ? haversine(prevLat, prevLng, road.sLat, road.sLng) : Infinity;
    const revD = road.eLat && road.eLng ? haversine(prevLat, prevLng, road.eLat, road.eLng) : Infinity;
    const group = revD < fwdD ? [...road.group].reverse() : road.group;
    result.push(...group);
    const last = group[group.length - 1];
    prevLat = last._lat || road.lat;
    prevLng = last._lng || road.lng;
  });

  // ⑥ 좌표 없는 레코드: 같은 도로/단지 그룹 직후 삽입 (없으면 맨 끝)
  const resultIds = new Set(result.map(r => r.id));
  const insertedIds = new Set();
  noCoordUnits.forEach(noUnit => {
    const key = noUnit.key;
    // coordUnits 중 key의 앞부분이 일치하는 그룹 찾기 (같은 도로/아파트)
    const matchIdx = result.findIndex(r => {
      const rMeta = getSequenceUnitMeta(r);
      return rMeta.key === key || rMeta.key.split(':').slice(0, 3).join(':') === key.split(':').slice(0, 3).join(':');
    });
    noUnit.records.forEach(r => {
      if (insertedIds.has(r.id)) return;
      insertedIds.add(r.id);
      if (matchIdx !== -1) {
        // 해당 그룹의 마지막 레코드 바로 뒤 삽입 위치 계산
        let insertAt = matchIdx + 1;
        while (insertAt < result.length && getSequenceUnitMeta(result[insertAt]).key === getSequenceUnitMeta(result[matchIdx]).key) insertAt++;
        result.splice(insertAt, 0, r);
      } else {
        result.push(r);
      }
    });
  });

  return result;
};

const analyzeSequenceQuality = (records, drivers) => {
  const driverStats = drivers
    .filter(driver => records.some(record => record._driverId === driver.id))
    .map(driver => {
      const ordered = records
        .filter(record => record._driverId === driver.id)
        .sort((a, b) => (parseInt(a.배송순번) || 99999) - (parseInt(b.배송순번) || 99999));
      const noCoord = ordered.filter(record => !record._lat || !record._lng);
      const noRoad = ordered.filter(record => !parseRoadInfo(getSequenceAddress(record)).road && !isApartmentLike(record));
      const jumps = [];
      const walkCandidates = [];
      const revisitRoads = new Set();
      const closedRoads = new Set();
      let lastRoad = '';
      let totalDist = 0;
      let maxDist = 0;

      for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1];
        const cur = ordered[i];
        if (!prev._lat || !prev._lng || !cur._lat || !cur._lng) continue;
        const dist = Math.round(haversine(prev._lat, prev._lng, cur._lat, cur._lng));
        totalDist += dist;
        maxDist = Math.max(maxDist, dist);
        const prevRoad = parseRoadInfo(getSequenceAddress(prev));
        const curRoad = parseRoadInfo(getSequenceAddress(cur));
        const sameApt = Boolean(getAptGroupMeta(prev)?.key && getAptGroupMeta(prev)?.key === getAptGroupMeta(cur)?.key);
        const sameRoad = prevRoad.road && prevRoad.road === curRoad.road && prevRoad.side === curRoad.side;
        if (dist >= 300 && !sameApt && !sameRoad) {
          jumps.push({ fromId: prev.id, toId: cur.id, distance: dist, fromSeq: prev.배송순번, toSeq: cur.배송순번 });
        }
        if (dist <= 120 && (!sameRoad || sameApt)) {
          walkCandidates.push({ fromId: prev.id, toId: cur.id, distance: dist, fromSeq: prev.배송순번, toSeq: cur.배송순번 });
        }
      }

      ordered.forEach(record => {
        const road = parseRoadInfo(getSequenceAddress(record)).road;
        if (!road) return;
        if (lastRoad && road !== lastRoad) closedRoads.add(lastRoad);
        if (road !== lastRoad && closedRoads.has(road)) revisitRoads.add(road);
        lastRoad = road;
      });

      const denominator = Math.max(1, ordered.filter(record => record._lat && record._lng).length - 1);
      const avgDist = Math.round(totalDist / denominator);
      let accuracy = 86;
      accuracy -= Math.min(18, jumps.length * 3);
      accuracy -= Math.min(10, noCoord.length * 2);
      accuracy -= Math.min(8, noRoad.length);
      accuracy -= Math.min(8, revisitRoads.size * 2);
      accuracy += Math.min(6, walkCandidates.length);
      accuracy = Math.max(55, Math.min(96, accuracy));

      return {
        driverId: driver.id,
        driverName: driver.name,
        color: driver.color,
        count: ordered.length,
        avgDist,
        maxDist,
        totalDistKm: Math.round(totalDist / 100) / 10,
        estimatedMinutes: Math.round((totalDist / 1000) / SEQUENCE_ESTIMATED_SPEED_KMH * 60),
        noCoordCount: noCoord.length,
        noRoadCount: noRoad.length,
        jumpCount: jumps.length,
        walkCount: walkCandidates.length,
        revisitRoadCount: revisitRoads.size,
        accuracy,
        jumpIds: jumps.flatMap(item => [item.fromId, item.toId]),
        walkIds: walkCandidates.flatMap(item => [item.fromId, item.toId]),
        noCoordIds: noCoord.map(record => record.id),
        noRoadIds: noRoad.map(record => record.id),
      };
    });

  const issueCount = driverStats.reduce((sum, stat) =>
    sum + stat.jumpCount + stat.noCoordCount + stat.noRoadCount + stat.revisitRoadCount, 0);
  const avgAccuracy = driverStats.length
    ? Math.round(driverStats.reduce((sum, stat) => sum + stat.accuracy, 0) / driverStats.length)
    : 0;
  return {
    driverStats,
    issueCount,
    avgAccuracy,
    hasSequence: records.some(record => record.배송순번),
  };
};

// ── 좌표 기반 그룹 TSP + 2-opt 교차 제거 (도로 정보 없을 때 폴백) ──────────
// nearestNeighborTSP도 buildSequenceUnits 기반으로 아파트/동일좌표를 묶어 처리
const nearestNeighborTSP = (points, startPoint = null) => {
  if (!points.length) return [];

  const allUnits = buildSequenceUnits(points);
  const coordUnits = allUnits.filter(u => u.hasCoord);
  const noCoordUnits = allUnits.filter(u => !u.hasCoord);

  if (!coordUnits.length) return noCoordUnits.flatMap(u => u.records);

  // 출발점 지정 시 가장 가까운 그룹부터, 없으면 가장 북쪽부터
  const rem = [...coordUnits];
  const startIdx = startPoint
    ? rem.reduce((mi, u, i) => haversine(startPoint.lat, startPoint.lng, u.lat, u.lng) < haversine(startPoint.lat, startPoint.lng, rem[mi].lat, rem[mi].lng) ? i : mi, 0)
    : rem.reduce((mi, u, i) => u.lat > rem[mi].lat ? i : mi, 0);
  const ordered = [rem.splice(startIdx, 1)[0]];
  while (rem.length) {
    const last = ordered[ordered.length - 1];
    let minD = Infinity, minI = 0;
    rem.forEach((u, i) => {
      const d = haversine(last.lat, last.lng, u.lat, u.lng);
      if (d < minD) { minD = d; minI = i; }
    });
    ordered.push(rem.splice(minI, 1)[0]);
  }

  // 2-opt 교차 제거 (그룹 단위, 상한 50회)
  twoOptRoads(ordered);

  // 그룹 → 레코드 펼치기 (진입 방향 최적화)
  const result = [];
  let prevLat = ordered[0].lat, prevLng = ordered[0].lng;
  ordered.forEach(unit => {
    const fwdD = unit.sLat && unit.sLng ? haversine(prevLat, prevLng, unit.sLat, unit.sLng) : Infinity;
    const revD = unit.eLat && unit.eLng ? haversine(prevLat, prevLng, unit.eLat, unit.eLng) : Infinity;
    const group = revD < fwdD ? [...unit.records].reverse() : unit.records;
    result.push(...group);
    const last = group[group.length - 1];
    prevLat = last._lat || unit.lat;
    prevLng = last._lng || unit.lng;
  });

  // 좌표 없는 그룹: 같은 키 prefix 그룹 직후 삽입, 없으면 맨 끝
  noCoordUnits.forEach(noUnit => {
    const matchIdx = result.findIndex(r => {
      const rMeta = getSequenceUnitMeta(r);
      return rMeta.key.split(':').slice(0, 3).join(':') === noUnit.key.split(':').slice(0, 3).join(':');
    });
    const records = noUnit.records;
    if (matchIdx !== -1) {
      let insertAt = matchIdx + 1;
      while (insertAt < result.length && getSequenceUnitMeta(result[insertAt]).key === getSequenceUnitMeta(result[matchIdx]).key) insertAt++;
      result.splice(insertAt, 0, ...records);
    } else {
      result.push(...records);
    }
  });

  return result;
};

export default function RouteMapModal({ gridData, fileInfo, onClose, onSave, initialCloudCity = null, initialCloudMonthId = null, orgDongs = null, initialDrivers: initialDriversProp = null, companyDrivers: companyDriversProp = null, setupDongDriverMap: setupDongDriverMapProp = null, selectedDongs: selectedDongsProp = null, baseDailyQty: baseDailyQtyProp = 40 }) {
  const DEFAULT_START_ADDR = '경기도 수원시 장안구 정자천로188번길 39';
  const defaultDrivers = [
    { id: 'd1', name: '기사1', color: DRIVER_COLORS[0], startAddr: DEFAULT_START_ADDR },
    { id: 'd2', name: '기사2', color: DRIVER_COLORS[1], startAddr: DEFAULT_START_ADDR },
  ];
  const startDrivers = initialDriversProp || defaultDrivers;
  const companyDriverPool = companyDriversProp?.length ? companyDriversProp : initialDriversProp;

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
  const [driverCount, setDriverCount] = useState(startDrivers.length);
  const [overlapCount, setOverlapCount] = useState(0);
  const [isMapReady, setIsMapReady] = useState(false);
  // layoutMode: 'split' | 'map' | 'list' | 'mapfull' | 'listfull'
  const [layoutMode, setLayoutMode] = useState('split');
  const [isSplitting, setIsSplitting] = useState(false);
  const [autoSplitStrategy, setAutoSplitStrategy] = useState('dongGroup');
  const [routeAnalysis, setRouteAnalysis] = useState(null);
  const [showMapAnalysis, setShowMapAnalysis] = useState(false);
  const [manualBoundaryAdjustments, setManualBoundaryAdjustments] = useState({});
  const [selectedDriverFilter, setSelectedDriverFilter] = useState('all');
  const [aptListExpanded, setAptListExpanded] = useState(true);
  const [aptMultiModal, setAptMultiModal] = useState(null); // { aptName, dongs: [{dong, records, assignedDriverId}] }

  const [isFetchingCoords, setIsFetchingCoords] = useState(false);
  const [hasRunGeocoding, setHasRunGeocoding] = useState(false);
  const [coordProgress, setCoordProgress] = useState(null);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [selectionPulseId, setSelectionPulseId] = useState(null);
  const selectionPulseTimerRef = useRef(null);
  // 기사 핀 (모든 기사 핀이 있으면 가까운 거점 배정에 사용)
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
  const [orderRequestModal, setOrderRequestModal] = useState(null); // { requests: [...] }
  const [isLoadingOrderRequests, setIsLoadingOrderRequests] = useState(false);
  const [isApplyingOrderRequest, setIsApplyingOrderRequest] = useState(false);

  // ── 기사 배치 잠금 (브러시 보정 후 실수로 초기화 방지)
  const [isAssignmentLocked, setIsAssignmentLocked] = useState(false);

  // ── 같은 좌표 팝업
  const [samePointPopup, setSamePointPopup] = useState(null); // { recs, x, y }

  // ── 좌표 삭제 브러시 모달
  const [showCoordBrush, setShowCoordBrush] = useState(false);

  // ── 소속사 기사 추가 피커
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [pickerSelectedName, setPickerSelectedName] = useState('');
  // 모달이 열릴 때 지도에서 선택된 행정동을 캡처 (selectedDong '전체'면 첫 번째 동으로 대체)
  const [pickerDong, setPickerDong] = useState('');

  // ── 행정동 작업 큐 ─────────────────────────────────────────────────────────
  const [dongQueue, setDongQueue] = useState([]); // 작업 순서 행정동 배열
  const [activeDongIndex, setActiveDongIndex] = useState(0); // 현재 작업 중인 인덱스
  const [completedDongs, setCompletedDongs] = useState(new Set()); // 저장 완료된 동
  const [isDirty, setIsDirty] = useState(false); // 현재 동 미저장 변경 여부
  const [showDongNavConfirm, setShowDongNavConfirm] = useState(null); // { targetIndex }

  const [showDriverSwapModal, setShowDriverSwapModal] = useState(false);
  const [swapFromDriverId, setSwapFromDriverId] = useState('');
  const [swapToDriverId, setSwapToDriverId] = useState('');
  const [swapScope, setSwapScope] = useState('all'); // all | dong

  // ── 클릭 순번 배정 모드 (지도/목록 클릭 순서대로 1→2→3 순번 부여)
  const [isSeqClickMode, setIsSeqClickMode] = useState(false);
  const [seqClickNext, setSeqClickNext] = useState(1);
  const [isSeqDragMode, setIsSeqDragMode] = useState(false);
  const [showSequenceAnalysis, setShowSequenceAnalysis] = useState(false);
  const [sequenceAnalysis, setSequenceAnalysis] = useState(null);
  const [isAdvancedSequencing, setIsAdvancedSequencing] = useState(false);
  const [autoPinConfirmModal, setAutoPinConfirmModal] = useState(null); // { clusterMap, pendingPins, diagnostics, affectedIds }
  const [dragOverId, setDragOverId] = useState(null);
  const dragSrcIdRef = useRef(null);

  // ── 페인트 브러시 모드 (2차 보정)
  const [isPaintMode, setIsPaintMode] = useState(false);
  const [paintDriverId, setPaintDriverId] = useState(null);
  const [paintRadiusPx, setPaintRadiusPx] = useState(50);
  const [paintCursorPx, setPaintCursorPx] = useState(null);
  const isPaintingRef = useRef(false);
  const pendingPaintRef = useRef(new Map()); // id → newDriverId (드래그 중 누적, mouseup 시 commit)
  const recordsRef = useRef([]);             // stale-closure 방지용 최신 records 미러
  const autoSaveDataRef = useRef({ records: [], drivers: [] }); // 자동저장용 최신값 (setInterval deps 제거용)
  const routeWorkerRef = useRef(null);       // 기사 배정 Web Worker
  const sequenceEdgeCacheRef = useRef(new Map()); // 관리자 3차 순번: 후보 구간 차량거리 캐시

  const mapRef = useRef(null);
  const kakaoMapRef = useRef(null);
  const overlaysRef = useRef([]);
  const polylinesRef = useRef([]);
  const boundaryOverlaysRef = useRef([]);
  const listPanelRef = useRef(null);
  const driverPinOverlaysRef = useRef([]);
  const mapClickListenerRef = useRef(null);
  const initialBoundsRef = useRef(null);
  // true 일 때만 setBounds 호출 — 초기 로드/명단 불러오기/세션 로드 후 한 번만 실행
  const shouldFitBoundsRef = useRef(true);
  const isAdminUser = ADMIN_EMAILS.includes(String(auth.currentUser?.email || '').toLowerCase());

  useEffect(() => () => {
    if (selectionPulseTimerRef.current) clearTimeout(selectionPulseTimerRef.current);
  }, []);

  const baseForFilter = isCloudMode ? records : gridData;
  const dongList = [...new Set(baseForFilter.map(r => getRouteDong(r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  // 행정동별 실제 레코드 건수 (select option 라벨에 표시)
  const dongCounts = useMemo(() => {
    const counts = {};
    baseForFilter.forEach(r => {
      const d = getRouteDong(r);
      if (d) counts[d] = (counts[d] || 0) + 1;
    });
    return counts;
  }, [baseForFilter]);
  // 작업 큐 기반 — activeDong이 있으면 해당 동만, 없으면 전체
  const activeDong = dongQueue[activeDongIndex] ?? null;
  const selectedDong = activeDong ?? '전체'; // 기존 코드 호환 alias (setSelectedDong 없음)
  const filteredRecords = activeDong ? records.filter(r => getRouteDong(r) === activeDong) : records;
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
  // 드래그 순번 모드: 배송순번 기준 정렬로 전환
  const listRecords = isSeqDragMode
    ? [...displayRecords].sort((a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999))
    : displayRecords;

  const mapRecords = displayRecords.filter(r => r._lat && r._lng);
  const aptRecords = filteredRecords.filter(r => isApartmentLike(r));
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
      const aptMeta = getAptGroupMeta(r);
      if (!aptMeta) return;
      if (!groups[aptMeta.key]) groups[aptMeta.key] = { ...aptMeta, records: [] };
      groups[aptMeta.key].records.push(r);
    });
    return groups;
  }, [aptRecords]);

  // ── "+추가" 피커: 모달이 열린 행정동 소속 기사 제외
  // 행정동 선택 시: 해당 동 담당 기사와 이미 해당 동 레코드에 배정된 기사 제외 → 다른 동 담당 기사는 표시
  // 행정동 미선택('전체') 또는 배정 0건: 세션에 없는 기사만 표시 (fallback)
  const availableCompanyDrivers = useMemo(() => {
    if (!companyDriverPool?.length) return [];

    const activeDong = pickerDong && pickerDong !== '전체' ? pickerDong : null;
    const validCompanyDrivers = companyDriverPool.filter(d => !d.isExternal && (d.name || '').trim());

    if (activeDong) {
      // 현재 행정동에 소속된 기사 ID와 레코드가 배정된 기사 ID를 함께 제외
      const dongDriverIds = new Set(
        records
          .filter(r => getRouteDong(r) === activeDong && r._driverId)
          .map(r => r._driverId)
      );
      (setupDongDriverMapProp?.[activeDong] || []).forEach(id => dongDriverIds.add(id));
      const dongDriverNames = new Set(
        [...drivers, ...validCompanyDrivers]
          .filter(d => dongDriverIds.has(d.id))
          .map(d => (d.name || '').trim())
          .filter(Boolean)
      );
      return validCompanyDrivers.filter(d =>
        !dongDriverIds.has(d.id) &&
        !dongDriverNames.has((d.name || '').trim())
      );
    }

    // fallback: 배정 없거나 전체 보기 → 세션에 없는 기사
    const activeNames = new Set(drivers.filter(d => !d.isExternal).map(d => (d.name || '').trim()));
    return validCompanyDrivers.filter(d => !activeNames.has((d.name || '').trim()));
  }, [companyDriverPool, drivers, records, pickerDong, setupDongDriverMapProp]);

  // ── 50포↑ 임대 대형 단지 목록 (좌측 패널 패널에 표시)
  const largeAptComplexes = useMemo(() => {
    return Object.values(aptComplexGroups)
      .filter(({ label, road, building, records: recs }) => {
        const qty = recs.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
        const rentalText = [label, road, building, ...recs.map(r => r.주소 || '')].join(' ');
        const rentalDetected = RENTAL_LIKE_RE.test(rentalText) || recs.some(isRentalLike);
        // 50포 이상 아파트는 누락되면 배송 배정 리스크가 크므로 모두 노출하고,
        // 임대 키워드가 없으면 "대형단지"로 표시해 담당자가 직접 판단하게 한다.
        return qty >= 50 && (rentalDetected || recs.some(isApartmentLike));
      })
      .map(({ key, label, road, records: recs }) => ({
        aptKey: key,
        aptName: label,
        road,
        rentalDetected: recs.some(isRentalLike) || RENTAL_LIKE_RE.test([label, road, ...recs.map(r => r.주소 || '')].join(' ')),
        buildingCount: [...new Set(recs.map(r => parseAptDong([r._detailAddress, r.주소].filter(Boolean).join(' ')) ?? 0))].filter(Boolean).length,
        totalQty: recs.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0),
      }))
      .sort((a, b) => b.totalQty - a.totalQty);
  }, [aptComplexGroups]);

  const mapInsights = useMemo(() => buildMapInsights({
    records: filteredRecords,
    drivers,
    largeAptComplexes,
  }), [filteredRecords, drivers, largeAptComplexes]);

  const openAptMultiModal = useCallback((aptKey) => {
    const aptGroup = aptComplexGroups[aptKey];
    const members = aptGroup?.records || [];
    if (!members.length) return;
    const dongMap = {};
    members.forEach(r => {
      const dong = parseAptDong([r._detailAddress, r.detailAddress, r.주소, r.특이사항].filter(Boolean).join(' ')) ?? 0;
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
    const currentDriverIds = [...new Set(members.map(r => r._driverId).filter(Boolean))];
    const firstDriverId = currentDriverIds[0] || drivers[0]?.id || null;
    const secondDriverId = drivers.find(d => d.id !== firstDriverId)?.id || drivers[1]?.id || firstDriverId;
    const suggested = dongsArr.map((d, i) => ({
      ...d,
      assignedDriverId: d.dong === 0
        ? (d.assignedDriverId || firstDriverId)
        : (i < half ? firstDriverId : secondDriverId),
    }));
    setAptMultiModal({ aptName: aptGroup.label, road: aptGroup.road, totalQty, dongs: suggested });
  }, [aptComplexGroups, drivers]);

  const applyAptMultiAssignment = useCallback(async () => {
    if (!aptMultiModal) return;
    const updates = {};
    aptMultiModal.dongs.forEach(d => {
      d.records.forEach(r => { updates[r.id] = d.assignedDriverId; });
    });
    setRecords(prev => prev.map(r => r.id in updates
      ? { ...r, _driverId: updates[r.id], 대형단지분할: Boolean(updates[r.id]), 배송상태: updates[r.id] ? '대형단지분할배정' : r.배송상태 }
      : r
    ));
    if (isCloudMode && cloudCity && cloudMonthId) {
      const cloudItems = aptMultiModal.dongs.flatMap(d =>
        d.records
          .filter(r => r._cloudDocId)
          .map(r => ({ docId: r._cloudDocId, driverId: d.assignedDriverId || '' }))
      );
      for (let i = 0; i < cloudItems.length; i += 499) {
        const batch = writeBatch(db);
        cloudItems.slice(i, i + 499).forEach(item => {
          const driverName = drivers.find(dr => dr.id === item.driverId)?.name || '';
          batch.set(
            doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', item.docId),
            {
              기사: driverName,
              배송순번: '',
              배송상태: driverName ? '대형단지분할배정' : '확인후배정가능',
              대형단지분할: Boolean(driverName),
              대형단지분할일시: serverTimestamp(),
              대형단지분할자: auth.currentUser?.email || '',
            },
            { merge: true }
          );
        });
        await batch.commit();
      }
    }
    setAptMultiModal(null);
    showToast('success', `${aptMultiModal.aptName} — ${aptMultiModal.dongs.length}개 동 배정 완료`);
  }, [aptMultiModal, isCloudMode, cloudCity, cloudMonthId, drivers, showToast]);

  // ── 좌표 삭제 브러시 적용 ─────────────────────────────────────────────
  const handleCoordBrushApply = useCallback(async (deletedIds, keepModalOpen = false) => {
    setRecords(prev => prev.map(r => deletedIds.has(r.id) ? {
      ...r,
      이전좌표: r._lat && r._lng ? { lat: r._lat, lng: r._lng, source: r.좌표출처 || '' } : r.이전좌표,
      _lat: null,
      _lng: null,
      _driverId: null,
      배송순번: '',
      좌표상태: '좌표없음',
      좌표검증상태: '',
      좌표확인지자체: '',
      좌표확인행정동: '',
      좌표오류지정: true,
      배정행정동: '',
      이관필요: false,
      배송상태: '주소확인필요',
    } : r));
    if (!keepModalOpen) setShowCoordBrush(false);
    if (isCloudMode && cloudCity && cloudMonthId && deletedIds.size) {
      const cloudItems = [];
      records.forEach(r => { if (deletedIds.has(r.id) && r._cloudDocId) cloudItems.push(r); });
      for (let i = 0; i < cloudItems.length; i += 499) {
        const batch = writeBatch(db);
        cloudItems.slice(i, i + 499).forEach(r => {
          batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId), {
            lat: null,
            lng: null,
            기사: '',
            배송순번: '',
            좌표상태: '좌표없음',
            좌표검증상태: '',
            좌표확인지자체: '',
            좌표확인행정동: '',
            좌표오류지정: true,
            좌표오류지정일시: serverTimestamp(),
            좌표오류지정자: auth.currentUser?.email || '',
            배정행정동: '',
            이관필요: false,
            배송상태: '주소확인필요',
            좌표수정일시: serverTimestamp(),
            좌표수정자: auth.currentUser?.email || '',
            ...(r._lat && r._lng ? { 이전좌표: { lat: r._lat, lng: r._lng, source: r.좌표출처 || '' } } : {}),
          });
        });
        await batch.commit();
      }
    }
    showToast('success', `좌표 ${deletedIds.size}건 삭제 완료`);
  }, [records, isCloudMode, cloudCity, cloudMonthId, showToast]);

  // ── Route Worker 초기화 / 정리 ──────────────────────────────────────────
  useEffect(() => {
    const worker = new Worker(new URL('../workers/routeWorker.js', import.meta.url), { type: 'module' });
    routeWorkerRef.current = worker;
    return () => { worker.terminate(); routeWorkerRef.current = null; };
  }, []);

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
          // 조직 필터 (접근 권한)
          if (orgDongs) {
            loaded = loaded.filter(r => orgDongs.has(String(r.행정동 || '').trim()));
          }
          // selectedDongsProp은 레코드 로드 필터가 아닌 큐 정의에만 사용
          // → 전체 레코드를 메모리에 올려두고 activeDong으로 뷰 필터
          setRecords(loaded);
          setIsCloudMode(true);
          setCloudCity(initialCloudCity);
          setCloudMonthId(initialCloudMonthId);
          // dongQueue: 설정에서 선택한 동 순서 (없으면 전체 동)
          const allDongs = [...new Set(loaded.map(r => getRouteDong(r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
          const queueDongs = selectedDongsProp
            ? allDongs.filter(d => selectedDongsProp.has(d))
            : allDongs;
          setDongQueue(queueDongs.length ? queueDongs : allDongs);
          setActiveDongIndex(0);
          setCompletedDongs(new Set());
          setIsDirty(false);
        }
      } catch (e) {
        console.error('클라우드 자동 로드 실패:', e);
      } finally {
        setIsLoadingCloud(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [initialCloudCity, initialCloudMonthId]);

  // ── activeDongIndex 변경 시 동별 임시 상태 초기화 ────────────────────────
  useEffect(() => {
    if (!dongQueue.length) return;
    setDriverPins({});
    setSequenceAnalysis(null);
    setHasRunGeocoding(false);
    setSelectedDriverFilter('all');
    setIsDirty(false);
  }, [activeDongIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 행정동 큐 이동 — 미저장 변경 있으면 확인 모달 표시 ──────────────────
  const handleDongNavigate = useCallback((targetIndex) => {
    if (targetIndex < 0 || targetIndex >= dongQueue.length) return;
    if (targetIndex === activeDongIndex) return;
    if (isDirty) {
      setShowDongNavConfirm({ targetIndex });
      return;
    }
    setActiveDongIndex(targetIndex);
  }, [activeDongIndex, dongQueue.length, isDirty]);

  // ── 큐에서 동 제외 ────────────────────────────────────────────────────
  const handleRemoveDongFromQueue = useCallback((dongToRemove) => {
    setDongQueue(prev => {
      const newQueue = prev.filter(d => d !== dongToRemove);
      const removedIdx = prev.indexOf(dongToRemove);
      const newIdx = Math.max(0, Math.min(removedIdx, newQueue.length - 1));
      setActiveDongIndex(newIdx);
      setIsDirty(false);
      return newQueue;
    });
  }, []);

  // ── 큐에 동 추가 ─────────────────────────────────────────────────────
  const handleAddDongToQueue = useCallback((dongToAdd) => {
    setDongQueue(prev => {
      if (prev.includes(dongToAdd)) return prev;
      const newQueue = [...prev, dongToAdd].sort((a, b) => a.localeCompare(b, 'ko'));
      const newIdx = newQueue.indexOf(dongToAdd);
      setActiveDongIndex(newIdx);
      return newQueue;
    });
  }, []);

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
    const t = setTimeout(() => kakaoMapRef.current?.relayout(), 200);
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

  const applyBoundaryGuide = useCallback((guide, adjusted) => {
    if (isAssignmentLocked) {
      showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.');
      return;
    }
    const lineStart = adjusted?.lineStart || guide.lineStart || guide.from;
    const lineEnd = adjusted?.lineEnd || guide.lineEnd || guide.to;
    const fromProbe = getLineSide(lineStart, lineEnd, guide.from);
    if (!fromProbe) return;
    const pair = new Set([guide.fromDriverId, guide.toDriverId]);
    const scopeIds = new Set(filteredRecords.map(r => r.id));
    let changed = 0;
    setRecords(prev => {
      const sourceUnits = buildAssignedRouteUnits(
        prev.filter(r => scopeIds.has(r.id) && pair.has(r._driverId)),
        drivers
      );
      const updates = new Map();
      sourceUnits.forEach(unit => {
        const side = getLineSide(lineStart, lineEnd, { lat: unit.lat, lng: unit.lng });
        if (!side) return;
        const targetDriverId = Math.sign(side) === Math.sign(fromProbe)
          ? guide.fromDriverId
          : guide.toDriverId;
        unit.ids.forEach(id => updates.set(id, targetDriverId));
      });
      if (!updates.size) return prev;
      return prev.map(record => {
        const nextDriverId = updates.get(record.id);
        if (!nextDriverId || record._driverId === nextDriverId) return record;
        changed++;
        return { ...record, _driverId: nextDriverId };
      });
    });
    setTimeout(() => {
      showToast(changed ? 'success' : 'info', changed
        ? `경계 이동 적용 — ${changed.toLocaleString()}건 재배정`
        : '경계 이동 완료 — 변경된 배송지가 없습니다.');
    }, 0);
  }, [drivers, filteredRecords, isAssignmentLocked, showToast]);

  const startBoundaryDrag = useCallback((event, guide) => {
    if (!mapRef.current || !window.kakao?.maps || !guide?.id) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = mapRef.current.getBoundingClientRect();
    const base = manualBoundaryAdjustments[guide.id] || {};
    const startLineStart = base.lineStart || guide.lineStart || guide.from;
    const startLineEnd = base.lineEnd || guide.lineEnd || guide.to;
    const startMid = base.mid || guide.mid;
    const startClient = { x: event.clientX, y: event.clientY };
    let latest = { lineStart: startLineStart, lineEnd: startLineEnd, mid: startMid };

    const pointToLatLng = (clientX, clientY) => {
      const projection = kakaoMapRef.current?.getProjection?.();
      if (projection?.coordsFromContainerPoint) {
        const point = new window.kakao.maps.Point(clientX - rect.left, clientY - rect.top);
        const coord = projection.coordsFromContainerPoint(point);
        return { lat: coord.getLat(), lng: coord.getLng() };
      }
      const bounds = kakaoMapRef.current.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const x = (clientX - rect.left) / Math.max(1, rect.width);
      const y = (clientY - rect.top) / Math.max(1, rect.height);
      return {
        lat: ne.getLat() + y * (sw.getLat() - ne.getLat()),
        lng: sw.getLng() + x * (ne.getLng() - sw.getLng()),
      };
    };

    const onMove = (moveEvent) => {
      const from = pointToLatLng(startClient.x, startClient.y);
      const to = pointToLatLng(moveEvent.clientX, moveEvent.clientY);
      const delta = { lat: to.lat - from.lat, lng: to.lng - from.lng };
      latest = {
        lineStart: { lat: startLineStart.lat + delta.lat, lng: startLineStart.lng + delta.lng },
        lineEnd: { lat: startLineEnd.lat + delta.lat, lng: startLineEnd.lng + delta.lng },
        mid: { lat: startMid.lat + delta.lat, lng: startMid.lng + delta.lng },
      };
      setManualBoundaryAdjustments(prev => ({ ...prev, [guide.id]: latest }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      applyBoundaryGuide(guide, latest);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [applyBoundaryGuide, manualBoundaryAdjustments]);

  const startBoundaryEndpointDrag = useCallback((event, guide, endpoint) => {
    if (!mapRef.current || !window.kakao?.maps || !guide?.id) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = mapRef.current.getBoundingClientRect();
    let latest = manualBoundaryAdjustments[guide.id] || {};

    const pointToLatLng = (clientX, clientY) => {
      const projection = kakaoMapRef.current?.getProjection?.();
      if (projection?.coordsFromContainerPoint) {
        const point = new window.kakao.maps.Point(clientX - rect.left, clientY - rect.top);
        const coord = projection.coordsFromContainerPoint(point);
        return { lat: coord.getLat(), lng: coord.getLng() };
      }
      const bounds = kakaoMapRef.current.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const x = (clientX - rect.left) / Math.max(1, rect.width);
      const y = (clientY - rect.top) / Math.max(1, rect.height);
      return {
        lat: ne.getLat() + y * (sw.getLat() - ne.getLat()),
        lng: sw.getLng() + x * (ne.getLng() - sw.getLng()),
      };
    };

    const onMove = (moveEvent) => {
      const lineStart = latest.lineStart || guide.lineStart || guide.from;
      const lineEnd = latest.lineEnd || guide.lineEnd || guide.to;
      const movedPoint = pointToLatLng(moveEvent.clientX, moveEvent.clientY);
      const next = endpoint === 'start'
        ? { lineStart: movedPoint, lineEnd }
        : { lineStart, lineEnd: movedPoint };
      next.mid = {
        lat: (next.lineStart.lat + next.lineEnd.lat) / 2,
        lng: (next.lineStart.lng + next.lineEnd.lng) / 2,
      };
      latest = next;
      setManualBoundaryAdjustments(prev => ({ ...prev, [guide.id]: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      applyBoundaryGuide(guide, latest);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [applyBoundaryGuide, manualBoundaryAdjustments]);

  // ── 자동배정 경계선 오버레이: 실제 배정이 바뀌는 배송단위 사이를 표시
  useEffect(() => {
    if (!kakaoMapRef.current || !window.kakao?.maps) return;
    boundaryOverlaysRef.current.forEach(o => o.setMap(null));
    boundaryOverlaysRef.current = [];
    const canEditBoundaries = routeAnalysis?.strategy === 'dongGroup' || routeAnalysis?.strategy === 'seedVoronoi';
    const guides = showMapAnalysis && canEditBoundaries ? (routeAnalysis?.boundaryGuides || []) : [];
    if (!guides.length) return;

    guides.forEach((guide, idx) => {
      const fromDriver = drivers.find(d => d.id === guide.fromDriverId);
      const toDriver = drivers.find(d => d.id === guide.toDriverId);
      const fromColor = fromDriver?.color || '#f59e0b';
      const toColor = toDriver?.color || '#38bdf8';
      const adjusted = manualBoundaryAdjustments[guide.id] || {};
      const lineStart = adjusted.lineStart || guide.lineStart || guide.from;
      const lineEnd = adjusted.lineEnd || guide.lineEnd || guide.to;
      const mid = adjusted.mid || guide.mid;
      const path = [
        new window.kakao.maps.LatLng(lineStart.lat, lineStart.lng),
        new window.kakao.maps.LatLng(lineEnd.lat, lineEnd.lng),
      ];
      const line = new window.kakao.maps.Polyline({
        path,
        strokeWeight: 14,
        strokeColor: '#000000',
        strokeOpacity: 0.82,
        strokeStyle: 'solid',
        zIndex: 90,
      });
      line.setMap(kakaoMapRef.current);
      boundaryOverlaysRef.current.push(line);

      const core = new window.kakao.maps.Polyline({
        path,
        strokeWeight: 9,
        strokeColor: '#ffffff',
        strokeOpacity: 1,
        strokeStyle: 'shortdash',
        zIndex: 91,
      });
      core.setMap(kakaoMapRef.current);
      boundaryOverlaysRef.current.push(core);

      const accent = new window.kakao.maps.Polyline({
        path,
        strokeWeight: 4,
        strokeColor: idx % 2 ? toColor : fromColor,
        strokeOpacity: 1,
        strokeStyle: 'solid',
        zIndex: 92,
      });
      accent.setMap(kakaoMapRef.current);
      boundaryOverlaysRef.current.push(accent);

      const label = document.createElement('div');
      label.style.cssText = [
        'background:rgba(0,0,0,0.86)',
        'border:1px solid rgba(255,255,255,0.42)',
        'box-shadow:0 6px 18px rgba(0,0,0,0.45)',
        'border-radius:8px',
        'padding:7px 10px',
        'font-size:12px',
        'font-weight:900',
        'color:white',
        'white-space:nowrap',
        'cursor:grab',
        'user-select:none',
        'pointer-events:auto',
      ].join(';');
      label.title = '드래그해서 경계를 이동합니다. 놓으면 선 양쪽 배송지가 다시 배정됩니다.';
      label.innerHTML = `<span style="color:#facc15">이동 경계</span><span style="color:#94a3b8"> · </span><span style="color:${fromColor}">${escHtml(guide.fromDriverName)}</span><span style="color:#94a3b8"> ↔ </span><span style="color:${toColor}">${escHtml(guide.toDriverName)}</span>`;
      label.addEventListener('mousedown', (event) => startBoundaryDrag(event, guide));
      const labelOverlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(mid.lat, mid.lng),
        content: label,
        yAnchor: 0.5,
        xAnchor: 0.5,
        zIndex: 50,
      });
      labelOverlay.setMap(kakaoMapRef.current);
      boundaryOverlaysRef.current.push(labelOverlay);

      [
        {
          endpoint: 'start',
          point: {
            lat: mid.lat + (lineStart.lat - mid.lat) * 0.38,
            lng: mid.lng + (lineStart.lng - mid.lng) * 0.38,
          },
        },
        {
          endpoint: 'end',
          point: {
            lat: mid.lat + (lineEnd.lat - mid.lat) * 0.38,
            lng: mid.lng + (lineEnd.lng - mid.lng) * 0.38,
          },
        },
      ].forEach(({ endpoint, point }) => {
        const handle = document.createElement('div');
        handle.style.cssText = [
          `width:18px`,
          `height:18px`,
          `border-radius:999px`,
          `background:${endpoint === 'start' ? fromColor : toColor}`,
          `border:3px solid white`,
          `box-shadow:0 0 0 3px rgba(0,0,0,0.8),0 4px 14px rgba(0,0,0,0.55)`,
          `cursor:grab`,
          `pointer-events:auto`,
        ].join(';');
        handle.title = '드래그해서 경계선 기울기를 조정합니다.';
        handle.addEventListener('mousedown', (event) => startBoundaryEndpointDrag(event, guide, endpoint));
        const handleOverlay = new window.kakao.maps.CustomOverlay({
          position: new window.kakao.maps.LatLng(point.lat, point.lng),
          content: handle,
          yAnchor: 0.5,
          xAnchor: 0.5,
          zIndex: 95,
        });
        handleOverlay.setMap(kakaoMapRef.current);
        boundaryOverlaysRef.current.push(handleOverlay);
      });
    });

    return () => {
      boundaryOverlaysRef.current.forEach(o => o.setMap(null));
      boundaryOverlaysRef.current = [];
    };
  }, [showMapAnalysis, routeAnalysis, drivers, manualBoundaryAdjustments, startBoundaryDrag, startBoundaryEndpointDrag]);

  // ── 변경 감지 ─────────────────────────────────────────────────────
  useEffect(() => { setHasUnsaved(true); }, [records, drivers]);
  useEffect(() => { recordsRef.current = records; }, [records]);
  useEffect(() => { setManualBoundaryAdjustments({}); }, [routeAnalysis]);
  useEffect(() => {
    if (!['dongGroup', 'hilbert'].includes(autoSplitStrategy)) setAutoSplitStrategy('dongGroup');
  }, [autoSplitStrategy]);
  useEffect(() => { autoSaveDataRef.current = { records, drivers }; }, [records, drivers]);

  // ── 5분 자동 임시저장 (클라우드 모드만) ──────────────────────────────
  // autoSaveDataRef 로 최신값 참조 → deps에 records/drivers 제거 (타이머가 매 편집마다 리셋되던 버그 수정)
  useEffect(() => {
    if (!isCloudMode || !cloudCity || !cloudMonthId) return;
    if (saveTimerRef.current) clearInterval(saveTimerRef.current);
    saveTimerRef.current = setInterval(async () => {
      const { records: r, drivers: d } = autoSaveDataRef.current;
      try {
        await setDoc(
          doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId),
          {
            city: cloudCity, monthId: cloudMonthId,
            savedAt: serverTimestamp(),
            savedBy: auth.currentUser?.email || '',
            drivers: d.map(dr => ({ id: dr.id, name: dr.name, color: dr.color, capacity: dr.capacity || 100, deliveryDate: dr.deliveryDate || '', startAddr: dr.startAddr || '', startLat: dr.startLat || null, startLng: dr.startLng || null })),
            status: 'draft',
            totalRecords: r.length,
            assignedCount: r.filter(rec => rec._driverId).length,
            selectedDongs: selectedDongsProp ? [...selectedDongsProp] : (orgDongs ? [...orgDongs] : null),
          },
          { merge: true }
        );
        setLastAutoSave(new Date());
        setHasUnsaved(false);
        setSessionStatus('draft');
      } catch {}
    }, 5 * 60 * 1000);
    return () => clearInterval(saveTimerRef.current);
  }, [isCloudMode, cloudCity, cloudMonthId]); // records·drivers는 autoSaveDataRef로 참조

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

    // 같은 좌표 그룹 카운트 (소수점 5자리 ≈ 1m 정밀도)
    const coordCountMap = new Map();
    const coordRecsMap  = new Map();
    mapRecords.forEach(r => {
      if (!r._lat || !r._lng) return;
      const key = `${r._lat.toFixed(5)},${r._lng.toFixed(5)}`;
      coordCountMap.set(key, (coordCountMap.get(key) || 0) + 1);
      if (!coordRecsMap.has(key)) coordRecsMap.set(key, []);
      coordRecsMap.get(key).push(r);
    });

    mapRecords.forEach(r => {
      const driver = drivers.find(d => d.id === r._driverId);
      const color = r._에러 ? '#ef4444' : (driver?.color || '#6b7280');
      const seq = r.배송순번 || '';
      const name = escHtml((r.이름 || '').slice(0, 5));
      const dong = escHtml((r.행정동 || '').replace(/동$/, '').slice(0, 5));
      const qtyNum = parseInt(r.포수 || r['수량(포수)']) || 1;

      const coordKey = `${r._lat.toFixed(5)},${r._lng.toFixed(5)}`;
      const sameCount = coordCountMap.get(coordKey) || 1;
      const samePointBadgeHtml = sameCount > 1
        ? `<div style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f97316;font-size:8px;font-weight:900;padding:1px 5px;border-radius:6px;border:1.5px solid #f97316;line-height:1.5;white-space:nowrap;z-index:2;">×${sameCount}</div>`
        : '';

      // 포수 강조 레벨 (0=1포, 1=2포, 2=3-4포, 3=5-9포, 4=10포+)
      const qtyLv = qtyNum >= 10 ? 4 : qtyNum >= 5 ? 3 : qtyNum >= 3 ? 2 : qtyNum >= 2 ? 1 : 0;
      const pinSize = [32, 34, 36, 39, 44][qtyLv];
      const glowStyle = [
        `0 0 0 2px ${color}55,0 3px 10px rgba(0,0,0,0.7)`,
        `0 0 0 2px ${color}99,0 0 8px 3px ${color}30,0 3px 10px rgba(0,0,0,0.7)`,
        `0 0 0 2px ${color},0 0 0 4px ${color}55,0 0 10px 4px ${color}33,0 3px 10px rgba(0,0,0,0.7)`,
        `0 0 0 3px ${color},0 0 0 6px ${color}66,0 0 14px 6px ${color}44,0 3px 12px rgba(0,0,0,0.8)`,
        `0 0 0 3px ${color},0 0 0 7px ${color}88,0 0 20px 8px ${color}55,0 4px 14px rgba(0,0,0,0.9)`,
      ][qtyLv];
      const qtyBadgeHtml = qtyNum >= 10
        ? `<div style="position:absolute;top:-7px;right:-7px;background:linear-gradient(135deg,#f59e0b,#ef4444);color:white;font-size:9px;font-weight:900;padding:1px 4px;border-radius:8px;border:2px solid #000;line-height:1.4;white-space:nowrap;">${qtyNum}</div>`
        : qtyNum >= 5
          ? `<div style="position:absolute;top:-6px;right:-6px;background:#f97316;color:white;font-size:9px;font-weight:900;padding:1px 4px;border-radius:7px;border:2px solid #000;line-height:1.4;">${qtyNum}</div>`
          : qtyNum >= 3
            ? `<div style="position:absolute;top:-5px;right:-5px;background:#eab308;color:#000;font-size:9px;font-weight:900;padding:1px 3px;border-radius:6px;border:1.5px solid #000;line-height:1.4;">${qtyNum}</div>`
            : qtyNum >= 2
              ? `<div style="position:absolute;top:-5px;right:-5px;background:#facc15;color:#000;font-size:9px;font-weight:900;padding:1px 3px;border-radius:6px;border:1.5px solid #000;line-height:1.4;">2</div>`
              : '';
      const qtyColor = qtyNum >= 10 ? '#fbbf24' : qtyNum >= 5 ? '#fb923c' : qtyNum >= 3 ? '#fde047' : qtyNum >= 2 ? '#facc15' : color;
      const arrowPx = Math.round(pinSize / 5.3);
      const dotPx = Math.round(pinSize * 0.28);

      // 옷핀(thumbtack) DOM 마커 — 포수 강조: 2포↑ 뱃지·링·크기 확대
      const pinEl = document.createElement('div');
      pinEl.setAttribute('data-record-id', r.id);
      pinEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;';
      pinEl.innerHTML = `<div style="width:${pinSize}px;height:${pinSize}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:3px solid rgba(255,255,255,0.9);box-shadow:${glowStyle};flex-shrink:0;position:relative;">${seq ? `<span style="font-size:${pinSize >= 40 ? 9 : 10}px;font-weight:900;color:white;line-height:1;">${seq}</span>` : `<div style="width:${dotPx}px;height:${dotPx}px;border-radius:50%;background:rgba(255,255,255,0.35);"></div>`}${qtyBadgeHtml}${samePointBadgeHtml}</div><div style="width:0;height:0;border-left:${arrowPx}px solid transparent;border-right:${arrowPx}px solid transparent;border-top:${arrowPx * 2}px solid ${color};margin-top:-1px;flex-shrink:0;"></div><div style="background:${qtyNum >= 5 ? 'rgba(20,10,5,0.95)' : 'rgba(8,8,8,0.88)'};color:white;font-size:11px;font-weight:800;padding:2px 6px;border-radius:4px;margin-top:2px;white-space:nowrap;max-width:92px;overflow:hidden;text-overflow:ellipsis;border:1px solid ${color}${qtyNum >= 5 ? '88' : '45'};">${name}·<span style="color:${qtyColor};font-weight:900;">${qtyNum}포</span></div>${dong ? `<div style="background:rgba(0,0,0,0.72);color:#94a3b8;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-top:1px;white-space:nowrap;max-width:80px;overflow:hidden;text-overflow:ellipsis;">${dong}</div>` : ''}`;
      pinEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sameCount > 1) {
          // 같은 좌표 여러 명 → 팝업으로 목록 표시
          const rect = mapRef.current?.getBoundingClientRect();
          const mapCont = mapRef.current?.parentElement?.getBoundingClientRect();
          const ox = rect ? e.clientX - (mapCont?.left || 0) : e.clientX;
          const oy = rect ? e.clientY - (mapCont?.top  || 0) : e.clientY;
          setSamePointPopup({ recs: coordRecsMap.get(coordKey) || [], x: ox, y: oy });
        } else {
          setLayoutMode(prev => (prev === 'map' || prev === 'mapfull') ? 'split' : prev);
          handleSelectRecord(r);
        }
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
        zIndex: r._에러 ? 10 : (sameCount > 1 ? 9 : qtyNum >= 5 ? 8 : qtyNum >= 2 ? 6 : seq ? 5 : 1),
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
    // setBounds는 초기 로드/명단 불러오기/세션 로드 직후 1회만 — 자동순번·브러시 등 업데이트 시 줌 유지
    if (!isPaintingRef.current && shouldFitBoundsRef.current) {
      kakaoMapRef.current.setBounds(bounds, 60, 60, 60, 60);
      initialBoundsRef.current = bounds;
      shouldFitBoundsRef.current = false; // 이후 업데이트에서는 줌 고정
    }

    // 경계에 가까운 정상 인접지는 혼재가 아니다.
    // 같은 아파트/동일주소 단위가 갈라졌거나, 주변이 타 기사 권역으로 압도되는 "섬"만 혼재로 센다.
    const routeUnits = buildAssignedRouteUnits(filteredRecords, drivers);
    const mixedKeys = getMixedRouteUnitKeys(routeUnits);
    const cnt = routeUnits
      .filter(unit => mixedKeys.has(unit.key))
      .reduce((sum, unit) => sum + unit.records.length, 0);
    setOverlapCount(cnt);
  }, [mapPinSignature, drivers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 도로주소 단위 연속 권역 자동 배정 ────────────────────────────────
  const handleAutoSplit = useCallback(() => {
    if (isAssignmentLocked) { showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.'); return; }
    const activeDrivers = drivers.slice(0, Math.min(driverCount, drivers.length)).filter(d => !d.isExternal);
    const target = filteredRecords.filter(r => r._lat && r._lng && isCoordAssignable(r));
    if (!target.length || !activeDrivers.length) return;
    const safeAutoSplitStrategy = ['dongGroup', 'hilbert'].includes(autoSplitStrategy) ? autoSplitStrategy : 'dongGroup';
    const placedPinCount = activeDrivers.filter(d => !!driverPins[d.id]).length;
    const hasPartialPins = placedPinCount > 0 && placedPinCount < activeDrivers.length;
    if (hasPartialPins) {
      showToast('error', `핀 기준 배정은 기사 ${activeDrivers.length}명 전원의 핀이 필요합니다. 현재 ${placedPinCount}개입니다.`, 6000);
      return;
    }
    const effectiveStrategy = safeAutoSplitStrategy === 'dongGroup' && placedPinCount === activeDrivers.length
      ? 'seedVoronoi'
      : safeAutoSplitStrategy;
    setIsSplitting(true);

    const worker = routeWorkerRef.current;
    if (!worker) {
      showToast('error', 'Worker 초기화 실패. 잠시 후 다시 시도하세요.');
      setIsSplitting(false);
      return;
    }

    // 기존 미처리 리스너 제거 (이전 클릭이 완료 전에 다시 클릭한 경우 방지)
    if (worker._pendingAutoSplit) {
      worker.removeEventListener('message', worker._pendingAutoSplit);
      worker._pendingAutoSplit = null;
    }

    const noCoordRecs = filteredRecords.filter(r => !r._lat || !r._lng || !isCoordAssignable(r));
    const onMessage = (e) => {
      if (e.data.type !== 'autoSplitResult' && e.data.type !== 'autoSplitError') return;
      worker.removeEventListener('message', onMessage);
      worker._pendingAutoSplit = null;
      if (e.data.type === 'autoSplitError') {
        console.error('자동 배정 오류:', e.data.message);
        showToast('error', '자동 배정 중 오류가 발생했습니다.');
        setIsSplitting(false);
        return;
      }
      const { clusterMap, diagnostics } = e.data;
      setRouteAnalysis(diagnostics || null);
      setShowMapAnalysis(true);
      // 행정동 필터 밖의 수동 배정은 자동 배정이 덮어쓰지 않는다.
      const affectedIds = new Set(filteredRecords.map(r => r.id));

      // 핀은 사용자가 기사 수만큼 직접 꽂은 경우에만 사용한다.
      // 핀이 없으면 경계/힐베르트 기준으로 바로 배정하고, 자동 핀 생성은 하지 않는다.
      const PIN_FREE_STRATEGIES = new Set(['dongGroup', 'hilbert']);
      const noPinDrivers = activeDrivers.filter(d => !driverPins[d.id]);
      if (noPinDrivers.length > 0 && !PIN_FREE_STRATEGIES.has(effectiveStrategy)) {
        const pendingPins = {};
        noPinDrivers.forEach(d => {
          const assigned = target.filter(r => clusterMap[r.id] === d.id && r._lat && r._lng);
          if (!assigned.length) return;
          const lat = assigned.reduce((s, r) => s + r._lat, 0) / assigned.length;
          const lng = assigned.reduce((s, r) => s + r._lng, 0) / assigned.length;
          pendingPins[d.id] = { lat, lng };
        });
        if (Object.keys(pendingPins).length > 0) {
          setAutoPinConfirmModal({ clusterMap, pendingPins, diagnostics, affectedIds: [...affectedIds] });
          setIsSplitting(false);
          return; // 확인 모달에서 최종 적용
        }
      }

      // 각도 분할 또는 모든 기사에 이미 핀 있음 → 즉시 적용
      setRecords(prev => prev.map(r => affectedIds.has(r.id)
        ? { ...r, _driverId: clusterMap[r.id] || null }
        : r
      ));
      setIsDirty(true);
      setTimeout(() => {
        const balanceMsg = diagnostics?.load?.maxAbsDiffPct !== undefined
          ? `최대 편차 ${diagnostics.load.maxAbsDiffPct}%`
          : '분석 완료';
        const qScore = diagnostics?.qualityScore !== undefined ? ` · 품질 ${diagnostics.qualityScore}점` : '';
        const stratLabel = { hilbert: '힐베르트 곡선', seedVoronoi: '핀 전체 기준', dongGroup: '자동 경계' }[diagnostics?.strategy || 'dongGroup'] || '자동 경계';
        showToast('success', `자동 배정 완료 [${stratLabel}] — ${balanceMsg}${qScore}. 분석 안내를 확인하세요.`, 5000);
      }, 500);
      setIsSplitting(false);
    };
    worker._pendingAutoSplit = onMessage;
    worker.addEventListener('message', onMessage);

    worker.postMessage({
      type: 'autoSplit',
      target,
      noCoordRecs,
      allRecords: filteredRecords,
      activeDrivers,
      driverPins,
      strategy: effectiveStrategy,
    });
  }, [filteredRecords, drivers, driverCount, driverPins, showToast, isAssignmentLocked, autoSplitStrategy]);

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
    // snapshot을 먼저 복사 후 clear — React updater는 비동기 실행되므로
    // pending(원본 Map)을 clear하기 전에 복사하지 않으면 updater 실행 시 빈 Map을 봄
    const snapshot = new Map(pending);
    pending.clear();
    setRecords(prev => prev.map(r => snapshot.has(r.id) ? { ...r, _driverId: snapshot.get(r.id) } : r));
  }, []);

  // ── 명단 ↔ 지도 양방향 선택 ───────────────────────────────────────────
  // 핀/행 선택 → 지도 panTo + 선택 핀 DOM 하이라이트 + 목록 스크롤
  const handleSelectRecord = useCallback((r) => {
    setSelectedRecordId(r.id);
    setSelectionPulseId(r.id);
    if (selectionPulseTimerRef.current) clearTimeout(selectionPulseTimerRef.current);
    selectionPulseTimerRef.current = setTimeout(() => setSelectionPulseId(null), 1800);
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

  const focusAnalysisRecords = useCallback((recordIds, label = '분석 후보') => {
    const ids = new Set(recordIds || []);
    const first = records.find(r => ids.has(r.id));
    if (!first) {
      showToast('info', `${label} 항목이 없습니다.`);
      return;
    }
    setSelectedDriverFilter('all');
    setLayoutMode(prev => (prev === 'map' || prev === 'mapfull') ? 'split' : prev);
    handleSelectRecord(first);
    showToast('info', `${label} ${ids.size.toLocaleString()}건을 목록과 지도에서 확인하세요.`);
  }, [records, handleSelectRecord, showToast]);

  const handleRunSequenceAnalysis = useCallback(() => {
    const analysis = analyzeSequenceQuality(records, drivers);
    setSequenceAnalysis(analysis);
    setShowSequenceAnalysis(true);
    showToast(
      analysis.issueCount > 0 ? 'info' : 'success',
      analysis.hasSequence
        ? `순번 분석 완료 — 예상 정확도 ${analysis.avgAccuracy || 0}% · 확인 ${analysis.issueCount.toLocaleString()}건`
        : '배송순번이 없습니다. 먼저 [순번]을 실행하세요.',
      5000
    );
  }, [records, drivers, showToast]);

  const handleRunMapAnalysis = useCallback(() => {
    setShowMapAnalysis(true);
    const issueCount = mapInsights.mixedCount
      + mapInsights.mixedRoads.length
      + mapInsights.isolatedUnits.length
      + mapInsights.coordIssues.outCity
      + mapInsights.coordIssues.outDong;
    showToast(issueCount > 0 ? 'info' : 'success', issueCount > 0
      ? `지도 분석 완료 — 확인 후보 ${issueCount.toLocaleString()}개가 있습니다.`
      : '지도 분석 완료 — 큰 혼재 신호는 없습니다.');
  }, [mapInsights, showToast]);

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
  const handleResetAssignments = useCallback(async () => {
    if (isAssignmentLocked) { showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.'); return; }
    if (!window.confirm('⚠️ 기사 배치와 배송순번을 전부 초기화합니다.\n\n클라우드 저장본의 기사/순번도 같이 비웁니다.\n정말 계속하시겠습니까?')) return;

    const resetRecords = records.map(r => ({ ...r, _driverId: null, 배송순번: '' }));
    setRecords(resetRecords);
    setRouteAnalysis(null);
    setShowMapAnalysis(false);
    setSequenceAnalysis(null);
    setShowSequenceAnalysis(false);
    setOverlapCount(0);

    if (isCloudMode && cloudCity && cloudMonthId) {
      try {
        const CHUNK = 499;
        for (let i = 0; i < resetRecords.length; i += CHUNK) {
          const batch = writeBatch(db);
          let hasOps = false;
          resetRecords.slice(i, i + CHUNK).forEach(r => {
            if (!r._cloudDocId) return;
            batch.set(
              doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId),
              { 기사: '', 배송순번: '' },
              { merge: true }
            );
            hasOps = true;
          });
          if (hasOps) await batch.commit();
        }
        await setDoc(
          doc(db, 'route_sessions', cloudCity, 'months', cloudMonthId),
          {
            city: cloudCity,
            monthId: cloudMonthId,
            savedAt: serverTimestamp(),
            savedBy: auth.currentUser?.email || '',
            drivers: drivers.map(d => ({ id: d.id, name: d.name, color: d.color, capacity: d.capacity || 100, deliveryDate: d.deliveryDate || '', startAddr: d.startAddr || '' })),
            status: 'draft',
            totalRecords: resetRecords.length,
            assignedCount: 0,
            selectedDongs: selectedDongsProp ? [...selectedDongsProp] : (orgDongs ? [...orgDongs] : null),
          },
          { merge: true }
        );
        setSessionStatus('draft');
        setLastAutoSave(new Date());
        setHasUnsaved(false);
        showToast('success', '배정/순번 초기화 완료 — 클라우드 저장본까지 비웠습니다.');
      } catch (error) {
        showToast('error', `초기화 저장 실패: ${error.message}`);
      }
      return;
    }

    showToast('success', '배정/순번 초기화 완료');
  }, [records, drivers, isCloudMode, cloudCity, cloudMonthId, selectedDongsProp, orgDongs, showToast, isAssignmentLocked]);

  const openDriverSwapModal = useCallback(() => {
    if (isAssignmentLocked) {
      showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.');
      return;
    }
    const defaultScope = selectedDong === '전체' ? 'all' : 'dong';
    const scopeRecords = defaultScope === 'dong'
      ? records.filter(r => getRouteDong(r) === selectedDong)
      : records;
    const assignedDrivers = drivers.filter(d => scopeRecords.some(r => r._driverId === d.id));
    if (assignedDrivers.length < 2) {
      showToast('error', '맞교환하려면 배정된 기사가 2명 이상 필요합니다.');
      return;
    }
    const first = selectedDriverFilter !== 'all' && selectedDriverFilter !== 'none'
      && assignedDrivers.some(d => d.id === selectedDriverFilter)
      ? selectedDriverFilter
      : assignedDrivers[0].id;
    const second = assignedDrivers.find(d => d.id !== first)?.id || assignedDrivers[1]?.id || '';
    setSwapScope(defaultScope);
    setSwapFromDriverId(first);
    setSwapToDriverId(second);
    setShowDriverSwapModal(true);
  }, [drivers, records, selectedDong, selectedDriverFilter, showToast, isAssignmentLocked]);

  const handleSwapDriverAssignments = useCallback(() => {
    if (isAssignmentLocked) {
      showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.');
      return;
    }
    if (!swapFromDriverId || !swapToDriverId || swapFromDriverId === swapToDriverId) {
      showToast('error', '서로 다른 기사 2명을 선택하세요.');
      return;
    }
    const fromDriver = drivers.find(d => d.id === swapFromDriverId);
    const toDriver = drivers.find(d => d.id === swapToDriverId);
    if (!fromDriver || !toDriver) {
      showToast('error', '선택한 기사 정보를 찾을 수 없습니다.');
      return;
    }
    const useDongScope = swapScope === 'dong' && selectedDong !== '전체';
    const isInScope = (record) => !useDongScope || getRouteDong(record) === selectedDong;
    const scopedRecords = records.filter(isInScope);
    const fromCount = scopedRecords.filter(r => r._driverId === swapFromDriverId).length;
    const toCount = scopedRecords.filter(r => r._driverId === swapToDriverId).length;
    if (fromCount + toCount === 0) {
      showToast('error', '선택 범위에 교체할 배정 내역이 없습니다.');
      return;
    }

    const pendingPaint = new Map(pendingPaintRef.current);
    pendingPaintRef.current.clear();
    setRecords(prev => prev.map(record => {
      const paintedDriverId = pendingPaint.has(record.id) ? pendingPaint.get(record.id) : record._driverId;
      const baseRecord = paintedDriverId !== record._driverId ? { ...record, _driverId: paintedDriverId } : record;
      if (!isInScope(baseRecord)) return baseRecord;
      if (baseRecord._driverId === swapFromDriverId) return { ...baseRecord, _driverId: swapToDriverId };
      if (baseRecord._driverId === swapToDriverId) return { ...baseRecord, _driverId: swapFromDriverId };
      return baseRecord;
    }));
    setShowDriverSwapModal(false);
    setSelectedDriverFilter('all');
    const scopeLabel = useDongScope ? selectedDong : '전체';
    showToast('success', `${scopeLabel} 배정 교체 완료 — ${fromDriver.name} ${fromCount}건 ↔ ${toDriver.name} ${toCount}건`);
  }, [drivers, records, selectedDong, swapFromDriverId, swapToDriverId, swapScope, showToast, isAssignmentLocked]);


  // ── 기사 출발지 주소 지오코딩 ────────────────────────────────────────
  const handleGeocodeStartAddr = useCallback(async (driverId, addr) => {
    if (!addr?.trim() || !KAKAO_REST_KEY) return;
    try {
      const res = await fetch(
        `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(addr.trim())}&size=1`,
        { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } }
      );
      if (!res.ok) return;
      const data = await res.json();
      const d = data.documents?.[0];
      if (d?.x && d?.y) {
        setDrivers(prev => prev.map(dr =>
          dr.id === driverId ? { ...dr, startLat: parseFloat(d.y), startLng: parseFloat(d.x) } : dr
        ));
      }
    } catch { /* ignore */ }
  }, []);

  // 마운트 시 startAddr 있으면 자동 지오코딩
  useEffect(() => {
    if (!KAKAO_REST_KEY) return;
    drivers.forEach(d => {
      if (d.startAddr && !d.startLat) handleGeocodeStartAddr(d.id, d.startAddr);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 배송순번 자동 정렬 (도로명 기반 — 도로 그룹 → 건물번호 → 뱀 패턴) ───
  // ── 드래그 순번 재배정 ────────────────────────────────────────────────
  const handleSeqDrop = useCallback((dstId) => {
    const srcId = dragSrcIdRef.current;
    dragSrcIdRef.current = null;
    setDragOverId(null);
    if (!srcId || srcId === dstId) return;
    const srcRec = records.find(r => r.id === srcId);
    const dstRec = records.find(r => r.id === dstId);
    if (!srcRec || !dstRec || srcRec._driverId !== dstRec._driverId) return;
    // 해당 기사의 레코드를 순번순으로 정렬 후 재배치
    const driverRecs = records
      .filter(r => r._driverId === srcRec._driverId)
      .sort((a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999));
    const reordered = driverRecs.filter(r => r.id !== srcId);
    const insertAt = reordered.findIndex(r => r.id === dstId);
    reordered.splice(insertAt, 0, srcRec);
    const newSeqMap = {};
    reordered.forEach((r, i) => { newSeqMap[r.id] = String(i + 1); });
    setRecords(prev => prev.map(r => newSeqMap[r.id] !== undefined ? { ...r, 배송순번: newSeqMap[r.id] } : r));
  }, [records]);

  const handleAutoSequence = useCallback(() => {
    // pendingPaintRef 잔류분을 먼저 반영 (브러시 보정 직후 클릭 시 배치 유실 방지)
    const snapshot = new Map(pendingPaintRef.current);
    pendingPaintRef.current.clear();

    // ① 순수 계산 — updater 밖에서 records 직접 읽어 처리
    const current = snapshot.size > 0
      ? records.map(r => snapshot.has(r.id) ? { ...r, _driverId: snapshot.get(r.id) } : r)
      : records;

    const updated = [...current];
    const strategyUsed = { road: 0, coord: 0 };

    drivers.forEach(driver => {
      const driverRecs = updated.filter(r => r._driverId === driver.id);
      if (!driverRecs.length) return;
      const hasAnyAddr = driverRecs.some(r => parseRoadInfo(getSequenceAddress(r)).road || isApartmentLike(r));
      if (hasAnyAddr) strategyUsed.road++;
      else strategyUsed.coord++;
      const startPoint = (driver.startLat && driver.startLng)
        ? { lat: driver.startLat, lng: driver.startLng }
        : null;
      // nearestNeighborTSP에 전체 레코드를 넘겨야 noCoordUnits 스마트 삽입이 작동한다
      const ordered = hasAnyAddr ? roadAwareTSP(driverRecs, startPoint) : nearestNeighborTSP(driverRecs, startPoint);
      ordered.forEach((r, i) => {
        const idx = updated.findIndex(u => u.id === r.id);
        if (idx !== -1) updated[idx] = { ...updated[idx], 배송순번: String(i + 1) };
      });
    });

    const analysis = analyzeSequenceQuality(updated, drivers);
    analysis.strategyUsed = strategyUsed;

    // ② state 반영 — 모든 side effect를 updater 밖에서 한 번씩만 실행
    setRecords(updated);
    setSequenceAnalysis(analysis);
    setShowSequenceAnalysis(true);
    const stratMsg = strategyUsed.road > 0 && strategyUsed.coord > 0
      ? `도로망 ${strategyUsed.road}명 · 좌표 ${strategyUsed.coord}명`
      : strategyUsed.coord > 0 ? '좌표 fallback' : '도로망 TSP';
    showToast(
      analysis.issueCount > 0 ? 'info' : 'success',
      `순번 완료 [${stratMsg}] — 정확도 ${analysis.avgAccuracy || 0}% · 확인 ${analysis.issueCount.toLocaleString()}건`,
      5000
    );
  }, [records, drivers, showToast]);

  const handleAdvancedAutoSequence = useCallback(async () => {
    if (!isAdminUser) {
      showToast('error', '관리자 전용 기능입니다.');
      return;
    }
    if (isAdvancedSequencing) return;
    const assignedCount = records.filter(r => r._driverId).length;
    if (!assignedCount) {
      showToast('error', '기사 배정 후 AI 순번을 실행하세요.');
      return;
    }
    const hasManualSeq = records.some(r => r.배송순번);
    if (hasManualSeq && !window.confirm('기존 배송순번이 있습니다.\n관리자용 AI 순번으로 다시 계산하면 현재 순번이 덮어쓰기 됩니다.\n계속할까요?')) return;

    setIsAdvancedSequencing(true);
    try {
      const pendingPaint = new Map(pendingPaintRef.current);
      pendingPaintRef.current.clear();
      const base = pendingPaint.size > 0
        ? records.map(r => pendingPaint.has(r.id) ? { ...r, _driverId: pendingPaint.get(r.id) } : r)
        : records;
      const updated = [...base];
      const useApi = Boolean(KAKAO_REST_KEY);

      for (const driver of drivers) {
        const driverRecs = updated.filter(r => r._driverId === driver.id);
        if (!driverRecs.length) continue;
        const ordered = await advancedRoadSequence(driverRecs, {
          useApi,
          edgeCache: sequenceEdgeCacheRef.current,
          candidateLimit: 6,
        });
        ordered.forEach((record, index) => {
          const idx = updated.findIndex(r => r.id === record.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], 배송순번: String(index + 1) };
        });
      }

      const analysis = analyzeSequenceQuality(updated, drivers);
      setRecords(updated);
      setSequenceAnalysis(analysis);
      setShowSequenceAnalysis(true);
      const cachedEdges = [...sequenceEdgeCacheRef.current.values()];
      const kakaoCount = cachedEdges.filter(edge => edge.source === 'kakao').length;
      const localCount = cachedEdges.filter(edge => edge.source === 'local').length;
      showToast(
        analysis.issueCount > 0 ? 'info' : 'success',
        `관리자 AI 순번 완료 — 예상 정확도 ${analysis.avgAccuracy || 0}% · 확인 ${analysis.issueCount.toLocaleString()}건 · 경로 ${kakaoCount}/${kakaoCount + localCount}`,
        6000
      );
    } catch (error) {
      console.error('관리자 AI 순번 실패:', error);
      showToast('error', `AI 순번 실패: ${error.message || error}`);
    } finally {
      setIsAdvancedSequencing(false);
    }
  }, [drivers, records, showToast, isAdminUser, isAdvancedSequencing]);

  // ── 지난달 배정 불러오기 ─────────────────────────────────────────────
  const handleLoadLastMonth = useCallback(() => {
    if (isAssignmentLocked) { showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.'); return; }
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
  }, [drivers, showToast, isAssignmentLocked]);

  // ── 1단계: 세션 수동 저장 (draft / final) ───────────────────────────
  const handleSaveSession = useCallback(async (isFinal = false) => {
    if (!isCloudMode || !cloudCity || !cloudMonthId) {
      if (isFinal) alert('클라우드 명단 로드 후 저장 가능합니다.');
      return;
    }
    const unassignedCount = records.filter(r => !r._driverId).length;
    if (isFinal && unassignedCount > 0) {
      showToast('error', `미배정 ${unassignedCount}건이 남아 최종 저장할 수 없습니다.`);
      return;
    }
    // R-0: 최종 저장 시 기사 구역 혼재 차단
    if (isFinal && overlapCount > 0) {
      showToast('error', `기사 구역 혼재 ${overlapCount}건이 남아 최종 저장할 수 없습니다.`);
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
          selectedDongs: selectedDongsProp ? [...selectedDongsProp] : (orgDongs ? [...orgDongs] : null),
          activeDong: activeDong || null,
          completedDongs: [...completedDongs, ...(activeDong ? [activeDong] : [])],
        },
        { merge: true }
      );
      // cloud_lists 레코드에 기사/순번/좌표 동기화
      const CHUNK = 499;
      for (let i = 0; i < records.length; i += CHUNK) {
        const batch = writeBatch(db);
        let hasOps = false;
        records.slice(i, i + CHUNK).forEach(r => {
          if (!r._cloudDocId) return;
          const driverName = drivers.find(d => d.id === r._driverId)?.name || '';
          const ref = doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId);
          const patch = { 기사: driverName, 배송순번: r.배송순번 ? String(r.배송순번) : '' };
          if (r._lat !== undefined && r._lat !== null) { patch.lat = r._lat; patch.lng = r._lng; }
          if (r._isApt !== undefined) patch.isApt = r._isApt;
          batch.set(ref, patch, { merge: true });
          hasOps = true;
        });
        if (hasOps) await batch.commit();
      }
      // driver_assignments 동기화 — RouteSetupModal에서 다음번 기사구성 자동 로드용
      try {
        const dongDriverMap = {};
        records.forEach(r => {
          const routeDong = getRouteDong(r);
          if (!r._driverId || !routeDong) return;
          if (!dongDriverMap[routeDong]) dongDriverMap[routeDong] = [];
          if (!dongDriverMap[routeDong].includes(r._driverId)) dongDriverMap[routeDong].push(r._driverId);
        });
        await setDoc(
          doc(db, 'driver_assignments', cloudCity, 'orgs', 'all'),
          {
            drivers: drivers.map(d => ({ id: d.id, name: d.name, color: d.color, capacity: d.capacity || 100, startAddr: d.startAddr || '' })),
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
      // 동 작업 완료 처리
      if (activeDong) setCompletedDongs(prev => new Set([...prev, activeDong]));
      setIsDirty(false);
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
            const dongs = [...new Set(driverRecs.map(r => getRouteDong(r)).filter(Boolean))];
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
  }, [isCloudMode, cloudCity, cloudMonthId, drivers, records, showToast, overlapCount, activeDong, completedDongs]);

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
      shouldFitBoundsRef.current = true; // 세션 로드 시 전체 범위로 줌 맞춤
      setRecords(prev => prev.map(r => {
        const found = recSnap.docs.find(d => d.id === r._cloudDocId);
        if (!found) return r;
        const fd = found.data();
        const driver = data.drivers?.find(d => d.name === fd.기사);
        return {
          ...r,
          _driverId: fd.기사 ? (driver?.id || null) : null,
          배송순번: fd.배송순번 || '',
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
      shouldFitBoundsRef.current = true; // 새 명단 로드 시 전체 범위로 줌 맞춤
      setRecords(loaded);
      setIsCloudMode(true);
      setCloudCity(cloudPickerCity.trim());
      setCloudMonthId(cloudPickerMonth.trim());
      setShowCloudPicker(false);
      // dongQueue 초기화
      const pickerLoadedDongs = [...new Set(loaded.map(r => getRouteDong(r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
      setDongQueue(pickerLoadedDongs);
      setActiveDongIndex(0);
      setCompletedDongs(new Set());
      setIsDirty(false);
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

  // ── cloud_lists records 일괄 패치 (공통 유틸) ──────────────────────────
  const patchCloudRecords = async (recs) => {
    const CHUNK = 499;
    let patchCount = 0;
    for (let i = 0; i < recs.length; i += CHUNK) {
      const batch = writeBatch(db);
      let hasOps = false;
      recs.slice(i, i + CHUNK).forEach(r => {
        if (!r._cloudDocId) return;
        const driverName = drivers.find(d => d.id === r._driverId)?.name || '';
        const ref = doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId);
        const patch = { 기사: driverName, 배송순번: r.배송순번 ? String(r.배송순번) : '' };
        if (r._lat !== undefined && r._lat !== null) { patch.lat = r._lat; patch.lng = r._lng; }
        if (r._isApt !== undefined) patch.isApt = r._isApt;
        batch.set(ref, patch, { merge: true });
        hasOps = true;
        patchCount++;
      });
      if (hasOps) await batch.commit();
    }
    return patchCount;
  };

  // ── 클라우드 명단에 기사 배정 저장 + base_lists sync + route_sessions 갱신 ─
  const handleSaveToCloud = async () => {
    if (!isCloudMode) return;
    if (!cloudCity || !cloudMonthId) {
      showToast('error', '클라우드 명단을 먼저 불러오세요.');
      return;
    }
    setIsSavingCloud(true);
    try {
      // 1단계: cloud_lists에 기사/배송순번/좌표 저장
      await patchCloudRecords(records);

      // 2단계: route_sessions도 갱신 — "이어서 작업" 복원이 DB 저장 이후 상태를 반영하도록
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
          selectedDongs: selectedDongsProp ? [...selectedDongsProp] : (orgDongs ? [...orgDongs] : null),
        },
        { merge: true }
      );

      // 3단계: base_lists에 driver/seqNo/좌표 자동 반영
      const synced = await syncToBaseList();

      setLastAutoSave(new Date());
      setHasUnsaved(false);
      setSessionStatus('draft');
      showToast('success', `DB 저장 완료 — ${cloudCity} ${cloudMonthId} · 기본명단 반영: ${synced}건`);
    } catch (e) {
      showToast('error', 'DB 저장 실패: ' + e.message);
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
          id: r.id || '',
          driverId: r._driverId,
          lat: r._lat || null,
          lng: r._lng || null,
          isApt: r._isApt || false,
          배송순번: r.배송순번 ? parseInt(r.배송순번) : null,
          이름: r.이름 || '',
          주소: r.주소 || '',
          행정동: r.행정동 || '',
          포수: parseInt(r.포수 || r['수량(포수)']) || 1,
          특이사항: r.특이사항 || '',
          휴대폰: r.휴대폰 || '',
        }));
      const shareId = `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const expiresAtDate = new Date(Date.now() + SHARE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
      await setDoc(doc(db, 'route_shares', shareId), {
        city: cloudCity || fileInfo?.city || '',
        monthId: cloudMonthId || '',
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAtDate),
        ttlDays: SHARE_LINK_TTL_DAYS,
        createdBy: auth.currentUser?.email || '',
        drivers: assignedDrivers.map(d => ({ id: d.id, name: d.name, color: d.color })),
        records: shareRecords,
      });
      const base = window.location.origin;
      setShareModal({
        shareId,
        expiresAtLabel: expiresAtDate.toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
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

  // ── 기사 순번 반영 요청: 담당자 유선 확인 후 공식 명단에 승인 반영 ─────
  const handleLoadOrderApplyRequests = useCallback(async () => {
    if (!cloudCity || !cloudMonthId) {
      showToast('error', '클라우드 명단을 먼저 불러오세요.');
      return;
    }
    setIsLoadingOrderRequests(true);
    try {
      const snap = await getDocs(query(
        collection(db, 'route_shares'),
        where('city', '==', cloudCity),
        where('monthId', '==', cloudMonthId),
        limit(30)
      ));
      const requests = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        Object.entries(data.orderApplyRequests || {}).forEach(([driverId, req]) => {
          if (req?.status !== 'requested') return;
          const driver = (data.drivers || []).find(d => d.id === driverId);
          const orderIds = Array.isArray(req.orderIds)
            ? req.orderIds
            : (Array.isArray(data.driverOrder?.[driverId]) ? data.driverOrder[driverId] : []);
          requests.push({
            shareId: docSnap.id,
            driverId,
            driverName: driver?.name || driverId,
            driverColor: driver?.color || '#3b82f6',
            orderIds,
            count: req.count || orderIds.length,
            requestedAt: req.requestedAt || '',
            createdAt: data.createdAt,
          });
        });
      });
      requests.sort((a, b) => {
        const at = Date.parse(a.requestedAt || '') || a.createdAt?.toDate?.()?.getTime?.() || 0;
        const bt = Date.parse(b.requestedAt || '') || b.createdAt?.toDate?.()?.getTime?.() || 0;
        return bt - at;
      });
      setOrderRequestModal({ requests });
      showToast(requests.length ? 'info' : 'success', requests.length ? `순번 반영 요청 ${requests.length}건 확인` : '대기 중인 순번 반영 요청이 없습니다.');
    } catch (e) {
      showToast('error', `순번 요청 조회 실패: ${e.message}`);
    } finally {
      setIsLoadingOrderRequests(false);
    }
  }, [cloudCity, cloudMonthId, showToast]);

  const handleApproveOrderRequest = useCallback(async (requestItem) => {
    if (!cloudCity || !cloudMonthId) {
      showToast('error', '클라우드 명단을 먼저 불러오세요.');
      return;
    }
    if (!requestItem?.orderIds?.length) {
      showToast('error', '반영할 순번 데이터가 없습니다.');
      return;
    }
    const ok = window.confirm(
      `${requestItem.driverName} 기사와 유선 확인이 끝났습니까?\n\n확인하면 이 기사에게 배정된 명단의 배송순번을 요청 순서로 공식 반영합니다.`
    );
    if (!ok) return;

    setIsApplyingOrderRequest(true);
    try {
      const driverRecords = records.filter(r => r._driverId === requestItem.driverId);
      const recordLookup = new Map();
      driverRecords.forEach((r, index) => {
        if (r.id) recordLookup.set(String(r.id), r);
        if (r._cloudDocId) recordLookup.set(String(r._cloudDocId), r);
        recordLookup.set(`${r.이름 || ''}_${r.배송순번 || index}`, r);
      });

      const seqByRecord = new Map();
      const usedRecords = new Set();
      requestItem.orderIds.forEach((uid, index) => {
        const target = recordLookup.get(String(uid));
        if (!target || usedRecords.has(target)) return;
        usedRecords.add(target);
        seqByRecord.set(target, String(index + 1));
      });

      if (!seqByRecord.size) {
        showToast('error', '요청 순번과 현재 명단을 매칭하지 못했습니다. 공유 링크를 다시 생성한 뒤 요청을 받아주세요.');
        return;
      }

      const nextRecords = records.map(r => seqByRecord.has(r)
        ? { ...r, 배송순번: seqByRecord.get(r) }
        : r
      );
      setRecords(nextRecords);
      setHasUnsaved(true);

      const changedRecords = nextRecords.filter((r, index) =>
        records[index]?._driverId === requestItem.driverId &&
        records[index]?.배송순번 !== r.배송순번 &&
        r._cloudDocId
      );
      const CHUNK = 499;
      for (let i = 0; i < changedRecords.length; i += CHUNK) {
        const batch = writeBatch(db);
        changedRecords.slice(i, i + CHUNK).forEach(r => {
          batch.set(
            doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId),
            { 배송순번: String(r.배송순번 || '') },
            { merge: true }
          );
        });
        await batch.commit();
      }

      await updateDoc(doc(db, 'route_shares', requestItem.shareId), {
        [`orderApplyRequests.${requestItem.driverId}.status`]: 'applied',
        [`orderApplyRequests.${requestItem.driverId}.appliedAt`]: new Date().toISOString(),
        [`orderApplyRequests.${requestItem.driverId}.appliedBy`]: auth.currentUser?.email || '',
        [`orderApplyRequests.${requestItem.driverId}.matchedCount`]: seqByRecord.size,
      });

      setOrderRequestModal(prev => prev
        ? { requests: prev.requests.filter(r => !(r.shareId === requestItem.shareId && r.driverId === requestItem.driverId)) }
        : prev
      );
      showToast('success', `${requestItem.driverName} 순번 ${seqByRecord.size}건 공식 반영 완료`);
    } catch (e) {
      showToast('error', `순번 승인 반영 실패: ${e.message}`);
    } finally {
      setIsApplyingOrderRequest(false);
    }
  }, [cloudCity, cloudMonthId, records, showToast]);

  // ── 겹침 해소 (아파트/동일주소 단위 보존 — 권역 안의 섬만 보정) ───────
  const handleResolveOverlap = useCallback(() => {
    if (isAssignmentLocked) { showToast('error', '🔒 기사 배치가 잠겨 있습니다. 잠금을 해제하세요.'); return; }
    const MAX_PASS = 8;
    const affectedIds = new Set(filteredRecords.map(r => r.id));

    let current = [...records];
    let totalMoved = 0;

    for (let pass = 0; pass < MAX_PASS; pass++) {
      const currentScope = current.filter(r => affectedIds.has(r.id));
      const units = buildAssignedRouteUnits(currentScope, drivers);
      const mixedIssues = getMixedRouteUnitIssues(units);
      if (!mixedIssues.size) break;

      const updates = {};
      units.filter(unit => mixedIssues.has(unit.key)).forEach(unit => {
        const issue = mixedIssues.get(unit.key);
        const bestDriver = issue?.targetDriverId;
        if (!bestDriver) return;
        unit.records.forEach(record => {
          if (record._driverId !== bestDriver) updates[record.id] = bestDriver;
        });
      });

      const movedThisPass = Object.keys(updates).length;
      if (!movedThisPass) break;

      totalMoved += movedThisPass;
      current = current.map(r => updates[r.id] ? { ...r, _driverId: updates[r.id] } : r);
    }

    if (!totalMoved) {
      setOverlapCount(0);
      showToast('info', '해소할 겹침이 없습니다.');
      return;
    }
    setRecords(current);
    showToast('success', `혼재 보정 완료 — 아파트/동일주소 묶음을 지키며 ${totalMoved}건 재배정`);
  }, [records, filteredRecords, drivers, showToast, isAssignmentLocked]);

  // ── 배송순번 전체 초기화 ──────────────────────────────────────────────
  const handleClearSequence = useCallback(() => {
    if (!window.confirm('전체 배송순번을 초기화합니다. 계속하시겠습니까?')) return;
    // snapshot 먼저 복사 후 clear — updater 실행 전 clear 방지
    const snapshot = new Map(pendingPaintRef.current);
    pendingPaintRef.current.clear();
    setRecords(prev => {
      const withPaint = snapshot.size > 0
        ? prev.map(r => snapshot.has(r.id) ? { ...r, _driverId: snapshot.get(r.id) } : r)
        : prev;
      return withPaint.map(r => ({ ...r, 배송순번: '' }));
    });
    showToast('success', '배송순번 전체 초기화 완료');
  }, [showToast]);

  // ── KML 경로 파일 다운로드 (네이버 지도·Google Maps 가져오기 가능) ────────
  const handleDownloadKML = useCallback(() => {
    const city = cloudCity || fileInfo?.city || '지자체';
    const month = cloudMonthId || fileInfo?.month || '';
    const assignedDrivers = drivers.filter(d => records.some(r => r._driverId === d.id));
    if (!assignedDrivers.length) { showToast('error', '배정된 기사가 없습니다.'); return; }

    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const folders = assignedDrivers.map(driver => {
      const driverRecs = records
        .filter(r => r._driverId === driver.id && r._lat && r._lng)
        .sort((a, b) => (parseInt(a.배송순번) || 999) - (parseInt(b.배송순번) || 999));

      const placemarks = driverRecs.map(r => `    <Placemark>
      <name>${esc(r.배송순번 ? `${r.배송순번}. ` : '')}${esc(r.이름)}</name>
      <description>${esc(r.주소)} / 포수:${r.포수 || 1}${r.특이사항 ? ` / ${r.특이사항}` : ''}</description>
      <Point><coordinates>${r._lng},${r._lat},0</coordinates></Point>
    </Placemark>`).join('\n');

      const lineCoords = driverRecs.map(r => `${r._lng},${r._lat},0`).join(' ');
      const lineTag = driverRecs.length >= 2 ? `    <Placemark>
      <name>${esc(driver.name)} 경로</name>
      <LineString><tessellate>1</tessellate><coordinates>${lineCoords}</coordinates></LineString>
    </Placemark>` : '';

      return `  <Folder>
    <name>${esc(driver.name)} (${driverRecs.length}건)</name>
${placemarks}
${lineTag}
  </Folder>`;
    }).join('\n');

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${esc(city)} ${esc(month)} 배송경로</name>
${folders}
</Document>
</kml>`;

    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${city}-${month}-배송경로.kml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('success', `KML 파일 다운로드 완료 — 네이버 지도 "내 지도 가져오기"에서 열 수 있습니다`);
  }, [records, drivers, fileInfo, cloudCity, cloudMonthId, showToast]);

  // ── 담당자용 기사별 엑셀 내보내기 ──────────────────────────────────────
  const handleExportDriverExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const now = new Date();
    const ts = String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
    const city = cloudCity || fileInfo?.city || '지자체';
    const month = cloudMonthId || fileInfo?.month || '';

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
    const city = cloudCity || fileInfo?.city || '';
    const month = cloudMonthId || fileInfo?.month || '';

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

  // ── 좌표 보완/재매칭 (Kakao 지오코딩 다단계 순환) ─────────────────────
  const handleFetchMissingCoords = async (options = {}) => {
    const {
      recordIds = null,
      force = false,
      skipConfirm = false,
      reason = 'missing',
    } = options;
    const idSet = recordIds ? new Set(recordIds) : null;
    const targets = records.filter(r =>
      (idSet ? idSet.has(r.id) : (!r._lat || !r._lng)) &&
      (r.주소 || r.원본주소 || r.지번주소 || r.jibunAddr || r.확인사유 || r._사유)
    );
    if (!targets.length) { alert('좌표 미수신 데이터가 없습니다.'); return; }
    const confirmText = force
      ? `선택한 ${targets.length}건의 기존 좌표를 버리고 다시 조회합니다.\n도로명·지번·원본주소·행정동 조합으로 재매칭합니다.\n계속하시겠습니까?`
      : `좌표 없는 ${targets.length}건을 카카오 API로 조회합니다.\n도로명·지번·원본주소·행정동 조합으로 조회합니다.\n계속하시겠습니까?`;
    if (!skipConfirm && !window.confirm(confirmText)) return;
    setIsFetchingCoords(true);
    const updates = {};
    const updateMeta = {};
    const areaMeta = {};
    const concurrency = 10;

    const fetchCoord = async (url, source) => {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` }, signal: ctrl.signal });
        clearTimeout(tid);
        if (!res.ok) return null;
        const data = await res.json();
        const d = data.documents?.[0];
        return (d?.x && d?.y) ? { lat: parseFloat(d.y), lng: parseFloat(d.x), source, raw: d } : null;
      } catch { clearTimeout(tid); return null; }
    };

    const getJibunFromReason = (r) => {
      const reasonText = r.확인사유 || r._사유 || '';
      const match = String(reasonText).match(/지번주소만 확인(?:됨)?:\s*(.+)$/);
      return match?.[1]?.trim() || '';
    };

    const uniq = (items) => [...new Set(items.map(v => String(v || '').replace(/\s+/g, ' ').trim()).filter(v => v.length >= 2))];

    // 2단계: 캐시에서 먼저 확인 (API 호출 전)
    const cacheCity = isCloudMode ? cloudCity : (fileInfo?.city || '');
    if (cacheCity && !force) {
      setCoordProgress({ done: 0, total: targets.length, round: 0 });
      let cacheHits = 0;
      for (const r of targets) {
        const road = extractRoadAddress(r.주소);
        const cached = await getCachedCoord(cacheCity, road);
        if (cached) {
          updates[r.id] = cached;
          updateMeta[r.id] = { source: 'cache', query: road };
          areaMeta[r.id] = { status: r.좌표검증상태 || '정상', routeDong: getRouteDong(r), transferNeeded: !!r.이관필요 };
          cacheHits++;
        }
        setCoordProgress(prev => prev ? { ...prev, done: prev.done + 1 } : prev);
      }
      if (cacheHits > 0) console.log(`좌표 캐시 ${cacheHits}건 즉시 적용`);
    }

    const runRound = async (roundTargets, round, label, queryBuilder) => {
      if (!roundTargets.length) return;
      setCoordProgress({ done: 0, total: roundTargets.length, round });
      const executing = new Set();
      for (const r of roundTargets) {
        const p = (async () => {
          const candidate = queryBuilder(r);
          const candidates = Array.isArray(candidate) ? candidate : [candidate];
          let coord = null;
          let used = null;
          for (const c of candidates.filter(Boolean)) {
            coord = await fetchCoord(c.url, c.source || label);
            if (coord) { used = c; break; }
          }
          if (coord) {
            updates[r.id] = coord;
            updateMeta[r.id] = { source: coord.source || label, query: used?.query || '' };
            areaMeta[r.id] = assessKakaoAreaMatch(r, coord.raw, cacheCity);
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

    // 지자체 토큰 추출 (시/군/구 — 다른 지자체 좌표 오매칭 방지)
    const cityTok = cacheCity
      ? (cacheCity.trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '')
      : '';
    const cityFull = cacheCity || '';
    const makeAddressUrl = (query, source) => ({
      source,
      query,
      url: `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=1`,
    });
    const makeKeywordUrl = (query, source) => ({
      source,
      query,
      url: `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=1`,
    });

    try {
      // 1라운드: 지자체+도로명 → address API (가장 정확)
      await runRound(targets.filter(r => !updates[r.id]), 1, 'kakao-road', r => {
        const road = extractRoadAddress(r.주소);
        return uniq([cityFull && road ? `${cityFull} ${road}` : '', cityTok && road ? `${cityTok} ${road}` : road])
          .map(q => makeAddressUrl(q, 'kakao-road'));
      });

      // 2라운드: 지번주소/확인사유 지번 → address API
      const r2 = targets.filter(r => !updates[r.id]);
      await runRound(r2, 2, 'kakao-jibun', r => {
        const jibun = r.지번주소 || r.jibunAddr || getJibunFromReason(r);
        return uniq([cityFull && jibun ? `${cityFull} ${jibun}` : '', cityTok && jibun ? `${cityTok} ${jibun}` : jibun])
          .map(q => makeAddressUrl(q, 'kakao-jibun'));
      });

      // 3라운드: 원본주소/현재주소 → address API
      const r3 = targets.filter(r => !updates[r.id]);
      await runRound(r3, 3, 'kakao-original', r => {
        const original = r.원본주소 || r.originalAddress || r.rawAddress || r.주소 || '';
        return uniq([cityFull && original ? `${cityFull} ${original}` : '', cityTok && original ? `${cityTok} ${original}` : original])
          .map(q => makeAddressUrl(q, 'kakao-original'));
      });

      // 4라운드: 도로명/원본 키워드 검색
      const r4 = targets.filter(r => !updates[r.id]);
      await runRound(r4, 4, 'kakao-keyword', r => {
        const road = extractRoadAddress(r.주소).slice(0, 35);
        const original = String(r.원본주소 || r.originalAddress || r.주소 || '').slice(0, 45);
        return uniq([
          [cityFull || cityTok, getRouteDong(r), road].filter(Boolean).join(' '),
          [cityFull || cityTok, getRouteDong(r), original].filter(Boolean).join(' '),
          [getRouteDong(r), road].filter(Boolean).join(' '),
        ]).map(q => makeKeywordUrl(q, 'kakao-keyword'));
      });

      // 좌표가 수정된 레코드는 기존 배정도 초기화 — 잘못된 좌표 기반 배정 오염 방지
      setRecords(prev => prev.map(r => {
        if (!updates[r.id]) return r;
        const area = areaMeta[r.id] || { status: r.좌표검증상태 || '정상', routeDong: getRouteDong(r), transferNeeded: false };
        const isCityOut = area.status === '지자체벗어남';
        const isDongOut = area.status === '행정동벗어남';
        return {
            ...r,
            _lat: updates[r.id].lat,
            _lng: updates[r.id].lng,
            _driverId: null,
            좌표상태: updateMeta[r.id]?.source === 'kakao-jibun' ? '지번좌표확인' : (force ? '재매칭됨' : '좌표확인'),
            좌표출처: updateMeta[r.id]?.source || (force ? 'rematch' : 'kakao'),
            좌표검증상태: area.status,
            좌표확인지자체: [area.matchedSido, area.matchedSigungu].filter(Boolean).join(' '),
            좌표확인행정동: area.matchedDong || '',
            좌표오류지정: false,
            원행정동: isDongOut && !r.원행정동 ? r.행정동 || '' : r.원행정동,
            배정행정동: isDongOut ? area.routeDong : (r.배정행정동 || ''),
            이관필요: isDongOut,
            확인필요: isCityOut ? true : r.확인필요,
            확인사유: area.reason ? [r.확인사유, area.reason].filter(Boolean).join(' / ') : r.확인사유,
            _에러: isCityOut ? true : r._에러,
            _사유: area.reason ? [r._사유, area.reason].filter(Boolean).join(' / ') : r._사유,
            배송상태: isCityOut ? '타지자체확인필요' : (isDongOut ? '타동이관필요' : (r.확인필요 || r._에러 ? '확인후배정가능' : '배송준비')),
            이전좌표: force && r._lat && r._lng ? { lat: r._lat, lng: r._lng, source: r.좌표출처 || '' } : r.이전좌표,
          };
      }));
      setHasRunGeocoding(true);

      // 클라우드 저장
      if (isCloudMode && cloudCity && cloudMonthId && Object.keys(updates).length) {
        const cloudUpdates = Object.entries(updates).flatMap(([id, coord]) => {
          const rec = records.find(r => r.id === id);
          return rec?._cloudDocId ? [{ docId: rec._cloudDocId, coord, meta: updateMeta[id] || {}, rec }] : [];
        });
        for (let i = 0; i < cloudUpdates.length; i += 499) {
          const batch = writeBatch(db);
          cloudUpdates.slice(i, i + 499).forEach(({ docId, coord, meta, rec }) => {
            const area = areaMeta[rec.id] || { status: rec.좌표검증상태 || '정상', routeDong: getRouteDong(rec), transferNeeded: false };
            const isCityOut = area.status === '지자체벗어남';
            const isDongOut = area.status === '행정동벗어남';
            batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', docId), {
              lat: coord.lat,
              lng: coord.lng,
              좌표상태: meta.source === 'kakao-jibun' ? '지번좌표확인' : (force ? '재매칭됨' : '좌표확인'),
              좌표출처: meta.source || (force ? 'rematch' : 'kakao'),
              좌표검증상태: area.status,
              좌표확인지자체: [area.matchedSido, area.matchedSigungu].filter(Boolean).join(' '),
              좌표확인행정동: area.matchedDong || '',
              좌표오류지정: false,
              원행정동: isDongOut && !rec.원행정동 ? rec.행정동 || '' : rec.원행정동 || '',
              배정행정동: isDongOut ? area.routeDong : (rec.배정행정동 || ''),
              이관필요: isDongOut,
              확인필요: isCityOut ? true : !!rec.확인필요,
              확인사유: area.reason ? [rec.확인사유, area.reason].filter(Boolean).join(' / ') : rec.확인사유 || '',
              _에러: isCityOut ? true : !!rec._에러,
              _사유: area.reason ? [rec._사유, area.reason].filter(Boolean).join(' / ') : rec._사유 || '',
              좌표수정일시: serverTimestamp(),
              좌표수정자: auth.currentUser?.email || '',
              배송상태: isCityOut ? '타지자체확인필요' : (isDongOut ? '타동이관필요' : (rec.확인필요 || rec._에러 ? '확인후배정가능' : '배송준비')),
              ...(force && rec._lat && rec._lng ? { 이전좌표: { lat: rec._lat, lng: rec._lng, source: rec.좌표출처 || '' } } : {}),
            });
          });
          await batch.commit();
        }
      }

      const success = Object.keys(updates).length;
      const remain = targets.length - success;
      const title = force ? '좌표 재매칭 완료' : '좌표 보완 완료';
      alert(`✅ ${title}\n성공: ${success}/${targets.length}건${remain > 0 ? `\n미수신 ${remain}건은 주소 재확인이 필요합니다.` : ' (100% 완료!)'}`);
    } catch (e) {
      alert('좌표 처리 실패: ' + e.message);
    } finally {
      setIsFetchingCoords(false);
      setCoordProgress(null);
    }
  };

  // ── 소속사 기사 추가 (피커에서 선택하거나 직접 입력)
  const addCompanyDriver = useCallback((driverInfo) => {
    if (!driverInfo) return;
    const driverName = (driverInfo.name || '').trim();
    const existing = drivers.find(d => d.id === driverInfo.id || ((d.name || '').trim() && (d.name || '').trim() === driverName));
    if (existing) {
      setSelectedDriverFilter(existing.id);
      setShowCompanyPicker(false);
      return;
    }
    if (drivers.length >= 8) return;
    const idx = drivers.length;
    setDrivers(prev => [...prev, {
      id: driverInfo.id || `d${Date.now()}`,
      name: driverName || `기사${idx + 1}`,
      phone: driverInfo.phone || '',
      color: driverInfo.color || DRIVER_COLORS[idx % DRIVER_COLORS.length],
      capacity: driverInfo.capacity || 100,
    }]);
    setDriverCount(c => c + 1);
    setShowCompanyPicker(false);
  }, [drivers]);

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
          <span className="flex items-center gap-1 text-[10px] text-red-300 font-black">
            <AlertTriangle size={11} className="text-red-400" />
            혼재 {overlapCount.toLocaleString()}건
          </span>
        )}
        {overlapCount === 0 && withCoordCount > 0 && (
          <span className="text-[10px] text-emerald-500/70 font-bold">✓ 구역 정리됨</span>
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

          {/* ── 그룹 2: 좌표 ─────────────────────────────────────────── */}
          <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
            <span className="text-[8px] text-gray-700 font-black tracking-widest mr-1">좌표</span>
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
                : <><MapPin size={10} />매칭{totalNoCoord > 0 ? ` ${totalNoCoord}` : ' ✓'}</>
              }
            </button>
            <button
              onClick={() => setShowCoordBrush(true)}
              title="잘못 찍힌 좌표를 지도나 목록에서 오류로 지정하고, 삭제 또는 삭제 후 즉시 재매칭합니다"
              className="px-2 py-1 bg-[#0d1a1a] border border-cyan-600/40 text-cyan-400 hover:bg-cyan-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <Eraser size={10} /> 오류지정
            </button>
          </div>

          {/* ── 그룹 3: 분석 ─────────────────────────────────────────── */}
          <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
            <span className="text-[8px] text-gray-700 font-black tracking-widest mr-1">분석</span>
            <button
              onClick={handleRunMapAnalysis}
              title="도로 좌우·혼재·외곽지·대형단지를 분석해 작업 후보를 보여줍니다"
              className={`px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 border transition-colors ${
                showMapAnalysis
                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                  : 'bg-[#0d1a14] border-emerald-600/30 text-emerald-400 hover:bg-emerald-900/20'
              }`}
            >
              <Search size={10} /> 지도 분석
            </button>
            {overlapCount > 0 && (
              <button
                onClick={handleResolveOverlap}
                title="아파트/동일주소 묶음을 유지한 채 권역 안에 섞인 배송지만 보정합니다"
                className="px-2 py-1 bg-red-950/70 border border-red-500/50 rounded-lg text-red-300 text-[10px] font-black hover:bg-red-900/60 transition-colors"
              >
                혼재 {overlapCount.toLocaleString()}
              </button>
            )}
          </div>

          {/* ── 그룹 4: 배정·순번 ───────────────────────────────────── */}
          <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl px-2 py-1">
            <span className="text-[8px] text-gray-700 font-black tracking-widest mr-1">배정</span>
            <button
              onClick={() => { setIsAssignmentLocked(v => !v); showToast('info', isAssignmentLocked ? '🔓 기사 배치 잠금 해제' : '🔒 기사 배치 잠금 — 자동배정/이전달 승계 차단'); }}
              title={isAssignmentLocked ? '기사 배치 잠금 해제 — 자동배정·초기화 허용' : '기사 배치 잠금 — 브러시 보정 결과를 보호합니다'}
              className={`px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 border transition-colors ${isAssignmentLocked ? 'bg-amber-900/60 border-amber-500/70 text-amber-300 shadow-[0_0_6px_rgba(245,158,11,0.4)]' : 'bg-[#111] border-[#2a2a2a] text-gray-500 hover:text-amber-400 hover:border-amber-600/40'}`}
            >
              {isAssignmentLocked ? '잠금중' : '잠금'}
            </button>
            <button
              onClick={handleAutoSequence}
              title="표준주소·도로 좌우·아파트 묶음 기준으로 기사별 배송 순번을 자동 부여합니다"
              className="px-2 py-1 bg-[#0d1520] border border-purple-500/30 text-purple-400 hover:bg-purple-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <Navigation2 size={10} /> 순번
            </button>
            {isAdminUser && (
              <button
                onClick={handleAdvancedAutoSequence}
                disabled={isAdvancedSequencing}
                title="관리자 실험 기능: 차량 경로 API 후보 검증 + 도보 후보 + 도로망 점수로 배송순번을 계산합니다"
                className="px-2 py-1 bg-[#1a1024] border border-fuchsia-500/35 text-fuchsia-300 hover:bg-fuchsia-900/25 rounded-lg text-[10px] font-black flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {isAdvancedSequencing ? <RefreshCw size={10} className="animate-spin" /> : <Navigation2 size={10} />}
                AI순번
              </button>
            )}
            <button
              onClick={handleRunSequenceAnalysis}
              title="배송순번의 점프·도보 후보·좌표 없음·도로 재방문을 분석합니다"
              className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-colors ${
                showSequenceAnalysis
                  ? 'bg-violet-500/15 border-violet-400/40 text-violet-300'
                  : 'bg-[#140d20] border-violet-500/25 text-violet-400 hover:bg-violet-900/20'
              }`}
            >
              <Search size={10} /> 분석
            </button>
            <button
              onClick={handleClearSequence}
              title="전체 배송순번을 지워 새로 지정할 수 있게 합니다"
              className="px-2 py-1 bg-[#1a0d0d] border border-red-700/30 text-red-400 hover:bg-red-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <X size={10} /> 초기화
            </button>
          </div>

          {/* ── 그룹 5: 레이아웃 ─────────────────────────────────────── */}
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
            {/* DB 저장 (cloud_lists에 기사/순번 반영) */}
            {isCloudMode && (
              <button
                onClick={handleSaveToCloud}
                disabled={isSavingCloud}
                title="기사 배정과 배송 순번을 클라우드 월별 명단(cloud_lists)에 저장합니다"
                className="px-2 py-1 bg-[#0a1520] border border-cyan-600/40 text-cyan-400 hover:bg-cyan-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {isSavingCloud ? <RefreshCw size={10} className="animate-spin" /> : <HardDrive size={10} />}
                {isSavingCloud ? '저장중...' : 'DB 저장'}
              </button>
            )}
            {/* KML 다운로드 — 네이버 지도·카카오맵·구글 지도 임포트용 */}
            <button
              onClick={handleDownloadKML}
              title="배송 경로를 KML 파일로 다운로드합니다 (네이버 지도·Google Maps 가져오기 가능)"
              className="px-2 py-1 bg-[#0d1a0d] border border-emerald-600/40 text-emerald-400 hover:bg-emerald-900/20 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
            >
              <Download size={10} /> KML 경로
            </button>
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
            {isCloudMode && (
              <button
                onClick={handleLoadOrderApplyRequests}
                disabled={isLoadingOrderRequests}
                title="기사가 요청한 순번을 조회하고, 유선 확인 후 공식 명단에 반영합니다"
                className="px-2 py-1 bg-amber-950/35 border border-amber-600/45 text-amber-300 hover:bg-amber-900/35 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {isLoadingOrderRequests ? <RefreshCw size={10} className="animate-spin" /> : <Clock size={10} />}
                순번요청
              </button>
            )}
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
        <div className={`w-56 shrink-0 bg-[#070707] border-r border-[#1a1a1a] flex flex-col overflow-hidden ${layoutMode === 'mapfull' || layoutMode === 'listfull' ? 'hidden' : ''}`}>

          {/* 행정동 큐 네비게이터 */}
          <div className="p-2 border-b border-[#1a1a1a]">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[8px] text-gray-600 font-black tracking-widest uppercase">행정동 작업 큐</div>
              <div className="text-[8px] text-gray-700">
                <span className="text-emerald-400 font-black">{filteredQty}포</span> · 미배정 <span className={unassigned > 0 ? 'text-amber-500' : 'text-emerald-400'}>{unassigned}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 mb-1">
              <button
                onClick={() => handleDongNavigate(activeDongIndex - 1)}
                disabled={activeDongIndex === 0}
                className="w-6 h-6 flex items-center justify-center bg-[#111] border border-[#2a2a2a] rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xs"
              >‹</button>
              <div className="flex-1 text-center px-1">
                <div className="text-white text-[11px] font-black leading-tight truncate">
                  {activeDong || (dongQueue.length ? dongQueue[0] : '—')}
                  {isDirty && <span className="ml-1 text-amber-400 text-[8px]">●</span>}
                </div>
                <div className="text-[8px] text-gray-600">
                  {dongQueue.length ? `${activeDongIndex + 1} / ${dongQueue.length} 동` : '로드 전'}
                  {completedDongs.size > 0 && <span className="ml-1 text-emerald-500">{completedDongs.size}완료</span>}
                </div>
              </div>
              <button
                onClick={() => handleDongNavigate(activeDongIndex + 1)}
                disabled={!dongQueue.length || activeDongIndex >= dongQueue.length - 1}
                className="w-6 h-6 flex items-center justify-center bg-[#111] border border-[#2a2a2a] rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xs"
              >›</button>
              {/* 현재 동 큐에서 제외 */}
              {activeDong && dongQueue.length > 1 && (
                <button
                  onClick={() => handleRemoveDongFromQueue(activeDong)}
                  title={`${activeDong} 큐에서 제외`}
                  className="w-6 h-6 flex items-center justify-center bg-[#111] border border-[#2a2a2a] rounded text-gray-600 hover:text-red-400 hover:border-red-800/50 disabled:opacity-30 text-xs transition-colors"
                >✕</button>
              )}
            </div>
            {/* 동 목록 드롭다운 — 직접 이동 */}
            {dongQueue.length > 0 && (
              <select
                value={activeDong || ''}
                onChange={e => {
                  const idx = dongQueue.indexOf(e.target.value);
                  if (idx >= 0) handleDongNavigate(idx);
                }}
                className="w-full bg-[#111] text-white text-[10px] border border-[#2a2a2a] rounded px-2 py-1 focus:outline-none focus:border-emerald-500/40 mb-1"
              >
                {dongQueue.map((d, i) => (
                  <option key={d} value={d}>
                    {completedDongs.has(d) ? '✓ ' : ''}{d} ({dongCounts[d] || 0}건){i === activeDongIndex ? ' ◀' : ''}
                  </option>
                ))}
              </select>
            )}
            {/* 제외된 동 다시 추가 */}
            {(() => {
              const allDongs = [...new Set(records.map(r => getRouteDong(r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
              const excluded = allDongs.filter(d => !dongQueue.includes(d));
              if (!excluded.length) return null;
              return (
                <select
                  value=""
                  onChange={e => { if (e.target.value) handleAddDongToQueue(e.target.value); }}
                  className="w-full bg-[#0a1a0a] text-emerald-400 text-[10px] border border-emerald-900/40 rounded px-2 py-1 focus:outline-none focus:border-emerald-500/40 mb-1"
                >
                  <option value="">+ 제외된 동 추가…</option>
                  {excluded.map(d => (
                    <option key={d} value={d}>{d} ({dongCounts[d] || 0}건)</option>
                  ))}
                </select>
              );
            })()}
            <div className="mt-0.5 text-[8px] text-gray-700">{filteredRecords.length}건 · 좌표 {mapRecords.length}건</div>
          </div>

          {/* 자동 배정 */}
          <div className="p-2 border-b border-[#1a1a1a]">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[8px] text-gray-600 font-black tracking-widest uppercase">자동 배정</div>
              <span className="text-[8px] text-gray-700">임대·계단 반영</span>
            </div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <button onClick={() => setDriverCount(c => Math.max(1, c - 1))}
                className="w-7 h-7 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-gray-400 hover:text-white flex items-center justify-center shrink-0">
                <Minus size={11} />
              </button>
              <span className="w-10 text-center text-white font-black text-sm shrink-0">{driverCount}명</span>
              <button onClick={() => setDriverCount(c => Math.min(8, c + 1))}
                className="w-7 h-7 bg-[#1a1a1a] border border-[#2a2a2a] rounded text-gray-400 hover:text-white flex items-center justify-center shrink-0">
                <Plus size={11} />
              </button>
              <button
                onClick={handleAutoSplit}
                disabled={isSplitting || totalWithCoord === 0 || (totalNoCoord > 0 && !hasRunGeocoding)}
                title={totalNoCoord > 0 && !hasRunGeocoding ? `좌표 없는 ${totalNoCoord}건 있음 — 먼저 [좌표 매칭]을 실행하세요 (R-B)` : ''}
                className="flex-1 h-7 bg-[#3b82f6]/15 border border-[#3b82f6]/25 text-[#3b82f6] rounded text-[10px] font-bold hover:bg-[#3b82f6]/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1 transition-colors">
                {isSplitting ? <><RefreshCw size={10} className="animate-spin" /> 배정</>
                  : totalNoCoord > 0 && !hasRunGeocoding ? <><AlertCircle size={10} className="text-amber-400" /> 좌표</>
                  : <><Navigation2 size={10} /> 자동</>}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button onClick={handleResetAssignments}
                className="py-1 bg-[#111] border border-[#333] text-gray-600 rounded text-[9px] font-bold hover:text-red-400 hover:border-red-800/50 flex items-center justify-center gap-1 transition-colors">
                <X size={9} /> 초기화
              </button>
              <button onClick={handleLoadLastMonth}
                className="py-1 bg-[#111] border border-[#2a2a2a] text-gray-500 rounded text-[9px] font-bold hover:text-gray-300 hover:border-[#3a3a3a] flex items-center justify-center gap-1 transition-colors">
                <Clock size={9} /> 지난달
              </button>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[8px] text-gray-600 shrink-0">배분 전략</span>
              <select
                value={['dongGroup', 'hilbert'].includes(autoSplitStrategy) ? autoSplitStrategy : 'dongGroup'}
                onChange={e => setAutoSplitStrategy(e.target.value)}
                className="flex-1 h-5 bg-[#111] border border-[#2a2a2a] text-gray-400 rounded text-[8px] px-1 cursor-pointer"
              >
                <option value="dongGroup">자동 (핀 전체 / 없으면 경계)</option>
                <option value="hilbert">힐베르트 곡선</option>
              </select>
            </div>
          </div>

          {/* ── 지도/배정 분석 안내 ─────────────────────────────────── */}
          <div className="p-2 border-b border-[#1a1a1a] bg-[#07110f]">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[8px] text-emerald-400 font-black tracking-widest uppercase">지도 분석</div>
              <button
                onClick={handleRunMapAnalysis}
                className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[8px] font-black hover:bg-emerald-500/25 transition-colors"
              >
                분석 실행
              </button>
            </div>

            <div className="grid grid-cols-4 gap-1 mb-1.5">
              <button
                onClick={() => focusAnalysisRecords(mapInsights.mixedRecords.map(r => r.id), '혼재 의심')}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${mapInsights.mixedCount ? 'bg-red-950/35 border-red-500/35 text-red-300 hover:bg-red-900/35' : 'bg-black/30 border-emerald-900/30 text-emerald-500'}`}
              >
                <div className="text-[10px] font-black tabular-nums">{mapInsights.mixedCount}</div>
                <div className="text-[8px] font-bold">혼재</div>
              </button>
              <button
                onClick={() => focusAnalysisRecords(mapInsights.mixedRoads[0]?.recordIds || [], '도로 분산')}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${mapInsights.mixedRoads.length ? 'bg-amber-950/35 border-amber-500/35 text-amber-300 hover:bg-amber-900/35' : 'bg-black/30 border-emerald-900/30 text-emerald-500'}`}
              >
                <div className="text-[10px] font-black tabular-nums">{mapInsights.mixedRoads.length}</div>
                <div className="text-[8px] font-bold">도로</div>
              </button>
              <button
                onClick={() => focusAnalysisRecords(mapInsights.isolatedUnits.flatMap(unit => unit.ids), '외곽 고립')}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${mapInsights.isolatedUnits.length ? 'bg-blue-950/35 border-blue-500/35 text-blue-300 hover:bg-blue-900/35' : 'bg-black/30 border-emerald-900/30 text-emerald-500'}`}
              >
                <div className="text-[10px] font-black tabular-nums">{mapInsights.isolatedUnits.length}</div>
                <div className="text-[8px] font-bold">외곽</div>
              </button>
              <button
                onClick={() => largeAptComplexes[0] ? openAptMultiModal(largeAptComplexes[0].aptKey) : showToast('info', '대형단지 후보가 없습니다.')}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${largeAptComplexes.length ? 'bg-orange-950/35 border-orange-500/35 text-orange-300 hover:bg-orange-900/35' : 'bg-black/30 border-emerald-900/30 text-emerald-500'}`}
              >
                <div className="text-[10px] font-black tabular-nums">{largeAptComplexes.length}</div>
                <div className="text-[8px] font-bold">단지</div>
              </button>
            </div>

            {showMapAnalysis && (
              <div className="max-h-20 overflow-y-auto pr-1 space-y-1 scrollbar-thin">
                <div className="space-y-1">
                  {mapInsights.actions.slice(0, 2).map((msg, idx) => (
                    <div key={idx} className="text-[8px] text-gray-500 leading-relaxed">• {msg}</div>
                  ))}
                </div>

                {mapInsights.mixedRoads.length > 0 && (
                  <div className="space-y-1">
                    {mapInsights.mixedRoads.slice(0, 2).map(road => (
                      <button
                        key={road.key}
                        onClick={() => focusAnalysisRecords(road.recordIds, road.label)}
                        className="w-full flex items-center justify-between gap-2 text-[8px] bg-black/30 hover:bg-amber-950/25 border border-amber-900/20 rounded px-2 py-1 transition-colors"
                      >
                        <span className="text-gray-300 truncate">{road.label}</span>
                        <span className="text-amber-400 font-black shrink-0">{road.qty}포 · {road.driverCount}기사</span>
                      </button>
                    ))}
                  </div>
                )}

                {routeAnalysis?.qualityScore !== undefined && (
                  <div className="mb-1.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[8px] text-gray-600 font-black tracking-widest">배정 품질</div>
                      <span className="text-[8px] text-gray-500">
                        {{ hilbert: '힐베르트 곡선', seedVoronoi: '핀 전체 기준', dongGroup: '자동 경계' }[routeAnalysis?.strategy] || '자동 경계'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`text-[22px] font-black tabular-nums leading-none ${routeAnalysis.qualityScore >= 80 ? 'text-emerald-400' : routeAnalysis.qualityScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                        {routeAnalysis.qualityScore}
                      </div>
                      <div className="flex-1">
                        <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${routeAnalysis.qualityScore >= 80 ? 'bg-emerald-500' : routeAnalysis.qualityScore >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${routeAnalysis.qualityScore}%` }}
                          />
                        </div>
                        <div className="text-[7px] text-gray-600 mt-0.5">점 / 100점</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <div className="rounded bg-black/30 border border-gray-800/50 px-1 py-0.5 text-center">
                        <div className={`text-[9px] font-black tabular-nums ${(routeAnalysis.splitUnitCount || 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{routeAnalysis.splitUnitCount ?? 0}</div>
                        <div className="text-[7px] text-gray-600">분리단지</div>
                      </div>
                      <div className="rounded bg-black/30 border border-gray-800/50 px-1 py-0.5 text-center">
                        <div className={`text-[9px] font-black tabular-nums ${(routeAnalysis.islandCount || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{routeAnalysis.islandCount ?? 0}</div>
                        <div className="text-[7px] text-gray-600">고립구역</div>
                      </div>
                      <div className="rounded bg-black/30 border border-gray-800/50 px-1 py-0.5 text-center">
                        <div className={`text-[9px] font-black tabular-nums ${(routeAnalysis.mixedUnitCount || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{routeAnalysis.mixedUnitCount ?? 0}</div>
                        <div className="text-[7px] text-gray-600">혼재유닛</div>
                      </div>
                    </div>
                  </div>
                )}

                {routeAnalysis && routeAnalysis.load?.stats?.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[8px] text-gray-600 font-black tracking-widest">기사별 부담</div>
                      <span className={`text-[8px] font-black ${routeAnalysis.load?.maxAbsDiffPct > 25 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        최대 편차 {routeAnalysis.load?.maxAbsDiffPct ?? 0}%
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {(routeAnalysis.load?.stats || []).slice(0, 2).map(stat => (
                        <div key={stat.driverId} className="rounded-md bg-black/35 border border-emerald-900/30 px-1.5 py-1">
                          <div className="text-[9px] text-white font-bold truncate">{stat.driverName}</div>
                          <div className="text-[8px] text-gray-500 tabular-nums">
                            {stat.qty}포 · 부담 {stat.load}/{stat.targetLoad}
                          </div>
                          <div className={`text-[8px] font-black ${Math.abs(stat.diffPct) > 25 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {stat.diffPct > 0 ? '+' : ''}{stat.diffPct}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 배송순번 분석 ─────────────────────────────────────── */}
          <div className="p-2 border-b border-[#1a1a1a] bg-[#0d0a16]">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[8px] text-violet-400 font-black tracking-widest uppercase">순번 분석</div>
              <button
                onClick={handleRunSequenceAnalysis}
                className="px-2 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[8px] font-black hover:bg-violet-500/25 transition-colors"
              >
                분석 실행
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1 mb-1.5">
              <button
                onClick={() => {
                  const ids = (sequenceAnalysis?.driverStats || []).flatMap(stat => stat.jumpIds || []);
                  focusAnalysisRecords(ids, '순번 점프');
                }}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${
                  (sequenceAnalysis?.driverStats || []).some(stat => stat.jumpCount > 0)
                    ? 'bg-red-950/35 border-red-500/35 text-red-300 hover:bg-red-900/35'
                    : 'bg-black/30 border-violet-900/30 text-violet-400'
                }`}
              >
                <div className="text-[10px] font-black tabular-nums">{(sequenceAnalysis?.driverStats || []).reduce((s, stat) => s + stat.jumpCount, 0)}</div>
                <div className="text-[8px] font-bold">점프</div>
              </button>
              <button
                onClick={() => {
                  const ids = (sequenceAnalysis?.driverStats || []).flatMap(stat => stat.walkIds || []);
                  focusAnalysisRecords(ids, '도보 후보');
                }}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${
                  (sequenceAnalysis?.driverStats || []).some(stat => stat.walkCount > 0)
                    ? 'bg-cyan-950/35 border-cyan-500/35 text-cyan-300 hover:bg-cyan-900/35'
                    : 'bg-black/30 border-violet-900/30 text-violet-400'
                }`}
              >
                <div className="text-[10px] font-black tabular-nums">{(sequenceAnalysis?.driverStats || []).reduce((s, stat) => s + stat.walkCount, 0)}</div>
                <div className="text-[8px] font-bold">도보</div>
              </button>
              <button
                onClick={() => {
                  const ids = (sequenceAnalysis?.driverStats || []).flatMap(stat => stat.noCoordIds || []);
                  focusAnalysisRecords(ids, '좌표 없는 순번');
                }}
                className={`rounded-md border px-1 py-1 text-center transition-colors ${
                  (sequenceAnalysis?.driverStats || []).some(stat => stat.noCoordCount > 0)
                    ? 'bg-amber-950/35 border-amber-500/35 text-amber-300 hover:bg-amber-900/35'
                    : 'bg-black/30 border-violet-900/30 text-violet-400'
                }`}
              >
                <div className="text-[10px] font-black tabular-nums">{(sequenceAnalysis?.driverStats || []).reduce((s, stat) => s + stat.noCoordCount, 0)}</div>
                <div className="text-[8px] font-bold">좌표</div>
              </button>
              <div className={`rounded-md border px-1 py-1 text-center ${
                sequenceAnalysis?.avgAccuracy >= 90
                  ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                  : sequenceAnalysis?.avgAccuracy
                  ? 'bg-orange-950/30 border-orange-500/30 text-orange-300'
                  : 'bg-black/30 border-violet-900/30 text-violet-400'
              }`}>
                <div className="text-[10px] font-black tabular-nums">{sequenceAnalysis?.avgAccuracy || 0}%</div>
                <div className="text-[8px] font-bold">정확도</div>
              </div>
            </div>
            {showSequenceAnalysis && (
              <div className="max-h-32 overflow-y-auto pr-1 space-y-1">
                {sequenceAnalysis?.strategyUsed && (
                  <div className="text-[7px] text-gray-600 pb-0.5">
                    {sequenceAnalysis.strategyUsed.road > 0 && <span className="text-violet-400">도로망 {sequenceAnalysis.strategyUsed.road}명</span>}
                    {sequenceAnalysis.strategyUsed.road > 0 && sequenceAnalysis.strategyUsed.coord > 0 && <span className="mx-1">·</span>}
                    {sequenceAnalysis.strategyUsed.coord > 0 && <span className="text-amber-400">좌표 fallback {sequenceAnalysis.strategyUsed.coord}명</span>}
                  </div>
                )}
                {(sequenceAnalysis?.driverStats || []).map(stat => (
                  <button
                    key={stat.driverId}
                    onClick={() => {
                      const ids = [...(stat.jumpIds || []), ...(stat.noCoordIds || []), ...(stat.noRoadIds || [])];
                      focusAnalysisRecords(ids, `${stat.driverName} 순번 확인`);
                    }}
                    className="w-full rounded-md bg-black/35 border border-violet-900/25 px-2 py-1 text-left hover:bg-violet-950/25 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stat.color }} />
                      <span className="text-[9px] text-white font-bold truncate flex-1">{stat.driverName}</span>
                      <span className={`text-[8px] font-black tabular-nums ${
                        stat.avgDist < 200 ? 'text-emerald-400' : stat.avgDist < 400 ? 'text-amber-400' : 'text-red-400'
                      }`}>{stat.avgDist}m</span>
                      <span className={`text-[8px] font-black tabular-nums ${stat.accuracy >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>{stat.accuracy}%</span>
                    </div>
                    <div className="mt-0.5 text-[8px] text-gray-600 flex items-center justify-between">
                      <span>총 {stat.totalDistKm}km · 약 {stat.estimatedMinutes}분 · {stat.count}건</span>
                      {(stat.jumpCount > 0 || stat.noCoordCount > 0) && (
                        <span className="text-amber-500">점프 {stat.jumpCount}{stat.noCoordCount > 0 ? ` · 좌표없음 ${stat.noCoordCount}` : ''}</span>
                      )}
                    </div>
                  </button>
                ))}
                {!(sequenceAnalysis?.driverStats || []).length && (
                  <div className="text-[8px] text-gray-600 leading-relaxed">순번 실행 후 분석하면 기사별 이동거리·정확도가 표시됩니다.</div>
                )}
              </div>
            )}
          </div>

          {/* ── 2차 보정: 페인트 브러시 ─────────────────────────────── */}
          <div className="order-5 px-2 py-2 border-t border-[#1a1a1a]">
            <button
              onClick={() => {
                const next = !isPaintMode;
                setIsPaintMode(next);
                setPaintCursorPx(null);
                isPaintingRef.current = false;
                // 브러시 ON → 지도 드래그 잠금, OFF → 복원
                if (kakaoMapRef.current) kakaoMapRef.current.setDraggable(!next);
              }}
              className={`w-full py-1 rounded text-[9px] font-black flex items-center justify-center gap-1 transition-all border ${
                isPaintMode
                  ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.25)]'
                  : 'bg-[#111] border-[#2a2a2a] text-gray-500 hover:text-amber-400 hover:border-amber-700/40'
              }`}>
              {isPaintMode ? '브러시 ON (Esc)' : '브러시 보정'}
            </button>
            {isPaintMode && (
              <div className="mt-1.5 space-y-1.5 max-h-28 overflow-y-auto pr-1">
                {/* 기사 색상 선택 */}
                <div className="flex flex-wrap gap-1">
                  {drivers.map(d => (
                    <button key={d.id}
                      onClick={() => setPaintDriverId(d.id)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold transition-all border"
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

          {/* ── 대형 아파트/임대단지 배정 ───────────────────────────── */}
          {largeAptComplexes.length > 0 && (
            <div className="order-6 px-2 py-2 border-t border-[#1a1a1a]">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[8px] text-gray-600 font-black tracking-widest uppercase">대형단지</div>
                <span className="text-[9px] text-orange-400 font-bold">{largeAptComplexes.length}개</span>
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                {largeAptComplexes.slice(0, 4).map(({ aptKey, aptName, road, totalQty, rentalDetected, buildingCount }) => (
                  <div key={aptKey} className="flex items-center gap-1.5 bg-[#111] border border-orange-700/20 rounded-lg px-1.5 py-1">
                    <Building2 size={10} className="text-orange-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[9px] text-white font-bold truncate">{aptName}</div>
                      <div className="flex items-center gap-1 text-[8px]">
                        <span className="text-orange-400">{totalQty}포</span>
                        {buildingCount > 0 && <span className="text-gray-600">· {buildingCount}개 동</span>}
                        <span className={rentalDetected ? 'text-emerald-400' : 'text-amber-500'}>
                          · {rentalDetected ? '임대감지' : '대형단지'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => openAptMultiModal(aptKey)}
                      className="shrink-0 px-1.5 py-0.5 bg-orange-500/20 border border-orange-400/40 text-orange-300 rounded text-[8px] font-bold hover:bg-orange-500/30 transition-colors"
                    >
                      분할
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 기사 목록 */}
          <div className="order-4 flex-1 min-h-0 overflow-y-auto p-2">
            <div className="flex items-center justify-between mb-1.5 sticky top-0 bg-[#070707]/95 z-10 pb-1">
              <div className="text-[9px] text-gray-600 font-black tracking-widest uppercase">기사 목록</div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={openDriverSwapModal}
                  title="두 기사에게 배정된 구역 전체를 서로 맞바꿉니다"
                  className="text-[9px] px-1.5 py-0.5 rounded border font-bold transition-colors bg-[#111] border-[#222] text-cyan-400 hover:border-cyan-500/40 hover:bg-cyan-950/20 flex items-center gap-0.5"
                >
                  <ArrowLeftRight size={9} /> 교체
                </button>
                <button onClick={() => setScheduleMode(v => !v)}
                  className={`text-[9px] px-1.5 py-0.5 rounded border font-bold transition-colors ${scheduleMode ? 'bg-purple-900/30 border-purple-500/40 text-purple-400' : 'bg-[#111] border-[#222] text-gray-600 hover:text-gray-400'}`}>
                  일정
                </button>
                <button
                  onClick={() => {
                    // 지도에서 선택된 동을 모달에 반영 ('전체'거나 비어있으면 첫 번째 동으로)
                    const initDong = (selectedDong && selectedDong !== '전체')
                      ? selectedDong
                      : (dongList[0] || '');
                    setPickerDong(initDong);
                    setPickerSelectedName('');
                    setShowCompanyPicker(true);
                  }}
                  disabled={drivers.length >= 8}
                  title="소속사 기사 추가 — 이사·외곽 레코드를 다른 기사에게 배정할 때 사용"
                  className="text-[10px] text-[#3b82f6] hover:text-[#93c5fd] disabled:text-gray-700 flex items-center gap-0.5">
                  <Plus size={10} /> 추가
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <button onClick={() => setSelectedDriverFilter(selectedDriverFilter === 'none' ? 'all' : 'none')}
                className={`w-full px-2 py-1.5 rounded-lg border text-left transition-colors ${selectedDriverFilter === 'none' ? 'bg-[#1a1a1a] border-gray-600' : 'bg-[#0d0d0d] border-[#1e1e1e] hover:border-[#2a2a2a]'}`}>
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
                const zoneNo = drivers.findIndex(dr => dr.id === d.id) + 1;
                return (
                  <div key={d.id}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer`}
                    style={{
                      borderColor: isActive ? d.color + '60' : (d.isExternal ? '#7c3aed40' : '#1e1e1e'),
                      borderStyle: d.isExternal ? 'dashed' : 'solid',
                      background: isActive ? d.color + '10' : (d.isExternal ? '#1a0a2e' : '#0d0d0d'),
                    }}
                    onClick={() => setSelectedDriverFilter(isActive ? 'all' : d.id)}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-[8px] font-black px-1 py-0.5 rounded bg-black/40 border border-white/5 text-gray-500 shrink-0">{zoneNo}구역</span>
                      <input value={d.name}
                        onChange={e => setDrivers(prev => prev.map(dr => dr.id === d.id ? { ...dr, name: e.target.value } : dr))}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 bg-transparent text-white text-xs focus:outline-none min-w-0" />
                      {d.isExternal && (
                        <span className="text-[8px] font-black px-1 py-0.5 rounded bg-purple-900/40 text-purple-400 border border-purple-500/30 shrink-0">외부</span>
                      )}
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
                    {/* 출발지 */}
                    <div className="mt-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <span className="text-[8px] text-gray-600 shrink-0 w-7">출발지</span>
                      <input
                        value={d.startAddr || ''}
                        onChange={e => setDrivers(prev => prev.map(dr =>
                          dr.id === d.id ? { ...dr, startAddr: e.target.value, startLat: null, startLng: null } : dr
                        ))}
                        onBlur={e => handleGeocodeStartAddr(d.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="출발 주소 입력"
                        className="flex-1 bg-[#111] border border-[#2a2a2a] text-[8px] text-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500/40 min-w-0 truncate"
                      />
                      <span
                        title={d.startLat ? `좌표확인 완료 (${d.startLat?.toFixed(4)}, ${d.startLng?.toFixed(4)})` : '주소 입력 후 포커스 이동 시 자동 변환'}
                        className={`text-[9px] shrink-0 font-black ${d.startLat ? 'text-emerald-400' : 'text-gray-700'}`}>
                        {d.startLat ? '✓' : '?'}
                      </span>
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

          <div className="order-7 px-2 py-1.5 border-t border-[#1a1a1a]">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[8px] text-gray-700 font-black tracking-widest uppercase mr-0.5">범례</span>
              <span title="주소 확인필요" className="w-2 h-2 rounded-full bg-[#ef4444]" />
              <span title="미배정" className="w-2 h-2 rounded-full bg-gray-600" />
              {drivers.map(d => (
                <span key={d.id} title={d.name} className="w-2 h-2 rounded-full" style={{ background: d.color }} />
              ))}
            </div>
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
              onClick={() => samePointPopup && setSamePointPopup(null)}
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

            {/* ── 같은 좌표 팝업 ─────────────────────────────────────── */}
            {samePointPopup && (
              <div
                className="absolute z-[300] pointer-events-auto"
                style={{ left: samePointPopup.x, top: samePointPopup.y, transform: 'translate(-50%, -110%)' }}
              >
                <div className="bg-[#0e0e0e] border border-purple-500/40 rounded-xl shadow-2xl overflow-hidden min-w-[180px] max-w-[260px]">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-purple-900/30">
                    <span className="text-[10px] font-black text-purple-300 tracking-widest uppercase">같은 위치 {samePointPopup.recs.length}명</span>
                    <button onClick={() => setSamePointPopup(null)} className="text-gray-500 hover:text-white transition-colors ml-2">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  <div className="py-1 max-h-[220px] overflow-y-auto">
                    {samePointPopup.recs.map((rec, i) => {
                      const drv = drivers.find(d => d.id === rec._driverId);
                      const qty = parseInt(rec.포수 || rec['수량(포수)']) || 1;
                      return (
                        <button
                          key={rec.id}
                          onClick={() => { setSamePointPopup(null); setLayoutMode(prev => (prev === 'map' || prev === 'mapfull') ? 'split' : prev); handleSelectRecord(rec); }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors text-left"
                        >
                          <span className="text-[10px] text-gray-500 w-4 shrink-0">{i + 1}</span>
                          <span className="text-[11px] font-bold text-white shrink-0">{rec.이름 || '-'}</span>
                          <span className="text-[10px] text-gray-400 flex-1 truncate">{(rec.주소 || '').slice(0, 20)}</span>
                          <span className="text-[10px] font-bold shrink-0" style={{ color: drv?.color || '#6b7280' }}>{qty}포</span>
                          {rec.배송순번 && <span className="text-[9px] text-gray-600 shrink-0">#{rec.배송순번}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

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
              layoutMode === 'split' ? 'w-[30%] shrink-0' : 'flex-1'
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
                  value={activeDong || ''}
                  onChange={e => {
                    const idx = dongQueue.indexOf(e.target.value);
                    if (idx >= 0) handleDongNavigate(idx);
                  }}
                  className="bg-[#111] border border-[#222] rounded-lg px-2 py-0.5 text-[10px] text-white outline-none focus:border-emerald-500/40 cursor-pointer"
                >
                  {dongQueue.map(d => (
                    <option key={d} value={d}>
                      {`${completedDongs.has(d) ? '✓ ' : ''}${d} (${dongCounts[d] || 0}건)`}
                    </option>
                  ))}
                </select>
                {/* 순번 편집 버튼 그룹 */}
                <div className="ml-auto flex gap-1 shrink-0">
                  <button
                    onClick={() => { setIsSeqClickMode(v => !v); setSeqClickNext(1); if (isSeqDragMode) setIsSeqDragMode(false); }}
                    title={isSeqClickMode ? `클릭 순번 모드 ON — 행을 클릭하면 ${seqClickNext}번째 순번이 배정됩니다.` : '클릭 순번: 행을 클릭하는 순서대로 1→2→3 자동 배정'}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 transition-colors ${
                      isSeqClickMode
                        ? 'bg-amber-500/20 border border-amber-400/50 text-amber-300 animate-pulse'
                        : 'bg-[#111] border border-[#222] text-gray-500 hover:text-amber-400 hover:border-amber-500/30'
                    }`}
                  >
                    {isSeqClickMode ? `▶${seqClickNext}번` : '클릭'}
                  </button>
                  <button
                    onClick={() => { setIsSeqDragMode(v => !v); if (isSeqClickMode) setIsSeqClickMode(false); }}
                    title={isSeqDragMode ? '드래그 모드 ON — 행을 드래그해서 순번을 조정하세요.' : '드래그 순번: 행을 드래그해서 순서 세밀 조정'}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 transition-colors ${
                      isSeqDragMode
                        ? 'bg-purple-500/20 border border-purple-400/50 text-purple-300'
                        : 'bg-[#111] border border-[#222] text-gray-500 hover:text-purple-400 hover:border-purple-500/30'
                    }`}
                  >
                    ⠿ 드래그
                  </button>
                </div>
              </div>
              <table className="w-full border-collapse text-[10px]">
                <thead className="sticky top-[33px] bg-[#0a0a0a] z-10">
                  <tr className="border-b border-[#1a1a1a]">
                    <th className="w-1 p-0" />
                    {isSeqDragMode && <th className="w-5 p-0" />}
                    <th className="px-2 py-1 text-left text-[9px] text-gray-700 font-black w-7">#</th>
                    <th className="px-1 py-1 text-left text-[9px] text-gray-700 font-black">기사</th>
                    <th className="px-1 py-1 text-left text-[9px] text-gray-700 font-black">이름</th>
                    <th className="px-1 py-1 text-left text-[9px] text-gray-700 font-black">주소</th>
                    <th className="px-1 py-1 text-center text-[9px] text-gray-700 font-black w-10">순</th>
                    <th className="px-1 py-1 text-center text-[9px] text-gray-700 font-black w-5">좌</th>
                  </tr>
                </thead>
                <tbody>
                  {listRecords.map((r, idx) => {
                    const driver = drivers.find(d => d.id === r._driverId);
                    const isSelected = selectedRecordId === r.id;
                    const isSelectionPulse = selectionPulseId === r.id;
                    const isDragOver = isSeqDragMode && dragOverId === r.id;
                    return (
                      <tr
                        key={r.id} id={`rec-${r.id}`}
                        draggable={isSeqDragMode}
                        onDragStart={isSeqDragMode ? () => { dragSrcIdRef.current = r.id; } : undefined}
                        onDragOver={isSeqDragMode ? (e) => { e.preventDefault(); setDragOverId(r.id); } : undefined}
                        onDragLeave={isSeqDragMode ? () => setDragOverId(null) : undefined}
                        onDrop={isSeqDragMode ? () => handleSeqDrop(r.id) : undefined}
                        onDragEnd={isSeqDragMode ? () => { dragSrcIdRef.current = null; setDragOverId(null); } : undefined}
                        onClick={(e) => {
                          if (['SELECT','INPUT','OPTION'].includes(e.target.tagName)) return;
                          if (isSeqDragMode) return;
                          if (isSeqClickMode) {
                            setRecords(prev => prev.map(pr => pr.id === r.id ? { ...pr, 배송순번: String(seqClickNext) } : pr));
                            setSeqClickNext(n => n + 1);
                            return;
                          }
                          if (r._lat && r._lng) handleSelectRecord(r);
                          else setSelectedRecordId(r.id);
                        }}
                        className={`border-b transition-colors cursor-pointer ${!r._lat ? 'opacity-50' : ''} ${isSeqDragMode ? 'hover:bg-purple-900/10' : isSeqClickMode ? 'hover:bg-amber-900/20' : isSelected ? 'bg-blue-500/20' : 'hover:bg-[#0f0f0f]'}`}
                        style={{
                          borderBottomColor: isDragOver ? '#a855f7' : '#0e0e0e',
                          borderBottomWidth: isDragOver ? '2px' : '1px',
                          ...(isSelected && !isSeqDragMode ? {
                            outline: '2px solid rgba(59,130,246,0.75)',
                            outlineOffset: '-2px',
                            boxShadow: isSelectionPulse
                              ? 'inset 0 0 0 9999px rgba(59,130,246,0.10), 0 0 18px rgba(59,130,246,0.45)'
                              : 'inset 0 0 0 9999px rgba(59,130,246,0.04)',
                          } : {}),
                          cursor: isSeqDragMode ? 'grab' : 'pointer',
                        }}>
                        {/* 기사 컬러 스트라이프 */}
                        <td
                          className="w-1 p-0 rounded-l"
                          style={{
                            background: isSelected ? '#60a5fa' : (driver?.color || 'transparent'),
                            opacity: isSelected ? 1 : (driver ? 0.85 : 0),
                            boxShadow: isSelected ? '0 0 10px rgba(96,165,250,0.8)' : 'none',
                          }}
                        />
                        {/* 드래그 핸들 */}
                        {isSeqDragMode && (
                          <td className="w-5 px-1 text-center text-gray-600 select-none" style={{ cursor: 'grab', fontSize: 11 }}>⠿</td>
                        )}
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
                        <td className={`px-1 py-0.5 font-bold whitespace-nowrap ${isSelected ? 'text-blue-100' : 'text-white'}`}>
                          <span className="inline-flex items-center gap-1">
                            {isSelected && (
                              <span className="px-1 py-0 rounded bg-blue-500 text-white text-[8px] font-black leading-4 shadow-[0_0_8px_rgba(59,130,246,0.55)]">
                                선택
                              </span>
                            )}
                            {r.이름}
                          </span>
                        </td>
                        <td className="px-1 py-0.5 text-gray-500 max-w-0 w-full">
                          <span className="block truncate" title={r.주소}>{r.주소}</span>
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

      {/* ── 토스트 알림 ──────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.7)] font-bold text-sm border pointer-events-none
            ${toast.type === 'success' ? 'bg-[#051a0c] border-emerald-500/50 text-emerald-300' :
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
        const errorRecords = records.filter(r => !r._lat || !r._lng || r.좌표검증상태 === '지자체벗어남');

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
                return (d?.x && d?.y) ? { lat: parseFloat(d.y), lng: parseFloat(d.x), raw: d } : null;
              } catch { clearTimeout(tid); return null; }
            };
            const road = extractRoadAddress(addrToUse);
            let coord =
              await fetchCoord(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(road)}&size=1`) ||
              await fetchCoord(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(road)}&size=1`) ||
              await fetchCoord(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent((getRouteDong(r) ? `${getRouteDong(r)} ` : '') + road.slice(0, 35))}&size=1`);

            if (coord) {
              const cacheCity = isCloudMode ? cloudCity : (fileInfo?.city || '');
              const area = assessKakaoAreaMatch(r, coord.raw, cacheCity);
              const isCityOut = area.status === '지자체벗어남';
              const isDongOut = area.status === '행정동벗어남';
              setRecords(prev => prev.map(x => x.id === r.id ? {
                ...x,
                _lat: coord.lat,
                _lng: coord.lng,
                _driverId: null,
                주소: errorAddrOverrides[r.id]?.trim() || x.주소,
                좌표검증상태: area.status,
                좌표확인지자체: [area.matchedSido, area.matchedSigungu].filter(Boolean).join(' '),
                좌표확인행정동: area.matchedDong || '',
                좌표오류지정: false,
                원행정동: isDongOut && !x.원행정동 ? x.행정동 || '' : x.원행정동,
                배정행정동: isDongOut ? area.routeDong : (x.배정행정동 || ''),
                이관필요: isDongOut,
                확인필요: isCityOut ? true : x.확인필요,
                확인사유: area.reason ? [x.확인사유, area.reason].filter(Boolean).join(' / ') : x.확인사유,
                _에러: isCityOut ? true : x._에러,
                _사유: area.reason ? [x._사유, area.reason].filter(Boolean).join(' / ') : x._사유,
                배송상태: isCityOut ? '타지자체확인필요' : (isDongOut ? '타동이관필요' : (x.확인필요 || x._에러 ? '확인후배정가능' : '배송준비')),
              } : x));
              if (cacheCity) await saveCoordCache(cacheCity, road, coord.lat, coord.lng);
              if (isCloudMode && cloudCity && cloudMonthId && r._cloudDocId) {
                const batch = writeBatch(db);
                batch.update(doc(db, 'cloud_lists', cloudCity, 'months', cloudMonthId, 'records', r._cloudDocId), {
                  lat: coord.lat,
                  lng: coord.lng,
                  ...(errorAddrOverrides[r.id]?.trim() ? { 주소: errorAddrOverrides[r.id].trim() } : {}),
                  좌표검증상태: area.status,
                  좌표확인지자체: [area.matchedSido, area.matchedSigungu].filter(Boolean).join(' '),
                  좌표확인행정동: area.matchedDong || '',
                  좌표오류지정: false,
                  원행정동: isDongOut && !r.원행정동 ? r.행정동 || '' : r.원행정동 || '',
                  배정행정동: isDongOut ? area.routeDong : (r.배정행정동 || ''),
                  이관필요: isDongOut,
                  확인필요: isCityOut ? true : !!r.확인필요,
                  확인사유: area.reason ? [r.확인사유, area.reason].filter(Boolean).join(' / ') : r.확인사유 || '',
                  _에러: isCityOut ? true : !!r._에러,
                  _사유: area.reason ? [r._사유, area.reason].filter(Boolean).join(' / ') : r._사유 || '',
                  배송상태: isCityOut ? '타지자체확인필요' : (isDongOut ? '타동이관필요' : (r.확인필요 || r._에러 ? '확인후배정가능' : '배송준비')),
                });
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

      {/* ── 기사 배정 맞교환 모달 ─────────────────────────────────── */}
      {showDriverSwapModal && (() => {
        const useDongScope = swapScope === 'dong' && selectedDong !== '전체';
        const scopeRecords = useDongScope ? records.filter(r => getRouteDong(r) === selectedDong) : records;
        const scopeLabel = useDongScope ? selectedDong : '전체';
        const driverStats = drivers.map((driver, index) => {
          const assigned = scopeRecords.filter(r => r._driverId === driver.id);
          const qty = assigned.reduce((s, r) => s + (parseInt(r.포수 || r['수량(포수)']) || 1), 0);
          return {
            ...driver,
            zoneNo: index + 1,
            count: assigned.length,
            qty,
            effectiveLoad: Math.round(assigned.reduce((s, r) => s + getEffectiveLoad(r), 0)),
          };
        });
        const fromStat = driverStats.find(d => d.id === swapFromDriverId);
        const toStat = driverStats.find(d => d.id === swapToDriverId);
        const assignedOptions = driverStats.filter(d => d.count > 0);
        return (
          <div
            className="absolute inset-0 z-[280] bg-black/75 flex items-center justify-center p-4"
            onClick={() => setShowDriverSwapModal(false)}
          >
            <div
              className="bg-[#0d0d0d] border border-cyan-500/30 rounded-2xl w-full max-w-md shadow-2xl shadow-cyan-950/20"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center shrink-0">
                  <ArrowLeftRight size={15} className="text-cyan-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-black text-white">기사 배정 교체</h3>
                  <p className="text-[10px] text-gray-500">두 기사에게 배정된 명단만 서로 맞바꿉니다. 좌표와 순번은 유지됩니다.</p>
                </div>
                <button onClick={() => setShowDriverSwapModal(false)} className="p-1.5 text-gray-600 hover:text-white transition-colors">
                  <X size={14} />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">
                <div>
                  <div className="text-[9px] text-gray-600 font-black tracking-widest uppercase mb-1.5">적용 범위</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setSwapScope('all')}
                      className={`py-2 rounded-xl border text-xs font-black transition-colors ${swapScope === 'all' ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300' : 'bg-[#111] border-[#262626] text-gray-500 hover:text-gray-300'}`}
                    >
                      전체 명단
                    </button>
                    <button
                      onClick={() => setSwapScope('dong')}
                      disabled={selectedDong === '전체'}
                      className={`py-2 rounded-xl border text-xs font-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${swapScope === 'dong' && selectedDong !== '전체' ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300' : 'bg-[#111] border-[#262626] text-gray-500 hover:text-gray-300'}`}
                    >
                      현재 행정동
                    </button>
                  </div>
                  <div className="mt-1.5 text-[10px] text-gray-600">
                    현재 범위: <span className="text-cyan-300 font-bold">{scopeLabel}</span>
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
                  <div>
                    <label className="block text-[9px] text-gray-600 font-black tracking-widest uppercase mb-1">기사 A</label>
                    <select
                      value={swapFromDriverId}
                      onChange={e => setSwapFromDriverId(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/40"
                    >
                      {assignedOptions.map(d => (
                        <option key={d.id} value={d.id}>{d.zoneNo}구역 {d.name} · {d.count}건</option>
                      ))}
                    </select>
                  </div>
                  <div className="pb-2 text-cyan-400">
                    <ArrowLeftRight size={16} />
                  </div>
                  <div>
                    <label className="block text-[9px] text-gray-600 font-black tracking-widest uppercase mb-1">기사 B</label>
                    <select
                      value={swapToDriverId}
                      onChange={e => setSwapToDriverId(e.target.value)}
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/40"
                    >
                      {assignedOptions.map(d => (
                        <option key={d.id} value={d.id}>{d.zoneNo}구역 {d.name} · {d.count}건</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {[fromStat, toStat].map((stat, idx) => (
                    <div key={stat?.id || idx} className="rounded-xl bg-[#111] border border-[#242424] p-3 min-w-0">
                      {stat ? (
                        <>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stat.color }} />
                            <span className="text-white text-xs font-black truncate">{stat.zoneNo}구역 {stat.name}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-gray-600">배정</span>
                            <span className="text-cyan-300 font-black">{stat.count}건 · {stat.qty}포</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] mt-0.5">
                            <span className="text-gray-600">유효부담</span>
                            <span className="text-gray-300 font-bold">{stat.effectiveLoad}</span>
                          </div>
                        </>
                      ) : (
                        <div className="text-[10px] text-gray-600">기사를 선택하세요.</div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-xl bg-cyan-950/10 border border-cyan-500/20 px-3 py-2 text-[10px] text-gray-400 leading-relaxed">
                  예: <span className="text-cyan-300 font-bold">1구역 기사1</span>과 <span className="text-cyan-300 font-bold">3구역 기사3</span>을 선택하면,
                  기사1에게 있던 명단은 기사3으로, 기사3에게 있던 명단은 기사1로 이동합니다.
                </div>
              </div>

              <div className="px-5 py-4 border-t border-[#1a1a1a] flex items-center justify-between gap-3">
                <button
                  onClick={() => setShowDriverSwapModal(false)}
                  className="px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-white text-xs font-bold rounded-xl transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleSwapDriverAssignments}
                  disabled={!swapFromDriverId || !swapToDriverId || swapFromDriverId === swapToDriverId}
                  className="flex-1 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-black rounded-xl transition-colors flex items-center justify-center gap-1.5"
                >
                  <ArrowLeftRight size={12} /> 배정 맞교환
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
                {aptMultiModal.road && aptMultiModal.road !== aptMultiModal.aptName && (
                  <p className="text-[10px] text-gray-600 truncate">{aptMultiModal.road}</p>
                )}
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

      {/* ── 소속사 기사 추가 피커 ─────────────────────────────────────── */}
      {showCompanyPicker && (() => {
        const hasCompanyList = companyDriverPool?.length > 0;
        const hasAvailable = availableCompanyDrivers.length > 0;
        // 콤보박스 확정값: 선택된 기사 객체
        const selectedDriver = hasAvailable
          ? availableCompanyDrivers.find(d => d.name === pickerSelectedName) || availableCompanyDrivers[0]
          : null;

        return (
          <div
            className="absolute inset-0 z-[250] bg-black/70 flex items-start justify-center pt-24"
            onClick={() => setShowCompanyPicker(false)}
          >
            <div
              className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-72 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* 헤더 */}
              <div className="px-4 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-black text-sm">소속사 기사 추가</span>
                    {pickerDong && pickerDong !== '전체' && (
                      <span className="text-[10px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 rounded px-1.5 py-0.5 font-bold">
                        {pickerDong}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5">
                    세션 기사 제외 · 미배정 기사만 표시
                  </div>
                </div>
                <button onClick={() => setShowCompanyPicker(false)} className="text-gray-600 hover:text-white transition-colors">
                  <X size={14} />
                </button>
              </div>

              <div className="px-4 py-4 space-y-3">
                {/* ── 소속사 콤보박스 (기사 목록이 있을 때) */}
                {hasCompanyList && (
                  <div>
                    <div className="text-[10px] text-gray-500 mb-1.5 font-bold">소속사 기사 선택</div>
                    {hasAvailable ? (
                      <select
                        value={pickerSelectedName || (availableCompanyDrivers[0]?.name ?? '')}
                        onChange={e => setPickerSelectedName(e.target.value)}
                        className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none cursor-pointer"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
                      >
                        {availableCompanyDrivers.map(d => (
                          <option key={d.id || d.name} value={d.name}>
                            {d.name}{d.capacity && d.capacity !== 100 ? ` (${d.capacity}%)` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="w-full bg-[#111] border border-[#1a1a1a] rounded-lg px-3 py-2 text-[11px] text-gray-600">
                        모든 소속사 기사가 이미 배정되어 있습니다
                      </div>
                    )}
                    {hasAvailable && (
                      <button
                        onClick={() => addCompanyDriver(selectedDriver)}
                        className="mt-2 w-full py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-black rounded-lg transition-colors"
                      >
                        선택 기사 추가
                      </button>
                    )}
                  </div>
                )}

                {/* ── 구분선 */}
                {hasCompanyList && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-[#1a1a1a]" />
                    <span className="text-[9px] text-gray-700">또는 직접 입력</span>
                    <div className="flex-1 h-px bg-[#1a1a1a]" />
                  </div>
                )}

                {/* ── 직접 입력 */}
                <div>
                  {!hasCompanyList && (
                    <div className="text-[10px] text-gray-600 mb-2 leading-relaxed">
                      소속사 기사 목록이 없습니다.<br />기사 이름을 직접 입력하세요.
                    </div>
                  )}
                  <input
                    autoFocus={!hasCompanyList}
                    id="company-driver-name-input"
                    placeholder={`기사${drivers.length + 1}`}
                    className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/40"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const name = e.target.value.trim() || `기사${drivers.length + 1}`;
                        addCompanyDriver({ name });
                      } else if (e.key === 'Escape') {
                        setShowCompanyPicker(false);
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById('company-driver-name-input');
                      addCompanyDriver({ name: (input?.value || '').trim() || `기사${drivers.length + 1}` });
                    }}
                    className="mt-2 w-full py-2 bg-[#1a1a1a] hover:bg-[#222] border border-[#2a2a2a] text-white text-xs font-black rounded-lg transition-colors"
                  >
                    추가
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 좌표 삭제 브러시 모달 ──────────────────────────────────── */}
      {showCoordBrush && (
        <CoordBrushModal
          records={records.map(r => ({ ...r, lat: r._lat, lng: r._lng }))}
          selectedCity={isCloudMode ? cloudCity : (fileInfo?.city || '')}
          onClose={() => setShowCoordBrush(false)}
          onApplyDelete={handleCoordBrushApply}
          onApplyRematch={async (ids) => {
            await handleCoordBrushApply(ids, true);
            setShowCoordBrush(false);
            await handleFetchMissingCoords({ recordIds: ids, force: true, skipConfirm: true, reason: 'brush-rematch' });
          }}
        />
      )}

      {/* ── 오버레이 패널 (지도 DOM 유지) ─────────────────────────── */}
      {cloudPickerOverlay}

      {/* ── 기사 순번 반영 요청 승인 모달 ─────────────────────────── */}
      {orderRequestModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[210] flex items-center justify-center p-4">
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-amber-300" />
                <span className="text-white font-black text-sm">기사 순번 반영 요청</span>
              </div>
              <button onClick={() => setOrderRequestModal(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-100 leading-relaxed">
                기사 요청은 바로 원본을 바꾸지 않습니다. 담당자가 기사와 유선 확인 후 [확인 후 반영]을 누르면 해당 기사 명단의 배송순번만 공식 월별 명단에 저장됩니다.
              </div>
              {orderRequestModal.requests.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-xs font-bold">
                  대기 중인 순번 반영 요청이 없습니다.
                </div>
              ) : orderRequestModal.requests.map(req => (
                <div key={`${req.shareId}_${req.driverId}`} className="bg-[#111] border border-[#2a2a2a] rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: req.driverColor }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-white text-xs font-black truncate">{req.driverName}</div>
                      <div className="text-[9px] text-gray-500 truncate">
                        요청 {req.count?.toLocaleString?.() || req.orderIds.length}건
                        {req.requestedAt ? ` · ${new Date(req.requestedAt).toLocaleString('ko-KR')}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleApproveOrderRequest(req)}
                      disabled={isApplyingOrderRequest}
                      className="px-3 py-1.5 bg-amber-600/20 border border-amber-500/40 text-amber-200 hover:bg-amber-600/30 rounded-lg text-[10px] font-black flex items-center gap-1.5 shrink-0 transition-colors disabled:opacity-50"
                    >
                      {isApplyingOrderRequest ? <RefreshCw size={10} className="animate-spin" /> : <Save size={10} />}
                      확인 후 반영
                    </button>
                  </div>
                  <div className="mt-2 text-[9px] text-gray-600 truncate">공유ID: {req.shareId}</div>
                </div>
              ))}
            </div>
            <div className="px-5 pb-4 flex gap-2 justify-end">
              <button
                onClick={handleLoadOrderApplyRequests}
                disabled={isLoadingOrderRequests}
                className="px-4 py-2 bg-[#111] border border-[#2a2a2a] text-gray-300 hover:text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {isLoadingOrderRequests ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                새로고침
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 행정동 이동 미저장 확인 모달 ────────────────────────────────── */}
      {showDongNavConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[700] flex items-center justify-center p-4">
          <div className="w-full max-w-xs bg-[#0d0d0d] border border-amber-500/40 rounded-2xl p-5 shadow-[0_0_40px_rgba(245,158,11,0.15)]">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle size={16} className="text-amber-400 shrink-0" />
              <span className="text-sm font-black text-white">미저장 변경이 있습니다</span>
            </div>
            <p className="text-[10px] text-gray-400 mb-4 leading-relaxed">
              <span className="text-amber-300 font-bold">{activeDong}</span> 배정 결과가 저장되지 않았습니다.<br/>
              다음 행정동(<span className="text-white font-bold">{dongQueue[showDongNavConfirm.targetIndex]}</span>)으로 이동하면 현재 배정이 유실됩니다.
            </p>
            <div className="space-y-2">
              <button
                onClick={async () => {
                  await handleSaveSession(false);
                  setShowDongNavConfirm(null);
                  setActiveDongIndex(showDongNavConfirm.targetIndex);
                }}
                className="w-full py-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 font-black rounded-xl text-xs transition-colors"
              >
                저장 후 이동
              </button>
              <button
                onClick={() => {
                  const { targetIndex } = showDongNavConfirm;
                  setShowDongNavConfirm(null);
                  setIsDirty(false);
                  setActiveDongIndex(targetIndex);
                }}
                className="w-full py-2 bg-[#111] border border-[#2a2a2a] text-gray-400 hover:text-white hover:border-[#3a3a3a] font-bold rounded-xl text-xs transition-colors"
              >
                저장 안 하고 이동
              </button>
              <button
                onClick={() => setShowDongNavConfirm(null)}
                className="w-full py-1.5 text-gray-600 hover:text-gray-400 text-xs transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 자동 핀 확인 모달 ──────────────────────────────────────────── */}
      {autoPinConfirmModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[600] flex items-center justify-center p-4">
          <div className="w-full max-w-xs bg-[#0a0a0a] border border-emerald-500/30 rounded-2xl p-5 shadow-[0_0_50px_rgba(16,185,129,0.15)]">
            <div className="flex items-center gap-2 mb-1">
              <MapPin size={14} className="text-emerald-400 shrink-0" />
              <span className="text-sm font-black text-white">자동 핀 배치 완료</span>
            </div>
            <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">기사별 배정 구역 중심에 핀을 자동 생성했습니다.<br/>이대로 확정하거나 핀을 조정 후 재배정할 수 있습니다.</p>
            <div className="space-y-1.5 mb-4 bg-[#111] rounded-xl p-3">
              {drivers.slice(0, driverCount).filter(d => !d.isExternal).map(d => {
                const cnt = Object.values(autoPinConfirmModal.clusterMap).filter(id => id === d.id).length;
                const isNew = !!autoPinConfirmModal.pendingPins[d.id];
                return (
                  <div key={d.id} className="flex items-center gap-2 text-[11px]">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="text-gray-200 flex-1 font-medium">{d.name}</span>
                    <span className="text-gray-500">{cnt.toLocaleString()}건</span>
                    {isNew && <span className="text-[9px] text-emerald-400 font-black">📍신규</span>}
                  </div>
                );
              })}
              {autoPinConfirmModal.diagnostics?.qualityScore !== undefined && (
                <div className="mt-2 pt-2 border-t border-[#1e1e1e] flex items-center justify-between text-[9px]">
                  <span className="text-gray-600">품질 점수</span>
                  <span className={`font-black ${autoPinConfirmModal.diagnostics.qualityScore >= 70 ? 'text-emerald-400' : autoPinConfirmModal.diagnostics.qualityScore >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                    {autoPinConfirmModal.diagnostics.qualityScore}점
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  const { clusterMap, pendingPins, diagnostics, affectedIds } = autoPinConfirmModal;
                  const idSet = new Set(affectedIds);
                  setDriverPins(prev => ({ ...prev, ...pendingPins }));
                  setRecords(prev => prev.map(r => idSet.has(r.id)
                    ? { ...r, _driverId: clusterMap[r.id] || null }
                    : r
                  ));
                  const balanceMsg = diagnostics?.load?.maxAbsDiffPct !== undefined
                    ? `최대 편차 ${diagnostics.load.maxAbsDiffPct}%` : '분석 완료';
                  const qScore = diagnostics?.qualityScore !== undefined ? ` · 품질 ${diagnostics.qualityScore}점` : '';
                  const stratLabel = { hilbert: '힐베르트 곡선', seedVoronoi: '핀 전체 기준', dongGroup: '자동 경계' }[diagnostics?.strategy || 'dongGroup'] || '자동 경계';
                  setTimeout(() => showToast('success', `자동 배정 완료 [${stratLabel}] — ${balanceMsg}${qScore} · 핀 자동 설정`, 5000), 200);
                  setAutoPinConfirmModal(null);
                }}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs transition-colors"
              >
                이대로 확정
              </button>
              <button
                onClick={() => {
                  const { clusterMap, pendingPins, affectedIds } = autoPinConfirmModal;
                  const idSet = new Set(affectedIds);
                  setDriverPins(prev => ({ ...prev, ...pendingPins }));
                  setRecords(prev => prev.map(r => idSet.has(r.id)
                    ? { ...r, _driverId: clusterMap[r.id] || null }
                    : r
                  ));
                  showToast('info', '핀이 지도에 표시됩니다. [핀 꽂기]로 조정 후 [자동 N등분]을 다시 누르세요.', 7000);
                  setAutoPinConfirmModal(null);
                }}
                className="w-full py-2 bg-[#111] border border-[#2a2a2a] text-gray-400 hover:text-white hover:border-emerald-500/40 font-bold rounded-xl text-xs transition-colors"
              >
                핀 조정 후 재배정
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 공유 링크 모달 ──────────────────────────────────────────── */}
      {shareModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2">
                <Share2 size={16} className="text-green-400" />
                <span className="text-white font-black text-sm">기사 배송루트 공유</span>
              </div>
              <button onClick={() => setShareModal(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-[10px] text-gray-500">링크 전달 → 기사가 모바일에서 배송루트 카카오지도 확인 및 <span className="text-green-400">● 내 위치 실시간 표시</span> 가능.</p>
              {shareModal.expiresAtLabel && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-200">
                  이 배송 URL은 <span className="font-black text-amber-100">{shareModal.expiresAtLabel}</span>까지 사용할 수 있습니다. 만료 후에는 새 공유 링크를 다시 생성하세요.
                </div>
              )}
              {shareModal.links.map(l => (
                <div key={l.driverId} className="bg-[#111] border border-[#2a2a2a] rounded-xl p-3">
                  <div className="flex items-center gap-2">
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
                </div>
              ))}
            </div>
            <div className="px-5 pb-4 flex gap-2 justify-end">
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
