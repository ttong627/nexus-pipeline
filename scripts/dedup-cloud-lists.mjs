// cloud_lists 동일인 중복 제거 — 같은 사람(이름+생년+휴대폰)당 가장 완성된 1건만 보존.
// 실행: node scripts/dedup-cloud-lists.mjs --city "충청남도 홍성군"          (dry-run)
//       node scripts/dedup-cloud-lists.mjs --city "충청남도 홍성군" --write   (실삭제)
import fs from 'node:fs';
import admin from 'firebase-admin';
const ARGS = process.argv.slice(2);
const CITY = (()=>{const i=ARGS.indexOf('--city');return i>=0?ARGS[i+1]:'충청남도 홍성군';})();
const WRITE = ARGS.includes('--write');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json','utf8'))) });
const db = admin.firestore();
const digit = v => String(v??'').replace(/[^\d]/g,'');
// 완성도 점수 — 작업물·정제 보존 우선
const score = r => (r.lat&&r.lng?10:0) + (String(r.기사||'').trim()?8:0) + (String(r.배송순번||'').trim()?4:0)
  + (String(r.리||'').trim()?3:0) + (/\(/.test(String(r.주소||''))?2:0) + (String(r.특이사항||'').trim()?1:0)
  + (String(r.legalDong||'').trim()?1:0) + (String(r.detailAddress||'').trim()?1:0);

console.log(`\ncloud_lists 동일인 중복제거 | ${CITY} | ${WRITE?'★실삭제★':'dry-run'}\n`);
const months = await db.collection('cloud_lists').doc(CITY).collection('months').listDocuments();
for (const m of months){
  const rs = await m.collection('records').get();
  const recs = rs.docs.map(d=>({ref:d.ref, id:d.id, d:d.data()}));
  const groups = {};
  for (const x of recs){ const r=x.d; const name=(r.이름||'').trim();
    if(!name) continue; // 이름없는 건 건드리지 않음
    const key=`${name}|${digit(r.생년월일)}|${digit(r.휴대폰)}|${digit(r.유선전화)}`; (groups[key]=groups[key]||[]).push(x); }
  const delRefs=[]; let grpCnt=0; const samples=[];
  for (const [,g] of Object.entries(groups)){
    if (g.length<2) continue; grpCnt++;
    const sorted=[...g].sort((a,b)=>score(b.d)-score(a.d)); // 최고점 보존
    const keep=sorted[0]; const dels=sorted.slice(1);
    dels.forEach(x=>delRefs.push(x.ref));
    if (samples.length<8) samples.push(`${keep.d.이름}: 보존[${(keep.d.주소||'').slice(0,24)} ·점${score(keep.d)}] / 삭제 ${dels.length}건`);
  }
  console.log(`[${m.id}] 총 ${recs.length} · 중복그룹 ${grpCnt} · 삭제대상 ${delRefs.length} → 정리후 ${recs.length-delRefs.length}`);
  samples.forEach(s=>console.log('   -',s));
  if (WRITE && delRefs.length){
    for (let i=0;i<delRefs.length;i+=400){ const b=db.batch(); delRefs.slice(i,i+400).forEach(r=>b.delete(r)); await b.commit(); }
    // 메타 totalCount 보정
    const after = recs.length - delRefs.length;
    await m.set({ totalCount: after, dedupAt: admin.firestore.FieldValue.serverTimestamp() }, { merge:true }).catch(()=>{});
    console.log(`[${m.id}] ✅ ${delRefs.length}건 삭제 · 메타 totalCount=${after} 보정`);
  }
}
await admin.app().delete().catch(()=>{}); process.exit(0);
