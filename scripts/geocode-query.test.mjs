// ══════════════════════════════════════════════════════════════════
//  지오코딩 질의문 회귀 — functions/geocodeQuery.js (2026-08-12)
//
//  ★막는 사고: 정제가 실패한 주소의 **도로명 조각**을 그대로 지오코딩에 보내
//    전국에서 아무 데나 맞은 좌표가 명단에 저장되던 것.
//    실측(시흥 2026-07 명단): `매화로 53` → 성남 분당(31km) · `1길 17` → 다른 도(201km).
//    저장 시 `좌표상태='좌표확인'` 이 붙어 화면에선 정상으로 보였다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mod from '../functions/geocodeQuery.js';

const { buildGeocodeQuery } = mod;

// ── ① 조각에는 지자체를 붙인다 (이 사고의 핵심) ────────────────────
test('★도로명 조각에는 시도·시군구를 붙인다 — 안 붙이면 전국에서 아무 데나 맞는다', () => {
  assert.equal(buildGeocodeQuery('매화로 53', '경기도', '시흥시'), '경기도 시흥시 매화로 53');
  assert.equal(buildGeocodeQuery('봉우재로 36', '경기도', '시흥시'), '경기도 시흥시 봉우재로 36');
  assert.equal(buildGeocodeQuery('1길 17', '경기도', '시흥시'), '경기도 시흥시 1길 17');
});

test('일반구가 있는 지자체도 그대로 붙인다', () => {
  assert.equal(buildGeocodeQuery('둔촌대로 45', '경기도', '성남시 중원구'), '경기도 성남시 중원구 둔촌대로 45');
});

// ── ② 이미 온전한 주소는 건드리지 않는다 ──────────────────────────
test('★정제주소는 이미 지역을 포함한다 — 또 붙이면 매칭이 깨진다', () => {
  const std = '경기도 시흥시 봉우재로61번길 18-4';
  assert.equal(buildGeocodeQuery(std, '경기도', '시흥시'), std);
});

test('시도만 같아도(시군구 표기가 달라도) 중복으로 붙이지 않는다', () => {
  const std = '경기도 시흥시 정왕대로 233';
  assert.equal(buildGeocodeQuery(std, '경기도', '시흥시'), std);
  // 시군구 문자열이 조금 달라도 시도로 시작하면 온전한 주소로 본다
  assert.equal(buildGeocodeQuery('충청남도 천안시 동남구 동면 화복로 228-14', '충청남도', '천안시 동남구'),
    '충청남도 천안시 동남구 동면 화복로 228-14');
});

// ── ③ 지자체를 모르면 조회하지 않는다 ────────────────────────────
test('★지자체를 모르면 빈 문자열 — 조각을 그대로 보내지 않는다', () => {
  assert.equal(buildGeocodeQuery('매화로 53', '', ''), '');
  assert.equal(buildGeocodeQuery('매화로 53', null, undefined), '');
});

test('지자체를 몰라도 주소가 이미 온전하면 그대로 보낸다', () => {
  assert.equal(buildGeocodeQuery('경기도 시흥시 매화로 53', '', ''), '경기도 시흥시 매화로 53');
});

// ── ④ 방어 ───────────────────────────────────────────────────────
test('도로명이 비면 빈 문자열 — 호출부가 조회를 건너뛴다', () => {
  assert.equal(buildGeocodeQuery('', '경기도', '시흥시'), '');
  assert.equal(buildGeocodeQuery(null, '경기도', '시흥시'), '');
  assert.equal(buildGeocodeQuery(undefined, '경기도', '시흥시'), '');
});

test('공백이 지저분해도 하나로 정리한다 — 질의문 흔들림이 캐시 미스를 만든다', () => {
  assert.equal(buildGeocodeQuery('  매화로   53 ', ' 경기도 ', ' 시흥시 '), '경기도 시흥시 매화로 53');
});
