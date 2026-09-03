// 특이사항 매칭률 실측 — 읽기 전용. 쓰기 없음.
//
//   왜: 형 지시 2026-09-03 *"매칭이 자꾸 빠지는 경우가 발생하는데 매칭률을 높힐 수 있는
//   모든 방법을 다 적용해줘. 미스 매칭이나 오탐하면 절대 안돼."*
//   추측으로 키를 넓히면 오매칭이 난다. **운영 데이터로 무엇이 몇 건 빠지는지 먼저 센다.**
//
//   무엇을 재나: 각 지자체의 base_lists(기본명단) 대 cloud_lists(월 명단)를 실제로 대조해
//     ①현재 방식(A안: else-if 등록 + 전체자리 전화 + normalizeBirth/parseBirthDate 혼용)
//     ②개선안(B안: 모든 강키 병렬 등록 + 끝8자리 전화 + 정규화 통일)
//   각각의 매칭률과, B안이 새로 잡은 건의 **오매칭 위험**(후보 2건 이상 = 모호)을 함께 센다.
//
//   사용: node scripts/measure-note-match.mjs [--city "서울특별시 동대문구"] [--limit 5]

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8')),
  ),
});
const db = admin.firestore();

const args = process.argv.slice(2);
const cityArg = args.includes('--city') ? args[args.indexOf('--city') + 1] : null;
const LIMIT = Number(args.includes('--limit') ? args[args.indexOf('--limit') + 1] : 6);

// ── 현행 정규화(코드 그대로 복사 — 측정이므로 import 대신 동일 구현) ──
const digitsOnly = (v) => String(v || '').replace(/[^\d]/g, '');

// src/utils/parsers.js normalizeBirth (base_lists 인덱스가 쓰는 것)
const normalizeBirth = (raw) => {
  const s = String(raw ?? '').trim();
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(s)) return s;
  const d = s.replace(/[^0-9]/g, '');
  if (d.length === 8) return `${d.slice(2, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
  if (d.length === 6) return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 6)}`;
  return '';
};

// src/utils/parsers.js parseBirthDate (월 명단 쪽이 쓰는 것) — 비정형이면 원문을 그대로 돌려준다
const parseBirthDate = (val) => {
  if (!val) return '';
  const d = String(val).replace(/[^\d]/g, '');
  if (d.length === 6) return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 6)}`;
  if (d.length === 8) return `${d.slice(2, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
  const str = String(val).trim();
  if (/^\d{2}[-./]\d{2}[-./]\d{2}$/.test(str)) return str.replace(/[-/]/g, '.');
  return str;
};

// ── 개선안 정규화 ──
const nameKeyB = (v) => String(v || '').normalize('NFC').replace(/\s+/g, '').trim();
const phone8 = (v) => { const d = digitsOnly(v); return d.length >= 8 ? d.slice(-8) : ''; };
const birthB = (v) => normalizeBirth(v); // 양쪽 동일 함수로 통일

const val = (r, ...keys) => { for (const k of keys) { const v = r?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return ''; };

function buildIndexA(baseRecs) {
  // 현행 DbImportModal 방식 그대로: else-if 로 키 하나만 등록
  const map = {};
  const tsMs = (r) => { const u = r?.updatedAt; if (!u) return 0; if (typeof u.toMillis === 'function') return u.toMillis(); if (typeof u?.seconds === 'number') return u.seconds * 1000; if (typeof u === 'number') return u; return 0; };
  const put = (k, r) => { const prev = map[k]; if (!prev || tsMs(r) >= tsMs(prev)) map[k] = r; };
  for (const r of baseRecs) {
    const nm = String(val(r, 'name', '이름')).trim();
    if (!nm) continue;
    const bk = r.birthKey || normalizeBirth(val(r, 'birth', '생년월일'));
    const ph = digitsOnly(val(r, 'mobile', '휴대폰'));
    const ld = digitsOnly(val(r, 'landline', '유선전화'));
    if (bk) put(`${nm}_${bk}`, r);
    else if (ph.length >= 9) put(`ph_${nm}_${ph}`, r);
    else if (ld.length >= 9) put(`ld_${nm}_${ld}`, r);
  }
  return map;
}

function lookupA(map, rec) {
  const name = String(val(rec, '이름', 'name')).trim();
  const birthKey = parseBirthDate(val(rec, '생년월일', 'birth'));
  const dph = digitsOnly(val(rec, '휴대폰', 'mobile'));
  const dld = digitsOnly(val(rec, '유선전화', 'landline'));
  let e = null;
  if (birthKey) e = map[`${name}_${birthKey}`] || null;
  if (!e && dph.length >= 9) e = map[`ph_${name}_${dph}`] || null;
  if (!e && dld.length >= 9) e = map[`ld_${name}_${dld}`] || null;
  return e;
}

// 개선안: 강키를 모두 병렬 등록. 값은 배열(후보 여러 건이면 모호 판정을 위해 전부 보관)
function buildIndexB(baseRecs) {
  const map = new Map();
  const add = (k, r) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(r); };
  for (const r of baseRecs) {
    const nm = nameKeyB(val(r, 'name', '이름'));
    if (!nm) continue;
    const bk = birthB(r.birthKey || val(r, 'birth', '생년월일'));
    const p8 = phone8(val(r, 'mobile', '휴대폰'));
    const l8 = phone8(val(r, 'landline', '유선전화'));
    if (bk) add(`b|${nm}|${bk}`, r);
    if (p8) add(`p|${nm}|${p8}`, r);   // ★생년월일이 있어도 전화 키를 같이 등록(현행은 안 한다)
    if (l8) add(`l|${nm}|${l8}`, r);
  }
  return map;
}

function lookupB(map, rec) {
  const nm = nameKeyB(val(rec, '이름', 'name'));
  if (!nm) return { hit: null, why: 'no-name' };
  const bk = birthB(val(rec, '생년월일', 'birth'));
  const p8 = phone8(val(rec, '휴대폰', 'mobile'));
  const l8 = phone8(val(rec, '유선전화', 'landline'));
  for (const [k, why] of [[bk && `b|${nm}|${bk}`, 'birth'], [p8 && `p|${nm}|${p8}`, 'mobile'], [l8 && `l|${nm}|${l8}`, 'landline']]) {
    if (!k) continue;
    const c = map.get(k);
    if (!c || c.length === 0) continue;
    // 후보가 2건 이상이면 **채택하지 않는다**(오매칭 금지). 단 같은 문서면 1건 취급.
    const uniq = [...new Map(c.map((r) => [r.__id, r])).values()];
    if (uniq.length > 1) return { hit: null, why: `ambiguous-${why}`, n: uniq.length };
    return { hit: uniq[0], why };
  }
  return { hit: null, why: 'miss' };
}

const noteOf = (r) => String(r?.note ?? r?.특이사항 ?? '').replace(/\s*◆[^◆]*/g, '').trim();

const cityRefs = await db.collection('cloud_lists').listDocuments();
let cities = cityRefs.map((c) => c.id);
if (cityArg) cities = cities.filter((c) => c === cityArg);
console.log(`지자체 ${cities.length}곳 검사 (최대 ${LIMIT})\n`);

const totals = { recs: 0, aHit: 0, bHit: 0, gained: 0, gainedWithNote: 0, ambiguous: 0, baseNoNote: 0 };
const gainReasons = {};

let done = 0;
for (const city of cities) {
  if (done >= LIMIT) break;
  const baseSnap = await db.collection(`base_lists/${city}/records`).get();
  if (baseSnap.empty) continue;
  const baseRecs = baseSnap.docs.map((d) => ({ __id: d.id, ...d.data() }));

  const monthRefs = await db.collection(`cloud_lists/${city}/months`).listDocuments();
  if (!monthRefs.length) continue;
  const latest = monthRefs.map((m) => m.id).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().pop();
  if (!latest) continue;
  const recSnap = await db.collection(`cloud_lists/${city}/months/${latest}/records`).get();
  if (recSnap.empty) continue;
  const recs = recSnap.docs.map((d) => ({ __id: d.id, ...d.data() }));

  const idxA = buildIndexA(baseRecs);
  const idxB = buildIndexB(baseRecs);

  let aHit = 0, bHit = 0, gained = 0, gainedNote = 0, amb = 0;
  const reasons = {};
  for (const r of recs) {
    const a = lookupA(idxA, r);
    const b = lookupB(idxB, r);
    if (a) aHit++;
    if (b.hit) bHit++;
    if (b.why?.startsWith('ambiguous')) amb++;
    if (!a && b.hit) {
      gained++;
      reasons[b.why] = (reasons[b.why] || 0) + 1;
      if (noteOf(b.hit)) gainedNote++;
    }
  }
  const pct = (n) => `${((n / recs.length) * 100).toFixed(1)}%`;
  console.log(`■ ${city} · ${latest} · 명단 ${recs.length.toLocaleString()} / 기본명단 ${baseRecs.length.toLocaleString()}`);
  console.log(`   현행 매칭 ${aHit.toLocaleString()} (${pct(aHit)})  →  개선 ${bHit.toLocaleString()} (${pct(bHit)})   [+${gained.toLocaleString()}]`);
  if (gained) console.log(`   새로 잡힌 ${gained}건 중 특이사항 보유 ${gainedNote}건 · 경로 ${JSON.stringify(reasons)}`);
  if (amb) console.log(`   ⚠️ 모호(후보 2건 이상 → 채택 안 함) ${amb}건`);
  console.log('');

  totals.recs += recs.length; totals.aHit += aHit; totals.bHit += bHit;
  totals.gained += gained; totals.gainedWithNote += gainedNote; totals.ambiguous += amb;
  for (const [k, v] of Object.entries(reasons)) gainReasons[k] = (gainReasons[k] || 0) + v;
  done++;
}

const p = (n) => (totals.recs ? `${((n / totals.recs) * 100).toFixed(1)}%` : '-');
console.log('══ 합계 ══');
console.log(`대상 ${totals.recs.toLocaleString()}건`);
console.log(`현행 ${totals.aHit.toLocaleString()} (${p(totals.aHit)})  →  개선 ${totals.bHit.toLocaleString()} (${p(totals.bHit)})`);
console.log(`새로 잡힘 ${totals.gained.toLocaleString()}건 (그중 특이사항 보유 ${totals.gainedWithNote.toLocaleString()}건) · 경로 ${JSON.stringify(gainReasons)}`);
console.log(`모호로 보류(오매칭 차단) ${totals.ambiguous.toLocaleString()}건`);
console.log('\n읽기 전용 — 쓰기 없음');
process.exit(0);
