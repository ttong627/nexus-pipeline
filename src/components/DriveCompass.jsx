import { dirName } from '../utils/driveSim.js';

// 주행 시점 표시 — 형 지시 2026-08-04
//   *"앞을 보는 시점 표시도 같이 해줘. 어느 방향 시점인지 시점 표시 기능도 넣어 달란 이야기야"*
//   두 가지를 한 눈에 보여준다:
//     · 차가 **가는 방향**(살구색 화살표)
//     · 지금 **보고 있는 방향**(하늘색 부채꼴 — 마우스로 돌린 만큼 벌어진다)
//   ⚠️나침반은 지도가 아니라 **머리 위에서 내려다본 그림**이다. 북(N)이 항상 위.
export default function DriveCompass({ heading = 0, look = 0, view = '운전석', turned = false }) {
  const h = ((Number(heading) || 0) % 360 + 360) % 360;   // 차가 가는 방향
  const l = ((Number(look) || 0) % 360 + 360) % 360;      // 실제로 보는 방향
  const R = 30;
  const rad = (d) => (d - 90) * (Math.PI / 180);
  const pt = (d, r) => [50 + r * Math.cos(rad(d)), 50 + r * Math.sin(rad(d))];
  // 시야 부채꼴(약 ±26°) — 「이만큼 보인다」
  const [ax, ay] = pt(l - 26, R);
  const [bx, by] = pt(l + 26, R);
  const [hx, hy] = pt(h, R - 4);

  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-900/95 backdrop-blur px-2.5 py-1.5 shadow-2xl ring-1 ring-white/10">
      <svg viewBox="0 0 100 100" className="w-11 h-11 shrink-0" aria-hidden="true">
        <circle cx="50" cy="50" r={R + 6} fill="rgba(255,255,255,.06)" />
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="2" />
        {/* 지금 보는 쪽 — 부채꼴 */}
        <path d={`M50,50 L${ax},${ay} A${R},${R} 0 0,1 ${bx},${by} Z`} fill="rgba(56,189,248,.42)" />
        {/* 차가 가는 쪽 — 화살표 */}
        <line x1="50" y1="50" x2={hx} y2={hy} stroke="#fb923c" strokeWidth="5" strokeLinecap="round" />
        <circle cx="50" cy="50" r="4.5" fill="#fff" />
        <text x="50" y="15" textAnchor="middle" fontSize="15" fontWeight="900" fill="#f87171">N</text>
      </svg>
      <div className="min-w-0">
        <div className="text-[11px] font-black text-white leading-tight">
          {dirName(l)}쪽 <span className="text-white/45 font-bold tabular-nums">{Math.round(l)}°</span>
        </div>
        <div className="text-[10px] font-bold text-sky-300 leading-tight">{view}</div>
        <div className="text-[10px] font-bold leading-tight">
          {turned
            ? <span className="text-amber-300">고개 돌림 · 놓으면 정면</span>
            : <span className="text-white/40">끌어서 둘러보기</span>}
        </div>
      </div>
    </div>
  );
}
