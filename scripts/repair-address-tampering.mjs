// 도로명주소 변조 복구 — 원본 명단 기준으로 변조분만 in-place 교체 (부가데이터 보존).
// 복구 대상: ① 부번추가 + ③ 도로명·번지 변경. ② 주민센터(배송요청 가능)는 제외 — 담당자 판단.
// 안전가드: 원본이 매칭 실패(오타)하거나 재정제 결과가 원본 도로명번지와 다르면 자동 스킵(수동확인).
// 실행(dry-run): node_modules/.bin/vite-node scripts/repair-address-tampering.mjs --excel "<a.xlsx[,b.xlsx]>" --city "<정규지자체>" --month <YYYY-MM>
//      실제기록: ... --write     키 경로: ... --key <serviceAccountKey.json 절대경로>
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import admin from 'firebase-admin';
import { processAddress } from '../src/engine/addressEngine.js';

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const getArg = (k, d = '') => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : d; };
const EXCEL = getArg('--excel'), CITY = getArg('--city'), MONTH = getArg('--month');
if (!EXCEL || !CITY || !MONTH) { console.error('사용법: --excel "<a.xlsx[,b.xlsx]>" --city "<정규지자체(도 포함)>" --month <YYYY-MM> [--write] [--key <path>]'); process.exit(1); }

const norm = s => String(s || '').replace(/\s+/g, '');
const SIDO = /(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|충북|충남|전라북도|전북특별자치도|전라남도|전북|전남|경상북도|경상남도|경북|경남|제주특별자치도|제주도)/g;
// 도로명+건물번호만 비교용 추출 (괄호이후·시도·시군구 제거, 호수 붙음 방지 — 공백 유지 매칭)
const roadNo = a => {
  let s = String(a || '').replace(/\(.*$/s, ' ').replace(SIDO, ' ').replace(/[가-힣]{2,}(시|군|구)(?=\s|$)/g, ' ').replace(/(\d)\s*-\s*(\d)/g, '$1-$2').replace(/\s+/g, ' ').trim();
  const m = s.match(/((?:[가-힣A-Za-z0-9]+\s*)*(?:대로|로|길))\s*(\d+(?:-\d+)?)/);
  return m ? m[1].replace(/\s/g, '') + m[2] : null;
};
const baseNo = rn => rn ? rn.replace(/-\d+$/, '') : '';
const CENTER = /(주민센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/;

// ── 원본 엑셀 파싱 (여러 파일 콤마 구분): 이름 → [{dong, detail, rn}] ──
const origMap = new Map();
for (const ex of EXCEL.split(',').map(s => s.trim()).filter(Boolean)) {
  const wb = XLSX.read(fs.readFileSync(ex), { type: 'buffer' });
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    let nameCol = -1, dongCol = -1;
    for (let i = 0; i < Math.min(8, rows.length); i++) (rows[i] || []).forEach((c, idx) => {
      const v = String(c).replace(/\s/g, '');
      if (nameCol < 0 && /성명|이름|대상자|수령자|세대주/.test(v)) nameCol = idx;
      if (dongCol < 0 && /^동$|읍면동|행정동|동명/.test(v)) dongCol = idx;
    });
    const rc = {}; rows.slice(0, 300).forEach(r => (r || []).forEach((c, idx) => { if (/(대로|로|길)\s*\d/.test(String(c))) rc[idx] = (rc[idx] || 0) + 1; }));
    const addrCol = Object.keys(rc).sort((a, b) => rc[b] - rc[a])[0];
    if (nameCol < 0 || addrCol === undefined) continue;
    const ai = parseInt(addrCol);
    rows.forEach(r => {
      const name = String(r[nameCol] || '').trim();
      const dong = dongCol >= 0 ? String(r[dongCol] || '').trim() : '';
      const detail = String(r[ai] || '').trim();
      const rn = roadNo(detail);
      if (name && rn) { if (!origMap.has(name)) origMap.set(name, []); origMap.get(name).push({ dong, detail, rn }); }
    });
  }
}
console.log(`원본 명단: ${origMap.size}명 파싱`);

const sa = JSON.parse(fs.readFileSync(getArg('--key', 'serviceAccountKey.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const col = db.collection('cloud_lists').doc(CITY).collection('months').doc(MONTH).collection('records');
const snap = await col.get();
console.log(`cloud_lists: ${CITY} / ${MONTH} / ${snap.size}건 로드\n`);

const fixes = [], skipped = [];
for (const doc of snap.docs) {
  const rec = doc.data();
  const saved = rec.주소 || rec.address || ''; const srn = roadNo(saved); if (!srn) continue;
  const name = String(rec.이름 || rec.name || '').trim(); if (!name) continue;
  const recDong = norm(rec.행정동 || '');
  const origs = (origMap.get(name) || []).filter(o => !recDong || !norm(o.dong) || norm(o.dong) === recDong);
  if (!origs.length) continue;
  if (origs.map(o => o.rn).includes(srn)) continue;       // 원본과 일치 → 정상
  if (CENTER.test(saved)) continue;                       // ② 주민센터 제외 (배송요청 가능 — 담당자 판단)
  const target = origs.find(o => baseNo(o.rn) === baseNo(srn)) || origs[0]; // 본번 일치 우선
  let result;
  try { result = await processAddress(target.detail, name, target.dong, CITY, ''); }
  catch (e) { skipped.push(`${name} [${rec.행정동}]: 정제실패 ${e.message}`); continue; }
  const newAddr = result.주소 || '';
  const nrn = roadNo(newAddr);
  if (result.확인필요) { skipped.push(`${name} [${rec.행정동}]: 원본 "${target.detail}" 매칭실패 → 스킵(수동확인)`); continue; }
  if (nrn !== target.rn) { skipped.push(`${name} [${rec.행정동}]: 재정제(${nrn})≠원본(${target.rn}) → 스킵`); continue; }
  const addrKey = rec.주소 !== undefined ? '주소' : 'address';
  fixes.push({ id: doc.id, name, dong: rec.행정동 || '', before: saved, after: newAddr, addrKey, roadAddr: result.도로명주소 || '', detailAddr: result.상세주소 || '', parenInfo: result.괄호정보 || '' });
}

fixes.sort((a, b) => String(a.dong).localeCompare(String(b.dong), 'ko') || a.name.localeCompare(b.name, 'ko'));
console.log(`복구 대상 ${fixes.length}건 — ${WRITE ? '★WRITE★' : 'dry-run (쓰기 없음)'}\n`);
fixes.forEach(f => console.log(`  [${f.dong}] ${f.name}: ${f.before}  →  ${f.after}`));
if (skipped.length) { console.log(`\n스킵 ${skipped.length}건:`); skipped.forEach(s => console.log('  - ' + s)); }

if (fixes.length) {
  const lr = [['행정동', '이름', '이전(변조)', '복구']];
  fixes.forEach(f => lr.push([f.dong, f.name, f.before, f.after]));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lr), '복구리스트');
  const outPath = path.join(path.dirname(path.resolve(EXCEL.split(',')[0].trim())), `복구리스트_${CITY.replace(/\s+/g, '_')}_${MONTH}.xlsx`);
  fs.writeFileSync(outPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log(`\n📄 ${outPath}`);
}
if (WRITE && fixes.length) {
  for (let i = 0; i < fixes.length; i += 499) {
    const b = db.batch();
    fixes.slice(i, i + 499).forEach(f => { const upd = { roadAddr: f.roadAddr, detailAddr: f.detailAddr, parenInfo: f.parenInfo, updatedAt: admin.firestore.FieldValue.serverTimestamp() }; upd[f.addrKey] = f.after; b.update(col.doc(f.id), upd); });
    await b.commit();
  }
  console.log(`\n✅ ${fixes.length}건 복구 완료 — 주소 3분할만 갱신, 좌표·기사·배송순번·특이사항 보존`);
}
await admin.app().delete().catch(() => {});
process.exit(0);
