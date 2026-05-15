import * as XLSX from 'xlsx';

self.onmessage = ({ data: { finalRows, exportCols, fileName } }) => {
  try {
    const ws = XLSX.utils.json_to_sheet(finalRows, { header: exportCols });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '최종 표준 명단');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    self.postMessage({ success: true, wbout, fileName });
  } catch (error) {
    self.postMessage({ success: false, error: error.message });
  }
};
