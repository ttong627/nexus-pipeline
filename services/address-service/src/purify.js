// ══════════════════════════════════════════════════════════════════
//  purify — 서버 정제 조립 (P7 Phase2 ⓒ-2)
//
//  공용 코어(shared/purifyCore.js)에 **서버쪽 deps**를 꽂아 `/v1/address/purify`를 만든다.
//  코어 로직은 손대지 않는다 — 여기서 하는 일은 IO·부수효과·사전을 대주는 것뿐이다.
//
//    deps.io.lookupAddr        → matchAddress **in-process 직접호출**(자기 자신에게 HTTP 금지)
//    deps.io.searchKakaoFull   → Kakao 키워드 검색 (검색어·URL은 shared SSOT)
//    deps.io.fetchKakaoLegalDong → Kakao 법정동 (A-30 지역검증·채택규칙 shared SSOT)
//    deps.io.fetchKakaoCoord / fetchDongCoord / parseAptDong → 좌표는 서버 범위 밖(항상 null)
//    deps.side.addSpecialChar  → no-op. ※클라도 이 호출은 '이미 사전에 있는 문자'로만 들어와
//                                 실질 no-op이다(정규식에 있는 문자만 매칭되므로). 파리티 영향 없음.
//    deps.dicts                → dictStore의 **getter 객체**(값 복사 금지)
//
//  ⚠️ 배치 동시성은 config.purifyConcurrency(기본 3). 2026-07-30 커넥션 풀 경합으로
//     /v1/address/match가 전부 500이 났던 사고의 재발 방지선이다. 올리지 말 것.
// ══════════════════════════════════════════════════════════════════
import { config } from './config.js';
import { createProcessAddress } from './shared/purifyCore.js';
import { isCandidateInSelectedMunicipality } from './shared/purifyHelpers.js';
import {
  kakaoAddressSearchUrl,
  kakaoKeywordSearchUrl,
  buildLegalDongQuery,
  pickLegalDongFromKakao,
} from './shared/kakaoQueries.js';
import { createDictStore } from './dictStore.js';

const MAX_LOOKUP_CACHE = 1000;   // 클라 MAX_API_CACHE와 동일
const KAKAO_TIMEOUT_MS = 2000;   // 클라 KAKAO_TIMEOUT_MS와 동일

/** 삽입순 FIFO 축출 캐시 — 클라 _setApiCache와 같은 정책. */
const boundedSet = (map, key, value) => {
  if (map.size >= MAX_LOOKUP_CACHE) map.delete(map.keys().next().value);
  map.set(key, value);
};

/** 동시 실행 상한을 지키며 전부 처리한다(결과 순서는 입력 순서 유지). */
export const runPool = async (limit, items, worker) => {
  const size = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let cursor = 0;
  const lane = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return results;
};

/**
 * 서버 deps 조립.
 * @param {{ matchAddress: Function, dicts: object, kakaoRestKey?: string, fetchImpl?: Function }} options
 */
export const createPurifyDeps = ({ matchAddress, dicts, kakaoRestKey = config.kakaoRestKey, fetchImpl }) => {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const lookupCache = new Map();
  const legalDongCache = new Map();
  const kakaoCache = new Map();

  const kakaoGet = async (url) => {
    if (!kakaoRestKey) return null;
    try {
      const res = await doFetch(url, {
        headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
        signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return (await res.json()).documents?.[0] || null;
    } catch { return null; }
  };

  return {
    io: {
      // 클라는 /v1/address/match를 HTTP로 부르지만 서버는 같은 프로세스 안이다.
      // allowJusoFallback:false 도 클라 요청과 동일(클라는 JUSO 키가 비어 있어 실질 미사용).
      lookupAddr: async (keyword, cityLabel = '') => {
        const kw = String(keyword || '').trim();
        if (kw.length < 2) return null;
        const key = `${String(cityLabel || '').trim()}::${kw}`;
        if (lookupCache.has(key)) return lookupCache.get(key);
        let out = null;
        try {
          const hit = await matchAddress({ queryText: kw, cityLabel, allowJusoFallback: false });
          // A-30: 클라 lookupAddr과 동일한 지역 게이트 — 타지역 결과는 채택하지 않는다.
          out = (hit && isCandidateInSelectedMunicipality(hit, cityLabel)) ? hit : null;
        } catch (error) {
          // 한 건의 조회 실패로 배치 전체가 죽으면 안 된다(부정 캐시로 재난타도 막는다).
          console.error('[purify] lookupAddr 실패:', error.message);
        }
        boundedSet(lookupCache, key, out);
        return out;
      },
      searchKakaoFull: async (query) => {
        const key = String(query || '').trim();
        if (!key) return null;
        if (kakaoCache.has(key)) return kakaoCache.get(key);
        const doc = await kakaoGet(kakaoKeywordSearchUrl(key));
        boundedSet(kakaoCache, key, doc);
        return doc;
      },
      fetchKakaoLegalDong: async (addr, cityLabel = '') => {
        if (!addr) return null;
        const query = buildLegalDongQuery(addr, cityLabel);
        if (!query) return null;
        const key = `${String(cityLabel || '').trim()}::${query}`;
        if (legalDongCache.has(key)) return legalDongCache.get(key);
        const out = pickLegalDongFromKakao(await kakaoGet(kakaoAddressSearchUrl(query)), cityLabel);
        boundedSet(legalDongCache, key, out);
        return out;
      },
      // 좌표는 규격화가 아니라 지오코딩 — /v1/address/geocode·/v1/building/dong-coords 담당.
      // purify는 includeCoords:false로 고정하므로 이 셋은 호출되지 않는다(방어적으로 null).
      fetchKakaoCoord: async () => null,
      fetchDongCoord: async () => null,
      parseAptDong: () => null,
    },
    side: {
      addSpecialChar: () => {},   // 서버는 사전을 쓰기하지 않는다(학습은 클라·검토 화면 담당)
    },
    dicts,
  };
};

/**
 * 정제기 생성. 서버(server.js)와 파리티 테스트가 **같은 조립**을 쓴다 —
 * 테스트가 실제 배포 경로를 검증하도록 하기 위한 구조다.
 */
export const createPurifier = ({
  matchAddress,
  dictStore = createDictStore(),
  kakaoRestKey = config.kakaoRestKey,
  fetchImpl,
  concurrency = config.purifyConcurrency,
} = {}) => {
  const deps = createPurifyDeps({ matchAddress, dicts: dictStore.dicts, kakaoRestKey, fetchImpl });
  const processAddress = createProcessAddress(deps);

  /** @param {Array<{addr?:string,name?:string,adminDong?:string,cityLabel?:string,note?:string}>} records */
  const purifyRecords = async (records) => runPool(concurrency, records, async (record) => {
    const r = record || {};
    try {
      return await processAddress(
        r.addr || r.address || '',
        r.name || '',
        r.adminDong || '',
        r.cityLabel || '',
        r.note || '',
        { includeCoords: false },   // 좌표 미지원 — 범위 밖(위 io 주석 참조)
      );
    } catch (error) {
      // 한 건이 깨져도 나머지 결과는 돌려준다(무손실 M-1: 입력을 통째로 잃지 않는다).
      return { 원주소: r.addr || r.address || '', _error: String(error?.message || error) };
    }
  });

  return { purifyRecords, processAddress, dictStore };
};
