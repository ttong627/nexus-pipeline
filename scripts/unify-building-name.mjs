// 건물명 통일(P1) — 기본 DRY-RUN(쓰기 없음). 실제 반영은 --write.
//   같은 건물인데 괄호 표기가 갈린 그룹을 하나로 통일한다.
//
//   ★안전 기본값(2026-07-30 dry-run 실측으로 확정 — 되돌리지 말 것):
//     · 그룹키 = **건물관리번호만**. 같은 도로명주소를 같은 건물로 보면 다세대 밀집지에서
//       실제로 다른 건물을 합친다(실측 시도: '영안아파트'→'태림홈타운', '명성다세대'→'중동빌라').
//       정본 도로명주소 기준까지 넓히려면 `--include-road` 를 명시해야 한다.
//     · 정답 = **전국 주소DB 정본 건물명만**. 최다 표기 추정은 근거가 약해 기본 차단.
//       쓰려면 `--allow-majority` 를 명시해야 한다.
//     · 오염 표기(◆★ 등 A-9 잔재·콤마로 뭉친 값·법정동 혼입)는 정답 후보에서 제외.
//
//   형 방침(엄수):
//     · 빈 건물명으로 통일 금지 — 건물명을 지우는 방향은 정보 삭제다
//     · 괄호에서 빠지는 비건물명 값(5층 식당보관·8652)은 특이사항으로 **이관**(삭제 금지)
//     · 상세주소(동·호수)·A-22 참고블록·건물명 속 괄호 보존
//     · 동률·근소차·후보 없음은 보류(원본 보존)
//     · 이름·전화 등 PII는 읽지도 출력하지도 않음
//     · --learn 을 주면 DB 정본으로 확정된 별칭만 building_alias 사전에 축적
//
//   ⚠️ 선행 조건: 전국 주소DB(nexus-address-api)가 정상이어야 한다. DB 장애 시 정본을 못 받아
//      전부 보류된다(2026-07-30 확인: Cloud SQL 연결 timeout → /v1/address/match 500).
//
//   사용:
//     node scripts/unify-building-name.mjs                        # 전체 dry-run
//     node scripts/unify-building-name.mjs "서울특별시 동대문구"     # 특정 시군구 dry-run
//     node scripts/unify-building-name.mjs --write --learn         # 반영 + 별칭 학습(형 확인 후)
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { parseDisplayedAddress, splitParenInner, cleanAddressPiece } from '../src/utils/addressFormat.js';
import { pickCanonicalBuilding, rebuildParen } from '../src/utils/buildingUnify.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const API = (env.match(/^VITE_ADDRESS_MATCH_API_URL=(.*)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const LEARN = args.includes('--learn');
// ★안전 기본값(2026-07-30 dry-run에서 사고 위험 확인 후 확정):
//   ① 그룹키는 **건물관리번호만** — 같은 도로명주소(std)를 같은 건물로 보면 다세대 밀집지에서
//      실제로 다른 건물을 합친다(실측: '영안아파트'→'태림홈타운', '명성다세대'→'중동빌라' 시도됨).
//      정본 도로명주소 기준 통일이 필요하면 --include-road 를 **명시적으로** 줘야 한다.
//   ② 정답은 **DB 정본 건물명만** — 최다 표기 추정은 근거가 약하다. 쓰려면 --allow-majority 필요.
const INCLUDE_ROAD = args.includes('--include-road');
const ALLOW_MAJORITY = args.includes('--allow-majority');
const ONLY_CITY = args.find(a => !a.startsWith('--')) || '';
const SAMPLE_LIMIT = 20;

const norm = (v) => cleanAddressPiece(v);
const cmpKey = (v) => String(v || '').replace(/[\s()[\]·,./\\-]/g, '');

// 괄호에서 '건물명 자리' 텍스트 추출 — 법정동 토큰을 제외한 나머지를 이어붙인다.
const buildingFromAddr = (addr, legalDong) => {
  const { paren } = parseDisplayedAddress(addr);
  const parts = splitParenInner(paren).filter(t => cmpKey(t) !== cmpKey(legalDong));
  return norm(parts.join(', '));
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

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx], idx); }
  }));
  return out;
}

const main = async () => {
  if (!API) { console.error('VITE_ADDRESS_MATCH_API_URL 미설정'); process.exit(1); }
  console.log(`\n${'='.repeat(72)}\n${WRITE ? '★ WRITE 모드 (실제 반영)' : 'DRY-RUN (쓰기 없음)'}${LEARN ? ' + 별칭 학습' : ''}${ONLY_CITY ? ` — ${ONLY_CITY}` : ' — 전체'}\n${'='.repeat(72)}`);

  console.log(`그룹 기준: ${INCLUDE_ROAD ? '건물관리번호 + 정본 도로명주소(--include-road)' : '건물관리번호만(안전 기본값)'}`);
  console.log(`정답 출처: ${ALLOW_MAJORITY ? 'DB 정본 + 최다 표기(--allow-majority)' : 'DB 정본만(안전 기본값)'}`);

  // ── 1단계: 그룹 수집 ──
  const groups = new Map();   // groupKey -> { city, std, records:[{ref,addr,note,legalDong,bldg}] , variants:Map }
  let total = 0;
  const cities = await db.collection('cloud_lists').listDocuments();
  for (const cityRef of cities) {
    if (ONLY_CITY && !cityRef.id.includes(ONLY_CITY)) continue;
    for (const monthRef of await cityRef.collection('months').listDocuments()) {
      const snap = await monthRef.collection('records').get();
      for (const doc of snap.docs) {
        const r = doc.data();
        total++;
        const addr = norm(r.주소);
        if (!addr) continue;
        const legalDong = norm(r.legalDong || r.법정동);
        const std = norm(r.standardRoadAddress);
        const mgt = norm(r.buildingMgtNo);
        const gkey = mgt ? `mgt:${mgt}` : (INCLUDE_ROAD && std ? `std:${std}` : '');
        if (!gkey || !legalDong) continue;               // 법정동 없으면 판단 근거 부족 → 제외
        const bldg = buildingFromAddr(addr, legalDong);
        if (!groups.has(gkey)) groups.set(gkey, { city: cityRef.id, std, records: [], variants: new Map() });
        const g = groups.get(gkey);
        g.records.push({ ref: doc.ref, addr, note: String(r.특이사항 || ''), legalDong, bldg });
        g.variants.set(bldg, (g.variants.get(bldg) || 0) + 1);
      }
    }
  }

  // ── 2단계: 표기 갈린 그룹만 추림 ──
  const split = [...groups.entries()].filter(([, g]) => g.variants.size > 1);
  console.log(`\n[집계] 전체 ${total}건 / 그룹 ${groups.size}개 / 표기 갈린 그룹 ${split.length}개`);
  if (!split.length) { console.log('\n(통일 대상 없음)\n'); process.exit(0); }

  // ── 3단계: 그룹별 DB 정본 건물명 조회 ──
  //   ★조회는 도로명주소로만 가능한데, **같은 도로명주소에 건물이 여러 채**인 경우가 있다
  //     (실측: 부흥로 174 → '태림홈타운'과 '영안아파트'가 각각 다른 건물관리번호).
  //     그래서 응답의 buildingMgtNo가 **그룹의 건물관리번호와 일치할 때만** 그 건물명을 채택한다.
  //     불일치하면 다른 건물의 이름이므로 폐기(보류) — 남의 건물 이름을 덮어쓰는 사고 차단.
  console.log(`\nDB 정본 건물명 조회 중... (${split.length}그룹)`);
  let mgtMismatch = 0;
  const dbNames = await pool(split, 4, async ([gkey, g]) => {
    if (!g.std) return '';
    const data = await matchOne(g.std, g.city);
    const name = norm(data?.buildingName);
    if (!name) return '';
    const groupMgt = gkey.startsWith('mgt:') ? gkey.slice(4) : '';
    const respMgt = norm(data?.buildingMgtNo);
    if (groupMgt && respMgt && groupMgt !== respMgt) { mgtMismatch++; return ''; }  // 다른 건물 → 폐기
    return name;
  });
  if (mgtMismatch) console.log(`  ⚠️ 건물관리번호 불일치로 폐기: ${mgtMismatch}그룹 (같은 도로명 다른 건물)`);

  // ── 4단계: 정답 결정 + 재조립 ──
  const stat = { groups: split.length, unified: 0, held: 0, records: 0, noteMoved: 0, written: 0 };
  const heldReasons = new Map();
  const samples = [];
  const pending = [];
  const aliasPairs = new Map();   // 변이표기 -> 정답(DB 정본 확정분만 학습)

  split.forEach(([gkey, g], i) => {
    const variants = [...g.variants.entries()].map(([name, count]) => ({ name, count }));
    const legalDong = g.records[0]?.legalDong || '';
    const picked = pickCanonicalBuilding({ variants, dbName: dbNames[i], legalDong });
    if (!picked) {
      stat.held++;
      const label = dbNames[i] ? 'DB정본 있으나 판정불가' : '깨끗한 후보 없음·동률·근소차 → 보류';
      heldReasons.set(label, (heldReasons.get(label) || 0) + 1);
      return;
    }
    // 안전 기본값: DB 정본이 아닌 '최다 표기' 추정은 --allow-majority 없이는 반영하지 않는다.
    if (picked.source === 'majority' && !ALLOW_MAJORITY) {
      stat.held++;
      heldReasons.set('최다표기 추정 → 보류(--allow-majority 필요)', (heldReasons.get('최다표기 추정 → 보류(--allow-majority 필요)') || 0) + 1);
      return;
    }
    stat.unified++;
    const changes = [];
    for (const rec of g.records) {
      const out = rebuildParen(rec.addr, rec.legalDong, picked.canonical);
      if (!out.changed) continue;
      let newNote = rec.note;
      for (const m of out.moved) {
        if (m.length < 2) continue;
        if (cmpKey(newNote).includes(cmpKey(m))) continue;
        newNote = newNote ? `${newNote} ${m}` : m;
      }
      changes.push({ ref: rec.ref, oldAddr: rec.addr, newAddr: out.newAddr, oldNote: rec.note, newNote });
      if (picked.source === 'db' && rec.bldg && cmpKey(rec.bldg) !== cmpKey(picked.canonical)) {
        aliasPairs.set(rec.bldg, picked.canonical);
      }
    }
    if (!changes.length) return;
    stat.records += changes.length;
    stat.noteMoved += changes.filter(c => c.newNote !== c.oldNote).length;
    pending.push(...changes);
    if (samples.length < SAMPLE_LIMIT) {
      samples.push({ gkey, city: g.city, canonical: picked.canonical, source: picked.source, variants, changes: changes.slice(0, 3) });
    }
  });

  console.log(`\n[결과] 통일 그룹 ${stat.unified}개 / 보류 ${stat.held}개 / 수정 레코드 ${stat.records}건 / 특이사항 이관 ${stat.noteMoved}건 / 학습 별칭 ${aliasPairs.size}개`);
  if (heldReasons.size) {
    console.log(`\n[보류(원본 보존)]`);
    for (const [k, v] of heldReasons) console.log(`  ${k}: ${v}그룹`);
  }

  console.log(`\n[통일 표본 ${samples.length}그룹]`);
  for (const s of samples) {
    console.log(`\n  · ${s.city}  정답="${s.canonical}" (${s.source === 'db' ? 'DB 정본' : '최다 표기'})`);
    console.log(`    표기: ${s.variants.map(v => `"${v.name}"×${v.count}`).join(' | ')}`);
    for (const c of s.changes) {
      console.log(`      이전: ${c.oldAddr}`);
      console.log(`      이후: ${c.newAddr}`);
      if (c.newNote !== c.oldNote) console.log(`      특이사항: "${c.oldNote}" → "${c.newNote}"`);
    }
  }

  if (aliasPairs.size) {
    console.log(`\n[학습 별칭 후보 ${aliasPairs.size}개]${LEARN ? '' : ' (--learn 없으면 저장 안 함)'}`);
    for (const [wrong, correct] of [...aliasPairs.entries()].slice(0, 20)) console.log(`  "${wrong}" → "${correct}"`);
  }

  if (!WRITE) {
    console.log(`\n※ DRY-RUN 입니다. 위 결과를 확인한 뒤 --write 로 반영하세요.\n`);
    process.exit(0);
  }

  console.log(`\n반영 시작 — ${pending.length}건...`);
  let batch = db.batch();
  let n = 0;
  for (const p of pending) {
    const patch = { 주소: p.newAddr, addressMatchSource: 'building-name-unify' };
    if (p.newNote !== p.oldNote) patch.특이사항 = p.newNote;
    batch.update(p.ref, patch);
    n++; stat.written++;
    if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; console.log(`  ${stat.written}건 반영...`); }
  }
  if (n > 0) await batch.commit();
  console.log(`  주소 ${stat.written}건 반영 완료`);

  if (LEARN && aliasPairs.size) {
    let ab = db.batch();
    let an = 0, aw = 0;
    for (const [wrong, correct] of aliasPairs) {
      if (!wrong || !correct || wrong === correct) continue;
      const id = encodeURIComponent(wrong).replace(/%/g, '_').slice(0, 400);
      ab.set(db.collection('building_alias').doc(id), {
        wrong, correction: correct,
        source: 'building-name-unify',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      an++; aw++;
      if (an >= 400) { await ab.commit(); ab = db.batch(); an = 0; }
    }
    if (an > 0) await ab.commit();
    console.log(`  building_alias ${aw}개 학습 완료`);
  }

  console.log(`\n✅ 완료\n`);
  process.exit(0);
};

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
