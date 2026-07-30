// 골든 회귀 — 스냅샷 녹화 (P7 Phase2 선행)
//
//   node scripts/golden/record.mjs                # offline 골든만 갱신(외부 호출 0)
//   node scripts/golden/record.mjs --mode record  # 실제 API 호출로 카세트 + api 골든 녹화
//   node scripts/golden/record.mjs --mode replay  # 카세트 재생으로 api 골든만 재계산
//
// ⚠️ --mode record 는 운영 주소 API를 실제로 호출한다(순차·읽기전용). 데이터는 쓰지 않는다.
// ⚠️ 녹화 결과가 바뀌면 "엔진이 바뀐 것"이므로, 그 변경이 의도된 것인지 확인하고 커밋한다.

import { runCases, readGolden, writeGolden, goldenPath } from './runner.mjs';

const ARGS = process.argv.slice(2);
const modeIndex = ARGS.indexOf('--mode');
const MODE = modeIndex >= 0 ? ARGS[modeIndex + 1] : 'offline';

if (!['offline', 'replay', 'record'].includes(MODE)) {
  console.error(`알 수 없는 모드: ${MODE} (offline|replay|record)`);
  process.exit(1);
}

const previous = readGolden(MODE);
const { snapshots, misses, cases } = await runCases(MODE);

let changed = 0;
for (const id of Object.keys(snapshots)) {
  const before = previous?.[id];
  if (JSON.stringify(before) !== JSON.stringify(snapshots[id])) {
    changed += 1;
    if (before) {
      console.log(`\n[변경] ${id}`);
      console.log(`  이전: ${JSON.stringify(before.주소 ?? before)}`);
      console.log(`  이후: ${JSON.stringify(snapshots[id].주소 ?? snapshots[id])}`);
    }
  }
}

writeGolden(MODE, snapshots);

console.log(`\n골든 갱신 완료 | 모드 ${MODE} | 케이스 ${cases.length}건 | 신규·변경 ${changed}건`);
console.log(`  → ${goldenPath(MODE)}`);
if (misses.length) {
  console.log(`\n⚠️ 카세트 미녹화 요청 ${misses.length}건 (--mode record 로 녹화 필요):`);
  misses.slice(0, 10).forEach((m) => console.log(`  - ${m.split('\n')[0]}`));
}
