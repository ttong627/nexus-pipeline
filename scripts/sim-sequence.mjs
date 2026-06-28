// 배송순번 알고리즘 베이스라인 시뮬레이션 하니스
// 답십리1동 실데이터로 현재 roadAwareTSP의 품질(특히 역주행)을 실측한다.
// 사용: node scripts/sim-sequence.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  roadAwareTSP,
  analyzeSequenceQuality,
  haversine,
} from '../src/engine/routeSequenceEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INPUT = resolve(ROOT, '.sim-data/route-extract.json');
const OUTPUT = resolve(ROOT, '.sim-data/baseline-result.json');

const TARGET_DONG = '답십리1동';

// ── 데이터 로드 + 필터 + 엔진 입력 형태로 매핑 ──────────────────────────────
const raw = JSON.parse(readFileSync(INPUT, 'utf8'));
const filtered = raw.filter((r) => String(r.행정동 || '').trim() === TARGET_DONG);

const records = filtered.map((r, idx) => ({
  ...r,
  id: r.docId || `sim-${idx}`,
  _lat: Number(r.lat),
  _lng: Number(r.lng),
  _isApt: r.isApt,
}));

console.log('═'.repeat(60));
console.log(`배송순번 베이스라인 시뮬 — ${TARGET_DONG}`);
console.log('═'.repeat(60));
console.log(`전체 레코드: ${raw.length}건`);
console.log(`${TARGET_DONG} 레코드: ${records.length}건`);
const withCoord = records.filter((r) => Number.isFinite(r._lat) && Number.isFinite(r._lng) && r._lat && r._lng);
console.log(`좌표 보유: ${withCoord.length}건 / 좌표 없음: ${records.length - withCoord.length}건`);

// ── 현재 운영 알고리즘과 동일 경로: roadAwareTSP (startPoint=null → 가장 북쪽부터) ──
const ordered = roadAwareTSP(records, null);
console.log(`\nroadAwareTSP 출력 순서 길이: ${ordered.length}건`);

// ── 측정 1: 총 이동거리(km), 인접 순번 간 haversine 합 ──────────────────────
let totalDistM = 0;
let longestGap = { m: 0, fromIdx: -1, toIdx: -1 };
const legs = []; // 각 인접 구간 거리(m)
for (let i = 1; i < ordered.length; i++) {
  const a = ordered[i - 1];
  const b = ordered[i];
  if (!Number.isFinite(a._lat) || !Number.isFinite(a._lng) || !Number.isFinite(b._lat) || !Number.isFinite(b._lng)) {
    legs.push(null);
    continue;
  }
  const d = haversine(a._lat, a._lng, b._lat, b._lng);
  legs.push(d);
  totalDistM += d;
  if (d > longestGap.m) longestGap = { m: d, fromIdx: i - 1, toIdx: i };
}
const totalDistKm = Math.round(totalDistM / 100) / 10;

// ── 측정 2: 역주행/건너뛰기 횟수 ───────────────────────────────────────────
// 각 위치 i에서 아직 방문 안 한 나머지 노드 중 현재 노드와 최근접 거리(minRemain)를 구하고,
// 실제 다음 노드 거리(actual)가 actual > minRemain*1.5 && actual - minRemain > 80m 이면 역주행 1회.
const coordOrdered = ordered.filter((r) => Number.isFinite(r._lat) && Number.isFinite(r._lng) && r._lat && r._lng);
let backtrackCount = 0;
const backtrackSamples = [];
for (let i = 0; i < coordOrdered.length - 1; i++) {
  const cur = coordOrdered[i];
  const next = coordOrdered[i + 1];
  const actual = haversine(cur._lat, cur._lng, next._lat, next._lng);
  // 아직 방문 안 한 나머지(= i+1 이후) 노드 중 최근접
  let minRemain = Infinity;
  let nearestRemainIdx = -1;
  for (let j = i + 1; j < coordOrdered.length; j++) {
    const cand = coordOrdered[j];
    const d = haversine(cur._lat, cur._lng, cand._lat, cand._lng);
    if (d < minRemain) {
      minRemain = d;
      nearestRemainIdx = j;
    }
  }
  if (actual > minRemain * 1.5 && actual - minRemain > 80) {
    backtrackCount++;
    if (backtrackSamples.length < 15) {
      backtrackSamples.push({
        순번_i: i + 1, // 1-based 현재 위치
        실제다음거리_m: Math.round(actual),
        최근접거리_m: Math.round(minRemain),
        더가까웠던노드순번: nearestRemainIdx + 1, // 1-based
        현재이름: cur.이름,
        현재주소: cur.주소,
        실제다음이름: next.이름,
        실제다음주소: next.주소,
        더가까운이름: coordOrdered[nearestRemainIdx]?.이름,
        더가까운주소: coordOrdered[nearestRemainIdx]?.주소,
      });
    }
  }
}

// ── 측정 3: 최장 구간(m) + 위치 ────────────────────────────────────────────
const longest = {
  거리_m: Math.round(longestGap.m),
  fromOrderIdx: longestGap.fromIdx + 1,
  toOrderIdx: longestGap.toIdx + 1,
  from: longestGap.fromIdx >= 0 ? { 이름: ordered[longestGap.fromIdx]?.이름, 주소: ordered[longestGap.fromIdx]?.주소 } : null,
  to: longestGap.toIdx >= 0 ? { 이름: ordered[longestGap.toIdx]?.이름, 주소: ordered[longestGap.toIdx]?.주소 } : null,
};

// ── 측정 4: analyzeSequenceQuality (jumpCount/revisitRoadCount/avgDist/accuracy) ──
// 각 레코드에 _driverId='sim', 배송순번=String(i+1) 세팅 후 호출
const analyzed = ordered.map((r, i) => ({ ...r, _driverId: 'sim', 배송순번: String(i + 1) }));
const quality = analyzeSequenceQuality(analyzed, [{ id: 'sim', name: '시뮬', color: '#3b82f6' }]);
const stat = quality.driverStats[0] || {};

// ── 콘솔 요약 ──────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
console.log('측정 결과 (haversine 직선거리 기준)');
console.log('─'.repeat(60));
console.log(`① 총 이동거리            : ${totalDistKm} km (${Math.round(totalDistM)} m)`);
console.log(`② 역주행/건너뛰기 횟수   : ${backtrackCount} 회`);
console.log(`③ 최장 구간              : ${longest.거리_m} m  (순번 ${longest.fromOrderIdx} → ${longest.toOrderIdx})`);
console.log('\n[analyzeSequenceQuality 출력]');
console.log(`   jumpCount(300m+ 점프)  : ${stat.jumpCount}`);
console.log(`   revisitRoadCount(도로재방문): ${stat.revisitRoadCount}`);
console.log(`   walkCount(120m이하 도보): ${stat.walkCount}`);
console.log(`   noCoordCount           : ${stat.noCoordCount}`);
console.log(`   noRoadCount            : ${stat.noRoadCount}`);
console.log(`   avgDist(평균이동)      : ${stat.avgDist} m`);
console.log(`   maxDist                : ${stat.maxDist} m`);
console.log(`   totalDistKm(엔진계산)  : ${stat.totalDistKm} km`);
console.log(`   estimatedMinutes       : ${stat.estimatedMinutes} 분`);
console.log(`   accuracy(예상정확도)   : ${stat.accuracy} %`);

console.log('\n[역주행 대표 샘플 (상위 5개)]');
backtrackSamples.slice(0, 5).forEach((s, k) => {
  console.log(
    `  ${k + 1}. 순번#${s.순번_i}: 실제 ${s.실제다음거리_m}m로 이동했으나, 더 가까운 #${s.더가까웠던노드순번}(${s.최근접거리_m}m)이 남아있었음`
  );
  console.log(`     현재: ${s.현재이름} / ${s.현재주소}`);
  console.log(`     → 실제다음: ${s.실제다음이름} / ${s.실제다음주소}`);
  console.log(`     → 더가까움: ${s.더가까운이름} / ${s.더가까운주소}`);
});

// ── 상세 결과 저장 ──────────────────────────────────────────────────────────
const out = {
  target: TARGET_DONG,
  generatedAt: new Date().toISOString(),
  algorithm: 'roadAwareTSP (startPoint=null)',
  counts: {
    전체레코드: raw.length,
    대상레코드: records.length,
    좌표보유: withCoord.length,
    좌표없음: records.length - withCoord.length,
    출력순서길이: ordered.length,
  },
  metrics: {
    총이동거리_km: totalDistKm,
    총이동거리_m: Math.round(totalDistM),
    역주행건너뛰기_횟수: backtrackCount,
    최장구간_m: longest.거리_m,
    최장구간_위치: { from: longest.fromOrderIdx, to: longest.toOrderIdx },
  },
  analyzeSequenceQuality: {
    jumpCount: stat.jumpCount,
    revisitRoadCount: stat.revisitRoadCount,
    walkCount: stat.walkCount,
    noCoordCount: stat.noCoordCount,
    noRoadCount: stat.noRoadCount,
    avgDist: stat.avgDist,
    maxDist: stat.maxDist,
    totalDistKm: stat.totalDistKm,
    estimatedMinutes: stat.estimatedMinutes,
    accuracy: stat.accuracy,
  },
  longest,
  backtrackSamples,
  orderedPreview: ordered.slice(0, 30).map((r, i) => ({
    순번: i + 1,
    이름: r.이름,
    주소: r.주소,
    lat: r._lat,
    lng: r._lng,
  })),
};
writeFileSync(OUTPUT, JSON.stringify(out, null, 2), 'utf8');
console.log(`\n상세 결과 저장: ${OUTPUT}`);
console.log('═'.repeat(60));
