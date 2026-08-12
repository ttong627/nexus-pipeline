// ══════════════════════════════════════════════════════════════════
//  개인정보 열람 감시 — 규칙 판정(순수). 알림 발송과 분리한다.
//  회귀: scripts/leak-watch.test.mjs
//
//  ★왜 필요한가 (2026-09-11 시행 개정 개인정보보호법)
//    유출 통지 의무는 **"가능성을 인지한 때"부터 72시간**이다.
//    그런데 인지할 수단이 없으면 시계가 언제 시작됐는지도 모른다.
//    기록만 남기는 것으로는 부족하다 — **아무도 안 본다.** 사고는 로그를 뒤지는
//    사람이 없을 때 커진다. 그래서 기록이 들어오는 즉시 규칙을 돌리고 사람에게 보낸다.
//
//  ★판정과 발송을 나눈 이유: 판정은 테스트로 못 박을 수 있어야 하고,
//    발송은 네트워크라 실패한다. 발송 실패가 판정을 오염시키면 안 된다.
// ══════════════════════════════════════════════════════════════════

/** 기본 임계값. 운영에서 환경변수로 조절한다(끄는 스위치는 두지 않는다 — 끄면 안 보인다). */
const DEFAULTS = {
  windowMin: 10,      // 관찰 창(분)
  bulkReads: 300,     // 그 창 안에 한 사람이 연 건수
  distinctShares: 5,  // 그 창 안에 한 사람이 연 **서로 다른 공유** 수
  nightStart: 1,      // 심야 시작(KST 시)
  nightEnd: 5,        // 심야 끝(KST 시)
  nightReads: 50,     // 심야에 이만큼 넘게 열면 알린다
};

/** ISO 문자열 → KST 시(0~23). 서버는 UTC 로 돈다 — 여기서 한 번만 바꾼다. */
function kstHour(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return -1;
  return new Date(t.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
}

/**
 * 최근 열람 기록으로 이상을 판정한다.
 *
 * @param {Array} recent 같은 행위자의 최근 기록 `{at, shareId, count}` (창 안으로 이미 걸러 넣어도 되고 아니어도 된다)
 * @param {object} [opts] 임계값·기준시각 주입(테스트 결정성)
 * @returns {Array<{kind:string, severity:'high'|'medium', message:string}>}
 */
function detectAnomalies(recent = [], opts = {}) {
  const cfg = { ...DEFAULTS, ...(opts.config || {}) };
  const now = opts.now ? new Date(opts.now) : new Date();
  const since = now.getTime() - cfg.windowMin * 60 * 1000;

  const rows = (Array.isArray(recent) ? recent : [])
    .filter((r) => r && r.at)
    .filter((r) => {
      const t = new Date(r.at).getTime();
      return !Number.isNaN(t) && t >= since && t <= now.getTime();
    });
  if (!rows.length) return [];

  const out = [];
  const total = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const shares = new Set(rows.map((r) => String(r.shareId || '')).filter(Boolean));

  // ① 짧은 시간 대량 열람 — 명단을 통째로 빼가는 전형
  if (total >= cfg.bulkReads) {
    out.push({
      kind: 'bulk_read', severity: 'high',
      message: `${cfg.windowMin}분 안에 ${total}건 열람 (임계 ${cfg.bulkReads}). 정상 업무인지 즉시 확인이 필요합니다.`,
    });
  }

  // ② 여러 공유를 훑는 패턴 — 한 기사는 보통 자기 공유 하나만 본다
  if (shares.size >= cfg.distinctShares) {
    out.push({
      kind: 'many_shares', severity: 'high',
      message: `${cfg.windowMin}분 안에 서로 다른 공유 ${shares.size}개 접근. 링크를 훑고 있을 수 있습니다.`,
    });
  }

  // ③ 심야 대량 열람 — 배송 시간대가 아니다
  const nightTotal = rows
    .filter((r) => { const h = kstHour(r.at); return h >= cfg.nightStart && h < cfg.nightEnd; })
    .reduce((s, r) => s + (Number(r.count) || 0), 0);
  if (nightTotal >= cfg.nightReads) {
    out.push({
      kind: 'night_read', severity: 'medium',
      message: `심야(${cfg.nightStart}~${cfg.nightEnd}시) 열람 ${nightTotal}건. 배송 시간대가 아닙니다.`,
    });
  }

  return out;
}

/** 사람에게 보낼 한 덩어리 문구. 무엇을·누가·언제를 한 줄에 담는다. */
function formatAlert(actor, findings, now = new Date()) {
  const who = actor?.name || actor?.phone || actor?.uid || '알 수 없는 사용자';
  const head = `[개인정보 경보] ${who}`;
  const body = (findings || []).map((f) => `· ${f.message}`).join('\n');
  const kst = new Date(new Date(now).getTime() + 9 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  return `${head}\n${body}\n시각(KST): ${kst}`;
}

module.exports = { DEFAULTS, kstHour, detectAnomalies, formatAlert };
