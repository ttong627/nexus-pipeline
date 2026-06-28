// 배송순번 baseline(roadAwareTSP) vs improved(improvedSequence) 비교 시뮬
// 동일 데이터(답십리1동 388건) · 동일 측정 기준으로 공정 비교.
// 사용: node scripts/sim-compare.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  roadAwareTSP,
  improvedSequence,
  measureSequence,
  buildSequenceUnits,
  getSequenceUnitMeta,
  analyzeSequenceQuality,
} from '../src/engine/routeSequenceEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INPUT = resolve(ROOT, '.sim-data/route-extract.json');
const OUTPUT = resolve(ROOT, '.sim-data/compare-result.json');
const TARGET_DONG = '답십리1동';

// ── 데이터 로드 + 필터 + 엔진 입력 매핑 (sim-sequence.mjs와 동일) ───────────
const raw = JSON.parse(readFileSync(INPUT, 'utf8'));
const filtered = raw.filter((r) => String(r.행정동 || '').trim() === TARGET_DONG);
const records = filtered.map((r, idx) => ({
  ...r,
  id: r.docId || `sim-${idx}`,
  _lat: Number(r.lat),
  _lng: Number(r.lng),
  _isApt: r.isApt,
}));

// ── analyzeSequenceQuality 래퍼(단일 기사 sim) ──────────────────────────────
const analyze = (ordered) => {
  const analyzed = ordered.map((r, i) => ({ ...r, _driverId: 'sim', 배송순번: String(i + 1) }));
  const q = analyzeSequenceQuality(analyzed, [{ id: 'sim', name: '시뮬', color: '#3b82f6' }]);
  return q.driverStats[0] || {};
};

// ── 묶음 보존 검증 ──────────────────────────────────────────────────────────
// buildSequenceUnits가 만든 각 배송단위(같은 아파트단지/동일좌표/동일주소)의
// 레코드들이 최종 순번상 "연속(contiguous)"인지 검사한다.
// 흩어진 단위(non-contiguous) 수를 반환 — 0이어야 묶음 보존.
const checkBundlePreservation = (ordered, sourcePoints) => {
  const units = buildSequenceUnits(sourcePoints);
  // 멤버 ≥2 인 단위만 "묶음"으로 본다(단건 단위는 흩어질 수 없음).
  const bundles = units.filter((u) => u.records.length >= 2);
  const posOf = new Map();
  ordered.forEach((r, i) => posOf.set(r.id, i));
  let scattered = 0;
  const scatteredDetail = [];
  bundles.forEach((u) => {
    const positions = u.records
      .map((r) => posOf.get(r.id))
      .filter((p) => p !== undefined)
      .sort((a, b) => a - b);
    if (positions.length < 2) return;
    const span = positions[positions.length - 1] - positions[0];
    const isContiguous = span === positions.length - 1;
    if (!isContiguous) {
      scattered++;
      if (scatteredDetail.length < 10) {
        scatteredDetail.push({
          unitKey: u.key,
          label: u.label,
          memberCount: u.records.length,
          positions,
          span,
        });
      }
    }
  });
  return { totalBundles: bundles.length, scattered, scatteredDetail };
};

// ── 실행 ────────────────────────────────────────────────────────────────────
console.log('═'.repeat(64));
console.log(`배송순번 비교 시뮬 — ${TARGET_DONG} (${records.length}건)`);
console.log('═'.repeat(64));

const baseOrder = roadAwareTSP(records, null);
const impOrder = improvedSequence(records, null);

const baseM = measureSequence(baseOrder);
const impM = measureSequence(impOrder);
const baseQ = analyze(baseOrder);
const impQ = analyze(impOrder);

const baseBundle = checkBundlePreservation(baseOrder, records);
const impBundle = checkBundlePreservation(impOrder, records);

const pct = (from, to) => (from === 0 ? 0 : Math.round(((from - to) / from) * 1000) / 10);

// ── 비교표 출력 ─────────────────────────────────────────────────────────────
const row = (label, b, i, unit = '') => {
  const bs = String(b).padStart(10);
  const is = String(i).padStart(10);
  console.log(`  ${label.padEnd(22)} ${bs}${unit}  →${is}${unit}`);
};
console.log('\n' + '─'.repeat(64));
console.log('  지표                     baseline        improved');
console.log('─'.repeat(64));
row('총거리(haversine)', baseM.총이동거리_km, impM.총이동거리_km, ' km');
row('역주행 횟수', baseM.역주행건너뛰기_횟수, impM.역주행건너뛰기_횟수, ' 회');
row('300m+ 점프(jumpCount)', baseQ.jumpCount, impQ.jumpCount, ' 회');
row('도로재방문(revisitRoad)', baseQ.revisitRoadCount, impQ.revisitRoadCount, ' 회');
row('최장구간', baseM.최장구간_m, impM.최장구간_m, ' m');
row('avgDist(평균이동)', baseQ.avgDist, impQ.avgDist, ' m');
row('accuracy(예상정확도)', baseQ.accuracy, impQ.accuracy, ' %');
console.log('─'.repeat(64));
console.log(`  총거리 감소: ${pct(baseM.총이동거리_km, impM.총이동거리_km)}%   역주행 감소: ${baseM.역주행건너뛰기_횟수}회 → ${impM.역주행건너뛰기_횟수}회`);

console.log('\n[묶음(아파트단지/동일좌표/동일주소) 보존 검증]');
console.log(`  baseline : 전체 묶음 ${baseBundle.totalBundles}개 중 흩어짐 ${baseBundle.scattered}개`);
console.log(`  improved : 전체 묶음 ${impBundle.totalBundles}개 중 흩어짐 ${impBundle.scattered}개  ${impBundle.scattered === 0 ? '✅ 0건(보존)' : '⚠ 흩어짐 존재'}`);
if (impBundle.scattered > 0) {
  console.log('  [improved 흩어진 묶음 상세]');
  impBundle.scatteredDetail.forEach((d) =>
    console.log(`    - ${d.label} (${d.memberCount}건) positions=${JSON.stringify(d.positions)}`)
  );
}

// ── 저장 ────────────────────────────────────────────────────────────────────
const out = {
  target: TARGET_DONG,
  generatedAt: new Date().toISOString(),
  recordCount: records.length,
  baseline: {
    algorithm: 'roadAwareTSP',
    ...baseM,
    jumpCount: baseQ.jumpCount,
    revisitRoadCount: baseQ.revisitRoadCount,
    avgDist: baseQ.avgDist,
    maxDist: baseQ.maxDist,
    accuracy: baseQ.accuracy,
    estimatedMinutes: baseQ.estimatedMinutes,
    bundle: baseBundle,
  },
  improved: {
    algorithm: 'improvedSequence (NN + 2-opt + Or-opt, carDistance)',
    ...impM,
    jumpCount: impQ.jumpCount,
    revisitRoadCount: impQ.revisitRoadCount,
    avgDist: impQ.avgDist,
    maxDist: impQ.maxDist,
    accuracy: impQ.accuracy,
    estimatedMinutes: impQ.estimatedMinutes,
    bundle: impBundle,
  },
  delta: {
    총거리감소_pct: pct(baseM.총이동거리_km, impM.총이동거리_km),
    역주행_baseline: baseM.역주행건너뛰기_횟수,
    역주행_improved: impM.역주행건너뛰기_횟수,
    점프_baseline: baseQ.jumpCount,
    점프_improved: impQ.jumpCount,
  },
};
writeFileSync(OUTPUT, JSON.stringify(out, null, 2), 'utf8');
console.log(`\n상세 결과 저장: ${OUTPUT}`);
console.log('═'.repeat(64));
