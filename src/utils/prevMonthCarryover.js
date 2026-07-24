// 전월 작업내역(기사배정·배송순번) → 이번달 명단 승계 매칭 (순수함수)
//
// 동명이인 안전(S-1~S-6): 강키(이름+생년월일)가 **양측유일**일 때만 승계한다.
// - delivery_history record에는 전화번호가 없고 birthKey(생년월일)만 있으므로 강키는 생년월일 기준.
// - 생년월일 없는 건(약키)은 승계도, NEW 판정도 하지 않는다(_carryAmbiguous). 오탐 방지가 오염보다 안전.
// 저장 스키마는 건드리지 않는다 — 화면 조회 시 동적으로 계산해 붙이는 참고 표시용.

/** 생년월일 정규화: 숫자만 남기고 6자리 이상만 유효 */
function normBirth(v) {
  const d = String(v ?? '').replace(/[^\d]/g, '');
  return d.length >= 6 ? d : '';
}

/** 이름 정규화: 앞뒤 공백 제거 */
function normName(v) {
  return String(v ?? '').trim();
}

/**
 * 승계 강키 생성: 이름+생년월일. 둘 중 하나라도 없으면 null(약키·승계 불가).
 * @returns {string|null}
 */
export function carryStrongKey(name, birth) {
  const n = normName(name);
  const b = normBirth(birth);
  if (!n || !b) return null;
  return `${n}__${b}`;
}

/** delivery_history/이번달 어느 형태든 이름·생년월일을 꺼낸다 */
function readKey(rec) {
  return carryStrongKey(rec.이름 ?? rec.name, rec.생년월일 ?? rec.birthKey);
}

/**
 * 전월 records를 이번달 records에 승계 표시한다(원본 불변, 새 배열 반환).
 * 각 이번달 record에 다음 필드를 부착:
 *  - _isNew: 전월 강키 매칭이 없어 신규로 판정됨(약키는 판정 보류 → false)
 *  - _prevDriver: 승계할 전월 기사명('' = 없음)
 *  - _prevSeqNo: 승계할 전월 배송순번(number|null)
 *  - _carryAmbiguous: 약키(생년월일 없음)이거나 동명이인 중복키라 승계 보류됨
 *
 * @param {Array} prevRecords delivery_history 전월 records (name·birthKey·driver·seqNo)
 * @param {Array} curRecords  이번달 records (이름·생년월일·기사·배송순번)
 * @returns {Array} 승계 필드가 부착된 새 배열
 */
export function annotateCarryover(prevRecords = [], curRecords = []) {
  // 전월 강키 카운트 + 맵(양측유일 판정용)
  const prevCount = new Map();
  const prevByKey = new Map();
  for (const p of prevRecords) {
    const k = readKey(p);
    if (!k) continue;
    prevCount.set(k, (prevCount.get(k) || 0) + 1);
    prevByKey.set(k, p);
  }

  // 이번달 강키 카운트(양측유일 판정용)
  const curCount = new Map();
  for (const c of curRecords) {
    const k = readKey(c);
    if (!k) continue;
    curCount.set(k, (curCount.get(k) || 0) + 1);
  }

  const EMPTY = { _isNew: false, _prevDriver: '', _prevSeqNo: null, _carryAmbiguous: true };

  return curRecords.map((c) => {
    const k = readKey(c);

    // 약키(생년월일 없음): 승계·NEW 판정 모두 보류
    if (!k) return { ...c, ...EMPTY };

    const prev = prevByKey.get(k);

    // 전월 강키 매칭 없음 → 신규
    if (!prev) {
      return { ...c, _isNew: true, _prevDriver: '', _prevSeqNo: null, _carryAmbiguous: false };
    }

    // 매칭 있음 — 양측유일이 아니면(동명이인 중복키) 승계 보류
    const unique = prevCount.get(k) === 1 && curCount.get(k) === 1;
    if (!unique) return { ...c, ...EMPTY };

    const driver = String(prev.driver ?? prev.기사 ?? '').trim();
    const seq = Number.parseInt(prev.seqNo ?? prev.배송순번, 10);
    return {
      ...c,
      _isNew: false,
      _carryAmbiguous: false,
      _prevDriver: driver,
      _prevSeqNo: Number.isFinite(seq) && seq > 0 ? seq : null,
    };
  });
}
