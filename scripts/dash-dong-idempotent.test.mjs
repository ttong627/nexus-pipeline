// A-10 ③ 멱등 회귀 — 1~2자리 동의 대시 표기(`3- 302호`·`10-1203호`·`3-302호`)를 다시 읽는다
//   node --test scripts/dash-dong-idempotent.test.mjs
//
// 실측(2026-08-23 · 동대문구 08 재정제 dry-run): `답십리로 184, 3- 302호 (답십리동, 동서울한양아파트)` 를 다시 정제하면
//   `302호`가 되고 동 `3-` 는 특이사항으로 밀렸다. `DONG_DASH_HO_SRC`·`DASH_HO_RE` 가 동 3~4자리만 알아서
//   우리가 만든 출력(`3- 302호`)을 상세 시작으로 못 보고 건물명 슬롯으로 보냈기 때문.
//   (같은 날 정정) 동 자리수는 가드가 아니다 — **동 1~4자리 + 호 3~4자리 + `호`**. 지번 부번·다가구 호수(`1-2호`·`40-25호`)는
//   호가 1~2자리라 여전히 미개입. 상세 회귀는 dash-dong-parse.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDongHoDetail } from '../services/address-service/src/shared/dongHoFormat.js';
import { splitInlineBuildingTail } from '../services/address-service/src/shared/detailNormalize.js';
import { createProcessAddress } from '../services/address-service/src/shared/purifyCore.js';

const state = {
  ready: Promise.resolve(), typoDict: {}, typoRegex: null, nameTypoDict: {}, specialCharRegex: null,
  buildingAliasDict: {}, buildingAliasVariantIndex: {}, noteNormalizeDict: {}, noteNormalizeVariantIndex: {},
};
const mkDeps = (lookupAddr = async () => null) => ({
  io: { lookupAddr, searchKakaoFull: async () => null, fetchKakaoLegalDong: async () => null, fetchKakaoCoord: async () => null, fetchDongCoord: async () => null, parseAptDong: () => null },
  side: { addSpecialChar: () => {} },
  dicts: {
    get ready() { return state.ready; }, get typoDict() { return state.typoDict; }, get typoRegex() { return state.typoRegex; },
    get nameTypoDict() { return state.nameTypoDict; }, get specialCharRegex() { return state.specialCharRegex; },
    get buildingAliasDict() { return state.buildingAliasDict; }, get buildingAliasVariantIndex() { return state.buildingAliasVariantIndex; },
    get noteNormalizeDict() { return state.noteNormalizeDict; }, get noteNormalizeVariantIndex() { return state.noteNormalizeVariantIndex; },
  },
});
const offline = createProcessAddress(mkDeps());
const withApi = createProcessAddress(mkDeps(async () => ({
  roadAddrPart1: '서울특별시 동대문구 답십리로 184', roadAddr: '서울특별시 동대문구 답십리로 184', standardRoadAddress: '서울특별시 동대문구 답십리로 184',
  bdNm: '동서울한양아파트', bdKdcd: '1', legalDong: '답십리동', emdNm: '답십리동', matchedSido: '서울특별시', matchedSigungu: '동대문구', jibunAddr: '서울특별시 동대문구 답십리동 1',
})));
const DDM = ['', '서울특별시 동대문구'];

test('A-10 ③ normalizeDongHoDetail — 1~2자리 동 자기 출력형은 멱등', () => {
  assert.equal(normalizeDongHoDetail('3동 302호'), '3- 302호');
  assert.equal(normalizeDongHoDetail('3- 302호'), '3- 302호', '출력을 다시 넣어도 불변');
  assert.equal(normalizeDongHoDetail('10동 1203호'), '10-1203호');
  assert.equal(normalizeDongHoDetail('10-1203호'), '10-1203호');
  assert.equal(normalizeDongHoDetail('5-1003호'), '5-1003호');
  assert.equal(normalizeDongHoDetail('101- 203호'), '101- 203호', '기존 3자리 동 멱등 유지');
});

test('A-10 ③ 미개입 유지 — 호 1~2자리(지번 부번·다가구 호수)는 동으로 보지 않는다', () => {
  assert.equal(normalizeDongHoDetail('1-2호'), '1-2호');
  assert.equal(normalizeDongHoDetail('40-25호'), '40-25호');
  assert.equal(normalizeDongHoDetail('19-3호'), '19-3호');
  // (2026-08-23 정정) 동 자리수는 가드가 아니다 — `12-301호`·`3-3층 302호`도 호 3~4자리면 숫자 동이다
  assert.equal(normalizeDongHoDetail('12-301호'), '12- 301호');
  assert.equal(normalizeDongHoDetail('3-3층 302호'), '3- 302호 3층');
});

test('A-10 ③ splitInlineBuildingTail — 자기 출력형은 상세 시작으로 인식(건물명 슬롯으로 새지 않는다)', () => {
  assert.deepEqual(splitInlineBuildingTail('3- 302호'), { inlineBuildingName: '', detail: '3- 302호' });
  assert.deepEqual(splitInlineBuildingTail('10-1203호'), { inlineBuildingName: '', detail: '10-1203호' });
  assert.deepEqual(splitInlineBuildingTail('동서울한양아파트 3- 302호'), { inlineBuildingName: '동서울한양아파트', detail: '3- 302호' });
});

test('A-10 ③ 정제 멱등 — 저장된 주소를 다시 정제해도 동이 사라지지 않는다(오프라인·DB 매칭 양쪽)', async () => {
  const saved = '답십리로 184, 3- 302호 (답십리동, 동서울한양아파트)';
  const a = await offline(`동대문구 ${saved}`, '홍길동', ...DDM);
  assert.equal(a.주소, saved);
  const b = await withApi(`동대문구 ${saved}`, '홍길동', ...DDM);
  assert.equal(b.주소, saved);
  assert.equal(b.특이사항, '', '동 조각이 특이사항으로 밀리면 안 된다');
  const c = await offline('동대문구 한천로 224, 10-1203호 (장안동, 현대아파트)', '홍길동', ...DDM);
  assert.equal(c.주소, '한천로 224, 10-1203호 (장안동, 현대아파트)');
  const first = await offline('동대문구 답십리로 184, 3동 302호', '홍길동', ...DDM);
  assert.equal(first.주소, '답십리로 184, 3- 302호', '첫 정제 형식은 그대로');
});
