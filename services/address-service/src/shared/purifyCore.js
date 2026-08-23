// ══════════════════════════════════════════════════════════════════
//  purifyCore — 주소 정제 코어 (클라·서버 **공용 SSOT**, P7 Phase2 ⓒ-1 본체)
//
//  형 확정(B1): 코어는 하나다. 클라(브라우저)와 서버(address-service)가 같은 파일을
//  써서 "복제 후 분기" 안티패턴을 원천 배격한다. 로직은 addressEngine.js에서
//  **한 글자도 바꾸지 않고** 옮겼다(골든 offline 35케이스가 불변을 증명).
//
//  외부 의존은 전부 deps 주입으로 분리한다 — 이 파일 자체는 firebase·Kakao·환경변수를 모른다.
//    deps.io    : lookupAddr · searchKakaoFull · fetchKakaoLegalDong · fetchKakaoCoord ·
//                 fetchDongCoord · parseAptDong
//    deps.side  : addSpecialChar (부수효과 — 서버는 no-op/큐로 대체)
//    deps.dicts : ready · typoDict · typoRegex · nameTypoDict · specialCharRegex ·
//                 buildingAliasDict(+VariantIndex) · noteNormalizeDict(+VariantIndex)
//
//  ★dicts는 반드시 **getter 객체**로 주입할 것. 학습사전은 비동기 로드라 값 스냅샷을
//    넘기면 로드 이전의 빈 사전이 영구 고정된다(클라 wiring은 addressEngine.js 참조).
//
//  규칙 전문: CLAUDE.md §1 (A-1 ~ A-34)
// ══════════════════════════════════════════════════════════════════
import { normalizeCommonRoadTypos } from './roadTokens.js';
import { normalizeAddressPreamble, normalizeCenterName, stripLeadingAddressJunk } from './textNormalize.js';
import {
  ROAD_ADDRESS_RE,
  PHONE_IN_ADDR_RE,
  normalizeRoadAddressSpacing,
  stripAddressDelimiters,
  normalizeAddressDetail,
  dedupeDetailTokens,
  appendUniqueNote,
  splitInlineBuildingTail,
} from './detailNormalize.js';
import { normalizeDongHoDetail } from './dongHoFormat.js';
import { isTranslitBuildingDong, splitBuildingDongTail } from './dongTokens.js';
import { protectParenBlocks, balanceParens } from './addressFormat.js';
import { applyVariant } from './normalizeVariant.js';
import { applyNoteNormalize } from './applyNoteNormalize.js';
import {
  ROAD_DETAIL_SEPARATOR,
  ADDRESS_EXTRA_SEPARATOR,
  normalizePlaceKey,
  appendCheckReason,
  extractSigungu,
  extractSido,
  getMunicipalityMatch,
  getAreaIssue,
  DO_PATTERN,
  REGION_SUFFIX,
  REGION_LEAD,
  DONG_SUFFIX,
  LEGAL_DONG_RE,
  CENTER_RE,
  CENTER_KWDS,
  REGION_TOKEN_RE,
  KNOWN_CITY_RE,
  BLDG_TYPE_RE,
  BASE_TYPO_FIXES,
  kakaoDocToApiResult,
  kakaoDocInMunicipality,
  generateCenterKeyword,
} from './purifyHelpers.js';

const parseOfficialRoadAddressText = (value) => {
  const normalized = normalizeRoadAddressSpacing(stripLeadingAddressJunk(value));
  const match = ROAD_ADDRESS_RE.exec(normalized);
  if (!match) return null;

  const leading = match[1] || '';
  const start = match.index + leading.length;
  const end = match.index + match[0].length;
  const roadName = normalizeRoadAddressSpacing(match[2] || '').replace(/\s+/g, '');
  const underground = match[3] ? '\uC9C0\uD558 ' : '';
  const mainNo = match[4] || '';
  let subNoValue = match[5] || '';
  let compactRoomDetail = '';
  let inferenceReason = '';
  let tail = normalized.slice(end);
  if (subNoValue.length >= 3 && /^\s*\uD638(?:\s|$|[),/])/.test(tail)) {
    compactRoomDetail = `${subNoValue.slice(1)}\uD638`;
    inferenceReason = `주소 추정 변환(부번+호수 압축, 40층 이상 호수 가능성 낮음): ${roadName} ${mainNo}-${subNoValue}호 → ${roadName} ${mainNo}-${subNoValue.slice(0, 1)}, ${compactRoomDetail}`;
    subNoValue = subNoValue.slice(0, 1);
    tail = tail.replace(/^\s*\uD638/, ' ');
  }
  const subNo = subNoValue ? `-${subNoValue}` : '';
  const searchAddress = `${roadName} ${underground}${mainNo}${subNo}`.trim();
  const prefix = stripAddressDelimiters(normalized.slice(0, start));
  const splitTail = splitInlineBuildingTail(tail);
  const detail = normalizeAddressDetail([prefix, compactRoomDetail, splitTail.detail].filter(Boolean).join(' '));

  return {
    searchAddress,
    detail,
    inlineBuildingName: splitTail.inlineBuildingName,
    roadName,
    mainNo,
    subNo: subNoValue,
    inferenceReason,
  };
};

export const createProcessAddress = (deps) => async (inputAddr, inputName = '', adminDong = '', cityLabel = '', inputNote = '', options = {}) => {
  const { io, side, dicts } = deps;
  const includeCoords = options.includeCoords !== false;
  const result = {
    정제된이름: inputName,
    주소: '',
    특이사항: '',
    본명: '',
    확인필요: false,
    확인사유: '',
    도: '',
    주소추정: false,
    추정사유: '',
    원주소: inputAddr || '',
  };

  // ── A-1: 이름 5자 초과 → 5자 자르기 + 본명 전용 필드에 원본명 보관 ──────
  // (특이사항 오염 방지: 본명은 특이사항이 아니라 별도 '본명' 컬럼으로 분리)
  if (inputName?.length > 5) {
    result.정제된이름 = inputName.substring(0, 5);
    result.본명       = inputName;
  }

  // ── A-12 ①: 주소 공란 플래그 ─────────────────────────────────────
  if (!inputAddr?.trim()) {
    result.확인필요 = true;
    result.확인사유 = '주소 공란';
    return result;
  }

  await dicts.ready;

  // ── A-2: 오타 사전 적용 ───────────────────────────────────────────
  let text = inputAddr;
  const correctionLogs = [];
  const addCorrectionLog = (from, to, reason = '오타 보정') => {
    if (!from || !to || from === to) return;
    const log = `${reason}: ${from} → ${to}`;
    if (!correctionLogs.includes(log)) correctionLogs.push(log);
  };
  for (const [w, c] of Object.entries(BASE_TYPO_FIXES)) {
    if (w && c && text.includes(w)) {
      text = text.replaceAll(w, c);
      addCorrectionLog(w, c);
    }
  }
  if (dicts.typoRegex) {
    text = text.replace(dicts.typoRegex, m => {
      const fixed = dicts.typoDict[m] || m;
      addCorrectionLog(m, fixed, '학습 오타 보정');
      return fixed;
    });
  }
  // 학습 이름 오타 사전 적용 (Phase 4) — 정제된이름/본명에 승인된 이름 오타 치환(완전일치만).
  {
    const _bn = result.정제된이름;
    if (_bn && dicts.nameTypoDict[_bn]) result.정제된이름 = dicts.nameTypoDict[_bn];
    if (result.본명 && dicts.nameTypoDict[result.본명]) result.본명 = dicts.nameTypoDict[result.본명];
    if (_bn !== result.정제된이름) addCorrectionLog(_bn, result.정제된이름, '학습 이름 보정');
  }
  const beforeCommonRoadTypo = text;
  text = normalizeCommonRoadTypos(text);   // SSOT: shared/roadTokens.js (same rule as server)
  if (beforeCommonRoadTypo !== text) addCorrectionLog('재기로', '제기로', '도로명 오타 보정');

  // ── A-3·A-4·A-6·A-15·A-16·A-21: 순수 규격화 프리앰블 (shared SSOT) ──
  //   유니코드 정규화·미닫힌괄호·통반·점→쉼표·번지제거·주민센터. 외부 의존 없는 순수 변형.
  //   구현·정규식은 services/address-service/src/shared/textNormalize.js 단일 소스.
  text = normalizeAddressPreamble(text);
  const normalizedInputNote = normalizeCenterName(inputNote);

  // ── A-9: 특수문자 이후 내용 → 특이사항 (전체 텍스트 1차 적용) ─────
  // 위치 < 5자이면 주소 앞부분 → 건너뜀
  // '/' 가 숫자 사이에 있으면 지번 구분자 → 건너뜀 (A-9 예외)
  if (dicts.specialCharRegex) {
    const spMatch = text.match(dicts.specialCharRegex);
    if (spMatch) {
      const matchPos  = text.indexOf(spMatch[0]);
      const matchChar = spMatch[1];
      const isJibunSlash = matchChar === '/'
        && matchPos > 0
        && /\d$/.test(text[matchPos - 1])
        && /^\d/.test(spMatch[2]);
      if (matchPos >= 5 && !isJibunSlash) {
        const note = spMatch[2].trim();
        if (note) result.특이사항 += (result.특이사항 ? ' ' : '') + note;
        side.addSpecialChar(matchChar);
        text = text.slice(0, matchPos).replace(/\s+$/, '');
      }
    }
  }

  // ── 주소칸에 섞인 전화번호 → 특이사항 분리 (괄호/상세 오염 차단) ─────
  // 예: "대실길131,042-841-1633" → 주소 "대실길 131" + 특이사항 "042-841-1633"
  {
    const phoneRe = new RegExp(PHONE_IN_ADDR_RE.source, 'g');
    const phones = text.match(phoneRe);
    if (phones) {
      phones.forEach(p => { result.특이사항 = appendUniqueNote(result.특이사항, p.trim()); });
      text = text.replace(phoneRe, ' ').replace(/[,\s]+$/,'').replace(/\s+/g, ' ').trim();
    }
  }

  // 공공기관 키워드 포함 여부 사전 감지 (A-5 동 토큰 삭제 방지)
  const hasCenterKw = CENTER_RE.test(text);
  // A-2: 지번주소 판별 — 도로명(로/길/대로)+번호가 없으면 지번 → 읍/면 보존
  const hasRoadName = /[가-힣\d]+(대로|로|길)\s*\d/.test(text);

  // ── A-5 + A-20: 지역 접두어 제거 ────────────────────────────────
  // 도로명·지번(동+숫자, 리+숫자) 발견 시 제거 중단
  const tokens   = text.split(/\s+/).filter(Boolean);
  const kept     = [];
  let stopRemove = false;
  for (let i = 0; i < tokens.length; i++) {
    const t     = tokens[i];
    const nextT = tokens[i + 1] || '';
    if (stopRemove) { kept.push(t); continue; }

    const isRoad    = /(로|길|대로)$/.test(t)
                   || (/(로|길|대로)/.test(t) && /^\d/.test(nextT))
                   || /(로|길|대로)\d+/.test(t);
    // A-20: 리(里)를 isJibun에 추가하여 신남리 123 같은 지번주소에서 stopRemove 작동
    const isJibun   = /[가-힣\d]+(동|읍|면|리)$/.test(t) && /^\d+(-\d+)?/.test(nextT);
    const isDongNum = /[가-힣\d]+(동|읍|면|리)\d+(-\d+)?/.test(t);
    if (isRoad || isJibun || isDongNum) { stopRemove = true; kept.push(t); continue; }

    const isRegion     = REGION_TOKEN_RE.test(t) || KNOWN_CITY_RE.test(t);
    // 주민센터 주소의 동·읍·면 토큰 삭제 금지
    const isCenterDong = isRegion && /[동읍면리]$/.test(t) && (hasCenterKw || CENTER_RE.test(nextT));
    // A-2: 도로명(로/길/대로)이 없는 지번·건물명 주소면 읍/면/동(법정동) 보존
    // 광덕면 신흥리 123 → 광덕면 유지 / 용두동 행복아파트 → 용두동 유지 (동 손실·오매칭 방지)
    const isEmdInJibun = !hasRoadName && /[가-힣]{2,}(읍|면|동)$/.test(t);
    if (!isRegion || isCenterDong || isEmdInJibun) kept.push(t);
  }
  text = kept.join(' ');

  // ── 괄호 내부 보호 (쉼표 분리 전) — depth 인식 (P0, 형 지시 2026-07-30 · 되돌리지 말 것) ──
  //   예전 non-greedy `/\(.*?\)/` 는 중첩 괄호(`(호매실동, 엔루체(NLUCE))`)를 중간에서 끊어
  //   바깥 ')' 를 텍스트에 잔류시켰고, A-28이 그 ')' 를 무조건 지워 내용이 유실됐다.
  //   재정제할 때마다 잔재가 쌓여 같은 건물의 표기가 갈렸다(실측 743건).
  //   protectParenBlocks는 중첩 전체를 한 블록으로 보호한다.
  const { text: protectedText, blocks: parens } = protectParenBlocks(text);
  text = protectedText;
  // A-28: 보호를 통과하고 남은 ')' 는 짝 없는 것뿐이므로 그것만 제거한다(균형 괄호는 __P__ 로 보호됨).
  text = text.replace(/\)/g, '');

  // ── 본주소 / 상세주소 분리 ────────────────────────────────────────
  let mainAddr = '', detailAddr = '';
  const officialRoadParts = parseOfficialRoadAddressText(text);
  if (officialRoadParts) {
    mainAddr = officialRoadParts.searchAddress;
    detailAddr = officialRoadParts.detail;
    if (officialRoadParts.inferenceReason) {
      result.주소추정 = true;
      result.추정사유 = appendUniqueNote(result.추정사유, officialRoadParts.inferenceReason);
    }
  } else {
    mainAddr = text.replace(/\s+/g, ' ').trim();
  }

  // 도로명–번호 사이 공백 누락 보정 ("테헤란로123" → "테헤란로 123")
  // ※ 숫자 바로 뒤에 한글이 오면 번길·가길 계열 → 공백 추가 제외
  mainAddr = normalizeRoadAddressSpacing(mainAddr)
    .replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))(\d+)(?![가-힣])/g, '$1 $3')
    .replace(/([가-힣]+(대로|로|길|번길|번가길|가길|나길|다길))\s{2,}(\d+)(?![가-힣])/g, '$1 $3')
    // 로/대로/길 뒤 공백+숫자+길 계열 → 붙여쓰기
    // "사가정로 2길" → "사가정로2길", "답십리로 32길" → "답십리로32길"
    // "XX로 14번길" → "XX로14번길", "XX로 3가길" → "XX로3가길"
    .replace(/([가-힣]+(대로|로|길))\s+(\d+[가-힣]*길)/g, '$1$3');

  // 마지막 토큰이 상세주소 성격이면 분리
  // 분리 조건: 숫자로 시작하지 않는 문자열 OR 숫자+호(방호수) 패턴
  if (!detailAddr && mainAddr.includes(' ')) {
    const parts    = mainAddr.split(' ');
    const last     = parts[parts.length - 1];
    const isHoSuffix = /^\d+호$/.test(last); // "456호" 형태 → 상세주소
    if ((!(/^\d/.test(last)) || isHoSuffix) && !CENTER_RE.test(last) && !last.includes('__P')) {
      detailAddr = parts.pop();
      mainAddr   = parts.join(' ');
    }
  }

  // 도로명+건물번호 뒤에 건물명이 붙은 경우 API 검색어에서는 건물명을 분리한다.
  // 예: "황물로 71 마이룸고시텔" → 검색 "황물로 71", 표시 괄호 건물명 "마이룸고시텔"
  let inlineBuildingName = officialRoadParts?.inlineBuildingName || '';
  const inlineRoadMatch = mainAddr
    .replace(/__P\d+__/g, '')
    .trim()
    .match(/^(.+?(?:대로|로|길)[가-힣\d]*\s*\d+(?:-\d+)?)(?:\s+(.+))?$/);
  const inlineRoadOnly = inlineRoadMatch?.[1]?.trim() || '';
  const inlineTail = inlineRoadMatch?.[2]?.trim() || '';
  if (inlineRoadOnly && inlineTail && !CENTER_RE.test(inlineTail)) {
    // 상세주소(동/호/층) 또는 빌라 동(棟: 가동·B동·에이동)이면 건물명이 아니라 상세주소 — 동 손실 방지
    const tailIsDetail = /\d+\s*(동|호|층)/.test(inlineTail)        // 101호·103동·가동 101호의 숫자
      || /[가-힣A-Za-z]+동(?:\s|$)/.test(inlineTail)                // 가동·나동·B동·에이동 (단독/선두)
      || /^\d+\s*(동|호|층)$/.test(inlineTail);
    if (tailIsDetail) {
      // 동(棟)+호수는 상세주소로 보존 (mainAddr는 도로명만 남겨 API 검색 정확도 유지)
      detailAddr = `${inlineTail.replace(/__P\d+__/g, '').trim()} ${detailAddr}`.replace(/\s+/g, ' ').trim();
      mainAddr   = inlineRoadOnly;
    } else {
      inlineBuildingName = inlineTail.replace(/__P\d+__/g, '').trim();
    }
  }

  // ── A-13: API 조회 — 시/구 컨텍스트 포함으로 오지역 매칭 방지 ──────
  // "왕산로 72" 같은 도로명이 전국 여러 곳에 존재할 때 틀린 지역 반환 방지
  // cityLabel에서 가장 하위 시·군·구 토큰을 추출해 검색 앞에 붙임
  // 예: "동대문구 왕산로 72" → 서울 동대문구 결과만 반환
  const baseSearch   = mainAddr.replace(/__P\d+__/g, '').trim();
  const searchBases  = [inlineRoadOnly || '', baseSearch].filter((v, i, arr) => v && arr.indexOf(v) === i);
  const districtTok  = cityLabel
    ? (cityLabel.trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '')
    : '';
  let apiResult = null;
  for (const s of searchBases) {
    const searchKeyword = districtTok ? `${districtTok} ${s}` : s;
    apiResult = await io.lookupAddr(searchKeyword, cityLabel);
    if (!apiResult && districtTok) apiResult = await io.lookupAddr(s, cityLabel); // districtTok 포함 실패 시 원문 재시도
    if (apiResult) break;
  }

  // ── Fallback A: 주민센터·행정복지센터·읍·면·동사무소 ───────────────
  if (!apiResult && CENTER_RE.test(text)) {
    // 주민센터 정의: 지자체(시군구) + 행정동 + 주민센터. smartKw가 이미 "{시군구} {행정동} 주민센터".
    const smartKw = generateCenterKeyword(text, adminDong, cityLabel);
    const sgg = extractSigungu(cityLabel);
    const sggPfx = sgg ? `${sgg} ` : (cityLabel ? `${cityLabel.trim().split(/\s+/).pop()} ` : '');
    const dong = adminDong?.trim();
    // 지자체+행정동 + (주민센터/행정복지센터/동사무소…) 변형 — 모두 시군구 접두어 강제
    const centerQueries = [
      smartKw,
      ...(dong ? CENTER_KWDS.map(kw => `${sggPfx}${dong} ${kw}`) : []),
      smartKw.replace(/주민센터/, '행정복지센터'),
    ].filter((q, i, arr) => q && arr.indexOf(q) === i);
    for (const q of centerQueries) {
      apiResult = await io.lookupAddr(q, cityLabel);
      if (apiResult) break;
    }
    // 최후 수단: Kakao POI → 도로명 취득 → JUSO 재조회 (JUSO 미인덱스 대응)
    if (!apiResult) {
      const localPfx = cityLabel ? cityLabel.trim().split(/\s+/).pop() + ' ' : '';
      const queries  = [
        adminDong ? `${localPfx}${adminDong.trim()} 주민센터`    : smartKw,
        adminDong ? `${localPfx}${adminDong.trim()} 행정복지센터` : null,
      ].filter(Boolean);
      for (const q of queries) {
        const kd = await io.searchKakaoFull(q);
        if (kd?.road_address_name) {
          apiResult = await io.lookupAddr(kd.road_address_name, cityLabel)
            || (kakaoDocInMunicipality(kd, cityLabel) ? kakaoDocToApiResult(kd) : null);
          if (apiResult) break;
        }
      }
    }
  }

  // ── Fallback B (A-8): 건물명 전용 (도로명·지번 없음) ─────────────
  // A-31 확장: 행정동 컬럼이 없어도 지자체(cityLabel)만으로 시도한다. 예전엔 adminDong이
  // 없으면 이 경로 자체를 건너뛰어, 명단에 아파트명·학교·우체국만 적힌 행이 전부 미매칭이었다.
  if (!apiResult && (adminDong || cityLabel)) {
    const hasRoadOrJibun = /(로|길|대로)\s*\d/.test(text) || /[가-힣\d]+(동|읍|면|리)\s*\d+/.test(text);
    // A-31: 건물 유형어(아파트·빌라…)가 없어도 시도한다. 실제 명단에는 유형어 없는 건물명이
    // 많다(더존에이스빌·동광팰리스·숲예찬·서울장안동우체국 등) — 예전엔 전부 미매칭이었다.
    // 대신 유형어가 없으면 Kakao POI 이름이 입력과 일치할 때만 채택한다(엉뚱한 장소 매칭 차단).
    if (!hasRoadOrJibun) {
      const needNameMatch = !BLDG_TYPE_RE.test(text);
      // A-31: 동호수 절단은 '공백/문두 + 숫자 + 동·층·호' 이고 뒤에 한글이 안 붙을 때만.
      // 예전 패턴(\d+\s*(동|층|호).*$)은 건물명 속 숫자동까지 잘라
      //   "서울장안2동우체국"→"서울장안", "신내1동우편취급국"→"신내" 로 망가뜨려 매칭을 놓쳤다.
      const bldName = text.replace(/(^|[\s,])\d+\s*(동|층|호)(?![가-힣]).*$/g, '').replace(/__P\d+__/g, '').trim();
      if (bldName.length >= 2) {
        const dongTok = adminDong?.trim() || '';
        const districtTokForBld = cityLabel
          ? (cityLabel.trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '')
          : '';
        const buildingQueries = [
          cityLabel && dongTok ? `${cityLabel.trim()} ${dongTok} ${bldName}` : '',
          districtTokForBld && dongTok ? `${districtTokForBld} ${dongTok} ${bldName}` : '',
          dongTok ? `${dongTok} ${bldName}` : '',
          cityLabel ? `${cityLabel.trim()} ${bldName}` : '',
          districtTokForBld ? `${districtTokForBld} ${bldName}` : '',
        ].filter((q, i, arr) => q && arr.indexOf(q) === i);
        for (const q of buildingQueries) {
          apiResult = await io.lookupAddr(q, cityLabel);
          if (apiResult) break;
        }
        // 전국 주소DB가 건물명을 못 찾으면 Kakao POI로 도로명주소를 얻어 재조회한다.
        // (주소DB는 건물명 인덱스가 약하고, 콜드스타트 지연으로 실패하는 일도 잦다)
        if (!apiResult) {
          const bldKey = normalizePlaceKey(bldName);
          for (const q of buildingQueries) {
            const kd = await io.searchKakaoFull(q);
            if (!kd?.road_address_name) continue;
            if (!kakaoDocInMunicipality(kd, cityLabel)) continue;   // A-30 지역검증
            if (needNameMatch) {
              // 유형어 없는 자유 건물명 → 이름이 서로 포함관계일 때만 신뢰
              const placeKey = normalizePlaceKey(kd.place_name);
              if (!placeKey || !(placeKey.includes(bldKey) || bldKey.includes(placeKey))) continue;
            }
            apiResult = await io.lookupAddr(kd.road_address_name, cityLabel) || kakaoDocToApiResult(kd);
            if (apiResult) break;
          }
        }
      }
    }
  }

  // ── 결과 조립 ─────────────────────────────────────────────────────
  result.도 = DO_PATTERN.exec(text)?.[1] || '';

  let dongPart = '', buildingName = '', finalRoadAddr = mainAddr;
  // ── A-37 보조 (2026-08-23 · 형 지적 "에이동·비동·씨동·에이치동이 읍면동으로 인식") ──
  // 토큰이 음역 건물동(棟)인가 — ambiguous 음역(이·지·오·유)은 src 안에서 그 토큰 뒤에 N호가 따라야 건물동.
  const isBldgDongTok = (tok, src) => {
    const t = String(tok || '').trim();
    const i = String(src || '').indexOf(t);
    return isTranslitBuildingDong(t, i >= 0 ? String(src).slice(i + t.length) : '');
  };
  // 건물명 슬롯으로 못 가는 괄호 문구의 끝에 건물 동(棟)[+호]이 있으면 상세주소로 건진다(버리면 동이 통째로 사라진다).
  // ★guarded — 괄호엔 법정동·행정동이 흔하므로 `답십리2동`의 `2동`·`장안동 201호`의 `안동 201호`를 잘라내지 않도록
  //   동 토큰 앞에 공백·콤마·시작 경계를 요구한다(A-29의 건물명 경로와 달리).
  const salvageBuildingDong = (text) => {
    const split = splitBuildingDongTail(text, { guarded: true });
    if (!split || detailAddr.includes(split.dong)) return;
    detailAddr = `${split.dong} ${detailAddr}`.replace(/\s+/g, ' ').trim();
  };

  // ── 입력 건물번호 SSOT 가드 (유사매칭/변조 차단 · 절대 되돌리지 말 것) ──
  // 입력이 도로명주소이고 API 결과의 도로명 뒤 건물번호가 입력과 다르면 → API 결과 전부 폐기.
  // 도로명주소 건물번호는 절대 불변(이동·빈칸·법정동/건물명 보완만 허용). 서버 근사매칭이 뚫려도 여기서 최종 차단.
  // 예: 입력 "박석로25번길 32" → API "박석로25번길 32-5"(인접 부번 건물) 반환 시, 32-5·신한타운 모두 거부하고 원본 32 유지.
  if (apiResult && officialRoadParts && officialRoadParts.mainNo) {
    const inputNo = `${officialRoadParts.mainNo}${officialRoadParts.subNo ? '-' + officialRoadParts.subNo : ''}`;
    const rn = officialRoadParts.roadName || '';
    const cleanFinal = String(apiResult.roadAddrPart1 || '').replace(/\s+/g, '');
    const idx = rn ? cleanFinal.indexOf(rn) : -1;
    const apiNo = idx >= 0 ? (cleanFinal.slice(idx + rn.length).match(/^(\d+(?:-\d+)?)/)?.[1] || '') : '';
    if (apiNo && apiNo !== inputNo) {
      appendCheckReason(result, `도로명 건물번호 불일치(입력 ${inputNo} ≠ API ${apiNo}) — 유사매칭 거부, 원본 주소 유지`);
      apiResult = null; // API 결과 폐기 → 아래 else(원본 입력 유지) 경로로
    }
  }

  if (apiResult) {
    const rawFinal = apiResult.roadAddrPart1 || mainAddr;
    result.도 = DO_PATTERN.exec(rawFinal)?.[1] || result.도;

    const rParts = rawFinal.split(/\s+/);
    let keepIdx = 0;
    for (let i = 0; i < rParts.length; i++) {
      // 시도/시군구 토큰 제거 (축약 도명 '경기'·'충남' 등 포함 — 카카오 폴백 대응). 읍/면/동은 dongPart로 별도 처리.
      if (REGION_SUFFIX.test(rParts[i]) || REGION_LEAD.test(rParts[i])) keepIdx = i + 1; else break;
    }
    let remain = rParts.slice(keepIdx);
    if (remain.length > 0 && DONG_SUFFIX.test(remain[0])) dongPart = remain.shift();
    finalRoadAddr = remain.join(' ') || rawFinal;

    // ── A-24(개정): 괄호 동명은 '법정동'이 최우선 (절대 되돌리지 말 것) ──
    // 괄호 `()` 안은 법정동이어야 한다. 도로명주소(roadAddrPart1)에는 동(洞) 토큰이 없는
    // 경우가 대부분이라, 예전 우선순위(도로명 토큰 → adminDong → emdNm)에서는 사실상
    // adminDong(행정동 컬럼)이 채택돼 괄호에 행정동이 들어갔다.
    // 이제 주소DB가 확인한 법정동(legalDong/emdNm)을 무조건 먼저 쓴다.
    const apiLegalDong = String(apiResult.legalDong || apiResult.emdNm || '').trim();
    if (apiLegalDong && LEGAL_DONG_RE.test(apiLegalDong)) dongPart = apiLegalDong;

    // ── dongPart 오지역 보정 ──────────────────────────────────────────
    // 도시(시/구) 지역인데 API가 '면'을 반환하면 오매칭으로 간주
    // 예: 서울 동대문구인데 dongPart='왕산면' → adminDong(용두동)으로 대체
    if (dongPart.endsWith('면') && cityLabel) {
      const lastTok = cityLabel.trim().split(/\s+/).pop() || '';
      const isUrban = /(특별시|광역시|특별자치시|시$|구$)/.test(lastTok);
      if (isUrban) {
        dongPart = (adminDong?.trim() && DONG_SUFFIX.test(adminDong.trim()))
          ? adminDong.trim()
          : '';
      }
    }
    // 법정동을 끝내 못 얻었을 때만 adminDong(행정동 컬럼) 폴백 — 괄호 공란 방지용 최후수단
    if (!dongPart && adminDong?.trim() && DONG_SUFFIX.test(adminDong.trim())) {
      dongPart = adminDong.trim();
    }
    // A-27: 행정동 번호 접미어 제거 — 도로명주소 () 내 동명은 법정동(번호 없음) 표기
    // 예: 답십리2동 → 답십리동, 청량리3동 → 청량리동, 신설1동 → 신설동
    if (dongPart) dongPart = dongPart.replace(/^([가-힣]+)\d+(동)$/, '$1$2');

    buildingName = apiResult.bdNm || inlineBuildingName || '';
    // 무손실(M-1): API 건물명(bdNm)이 채택되면서 버려지던 입력 문구를 특이사항으로 보존한다.
    // 예 "왕산로 72 뒷문으로 들어와서 계단 오른쪽" → 배송 안내가 통째로 사라지던 문제.
    // 단 채택된 건물명과 서로 포함관계면(같은 건물의 다른 표기) 중복이므로 넣지 않는다.
    if (inlineBuildingName && inlineBuildingName !== buildingName) {
      const keptKey = normalizePlaceKey(buildingName);
      const dropKey = normalizePlaceKey(inlineBuildingName);
      if (dropKey && !(keptKey && (keptKey.includes(dropKey) || dropKey.includes(keptKey)))) {
        result.특이사항 = appendUniqueNote(result.특이사항, inlineBuildingName);
      }
    }
    // 괄호 분류: 긴 문장(3단어↑ or 10자↑+공백) → 특이사항, 동명 토큰 → 제거, 나머지 → buildingName
    parens.forEach(p => {
      const inner = p.replace(/^\(|\)$/g, '').trim();
      if (!inner) return;
      // 주소 괄호(법정동+건물명)는 특이사항으로 보내지 않는다 — 법정동 토큰(OO동/읍/면) 포함 시 주소괄호로 간주.
      const isAddrParen = /[가-힣]{2,}\d*(읍|면|동)(?![가-힣])/.test(inner);
      const wordCount = inner.split(/\s+/).length;
      if (!isAddrParen && (wordCount >= 3 || (inner.length >= 10 && /\s/.test(inner)))) {
        result.특이사항 += (result.특이사항 ? ' ' : '') + inner;
        return;
      }
      if (!buildingName) {
        // A-26 동명 토큰 제거 — 단 A-37 음역 건물동(에이동 …)은 법정동이 아니므로 남긴다(아래 A-29가 상세로 보낸다)
        const toks = inner.split(/[,\s]+/)
          .filter(tok => tok && !(/^[가-힣][가-힣\d]*(읍|면|동)$/.test(tok.trim()) && !isBldgDongTok(tok, inner)));
        const candidate = toks.join(' ').trim();
        if (candidate) buildingName = candidate;
      } else {
        // A-37: 건물명이 이미 있어 괄호를 버리는 경우에도 괄호 끝의 건물 동(棟)[+호]은 상세주소로 건진다
        //   (예 주소DB bdNm 채택 후 "(행복빌라 에이동)" → 에이동이 통째로 사라지던 손실 차단)
        salvageBuildingDong(inner);
      }
    });
    detailAddr = detailAddr.replace(/__P\d+__/g, '').replace(/\s+/g, ' ').trim();
    // mainAddr에서 도로명+번호 이후 내용(지층·호 등)을 detailAddr로 이동 (A-11 쉼표 누락 방지)
    if (!detailAddr) {
      const mainClean = mainAddr.replace(/__P\d+__/g, '').replace(/\s+/g, ' ').trim();
      const roadNumMatch = mainClean.match(/^[가-힣\d]+(대로|로|길)[가-힣\d]*\s*\d+(?:-\d+)?\s+(.*)/);
      if (roadNumMatch?.[2]) detailAddr = roadNumMatch[2].trim();
      // 폴백: 도로명 오타(로/길 누락, 예 "대실남북82,401동104호")로 위 매칭 실패 시
      //   콤마 뒤 동/호 패턴을 상세로 보존 (DB는 매칭됐는데 상세가 버려지는 손실 차단)
      else {
        const cm = mainClean.match(/[,\s]\s*((?:\d+(?:-\d+)?|[A-Za-z]|[가나다라마바사아자차카타파하])?동?\s*\d*\s*호?.*)$/);
        const afterComma = mainClean.includes(',') ? mainClean.slice(mainClean.indexOf(',') + 1).trim() : '';
        const cand = (afterComma && /\d+\s*호|\d+\s*동/.test(afterComma)) ? afterComma : (cm?.[1] || '');
        if (cand && /\d+\s*호|\d+\s*동/.test(cand)) detailAddr = cand.replace(/^[,\s]+/, '').trim();
      }
    }
  } else {
    // ── A-12 ②: 도로명 미발견 + API 실패 플래그 ─────────────────────
    if (!/(로|길|대로)/.test(finalRoadAddr)) {
      result.확인필요 = true;
      result.확인사유 = '도로명 미발견 및 API 변환 실패';
    }
    // 괄호에서 dong/building/특이사항 추출 후 도로명 이후 내용 → detailAddr 이동
    parens.forEach((p, i) => {
      const inner = p.replace(/^\(|\)$/g, '').trim();
      const wordCount = inner ? inner.split(/\s+/).length : 0;
      if (!inner) {
        finalRoadAddr = finalRoadAddr.replace(`__P${i}__`, '');
        detailAddr    = detailAddr.replace(`__P${i}__`, '');
        return;
      }
      const isAddrParen = /[가-힣]{2,}\d*(읍|면|동)(?![가-힣])/.test(inner);
      if (!isAddrParen && (wordCount >= 3 || (inner.length >= 10 && /\s/.test(inner)))) {
        result.특이사항 += (result.특이사항 ? ' ' : '') + inner;
      } else if (!dongPart && DONG_SUFFIX.test(inner) && !isBldgDongTok(inner, inner)) {
        // A-37: `(에이동)`은 법정동이 아니라 건물 동 — dongPart로 올리지 않고 건물명 슬롯 → A-29가 상세로 보낸다
        dongPart = inner.replace(/^([가-힣]+)\d+(동)$/, '$1$2');
      } else if (!dongPart) {
        const dongTok = inner.split(/[,\s]+/).find(t => DONG_SUFFIX.test(t.trim()) && !isBldgDongTok(t, inner));
        if (dongTok) {
          dongPart = dongTok.trim().replace(/^([가-힣]+)\d+(동)$/, '$1$2');
          const rest = inner.replace(dongTok, '').replace(/^[,\s]+|[,\s]+$/g, '').trim();
          if (rest && !buildingName) buildingName = rest;
          else if (rest) salvageBuildingDong(rest);   // A-37: 건물명이 이미 있어도 건물 동은 상세로
        } else if (!buildingName) {
          buildingName = inner;
        } else {
          salvageBuildingDong(inner);
        }
      } else if (!buildingName) {
        buildingName = inner;
      } else {
        salvageBuildingDong(inner);
      }
      finalRoadAddr = finalRoadAddr.replace(`__P${i}__`, '');
      detailAddr    = detailAddr.replace(`__P${i}__`, '');
    });
    if (!detailAddr) {
      const mainCleanNA = finalRoadAddr.replace(/\s+/g, ' ').trim();
      const roadMatchNA = mainCleanNA.match(/^([가-힣\d]+(대로|로|길)[가-힣\d]*\s*\d+(?:-\d+)?)\s+(.*)/);
      if (roadMatchNA?.[3]) {
        detailAddr    = roadMatchNA[3].trim();
        finalRoadAddr = roadMatchNA[1];
      }
    }
    if (!buildingName && inlineBuildingName) {
      buildingName = inlineBuildingName;
      if (inlineRoadOnly) finalRoadAddr = inlineRoadOnly;
    }
    finalRoadAddr = finalRoadAddr.replace(/\s+/g, ' ').trim();
    detailAddr    = detailAddr.replace(/\s+/g, ' ').trim();
  }

  // ── 버그수정 #3/#4: 괄호(건물명)에서 건물 동(棟) 분리 → 상세주소로 이동 ──
  // 괄호 `()` 는 (법정동, 건물명)만 담는다. 빌라/아파트 건물 동(가동·B동·101동 등)이
  // bdNm/inline으로 buildingName에 섞이면, 같은 "101동"이 어떤 건 괄호(미변환)·어떤 건
  // 상세(A-10 대시변환)로 갈려 표기가 뒤죽박죽된다. 건물 동은 항상 detailAddr로 보내
  // A-10이 일관 정규화하도록 한다(법정동 dongPart·진짜 건물명은 보존).
  if (buildingName) {
    // 끝에 붙은 건물 동(棟)[+호] 분리 — 규칙은 dongTokens.js `splitBuildingDongTail`(SSOT, A-37 음역동 포함):
    //  - 숫자동(101동)·영문동(B동)·음역동(에이동·비동 …)은 호수 동반 무관하게 건물 동으로 확정
    //  - 단일 한글동(가동·나동)은 "호수 동반" 시에만 — 법정동(사동·본동 등) 오인 방지
    //  - 앞 건물명은 보존: "푸르지오 101동" → 상세 "101동" / 괄호 건물명 "푸르지오"
    const split = splitBuildingDongTail(buildingName);
    if (split) {
      detailAddr = `${split.dong} ${detailAddr}`.replace(/\s+/g, ' ').trim();
      buildingName = split.head;
    }
  }

  // 버그수정: 건물명 슬롯이 전화번호면 특이사항으로 이동(주소 괄호 오염 차단)
  if (buildingName && PHONE_IN_ADDR_RE.test(buildingName.replace(/\s/g, ''))) {
    const ph = buildingName.trim();
    result.특이사항 = appendUniqueNote(result.특이사항, ph);
    buildingName = '';
  }

  let finalDetail = detailAddr;

  // ── finalDetail 전처리 (A-18 → A-19 → A-17 → A-10 순서) ─────────

  // A-18: 제(第) 접두어 제거 — 제101동 → 101동, 제205호 → 205호, 제3층 → 3층
  finalDetail = finalDetail.replace(/제\s*(\d+)\s*(동|호|층)\b/g, '$1$2');

  // A-19: 동호 붙여쓰기 분리 — 101동205호 → 101동 205호 (A-10에서 대시로 변환)
  finalDetail = finalDetail
    .replace(/([가-힣A-Za-z\d-]+동)(\d+호)/g, '$1 $2')
    .replace(/([가-힣A-Za-z\d]+호)(\d+층)/g, '$1 $2');

  // A-17: 층/F 표기 변환 제거 — B동·F동 등 건물동 명칭과 혼동 오탐 발생
  // (3F→3층, B1→지하1층 모두 적용 안 함)

  // A-10: 동호 형식 정규화 (순수함수 src/engine/dongHoFormat.js — 회귀 scripts/dong-ho-format.test.mjs)
  //   숫자 동(대단지 아파트) → 대시 + 호수 4자리 패딩 + 층은 호 뒤로: "101동 3층 203호" → "101- 203호 3층"
  //   비숫자 동(빌라·연립 가동·A동·1-1동) → "동" 유지 + **층 위치 원본 보존**: "가동 3층 101호" 그대로
  //   동 없음 → 층 그대로 + 호수만 4자리 우측정렬 패딩
  //   대시로 쓰인 숫자 동(101-203호) → 숫자 동과 동일 형식으로 저장
  finalDetail = normalizeDongHoDetail(finalDetail);

  // A-9 2차: 상세주소에 남아있는 특수문자 재처리
  if (dicts.specialCharRegex) {
    const spMatch2 = finalDetail.match(dicts.specialCharRegex);
    if (spMatch2) {
      const matchPos2   = finalDetail.indexOf(spMatch2[0]);
      const matchChar2  = spMatch2[1];
      const isJibunSlash2 = matchChar2 === '/'
        && matchPos2 > 0
        && /\d$/.test(finalDetail[matchPos2 - 1])
        && /^\d/.test(spMatch2[2]);
      if (!isJibunSlash2) {
        const note2 = spMatch2[2].trim();
        if (note2) result.특이사항 += (result.특이사항 ? ' ' : '') + note2;
        finalDetail = finalDetail.slice(0, matchPos2).trim();
      }
    }
  }

  finalDetail = normalizeAddressDetail(finalDetail);
  finalDetail = dedupeDetailTokens(finalDetail);   // 원본 오타로 상세가 두 번 들어간 경우 1개로 정리

  if (correctionLogs.length) {
    result.주소추정 = true;
    result.추정사유 = appendUniqueNote(result.추정사유, correctionLogs.join(' / '));
  }
  if (result.추정사유) {
    result.특이사항 = appendUniqueNote(result.특이사항, `[주소추정] ${result.추정사유}`);
  }

  // ── A-31: 법정동 빠짐 방지 보강조회 (형 지시 2026-07-21 · 절대 되돌리지 말 것) ──
  // 여기까지 와서 법정동을 못 얻었으면(=괄호가 비거나 행정동 폴백이면), 확정된 도로명주소로
  // 주소DB를 한 번 더 조회해 '실제 법정동'을 받아 채운다. 실패할 때만 기존 값을 유지한다.
  // lookupAddr이 부정 캐시까지 들고 있어 같은 주소가 반복돼도 추가 호출은 1회뿐이다.
  let legalDong = String(apiResult?.legalDong || apiResult?.emdNm || '').trim();
  // 읍/면만 온 경우(예 "홍북읍")는 법정리까지 있어야 완전하다 — 리는 정렬·기사배정 단위(§6)라
  // "홍북읍 신경리"로 보강한다. 보강 실패 시 "홍북읍"을 그대로 유지(퇴행 없음).
  const isBareEupMyeon = /^[가-힣\d]+(?:읍|면)$/.test(legalDong);
  if ((!legalDong || isBareEupMyeon) && finalRoadAddr && finalRoadAddr.trim().length >= 4) {
    // ① Kakao 주소검색 우선 — 전국 주소DB(address-service)는 응답이 느려(20초+) 3초 타임아웃에
    //    걸리는 일이 잦다. Kakao는 수백 ms 안에 법정동을 준다(형 지시 2026-07-21).
    const kl = await io.fetchKakaoLegalDong(finalRoadAddr, cityLabel);
    // 읍/면 보강 시에는 '더 구체적인 값(리 포함)'일 때만 교체 — 덮어써서 정보가 줄면 안 된다.
    if (kl?.legalDong && (!legalDong || /리$/.test(kl.legalDong))) {
      legalDong = kl.legalDong;
      if (!buildingName && kl.buildingName) buildingName = kl.buildingName;
    } else if (!legalDong && /(대로|로|길)\s*\d/.test(finalRoadAddr)) {
      // ② Kakao도 못 찾으면 전국 주소DB 재조회(캐시로 1회만 — 부정 캐시가 재난타를 막는다)
      const sggPfx = extractSigungu(cityLabel) || (cityLabel || '').trim().split(/\s+/).pop() || '';
      const probe  = await io.lookupAddr(`${sggPfx ? `${sggPfx} ` : ''}${finalRoadAddr}`.trim(), cityLabel);
      const probed = String(probe?.legalDong || probe?.emdNm || '').trim();
      if (probed) {
        legalDong = probed;
        if (!buildingName && probe?.bdNm) buildingName = probe.bdNm;
      }
    }
  }
  // ③ 그래도 없으면 지번주소 자체에서 법정동을 취한다 — 지번주소의 동/리는 정의상 법정동이므로
  //    API 없이도 확정할 수 있다(예 "장곡동 344"→장곡동, "상봉동 126-39"→상봉동).
  //    Kakao·주소DB에 미등재된 번지에서도 법정동이 빠지지 않게 하는 최종 방어선.
  if (!legalDong) {
    const jibunTok = String(finalRoadAddr || '').trim().match(/^([가-힣][가-힣\d]*(?:동|리|가))\s+산?\s*\d/);
    const tok = jibunTok?.[1] ? jibunTok[1].replace(/^([가-힣]+)\d+(동)$/, '$1$2') : '';
    // A-37: `에이동 201호`처럼 건물 동이 앞에 선 문자열을 지번으로 오인해 법정동에 넣지 않는다(이동 123-4 같은 실존 법정동은 유지)
    if (tok && LEGAL_DONG_RE.test(tok) && !isTranslitBuildingDong(tok, String(finalRoadAddr || '').trim().slice(tok.length))) legalDong = tok;
  }

  // 법정동을 얻었으면 괄호 동명은 무조건 법정동으로 교체(행정동 폴백값이 남아 있어도 덮어쓴다)
  if (legalDong && LEGAL_DONG_RE.test(legalDong)) {
    dongPart = legalDong.replace(/^([가-힣]+)\d+(동)$/, '$1$2');
  }

  // ── A-11: 최종 주소 형식 조합 ─────────────────────────────────────
  // 표준(형 지시 2026-07-30 · 건물명은 맨 뒤): "도로명주소(건물번호까지), 상세주소 (법정동, 건물명)"
  //   예) "권선로 472, 101- 203호 3층 (권선동, 래미안)" — 상세(동호수)가 먼저, 괄호(법정동·건물명)가 마지막.
  // 도로명주소 바로 뒤 첫 구분자는 ","를 유지한다.
  // 이후 추가 구분이 필요하면 "/"를 쓰고, 괄호 내부의 법정동·건물명 구분 콤마는 예외로 유지한다.
  // 명단에 적힌 상세/부가 내용은 삭제하지 않고 finalDetail 또는 특이사항으로 보존한다.
  // P0: 건물명의 괄호 짝이 깨져 있으면(원본·DB 유래) 조립 시 전체 괄호 구조가 붕괴한다.
  //   짝 맞는 괄호는 그대로 보존(`호매실 엔루체(NLUCE)`), 짝 없는 기호만 제거해 내용은 살린다.
  const parenParts  = [dongPart, balanceParens(buildingName)].filter(Boolean);
  const parenInner  = parenParts.join(', ').replace(/,\s*$/, '').trim();
  const parenStr    = parenInner ? `(${parenInner})` : '';

  // A-11 형식: "도로명주소, 상세주소 (법정동, 건물명)" (상세 먼저, 괄호 마지막)
  result.주소 = finalRoadAddr || '';
  if (finalDetail) {
    // 도로명 뒤 첫 구분자는 쉼표 (A-11). 상세주소를 쉼표로 붙임.
    result.주소 += result.주소 ? `${ROAD_DETAIL_SEPARATOR}${finalDetail}` : finalDetail;
    if (parenStr) result.주소 += ` ${parenStr}`;          // 상세 뒤 공백 + (법정동, 건물명)
  } else if (parenStr) {
    // 상세 없으면 "도로명, (법정동, 건물명)"
    result.주소 += result.주소 ? `${ROAD_DETAIL_SEPARATOR}${parenStr}` : parenStr;
  }

  // ── 3분할 주소 노출 (기본명단 3컬럼 저장·도로명주소 비교용) ─────────
  // 도로명주소(콤마 앞) / 상세주소(동호수) / 괄호정보(법정동, 건물명). 표시 함수 parseDisplayedAddress 와 동일 분할.
  result.도로명주소 = finalRoadAddr || '';
  result.상세주소   = finalDetail || '';
  result.괄호정보   = parenInner || '';   // "법정동, 건물명" (괄호 기호 제외 내부 텍스트)

  // ── A-12 ③: 변환 후 주소 3자 미만 플래그 ────────────────────────
  if (result.주소.length < 3) {
    result.확인필요 = true;
    result.확인사유 = '변환 후 주소 비정상';
  }

  // ── A-22: 특이사항에 주민센터류 표현이 있으면 맨 뒤에 참고주소 붙이기 ──
  // 단, 주소 자체가 이미 주민센터 주소인 경우(CENTER_RE) 중복 방지
  if (normalizedInputNote && CENTER_RE.test(normalizedInputNote) && result.주소 && !CENTER_RE.test(text)) {
    const referenceDong = (adminDong || dongPart || '').trim();
    // A-13/A-22: 주민센터 검색어에 지자체(시군구) 접두어 강제 — 전국 동명(예: 시흥시 군자동 vs 서울 군자동) 오매칭 방지
    const districtPfx = (extractSigungu(cityLabel) || (cityLabel || '').trim().split(/\s+/).pop() || '').trim();
    const ckw = referenceDong
      ? `${districtPfx ? `${districtPfx} ` : ''}${referenceDong} 주민센터`
      : generateCenterKeyword(normalizedInputNote, adminDong, cityLabel);
    let cres = await io.lookupAddr(ckw, cityLabel);
    // JUSO 실패 시 Kakao POI 검색으로 주민센터 도로명 취득 후 재조회
    if (!cres) {
      const localPfx = cityLabel ? cityLabel.trim().split(/\s+/).pop() + ' ' : '';
      const queries = [
        ckw,
        referenceDong ? `${localPfx}${referenceDong} 주민센터` : null,
        referenceDong ? `${localPfx}${referenceDong} 행정복지센터` : null,
        adminDong?.trim() ? `${localPfx}${adminDong.trim()} 주민센터` : null,
        dongPart          ? `${localPfx}${dongPart} 주민센터`          : null,
      ].filter((q, i, arr) => q && arr.indexOf(q) === i);
      for (const q of queries) {
        const kd = await io.searchKakaoFull(q);
        if (kd?.road_address_name) {
          cres = await io.lookupAddr(kd.road_address_name, cityLabel)
            || (kakaoDocInMunicipality(kd, cityLabel) ? kakaoDocToApiResult(kd) : null);
          if (cres) break;
        }
      }
    }
    if (cres) {
      const cRaw = (cres.roadAddrPart1 || cres.roadAddr || '').trim();
      if (cRaw) {
        const cParts   = cRaw.split(/\s+/);
        let cKeepIdx   = 0;
        for (let i = 0; i < cParts.length; i++) {
          if (REGION_SUFFIX.test(cParts[i])) cKeepIdx = i + 1; else break;
        }
        const cRemain  = cParts.slice(cKeepIdx);
        let cDong      = '';
        if (cRemain.length > 0 && DONG_SUFFIX.test(cRemain[0])) cDong = cRemain.shift();
        const cRoadShort  = cRemain.join(' ');
        const cParenStr   = [cDong, cres.bdNm].filter(Boolean).length
          ? ` (${[cDong, cres.bdNm].filter(Boolean).join(', ')})` : '';
        const centerAddr  = cRoadShort + cParenStr;
        const centerLabel = `${referenceDong || cDong || '해당행정동'} 주민센터`;
        const centerSuffix = `[참고: ${centerLabel} ${centerAddr}]`;
        // 이미 같은 주민센터 주소가 있으면 중복 추가 금지
        if (centerAddr && cRoadShort.length >= 5 && !result.주소.includes(centerAddr)) {
          result.주소 = `${result.주소}${ADDRESS_EXTRA_SEPARATOR}${centerSuffix}`;
        }
      }
    }
  }

  // ── 지역 가드: 타지역 도로명 충돌 매칭 폐기 (예: 홍성 "문화로" → 인천 "부평문화로") ──
  // matchedSigungu가 비어도 standardRoadAddress/jibunAddr에서 시군구를 추출해 입력 지자체와 대조.
  // 다르면 매칭 자체를 폐기 → 타지역 좌표·법정동·리가 붙는 것을 원천 차단. 절대 되돌리지 말 것.
  let crossRegionRejected = false;
  if (apiResult && extractSigungu(cityLabel)) {
    // 실제 매칭된 주소 텍스트(standardRoadAddress/jibun)의 시군구를 '우선' 신뢰.
    // matchedSigungu/sggNm은 입력 지자체로 잘못 채워질 수 있어 후순위.
    const refAddr = apiResult.standardRoadAddress || apiResult.roadAddr || apiResult.jibunAddr || '';
    const mSido = extractSido(refAddr) || apiResult.matchedSido || apiResult.siNm || '';
    const mSgg  = extractSigungu(refAddr) || apiResult.matchedSigungu || apiResult.sggNm || '';
    const region = getMunicipalityMatch(cityLabel, mSido, mSgg);
    if (region.comparable && !region.ok) {
      apiResult = null;
      crossRegionRejected = true;
      legalDong = '';   // A-31: 폐기된 타지역 매칭의 법정동은 쓰지 않는다
    }
  }

  // ── 좌표 취득 (Kakao Geocoding) ──────────────────────────────────
  result.isApt = apiResult?.bdKdcd === '1';
  result.standardRoadAddress = apiResult?.standardRoadAddress || apiResult?.roadAddr || '';
  result.roadName = apiResult?.roadName || apiResult?.rn || '';
  result.buildingMainNo = apiResult?.buildingMainNo ?? apiResult?.buldMnnm ?? '';
  result.buildingSubNo = apiResult?.buildingSubNo ?? apiResult?.buldSlno ?? '';
  // A-31: 괄호에 실제로 표시된 건물명을 컬럼에도 그대로 넣는다. 예전엔 API(bdNm)에서 온 값만
  // 담아서, 입력 문장에서 뽑힌 건물명(래미안크레시티 등)은 괄호엔 보이는데 컬럼은 비어 있었다.
  result.buildingName = buildingName || apiResult?.buildingName || apiResult?.bdNm || '';
  // 학습 건물명 별칭 적용 (Phase 4) — 승인된 별칭을 표준 건물명으로 치환(완전일치만).
  if (result.buildingName) {
    // 완전일치 우선 → 정규화 완전일치 폴백(D). 미일치 시 원본 보존.
    result.buildingName = applyVariant(result.buildingName, dicts.buildingAliasDict, dicts.buildingAliasVariantIndex);
  }
  // A-31: 보강조회까지 반영된 법정동. 한글 키(법정동)로도 노출 — 그리드·엑셀·DB 컬럼이 그대로 쓴다.
  result.legalDong = legalDong || apiResult?.legalDong || apiResult?.emdNm || '';
  result.법정동 = result.legalDong;
  // A-31: 읍/면 법정동은 "홍북읍 신경리" 형태로 오므로 리(里)를 여기서 먼저 확보해 둔다
  // (아래 기존 리 추출이 비었을 때만 쓰이도록 변수로만 보관).
  const legalRiFromDong = (result.legalDong.match(/\s([가-힣]{2,5}리)$/) || [])[1] || '';
  // 리(里): 읍/면 법정리 — 기사 배정 리 단위 매칭용. API liNm 우선, 없으면 지번주소(도로명 없음)에서 "OO리" 추출.
  result.리 = (apiResult?.liNm || apiResult?.legalRi || '').trim();
  // 지번주소(jibunAddr)에서 OO리 추출 — 도로명주소여도 지번주소엔 리가 포함됨(읍/면). 가장 확실한 소스.
  if (!result.리 && apiResult?.jibunAddr) {
    const m = String(apiResult.jibunAddr).match(/([가-힣]{2,5}리)(?=\s|\d|,|$)/);
    if (m) result.리 = m[1];
  }
  // 입력 지번주소(도로명 없음) 폴백 — 읍/면 다음의 OO리(산번지·번지없음 포함) 우선, 그다음 리+(산)번지.
  // '거리/처리/우리' 등 오탐 방지: ①읍/면 토큰 직후 리만, 또는 ②리 뒤 (산)숫자 동반일 때만.
  if (!result.리 && !/(대로|로|길)\s*\d/.test(inputAddr || '')) {
    const ia = inputAddr || '';
    const liMatch = ia.match(/(?:읍|면)\s*([가-힣]{2,4}리)(?=\s|\d|산|,|$)/)
                 || ia.match(/([가-힣]{2,4}리)\s*(?:산\s*)?\d/);
    // '거리/우리/머리/다리' 등 리로 끝나는 비(非)법정리 단어 오탐 제외
    const RI_FALSE = /(거리|우리|머리|다리|항아리|보따리|마무리|소쿠리|자리|무리|꼬리|뿌리)$/;
    if (liMatch && !RI_FALSE.test(liMatch[1])) result.리 = liMatch[1];
  }
  // 도로명 폴백 — 읍/면 지역 도로명은 보통 '법정리+번호+길' 형태(예: 신덕리1길 → 신덕리).
  // API가 리를 안 주고 지번도 없을 때, 도로명 앞부분의 'OO리'를 법정리로 사용. 동(洞) 지역은 제외(오탐 방지).
  if (!result.리) {
    const ctx = `${adminDong || ''} ${inputAddr || ''} ${result.legalDong || ''}`;
    if (/(읍|면)/.test(ctx)) {
      const rm = String(inputAddr || '').match(/([가-힣]{2,4}리)\s*\d/);  // 신덕리1길 → 신덕리
      const RI_FALSE2 = /(거리|우리|머리|다리|항아리|보따리|마무리|소쿠리|자리|무리|꼬리|뿌리)$/;
      if (rm && !RI_FALSE2.test(rm[1])) result.리 = rm[1];
    }
  }
  // A-31: 위 경로들이 모두 비면 법정동("홍북읍 신경리")에서 뽑아 둔 리를 쓴다 — 리 빠짐 방지
  if (!result.리 && legalRiFromDong) result.리 = legalRiFromDong;
  result.matchedSido = apiResult?.matchedSido || apiResult?.siNm || '';
  result.matchedSigungu = apiResult?.matchedSigungu || apiResult?.sggNm || '';
  result.detailAddress = finalDetail || '';
  result.addressMgtNo = apiResult?._addressMgtNo || '';
  result.buildingMgtNo = apiResult?.bdMgtSn || '';
  result.matchSource = apiResult?._matchSource || (apiResult ? 'juso_fallback' : '');
  result.matchConfidence = apiResult?._matchConfidence || null;
  result.routeHints = apiResult?._routeHints || null;
  appendCheckReason(result, getAreaIssue(cityLabel, adminDong, result.matchedSido, result.matchedSigungu, result.legalDong));
  if (crossRegionRejected) appendCheckReason(result, '타지역 오매칭 폐기: 도로명이 타 시군구와 충돌 — 지자체 확인 필요');
  // 유사매칭으로 채택했으나 확신이 안 서는 건(신축이 인접 단지로 둔갑하는 구간) — 담당자 눈에 올린다.
  // 조용히 통과시키면 엉뚱한 집으로 배송된다(형 지시 2026-08-11).
  if (apiResult?._needsReview) {
    appendCheckReason(result, `유사매칭 확인필요: 건물명으로 찾은 결과라 신축·동명 단지일 수 있음 (${result.standardRoadAddress || ''})`);
  }
  if (apiResult?.jibunAddr && !result.standardRoadAddress) {
    appendCheckReason(result, `지번주소만 확인됨: ${apiResult.jibunAddr}`);
  } else if (!apiResult && text && !result.확인필요) {
    // A-12: 도로명(로/길/대로+번호)이 멀쩡히 파싱됐으면 DB 일시 미확인이어도 확인명단에 넣지 않는다(오탐 방지).
    // 타지역(관할 밖) 판별은 엔진이 단정하지 않고, 비교기능(base_lists 법정동↔법정동)이 담당 → CL-4 주민센터배송.
    if (!/(대로|로|길)\s*\d+(?:-\d+)?/.test(result.주소 || '')) {
      appendCheckReason(result, '주소 없음: 전국 주소DB/JUSO에서 확인되지 않음');
    }
  }
  result.lat   = null;
  result.lng   = null;
  if (includeCoords && result.주소) {
    // JUSO roadAddr이 있으면 도시명 포함 전체 주소 → cityPrefix 불필요
    // 없으면 result.주소(도시명 없음)에 cityLabel에서 추출한 시군구 접두어 추가
    const cityPrefix = !apiResult?.roadAddr && cityLabel
      ? (cityLabel.trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '')
      : '';
    const road = apiResult?.roadAddr || result.주소;
    // 아파트 동(棟)별 정밀좌표 우선 — 원주소/정제주소/특이사항에서 숫자 동번호를 찾으면 dong-coords 시도.
    // 동 단위 매칭 실패 시 아래 기존 좌표(단지 대표좌표)로 폴백.
    let coord = null;
    const sigungu = cityPrefix || (cityLabel || '').trim().split(/\s+/).filter(t => /(시|군|구)$/.test(t)).pop() || '';
    const dongNo = io.parseAptDong([inputAddr, result.주소, inputNote].filter(Boolean).join(' '));
    if (dongNo) coord = await io.fetchDongCoord(road, dongNo, sigungu);
    if (!coord) coord = await io.fetchKakaoCoord(road, cityPrefix, result.buildingMgtNo);
    if (coord) { result.lat = coord.lat; result.lng = coord.lng; }
  }

  // ── #5-A: 특이사항 정규화 재적용 (승인된 note_normalize_dict, 완전일치만·주소 무개입) ──
  result.특이사항 = applyNoteNormalize(result.특이사항, dicts.noteNormalizeDict, dicts.noteNormalizeVariantIndex);

  return result;
};
