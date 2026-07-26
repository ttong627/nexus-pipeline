// 정제결과 품질 분석 순수함수 — 앱(정밀분석 리포트)·테스트 공용. firestore 비의존.
//
// 정제결과 요약(purifyResult)이 이미 커버하는 '주소 매칭 품질'을 넘어, 정제 후 데이터 품질을 분석:
//   1) 중복 인물 — 같은 명단 안 동일인(이름 + 생년월일8|휴대폰끝8|유선끝8 강키). 이름만(약키)은 제외(동명이인 오탐 금지).
//   2) 원본 대비 누락 — 원본 신고 인원·포수(declaredHead/Qty) vs 정제 결과.
//   3) 수량 이상 — 포수 0 이하 / 과다(>10).
//
// dedup-cloud-lists.mjs의 동일인 판정(이름+생년/휴대폰/유선 union-find)과 동일 규칙.

const digit = (s) => String(s || '').replace(/\D/g, '');

// 이름 + 강키(생년8·휴대폰끝8·유선끝8) union-find로 동일인 묶기. 강키 없는 행은 제외.
function findDuplicates(rows) {
  const named = rows.map((r, i) => ({ r, i })).filter((x) => String(x.r.이름 || '').trim());
  const parent = named.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  const hasKey = (r) => !!digit(r.생년월일) || digit(r.휴대폰).length >= 8 || digit(r.유선전화).length >= 8;

  const byKey = new Map();
  named.forEach((x, idx) => {
    const r = x.r, nm = String(r.이름).trim();
    const b = digit(r.생년월일), mo = digit(r.휴대폰), l = digit(r.유선전화);
    const keys = [];
    if (b) keys.push(`b:${nm}:${b}`);
    if (mo.length >= 8) keys.push(`m:${nm}:${mo.slice(-8)}`);
    if (l.length >= 8) keys.push(`l:${nm}:${l.slice(-8)}`);
    for (const k of keys) { if (byKey.has(k)) uni(idx, byKey.get(k)); else byKey.set(k, idx); }
  });

  const groups = new Map();
  named.forEach((x, idx) => {
    if (!hasKey(x.r)) return; // 강키 없는 행(이름만)은 동일인 판정 제외
    const root = find(idx);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(x);
  });

  const dups = [];
  for (const [, members] of groups) {
    if (members.length >= 2) {
      dups.push({
        name: String(members[0].r.이름).trim(),
        count: members.length,
        ids: members.map((m) => m.r.id),
      });
    }
  }
  return dups;
}

export function analyzeQuality(gridData = [], meta = {}) {
  const rows = Array.isArray(gridData) ? gridData : [];

  // 1) 중복 인물
  const duplicates = findDuplicates(rows);
  const dupExtra = duplicates.reduce((s, g) => s + (g.count - 1), 0);

  // 2) 원본 대비 누락 대조
  const actualHead = rows.length;
  const actualQty = rows.reduce((s, r) => s + (parseInt(r.포수, 10) || 0), 0);
  const dH = Number(meta.declaredHead) || 0;
  const dQ = Number(meta.declaredQty) || 0;
  const shortage = (dH > 0 || dQ > 0)
    ? {
        declaredHead: dH, actualHead, headDiff: dH ? dH - actualHead : 0,
        declaredQty: dQ, actualQty, qtyDiff: dQ ? dQ - actualQty : 0,
      }
    : null;

  // 3) 수량 이상
  const qtyZero = rows.filter((r) => (parseInt(r.포수, 10) || 0) <= 0).map((r) => r.id);
  const qtyHigh = rows.filter((r) => (parseInt(r.포수, 10) || 0) > 10).map((r) => r.id);

  return {
    duplicates,
    dupGroups: duplicates.length,
    dupExtra,
    shortage,
    qtyZero,
    qtyHigh,
    hasIssues: duplicates.length > 0 || qtyZero.length > 0 || qtyHigh.length > 0 ||
      !!(shortage && (shortage.headDiff > 0 || shortage.qtyDiff > 0)),
  };
}

export default analyzeQuality;
