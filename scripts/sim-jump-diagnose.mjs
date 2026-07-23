// 점프(먼거리 이동) 원인 진단 — 형 증상 "먼거리 갔다 다시 와"의 실체를 규명
// roadAwareTSP 순번에서 연속 구간 거리가 큰 곳의 앞뒤 집 주소·좌표를 보여준다.
// 좌표 오류인지(비정상 위치) / 실제 먼 집인지 / 도로명 없는 집인지 판별.
// 사용: node scripts/sim-jump-diagnose.mjs "동,동,..." [--all] [--th 300]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { roadAwareTSP, haversine, getSequenceAddress, parseRoadInfo } from '../src/engine/routeSequenceEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FILE = process.argv.includes('--all') ? '.sim-data/route-extract-all.json' : '.sim-data/route-extract.json';
const raw = JSON.parse(readFileSync(resolve(ROOT, FILE), 'utf8'));
const DONG = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : '';
const TH = Number((() => { const i = process.argv.indexOf('--th'); return i >= 0 ? process.argv[i + 1] : 300; })());
const dongSet = DONG ? new Set(DONG.split(',').map((s) => s.trim())) : null;

const src = dongSet ? raw.filter((r) => dongSet.has(String(r.행정동 || '').trim())) : raw;
const records = src.map((r, i) => ({ ...r, id: r.docId || `s${i}`, _lat: Number(r.lat), _lng: Number(r.lng), _isApt: r.isApt }));

const ordered = roadAwareTSP(records, null);
const D = (a, b) => haversine(a._lat, a._lng, b._lat, b._lng);

// 이 동네 좌표 중심·분포 — 좌표 오류(중심에서 크게 벗어남) 탐지
const lats = records.map((r) => r._lat).filter(Boolean).sort((a, b) => a - b);
const lngs = records.map((r) => r._lng).filter(Boolean).sort((a, b) => a - b);
const med = (a) => a[Math.floor(a.length / 2)];
const cLat = med(lats); const cLng = med(lngs);
const farFromCenter = (r) => haversine(r._lat, r._lng, cLat, cLng);

const jumps = [];
for (let i = 1; i < ordered.length; i++) {
  const prev = ordered[i - 1]; const cur = ordered[i];
  if (!prev._lat || !cur._lat) continue;
  const d = D(prev, cur);
  if (d >= TH) jumps.push({ i, d, prev, cur });
}

console.log('═'.repeat(70));
console.log(`점프 진단 — ${DONG || '전체'} · ${records.length}건 · 임계 ${TH}m`);
console.log(`동네 중심(중앙값) 위도 ${cLat.toFixed(5)} 경도 ${cLng.toFixed(5)}`);
console.log('═'.repeat(70));
console.log(`\n300m+ 점프 ${jumps.length}건 (큰 것부터):\n`);

jumps.sort((a, b) => b.d - a.d).slice(0, 15).forEach((j) => {
  const road = (r) => parseRoadInfo(getSequenceAddress(r)).road || '(도로명없음)';
  const suspect = farFromCenter(j.cur) > 2500 ? '  🔴좌표의심(중심 2.5km+)' : '';
  console.log(`▶ ${Math.round(j.d)}m 이동 (순번 ${j.i})${suspect}`);
  console.log(`   전: ${j.prev.이름} | ${j.prev.주소} | ${road(j.prev)} | 중심거리 ${Math.round(farFromCenter(j.prev))}m`);
  console.log(`   후: ${j.cur.이름} | ${j.cur.주소} | ${road(j.cur)} | 중심거리 ${Math.round(farFromCenter(j.cur))}m`);
});

// 중심에서 크게 벗어난 좌표(오류 의심) 집계
const outliers = records.filter((r) => r._lat && farFromCenter(r) > 2500);
console.log(`\n${'─'.repeat(70)}`);
console.log(`🔴 좌표 의심(동네 중심에서 2.5km+ 벗어남): ${outliers.length}건`);
outliers.slice(0, 10).forEach((r) => console.log(`   ${Math.round(farFromCenter(r))}m · ${r.이름} · ${r.주소} · 행정동 ${r.행정동}`));
process.exit(0);
