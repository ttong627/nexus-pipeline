// 기본명단(base_lists) import — 실제 정제엔진(processAddress) 재사용 + firebase-admin 쓰기.
// 실행: node_modules/.bin/vite-node scripts/import-base-lists.mjs            (dry-run: 샘플 정제 미리보기, 쓰기 없음)
//       node_modules/.bin/vite-node scripts/import-base-lists.mjs --write   (실제 base_lists 기록)
//       옵션: --limit N (파일당 행 제한, dry-run 기본 15) / --file "부분파일명" (특정 파일만)
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import admin from 'firebase-admin';
import { processAddress, asyncPool } from '../src/engine/addressEngine.js';

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const COUNT = ARGS.includes('--count');
const LIMIT = (() => { const i = ARGS.indexOf('--limit'); return i >= 0 ? parseInt(ARGS[i + 1]) : (WRITE ? Infinity : 15); })();
const FILE_FILTER = (() => { const i = ARGS.indexOf('--file'); return i >= 0 ? ARGS[i + 1] : ''; })();

const DIR = path.resolve('특이사항_기본명단');

// 파일명 → 정규 지자체명(도 포함). base_lists/cloud_lists/delivery_history와 동일 키 필수(지자체 분리 방지).
const FILE_CITY = {
  '계룡특이사항': '충청남도 계룡시',
  '논산특이사항': '충청남도 논산시',
  '서천읍특이사항': '충청남도 서천군',
  '천안동남구특이사항': '충청남도 천안시 동남구',
  '천안서북구특이사항': '충청남도 천안시 서북구',
  '홍성특이사항': '충청남도 홍성군',
};

// 하위폴더명 → 정규 지자체명 (Format B 폴더 단위 import: 기준명단+명단관리)
const FOLDER_CITY = {
  '성남중원구': '경기도 성남시 중원구',
};

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const KW = {
  name: ['성명', '이름', '대상자', '수령자'],
  addr: ['주소'],
  phone: ['전화', '휴대', '연락', '핸드', '모바일'],
  qty: ['양곡', '포수', '수량', 'kg', '구입량'],
  note: ['비고', '특이', '메모'],
  dong: ['읍면동', '행정동', '동명'],
  sigungu: ['시군구'],
  sido: ['광역시도', '시도'],
};
const findCol = (headerCells, kws, exclude = []) =>
  headerCells.findIndex(h => { const v = norm(h); return v && kws.some(k => v.includes(k)) && !exclude.some(x => v.includes(x)); });

// 2행 병합 헤더 통합: 같은 컬럼의 위/아래 셀 텍스트 합침
function mergeHeader(rows, hdrIdx) {
  const a = rows[hdrIdx] || [], b = rows[hdrIdx + 1] || [];
  const w = Math.max(a.length, b.length);
  return Array.from({ length: w }, (_, i) => `${norm(a[i])} ${norm(b[i])}`.trim());
}

// 헤더행 탐지: 상위 6행 중 성명+주소 키워드 동시 점수 최고
function detectHeader(rows) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const merged = `${(rows[i] || []).join(' ')} ${(rows[i + 1] || []).join(' ')}`;
    const score = (/성명|이름|수령자/.test(merged) ? 1 : 0) + (/주소/.test(merged) ? 1 : 0) + (/전화|휴대|연락/.test(merged) ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// 한 시트 → 표준 레코드 배열 {이름,주소,행정동,전화a,전화b,양곡,비고}
function parseSheet(ws, sheetName, format) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return [];
  const out = [];
  if (format === 'B') {
    // 헤더행 자동 탐지: 상위 6행 중 (광역시도|시군구) + (수령자명|성명|이름) 동시 포함 행. 제목행 건너뜀.
    let hdrIdx = 0;
    for (let i = 0; i < Math.min(6, rows.length); i++) {
      const joined = (rows[i] || []).map(norm).join(' ');
      if (/광역시도|시군구/.test(joined) && /수령자|성명|이름/.test(joined)) { hdrIdx = i; break; }
    }
    const h = rows[hdrIdx].map(norm);
    const ci = {
      sido: findCol(h, KW.sido), sigungu: findCol(h, KW.sigungu), dong: findCol(h, KW.dong),
      name: findCol(h, KW.name), phone: findCol(h, KW.phone), addr: findCol(h, KW.addr),
      note: findCol(h, KW.note), qty: findCol(h, KW.qty),
      driver: findCol(h, ['기사']), seq: findCol(h, ['배송순번']),
    };
    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const name = norm(r[ci.name]);
      if (!name || /^(성명|이름|수령자명)$/.test(name)) continue;
      // 정규 지자체명 = 광역시도 + 시군구 (도 포함, 분리 방지)
      const 시군구full = [ci.sido >= 0 ? norm(r[ci.sido]) : '', norm(r[ci.sigungu])].filter(Boolean).join(' ');
      out.push({
        이름: name, 주소: norm(r[ci.addr]), 행정동: norm(r[ci.dong]),
        시군구: 시군구full, 전화a: norm(r[ci.phone]), 전화b: '',
        양곡: norm(r[ci.qty]), 비고: norm(r[ci.note]),
        기사: ci.driver >= 0 ? norm(r[ci.driver]) : '', 배송순번: ci.seq >= 0 ? norm(r[ci.seq]) : '',
      });
    }
  } else {
    const hdrIdx = detectHeader(rows);
    const h = mergeHeader(rows, hdrIdx);
    const ci = {
      name: findCol(h, KW.name), addr: findCol(h, KW.addr),
      qty: findCol(h, KW.qty, ['가구', '세대', '인원', '구성원', '동거인', '식구', '명수']),
      note: findCol(h, KW.note), dong: findCol(h, KW.dong),
    };
    // 전화 컬럼은 여러 개(전화①②) — addr 다음의 전화 키워드 컬럼들 수집
    const phoneCols = h.map((v, i) => (v && /전화|휴대|연락/.test(v)) ? i : -1).filter(i => i >= 0);
    const dataStart = hdrIdx + 2;
    for (let i = dataStart; i < rows.length; i++) {
      const r = rows[i];
      const name = norm(r[ci.name]);
      if (!name || /합계|소계|^\d+가정$|성명/.test(name)) continue;
      const addr = norm(r[ci.addr]);
      if (!addr) continue;
      out.push({
        이름: name, 주소: addr, 행정동: sheetName, 시군구: '',
        전화a: norm(r[phoneCols[0]]), 전화b: norm(r[phoneCols[1]]),
        양곡: ci.qty >= 0 ? norm(r[ci.qty]) : '', 비고: ci.note >= 0 ? norm(r[ci.note]) : '',
      });
    }
  }
  return out;
}

function loadFile(fp, folder = '') {
  const base = path.basename(fp).replace(/\.(xlsx?|xls)$/i, '');
  // 파일 역할: 명단관리=권위(기사·순번 기록), 기준명단=베이스(기사·순번 신뢰불가→비움)
  const role = /명단관리/.test(base) ? 'manage' : (/기준명단/.test(base) ? 'base' : '');
  const wb = XLSX.read(fs.readFileSync(fp), { type: 'buffer' });
  // Format B 감지: 1행만이 아니라 상위 6행 스캔(제목행 대응)
  const isB = wb.SheetNames.some(sn => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    return rows.slice(0, 6).some(row => /광역시도|시군구|수령자명/.test((row || []).join(' ')));
  });
  const fileCity = FILE_CITY[base] || FOLDER_CITY[folder] || '';
  const recs = [];
  for (const sn of wb.SheetNames) {
    if (/^(Sheet\d+|xxxxxxxx|XL4Poppy)$/i.test(sn)) continue; // 빈 템플릿 시트 제외
    const parsed = parseSheet(wb.Sheets[sn], sn, isB ? 'B' : 'A');
    for (const p of parsed) {
      const city = isB ? (p.시군구 || fileCity) : fileCity;
      if (!city) continue;
      if (role === 'base') { p.기사 = ''; p.배송순번 = ''; }  // 기준명단: 변형간 충돌(58%)로 신뢰불가 → 비움
      recs.push({ ...p, _city: city, _file: base, _role: role, _sheet: sn });
    }
  }
  return recs;
}

// ── 전화 분류(§8) + 페이로드 + base_lists 3순위 매칭·쓰기(§2) ──────────
const digitKey = (v) => String(v ?? '').replace(/[^\d]/g, '');
const normPhone = (v) => String(v ?? '').replace(/[^0-9-]/g, '');
const isMobile = (d) => /^01[016789]/.test(d);
function classifyPhones(...raws) {
  let mobile = '', landline = '';
  for (const raw of raws) {
    const d = digitKey(raw);
    if (d.length < 9) continue;
    if (isMobile(d)) { if (!mobile) mobile = normPhone(raw); }
    else if (!landline) landline = normPhone(raw);
  }
  return { mobile, landline };
}
function buildPayload(r, res) {
  const { mobile, landline } = classifyPhones(r.전화a, r.전화b);
  // 특이사항: ◆이식표시·(본명:XXX)·주민번호(PII) 제거. 본명은 realName 컬럼으로 분리 저장.
  const note = [String(res.특이사항 || '').trim(), String(r.비고 || '').trim()].filter(Boolean).join(' ')
    .replace(/\s*◆[^◆]*/g, '')
    .replace(/\(본명:[^)]*\)/g, '')
    .replace(/\d{6}\s*[-–]\s*\d{7}/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const payload = {
    // A-1: 이름 5자 초과면 절단명 저장 + realName에 원본명(App 저장경로와 스키마 일치)
    name: res.정제된이름 || r.이름, realName: res.본명 || '', birthKey: '',
    dong: r.행정동 || res.legalDong || '',
    address: res.주소 || r.주소,
    roadAddr: res.도로명주소 || '', detailAddr: res.상세주소 || '', parenInfo: res.괄호정보 || '',
    mobile, landline, note, qty: 1, sms: '',
    lat: res.lat ?? null, lng: res.lng ?? null, isApt: !!res.isApt,
    roadName: res.roadName || '', buildingName: res.buildingName || '', legalDong: res.legalDong || '',
    standardRoadAddress: res.standardRoadAddress || '',
    addressMgtNo: res.addressMgtNo || '', buildingMgtNo: res.buildingMgtNo || '',
    matchedSido: res.matchedSido || '', matchedSigungu: res.matchedSigungu || '',
    detailAddress: res.상세주소 || '',
    addressMatchSource: res.matchSource || '', addressMatchConfidence: res.matchConfidence ?? null,
    확인필요: !!res.확인필요, 확인사유: res.확인사유 || '',
    importedFrom: r._file, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  // 기사·배송순번: 값이 있을 때만 기록(빈값은 생략 → merge 시 기존값·명단관리 값 보존). '명단관리 우선'의 핵심.
  const driver = String(r.기사 || '').trim();
  const seqNo = String(r.배송순번 ?? '').trim();
  if (driver) payload.driver = driver;
  if (seqNo) payload.seqNo = seqNo;
  return payload;
}
async function matchAndWrite(fsdb, city, refined) {
  const colRef = fsdb.collection('base_lists').doc(city).collection('records');
  const snap = await colRef.get();
  const existing = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const liveByPhone = {}, liveByLandline = {};
  const birthKeyedNames = new Set();
  existing.forEach(r => {
    const rName = (r.name || r.이름 || '').trim();
    const rBirth = String(r.birthKey || r.생년월일 || '').trim();
    const rPhone = digitKey(r.mobile || r.휴대폰 || '');
    const rLand = digitKey(r.landline || r.유선전화 || '');
    if (!rName) return;
    if (rBirth) birthKeyedNames.add(rName);            // 생년월일 보유자 → 2·3순위 신규 차단(B-2)
    else if (rPhone.length >= 9) liveByPhone[`${rName}__${rPhone}`] = r;
    else if (rLand.length >= 9) liveByLandline[`${rName}__${rLand}`] = r;
  });
  const updates = [], addEntries = [];
  for (const { r, res } of refined) {
    const name = (r.이름 || '').trim(); if (!name) continue;
    const payload = buildPayload(r, res);
    const mKey = digitKey(payload.mobile), lKey = digitKey(payload.landline);
    if (mKey.length < 9 && lKey.length < 9) continue;  // B-1 (생년월일 없음 + 전화 없음 → 저장불가)
    if (mKey.length >= 9) {
      const m = liveByPhone[`${name}__${mKey}`];
      if (m && m._inflight) m.data = { ...m.data, ...payload };
      else if (m) { updates.push({ id: m.id, data: payload }); liveByPhone[`${name}__${mKey}`] = { ...m, ...payload }; }
      else { if (birthKeyedNames.has(name)) continue; const e = { _inflight: true, data: payload }; addEntries.push(e); liveByPhone[`${name}__${mKey}`] = e; }
    } else {
      const m = liveByLandline[`${name}__${lKey}`];
      if (m && m._inflight) m.data = { ...m.data, ...payload };
      else if (m) { updates.push({ id: m.id, data: payload }); liveByLandline[`${name}__${lKey}`] = { ...m, ...payload }; }
      else { if (birthKeyedNames.has(name)) continue; const e = { _inflight: true, data: payload }; addEntries.push(e); liveByLandline[`${name}__${lKey}`] = e; }
    }
  }
  const adds = addEntries.map(e => e.data);
  const deduped = new Map(); updates.forEach(u => deduped.set(u.id, u));
  const allOps = [...[...deduped.values()].map(u => ({ type: 'update', id: u.id, data: u.data })), ...adds.map(d => ({ type: 'add', data: d }))];
  let ok = 0;
  for (let i = 0; i < allOps.length; i += 499) {
    const batch = fsdb.batch();
    for (const op of allOps.slice(i, i + 499)) {
      if (op.type === 'update') batch.set(colRef.doc(op.id), op.data, { merge: true });
      else { const ref = colRef.doc(); batch.set(ref, { ...op.data, id: ref.id }); }
    }
    await batch.commit(); ok += Math.min(499, allOps.length - i);
  }
  await fsdb.collection('base_lists').doc(city).set({ city, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { existing: existing.length, updates: deduped.size, adds: adds.length, ok };
}

// 하위폴더 재귀 수집: { full: 절대경로, folder: 직속 폴더명(없으면 '') }. Excel 잠금파일(~$) 제외.
function walkFiles(dir, folder = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) { out.push(...walkFiles(path.join(dir, ent.name), ent.name)); continue; }
    if (/^~\$/.test(ent.name)) continue;                       // Excel 임시 잠금파일
    if (/기본명단/.test(ent.name)) continue;                   // 생성 산출물(예: 'OO 기본명단.xlsx') 재수집 방지
    if (/\.(xlsx?|xls)$/i.test(ent.name)) out.push({ full: path.join(dir, ent.name), folder });
  }
  return out;
}

// 동일 raw행(이름+휴대폰+공백제거주소) 사전 제거 — processAddress API 호출 절감(49k→~10k)
function prededupe(recs) {
  const seen = new Set();
  const out = [];
  for (const r of recs) {
    const key = `${r.이름}__${digitKey(r.전화a)}__${String(r.주소 || '').replace(/\s+/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  return out;
}

async function main() {
  const files = walkFiles(DIR).filter(x => !FILE_FILTER || x.full.includes(FILE_FILTER));
  // 도시별 그룹화 (기준명단 먼저 → 명단관리 나중: 명단관리 기사·순번이 마지막에 반영)
  const byCity = new Map();
  for (const f of files) for (const r of loadFile(f.full, f.folder)) {
    if (!byCity.has(r._city)) byCity.set(r._city, []);
    byCity.get(r._city).push(r);
  }
  for (const [city, recs] of byCity) {
    const order = { base: 0, '': 1, manage: 2 };               // 기준명단 → 일반 → 명단관리 순
    recs.sort((a, b) => (order[a._role] ?? 1) - (order[b._role] ?? 1));
    byCity.set(city, prededupe(recs));
  }
  console.log(`\n파일 ${files.length}개 → 지자체 ${byCity.size}개 | 모드: ${COUNT ? '카운트' : WRITE ? '★실제쓰기★' : 'dry-run'} | limit/지자체: ${LIMIT}\n`);

  if (COUNT) {
    let gTot = 0, gSave = 0;
    for (const [city, recs] of byCity) {
      let save = 0;
      for (const r of recs) { const { mobile, landline } = classifyPhones(r.전화a, r.전화b); if (digitKey(mobile).length >= 9 || digitKey(landline).length >= 9) save++; }
      console.log(`  [${city}] 총 ${recs.length} · 저장가능(전화보유) ${save} · 무전화 ${recs.length - save}`);
      gTot += recs.length; gSave += save;
    }
    console.log(`\n총 ${gTot}행 · 저장가능 ${gSave} · 무전화(스킵) ${gTot - gSave}`);
    process.exit(0);
  }

  let fsdb = null;
  if (WRITE) {
    const sa = JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    fsdb = admin.firestore();
  }

  const grand = { updates: 0, adds: 0, ng: 0, total: 0 };
  for (const [city, recs0] of byCity) {
    const recs = LIMIT === Infinity ? recs0 : recs0.slice(0, LIMIT);
    const refined = [];
    let done = 0;
    await asyncPool(8, recs, async (r) => {
      try {
        const res = await processAddress(r.주소, r.이름, r.행정동, r._city, r.비고, { includeCoords: false });
        refined.push({ r, res });
        if (res.확인필요) grand.ng++;
        if (!WRITE) {
          console.log(`  [${r._city}/${r.행정동}] ${r.이름} | "${r.주소}" → "${res.주소}"`);
          console.log(`     도로명[${res.도로명주소}] 상세[${res.상세주소}] 괄호[${res.괄호정보}]${res.확인필요 ? ` ⚠️${res.확인사유}` : ''}`);
        }
      } catch (e) { grand.ng++; console.log(`  ❌ ${r.이름}: ${e.message}`); }
      if (WRITE && (++done % 500 === 0)) console.log(`  …${city} 정제 ${done}/${recs.length}`);
    });
    grand.total += refined.length;
    if (WRITE) {
      const st = await matchAndWrite(fsdb, city, refined);
      grand.updates += st.updates; grand.adds += st.adds;
      console.log(`  ✅ [${city}] 기존 ${st.existing} · 신규추가 ${st.adds} · 업데이트 ${st.updates} · 커밋 ${st.ok}`);
    } else {
      console.log(`  ── [${city}] 처리 ${refined.length}행 ──\n`);
    }
  }
  console.log(`\n총계: 처리 ${grand.total} · 확인필요 ${grand.ng}${WRITE ? ` · 신규 ${grand.adds} · 업데이트 ${grand.updates}` : ''}`);
  console.log(WRITE ? '✅ 실제 기록 완료.' : 'dry-run 완료. 실제 기록은 --write.');
  if (WRITE) await admin.app().delete().catch(() => {});
  process.exit(0);
}
main().catch(e => { console.error('치명 오류:', e); process.exit(1); });
