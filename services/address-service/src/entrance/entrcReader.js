/**
 * 행안부 출입구 TXT 스트리밍 리더 — 인코딩 디코딩 + 줄 단위 공급.
 *
 * ★왜 별도 모듈인가
 *   파서(entrcParser.js)는 문자열만 다루는 순수 함수로 남겨야 테스트가 쉽다.
 *   "파일을 어떻게 읽어 문자열로 만드는가"는 그것대로 실패 모드가 따로 있다
 *   (인코딩·BOM·CRLF·대용량 메모리). 그래서 읽기 책임만 여기로 분리한다.
 *
 * ★인코딩이 왜 중요한가 (실측 2026-08-01)
 *   행안부 TXT 는 **EUC-KR(cp949)** 이다. UTF-8 로 읽으면 한글이 전부 깨진다.
 *   좌표·코드 같은 ASCII 필드는 깨져도 멀쩡해 보이기 때문에, 구조 검증만 하면
 *   "정상"으로 통과해버린다 — 그리고 건물명이 깨진 채 DB 에 적재된다.
 *   실제로 이 프로젝트의 1차 스캔이 딱 그 상태였다. 적재에는 반드시 이 리더를 쓸 것.
 *
 *   iconv-lite 는 이미 이 서비스의 의존성이다(import-job 이 같은 이유로 쓴다).
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import iconv from 'iconv-lite';

/** 행안부 자료 기본 인코딩. 다른 자료가 섞이면 호출부가 바꿀 수 있게 인자로 뺀다. */
export const DEFAULT_ENCODING = 'cp949';

/**
 * 파일을 줄 단위로 흘려준다(async iterator). 전체를 메모리에 올리지 않는다.
 *
 * @param {string} filePath
 * @param {{encoding?: string, limit?: number}} [opts]
 *   encoding 기본 cp949 · limit 있으면 앞 N줄만(표본 확인용)
 */
export async function* readEntranceLines(filePath, opts = {}) {
  const { encoding = DEFAULT_ENCODING, limit = 0 } = opts;

  const stream = createReadStream(filePath).pipe(iconv.decodeStream(encoding));
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let n = 0;
  try {
    for await (const line of rl) {
      if (!line) continue;
      // BOM/제로폭 제거 — 첫 줄에 붙어오면 1번 필드 판별이 어긋난다.
      const clean = n === 0 ? line.replace(/^﻿/, '') : line;
      if (!clean.trim()) continue;
      yield clean;
      n += 1;
      if (limit && n >= limit) break;
    }
  } finally {
    rl.close();
    stream.destroy?.();
  }
}

/**
 * 디코딩이 실제로 먹었는지 값으로 확인한다.
 *
 * 인코딩 사고는 조용하다 — 예외가 안 나고 그냥 글자가 깨진다. 그래서 적재 전에
 * "한글이 한글로 보이는가"를 기계적으로 검사할 수단이 필요하다.
 *
 * @returns {boolean} 완성형 한글이 하나라도 있으면 true
 */
export function looksKorean(text) {
  return typeof text === 'string' && /[가-힣]/.test(text);
}

/**
 * cp949 를 다른 인코딩으로 잘못 읽었을 때의 깨짐을 탐지한다.
 *
 * 두 가지 실패 모양을 본다:
 *   ① UTF-8 로 읽은 경우 → 유효하지 않은 바이트열이 U+FFFD(치환문자)가 된다. 실무에서 대부분 이쪽.
 *   ② latin1 로 읽은 경우 → 예외 없이 통과하며 Latin-1 보충 영역 문자가 길게 이어진다.
 *
 * ⚠️ ②의 범위를 U+00C0~U+00FF 로 잡았다가 실제 깨짐을 놓쳤다(실측 2026-08-01).
 *    cp949 한글은 선행 0xB0~0xFD · 후행 0xA1~0xFE 라 latin1 로 읽으면 **U+00A1 부터**
 *    분포한다. 범위를 U+00A1~U+00FF 로 넓힌다. 한국 주소 자료에 라틴 확장 문자가
 *    3자 이상 연속할 일은 없으므로 오탐 위험은 낮다.
 */
export function looksMojibake(text) {
  if (typeof text !== 'string' || !text) return false;
  if (text.includes('�')) return true;
  return /[¡-ÿ]{3,}/.test(text);
}
