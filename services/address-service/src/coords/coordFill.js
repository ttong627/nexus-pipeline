// ══════════════════════════════════════════════════════════════════
//  C-3 좌표 채움 파이프라인 — 설계서 좌표관리_설계.md §3-2
//  회귀: scripts/coord-fill.test.mjs
//
//  ★DB도 네트워크도 여기서 직접 만지지 않는다. 판정은 순수함수로, 외부 호출은
//    주입(deps)으로 받는다. 그래야 "이 좌표를 채택해도 되는가"를 API 키 없이
//    회귀로 고정할 수 있다. C-2(coordStore.js)와 같은 원칙이다.
//
//  ★이 파일의 존재 이유 1순위는 **오염 재발 차단**이다. C-4 이관에서 375건을
//    격리해야 했던 원인(vworld.js pickDong 의 `|| byDong[0]` 폴백)이 그대로
//    남아 있었다. 그 폴백은 단지명 검증에 실패해도 주변 아무 건물이나 집는다.
//    실측: `B동` 좌표 하나가 성암빌라·진아빌라·청양맨션·청정빌라·신한그린빌에
//    동시에 붙어 있었다(설계서 F3).
// ══════════════════════════════════════════════════════════════════
import { ENTRANCE_SOURCES, normalizeDongNo } from './coordStore.js';

/**
 * 동 탐색 반경 — **여기가 유일한 정의**다(vworld.js 가 이걸 가져다 쓴다).
 *
 * 좁게 먼저 보고(정확), 못 찾을 때만 넓힌다. 넓힐수록 인접 단지가 딸려 들어와
 * 오염 위험이 커지므로 순서를 뒤집으면 안 된다.
 *   NARROW ±250m : 소규모 단지·정밀 1차
 *   WIDE   ±700m : 대단지 2차 — 지오코딩 대표점이 단지 한쪽에 찍히면 반대편 동이
 *                  좁은 범위 밖으로 벗어난다(실측: 여월휴먼시아2단지 후보 0개).
 */
export const BBOX_NARROW_DEG = 0.0025;
export const BBOX_WIDE_DEG = 0.0065;

/** 채움 폴백 순서 — 설계서 §3-2 ②출입구자료 → ③VWorld → ④Kakao */
export const FILL_SOURCES = ['juso_entrc', 'vworld', 'kakao'];

/** 지오코딩 출처는 **중심 좌표**만 채울 수 있다(F1). 입구 칸은 ENTRANCE_SOURCES 전용. */
export const CENTER_SOURCES = new Set(['vworld', 'kakao']);

/**
 * 키가 있는 출처만 "쓸 수 있는 출처"다.
 *
 * ★2026-08-11 첫 운영 실행에서 드러난 것: Job 에 VWORLD_KEY·KAKAO_REST_KEY 를 안 넣고
 *   돌렸더니 **채움률 0% 인데 요약엔 `vworld 100 · kakao 100 사용`** 이 찍혔다.
 *   호출은 한 번도 없었다(1.1초에 200콜은 불가능). 키가 없으면 geocodeRoad 가 즉시
 *   null 을 돌려주는데, 쿼터는 호출 **전에** 차감하고 있었기 때문이다.
 *   계측이 거짓말을 하면 "한도를 다 썼나?"를 먼저 의심하게 되고 진짜 원인이 가려진다.
 *   → 키 없는 출처는 **아예 주입하지 않는다**. 그러면 쿼터도 안 줄고 요약에도 안 뜬다.
 */
export const availableSources = ({ vworldKey = '', kakaoRestKey = '' } = {}) => {
  const list = [];
  if (String(vworldKey).trim()) list.push('vworld');
  if (String(kakaoRestKey).trim()) list.push('kakao');
  return list;
};

/** 이름 비교용 정규화 — 공백 제거. C-4 오염 격리 SQL(regexp_replace '\s')과 같은 기준. */
const nameKey = (v) => String(v ?? '').replace(/\s+/g, '');

/**
 * 역방향(짧은 이름 → 긴 이름) 매칭을 허용할 최소 길이.
 *
 * ★`삼성`·`대우`·`현대` 같은 2글자 이름으로 역방향을 열면 `삼성래미안`·`삼성쉐르빌`
 *   아무 데나 붙는다. 4글자면 단지 고유명으로 볼 만하다(여월휴먼시아=6).
 */
const MIN_REVERSE_NAME = 4;

/**
 * 단지명이 같은 건물인가 — **양방향**으로 본다.
 *
 * ★2026-08-11 실측: VWorld 는 건물명을 **줄여서** 준다.
 *     VWorld `여월휴먼시아`  vs  저장 `여월휴먼시아2단지아파트`
 *   한 방향(`vworld.includes(ours)`)만 보면 false 라, BBOX 에 22건이나 있는데도
 *   전부 기각됐다. 보성·월곶이 통과한 건 이름이 우연히 정확히 같아서였다.
 *   → 어느 쪽이 더 길든 서로 포함하면 같은 단지로 본다. 단, 짧은 쪽이 너무 짧으면
 *     역방향은 열지 않는다(위 MIN_REVERSE_NAME). 그래도 남는 위험은
 *     "후보가 둘 이상이면 기각" 규칙이 받는다.
 */
const sameComplex = (buildName, complexName) => {
  const a = nameKey(buildName);
  const b = nameKey(complexName);
  if (!a || !b) return false;
  if (a.includes(b)) return true;
  return a.length >= MIN_REVERSE_NAME && b.includes(a);
};

/**
 * 한 글자짜리 동 표기는 모호하다 — `가`·`나`·`A`·`B`.
 *
 * ★빌라 밀집지에서 이 표기는 BBOX 안에 수십 개가 함께 잡힌다. 동번호만으로는
 *   어느 건물의 것인지 가릴 수 없다. `101동`처럼 자릿수가 있는 표기와 달리
 *   **우연히 하나만 잡혀도 그게 그 건물이라는 근거가 되지 못한다.**
 *   빈 값도 모호로 본다 — 없는 동을 채택할 근거는 애초에 없다.
 */
export const isAmbiguousDong = (dongNo) => {
  const s = normalizeDongNo(dongNo);
  if (!s) return true;
  return /^[가-힣A-Za-z]$/.test(s);
};

/**
 * BBOX 조회 결과에서 이 건물의 동을 고른다 — **못 고르면 비운다**.
 *
 * ★규칙(형 지시 2026-08-11): 한글·영문 단일 동은 **단지명 검증 없이 채택 금지**.
 *   그리고 후보가 둘 이상이면 단지명이 있든 없든 채택하지 않는다.
 *   찍어서 붙인 좌표는 틀려도 티가 안 나지만(지도에 점은 찍힌다), 비워 두면
 *   `/v1/coords/status` 의 미보유 건수로 드러나 되돌릴 수 있다.
 *   C-2 pickRoadCode 가 도로코드에서 쓰는 것과 같은 원칙이다.
 */
export const acceptDongCandidate = (candidates, { wantDong, complexName = '' } = {}) => {
  const want = normalizeDongNo(wantDong);
  if (!want) return null;
  const byDong = (candidates || []).filter(
    (b) => b && b.lat != null && b.lng != null && normalizeDongNo(b.dongNo) === want,
  );
  if (!byDong.length) return null;

  const complex = nameKey(complexName);
  if (complex) {
    const named = byDong.filter((b) => sameComplex(b.buildName, complexName));
    // ★폴백 금지. 단지명이 있는데 일치하는 게 없다는 건 "여긴 그 단지가 아니다"라는 뜻이다.
    return named.length === 1 ? named[0] : null;
  }
  // 단지명이 없으면 모호한 표기는 아예 채택하지 않는다.
  if (isAmbiguousDong(want)) return null;
  return byDong.length === 1 ? byDong[0] : null;
};

/**
 * 일일 쿼터 카운터 (설계서 §3-3·F7).
 *
 * ★소진을 조용히 넘어가면 "좌표가 안 늘어나는 걸 아무도 모른다". 남은 건수를
 *   셀 수 있어야 요약 로그에 `쿼터 소진으로 N건 이월`을 적을 수 있다.
 *   모르는 출처는 거절한다 — 오타 하나로 무제한이 되면 한도가 없는 것과 같다.
 */
export const createQuotaCounter = (limits = {}) => {
  const cap = new Map(
    Object.entries(limits)
      .filter(([source]) => FILL_SOURCES.includes(source))
      .map(([source, n]) => [source, Math.max(0, Number(n) || 0)]),
  );
  const spent = new Map([...cap.keys()].map((s) => [s, 0]));
  const left = (s) => (cap.has(s) ? cap.get(s) - spent.get(s) : 0);
  return {
    take(source, n = 1) {
      if (!cap.has(source) || n <= 0 || left(source) < n) return false;
      spent.set(source, spent.get(source) + n);
      return true;
    },
    used: (source) => spent.get(source) ?? 0,
    remaining: (source) => left(source),
    exhausted: (source) => left(source) <= 0,
    summary: () => Object.fromEntries([...cap.keys()].map((s) => [s, { used: spent.get(s), limit: cap.get(s) }])),
  };
};

/**
 * 조회 결과(resolveCoords) → 채울 것 / 건너뛸 것.
 *
 * ★건너뛰는 이유를 남긴다. 뭉뚱그리면 "왜 안 채워졌나"를 다시 조사해야 하고,
 *   앵커 없는 건에 매번 외부 API 를 태워 쿼터만 태우게 된다.
 *   - no_anchor : 주소를 특정 못 한 것. **좌표 문제가 아니라 주소 문제다**(A-36).
 *   - none      : 해봤는데 없었다. 재시도는 정기배치(C-6)가 주기를 두고 한다.
 *   - outlier   : 이상 좌표는 다시 채운다(DS-15 — 그대로 두면 기사 구역이 부풀어 오른다).
 */
export const classifyFillTargets = (entries = []) => {
  const fill = [];
  const skip = [];
  for (const e of entries) {
    if (!e) continue;
    if (e.quality === 'no_anchor' || !e.coordKey) { skip.push({ ...e, reason: 'no_anchor' }); continue; }
    if (e.quality === 'none') { skip.push({ ...e, reason: 'tried_none' }); continue; }
    const hasPoint = Boolean(e.entrance || e.center);
    // ★내비용 점과 동 좌표는 **용도가 다른 별개의 값**이다. 중심이 있다고 동을 안 채우면
    //   단지 내부 동선이 영원히 안 살아난다(은마아파트 동간 약 280m).
    //   2026-08-11 운영 실측: 명단 4건이 전부 `cached` 로 건너뛰어 동 좌표가 0건이었다.
    const wantsDong = Boolean(normalizeDongNo(e.dongNo || e.record?.dongNo));
    const missingDong = wantsDong && !e.dong;
    if (hasPoint && !missingDong && e.quality !== 'outlier') { skip.push({ ...e, reason: 'cached' }); continue; }
    fill.push(e);
  }
  return { fill, skip };
};

/**
 * 채움 결과 1건 → DB 쓰기 값. **출처가 자리를 결정한다**(F1).
 *
 * ★출처를 모르면 좌표를 버린다. 출처 없는 좌표는 나중에 출처별 신뢰도로
 *   재평가할 수 없고, 틀렸을 때 무엇을 다시 받아야 하는지도 알 수 없다.
 * ★좌표를 못 구해도 행은 만든다(quality='none'). 그래야 "아직 안 해봤다"(unknown)와
 *   "해봤는데 없다"(none)가 구분되고, 채움 배치가 헛돌지 않는다.
 */
export const buildCoordWrite = ({
  coordKey, roadAddress = '', sigungu = '', legalEmd = '', buildingName = '',
  isApartment = false, point = null, source = null,
} = {}) => {
  if (!coordKey) return null;
  const base = {
    coordKey,
    roadAddress,
    sigungu,
    legalEmd,
    buildingName,
    isApartment: Boolean(isApartment),
    entranceLat: null, entranceLng: null, entranceSource: null,
    centerLat: null, centerLng: null, centerSource: null,
    quality: 'none',
  };
  const lat = point?.lat;
  const lng = point?.lng;
  if (lat == null || lng == null || !source) return base;

  if (ENTRANCE_SOURCES.has(source)) {
    return { ...base, entranceLat: Number(lat), entranceLng: Number(lng), entranceSource: source, quality: 'unverified' };
  }
  if (CENTER_SOURCES.has(source)) {
    return { ...base, centerLat: Number(lat), centerLng: Number(lng), centerSource: source, quality: 'unverified' };
  }
  return base;
};

/**
 * 채움 오케스트레이션 — ②출입구자료 → ③VWorld(+아파트면 동) → ④Kakao.
 *
 * deps 주입: { findEntrance, geocodeRoad, getBuildingsNear, kakaoGeocode }
 * ★아파트일 때만 동 조회를 돈다(R4). 단독·상가에 BBOX 를 태우면 쿼터만 태운다.
 * ★쿼터가 없으면 그 출처는 건너뛴다 — 호출하고 실패하는 게 아니라 아예 안 부른다.
 */
export const createCoordFiller = ({
  findEntrance = null, geocodeRoad = null, getBuildingsNear = null, kakaoGeocode = null,
} = {}) => async (target, quota) => {
  const carried = [];
  const dongs = [];

  // ② 행안부 출입구 자료 — 입구 좌표를 채울 수 있는 유일한 자동 경로(F1)
  if (findEntrance) {
    const hit = await findEntrance(target);
    if (hit?.lat != null && hit?.lng != null) {
      return { point: { lat: hit.lat, lng: hit.lng }, source: 'juso_entrc', dongs, carried };
    }
  }

  // ③ VWorld 지오코딩(+아파트면 동별 BBOX)
  // ★이미 아는 중심이 있으면 다시 지오코딩하지 않는다. 동 좌표만 필요해 다시 온 건이
  //   여기서 중심을 또 사면 호출이 두 배가 된다 — 그리고 답은 같다.
  let center = (target.knownCenter?.lat != null && target.knownCenter?.lng != null)
    ? { lat: Number(target.knownCenter.lat), lng: Number(target.knownCenter.lng) }
    : null;
  const reusedCenter = Boolean(center);
  if (!center && geocodeRoad) {
    if (!quota || quota.take('vworld', 1)) {
      center = await geocodeRoad(target.roadAddress);
    } else {
      carried.push('vworld');
    }
  }
  // ★맞출 동 번호가 없으면 BBOX 를 부르지 않는다. acceptDongCandidate 가 어차피 전부
  //   기각하므로 순수 낭비다 — 첫 실전 실행에서 이렇게 100회를 헛되이 썼다.
  //   배치 경로(building_coord 기반)에는 동 번호가 없다. 동 좌표는 **명단 기반 fill**
  //   에서 채워진다(명단이 동 번호를 갖고 있다).
  const wantDong = normalizeDongNo(target.dongNo);
  if (center && target.isApartment && wantDong && getBuildingsNear) {
    if (!quota || quota.take('vworld', 1)) {
      const near = await getBuildingsNear(center.lng, center.lat, BBOX_NARROW_DEG);
      let pick = acceptDongCandidate(near, { wantDong: target.dongNo, complexName: target.buildingName });
      // ★대단지 2차 확장(matchDongCoord 가 2026-07-27 에 넣은 것과 같은 이유).
      //   지오코딩 대표점이 단지 한쪽에 찍히면 반대편 동이 좁은 범위 밖으로 벗어난다
      //   — 실측: 여월휴먼시아2단지(동 104~212)가 좁은 BBOX 에서 후보 0개였다.
      //   1차에서 찾았으면 넓히지 않는다. 넓힐수록 인접 단지가 딸려 들어온다.
      if (!pick && (!quota || quota.take('vworld', 1))) {
        const wide = await getBuildingsNear(center.lng, center.lat, BBOX_WIDE_DEG);
        pick = acceptDongCandidate(wide, { wantDong: target.dongNo, complexName: target.buildingName });
      }
      if (pick) {
        dongs.push({
          dongNo: normalizeDongNo(pick.dongNo), lat: pick.lat, lng: pick.lng,
          floors: pick.floors ?? null, buildName: pick.buildName || '', matched: 'dong', source: 'vworld',
        });
      }
    } else {
      carried.push('vworld_dong');
    }
  }
  // ★재사용한 중심은 다시 쓰지 않는다. 값은 같아도 center_source 를 'vworld' 로 덮어
  //   원래 출처(kakao 등)를 지우면, 나중에 출처별로 품질을 재평가할 수 없다.
  if (center) return { point: reusedCenter ? null : center, source: reusedCenter ? null : 'vworld', dongs, carried };

  // ④ Kakao 폴백
  if (kakaoGeocode) {
    if (!quota || quota.take('kakao', 1)) {
      const k = await kakaoGeocode(target.roadAddress);
      if (k?.lat != null && k?.lng != null) return { point: k, source: 'kakao', dongs, carried };
    } else {
      carried.push('kakao');
    }
  }
  return { point: null, source: null, dongs, carried };
};
