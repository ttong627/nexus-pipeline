// 도로명 토큰 SSOT 검증 — node --test scripts/road-regex-parity.test.mjs
//
//   배경(형 지적 2026-07-30): 도로명 파싱·오타보정이 클라(`src/engine/addressEngine.js`)와
//   서버(`services/address-service/src/normalize.js`) 양쪽에 **복제**돼 있어, 한쪽만 고치면
//   조용히 갈라져 매칭률이 떨어져도 원인이 안 보였다.
//
//   P7 Phase1에서 `services/address-service/src/shared/roadTokens.js` 단일 출처로 통합했다.
//   이 테스트는 **다시 갈라지는 것을 막는 잠금장치**다:
//     ① 공유 모듈이 실제로 동작하는가
//     ② 클라·서버가 각자 재정의하지 않고 **그 모듈을 import 하는가**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
  HANGUL, BRANCH_SUFFIX, ROAD_NAME_SOURCE, ROAD_NUMBER_TAIL, normalizeCommonRoadTypos,
} from '../services/address-service/src/shared/roadTokens.js';

// 클라 정제 경로 = addressEngine.js(IO·사전 주입 어댑터) + shared/purifyCore.js(코어).
// P7 Phase2 ⓒ-1에서 정제 본체가 코어로 이동했으므로 도로명 토큰 import도 코어가 갖는다.
const clientAdapter = readFileSync(new URL('../src/engine/addressEngine.js', import.meta.url), 'utf8');
const clientCore    = readFileSync(new URL('../services/address-service/src/shared/purifyCore.js', import.meta.url), 'utf8');
const client = `${clientAdapter}\n${clientCore}`;
const server = readFileSync(new URL('../services/address-service/src/normalize.js', import.meta.url), 'utf8');

// ── ① 공유 모듈 자체 동작 ──
test('공유 토큰으로 조립한 정규식이 도로명+건물번호를 매칭', () => {
  const re = new RegExp(`(${ROAD_NAME_SOURCE})${ROAD_NUMBER_TAIL}`, 'u');
  assert.equal('권선로 472'.match(re)?.[1], '권선로');
  assert.equal('사가정로2길 15'.match(re)?.[1], '사가정로2길');
  assert.equal('답십리로 303'.match(re)?.[1], '답십리로');
});

test('A-23 가지도로 접미사 — 번길이 길보다 먼저 잡힌다(순서 의존)', () => {
  const re = new RegExp(`[${HANGUL}A-Za-z0-9]+(?:\\uB300\\uB85C|\\uB85C)\\s*\\d+[${HANGUL}0-9]*${BRANCH_SUFFIX}`, 'u');
  assert.equal('사가정로25가길'.match(re)?.[0], '사가정로25가길');
  assert.equal('답십리로65번길'.match(re)?.[0], '답십리로65번길');
});

test('지하·부번 처리', () => {
  const re = new RegExp(`(${ROAD_NAME_SOURCE})${ROAD_NUMBER_TAIL}`, 'u');
  const m1 = '권선로 지하 472'.match(re);
  assert.ok(m1?.[2], '지하 접두를 인식해야 함');
  const m2 = '박석로25번길 32-5'.match(re);
  assert.equal(m2?.[4], '5', '부번을 인식해야 함');
});

test('공통 오타보정: 재기로 → 제기로', () => {
  assert.equal(normalizeCommonRoadTypos('재기로3길 5'), '제기로3길 5');
  assert.equal(normalizeCommonRoadTypos('재기로 12'), '제기로 12');
  // 뒤에 숫자/길이 없으면 건드리지 않는다(오적용 차단)
  assert.equal(normalizeCommonRoadTypos('재기로운생각'), '재기로운생각');
});

// ── ② 양쪽이 재정의하지 않고 SSOT를 쓰는가 (갈라짐 잠금) ──
// shared 내부(purifyCore) 에서는 './roadTokens.js', 바깥(서버 normalize.js·클라)에서는
// '.../shared/roadTokens.js' 로 들어온다. 파일명은 shared에만 존재하므로 이 매칭으로 충분하다.
const SHARED_IMPORT = /from\s+['"][^'"]*roadTokens\.js['"]/;

test('클라 정제 경로가 공유 토큰을 import 한다', () => {
  assert.match(client, SHARED_IMPORT, '⚠️ 클라가 SSOT를 안 쓴다 — 재복제되면 갈라진다');
});

test('클라 어댑터가 정제 본체를 공용 코어(purifyCore)에 위임한다', () => {
  assert.match(clientAdapter, /from\s+['"][^'"]*shared\/purifyCore\.js['"]/,
    '⚠️ 어댑터가 코어를 안 쓴다 — 코어를 복제하면 클라·서버가 갈라진다');
  assert.doesNotMatch(clientAdapter, /^export const processAddress = async \(/m,
    '⚠️ 어댑터에 정제 본체가 되살아났다 — 본체는 purifyCore.js 하나뿐이어야 한다');
});

test('서버(normalize.js)가 공유 토큰을 import 한다', () => {
  assert.match(server, SHARED_IMPORT, '⚠️ 서버가 SSOT를 안 쓴다 — 재복제되면 갈라진다');
});

test('클라·서버 어느 쪽도 도로명 토큰을 재정의하지 않는다', () => {
  for (const [name, src] of [['클라', client], ['서버', server]]) {
    assert.doesNotMatch(src, /^const BRANCH_SUFFIX\s*=/m, `⚠️ ${name}가 BRANCH_SUFFIX를 재정의했다 — SSOT 위반`);
    assert.doesNotMatch(src, /^const ROAD_NAME_SOURCE\s*=/m, `⚠️ ${name}가 ROAD_NAME_SOURCE를 재정의했다 — SSOT 위반`);
  }
});
