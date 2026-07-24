// base_lists 법정동 백필 — 기본 DRY-RUN, --write로 반영.
//   base_lists/{city}/records (월 없음). 필드: roadAddr·detailAddr·detailAddress·parenInfo·legalDong·buildingName·address
//   /v1/address/match(Node fetch)로 정확한 법정동·건물명 조회 → parenInfo·address 재조립.
//   정식 건물명(BLDG_KW)만 괄호 유지, 호수·배송힌트는 detailAddr로 이관(삭제금지). 상세 guardAddressDetail 보존.
//   사용: node scripts/backfill-base-legaldong.mjs "<시군구>" [--write]
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { guardAddressDetail, parseDisplayedAddress } from '../src/utils/addressFormat.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const API = (env.match(/^VITE_ADDRESS_MATCH_API_URL=(.*)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');

const CITY = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!CITY) { console.error('사용: node scripts/backfill-base-legaldong.mjs "<시군구>" [--write]'); process.exit(1); }

const BLDG_KW = /(아파트|아파트먼트|빌라|빌리지|빌딩|타워|타운|하우스|힐스|캐슬|팰리스|자이|푸르지오|래미안|더샵|편한세상|e편한|아이파크|센트럴|리버|파크|맨션|연립|주택|센터|프라자|플라자|오피스텔|스테이트|시티|카운티|스카이|가든|테라스|하임|에코빌|현대|삼성|롯데|대우|한신|우성|주공|빌$)/;
const parenBldgOf = (paren) => { const ci = String(paren || '').indexOf(','); return ci >= 0 ? paren.slice(ci + 1).trim() : ''; };

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
async function pool(items, size, worker) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx], idx); } }));
  return out;
}

async function main() {
  console.log(`\n${'='.repeat(60)}\n${WRITE ? '★ WRITE' : 'DRY-RUN'} — base_lists/${CITY}\n${'='.repeat(60)}`);
  const snap = await db.collection(`base_lists/${CITY}/records`).get();
  const docs = snap.docs.map(d => ({ id: d.id, r: d.data() }));
  console.log('레코드:', docs.length, ' 매칭 조회...');
  const stat = { total: docs.length, matched: 0, unmatched: 0, legalSet: 0, legalChanged: 0, parenChanged: 0, carried: 0, skippedBroken: 0, noRoad: 0 };
  const changedLegal = [], carrySamples = [], samples = [];

  const results = await pool(docs, 12, async ({ id, r }) => {
    // roadAddr 우선, 없으면(구 스키마) address 통짜 필드에서 도로명·상세·괄호 파싱
    let road = String(r.roadAddr || '').trim();
    let detail = String(r.detailAddr || r.detailAddress || '').trim();
    let oldParen = String(r.parenInfo || '').trim();
    if (!road && r.address) {
      const p = parseDisplayedAddress(String(r.address));
      road = p.road;
      if (!detail) detail = p.detail;
      if (!oldParen) oldParen = p.paren;
    }
    if (!road) { stat.noRoad++; return null; }
    const data = await matchOne(`${CITY} ${road}`, CITY);
    if (!data || !(data.legalDong || data.emdNm)) { stat.unmatched++; return null; }
    stat.matched++;
    const newLegal = String(data.legalDong || data.emdNm || '').trim();
    const oldLegal = String(r.legalDong || '').trim();
    const oldParenBldg = parenBldgOf(oldParen);
    const fieldBldg = String(r.buildingName || '').trim();
    const serverBldg = String(data.buildingName || '').trim();
    const parenBldgIsBuilding = oldParenBldg && BLDG_KW.test(oldParenBldg);

    let carry = '', newBldg;
    if (serverBldg) { newBldg = serverBldg; if (oldParenBldg && !parenBldgIsBuilding) carry = oldParenBldg; }
    else if (parenBldgIsBuilding) { newBldg = oldParenBldg; }
    else { newBldg = fieldBldg; if (oldParenBldg) carry = oldParenBldg; }
    if (carry && carry === newBldg) carry = '';

    // 상세 이관(중복 아니면)
    let fullDetail = detail;
    if (carry) { const dn = detail.replace(/\s+/g, ''); if (!dn.includes(carry.replace(/\s+/g, ''))) fullDetail = detail ? `${detail} ${carry}` : carry; }

    const newParen = [newLegal, newBldg].filter(Boolean).join(', ');
    let newAddress = road;
    if (fullDetail && newParen) newAddress = `${road}, ${fullDetail} (${newParen})`;
    else if (fullDetail) newAddress = `${road}, ${fullDetail}`;
    else if (newParen) newAddress = `${road}, (${newParen})`;
    const oldAddress = String(r.address || '');
    // 깨진 원본 괄호 불균형이면 address만 원본유지(필드는 갱신)
    const balanced = oldAddress.split('(').length === oldAddress.split(')').length;
    if (!balanced) { newAddress = oldAddress; fullDetail = detail; carry = ''; stat.skippedBroken++; }
    else newAddress = guardAddressDetail(oldAddress, newAddress);

    if (newLegal) stat.legalSet++;
    if (newLegal !== oldLegal) { stat.legalChanged++; if (changedLegal.length < 12) changedLegal.push(`${oldLegal || '∅'} → ${newLegal}  [${road}]  (parenInfo였음: "${oldParen}")`); }
    if (newParen !== oldParen) stat.parenChanged++;
    if (carry) { stat.carried++; if (carrySamples.length < 10) carrySamples.push(`  전: ${oldAddress}\n  후: ${newAddress}  (이관 "${carry}")`); }
    else if (samples.length < 12 && newAddress !== oldAddress) samples.push(`  전: ${oldAddress}\n  후: ${newAddress}`);

    return { id, patch: { legalDong: newLegal, buildingName: newBldg, parenInfo: newParen, detailAddr: fullDetail, detailAddress: fullDetail, address: newAddress, standardRoadAddress: data.standardRoadAddress || r.standardRoadAddress || '', addressMatchSource: 'db-match-backfill' } };
  });

  console.log('\n=== 집계 ==='); Object.entries(stat).forEach(([k, v]) => console.log('  ', k.padEnd(14), v));
  console.log('\n=== 법정동 변경(parenInfo 교정) 샘플 ==='); changedLegal.forEach(s => console.log('  ', s));
  console.log('\n=== 상세 이관 샘플 ==='); carrySamples.forEach(s => console.log(s));
  console.log('\n=== address 재조립 샘플 ==='); samples.forEach(s => console.log(s));

  if (!WRITE) { console.log('\n[DRY-RUN] 검증 후 --write'); process.exit(0); }
  const toWrite = results.filter(Boolean);
  console.log(`\n★ WRITE: ${toWrite.length}건 반영 중...`);
  const CH = 400;
  for (let i = 0; i < toWrite.length; i += CH) {
    const batch = db.batch();
    toWrite.slice(i, i + CH).forEach(({ id, patch }) => batch.set(db.doc(`base_lists/${CITY}/records/${id}`), patch, { merge: true }));
    await batch.commit();
    if ((i / CH) % 5 === 0 || i + CH >= toWrite.length) console.log(`  ${Math.min(i + CH, toWrite.length)}/${toWrite.length}`);
  }
  console.log('✓ 반영 완료');
  process.exit(0);
}
main().catch(e => { console.error('실패:', e.message, e.stack); process.exit(1); });
