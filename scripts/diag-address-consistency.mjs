// 주소 표기 일관성 진단 — 읽기 전용(쓰기 없음), PII 미출력.
//   목적(형 지시 2026-07-30): "같은 아파트인데 주소 표기가 제각각" 문제를 숫자로 확정한다.
//   측정 ①매칭 출처 분포(정확매칭/폴백/미매칭) ②DB 정본·식별자 보유율
//        ③같은 건물관리번호(buildingMgtNo) 그룹에서 표시용 주소(도로명+괄호)가 몇 가지로 갈리는가
//        ④같은 DB 정본(standardRoadAddress) 그룹에서의 변이(식별자 없는 경우 보완 측정)
//   ※ 상세주소(동·호수)는 세대별로 당연히 다르므로 변이 비교에서 제외한다.
//   ※ 이름·전화·좌표 등 PII는 읽지도, 출력하지도 않는다. 출력은 집계 + 도로명/건물명뿐.
//
//   사용:
//     node scripts/diag-address-consistency.mjs                 # 전체 명단
//     node scripts/diag-address-consistency.mjs "경기도 수원시"   # 특정 시군구만
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { parseDisplayedAddress } from '../src/utils/addressFormat.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const ONLY_CITY = process.argv[2] || '';
const TOP_N = 15;

const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);

// 표시용 주소의 '세대 무관' 부분 = 도로명 + (법정동, 건물명). 상세(동·호수)는 제외.
const displayShape = (addr) => {
  const { road, paren } = parseDisplayedAddress(addr);
  return `${norm(road)}|${norm(paren)}`;
};

const main = async () => {
  const stat = {
    total: 0, hasAddr: 0,
    hasStdRoad: 0, hasBldgMgtNo: 0, hasAptGroupKey: 0,
  };
  const bySource = new Map();      // addressMatchSource 분포
  const byMgtNo = new Map();       // buildingMgtNo -> Map(displayShape -> count)
  const byStdRoad = new Map();     // standardRoadAddress -> Map(displayShape -> count)
  const listSummary = [];

  const cityDocs = await db.collection('cloud_lists').listDocuments();
  for (const cityRef of cityDocs) {
    const city = cityRef.id;
    if (ONLY_CITY && !city.includes(ONLY_CITY)) continue;
    const monthDocs = await cityRef.collection('months').listDocuments();
    for (const monthRef of monthDocs) {
      const snap = await monthRef.collection('records').get();
      if (snap.empty) continue;
      listSummary.push({ city, month: monthRef.id, count: snap.size });
      for (const doc of snap.docs) {
        const r = doc.data();
        stat.total++;
        const addr = norm(r.주소);
        if (!addr) continue;
        stat.hasAddr++;

        bump(bySource, norm(r.addressMatchSource) || '(빈값=미매칭/구데이터)');

        const std = norm(r.standardRoadAddress);
        const mgt = norm(r.buildingMgtNo);
        const aptKey = norm(r.routeHints?.apartmentGroupKey);
        if (std) stat.hasStdRoad++;
        if (mgt) stat.hasBldgMgtNo++;
        if (aptKey) stat.hasAptGroupKey++;

        const shape = displayShape(addr);
        if (mgt) {
          if (!byMgtNo.has(mgt)) byMgtNo.set(mgt, new Map());
          bump(byMgtNo.get(mgt), shape);
        }
        if (std) {
          if (!byStdRoad.has(std)) byStdRoad.set(std, new Map());
          bump(byStdRoad.get(std), shape);
        }
      }
    }
  }

  // ── 변이 집계 ──
  const summarizeVariance = (groups, label) => {
    let groupCount = 0, splitGroups = 0, affectedRecords = 0;
    const worst = [];
    for (const [gkey, shapes] of groups) {
      groupCount++;
      const total = [...shapes.values()].reduce((a, b) => a + b, 0);
      if (shapes.size > 1) {
        splitGroups++;
        affectedRecords += total;
        worst.push({ gkey, variants: shapes.size, records: total, shapes: [...shapes.entries()] });
      }
    }
    worst.sort((a, b) => b.variants - a.variants || b.records - a.records);
    return { label, groupCount, splitGroups, affectedRecords, worst: worst.slice(0, TOP_N) };
  };

  const vMgt = summarizeVariance(byMgtNo, '건물관리번호(buildingMgtNo)');
  const vStd = summarizeVariance(byStdRoad, 'DB 정본(standardRoadAddress)');

  // ── 출력 ──
  const pct = (n) => stat.hasAddr ? `${(n / stat.hasAddr * 100).toFixed(1)}%` : '-';
  console.log(`\n${'='.repeat(72)}\n주소 표기 일관성 진단 (읽기 전용)${ONLY_CITY ? ` — 필터: ${ONLY_CITY}` : ''}\n${'='.repeat(72)}`);
  console.log(`\n[명단] ${listSummary.length}개`);
  for (const l of listSummary) console.log(`  ${l.city} ${l.month}: ${l.count}건`);

  console.log(`\n[전체] 레코드 ${stat.total}건 (주소 있음 ${stat.hasAddr}건)`);
  console.log(`\n[① 매칭 출처 분포]`);
  [...bySource.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(k).padEnd(34)} ${String(v).padStart(7)}건  ${pct(v)}`));

  console.log(`\n[② DB 정본·식별자 보유율]`);
  console.log(`  standardRoadAddress(정본)          ${String(stat.hasStdRoad).padStart(7)}건  ${pct(stat.hasStdRoad)}`);
  console.log(`  buildingMgtNo(건물관리번호)         ${String(stat.hasBldgMgtNo).padStart(7)}건  ${pct(stat.hasBldgMgtNo)}`);
  console.log(`  routeHints.apartmentGroupKey       ${String(stat.hasAptGroupKey).padStart(7)}건  ${pct(stat.hasAptGroupKey)}`);

  for (const v of [vMgt, vStd]) {
    console.log(`\n[③ 표기 변이 — 기준: ${v.label}]`);
    console.log(`  그룹 수: ${v.groupCount}   표기 갈린 그룹: ${v.splitGroups}   그 그룹의 레코드: ${v.affectedRecords}건`);
    if (!v.worst.length) { console.log('  (변이 없음)'); continue; }
    console.log(`  ── 변이 심한 상위 ${v.worst.length}건 ──`);
    for (const w of v.worst) {
      console.log(`  · ${w.variants}가지 표기 / ${w.records}건`);
      for (const [shape, cnt] of w.shapes.sort((a, b) => b[1] - a[1])) {
        const [road, paren] = shape.split('|');
        console.log(`      ${String(cnt).padStart(5)}건  도로명="${road}"  괄호="${paren}"`);
      }
    }
  }
  console.log('');
  process.exit(0);
};

main().catch(e => { console.error('진단 실패:', e.message); process.exit(1); });
