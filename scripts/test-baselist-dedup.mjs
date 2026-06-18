// handleBatchSaveBaseList 매칭 알고리즘 미러 테스트 (Firebase 없이 순수 로직 검증)
// App.jsx 1954~2099 의 3순위 매칭 + 교차확인 수정본을 그대로 복제하여 시나리오 검증.
// 실행: node scripts/test-baselist-dedup.mjs

const digitKey = v => (v || '').replace(/[^\d]/g, '');
const normPhone = v => (v || '').replace(/[^0-9-]/g, '');
const normalizeBirth = (raw) => {
  const s = String(raw ?? '').trim();
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(s)) return s;
  const d = s.replace(/[^0-9]/g, '');
  if (d.length === 8) return `${d.slice(2,4)}.${d.slice(4,6)}.${d.slice(6,8)}`;
  if (d.length === 6) return `${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`;
  return '';
};

// ── App.jsx 저장 매칭 로직 미러 ─────────────────────────────────────────────
function simulateSave(existing, validData) {
  const liveByBirth = {}, liveByPhone = {}, liveByLandline = {};
  const birthKeyedNames = new Set();

  existing.forEach(r => {
    const rName  = (r.name || r.이름 || '').trim();
    const rBirth = normalizeBirth(r.birthKey || String(r.생년월일 || ''));
    const rPhone = digitKey(r.mobile   || r.휴대폰   || '');
    const rLand  = digitKey(r.landline || r.유선전화 || '');
    if (!rName) return;
    if (rBirth) { liveByBirth[`${rName}__${rBirth}`] = r; birthKeyedNames.add(rName); }
    else if (rPhone.length >= 9) liveByPhone[`${rName}__${rPhone}`] = r;
    else if (rLand.length  >= 9) liveByLandline[`${rName}__${rLand}`] = r;
  });

  const updates = [], addEntries = [];

  validData.forEach(row => {
    const name = (row.이름 || '').trim();
    if (!name) return;
    const birthKey = normalizeBirth(row.생년월일 || '');
    const mobile = normPhone(row.휴대폰), mKey = digitKey(mobile);
    const landline = normPhone(row.유선전화), lKey = digitKey(landline);
    if (!birthKey && mKey.length < 9 && lKey.length < 9) return;
    const payload = { name, birthKey, mobile, landline, address: row.주소 || '' };

    if (birthKey) {
      const matched = liveByBirth[`${name}__${birthKey}`];
      if (matched) {
        if (matched._isInFlight) {
          matched.data = { ...matched.data, ...payload, birthKey: matched.data.birthKey || payload.birthKey, mobile: matched.data.mobile || payload.mobile, landline: matched.data.landline || payload.landline };
        } else {
          updates.push({ id: matched.id, data: payload });
          liveByBirth[`${name}__${birthKey}`] = { ...matched, ...payload };
        }
      } else {
        // ── 교차확인 수정본 ──
        const xMatch = (mKey.length >= 9 && liveByPhone[`${name}__${mKey}`])
                    || (lKey.length >= 9 && liveByLandline[`${name}__${lKey}`])
                    || null;
        if (xMatch) {
          if (xMatch._isInFlight) {
            xMatch.data = { ...xMatch.data, ...payload, mobile: payload.mobile || xMatch.data.mobile, landline: payload.landline || xMatch.data.landline };
            liveByBirth[`${name}__${birthKey}`] = xMatch;
          } else {
            updates.push({ id: xMatch.id, data: { ...payload, mobile: payload.mobile || xMatch.mobile || xMatch.휴대폰 || '', landline: payload.landline || xMatch.landline || xMatch.유선전화 || '' } });
            liveByBirth[`${name}__${birthKey}`] = { ...xMatch, ...payload };
          }
          birthKeyedNames.add(name);
        } else {
          const entry = { _isInFlight: true, data: payload };
          addEntries.push(entry); liveByBirth[`${name}__${birthKey}`] = entry; birthKeyedNames.add(name);
        }
      }
    } else if (mKey.length >= 9) {
      const matched = liveByPhone[`${name}__${mKey}`];
      if (matched) {
        if (matched._isInFlight) matched.data = { ...matched.data, ...payload, mobile: matched.data.mobile || payload.mobile, landline: matched.data.landline || payload.landline };
        else { updates.push({ id: matched.id, data: payload }); liveByPhone[`${name}__${mKey}`] = { ...matched, ...payload }; }
      } else {
        if (birthKeyedNames.has(name)) return;
        const entry = { _isInFlight: true, data: payload };
        addEntries.push(entry); liveByPhone[`${name}__${mKey}`] = entry;
      }
    } else {
      const matched = liveByLandline[`${name}__${lKey}`];
      if (matched) {
        if (matched._isInFlight) matched.data = { ...matched.data, ...payload, landline: matched.data.landline || payload.landline };
        else { updates.push({ id: matched.id, data: payload }); liveByLandline[`${name}__${lKey}`] = { ...matched, ...payload }; }
      } else {
        if (birthKeyedNames.has(name)) return;
        const entry = { _isInFlight: true, data: payload };
        addEntries.push(entry); liveByLandline[`${name}__${lKey}`] = entry;
      }
    }
  });

  return { adds: addEntries.length, updates: updates.length };
}

// ── 시나리오 ────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const check = (label, got, expAdds, expUpd) => {
  const ok = got.adds === expAdds && got.updates === expUpd;
  console.log(`${ok ? '✅' : '❌'} ${label} → adds=${got.adds} updates=${got.updates} (기대 adds=${expAdds} updates=${expUpd})`);
  ok ? pass++ : fail++;
};

// A) [핵심 구멍] 기존 전화전용 + 새 생년월일(동일인) → 신규 추가 금지, 업데이트 1
check('A 기존(전화전용)+새(생년월일) 동일인 → 중복 차단',
  simulateSave([{ id: 'x1', 이름: '홍길동', 휴대폰: '010-1111-2222' }],
               [{ 이름: '홍길동', 생년월일: '800101', 휴대폰: '010-1111-2222', 주소: 'A' }]),
  0, 1);

// B) [회귀] 기존 생년월일 + 새 동일 생년월일 → 1순위 업데이트
check('B 기존(생년월일)+새(동일 생년월일) → 업데이트',
  simulateSave([{ id: 'x2', 이름: '김철수', birthKey: '75.03.15' }],
               [{ 이름: '김철수', 생년월일: '750315', 휴대폰: '010-9999-8888', 주소: 'B' }]),
  0, 1);

// C) [회귀] 동명이인(생년월일 다름) → 둘 다 신규
check('C 동명이인(생년월일 다름) → 둘 다 저장',
  simulateSave([],
               [{ 이름: '이영희', 생년월일: '900505' }, { 이름: '이영희', 생년월일: '910606' }]),
  2, 0);

// D) [회귀] 같은 배치 동일인 2번(생년월일) → 1건만
check('D 배치 내 동일인 중복(생년월일) → 1건',
  simulateSave([],
               [{ 이름: '박민수', 생년월일: '880808', 휴대폰: '010-1234-5678' }, { 이름: '박민수', 생년월일: '880808', 휴대폰: '010-1234-5678' }]),
  1, 0);

// E) [회귀] 기존 생년월일 + 새 전화전용(동일 전화) → 동명생년월일 존재로 추가 금지(드롭), 중복 아님
check('E 기존(생년월일)+새(전화전용) 동일전화 → 추가 안 함(드롭)',
  simulateSave([{ id: 'x5', 이름: '최지우', birthKey: '70.07.07', 휴대폰: '010-5555-6666' }],
               [{ 이름: '최지우', 휴대폰: '010-5555-6666', 주소: 'E' }]),
  0, 0);

// F) [핵심 구멍·배치내] 같은 배치: 전화전용 먼저 → 생년월일 같은사람 → 1건 병합
check('F 배치 내 전화전용→생년월일 동일인 → 1건 병합',
  simulateSave([],
               [{ 이름: '서연', 휴대폰: '010-7777-8888' }, { 이름: '서연', 생년월일: '950505', 휴대폰: '010-7777-8888' }]),
  1, 0);

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
