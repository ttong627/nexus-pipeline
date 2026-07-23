// ══════════════════════════════════════════════════════════════════════════
//  좌표 오류 재지오코딩 정리 — 형 지시(2026-07-23)
//  주소는 정상·좌표만 틀린 379건을 nexus와 동일한 방식(Kakao 지자체접두어+관할필터)
//  으로 재지오코딩해 정확한 좌표로 교체한다. 관할 안에서 못 찾으면 좌표를 비우고
//  '좌표오류지정' 플래그(순번·배정에서 제외 → 다음 [좌표 일괄]에서 재보정).
//
//  실행: node scripts/fix-coord-outliers.mjs             (dry-run · 쓰기 없음)
//        node scripts/fix-coord-outliers.mjs --write
//        node scripts/fix-coord-outliers.mjs --write --radius 25
// ══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import admin from 'firebase-admin';
import { detectCoordOutliers, haversineKm } from '../src/engine/coordValidator.js';

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const RADIUS = Number((() => { const i = ARGS.indexOf('--radius'); return i >= 0 ? ARGS[i + 1] : 25; })());

const KAKAO = (() => {
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('VITE_KAKAO_REST_KEY='));
  return line ? line.slice('VITE_KAKAO_REST_KEY='.length).trim() : '';
})();
if (!KAKAO) { console.error('❌ VITE_KAKAO_REST_KEY 없음(.env)'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();
const S = (v) => String(v ?? '').trim();
// nexus CloudListManager 와 동일한 시도 축약(Kakao는 '충청남도'를 '충남'으로 반환)
const SIDO_SHORT = { '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구', '인천광역시': '인천', '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산', '세종특별자치시': '세종', '경기도': '경기', '강원특별자치도': '강원', '강원도': '강원', '충청북도': '충북', '충청남도': '충남', '전북특별자치도': '전북', '전라북도': '전북', '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanRoad = (addr) => S(addr).replace(/\s*\([^)]*\).*$/, '').replace(/,.*$/, '').trim();

async function kakao(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO}` } });
      if (res.ok) return await res.json();
      if (res.status === 429) { await sleep(1000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(500 * (i + 1)); }
  }
  return null;
}

/** cityId("충청남도 천안시 동남구") → 관할 검증 + 재지오코딩 */
async function regeocode(주소, cityId) {
  const parts = cityId.split(/\s+/);
  const sido = parts[0] || '';
  const sidoShort = SIDO_SHORT[sido] || sido;
  const sigungu = parts.slice(1).join(' ');
  const cityPrefix = sigungu || sido;
  const inRegion = (doc) => {
    const a = [doc.address_name || '', doc.road_address_name || '', doc.road_address?.address_name || ''].join(' ');
    const hasSido = a.includes(sido) || a.includes(sidoShort);
    return hasSido && (!sigungu || a.includes(sigungu));
  };
  const road = cleanRoad(주소);
  const q = cityPrefix ? `${cityPrefix} ${road}` : road;

  const j1 = await kakao(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}&size=5`);
  let d = (j1?.documents || []).find(inRegion);
  if (!d) {
    const j2 = await kakao(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=5`);
    d = (j2?.documents || []).find(inRegion);
  }
  if (!d) {
    const full = cityPrefix ? `${cityPrefix} ${주소}` : 주소;
    const j3 = await kakao(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(full)}&size=5`);
    d = (j3?.documents || []).find(inRegion);
  }
  if (d?.x && d?.y) return { lat: parseFloat(d.y), lng: parseFloat(d.x) };
  return null;
}

async function eachMonthGroup(cb) {
  for (const [coll, nested] of [['cloud_lists', true], ['base_lists', false], ['delivery_history', true]]) {
    for (const c of await db.collection(coll).listDocuments()) {
      const cityId = c.id;
      if (!nested) { cb(cityId, c.collection('records'), await c.collection('records').get()); continue; }
      for (const m of await c.collection('months').listDocuments()) {
        cb(cityId, m.collection('records'), await m.collection('records').get());
      }
    }
  }
}

console.log(`[모드] ${WRITE ? '★실제 반영' : 'dry-run(쓰기 없음)'} · 임계 ${RADIUS}km`);
const jobs = [];
await eachMonthGroup((cityId, ref, snap) => {
  const recs = [];
  // 스키마 혼재(B-8): 월별=한글 키(이름·주소), 기본명단·이력=영문 키(name·address)
  snap.forEach((d) => { const r = d.data(); recs.push({ id: d.id, ref: ref.doc(d.id), _lat: Number(r.lat), _lng: Number(r.lng), 이름: S(r.이름 || r.name), 주소: S(r.주소 || r.address || r.standardRoadAddress) }); });
  const { outliers, center } = detectCoordOutliers(recs, { radiusKm: RADIUS });
  outliers.forEach((o) => jobs.push({ cityId, center, ...o }));
});
console.log(`좌표 오류 ${jobs.length}건 재지오코딩 대상\n`);

const backup = [];
let fixed = 0, cleared = 0, done = 0;
for (const j of jobs) {
  const addr = j.record.주소;
  const co = addr ? await regeocode(addr, j.cityId) : null;
  await sleep(120); // Kakao rate limit 여유
  done++;
  let action;
  if (co && haversineKm(co.lat, co.lng, j.center.lat, j.center.lng) <= RADIUS) {
    action = { 주소재지오코딩: true, lat: co.lat, lng: co.lng, 좌표상태: '좌표확인', 좌표검증상태: '', 좌표오류지정: false };
    fixed++;
  } else {
    action = { lat: null, lng: null, 좌표상태: '좌표없음', 좌표오류지정: true, 좌표오류사유: `지자체밖 좌표(${j.distanceKm}km)·재지오코딩 실패` };
    cleared++;
  }
  backup.push({ path: j.record.ref.path, before: { lat: j.record._lat, lng: j.record._lng }, action: co ? 'regeocode' : 'clear' });
  if (WRITE) await j.record.ref.set(action, { merge: true });
  if (done % 25 === 0 || done === jobs.length) console.log(`  ${done}/${jobs.length} · 재지오코딩 ${fixed} · 제거+플래그 ${cleared}`);
}

if (WRITE) {
  fs.writeFileSync(`_tmp_backup_coord_${Date.now()}.json`, JSON.stringify(backup), 'utf8');
  await db.collection('audit_logs').add({ action: 'fix-coord-outliers', total: jobs.length, fixed, cleared, adminEmail: 'script:fix-coord-outliers', createdAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log(`\n✅ 완료 — 재지오코딩 ${fixed}건 · 좌표제거+플래그 ${cleared}건`);
} else {
  console.log(`\n(dry-run) 재지오코딩 성공예상 ${fixed} · 제거예상 ${cleared} · 반영하려면 --write`);
}
process.exit(0);
