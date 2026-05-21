/**
 * 안양시 동안구, 여주시, 동대문구 — 문자수신 누락 레코드를 'Y'로 일괄 업데이트
 * 실행: node scripts/fix_sms_y.cjs
 */
const https = require('https');
const fs    = require('fs');

const PROJECT_ID = 'logis-op';
const CITIES = [
  '경기도 안양시 동안구',
  '경기도 여주시',
  '서울특별시 동대문구',
];
const CHUNK = 200;
const BASE  = `projects/${PROJECT_ID}/databases/(default)/documents`;

// ── OAuth2 ───────────────────────────────────────────────────────────────────
async function getAccessToken() {
  // firebase-tools.json 에서 토큰 정보 읽기
  const ftPath = 'C:/Users/ttong/.config/configstore/firebase-tools.json';
  const ft = JSON.parse(fs.readFileSync(ftPath, 'utf8'));
  const tokens = ft.tokens || {};

  // 아직 유효한 access_token 있으면 바로 사용
  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 30000) {
    console.log('   기존 access_token 재사용');
    return tokens.access_token;
  }

  // 만료 → refresh_token으로 재발급 (firebase-tools 클라이언트 정보 사용)
  const CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  const CLIENT_SECRET = 'j9iVZfS7FIjnj6RQcAl6cJ4C'; // firebase-tools 공개 secret
  const params = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: tokens.refresh_token, grant_type: 'refresh_token',
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(b);
          if (!data.access_token) throw new Error('액세스 토큰 없음: ' + b);
          resolve(data.access_token);
        } catch(e) { reject(new Error('토큰 파싱 실패: ' + b)); }
      });
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

// ── 컬렉션 전체 읽기 (페이지네이션) ──────────────────────────────────────────
async function listAll(token, collPath) {
  const docs = [];
  let pageToken = null;
  const fsUrl = p => `https://firestore.googleapis.com/v1/${BASE}/${p}`;
  do {
    const url = new URL(fsUrl(collPath));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await httpsReq({
      hostname: url.hostname, path: url.pathname + url.search, method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status !== 200) throw new Error(`listAll 오류 ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
    (res.body.documents || []).forEach(d => docs.push(d));
    pageToken = res.body.nextPageToken || null;
    process.stdout.write(`\r   로드: ${docs.length}건`);
  } while (pageToken);
  return docs;
}

// ── 단일 문서 GET ─────────────────────────────────────────────────────────────
async function getDoc(token, docPath) {
  const url = `https://firestore.googleapis.com/v1/${BASE}/${docPath}`;
  const res = await httpsReq({
    hostname: 'firestore.googleapis.com',
    path: `/v1/${BASE}/${docPath}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`getDoc 오류 ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  return res.body;
}

// ── 배치 커밋 ────────────────────────────────────────────────────────────────
async function commitBatch(token, writes) {
  const res = await httpsReq({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, { writes });
  if (res.status !== 200) throw new Error(`배치 오류 ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔑 토큰 발급 중...');
  const token = await getAccessToken();
  console.log('   ✅ 완료\n');

  for (const city of CITIES) {
    console.log(`${'─'.repeat(60)}`);
    console.log(`🏙  ${city}`);
    console.log('─'.repeat(60));

    // 도시 문서에서 lastMonthId 읽기
    const cityDocPath = `cloud_lists/${encodeURIComponent(city)}`;
    const cityDoc = await getDoc(token, cityDocPath);
    if (!cityDoc) {
      console.log('   ⚠️  도시 문서 없음, 스킵\n');
      continue;
    }
    const lastMonthId = cityDoc.fields?.lastMonthId?.stringValue;
    if (!lastMonthId) {
      // lastMonthId 없으면 months 컬렉션에서 최신 월 조회
      const monthsPath = `cloud_lists/${encodeURIComponent(city)}/months`;
      const monthsRes = await httpsReq({
        hostname: 'firestore.googleapis.com',
        path: `/v1/${BASE}/${monthsPath}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const monthDocs = monthsRes.body.documents || [];
      if (!monthDocs.length) { console.log('   ⚠️  월 없음, 스킵\n'); continue; }
      const monthIds = monthDocs.map(d => d.name.split('/').pop()).sort((a, b) => b.localeCompare(a));
      var monthId = monthIds[0];
    } else {
      var monthId = lastMonthId;
    }
    console.log(`   최신 월: ${monthId}`);

    // records 전체 읽기
    const recPath = `cloud_lists/${encodeURIComponent(city)}/months/${monthId}/records`;
    let records;
    try {
      records = await listAll(token, recPath);
    } catch (e) {
      console.log(`\n   ⚠️  레코드 로드 실패: ${e.message}, 스킵\n`);
      continue;
    }
    console.log(`\n   전체 레코드: ${records.length}건`);

    // 문자수신이 'Y'가 아닌 레코드 필터
    const targets = records.filter(d => {
      const val = d.fields?.문자수신?.stringValue || '';
      return val !== 'Y';
    });
    console.log(`   업데이트 대상: ${targets.length}건 (이미 Y: ${records.length - targets.length}건)`);

    if (targets.length === 0) {
      console.log('   ✅ 이미 모두 Y, 스킵\n');
      continue;
    }

    // 배치 업데이트
    let done = 0;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK);
      const writes = chunk.map(d => ({
        update: {
          name: d.name,
          fields: { '문자수신': { stringValue: 'Y' } },
        },
        updateMask: { fieldPaths: ['`문자수신`'] },
      }));
      await commitBatch(token, writes);
      done += chunk.length;
      process.stdout.write(`\r   저장: ${done}/${targets.length}건`);
    }
    console.log(`\n   ✅ ${targets.length}건 문자수신 → Y 완료\n`);
  }

  console.log('🎉 전체 완료!');
  process.exit(0);
}

main().catch(e => { console.error('❌ 오류:', e.message); process.exit(1); });
