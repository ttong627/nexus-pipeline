// 분리한 화면 컴포넌트의 **배선** 회귀 — 2026-08-24 Phase 4-6
//   node --test scripts/component-wiring.test.mjs
//
//   왜 필요한가: 큰 화면을 컴포넌트로 쪼갤 때 가장 흔한 사고는 **prop 을 빠뜨리는 것**이다.
//   그런데 이건 빌드도 통과하고 eslint 도 통과한다 — `undefined` 가 넘어가서 그 버튼만 조용히 죽는다.
//   실제로 이 검사가 `FileMergeTab` 의 시트 전환 함수 2개 누락을 잡았다(2026-08-24).
//
//   검사 내용: 각 자식 컴포넌트가 선언한 props 를 부모가 **전부 넘기는지**.
//   ※값의 정확성은 못 본다(그건 화면 확인 몫 — docs/MANUAL_CHECKLIST.md).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 부모 화면 → 자식 컴포넌트 폴더
const PAIRS = [
  { parent: 'src/components/UtilsModal.jsx', dir: 'src/components/utils' },
  { parent: 'src/components/RouteMapModal.jsx', dir: 'src/components/routeMap' },
  { parent: 'src/components/CloudListManager.jsx', dir: 'src/components/cloudList' },
  { parent: 'src/components/AdminPanel.jsx', dir: 'src/components/admin' },
];

const propsOf = (src) => {
  const m = src.match(/export default function \w+\(\{([\s\S]*?)\}\)\s*\{/);
  if (!m) return null;                                   // props 를 안 받는 컴포넌트
  // ★줄 단위로만 가르면 한 줄에 모아 쓴 컴포넌트를 통째로 하나의 prop 으로 본다 — 쉼표까지 분해한다(2026-08-24 실측).
  return m[1].split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
};

describe('분리한 화면 컴포넌트 배선 — prop 을 빠뜨리면 그 기능만 조용히 죽는다', () => {
  for (const { parent, dir } of PAIRS) {
    test(`${path.basename(parent)} → ${path.basename(dir)}/*`, async () => {
      const parentSrc = await readFile(path.join(ROOT, parent), 'utf8');
      let files = [];
      try { files = (await readdir(path.join(ROOT, dir))).filter((f) => f.endsWith('.jsx')); } catch { return; }
      assert.ok(files.length > 0, `${dir} 에 컴포넌트가 없다 — 검사가 헛돈다`);

      const problems = [];
      for (const file of files) {
        const name = file.replace(/\.jsx$/, '');
        const childSrc = await readFile(path.join(ROOT, dir, file), 'utf8');
        const props = propsOf(childSrc);
        if (!props || props.length === 0) continue;

        if (!parentSrc.includes(`${name} from`)) { problems.push(`${name}: 부모가 import 하지 않는다`); continue; }
        // ★String.raw 필수 — 일반 템플릿이면 백슬래시가 한 겹 날아가 `\s` 가 **문자 s** 로 죽는다.
        //   그러면 정규식이 아무 것도 못 찾는데 테스트는 "전부 누락"이라고 말한다(2026-08-24 실측으로 걸렀다).
        const use = parentSrc.match(new RegExp(String.raw`<${name}[\s\S]*?/>`));
        if (!use) { problems.push(`${name}: 부모에 사용처가 없다`); continue; }
        const passed = new Set([...use[0].matchAll(/(\w+)=\{/g)].map((m) => m[1]));
        const missing = props.filter((p) => !passed.has(p));
        if (missing.length) problems.push(`${name}: 전달 안 된 prop ${missing.join(', ')}`);
      }
      assert.deepEqual(problems, [], `배선 누락:\n  ${problems.join('\n  ')}`);
    });
  }
});
