// ══════════════════════════════════════════════════════════════════
//  기사 명부 판정 회귀 — src/utils/driverRoster.js (2026-08-13 · Phase 0)
//
//  ★여기서 "이 번호로 들어온 사람을 통과시킬 것인가"가 갈린다.
//    느슨하면 남이 배송 명단(이름·주소·전화)을 보고, 빡빡하면 기사가 현장에서 막힌다.
//    둘 다 사고라서 경계를 테스트로 못 박는다.
// ══════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDriver, validateDriver, resolveDriverByPhone, activePhones, DENY_MESSAGE,
  reconcileDriversWithRoster, isActiveDriver, resolveRosterSource, remapDongDriverMap, dongsLosingDrivers,
} from '../src/utils/driverRoster.js';

const 홍 = { id: 'd1', name: '홍길동', phone: '+821012345678', active: true };
const 김 = { id: 'd2', name: '김철수', phone: '+821023456789', active: true };

// ── ① 저장 전 다듬기 ──────────────────────────────────────────────
test('저장 형태로 다듬는다 — 번호는 항상 E.164', () => {
  const d = normalizeDriver({ name: ' 홍길동 ', phone: '010-1234-5678' });
  assert.equal(d.name, '홍길동');
  assert.equal(d.phone, '+821012345678');
  assert.equal(d.active, true, '기본은 활성이어야 한다');
});

test('★담당자가 입력한 원문을 보존한다 — 고칠 때 근거가 된다', () => {
  const d = normalizeDriver({ name: '홍', phone: '02-123-4567' });
  assert.equal(d.phone, '', '휴대폰이 아니면 정규화는 비운다');
  assert.equal(d.phoneRaw, '02-123-4567', '원문까지 지우면 뭐가 틀렸는지 못 본다');
});

// ── ② 저장 검증 ───────────────────────────────────────────────────
test('이름·번호가 없으면 저장하지 않는다', () => {
  assert.equal(validateDriver({}).ok, false);
  assert.equal(validateDriver({ name: '홍길동' }).ok, false, '번호 없이 저장되면 인증을 영영 못 한다');
  assert.equal(validateDriver({ phone: '010-1234-5678' }).ok, false);
});

test('★읽을 수 없는 번호는 저장을 막고 무엇이 문제인지 말한다', () => {
  const r = validateDriver({ name: '홍길동', phone: '02-123-4567' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('02-123-4567')), '입력값을 그대로 보여줘야 고칠 수 있다');
});

test('★같은 번호를 두 번 등록하지 않는다 — 누구인지 정할 수 없게 된다', () => {
  const r = validateDriver({ name: '홍길동2', phone: '010-1234-5678' }, [홍, 김]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('홍길동')), '누구와 겹치는지 알려줘야 한다');
});

test('표기가 달라도 같은 번호면 중복이다', () => {
  const r = validateDriver({ name: '다른이름', phone: '+82 10-1234-5678' }, [홍]);
  assert.equal(r.ok, false, '하이픈·국가코드 표기 차이로 중복을 놓치면 안 된다');
});

test('자기 자신은 중복이 아니다 — 수정이 막히면 안 된다', () => {
  const r = validateDriver({ name: '홍길동(수정)', phone: '010-1234-5678' }, [홍, 김], 'd1');
  assert.equal(r.ok, true, r.errors.join(' / '));
});

test('문제를 한 번에 모아 알려준다 — 하나씩 알려주면 담당자가 여러 번 헛돈다', () => {
  const r = validateDriver({ name: '', phone: '아무거나' });
  assert.ok(r.errors.length >= 2);
});

// ── ③ 인증 판정 (핵심) ────────────────────────────────────────────
test('★등록·활성 기사는 통과한다', () => {
  const r = resolveDriverByPhone('+821012345678', [홍, 김]);
  assert.equal(r.allowed, true);
  assert.equal(r.driver.id, 'd1');
});

test('표기가 달라도 통과한다 — 저장은 E.164, 토큰도 E.164지만 방어적으로', () => {
  assert.equal(resolveDriverByPhone('010-1234-5678', [홍]).allowed, true);
});

test('★미등록 번호는 막는다', () => {
  const r = resolveDriverByPhone('+821099999999', [홍, 김]);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'not_registered');
});

test('★비활성 기사는 막는다 — 그만둔 기사가 명단을 계속 보면 안 된다', () => {
  const r = resolveDriverByPhone('+821012345678', [{ ...홍, active: false }]);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'inactive');
});

test('★같은 번호가 둘이면 통과시키지 않는다 — 아무나 고르면 남의 배송을 준다', () => {
  const r = resolveDriverByPhone('+821012345678', [홍, { ...홍, id: 'd9', name: '중복' }]);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'duplicate_registration');
});

test('★번호를 못 읽으면 통과시키지 않는다 — 모르면 거절이 기본', () => {
  for (const v of ['', null, undefined, '없음', '02-123-4567']) {
    assert.equal(resolveDriverByPhone(v, [홍]).allowed, false, `"${v}" 가 통과했다`);
  }
});

test('명부가 비어 있으면 아무도 통과하지 못한다', () => {
  assert.equal(resolveDriverByPhone('+821012345678', []).allowed, false);
  assert.equal(resolveDriverByPhone('+821012345678', null).allowed, false);
});

// ── ④ 거절 사유 안내 ──────────────────────────────────────────────
test('거절에는 사람이 읽을 안내가 붙는다 — 막연한 접근불가는 전화만 늘린다', () => {
  for (const key of ['invalid_phone', 'not_registered', 'duplicate_registration', 'inactive']) {
    assert.ok(DENY_MESSAGE[key] && DENY_MESSAGE[key].length > 5, `${key} 안내 문구가 없다`);
  }
});

// ── ⑤ 공유문서에 심을 번호 목록 ───────────────────────────────────
test('활성 기사 번호만, 중복 없이 뽑는다', () => {
  const list = activePhones([홍, 김, { ...홍, id: 'dup' }, { id: 'x', name: '퇴사', phone: '010-5555-6666', active: false }]);
  assert.deepEqual(list, ['+821012345678', '+821023456789']);
});

test('읽을 수 없는 번호는 목록에 넣지 않는다 — 규칙 비교가 헛돈다', () => {
  assert.deepEqual(activePhones([{ id: 'z', name: '오류', phone: '없음', active: true }]), []);
});

describe('기사 명부 대조 — 비활성이 남고 신규가 빠지던 결함(2026-08-27 형 지적)', () => {
  // 실제 사례: 웰쉐어 사회적협동조합에서 윤찬용을 비활성화하고 안광호를 새로 넣었는데,
  //   작업 설정 화면에는 **윤찬용이 뜨고 안광호가 안 떴다**. 복원한 목록을 명부와 대조하지 않아서다.
  const roster = [
    { id: 'a', name: '가명현', phone: '010-5688-8861', status: 'active', capacity: 100 },
    { id: 'b', name: '안광호', phone: '010-3704-5579', status: 'active', capacity: 100 },
    { id: 'c', name: '윤찬용', phone: '010-5176-8621', status: 'inactive', capacity: 100 },
  ];

  test('활성 판정은 status 와 active 를 모두 본다', () => {
    assert.equal(isActiveDriver({ status: 'active' }), true);
    assert.equal(isActiveDriver({ status: 'inactive' }), false, 'status 기반 비활성을 놓치면 안 된다');
    assert.equal(isActiveDriver({ active: false }), false, '옛 데이터의 active:false 도 비활성이다');
    assert.equal(isActiveDriver({}), true, '표시가 없으면 활성으로 본다(기존 데이터 보호)');
  })

  test('비활성은 빠지고, 명부의 신규 활성 기사는 들어온다', () => {
    const restored = [{ id: 'a', name: '가명현', capacity: 85 }, { id: 'c', name: '윤찬용', capacity: 110 }];
    const r = reconcileDriversWithRoster(restored, roster);
    assert.deepEqual(r.drivers.map((d) => d.name), ['가명현', '안광호']);
    assert.deepEqual(r.removed.map((x) => x.name), ['윤찬용']);
    assert.deepEqual(r.added.map((x) => x.name), ['안광호']);
  })

  test('담당자가 화면에서 조정한 업무능력(capacity)은 보존한다', () => {
    const r = reconcileDriversWithRoster([{ id: 'a', name: '가명현', capacity: 85, color: '#f0f' }], roster);
    const kept = r.drivers.find((d) => d.name === '가명현');
    assert.equal(kept.capacity, 85, '명부값 100 으로 덮어쓰면 담당자가 맞춰 둔 값이 날아간다');
    assert.equal(kept.color, '#f0f');
  })

  test('★명부를 못 읽으면 아무것도 하지 않는다 — 조회 실패로 기사가 사라지면 안 된다', () => {
    const restored = [{ id: 'c', name: '윤찬용' }];
    const r = reconcileDriversWithRoster(restored, []);
    assert.equal(r.skipped, true);
    assert.deepEqual(r.drivers.map((d) => d.name), ['윤찬용']);
  })

  test('id 가 달라도 이름+번호가 같으면 같은 사람으로 본다(옛 저장본 호환)', () => {
    const r = reconcileDriversWithRoster([{ id: 'old-1', name: '가명현', phone: '010-5688-8861' }], roster);
    assert.equal(r.drivers.find((d) => d.name === '가명현').id, 'a', '명부의 실제 id 로 맞춰져야 배정이 이어진다');
  })
})

describe('명부를 어디서 읽는가 — 화면에서 고른 소속사가 1순위 (형 지시 2026-08-27)', () => {
  // 형 지적 원문: "지자체 선택 후 소속사를 선택하면 그 소속사의 해당 정보를 불러오는 게 맞다.
  //   소속사가 없다고 적용하지 않으면 안 되지."
  // 실제 사고: 로그인 사용자의 orgId 만 봤더니 **관리자 계정은 소속이 비어** 명부를 못 읽었고,
  //   '명부를 못 읽으면 아무것도 하지 않는다' 안전장치에 걸려 대조가 통째로 건너뛰어졌다.
  //   그래서 비활성 기사가 계속 뜨고 새 기사가 안 떴다 — 두 번 헛걸음했다.
  const orgs = [{ id: 'o1', name: '웰쉐어 사회적협동조합' }, { id: 'o2', name: '(주)한울' }];

  test('★고른 소속사가 사용자 소속보다 우선 — 관리자(소속 없음)도 명부를 읽는다', () => {
    const r = resolveRosterSource({ orgs, selectedOrgId: 'o1', user: { uid: 'admin1', role: 'admin' } });
    assert.deepEqual(r, { kind: 'org', name: '웰쉐어 사회적협동조합' });
  })

  test('소속이 있는 사용자라도 화면에서 고른 소속사를 따른다', () => {
    const r = resolveRosterSource({ orgs, selectedOrgId: 'o2', user: { orgId: '웰쉐어 사회적협동조합' } });
    assert.equal(r.name, '(주)한울', '고른 소속사를 무시하면 남의 명부를 보게 된다');
  })

  test('안 골랐으면 내 소속 → 기업 → 개인 순으로 내려간다', () => {
    assert.deepEqual(resolveRosterSource({ orgs, selectedOrgId: null, user: { orgId: 'A' } }), { kind: 'org', name: 'A' });
    assert.deepEqual(resolveRosterSource({ orgs: [], user: { companyCode: 'NX-1' } }), { kind: 'company', name: 'NX-1' });
    assert.deepEqual(resolveRosterSource({ orgs: [], user: { uid: 'u1' } }), { kind: 'personal', name: 'u1' });
  })

  test('아무 단서도 없으면 none — 이때만 대조를 건너뛴다', () => {
    assert.deepEqual(resolveRosterSource({ orgs: [], user: {} }), { kind: 'none', name: '' });
  })

  test('소속사 id 대신 이름으로 골라도 찾는다(저장본 호환)', () => {
    assert.equal(resolveRosterSource({ orgs, selectedOrgId: '(주)한울' }).name, '(주)한울');
  })
})

// ── 명부 대조가 동별 배정을 지우던 결함 (형 실측 2026-08-27) ────────────────────
//   증상: 작업 설정을 열기만 해도 전농1동·휘경1동 배정이 사라지고, 그대로 저장까지 됐다.
//   원인: 대조가 기사 id 를 명부 id 로 갈아끼우는데 배정(dongDriverMap)은 옛 id 를 들고 있어
//         '없는 기사'로 판정돼 조용히 삭제됐다. → 대응표(idMap)로 배정을 함께 옮긴다.
describe('명부 대조 — 배정을 잃지 않는다', () => {
  const roster = [
    { id: 'new-A', name: '박진성', phone: '010-5634-0784', active: true },
    { id: 'new-B', name: '가명현', phone: '010-5688-8861', active: true },
  ];

  test('id 가 바뀌면 대응표를 돌려준다', () => {
    const r = reconcileDriversWithRoster(
      [{ id: 'old-A', name: '박진성', phone: '010-5634-0784' }], roster,
    );
    assert.equal(r.drivers[0].id, 'new-A');
    assert.deepEqual(r.idMap, { 'old-A': 'new-A' }, '대응표가 없으면 배정을 옮길 수 없다');
  });

  test('id 가 그대로면 대응표는 비어 있다(불필요한 재작성 없음)', () => {
    const r = reconcileDriversWithRoster([{ id: 'new-A', name: '박진성', phone: '010-5634-0784' }], roster);
    assert.deepEqual(r.idMap, {});
  });

  test('배정이 새 id 로 따라간다 — 이게 없어서 전농1동이 사라졌다', () => {
    const r = reconcileDriversWithRoster(
      [{ id: 'old-A', name: '박진성', phone: '010-5634-0784' }], roster,
    );
    const moved = remapDongDriverMap({ 전농1동: ['old-A'], 답십리1동: ['old-A', 'new-B'] }, r.idMap);
    assert.deepEqual(moved, { 전농1동: ['new-A'], 답십리1동: ['new-A', 'new-B'] });
  });

  test('대응표에 없는 id 는 함부로 지우지 않는다(무손실)', () => {
    assert.deepEqual(remapDongDriverMap({ 휘경1동: ['unknown'] }, { a: 'b' }), { 휘경1동: ['unknown'] });
  });

  test('대응표가 비면 원본을 그대로 돌려준다', () => {
    const src = { 전농1동: ['x'] };
    assert.equal(remapDongDriverMap(src, {}), src);
    assert.equal(remapDongDriverMap(src, null), src);
  });

  test('중복 id 는 합친다(같은 기사가 두 번 들어가지 않게)', () => {
    assert.deepEqual(remapDongDriverMap({ 전농1동: ['old-A', 'new-A'] }, { 'old-A': 'new-A' }), { 전농1동: ['new-A'] });
  });

  test('담당 기사가 통째로 빠진 동을 찾아낸다(조용히 지우지 않고 알리려고)', () => {
    const map = { 휘경1동: ['gone'], 전농1동: ['new-A'], 답십리1동: ['gone', 'new-B'] };
    assert.deepEqual(dongsLosingDrivers(map, new Set(['new-A', 'new-B'])), ['휘경1동']);
  });

  test('빈 배정은 잃은 동으로 세지 않는다', () => {
    assert.deepEqual(dongsLosingDrivers({ 전농1동: [] }, new Set(['new-A'])), []);
  });

  test('비활성 기사가 빠져도 나머지 배정은 그대로 남는다', () => {
    const withInactive = [...roster, { id: 'new-C', name: '윤찬용', phone: '010-1111-2222', active: false }];
    const r = reconcileDriversWithRoster(
      [{ id: 'old-A', name: '박진성', phone: '010-5634-0784' }, { id: 'old-C', name: '윤찬용', phone: '010-1111-2222' }],
      withInactive,
    );
    const moved = remapDongDriverMap({ 전농1동: ['old-A'], 휘경1동: ['old-C'] }, r.idMap);
    assert.deepEqual(moved.전농1동, ['new-A'], '살아 있는 기사의 배정까지 잃으면 안 된다');
    const kept = new Set(r.drivers.map((d) => d.id));
    assert.deepEqual(dongsLosingDrivers(moved, kept), ['휘경1동'], '빠진 기사의 동은 알려야 한다');
  });
});
