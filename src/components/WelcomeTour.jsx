import { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Sparkles, Upload, FileSpreadsheet, MapPin, HelpCircle } from 'lucide-react';

// 첫 진입 가이드 투어 — 처음 1회만 표시 (localStorage). 핵심 기능을 슬라이드로 안내.
const SLIDES = [
  {
    icon: Sparkles, color: 'text-emerald-300',
    title: 'NEXUS PIPELINE에 오신 걸 환영합니다',
    body: '복지 명단 엑셀을 올리면 주소 정제 → 저장 → 배송 구역 배분까지 한 번에 처리하는 시스템입니다. 1분만 둘러볼게요.',
  },
  {
    icon: Upload, color: 'text-emerald-300',
    title: '① 쉬운 정제 — 올리면 끝',
    body: '파일만 올리면 지자체·월을 자동 인식해 바로 정제하고, 정제 엑셀이 다운로드 폴더로 자동 저장됩니다. 화면 하단 체크박스로 「리스트 보기 / 후편집」을 켤 수 있어요.',
  },
  {
    icon: FileSpreadsheet, color: 'text-amber-300',
    title: '② 특이사항 파일 이식 (선택)',
    body: '저장 직전 기초명단(특이사항 파일)을 추가하면 특이사항·배송순번을 자동으로 매칭해 채워줍니다. 헷갈리는 동명이인은 별도 시트로 빼서 확인할 수 있어요. 없으면 단순 정제만 됩니다.',
  },
  {
    icon: MapPin, color: 'text-blue-300',
    title: '③ 배송 구역 배정',
    body: '정제된 명단을 지도에 띄워 기사별 구역을 자동 N등분 + 브러시로 다듬고, 배송순번을 만들어 기사에게 공유 링크로 전달합니다.',
  },
  {
    icon: HelpCircle, color: 'text-emerald-300',
    title: '막히면 오른쪽 아래 「도움말」',
    body: '어느 화면에서든 오른쪽 아래 초록색 「도움말」 버튼을 누르면, 지금 보고 있는 화면에 맞는 설명서가 바로 열립니다. 언제든 다시 볼 수 있어요.',
  },
];

export default function WelcomeTour({ onClose }) {
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const s = SLIDES[i];
  const Icon = s.icon;

  return (
    <div className="fixed inset-0 z-[750] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-[#0a100c] border border-emerald-500/30 rounded-3xl shadow-[0_0_70px_rgba(16,185,129,0.25)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <span className="text-[10px] font-black tracking-widest text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded">처음 오셨나요?</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" title="건너뛰기"><X size={18} /></button>
        </div>

        <div className="px-7 py-8 text-center">
          <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center">
            <Icon size={30} className={s.color} />
          </div>
          <h2 className="text-lg font-black text-white mb-3">{s.title}</h2>
          <p className="text-sm text-gray-400 leading-relaxed min-h-[72px]">{s.body}</p>
        </div>

        {/* 점 인디케이터 */}
        <div className="flex items-center justify-center gap-1.5 pb-4">
          {SLIDES.map((_, idx) => (
            <span key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-5 bg-emerald-400' : 'w-1.5 bg-white/20'}`} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-white/10 bg-black/20">
          <button
            onClick={() => setI(v => Math.max(0, v - 1))}
            disabled={i === 0}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={14} /> 이전
          </button>
          <button onClick={onClose} className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors">건너뛰기</button>
          {last ? (
            <button onClick={onClose} className="flex items-center gap-1 px-5 py-2 rounded-lg text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
              시작하기
            </button>
          ) : (
            <button onClick={() => setI(v => Math.min(SLIDES.length - 1, v + 1))} className="flex items-center gap-1 px-4 py-2 rounded-lg text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
              다음 <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
