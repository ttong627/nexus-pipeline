// 좌표 오류 검출(거리 기반) 회귀 테스트 — 실데이터 케이스로 고정
// 실행: node scripts/coord-validator.test.mjs
import assert from 'node:assert/strict';
import { haversineKm, medianCenter, detectCoordOutliers } from '../src/engine/coordValidator.js';

let pass = 0, fail = 0;
const t = (label, fn) => { try { fn(); pass++; console.log(`  ✅ ${label}`); } catch (e) { fail++; console.log(`  ❌ ${label}\n     ${e.message}`); } };

// 시흥시 근처 정상 좌표
const R = (이름, lat, lng, 행정동 = '대야동', 주소 = '') => ({ 이름, _lat: lat, _lng: lng, 행정동, 주소 });
const NORMAL = [
  R('가', 37.4468, 126.7887), R('나', 37.4470, 126.7890), R('다', 37.4450, 126.7860),
  R('라', 37.4500, 126.7900), R('마', 37.4420, 126.7830), R('바', 37.4480, 126.7910),
];

console.log('\n── haversineKm ──');
t('시흥 두 점 거리 ~수백m', () => {
  const d = haversineKm(37.4468, 126.7887, 37.4470, 126.7890);
  assert.ok(d < 0.1, `${d}km`);
});
t('시흥→부안 약 190km', () => {
  const d = haversineKm(37.4468, 126.7887, 35.6714, 126.7115);
  assert.ok(d > 180 && d < 210, `${d}km`);
});

console.log('\n── medianCenter ──');
t('중앙값 중심은 정상 좌표들 사이', () => {
  const c = medianCenter(NORMAL);
  assert.ok(c.lat > 37.44 && c.lat < 37.45, `lat ${c.lat}`);
  assert.ok(c.lng > 126.78 && c.lng < 126.80, `lng ${c.lng}`);
});
t('오류 좌표 1개는 중앙값을 흔들지 못한다(평균과 다른 점)', () => {
  const c = medianCenter([...NORMAL, R('안금순', 35.6714, 126.7115)]);
  assert.ok(c.lat > 37.44 && c.lat < 37.45, `중앙값이 오류에 안 흔들림 lat ${c.lat}`);
});

console.log('\n── detectCoordOutliers ──');
t('정상 좌표만 있으면 오류 0', () => {
  assert.equal(detectCoordOutliers(NORMAL, { radiusKm: 25 }).outliers.length, 0);
});
t('190km 밖 좌표(안금순)를 오류로 검출', () => {
  const recs = [...NORMAL, R('안금순', 35.6714, 126.7115, '대야동', '주산로 12')];
  const { outliers } = detectCoordOutliers(recs, { radiusKm: 25 });
  assert.equal(outliers.length, 1);
  assert.equal(outliers[0].record.이름, '안금순');
  assert.ok(outliers[0].distanceKm > 180);
});
t('좌표 없는 건은 검출 대상 아님(오류 아님)', () => {
  const recs = [...NORMAL, { 이름: '무좌표', _lat: null, _lng: null }];
  assert.equal(detectCoordOutliers(recs, { radiusKm: 25 }).outliers.length, 0);
});
t('표본이 너무 적으면(3건 미만) 판정 보류', () => {
  const recs = [R('가', 37.44, 126.78), R('나', 35.67, 126.71)];
  assert.equal(detectCoordOutliers(recs, { radiusKm: 25, minSample: 3 }).outliers.length, 0);
});
t('여러 오류를 모두 검출하고 거리순 정렬', () => {
  const recs = [...NORMAL, R('멀리1', 35.67, 126.71), R('멀리2', 37.9, 127.5)];
  const { outliers } = detectCoordOutliers(recs, { radiusKm: 25 });
  assert.equal(outliers.length, 2);
  assert.ok(outliers[0].distanceKm >= outliers[1].distanceKm); // 먼 것부터
});
t('임계 반경을 넘지 않으면 정상(경계값)', () => {
  // 중심에서 약 10km 떨어진 점 — radiusKm 25면 정상
  const recs = [...NORMAL, R('경계', 37.54, 126.79)];
  assert.equal(detectCoordOutliers(recs, { radiusKm: 25 }).outliers.length, 0);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
