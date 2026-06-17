// 기본명단(base_lists) 복구 — A:지자체통합(손상·분리 문서→정규명), B:레코드dedup(동일인 최신유지)
// 실행: vite-node scripts/repair-base-lists.mjs --step A           (A 통합 dry-run)
//       vite-node scripts/repair-base-lists.mjs --step A --write   (A 실행)
//       vite-node scripts/repair-base-lists.mjs --step B [--write] (B dedup)
import fs from 'node:fs';
import admin from 'firebase-admin';

const ARGS = process.argv.slice(2);
const STEP = (() => { const i = ARGS.indexOf('--step'); return i >= 0 ? ARGS[i + 1] : 'A'; })();
const WRITE = ARGS.includes('--write');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();
const digit = v => String(v ?? '').replace(/[^\d]/g, '');
const tsMs = r => { const t = r.updatedAt; if (!t) return 0; if (typeof t?.toMillis === 'function') return t.toMillis(); if (t?._seconds) return t._seconds * 1000; return 0; };
const FFFD = '�';

// 비정규 문서ID → 정규 지자체명 (없으면 null=이미 정규/보류)
function canonicalCity(id) {
  if (id === '천안시 동남구') return '충청남도 천안시 동남구';
  if (id === '천안시 서북구') return '충청남도 천안시 서북구';
  if (id.includes(FFFD)) {
    const s = id.replace(/�/g, '');
    if (!/천|안/.test(s)) return null;          // 천안 아니면 보류(수동 확인)
    return /[서북]/.test(s) ? '충청남도 천안시 서북구' : '충청남도 천안시 동남구'; // 서/북은 서북구에만 존재
  }
  return null;
}

async function stepA() {
  const refs = await db.collection('base_lists').listDocuments();
  console.log(`\n[A단계] 지자체 통합 | ${WRITE ? '★실행★' : 'dry-run'}\n`);
  let movedTotal = 0, delDocs = 0, skipped = [];
  for (const ref of refs) {
    const canon = canonicalCity(ref.id);
    if (!canon) { if (ref.id.includes(FFFD)) skipped.push(ref.id); continue; }
    const snap = await ref.collection('records').get();
    const recs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    console.log(`  "${ref.id}" → "${canon}"  (${recs.length}건 이동${WRITE ? '' : ' 예정'})`);
    movedTotal += recs.length; delDocs++;
    if (WRITE) {
      const dst = db.collection('base_lists').doc(canon).collection('records');
      for (let i = 0; i < recs.length; i += 200) {
        const batch = db.batch();
        recs.slice(i, i + 200).forEach(r => {
          const nref = dst.doc();                              // 새 ID로 이동(원본 updatedAt 보존)
          batch.set(nref, { ...r.data, id: nref.id });
        });
        await batch.commit();
      }
      // 원본 레코드 + 문서 삭제
      for (let i = 0; i < recs.length; i += 200) {
        const batch = db.batch();
        recs.slice(i, i + 200).forEach(r => batch.delete(ref.collection('records').doc(r.id)));
        await batch.commit();
      }
      await ref.delete().catch(() => {});
      await db.collection('base_lists').doc(canon).set({ city: canon, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      console.log(`     ✅ 이동+원본삭제 완료`);
    }
  }
  if (skipped.length) { console.log(`\n  ⚠️ 추론불가 보류(수동확인): ${skipped.length}개`); skipped.forEach(s => console.log(`     - ${JSON.stringify(s)}`)); }
  console.log(`\n[A] 통합대상 문서 ${delDocs}개 · 이동 레코드 ${movedTotal}건${WRITE ? ' (완료)' : ' (dry-run)'}`);
}

function groupSamePerson(records) {
  const parent = records.map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const byKey = new Map();
  records.forEach((r, i) => {
    const name = (r.name || r.이름 || '').trim(); if (!name) return;
    const b = digit(r.birthKey || r.생년월일 || ''), m = digit(r.mobile || r.휴대폰 || ''), l = digit(r.landline || r.유선전화 || '');
    const keys = [];
    if (b) keys.push(`b:${name}:${b}`);
    if (m.length >= 9) keys.push(`m:${name}:${m.slice(-8)}`);
    if (l.length >= 9) keys.push(`l:${name}:${l.slice(-8)}`);
    for (const k of keys) { if (byKey.has(k)) union(i, byKey.get(k)); else byKey.set(k, i); }
  });
  const g = new Map();
  records.forEach((_, i) => { const r = find(i); if (!g.has(r)) g.set(r, []); g.get(r).push(i); });
  return [...g.values()].filter(x => x.length > 1);
}

async function stepB() {
  const refs = await db.collection('base_lists').listDocuments();
  console.log(`\n[B단계] 동일인 dedup (최신 유지·과거 삭제) | ${WRITE ? '★실행★' : 'dry-run'}\n`);
  let grpTotal = 0, delTotal = 0;
  for (const ref of refs) {
    const snap = await ref.collection('records').get();
    const recs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const groups = groupSamePerson(recs);
    if (!groups.length) continue;
    let del = 0; const delIds = [];
    for (const g of groups) {
      const sorted = g.map(i => recs[i]).sort((a, b) => tsMs(b) - tsMs(a));
      sorted.slice(1).forEach(r => { delIds.push(r.id); del++; });
    }
    grpTotal += groups.length; delTotal += del;
    console.log(`  "${ref.id}" · 중복그룹 ${groups.length} · 삭제 ${del}건`);
    if (WRITE && delIds.length) {
      for (let i = 0; i < delIds.length; i += 300) {
        const batch = db.batch();
        delIds.slice(i, i + 300).forEach(id => batch.delete(ref.collection('records').doc(id)));
        await batch.commit();
      }
    }
  }
  console.log(`\n[B] 중복그룹 ${grpTotal}개 · 삭제 ${delTotal}건${WRITE ? ' (완료)' : ' (dry-run)'}`);
}

(STEP === 'B' ? stepB() : stepA())
  .then(() => admin.app().delete().catch(() => {}))
  .then(() => process.exit(0))
  .catch(e => { console.error('오류:', e); process.exit(1); });
