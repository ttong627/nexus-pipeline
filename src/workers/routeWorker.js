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

// ── 힐베르트 공간충전곡선 (2D → 1D, 지역성 보존 정렬용) ──────────────────
const hilbertXY2d = (n, inX, inY) => {
  let d = 0;
  let x = Math.floor(inX);
  let y = Math.floor(inY);
  for (let s = Math.floor(n / 2); s > 0; s = Math.floor(s / 2)) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      const tmp = x; x = y; y = tmp;
    }
  }
  return d;
};

const getHilbertIndex = (lat, lng, bounds, order = 12) => {
  const n = 1 << order; // 4096
  const { minLat, maxLat, minLng, maxLng } = bounds;
  const latSpan = maxLat - minLat || 1e-6;
  const lngSpan = maxLng - minLng || 1e-6;
  const xi = Math.min(n - 1, Math.max(0, Math.floor((lng - minLng) / lngSpan * n)));
  const yi = Math.min(n - 1, Math.max(0, Math.floor((lat - minLat) / latSpan * n)));
  return hilbertXY2d(n, xi, yi);
};

const orderUnitsByHilbert = (units) => {
  if (units.length <= 1) return units;
  const lats = units.map(u => u.lat);
  const lngs = units.map(u => u.lng);
  const bounds = {
    minLat: Math.min(...lats), maxLat: Math.max(...lats),
    minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
  };
  return [...units]
    .map(u => ({ ...u, _hilbert: getHilbertIndex(u.lat, u.lng, bounds) }))
    .sort((a, b) => a._hilbert - b._hilbert);
};

// ── N-seed 보로노이 배분 (seedVoronoi 전략) ───────────────────────────────────
// 1) 초기 씨앗: 핀 있으면 핀, 없으면 PCA 분할 중심
// 2) E-step: 각 unit → 최근접 씨앗 (행정동·도로측면 패널티 적용)
// 3) M-step: 경계 unit 이동으로 부담 균형 보정
// 4) 씨앗 갱신 (핀 없는 기사만)
// 5) 수렴 확인 후 BFS 섬 흡수 (최대 10회)
const computeSeedVoronoi = (units, orderedDrivers, driverPins) => {
  const k = orderedDrivers.length;
  if (k === 0 || units.length === 0) return {};
  if (k === 1) return Object.fromEntries(units.map(u => [u.id, orderedDrivers[0].id]));

  // 목표 부담 (capacity 비례)
  const totalLoad = units.reduce((s, u) => s + u.load, 0) || 1;
  const caps = orderedDrivers.map(d => parseFloat(d.capacity) || 100);
  const totalCap = caps.reduce((s, c) => s + c, 0) || 1;
  const targetLoads = caps.map(c => totalLoad * c / totalCap);

  // 초기 씨앗: 핀 → 그대로, 핀 없으면 PCA 분할 중심
  const pcaOrdered = orderUnitsByRoad(units, orderedDrivers.map(d => driverPins[d.id] || null));
  const pcaAssign = partitionContiguous(pcaOrdered, orderedDrivers);
  const seeds = orderedDrivers.map((driver, i) => {
    const pin = driverPins[driver.id];
    if (pin) return { driverId: driver.id, lat: Number(pin.lat), lng: Number(pin.lng), fixed: true };
    const pcaUnits = units.filter(u => pcaAssign[u.id] === driver.id);
    if (!pcaUnits.length) return { driverId: driver.id, lat: units[0].lat, lng: units[0].lng, fixed: false };
    const tl = pcaUnits.reduce((s, u) => s + u.load, 0) || 1;
    return {
      driverId: driver.id,
      lat: pcaUnits.reduce((s, u) => s + u.lat * u.load, 0) / tl,
      lng: pcaUnits.reduce((s, u) => s + u.lng * u.load, 0) / tl,
      fixed: false,
    };
  });

  let assign = {};
  let prevAssignStr = '';

  for (let iter = 0; iter < 15; iter++) {
    // dominance 계산 (행정동·도로측면 패널티용)
    const dongDominant = {};
    const roadDominant = {};
    units.forEach(u => {
      const did = assign[u.id];
      if (!did) return;
      if (u.dong) {
        if (!dongDominant[u.dong]) dongDominant[u.dong] = {};
        dongDominant[u.dong][did] = (dongDominant[u.dong][did] || 0) + u.load;
      }
      if (u.roadKey) {
        if (!roadDominant[u.roadKey]) roadDominant[u.roadKey] = {};
        roadDominant[u.roadKey][did] = (roadDominant[u.roadKey][did] || 0) + u.load;
      }
    });
    const getDominant = (map, key) => {
      if (!map[key]) return null;
      return Object.entries(map[key]).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    };

    // E-step: 최근접 씨앗 배정
    const newAssign = {};
    units.forEach(u => {
      let bestId = seeds[0].driverId, bestDist = Infinity;
      seeds.forEach(seed => {
        const base = haversine(u.lat, u.lng, seed.lat, seed.lng);
        let pen = 0;
        const dongDom = getDominant(dongDominant, u.dong);
        if (u.dong && dongDom && dongDom !== seed.driverId) pen += base * 0.15;
        const roadDom = getDominant(roadDominant, u.roadKey);
        if (u.roadKey && roadDom && roadDom !== seed.driverId) pen += base * 0.10;
        const dist = base + pen;
        if (dist < bestDist) { bestDist = dist; bestId = seed.driverId; }
      });
      newAssign[u.id] = bestId;
    });

    // M-step: 경계 unit 이동으로 부담 균형 보정 (최대 5회 반복)
    const driverLoads = {};
    orderedDrivers.forEach(d => { driverLoads[d.id] = 0; });
    units.forEach(u => {
      if (newAssign[u.id]) driverLoads[newAssign[u.id]] = (driverLoads[newAssign[u.id]] || 0) + u.load;
    });

    for (let bal = 0; bal < 5; bal++) {
      let moved = false;
      for (let i = 0; i < orderedDrivers.length; i++) {
        const over = orderedDrivers[i];
        if ((driverLoads[over.id] || 0) <= targetLoads[i] * 1.05) continue;
        for (let j = 0; j < orderedDrivers.length; j++) {
          if (i === j) continue;
          const under = orderedDrivers[j];
          if ((driverLoads[under.id] || 0) >= targetLoads[j] * 0.95) continue;
          const underSeed = seeds.find(s => s.driverId === under.id);
          const overSeed = seeds.find(s => s.driverId === over.id);
          if (!underSeed || !overSeed) continue;
          const candidates = units
            .filter(u => newAssign[u.id] === over.id && !u.mandatory)
            .map(u => ({ u, du: haversine(u.lat, u.lng, underSeed.lat, underSeed.lng), do: haversine(u.lat, u.lng, overSeed.lat, overSeed.lng) }))
            .filter(c => c.du < c.do * 1.5)
            .sort((a, b) => a.du - b.du);
          for (const { u, u: unit } of candidates) {
            const ml = unit.load;
            const no = (driverLoads[over.id] || 0) - ml;
            const nu = (driverLoads[under.id] || 0) + ml;
            if (no >= targetLoads[i] * 0.85 && nu <= targetLoads[j] * 1.15) {
              newAssign[unit.id] = under.id;
              driverLoads[over.id] -= ml;
              driverLoads[under.id] += ml;
              moved = true;
              break;
            }
          }
          if (moved) break;
        }
        if (moved) break;
      }
      if (!moved) break;
    }

    assign = newAssign;

    // 씨앗 갱신 (핀 없는 기사만)
    seeds.forEach((seed, i) => {
      if (seed.fixed) return;
      const assigned = units.filter(u => assign[u.id] === seed.driverId);
      if (!assigned.length) return;
      const tl = assigned.reduce((s, u) => s + u.load, 0) || 1;
      seeds[i] = { ...seed, lat: assigned.reduce((s, u) => s + u.lat * u.load, 0) / tl, lng: assigned.reduce((s, u) => s + u.lng * u.load, 0) / tl };
    });

    const assignStr = JSON.stringify(assign);
    if (assignStr === prevAssignStr) break;
    prevAssignStr = assignStr;
  }

  // BFS 섬 흡수: 고립 컴포넌트 → 인근 최다 기사에게 재배정 (최대 10회)
  const ADJ = 400;
  for (let fixIter = 0; fixIter < 10; fixIter++) {
    let fixed = false;
    orderedDrivers.forEach(driver => {
      const dUnits = units.filter(u => assign[u.id] === driver.id);
      if (dUnits.length <= 1) return;
      const visited = new Set();
      const components = [];
      dUnits.forEach(start => {
        if (visited.has(start.id)) return;
        const comp = [];
        const q = [start];
        visited.add(start.id);
        while (q.length) {
          const cur = q.shift();
          comp.push(cur);
          dUnits.forEach(other => {
            if (!visited.has(other.id) && haversine(cur.lat, cur.lng, other.lat, other.lng) <= ADJ) {
              visited.add(other.id); q.push(other);
            }
          });
        }
        components.push(comp);
      });
      if (components.length <= 1) return;
      const mainLoad = c => c.reduce((s, u) => s + u.load, 0);
      components.sort((a, b) => mainLoad(b) - mainLoad(a));
      components.slice(1).forEach(comp => {
        comp.forEach(island => {
          if (island.mandatory) return;
          const votes = {};
          units.forEach(other => {
            if (other.id === island.id) return;
            const d = haversine(island.lat, island.lng, other.lat, other.lng);
            if (d > 500) return;
            const oid = assign[other.id];
            if (!oid || oid === driver.id) return;
            votes[oid] = (votes[oid] || 0) + (500 - d) * other.load;
          });
          const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
          if (best) { assign[island.id] = best; fixed = true; }
        });
      });
    });
    if (!fixed) break;
  }

  return Object.fromEntries(units.map(u => [u.id, assign[u.id] || orderedDrivers[0].id]));
};

// ── 통계 계산 ────────────────────────────────────────────────────────────────
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

// ── qualityScore 계산 (0–100, 높을수록 좋음) ─────────────────────────────
const calcQualityScore = ({
  splitUnitCount, totalMandatoryUnits,
  islandCount, totalDrivers,
  mixedUnitCount, totalUnits,
  maxAbsDiffPct,
  roadSideMixCount, totalRoadUnits,
  forcedAssignCount, totalRecords,
}) => {
  const s = (num, den) => num / Math.max(1, den);
  const raw = 100
    - 25 * s(splitUnitCount, totalMandatoryUnits)
    - 20 * s(islandCount, totalDrivers)
    - 20 * s(mixedUnitCount, totalUnits)
    - 15 * (maxAbsDiffPct / 100)
    - 10 * s(roadSideMixCount, totalRoadUnits)
    - 10 * s(forcedAssignCount, totalRecords);
  return Math.round(Math.max(0, Math.min(100, raw)));
};

// ── 14개 진단 항목 ────────────────────────────────────────────────────────
const buildDiagnostics = ({ records, units, orderedUnits, clusterMap, activeDrivers, driverPins, strategy = 'pca', forcedAssignCount = 0, coordFailCount = 0 }) => {
  const load = calculateStats(records, clusterMap, activeDrivers);

  // ── 도로 통계 (기존 8개 + 도로측면 순수도) ───────────────────────────────
  const roadMap = {};
  orderedUnits.forEach(unit => {
    const label = unit.roadLabel || '도로명 미확인';
    const roadKey = unit.roadKey || '';
    if (!roadMap[label]) roadMap[label] = { label, roadKey, qty: 0, load: 0, count: 0, drivers: new Set(), sides: new Set() };
    unit.records.forEach(record => {
      roadMap[label].qty += getQty(record);
      roadMap[label].load += getEffectiveLoad(record);
      roadMap[label].count += 1;
      if (clusterMap[record.id]) {
        roadMap[label].drivers.add(clusterMap[record.id]);
        roadMap[label].sides.add(unit.roadKey);
      }
    });
  });
  const roadStats = Object.values(roadMap)
    .map(r => ({ ...r, load: Math.round(r.load * 10) / 10, driverCount: r.drivers.size, drivers: undefined, sides: undefined }))
    .sort((a, b) => b.load - a.load)
    .slice(0, 8);

  const mixedRoads = roadStats.filter(r => r.driverCount > 1).length;

  // ── 도로측면 순수도 (같은 도로 홀수/짝수 측면이 다른 기사에 배정된 수) ──
  const roadSideMap = {};
  orderedUnits.forEach(unit => {
    if (!unit.roadKey || !unit.roadKey.startsWith('road-side:')) return;
    const baseRoad = unit.roadKey.replace(/:(?:좌측|우측)\([^)]*\)$/, '');
    if (!roadSideMap[baseRoad]) roadSideMap[baseRoad] = new Set();
    unit.records.forEach(r => {
      if (clusterMap[r.id]) roadSideMap[baseRoad].add(clusterMap[r.id]);
    });
  });
  const roadSideMixCount = Object.values(roadSideMap).filter(s => s.size > 1).length;
  const totalRoadUnits = Object.keys(roadSideMap).length;

  // ── 배송단위 분리 수 (mandatory 단위가 2기사로 갈라진 것) ─────────────────
  // splitUnitCount: 아파트/동일주소 단위가 여러 기사로 분리된 수
  let splitUnitCount = 0;
  units.forEach(unit => {
    if (!unit.mandatory) return;
    const assigned = new Set(unit.recordIds.map(id => clusterMap[id]).filter(Boolean));
    if (assigned.size > 1) splitUnitCount++;
  });

  // ── 구역 고립 섬 탐지 (islandCount) ─────────────────────────────────────
  // 각 기사 구역에서 BFS로 연결 컴포넌트 수 확인, 2개 이상이면 섬 존재
  const ISLAND_RADIUS = 400; // 400m 이내를 "인접"으로 판단
  let islandCount = 0;
  activeDrivers.forEach(driver => {
    const driverRecs = records.filter(r => clusterMap[r.id] === driver.id && r._lat && r._lng);
    if (driverRecs.length <= 1) return;
    const visited = new Set();
    let components = 0;
    driverRecs.forEach(rec => {
      if (visited.has(rec.id)) return;
      components++;
      const queue = [rec];
      visited.add(rec.id);
      while (queue.length) {
        const cur = queue.shift();
        driverRecs.forEach(other => {
          if (visited.has(other.id)) return;
          if (haversine(cur._lat, cur._lng, other._lat, other._lng) <= ISLAND_RADIUS) {
            visited.add(other.id);
            queue.push(other);
          }
        });
      }
    });
    if (components > 1) islandCount++;
  });

  // ── 섬 혼재 단위 (mixedUnitCount): 인접 기사 구역에 고립된 배송단위 ──────
  // splitUnitCount와 구분: 단위 자체는 분리 안 됐지만 지리적으로 다른 기사 구역에 섬처럼 있는 것
  const MIXED_RADIUS = 200;
  let mixedUnitCount = 0;
  orderedUnits.forEach(unit => {
    const unitDriver = clusterMap[unit.recordIds[0]];
    if (!unitDriver || !unit.lat || !unit.lng) return;
    let sameCount = 0, otherCount = 0;
    orderedUnits.forEach(other => {
      if (other.id === unit.id) return;
      const otherDriver = clusterMap[other.recordIds[0]];
      if (!otherDriver || !other.lat || !other.lng) return;
      if (haversine(unit.lat, unit.lng, other.lat, other.lng) > MIXED_RADIUS) return;
      if (otherDriver === unitDriver) sameCount++;
      else otherCount++;
    });
    if (otherCount > sameCount && otherCount >= 2) mixedUnitCount++;
  });

  // ── 행정동 순수도 (dongPurity) ────────────────────────────────────────────
  const dongMap = {};
  records.forEach(r => {
    const dong = getDong(r);
    if (!dong) return;
    if (!dongMap[dong]) dongMap[dong] = new Set();
    if (clusterMap[r.id]) dongMap[dong].add(clusterMap[r.id]);
  });
  const dongPurity = {
    total: Object.keys(dongMap).length,
    pure: Object.values(dongMap).filter(s => s.size === 1).length,
    mixed: Object.values(dongMap).filter(s => s.size > 1).length,
    matrix: Object.entries(dongMap).map(([dong, drivers]) => ({ dong, driverCount: drivers.size })).sort((a, b) => b.driverCount - a.driverCount).slice(0, 10),
  };

  // ── 아파트/단독 비율 ──────────────────────────────────────────────────────
  const aptRatio = {};
  activeDrivers.forEach(d => { aptRatio[d.id] = { apt: 0, total: 0, name: d.name }; });
  records.forEach(r => {
    const did = clusterMap[r.id];
    if (!did || !aptRatio[did]) return;
    aptRatio[did].total++;
    if (isApartmentLike(r)) aptRatio[did].apt++;
  });
  const aptRatioStats = Object.values(aptRatio).map(s => ({
    name: s.name,
    aptPct: s.total > 0 ? Math.round(s.apt / s.total * 100) : 0,
  }));

  // ── 경계 유닛 수 (boundaryUnitCount) ─────────────────────────────────────
  const BOUNDARY_RADIUS = 150;
  let boundaryUnitCount = 0;
  orderedUnits.forEach(unit => {
    const unitDriver = clusterMap[unit.recordIds[0]];
    if (!unitDriver || !unit.lat || !unit.lng) return;
    const hasBoundaryNeighbor = orderedUnits.some(other => {
      if (other.id === unit.id) return false;
      const otherDriver = clusterMap[other.recordIds[0]];
      return otherDriver && otherDriver !== unitDriver && other.lat && other.lng
        && haversine(unit.lat, unit.lng, other.lat, other.lng) <= BOUNDARY_RADIUS;
    });
    if (hasBoundaryNeighbor) boundaryUnitCount++;
  });

  // ── 대형단지 경계 여부 ────────────────────────────────────────────────────
  const largeCplexOnBoundary = [];
  const aptGroups = {};
  units.forEach(unit => {
    if (!unit.key.startsWith('apt:') && !unit.key.startsWith('apt-road:') && !unit.key.startsWith('apt-building:')) return;
    if (!aptGroups[unit.key]) aptGroups[unit.key] = { key: unit.key, qty: 0, drivers: new Set() };
    aptGroups[unit.key].qty += unit.qty;
    const did = clusterMap[unit.recordIds[0]];
    if (did) aptGroups[unit.key].drivers.add(did);
  });
  Object.values(aptGroups).forEach(g => {
    if (g.qty >= 50 && g.drivers.size > 1) largeCplexOnBoundary.push({ key: g.key, qty: g.qty, driverCount: g.drivers.size });
  });

  // ── qualityScore ──────────────────────────────────────────────────────────
  const totalMandatoryUnits = units.filter(u => u.mandatory).length;
  const totalUnits = units.length;
  const totalRecords = records.length;
  const qualityScore = calcQualityScore({
    splitUnitCount, totalMandatoryUnits,
    islandCount, totalDrivers: activeDrivers.length,
    mixedUnitCount, totalUnits,
    maxAbsDiffPct: load.maxAbsDiffPct,
    roadSideMixCount, totalRoadUnits,
    forcedAssignCount, totalRecords,
  });

  // ── 이슈 메시지 ──────────────────────────────────────────────────────────
  const hasPins = activeDrivers.every(d => driverPins?.[d.id]);
  const issues = [];
  if (splitUnitCount > 0) issues.push(`아파트/동일주소 배송단위 ${splitUnitCount}개가 여러 기사로 분리됐습니다. 대형단지 분할 또는 수동 조정이 필요합니다.`);
  if (islandCount > 0) issues.push(`${islandCount}명의 기사 구역이 지리적으로 분리됐습니다(섬 존재). 브러시로 경계를 정리하세요.`);
  if (load.maxAbsDiffPct > 25) issues.push(`기사별 유효부담 편차가 최대 ${load.maxAbsDiffPct}%입니다.`);
  if (mixedRoads > 0) issues.push(`${mixedRoads}개 주요 도로가 여러 기사에게 나뉘었습니다.`);
  if (roadSideMixCount > 0) issues.push(`${roadSideMixCount}개 도로의 홀수/짝수 측면이 다른 기사에게 배정됐습니다.`);
  if (!hasPins && activeDrivers.length >= 2) issues.push('핀이 없어 도로 연속성 기준으로 자동 분할했습니다. 핀을 꽂으면 경계가 더 명확해집니다.');
  if (largeCplexOnBoundary.length > 0) issues.push(`대형단지 ${largeCplexOnBoundary.length}개가 구역 경계에 걸쳐있습니다.`);

  return {
    strategy,
    qualityScore,
    load,
    roadStats,
    splitUnitCount,
    mixedUnitCount,
    islandCount,
    roadSideMixCount,
    boundaryUnitCount,
    forcedAssignCount,
    coordFailCount,
    dongPurity,
    aptRatioStats,
    largeCplexOnBoundary,
    unitCount: totalUnits,
    mandatoryUnitCount: totalMandatoryUnits,
    hasPins,
    issues,
    guide: [
      '아파트와 동일 주소는 하나의 배정 단위로 묶어 처리했습니다.',
      '도로 본번 홀수=좌측, 짝수=우측 기준으로 같은 측면이 이어지도록 정렬했습니다.',
      'capacity 비율에 맞춰 연속 구간을 분할하여 유효부담을 맞춥니다.',
    ],
  };
};

// ── 각도 기반 구역 분할 (섞임 없음 보장) ────────────────────────────────────
// 중심점 기준 각도 정렬 후 capacity 비례 파이 섹터로 분할.
// partitionContiguous 재사용 → mandatory 단위 보호·부담 비례 동일 적용.
const computeAngularSplit = (units, orderedDrivers) => {
  if (!units.length || !orderedDrivers.length) return { cm: {}, ordered: units };
  if (orderedDrivers.length === 1) {
    const cm = {};
    units.forEach(u => u.recordIds.forEach(id => { cm[id] = orderedDrivers[0].id; }));
    return { cm, ordered: units };
  }

  const center = weightedCenter(units);
  const cosLat = Math.cos(center.lat * Math.PI / 180);
  const sorted = [...units].sort((a, b) =>
    Math.atan2(a.lat - center.lat, (a.lng - center.lng) * cosLat) -
    Math.atan2(b.lat - center.lat, (b.lng - center.lng) * cosLat)
  );

  const unitAssignments = partitionContiguous(sorted, orderedDrivers);
  const cm = {};
  sorted.forEach(unit => {
    const driverId = unitAssignments[unit.id];
    if (driverId) unit.recordIds.forEach(id => { cm[id] = driverId; });
  });
  return { cm, ordered: sorted };
};

// ── 행정동 그룹 분할 (포수 무관, 건수 균등, 동 경계 보존) ────────────────────
// 같은 행정동의 모든 배송단위는 반드시 같은 기사에게 배정.
// 동 그룹을 중심점 기준 각도 순으로 정렬 → 건수 균등하게 기사에게 배분.
// 포수(getEffectiveLoad)는 일절 사용하지 않음 — 포수 조정은 브러시 수동 조정으로.
const computeDongGroupSplit = (units, orderedDrivers) => {
  if (!units.length || !orderedDrivers.length) return { cm: {}, ordered: units };
  if (orderedDrivers.length === 1) {
    const cm = {};
    units.forEach(u => u.recordIds.forEach(id => { cm[id] = orderedDrivers[0].id; }));
    return { cm, ordered: units };
  }

  const center = weightedCenter(units);
  const cosLat = Math.cos(center.lat * Math.PI / 180);

  // 행정동별 그룹 생성 (dong 없는 unit은 unknownUnits로 분리)
  const dongMap = new Map();
  const unknownUnits = [];
  units.forEach(u => {
    const dong = u.dong;
    if (!dong) { unknownUnits.push(u); return; }
    if (!dongMap.has(dong)) dongMap.set(dong, { dong, units: [], totalCount: 0, totalLoad: 0 });
    const g = dongMap.get(dong);
    g.units.push(u);
    g.totalCount += u.count;
    g.totalLoad += u.load;
  });

  // dong 그룹이 없으면(전 레코드 dong 없음) angular fallback
  if (!dongMap.size) return computeAngularSplit(units, orderedDrivers);

  // 동 그룹 중심점 및 각도 계산
  dongMap.forEach(g => {
    const tl = g.totalLoad || 1;
    g.lat = g.units.reduce((s, u) => s + u.lat * u.load, 0) / tl;
    g.lng = g.units.reduce((s, u) => s + u.lng * u.load, 0) / tl;
    g.angle = Math.atan2(g.lat - center.lat, (g.lng - center.lng) * cosLat);
  });

  // 각도 순 정렬 — 인접 동끼리 같은 기사에게 배정되도록
  const sortedDongs = [...dongMap.values()].sort((a, b) => a.angle - b.angle);

  // 건수 균등 분할 (포수/capacity 무관)
  const totalCount = sortedDongs.reduce((s, g) => s + g.totalCount, 0);
  const N = orderedDrivers.length;
  const targetPerDriver = totalCount / N;
  const cm = {};
  let driverIdx = 0;
  let accumulated = 0;

  sortedDongs.forEach(g => {
    const driver = orderedDrivers[Math.min(driverIdx, N - 1)];
    g.units.forEach(u => u.recordIds.forEach(id => { cm[id] = driver.id; }));
    accumulated += g.totalCount;
    if (accumulated >= targetPerDriver * (driverIdx + 1) && driverIdx < N - 1) {
      driverIdx++;
    }
  });

  // dong 없는 unit → 각도가 가장 가까운 동 그룹의 기사에게 배정
  if (unknownUnits.length > 0) {
    const dongAngleDriverMap = sortedDongs.map(g => ({
      angle: g.angle,
      driverId: cm[g.units[0].recordIds[0]],
    }));
    unknownUnits.forEach(u => {
      const uAngle = Math.atan2(u.lat - center.lat, (u.lng - center.lng) * cosLat);
      let best = dongAngleDriverMap[0]?.driverId || orderedDrivers[0].id;
      let bestDiff = Infinity;
      dongAngleDriverMap.forEach(({ angle, driverId }) => {
        const diff = Math.abs(uAngle - angle);
        const wrapped = Math.min(diff, 2 * Math.PI - diff);
        if (wrapped < bestDiff) { bestDiff = wrapped; best = driverId; }
      });
      u.recordIds.forEach(id => { cm[id] = best; });
    });
  }

  const ordered = [...sortedDongs.flatMap(g => g.units), ...unknownUnits];
  return { cm, ordered };
};

// ── 전략별 단위 정렬 ─────────────────────────────────────────────────────────
const VALID_STRATEGIES = new Set(['pca', 'hilbert', 'bestOfPcaHilbert', 'seedVoronoi', 'angular', 'dongGroup']);

const getOrderedUnits = (units, orderedDrivers, driverPins, strategy) => {
  const safeStrategy = VALID_STRATEGIES.has(strategy) ? strategy : 'pca';
  const pinList = orderedDrivers.map(d => driverPins[d.id] || null);

  if (safeStrategy === 'hilbert') {
    return orderUnitsByHilbert(units);
  }
  // pca, bestOfPcaHilbert, seedVoronoi(미구현) 모두 기본 pca 정렬 반환
  // bestOfPcaHilbert는 computeAutoSplit에서 두 전략을 비교해 선택
  return orderUnitsByRoad(units, pinList);
};

// ── 후처리 공통 로직 (좌표 없는 건, 미배정 강제배정) ────────────────────────
const applyFallbackAssignments = (assignableRecords, noCoordRecs, allSource, clusterMap, activeDrivers) => {
  let forcedCount = 0;

  // 행정동 투표 테이블 구성
  const dongDriverCount = {};
  assignableRecords.forEach(record => {
    const dong = getDong(record);
    const driverId = clusterMap[record.id];
    if (!dong || !driverId) return;
    if (!dongDriverCount[dong]) dongDriverCount[dong] = {};
    dongDriverCount[dong][driverId] = (dongDriverCount[dong][driverId] || 0) + 1;
  });

  // 좌표 없는 건 → 행정동 최다배정 기사
  noCoordRecs.forEach(record => {
    if (record.좌표검증상태 === '지자체벗어남') return;
    const dongVotes = dongDriverCount[getDong(record)];
    const driverId = dongVotes
      ? Object.entries(dongVotes).sort((a, b) => b[1] - a[1])[0]?.[0]
      : null;
    if (driverId) { clusterMap[record.id] = driverId; forcedCount++; }
  });

  // 좌표 있지만 미배정 → 가장 가까운 기사 클러스터 중심
  allSource.forEach(record => {
    if (record.좌표검증상태 === '지자체벗어남' || clusterMap[record.id]) return;
    if (record._lat && record._lng) {
      let bestDriver = null, bestDist = Infinity;
      activeDrivers.forEach(driver => {
        const driverRecs = assignableRecords.filter(r => clusterMap[r.id] === driver.id);
        if (!driverRecs.length) return;
        const lat = driverRecs.reduce((s, r) => s + r._lat, 0) / driverRecs.length;
        const lng = driverRecs.reduce((s, r) => s + r._lng, 0) / driverRecs.length;
        const dist = haversine(record._lat, record._lng, lat, lng);
        if (dist < bestDist) { bestDist = dist; bestDriver = driver.id; }
      });
      if (bestDriver) { clusterMap[record.id] = bestDriver; forcedCount++; }
    }
  });

  // R-A: 완전 미배정 → 유효부담 최소 기사 강제 배정
  const currentLoads = {};
  activeDrivers.forEach(d => { currentLoads[d.id] = 0; });
  allSource.forEach(r => {
    const did = clusterMap[r.id];
    if (did) currentLoads[did] = (currentLoads[did] || 0) + getEffectiveLoad(r);
  });
  allSource.forEach(record => {
    if (record.좌표검증상태 === '지자체벗어남' || clusterMap[record.id]) return;
    const driver = [...activeDrivers].sort((a, b) => (currentLoads[a.id] || 0) - (currentLoads[b.id] || 0))[0];
    if (!driver) return;
    clusterMap[record.id] = driver.id;
    currentLoads[driver.id] = (currentLoads[driver.id] || 0) + getEffectiveLoad(record);
    forcedCount++;
  });

  return forcedCount;
};

// ── 핵심 배분 함수 ────────────────────────────────────────────────────────────
const computeAutoSplit = ({ target, noCoordRecs = [], allRecords, activeDrivers, driverPins = {}, strategy = 'pca' }) => {
  const safeStrategy = VALID_STRATEGIES.has(strategy) ? strategy : 'pca';
  const assignableRecords = target.filter(r => r._lat && r._lng && r.좌표검증상태 !== '지자체벗어남');
  const coordFailCount = target.length - assignableRecords.length + noCoordRecs.filter(r => r.좌표검증상태 === '지자체벗어남').length;

  // 절대 원칙: 입력 단위는 항상 buildUnits() 출력
  const units = buildUnits(assignableRecords);
  const orderedDrivers = getDriverOrder(activeDrivers, driverPins);
  const allSource = allRecords || assignableRecords;

  const runStrategy = (strat) => {
    const ordered = getOrderedUnits(units, orderedDrivers, driverPins, strat);
    const unitAssignments = partitionContiguous(ordered, orderedDrivers);
    const cm = {};
    ordered.forEach(unit => {
      const driverId = unitAssignments[unit.id];
      unit.recordIds.forEach(id => { cm[id] = driverId; });
    });
    return { cm, ordered };
  };

  let chosenStrategy = safeStrategy;
  let clusterMap, orderedUnits;

  if (safeStrategy === 'bestOfPcaHilbert') {
    // 두 전략 모두 실행 후 qualityScore 비교 — 에릭: 이 전략일 때만 두 번 계산
    const pca = runStrategy('pca');
    const hil = runStrategy('hilbert');

    const tempMapPca = { ...pca.cm };
    const tempMapHil = { ...hil.cm };
    applyFallbackAssignments(assignableRecords, noCoordRecs, allSource, tempMapPca, activeDrivers);
    applyFallbackAssignments(assignableRecords, noCoordRecs, allSource, tempMapHil, activeDrivers);

    const statsPca = calculateStats(allSource.filter(r => tempMapPca[r.id]), tempMapPca, activeDrivers);
    const statsHil = calculateStats(allSource.filter(r => tempMapHil[r.id]), tempMapHil, activeDrivers);

    // 간이 비교: 부담 편차 기준 (diagnostics 없이 빠르게)
    if (statsHil.maxAbsDiffPct < statsPca.maxAbsDiffPct) {
      chosenStrategy = 'hilbert';
      clusterMap = pca.cm; // 아직 fallback 미적용 상태 — 아래에서 다시 적용
      orderedUnits = hil.ordered;
      // hilbert 결과로 교체
      Object.keys(clusterMap).forEach(k => delete clusterMap[k]);
      hil.ordered.forEach(unit => {
        const did = partitionContiguous(hil.ordered, orderedDrivers)[unit.id];
        if (did) unit.recordIds.forEach(id => { clusterMap[id] = did; });
      });
      // 재실행이 중복되므로 hil.cm 사용
      Object.assign(clusterMap, hil.cm);
      orderedUnits = hil.ordered;
    } else {
      chosenStrategy = 'pca';
      clusterMap = pca.cm;
      orderedUnits = pca.ordered;
    }
  } else if (safeStrategy === 'seedVoronoi') {
    const voronoiAssign = computeSeedVoronoi(units, orderedDrivers, driverPins);
    clusterMap = {};
    units.forEach(unit => {
      const driverId = voronoiAssign[unit.id] || orderedDrivers[0].id;
      unit.recordIds.forEach(id => { clusterMap[id] = driverId; });
    });
    orderedUnits = units; // 보로노이는 1D 정렬 불필요 — units 그대로 사용
  } else if (safeStrategy === 'angular') {
    const { cm, ordered } = computeAngularSplit(units, orderedDrivers);
    clusterMap = cm;
    orderedUnits = ordered;
  } else if (safeStrategy === 'dongGroup') {
    const { cm, ordered } = computeDongGroupSplit(units, orderedDrivers);
    clusterMap = cm;
    orderedUnits = ordered;
  } else {
    const result = runStrategy(safeStrategy);
    clusterMap = result.cm;
    orderedUnits = result.ordered;
  }

  const forcedAssignCount = applyFallbackAssignments(
    assignableRecords, noCoordRecs, allSource, clusterMap, activeDrivers
  );

  const diagnostics = buildDiagnostics({
    records: allSource.filter(r => clusterMap[r.id]),
    units,
    orderedUnits,
    clusterMap,
    activeDrivers,
    driverPins,
    strategy: chosenStrategy,
    forcedAssignCount,
    coordFailCount,
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
