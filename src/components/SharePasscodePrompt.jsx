// 지도 배포(공유 링크 생성) 순간에 **그 지도의 기사 비밀번호를 받는 창** — 형 지시 2026-08-23
//   "암호는 담당자가 지도 배포할때마다 받아줘 / 미리 생성하는 방식이 아니라 지도마다 암호를 넣는 방식으로"
//
//   ★왜 별도 컴포넌트인가(두 가지 이유, 둘 다 실제 사고에서 나왔다):
//     ① **입력값을 부모에 두지 않는다**(CLAUDE.md UI-1) — RouteMapModal 은 수천 건 명단·지도를 들고 있어서
//        부모 state 로 받으면 글자 하나마다 전체가 다시 그려져 타이핑이 버벅인다.
//     ② **암호를 화면 밖으로 들고 있지 않는다** — 미리 넣어 둔 값은 다음 지도에 딸려가거나, 안 넣은 채 배포된다.
//        이 창이 열릴 때마다 빈 칸에서 시작하고, 확인을 누르는 순간에만 부모로 넘긴다.
//   ※같은 번호를 다시 써도 된다(중복 검사 없음 — 형 지시 "똑같은 암호라도 상관없이").
import { useState, useEffect, useRef } from 'react';
import { X, Lock } from 'lucide-react';
import { randomPasscode, isValidPasscode, DEFAULT_SHARE_PASSCODE } from '../utils/sharePasscode.js';

export default function SharePasscodePrompt({ open, busy = false, driverCount = 0, onCancel, onConfirm }) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  // 열릴 때마다 빈 칸에서 시작한다 — 지난 지도의 번호가 남아 있으면 "매번 받는다"가 깨진다.
  useEffect(() => {
    if (!open) return;
    setValue('');
    setErr('');
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault?.();
    if (busy) return;
    // ★비워 두면 기본번호로 발행한다(형 지시 2026-08-25 "안 정하거나 없는 경우는 181111").
    //   담당자가 넣으면 그 번호가 그 지도의 번호다 — 기존 동작 그대로.
    const passcode = value.trim() === '' ? DEFAULT_SHARE_PASSCODE : value;
    if (!isValidPasscode(passcode)) { setErr('숫자 6자리를 입력하거나, 비워 두면 기본번호로 만듭니다.'); return; }
    onConfirm(passcode);
  };

  return (
    <div className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => { if (!busy) onCancel(); }}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-[#0b0b0b] border border-[#232323] rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1c1c1c]">
          <div className="flex items-center gap-2">
            <Lock size={14} className="text-green-400" />
            <span className="text-[13px] font-black text-white">이 지도의 기사 비밀번호</span>
          </div>
          <button type="button" onClick={onCancel} disabled={busy}
            className="text-gray-500 hover:text-white transition-colors disabled:opacity-40" aria-label="닫기">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            기사는 <span className="text-gray-200 font-bold">링크 + 이 번호</span>가 있어야 지도를 엽니다.
            지도마다 새로 정하며, <span className="text-gray-200 font-bold">지난번과 같은 번호를 써도 됩니다.</span>
          </p>

          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="off"
              value={value}
              onChange={e => { setValue(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(''); }}
              placeholder="숫자 6자리"
              disabled={busy}
              className="flex-1 min-w-0 bg-black/50 border border-[#2a2a2a] focus:border-green-500/60 rounded-lg px-3 py-2.5 text-center text-lg font-black tracking-[0.35em] text-white outline-none disabled:opacity-50"
            />
            <button type="button" onClick={() => { setValue(randomPasscode()); setErr(''); }} disabled={busy}
              title="무작위 6자리 만들기"
              className="px-3 rounded-lg border border-[#2a2a2a] text-sm text-gray-300 hover:text-white hover:border-green-500/40 transition-colors disabled:opacity-40">🎲</button>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">
            비워 두고 만들면 <span className="text-green-300 font-black">기본번호 {DEFAULT_SHARE_PASSCODE}</span> 으로 발행됩니다.
          </p>

          {err && <p className="text-[11px] text-amber-300 font-bold">{err}</p>}

          <p className="text-[10px] text-gray-600 leading-relaxed">
            만든 뒤 화면에 한 번만 보여 줍니다(저장되지 않습니다). 링크와 번호는 따로 전달하세요.
            {driverCount > 0 && <> · 기사 {driverCount}명</>}
          </p>
        </div>

        <div className="flex gap-2 px-4 pb-4">
          <button type="button" onClick={onCancel} disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg border border-[#2a2a2a] text-[12px] font-bold text-gray-300 hover:text-white transition-colors disabled:opacity-40">
            취소
          </button>
          <button type="submit" disabled={busy || (value.length !== 0 && value.length !== 6)}
            className="flex-[2] px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-[12px] font-black text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? '만드는 중…' : (value.length === 6 ? '이 번호로 공유 링크 만들기' : `기본번호 ${DEFAULT_SHARE_PASSCODE} 으로 만들기`)}
          </button>
        </div>
      </form>
    </div>
  );
}
