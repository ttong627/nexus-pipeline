// 루트맵 순수 헬퍼·상수 — React·Firebase·DOM·**빌드환경(import.meta.env)** 에 의존하지 않는 계산만 모았다.
//   ★환경 의존 값을 여기 두면 Node 에서 이 모듈을 못 읽어 회귀 테스트가 통째로 불가능해진다(실측으로 걸렀다).
//   2026-08-23 점검 후속(Phase 4-1): `RouteMapModal.jsx` 가 5,850줄이라 읽기도 고치기도 어려웠다.
//   ★여기 있는 것들은 **순수함수**라 회귀 테스트로 잠글 수 있다(`scripts/map-helpers.test.mjs`).
//     화면 상태를 건드리는 로직은 여기 두지 않는다 — 옮기는 순간 순수성이 깨지고 테스트가 무력해진다.
//   ※`getRouteDong`·`DRIVER_COLORS`·`escHtml` 은 다른 화면에도 사본이 있다(점검 발견) — 여기를 SSOT 로 삼는다.

import {
  getAptGroupMeta,
  getEffectiveLoad,
  getSideLabel,
  haversine,
  normalizeAptGroupPart,
  parseAptDong,
  parseRoadInfo,
} from '../../engine/routeSequenceEngine.js';

// ★사유 문자열은 **중복 없이** 합친다 — 좌표 재매칭을 세 번 돌리면 `A / A / A` 가 되던 자리(2026-08-23 점검).
export const mergeReason = (prev, add) => {
  if (!add) return prev || '';
  const parts = String(prev || '').split(' / ').map((v) => v.trim()).filter(Boolean);
  if (!parts.includes(String(add).trim())) parts.push(String(add).trim());
  return parts.join(' / ');
};

/**
 * 기사 공유링크 유효기간(일).
 *
 * ★45일 → 7일 (2026-08-13, 개인정보 점검)
 *   공유 문서에는 대상자 **이름·주소·휴대폰**이 담기고, 보안규칙상 **인증 없이** 읽힌다
 *   (`firestore.rules` `route_shares`: `allow read: if isShareWithinTTL()`).
 *   즉 링크가 새면(카톡 전달·기사 폰 분실·브라우저 히스토리) 그 기간 내내 열린다.
 *   배송은 월 단위로 끝나므로 45일은 노출 창만 길게 잡은 값이었다. 7일이면 배송 주기를 덮는다.
 *   ⚠️이 값을 다시 늘리려면 그만큼 노출 창이 길어진다는 뜻이다.
 */
export const SHARE_LINK_TTL_DAYS = 7;

/**
 * 이행기간 이중쓰기 — **Phase 2(휴대폰 인증) 배포 직후 `false` 로 내린다.**
 *
 * ★왜 필요한가: 서브컬렉션 규칙은 `token.phone_number` 를 요구한다. 인증이 아직
 *   배포되지 않은 상태에서 서브컬렉션만 쓰면 **새 공유를 기사가 아무도 못 읽는다** —
 *   배송이 선다. 보안을 조이다 현장을 세우면 그게 더 큰 사고다.
 * ⛔이 값이 `true` 인 동안은 "자기 것만"이 성립하지 않는다(옛 배열이 통째로 읽힌다).
 *   즉 **지금보다 나빠지진 않지만 좋아지지도 않는다.** 임시 상태임을 잊지 말 것.
 */
export const SHARE_TRANSITION_DUAL_WRITE = false;   // 2026-08-23 비밀번호 입장(SH-1~6) 배포와 함께 내림 — 부모 문서 배열은 전 기사 PII 가 토큰으로 통째로 읽히던 뿌리(검사 실측)

export const DRIVER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
];



// ── 동명이인 안전매칭 강키(S-1~S-5) — scripts/doppelganger-guard.mjs와 동일 규약 ──
//   주소·개인데이터를 '쓰는' 매칭은 강키(이름+휴대폰 끝8자리)만 허용. 이름 단독(약키) 금지.
//   생년월일 필드는 명단에 없어 휴대폰 끝8을 강키 보조로 사용.
export const _digits = (v) => String(v || '').replace(/[^0-9]/g, '');
export const _phone8 = (v) => { const d = _digits(v); return d.length >= 8 ? d.slice(-8) : ''; };
export const _nameKey = (s) => String(s || '').replace(/\s+/g, '').trim();
// 레코드 → 강키 문자열. 이름·휴대폰 둘 다 있어야 유효(없으면 '' 반환 → 매칭 제외).
export const strongMatchKey = (r) => {
  const name = _nameKey(r?.이름 || r?.본명);
  const ph = _phone8(r?.휴대폰 || r?.연락처 || r?.전화 || r?.유선전화);
  return (name && ph) ? `${name}|${ph}` : '';
};



export const escHtml = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');


// 시도 비교 시 '경기도'↔'경기', '서울특별시'↔'서울' 등 접미어 불일치 무시
export const normalizeRegionKey = (value) =>
  String(value || '').replace(/\s+/g, '').replace(/(특별자치도|특별자치시|특별시|광역시|도|시)$/, '').trim();

// Firestore 에 이미 저장된 '지자체벗어남' 레코드를 현재 normalizeRegionKey 로 재검증
// 좌표확인지자체("경기 안양시 동안구") ↔ cityLabel("경기도 안양시 동안구") 비교
export const revalidateAreaMatch = (confirmedArea, cityLabel) => {
  if (!confirmedArea || !cityLabel) return false;
  const cityParts = String(cityLabel).trim().split(/\s+/).filter(Boolean);
  const confirmedParts = String(confirmedArea).trim().split(/\s+/).filter(Boolean);
  if (!cityParts.length || !confirmedParts.length) return false;
  const selSido = normalizeRegionKey(cityParts[0]);
  const selSigungu = cityParts.length > 1 ? normalizeRegionKey(cityParts.slice(1).join('')) : '';
  const cfmSido = normalizeRegionKey(confirmedParts[0]);
  const cfmSigungu = confirmedParts.length > 1 ? normalizeRegionKey(confirmedParts.slice(1).join('')) : '';
  return selSido === cfmSido && (!selSigungu || selSigungu === cfmSigungu);
};

export const getRouteDong = (record) =>
  String(record?.배정행정동 || record?.routeDong || record?.행정동 || '').trim();

export const getKakaoAreaMeta = (raw) => {
  const road = raw?.road_address || {};
  const addr = raw?.address || {};
  const sido = road.region_1depth_name || addr.region_1depth_name || '';
  const sigungu = road.region_2depth_name || addr.region_2depth_name || '';
  const dong = road.region_3depth_h_name || road.region_3depth_name || addr.region_3depth_h_name || addr.region_3depth_name || '';
  return { sido, sigungu, dong };
};

export const isCoordAssignable = (record) => record?.좌표검증상태 !== '지자체벗어남';

export const assessKakaoAreaMatch = (record, raw, cityLabel = '') => {
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
export const KAKAO_COLOR_MAP = { '#3b82f6':'blue','#f59e0b':'yellow','#ef4444':'red','#8b5cf6':'violet','#06b6d4':'blue','#f97316':'orange','#ec4899':'red','#14b8a6':'green','#a855f7':'violet','#84cc16':'green','#f43f5e':'red','#0ea5e9':'blue','#d97706':'yellow','#10b981':'green','#6366f1':'violet','#e11d48':'red','#0891b2':'blue','#65a30d':'green','#7c3aed':'violet' };

// 체감물량(유효부담)은 **엔진 SSOT** 를 쓴다 — 여기 있던 사본이 네 번째였다.
//   물량배분·순번·지도가 각자 다른 계산을 하면 같은 명단인데 화면마다 부담이 달라진다.
//   (상수 4종도 엔진에서만 정의된다: RENTAL/STAIRS/HEAVY_NOTE/MEDIUM_NOTE)








export const getRouteUnitKey = (record) => {
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

export const buildAssignedRouteUnits = (records, drivers) => {
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

export const getMajorityDriverId = (records) => {
  const votes = {};
  records.forEach(record => {
    if (!record._driverId) return;
    votes[record._driverId] = (votes[record._driverId] || 0) + 1;
  });
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

// 아파트 단지 배송단위 여부 (getRouteUnitKey의 apt 접두어)
export const isAptRouteUnitKey = (key) => typeof key === 'string' && (key.startsWith('apt:') || key.startsWith('apt-split:'));

export const getMixedRouteUnitIssues = (units) => {
  const issues = new Map();
  // 혼재 = 아파트 단지 내로만 한정 — 같은 단지(또는 분할 동)가 여러 기사로 갈라진 경우만 센다.
  // (도로/동일주소 단위, 권역 안 고립 "섬"은 혼재로 세지 않는다.)
  units.forEach(unit => {
    if (!isAptRouteUnitKey(unit.key)) return;
    if (unit.driverIds.length <= 1) return;
    const targetDriverId = getMajorityDriverId(unit.records) || unit.driverId;
    if (!targetDriverId) return;
    if (unit.records.some(record => record._driverId !== targetDriverId)) {
      issues.set(unit.key, { type: 'split-unit', targetDriverId });
    }
  });
  return issues;
};

export const getMixedRouteUnitKeys = (units) => {
  return new Set(getMixedRouteUnitIssues(units).keys());
};

export const getRecordQty = (record) => parseInt(record?.포수 || record?.['수량(포수)']) || 1;


export const buildMapInsights = ({ records, drivers, largeAptComplexes = [] }) => {
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
  // ★좌표 미보유를 맨 앞에 세운다(C-5·설계서 F4). 좌표 없는 건은 순번에서 뒤로 밀려
  //   **기사 구역을 찢는다**. 지금까지 noCoord 는 계산만 하고 화면에 안 나와서,
  //   미보유가 남은 줄 모르고 자동 순번을 돌릴 수 있었다.
  if (coordIssues.noCoord) {
    actions.push(`좌표 미보유 ${coordIssues.noCoord.toLocaleString()}건 — 순번 전에 먼저 채우세요. 좌표 없는 건은 구역을 찢습니다.`);
  }
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

// ── 지도 핀 시각 규칙 (2026-08-23 Phase 3-3) ────────────────────────────────
//   왜 여기로 뺐나: 핀 HTML 이 렌더 루프 한가운데 100줄로 박혀 있어 **규칙이 테스트 불가능**했다.
//   포수별 크기·glow·뱃지, 이름/포수/동 라벨, 순번 배지, zIndex 우선순위는 이 화면의 업무 규칙이다
//   (혼재·순번을 눈으로 확인하는 근거) — 순수함수로 빼서 회귀로 잠근다(`scripts/map-pin.test.mjs`).
//   ★값을 바꾸면 테스트가 먼저 깨진다. 의도한 변경이면 테스트도 함께 고칠 것.

/** 포수 강조 레벨 0~4 (1포 / 2포 / 3~4포 / 5~9포 / 10포+) */
export const pinQtyLevel = (qtyNum) => (qtyNum >= 10 ? 4 : qtyNum >= 5 ? 3 : qtyNum >= 3 ? 2 : qtyNum >= 2 ? 1 : 0);

/** 레벨별 핀 지름(px) */
export const pinSizeOf = (qtyNum) => [32, 34, 36, 39, 44][pinQtyLevel(qtyNum)];

/** 겹침 우선순위 — 오류 > 같은좌표 > 5포↑ > 2포↑ > 순번 > 기본 */
export const pinZIndex = ({ isError, sameCount = 1, qtyNum = 1, seq = '' }) =>
  (isError ? 10 : sameCount > 1 ? 9 : qtyNum >= 5 ? 8 : qtyNum >= 2 ? 6 : seq ? 5 : 1);

/** 핀 내부 HTML — 색·순번·포수·같은좌표·이름·동 라벨. (문자열만 만든다: DOM 을 만들지 않는다) */
export const buildPinInnerHtml = ({ color, seq = '', name = '', dong = '', qtyNum = 1, sameCount = 1 }) => {
  const qtyLv = pinQtyLevel(qtyNum);
  const pinSize = pinSizeOf(qtyNum);
  const glowStyle = [
    `0 0 0 2px ${color}55,0 3px 10px rgba(0,0,0,0.7)`,
    `0 0 0 2px ${color}99,0 0 8px 3px ${color}30,0 3px 10px rgba(0,0,0,0.7)`,
    `0 0 0 2px ${color},0 0 0 4px ${color}55,0 0 10px 4px ${color}33,0 3px 10px rgba(0,0,0,0.7)`,
    `0 0 0 3px ${color},0 0 0 6px ${color}66,0 0 14px 6px ${color}44,0 3px 12px rgba(0,0,0,0.8)`,
    `0 0 0 3px ${color},0 0 0 7px ${color}88,0 0 20px 8px ${color}55,0 4px 14px rgba(0,0,0,0.9)`,
  ][qtyLv];
  const samePointBadgeHtml = sameCount > 1
    ? `<div style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f97316;font-size:8px;font-weight:900;padding:1px 5px;border-radius:6px;border:1.5px solid #f97316;line-height:1.5;white-space:nowrap;z-index:2;">×${sameCount}</div>`
    : '';
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
  return `<div style="width:${pinSize}px;height:${pinSize}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:3px solid rgba(255,255,255,0.9);box-shadow:${glowStyle};flex-shrink:0;position:relative;">${seq ? `<span style="font-size:${pinSize >= 40 ? 9 : 10}px;font-weight:900;color:white;line-height:1;">${seq}</span>` : `<div style="width:${dotPx}px;height:${dotPx}px;border-radius:50%;background:rgba(255,255,255,0.35);"></div>`}${qtyBadgeHtml}${samePointBadgeHtml}</div><div style="width:0;height:0;border-left:${arrowPx}px solid transparent;border-right:${arrowPx}px solid transparent;border-top:${arrowPx * 2}px solid ${color};margin-top:-1px;flex-shrink:0;"></div><div style="background:${qtyNum >= 5 ? 'rgba(20,10,5,0.95)' : 'rgba(8,8,8,0.88)'};color:white;font-size:11px;font-weight:800;padding:2px 6px;border-radius:4px;margin-top:2px;white-space:nowrap;max-width:92px;overflow:hidden;text-overflow:ellipsis;border:1px solid ${color}${qtyNum >= 5 ? '88' : '45'};">${name}·<span style="color:${qtyColor};font-weight:900;">${qtyNum}포</span></div>${dong ? `<div style="background:rgba(0,0,0,0.72);color:#94a3b8;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-top:1px;white-space:nowrap;max-width:80px;overflow:hidden;text-overflow:ellipsis;">${dong}</div>` : ''}`;
};

// ── 뷰포트 컬링 판정 (2026-08-23 Phase 3-4) ────────────────────────────────
//   화면(bounds)에 여유(padRatio)를 더한 사각형 안인지. 여유를 두는 이유: 조금 밀어도 빈 화면이 안 보이게.
//   ★이 값으로 **화면에 붙일지**만 정한다. 전체범위 맞춤·경로선·×N 은 전건 기준으로 따로 돈다.
export const CULL_MIN_RECORDS = 1200;   // 이보다 적으면 컬링하지 않는다(평소 경로는 그대로)
export const isWithinPaddedBounds = (lat, lng, box, padRatio = 0.4) => {
  if (!box || !Number.isFinite(lat) || !Number.isFinite(lng)) return true;   // 모르면 보여준다(안전한 쪽)
  const { south, west, north, east } = box;
  const padLat = Math.abs(north - south) * padRatio;
  const padLng = Math.abs(east - west) * padRatio;
  return lat >= south - padLat && lat <= north + padLat && lng >= west - padLng && lng <= east + padLng;
};
