/**
 * 행안부 출입구(주출입구) 자료 파서 — 순수 함수, 외부 의존 0.
 *
 * ★왜 파서가 두 개인가 (2026-08-01 실측)
 *   형이 받아둔 자료에는 **서로 다른 두 데이터셋**이 섞여 있다. 파일명만 보면 같아 보이지만
 *   레이아웃이 다르다. 하나의 파서로 둘 다 읽으려다 한쪽을 통째로 버리는 사고가 이미 있었다
 *   (yyplus juso-sync.mjs 는 19필드 미만을 버려서 18필드짜리 위치정보요약DB 를 전량 폐기).
 *
 *   ① 위치정보요약DB (entrc_{시도}.txt) — 18필드
 *      공식 명세: `[레이아웃]위치정보요약DB.pdf` §1
 *      ★건물명·건물용도분류·건물군여부가 있다 → 아파트/건물군 판별에 직결. 이쪽이 정보가 더 풍부.
 *      변동분(entrc_mod.txt)은 19필드 = 위 18 + 이동사유코드.
 *
 *   ② 연계 자료 (RNENTDATA_*.txt · AlterD.JUSUEC.*.TH_SGCO_RNADR_POSITION.TXT) — 19필드
 *      1번 필드가 **도로명주소관리번호(25자)**. 건물명·용도가 없는 대신 관리번호로
 *      address_core 와 직접 조인된다. 일변동 파일은 14번 필드에 이동사유코드가 실린다.
 *
 * 판별은 필드 수가 아니라 **1번 필드의 생김새**로 한다. 둘 다 19필드인 경우가 있어
 * (entrc 변동분 19 = 연계 19) 필드 수만으로는 구분되지 않기 때문이다.
 *
 * 좌표는 GRS80 UTM-K(EPSG:5179). 비공개·공개제한 건물은 좌표가 비어 있다(명세 참고사항).
 */

/** 이동사유코드 — 변동분 반영 규칙(명세 §2) */
export const CHANGE_INSERT = '31';   // 신규 도로명주소 → INSERT
export const CHANGE_UPDATE = '34';   // PK 기준 변동 → UPDATE
export const CHANGE_DELETE = '63';   // 폐지된 도로명주소 → DELETE

/** 위치정보요약DB(entrc) 컬럼 순서 — 명세 §1 그대로 */
const ENTRC_COLS = [
  'sigunguCode', 'entranceNo', 'legalDongCode', 'sido', 'sigungu', 'emd',
  'roadCode', 'roadName', 'undergroundYn', 'mainNo', 'subNo',
  'buildingName', 'zipCode', 'buildingUse', 'buildingGroupYn', 'adminDong',
  'x', 'y',
];

/** 연계 자료(RNADR_POSITION) 컬럼 순서 — 실측 대조로 확정 */
const LINK_COLS = [
  'addressMgtNo', 'legalDongCode', 'sido', 'sigungu', 'emd', 'ri',
  'roadCode', 'roadName', 'undergroundYn', 'mainNo', 'subNo',
  'zipCode', 'effectiveDate', 'changeReason', 'entranceNo',
  'entranceKind', 'entranceType', 'x', 'y',
];

/**
 * 도로명주소관리번호로 연계 포맷을 판별한다.
 *
 * ⚠️ 실측 2026-08-01: 실제 자료의 관리번호는 **26자**다(RNENTDATA·AlterD 전수 동일).
 *    yyplus juso-sync.mjs 주석에는 "관리번호(25)"로 적혀 있으나 데이터와 다르다.
 *    자릿수를 못박으면 자료가 바뀔 때 조용히 전량 오분류되므로 **하한만** 둔다.
 *    비교 대상인 entrc 의 1번 필드는 시군구코드(5자)라 15자 하한으로 충분히 갈린다.
 */
const MGT_NO_RE = /^\d{15,}$/;

/**
 * 한 줄이 어느 데이터셋인지 판별한다.
 * @returns {'entrc'|'link'|null} null = 판별 불가(빈 줄·깨진 줄)
 */
export function detectLayout(line) {
  if (typeof line !== 'string') return null;
  const f = line.split('|');
  if (f.length < 18) return null;
  return MGT_NO_RE.test(f[0].trim()) ? 'link' : 'entrc';
}

const num = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const txt = (v) => String(v ?? '').trim();

/**
 * 출입구 한 줄 → 정규 레코드. 판별 실패·필드 부족이면 null(호출부가 집계해 버린다).
 *
 * 반환 형태는 두 포맷을 **하나의 스키마로 통일**한다. 없는 값은 null 로 둔다
 * (entrc 에는 addressMgtNo 가 없고, link 에는 buildingName·buildingUse 가 없다).
 */
export function parseEntranceLine(line) {
  const layout = detectLayout(line);
  if (!layout) return null;

  const f = line.split('|');
  const cols = layout === 'entrc' ? ENTRC_COLS : LINK_COLS;
  const raw = {};
  cols.forEach((name, i) => { raw[name] = f[i]; });

  // ★좌표는 항상 마지막 두 필드다. entrc 변동분은 뒤에 이동사유코드가 한 칸 더 붙어
  //   위치가 밀리므로, 컬럼 인덱스가 아니라 꼬리에서 집는다.
  let xi = cols.indexOf('x');
  let yi = cols.indexOf('y');
  let changeReason = txt(raw.changeReason);
  if (layout === 'entrc' && f.length >= 19) {
    // entrc 변동분(19필드) = 18 + 이동사유코드
    changeReason = txt(f[18]);
  }
  const x = num(f[xi]);
  const y = num(f[yi]);

  const mainNo = num(raw.mainNo);
  const subNo = num(raw.subNo);
  const roadCode = txt(raw.roadCode);

  // PK(명세): 도로명코드 + 지하여부 + 본번 + 부번 + 법정동코드
  if (!roadCode || mainNo === null) return null;

  return {
    layout,
    // 식별
    addressMgtNo: layout === 'link' ? txt(raw.addressMgtNo) || null : null,
    entranceNo: txt(raw.entranceNo) || null,
    // 주소 PK
    roadCode,
    undergroundYn: txt(raw.undergroundYn) || '0',
    mainNo,
    subNo: subNo === null ? 0 : subNo,
    legalDongCode: txt(raw.legalDongCode) || null,
    // 표시용
    sido: txt(raw.sido) || null,
    sigungu: txt(raw.sigungu) || null,
    emd: txt(raw.emd) || null,
    roadName: txt(raw.roadName) || null,
    zipCode: txt(raw.zipCode) || null,
    // ★entrc 에만 있는 정보 — 아파트·건물군 판별의 근거
    buildingName: layout === 'entrc' ? txt(raw.buildingName) || null : null,
    buildingUse: layout === 'entrc' ? txt(raw.buildingUse) || null : null,
    buildingGroupYn: layout === 'entrc' ? txt(raw.buildingGroupYn) || null : null,
    adminDong: layout === 'entrc' ? txt(raw.adminDong) || null : null,
    // 좌표 (EPSG:5179). 비공개·공개제한 건물은 null 이며 이는 정상이다.
    x, y,
    // 변동분에만 존재
    changeReason: changeReason || null,
  };
}

/** PK 문자열 — 전체분/변동분 대조 및 upsert 키. 명세 PK1~PK5 순서. */
export function entranceKey(rec) {
  return [
    rec.roadCode,
    rec.undergroundYn,
    rec.mainNo,
    rec.subNo,
    rec.legalDongCode || '',
  ].join('|');
}

/** 건물군(아파트 단지 등) 여부 — 300002 동 도형과 이어붙일 대상 판별 */
export function isBuildingGroup(rec) {
  return rec.buildingGroupYn === '1';
}

/**
 * 파일 한 덩어리 파싱. 스트리밍 호출부가 줄 단위로 넘겨도 되고 전체를 넘겨도 된다.
 * @returns {{records: object[], stats: {total:number, ok:number, skipped:number,
 *            noCoord:number, byLayout:Record<string,number>, byReason:Record<string,number>}}}
 */
export function parseEntranceLines(lines) {
  const records = [];
  const stats = { total: 0, ok: 0, skipped: 0, noCoord: 0, byLayout: {}, byReason: {} };
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    stats.total += 1;
    const rec = parseEntranceLine(line);
    if (!rec) { stats.skipped += 1; continue; }
    stats.ok += 1;
    stats.byLayout[rec.layout] = (stats.byLayout[rec.layout] || 0) + 1;
    if (rec.changeReason) {
      stats.byReason[rec.changeReason] = (stats.byReason[rec.changeReason] || 0) + 1;
    }
    if (rec.x === null || rec.y === null) stats.noCoord += 1;
    records.push(rec);
  }
  return { records, stats };
}
