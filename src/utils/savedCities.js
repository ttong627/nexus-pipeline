// 저장된 지자체 목록 (SSOT) — 2026-08-27
//
//   형 지적: "여기도 지자체를 저장된 지자체 중에 고를 수 있게 해줘"(동별 배송지도) ·
//            "여기도 저장된 지자체를 선택할수있게 해줘"(배송일정 관리)
//   두 화면이 서로 다른 방식으로 지자체를 받고 있었다 — 하나는 자유 입력(관리자 계정은 `citiesApproved`
//   가 비어 datalist 가 텅 비었다), 하나는 전국 시/도 표에서 두 번 골라 조립.
//   **실제로 명단이 저장된 지자체**를 그대로 고르게 한다.
//
//   출처: `cloud_lists` 문서 ID = 저장된 지자체 (B-14 정규 지자체명 = 도 포함 풀네임).
//   ★`getDocsFromServer` — 캐시를 쓰면 저장 직후 새 지자체가 안 보인다(19장 규칙).
//   ★권한이 없거나 오프라인이면 조용히 승인 목록만 쓴다 — 화면이 죽지 않는 게 우선.

import { db } from '../config/firebase.js';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { mergeCityLists } from './cityName.js';

export { normalizeCityList, mergeCityLists, splitCityName } from './cityName.js';

/**
 * 저장된 지자체 목록을 읽어온다. 실패해도 절대 던지지 않는다(승인 목록으로 폴백).
 * @returns {Promise<string[]>}
 */
export async function fetchSavedCities({ user, isAdmin = false } = {}) {
  const approved = user?.citiesApproved || [];
  let saved = [];
  try {
    const snap = await getDocsFromServer(collection(db, 'cloud_lists'));
    saved = snap.docs.map((d) => d.id);
  } catch {
    // 권한 없음·오프라인 — 승인 목록만으로 진행한다
  }
  return mergeCityLists(approved, saved, isAdmin);
}
