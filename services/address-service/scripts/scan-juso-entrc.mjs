/**
 * 행안부 출입구 자료 전수 스캔 (읽기 전용 · 적재 없음).
 *
 * 목적: 적재기를 만들기 전에 **파서가 실제 전량을 읽어내는지** 먼저 증명한다.
 *   픽스처 몇 줄이 통과했다고 700만 행이 통과하는 건 아니다. 여기서 폐기율·무좌표율·
 *   레이아웃 분포를 실측해두면, 나중에 적재 결과가 이상할 때 기준선이 된다.
 *
 * 사용:
 *   node scripts/scan-juso-entrc.mjs "C:/Users/ttong/Downloads/DB_다운로드"
 *   node scripts/scan-juso-entrc.mjs <dir> --sample 5000     # 파일당 앞 N줄만(빠른 확인)
 *
 * 출력: 파일별 + 전체 집계, 그리고 폐기된 줄 표본(원인 파악용).
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { detectLayout, isBuildingGroup, parseEntranceLine } from '../src/entrance/entrcParser.js';
import { looksMojibake, readEntranceLines } from '../src/entrance/entrcReader.js';

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith('--'));
const sampleIdx = argv.indexOf('--sample');
const SAMPLE = sampleIdx >= 0 ? Number(argv[sampleIdx + 1]) : 0;

if (!dir) {
  console.error('사용법: node scripts/scan-juso-entrc.mjs <자료폴더> [--sample N]');
  process.exit(2);
}

/** 출입구 자료로 보이는 파일만 고른다(SHP·ZIP·PDF 제외). */
const isEntranceFile = (name) => {
  const n = name.toLowerCase();
  if (!n.endsWith('.txt')) return false;
  return n.startsWith('entrc_') || n.startsWith('rnentdata') || n.includes('rnadr_position');
};

const fmt = (n) => n.toLocaleString('ko-KR');

const sum = {
  files: 0, total: 0, ok: 0, skipped: 0, noCoord: 0,
  byLayout: {}, byReason: {}, group: 0, withBuildingName: 0, withUse: 0,
};
const skipSamples = [];
const mojibakeSamples = [];
const outOfRange = [];

// EPSG:5179 한국 대략 범위 — 좌표가 엉뚱하면 파싱이 밀린 것이다(조기 경보).
const X_MIN = 700000, X_MAX = 1400000;
const Y_MIN = 1300000, Y_MAX = 2100000;

async function scanFile(fp) {
  const st = { total: 0, ok: 0, skipped: 0, noCoord: 0, byLayout: {}, group: 0, mojibake: 0 };
  // ★cp949 로 디코딩해 읽는다. 바이트만 봐도 구조 검증은 되지만, 그러면 건물명이
  //   깨진 걸 못 잡는다(1차 스캔이 실제로 그랬다).
  for await (const line of readEntranceLines(fp, { limit: SAMPLE })) {
    st.total += 1;
    if (looksMojibake(line)) {
      st.mojibake += 1;
      if (mojibakeSamples.length < 5) {
        mojibakeSamples.push({ file: path.basename(fp), head: line.slice(0, 80) });
      }
    }

    const rec = parseEntranceLine(line);
    if (!rec) {
      st.skipped += 1;
      if (skipSamples.length < 10) {
        skipSamples.push({ file: path.basename(fp), layout: detectLayout(line), head: line.slice(0, 90) });
      }
      continue;
    }
    st.ok += 1;
    st.byLayout[rec.layout] = (st.byLayout[rec.layout] || 0) + 1;
    sum.byLayout[rec.layout] = (sum.byLayout[rec.layout] || 0) + 1;
    if (rec.changeReason) sum.byReason[rec.changeReason] = (sum.byReason[rec.changeReason] || 0) + 1;
    if (rec.x === null || rec.y === null) st.noCoord += 1;
    else if (rec.x < X_MIN || rec.x > X_MAX || rec.y < Y_MIN || rec.y > Y_MAX) {
      if (outOfRange.length < 10) {
        outOfRange.push({ file: path.basename(fp), x: rec.x, y: rec.y, head: line.slice(0, 90) });
      }
    }
    if (isBuildingGroup(rec)) st.group += 1;
    if (rec.buildingName) sum.withBuildingName += 1;
    if (rec.buildingUse) sum.withUse += 1;
  }
  return st;
}

const files = (await readdir(dir)).filter(isEntranceFile).sort();
if (!files.length) {
  console.error(`출입구 TXT 를 찾지 못했습니다: ${dir}`);
  process.exit(1);
}

console.log(`대상 ${files.length}개 파일${SAMPLE ? ` (파일당 앞 ${fmt(SAMPLE)}줄 표본)` : ' (전수)'}\n`);
console.log('파일'.padEnd(46), '행수'.padStart(12), 'OK'.padStart(12), '폐기'.padStart(8), '무좌표'.padStart(9), '건물군'.padStart(9));
console.log('-'.repeat(100));

for (const name of files) {
  const fp = path.join(dir, name);
  const { size } = await stat(fp);
  if (!size) continue;
  const st = await scanFile(fp);
  sum.files += 1;
  sum.total += st.total; sum.ok += st.ok; sum.skipped += st.skipped; sum.noCoord += st.noCoord; sum.group += st.group;
  sum.mojibake = (sum.mojibake || 0) + st.mojibake;
  const layouts = Object.keys(st.byLayout).join(',');
  console.log(
    `${name.slice(0, 44).padEnd(46)}${fmt(st.total).padStart(12)}${fmt(st.ok).padStart(12)}` +
    `${fmt(st.skipped).padStart(8)}${fmt(st.noCoord).padStart(9)}${fmt(st.group).padStart(9)}  ${layouts}`
  );
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(2) : '0.00');
console.log('\n' + '='.repeat(60));
console.log(`파일 ${sum.files}개 · 총 ${fmt(sum.total)}행`);
console.log(`  파싱 성공   ${fmt(sum.ok)} (${pct(sum.ok, sum.total)}%)`);
console.log(`  폐기        ${fmt(sum.skipped)} (${pct(sum.skipped, sum.total)}%)`);
console.log(`  무좌표      ${fmt(sum.noCoord)} (${pct(sum.noCoord, sum.ok)}%)  ← 비공개·공개제한 건물(정상)`);
console.log(`  건물군(=1)  ${fmt(sum.group)}  ← 300002 동 도형 연결 대상`);
console.log(`  건물명 보유 ${fmt(sum.withBuildingName)} · 건물용도 보유 ${fmt(sum.withUse)}`);
console.log(`  레이아웃    ${JSON.stringify(sum.byLayout)}`);
console.log(`  인코딩 깨짐 ${fmt(sum.mojibake || 0)}  ← cp949 디코딩이 맞으면 0 이어야 한다`);
if (Object.keys(sum.byReason).length) console.log(`  이동사유    ${JSON.stringify(sum.byReason)}`);

if (skipSamples.length) {
  console.log('\n[폐기된 줄 표본]');
  for (const s of skipSamples) console.log(`  (${s.layout ?? '판별불가'}) ${s.file}: ${s.head}`);
}
if (mojibakeSamples.length) {
  console.log('\n⚠️ [인코딩 깨짐 표본 — cp949 디코딩 실패]');
  for (const s2 of mojibakeSamples) console.log(`  ${s2.file}: ${s2.head}`);
}
if (outOfRange.length) {
  console.log('\n⚠️ [좌표 범위 이탈 — 파싱이 밀렸을 가능성]');
  for (const s of outOfRange) console.log(`  ${s.file}: x=${s.x} y=${s.y} :: ${s.head}`);
} else {
  console.log('\n좌표 범위 이탈 0건 — 필드 정렬이 전 파일에서 맞다.');
}
