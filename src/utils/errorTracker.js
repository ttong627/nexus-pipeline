// @ts-check
// 전역 클라이언트 에러 추적 — "모르게 생기는 에러"를 Firestore에 남겨 관리자가 보게 한다.
// 설계 원칙: 로깅이 절대 앱을 죽이지 않는다(모든 경로 try/catch), 스팸 차단(throttle), 재진입 차단.
import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase.js';
import { APP_VERSION } from '../version.js';

const THROTTLE_MS = 60000;   // 같은 메시지는 1분에 1회만 기록(폭주 방지)
const MAX_TRACKED = 50;      // throttle 추적 메시지 상한
const TTL_DAYS = 30;         // expireAt 기반 자동 정리
const recentErrors = new Map();
let logging = false;         // 로깅 도중 또 에러나는 무한루프 차단

/**
 * extra 컨텍스트 정리 — 길이 제한으로 민감정보·과대 페이로드 유입 최소화
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, string>}
 */
const sanitizeExtra = (extra) => {
  try {
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(extra || {})) {
      out[String(k).slice(0, 40)] = String(v ?? '').slice(0, 200);
    }
    return out;
  } catch {
    return {};
  }
};

/**
 * 클라이언트 에러를 Firestore `error_logs`에 기록(관리자 가시성).
 * 실패해도 절대 앱을 죽이지 않는다.
 * @param {string} source - 발생 위치 라벨 (예: 'window.onerror', 'addressCleanup')
 * @param {unknown} error - Error 또는 메시지
 * @param {Record<string, unknown>} [extra] - 추가 컨텍스트(민감정보 금지)
 */
export const logClientError = async (source, error, extra = {}) => {
  try {
    if (logging) return;
    const anyErr = /** @type {any} */ (error);
    const message = String((anyErr && anyErr.message) || error || '알 수 없는 오류').slice(0, 500);

    // throttle: 같은 메시지 단시간 중복 차단
    const now = Date.now();
    const last = recentErrors.get(message);
    if (last && now - last < THROTTLE_MS) return;
    recentErrors.set(message, now);
    if (recentErrors.size > MAX_TRACKED) {
      const oldest = recentErrors.keys().next().value;
      recentErrors.delete(oldest);
    }

    console.error(`[NEXUS ERROR · ${source}]`, error);

    const user = auth?.currentUser;
    if (!user) return; // 미인증은 보안 규칙상 콘솔만(error_logs create 차단)

    logging = true;
    await addDoc(collection(db, 'error_logs'), {
      message,
      stack: String((anyErr && anyErr.stack) || '').slice(0, 2000),
      source: String(source || '').slice(0, 100),
      url: (typeof location !== 'undefined' ? location.href : '').slice(0, 300),
      userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 300),
      appVersion: APP_VERSION,
      userEmail: user.email || '',
      uid: user.uid,
      extra: sanitizeExtra(extra),
      timestamp: serverTimestamp(),
      expireAt: Timestamp.fromMillis(now + TTL_DAYS * 24 * 60 * 60 * 1000),
    });
  } catch {
    // 로깅 자체 실패는 무시 — 앱 안정성 최우선
  } finally {
    logging = false;
  }
};

/** 전역 에러 핸들러 등록 — 처리되지 않은 에러·프로미스 거부를 자동 기록 */
export const initErrorTracking = () => {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    logClientError('window.onerror', (e && (e.error || e.message)) || 'error', {
      file: e?.filename || '',
      line: e?.lineno ?? '',
      col: e?.colno ?? '',
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    logClientError('unhandledrejection', (e && e.reason) || 'rejection');
  });
};
