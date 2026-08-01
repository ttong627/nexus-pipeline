// 서버 파리티 — node --test scripts/server-parity.test.mjs
//
//   질문: "서버가 정제하면 클라가 정제한 것과 **똑같이** 나오는가?"
//   지금까지는 눈으로 확인할 수밖에 없었다. 이 테스트가 기계적으로 답한다.
//
//   방법: 클라 출력으로 굳혀둔 `golden-offline.json`(35케이스)을,
//         **서버가 실제로 쓰는 조립**(services/address-service/src/purify.js의 createPurifier)에
//         그대로 태워 deepEqual 한다. 조립이 어긋나면(사전 기본값·Kakao 규칙·deps 배선 등)
//         여기서 즉시 깨진다.
//
//   왜 offline 케이스인가: offline은 외부 호출이 전부 실패하는 조건이라 DB·Kakao 상태와
//   무관하게 항상 같은 답이 나온다. 이관 대상인 **규격화 규칙(A-1~A-29)** 이 offline이
//   전부 커버한다(법정동·건물명 보강은 원래 서버 담당이라 이관 범위 밖).
//
//   ※ 이 테스트는 DB도 자격증명도 필요 없다. matchAddress는 null 스텁, Kakao 키는 빈 값,
//     학습사전은 빈 사전(클라 골든도 사전 미로드 상태에서 녹화됐다 — 같은 조건).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCases, selectCases, readGolden, snapshot } from './golden/runner.mjs';
import { createPurifier } from '../services/address-service/src/purify.js';
import { createDictStore } from '../services/address-service/src/dictStore.js';

// 클라 골든과 같은 조건: 학습사전 없음(기본 특수문자만) — Firestore·firebase-admin 불필요.
// ※ specialChars를 안 넘기는 것도 의도적이다 — deriveDicts가 기본값으로 되돌리는지까지 검증한다.
const emptyDictStore = () => createDictStore({ loader: async () => ({}) });

const runServer = async () => {
  const calls = { match: 0, fetch: 0 };
  const purifier = createPurifier({
    // offline = 전국 주소DB 미조회(클라 카세트 offline 모드와 동일 조건)
    matchAddress: async () => { calls.match += 1; return null; },
    dictStore: emptyDictStore(),
    kakaoRestKey: '',                                   // Kakao 키 없음 → 보강조회 없음
    fetchImpl: async () => { calls.fetch += 1; throw new TypeError('fetch failed (parity)'); },
    concurrency: 1,                                     // 결정성 우선(순서·상태 흔들림 차단)
  });

  const cases = selectCases(loadCases(), 'offline');
  const records = cases.map((c) => ({
    addr: c.input.addr || '', name: c.input.name || '',
    adminDong: c.input.adminDong || '', cityLabel: c.input.cityLabel || '', note: c.input.note || '',
  }));
  const results = await purifier.purifyRecords(records);
  const snapshots = {};
  cases.forEach((c, i) => { snapshots[c.id] = snapshot(results[i]); });
  return { snapshots, cases, calls };
};

test('서버 정제 결과가 클라 골든(offline 35케이스)과 완전히 같다', async () => {
  const expected = readGolden('offline');
  assert.ok(expected, 'golden-offline.json이 없다 — record.mjs로 먼저 생성할 것');

  const { snapshots, cases } = await runServer();
  assert.equal(cases.length, Object.keys(expected).length, '케이스 수가 골든과 다르다');
  assert.deepEqual(Object.keys(snapshots).sort(), Object.keys(expected).sort(), '케이스 목록이 골든과 다르다');

  const diffs = Object.keys(expected).filter((id) => JSON.stringify(snapshots[id]) !== JSON.stringify(expected[id]));
  assert.deepEqual(
    diffs.map((id) => ({ id, 클라골든: expected[id].주소, 서버: snapshots[id].주소 })),
    [],
    `${diffs.length}건이 클라와 다르게 정제됐다 — 서버 deps 조립(사전 기본값·Kakao 규칙·배선)을 점검할 것`,
  );
});

test('정제 중 한 건도 예외로 죽지 않는다(_error 없음)', async () => {
  const { snapshots } = await runServer();
  const broken = Object.entries(snapshots).filter(([, v]) => v._error).map(([id, v]) => `${id}: ${v._error}`);
  assert.deepEqual(broken, [], '정제 중 예외 발생');
});

test('서버는 자기 자신에게 HTTP를 치지 않는다 — matchAddress는 in-process 호출', async () => {
  const { calls } = await runServer();
  assert.ok(calls.match > 0, 'matchAddress가 한 번도 안 불렸다 — lookupAddr 배선이 끊겼다');
  assert.equal(calls.fetch, 0, 'Kakao 키가 없는데 fetch가 나갔다(불필요한 외부 호출)');
});

// ★★2026-08-01 배포 직후 실측 사고 — 회귀 금지.
//   DB 커넥션이 일시적으로 실패했는데 그 실패를 null로 캐시해버려, 커넥션이 회복된 뒤에도
//   '왕산로 72'가 법정동·건물명 없이 정제됐다(웜 0.09초에도 동일). 서버 인스턴스는 minScale=1로
//   오래 살아 있어서 브라우저처럼 새로고침으로 캐시가 날아가지 않는다.
test('★조회 실패는 캐시하지 않는다 — 회복되면 즉시 정상 매칭', async () => {
  let dbUp = false;   // 한 배치는 lookupAddr을 여러 번 부른다 → 호출 횟수가 아니라 'DB 상태'로 재현
  const matched = {
    roadAddrPart1: '서울특별시 동대문구 왕산로 72', standardRoadAddress: '서울특별시 동대문구 왕산로 72',
    legalDong: '용두동', emdNm: '용두동', bdNm: '동대문한양아이클래스', bdMgtSn: 'X',
    matchedSido: '서울특별시', matchedSigungu: '동대문구', _matchSource: 'national_address_db',
  };
  const purifier = createPurifier({
    matchAddress: async () => {
      if (!dbUp) throw new Error('timeout exceeded when trying to connect');   // 커넥션 일시 실패
      return matched;
    },
    dictStore: emptyDictStore(), kakaoRestKey: '',
    fetchImpl: async () => { throw new TypeError('no network'); },
    concurrency: 1,
  });

  const input = [{ addr: '동대문구 왕산로 72, 201호', name: '홍길동', cityLabel: '서울특별시 동대문구' }];
  const [first] = await purifier.purifyRecords(input);
  assert.equal(first.법정동, '', 'DB가 죽어 있는 동안 보강이 안 되는 것은 정상');

  dbUp = true;                                   // 커넥션 회복
  const [second] = await purifier.purifyRecords(input);
  assert.equal(second.법정동, '용두동',
    '⚠️ 실패를 캐시했다 — DB가 회복돼도 이 주소는 영원히 법정동·건물명 없이 정제된다');
  assert.equal(second.buildingName, '동대문한양아이클래스');
});

test('조회 결과 "없음"은 캐시한다 — 같은 주소를 반복 조회하지 않는다', async () => {
  let calls = 0;
  const purifier = createPurifier({
    matchAddress: async () => { calls += 1; return null; },   // 진짜 미매칭
    dictStore: emptyDictStore(), kakaoRestKey: '',
    fetchImpl: async () => { throw new TypeError('no network'); },
    concurrency: 1,
  });
  const input = [{ addr: '왕산로 72', cityLabel: '서울특별시 동대문구' }];
  await purifier.purifyRecords(input);
  const after = calls;
  await purifier.purifyRecords(input);
  assert.equal(calls, after, '미매칭 결과가 캐시되지 않아 DB를 반복 조회한다');
});

test('빈 records·초과 요청은 배치 실행기가 안전하게 처리한다', async () => {
  const purifier = createPurifier({
    matchAddress: async () => null, dictStore: emptyDictStore(), kakaoRestKey: '',
    fetchImpl: async () => { throw new TypeError('no network'); },
  });
  assert.deepEqual(await purifier.purifyRecords([]), []);
  const [nullRecord] = await purifier.purifyRecords([null]);
  assert.equal(nullRecord.확인필요, true, '주소 공란은 확인필요로 표시돼야 한다(A-12)');
});
