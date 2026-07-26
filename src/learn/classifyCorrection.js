// 자가학습 위험분류 순수함수 — 앱(수정 캡처)·테스트 공용. addressEngine 비의존.
//
// 형 정책(2026-07-26): 저위험 자동 축적·적용 / 고위험 검토 큐 경유.
// 동명이인 안전 최우선: 이름 약키 매칭 영구 금지 → 이름 성(첫글자) 교체·전면 상이는 항상 high.
// 주소 본번 불변 검증: 숫자 시퀀스가 달라지면(도로명 본번 변경) 오타로 보지 않고 high.
//
// 반환: { type, risk, ruleKey, payload, reason }
//   type : noop|typo|name_change|address_change|building_alias|note_move|column_map|unsupported
//   risk : none(변경없음) | low(자동) | high(검토) | reject(어디에도 안 넣음)

function norm(s) {
  return String(s ?? '').trim();
}

// Levenshtein 편집거리 (문자 단위)
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[i - 1], dp[i]) + 1;
      prev = tmp;
    }
  }
  return dp[m];
}

// 숫자 토큰 시퀀스(본번 비교용). "천호대로 55-3" → ['55','3']
function numbersOf(s) {
  return String(s).match(/\d+/g) || [];
}
function sameNumbers(a, b) {
  const na = numbersOf(a), nb = numbersOf(b);
  if (na.length !== nb.length) return false;
  return na.every((v, i) => v === nb[i]);
}

// 숫자·공백·기호 제거한 문자 부분(도로명 유사도용)
function lettersOnly(s) {
  return String(s).replace(/[\d\s\-.,()]/g, '');
}

export function classifyCorrection({ field, before, after, context = {} } = {}) {
  const b = norm(before);
  const a = norm(after);

  if (b === a) {
    return { type: 'noop', risk: 'none', ruleKey: null, payload: null, reason: '변경 없음' };
  }

  switch (field) {
    case 'name': {
      // 이름은 개인 식별키 — 성(첫글자) 보존 + 근소한 글자차만 오타로 인정. 그 외는 항상 검토.
      const sameSurname = b[0] && a[0] && b[0] === a[0];
      const dist = editDistance(b, a);
      const lenDiff = Math.abs(b.length - a.length);
      if (sameSurname && lenDiff <= 1 && dist <= 2 && b.length >= 2 && a.length >= 2) {
        return {
          type: 'typo', risk: 'low', ruleKey: `name:${b}`,
          payload: { wrong: b, correct: a }, reason: '이름 오타(성 보존·근소)',
        };
      }
      return {
        type: 'name_change', risk: 'high', ruleKey: null,
        payload: { before: b, after: a }, reason: '이름 교체(동명이인 위험) — 자동금지, 검토 필요',
      };
    }

    case 'address': {
      // 본번(숫자 시퀀스) 불변 + 도로명 문자 근소차만 오타로 인정.
      if (!sameNumbers(b, a)) {
        return {
          type: 'address_change', risk: 'high', ruleKey: null,
          payload: { before: b, after: a }, reason: '주소 본번 변경 — 변조 위험, 검토 필요',
        };
      }
      const lb = lettersOnly(b), la = lettersOnly(a);
      const dist = editDistance(lb, la);
      const maxLen = Math.max(lb.length, la.length) || 1;
      if (dist === 0) {
        // 숫자·문자 모두 동일한데 원문만 다름(공백/기호 차) → 사소 정리
        return {
          type: 'typo', risk: 'low', ruleKey: `addr:${b}`,
          payload: { wrong: b, correct: a }, reason: '주소 표기 정리(본번·문자 동일)',
        };
      }
      if (dist <= 2 && dist / maxLen <= 0.34) {
        return {
          type: 'typo', risk: 'low', ruleKey: `addr:${b}`,
          payload: { wrong: b, correct: a }, reason: '주소 오타(본번 불변·근소)',
        };
      }
      // 본번 같아도 도로명 문자가 크게 다르면 오타로 볼 수 없음
      return {
        type: 'address_change', risk: 'high', ruleKey: null,
        payload: { before: b, after: a }, reason: '도로명 상이 — 검토 필요',
      };
    }

    case 'buildingName': {
      return {
        type: 'building_alias', risk: 'low', ruleKey: `bldg:${b}`,
        payload: { alias: b, canonical: a }, reason: '건물명 별칭 표준화',
      };
    }

    case 'note': {
      return {
        type: 'note_move', risk: 'low', ruleKey: `note:${a}`,
        payload: { hint: a }, reason: '특이사항/배송힌트',
      };
    }

    case 'column': {
      // 표준키는 context.target 우선, 없으면 after.
      const target = norm(context.target) || a;
      return {
        type: 'column_map', risk: 'low', ruleKey: `col:${target}:${b}`,
        payload: { header: b, key: target }, reason: '컬럼 매핑 학습',
      };
    }

    default:
      return { type: 'unsupported', risk: 'reject', ruleKey: null, payload: null, reason: `미지원 필드: ${field}` };
  }
}

export default classifyCorrection;
