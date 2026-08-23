// ══════════════════════════════════════════════════════════════════
//  이용 기록(usage_events) 정규화 회귀 테스트 (형 지시 2026-08-08)
//  목적: 누가·어디서(IP)·어떤 정제를 얼마나 쓰는지 실측. 쉬운정제/일반정제 구분.
//  ★IP는 개인정보다 — 서버가 헤더에서 직접 뽑고(위변조 차단), 180일 후 자동 삭제한다.
//  ★경계 검증(Golden #6): 클라가 보내는 값은 전부 믿지 않는다. 길이·타입·범위를 자른다.
// ══════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mod from '../functions/usageEvent.js';

const { extractClientIp, sanitizeUsageEvent, USAGE_TTL_DAYS } = mod;

// ── IP 추출 ────────────────────────────────────────────────────────
test('XFF 꼬리의 구글 LB·사설 대역을 걷어내고 남는 마지막 값이 실제 클라이언트 IP', () => {
  // ★앞쪽은 클라가 위조할 수 있고, 뒤쪽은 구글 LB IP 일 수 있다 → 뒤에서부터 인프라 IP 를 걷어낸다.
  assert.equal(extractClientIp({ 'x-forwarded-for': '203.0.113.45, 130.211.0.1, 35.191.0.2' }), '203.0.113.45');
  // 직접 호출(run.app): "위조값, 실제IP" → 마지막이 실제 IP
  assert.equal(extractClientIp({ 'x-forwarded-for': '1.2.3.4, 203.0.113.45' }), '203.0.113.45');
  // 외부 LB 뒤: "위조값, 실제IP, LB" → LB 를 걷어내고 실제 IP
  assert.equal(extractClientIp({ 'x-forwarded-for': '1.2.3.4, 203.0.113.45, 35.191.8.8' }), '203.0.113.45');
  // 사설 대역만 남으면 그대로(내부 호출)
  assert.equal(extractClientIp({ 'x-forwarded-for': '10.0.0.5' }), '10.0.0.5');
});

test('공백·단일 값·대문자 헤더 방어', () => {
  assert.equal(extractClientIp({ 'x-forwarded-for': '  203.0.113.45  ' }), '203.0.113.45');
  assert.equal(extractClientIp({ 'X-Forwarded-For': '203.0.113.7' }), '203.0.113.7');
});

test('IPv6·IPv4-mapped 정규화', () => {
  assert.equal(extractClientIp({ 'x-forwarded-for': '::ffff:203.0.113.45' }), '203.0.113.45');
  assert.equal(extractClientIp({ 'x-forwarded-for': '2001:db8::1' }), '2001:db8::1');
});

test('헤더가 없으면 fallback(socket) → 그것도 없으면 unknown', () => {
  assert.equal(extractClientIp({}, '198.51.100.9'), '198.51.100.9');
  assert.equal(extractClientIp({}), 'unknown');
  assert.equal(extractClientIp(null), 'unknown');
});

test('★IP 위조 방어 — 클라가 body로 보낸 ip는 쓰지 않는다(헤더만 신뢰)', () => {
  const out = sanitizeUsageEvent({ mode: 'easy', ip: '1.2.3.4', rows: 10 });
  assert.equal('ip' in out, false, 'body의 ip는 정규화 결과에 절대 포함되면 안 된다');
});

// ── 본문 정규화 ────────────────────────────────────────────────────
test('mode는 easy|normal 화이트리스트 — 그 외는 normal', () => {
  assert.equal(sanitizeUsageEvent({ mode: 'easy' }).mode, 'easy');
  assert.equal(sanitizeUsageEvent({ mode: 'normal' }).mode, 'normal');
  assert.equal(sanitizeUsageEvent({ mode: 'HACK' }).mode, 'normal');
  assert.equal(sanitizeUsageEvent({}).mode, 'normal');
});

test('건수는 숫자로 강제 + 음수·비정상 방어', () => {
  const o = sanitizeUsageEvent({ rows: '5356', validRows: -3, errorRows: 'x' });
  assert.equal(o.rows, 5356);
  assert.equal(o.validRows, 0);
  assert.equal(o.errorRows, 0);
});

test('과대 입력은 상한으로 잘린다 (한 번에 100만 건 정제는 없다)', () => {
  assert.equal(sanitizeUsageEvent({ rows: 99999999 }).rows, 1000000);
});

test('문자열 길이 절단 — 지자체·월·버전', () => {
  const o = sanitizeUsageEvent({ city: '가'.repeat(300), month: '2026-08', appVersion: 'V'.repeat(50) });
  assert.equal(o.city.length, 100);
  assert.equal(o.month, '2026-08');
  assert.ok(o.appVersion.length <= 20);
});

test('★XSS/제어문자 제거 — 관리자 화면에 그대로 그려지는 값이다', () => {
  const o = sanitizeUsageEvent({ city: '수원시<script>alert(1)</script>' });
  assert.ok(!o.city.includes('<'), '꺾쇠는 남으면 안 된다');
  assert.ok(!o.city.includes('>'));
});

test('알 수 없는 필드는 통째로 버린다 (스키마 고정)', () => {
  const o = sanitizeUsageEvent({ mode: 'easy', evil: 'x', role: 'admin', uid: 'fake' });
  assert.deepEqual(
    Object.keys(o).sort(),
    ['appVersion', 'city', 'errorRows', 'mode', 'month', 'rows', 'validRows'],
  );
});

test('빈 입력·null 이어도 안전한 기본값', () => {
  const o = sanitizeUsageEvent(null);
  assert.equal(o.mode, 'normal');
  assert.equal(o.rows, 0);
  assert.equal(o.city, '');
});

test('보관기간은 180일 상수로 관리 (개인정보 최소보관)', () => {
  assert.equal(USAGE_TTL_DAYS, 180);
});
