// 지도 핀 시각 규칙 잠금 — 2026-08-23 Phase 3-3
//   node --test scripts/map-pin.test.mjs
//
//   왜 잠그나: 이 핀들이 담당자가 **혼재(R-F)와 순번을 눈으로 확인하는 수단**이다.
//   포수별 크기·강조, 같은좌표 ×N, 순번 배지, 겹침 순서(zIndex)가 조용히 바뀌면
//   화면은 그럴듯한데 판단이 틀어진다. 성능 작업(증분 갱신·컬링)을 하면서 규칙이 흔들리지 않게 못 박는다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildPinInnerHtml, pinZIndex, pinSizeOf, pinQtyLevel, isWithinPaddedBounds, CULL_MIN_RECORDS } from '../src/components/routeMap/mapHelpers.js';

describe('포수 강조 — 많이 지고 가는 집이 눈에 띄어야 한다', () => {
  test('레벨 경계 (1 / 2 / 3~4 / 5~9 / 10+)', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 9, 10, 30].map(pinQtyLevel), [0, 1, 2, 2, 3, 3, 4, 4]);
  });
  test('레벨별 핀 크기(px)', () => {
    assert.deepEqual([1, 2, 3, 5, 10].map(pinSizeOf), [32, 34, 36, 39, 44]);
  });
});

describe('겹침 순서(zIndex) — 가려지면 안 되는 순서', () => {
  test('오류 > 같은좌표 > 5포↑ > 2포↑ > 순번 > 기본', () => {
    assert.equal(pinZIndex({ isError: true, qtyNum: 1 }), 10);
    assert.equal(pinZIndex({ isError: false, sameCount: 3 }), 9);
    assert.equal(pinZIndex({ isError: false, qtyNum: 7 }), 8);
    assert.equal(pinZIndex({ isError: false, qtyNum: 2 }), 6);
    assert.equal(pinZIndex({ isError: false, qtyNum: 1, seq: '12' }), 5);
    assert.equal(pinZIndex({ isError: false }), 1);
  });
  test('오류는 어떤 조건에서도 맨 위', () => {
    assert.equal(pinZIndex({ isError: true, sameCount: 9, qtyNum: 99, seq: '1' }), 10);
  });
});

describe('핀 내용 — 이 화면의 업무 정보가 다 들어 있어야 한다', () => {
  const html = buildPinInnerHtml({ color: '#3b82f6', seq: '7', name: '홍길동', dong: '전농', qtyNum: 6, sameCount: 3 });

  test('순번·이름·포수·동·×N 이 모두 표시된다', () => {
    assert.ok(html.includes('>7<'), '순번 배지가 없다');
    assert.ok(html.includes('홍길동'), '이름이 없다');
    assert.ok(html.includes('6포'), '포수 라벨이 없다');
    assert.ok(html.includes('전농'), '행정동 라벨이 없다');
    assert.ok(html.includes('×3'), '같은좌표 ×N 뱃지가 없다');
  });

  test('기사 색이 핀·꼬리·테두리에 쓰인다', () => {
    assert.ok(html.split('#3b82f6').length - 1 >= 3, '기사 색이 충분히 반영되지 않았다');
  });

  test('순번이 없으면 점, 있으면 숫자', () => {
    const noSeq = buildPinInnerHtml({ color: '#22c55e', name: '김', qtyNum: 1 });
    assert.ok(!/>1<\/span>/.test(noSeq));
    assert.ok(noSeq.includes('border-radius:50%'), '점 표시가 사라졌다');
  });

  test('같은좌표가 1이면 ×N 뱃지가 없다', () => {
    assert.ok(!buildPinInnerHtml({ color: '#22c55e', name: '김', qtyNum: 1, sameCount: 1 }).includes('×'));
  });

  test('동이 없으면 동 라벨을 만들지 않는다', () => {
    const noDong = buildPinInnerHtml({ color: '#22c55e', name: '김', qtyNum: 1, dong: '' });
    assert.equal(noDong.split('#94a3b8').length - 1, 0);
  });

  test('이름·동에 태그 문자가 들어와도 그대로 쓰지 않는다(호출부가 escHtml 로 넣는 전제)', () => {
    // 이 함수는 문자열을 조립만 한다 — 이스케이프는 호출부 책임이라는 계약을 명시적으로 남긴다.
    const raw = buildPinInnerHtml({ color: '#22c55e', name: '&lt;img&gt;', qtyNum: 1 });
    assert.ok(raw.includes('&lt;img&gt;'), '이미 이스케이프된 값이 그대로 들어가야 한다');
  });
});

describe('뷰포트 컬링 판정 — 화면 근처만 붙인다(2026-08-23 Phase 3-4)', () => {
  const box = { south: 37.50, west: 127.00, north: 37.60, east: 127.10 };

  test('화면 안은 당연히 보인다', () => {
    assert.equal(isWithinPaddedBounds(37.55, 127.05, box), true);
  });

  test('여유(기본 40%) 안쪽도 보인다 — 조금 밀어도 빈 화면이 안 보이게', () => {
    assert.equal(isWithinPaddedBounds(37.63, 127.05, box), true, '북쪽 여유 안');
    assert.equal(isWithinPaddedBounds(37.55, 126.97, box), true, '서쪽 여유 안');
  });

  test('여유 밖은 붙이지 않는다', () => {
    assert.equal(isWithinPaddedBounds(37.70, 127.05, box), false);
    assert.equal(isWithinPaddedBounds(37.55, 127.30, box), false);
  });

  test('★모르면 보여준다 — 범위나 좌표가 없으면 숨기지 않는다(안전한 쪽)', () => {
    assert.equal(isWithinPaddedBounds(37.55, 127.05, null), true);
    assert.equal(isWithinPaddedBounds(undefined, undefined, box), true);
    assert.equal(isWithinPaddedBounds(NaN, 127.05, box), true);
  });

  test('임계값 — 평소 경로(수백 건)에서는 컬링이 아예 켜지지 않는다', () => {
    assert.ok(CULL_MIN_RECORDS >= 1000, `임계값이 너무 낮다(${CULL_MIN_RECORDS}) — 동 큐 경로까지 컬링에 걸린다`);
  });
});
