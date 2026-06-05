import * as XLSX from 'xlsx';

self.onmessage = ({ data }) => {
  const { action, finalRows, exportCols, fileName } = data;

  // 기본 내보내기 (액션 없는 기존 호출)
  if (!action) {
    try {
      const ws = XLSX.utils.json_to_sheet(finalRows, { header: exportCols });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '최종 표준 명단');
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      self.postMessage({ success: true, wbout, fileName });
    } catch (error) {
      self.postMessage({ success: false, error: error.message });
    }
    return;
  }

  // 기사별 배송표 내보내기
  if (action === 'EXPORT_DRIVER_SHEETS') {
    try {
      const { rows } = data;
      const wb = XLSX.utils.book_new();

      // 기사별 그룹화
      const driverMap = new Map();
      rows.forEach(r => {
        const driver = (r.기사 || '').trim() || '미배정';
        if (!driverMap.has(driver)) driverMap.set(driver, []);
        driverMap.get(driver).push(r);
      });

      // 기사별 정렬 (미배정 마지막)
      const sortedDrivers = [...driverMap.keys()].sort((a, b) => {
        if (a === '미배정') return 1;
        if (b === '미배정') return -1;
        return a.localeCompare(b, 'ko');
      });

      // 배송표용 컬럼 (생년월일·전화번호 제외, 배송순번·특이사항 강조)
      const deliveryCols = [
        { key: 'NO',      label: 'NO' },
        { key: '행정동',  label: '행정동' },
        { key: '이름',    label: '성명' },
        { key: '포수',    label: '포수' },
        { key: '주소',    label: '주소' },
        { key: '특이사항', label: '특이사항' },
        { key: '배송순번', label: '배송순번' },
      ];

      sortedDrivers.forEach(driver => {
        const driverRows = driverMap.get(driver);
        // 배송순번 오름차순 정렬 (없으면 원래 순서 유지)
        const sorted = [...driverRows].sort((a, b) => {
          const sa = parseInt(a.배송순번 || '0') || 0;
          const sb = parseInt(b.배송순번 || '0') || 0;
          return sa !== sb ? sa - sb : 0;
        });

        const sheetRows = sorted.map((r, i) => {
          const row = {};
          deliveryCols.forEach(c => {
            if (c.key === 'NO') row[c.label] = i + 1;
            else row[c.label] = r[c.key] ?? '';
          });
          return row;
        });

        const ws = XLSX.utils.json_to_sheet(sheetRows, { header: deliveryCols.map(c => c.label) });

        // 컬럼 너비 설정
        ws['!cols'] = [
          { wch: 5 },   // NO
          { wch: 10 },  // 행정동
          { wch: 8 },   // 성명
          { wch: 5 },   // 포수
          { wch: 40 },  // 주소
          { wch: 30 },  // 특이사항
          { wch: 8 },   // 배송순번
        ];

        // 시트명 30자 제한 (Excel 제한)
        const sheetName = driver.slice(0, 28);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      // 전체 합본 시트도 추가
      if (sortedDrivers.length > 1) {
        const allRows = rows.map((r, i) => {
          const row = {};
          deliveryCols.forEach(c => {
            if (c.key === 'NO') row[c.label] = i + 1;
            else row[c.label] = r[c.key] ?? '';
          });
          row['기사'] = r.기사 || '미배정';
          return row;
        });
        const wsAll = XLSX.utils.json_to_sheet(allRows, { header: [...deliveryCols.map(c => c.label), '기사'] });
        wsAll['!cols'] = [...(Array(6).fill({ wch: 12 })), { wch: 8 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, wsAll, '전체합본');
      }

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      self.postMessage({ success: true, wbout, fileName });
    } catch (error) {
      self.postMessage({ success: false, error: error.message });
    }
    return;
  }

  self.postMessage({ success: false, error: `알 수 없는 액션: ${action}` });
};
