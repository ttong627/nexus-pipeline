/**
 * base_lists 도시 ID 마이그레이션
 * 구: 천안시 동남구 / 천안시 서북구
 * 신: 충청남도 천안시 동남구 / 충청남도 천안시 서북구
 *
 * 실행: node scripts/rename_city_docs.cjs
 */

const https = require('https');
const fs    = require('fs');

const PROJECT_ID = 'logis-op';
const RENAMES = [
  { from: '천안시 동남구', to: '충청남도 천안시 동남구' },
  { from: '천안시 서북구', to: '충청남도 천안시 서북구' },
];
const CHUNK = 200;

// ── OAuth2 토큰 ──────────────────────────────────────────────────────────────
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
const fsUrl = p => `https://firestore.googleapis.com/v1/${BASE}/${p}`;

// ── 컬렉션 전체 페이지네이션 읽기 ─────────────────────────────────────────────
async function listAll(token, collPath) {
  const docs = [];
  let pageToken = null;
  do {
    const url = new URL(fsUrl(collPath));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await httpsReq({ hostname: url.hostname, path: url.pathname + url.search, method: 'GET',
      headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) throw new Error(`listAll 오류 ${res.status}: ${JSON.stringify(res.body).slice(0,200)}`);
    (res.body.documents || []).forEach(d => docs.push(d));
    pageToken = res.body.nextPageToken || null;
    process.stdout.write(`\r   읽는 중: ${docs.length}건`);
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

// ── 단일 문서 PATCH (create/update) ──────────────────────────────────────────
async function patchDoc(token, docPath, fields) {
  const url = new URL(fsUrl(docPath));
  const fieldNames = Object.keys(fields);
  fieldNames.forEach(f => url.searchParams.append('updateMask.fieldPaths', f));
  const res = await httpsReq({
    hostname: url.hostname, path: url.pathname + url.search, method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, { fields });
  if (res.status !== 200 && res.status !== 201) throw new Error(`PATCH 오류 ${res.status}: ${JSON.stringify(res.body).slice(0,200)}`);
}

// ── 단일 문서 DELETE ──────────────────────────────────────────────────────────
async function deleteDoc(token, docPath) {
  const url = new URL(fsUrl(docPath));
  const res = await httpsReq({
    hostname: url.hostname, path: url.pathname, method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) throw new Error(`DELETE 오류 ${res.status}: ${JSON.stringify(res.body).slice(0,200)}`);
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔑 토큰 발급 중...');
  const token = await getAccessToken();
  console.log('   ✅ 완료\n');

  for (const { from, to } of RENAMES) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 마이그레이션: "${from}" → "${to}"`);
    console.log('='.repeat(60));

    // 1. 구 경로 records 읽기
    const fromCollPath = `base_lists/${encodeURIComponent(from)}/records`;
    console.log(`\n[1] 기존 레코드 읽기 중...`);
    let docs;
    try {
      docs = await listAll(token, fromCollPath);
    } catch (e) {
      console.log(`\n   ⚠️  기존 데이터 없음 (${e.message}) — 스킵`);
      continue;
    }
    console.log(`\n   총 ${docs.length}건 읽기 완료`);

    if (docs.length === 0) {
      console.log('   데이터가 없습니다. 스킵.');
      continue;
    }

    // 2. 신 경로에 배치 복사
    console.log(`\n[2] 신 경로에 복사 중...`);
    const newBasePath = `${BASE}/base_lists/${to}/records`;
    let copied = 0;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const chunk = docs.slice(i, i + CHUNK);
      const writes = chunk.map(d => {
        const oldDocId = d.name.split('/').pop();
        return {
          update: {
            name: `${newBasePath}/${oldDocId}`,
            fields: d.fields,
          },
        };
      });
      await commitBatch(token, writes);
      copied += chunk.length;
      process.stdout.write(`\r   복사: ${copied}/${docs.length}`);
    }
    console.log(`\n   ✅ ${copied}건 복사 완료`);

    // 3. 신 부모 문서 생성 (base_lists/{newCity})
    console.log(`\n[3] 신 부모 문서 생성...`);
    await patchDoc(token, `base_lists/${encodeURIComponent(to)}`, {
      city: { stringValue: to },
      createdAt: { timestampValue: new Date().toISOString() },
    });
    console.log('   ✅ 부모 문서 생성 완료');

    // 4. 구 records 배치 삭제
    console.log(`\n[4] 구 레코드 삭제 중...`);
    let deleted = 0;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const chunk = docs.slice(i, i + CHUNK);
      const writes = chunk.map(d => ({ delete: d.name }));
      await commitBatch(token, writes);
      deleted += chunk.length;
      process.stdout.write(`\r   삭제: ${deleted}/${docs.length}`);
    }
    console.log(`\n   ✅ ${deleted}건 삭제 완료`);

    // 5. 구 부모 문서 삭제
    console.log(`\n[5] 구 부모 문서 삭제...`);
    try {
      await deleteDoc(token, `base_lists/${encodeURIComponent(from)}`);
      console.log('   ✅ 구 부모 문서 삭제 완료');
    } catch (e) {
      console.log(`   ⚠️  부모 문서 삭제 실패 (무시): ${e.message}`);
    }

    console.log(`\n✅ "${from}" → "${to}" 마이그레이션 완료!`);
  }

  console.log('\n\n🎉 전체 마이그레이션 완료!');
  process.exit(0);
}

main().catch(e => { console.error('❌ 오류:', e.message); process.exit(1); });
