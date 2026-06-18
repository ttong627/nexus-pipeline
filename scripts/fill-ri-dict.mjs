// 리(里) zero-miss 채움 — 같은 지자체의 이미 채워진 레코드로 '도로명→리' 사전을 만들어 빈칸을 채운다.
// 지자체 내부 데이터만 사용 → 타지역 오매칭 원천 불가. API 무응답과 무관. 다중-리 도로는 건물번호 최근접으로 결정.
// 실행: node scripts/fill-ri-dict.mjs --city "충청남도 홍성군"          (dry-run)
//       node scripts/fill-ri-dict.mjs --city "충청남도 홍성군" --write   (저장)
import fs from 'node:fs';
import admin from 'firebase-admin';
const ARGS=process.argv.slice(2);
const CITY=(()=>{const i=ARGS.indexOf('--city');return i>=0?ARGS[i+1]:'충청남도 홍성군';})();
const WRITE=ARGS.includes('--write');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json','utf8'))) });
const db=admin.firestore();
const roadOf=a=>{const p=String(a||'').split(',')[0].trim();const m=p.match(/^(.+?)\s+\d+(?:-\d+)?/);return m?m[1].trim():'';};
const noOf=a=>{const p=String(a||'').split(',')[0].trim();const rd=roadOf(a);const rest=p.slice(rd.length);const m=rest.match(/(\d+)/);return m?parseInt(m[1]):null;};
const top=o=>Object.entries(o||{}).sort((a,b)=>b[1]-a[1]);

console.log(`\n리 zero-miss 채움(지자체사전) | ${CITY} | ${WRITE?'★저장★':'dry-run'}\n`);
const months=await db.collection('cloud_lists').doc(CITY).collection('months').listDocuments();
for(const m of months){
  const rs=await m.collection('records').get();
  const recs=rs.docs.map(d=>({ref:d.ref,d:d.data()}));
  // 사전 구축(채워진 것)
  const roadMap={}, emdMap={};
  for(const {d:r} of recs){const ri=String(r.리||'').trim();if(!ri)continue;
    const rd=roadOf(r.주소),no=noOf(r.주소),emd=String(r.행정동||'').trim();
    if(rd){(roadMap[rd]=roadMap[rd]||[]).push({no,ri});}
    if(emd){(emdMap[emd]=emdMap[emd]||{})[ri]=(emdMap[emd][ri]||0)+1;}}
  // 빈칸 채움
  const upd=[]; let byRoadExact=0,byRoadNear=0,byEmd=0,none=0; const noneS=[];
  for(const {ref,d:r} of recs){ if(String(r.리||'').trim())continue; if(!/(읍|면)$/.test(String(r.행정동||'')))continue;
    const rd=roadOf(r.주소),no=noOf(r.주소),emd=String(r.행정동||'');
    let ri='';
    const cand=roadMap[rd];
    if(cand&&cand.length){
      if(no!=null){ // 건물번호 최근접
        let best=cand[0],bd=Infinity; for(const c of cand){const dd=c.no!=null?Math.abs(c.no-no):9999; if(dd<bd){bd=dd;best=c;}}
        ri=best.ri; bd===0?byRoadExact++:byRoadNear++;
      } else { ri=top(cand.reduce((a,c)=>{a[c.ri]=(a[c.ri]||0)+1;return a;},{}))[0][0]; byRoadNear++; }
    } else { const e=top(emdMap[emd]); if(e.length){ri=e[0][0];byEmd++;} else {none++; if(noneS.length<8)noneS.push(`${emd} ${(r.주소||'').slice(0,30)}`);} }
    if(ri) upd.push({ref,ri});
  }
  console.log(`[${m.id}] 채움 ${upd.length} (도로정확 ${byRoadExact}·도로근접 ${byRoadNear}·행정동폴백 ${byEmd}) | 완전불가 ${none}`);
  if(noneS.length){console.log('  완전불가(주소불충분):');noneS.forEach(s=>console.log('   -',s));}
  if(WRITE&&upd.length){for(let i=0;i<upd.length;i+=400){const b=db.batch();upd.slice(i,i+400).forEach(u=>b.set(u.ref,{리:u.ri},{merge:true}));await b.commit();}console.log(`[${m.id}] ✅ ${upd.length}건 저장`);}
}
await admin.app().delete().catch(()=>{}); process.exit(0);
