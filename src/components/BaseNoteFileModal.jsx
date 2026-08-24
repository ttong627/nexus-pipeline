import { useRef } from 'react';
import { X, Upload, FileSpreadsheet, SkipForward, Loader2, CheckCircle, Users } from 'lucide-react';

// 쉬운 정제 자동저장 직전 1단계 — 기초명단(특이사항 파일)을 선택(선택사항)
//  · 건너뛰기 → 단순 정제 엑셀만 다운로드
//  · 파일 선택 → 특이사항·배송순번 매칭 이식 + 동명이인 별도 시트 포함 다운로드
export default function BaseNoteFileModal({ processing, result, onPickFile, onSkip, onClose }) {
  const fileRef = useRef(null);

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-[#0a0a0a] border border-[#2a2a2a] rounded-2xl shadow-2xl overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#0d1420]">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-emerald-300" />
            <span className="text-sm font-black text-white">기초명단(특이사항 파일) 추가</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" disabled={processing}>
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!result && (
            <>
              <p className="text-[13px] text-gray-400 leading-relaxed">
                정제가 끝났습니다. 기초명단(특이사항 파일)을 추가하면 <b className="text-emerald-300">특이사항·배송순번</b>을
                자동 매칭해 이식합니다. <b className="text-gray-300">없으면 그냥 단순 정제 엑셀</b>로 받으셔도 됩니다.
              </p>
              <div className="text-[11px] text-gray-500 bg-black/30 border border-white/10 rounded-lg px-3 py-2 leading-relaxed">
                · 매칭: <b className="text-gray-300">이름 + (생년월일·휴대폰·행정동 중 1개)</b> 일치<br/>
                · 동명이인 등 헷갈리는 건은 <b className="text-amber-300">「동명이인확인」 시트</b>로 분리<br/>
                · 특이사항 파일의 중복 인원은 자동으로 1명으로 정리
              </div>

              {processing ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Loader2 size={32} className="text-emerald-400 animate-spin" />
                  <span className="text-sm text-emerald-300 font-bold">특이사항 파일 분석·매칭 중…</span>
                </div>
              ) : (
                <>
                  <label className="flex flex-col items-center justify-center gap-2 py-7 border-2 border-dashed border-emerald-500/30 rounded-xl cursor-pointer hover:border-emerald-400/60 hover:bg-emerald-950/10 transition-colors">
                    <Upload size={28} className="text-emerald-400" />
                    <span className="text-sm font-bold text-white">특이사항 파일 선택 (클릭)</span>
                    <span className="text-[11px] text-gray-500">.xlsx · .xls · .csv</span>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPickFile(f); }}
                    />
                  </label>

                  <button
                    onClick={onSkip}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#111] border border-[#2a2a2a] text-gray-300 font-bold text-sm hover:bg-[#1a1a1a] transition-colors"
                  >
                    <SkipForward size={14} /> 건너뛰고 정제 엑셀만 다운로드
                  </button>
                </>
              )}
            </>
          )}

          {result && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle size={18} />
                <span className="text-sm font-black">이식 완료 — 엑셀이 다운로드되었습니다</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-emerald-950/30 border border-emerald-500/30 p-3 text-center">
                  <div className="text-lg font-black text-emerald-300 tabular-nums">{result.appliedCount.toLocaleString()}</div>
                  <div className="text-[10px] font-bold text-emerald-400/80">이식 완료</div>
                </div>
                <div className={`rounded-lg p-3 text-center border ${result.ambiguousCount ? 'bg-amber-950/30 border-amber-500/35' : 'bg-black/30 border-white/10'}`}>
                  <div className={`text-lg font-black tabular-nums ${result.ambiguousCount ? 'text-amber-300' : 'text-gray-600'}`}>{result.ambiguousCount.toLocaleString()}</div>
                  <div className="text-[10px] font-bold text-gray-400 flex items-center justify-center gap-1"><Users size={9}/> 동명이인</div>
                </div>
              </div>
              {result.ambiguousCount > 0 && (
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  엑셀의 <b className="text-amber-300">「동명이인확인」</b> 시트를 열어, 어느 특이사항을 붙일지 담당자가 직접 확인·처리하세요.
                </p>
              )}
              <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 font-bold text-sm hover:bg-emerald-600/30 transition-colors">
                닫기
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
