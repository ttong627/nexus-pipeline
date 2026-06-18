// 전화번호 필드에서 번호와 뒤따르는 텍스트를 분리
// "010-1234-5678 독거노인" → { cleaned: "010-1234-5678", note: "독거노인" }
// "010-0000-0000(요양보호사)" → { cleaned: "010-0000-0000", note: "요양보호사" }
// "010-0000-0000-형님번호"   → { cleaned: "010-0000-0000", note: "형님번호" }
// "010-0000-0000:집주인"     → { cleaned: "010-0000-0000", note: "집주인" }
export const extractPhoneNote = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return { cleaned: '', note: '' };

  // 전화번호 유효 문자(숫자·대시·공백·점)로 시작하는 부분을 탐욕적으로 매칭
  const m = s.match(/^([\d\-\s.]+)(.*)/s);
  if (!m) return { cleaned: s, note: '' };

  // 번호 끝 불필요한 대시·공백·점 제거 (예: "010-0000-0000-" → "010-0000-0000")
  const phonePart = m[1].trimEnd().replace(/[\-\s.]+$/, '');
  const digitCount = phonePart.replace(/[^\d]/g, '').length;
  // 9자리 미만이면 전화번호가 아님 → 분리하지 않음
  if (digitCount < 9) return { cleaned: s, note: '' };

  // 앞쪽 구분자 제거: 공백, /, |, 쉼표, 세미콜론, 콜론, 괄호 등
  let rest = (m[2] || '').replace(/^[\s\/|,;:，、(（]+/, '').trim();
  // 괄호로 감싸인 경우 닫는 괄호 제거 (예: "요양보호사)" → "요양보호사")
  rest = rest.replace(/[)）]+$/, '').trim();

  return { cleaned: phonePart, note: rest };
};

// 입력 중 실시간 자동 포맷 (숫자만 추출 → 대시 삽입)
export const formatPhoneInput = (raw) => {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.startsWith('02')) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0,2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0,2)}-${digits.slice(2,5)}-${digits.slice(5)}`;
    return `${digits.slice(0,2)}-${digits.slice(2,6)}-${digits.slice(6)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0,3)}-${digits.slice(3)}`;
  return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
};

// 엑셀이 앞자리 0을 숫자로 떼어낸 휴대폰 복원: 10자리 + 휴대폰접두어(10/11/16~19) → 앞에 0 붙여 11자리.
// 예: 1080986080 → 01080986080(010-8098-6080). 유선(02/0XX)은 0으로 시작하므로 영향 없음.
export const restoreMobileLeadingZero = (d) =>
  (d.length === 10 && /^1[016789]/.test(d)) ? `0${d}` : d;

export const formatPhone = (s) => {
  const d = restoreMobileLeadingZero(String(s || '').replace(/[^\d]/g, ''));
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  if (d.length === 10) {
    if (d.startsWith('02')) return `${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6)}`;
    return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  }
  if (d.length === 9 && d.startsWith('02')) return `${d.slice(0,2)}-${d.slice(2,5)}-${d.slice(5)}`;
  return s;
};

export const parsePhoneNumbers = (p1, p2) => {
  // 엑셀이 0을 떼어낸 휴대폰(1080986080)도 휴대폰으로 인식되도록 앞자리 0 복원 후 판별.
  let str1 = restoreMobileLeadingZero(String(p1 || '').replace(/[^\d]/g, ''));
  let str2 = restoreMobileLeadingZero(String(p2 || '').replace(/[^\d]/g, ''));
  let mobile = ''; let landline = '';

  const isMobile = (s) => /^(010|011|016|017|018|019)/.test(s);

  [str1, str2].filter(Boolean).forEach(p => {
    if (isMobile(p) && !mobile) mobile = p;
    else if (!landline) landline = p;
  });

  return { mobile: formatPhone(mobile), landline: formatPhone(landline) };
};

export const parseSMS = (val) => {
  const s = String(val || '').replace(/\s+/g, '').trim(); // 내부 공백 제거("수신 함"→"수신함")
  if (!s || s === '-') return 'N';
  // 1) 거부·미동의·안함 — 부정 우선 (수신보다 먼저 걸려야 함)
  if (/거부|거절|불가|불허|미동의|미수신|미신청|부동의|비동의|수신안|안받|안함|미함|무응답|해지|중지/.test(s)) return 'N';
  if (/^(N|n|X|x|×|0|F|f|아니오?|불|없음|부|무|미|안|×)$/.test(s)) return 'N';
  // 2) 수신 동의 — 단일 표기 + 변형
  if (/^(Y|y|O|o|○|ㅇ|1|T|t|예|여|유|함|동의|수신|가능|허용|신청|승낙|찬성|yes|YES|true)$/.test(s)) return 'Y';
  if (/동의|수신|가능|허용|신청|승낙|찬성/.test(s)) return 'Y';
  // 3) 기본값 N
  return 'N';
};

export const parseBirthDate = (val) => {
  if (!val) return '';
  const digits = String(val).replace(/[^\d]/g, '');
  if (digits.length === 6) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}`;
  } else if (digits.length === 8) {
    return `${digits.slice(2, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`; 
  }
  let str = String(val).trim();
  if (/^\d{2}[-./]\d{2}[-./]\d{2}$/.test(str)) {
    return str.replace(/[-/]/g, '.');
  }
  return str;
};

export const normalizeBirth = (raw) => {
  const s = String(raw).trim();
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(s)) return s;
  const d = s.replace(/[^0-9]/g, '');
  if (d.length === 8) return `${d.slice(2,4)}.${d.slice(4,6)}.${d.slice(6,8)}`;
  if (d.length === 6) return `${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`;
  return '';
};
