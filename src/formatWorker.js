import XLSXStyle from 'xlsx-js-style';

const HKWS = ['이름','성명','주소','행정동','포수','수량','구분','연락','전화','휴대','기사','순번','비고','특이','생년'];

const PRESETS = [
  { id:1,  headerBg:'1E40AF', headerFg:'FFFFFF', evenBg:'EFF6FF',  oddBg:'FFFFFF', border:'BFDBFE', accent:'1D4ED8' },
  { id:2,  headerBg:'0F172A', headerFg:'FBBF24', evenBg:'F8FAFC',  oddBg:'FFFFFF', border:'E2E8F0', accent:'FBBF24' },
  { id:3,  headerBg:'065F46', headerFg:'FFFFFF', evenBg:'ECFDF5',  oddBg:'FFFFFF', border:'A7F3D0', accent:'059669' },
  { id:4,  headerBg:'9D174D', headerFg:'FFFFFF', evenBg:'FDF2F8',  oddBg:'FFFFFF', border:'FBCFE8', accent:'BE185D' },
  { id:5,  headerBg:'9A3412', headerFg:'FFFFFF', evenBg:'FFF7ED',  oddBg:'FFFFFF', border:'FED7AA', accent:'C2410C' },
  { id:6,  headerBg:'4C1D95', headerFg:'FFFFFF', evenBg:'FAF5FF',  oddBg:'FFFFFF', border:'DDD6FE', accent:'6D28D9' },
  { id:7,  headerBg:'1F2937', headerFg:'F9FAFB', evenBg:'F3F4F6',  oddBg:'FFFFFF', border:'D1D5DB', accent:'4B5563' },
  { id:8,  headerBg:'7F1D1D', headerFg:'FFFFFF', evenBg:'FEF2F2',  oddBg:'FFFFFF', border:'FECACA', accent:'B91C1C' },
  { id:9,  headerBg:'0C4A6E', headerFg:'E0F2FE', evenBg:'F0F9FF',  oddBg:'FFFFFF', border:'BAE6FD', accent:'0369A1' },
  { id:10, headerBg:'78350F', headerFg:'FEF3C7', evenBg:'FFFBEB',  oddBg:'FFFFFF', border:'FDE68A', accent:'B45309' },
];

const argb = hex => 'FF' + hex.toUpperCase();

const detectHdrIdx = (rawArr) => {
  let hIdx = 0, hSc = -1;
  for (let i = 0; i < Math.min(20, rawArr.length); i++) {
    const s = rawArr[i].map(c => String(c || '')).join('');
    let sc = 0; HKWS.forEach(kw => { if (s.includes(kw)) sc++; });
    if (sc > hSc && rawArr[i].filter(c => String(c).trim()).length > 2) { hSc = sc; hIdx = i; }
  }
  return hIdx;
};

const border = (style, color) => ({ style, color: { rgb: argb(color) } });

const applySheetStyle = (ws, preset) => {
  if (!ws || !ws['!ref']) return;
  const range = XLSXStyle.utils.decode_range(ws['!ref']);
  const rawArr = XLSXStyle.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const hdrIdx = detectHdrIdx(rawArr);

  // Column widths from content
  const colWidths = [];
  for (let C = range.s.c; C <= range.e.c; C++) {
    let maxLen = 6;
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cell = ws[XLSXStyle.utils.encode_cell({ r: R, c: C })];
      if (cell?.v != null) maxLen = Math.max(maxLen, String(cell.v).length);
    }
    colWidths.push({ wch: Math.min(maxLen * 1.6 + 4, 42) });
  }
  ws['!cols'] = colWidths;

  // Row heights
  const rowHeights = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    rowHeights.push({ hpt: R === hdrIdx ? 28 : 18 });
  }
  ws['!rows'] = rowHeights;

  // Freeze header
  if (hdrIdx >= 0) {
    ws['!freeze'] = { xSplit: 0, ySplit: hdrIdx + 1, topLeftCell: XLSXStyle.utils.encode_cell({ r: hdrIdx + 1, c: 0 }), activePane: 'bottomLeft' };
  }

  // Apply cell styles
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const ref = XLSXStyle.utils.encode_cell({ r: R, c: C });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      const isHdr = R === hdrIdx;
      const isEven = !isHdr && (R - hdrIdx) % 2 === 0;
      const isFirst = C === range.s.c;
      const isLast  = C === range.e.c;

      if (isHdr) {
        ws[ref].s = {
          fill: { patternType: 'solid', fgColor: { rgb: argb(preset.headerBg) } },
          font: { bold: true, color: { rgb: argb(preset.headerFg) }, sz: 11, name: '맑은 고딕' },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: {
            top:    border('medium', preset.headerBg),
            bottom: border('medium', preset.accent),
            left:   border(isFirst ? 'medium' : 'thin', preset.headerBg),
            right:  border(isLast  ? 'medium' : 'thin', preset.headerBg),
          },
        };
      } else {
        const bg = isEven ? preset.evenBg : preset.oddBg;
        ws[ref].s = {
          fill: { patternType: 'solid', fgColor: { rgb: argb(bg) } },
          font: { sz: 10, name: '맑은 고딕', color: { rgb: 'FF1F2937' } },
          alignment: { horizontal: 'left', vertical: 'center' },
          border: {
            top:    border('thin', preset.border),
            bottom: border('thin', preset.border),
            left:   border(isFirst ? 'thin' : 'hair', preset.border),
            right:  border(isLast  ? 'thin' : 'hair', preset.border),
          },
        };
      }
    }
  }
};

self.onmessage = ({ data }) => {
  const { buffer, presetId, fileName } = data;
  try {
    const wb = XLSXStyle.read(new Uint8Array(buffer), { type: 'array', cellStyles: true });
    const preset = PRESETS.find(p => p.id === presetId) || PRESETS[0];
    wb.SheetNames.forEach(name => applySheetStyle(wb.Sheets[name], preset));
    const wbout = XLSXStyle.write(wb, { bookType: 'xlsx', type: 'array' });
    self.postMessage({ ok: true, wbout, fileName: fileName || '서식적용결과.xlsx' });
  } catch (e) {
    self.postMessage({ ok: false, error: e.message });
  }
};
