/**
 * leakAlert 실동작 검증 — 배포 성공 메시지가 아니라 "실제로 흘려보내" 확인한다.
 *
 *   node verify-leak-alert.mjs          → 검증 로그 주입(감시 규칙 ①③이 걸리도록)
 *   node verify-leak-alert.mjs --clean  → 주입한 검증 로그만 삭제
 *
 * ★가짜 열람 기록이 감사 자료에 남으면 나중 분석을 오염시킨다.
 *   그래서 source='deploy_check' 표식을 달고, 확인 후 반드시 --clean 으로 지운다.
 */
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

const ROOT = 'I:/ttong_project/nexus-pipeline-clean';
const key = JSON.parse(readFileSync(`${ROOT}/serviceAccountKey.json`, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const MARK = 'deploy_check';
const COL = 'share_access_logs';
const clean = process.argv.includes('--clean');

const removeMarked = async () => {
  const snap = await db.collection(COL).where('source', '==', MARK).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
};

if (clean) {
  const n = await removeMarked();
  console.log(`검증 로그 삭제: ${n}건`);
  process.exit(0);
}

// 기존 검증 잔재부터 치운다(중복 판정 방지).
const stale = await removeMarked();
if (stale) console.log(`(이전 검증 잔재 ${stale}건 정리)`);

const at = new Date().toISOString();
const phone = '+821000000000'; // 실재하지 않는 번호 — 실제 기사와 섞이지 않게
const doc = {
  at,
  phone,
  driverName: '감시최종검증2',
  shareId: 'verify-telegram',
  count: 480,          // 임계 300 초과 → ① bulk_read
  source: MARK,        // 검증 표식(삭제 기준)
  ip: '0.0.0.0',
};

const ref = await db.collection(COL).add(doc);
console.log(`주입 완료: ${ref.id} (count=${doc.count}, KST시 ${new Date(Date.now() + 9 * 3600 * 1000).getUTCHours()})`);
console.log('→ 텔레그램 도착 여부와 Functions 로그를 확인한 뒤 --clean 으로 지울 것');
process.exit(0);
