// ══════════════════════════════════════════════════════════════════════════
//  기준명단 엑셀 → 기본명단(base_lists) 특이사항 복원
//  형 지시(2026-07-22): "기준명단과 대조해서 차이나거나 빠진 특이사항을 추가.
//                        단 시스템 찌꺼기는 정제하고, 다른 건 합쳐라."
//
//  · 매칭: 이름 + (휴대폰 끝8자리)  = S-1 강키
//  · 정제: src/utils/noteSanitizer.js 의 sanitizeNote (앱과 동일 규칙 A-33)
//  · 병합: mergeNotes — DB값 + 엑셀에만 있는 문구 (중복 제거 · 무손실 M-1)
//
//  실행: node scripts/restore-notes-from-baseline.mjs "<엑셀경로>" "<지자체>"
//        node scripts/restore-notes-from-baseline.mjs "<엑셀경로>" "<지자체>" --write
// ══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import XLSX from 'xlsx';
import admin from 'firebase-admin';
import { sanitizeNote, mergeNotes } from '../src/utils/noteSanitizer.js';

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const XLSX_PATH = ARGS[0];
const CITY = ARGS[1];
if (!XLSX_PATH || !CITY) { console.error('사용법: node scripts/restore-notes-from-baseline.mjs "<엑셀>" "<지자체>" [--write]'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();

const S = (v) => String(v ?? '').trim();
const nospace = (v) => S(v).replace(/\s/g, '');
const dig = (v) => S(v).replace(/[^0-9]/g, '');
const pKey = (v) => { const d = dig(v); return d.length >= 8 ? d.slice(-8) : ''; };

const gNote = (r) => S(r.note || r['특이사항'] || r['비고']);
const gAddr = (r) => S(r.address || r['주소'] || r.standardRoadAddress);

// ── 엑셀 로드: 사람별 특이사항 합집합 ─────────────────────────────
const wb = XLSX.readFile(XLSX_PATH);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
const head = rows.findIndex(r => r.some(c => /수령자명|이름|성명/.test(S(c))));
if (head < 0) { console.error('헤더행을 찾지 못했습니다.'); process.exit(1); }
const H = rows[head].map(S);
const idx = (re) => H.findIndex(h => re.test(h));
const cName = idx(/수령자명|이름|성명/), cPhone = idx(/휴대|연락|전화/), cNote = idx(/특이사항|비고|메모/);
console.log(`엑셀 헤더행 ${head + 1} · 이름열 ${cName} · 휴대폰열 ${cPhone} · 특이사항열 ${cNote}`);

const xl = new Map();
for (const r of rows.slice(head + 1)) {
  const nm = S(r[cName]); if (!nm) continue;
  const k = `${nm}|${pKey(r[cPhone])}`;
  if (!xl.has(k)) xl.set(k, new Set());
  const n = S(r[cNote]); if (n) xl.get(k).add(n);
}
console.log(`엑셀 고유인원 ${xl.size.toLocaleString()}`);

// ── DB 대조 ────────────────────────────────────────────────────────
const snap = await db.collection('base_lists').doc(CITY).collection('records').get();
console.log(`DB ${CITY} 레코드 ${snap.size.toLocaleString()}`);

const dongDict = new Set();
snap.forEach(d => { const r = d.data(); [r.legalDong, r['법정동'], r.dong, r['행정동']].forEach(v => { if (S(v)) dongDict.add(nospace(v)); }); });

const plans = [];
let noExcel = 0, unchanged = 0, allJunk = 0;

snap.forEach(d => {
  const r = d.data();
  const k = `${S(r.name || r['이름'])}|${pKey(r.mobile || r['휴대폰'] || r.landline || r['유선전화'])}`;
  const xlNotes = xl.get(k);
  if (!xlNotes || xlNotes.size === 0) { noExcel++; return; }

  const ctx = {
    address: gAddr(r), detailAddr: S(r.detailAddr || r.detailAddress || r['상세주소']),
    buildingName: S(r.buildingName || r['건물명']), legalDong: S(r.legalDong || r['법정동']),
    realName: S(r.realName || r['본명']), dong: S(r.dong || r['행정동']), dongDict,
  };

  // 엑셀 문구를 먼저 각각 정제(시스템 찌꺼기 제거) → 살아남은 것만 병합
  let add = '';
  for (const n of xlNotes) { const c = sanitizeNote(n, ctx); if (c.note) add = mergeNotes(add, c.note); }
  if (!add) { allJunk++; return; }

  const before = gNote(r);
  const merged = mergeNotes(before, add);
  if (nospace(merged) === nospace(before)) { unchanged++; return; }

  // 병합 결과를 마지막으로 한 번 더 검증(컬럼 이동 반영)
  const fin = sanitizeNote(merged, ctx);
  const upd = {};
  const ko = Object.prototype.hasOwnProperty.call(r, '특이사항');
  if (nospace(fin.note) !== nospace(before)) upd[ko ? '특이사항' : 'note'] = fin.note;
  if (fin.realName) upd[ko ? '본명' : 'realName'] = fin.realName;
  if (fin.legalDong) upd[ko ? '법정동' : 'legalDong'] = fin.legalDong;
  if (fin.buildingName) upd[ko ? '건물명' : 'buildingName'] = fin.buildingName;
  if (fin.detailAddr) upd[Object.prototype.hasOwnProperty.call(r, 'detailAddr') ? 'detailAddr' : 'detailAddress'] = fin.detailAddr;
  if (Object.keys(upd).length === 0) { unchanged++; return; }

  plans.push({ ref: d.ref, before, after: fin.note, upd, kind: before ? '병합' : '신규채움' });
});

const nNew = plans.filter(p => p.kind === '신규채움').length;
console.log(`\n[모드] ${WRITE ? '★실제 반영' : 'dry-run(쓰기 없음)'}`);
console.log(`복원 대상 ${plans.length.toLocaleString()} (공란→채움 ${nNew.toLocaleString()} · 병합 ${(plans.length - nNew).toLocaleString()})`);
console.log(`대상 아님 → 엑셀에 없음 ${noExcel.toLocaleString()} · 변화 없음 ${unchanged.toLocaleString()} · 엑셀이 전부 찌꺼기 ${allJunk.toLocaleString()}`);
plans.slice(0, 12).forEach(p => console.log(`   · [${p.kind}] "${p.before}" → "${p.after}"`));

if (!WRITE) { console.log('\n(dry-run) 반영하려면 --write'); process.exit(0); }

fs.writeFileSync(`_tmp_backup_restore_${Date.now()}.json`, JSON.stringify(plans.map(p => ({ path: p.ref.path, before: p.before })), null, 0), 'utf8');
let done = 0;
for (let i = 0; i < plans.length; i += 499) {
  const chunk = plans.slice(i, i + 499);
  const batch = db.batch();
  chunk.forEach(p => batch.update(p.ref, p.upd));
  await batch.commit();
  done += chunk.length;
  console.log(`  커밋 ${done.toLocaleString()}/${plans.length.toLocaleString()}`);
}
await db.collection('audit_logs').add({
  action: 'restore-notes-from-baseline', city: CITY, updateCount: plans.length, newFilled: nNew,
  adminEmail: 'script:restore-notes-from-baseline', createdAt: admin.firestore.FieldValue.serverTimestamp(),
});
console.log(`✅ 복원 완료 ${plans.length.toLocaleString()}건`);
process.exit(0);
