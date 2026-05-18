/**
 * 생년월일 일괄 업데이트 스크립트
 * 생년월일DATA.xlsx → 기본명단 birthKey 업데이트
 * 매칭: 이름+휴대폰(숫자) → 이름+전화(숫자) 2순위
 *
 * 실행: node scripts/update_birthkey.cjs
 */

const https = require('https');
const XLSX  = require('xlsx');
const path  = require('path');
const fs    = require('fs');

const PROJECT_ID = 'logis-op';
const CITIES = ['충청남도 천안시 동남구', '충청남도 천안시 서북구'];
const FILE   = path.join(__dirname, '..', '생년월일DATA.xlsx');
const CHUNK  = 200;

// ── OAuth2 ───────────────────────────────────────────────────────────────────
async function getAccessToken() {
  const cred = JSON.parse(fs.readFileSync('C:/Users/ttong/AppData/Local/Temp/firebase-cred.json', 'utf8'));
  const params = new URLSearchParams({
    client_id: cred.client_id, client_secret: cred.client_secret,
    refresh_token: cred.refresh_token, grant_type: 'refresh_token',
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b).access_token); } catch(e) { reject(new Error('토큰 파싱 실패: ' + b)); } });
    });
    req.on('error', reject); req.write(params.toString()); req.end();
  });
}

// ── HTTP 헬퍼 ────────────────────────────────────────────────────────────────
function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

const BASE = `projects/${PROJECT_ID}/databases/(default)/documents`;

// ── 컬렉션 전체 읽기 (페이지네이션) ──────────────────────────────────────────
async function listAll(token, collPath) {
  const docs = [];
  let pageToken = null;
  const fsUrl = p => `https://firestore.googleapis.com/v1/${BASE}/${p}`;
  do {
    const url = new URL(fsUrl(collPath));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await httpsReq({ hostname: url.hostname, path: url.pathname + url.search, method: 'GET',
      headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) throw new Error(`listAll 오류 ${res.status}: ${JSON.stringify(res.body).slice(0,200)}`);
    (res.body.documents || []).forEach(d => docs.push(d));
    pageToken = res.body.nextPageToken || null;
    process.stdout.write(`\r   DB 로드: ${docs.length}건`);
  } while (pageToken);
  return docs;
}

// ── 배치 커밋 ────────────────────────────────────────────────────────────────
async function commitBatch(token, writes) {
  const res = await httpsReq({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, { writes });
  if (res.status !== 200) throw new Error(`배치 오류 ${res.status}: ${JSON.stringify(res.body).slice(0,200)}`);
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
const dk = v => String(v || '').replace(/[^\d]/g, '');

function normalizeBirth(raw) {
  if (!raw && raw !== 0) return '';
  const s = String(raw).replace(/[^\d]/g, '');
  if (s.length === 8) {
    // YYYYMMDD → YY.MM.DD
    return `${s.slice(2, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
  }
  if (s.length === 6) {
    // YYMMDD → YY.MM.DD
    return `${s.slice(0, 2)}.${s.slice(2, 4)}.${s.slice(4, 6)}`;
  }
  // 이미 YY.MM.DD 형식 등
  const m = String(raw).match(/(\d{2})[.\-\/](\d{2})[.\-\/](\d{2})/);
  if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  return String(raw).trim();
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔑 토큰 발급 중...');
  const token = await getAccessToken();
  console.log('   ✅ 완료\n');

  // ── Excel 읽기 ─────────────────────────────────────────────────────────────
  console.log('📂 생년월일DATA.xlsx 읽기 중...');
  const wb   = XLSX.readFile(FILE);
  const wsName = wb.SheetNames.find(n => n.includes('신청명단')) || wb.SheetNames[wb.SheetNames.length - 1];
  const ws   = wb.Sheets[wsName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log(`   시트: "${wsName}", 전체 ${rows.length - 1}행\n`);

  // 헤더 인식
  const header = rows[0].map(c => String(c || '').trim());
  const nameIdx  = header.findIndex(c => /이름|성명/.test(c));
  const birthIdx = header.findIndex(c => /생년월일|생년|출생/.test(c));
  const mobileIdx= header.findIndex(c => /휴대폰|휴대|모바일|핸드폰/.test(c));
  const phoneIdx = header.findIndex(c => /전화|연락처/.test(c) && !/휴대|모바일/.test(c));

  console.log(`   헤더 인식 → 이름:${nameIdx} 생년월일:${birthIdx} 휴대폰:${mobileIdx} 전화:${phoneIdx}`);
  if (nameIdx < 0 || birthIdx < 0) {
    console.error('❌ 이름 또는 생년월일 컬럼을 찾지 못했습니다. 헤더:', header);
    process.exit(1);
  }

  // Excel 데이터 → Map 구축 (이름+휴대폰 / 이름+전화)
  const byMobile   = new Map(); // name_digitMobile → birthKey
  const byPhone    = new Map(); // name_digitPhone  → birthKey
  let excelTotal = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[nameIdx] || '').trim();
    if (!name) continue;
    const birth = normalizeBirth(r[birthIdx]);
    if (!birth) continue;
    excelTotal++;
    const mob = mobileIdx >= 0 ? dk(r[mobileIdx]) : '';
    const ph  = phoneIdx  >= 0 ? dk(r[phoneIdx])  : '';
    // 같은 전화번호가 2곳(전화/휴대폰)에 있는 경우 모두 등록
    if (mob.length >= 9) byMobile.set(`${name}__${mob}`, birth);
    if (ph.length >= 9 && ph !== mob) byPhone.set(`${name}__${ph}`, birth);
  }
  console.log(`   유효 데이터: ${excelTotal}행 → 휴대폰키 ${byMobile.size}건, 전화키 ${byPhone.size}건\n`);

  // ── 각 지자체 처리 ──────────────────────────────────────────────────────────
  for (const city of CITIES) {
    console.log(`${'─'.repeat(60)}`);
    console.log(`🏙  ${city} 처리 중`);
    console.log('─'.repeat(60));

    const collPath = `base_lists/${encodeURIComponent(city)}/records`;
    let dbDocs;
    try {
      dbDocs = await listAll(token, collPath);
    } catch (e) {
      console.log(`\n   ⚠️  데이터 없음 (${e.message}) — 스킵`);
      continue;
    }
    console.log(`\n   기존 레코드: ${dbDocs.length}건`);

    // 업데이트 목록 구성
    const updates = []; // { docName, newBirthKey }
    let alreadyHas = 0, matched = 0, noMatch = 0;

    dbDocs.forEach(d => {
      const f = d.fields || {};
      const name = (f.name?.stringValue || f.이름?.stringValue || '').trim();
      if (!name) { noMatch++; return; }

      const mob = dk(f.mobile?.stringValue    || f.휴대폰?.stringValue    || '');
      const ld  = dk(f.landline?.stringValue  || f.유선전화?.stringValue  || '');
      const curBirth = (f.birthKey?.stringValue || f.생년월일?.stringValue || '').trim();

      // Excel에서 생년월일 조회 (휴대폰 우선, 전화 폴백)
      let newBirth = '';
      if (mob.length >= 9) newBirth = byMobile.get(`${name}__${mob}`) || byPhone.get(`${name}__${mob}`) || '';
      if (!newBirth && ld.length >= 9) newBirth = byMobile.get(`${name}__${ld}`) || byPhone.get(`${name}__${ld}`) || '';

      if (!newBirth) { noMatch++; return; }
      if (curBirth === newBirth) { alreadyHas++; return; } // 이미 동일 → 스킵

      updates.push({ docName: d.name, newBirth });
      matched++;
    });

    console.log(`   매칭 결과 → 업데이트: ${matched}건 / 이미동일: ${alreadyHas}건 / 미매칭: ${noMatch}건`);

    if (updates.length === 0) {
      console.log('   ✅ 업데이트 없음 (이미 최신)\n');
      continue;
    }

    // 배치 업데이트
    console.log(`   배치 저장 중... (${updates.length}건, ${CHUNK}건씩)`);
    let done = 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      const writes = chunk.map(({ docName, newBirth }) => ({
        update: {
          name: docName,
          fields: { birthKey: { stringValue: newBirth } },
        },
        updateMask: { fieldPaths: ['birthKey'] },
      }));
      await commitBatch(token, writes);
      done += chunk.length;
      const pct = Math.round(done / updates.length * 100);
      process.stdout.write(`\r   저장: ${done}/${updates.length} (${pct}%)`);
    }
    console.log(`\n   ✅ ${updates.length}건 birthKey 업데이트 완료\n`);
  }

  console.log('\n🎉 전체 완료!');
  process.exit(0);
}

main().catch(e => { console.error('❌ 오류:', e.message); process.exit(1); });
