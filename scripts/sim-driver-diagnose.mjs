// 기사 구역 안 교차 진단 — 형 증상 "기사 배정 후에도 그 기사 구역 안에서 왔다갔다"
// 실배정본(시흥시 2026-06)에서 기사별로 roadAwareTSP 순번을 매기고,
//  ① 그 구역이 지리적으로 뭉쳤는지(배정 품질)  ② 그 안에서 순번이 튀는지(순번 품질)를 분리 측정.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { roadAwareTSP, analyzeSequenceQuality, haversine } from '../src/engine/routeSequenceEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const raw = JSON.parse(readFileSync(resolve(ROOT, '.sim-data/route-sihung.json'), 'utf8'));

const byDriver = new Map();
raw.forEach((r) => { const g = r.기사; if (!g) return; if (!byDriver.has(g)) byDriver.set(g, []); byDriver.get(g).push(r); });

const DRV = [{ id: 'sim', name: '시뮬', color: '#3b82f6' }];
console.log('═'.repeat(76));
console.log('기사 구역 안 교차 진단 — 시흥시 2026-06 실배정본');
console.log('═'.repeat(76));
console.log('기사        가구  좌표  구역폭   총거리   평균이동 점프  되돌아 정확도  분산(구역뭉침)');
console.log('─'.repeat(76));

const rows = [];
for (const [driver, recs0] of [...byDriver.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const recs = recs0.map((r, i) => ({ ...r, id: r.docId || `s${i}`, _lat: Number(r.lat), _lng: Number(r.lng), _isApt: r.isApt }));
  const coord = recs.filter((r) => r._lat && r._lng);
  if (coord.length < 10) continue;

  // 구역 지리 분산: 가구 좌표의 중심에서의 평균거리(작을수록 뭉침) + bounding box 대각
  const cLat = coord.reduce((a, r) => a + r._lat, 0) / coord.length;
  const cLng = coord.reduce((a, r) => a + r._lng, 0) / coord.length;
  const spread = Math.round(coord.reduce((a, r) => a + haversine(r._lat, r._lng, cLat, cLng), 0) / coord.length);
  const lat0 = Math.min(...coord.map((r) => r._lat)), lat1 = Math.max(...coord.map((r) => r._lat));
  const lng0 = Math.min(...coord.map((r) => r._lng)), lng1 = Math.max(...coord.map((r) => r._lng));
  const boxKm = (haversine(lat0, lng0, lat1, lng1) / 1000).toFixed(1);

  const ordered = roadAwareTSP(recs, null).map((r, i) => ({ ...r, _driverId: 'sim', 배송순번: String(i + 1) }));
  const s = analyzeSequenceQuality(ordered, DRV).driverStats[0] || {};

  rows.push({ driver, n: recs.length, coord: coord.length, boxKm, s, spread });
  console.log(
    `${driver.padEnd(10)} ${String(recs.length).padStart(4)} ${String(coord.length).padStart(5)} ${String(boxKm + 'km').padStart(6)} `
    + `${String(s.totalDistKm + 'km').padStart(8)} ${String(s.avgDist + 'm').padStart(7)} ${String(s.jumpCount).padStart(4)} `
    + `${String(s.revisitRoadCount).padStart(5)} ${String(s.accuracy + '%').padStart(6)}   ${spread}m`,
  );
}

// 요약: 순번 문제(구역은 뭉쳤는데 점프 많음) vs 배정 문제(구역이 넓음)
console.log('\n' + '─'.repeat(76));
const avgBox = (rows.reduce((a, r) => a + Number(r.boxKm), 0) / rows.length).toFixed(1);
const totJump = rows.reduce((a, r) => a + (r.s.jumpCount || 0), 0);
const totRevisit = rows.reduce((a, r) => a + (r.s.revisitRoadCount || 0), 0);
console.log(`평균 구역폭 ${avgBox}km · 총 점프 ${totJump}건 · 총 되돌아가기 ${totRevisit}개`);
console.log('해석: 구역폭이 크면(>5km) 배정이 흩어진 것 / 구역폭 작은데 점프 많으면 순번 문제 / 되돌아가기 많으면 순번 문제');
process.exit(0);
