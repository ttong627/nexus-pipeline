import { useState } from 'react';
import { X, Upload, FileSpreadsheet, Columns, Download, AlertTriangle, ChevronRight, ChevronLeft, ArrowRight, Zap, Star } from 'lucide-react';

const STEPS = [
  { key: 0, icon: '🏠', label: '전체 안내' },
  { key: 1, icon: '📁', label: '1단계: 파일 업로드' },
  { key: 2, icon: '📋', label: '2단계: 시트 선택' },
  { key: 3, icon: '🔗', label: '3단계: 컬럼 매핑' },
  { key: 5, icon: '✅', label: '4단계: 결과 검토' },
];

const TIP = ({ children }) => (
  <div className="flex gap-3 bg-[#0d1a0f] border border-[#22c55e]/30 rounded-xl p-4 my-3">
    <span className="text-[#22c55e] shrink-0 mt-0.5"><Zap size={15} /></span>
    <p className="text-[#86efac] text-sm leading-relaxed">{children}</p>
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
    <div className="w-8 h-8 rounded-full bg-[#22c55e] text-black font-black text-sm flex items-center justify-center shrink-0">{num}</div>
    <div>
      <p className="text-white font-bold text-sm">{title}</p>
      {desc && <p className="text-gray-400 text-xs mt-1 leading-relaxed">{desc}</p>}
    </div>
  </div>
);

const Badge = ({ color, children }) => {
  const colors = {
    green: 'bg-[#22c55e]/20 text-[#22c55e] border-[#22c55e]/40',
    red:   'bg-red-950/50 text-red-400 border-red-700/40',
    amber: 'bg-amber-950/40 text-amber-400 border-amber-600/40',
    blue:  'bg-blue-950/40 text-blue-400 border-blue-700/40',
    gray:  'bg-gray-800/50 text-gray-300 border-gray-600/40',
  };
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-bold border ${colors[color] || colors.gray}`}>{children}</span>
  );
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
    { icon: <Upload size={18}/>, label: '파일 업로드', color: '#22c55e' },
    { icon: <FileSpreadsheet size={18}/>, label: '시트 선택', color: '#86efac' },
    { icon: <Columns size={18}/>, label: '컬럼 매핑', color: '#4ade80' },
    { icon: <Zap size={18}/>, label: 'AI 정제', color: '#22c55e' },
    { icon: <Download size={18}/>, label: '내보내기', color: '#86efac' },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap justify-center my-5">
      {stages.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-12 h-12 rounded-2xl border-2 flex items-center justify-center shadow-[0_0_12px_rgba(34,197,94,0.3)]"
              style={{ borderColor: s.color + '60', color: s.color, background: s.color + '15' }}>
              {s.icon}
            </div>
            <span className="text-[10px] text-gray-400 font-bold whitespace-nowrap">{s.label}</span>
          </div>
          {i < stages.length - 1 && <ChevronRight size={14} className="text-[#22c55e]/40 mb-4 shrink-0" />}
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
        {[...Array(5)].map((_, i) => (
          <ArrowRight key={i} size={16} className="text-[#22c55e]/60" />
        ))}
      </div>
      <div>
        <p className="text-gray-500 font-bold mb-2 text-center">시스템 필드</p>
        {[
          { label: '이름', color: 'text-blue-300 border-blue-700/50 bg-blue-950/30' },
          { label: '연락처', color: 'text-green-300 border-green-700/50 bg-green-950/30' },
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

/* ─── 오류 상태 예시 ─── */
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
      <span className="text-[#22c55e]">서울특별시 종로구 세종대로 209</span>
    </div>
  </div>
);

/* ─── 각 단계 컨텐츠 ─── */
const CONTENT = {
  0: {
    title: '전체 시스템 안내',
    subtitle: 'NEXUS PIPELINE — 명단 정제 시스템',
    sections: [
      {
        id: 'intro', icon: '🚀', title: '이 시스템은 무엇인가요?',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              <span className="text-[#22c55e] font-black">NEXUS PIPELINE</span>은 지자체 복지 명단 엑셀 파일을 받아
              주소를 정제하고, 표준화된 출력 파일로 변환해주는 AI 기반 데이터 처리 시스템입니다.
            </p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { icon: '⚡', title: '초고속 처리', desc: '수천 건을 수 분 내 완료' },
                { icon: '🏠', title: 'AI 주소 정제', desc: '도로명 주소 자동 변환' },
                { icon: '📊', title: '표준 출력', desc: '즉시 사용 가능한 엑셀' },
              ].map(f => (
                <div key={f.title} className="bg-black/40 border border-white/5 rounded-xl p-4 text-center">
                  <div className="text-2xl mb-2">{f.icon}</div>
                  <p className="text-white font-black text-sm">{f.title}</p>
                  <p className="text-gray-500 text-xs mt-1">{f.desc}</p>
                </div>
              ))}
            </div>
            <TIP>처음 사용하시는 분은 이 안내를 순서대로 읽어보시면 5분 안에 전체 흐름을 파악할 수 있습니다.</TIP>
          </div>
        ),
      },
      {
        id: 'pipeline', icon: '🔄', title: '5단계 처리 흐름',
        render: () => (
          <div>
            <PipelineDiagram />
            <div className="space-y-2">
              <Step num="1" title="엑셀 파일 업로드" desc="신규 처리 명단 파일(.xlsx, .xls, .csv)을 드래그하거나 클릭하여 올립니다. 이전 정제 명단(기본명단)은 3단계 하단 패널에서 별도로 등록합니다." />
              <Step num="2" title="워크시트 분류" desc="파일 내 여러 시트 중 처리할 시트를 선택하고, 수급자 유형(기초수급자/차상위)을 지정합니다." />
              <Step num="3" title="컬럼 매핑" desc="엑셀의 열 이름과 시스템 필드를 연결합니다. 대부분 자동으로 매핑되며, 수동 조정도 가능합니다." />
              <Step num="4" title="AI 주소 정제" desc="행정안전부 도로명주소 API + 오타 사전을 이용해 모든 주소를 표준 도로명주소로 변환합니다." />
              <Step num="5" title="결과 검토 및 내보내기" desc="정제된 결과를 검토하고, 오류 항목을 수정한 뒤 표준 엑셀 파일로 내보냅니다." />
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
                <div key={f.ext} className="bg-[#0d1a0f] border border-[#22c55e]/20 rounded-xl p-4 text-center">
                  <div className="text-[#22c55e] font-black text-xl mb-1">{f.ext}</div>
                  <div className="text-white text-xs font-bold">{f.label}</div>
                  <div className="text-gray-500 text-xs">{f.desc}</div>
                  <Badge color="green">지원</Badge>
                </div>
              ))}
            </div>
            <WARN>파일 크기는 최대 <strong>50MB</strong>까지 지원합니다. 그 이상의 파일은 시트를 분리하여 업로드하세요.</WARN>
            <TIP>여러 시트가 있어도 괜찮습니다. 2단계에서 처리할 시트를 선택할 수 있습니다.</TIP>
          </div>
        ),
      },
      {
        id: 'base', icon: '👑', title: '기본명단 이식이란?',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              기본명단은 <span className="text-[#22c55e] font-black">이전에 정제된 명단</span>으로, 기사 배정·배송순번·특이사항·문자수신 등의 정보가 담겨 있습니다.
              3단계 하단 오른쪽 패널에서 파일을 올리면 이 정보를 자동으로 이식합니다.
            </p>
            <TIP>파일을 올리면 <b>AI가 성명 컬럼을 자동 감지</b>하여 별도 확인 없이 바로 연결됩니다. 연결 완료 시 "총 N건 이식 준비 완료"가 표시됩니다.</TIP>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-4 mt-2">
              <p className="text-[#22c55e] font-black text-sm mb-3">이식되는 데이터</p>
              <div className="grid grid-cols-2 gap-2">
                {['배송 기사명', '배송 순번', '특이사항 / 비고', '문자수신 여부'].map(item => (
                  <div key={item} className="flex items-center gap-2 text-gray-300 text-xs">
                    <span className="text-[#22c55e] drop-shadow-[0_0_4px_rgba(34,197,94,0.8)]">👑</span>{item}
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2 mb-3">
              {[
                { num: '①', badge: '이름 + 생년월일', desc: '6자리 생년월일이 일치하는 경우 (최우선)' },
                { num: '②', badge: '이름 + 휴대폰번호', desc: '휴대폰번호가 일치하는 경우 (2순위)' },
                { num: '③', badge: '이름 + 추가연락처', desc: '유선·추가 연락처가 일치하는 경우 (3순위)' },
              ].map(m => (
                <div key={m.num} className="flex items-center gap-3 text-xs text-gray-400 p-2 bg-black/30 rounded-lg">
                  <span className="text-[#22c55e] font-black shrink-0">{m.num}</span>
                  <Badge color="green">{m.badge}</Badge>
                  <span>{m.desc}</span>
                </div>
              ))}
            </div>
            <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-3 mb-3">
              <p className="text-amber-300 text-xs font-bold mb-1">⚠ 수동 매핑 모달이 뜨는 경우</p>
              <p className="text-gray-400 text-xs leading-relaxed">AI가 성명 컬럼을 자동으로 찾지 못하면 "긴급 매핑" 창이 열립니다. 컬럼을 직접 지정한 후 <b>[데이터 이식]</b>을 누르면 연결됩니다. 이식 정보가 없는 파일이라면 <b>[매핑 취소]</b>로 닫을 수 있습니다.</p>
            </div>
            <WARN>기본명단에 동일한 키(이름+생년월일 등)가 중복 등록된 경우, 해당 행은 <b>확인필요(빨간색)</b>로 표시되며 담당자 확인이 필요합니다.</WARN>
            <p className="text-gray-400 text-xs mt-2">결과 화면에서 <span className="text-[#22c55e]">👑</span> 아이콘이 있는 행이 기본명단에서 데이터가 이식된 항목입니다.</p>
          </div>
        ),
      },
    ],
  },

  1: {
    title: '1단계: 파일 업로드',
    subtitle: '처리할 명단 엑셀 파일만 올려주세요',
    sections: [
      {
        id: 'how', icon: '📤', title: '파일을 올리는 방법',
        render: () => (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-[#0d1a0f] border border-[#22c55e]/30 rounded-xl p-4">
                <div className="text-3xl mb-2 text-center">🖱️</div>
                <p className="text-white font-black text-sm text-center mb-2">드래그 앤 드롭</p>
                <p className="text-gray-400 text-xs text-center leading-relaxed">파일을 화면 중앙의 점선 영역으로 끌어다 놓습니다</p>
              </div>
              <div className="bg-[#0d1a0f] border border-[#22c55e]/30 rounded-xl p-4">
                <div className="text-3xl mb-2 text-center">👆</div>
                <p className="text-white font-black text-sm text-center mb-2">클릭하여 선택</p>
                <p className="text-gray-400 text-xs text-center leading-relaxed">업로드 영역을 클릭하면 파일 선택 창이 열립니다</p>
              </div>
            </div>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-3">
              <p className="text-[#22c55e] font-black text-xs mb-1.5">이 단계에서는 신규 처리 명단 1개만 올립니다</p>
              <p className="text-gray-400 text-xs leading-relaxed">추가 명단 파일 병합과 기본명단(이전 정제 명단) 등록은 <b>3단계 하단 패널</b>에서 진행합니다.</p>
            </div>
            <TIP>파일을 올리면 자동으로 내용을 분석하여 2단계 시트 선택으로 넘어갑니다. 잠깐 기다려 주세요.</TIP>
          </div>
        ),
      },
      {
        id: 'format', icon: '📋', title: '파일 구조 권장 형식',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm mb-4">엑셀 첫 번째 행이 <span className="text-[#22c55e] font-bold">헤더(컬럼명)</span>이어야 합니다. 아래와 같은 구조를 권장합니다.</p>
            <div className="bg-black/50 rounded-xl border border-white/10 overflow-hidden mb-4 text-xs font-mono">
              <div className="bg-[#0d1a0f] px-4 py-2 text-[#22c55e] font-bold border-b border-white/5 grid grid-cols-6 gap-2">
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
            <WARN>합계 행, 빈 행, 병합 셀이 있으면 오류가 발생할 수 있습니다. 데이터만 있는 깔끔한 형식을 권장합니다.</WARN>
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
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              엑셀 파일 안에 여러 시트가 있는 경우, 처리할 시트만 선택할 수 있습니다.
            </p>
            <div className="space-y-2 mb-4">
              <Step num="1" title="시트 목록 확인" desc="파일 안의 모든 시트가 목록으로 표시됩니다. 처리가 필요 없는 시트는 체크를 해제하세요." />
              <Step num="2" title="유형 지정" desc="각 시트의 수급자 유형을 '기초수급자', '차상위', '혼합' 중 하나로 지정합니다." />
              <Step num="3" title="지자체 정보 입력" desc="상단 입력란에 지자체명(시/군/구)을 입력합니다. 이 정보는 파일명 생성에 사용됩니다." />
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
              시트 목록 표의 <span className="text-[#22c55e] font-black">🤖 AI 구조 분석 리포트</span> 열은 각 시트의 필수 컬럼 인식 결과를 즉시 보여줍니다.
            </p>
            <div className="space-y-3 mb-4">
              {[
                { badge: '✔️ 완벽', bcolor: 'bg-[#111] border-gray-700 text-gray-300', desc: '5개 필수 항목(이름·연락처·주소·포수·행정동)이 모두 인식되었습니다. 3단계로 바로 진행하세요.' },
                { badge: '⚠️ 치명적', bcolor: 'bg-[#1a1710] border-[#d4af37]/40 text-[#d4af37]', desc: '필수 항목은 인식됐으나 해당 컬럼의 데이터가 대부분 비어 있습니다. 3단계에서 올바른 컬럼을 확인하세요.' },
                { badge: '🔴 누락: 이름, 주소…', bcolor: 'bg-[#1a0505] border-red-900/50 text-red-400', desc: '하나 이상의 필수 항목이 자동으로 인식되지 않았습니다. 3단계에서 수동 매핑이 필요합니다.' },
              ].map(t => (
                <div key={t.badge} className="p-4 bg-black/40 border border-white/5 rounded-xl flex gap-3 items-start">
                  <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold border shrink-0 mt-0.5 ${t.bcolor}`}>{t.badge}</span>
                  <p className="text-gray-400 text-xs leading-relaxed">{t.desc}</p>
                </div>
              ))}
            </div>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-3">
              <p className="text-[#d4af37] font-black text-xs mb-1">예상 포수 (맨 오른쪽 열)</p>
              <p className="text-gray-400 text-xs leading-relaxed">포수(수량) 컬럼 값의 합계로 자동 계산된 이 시트의 예상 배송 총 포수입니다. 크게 이상한 수치라면 포수 컬럼 매핑을 확인하세요.</p>
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
                { type: '차상위', color: 'border-[#22c55e]/40 bg-[#0d1a0f]', text: 'text-[#22c55e]', desc: '기초수급자 기준 중위소득 50% 이하이지만 수급자가 아닌 계층입니다.' },
                { type: '혼합', color: 'border-amber-600/40 bg-amber-950/20', text: 'text-amber-400', desc: '한 시트에 기초수급자와 차상위가 모두 섞인 경우. 구분 컬럼이 있어야 합니다.' },
                { type: '제외 🚫', color: 'border-red-700/40 bg-red-950/20', text: 'text-red-400', desc: '이 시트를 처리 대상에서 완전히 제외합니다. 요약·안내·집계 시트처럼 명단 데이터가 없는 경우 선택하세요.' },
              ].map(t => (
                <div key={t.type} className={`border ${t.color} rounded-xl p-4`}>
                  <span className={`font-black ${t.text}`}>{t.type}</span>
                  <p className="text-gray-400 text-xs mt-1 leading-relaxed">{t.desc}</p>
                </div>
              ))}
            </div>
            <WARN>혼합 시트는 반드시 '구분' 컬럼(기초수급자/차상위 구분값)이 있어야 합니다. 없으면 3단계에서 수동 설정하세요.</WARN>
          </div>
        ),
      },
      {
        id: 'meta', icon: '🏛️', title: '지자체 정보 입력',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              지자체명은 <span className="text-[#22c55e] font-bold">필수 항목</span>입니다. 최종 파일명과 집계에 사용됩니다.
            </p>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-4">
              <p className="text-gray-500 text-xs font-bold mb-2">입력 예시</p>
              <div className="grid grid-cols-3 gap-2">
                {['동대문구', '수원시 장안구', '강원 춘천시'].map(e => (
                  <div key={e} className="bg-[#111] border border-[#444] rounded-lg px-3 py-2 text-[#22c55e] text-sm font-mono text-center">{e}</div>
                ))}
              </div>
            </div>
            <TIP>파일 자동 분석 시 지자체명이 자동으로 감지되는 경우도 있습니다. 틀린 경우 수정해 주세요.</TIP>
          </div>
        ),
      },
      {
        id: 'secondfile', icon: '📎', title: '추가 파일 드롭존 (NEW)',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              기초수급자와 차상위가 <span className="text-[#22c55e] font-black">별도 파일에 분리</span>된 경우, 시트 목록 하단의
              드롭존에 두 번째 파일을 추가할 수 있습니다.
            </p>
            <div className="space-y-2 mb-4">
              <Step num="1" title="첫 번째 파일 업로드 완료" desc="기존 방식대로 첫 번째 엑셀 파일을 올립니다." />
              <Step num="2" title="하단 드롭존에 두 번째 파일 추가" desc="시트 목록 아래쪽 점선 영역에 두 번째 파일을 드래그하거나 클릭해 선택합니다." />
              <Step num="3" title="파일2 시트 확인 및 유형 지정" desc="추가된 시트는 '파일2' 배지로 구분되어 표시됩니다. 유형을 확인하고 필요하면 수정합니다." />
              <Step num="4" title="컬럼 매핑 진행" desc="3단계로 넘어가면 각 파일의 시트마다 별도의 탭이 생성됩니다." />
            </div>
            <TIP>두 번째 파일 시트는 첫 번째 파일 시트와 열 구조가 달라도 됩니다. 각 시트별로 독립적으로 매핑합니다.</TIP>
            <WARN>명단 데이터가 아닌 시트(요약·안내 등)는 체크박스를 해제하여 제외하세요.</WARN>
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
              엑셀마다 컬럼명이 다릅니다. 예를 들어 이름 컬럼이 <Badge color="gray">성명</Badge>, <Badge color="gray">이름</Badge>, <Badge color="gray">대상자</Badge> 등 다양할 수 있습니다.
              매핑은 이 컬럼명을 시스템이 이해할 수 있는 필드로 <span className="text-[#22c55e] font-bold">연결하는 과정</span>입니다.
            </p>
            <MappingVisual />
            <TIP>자주 쓰는 컬럼명은 시스템이 자동으로 매핑해 드립니다. 맞지 않는 항목만 수동으로 조정하세요.</TIP>
          </div>
        ),
      },
      {
        id: 'required', icon: '⭐', title: '필수 & 선택 항목',
        render: () => (
          <div>
            <p className="text-[#22c55e] font-black text-sm mb-3">필수 항목 (반드시 연결해야 합니다)</p>
            <div className="space-y-2 mb-5">
              {[
                { label: '성명(이름)', desc: '수급자 이름. 5자 초과 시 자동 축약됩니다.' },
                { label: '연락처(휴대폰)', desc: '010으로 시작하는 휴대폰 번호. 자동 서식 정규화됩니다.' },
                { label: '주소', desc: 'AI가 도로명주소로 변환합니다. 지번 주소도 가능합니다.' },
                { label: '포수(수량)', desc: '지원 물품 수량. 숫자 외 값은 1로 처리됩니다.' },
                { label: '행정동', desc: '행정동 이름. 주소 정제 정확도를 높이는 데 사용됩니다.' },
              ].map(f => (
                <div key={f.label} className="flex gap-3 p-3 bg-[#0d1a0f] border border-[#22c55e]/20 rounded-xl">
                  <Star size={14} className="text-[#22c55e] shrink-0 mt-0.5" />
                  <div>
                    <span className="text-white font-bold text-sm">{f.label}</span>
                    <p className="text-gray-400 text-xs mt-0.5">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-gray-400 font-black text-sm mb-3">선택 항목 (있으면 더 풍부한 결과)</p>
            <div className="flex flex-wrap gap-2">
              {['생년월일', '보조연락처(유선)', '문자수신 여부', '수급자 구분', '특이사항', '배송 기사', '배송 순번'].map(f => (
                <Badge key={f} color="gray">{f}</Badge>
              ))}
            </div>
          </div>
        ),
      },
      {
        id: 'tabs', icon: '🗂️', title: '시트별 탭 & 매핑현황',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              선택된 시트가 <span className="text-[#22c55e] font-black">2개 이상</span>이면 상단에 <span className="text-white font-bold">탭</span>이 생성됩니다.
              각 시트의 열 구조가 완전히 달라도 탭별로 독립적으로 매핑할 수 있습니다.
            </p>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-4 text-xs">
              <div className="flex gap-2 mb-3">
                <div className="px-3 py-2 bg-[#0a0a0a] border border-[#22c55e]/40 rounded-t-lg text-white font-bold flex items-center gap-2">
                  <span className="text-[#22c55e] text-xs">✓</span> 기초수급자명단 <span className="text-[9px] px-1 bg-[#111] text-gray-400 border border-gray-700 rounded">수급</span>
                </div>
                <div className="px-3 py-2 bg-black/40 border border-[#333] rounded-t-lg text-gray-500 font-bold flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border-2 border-red-500 shrink-0 inline-block"/> 차상위명단 <span className="text-[9px] px-1 bg-[#0d1a0f] text-[#22c55e] border border-[#22c55e]/30 rounded">차상위</span>
                </div>
              </div>
              <p className="text-gray-500">✓ 초록 체크 = 필수 항목 모두 매핑 완료 / 빨간 원 = 아직 미완료</p>
            </div>
            <p className="text-[#22c55e] font-black text-xs mb-2">시트별 독립 매핑현황 표시</p>
            <p className="text-gray-400 text-xs leading-relaxed mb-4">
              탭 아래쪽 매핑현황 바에는 <b>각 시트마다 별도의 행</b>이 표시됩니다. 수급자 시트와 차상위 시트의 열 구조가 완전히 달라도
              각자 어떤 항목이 매핑됐고 어떤 항목이 누락됐는지 한눈에 확인할 수 있습니다.
              행을 클릭하면 해당 시트로 바로 이동합니다.
            </p>
            <div className="space-y-2 mb-4">
              <Step num="1" title="탭을 클릭해 시트 전환" desc="탭을 눌러 각 시트로 이동하고, 그 시트의 컬럼을 독립적으로 매핑합니다." />
              <Step num="2" title="매핑현황 바로 상태 확인" desc="각 시트 행의 빨간 ✕ 배지를 보고 누락된 필수 항목을 빠르게 파악합니다." />
              <Step num="3" title="모든 시트 완료 후 정제 가동" desc="모든 탭의 필수 항목이 매핑되면 상단 '12단계 정제 가동' 버튼이 활성화됩니다." />
            </div>
            <TIP>시트가 1개뿐이면 탭은 표시되지 않고 단일 매핑현황 바만 표시됩니다.</TIP>
          </div>
        ),
      },
      {
        id: 'note-toggle', icon: '📝', title: '비고 자동포함 토글 (NEW)',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              매핑 패널 중간의 <span className="text-[#22c55e] font-black">"비고 → 특이사항 자동 포함"</span> 체크박스로
              비고 열 내용을 특이사항에 자동으로 끌어올지 여부를 선택할 수 있습니다.
            </p>
            <div className="space-y-3 mb-4">
              <div className="flex gap-3 p-3 bg-[#0d1a0f] border border-[#22c55e]/20 rounded-xl items-start">
                <span className="text-[#22c55e] font-black text-lg mt-0.5">☑</span>
                <div>
                  <p className="text-white font-bold text-sm">ON (기본값)</p>
                  <p className="text-gray-400 text-xs mt-0.5">비고 열 내용이 특이사항에 자동으로 포함됩니다. 기존 특이사항이 있으면 함께 병합됩니다.</p>
                </div>
              </div>
              <div className="flex gap-3 p-3 bg-black/40 border border-white/5 rounded-xl items-start">
                <span className="text-gray-600 font-black text-lg mt-0.5">☐</span>
                <div>
                  <p className="text-white font-bold text-sm">OFF</p>
                  <p className="text-gray-400 text-xs mt-0.5">비고 열을 가져오지 않습니다. 정부 양식처럼 비고에 불필요한 내용이 있을 때 사용하세요.</p>
                </div>
              </div>
            </div>
            <TIP>정부 양식(양곡지급내역 등)처럼 비고에 집계 숫자나 불필요한 값이 들어오는 경우 OFF로 설정하세요.</TIP>
          </div>
        ),
      },
      {
        id: 'automapping', icon: '🤖', title: 'AI 자동 매핑 (데이터 기반)',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              3단계 진입 시 시스템이 <span className="text-[#22c55e] font-black">실제 셀 데이터를 분석</span>해 올바른 컬럼을 자동으로 연결합니다.
              헤더명이 달라도 데이터 패턴으로 인식합니다.
            </p>
            <div className="space-y-2 mb-4">
              {[
                { field: '연락처', desc: '010으로 시작하는 8~10자리 숫자 패턴으로 감지' },
                { field: '성명', desc: '2~6자 한글 이름 패턴으로 감지' },
                { field: '주소', desc: '5자 이상이며 시/군/구/동/로/길이 포함된 텍스트로 감지' },
                { field: '생년월일', desc: '6자리·8자리 숫자 또는 주민번호 형식으로 감지' },
                { field: '포수(수량)', desc: '1~50 사이의 정수 패턴으로 감지' },
                { field: '행정동', desc: '동/읍/면/리로 끝나는 15자 이하 텍스트로 감지' },
              ].map(r => (
                <div key={r.field} className="flex gap-3 p-2.5 bg-black/40 border border-white/5 rounded-xl text-xs">
                  <Badge color="green">{r.field}</Badge>
                  <span className="text-gray-400">{r.desc}</span>
                </div>
              ))}
            </div>
            <TIP>자동 매핑이 틀렸다면 좌측 드롭다운에서 올바른 컬럼으로 수동 수정하면 됩니다.</TIP>
          </div>
        ),
      },
      {
        id: 'bottom-panel', icon: '📎', title: '추가 명단 & 기본명단 하단 패널',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              3단계 화면 <span className="text-[#22c55e] font-black">하단 패널</span>에서 추가 명단 파일 병합과 기본명단 이식을 모두 처리합니다.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-blue-950/20 border border-blue-700/30 rounded-xl p-4">
                <p className="text-blue-300 font-black text-xs mb-2">추가 명단 등록 (왼쪽)</p>
                <p className="text-gray-400 text-xs leading-relaxed">현재 로드된 파일 목록과 행 수가 표시됩니다. <b>+ 파일 추가</b>를 클릭하면 <span className="text-blue-300 font-bold">시트 선택 모달</span>이 열립니다. 추가할 시트를 체크하고 수급구분(기초/차상위/혼합)을 지정한 뒤 [추가 완료]를 누르면 탭이 생성되고 AI가 자동 매핑합니다.<br/><span className="text-blue-400 font-bold">X 버튼</span>으로 추가된 파일을 개별 제거할 수 있습니다 (메인 파일 제외).</p>
              </div>
              <div className="bg-[#0d1a0f] border border-[#22c55e]/20 rounded-xl p-4">
                <p className="text-[#22c55e] font-black text-xs mb-2">기본명단 이식 (오른쪽)</p>
                <p className="text-gray-400 text-xs leading-relaxed">이전 정제 명단을 올리면 AI가 성명 컬럼을 자동 감지하여 <b>바로 연결</b>됩니다. 여러 파일을 합산 등록할 수 있으며 X 버튼으로 개별 제거가 가능합니다.<br/><span className="text-amber-400 font-bold">성명 미감지 시</span>에만 수동 매핑 창이 열립니다.</p>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <Step num="1" title="추가 명단 파일 추가" desc="하단 왼쪽 '+ 파일 추가' 클릭 → 시트 선택 모달에서 시트 체크 + 수급구분 지정 → [추가 완료] → 새 탭 자동 생성 + AI 자동 매핑." />
              <Step num="2" title="기본명단 등록" desc="하단 오른쪽 '+ 기본명단 추가'로 이전 명단을 올립니다. 성명 컬럼이 있으면 확인 없이 자동 연결됩니다." />
              <Step num="3" title="정제 가동" desc="모든 매핑 완료 후 상단 버튼을 누르면 기본명단 이식과 함께 처리가 시작됩니다." />
            </div>
            <WARN>기본명단의 문자수신 여부도 이식됩니다. 기본명단 등록 시 문자수신 컬럼을 매핑하면 이식 대상에 포함됩니다.</WARN>
          </div>
        ),
      },
      {
        id: 'missing', icon: '❓', title: '컬럼을 못 찾을 때',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              시스템이 필수 항목에 해당하는 컬럼을 찾지 못하면 <span className="text-amber-400 font-bold">컬럼 선택 팝업</span>이 나타납니다.
            </p>
            <div className="space-y-2 mb-4">
              <Step num="1" title="팝업에서 대체 컬럼 선택" desc="드롭다운에서 해당 데이터가 있는 컬럼을 선택합니다" />
              <Step num="2" title="'이 컬럼으로 연결' 클릭" desc="선택한 컬럼이 해당 필드로 등록됩니다" />
              <Step num="3" title="정제 버튼 다시 클릭" desc="설정 완료 후 정제 시작 버튼을 다시 누르면 처리가 시작됩니다" />
            </div>
            <WARN>모든 필수 항목이 연결되어야 정제를 시작할 수 있습니다. 해당 데이터가 없는 컬럼을 선택하면 결과가 비어 있을 수 있습니다.</WARN>
          </div>
        ),
      },
      {
        id: 'sms', icon: '📱', title: '문자 수신 여부 인식',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              문자 수신 컬럼의 다양한 표현을 자동으로 <Badge color="green">Y</Badge> / <Badge color="gray">N</Badge>으로 변환합니다.
            </p>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4">
              <p className="text-[#22c55e] font-bold text-xs mb-3">Y로 인식되는 값</p>
              <div className="flex flex-wrap gap-2">
                {['Y', 'y', 'ㅇ', 'o', 'O', '○', 'yes', 'YES', '예', '동의', '수신', '가능', '허용', '1'].map(v => (
                  <span key={v} className="bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] px-2 py-1 rounded font-mono text-xs">{v}</span>
                ))}
              </div>
              <p className="text-gray-500 font-bold text-xs mt-4 mb-2">그 외 모든 값</p>
              <Badge color="gray">N (수신 거부)</Badge>
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
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              상단 탭으로 결과를 3가지로 필터링할 수 있습니다.
            </p>
            <div className="space-y-3 mb-4">
              {[
                { label: '전체보기', color: 'border-[#22c55e] text-[#22c55e] bg-[#111]', desc: '모든 행을 표시합니다. 전체 건수를 확인할 때 사용합니다.' },
                { label: '확인필요', color: 'border-red-500 text-red-400 bg-red-950/30', desc: '주소 정제에 실패하거나 확인이 필요한 행만 표시합니다. 반드시 검토하세요.' },
                { label: '정제완료', color: 'border-green-500 text-green-400 bg-green-950/30', desc: '주소 변환이 성공적으로 완료된 행만 표시합니다.' },
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
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              빨간색 행은 주소 변환이 실패한 항목입니다. 직접 수정할 수 있습니다.
            </p>
            <ErrorExample />
            <div className="space-y-2 mt-4">
              <Step num="1" title="주소 셀 클릭" desc="빨간 행의 주소 칸을 클릭하면 직접 입력 가능한 상태가 됩니다" />
              <Step num="2" title="주소 수정" desc="올바른 주소로 수정합니다. 도로명이나 건물명을 포함하면 인식률이 높아집니다" />
              <Step num="3" title="Enter 키 누르기" desc="Enter를 누르면 AI가 즉시 다시 정제를 시도합니다. 성공하면 초록색으로 바뀝니다" />
            </div>
            <TIP>Enter 후 정제 성공 시 오타 사전에 자동 등록됩니다. 다음에 같은 주소가 들어오면 더 빠르게 처리됩니다.</TIP>
          </div>
        ),
      },
      {
        id: 'crown', icon: '👑', title: '기본명단 이식 표시',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              기본명단 데이터가 이식된 행은 NO 칸에 <span className="text-[#22c55e]">👑</span> 아이콘이 표시됩니다.
            </p>
            <div className="bg-black/40 border border-white/10 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[#22c55e] animate-pulse">👑</span>
                <span className="text-white font-bold text-sm">기본명단 이식됨</span>
                <Badge color="green">생년월일 일치</Badge>
              </div>
              <p className="text-gray-400 text-xs leading-relaxed">
                해당 행의 배송 기사, 배송 순번, 특이사항 등이 기본명단에서 자동으로 복사됩니다.
                특이사항은 <Badge color="gray">[기준]태그</Badge>로 구분됩니다.
              </p>
            </div>
            <div className="space-y-2">
              {[
                { num: '①', badge: '이름+생년월일', desc: '생년월일 6자리가 일치 (1순위)' },
                { num: '②', badge: '이름+휴대폰', desc: '휴대폰번호가 일치 (2순위)' },
                { num: '③', badge: '이름+추가연락처', desc: '유선·추가 연락처가 일치 (3순위)' },
              ].map(m => (
                <div key={m.badge} className="flex items-center gap-3 text-xs text-gray-400 p-2 bg-black/30 rounded-lg">
                  <span className="text-[#22c55e] font-black shrink-0">{m.num}</span>
                  <Badge color="green">{m.badge}</Badge><span>{m.desc}</span>
                </div>
              ))}
            </div>
            <WARN>기본명단에 동일한 키가 중복 존재하면 해당 행이 <b>빨간색(확인필요)</b>으로 표시됩니다. 담당자에게 확인 후 수동 수정하세요.</WARN>
          </div>
        ),
      },
      {
        id: 'export', icon: '📦', title: '내보내기 방법',
        render: () => (
          <div>
            <div className="space-y-4 mb-4">
              {[
                {
                  title: '표준 명단 패키징',
                  color: 'bg-[#22c55e] text-black',
                  desc: '현재 필터된 전체 결과를 표준 엑셀 파일로 내보냅니다. 파일명에 지자체·월·건수가 자동 포함됩니다.',
                },
                {
                  title: '오류만 내보내기',
                  color: 'bg-red-950/60 border border-red-500/60 text-red-400',
                  desc: '주소 확인이 필요한 항목만 별도 엑셀로 내보냅니다. 원본 담당자에게 재확인 요청할 때 활용하세요.',
                },
              ].map(e => (
                <div key={e.title} className="p-4 rounded-xl bg-black/40 border border-white/10">
                  <span className={`inline-block px-3 py-1 rounded-lg text-xs font-black mb-2 ${e.color}`}>{e.title}</span>
                  <p className="text-gray-400 text-xs leading-relaxed">{e.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-gray-500 font-bold text-xs mb-2">컬럼 설정으로 내보낼 열 직접 선택 가능</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {['NO', '구분', '도', '행정동', '성명', '생년월일', '포수', '휴대폰', '유선전화', '주소', '특이사항', '기사', '문자수신', '배송순번', '사유'].map(c => (
                <Badge key={c} color="gray">{c}</Badge>
              ))}
            </div>
            <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-3">
              <p className="text-gray-500 font-bold text-xs mb-2">내보내기 파일명 형식</p>
              <div className="bg-[#111] border border-gray-700 rounded-lg px-3 py-2 font-mono text-xs text-[#22c55e]">
                {'{{지자체명}}-{{월}}월-기초{{N}},차상위{{N}},전체{{N}}-MMDDHHMMSS.xlsx'}
              </div>
              <p className="text-gray-500 text-xs mt-2">예) 동대문구-5월-기초120,차상위45,전체165-05150930.xlsx</p>
            </div>
            <TIP>Ctrl+Z로 수정 내역을 되돌릴 수 있습니다. 내보내기 전 최종 검토 후 사용하세요.</TIP>
          </div>
        ),
      },
      {
        id: 'bulk', icon: '☑️', title: '행 선택 및 일괄 작업 (NEW)',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              결과 표 맨 왼쪽 <span className="text-white font-bold">체크박스</span>를 이용해 여러 행을 선택하고
              일괄 삭제 또는 특이사항 일괄 설정을 할 수 있습니다.
            </p>
            <div className="space-y-3 mb-4">
              <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/20">
                <p className="text-red-400 font-black text-sm mb-1">선택 삭제</p>
                <p className="text-gray-400 text-xs leading-relaxed">잘못 들어온 행(합계행, 빈 행, 테스트 행 등)을 체크한 뒤 <span className="text-red-400 font-bold">"선택 삭제"</span> 버튼으로 제거합니다. Ctrl+Z로 취소할 수 있습니다.</p>
              </div>
              <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-500/20">
                <p className="text-purple-300 font-black text-sm mb-1">특이사항 일괄 설정</p>
                <p className="text-gray-400 text-xs leading-relaxed">여러 행을 선택한 뒤 <span className="text-purple-300 font-bold">"특이사항 일괄"</span> 버튼을 클릭하면 모달창이 열립니다. 내용을 입력하고 적용하면 선택된 모든 행의 특이사항이 동시에 바뀝니다.</p>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <Step num="1" title="체크박스로 행 선택" desc="각 행의 체크박스를 클릭하거나, 헤더 체크박스로 현재 페이지 전체 선택/해제합니다." />
              <Step num="2" title="상단 버튼 확인" desc="선택된 건수가 상단에 표시되고, '특이사항 일괄'·'선택 삭제' 버튼이 나타납니다." />
              <Step num="3" title="작업 적용" desc="삭제 시 확인창이 뜨고, 특이사항 일괄 설정 시 모달창에서 내용을 입력합니다." />
            </div>
            <TIP>선택은 페이지를 넘겨도 유지됩니다. 여러 페이지에 걸쳐 선택한 뒤 한꺼번에 처리할 수 있습니다.</TIP>
            <WARN>삭제된 행은 Ctrl+Z로만 복구됩니다. 내보내기 전에 반드시 확인하세요.</WARN>
          </div>
        ),
      },
      {
        id: 'dong-report', icon: '🗺️', title: '행정동별 보고서 내보내기',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              <span className="text-blue-300 font-black">"행정동별 보고서"</span> 버튼을 클릭하면 행정동별로 분류된 엑셀 파일이 생성됩니다.
            </p>
            <div className="bg-black/40 border border-white/5 rounded-xl overflow-hidden mb-4 text-xs">
              <div className="bg-[#0d1a0f] px-4 py-2 text-[#22c55e] font-bold border-b border-white/5">파일 구조</div>
              {[
                { sheet: '○○시 5월 정보', desc: '전체합계 + 행정동별 수급자/차상위/전체 포수 요약' },
                { sheet: '합본', desc: '전체 명단 통합 (필터 상태 기준)' },
                { sheet: '청운효자동', desc: '해당 행정동 명단만 별도 시트' },
                { sheet: '사직동 …', desc: '행정동 수만큼 시트 자동 생성' },
              ].map(r => (
                <div key={r.sheet} className="px-4 py-2.5 border-b border-white/5 last:border-0 flex gap-4">
                  <span className="text-blue-300 font-mono font-bold shrink-0 w-28">{r.sheet}</span>
                  <span className="text-gray-400">{r.desc}</span>
                </div>
              ))}
            </div>
            <TIP>보고서는 현재 필터 상태를 기준으로 생성됩니다. '전체보기'로 설정 후 내보내면 모든 행정동이 포함됩니다.</TIP>
          </div>
        ),
      },
      {
        id: 'cols', icon: '⚙️', title: '컬럼 설정',
        render: () => (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed mb-4">
              상단 <span className="text-white font-bold">컬럼 설정</span> 버튼으로 내보낼 열과 순서를 변경할 수 있습니다.
            </p>
            <div className="space-y-2 mb-4">
              <Step num="1" title="'컬럼 설정' 버튼 클릭" desc="결과 화면 우측 상단의 컬럼 설정 아이콘을 클릭합니다" />
              <Step num="2" title="체크박스로 열 표시/숨김" desc="내보낼 열은 체크, 필요 없는 열은 체크 해제합니다" />
              <Step num="3" title="드래그로 순서 변경" desc="열 이름을 위아래로 드래그하여 출력 순서를 바꿀 수 있습니다" />
            </div>
            <TIP>설정은 브라우저에 자동 저장됩니다. 다음 이용 시에도 같은 설정이 유지됩니다.</TIP>
          </div>
        ),
      },
    ],
  },
};

export default function HelpModal({ step, onClose }) {
  const data = CONTENT[step] || CONTENT[0];
  const [activeSection, setActiveSection] = useState(data.sections[0].id);
  const currentSection = data.sections.find(s => s.id === activeSection) || data.sections[0];
  const currentIdx = data.sections.findIndex(s => s.id === activeSection);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[700] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl bg-[#0a100c] border border-[#22c55e]/30 rounded-3xl shadow-[0_0_80px_rgba(34,197,94,0.2)] flex flex-col overflow-hidden max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-[#1e2d22] shrink-0 bg-gradient-to-r from-[#0d1a0f] to-[#0a100c]">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="bg-[#22c55e] text-black text-[10px] font-black px-2 py-0.5 rounded tracking-widest">GUIDE</span>
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
          <div className="w-52 shrink-0 border-r border-[#1e2d22] flex flex-col bg-black/20">
            {/* Step nav */}
            <div className="px-3 py-3 border-b border-[#1e2d22]">
              <p className="text-gray-600 text-[10px] font-black tracking-widest mb-2 px-2">단계 선택</p>
              {STEPS.map(s => (
                <button
                  key={s.key}
                  onClick={() => {
                    const newData = CONTENT[s.key];
                    if (newData) setActiveSection(newData.sections[0].id);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 mb-0.5 ${
                    step === s.key ? 'bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
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
                      ? 'bg-[#22c55e] text-black shadow-[0_0_12px_rgba(34,197,94,0.4)]'
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
        <div className="flex items-center justify-between px-8 py-4 border-t border-[#1e2d22] shrink-0 bg-black/20">
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
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-[#22c55e] hover:text-white disabled:opacity-20 transition-colors"
          >
            다음 <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
