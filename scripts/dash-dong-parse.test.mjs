// 동 "-" 조각 특이사항 이동 결함 완전 해소 회귀 (2026-08-23 · 형 지시)
//   node --test scripts/dash-dong-parse.test.mjs
//
// 뿌리 두 겹: ①건물명 슬롯이 숫자·대시만(`3-`·`1-`)이어도 허용돼 M-1 보존 경로로 특이사항에 남았다(실측 3건)
//             ②대시 동 인식이 3~4자리 동만이라 1~2자리 동(전 명단 4,752건)을 다시 못 읽었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitInlineBuildingTail } from '../services/address-service/src/shared/detailNormalize.js';
import { normalizeDongHoDetail } from '../services/address-service/src/shared/dongHoFormat.js';
import { parseAptDong } from '../services/address-service/src/routing/routeSequenceEngine.js';
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
// 주소DB가 건물명을 주는 경로 — 이 경로가 `3-`를 특이사항으로 밀어내던 자리(M-1 보존)
const withApi = createProcessAddress(mkDeps(async () => ({
  roadAddrPart1: '서울특별시 동대문구 답십리로 184', roadAddr: '서울특별시 동대문구 답십리로 184', standardRoadAddress: '서울특별시 동대문구 답십리로 184',
  bdNm: '동서울한양아파트', bdKdcd: '1', legalDong: '답십리동', emdNm: '답십리동', matchedSido: '서울특별시', matchedSigungu: '동대문구', jibunAddr: '서울특별시 동대문구 답십리동 1',
})));
const DDM = ['홍길동', '', '서울특별시 동대문구'];

test('① 건물명 슬롯은 숫자·대시만으로 이뤄질 수 없다 — 마커 앞 `3-`·`1-`·`3`은 상세의 일부', () => {
  assert.deepEqual(splitInlineBuildingTail('3-302호'), { inlineBuildingName: '', detail: '3-302호' });
  assert.deepEqual(splitInlineBuildingTail('3 - 302호'), { inlineBuildingName: '', detail: '3 - 302호' });
  assert.deepEqual(splitInlineBuildingTail('1-2호'), { inlineBuildingName: '', detail: '1-2호' }, '다가구 호수도 쪼개지 않는다');
  assert.deepEqual(splitInlineBuildingTail('12-301호'), { inlineBuildingName: '', detail: '12-301호' });
  assert.deepEqual(splitInlineBuildingTail('3 302호'), { inlineBuildingName: '', detail: '3 302호' }, '숫자만 남아도 건물명이 아니다');
  assert.deepEqual(splitInlineBuildingTail('행복빌라 3-302호'), { inlineBuildingName: '행복빌라', detail: '3-302호' }, '진짜 건물명은 그대로');
});

test('①-b 영문·한글 대시 동(`A-302호`·`가-102호`·`지-3호`)도 건물명 슬롯으로 새지 않는다(전 명단 414건 실측 형태)', async () => {
  assert.deepEqual(splitInlineBuildingTail('A-302호'), { inlineBuildingName: '', detail: 'A-302호' });
  assert.deepEqual(splitInlineBuildingTail('가-102호'), { inlineBuildingName: '', detail: '가-102호' });
  assert.deepEqual(splitInlineBuildingTail('지-3호'), { inlineBuildingName: '', detail: '지-3호' });
  assert.deepEqual(splitInlineBuildingTail('행복빌라 A-302호'), { inlineBuildingName: '행복빌라', detail: 'A-302호' });
  assert.deepEqual(splitInlineBuildingTail('행복빌라 B-1203호'), { inlineBuildingName: '행복빌라', detail: 'B-1203호' });
  assert.deepEqual(splitInlineBuildingTail('행복빌라A-302호'), { inlineBuildingName: '행복빌라', detail: 'A-302호' }, '공백 없이 붙은 영문 대시 동');
  assert.deepEqual(splitInlineBuildingTail('201호- 스마일부동산 302호'), { inlineBuildingName: '', detail: '201호- 스마일부동산 302호' }, '`호-`는 동 조각이 아니다');
  assert.deepEqual(splitInlineBuildingTail('대한-302호'), { inlineBuildingName: '', detail: '대한-302호' }, '한글 1~3자 토큰(공백·시작 경계)은 조각');
  assert.deepEqual(splitInlineBuildingTail('대한빌라-302호'), { inlineBuildingName: '대한빌라', detail: '302호' }, '4자 이상 한글은 건물명(끝 대시만 제거)');
  assert.deepEqual(splitInlineBuildingTail('SKVIEW-302호'), { inlineBuildingName: 'SKVIEW', detail: '302호' }, '긴 영문은 찢지 않고 끝 대시만 제거');
  assert.deepEqual(splitInlineBuildingTail('LOTTE-1203호'), { inlineBuildingName: 'LOTTE', detail: '1203호' });
  assert.deepEqual(splitInlineBuildingTail('AB12-302호'), { inlineBuildingName: '', detail: 'AB12-302호' }, '4자 이하 영숫자 토큰은 조각');
  assert.deepEqual(splitInlineBuildingTail('에이-402호'), { inlineBuildingName: '', detail: '에이-402호' }, '2자 한글 음역 동');
  assert.deepEqual(splitInlineBuildingTail('가동-402호'), { inlineBuildingName: '', detail: '가동-402호' });
  assert.deepEqual(splitInlineBuildingTail('상가- 205호 2층'), { inlineBuildingName: '', detail: '상가- 205호 2층' });
  assert.deepEqual(splitInlineBuildingTail('B1-302호'), { inlineBuildingName: '', detail: 'B1-302호' }, '좌측 경계 — B를 건물명으로 떼고 1동으로 오인하지 않는다');
  assert.deepEqual(splitInlineBuildingTail('3-'), { inlineBuildingName: '', detail: '3-' }, '마커 없는 꼬리도 건물명이 아니다');
  assert.deepEqual(splitInlineBuildingTail('101-203'), { inlineBuildingName: '', detail: '101-203' });
  assert.deepEqual(splitInlineBuildingTail('행복빌라 3-'), { inlineBuildingName: '행복빌라', detail: '3-' });
});

test('①-c 괄호 안에 떨어진 조각 `(답십리동, 2-)`은 상세로 되돌린다(실데이터 18건 형태 · API 경로에서 조용히 소실되던 것)', async () => {
  const a = await offline('동대문구 고미술로 21, 709호 (답십리동, 2-)', ...DDM);
  assert.equal(a.주소, '고미술로 21, 2- 709호 (답십리동)');
  assert.equal(a.특이사항, '');
  const b = await withApi('동대문구 답십리로 184, 709호 (답십리동, 2-)', ...DDM);
  assert.equal(b.상세주소, '2- 709호');
  assert.ok(!/2-/.test(b.괄호정보), `괄호에 조각이 남으면 안 된다: ${b.괄호정보}`);
  assert.equal(b.특이사항, '');
  const c = await offline('경기도 부천시 오정구 성지로42번길 19, 1호 (고강동, 지-)', '홍길동', '', '경기도 부천시 오정구');
  assert.equal(c.상세주소, '지-1호', '한글 조각은 원형으로 되돌린다');
  assert.equal(c.괄호정보, '고강동');
});

test('①-d noteSanitizer — 동 조각 `3-`은 상세주소로 승격하지 않는다', async () => {
  const { sanitizeNote } = await import('../src/utils/noteSanitizer.js');
  const r = sanitizeNote('3-', { detailAddr: '' });
  assert.equal(r.detailAddr, undefined);
  const ok = sanitizeNote('3- 302호', { detailAddr: '' });
  assert.equal(ok.detailAddr, '3- 302호', '호수가 있으면 기존대로 승격');
  const a = await withApi('동대문구 답십리로 184, A-302호', ...DDM);
  assert.equal(a.상세주소, 'A-302호');
  assert.equal(a.특이사항, '', `\`A-\`가 특이사항으로 새면 안 된다: ${a.특이사항}`);
  const b = await offline('동대문구 답십리로 184, 행복빌라 가-102호', ...DDM);
  assert.equal(b.주소, '답십리로 184, 가-102호 (행복빌라)');
});

test('② 대시 동은 1~4자리 + 호 3~4자리 — 1~2자리 동도 정규화·멱등', () => {
  assert.equal(normalizeDongHoDetail('3-302호'), '3- 302호');
  assert.equal(normalizeDongHoDetail('3- 302호'), '3- 302호');
  assert.equal(normalizeDongHoDetail('12-301호'), '12- 301호');
  assert.equal(normalizeDongHoDetail('3-3층 302호'), '3- 302호 3층', '층이 끼어도 숫자 동 규칙(층은 호 뒤)');
  assert.equal(normalizeDongHoDetail('1-2호'), '1-2호', '다가구(호 1자리) 미개입');
  assert.equal(normalizeDongHoDetail('19-3호'), '19-3호');
  assert.equal(normalizeDongHoDetail('40-25호'), '40-25호', '지번 부번(호 2자리) 미개입');
});

test('③ 정제 전체 — `3-302호`가 `3- 302호`로, 특이사항에 `3-`가 남지 않는다(DB 매칭 경로 포함)', async () => {
  const a = await offline('동대문구 답십리로 184, 3-302호', ...DDM);
  assert.equal(a.주소, '답십리로 184, 3- 302호');
  assert.equal(a.특이사항, '');
  const b = await withApi('동대문구 답십리로 184, 3-302호', ...DDM);
  assert.equal(b.주소, '답십리로 184, 3- 302호 (답십리동, 동서울한양아파트)');
  assert.equal(b.특이사항, '', `★M-1 보존 경로로 \`3-\`가 새면 안 된다: ${b.특이사항}`);
  const c = await withApi('동대문구 답십리로 184, 1-2호', ...DDM);
  assert.equal(c.상세주소, '1-2호', '다가구는 그대로');
  assert.equal(c.특이사항, '', `\`1-\`가 특이사항으로 새면 안 된다: ${c.특이사항}`);
});

test('④ parseAptDong(DS-18) — 1~2자리 대시동은 호 3~4자리일 때만 동', () => {
  assert.equal(parseAptDong('답십리로 184, 3- 302호 (답십리동, 동서울한양아파트)'), 3);
  assert.equal(parseAptDong('한천로 224, 10-1203호 (장안동, 현대아파트)'), 10);
  assert.equal(parseAptDong('권선로 472, 101- 203호'), 101, '기존 3자리 동 유지');
  assert.equal(parseAptDong('지층 1-1호 (성남동)'), null, '다가구 1-1호는 동이 아니다');
  assert.equal(parseAptDong('방배로 12, 19-3호 (방배동)'), null);
  assert.equal(parseAptDong('삼작로 376-1, B동 106호'), null, 'DS-18 원칙 유지 — 도로 부번은 동이 아니다');
});
