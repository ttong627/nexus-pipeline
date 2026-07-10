// 동명이인 안전 매칭 코어 (S-1~S-5) — 순수함수. 네트워크·엔진·env 의존 없음(node --test 가능).
//   repair-address-tampering.mjs v2가 사용. 규칙 전문: CLAUDE.md §1-4 · 동명이인_주소오염_재발방지_설계.md
//
//   원칙: 주소를 '쓰는' 매칭은 강키(이름+전화끝8)만. 약키(이름)는 양측(원본·레코드) 모두
//   유일할 때만. 무도로명 원본(주민센터 등)도 등록해 그 인물을 자동수리에서 제외.
//   원본은 1레코드에만 소비. 본번 불일치 원본은 절대 채택하지 않는다.

export const digits = (v) => String(v || '').replace(/[^0-9]/g, '');
export const phoneKey = (v) => { const d = digits(v); return d.length >= 8 ? d.slice(-8) : ''; };
export const normText = (s) => String(s || '').replace(/\s+/g, '');

const SIDO_RE = /(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|충북|충남|전라북도|전북특별자치도|전라남도|전북|전남|경상북도|경상남도|경북|경남|제주특별자치도|제주도)/g;

// 도로명+건물번호 추출 (repair 스크립트 roadNo와 동일 규약)
export const roadNo = (a) => {
  let s = String(a || '')
    .replace(/\(.*$/s, ' ')
    .replace(SIDO_RE, ' ')
    .replace(/[가-힣]{2,}(시|군|구)(?=\s|$)/g, ' ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
    .replace(/\s+/g, ' ')
    .trim();
  const m = s.match(/((?:[가-힣A-Za-z0-9]+\s*)*(?:대로|로|길))\s*(\d+(?:-\d+)?)/);
  return m ? m[1].replace(/\s/g, '') + m[2] : null;
};
export const baseNo = (rn) => (rn ? rn.replace(/-\d+$/, '') : '');

export const CENTER_RE = /(주민\s*센터|행정복지센터|동사무소|읍사무소|면사무소|복지센터)/;

// ── 원본 인덱스 구축 ────────────────────────────────────────────
// rows: [{name, dong, detail, phone}] (phone 없으면 '')
// 반환: { byStrong: Map<name__ph8, entry[]>, byName: Map<name, entry[]> }
//   entry = { name, dong, detail, phone, rn, hasRoad, isCenter, consumed:false }
export function buildOrigIndex(rows) {
  const byStrong = new Map();
  const byName = new Map();
  for (const r of rows || []) {
    const name = String(r.name || '').trim();
    if (!name) continue;
    const detail = String(r.detail || '').trim();
    const rn = roadNo(detail);
    const entry = {
      name,
      dong: normText(r.dong),
      detail,
      phone: phoneKey(r.phone),
      rn,
      hasRoad: !!rn,
      isCenter: CENTER_RE.test(detail),
      consumed: false,
    };
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(entry);
    if (entry.phone) {
      const k = `${name}__${entry.phone}`;
      if (!byStrong.has(k)) byStrong.set(k, []);
      byStrong.get(k).push(entry);
    }
  }
  return { byStrong, byName };
}

// ── 레코드 1건에 대한 원본 매칭 판정 (S-1~S-5) ───────────────────
// rec: { name, dong, phone, savedRoadNo }  (savedRoadNo = 저장된 주소의 roadNo)
// 반환: { action: 'repair'|'skip'|'normal', orig?, reason }
//   'repair' = orig.detail 기준 재정제 후보 (원본 소비 처리됨)
//   'normal' = 저장 주소가 원본과 일치(수리 불필요)
//   'skip'   = 자동 수리 금지(사유 명시) — 리포트 대상
export function matchOrigForRecord(rec, index) {
  const name = String(rec.name || '').trim();
  const recDong = normText(rec.dong);
  const ph = phoneKey(rec.phone);
  const all = index.byName.get(name) || [];

  if (!all.length) return { action: 'skip', reason: '원본에 없는 이름(신규/이탈) — 수동확인' };

  // 1) 강키: 이름+전화끝8 — 유일할 때만 (가족 공용전화 동명 대비)
  let candidates = null;
  let via = '';
  if (ph) {
    const strong = (index.byStrong.get(`${name}__${ph}`) || []).filter((e) => !e.consumed);
    if (strong.length === 1) { candidates = strong; via = '강키(이름+전화)'; }
    else if (strong.length > 1) return { action: 'skip', reason: `강키 충돌(이름+전화 동일 ${strong.length}건) — 수동확인` };
  }

  // 2) 약키: 이름 — S-2 양측 유일(원본에서도 1건, 레코드 쪽 동명이인 여부는 호출부가 recNameCount로 전달)
  if (!candidates) {
    if ((rec.recNameCount || 1) > 1) return { action: 'skip', reason: '동명이인(명단 내 이름 중복) + 강키 불일치 — 수동확인' };
    const weak = all.filter((e) => !e.consumed && (!recDong || !e.dong || e.dong === recDong));
    if (weak.length !== 1) return { action: 'skip', reason: `약키 후보 ${weak.length}건(유일 아님) — 수동확인` };
    candidates = weak;
    via = '약키(이름 양측유일)';
  }

  const orig = candidates[0];

  // 3) S-3: 자기 원본이 무도로명/주민센터 → 자동수리 금지(배송요청 가능 — 담당자 판단)
  if (!orig.hasRoad || orig.isCenter) {
    orig.consumed = true; // 이 인물 몫의 원본은 소비(동명이인에게 흘러가지 않게)
    return { action: 'skip', reason: `원본이 특수주소(${orig.isCenter ? '주민센터류' : '도로명 없음'}) — 담당자 판단` };
  }

  // 4) 저장 주소와 원본 일치 → 정상
  if (rec.savedRoadNo && orig.rn === rec.savedRoadNo) {
    orig.consumed = true;
    return { action: 'normal', orig, reason: `원본 일치(${via})` };
  }

  // 5) S-5: 본번 일치할 때만 수리 후보 (임의 폴백 금지)
  if (rec.savedRoadNo && baseNo(orig.rn) !== baseNo(rec.savedRoadNo)) {
    return { action: 'skip', reason: `본번 상이(저장 ${rec.savedRoadNo} vs 원본 ${orig.rn}) — 임의 교체 금지, 수동확인` };
  }

  // S-4: 원본 소비
  orig.consumed = true;
  return { action: 'repair', orig, reason: `부번 수리 후보(${via})` };
}
