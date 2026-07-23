// nexus roadAwareTSP  vs  yyplus buildRoadSequence(도로명)  vs  yyplus optimizeRoute(좌표 NN+2opt)
// 같은 실배정본(시흥시 2026-06)·같은 측정기(nexus analyzeSequenceQuality)로 공정 비교.
// yyplus 함수는 Vite 전용 import(확장자 없음)라 node로 직접 못 불러와 자립 복제(로직 동일).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { roadAwareTSP, analyzeSequenceQuality } from '../src/engine/routeSequenceEngine.js';

// ── yyplus 복제(로직 그대로) ────────────────────────────────────────────────
const kmBetween = (lat1, lng1, lat2, lng2) => {
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const haversine = (a, b) => {
  if (!a || !b || a.lat == null || b.lat == null) return 0;
  return kmBetween(Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng)) * 1000;
};
function buildingDong(detail = '', addr = '') {
  const d = String(detail || '');
  let m = d.match(/(?:제\s*)?(\d{1,4})\s*동/); if (m) return `${Number(m[1])}동`;
  m = d.match(/(?:^|[\s(,])([A-Za-z])\s*동(?![가-힣])/); if (m) return `${m[1].toUpperCase()}동`;
  m = d.match(/(?:^|[\s(,])([가-하])\s*동(?![가-힣])/); if (m) return `${m[1]}동`;
  const p = String(addr || '').match(/\([^)]*?(?:\s)((?:\d{1,4})|[A-Za-z]|[가-하])\s*동(?![가-힣])[^)]*\)/);
  if (p) { const t = p[1]; return /^\d+$/.test(t) ? `${Number(t)}동` : `${t.toUpperCase ? t.toUpperCase() : t}동`; }
  return '';
}
const buildingHo = (detail = '') => { const m = String(detail || '').match(/(\d{1,5})\s*호/); return m ? Number(m[1]) : 0; };
function dongCompare(a = {}, b = {}) {
  const da = buildingDong(a.detail, a.addr), db = buildingDong(b.detail, b.addr);
  if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
  const na = da.match(/^(\d+)/), nb = db.match(/^(\d+)/);
  if (na && nb) return Number(na[1]) - Number(nb[1]); if (na) return -1; if (nb) return 1;
  return da.localeCompare(db, 'ko');
}
const ROAD_RE = /([가-힣A-Za-z0-9]*(?:대로|로|길))\s*(\d+)(?:-(\d+))?/;
function buildRoadSequence(members = [], depot = null) {
  const groups = new Map(); const noRoad = [];
  members.forEach((m) => {
    const mt = String(m.addr || m.주소 || '').replace(/\s+/g, ' ').match(ROAD_RE);
    if (!mt) { noRoad.push(m); return; }
    const g = groups.get(mt[1]) || { road: mt[1], items: [] };
    g.items.push({ m, no: Number(mt[2]), sub: Number(mt[3] || 0) }); groups.set(mt[1], g);
  });
  const glist = [...groups.values()].map((g) => {
    const pts = g.items.filter((x) => x.m.lat != null);
    return { ...g, lat: pts.length ? pts.reduce((a, x) => a + Number(x.m.lat), 0) / pts.length : null, lng: pts.length ? pts.reduce((a, x) => a + Number(x.m.lng), 0) / pts.length : null };
  });
  const ordered = []; let cur = depot && depot.lat != null ? { lat: Number(depot.lat), lng: Number(depot.lng) } : null;
  const remain = [...glist];
  while (remain.length) {
    let bi = 0, bd = Infinity;
    remain.forEach((g, i) => { const d = (g.lat != null && cur && cur.lat != null) ? kmBetween(cur.lat, cur.lng, g.lat, g.lng) : 1e9; if (d < bd) { bd = d; bi = i; } });
    if (bd >= 1e9) { remain.sort((a, b) => String(a.road).localeCompare(String(b.road), 'ko')); bi = 0; }
    const g = remain.splice(bi, 1)[0]; if (g.lat != null) cur = g;
    g.items.sort((a, b) => a.no - b.no || a.sub - b.sub || dongCompare(a.m, b.m) || (buildingHo(a.m.detail) - buildingHo(b.m.detail)) || String(a.m.name || '').localeCompare(String(b.m.name || ''), 'ko'));
    ordered.push(...g.items.map((x) => x.m));
  }
  noRoad.sort((a, b) => String(a.addr || a.주소 || '').localeCompare(String(b.addr || b.주소 || ''), 'ko'));
  ordered.push(...noRoad); return ordered;
}
function optimizeRoute(points, depot) {
  const pts = (points || []).filter((p) => p.lat != null && p.lng != null);
  if (pts.length <= 1) return pts;
  const start = (depot && depot.lat != null) ? depot : pts[0];
  const rem = [...pts]; const route = []; let cur = start;
  while (rem.length) { let bi = 0, bd = Infinity; rem.forEach((p, i) => { const d = haversine(cur, p); if (d < bd) { bd = d; bi = i; } }); cur = rem.splice(bi, 1)[0]; route.push(cur); }
  const full = [start, ...route, start]; let improved = true, guard = 0;
  while (improved && guard < 80) {
    improved = false; guard += 1;
    for (let i = 1; i < full.length - 2; i += 1) for (let j = i + 1; j < full.length - 1; j += 1) {
      const before = haversine(full[i - 1], full[i]) + haversine(full[j], full[j + 1]);
      const after = haversine(full[i - 1], full[j]) + haversine(full[i], full[j + 1]);
      if (after + 1e-6 < before) { let lo = i, hi = j; while (lo < hi) { const t = full[lo]; full[lo] = full[hi]; full[hi] = t; lo += 1; hi -= 1; } improved = true; }
    }
  }
  return full.slice(1, full.length - 1);
}

// ── 비교 ────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(__dirname, '..', '.sim-data/route-sihung.json'), 'utf8'));
const CLEAN = process.argv.includes('--clean');
// 좌표 오류 제거: 시흥시 전체 중심에서 12km+ 벗어난 좌표는 오류로 보고 제외(안금순 190km 등)
let data = raw;
if (CLEAN) {
  const la = raw.filter(r => r.lat).map(r => r.lat).sort((a,b)=>a-b);
  const ln = raw.filter(r => r.lng).map(r => r.lng).sort((a,b)=>a-b);
  const cLat = la[Math.floor(la.length/2)], cLng = ln[Math.floor(ln.length/2)];
  const km2 = (a,b,c,d)=>{const R=6371,r=x=>x*Math.PI/180;const dφ=r(c-a),dλ=r(d-b);const A=Math.sin(dφ/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dλ/2)**2;return R*2*Math.asin(Math.sqrt(A));};
  const before = raw.length;
  data = raw.filter(r => !(r.lat && km2(r.lat,r.lng,cLat,cLng) > 12));
  console.log(`[좌표오류 제외] ${before} → ${data.length}건 (${before-data.length}건 제거)
`);
}
const byDriver = new Map();
data.forEach((r) => { const g = r.기사; if (!g) return; if (!byDriver.has(g)) byDriver.set(g, []); byDriver.get(g).push(r); });
const DRV = [{ id: 'sim', name: '시뮬', color: '#3b82f6' }];
const measure = (ordered) => {
  const seq = ordered.map((r, i) => ({ ...r, _driverId: 'sim', 배송순번: String(i + 1) }));
  const s = analyzeSequenceQuality(seq, DRV).driverStats[0] || {};
  return { km: Number(s.totalDistKm) || 0, jump: s.jumpCount || 0, rev: s.revisitRoadCount || 0 };
};
const tot = { a: { km: 0, jump: 0, rev: 0 }, b: { km: 0, jump: 0, rev: 0 }, c: { km: 0, jump: 0, rev: 0 } };
let drivers = 0, households = 0;
for (const [, recs0] of byDriver) {
  const recs = recs0.map((r, i) => ({ ...r, id: r.docId || `s${i}`, _lat: Number(r.lat), _lng: Number(r.lng), _isApt: r.isApt }));
  if (recs.filter((r) => r._lat && r._lng).length < 10) continue;
  drivers++; households += recs.length;
  const mem = recs.map((r) => ({ ...r, name: r.이름, addr: r.주소, detail: '', lat: r._lat, lng: r._lng }));
  const A = measure(roadAwareTSP(recs, null));
  const B = measure(buildRoadSequence(mem, null));
  const C = measure(optimizeRoute(mem, null));
  tot.a.km += A.km; tot.a.jump += A.jump; tot.a.rev += A.rev;
  tot.b.km += B.km; tot.b.jump += B.jump; tot.b.rev += B.rev;
  tot.c.km += C.km; tot.c.jump += C.jump; tot.c.rev += C.rev;
}
const line = (t, o) => `${t.padEnd(30)} ${o.km.toFixed(1).padStart(8)}km ${String(o.jump).padStart(5)}건 ${String(o.rev).padStart(5)}개`;
console.log('═'.repeat(62));
console.log(`알고리즘 3자 비교 — 시흥시 2026-06 · 기사 ${drivers}명 · ${households}가구`);
console.log('═'.repeat(62));
console.log(`${''.padEnd(30)} ${'총거리'.padStart(9)} ${'점프'.padStart(6)} ${'되돌아'.padStart(6)}`);
console.log('─'.repeat(62));
console.log(line('① nexus roadAwareTSP(현행)', tot.a));
console.log(line('② yyplus 도로명(buildRoadSequence)', tot.b));
console.log(line('③ yyplus 좌표(optimizeRoute)', tot.c));
console.log('─'.repeat(62));
console.log(`총거리 대비(현행=100%): 영플도로 ${(tot.b.km / tot.a.km * 100).toFixed(1)}% · 영플좌표 ${(tot.c.km / tot.a.km * 100).toFixed(1)}%  (낮을수록 짧음)`);
process.exit(0);
