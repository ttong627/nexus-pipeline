export const parsePhoneNumbers = (p1, p2) => {
  let str1 = String(p1 || '').replace(/[^\d]/g, '');
  let str2 = String(p2 || '').replace(/[^\d]/g, '');
  let mobile = ''; let landline = '';
  
  const isMobile = (s) => /^(010|011|016|017|018|019)/.test(s);
  const formatPhone = (s) => {
    if (s.length === 11) return s.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    if (s.length === 10) {
      if (s.startsWith('02')) return s.replace(/(\d{2})(\d{4})(\d{4})/, '$1-$2-$3');
      return s.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    }
    if (s.length === 9 && s.startsWith('02')) return s.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
    return s;
  };

  [str1, str2].filter(Boolean).forEach(p => {
    if (isMobile(p) && !mobile) mobile = p;
    else if (!landline) landline = p;
  });

  return { mobile: formatPhone(mobile), landline: formatPhone(landline) };
};

export const parseSMS = (val) => {
  const s = String(val || '').trim();
  if (!s || s === '-') return 'N';
  // 거부 패턴 우선 (수신거부가 수신보다 먼저 걸려야 함)
  if (/거부|거절|불가|불허|미동의|미수신|수신\s*불가/.test(s)) return 'N';
  if (/^(N|n|X|x|×|0|아니오?|불|없음)$/.test(s)) return 'N';
  // 수신 패턴
  if (/^(Y|y|O|o|○|ㅇ|1|예|동의|수신|가능|허용|yes|YES)$/.test(s)) return 'Y';
  if (/동의|수신|가능|허용/.test(s)) return 'Y';
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
  const d = String(raw).replace(/[^0-9]/g, '');
  if (d.length === 8) return `${d.slice(2,4)}.${d.slice(4,6)}.${d.slice(6,8)}`;
  if (d.length === 6) return `${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`;
  return '';
};
