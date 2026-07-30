// 건물관리번호 보강(P2) — 기본 DRY-RUN(쓰기 없음). 실제 반영은 --write.
//   `buildingMgtNo`가 없는 레코드를 DB 정본 도로명주소로 재조회해 **식별자 필드만** 채운다.
//   동일성 판정 키(건물관리번호·아파트 군집키)가 강해지면 남은 표기 갈림도 그룹핑해 처리할 수 있다.
//
//   형 방침(엄수):
//     · **주소 문자열은 절대 변경하지 않는다** — 식별자 필드(buildingMgtNo/addressMgtNo/routeHints)만 추가
//     · 조회 실패·불일치는 미변경(원본 보존)
//     · 이름·전화 등 PII는 읽지도 출력하지도 않음
//     · **동시성 3** — 서버 pg.Pool(max 8)을 독점하면 앱 정제가 전부 막힌다(2026-07-30 실제 장애)
//
//   사용:
//     node scripts/backfill-building-mgtno.mjs                   # 규모 파악 + 표본 조회
//     node scripts/backfill-building-mgtno.mjs --write           # 전량 조회 후 반영
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { cleanAddressPiece } from '../src/utils/addressFormat.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const API = (env.match(/^VITE_ADDRESS_MATCH_API_URL=(.*)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const ONLY_CITY = args.find(a => !a.startsWith('--')) || '';
const CONCURRENCY = 3;          // ★서버 커넥션 풀 독점 금지(장애 재발 방지)
const PROBE_LIMIT = 60;         // dry-run 표본 조회 수

const norm = (v) => cleanAddressPiece(v);

async function matchOne(query, cityLabel) {
  try {
    const res = await fetch(`${API}/v1/address/match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, cityLabel, allowJusoFallback: false }),
      signal: AbortSignal.timeout(25000),
    });
    const j = await res.json();
    return (j?.ok && j?.data) ? j.data : null;
  } catch { return null; }
}

async function pool(items, size, worker, onTick) {
  const out = new Array(items.length);
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
      done++;
      if (onTick && done % 200 === 0) onTick(done, items.length);
    }
  }));
  return out;
}

const main = async () => {
  if (!API) { console.error('VITE_ADDRESS_MATCH_API_URL 미설정'); process.exit(1); }
  console.log(`\n${'='.repeat(72)}\n${WRITE ? '★ WRITE 모드 (실제 반영)' : 'DRY-RUN (쓰기 없음)'}${ONLY_CITY ? ` — ${ONLY_CITY}` : ' — 전체'}\n${'='.repeat(72)}`);
  console.log(`동시성 ${CONCURRENCY} (서버 커넥션 풀 독점 방지)`);

  // ── 1단계: 대상 수집 ──
  const targets = [];                 // {ref, std, city}
  const byStd = new Map();            // std -> {city, refs:[]}
  let total = 0, hasMgt = 0, noStd = 0;
  const cities = await db.collection('cloud_lists').listDocuments();
  for (const cityRef of cities) {
    if (ONLY_CITY && !cityRef.id.includes(ONLY_CITY)) continue;
    for (const monthRef of await cityRef.collection('months').listDocuments()) {
      const snap = await monthRef.collection('records').get();
      for (const doc of snap.docs) {
        const r = doc.data();
        total++;
        if (norm(r.buildingMgtNo)) { hasMgt++; continue; }
        const std = norm(r.standardRoadAddress);
        if (!std) { noStd++; continue; }
        targets.push({ ref: doc.ref, std, city: cityRef.id });
        if (!byStd.has(std)) byStd.set(std, { city: cityRef.id, refs: [] });
        byStd.get(std).refs.push(doc.ref);
      }
    }
  }

  const uniq = [...byStd.entries()];
  console.log(`\n[집계] 전체 ${total}건 / 이미 보유 ${hasMgt}건 / **보강대상 ${targets.length}건** / 정본없음 ${noStd}건`);
  console.log(`       고유 도로명주소 ${uniq.length}개 → API 호출 ${uniq.length}회 (중복 ${targets.length - uniq.length}건 절약)`);

  const sample = WRITE ? uniq : uniq.slice(0, PROBE_LIMIT);
  console.log(`\n${WRITE ? '전량' : `표본 ${sample.length}개`} 조회 중... (동시성 ${CONCURRENCY})`);

  let ok = 0, withMgt = 0, withApt = 0;
  const results = await pool(sample, CONCURRENCY, async ([std, g]) => {
    const d = await matchOne(std, g.city);
    if (d) ok++;
    if (norm(d?.buildingMgtNo)) withMgt++;
    if (d?._routeHints?.apartmentGroupKey) withApt++;
    return { std, g, d };
  }, (done, all) => console.log(`  ${done}/${all}...`));

  const rate = sample.length ? (withMgt / sample.length * 100).toFixed(1) : '0';
  console.log(`\n[조회 결과] 매칭 ${ok}/${sample.length} · **건물관리번호 획득 ${withMgt}건(${rate}%)** · 군집키 ${withApt}건`);

  if (!WRITE) {
    console.log(`\n[표본 5건]`);
    for (const r of results.filter(r => r.d?.buildingMgtNo).slice(0, 5)) {
      console.log(`  ${r.std}`);
      console.log(`     buildingMgtNo=${r.d.buildingMgtNo} buildingName=${JSON.stringify(r.d.buildingName)} 적용대상=${r.g.refs.length}건`);
    }
    const est = Math.round(targets.length * (withMgt / (sample.length || 1)));
    console.log(`\n※ DRY-RUN 입니다. 전량 반영 시 약 ${est}건에 식별자가 채워질 것으로 추정됩니다.`);
    console.log(`   주소 문자열은 변경하지 않습니다(식별자 필드만 추가).\n`);
    process.exit(0);
  }

  // ── 반영: 식별자 필드만 ──
  console.log(`\n반영 시작...`);
  let batch = db.batch();
  let n = 0, written = 0;
  for (const { g, d } of results) {
    const mgt = norm(d?.buildingMgtNo);
    if (!mgt) continue;
    const patch = { buildingMgtNo: mgt };
    const addrMgt = norm(d?._addressMgtNo || d?.addressMgtNo);
    if (addrMgt) patch.addressMgtNo = addrMgt;
    if (d?._routeHints) patch.routeHints = d._routeHints;
    for (const ref of g.refs) {
      batch.update(ref, patch);
      n++; written++;
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; console.log(`  ${written}건 반영...`); }
    }
  }
  if (n > 0) await batch.commit();
  console.log(`\n✅ 반영 완료: ${written}건 (주소 문자열 무변경)\n`);
  process.exit(0);
};

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
