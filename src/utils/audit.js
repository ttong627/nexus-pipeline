// 파괴적 작업 감사 로그 — B-11. **삭제·마이그레이션은 전부 여기를 거친다.**
//   2026-08-23 점검: 기록이 5곳뿐이고 기본명단 전체삭제·유령정리·월 초기화·DB 마이그레이션 등
//   9개 파괴적 경로가 무기록이었다(누가 언제 몇 건을 지웠는지 사후에 알 방법이 없었다).
//   ★기록 실패가 작업 자체를 막지는 않는다(로그는 보조수단) — 대신 콘솔에 남긴다.
import { db, auth, addDoc, collection, serverTimestamp, Timestamp } from '../config/firebase.js';

const ttl90 = () => Timestamp.fromDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));

export const logAudit = async (action, payload = {}) => {
  try {
    const u = auth.currentUser;
    await addDoc(collection(db, 'audit_logs'), {
      action,
      ...payload,
      timestamp: serverTimestamp(),
      adminEmail: u?.email || 'unknown',
      uid: u?.uid || 'unknown',
      expireAt: ttl90(),
    });
  } catch (e) {
    console.warn('[audit] 기록 실패:', action, e?.message || e);
  }
};
