import { useState, useEffect, useRef, useCallback } from 'react';
import { db, auth, functions, signInWithCustomToken, onAuthStateChanged } from '../config/firebase.js';
import { doc, collection, addDoc, onSnapshot, updateDoc, deleteField, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { MapPin, List, Map as MapIcon, RefreshCw, Building2, Phone, ChevronUp, ChevronDown, Navigation, Crosshair, Star, X, AlertCircle, Share2, CheckCircle2, ArrowUpDown, Lock } from 'lucide-react';
import { decideGate, gateMessage } from '../utils/shareGate.js';
import { isValidPasscode } from '../utils/sharePasscode.js';
import { verifyDeliveryPositionApi } from '../engine/addressEngine.js';
import { haversineKm } from '../engine/coordValidator.js';
import { sortByRoadAddress } from '../utils/sortRecords.js';
// 파생 계산(정렬·순번배지·지도대상) — 회귀 scripts/share-records-view.test.mjs 로 잠겨 있다.
import { deriveDriverRecords } from '../utils/shareRecordsView.js';
import { loadKakaoMapsSdk } from '../utils/kakaoSdk.js';   // 지도 SDK 로더 SSOT

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY;

// ── 외부 지도 열기 함수들 ──────────────────────────────────────────────────
const openKakaoMapFavorite = (r) => {
  const name = encodeURIComponent((r.이름 || '배송지') + ' ' + (r.주소 || ''));
  window.open(`https://map.kakao.com/link/map/${name},${r.lat},${r.lng}`, '_blank');
};
const openKakaoNavi = (r) => {
  const name = encodeURIComponent(r.이름 || '배송지');
  const naviScheme = `kakaonavi://route?ep=${r.lng},${r.lat}&by=CAR&appkey=${KAKAO_JS_KEY}`;
  const webFallback = `https://map.kakao.com/link/to/${name},${r.lat},${r.lng}`;
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  iframe.src = naviScheme;
  setTimeout(() => { document.body.removeChild(iframe); if (!document.hidden) window.open(webFallback, '_blank'); }, 1000);
};

// ── GPS 허용 가이드 (기기별) ─────────────────────────────────────────────
function GpsGuideModal({ onClose }) {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isSamsung = /SamsungBrowser/i.test(ua);
  // 카카오톡·네이버·인스타 등 인앱 브라우저 감지
  const isInApp = /KAKAOTALK|NAVER|Instagram|Line|WhatsApp|FB|FBAN/i.test(ua);
  const [tab, setTab] = useState(0);

  // iOS
  const iosSteps = [
    { icon: 'AA', title: '주소창 왼쪽 AA 탭', desc: 'Safari 주소창 왼쪽의 AA 아이콘을 탭합니다.' },
    { icon: '📍', title: '"웹사이트 설정" → "위치"', desc: '"웹사이트 설정" 탭 후 "위치"를 탭합니다.' },
    { icon: '✅', title: '"방문 중 허용" 선택', desc: '"허용" 또는 "방문 중 허용"을 선택합니다.' },
    { icon: '🔄', title: '새로고침', desc: '아래 새로고침 버튼을 탭하면 GPS가 켜집니다.' },
  ];

  // 삼성 인터넷
  const samsungSteps = [
    { icon: '🔒', title: '주소창 자물쇠 탭', desc: '주소창 왼쪽 자물쇠 🔒 아이콘을 탭합니다.' },
    { icon: '⚙️', title: '"사이트 권한" 탭', desc: '팝업에서 "사이트 권한" 또는 "권한"을 탭합니다.' },
    { icon: '📍', title: '"위치" → 허용', desc: '"위치" 항목을 "허용"으로 변경합니다.' },
    { icon: '🔄', title: '새로고침', desc: '아래 버튼을 탭해 GPS를 활성화합니다.' },
  ];

  // Chrome — 방법 A: 주소창 / 방법 B: Chrome 사이트 설정
  const chromeTabA = [
    { icon: '🔒', title: '주소창 왼쪽 아이콘 탭', desc: '🔒 또는 ⚠️ 또는 ℹ 아이콘을 탭합니다.' },
    { icon: '⚙️', title: '"권한" 탭', desc: '팝업에서 "권한" 항목을 탭합니다.' },
    { icon: '📍', title: '"위치" → "허용"으로 변경', desc: '위치 옆에 "차단됨"이라고 뜨면 탭해서 "허용"으로 바꿉니다.' },
    { icon: '🔄', title: '새로고침', desc: '아래 버튼을 탭하면 파란 점이 뜹니다.' },
  ];
  const chromeTabB = [
    { icon: '⋮', title: 'Chrome 오른쪽 상단 ⋮ 탭', desc: 'Chrome 앱 오른쪽 상단 점 세 개(⋮) 메뉴를 탭합니다.' },
    { icon: '⚙️', title: '"설정" → "사이트 설정"', desc: '"개인 정보 보호 및 보안" → "사이트 설정"을 탭합니다.' },
    { icon: '📍', title: '"위치" → "차단됨" 목록', desc: '"위치"를 탭하면 차단된 사이트 목록이 보입니다.' },
    { icon: '✅', title: 'logis-op.web.app 탭 → 초기화', desc: '목록에서 이 사이트를 찾아 탭 후 "초기화" 또는 "허용"으로 변경합니다.' },
    { icon: '🔄', title: '이 페이지로 돌아와 새로고침', desc: '아래 새로고침 버튼을 탭하면 GPS가 켜집니다.' },
  ];

  const tabs = !isIOS && !isSamsung ? [
    { label: '방법 A (주소창)', steps: chromeTabA },
    { label: '방법 B (폰 설정)', steps: chromeTabB },
  ] : null;

  const steps = isIOS ? iosSteps : isSamsung ? samsungSteps : (tabs[tab].steps);

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-end justify-center p-4"
      style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      onClick={onClose}>
      <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[#1a1a1a]">
          <div>
            <div className="text-white font-black text-sm">📍 내 위치 켜는 방법</div>
            <div className="text-gray-600 text-[10px] mt-0.5">
              {isIOS ? 'iPhone · Safari' : isSamsung ? 'Android · 삼성 인터넷' : 'Android · Chrome'}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-600 hover:text-white">
            <X size={15} />
          </button>
        </div>

        {/* 인앱 브라우저 경고 */}
        {isInApp && (
          <div className="mx-5 mt-3 px-3 py-2 bg-yellow-900/30 border border-yellow-600/30 rounded-xl text-yellow-400 text-[11px]">
            ⚠️ 앱 내 브라우저에서는 위치 허용이 안 될 수 있어요. Chrome 또는 삼성 인터넷으로 열어주세요.
          </div>
        )}

        {/* Chrome 사용자 핵심 안내 */}
        {!isIOS && !isSamsung && !isInApp && (
          <div className="mx-5 mt-3 px-3 py-2 bg-blue-900/20 border border-blue-600/20 rounded-xl text-blue-300 text-[11px]">
            💡 폰 설정에서 Chrome 위치를 켜도 안 되는 경우, <b>이 사이트</b>가 Chrome 내에서 차단된 것입니다. 아래 방법으로 해제하세요.
          </div>
        )}

        {/* Chrome 탭 선택 */}
        {tabs && (
          <div className="flex gap-1 mx-5 mt-3">
            {tabs.map((t, i) => (
              <button key={i} onClick={() => setTab(i)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === i ? 'bg-blue-600 text-white' : 'bg-[#1a1a1a] text-gray-500 border border-[#2a2a2a]'}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="px-5 py-4 space-y-3">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-[#1a56db]/20 border border-[#1a56db]/30 flex items-center justify-center text-[11px] font-black shrink-0 text-blue-400">{s.icon}</div>
              <div>
                <div className="text-white font-bold text-xs">{s.title}</div>
                <div className="text-gray-500 text-[11px] mt-0.5">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={() => window.location.reload()}
            className="flex-1 py-3 bg-[#3b82f6] hover:bg-blue-700 text-white font-black text-sm rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2">
            <RefreshCw size={14} /> 새로고침
          </button>
          <button onClick={onClose}
            className="px-4 py-3 bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 font-bold text-sm rounded-xl active:scale-[0.98] transition-all">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShareRouteView({ shareId, driverId }) {
  const [shareData, setShareData]     = useState(null);
  // 건별 배송 문서(서브컬렉션). null = 아직/없음 → 옛 배열(`shareData.records`)로 폴백.
  const [subRecords, setSubRecords]   = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  // ── 비밀번호 입장 (2026-08-23 · 형 지시 "지도 생성할 때 비밀번호 숫자 6자리") ──
  //  링크만으로는 못 연다. 담당자가 정한 숫자 6자리를 넣으면 Function(openShare)이 검증하고 **이 공유 전용 토큰**을 준다 →
  //  아래 Firestore 구독이 그 토큰으로 읽는다(규칙 hasShareToken). 화면에서 비교하면 장식이다.
  //  · 담당자(이메일 로그인)가 미리보기로 열면 토큰을 받지 않는다 — 업무 세션을 덮어쓰면 안 된다(decideGate 'staff')
  //  · 비밀번호 없이 만든 옛 링크는 빈 비밀번호 probe 로 바로 토큰이 온다(만료까지 현장이 서지 않게)
  const [gate, setGate]               = useState('checking');   // checking | need | ok
  const [passcodeInput, setPasscodeInput] = useState('');
  const [gateMsg, setGateMsg]         = useState('');
  const [gateBusy, setGateBusy]       = useState(false);
  const [isMapReady, setIsMapReady]   = useState(false);
  const [selectedId, setSelectedId]   = useState(null);
  const [layoutMode, setLayoutMode]   = useState('split');
  const [starredIds, setStarredIds]   = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`starred_${shareId}_${driverId}`) || '[]')); }
    catch { return new Set(); }
  });
  const [myLocation, setMyLocation]   = useState(null);
  const [gpsStatus, setGpsStatus]     = useState('idle'); // idle|loading|ok|denied|error
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [gpsUpdatedAt, setGpsUpdatedAt] = useState(null);
  const [followMyLocation, setFollowMyLocation] = useState(true);
  const [isMapCreated, setIsMapCreated] = useState(false);
  const [showGpsGuide, setShowGpsGuide] = useState(false);
  const [copiedLink, setCopiedLink]   = useState(false);
  const [orderEditMode, setOrderEditMode] = useState(false);
  // 목록 정렬 기준 — 'seq'(배송순번, 기본) | 'road'(도로명 주소순). 지도 경로·순번 배지는 항상 순번 기준을 유지한다.
  const [sortMode, setSortMode] = useState(() => {
    try { return localStorage.getItem(`route_sort_${shareId}_${driverId}`) === 'road' ? 'road' : 'seq'; }
    catch { return 'seq'; }
  });
  const [localOrderIds, setLocalOrderIds] = useState([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isRequestingOrderApply, setIsRequestingOrderApply] = useState(false);
  const [savingDoneId, setSavingDoneId] = useState(null);
  const [isInAppBrowser, setIsInAppBrowser] = useState(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.indexOf('kakaotalk') > -1 || ua.indexOf('naver') > -1 || ua.indexOf('line') > -1 || ua.indexOf('instagram') > -1 || ua.indexOf('fban') > -1;
  });

  // ── 카카오톡 인앱 브라우저 자동 탈출 ─────────────────────────────────────────
  useEffect(() => {
    if (isInAppBrowser && navigator.userAgent.toLowerCase().indexOf('kakaotalk') > -1) {
      window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(window.location.href);
    }
  }, [isInAppBrowser]);

  const mapRef          = useRef(null);
  const kakaoMapRef     = useRef(null);
  const overlaysRef     = useRef([]);
  const myLocOverlayRef = useRef(null);
  const watchIdRef      = useRef(null);
  const selectedIdRef   = useRef(null);
  const driverGpsOverlayRef = useRef(null);
  const latestLocRef    = useRef(null);
  const followMyLocationRef = useRef(true);
  const lastBoundsKeyRef = useRef('');
  const shareTokenRef   = useRef(false);   // 지금 이 화면이 **공유 토큰**으로 열려 있는가(담당자 미리보기와 구분)
  const isMobile        = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  useEffect(() => {
    followMyLocationRef.current = followMyLocation;
  }, [followMyLocation]);

  // ── 비밀번호 입장 흐름 ─────────────────────────────────────────────────────
  const requestToken = useCallback(async (passcode) => {
    const call = httpsCallable(functions, 'openShare');
    const res = await call({ shareId, driverId: driverId || '', passcode: passcode || '' });
    const hadOldSession = shareTokenRef.current;     // 이미 옛 토큰으로 들어와 있다가 다시 받는 경우
    await signInWithCustomToken(auth, res.data.token);
    shareTokenRef.current = true;
    // ★같은 탭에서 토큰만 갈아끼우면 Firestore 가 **옛 토큰을 붙든 채** 질의해 전부 거부된다(2026-08-24 실측).
    //   담당자가 비밀번호를 바꿔 기사가 새 번호로 다시 들어오는 순간이 정확히 이 상황이라,
    //   새로고침으로 깨끗한 클라이언트를 만든다(처음 입장은 갈아끼울 옛 토큰이 없어 그대로 진행).
    if (hadOldSession) window.location.reload();
  }, [shareId, driverId]);

  useEffect(() => {
    let cancelled = false; let handled = false;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (handled) return; handled = true;   // 최초 상태 한 번만 본다(토큰 로그인으로 바뀌는 건 여기서 다시 안 탄다)
      try {
        const claims = user ? (await user.getIdTokenResult()).claims : null;
        const decided = decideGate(user, claims, shareId);
        shareTokenRef.current = decided === 'token';
        if (decided !== 'probe') { if (!cancelled) setGate('ok'); return; }
        await requestToken('');                 // 옛 링크(비밀번호 없음)면 여기서 바로 열린다
        if (!cancelled) setGate('ok');
      } catch (e) {
        if (cancelled) return;
        setGateMsg(gateMessage(e?.code, e?.details));   // PASSCODE_REQUIRED 면 빈 문장 = 입력창만
        setGate('need');
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [shareId, requestToken]);

  const submitPasscode = useCallback(async () => {
    if (!isValidPasscode(passcodeInput)) { setGateMsg('숫자 6자리를 입력해 주세요.'); return; }
    setGateBusy(true); setGateMsg('');
    try { await requestToken(passcodeInput); setGate('ok'); }
    catch (e) { setGateMsg(gateMessage(e?.code, e?.details) || '비밀번호를 확인해 주세요.'); }
    finally { setGateBusy(false); }
  }, [passcodeInput, requestToken]);

  // ── Firestore 실시간 로드 ──────────────────────────────────────────────────
  useEffect(() => {
    if (gate !== 'ok') return undefined;      // 토큰(또는 담당자 세션) 전에는 구독하지 않는다 — 권한 오류로 화면이 죽는다
    const unsub = onSnapshot(doc(db, 'route_shares', shareId), (snap) => {
      if (!snap.exists()) { setError('공유 데이터를 찾을 수 없거나 만료되었습니다.'); setLoading(false); return; }
      setShareData(snap.data());
      setLoading(false);
    }, (err) => {
      // 권한 오류 = 공유 만료(부모 TTL) 또는 생성자·관리자가 아닌 담당자 세션(미리보기는 생성자·관리자만).
      const perm = /permission|insufficient/i.test(String(err?.message || ''));
      // ★공유 토큰으로 들어와 있는데 권한이 막혔다 = 담당자가 **비밀번호를 바꿨다**(세대 대조로 옛 토큰이 끊긴다).
      //   이때 필요한 건 오류 문구가 아니라 **새 번호 입력창**이다 — 예전엔 "시크릿 창으로 여세요" 라는
      //   엉뚱한 안내가 떠서 기사가 현장에서 막혔다(2026-08-24).
      if (perm && shareTokenRef.current) {
        setGateMsg('비밀번호가 변경되었습니다. 담당자에게 받은 새 숫자 6자리를 입력해 주세요.');
        setGate('need'); setLoading(false); return;
      }
      setError(perm
        ? '이 공유를 열 수 없습니다 — 만료됐거나 권한이 없습니다. 담당자 미리보기는 공유를 만든 담당자·관리자만 가능하고, 기사 화면으로 보려면 로그아웃된 브라우저(또는 시크릿 창)에서 링크를 여세요.'
        : '데이터 로드 실패: ' + err.message);
      setLoading(false);
    });
    return () => unsub();
  }, [shareId, gate]);

  // ── 건별 배송 문서(서브컬렉션) 실시간 로드 (계획 Phase 1) ────────────────
  //  ★배열이던 `records` 를 여기로 옮겼다. 배열은 부분 권한을 줄 수 없어서
  //    읽히면 전부 읽혔다. 이제 보안규칙이 `driverPhone` 으로 걸러 **자기 것만** 온다.
  //  ★전환 중 공존: 서브컬렉션이 비어 있으면 `null` 로 두고 옛 배열로 폴백한다.
  //    (구·신 공유가 섞여 있는 기간에 옛 링크가 죽으면 현장이 선다)
  useEffect(() => {
    if (gate !== 'ok') return undefined;
    // ★기사 것만 구독한다(`where driverId`). 규칙도 토큰의 driverId 와 같은 건만 허용하므로, 이 필터가 없으면
    //   목록 쿼리 자체가 거부된다(규칙 증명 불가). 토큰 하나로 그 공유 전 건이 보이던 결함 차단(2026-08-23 검사 지적).
    const unsub = onSnapshot(
      query(collection(db, 'route_shares', shareId, 'records'), where('driverId', '==', driverId || '__none__')),
      (snap) => { setSubRecords(snap.empty ? null : snap.docs.map(d => ({ ...d.data(), id: d.id }))); },   // ★문서 id 가 마지막 — data().id 가 '' 면 recordUid 가 `${이름}_${순번}` 폴백으로 키에 이름을 박는다(검사 지적)
      // 권한 없음·미인증이면 조용히 폴백한다 — 여기서 화면을 죽이면 옛 링크까지 못 쓴다.
      () => { setSubRecords(null); },
    );
    return () => unsub();
  }, [shareId, gate, driverId]);


  // ── Kakao Maps SDK ──────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    loadKakaoMapsSdk(KAKAO_JS_KEY, ['clusterer'])   // ★다른 화면과 같은 세트로 통일 — 다르면 SDK 재주입이 일어난다(K-2)
      .then(() => { if (alive) setIsMapReady(true); })
      .catch((e) => console.warn('[지도 SDK]', e));
    return () => { alive = false; };
  }, []);

  // ── GPS 추적 ────────────────────────────────────────────────────────
  const applyGpsPosition = useCallback((pos) => {
    const next = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
      updatedAt: Date.now(),
    };
    latestLocRef.current = next;
    setMyLocation(next);
    setGpsAccuracy(next.accuracy);
    setGpsUpdatedAt(next.updatedAt);
    setGpsStatus('ok');
  }, []);

  const handleGpsError = useCallback((err) => {
    if (latestLocRef.current && err?.code !== 1) {
      setGpsStatus('ok');
      return;
    }
    setGpsStatus(err?.code === 1 ? 'denied' : 'error');
  }, []);

  const startGps = useCallback(() => {
    if (!navigator.geolocation) { setGpsStatus('error'); return; }
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    setGpsStatus('loading');

    navigator.geolocation.getCurrentPosition(
      applyGpsPosition,
      handleGpsError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      applyGpsPosition,
      handleGpsError,
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 }
    );
  }, [applyGpsPosition, handleGpsError]);

  useEffect(() => {
    startGps();
    let cleanup;
    // ★언마운트 뒤에 프로미스가 풀리면 그때 등록한 리스너는 정리 함수가 이미 지나가 **영원히 남는다**(2026-08-23 점검).
    let dead = false;
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(perm => {
        if (dead) return;
        // 설정 변경 시 (denied→granted 포함) 자동 재시도
        const handler = () => startGps();
        perm.addEventListener('change', handler);
        cleanup = () => perm.removeEventListener('change', handler);
      }).catch(() => {});
    }
    return () => {
      dead = true;
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      cleanup?.();
    };
  }, []); // eslint-disable-line

  // ── 내 위치 최신화 (Firestore 방송용) ──────────────────────────────────
  useEffect(() => {
    latestLocRef.current = myLocation;
  }, [myLocation]);

  // watchPosition can be throttled by mobile browsers, so force a fresh point too.
  useEffect(() => {
    if (!navigator.geolocation || (gpsStatus !== 'ok' && gpsStatus !== 'loading')) return;
    const interval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        applyGpsPosition,
        (err) => {
          if (!latestLocRef.current) handleGpsError(err);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
      );
    }, 10000);
    return () => clearInterval(interval);
  }, [gpsStatus, applyGpsPosition, handleGpsError]);

  // ── 실시간 위치 Firestore 방송 (모바일만 자동) ──────────────────────────
  // ★5초마다 쓰면 기사 1명당 12회/분(8시간·12명이면 하루 7만 회)이고, 그 쓰기마다 공유 문서가
  //   접속 중인 **전 기사에게 재방송**된다(2026-08-23 점검). 20초 주기 + **의미 있게 움직였을 때만** 쓴다.
  const lastSentLocRef = useRef(null);
  useEffect(() => {
    if (!isMobile) return;
    const GPS_BROADCAST_MS = 20000;     // 방송 주기
    const GPS_MIN_MOVE_M = 25;          // 이만큼 안 움직였으면 건너뛴다(정차·신호대기)
    const distM = (a2, b2) => {
      if (!a2 || !b2) return Infinity;
      const R = 6371000, toRad = (d) => d * Math.PI / 180;
      const dLat = toRad(b2.lat - a2.lat), dLng = toRad(b2.lng - a2.lng);
      const s1 = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a2.lat)) * Math.cos(toRad(b2.lat)) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s1));
    };
    const interval = setInterval(() => {
      const loc = latestLocRef.current;
      if (!loc || gpsStatus !== 'ok') return;
      const prev = lastSentLocRef.current;
      // 2분 넘게 안 보냈으면 정차 중이어도 한 번은 보낸다(담당자 화면의 '살아있음' 표시가 120초 기준이다)
      const stale = !prev || (Date.now() - prev.at) > 110000;
      if (!stale && distM(prev, loc) < GPS_MIN_MOVE_M) return;
      lastSentLocRef.current = { lat: loc.lat, lng: loc.lng, at: Date.now() };
      updateDoc(doc(db, 'route_shares', shareId), {
        [`liveGps.${driverId}`]: {
          lat: loc.lat,
          lng: loc.lng,
          accuracy: loc.accuracy ?? null,
          updatedAt: new Date().toISOString()
        }
      }).catch(e => console.warn('GPS Upload error:', e));
    }, GPS_BROADCAST_MS);
    return () => clearInterval(interval);
  }, [shareId, driverId, gpsStatus, isMobile]);

  // ── 기사 실시간 위치 (Firestore) 마커 표시 ─────────────────────────────
  useEffect(() => {
    if (!isMapCreated || !kakaoMapRef.current || !shareData) return;
    
    const driverLive = shareData.liveGps?.[driverId];
    if (driverLive && driverLive.lat && driverLive.lng) {
      const latlng = new window.kakao.maps.LatLng(driverLive.lat, driverLive.lng);
      if (driverGpsOverlayRef.current) {
        driverGpsOverlayRef.current.setPosition(latlng);
      } else {
        const content = `
          <style>
            @keyframes truck-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
            .driver-marker {
              position: relative;
              width: 50px; height: 50px;
              display: flex; align-items: center; justify-content: center;
              animation: truck-bounce 1.5s ease-in-out infinite;
            }
            .driver-marker-bg {
              position: absolute; inset: 5px;
              background: #10b981; border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            }
            .driver-marker-icon {
              position: relative; z-index: 10; font-size: 22px;
            }
            .driver-marker-pulse {
              position: absolute; inset: -5px;
              border-radius: 50%; background: rgba(16, 185, 129, 0.4);
              animation: gps-pulse 2s ease-out infinite;
              z-index: -1;
            }
          </style>
          <div class="driver-marker" title="기사 실시간 위치">
            <div class="driver-marker-pulse"></div>
            <div class="driver-marker-bg"></div>
            <div class="driver-marker-icon">🚚</div>
          </div>
        `;
        driverGpsOverlayRef.current = new window.kakao.maps.CustomOverlay({
          position: latlng, content, yAnchor: 0.8, xAnchor: 0.5, zIndex: 300,
        });
        driverGpsOverlayRef.current.setMap(kakaoMapRef.current);
      }
    }
  }, [isMapCreated, shareData?.liveGps, driverId]);   // eslint-disable-line react-hooks/exhaustive-deps -- 내 위치 표시용 — 공유 데이터가 바뀐다고 다시 그릴 필요가 없다

  // ── GPS 마커 실시간 업데이트 ─────────────────────────────────────────
  useEffect(() => {
    if (!isMapCreated || !kakaoMapRef.current || !myLocation) return;
    const latlng = new window.kakao.maps.LatLng(myLocation.lat, myLocation.lng);
    if (myLocOverlayRef.current) {
      myLocOverlayRef.current.setPosition(latlng);
    } else {
      const content = `
        <style>@keyframes gps-pulse{0%{transform:scale(1);opacity:0.8;}70%{transform:scale(2.8);opacity:0;}100%{transform:scale(2.8);opacity:0;}}</style>
        <div style="position:relative;width:24px;height:24px;">
          <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.3);animation:gps-pulse 2s ease-out infinite;"></div>
          <div style="position:absolute;inset:5px;border-radius:50%;background:#3b82f6;border:2.5px solid white;box-shadow:0 0 0 1px rgba(59,130,246,0.5),0 2px 8px rgba(0,0,0,0.4);"></div>
        </div>`;
      myLocOverlayRef.current = new window.kakao.maps.CustomOverlay({
        position: latlng, content, yAnchor: 0.5, xAnchor: 0.5, zIndex: 200,
      });
      myLocOverlayRef.current.setMap(kakaoMapRef.current);
    }
    if (followMyLocationRef.current) {
      kakaoMapRef.current.panTo(latlng);
      if (kakaoMapRef.current.getLevel() > 4) kakaoMapRef.current.setLevel(4);
    }
  }, [isMapCreated, myLocation]);

  // ── 파생 데이터 ──────────────────────────────────────────────────────
  const driver = shareData?.drivers?.find(d => d.id === driverId) || shareData?.drivers?.[0];
  const remoteOrderIds = Array.isArray(shareData?.driverOrder?.[driver?.id]) ? shareData.driverOrder[driver.id] : [];
  const activeOrderIds = localOrderIds.length ? localOrderIds : remoteOrderIds;
  // ★파생 계산을 `src/utils/shareRecordsView.js` 로 옮겼다(계획 Phase 1 · 회귀
  //   `scripts/share-records-view.test.mjs` 13건). 순번 배지·지도 대상·정렬이 전부
  //   여기 걸려 있어, 출처를 서브컬렉션으로 바꿀 때 조용히 달라지면 기사가 엉뚱한
  //   순서로 돈다. **계산을 먼저 못 박고 출처만 갈아 끼운다.**
  //  ⚠️`subRecords`(서브컬렉션)가 있으면 그걸 쓴다 — 보안규칙이 이미 기사별로 걸렀으므로
  //    `driverId` 로 다시 거르지 않는다. 없으면 옛 배열(부모 `records`)로 폴백한다.
  const usingSub = Array.isArray(subRecords);
  const { all: allRecords, map: mapRecords, hasOrder } = deriveDriverRecords(
    usingSub ? subRecords : (shareData?.records || []),
    // ★서브컬렉션이어도 다시 기사별로 거른다(이중 방어) — 규칙·쿼리가 이미 걸렀더라도 화면은 자기 것만 보여야 한다
    { driverId: driver?.id, orderIds: activeOrderIds },
  );
  // ★목록 표시 순서만 바꾼다 — 순번 배지(_displaySeq)·지도 경로선(mapRecords)·다음 배송지는
  //   언제나 배송순번 기준을 유지한다. 보기 정렬이 동선 정보를 덮어쓰면 안 된다.
  const listRecords = sortMode === 'road' ? sortByRoadAddress(allRecords) : allRecords;

  // ★2026-08-24 정밀점검: 이 블록은 원래 여기(구독부 바로 뒤)에 있었는데,
  //   의존성 배열이 **아래에서 선언되는** `allRecords`·`driver`·`usingSub` 를 읽고 있었다.
  //   의존성 배열은 **렌더 중에 평가된다** → `ReferenceError: Cannot access 'allRecords' before initialization`.
  //   즉 기사 화면이 2026-08-13(이 기능 도입) 이후로 **열자마자 죽어 있었다**.
  //   열람기록이 운영에 0건이던 진짜 이유가 이것이다(경로가 막힌 게 아니라 화면이 안 떴다).
  //   → 선언 **뒤로** 옮겼다. 회귀 `scripts/hook-dep-tdz.test.mjs` 가 같은 실수를 전 파일에서 막는다.
  // ── 열람 기록 (계획 Phase 5) ────────────────────────────────────────────
  //  ★개정 개인정보보호법(2026-09-11)의 72시간 통지는 **'인지'가 전제**다.
  //    누가 언제 어느 공유를 몇 건 열었는지 안 남기면 유출을 알아챌 수단이 없다.
  //  ★한 번 열 때 한 줄만 남긴다(건별로 남기면 로그가 명단을 복제하는 꼴이 된다).
  //  ★기록 실패가 배송을 막지 않는다 — 조용히 넘기되 콘솔엔 남긴다.
  const loggedRef = useRef(false);
  useEffect(() => {
    if (loggedRef.current) return;
    const n = allRecords.length;
    if (!n) return;                       // 아직 안 왔으면 나중에
    loggedRef.current = true;
    addDoc(collection(db, 'share_access_logs'), {
      at: new Date().toISOString(),
      shareId,
      count: n,
      driverId: driver?.id || '',
      driverName: driver?.name || '',
      // 인증이 붙기 전(Phase 2 이전)에는 비어 있다 — 그래도 '몇 건 열렸는지'는 남는다.
      phone: auth?.currentUser?.phoneNumber || '',
      uid: auth?.currentUser?.uid || '',
      source: usingSub ? 'subcollection' : 'legacy_array',
    }).catch((e) => { console.warn('[share_access_logs] 기록 실패(무시하고 계속):', e?.message); });
  }, [allRecords.length, shareId, driver?.id, driver?.name, usingSub]);

  useEffect(() => {
    if (!driver?.id) return;
    const remote = Array.isArray(shareData?.driverOrder?.[driver.id]) ? shareData.driverOrder[driver.id] : null;
    if (remote?.length) {
      setLocalOrderIds(remote);
      try { localStorage.setItem(`route_order_${shareId}_${driver.id}`, JSON.stringify(remote)); } catch {}
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(`route_order_${shareId}_${driver.id}`) || '[]');
      if (Array.isArray(saved) && saved.length) setLocalOrderIds(saved);
    } catch {}
  }, [shareData?.driverOrder, driver?.id, shareId]);

  // ── 즐겨찾기 ────────────────────────────────────────────────────────
  const handleStarRecord = useCallback((r) => {
    setStarredIds(prev => {
      const next = new Set(prev);
      if (next.has(r._uid)) { next.delete(r._uid); }
      else { next.add(r._uid); if (r.lat && r.lng) openKakaoMapFavorite(r); }
      try { localStorage.setItem(`starred_${shareId}_${driverId}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [shareId, driverId]);

  const moveRecordOrder = useCallback(async (uid, delta) => {
    if (!driver?.id || isSavingOrder) return;
    const ids = allRecords.map(r => r._uid);
    const idx = ids.indexOf(uid);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= ids.length) return;
    [ids[idx], ids[nextIdx]] = [ids[nextIdx], ids[idx]];
    setLocalOrderIds(ids);
    try { localStorage.setItem(`route_order_${shareId}_${driver.id}`, JSON.stringify(ids)); } catch {}
    setIsSavingOrder(true);
    try {
      await updateDoc(doc(db, 'route_shares', shareId), {
        [`driverOrder.${driver.id}`]: ids,
      });
    } catch (e) {
      console.warn('Order save error:', e);
    } finally {
      setIsSavingOrder(false);
    }
  }, [allRecords, driver?.id, isSavingOrder, shareId]);

  // ── 목록 정렬 기준 저장(기기별) ──────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(`route_sort_${shareId}_${driverId}`, sortMode); } catch {}
  }, [sortMode, shareId, driverId]);

  // ── 지금 보이는 도로명 주소순을 배송순번으로 확정 ─────────────────────
  //  뒤섞인 순번(지도상 왕복)을 기사가 직접 도로 순서로 되돌리는 경로.
  //  담당자 화면의 [순번] 자동계산(좌표 최적화)이 더 짧지만, 그건 담당자만 실행할 수 있다.
  const applyRoadOrderAsSequence = useCallback(async () => {
    if (!driver?.id || isSavingOrder) return;
    const ids = sortByRoadAddress(allRecords).map(r => r._uid);
    if (!ids.length) return;
    if (!window.confirm(`지금 보이는 도로명 주소순(${ids.length}건)으로 배송순번을 다시 매깁니다.\n지도 경로선도 이 순서로 바뀝니다. 진행할까요?`)) return;
    setLocalOrderIds(ids);
    try { localStorage.setItem(`route_order_${shareId}_${driver.id}`, JSON.stringify(ids)); } catch {}
    setIsSavingOrder(true);
    try {
      await updateDoc(doc(db, 'route_shares', shareId), {
        [`driverOrder.${driver.id}`]: ids,
      });
      setSortMode('seq'); // 순번이 곧 도로명순이 됐으므로 보기 기준을 순번으로 되돌린다(화면 순서 동일)
    } catch (e) {
      console.warn('Road order apply error:', e);
    } finally {
      setIsSavingOrder(false);
    }
  }, [allRecords, driver?.id, isSavingOrder, shareId]);

  const requestOrderApply = useCallback(async () => {
    if (!driver?.id || isRequestingOrderApply) return;
    // 온/오프 토글 — 현재 반영 상태를 실시간 shareData에서 직접 판단(TDZ·stale 방지)
    const currentlyRequested = shareData?.orderApplyRequests?.[driver.id]?.status === 'requested';
    setIsRequestingOrderApply(true);
    try {
      if (currentlyRequested) {
        // 토글 OFF — 반영요청 취소(요청 상태만 해제, 기사 편집 순번 driverOrder는 보존)
        await updateDoc(doc(db, 'route_shares', shareId), {
          [`orderApplyRequests.${driver.id}`]: deleteField(),
        });
      } else {
        // 토글 ON — 반영요청 등록
        const ids = allRecords.map(r => r._uid);
        if (!ids.length) { setIsRequestingOrderApply(false); return; }
        setLocalOrderIds(ids);
        try { localStorage.setItem(`route_order_${shareId}_${driver.id}`, JSON.stringify(ids)); } catch {}
        await updateDoc(doc(db, 'route_shares', shareId), {
          [`driverOrder.${driver.id}`]: ids,
          [`orderApplyRequests.${driver.id}`]: {
            status: 'requested',
            requestedAt: new Date().toISOString(),
            orderIds: ids,
            count: ids.length,
          },
        });
      }
    } catch (e) {
      console.warn('Order apply toggle error:', e);
    } finally {
      setIsRequestingOrderApply(false);
    }
  }, [allRecords, driver?.id, isRequestingOrderApply, shareData, shareId]);

  // ★완료 여부는 **건별 문서**를 먼저 본다(2026-08-23 Phase 2). 옛 공유(부모 문서에 쌓아 둔 것)는
  //   만료될 때까지 폴백으로 계속 읽는다 — 이행기에 현장이 서면 안 된다.
  const completionOf = useCallback(
    (r) => r?.completion || shareData?.completions?.[r?._uid] || null,
    [shareData],
  );

  // ── 배송완료 토글 (현재 GPS 캡처 + 동별좌표 오차 기록) ──────────────────
  const handleToggleComplete = useCallback(async (r) => {
    if (savingDoneId) return;
    const alreadyDone = !!completionOf(r);
    setSavingDoneId(r._uid);
    try {
      if (alreadyDone) {
        // 완료 취소
        await updateDoc(doc(db, 'route_shares', shareId, 'records', r.id || r._uid), {
          completion: deleteField(),
          received: false,
        });
      } else {
        // 완료 기록 — 현재 GPS와 배송지(동별)좌표 오차 계산
        const loc = latestLocRef.current;
        const hasGps = loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng);
        const dLat = Number(r.lat), dLng = Number(r.lng);
        const hasDong = Number.isFinite(dLat) && Number.isFinite(dLng);
        const errM = (hasGps && hasDong)
          ? Math.round(haversineKm(loc.lat, loc.lng, dLat, dLng) * 1000)
          : null;
        // 코어 판정(REQ-027) — 지금까지는 오차(errM)를 **기록만** 하고 판정이 없었다.
        // ★★완료를 막지 않는다: 실패·미설정·좌표없음이면 null 이고 아래 저장은 그대로 진행된다.
        //   판정 임계값은 코어에만 둔다(여기서 다시 정하면 두 곳이 곧 갈라진다).
        let posCheck = null;
        if (hasGps && hasDong) {
          posCheck = await verifyDeliveryPositionApi({
            siteLat: dLat, siteLng: dLng,
            actualLat: loc.lat, actualLng: loc.lng,
            accuracyM: loc.accuracy ?? null,
          });
        }
        // ★완료 기록은 **건별 문서**에 쓴다(2026-08-23 Phase 2). 예전엔 부모 공유 문서 하나에 전 기사가 써서
        //   ①문서당 초당 1회 쓰기 한계에 배송 러시아워가 걸리고 ②1MiB 상한에 닿으면 그 시점부터 완료가 전부 실패하고
        //   ③한 기사의 완료 1건이 접속 중인 **전 기사에게 문서 전체를 재방송**했다.
        //   규칙은 이미 기사가 자기 건의 `completion` 을 쓰도록 허용하고 있었는데(firestore.rules) 아무도 안 쓰고 있었다.
        const completionPayload = {
          at: new Date().toISOString(),
          driverId: driver?.id || driverId || null,
          lat: hasGps ? loc.lat : null,
          lng: hasGps ? loc.lng : null,
          accuracy: hasGps ? (loc.accuracy ?? null) : null,
          errM,
          // 코어 판정 결과(ok/far/unverifiable). 못 받았으면 null — 위반이 아니라 '판정 없음'이다.
          verdict: posCheck?.verdict || null,
          verdictDistanceM: Number.isFinite(posCheck?.distanceM) ? posCheck.distanceM : null,
        };
        await updateDoc(doc(db, 'route_shares', shareId, 'records', r.id || r._uid), {
          completion: completionPayload,
          received: true,
          receivedAt: completionPayload.at,
        });
      }
    } catch (e) {
      // ★예전엔 조용히 삼켰다 — 기사는 체크가 된 줄 알고 지나가고, 담당자 화면엔 완료가 없다(2026-08-23 점검).
      console.warn('Complete toggle error:', e);
      alert('배송완료 기록에 실패했습니다. 통신 상태를 확인하고 다시 눌러 주세요.');
    } finally {
      setSavingDoneId(null);
    }
  }, [shareData, shareId, driver, driverId, savingDoneId, completionOf]);   // eslint-disable-line react-hooks/exhaustive-deps -- 내 위치 표시용 — 공유 데이터가 바뀐다고 다시 그릴 필요가 없다

  // ── 링크 복사 ────────────────────────────────────────────────────────
  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // clipboard API 미지원 → share 시도
      if (navigator.share) {
        navigator.share({ title: `${driver?.name || '기사'} 배송루트`, url: window.location.href }).catch(() => {});
      }
    }
  }, [driver]);

  // ── 핀 클릭 → 목록 이동 ──────────────────────────────────────────────
  useEffect(() => {
    window._shareSelectRecord = (uid) => {
      selectedIdRef.current = uid;
      setSelectedId(uid);
      setLayoutMode(prev => prev === 'map' ? 'split' : prev);
    };
    return () => { delete window._shareSelectRecord; };
  }, []);

  useEffect(() => {
    if (!selectedId || layoutMode === 'map') return;
    const t = setTimeout(() => {
      document.getElementById(`share-rec-${selectedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => clearTimeout(t);
  }, [selectedId, layoutMode]);

  const handleRecordClick = useCallback((r) => {
    setSelectedId(r._uid);
    if (r.lat && r.lng && kakaoMapRef.current) {
      setLayoutMode(prev => prev === 'list' ? 'split' : prev);
      setTimeout(() => {
        kakaoMapRef.current?.panTo(new window.kakao.maps.LatLng(r.lat, r.lng));
        if (kakaoMapRef.current?.getLevel() > 4) kakaoMapRef.current.setLevel(3);
        kakaoMapRef.current?.relayout();
      }, layoutMode === 'list' ? 250 : 50);
    }
  }, [layoutMode]);

  const centerOnMyLocation = useCallback(() => {
    if (!myLocation || !kakaoMapRef.current) return;
    setFollowMyLocation(true);
    kakaoMapRef.current.setCenter(new window.kakao.maps.LatLng(myLocation.lat, myLocation.lng));
    kakaoMapRef.current.setLevel(4);
  }, [myLocation]);

  // ── 지도 초기화 + 마커 ───────────────────────────────────────────────
  useEffect(() => {
    if (!isMapReady || !shareData || !mapRef.current || !driver) return;
    if (!kakaoMapRef.current) {
      kakaoMapRef.current = new window.kakao.maps.Map(mapRef.current, {
        center: new window.kakao.maps.LatLng(37.5665, 126.9780), level: 7,
      });
      setIsMapCreated(true);
    }
    overlaysRef.current.forEach(o => { try { o.setMap(null); } catch {} });
    overlaysRef.current = [];
    if (!mapRecords.length) return;
    const driverColor = driver.color || '#3b82f6';
    if (mapRecords.length > 1 && hasOrder) {
      const polyline = new window.kakao.maps.Polyline({
        path: mapRecords.map(r => new window.kakao.maps.LatLng(r.lat, r.lng)),
        strokeWeight: 2, strokeColor: driverColor, strokeOpacity: 0.5, strokeStyle: 'solid',
      });
      polyline.setMap(kakaoMapRef.current);
      overlaysRef.current.push(polyline);
    }
    mapRecords.forEach((r) => {
      const isSelected = r._uid === selectedId;
      const isDone = !!completionOf(r);
      const bg = isDone ? '#059669' : isSelected ? '#fff' : driverColor;
      const fg = isDone ? '#fff' : isSelected ? driverColor : '#fff';
      const size = isSelected ? 30 : 22;
      const shadow = isDone ? '0 0 0 2px #10b981, 0 2px 8px rgba(0,0,0,0.6)' : isSelected ? `0 0 0 3px ${driverColor}, 0 4px 12px rgba(0,0,0,0.7)` : '0 2px 6px rgba(0,0,0,0.5)';
      // 순번은 발행됐을 때(hasOrder)만 원 안에 표시. 완료 시 ✓. 이름·포수 라벨은 항상 표시.
      const seqText = isDone ? '✓' : (hasOrder ? (r._displaySeq || '') : '');
      const qty = parseInt(r.포수) || 1;
      const label = `${r.이름 || ''}${qty ? `·${qty}포` : ''}`;
      const content = `
        <div onclick="window._shareSelectRecord('${r._uid}')"
          style="display:flex;flex-direction:column;align-items:center;cursor:pointer;transition:all 0.2s;"
          title="${r.이름} | ${r.주소}">
          <div style="display:flex;align-items:center;justify-content:center;
            width:${size}px;height:${size}px;border-radius:50%;
            background:${bg};border:2px solid ${isSelected ? driverColor : 'white'};
            box-shadow:${shadow};
            font-size:${isSelected ? 11 : 9}px;font-weight:900;color:${fg};">${seqText}</div>
          <div style="margin-top:2px;padding:1px 5px;
            background:rgba(0,0,0,0.78);color:#fff;
            font-size:10px;font-weight:800;border-radius:5px;
            white-space:nowrap;line-height:1.4;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${label}</div>
        </div>`;
      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(r.lat, r.lng),
        content, yAnchor: 0.5, xAnchor: 0.5, zIndex: isSelected ? 99 : 1,
      });
      overlay.setMap(kakaoMapRef.current);
      overlaysRef.current.push(overlay);
    });
    const firstRecord = mapRecords[0];
    const lastRecord = mapRecords[mapRecords.length - 1];
    const boundsKey = `${driver?.id || ''}:${mapRecords.length}:${firstRecord?._uid || ''}:${lastRecord?._uid || ''}:${firstRecord?.lat || ''}:${lastRecord?.lng || ''}`;
    if (!selectedId && lastBoundsKeyRef.current !== boundsKey) {
      const bounds = new window.kakao.maps.LatLngBounds();
      mapRecords.forEach(r => bounds.extend(new window.kakao.maps.LatLng(r.lat, r.lng)));
      kakaoMapRef.current.setBounds(bounds, 50, 50, 50, 50);
      lastBoundsKeyRef.current = boundsKey;
    }
  }, [isMapReady, shareData, driverId, selectedId, hasOrder]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => kakaoMapRef.current?.relayout(), 200);
    return () => clearTimeout(t);
  }, [layoutMode]);

  // ── 비밀번호 입장 UI (토큰 전엔 아무 데이터도 안 읽는다) ─────────────────
  if (!isInAppBrowser && gate !== 'ok') {
    return (
      <div className="fixed inset-0 bg-[#050505] flex flex-col items-center justify-center p-6 z-50 font-sans">
        <div className="w-16 h-16 bg-green-500/15 rounded-full flex items-center justify-center mb-5">
          <Lock size={30} className="text-green-400" />
        </div>
        <h2 className="text-white text-xl font-black mb-2 text-center">배송지도 비밀번호</h2>
        <p className="text-gray-400 text-center text-sm mb-6 leading-relaxed">
          담당자에게 받은 <span className="text-green-300 font-bold">숫자 6자리</span>를 입력하세요.
        </p>
        {gate === 'checking' ? (
          <div className="text-gray-500 text-sm flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> 확인 중…</div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submitPasscode(); }} className="w-full max-w-xs flex flex-col gap-3">
            <input
              type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus autoComplete="one-time-code"
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              className="w-full text-center tracking-[0.5em] text-3xl font-black bg-[#111] border border-[#2a2a2a] focus:border-green-500/60 rounded-2xl py-4 text-white outline-none"
            />
            <button
              type="submit" disabled={gateBusy || passcodeInput.length !== 6}
              className="w-full py-3 rounded-2xl bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-black text-base transition-colors"
            >
              {gateBusy ? '확인 중…' : '지도 열기'}
            </button>
            {gateMsg && <p className="text-amber-300 text-xs text-center leading-relaxed">{gateMsg}</p>}
            {gateMsg && (
              <button type="button" onClick={() => window.location.reload()}
                className="text-[11px] text-gray-500 hover:text-gray-300 underline underline-offset-2">다시 시도</button>
            )}
          </form>
        )}
      </div>
    );
  }

  // ── 인앱 브라우저 차단 UI ──────────────────────────────────────────────
  if (isInAppBrowser) {
    const isKakao = navigator.userAgent.toLowerCase().indexOf('kakaotalk') > -1;
    return (
      <div className="fixed inset-0 bg-[#050505] flex flex-col items-center justify-center p-6 z-50 font-sans">
        <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mb-6">
          <AlertCircle size={32} className="text-yellow-500" />
        </div>
        <h2 className="text-white text-xl font-black mb-3 text-center">
          {isKakao ? '카카오톡 브라우저 감지됨' : '앱 내 브라우저 감지됨'}
        </h2>
        <p className="text-gray-400 text-center text-sm mb-8 leading-relaxed">
          현재 화면에서는 <strong className="text-blue-400">GPS(실시간 위치) 기능이 차단</strong>됩니다.<br/><br/>
          원활한 배송과 실시간 위치 공유를 위해<br/>
          반드시 <strong className="text-white">크롬, 사파리, 삼성인터넷</strong> 등<br/>
          기본 브라우저로 접속해주세요.
        </p>

        {isKakao && (
          <button 
            onClick={() => { window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(window.location.href); }}
            className="w-full max-w-xs py-4 bg-[#FEE500] hover:bg-[#FEE500]/90 text-black font-black rounded-xl shadow-lg mb-4 transition-all active:scale-95">
            기본 브라우저로 열기 (추천)
          </button>
        )}

        <div className="w-full max-w-xs bg-[#1a1a1a] rounded-xl p-4 border border-[#2a2a2a]">
          <div className="text-gray-400 text-xs mb-2 font-bold">수동으로 여는 방법:</div>
          <ol className="text-gray-500 text-[11px] space-y-2">
            <li>1. 화면 하단(또는 우측 상단)의 <strong>[⋮]</strong> 버튼 누르기</li>
            <li>2. <strong>[다른 브라우저로 열기]</strong> 선택</li>
          </ol>
        </div>

        <button 
          onClick={() => setIsInAppBrowser(false)}
          className="mt-8 text-gray-600 text-xs underline underline-offset-4 hover:text-gray-400 p-2">
          GPS 없이 그냥 보기 (관리자용)
        </button>
      </div>
    );
  }

  // ── 로딩 / 에러 ──────────────────────────────────────────────────────
  if (loading) return (
    <div className="fixed inset-0 bg-[#050505] flex items-center justify-center">
      <RefreshCw size={24} className="text-[#3b82f6] animate-spin" />
    </div>
  );
  if (error) return (
    <div className="fixed inset-0 bg-[#050505] flex items-center justify-center p-8">
      <div className="text-center">
        <div className="text-red-400 text-4xl mb-4">⚠️</div>
        <div className="text-white font-bold mb-2">공유 링크 오류</div>
        <div className="text-gray-500 text-sm">{error}</div>
      </div>
    </div>
  );
  if (!shareData) return null;

  const driverColor = driver?.color || '#3b82f6';
  const totalQty = allRecords.reduce((s, r) => s + (parseInt(r.포수) || 1), 0);
  const selectedRecord = allRecords.find(r => r._uid === selectedId);
  const driverLive = shareData?.liveGps?.[driverId];
  const isLiveActive = driverLive && (Date.now() - new Date(driverLive.updatedAt).getTime() < 120000);
  const gpsAgeSec = gpsUpdatedAt ? Math.max(0, Math.round((Date.now() - gpsUpdatedAt) / 1000)) : null;
  const gpsAgeLabel = gpsAgeSec == null ? '' : gpsAgeSec < 60 ? `${gpsAgeSec}s ago` : `${Math.floor(gpsAgeSec / 60)}m ago`;
  const orderApplyRequest = driver?.id ? shareData?.orderApplyRequests?.[driver.id] : null;
  const isOrderApplyRequested = orderApplyRequest?.status === 'requested';
  const nextRecord = selectedRecord || allRecords[0];

  return (
    <div className="fixed inset-0 bg-[#050505] flex flex-col" style={{ fontFamily: 'inherit' }}>

      {/* ── GPS 가이드 모달 ───────────────────────────────────────────── */}
      {showGpsGuide && <GpsGuideModal onClose={() => setShowGpsGuide(false)} />}

      {/* ── 헤더 ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-[#060606] border-b border-[#181818]"
        style={{ paddingTop: 'env(safe-area-inset-top,0)' }}>

        {/* ── 1행: 이름 · 건수 · 포수 · GPS (모두 1줄) ─── */}
        <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">

          {/* 컬러 닷 + 이름 */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: driverColor }} />
            <span className="text-white font-black text-[13px] leading-none truncate">
              {driver?.name || '기사'}
            </span>
          </div>

          {/* 건수 · 포수 */}
          <div className="flex items-center gap-0.5 shrink-0">
            <span className="text-white font-black text-[13px]">{allRecords.length}</span>
            <span className="text-gray-500 text-[11px] ml-0.5">건</span>
            <span className="text-gray-700 mx-1.5 text-[11px]">·</span>
            <span className="text-emerald-400 font-black text-[13px]">{totalQty}</span>
            <span className="text-gray-500 text-[11px] ml-0.5">포</span>
          </div>

          {/* GPS 상태 — 최소 표시 */}
          {gpsStatus === 'ok' && (
            <span className="flex items-center gap-0.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span className="text-emerald-500 text-[10px] font-bold">GPS</span>
            </span>
          )}
          {gpsStatus === 'loading' && (
            <span className="text-yellow-600 text-[10px] font-bold animate-pulse shrink-0">GPS</span>
          )}
          {gpsStatus === 'denied' && (
            <button onClick={() => setShowGpsGuide(true)}
              aria-label="GPS 허용 방법 보기"
              className="text-orange-400 text-[10px] font-bold underline underline-offset-2 shrink-0 active:opacity-70">GPS!</button>
          )}
          {gpsStatus === 'error' && (
            <span className="text-red-500 text-[10px] font-bold shrink-0">GPS✕</span>
          )}

          {/* LIVE — 최소 표시 */}
          {isLiveActive && (
            <span className="flex items-center gap-0.5 shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span className="text-emerald-500 text-[10px] font-bold">LIVE</span>
            </span>
          )}
        </div>

        {/* ── 2행: 버튼 (공유·순번·반영요청·레이아웃) ─── */}
        <div className="flex items-center gap-1.5 px-3 pb-2">

          {/* 공유 */}
          <button onClick={handleCopyLink}
            aria-label={copiedLink ? '링크 복사됨' : '공유 링크 복사'}
            className={`flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 border transition-all active:scale-95 text-[11px] font-black ${
              copiedLink
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : 'bg-[#141414] border-[#242424] text-gray-400'
            }`}>
            <Share2 size={12} />
            <span>공유</span>
          </button>

          {/* 순번 편집 */}
          <button onClick={() => setOrderEditMode(v => !v)}
            aria-label="순번 편집 모드"
            aria-pressed={orderEditMode}
            className={`flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 border transition-all active:scale-95 text-[11px] font-black ${
              orderEditMode
                ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                : 'bg-[#141414] border-[#242424] text-gray-400'
            }`}>
            <ChevronUp size={12} />
            <span>순번</span>
          </button>

          {/* 반영 요청 — 온/오프 토글 */}
          <button onClick={requestOrderApply}
            disabled={isRequestingOrderApply || !allRecords.length}
            aria-label="배송 순번 반영 요청"
            aria-pressed={isOrderApplyRequested}
            className={`flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 border transition-all active:scale-95 text-[11px] font-black disabled:opacity-40 ${
              isOrderApplyRequested
                ? 'bg-amber-500/25 border-amber-400/50 text-amber-300'
                : 'bg-[#141414] border-[#242424] text-gray-400'
            }`}>
            <span className={`w-2 h-2 rounded-full shrink-0 transition-colors ${isOrderApplyRequested ? 'bg-amber-400' : 'bg-gray-600'}`} />
            <span>{isOrderApplyRequested ? '반영됨' : '반영요청'}</span>
          </button>

          {/* 레이아웃 토글 */}
          <div className="flex rounded-lg overflow-hidden border border-[#242424] h-8 shrink-0">
            {[
              ['map',   <MapIcon size={12} key="map" />,   '지도 보기'],
              ['split', <span key="split" className="flex flex-col items-center gap-px"><ChevronDown size={7}/><ChevronUp size={7}/></span>, '분할 보기'],
              ['list',  <List size={12} key="list" />,    '목록 보기'],
            ].map(([mode, icon, label]) => (
              <button key={mode}
                onClick={() => setLayoutMode(mode)}
                aria-label={label}
                aria-pressed={layoutMode === mode}
                className={`w-8 flex items-center justify-center transition-colors ${mode !== 'map' ? 'border-l border-[#242424]' : ''} ${layoutMode === mode ? 'bg-emerald-900/30 text-emerald-400' : 'bg-[#111] text-gray-600'}`}>
                {icon}
              </button>
            ))}
          </div>
        </div>

        {/* ── 3행: 다음 배송지 (순번 발행 시에만) ─────────── */}
        {hasOrder && nextRecord && (
          <div className="flex items-center gap-2 px-3 pt-1 pb-2 border-t border-[#111]">
            <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black border"
              style={{ background: `${driverColor}22`, color: driverColor, borderColor: `${driverColor}44` }}>
              {nextRecord._displaySeq || nextRecord.배송순번 || 1}
            </div>
            <span className="text-[11px] text-gray-500 shrink-0">다음</span>
            <span className="text-[12px] font-black text-white shrink-0 leading-none">{nextRecord.이름}</span>
            <span className="text-[11px] text-gray-500 truncate flex-1 min-w-0 leading-none">{nextRecord.주소}</span>
          </div>
        )}
      </div>

      {/* ── 바디 ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* 지도 영역 */}
        <div className={`relative flex flex-col transition-all ${
          layoutMode === 'map' ? 'flex-1' : layoutMode === 'split' ? 'h-[74%] shrink-0' : 'h-0 overflow-hidden'
        }`}>
          {!isMapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#080808] z-10">
              <RefreshCw size={20} className="text-[#3b82f6] animate-spin" />
            </div>
          )}
          <div ref={mapRef} className="flex-1 w-full h-full" />

          {gpsStatus === 'ok' && layoutMode !== 'list' && (
            <div className="absolute top-3 left-3 z-10 bg-[#050505]/90 border border-blue-500/30 rounded-full px-3 py-1.5 shadow-lg flex items-center gap-2 text-[10px] font-black text-blue-200">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-70"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              <span>내 위치</span>
              {gpsAccuracy != null && <span className="text-blue-400">±{gpsAccuracy}m</span>}
              {gpsAgeLabel && <span className="text-gray-500">{gpsAgeLabel}</span>}
              <span className={followMyLocation ? 'text-emerald-400' : 'text-gray-500'}>
                {followMyLocation ? '따라가기' : '고정'}
              </span>
            </div>
          )}

          {/* GPS 거부 배너 */}
          {(gpsStatus === 'denied' || gpsStatus === 'error') && layoutMode !== 'list' && (
            <div className="absolute bottom-16 left-3 right-3 z-20 bg-[#0d0d0d]/97 border border-orange-800/40 rounded-2xl p-3.5 shadow-2xl">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={15} className="text-orange-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-white font-black text-xs mb-1">
                    {gpsStatus === 'denied' ? '위치 권한이 거부되어 있습니다' : 'GPS 신호가 없습니다'}
                  </div>
                  {gpsStatus === 'denied' ? (
                    <button
                      onClick={() => setShowGpsGuide(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 border border-orange-500/40 text-orange-300 text-[11px] font-black rounded-xl active:scale-95 transition-all">
                      📍 위치 허용 방법 보기
                    </button>
                  ) : (
                    <button onClick={startGps}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 border border-orange-500/40 text-orange-400 text-[11px] font-black rounded-xl active:scale-95 transition-all">
                      <Crosshair size={11} /> 위치 다시 요청
                    </button>
                  )}
                </div>
                <button onClick={() => setGpsStatus('idle')} className="text-gray-700 hover:text-gray-400 p-0.5">
                  <X size={13} />
                </button>
              </div>
            </div>
          )}

          {/* GPS 버튼 */}
          <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
            {gpsStatus === 'ok' && (
              <button
                onClick={() => setFollowMyLocation(v => !v)}
                className={`h-9 px-3 rounded-full flex items-center gap-1.5 shadow-lg border text-[10px] font-black transition-all active:scale-95 ${
                  followMyLocation
                    ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300'
                    : 'bg-[#0a0a0a] border-[#333] text-gray-400'
                }`}
                title={followMyLocation ? '내 위치 따라가기 끄기' : '내 위치 따라가기 켜기'}
              >
                <Navigation size={13} />
                {followMyLocation ? '따라가기' : '고정'}
              </button>
            )}
            <button
              onClick={() => {
                if (gpsStatus === 'ok') centerOnMyLocation();
                else if (gpsStatus === 'denied') setShowGpsGuide(true);
                else startGps();
              }}
              className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg border transition-all active:scale-95 ${
                gpsStatus === 'ok'      ? 'bg-[#0a0a0a] border-[#3b82f6]/50 text-[#3b82f6] hover:bg-[#1a2a3a]'
                : gpsStatus === 'loading' ? 'bg-[#111] border-[#444] text-yellow-500'
                : 'bg-[#111] border-orange-800/40 text-orange-500 hover:bg-orange-900/20'
              }`}
              title={gpsStatus === 'ok' ? '내 위치로 이동' : '위치 허용 방법'}
            >
              <Crosshair size={16} className={gpsStatus === 'loading' ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* 선택 배송지 플로팅 내비 */}
          {selectedRecord?.lat && selectedRecord?.lng && layoutMode !== 'list' && (
            <div className="absolute bottom-3 left-3 z-10 flex gap-1.5">
              <button onClick={() => openKakaoNavi(selectedRecord)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#FEE500] text-[#1a1a1a] font-black text-xs shadow-lg hover:brightness-95 active:scale-95 transition-all">
                <Navigation size={12} /> 카카오
              </button>
            </div>
          )}
        </div>

        {/* split 구분선 */}
        {layoutMode === 'split' && (
          <div className="shrink-0 h-px bg-[#1a1a1a] relative flex items-center justify-center">
            {selectedRecord && (
              <div className="absolute bg-[#0f1a0f] border border-[#2a2a2a] rounded-full px-3 py-0.5 flex items-center gap-2 text-[10px] z-10">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: driverColor }} />
                {selectedRecord._displaySeq && <span className="font-black text-white">{selectedRecord._displaySeq}번</span>}
                <span className="text-gray-400">{selectedRecord.이름}</span>
                <span className="text-gray-600 max-w-[100px] truncate">{selectedRecord.주소}</span>
              </div>
            )}
          </div>
        )}

        {/* 목록 영역 */}
        <div className={`bg-[#060606] overflow-y-auto transition-all ${
          layoutMode === 'list' ? 'flex-1' : layoutMode === 'split' ? 'flex-1 min-h-0' : 'h-0 overflow-hidden'
        }`}>
          <div className="sticky top-0 bg-[#0a0a0a] border-b border-[#1a1a1a] px-3 py-1.5 flex items-center gap-2 z-10">
            <MapPin size={10} className="text-gray-600 shrink-0" />
            <span className="text-[9px] text-gray-600 font-black tracking-widest uppercase shrink-0">
              {sortMode === 'road' ? '도로명 주소순' : '배송 순번순'}
            </span>
            <span className="text-[9px] text-gray-700 shrink-0">{listRecords.length}건</span>

            {/* 정렬 기준 토글 — 표시 순서만 바꾼다(순번·지도 경로 불변) */}
            <div className="ml-auto flex rounded-lg overflow-hidden border border-[#242424] shrink-0">
              {[
                ['seq', '순번순'],
                ['road', '도로명순'],
              ].map(([mode, label]) => (
                <button key={mode}
                  onClick={() => setSortMode(mode)}
                  aria-label={`${label}으로 정렬`}
                  aria-pressed={sortMode === mode}
                  className={`px-2 py-1 text-[9px] font-black transition-colors ${mode === 'road' ? 'border-l border-[#242424]' : ''} ${
                    sortMode === mode ? 'bg-blue-900/40 text-blue-300' : 'bg-[#111] text-gray-600'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            {/* 도로명순 보기일 때만 — 이 순서를 배송순번으로 확정 */}
            {sortMode === 'road' && (
              <button onClick={applyRoadOrderAsSequence}
                disabled={isSavingOrder || !listRecords.length}
                aria-label="도로명 주소순을 배송순번으로 확정"
                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 disabled:opacity-40 active:scale-95 transition-all">
                <ArrowUpDown size={9} />
                {isSavingOrder ? '저장중…' : '이 순서로 순번'}
              </button>
            )}
          </div>

          {sortMode === 'road' && (
            <div className="px-3 py-1.5 bg-blue-950/20 border-b border-blue-900/30 text-[10px] text-blue-300/80 leading-snug">
              도로명 주소순으로 보고 있습니다 — 번호 배지는 <b className="text-blue-200">원래 배송순번</b> 그대로이고, 지도 경로선도 바뀌지 않습니다.
              이 순서대로 배송하려면 <b className="text-emerald-300">[이 순서로 순번]</b>을 누르세요.
            </div>
          )}

          {listRecords.map((r, idx) => {
            const isSelected = r._uid === selectedId;
            const qty = parseInt(r.포수) || 1;
            const isMultiQty = qty > 1;
            const doneInfo = completionOf(r);
            const done = !!doneInfo;
            return (
              <div key={r._uid} id={`share-rec-${r._uid}`} onClick={() => handleRecordClick(r)}
                className={`flex items-center gap-2 px-3 py-2 border-b cursor-pointer transition-colors ${
                  done
                    ? 'bg-emerald-950/25 border-emerald-500/20 hover:bg-emerald-950/35'
                    : isSelected
                      ? 'bg-[#0d1e0d] border-[#1a3a1a]'
                      : isMultiQty
                        ? 'bg-amber-950/10 border-amber-500/20 hover:bg-amber-950/20'
                        : 'border-[#111] hover:bg-[#0f0f0f]'
                }`}
              >
                {/* 순번 ▲▼ 는 순번순 보기에서만 — 도로명순 화면에서 움직이면 순번이 뒤엉킨다 */}
                {orderEditMode && sortMode === 'seq' && (
                  <div className="shrink-0 flex flex-col gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveRecordOrder(r._uid, -1); }}
                      disabled={idx === 0 || isSavingOrder}
                      className="w-7 h-6 rounded-lg border border-[#2a2a2a] bg-[#111] text-gray-400 disabled:opacity-25 active:scale-95 flex items-center justify-center"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveRecordOrder(r._uid, 1); }}
                      disabled={idx === listRecords.length - 1 || isSavingOrder}
                      className="w-7 h-6 rounded-lg border border-[#2a2a2a] bg-[#111] text-gray-400 disabled:opacity-25 active:scale-95 flex items-center justify-center"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                )}
                <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center font-black text-[11px]"
                  style={done ? {
                    background: '#059669', color: '#fff', border: '2px solid #10b981',
                    boxShadow: '0 0 10px rgba(16,185,129,0.5)',
                  } : {
                    background: isSelected ? driverColor : `${driverColor}22`,
                    color: isSelected ? '#fff' : driverColor,
                    border: `2px solid ${isSelected ? driverColor : `${driverColor}44`}`,
                    boxShadow: isSelected ? `0 0 10px ${driverColor}60` : 'none',
                  }}>
                  {done ? <CheckCircle2 size={15} /> : (r._displaySeq || '')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`font-bold text-xs ${isSelected ? 'text-white' : 'text-gray-200'}`}>{r.이름}</span>
                    {isMultiQty && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-amber-500/20 text-amber-300 border border-amber-400/35 shadow-[0_0_10px_rgba(245,158,11,0.18)]">
                        {qty}포
                      </span>
                    )}
                    {r.isApt && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-orange-900/30 text-orange-600 rounded-full font-bold">
                        <Building2 size={8} className="inline" /> 아파트
                      </span>
                    )}
                  </div>
                  <div className="text-gray-600 text-[11px] truncate">{r.행정동 && `${r.행정동} · `}{r.주소}</div>
                  {r.특이사항 && <div className="text-amber-700 text-[10px] truncate mt-0.5">⚠ {r.특이사항}</div>}
                  {done && (
                    <div className="text-emerald-500 text-[10px] mt-0.5 flex items-center gap-1 flex-wrap">
                      <CheckCircle2 size={9} />
                      완료 {doneInfo.at ? new Date(doneInfo.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : ''}
                      {doneInfo.errM != null && <span className="text-gray-600">· 오차 {doneInfo.errM}m</span>}
                      {doneInfo.lat == null && <span className="text-orange-600">· 위치 없이 기록</span>}
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {/* 배송완료 토글 */}
                  <button onClick={(e) => { e.stopPropagation(); handleToggleComplete(r); }}
                    disabled={savingDoneId === r._uid}
                    aria-pressed={done}
                    aria-label={done ? '배송완료 취소' : '배송완료 처리'}
                    className={`flex items-center gap-1 text-[10px] font-black px-2.5 py-1 rounded-full transition-all active:scale-95 disabled:opacity-40 ${
                      done
                        ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/40'
                        : 'bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 hover:text-emerald-400 hover:border-emerald-500/40'
                    }`}>
                    <CheckCircle2 size={11} className={done ? 'fill-emerald-500/20' : ''} />
                    {savingDoneId === r._uid ? '…' : done ? '완료됨' : '완료'}
                  </button>
                  {/* 카카오 내비 */}
                  {r.lat && r.lng && isSelected && (
                    <button onClick={(e) => { e.stopPropagation(); openKakaoNavi(r); }}
                      className="flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full bg-[#FEE500] text-[#1a1a1a] hover:brightness-95 active:scale-95 transition-all">
                      <Navigation size={9} /> 카카오
                    </button>
                  )}
                  {/* 카카오맵 즐겨찾기 */}
                  {r.lat && r.lng && (
                    <button onClick={(e) => { e.stopPropagation(); handleStarRecord(r); }}
                      className={`flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full transition-all active:scale-95 ${
                        starredIds.has(r._uid)
                          ? 'bg-[#FEE500] text-[#1a1a1a]'
                          : 'bg-[#1a1a1a] border border-[#2a2a2a] text-gray-500 hover:text-[#FEE500] hover:border-[#FEE500]/40'
                      }`}>
                      <Star size={9} className={starredIds.has(r._uid) ? 'fill-[#1a1a1a]' : ''} />
                      {starredIds.has(r._uid) ? '★' : '☆'}
                    </button>
                  )}
                  {!isSelected && r.lat && r.lng && <div className="text-[9px] text-gray-700">탭하여 지도</div>}
                  {r.휴대폰 && (
                    <a href={`tel:${r.휴대폰}`} onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1 text-[9px] text-blue-500 hover:text-blue-400 font-bold">
                      <Phone size={9} /> {r.휴대폰}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          {listRecords.length === 0 && (
            <div className="flex items-center justify-center h-32 text-gray-700 text-sm text-center px-4">{driverId ? '배송 데이터가 없습니다' : '기사가 지정되지 않은 링크입니다 — 담당자에게 기사별 링크를 받아 주세요'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
