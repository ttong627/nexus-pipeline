/**
 * 물량배분 이관 파리티 — **배분 결과가 바뀌지 않았음**을 증명한다.
 *
 * ★왜 이게 결정적인가
 *   물량배분 결과가 바뀌면 **기사 담당 구역이 바뀐다**. 그건 현장에서 즉시 사고로 나타난다
 *   (어제 다니던 동네가 오늘 다른 기사에게 가 있음). 그래서 코어 승격은 "동작이 같다"를
 *   증명하지 못하면 해서는 안 되는 작업이다.
 *
 * ★방법
 *   이관 **전에** 워커에서 6개 전략의 출력을 뽑아 `scripts/golden/load-balance-golden.json`
 *   에 고정했다(워커는 export 0 + import 有 라, import 를 벗기고 의존성을 주입해 평가).
 *   이 테스트는 **이관된 코어 모듈**에 같은 입력을 넣어 그 골든과 완전 일치하는지 본다.
 *
 *   골든이 없으면 skip 하지 않고 **실패**시킨다 — 안전망이 사라진 걸 조용히 넘기면 의미가 없다.
 *
 * 실행: node --test scripts/load-balance-parity.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { VALID_STRATEGIES, computeAutoSplit } from '../services/address-service/src/routing/loadBalance.js';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

/** 골든 생성 때와 **완전히 같은** 픽스처. 하나라도 다르면 비교가 무의미하다. */
const mk = (id, addr, lat, lng, po, extra = {}) => ({
  id: `R${id}`, 주소: addr, _lat: lat, _lng: lng, 포수: po, 이름: `수령${id}`, ...extra,
});

const TARGET = [
  mk(1, '경기 부천시 중동로 100', 37.5030, 126.7660, 2),
  mk(2, '경기 부천시 중동로 108', 37.5034, 126.7668, 1),
  mk(3, '경기 부천시 중동로 220', 37.5051, 126.7702, 3),
  mk(4, '경기 부천시 부천로 15 삼성아파트 101동 502호', 37.4988, 126.7731, 1),
  mk(5, '경기 부천시 부천로 15 삼성아파트 101동 1203호', 37.4988, 126.7731, 2),
  mk(6, '경기 부천시 부천로 15 삼성아파트 103동 201호', 37.4992, 126.7738, 1),
  mk(7, '경기 부천시 소사로 77', 37.4820, 126.7955, 4),
  mk(8, '경기 부천시 소사로 81', 37.4823, 126.7961, 1),
  mk(9, '경기 부천시 성주로 20 LH국민임대 105동 1502호', 37.4901, 126.7810, 25),
  mk(10, '경기 부천시 원미로 9', 37.5010, 126.7830, 3, { 특이사항: '문앞' }),
  mk(11, '경기 부천시 조마루로 385', 37.5075, 126.7790, 2, { 특이사항: '경비실' }),
  mk(12, '경기 부천시 길주로 210', 37.5045, 126.7615, 1),
];
const NO_COORD = [mk(90, '경기 부천시 어딘가', null, null, 1)];
const DRIVERS = [{ id: 'D1', name: '기사1' }, { id: 'D2', name: '기사2' }, { id: 'D3', name: '기사3' }];

const run = (strategy) => computeAutoSplit({
  target: TARGET.map((r) => ({ ...r })),
  noCoordRecs: NO_COORD.map((r) => ({ ...r })),
  allRecords: [...TARGET, ...NO_COORD].map((r) => ({ ...r })),
  activeDrivers: DRIVERS,
  driverPins: {},
  strategy,
});

let golden;

before(async () => {
  const raw = await readFile(path.join(ROOT, 'scripts/golden/load-balance-golden.json'), 'utf8');
  golden = JSON.parse(raw);
});

describe('★이관 전후 배분 결과가 완전히 같은가', () => {
  test('골든이 존재하고 6개 전략을 담고 있다', () => {
    assert.ok(golden && golden.cases, '골든이 없다 — 안전망 없이 승격한 셈이 된다');
    assert.equal(Object.keys(golden.cases).length, 6);
  });

  for (const strategy of ['pca', 'hilbert', 'bestOfPcaHilbert', 'seedVoronoi', 'angular', 'dongGroup']) {
    test(`${strategy} — 배정 결과 완전 일치`, () => {
      const expected = golden.cases[strategy];
      assert.ok(expected, `골든에 ${strategy} 가 없다`);
      assert.ok(!expected.error, `골든 생성 때 실패한 전략이다: ${expected.error}`);

      const out = run(strategy);
      assert.deepEqual(out.clusterMap, expected.clusterMap,
        `${strategy} 배분이 달라졌다 — 기사 담당 구역이 바뀐다(현장 사고)`);
    });
  }
});

describe('배분의 기본 계약', () => {
  test('좌표 있는 건은 모두 배정된다(유실 금지)', () => {
    const out = run('pca');
    for (const rec of TARGET) {
      assert.ok(out.clusterMap[rec.id], `배정 안 된 건이 있다: ${rec.id}`);
    }
  });

  test('배정된 기사는 활성 기사 중 하나다', () => {
    const ids = new Set(DRIVERS.map((d) => d.id));
    for (const strategy of VALID_STRATEGIES) {
      const out = run(strategy);
      for (const [rid, did] of Object.entries(out.clusterMap)) {
        assert.ok(ids.has(did), `${strategy}: ${rid} 이 알 수 없는 기사 ${did} 에 배정됐다`);
      }
    }
  });

  test('알 수 없는 전략은 pca 로 폴백한다(터지지 않는다)', () => {
    const out = run('없는전략');
    assert.deepEqual(out.clusterMap, golden.cases.pca.clusterMap);
  });

  test('진단 정보가 함께 온다 — 왜 그렇게 나뉘었는지 설명', () => {
    const out = run('pca');
    assert.ok(out.diagnostics, '진단이 없으면 배분을 사람이 검토할 수 없다');
  });

  test('기사가 하나면 전부 그 기사에게 간다', () => {
    const out = computeAutoSplit({
      target: TARGET.map((r) => ({ ...r })),
      noCoordRecs: [],
      allRecords: TARGET.map((r) => ({ ...r })),
      activeDrivers: [{ id: 'SOLO', name: '혼자' }],
      driverPins: {},
      strategy: 'pca',
    });
    assert.equal(new Set(Object.values(out.clusterMap)).size, 1);
  });
});

describe('워커는 껍데기만 남았다', () => {
  test('워커에 배분 로직이 없고 코어를 import 한다', async () => {
    const src = await readFile(path.join(ROOT, 'src/workers/routeWorker.js'), 'utf8');
    assert.ok(/from\s*['"][^'"]*routing\/loadBalance\.js['"]/.test(src),
      '워커가 코어 loadBalance 를 import 하지 않는다');
    for (const fn of ['computeSeedVoronoi', 'partitionContiguous', 'getProjectionAxis', 'buildUnits']) {
      assert.ok(!new RegExp(`^const\\s+${fn}\\s*=`, 'm').test(src),
        `워커에 ${fn} 이 남아 있다 — 이관이 덜 됐거나 복제가 부활했다`);
    }
    assert.ok(src.split('\n').length < 40, '워커가 다시 뚱뚱해졌다');
  });
});
