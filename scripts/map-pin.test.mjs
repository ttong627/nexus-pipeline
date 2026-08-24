// 지도 핀 시각 규칙 잠금 — 2026-08-23 Phase 3-3
//   node --test scripts/map-pin.test.mjs
//
//   왜 잠그나: 이 핀들이 담당자가 **혼재(R-F)와 순번을 눈으로 확인하는 수단**이다.
//   포수별 크기·강조, 같은좌표 ×N, 순번 배지, 겹침 순서(zIndex)가 조용히 바뀌면
//   화면은 그럴듯한데 판단이 틀어진다. 성능 작업(증분 갱신·컬링)을 하면서 규칙이 흔들리지 않게 못 박는다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildPinInnerHtml, pinZIndex, pinSizeOf, pinQtyLevel, isWithinPaddedBounds, CULL_MIN_RECORDS,
  PIN_COMPACT_LEVEL, PIN_LABEL_BLOCK_PX, PIN_DONG_BLOCK_PX } from '../src/components/routeMap/mapHelpers.js';
import { readFile } from 'node:fs/promises';

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

describe('저줌 간이표시(Phase 3-5) — 축소하면 라벨만 빼고 판단 근거는 남긴다', () => {
  // 컬링(3-4)은 확대했을 때만 듣는다. 축소하면 전건이 화면 안이라 라벨 7,400줄이 그대로 그려진다.
  // 그 구간에서 이름·동은 서로 겹쳐 못 읽으므로 빼되, **혼재와 순번을 보는 근거는 그대로** 둔다.
  const P = { color: '#22c55e', seq: '12', name: '홍길동', dong: '전농', qtyNum: 7, sameCount: 3 };

  test('라벨은 빠지고 색·순번·×N·포수뱃지는 남는다', () => {
    const c = buildPinInnerHtml({ ...P, compact: true });
    assert.equal(c.includes('홍길동'), false, '이름 라벨이 남았다 — 간이표시의 의미가 없다');
    assert.equal(c.includes('전농'), false, '동 라벨이 남았다');
    assert.ok(c.includes('>12<'), '순번이 사라지면 순번 확인이 불가능하다');
    assert.ok(c.includes('×3'), '같은좌표 ×N 이 사라지면 안 된다');
    assert.ok(c.includes(P.color), '기사 색이 사라지면 혼재 확인이 불가능하다');
    assert.ok(/#f97316/.test(c), '포수 뱃지(5포↑)가 사라졌다');
  });

  test('★높이가 같다 — 라벨을 그냥 빼면 핀이 아래로 밀린다', () => {
    // CustomOverlay 는 yAnchor 를 **높이의 비율**로 잡는다. 콘텐츠가 짧아지면 핀이 제자리를 벗어나
    // 저줌에서 위치가 어긋난 것처럼 보인다 → 같은 높이의 빈 칸으로 자리를 지킨다.
    const withDong = buildPinInnerHtml({ ...P, compact: true });
    const noDong = buildPinInnerHtml({ ...P, dong: '', compact: true });
    assert.ok(withDong.includes(`height:${PIN_LABEL_BLOCK_PX + PIN_DONG_BLOCK_PX}px`), '동이 있을 때 빈 칸 높이가 다르다');
    assert.ok(noDong.includes(`height:${PIN_LABEL_BLOCK_PX}px`), '동이 없을 때 빈 칸 높이가 다르다');
  });

  test('기본(고줌)은 예전 그대로 — 모드를 안 주면 아무것도 안 바뀐다', () => {
    assert.equal(buildPinInnerHtml(P), buildPinInnerHtml({ ...P, compact: false }));
    assert.ok(buildPinInnerHtml(P).includes('홍길동'), '평소 핀에서 이름이 사라지면 안 된다');
  });

  test('전환 기준 레벨은 상수로만 관리', () => {
    assert.equal(typeof PIN_COMPACT_LEVEL, 'number');
    assert.ok(PIN_COMPACT_LEVEL >= 4, '너무 확대된 구간에서 라벨이 사라지면 담당자가 못 읽는다');
  });

  test('★핀 템플릿은 한 벌 — 화면 쪽에 마크업 사본이 없다(불변식 7)', async () => {
    // 이 프로젝트가 반복해서 당한 함정: 사본이 생기면 한쪽만 고쳐지고 "고쳤는데 안 바뀐다"가 된다.
    const src = await readFile(new URL('../src/components/RouteMapModal.jsx', import.meta.url), 'utf8');
    // ★기록 핀의 서명으로만 본다 — 완료비교 점(14px)·기사 거점 핀은 성격이 다른 마커라 사본이 아니다.
    assert.equal(/\$\{pinSize\}px;border-radius:50%/.test(src), false, '원형 핀 마크업 사본이 다시 생겼다');
    assert.equal(/box-shadow:\$\{glowStyle\}/.test(src), false, '포수 glow 마크업 사본이 다시 생겼다');
    assert.equal(/>×\$\{sameCount\}</.test(src), false, '×N 뱃지 마크업 사본이 다시 생겼다');
    assert.ok(src.includes('buildPinInnerHtml('), '핀은 SSOT 함수로만 그린다');
  });
});
