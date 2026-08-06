import { useEffect, useState } from 'react';

// V월드(국토교통부 공간정보 오픈플랫폼) 3D 지도 SDK 로더.
//   ⭐카카오맵은 **지도 기울기(3D tilt)를 지원하지 않는다** — 그래서 「3D」만 V월드로 간다.
//     2D·야간·위성·거리뷰는 계속 카카오다(핀·경로·순번 편집이 전부 거기 붙어 있다).
//
// 🔴여러 번 「3D가 안 뜬다」던 진짜 원인 (2026-08-04 실측으로 확정)
//   V월드가 주는 `webglMapInit.js.do` 는 **자기 자신이 지도 엔진이 아니다.** 설정값 몇 개를 만든 뒤
//   `document.write("<script src=…WSViewerStartup.js>")` 로 **진짜 엔진들을 불러오는** 부트스트랩이다.
//   그런데 `document.write` 는 **문서 파싱이 끝난 뒤에 부르면 아무 일도 하지 않는다**(브라우저 규칙).
//   우리는 SPA 라 항상 파싱이 끝난 뒤 스크립트를 꽂는다 → 엔진이 **영원히 안 온다** → `window.vw` 가 안 생긴다.
//   ⛔그래서 인증키를 몇 번 바꿔도 증상이 똑같았다. **키 문제가 아니었다**(실측: `vworldIsValid='true'`).
//   ✅해결 = 부트스트랩이 도는 동안만 `document.write` 를 **가로채** 스크립트 주소를 받아 두고,
//     끝난 뒤 우리가 **원래 순서대로** 직접 불러온다. 순서가 같아 원본과 동작이 같다.
//
//   ⚠️인증키는 도메인별로 등록된다(localhost / wssc.kr). 키가 도메인과 안 맞으면 부트스트랩이
//     `vworldIsValid='false'` 를 내려주므로, 그 값을 읽어 **원인을 정확히** 구분한다.
const SDK_ID = 'vworld-3d-sdk';
const KEY = import.meta.env.VITE_VWORLD_KEY || '';

/** document.write 로 넘어온 HTML 조각에서 스크립트/스타일 주소만 뽑는다. */
export function grabAssets(html) {
  const out = [];
  const re = /<(script|link)\b[^>]*?(?:src|href)\s*=\s*(['"])(.*?)\2/gi;
  let m;
  while ((m = re.exec(String(html || '')))) out.push({ kind: m[1].toLowerCase(), url: m[3] });
  return out;
}

/**
 * 🔴V월드 엔진은 **jQuery 가 이미 있다고 가정**한다(형 화면 오류 `$ is not defined`).
 *   공식 예제가 `<script src="jquery-1.11.0">` 를 먼저 깔아 두기 때문이다. V월드 서버는 jQuery 를
 *   제공하지 않는다(실측: 그 경로들은 전부 HTML 을 돌려주는 가짜 200).
 *   ⭐그래서 **번들에 넣고 3D 를 켤 때만** 불러 전역에 붙인다 — 외부 CDN 의존이 없다.
 *   엔진이 실제로 쓰는 건 `$.ajax` 뿐이라 3.x 로 충분하다(4.x 는 옛 API 가 빠져 위험).
 */
async function ensureJQuery() {
  if (typeof window === 'undefined' || window.jQuery) return;
  const m = await import('jquery');
  const jq = m.default || m;
  window.jQuery = jq;
  if (!window.$) window.$ = jq;      // ⛔남의 `$` 가 이미 있으면 건드리지 않는다
}

/** 뽑아 둔 주소를 **원래 순서대로** 하나씩 로드한다(엔진끼리 앞뒤 의존이 있다). */
function loadInOrder(assets, done, fail) {
  let i = 0;
  const next = () => {
    if (i >= assets.length) { done(); return; }
    const a = assets[i]; i += 1;
    if (a.kind === 'link') {
      if (!document.querySelector(`link[href="${a.url}"]`)) {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = a.url;
        document.head.appendChild(l);
      }
      next(); return;                       // CSS 는 기다릴 필요가 없다
    }
    if (document.querySelector(`script[src="${a.url}"]`)) { next(); return; }
    const s = document.createElement('script');
    s.src = a.url; s.async = false;         // ⛔async=false 여야 넣은 순서대로 실행된다
    s.onload = next;
    s.onerror = () => fail(a.url);
    document.head.appendChild(s);
  };
  next();
}

export function useVworldSdk(enabled = false) {
  const [ready, setReady] = useState(() => !!(typeof window !== 'undefined' && window.vw?.Map));
  const [failed, setFailed] = useState(false);
  // 실패 원인을 갈라 둔다 — 형이 **무엇을 고쳐야 하는지**가 달라진다.
  //   'net'  = 스크립트를 못 받음(네트워크·차단)
  //   'auth' = 키가 이 도메인에 등록돼 있지 않음(V월드가 직접 알려준 값)
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!enabled || !KEY || ready || failed) return undefined;
    let cancelled = false;
    let timer = null;
    const poll = (left, onGiveUp) => {
      if (cancelled) return;
      if (window.vw?.Map) { setReady(true); return; }
      if (left <= 0) { setReason(onGiveUp); setFailed(true); return; }
      timer = setTimeout(() => poll(left - 1, onGiveUp), 150);
    };

    // 이미 한 번 올린 적이 있으면 준비 여부만 본다(엔진은 전역에 한 벌).
    if (document.getElementById(SDK_ID)) {
      poll(100, window.vworldIsValid === 'false' ? 'auth' : 'net');
      return () => { cancelled = true; clearTimeout(timer); };
    }

    // ── 부트스트랩이 도는 동안만 document.write 를 가로챈다 ──
    const grabbed = [];
    const origWrite = document.write;
    const origWriteln = document.writeln;
    const shim = function shimWrite(...args) { args.forEach((h) => grabbed.push(...grabAssets(h))); };
    document.write = shim;
    document.writeln = shim;
    const restore = () => {
      if (document.write === shim) document.write = origWrite;
      if (document.writeln === shim) document.writeln = origWriteln;
    };

    const el = document.createElement('script');
    el.id = SDK_ID;
    el.type = 'text/javascript';
    el.src = `https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey=${encodeURIComponent(KEY)}`;
    el.onerror = () => { restore(); if (!cancelled) { setReason('net'); setFailed(true); } };
    el.onload = () => {
      restore();
      if (cancelled) return;
      // V월드가 직접 알려주는 인증 결과 — 키/도메인 문제면 여기서 갈린다.
      if (window.vworldIsValid === 'false') { setReason('auth'); setFailed(true); return; }
      if (!grabbed.length) { setReason('net'); setFailed(true); return; }
      // ⛔jQuery 를 **엔진보다 먼저** 깔아야 한다 — 엔진이 로드 즉시 `$` 를 쓴다.
      ensureJQuery()
        .then(() => {
          if (cancelled) return;
          loadInOrder(
            grabbed,
            () => poll(80, 'auth'),         // 엔진이 스스로 초기화할 시간(약 12초)
            () => { if (!cancelled) { setReason('net'); setFailed(true); } },
          );
        })
        .catch(() => { if (!cancelled) { setReason('net'); setFailed(true); } });
    };
    document.head.appendChild(el);

    return () => { cancelled = true; clearTimeout(timer); restore(); };
  }, [enabled, ready, failed]);

  return { key: KEY, ready, failed, reason };
}

export const hasVworldKey = () => !!KEY;
