import * as XLSX from 'xlsx';

const KOREA_REGION_MAP = {
  "종로구": "서울특별시 종로구", "중구": "서울특별시 중구", "용산구": "서울특별시 용산구", "성동구": "서울특별시 성동구", "광진구": "서울특별시 광진구", "동대문구": "서울특별시 동대문구", "중랑구": "서울특별시 중랑구", "성북구": "서울특별시 성북구", "강북구": "서울특별시 강북구", "도봉구": "서울특별시 도봉구", "노원구": "서울특별시 노원구", "은평구": "서울특별시 은평구", "서대문구": "서울특별시 서대문구", "마포구": "서울특별시 마포구", "양천구": "서울특별시 양천구", "강서구": "서울특별시 강서구", "구로구": "서울특별시 구로구", "금천구": "서울특별시 금천구", "영등포구": "서울특별시 영등포구", "동작구": "서울특별시 동작구", "관악구": "서울특별시 관악구", "서초구": "서울특별시 서초구", "강남구": "서울특별시 강남구", "송파구": "서울특별시 송파구", "강동구": "서울특별시 강동구",
  "수원시": "경기도 수원시", "성남시": "경기도 성남시", "의정부시": "경기도 의정부시", "안양시": "경기도 안양시", "부천시": "경기도 부천시", "광명시": "경기도 광명시", "평택시": "경기도 평택시", "동두천시": "경기도 동두천시", "안산시": "경기도 안산시", "고양시": "경기도 고양시", "과천시": "경기도 과천시", "구리시": "경기도 구리시", "남양주시": "경기도 남양주시", "오산시": "경기도 오산시", "시흥시": "경기도 시흥시", "군포시": "경기도 군포시", "의왕시": "경기도 의왕시", "하남시": "경기도 하남시", "용인시": "경기도 용인시", "파주시": "경기도 파주시", "이천시": "경기도 이천시", "안성시": "경기도 안성시", "김포시": "경기도 김포시", "화성시": "경기도 화성시", "광주시": "경기도 광주시", "양주시": "경기도 양주시", "포천시": "경기도 포천시", "여주시": "경기도 여주시", "연천군": "경기도 연천군", "가평군": "경기도 가평군", "양평군": "경기도 양평군",
  "춘천시": "강원도 춘천시", "원주시": "강원도 원주시", "강릉시": "강원도 강릉시", "동해시": "강원도 동해시", "태백시": "강원도 태백시", "속초시": "강원도 속초시", "삼척시": "강원도 삼척시", "홍천군": "강원도 홍천군", "횡성군": "강원도 횡성군", "영월군": "강원도 영월군", "평창군": "강원도 평창군", "정선군": "강원도 정선군", "철원군": "강원도 철원군", "화천군": "강원도 화천군", "양구군": "강원도 양구군", "인제군": "강원도 인제군", "강원고성군": "강원도 고성군", "양양군": "강원도 양양군",
  "청주시": "충청북도 청주시", "충주시": "충청북도 충주시", "제천시": "충청북도 제천시", "보은군": "충청북도 보은군", "옥천군": "충청북도 옥천군", "영동군": "충청북도 영동군", "증평군": "충청북도 증평군", "진천군": "충청북도 진천군", "괴산군": "충청북도 괴산군", "음성군": "충청북도 음성군", "단양군": "충청북도 단양군",
  "천안시": "충청남도 천안시", "공주시": "충청남도 공주시", "보령시": "충청남도 보령시", "아산시": "충청남도 아산시", "서산시": "충청남도 서산시", "논산시": "충청남도 논산시", "계룡시": "충청남도 계룡시", "당진시": "충청남도 당진시", "금산군": "충청남도 금산군", "부여군": "충청남도 부여군", "서천군": "충청남도 서천군", "청양군": "충청남도 청양군", "홍성군": "충청남도 홍성군", "예산군": "충청남도 예산군", "태안군": "충청남도 태안군",
  "전주시": "전라북도 전주시", "군산시": "전라북도 군산시", "익산시": "전라북도 익산시", "정읍시": "전라북도 정읍시", "남원시": "전라북도 남원시", "김제시": "전라북도 김제시", "완주군": "전라북도 완주군", "진안군": "전라북도 진안군", "무주군": "전라북도 무주군", "장수군": "전라북도 장수군", "임실군": "전라북도 임실군", "순창군": "전라북도 순창군", "고창군": "전라북도 고창군", "부안군": "전라북도 부안군",
  "목포시": "전라남도 목포시", "여수시": "전라남도 여수시", "순천시": "전라남도 순천시", "나주시": "전라남도 나주시", "광양시": "전라남도 광양시", "담양군": "전라남도 담양군", "곡성군": "전라남도 곡성군", "구례군": "전라남도 구례군", "고흥군": "전라남도 고흥군", "보성군": "전라남도 보성군", "화순군": "전라남도 화순군", "장흥군": "전라남도 장흥군", "강진군": "전라남도 강진군", "해남군": "전라남도 해남군", "영암군": "전라남도 영암군", "무안군": "전라남도 무안군", "함평군": "전라남도 함평군", "영광군": "전라남도 영광군", "장성군": "전라남도 장성군", "완도군": "전라남도 완도군", "진도군": "전라남도 진도군", "신안군": "전라남도 신안군",
  "포항시": "경상북도 포항시", "경주시": "경상북도 경주시", "김천시": "경상북도 김천시", "안동시": "경상북도 안동시", "구미시": "경상북도 구미시", "영주시": "경상북도 영주시", "영천시": "경상북도 영천시", "상주시": "경상북도 상주시", "문경시": "경상북도 문경시", "경산시": "경상북도 경산시", "군위군": "경상북도 군위군", "의성군": "경상북도 의성군", "청송군": "경상북도 청송군", "영양군": "경상북도 영양군", "영덕군": "경상북도 영덕군", "청도군": "경상북도 청도군", "고령군": "경상북도 고령군", "성주군": "경상북도 성주군", "칠곡군": "경상북도 칠곡군", "예천군": "경상북도 예천군", "봉화군": "경상북도 봉화군", "울진군": "경상북도 울진군", "울릉군": "경상북도 울릉군",
  "창원시": "경상남도 창원시", "진주시": "경상남도 진주시", "통영시": "경상남도 통영시", "사천시": "경상남도 사천시", "김해시": "경상남도 김해시", "밀양시": "경상남도 밀양시", "거제시": "경상남도 거제시", "양산시": "경상남도 양산시", "의령군": "경상남도 의령군", "함안군": "경상남도 함안군", "창녕군": "경상남도 창녕군", "경남고성군": "경상남도 고성군", "남해군": "경상남도 남해군", "하동군": "경상남도 하동군", "산청군": "경상남도 산청군", "함양군": "경상남도 함양군", "거창군": "경상남도 거창군", "합천군": "경상남도 합천군",
  "제주시": "제주특별자치도 제주시", "서귀포시": "제주특별자치도 서귀포시"
};

const getVisibleSheetNames = (wb) => wb.SheetNames.filter(name => !wb.Workbook?.Sheets?.find(s => s.name === name)?.Hidden);

const normalizeBirth = (raw) => {
  const d = String(raw).replace(/[^0-9]/g, '');
  if (d.length === 8) return `${d.slice(2,4)}.${d.slice(4,6)}.${d.slice(6,8)}`;
  if (d.length === 6) return `${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`;
  return raw;
};

function extractCityName(fileName, rawJsonSamples, bodyRows, addrColIdx) {
  const headerText = fileName + ' ' + rawJsonSamples.map(r => r.join(' ')).join(' ');
  let addrText = '';
  if (addrColIdx !== undefined && addrColIdx >= 0 && bodyRows && bodyRows.length > 0) {
    addrText = bodyRows.slice(0, 15).map(r => String(r[addrColIdx] || '')).join(' ');
  }
  const fullText = headerText + ' ' + addrText;
  for (const value of Object.values(KOREA_REGION_MAP)) {
    if (fullText.includes(value)) return value;
  }
  for (const [key, value] of Object.entries(KOREA_REGION_MAP)) {
    if (fullText.includes(key)) return value;
  }
  return '';
}

function parseSheet(name, rawJson, dynamicRules) {
  let type;
  if (name.includes('수급') || name.includes('의료') || name.includes('생계')) type = '기초수급자';
  else if (name.includes('차상위')) type = '차상위';
  else type = '기초수급자';

  let selected = type !== '제외';
  let headerIdx = 0;
  let maxScore = -1;

  const activeReqKeys = dynamicRules?.reqKeys || [
    { k: '이름',   kws: ['이름', '성명', '대상자', '수령자명'] },
    { k: '주소',   kws: ['주소'] },
    { k: '수량',   kws: ['포수', '수량', '구입량', '가구원수', '포'] },
    { k: '연락처', kws: ['휴대', '연락', '전화', '유선', '핸드폰', '핸드', '모바일', '휴폰'] },
    { k: '행정동', kws: ['행정동', '읍면동', '동명', '관할구역'] },
    { k: '비고',   kws: ['특이사항', '비고', '메모'] }
  ];
  
  const allKws = activeReqKeys.flatMap(r => r.kws).concat(['비고', '연번', 'NO']);

  for (let i = 0; i < Math.min(20, rawJson.length); i++) {
    const rowStr = rawJson[i].map(c => String(c || '').trim()).join('');
    let score = 0;
    allKws.forEach(kw => { if (rowStr.includes(kw)) score++; });
    if (score > maxScore && rawJson[i].filter(c => String(c).trim() !== '').length > 2) {
      maxScore = score; headerIdx = i;
    }
  }

  // ─── 병합 헤더 처리 ──────────────────────────────────────────────
  const colCount = Math.max(
    ...[0, 1, 2].map(o => rawJson[headerIdx + o]?.length || 0)
  );
  const headerBuf = Array.from({ length: colCount }, (_, i) =>
    String(rawJson[headerIdx]?.[i] || '').trim()
  );

  for (let offset = 1; offset <= 2; offset++) {
    const subRow = rawJson[headerIdx + offset];
    if (!subRow) break;
    const subVals = subRow.map(c => String(c || '').trim());
    const nonEmpty = subVals.filter(Boolean);
    if (!nonEmpty.length) break;
    const looksLikeData = nonEmpty.some(v =>
      /\d{2,3}-\d{3,4}-\d{4}/.test(v) ||
      (/[가-힣]/.test(v) && v.length > 12) ||
      /^\d{6,}$/.test(v) ||
      /합계|소계|총계|집계/.test(String(v)) ||
      /^\d{1,3}(,\d{3})+$/.test(String(v))
    );
    if (looksLikeData) break;
    subVals.forEach((v, i) => { if (v && !headerBuf[i]) headerBuf[i] = v; });
  }

  const headerCounts = {};
  const headers = headerBuf.map((h, i) => {
    let name = h || `col_${i}`;
    if (headerCounts[name]) {
      const originalName = name;
      name = `${originalName} (${headerCounts[originalName]})`;
      headerCounts[originalName]++;
    } else {
      headerCounts[name] = 1;
    }
    return name;
  });
  // ─────────────────────────────────────────────────────────────────

  const mappedKeys = [];
  const missingKeys = [];
  const colIndices = {};
  const unmappedCols = [];

  activeReqKeys.forEach(req => {
    const idx = headers.findIndex(h => req.kws.some(k => h.includes(k)));
    if (idx !== -1) { mappedKeys.push(req.k); colIndices[req.k] = idx; }
    else missingKeys.push(req.k);
  });

  // 매핑되지 않은 컬럼 찾기 (빈 컬럼 무시, 알려진 키워드 없는 컬럼)
  headers.forEach((h) => {
    if (h.startsWith('col_') || !h.trim()) return;
    const isMapped = activeReqKeys.some(req => req.kws.some(k => h.includes(k)));
    if (!isMapped && !['비고', '연번', 'NO', '순번', '주민번호'].some(k => h.includes(k))) {
      unmappedCols.push(h);
    }
  });

  let dataStartRowIdx = -1;

  // 1차 필터: 표준
  let bodyRows = rawJson.slice(headerIdx + 1).filter((r, idx) => {
    const nonEmpties = r.filter(c => String(c).trim() !== '');
    if (nonEmpties.length <= 1) return false;
    const firstFour = r.slice(0, 4).map(c => String(c || '').trim()).join('');
    if (firstFour.includes('총계') || firstFour.includes('합계') || firstFour.includes('통계')) return false;
    if (colIndices['이름'] !== undefined) {
      const nameVal = String(r[colIndices['이름']] || '').trim();
      if (!nameVal || nameVal === '-') return false;
      if (/합계|소계|총계|집계|가구$|세대$/.test(nameVal)) return false;
    }
    if (dataStartRowIdx === -1) dataStartRowIdx = headerIdx + 1 + idx + 1;
    return true;
  });

  // 2차 폴백: 이름 필터로 0건이면 완화 재시도
  if (bodyRows.length === 0) {
    dataStartRowIdx = -1;
    bodyRows = rawJson.slice(headerIdx + 1).filter((r, idx) => {
      const nonEmpties = r.filter(c => String(c).trim() !== '');
      if (nonEmpties.length <= 1) return false;
      const firstFour = r.slice(0, 4).map(c => String(c || '').trim()).join('');
      if (firstFour.includes('총계') || firstFour.includes('합계') || firstFour.includes('통계')) return false;
      if (dataStartRowIdx === -1) dataStartRowIdx = headerIdx + 1 + idx + 1;
      return true;
    });
  }

  const emptyCellCounts = { '주소': 0, '수량': 0, '연락처': 0 };
  bodyRows.forEach(row => {
    ['주소', '수량', '연락처'].forEach(key => {
      if (colIndices[key] !== undefined) {
        if (!String(row[colIndices[key]] || '').trim()) emptyCellCounts[key]++;
      }
    });
  });
  const emptyWarnings = Object.keys(emptyCellCounts)
    .filter(k => emptyCellCounts[k] > 0)
    .map(k => `${k}(${emptyCellCounts[k]}건)`);

  const amtIdx = headers.findIndex(h =>
    h.includes('포수') || h.includes('수량') || h.includes('구입량') ||
    h.includes('가구원수') || h === '포' || (h.includes('포') && h.length <= 3)
  );
  let qty = 0;
  bodyRows.forEach(row => { qty += parseInt(row[amtIdx] || 0) || 1; });

  // ─── 데이터 컬럼 값으로 수급 유형 자동 감지 ──────────────────────────
  // 시트명이 '총괄관리대장' 등 불명확할 때, 구분/유형 컬럼의 실제 값을 보고
  // 기초수급자/차상위/혼합 여부를 판별
  if (bodyRows.length > 0) {
    const typeCandidateIdx = headers.findIndex(h =>
      h.includes('구분') || h.includes('유형') || h.includes('계층') || h.includes('자격')
    );
    if (typeCandidateIdx >= 0) {
      const detected = new Set();
      bodyRows.slice(0, 30).forEach(r => {
        const v = String(r[typeCandidateIdx] || '').trim();
        if (v.includes('차상위')) detected.add('차상위');
        if (v.includes('수급') || v.includes('기초')) detected.add('기초수급자');
      });
      if (detected.size > 1) type = '혼합';
      else if (detected.has('차상위')) type = '차상위';
      else if (detected.has('기초수급자')) type = '기초수급자';
    }
  }
  // ─────────────────────────────────────────────────────────────────────

  return {
    name, selected, type, qty, rowsCount: bodyRows.length,
    headers, bodyRows, headerRowIdx: headerIdx + 1,
    dataStartRowIdx, mappedKeys, missingKeys, emptyWarnings,
    addrColIdx: colIndices['주소'],
    unmappedCols,
    colIndices,
  };
}

self.onmessage = ({ data }) => {
  const { buffer, fileName, action, finalRows, exportCols } = data;

  try {
    // ── 행정동별 요약 보고서 ──────────────────────────────────────────────
    if (action === 'EXPORT_DONG_SUMMARY') {
      const { rawRows, activeCols, city, month, fileName: fn } = data;
      const wb2 = XLSX.utils.book_new();

      // 행정동 목록 (정렬)
      const dongSet = [...new Set(rawRows.map(r => String(r.행정동 || '-').trim()))].sort((a, b) => a.localeCompare(b));
      const colHeaders = activeCols.map(c => c.label);

      // Sheet 1 — 요약 (지자체명 + 월)
      const monthStr = String(month).replace(/월/g, '').trim() || '미상';
      const sheet1Name = `${city} ${monthStr}월 정보`.substring(0, 31);
      const totalSu  = rawRows.filter(r => r.구분 === '기초수급자').reduce((s, r) => s + (Number(r.포수) || 0), 0);
      const totalCha = rawRows.filter(r => r.구분 === '차상위').reduce((s, r) => s + (Number(r.포수) || 0), 0);
      const summaryAoa = [
        ['구분', '수급자(포)', '차상위(포)', '전체(포)'],
        ['전체합계', totalSu, totalCha, totalSu + totalCha],
      ];
      dongSet.forEach(dong => {
        const dr = rawRows.filter(r => String(r.행정동 || '-').trim() === dong);
        const dSu  = dr.filter(r => r.구분 === '기초수급자').reduce((s, r) => s + (Number(r.포수) || 0), 0);
        const dCha = dr.filter(r => r.구분 === '차상위').reduce((s, r) => s + (Number(r.포수) || 0), 0);
        summaryAoa.push([dong, dSu, dCha, dSu + dCha]);
      });
      const ws1 = XLSX.utils.aoa_to_sheet(summaryAoa);
      ws1['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb2, ws1, sheet1Name);

      // Sheet 2 — 합본 (전체 명단)
      const toRow = (r, i) => activeCols.map(c => {
        if (c.key === 'NO') return i + 1;
        if (c.key === '사유') return r._에러 ? r._사유 : '정상';
        return r[c.key] ?? '';
      });
      const ws2 = XLSX.utils.aoa_to_sheet([colHeaders, ...rawRows.map(toRow)]);
      ws2['!cols'] = activeCols.map(c => ({ wch: Math.min(Math.max(c.label.length * 2 + 4, 8), 32) }));
      XLSX.utils.book_append_sheet(wb2, ws2, '합본');

      // Sheet 3+ — 행정동별 시트
      dongSet.forEach(dong => {
        const dr = rawRows.filter(r => String(r.행정동 || '-').trim() === dong);
        const ws = XLSX.utils.aoa_to_sheet([colHeaders, ...dr.map(toRow)]);
        ws['!cols'] = activeCols.map(c => ({ wch: Math.min(Math.max(c.label.length * 2 + 4, 8), 32) }));
        const safeName = dong.substring(0, 31).replace(/[/\\*[\]:?]/g, '_') || '기타';
        XLSX.utils.book_append_sheet(wb2, ws, safeName);
      });

      const wbout = XLSX.write(wb2, { bookType: 'xlsx', type: 'array' });
      self.postMessage({ success: true, wbout, fileName: fn });
      return;
    }

    // ── 기존 표준 내보내기 ───────────────────────────────────────────────
    if (finalRows && exportCols) {
      const ws = XLSX.utils.json_to_sheet(finalRows, { header: exportCols });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "정제결과");
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      self.postMessage({ success: true, wbout, fileName });
      return;
    }

    if (!buffer) throw new Error("버퍼 데이터가 없습니다.");

    const wb = XLSX.read(new Uint8Array(buffer), {
      type: 'array',
      sheetRows: 25000,
      cellFormula: false,
      cellHTML: false,
      cellText: false,
      cellStyles: false,
      cellDates: false,
    });

    if (action === 'PARSE_BASE' || action === 'PARSE_BASE_WITH_MAP') {
      const manualMap = data.manualMap || null;
      let baseMap = {};
      let dupKeys = new Set();
      let totalExtracted = 0;
      let requiresMappingInfo = null;

      const visibleSheetNames = getVisibleSheetNames(wb);
      let targetSheetName = visibleSheetNames[0];
      let maxRows = 0;
      const sheetsInfo = [];

      visibleSheetNames.forEach(name => {
        const rowCount = wb.Sheets[name]['!ref'] ? XLSX.utils.decode_range(wb.Sheets[name]['!ref']).e.r : 0;
        if (rowCount > maxRows) { maxRows = rowCount; targetSheetName = name; }
        
        const sJson = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
        if (sJson.length >= 2) {
           let hIdx = 0;
           let mScore = -1;
           const sKWS = ['이름', '성명', '수령자', '주소', '휴대', '연락', '전화', '특이', '비고', '기사', '담당', '순번'];
           for (let i = 0; i < Math.min(20, sJson.length); i++) {
             const rowStr = sJson[i].join('');
             let score = 0;
             sKWS.forEach(k => { if (rowStr.includes(k)) score++; });
             if (score > mScore) { mScore = score; hIdx = i; }
           }

           const cCount = Math.max(...[0, 1].map(o => sJson[hIdx + o]?.length || 0));
           const sHeaders = Array.from({ length: cCount }, (_, i) => String(sJson[hIdx]?.[i] || '').trim());
           for (let offset = 1; offset <= 2; offset++) {
             const subRow = sJson[hIdx + offset];
             if (!subRow) break;
             const looksLikeData = subRow.some(v =>
               /\d{2,3}-\d{3,4}-\d{4}/.test(v) ||
               (/[가-힣]/.test(v) && String(v).length > 10) ||
               /합계|소계|총계|집계/.test(String(v)) ||
               /^\d{1,3}(,\d{3})+$/.test(String(v))
             );
             if (looksLikeData) break;
             subRow.forEach((v, i) => { if (v && !sHeaders[i]) sHeaders[i] = String(v).trim(); });
           }

           sheetsInfo.push({
              name,
              headers: sHeaders,
              previewRows: sJson.slice(hIdx + 1, hIdx + 11)
           });
        }
      });

      if (sheetsInfo.length > 0) {
        if (action === 'PARSE_BASE') {
          requiresMappingInfo = {
            sheets: sheetsInfo,
            targetSheet: targetSheetName
          };
        } else {
          // action === 'PARSE_BASE_WITH_MAP'
          let colName = -1, colBirth = -1, colPhone1 = -1, colPhone2 = -1, colNote = -1, colDriver = -1, colSeq = -1, colSMS = -1;

          if (manualMap) {
             // manualMap.sheet 가 있으면 해당 시트의 헤더를 가져와서 인덱스를 매칭!
             const targetSheetInfo = sheetsInfo.find(s => s.name === manualMap.sheet) || sheetsInfo[0];
             const mHeaders = targetSheetInfo.headers;

             const safeIdx = (val) => (val ? mHeaders.indexOf(val) : -1);
             colName   = safeIdx(manualMap.name);
             colBirth  = safeIdx(manualMap.birth);
             colPhone1 = safeIdx(manualMap.phone);
             colPhone2 = -1; // 수동매핑은 폰1개만
             colNote   = safeIdx(manualMap.note);
             colDriver = safeIdx(manualMap.driver);
             colSeq    = safeIdx(manualMap.seqNo);
             colSMS    = safeIdx(manualMap.sms);
          }
          const parseSMSLocal = (val) => {
            const s = String(val || '').trim();
            if (!s || s === '-') return '';
            if (/거부|거절|불가|불허|미동의|미수신|수신\s*불가/.test(s)) return 'N';
            if (/^(N|n|X|x|×|0|아니오?|불|없음)$/.test(s)) return 'N';
            if (/^(Y|y|O|o|○|ㅇ|1|예|동의|수신|가능|허용|yes|YES)$/.test(s)) return 'Y';
            if (/동의|수신|가능|허용/.test(s)) return 'Y';
            return 'N';
          };

          if (colName !== -1) {
            // 전체 행을 먼저 수집해 동명이인 여부를 파악한 뒤 baseMap을 구성
            const allRows = [];
            getVisibleSheetNames(wb).forEach(sheetName => {
              const sheetJson = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', blankrows: false });
              if (sheetJson.length < 2) return;

              let sHeaderIdx = 0;
              let sMaxScore = -1;
              const sKWS = ['이름', '성명', '수령자', '주소', '휴대', '연락', '전화', '특이', '비고', '기사', '담당', '순번'];
              for (let i = 0; i < Math.min(20, sheetJson.length); i++) {
                const rowStr = sheetJson[i].join('');
                let score = 0;
                sKWS.forEach(k => { if (rowStr.includes(k)) score++; });
                if (score > sMaxScore) { sMaxScore = score; sHeaderIdx = i; }
              }
              allRows.push(...sheetJson.slice(sHeaderIdx + 1));
            });

            // 1차 패스: 이름별 등장 횟수 집계 (동명이인 감지용)
            const nameCount = {};
            allRows.forEach(row => {
              const n = String(row[colName] || '').trim().replace(/\s+/g, '');
              if (n) nameCount[n] = (nameCount[n] || 0) + 1;
            });

            // 2차 패스: baseMap 구성
            allRows.forEach(row => {
              const rawName = String(row[colName] || '').trim();
              if (!rawName) return;
              const nameVal = rawName.replace(/\s+/g, '');

              const rawBirth = colBirth >= 0 ? String(row[colBirth] || '').trim() : '';
              const birthKey = normalizeBirth(rawBirth);

              const p1 = colPhone1 >= 0 ? String(row[colPhone1] || '').replace(/[^0-9]/g, '').trim() : '';
              const p2 = colPhone2 >= 0 ? String(row[colPhone2] || '').replace(/[^0-9]/g, '').trim() : '';

              const payload = {
                기사: colDriver >= 0 ? String(row[colDriver] || '').trim() : '',
                배송순번: colSeq >= 0 ? parseInt(row[colSeq] || 0) || 0 : 0,
                특이사항: colNote >= 0 ? String(row[colNote] || '').trim() : '',
                문자수신: colSMS >= 0 ? parseSMSLocal(row[colSMS]) : '',
              };

              if (!payload.기사 && payload.배송순번 === 0 && !payload.특이사항 && !payload.문자수신) return;

              let added = false;
              if (birthKey) {
                const k = `${nameVal}_${birthKey}`;
                if (baseMap[k]) dupKeys.add(k);
                baseMap[k] = payload; added = true;
              }
              if (p1.length >= 9) {
                const k = `${nameVal}_${p1}`;
                if (baseMap[k]) dupKeys.add(k);
                baseMap[k] = payload; added = true;
              }
              if (p2.length >= 9) {
                const k = `${nameVal}_${p2}`;
                if (baseMap[k]) dupKeys.add(k);
                baseMap[k] = payload; added = true;
              }

              if (added) totalExtracted++;
            });
          }
        }
      }

      if (requiresMappingInfo) {
         self.postMessage({ ok: true, action: 'PARSE_BASE', requiresMapping: true, ...requiresMappingInfo });
      } else {
         self.postMessage({ ok: true, action: 'PARSE_BASE', baseMap, dupKeys: [...dupKeys], totalExtracted });
      }
      return;
    }
    if (data.action === 'MERGE_SHEETS') {
      const wb = XLSX.read(data.buffer, { type: 'array' });
      const sheetNames = getVisibleSheetNames(wb);
      
      let allRows = [];
      let headerExtracted = false;

      sheetNames.forEach(name => {
        const sheetJson = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
        if (sheetJson.length < 1) return;

        // Simple assumption: 1st row is header
        if (!headerExtracted) {
          allRows.push(sheetJson[0]); // Header
          headerExtracted = true;
        }
        allRows.push(...sheetJson.slice(1)); // Body
      });

      const newWb = XLSX.utils.book_new();
      const newWs = XLSX.utils.aoa_to_sheet(allRows);
      XLSX.utils.book_append_sheet(newWb, newWs, "통합시트");
      
      const wbout = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
      self.postMessage({ ok: true, action: 'MERGE_SHEETS', wbout, fileName: data.fileName });
      return;
    }

    let allRawData = [];
    const sheetsData = getVisibleSheetNames(wb).map(name => {
      const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
      allRawData = allRawData.concat(rawJson.slice(0, 30));
      return parseSheet(name, rawJson, data.dynamicRules);
    });

    const firstSheet = sheetsData[0];
    const detectedCity = extractCityName(
      fileName,
      allRawData,
      firstSheet?.bodyRows,
      firstSheet?.addrColIdx
    );

    const monthMatch = fileName.match(/(\d+)월/);
    self.postMessage({ ok: true, action: 'PARSE_TARGET', sheetsData, detectedCity, monthStr: monthMatch ? `${monthMatch[1]}월` : '' });
  } catch (err) {
    self.postMessage({ ok: false, action: data.action, error: err.message });
  }
};
