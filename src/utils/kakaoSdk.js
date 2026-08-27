// 카카오 지도 SDK 로더 (SSOT) — 2026-08-27
//
//   왜 하나로 모았나: 화면 세 곳(루트맵·좌표브러시·기사화면)이 각자 같은 태그 `kakao-map-sdk` 를 올리면서
//   **이미 로드가 끝난 경우를 처리하지 않았다**:
//       const existing = document.getElementById('kakao-map-sdk');
//       if (existing) { existing.onload = ... }      // ← 끝난 태그엔 onload 가 영영 안 온다
//   그래서 다른 화면이 먼저 SDK 를 올려 두면 **그 다음 지도는 영원히 로딩 중**(검은 화면 + 스피너)이 됐다.
//   형 지적 2026-08-27 "지도가 안 나오고".
//   ★`existing.onload = ...` 로 덮어쓰던 것도 문제였다 — 먼저 기다리던 다른 화면의 콜백을 지워 버린다.
//
//   ⚠️`autoload=false` 라서 스크립트가 내려왔다고 끝이 아니다. `kakao.maps.load(cb)` 를 한 번 더 불러야
//     `kakao.maps.Map` 이 생긴다. 그래서 판정은 `kakao.maps.Map` 유무로 한다.

const SCRIPT_ID = 'kakao-map-sdk';
let pending = null;   // 같은 세션에서 두 화면이 동시에 부르면 하나만 실제로 로드한다

/**
 * @param {string} appkey 카카오 JS 키(도메인 제한이 걸린 키 — REST 키가 아니다)
 * @param {string[]} libraries 예: ['clusterer']
 * @returns {Promise<void>} `window.kakao.maps.Map` 이 준비되면 resolve
 */
export function loadKakaoMapsSdk(appkey, libraries = ['clusterer']) {
  if (typeof window === 'undefined') return Promise.reject(new Error('브라우저가 아닙니다'));
  if (window.kakao?.maps?.Map) return Promise.resolve();
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    const ready = () => {
      try { window.kakao.maps.load(() => resolve()); }
      catch (e) { reject(e); }
    };
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      // ★이미 올라와 있고 부트스트랩까지 끝났으면 기다리지 않고 바로 load 를 부른다.
      if (window.kakao?.maps?.load) { ready(); return; }
      existing.addEventListener('load', ready, { once: true });      // 덮어쓰지 않고 더한다
      existing.addEventListener('error', () => reject(new Error('지도 SDK를 불러오지 못했습니다')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${appkey}`
      + (libraries?.length ? `&libraries=${libraries.join(',')}` : '')
      + '&autoload=false';
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', () => reject(new Error('지도 SDK를 불러오지 못했습니다')), { once: true });
    document.head.appendChild(script);
  });
  pending.catch(() => { pending = null; });   // 실패하면 다음에 다시 시도할 수 있게
  return pending;
}
