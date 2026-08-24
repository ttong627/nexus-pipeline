// 등급 배지 — AdminPanel 과 admin/*Tab.jsx 가 같은 것을 쓴다(복제 금지).
import { TIERS } from './adminShared.js';

const TierBadge = ({ tier }) => {
  const t = TIERS[tier] || TIERS.basic;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black border ${t.bg} ${t.color} ${t.border}`}>
      {t.emoji} {t.label}
    </span>
  );
};

export default TierBadge;
