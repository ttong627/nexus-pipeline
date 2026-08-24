// 핵심 정제 흐름 E2E — **실제 브라우저에서 파일을 올려 정제까지** 돌린다. 2026-08-24
//
//   왜: 이 프로그램의 본업은 "명단을 올리면 규칙대로 정제된 명단이 나온다" 이다.
//   단위 테스트는 엔진만 보고, 실호출 스크립트는 서버만 본다 — **둘 다 화면을 거치지 않는다**.
//   업로드→파싱→지자체 확인→정제→결과표까지 한 번이라도 사람이 밟지 않으면
//   "왜 안돼요?" 는 사용자가 먼저 발견하게 된다. 그래서 로그인 없이 되는 **게스트 경로**로 전 구간을 밟는다.
//
//   대상: 기본 운영(배포된 것이 진짜 도는지). E2E_BASE 로 로컬 미리보기 지정 가능.
import { test, expect } from '@playwright/test';
import XLSX from 'xlsx';
import { writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

const BASE = (process.env.E2E_BASE || 'https://logis-op.web.app').replace(/\/+$/, '');

// 원본 3명 · 6포 — 정제 규칙이 실제로 걸리는 형태를 골랐다.
const ROWS = [
  ['연번', '이름', '생년월일', '주소', '휴대폰', '수량(포수)', '특이사항'],
  [1, '홍길동', '750315', '서울특별시 동대문구 왕산로 72', '010-1111-2222', 2, '경비실 맡겨주세요'],
  [2, '김철수', '680722', '동대문구 전농로 24, 101동205호', '010-3333-4444', 1, '부재시 문앞'],   // A-10 동호 형식
  [3, '이영희', '820101', '서울 동대문구 답십리로 100 3층', '010-5555-6666', 3, ''],
];
const TOTAL = 3;
const TOTAL_QTY = 6;

const makeFile = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ROWS), '수급자');
  const f = path.join(os.tmpdir(), `e2e_purify_${Date.now()}.xlsx`);
  writeFileSync(f, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return f;
};

test('게스트로 파일을 올려 정제까지 — 건수·포수 무손실 + 규칙대로 정제된다', async ({ page }) => {
  const fatal = [];
  const httpBad = [];
  page.on('pageerror', (e) => fatal.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/ReferenceError|TypeError|is not a constructor|Cannot access|Refused to/.test(m.text())) fatal.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => { if (r.status() >= 400) httpBad.push(`${r.status()} ${r.url().slice(0, 100)}`); });
  page.on('dialog', (d) => d.accept());

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /로그인 없이 무료로 정제하기/ }).click({ timeout: 25000 });

  const input = page.locator('input[type=file]').first();
  // 드롭존 스타일이라 input 은 숨겨져 있다 — 보이기를 기다리면 안 된다.
  await input.waitFor({ state: 'attached', timeout: 25000 });
  await input.setInputFiles(makeFile());

  // ★파싱 단계에서 이미 원본 건수·포수가 맞아야 한다(M-1·M-8 — 여기서 틀리면 뒤는 다 틀린다)
  await expect(page.getByText(`수급자 ${TOTAL}명 · ${TOTAL_QTY}포`)).toBeVisible({ timeout: 25000 });

  await page.getByRole('button', { name: /확인 · 다음 단계/ }).click();

  // 결과표 — 전건 유지(M-1)
  await expect(page.getByText(`${TOTAL}건 표시 / 전체 ${TOTAL}건`)).toBeVisible({ timeout: 60000 });
  const body = await page.locator('#root').innerText();
  for (const name of ['홍길동', '김철수', '이영희']) expect(body, `${name} 이 결과에서 사라졌다`).toContain(name);

  // ★주소는 셀 입력창 값이라 innerText 로는 안 잡힌다 — 값으로 확인한다.
  const values = await page.evaluate(() => [...document.querySelectorAll('table input, table textarea')].map((e) => e.value));
  const joined = values.join('\n');
  expect(joined, '도로명 정제 결과가 없다').toMatch(/왕산로 72/);
  expect(joined, 'A-11 괄호(법정동) 형식이 아니다').toMatch(/\([가-힣]+동/);
  expect(joined, 'A-10 동호 형식(101- 205호)이 깨졌다').toMatch(/101-\s*205호/);
  expect(joined, '특이사항이 사라졌다(M-1)').toContain('경비실 맡겨주세요');
  expect(joined, '특이사항이 사라졌다(M-1)').toContain('부재시 문앞');

  expect(fatal, `화면을 죽이는 오류:\n${fatal.join('\n')}`).toEqual([]);
  expect([...new Set(httpBad)], `실패한 요청이 있다:\n${httpBad.join('\n')}`).toEqual([]);
});
