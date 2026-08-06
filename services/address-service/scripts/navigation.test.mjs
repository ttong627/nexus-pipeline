/**
 * 네비게이션 링크 검증 (모듈 ⑥).
 *
 * ★여기서 잡아야 하는 사고는 딱 두 가지다
 *   ① **좌표 순서 뒤바뀜** — T맵은 goalx=경도·goaly=위도다. 뒤집으면 기사가 바다로 간다.
 *      링크는 눌러보기 전까지 틀린 걸 알 수 없어서, 테스트가 아니면 현장에서 발견된다.
 *   ② **잘못된 좌표로 안내** — 좌표가 없거나 한국 밖인데 링크를 만들면, 기사는 그걸 믿고 출발한다.
 *      "검색해서 찾아가세요"가 "엉뚱한 곳으로 안내"보다 낫다.
 *
 * 실행: node --test scripts/navigation.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildNavigationLinks, navigationFromBrief } from '../src/routing/navigation.js';

/** 부천시청 부근(실재 좌표) */
const LAT = 37.5035;
const LNG = 126.7660;

test('링크가 전부 생성된다', () => {
  const out = buildNavigationLinks({ lat: LAT, lng: LNG, name: '부천시청' });
  assert.equal(out.ok, true);
  for (const k of ['kakaoWeb', 'googleWeb', 'tmapApp', 'naverApp', 'kakaoApp']) {
    assert.ok(out.links[k], `${k} 링크가 없다`);
  }
});

test('★T맵은 goalx=경도·goaly=위도 — 뒤집히면 기사가 바다로 간다', () => {
  const out = buildNavigationLinks({ lat: LAT, lng: LNG, name: '부천시청' });
  assert.ok(out.links.tmapApp.includes(`goalx=${LNG}`), '경도가 goalx 에 없다');
  assert.ok(out.links.tmapApp.includes(`goaly=${LAT}`), '위도가 goaly 에 없다');
  assert.ok(!out.links.tmapApp.includes(`goalx=${LAT}`), '위도가 goalx 에 들어갔다(뒤바뀜)');
});

test('네이버는 dlat=위도·dlng=경도', () => {
  const out = buildNavigationLinks({ lat: LAT, lng: LNG });
  assert.ok(out.links.naverApp.includes(`dlat=${LAT}`));
  assert.ok(out.links.naverApp.includes(`dlng=${LNG}`));
});

test('카카오 웹은 이름,위도,경도 순서', () => {
  const out = buildNavigationLinks({ lat: LAT, lng: LNG, name: '부천시청' });
  assert.ok(out.links.kakaoWeb.endsWith(`,${LAT},${LNG}`), out.links.kakaoWeb);
});

test('구글 웹은 destination=위도,경도', () => {
  const out = buildNavigationLinks({ lat: LAT, lng: LNG });
  assert.ok(out.links.googleWeb.includes(`destination=${LAT},${LNG}`));
});

test('★이름의 쉼표를 제거한다 — 카카오 링크 규격의 구분자다', () => {
  const out = buildNavigationLinks({ lat: LAT, lng: LNG, name: '가나빌라, 3동' });
  // 쉼표가 남으면 카카오가 이름/위도/경도 경계를 잘못 읽는다
  assert.equal(out.label.includes(','), false, `쉼표가 남았다: ${out.label}`);
  assert.ok(out.links.kakaoWeb.endsWith(`,${LAT},${LNG}`));
});

test('이름이 비면 기본값을 쓴다(빈 링크 방지)', () => {
  const out = buildNavigationLinks({ lat: LAT, lng: LNG });
  assert.equal(out.label, '배송지');
});

test('★좌표가 없으면 안내 링크를 만들지 않는다 — 검색 링크만 준다', () => {
  const out = buildNavigationLinks({ address: '경기 부천시 중동로 100' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'invalid_coordinate');
  assert.equal(out.links.kakaoWeb, undefined, '좌표 없이 길안내 링크를 만들면 안 된다');
  assert.ok(out.links.kakaoSearchWeb.includes(encodeURIComponent('경기 부천시 중동로 100')));
});

test('★한국 밖 좌표는 거부한다', () => {
  // 어제 출입구 적재에서 실제로 나온 오류 유형(경도 131도대 = 동해 한복판)은
  // 한국 범위 안이라 여기선 안 걸린다 — 그건 코어의 격리기가 잡는다.
  // 여기서 막는 건 명백한 좌표계 오지정(0,0·해외)이다.
  for (const [lat, lng] of [[0, 0], [37.5, 0], [51.5, -0.12], [null, null], ['a', 'b']]) {
    const out = buildNavigationLinks({ lat, lng, address: '어딘가' });
    assert.equal(out.ok, false, `거부되지 않았다: ${lat},${lng}`);
  }
});

test('아무 정보도 없으면 링크가 비어 있다(가짜 링크 금지)', () => {
  const out = buildNavigationLinks({});
  assert.equal(out.ok, false);
  assert.deepEqual(out.links, {});
});

/* ── 배송 브리프 연결 ─────────────────────────────── */

test('★브리프의 좌표를 그대로 쓰고 출처를 함께 알려준다', () => {
  const brief = {
    data: {
      address: { standardRoadAddress: '경기 부천시 중동로 100', buildingName: '중동빌딩' },
      coordinate: { lat: LAT, lng: LNG, kind: 'juso_entrance', label: '국가 출입구(측량)' },
      building: { building_name: '중동빌딩' },
    },
  };
  const out = navigationFromBrief(brief);
  assert.equal(out.ok, true);
  assert.equal(out.coordinateSource, 'juso_entrance');
  assert.equal(out.coordinateLabel, '국가 출입구(측량)');
  // ⚠️링크는 URL 인코딩된다 — 원문으로 비교하면 항상 실패한다(처음 그렇게 썼다).
  assert.ok(out.links.kakaoWeb.includes(encodeURIComponent('중동빌딩')), out.links.kakaoWeb);
  assert.equal(out.label, '중동빌딩');
});

test('추정 좌표면 그 사실이 드러난다 — 기사가 알아야 한다', () => {
  const brief = {
    data: {
      address: { standardRoadAddress: '경기 부천시 중동로 100' },
      coordinate: { lat: LAT, lng: LNG, kind: 'kakao', label: '카카오 추정' },
    },
  };
  const out = navigationFromBrief(brief);
  assert.equal(out.coordinateSource, 'kakao');
  assert.equal(out.coordinateLabel, '카카오 추정');
});

test('브리프가 degraded 여도 터지지 않는다', () => {
  const out = navigationFromBrief({ degraded: true, data: null });
  assert.equal(out.ok, false);
  assert.equal(out.coordinateSource, null);
});

test('★수령인 이름을 링크에 넣지 않는다(PII) — 호출부가 건물명·주소를 준다', () => {
  // 링크는 외부 앱으로 넘어가고 브라우저 히스토리에 남는다.
  const brief = {
    data: {
      address: { standardRoadAddress: '경기 부천시 중동로 100' },
      coordinate: { lat: LAT, lng: LNG, kind: 'juso_entrance' },
    },
  };
  const out = navigationFromBrief(brief);
  // 건물명이 없으면 주소를 쓴다 — 이름 필드로 폴백하지 않는다
  assert.ok(out.links.kakaoWeb.includes(encodeURIComponent('경기 부천시 중동로 100')));
});
