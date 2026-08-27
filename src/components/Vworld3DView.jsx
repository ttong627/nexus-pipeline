import { useEffect, useRef, useState } from 'react';
import { useVworldSdk, hasVworldKey } from '../utils/useVworldSdk.js';
import {
  chaseCamera, smoothHeading, bankAngle, driveView, angleDelta,
  DRIVE_VIEWS, DRIVE_VIEW_DEFAULT, viewPreset, lookOffset, decayLook,
  projectToScreen, smoothAltitude,
} from '../utils/driveSim.js';
import DriveCompass from './DriveCompass.jsx';

const DEG = Math.PI / 180;   // ⛔전역 Cesium 이 없어 Cesium.Math.toRadians 를 쓸 수 없다

// V월드 3D 지도 — 「3D」 모드 전용(형 지시 2026-08-04 *"v월드랑 카카오맵이랑 번갈아 쓰면 안돼?"*).
//   ⭐역할 분담: **2D·야간·위성·거리뷰 = 카카오**(핀·경로·순번 편집이 전부 거기 있다)
//                **3D 조망 = V월드**(건물 입체 · 카카오는 지도 기울기를 지원하지 않는다)
//   ⛔순번 편집은 여기서 하지 않는다 — 3D 는 「어느 동인지·어디로 들어가는지」를 눈으로 보는 용도다.
//     WebGL 이라 무겁고, 편집까지 얹으면 느려진다(형에게 이 경계를 명시해 둔다).
//
//   목표 지점: focus(선택된 가구) → 없으면 첫 가구. 카메라는 비스듬히 내려다본다(tilt -35°).
/**
 * 🔴**3D 지도가 안 움직이던 마지막 원인 = `window.Cesium` 이 없다.**
 *   V월드는 Cesium 을 자기 안에 감춰 두고 전역으로 내놓지 않는다(형 화면: 지도는 잘 보이는데
 *   카메라만 우리 값과 무관한 404m 에 머물렀다 = 우리 명령이 한 번도 안 먹었다는 뜻).
 *   ⭐**전역을 찾지 말고 카메라에서 거꾸로 캔다** — `camera.position` 이 곧 Cartesian3 인스턴스라
 *     `.constructor` 가 Cartesian3 이고, 거기 `fromDegrees` 가 붙어 있다. 각도 변환은 우리가 한다.
 */
function cesiumFromCamera(camera, scene) {
  try {
    const Cartesian3 = camera?.position?.constructor;
    if (!Cartesian3?.fromDegrees) return null;
    const carto = scene?.globe?.ellipsoid?.cartesianToCartographic?.(camera.position);
    return { Cartesian3, Cartographic: carto?.constructor || null };
  } catch { return null; }
}

/** 지도 인스턴스 속을 훑어 **카메라를 가진 뷰어**를 찾는다(V월드가 어디에 숨겨 뒀는지 모른다). */
function findViewer(root) {
  const seen = new Set();
  const scan = (o, d) => {
    if (!o || typeof o !== 'object' || d > 3 || seen.has(o)) return null;
    seen.add(o);
    if (o.camera?.setView && o.scene?.globe) return { camera: o.camera, scene: o.scene };
    if (o.scene?.camera?.setView) return { camera: o.scene.camera, scene: o.scene };
    for (const k of Object.keys(o)) {
      if (k.startsWith('_ref') || k === 'parent') continue;
      try { const r = scan(o[k], d + 1); if (r) return r; } catch { /* getter 예외 무시 */ }
    }
    return null;
  };
  return scan(root, 0)
    || scan(window.vw?.MapControllerSingleton?.getViewer?.(), 0)
    || scan(window.vw, 0)
    || scan(window.viewer, 0);
}

/** 그 좌표의 **지형 높이(m)** — 못 구하면 0(해수면). Cesium 고도는 해수면 기준이라 이걸 더해야 한다. */
function groundHeight(C, scene, lng, lat) {
  try {
    if (!C?.Cartographic?.fromDegrees || !scene?.globe?.getHeight) return 0;
    const h = scene.globe.getHeight(C.Cartographic.fromDegrees(lng, lat));
    return Number.isFinite(h) ? h : 0;
  } catch { return 0; }
}

export default function Vworld3DView({ target = null, active = false, onExit = null, drive = null, stops = [] }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const [err, setErr] = useState('');
  const { ready, failed, reason } = useVworldSdk(active);
  const headRef = useRef(null);
  // 한 번이라도 켜졌는가 — 켜진 뒤로는 DOM 을 유지한다(위 주석의 검은 화면 방지).
  const [mounted, setMounted] = useState(active);
  useEffect(() => { if (active) setMounted(true); }, [active]);
  useEffect(() => {
    if (!active || !boxRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const el = boxRef.current;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth || 1200, h: el.clientHeight || 700 }));
    ro.observe(el);
    setBox({ w: el.clientWidth || 1200, h: el.clientHeight || 700 });
    return () => ro.disconnect();
  }, [active, mounted]);
  useEffect(() => { if (!drive) { headRef.current = null; bankRef.current = 0; altRef.current = null; setCamNow(null); } }, [drive]);

  // ── 가상 주행 — 카메라가 차를 따라간다 (형 지시 *"실제 운전중일 정도로 착각이 들도록"*) ──
  //
  // 🔴**3D 에서만 안 움직이고, 멈추면 그 자리로 순간이동**하던 원인(형 지적 2026-08-04
  //   *"2D에서는 움직이는데 3D에서는 안움직이고 멈추면 이동 좌표로 옮겨지네"*)
  //   → `moveTo()` 는 **날아가는 애니메이션**이다. 초당 60번 부르면 **매번 직전 비행을 취소**하고
  //     새로 시작해서 결국 제자리다. 재생을 멈추면 마지막 한 번만 끝까지 날아가 **점프**로 보인다.
  //   ⇒ 매 프레임에는 **즉시 이동**(Cesium `camera.setView`)을 쓴다. 애니메이션이 없으니 겹칠 것도 없다.
  //     V월드 3D 는 Cesium 위에 얹은 것이라 카메라를 직접 잡을 수 있다.
  //     ⚠️경로를 못 찾으면 `moveTo` 로 물러난다 — 뚝뚝 끊겨도 안 움직이는 것보다 낫다.
  const camRef = useRef(null);      // Cesium camera (한 번 찾으면 재사용)
  const sceneRef = useRef(null);    // Cesium scene — 지형 표고를 물어보는 곳
  const bankRef = useRef(0);
  const cesRef = useRef(null);      // 카메라에서 거꾸로 캔 Cesium 생성자들
  const altRef = useRef(null);      // 완만하게 만든 카메라 고도(산을 타넘는 출렁임 방지)
  const [camNow, setCamNow] = useState(null);   // 지금 카메라 — 3D 위에 핀을 얹는 데 쓴다

  // ★주행 중이 아니어도 3D 위에 대상자 핀을 띄운다(형 지시 2026-08-27 "좌표는 3D로 표시").
  //   예전엔 `drive` 가 있을 때만 카메라 값을 만들어서, 그냥 3D 로 둘러볼 땐 핀이 하나도 없었다.
  //   여기서는 **실제 Cesium 카메라**를 읽는다 — 담당자가 돌려 본 각도 그대로여야 핀이 제자리에 얹힌다.
  //   (라디안 → 도. tilt 는 내려다볼 때 음수 — projectToScreen 이 그 규격을 쓴다)
  useEffect(() => {
    if (!active || drive) return undefined;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      try {
        if (!camRef.current) camRef.current = findViewer(mapRef.current)?.camera || null;
        const cam = camRef.current;
        const pos = cam?.positionCartographic;
        if (pos && Number.isFinite(pos.latitude)) {
          const deg = 180 / Math.PI;
          setCamNow({
            lat: pos.latitude * deg,
            lng: pos.longitude * deg,
            heading: ((cam.heading || 0) * deg + 360) % 360,
            tilt: (cam.pitch || 0) * deg,
          });
        }
      } catch { /* 뷰어 준비 전 — 다음 차례에 다시 본다 */ }
    };
    tick();
    const t = setInterval(tick, 200);   // 매 프레임은 과하다 — 눈으로는 차이가 없다
    return () => { alive = false; clearInterval(t); };
  }, [active, drive, ready]);   // eslint-disable-line react-hooks/exhaustive-deps -- 카메라 참조는 ref 라 의존성이 아니다
  const [box, setBox] = useState({ w: 1200, h: 700 });   // 화면 크기(투영에 필요)
  // 다음에 갈 집 — 지금 카메라 **앞쪽**에서 가장 가까운 정차점(형 지시 *"어디로 가는지"*)
  const next = (() => {
    if (!drive || !camNow || !stops.length) return null;
    const cand = stops
      .map((st2) => ({ st2, p: projectToScreen(camNow, st2, { w: box.w, h: box.h, fov: 120 }) }))
      .filter((x) => x.p?.ahead)
      .sort((a, b) => a.p.dist - b.p.dist);
    return cand[0]?.st2 || null;
  })();
  const [camOk, setCamOk] = useState(null);   // 카메라를 잡았나 — 화면에 알려 준다
  // ⭐시점은 **담당자가 고른다**(형 원칙 — 일방적으로 정하지 않는다). 기본은 운전석 창문.
  const [viewId, setViewId] = useState(DRIVE_VIEW_DEFAULT);
  // 마우스로 둘러본 양. 끌면 돌아가고, 놓으면 서서히 정면으로 돌아온다.
  const [look, setLook] = useState({ yaw: 0, pitch: 0 });
  const lookRef = useRef({ yaw: 0, pitch: 0 });
  lookRef.current = look;
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [headNow, setHeadNow] = useState(0);   // 화면에 표시할 진행 방향
  // 손을 떼면 **서서히 정면으로** — 운전 중 고개를 돌렸다 되돌리는 것과 같다.
  //   ⛔이 effect 는 반드시 look·dragging **선언 뒤**에 온다(위로 올리면 TDZ 로 화면 전체가 죽는다).
  useEffect(() => {
    if (dragging || (!look.yaw && !look.pitch)) return undefined;
    const t = setInterval(() => setLook((v) => decayLook(v, 0.12)), 40);
    return () => clearInterval(t);
  }, [dragging, look.yaw, look.pitch]);

  useEffect(() => {
    if (!active || !ready || !drive?.lat || !mapRef.current) return;
    const vw = window.vw;
    if (!vw) return;
    try {
      const prev = headRef.current;
      const h = smoothHeading(prev, drive.heading ?? 0, 0.22);
      headRef.current = h;
      // 커브에서 몸이 기울고, 시야도 낮아진다 — 「달리고 있다」는 느낌은 여기서 나온다.
      const turn = prev == null ? 0 : angleDelta(prev, h);
      const bank = smoothHeading(0, 0, 0) === 0 ? bankAngle(prev, h) : 0;   // 순수함수 그대로
      bankRef.current = bankRef.current + (bank - bankRef.current) * 0.25;  // 기울기도 부드럽게
      // 시점(운전석/뒤따라/위에서) + 커브 보정 + 마우스로 둘러본 각도.
      const pre = viewPreset(viewId);
      const view = driveView(viewId === 'driver' ? turn * 0.4 : turn, { alt: pre.alt, tilt: pre.tilt });
      const lk = lookRef.current || { yaw: 0, pitch: 0 };
      const cam = chaseCamera({ ...drive, heading: (h + lk.yaw + 360) % 360 }, {
        alt: view.alt,
        tilt: Math.max(-80, Math.min(20, view.tilt - lk.pitch)),
      });
      setHeadNow(h);
      setCamNow({ lat: cam.lat, lng: cam.lng, heading: cam.heading, tilt: cam.tilt });
      let destinationAlt = cam.alt;

      // ① 즉시 이동 — Cesium 카메라를 직접 잡는다(이게 정답. ⛔전역 Cesium 은 없다)
      if (!camRef.current) {
        const found = findViewer(mapRef.current);
        camRef.current = found?.camera || null;
        sceneRef.current = found?.scene || null;
        cesRef.current = found ? cesiumFromCamera(found.camera, found.scene) : null;
        setCamOk(!!(cesRef.current?.Cartesian3?.fromDegrees && camRef.current?.setView));
      }
      const C = cesRef.current;
      if (C?.Cartesian3?.fromDegrees && camRef.current?.setView) {
        // 🔴Cesium 고도는 **해수면 기준**이다. 그대로 90m 를 주면 표고 200m 인 산지에서
        //   카메라가 **땅속**으로 들어간다(형 화면: 지면에 처박혀 초록 덩어리만 보였다).
        //   ⇒ 그 자리 지형 높이를 물어 **그 위로** 올린다.
        const ground = groundHeight(C, sceneRef.current, cam.lng, cam.lat);
        // 🔴형 지적 *"터널로 안가고 산위를 넘는게 맞는건가?"* — 경로에 **터널·고가 정보가 없다**.
        //   지형을 그대로 따르면 터널 구간에서 산을 타넘는다 → 고도를 완만하게 눌러 출렁임을 줄인다.
        altRef.current = smoothAltitude(altRef.current, ground + cam.alt, 0.12, 25);
        destinationAlt = altRef.current;
        camRef.current.setView({
          destination: C.Cartesian3.fromDegrees(cam.lng, cam.lat, destinationAlt),
          orientation: {
            heading: cam.heading * DEG,
            pitch: cam.tilt * DEG,
            roll: bankRef.current * DEG,
          },
        });
        return;
      }
      // ② 폴백 — V월드 API(끊기지만 안 움직이는 것보다 낫다)
      const pos = new vw.CameraPosition(
        new vw.CoordZ(cam.lng, cam.lat, cam.alt),
        new vw.Direction(cam.heading, cam.tilt, bankRef.current),
      );
      if (typeof mapRef.current.setCameraPosition === 'function') mapRef.current.setCameraPosition(pos);
      else if (typeof mapRef.current.moveTo === 'function') mapRef.current.moveTo(pos);
    } catch { /* 카메라 이동 실패는 무시 — 주행은 계속된다 */ }
  }, [active, ready, drive]);   // eslint-disable-line react-hooks/exhaustive-deps -- 의도적 생략 — 넣으면 불필요하게 다시 실행된다

  // 지도 생성 + 대상 좌표로 이동.
  //   🔴**생성과 이동을 분리한다** — 예전엔 `drive` 가 있으면 통째로 return 해서
  //     「주행을 켠 채 3D 로 들어가면 지도가 영영 안 만들어지는」 버그가 있었다(형 지적
  //     *"화면에 변화가 없는데"* — 주행중+3D 상태였다). 생성은 항상, 이동만 주행이 가져간다.
  useEffect(() => {
    if (!active || !ready) return;
    const vw = window.vw;
    const el = boxRef.current;
    if (!vw || !el) return;
    const lng = Number(target?.lng); const lat = Number(target?.lat);
    const ok = Number.isFinite(lng) && Number.isFinite(lat);
    try {
      // 눈높이 약 350m 에서 35도 내려다보기 — 아파트 단지 동 배치가 가장 잘 보이는 각도.
      //   좌표가 없으면 수도권 중심으로라도 띄운다(빈 화면보다 낫다).
      const pos = new vw.CameraPosition(
        new vw.CoordZ(ok ? lng : 127.03, ok ? lat : 37.4, 350),
        new vw.Direction(0, -35, 0),
      );
      if (!mapRef.current) {
        const m = new vw.Map();
        // ⛔`navigation` 도구모음(나침반·확대·거리·면적…)은 **오른쪽에 붙어 순번 리스트를 가린다**
        //   (형 지적 2026-08-04 *"3D맵 메뉴와 지도 표시를 정리"*). 여긴 조망 화면이라 필요 없다.
        if (typeof m.setOption === 'function') m.setOption({ mapId: el.id, initPosition: pos, logo: true, navigation: false });
        if (typeof m.start === 'function') m.start();
        mapRef.current = m;
        // 형 지적 *"지도가 너무 늦게 나와서 파란 들판을 달리는 느낌"* — 타일이 카메라를 못 따라온다.
        //   ⇒ 정밀도를 조금 낮추고 캐시를 키워 **빨리 오게** 한다(멀리 있는 건물은 어차피 흐릿하다).
        setTimeout(() => {
          try {
            const g = findViewer(mapRef.current)?.scene?.globe;
            if (g) {
              g.maximumScreenSpaceError = Math.max(g.maximumScreenSpaceError || 2, 6);
              g.tileCacheSize = Math.max(g.tileCacheSize || 100, 600);
              g.preloadSiblings = true;
            }
          } catch { /* 성능 조정 실패는 무시 — 화면은 그대로 뜬다 */ }
        }, 1200);
      } else if (!drive && ok && typeof mapRef.current.moveTo === 'function') {
        mapRef.current.moveTo(pos);   // 주행 중엔 카메라를 주행이 잡는다
      }
      setErr('');
    } catch (e) {
      setErr(`3D 지도를 여는 중 문제가 생겼습니다: ${e?.message || e}`);
    }
  }, [active, ready, target?.lat, target?.lng, drive]);

  // 🔴**나갔다 들어오면 검은 화면**이던 원인(형 지적 2026-08-04)
  //   예전엔 `active=false` 에 `return null` 로 **DOM 을 통째로 버렸다**. 그런데 지도 인스턴스(mapRef)는
  //   컴포넌트가 살아 있어 그대로 남는다 → 다시 켜면 「이미 있다」고 판단해 새로 만들지 않는데,
  //   Cesium 화면(canvas)은 **사라진 옛 DOM 에 붙어 있었다** → 새 상자는 텅 빈 검은 칸.
  //   ⇒ 한 번 켠 뒤로는 **DOM 을 유지**하고 보이기만 끈다. 재진입도 즉시다(다시 만들 필요가 없다).
  //   ⛔3D 를 한 번도 안 켰으면 아예 만들지 않는다 — 안 쓰는 사람에게 WebGL 을 띄우지 않는다.
  if (!mounted) return null;

  // 실패 원인을 갈라서 알려준다 — 「무엇을 고쳐야 하는지」가 달라진다.
  const notice = !hasVworldKey()
    ? 'V월드 인증키가 설정되지 않았습니다 (VITE_VWORLD_KEY).'
    : failed
      ? (reason === 'net'
        ? '3D 지도 파일을 받지 못했습니다 — 네트워크가 막혔거나 V월드 서버에 닿지 않습니다.'
        : `3D 지도가 열리지 않습니다 — 인증키에 등록한 도메인과 지금 주소(${typeof window !== 'undefined' ? window.location.hostname : ''})가 다를 가능성이 큽니다.`)
      : err || (!ready ? '3D 지도를 불러오는 중…' : '');

  return (
    <div className={`absolute inset-0 rounded-xl overflow-hidden ${active ? '' : 'invisible pointer-events-none'}`}
      style={{ background: '#1b1712' }}>
      {/* ⭐마우스로 둘러보기 — 형 지시 *"내가 마우스로 시점을 돌릴수도 있게"*.
          주행 중에만 가로챈다(가만히 볼 때는 V월드 기본 조작을 그대로 쓴다). 놓으면 정면으로 돌아온다. */}
      <div
        id="vworld3d-box" ref={boxRef} className="w-full h-full"
        style={drive ? { cursor: dragging ? 'grabbing' : 'grab' } : undefined}
        onPointerDown={drive ? (e) => {
          dragRef.current = { x: e.clientX, y: e.clientY };
          setDragging(true);
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } : undefined}
        onPointerMove={drive && dragging ? (e) => {
          const d = dragRef.current;
          if (!d) return;
          setLook((v) => lookOffset(v, e.clientX - d.x, e.clientY - d.y));
          dragRef.current = { x: e.clientX, y: e.clientY };
        } : undefined}
        onPointerUp={drive ? () => { dragRef.current = null; setDragging(false); } : undefined}
        onPointerCancel={drive ? () => { dragRef.current = null; setDragging(false); } : undefined}
      />
      {notice && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="px-4 py-3 rounded-xl bg-slate-900/90 text-white text-xs font-bold shadow-2xl max-w-sm text-center leading-relaxed pointer-events-auto">
            {notice}
            {(failed || !hasVworldKey()) && onExit && (
              <button onClick={onExit} className="block mx-auto mt-2 px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 font-black">
                2D 지도로 돌아가기
              </button>
            )}
          </div>
        </div>
      )}
      {/* ⭐3D 위에 **대상자 핀** — 형 지적 2026-08-04
          *"좌표 마크랑 대상자가 없으니까 그냥 드라이브만 하는 느낌이야"*
          V월드는 지도에 점을 찍는 API 를 감춰 뒀다. 하지만 **카메라는 우리가 정한 값**이라
          「저쪽에 3번 집이 있다」는 우리가 셀 수 있다(utils/driveSim.projectToScreen).
          ⛔정밀 투영이 아니라 **눈대중**이다 — 방향과 거리를 알려 주는 용도. 가까운 8곳만.
          ⚠️뒤에 있는 집은 그리지 않는다(화면 밖인데 그리면 거짓말이 된다). */}
      {camNow && !notice && (
        <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">
          {stops
            .map((st2) => ({ st2, p: projectToScreen(camNow, st2, { w: box.w, h: box.h, fov: 74 }) }))
            // 둘러볼 땐 넓게·많이, 주행 중엔 가까운 것만(앞이 복잡하면 오히려 안 보인다)
            .filter((x) => x.p?.ahead && x.p.dist < (drive ? 900 : 4000))
            .sort((a, b) => b.p.dist - a.p.dist)
            .slice(drive ? -10 : -60)
            .map(({ st2, p }) => {
              const near = p.dist < 120;
              return (
                <div key={st2.idx ?? `${st2.lat},${st2.lng}`}
                  className="absolute -translate-x-1/2 -translate-y-full transition-opacity duration-200"
                  style={{ left: p.x, top: p.y, opacity: Math.max(0.45, 1 - p.dist / 1100) }}>
                  {/* ★작게, 대신 잘 보이게(형 지시 2026-08-27) — 순번 동그라미가 본체다.
                      거리(m)는 뺐다: 핀이 커지는 주범인데 3D 에서 굳이 읽지 않는다.
                      이름은 가까울 때만 아주 작게 — 멀리 있는 것까지 이름을 달면 글자가 서로 겹쳐 못 읽는다. */}
                  <div className="flex flex-col items-center">
                    <div className={`flex items-center justify-center rounded-full border-2 border-white font-black tabular-nums leading-none shadow-[0_2px_6px_rgba(0,0,0,.6)] ${
                      near ? 'bg-amber-400 text-black w-[22px] h-[22px] text-[11px]' : 'bg-sky-500 text-white w-[18px] h-[18px] text-[10px]'}`}>
                      {st2.seq != null ? st2.seq : '·'}
                    </div>
                    {near && (
                      <div className="mt-0.5 px-1 rounded bg-black/80 text-white text-[9px] font-bold leading-tight whitespace-nowrap max-w-[72px] overflow-hidden text-ellipsis">
                        {st2.who || st2.name}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
      {/* ⭐시점 표시 + 시점 고르기 — 형 지시 *"어느 방향 시점인지 시점 표시 기능도 넣어 달란 이야기야"*
          ⛔시점은 담당자가 고른다. 우리가 하나로 정하지 않는다. */}
      {/* ⭐좌측 하단 한 묶음 — 형 지시 2026-08-04
          *"안보이는 좌상단에 있는 네비게이션을 좌측 하단으로 내려서 어디인지 어디로 가는지"*
          위: 지금 어디인지(주행 중이면 다음에 갈 집도) · 아래: 나침반 + 시점 고르기 */}
      {!notice && (
        <div className="absolute left-3 bottom-3 z-10 flex flex-col items-start gap-2">
          <div className="rounded-xl bg-slate-900/95 backdrop-blur text-white px-3 py-2 shadow-2xl ring-1 ring-white/10 max-w-[22rem]">
            <div className="text-[10px] font-black text-sky-300 tracking-wide">
              {drive ? '지금 달리는 곳' : '3D 입체 지도'}
            </div>
            <div className="text-sm font-extrabold truncate">
              {target?.seqLabel
                ? <span className="mr-1.5 text-amber-300">{target.seqLabel}</span>
                : target?.seq != null && <span className="mr-1.5 text-amber-300">{target.seq}번</span>}
              {target?.who || target?.name || '위치'}
            </div>
            {target?.addr && <div className="text-[11px] font-bold text-white/65 truncate">{target.addr}</div>}
            {drive && next && (
              <div className="mt-1 pt-1 border-t border-white/10 text-[11px] font-black text-white/80 truncate">
                <span className="text-white/45 mr-1">다음</span>
                <span className="text-amber-300 mr-1">{next.seqLabel || (next.seq != null ? `${next.seq}번` : '')}</span>
                {next.who || next.name}
              </div>
            )}
          </div>
          {drive && (
        <div className="flex items-end gap-2">
          <DriveCompass
            heading={headNow}
            look={(headNow + (look.yaw || 0) + 360) % 360}
            view={viewPreset(viewId).label}
            turned={!!(look.yaw || look.pitch)}
          />
          <div className="flex flex-col gap-1 rounded-xl bg-slate-900/95 backdrop-blur p-1 shadow-2xl ring-1 ring-white/10">
            {DRIVE_VIEWS.map((v) => (
              <button key={v.id} onClick={() => { setViewId(v.id); setLook({ yaw: 0, pitch: 0 }); }} title={v.hint}
                className={`px-2 py-1 rounded-lg text-[11px] font-black whitespace-nowrap transition-colors ${
                  viewId === v.id ? 'bg-amber-500 text-white' : 'text-white/60 hover:bg-white/10'}`}>
                {v.label}
              </button>
            ))}
          </div>
          {camOk === false && (
            <div className="rounded-xl bg-amber-500 text-white px-2.5 py-1.5 text-[10px] font-black shadow-xl max-w-[13rem] leading-snug">
              3D 카메라를 잡지 못했습니다 — 화면은 보이지만 주행을 따라가지 못합니다.
            </div>
          )}
        </div>
          )}
        </div>
      )}
      {/* 여기가 어디인지 + 지도로 나가기 — 3D 에서도 갇히지 않는다(형 지적 2026-08-04) */}
      {!notice && (
        <div className="absolute top-16 left-3 z-10 flex items-start gap-2">
          {onExit && (
            <button onClick={onExit} title="지도로 돌아가기"
              className="h-9 px-3 rounded-xl bg-amber-500 text-white font-black shadow-lg hover:bg-amber-400 whitespace-nowrap shrink-0">✕ 지도로</button>
          )}
        </div>
      )}
    </div>
  );
}
