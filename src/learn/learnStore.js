// 자가학습 승격 저장소 (Firestore) — Phase 2.
//   저위험 규칙을 유형별 사전에 승격한다. 권한 있으면 dict(즉시적용), 없으면 suggestion(검토 큐).
//   기존 addressEngine의 typo_dict 패턴과 동일 구조(공동 기여·관리자 검토).
//   - 이름 오타 : name_typo_dict     (주소 typo_dict와 분리 — 이름에만 적용, 주소 오염 방지)
//   - 건물명 별칭: building_alias
//   - 특이사항  : note_hints          (자동 삽입이 아니라 "알려진 배송힌트" 목록 — 적용은 Phase 4에서 신중히)
import { doc, setDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase.js';

const dictDocId = (v) => encodeURIComponent(String(v || '').trim()).replace(/\./g, '%2E').slice(0, 1400);
const uid = () => { try { return auth?.currentUser?.uid || ''; } catch { return ''; } };

// dict에 직접 쓰기(관리자) → 실패 시 suggestion 큐(일반 사용자)로 폴백.
async function saveDictOrSuggestion({ dictName, suggestionName, docId, dictPayload, suggestionFields }) {
  try {
    await setDoc(doc(db, dictName, docId), dictPayload, { merge: true });
    return 'applied';
  } catch {
    try {
      await addDoc(collection(db, suggestionName), {
        ...suggestionFields, status: 'pending', createdAt: serverTimestamp(), createdByUid: uid(),
      });
      return 'suggested';
    } catch (e) {
      console.error(`[learn] ${dictName} 저장 실패:`, e);
      return 'failed';
    }
  }
}

export async function saveNameTypo(wrong, correct) {
  const w = String(wrong || '').trim(), c = String(correct || '').trim();
  if (!w || !c || w === c) return 'skip';
  return saveDictOrSuggestion({
    dictName: 'name_typo_dict', suggestionName: 'name_typo_suggestions', docId: dictDocId(w),
    dictPayload: { wrong: w, correction: c, updatedAt: new Date().toISOString() },
    suggestionFields: { wrong: w, correction: c },
  });
}

export async function saveBuildingAlias(alias, canonical) {
  const a = String(alias || '').trim(), c = String(canonical || '').trim();
  if (!a || !c || a === c) return 'skip';
  return saveDictOrSuggestion({
    dictName: 'building_alias', suggestionName: 'building_alias_suggestions', docId: dictDocId(a),
    dictPayload: { alias: a, canonical: c, updatedAt: new Date().toISOString() },
    suggestionFields: { alias: a, canonical: c },
  });
}

export async function saveNoteHint(hint) {
  const h = String(hint || '').trim();
  if (!h || h.length > 60) return 'skip'; // 과도하게 긴 자유문구는 힌트로 부적합
  return saveDictOrSuggestion({
    dictName: 'note_hints', suggestionName: 'note_hints_suggestions', docId: dictDocId(h),
    dictPayload: { hint: h, updatedAt: new Date().toISOString() },
    suggestionFields: { hint: h },
  });
}
