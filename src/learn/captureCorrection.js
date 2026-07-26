// 사용자 정제 수정 캡처 어댑터 (Firestore) — Phase 1.
//   classifyCorrection(위험분류) → buildCandidate(문서) → learn_candidates 기록.
//   저위험 주소 오타는 기존 typo 루프(addTypoRecord)로 즉시 반영:
//     권한 있으면 typo_dict(즉시적용), 없으면 typo_suggestions(검토 큐) — 기존 인프라 재사용.
//   나머지 저위험(이름/건물명/특이사항/컬럼)·고위험은 후보로만 쌓고 Phase 2·3에서 승격·검토.
//
//   순수 로직은 classifyCorrection.js·buildCandidate.js에서 테스트됨.
//   이 파일은 firestore 어댑터(얇음) — 실패해도 저장/편집 흐름을 막지 않는다.
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase.js';
import { classifyCorrection } from './classifyCorrection.js';
import { buildCandidate } from './buildCandidate.js';
import { addTypoRecord } from '../engine/addressEngine.js';

function safeUid() {
  try { return auth?.currentUser?.uid || ''; } catch { return ''; }
}

// 사용자 수정 1건 캡처. 반환=classify 결과(none/reject 포함, 호출측 판단용).
export async function captureCorrection({ field, before, after, context = {} } = {}) {
  let cls;
  try {
    cls = classifyCorrection({ field, before, after, context });
  } catch (e) {
    console.error('[learn] 위험분류 실패:', e);
    return null;
  }
  if (!cls || cls.risk === 'none' || cls.risk === 'reject') return cls;

  const cand = buildCandidate(cls, { field, before, after, context, uid: safeUid() });
  if (!cand) return cls;

  // 1) learn_candidates 기록 (매건 create; 집계·검토·승격은 Phase 2·3)
  try {
    await addDoc(collection(db, 'learn_candidates'), {
      field: cand.field, before: cand.before, after: cand.after,
      type: cand.type, risk: cand.risk, ruleKey: cand.ruleKey,
      payload: cand.payload, reason: cand.reason, status: cand.status,
      city: cand.city, month: cand.month, uid: cand.uid,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('[learn] 후보 기록 실패:', e);
  }

  // 2) 저위험 주소 오타만 기존 typo 루프로 즉시 반영(인프라 존재).
  try {
    if (cls.risk === 'low' && cls.type === 'typo' && field === 'address' && cls.payload) {
      await addTypoRecord(cls.payload.wrong, cls.payload.correct);
    }
  } catch (e) {
    console.error('[learn] 즉시반영 실패:', e);
  }

  return cls;
}

// 여러 건 배치 캡처(저장 시점 diff 등). 개별 실패가 전체를 막지 않는다.
export async function captureCorrections(items = []) {
  const results = [];
  for (const it of items) {
    try { results.push(await captureCorrection(it)); }
    catch (e) { console.error('[learn] 배치 항목 실패:', e); results.push(null); }
  }
  return results;
}

export default captureCorrection;
