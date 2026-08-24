// 훅 의존성 배열이 **아래에서 선언되는 값**을 읽는 것을 막는다 — 2026-08-24 정밀점검
//   node --test scripts/hook-dep-tdz.test.mjs
//
//   왜 이걸 따로 잠그나: 의존성 배열은 **렌더 중에 평가된다**. 배열 안의 이름이 그 아래에서
//   `const` 로 선언되면 자바스크립트는 그 자리에서 `ReferenceError: Cannot access 'X' before
//   initialization` 을 던진다 — 즉 **화면이 열리자마자 죽는다**.
//   실제로 `ShareRouteView` 가 2026-08-13 부터 그 상태였고(열람기록 블록의 `allRecords`·`driver`·`usingSub`),
//   운영 열람기록이 0건이던 진짜 이유였다. eslint 는 경고로 알려주고 있었지만 경고 120건 더미에 묻혀 있었다.
//   그래서 **이 한 가지만 보는 테스트**로 따로 세운다 — 묻히지 않게.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const walk = async (dir, out = []) => {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') await walk(full, out); }
    else if (e.name.endsWith('.jsx')) out.push(full);
  }
  return out;
};

// 컴포넌트 본문 최상위(들여쓰기 2칸)의 `const X =` / `const { a, b } =` 선언 줄번호
const declLines = (lines) => {
  const map = new Map();
  lines.forEach((l, i) => {
    let m = /^ {2}const \[?([A-Za-z_$][\w$]*)/.exec(l);
    if (m && !map.has(m[1])) map.set(m[1], i);
    m = /^ {2}const \{([^}]*)\}/.exec(l);
    if (m) for (const part of m[1].split(',')) {
      const name = part.includes(':') ? part.split(':')[1] : part;
      const n = name.trim().replace(/=.*$/, '').trim();
      if (n && !map.has(n)) map.set(n, i);
    }
    m = /^ {2}const \[([^\]]*)\]/.exec(l);
    if (m) for (const part of m[1].split(',')) {
      const n = part.trim();
      if (n && !map.has(n)) map.set(n, i);
    }
  });
  return map;
};

// 한 파일에 컴포넌트가 여러 개면 **각자의 몸통 안에서만** 비교한다.
//   (안 그러면 안쪽 컴포넌트의 prop `drivers` 를 바깥 컴포넌트의 state 선언과 견줘 오탐이 난다 — 실제로 겪었다)
const componentRanges = (lines) => {
  const starts = [];
  lines.forEach((l, i) => {
    if (/^(export default )?function [A-Z][\w$]*\s*\(/.test(l) || /^const [A-Z][\w$]*\s*=/.test(l)) starts.push(i);
  });
  return starts.map((st, k) => [st, k + 1 < starts.length ? starts[k + 1] - 1 : lines.length - 1]);
};

describe('훅 의존성 배열의 TDZ — 렌더 중 평가라 그 자리에서 화면이 죽는다', () => {
  test('의존성 배열은 자기보다 아래에서 선언된 값을 읽지 않는다', async () => {
    const problems = [];
    for (const f of await walk(path.join(ROOT, 'src'))) {
      const lines = (await readFile(f, 'utf8')).split('\n');
      const ranges = componentRanges(lines);
      const inSame = (x, y) => ranges.some(([st, en]) => x >= st && x <= en && y >= st && y <= en);
      const decls = declLines(lines);
      lines.forEach((l, i) => {
        const m = /^ {2}\}, \[(.*)\]\);\s*(\/\/.*)?$/.exec(l);
        if (!m) return;
        for (const id of new Set([...m[1].matchAll(/([A-Za-z_$][\w$]*)/g)].map((x) => x[1]))) {
          const at = decls.get(id);
          if (at !== undefined && at > i && inSame(i, at)) {
            problems.push(`${path.relative(ROOT, f)}:${i + 1}  '${id}' 는 ${at + 1}행에서 선언된다`);
          }
        }
      });
    }
    assert.deepEqual(problems, [], `의존성 배열이 아래에서 선언되는 값을 읽는다 — 렌더 즉시 ReferenceError:\n  ${problems.join('\n  ')}`);
  });
});
