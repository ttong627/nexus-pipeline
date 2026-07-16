// ══════════════════════════════════════════════════════════════════
//  소속사 보고서 — 소속사별 담당 행정동(동)을 묶어 엑셀 시트로 분리 다운로드
//  · OrgPresetModal(설정 화면)과 ResultGrid(즉시 다운로드 버튼)가 공용으로 사용
//  · orgs: [{ id, name, color, dongs: [행정동...] }]  (org_presets/{city} 에 저장됨)
// ══════════════════════════════════════════════════════════════════
import * as XLSX from 'xlsx';
import { sortByDeliveryOrder } from './sortRecords.js';

const makeSheetData = (recs) =>
  recs.map((r, i) => ({
    번호: i + 1, 구분: r.구분 || '', 이름: r.이름 || '', 생년월일: r.생년월일 || '',
    행정동: r.행정동 || '', 주소: r.주소 || '', 휴대폰: r.휴대폰 || '',
    유선전화: r.유선전화 || '', 포수: r.포수 || '', 특이사항: r.특이사항 || '',
    기사: r.기사 || '', 배송순번: r.배송순번 || '',
  }));

// 소속사별 시트 + 미배정 + 전체 시트로 분리한 엑셀을 다운로드한다.
// return: { ok: boolean, reason?: 'no-records' | 'no-orgs' | 'empty' }
export function downloadOrgReport({ city, monthId, orgs, records }) {
  if (!records?.length) return { ok: false, reason: 'no-records' };
  if (!orgs?.length) return { ok: false, reason: 'no-orgs' };

  // 기본 정렬(행정동→리→주소→이름) 적용 — 소속사별 시트·미배정·전체 모두 동일 순서
  records = sortByDeliveryOrder(records);

  const allDongs = [...new Set((records || []).map(r => (r.행정동 || '').trim()).filter(Boolean))];
  const assignedDongs = {};
  orgs.forEach(org => (org.dongs || []).forEach(d => { assignedDongs[d] = org.id; }));
  const unassignedDongs = allDongs.filter(d => !assignedDongs[d]);

  const wb = XLSX.utils.book_new();

  // ── 소속사 요약 시트 (맨 앞) — 소속사별 동별 포수 + 소속사 소계 + 전체 합계 (행정동요약 형식) ──
  // 빈 포수=1(규칙 C-4). 구분별(수급자/차상위) + 전체 포수를 함께 표기.
  const sumPo = (recs) => recs.reduce((s, r) => s + (parseInt(r.포수) || 1), 0);
  const suPo  = (recs) => sumPo(recs.filter(r => r.구분 === '기초수급자'));
  const chaPo = (recs) => sumPo(recs.filter(r => r.구분 === '차상위'));
  const summaryAoa = [
    ['소속사', '행정동', '수급자(포)', '차상위(포)', '전체(포)'],
    ['■ 전체 합계', '', suPo(records), chaPo(records), sumPo(records)],
  ];
  const pushOrgBlock = (label, dongs) => {
    const orgRecs = records.filter(r => (dongs || []).includes((r.행정동 || '').trim()));
    if (!orgRecs.length) return;
    summaryAoa.push([label, '소계', suPo(orgRecs), chaPo(orgRecs), sumPo(orgRecs)]);   // 소속사 합계
    (dongs || []).forEach(dong => {
      const dr = orgRecs.filter(r => (r.행정동 || '').trim() === dong);
      if (dr.length) summaryAoa.push(['', dong, suPo(dr), chaPo(dr), sumPo(dr)]);      // 소속사 동별 포수
    });
  };
  orgs.forEach(org => pushOrgBlock(org.name || '소속사', org.dongs || []));
  if (unassignedDongs.length) pushOrgBlock('미배정', unassignedDongs);
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa);
  summaryWs['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, '소속사요약');

  orgs.forEach(org => {
    const orgRecs = records.filter(r => (org.dongs || []).includes((r.행정동 || '').trim()));
    if (!orgRecs.length) return;
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(makeSheetData(orgRecs)),
      String(org.name || '소속사').slice(0, 31)
    );
  });
  if (unassignedDongs.length) {
    const unRecs = records.filter(r => unassignedDongs.includes((r.행정동 || '').trim()));
    if (unRecs.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(makeSheetData(unRecs)), '미배정');
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(makeSheetData(records)), '전체');

  if (wb.SheetNames.length === 0) return { ok: false, reason: 'empty' };
  XLSX.writeFile(wb, `${city}_${monthId}_소속사배분.xlsx`);
  return { ok: true };
}
