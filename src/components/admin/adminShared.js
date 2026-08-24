// 관리자 패널 공용 값(컴포넌트 아님 — 컴포넌트와 한 파일에 두면 Fast Refresh 가 깨진다) — AdminPanel.jsx 와 admin/*Tab.jsx 가 **같은 것을 본다**.
//   ★탭을 분리하면서 복사해 두면 등급 배지 색이 화면마다 달라진다(이 프로젝트가 반복해 당한 복제 함정).
//   그래서 옮기되 한 벌만 둔다 — 2026-08-24 정밀점검.

export const fmt = (ts) => {
  if (!ts?.seconds) return '-';
  const d = new Date(ts.seconds * 1000);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

export const TIERS = {
  basic:    { label: '기본',     emoji: '⚪', color: 'text-gray-400',   bg: 'bg-gray-800/60',    border: 'border-gray-600/40' },
  vip:      { label: 'VIP',      emoji: '🔵', color: 'text-blue-300',   bg: 'bg-blue-950/60',    border: 'border-blue-600/40' },
  vvip:     { label: 'VVIP',     emoji: '🟣', color: 'text-purple-300', bg: 'bg-purple-950/60',  border: 'border-purple-600/40' },
  sapphire: { label: '사파이어', emoji: '💎', color: 'text-cyan-300',   bg: 'bg-cyan-950/60',    border: 'border-cyan-500/40' },
};

export const TIER_DEFAULT_CITIES = { basic: 1, vip: 3, vvip: 10, sapphire: 999 };
