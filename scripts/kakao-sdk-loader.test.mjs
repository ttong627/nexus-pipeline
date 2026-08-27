// 카카오 지도 SDK 로더 회귀
//   node --test scripts/kakao-sdk-loader.test.mjs
//
//   왜 필요한가(2026-08-27): 지도가 안 뜨는 사고가 **두 번 연속** 로더에서 났다.
//     ①이미 로드된 태그에 `onload` 를 걸어 영원히 기다림 → 검은 화면 + 스피너
//     ②형이 쓰는 커스텀 도메인이 카카오 앱에 미등록이라 401 → 스크립트 error
//   화면을 안 그리는 스크립트는 이걸 못 잡는다(G-12). 최소한 로더의 결정 논리만이라도 못 박는다.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── 아주 작은 DOM 흉내 ────────────────────────────────────────────────────
//   실제 브라우저 검증은 E2E 가 한다. 여기서는 "언제 다시 싣고, 언제 우회하는가"만 본다.
let injected = [];      // 지금까지 만들어진 script 태그
let scriptById = new Map();

const makeScript = () => {
  const el = {
    tagName: 'SCRIPT', id: '', async: false, src: '', referrerPolicy: '',
    _handlers: {},
    addEventListener(type, fn) { (this._handlers[type] ||= []).push(fn); },
    remove() { if (this.id) scriptById.delete(this.id); },
    fire(type) { (this._handlers[type] || []).forEach((fn) => fn()); },
  };
  return el;
};

const setupDom = () => {
  injected = [];
  scriptById = new Map();
  globalThis.window = { kakao: undefined };
  globalThis.location = { host: 'narami.wssc.kr' };
  globalThis.document = {
    getElementById: (id) => scriptById.get(id) || null,
    createElement: () => makeScript(),
    head: {
      appendChild(el) {
        injected.push(el);
        if (el.id) scriptById.set(el.id, el);
        // 다음 tick 에 테스트가 load/error 를 직접 쏜다
      },
    },
  };
};

/** 스크립트가 성공적으로 내려온 상황 — kakao 전역을 만들고 load 를 성공시킨다 */
const succeed = (el, { clusterer = true } = {}) => {
  const libs = /libraries=([^&]*)/.exec(el.src)?.[1] || '';
  globalThis.window.kakao = {
    maps: {
      Map: function Map() {},
      load: (cb) => cb(),
      ...(libs.includes('clusterer') && clusterer ? { MarkerClusterer: function C() {} } : {}),
    },
  };
  el.fire('load');
};

const load = async (mod, libs) => {
  const p = mod.loadKakaoMapsSdk('KEY', libs);
  return p;
};

let mod;
beforeEach(async () => {
  setupDom();
  mod = await import(`../src/utils/kakaoSdk.js?v=${Math.random()}`);
});

describe('이미 준비된 SDK', () => {
  test('kakao.maps.Map 과 라이브러리가 있으면 스크립트를 새로 넣지 않는다', async () => {
    globalThis.window.kakao = { maps: { Map: function M() {}, load: (cb) => cb(), MarkerClusterer: function C() {} } };
    await mod.loadKakaoMapsSdk('KEY', ['clusterer']);
    assert.equal(injected.length, 0, '이미 준비됐는데 다시 실었다');
  });
});

describe('첫 로드', () => {
  test('정상 경로는 referrerPolicy 를 건드리지 않는다(도메인 제한을 그대로 둔다)', async () => {
    const p = load(mod, ['clusterer']);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(injected.length, 1);
    assert.equal(injected[0].referrerPolicy, '', '1차부터 우회하면 도메인 제한이 무의미해진다');
    assert.match(injected[0].src, /^https:\/\/dapi\.kakao\.com/, 'http 미리보기에서 막히지 않도록 https 고정');
    assert.match(injected[0].src, /libraries=clusterer/);
    assert.match(injected[0].src, /autoload=false/);
    succeed(injected[0]);
    await p;
  });
});

describe('K-1 도메인 미등록(401) 우회', () => {
  test('스크립트가 error 나면 referrer 없이 한 번 더 시도한다', async () => {
    const p = load(mod, ['clusterer']);
    await new Promise((r) => setTimeout(r, 0));
    injected[0].fire('error');                       // 카카오 401 → error 이벤트
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(injected.length, 2, '우회 재시도를 하지 않았다');
    assert.equal(injected[1].referrerPolicy, 'no-referrer');
    succeed(injected[1]);
    await p;                                          // 최종적으로 성공해야 한다
  });

  test('우회로도 실패하면 에러를 던진다(조용히 성공한 척하지 않는다)', async () => {
    const p = load(mod, ['clusterer']);
    await new Promise((r) => setTimeout(r, 0));
    injected[0].fire('error');
    await new Promise((r) => setTimeout(r, 0));
    injected[1].fire('error');
    await assert.rejects(p, /KAKAO_SDK_BLOCKED/);
  });

  test('한 번 우회가 필요했던 도메인은 다음부터 바로 우회로로 간다(헛수고 1회 제거)', async () => {
    const p1 = load(mod, ['clusterer']);
    await new Promise((r) => setTimeout(r, 0));
    injected[0].fire('error');
    await new Promise((r) => setTimeout(r, 0));
    succeed(injected[1]);
    await p1;
    // 두 번째 화면이 services 를 추가로 요구 → 다시 실을 때 처음부터 no-referrer
    globalThis.window.kakao = undefined;
    const p2 = load(mod, ['services']);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(injected[2].referrerPolicy, 'no-referrer');
    succeed(injected[2]);
    await p2;
  });
});

describe('K-2 라이브러리', () => {
  test('먼저 clusterer 없이 실렸으면 루트맵 요청 때 다시 싣는다', async () => {
    const p1 = load(mod, []);                        // 기사화면: 라이브러리 없음
    await new Promise((r) => setTimeout(r, 0));
    succeed(injected[0]);
    await p1;
    assert.ok(!globalThis.window.kakao.maps.MarkerClusterer);

    const p2 = load(mod, ['clusterer']);             // 루트맵: clusterer 필요
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(injected.length, 2, 'clusterer 가 없는데 그냥 통과시켰다');
    assert.match(injected[1].src, /libraries=clusterer/);
    succeed(injected[1]);
    await p2;
    assert.ok(globalThis.window.kakao.maps.MarkerClusterer);
  });

  test('다시 실을 때 앞서 요청된 라이브러리를 잃지 않는다', async () => {
    const p1 = load(mod, ['clusterer']);
    await new Promise((r) => setTimeout(r, 0));
    succeed(injected[0]);
    await p1;
    globalThis.window.kakao = undefined;             // 세션 중 전역이 날아간 상황
    const p2 = load(mod, ['services']);
    await new Promise((r) => setTimeout(r, 0));
    assert.match(injected[1].src, /libraries=clusterer,services|libraries=services,clusterer/);
    succeed(injected[1]);
    await p2;
  });
});

describe('실패 후 재시도', () => {
  test('앞선 호출이 실패해도 다음 호출은 새로 시도한다(체인이 오염되지 않는다)', async () => {
    const p1 = load(mod, ['clusterer']);
    await new Promise((r) => setTimeout(r, 0));
    injected[0].fire('error');
    await new Promise((r) => setTimeout(r, 0));
    injected[1].fire('error');
    await assert.rejects(p1);

    const p2 = load(mod, ['clusterer']);
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(injected.length >= 3, '두 번째 호출이 아무 시도도 하지 않았다');
    succeed(injected[injected.length - 1]);
    await p2;
  });

  test('키가 없으면 명확히 알린다', async () => {
    await assert.rejects(mod.loadKakaoMapsSdk('', ['clusterer']), /VITE_KAKAO_JS_KEY/);
  });
});
