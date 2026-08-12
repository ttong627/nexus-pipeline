// ══════════════════════════════════════════════════════════════════
//  개인정보 열람 감시 회귀 — functions/leakWatch.js (2026-08-13 · 계획 Phase 5)
//
//  ★개정 개인정보보호법(2026-09-11 시행)의 **72시간 통지는 '인지'가 전제**다.
//    기록만 남기면 아무도 안 본다 — 사고는 로그를 뒤지는 사람이 없을 때 커진다.
//    그래서 규칙이 자동으로 돌아야 하고, 그 규칙이 맞는지는 여기서 잠근다.
//
//  ⚠️느슨하면 유출을 놓치고, 빡빡하면 정상 업무마다 경보가 울려 아무도 안 본다.
//    둘 다 실패라서 경계를 테스트로 못 박는다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mod from '../functions/leakWatch.js';

const { detectAnomalies, formatAlert, kstHour, DEFAULTS } = mod;

const NOW = new Date('2026-08-13T05:00:00Z');           // KST 14:00 (한낮)
const NIGHT = new Date('2026-08-13T18:00:00Z');          // KST 03:00 (심야)
const ago = (base, min) => new Date(new Date(base).getTime() - min * 60 * 1000).toISOString();
const row = (base, min, count, shareId = 'sr_a') => ({ at: ago(base, min), count, shareId });

// ── ① 시간대 변환 ────────────────────────────────────────────────
test('UTC → KST 시로 바꾼다 — 서버는 UTC 로 돈다', () => {
  assert.equal(kstHour('2026-08-13T05:00:00Z'), 14);
  assert.equal(kstHour('2026-08-13T18:00:00Z'), 3);
  assert.equal(kstHour('말도안되는값'), -1);
});

// ── ② 정상 업무는 조용해야 한다 ──────────────────────────────────
test('★평소 사용량엔 경보가 없다 — 늘 울리면 아무도 안 본다', () => {
  const rows = [row(NOW, 1, 30), row(NOW, 3, 25), row(NOW, 8, 40)];
  assert.deepEqual(detectAnomalies(rows, { now: NOW }), []);
});

test('기록이 없으면 아무 판정도 하지 않는다', () => {
  assert.deepEqual(detectAnomalies([], { now: NOW }), []);
  assert.deepEqual(detectAnomalies(null, { now: NOW }), []);
});

test('창 밖(오래된) 기록은 세지 않는다 — 어제 것으로 오늘 경보가 울면 안 된다', () => {
  const rows = [row(NOW, 60, 1000), row(NOW, 120, 1000)];
  assert.deepEqual(detectAnomalies(rows, { now: NOW }), []);
});

// ── ③ 대량 열람 ──────────────────────────────────────────────────
test('★짧은 시간 대량 열람이면 알린다 — 명단을 통째로 빼가는 전형', () => {
  const rows = [row(NOW, 1, 200), row(NOW, 2, 150)];
  const f = detectAnomalies(rows, { now: NOW });
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'bulk_read');
  assert.equal(f[0].severity, 'high');
  assert.ok(f[0].message.includes('350'), '실제 건수를 말해줘야 판단할 수 있다');
});

test('임계 바로 아래는 울리지 않는다(경계)', () => {
  const rows = [row(NOW, 1, DEFAULTS.bulkReads - 1)];
  assert.equal(detectAnomalies(rows, { now: NOW }).length, 0);
});

// ── ④ 여러 공유 훑기 ─────────────────────────────────────────────
test('★서로 다른 공유를 여럿 열면 알린다 — 기사는 보통 자기 공유 하나만 본다', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((s, i) => row(NOW, i + 1, 5, `sr_${s}`));
  const kinds = detectAnomalies(rows, { now: NOW }).map((x) => x.kind);
  assert.ok(kinds.includes('many_shares'));
});

test('같은 공유를 여러 번 여는 건 정상이다', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((i) => row(NOW, i, 5, 'sr_same'));
  assert.deepEqual(detectAnomalies(rows, { now: NOW }), []);
});

// ── ⑤ 심야 ───────────────────────────────────────────────────────
test('★심야 대량 열람은 알린다 — 배송 시간대가 아니다', () => {
  const rows = [row(NIGHT, 1, 40), row(NIGHT, 2, 20)];
  const kinds = detectAnomalies(rows, { now: NIGHT }).map((x) => x.kind);
  assert.ok(kinds.includes('night_read'));
});

test('심야라도 소량이면 울리지 않는다 — 늦게 일하는 담당자가 있다', () => {
  assert.deepEqual(detectAnomalies([row(NIGHT, 1, 5)], { now: NIGHT }), []);
});

test('한낮 같은 양은 심야 규칙에 안 걸린다', () => {
  const kinds = detectAnomalies([row(NOW, 1, 60)], { now: NOW }).map((x) => x.kind);
  assert.equal(kinds.includes('night_read'), false);
});

// ── ⑥ 임계값 주입 ────────────────────────────────────────────────
test('임계값은 조절 가능하다 — 다만 끄는 스위치는 없다', () => {
  const rows = [row(NOW, 1, 10)];
  const f = detectAnomalies(rows, { now: NOW, config: { bulkReads: 10 } });
  assert.equal(f[0].kind, 'bulk_read');
});

// ── ⑦ 알림 문구 ──────────────────────────────────────────────────
test('★누가·무엇을·언제를 한 덩어리로 — 받은 사람이 바로 판단해야 한다', () => {
  const msg = formatAlert({ name: '홍길동' }, [{ message: '10분 안에 350건 열람' }], NOW);
  assert.ok(msg.includes('홍길동'));
  assert.ok(msg.includes('350건'));
  assert.ok(msg.includes('2026-08-13 14:00'), 'KST 로 보여줘야 한다');
});

test('이름을 모르면 아는 것으로 대신한다 — 빈칸으로 보내면 쓸모없다', () => {
  assert.ok(formatAlert({ phone: '+821012345678' }, [{ message: 'x' }], NOW).includes('+8210'));
  assert.ok(formatAlert({}, [{ message: 'x' }], NOW).includes('알 수 없는'));
});
