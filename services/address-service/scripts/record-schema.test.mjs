/**
 * 배송 레코드 정규화 검증 — 코어 API 입력 계약.
 *
 * ★이 모듈이 없으면 무슨 일이 일어나는가
 *   순번 엔진은 정부양곡 명단 컬럼명(`주소`·`포수`)에 결합돼 있다. 다른 스키마로 부르면
 *   **예외가 아니라 조용히 틀린 답**이 나온다 — 아파트를 못 알아보고, 수량 4가 1이 된다.
 *   스캐폴드 생성물은 영문 키를 쓰므로, 정규화 없이 연결하면 생성된 모든 배송 프로그램에서
 *   그 일이 벌어진다. 그래서 이 테스트는 "변환이 되는가"가 아니라
 *   **"조용한 실패가 막혔는가"**를 본다.
 *
 * 실행: node --test scripts/record-schema.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INPUT_CONTRACT, describeNormalization, toEngineRecord, toEngineRecords,
} from '../src/routing/recordSchema.js';

test('영문 키 → 엔진이 아는 한글 키로 옮긴다', () => {
  const out = toEngineRecord({
    name: '홍길동', address: '경기 부천시 부천로 15 삼성아파트 101동 502호',
    qty: 4, note: '문앞', phone: '010-0000-0000',
  });
  assert.equal(out['주소'], '경기 부천시 부천로 15 삼성아파트 101동 502호');
  assert.equal(out['포수'], 4);
  assert.equal(out['특이사항'], '문앞');
  assert.equal(out['이름'], '홍길동');
  assert.equal(out['전화번호'], '010-0000-0000');
});

test('원본 필드를 지우지 않는다 — 호출부가 자기 스키마를 계속 쓴다', () => {
  const out = toEngineRecord({ id: 7, address: '경기 부천시 중동로 100', qty: 2 });
  assert.equal(out.id, 7);
  assert.equal(out.address, '경기 부천시 중동로 100');
  assert.equal(out['주소'], '경기 부천시 중동로 100');
});

test('이미 한글 키면 사실상 그대로 통과한다(기존 nexus 명단)', () => {
  const src = { 주소: '경기 부천시 중동로 100', 포수: 3, 특이사항: '부재시 경비실' };
  const out = toEngineRecord(src);
  assert.equal(out['주소'], src['주소']);
  assert.equal(out['포수'], 3);
  assert.equal(out['특이사항'], src['특이사항']);
});

test('한글 키가 영문 키를 이긴다 — 원본 스키마가 우선', () => {
  const out = toEngineRecord({ 주소: '한글주소', address: '영문주소', 포수: 5, qty: 1 });
  assert.equal(out['주소'], '한글주소');
  assert.equal(out['포수'], 5);
});

test('물량은 여러 이름을 받는다 — 사업마다 컬럼명이 다르다', () => {
  assert.equal(toEngineRecord({ '수량(포수)': 9 })['포수'], 9);
  assert.equal(toEngineRecord({ 수량: 7 })['포수'], 7);
  assert.equal(toEngineRecord({ quantity: 6 })['포수'], 6);
  assert.equal(toEngineRecord({ load: 5 })['포수'], 5);
});

test('숫자에 단위가 붙어 와도 읽는다', () => {
  assert.equal(toEngineRecord({ qty: '12포' })['포수'], 12);
  assert.equal(toEngineRecord({ qty: '3 개' })['포수'], 3);
});

test('★물량이 없으면 채우지 않는다 — "없었다"는 사실을 지우지 않는다', () => {
  const out = toEngineRecord({ address: '경기 부천시 중동로 100' });
  assert.equal('포수' in out, false,
    '여기서 1을 채우면 엔진의 폴백과 구분이 안 되고 "물량 미입력" 집계가 불가능해진다');
});

test('빈 문자열은 값으로 치지 않는다 — 정규화가 빈 값을 만들어내지 않는다', () => {
  // ⚠️원본에 없던 키만 본다. 원본에 `주소:''`가 있으면 **보존 설계**대로 그대로 남는다
  //   (처음엔 원본에 빈 주소를 넣어놓고 "안 만들었는지"를 검사했다 — 테스트가 틀렸다).
  const out = toEngineRecord({ address: '', name: '  ', qty: '' });
  assert.equal('주소' in out, false, '빈 address 로 주소를 만들면 안 된다');
  assert.equal('이름' in out, false);
  assert.equal('포수' in out, false);
});

test('원본의 빈 값은 보존된다 — 지우는 것도 변조다', () => {
  const out = toEngineRecord({ 주소: '', 포수: 0 });
  assert.equal(out['주소'], '');
  assert.equal(out['포수'], 0);
});

test('좌표는 여러 이름을 받고 숫자로 만든다', () => {
  const a = toEngineRecord({ lat: '37.5', lng: '126.7' });
  assert.equal(a.lat, 37.5);
  assert.equal(a.lng, 126.7);
  const b = toEngineRecord({ 위도: 37.1, 경도: 127.2 });
  assert.equal(b.lat, 37.1);
  assert.equal(b.lng, 127.2);
});

test('잘못된 입력에도 터지지 않는다', () => {
  assert.deepEqual(toEngineRecord(null), {});
  assert.deepEqual(toEngineRecord(undefined), {});
  assert.deepEqual(toEngineRecord('문자열'), {});
  assert.deepEqual(toEngineRecords(null), []);
});

test('★정규화 보고 — 조용한 실패를 드러낸다', () => {
  const report = describeNormalization([
    { address: '경기 부천시 중동로 100', qty: 2, lat: 37.5, lng: 126.7 },
    { name: '주소없음', qty: 1 },
    { 주소: '경기 부천시 중동로 108' },
  ]);
  assert.equal(report.total, 3);
  assert.equal(report.withAddress, 2);
  assert.equal(report.withLoad, 2);
  assert.equal(report.withCoord, 1);
  assert.deepEqual(report.missingAddress, [1], '주소 없는 건의 위치를 알려줘야 원인을 찾는다');
});

test('입력 계약이 코드로 노출된다 — 문서보다 코드가 먼저 낡지 않는다', () => {
  assert.ok(INPUT_CONTRACT.address.includes('address'));
  assert.ok(INPUT_CONTRACT.address.includes('주소'));
  assert.ok(INPUT_CONTRACT.load.includes('포수'));
  assert.ok(INPUT_CONTRACT.load.includes('qty'));
});
