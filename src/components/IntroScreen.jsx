import { useState, useEffect, useRef } from 'react';
import { FileSpreadsheet, SlidersHorizontal, Zap, Database, Download, ArrowRight, Play } from 'lucide-react';
import { APP_VERSION } from '../version.js';

const STEPS = [
  {
    icon: FileSpreadsheet, step: '01', title: '데이터 로드',
    desc: '수급자/차상위 명단을 클라우드에 업로드하고 구조를 분석합니다.',
    theme: 'sky',
  },
  {
    icon: SlidersHorizontal, step: '02', title: '지능형 매핑',
    desc: 'AI 엔진이 문서 구조를 파악하여 필수 컬럼을 자동 연결합니다.',
    theme: 'violet',
  },
  {
    icon: Zap, step: '03', title: '초고속 정제',
    desc: '무지연 엔진이 주소와 특이사항을 나노 단위로 즉시 표준화합니다.',
    theme: 'emerald',
  },
  {
    icon: Database, step: '04', title: '고객 노트 연동',
    desc: '고객 노트 DB와 자동 매칭하여 기사 배정·특이사항·배송순번을 이식합니다.',
    theme: 'amber',
  },
  {
    icon: Download, step: '05', title: '최종 출력',
    desc: '정제 완료된 완벽한 데이터를 엑셀로 추출하여 업무에 바로 투입합니다.',
    theme: 'rose',
  },
];

const STEP_THEMES = {
  sky:     { text: 'text-sky-300',     border: 'border-sky-500/30',     iconBg: 'bg-sky-950/60',     iconBorder: 'border-sky-500/40',     glow: 'rgba(14,165,233,0.35)',   glowClass: 'from-sky-500/20 via-sky-600/10',     numColor: 'text-sky-500/60',     hoverTitle: 'group-hover:text-sky-300'     },
  violet:  { text: 'text-violet-300',  border: 'border-violet-500/30',  iconBg: 'bg-violet-950/60',  iconBorder: 'border-violet-500/40',  glow: 'rgba(139,92,246,0.35)',   glowClass: 'from-violet-500/20 via-violet-600/10', numColor: 'text-violet-500/60',  hoverTitle: 'group-hover:text-violet-300'  },
  emerald: { text: 'text-emerald-300', border: 'border-emerald-500/30', iconBg: 'bg-emerald-950/60', iconBorder: 'border-emerald-500/40', glow: 'rgba(16,185,129,0.35)',   glowClass: 'from-emerald-500/20 via-emerald-600/10', numColor: 'text-emerald-500/60', hoverTitle: 'group-hover:text-emerald-300' },
  amber:   { text: 'text-amber-300',   border: 'border-amber-500/30',   iconBg: 'bg-amber-950/60',   iconBorder: 'border-amber-500/40',   glow: 'rgba(245,158,11,0.35)',   glowClass: 'from-amber-500/20 via-amber-600/10',   numColor: 'text-amber-500/60',   hoverTitle: 'group-hover:text-amber-300'   },
  rose:    { text: 'text-rose-300',    border: 'border-rose-500/30',    iconBg: 'bg-rose-950/60',    iconBorder: 'border-rose-500/40',    glow: 'rgba(244,63,94,0.35)',    glowClass: 'from-rose-500/20 via-rose-600/10',     numColor: 'text-rose-500/60',    hoverTitle: 'group-hover:text-rose-300'    },
};

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
  return (
    <>
      압도적 성능의 파이프라인, <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-500" style={{ filter: 'drop-shadow(0 0 20px rgba(6,182,212,0.4))' }}>{userName}</span>님을 환영합니다.
    </>
  );
}

function getSubtitle(reason) {
  if (reason === 'upgrade') return '새로운 등급의 기능을 지금 바로 경험해 보세요.';
  if (reason === 'region') return '이제 NEXUS PIPELINE의 모든 기능을 이용하실 수 있습니다.';
  return '나노(Nano) 스케일의 입자 처리 알고리즘이 적용된 완벽한 워크플로우를 경험하십시오.';
}

// ── 개별 3D 틸트 카드 컴포넌트 ──
function TiltCard({ title, desc, icon: Icon, num, theme: themeKey = 'sky' }) {
  const t = STEP_THEMES[themeKey] || STEP_THEMES.sky;
  const cardRef = useRef(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const card = cardRef.current;
    const box = card.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    
    // 중앙 대비 상대값 (-0.5 ~ 0.5)
    const normalizedX = (x / box.width) - 0.5;
    const normalizedY = (y / box.height) - 0.5;

    setCoords({
      rotateX: -normalizedY * 30, // 최대 30도 회전
      rotateY: normalizedX * 30,
      lightX: x,
      lightY: y
    });
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setCoords({ rotateX: 0, rotateY: 0, lightX: 0, lightY: 0 });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative group cursor-pointer w-full"
      style={{ perspective: '1000px' }}
    >
      {/* 카드 외부 3D 회전 네온 백그라운드 섀도우 */}
      <div
        className={`absolute inset-0 bg-gradient-to-b ${t.glowClass} to-transparent opacity-0 group-hover:opacity-100 rounded-[2rem] blur-2xl transition-all duration-500`}
        style={{
          transform: isHovered
            ? `rotateX(${coords.rotateX}deg) rotateY(${coords.rotateY}deg) scale(1.05)`
            : 'rotateX(0deg) rotateY(0deg) scale(1)',
        }}
      />

      {/* 실제 3D 틸트 카드 바디 */}
      <div
        className={`relative bg-[#050b14]/75 backdrop-blur-2xl border ${t.border} rounded-[2rem] p-8 h-full flex flex-col gap-5 overflow-hidden transition-all duration-300 ease-out shadow-2xl`}
        style={{
          transformStyle: 'preserve-3d',
          transform: isHovered
            ? `rotateX(${coords.rotateX}deg) rotateY(${coords.rotateY}deg) translateZ(25px)`
            : 'rotateX(0deg) rotateY(0deg) translateZ(0px)',
          boxShadow: isHovered
            ? `0 30px 60px -15px ${t.glow}, inset 0 1px 2px rgba(255,255,255,0.15)`
            : '0 10px 30px -10px rgba(0,0,0,0.7), inset 0 1px 1px rgba(255,255,255,0.05)',
        }}
      >
        {/* 마우스 포인터 트래킹 3D 반사광 레이어 */}
        {isHovered && (
          <div
            className="absolute inset-0 pointer-events-none mix-blend-screen transition-opacity duration-300"
            style={{
              background: `radial-gradient(circle at ${coords.lightX}px ${coords.lightY}px, ${t.glow.replace('0.35', '0.22')} 0%, transparent 65%)`
            }}
          />
        )}

        <div className="flex justify-between items-start" style={{ transform: 'translateZ(40px)' }}>
          <div className={`w-14 h-14 rounded-2xl ${t.iconBg} flex items-center justify-center ${t.text} border ${t.iconBorder} group-hover:scale-110 transition-transform duration-300`}
            style={{ boxShadow: `0 0 20px ${t.glow.replace('0.35', '0.2')}` }}
          >
            <Icon size={28} strokeWidth={2.5} />
          </div>
          <div className={`text-[13px] font-black tracking-[0.3em] ${t.numColor}`}>{num}</div>
        </div>

        <div
          className={`text-white font-black text-lg tracking-tight mt-2 ${t.hoverTitle} transition-colors`}
          style={{ transform: 'translateZ(50px)' }}
        >
          {title}
        </div>
        
        <div 
          className="text-gray-400 text-[13px] leading-relaxed flex-1 font-medium group-hover:text-gray-300 transition-colors"
          style={{ transform: 'translateZ(30px)' }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}

export default function IntroScreen({ user, reason = 'new', meta = {}, onComplete }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    // 순차적인 3D 연출 스테이지 제어
    const t1 = setTimeout(() => setStage(1), 1200); // 3D 게이트 활짝 오픈
    const t2 = setTimeout(() => setStage(2), 2400); // 메인 콘텐츠 페이드인 & 3D 공간 배치
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleStart = () => {
    setStage(3); // 아웃트로 페이드아웃 시작
    setTimeout(onComplete, 700);
  };

  const userName = user?.realName || user?.displayName || '최고 관리자';

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden bg-[#010307] text-white font-sans selection:bg-cyan-500/30"
      style={{ 
        opacity: stage === 3 ? 0 : 1, 
        transform: stage === 3 ? 'scale(1.05)' : 'scale(1)',
        transition: 'opacity 700ms cubic-bezier(0.4, 0, 0.2, 1), transform 700ms cubic-bezier(0.4, 0, 0.2, 1)',
        perspective: '1500px'
      }}
    >
      {/* ── 3D 네온 홀로그램 그리드 바닥 ── */}
      <div 
        className="absolute inset-0 pointer-events-none" 
        style={{
          background: 'radial-gradient(circle at 50% 30%, #081125 0%, #010307 100%)',
          zIndex: 1
        }}
      />
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `
            linear-gradient(to right, #06b6d4 1px, transparent 1px),
            linear-gradient(to bottom, #06b6d4 1px, transparent 1px)
          `,
          backgroundSize: '80px 80px',
          transform: 'perspective(600px) rotateX(75deg) translateY(-100px) translateZ(-200px)',
          transformOrigin: '50% 0%',
          maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 80%)',
          zIndex: 2,
          animation: 'grid-flow 25s linear infinite'
        }}
      />

      <style>{`
        @keyframes grid-flow {
          0% { background-position: 0 0; }
          100% { background-position: 0 800px; }
        }
      `}</style>

      {/* ── 3D Perspective 게이트: 왼쪽 문 ── */}
      <div
        className="absolute top-0 left-0 h-full w-1/2 overflow-hidden border-r border-cyan-500/20 z-50"
        style={{
          transformStyle: 'preserve-3d',
          transformOrigin: 'left center',
          transform: stage >= 1 
            ? 'rotateY(-110deg) translateZ(50px) scale(0.95)' 
            : 'rotateY(0deg) translateZ(0px) scale(1)',
          opacity: stage >= 1.5 ? 0 : 1,
          visibility: stage >= 2 ? 'hidden' : 'visible',
          transition: 'transform 1400ms cubic-bezier(0.85, 0, 0.15, 1), opacity 1000ms, visibility 1400ms',
        }}
      >
        <div className="absolute inset-0 bg-[#02050a]/95 backdrop-blur-3xl" />
        <div className="absolute right-0 top-0 h-full w-[2px]"
          style={{ background: 'linear-gradient(to bottom, transparent, #06b6d4, #3b82f6, transparent)', boxShadow: '0 0 50px 8px rgba(6, 182, 212, 0.8)' }} />
        <div className="absolute inset-0 flex items-center justify-end pr-12 select-none" style={{ transform: 'translateZ(100px)' }}>
          <span className="text-[160px] font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-cyan-500/20 via-blue-500/10 to-transparent">NEX</span>
        </div>
      </div>

      {/* ── 3D Perspective 게이트: 오른쪽 문 ── */}
      <div
        className="absolute top-0 right-0 h-full w-1/2 overflow-hidden border-l border-cyan-500/20 z-50"
        style={{
          transformStyle: 'preserve-3d',
          transformOrigin: 'right center',
          transform: stage >= 1 
            ? 'rotateY(110deg) translateZ(50px) scale(0.95)' 
            : 'rotateY(0deg) translateZ(0px) scale(1)',
          opacity: stage >= 1.5 ? 0 : 1,
          visibility: stage >= 2 ? 'hidden' : 'visible',
          transition: 'transform 1400ms cubic-bezier(0.85, 0, 0.15, 1), opacity 1000ms, visibility 1400ms',
        }}
      >
        <div className="absolute inset-0 bg-[#02050a]/95 backdrop-blur-3xl" />
        <div className="absolute left-0 top-0 h-full w-[2px]"
          style={{ background: 'linear-gradient(to bottom, transparent, #06b6d4, #3b82f6, transparent)', boxShadow: '0 0 50px 8px rgba(6, 182, 212, 0.8)' }} />
        <div className="absolute inset-0 flex items-center justify-start pl-12 select-none" style={{ transform: 'translateZ(100px)' }}>
          <span className="text-[160px] font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-bl from-cyan-500/20 via-blue-500/10 to-transparent">US</span>
        </div>
      </div>

      {/* ── 게이트가 닫힌 상태 중앙 3D 입체 로고 ── */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-[60]"
        style={{
          opacity: stage === 0 ? 1 : 0,
          transform: stage === 0 ? 'scale(1) translateZ(100px)' : 'scale(1.2) translateZ(300px)',
          transition: 'all 1100ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <div className="text-center relative">
          <div className="absolute inset-0 bg-cyan-500 blur-[150px] opacity-40 rounded-full" />
          <div className="text-[85px] font-black tracking-[0.45em] text-white leading-none relative z-10 flex items-center justify-center gap-4">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500" style={{ filter: 'drop-shadow(0 0 50px rgba(6, 182, 212, 0.95))' }}>NEXUS</span>
          </div>
          <div className="text-base font-extrabold tracking-[1em] text-cyan-400 mt-6 uppercase relative z-10">
            Pipeline Core {APP_VERSION}
          </div>
        </div>
      </div>

      {/* ── 3D 메인 대시보드 구조 콘텐츠 ── */}
      <div
        className="absolute inset-0 flex items-center justify-center px-8 py-6 z-30"
        style={{
          opacity: stage >= 2 ? 1 : 0,
          transform: stage >= 2 
            ? 'translateY(0) rotateX(0deg) translateZ(0px)' 
            : 'translateY(40px) rotateX(15deg) translateZ(-150px)',
          transition: 'all 1000ms cubic-bezier(0.25, 1, 0.5, 1)',
          pointerEvents: stage >= 2 ? 'auto' : 'none',
        }}
      >
        <div className="w-full max-w-7xl relative">

          {/* 상단 3D 프리미엄 뱃지 및 문구 */}
          <div className="text-center mb-10" style={{ transformStyle: 'preserve-3d' }}>
            <div 
              className="inline-flex items-center gap-3 px-8 py-3 bg-gradient-to-r from-cyan-950/40 to-blue-950/40 border border-cyan-500/40 rounded-full text-cyan-300 text-[13px] font-black tracking-[0.3em] uppercase mb-8 backdrop-blur-2xl shadow-[0_0_40px_rgba(6,182,212,0.25)]"
              style={{ transform: 'translateZ(40px)' }}
            >
              <span className="w-3 h-3 rounded-full bg-cyan-400 opacity-90" style={{ boxShadow: '0 0 15px rgba(34,211,238,0.95)' }} />
              NEXUS CORE SECURED
            </div>
            <h1 
              className="text-[46px] lg:text-[54px] font-black text-white leading-tight mb-5 tracking-tight"
              style={{ transform: 'translateZ(60px)' }}
            >
              {getHeadline(reason, meta, userName)}
            </h1>
            <p 
              className="text-gray-400 text-base max-w-3xl mx-auto font-medium"
              style={{ transform: 'translateZ(30px)' }}
            >
              {getSubtitle(reason)}
            </p>
          </div>

          {/* 5단계 카드 레이아웃 (개별 3D Tilt 적용) */}
          <div 
            className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-12"
            style={{ transformStyle: 'preserve-3d' }}
          >
            {STEPS.map((s, i) => (
              <div 
                key={i} 
                className="relative"
                style={{ 
                  transform: `translateZ(${i * 15}px)`, // 계단식 Z 배치로 깊이감 형성
                  transformStyle: 'preserve-3d' 
                }}
              >
                <TiltCard
                  icon={s.icon}
                  num={s.step}
                  title={s.title}
                  desc={s.desc}
                  theme={s.theme}
                />
                {i < STEPS.length - 1 && (
                  <div 
                    className="absolute -right-3.5 top-1/2 -translate-y-1/2 z-10 hidden lg:block"
                    style={{ transform: 'translateZ(20px)' }}
                  >
                    <ArrowRight size={20} className="text-cyan-500/40" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 시작 버튼 */}
          <div className="text-center relative mt-4" style={{ transformStyle: 'preserve-3d' }}>
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-500 blur-[120px] opacity-25 rounded-full pointer-events-none" />
            <button
              onClick={handleStart}
              className="relative inline-flex items-center gap-5 px-20 py-6 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black rounded-[2rem] text-lg uppercase tracking-widest hover:from-cyan-400 hover:to-blue-500 hover:scale-105 active:scale-95 transition-all duration-300 shadow-[0_0_60px_rgba(6,182,212,0.45)] hover:shadow-[0_0_90px_rgba(6,182,212,0.7)]"
              style={{ 
                transform: 'translateZ(80px)',
                letterSpacing: '0.25em'
              }}
            >
              <Play size={22} fill="currentColor" className="text-white" />
              시스템 가동 시작
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
