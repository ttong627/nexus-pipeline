// 실도로(OSRM) vs 직선(roadAwareTSP) 배송순번 품질 비교 — 시뮬 전용(운영 엔진 불변).
// 두 순번을 "같은 자(OSRM 실도로 거리)"로 평가해 공정 비교한다.
//   ① 직선 roadAwareTSP 순번 → 그 순서의 실도로 총거리/역주행
//   ② OSRM 실도로 최적 순번  → 그 순서의 실도로 총거리/역주행
// OSRM 행렬은 yyplus 공개 프록시(wssc.kr/api/route/table) 재사용. 사용: node scripts/sim-osrm-compare.mjs [행정동]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { roadAwareTSP } from '../src/engine/routeSequenceEngine.js';
import { optimizeRouteByMatrix, fetchRoadMatrix } from './osrm-routeopt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INPUT = resolve(ROOT, '.sim-data/route-extract.json');
const OUTPUT = resolve(ROOT, '.sim-data/osrm-compare-result.json');
const TARGET_DONG = process.argv[2] || '답십리1동';
const MAX_PTS = 290; // depot 포함 coords ≤ 300 (addr-server /api/route/table 제한)

const evenSample = (arr, k) => { if (arr.length <= k) return arr; const out = []; const step = arr.length / k; for (let i = 0; i < k; i += 1) out.push(arr[Math.floor(i * step)]); return out; };
const km = (m) => Math.round(m / 100) / 10;

const raw = JSON.parse(readFileSync(INPUT, 'utf8'));
let recs = raw.filter((r) => String(r.행정동 || '').trim() === TARGET_DONG)
  .map((r, i) => ({ ...r, id: r.docId || `sim-${i}`, _lat: Number(r.lat), _lng: Number(r.lng), _isApt: r.isApt }))
  .filter((r) => Number.isFinite(r._lat) && Number.isFinite(r._lng) && r._lat && r._lng);

const totalCoord = recs.length;
const sampled = recs.length > MAX_PTS;
if (sampled) recs = evenSample(recs, MAX_PTS);
if (recs.length < 3) { console.error(`좌표 가구 부족(${recs.length}). 중단.`); process.exit(1); }

// depot = 가장 북쪽(최대 lat) — roadAwareTSP(startPoint=null)의 시작 규칙과 일치시켜 공정 비교
let depotIdx = 0; recs.forEach((r, i) => { if (r._lat > recs[depotIdx]._lat) depotIdx = i; });
const depot = recs[depotIdx];
const points = recs.filter((_, i) => i !== depotIdx);

// OSRM 실도로 행렬: 0=depot, 1..N=points
const matrixRes = await fetchRoadMatrix({ lat: depot._lat, lng: depot._lng }, points.map((p) => ({ lat: p._lat, lng: p._lng })));
if (!matrixRes) { console.error('OSRM 행렬 수신 실패(wssc.kr/api/route/table 점검). 중단.'); process.exit(1); }
const M = matrixRes.distances; // (N+1)×(N+1) m
const idxOf = new Map([[depot.id, 0]]); points.forEach((p, k) => idxOf.set(p.id, k + 1));

// 평가: M인덱스 시퀀스(depot=0 시작)의 인접 실도로 거리 합 + 역주행(남은 최근접보다 1.5배+80m 더 멀면)
function evalSeq(idxSeq) {
  let total = 0, back = 0;
  for (let i = 0; i < idxSeq.length - 1; i += 1) {
    const d = M[idxSeq[i]][idxSeq[i + 1]]; total += (d == null ? 0 : d);
    let minRem = Infinity; for (let j = i + 1; j < idxSeq.length; j += 1) { const dd = M[idxSeq[i]][idxSeq[j]]; if (dd != null && dd < minRem) minRem = dd; }
    if (d != null && d > minRem * 1.5 && d - minRem > 80) back += 1;
  }
  return { total, back };
}

// ① 직선 roadAwareTSP 순번 → depot 출발로 회전 후 M인덱스 시퀀스
const tsp = roadAwareTSP(recs, null).map((r) => r.id);
const dpos = tsp.indexOf(depot.id);
const tspRot = dpos >= 0 ? [...tsp.slice(dpos), ...tsp.slice(0, dpos)] : tsp;
const seqStraight = tspRot.map((id) => idxOf.get(id)).filter((v) => v != null);

// ② OSRM 실도로 최적 순번 → depot(0) 출발 M인덱스 시퀀스
const osrm = optimizeRouteByMatrix(points.map((p) => ({ ...p, lat: p._lat, lng: p._lng })), M);
const seqOsrm = [0, ...osrm.map((p) => idxOf.get(p.id)).filter((v) => v != null)];

const A = evalSeq(seqStraight);
const B = evalSeq(seqOsrm);
const impr = A.total > 0 ? Math.round((A.total - B.total) / A.total * 1000) / 10 : 0;

console.log('═'.repeat(62));
console.log(`OSRM 실도로 vs 직선(roadAwareTSP) 순번 비교 — ${TARGET_DONG}`);
console.log('═'.repeat(62));
console.log(`가구(좌표보유): ${totalCoord}${sampled ? ` → 균등샘플 ${recs.length} (coords 제한 300)` : ''}`);
console.log(`OSRM 행렬 source: ${matrixRes.source} (노드 ${M.length})`);
console.log('─'.repeat(62));
console.log(`① 직선 roadAwareTSP 순번의 실도로 총거리 : ${km(A.total)} km · 역주행 ${A.back}`);
console.log(`② OSRM 실도로 최적 순번의 실도로 총거리   : ${km(B.total)} km · 역주행 ${B.back}`);
console.log('─'.repeat(62));
console.log(`▶ 실도로 최적화 개선: 총거리 ${impr}% 단축 (${km(A.total - B.total)} km) · 역주행 ${A.back - B.back} 감소`);

writeFileSync(OUTPUT, JSON.stringify({
  target: TARGET_DONG, generatedAt: new Date().toISOString(),
  coords: { total: totalCoord, used: recs.length, sampled }, source: matrixRes.source,
  straight: { totalKm: km(A.total), backtrack: A.back },
  osrm: { totalKm: km(B.total), backtrack: B.back },
  improvement: { distPct: impr, distKm: km(A.total - B.total), backtrackReduced: A.back - B.back },
}, null, 2), 'utf8');
console.log(`\n저장: ${OUTPUT}`);
console.log('═'.repeat(62));
