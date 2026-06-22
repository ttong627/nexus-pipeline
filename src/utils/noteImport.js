// ══════════════════════════════════════════════════════════════════
//  기초명단(특이사항 파일) 이식 — 정밀 매칭 / 중복정리 / 다중시트 출력
//  · 파싱은 본명단과 동일한 excelWorker(PARSE_TARGET) 결과(sheetsData)를 재사용
//    → 매크로 찌꺼기 제거·다중시트 인식·컬럼 자동매칭이 그대로 적용됨.
//  · 매칭 규칙(형님 지시): 이름 필수 + (생년월일·휴대폰·행정동 중 1개 이상) = 매칭.
//  · 동명이인 안전: 한 줄이 2명 이상과 매칭되면 자동이식 금지 → 「동명이인확인」 시트.
//  · 특이사항 파일 자체 중복(같은 사람 여러 줄)은 1명으로 합쳐 중복 이식 방지.
// ══════════════════════════════════════════════════════════════════
import * as XLSX from 'xlsx';
import { sortByDeliveryOrder } from './sortRecords.js';

const norm = (s) => String(s ?? '').replace(/\s/g, '').trim();
const digitsOnly = (s) => String(s ?? '').replace(/[^\d]/g, '');
// 생년월일 비교 키 — 숫자만 추출 후 끝 6자리(YYMMDD). 8자리(YYYYMMDD)도 끝6 동일.
const birthKey = (v) => { const d = digitsOnly(v); return d.length >= 6 ? d.slice(-6) : ''; };
// 휴대폰/전화 비교 키 — 숫자만 추출 후 끝 8자리.
const phoneKey = (v) => { const d = digitsOnly(v); return d.length >= 8 ? d.slice(-8) : ''; };
const dongKey = (v) => norm(v);

// 특이사항 병합(중복 내용 방지)
export function mergeNote(existing, add) {
  const e = String(existing || '').trim();
  const a = String(add || '').trim();
  if (!a) return e;
  if (!e) return a;
  if (e.replace(/\s/g, '').includes(a.replace(/\s/g, ''))) return e;
  return `${e} ${a}`;
}

// PARSE_TARGET 결과(sheetsData)에서 특이사항 행 추출 — colIndices(한글 키) 사용 + 시트별 행정동 보완
export function extractNoteRows(sheetsData) {
  const rows = [];
  (sheetsData || []).forEach((s) => {
    const ci = s.colIndices || {};
    const headers = s.headers || [];
    const body = s.bodyRows || [];
    const nameIdx = ci['이름'];
    if (nameIdx === undefined || nameIdx === -1) return; // 이름 칼럼 없는 시트(통계/안내)는 제외
    const birthIdx = ci['생년월일'];
    const phoneIdx = ci['연락처'];
    const phone2Idx = ci['보조연락처'];
    const dongIdx = ci['행정동'];
    const noteIdx = ci['비고'];
    // 배송순번 칼럼은 자동매핑 대상이 아니므로 헤더에서 직접 탐지
    const seqIdx = headers.findIndex(h => /배송\s*순번|배송순|순번|순서/.test(String(h || '').replace(/\s/g, '')));
    body.forEach((r) => {
      const name = String(r[nameIdx] ?? '').trim();
      if (!name || /^(성명|이름|합계|소계|계|총계)$/.test(norm(name))) return;
      rows.push({
        name,
        birth: birthIdx >= 0 ? String(r[birthIdx] ?? '').trim() : '',
        phone: phoneIdx >= 0 ? String(r[phoneIdx] ?? '').trim() : '',
        phone2: phone2Idx >= 0 ? String(r[phone2Idx] ?? '').trim() : '',
        dong: (dongIdx >= 0 ? String(r[dongIdx] ?? '').trim() : '') || String(s.name || '').trim(),
        note: noteIdx >= 0 ? String(r[noteIdx] ?? '').trim() : '',
        seqNo: seqIdx >= 0 ? String(r[seqIdx] ?? '').trim() : '',
      });
    });
  });
  return rows;
}

// 특이사항 파일 자체 중복 정리 — 같은 사람(이름+생년 / 이름+폰)으로 묶어 1명으로 합침
export function dedupNoteRows(rows) {
  const byKey = new Map();   // personKey → merged row
  const order = [];
  const personKey = (r) => {
    const b = birthKey(r.birth);
    if (b) return `n:${norm(r.name)}|b:${b}`;
    const p = phoneKey(r.phone) || phoneKey(r.phone2);
    if (p) return `n:${norm(r.name)}|p:${p}`;
    return `n:${norm(r.name)}|d:${dongKey(r.dong)}`;
  };
  rows.forEach((r) => {
    const k = personKey(r);
    if (!byKey.has(k)) { byKey.set(k, { ...r }); order.push(k); return; }
    const t = byKey.get(k);
    t.note = mergeNote(t.note, r.note);          // 특이사항 병합
    if (!t.seqNo && r.seqNo) t.seqNo = r.seqNo;   // 배송순번 첫 유효값
    if (!t.birth && r.birth) t.birth = r.birth;
    if (!t.phone && r.phone) t.phone = r.phone;
    if (!t.dong && r.dong) t.dong = r.dong;
  });
  return order.map((k) => byKey.get(k));
}

// 본명단 레코드 1건 vs 특이사항 1줄 — 일치 점수(이름 일치 여부 + 보조키 일치 수)
function matchScore(roster, note) {
  const nameMatch = !!norm(roster.이름) && norm(roster.이름) === norm(note.name);
  if (!nameMatch) return { nameMatch: false, extra: 0 };
  let extra = 0;
  const rb = birthKey(roster.생년월일), nb = birthKey(note.birth);
  if (rb && nb && rb === nb) extra++;
  const rp = phoneKey(roster.휴대폰) || phoneKey(roster.유선전화);
  const np = phoneKey(note.phone) || phoneKey(note.phone2);
  if (rp && np && rp === np) extra++;
  const rd = dongKey(roster.행정동), nd = dongKey(note.dong);
  if (rd && nd && rd === nd) extra++;
  return { nameMatch: true, extra };
}

// 매칭 실행 — 명단(roster)이 중심. 명단의 각 사람에게 특이사항 파일에서 찾아 이식.
//  규칙: 이름 필수 + (생년·휴대폰·행정동 중 1개 이상) = 매칭(이름+1, 총 2점 이상)
//  · 후보 1개 → 이식  · 후보 0개 → 그냥 넘어감(특이사항 없는 정상인)
//  · 후보 2개 이상(어느 걸 이식할지 모호) 또는 한 특이사항이 명단 여러 명과 겹침 → 동명이인 시트
//  ※ 명단에 없는 특이사항(과거 자료)은 무시 — '미매칭'은 만들지 않는다.
// return: { applied: Map(rosterId → {note, seqNo, fromName}), ambiguous: [{roster, candidates:[note...], reason?}], appliedCount }
export function matchNotesToRoster(rosterRecords, noteRows) {
  const applied = new Map();
  const ambiguous = [];

  // 이름 인덱스 (양방향) — 이름이 필수 조건이므로 같은 이름끼리만 비교(O(n+m))
  const notesByName = new Map();
  noteRows.forEach((n) => { const k = norm(n.name); if (!k) return; (notesByName.get(k) || notesByName.set(k, []).get(k)).push(n); });
  const rostersByName = new Map();
  rosterRecords.forEach((r) => { const k = norm(r.이름); if (!k) return; (rostersByName.get(k) || rostersByName.set(k, []).get(k)).push(r); });

  rosterRecords.forEach((R) => {
    const pool = notesByName.get(norm(R.이름)) || [];
    const cands = pool.filter((n) => { const s = matchScore(R, n); return s.nameMatch && s.extra >= 1; });
    if (cands.length === 0) return;                       // 특이사항 없음 → 정상, 무시
    if (cands.length >= 2) { ambiguous.push({ roster: R, candidates: cands }); return; }   // 붙일 후보 여러 개 → 모호
    const note = cands[0];
    // 이 특이사항이 명단의 다른 사람과도 매칭되면(공유) 모호 → 동명이인
    const rPool = rostersByName.get(norm(note.name)) || [];
    const sharers = rPool.filter((rr) => { const s = matchScore(rr, note); return s.nameMatch && s.extra >= 1; });
    if (sharers.length >= 2) { ambiguous.push({ roster: R, candidates: [note], reason: '같은 특이사항이 명단의 여러 대상과 겹침' }); return; }
    applied.set(R.id, { note: note.note || '', seqNo: note.seqNo || '', fromName: note.name });
  });

  return { applied, ambiguous, appliedCount: applied.size };
}

// 매칭 결과를 본명단(results)에 이식 — 특이사항은 기존 뒤 ◆로 추가(D-4), 배송순번 비었으면 채움
// 원본 불변: 새 배열 반환
export function applyNotesToRoster(rosterRecords, applied) {
  return rosterRecords.map((r) => {
    const a = applied.get(r.id);
    if (!a) return r;
    const next = { ...r };
    if (a.note) {
      const clean = a.note.replace(/^\[기본\]\s*/g, '').trim();
      next.특이사항 = mergeNote(r.특이사항 || '', `◆${clean}`);
    }
    if (a.seqNo && !String(r.배송순번 || '').trim()) next.배송순번 = a.seqNo;
    return next;
  });
}

// 다중 시트 엑셀 다운로드 — [전체명단] + [동명이인확인] (명단 중심, 미매칭 시트 없음)
export function downloadNoteImportWorkbook({ city, monthId, rosterRows, ambiguous, activeCols }) {
  const wb = XLSX.utils.book_new();

  // [전체명단] — 정렬기준(행정동→리→주소→이름) 적용
  const sorted = sortByDeliveryOrder(rosterRows);
  const mainRows = sorted.map((r, i) => {
    const row = {};
    activeCols.forEach((c) => {
      if (c.key === 'NO') row[c.label] = i + 1;
      else if (c.key === '사유') row[c.label] = r._에러 ? r._사유 : '정상';
      else row[c.label] = r[c.key] ?? '';
    });
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mainRows), '전체명단');

  // [동명이인확인] — 명단 대상자 1명 + 붙일 후보 특이사항들. 담당자가 어느 걸 이식할지 확인.
  if (ambiguous.length) {
    const ambRows = [];
    ambiguous.forEach((a) => {
      const R = a.roster || {};
      (a.candidates || []).forEach((n, ci) => {
        ambRows.push({
          '명단_이름': R.이름 || '',
          '명단_행정동': R.행정동 || '',
          '명단_주소': R.주소 || '',
          '명단_휴대폰': R.휴대폰 || '',
          '명단_생년월일': R.생년월일 || '',
          '후보번호': ci + 1,
          '후보_특이사항': n.note || '',
          '후보_배송순번': n.seqNo || '',
          '후보_행정동': n.dong || '',
          '후보_휴대폰': n.phone || '',
          '후보_생년월일': n.birth || '',
          '비고': a.reason || '어느 특이사항을 이식할지 담당자 확인',
        });
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ambRows), '동명이인확인');
  }

  XLSX.writeFile(wb, `${city || '지자체'}_${monthId || ''}_정제+특이사항이식.xlsx`);
}
