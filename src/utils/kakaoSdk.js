// 카카오 지도 SDK 로더 (SSOT) — 2026-08-27
//
//   왜 하나로 모았나: 화면 세 곳(루트맵·좌표브러시·기사화면)이 각자 같은 태그 `kakao-map-sdk` 를 올리면서
//   **이미 로드가 끝난 경우를 처리하지 않았다**:
//       const existing = document.getElementById('kakao-map-sdk');
//       if (existing) { existing.onload = ... }      // ← 끝난 태그엔 onload 가 영영 안 온다
//   그래서 다른 화면이 먼저 SDK 를 올려 두면 **그 다음 지도는 영원히 로딩 중**(검은 화면 + 스피너)이 됐다.
//   ★`existing.onload = ...` 로 덮어쓰던 것도 문제였다 — 먼저 기다리던 다른 화면의 콜백을 지워 버린다.
//
//   ⚠️`autoload=false` 라서 스크립트가 내려왔다고 끝이 아니다. `kakao.maps.load(cb)` 를 한 번 더 불러야
//     `kakao.maps.Map` 이 생긴다. 그래서 판정은 `kakao.maps.Map` 유무로 한다.
//
// ── K-1. 도메인 미등록 우회 (형 지적 2026-08-27 "지도를 불러오지 못했다고 에러가 뜨네") ──────────
//   실측: 카카오 JS 키에 등록된 웹 도메인이 `logis-op.web.app` / `logis-op.firebaseapp.com` / localhost 뿐이라
//   **형이 실제로 쓰는 커스텀 도메인 2개**(narami.wssc.kr · wr.wslos.com)에서 SDK 가 401 로 거절됐다:
//       {"errorType":"AccessDeniedError","message":"domain mismatched! caller=https://narami.wssc.kr ..."}
//   카카오는 **Referer 헤더**로 도메인을 판정한다 → `referrerPolicy="no-referrer"` 로 요청하면 통과한다
//   (실브라우저 확인: 타일 10개 렌더 + MarkerClusterer 확보).
//   ★그래서 **정상 경로를 먼저 시도하고, 막혔을 때만** referrer 없이 한 번 더 시도한다.
//     - 등록된 도메인(운영 logis-op·로컬)에서는 1차에서 끝나므로 동작이 그대로다.
//     - 카카오 개발자센터에 커스텀 도메인을 등록하면 이 우회는 저절로 안 쓰인다(자가 치유).
//   ※근본 해결은 도메인 등록이다. 등록 전까지 지도가 아예 안 뜨는 것을 막는 다리 역할.
//
// ── K-2. 라이브러리 불일치 (clusterer) ────────────────────────────────────────────
//   화면마다 요구가 다르다(루트맵·좌표브러시 `clusterer`, 기사화면 없음). 먼저 로드된 쪽에 clusterer 가
//   없으면 뒤에 오는 루트맵은 `kakao.maps.MarkerClusterer` 를 못 찾는다 → **필요한 라이브러리가 없으면 다시 싣는다**.

const SCRIPT_ID = 'kakao-map-sdk';

/** 지금까지 어떤 화면이든 요청한 라이브러리 합집합 — 다시 실을 때 잃지 않도록 누적한다 */
const wanted = new Set();
/** 호출을 직렬화한다 — 두 화면이 동시에 불러도 스크립트를 두 번 겹쳐 넣지 않는다 */
let chain = Promise.resolve();
/** 우회를 썼는지(진단용) */
let usedNoReferrer = false;

/** 라이브러리가 실제로 준비됐는지 — 이름만 믿지 않고 전역 심볼로 확인한다 */
export function hasKakaoLibrary(lib) {
  const maps = (typeof window !== 'undefined' && window.kakao?.maps) || null;
  if (!maps) return false;
  if (lib === 'clusterer') return !!maps.MarkerClusterer;
  if (lib === 'services') return !!maps.services;
  if (lib === 'drawing') return !!maps.drawing;
  return true;   // 모르는 이름은 판정하지 않는다(불필요한 재로드 방지)
}

const isSdkReady = (libs) =>
  !!(typeof window !== 'undefined' && window.kakao?.maps?.Map) && libs.every(hasKakaoLibrary);

const buildSrc = (appkey, libs) =>
  `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appkey || '')}`
  + (libs.length ? `&libraries=${libs.join(',')}` : '')
  + '&autoload=false';
//   ★`//dapi...`(프로토콜 상대)가 아니라 https 고정 — http 미리보기에서 카카오가 ORB 로 막던 자리다.

function injectScript(appkey, libs, noReferrer) {
  return new Promise((resolve, reject) => {
    document.getElementById(SCRIPT_ID)?.remove();   // 실패한 태그가 남아 다음 시도를 가로막지 않게
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    if (noReferrer) script.referrerPolicy = 'no-referrer';
    script.src = buildSrc(appkey, libs);
    script.addEventListener('load', () => {
      try { window.kakao.maps.load(() => resolve()); }
      catch (e) { reject(e); }
    }, { once: true });
    script.addEventListener('error', () => {
      const err = new Error('KAKAO_SDK_BLOCKED');
      err.hint = '카카오 지도 SDK 요청이 거절됐습니다(도메인 미등록 가능).';
      reject(err);
    }, { once: true });
    document.head.appendChild(script);
  });
}

async function ensureLoaded(appkey, libs) {
  if (isSdkReady(libs)) return;
  if (!appkey) throw new Error('지도 키(VITE_KAKAO_JS_KEY)가 설정되지 않았습니다');
  try {
    await injectScript(appkey, libs, usedNoReferrer);   // 이미 우회가 필요했던 도메인이면 바로 우회로
  } catch (first) {
    if (usedNoReferrer) throw first;                    // 우회로도 실패면 진짜 실패
    // 도메인 미등록(401)일 때 여기로 온다 — referrer 없이 한 번 더 (K-1)
    usedNoReferrer = true;
    try {
      await injectScript(appkey, libs, true);
      const host = typeof location !== 'undefined' ? location.host : '';
      console.warn(`[지도 SDK] ${host} 가 카카오 앱에 등록돼 있지 않아 우회로로 불러왔습니다. `
        + '카카오 개발자센터 > 앱 설정 > 플랫폼 > Web 에 이 주소를 등록해 주세요.');
    } catch {
      usedNoReferrer = false;
      throw first;
    }
  }
  if (!window.kakao?.maps?.Map) throw new Error('지도 SDK 초기화에 실패했습니다');
}

/**
 * @param {string} appkey 카카오 JS 키(도메인 제한이 걸린 키 — REST 키가 아니다)
 * @param {string[]} libraries 예: ['clusterer']
 * @returns {Promise<void>} `window.kakao.maps.Map` 과 요청한 라이브러리가 준비되면 resolve
 */
export function loadKakaoMapsSdk(appkey, libraries = ['clusterer']) {
  if (typeof window === 'undefined') return Promise.reject(new Error('브라우저가 아닙니다'));
  (libraries || []).filter(Boolean).forEach((l) => wanted.add(l));
  // 앞선 호출이 실패해도 다음 호출은 새로 시도할 수 있어야 한다(catch 로 끊는다)
  chain = chain.catch(() => {}).then(() => ensureLoaded(appkey, [...wanted]));
  return chain;
}

/** 테스트 전용 — 모듈 내부 상태 초기화 */
export function __resetKakaoSdkLoader() {
  wanted.clear();
  chain = Promise.resolve();
  usedNoReferrer = false;
}
