// 기사 공유화면(ShareRouteView) 입장 판정 — 순수함수 (회귀 scripts/share-passcode.test.mjs)
//
//   누가 링크를 열었나에 따라 셋 중 하나:
//     'staff' — 담당자/관리자(이메일 로그인)가 미리보기로 연 것. 커스텀 토큰으로 **덮어쓰면 업무 세션이 날아간다** → 손대지 않고
//               규칙의 생성자·관리자 경로로 읽는다.
//     'token' — 이미 이 공유의 토큰(claims.shareId === shareId)을 가진 기사. 바로 읽는다.
//     'probe' — 토큰이 없거나 다른 공유의 토큰. Function(openShare)에 빈 비밀번호로 물어본다 —
//               비밀번호 없는 옛 링크면 바로 토큰이 오고, 필요하면 PASSCODE_REQUIRED 가 와서 입력창을 띄운다.
/**
 * @param {{ isAnonymous?: boolean, email?: string|null } | null} user  auth.currentUser
 * @param {{ shareId?: string } | null} claims  getIdTokenResult().claims
 * @param {string} shareId
 * @returns {'staff'|'token'|'probe'}
 */
export const decideGate = (user, claims, shareId) => {
  const tokenShare = claims?.shareId || '';
  if (user && tokenShare && tokenShare === shareId) return 'token';
  // 비익명 로그인인데 공유 토큰이 아니면 담당자(구글·SSO 커스텀 토큰 — SSO 는 email 클레임이 없을 수 있어 email 로 가르지 않는다)
  if (user && !user.isAnonymous && !tokenShare) return 'staff';
  return 'probe';
};

/** Function 오류 코드 → 기사에게 보일 문장 (원인은 숨기되 다음 행동은 알려준다) */
export const gateMessage = (code, details) => {
  switch (code) {
    case 'functions/failed-precondition':
    case 'failed-precondition':
      return '';                                                        // PASSCODE_REQUIRED — 입력창만 띄운다
    case 'functions/permission-denied':
    case 'permission-denied':
      return '비밀번호가 맞지 않습니다. 담당자에게 받은 숫자 6자리를 다시 확인해 주세요.';
    case 'functions/resource-exhausted':
    case 'resource-exhausted':
      return `여러 번 틀려 잠시 잠겼습니다. ${details?.minutes || 10}분 뒤 다시 시도해 주세요.`;
    case 'functions/not-found':
    case 'not-found':
      return '공유 링크를 찾을 수 없거나 만료되었습니다. 담당자에게 새 링크를 요청해 주세요.';
    case 'functions/invalid-argument':
    case 'invalid-argument':
      return '숫자 6자리를 입력해 주세요.';
    default:
      return '지도를 여는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.';
  }
};
