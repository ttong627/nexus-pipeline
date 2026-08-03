/**
 * 워커 복제 제거 검증 — 다시는 3벌로 갈라지지 않게 잠근다.
 *
 * ★경위 (2026-08-03)
 *   `src/workers/routeWorker.js` 는 `routeSequenceEngine.js` 의 순수함수 30여 개를
 *   **재정의해서** 갖고 있었다. 같은 로직이 원본·워커·플랫폼 vendoring 까지 3벌이라
 *   한쪽만 고치는 사고가 예약돼 있었다.
 *
 *   제거 전에 이 파일의 이전 버전이 두 벌을 실측 대조했고, 결과는:
 *     · haversine·getEffectiveLoad·extractRoadAddress·isApartmentLike → **완전 일치**
 *     · 상수 4종 → 일치
 *     · ★parseAptDong 만 **계약이 달랐다**(워커=레코드 / 엔진=문자열)
 *   그래서 로직은 엔진 것을 쓰고, 다른 계약은 워커 안 **어댑터**로 흡수했다.
 *
 * ★이제 이 파일이 지키는 것
 *   ① 워커가 엔진을 import 한다(복제로 되돌아가지 않는다)
 *   ② 복제 선언이 다시 생기지 않는다
 *   ③ 어댑터가 원래 계약(레코드 입력·상세주소 인식)을 그대로 지킨다
 *
 * 실행: node --test scripts/routing-worker-parity.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadClientModule } from './golden/engineLoader.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

/** 엔진에서 가져와야 하는 것들 — 워커가 다시 정의하면 복제가 부활한 것이다. */
const MUST_IMPORT = [
  'haversine', 'getEffectiveLoad', 'extractRoadAddress', 'isApartmentLike',
  'APT_LIKE_RE', 'RENTAL_KEYWORDS', 'STAIRS_KEYWORDS', 'HEAVY_NOTE_KW', 'MEDIUM_NOTE_KW',
];

let workerSrc;
let engine;
let close;

before(async () => {
  workerSrc = await readFile(path.join(ROOT, 'src/workers/routeWorker.js'), 'utf8');
  const loaded = await loadClientModule('/src/engine/routeSequenceEngine.js');
  engine = loaded.mod;
  close = loaded.close;
});

after(async () => {
  if (close) await close();
});

describe('복제가 제거된 상태를 잠근다', () => {
  test('워커가 엔진을 import 한다', () => {
    assert.ok(/import\s*\{[\s\S]*?\}\s*from\s*['"]\.\.\/engine\/routeSequenceEngine\.js['"]/.test(workerSrc),
      '워커가 엔진을 import 하지 않는다 — 복제로 되돌아갔을 수 있다');
  });

  test('★엔진에서 가져와야 할 것을 워커가 다시 정의하지 않는다', () => {
    for (const name of MUST_IMPORT) {
      assert.ok(
        !new RegExp(`^const\\s+${name}\\s*=`, 'm').test(workerSrc),
        `워커에 ${name} 재정의가 생겼다 — 복제가 부활했다. 엔진에서 import 할 것`,
      );
      assert.ok(
        new RegExp(`\\b${name}\\b`).test(workerSrc.split('\n').slice(0, 40).join('\n')),
        `${name} 이 import 목록에 없다`,
      );
    }
  });

  test('워커가 module 워커로 로드된다(import 가 가능한 근거)', async () => {
    const modal = await readFile(path.join(ROOT, 'src/components/RouteMapModal.jsx'), 'utf8');
    assert.ok(/new Worker\([\s\S]{0,120}routeWorker\.js[\s\S]{0,80}type:\s*['"]module['"]/.test(modal),
      "워커가 classic 으로 바뀌면 import 가 깨진다 — { type: 'module' } 를 유지할 것");
  });
});

describe('★계약 어댑터 — 워커는 레코드로 부른다', () => {
  /** 워커 어댑터가 조합하는 것과 **같은 순서**로 텍스트를 만든다. */
  const adapterText = (record) => [
    record?._detailAddress, record?.detailAddress, record?.주소, record?.특이사항,
  ].filter(Boolean).join(' ');

  test('어댑터가 레코드 입력 계약을 유지한다', () => {
    assert.ok(/const parseAptDong = \(record\) => parseAptDongFromText\(\[/.test(workerSrc),
      '어댑터 형태가 바뀌었다 — 레코드 계약이 깨지면 아파트 동 그룹핑이 무너진다');
    assert.ok(/parseAptDong as parseAptDongFromText/.test(workerSrc),
      '엔진의 문자열 버전을 별칭으로 가져와야 이름 충돌이 없다');
  });

  test('어댑터 조합 텍스트로 엔진이 동을 찾아낸다', () => {
    const cases = [
      [{ 주소: '경기 부천시 부천로 15 삼성아파트 101동 502호' }, 101],
      [{ 주소: '경기 부천시 부천로 15', detailAddress: '103동 201호' }, 103],
      [{ 주소: '경기 부천시 부천로 15', _detailAddress: '204동 101호' }, 204],
      [{ 주소: '경기 부천시 중동로 100' }, null],
      [{ 주소: '', 특이사항: '' }, null],
    ];
    for (const [rec, expected] of cases) {
      assert.equal(engine.parseAptDong(adapterText(rec)), expected,
        `어댑터 경로로 동을 못 찾는다: ${JSON.stringify(rec)}`);
    }
  });

  test('★엔진에 레코드를 그대로 넘기면 안 된다(어댑터가 필요한 이유)', () => {
    const rec = { 주소: '경기 부천시 부천로 15 삼성아파트 101동 502호' };
    assert.equal(engine.parseAptDong(rec), null,
      '엔진은 문자열만 받는다. 어댑터 없이 레코드를 넘기면 전부 null 이 된다');
  });
});

describe('엔진이 워커가 쓰는 것을 계속 export 하는가', () => {
  test('import 대상이 전부 살아 있다', () => {
    for (const name of MUST_IMPORT) {
      assert.notEqual(engine[name], undefined,
        `엔진이 ${name} export 를 뺐다 — 워커 빌드가 깨진다`);
    }
  });

  test('체감물량 규칙이 유지된다(물량배분 기준값)', () => {
    // 임대 20포↑ 할인 · 계단 층당 가중 · 특이사항 가중 — 워커가 이 값을 그대로 쓴다.
    assert.equal(engine.getEffectiveLoad({ 주소: '경기 부천시 중동로 100', 포수: 3 }), 3);
    assert.equal(engine.getEffectiveLoad({ 주소: 'LH국민임대 105동', 포수: 25 }), 7.5);
    assert.equal(engine.getEffectiveLoad({ 주소: '행복빌라 3층', 포수: 4 }), 4 * 1.3);
    assert.equal(engine.getEffectiveLoad({ 주소: '경기 부천시 원미로 9', 포수: 2, 특이사항: '문앞' }), 3);
  });
});
