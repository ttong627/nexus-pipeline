// ══════════════════════════════════════════════════════════════════
//  C-5 명단 좌표 커버리지 실측·채움 — 설계서 좌표관리_설계.md §5-3
//
//  하는 일:
//    ① 저장된 명단(cloud_lists/{city}/months/{month}/records)을 읽고
//    ② 주소에서 동 번호를 뽑아(화면과 **같은** parseAptDong)
//    ③ 좌표 저장소에 물어(cache) 또는 채우고(fill)
//    ④ **미보유를 사유별로** 센다 — 좌표 문제와 주소 문제는 해법이 다르다(A-36)
//
//  ★명단(Firestore)은 읽기만 한다. 쓰기는 좌표 저장소(building_coord·
//    building_dong_coord)에만 일어난다. 대상자 레코드의 lat/lng·주소는 건드리지 않는다.
//  ★기본 dry-run(mode:'cache') — 외부 API 를 태우지 않는다. 채움은 --apply.
//
//  사용:
//    node scripts/fill-list-coords.mjs --list                       # 명단 목록
//    node scripts/fill-list-coords.mjs --city 시흥시 --month 2026-08 --sample
//    node scripts/fill-list-coords.mjs --city 시흥시 --month 2026-08           # 실측(조회만)
//    node scripts/fill-list-coords.mjs --city 시흥시 --month 2026-08 --apply   # 채움
// ══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import admin from 'firebase-admin';
import { parseAptDong } from '../services/address-service/src/routing/routeSequenceEngine.js';

const ARGS = process.argv.slice(2);
const flag = (n) => ARGS.includes(`--${n}`);
const opt = (n, d = '') => { const i = ARGS.indexOf(`--${n}`); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : d; };

const LIST = flag('list');
const SAMPLE = flag('sample');
const APPLY = flag('apply');
const CITY = opt('city');
const MONTH = opt('month');
/**
 * 한 번에 보낼 건수. 서버 상한은 200 이지만 **기본은 50** 이다.
 *
 * ★채움은 건당 VWorld 를 1~2회 부르고 VWorld 는 초당 2건이 상한이다. 200건을 한 요청에
 *   담으면 최악 400콜 = 200초가 한 HTTP 요청 안에서 흐르고, Cloud Run 요청 상한(300초)에
 *   걸려 **504 로 통째로 버려진다** — 이미 쓴 쿼터까지 함께(2026-08-01 실측: 없는 주소
 *   60건·동시성3 → 504). 50건이면 최악 100콜 = 50초라 여유가 크다.
 *   조회(cache)만 할 때는 외부 호출이 없어 더 키워도 되지만, 값을 하나로 두는 편이 안전하다.
 */
const CHUNK = Math.max(1, Math.min(200, Number(opt('chunk', '50'))));

const API = (() => {
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('VITE_ADDRESS_MATCH_API_URL='));
  return line ? line.slice('VITE_ADDRESS_MATCH_API_URL='.length).trim().replace(/\/+$/, '') : '';
})();
if (!API) { console.error('❌ VITE_ADDRESS_MATCH_API_URL 없음(.env)'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();

const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const out = (l, v) => console.log(`${String(l).padEnd(40)} ${v}`);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');

// ── 명단 목록 ────────────────────────────────────────────────────
if (LIST) {
  const rows = [];
  for (const c of await db.collection('cloud_lists').listDocuments()) {
    for (const m of await c.collection('months').listDocuments()) {
      rows.push({ city: c.id, month: m.id, n: (await m.collection('records').count().get()).data().count });
    }
  }
  rows.sort((a, b) => (a.city === b.city ? b.month.localeCompare(a.month) : a.city.localeCompare(b.city)));
  for (const r of rows) console.log(`${r.city}\t${r.month}\t${num(r.n)}`);
  console.log(`\n총 ${rows.length}개 명단 · ${num(rows.reduce((s, r) => s + r.n, 0))}건`);
  process.exit(0);
}

if (!CITY || !MONTH) {
  console.error('❌ --city 와 --month 가 필요합니다. 목록은 --list');
  process.exit(1);
}

// ── 명단 읽기 ────────────────────────────────────────────────────
const snap = await db.collection('cloud_lists').doc(CITY).collection('months').doc(MONTH).collection('records').get();
const records = [];
snap.forEach((d) => records.push({ id: d.id, ...d.data() }));

if (SAMPLE) {
  console.log(`${CITY} ${MONTH} — ${num(records.length)}건. 첫 3건의 필드:`);
  for (const r of records.slice(0, 3)) {
    // ★PII 출력 금지 — 이름·전화는 찍지 않는다. 주소 계열 키와 파싱 결과만 본다.
    const keys = Object.keys(r).filter((k) => !/이름|본명|휴대폰|전화|생년|주민/.test(k));
    console.log(`  keys: ${keys.join(', ')}`);
    console.log(`  주소: ${r.주소 || '(없음)'}`);
    console.log(`  파싱 동: ${parseAptDong([r._detailAddress, r.detailAddress, r.주소, r.특이사항].filter(Boolean).join(' ')) ?? '(없음)'}`);
    console.log('');
  }
  process.exit(0);
}

// ── 좌표 요청 레코드 만들기 ──────────────────────────────────────
// ★동 번호는 화면(RouteMapModal·routeSequenceEngine)과 **같은 파서**로 뽑는다.
//   다른 규칙으로 뽑으면 여기서 채운 동 좌표를 화면이 못 찾는다 — 에러 없이.
// ★roadAddress 는 표시용 `주소`가 아니라 정제가 확정한 `standardRoadAddress` 를 쓴다.
//   표시용에는 상세주소·괄호(`, A동 324호 (배곧동, …)`)가 붙어 있어 앵커 파싱이 흔들린다.
//   정본이 비어 있을 때만 표시용으로 떨어진다.
const targets = records
  .map((r) => {
    const detail = [r._detailAddress, r.detailAddress, r.주소, r.특이사항].filter(Boolean).join(' ');
    const dong = parseAptDong(detail);
    const road = String(r.standardRoadAddress || r.주소 || '').trim();
    return {
      _id: r.id,
      roadAddress: road,
      sigungu: String(r.matchedSigungu || CITY).trim(),
      legalEmd: String(r.legalDong || r.법정동 || '').trim(),
      // 단지명이 없으면 acceptDongCandidate 가 모호한 동을 전부 기각한다 — 정본 우선.
      buildingName: String(r.buildingName || r.건물명 || '').trim(),
      dongNo: dong == null ? '' : String(dong),
      // 정제가 판정한 isApt 를 우선한다. 동 번호가 읽혔다는 것 자체도 단지형 신호다(R4).
      isApartment: r.isApt === true || dong != null,
    };
  })
  .filter((t) => t.roadAddress);

/**
 * 같은 (주소, 동) 은 한 번만 묻는다.
 *
 * ★명단은 한 아파트에 수십 가구가 산다 — 시흥 2026-07 은 9,557건에 고유 주소 3,143개다.
 *   레코드마다 보내면 **같은 좌표를 세 번씩 사면서** 쿼터와 시간을 3배로 쓴다. 캐시는
 *   요청 **시작 시점**의 DB 상태라 같은 청크 안의 중복은 캐시로도 안 걸러진다.
 */
const uniqKey = (t) => `${t.roadAddress}|${t.dongNo}`;
const uniqueTargets = [];
const seenKey = new Map();
for (const t of targets) {
  const k = uniqKey(t);
  if (seenKey.has(k)) continue;
  seenKey.set(k, uniqueTargets.length);
  uniqueTargets.push(t);
}

console.log(`══ C-5 명단 좌표 ${APPLY ? '채움' : '실측(조회만)'} — ${CITY} ${MONTH} ══`);
out('명단 레코드', num(records.length));
out('주소 있는 건', num(targets.length));
out('동 번호가 읽힌 건(단지형)', `${num(targets.filter((t) => t.dongNo).length)} (${pct(targets.filter((t) => t.dongNo).length, targets.length)})`);
out('고유 주소', num(new Set(targets.map((t) => t.roadAddress)).size));
out('★실제 질의 대상(주소+동 고유)', `${num(uniqueTargets.length)} (중복 ${num(targets.length - uniqueTargets.length)}건 절약)`);

// ── 좌표 저장소 호출 ─────────────────────────────────────────────
const call = async (slice) => {
  const res = await fetch(`${API}/v1/coords/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: APPLY ? 'fill' : 'cache', records: slice.map(({ _id, ...rest }) => rest) }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const coords = Array.isArray(data?.coords) ? data.coords : [];
  // ★길이가 다르면 통째로 버린다. 인덱스가 밀리면 **다른 사람의 좌표**가 붙는다(C-5 규칙).
  if (coords.length !== slice.length) throw new Error(`응답 길이 불일치 ${coords.length} ≠ ${slice.length}`);
  return { coords, summary: data.summary || null };
};

const stat = {
  total: 0, withPoint: 0, missing: 0, noAnchor: 0, outlier: 0, none: 0, unknown: 0,
  wantDong: 0, gotDong: 0,
};
const missSample = [];
const dongMissSample = [];
const started = Date.now();
/** 고유 질의 결과 — 원본 레코드 수로 되펼칠 때 쓴다. */
const byKey = new Map();

for (let i = 0; i < uniqueTargets.length; i += CHUNK) {
  const slice = uniqueTargets.slice(i, i + CHUNK);
  let got;
  try {
    got = await call(slice);
  } catch (error) {
    console.error(`\n⛔ ${i}~${i + slice.length} 실패: ${error.message}`);
    process.exitCode = 2;
    break;
  }
  got.coords.forEach((c, k) => { byKey.set(uniqKey(slice[k]), c); });
  if (APPLY) {
    const s = got.summary || {};
    console.log(`  [${i + slice.length}/${uniqueTargets.length}] 시도 ${s.attempted ?? '?'} · 확보 ${s.filled ?? '?'}`
      + ` · 동 ${s.dongs ?? '?'} · 건너뜀 ${s.skipped ?? '?'} ${JSON.stringify(s.skipReasons || {})}`
      + ` · ${((Date.now() - started) / 1000).toFixed(0)}초`);
  }
}

// ★집계는 **원본 레코드 수** 기준이다. 고유 질의 수로 세면 "명단의 몇 %가 좌표를 갖는가"라는
//   원래 질문에 답하지 못한다 — 한 아파트 30가구가 1건으로 접혀 실제 커버리지가 왜곡된다.
{
  targets.forEach((t) => {
    const c = byKey.get(uniqKey(t));
    stat.total += 1;
    // 내비용 점 = 입구 → 중심 (동 좌표는 목적지가 못 된다, F2)
    const q = c?.quality;
    const hasPoint = Boolean(c && q !== 'outlier' && q !== 'none' && q !== 'no_anchor' && q !== 'unknown'
      && ((c.entrance?.lat != null) || (c.center?.lat != null)));
    if (hasPoint) stat.withPoint += 1;
    else {
      stat.missing += 1;
      if (q === 'no_anchor') stat.noAnchor += 1;
      else if (q === 'outlier') stat.outlier += 1;
      else if (q === 'none') stat.none += 1;
      else stat.unknown += 1;
      if (missSample.length < 8) missSample.push(`${t.roadAddress}  [${q || '?'}]`);
    }
    if (t.dongNo) {
      stat.wantDong += 1;
      if (c?.dong?.lat != null) stat.gotDong += 1;
      else if (dongMissSample.length < 8) dongMissSample.push(`${t.roadAddress}  동 ${t.dongNo}`);
    }
  });
}

// ── 결과 ─────────────────────────────────────────────────────────
console.log(`\n══ 결과 (${((Date.now() - started) / 1000).toFixed(1)}초) ══`);
out('조회한 건', num(stat.total));
out('내비용 좌표 보유', `${num(stat.withPoint)} (${pct(stat.withPoint, stat.total)})`);
out('★미보유', num(stat.missing));
out('  ├ no_anchor (주소를 특정 못함 — 주소 문제)', num(stat.noAnchor));
out('  ├ none (해봤는데 없음)', num(stat.none));
out('  ├ outlier (이상치)', num(stat.outlier));
out('  └ unknown (저장소에 행 없음 — 아직 안 해봄)', num(stat.unknown));
out('동 좌표 필요 / 확보', `${num(stat.wantDong)} / ${num(stat.gotDong)} (${pct(stat.gotDong, stat.wantDong)})`);

if (missSample.length) {
  console.log('\n  미보유 샘플:');
  for (const s of missSample) console.log(`    ${s}`);
}
if (dongMissSample.length) {
  console.log('\n  동 좌표 미보유 샘플:');
  for (const s of dongMissSample) console.log(`    ${s}`);
}
if (!APPLY) console.log('\n  ※ 조회만 했습니다. 채우려면 --apply (외부 API·쿼터 사용)');
process.exit(process.exitCode || 0);
