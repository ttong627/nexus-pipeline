// 특이사항 검증(A-33) 회귀 테스트 — 실제 DB에서 나온 케이스로 고정
// 실행: node scripts/note-sanitizer.test.mjs
import assert from 'node:assert/strict';
import { sanitizeNote, mergeNotes, splitNameBirth, extractRealName } from '../src/utils/noteSanitizer.js';
import { evaluateAddrChange } from '../src/utils/prevMonthGuard.js';

let pass = 0, fail = 0;
const t = (label, fn) => {
  try { fn(); pass++; console.log(`  ✅ ${label}`); }
  catch (e) { fail++; console.log(`  ❌ ${label}\n     ${e.message}`); }
};

console.log('\n── 이동(무손실) ──');
t('본명 → 본명컬럼, 뒤 배송메모는 보존', () => {
  const r = sanitizeNote('(본명:GALIT MARIA SOCORRO) 대문 정면 계단위', {});
  assert.equal(r.realName, 'GALIT MARIA SOCORRO');
  assert.equal(r.note, '대문 정면 계단위');
});
t('본명 뒤 잔여가 순수 호수면 상세주소로 이동', () => {
  const r = sanitizeNote('(본명:퀴리사디오제닐렌) 2동 106호', {});
  assert.equal(r.realName, '퀴리사디오제닐렌');
  assert.equal(r.detailAddr, '2동 106호');
  assert.equal(r.note, '');
});
t('중첩 괄호 본명도 추출', () => {
  assert.equal(extractRealName('(본명:인순이(김병기))').realName, '인순이(김병기)');
});
t('본명컬럼에 이미 값 있으면 덮어쓰지 않고 제거만', () => {
  const r = sanitizeNote('◆(본명:PHAM THI LE HUyNG)', { realName: 'PHAM THI LE HUONG' });
  assert.equal(r.realName, undefined);   // 기존 본명 보존
  assert.equal(r.note, '');              // 남은 ◆ 는 기호뿐이라 삭제
});
t('호수 → 상세주소 컬럼에 먼저 채운 뒤 제거 (형 지시)', () => {
  const r = sanitizeNote('지층 104호', { address: '경인로101번길 12-6, (송내동, 지층104호)', detailAddr: '' });
  assert.equal(r.detailAddr, '지층 104호');
  assert.equal(r.note, '');
});
t('상세주소에 이미 호수 있으면 중복 제거만', () => {
  const r = sanitizeNote('103호', { address: '은성로51번길 14, 103호 (소사본동)', detailAddr: '103호' });
  assert.equal(r.detailAddr, undefined);
  assert.equal(r.note, '');
});
t('상세주소에 다른 값이 있으면 건드리지 않는다(무손실)', () => {
  const r = sanitizeNote('205호 뒷문', { address: '어딘가로 1', detailAddr: '301호' });
  assert.equal(r.note, '205호 뒷문');
});
t('건물명 단독 → 건물명컬럼', () => {
  const r = sanitizeNote('조광빌라', { address: '경인로535번길 60, 3층2호 (역곡동, 조광빌라)', buildingName: '' });
  assert.equal(r.buildingName, '조광빌라');
  assert.equal(r.note, '');
});
t('`법정동, 건물명` 형태는 두 컬럼으로 분해', () => {
  const r = sanitizeNote('내동, 성진그린타운', { address: '', legalDong: '', buildingName: '', dongDict: new Set(['내동']) });
  assert.equal(r.legalDong, '내동');
  assert.equal(r.buildingName, '성진그린타운');
});
t('법정동 단독 → 법정동컬럼', () => {
  const r = sanitizeNote('학익2동', { legalDong: '', dongDict: new Set(['학익2동']) });
  assert.equal(r.legalDong, '학익2동');
});

console.log('\n── 삭제(딱 2가지만) ──');
[['☆'], [')'], ['0000'], ['8888'], ['9999'], ['11'], ['나'], ['여'], ['남']].forEach(([n]) => {
  t(`무의미 삭제: ${n}`, () => assert.equal(sanitizeNote(n, {}).note, ''));
});
t('시스템 문구([주소추정]) 삭제', () => {
  assert.equal(sanitizeNote('[주소추정] 학습 오타 보정: 한천로 329, 휘경2동 주민센터', {}).note, '');
});
t('주소에 통째로 들어있는 문구 삭제', () => {
  assert.equal(sanitizeNote('송내2동 행정복지센터', { address: '중동로22번길 101, (송내동, 송내2동행정복지센터)' }).note, '');
});

console.log('\n── 보존(절대 지우면 안 되는 것) ──');
[
  '계단위 201호 정면',
  '대문 정면',            // ← '면'으로 끝나지만 법정동 아님 (1차 오탐 재발방지)
  '쪽문 정면',
  '부재시 경비실에 맡겨주세요',
  '딸(010-9172-8387)',
  '녹색철망 우돌아 소나무옆 사잇길 나무계단 의자에 두기',
  '주민센터로 배송 요청',
  '전화말고문자만',
].forEach(n => t(`보존: ${n}`, () => assert.equal(sanitizeNote(n, { address: '무관한로 1' }).note, n)));

console.log('\n── 병합(718건 합치기) ──');
t('짧은 문구가 긴 문구에 포함되면 긴 쪽만 남긴다', () => {
  assert.equal(mergeNotes('2층', '2층  2층초인종'), '2층초인종');
  assert.equal(mergeNotes('1층', '1층 우유 배달주머니에 키 있음'), '1층 우유 배달주머니에 키 있음');
});
t('공백·기호만 다른 같은 문구는 하나로', () => {
  assert.equal(mergeNotes('9999#(E V없음)', '9999# (E/V없음)'), '9999#(E V없음)');
});
t('DB에만 있는 값도 살린다', () => {
  const m = mergeNotes('경비열쇠9945종', '사람열쇠1472종  경비열쇠9945종');
  assert.ok(m.includes('경비열쇠9945종') && m.includes('사람열쇠1472종'));
});

console.log('\n── 이름(생년월일) 분리 — 용산구 형식 ──');
t('홍길동(750315) → 이름·생년월일 분리', () => {
  assert.deepEqual(splitNameBirth('홍길동(750315)'), { name: '홍길동', birth: '750315' });
});
t('8자리(19750315)도 분리', () => {
  assert.deepEqual(splitNameBirth('홍길동(19750315)'), { name: '홍길동', birth: '19750315' });
});
t('점 구분(75.03.15)도 분리', () => {
  assert.deepEqual(splitNameBirth('홍길동(75.03.15)'), { name: '홍길동', birth: '75.03.15' });
});
t('본명·별명 괄호는 건드리지 않는다', () => {
  assert.deepEqual(splitNameBirth('최정호(박주령)'), { name: '최정호(박주령)', birth: '' });
});
t('자리수 안 맞으면 분리하지 않는다', () => {
  assert.deepEqual(splitNameBirth('극동(2)'), { name: '극동(2)', birth: '' });
});
t('괄호 없으면 그대로', () => {
  assert.deepEqual(splitNameBirth('손우겸'), { name: '손우겸', birth: '' });
});

console.log('');
console.log('== M-10 전월 주소 대량변동 게이트 ==');
t('정상 범위(5%)는 막지 않는다', () => {
  assert.equal(evaluateAddrChange({ comparedCount: 1000, addrChangeCount: 50 }).critical, false);
});
t('변동률 15% 이상이면 담당자 확인 필요', () => {
  assert.equal(evaluateAddrChange({ comparedCount: 1000, addrChangeCount: 150 }).critical, true);
});
t('비율이 낮아도 100건 이상이면 확인 필요', () => {
  const r = evaluateAddrChange({ comparedCount: 5000, addrChangeCount: 120 });
  assert.equal(r.critical, true);
  assert.match(r.reason, /120건/);
});
t('표본 30명 미만이면 판정하지 않는다(비율 요동 방지)', () => {
  assert.equal(evaluateAddrChange({ comparedCount: 10, addrChangeCount: 10 }).critical, false);
});
t('명단이 통째로 다른 경우(100%)는 반드시 막는다', () => {
  assert.equal(evaluateAddrChange({ comparedCount: 500, addrChangeCount: 500 }).critical, true);
});
t('전월 자료가 없으면(0명) 막지 않는다', () => {
  assert.equal(evaluateAddrChange({ comparedCount: 0, addrChangeCount: 0 }).critical, false);
});

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
