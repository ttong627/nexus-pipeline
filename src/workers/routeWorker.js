const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const RENTAL_KEYWORDS = ['LH', 'SH', '임대', '행복주택', '국민임대', '영구임대', '공공임대', '보금자리', '매입임대'];
const STAIRS_KEYWORDS = ['빌라', '연립', '다세대', '단독주택'];
const HEAVY_NOTE_KW = ['문앞', '거동불편', '직접전달', '현관앞', '직접'];
const MEDIUM_NOTE_KW = ['전화필수', '골목', '경비실', '게이트'];

const norm = (value) => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const getQty = (record) => parseInt(record.포수 || record['수량(포수)']) || 1;
const getAddr = (record) => String(record.주소 || '').trim();
const getDong = (record) => String(record.배정행정동 || record.routeDong || record.행정동 || '').trim();

const getEffectiveLoad = (record) => {
  const qty = getQty(record);
  const addr = getAddr(record);
  const note = String(record.특이사항 || '');
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
    const floor = parseInt(addr.match(/(\d+)\s*층/)?.[1] || '2');
    return qty * (1 + Math.min(floor, 5) * 0.1);
  }
  if (HEAVY_NOTE_KW.some(k => note.includes(k))) return qty * 1.5;
  if (MEDIUM_NOTE_KW.some(k => note.includes(k))) return qty * 1.2;
  return qty;
};

const extractRoadAddress = (addr) => {
  if (!addr) return '';
  let depth = 0;
  for (let i = 0; i < addr.length; i++) {
    if (addr[i] === '(') depth++;
    else if (addr[i] === ')') depth--;
    else if (addr[i] === ',' && depth === 0) return addr.slice(0, i).trim();
  }
  return addr.replace(/\([^)]*\)\s*$/, '').trim();
};

const extractBuildingName = (addr) => {
  const parens = [...String(addr || '').matchAll(/\(([^()]*)\)/g)];
  for (let i = parens.length - 1; i >= 0; i--) {
    const parts = parens[i][1].split(',').map(norm).filter(Boolean);
    const building = parts.find(part => !/(동|읍|면|리)$/.test(part));
    if (building) return building;
  }
  return '';
};

const parseAptDong = (record) => {
  const text = [
    record?._detailAddress,
    record?.detailAddress,
    record?.주소,
    record?.특이사항,
  ].filter(Boolean).join(' ');
  const match = String(text).match(/(?:^|[\s,(])(\d{1,4})\s*동(?:[\s,)]|$)/)
    || String(text).match(/(?:^|[\s,(])(\d{3,4})\s*-\s*\d{1,4}\s*호?/);
  return match ? parseInt(match[1], 10) : null;
};

const APT_LIKE_RE = /아파트|APT|Apartment|주공|휴먼시아|뜨란채|마을|단지|타운|빌리지|하이츠|아이파크|자이|래미안|푸르지오|힐스테이트|롯데캐슬|더샵|e편한세상|이편한세상|센트럴|리버|파크|LH|SH|임대|행복주택|국민임대|영구임대|공공임대|매입임대/i;

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

const parseRoadInfo = (record) => {
  const hintedSide = norm(record?._routeHints?.roadSideKey || record?.routeHints?.roadSideKey || '');
  const roadAddress = norm(record?._standardRoadAddress || record?.standardRoadAddress || extractRoadAddress(getAddr(record)));
  const match = roadAddress.match(/([가-힣A-Za-z0-9]+(?:대로|로))\s*(\d+)(?:-(\d+))?/);
  if (!match && !hintedSide) return { road: '', side: '', num: 999999, sub: 0, key: '', label: '' };
  if (hintedSide) {
    return { road: hintedSide, side: '', num: 999999, sub: 0, key: `road-side:db:${hintedSide}`, label: hintedSide };
  }
  const road = match[1];
  const num = parseInt(match[2], 10) || 999999;
  const sub = parseInt(match[3], 10) || 0;
  const side = num % 2 ? '좌측(홀수)' : '우측(짝수)';
  const label = `${road} ${side}`;
  return { road, side, num, sub, key: `road-side:${road}:${side}`, label };
};

const getAptGroupKey = (record) => {
  if (!isApartmentLike(record)) return '';
  const hinted = norm(record?._routeHints?.apartmentGroupKey || record?.routeHints?.apartmentGroupKey || '');
  const road = norm(record?._standardRoadAddress || record?.standardRoadAddress || extractRoadAddress(getAddr(record)));
  const baseKey = hinted || road;
  const splitDong = (record?.대형단지분할 || record?.largeComplexSplit) ? parseAptDong(record) : null;
  if (baseKey && splitDong) return `apt-split:${baseKey}:dong:${splitDong}`;
  if (hinted) return `apt:${hinted}`;
  if (road.length >= 4) return `apt-road:${road}`;
  const building = norm(record?._buildingName || record?.buildingName || extractBuildingName(getAddr(record)));
  if (building && splitDong) return `apt-split:${building}:dong:${splitDong}`;
  return building ? `apt-building:${building}` : '';
};

const buildUnits = (records) => {
  const buckets = new Map();
  records.forEach(record => {
    const aptKey = getAptGroupKey(record);
    const addrKey = norm(record._addressKey || getAddr(record));
    const coordKey = record._lat && record._lng ? `${Number(record._lat).toFixed(5)},${Number(record._lng).toFixed(5)}` : '';
    const key = aptKey || (addrKey ? `addr:${addrKey}` : `coord:${coordKey || record.id}`);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  });

  return [...buckets.entries()].map(([key, recs], idx) => {
    const load = recs.reduce((s, r) => s + getEffectiveLoad(r), 0) || 1;
    const qty = recs.reduce((s, r) => s + getQty(r), 0);
    const roadInfo = parseRoadInfo(recs[0]);
    const lat = recs.reduce((s, r) => s + Number(r._lat || 0) * getEffectiveLoad(r), 0) / load;
    const lng = recs.reduce((s, r) => s + Number(r._lng || 0) * getEffectiveLoad(r), 0) / load;
    return {
      id: `unit_${idx}`,
      key,
      recordIds: recs.map(r => r.id),
      records: recs,
      lat,
      lng,
      load,
      qty,
      count: recs.length,
      roadKey: roadInfo.key,
      roadLabel: roadInfo.label,
      roadNum: roadInfo.num,
      roadSub: roadInfo.sub,
      dong: getDong(recs[0]),
      mandatory: key.startsWith('apt:') || key.startsWith('apt-road:') || key.startsWith('apt-building:') || recs.length > 1,
    };
  });
};

const weightedCenter = (items) => {
  const total = items.reduce((s, item) => s + (item.load || 1), 0) || 1;
  return {
    lat: items.reduce((s, item) => s + item.lat * (item.load || 1), 0) / total,
    lng: items.reduce((s, item) => s + item.lng * (item.load || 1), 0) / total,
  };
};

const getProjectionAxis = (items, driverPins = []) => {
  const pinList = driverPins.filter(Boolean);
  const source = pinList.length >= 2
    ? pinList.map(pin => ({ lat: Number(pin.lat), lng: Number(pin.lng), load: 1 }))
    : items;
  if (source.length <= 1) return { x: 1, y: 0 };

  const center = weightedCenter(source);
  const cosLat = Math.cos(center.lat * Math.PI / 180);
  const vectors = source.map(item => ({
    x: (item.lng - center.lng) * cosLat,
    y: item.lat - center.lat,
    w: item.load || 1,
  }));
  const totalWeight = vectors.reduce((s, v) => s + v.w, 0) || 1;
  const xx = vectors.reduce((s, v) => s + v.x * v.x * v.w, 0) / totalWeight;
  const yy = vectors.reduce((s, v) => s + v.y * v.y * v.w, 0) / totalWeight;
  const xy = vectors.reduce((s, v) => s + v.x * v.y * v.w, 0) / totalWeight;
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let axis = { x: Math.cos(angle), y: Math.sin(angle) };

  // Keep the direction stable: west->east when mostly horizontal, north->south when mostly vertical.
  if (Math.abs(axis.x) >= Math.abs(axis.y)) {
    if (axis.x < 0) axis = { x: -axis.x, y: -axis.y };
  } else if (axis.y > 0) {
    axis = { x: -axis.x, y: -axis.y };
  }
  return axis;
};

const projectPoint = (item, axis, center) => {
  const cosLat = Math.cos(center.lat * Math.PI / 180);
  const x = (item.lng - center.lng) * cosLat;
  const y = item.lat - center.lat;
  return x * axis.x + y * axis.y;
};

const orderUnitsByRoad = (units, driverPins = []) => {
  if (units.length <= 1) return units;
  const center = weightedCenter(units);
  const axis = getProjectionAxis(units, driverPins);
  const roadGroups = new Map();
  units.forEach(unit => {
    const key = unit.roadKey || `free:${unit.id}`;
    if (!roadGroups.has(key)) roadGroups.set(key, []);
    roadGroups.get(key).push(unit);
  });

  const groups = [...roadGroups.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => {
      if (a.roadNum !== b.roadNum) return a.roadNum - b.roadNum;
      if (a.roadSub !== b.roadSub) return a.roadSub - b.roadSub;
      return a.lat !== b.lat ? b.lat - a.lat : a.lng - b.lng;
    });
    const group = {
      key,
      label: sorted[0].roadLabel || sorted[0].dong || key,
      units: sorted,
      lat: sorted.reduce((s, u) => s + u.lat * u.load, 0) / sorted.reduce((s, u) => s + u.load, 0),
      lng: sorted.reduce((s, u) => s + u.lng * u.load, 0) / sorted.reduce((s, u) => s + u.load, 0),
      load: sorted.reduce((s, u) => s + u.load, 0),
      qty: sorted.reduce((s, u) => s + u.qty, 0),
      projection: 0,
    };
    group.projection = projectPoint(group, axis, center);
    group.units = group.units
      .map(unit => ({ ...unit, projection: projectPoint(unit, axis, center) }))
      .sort((a, b) => {
        if (a.roadKey && b.roadKey && a.roadKey === b.roadKey) {
          if (a.roadNum !== b.roadNum) return a.roadNum - b.roadNum;
          if (a.roadSub !== b.roadSub) return a.roadSub - b.roadSub;
        }
        return a.projection - b.projection;
      });
    return group;
  });

  groups.sort((a, b) => {
    const diff = a.projection - b.projection;
    if (Math.abs(diff) > 1e-10) return diff;
    return haversine(center.lat, center.lng, a.lat, a.lng) - haversine(center.lat, center.lng, b.lat, b.lng);
  });

  return groups.flatMap(group => group.units);
};

const getDriverOrder = (drivers, driverPins) => {
  const pins = drivers.map(d => driverPins?.[d.id] || null);
  if (!pins.every(Boolean)) return drivers;
  const pinItems = drivers.map(d => ({
    driver: d,
    lat: Number(driverPins[d.id].lat),
    lng: Number(driverPins[d.id].lng),
    load: 1,
  }));
  const center = weightedCenter(pinItems);
  const axis = getProjectionAxis(pinItems, pins);
  return pinItems
    .map(item => ({ ...item, projection: projectPoint(item, axis, center) }))
    .sort((a, b) => a.projection - b.projection)
    .map(item => item.driver);
};

const partitionContiguous = (orderedUnits, orderedDrivers) => {
  const n = orderedUnits.length;
  const k = orderedDrivers.length;
  if (!n || !k) return {};
  if (k === 1) return Object.fromEntries(orderedUnits.map(u => [u.id, orderedDrivers[0].id]));
  if (k >= n) return Object.fromEntries(orderedUnits.map((u, idx) => [u.id, orderedDrivers[idx].id]));

  const loads = orderedUnits.map(u => u.load || 1);
  const prefix = [0];
  loads.forEach(v => prefix.push(prefix[prefix.length - 1] + v));
  const totalLoad = prefix[n] || 1;
  const caps = orderedDrivers.map(d => parseFloat(d.capacity) || 100);
  const totalCap = caps.reduce((s, c) => s + c, 0) || 1;
  const targets = caps.map(c => totalLoad * c / totalCap);
  const INF = 1e18;
  const dp = Array.from({ length: k + 1 }, () => Array(n + 1).fill(INF));
  const prev = Array.from({ length: k + 1 }, () => Array(n + 1).fill(-1));
  dp[0][0] = 0;

  for (let d = 1; d <= k; d++) {
    for (let i = d; i <= n; i++) {
      for (let j = d - 1; j < i; j++) {
        const segmentLoad = prefix[i] - prefix[j];
        const target = targets[d - 1] || 1;
        const loadCost = Math.pow((segmentLoad - target) / target, 2);
        const sizeCost = Math.pow((i - j) / Math.max(1, n / k), 2) * 0.015;
        const cost = dp[d - 1][j] + loadCost + sizeCost;
        if (cost < dp[d][i]) {
          dp[d][i] = cost;
          prev[d][i] = j;
        }
      }
    }
  }

  const ranges = [];
  let end = n;
  for (let d = k; d >= 1; d--) {
    const start = prev[d][end];
    ranges.unshift({ driver: orderedDrivers[d - 1], start, end });
    end = start;
  }

  const unitToDriver = {};
  ranges.forEach(({ driver, start, end }) => {
    for (let i = start; i < end; i++) unitToDriver[orderedUnits[i].id] = driver.id;
  });
  return unitToDriver;
};

const calculateStats = (records, clusterMap, drivers) => {
  const totalLoad = records.reduce((s, r) => s + getEffectiveLoad(r), 0) || 1;
  const totalQty = records.reduce((s, r) => s + getQty(r), 0);
  const totalCap = drivers.reduce((s, d) => s + (parseFloat(d.capacity) || 100), 0) || 1;
  const stats = drivers.map(driver => {
    const assigned = records.filter(r => clusterMap[r.id] === driver.id);
    const load = assigned.reduce((s, r) => s + getEffectiveLoad(r), 0);
    const qty = assigned.reduce((s, r) => s + getQty(r), 0);
    const targetLoad = totalLoad * ((parseFloat(driver.capacity) || 100) / totalCap);
    return {
      driverId: driver.id,
      driverName: driver.name,
      count: assigned.length,
      qty,
      load: Math.round(load * 10) / 10,
      targetLoad: Math.round(targetLoad * 10) / 10,
      diffPct: Math.round(((load - targetLoad) / Math.max(1, targetLoad)) * 100),
    };
  });
  const maxAbsDiffPct = Math.max(0, ...stats.map(s => Math.abs(s.diffPct)));
  return { totalLoad: Math.round(totalLoad * 10) / 10, totalQty, stats, maxAbsDiffPct };
};

const buildDiagnostics = ({ records, units, orderedUnits, clusterMap, activeDrivers, driverPins }) => {
  const load = calculateStats(records, clusterMap, activeDrivers);
  const roadMap = {};
  orderedUnits.forEach(unit => {
    const label = unit.roadLabel || '도로명 미확인';
    if (!roadMap[label]) roadMap[label] = { label, qty: 0, load: 0, count: 0, drivers: new Set() };
    unit.records.forEach(record => {
      roadMap[label].qty += getQty(record);
      roadMap[label].load += getEffectiveLoad(record);
      roadMap[label].count += 1;
      if (clusterMap[record.id]) roadMap[label].drivers.add(clusterMap[record.id]);
    });
  });
  const roadStats = Object.values(roadMap)
    .map(r => ({ ...r, load: Math.round(r.load * 10) / 10, driverCount: r.drivers.size, drivers: undefined }))
    .sort((a, b) => b.load - a.load)
    .slice(0, 8);

  const mixedRoads = roadStats.filter(r => r.driverCount > 1).length;
  const hasPins = activeDrivers.every(d => driverPins?.[d.id]);
  const issues = [];
  if (load.maxAbsDiffPct > 25) issues.push(`기사별 유효부담 편차가 최대 ${load.maxAbsDiffPct}%입니다. 대형 단지나 긴 도로 한쪽이 한 기사에게 몰렸는지 확인하세요.`);
  if (mixedRoads > 0) issues.push(`${mixedRoads}개 주요 도로가 여러 기사에게 나뉘었습니다. 큰길 경계가 맞는지 지도에서 확인하세요.`);
  if (!hasPins && activeDrivers.length >= 2) issues.push('기사 핀이 없어서 도로 연속성과 좌표 분포 기준으로 자동 분할했습니다. 큰길/하천 기준으로 핀을 꽂으면 경계가 더 명확해집니다.');

  return {
    load,
    roadStats,
    unitCount: units.length,
    mandatoryUnitCount: units.filter(u => u.mandatory).length,
    hasPins,
    issues,
    guide: [
      '아파트와 동일 주소는 먼저 하나의 배정 단위로 묶었습니다.',
      '대로/로는 본번 홀수=좌측, 짝수=우측 기준으로 같은 도로 측면이 이어지도록 정렬했습니다.',
      '기사별 capacity 비율에 맞춰 연속 구간을 자르기 때문에 구역이 섞이는 현상을 줄이고 유효부담을 맞춥니다.',
    ],
  };
};

const computeAutoSplit = ({ target, noCoordRecs = [], allRecords, activeDrivers, driverPins = {} }) => {
  const assignableRecords = target.filter(r => r._lat && r._lng && r.좌표검증상태 !== '지자체벗어남');
  const units = buildUnits(assignableRecords);
  const orderedDrivers = getDriverOrder(activeDrivers, driverPins);
  const orderedUnits = orderUnitsByRoad(units, orderedDrivers.map(d => driverPins[d.id] || null));
  const unitAssignments = partitionContiguous(orderedUnits, orderedDrivers);

  const clusterMap = {};
  orderedUnits.forEach(unit => {
    const driverId = unitAssignments[unit.id];
    unit.recordIds.forEach(id => { clusterMap[id] = driverId; });
  });

  const dongDriverCount = {};
  assignableRecords.forEach(record => {
    const dong = getDong(record);
    const driverId = clusterMap[record.id];
    if (!dong || !driverId) return;
    if (!dongDriverCount[dong]) dongDriverCount[dong] = {};
    dongDriverCount[dong][driverId] = (dongDriverCount[dong][driverId] || 0) + 1;
  });

  noCoordRecs.forEach(record => {
    if (record.좌표검증상태 === '지자체벗어남') return;
    const dongVotes = dongDriverCount[getDong(record)];
    const driverId = dongVotes
      ? Object.entries(dongVotes).sort((a, b) => b[1] - a[1])[0]?.[0]
      : null;
    if (driverId) clusterMap[record.id] = driverId;
  });

  const allSource = allRecords || assignableRecords;
  allSource.forEach(record => {
    if (record.좌표검증상태 === '지자체벗어남' || clusterMap[record.id]) return;
    if (record._lat && record._lng) {
      let bestDriver = null;
      let bestDist = Infinity;
      orderedDrivers.forEach(driver => {
        const driverRecords = assignableRecords.filter(r => clusterMap[r.id] === driver.id);
        if (!driverRecords.length) return;
        const lat = driverRecords.reduce((s, r) => s + r._lat, 0) / driverRecords.length;
        const lng = driverRecords.reduce((s, r) => s + r._lng, 0) / driverRecords.length;
        const dist = haversine(record._lat, record._lng, lat, lng);
        if (dist < bestDist) { bestDist = dist; bestDriver = driver.id; }
      });
      if (bestDriver) clusterMap[record.id] = bestDriver;
    }
  });

  const currentLoads = {};
  activeDrivers.forEach(driver => { currentLoads[driver.id] = 0; });
  allSource.forEach(record => {
    const driverId = clusterMap[record.id];
    if (driverId) currentLoads[driverId] = (currentLoads[driverId] || 0) + getEffectiveLoad(record);
  });

  allSource.forEach(record => {
    if (record.좌표검증상태 === '지자체벗어남' || clusterMap[record.id]) return;
    const driver = [...activeDrivers].sort((a, b) => (currentLoads[a.id] || 0) - (currentLoads[b.id] || 0))[0];
    if (!driver) return;
    clusterMap[record.id] = driver.id;
    currentLoads[driver.id] = (currentLoads[driver.id] || 0) + getEffectiveLoad(record);
  });

  const diagnostics = buildDiagnostics({
    records: allSource.filter(r => clusterMap[r.id]),
    units,
    orderedUnits,
    clusterMap,
    activeDrivers,
    driverPins,
  });

  return { clusterMap, diagnostics };
};

self.onmessage = (e) => {
  const { type, ...payload } = e.data;
  if (type !== 'autoSplit') return;
  try {
    const { clusterMap, diagnostics } = computeAutoSplit(payload);
    self.postMessage({ type: 'autoSplitResult', clusterMap, diagnostics });
  } catch (err) {
    self.postMessage({ type: 'autoSplitError', message: err.message });
  }
};
