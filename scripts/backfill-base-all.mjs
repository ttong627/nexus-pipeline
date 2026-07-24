// 전 city base_lists 법정동 백필 러너 — base_lists 모든 city 순회하며 backfill-base-legaldong.mjs --write
//   사용: node scripts/backfill-base-all.mjs
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
  const cities = (await db.collection('base_lists').listDocuments()).map(c => c.id);
  console.log(`대상 city: ${cities.length}개\n` + cities.map(c => '  ' + c).join('\n'));
  console.log('\n' + '='.repeat(60) + '\nbase_lists 일괄 백필 시작\n' + '='.repeat(60));
  let ok = 0, fail = 0;
  for (const city of cities) {
    console.log(`\n▶▶▶ ${city}`);
    const r = spawnSync('node', ['scripts/backfill-base-legaldong.mjs', city, '--write'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const lines = String(r.stdout || '').split('\n');
    const idx = lines.findIndex(l => l.includes('=== 집계'));
    if (idx >= 0) console.log(lines.slice(idx, idx + 11).join('\n'));
    const w = lines.find(l => l.includes('반영 완료'));
    if (w) console.log('  ', w.trim());
    if (r.status === 0 && String(r.stdout).includes('반영 완료')) ok++;
    else { fail++; console.log('  ⚠️ 실패/미완:', String(r.stderr || '').split('\n').slice(0, 3).join(' ')); }
  }
  console.log(`\n${'='.repeat(60)}\nbase_lists 백필 종료 — 성공 ${ok} / 실패 ${fail} / 총 ${cities.length}`);
  process.exit(0);
}
main().catch(e => { console.error('러너 실패:', e.message); process.exit(1); });
