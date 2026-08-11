// ══════════════════════════════════════════════════════════════════
//  parseAptDong 2차 패턴(대시 동호) 전 명단 실측 — 읽기 전용
//
//  묻는 것 하나: **`호` 를 필수로 만들면 무엇이 깨지는가.**
//
//    현행  /(?:^|[\s,(])(\d{3,4})\s*[-]\s*\d{1,4}\s*호?/   ← `호` optional
//    후보  /(?:^|[\s,(])(\d{3,4})\s*[-]\s*\d{1,4}\s*호/    ← `호` 필수
//
//  `호` 가 optional 이라 도로명 부번(`동서로 895-24`)이 동 번호(895동)로 읽힌다.
//  필수화하면 그 오탐은 사라지지만, **`호` 없는 정상 동호 표기**(`101-203`)가
//  실제로 쓰이고 있다면 그건 퇴행이다 → 전 명단에서 센다.
//
//  ★Firestore 는 **읽기만** 한다. 어떤 컬렉션에도 쓰지 않는다.
//  ★PII 출력 금지 — 이름·전화·생년은 찍지 않는다. 주소 문자열과 분류 결과만.
//
//  사용:
//    node scripts/measure-dong-parse.mjs --list          # 명단 목록만
//    node scripts/measure-dong-parse.mjs                 # cloud_lists 전체 실측
//    node scripts/measure-dong-parse.mjs --source all    # + base_lists 까지
//    node scripts/measure-dong-parse.mjs --samples 20    # 분류별 샘플 수(기본 10)
//
//  ※ 자격증명(`serviceAccountKey.json`)은 **cwd** 에서 읽는다. 워크트리에서 돌릴 때는
//    저장소 루트를 cwd 로 두고 스크립트를 절대경로로 호출하면 된다.
// ══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import admin from 'firebase-admin';
import { parseAptDong } from '../services/address-service/src/routing/routeSequenceEngine.js';

const ARGS = process.argv.slice(2);
const flag = (n) => ARGS.includes(`--${n}`);
const opt = (n, d = '') => { const i = ARGS.indexOf(`--${n}`); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : d; };

const LIST = flag('list');
const SOURCE = opt('source', 'cloud');          // cloud | base | all
const SAMPLES = Math.max(1, Number(opt('samples', '10')));

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();

const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const out = (l, v) => console.log(`${String(l).padEnd(46)} ${v}`);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(2)}%` : '-');

// ── 현행/후보 파서 ───────────────────────────────────────────────
// 1차(`101동`)는 두 파서가 같다. 차이는 2차(대시 동호)의 `호` 뿐이다.
const RE_DONG = /(?:^|[\s,(])(\d{1,4})\s*동(?:[\s,)]|$)/;
const RE_DASH_LOOSE = /(?:^|[\s,(])(\d{3,4})\s*[-]\s*\d{1,4}\s*호?/;   // 현행
const RE_DASH_STRICT = /(?:^|[\s,(])(\d{3,4})\s*[-]\s*\d{1,4}\s*호/;   // 후보

const parseWith = (text, reDash) => {
  const m = text.match(RE_DONG) || text.match(reDash);
  return m ? parseInt(m[1], 10) : null;
};

// ── 대시 매치 분류 ───────────────────────────────────────────────
// 매치 바로 앞이 도로명 토큰(…로/…길/…대로)이면 그 숫자쌍은 **건물번호 본번-부번**이다.
const RE_ROAD_BEFORE = /(?:[가-힣A-Za-z0-9]+(?:대로|로|길))\s*$/;
// 괄호 안(법정동·건물명 슬롯)에서 매치됐는지
const inParen = (text, idx) => {
  let depth = 0;
  for (let i = 0; i < idx; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
  }
  return depth > 0;
};

// 전화번호 구간에 걸린 매치인가 — `010-3947-7678` 의 `010-3947` 이 동 10 으로 읽힌다.
const RE_PHONE = /\d{2,4}-\d{3,4}-\d{4}/g;
const inPhone = (text, at) => {
  RE_PHONE.lastIndex = 0;
  let p;
  while ((p = RE_PHONE.exec(text)) !== null) {
    if (at >= p.index && at < p.index + p[0].length) return true;
  }
  return false;
};

const classifyDash = (text) => {
  const m = text.match(RE_DASH_LOOSE);
  if (!m) return null;
  const at = m.index + (m[0].length - m[0].replace(/^[\s,(]/, '').length); // 선행 구분자 제외 시작
  const prefix = text.slice(0, at);
  const hasHo = /호\s*$/.test(m[0]);
  let kind;
  if (hasHo) kind = 'with_ho';
  else if (inPhone(text, at)) kind = 'phone';                                        // 010-3947-7678
  else if (RE_ROAD_BEFORE.test(prefix.replace(/\s*$/, ' '))) kind = 'road_number';   // 동서로 895-24
  else if (inParen(text, at)) kind = 'in_paren';                                     // (…동 1604-1 공동주택)
  else kind = 'bare_dash';                                                           // ⚠️정상 동호 후보
  return { kind, matched: m[0].trim(), at, context: text.slice(Math.max(0, at - 24), at + 24) };
};

// ── 집계 ────────────────────────────────────────────────────────
const stat = {
  records: 0, withText: 0,
  byDongToken: 0,         // 1차 패턴(`101동`)으로 확정 — 두 파서 동일
  byDash: 0,              // 2차 패턴으로 확정(현행)
  none: 0,
  diff: 0,                // 현행 ≠ 후보
};
const KINDS = ['with_ho', 'phone', 'road_number', 'in_paren', 'bare_dash'];
const dashKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
const diffKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
const samples = Object.fromEntries(KINDS.map((k) => [k, []]));
/** `호` 필수화 후에도 동이 읽히는 diff — 앞쪽 오탐이 사라져 **뒤의 진짜 동호**가 잡힌 건. */
const rescued = [];
/** ⚠️퇴행 후보(bare_dash)는 세지 말고 **전건을 그대로 뽑는다** — 사람이 눈으로 본다. */
const bareAll = [];
/** 후보 적용 후에도 남는 오탐 여지(참고용 — 이번 수정 범위 밖). */
const residual = { road: 0, shortHo: 0, sample: [] };
const perList = [];

const scanText = (text, tag) => {
  stat.records += 1;
  if (!text) return;
  stat.withText += 1;
  const cur = parseWith(text, RE_DASH_LOOSE);
  const fix = parseWith(text, RE_DASH_STRICT);
  const byToken = RE_DONG.test(text);
  if (cur == null) stat.none += 1;
  else if (byToken) stat.byDongToken += 1;
  else stat.byDash += 1;

  if (!byToken && cur != null) {
    const c = classifyDash(text);
    if (c) dashKind[c.kind] += 1;
  }
  // 후보 적용 **후에도** 남는 오탐 여지 — `호` 가 붙은 지번(`354-12호`)까지 동으로 읽지는 않는가.
  if (fix != null && !byToken) {
    const m = text.match(RE_DASH_STRICT);
    const at = m.index + (m[0].length - m[0].replace(/^[\s,(]/, '').length);
    if (RE_ROAD_BEFORE.test(text.slice(0, at).replace(/\s*$/, ' '))) {
      residual.road += 1;
      if (residual.sample.length < 10) residual.sample.push(`[도로명 뒤] ${text.slice(0, 110)} → ${fix}`);
    }
    const hoDigits = m[0].match(/-\s*(\d{1,4})\s*호/)?.[1]?.length || 0;
    if (hoDigits && hoDigits < 3) {
      residual.shortHo += 1;
      if (residual.sample.length < 10) residual.sample.push(`[호 ${hoDigits}자리] ${text.slice(0, 110)} → ${fix}`);
    }
  }
  if (cur !== fix) {
    stat.diff += 1;
    const c = classifyDash(text);
    const k = c?.kind || 'bare_dash';
    diffKind[k] += 1;
    const line = `[${tag}] ${text.slice(0, 120)}   → 현행 ${cur} / 후보 ${fix ?? 'null'}`;
    if (samples[k].length < SAMPLES) samples[k].push(line);
    if (fix != null) rescued.push(line);
    if (k === 'bare_dash') bareAll.push(line);
  }
};

// ── 명단 순회 ───────────────────────────────────────────────────
const cityDocs = await db.collection('cloud_lists').listDocuments();
const lists = [];
for (const c of cityDocs) {
  for (const m of await c.collection('months').listDocuments()) lists.push({ city: c.id, month: m.id, ref: m.collection('records') });
}
lists.sort((a, b) => (a.city === b.city ? a.month.localeCompare(b.month) : a.city.localeCompare(b.city)));

if (LIST) {
  for (const l of lists) console.log(`${l.city}\t${l.month}\t${num((await l.ref.count().get()).data().count)}`);
  console.log(`\n총 ${lists.length}개 명단`);
  process.exit(0);
}

const started = Date.now();
if (SOURCE === 'cloud' || SOURCE === 'all') {
  for (const l of lists) {
    const before = { ...stat };
    const snap = await l.ref.get();
    snap.forEach((d) => {
      const r = d.data();
      // ★화면(RouteMapModal·routeSequenceEngine)이 넘기는 것과 **같은** 문자열을 만든다.
      scanText([r._detailAddress, r.detailAddress, r.주소, r.특이사항].filter(Boolean).join(' '), `${l.city} ${l.month}`);
    });
    perList.push({ name: `${l.city} ${l.month}`, n: stat.records - before.records, diff: stat.diff - before.diff });
    console.log(`  · ${l.city} ${l.month} — ${num(stat.records - before.records)}건 (누적 차이 ${num(stat.diff)}) ${((Date.now() - started) / 1000).toFixed(0)}초`);
  }
}
if (SOURCE === 'base' || SOURCE === 'all') {
  for (const c of await db.collection('base_lists').listDocuments()) {
    const before = { ...stat };
    const snap = await c.collection('records').get();
    snap.forEach((d) => {
      const r = d.data();
      scanText([r.detailAddr, r.address, r.주소, r.note, r.특이사항].filter(Boolean).join(' '), `base ${c.id}`);
    });
    perList.push({ name: `base_lists/${c.id}`, n: stat.records - before.records, diff: stat.diff - before.diff });
    console.log(`  · base ${c.id} — ${num(stat.records - before.records)}건 (누적 차이 ${num(stat.diff)}) ${((Date.now() - started) / 1000).toFixed(0)}초`);
  }
}

// ── 결과 ────────────────────────────────────────────────────────
console.log(`\n══ parseAptDong 대시 패턴 실측 (${((Date.now() - started) / 1000).toFixed(1)}초) ══`);
out('스캔 레코드', num(stat.records));
out('주소 텍스트 있는 건', num(stat.withText));
out('동이 읽힌 건 — 1차 `NNN동` (변경 무관)', `${num(stat.byDongToken)} (${pct(stat.byDongToken, stat.withText)})`);
out('동이 읽힌 건 — 2차 대시 패턴', `${num(stat.byDash)} (${pct(stat.byDash, stat.withText)})`);
out('동 없음', num(stat.none));
console.log('');
out('  2차 내역 · `호` 있음 (후보도 그대로 읽음)', num(dashKind.with_ho));
out('  2차 내역 · `호` 없음 — 전화번호 (오탐)', num(dashKind.phone));
out('  2차 내역 · `호` 없음 — 도로명 부번 (오탐)', num(dashKind.road_number));
out('  2차 내역 · `호` 없음 — 괄호 안 지번 (오탐)', num(dashKind.in_paren));
out('  2차 내역 · `호` 없음 — 그 외 (⚠️판정 대상)', num(dashKind.bare_dash));
console.log('');
out('★현행 ≠ 후보 (호 필수화로 달라지는 건)', `${num(stat.diff)} (${pct(stat.diff, stat.withText)})`);
out('  ├ 전화번호 = 오탐 제거 (이득)', num(diffKind.phone));
out('  ├ 도로명 부번 = 오탐 제거 (이득)', num(diffKind.road_number));
out('  ├ 괄호 안 지번 = 오탐 제거 (이득)', num(diffKind.in_paren));
out('  ├ 그 외 — ⚠️정상 동호였다면 퇴행', num(diffKind.bare_dash));
out('  └ with_ho', num(diffKind.with_ho));
out('★그중 후보가 **다른 동을 찾아낸** 건(구제)', num(rescued.length));

for (const k of KINDS) {
  if (!samples[k].length) continue;
  console.log(`\n  [${k}] 샘플 ${samples[k].length}건:`);
  for (const s of samples[k]) console.log(`    ${s}`);
}
if (rescued.length) {
  console.log(`\n  [구제 — 후보가 진짜 동호를 찾음] ${rescued.length}건:`);
  for (const s of rescued.slice(0, 30)) console.log(`    ${s}`);
}
if (bareAll.length) {
  console.log(`\n  ══ ⚠️퇴행 후보 전건 (bare_dash ${bareAll.length}건) — 눈으로 판정 ══`);
  for (const s of bareAll) console.log(`    ${s}`);
}

console.log('');
out('(참고) 후보 적용 후 잔여 여지 · 도로명 뒤 매치', num(residual.road));
out('(참고) 후보 적용 후 잔여 여지 · 호 1~2자리', num(residual.shortHo));
for (const s of residual.sample) console.log(`    ${s}`);

const dirty = perList.filter((p) => p.diff > 0);
if (dirty.length) {
  console.log('\n  차이가 난 명단:');
  for (const p of dirty) console.log(`    ${p.name.padEnd(28)} ${num(p.n).padStart(8)}건 중 ${num(p.diff)}건`);
}
console.log('\n  ※ 읽기 전용 — Firestore 에 아무것도 쓰지 않았습니다.');
process.exit(0);
