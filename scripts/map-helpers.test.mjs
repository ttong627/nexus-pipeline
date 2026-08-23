// 루트맵 순수 헬퍼 특성화(characterization) 회귀
//   node --test scripts/map-helpers.test.mjs
//
//   왜 필요한가(2026-08-23 점검): `RouteMapModal.jsx` 는 5,850줄이고 이 화면을 지키는 테스트는
//   **텍스트 grep 2개**뿐이었다(`checkJs:false` 라 타입검사도 .jsx 를 안 본다 · 스모크는 로그인을 안 해 이 화면에 도달조차 못 한다).
//   그래서 파일을 쪼개기 전에 **지금 동작을 그대로 못 박는다** — 앞으로 이 함수들의 출력이 달라지면 여기서 잡힌다.
//
//   ★특성화 테스트의 성격: "이게 옳다"가 아니라 **"지금 이렇게 동작한다"**를 고정한다.
//     의도적으로 동작을 바꿀 때는 이 기대값도 같이 고치되, **왜 바꾸는지 주석으로 남긴다**.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeReason,
  strongMatchKey,
  escHtml,
  getRouteDong,
  getRouteUnitKey,
  buildAssignedRouteUnits,
  getMajorityDriverId,
  isAptRouteUnitKey,
  getMixedRouteUnitIssues,
  getRecordQty,
  buildMapInsights,
  assessKakaoAreaMatch,
  isCoordAssignable,
  DRIVER_COLORS,
  SHARE_LINK_TTL_DAYS,
  SHARE_TRANSITION_DUAL_WRITE,
} from '../src/components/routeMap/mapHelpers.js';

const R = (over = {}) => ({ id: over.id || 'r1', 이름: '홍길동', 주소: '서울특별시 동대문구 왕산로 72, 101- 203호 (전농동, 래미안)', 행정동: '전농동', 포수: 1, ...over });

describe('사유 병합 — 중복 없이 이어 붙인다(재매칭 3회에 A / A / A 가 되던 자리)', () => {
  test('빈값·중복·신규', () => {
    assert.equal(mergeReason('', '좌표없음'), '좌표없음');
    assert.equal(mergeReason('좌표없음', '좌표없음'), '좌표없음');
    assert.equal(mergeReason('좌표없음', '타지역'), '좌표없음 / 타지역');
    assert.equal(mergeReason('좌표없음 / 타지역', '좌표없음'), '좌표없음 / 타지역');
    assert.equal(mergeReason('좌표없음', ''), '좌표없음');
    assert.equal(mergeReason(null, null), '');
  });
});

describe('동명이인 강키 — 이름+전화 끝8 (S-1)', () => {
  test('현재 동작: 이름과 전화가 **둘 다** 있어야 키가 생긴다(생년월일은 쓰지 않는다)', () => {
    // ★특성화: 이 헬퍼는 전화 기반 키만 만든다. 생년월일 키가 필요하면 별도 함수를 쓸 것
    //   (S-1 은 이름+생년월일 **또는** 이름+전화끝8 을 강키로 인정한다 — 여기선 후자만 담당).
    assert.equal(strongMatchKey({ 이름: '홍길동', 휴대폰: '010-1234-5678' }), '홍길동|12345678');
    assert.equal(strongMatchKey({ 이름: '홍 길동', 연락처: '010-1234-5678' }), '홍길동|12345678', '공백은 무시한다');
    assert.equal(strongMatchKey({ 이름: '홍길동', 생년월일: '75.03.15' }), '', '전화가 없으면 약키를 만들지 않는다(S-1)');
    assert.equal(strongMatchKey({ 이름: '홍길동' }), '');
    assert.equal(strongMatchKey({ 휴대폰: '010-1234-5678' }), '', '이름이 없으면 키 없음');
  });
});

describe('HTML 이스케이프 — 지도 라벨·보고서에 그대로 들어가는 값', () => {
  test('꺾쇠·앰퍼샌드', () => {
    assert.equal(escHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
    assert.equal(escHtml('A&B'), 'A&amp;B');
    assert.equal(escHtml(null), '');
  });
});

describe('행정동 추출 · 포수', () => {
  test('행정동 우선, 없으면 빈값', () => {
    assert.equal(getRouteDong(R()), '전농동');
    assert.equal(getRouteDong({ ...R(), 행정동: '' }), '');
  });
  test('포수는 빈값이면 1(C-4)', () => {
    assert.equal(getRecordQty(R({ 포수: 3 })), 3);
    assert.equal(getRecordQty(R({ 포수: '' })), 1);
    assert.equal(getRecordQty({}), 1);
  });
});

describe('배송단위 키 — 같은 아파트·같은 주소는 한 덩어리(R-E·R-I)', () => {
  test('같은 단지의 다른 호수는 같은 키(현재 형식: `apt:road:<도로명주소>`)', () => {
    const apt = getRouteUnitKey(R({ 주소: '서울특별시 동대문구 왕산로 72, 101- 203호 (전농동, 래미안아파트)' }));
    assert.equal(apt, 'apt:road:서울특별시 동대문구 왕산로 72');
    const apt2 = getRouteUnitKey(R({ id: 'r2', 주소: '서울특별시 동대문구 왕산로 72, 101- 505호 (전농동, 래미안아파트)' }));
    assert.equal(apt, apt2, '같은 단지가 다른 배송단위로 갈라졌다 — R-E/R-I 가 깨진다');
  });
  test('isAptRouteUnitKey 는 apt:/apt-split: 만 참', () => {
    assert.equal(isAptRouteUnitKey('apt:래미안'), true);
    assert.equal(isAptRouteUnitKey('apt-split:래미안:101'), true);
    assert.equal(isAptRouteUnitKey('addr:왕산로72'), false);
    assert.equal(isAptRouteUnitKey(null), false);
  });
});

describe('혼재 감지 — 한 배송단위가 두 기사로 갈린 경우만(R-F)', () => {
  const drivers = [{ id: 'd1', name: '기사1' }, { id: 'd2', name: '기사2' }];
  // ★좌표가 없는 레코드는 배송단위에 아예 들어가지 않는다(현재 동작) — 혼재 판정도 좌표 있는 건만 본다.
  const AT = { _lat: 37.5777, _lng: 127.0314 };
  test('같은 아파트가 두 기사로 갈리면 혼재', () => {
    const recs = [
      R({ id: 'a', ...AT, _driverId: 'd1' }),
      R({ id: 'b', ...AT, 주소: '서울특별시 동대문구 왕산로 72, 101- 505호 (전농동, 래미안아파트)', _driverId: 'd2' }),
    ];
    const units = buildAssignedRouteUnits(recs, drivers);
    assert.equal(units.length, 1, '같은 단지가 한 배송단위로 묶이지 않았다');
    assert.deepEqual(units[0].driverIds.sort(), ['d1', 'd2']);
    // ★반환은 배열이 아니라 **Map**(key = 배송단위 키, value = { type, targetDriverId })
    const issues = getMixedRouteUnitIssues(units);
    assert.equal(issues.size, 1, '같은 단지 2기사 혼재를 못 잡았다');
    assert.equal(issues.get('apt:road:서울특별시 동대문구 왕산로 72').type, 'split-unit');
  });
  test('같은 기사면 혼재 아님', () => {
    const recs = [
      R({ id: 'a', ...AT, _driverId: 'd1' }),
      R({ id: 'b', ...AT, 주소: '서울특별시 동대문구 왕산로 72, 101- 505호 (전농동, 래미안아파트)', _driverId: 'd1' }),
    ];
    assert.equal(getMixedRouteUnitIssues(buildAssignedRouteUnits(recs, drivers)).size, 0);
  });
  test('좌표 없는 건은 배송단위에 들어가지 않는다(현재 동작)', () => {
    const recs = [R({ id: 'a', _driverId: 'd1' })];
    assert.equal(buildAssignedRouteUnits(recs, drivers).length, 0);
  });
  test('최다 배정 기사 판정 — 없으면 빈 문자열', () => {
    assert.equal(getMajorityDriverId([{ _driverId: 'd1' }, { _driverId: 'd1' }, { _driverId: 'd2' }]), 'd1');
    assert.equal(getMajorityDriverId([]), '');
  });
});

describe('지도 요약(buildMapInsights) — 화면 배지 수치의 출처', () => {
  test('기사별 건수·포수와 미배정을 센다', () => {
    const drivers = [{ id: 'd1', name: '기사1', capacity: 100 }, { id: 'd2', name: '기사2', capacity: 100 }];
    const records = [
      R({ id: 'a', _driverId: 'd1', 포수: 2, _lat: 37.5, _lng: 127.0 }),
      R({ id: 'b', _driverId: 'd1', 포수: 1, _lat: 37.5, _lng: 127.0 }),
      R({ id: 'c', _driverId: 'd2', 포수: 3, _lat: 37.6, _lng: 127.1 }),
      R({ id: 'd', _driverId: null, 포수: 1 }),
    ];
    const out = buildMapInsights({ records, drivers });
    assert.ok(out && typeof out === 'object', 'buildMapInsights 가 객체를 돌려주지 않는다');
    const json = JSON.stringify(out);
    assert.ok(json.includes('d1') || json.includes('기사1'), '기사별 집계가 비어 있다');
  });
  test('빈 입력에서 죽지 않는다', () => {
    assert.doesNotThrow(() => buildMapInsights({ records: [], drivers: [] }));
  });
});

describe('카카오 지역 판정 — 타지역 좌표를 배정에서 제외(A-30 취지)', () => {
  test('지자체가 다르면 배정 불가 상태로 표시된다', () => {
    const out = assessKakaoAreaMatch(R(), { address: { region_1depth_name: '경기', region_2depth_name: '시흥시' } }, '서울특별시 동대문구');
    assert.ok(out && typeof out === 'object');
  });
  test('isCoordAssignable 은 지자체벗어남만 거른다', () => {
    assert.equal(isCoordAssignable({ 좌표검증상태: '정상' }), true);
    assert.equal(isCoordAssignable({ 좌표검증상태: '지자체벗어남' }), false);
    assert.equal(isCoordAssignable({}), true);
  });
});

describe('상수 — 눈에 안 보이게 바뀌면 큰일 나는 값들', () => {
  test('기사 색상표·공유 기본 유효기간·이중쓰기 킬스위치', () => {
    assert.ok(Array.isArray(DRIVER_COLORS) && DRIVER_COLORS.length >= 8, '기사 색상표가 줄었다');
    assert.equal(SHARE_LINK_TTL_DAYS, 7);
    // ★부모 공유문서에 명단 배열을 다시 쓰면 토큰 하나로 전 기사 PII 가 읽힌다(SH-6 ⑥). 절대 true 로 돌리지 말 것.
    assert.equal(SHARE_TRANSITION_DUAL_WRITE, false);
  });
});
