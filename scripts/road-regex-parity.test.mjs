// 도로명 정규식 클라↔서버 동기화 검증 — node --test scripts/road-regex-parity.test.mjs
//
//   배경(형 지적 2026-07-30): 도로명 파싱·오타보정 로직이 **클라(`src/engine/addressEngine.js`)와
//   서버(`services/address-service/src/normalize.js`) 양쪽에 복제**돼 있다. 한쪽만 고치면 조용히
//   갈라져 매칭률이 떨어지는데, 갈라진 사실 자체가 안 보인다.
//
//   이 테스트는 **규격화 서버 이관(P7)의 Phase 0 = 안전망**이다. 통합 전에 갈라짐을 먼저 감지한다.
//   두 파일의 정의를 소스에서 추출해 문자열로 비교한다(코드 실행 없이 — 클라는 firebase를
//   import해 node에서 실행 불가하므로 소스 대조가 유일하게 안전한 방법).
//
//   ⚠️ 실패하면 = 두 곳이 갈라졌다는 뜻. 어느 쪽이 맞는지 확인해 **양쪽을 같이** 고칠 것.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const CLIENT = new URL('../src/engine/addressEngine.js', import.meta.url);
const SERVER = new URL('../services/address-service/src/normalize.js', import.meta.url);

const read = (u) => readFileSync(u, 'utf8');

/** `const NAME =` 로 시작하는 정의의 값 부분을 추출(다음 최상위 const/export 전까지) */
const grabConst = (src, name) => {
  const re = new RegExp(`^const ${name}\\s*=\\s*([\\s\\S]*?);\\s*$`, 'm');
  const m = src.match(re);
  return m ? m[1].replace(/\s+/g, '') : null;
};

const client = read(CLIENT);
const server = read(SERVER);

test('BRANCH_SUFFIX(번길·가길 등 가지도로 접미사)가 클라·서버 동일', () => {
  const c = grabConst(client, 'BRANCH_SUFFIX');
  const s = grabConst(server, 'BRANCH_SUFFIX');
  assert.ok(c, '클라에서 BRANCH_SUFFIX를 찾지 못함 — 정의가 바뀌었으면 이 테스트도 갱신할 것');
  assert.ok(s, '서버에서 BRANCH_SUFFIX를 찾지 못함');
  assert.equal(c, s, '⚠️ 도로명 가지접미사가 클라·서버로 갈라졌다. 양쪽을 같이 고칠 것');
});

test('ROAD_NAME_SOURCE(도로명 본체 패턴)가 클라·서버 동일', () => {
  const c = grabConst(client, 'ROAD_NAME_SOURCE');
  const s = grabConst(server, 'ROAD_NAME_SOURCE');
  assert.ok(c && s, '정의를 찾지 못함');
  assert.equal(c, s, '⚠️ 도로명 본체 패턴이 클라·서버로 갈라졌다. 매칭률에 직접 영향');
});

test('공통 오타보정(재기로→제기로)이 양쪽에 모두 있다', () => {
  // 재기로 = 재기로, 제기로 = 제기로
  const hasClient = /\\uC7AC\\uAE30\\uB85C|재기로/.test(client);
  const hasServer = /\\uC7AC\\uAE30\\uB85C|재기로/.test(server);
  assert.equal(hasClient, true, '클라에 재기로 보정이 없다');
  assert.equal(hasServer, true, '⚠️ 서버에 재기로 보정이 없다 — 서버 직접 호출 경로(백필 등)에서 매칭 실패');
});

test('ROAD_ADDRESS_RE는 선행 구분자 처리만 다르다(의도된 차이 — 고정)', () => {
  // 클라는 문장 중간에서 도로명을 찾으므로 선행 구분자 캡처가 있고, 서버는 이미 정제된 질의를 받는다.
  // 이 차이는 의도적이다. 그 외 본문이 같은지만 확인한다.
  const pick = (src) => {
    const m = src.match(/^const ROAD_ADDRESS_RE\s*=\s*new RegExp\(`([\s\S]*?)`/m);
    return m ? m[1] : null;
  };
  const c = pick(client);
  const s = pick(server);
  assert.ok(c && s, '정의를 찾지 못함');
  const tail = (v) => v.slice(v.indexOf('${ROAD_NAME_SOURCE}')).replace(/\s+/g, '');
  assert.equal(tail(c), tail(s), '⚠️ 도로명+건물번호 매칭 본문이 갈라졌다');
});
