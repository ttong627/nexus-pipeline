// 답십리1동(또는 지정 행정동) 기사 실데이터 추출 — 순번 시뮬레이션용
// 추측 금지 원칙: 실제 cloud_lists 저장본(좌표·기사·순번)을 그대로 추출한다.
//
// 사용:
//   node scripts/sim-route-extract.mjs                       # 기본: 답십리1동 전체 기사
//   node scripts/sim-route-extract.mjs --dong 답십리1동 --driver 가명현
//   node scripts/sim-route-extract.mjs --city "서울특별시 동대문구" --month 2026-06
//
// 출력: .sim-data/route-extract.json (gitignore — 개인정보 보호)
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const getArg = (k, def = '') => {
  const i = args.indexOf(`--${k}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};

const DONG = getArg('dong', '답십리1동');
const DRIVER = getArg('driver', ''); // 빈값 = 전체 기사
const CITY = getArg('city', '');     // 빈값 = 전체 도시 스캔
const MONTH = getArg('month', '');   // 빈값 = 전체 월 스캔
const OUT = getArg('out', '.sim-data/route-extract.json');

const norm = (s) => String(s || '').replace(/\s+/g, '');

if (!fs.existsSync('serviceAccountKey.json')) {
  console.error('❌ serviceAccountKey.json 이 프로젝트 루트에 없습니다.');
  console.error('   Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성 → 루트에 저장하세요.');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const pickRecord = (cityId, monthId, docId, r) => ({
  city: cityId,
  month: monthId,
  docId,
  이름: r.이름 || r.name || '',
  주소: r.주소 || r.address || '',
  행정동: r.행정동 || r.dong || '',
  기사: r.기사 || r.driver || '',
  배송순번: r.배송순번 || r.seqNo || '',
  lat: r.lat ?? r._lat ?? null,
  lng: r.lng ?? r._lng ?? null,
  isApt: r.isApt ?? r._isApt ?? false,
});

(async () => {
  console.log(`🔎 cloud_lists 스캔 — dong="${DONG}" driver="${DRIVER || '(전체)'}" city="${CITY || '(전체)'}" month="${MONTH || '(전체)'}"`);

  const allCities = await db.collection('cloud_lists').listDocuments();
  const cityRefs = CITY
    ? allCities.filter((c) => norm(c.id) === norm(CITY) || norm(c.id).includes(norm(CITY)))
    : allCities;
  console.log(`도시 ${allCities.length}개 중 대상 ${cityRefs.length}개:`, cityRefs.map((c) => c.id));

  const hits = [];
  for (const cityRef of cityRefs) {
    const allMonths = await cityRef.collection('months').listDocuments();
    const monthRefs = MONTH ? allMonths.filter((m) => m.id === MONTH) : allMonths;
    for (const mRef of monthRefs) {
      const snap = await mRef.collection('records').get();
      snap.forEach((d) => {
        const r = d.data();
        const dong = r.행정동 || r.dong || '';
        const addr = r.주소 || '';
        const driver = r.기사 || r.driver || '';
        const dongMatch = norm(dong).includes(norm(DONG)) || norm(addr).includes(norm(DONG));
        const driverMatch = !DRIVER || norm(driver).includes(norm(DRIVER));
        if (dongMatch && driverMatch) hits.push(pickRecord(cityRef.id, mRef.id, d.id, r));
      });
    }
  }

  console.log(`\n✅ 매칭 ${hits.length}건`);
  const byDriver = {};
  hits.forEach((h) => { byDriver[h.기사 || '(미배정)'] = (byDriver[h.기사 || '(미배정)'] || 0) + 1; });
  console.log('기사별 분포:', byDriver);
  const withCoord = hits.filter((h) => Number(h.lat) && Number(h.lng));
  const withSeq = hits.filter((h) => parseInt(h.배송순번, 10) > 0);
  console.log(`좌표 보유: ${withCoord.length}/${hits.length} · 순번 보유: ${withSeq.length}/${hits.length}`);
  const byCityMonth = {};
  hits.forEach((h) => { const k = `${h.city} / ${h.month}`; byCityMonth[k] = (byCityMonth[k] || 0) + 1; });
  console.log('도시·월 분포:', byCityMonth);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(hits, null, 2), 'utf8');
  console.log(`\n💾 저장: ${OUT} (${hits.length}건)`);
  process.exit(0);
})().catch((e) => { console.error('추출 실패:', e); process.exit(1); });
