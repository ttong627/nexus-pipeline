// 특이사항 수집·보유 실태 실측 — 읽기 전용. 쓰기 없음.
//
//   왜: 매칭키 실측(measure-note-match)에서 매칭률이 이미 99.9% 로 나왔다.
//   형이 겪는 "자꾸 빠진다"는 **키 문제가 아니다.** 그럼 어디서 빠지는가를 센다.
//
//   네 가지를 따로 센다:
//     ①기본명단에 특이사항이 있는 비율            (이식할 재고가 있는가)
//     ②월 명단에 특이사항이 있는 비율              (현장에 실제로 보이는가)
//     ③월 명단엔 있는데 기본명단엔 없는 건 = **수집 누락**(형 지시 ①의 대상)
//     ④기본명단엔 있는데 월 명단엔 없는 건 = **이식 누락**(형 지시 ②의 대상)
//   ③④는 같은 사람(강키 매칭 성립분)에 한해서만 센다 — 다른 사람끼리 비교하면 무의미하다.
//
//   사용: node scripts/measure-note-coverage.mjs [--city "..."] [--limit 8]

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
// ★배포될 코드 그대로 잰다 — 측정용 사본을 따로 두면 그 사본만 맞는 결과가 나온다.
import { buildBaseIndex, matchBase, MATCH_REASON, pick } from '../src/engine/baseMatcher.js';

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8')),
  ),
});
const db = admin.firestore();

const args = process.argv.slice(2);
const cityArg = args.includes('--city') ? args[args.indexOf('--city') + 1] : null;
const LIMIT = Number(args.includes('--limit') ? args[args.indexOf('--limit') + 1] : 8);
const SHOW = args.includes('--show');

const val = pick;

// ◆ 이식표시를 걷어낸 '그 명단 고유의' 특이사항
const ownNote = (r) => String(val(r, 'note', '특이사항')).replace(/\s*◆[^◆]*/g, '').replace(/\(본명:[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
// ◆ 포함 전체(현장에 보이는 값)
const fullNote = (r) => String(val(r, 'note', '특이사항')).trim();

const buildIndex = (recs) => buildBaseIndex(recs, { idOf: (r) => r.__id });
const lookup = (index, rec) => {
  const m = matchBase(index, rec);
  return m.reason === MATCH_REASON.AMBIGUOUS ? null : m.entry;   // 모호는 채택하지 않는다(S-2)
};

const cityRefs = await db.collection('cloud_lists').listDocuments();
let cities = cityRefs.map((c) => c.id);
if (cityArg) cities = cities.filter((c) => c === cityArg);

const T = { recs: 0, monthNote: 0, baseNote: 0, matched: 0, lostCollect: 0, lostImport: 0, bothEmpty: 0 };
const samples = { collect: [], import: [] };

let done = 0;
for (const city of cities) {
  if (done >= LIMIT) break;
  const baseSnap = await db.collection(`base_lists/${city}/records`).get();
  if (baseSnap.empty) continue;
  const baseRecs = baseSnap.docs.map((d) => ({ __id: d.id, ...d.data() }));

  const monthRefs = await db.collection(`cloud_lists/${city}/months`).listDocuments();
  const latest = monthRefs.map((m) => m.id).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().pop();
  if (!latest) continue;
  const recSnap = await db.collection(`cloud_lists/${city}/months/${latest}/records`).get();
  if (recSnap.empty) continue;
  const recs = recSnap.docs.map((d) => ({ __id: d.id, ...d.data() }));

  const idx = buildIndex(baseRecs);
  const baseWithNote = baseRecs.filter((r) => ownNote(r)).length;

  let mNote = 0, matched = 0, lostCollect = 0, lostImport = 0, bothEmpty = 0;
  for (const r of recs) {
    const mn = fullNote(r);
    if (mn) mNote++;
    const b = lookup(idx, r);
    if (!b) continue;
    matched++;
    const bn = ownNote(b);
    const rn = ownNote(r);   // 월 명단이 자체로 가진 특이사항(◆ 제외)
    if (rn && !bn) { lostCollect++; if (samples.collect.length < 8) samples.collect.push({ city, name: val(r, '이름', 'name'), note: rn.slice(0, 60) }); }
    if (bn && !mn) { lostImport++; if (samples.import.length < 8) samples.import.push({ city, name: val(r, '이름', 'name'), note: bn.slice(0, 60) }); }
    if (!rn && !bn) bothEmpty++;
  }
  const pc = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '-');
  console.log(`■ ${city} · ${latest}`);
  console.log(`   명단 ${recs.length.toLocaleString()} · 특이사항 보유 ${mNote.toLocaleString()} (${pc(mNote, recs.length)})`);
  console.log(`   기본명단 ${baseRecs.length.toLocaleString()} · 특이사항 보유 ${baseWithNote.toLocaleString()} (${pc(baseWithNote, baseRecs.length)})`);
  console.log(`   강키 매칭 ${matched.toLocaleString()}건 중 → 🔴수집누락(월엔 있고 기본엔 없음) ${lostCollect.toLocaleString()} · 🟠이식누락(기본엔 있고 월엔 없음) ${lostImport.toLocaleString()} · 양쪽 공란 ${bothEmpty.toLocaleString()}`);
  console.log('');

  T.recs += recs.length; T.monthNote += mNote; T.baseNote += baseWithNote;
  T.matched += matched; T.lostCollect += lostCollect; T.lostImport += lostImport; T.bothEmpty += bothEmpty;
  done++;
}

const p = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '-');
console.log('══ 합계 ══');
console.log(`월 명단 ${T.recs.toLocaleString()}건 · 특이사항 보유 ${T.monthNote.toLocaleString()} (${p(T.monthNote, T.recs)})`);
console.log(`강키 매칭 ${T.matched.toLocaleString()}건 기준`);
console.log(`  🔴 수집 누락(월엔 있는데 기본명단에 안 쌓임) ${T.lostCollect.toLocaleString()} (${p(T.lostCollect, T.matched)})`);
console.log(`  🟠 이식 누락(기본엔 있는데 이번 달에 안 붙음) ${T.lostImport.toLocaleString()} (${p(T.lostImport, T.matched)})`);
console.log(`  ⚪ 양쪽 공란 ${T.bothEmpty.toLocaleString()} (${p(T.bothEmpty, T.matched)})`);
if (SHOW) {
  console.log('\n-- 수집 누락 표본 --'); samples.collect.forEach((s) => console.log(`   ${s.city} ${s.name}: ${s.note}`));
  console.log('-- 이식 누락 표본 --'); samples.import.forEach((s) => console.log(`   ${s.city} ${s.name}: ${s.note}`));
}
console.log('\n읽기 전용 — 쓰기 없음');
process.exit(0);
