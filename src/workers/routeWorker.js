// Route Worker — K-means + 후처리 순수 계산 (메인 스레드 블로킹 0)
// 메인 스레드에서: new Worker(new URL('./routeWorker.js', import.meta.url))

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

const extractAptName = (addr) => {
  if (!addr) return null;
  const m = addr.match(/^(.+?)\s*\d+\s*동\s*\d+\s*호/);
  if (m) return m[1].trim();
  const m2 = addr.match(/^(.+?(?:아파트|아파|APT|apt))/i);
  if (m2) return m2[1].trim();
  return null;
};

const kMeansCluster = (points, drivers, iterations = 30, pinCentroids = null) => {
  const k = drivers.length;
  if (!points.length || k === 0) return {};
  if (k === 1) return Object.fromEntries(points.map(p => [p.id, drivers[0].id]));

  const caps = drivers.map(d => parseFloat(d.capacity) || 100);
  const totalCap = caps.reduce((s, c) => s + c, 0);
  const totalEffLoad = points.reduce((s, p) => s + (p._effectiveLoad || 1), 0);
  const targetLoads = caps.map(c => totalEffLoad * c / totalCap);

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

  const updateLoadFactors = (clusters, prev) =>
    clusters.map((pts, i) => {
      const cur = pts.reduce((s, p) => s + (p._effectiveLoad || 1), 0);
      const raw = cur > 0 ? Math.max(0.6, Math.min(1.4, targetLoads[i] / cur)) : 1.0;
      return prev[i] * 0.6 + raw * 0.4;
    });

  if (pinCentroids && pinCentroids.length === k && pinCentroids.every(c => c)) {
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

  for (let iter = 0; iter < iterations; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    points.forEach(p => { clusters[bestGeo(p, centroids)].push(p); });
    centroids.forEach((c, i) => {
      if (!clusters[i].length) return;
      c.lat = clusters[i].reduce((s, p) => s + p._lat, 0) / clusters[i].length;
      c.lng = clusters[i].reduce((s, p) => s + p._lng, 0) / clusters[i].length;
    });
  }

  let loadFactors = new Array(k).fill(1.0);
  for (let iter = 0; iter < 10; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    points.forEach(p => { clusters[bestBalanced(p, centroids, loadFactors)].push(p); });
    loadFactors = updateLoadFactors(clusters, loadFactors);
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

// 전체 autoSplit 계산 (K-means + 후처리 R-I, R-E, R-A, 스무딩)
const computeAutoSplit = ({ target, noCoordRecs, allWithLoad, filteredRecords, activeDrivers, driverPins }) => {
  const withLoad = target.map(r => ({ ...r, _effectiveLoad: getEffectiveLoad(r) }));
  const pinCentroids = activeDrivers.map(d => driverPins[d.id] || null);
  const clusterMap = kMeansCluster(
    withLoad, activeDrivers, 30,
    pinCentroids.every(c => c) ? pinCentroids : null
  );

  // 좌표 없는 레코드 → 같은 행정동 최다배정 기사
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

  // 이웃 그래프 1회 계산
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

  runSmoothing(20, Math.ceil(K_SMOOTH * 0.5));

  // R-I: 아파트 단지 동일 기사 통일
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

  // R-E: 동일 주소 동일 기사 통일
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

  runSmoothing(15, Math.ceil(K_SMOOTH * 0.6));

  // R-A: 전건 배정 보장
  const loads = {};
  activeDrivers.forEach(d => { loads[d.id] = 0; });
  allWithLoad.forEach(r => {
    if (clusterMap[r.id]) loads[clusterMap[r.id]] = (loads[clusterMap[r.id]] || 0) + (r._effectiveLoad || 1);
  });

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

  filteredRecords.filter(r => !clusterMap[r.id]).forEach(r => {
    const driverId = (r._lat && r._lng) ? nearestDriverId(r._lat, r._lng)
      : activeDrivers.slice().sort((a, b) => (loads[a.id] || 0) - (loads[b.id] || 0))[0]?.id;
    if (driverId) { clusterMap[r.id] = driverId; loads[driverId] = (loads[driverId] || 0) + (r._effectiveLoad || 1); }
  });

  return clusterMap;
};

self.onmessage = (e) => {
  const { type, ...payload } = e.data;
  if (type === 'autoSplit') {
    try {
      const clusterMap = computeAutoSplit(payload);
      self.postMessage({ type: 'autoSplitResult', clusterMap });
    } catch (err) {
      self.postMessage({ type: 'autoSplitError', message: err.message });
    }
  }
};
