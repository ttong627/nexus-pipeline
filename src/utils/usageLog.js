// ══════════════════════════════════════════════════════════════════
//  이용 기록 전송 (형 지시 2026-08-08) — 누가·어디서(IP)·쉬운/일반 정제를 얼마나 쓰는지
//
//  왜 서버를 거치나: 브라우저는 자기 공인 IP를 알 수 없다. 서버(Cloud Functions)가
//  요청 헤더에서 IP를 직접 뽑아 기록한다(클라가 보낸 IP는 위조 가능해 서버가 무시한다).
//
//  ★fire-and-forget: 이 기록이 실패해도 정제 결과는 절대 영향받지 않는다.
//    (네트워크 차단·로그아웃·서버 점검 중에도 정제는 그대로 끝나야 한다)
// ══════════════════════════════════════════════════════════════════
import { auth } from '../config/firebase.js';
import { APP_VERSION } from '../version.js';

const USAGE_URL = 'https://asia-northeast3-logis-op.cloudfunctions.net/api/usage';

export function logUsageEvent(payload) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    user.getIdToken()
      .then(token => fetch(USAGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Id-Token': token },
        body: JSON.stringify({ ...payload, appVersion: APP_VERSION }),
        keepalive: true, // 정제 직후 페이지를 닫아도 전송이 끊기지 않게
      }))
      .catch(() => { /* 기록 실패는 무시 — 정제 흐름을 막지 않는다 */ });
  } catch {
    /* 무시 */
  }
}
