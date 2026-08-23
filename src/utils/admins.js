// 관리자 이메일 — **여기 하나뿐**(CLAUDE.md 14장).
//   2026-08-23 점검에서 App.jsx·UtilsModal.jsx·RouteMapModal.jsx 에 세 벌이 있었고 값도 서로 달랐다.
//   실제 권한 경계는 `firestore.rules` 다 - 이 목록은 화면 표시·진입 판단용이다.
export const ADMIN_EMAILS = ['ttong627@gmail.com'];
export const isAdminEmail = (email) => ADMIN_EMAILS.includes(String(email || '').toLowerCase().trim());
