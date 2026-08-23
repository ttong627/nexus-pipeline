// 카카오 REST 호출은 **서버를 거친다** — 2026-08-23 점검 지적.
//
//   왜: REST 키는 서버 자격증명이라 **도메인 제한이 불가능**하다(JS 키만 도메인 허용목록을 지원).
//       예전엔 `VITE_KAKAO_REST_KEY` 가 빌드 결과에 문자 그대로 들어가서, 페이지 소스만 봐도 키를 가져다
//       자기 서비스의 지오코딩에 무제한으로 쓸 수 있었다 → **쿼터 소진 = 배송 당일 좌표 매칭 전면 중단** + 과금.
//   어떻게: Cloud Functions `api/kakao` 가 로그인 토큰을 확인하고 서버 키로 대신 호출한다.
//       클라이언트 번들에는 이제 REST 키가 없다(JS 지도 키는 도메인 제한이 되므로 그대로 둔다).
//
//   ⚠️호출 실패는 예외를 던지지 않고 `null`(또는 빈 documents)을 돌려준다 — 좌표 못 찾음과 같은 취급이라
//     화면이 죽지 않는다. 호출부는 예전 Kakao 응답 형태(`{ documents: [...] }`)를 그대로 받는다.
import { auth } from '../config/firebase.js';

const FN_BASE = `https://asia-northeast3-${import.meta.env.VITE_FIREBASE_PROJECT_ID || 'logis-op'}.cloudfunctions.net/api`;

const call = async (op, params, { signal } = {}) => {
  const user = auth.currentUser;
  if (!user) return null;                       // 로그인 전이면 조용히 건너뛴다(예전 '키 없음'과 같은 자리)
  let token;
  try { token = await user.getIdToken(); } catch { return null; }
  const res = await fetch(`${FN_BASE}/kakao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, params }),
    signal,
  });
  if (!res.ok) return null;
  return res.json();
};

/** 주소 검색 — 예전 `/v2/local/search/address.json` 과 같은 응답 형태 */
export const kakaoSearchAddress = (query, { size = 1, signal } = {}) =>
  call('address', { query, size }, { signal });

/** 키워드(장소) 검색 — 예전 `/v2/local/search/keyword.json` */
export const kakaoSearchKeyword = (query, { size = 5, signal } = {}) =>
  call('keyword', { query, size }, { signal });

/** 좌표 1건만 필요할 때 — 실패·미발견이면 null */
export const kakaoCoordOf = async (query, { keyword = false, signal } = {}) => {
  const data = await (keyword ? kakaoSearchKeyword(query, { size: 1, signal }) : kakaoSearchAddress(query, { size: 1, signal }));
  const d = data?.documents?.[0];
  if (!d?.x || !d?.y) return null;
  return { lat: parseFloat(d.y), lng: parseFloat(d.x), raw: d };
};

/** 정적 지도 이미지 — 서버가 받아서 base64 로 돌려준다(브라우저에서 Blob 으로 되돌린다) */
export const kakaoStaticMapBlob = async ({ centerLat, centerLng, level = 6, w = 1200, h = 900, markers }) => {
  const data = await call('staticmap', { centerLat, centerLng, level, w, h, markers });
  if (!data?.base64) return null;
  const bin = atob(data.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: data.contentType || 'image/png' });
};
