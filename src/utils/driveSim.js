// 가상 주행 — 경로를 따라 달리는 카메라·차량 위치 계산 (형 지시 2026-08-04).
//   *"가상 주행 기능은 3D 지도에서 실제 주행처럼 시각적 효과를 강화해서
//     실제 운전중일 정도로 착각이 들도록 해줘"*
//   *"주행 중 추천 경로 안내(네비식) 순번 적용 여부 확인"*
//
// ⛔여기엔 화면·지도 API 가 없다 — 순수 계산만. 그래야 테스트로 지킬 수 있다.
//   (이 저장소엔 DOM 테스트 라이브러리가 없어, 로직을 화면에 인라인으로 박으면 회귀를 못 잡는다)
import { haversine as haversineDeg } from '../engine/routeSequenceEngine.js';

// ★거리 계산은 엔진 SSOT 를 쓴다(복제 금지). 다만 시그니처가 다르다 —
//   원본(yyplus routeOptim)은 `{lat,lng}` 객체 2개, 엔진은 스칼라 4개를 받는다.
//   호출부(아래 주행 로직)를 건드리지 않도록 여기서만 맞춘다.
//   두 구현은 수학적으로 동일하다(2R·asin√h ≡ 2R·atan2(√a,√(1−a))).
const haversine = (a, b) => {
  if (!a || !b || a.lat == null || b.lat == null || a.lng == null || b.lng == null) return 0;
  return haversineDeg(Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng));
};

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

/** 두 점 사이 방위각(0=북, 90=동). 차량이 바라보는 방향 = 카메라 heading. */
export function bearing(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return 0;
  const la1 = a.lat * D2R; const la2 = b.lat * D2R;
  const dLng = (b.lng - a.lng) * D2R;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** 두 방위각의 최단 차이(-180..180). 커브를 얼마나 트는지 = 카메라 기울임(롤)에 쓴다. */
export function angleDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * 경로의 구간별·누적 거리(m).
 * @returns {{segs:number[], acc:number[], total:number}} acc[i] = 0..i 지점까지 누적
 */
export function pathTotals(points = []) {
  const pts = (points || []).filter((p) => p && p.lat != null && p.lng != null);
  const segs = []; const acc = [0];
  for (let i = 1; i < pts.length; i += 1) {
    const d = haversine(pts[i - 1], pts[i]);
    segs.push(d);
    acc.push(acc[i - 1] + d);
  }
  return { segs, acc, total: acc[acc.length - 1] || 0 };
}

/**
 * 출발점에서 `meters` 만큼 달린 지점 — 좌표 + 진행 방향.
 *   구간 사이는 **선형 보간**한다(도로 형상이 아니라 정차점 직선 경로 기준).
 * @returns {{lat,lng,heading,legIndex,legT,done}|null}
 */
export function posAt(points = [], meters = 0) {
  const pts = (points || []).filter((p) => p && p.lat != null && p.lng != null);
  if (!pts.length) return null;
  if (pts.length === 1) return { ...pts[0], heading: 0, legIndex: 0, legT: 1, done: true };
  const { segs, total } = pathTotals(pts);
  const m = Math.max(0, Math.min(Number(meters) || 0, total));
  let left = m;
  for (let i = 0; i < segs.length; i += 1) {
    if (left <= segs[i] || i === segs.length - 1) {
      const t = segs[i] > 0 ? Math.min(1, left / segs[i]) : 1;
      const a = pts[i]; const b = pts[i + 1];
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        heading: bearing(a, b),
        legIndex: i,
        legT: t,
        done: m >= total,
      };
    }
    left -= segs[i];
  }
  const last = pts[pts.length - 1];
  return { ...last, heading: bearing(pts[pts.length - 2], last), legIndex: segs.length - 1, legT: 1, done: true };
}

/**
 * 다음 정차점 안내 — 네비 배너용.
 * @returns {{index:number, remainM:number, remainTotalM:number, arrived:boolean}}
 *   index = 다음에 도착할 지점의 배열 인덱스(0=출발지이므로 보통 1부터)
 */
export function nextStop(points = [], meters = 0) {
  const { acc, total } = pathTotals(points);
  const m = Math.max(0, Math.min(Number(meters) || 0, total));
  for (let i = 1; i < acc.length; i += 1) {
    if (m < acc[i] - 0.5) {
      return { index: i, remainM: acc[i] - m, remainTotalM: total - m, arrived: false };
    }
  }
  return { index: acc.length - 1, remainM: 0, remainTotalM: 0, arrived: true };
}

/** 남은 거리(m) → 예상 소요(분). 도심 배송 기본 25km/h + 정차당 시간. */
export function etaMin(remainM, { kmh = 25, stopsLeft = 0, stopMin = 0 } = {}) {
  const km = Math.max(0, Number(remainM) || 0) / 1000;
  const drive = kmh > 0 ? (km / kmh) * 60 : 0;
  return Math.round(drive + Math.max(0, stopsLeft) * Math.max(0, stopMin));
}

/**
 * ⭐순번 적용 여부 확인 — 지금 순번대로 간 거리 vs 추천 순서로 갔을 때.
 *   네비가 "이 길이 N분 빠릅니다" 하듯, 담당자에게 **바꿀 값어치가 있는지**만 알려준다.
 *   ⛔자동으로 순번을 바꾸지 않는다. 판단은 담당자가 한다.
 * @returns {{curKm, recKm, diffKm, betterPct, verdict:'same'|'rec'|'cur'}}
 */
export function routeAdvice(curPoints = [], recPoints = [], { minPct = 3 } = {}) {
  const cur = pathTotals(curPoints).total / 1000;
  const rec = pathTotals(recPoints).total / 1000;
  if (!cur || !rec) return { curKm: cur, recKm: rec, diffKm: 0, betterPct: 0, verdict: 'same' };
  const diff = cur - rec;
  const pct = Math.round((Math.abs(diff) / cur) * 1000) / 10;
  // 3% 미만 차이는 「같다」로 본다 — 직선거리 추정이라 그 이하는 의미가 없다.
  const verdict = pct < minPct ? 'same' : (diff > 0 ? 'rec' : 'cur');
  return {
    curKm: Math.round(cur * 100) / 100,
    recKm: Math.round(rec * 100) / 100,
    diffKm: Math.round(Math.abs(diff) * 100) / 100,
    betterPct: pct,
    verdict,
  };
}

/**
 * ⭐재생 속도 = **「전체를 몇 초에 완주」** (형 지적 2026-08-04 *"진짜 느려 시물레이션이라 해도 너무 느려"*).
 *   [왜 배속을 버렸나] 배속(25km/h × N)은 **경로가 길수록 하염없이 느려진다**.
 *     실측: 가평 한 바퀴 158.5km → 8배속(=200km/h)이면 **47분**. 시뮬레이션으로 쓸 수가 없다.
 *   완주 시간 기준이면 경로 길이와 상관없이 항상 같은 시간에 끝난다 — 동선을 훑는 게 목적이므로 이게 맞다.
 */
// 형 지시 2026-08-04 *"3D는 시간이 더 천천이 가야 다 보일거 같아.
//   가상주행은 1분에서 15분까지로 30초 단위로 설정 가능하게"*
//   ⭐3D 는 건물·지형 타일을 받아 그리느라 빨리 달리면 **화면이 못 따라온다**. 천천히 볼 수 있어야 한다.
export const DRIVE_DURATIONS = Array.from({ length: 29 }, (_, i) => 60 + i * 30); // 1분 … 15분, 30초 단위
export const DRIVE_DURATION_DEFAULT = 180;   // 3분 — 2D 는 넉넉하고 3D 도 타일이 따라온다
/** 전체 거리를 주어진 시간에 완주하는 속도(m/s) */
export const paceFor = (totalM, seconds) => {
  const t = Number(totalM) || 0;
  const s = Number(seconds) || 0;
  return t > 0 && s > 0 ? t / s : 0;
};
/** 완주 시간 라벨 */
export const fmtDuration = (sec) => (sec < 60 ? `${sec}초` : sec % 60 === 0 ? `${sec / 60}분` : `${Math.floor(sec / 60)}분${sec % 60}`);

/** (구) 배속 → 초당 진행 거리(m). base 25km/h ≈ 6.94m/s — 다른 화면 호환용으로 남겨 둔다. */
export const metersPerSec = (speed = 1, kmh = 25) => (Math.max(0, kmh) * 1000 / 3600) * Math.max(0.1, speed);

/**
 * 3D 카메라 — 실제 운전석에 가까운 값(형 지시 *"실제 운전중일 정도로 착각이 들도록"*).
 *   진행 방향 뒤쪽 위에서 따라간다. 커브를 틀면 그만큼 시선이 늦게 따라와야 자연스럽다.
 * @returns {{lng,lat,alt,heading,tilt}}
 */
export function chaseCamera(pos, { alt = 90, tilt = -18, lag = 0 } = {}) {
  if (!pos) return null;
  return {
    lng: pos.lng,
    lat: pos.lat,
    alt: Math.max(20, alt),
    heading: (pos.heading - lag + 360) % 360,
    tilt,                       // 살짝 내려다보기 = 운전석 시선
  };
}

/** 커브 각도에 따라 카메라가 부드럽게 따라오도록 heading 을 보간한다(급격한 회전 방지). */
export function smoothHeading(prev, next, factor = 0.18) {
  if (!Number.isFinite(prev)) return next;
  return (prev + angleDelta(prev, next) * Math.max(0, Math.min(1, factor)) + 360) % 360;
}

/**
 * ⭐주행을 돌고 난 뒤 「무엇이 문제였나 · 왜 그런가」 (형 지시 2026-08-04
 *   *"돌고나서 문제랑 추천 경로를 보여주고 학습주행 기능을 보여줘서 왜 그런지를 알게 해줘"*).
 *
 * ⛔**여기서 순번을 바꾸지 않는다.** 형 원칙 — *"항상 묻고 담당자가 선택할 수 있어야 해
 *   너의 일방적인 판단 하면 안돼"*. 이 함수는 **보여줄 근거만** 만든다.
 *
 * 세 가지를 본다(전부 「왜」를 함께 낸다):
 *   detour  멀리 튀는 구간 — 평균의 2배를 넘는 이동. 다른 자리에 넣으면 줄어드는지 함께 계산
 *   back    되돌아가기    — 왔던 방향으로 되꺾임(각도 120° 초과). 같은 길을 두 번 지난다
 *   zigzag  갈지자        — 좌우로 번갈아 크게 꺾이는 연속 구간
 *
 * @param {{lat,lng}[]} points 출발지 + 정차점들(+복귀)
 * @param {object[]} stops 정차점 정보(이름·주소) — points 는 앞에 출발지가 있어 한 칸 밀린다
 * @returns {{issues:object[], totalKm:number, avgLegKm:number}}
 */
export function routeIssues(points = [], stops = [], { detourFactor = 2, backDeg = 120, minKm = 0.3 } = {}) {
  const pts = (points || []).filter((p) => p && p.lat != null && p.lng != null);
  if (pts.length < 3) return { issues: [], totalKm: 0, avgLegKm: 0 };
  const { segs, total } = pathTotals(pts);
  // ⭐기준은 **중앙값**이다 — 평균을 쓰면 멀리 튀는 구간이 스스로 평균을 끌어올려 못 잡는다
  //   (실측: 178m·5157m·4979m 는 평균 3438m 라 5157m 가 「평균의 2배」에 못 미쳐 빠졌다).
  const sorted = [...segs].sort((a, b) => a - b);
  const avg = sorted.length
    ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : 0;
  const nameAt = (legIdx) => {
    const s = stops[legIdx - 1];               // points[0] = 출발지
    return s ? (s.name || `${legIdx}번째`) : (legIdx === 0 ? '출발지' : `${legIdx}번째`);
  };
  const issues = [];

  segs.forEach((m, i) => {
    const km = m / 1000;
    // ① 멀리 튀는 구간 — 평균의 N배 초과 + 최소 거리 이상(짧은 구간에서 배수는 의미가 없다)
    if (avg > 0 && m > avg * detourFactor && km >= minKm) {
      issues.push({
        type: 'detour',
        legIndex: i,
        km: Math.round(km * 100) / 100,
        from: nameAt(i), to: nameAt(i + 1),
        why: `이 구간만 ${km.toFixed(1)}km 로 보통(${(avg / 1000).toFixed(1)}km)의 ${(m / avg).toFixed(1)}배입니다. 멀리 갔다가 돌아오는 자리일 수 있습니다.`,
      });
    }
    // ② 되돌아가기 — 직전 진행 방향과 크게 반대로 꺾인다
    if (i > 0) {
      const a = bearing(pts[i - 1], pts[i]);
      const b = bearing(pts[i], pts[i + 1]);
      const turn = Math.abs(angleDelta(a, b));
      if (turn > backDeg && km >= minKm) {
        issues.push({
          type: 'back',
          legIndex: i,
          km: Math.round(km * 100) / 100,
          from: nameAt(i), to: nameAt(i + 1),
          turn: Math.round(turn),
          why: `${nameAt(i)} 에서 ${Math.round(turn)}° 로 되꺾입니다. 왔던 길을 되짚는 모양이라 같은 도로를 두 번 지나게 됩니다.`,
        });
      }
    }
  });

  // ③ 갈지자 — 좌우로 번갈아 크게 꺾이는 구간이 3연속 이상
  for (let i = 1; i + 2 < pts.length - 1; i += 1) {
    const t1 = angleDelta(bearing(pts[i - 1], pts[i]), bearing(pts[i], pts[i + 1]));
    const t2 = angleDelta(bearing(pts[i], pts[i + 1]), bearing(pts[i + 1], pts[i + 2]));
    if (Math.abs(t1) > 60 && Math.abs(t2) > 60 && Math.sign(t1) !== Math.sign(t2)) {
      issues.push({
        type: 'zigzag',
        legIndex: i,
        km: Math.round(((segs[i] || 0) + (segs[i + 1] || 0)) / 10) / 100,
        from: nameAt(i), to: nameAt(i + 2),
        why: `${nameAt(i)} 부근에서 좌우로 번갈아 크게 꺾입니다(${Math.round(Math.abs(t1))}° → ${Math.round(Math.abs(t2))}°). 한쪽을 먼저 훑고 넘어가면 줄어듭니다.`,
      });
      i += 1; // 겹쳐 잡지 않는다
    }
  }

  // 큰 것부터 — 담당자가 위에서부터 보면 된다
  issues.sort((a, b) => b.km - a.km);
  return {
    issues,
    totalKm: Math.round((total / 1000) * 100) / 100,
    avgLegKm: Math.round((avg / 1000) * 100) / 100,
  };
}

/**
 * ⭐**같은 집은 한 번만 선다** — 형 지적 2026-08-04
 *   *"같은 아파트에 10 11 12가 있으면 10번 한바퀴 11번 한바퀴 12번 한바퀴 식으로 돌아"*
 *   [왜 그랬나] 경로를 **대상자 단위**로 만들어서, 같은 아파트 3명이면 같은 좌표를 경유지로 3번 줬다.
 *   길찾기는 시키는 대로 「들어갔다 나왔다」를 3번 그린다 — 그게 빙글빙글 도는 정체다.
 *   [고침] 붙어 있는 같은 좌표를 **한 정차점**으로 접는다. 형의 절대규칙(같은 주소=1가구)과 같은 축이다.
 *   ⛔순번이 떨어져 있으면 접지 않는다 — 실제로 따로 가는 자리다.
 * @returns 접힌 정차점 [{lat,lng,seqFrom,seqTo,seqLabel,who,count,name,members}]
 */
export function mergeStops(stops = []) {
  const key = (s) => `${Number(s?.lat).toFixed(6)},${Number(s?.lng).toFixed(6)}`;
  const out = [];
  (stops || []).forEach((s) => {
    if (!s || s.lat == null || s.lng == null) return;
    const last = out[out.length - 1];
    if (last && last._k === key(s)) { last.members.push(s); return; }
    out.push({ ...s, _k: key(s), members: [s] });
  });
  return out.map((g) => {
    const seqs = g.members.map((m) => Number(m.seq)).filter(Number.isFinite);
    const seqFrom = seqs.length ? Math.min(...seqs) : null;
    const seqTo = seqs.length ? Math.max(...seqs) : null;
    const seqLabel = seqFrom == null ? '' : seqFrom === seqTo ? `${seqFrom}번` : `${seqFrom}~${seqTo}번`;
    const first = g.members[0]?.name || '대상자';
    const who = g.members.length > 1 ? `${first} 외 ${g.members.length - 1}` : first;
    return {
      ...g, _k: undefined, seqFrom, seqTo, seqLabel, who,
      count: g.members.length,
      name: seqLabel ? `${seqLabel} ${who}` : who,   // 안내문에 그대로 쓰이는 이름
    };
  });
}

/**
 * ⭐실도로 경로 위에서 **각 정차점이 몇 m 지점인지** 찾는다.
 *   [왜 필요한가] 형 지적 2026-08-04 *"1231번째가 먼지 내가 어떻게 알아?"* —
 *   실도로 경로는 도로 좌표가 수천 개다. 그 번호로 안내하면 사람이 못 알아본다.
 *   주행은 실도로로 하되 **안내·분석은 정차점(대상자) 기준**이어야 한다. 그 둘을 잇는 다리다.
 * @returns {{meters:number, stop:object, no:number}[]} 정차 순서대로
 */
export function snapStopsToPath(path = [], stops = []) {
  const pts = (path || []).filter((p) => p && p.lat != null && p.lng != null);
  const ss = (stops || []).filter((s) => s && s.lat != null && s.lng != null);
  if (pts.length < 2 || !ss.length) return [];
  const { acc } = pathTotals(pts);
  let from = 0;                       // 순서대로 진행 — 뒤로 되돌아가 붙지 않게 한다
  return ss.map((s, i) => {
    let best = from; let bestD = Infinity;
    for (let j = from; j < pts.length; j += 1) {
      const d = haversine(pts[j], s);
      if (d < bestD) { bestD = d; best = j; }
    }
    from = best;                      // 다음 정차는 이 지점 이후에서 찾는다
    return { meters: acc[best] || 0, stop: s, no: i + 1 };
  });
}

/** m → 사람이 읽는 거리 */
export function fmtDist(m) {
  const v = Math.max(0, Number(m) || 0);
  return v < 1000 ? `${Math.round(v)}m` : `${(v / 1000).toFixed(1)}km`;
}

/**
 * ⭐커브에서 차가 **기우는 각도**(뱅크). 형 지시 2026-08-04
 *   *"3D 지도에서 역동적으로 이동하면서 실제 움직이는것처럼 표현해줘"*
 *   사람이 「달리고 있다」고 느끼는 건 위치보다 **몸이 기우는 것**이다. 회전이 빠를수록 더 눕는다.
 *   ⛔너무 크면 멀미가 난다 → 기본 12도로 묶는다.
 */
export function bankAngle(prevHeading, heading, k = 0.9, max = 12) {
  if (prevHeading == null || !Number.isFinite(Number(prevHeading))) return 0;
  const d = angleDelta(Number(prevHeading), Number(heading));   // 오른쪽 +, 왼쪽 −
  const v = d * k;
  return Math.max(-max, Math.min(max, Math.round(v * 10) / 10));
}

/**
 * 주행 카메라 — 속도(=회전량)에 따라 시야를 살짝 바꾼다.
 *   직선에서는 멀리 보고(고도↑·많이 눕힘), 커브에서는 가까이 본다(고도↓) — 실제 운전 시선과 같다.
 */
export function driveView(turn = 0, { alt = 90, tilt = -18 } = {}) {
  const t = Math.min(1, Math.abs(Number(turn) || 0) / 25);      // 0=직진 … 1=급커브
  return {
    alt: Math.round(alt - t * 22),        // 커브에선 낮게 붙는다
    tilt: Math.round((tilt + t * 7) * 10) / 10,  // 커브에선 조금 더 내려다본다
  };
}

// ── 주행 시점 (형 지시 2026-08-04) ────────────────────────────────────────────
//   *"앞으로 가는 차 창문 시점으로 이동을 해주고 내가 마우스로 시점을 돌릴수도 있게 해주고
//     앞을 보는 시점 표시도 같이 해줘. 어느 방향 시점인지 시점 표시 기능도"*
//   ⛔담당자가 고른다 — 우리가 하나로 정하지 않는다.
export const DRIVE_VIEWS = [
  { id: 'driver', label: '운전석', hint: '차 창문에서 보는 눈높이', alt: 2.2, tilt: -2 },
  { id: 'chase', label: '뒤따라', hint: '차 뒤 위에서 따라간다', alt: 90, tilt: -18 },
  { id: 'sky', label: '위에서', hint: '동네 전체가 보인다', alt: 420, tilt: -58 },
];
export const DRIVE_VIEW_DEFAULT = 'driver';
export function viewPreset(id) {
  return DRIVE_VIEWS.find((v) => v.id === id) || DRIVE_VIEWS[0];
}

/**
 * 마우스로 둘러본 양. 좌우는 끝없이 돌고, 위아래는 목이 꺾이지 않게 묶는다.
 * @returns {{yaw:number, pitch:number}} yaw = 정면 기준 좌우(도), pitch = 위아래(도)
 */
export function lookOffset(prev = { yaw: 0, pitch: 0 }, dx = 0, dy = 0, { sens = 0.22, maxPitch = 35 } = {}) {
  const yaw = ((((prev?.yaw || 0) + dx * sens) % 360) + 360) % 360;
  const pitch = Math.max(-maxPitch, Math.min(maxPitch, (prev?.pitch || 0) + dy * sens * 0.8));
  return { yaw: Math.round(yaw * 10) / 10, pitch: Math.round(pitch * 10) / 10 };
}

/** 손을 떼면 **서서히 정면으로** 돌아온다(운전 중 고개를 돌렸다 되돌리는 것과 같다). */
export function decayLook(off = { yaw: 0, pitch: 0 }, k = 0.08) {
  const y = angleDelta(0, off?.yaw || 0);          // -180..180 로 펴서 최단 방향으로 복귀
  const ny = y * (1 - Math.max(0, Math.min(1, k)));
  const np = (off?.pitch || 0) * (1 - Math.max(0, Math.min(1, k)));
  const near = Math.abs(ny) < 0.3 && Math.abs(np) < 0.3;
  return near ? { yaw: 0, pitch: 0 } : { yaw: ((ny % 360) + 360) % 360, pitch: Math.round(np * 10) / 10 };
}

const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
/** 방위각 → 사람 말('북','남서'…). 「어느 방향을 보고 있나」를 글자로도 알려준다. */
export function dirName(deg) {
  const d = ((Number(deg) || 0) % 360 + 360) % 360;
  return DIRS[Math.round(d / 45) % 8];
}

/**
 * ⭐**3D 화면에 대상자 핀을 얹기 위한 투영** — 형 지적 2026-08-04
 *   *"좌표 마크랑 대상자가 없으니까 그냥 드라이브만 하는 느낌이야"*
 *   [왜 직접 계산하나] V월드는 Cesium 을 감춰 둬서 지도에 점을 찍는 API 를 쓸 수 없다.
 *   그런데 **카메라 위치·방향은 우리가 정한 값**이라, 대상자가 화면 어디쯤 보일지는 우리가 셀 수 있다.
 *   ⛔정밀 투영이 아니라 **눈대중 위치**다 — 「저쪽에 3번 집이 있다」를 알려 주는 용도.
 *
 * @param {{lat,lng,heading,tilt}} cam 카메라(우리가 방금 설정한 값)
 * @param {{lat,lng}} t 대상 좌표
 * @param {{w,h,fov}} vp 화면 크기와 가로 화각(도)
 * @returns {{x,y,dist,ahead,off}|null} x,y = 화면 좌표(px) · ahead = 앞쪽인가 · off = 좌우 각도
 */
export function projectToScreen(cam, t, { w = 1000, h = 700, fov = 70 } = {}) {
  if (!cam || !t || cam.lat == null || t.lat == null) return null;
  const dist = haversine(cam, t);
  const brg = bearing(cam, t);
  const off = angleDelta(Number(cam.heading) || 0, brg);   // −180(왼) … +180(오)
  const half = Math.max(10, fov) / 2;
  const ahead = Math.abs(off) <= half;
  const x = w / 2 + (off / half) * (w / 2);
  // 고도차가 없다고 보고, 거리에 따라 지평선 쪽으로 붙인다(멀수록 위).
  const tiltDeg = Number(cam.tilt) || 0;                    // 보통 음수(내려다봄)
  const horizon = h * (0.5 + tiltDeg / 90);                 // 시선이 아래일수록 지평선이 위로
  const near = Math.max(0, Math.min(1, 1 - Math.min(dist, 1200) / 1200));
  const y = horizon + (h - horizon) * near * 0.72;
  return {
    x: Math.round(x), y: Math.round(Math.max(0, Math.min(h, y))),
    dist: Math.round(dist), ahead, off: Math.round(off),
  };
}

/**
 * 카메라 고도를 **완만하게** 만든다 — 형 지적 *"터널로 안가고 산위를 넘는게 맞는건가?"*
 *   [사실] 우리가 받는 경로에는 **터널·고가 정보가 없다**. 지형 높이를 그대로 따르면
 *   터널 구간에서 **산을 타넘는다**(실제 차는 산을 통과한다).
 *   ⇒ 지형 높이를 그대로 쓰지 않고 **직전 값과 섞어** 급한 오르내림을 눌러 준다.
 *      완전한 해결은 아니지만(도로 고도 자료가 있어야 한다) 산을 넘는 출렁임이 크게 준다.
 */
export function smoothAltitude(prev, target, k = 0.12, maxStep = 25) {
  const t = Number(target) || 0;
  if (!Number.isFinite(prev)) return t;
  const d = t - prev;
  const step = Math.max(-maxStep, Math.min(maxStep, d * Math.max(0, Math.min(1, k))));
  return Math.round((prev + step) * 10) / 10;
}
