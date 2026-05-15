import { X, CheckCircle, Lock } from 'lucide-react';

const PLANS = [
  {
    tier: 'basic',
    emoji: '⚪', label: '기본', price: '무료',
    cities: 1,
    features: ['신규명단 정제', '주소 자동 분류', '엑셀 내보내기'],
    border: 'border-gray-600/40', bg: 'bg-gray-800/20', badge: 'text-gray-400',
    btn: 'bg-gray-700/60 text-gray-500 cursor-default',
    btnLabel: '현재 플랜',
  },
  {
    tier: 'vip',
    emoji: '🔵', label: 'VIP', price: '월 49만원',
    cities: 3,
    features: ['기본 기능 전체', '지자체 3개 관리', '기본명단 클라우드 저장', '월별 변경 이력 조회'],
    border: 'border-blue-500/50', bg: 'bg-blue-950/30', badge: 'text-blue-300',
    btn: 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_16px_rgba(59,130,246,0.4)]',
    btnLabel: '업그레이드 문의',
  },
  {
    tier: 'vvip',
    emoji: '🟣', label: 'VVIP', price: '월 149만원',
    cities: 10,
    features: ['VIP 기능 전체', '지자체 10개 관리', 'AI 자동화 리포트', '오류 자동 알림', '통합 분석 대시보드'],
    border: 'border-purple-500/50', bg: 'bg-purple-950/30', badge: 'text-purple-300',
    btn: 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_16px_rgba(168,85,247,0.4)]',
    btnLabel: '업그레이드 문의',
  },
  {
    tier: 'sapphire',
    emoji: '💎', label: '사파이어', price: '월 299만원',
    cities: '무제한',
    features: ['VVIP 기능 전체', '지자체 무제한', '전담 고객지원(CS)', 'API 연동', '커스텀 리포트 제작'],
    border: 'border-cyan-400/50', bg: 'bg-cyan-950/30', badge: 'text-cyan-300',
    btn: 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_16px_rgba(6,182,212,0.4)]',
    btnLabel: '업그레이드 문의',
  },
];

const CONTACT_EMAIL = 'ttong627@gmail.com';

export default function UpgradeModal({ onClose, userTier, userCitiesUsed = [], userMaxCities = 1 }) {
  const usedCount = userCitiesUsed.length;
  const tierIdx = ['basic', 'vip', 'vvip', 'sapphire'].indexOf(userTier || 'basic');

  const handleContact = (plan) => {
    const subject = encodeURIComponent(`[웰쉐어 NEXUS] ${plan.label} 플랜 업그레이드 문의`);
    const body = encodeURIComponent(
      `안녕하세요,\n\nNEXUS 명단 정제 시스템 ${plan.label} 플랜(${plan.price}) 업그레이드를 문의합니다.\n\n현재 등급: ${userTier}\n사용 중인 지자체: ${usedCount}개\n\n연락처와 소속 지자체를 회신해 주시면 빠르게 처리해 드리겠습니다.`
    );
    window.open(`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`);
  };

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[700] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl bg-[#080f09] border border-[#22c55e]/20 rounded-3xl shadow-[0_0_80px_rgba(34,197,94,0.15)] flex flex-col max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-8 py-6 border-b border-[#1e2d22] flex items-start justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Lock size={18} className="text-amber-400" />
              <span className="text-amber-400 font-black text-sm">지자체 한도 초과</span>
            </div>
            <h2 className="text-white text-xl font-black">플랜을 업그레이드하세요</h2>
            <p className="text-gray-500 text-sm mt-1">
              현재 <span className="text-white font-bold">{usedCount}개</span> 지자체 사용 중 · 허용 한도 <span className="text-amber-400 font-bold">{userMaxCities}개</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors p-1 mt-1"><X size={20}/></button>
        </div>

        {/* Plans */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-4 gap-4">
            {PLANS.map((plan, i) => {
              const isCurrent = plan.tier === (userTier || 'basic');
              const isLower = i < tierIdx;
              return (
                <div
                  key={plan.tier}
                  className={`rounded-2xl border p-5 flex flex-col gap-3 transition-all ${plan.border} ${plan.bg} ${isCurrent ? 'ring-2 ring-[#22c55e]/40' : ''} ${isLower ? 'opacity-40' : ''}`}
                >
                  <div className="text-center">
                    <div className="text-3xl mb-1">{plan.emoji}</div>
                    <p className={`text-sm font-black ${plan.badge}`}>{plan.label}</p>
                    <p className="text-white font-black text-lg mt-1">{plan.price}</p>
                    <p className="text-gray-500 text-[11px] mt-0.5">
                      지자체 {typeof plan.cities === 'number' ? `${plan.cities}개` : plan.cities}
                    </p>
                    {isCurrent && (
                      <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] text-[10px] font-black">현재 플랜</span>
                    )}
                  </div>

                  <ul className="space-y-1.5 flex-1">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-1.5 text-[11px] text-gray-400">
                        <CheckCircle size={11} className="text-[#22c55e] mt-0.5 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {!isCurrent && !isLower ? (
                    <button
                      onClick={() => handleContact(plan)}
                      className={`w-full py-2.5 rounded-xl text-xs font-extrabold transition-all ${plan.btn}`}
                    >
                      {plan.btnLabel}
                    </button>
                  ) : (
                    <div className={`w-full py-2.5 rounded-xl text-xs font-extrabold text-center ${isCurrent ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-gray-800/40 text-gray-600'}`}>
                      {isCurrent ? '✓ 사용 중' : '해당 없음'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-center text-gray-600 text-xs mt-5">
            문의 후 관리자 확인 · 등급 변경까지 1영업일 이내 처리됩니다 · <span className="text-gray-500">{CONTACT_EMAIL}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
