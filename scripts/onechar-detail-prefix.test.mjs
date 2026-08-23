// A-38 마커 앞 한 글자 한글 토큰 = 상세주소 회귀 테스트
//   node --test scripts/onechar-detail-prefix.test.mjs
//
// 실측(2026-08-23 · 품질모니터 08-17 '괄호잡값 +19' 추적): 동대문구 2026-08 명단 19건 전부
//   `반지층 1호`→ 괄호 `(제기동, 반)` / `비02호`→`(회기동, 비)` / `지01호`→`(전농동, 지)` /
//   `나1호 뒷편`→`(용두동, 나)` / `좌1층 뒷쪽`→`(용두동, 좌)` / `반지하`→`(용두동, 반)`.
//   splitInlineBuildingTail 이 첫 상세 마커(지하·지층·N호·N층)에서 자르면서 바로 앞에 붙은 한 글자가
//   건물명 슬롯에 남았다. 반지층·B호 정보가 상세주소에서 사라지는 손실이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProcessAddress } from '../services/address-service/src/shared/purifyCore.js';
import { splitInlineBuildingTail } from '../services/address-service/src/shared/detailNormalize.js';

const state = {
  ready: Promise.resolve(), typoDict: {}, typoRegex: null, nameTypoDict: {}, specialCharRegex: null,
  buildingAliasDict: {}, buildingAliasVariantIndex: {}, noteNormalizeDict: {}, noteNormalizeVariantIndex: {},
};
const deps = {
  io: {
    lookupAddr: async () => null, searchKakaoFull: async () => null, fetchKakaoLegalDong: async () => null,
    fetchKakaoCoord: async () => null, fetchDongCoord: async () => null, parseAptDong: () => null,
  },
  side: { addSpecialChar: () => {} },
  dicts: {
    get ready() { return state.ready; }, get typoDict() { return state.typoDict; }, get typoRegex() { return state.typoRegex; },
    get nameTypoDict() { return state.nameTypoDict; }, get specialCharRegex() { return state.specialCharRegex; },
    get buildingAliasDict() { return state.buildingAliasDict; }, get buildingAliasVariantIndex() { return state.buildingAliasVariantIndex; },
    get noteNormalizeDict() { return state.noteNormalizeDict; }, get noteNormalizeVariantIndex() { return state.noteNormalizeVariantIndex; },
  },
};
const pa = createProcessAddress(deps);
const run = (addr) => pa(addr, '홍길동', '', '서울특별시 동대문구');

test('A-38 splitInlineBuildingTail — 마커에 붙은 한 글자는 상세로', () => {
  assert.deepEqual(splitInlineBuildingTail('반지층 1호'), { inlineBuildingName: '', detail: '반지층 1호' });
  assert.deepEqual(splitInlineBuildingTail('반지하 102호'), { inlineBuildingName: '', detail: '반지하 102호' });
  assert.deepEqual(splitInlineBuildingTail('비02호'), { inlineBuildingName: '', detail: '비02호' });
  assert.deepEqual(splitInlineBuildingTail('지01호'), { inlineBuildingName: '', detail: '지01호' });
  assert.deepEqual(splitInlineBuildingTail('나1호 뒷편'), { inlineBuildingName: '', detail: '나1호 뒷편' });
  assert.deepEqual(splitInlineBuildingTail('좌1층 뒷쪽'), { inlineBuildingName: '', detail: '좌1층 뒷쪽' });
  assert.deepEqual(splitInlineBuildingTail('행복빌라 반지하 102호'), { inlineBuildingName: '행복빌라', detail: '반지하 102호' }, '건물명 뒤 한 글자 토큰');
  assert.deepEqual(splitInlineBuildingTail('행복빌라 비02호'), { inlineBuildingName: '행복빌라', detail: '비02호' });
});

test('A-38 경계: 붙어 있지 않은 한 글자·두 글자 이상 건물명은 그대로', () => {
  assert.deepEqual(splitInlineBuildingTail('행복빌라101호'), { inlineBuildingName: '행복빌라', detail: '101호' }, '붙여 쓴 건물명은 그대로 분리');
  assert.deepEqual(splitInlineBuildingTail('신 101호'), { inlineBuildingName: '신', detail: '101호' }, '공백으로 떨어진 한 글자는 건드리지 않는다');
  assert.deepEqual(splitInlineBuildingTail('행복빌라 B동 201호'), { inlineBuildingName: '행복빌라', detail: 'B동 201호' });
  assert.deepEqual(splitInlineBuildingTail('행복빌라 에이동 201호'), { inlineBuildingName: '행복빌라', detail: '에이동 201호' }, 'A-37 유지');
  assert.deepEqual(splitInlineBuildingTail('지하 102호'), { inlineBuildingName: '', detail: '지하 102호' });
});

test('A-38 정제 전체 경로 — 괄호에 한 글자 파편이 남지 않는다(동대문구 08 실측 재현)', async () => {
  const cases = [
    ['동대문구 고산자로54길 46 반지층 1호', '반지층', '반'],
    ['동대문구 회기로12길 27-9 비02호', '비02호', '비'],
    ['동대문구 답십리로23길 98-6 지01호', '지01호', '지'],
    ['동대문구 무학로34길 17 나1호 뒷편', '나1호', '나'],
    ['동대문구 천호대로23길 29 좌1층 뒷쪽', '좌1층', '좌'],
    ['동대문구 왕산로32길 90 반지하', '반지하', '반'],
    ['동대문구 왕산로 72 행복빌라 반지하 102호', '반지하', '반'],
  ];
  for (const [addr, mustInDetail, frag] of cases) {
    const r = await run(addr);
    assert.ok(r.상세주소.includes(mustInDetail), `${addr}: 상세=${r.상세주소}`);
    assert.notEqual(r.괄호정보, frag, `${addr}: 괄호에 파편 '${frag}' — ${r.주소}`);
    assert.ok(!new RegExp(`(^|, )${frag}$`).test(r.괄호정보), `${addr}: 괄호 끝에 파편 — ${r.괄호정보}`);
  }
  const bld = await run('동대문구 왕산로 72 행복빌라 반지하 102호');
  assert.equal(bld.괄호정보, '행복빌라');
});

test('A-18 연동: `제101동 제205호` — 제(第)가 건물명 슬롯으로 새지 않고 상세에서 제거된다', async () => {
  // 예전엔 `제`가 괄호 건물명으로 빠져(골든 A18 buildingName:"제") A-18 의 `\b` 결함이 숨어 있었다.
  const r = await pa('권선구 권선로 472, 제101동 제205호', '홍길동', '', '경기도 수원시 권선구');
  assert.equal(r.주소, '권선로 472, 101- 205호');
  assert.equal(r.괄호정보, '');
  const attached = await pa('권선구 권선로 472, 제101동205호', '홍길동', '', '경기도 수원시 권선구');
  assert.equal(attached.주소, '권선로 472, 101- 205호', '붙여 쓴 형태(A-19)도 동일');
  const guard = await pa('동대문구 왕산로 72, 국제101호', '홍길동', '', '서울특별시 동대문구');
  assert.ok(guard.주소.includes('국제'), `앞 경계 — 국제101호의 제는 건드리지 않는다: ${guard.주소}`);
});
