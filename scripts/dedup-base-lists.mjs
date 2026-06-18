// 기본명단(base_lists) 중복 분석/제거 — 동일인(이름+생년월일/휴대폰/유선 중 하나라도 일치) 통합, 최신 유지·과거 삭제.
// 실행: vite-node scripts/dedup-base-lists.mjs            (분석/dry-run: 삭제 안 함)
//       vite-node scripts/dedup-base-lists.mjs --write    (실제 삭제)
//       옵션: --city "시흥시" (특정 지자체만)
import fs from 'node:fs';
import admin from 'firebase-admin';

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const CITY = (() => { const i = ARGS.indexOf('--city'); return i >= 0 ? ARGS[i + 1] : ''; })();

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();

const digit = v => String(v ?? '').replace(/[^\d]/g, '');
const tsMs = r => { const t = r.updatedAt; if (!t) return 0; if (typeof t.toMillis === 'function') return t.toMillis(); if (t._seconds) return t._seconds * 1000; return 0; };

// 형제 필드 보강(손실0): keep의 빈 필드만 형제(최신우선)에서 채운다. keep에 값이 있으면 유지(최신우선).
// 삭제될 형제에만 있던 생년월일·연락처·기사·순번·리·좌표 등이 사라지지 않게 한다.
const isEmpty = v => v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));
function augmentKeep(keep, siblingsLatestFirst) {
  const merged = { ...keep };
  let filled = 0;
  for (const sib of siblingsLatestFirst) {            // 최신 형제부터 → 첫 비어있지-않은 값 채택
    for (const [k, v] of Object.entries(sib)) {
      if (k === 'id' || k === 'updatedAt') continue;   // 식별자·타임스탬프 제외
      if (isEmpty(merged[k]) && !isEmpty(v)) { merged[k] = v; filled++; }
    }
  }
  return { merged, filled };
}

// 동일인 그룹화: 이름 같고 (생년월일 OR 휴대폰끝8 OR 유선끝8) 하나라도 일치 → union-find
function groupSamePerson(records) {
  const parent = records.map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  // 키별 인덱스: name__birth, name__mobile, name__landline
  const byKey = new Map();
  records.forEach((r, i) => {
    const name = (r.name || r.이름 || '').trim();
    if (!name) return;
    const keys = [];
    const b = digit(r.birthKey || r.생년월일 || '');           // 생년월일(숫자)
    const m = digit(r.mobile || r.휴대폰 || '');
    const l = digit(r.landline || r.유선전화 || '');
    if (b) keys.push(`b:${name}:${b}`);
    if (m.length >= 9) keys.push(`m:${name}:${m.slice(-8)}`);
    if (l.length >= 9) keys.push(`l:${name}:${l.slice(-8)}`);
    for (const k of keys) {
      if (byKey.has(k)) union(i, byKey.get(k)); else byKey.set(k, i);
    }
  });
  const groups = new Map();
  records.forEach((_, i) => { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(i); });
  return [...groups.values()].filter(g => g.length > 1);
}

async function main() {
  const citySnap = await db.collection('base_lists').get();
  let cities = citySnap.docs.map(d => d.id);
  if (CITY) cities = cities.filter(c => c === CITY);
  console.log(`\n대상 지자체 ${cities.length}개 | 모드: ${WRITE ? '★실제삭제★' : '분석(dry-run)'}\n`);

  let grandDup = 0, grandDel = 0, grandRec = 0;
  for (const city of cities) {
    const snap = await db.collection('base_lists').doc(city).collection('records').get();
    const recs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    grandRec += recs.length;
    const dupGroups = groupSamePerson(recs);
    if (!dupGroups.length) { console.log(`  [${city}] ${recs.length}건 · 중복 0`); continue; }
    let delCount = 0, fillTotal = 0;
    const delIds = [];
    const keepUpdates = [];                              // 보강된 keep 문서 업데이트 목록
    for (const g of dupGroups) {
      // 그룹 내 최신(updatedAt 최대) 1건 유지, 나머지 삭제
      const sorted = g.map(i => recs[i]).sort((a, b) => tsMs(b) - tsMs(a));
      const keep = sorted[0];
      const drop = sorted.slice(1);
      // 삭제 형제에만 있던 값 손실0 보강 — keep 빈칸을 형제(최신우선)에서 채움
      const { merged, filled } = augmentKeep(keep, drop);
      if (filled > 0) { keepUpdates.push({ id: keep.id, data: merged }); fillTotal += filled; }
      delCount += drop.length;
      drop.forEach(r => delIds.push(r.id));
    }
    grandDup += dupGroups.length; grandDel += delCount;
    console.log(`  [${city}] ${recs.length}건 · 중복그룹 ${dupGroups.length}개 · 삭제대상 ${delCount}건 · 보강 ${fillTotal}필드`);
    // 샘플 3그룹 출력
    dupGroups.slice(0, 3).forEach(g => {
      const sorted = g.map(i => recs[i]).sort((a, b) => tsMs(b) - tsMs(a));
      console.log(`     · ${sorted[0].name || sorted[0].이름}: ${g.length}건 → 최신유지 [${(sorted[0].address||'').slice(0,30)}] / 삭제 ${g.length-1}건`);
    });
    if (WRITE) {
      const colRef = db.collection('base_lists').doc(city).collection('records');
      // 1) keep 보강 업데이트 먼저(삭제 전) — 형제 값 보존
      for (let i = 0; i < keepUpdates.length; i += 400) {
        const batch = db.batch();
        keepUpdates.slice(i, i + 400).forEach(u => batch.set(colRef.doc(u.id), u.data, { merge: true }));
        await batch.commit();
      }
      // 2) 형제 삭제
      for (let i = 0; i < delIds.length; i += 400) {
        const batch = db.batch();
        delIds.slice(i, i + 400).forEach(id => batch.delete(colRef.doc(id)));
        await batch.commit();
      }
      if (delIds.length) console.log(`     ✅ 보강 ${keepUpdates.length}건 + 삭제 ${delIds.length}건 완료`);
    }
  }
  console.log(`\n총계: ${grandRec}건 중 중복그룹 ${grandDup}개 · 삭제대상 ${grandDel}건`);
  console.log(WRITE ? '✅ 실제 삭제 완료' : 'dry-run — 실제 삭제는 --write');
  await admin.app().delete().catch(() => {});
  process.exit(0);
}
main().catch(e => { console.error('오류:', e); process.exit(1); });
