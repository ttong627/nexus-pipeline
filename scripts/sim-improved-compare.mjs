// 배송순번 비교 — 현재 운영(roadAwareTSP) vs 개선(improvedSequence)
// 형 증상 검증: 교차(jumps)·도로 재방문(revisitRoads)·총거리가 실제로 줄어드는가?
// 사용: node scripts/sim-improved-compare.mjs [행정동]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { roadAwareTSP, improvedSequence, analyzeSequenceQuality } from '../src/engine/routeSequenceEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FILE = process.argv.includes('--all') ? '.sim-data/route-extract-all.json' : '.sim-data/route-extract.json';
const raw = JSON.parse(readFileSync(resolve(ROOT, FILE), 'utf8'));
const DONG = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : '';
const dongSet = DONG ? new Set(DONG.split(',').map((s) => s.trim())) : null;

const src = dongSet ? raw.filter((r) => dongSet.has(String(r.행정동 || '').trim())) : raw;
const records = src.map((r, i) => ({ ...r, id: r.docId || `s${i}`, _lat: Number(r.lat), _lng: Number(r.lng), _isApt: r.isApt }));
const withCoord = records.filter((r) => Number.isFinite(r._lat) && Number.isFinite(r._lng) && r._lat && r._lng);

console.log('═'.repeat(64));
console.log(`순번 비교 — ${DONG || '전체'} · ${records.length}건(좌표 ${withCoord.length})`);
console.log('═'.repeat(64));

const DRV = [{ id: 'sim', name: '시뮬', color: '#3b82f6' }];
const run = (label, fn) => {
  const t0 = Date.now();
  const ordered = fn(records, null).map((r, i) => ({ ...r, _driverId: 'sim', 배송순번: String(i + 1) }));
  const s = analyzeSequenceQuality(ordered, DRV).driverStats[0] || {};
  const ms = Date.now() - t0;
  console.log(`\n[${label}]  (${ms}ms)`);
  console.log(`  총거리       ${s.totalDistKm} km`);
  console.log(`  평균/최대이동 ${s.avgDist} / ${s.maxDist} m`);
  console.log(`  점프(300m↑)  ${s.jumpCount} 건   ← 교차·먼거리`);
  console.log(`  도로재방문   ${s.revisitRoadCount} 개   ← 되돌아가기`);
  console.log(`  예상정확도   ${s.accuracy} %`);
  return s;
};

const a = run('현재 · roadAwareTSP', (r) => roadAwareTSP(r, null));
const b = run('개선 · improvedSequence (2-opt+Or-opt)', (r) => improvedSequence(r, null));

const pct = (x, y) => (!x ? '—' : `${(((x - y) / x) * 100).toFixed(1)}%`);
console.log('\n' + '─'.repeat(64));
console.log('개선폭 (현재→개선, +면 좋아짐):');
console.log(`  총거리       ${a.totalDistKm} → ${b.totalDistKm} km   (${pct(a.totalDistKm, b.totalDistKm)} 단축)`);
console.log(`  점프         ${a.jumpCount} → ${b.jumpCount} 건`);
console.log(`  도로재방문   ${a.revisitRoadCount} → ${b.revisitRoadCount} 개`);
console.log(`  예상정확도   ${a.accuracy} → ${b.accuracy} %`);
process.exit(0);
