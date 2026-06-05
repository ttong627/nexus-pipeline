import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
XLSX.set_cptable(cptable); // .xls BIFF8 CP949(한글) 인코딩 지원

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

// 포수(수량)로 절대 매칭하면 안 되는 '가구원수/인원' 계열 헤더. CLAUDE.md §5.
// '가구'·'세대'가 들어간 칼럼은 무조건 인원(가구원수) 계열 → 포수 매칭 절대 금지(부분일치 전면 차단).
// 따라서 '가구'·'세대'만 남기면 가구원·가구수·가구당·세대원·세대수·세대당 등을 모두 포함한다.
const HOUSEHOLD_EXCL = ['가구', '세대', '인원', '구성원', '동거인', '식구', '명수'];
const HOUSEHOLD_RE = new RegExp(HOUSEHOLD_EXCL.join('|'));

// 파일명·요약·주소 텍스트에서 매칭되는 모든 시·군·구 후보(전체 정식명)를 반환.
// 첫 후보 = detectedCity, 전체 후보 = App에서 userCities(허가지역) 대조용(§5-2).
function extractCityCandidates(fileName, rawJsonSamples, bodyRows, addrColIdx) {
  const headerText = fileName + ' ' + rawJsonSamples.map(r => r.join(' ')).join(' ');
  let addrText = '';
  if (addrColIdx !== undefined && addrColIdx >= 0 && bodyRows && bodyRows.length > 0) {
    addrText = bodyRows.slice(0, 15).map(r => String(r[addrColIdx] || '')).join(' ');
  }
  const fullText = headerText + ' ' + addrText;
  const found = [];
  // 전체 정식명 우선
  for (const value of Object.values(KOREA_REGION_MAP)) {
    if (fullText.includes(value) && !found.includes(value)) found.push(value);
  }
  // 키(시군구 단독)로도 보완
  for (const [key, value] of Object.entries(KOREA_REGION_MAP)) {
    if (fullText.includes(key) && !found.includes(value)) found.push(value);
  }
  return found;
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
    { k: '수량',   kws: ['포수', '수량', '신청수량', '신청 수량', '10kg', '10KG', '포', '구입량'], excl: HOUSEHOLD_EXCL },
    { k: '연락처', kws: ['휴대', '연락', '전화', '유선', '핸드폰', '핸드', '모바일', '휴폰'] },
    { k: '행정동', kws: ['행정동', '읍면동', '동명', '관할구역'] },
    { k: '비고',   kws: ['특이사항', '비고', '메모'] }
  ];
  
  const allKws = activeReqKeys.flatMap(r => r.kws).concat(['비고', '연번', 'NO']);

  // 헤더 탐지: 상위 40행을 스캔(머리말·표지·안내문이 길어도 진짜 헤더를 찾도록).
  // 키워드 점수 + '바로 아래 행이 데이터처럼 보이면' 가점 → 제목/안내 행 오인 방지.
  for (let i = 0; i < Math.min(40, rawJson.length); i++) {
    const row = rawJson[i] || [];
    const nonEmpty = row.filter(c => String(c).trim() !== '').length;
    if (nonEmpty <= 2) continue; // 한두 칸짜리 제목/안내 행 제외
    const rowStr = row.map(c => String(c || '').trim()).join('');
    let score = 0;
    allKws.forEach(kw => { if (rowStr.includes(kw)) score++; });
    const below = rawJson[i + 1] || [];
    const belowData = below.filter(c => String(c).trim() !== '').length >= 2;
    const adjScore = score + (belowData ? 0.5 : 0);
    if (adjScore > maxScore) { maxScore = adjScore; headerIdx = i; }
  }

  // ─── 병합 헤더 처리 ──────────────────────────────────────────────
  const colCount = Math.max(
    ...[0, 1, 2].map(o => rawJson[headerIdx + o]?.length || 0)
  );
  // \r\n 포함 셀 정제 (예: "생년월일\r\n(주민등록앞자리)" → "생년월일(주민등록앞자리)")
  const cleanCell = c => String(c || '').replace(/[\r\n]+/g, '').trim();
  const headerBuf = Array.from({ length: colCount }, (_, i) =>
    cleanCell(rawJson[headerIdx]?.[i])
  );

  for (let offset = 1; offset <= 2; offset++) {
    const subRow = rawJson[headerIdx + offset];
    if (!subRow) break;
    const subVals = subRow.map(c => cleanCell(c));
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

  // 헤더 내 연속 공백을 단일 공백으로 정규화 (예: "주  소" → "주소" 매칭 가능하도록)
  const normalizeH = h => h.replace(/\s+/g, '');

  activeReqKeys.forEach(req => {
    const idx = headers.findIndex(h => {
      const hn = normalizeH(h);
      return req.kws.some(k => hn.includes(normalizeH(k))) &&
        !(req.excl || []).some(e => hn.includes(normalizeH(e)));
    });
    if (idx !== -1) { mappedKeys.push(req.k); colIndices[req.k] = idx; }
    else missingKeys.push(req.k);
  });

  // 보조 연락처: 첫 번째 연락처 컬럼 이후 두 번째 전화 컬럼 자동 탐지
  // (예: 전화① + 전화② 구조에서 전화②가 누락되는 문제 방지)
  {
    const phoneKws = ['휴대', '연락', '전화', '유선', '핸드폰', '핸드', '모바일', '휴폰'];
    const phoneIdx1 = colIndices['연락처'];
    const phoneIdx2 = headers.findIndex((h, i) => {
      if (i === phoneIdx1) return false;
      const hn = normalizeH(h);
      return phoneKws.some(k => hn.includes(normalizeH(k)));
    });
    if (phoneIdx1 !== undefined && phoneIdx2 !== -1) {
      colIndices['보조연락처'] = phoneIdx2;
      mappedKeys.push('보조연락처');
    }
  }

  // ── 형식(내용) 기반 전화 칼럼 확정 (§5-1): 휴대폰=010 형식 다수, 유선=지역번호 ──
  // 헤더 키워드/순서가 아니라 실제 데이터 형식으로 휴대폰·유선을 가른다.
  {
    const digits = (v) => String(v ?? '').replace(/[^0-9]/g, '');
    const isMobile = (d) => /^01[016789]/.test(d) && d.length >= 10 && d.length <= 11;
    const isLandline = (d) => /^0[2-6]/.test(d) && !isMobile(d) && d.length >= 9 && d.length <= 11;
    const candSet = new Set();
    if (colIndices['연락처'] !== undefined) candSet.add(colIndices['연락처']);
    if (colIndices['보조연락처'] !== undefined) candSet.add(colIndices['보조연락처']);
    headers.forEach((h, i) => {
      const hn = normalizeH(h);
      if (['휴대', '연락', '전화', '유선', '핸드폰', '핸드', '모바일', '휴폰', '폰'].some(k => hn.includes(normalizeH(k)))) candSet.add(i);
    });
    const sample = rawJson.slice(headerIdx + 1, headerIdx + 80);
    const stats = [...candSet].map((idx) => {
      const ds = sample.map((r) => digits(r?.[idx])).filter((d) => d.length >= 9);
      const n = ds.length;
      return { idx, n, mobile: n ? ds.filter(isMobile).length / n : 0, land: n ? ds.filter(isLandline).length / n : 0 };
    }).filter((s) => s.n >= 2);
    if (stats.length) {
      const mTop = [...stats].sort((a, b) => b.mobile - a.mobile)[0];
      const mobileCol = mTop && mTop.mobile >= 0.5 ? mTop.idx : undefined;
      const lTop = [...stats].filter((s) => s.idx !== mobileCol).sort((a, b) => b.land - a.land)[0];
      const landCol = lTop && lTop.land >= 0.5 ? lTop.idx : undefined;
      if (mobileCol !== undefined) {
        colIndices['연락처'] = mobileCol;                       // 휴대폰 = 010 형식 칼럼
        if (!mappedKeys.includes('연락처')) mappedKeys.push('연락처');
      }
      if (landCol !== undefined && landCol !== mobileCol) {
        colIndices['보조연락처'] = landCol;                     // 유선 = 지역번호 칼럼
        if (!mappedKeys.includes('보조연락처')) mappedKeys.push('보조연락처');
      }
      if (colIndices['보조연락처'] !== undefined && colIndices['보조연락처'] === colIndices['연락처']) {
        delete colIndices['보조연락처'];                        // 휴대=보조 충돌 방지
        const i = mappedKeys.indexOf('보조연락처'); if (i >= 0) mappedKeys.splice(i, 1);
      }
    }
  }

  // 보조연락처 보강: 전화 키워드 칼럼이 2개 이상이면 연락처와 다른 칼럼을 반드시 보조연락처로.
  // (전화번호2가 비어 있거나 지역번호 형식이 아니어도 '두 번째 전화 칼럼 = 보조연락처' 규칙 보장)
  if (colIndices['보조연락처'] === undefined && colIndices['연락처'] !== undefined) {
    const phoneCols = headers.reduce((acc, h, i) => {
      const hn = normalizeH(h);
      if (['휴대', '연락', '전화', '유선', '핸드폰', '핸드', '모바일', '휴폰', '폰'].some(k => hn.includes(normalizeH(k)))) acc.push(i);
      return acc;
    }, []);
    const second = phoneCols.find(i => i !== colIndices['연락처']);
    if (second !== undefined) {
      colIndices['보조연락처'] = second;
      if (!mappedKeys.includes('보조연락처')) mappedKeys.push('보조연락처');
    }
  }

  // 생년월일 컬럼 자동 탐지 (activeReqKeys에 없어 자동 매핑 안 되던 문제 수정)
  if (colIndices['생년월일'] === undefined) {
    const birthKws = ['생년월일', '생년', '주민등록'];
    const birthIdx = headers.findIndex(h => {
      const hn = normalizeH(h);
      return birthKws.some(k => hn.includes(normalizeH(k)));
    });
    if (birthIdx !== -1) {
      colIndices['생년월일'] = birthIdx;
      mappedKeys.push('생년월일');
    }
  }

  // 문자수신 컬럼 자동 탐지
  if (colIndices['문자수신'] === undefined) {
    const smsKws = ['문자수신', '수신동의', '수신여부', 'SMS'];
    const smsIdx = headers.findIndex(h => {
      const hn = normalizeH(h);
      return smsKws.some(k => hn.includes(normalizeH(k)));
    });
    if (smsIdx !== -1) {
      colIndices['문자수신'] = smsIdx;
      mappedKeys.push('문자수신');
    }
  }

  // ── 형식(내용) 기반 누락 칼럼 보완 (§5-1) — 키워드로 못 잡은 칼럼을 데이터 형식으로 확정 ──
  {
    const fSample = rawJson.slice(headerIdx + 1, headerIdx + 80).filter(r => r && r.some(c => String(c || '').trim()));
    const colVals = (idx) => fSample.map(r => String(r?.[idx] ?? '').trim()).filter(Boolean);
    const ratioOf = (idx, pred) => { const vs = colVals(idx); return vs.length >= 2 ? vs.filter(pred).length / vs.length : 0; };
    const isDong = (v) => /^[가-힣0-9]{1,12}(동|읍|면)$/.test(v.replace(/\s/g, ''));
    const isYNOX = (v) => /^(y|n|o|x|○|×|ㅇ|예|아니오|동의|미동의|수신|거부)$/i.test(v.trim());
    const isDate = (v) => { const d = v.replace(/[.\-/\s]/g, ''); return /^\d{6}$/.test(d) || /^(19|20)?\d{6}$/.test(d) || /^\d{8}$/.test(d); };
    const isKoreanName = (v) => /^[가-힣]{2,5}$/.test(v.replace(/\s/g, ''));
    const isRoad = (v) => v.length >= 8 && /(로|길|번지|\d+-\d+|\d+호|\d+번길)/.test(v);

    const assignByFormat = (key, pred, threshold, excl = []) => {
      if (colIndices[key] !== undefined) return; // 이미 매칭됨
      const used = new Set(Object.values(colIndices));
      let best = -1, bestR = 0;
      headers.forEach((h, i) => {
        if (used.has(i)) return;
        if (excl.length && excl.some(e => normalizeH(h).includes(normalizeH(e)))) return;
        const r = ratioOf(i, pred);
        if (r > bestR) { bestR = r; best = i; }
      });
      if (best >= 0 && bestR >= threshold) {
        colIndices[key] = best;
        if (!mappedKeys.includes(key)) mappedKeys.push(key);
        const mi = missingKeys.indexOf(key); if (mi >= 0) missingKeys.splice(mi, 1);
      }
    };

    assignByFormat('행정동', isDong, 0.5);        // 읍면동: OO동/읍/면 짧은 값
    assignByFormat('생년월일', isDate, 0.6);       // 날짜/주민앞자리
    assignByFormat('문자수신', isYNOX, 0.6);       // Y/N/O/X/○/×/예/아니오
    assignByFormat('이름', isKoreanName, 0.7);     // 2~5자 한글
    assignByFormat('주소', isRoad, 0.5);           // 도로명/지번 긴 텍스트
  }

  // 매핑되지 않은 컬럼 찾기 (빈 컬럼 무시, 알려진 키워드 없는 컬럼)
  // colIndices에 이미 등록된 컬럼 인덱스를 제외 (보조연락처·생년월일·문자수신 포함)
  const mappedColIdxSet = new Set(Object.values(colIndices));
  headers.forEach((h, hIdx) => {
    if (h.startsWith('col_') || !h.trim()) return;
    if (mappedColIdxSet.has(hIdx)) return;
    const hn = normalizeH(h);
    const isMapped = activeReqKeys.some(req => req.kws.some(k => hn.includes(normalizeH(k))));
    if (!isMapped && !['비고', '연번', 'NO', '순번', '주민번호'].some(k => h.includes(k))) {
      unmappedCols.push(h);
    }
  });

  let dataStartRowIdx = -1;

  // 연번/순번/NO 컬럼 인덱스 탐지
  // '번호' 단독은 너무 범용적(전화번호 끝자리, 회원번호 등)이므로 제외
  const seqColIdx = headers.findIndex(h => /^(연번|순번|NO|N\.O)$/i.test(h.trim()));

  // 연번 필터 활성화 여부: 실제 데이터 행의 30% 이상에 숫자가 채워진 경우에만 적용
  // (연번이 헤더에 있어도 값이 안 채워진 파일은 필터 비활성 — 이 조건 없으면 전 행 제외됨)
  const seqColEffective = seqColIdx >= 0 && (() => {
    const sample = rawJson.slice(headerIdx + 1, headerIdx + 31);
    const filled = sample.filter(r => /^\d+$/.test(String(r[seqColIdx] || '').trim())).length;
    return filled >= Math.max(3, sample.length * 0.3);
  })();

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
      if (/^[\d,]+$/.test(nameVal)) return false;
      // 이름 컬럼 자리에 헤더 키워드가 그대로 들어온 경우 (헤더행 오인식 방지)
      if (/^(이름|성명|대상자|수령자명|성\s*명|이\s*름)$/.test(nameVal)) return false;
    } else if (seqColEffective && !String(r[seqColIdx] || '').trim()) {
      // 이름 컬럼 없는 파일: 연번 비어있으면 합계/소계행으로 판단
      return false;
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
      if (colIndices['이름'] !== undefined) {
        const nameVal = String(r[colIndices['이름']] || '').trim();
        if (/^(이름|성명|대상자|수령자명|성\s*명|이\s*름)$/.test(nameVal)) return false;
      }
      if (seqColEffective && !String(r[seqColIdx] || '').trim()) {
        const nameVal = colIndices['이름'] !== undefined ? String(r[colIndices['이름']] || '').trim() : '';
        if (!nameVal || /합계|소계|총계|집계/.test(nameVal) || /^[\d,]+$/.test(nameVal)) return false;
      }
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

  // 포수 컬럼 전체 수집 (10kg(포수)/20kg(포수) 같은 품목별 복수 컬럼 합산 지원)
  const allAmtIdxs = headers.reduce((acc, h, i) => {
    if (!HOUSEHOLD_RE.test(h) && (
      h.includes('포수') || h.includes('수량') || h.includes('구입량') || h.includes('신청수량') || h.includes('신청 수량') ||
      /10\s*kg/i.test(h) ||
      h === '포' || (h.includes('포') && h.length <= 3)
    )) acc.push(i);
    return acc;
  }, []);

  let effectiveAmtIdx = allAmtIdxs[0] ?? -1;

  // 복수 포수 컬럼 → 행별 합산 가상 컬럼 추가, colIndices['수량']도 덮어씀
  if (allAmtIdxs.length > 1) {
    headers.push('수량(포수)합산');
    effectiveAmtIdx = headers.length - 1;
    bodyRows.forEach(row => {
      const total = allAmtIdxs.reduce((s, i) => s + (parseInt(row[i] || 0) || 0), 0);
      row[effectiveAmtIdx] = total || 1;
    });
    colIndices['수량'] = effectiveAmtIdx;
  }

  let qty = 0;
  bodyRows.forEach(row => { qty += parseInt(row[effectiveAmtIdx] || 0) || 1; });

  // ─── 데이터 컬럼 값으로 수급 유형 자동 감지 ──────────────────────────
  let typeColIdx = -1;
  if (bodyRows.length > 0) {
    const typeCandidateIdx = headers.findIndex(h =>
      h.includes('구분') || h.includes('유형') || h.includes('계층') || h.includes('자격')
    );
    if (typeCandidateIdx >= 0) {
      typeColIdx = typeCandidateIdx;
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

  // ── 칼럼 매칭 신뢰도 점수 + 애매(노랑) 키 (쉬운 정제용, §5-1) ──────────────
  // 임계값 0.7: 실데이터(지번 혼재 등)에서 멀쩡한 칼럼이 노랑으로 과탐되지 않도록 실용값 사용.
  const CONF_THRESHOLD = 0.7;
  const colConfidence = {};
  const ambiguousKeys = [];
  {
    const cs = rawJson.slice(headerIdx + 1, headerIdx + 80).filter(r => r && r.some(c => String(c || '').trim()));
    const cVals = (idx) => (idx === undefined || idx < 0) ? [] : cs.map(r => String(r?.[idx] ?? '').trim()).filter(Boolean);
    const cRatio = (idx, pred) => { const vs = cVals(idx); return vs.length >= 2 ? vs.filter(pred).length / vs.length : 0; };
    const dg = (v) => String(v || '').replace(/[^0-9]/g, '');
    const pMobile = (v) => { const d = dg(v); return /^01[016789]/.test(d) && d.length >= 10 && d.length <= 11; };
    const pLand = (v) => { const d = dg(v); return /^0[2-6]/.test(d) && d.length >= 9 && d.length <= 11 && !pMobile(v); };
    const pName = (v) => /^[가-힣]{2,5}$/.test(v.replace(/\s/g, ''));
    const pDong = (v) => /^[가-힣0-9]{1,12}(동|읍|면)$/.test(v.replace(/\s/g, ''));
    // 도로명 + 지번(동/리/번지/번호-번호) 모두 주소로 인정
    const pRoad = (v) => v.length >= 6 && /(로|길|번지|동|리|읍|면|\d+-\d+|\d+호|\d+번길)/.test(v);
    const pInt = (v) => /^\d{1,2}$/.test(v.trim()) && +v >= 1 && +v <= 30;
    const pYnox = (v) => /^(y|n|o|x|○|×|ㅇ|예|아니오|동의|미동의|수신|거부)$/i.test(v.trim());
    const pDate = (v) => { const d = v.replace(/[.\-/\s]/g, ''); return /^\d{6}$/.test(d) || /^\d{8}$/.test(d); };

    // [표시라벨, colIndices키, 형식판정자, 필수여부]
    const specs = [
      ['이름', '이름', pName, true],
      ['주소', '주소', pRoad, true],
      ['행정동', '행정동', pDong, false],
      ['휴대폰', '연락처', pMobile, false],
      ['유선전화', '보조연락처', pLand, false],
      ['포수', '수량', pInt, false],
      ['문자수신', '문자수신', pYnox, false],
      ['생년월일', '생년월일', pDate, false],
    ];
    for (const [label, ck, pred, required] of specs) {
      const idx = colIndices[ck];
      if (idx === undefined || idx < 0) {
        colConfidence[label] = 0;
        if (required) ambiguousKeys.push(label);
        continue;
      }
      const r = cRatio(idx, pred);
      colConfidence[label] = Math.round(r * 100) / 100;
      if (r < CONF_THRESHOLD) ambiguousKeys.push(label);
    }
    colConfidence['구분'] = (typeColIdx >= 0 || type === '기초수급자' || type === '차상위') ? 1 : 0.5;
  }

  // ── 명단 시트 분류 (진짜 명단 vs 통계·요약·안내·빈 시트) ──────────────────
  // 핵심열(이름·주소·연락처·행정동) 중 2개 이상 + 데이터행 1건 이상 + 시트명이 잡음 아님 → 명단.
  const ROSTER_CORE = ['이름', '주소', '연락처', '행정동'];
  const coreMatched = ROSTER_CORE.filter(k => colIndices[k] !== undefined && colIndices[k] !== -1).length;
  const sheetNameJunk = /통계|요약|집계|개요|총괄|표지|목차|안내|설명|서식|양식|샘플|예시|pivot|피벗|차트|그래프/i.test(String(name));
  const rosterScore = coreMatched + (bodyRows.length >= 3 ? 1 : 0);
  const isRosterSheet = !sheetNameJunk && coreMatched >= 2 && bodyRows.length >= 1;
  // 헤더 이후 실제 명단으로 안 잡힌(합계/소계/빈행/머리말) 행 수
  const skippedRowCount = Math.max(0, (rawJson.length - (headerIdx + 1)) - bodyRows.length);

  return {
    name, selected, type, qty, rowsCount: bodyRows.length,
    headers, bodyRows, headerRowIdx: headerIdx + 1,
    dataStartRowIdx, mappedKeys, missingKeys, emptyWarnings,
    addrColIdx: colIndices['주소'],
    unmappedCols,
    colIndices,
    typeColIdx,
    colConfidence,
    ambiguousKeys,
    isRosterSheet,
    rosterScore,
    skippedRowCount,
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
      const totalSu  = rawRows.filter(r => r.구분 === '기초수급자').reduce((s, r) => s + (Number(r.포수) || 1), 0);
      const totalCha = rawRows.filter(r => r.구분 === '차상위').reduce((s, r) => s + (Number(r.포수) || 1), 0);
      const summaryAoa = [
        ['구분', '수급자(포)', '차상위(포)', '전체(포)'],
        ['전체합계', totalSu, totalCha, totalSu + totalCha],
      ];
      dongSet.forEach(dong => {
        const dr = rawRows.filter(r => String(r.행정동 || '-').trim() === dong);
        const dSu  = dr.filter(r => r.구분 === '기초수급자').reduce((s, r) => s + (Number(r.포수) || 1), 0);
        const dCha = dr.filter(r => r.구분 === '차상위').reduce((s, r) => s + (Number(r.포수) || 1), 0);
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

    // ── 컬럼 재배치 — 파일 분석 ─────────────────────────────────────────
    if (action === 'ANALYZE_REMAP') {
      const wbR = XLSX.read(new Uint8Array(buffer), { type: 'array', sheetRows: 30000, cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, cellDates: false, codepage: 949 });
      const visR = getVisibleSheetNames(wbR);
      const HKWSR = ['이름', '성명', '주소', '행정동', '포수', '수량', '구분', '연락', '전화', '휴대', '기사', '순번', '비고', '특이', '생년'];
      const analyzeSheetR = (n) => {
        const rawR = XLSX.utils.sheet_to_json(wbR.Sheets[n], { header: 1, defval: '', blankrows: false });
        let hIdxR = 0, hScR = -1;
        for (let i = 0; i < Math.min(20, rawR.length); i++) {
          const s = rawR[i].map(c => String(c || '').trim()).join('');
          let sc = 0; HKWSR.forEach(kw => { if (s.includes(kw)) sc++; });
          if (sc > hScR && rawR[i].filter(c => String(c).trim()).length > 2) { hScR = sc; hIdxR = i; }
        }
        const colCntR = Math.max(...[0, 1, 2].map(o => rawR[hIdxR + o]?.length || 0), 1);
        const hdrsR = Array.from({ length: colCntR }, (_, i) => String(rawR[hIdxR]?.[i] || '').trim());
        for (let off = 1; off <= 2; off++) {
          const sub = rawR[hIdxR + off]; if (!sub) break;
          const isData = sub.some(v => /\d{2,3}-\d{3,4}-\d{4}/.test(String(v)) || (/[가-힣]/.test(String(v)) && String(v).length > 10));
          if (isData) break;
          sub.forEach((v, i) => { if (v && !hdrsR[i]) hdrsR[i] = String(v).trim(); });
        }
        const bodyR = rawR.slice(hIdxR + 1).filter(r => r.some(c => String(c).trim()));
        return { name: n, rowCount: bodyR.length, headers: hdrsR, sampleRows: bodyR.slice(0, 10) };
      };
      const sheetsInfo = visR.map(analyzeSheetR);
      const defS = sheetsInfo.reduce((best, s) => s.rowCount > best.rowCount ? s : best, sheetsInfo[0]);
      self.postMessage({ ok: true, headers: defS.headers, sampleRows: defS.sampleRows, totalRows: defS.rowCount, sheetName: defS.name, sheets: sheetsInfo });
      return;
    }

    // ── 컬럼 재배치 — 파일 내보내기 ──────────────────────────────────────
    if (action === 'EXPORT_REMAP') {
      const { mapping, outputCols, addrSrcIdx, selectedSheets, colOrder, fileName: fnRE } = data;
      const orderedCols = colOrder?.length ? colOrder.map(key => outputCols.find(c => c.key === key)).filter(Boolean) : outputCols;
      const wbRE = XLSX.read(new Uint8Array(buffer), { type: 'array', sheetRows: 30000, cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, cellDates: false, codepage: 949 });
      const visRE = getVisibleSheetNames(wbRE);
      let tgtRE = visRE[0], mxRE = 0;
      visRE.forEach(n => { const ref = wbRE.Sheets[n]['!ref']; if (ref) { const r = XLSX.utils.decode_range(ref).e.r; if (r > mxRE) { mxRE = r; tgtRE = n; } } });
      const HKWSRE = ['이름', '성명', '주소', '행정동', '포수', '수량', '구분', '연락', '전화', '휴대', '기사', '순번', '비고', '특이', '생년'];

      const detectHeaderIdx = (raw) => {
        let hIdx = 0, hSc = -1;
        for (let i = 0; i < Math.min(20, raw.length); i++) {
          const s = raw[i].map(c => String(c || '').trim()).join('');
          let sc = 0; HKWSRE.forEach(kw => { if (s.includes(kw)) sc++; });
          if (sc > hSc && raw[i].filter(c => String(c).trim()).length > 2) { hSc = sc; hIdx = i; }
        }
        return hIdx;
      };

      const sheetsToProcess = (selectedSheets?.length > 0 ? selectedSheets : [tgtRE]).filter(n => visRE.includes(n));
      let allBodyRows = [];
      sheetsToProcess.forEach(sheetName => {
        const raw = XLSX.utils.sheet_to_json(wbRE.Sheets[sheetName], { header: 1, defval: '', blankrows: false });
        const hIdx = detectHeaderIdx(raw);
        const body = raw.slice(hIdx + 1).filter(r => r.some(c => String(c).trim()));
        allBodyRows.push(...body);
      });

      const fmtPhoneRE = (v) => {
        const d = String(v ?? '').replace(/[^0-9]/g, '');
        if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
        if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
        if (d.length === 9 && d.startsWith('02')) return `02-${d.slice(2,5)}-${d.slice(5)}`;
        return v;
      };
      const normSMSRE = (v) => {
        const s = String(v || '').trim();
        if (!s || s === '-') return '';
        if (/거부|거절|불가|불허|미동의|미수신|수신\s*불가/.test(s)) return 'N';
        if (/^(N|n|X|x|×|0|아니오?|불|없음)$/.test(s)) return 'N';
        if (/^(Y|y|O|o|○|ㅇ|1|예|동의|수신|가능|허용|yes|YES)$/.test(s)) return 'Y';
        if (/동의|수신|가능|허용/.test(s)) return 'Y';
        return 'N';
      };
      const extMetroRE = (addr) => {
        const m = String(addr||'').match(/^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/);
        return m ? m[1] : '';
      };
      const extSigunguRE = (addr) => {
        const m = String(addr||'').match(/(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)\s+([^\s]+(?:시|군|구))/);
        return m ? m[1] : '';
      };

      const outRows = allBodyRows.map((row, i) => {
        return orderedCols.map(col => {
          const m = mapping[col.key] || {};
          const srcIdx = m.srcIdx ?? -1;
          if (srcIdx === -3) return i + 1;
          if (srcIdx === -2) {
            const addr = addrSrcIdx >= 0 ? String(row[addrSrcIdx] ?? '') : '';
            if (col.key === 'metro') return extMetroRE(addr);
            if (col.key === 'sigungu') return extSigunguRE(addr);
            return '';
          }
          if (srcIdx < 0) return '';
          const raw = row[srcIdx] ?? '';
          if (col.key === 'mobile' || col.key === 'landline') return fmtPhoneRE(raw);
          if (col.key === 'birth') return normalizeBirth(raw);
          if (col.key === 'sms') return normSMSRE(raw);
          if (col.key === 'gubun') {
            const v = String(raw).trim();
            if (/차상위/.test(v)) return '차상위';
            if (/수급|기초|생계|의료/.test(v)) return '기초수급자';
            return raw;
          }
          return raw;
        });
      });

      const header = orderedCols.map(c => c.label);
      const wsRE = XLSX.utils.aoa_to_sheet([header, ...outRows]);
      wsRE['!cols'] = orderedCols.map(c => ({ wch: Math.min(Math.max(String(c.label).length * 2 + 4, 8), 28) }));
      const wbOutRE = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wbOutRE, wsRE, '재배치결과');
      const wbout = XLSX.write(wbOutRE, { bookType: 'xlsx', type: 'array' });
      self.postMessage({ ok: true, wbout, fileName: fnRE });
      return;
    }

    // ── 파일 합치기 — 내보내기 ────────────────────────────────────────────
    if (action === 'EXPORT_MERGE') {
      const { bufferA, bufferB, mappingA, mappingB, selectedSheetsA, selectedSheetsB, outputCols, addrSrcIdxA, addrSrcIdxB, fileName: fnMG } = data;

      const HKWSMG = ['이름', '성명', '주소', '행정동', '포수', '수량', '구분', '연락', '전화', '휴대', '기사', '순번', '비고', '특이', '생년'];
      const detectHdrMG = (raw) => {
        let hIdx = 0, hSc = -1;
        for (let i = 0; i < Math.min(20, raw.length); i++) {
          const s = raw[i].map(c => String(c || '').trim()).join('');
          let sc = 0; HKWSMG.forEach(kw => { if (s.includes(kw)) sc++; });
          if (sc > hSc && raw[i].filter(c => String(c).trim()).length > 2) { hSc = sc; hIdx = i; }
        }
        return hIdx;
      };

      const extractBodyMG = (buf, selSheets) => {
        const wbMG = XLSX.read(new Uint8Array(buf), { type: 'array', sheetRows: 30000, cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, cellDates: false, codepage: 949 });
        const vis = getVisibleSheetNames(wbMG);
        const sheets = selSheets?.length > 0 ? selSheets.filter(n => vis.includes(n)) : [vis[0]];
        let rows = [];
        sheets.forEach(sn => {
          const raw = XLSX.utils.sheet_to_json(wbMG.Sheets[sn], { header: 1, defval: '', blankrows: false });
          const hIdx = detectHdrMG(raw);
          rows.push(...raw.slice(hIdx + 1).filter(r => r.some(c => String(c).trim())));
        });
        return rows;
      };

      const fmtPhoneMG = (v) => {
        const d = String(v ?? '').replace(/[^0-9]/g, '');
        if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
        if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
        if (d.length === 9 && d.startsWith('02')) return `02-${d.slice(2,5)}-${d.slice(5)}`;
        return v;
      };
      const normSMSMG = (v) => {
        const s = String(v || '').trim();
        if (!s || s === '-') return '';
        if (/거부|거절|불가|불허|미동의|미수신|수신\s*불가/.test(s)) return 'N';
        if (/^(N|n|X|x|×|0|아니오?|불|없음)$/.test(s)) return 'N';
        if (/^(Y|y|O|o|○|ㅇ|1|예|동의|수신|가능|허용|yes|YES)$/.test(s)) return 'Y';
        if (/동의|수신|가능|허용/.test(s)) return 'Y';
        return 'N';
      };
      const extMetroMG = (addr) => {
        const m = String(addr||'').match(/^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)/);
        return m ? m[1] : '';
      };
      const extSigunguMG = (addr) => {
        const m = String(addr||'').match(/(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)\s+([^\s]+(?:시|군|구))/);
        return m ? m[1] : '';
      };

      const buildRowsMG = (bodyRows, mapping, addrSrcIdx, fixedGubun) => {
        return bodyRows.map((row, i) => {
          return outputCols.map(col => {
            if (col.key === 'gubun') return fixedGubun;
            const m = mapping[col.key] || {};
            const srcIdx = m.srcIdx ?? -1;
            if (srcIdx === -3) return i + 1;
            if (srcIdx === -2) {
              const addr = addrSrcIdx >= 0 ? String(row[addrSrcIdx] ?? '') : '';
              if (col.key === 'metro') return extMetroMG(addr);
              if (col.key === 'sigungu') return extSigunguMG(addr);
              return '';
            }
            if (srcIdx < 0) return '';
            const raw = row[srcIdx] ?? '';
            if (col.key === 'mobile' || col.key === 'landline') return fmtPhoneMG(raw);
            if (col.key === 'birth') return normalizeBirth(raw);
            if (col.key === 'sms') return normSMSMG(raw);
            return raw;
          });
        });
      };

      const header = outputCols.map(c => c.label);
      const colWidths = outputCols.map(c => ({ wch: Math.min(Math.max(String(c.label).length * 2 + 4, 8), 28) }));

      const bodyA = extractBodyMG(bufferA, selectedSheetsA);
      const bodyB = extractBodyMG(bufferB, selectedSheetsB);
      const rowsA = buildRowsMG(bodyA, mappingA, addrSrcIdxA, '기초수급자');
      const rowsB = buildRowsMG(bodyB, mappingB, addrSrcIdxB, '차상위');
      const rowsC = [...rowsA, ...rowsB];

      const mkSheet = (rows) => { const ws = XLSX.utils.aoa_to_sheet([header, ...rows]); ws['!cols'] = colWidths; return ws; };
      const wbMGOut = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wbMGOut, mkSheet(rowsA), '기초수급자');
      XLSX.utils.book_append_sheet(wbMGOut, mkSheet(rowsB), '차상위');
      XLSX.utils.book_append_sheet(wbMGOut, mkSheet(rowsC), '합본');
      const wboutMG = XLSX.write(wbMGOut, { bookType: 'xlsx', type: 'array' });
      self.postMessage({ ok: true, wbout: wboutMG, fileName: fnMG });
      return;
    }

    // ── 행정동 분리 — 파일 분석 ──────────────────────────────────────────
    if (action === 'ANALYZE_DONG_SPLIT') {
      const wbD = XLSX.read(new Uint8Array(buffer), { type: 'array', sheetRows: 30000, cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, cellDates: false, codepage: 949 });
      const visibleD = getVisibleSheetNames(wbD);
      let targetD = visibleD[0];
      let maxRowsD = 0;
      visibleD.forEach(name => {
        const ref = wbD.Sheets[name]['!ref'];
        if (ref) { const r = XLSX.utils.decode_range(ref).e.r; if (r > maxRowsD) { maxRowsD = r; targetD = name; } }
      });
      const rawD = XLSX.utils.sheet_to_json(wbD.Sheets[targetD], { header: 1, defval: '', blankrows: false });
      const HKWS = ['이름', '성명', '주소', '행정동', '포수', '수량', '구분', '연락', '전화', '휴대', '기사', '순번', '비고', '특이', '생년'];
      let hIdx = 0, hScore = -1;
      for (let i = 0; i < Math.min(20, rawD.length); i++) {
        const s = rawD[i].map(c => String(c || '').trim()).join('');
        let sc = 0; HKWS.forEach(kw => { if (s.includes(kw)) sc++; });
        if (sc > hScore && rawD[i].filter(c => String(c).trim()).length > 2) { hScore = sc; hIdx = i; }
      }
      const colCnt = Math.max(...[0, 1, 2].map(o => rawD[hIdx + o]?.length || 0));
      const headers = Array.from({ length: colCnt }, (_, i) => String(rawD[hIdx]?.[i] || '').trim());
      for (let off = 1; off <= 2; off++) {
        const sub = rawD[hIdx + off]; if (!sub) break;
        const isData = sub.some(v => /\d{2,3}-\d{3,4}-\d{4}/.test(v) || (/[가-힣]/.test(v) && String(v).length > 10));
        if (isData) break;
        sub.forEach((v, i) => { if (v && !headers[i]) headers[i] = String(v).trim(); });
      }
      const bodyD = rawD.slice(hIdx + 1).filter(r => r.some(c => String(c).trim()));
      const det = (kws, excl = []) => {
        const i = headers.findIndex(h => { const hn = String(h).trim(); return !excl.some(e => hn.includes(e)) && kws.some(k => hn.includes(k)); });
        return i >= 0 ? i : null;
      };
      const colMap = {
        dong:      det(['행정동', '읍면동', '동명', '관할구역']),
        name:      det(['이름', '성명', '대상자', '수령자']),
        gubun:     det(['구분', '유형', '계층', '자격']),
        qty:       det(['포수', '수량', '신청수량', '신청 수량', '10kg', '10KG', '구입량'], HOUSEHOLD_EXCL),
        addr:      det(['주소']),
        birth:     det(['생년월일', '생일', '생년']),
        mobile:    det(['휴대', '핸드', '모바일'], ['유선']),
        landline:  det(['유선']),
        note:      det(['특이사항', '비고', '메모']),
        driver:    det(['기사', '담당']),
        seqNo:     det(['순번', '배송순번']),
      };
      const detGubun = (row) => {
        if (colMap.gubun === null) return '기초수급자';
        const v = String(row[colMap.gubun] ?? '').trim();
        return v.includes('차상위') ? '차상위' : '기초수급자';
      };
      const dongMap = {};
      bodyD.forEach(row => {
        const dong = String(row[colMap.dong] ?? '-').trim() || '-';
        const gubun = detGubun(row);
        const qty = parseInt(String(row[colMap.qty] ?? '1').replace(/[^0-9]/g, '')) || 1;
        if (!dongMap[dong]) dongMap[dong] = { 기초수급자명: 0, 기초수급자포: 0, 차상위명: 0, 차상위포: 0 };
        dongMap[dong][gubun + '명']++;
        dongMap[dong][gubun + '포'] += qty;
      });
      const dongStats = Object.entries(dongMap)
        .sort(([a], [b]) => a.localeCompare(b, 'ko', { numeric: true }))
        .map(([dong, s]) => ({ dong, su명: s.기초수급자명, su포: s.기초수급자포, cha명: s.차상위명, cha포: s.차상위포, total명: s.기초수급자명 + s.차상위명, total포: s.기초수급자포 + s.차상위포 }));
      self.postMessage({ ok: true, headers, colMap, dongStats, totalRows: bodyD.length, sheetName: targetD, hasGubun: colMap.gubun !== null, hasDong: colMap.dong !== null });
      return;
    }

    // ── 행정동 분리 — 파일 내보내기 ─────────────────────────────────────
    if (action === 'EXPORT_DONG_SPLIT') {
      const { colMap: cm, selectedColIdxs, options, fileName: fnS } = data;
      const wbE = XLSX.read(new Uint8Array(buffer), { type: 'array', sheetRows: 30000, cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, cellDates: false, codepage: 949 });
      const visE = getVisibleSheetNames(wbE);
      let tgtE = visE[0]; let mxE = 0;
      visE.forEach(n => { const ref = wbE.Sheets[n]['!ref']; if (ref) { const r = XLSX.utils.decode_range(ref).e.r; if (r > mxE) { mxE = r; tgtE = n; } } });
      const rawE = XLSX.utils.sheet_to_json(wbE.Sheets[tgtE], { header: 1, defval: '', blankrows: false });
      const HKWS2 = ['이름', '성명', '주소', '행정동', '포수', '수량', '구분', '연락', '전화', '휴대'];
      let hIdxE = 0, hScE = -1;
      for (let i = 0; i < Math.min(20, rawE.length); i++) {
        const s = rawE[i].map(c => String(c || '').trim()).join('');
        let sc = 0; HKWS2.forEach(kw => { if (s.includes(kw)) sc++; });
        if (sc > hScE && rawE[i].filter(c => String(c).trim()).length > 2) { hScE = sc; hIdxE = i; }
      }
      const hdrE = Array.from({ length: Math.max(...[0,1,2].map(o => rawE[hIdxE+o]?.length||0)) }, (_, i) => String(rawE[hIdxE]?.[i]||'').trim());
      const bodyE = rawE.slice(hIdxE + 1).filter(r => r.some(c => String(c).trim()));
      const selHdrs = selectedColIdxs.map(i => hdrE[i] || `열${i+1}`);
      const toRow = (row) => selectedColIdxs.map(i => row[i] ?? '');
      const detG = (row) => { if (cm.gubun === null) return '기초수급자'; const v = String(row[cm.gubun]??'').trim(); return v.includes('차상위') ? '차상위' : '기초수급자'; };
      let rows = [...bodyE];
      if (options.sortRows && cm.dong !== null) {
        rows.sort((a, b) => {
          let c = String(a[cm.dong]??'').localeCompare(String(b[cm.dong]??''), 'ko', { numeric: true });
          if (c) return c;
          c = String(a[cm.addr??-1]??'').localeCompare(String(b[cm.addr??-1]??''), 'ko', { numeric: true });
          if (c) return c;
          return String(a[cm.name??-1]??'').localeCompare(String(b[cm.name??-1]??''), 'ko', { numeric: true });
        });
      }
      const dongSet = [...new Set(rows.map(r => String(r[cm.dong]??'-').trim()||'-'))].sort((a,b)=>a.localeCompare(b,'ko',{numeric:true}));
      const wbOut = XLSX.utils.book_new();
      const colW = selHdrs.map(h => ({ wch: Math.min(Math.max(String(h).length*2+4, 8), 36) }));
      if (options.includeSummary) {
        const aoa = [['행정동','기초수급자(명)','기초수급자(포)','차상위(명)','차상위(포)','합계(명)','합계(포)']];
        let tsM=0,tsP=0,tcM=0,tcP=0;
        dongSet.forEach(dong => {
          const dr = rows.filter(r => (String(r[cm.dong]??'-').trim()||'-')===dong);
          const sr = dr.filter(r=>detG(r)==='기초수급자'), cr = dr.filter(r=>detG(r)==='차상위');
          const sP = sr.reduce((s,r)=>s+(parseInt(String(r[cm.qty??-1]??'1').replace(/[^0-9]/g,''))||1),0);
          const cP = cr.reduce((s,r)=>s+(parseInt(String(r[cm.qty??-1]??'1').replace(/[^0-9]/g,''))||1),0);
          aoa.push([dong,sr.length,sP,cr.length,cP,dr.length,sP+cP]);
          tsM+=sr.length; tsP+=sP; tcM+=cr.length; tcP+=cP;
        });
        aoa.push(['합계',tsM,tsP,tcM,tcP,tsM+tcM,tsP+tcP]);
        const ws=XLSX.utils.aoa_to_sheet(aoa); ws['!cols']=[{wch:18},{wch:14},{wch:14},{wch:12},{wch:12},{wch:10},{wch:10}];
        XLSX.utils.book_append_sheet(wbOut, ws, '요약');
      }
      if (options.includeAll) {
        const ws=XLSX.utils.aoa_to_sheet([selHdrs,...rows.map(toRow)]); ws['!cols']=colW;
        XLSX.utils.book_append_sheet(wbOut, ws, '합본');
      }
      dongSet.forEach(dong => {
        const dr=rows.filter(r=>(String(r[cm.dong]??'-').trim()||'-')===dong);
        const safe=dong.substring(0,25).replace(/[\*\[\]:?\/\\]/g,'_')||'기타';
        if (options.splitGubun && cm.gubun !== null) {
          const sr=dr.filter(r=>detG(r)==='기초수급자'), cr=dr.filter(r=>detG(r)==='차상위');
          if (sr.length) { const ws=XLSX.utils.aoa_to_sheet([selHdrs,...sr.map(toRow)]); ws['!cols']=colW; XLSX.utils.book_append_sheet(wbOut, ws, `${safe}_수급`.substring(0,31)); }
          if (cr.length) { const ws=XLSX.utils.aoa_to_sheet([selHdrs,...cr.map(toRow)]); ws['!cols']=colW; XLSX.utils.book_append_sheet(wbOut, ws, `${safe}_차상위`.substring(0,31)); }
        } else {
          const ws=XLSX.utils.aoa_to_sheet([selHdrs,...dr.map(toRow)]); ws['!cols']=colW;
          XLSX.utils.book_append_sheet(wbOut, ws, safe.substring(0,31));
        }
      });
      const wbout=XLSX.write(wbOut,{bookType:'xlsx',type:'array'});
      self.postMessage({ok:true,wbout,fileName:fnS});
      return;
    }

    // ── DATA 매칭 ─────────────────────────────────────────────────────────
    if (action === 'DATA_MATCH') {
      const { targetBuffer, sourceBuffer, targetSheet, sourceSheet, targetKeyMap, sourceKeyMap, transplantFields, fileName: fnDM } = data;
      const HKWSDM = ['이름', '성명', '주소', '행정동', '포수', '수량', '구분', '연락', '전화', '휴대', '기사', '순번', '비고', '특이', '생년'];
      const detectHdrDM = (raw) => {
        let hIdx = 0, hSc = -1;
        for (let i = 0; i < Math.min(20, raw.length); i++) {
          const s = raw[i].map(c => String(c || '').trim()).join('');
          let sc = 0; HKWSDM.forEach(kw => { if (s.includes(kw)) sc++; });
          if (sc > hSc && raw[i].filter(c => String(c).trim()).length > 2) { hSc = sc; hIdx = i; }
        }
        return hIdx;
      };
      const normPhoneDM = v => String(v || '').replace(/[^0-9]/g, '');
      const normBirthDM = v => {
        const d = String(v || '').replace(/[^0-9]/g, '');
        if (d.length === 8) return `${d.slice(2,4)}.${d.slice(4,6)}.${d.slice(6,8)}`;
        if (d.length === 6) return `${d.slice(0,2)}.${d.slice(2,4)}.${d.slice(4,6)}`;
        return String(v || '').replace(/[-/]/g, '.').trim();
      };
      const normNameDM = v => String(v || '').trim();

      const wbT = XLSX.read(new Uint8Array(targetBuffer), { type: 'array', sheetRows: 100000, cellFormula: false, cellHTML: false, cellText: false, cellDates: false });
      const sheetNameT = targetSheet && wbT.SheetNames.includes(targetSheet) ? targetSheet : wbT.SheetNames[0];
      const rawT = XLSX.utils.sheet_to_json(wbT.Sheets[sheetNameT], { header: 1, defval: '', blankrows: false });
      const hIdxT = detectHdrDM(rawT);
      const colCntT = Math.max(...[0,1,2].map(o => rawT[hIdxT+o]?.length||0), 1);
      const tHeaders = Array.from({ length: colCntT }, (_, i) => String(rawT[hIdxT]?.[i]||'').trim());
      for (let off=1; off<=2; off++) {
        const sub=rawT[hIdxT+off]; if(!sub) break;
        const isData=sub.some(v=>/\d{2,3}-\d{3,4}-\d{4}/.test(String(v))||(/[가-힣]/.test(String(v))&&String(v).length>10));
        if(isData) break;
        sub.forEach((v,i)=>{ if(v&&!tHeaders[i]) tHeaders[i]=String(v).trim(); });
      }
      const tDataRows = rawT.slice(hIdxT + 1).filter(r => r.some(c => String(c).trim()));

      const wbS = XLSX.read(new Uint8Array(sourceBuffer), { type: 'array', sheetRows: 100000, cellFormula: false, cellHTML: false, cellText: false, cellDates: false });
      const sheetNameS = sourceSheet && wbS.SheetNames.includes(sourceSheet) ? sourceSheet : wbS.SheetNames[0];
      const rawS = XLSX.utils.sheet_to_json(wbS.Sheets[sheetNameS], { header: 1, defval: '', blankrows: false });
      const hIdxS = detectHdrDM(rawS);
      const sDataRows = rawS.slice(hIdxS + 1).filter(r => r.some(c => String(c).trim()));

      const byBirthDM = {}, byPhoneDM = {}, byLandlineDM = {};
      sDataRows.forEach(row => {
        const name = normNameDM(row[sourceKeyMap.name] ?? '');
        if (!name) return;
        const birth = sourceKeyMap.birth >= 0 ? normBirthDM(row[sourceKeyMap.birth] ?? '') : '';
        const phone = sourceKeyMap.phone >= 0 ? normPhoneDM(row[sourceKeyMap.phone] ?? '') : '';
        const land  = sourceKeyMap.landline >= 0 ? normPhoneDM(row[sourceKeyMap.landline] ?? '') : '';
        if (birth) { const k=`${name}__${birth}`; if (!byBirthDM[k]) byBirthDM[k] = row; }
        if (phone.length >= 9) { const k=`${name}__${phone}`; if (!byPhoneDM[k]) byPhoneDM[k] = row; }
        if (land.length >= 9)  { const k=`${name}__${land}`;  if (!byLandlineDM[k]) byLandlineDM[k] = row; }
      });

      const appendFields = transplantFields.filter(f => f.tgtIdx < 0);
      let matchedCount = 0;
      const resultRows = tDataRows.map(row => {
        const newRow = [...row];
        while (newRow.length < tHeaders.length) newRow.push('');
        const name = normNameDM(row[targetKeyMap.name] ?? '');
        if (!name) { appendFields.forEach(() => newRow.push('')); newRow.push('미매칭'); return newRow; }
        const birth = targetKeyMap.birth >= 0 ? normBirthDM(row[targetKeyMap.birth] ?? '') : '';
        const phone = targetKeyMap.phone >= 0 ? normPhoneDM(row[targetKeyMap.phone] ?? '') : '';
        const land  = targetKeyMap.landline >= 0 ? normPhoneDM(row[targetKeyMap.landline] ?? '') : '';
        let srcRow = null, matchType = '';
        if (birth && byBirthDM[`${name}__${birth}`])          { srcRow = byBirthDM[`${name}__${birth}`];    matchType = '이름+생년월일'; }
        else if (phone.length>=9 && byPhoneDM[`${name}__${phone}`]) { srcRow = byPhoneDM[`${name}__${phone}`]; matchType = '이름+휴대폰'; }
        else if (land.length>=9  && byLandlineDM[`${name}__${land}`]) { srcRow = byLandlineDM[`${name}__${land}`]; matchType = '이름+유선전화'; }
        if (srcRow) {
          matchedCount++;
          transplantFields.filter(f => f.tgtIdx >= 0).forEach(f => { newRow[f.tgtIdx] = String(srcRow[f.srcIdx] ?? ''); });
          appendFields.forEach(f => newRow.push(String(srcRow[f.srcIdx] ?? '')));
          newRow.push(matchType);
        } else {
          appendFields.forEach(() => newRow.push(''));
          newRow.push('미매칭');
        }
        return newRow;
      });

      const outHeaders = [...tHeaders];
      appendFields.forEach(f => outHeaders.push(f.label));
      outHeaders.push('매칭결과');
      const wsDM = XLSX.utils.aoa_to_sheet([outHeaders, ...resultRows]);
      wsDM['!cols'] = outHeaders.map(h => ({ wch: Math.min(Math.max(String(h).length*2+4, 8), 40) }));
      const wbDM = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wbDM, wsDM, '매칭결과');

      const unmatchedRows = resultRows.filter(r => r[r.length-1] === '미매칭');
      if (unmatchedRows.length > 0) {
        const wsUnmatched = XLSX.utils.aoa_to_sheet([outHeaders, ...unmatchedRows]);
        wsUnmatched['!cols'] = wsDM['!cols'];
        XLSX.utils.book_append_sheet(wbDM, wsUnmatched, '미매칭목록');
      }

      const wboutDM = XLSX.write(wbDM, { bookType: 'xlsx', type: 'array' });
      self.postMessage({ ok: true, wbout: wboutDM, fileName: fnDM, matched: matchedCount, total: tDataRows.length });
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
      codepage: 949,   // .xls BIFF8 CP949(한글) 강제 인코딩
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
    if (data.action === 'ANALYZE_DEDUP') {
      const wb = XLSX.read(data.buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (allRows.length < 2) { self.postMessage({ ok: false, error: '데이터가 2행 이상이어야 합니다.' }); return; }

      const headers = allRows[0].map(h => String(h).trim());
      const findCol = (kws) => headers.find(h => kws.some(k => String(h).includes(k))) || '';
      const nameCol  = findCol(['이름','성명','성 명']);
      const birthCol = findCol(['생년월일','생년','생일','주민']);
      const phoneCol = findCol(['휴대폰','휴대','전화','연락처','핸드폰']);
      const dongCol  = findCol(['행정동','동이름','동명']);
      const noteCol  = findCol(['특이사항','비고','메모','사항']);

      const normN = v => String(v??'').trim().replace(/\s+/g,'');
      const normB = v => String(v??'').replace(/[^0-9]/g,'');
      const normP = v => String(v??'').replace(/[^0-9]/g,'').replace(/^82/,'0');

      // 파싱: 표시용 데이터만 추출 (전송 크기 최소화)
      const bodyRows = allRows.slice(1).map((row, i) => {
        const obj = {};
        headers.forEach((h, j) => { obj[h] = row[j] ?? ''; });
        return { _rowNum: i + 2, name: obj[nameCol]||'', birth: obj[birthCol]||'', phone: obj[phoneCol]||'', dong: obj[dongCol]||'', note: String(obj[noteCol]||'').trim() };
      });

      // 강한 중복: 이름+생년월일+전화 모두 일치
      const strongMap = new Map();
      bodyRows.forEach(r => {
        const key = `${normN(r.name)}|${normB(r.birth)}|${normP(r.phone)}`;
        if (!normN(r.name) || (!normB(r.birth) && !normP(r.phone))) return;
        if (!strongMap.has(key)) strongMap.set(key, []);
        strongMap.get(key).push(r);
      });
      const strongGroups = [];
      const strongDeleteNums = new Set();
      strongMap.forEach(rows => {
        if (rows.length < 2) return;
        const keepIdx = rows.length - 1;
        rows.forEach((r, i) => { if (i !== keepIdx) strongDeleteNums.add(r._rowNum); });
        strongGroups.push({ rows, keepIdx });
      });

      // 약한 중복: 행정동+이름+전화 일치 (강한 중복 제거 대상 제외)
      const weakRows = bodyRows.filter(r => !strongDeleteNums.has(r._rowNum));
      const weakMap = new Map();
      weakRows.forEach(r => {
        if (!normN(r.dong) || !normN(r.name) || !normP(r.phone)) return;
        const key = `${normN(r.dong)}|${normN(r.name)}|${normP(r.phone)}`;
        if (!weakMap.has(key)) weakMap.set(key, []);
        weakMap.get(key).push(r);
      });
      const weakGroups = [];
      weakMap.forEach(rows => {
        if (rows.length < 2) return;
        // 특이사항 있는 행 우선 보존 (마지막 항목 기준). 없으면 마지막 행 보존
        let keepIdx = rows.length - 1;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].note) { keepIdx = i; break; }
        }
        weakGroups.push({ rows, keepIdx });
      });

      // 약한 중복 — 특이사항 없는 행 전부 삭제 추천
      const weakDeleteNums = new Set();
      weakGroups.forEach(g => {
        g.rows.forEach((r, i) => { if (i !== g.keepIdx) weakDeleteNums.add(r._rowNum); });
      });

      // 중복 아니어도 특이사항 없는 행은 모두 삭제 대상
      const dupDeleteNums = new Set([...strongDeleteNums, ...weakDeleteNums]);
      const noNoteRows = bodyRows.filter(r => !r.note && !dupDeleteNums.has(r._rowNum));
      const noNoteDeleteNums = new Set(noNoteRows.map(r => r._rowNum));

      self.postMessage({
        ok: true, action: 'ANALYZE_DEDUP',
        headers, detectedCols: { nameCol, birthCol, phoneCol, dongCol, noteCol },
        strongGroups, weakGroups, noNoteRows,
        totalRows: bodyRows.length,
        recommendedDeletes: [...dupDeleteNums, ...noNoteDeleteNums],
      });
      return;
    }

    if (data.action === 'EXPORT_DEDUP') {
      const wb = XLSX.read(data.buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const deleteSet = new Set(data.deleteRowNums);
      const header = allRows[0];
      const kept = [header], deleted = [header];
      allRows.slice(1).forEach((row, i) => {
        (deleteSet.has(i + 2) ? deleted : kept).push(row);
      });
      const newWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(newWb, XLSX.utils.aoa_to_sheet(kept), '정제본');
      XLSX.utils.book_append_sheet(newWb, XLSX.utils.aoa_to_sheet(deleted), '삭제목록');
      const wbout = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
      self.postMessage({ ok: true, action: 'EXPORT_DEDUP', wbout, fileName: data.fileName });
      return;
    }

    if (data.action === 'ANALYZE_CLEAN') {
      const cleanWb = XLSX.read(data.buffer, { type: 'array' });
      const sheetResults = [];

      cleanWb.SheetNames.forEach(sheetName => {
        const ws = cleanWb.Sheets[sheetName];
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });
        const headerRow = allRows[0] || [];

        // 빈 행 탐지 (헤더 제외)
        let emptyRowCount = 0;
        let lastDataRowIdx = 0;
        allRows.forEach((row, i) => {
          if (i === 0) return;
          const isEmpty = row.every(c => !String(c ?? '').trim());
          if (!isEmpty) lastDataRowIdx = i;
          else emptyRowCount++;
        });
        const trailingRowCount = allRows.length - 1 - lastDataRowIdx;
        const innerEmptyCount = Math.max(0, emptyRowCount - trailingRowCount);

        // 유령 열 탐지 (헤더 없고 데이터도 없는 열)
        let ghostColCount = 0;
        headerRow.forEach((h, ci) => {
          if (String(h ?? '').trim()) return;
          const colHasData = allRows.slice(1).some(row => String(row[ci] ?? '').trim());
          if (!colHasData) ghostColCount++;
        });

        // 숨겨진 행/열
        const hiddenRowCount = ws['!rows'] ? ws['!rows'].filter(r => r?.hidden).length : 0;
        const hiddenColCount = ws['!cols'] ? ws['!cols'].filter(c => c?.hidden).length : 0;

        const isEmptySheet = allRows.length <= 1 || allRows.every(r => r.every(c => !String(c ?? '').trim()));

        sheetResults.push({
          sheetName, totalRows: Math.max(0, allRows.length - 1),
          innerEmptyRows: innerEmptyCount, trailingRows: trailingRowCount,
          ghostCols: ghostColCount, hiddenRows: hiddenRowCount,
          hiddenCols: hiddenColCount, isEmptySheet,
        });
      });

      self.postMessage({
        ok: true, action: 'ANALYZE_CLEAN',
        originalSize: data.buffer.byteLength,
        sheets: sheetResults,
        totalEmptyRows: sheetResults.reduce((s, r) => s + r.innerEmptyRows + r.trailingRows, 0),
        totalGhostCols: sheetResults.reduce((s, r) => s + r.ghostCols, 0),
        totalHiddenRows: sheetResults.reduce((s, r) => s + r.hiddenRows, 0),
        totalHiddenCols: sheetResults.reduce((s, r) => s + r.hiddenCols, 0),
        emptySheets: sheetResults.filter(r => r.isEmptySheet).length,
      });
      return;
    }

    if (data.action === 'EXPORT_CLEAN') {
      const cleanWb = XLSX.read(data.buffer, { type: 'array' });
      const newWb = XLSX.utils.book_new();

      cleanWb.SheetNames.forEach(sheetName => {
        const ws = cleanWb.Sheets[sheetName];
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });
        if (allRows.length === 0) return;

        const headerRow = allRows[0];
        // 빈 행 제거
        const dataRows = allRows.slice(1).filter(row => row.some(c => String(c ?? '').trim()));
        if (dataRows.length === 0) return; // 빈 시트 제거

        // 유령 열 제거 (헤더도 없고 데이터도 없는 열)
        const ghostColSet = new Set();
        headerRow.forEach((h, ci) => {
          if (String(h ?? '').trim()) return;
          const colHasData = dataRows.some(row => String(row[ci] ?? '').trim());
          if (!colHasData) ghostColSet.add(ci);
        });

        const keepCols = headerRow.map((_, ci) => ci).filter(ci => !ghostColSet.has(ci));
        const cleanHeader = keepCols.map(ci => headerRow[ci]);
        const cleanRows = dataRows.map(row => keepCols.map(ci => row[ci] ?? ''));

        const newWs = XLSX.utils.aoa_to_sheet([cleanHeader, ...cleanRows]);
        XLSX.utils.book_append_sheet(newWb, newWs, sheetName);
      });

      if (newWb.SheetNames.length === 0) {
        self.postMessage({ ok: false, action: 'EXPORT_CLEAN', error: '정제 후 남은 시트가 없습니다.' });
        return;
      }
      const wbout = XLSX.write(newWb, { bookType: 'xlsx', type: 'array', compression: true });
      self.postMessage({ ok: true, action: 'EXPORT_CLEAN', wbout, fileName: data.fileName });
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
      // raw: false → 숫자/날짜를 표시 문자열로 변환, 전화번호 앞 0 보존
      const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false, raw: false })
        .map(row => row.map(cell => typeof cell === 'string' ? cell.trim() : cell)); // 주소 앞 공백 등 trim
      allRawData = allRawData.concat(rawJson.slice(0, 30));
      return parseSheet(name, rawJson, data.dynamicRules);
    });

    const firstSheet = sheetsData[0];
    const cityCandidates = extractCityCandidates(
      fileName,
      allRawData,
      firstSheet?.bodyRows,
      firstSheet?.addrColIdx
    );
    const detectedCity = cityCandidates[0] || '';

    // ── 정밀 분석 요약 (명단 시트 자동 선별 + 제외 사유 + 잡음행 수) ──────────
    const rosterSheetsArr = sheetsData.filter(s => s.isRosterSheet);
    const excludedSheets = sheetsData.filter(s => !s.isRosterSheet).map(s => {
      let reason = '명단 핵심열 부족';
      if (/통계|요약|집계|개요|총괄|표지|목차|안내|설명|서식|양식|샘플|예시|pivot|피벗|차트|그래프/i.test(String(s.name))) reason = '통계·안내·서식 시트';
      else if ((s.rowsCount || 0) === 0) reason = '데이터 없음(빈 시트)';
      return { name: s.name, reason };
    });
    const analysisSummary = {
      totalSheets: sheetsData.length,
      rosterSheets: rosterSheetsArr.length,
      excludedSheets,
      totalRows: rosterSheetsArr.reduce((a, s) => a + (s.rowsCount || 0), 0),
      droppedRows: sheetsData.reduce((a, s) => a + (s.skippedRowCount || 0), 0),
    };

    const monthMatch = fileName.match(/(\d+)월/);
    self.postMessage({ ok: true, action: 'PARSE_TARGET', sheetsData, detectedCity, cityCandidates, analysisSummary, monthStr: monthMatch ? `${monthMatch[1]}월` : '' });
  } catch (err) {
    self.postMessage({ ok: false, action: data.action, error: err.message });
  }
};
