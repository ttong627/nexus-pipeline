// 안양시 동안구, 여주시, 동대문구 — 문자수신 누락 레코드를 'Y'로 일괄 업데이트
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDnKkUkKgZIfF6eVuClwOdl2nsG1q8QUL8',
  authDomain: 'logis-op.firebaseapp.com',
  projectId: 'logis-op',
  storageBucket: 'logis-op.firebasestorage.app',
  messagingSenderId: '31783407891',
  appId: '1:31783407891:web:26df5006a2b0268a334ae6',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const CITIES = [
  '경기도 안양시 동안구',
  '경기도 여주시',
  '서울특별시 동대문구',
];

async function getLatestMonthId(cityId) {
  const citySnap = await getDocs(collection(db, 'cloud_lists', cityId, 'months'));
  const months = citySnap.docs.map(d => d.id).sort((a, b) => b.localeCompare(a));
  return months[0] || null;
}

async function fixSmsForCity(cityId) {
  const monthId = await getLatestMonthId(cityId);
  if (!monthId) { console.log(`[${cityId}] 월 없음, 스킵`); return; }

  const recSnap = await getDocs(collection(db, 'cloud_lists', cityId, 'months', monthId, 'records'));
  const targets = recSnap.docs.filter(d => (d.data().문자수신 || '') !== 'Y');

  if (targets.length === 0) {
    console.log(`[${cityId}] ${monthId} — 이미 모두 Y, 업데이트 불필요`);
    return;
  }

  let updated = 0;
  for (let i = 0; i < targets.length; i += 499) {
    const batch = writeBatch(db);
    targets.slice(i, i + 499).forEach(d =>
      batch.update(doc(db, 'cloud_lists', cityId, 'months', monthId, 'records', d.id), { 문자수신: 'Y' })
    );
    await batch.commit();
    updated += Math.min(499, targets.length - i);
    process.stdout.write(`\r  [${cityId}] 업데이트 ${updated}/${targets.length}건`);
  }
  console.log(`\n  → 완료: ${targets.length}건 문자수신 Y 설정 (${monthId})`);
}

async function main() {
  console.log('▶ 문자수신 Y 일괄 설정 시작\n');
  for (const city of CITIES) {
    process.stdout.write(`\n[${city}] 처리 중...\n`);
    await fixSmsForCity(city);
  }
  console.log('\n✅ 전체 완료');
  process.exit(0);
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
