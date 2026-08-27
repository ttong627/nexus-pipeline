// 지자체 목록·이름 분해 회귀
//   node --test scripts/city-name.test.mjs
//
//   형 지시 2026-08-27: 동별 배송지도·배송일정 관리에서 **저장된 지자체**를 고르게 한다.
//   두 화면이 같은 목록을 쓰도록 SSOT 로 묶었으니, 그 규칙을 여기서 못 박는다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCityList, mergeCityLists, splitCityName } from '../src/utils/cityName.js';

describe('목록 정리', () => {
  test('공백·빈값·중복을 걸러 가나다로 세운다', () => {
    assert.deepEqual(
      normalizeCityList(['  경기도 시흥시 ', '', null, '서울특별시 동대문구', '경기도 시흥시']),
      ['경기도 시흥시', '서울특별시 동대문구'],
    );
  });
  test('빈 입력은 빈 배열', () => {
    assert.deepEqual(normalizeCityList(), []);
    assert.deepEqual(normalizeCityList(null), []);
  });
});

describe('승인 목록 + 저장된 지자체 합치기', () => {
  const saved = ['서울특별시 동대문구', '경기도 시흥시', '충청남도 천안시 동남구'];

  test('관리자는 저장된 전체를 본다 — 승인 목록이 비어 있어도(형 계정 실측 상황)', () => {
    // 이게 이번 사고의 뿌리다: 관리자 계정은 citiesApproved 가 비어 고를 것이 하나도 없었다.
    assert.deepEqual(mergeCityLists([], saved, true), normalizeCityList(saved));
  });

  test('관리자의 승인분도 빠뜨리지 않는다', () => {
    const r = mergeCityLists(['부산광역시 해운대구'], saved, true);
    assert.ok(r.includes('부산광역시 해운대구'));
    assert.equal(r.length, 4);
  });

  test('일반 담당자는 자기 승인 지자체만 본다(남의 지자체가 새면 안 된다)', () => {
    const r = mergeCityLists(['경기도 시흥시'], saved, false);
    assert.deepEqual(r, ['경기도 시흥시']);
  });

  test('명단이 있는 곳이 하나도 없으면 승인 목록을 그대로 준다', () => {
    const r = mergeCityLists(['강원특별자치도 원주시'], saved, false);
    assert.deepEqual(r, ['강원특별자치도 원주시']);
  });

  test('승인 정보가 없으면(설정 누락) 저장된 것이라도 고를 수 있게 한다', () => {
    assert.deepEqual(mergeCityLists([], saved, false), normalizeCityList(saved));
  });

  test('저장 목록을 못 읽어도(권한·오프라인) 승인분은 그대로 나온다', () => {
    assert.deepEqual(mergeCityLists(['경기도 시흥시'], [], false), ['경기도 시흥시']);
  });
});

describe('정규 지자체명 분해 (B-14 도 포함 풀네임)', () => {
  test('시/도 + 시/군/구', () => {
    assert.deepEqual(splitCityName('서울특별시 동대문구'), { sido: '서울특별시', sigungu: '동대문구' });
    assert.deepEqual(splitCityName('경기도 시흥시'), { sido: '경기도', sigungu: '시흥시' });
  });
  test('구가 딸린 시는 시·구를 함께 시/군/구로 둔다', () => {
    assert.deepEqual(splitCityName('충청남도 천안시 동남구'), { sido: '충청남도', sigungu: '천안시 동남구' });
  });
  test('광역단체 단독(세종)은 시/군/구가 없다 — G-1 이 지적한 그 형태', () => {
    assert.deepEqual(splitCityName('세종특별자치시'), { sido: '세종특별자치시', sigungu: '' });
  });
  test('앞뒤·중간 공백이 흐트러져도 같은 결과', () => {
    assert.deepEqual(splitCityName('  경기도   시흥시 '), { sido: '경기도', sigungu: '시흥시' });
  });
  test('빈값은 빈 조각', () => {
    assert.deepEqual(splitCityName(''), { sido: '', sigungu: '' });
    assert.deepEqual(splitCityName(null), { sido: '', sigungu: '' });
  });
});
