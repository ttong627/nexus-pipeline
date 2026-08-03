/**
 * 배송순번·배차 엔진 **특성화 테스트**(characterization test) — 코어 승격 전 안전망.
 *
 * ★왜 지금 이걸 먼저 만드는가 (실측 2026-08-03)
 *   `routeSequenceEngine.js`(1,227줄)·`routeWorker.js`(1,080줄)에 **단위 테스트가 0개**다.
 *   합쳐 2,307줄이 무시험인데, 여기에 세 가지 일이 예정돼 있다:
 *     ① 복제 제거 — 워커가 ESM import 를 못 써서 순수함수 30여 개를 **재정의**해 갖고 있다.
 *        플랫폼 vendoring 까지 합치면 같은 로직이 **3벌**이다.
 *     ② 서버 승격 — `import.meta.env` 의존을 떼고 Node 에서 돌게 만든다.
 *     ③ 코어 API 노출 — 그래야 스튜디오 생성물에 순번·물량배분이 이식된다.
 *   이 셋 중 무엇을 하든 **출력이 변하면 실제 배송 순서가 바뀐다**. 그물 없이 하면 도박이다.
 *
 * ★특성화 테스트란
 *   "옳은 값"을 주장하지 않는다. **지금 이 코드가 내놓는 값을 그대로 고정**할 뿐이다.
 *   실제로 이 파일을 처음 쓸 때 내 기대값 3개가 틀렸고, 틀린 건 코드가 아니라 나였다.
 *   그 과정에서 승격을 막을 갭 2개를 찾았다(아래 '★승격 갭' 참조).
 *
 * ★로드 방식
 *   엔진이 `import.meta.env.VITE_KAKAO_REST_KEY`(routeSequenceEngine.js:7)를 읽어
 *   순수 Node 로는 못 돈다. 이미 있는 `scripts/golden/engineLoader.mjs`(vite ssrLoadModule)를
 *   재사용한다 — 새 의존성 0, 프로덕션 코드 변경 0.
 *
 * 실행: node --test scripts/routing-characterization.test.mjs
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { loadClientModule } from './golden/engineLoader.mjs';

/**
 * 고정 픽스처 — **한글 키 스키마**(PII 없는 가상 데이터).
 *
 * ⚠️엔진은 `record.주소`를 본다(`getRecordSearchText`, routeSequenceEngine.js:125).
 *   nexus 명단이 한글 컬럼이기 때문이다. 영문 키(`address`)로 주면 조용히 실패한다 —
 *   예외가 아니라 "아파트가 아님"으로 판정된다. 아래 '★승격 갭'이 이걸 고정한다.
 */
const RECORDS = [
  { id: 1, 이름: '가', 주소: '경기 부천시 중동로 100', lat: 37.5030, lng: 126.7660, qty: 2 },
  { id: 2, 이름: '나', 주소: '경기 부천시 중동로 108', lat: 37.5034, lng: 126.7668, qty: 1 },
  { id: 3, 이름: '다', 주소: '경기 부천시 중동로 220', lat: 37.5051, lng: 126.7702, qty: 3 },
  { id: 4, 이름: '라', 주소: '경기 부천시 부천로 15 삼성아파트 101동 502호', lat: 37.4988, lng: 126.7731, qty: 1 },
  { id: 5, 이름: '마', 주소: '경기 부천시 부천로 15 삼성아파트 101동 1203호', lat: 37.4988, lng: 126.7731, qty: 2 },
  { id: 6, 이름: '바', 주소: '경기 부천시 부천로 15 삼성아파트 103동 201호', lat: 37.4992, lng: 126.7738, qty: 1 },
  { id: 7, 이름: '사', 주소: '경기 부천시 소사로 77', lat: 37.4820, lng: 126.7955, qty: 4 },
  { id: 8, 이름: '아', 주소: '경기 부천시 소사로 81', lat: 37.4823, lng: 126.7961, qty: 1 },
];

const DEPOT = { lat: 37.4900, lng: 126.7800 };

let engine;
let daySplit;
let close;

before(async () => {
  const loadedEngine = await loadClientModule('/src/engine/routeSequenceEngine.js');
  const loadedSplit = await loadClientModule('/src/engine/deliveryDaySplit.js');
  engine = loadedEngine.mod;
  daySplit = loadedSplit.mod;
  close = async () => {
    await loadedEngine.close();
    await loadedSplit.close();
  };
});

after(async () => {
  if (close) await close();
});

describe('순수 헬퍼 — 워커가 재정의해 갖고 있는 바로 그 함수들', () => {
  test('haversine — 거리 계산', () => {
    const d = engine.haversine(37.5030, 126.7660, 37.4820, 126.7955);
    assert.ok(Number.isFinite(d) && d > 0);
    assert.ok(d > 3000 && d < 4200, `예상 대역을 벗어났다: ${d}`);
  });

  test('haversine — 같은 점은 0', () => {
    assert.equal(engine.haversine(37.5, 126.7, 37.5, 126.7), 0);
  });

  test('parseAptDong — 동 번호는 **숫자**로, 없으면 null', () => {
    // ⚠️문자열 '101'이 아니라 숫자 101이다. 없을 때도 '' 이 아니라 null 이다.
    //   승격 후 타입이 바뀌면 비교식(=== '101')이 조용히 깨진다.
    assert.equal(engine.parseAptDong('경기 부천시 부천로 15 삼성아파트 101동 502호'), 101);
    assert.equal(engine.parseAptDong('경기 부천시 중동로 100'), null);
  });

  test('extractRoadAddress — 도로명 구간 추출', () => {
    const got = engine.extractRoadAddress('경기 부천시 중동로 100');
    assert.equal(typeof got, 'string');
    assert.ok(got.includes('중동로'), `도로명이 빠졌다: ${got}`);
  });

  test('isApartmentLike — 한글 키로 주면 아파트를 알아본다', () => {
    assert.equal(engine.isApartmentLike(RECORDS[3]), true);
    assert.equal(engine.isApartmentLike(RECORDS[0]), false);
    assert.equal(typeof engine.isRentalLike(RECORDS[3]), 'boolean');
  });
});

describe('★승격 갭 — 코어로 올리기 전에 반드시 해결해야 할 것', () => {
  test('갭①: 영문 키(address)로 주면 아파트를 못 알아본다 — 조용히', () => {
    const english = { id: 99, name: '라', address: '경기 부천시 부천로 15 삼성아파트 101동 502호', qty: 1 };
    // 예외가 아니라 false 다. 그래서 아무도 모르게 순번 품질만 나빠진다.
    assert.equal(engine.isApartmentLike(english), false,
      '동작이 바뀌었다면 갭①이 해결된 것이니 이 테스트를 갱신할 것');
    // ★스캐폴드 생성물(models.py)은 영문 키를 쓴다 → 그대로 연결하면 아파트 묶음이 전부 실패한다.
    //   코어 API 는 입력 스키마를 정규화해서 받아야 한다(한글/영문 양쪽 수용).
  });

  test('갭②: getEffectiveLoad 가 qty 를 반영하지 않는다', () => {
    const many = engine.getEffectiveLoad(RECORDS[6]);   // qty 4
    const one = engine.getEffectiveLoad(RECORDS[1]);    // qty 1
    assert.equal(many, one,
      'qty 가 반영되기 시작했다면 물량배분 결과가 달라진다 — 이 테스트를 갱신하고 배분 영향을 확인할 것');
    // 체감물량은 '수량' 등 다른 필드명을 기대한다. 물량배분(load_balance)의 기준값이므로
    // 코어 승격 시 어떤 필드를 물량으로 볼지 **계약으로 못박아야** 한다.
  });
});

describe('★갭 해결 증명 — 정규화 계층이 실제로 엔진을 동작시킨다', () => {
  test('갭① 정규화하면 영문 키도 아파트로 인식된다', async () => {
    const { toEngineRecord } = await import(
      '../services/address-service/src/routing/recordSchema.js'
    );
    const english = { id: 99, name: '라', address: '경기 부천시 부천로 15 삼성아파트 101동 502호', qty: 1 };
    assert.equal(engine.isApartmentLike(english), false, '정규화 전(갭 상태)');
    assert.equal(engine.isApartmentLike(toEngineRecord(english)), true,
      '정규화 후에도 못 알아보면 계층이 제 일을 못 하는 것이다');
  });

  test('갭② 정규화하면 qty 가 체감물량에 반영된다', async () => {
    const { toEngineRecord } = await import(
      '../services/address-service/src/routing/recordSchema.js'
    );
    const many = { address: '경기 부천시 소사로 77', qty: 4 };
    const one = { address: '경기 부천시 중동로 108', qty: 1 };
    assert.equal(engine.getEffectiveLoad(many), engine.getEffectiveLoad(one), '정규화 전(갭 상태)');
    assert.ok(
      engine.getEffectiveLoad(toEngineRecord(many)) > engine.getEffectiveLoad(toEngineRecord(one)),
      '정규화 후에는 수량이 많은 건의 체감물량이 더 커야 한다',
    );
    assert.equal(engine.getEffectiveLoad(toEngineRecord(many)), 4);
  });

  test('★순수 한글 명단(운영 nexus)은 정규화를 통과해도 불변', async () => {
    const { toEngineRecord } = await import(
      '../services/address-service/src/routing/recordSchema.js'
    );
    // ⚠️처음엔 위 RECORDS 그대로 "회귀 0"을 주장했다가 실패했다. 그 픽스처는 `qty`(영문 물량키)를
    //   갖고 있어서 정규화가 `포수`를 채우고 체감물량이 1→qty 로 **바뀐다**.
    //   그건 회귀가 아니라 **갭② 해결의 효과**다. 내 주장이 부정확했다.
    //   운영 nexus 명단은 `포수` 컬럼을 쓰므로, 진짜 회귀 검증은 **순수 한글 레코드**로 한다.
    const koOnly = RECORDS.map(({ qty, ...rest }) => ({ ...rest, 포수: qty }));
    for (const rec of koOnly) {
      assert.equal(engine.isApartmentLike(toEngineRecord(rec)), engine.isApartmentLike(rec));
      assert.equal(engine.getEffectiveLoad(toEngineRecord(rec)), engine.getEffectiveLoad(rec));
      assert.equal(engine.parseAptDong(toEngineRecord(rec)['주소']), engine.parseAptDong(rec['주소']));
    }
  });

  test('정규화는 영문 물량키를 인식시켜 **동작을 개선한다**(불변이 아니다)', async () => {
    const { toEngineRecord } = await import(
      '../services/address-service/src/routing/recordSchema.js'
    );
    // 이 테스트는 위 테스트와 짝이다 — "무엇이 바뀌고 무엇이 안 바뀌는지"를 둘 다 못박는다.
    const withQty = RECORDS[6];                       // qty 4, 포수 없음
    assert.equal(engine.getEffectiveLoad(withQty), 1, '정규화 전에는 물량을 못 본다');
    assert.equal(engine.getEffectiveLoad(toEngineRecord(withQty)), 4, '정규화 후 물량이 살아난다');
  });
});

describe('순번 생성 — 출력 형태를 고정한다', () => {
  test('buildSequenceUnits — 단위 형태와 타입', () => {
    const units = engine.buildSequenceUnits(RECORDS);
    assert.ok(Array.isArray(units) && units.length > 0);
    for (const u of units) {
      for (const k of ['key', 'type', 'label', 'records', 'lat', 'lng', 'hasCoord']) {
        assert.ok(k in u, `단위에 ${k} 가 없다`);
      }
    }
    const types = new Set(units.map((u) => u.type));
    assert.ok(types.has('apt'), '아파트 타입이 나오지 않았다');
    assert.ok(types.has('road'), '도로 타입이 나오지 않았다');
  });

  test('buildSequenceUnits — 배송건이 유실되지 않는다', () => {
    const units = engine.buildSequenceUnits(RECORDS);
    const seen = new Set();
    for (const u of units) for (const rec of u.records) seen.add(rec.id);
    assert.equal(seen.size, RECORDS.length, '순번 단위화에서 배송건이 유실됐다');
  });

  test('buildSequenceUnits — 같은 동이라도 호수가 다르면 별도 단위(현재 동작)', () => {
    // 101동 502호 / 101동 1203호가 **합쳐지지 않는다**. label 에 전체 주소가 들어가기 때문.
    // 실제 운영 명단은 정제 후 동/호가 분리돼 들어오므로 이 상태로도 동작하지만,
    // 코어 API 는 정제 전 원문을 받을 수 있어 승격 시 확인이 필요하다.
    const units = engine.buildSequenceUnits(RECORDS);
    const apt101 = units.filter((u) => u.type === 'apt' && String(u.label).includes('101동'));
    assert.equal(apt101.length, 2, '동작이 바뀌었다면 이 테스트를 갱신할 것');
  });

  test('nearestNeighborTSP — 전 지점을 한 번씩 방문', () => {
    const points = RECORDS.map((r) => ({ ...r }));
    const ordered = engine.nearestNeighborTSP(points, DEPOT);
    assert.equal(ordered.length, points.length, '순번에서 배송지가 늘거나 줄었다');
    assert.equal(new Set(ordered.map((p) => p.id)).size, points.length, '중복 방문이 생겼다');
  });

  test('improvedSequence — 최근접보다 나쁘지 않다(개선 알고리즘의 최소 계약)', () => {
    const points = RECORDS.map((r) => ({ ...r }));
    const nn = engine.nearestNeighborTSP(points, DEPOT);
    const improved = engine.improvedSequence(points, DEPOT);
    assert.equal(improved.length, points.length);
    const total = (seq) => {
      let sum = 0;
      let prev = DEPOT;
      for (const p of seq) {
        sum += engine.haversine(prev.lat, prev.lng, p.lat, p.lng);
        prev = p;
      }
      return sum;
    };
    assert.ok(total(improved) <= total(nn) * 1.0001,
      `개선 결과가 더 길다: improved=${total(improved)} nn=${total(nn)}`);
  });

  test('measureSequence — 측정값이 객체로 나온다', () => {
    const ordered = engine.nearestNeighborTSP(RECORDS.map((r) => ({ ...r })), DEPOT);
    const m = engine.measureSequence(ordered);
    assert.equal(typeof m, 'object');
    assert.ok(m !== null);
  });
});

describe('배송일 분할 — 코어 승격 대상 ⑦', () => {
  test('splitByDay — 호출이 성립하고 값을 돌려준다', () => {
    const out = daySplit.splitByDay(RECORDS.map((r) => ({ ...r })), { numDays: 2, depot: DEPOT });
    assert.ok(out !== undefined, 'splitByDay 가 값을 반환하지 않았다');
  });

  test('splitBySequence — 상한을 넘는 묶음이 없다', () => {
    const recs = RECORDS.map((r, i) => ({ ...r, seq: i + 1 }));
    const out = daySplit.splitBySequence(recs, { maxPerDay: 3 });
    const days = Array.isArray(out) ? out : (out.days || []);
    for (const d of days) {
      if (Array.isArray(d)) assert.ok(d.length <= 3, `일자 묶음이 상한을 넘었다: ${d.length}`);
    }
  });

  test('summarizeDaySplit — 요약이 터지지 않는다', () => {
    const s = daySplit.summarizeDaySplit(RECORDS.map((r, i) => ({ ...r, day: (i % 2) + 1 })));
    assert.ok(s !== undefined);
  });
});

describe('★복제 제거 완료 — 워커가 엔진을 쓴다', () => {
  test('워커에 순수함수 복제가 없고 엔진을 import 한다', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
    const workerSrc = await readFile(path.join(root, 'src/workers/routeWorker.js'), 'utf8');

    // ⚠️이 테스트는 원래 "복제가 있다"를 고정하고 있었다(2026-08-03 오전).
    //   복제를 제거하면서 실패했고, **그 실패가 작업이 실제로 일어났다는 증거**였다.
    //   지금은 반대로 "복제가 없다"를 잠근다. 자세한 검증은 routing-worker-parity.test.mjs.
    assert.ok(/from\s*['"]\.\.\/engine\/routeSequenceEngine\.js['"]/.test(workerSrc),
      '워커가 엔진을 import 하지 않는다');
    for (const fn of ['haversine', 'getEffectiveLoad', 'extractRoadAddress']) {
      assert.ok(!new RegExp(`^const\\s+${fn}\\s*=`, 'm').test(workerSrc),
        `워커에 ${fn} 복제가 부활했다`);
    }
    // parseAptDong 은 계약이 달라 어댑터로 남는다(레코드 → 텍스트 → 엔진).
    assert.ok(/parseAptDongFromText/.test(workerSrc), '어댑터가 엔진 로직에 위임해야 한다');
  });
});
