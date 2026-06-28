// Kakao 실거리 행렬 기반 배송순번 최적화·검증 (improvedV2)
// ─────────────────────────────────────────────────────────────────────────────
// 목적: proxy(carDistance) 대신 진짜 Kakao 실거리 행렬로 최적화한 improvedV2가
//       현 운영 baseline(roadAwareTSP)을 "실거리"로 이기는지 추측 없이 검증한다.
//
// 절차:
//   Step1  답십리1동 388건 → buildSequenceUnits() → 좌표 unit(N개)
//          각 unit k=6 최근접 이웃(haversine)만 후보 엣지로 선정 → 무방향 고유쌍
//          (대칭 근사: a→b 한 방향만 Kakao 측정해 b→a에도 동일 적용 — 호출 절반)
//          Kakao 측정 → 희소 실거리 행렬. 캐시 파일 .sim-data/kakao-edge-cache.json 누적.
//   Step2  optimizeWithDistanceMatrix(units, distFn) → improvedV2 unit 순서
//          distFn: 행렬에 있으면 실거리, 없으면 haversine*1.3
//   Step3  baseline=roadAwareTSP, improvedV2 둘 다 최종 인접 레코드쌍을 Kakao 실거리로
//          합산(같은 캐시 재사용, 부족분만 추가 호출). 총 실거리/소요/실패 비교.
//          묶음 흩어짐(improvedV2) 0 검증 + haversine/역주행/도로재방문 참고치.
//
// 사용: node scripts/sim-kakao-matrix.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  roadAwareTSP,
  buildSequenceUnits,
  optimizeWithDistanceMatrix,
  expandUnitsToRecords,
  measureSequence,
  analyzeSequenceQuality,
  haversine,
} from '../src/engine/routeSequenceEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INPUT = resolve(ROOT, '.sim-data/route-extract.json');
const CACHE = resolve(ROOT, '.sim-data/kakao-edge-cache.json');
const OUTPUT = resolve(ROOT, '.sim-data/kakao-matrix-result.json');
const ENV = resolve(ROOT, '.env');
const TARGET_DONG = '답십리1동';
const K_NEIGHBORS = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── .env에서 VITE_KAKAO_REST_KEY 파싱 ───────────────────────────────────────
const parseKakaoKey = () => {
  if (!existsSync(ENV)) return '';
  const txt = readFileSync(ENV, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*VITE_KAKAO_REST_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '').trim();
  }
  return '';
};

const KAKAO_KEY = parseKakaoKey();
if (!KAKAO_KEY) {
  console.error('❌ .env에서 VITE_KAKAO_REST_KEY를 찾지 못했습니다. 중단합니다.');
  process.exit(1);
}
console.log(`✅ Kakao REST 키 로드 완료 (길이 ${KAKAO_KEY.length})`);

// ── 데이터 로드 + 필터 + 엔진 입력 매핑 ─────────────────────────────────────
const raw = JSON.parse(readFileSync(INPUT, 'utf8'));
const records = raw
  .filter((r) => String(r.행정동 || '').trim() === TARGET_DONG)
  .map((r, idx) => ({
    ...r,
    id: r.docId || `sim-${idx}`,
    _lat: Number(r.lat),
    _lng: Number(r.lng),
    _isApt: r.isApt,
  }));
console.log(`✅ ${TARGET_DONG} ${records.length}건 로드`);

// ── 좌표 키 / 캐시 (키: "lng,lat→lng,lat" 6자리, 양방향 = 무방향 대칭) ────────
const c6 = (n) => Number(n).toFixed(6);
const ptKey = (lat, lng) => `${c6(lng)},${c6(lat)}`;
// 무방향 캐시키: 좌표 정렬해 a→b / b→a 동일 키 (대칭 근사)
const undirKey = (aLat, aLng, bLat, bLng) => {
  const A = ptKey(aLat, aLng), B = ptKey(bLat, bLng);
  return A <= B ? `${A}->${B}` : `${B}->${A}`;
};

// 캐시 파일 로드 (누적 재사용)
let edgeCache = {};
let cacheReuse = 0;
if (existsSync(CACHE)) {
  try {
    edgeCache = JSON.parse(readFileSync(CACHE, 'utf8'));
    console.log(`✅ 기존 캐시 로드: ${Object.keys(edgeCache).length}쌍`);
  } catch {
    edgeCache = {};
  }
}
const saveCache = () => {
  try { writeFileSync(CACHE, JSON.stringify(edgeCache), 'utf8'); } catch { /* ignore */ }
};

// ── Kakao Directions 단건 호출 (1.5s 타임아웃) ──────────────────────────────
let consecutiveFail = 0;
let aborted = false;
const callKakao = async (fromLat, fromLng, toLat, toLng) => {
  const url = `https://apis-navi.kakaomobility.com/v1/directions?origin=${c6(fromLng)},${c6(fromLat)}&destination=${c6(toLng)},${c6(toLat)}&priority=RECOMMEND&summary=true`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` }, signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const summary = data?.routes?.[0]?.summary;
    if (!summary || summary.distance == null) return null;
    return { dist: Number(summary.distance), dur: Number(summary.duration) };
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
};

// 캐시 우선 측정. 실패 시 haversine*1.3 대체(소스 기록). 연속 실패 20+ → 중단 플래그.
let kakaoOk = 0;
let kakaoFail = 0;
const measureEdge = async (fromLat, fromLng, toLat, toLng) => {
  const key = undirKey(fromLat, fromLng, toLat, toLng);
  if (edgeCache[key]) { cacheReuse++; return edgeCache[key]; }
  if (aborted) {
    const hv = haversine(fromLat, fromLng, toLat, toLng) * 1.3;
    return { dist: hv, dur: hv / (30000 / 3600), source: 'haversine' };
  }
  const r = await callKakao(fromLat, fromLng, toLat, toLng);
  await sleep(120);
  let edge;
  if (r) {
    edge = { dist: r.dist, dur: r.dur, source: 'kakao' };
    kakaoOk++;
    consecutiveFail = 0;
  } else {
    const hv = haversine(fromLat, fromLng, toLat, toLng) * 1.3;
    edge = { dist: hv, dur: hv / (30000 / 3600), source: 'haversine' };
    kakaoFail++;
    consecutiveFail++;
    if (consecutiveFail >= 20) {
      aborted = true;
      console.warn(`\n⚠ 연속 실패 ${consecutiveFail}회 — 일일제한 의심. 추가 Kakao 호출 중단, 이후는 haversine*1.3 대체로 진행합니다.`);
    }
  }
  edgeCache[key] = edge;
  return edge;
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — 희소 실거리 행렬 (k=6 최근접 이웃 후보쌍)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(64));
console.log('STEP 1 — 희소 실거리 행렬 구성 (k=6 최근접 이웃)');
console.log('═'.repeat(64));

const allUnits = buildSequenceUnits(records);
const coordUnits = allUnits.filter((u) => u.hasCoord);
console.log(`배송단위(unit): 전체 ${allUnits.length}개 / 좌표 있음 ${coordUnits.length}개 (최적화 대상 N=${coordUnits.length})`);

// 각 unit의 k=6 최근접 이웃 → 무방향 고유쌍 (i<j 정규화)
const candidatePairs = new Map(); // undirKey → {a,b}
coordUnits.forEach((u, i) => {
  const neighbors = coordUnits
    .map((v, j) => ({ j, d: i === j ? Infinity : haversine(u.lat, u.lng, v.lat, v.lng) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, K_NEIGHBORS);
  neighbors.forEach(({ j }) => {
    const v = coordUnits[j];
    const key = undirKey(u.lat, u.lng, v.lat, v.lng);
    if (!candidatePairs.has(key)) candidatePairs.set(key, { a: u, b: v });
  });
});
const candList = [...candidatePairs.entries()];
console.log(`k=6 후보쌍(무방향 고유, 대칭 근사로 한 방향만 측정): ${candList.length}쌍`);

console.log(`\nKakao 실거리 측정 시작 (${candList.length}쌍, 캐시 우선)…`);
for (let i = 0; i < candList.length; i++) {
  const [, { a, b }] = candList[i];
  await measureEdge(a.lat, a.lng, b.lat, b.lng);
  if ((i + 1) % 50 === 0 || i === candList.length - 1) {
    console.log(`  진행 ${i + 1}/${candList.length}  (kakao성공 ${kakaoOk}, 실패→haversine ${kakaoFail}, 캐시재사용 ${cacheReuse})`);
    saveCache();
  }
}
saveCache();
console.log(`STEP1 완료 — 행렬 엔트리 ${Object.keys(edgeCache).length}쌍 (kakao ${kakaoOk}, haversine대체 ${kakaoFail}, 캐시재사용 ${cacheReuse})`);

// ── STEP 1.5 — 완전 거리행렬 (N=${coordUnits.length} 모든 무방향쌍) ──────────────
// k=6 희소행렬만으로는 2-opt/Or-opt 평가의 대부분이 haversine fallback으로 떨어진다
// (적중률 ~30%). N이 작아(55) 완전행렬 측정이 가능하므로, 최적화가 100% 실거리로
// 작동하도록 모든 unit 쌍을 측정한다. 이것이 "진짜 실거리 행렬 최적화"의 충실한 구현.
const FULL_MATRIX = process.env.SPARSE_ONLY !== '1';
if (FULL_MATRIX) {
  const fullPairs = new Map();
  for (let i = 0; i < coordUnits.length; i++) {
    for (let j = i + 1; j < coordUnits.length; j++) {
      const a = coordUnits[i], b = coordUnits[j];
      if (ptKey(a.lat, a.lng) === ptKey(b.lat, b.lng)) continue; // 동일좌표 → 0, 측정 불필요
      const key = undirKey(a.lat, a.lng, b.lat, b.lng);
      if (!edgeCache[key] && !fullPairs.has(key)) fullPairs.set(key, { a, b });
    }
  }
  const fullList = [...fullPairs.entries()];
  console.log(`\nSTEP 1.5 — 완전행렬 추가 측정 대상: ${fullList.length}쌍 (이미 측정된 ${Object.keys(edgeCache).length}쌍 제외)`);
  for (let i = 0; i < fullList.length; i++) {
    const [, { a, b }] = fullList[i];
    await measureEdge(a.lat, a.lng, b.lat, b.lng);
    if ((i + 1) % 50 === 0 || i === fullList.length - 1) {
      console.log(`  완전행렬 ${i + 1}/${fullList.length}  (kakao성공 ${kakaoOk}, 실패→haversine ${kakaoFail}, 캐시재사용 ${cacheReuse})`);
      saveCache();
    }
  }
  saveCache();
  console.log(`STEP1.5 완료 — 행렬 엔트리 ${Object.keys(edgeCache).length}쌍`);
}

// ── distFn: 행렬(실거리) 우선, 없으면 haversine*1.3 ─────────────────────────
let matrixHit = 0;
let matrixMiss = 0;
const distFn = (ua, ub) => {
  if (!ua || !ub) return Infinity;
  // 동일 좌표(같은 unit 중심) → 0
  if (ptKey(ua.lat, ua.lng) === ptKey(ub.lat, ub.lng)) return 0;
  const key = undirKey(ua.lat, ua.lng, ub.lat, ub.lng);
  const hit = edgeCache[key];
  if (hit && hit.source === 'kakao') { matrixHit++; return hit.dist; }
  matrixMiss++;
  return haversine(ua.lat, ua.lng, ub.lat, ub.lng) * 1.3;
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — 실거리 기반 최적화 (improvedV2)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(64));
console.log('STEP 2 — 실거리 기반 최적화 (optimizeWithDistanceMatrix)');
console.log('═'.repeat(64));

const orderedUnits = optimizeWithDistanceMatrix(coordUnits.concat(allUnits.filter((u) => !u.hasCoord)), distFn, null);
const improvedV2Order = expandUnitsToRecords(orderedUnits, null);
const baseOrder = roadAwareTSP(records, null);
console.log(`improvedV2 레코드 ${improvedV2Order.length}건 / baseline ${baseOrder.length}건`);
console.log(`distFn 평가: 실거리행렬 적중 ${matrixHit}, fallback(haversine*1.3) ${matrixMiss}`);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — 공정 비교 (같은 Kakao 실거리로 최종 순번 총거리 측정)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(64));
console.log('STEP 3 — 공정 비교 (최종 순번 인접 레코드쌍 Kakao 실거리 합산)');
console.log('═'.repeat(64));

const hasCoord = (r) => Number.isFinite(r._lat) && Number.isFinite(r._lng) && r._lat && r._lng;
// 인접 좌표쌍(좌표 있는 것만, 동일좌표 0 처리)
const buildPairs = (order) => {
  const pairs = [];
  let prev = null;
  for (const r of order) {
    if (!hasCoord(r)) continue;
    if (prev) pairs.push({ from: prev, to: r });
    prev = r;
  }
  return pairs;
};
const basePairs = buildPairs(baseOrder);
const impPairs = buildPairs(improvedV2Order);

// 최종 순번에 등장하는 인접쌍 중 행렬에 없는 것(동일좌표 제외)을 추가 측정
const needMeasure = new Map();
const registerPairs = (pairs) => {
  for (const p of pairs) {
    const fk = ptKey(p.from._lat, p.from._lng);
    const tk = ptKey(p.to._lat, p.to._lng);
    if (fk === tk) continue; // 동일좌표 → 0
    const key = undirKey(p.from._lat, p.from._lng, p.to._lat, p.to._lng);
    if (!edgeCache[key] && !needMeasure.has(key)) needMeasure.set(key, p);
  }
};
registerPairs(basePairs);
registerPairs(impPairs);
console.log(`\n최종 순번 검증 — 행렬에 없는 추가 측정 대상: ${needMeasure.size}쌍`);
const extraList = [...needMeasure.entries()];
for (let i = 0; i < extraList.length; i++) {
  const [, p] = extraList[i];
  await measureEdge(p.from._lat, p.from._lng, p.to._lat, p.to._lng);
  if ((i + 1) % 50 === 0 || i === extraList.length - 1) {
    console.log(`  추가측정 ${i + 1}/${extraList.length}  (kakao성공 ${kakaoOk}, 실패→haversine ${kakaoFail}, 캐시재사용 ${cacheReuse})`);
    saveCache();
  }
}
saveCache();

// 최종 순번 총거리/시간 합산 (kakao 우선, 없으면 haversine*1.3 대체)
const sumOrder = (pairs) => {
  let distM = 0, durS = 0;
  let kakaoPairs = 0, samePairs = 0, fallbackPairs = 0;
  for (const p of pairs) {
    const fk = ptKey(p.from._lat, p.from._lng);
    const tk = ptKey(p.to._lat, p.to._lng);
    if (fk === tk) { samePairs++; continue; } // 동일좌표 0
    const key = undirKey(p.from._lat, p.from._lng, p.to._lat, p.to._lng);
    const e = edgeCache[key];
    if (e && e.source === 'kakao') {
      distM += e.dist; durS += e.dur; kakaoPairs++;
    } else {
      const hv = haversine(p.from._lat, p.from._lng, p.to._lat, p.to._lng) * 1.3;
      distM += hv; durS += hv / (30000 / 3600); fallbackPairs++;
    }
  }
  return {
    총실거리_km: Math.round(distM / 100) / 10,
    총소요_분: Math.round(durS / 60),
    kakao실측쌍: kakaoPairs,
    동일좌표쌍: samePairs,
    haversine대체쌍: fallbackPairs,
    유효쌍: pairs.length,
  };
};
const baseSum = sumOrder(basePairs);
const impSum = sumOrder(impPairs);

// 참고 지표: haversine 총거리·역주행·점프·도로재방문
const analyze = (ordered) => {
  const analyzed = ordered.map((r, i) => ({ ...r, _driverId: 'sim', 배송순번: String(i + 1) }));
  const q = analyzeSequenceQuality(analyzed, [{ id: 'sim', name: '시뮬', color: '#3b82f6' }]);
  return q.driverStats[0] || {};
};
const baseM = measureSequence(baseOrder);
const impM = measureSequence(improvedV2Order);
const baseQ = analyze(baseOrder);
const impQ = analyze(improvedV2Order);

// 묶음 흩어짐 검증 (improvedV2): 멤버≥2 단위가 순번상 연속인지
const checkBundle = (ordered) => {
  const units = buildSequenceUnits(records).filter((u) => u.records.length >= 2);
  const posOf = new Map();
  ordered.forEach((r, i) => posOf.set(r.id, i));
  let scattered = 0;
  const detail = [];
  units.forEach((u) => {
    const positions = u.records.map((r) => posOf.get(r.id)).filter((p) => p !== undefined).sort((a, b) => a - b);
    if (positions.length < 2) return;
    const span = positions[positions.length - 1] - positions[0];
    if (span !== positions.length - 1) {
      scattered++;
      if (detail.length < 10) detail.push({ label: u.label, memberCount: u.records.length, positions, span });
    }
  });
  return { totalBundles: units.length, scattered, scatteredDetail: detail };
};
const baseBundle = checkBundle(baseOrder);
const impBundle = checkBundle(improvedV2Order);

const pct = (from, to) => (from === 0 ? 0 : Math.round(((from - to) / from) * 1000) / 10);

// ── 출력 표 ─────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
console.log(`Kakao 실거리 행렬 최적화 검증 — ${TARGET_DONG} (${records.length}건)`);
console.log('═'.repeat(72));
const row = (label, b, i, unit = '') => {
  console.log(`  ${label.padEnd(24)} ${String(b).padStart(10)}${unit}  →${String(i).padStart(10)}${unit}`);
};
console.log('  지표                         baseline       improvedV2');
console.log('─'.repeat(72));
row('★ Kakao 실거리', baseSum.총실거리_km, impSum.총실거리_km, ' km');
row('★ 실소요시간', baseSum.총소요_분, impSum.총소요_분, ' 분');
row('  kakao 실측쌍', baseSum.kakao실측쌍, impSum.kakao실측쌍, ' 쌍');
row('  동일좌표쌍(0)', baseSum.동일좌표쌍, impSum.동일좌표쌍, ' 쌍');
row('  haversine대체쌍', baseSum.haversine대체쌍, impSum.haversine대체쌍, ' 쌍');
console.log('  ─ 참고지표 ─');
row('  haversine 총거리', baseM.총이동거리_km, impM.총이동거리_km, ' km');
row('  역주행 횟수', baseM.역주행건너뛰기_횟수, impM.역주행건너뛰기_횟수, ' 회');
row('  300m+ 점프', baseQ.jumpCount, impQ.jumpCount, ' 회');
row('  도로재방문', baseQ.revisitRoadCount, impQ.revisitRoadCount, ' 회');
console.log('─'.repeat(72));

const realPct = pct(baseSum.총실거리_km, impSum.총실거리_km);
console.log(`  ★ 실거리 변화: baseline ${baseSum.총실거리_km}km → improvedV2 ${impSum.총실거리_km}km  (${realPct >= 0 ? '감소' : '증가'} ${Math.abs(realPct)}%)`);
console.log(`  묶음 흩어짐: baseline ${baseBundle.scattered}개 / improvedV2 ${impBundle.scattered}개  ${impBundle.scattered === 0 ? '✅ 0건(보존)' : '⚠ 흩어짐 존재'}`);
if (impBundle.scattered > 0) {
  impBundle.scatteredDetail.forEach((d) => console.log(`    - ${d.label} (${d.memberCount}건) positions=${JSON.stringify(d.positions)}`));
}
console.log(`  Kakao 호출 총: 성공 ${kakaoOk} / 실패(haversine대체) ${kakaoFail} / 캐시재사용 ${cacheReuse}`);

// ── 핵심 판정 ───────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(72));
const BASELINE_REF = 45.9; // 작업 지시 기준값
let verdict;
if (impSum.총실거리_km < baseSum.총실거리_km) {
  verdict = `improvedV2가 baseline을 실거리로 이겼습니다 (${baseSum.총실거리_km}km → ${impSum.총실거리_km}km, ${realPct}% 감소).`;
} else if (impSum.총실거리_km === baseSum.총실거리_km) {
  verdict = `improvedV2와 baseline 실거리 동률 (${baseSum.총실거리_km}km). baseline이 이미 실거리 최적 수준.`;
} else {
  verdict = `improvedV2가 baseline을 이기지 못했습니다 (${baseSum.총실거리_km}km → ${impSum.총실거리_km}km, ${Math.abs(realPct)}% 증가). baseline이 실거리 최적임이 재확인됨.`;
}
console.log(`핵심 판정: ${verdict}`);
console.log(`(참고) 작업 지시 baseline 기준값 ${BASELINE_REF}km 대비 이번 baseline 실측 ${baseSum.총실거리_km}km`);
console.log('─'.repeat(72));

// ── 저장 ────────────────────────────────────────────────────────────────────
const out = {
  target: TARGET_DONG,
  generatedAt: new Date().toISOString(),
  recordCount: records.length,
  unitCount: coordUnits.length,
  step1: {
    kNeighbors: K_NEIGHBORS,
    후보쌍: candList.length,
    symmetricApprox: '무방향 1회 측정 후 양방향 적용',
    matrixEntries: Object.keys(edgeCache).length,
    완전행렬모드: process.env.SPARSE_ONLY !== '1',
    최적화_distFn_실거리적중: matrixHit,
    최적화_distFn_fallback: matrixMiss,
  },
  kakaoCalls: { 성공: kakaoOk, 실패_haversine대체: kakaoFail, 캐시재사용: cacheReuse, aborted },
  distFnEval: { 실거리행렬적중: matrixHit, fallback: matrixMiss },
  baseline: {
    algorithm: 'roadAwareTSP',
    ...baseSum,
    haversine_km: baseM.총이동거리_km,
    역주행: baseM.역주행건너뛰기_횟수,
    점프: baseQ.jumpCount,
    도로재방문: baseQ.revisitRoadCount,
    bundleScattered: baseBundle.scattered,
  },
  improvedV2: {
    algorithm: 'optimizeWithDistanceMatrix(NN + 2-opt + Or-opt, Kakao 실거리 행렬)',
    ...impSum,
    haversine_km: impM.총이동거리_km,
    역주행: impM.역주행건너뛰기_횟수,
    점프: impQ.jumpCount,
    도로재방문: impQ.revisitRoadCount,
    bundleScattered: impBundle.scattered,
    bundleScatteredDetail: impBundle.scatteredDetail,
  },
  delta: {
    실거리감소_pct: realPct,
    실거리_baseline_km: baseSum.총실거리_km,
    실거리_improvedV2_km: impSum.총실거리_km,
    이겼는가: impSum.총실거리_km < baseSum.총실거리_km,
  },
  verdict,
};
writeFileSync(OUTPUT, JSON.stringify(out, null, 2), 'utf8');
console.log(`\n상세 결과 저장: ${OUTPUT}`);
console.log('═'.repeat(72));
