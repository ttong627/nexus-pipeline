// 도로명주소 변조 복구 v2 — 원본 명단 기준으로 변조분만 in-place 교체 (부가데이터 보존).
//   v2 (2026-07-10): 동명이인 주소 오염 사고(동대문 6월 김옥순) 재발 방지 — S-1~S-6 적용.
//   매칭 코어: scripts/doppelganger-guard.mjs (순수함수·테스트 doppelganger-guard.test.mjs)
//     S-1 강키(이름+전화끝8) 우선 · S-2 약키는 양측 유일 시만 · S-3 무도로명/주민센터 원본자 제외
//     S-4 원본 1:1 소비 · S-5 본번 불일치 임의채택 금지(구판 `|| origs[0]` 제거)
//     S-6 저하 모드 차단: 매칭서비스 URL 필수 + 행별 matchSource 확인(없으면 스킵)
//   복구 대상: 부번추가·도로명 변경. 원본이 주민센터/무도로명(배송요청 가능)은 제외 — 담당자 판단.
//   실행(dry-run): node_modules/.bin/vite-node scripts/repair-address-tampering.mjs --excel "<a.xlsx[,b.xlsx]>" --city "<정규지자체>" --month <YYYY-MM>
//        실제기록: ... --write     키 경로: ... --key <serviceAccountKey.json 절대경로>
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import admin from 'firebase-admin';
import { processAddress } from '../src/engine/addressEngine.js';
import { buildOrigIndex, matchOrigForRecord, roadNo } from './doppelganger-guard.mjs';

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const getArg = (k, d = '') => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : d; };
const EXCEL = getArg('--excel'), CITY = getArg('--city'), MONTH = getArg('--month');
if (!EXCEL || !CITY || !MONTH) { console.error('사용법: --excel "<a.xlsx[,b.xlsx]>" --city "<정규지자체(도 포함)>" --month <YYYY-MM> [--write] [--key <path>]'); process.exit(1); }

// ── S-6 시작 게이트: 매칭서비스 살아있을 때만 수리 실행 (저하 모드 = 재정제 신뢰 불가) ──
const MATCH_URL = String(import.meta.env?.VITE_ADDRESS_MATCH_API_URL || '').replace(/\/+$/, '');
if (!MATCH_URL) { console.error('❌ VITE_ADDRESS_MATCH_API_URL 미설정 — 저하 모드에서는 수리를 실행하지 않습니다(.env 설정 후 재시도).'); process.exit(1); }
try {
  const ping = await fetch(`${MATCH_URL}/v1/address/match`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '서울특별시청', cityLabel: '', allowJusoFallback: false }),
    signal: AbortSignal.timeout(8000),
  });
  if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
  console.log('매칭서비스 헬스체크 OK');
} catch (e) {
  console.error(`❌ 매칭서비스 응답 없음(${e.message}) — 수리를 중단합니다.`); process.exit(1);
}

const CENTER_SAVED_RE = /(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/;

// ── 원본 엑셀 파싱 (여러 파일 콤마 구분) → guard 입력 rows ──────────
//   전화 컬럼도 감지(강키용). 무도로명 행(주민센터 등)도 보존(S-3).
const origRows = [];
for (const ex of EXCEL.split(',').map(s => s.trim()).filter(Boolean)) {
  const wb = XLSX.read(fs.readFileSync(ex), { type: 'buffer' });
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    let nameCol = -1, dongCol = -1, phoneCol = -1;
    for (let i = 0; i < Math.min(8, rows.length); i++) (rows[i] || []).forEach((c, idx) => {
      const v = String(c).replace(/\s/g, '');
      if (nameCol < 0 && /성명|이름|대상자|수령자|세대주/.test(v)) nameCol = idx;
      if (dongCol < 0 && /^동$|읍면동|행정동|동명/.test(v)) dongCol = idx;
      if (phoneCol < 0 && /휴대폰|핸드폰|휴대전화|연락처|전화/.test(v)) phoneCol = idx;
    });
    const rc = {}; rows.slice(0, 300).forEach(r => (r || []).forEach((c, idx) => { if (/(대로|로|길)\s*\d/.test(String(c))) rc[idx] = (rc[idx] || 0) + 1; }));
    const addrCol = Object.keys(rc).sort((a, b) => rc[b] - rc[a])[0];
    if (nameCol < 0 || addrCol === undefined) continue;
    const ai = parseInt(addrCol);
    // R-7 방지: 주소 자동감지가 이름/전화 컬럼을 가리키면 오선택 — 시트 통째로 수동확인
    if (ai === nameCol || ai === phoneCol) { console.warn(`  ⚠️ [${sn}] 주소 컬럼 감지가 이름/전화 컬럼과 겹침 — 시트 건너뜀(수동확인)`); continue; }
    // R-8 방지: 동 컬럼 미감지 경고 (약키 지역필터 무효 — 강키·유일성 게이트가 최종 방어)
    if (dongCol < 0) console.warn(`  ⚠️ [${sn}] 동 컬럼 미감지 — 동명이인은 강키/양측유일 게이트로만 판정됩니다`);
    rows.forEach(r => {
      const name = String(r[nameCol] || '').trim();
      if (!name || /성명|이름/.test(name)) return;
      const detail = String(r[ai] || '').trim();
      if (!detail) return;
      origRows.push({
        name,
        dong: dongCol >= 0 ? String(r[dongCol] || '').trim() : '',
        detail,
        phone: phoneCol >= 0 ? String(r[phoneCol] || '') : '',
      });
    });
  }
}
const origIndex = buildOrigIndex(origRows);
console.log(`원본 명단: ${origRows.length}행 파싱 (이름 ${origIndex.byName.size}종 · 강키 ${origIndex.byStrong.size}종)`);

const sa = JSON.parse(fs.readFileSync(getArg('--key', 'serviceAccountKey.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const col = db.collection('cloud_lists').doc(CITY).collection('months').doc(MONTH).collection('records');
const snap = await col.get();
console.log(`cloud_lists: ${CITY} / ${MONTH} / ${snap.size}건 로드\n`);

// 레코드 쪽 동명이인 집계 (S-2 양측 유일성)
const recNameCount = {};
snap.docs.forEach(d => { const n = String(d.data().이름 || d.data().name || '').trim(); if (n) recNameCount[n] = (recNameCount[n] || 0) + 1; });

const fixes = [], skipped = [];
for (const doc of snap.docs) {
  const rec = doc.data();
  const saved = rec.주소 || rec.address || ''; const srn = roadNo(saved); if (!srn && !CENTER_SAVED_RE.test(saved)) continue;
  const name = String(rec.이름 || rec.name || '').trim(); if (!name) continue;

  const verdict = matchOrigForRecord({
    name,
    dong: rec.행정동 || '',
    phone: rec.휴대폰 || rec.mobile || '',
    savedRoadNo: srn,
    recNameCount: recNameCount[name] || 1,
  }, origIndex);

  if (verdict.action === 'normal') continue;
  if (verdict.action === 'skip') {
    // '원본에 없는 이름'은 신규/이탈 가능성이라 조용히 넘어가고, 판정 스킵만 리포트
    if (!/원본에 없는 이름/.test(verdict.reason)) skipped.push(`${name} [${rec.행정동 || ''}]: ${verdict.reason}`);
    continue;
  }

  // action === 'repair' — 원본 기준 재정제
  const target = verdict.orig;
  let result;
  try { result = await processAddress(target.detail, name, target.dong, CITY, ''); }
  catch (e) { skipped.push(`${name} [${rec.행정동}]: 정제실패 ${e.message}`); continue; }
  // S-6 행 게이트: 온라인 매칭 근거(matchSource) 없는 재정제 결과는 기록하지 않는다
  if (!result.matchSource) { skipped.push(`${name} [${rec.행정동}]: 재정제 온라인매칭 근거 없음 — 스킵(수동확인)`); continue; }
  const newAddr = result.주소 || '';
  const nrn = roadNo(newAddr);
  if (result.확인필요) { skipped.push(`${name} [${rec.행정동}]: 원본 "${target.detail}" 매칭실패 → 스킵(수동확인)`); continue; }
  if (nrn !== target.rn) { skipped.push(`${name} [${rec.행정동}]: 재정제(${nrn})≠원본(${target.rn}) → 스킵`); continue; }
  if (nrn === srn) continue; // 결과가 저장값과 같으면 쓸 것 없음
  const addrKey = rec.주소 !== undefined ? '주소' : 'address';
  fixes.push({ id: doc.id, name, dong: rec.행정동 || '', before: saved, after: newAddr, addrKey, roadAddr: result.도로명주소 || '', detailAddr: result.상세주소 || '', parenInfo: result.괄호정보 || '' });
}

fixes.sort((a, b) => String(a.dong).localeCompare(String(b.dong), 'ko') || a.name.localeCompare(b.name, 'ko'));
console.log(`복구 대상 ${fixes.length}건 — ${WRITE ? '★WRITE★' : 'dry-run (쓰기 없음)'}\n`);
fixes.forEach(f => console.log(`  [${f.dong}] ${f.name}: ${f.before}  →  ${f.after}`));
if (skipped.length) { console.log(`\n스킵 ${skipped.length}건 (수동확인 목록):`); skipped.forEach(s => console.log('  - ' + s)); }

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
    fixes.slice(i, i + 499).forEach(f => { const upd = { roadAddr: f.roadAddr, detailAddr: f.detailAddr, parenInfo: f.parenInfo, updatedAt: admin.firestore.FieldValue.serverTimestamp(), repairTool: 'repair-address-tampering@v2' }; upd[f.addrKey] = f.after; b.update(col.doc(f.id), upd); });
    await b.commit();
  }
  console.log(`\n✅ ${fixes.length}건 복구 완료 — 주소 3분할만 갱신, 좌표·기사·배송순번·특이사항 보존`);
}
await admin.app().delete().catch(() => {});
process.exit(0);
