import { useState, useEffect } from 'react';
import { FileSpreadsheet, SlidersHorizontal, Zap, Download, Database, ArrowRight } from 'lucide-react';

const STEPS = [
  {
    icon: FileSpreadsheet, step: '01', title: '엑셀 업로드',
    desc: '지자체 명단 엑셀 파일을 드래그하거나 클릭하여 업로드합니다.',
    color: 'text-blue-400', bg: 'bg-blue-950/50', border: 'border-blue-500/30',
  },
  {
    icon: SlidersHorizontal, step: '02', title: '시트 선택 & 매핑',
    desc: '수급자/차상위 시트를 분류하고 컬럼을 자동 감지·매핑합니다.',
    color: 'text-purple-400', bg: 'bg-purple-950/50', border: 'border-purple-500/30',
  },
  {
    icon: Zap, step: '03', title: '주소 자동 정제',
    desc: '엔진이 주소를 표준화하고 특이사항을 자동으로 분리합니다.',
    color: 'text-yellow-400', bg: 'bg-yellow-950/50', border: 'border-yellow-500/30',
  },
  {
    icon: Download, step: '04', title: '저장 & 출력',
    desc: '정제 명단을 클라우드에 저장하거나 표준 엑셀로 다운로드합니다.',
    color: 'text-green-400', bg: 'bg-green-950/50', border: 'border-green-500/30',
  },
  {
    icon: Database, step: '05', title: '기본명단 관리',
    desc: '지자체별 대상자 이력을 누적 관리하고 중복을 자동 정리합니다.',
    color: 'text-amber-400', bg: 'bg-amber-950/50', border: 'border-amber-500/30',
  },
];

const TIPS = [
  { label: '주소 즉시 재정제', desc: '주소 셀을 수정하고 Enter를 누르면 AI 엔진이 즉시 재정제합니다.' },
  { label: '실행 취소 (Undo)', desc: '분석 완료 후 헤더의 ↩ 버튼으로 이전 상태로 언제든 되돌립니다.' },
  { label: '기본명단 자동 이식', desc: '생년월일·휴대폰 일치 시 이전 특이사항이 ◆ 표시로 자동 이식됩니다.' },
];

export default function IntroScreen({ user, onComplete }) {
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setDoorsOpen(true), 600);
    const t2 = setTimeout(() => setContentVisible(true), 1950);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleStart = () => {
    setExiting(true);
    setTimeout(onComplete, 500);
  };

  const userName = user?.realName || user?.displayName || '관리자';

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden"
      style={{ opacity: exiting ? 0 : 1, transition: 'opacity 500ms ease' }}
    >
      {/* 배경 */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, #031203 0%, #010301 100%)' }} />

      {/* ── 왼쪽 문 ── */}
      <div
        className="absolute top-0 left-0 h-full w-1/2 overflow-hidden"
        style={{
          transform: doorsOpen ? 'translateX(-100%)' : 'translateX(0)',
          transition: 'transform 1350ms cubic-bezier(0.77, 0, 0.18, 1)',
        }}
      >
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, #010301, #041504 60%, #071f07)' }} />
        {/* 격자 텍스처 */}
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: 'linear-gradient(#22c55e 1px, transparent 1px), linear-gradient(90deg, #22c55e 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        {/* 수평 강조선 */}
        <div className="absolute top-[28%] left-0 right-0 h-px" style={{ background: 'linear-gradient(to right, transparent, #22c55e22, transparent)' }} />
        <div className="absolute bottom-[28%] left-0 right-0 h-px" style={{ background: 'linear-gradient(to right, transparent, #22c55e22, transparent)' }} />
        {/* 오른쪽 빛나는 테두리 */}
        <div className="absolute right-0 top-0 h-full w-[2px]"
          style={{ background: 'linear-gradient(to bottom, transparent 5%, #22c55e 40%, #22c55e 60%, transparent 95%)', boxShadow: '0 0 24px 6px rgba(34,197,94,0.55)' }} />
        {/* 문자 장식 */}
        <div className="absolute inset-0 flex items-center justify-end pr-10 select-none">
          <span className="text-[80px] font-black tracking-tight text-white opacity-[0.06] leading-none">NEX</span>
        </div>
        {/* 코너 장식 */}
        <div className="absolute bottom-8 left-8 text-[10px] font-bold tracking-widest text-[#22c55e]/20 uppercase">Nexus Pipeline</div>
      </div>

      {/* ── 오른쪽 문 ── */}
      <div
        className="absolute top-0 right-0 h-full w-1/2 overflow-hidden"
        style={{
          transform: doorsOpen ? 'translateX(100%)' : 'translateX(0)',
          transition: 'transform 1350ms cubic-bezier(0.77, 0, 0.18, 1)',
        }}
      >
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to left, #010301, #041504 60%, #071f07)' }} />
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: 'linear-gradient(#22c55e 1px, transparent 1px), linear-gradient(90deg, #22c55e 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        <div className="absolute top-[28%] left-0 right-0 h-px" style={{ background: 'linear-gradient(to left, transparent, #22c55e22, transparent)' }} />
        <div className="absolute bottom-[28%] left-0 right-0 h-px" style={{ background: 'linear-gradient(to left, transparent, #22c55e22, transparent)' }} />
        <div className="absolute left-0 top-0 h-full w-[2px]"
          style={{ background: 'linear-gradient(to bottom, transparent 5%, #22c55e 40%, #22c55e 60%, transparent 95%)', boxShadow: '0 0 24px 6px rgba(34,197,94,0.55)' }} />
        <div className="absolute inset-0 flex items-center justify-start pl-10 select-none">
          <span className="text-[80px] font-black tracking-tight text-white opacity-[0.06] leading-none">US</span>
        </div>
        <div className="absolute bottom-8 right-8 text-[10px] font-bold tracking-widest text-[#22c55e]/20 uppercase">v4.0</div>
      </div>

      {/* ── 가운데 빛나는 봉합선 (문 닫힌 상태) ── */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 h-full w-[2px] pointer-events-none"
        style={{
          background: 'linear-gradient(to bottom, transparent 3%, #22c55e 30%, #86efac 50%, #22c55e 70%, transparent 97%)',
          boxShadow: '0 0 32px 10px rgba(34,197,94,0.5)',
          opacity: doorsOpen ? 0 : 1,
          transition: 'opacity 350ms ease',
        }}
      />

      {/* ── 닫힌 상태 중앙 로고 ── */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
        style={{ opacity: doorsOpen ? 0 : 1, transition: 'opacity 350ms ease' }}
      >
        <div className="text-center">
          <div
            className="text-[52px] font-black tracking-[0.3em] text-[#22c55e] leading-none"
            style={{ textShadow: '0 0 50px rgba(34,197,94,0.9), 0 0 100px rgba(34,197,94,0.4)' }}
          >
            NEXUS
          </div>
          <div className="text-xs font-bold tracking-[0.65em] text-gray-500 mt-3 uppercase">Pipeline V4.0</div>
        </div>
      </div>

      {/* ── 도움말 콘텐츠 (문 열린 후 표시) ── */}
      <div
        className="absolute inset-0 flex items-center justify-center px-6 py-4"
        style={{
          opacity: contentVisible ? 1 : 0,
          transition: 'opacity 700ms ease',
          pointerEvents: contentVisible ? 'auto' : 'none',
        }}
      >
        <div className="w-full max-w-5xl">

          {/* 상단 환영 */}
          <div className="text-center mb-7">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-[#22c55e]/10 border border-[#22c55e]/30 rounded-full text-[#22c55e] text-[10px] font-black tracking-[0.2em] uppercase mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse inline-block" />
              NEXUS PIPELINE V4.0
            </div>
            <h1 className="text-[28px] font-black text-white leading-tight">
              환영합니다, <span style={{ color: '#22c55e', textShadow: '0 0 20px rgba(34,197,94,0.5)' }}>{userName}</span>님
            </h1>
            <p className="text-gray-500 text-sm mt-1.5">아래 5단계로 명단 정제 작업을 진행합니다</p>
          </div>

          {/* 5단계 카드 */}
          <div className="grid grid-cols-5 gap-3 mb-5">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className="relative">
                  <div className={`${s.bg} border ${s.border} rounded-2xl p-4 h-full flex flex-col gap-2`}>
                    <div className={`text-[9px] font-black tracking-[0.25em] ${s.color} opacity-40`}>{s.step}</div>
                    <Icon size={19} className={s.color} />
                    <div className="text-white font-bold text-[11px] leading-snug">{s.title}</div>
                    <div className="text-gray-500 text-[10px] leading-relaxed flex-1">{s.desc}</div>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="absolute -right-2 top-1/2 -translate-y-1/2 z-10">
                      <ArrowRight size={11} className="text-gray-700" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 팁 3개 */}
          <div className="grid grid-cols-3 gap-3 mb-7">
            {TIPS.map((tip, i) => (
              <div key={i} className="bg-white/[0.025] border border-white/[0.06] rounded-xl px-4 py-3">
                <div className="text-[#22c55e] text-[10px] font-black tracking-wide mb-1.5">◆ {tip.label}</div>
                <div className="text-gray-500 text-[10px] leading-relaxed">{tip.desc}</div>
              </div>
            ))}
          </div>

          {/* 시작 버튼 */}
          <div className="text-center">
            <button
              onClick={handleStart}
              className="inline-flex items-center gap-3 px-12 py-4 bg-[#22c55e] text-black font-extrabold rounded-2xl text-sm uppercase tracking-wider hover:bg-[#86efac] hover:scale-105 transition-all"
              style={{ boxShadow: '0 0 40px rgba(34,197,94,0.45)' }}
            >
              작업 시작하기 <ArrowRight size={16} strokeWidth={3} />
            </button>
            <p className="text-gray-700 text-[10px] mt-3">
              로그인할 때마다 표시됩니다 &nbsp;·&nbsp; 우측 상단 <span className="text-gray-500 font-bold">?</span> 버튼으로 언제든지 다시 확인 가능
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
