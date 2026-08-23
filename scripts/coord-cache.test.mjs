// 좌표 캐시 키 규격 잠금 — 2026-08-23 Phase 1
//   node --test scripts/coord-cache.test.mjs
//
//   ★이 테스트가 지키는 것: **키가 바뀌면 기존 캐시를 통째로 못 읽는다.**
//     실측 기준 13개 지자체 41,694 주소가 이미 쌓여 있고(최대 도시 7,402건),
//     키가 하루만 어긋나도 그만큼을 카카오에서 **다시 구매**하게 된다.
//
//   배경(N+1 제거): 예전엔 레코드마다 `getDoc` 1회(실측 27.8ms) → 7,402건이면 약 206초.
//   `loadCityCoordCache` 로 한 번에 읽으면 637ms(323배). 단, 일괄 로드와 개별 조회가
//   **같은 키**를 써야 그 캐시가 그대로 쓰인다 — 아래 `lookupCoordInCache` 동치 테스트가 그것이다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractRoadAddress,
  addrToDocId,
  lookupCoordInCache,
} from '../src/utils/coordCache.js';

describe('주소 → 캐시 키 (절대 바꾸지 말 것)', () => {
  test('괄호 밖 첫 쉼표 앞까지가 키다', () => {
    assert.equal(extractRoadAddress('서울특별시 동대문구 왕산로 72, 101- 203호 (전농동, 래미안)'),
      '서울특별시 동대문구 왕산로 72');
    // 괄호 안 쉼표는 자르지 않는다
    assert.equal(extractRoadAddress('경기도 시흥시 정왕대로 1 (정왕동, 아파트)'),
      '경기도 시흥시 정왕대로 1 (정왕동, 아파트)');
    assert.equal(extractRoadAddress(''), '');
    assert.equal(extractRoadAddress(null), null);
  });

  test('문서 ID 는 슬래시만 치환하고 400자로 자른다', () => {
    assert.equal(addrToDocId('가/나/다'), '가_나_다');
    assert.equal(addrToDocId('가'.repeat(500)).length, 400);
    assert.equal(addrToDocId(''), '');
  });
});

describe('일괄 로드 조회 = 개별 조회와 같은 키', () => {
  test('같은 주소면 같은 항목을 찾는다', () => {
    const 주소 = '서울특별시 동대문구 왕산로 72, 101- 203호 (전농동, 래미안)';
    const key = addrToDocId(extractRoadAddress(주소));
    const map = new Map([[key, { lat: 37.5777, lng: 127.0314 }]]);
    const hit = lookupCoordInCache(map, 주소);
    assert.deepEqual(hit, { lat: 37.5777, lng: 127.0314 });
  });

  test('같은 건물의 다른 호수도 같은 키로 잡힌다(도로명까지만 쓰므로)', () => {
    const a = '서울특별시 동대문구 왕산로 72, 101- 203호 (전농동, 래미안)';
    const b = '서울특별시 동대문구 왕산로 72, 505호 (전농동, 래미안)';
    assert.equal(addrToDocId(extractRoadAddress(a)), addrToDocId(extractRoadAddress(b)));
  });

  test('없는 주소·빈 입력은 null (예외를 던지지 않는다)', () => {
    assert.equal(lookupCoordInCache(new Map(), '없는 주소 1'), null);
    assert.equal(lookupCoordInCache(null, '서울 어딘가 1'), null);
    assert.equal(lookupCoordInCache(new Map(), ''), null);
  });
});
