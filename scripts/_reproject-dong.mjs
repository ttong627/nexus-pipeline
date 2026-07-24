// 아파트 레코드 좌표를 VWorld 동(棟)별 좌표로 재좌표
// 사용: node reproject-dong.mjs "경기도 부천시 오정구" 2026-07 [--write]
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const svc = JSON.parse(readFileSync('I:/ttong_project/nexus-pipeline-clean/serviceAccountKey.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();
const API = 'https://nexus-address-api-31783407891.asia-northeast3.run.app';

const WRITE = process.argv.includes('--write');
const city = process.argv[2];
const monthId = process.argv[3];
if (!city || !monthId) { console.error('city, monthId 필요'); process.exit(1); }

const parseDongNo = (detail) => {
  const s = String(detail || '').trim(); if (!s) return '';
  const ko = s.match(/([가-힣A-Za-z])\s*동(?![가-힣])/); if (ko) return ko[1];
  const num = s.match(/^\s*(\d{1,3})\s*동(?![가-힣])/); if (num) return num[1];
  const dash = s.match(/^\s*(\d{1,3})\s*-\s*\d/); if (dash) return dash[1];
  return '';
};
const post = async (p, b) => {
  try { const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); if (!r.ok) return null; const j = await r.json(); return j?.ok ? j.data : null; } catch { return null; }
};
const haversine = (a, b) => {
  const R = 6371000, toR = (d) => d * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

(async () => {
  const recsRef = db.collection('cloud_lists').doc(city).collection('months').doc(monthId).collection('records');
  const snap = await recsRef.get();
  const targets = snap.docs.filter((d) => { const r = d.data(); return (r.isApt || r.건물명) && parseDongNo(r.detailAddress) && r.standardRoadAddress; });
  const sigungu = city.split(/\s+/).slice(1).join(' ');
  console.log(`${city} ${monthId} — 아파트+동 대상: ${targets.length}건 (모드: ${WRITE ? 'WRITE' : 'DRY-RUN'})`);

  let done = 0, dong = 0, updated = 0, movedGt5 = 0; const dists = []; const coordByComplex = {};
  const worker = async (list) => {
    for (const d of list) {
      const r = d.data(); const dn = parseDongNo(r.detailAddress);
      const res = await post('/v1/building/dong-coords', { roadAddress: r.standardRoadAddress, complexName: r.건물명 || r.buildingName || '', dongNo: `${dn}동`, sigungu });
      done++;
      if (res && res.matched === 'dong' && res.lat && res.lng) {
        dong++;
        const nlat = Number(res.lat), nlng = Number(res.lng);
        if (r.lat && r.lng) { const dist = haversine({ lat: r.lat, lng: r.lng }, { lat: nlat, lng: nlng }); dists.push(dist); if (dist > 5) movedGt5++; }
        const cn = r.건물명 || ''; (coordByComplex[cn] = coordByComplex[cn] || new Set()).add(`${nlat.toFixed(5)},${nlng.toFixed(5)}`);
        if (WRITE) { await d.ref.update({ lat: nlat, lng: nlng, 좌표출처: 'vworld-dong', dongFloors: res.floors ?? null, 좌표상태: '좌표확인', 좌표수정일시: admin.firestore.FieldValue.serverTimestamp() }); updated++; }
      }
      if (done % 300 === 0) console.log(`  진행 ${done}/${targets.length} (dong ${dong})`);
    }
  };
  const chunks = Array.from({ length: 10 }, () => []); targets.forEach((d, i) => chunks[i % 10].push(d));
  await Promise.all(chunks.map(worker));

  const avg = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;
  const multiDong = Object.values(coordByComplex).filter((s) => s.size >= 2).length;
  console.log(`\n=== 결과 ===`);
  console.log(`dong 매칭: ${dong}/${targets.length}`);
  console.log(`기존 대비 이동: >5m ${movedGt5}건, 평균 ${avg.toFixed(1)}m, 최대 ${dists.length ? Math.max(...dists).toFixed(0) : 0}m`);
  console.log(`동별 좌표 분산된 단지(고유좌표 2+): ${multiDong}개`);
  console.log(WRITE ? `\n✅ 갱신 완료: ${updated}건` : `\n(DRY-RUN — 실제 갱신 안 함. --write 붙이면 갱신)`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
