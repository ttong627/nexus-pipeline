// 지자체별 전용 내보내기 칼럼 형식 (이번달 배송명단 xlsx 다운로드).
// selectedCity가 match에 걸리면 기본 형식 대신 해당 지자체 전용 칼럼 형식으로 내보낸다.
// 매칭 안 되면 null → CloudListManager가 기존 기본 형식 사용.

// 행정동 → 주소(도로명, 한국어 numeric) → 이름 순 정렬 (원본 업로드 명단과 동일 순서)
const sortForExport = (records) => {
  const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true });
  return [...records].sort((a, b) =>
    cmp(a.행정동, b.행정동) || cmp(a.주소, b.주소) || cmp(a.이름, b.이름));
};

const CITY_EXPORT_TEMPLATES = [
  {
    // 안양시 동안구 — 원본 업로드 칼럼 형식.
    // 읍면동=행정동, 주소(나머지 주소)=정제 주소(괄호 안 동=법정동), 번호 칼럼은 비움(배송순번 아님).
    match: (city) => /안양시\s*동안구/.test(city || ''),
    sheetName: 'Sheet1',
    sigungu: '안양시 동안구',
    headers: ['구 분', '이름', '시군구', '읍면동', '주소(나머지 주소)', '전화번호', '핸드폰번호', '10kg(포수)', '20kg(포수)', '비고', '문자', '번호'],
    colWidths: [10, 9, 12, 9, 44, 15, 15, 10, 10, 24, 5, 6],
    buildRows: (records, { sigungu }) =>
      sortForExport(records).map((r) => ({
        '구 분': r.구분 || '',
        '이름': r.이름 || '',
        '시군구': sigungu,
        '읍면동': r.행정동 || '',
        '주소(나머지 주소)': r.주소 || '',
        '전화번호': r.유선전화 || '',
        '핸드폰번호': r.휴대폰 || '',
        '10kg(포수)': r.포수 ? (Number(r.포수) || r.포수) : '',
        '20kg(포수)': '',
        '비고': r.특이사항 || '',
        '문자': r.문자수신 || '',
        '번호': '', // 순번 비움 (배송순번 아님)
      })),
  },
];

export const getCityExportTemplate = (city) =>
  CITY_EXPORT_TEMPLATES.find((t) => t.match(city)) || null;
