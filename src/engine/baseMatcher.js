// 기본명단 매칭 엔진 — 순수함수 SSOT (네트워크·React·env 의존 없음 · node --test 가능)
//
//   형 지시 2026-09-03: *"매칭이 자꾸 빠지는 경우가 발생하는데 매칭률을 높힐 수 있는
//   모든 방법을 다 적용해줘. **미스 매칭이나 오탐하면 절대 안돼.**"*
//
//   두 요구는 서로 반대 방향이라 아무 키나 넓히면 안 된다. 이 모듈의 규약:
//     · 넓히는 것은 **같은 사람을 가리키는 표기 흔들림**뿐이다(공백·유니코드·전화 앞자리 0·A-1 절단).
//     · 사람을 새로 이어 주는 약한 키(이름 단독·이름+행정동)는 **절대 만들지 않는다**(S-1).
//     · 한 키에 후보가 2건 이상이면 **채택하지 않는다**(S-2). 빠지는 건 되돌릴 수 있지만
//       잘못 붙은 특이사항·주소는 그대로 배송으로 나간다.
//
//   왜 SSOT 인가: 이 로직이 DbImportModal 과 App.jsx 정제 루프 두 곳에 흩어져 있었다.
//   한쪽만 고치면 조용히 갈라진다(G-6 복제 금지 · routing-worker-parity 와 같은 함정).
//
//   관련 규칙: CLAUDE.md §1-4 S-1~S-6(동명이인 안전매칭) · §2-1 3순위 매칭 · D-1~D-8(이식) · A-1(이름 5자)

/** 숫자만 남긴다. */
export const digitsOnly = (v) => String(v ?? '').replace(/[^\d]/g, '');

/**
 * 이름 비교키. NFC 정규화 + 모든 공백 제거.
 * ★같은 사람의 표기 흔들림만 흡수한다(`홍 길동`·`홍길동`). 다른 사람을 잇지 않는다.
 */
export const nameKey = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, '').trim();

/**
 * 생년월일 비교키 `YY.MM.DD`. 6·8자리 숫자와 구분자 표기를 모두 흡수한다.
 * ★양쪽(기본명단·월 명단)이 **같은 함수**를 쓰는 것이 핵심이다.
 *   예전엔 base 는 normalizeBirth, 월 명단은 parseBirthDate 를 써서
 *   비정형 값일 때 한쪽은 ''(빈값), 한쪽은 원문을 키로 삼아 키가 어긋났다.
 */
export const birthKey = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(s)) return s;
  const d = s.replace(/[^0-9]/g, '');
  if (d.length === 8) return `${d.slice(2, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
  if (d.length === 6) return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 6)}`;
  const serial = excelSerialToBirth(d, s);
  if (serial) return serial;
  return '';   // 비정형은 키로 쓰지 않는다(원문을 키로 쓰면 양쪽이 어긋난다)
};

/**
 * 엑셀 날짜 셀 복원. 워크북을 `cellDates:false` 로 읽으므로 날짜 서식 칸은
 * **숫자 일련값**으로 도착한다(1975-03-15 → `27469`). 6·8자리 분기에 걸리지 않아
 * 한쪽 함수는 원문을 그대로 키로 쓰고 다른 쪽은 빈값을 내어 **키가 어긋났다** —
 * 심하면 '생년월일 없는 사람'으로 강등돼 기본명단 저장에서까지 빠졌다(B-1).
 *
 * ★**5자리만** 복원한다. 4자리는 연도 표기(`1975`)와 구별할 수 없어
 *   건드리면 없는 날짜를 지어내게 된다 — 빠지는 것보다 나쁘다.
 *   1900 체계 기준일은 엑셀의 1900 윤년 버그 때문에 1899-12-30 이다.
 */
export function excelSerialToBirth(digits, raw) {
  if (!/^\d{5}$/.test(digits)) return '';
  if (String(raw).replace(/\s/g, '') !== digits) return '';   // 구분자가 섞인 값은 날짜 일련값이 아니다
  const n = Number(digits);
  const ms = Date.UTC(1899, 11, 30) + n * 86400000;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getUTCFullYear();
  if (y < 1900 || ms > Date.now()) return '';                 // 미래·범위 밖은 생년월일이 아니다
  const p = (x) => String(x).padStart(2, '0');
  return `${p(y % 100)}.${p(dt.getUTCMonth() + 1)}.${p(dt.getUTCDate())}`;
}

/**
 * 전화 비교키 = **끝 8자리**. CLAUDE.md B-15·S-1 이 동일인 판정에 쓰는 규약과 같다.
 * ★엑셀이 `010-1234-5678` 을 숫자로 바꿔 앞 0 을 날려도(`1012345678`) 끝 8자리는 살아남는다.
 *   지역번호 자릿수가 달라도(02/031) 가입자번호는 같다.
 */
export const phoneKey = (v) => {
  const d = digitsOnly(v);
  return d.length >= 8 ? d.slice(-8) : '';
};

/** 여러 후보 필드 중 처음으로 값이 있는 것. 구·신 스키마 혼재(B-8) 대응. */
export const pick = (rec, ...keys) => {
  for (const k of keys) {
    const v = rec?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
};

/** A-1: 기본명단에는 5자로 잘린 이름이 저장된다. 원본 6자 이름으로 조회하면 어긋난다. */
export const NAME_MAX = 5;
const nameVariants = (raw) => {
  const n = nameKey(raw);
  if (!n) return [];
  const out = [n];
  if (n.length > NAME_MAX) out.push(n.slice(0, NAME_MAX));   // 절단본도 같은 사람이다
  return out;
};

const ident = (rec) => ({
  birth: birthKey(pick(rec, 'birthKey', 'birth', '생년월일')),
  mobile: phoneKey(pick(rec, 'mobile', '휴대폰')),
  landline: phoneKey(pick(rec, 'landline', '유선전화')),
});

/** updatedAt(Firestore Timestamp/숫자/Date) → ms. 없으면 0. 최신 우선 비교용(B-15). */
export const updatedMs = (rec) => {
  const u = rec?.updatedAt;
  if (!u) return 0;
  if (typeof u.toMillis === 'function') return u.toMillis();
  if (typeof u?.seconds === 'number') return u.seconds * 1000;
  if (u instanceof Date) return u.getTime();
  if (typeof u === 'number') return u;
  return 0;
};

/**
 * 기본명단 인덱스 구축.
 *
 * ★현행과의 결정적 차이: 예전에는 `if(생년월일) … else if(휴대폰) … else if(유선)` 이라
 *   **생년월일이 있는 레코드는 전화 키로 아예 등록되지 않았다.** 그 달 명단이 생년월일 칸을
 *   비워 보내면(지자체마다 다르다) 전화가 멀쩡히 있어도 매칭이 통째로 실패했다.
 *   → 가진 강키를 **전부** 등록한다. 조회 쪽이 무엇을 들고 오든 만난다.
 *
 * @param {Array<object>} records 기본명단 레코드(구·신 스키마 혼재 가능)
 * @param {{idOf?: (rec:object)=>string}} [opts] 문서 식별자 추출기(기본: rec.id)
 * @returns {{map: Map<string, object[]>, size: number, indexed: number}}
 */
export function buildBaseIndex(records, opts = {}) {
  const idOf = opts.idOf || ((r) => r?.id ?? r?.__id ?? null);
  const map = new Map();
  let indexed = 0;

  const add = (key, rec) => {
    if (!key) return;
    let bucket = map.get(key);
    if (!bucket) { bucket = []; map.set(key, bucket); }
    // 같은 문서가 여러 경로로 들어와도 1건으로 본다(모호 오판 방지)
    const id = idOf(rec);
    if (id != null && bucket.some((r) => idOf(r) === id)) return;
    bucket.push(rec);
  };

  for (const rec of records || []) {
    const variants = nameVariants(pick(rec, 'name', '이름'));
    if (!variants.length) continue;
    const { birth, mobile, landline } = ident(rec);
    if (!birth && !mobile && !landline) continue;   // 강키가 하나도 없으면 매칭 대상이 아니다(B-1)
    for (const nm of variants) {
      if (birth) add(`b|${nm}|${birth}`, rec);
      if (mobile) add(`m|${nm}|${mobile}`, rec);      // ★생년월일이 있어도 함께 등록한다
      if (landline) add(`l|${nm}|${landline}`, rec);
    }
    indexed++;
  }
  return { map, size: map.size, indexed };
}

/** 매칭 결과 사유 코드. UI·리포트가 이 값으로 분기한다. */
export const MATCH_REASON = {
  BIRTH: 'birth',
  MOBILE: 'mobile',
  LANDLINE: 'landline',
  NO_NAME: 'no-name',
  NO_KEY: 'no-key',
  MISS: 'miss',
  AMBIGUOUS: 'ambiguous',
};

/**
 * 한 건 조회. **오매칭 금지가 최우선이다.**
 *
 * 우선순위 생년월일 → 휴대폰 → 유선(S-1 강키만). 이름 단독·이름+행정동은 쓰지 않는다.
 * 어느 단계든 후보가 2건 이상이면 그 자리에서 **중단하고 보류**한다(S-2) —
 * 다음 단계로 내려가 아무거나 집으면 그게 바로 동명이인 오염이다.
 *
 * @returns {{entry: object|null, reason: string, candidates?: number}}
 */
export function matchBase(index, query) {
  const map = index?.map;
  if (!map || !query) return { entry: null, reason: MATCH_REASON.MISS };

  const variants = nameVariants(pick(query, '이름', 'name'));
  if (!variants.length) return { entry: null, reason: MATCH_REASON.NO_NAME };
  const { birth, mobile, landline } = ident(query);
  if (!birth && !mobile && !landline) return { entry: null, reason: MATCH_REASON.NO_KEY };

  const steps = [
    [birth, 'b', MATCH_REASON.BIRTH],
    [mobile, 'm', MATCH_REASON.MOBILE],
    [landline, 'l', MATCH_REASON.LANDLINE],
  ];

  for (const [value, prefix, reason] of steps) {
    if (!value) continue;
    const found = [];
    for (const nm of variants) {
      for (const rec of map.get(`${prefix}|${nm}|${value}`) || []) {
        if (!found.includes(rec)) found.push(rec);
      }
    }
    if (found.length === 0) continue;
    if (found.length > 1) {
      // 같은 사람의 중복 문서일 수도 있다 — 나머지 식별자가 **전부** 일치하면 1인으로 보고
      // 최신 것을 쓴다(B-15). 하나라도 어긋나면 다른 사람일 수 있으므로 보류한다.
      if (!allSamePerson(found)) {
        return { entry: null, reason: MATCH_REASON.AMBIGUOUS, candidates: found.length };
      }
      const newest = found.reduce((a, b) => (updatedMs(b) >= updatedMs(a) ? b : a));
      return { entry: newest, reason, candidates: found.length };
    }
    return { entry: found[0], reason, candidates: 1 };
  }
  return { entry: null, reason: MATCH_REASON.MISS };
}

/**
 * 후보들이 모두 같은 사람인가.
 * 판정: 두 레코드가 **함께 가지고 있는** 식별자가 하나라도 서로 다르면 다른 사람으로 본다.
 * (한쪽에만 있는 값은 비교하지 않는다 — 없는 것은 불일치가 아니다.)
 */
export function allSamePerson(recs) {
  const ids = recs.map(ident);
  for (let i = 1; i < ids.length; i++) {
    for (const f of ['birth', 'mobile', 'landline']) {
      const a = ids[0][f], b = ids[i][f];
      if (a && b && a !== b) return false;
    }
  }
  return true;
}

/**
 * 이식 대상 필드 추출 — **덮어쓰기가 아니라 보충**이다(M-1 무손실 · D-5 원본 우선).
 * 값이 실제로 있는 것만 돌려주고, 채울지 말지는 호출부가 원본을 보고 정한다.
 */
export function extractImportable(entry) {
  if (!entry) return null;
  const note = String(pick(entry, 'note', '특이사항'))
    .replace(/^\[기본\]\s*/g, '')
    .replace(/\(본명:[^)]*\)/g, '')
    .replace(/\s*◆[^◆]*/g, '')   // 옛 이식표시가 이중으로 쌓이지 않게
    .replace(/\s+/g, ' ')
    .trim();
  return {
    note,
    driver: String(pick(entry, 'driver', '기사')).trim(),
    seqNo: String(pick(entry, 'seqNo', '배송순번')).trim(),
    sms: String(pick(entry, 'sms', '문자수신')).trim(),
    detailAddr: String(pick(entry, 'detailAddr', 'detailAddress', '상세주소')).trim(),
    lat: entry.lat ?? null,
    lng: entry.lng ?? null,
    isApt: entry.isApt ?? false,
  };
}
