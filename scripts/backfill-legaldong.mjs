// 법정동 일괄 백필 — 기본은 DRY-RUN(쓰기 없음). 실제 반영은 --write.
//   cloud_lists 레코드의 도로명을 /v1/address/match로 조회 → 법정동·건물명을 정식값으로 교체.
//   상세주소(동·호수)는 guardAddressDetail로 보존, 매칭 실패 레코드는 절대 건드리지 않음(오정보 방지).
//   PII(이름·전화·좌표) 미변경. 앱 정제 규칙(parseDisplayedAddress/guardAddressDetail) 재사용.
//
//   사용:
//     node scripts/_backfill-legaldong.mjs "서울특별시 동대문구" 2026-07           # dry-run
//     node scripts/_backfill-legaldong.mjs "서울특별시 동대문구" 2026-07 --write     # 실제 반영
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { parseDisplayedAddress, guardAddressDetail } from '../src/utils/addressFormat.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const API = (env.match(/^VITE_ADDRESS_MATCH_API_URL=(.*)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');

const CITY = process.argv[2];
const MONTH = process.argv[3];
const WRITE = process.argv.includes('--write');
if (!CITY || !MONTH) { console.error('사용: node scripts/_backfill-legaldong.mjs "<시군구>" <YYYY-MM> [--write]'); process.exit(1); }
if (!API) { console.error('VITE_ADDRESS_MATCH_API_URL 미설정'); process.exit(1); }

// 괄호 건물명 자리 텍스트가 '건물명'이 아니라 호/동 상세주소인지 판별(102호·지층2호 등 → 상세로 이관, 삭제 금지)
const BLDG_KW = /(아파트|아파트먼트|빌라|빌리지|빌딩|타워|타운|하우스|힐스|캐슬|팰리스|자이|푸르지오|래미안|더샵|편한세상|e편한|아이파크|센트럴|리버|파크|맨션|연립|주택|센터|프라자|플라자|오피스텔|스테이트|시티|카운티|스카이|가든|테라스|하임|에코빌|현대|삼성|롯데|대우|한신|우성|주공|빌$)/;

// 새 괄호 조립 (formatAddressDisplay detailBeforeParen 규칙과 동일): "도로명, 상세 (법정동, 건물명)"
//   carryDetail: 괄호에서 상세로 이관할 호/동 텍스트(형 지시 — 삭제 금지, 상세로 이동)
const rebuild = (oldAddr, legalDong, buildingName, carryDetail = '') => {
  const { road, detail } = parseDisplayedAddress(oldAddr);
  if (!road) return oldAddr;
  let fullDetail = detail;
  if (carryDetail) {
    const dn = detail.replace(/\s+/g, '');
    if (!dn.includes(carryDetail.replace(/\s+/g, ''))) fullDetail = detail ? `${detail} ${carryDetail}` : carryDetail;
  }
  const paren = [legalDong, buildingName].filter(Boolean).join(', ');
  let next = road;
  if (fullDetail && paren) next = `${road}, ${fullDetail} (${paren})`;
  else if (fullDetail) next = `${road}, ${fullDetail}`;
  else if (paren) next = `${road}, (${paren})`;
  return guardAddressDetail(oldAddr, next); // 동·호수 손실 방지
};

async function matchOne(query, cityLabel) {
  try {
    const res = await fetch(`${API}/v1/address/match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, cityLabel, allowJusoFallback: false }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json();
    return (j?.ok && j?.data) ? j.data : null;
  } catch { return null; }
}

// 동시성 제한 실행
async function pool(items, size, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx], idx); }
  }));
  return out;
}

async function main() {
  console.log(`\n${'='.repeat(60)}\n${WRITE ? '★ WRITE 모드 (실제 반영)' : 'DRY-RUN (쓰기 없음)'} — ${CITY} ${MONTH}\n${'='.repeat(60)}`);
  const snap = await db.collection(`cloud_lists/${CITY}/months/${MONTH}/records`).get();
  const docs = snap.docs.map(d => ({ id: d.id, r: d.data() }));
  console.log('레코드:', docs.length, '  매칭 조회 시작...');

  const stat = { total: docs.length, matched: 0, unmatched: 0, legalSet: 0, legalChanged: 0, addrChanged: 0, bldgSet: 0, carried: 0, skippedBroken: 0, guardKept: 0, noRoad: 0 };
  const samples = [], changedLegal = [], carrySamples = [];

  const results = await pool(docs, 12, async ({ id, r }) => {
    const oldAddr = String(r.주소 || '');
    const { road } = parseDisplayedAddress(oldAddr);
    if (!road) { stat.noRoad++; return null; }
    const data = await matchOne(`${CITY} ${road}`, CITY);
    if (!data || !(data.legalDong || data.emdNm)) { stat.unmatched++; return null; }
    stat.matched++;
    const newLegal = String(data.legalDong || data.emdNm || '').trim();
    const oldLegal = String(r.legalDong || '').trim();
    // 형 방침: 서버 건물명 있으면 교체, 없으면 기존(괄호 건물명 우선 → 필드) 보존.
    //   단 괄호의 '건물명'이 실제로 호/동 상세(102호 등)면 삭제 금지 → 상세주소로 이관.
    const { paren: _oldParen } = parseDisplayedAddress(oldAddr);
    const _oldParenBldg = (() => { const ci = _oldParen.indexOf(','); return ci >= 0 ? _oldParen.slice(ci + 1).trim() : ''; })();
    const _fieldBldg = String(r.buildingName || r.건물명 || '').trim();
    const serverBldg = String(data.buildingName || '').trim();
    // 괄호값이 '정식 건물명'(아파트·빌라·빌딩 등 키워드)인가? 아니면 호수·배송힌트(102호·계단위집·지) → 상세 이관
    const parenBldgIsBuilding = _oldParenBldg && BLDG_KW.test(_oldParenBldg);
    let carryDetail = '';
    let newBldg;
    if (serverBldg) {
      newBldg = serverBldg;                                   // 서버 정식 건물명으로 교체
      if (_oldParenBldg && !parenBldgIsBuilding) carryDetail = _oldParenBldg; // 건물명 아닌 기존값은 상세로 이관
    } else if (parenBldgIsBuilding) {
      newBldg = _oldParenBldg;                                // 영성빌라 등 정식 건물명 보존
    } else {
      newBldg = _fieldBldg;                                   // 괄호값은 건물명 아님 → 필드 건물명만(없으면 없음)
      if (_oldParenBldg) carryDetail = _oldParenBldg;         // 계단위집·102호·지 등 → 상세로 이관(삭제 금지)
    }
    // 이관값이 최종 건물명과 같으면 중복이므로 이관 안 함
    if (carryDetail && carryDetail === newBldg) carryDetail = '';
    // 깨진 원본(괄호 짝 불균형)은 재조립이 더 망가뜨림 → 주소 문자열 손대지 않고 법정동/건물명 필드만 갱신
    const balanced = oldAddr.split('(').length === oldAddr.split(')').length;
    let newAddr;
    if (!balanced) { newAddr = oldAddr; carryDetail = ''; stat.skippedBroken++; }
    else { if (carryDetail) stat.carried++; newAddr = rebuild(oldAddr, newLegal, newBldg, carryDetail); }

    if (newLegal) stat.legalSet++;
    if (newLegal && newLegal !== oldLegal) { stat.legalChanged++; if (changedLegal.length < 15) changedLegal.push(`${oldLegal || '∅'} → ${newLegal}   [${road}]`); }
    if (newBldg) stat.bldgSet++;
    if (newAddr !== oldAddr) stat.addrChanged++;
    if (newAddr === oldAddr && String(r.주소) !== newAddr) stat.guardKept++;
    if (carryDetail && carrySamples.length < 12) carrySamples.push(`  전: ${oldAddr}\n  후: ${newAddr}   (이관: "${carryDetail}")`);
    else if (samples.length < 18 && newAddr !== oldAddr) samples.push(`  전: ${oldAddr}\n  후: ${newAddr}`);

    return { id, patch: { legalDong: newLegal, 법정동: newLegal, buildingName: newBldg, 건물명: newBldg, 주소: newAddr, standardRoadAddress: data.standardRoadAddress || r.standardRoadAddress || '', addressMatchSource: 'db-match-backfill' } };
  });

  console.log('\n=== 집계 ===');
  Object.entries(stat).forEach(([k, v]) => console.log('  ', k.padEnd(14), v));
  console.log('\n=== 법정동 변경 샘플 ==='); changedLegal.forEach(s => console.log('  ', s));
  console.log('\n=== 상세 이관 샘플 (102호·계단위집 등 → 상세, 삭제금지) ==='); carrySamples.forEach(s => console.log(s));
  console.log('\n=== 주소 재조립 샘플(전/후) ==='); samples.forEach(s => console.log(s));

  if (!WRITE) { console.log('\n[DRY-RUN] 쓰기 안 함. 검증 후 --write 로 반영하세요.'); process.exit(0); }

  // 실제 반영
  const toWrite = results.filter(Boolean);
  console.log(`\n★ WRITE: ${toWrite.length}건 Firestore 반영 중...`);
  const CH = 400;
  for (let i = 0; i < toWrite.length; i += CH) {
    const batch = db.batch();
    toWrite.slice(i, i + CH).forEach(({ id, patch }) => batch.set(db.doc(`cloud_lists/${CITY}/months/${MONTH}/records/${id}`), patch, { merge: true }));
    await batch.commit();
    console.log(`  ${Math.min(i + CH, toWrite.length)}/${toWrite.length}`);
  }
  console.log('✓ 반영 완료');
  process.exit(0);
}
main().catch(e => { console.error('실패:', e.message, e.stack); process.exit(1); });
