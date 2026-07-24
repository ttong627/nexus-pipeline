// 전 지자체 일괄 법정동 백필 러너 — cloud_lists 모든 city/month 순회하며 backfill-legaldong.mjs --write
//   사용: node scripts/backfill-all.mjs   (각 명단에 --write 반영, 집계 로그 출력)
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const key = JSON.parse(readFileSync(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

async function main() {
  const targets = [];
  const cities = await db.collection('cloud_lists').listDocuments();
  for (const c of cities) {
    const months = await c.collection('months').listDocuments();
    for (const m of months) targets.push([c.id, m.id]);
  }
  console.log(`대상 명단: ${targets.length}개\n` + targets.map(([c, m]) => `  ${c} / ${m}`).join('\n'));
  console.log('\n' + '='.repeat(60) + '\n일괄 백필 시작\n' + '='.repeat(60));

  let ok = 0, fail = 0;
  for (const [city, month] of targets) {
    console.log(`\n▶▶▶ ${city} / ${month}`);
    const r = spawnSync('node', ['scripts/backfill-legaldong.mjs', city, month, '--write'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = String(r.stdout || '');
    // 집계 줄만 발췌 출력
    const lines = out.split('\n');
    const idx = lines.findIndex(l => l.includes('=== 집계'));
    if (idx >= 0) console.log(lines.slice(idx, idx + 12).join('\n'));
    const writeLine = lines.find(l => l.includes('반영 완료') || l.includes('★ WRITE'));
    if (writeLine) console.log('  ', writeLine.trim());
    if (r.status === 0 && out.includes('반영 완료')) { ok++; }
    else { fail++; console.log('  ⚠️ 실패/미완:', (r.stderr || '').split('\n').slice(0, 3).join(' ')); }
  }
  console.log(`\n${'='.repeat(60)}\n일괄 백필 종료 — 성공 ${ok} / 실패 ${fail} / 총 ${targets.length}`);
  process.exit(0);
}
main().catch(e => { console.error('러너 실패:', e.message); process.exit(1); });
