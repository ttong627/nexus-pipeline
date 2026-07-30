// 주소 엔진 골든 회귀 테스트 (P7 Phase2 선행 안전망)
//
// 목적: 규격화 로직을 서버로 이관할 때 **클라이언트의 현재 출력이 그대로 유지되는지**를
//       기계적으로 증명한다. 지금까지는 "테스트는 통과했지만 실제 정제 결과가 같은지"를
//       형이 화면에서 눈으로 볼 수밖에 없었다.
//
// 2단
//   offline : 외부 호출 0. 어디서 돌려도 항상 같다 → 규격화 규칙(A-1~A-29)의 상시 잠금장치.
//   replay  : 녹화된 API 응답 재생. 법정동·건물명까지 포함한 완성 파이프라인을 고정.
//
// 골든을 의도적으로 바꿀 때:  node scripts/golden/record.mjs [--mode record]
// ※ 실행: node --test scripts/address-golden.test.mjs   (vite SSR 로더 사용 — 별도 의존성 없음)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runCases, readGolden, goldenPath } from './golden/runner.mjs';

const compare = async (mode) => {
  const expected = readGolden(mode);
  assert.ok(expected, `골든 스냅샷이 없다: ${goldenPath(mode)} — record.mjs로 먼저 생성할 것`);

  const { snapshots, misses } = await runCases(mode);
  assert.equal(misses.length, 0, `카세트 미녹화 요청 ${misses.length}건: ${misses.slice(0, 3).join(' | ')}`);

  const ids = Object.keys(expected);
  assert.deepEqual(Object.keys(snapshots).sort(), ids.sort(), '케이스 목록이 골든과 다르다');

  const diffs = ids.filter((id) => JSON.stringify(snapshots[id]) !== JSON.stringify(expected[id]));
  assert.deepEqual(
    diffs.map((id) => ({ id, 골든: expected[id].주소, 현재: snapshots[id].주소 })),
    [],
    `${diffs.length}건의 정제 결과가 골든과 달라졌다 (의도한 변경이면 record.mjs로 골든 갱신)`,
  );
  return ids.length;
};

test('골든(offline) — 외부 호출 없이 규격화 결과가 고정된다', async () => {
  const count = await compare('offline');
  assert.ok(count >= 30, `offline 케이스가 너무 적다(${count})`);
});

test('골든(replay) — 녹화된 API 응답으로 전체 파이프라인 결과가 고정된다', async (t) => {
  if (!fs.existsSync(goldenPath('replay'))) return t.skip('카세트 골든 없음 (record.mjs --mode record 로 생성)');
  await compare('replay');
});

test('골든 산출물에 시크릿·배포 URL이 없다', () => {
  const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  const secrets = [...env.matchAll(/^(VITE_[A-Z_0-9]+)=(.+)$/gm)]
    .map(([, name, value]) => [name, value.trim()])
    .filter(([, value]) => value.length > 12);

  for (const file of ['scripts/golden/cassette.json', 'scripts/golden/golden-api.json', 'scripts/golden/golden-offline.json']) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const [name, value] of secrets) {
      assert.ok(!text.includes(value), `${file} 에 ${name} 값이 포함돼 있다`);
    }
  }
});
