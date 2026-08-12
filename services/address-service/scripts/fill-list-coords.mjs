#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  C-5 명단 좌표 커버리지 실측·채움 — 설계서 좌표관리_설계.md §5-3-A
//
//  하는 일:
//    ① 저장된 명단(cloud_lists/{city}/months/{month}/records)을 읽고
//    ② 주소에서 동 번호를 뽑아(화면과 **같은** parseAptDong)
//    ③ 좌표 저장소를 채우고
//    ④ **미보유를 사유별로** 센다 — 좌표 문제와 주소 문제는 해법이 다르다(A-36)
//
//  ★명단(Firestore)은 읽기만 한다. 쓰기는 좌표 저장소(building_coord·
//    building_dong_coord)에만 일어난다. 대상자 레코드의 lat/lng·주소는 건드리지 않는다.
//  ★기본 dry-run — 외부 API 도 DB 쓰기도 없다. 채움은 --apply.
//
//  ★왜 서버(services/address-service)에 있나 — C-6 이 메우지 못하는 구멍이 여기다.
//    정기배치 ⑤는 `building_coord` 에 **행이 있는** 건만 다시 태운다. 명단에 새 주소가
//    들어오면 저장소에 행 자체가 없어(`unknown`) 영영 대상이 아니다. 실측(2026-08-11
//    시흥): 미보유 4,971건 중 **4,968건이 그 경우**였다. 명단 → 저장소로 행을 만드는
//    일은 이 스크립트만 한다. 그래서 사람 손이 아니라 Job 이 돌 수 있는 자리에 둔다.
//
//  ★HTTP 가 아니라 in-process 로 채운다.
//    - 운영 서비스(nexus-address-api)에 부하를 주지 않는다.
//    - 쿼터 카운터를 **한 프로세스가 전부 들고** 있으므로 일일 상한이 실효적이다.
//      (HTTP 경로는 서비스 인스턴스마다 따로 세서 상한 구실을 못 한다.)
//
//  사용:
//    node scripts/fill-list-coords.mjs --list
//    node scripts/fill-list-coords.mjs --city "경기도 시흥시" --month 2026-07
//    node scripts/fill-list-coords.mjs --city "경기도 시흥시" --month 2026-07 --apply
//    node scripts/fill-list-coords.mjs --all --apply
//    node scripts/fill-list-coords.mjs --all --miss-limit 0     (미보유 주소 전량 출력)
// ══════════════════════════════════════════════════════════════════
import { config } from '../src/config.js';
import { closePool } from '../src/db.js';
import { availableSources, createQuotaCounter } from '../src/coords/coordFill.js';
import { DAILY_LIMITS, fillCoords } from '../src/coords/coordWrite.js';
import { parseAptDong } from '../src/routing/routeSequenceEngine.js';

const ARGS = process.argv.slice(2);
const flag = (n) => ARGS.includes(`--${n}`);
const opt = (n, d = '') => { const i = ARGS.indexOf(`--${n}`); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : d; };

const LIST = flag('list');
const APPLY = flag('apply');
const ALL = flag('all');
const CITY = opt('city');
const MONTH = opt('month');
/** 한 번에 채울 건수. in-process 라 HTTP 300초 상한은 없지만, 진행 로그 간격으로 쓴다. */
const CHUNK = Math.max(1, Number(opt('chunk', '100')));
/**
 * 미보유 주소를 몇 건까지 찍을 것인가(`--miss-limit`). 기본 5 = 종전과 같다.
 *
 * ★왜 옵션이 필요했나(2026-08-12): 미보유 56건을 고치려고 목록을 뽑는데, 상한이 5로
 *   박혀 있어 **10건짜리 명단은 절반이 안 보였다**. 집계는 맞는데 조치할 목록이 안 나온다
 *   — 숫자는 진행을 보여주지만 **고칠 대상은 주소로만 보인다**.
 * ★기본값을 올리지 않은 이유: 정기 실행 로그가 명단마다 길어지면 요약이 묻힌다.
 *   목록이 필요할 때만 `--miss-limit 0`(전량)으로 부른다.
 */
const MISS_LIMIT = (() => {
  const raw = opt('miss-limit', '');
  if (raw === '') return 5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 5;
  return n === 0 ? Infinity : Math.floor(n);   // 0 = 전량
})();

const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const out = (l, v) => console.log(`${String(l).padEnd(40)} ${v}`);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');

/**
 * Firestore — ADC(Cloud Run 런타임 SA). dictStore.js 와 **같은 순서**를 지킨다.
 *
 * ★자격증명 선(先)검사를 건너뛰지 말 것(2026-08-01 실측): ADC 없이 Firestore 클라이언트를
 *   먼저 만들면 google-gax 가 gRPC stub 을 만드는 도중 잡을 수 없는 unhandledRejection 으로
 *   프로세스가 죽는다. getAccessToken() 은 정상적으로 reject 하는 awaitable 이라 여기서 걸린다.
 */
const getDb = async () => {
  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  let app = getApps()[0];
  if (!app) {
    const credential = applicationDefault();
    await credential.getAccessToken();
    app = initializeApp({ credential, ...(config.firebaseProjectId ? { projectId: config.firebaseProjectId } : {}) });
  }
  return getFirestore(app);
};

/** 명단 목록 — (city, month, 건수). --list 와 --all 이 같은 것을 쓴다. */
const listMonths = async (db) => {
  const rows = [];
  for (const c of await db.collection('cloud_lists').listDocuments()) {
    for (const m of await c.collection('months').listDocuments()) {
      rows.push({ city: c.id, month: m.id, n: (await m.collection('records').count().get()).data().count });
    }
  }
  rows.sort((a, b) => (a.city === b.city ? b.month.localeCompare(a.month) : a.city.localeCompare(b.city)));
  return rows;
};

/** 같은 (주소, 동) 은 한 번만 묻는다 — 아래 uniqueTargets 주석 참조. */
const uniqKey = (t) => `${t.roadAddress}|${t.dongNo}`;

/** 명단 하나 처리. 반환값은 --all 요약표에 쓴다. */
const runOne = async (db, city, month, quota) => {
  const snap = await db.collection('cloud_lists').doc(city).collection('months').doc(month).collection('records').get();
  const records = [];
  snap.forEach((d) => records.push({ id: d.id, ...d.data() }));

  // ★동 번호는 화면(RouteMapModal·routeSequenceEngine)과 **같은 파서**로 뽑는다.
  //   다른 규칙으로 뽑으면 여기서 채운 동 좌표를 화면이 못 찾는다 — 에러 없이.
  // ★roadAddress 는 표시용 `주소`가 아니라 정제가 확정한 `standardRoadAddress` 를 쓴다.
  //   표시용에는 상세주소·괄호(`, A동 324호 (배곧동, …)`)가 붙어 있어 앵커 파싱이 흔들린다.
  const targets = records
    .map((r) => {
      const detail = [r._detailAddress, r.detailAddress, r.주소, r.특이사항].filter(Boolean).join(' ');
      const dong = parseAptDong(detail);
      return {
        roadAddress: String(r.standardRoadAddress || r.주소 || '').trim(),
        sigungu: String(r.matchedSigungu || city).trim(),
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
   * ★명단은 한 아파트에 수십 가구가 산다 — 시흥 2026-07 은 9,557건에 고유 주소 3,143개다.
   *   레코드마다 보내면 **같은 좌표를 세 번씩 사면서** 쿼터와 시간을 3배로 쓴다. 캐시는
   *   요청 **시작 시점**의 DB 상태라 같은 묶음 안의 중복은 캐시로도 안 걸러진다.
   */
  const uniqueTargets = [];
  const seenKey = new Set();
  for (const t of targets) {
    const k = uniqKey(t);
    if (seenKey.has(k)) continue;
    seenKey.add(k);
    uniqueTargets.push(t);
  }

  console.log(`\n══ C-5 명단 좌표 ${APPLY ? '채움' : '실측(조회만)'} — ${city} ${month} ══`);
  out('명단 레코드', num(records.length));
  out('동 번호가 읽힌 건(단지형)', `${num(targets.filter((t) => t.dongNo).length)} (${pct(targets.filter((t) => t.dongNo).length, targets.length)})`);
  out('★실제 질의 대상(주소+동 고유)', `${num(uniqueTargets.length)} (중복 ${num(targets.length - uniqueTargets.length)}건 절약)`);

  const stat = {
    city, month, total: 0, withPoint: 0, missing: 0, noAnchor: 0, outlier: 0, none: 0, unknown: 0,
    wantDong: 0, gotDong: 0, failed: false, stopped: null,
  };
  const missSample = [];
  const started = Date.now();
  const byKey = new Map();

  for (let i = 0; i < uniqueTargets.length; i += CHUNK) {
    const slice = uniqueTargets.slice(i, i + CHUNK);
    let res;
    try {
      // ★조회만 할 때도 같은 함수를 쓴다 — 조회 경로와 채움 경로가 갈리면 "실측은 맞는데
      //   채우면 다른 결과"가 나온다. quota 를 안 넘기면 외부 호출도 없다.
      res = APPLY
        ? await fillCoords(slice, { version: config.activeVersion, quota, retryNone: true })
        : await fillCoords(slice, { version: config.activeVersion, quota: createQuotaCounter({}) });
    } catch (error) {
      console.error(`\n⛔ ${i}~${i + slice.length} 실패: ${error.message}`);
      stat.failed = true;
      process.exitCode = 2;
      break;
    }
    res.coords.forEach((c, k) => { byKey.set(uniqKey(slice[k]), c); });

    if (APPLY) {
      const s = res.summary;
      console.log(`  [${i + slice.length}/${uniqueTargets.length}] 시도 ${s.attempted} · 확보 ${s.filled}`
        + ` · 동 ${s.dongs} · 건너뜀 ${s.skipped} ${JSON.stringify(s.skipReasons)} · ${((Date.now() - started) / 1000).toFixed(0)}초`);
      // ★확보 0 은 조용한 고장의 신호다 — VWorld 일일 한도를 넘기면 모든 조회가 null 이
      //   되면서 배치는 멀쩡히 계속 돈다(쿼터 카운터는 프로세스 것이라 못 잡는다).
      //   시도가 있었는데 하나도 못 얻으면 남은 명단까지 헛돌기 전에 멈춘다.
      if (s.attempted >= 10 && s.filled === 0 && s.dongs === 0) {
        console.error('\n⛔ 시도했는데 확보 0 — VWorld 한도 초과·키 만료·장애를 의심합니다. 중단합니다.');
        console.error('   확인: Cloud Run 로그에서 "[vworld] geocodeRoad 실패" 사유를 볼 것.');
        stat.stopped = 'zero_yield';
        process.exitCode = 3;
        break;
      }
    }
  }

  // ★집계는 **원본 레코드 수** 기준이다. 고유 질의 수로 세면 "명단의 몇 %가 좌표를 갖는가"라는
  //   원래 질문에 답하지 못한다 — 한 아파트 30가구가 1건으로 접혀 실제 커버리지가 왜곡된다.
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
      if (missSample.length < MISS_LIMIT) missSample.push(`${t.roadAddress}  [${q || '?'}]`);
    }
    if (t.dongNo) {
      stat.wantDong += 1;
      if (c?.dong?.lat != null) stat.gotDong += 1;
    }
  });

  stat.elapsedSec = Math.round((Date.now() - started) / 1000);
  console.log(`\n── 결과 (${stat.elapsedSec}초) ──`);
  out('내비용 좌표 보유', `${num(stat.withPoint)} / ${num(stat.total)} (${pct(stat.withPoint, stat.total)})`);
  out('★미보유', `${num(stat.missing)}  (no_anchor ${num(stat.noAnchor)} · none ${num(stat.none)}`
    + ` · outlier ${num(stat.outlier)} · unknown ${num(stat.unknown)})`);
  out('동 좌표 필요 / 확보', `${num(stat.wantDong)} / ${num(stat.gotDong)} (${pct(stat.gotDong, stat.wantDong)})`);
  for (const s of missSample) console.log(`    ${s}`);
  // ★잘렸으면 잘렸다고 말한다 — 조용한 절단은 "전부 봤다"로 읽힌다.
  //   실제로 2026-08-12 에 이 침묵 때문에 미보유 56건 중 10건을 놓칠 뻔했다.
  if (stat.missing > missSample.length) {
    console.log(`    … 나머지 ${num(stat.missing - missSample.length)}건은 표시 상한(--miss-limit ${
      MISS_LIMIT === Infinity ? '전량' : MISS_LIMIT})에 잘림. 전량은 --miss-limit 0`);
  }
  return stat;
};

// ── 실행 ─────────────────────────────────────────────────────────
try {
  const db = await getDb();

  if (LIST) {
    const rows = await listMonths(db);
    for (const r of rows) console.log(`${r.city}\t${r.month}\t${num(r.n)}`);
    console.log(`\n총 ${rows.length}개 명단 · ${num(rows.reduce((s, r) => s + r.n, 0))}건`);
  } else if (!ALL && (!CITY || !MONTH)) {
    console.error('❌ --city 와 --month 가 필요합니다. 전체는 --all, 목록은 --list');
    process.exitCode = 1;
  } else {
    // ★키가 없으면 시작하지 않는다 — 채움률 0% 를 "이 주소들은 좌표가 원래 없다"로
    //   오해하게 된다(설계서 F9, 2026-08-11 실측).
    const sources = availableSources(config);
    if (APPLY && !sources.length) {
      console.error('⛔ VWORLD_KEY·KAKAO_REST_KEY 가 하나도 없습니다. 채움을 시작하지 않습니다.');
      process.exitCode = 2;
    } else {
      // ★쿼터 카운터는 **하나**를 만들어 전 명단이 나눠 쓴다. 명단마다 새로 만들면
      //   일일 상한이 명단 수만큼 곱해져 상한 구실을 못 한다.
      const quota = createQuotaCounter(DAILY_LIMITS);
      const targets = ALL ? await listMonths(db) : [{ city: CITY, month: MONTH }];
      if (ALL) console.log(`전 명단 ${targets.length}개 — ${APPLY ? '채움' : '실측(조회만)'} · 출처 ${sources.join('·') || '(조회만)'}`);

      const results = [];
      const allStarted = Date.now();
      for (const [i, r] of targets.entries()) {
        if (ALL) console.log(`\n${'='.repeat(70)}\n[${i + 1}/${targets.length}] ${r.city} ${r.month}`);
        // ★한 명단이 실패해도 다음으로 넘어간다. 도중에 하나가 죽었다고 나머지를 포기하면
        //   이미 쓴 시간이 통째로 버려진다. 실패는 아래 요약표에 남는다.
        try {
          results.push(await runOne(db, r.city, r.month, quota));
        } catch (error) {
          console.error(`⛔ ${r.city} ${r.month} 처리 실패: ${error.message}`);
          results.push({ city: r.city, month: r.month, failed: true, total: 0, withPoint: 0, missing: 0, wantDong: 0, gotDong: 0 });
        }
        // 확보 0 으로 멈췄으면 남은 명단도 같은 이유로 헛돈다.
        if (results[results.length - 1]?.stopped === 'zero_yield') {
          console.error('⛔ 확보 0 으로 중단 — 남은 명단은 진행하지 않습니다.');
          break;
        }
      }

      if (ALL || results.length > 1) {
        console.log(`\n${'='.repeat(70)}\n══ 전체 요약 (${Math.round((Date.now() - allStarted) / 60000)}분) ══`);
        console.log('명단'.padEnd(30) + '건수'.padStart(9) + '보유'.padStart(9) + '미보유'.padStart(9) + '동좌표'.padStart(14));
        for (const s of results) {
          console.log(`${`${s.city} ${s.month}`.padEnd(30)}${num(s.total).padStart(9)}${pct(s.withPoint, s.total).padStart(9)}`
            + `${num(s.missing).padStart(9)}${`${num(s.gotDong)}/${num(s.wantDong)}`.padStart(14)}${s.failed ? '  ⛔실패' : ''}`);
        }
        const T = results.reduce((a, s) => ({
          total: a.total + s.total, withPoint: a.withPoint + s.withPoint, missing: a.missing + s.missing,
          wantDong: a.wantDong + s.wantDong, gotDong: a.gotDong + s.gotDong,
        }), { total: 0, withPoint: 0, missing: 0, wantDong: 0, gotDong: 0 });
        console.log('-'.repeat(71));
        console.log(`${'합계'.padEnd(30)}${num(T.total).padStart(9)}${pct(T.withPoint, T.total).padStart(9)}`
          + `${num(T.missing).padStart(9)}${`${num(T.gotDong)}/${num(T.wantDong)}`.padStart(14)}`);
      }
      if (APPLY) console.log(`\n쿼터 사용: ${JSON.stringify(quota.summary())}`);
      else console.log('\n  ※ 조회만 했습니다. 채우려면 --apply (외부 API·쿼터 사용)');
    }
  }
} finally {
  await closePool();
}
