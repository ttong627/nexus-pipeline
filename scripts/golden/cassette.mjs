// 골든 회귀 — fetch 카세트(녹화·재생). P7 Phase2 선행.
//
// 왜 필요한가: 주소 엔진은 정제 도중 외부를 호출한다(주소매칭 API·좌표·Kakao).
// 골든 스냅샷이 서버 상태·네트워크에 흔들리면 "회귀"와 "환경 변화"를 구분할 수 없다.
// → 응답을 한 번 녹화해두고 이후에는 재생만 한다. 같은 입력 → 항상 같은 출력.
//
// 모드
//   offline : 모든 외부 호출 실패. 외부 의존 0 → CI에서 항상 동일. 규격화 규칙 검증용.
//   replay  : 카세트에 녹화된 응답만 사용. 미녹화 호출은 실패 처리하고 miss로 집계.
//   record  : 실제 호출 후 카세트에 저장(운영 API 사용 — 동시성 주의).
//
// ⚠️ 운영 규칙: 주소 API 동시성은 3 이하(2026-07-30 풀 경합 장애). record는 순차 실행한다.

import fs from 'node:fs';

const KEY_SEP = '\n';
const RECORD_RETRIES = 3;
const RECORD_TIMEOUT_MS = 25000;

/**
 * 카세트 키 생성.
 * - 인증 헤더는 애초에 저장하지 않는다(url·body만 키로 쓴다).
 * - 쿼리스트링에 실린 키 값은 마스킹한다.
 * - 인프라 주소(Cloud Run URL 등)는 토큰으로 치환한다 → 카세트가 환경 변화에 안 깨지고
 *   저장소에 배포 URL이 박히지 않는다.
 */
const requestKey = (url, init = {}, aliases = []) => {
  const method = String(init.method || 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : '';
  let safeUrl = String(url).replace(/([?&](?:key|appkey|confmKey|serviceKey)=)[^&]*/gi, '$1__REDACTED__');
  for (const [from, to] of aliases) {
    if (from) safeUrl = safeUrl.split(from).join(to);
  }
  return body ? `${method} ${safeUrl}${KEY_SEP}${body}` : `${method} ${safeUrl}`;
};

const failedResponse = () => { throw new TypeError('fetch failed (golden cassette)'); };

export const loadCassette = (cassettePath) => {
  if (!cassettePath || !fs.existsSync(cassettePath)) return {};
  return JSON.parse(fs.readFileSync(cassettePath, 'utf8'));
};

export const saveCassette = (cassettePath, entries) => {
  const sorted = Object.fromEntries(Object.keys(entries).sort().map((k) => [k, entries[k]]));
  fs.writeFileSync(cassettePath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
};

/**
 * globalThis.fetch를 카세트로 대체한다.
 * @returns {{ entries: object, misses: string[], restore: () => void }}
 */
export const installCassette = ({ mode = 'offline', cassettePath = '', aliases = [] } = {}) => {
  const realFetch = globalThis.fetch;
  const entries = mode === 'record' ? {} : loadCassette(cassettePath);
  const misses = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const key = requestKey(url, init, aliases);

    if (mode === 'offline') return failedResponse();

    if (mode === 'record') {
      // ★녹화는 서버 응답 '내용'을 잡는 것이지 응답 '속도'를 잡는 게 아니다.
      //   엔진은 3초에 abort하는데, 콜드스타트로 그 안에 못 오면 같은 주소가 녹화마다
      //   건물명 붙었다 떨어졌다 한다(실측: 재녹화 시 12건이 AbortError). → 결정성 붕괴.
      //   녹화 때만 abort signal을 제거해 실제 응답이 올 때까지 기다린다(순차·읽기전용).
      // 엔진 abort(3초)는 떼되, 서버 장애 시 무한 대기하지 않도록 넉넉한 상한(25초)을 둔다.
      const { signal: _drop, ...recordInit } = init;
      let lastError;
      for (let attempt = 0; attempt < RECORD_RETRIES; attempt += 1) {
        try {
          const res = await realFetch(input, { ...recordInit, signal: AbortSignal.timeout(RECORD_TIMEOUT_MS) });
          const text = await res.clone().text();
          entries[key] = { status: res.status, body: text };
          return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
          lastError = error;
        }
      }
      // 재시도해도 실패하면 그 실패가 곧 동작이다(예: 진짜 미매칭). 기록해 재생에서 재현한다.
      entries[key] = { failed: String(lastError?.name || 'FetchError') };
      return failedResponse();
    }

    const hit = entries[key];
    if (!hit) {
      misses.push(key);
      return failedResponse();
    }
    if (hit.failed) return failedResponse();
    return new Response(hit.body, { status: hit.status, headers: { 'Content-Type': 'application/json' } });
  };

  return {
    entries,
    misses,
    restore: () => { globalThis.fetch = realFetch; },
  };
};
