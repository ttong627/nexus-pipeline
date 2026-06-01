import { useState } from 'react';
import { X, CheckCircle, Lock } from 'lucide-react';
import { db, collection, addDoc, serverTimestamp } from '../config/firebase.js';

const PLANS = [
  {
    tier: 'basic',
    emoji: '⚪', label: '일반', price: '무료',
    cities: 1,
    features: ['주소 정제 (도로명주소 API)', '고객 노트 저장/조회', '이번달 배송명단 저장/조회', '부가 서비스', '지자체당 월 1만건 처리'],
    border: 'border-gray-600/40', bg: 'bg-gray-800/20', badge: 'text-gray-400',
    btn: 'bg-gray-700/60 text-gray-500 cursor-default',
    btnLabel: '현재 플랜',
  },
  {
    tier: 'vip',
    emoji: '🔵', label: 'VIP', price: '월 1만원',
    cities: 5,
    features: ['일반 기능 전체', '지자체 5개 관리', '좌표 매칭 (Kakao API)', '기사 배정 / 루트맵', '지자체당 월 1만건 처리'],
    border: 'border-blue-500/50', bg: 'bg-blue-950/30', badge: 'text-blue-300',
    btn: 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_16px_rgba(59,130,246,0.4)]',
    btnLabel: '업그레이드 문의',
  },
  {
    tier: 'vvip',
    emoji: '🟣', label: 'VVIP', price: '협의',
    cities: 20,
    features: ['VIP 기능 전체', '지자체 20개 관리', 'AI 배송 최적화', 'DB 현황 (전체 조회)', '지자체당 월 1만건 처리'],
    border: 'border-purple-500/50', bg: 'bg-purple-950/30', badge: 'text-purple-300',
    btn: 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_16px_rgba(168,85,247,0.4)]',
    btnLabel: '업그레이드 문의',
  },
  {
    tier: 'sapphire',
    emoji: '💎', label: '사파이어', price: '협의',
    cities: '무제한',
    features: ['VVIP 기능 전체', '지자체 무제한', '전담 고객지원', '지자체당 월 1만건 처리', '커스텀 설정'],
    border: 'border-cyan-400/50', bg: 'bg-cyan-950/30', badge: 'text-cyan-300',
    btn: 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_16px_rgba(6,182,212,0.4)]',
    btnLabel: '업그레이드 문의',
  },
];

const REASON_CFG = {
  city_limit:    { icon: '🏙', tag: '지자체 한도 초과',          color: 'text-amber-400', borderColor: 'border-amber-500/30' },
  routeMap:      { icon: '🗺', tag: 'VIP 이상 플랜 전용 기능',   color: 'text-blue-400',  borderColor: 'border-blue-500/30' },
  ai:            { icon: '✦',  tag: 'VVIP 이상 플랜 전용 기능', color: 'text-purple-400', borderColor: 'border-purple-500/30' },
  dbOverview:    { icon: '📊', tag: 'VVIP 이상 플랜 전용 기능', color: 'text-purple-400', borderColor: 'border-purple-500/30' },
  monthlyLimit:  { icon: '📦', tag: '월 처리 한도 초과',         color: 'text-orange-400', borderColor: 'border-orange-500/30' },
};
const REASON_TITLE = {
  city_limit:   '플랜을 업그레이드하세요',
  routeMap:     '루트맵은 VIP 이상 플랜에서 이용 가능합니다',
  ai:           'AI 최적화는 VVIP 이상 플랜에서 이용 가능합니다',
  dbOverview:   'DB 현황은 VVIP 이상 플랜에서 이용 가능합니다',
  monthlyLimit: '월 처리 한도를 초과했습니다',
};

const CONTACT_EMAIL = 'ttong627@gmail.com';

export default function UpgradeModal({ onClose, user, userTier, usedCount = 0, userMaxCities = 1, reason = 'city_limit' }) {
  const tierIdx = ['basic', 'vip', 'vvip', 'sapphire'].indexOf(userTier || 'basic');
  const cfg = REASON_CFG[reason] || REASON_CFG.city_limit;

  const [inquiryPlan, setInquiryPlan] = useState(null);
  const [formData, setFormData] = useState({
    name: user?.realName || '',
    contact: user?.phone || '',
    email: user?.email || ''
  });
  const [submitting, setSubmitting] = useState(false);

  const handleContact = (plan) => {
    setInquiryPlan(plan);
  };

  const submitInquiry = async (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.contact.trim() || !formData.email.trim()) {
      alert('모든 필드를 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'inquiries'), {
        uid: user?.uid || 'unknown',
        email: formData.email,
        realName: formData.name,
        region: user?.region || '미등록',
        contact: formData.contact,
        requestedPlan: inquiryPlan.label,
        currentPlan: userTier || 'basic',
        status: 'pending',
        createdAt: serverTimestamp(),
        message: `${inquiryPlan.label} 플랜 업그레이드 요청`
      });
      alert('업그레이드 문의가 성공적으로 접수되었습니다.\n관리자가 확인 후 입력하신 연락처로 연락드리겠습니다.');
      setInquiryPlan(null);
    } catch (err) {
      console.error(err);
      alert('접수 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[700] flex items-center justify-center p-4" onClick={onClose}>
      
      {inquiryPlan && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-[800] p-4" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-sm bg-[#0a100c] border border-[#3b82f6]/40 rounded-3xl p-6 shadow-[0_0_50px_rgba(59,130,246,0.15)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#3b82f6] to-transparent opacity-50"></div>
            
            <div className="flex justify-between items-start mb-5">
              <div>
                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-black border border-[#3b82f6]/30 bg-[#3b82f6]/10 text-[#3b82f6] mb-2">
                  1:1 문의 접수
                </span>
                <h3 className="text-white font-black text-lg">[{inquiryPlan.label}] 플랜 업그레이드</h3>
              </div>
              <button onClick={() => setInquiryPlan(null)} className="text-gray-500 hover:text-white transition-colors bg-white/5 rounded-full p-1.5"><X size={18}/></button>
            </div>
            
            <p className="text-gray-400 text-xs mb-6 font-medium">관리자가 내용 확인 후 기재해주신 연락처로 빠르게 안내해 드리겠습니다.</p>
            
            <form onSubmit={submitInquiry} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-400 mb-1.5 ml-1">담당자 성명</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-black/50 border border-[#333] focus:border-[#3b82f6]/50 text-white p-3 rounded-xl text-sm outline-none transition-all placeholder-gray-700" placeholder="홍길동" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-400 mb-1.5 ml-1">연락받으실 번호</label>
                <input required value={formData.contact} onChange={e => setFormData({...formData, contact: e.target.value})} className="w-full bg-black/50 border border-[#333] focus:border-[#3b82f6]/50 text-white p-3 rounded-xl text-sm outline-none transition-all placeholder-gray-700" placeholder="010-1234-5678" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-400 mb-1.5 ml-1">이메일 주소</label>
                <input required type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-black/50 border border-[#333] focus:border-[#3b82f6]/50 text-white p-3 rounded-xl text-sm outline-none transition-all placeholder-gray-700" placeholder="email@example.com" />
              </div>
              
              <button type="submit" disabled={submitting} className="w-full py-3.5 bg-[#3b82f6] hover:bg-[#1ea34d] text-black font-black rounded-xl text-sm transition-all shadow-[0_0_20px_rgba(59,130,246,0.2)] hover:shadow-[0_0_30px_rgba(59,130,246,0.4)] disabled:opacity-50 mt-4 flex items-center justify-center gap-2">
                {submitting ? '접수 처리 중...' : '문의 접수하기'}
              </button>
            </form>
          </div>
        </div>
      )}

      <div
        className="w-full max-w-4xl bg-[#05080f] border border-[#3b82f6]/20 rounded-3xl shadow-[0_0_80px_rgba(59,130,246,0.15)] flex flex-col max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-8 py-6 border-b border-[#0f1a2e] flex items-start justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Lock size={18} className={cfg.color} />
              <span className={`${cfg.color} font-black text-sm`}>{cfg.tag}</span>
            </div>
            <h2 className="text-white text-xl font-black">{REASON_TITLE[reason] || REASON_TITLE.city_limit}</h2>
            {reason === 'city_limit' && (
              <p className="text-gray-500 text-sm mt-1">
                현재 <span className="text-white font-bold">{usedCount}개</span> 지자체 사용 중 · 허용 한도 <span className="text-amber-400 font-bold">{userMaxCities}개</span>
              </p>
            )}
            {reason === 'monthlyLimit' && (
              <p className="text-gray-500 text-sm mt-1">
                처리 한도(지자체 1개당 월 <span className="text-white font-bold">1만건</span>)를 초과했습니다. 지자체를 추가하거나 명단을 나눠 올려주세요.
              </p>
            )}
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
                  className={`rounded-2xl border p-5 flex flex-col gap-3 transition-all ${plan.border} ${plan.bg} ${isCurrent ? 'ring-2 ring-[#3b82f6]/40' : ''} ${isLower ? 'opacity-40' : ''}`}
                >
                  <div className="text-center">
                    <div className="text-3xl mb-1">{plan.emoji}</div>
                    <p className={`text-sm font-black ${plan.badge}`}>{plan.label}</p>
                    <p className="text-white font-black text-lg mt-1">{plan.price}</p>
                    <p className="text-gray-500 text-[11px] mt-0.5">
                      지자체 {typeof plan.cities === 'number' ? `${plan.cities}개` : plan.cities}
                    </p>
                    {isCurrent && (
                      <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-[#3b82f6]/10 border border-[#3b82f6]/30 text-[#3b82f6] text-[10px] font-black">현재 플랜</span>
                    )}
                  </div>

                  <ul className="space-y-1.5 flex-1">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-1.5 text-[11px] text-gray-400">
                        <CheckCircle size={11} className="text-[#3b82f6] mt-0.5 shrink-0" />
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
                    <div className={`w-full py-2.5 rounded-xl text-xs font-extrabold text-center ${isCurrent ? 'bg-[#3b82f6]/10 text-[#3b82f6]' : 'bg-gray-800/40 text-gray-600'}`}>
                      {isCurrent ? '현재 사용 중' : '해당 없음'}
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
