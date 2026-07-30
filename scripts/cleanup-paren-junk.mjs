// 괄호 정화(P1-b) — 기본 DRY-RUN(쓰기 없음). 실제 반영은 --write.
//   괄호 `()` 는 (법정동, 건물명)만 담는다(A-11/A-29). 배송힌트·숫자코드·잔재가 섞인 것을
//   골라내 특이사항으로 **이관**한다. DB 정본 건물명이 없어도 동작한다(P1과 상호보완).
//
//   형 방침(엄수):
//     · 원문 삭제 금지 — 걷어낸 값은 특이사항으로 이관(1글자 파편만 버림)
//     · 건물명 후보는 절대 제거 금지 · 비법정동 값이 하나뿐이면 손대지 않음(오판 방지)
//     · 판단 불가(건물명 후보 2개 이상·법정동 미확정)면 보류 = 원본 보존
//     · 상세주소(동·호수)·A-22 참고블록 보존 · 이름/전화 등 PII 미조회
//
//   사용:
//     node scripts/cleanup-paren-junk.mjs                      # 전체 dry-run
//     node scripts/cleanup-paren-junk.mjs "서울특별시 동대문구"  # 특정 시군구 dry-run
//     node scripts/cleanup-paren-junk.mjs --write              # 반영(형 확인 후)
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { parseDisplayedAddress, guardAddressDetail, cleanAddressPiece } from '../src/utils/addressFormat.js';
import { classifyParenParts } from '../src/utils/parenCleanup.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const ONLY_CITY = args.find(a => !a.startsWith('--')) || '';
const SAMPLE_LIMIT = 20;

const norm = (v) => cleanAddressPiece(v);
const cmpKey = (v) => String(v || '').replace(/[\s()[\]·,./\\-]/g, '');

const repairOne = (r) => {
  const oldAddr = norm(r.주소);
  if (!oldAddr) return null;
  const legalDong = norm(r.legalDong || r.법정동);
  const { road, detail, paren } = parseDisplayedAddress(oldAddr);
  if (!road || !paren) return null;

  const c = classifyParenParts(paren, legalDong);
  if (c.held) return { skip: '판단 불가 → 보류', oldAddr };
  if (!c.changed) return null;

  const inner = [legalDong, c.building].filter(Boolean).join(', ');
  let next = road;
  if (detail && inner) next = `${road}, ${detail} (${inner})`;
  else if (detail) next = `${road}, ${detail}`;
  else if (inner) next = `${road}, (${inner})`;
  next = guardAddressDetail(oldAddr, norm(next));
  if (next === oldAddr) return null;

  const oldNote = String(r.특이사항 || '');
  let newNote = oldNote;
  for (const m of c.moved) {
    const t = String(m).trim();
    if (!t || t.length < 2) continue;
    if (cmpKey(newNote).includes(cmpKey(t))) continue;
    newNote = newNote ? `${newNote} ${t}` : t;
  }
  return { oldAddr, newAddr: next, oldNote, newNote, moved: c.moved, building: c.building };
};

const main = async () => {
  console.log(`\n${'='.repeat(72)}\n${WRITE ? '★ WRITE 모드 (실제 반영)' : 'DRY-RUN (쓰기 없음)'}${ONLY_CITY ? ` — ${ONLY_CITY}` : ' — 전체'}\n${'='.repeat(72)}`);
  const stat = { total: 0, target: 0, held: 0, noteMoved: 0, written: 0 };
  const samples = [];
  const pending = [];

  const cities = await db.collection('cloud_lists').listDocuments();
  for (const cityRef of cities) {
    if (ONLY_CITY && !cityRef.id.includes(ONLY_CITY)) continue;
    for (const monthRef of await cityRef.collection('months').listDocuments()) {
      const snap = await monthRef.collection('records').get();
      for (const doc of snap.docs) {
        const r = doc.data();
        stat.total++;
        const out = repairOne(r);
        if (!out) continue;
        if (out.skip) { stat.held++; continue; }
        stat.target++;
        if (out.newNote !== out.oldNote) stat.noteMoved++;
        if (samples.length < SAMPLE_LIMIT) samples.push({ city: cityRef.id, month: monthRef.id, ...out });
        pending.push({ ref: doc.ref, ...out });
      }
    }
  }

  console.log(`\n[집계] 전체 ${stat.total}건 / 정화대상 ${stat.target}건 / 보류 ${stat.held}건 / 특이사항 이관 ${stat.noteMoved}건`);
  console.log(`\n[정화 표본 ${samples.length}건]`);
  for (const s of samples) {
    console.log(`\n  · ${s.city} ${s.month}`);
    console.log(`    이전: ${s.oldAddr}`);
    console.log(`    이후: ${s.newAddr}`);
    if (s.newNote !== s.oldNote) console.log(`    특이사항: "${s.oldNote}" → "${s.newNote}"`);
  }

  if (!WRITE) { console.log(`\n※ DRY-RUN 입니다. 확인 후 --write 로 반영하세요.\n`); process.exit(0); }

  console.log(`\n반영 시작 — ${pending.length}건...`);
  let batch = db.batch();
  let n = 0;
  for (const p of pending) {
    const patch = { 주소: p.newAddr, addressMatchSource: 'paren-junk-cleanup' };
    if (p.newNote !== p.oldNote) patch.특이사항 = p.newNote;
    batch.update(p.ref, patch);
    n++; stat.written++;
    if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; console.log(`  ${stat.written}건 반영...`); }
  }
  if (n > 0) await batch.commit();
  console.log(`\n✅ 반영 완료: ${stat.written}건\n`);
  process.exit(0);
};

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
