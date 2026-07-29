// 표기변이 정규화 완전일치 유틸 — 승인된 사전(건물명·특이사항)의 표기 변이를 흡수.
//   ★부분매칭 아님. 공백·기호만 제거한 뒤 '전체' 완전일치(부분 포함매칭은 오적용 위험이라 영구 금지).
//   ★정규화 키가 충돌(서로 다른 원본이 같은 정규화 키)하면 그 키는 배제 — 모호 매칭 사고 차단.
//   이름에는 쓰지 않는다(동명이인 민감). 건물명·특이사항 전용.

// 공백·연결기호만 제거(문자·숫자·한글 보존). 부분매칭이 아니라 표기 정규화용.
export function normalizeVariantKey(s) {
  return String(s ?? '').trim().replace(/[\s·.,()\-_/]/g, '');
}

// dict({원본키: 정답}) → {정규화키: 정답}. 정규화 키가 유일할 때만(다른 정답과 충돌 시 배제).
export function buildVariantIndex(dict) {
  const index = {};
  const collided = new Set();
  for (const [k, v] of Object.entries(dict || {})) {
    const val = String(v ?? '').trim();
    if (!val) continue;
    const nk = normalizeVariantKey(k);
    if (!nk || collided.has(nk)) continue;
    if (nk in index) {
      if (index[nk] !== val) { delete index[nk]; collided.add(nk); } // 다른 정답과 충돌 → 배제
    } else {
      index[nk] = val;
    }
  }
  return index;
}

// 완전일치 우선 → 정규화 완전일치 폴백. 미일치·빈매핑이면 원본 보존.
export function applyVariant(value, dict, variantIndex) {
  const raw = value ?? '';
  const key = String(raw).trim();
  if (!key) return '';
  if (dict) {
    const exact = dict[key];
    if (exact && String(exact).trim()) return exact;
  }
  if (variantIndex) {
    const hit = variantIndex[normalizeVariantKey(key)];
    if (hit && String(hit).trim()) return hit;
  }
  return raw;
}
