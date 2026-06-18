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
  // B-15 동일인 union-find: 이름 + (생년월일8 | 휴대폰8 | 유선8 중 하나라도 일치).
  // 시트마다 생년월일 유무가 달라도(명단엔 있고 수급자엔 없음) 휴대폰으로 묶여 교차-시트 중복까지 제거.
  const named = recs.filter(x => (x.d.이름||'').trim());
  const parent = named.map((_,i)=>i);
  const find = x => { while(parent[x]!==x){ parent[x]=parent[parent[x]]; x=parent[x]; } return x; };
  const uni = (a,b)=>{ const ra=find(a),rb=find(b); if(ra!==rb) parent[ra]=rb; };
  const byKey = new Map();
  named.forEach((x,i)=>{ const r=x.d; const nm=(r.이름||'').trim();
    const b=digit(r.생년월일), mo=digit(r.휴대폰), l=digit(r.유선전화);
    const keys=[]; if(b)keys.push(`b:${nm}:${b}`); if(mo.length>=8)keys.push(`m:${nm}:${mo.slice(-8)}`); if(l.length>=8)keys.push(`l:${nm}:${l.slice(-8)}`);
    for(const k of keys){ if(byKey.has(k)) uni(i,byKey.get(k)); else byKey.set(k,i); } });
  const gmap = new Map();
  named.forEach((_,i)=>{ const r=find(i); if(!gmap.has(r))gmap.set(r,[]); gmap.get(r).push(named[i]); });
  const groups = [...gmap.values()].map(g=>['',g]);
  const delRefs=[]; const mergeUpd=[]; let grpCnt=0; const samples=[];
  for (const [,g] of groups){
    if (g.length<2) continue; grpCnt++;
    const sorted=[...g].sort((a,b)=>score(b.d)-score(a.d)); // 최고점 보존
    const keep=sorted[0]; const dels=sorted.slice(1);
    // 보존 레코드에 빠진 값(생년월일·연락처·특이사항·리)을 형제에서 보강 — 데이터 손실 방지
    const fill={};
    for (const f of ['생년월일','휴대폰','유선전화','특이사항','리','구분']) {
      if (!String(keep.d[f]||'').trim()) { const src=sorted.find(s=>String(s.d[f]||'').trim()); if(src) fill[f]=src.d[f]; }
    }
    if (Object.keys(fill).length) mergeUpd.push({ ref:keep.ref, fill });
    dels.forEach(x=>delRefs.push(x.ref));
    if (samples.length<8) samples.push(`${keep.d.이름}: 보존[${(keep.d.주소||'').slice(0,22)} ·점${score(keep.d)}]${Object.keys(fill).length?' +보강'+Object.keys(fill).join(','):''} / 삭제 ${dels.length}`);
  }
  console.log(`[${m.id}] 총 ${recs.length} · 중복그룹 ${grpCnt} · 삭제대상 ${delRefs.length} → 정리후 ${recs.length-delRefs.length}`);
  samples.forEach(s=>console.log('   -',s));
  console.log(`   (보존 레코드 필드 보강 ${mergeUpd.length}건)`);
  if (WRITE){
    for (let i=0;i<mergeUpd.length;i+=400){ const b=db.batch(); mergeUpd.slice(i,i+400).forEach(u=>b.set(u.ref,u.fill,{merge:true})); await b.commit(); }
    for (let i=0;i<delRefs.length;i+=400){ const b=db.batch(); delRefs.slice(i,i+400).forEach(r=>b.delete(r)); await b.commit(); }
    const after = recs.length - delRefs.length;
    await m.set({ totalCount: after, dedupAt: admin.firestore.FieldValue.serverTimestamp() }, { merge:true }).catch(()=>{});
    console.log(`[${m.id}] ✅ 보강 ${mergeUpd.length} · 삭제 ${delRefs.length} · 메타 totalCount=${after}`);
  }
}
await admin.app().delete().catch(()=>{}); process.exit(0);
