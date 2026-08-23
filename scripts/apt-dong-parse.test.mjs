/**
 * `parseAptDong` 대시 동호 규칙 잠금 — 2차 패턴의 `호` 는 **필수**다.
 *
 * ★경위 (2026-08-11)
 *   2차 패턴이 `(\d{3,4})\s*-\s*\d{1,4}\s*호?` 였다. `호` 가 optional 이라
 *   **`호` 없는 숫자쌍이면 무엇이든 동 번호로 읽혔다.**
 *   순번 엔진(`getSequenceUnitMeta`·`sortSequenceUnitRecords`)과 물량배분
 *   (`loadBalance`), 동 좌표 조회(`purifyCore`)가 전부 이 값으로 묶는다.
 *
 * ★전 명단 실측이 근거다 (`scripts/measure-dong-parse.mjs` · 98,020건 · 16개 명단)
 *   | 달라지는 건 | 4,359 (4.45%) |
 *   | ├ 전화번호 오탐        | 117   | `◆2층 010-3947-7678` → 10동 |
 *   | ├ 도로명 부번 오탐     | 4,229 | `삼작로 376-1, B동 106호` → 376동 |
 *   | ├ 괄호 안 지번 오탐    | 11    | `(상대원동 1604-1 공동주택)` → 1604동 |
 *   | └ ⚠️판정 대상          | 2     | 둘 다 지번(`단현동 354-12`) — 역시 오탐 |
 *   **`호` 없는 정상 동호 표기는 0건**이었다. 그래서 필수화는 퇴행이 아니다.
 *   덤으로 **578건이 가려져 있던 진짜 동을 되찾는다** — 도로 번호가 주소 앞에 있어
 *   `중앙로 265-36, 106-1305호 (우방아파트)` 가 106동이 아니라 265동으로 읽혔다.
 *
 * 이 테스트가 깨지면 오탐이 부활한 것이다. 규칙을 되돌리지 말 것.
 * 실행: node --test scripts/apt-dong-parse.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  getSequenceUnitMeta, parseAptDong,
} from '../services/address-service/src/routing/routeSequenceEngine.js';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

// 루트맵 관련 파일 전수 — 분할해도 가드가 따라간다(경로를 하드코딩하면 떼어낸 조각이 검사에서 빠진다)
const collectRouteMapFiles = async () => {
  const out = [path.join(ROOT, 'src/components/RouteMapModal.jsx')];
  const walk = async (d) => {
    let entries = [];
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
    }
  };
  await walk(path.join(ROOT, 'src/components/routeMap'));
  return out;
};

describe('오탐 — 동이 아닌 숫자쌍을 동으로 읽지 않는다', () => {
  /** 설계서 §5-3-A 실측 5건. 전부 상세주소가 없는 단독·전원주택이고 숫자는 **도로명 부번**이다. */
  const 도로명_부번 = [
    '경기도 시흥시 동서로 895-24, (정왕동)',
    '경기도 시흥시 수인로 2164-53, (매화동)',
    '경기도 시흥시 하우로 192-6, (매화동)',
    '경기도 시흥시 동서로 250-16, (정왕동)',
    '경기도 시흥시 금오로 349-5, (금이동)',
  ];
  for (const addr of 도로명_부번) {
    test(`도로명 부번은 동이 아니다 — ${addr}`, () => {
      assert.equal(parseAptDong(addr), null,
        '도로명 건물번호의 부번을 동으로 읽었다 — 2차 패턴의 `호` 가 optional 로 되돌아갔다');
    });
  }

  test('전화번호를 동으로 읽지 않는다', () => {
    // `010-3947` 이 매치돼 **10동**이 됐다. 특이사항에 번호가 있으면 어느 주소든 걸렸다.
    assert.equal(parseAptDong('경기도 부천시 삼작로396번길 22-1, (원종동) ◆2층 010-3947-7678'), null);
    assert.equal(parseAptDong('서울특별시 동대문구 답십리로 259, (장안동) 010-5324-0066'), null);
  });

  test('괄호 안 지번을 동으로 읽지 않는다', () => {
    // 건물명 슬롯에 지번이 들어온 서식. `109-5` → 109동, `1604-1` → 1604동이었다.
    assert.equal(parseAptDong('경기도 부천시 부일로763번길 35, (역곡동, 역곡동 109-5 제1종근린생활시설) ◆204호'), null);
    assert.equal(parseAptDong('경기도 성남시 박석로15번길 27, 502호 (상대원동, 상대원동 1604-1 공동주택)'), null);
  });

  test('비숫자 동(B동·나동)이 진짜 동일 때 도로 번호를 대신 집지 않는다', () => {
    // 엔진은 숫자 동만 다룬다. 못 읽는 것이 맞고, **376동을 지어내는 것**이 틀렸다.
    assert.equal(parseAptDong('경기도 부천시 삼작로 376-1, B동 106호 (원종동, 청룡연립)'), null);
    assert.equal(parseAptDong('경기도 부천시 장말로352번길 42, 나동 101호 (심곡동, 성심연립)'), null);
  });
});

describe('정상 — 진짜 동호 표기는 그대로 읽는다', () => {
  const 정상 = [
    ['경기도 시흥시 정왕대로 233, 1302-1411호 (정왕동, 아파트)', 1302],  // 시흥 표준 표기
    ['경기 부천시 부천로 15 삼성아파트 101동 502호', 101],               // 1차 패턴(`101동`)
    ['경기도 수원시 권선로 472, 101- 203호 3층 (권선동, 래미안)', 101],   // A-11 정제 결과 형식
    ['충청남도 천안시 중앙로 265-36, 106-1305호 (신부동, 우방아파트)', 106],
    ['충청남도 천안시 서부대로 226-11, 303-1202호 (신방동, 향촌현대아파트)', 303],
  ];
  for (const [addr, expected] of 정상) {
    test(`${expected}동 — ${addr}`, () => {
      assert.equal(parseAptDong(addr), expected);
    });
  }

  test('★가려져 있던 진짜 동을 되찾는다(실측 578건)', () => {
    // 도로 번호가 주소 **앞**에 있어 먼저 매치됐다. 예전 값은 265(도로 265-36)였다.
    assert.equal(parseAptDong('충청남도 천안시 중앙로 265-36, 106-1305호 (신부동, 우방아파트)'), 106);
    assert.equal(parseAptDong('충청남도 천안시 풍세로 1010-31, 104-1605호 (청수동, 청수현대아파트)'), 104);
  });

  test('`호` 가 1~2자리여도 동호는 동호다', () => {
    assert.equal(parseAptDong('경기도 부천시 부천로416번길 41, 102- 1호 1층 (내동, 성원주택)'), 102);
  });
});

describe('순번 그룹핑 — 오탐이 배송 단위를 뭉개던 자리', () => {
  test('같은 단지의 다른 동은 다른 순번 단위가 된다', () => {
    // 예전엔 둘 다 도로 번호 265 로 읽혀 `apt:…:265` **한 덩어리**("우방아파트 265동")였다.
    const a = getSequenceUnitMeta({ id: 1, 주소: '충청남도 천안시 중앙로 265-36, 106-1305호 (신부동, 우방아파트)' });
    const b = getSequenceUnitMeta({ id: 2, 주소: '충청남도 천안시 중앙로 265-36, 103-1002호 (신부동, 우방아파트)' });
    assert.equal(a.label, '우방아파트 106동');
    assert.equal(b.label, '우방아파트 103동');
    assert.notEqual(a.key, b.key, '서로 다른 동이 한 배송 단위로 묶였다');
  });

  test('단지형으로 잡히는 마을 주소에 없는 동을 만들지 않는다', () => {
    // `마을`이 APT_LIKE_RE 에 걸려 단지형으로 잡힌다. 예전엔 도로 부번이 동이 돼
    // "매화마을 2164동" 이라는 없는 동이 생겼다.
    const meta = getSequenceUnitMeta({ id: 3, 주소: '경기도 시흥시 수인로 2164-53, (매화동, 매화마을)' });
    assert.equal(meta.label, '매화마을');
    assert.ok(meta.key.endsWith(':all'), `없는 동 번호가 붙었다: ${meta.key}`);
  });
});

describe('복제 금지 — 규칙은 SSOT 한 곳에만 산다', () => {
  // 순번 엔진 규칙은 `services/address-service/src/routing/routeSequenceEngine.js` 한 곳에만 산다.
  //   2026-08-11 에 `parseAptDong` 복제본을, 2026-08-23 에 **41개 심볼 복제본**을 제거했다.
  //   복제는 드리프트가 생기기 전엔 무증상이다 — 다음 수정이 한쪽에만 들어가는 순간 화면과 서버 순번이 갈라진다.
  //   ★검사 대상은 파일 하나가 아니라 **루트맵 관련 파일 전체**다(Phase 0-2).
  //     경로를 하나로 박아 두면 파일을 쪼갠 순간 떼어낸 조각이 검사에서 조용히 빠진다.
  const ENGINE_PATH = 'services/address-service/src/routing/routeSequenceEngine.js';

  test('루트맵이 엔진에서 parseAptDong 을 가져온다(재정의 아님)', async () => {
    const targets = await collectRouteMapFiles();
    assert.ok(targets.length >= 2, `검사 대상 파일을 못 찾았다(${targets.length}개) — 가드가 헛돈다`);
    const sources = await Promise.all(targets.map((f) => readFile(f, 'utf8')));
    const importsIt = sources.some((src) =>
      /import\s*\{[^}]*\bparseAptDong\b[^}]*\}\s*from\s*['"][^'"]*routeSequenceEngine\.js['"]/.test(src));
    assert.ok(importsIt, '루트맵 어디에서도 엔진의 parseAptDong 을 import 하지 않는다');
    const redefined = targets.filter((f, i) => /^\s*(?:const|function|let)\s+parseAptDong\s*[=(]/m.test(sources[i]));
    assert.deepEqual(redefined.map((f) => path.relative(ROOT, f)), [], 'parseAptDong 재정의가 생겼다 — 복제가 부활했다');
  });

  test('★엔진 심볼을 어디서도 재정의하지 않는다(전 심볼 가드)', async () => {
    const engineSrc = await readFile(path.join(ROOT, ENGINE_PATH), 'utf8');
    const exported = [...engineSrc.matchAll(/^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    assert.ok(exported.length > 30, `엔진 export 를 못 읽었다(${exported.length}개) — 가드가 헛돈다`);
    const targets = await collectRouteMapFiles();
    const dup = [];
    for (const file of targets) {
      const src = await readFile(file, 'utf8');
      for (const name of exported) {
        if (new RegExp(`^\\s*(?:const|function|let)\\s+${name}\\s*[=(]`, 'm').test(src)) {
          dup.push(`${path.relative(ROOT, file)}:${name}`);
        }
      }
    }
    assert.deepEqual(dup, [],
      `엔진 심볼 재정의가 생겼다(복제 부활): ${dup.join(', ')}` + '\n→ 엔진에서 import 해서 쓰세요(SSOT).');
  });

  test('엔진 정규식의 `호` 가 필수로 유지된다', async () => {
    const src = await readFile(
      path.join(ROOT, 'services/address-service/src/routing/routeSequenceEngine.js'), 'utf8');
    assert.ok(!/\\s\*\\d\{1,4\}\\s\*호\?/.test(src),
      '2차 패턴의 `호` 가 다시 optional(`호?`) 이 됐다 — 실측 4,357건 오탐이 부활한다');
  });
});
