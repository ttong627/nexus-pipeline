// 배송순번 계산 순수 함수 — RouteMapModal.jsx 모듈스코프(22~1078줄)에서 그대로 포팅.
// 함수 본문은 한 글자도 변경하지 않았다(현재 운영 알고리즘 100% 재현 목적).
// Node/브라우저 양쪽에서 import 가능한 자족적 ESM 모듈.

// Node/브라우저 양쪽 안전한 KAKAO_REST_KEY (시뮬은 useApi=false라 미사용)
const KAKAO_REST_KEY = (typeof import.meta !== 'undefined' && import.meta.env)
  ? import.meta.env.VITE_KAKAO_REST_KEY
  : (process.env.VITE_KAKAO_REST_KEY || '');

// DS-14: 배송 예상속도 (정차·엘리베이터·인터폰 포함 도심 평균)
export const SEQUENCE_ESTIMATED_SPEED_KMH = 10;

export const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const parseAptDong = (addr) => {
  const text = String(addr || '');
  const m = text.match(/(?:^|[\s,(])(\d{1,4})\s*동(?:[\s,)]|$)/) || text.match(/(?:^|[\s,(])(\d{3,4})\s*[-]\s*\d{1,4}\s*호?/);
  return m ? parseInt(m[1], 10) : null;
};
export const parseFloorHo = (addr) => {
  const floor = addr?.match(/(\d+)\s*층/)?.[1] || '0';
  const ho = addr?.match(/(\d+)\s*호/)?.[1] || '0';
  return { floor: parseInt(floor), ho: parseInt(ho) };
};

// DS-12: 호수에서 층 번호 추론 (양수=지상, 음수=지하, null=추론불가)
export const parseInferredFloor = (text) => {
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

// 주소에서 순수 도로명 추출: 괄호 밖 ","까지, 없으면 마지막 ")"까지
// (getAptGroupMeta / getSequenceAddress 의존 헬퍼 — 모듈스코프 78줄)
export const extractRoadAddress = (addr) => {
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

// ── 유효부담 자동 감지 상수 ──────────────────────────────────────────────────
export const RENTAL_KEYWORDS = ['LH', 'SH', '임대', '행복주택', '국민임대', '영구임대', '공공임대', '보금자리', '매입임대'];
export const STAIRS_KEYWORDS = ['빌라', '연립', '다세대', '단독주택'];
export const HEAVY_NOTE_KW   = ['문앞', '거동불편', '직접전달', '현관앞', '직접'];
export const MEDIUM_NOTE_KW  = ['전화필수', '골목', '경비실', '게이트'];

export const getEffectiveLoad = (record) => {
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

export const normalizeAptGroupPart = (value) =>
  String(value || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[()]/g, '')
    .trim();

export const APT_LIKE_RE = /아파트|APT|Apartment|주공|휴먼시아|휴먼시아|뜨란채|마을|단지|타운|빌리지|하이츠|아이파크|자이|래미안|푸르지오|힐스테이트|롯데캐슬|더샵|e편한세상|이편한세상|센트럴|리버|파크|LH|SH|임대|행복주택|국민임대|영구임대|공공임대|매입임대/i;
export const RENTAL_LIKE_RE = /LH|SH|임대|행복주택|국민임대|영구임대|공공임대|보금자리|매입임대|주공|휴먼시아|뜨란채/i;

export const getRecordSearchText = (record) => [
  record?.주소,
  record?.특이사항,
  record?._buildingName,
  record?.buildingName,
  record?._standardRoadAddress,
  record?.standardRoadAddress,
  record?._routeHints?.apartmentGroupKey,
  record?.routeHints?.apartmentGroupKey,
].filter(Boolean).join(' ');

export const isApartmentLike = (record) => {
  if (!record) return false;
  if (record._isApt || record.isApt) return true;
  if (record?._routeHints?.apartmentGroupKey || record?.routeHints?.apartmentGroupKey) return true;
  return APT_LIKE_RE.test(getRecordSearchText(record));
};

export const isRentalLike = (record) => RENTAL_LIKE_RE.test(getRecordSearchText(record));

export const extractBuildingName = (addr) => {
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
export const getAptGroupMeta = (record) => {
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

// getSequenceUnitMeta 의존 헬퍼 — 모듈스코프 339줄
export const getSideLabel = (side) => {
  if (side === 'left') return '좌측(홀수)';
  if (side === 'right') return '우측(짝수)';
  return '양측/골목';
};

// ── 도로명 파싱 헬퍼 ─────────────────────────────────────────────────────
export const parseRoadInfo = (addr) => {
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

export const getSequenceAddress = (record) =>
  record?._standardRoadAddress ||
  record?.standardRoadAddress ||
  record?._addressKey ||
  extractRoadAddress(record?.주소 || '') ||
  record?.주소 ||
  '';

export const getSequenceUnitMeta = (record) => {
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

export const sortSequenceUnitRecords = (records) => {
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

export const buildSequenceUnits = (records) => {
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

export const getUnitStraightDistance = (from, to) => {
  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) return Infinity;
  return haversine(from.lat, from.lng, to.lat, to.lng);
};

export const getUnitEdgeKey = (from, to) => [
  Number(from?.lat || 0).toFixed(5),
  Number(from?.lng || 0).toFixed(5),
  Number(to?.lat || 0).toFixed(5),
  Number(to?.lng || 0).toFixed(5),
].join(',');

export const getLocalRouteEdge = (from, to) => {
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

export const fetchKakaoDirectionsEdge = async (from, to, signal) => {
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

export const getAdvancedEdgeCost = async (from, to, cache, useApi = false) => {
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

export const scoreAdvancedEdge = (from, to, edge) => {
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

export const advancedRoadSequence = async (points, options = {}) => {
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
export const twoOptRoads = (roads) => {
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

// ── 도로 우선 순번: 한 도로를 끝까지 방문한 뒤 다음 도로로 이동 ─────────────
// 기존 구현은 도로의 홀/짝 측을 별도 TSP 단위로 다뤄, 가까운 옆 도로를 거친 뒤
// 같은 도로의 반대편으로 돌아오는 경우가 있었다. 도로 전체를 하나의 corridor로
// 묶고 한쪽 끝 → 반대쪽 끝의 뱀형 순서로 통과해 도로 재방문을 원천 차단한다.
export const getRoadStopKey = (record, roadInfo) => {
  const managedBuilding = record?._buildingMgtNo || record?.buildingMgtNo || record?._addressMgtNo || record?.addressMgtNo;
  // parseRoadInfo가 도로를 반환한 경우 건물번호는 항상 존재한다.
  const building = managedBuilding || `${roadInfo.num}-${roadInfo.sub || 0}`;
  return `${roadInfo.road}:${roadInfo.side || 'both'}:${building}`;
};

export const hasRouteCoord = (item) => {
  const lat = item?.lat ?? item?._lat;
  const lng = item?.lng ?? item?._lng;
  return lat !== null && lat !== undefined && lat !== ''
    && lng !== null && lng !== undefined && lng !== ''
    && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
};

export const getRouteCoord = (item) => {
  if (!hasRouteCoord(item)) return null;
  return { lat: Number(item.lat ?? item._lat), lng: Number(item.lng ?? item._lng) };
};

export const getRouteDistance = (from, to) => {
  const a = getRouteCoord(from);
  const b = getRouteCoord(to);
  return a && b ? haversine(a.lat, a.lng, b.lat, b.lng) : Infinity;
};

export const buildRoadCorridors = (points) => {
  const roads = new Map();
  const fallback = [];

  points.forEach(record => {
    const roadInfo = parseRoadInfo(getSequenceAddress(record));
    if (!roadInfo.road) {
      fallback.push(record);
      return;
    }
    if (!roads.has(roadInfo.road)) roads.set(roadInfo.road, new Map());
    const stops = roads.get(roadInfo.road);
    const key = getRoadStopKey(record, roadInfo);
    if (!stops.has(key)) stops.set(key, { key, roadInfo, records: [] });
    stops.get(key).records.push(record);
  });

  const corridors = [...roads.entries()].map(([road, stops]) => {
    const normalizedStops = [...stops.values()].map(stop => {
      const records = sortSequenceUnitRecords(stop.records);
      const withCoord = records.filter(record => hasRouteCoord(record));
      const load = withCoord.reduce((sum, record) => sum + getEffectiveLoad(record), 0) || withCoord.length || 1;
      const lat = withCoord.length
        ? withCoord.reduce((sum, record) => sum + Number(record._lat) * getEffectiveLoad(record), 0) / load
        : null;
      const lng = withCoord.length
        ? withCoord.reduce((sum, record) => sum + Number(record._lng) * getEffectiveLoad(record), 0) / load
        : null;
      return {
        ...stop,
        records,
        lat,
        lng,
        hasCoord: withCoord.length > 0,
      };
    });
    const withCoord = normalizedStops.filter(stop => stop.hasCoord);
    const weight = withCoord.length || 1;
    return {
      road,
      stops: normalizedStops,
      hasCoord: withCoord.length > 0,
      lat: withCoord.length ? withCoord.reduce((sum, stop) => sum + stop.lat, 0) / weight : null,
      lng: withCoord.length ? withCoord.reduce((sum, stop) => sum + stop.lng, 0) / weight : null,
    };
  });

  return { corridors, fallback };
};

export const compareRoadStops = (a, b) => {
  if (a.roadInfo.num !== b.roadInfo.num) return a.roadInfo.num - b.roadInfo.num;
  if (a.roadInfo.sub !== b.roadInfo.sub) return a.roadInfo.sub - b.roadInfo.sub;
  return a.key.localeCompare(b.key, 'ko', { numeric: true });
};

export const buildCorridorVariants = (corridor) => {
  const sides = { left: [], right: [], both: [] };
  corridor.stops.forEach(stop => sides[stop.roadInfo.side || 'both'].push(stop));
  Object.values(sides).forEach(stops => stops.sort(compareRoadStops));
  const asc = stops => [...stops];
  const desc = stops => [...stops].reverse();
  const variants = [];

  // 대로/로: 홀수·짝수를 각각 한 방향으로 훑고 반대편은 역방향으로 훑는다.
  if (sides.left.length && sides.right.length) {
    variants.push([...asc(sides.left), ...asc(sides.both), ...desc(sides.right)]);
    variants.push([...desc(sides.left), ...desc(sides.both), ...asc(sides.right)]);
    variants.push([...asc(sides.right), ...asc(sides.both), ...desc(sides.left)]);
    variants.push([...desc(sides.right), ...desc(sides.both), ...asc(sides.left)]);
  } else {
    // 길·주소 누락 등 방향이 없는 stop도 같은 도로 corridor에서 건물번호 순으로 처리한다.
    const oneWay = [...sides.left, ...sides.right, ...sides.both].sort(compareRoadStops);
    variants.push(asc(oneWay));
    variants.push(desc(oneWay));
  }

  const seen = new Set();
  return variants.filter(variant => {
    const key = variant.map(stop => stop.key).join('|');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const getVariantEndpoint = (variant, isLast = false) => {
  const stops = isLast ? [...variant].reverse() : variant;
  return stops.find(stop => stop.hasCoord) || null;
};

export const chooseCorridorVariant = (corridor, previous, next) => {
  const variants = buildCorridorVariants(corridor);
  if (variants.length <= 1) return variants[0] || [];
  let best = variants[0];
  let bestScore = Infinity;
  variants.forEach(variant => {
    const first = getVariantEndpoint(variant);
    const last = getVariantEndpoint(variant, true);
    const entry = previous ? getRouteDistance(previous, first) : (first ? -first.lat * 100000 : 0);
    // 다음 도로로 빠져나가기 좋은 방향을 함께 고려하되, 현재 도로의 연속 방문을 우선한다.
    const exit = next ? getRouteDistance(last, next) : 0;
    const score = (Number.isFinite(entry) ? entry : 0) + (Number.isFinite(exit) ? exit * 0.35 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = variant;
    }
  });
  return best;
};

export const appendRoadStop = (result, stop, previous) => {
  const forward = stop.records;
  const reverse = [...stop.records].reverse();
  const first = forward.find(record => hasRouteCoord(record));
  const last = [...forward].reverse().find(record => hasRouteCoord(record));
  const useReverse = previous && first && last && getRouteDistance(previous, last) < getRouteDistance(previous, first);
  const records = useReverse ? reverse : forward;
  result.push(...records);
  return [...records].reverse().find(record => hasRouteCoord(record)) || previous;
};

export const orderRoadCorridors = (corridors, startPoint) => {
  const coordCorridors = corridors.filter(corridor => corridor.hasCoord);
  const noCoordCorridors = corridors.filter(corridor => !corridor.hasCoord)
    .sort((a, b) => a.road.localeCompare(b.road, 'ko', { numeric: true }));
  if (!coordCorridors.length) return noCoordCorridors;

  const remaining = [...coordCorridors];
  const startIndex = startPoint
    ? remaining.reduce((best, corridor, index) => getRouteDistance(startPoint, corridor) < getRouteDistance(startPoint, remaining[best]) ? index : best, 0)
    : remaining.reduce((best, corridor, index) => corridor.lat > remaining[best].lat ? index : best, 0);
  const ordered = [remaining.splice(startIndex, 1)[0]];
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    const nextIndex = remaining.reduce((best, corridor, index) => getRouteDistance(last, corridor) < getRouteDistance(last, remaining[best]) ? index : best, 0);
    ordered.push(remaining.splice(nextIndex, 1)[0]);
  }
  twoOptRoads(ordered);
  return [...ordered, ...noCoordCorridors];
};

export const roadAwareTSP = (points, startPoint = null) => {
  if (!points.length) return [];
  const { corridors, fallback } = buildRoadCorridors(points);
  const orderedCorridors = orderRoadCorridors(corridors, startPoint);
  const result = [];
  let previous = startPoint || null;

  orderedCorridors.forEach((corridor, index) => {
    const next = orderedCorridors.slice(index + 1).find(item => item.hasCoord) || null;
    const stops = chooseCorridorVariant(corridor, previous, next);
    stops.forEach(stop => { previous = appendRoadStop(result, stop, previous); });
  });

  // 도로명 자체가 없는 데이터만 좌표 TSP fallback을 적용한다. 도로명 데이터는 절대 이곳으로 되돌리지 않는다.
  return [...result, ...nearestNeighborTSP(fallback, previous)];
};

export const analyzeSequenceQuality = (records, drivers) => {
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
export const nearestNeighborTSP = (points, startPoint = null) => {
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

// ─────────────────────────────────────────────────────────────────────────────
// 개선 알고리즘 (improvedSequence)
//
// 설계 의도: 기존 roadAwareTSP는 도로(corridor) 우선 순회라 같은 좌표에 밀집한
// 답십리1동 같은 지역에서 도로 사이를 왕복하며 역주행이 발생한다. 개선판은
//   1) buildSequenceUnits()로 만든 배송단위(unit)만 입력으로 받고(묶음 보존),
//   2) unit 간 비용을 getLocalRouteEdge().carDistance(도로페널티 반영 차량거리)로 쓰고,
//   3) nearest-neighbor 초기해 → 2-opt + Or-opt 로 carDistance 총합을 전역 최소화한다.
// 2-opt(구간 반전) + Or-opt(연속 1·2·3 unit 재삽입)가 역주행 제거의 핵심이다.
// ─────────────────────────────────────────────────────────────────────────────

// unit 간 차량거리(carDistance) — getLocalRouteEdge 재사용(도로페널티/단지보너스 반영).
// 같은 좌표(거리 0)는 0 반환.
export const improvedUnitCost = (from, to, cache) => {
  if (!from || !to) return Infinity;
  if (cache) {
    const ck = getUnitEdgeKey(from, to);
    const hit = cache.get(ck);
    if (hit !== undefined) return hit;
    const edge = getLocalRouteEdge(from, to);
    const cost = Number.isFinite(edge.carDistance) ? edge.carDistance : Infinity;
    cache.set(ck, cost);
    return cost;
  }
  const edge = getLocalRouteEdge(from, to);
  return Number.isFinite(edge.carDistance) ? edge.carDistance : Infinity;
};

// unit의 대표 도로명(도로재방문 패널티 계산용). apt/road/near 모두 records[0] 기준 파싱.
export const getUnitRoad = (unit) => {
  if (!unit) return '';
  if (unit.roadInfo?.road) return unit.roadInfo.road;
  const rec = unit.records?.[0];
  return rec ? parseRoadInfo(getSequenceAddress(rec)).road : '';
};

// 경로 전체 도로재방문 횟수 (analyzeSequenceQuality와 동일 정의: 닫힌 도로 재등장).
const countRoadRevisits = (order) => {
  const closed = new Set();
  let last = '';
  let revisits = 0;
  for (const unit of order) {
    const road = getUnitRoad(unit);
    if (!road) continue;
    if (last && road !== last) closed.add(last);
    if (road !== last && closed.has(road)) revisits++;
    last = road;
  }
  return revisits;
};

// 경로 전체 carDistance 총합 (startPoint→첫 unit 포함, 없으면 unit 사이만)
const totalUnitRouteCost = (order, startUnit, cache) => {
  let sum = 0;
  if (startUnit && order.length) sum += improvedUnitCost(startUnit, order[0], cache);
  for (let i = 1; i < order.length; i++) sum += improvedUnitCost(order[i - 1], order[i], cache);
  return sum;
};

// startPoint(또는 좌표 객체)를 unit 형태로 감싼다 — improvedUnitCost가 roadInfo/records를
// 참조하므로 빈 records와 좌표만 채운 가짜 unit을 만든다(도로페널티는 기본 1.35x).
const wrapStartUnit = (startPoint) => {
  if (!startPoint) return null;
  const lat = Number(startPoint.lat ?? startPoint._lat);
  const lng = Number(startPoint.lng ?? startPoint._lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { type: 'start', key: 'start:start:start', lat, lng, sLat: lat, sLng: lng, eLat: lat, eLng: lng, records: [], roadInfo: { road: '', side: '', num: 9999, sub: 0 } };
};

export const improvedSequence = (points, startPoint = null, options = {}) => {
  if (!points?.length) return [];
  const cache = new Map();
  const maxPasses = options.maxPasses || 60;

  const allUnits = buildSequenceUnits(points);
  const coordUnits = allUnits.filter(u => u.hasCoord);
  const noCoordUnits = allUnits.filter(u => !u.hasCoord);

  if (!coordUnits.length) return noCoordUnits.flatMap(u => u.records);

  const startUnit = wrapStartUnit(startPoint);

  // ── 1) 초기해: nearest-neighbor (carDistance 기준) ──────────────────────────
  const rem = [...coordUnits];
  let startIdx;
  if (startUnit) {
    startIdx = rem.reduce((mi, u, i) =>
      improvedUnitCost(startUnit, u, cache) < improvedUnitCost(startUnit, rem[mi], cache) ? i : mi, 0);
  } else {
    // 출발점 없으면 가장 북쪽(lat 최대) unit부터
    startIdx = rem.reduce((mi, u, i) => u.lat > rem[mi].lat ? i : mi, 0);
  }
  const order = [rem.splice(startIdx, 1)[0]];
  while (rem.length) {
    const last = order[order.length - 1];
    let minC = Infinity, minI = 0;
    for (let i = 0; i < rem.length; i++) {
      const c = improvedUnitCost(last, rem[i], cache);
      if (c < minC) { minC = c; minI = i; }
    }
    order.push(rem.splice(minI, 1)[0]);
  }

  // ── 2) 전역 개선: 2-opt + Or-opt (carDistance 총합 감소가 멈출 때까지) ───────
  const n = order.length;
  let improved = true;
  let pass = 0;
  while (improved && pass++ < maxPasses) {
    improved = false;

    // 2-opt: edge(i-1→i) 와 edge(j→j+1) 사이 구간 [i..j] 반전
    for (let i = 1; i < n - 1; i++) {
      const a = i === 0 ? startUnit : order[i - 1];
      if (!a) continue;
      for (let j = i + 1; j < n; j++) {
        const b = order[i];
        const c = order[j];
        const d = j + 1 < n ? order[j + 1] : null;
        const oldD = improvedUnitCost(a, b, cache) + (d ? improvedUnitCost(c, d, cache) : 0);
        const newD = improvedUnitCost(a, c, cache) + (d ? improvedUnitCost(b, d, cache) : 0);
        if (newD < oldD - 1) {
          let lo = i, hi = j;
          while (lo < hi) { const t = order[lo]; order[lo] = order[hi]; order[hi] = t; lo++; hi--; }
          improved = true;
        }
      }
    }

    // Or-opt: 연속 segLen(1·2·3)개 unit을 떼어 다른 위치에 재삽입
    for (let segLen = 1; segLen <= 3; segLen++) {
      for (let i = 0; i + segLen <= n; i++) {
        const prev = i === 0 ? startUnit : order[i - 1];
        const next = i + segLen < n ? order[i + segLen] : null;
        const seg0 = order[i];
        const segEnd = order[i + segLen - 1];
        // 제거 시 절약: prev→seg0 + segEnd→next - prev→next
        const removeGain = (prev ? improvedUnitCost(prev, seg0, cache) : 0)
          + (next ? improvedUnitCost(segEnd, next, cache) : 0)
          - (prev && next ? improvedUnitCost(prev, next, cache) : 0);

        let bestDelta = -1; // 음수여야 개선(총거리 감소)
        let bestPos = -1;
        for (let k = 0; k <= n; k++) {
          // 자기 구간 내부/경계는 건너뜀
          if (k >= i && k <= i + segLen) continue;
          const left = k === 0 ? startUnit : order[k - 1];
          const right = k < n ? order[k] : null;
          // 떼어낸 seg를 [left]와 [right] 사이에 넣을 때 추가비용
          const insertCost = (left ? improvedUnitCost(left, seg0, cache) : 0)
            + (right ? improvedUnitCost(segEnd, right, cache) : 0)
            - (left && right ? improvedUnitCost(left, right, cache) : 0);
          const delta = insertCost - removeGain;
          if (delta < bestDelta) { bestDelta = delta; bestPos = k; }
        }

        if (bestPos !== -1 && bestDelta < -1) {
          const seg = order.splice(i, segLen);
          const insertAt = bestPos > i ? bestPos - segLen : bestPos;
          order.splice(insertAt, 0, ...seg);
          improved = true;
        }
      }
    }
  }

  // ── 2b) 도로재방문 패널티 정련(Or-opt) ─────────────────────────────────────
  // carDistance 최적해는 같은 도로를 떠났다가 되돌아오는 도로재방문을 만들 수 있다.
  // (carDistance + ROAD_REVISIT_PENALTY×재방문수) 목적함수로 Or-opt를 한 번 더 돌려
  // 거리 손해를 최소화하면서 도로재방문을 줄인다. 패널티 단위는 '미터 등가'.
  const ROAD_REVISIT_PENALTY = options.roadRevisitPenalty ?? 50;
  const penalizedObjective = (ord) =>
    totalUnitRouteCost(ord, startUnit, cache) + ROAD_REVISIT_PENALTY * countRoadRevisits(ord);

  let curObj = penalizedObjective(order);
  let refImproved = true;
  let refPass = 0;
  while (refImproved && refPass++ < maxPasses) {
    refImproved = false;
    for (let segLen = 1; segLen <= 3; segLen++) {
      for (let i = 0; i + segLen <= n; i++) {
        let bestObj = curObj;
        let bestPos = -1;
        for (let k = 0; k <= n; k++) {
          if (k >= i && k <= i + segLen) continue;
          const seg = order.slice(i, i + segLen);
          const trial = [...order.slice(0, i), ...order.slice(i + segLen)];
          const insertAt = k > i ? k - segLen : k;
          trial.splice(insertAt, 0, ...seg);
          const obj = penalizedObjective(trial);
          if (obj < bestObj - 1) { bestObj = obj; bestPos = k; }
        }
        if (bestPos !== -1) {
          const seg = order.splice(i, segLen);
          const insertAt = bestPos > i ? bestPos - segLen : bestPos;
          order.splice(insertAt, 0, ...seg);
          curObj = bestObj;
          refImproved = true;
        }
      }
    }
  }

  // ── 3) unit → 레코드 펼치기 (진입 방향 최적화) ─────────────────────────────
  const result = [];
  let prevLat = startUnit ? startUnit.lat : order[0].lat;
  let prevLng = startUnit ? startUnit.lng : order[0].lng;
  order.forEach(unit => {
    const fwdD = unit.sLat && unit.sLng ? haversine(prevLat, prevLng, unit.sLat, unit.sLng) : Infinity;
    const revD = unit.eLat && unit.eLng ? haversine(prevLat, prevLng, unit.eLat, unit.eLng) : Infinity;
    const group = revD < fwdD ? [...unit.records].reverse() : unit.records;
    result.push(...group);
    const last = group[group.length - 1];
    prevLat = last?._lat || unit.lat;
    prevLng = last?._lng || unit.lng;
  });

  // ── 4) 좌표 없는 unit: 같은 키 prefix 그룹 직후 삽입(없으면 맨 끝) ──────────
  noCoordUnits.forEach(noUnit => {
    const prefix = noUnit.key.split(':').slice(0, 3).join(':');
    const matchIdx = result.findIndex(r => getSequenceUnitMeta(r).key.split(':').slice(0, 3).join(':') === prefix);
    if (matchIdx !== -1) {
      const matchKey = getSequenceUnitMeta(result[matchIdx]).key;
      let insertAt = matchIdx + 1;
      while (insertAt < result.length && getSequenceUnitMeta(result[insertAt]).key === matchKey) insertAt++;
      result.splice(insertAt, 0, ...noUnit.records);
    } else {
      result.push(...noUnit.records);
    }
  });

  return result;
};

// ── 비교 측정: baseline과 동일 기준(haversine 총거리·역주행)으로 계산 ────────
// 역주행: 각 위치 i에서 남은 미방문 노드 최근접거리 minRemain 대비
//         actual > minRemain*1.5 && actual - minRemain > 80m 이면 1회.
export const measureSequence = (orderedRecords) => {
  const ordered = orderedRecords || [];
  let totalDistM = 0;
  let longestM = 0;
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1], b = ordered[i];
    if (!Number.isFinite(a._lat) || !Number.isFinite(a._lng) || !Number.isFinite(b._lat) || !Number.isFinite(b._lng)) continue;
    const d = haversine(a._lat, a._lng, b._lat, b._lng);
    totalDistM += d;
    if (d > longestM) longestM = d;
  }
  const coordOrdered = ordered.filter(r => Number.isFinite(r._lat) && Number.isFinite(r._lng) && r._lat && r._lng);
  let backtrackCount = 0;
  for (let i = 0; i < coordOrdered.length - 1; i++) {
    const cur = coordOrdered[i], next = coordOrdered[i + 1];
    const actual = haversine(cur._lat, cur._lng, next._lat, next._lng);
    let minRemain = Infinity;
    for (let j = i + 1; j < coordOrdered.length; j++) {
      const cand = coordOrdered[j];
      const d = haversine(cur._lat, cur._lng, cand._lat, cand._lng);
      if (d < minRemain) minRemain = d;
    }
    if (actual > minRemain * 1.5 && actual - minRemain > 80) backtrackCount++;
  }
  return {
    총이동거리_km: Math.round(totalDistM / 100) / 10,
    총이동거리_m: Math.round(totalDistM),
    역주행건너뛰기_횟수: backtrackCount,
    최장구간_m: Math.round(longestM),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// improvedV2: 외부 주입 실거리 행렬(distFn)로 최적화 (optimizeWithDistanceMatrix)
//
// improvedSequence와 동일한 NN + 2-opt + Or-opt(1·2·3) 구조지만, unit 간 비용을
// getLocalRouteEdge(proxy)가 아니라 호출자가 넘긴 distFn(i,j)로 평가한다.
// distFn은 Kakao 실거리 행렬(희소) + haversine*1.3 fallback을 합성한 함수다.
//   - 입력: buildSequenceUnits() 출력 units(좌표 유무 혼재 허용)
//   - distFn(i, j): units[i] → units[j] 실거리(m). 같은 좌표는 0을 반환하도록 호출자가 보장.
//   - 반환: 좌표 있는 unit을 최적화한 순서 + 좌표 없는 unit을 맨 뒤에 붙인 unit 배열.
// 순수 함수(부수효과 없음). 레코드 펼치기는 스크립트(또는 호출자)가 담당한다.
// ─────────────────────────────────────────────────────────────────────────────
export const optimizeWithDistanceMatrix = (units, distFn, startPoint = null, options = {}) => {
  if (!Array.isArray(units) || !units.length) return [];
  if (typeof distFn !== 'function') throw new Error('optimizeWithDistanceMatrix: distFn must be a function');
  const maxPasses = options.maxPasses || 60;

  const coordUnits = units.filter(u => u.hasCoord);
  const noCoordUnits = units.filter(u => !u.hasCoord);
  if (!coordUnits.length) return [...noCoordUnits];

  // units 내 인덱스 기반 비용 — distFn은 unit 객체를 받는다(행렬 키를 unit이 보유).
  const cost = (a, b) => {
    if (!a || !b) return Infinity;
    const d = distFn(a, b);
    return Number.isFinite(d) ? d : Infinity;
  };

  // start unit 래핑 (좌표만 있는 가짜 unit)
  let startUnit = null;
  if (startPoint) {
    const lat = Number(startPoint.lat ?? startPoint._lat);
    const lng = Number(startPoint.lng ?? startPoint._lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      startUnit = {
        type: 'start', key: 'start:start:start', hasCoord: true,
        lat, lng, sLat: lat, sLng: lng, eLat: lat, eLng: lng,
        records: [], roadInfo: { road: '', side: '', num: 9999, sub: 0 },
      };
    }
  }

  // ── 1) 초기해: nearest-neighbor (실거리 기준) ───────────────────────────────
  const rem = [...coordUnits];
  let startIdx;
  if (startUnit) {
    startIdx = rem.reduce((mi, u, i) => cost(startUnit, u) < cost(startUnit, rem[mi]) ? i : mi, 0);
  } else {
    startIdx = rem.reduce((mi, u, i) => u.lat > rem[mi].lat ? i : mi, 0); // 최북단
  }
  const order = [rem.splice(startIdx, 1)[0]];
  while (rem.length) {
    const last = order[order.length - 1];
    let minC = Infinity, minI = 0;
    for (let i = 0; i < rem.length; i++) {
      const c = cost(last, rem[i]);
      if (c < minC) { minC = c; minI = i; }
    }
    order.push(rem.splice(minI, 1)[0]);
  }

  // ── 2) 전역 개선: 2-opt + Or-opt (실거리 총합 감소가 멈출 때까지) ────────────
  const n = order.length;
  let improved = true;
  let pass = 0;
  while (improved && pass++ < maxPasses) {
    improved = false;

    // 2-opt: 구간 [i..j] 반전
    for (let i = 1; i < n - 1; i++) {
      const a = order[i - 1];
      for (let j = i + 1; j < n; j++) {
        const b = order[i];
        const c = order[j];
        const d = j + 1 < n ? order[j + 1] : null;
        const oldD = cost(a, b) + (d ? cost(c, d) : 0);
        const newD = cost(a, c) + (d ? cost(b, d) : 0);
        if (newD < oldD - 1) {
          let lo = i, hi = j;
          while (lo < hi) { const t = order[lo]; order[lo] = order[hi]; order[hi] = t; lo++; hi--; }
          improved = true;
        }
      }
    }

    // Or-opt: 연속 segLen(1·2·3)개 unit을 떼어 다른 위치에 재삽입
    for (let segLen = 1; segLen <= 3; segLen++) {
      for (let i = 0; i + segLen <= n; i++) {
        const prev = i === 0 ? startUnit : order[i - 1];
        const next = i + segLen < n ? order[i + segLen] : null;
        const seg0 = order[i];
        const segEnd = order[i + segLen - 1];
        const removeGain = (prev ? cost(prev, seg0) : 0)
          + (next ? cost(segEnd, next) : 0)
          - (prev && next ? cost(prev, next) : 0);

        let bestDelta = -1;
        let bestPos = -1;
        for (let k = 0; k <= n; k++) {
          if (k >= i && k <= i + segLen) continue;
          const left = k === 0 ? startUnit : order[k - 1];
          const right = k < n ? order[k] : null;
          const insertCost = (left ? cost(left, seg0) : 0)
            + (right ? cost(segEnd, right) : 0)
            - (left && right ? cost(left, right) : 0);
          const delta = insertCost - removeGain;
          if (delta < bestDelta) { bestDelta = delta; bestPos = k; }
        }

        if (bestPos !== -1 && bestDelta < -1) {
          const seg = order.splice(i, segLen);
          const insertAt = bestPos > i ? bestPos - segLen : bestPos;
          order.splice(insertAt, 0, ...seg);
          improved = true;
        }
      }
    }
  }

  return [...order, ...noCoordUnits];
};

// improvedV2 레코드 펼치기: optimizeWithDistanceMatrix가 돌려준 unit 순서를
// improvedSequence와 동일한 "진입 방향 최적화"로 레코드 배열로 변환한다.
// (묶음 보존: unit.records를 통째로 push하므로 같은 단지/좌표/주소는 항상 연속)
export const expandUnitsToRecords = (orderedUnits, startPoint = null) => {
  if (!Array.isArray(orderedUnits) || !orderedUnits.length) return [];
  const coordUnits = orderedUnits.filter(u => u.hasCoord);
  const noCoordUnits = orderedUnits.filter(u => !u.hasCoord);

  const result = [];
  let prevLat = startPoint ? Number(startPoint.lat ?? startPoint._lat) : (coordUnits[0]?.lat ?? null);
  let prevLng = startPoint ? Number(startPoint.lng ?? startPoint._lng) : (coordUnits[0]?.lng ?? null);
  coordUnits.forEach(unit => {
    const fwdD = unit.sLat && unit.sLng && prevLat != null ? haversine(prevLat, prevLng, unit.sLat, unit.sLng) : Infinity;
    const revD = unit.eLat && unit.eLng && prevLat != null ? haversine(prevLat, prevLng, unit.eLat, unit.eLng) : Infinity;
    const group = revD < fwdD ? [...unit.records].reverse() : unit.records;
    result.push(...group);
    const last = group[group.length - 1];
    prevLat = last?._lat || unit.lat;
    prevLng = last?._lng || unit.lng;
  });

  // 좌표 없는 unit: 같은 키 prefix 그룹 직후 삽입(없으면 맨 끝) — improvedSequence와 동일
  noCoordUnits.forEach(noUnit => {
    const prefix = noUnit.key.split(':').slice(0, 3).join(':');
    const matchIdx = result.findIndex(r => getSequenceUnitMeta(r).key.split(':').slice(0, 3).join(':') === prefix);
    if (matchIdx !== -1) {
      const matchKey = getSequenceUnitMeta(result[matchIdx]).key;
      let insertAt = matchIdx + 1;
      while (insertAt < result.length && getSequenceUnitMeta(result[insertAt]).key === matchKey) insertAt++;
      result.splice(insertAt, 0, ...noUnit.records);
    } else {
      result.push(...noUnit.records);
    }
  });

  return result;
};
