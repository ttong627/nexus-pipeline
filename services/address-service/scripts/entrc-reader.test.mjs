/**
 * 출입구 리더(인코딩) 테스트 — **형이 받은 실제 파일**을 직접 읽어 검증한다.
 *
 * 왜 실파일을 쓰는가: 인코딩 사고는 예외가 안 나고 조용히 글자만 깨진다.
 * 합성 픽스처로는 "cp949 로 안 읽고 있음"을 못 잡는다. 실제 바이트를 읽어
 * 한글이 한글로 나오는지 봐야 의미가 있다.
 *
 * 실자료가 없는 환경(CI 등)에서는 자동 skip 한다.
 * 실행: node --test scripts/entrc-reader.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { parseEntranceLine } from '../src/entrance/entrcParser.js';
import {
  looksKorean,
  looksMojibake,
  readEntranceLines,
} from '../src/entrance/entrcReader.js';

const DATA_DIR = process.env.JUSO_DATA_DIR
  || 'C:/Users/ttong/Downloads/DB_다운로드';
const SAMPLE_FILE = path.join(DATA_DIR, 'entrc_sejong.txt');
const hasData = existsSync(SAMPLE_FILE);
const skip = hasData ? false : '실자료 없음(JUSO_DATA_DIR 로 지정 가능)';

test('cp949 로 읽으면 한글이 한글로 나온다', { skip }, async () => {
  let checked = 0;
  for await (const line of readEntranceLines(SAMPLE_FILE, { limit: 50 })) {
    const r = parseEntranceLine(line);
    assert.ok(r, '실자료 줄이 파싱돼야 한다');
    assert.equal(looksMojibake(line), false, `깨진 줄 발견: ${line.slice(0, 60)}`);
    if (r.emd) assert.equal(looksKorean(r.emd), true, `읍면동이 한글이 아니다: ${r.emd}`);
    checked += 1;
  }
  assert.ok(checked >= 10, `충분히 읽지 못했다(${checked}줄)`);
});

test('★UTF-8 로 잘못 읽으면 깨짐이 탐지된다 (탐지기 자체의 검증)', { skip }, async () => {
  // 같은 파일을 일부러 틀린 인코딩으로 읽어, looksMojibake 가 실제로 잡는지 본다.
  // 이 테스트가 없으면 탐지기가 항상 false 를 반환해도 위 테스트는 통과해버린다.
  let sawBroken = false;
  for await (const line of readEntranceLines(SAMPLE_FILE, { limit: 50, encoding: 'utf8' })) {
    if (looksMojibake(line)) { sawBroken = true; break; }
  }
  assert.equal(sawBroken, true, 'utf8 로 읽었는데 깨짐이 안 잡히면 탐지기가 무용지물이다');
});

test('건물명이 실제로 복원된다 (연계 자료엔 없는 정보)', { skip }, async () => {
  const names = [];
  for await (const line of readEntranceLines(SAMPLE_FILE, { limit: 200 })) {
    const r = parseEntranceLine(line);
    if (r?.buildingName) names.push(r.buildingName);
  }
  assert.ok(names.length > 0, '건물명이 하나도 안 잡혔다');
  assert.ok(names.some(looksKorean), '건물명에 한글이 없다 — 디코딩 실패 의심');
});

test('limit 이 지켜진다(대용량 파일 표본 확인용)', { skip }, async () => {
  let n = 0;
  for await (const _ of readEntranceLines(SAMPLE_FILE, { limit: 7 })) n += 1;
  assert.equal(n, 7);
});

test('looksKorean / looksMojibake 순수 판정', () => {
  assert.equal(looksKorean('수루배마을5단지'), true);
  assert.equal(looksKorean('APT 101'), false);
  assert.equal(looksKorean(null), false);

  assert.equal(looksMojibake('정상 한글'), false);
  assert.equal(looksMojibake(''), false);
  assert.equal(looksMojibake(null), false);

  // (1) UTF-8 오독 -> 치환문자 U+FFFD
  assert.equal(looksMojibake('��'), true);

  // (2) latin1 오독 -> cp949 '수루배'(BC F6 B7 E7 B9 E8)를 latin1 로 읽은 모습.
  //     코드포인트로만 적는다. 소스가 에디터를 거치며 변형되면 테스트가 거짓 통과한다.
  const latin1Misread = '¼ö·ç¹è';
  assert.equal(looksMojibake(latin1Misread), true, 'cp949→latin1 오독을 놓치면 안 된다');

  // 경계: 라틴 문자 2자뿐이면 오탐하지 않는다(정상 텍스트 보호)
  assert.equal(looksMojibake('ÀÁ'), false);
});
