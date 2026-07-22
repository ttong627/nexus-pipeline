// ══════════════════════════════════════════════════════════════════════════
//  DB 기존 레코드의 이름칸 `홍길동(750315)` → 이름 · 생년월일 분리 (A-34)
//  형 지시(2026-07-22): "용산구는 DB에 있는 내용만 이름과 생년월일 구분해서 넣어줘."
//
//  사고 형태: A-1(5자 절단)이 먼저 걸려 이름은 `이정숙(6` 로 잘리고,
//             원본은 본명 컬럼에 `이정숙(601128)` 로 남아 있다.
//             → 본명 컬럼을 근거로 이름·생년월일을 복구하고 본명은 비운다.
//
//  실행: node scripts/split-name-birth-db.mjs "<지자체>"            (dry-run)
//        node scripts/split-name-birth-db.mjs "<지자체>" --write
//        node scripts/split-name-birth-db.mjs --all [--write]        (전 지자체)
// ══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import admin from 'firebase-admin';
import { splitNameBirth } from '../src/utils/noteSanitizer.js';

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const ALL = ARGS.includes('--all');
const CITY = ARGS.find(a => !a.startsWith('--'));
if (!CITY && !ALL) { console.error('사용법: node scripts/split-name-birth-db.mjs "<지자체>" [--write] | --all [--write]'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();

const S = (v) => String(v ?? '').trim();
/** 생년월일 표기 정규화 (CLAUDE.md §9): 8자리→뒤6자리, 6자리→YY.MM.DD */
function normalizeBirth(v) {
  const d = S(v).replace(/[^\d]/g, '');
  const six = d.length === 8 ? d.slice(2) : d.length === 6 ? d : '';
  if (!six) return S(v);
  return `${six.slice(0, 2)}.${six.slice(2, 4)}.${six.slice(4, 6)}`;
}

const plans = [];
const skipped = [];

async function scanCity(cityRef) {
  const snap = await cityRef.collection('records').get();
  snap.forEach(d => {
    const r = d.data();
    const ko = Object.prototype.hasOwnProperty.call(r, '이름');
    const name = S(r.name || r['이름']);
    const real = S(r.realName || r['본명']);
    const birth = S(r.birthKey || r['생년월일']);

    // 근거는 본명 컬럼(원본 보존값) 우선, 없으면 이름 자체
    const src = real || name;
    const sp = splitNameBirth(src);
    if (!sp.birth) {
      // 이름이 `이정숙(6` 처럼 잘렸는데 본명이 없으면 복구 불가 → 보고만
      if (/[(（]/.test(name) && !real) skipped.push(`${cityRef.id} | 이름[${name}] 본명없음 → 복구불가`);
      return;
    }
    if (birth) { skipped.push(`${cityRef.id} | ${sp.name} 생년월일 이미 있음(${birth}) → 건너뜀`); return; }

    const upd = {};
    upd[ko ? '이름' : 'name'] = sp.name;
    upd[ko ? '생년월일' : 'birthKey'] = normalizeBirth(sp.birth);
    upd[ko ? '본명' : 'realName'] = '';        // 이름과 같아졌으므로 비운다
    plans.push({ ref: d.ref, city: cityRef.id, before: { name, real, birth }, after: { ...upd } });
  });
}

const cityRefs = ALL
  ? await db.collection('base_lists').listDocuments()
  : [db.collection('base_lists').doc(CITY)];
for (const c of cityRefs) await scanCity(c);

console.log(`[모드] ${WRITE ? '★실제 반영' : 'dry-run(쓰기 없음)'} · 대상 ${ALL ? '전 지자체' : CITY}`);
console.log(`분리 대상 ${plans.length}건 · 건너뜀 ${skipped.length}건`);
plans.slice(0, 20).forEach(p => console.log(`   · [${p.city}] 이름"${p.before.name}" 본명"${p.before.real}"  →  이름"${Object.values(p.after)[0]}" 생년월일"${Object.values(p.after)[1]}"`));
if (skipped.length) { console.log('--- 건너뜀 예시 ---'); skipped.slice(0, 10).forEach(s => console.log(`   · ${s}`)); }

if (!WRITE) { console.log('\n(dry-run) 반영하려면 --write'); process.exit(0); }

fs.writeFileSync(`_tmp_backup_namebirth_${Date.now()}.json`, JSON.stringify(plans.map(p => ({ path: p.ref.path, before: p.before })), null, 0), 'utf8');
let done = 0;
for (let i = 0; i < plans.length; i += 499) {
  const chunk = plans.slice(i, i + 499);
  const batch = db.batch();
  chunk.forEach(p => batch.update(p.ref, p.after));
  await batch.commit();
  done += chunk.length;
  console.log(`  커밋 ${done}/${plans.length}`);
}
await db.collection('audit_logs').add({
  action: 'split-name-birth-db', city: ALL ? 'ALL' : CITY, updateCount: plans.length,
  adminEmail: 'script:split-name-birth-db', createdAt: admin.firestore.FieldValue.serverTimestamp(),
});
console.log(`✅ 분리 완료 ${plans.length}건`);
process.exit(0);
