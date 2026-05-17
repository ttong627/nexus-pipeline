import { useState, useEffect } from 'react';
import { FileSpreadsheet, SlidersHorizontal, Zap, Download, Database, ArrowRight, Play } from 'lucide-react';
import { APP_VERSION } from '../version.js';

const STEPS = [
  {
    icon: FileSpreadsheet, step: '01', title: '데이터 로드',
    desc: '수급자/차상위 명단을 클라우드에 업로드하고 구조를 분석합니다.',
    color: 'text-cyan-400', bg: 'bg-cyan-950/40', border: 'border-cyan-500/30',
  },
  {
    icon: SlidersHorizontal, step: '02', title: '지능형 매핑',
    desc: 'AI 엔진이 문서 구조를 파악하여 필수 컬럼을 자동 연결합니다.',
    color: 'text-cyan-400', bg: 'bg-cyan-950/40', border: 'border-cyan-500/30',
  },
  {
    icon: Zap, step: '03', title: '초고속 정제',
    desc: '무지연 엔진이 주소와 특이사항을 나노 단위로 즉시 표준화합니다.',
    color: 'text-cyan-400', bg: 'bg-cyan-950/40', border: 'border-cyan-500/30',
  },
  {
    icon: Database, step: '04', title: '고객 노트 연동',
    desc: '고객 노트 DB와 자동 매칭하여 기사 배정·특이사항·배송순번을 이식합니다.',
    color: 'text-cyan-400', bg: 'bg-cyan-950/40', border: 'border-cyan-500/30',
  },
  {
    icon: Download, step: '05', title: '최종 출력',
    desc: '정제 완료된 완벽한 데이터를 엑셀로 추출하여 업무에 바로 투입합니다.',
    color: 'text-cyan-400', bg: 'bg-cyan-950/40', border: 'border-cyan-500/30',
  },
];

const TIER_LABELS = { basic: '일반', vip: 'VIP', vvip: 'VVIP', sapphire: '사파이어' };

function getHeadline(reason, meta, userName) {
  if (reason === 'upgrade') {
    const tierLabel = TIER_LABELS[meta?.tier] || meta?.tier || '';
    return (
      <>
        🎉 <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-cyan-600" style={{ filter: 'drop-shadow(0 0 20px rgba(6,182,212,0.4))' }}>{tierLabel} 등급</span>으로 승급하셨습니다!
      </>
    );
  }
  if (reason === 'region') {
    return (
      <>
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-cyan-600" style={{ filter: 'drop-shadow(0 0 20px rgba(6,182,212,0.4))' }}>{meta?.region || '지역'}</span> 등록이 완료되었습니다.
      </>
    );
  }
  // reason === 'new' (default)
  return (
    <>
      압도적 성능의 파이프라인, <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-cyan-600" style={{ filter: 'drop-shadow(0 0 20px rgba(6,182,212,0.4))' }}>{userName}</span>님을 환영합니다.
    </>
  );
}

function getSubtitle(reason) {
  if (reason === 'upgrade') return '새로운 등급의 기능을 지금 바로 경험해 보세요.';
  if (reason === 'region') return '이제 NEXUS PIPELINE의 모든 기능을 이용하실 수 있습니다.';
  return '나노(Nano) 스케일의 입자 처리 알고리즘이 적용된 완벽한 워크플로우를 경험하십시오.';
}

export default function IntroScreen({ user, reason = 'new', meta = {}, onComplete }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 1200);
    const t2 = setTimeout(() => setStage(2), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleStart = () => {
    setStage(3);
    setTimeout(onComplete, 600);
  };

  const userName = user?.realName || user?.displayName || '최고 관리자';

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden bg-[#02050a] text-white font-sans selection:bg-cyan-500/30"
      style={{ opacity: stage === 3 ? 0 : 1, transition: 'opacity 600ms cubic-bezier(0.4, 0, 0.2, 1)' }}
    >
      {/* 나노 파티클 백그라운드 효과 (CSS 대체) */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at center, #0a1128 0%, #02050a 100%)' }} />
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(#06b6d4 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      {/* ── 왼쪽 문 ── */}
      <div
        className="absolute top-0 left-0 h-full w-1/2 overflow-hidden border-r border-cyan-500/20"
        style={{
          transform: stage >= 1 ? 'translateX(-100%)' : 'translateX(0)',
          transition: 'transform 1200ms cubic-bezier(0.85, 0, 0.15, 1)',
        }}
      >
        <div className="absolute inset-0 bg-[#02050a]/90 backdrop-blur-3xl" />
        <div className="absolute right-0 top-0 h-full w-[1px]"
          style={{ background: 'linear-gradient(to bottom, transparent, #06b6d4, transparent)', boxShadow: '0 0 40px 4px rgba(6, 182, 212, 0.7)' }} />
        <div className="absolute inset-0 flex items-center justify-end pr-10 select-none">
          <span className="text-[140px] font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-cyan-600/20 to-cyan-900/0">NEX</span>
        </div>
      </div>

      {/* ── 오른쪽 문 ── */}
      <div
        className="absolute top-0 right-0 h-full w-1/2 overflow-hidden border-l border-cyan-500/20"
        style={{
          transform: stage >= 1 ? 'translateX(100%)' : 'translateX(0)',
          transition: 'transform 1200ms cubic-bezier(0.85, 0, 0.15, 1)',
        }}
      >
        <div className="absolute inset-0 bg-[#02050a]/90 backdrop-blur-3xl" />
        <div className="absolute left-0 top-0 h-full w-[1px]"
          style={{ background: 'linear-gradient(to bottom, transparent, #06b6d4, transparent)', boxShadow: '0 0 40px 4px rgba(6, 182, 212, 0.7)' }} />
        <div className="absolute inset-0 flex items-center justify-start pl-10 select-none">
          <span className="text-[140px] font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-bl from-cyan-600/20 to-cyan-900/0">US</span>
        </div>
      </div>

      {/* ── 닫힌 상태 중앙 로고 ── */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-50"
        style={{
          opacity: stage === 0 ? 1 : 0,
          transform: stage === 0 ? 'scale(1)' : 'scale(1.1)',
          transition: 'all 800ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <div className="text-center relative">
          <div className="absolute inset-0 bg-cyan-500 blur-[120px] opacity-30 rounded-full" />
          <div className="text-[70px] font-black tracking-[0.4em] text-white leading-none relative z-10 flex items-center justify-center gap-4">
            <span className="text-cyan-400" style={{ textShadow: '0 0 40px rgba(6, 182, 212, 0.9)' }}>NEXUS</span>
          </div>
          <div className="text-sm font-bold tracking-[0.9em] text-cyan-500 mt-5 uppercase relative z-10">
            Pipeline Core {APP_VERSION}
          </div>
        </div>
      </div>

      {/* ── 메인 콘텐츠 ── */}
      <div
        className="absolute inset-0 flex items-center justify-center px-8 py-4"
        style={{
          opacity: stage >= 2 ? 1 : 0,
          transform: stage >= 2 ? 'translateY(0)' : 'translateY(30px)',
          transition: 'all 800ms cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: stage >= 2 ? 'auto' : 'none',
        }}
      >
        <div className="w-full max-w-6xl relative z-10">

          {/* 상단 헤더 */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-3 px-6 py-2.5 bg-cyan-900/20 border border-cyan-500/30 rounded-full text-cyan-400 text-[12px] font-black tracking-[0.25em] uppercase mb-8 backdrop-blur-md shadow-[0_0_30px_rgba(6,182,212,0.15)]">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" style={{ boxShadow: '0 0 12px rgba(34,211,238,0.9)' }} />
              SYSTEM READY
            </div>
            <h1 className="text-5xl font-black text-white leading-tight mb-4 tracking-tight">
              {getHeadline(reason, meta, userName)}
            </h1>
            <p className="text-gray-400 text-base">{getSubtitle(reason)}</p>
          </div>

          {/* 5단계 카드 (글래스모피즘) */}
          <div className="grid grid-cols-5 gap-5 mb-12">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className="relative group">
                  <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl blur-xl" />
                  <div className={`relative bg-[#050b14]/80 backdrop-blur-xl border ${s.border} rounded-3xl p-7 h-full flex flex-col gap-4 transition-all duration-300 hover:-translate-y-2 hover:border-cyan-500/60 shadow-xl hover:shadow-[0_10px_40px_-10px_rgba(6,182,212,0.3)]`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className={`w-12 h-12 rounded-2xl bg-cyan-950/50 flex items-center justify-center ${s.color} border border-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.2)] group-hover:scale-110 transition-transform`}>
                        <Icon size={24} strokeWidth={2.5} />
                      </div>
                      <div className="text-[11px] font-black tracking-[0.25em] text-cyan-600/60">{s.step}</div>
                    </div>
                    <div className="text-white font-extrabold text-base tracking-tight">{s.title}</div>
                    <div className="text-gray-400 text-xs leading-relaxed flex-1 font-medium">{s.desc}</div>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="absolute -right-2.5 top-1/2 -translate-y-1/2 z-10 hidden lg:block">
                      <ArrowRight size={16} className="text-cyan-600/40" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 시작 버튼 */}
          <div className="text-center relative mt-4">
            <div className="absolute inset-0 bg-cyan-500 blur-[100px] opacity-15 rounded-full pointer-events-none" />
            <button
              onClick={handleStart}
              className="relative inline-flex items-center gap-4 px-16 py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black rounded-3xl text-[16px] uppercase tracking-widest hover:from-cyan-400 hover:to-blue-500 hover:scale-105 transition-all shadow-[0_0_50px_rgba(6,182,212,0.4)] hover:shadow-[0_0_80px_rgba(6,182,212,0.6)]"
            >
              <Play size={20} fill="currentColor" />
              시스템 가동 시작
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
