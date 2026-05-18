/**
 * 기본명단 업로드 스크립트 (범용)
 * 사용법: node upload_dongnam_base.cjs [CITY] [FILE]
 * Firestore REST API + OAuth2 refresh token 인증
 */

const https = require('https');
const XLSX  = require('xlsx');
const path  = require('path');
const fs    = require('fs');

// ── 상수 (CLI 인수 또는 기본값) ───────────────────────────────────────
const PROJECT_ID = 'logis-op';
const CITY       = process.argv[2] || '충청남도 천안시 동남구';
const FILE_PATH  = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(__dirname, '..', '충청남도_동남구_기본명단(1-5월).xls');
const CHUNK      = 200;

// ── OAuth2 토큰 갱신 ──────────────────────────────────────────────────
async function getAccessToken() {
  const credData = JSON.parse(fs.readFileSync('C:/Users/ttong/AppData/Local/Temp/firebase-cred.json', 'utf8'));
  const params = new URLSearchParams({
    client_id:     credData.client_id,
    client_secret: credData.client_secret,
    refresh_token: credData.refresh_token,
    grant_type:    'refresh_token',
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body).access_token); }
        catch(e) { reject(new Error('토큰 파싱 실패: ' + body)); }
      });
    });
    req.on('error', reject);
    req.write(params.toString());
    req.end();
  });
}

// ── Firestore REST 유틸 ───────────────────────────────────────────────
function fsUrl(path) {
  return `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ── Firestore 값 인코딩 ───────────────────────────────────────────────
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return { integerValue: String(Math.round(v)) };
  return { stringValue: String(v) };
}

function toFsDoc(obj) {
  const fields = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (k === 'updatedAt') {
      fields[k] = { timestampValue: new Date().toISOString() };
    } else {
      fields[k] = toFsValue(v);
    }
  });
  return { fields };
}

// ── Firestore 문서 목록 가져오기 (페이지네이션) ───────────────────────
async function listAllDocs(token, collPath) {
  const docs = [];
  let pageToken = null;
  do {
    const url = new URL(fsUrl(collPath));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const hostname = url.hostname;
    const urlPath  = url.pathname + url.search;
    const res = await httpsRequest({
      hostname, path: urlPath, method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status !== 200) throw new Error(`리스트 오류 ${res.status}: ${JSON.stringify(res.body)}`);
    (res.body.documents || []).forEach(d => docs.push(d));
    pageToken = res.body.nextPageToken || null;
    process.stdout.write(`\r   기존 레코드 로드: ${docs.length}건`);
  } while (pageToken);
  return docs;
}

// ── Firestore REST 배치 커밋 ──────────────────────────────────────────
async function commitBatch(token, writes) {
  const res = await httpsRequest({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }, { writes });
  if (res.status !== 200) {
    throw new Error(`배치 오류 ${res.status}: ${JSON.stringify(res.body).slice(0,200)}`);
  }
  return res.body;
}

// ── 유틸 ──────────────────────────────────────────────────────────────
const digitKey  = v => String(v || '').replace(/[^\d]/g, '');
const cleanNote = v => String(v || '')
  .replace(/\s*◆[^◆]*/g, '')
  .replace(/공제|계좌|현금/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const formatPhone = raw => {
  const d = digitKey(raw);
  if (!d) return '';
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  if (d.length === 10 && d.startsWith('02')) return `${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6)}`;
  if (d.length === 9  && d.startsWith('02')) return `${d.slice(0,2)}-${d.slice(2,5)}-${d.slice(5)}`;
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return String(raw || '');
};

// ── 메인 ──────────────────────────────────────────────────────────────
async function main() {
  console.log('🔑 OAuth2 액세스 토큰 발급 중...');
  const token = await getAccessToken();
  console.log('   ✅ 토큰 발급 완료');

  // XLS 읽기
  console.log('\n📂 파일 읽기 중...');
  const wb   = XLSX.readFile(FILE_PATH);
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const dataRows = rows.slice(1).filter(r => {
    const note = cleanNote(r[8]);
    const name = String(r[1] || '').trim();
    return name && note;
  });
  console.log(`   특이사항 있는 행: ${dataRows.length}개 (전체 ${rows.length - 1}행)`);

  // 기존 base_lists 로드
  console.log(`\n🔍 기존 ${CITY} 명단 로드 중...`);
  const collPath = `base_lists/${encodeURIComponent(CITY)}/records`;
  let existingDocs;
  try {
    existingDocs = await listAllDocs(token, collPath);
  } catch(e) {
    // city 문서가 없으면 빈 배열
    console.log('\n   (기존 데이터 없음 — 전체 신규 저장)');
    existingDocs = [];
  }
  console.log(`\n   기존 레코드: ${existingDocs.size || existingDocs.length}건`);

  // 매칭 인덱스 구축
  const liveByPhone    = {};
  const liveByLandline = {};
  const birthKeyedNames = new Set();
  const docPathById = {};

  existingDocs.forEach(d => {
    const docId = d.name.split('/').pop();
    const f = d.fields || {};
    const name = (f.name?.stringValue || f.이름?.stringValue || '').trim();
    const bk   = digitKey(f.birthKey?.stringValue || f.생년월일?.stringValue || '');
    const ph   = digitKey(f.mobile?.stringValue   || f.휴대폰?.stringValue   || '');
    const ld   = digitKey(f.landline?.stringValue || f.유선전화?.stringValue || '');
    if (!name) return;
    docPathById[docId] = d.name;
    if (bk) {
      birthKeyedNames.add(name);
    } else if (ph.length >= 9) {
      liveByPhone[`${name}__${ph}`] = { id: docId, docName: d.name };
    } else if (ld.length >= 9) {
      liveByLandline[`${name}__${ld}`] = { id: docId, docName: d.name };
    }
  });

  // 업데이트/신규 분류
  const writes = [];
  let updateCount = 0, insertCount = 0, skipCount = 0;
  const basePath = `projects/${PROJECT_ID}/databases/(default)/documents/base_lists/${CITY}/records`;

  dataRows.forEach(r => {
    const name     = String(r[1] || '').trim();
    const dong     = String(r[3] || '').trim();
    const address  = String(r[4] || '').replace(/\n/g, ' ').trim();
    const mobile   = formatPhone(r[6]);
    const landline = formatPhone(r[5]);
    const mKey     = digitKey(mobile);
    const lKey     = digitKey(landline);
    const note     = cleanNote(r[8]);
    const type     = String(r[0] || '').includes('차상위') ? '차상위' : '기초수급자';

    if (mKey.length < 9 && lKey.length < 9) { skipCount++; return; }

    // 2순위: 이름+휴대폰 매칭
    if (mKey.length >= 9) {
      const matched = liveByPhone[`${name}__${mKey}`];
      if (matched) {
        writes.push({
          update: { name: matched.docName, fields: toFsDoc({ note, updatedAt: 'SERVER_TS' }).fields },
          updateMask: { fieldPaths: ['note', 'updatedAt'] },
        });
        updateCount++;
        return;
      }
    }
    // 3순위: 이름+유선 매칭
    if (lKey.length >= 9) {
      const matched = liveByLandline[`${name}__${lKey}`];
      if (matched) {
        writes.push({
          update: { name: matched.docName, fields: toFsDoc({ note, updatedAt: 'SERVER_TS' }).fields },
          updateMask: { fieldPaths: ['note', 'updatedAt'] },
        });
        updateCount++;
        return;
      }
    }

    // B-2: 동명이인 보호
    if (birthKeyedNames.has(name)) { skipCount++; return; }

    // 신규 삽입
    const newId  = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
    const docName = `${basePath}/${newId}`;
    writes.push({
      update: {
        name: docName,
        fields: toFsDoc({ id: newId, name, birthKey: '', dong, address, mobile, landline, note, type, updatedAt: 'SERVER_TS' }).fields,
      },
    });
    insertCount++;
  });

  console.log(`\n📊 업데이트: ${updateCount}건 / 신규: ${insertCount}건 / 제외: ${skipCount}건`);
  console.log(`💾 배치 저장 시작... (${writes.length}건, ${CHUNK}건씩)`);

  let success = 0;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const chunk = writes.slice(i, i + CHUNK);
    // SERVER_TS placeholder → Firestore serverTimestamp transform
    const processedChunk = chunk.map(w => {
      if (!w.update?.fields?.updatedAt) return w;
      const newFields = { ...w.update.fields };
      delete newFields.updatedAt;
      return {
        ...w,
        update: { ...w.update, fields: newFields },
        currentDocument: w.updateMask ? { exists: true } : undefined,
        transform: {
          document: w.update.name,
          fieldTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
      };
    });

    // commit은 writes와 transforms를 함께 보냄
    const commitWrites = [];
    processedChunk.forEach(w => {
      commitWrites.push({ update: w.update, updateMask: w.updateMask });
      if (w.transform) {
        commitWrites.push({ transform: { document: w.transform.document, fieldTransforms: w.transform.fieldTransforms } });
      }
    });

    try {
      await commitBatch(token, commitWrites.filter(w => w.update || w.transform));
      success += chunk.length;
      const pct = Math.round(Math.min(i + CHUNK, writes.length) / writes.length * 100);
      process.stdout.write(`\r   진행: ${success}/${writes.length} (${pct}%)`);
    } catch (e) {
      console.error(`\n   [배치 ${Math.floor(i/CHUNK)+1}] 오류:`, e.message);
    }
  }

  console.log(`\n\n✅ 완료 — 업데이트: ${updateCount}건 / 신규: ${insertCount}건`);
  process.exit(0);
}

main().catch(e => { console.error('❌ 치명적 오류:', e.message); process.exit(1); });
