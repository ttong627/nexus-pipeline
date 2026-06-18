// 외부 엑셀의 기사·배송순번을 base_lists에 매칭 이식 (이름+휴대폰). driver/seqNo만 업데이트.
// 실행: node scripts/import-driver-seqno.mjs            (dry-run)
//       node scripts/import-driver-seqno.mjs --write     (저장)
import * as XLSX from 'xlsx'; import fs from 'node:fs'; import admin from 'firebase-admin';
const WRITE=process.argv.includes('--write');
const CITY='경기도 성남시 중원구';
const FP='특이사항_기본명단/성남중원구/경기도 성남시 중원구 기본명단.xlsx';
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json','utf8'))) });
const db=admin.firestore(); const digit=v=>String(v??'').replace(/[^\d]/g,'');
// base_lists 인덱스
const snap=await db.collection('base_lists').doc(CITY).collection('records').get();
console.log(`base_lists "${CITY}": ${snap.size}건`);
if(!snap.size){ console.log('⚠️ base_lists 없음 — 이식 불가(먼저 명단 import 필요)'); process.exit(0); }
const idx=new Map();
snap.docs.forEach(d=>{ const r=d.data(); const nm=(r.name||r.이름||'').trim(); const m=digit(r.mobile||r.휴대폰);
  if(nm&&m.length>=8){ idx.set(`${nm}|${m.slice(-8)}`, d.ref); } });
// 파일 파싱
const wb=XLSX.read(fs.readFileSync(FP),{type:'buffer'}); const aoa=XLSX.utils.sheet_to_json(wb.Sheets['기본명단'],{header:1,defval:''});
const hr=aoa.findIndex(r=>r.some(c=>/수령자명|성명|이름/.test(String(c)))); const h=aoa[hr].map(c=>String(c));
const ci={name:h.findIndex(c=>/수령자명|성명|이름/.test(c)),ph:h.findIndex(c=>/휴대/.test(c)),drv:h.findIndex(c=>/기사/.test(c)),seq:h.findIndex(c=>/배송순번/.test(c))};
let matched=0,unmatched=0,noData=0; const upd=[]; const uns=[];
for(let i=hr+1;i<aoa.length;i++){ const row=aoa[i]; const nm=String(row[ci.name]||'').trim(); if(!nm)continue;
  const m=digit(row[ci.ph]); const drv=String(row[ci.drv]||'').trim(); const seq=String(row[ci.seq]||'').trim();
  if(!drv&&!seq){noData++;continue;}
  const ref=m.length>=8?idx.get(`${nm}|${m.slice(-8)}`):null;
  if(ref){matched++; upd.push({ref,driver:drv,seqNo:seq});} else {unmatched++; if(uns.length<8)uns.push(`${nm} ${m.slice(-8)}`);} }
console.log(`파일행: 매칭 ${matched} · 미매칭 ${unmatched} · 기사/순번없음 ${noData}`);
if(uns.length){console.log('미매칭 샘플:');uns.forEach(s=>console.log('  -',s));}
if(WRITE&&upd.length){ for(let i=0;i<upd.length;i+=400){const b=db.batch();upd.slice(i,i+400).forEach(u=>b.set(u.ref,{driver:u.driver,seqNo:u.seqNo},{merge:true}));await b.commit();} console.log(`✅ ${upd.length}건 기사/배송순번 이식 완료`); }
else console.log(`(dry-run — ${upd.length}건 이식 예정)`);
await admin.app().delete(); process.exit(0);
