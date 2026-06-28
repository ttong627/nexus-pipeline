// Kakao Directions 실차량거리 최종 검증 — baseline vs improved
// "추측 금지, 실제 차량 이동거리"를 위해 각 최종 순번의 인접 구간을 Kakao 실거리로 측정한다.
// 사용: node scripts/sim-kakao-verify.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  roadAwareTSP,
  improvedSequence,
  haversine,
} from '../src/engine/routeSequenceEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INPUT = resolve(ROOT, '.sim-data/route-extract.json');
const OUTPUT = resolve(ROOT, '.sim-data/kakao-result.json');
const ENV = resolve(ROOT, '.env');
const TARGET_DONG = '답십리1동';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── .env에서 VITE_KAKAO_REST_KEY 파싱 ───────────────────────────────────────
const parseKakaoKey = () => {
  if (!existsSync(ENV)) return '';
  const txt = readFileSync(ENV, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*VITE_KAKAO_REST_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '').trim();
  }
  return '';
};

const KAKAO_KEY = parseKakaoKey();
if (!KAKAO_KEY) {
  console.error('❌ .env에서 VITE_KAKAO_REST_KEY를 찾지 못했습니다. 중단합니다.');
  process.exit(1);
}
console.log(`✅ Kakao REST 키 로드 완료 (길이 ${KAKAO_KEY.length})`);

// ── 데이터 로드 + 필터 + 매핑 ───────────────────────────────────────────────
const raw = JSON.parse(readFileSync(INPUT, 'utf8'));
const records = raw
  .filter((r) => String(r.행정동 || '').trim() === TARGET_DONG)
  .map((r, idx) => ({
    ...r,
    id: r.docId || `sim-${idx}`,
    _lat: Number(r.lat),
    _lng: Number(r.lng),
    _isApt: r.isApt,
  }));

const baseOrder = roadAwareTSP(records, null);
const impOrder = improvedSequence(records, null);

// ── 좌표 키 + 캐시 (baseline·improved 공유 쌍은 1회만 호출) ──────────────────
const coordKey = (lat, lng) => `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
const pairKey = (a, b) => `${coordKey(a._lat, a._lng)}|${coordKey(b._lat, b._lng)}`;
const edgeCache = new Map(); // pairKey → { dist(m), dur(s), source: 'kakao'|'same'|'haversine' }

const hasCoord = (r) => Number.isFinite(r._lat) && Number.isFinite(r._lng) && r._lat && r._lng;

// 인접 좌표쌍 추출(좌표 있는 것만, 동일좌표는 같은쌍으로 처리)
const buildPairs = (order) => {
  const pairs = [];
  let prev = null;
  for (const r of order) {
    if (!hasCoord(r)) continue;
    if (prev) pairs.push({ from: prev, to: r });
    prev = r;
  }
  return pairs;
};

const basePairs = buildPairs(baseOrder);
const impPairs = buildPairs(impOrder);

// 고유 호출 대상(동일좌표쌍 제외)
const uniqueToCall = new Map(); // pairKey → {from,to}
const registerPairs = (pairs) => {
  for (const p of pairs) {
    const fk = coordKey(p.from._lat, p.from._lng);
    const tk = coordKey(p.to._lat, p.to._lng);
    if (fk === tk) continue; // 대단지 동일좌표 → 0 처리, 호출 불필요
    const k = pairKey(p.from, p.to);
    if (!edgeCache.has(k) && !uniqueToCall.has(k)) uniqueToCall.set(k, p);
  }
};
registerPairs(basePairs);
registerPairs(impPairs);

console.log(`\nbaseline 인접쌍: ${basePairs.length}  /  improved 인접쌍: ${impPairs.length}`);
console.log(`고유 Kakao 호출 대상(동일좌표 제외, 양쪽 합산 중복 제거): ${uniqueToCall.size}쌍`);
if (uniqueToCall.size > 450) {
  console.log(`⚠ 호출 쌍이 ${uniqueToCall.size}개(>450) — 그대로 진행합니다. 각 호출 사이 120ms sleep.`);
}

// ── Kakao Directions 호출 ───────────────────────────────────────────────────
let kakaoOk = 0;
let kakaoFail = 0;
const callKakao = async (from, to) => {
  const url = `https://apis-navi.kakaomobility.com/v1/directions?origin=${from._lng},${from._lat}&destination=${to._lng},${to._lat}&priority=RECOMMEND&summary=true`;
  try {
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
    if (!res.ok) return null;
    const data = await res.json();
    const summary = data?.routes?.[0]?.summary;
    if (!summary || summary.distance == null) return null;
    return { dist: Number(summary.distance), dur: Number(summary.duration) };
  } catch {
    return null;
  }
};

const callList = [...uniqueToCall.entries()];
console.log(`\nKakao 실거리 호출 시작 (${callList.length}쌍)…`);
for (let i = 0; i < callList.length; i++) {
  const [k, p] = callList[i];
  const r = await callKakao(p.from, p.to);
  if (r) {
    edgeCache.set(k, { dist: r.dist, dur: r.dur, source: 'kakao' });
    kakaoOk++;
  } else {
    // 실패 → haversine 대체
    const hv = haversine(p.from._lat, p.from._lng, p.to._lat, p.to._lng);
    edgeCache.set(k, { dist: hv, dur: hv / (30000 / 3600), source: 'haversine' });
    kakaoFail++;
  }
  if ((i + 1) % 50 === 0 || i === callList.length - 1) {
    console.log(`  진행 ${i + 1}/${callList.length}  (kakao성공 ${kakaoOk}, 실패→haversine ${kakaoFail})`);
  }
  await sleep(120);
}

// ── 순번별 총 차량거리/시간 합산 ────────────────────────────────────────────
const sumOrder = (pairs) => {
  let distM = 0;
  let durS = 0;
  let kakaoPairs = 0;
  let samePairs = 0;
  let haversinePairs = 0;
  for (const p of pairs) {
    const fk = coordKey(p.from._lat, p.from._lng);
    const tk = coordKey(p.to._lat, p.to._lng);
    if (fk === tk) {
      samePairs++;
      continue; // 동일좌표 → 0
    }
    const e = edgeCache.get(pairKey(p.from, p.to));
    if (!e) {
      haversinePairs++;
      const hv = haversine(p.from._lat, p.from._lng, p.to._lat, p.to._lng);
      distM += hv;
      durS += hv / (30000 / 3600);
      continue;
    }
    distM += e.dist;
    durS += e.dur;
    if (e.source === 'kakao') kakaoPairs++;
    else haversinePairs++;
  }
  return {
    총차량거리_km: Math.round(distM / 100) / 10,
    총소요시간_분: Math.round(durS / 60),
    kakao쌍: kakaoPairs,
    동일좌표쌍: samePairs,
    haversine대체쌍: haversinePairs,
    유효쌍: pairs.length,
  };
};

const baseSum = sumOrder(basePairs);
const impSum = sumOrder(impPairs);

const pct = (from, to) => (from === 0 ? 0 : Math.round(((from - to) / from) * 1000) / 10);

// ── 출력 ────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(64));
console.log('Kakao 실차량거리 최종 검증 결과');
console.log('═'.repeat(64));
const row = (label, b, i, unit) => {
  console.log(`  ${label.padEnd(20)} ${String(b).padStart(10)}${unit}  →${String(i).padStart(10)}${unit}`);
};
console.log('  지표                    baseline        improved');
console.log('─'.repeat(64));
row('총 차량거리', baseSum.총차량거리_km, impSum.총차량거리_km, ' km');
row('총 소요시간', baseSum.총소요시간_분, impSum.총소요시간_분, ' 분');
row('Kakao 실측쌍', baseSum.kakao쌍, impSum.kakao쌍, ' 쌍');
row('동일좌표쌍(0처리)', baseSum.동일좌표쌍, impSum.동일좌표쌍, ' 쌍');
row('haversine대체쌍', baseSum.haversine대체쌍, impSum.haversine대체쌍, ' 쌍');
console.log('─'.repeat(64));
console.log(`  실차량거리 감소: ${pct(baseSum.총차량거리_km, impSum.총차량거리_km)}%   소요시간 감소: ${pct(baseSum.총소요시간_분, impSum.총소요시간_분)}%`);
console.log(`  Kakao 호출 총: 성공 ${kakaoOk} / 실패(haversine대체) ${kakaoFail}`);

const out = {
  target: TARGET_DONG,
  generatedAt: new Date().toISOString(),
  recordCount: records.length,
  kakaoCalls: { 성공: kakaoOk, 실패_haversine대체: kakaoFail, 고유호출쌍: uniqueToCall.size },
  baseline: { algorithm: 'roadAwareTSP', ...baseSum },
  improved: { algorithm: 'improvedSequence', ...impSum },
  delta: {
    실차량거리감소_pct: pct(baseSum.총차량거리_km, impSum.총차량거리_km),
    소요시간감소_pct: pct(baseSum.총소요시간_분, impSum.총소요시간_분),
  },
};
writeFileSync(OUTPUT, JSON.stringify(out, null, 2), 'utf8');
console.log(`\n상세 결과 저장: ${OUTPUT}`);
console.log('═'.repeat(64));
