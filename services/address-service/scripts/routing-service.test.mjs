/**
 * 배송 순번·일정 코어 서비스 검증 — `/v1/routing/*` 의 계약.
 *
 * ★여기서 확인하는 것은 "알고리즘이 좋은가"가 아니다(그건 운영 검증된 엔진의 몫).
 *   **코어 API 로 노출했을 때 조용히 틀리지 않는가**를 본다:
 *     · 영문 키로 와도 아파트·물량을 알아보는가(정규화가 걸려 있는가)
 *     · 좌표 없는 건을 말없이 버리지 않는가
 *     · 추천임을 분명히 말하는가(설계서 recommend_then_confirm)
 *
 * 실행: node --test scripts/routing-service.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  distanceMeters, recommendDaySplit, recommendSequence, sequenceUnits,
} from '../src/routing/routingService.js';

/** 영문 키 명단 — 스캐폴드가 생성하는 배송 프로그램이 쓰는 스키마다. */
const ENGLISH = [
  { id: 1, name: '가', address: '경기 부천시 중동로 100', qty: 2, lat: 37.5030, lng: 126.7660 },
  { id: 2, name: '나', address: '경기 부천시 중동로 108', qty: 1, lat: 37.5034, lng: 126.7668 },
  { id: 3, name: '다', address: '경기 부천시 부천로 15 삼성아파트 101동 502호', qty: 4, lat: 37.4988, lng: 126.7731 },
  { id: 4, name: '라', address: '경기 부천시 소사로 77', qty: 1, lat: 37.4820, lng: 126.7955 },
];

const DEPOT = { lat: 37.4900, lng: 126.7800 };

test('순번 — 전 배송건이 한 번씩, 번호가 1부터 연속', () => {
  const out = recommendSequence({ records: ENGLISH, depot: DEPOT });
  assert.equal(out.count, ENGLISH.length);
  assert.deepEqual(out.sequenced.map((r) => r.seq), [1, 2, 3, 4]);
  assert.equal(new Set(out.sequenced.map((r) => r.id)).size, ENGLISH.length, '중복 방문');
});

test('★영문 키로 와도 정규화가 걸려 물량·아파트를 알아본다', () => {
  const out = recommendSequence({ records: ENGLISH, depot: DEPOT });
  // 정규화가 안 걸리면 주소를 못 읽어 순번 대상이 0이 된다.
  assert.equal(out.normalization.withAddress, 4);
  assert.equal(out.normalization.withLoad, 4, 'qty 를 물량으로 인식하지 못했다');
});

test('★좌표 없는 건을 말없이 버리지 않는다', () => {
  const mixed = [...ENGLISH, { id: 9, name: '마', address: '경기 부천시 어딘가', qty: 1 }];
  const out = recommendSequence({ records: mixed, depot: DEPOT });
  assert.equal(out.count, 4);
  assert.equal(out.unsequenced.length, 1);
  assert.equal(out.unsequenced[0].reason, 'no_coordinate');
  assert.equal(out.unsequenced[0].id, 9, '어느 건이 빠졌는지 알 수 있어야 한다');
});

test('★추천임을 분명히 말한다(확정은 사람이 한다)', () => {
  assert.equal(recommendSequence({ records: ENGLISH }).mode, 'recommend');
  assert.equal(recommendDaySplit({ records: ENGLISH, numDays: 2 }).mode, 'recommend');
});

test('빈 입력에도 터지지 않는다', () => {
  const out = recommendSequence({ records: [] });
  assert.equal(out.count, 0);
  assert.deepEqual(out.sequenced, []);
  assert.equal(out.measure, null);
  assert.equal(recommendSequence({}).count, 0);
});

test('출발지가 없어도 순번이 나온다', () => {
  const out = recommendSequence({ records: ENGLISH });
  assert.equal(out.count, 4);
});

/** 엔진이 만드는 단위 타입. 좌표 없는 건은 `no_coord` 로 따로 모인다(스모크에서 확인). */
const UNIT_TYPES = ['apt', 'road', 'no_coord'];

test('순번 단위 — 왜 그 순서인지 설명하는 근거를 준다', () => {
  const out = sequenceUnits({ records: ENGLISH });
  assert.ok(out.count > 0);
  for (const u of out.units) {
    assert.ok(UNIT_TYPES.includes(u.type), `알 수 없는 단위 타입: ${u.type}`);
    assert.ok(u.recordCount >= 1);
  }
  assert.ok(out.units.some((u) => u.type === 'apt'), '아파트 단위를 못 만들었다 = 정규화 실패');
});

test('좌표 없는 건도 단위로 드러난다 — 조용히 사라지지 않는다', () => {
  // ⚠️처음엔 좌표가 다 있는 픽스처만 써서 이 타입을 못 봤다. DB 없이 서버를 띄운
  //   스모크에서 `no_coord` 가 나와 알았다 — 유닛 테스트만으로는 안 보이는 경로가 있다.
  const out = sequenceUnits({ records: [...ENGLISH, { id: 9, address: '좌표없는집', qty: 1 }] });
  const noCoord = out.units.filter((u) => u.type === 'no_coord');
  assert.equal(noCoord.length, 1, '좌표 없는 건이 단위에서 사라졌다');
  assert.equal(noCoord[0].hasCoord, false);
});

test('배송일 분할 — 호출이 성립하고 요약이 따라온다', () => {
  const out = recommendDaySplit({ records: ENGLISH, numDays: 2, depot: DEPOT });
  assert.ok(out.result !== undefined);
  assert.ok(out.summary !== undefined);
  assert.equal(out.normalization.total, 4);
});

test('순번 기준 분할 — maxPerDay 만 주면 그 경로를 탄다', () => {
  const out = recommendDaySplit({ records: ENGLISH, maxPerDay: 2 });
  assert.ok(out.result !== undefined);
});

test('거리 계산 — 잘못된 입력은 이유를 말한다', () => {
  const ok = distanceMeters({ from: DEPOT, to: { lat: 37.5030, lng: 126.7660 } });
  assert.equal(ok.ok, true);
  assert.ok(ok.meters > 0);

  const bad = distanceMeters({ from: DEPOT, to: null });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid_points');
});

test('원본 필드가 순번 결과에 보존된다 — 호출부가 자기 데이터를 잃지 않는다', () => {
  const out = recommendSequence({ records: ENGLISH, depot: DEPOT });
  for (const rec of out.sequenced) {
    assert.ok(rec.id !== undefined, 'id 가 사라졌다');
    assert.ok(rec.address !== undefined, '원본 address 가 사라졌다');
  }
});
