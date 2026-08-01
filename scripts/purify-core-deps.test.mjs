// purifyCore deps 주입 계약 검증 — node --test scripts/purify-core-deps.test.mjs
//
//   P7 Phase2 ⓒ-1에서 정제 본체(processAddress)를 클라 addressEngine.js에서
//   `services/address-service/src/shared/purifyCore.js`로 옮기고, 외부 의존을 deps로 분리했다.
//   이 테스트는 **서버가 쓸 수 있는 상태인지**를 클라 없이 증명한다:
//     ① firebase·Kakao·Vite 환경변수 없이 순수 Node에서 import·실행된다
//     ② IO를 전부 스텁으로 막아도(=오프라인) 규격화 결과가 나온다
//     ③ ★사전은 **호출 시점**에 읽힌다 — 비동기 로드가 끝난 뒤 호출한 정제에 반영돼야 한다
//
//   ③이 이 구조의 유일한 실질 위험이다. deps.dicts를 getter가 아니라 값으로 주입하면
//   사전 로드 이전의 빈 사전이 영구 고정돼, 학습 오타·별칭이 조용히 죽는다(화면엔 정상처럼 보임).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProcessAddress } from '../services/address-service/src/shared/purifyCore.js';

// 학습사전의 '현재 값'을 담는 통 — 실제 클라(addressEngine.js)의 모듈 스코프 변수에 해당한다.
const makeState = () => ({
  ready: Promise.resolve(),
  typoDict: {}, typoRegex: null, nameTypoDict: {}, specialCharRegex: null,
  buildingAliasDict: {}, buildingAliasVariantIndex: {},
  noteNormalizeDict: {}, noteNormalizeVariantIndex: {},
});

// 서버가 주입할 형태 그대로: IO는 스텁, dicts는 getter(호출 시점 값).
const makeDeps = (state, calls = []) => ({
  io: {
    lookupAddr: async (keyword) => { calls.push(keyword); return null; },
    searchKakaoFull: async () => null,
    fetchKakaoLegalDong: async () => null,
    fetchKakaoCoord: async () => null,
    fetchDongCoord: async () => null,
    parseAptDong: () => null,
  },
  side: { addSpecialChar: () => {} },   // 서버는 부수효과 no-op
  dicts: {
    get ready()                     { return state.ready; },
    get typoDict()                  { return state.typoDict; },
    get typoRegex()                 { return state.typoRegex; },
    get nameTypoDict()              { return state.nameTypoDict; },
    get specialCharRegex()          { return state.specialCharRegex; },
    get buildingAliasDict()         { return state.buildingAliasDict; },
    get buildingAliasVariantIndex() { return state.buildingAliasVariantIndex; },
    get noteNormalizeDict()         { return state.noteNormalizeDict; },
    get noteNormalizeVariantIndex() { return state.noteNormalizeVariantIndex; },
  },
});

test('① 코어는 firebase·환경변수 없이 순수 Node에서 실행된다(팩토리 계약)', () => {
  assert.equal(typeof createProcessAddress, 'function');
  assert.equal(typeof createProcessAddress(makeDeps(makeState())), 'function');
});

test('② IO 전부 실패(오프라인)여도 A-11 형식으로 규격화된다', async () => {
  const calls = [];
  const processAddress = createProcessAddress(makeDeps(makeState(), calls));
  const r = await processAddress('동대문구 왕산로 72, 201호', '홍길동', '용두동', '서울특별시 동대문구');
  assert.equal(r.주소, '왕산로 72, 201호');
  assert.equal(r.도로명주소, '왕산로 72');
  assert.equal(r.상세주소, '201호');
  assert.equal(r.확인필요, false, '도로명이 파싱되면 DB 미확인만으로 확인명단에 넣지 않는다(A-12)');
  // 지자체 토큰을 붙여 먼저 조회한다(A-13 오지역 매칭 방지)
  assert.ok(calls.includes('동대문구 왕산로 72'), `시군구 접두 조회가 없다: ${JSON.stringify(calls)}`);
});

test('③ ★사전은 호출 시점에 읽힌다 — 지연 로드가 반영돼야 한다', async () => {
  const state = makeState();
  const processAddress = createProcessAddress(makeDeps(state));

  const before = await processAddress('왕산로 72', '홍길동', '', '서울특별시 동대문구');
  assert.equal(before.정제된이름, '홍길동', '사전 로드 전에는 원본 이름');

  // 사전 로드 완료(클라: loadTypoDict가 모듈 변수에 채워 넣는 시점)
  state.nameTypoDict = { 홍길동: '홍길순' };

  const after = await processAddress('왕산로 72', '홍길동', '', '서울특별시 동대문구');
  assert.equal(after.정제된이름, '홍길순',
    '⚠️ deps.dicts를 값으로 주입하면 여기서 깨진다 — 반드시 getter로 주입할 것');
});

test('③-b 사전 준비(ready) 프로미스를 기다린 뒤 정제한다', async () => {
  const state = makeState();
  let resolved = false;
  state.ready = new Promise((r) => setTimeout(() => { state.nameTypoDict = { 홍길동: '홍길순' }; resolved = true; r(); }, 20));
  const processAddress = createProcessAddress(makeDeps(state));
  const r = await processAddress('왕산로 72', '홍길동', '', '서울특별시 동대문구');
  assert.equal(resolved, true, 'ready를 기다리지 않고 정제가 끝났다');
  assert.equal(r.정제된이름, '홍길순', 'ready 이후 채워진 사전이 반영돼야 한다');
});
