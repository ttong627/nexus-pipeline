/**
 * 워커 복제본 ↔ 원본 엔진 **파리티 테스트** — 복제 제거 전 필수 확인.
 *
 * ★왜 이게 먼저인가 (실측 2026-08-03)
 *   `src/workers/routeWorker.js`(1,080줄)는 `routeSequenceEngine.js` 의 순수함수 30여 개를
 *   **재정의해서** 갖고 있다(haversine·getEffectiveLoad·extractRoadAddress·parseAptDong…).
 *   그런데 이 워커는 `RouteMapModal.jsx:1609` 에서 **`{ type: 'module' }`** 로 로드된다 —
 *   즉 **import 를 쓸 수 있는데도 복제**돼 있다. 복제할 이유가 없었다.
 *
 *   복제를 제거하려면 먼저 알아야 할 것이 있다: **두 벌이 이미 갈라졌는가?**
 *   갈라진 걸 모르고 원본으로 교체하면 물량배분 결과가 조용히 바뀐다 —
 *   그건 기사별 담당 구역이 바뀐다는 뜻이고, 현장에서 사고로 나타난다.
 *
 * ★워커를 어떻게 테스트하는가
 *   워커는 `export` 가 0개라 import 할 수 없다. 대신 소스를 읽어 함수 스코프에서 평가하고
 *   내부 선언을 꺼낸다(`new Function`). 로컬 소스 파일만 다루므로 외부 입력이 개입하지 않는다.
 *   `self.onmessage` 대입이 있으므로 self 스텁을 준다.
 *
 *   이 방식은 `server-parity.test.mjs` 가 클라↔서버 정제 결과를 기계적으로 잠그는 것과 같은
 *   목적이다: **사본이 갈라지는 것을 사람이 아니라 테스트가 막는다.**
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

/** 워커 소스에서 꺼내볼 내부 선언 이름. 여기 없는 건 비교 대상이 아니다. */
const EXTRACT = [
  'haversine', 'getEffectiveLoad', 'getAddr', 'getQty', 'norm',
  'extractRoadAddress', 'parseAptDong', 'isApartmentLike',
  'RENTAL_KEYWORDS', 'STAIRS_KEYWORDS', 'HEAVY_NOTE_KW', 'MEDIUM_NOTE_KW',
];

let worker;
let engine;
let close;

before(async () => {
  const src = await readFile(path.join(ROOT, 'src/workers/routeWorker.js'), 'utf8');
  // 함수 스코프에서 평가 → const/function 선언에 접근 가능. self 는 스텁.
  const factory = new Function(
    'self',
    `${src}\n; return { ${EXTRACT.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ')} };`,
  );
  worker = factory({ onmessage: null, postMessage: () => {} });

  const loaded = await loadClientModule('/src/engine/routeSequenceEngine.js');
  engine = loaded.mod;
  close = loaded.close;
});

after(async () => {
  if (close) await close();
});

/** 실제 명단 모양의 고정 입력(PII 없음). 한글 키 = 엔진·워커 공통 계약. */
const CASES = [
  { 주소: '경기 부천시 중동로 100', 포수: 2 },
  { 주소: '경기 부천시 부천로 15 삼성아파트 101동 502호', 포수: 1 },
  { 주소: '경기 부천시 소사로 77 행복빌라 3층', 포수: 4 },
  { 주소: '경기 부천시 성주로 20 LH국민임대 105동 1502호', 포수: 25 },
  { 주소: '경기 부천시 원미로 9', 포수: 3, 특이사항: '문앞' },
  { 주소: '경기 부천시 조마루로 385', 포수: 2, 특이사항: '경비실' },
  { 주소: '', 포수: 1 },
];

describe('워커가 재정의한 함수가 원본과 같은 답을 내는가', () => {
  test('추출 자체가 성공했는지 — 실패하면 이 테스트 전체가 무의미하다', () => {
    assert.equal(typeof worker.haversine, 'function', '워커에서 함수를 못 꺼냈다');
    assert.equal(typeof worker.getEffectiveLoad, 'function');
    assert.ok(Array.isArray(worker.RENTAL_KEYWORDS));
  });

  test('haversine — 거리 계산이 동일', () => {
    const pts = [
      [37.5030, 126.7660, 37.4820, 126.7955],
      [37.4988, 126.7731, 37.5051, 126.7702],
      [37.5, 126.7, 37.5, 126.7],
    ];
    for (const [a, b, c, d] of pts) {
      assert.equal(worker.haversine(a, b, c, d), engine.haversine(a, b, c, d),
        `haversine 이 갈라졌다: ${a},${b} → ${c},${d}`);
    }
  });

  test('★getEffectiveLoad — 체감물량이 동일 (물량배분의 기준값)', () => {
    for (const rec of CASES) {
      assert.equal(worker.getEffectiveLoad(rec), engine.getEffectiveLoad(rec),
        `체감물량이 갈라졌다 → 기사별 물량배분이 달라진다: ${JSON.stringify(rec)}`);
    }
  });

  test('extractRoadAddress — 도로명 추출이 동일', () => {
    for (const rec of CASES) {
      assert.equal(worker.extractRoadAddress(rec['주소']), engine.extractRoadAddress(rec['주소']),
        `도로명 추출이 갈라졌다: ${rec['주소']}`);
    }
  });

  test('★★parseAptDong — 이름은 같은데 **계약이 다르다**(복제 제거 최대 함정)', () => {
    // 실측 2026-08-03:
    //   워커 : parseAptDong(record)  — record 의 _detailAddress·detailAddress·주소·특이사항을 조합
    //   원본 : parseAptDong(addr)    — 주소 **문자열**을 받음
    // 같은 이름·다른 시그니처다. 복제를 제거하면서 워커 호출부를 원본으로 그대로 바꾸면
    // 인자가 객체로 들어가 **전부 null** 이 되고, 아파트 동 그룹핑이 통째로 깨진다.
    // (그러면 같은 동 세대가 흩어져 순번·물량배분이 조용히 망가진다.)
    assert.equal(worker.parseAptDong('경기 부천시 부천로 15 삼성아파트 101동 502호'), null,
      '워커에 문자열을 넘기면 null 이다 — 이 사실이 바뀌면 복제 제거 전략을 재검토할 것');

    // 각자의 계약대로 부르면 답은 같아야 한다. 이게 "로직은 같다"의 증명이다.
    for (const rec of CASES) {
      assert.equal(worker.parseAptDong(rec), engine.parseAptDong(rec['주소']),
        `각자 계약대로 불렀는데 답이 다르다 — 로직이 갈라졌다: ${JSON.stringify(rec)}`);
    }
  });

  test('parseAptDong — 워커는 상세주소도 본다(원본에 없는 입력 경로)', () => {
    // 워커만 `_detailAddress`·`detailAddress` 를 본다. 원본에 그 경로가 없으므로
    // 복제 제거 시 **입력을 어떻게 만들어 넘길지**까지 정해야 한다.
    const withDetail = { 주소: '경기 부천시 부천로 15', detailAddress: '103동 201호' };
    assert.equal(worker.parseAptDong(withDetail), 103);
    assert.equal(engine.parseAptDong(withDetail['주소']), null,
      '원본은 주소만 보므로 상세주소의 동을 못 찾는다 — 통합 시 이 입력 경로를 살려야 한다');
  });

  test('isApartmentLike — 아파트 판별이 동일', () => {
    if (typeof worker.isApartmentLike !== 'function') return;   // 워커에 없으면 비교 대상 아님
    for (const rec of CASES) {
      assert.equal(worker.isApartmentLike(rec), engine.isApartmentLike(rec),
        `아파트 판별이 갈라졌다: ${JSON.stringify(rec)}`);
    }
  });
});

describe('★상수 파리티 — 키워드 한 개 차이가 물량배분을 바꾼다', () => {
  const compare = (name, engineValue) => {
    const w = worker[name];
    if (!Array.isArray(w)) return;
    assert.deepEqual(
      [...w].sort(), [...(engineValue || [])].sort(),
      `${name} 가 갈라졌다 — 임대·계단·특이사항 판정이 달라져 체감물량이 바뀐다`,
    );
  };

  test('RENTAL_KEYWORDS (임대 할인 판정)', () => {
    // 엔진은 RENTAL_KEYWORDS 를 export 하지 않을 수 있다 — 그 경우 정규식으로 간접 비교한다.
    if (Array.isArray(engine.RENTAL_KEYWORDS)) {
      compare('RENTAL_KEYWORDS', engine.RENTAL_KEYWORDS);
      return;
    }
    assert.ok(engine.RENTAL_LIKE_RE instanceof RegExp, '엔진 쪽 임대 판정 근거를 찾을 수 없다');
    for (const kw of worker.RENTAL_KEYWORDS) {
      assert.ok(engine.RENTAL_LIKE_RE.test(kw),
        `워커의 임대 키워드 '${kw}' 를 엔진 정규식이 인정하지 않는다 — 판정이 갈라진다`);
    }
  });

  test('STAIRS_KEYWORDS / HEAVY_NOTE_KW / MEDIUM_NOTE_KW 존재', () => {
    // 엔진이 export 하지 않는 상수는 값 비교가 불가능하다. 최소한 워커 쪽 구성을 고정해
    // 나중에 조용히 바뀌는 것을 막는다(복제 제거 시 이 테스트가 갱신 대상이 된다).
    assert.deepEqual(worker.STAIRS_KEYWORDS, ['빌라', '연립', '다세대', '단독주택']);
    assert.deepEqual(worker.HEAVY_NOTE_KW, ['문앞', '거동불편', '직접전달', '현관앞', '직접']);
    assert.deepEqual(worker.MEDIUM_NOTE_KW, ['전화필수', '골목', '경비실', '게이트']);
  });
});
