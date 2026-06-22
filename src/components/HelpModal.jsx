import { useState } from 'react';
import {
  X, Upload, FileSpreadsheet, Columns, Download, AlertTriangle,
  ChevronRight, ChevronLeft, ArrowRight, Zap, Star,
  Map, Database, Share2, Link, Cloud,
} from 'lucide-react';

const STEPS = [
  { key: 0, icon: '🏠', label: '전체 안내' },
  { key: 1, icon: '📁', label: '1단계: 파일 업로드' },
  { key: 2, icon: '📋', label: '2단계: 시트 선택' },
  { key: 3, icon: '🔗', label: '3단계: 컬럼 매핑' },
  { key: 5, icon: '✅', label: '4단계: 결과 검토' },
  { key: 6, icon: '☁️', label: '5단계: 클라우드 DB' },
  { key: 7, icon: '🗺️', label: '6단계: 루트맵 & 공유' },
];

/* ─── 공통 UI 빌딩블록 ─── */
const TIP = ({ children }) => (
  <div className="flex gap-3 bg-[#060c18] border border-[#3b82f6]/30 rounded-xl p-4 my-3">
    <span className="text-[#3b82f6] shrink-0 mt-0.5"><Zap size={15} /></span>
    <p className="text-[#93c5fd] text-sm leading-relaxed">{children}</p>
  </div>
);
const WARN = ({ children }) => (
  <div className="flex gap-3 bg-amber-950/40 border border-amber-500/30 rounded-xl p-4 my-3">
    <span className="text-amber-400 shrink-0 mt-0.5"><AlertTriangle size={15} /></span>
    <p className="text-amber-300 text-sm leading-relaxed">{children}</p>
  </div>
);
const Step = ({ num, title, desc }) => (
  <div className="flex gap-4 py-3 border-b border-white/5 last:border-0">
    <div className="w-8 h-8 rounded-full bg-[#3b82f6] text-black font-black text-sm flex items-center justify-center shrink-0">{num}</div>
    <div>
      <p className="text-white font-bold text-sm">{title}</p>
      {desc && <p className="text-gray-400 text-xs mt-1 leading-relaxed">{desc}</p>}
    </div>
  </div>
);
const Badge = ({ color, children }) => {
  const c = {
    green: 'bg-[#3b82f6]/20 text-[#3b82f6] border-[#3b82f6]/40',
    red:   'bg-red-950/50 text-red-400 border-red-700/40',
    amber: 'bg-amber-950/40 text-amber-400 border-amber-600/40',
    blue:  'bg-blue-950/40 text-blue-400 border-blue-700/40',
    gray:  'bg-gray-800/50 text-gray-300 border-gray-600/40',
  };
  return <span className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-bold border ${c[color] || c.gray}`}>{children}</span>;
};
const SectionTitle = ({ icon, title }) => (
  <div className="flex items-center gap-3 mb-5 pb-3 border-b border-white/10">
    <span className="text-2xl">{icon}</span>
    <h3 className="text-lg font-black text-white">{title}</h3>
  </div>
);

/* ─── 파이프라인 흐름도 ─── */
const PipelineDiagram = () => {
  const stages = [
    { icon: <Upload size={18}/>, label: '파일 업로드', color: '#3b82f6' },
    { icon: <FileSpreadsheet size={18}/>, label: '시트 선택', color: '#93c5fd' },
    { icon: <Columns size={18}/>, label: '컬럼 매핑', color: '#60a5fa' },
    { icon: <Zap size={18}/>, label: 'AI 정제', color: '#3b82f6' },
    { icon: <Download size={18}/>, label: '내보내기', color: '#93c5fd' },
    { icon: <Cloud size={18}/>, label: '클라우드 저장', color: '#60a5fa' },
    { icon: <Map size={18}/>, label: '루트맵 배분', color: '#3b82f6' },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap justify-center my-5">
      {stages.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-11 h-11 rounded-2xl border-2 flex items-center justify-center shadow-[0_0_12px_rgba(59,130,246,0.3)]"
              style={{ borderColor: s.color + '60', color: s.color, background: s.color + '15' }}>
              {s.icon}
            </div>
            <span className="text-[9px] text-gray-400 font-bold whitespace-nowrap">{s.label}</span>
          </div>
          {i < stages.length - 1 && <ChevronRight size={12} className="text-[#3b82f6]/40 mb-4 shrink-0" />}
        </div>
      ))}
    </div>
  );
};

/* ─── 컬럼 매핑 시각화 ─── */
const MappingVisual = () => (
  <div className="bg-black/40 rounded-xl p-4 my-4 border border-white/5">
    <div className="grid grid-cols-3 gap-2 text-xs">
      <div>
        <p className="text-gray-500 font-bold mb-2 text-center">엑셀 원본 컬럼</p>
        {['성명', '연락처', '도로명주소', '지원수량', '행정동명'].map(h => (
          <div key={h} className="bg-[#111] border border-gray-700 rounded-lg px-3 py-1.5 mb-1.5 text-gray-300 font-mono">{h}</div>
        ))}
      </div>
      <div className="flex flex-col items-center justify-center gap-3 pt-8">
        {[...Array(5)].map((_, i) => <ArrowRight key={i} size={16} className="text-[#3b82f6]/60" />)}
      </div>
      <div>
        <p className="text-gray-500 font-bold mb-2 text-center">시스템 필드</p>
        {[
          { label: '이름', color: 'text-blue-300 border-blue-700/50 bg-blue-950/30' },
          { label: '연락처', color: 'text-blue-300 border-blue-700/50 bg-blue-950/30' },
          { label: '주소', color: 'text-yellow-300 border-yellow-700/50 bg-yellow-950/30' },
          { label: '포수', color: 'text-orange-300 border-orange-700/50 bg-orange-950/30' },
          { label: '행정동', color: 'text-purple-300 border-purple-700/50 bg-purple-950/30' },
        ].map(f => (
          <div key={f.label} className={`border rounded-lg px-3 py-1.5 mb-1.5 font-bold ${f.color}`}>{f.label} ★필수</div>
        ))}
      </div>
    </div>
  </div>
);

/* ─── 오류 예시 ─── */
const ErrorExample = () => (
  <div className="my-4 rounded-xl overflow-hidden border border-white/10 text-xs font-mono">
    <div className="bg-[#111] px-4 py-2 text-gray-500 font-bold border-b border-white/5">결과 그리드 예시</div>
    <div className="bg-red-950/20 border-l-4 border-l-red-500 px-4 py-2.5 flex gap-6 text-red-400">
      <span className="text-red-500 font-black">1</span>
      <span>홍길동</span><span>010-1234-5678</span>
      <span className="text-red-400 italic">서울시 종로구 ○○로 → 도로명 미발견</span>
    </div>
    <div className="bg-transparent px-4 py-2.5 flex gap-6 text-gray-300">
      <span className="text-gray-500 font-black">2</span>
      <span>김철수</span><span>010-9876-5432</span>
      <span className="text-[#3b82f6]">서울특별시 종로구 세종대로 209</span>
    </div>
  </div>
);

/* ─── 클라우드 DB 구조 다이어그램 ─── */
const CloudDBDiagram = () => (
  <div className="bg-[#080808] border border-[#1e1e1e] rounded-xl p-4 my-4 text-xs font-mono">
    <div className="flex items-center gap-2 mb-3">
      <Database size={14} className="text-[#3b82f6]" />
      <span className="text-[#3b82f6] font-black">Firestore 컬렉션 구조</span>
    </div>
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-amber-400">📁</span>
        <span className="text-amber-300 font-bold">base_lists</span>
        <span className="text-gray-600">/ {'{cityId}'} / records / {'{id}'}</span>
      </div>
      <div className="ml-6 text-gray-500">→ 기본명단 (수급자 영구 DB, 기사·순번·특이사항 포함)</div>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-blue-400">📁</span>
        <span className="text-blue-300 font-bold">cloud_lists</span>
        <span className="text-gray-600">/ {'{cityId}'} / months / {'{YYYY-MM}'} / records / {'{id}'}</span>
      </div>
      <div className="ml-6 text-gray-500">→ 월별 배송명단 (정제 결과 저장, 루트맵 원본)</div>
    </div>
    <div className="mt-4 pt-3 border-t border-[#1a1a1a] grid grid-cols-2 gap-3">
      <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-2">
        <div className="text-amber-400 font-black text-[10px] mb-1">기본명단 용도</div>
        <div className="text-gray-500 text-[10px]">기사·순번 이식 소스<br/>신규 명단과 3순위 매칭<br/>누적 저장 (덮어쓰기 X)</div>
      </div>
      <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg p-2">
        <div className="text-blue-400 font-black text-[10px] mb-1">월별명단 용도</div>
        <div className="text-gray-500 text-[10px]">루트맵 데이터 소스<br/>기사·배송순번 저장<br/>월별 덮어쓰기 가능</div>
      </div>
    </div>
  </div>
);

/* ─── 루트맵 레이아웃 다이어그램 ─── */
const MapLayoutDiagram = () => (
  <div className="relative bg-[#080808] border border-[#222] rounded-xl overflow-hidden my-4" style={{ height: '210px' }}>
    {/* Left driver panel */}
    <div className="absolute left-0 top-0 bottom-0 w-32 bg-[#0a0a0a] border-r border-[#1a1a1a] flex flex-col">
      <div className="px-2 py-1.5 border-b border-[#1a1a1a]">
        <div className="text-[8px] text-[#3b82f6] font-black tracking-wider">기사 목록</div>
      </div>
      {[
        { color: '#ef4444', name: '김기사', load: '310포', overlap: false },
        { color: '#22c55e', name: '이기사', load: '285포', overlap: false },
        { color: '#f59e0b', name: '박기사', load: '305포', overlap: true },
      ].map((d, i) => (
        <div key={i} className="mx-1.5 mt-1.5 bg-[#111] border border-[#1e1e1e] rounded p-1.5">
          <div className="flex items-center gap-1 mb-1">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="text-[8px] text-white font-bold flex-1">{d.name}</span>
            <span className="text-[7px] text-gray-600">{d.load}</span>
          </div>
          <div className="flex gap-1">
            <div className="text-[7px] bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-gray-500">📍핀</div>
            <div className="text-[7px] bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-gray-500">🖌브러시</div>
          </div>
        </div>
      ))}
      <div className="mx-1.5 mt-1 text-[7px] text-gray-700 px-1">겹침: 0건 ✓</div>
    </div>
    {/* Map canvas */}
    <div className="absolute left-32 right-0 top-0 bottom-0 bg-[#12151f] overflow-hidden">
      {/* Fake street grid */}
      <div className="absolute inset-0 opacity-[0.07]">
        {[15,30,45,60,75,90].map(y => <div key={y} className="absolute left-0 right-0 h-px bg-white" style={{ top: `${y}%` }} />)}
        {[15,30,45,60,75,90].map(x => <div key={x} className="absolute top-0 bottom-0 w-px bg-white" style={{ left: `${x}%` }} />)}
      </div>
      {/* Zone blobs */}
      <div className="absolute rounded-full opacity-[0.12]" style={{ background: '#ef4444', width: 90, height: 90, left: '2%', top: '5%' }} />
      <div className="absolute rounded-full opacity-[0.12]" style={{ background: '#22c55e', width: 100, height: 100, left: '32%', top: '25%' }} />
      <div className="absolute rounded-full opacity-[0.12]" style={{ background: '#f59e0b', width: 85, height: 85, right: '3%', top: '10%' }} />
      {/* Delivery dots */}
      {[
        { x: '6%', y: '18%', c: '#ef4444' }, { x: '12%', y: '32%', c: '#ef4444' }, { x: '18%', y: '22%', c: '#ef4444' }, { x: '8%', y: '52%', c: '#ef4444' },
        { x: '38%', y: '42%', c: '#22c55e' }, { x: '46%', y: '55%', c: '#22c55e' }, { x: '52%', y: '38%', c: '#22c55e' }, { x: '42%', y: '68%', c: '#22c55e' },
        { x: '66%', y: '20%', c: '#f59e0b' }, { x: '74%', y: '32%', c: '#f59e0b' }, { x: '70%', y: '48%', c: '#f59e0b' }, { x: '80%', y: '22%', c: '#f59e0b' },
      ].map((d, i) => (
        <div key={i} className="absolute w-2 h-2 rounded-full border border-black/40 shadow-sm" style={{ background: d.c, left: d.x, top: d.y, transform: 'translate(-50%,-50%)' }}>
          <span className="absolute inset-0 flex items-center justify-center text-[5px] text-white font-black">{i + 1}</span>
        </div>
      ))}
      {/* Polylines approximated */}
      <div className="absolute text-[8px] text-gray-600 font-bold" style={{ bottom: 6, right: 8 }}>카카오 지도</div>
    </div>
    {/* Top toolbar */}
    <div className="absolute top-0 left-32 right-0 h-7 bg-[#060606] border-b border-[#1a1a1a] flex items-center px-2 gap-1.5">
      {[
        { label: '자동 3등분', active: false },
        { label: '겹침 해소', active: false },
        { label: '카카오맵 저장', active: true },
        { label: '공유', active: true },
      ].map(b => (
        <div key={b.label} className={`text-[7px] rounded px-1.5 py-0.5 border font-bold ${b.active ? 'bg-[#3b82f6]/20 border-[#3b82f6]/40 text-[#3b82f6]' : 'bg-[#111] border-[#222] text-gray-600'}`}>{b.label}</div>
      ))}
    </div>
    {/* Legend */}
    <div className="absolute bottom-2 right-2 text-[7px] text-gray-700 text-right leading-relaxed">
      ● 배송지 핀<br/>원 = 기사 구역
    </div>
  </div>
);

/* ─── 핀 배치 단계 다이어그램 ─── */
const PinPlacementDiagram = () => (
  <div className="grid grid-cols-3 gap-2 my-4">
    {[
      {
        step: '①',
        title: '핀꽂기 클릭',
        color: '#ef4444',
        content: (
          <div className="bg-[#111] border border-[#1e1e1e] rounded p-2">
            <div className="flex items-center gap-1 mb-1">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-[9px] text-white font-bold">김기사</span>
            </div>
            <div className="flex gap-1">
              <div className="text-[8px] bg-red-900/40 border border-red-600/40 rounded px-1.5 py-0.5 text-red-300 font-bold ring-1 ring-red-400/60">📍 핀꽂기</div>
            </div>
            <div className="text-[7px] text-red-400 mt-1">← 클릭!</div>
          </div>
        ),
      },
      {
        step: '②',
        title: '지도 클릭',
        color: '#f59e0b',
        content: (
          <div className="bg-[#12151f] border border-[#222] rounded overflow-hidden" style={{ height: 64 }}>
            <div className="absolute inset-0 opacity-5">
              {[25,50,75].map(y => <div key={y} className="absolute left-0 right-0 h-px bg-white" style={{ top: `${y}%` }} />)}
            </div>
            <div className="relative h-full flex items-center justify-center">
              <div className="text-amber-400 text-[20px] animate-pulse">✛</div>
              <div className="absolute text-[7px] text-amber-600 bottom-1 left-0 right-0 text-center">커서 변경됨 — 클릭!</div>
            </div>
          </div>
        ),
      },
      {
        step: '③',
        title: '핀 확정',
        color: '#22c55e',
        content: (
          <div className="bg-[#12151f] border border-[#222] rounded overflow-hidden" style={{ height: 64 }}>
            <div className="relative h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-4 h-4 rounded-full bg-red-500 border-2 border-white shadow-[0_0_8px_rgba(239,68,68,0.8)] flex items-center justify-center">
                  <span className="text-[6px] text-white font-black">📍</span>
                </div>
                <div className="text-[7px] text-green-400 font-bold">거점 설정 완료</div>
              </div>
            </div>
          </div>
        ),
      },
    ].map((item) => (
      <div key={item.step} className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-2">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[#3b82f6] font-black text-sm">{item.step}</span>
          <span className="text-white text-[10px] font-bold">{item.title}</span>
        </div>
        {item.content}
      </div>
    ))}
  </div>
);

/* ─── 자동 N등분 비교 다이어그램 ─── */
const ZoneDiagram = () => (
  <div className="grid grid-cols-2 gap-3 my-4">
    {[
      { label: '배분 전', dots: Array(12).fill('#555'), zones: [] },
      { label: '자동 3등분 후', dots: ['#ef4444','#ef4444','#ef4444','#ef4444','#22c55e','#22c55e','#22c55e','#22c55e','#f59e0b','#f59e0b','#f59e0b','#f59e0b'], zones: ['#ef4444','#22c55e','#f59e0b'] },
    ].map((v, vi) => (
      <div key={vi} className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl overflow-hidden">
        <div className={`px-3 py-1.5 text-[10px] font-black border-b border-[#1a1a1a] ${vi === 1 ? 'text-[#3b82f6]' : 'text-gray-500'}`}>{v.label}</div>
        <div className="relative bg-[#12151f]" style={{ height: 100 }}>
          {v.zones.map((c, i) => (
            <div key={i} className="absolute rounded-full opacity-[0.15]" style={{ background: c, width: 60, height: 60, left: `${10 + i * 28}%`, top: '20%', transform: 'translateY(-50%)' }} />
          ))}
          {[
            { x: '10%', y: '30%' }, { x: '20%', y: '55%' }, { x: '15%', y: '70%' }, { x: '25%', y: '40%' },
            { x: '42%', y: '35%' }, { x: '50%', y: '60%' }, { x: '45%', y: '75%' }, { x: '55%', y: '45%' },
            { x: '68%', y: '30%' }, { x: '76%', y: '55%' }, { x: '72%', y: '70%' }, { x: '82%', y: '40%' },
          ].map((pos, i) => (
            <div key={i} className="absolute w-2.5 h-2.5 rounded-full border border-black/40 shadow flex items-center justify-center"
              style={{ background: v.dots[i], left: pos.x, top: pos.y, transform: 'translate(-50%,-50%)' }}>
              <span className="text-[5px] text-white font-black">{i + 1}</span>
            </div>
          ))}
        </div>
        {vi === 1 && (
          <div className="px-3 py-1.5 flex gap-2 border-t border-[#1a1a1a]">
            {[['#ef4444','김기사 310포'],['#22c55e','이기사 285포'],['#f59e0b','박기사 305포']].map(([c,l]) => (
              <div key={l} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: c }} />
                <span className="text-[8px] text-gray-400">{l}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    ))}
  </div>
);

/* ─── 페인트 브러시 다이어그램 ─── */
const PaintBrushDiagram = () => (
  <div className="grid grid-cols-2 gap-3 my-4">
    <div className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl overflow-hidden">
      <div className="px-3 py-1.5 text-[10px] font-black text-amber-400 border-b border-[#1a1a1a]">① 브러시 모드 진입</div>
      <div className="p-2 space-y-1.5">
        <div className="bg-[#111] border border-amber-600/40 rounded p-2 ring-1 ring-amber-400/30">
          <div className="flex items-center gap-1 mb-1">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-[9px] text-white font-bold">이기사</span>
          </div>
          <div className="text-[8px] bg-amber-900/30 border border-amber-600/30 rounded px-1.5 py-0.5 text-amber-300 font-bold inline-block">🖌️ 브러시 ON</div>
        </div>
        <div className="text-[8px] text-amber-500 px-1">← 기사 카드에서 클릭</div>
        <div className="flex gap-1 px-1">
          {[['소','30'],['중','60'],['대','100'],['특대','160']].map(([l]) => (
            <div key={l} className={`flex-1 text-center text-[8px] rounded py-0.5 border ${l==='중'?'bg-amber-500/20 border-amber-400/40 text-amber-300':'bg-[#111] border-[#222] text-gray-600'}`}>{l}</div>
          ))}
        </div>
        <div className="text-[7px] text-gray-600 px-1">브러시 반경 크기 선택</div>
      </div>
    </div>
    <div className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl overflow-hidden">
      <div className="px-3 py-1.5 text-[10px] font-black text-[#3b82f6] border-b border-[#1a1a1a]">② 지도에서 드래그하여 칠하기</div>
      <div className="relative bg-[#12151f]" style={{ height: 110 }}>
        {/* Zone background */}
        <div className="absolute rounded-full opacity-10" style={{ background: '#f59e0b', width: 80, height: 80, left: '10%', top: '10%' }} />
        {/* Brush circle */}
        <div className="absolute rounded-full border-2 border-green-400/80 bg-green-400/10"
          style={{ width: 60, height: 60, left: '35%', top: '25%', transform: 'translate(-50%,-50%)' }}
        />
        <div className="absolute text-[7px] text-green-400 font-bold" style={{ left: '35%', top: '60%', transform: 'translateX(-50%)' }}>드래그 중</div>
        {/* Dots — before and after brush */}
        {[
          { x: '15%', y: '35%', c: '#f59e0b', after: false },
          { x: '22%', y: '50%', c: '#f59e0b', after: false },
          { x: '32%', y: '30%', c: '#22c55e', after: true },
          { x: '40%', y: '45%', c: '#22c55e', after: true },
          { x: '45%', y: '32%', c: '#22c55e', after: true },
          { x: '65%', y: '35%', c: '#f59e0b', after: false },
          { x: '72%', y: '55%', c: '#f59e0b', after: false },
        ].map((d, i) => (
          <div key={i} className="absolute w-2.5 h-2.5 rounded-full border border-black/40 shadow"
            style={{ background: d.c, left: d.x, top: d.y, transform: 'translate(-50%,-50%)', opacity: d.after ? 1 : 0.7 }}>
            {d.after && <div className="absolute -top-2 -right-1 text-[6px] text-green-400 font-black">✓</div>}
          </div>
        ))}
        <div className="absolute text-[7px] text-gray-600" style={{ bottom: 4, right: 6 }}>✓ = 이기사로 변경됨</div>
      </div>
    </div>
  </div>
);

/* ─── 공유 링크 모달 다이어그램 ─── */
const ShareModalDiagram = () => (
  <div className="bg-[#0a0a0a] border border-[#222] rounded-xl overflow-hidden my-4">
    {/* Modal header */}
    <div className="bg-[#080808] px-4 py-2.5 border-b border-[#1a1a1a] flex items-center gap-2">
      <Share2 size={13} className="text-[#3b82f6]" />
      <span className="text-white font-black text-xs">루트 공유 링크 생성 완료</span>
      <span className="text-gray-600 text-[10px] ml-auto">동대문구 2025-05</span>
    </div>
    <div className="p-3 space-y-2">
      {[
        { color: '#ef4444', name: '김기사', count: 38 },
        { color: '#22c55e', name: '이기사', count: 34 },
        { color: '#f59e0b', name: '박기사', count: 37 },
      ].map((d, i) => (
        <div key={i} className="bg-[#111] border border-[#1e1e1e] rounded-xl p-2.5 flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-black text-[11px]">{d.name}</span>
              <span className="text-gray-600 text-[10px]">{d.count}건</span>
            </div>
            <div className="text-[10px] text-gray-600 font-mono truncate mt-0.5">
              https://logis-op.web.app/?r=sr_abc…&d=drv{i + 1}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <div className="text-[9px] bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-gray-400 font-bold">복사</div>
            <div className="text-[9px] bg-[#3b82f6]/20 border border-[#3b82f6]/40 rounded px-2 py-1 text-[#3b82f6] font-bold flex items-center gap-1">
              <Link size={8} /> 열기
            </div>
          </div>
        </div>
      ))}
    </div>
    <div className="px-4 pb-3 text-[9px] text-gray-600">
      ※ 기사가 링크를 스마트폰에서 열면 자신의 배송 지도와 목록이 표시됩니다
    </div>
  </div>
);

/* ─── 기사 스마트폰 화면 다이어그램 ─── */
const DriverViewDiagram = () => (
  <div className="flex gap-4 my-4 justify-center">
    {/* Phone mockup - Map view */}
    <div className="bg-[#050505] border border-[#333] rounded-2xl overflow-hidden" style={{ width: 130, height: 220 }}>
      {/* Phone status bar */}
      <div className="bg-[#0a0a0a] px-2 py-1.5 border-b border-[#222]">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <div className="flex-1 text-[8px] text-white font-black">김기사 배송 루트</div>
        </div>
        <div className="text-[7px] text-gray-600">동대문구 2025-05 | 38건</div>
      </div>
      {/* Tab bar */}
      <div className="flex border-b border-[#1a1a1a]">
        <div className="flex-1 py-1.5 text-[8px] text-[#3b82f6] font-black text-center bg-[#0a1a0a]">🗺️ 지도</div>
        <div className="flex-1 py-1.5 text-[8px] text-gray-600 font-black text-center">☰ 목록</div>
      </div>
      {/* Map area */}
      <div className="relative bg-[#12151f] flex-1" style={{ height: 130 }}>
        <div className="absolute rounded-full opacity-10 bg-red-500" style={{ width: 80, height: 80, left: '10%', top: '5%' }} />
        {[
          { x: '18%', y: '25%', n: 1 }, { x: '28%', y: '40%', n: 2 }, { x: '22%', y: '55%', n: 3 },
          { x: '40%', y: '30%', n: 4 }, { x: '52%', y: '48%', n: 5 }, { x: '60%', y: '65%', n: 6 },
          { x: '70%', y: '38%', n: 7 }, { x: '78%', y: '55%', n: 8 },
        ].map((d, i) => (
          <div key={i} className="absolute rounded-full border border-white/30 flex items-center justify-center"
            style={{ background: '#ef4444', width: 14, height: 14, left: d.x, top: d.y, transform: 'translate(-50%,-50%)', fontSize: 6, color: 'white', fontWeight: 900 }}>
            {d.n}
          </div>
        ))}
        <div className="absolute text-[7px] text-gray-700 font-bold" style={{ bottom: 3, right: 5 }}>카카오 지도</div>
      </div>
      {/* Footer */}
      <div className="bg-[#080808] px-2 py-1 text-[7px] text-gray-700 text-center border-t border-[#1a1a1a]">
        일반 배송 30건 · 아파트 8건
      </div>
    </div>
    {/* Phone mockup - List view */}
    <div className="bg-[#050505] border border-[#333] rounded-2xl overflow-hidden" style={{ width: 130, height: 220 }}>
      <div className="bg-[#0a0a0a] px-2 py-1.5 border-b border-[#222]">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <div className="flex-1 text-[8px] text-white font-black">김기사 배송 루트</div>
        </div>
        <div className="text-[7px] text-gray-600">동대문구 2025-05 | 38건</div>
      </div>
      <div className="flex border-b border-[#1a1a1a]">
        <div className="flex-1 py-1.5 text-[8px] text-gray-600 font-black text-center">🗺️ 지도</div>
        <div className="flex-1 py-1.5 text-[8px] text-[#3b82f6] font-black text-center bg-[#0a1a0a]">☰ 목록</div>
      </div>
      <div className="overflow-hidden" style={{ height: 152 }}>
        {[
          { n: 1, name: '홍길동', addr: '청운효자동 | 자하문로 18' },
          { n: 2, name: '김철수', addr: '사직동 | 사직로 43' },
          { n: 3, name: '이영희', addr: '청운효자동 | 필운대로 8' },
          { n: 4, name: '박민수', addr: '삼청동 | 삼청로 12' },
        ].map((r) => (
          <div key={r.n} className="flex items-center gap-2 px-2 py-2 border-b border-[#111]">
            <div className="w-5 h-5 rounded-full bg-red-600 flex items-center justify-center shrink-0">
              <span className="text-[7px] text-white font-black">{r.n}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] text-white font-bold">{r.name}</div>
              <div className="text-[7px] text-gray-600 truncate">{r.addr}</div>
            </div>
          </div>
        ))}
        <div className="px-2 py-1.5 text-[8px] text-orange-700 font-black border-t border-[#1a1a1a]">🏢 아파트 8건</div>
      </div>
    </div>
  </div>
);

/* ─── 저장 방법 비교 다이어그램 ─── */
const SaveMethodDiagram = () => (
  <div className="grid grid-cols-2 gap-3 my-4">
    <div className="bg-[#080808] border border-[#1e1e1e] rounded-xl p-3">
      <div className="text-[#3b82f6] font-black text-xs mb-2">💾 세션 저장</div>
      <div className="space-y-1.5 mb-3">
        {['기사 구역 배정 저장','다음번에 불러오기 가능','루트맵 내에서만 유효'].map(t => (
          <div key={t} className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <span className="text-[#3b82f6] text-[8px]">✓</span>{t}
          </div>
        ))}
      </div>
      <div className="text-[9px] bg-[#3b82f6]/10 border border-[#3b82f6]/20 rounded-lg px-2 py-1.5 text-[#3b82f6]">
        언제든 이어서 작업 가능
      </div>
    </div>
    <div className="bg-[#080808] border border-amber-800/30 rounded-xl p-3">
      <div className="text-amber-400 font-black text-xs mb-2">☁️ 카카오맵 저장</div>
      <div className="space-y-1.5 mb-3">
        {['cloud_lists에 기사/순번 반영','공유 링크로 기사에게 전달','배송 앱 연동 가능'].map(t => (
          <div key={t} className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <span className="text-amber-400 text-[8px]">✓</span>{t}
          </div>
        ))}
      </div>
      <div className="text-[9px] bg-amber-900/20 border border-amber-700/30 rounded-lg px-2 py-1.5 text-amber-400">
        겹침 0건일 때만 활성화
      </div>
    </div>
  </div>
);

/* ─── 메인 콘텐츠 ─── */
const CONTENT = {
  0: {
    title: '전체 시스템 안내',
    subtitle: 'NEXUS PIPELINE v4 — 전체 워크플로우',
    sections: [
      {
        id: 'intro', icon: '🚀', title: '이 시스템은 무엇인가요?',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              <span className="text-[#3b82f6] font-black">NEXUS PIPELINE</span>은 지자체 복지 명단 엑셀 파일을 받아
              주소를 정제하고, 클라우드 DB에 저장하며, 배송 기사에게 최적 구역을 자동 배분하는 올인원 시스템입니다.
            </p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { icon: '⚡', title: '초고속 AI 정제', desc: '수천 건 주소를 수 분 내 도로명 변환' },
                { icon: '☁️', title: '클라우드 DB', desc: '기본명단·월별 명단 영구 관리' },
                { icon: '🗺️', title: '루트맵 배분', desc: '기사별 최적 구역 자동 배분 + 공유' },
              ].map(f => (
                <div key={f.title} className="bg-black/40 border border-white/5 rounded-xl p-4 text-center">
                  <div className="text-2xl mb-2">{f.icon}</div>
                  <p className="text-white font-black text-sm">{f.title}</p>
                  <p className="text-gray-500 text-xs mt-1">{f.desc}</p>
                </div>
              ))}
            </div>
            <TIP>처음 사용하시는 분은 이 안내를 순서대로 읽으시면 5분 안에 전체 흐름을 파악할 수 있습니다.</TIP>
          </div>
        ),
      },
      {
        id: 'three-modes', icon: '🧭', title: '3가지 정제 방식',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              상황에 맞게 <span className="text-emerald-300 font-black">3가지 방식</span> 중 하나로 작업합니다.
            </p>
            <div className="space-y-3">
              {[
                {
                  icon: '⚡', name: '① 쉬운 정제 (자동 저장)', color: 'border-emerald-500/40 bg-emerald-950/15',
                  desc: '파일만 올리면 지자체·월 자동 인식 → 바로 정제 → 정제 엑셀이 다운로드 폴더로 자동 저장. 업로드 화면 하단 체크박스로 동작을 고릅니다.',
                  bullets: [
                    '체크 없음 → 정제 엑셀 바로 다운로드',
                    '「리스트 보기」/「후편집하기」 체크 → 결과 화면으로',
                    '저장 직전 「기초명단(특이사항 파일)」을 추가하면 특이사항·배송순번을 자동 매칭 이식 (없으면 단순 정제만)',
                  ],
                },
                {
                  icon: '📝', name: '② 리스트 보기 · 후편집', color: 'border-cyan-500/40 bg-cyan-950/15',
                  desc: '정제 결과를 화면 표에서 직접 보고 수정합니다. 셀 클릭 편집, 오류만 모아보기, 행정동·소속사 보고서, 기본명단/월별명단 저장까지.',
                  bullets: ['주소 직접 수정 후 Enter로 재정제', '행정동 보고서 / 소속사 보고서 엑셀 분리', '기본명단·이번달 명단 클라우드 저장'],
                },
                {
                  icon: '🗺️', name: '③ 배송 구역 배정 (루트맵)', color: 'border-blue-500/40 bg-blue-950/15',
                  desc: '정제된 명단을 지도에 띄워 기사별 구역을 자동/수동 배분하고 배송순번을 만듭니다.',
                  bullets: ['자동 N등분 + 브러시 수동 보정', '혼재(같은 아파트 단지 갈라짐)만 점검', '기사 공유 링크로 전달'],
                },
              ].map(m => (
                <div key={m.name} className={`rounded-xl border p-4 ${m.color}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-lg">{m.icon}</span>
                    <span className="text-white font-black text-sm">{m.name}</span>
                  </div>
                  <p className="text-gray-400 text-xs leading-relaxed mb-2">{m.desc}</p>
                  <ul className="space-y-1">
                    {m.bullets.map(b => (
                      <li key={b} className="text-gray-500 text-[11px] flex items-start gap-1.5">
                        <span className="text-emerald-400 mt-0.5">•</span><span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <TIP>오른쪽 아래 초록색 「도움말」 버튼은 어느 화면에서든 누르면 그 화면에 맞는 설명이 열립니다.</TIP>
          </div>
        ),
      },
      {
        id: 'pipeline', icon: '🔄', title: '7단계 처리 흐름',
        render: () => (
          <div>
            <PipelineDiagram />
            <div className="space-y-2">
              <Step num="1" title="엑셀 파일 업로드" desc="신규 처리 명단 파일(.xlsx/.xls/.csv)을 올립니다." />
              <Step num="2" title="워크시트 분류" desc="시트를 선택하고 수급자 유형(기초/차상위/혼합)을 지정합니다." />
              <Step num="3" title="컬럼 매핑" desc="엑셀 열 이름과 시스템 필드를 연결합니다. 대부분 AI가 자동 처리합니다." />
              <Step num="4" title="AI 주소 정제" desc="행정안전부 도로명주소 API로 모든 주소를 표준 도로명으로 변환합니다." />
              <Step num="5" title="결과 검토 및 내보내기" desc="오류 항목 수정 후 표준 엑셀 파일로 내보냅니다." />
              <Step num="6" title="클라우드 DB 저장" desc="정제된 명단을 기본명단(base_lists) 또는 월별 명단(cloud_lists)에 저장합니다." />
              <Step num="7" title="루트맵 배분 & 공유" desc="지도에서 기사 구역을 자동 배분하고, 개인 공유 링크를 기사에게 전달합니다." />
            </div>
          </div>
        ),
      },
      {
        id: 'files', icon: '📂', title: '지원 파일 형식',
        render: () => (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { ext: '.xlsx', label: 'Excel 2007+', desc: '권장 형식', ok: true },
                { ext: '.xls', label: 'Excel 97-2003', desc: '구형 엑셀', ok: true },
                { ext: '.csv', label: 'CSV 텍스트', desc: '구분자 파일', ok: true },
              ].map(f => (
                <div key={f.ext} className="bg-[#060c18] border border-[#3b82f6]/20 rounded-xl p-4 text-center">
                  <div className="text-[#3b82f6] font-black text-xl mb-1">{f.ext}</div>
                  <div className="text-white text-xs font-bold">{f.label}</div>
                  <div className="text-gray-500 text-xs">{f.desc}</div>
                  <Badge color="green">지원</Badge>
                </div>
              ))}
            </div>
            <WARN>파일 크기는 최대 <strong>50MB</strong>까지 지원합니다. 초과 시 시트를 분리하여 업로드하세요.</WARN>
            <TIP>여러 시트가 있어도 괜찮습니다. 2단계에서 처리할 시트를 선택할 수 있습니다.</TIP>
          </div>
        ),
      },
      {
        id: 'base', icon: '👑', title: '이전 명단 이식이란?',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              이전에 정제된 명단 또는 기본명단에 저장된 기사 배정·배송순번·특이사항을 신규 명단에 자동 이식합니다.
              3단계 하단 오른쪽 패널에서 파일을 올리면 즉시 연결됩니다.
            </p>
            <div className="space-y-2 mb-3">
              {[
                { num: '①', badge: '이름 + 생년월일', desc: '6자리 생년월일이 일치 (최우선)' },
                { num: '②', badge: '이름 + 휴대폰번호', desc: '휴대폰번호가 일치 (2순위)' },
                { num: '③', badge: '이름 + 추가연락처', desc: '유선·추가 연락처가 일치 (3순위)' },
              ].map(m => (
                <div key={m.num} className="flex items-center gap-3 text-xs text-gray-400 p-2 bg-black/30 rounded-lg">
                  <span className="text-[#3b82f6] font-black shrink-0">{m.num}</span>
                  <Badge color="green">{m.badge}</Badge>
                  <span>{m.desc}</span>
                </div>
              ))}
            </div>
            <TIP>이식된 행은 NO 칸에 <span className="text-[#3b82f6]">👑</span> 아이콘이 표시됩니다.</TIP>
            <WARN>이전 명단에 동일한 키가 중복 존재하면 해당 행이 빨간색(확인필요)로 표시됩니다.</WARN>
          </div>
        ),
      },
    ],
  },

  1: {
    title: '1단계: 파일 업로드',
    subtitle: '처리할 명단 엑셀 파일을 올려주세요',
    sections: [
      {
        id: 'how', icon: '📤', title: '파일을 올리는 방법',
        render: () => (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-[#060c18] border border-[#3b82f6]/30 rounded-xl p-4">
                <div className="text-3xl mb-2 text-center">🖱️</div>
                <p className="text-white font-black text-sm text-center mb-2">드래그 앤 드롭</p>
                <p className="text-gray-400 text-xs text-center leading-relaxed">파일을 화면 중앙의 점선 영역으로 끌어다 놓습니다</p>
              </div>
              <div className="bg-[#060c18] border border-[#3b82f6]/30 rounded-xl p-4">
                <div className="text-3xl mb-2 text-center">👆</div>
                <p className="text-white font-black text-sm text-center mb-2">클릭하여 선택</p>
                <p className="text-gray-400 text-xs text-center leading-relaxed">업로드 영역을 클릭하면 파일 선택 창이 열립니다</p>
              </div>
            </div>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-3">
              <p className="text-[#3b82f6] font-black text-xs mb-1.5">이 단계에서는 신규 처리 명단 1개만 올립니다</p>
              <p className="text-gray-400 text-xs leading-relaxed">추가 명단 파일 병합과 이전 명단 등록은 <b>3단계 하단 패널</b>에서 진행합니다.</p>
            </div>
            <TIP>파일을 올리면 자동으로 내용을 분석하여 2단계 시트 선택으로 넘어갑니다.</TIP>
          </div>
        ),
      },
      {
        id: 'format', icon: '📋', title: '파일 구조 권장 형식',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm mb-4">엑셀 첫 번째 행이 <span className="text-[#3b82f6] font-bold">헤더(컬럼명)</span>이어야 합니다.</p>
            <div className="bg-black/50 rounded-xl border border-white/10 overflow-hidden mb-4 text-xs font-mono">
              <div className="bg-[#060c18] px-4 py-2 text-[#3b82f6] font-bold border-b border-white/5 grid grid-cols-6 gap-2">
                <span>성명</span><span>연락처</span><span>주소</span><span>포수</span><span>행정동</span><span>구분</span>
              </div>
              <div className="px-4 py-2 text-gray-400 grid grid-cols-6 gap-2 border-b border-white/5">
                <span>홍길동</span><span>010-1234-5678</span><span>서울 종로구...</span><span>3</span><span>청운효자동</span><span>기초수급자</span>
              </div>
              <div className="px-4 py-2 text-gray-400 grid grid-cols-6 gap-2">
                <span>김철수</span><span>010-9876-5432</span><span>서울 중구...</span><span>2</span><span>소공동</span><span>차상위</span>
              </div>
            </div>
            <TIP>컬럼명이 정확히 일치하지 않아도 됩니다. 3단계에서 직접 연결할 수 있습니다.</TIP>
            <WARN>합계 행, 빈 행, 병합 셀이 있으면 오류가 발생할 수 있습니다. 깔끔한 데이터 형식을 권장합니다.</WARN>
          </div>
        ),
      },
    ],
  },

  2: {
    title: '2단계: 시트 선택 및 분류',
    subtitle: '처리할 시트를 고르고 유형을 지정하세요',
    sections: [
      {
        id: 'select', icon: '☑️', title: '시트 선택 방법',
        render: () => (
          <div>
            <div className="space-y-2 mb-4">
              <Step num="1" title="시트 목록 확인" desc="파일 안의 모든 시트가 목록으로 표시됩니다. 처리 불필요한 시트는 체크를 해제하세요." />
              <Step num="2" title="유형 지정" desc="각 시트의 수급자 유형을 '기초수급자', '차상위', '혼합' 중 하나로 지정합니다." />
              <Step num="3" title="지자체 정보 입력" desc="상단 입력란에 지자체명(시/군/구)을 입력합니다. 파일명 생성에 사용됩니다." />
            </div>
            <TIP>시트 이름이 '수급', '기초', '차상위' 등을 포함하면 유형이 자동으로 지정됩니다.</TIP>
          </div>
        ),
      },
      {
        id: 'analysis', icon: '🤖', title: 'AI 구조 분석 리포트',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              시트 목록 표의 <span className="text-[#3b82f6] font-black">🤖 AI 구조 분석 리포트</span> 열은 각 시트의 필수 컬럼 인식 결과를 즉시 보여줍니다.
            </p>
            <div className="space-y-3 mb-4">
              {[
                { badge: '✔️ 완벽', bcolor: 'bg-[#111] border-gray-700 text-gray-300', desc: '5개 필수 항목이 모두 인식되었습니다. 3단계로 바로 진행하세요.' },
                { badge: '⚠️ 치명적', bcolor: 'bg-[#1a1710] border-[#d4af37]/40 text-[#d4af37]', desc: '필수 항목은 인식됐으나 데이터가 대부분 비어 있습니다. 올바른 컬럼을 확인하세요.' },
                { badge: '🔴 누락: 이름, 주소…', bcolor: 'bg-[#1a0505] border-red-900/50 text-red-400', desc: '하나 이상의 필수 항목이 인식되지 않았습니다. 3단계에서 수동 매핑이 필요합니다.' },
              ].map(t => (
                <div key={t.badge} className="p-4 bg-black/40 border border-white/5 rounded-xl flex gap-3 items-start">
                  <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold border shrink-0 mt-0.5 ${t.bcolor}`}>{t.badge}</span>
                  <p className="text-gray-400 text-xs leading-relaxed">{t.desc}</p>
                </div>
              ))}
            </div>
            <TIP>분석 결과가 "누락"이어도 3단계에서 수동으로 컬럼을 연결하면 정상 처리됩니다.</TIP>
          </div>
        ),
      },
      {
        id: 'types', icon: '🏷️', title: '수급자 유형이란?',
        render: () => (
          <div>
            <div className="space-y-3 mb-4">
              {[
                { type: '기초수급자', color: 'border-gray-600 bg-[#111]', text: 'text-gray-300', desc: '국민기초생활보장 수급자. 생계·의료·주거·교육급여 수급자가 포함됩니다.' },
                { type: '차상위', color: 'border-[#3b82f6]/40 bg-[#060c18]', text: 'text-[#3b82f6]', desc: '기초수급자 기준 중위소득 50% 이하이지만 수급자가 아닌 계층입니다.' },
                { type: '혼합', color: 'border-amber-600/40 bg-amber-950/20', text: 'text-amber-400', desc: '한 시트에 기초수급자와 차상위가 섞인 경우. 구분 컬럼이 있어야 합니다.' },
                { type: '제외 🚫', color: 'border-red-700/40 bg-red-950/20', text: 'text-red-400', desc: '이 시트를 처리 대상에서 완전히 제외합니다.' },
              ].map(t => (
                <div key={t.type} className={`border ${t.color} rounded-xl p-4`}>
                  <span className={`font-black ${t.text}`}>{t.type}</span>
                  <p className="text-gray-400 text-xs mt-1 leading-relaxed">{t.desc}</p>
                </div>
              ))}
            </div>
            <WARN>혼합 시트는 반드시 '구분' 컬럼(기초수급자/차상위 구분값)이 있어야 합니다.</WARN>
          </div>
        ),
      },
    ],
  },

  3: {
    title: '3단계: 컬럼 매핑',
    subtitle: '엑셀 컬럼과 시스템 필드를 연결합니다',
    sections: [
      {
        id: 'what', icon: '🔗', title: '컬럼 매핑이란?',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              엑셀마다 컬럼명이 다릅니다. 매핑은 이 컬럼명을 시스템이 이해할 수 있는 필드로 연결하는 과정입니다.
            </p>
            <MappingVisual />
            <TIP>자주 쓰는 컬럼명은 AI가 자동으로 매핑해 드립니다. 맞지 않는 항목만 수동 조정하세요.</TIP>
          </div>
        ),
      },
      {
        id: 'required', icon: '⭐', title: '필수 & 선택 항목',
        render: () => (
          <div>
            <p className="text-[#3b82f6] font-black text-sm mb-3">필수 항목 (반드시 연결해야 합니다)</p>
            <div className="space-y-2 mb-5">
              {[
                { label: '성명(이름)', desc: '수급자 이름. 5자 초과 시 자동 축약됩니다.' },
                { label: '연락처(휴대폰)', desc: '010으로 시작하는 휴대폰 번호. 자동 서식 정규화됩니다.' },
                { label: '주소', desc: 'AI가 도로명주소로 변환합니다. 지번 주소도 가능합니다.' },
                { label: '포수(수량)', desc: '지원 물품 수량. 숫자 외 값은 1로 처리됩니다.' },
                { label: '행정동', desc: '행정동 이름. 주소 정제 정확도를 높이는 데 사용됩니다.' },
              ].map(f => (
                <div key={f.label} className="flex gap-3 p-3 bg-[#060c18] border border-[#3b82f6]/20 rounded-xl">
                  <Star size={14} className="text-[#3b82f6] shrink-0 mt-0.5" />
                  <div>
                    <span className="text-white font-bold text-sm">{f.label}</span>
                    <p className="text-gray-400 text-xs mt-0.5">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-gray-400 font-black text-sm mb-3">선택 항목</p>
            <div className="flex flex-wrap gap-2">
              {['생년월일', '보조연락처(유선)', '문자수신 여부', '수급자 구분', '특이사항', '배송 기사', '배송 순번'].map(f => (
                <Badge key={f} color="gray">{f}</Badge>
              ))}
            </div>
          </div>
        ),
      },
      {
        id: 'bottom-panel', icon: '📎', title: '추가 명단 & 이전 명단 패널',
        render: () => (
          <div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-blue-950/20 border border-blue-700/30 rounded-xl p-4">
                <p className="text-blue-300 font-black text-xs mb-2">추가 명단 등록 (왼쪽)</p>
                <p className="text-gray-400 text-xs leading-relaxed">+ 파일 추가 → 시트 선택 모달 → 체크 + 수급구분 지정 → [추가 완료] → 탭 자동 생성 + AI 매핑</p>
              </div>
              <div className="bg-[#060c18] border border-[#3b82f6]/20 rounded-xl p-4">
                <p className="text-[#3b82f6] font-black text-xs mb-2">이전 명단 이식 (오른쪽)</p>
                <p className="text-gray-400 text-xs leading-relaxed">이전 정제 명단을 올리면 AI가 성명 컬럼을 자동 감지하여 즉시 연결됩니다.</p>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <Step num="1" title="추가 명단 추가" desc="하단 왼쪽 '+ 파일 추가' 클릭 → 시트 선택 → [추가 완료] → 새 탭 자동 생성" />
              <Step num="2" title="이전 명단 등록" desc="하단 오른쪽 '+ 이전 명단 추가'로 파일 올리기. 자동 연결됩니다." />
              <Step num="3" title="정제 가동" desc="모든 매핑 완료 후 상단 버튼을 누르면 처리가 시작됩니다." />
            </div>
          </div>
        ),
      },
    ],
  },

  5: {
    title: '4단계: 결과 검토 및 내보내기',
    subtitle: '정제 결과를 확인하고 최종 파일을 내보냅니다',
    sections: [
      {
        id: 'filter', icon: '🔍', title: '필터 사용법',
        render: () => (
          <div>
            <div className="space-y-3 mb-4">
              {[
                { label: '전체보기', color: 'border-[#3b82f6] text-[#3b82f6] bg-[#111]', desc: '모든 행을 표시합니다.' },
                { label: '확인필요', color: 'border-red-500 text-red-400 bg-red-950/30', desc: '주소 정제에 실패하거나 확인이 필요한 행만 표시합니다. 반드시 검토하세요.' },
                { label: '정제완료', color: 'border-blue-500 text-blue-400 bg-blue-950/30', desc: '주소 변환이 성공적으로 완료된 행만 표시합니다.' },
              ].map(f => (
                <div key={f.label} className={`border ${f.color} rounded-xl p-4`}>
                  <span className={`font-black text-sm ${f.color.split(' ')[1]}`}>{f.label}</span>
                  <p className="text-gray-400 text-xs mt-1">{f.desc}</p>
                </div>
              ))}
            </div>
            <TIP>내보내기 시 현재 필터 상태가 적용됩니다. 전체를 내보내려면 '전체보기'로 변경하세요.</TIP>
          </div>
        ),
      },
      {
        id: 'error', icon: '🚨', title: '오류 항목 수정하기',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">빨간색 행은 주소 변환이 실패한 항목입니다. 직접 수정할 수 있습니다.</p>
            <ErrorExample />
            <div className="space-y-2 mt-4">
              <Step num="1" title="주소 셀 클릭" desc="빨간 행의 주소 칸을 클릭하면 직접 입력 가능한 상태가 됩니다." />
              <Step num="2" title="주소 수정" desc="올바른 주소로 수정합니다. 도로명이나 건물명을 포함하면 인식률이 높아집니다." />
              <Step num="3" title="Enter 키 누르기" desc="Enter를 누르면 AI가 즉시 다시 정제를 시도합니다. 성공하면 초록색으로 바뀝니다." />
            </div>
            <TIP>Enter 후 정제 성공 시 오타 사전에 자동 등록됩니다. 다음에 같은 주소가 들어오면 더 빠르게 처리됩니다.</TIP>
          </div>
        ),
      },
      {
        id: 'export', icon: '📦', title: '내보내기 방법',
        render: () => (
          <div>
            <div className="space-y-4 mb-4">
              {[
                { title: '표준 명단 패키징', color: 'bg-[#3b82f6] text-black', desc: '현재 필터된 전체 결과를 표준 엑셀 파일로 내보냅니다.' },
                { title: '오류만 내보내기', color: 'bg-red-950/60 border border-red-500/60 text-red-400', desc: '주소 확인이 필요한 항목만 별도 엑셀로 내보냅니다. 담당자에게 재확인 요청 시 활용하세요.' },
                { title: '행정동별 보고서', color: 'bg-blue-950/60 border border-blue-500/40 text-blue-300', desc: '행정동별로 분류된 엑셀 파일을 생성합니다. 시트별로 행정동 명단이 자동 분리됩니다.' },
              ].map(e => (
                <div key={e.title} className="p-4 rounded-xl bg-black/40 border border-white/10">
                  <span className={`inline-block px-3 py-1 rounded-lg text-xs font-black mb-2 ${e.color}`}>{e.title}</span>
                  <p className="text-gray-400 text-xs leading-relaxed">{e.desc}</p>
                </div>
              ))}
            </div>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-3">
              <p className="text-gray-500 font-bold text-xs mb-2">내보내기 파일명 형식</p>
              <div className="bg-[#111] border border-gray-700 rounded-lg px-3 py-2 font-mono text-xs text-[#3b82f6]">
                {'{{지자체명}}-{{월}}월-기초{{N}},차상위{{N}},전체{{N}}-MMDDHHMMSS.xlsx'}
              </div>
            </div>
            <TIP>Ctrl+Z로 수정 내역을 되돌릴 수 있습니다. 최대 10단계 이전 상태로 복원 가능합니다.</TIP>
          </div>
        ),
      },
      {
        id: 'bulk', icon: '☑️', title: '행 선택 및 일괄 작업',
        render: () => (
          <div>
            <div className="space-y-3 mb-4">
              <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/20">
                <p className="text-red-400 font-black text-sm mb-1">선택 삭제</p>
                <p className="text-gray-400 text-xs leading-relaxed">잘못 들어온 행을 체크한 뒤 "선택 삭제" 버튼으로 제거합니다. Ctrl+Z로 취소 가능합니다.</p>
              </div>
              <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-500/20">
                <p className="text-purple-300 font-black text-sm mb-1">특이사항 일괄 설정</p>
                <p className="text-gray-400 text-xs leading-relaxed">여러 행 선택 후 "특이사항 일괄" 버튼 → 모달에서 내용 입력 → 선택된 모든 행에 일괄 적용됩니다.</p>
              </div>
            </div>
            <TIP>선택은 페이지를 넘겨도 유지됩니다. 여러 페이지에 걸쳐 선택 후 한꺼번에 처리 가능합니다.</TIP>
          </div>
        ),
      },
    ],
  },

  6: {
    title: '5단계: 클라우드 DB 관리',
    subtitle: '명단을 클라우드에 저장하고 관리합니다',
    sections: [
      {
        id: 'overview', icon: '☁️', title: '클라우드 DB 구조',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              클라우드 DB는 크게 두 가지 컬렉션으로 구성됩니다.
              <span className="text-amber-400 font-black"> 기본명단</span>은 수급자 영구 DB이고,
              <span className="text-[#3b82f6] font-black"> 월별 명단</span>은 이번 달 배송 데이터입니다.
            </p>
            <CloudDBDiagram />
            <TIP>루트맵을 사용하려면 반드시 월별 명단(cloud_lists)에 데이터를 저장해야 합니다.</TIP>
          </div>
        ),
      },
      {
        id: 'base-list', icon: '📚', title: '기본명단 관리',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              기본명단은 수급자 정보를 <span className="text-amber-400 font-black">영구적으로 누적 저장</span>하는 DB입니다.
              신규 명단 처리 시 기사·순번·특이사항을 자동으로 이식하는 소스로 활용됩니다.
            </p>
            <div className="space-y-2 mb-4">
              <Step num="1" title="결과 화면에서 '기본명단 저장' 클릭" desc="4단계 결과 검토 화면 상단의 기본명단 저장 버튼을 클릭합니다." />
              <Step num="2" title="지자체 선택" desc="저장할 지자체(city)를 선택합니다. 승인된 지자체만 선택 가능합니다." />
              <Step num="3" title="저장 모드 선택" desc="'누적 저장' — 기존 데이터를 유지하며 신규·변경된 수급자만 갱신합니다." />
              <Step num="4" title="저장 완료 확인" desc="저장 완료 후 추가/변경/오류 건수가 표시됩니다." />
            </div>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-3">
              <p className="text-amber-400 font-black text-xs mb-2">3순위 매칭 기준 (저장 시 중복 판단)</p>
              <div className="space-y-1">
                {['① 이름 + 생년월일 (최우선)', '② 이름 + 휴대폰번호 (2순위)', '③ 이름 + 유선전화 (3순위)'].map(t => (
                  <div key={t} className="text-gray-400 text-xs">{t}</div>
                ))}
              </div>
            </div>
            <WARN>생년월일·휴대폰·유선전화가 모두 없는 수급자는 기본명단에 저장할 수 없습니다.</WARN>
          </div>
        ),
      },
      {
        id: 'cloud-list', icon: '📅', title: '월별 명단 저장',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              월별 명단은 이번 달 배송 데이터를 <span className="text-[#3b82f6] font-black">cloud_lists</span>에 저장합니다.
              루트맵을 열면 이 데이터를 불러와 기사 배분 작업을 합니다.
            </p>
            <div className="space-y-2 mb-4">
              <Step num="1" title="'클라우드 저장' 버튼 클릭" desc="4단계 결과 화면 상단의 클라우드 저장 버튼을 클릭합니다." />
              <Step num="2" title="지자체 및 월 선택" desc="저장할 지자체와 연월(YYYY-MM)을 선택합니다." />
              <Step num="3" title="저장 확인" desc="동월 데이터가 이미 있으면 덮어쓸지 확인 후 저장합니다." />
            </div>
            <div className="bg-[#060c18] border border-[#3b82f6]/20 rounded-xl p-4">
              <p className="text-[#3b82f6] font-black text-xs mb-2">저장되는 필드</p>
              <div className="flex flex-wrap gap-1.5">
                {['이름', '주소', '행정동', '포수', '휴대폰', '생년월일', '특이사항', '구분', '기사', '배송순번', 'SMS'].map(f => (
                  <Badge key={f} color="gray">{f}</Badge>
                ))}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'load', icon: '📥', title: '클라우드 명단 불러오기',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              저장된 클라우드 명단을 불러와서 루트맵 작업을 이어서 할 수 있습니다.
            </p>
            <div className="space-y-2 mb-4">
              <Step num="1" title="루트맵 열기" desc="결과 화면 상단의 '루트맵' 버튼을 클릭합니다." />
              <Step num="2" title="지자체 & 월 선택" desc="루트맵 상단에서 처리할 지자체와 월을 선택합니다." />
              <Step num="3" title="데이터 자동 로드" desc="선택 즉시 cloud_lists에서 해당 월의 모든 레코드가 지도에 표시됩니다." />
            </div>
            <TIP>이전 달에 저장된 기사 배정이 있으면 "이전달 불러오기" 버튼으로 구역을 그대로 이어받을 수 있습니다.</TIP>
          </div>
        ),
      },
    ],
  },

  7: {
    title: '6단계: 루트맵 & 기사 배분',
    subtitle: '자동 구역 배분 + 카카오맵 저장 + 공유 링크',
    sections: [
      {
        id: 'overview', icon: '🗺️', title: '루트맵 화면 구성',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              루트맵은 배송 수급자를 기사별로 자동 배분하고 최적 순번을 부여합니다. 아래 다이어그램이 실제 화면 레이아웃입니다.
            </p>
            <MapLayoutDiagram />
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[
                { color: 'text-amber-400', title: '왼쪽 패널', desc: '기사 목록·카드·핀꽂기·브러시 버튼·배분 통계' },
                { color: 'text-[#3b82f6]', title: '지도 영역', desc: '카카오 지도 + 색상별 배송 핀 + 기사 구역 표시' },
                { color: 'text-green-400', title: '상단 툴바', desc: '자동등분·겹침해소·카카오맵 저장·공유 버튼' },
              ].map(i => (
                <div key={i.title} className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-3">
                  <div className={`font-black text-[10px] mb-1 ${i.color}`}>{i.title}</div>
                  <div className="text-gray-500 text-[9px] leading-relaxed">{i.desc}</div>
                </div>
              ))}
            </div>
          </div>
        ),
      },
      {
        id: 'driver-setup', icon: '👥', title: '기사 등록하기',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              루트맵 진입 시 기사 수와 이름을 설정합니다. 이 정보가 구역 배분의 기준이 됩니다.
            </p>
            <div className="space-y-2 mb-4">
              <Step num="1" title="기사 수 입력" desc="루트맵 상단에서 배분할 기사 수(2~15명)를 입력합니다." />
              <Step num="2" title="기사 이름 입력" desc="왼쪽 패널의 각 기사 카드에서 이름을 입력합니다. 이름은 공유 링크에도 표시됩니다." />
              <Step num="3" title="소속사 설정 (선택)" desc="소속사가 있는 경우 기사 카드에서 소속사를 선택하면 기사 마스터 목록에서 이름을 자동 불러올 수 있습니다." />
            </div>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4">
              <p className="text-[#3b82f6] font-black text-xs mb-2">각 기사 카드에서 확인 가능한 정보</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {['배정 건수', '배정 포수', '유효부담 점수', '이동거리 평균', '구역 겹침 여부', '배송밀집도 색상'].map(f => (
                  <div key={f} className="flex items-center gap-1.5 text-[10px] text-gray-400">
                    <span className="text-[#3b82f6] text-[8px]">•</span>{f}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'geocoding', icon: '📍', title: '좌표 매칭 (지도 표시 준비)',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              자동 배분을 실행하려면 먼저 각 수급자의 주소를 지도 좌표(위경도)로 변환해야 합니다.
              이 과정을 <span className="text-[#3b82f6] font-black">좌표 매칭</span>이라고 합니다.
            </p>
            <div className="space-y-2 mb-4">
              <Step num="1" title="'좌표 매칭' 버튼 클릭" desc="상단 툴바의 '좌표 매칭' 버튼을 클릭합니다. 이전에 캐시된 좌표는 즉시 표시됩니다." />
              <Step num="2" title="API 요청 진행" desc="카카오 좌표 API로 미수신 주소를 일괄 변환합니다. 진행 상황이 실시간으로 표시됩니다." />
              <Step num="3" title="매칭 완료 확인" desc="지도에 컬러 핀들이 표시되면 완료입니다. 미매칭 건수가 0이어야 자동 N등분이 활성화됩니다." />
            </div>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-3">
              <p className="text-amber-400 font-black text-xs mb-2">좌표 미매칭 처리</p>
              <p className="text-gray-400 text-xs leading-relaxed">
                좌표를 받지 못한 건은 같은 행정동에서 가장 많은 수급자를 담당하는 기사에게 자동 귀속됩니다.
                이후 지도 클릭으로 수동 좌표 배정도 가능합니다.
              </p>
            </div>
            <TIP>한 번 받은 좌표는 클라우드 캐시(coordinate_cache)에 영구 저장됩니다. 다음 달에 같은 주소가 나오면 API 없이 즉시 표시됩니다.</TIP>
          </div>
        ),
      },
      {
        id: 'pin', icon: '📌', title: '핀 꽂기 — 거점 위치 설정',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              각 기사의 <span className="text-[#3b82f6] font-black">거점 위치(핀)</span>를 지도에 설정하면 자동 배분이 해당 핀을 중심으로 구역을 나눕니다.
              핀이 없으면 도로주소 단위 아파트 묶음과 대로/로 좌우 측면을 지킨 채 연속 권역으로 균형 분할합니다.
            </p>
            <PinPlacementDiagram />
            <div className="space-y-2 mb-4">
              <Step num="1" title="기사 카드에서 [핀꽂기] 클릭" desc="왼쪽 패널의 기사 카드에서 📍 핀꽂기 버튼을 클릭합니다." />
              <Step num="2" title="지도에서 거점 위치 클릭" desc="커서가 십자 모양으로 바뀝니다. 해당 기사의 배송 시작/거점 위치를 클릭하여 핀을 꽂습니다." />
              <Step num="3" title="다른 기사도 반복" desc="모든 기사에게 핀을 꽂으면 자동 N등분 시 가까운 기사 거점으로 먼저 배정됩니다." />
            </div>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-3">
              <p className="text-[#3b82f6] font-black text-xs mb-2">핀 있음 vs 핀 없음 차이</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-white font-bold mb-1">핀 있음</div>
                  <div className="text-gray-400 leading-relaxed">핀 위치를 거점으로 삼아 가까운 배송지를 우선 배정합니다. 경계는 브러시로 마감할 수 있습니다.</div>
                </div>
                <div>
                  <div className="text-white font-bold mb-1">핀 없음</div>
                  <div className="text-gray-400 leading-relaxed">도로주소 아파트 단위와 대로/로 홀짝 좌우 측면을 보존하고 지도 장축을 따라 유효부담을 균형 분할합니다.</div>
                </div>
              </div>
            </div>
            <TIP>핀은 [×] 버튼으로 제거할 수 있습니다. 핀이 일부 기사에게만 있으면 전체 없음 모드로 동작합니다.</TIP>
          </div>
        ),
      },
      {
        id: 'auto-split', icon: '⚡', title: '자동 N등분 — 구역 자동 배분',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              <span className="text-[#3b82f6] font-black">자동 N등분</span> 버튼 하나로 포수 비례 구역 배분 + 경계 최적화 + 배송순번 부여가 모두 완료됩니다.
            </p>
            <ZoneDiagram />
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-4">
              <p className="text-[#3b82f6] font-black text-xs mb-3">알고리즘 실행 순서</p>
              <div className="space-y-1.5">
                {[
                  '① 도로주소 + 대로/로 홀짝 좌우 측면 단위 연속 권역 균형 분할',
                  '② 공간 다수결 스무딩 (고립 핀 흡수, 구역 경계 정리)',
                  '③ 아파트 단지 동일 기사 통일 (R-I)',
                  '④ 동일 주소 동일 기사 통일 (R-E)',
                  '⑤ 2차 스무딩 (R-I·R-E 이후 침범 재정리)',
                  '⑥ 미배정 전건 강제 배정',
                  '⑦ 최근접 TSP 순번 부여 (북서→동쪽)',
                ].map(t => (
                  <div key={t} className="text-[10px] text-gray-400 flex gap-2">
                    <span className="text-[#3b82f6] shrink-0">›</span>{t}
                  </div>
                ))}
              </div>
            </div>
            <WARN>좌표 미매칭 건수가 1건 이상이면 자동 N등분 버튼이 잠깁니다. 좌표 매칭을 먼저 완료하세요.</WARN>
            <TIP>배분 결과가 마음에 들지 않으면 핀 위치를 조정하거나 브러시 모드로 미세 수정할 수 있습니다.</TIP>
          </div>
        ),
      },
      {
        id: 'paint-brush', icon: '🖌️', title: '페인트 브러시 — 수동 미세 보정',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              자동 배분 후 특정 구역을 다른 기사에게 재배정하고 싶을 때 <span className="text-amber-400 font-black">페인트 브러시 모드</span>를 사용합니다.
              마우스를 드래그하면 브러시가 닿는 모든 핀이 선택한 기사 색상으로 바뀝니다.
            </p>
            <PaintBrushDiagram />
            <div className="space-y-2 mb-4">
              <Step num="1" title="기사 카드에서 [브러시] 버튼 클릭" desc="재배정 받을 기사의 🖌️ 브러시 버튼을 클릭합니다. 해당 기사 색상으로 브러시가 활성화됩니다." />
              <Step num="2" title="브러시 반경 선택" desc="소(30px) / 중(60px) / 대(100px) / 특대(160px) 중 원하는 크기를 선택합니다." />
              <Step num="3" title="지도 위에서 드래그" desc="지도 위에서 마우스를 누른 채 드래그합니다. 브러시 원 안의 모든 핀이 해당 기사로 재배정됩니다." />
              <Step num="4" title="브러시 종료" desc="다른 기사 카드의 브러시를 클릭하거나 [브러시 종료] 버튼으로 모드를 해제합니다." />
            </div>
            <TIP>브러시 모드 중에는 지도가 이동하지 않습니다. 지도를 이동해야 할 때는 브러시를 종료 후 이동하세요.</TIP>
            <WARN>브러시 작업은 Undo(Ctrl+Z)가 지원되지 않습니다. 신중하게 사용하세요.</WARN>
          </div>
        ),
      },
      {
        id: 'overlap', icon: '⚠️', title: '겹침 감지 및 해소',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              서로 다른 기사의 배송 핀이 <span className="text-red-400 font-black">150m 이내</span>에 인접해 있으면 "겹침"으로 판단합니다.
              최종 저장 전에 겹침 건수를 <span className="text-green-400 font-black">0건</span>으로 만들어야 합니다.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-red-950/20 border border-red-700/30 rounded-xl p-3">
                <div className="text-red-400 font-black text-xs mb-1">겹침 발생 시</div>
                <div className="text-gray-400 text-[10px] leading-relaxed">상단 툴바에 <span className="text-red-400 font-bold">겹침 N건</span>이 표시됩니다. 카카오맵 저장 버튼이 비활성화됩니다.</div>
              </div>
              <div className="bg-green-950/20 border border-green-700/30 rounded-xl p-3">
                <div className="text-green-400 font-black text-xs mb-1">겹침 해소 후</div>
                <div className="text-gray-400 text-[10px] leading-relaxed"><span className="text-green-400 font-bold">겹침 0건</span>이 되면 카카오맵 저장 버튼이 활성화됩니다.</div>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <Step num="1" title="'겹침 해소' 버튼 클릭" desc="시스템이 자동으로 경계 근처 핀을 가장 가까운 단일 기사 구역으로 재배정합니다." />
              <Step num="2" title="브러시로 수동 보정" desc="자동 해소 후에도 겹침이 남으면 브러시 모드로 직접 수정합니다." />
            </div>
            <TIP>'겹침 해소'를 여러 번 반복하면 더 깔끔하게 정리됩니다.</TIP>
          </div>
        ),
      },
      {
        id: 'save', icon: '💾', title: '저장 방법 — 세션 저장 vs 카카오맵 저장',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              저장 방법은 두 가지입니다. 작업 중간 저장은 <span className="text-[#3b82f6] font-black">세션 저장</span>, 기사에게 배정 결과를 반영하려면 <span className="text-amber-400 font-black">카카오맵 저장</span>을 사용합니다.
            </p>
            <SaveMethodDiagram />
            <div className="space-y-2 mb-4">
              <Step num="1" title="겹침 0건 확인" desc="카카오맵 저장 전에 반드시 겹침이 0건인지 확인합니다." />
              <Step num="2" title="'카카오맵 저장' 클릭" desc="상단 툴바의 카카오맵 저장 버튼을 클릭합니다. cloud_lists의 기사/배송순번 필드가 업데이트됩니다." />
              <Step num="3" title="공유 링크 생성" desc="저장 완료 후 '공유' 버튼으로 기사별 개인 공유 링크를 생성합니다." />
            </div>
            <TIP>세션 저장은 자동으로도 주기적으로 실행됩니다. 카카오맵 저장은 수동으로만 실행됩니다.</TIP>
          </div>
        ),
      },
      {
        id: 'share', icon: '🔗', title: '루트 공유 링크 — 기사 스마트폰 전달',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              카카오맵 저장 후 <span className="text-[#3b82f6] font-black">공유</span> 버튼을 누르면 기사별 전용 링크가 생성됩니다.
              기사가 스마트폰에서 링크를 열면 자신의 배송 지도와 목록이 바로 표시됩니다.
            </p>
            <ShareModalDiagram />
            <div className="space-y-2 mb-4">
              <Step num="1" title="'공유' 버튼 클릭" desc="상단 툴바의 공유 버튼을 클릭합니다. 기사별 전용 링크가 즉시 생성됩니다." />
              <Step num="2" title="링크 복사 후 전달" desc="각 기사 이름 옆의 [복사] 버튼으로 링크를 복사한 뒤 카카오톡·문자로 전달합니다." />
              <Step num="3" title="기사가 링크 열기" desc="기사가 스마트폰으로 링크를 열면 자신의 배송 루트 지도와 순번 목록이 표시됩니다." />
            </div>
            <p className="text-gray-400 text-sm font-bold mb-3">기사 화면 미리보기</p>
            <DriverViewDiagram />
            <div className="bg-[#060c18] border border-[#3b82f6]/20 rounded-xl p-4 mb-3">
              <p className="text-[#3b82f6] font-black text-xs mb-2">기사 스마트폰 화면 기능</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { icon: '🗺️', text: '지도 뷰 — 배송 순번 마커 + 경로선' },
                  { icon: '☰', text: '목록 뷰 — 순번·이름·주소 리스트' },
                  { icon: '🏢', text: '아파트 별도 표시 (동호수 정렬)' },
                  { icon: '📍', text: '카카오 길찾기 연동 (목록 → 지도 앱)' },
                ].map(f => (
                  <div key={f.text} className="flex items-start gap-1.5 text-[10px] text-gray-400">
                    <span className="shrink-0">{f.icon}</span>{f.text}
                  </div>
                ))}
              </div>
            </div>
            <WARN>공유 링크는 로그인 없이 누구나 열 수 있습니다. 링크를 해당 기사에게만 전달하세요.</WARN>
            <TIP>공유 링크를 새로 생성하면 이전 링크는 무효화됩니다. 기사에게 항상 최신 링크를 전달하세요.</TIP>
          </div>
        ),
      },
    ],
  },
};

/* ─── 메인 모달 컴포넌트 ─── */
export default function HelpModal({ step, onClose }) {
  const [activeStep, setActiveStep] = useState(step ?? 0);
  const data = CONTENT[activeStep] || CONTENT[0];
  const [activeSection, setActiveSection] = useState(data.sections[0].id);

  const currentSection = data.sections.find(s => s.id === activeSection) || data.sections[0];
  const currentIdx = data.sections.findIndex(s => s.id === activeSection);

  const goToStep = (key) => {
    const newData = CONTENT[key];
    if (!newData) return;
    setActiveStep(key);
    setActiveSection(newData.sections[0].id);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[700] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl bg-[#0a100c] border border-[#3b82f6]/30 rounded-3xl shadow-[0_0_80px_rgba(59,130,246,0.2)] flex flex-col overflow-hidden max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-[#0f1a2e] shrink-0 bg-gradient-to-r from-[#060c18] to-[#0a100c]">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="bg-[#3b82f6] text-black text-[10px] font-black px-2 py-0.5 rounded tracking-widest">GUIDE</span>
              <span className="text-gray-600 text-xs">|</span>
              <span className="text-gray-500 text-xs">{data.subtitle}</span>
            </div>
            <h2 className="text-xl font-black text-white">{data.title}</h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white transition-all flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar */}
          <div className="w-52 shrink-0 border-r border-[#0f1a2e] flex flex-col bg-black/20">
            {/* Step nav */}
            <div className="px-3 py-3 border-b border-[#0f1a2e]">
              <p className="text-gray-600 text-[10px] font-black tracking-widest mb-2 px-2">단계 선택</p>
              {STEPS.map(s => (
                <button
                  key={s.key}
                  onClick={() => goToStep(s.key)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 mb-0.5 ${
                    activeStep === s.key
                      ? 'bg-[#3b82f6]/15 text-[#3b82f6] border border-[#3b82f6]/30'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <span>{s.icon}</span><span className="truncate">{s.label}</span>
                </button>
              ))}
            </div>
            {/* Section nav */}
            <div className="flex-1 overflow-auto px-3 py-3">
              <p className="text-gray-600 text-[10px] font-black tracking-widest mb-2 px-2">섹션</p>
              {data.sections.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 mb-1 ${
                    activeSection === s.id
                      ? 'bg-[#3b82f6] text-black shadow-[0_0_12px_rgba(59,130,246,0.4)]'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <span className="shrink-0">{s.icon}</span>
                  <span className="leading-tight">{s.title}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right content */}
          <div className="flex-1 overflow-auto">
            <div className="p-8">
              <SectionTitle icon={currentSection.icon} title={currentSection.title} />
              {currentSection.render()}
            </div>
          </div>
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-8 py-4 border-t border-[#0f1a2e] shrink-0 bg-black/20">
          <button
            onClick={() => { if (currentIdx > 0) setActiveSection(data.sections[currentIdx - 1].id); }}
            disabled={currentIdx === 0}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-gray-400 hover:text-white disabled:opacity-20 transition-colors"
          >
            <ChevronLeft size={14} /> 이전
          </button>
          <span className="text-gray-600 text-xs">{currentIdx + 1} / {data.sections.length}</span>
          <button
            onClick={() => { if (currentIdx < data.sections.length - 1) setActiveSection(data.sections[currentIdx + 1].id); }}
            disabled={currentIdx === data.sections.length - 1}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-[#3b82f6] hover:text-white disabled:opacity-20 transition-colors"
          >
            다음 <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
