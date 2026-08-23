// A-37 한글 음역 영문동(에이동·비동·씨동·에이치동 …) = 건물 동(棟) 회귀 테스트
//   node --test scripts/translit-dong.test.mjs
//
// 형 지적(2026-08-23): "빌라나 아파트에 한글로 동이 붙으면 읍면동으로 인식하는 것 같아."
// 수정 전 실측(오프라인·스텁):
//   · `삼작로 12, 행복빌라 에이동 201호` → 상세 `201호` / 괄호 `(행복빌라 에이동)`   — 동이 상세에서 빠짐
//   · `삼작로 12, 201호 (행복빌라 에이동)` → 괄호 `(에이동, 행복빌라)`                 — 법정동 자리로 승격
//   · 주소DB 건물명이 다르면 `행복빌라 에이동` 통째로 특이사항 / 같으면 `에이동` 조용히 삭제
// 수정 후: `에이동`은 언제나 상세주소(`에이동 201호`)로 간다. 대조군(B동·가동)·실존 법정동(이동·지동)은 불변.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProcessAddress } from '../services/address-service/src/shared/purifyCore.js';
import { splitInlineBuildingTail } from '../services/address-service/src/shared/detailNormalize.js';
import {
  isTranslitBuildingDong, splitBuildingDongTail, TRANSLIT_DONG_STRICT, TRANSLIT_DONG_AMBIGUOUS,
} from '../services/address-service/src/shared/dongTokens.js';
import { sanitizeNote } from '../src/utils/noteSanitizer.js';

// ── 오프라인 정제기(외부 호출 0) — purify-core-deps.test.mjs 와 같은 주입 형태 ──
const state = {
  ready: Promise.resolve(), typoDict: {}, typoRegex: null, nameTypoDict: {}, specialCharRegex: null,
  buildingAliasDict: {}, buildingAliasVariantIndex: {}, noteNormalizeDict: {}, noteNormalizeVariantIndex: {},
};
const makeDeps = (lookupAddr = async () => null) => ({
  io: {
    lookupAddr, searchKakaoFull: async () => null, fetchKakaoLegalDong: async () => null,
    fetchKakaoCoord: async () => null, fetchDongCoord: async () => null, parseAptDong: () => null,
  },
  side: { addSpecialChar: () => {} },
  dicts: {
    get ready() { return state.ready; }, get typoDict() { return state.typoDict; }, get typoRegex() { return state.typoRegex; },
    get nameTypoDict() { return state.nameTypoDict; }, get specialCharRegex() { return state.specialCharRegex; },
    get buildingAliasDict() { return state.buildingAliasDict; }, get buildingAliasVariantIndex() { return state.buildingAliasVariantIndex; },
    get noteNormalizeDict() { return state.noteNormalizeDict; }, get noteNormalizeVariantIndex() { return state.noteNormalizeVariantIndex; },
  },
});
const offline = createProcessAddress(makeDeps());
const SIHEUNG = ['정왕동', '경기도 시흥시'];
const run = (addr, [adminDong, city] = SIHEUNG, pa = offline) => pa(addr, '홍길동', adminDong, city);

// 주소DB가 건물명을 돌려주는 경로(스텁) — 실제 응답 형태를 흉내 낸다
const withApi = (bdNm) => createProcessAddress(makeDeps(async () => ({
  roadAddrPart1: '경기도 시흥시 삼작로 12', roadAddr: '경기도 시흥시 삼작로 12', standardRoadAddress: '경기도 시흥시 삼작로 12',
  bdNm, bdKdcd: '0', legalDong: '정왕동', emdNm: '정왕동', matchedSido: '경기도', matchedSigungu: '시흥시',
  jibunAddr: '경기도 시흥시 정왕동 1234-5',
})));

// ── ① 토큰 판정 SSOT ──
test('A-37 strict 음역은 호수 없이도 건물 동, ambiguous(이·지·오·유)는 호수 동반 시에만', () => {
  for (const p of TRANSLIT_DONG_STRICT) assert.equal(isTranslitBuildingDong(`${p}동`), true, `${p}동`);
  for (const p of TRANSLIT_DONG_AMBIGUOUS) {
    assert.equal(isTranslitBuildingDong(`${p}동`), false, `${p}동 단독은 실존 법정동일 수 있다`);
    assert.equal(isTranslitBuildingDong(`${p}동`, ' 201호'), true, `${p}동 + 호수`);
    assert.equal(isTranslitBuildingDong(`${p}동`, ' 123-4'), false, `${p}동 + 지번은 법정동`);
  }
  assert.equal(isTranslitBuildingDong('정왕동'), false);
  assert.equal(isTranslitBuildingDong('가동'), false, '단일 한글동은 A-29 기존 규칙 소관');
});

test('A-37 splitBuildingDongTail — 음역동 분리 + 앞글자 가드 + guarded 경계', () => {
  assert.deepEqual(splitBuildingDongTail('행복빌라 에이동'), { head: '행복빌라', dong: '에이동' });
  assert.deepEqual(splitBuildingDongTail('행복빌라 에이치동 501호'), { head: '행복빌라', dong: '에이치동 501호' });
  assert.deepEqual(splitBuildingDongTail('푸르지오 101동'), { head: '푸르지오', dong: '101동' }, 'A-29 기존 동작 유지');
  assert.deepEqual(splitBuildingDongTail('행복빌라 이동 201호'), { head: '행복빌라', dong: '이동 201호' }, '단일 한글동+호');
  assert.equal(splitBuildingDongTail('행복빌라 가동'), null, '단일 한글동은 호수 없으면 분리 안 함(법정동 오인 방지)');
  assert.equal(splitBuildingDongTail('대비동'), null, '앞글자 가드 — 비동이 단어 일부');
  assert.equal(splitBuildingDongTail('정왕동'), null);
  // guarded: 괄호 문구에서 행정동·법정동을 잘라내지 않는다
  assert.equal(splitBuildingDongTail('답십리2동', { guarded: true }), null, '★행정동 번호를 건물동으로 오인 금지');
  assert.equal(splitBuildingDongTail('장안동 201호', { guarded: true }), null, '★법정동 뒤 호수를 안동 201호로 자르지 않는다');
  assert.deepEqual(splitBuildingDongTail('행복빌라 에이동', { guarded: true }), { head: '행복빌라', dong: '에이동' });
  assert.deepEqual(splitBuildingDongTail('행복빌라 B동', { guarded: true }), { head: '행복빌라', dong: 'B동' });
});

// ── ② 상세 분리(DONG_UNIT_SRC) ──
test('A-37 splitInlineBuildingTail — 음역동에서 건물명/상세가 갈린다', () => {
  assert.deepEqual(splitInlineBuildingTail('행복빌라 에이동 201호'), { inlineBuildingName: '행복빌라', detail: '에이동 201호' });
  assert.deepEqual(splitInlineBuildingTail('행복빌라 비동 301호'), { inlineBuildingName: '행복빌라', detail: '비동 301호' });
  assert.deepEqual(splitInlineBuildingTail('행복빌라 이동 201호'), { inlineBuildingName: '행복빌라', detail: '이동 201호' }, 'ambiguous+호');
  assert.deepEqual(splitInlineBuildingTail('신이동빌라 201호'), { inlineBuildingName: '신이동빌라', detail: '201호' }, '앞글자 가드');
  assert.deepEqual(splitInlineBuildingTail('행복빌라 B동 201호'), { inlineBuildingName: '행복빌라', detail: 'B동 201호' }, '대조군 불변');
});

// ── ③ 정제 전체 경로(오프라인) ──
test('A-37 정제: 빌라+음역동+호 → 상세주소에 동이 남고 괄호엔 건물명만', async () => {
  for (const [dong, ho] of [['에이동', '201호'], ['비동', '301호'], ['씨동', '401호'], ['에이치동', '501호'], ['디동', '102호']]) {
    const r = await run(`시흥시 삼작로 12, 행복빌라 ${dong} ${ho}`);
    assert.equal(r.상세주소, `${dong} ${ho}`, `${dong}: 상세주소`);
    assert.equal(r.괄호정보, '행복빌라', `${dong}: 괄호`);
    assert.equal(r.legalDong, '', `${dong}: 법정동 자리에 들어가면 안 된다`);
    assert.equal(r.주소, `삼작로 12, ${dong} ${ho} (행복빌라)`, `${dong}: A-11 형식`);
  }
});

test('A-37 정제: 괄호 안 `(행복빌라 에이동)` — 법정동 자리로 올라가지 않고 상세주소로', async () => {
  const r = await run('시흥시 삼작로 12, 201호 (행복빌라 에이동)');
  assert.equal(r.상세주소, '에이동 201호');
  assert.equal(r.괄호정보, '행복빌라');
  assert.ok(!/에이동/.test(r.괄호정보), '괄호에 에이동이 남으면 안 된다');
  const lone = await run('시흥시 삼작로 12, 201호 (에이동)');
  assert.equal(lone.상세주소, '에이동 201호');
  assert.equal(lone.괄호정보, '');
});

test('A-37 대조군: B동·가동은 기존 동작 그대로', async () => {
  const b = await run('시흥시 삼작로 12, 행복빌라 B동 201호');
  assert.equal(b.주소, '삼작로 12, B동 201호 (행복빌라)');
  const ga = await run('시흥시 삼작로 12, 행복빌라 가동 201호');
  assert.equal(ga.주소, '삼작로 12, 가동 201호 (행복빌라)');
});

test('A-37 실존 법정동 보호: 이동·지동은 지번·괄호에서 법정동으로 유지된다', async () => {
  const jibun = await run('안산시 상록구 이동 123-4 행복빌라 201호', ['이동', '경기도 안산시 상록구']);
  assert.equal(jibun.legalDong, '이동', '지번의 이동(법정동)은 그대로');
  const paren = await run('수원시 팔달구 수원천로 12, 201호 (지동, 행복빌라)', ['지동', '경기도 수원시 팔달구']);
  assert.equal(paren.괄호정보, '지동, 행복빌라');
  // 같은 글자라도 호수가 따르면 건물 동
  const bldg = await run('안산시 상록구 삼작로 12, 행복빌라 이동 201호', ['이동', '경기도 안산시 상록구']);
  assert.equal(bldg.상세주소, '이동 201호');
  assert.equal(bldg.괄호정보, '행복빌라');
});

// ── ④ 주소DB 건물명 채택 경로 — 형이 본 "특이사항으로 옮겨진다" ──
test('A-37 주소DB 건물명이 달라도 `에이동`은 특이사항이 아니라 상세주소로', async () => {
  const r = await withApi('행복주택')('시흥시 삼작로 12, 행복빌라 에이동 201호', '홍길동', '정왕동', '경기도 시흥시');
  assert.equal(r.상세주소, '에이동 201호');
  assert.equal(r.괄호정보, '정왕동, 행복주택');
  assert.ok(!/에이동/.test(r.특이사항 || ''), `특이사항에 에이동이 가면 안 된다: ${r.특이사항}`);
  assert.equal(r.특이사항, '행복빌라', '입력 건물명은 M-1대로 특이사항에 보존');
});

test('A-37 주소DB 건물명이 같으면 `에이동`이 조용히 삭제되지 않는다', async () => {
  const r = await withApi('행복빌라')('시흥시 삼작로 12, 행복빌라 에이동 201호', '홍길동', '정왕동', '경기도 시흥시');
  assert.equal(r.상세주소, '에이동 201호');
  assert.equal(r.괄호정보, '정왕동, 행복빌라');
  const paren = await withApi('행복빌라')('시흥시 삼작로 12, 201호 (행복빌라 에이동)', '홍길동', '정왕동', '경기도 시흥시');
  assert.equal(paren.상세주소, '에이동 201호', '건물명이 이미 있어 괄호를 버릴 때도 동은 건진다');
  // guarded: 괄호의 행정동·법정동을 상세로 끌어오지 않는다
  const admin = await withApi('행복빌라')('시흥시 삼작로 12, 201호 (답십리2동)', '홍길동', '정왕동', '경기도 시흥시');
  assert.equal(admin.상세주소, '201호', '★답십리2동의 2동을 건물동으로 오인 금지');
});

// ── ⑤ 특이사항 → 상세주소 승격(A-33 ②) ──
test('A-37 noteSanitizer: `에이동 201호` 메모는 상세주소 성분으로 승격된다', () => {
  const r = sanitizeNote('에이동 201호', { detailAddr: '' });
  assert.equal(r.detailAddr, '에이동 201호');
  assert.equal(r.note, '');
  const mixed = sanitizeNote('계단위 에이동 201호 정면', { detailAddr: '' });
  assert.equal(mixed.detailAddr, undefined, '메모가 섞이면 통째로 보내지 않는다(기존 원칙)');
});
