/**
 * 카카오맵 즐겨찾기 API 미들웨어
 * Firebase Cloud Functions v2 (gen2) — asia-northeast3 (서울)
 *
 * 엔드포인트:
 *   GET /api/fav/kml?shareId={id}&driverId={id}        (Authorization: Bearer <공유 토큰 · claims.shareId/driverId 일치>)
 *     → 기사별 배송루트 KML 반환 (카카오맵 나만의 지도 가져오기용)
 *
 *   GET /api/fav/locations?shareId={id}&driverId={id}  (동일 토큰 필수)
 *     → 기사별 배송지 JSON 반환 (카카오맵 URL 생성용)
 *
 *   openShare (callable) — 공유 비밀번호 검증 → 커스텀 토큰. 잠금: 공유+IP 5회/10분 + 공유 전체 20회/h/30분 (CLAUDE.md §14-1)
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { extractClientIp, sanitizeUsageEvent, USAGE_TTL_DAYS } = require('./usageEvent');

admin.initializeApp();
const db = admin.firestore();

// XML 이스케이프
const esc = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// 공유 링크 만료 검사 — 문서에 expiresAt 이 있으면 지난 링크는 열지 않는다.
//   ★프론트는 45일 TTL 을 저장하고 "만료 후 재생성" 이라 안내하는데
//     여기서 검사하지 않아 만료된 링크로도 계속 내려가고 있었다(점검 지적).
const isShareExpired = (data) => {
  const exp = data?.expiresAt;
  if (!exp) return false; // 만료 미설정(구 데이터)은 통과
  const at = typeof exp.toDate === 'function' ? exp.toDate() : new Date(exp);
  return !Number.isNaN(at.getTime()) && at.getTime() < Date.now();
};

// 기사별 배송루트 KML 생성
//   ★기본 비식별: 이름·휴대폰·특이사항을 넣지 않는다.
//     KML 은 파일로 떨어져 재배포가 쉬운데(단톡방 전달 등) 이 링크는 무인증이다.
//     수령인 식별 정보는 인증된 기사앱(ShareRouteView, Firestore 직접 읽기)에서만 본다.
//     지도 용도(배송지 위치·순번·물량)에는 아래 정보만으로 충분하다.
const buildKml = (driver, records, city, monthId) => {
  const sorted = [...records].sort(
    (a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999)
  );

  const placemarks = sorted
    .map(
      (r) => `
  <Placemark>
    <name>${esc(r.배송순번 ? String(r.배송순번) : '배송지')}</name>
    <description>${esc(r.주소 || '')}${(r.포수 || 1) > 1 ? ` / ${esc(r.포수)}포` : ''}</description>
    <Point><coordinates>${r.lng},${r.lat},0</coordinates></Point>
  </Placemark>`
    )
    .join('');

  const lineTag =
    sorted.length >= 2
      ? `
  <Placemark>
    <name>${esc(driver.name)} 배송경로</name>
    <Style><LineStyle><color>ff${driver.color?.replace('#', '') || '3b82f6'}</color><width>3</width></LineStyle></Style>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>${sorted.map((r) => `${r.lng},${r.lat},0`).join('\n        ')}</coordinates>
    </LineString>
  </Placemark>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${esc(`${driver.name} 배송루트 - ${city} ${monthId}`)}</name>
  <description>총 ${sorted.length}건 배송지</description>
${placemarks}
${lineTag}
</Document>
</kml>`;
};

// ── 메인 API 핸들러 ─────────────────────────────────────────────────────────
// ★v2 는 `secrets:` 로 선언한 것만 process.env 에 주입한다 — 선언 없이 콘솔에서 시크릿만 설정하면
//   값이 영영 안 들어오고, 배포는 성공하며 스케줄러도 초록이라 "되고 있다"고 착각한다(같은 함정을 텔레그램에서 이미 겪었다).
//   → 아래 KAKAO_SECRET 을 geocode·geocodeAuto 의 secrets 에 넣는다. 읽기는 `kakaoKey()` 하나로만.
// ★시크릿 이름은 **Secret Manager 에 실재하는 것**을 쓴다 — `ADDRESS_KAKAO_REST_KEY`(주소 서비스와 공용).
//   없는 이름을 선언하면 배포가 실패하고, 선언을 안 하면 값이 안 들어와 조용히 무동작이 된다(둘 다 겪은 함정).
//   기존에 수동으로 넣어 둔 `KAKAO_REST_KEY` env 는 폴백으로 남긴다(다음 배포에서 사라져도 시크릿이 받아준다).
const KAKAO_SECRET = defineSecret('ADDRESS_KAKAO_REST_KEY');
const kakaoKey = () => {
  try { return KAKAO_SECRET.value() || process.env.ADDRESS_KAKAO_REST_KEY || process.env.KAKAO_REST_KEY || ''; }
  catch { return process.env.ADDRESS_KAKAO_REST_KEY || process.env.KAKAO_REST_KEY || ''; }
};
// (옛 전역 키 변수 제거 2026-08-24 — 키는 `kakaoKey()`/Secret Manager 로만 읽는다)

const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = defineSecret('TELEGRAM_CHAT_ID');

const sendTelegram = async (text) => {
  const tok = process.env.TELEGRAM_BOT_TOKEN || '';
  const chat = process.env.TELEGRAM_CHAT_ID || '';
  if (!tok || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    });
    return res.ok;
  } catch (e) {
    // ★발송 실패가 감시를 멈추면 안 된다. 조용히 넘기되 로그엔 남긴다.
    console.warn('[leakAlert] 텔레그램 발송 실패:', e?.message);
    return false;
  }
};

// ★카카오 키 보호(2026-08-23 · 형 지시 "키는 그대로 쓰되 문제 없게") ─────────────────────
//   키는 이제 번들에 없지만(옛 배포본도 더는 서빙되지 않는다), **예전에 받아 간 사본**은 세상에 남아 있다.
//   그래서 두 겹을 둔다: ①우리 프록시로 들어오는 사용량 상한(폭주·내부 남용 차단)
//                    ②카카오가 429(쿼터)로 막기 시작하면 **즉시 형에게 알린다**(모르고 배송 당일 멈추는 게 최악).
const KAKAO_INSTANCE_HOUR_CAP = 3000;      // 인스턴스당 시간당 호출 상한(정상 대량정제 3천건도 통과하는 넉넉한 값)
let kakaoHourKey = '';
let kakaoHourCount = 0;
let kakaoAlertHour = '';                   // 같은 시간대엔 경보 1회만
const kakaoQuotaOk = () => {
  const hour = new Date().toISOString().slice(0, 13);
  if (hour !== kakaoHourKey) { kakaoHourKey = hour; kakaoHourCount = 0; }
  kakaoHourCount += 1;
  return kakaoHourCount <= KAKAO_INSTANCE_HOUR_CAP;
};
const kakaoAlert429 = async (op) => {
  const hour = new Date().toISOString().slice(0, 13);
  if (hour === kakaoAlertHour) return;
  kakaoAlertHour = hour;
  await sendTelegram(
    `[nexus] 카카오 API 429(쿼터 초과) 감지 — ${op}\n`
    + `지도 좌표매칭이 멈출 수 있습니다. 카카오 개발자센터에서 사용량을 확인하세요.\n`
    + `(키가 남용되는 정황이면 재발급 후 Secret Manager ADDRESS_KAKAO_REST_KEY 만 갱신하면 됩니다)`,
  );
};

// ★앱 토큰은 `X-Id-Token` 헤더로 받는다 — Cloud Run 이 `Authorization: Bearer` 를 IAM 토큰으로 가로채
//   Firebase ID 토큰을 컨테이너에 닿기 전에 401 로 막기 때문이다(2026-08-23 배포 검증에서 실측).
//   ※08-08부터 사용기록 전송이 죽어 있던 진짜 이유 중 하나다.
const appToken = (req) => String(
  req.headers['x-id-token'] || req.headers['X-Id-Token'] || req.headers.authorization || '',
).replace(/^Bearer\s+/i, '').trim();

exports.api = onRequest(
  {
    cors: true,
    region: 'asia-northeast3',
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 10,          // ★사용량 상한과 짝 — 인스턴스가 무한정 늘면 시간당 상한이 무의미해진다
    secrets: [KAKAO_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],   // 프록시가 서버 키로 대신 호출 + 429 경보
  },
  async (req, res) => {
    const path = req.path || '';

    // ★(2026-08-23 SH 규칙) 이 두 엔드포인트는 shareId·driverId 만 알면 열리는 **무인증 경로**였다(주소·좌표 노출).
    //   이제 openShare 가 발급한 공유 토큰(ID 토큰 · claims.shareId)을 Bearer 로 요구한다. 클라에서 부르는 곳은 없다(grep 0).
    //   ★토큰의 driverId 도 대조한다 — 같은 공유의 기사 A 토큰으로 `?driverId=B` 의 주소·좌표를 받던 구멍(2차 검사 지적).
    const requireShareToken = async (shareId, driverId) => {
      const tok = appToken(req);
      if (!tok) return false;
      try {
        const t = await admin.auth().verifyIdToken(tok);
        return t.shareId === shareId && String(t.driverId || '') === String(driverId || '');
      } catch { return false; }
    };
    // ★부모 문서의 `records` 배열은 더 이상 쓰지 않는다(전 기사 PII 가 토큰으로 통째로 읽히던 뿌리) — 서브컬렉션을 기사별로 읽는다.
    const loadDriverRecords = async (shareId, driverId) => {
      const q = await db.collection('route_shares').doc(String(shareId)).collection('records')
        .where('driverId', '==', String(driverId)).get();
      return q.docs.map((d) => ({ id: d.id, ...d.data() }));
    };

    // ── POST /api/kakao ──────────────────────────────────────────────────
    //  ★카카오 REST 키를 클라이언트에서 걷어내기 위한 프록시(2026-08-23 점검).
    //    REST 키는 도메인 제한이 안 되므로 번들에 실리면 누구나 가져다 쓴다 → 쿼터 소진 = 배송 당일 좌표매칭 중단.
    //    여기서는 **로그인한 담당자**만, **정해진 4종 질의**만 통과시킨다(공유 토큰은 거부 — 기사에겐 필요 없다).
    if (path.includes('/kakao')) {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });
      const bearer = appToken(req);
      if (!bearer) return res.status(401).json({ error: '인증이 필요합니다.' });
      let dec;
      try { dec = await admin.auth().verifyIdToken(bearer); }
      catch { return res.status(401).json({ error: '유효하지 않은 토큰입니다.' }); }
      if (dec.shareId) return res.status(403).json({ error: '공유 토큰으로는 사용할 수 없습니다.' });
      if (!kakaoKey()) return res.status(500).json({ error: '서버에 카카오 키가 설정되지 않았습니다.' });

      if (!kakaoQuotaOk()) {
        console.warn('[kakao proxy] 시간당 상한 초과 — 잠시 차단');
        return res.status(429).json({ error: '지도 조회가 잠시 많습니다. 잠시 후 다시 시도해 주세요.' });
      }
      const { op, params } = req.body || {};
      const P = params || {};
      const clamp = (v, lo, hi, dflt) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
      };
      const q = String(P.query || '').trim().slice(0, 200);
      try {
        if (op === 'address' || op === 'keyword') {
          if (!q) return res.status(400).json({ error: 'query 가 필요합니다.' });
          const size = clamp(P.size, 1, 15, 5);
          const url = `https://dapi.kakao.com/v2/local/search/${op === 'address' ? 'address' : 'keyword'}.json`
            + `?query=${encodeURIComponent(q)}&size=${size}`;
          const r = await fetch(url, { headers: { Authorization: `KakaoAK ${kakaoKey()}` } });
          if (r.status === 429) await kakaoAlert429('search');
          if (!r.ok) return res.status(502).json({ error: '카카오 조회 실패', status: r.status });
          const j = await r.json();
          return res.json({ documents: j.documents || [], meta: j.meta || null });
        }
        if (op === 'staticmap') {
          const lat = Number(P.centerLat), lng = Number(P.centerLng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: '중심 좌표가 필요합니다.' });
          const w = clamp(P.w, 1, 1280, 1200), h = clamp(P.h, 1, 1280, 900), level = clamp(P.level, 1, 14, 6);
          const markers = String(P.markers || '').slice(0, 8000);
          const url = `https://dapi.kakao.com/v2/maps/staticmap?appkey=${kakaoKey()}`
            + `&center=${lng},${lat}&level=${level}&w=${w}&h=${h}`
            + (markers ? `&markers=${encodeURIComponent(markers)}` : '');
          const r = await fetch(url, { headers: { Authorization: `KakaoAK ${kakaoKey()}` } });
          if (r.status === 429) await kakaoAlert429('staticmap');
          if (!r.ok) return res.status(502).json({ error: '지도 이미지 생성 실패', status: r.status });
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: '이미지가 너무 큽니다.' });
          return res.json({ base64: buf.toString('base64'), contentType: r.headers.get('content-type') || 'image/png' });
        }
        return res.status(400).json({ error: '허용되지 않은 요청입니다.' });
      } catch (e) {
        console.error('[kakao proxy]', e);
        return res.status(500).json({ error: '카카오 조회 중 오류가 발생했습니다.' });
      }
    }

    // ── GET /api/fav/kml ─────────────────────────────────────────────────
    if (path.includes('/fav/kml')) {
      const { shareId, driverId } = req.query;
      if (!shareId || !driverId) {
        return res.status(400).json({ error: 'shareId와 driverId가 필요합니다.' });
      }
      if (!(await requireShareToken(String(shareId), String(driverId)))) {
        return res.status(401).json({ error: '공유 토큰이 필요합니다(비밀번호 입장 후 발급).' });
      }

      try {
        const snap = await db.doc(`route_shares/${shareId}`).get();
        if (!snap.exists) {
          return res.status(404).json({ error: '공유 데이터를 찾을 수 없거나 만료되었습니다.' });
        }

        const data = snap.data();
        if (isShareExpired(data)) {
          return res.status(410).json({ error: '만료된 공유 링크입니다. 새 공유 링크를 생성하세요.' });
        }
        const driver = data.drivers?.find((d) => d.id === driverId);
        if (!driver) {
          return res.status(404).json({ error: '기사 정보를 찾을 수 없습니다.' });
        }

        const records = (await loadDriverRecords(shareId, driverId)).filter((r) => r.lat && r.lng);

        if (!records.length) {
          return res.status(200).send(
            buildKml(driver, [], data.city || '', data.monthId || '')
          );
        }

        const kml = buildKml(driver, records, data.city || '', data.monthId || '');
        const filename = encodeURIComponent(
          `${driver.name}_${data.monthId || ''}_배송루트.kml`
        );

        res.set('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
        return res.send(kml);
      } catch (e) {
        console.error('KML 생성 오류:', e);
        return res.status(500).json({ error: 'KML 생성 실패: ' + e.message });
      }
    }

    // ── GET /api/fav/locations ───────────────────────────────────────────
    if (path.includes('/fav/locations')) {
      const { shareId, driverId } = req.query;
      if (!shareId || !driverId) {
        return res.status(400).json({ error: 'shareId와 driverId가 필요합니다.' });
      }
      if (!(await requireShareToken(String(shareId), String(driverId)))) {
        return res.status(401).json({ error: '공유 토큰이 필요합니다(비밀번호 입장 후 발급).' });
      }

      try {
        const snap = await db.doc(`route_shares/${shareId}`).get();
        if (!snap.exists) {
          return res.status(404).json({ error: '공유 데이터를 찾을 수 없습니다.' });
        }

        const data = snap.data();
        if (isShareExpired(data)) {
          return res.status(410).json({ error: '만료된 공유 링크입니다. 새 공유 링크를 생성하세요.' });
        }
        const driver = data.drivers?.find((d) => d.id === driverId);
        // ★기본 비식별(KML 과 동일 기준) — 이름·휴대폰·특이사항을 내려보내지 않는다.
        //   이 엔드포인트도 shareId·driverId 만 알면 열리는 무인증 경로다.
        const records = (await loadDriverRecords(shareId, driverId))
          .sort(
            (a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999)
          )
          .map((r) => {
            const label = r.배송순번 ? `${r.배송순번}번 배송지` : '배송지';
            return {
              seq: r.배송순번,
              address: r.주소,
              dong: r.행정동,
              qty: r.포수,
              lat: r.lat,
              lng: r.lng,
              kakaoMapUrl: r.lat && r.lng
                ? `https://map.kakao.com/link/map/${encodeURIComponent(label + ' ' + (r.주소 || ''))},${r.lat},${r.lng}`
                : null,
              kakaoNaviUrl: r.lat && r.lng
                ? `https://map.kakao.com/link/to/${encodeURIComponent(label + ' ' + (r.주소 || ''))},${r.lat},${r.lng}`
                : null,
            };
          });

        return res.json({
          driver: { id: driver?.id, name: driver?.name, color: driver?.color },
          city: data.city,
          monthId: data.monthId,
          totalCount: records.length,
          locations: records,
        });
      } catch (e) {
        console.error('locations 조회 오류:', e);
        return res.status(500).json({ error: '조회 실패: ' + e.message });
      }
    }

    // ── POST /api/usage — 정제 이용 기록 (누가·어디서·무엇을 얼마나) ─────
    //  ★IP는 서버가 헤더에서 직접 뽑는다. 클라가 보낸 ip는 채택하지 않는다(위조 차단).
    //  ★기록 실패가 정제를 막으면 안 되므로 클라는 fire-and-forget 으로 호출한다.
    if (path.includes('/usage')) {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });
      const token = appToken(req);
      if (!token) return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
      let decoded;
      try { decoded = await admin.auth().verifyIdToken(token); }
      catch { return res.status(401).json({ error: '유효하지 않은 토큰입니다.' }); }
      // ★기사 공유 토큰(claims.shareId)은 사용자가 아니다 — 여기서 받으면 admin SDK 가 `users/share_…` 를 만들어
      //   규칙이 막은 users 오염이 서버 경로로 되살아난다(2차 검사 지적).
      if (decoded.shareId) return res.status(403).json({ error: '공유 토큰으로는 사용기록을 보낼 수 없습니다.' });

      try {
        const body = sanitizeUsageEvent(req.body);
        const ip = extractClientIp(req.headers, req.socket?.remoteAddress);
        const ua = String(req.headers['user-agent'] || '').slice(0, 200);
        await db.collection('usage_events').add({
          ...body,
          uid: decoded.uid,
          email: decoded.email || '',
          ip,
          userAgent: ua,
          at: admin.firestore.FieldValue.serverTimestamp(),
          expireAt: admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + USAGE_TTL_DAYS * 24 * 60 * 60 * 1000)
          ),
        });
        // 사용자 문서에도 최근 접속 IP만 얹어 관리자 화면 1회 조회로 보이게 한다
        await db.doc(`users/${decoded.uid}`).set({
          lastIp: ip,
          lastUsageAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(body.mode === 'easy'
            ? { easyPurifyCount: admin.firestore.FieldValue.increment(1) }
            : { normalPurifyCount: admin.firestore.FieldValue.increment(1) }),
        }, { merge: true });
        return res.status(200).json({ ok: true });
      } catch (e) {
        console.error('usage 기록 오류:', e);
        return res.status(500).json({ error: '기록 실패' });
      }
    }

    return res.status(404).json({ error: '존재하지 않는 엔드포인트입니다.' });
  }
);

// ── 서버 좌표 지오코딩 배치 (클라우드에서 직접 좌표 채우기) ───────────────────
//   POST body: { city, monthId, limit?=200 }  + Authorization: Bearer <Firebase ID token>
//   좌표 없는 레코드를 coordinate_cache → Kakao 다단계 검색으로 채우고 cloud_lists에 저장.
//   실패(에러) 건은 그대로 남는다. 브라우저 부하 0 — 카카오 호출은 전부 서버에서.
const SIDO_SHORT = { '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구', '인천광역시': '인천', '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산', '세종특별자치시': '세종', '경기도': '경기', '강원특별자치도': '강원', '강원도': '강원', '충청북도': '충북', '충청남도': '충남', '전북특별자치도': '전북', '전라북도': '전북', '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주' };

const extractRoadAddress = (addr) => {
  if (!addr) return addr || '';
  let depth = 0;
  for (let i = 0; i < addr.length; i++) {
    if (addr[i] === '(') depth++;
    else if (addr[i] === ')') depth--;
    else if (addr[i] === ',' && depth === 0) return addr.slice(0, i).trim();
  }
  const lc = addr.lastIndexOf(')');
  return lc > 0 ? addr.slice(0, lc + 1).trim() : addr.trim();
};
const addrToDocId = (addr) => (addr || '').replace(/[/]/g, '_').slice(0, 400);

const kakaoGeocode = async (주소, sido, sigungu) => {
  if (!kakaoKey() || !주소) return null;
  const road = String(주소).replace(/\s*\([^)]*\).*$/, '').replace(/,.*$/, '').trim();
  const cityPrefix = sigungu || sido;
  const sidoShort = SIDO_SHORT[sido] || sido;
  const prefixedRoad = cityPrefix ? `${cityPrefix} ${road}` : road;
  const inRegion = (d) => {
    if (!sido) return true;
    const s = [d.address_name || '', d.road_address_name || '', d.road_address?.address_name || ''].join(' ');
    return (s.includes(sido) || s.includes(sidoShort)) && (!sigungu || s.includes(sigungu));
  };
  const kfetch = async (url) => {
    try {
      const r = await fetch(url, { headers: { Authorization: `KakaoAK ${kakaoKey()}` } });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };
  const tryUrl = async (url) => {
    const data = await kfetch(url);
    const d = (data?.documents || []).find(inRegion);
    return (d?.x && d?.y) ? { lat: parseFloat(d.y), lng: parseFloat(d.x) } : null;
  };
  let c = await tryUrl(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(prefixedRoad)}&size=5`);
  if (c) return c;
  c = await tryUrl(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(prefixedRoad)}&size=5`);
  if (c) return c;
  const full = cityPrefix ? `${cityPrefix} ${주소}` : 주소;
  if (full !== prefixedRoad) {
    c = await tryUrl(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(full)}&size=5`);
    if (c) return c;
  }
  return null;
};

// ── VWorld 경유 좌표 해석 (nexus-address-api) ───────────────────────────────
//   일반 주소: /v1/address/geocode (서버가 VWorld 우선 → Kakao 폴백)
//   아파트+동번호: /v1/building/dong-coords (LT_C_SPBD 동別 정밀좌표+층수)
//   API 실패 시 호출부에서 kakaoGeocode로 폴백하므로 기존 동작은 보존된다.
const ADDRESS_API_URL = process.env.ADDRESS_API_URL || 'https://nexus-address-api-31783407891.asia-northeast3.run.app';

// 상세주소 → 동(棟)번호: "12- 402호"→"12", "나동 302호"→"나", "101동"→"101", "108호"→""
const parseDongNo = (detail) => {
  const s = String(detail || '').trim();
  if (!s) return '';
  const ko = s.match(/([가-힣A-Za-z])\s*동(?![가-힣])/); // 나동/가동/B동 (동 뒤 한글이면 동호수 아님)
  if (ko) return ko[1];
  const num = s.match(/^\s*(\d{1,3})\s*동(?![가-힣])/);  // 101동
  if (num) return num[1];
  const dash = s.match(/^\s*(\d{1,3})\s*-\s*\d/);        // "12- 402호" 동-호 축약
  if (dash) return dash[1];
  return '';
};

// 좌표 캐시 키: 아파트+동이면 동별로 분리(같은 도로명 다른 동이 같은 좌표로 덮이지 않게)
const coordCacheKey = (r) => {
  const base = addrToDocId(extractRoadAddress(r.주소));
  const dong = parseDongNo(r.detailAddress);
  return (dong && (r.isApt || r.건물명)) ? `${base}#dong${dong}` : base;
};

const apiPost = async (path, body) => {
  try {
    const res = await fetch(`${ADDRESS_API_URL}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok ? j.data : null;
  } catch { return null; }
};

/**
 * 좌표 저장소(C-2~C-5) 일괄 조회 — **이미 확보해 둔 좌표를 외부 호출 없이 가져온다.**
 *
 * ★2026-08-11 점검에서 드러난 끊긴 배관을 여기서 잇는다. 저장소에는 VWorld 기반
 *   입구/중심/동 좌표가 쌓여 있는데(building_coord), 이 스케줄 함수는 그걸 보지 않고
 *   매번 새로 지오코딩을 사고 있었다. 화면 명단의 lat/lng 를 채우는 것은 이 함수뿐이므로,
 *   저장소를 안 보면 **쌓아둔 좌표가 화면에 영영 반영되지 않는다.**
 *
 * ★건별이 아니라 batch 통째로 한 번 묻는다(100건 = HTTP 1회). resolve 는 배열을 받는다.
 * ★`mode:'cache'` 고정 — 조회 전용이라 외부 API 를 태우지 않는다(설계서 F10).
 *   채움은 배치(nexus-address-listfill)와 정기배치(C-6)가 맡는다.
 *
 * ★고르는 순서(동 → 입구 → 중심)는 **`./storeCoordPick.js` 한 곳**에만 있다.
 *   예전 주석은 SSOT 를 `src/utils/coordStoreApi.js` 로 지목했는데 **그 모듈은 죽은 코드였다**
 *   — 유일한 호출부(`App.jsx` `runSavedListBackgroundCoords`)마저 아무도 안 부른다.
 *   그래서 "SSOT 를 고쳤다"고 믿으며 고쳐도 운영은 그대로였다(C-5 사고와 같은 형태).
 *   2026-08-12 에 죽은 두 벌을 지우고 규칙을 회귀 테스트가 있는 모듈로 승격했다.
 *   내비 링크는 목적이 달라 규칙도 다르다(입구→중심, 동 좌표 금지 — 설계서 F2).
 */
const { pickStoreCoord } = require('./storeCoordPick');
const { buildGeocodeQuery } = require('./geocodeQuery');

const storeCoordsFor = async (docs, sigungu) => {
  const found = new Map();
  const records = docs.map((d) => {
    const r = d.data();
    return {
      roadAddress: r.standardRoadAddress || extractRoadAddress(r.주소) || '',
      sigungu: r.matchedSigungu || sigungu || '',
      legalEmd: r.legalDong || r.법정동 || '',
      buildingName: r.buildingName || r.건물명 || '',
      dongNo: parseDongNo(r.detailAddress),
      isApartment: r.isApt === true,
    };
  });
  if (!records.some((x) => x.roadAddress)) return found;
  try {
    const res = await fetch(`${ADDRESS_API_URL}/v1/coords/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'cache', records }),
    });
    if (!res.ok) return found;
    const j = await res.json();
    const coords = Array.isArray(j?.coords) ? j.coords : [];
    // ★길이가 다르면 통째로 버린다 — 인덱스가 밀리면 **다른 사람의 좌표**가 붙는다.
    if (coords.length !== docs.length) return found;
    coords.forEach((c, i) => {
      const p = pickStoreCoord(c);
      if (p) found.set(docs[i].id, p);
    });
  } catch { /* 저장소가 없어도 아래 기존 경로가 받는다 */ }
  return found;
};

/**
 * ★질의에는 **반드시 지자체를 붙인다**(2026-08-12 · `./geocodeQuery.js` 참조).
 *   정제가 실패해 도로명 조각(`매화로 53`)만 남으면 전국에서 아무 데나 맞는다 —
 *   실측으로 시흥 명단에 성남·서울 좌표가 최대 201km 떨어져 저장돼 있었다.
 *   지자체를 붙이면 그 시에 없는 도로는 NOT_FOUND 가 되어 **좌표 없음**으로 남는다.
 *   **틀린 좌표보다 없는 좌표가 낫다** — 없으면 담당자 확인으로 가지만, 틀리면 그대로 배송으로 나간다.
 */
const apiGeocode = async (r, sido, sigungu) => {
  const rawRoad = r.standardRoadAddress || extractRoadAddress(r.주소);
  if (!rawRoad) return null;
  const road = buildGeocodeQuery(rawRoad, sido, sigungu);
  if (!road) {
    // ★0건일 때도 사유를 말로 남긴다 — "안 돌았다"와 "돌았는데 없다"가 구분돼야 한다.
    console.warn(`[geocode] 지자체를 몰라 조회를 건너뜀: ${String(rawRoad).slice(0, 40)}`);
    return null;
  }
  const complexName = r.건물명 || r.buildingName || '';
  const dongNo = parseDongNo(r.detailAddress);
  // 아파트 + 동번호 → 동별 정밀좌표
  if ((r.isApt || complexName) && dongNo) {
    const d = await apiPost('/v1/building/dong-coords', { roadAddress: road, complexName, dongNo: `${dongNo}동`, sigungu });
    if (d?.lat && d?.lng) return { lat: Number(d.lat), lng: Number(d.lng) };
  }
  // 일반 지오코딩 (서버측 VWorld 우선 → Kakao 폴백)
  const g = await apiPost('/v1/address/geocode', { standardRoadAddress: road });
  if (g?.lat && g?.lng) return { lat: Number(g.lat), lng: Number(g.lng) };
  return null;
};

exports.geocode = onRequest(
  {
    // ★secrets 로 선언해야 process.env 에 주입된다(v2 규약)
    secrets: [KAKAO_SECRET],
    cors: true, region: 'asia-northeast3', timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });
    const token = String(req.headers['x-id-token'] || req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(token); }
    catch { return res.status(401).json({ error: '유효하지 않은 토큰입니다.' }); }
    if (!kakaoKey()) return res.status(500).json({ error: '서버에 카카오 키가 설정되지 않았습니다.' });

    const { city, monthId, limit = 200 } = req.body || {};
    if (!city || !monthId) return res.status(400).json({ error: 'city, monthId가 필요합니다.' });
    // 권한: 관리자 또는 해당 지자체 승인 사용자만 호출 가능 (카카오 비용 무단 유발 차단)
    try {
      const u = (await db.doc(`users/${decoded.uid}`).get()).data() || {};
      const cities = Array.isArray(u.citiesApproved) ? u.citiesApproved : [];
      if (u.role !== 'admin' && !cities.includes(city)) {
        return res.status(403).json({ error: '이 지자체에 대한 권한이 없습니다.' });
      }
    } catch { return res.status(403).json({ error: '권한 확인 실패' }); }
    const parts = String(city).trim().split(/\s+/);
    const sido = parts[0] || '';
    const sigungu = parts.slice(1).join(' ');

    try {
      const recsRef = db.collection('cloud_lists').doc(city).collection('months').doc(monthId).collection('records');
      const snap = await recsRef.get();
      const missing = snap.docs.filter((d) => { const x = d.data(); return x.주소 && (x.lat == null || x.lng == null); });
      const totalMissing = missing.length;
      const batch = missing.slice(0, Math.max(1, Math.min(300, limit)));
      const cacheCol = db.collection('coordinate_cache').doc(city).collection('addresses');
      let success = 0, failed = 0;

      const processOne = async (docSnap) => {
        const r = docSnap.data();
        const key = coordCacheKey(r);
        let coord = null;
        if (key) {
          try { const c = await cacheCol.doc(key).get(); if (c.exists) { const cd = c.data(); if (cd.lat && cd.lng) coord = { lat: cd.lat, lng: cd.lng }; } } catch { /* ignore */ }
        }
        if (!coord) {
          coord = await apiGeocode(r, sido, sigungu) || await kakaoGeocode(r.주소, sido, sigungu);
          if (coord && key) {
            try { await cacheCol.doc(key).set({ address: extractRoadAddress(r.주소), lat: coord.lat, lng: coord.lng, fetchedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); } catch { /* ignore */ }
          }
        }
        if (coord) {
          success++;
          await docSnap.ref.update({ lat: coord.lat, lng: coord.lng, 좌표상태: '좌표확인', 좌표출처: 'cloud-fn', 좌표수정일시: admin.firestore.FieldValue.serverTimestamp() });
        } else {
          failed++;
        }
      };

      const pool = 5;
      let i = 0;
      await Promise.all(Array.from({ length: pool }, async () => {
        while (i < batch.length) { const idx = i++; await processOne(batch[idx]); }
      }));

      const remaining = (totalMissing - batch.length) + failed; // 아직 좌표 못 받은 건수
      return res.json({ processed: batch.length, success, failed, remaining, totalMissing });
    } catch (e) {
      console.error('geocode 오류:', e);
      return res.status(500).json({ error: '지오코딩 실패: ' + e.message });
    }
  }
);

// ── 자동 스케줄 좌표 매칭 (서버가 업로드 순서대로 천천히 꾸준히) ──────────────
//   3분마다 실행. coordsDone!=true 인 월 중 업로드가 가장 오래된 것을 골라
//   좌표 없는 레코드를 배치(100)로 지오코딩(캐시→카카오). 실패는 coordFailed+확인필요로 남김.
//   해당 월의 미좌표가 모두 해소되면 coordsDone=true + notifications에 완료 알림(에러 건수).
exports.geocodeAuto = onSchedule(
  {
    // ★secrets 로 선언해야 process.env 에 주입된다(v2 규약)
    secrets: [KAKAO_SECRET],
    schedule: 'every 3 minutes', region: 'asia-northeast3', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    if (!kakaoKey()) { console.warn('[geocodeAuto] KAKAO 키 없음'); return; }
    try {
      // 1) 미완료 월 메타 수집 (도시 × 월 메타만 읽음 — 가벼움)
      const cityRefs = await db.collection('cloud_lists').listDocuments();
      const candidates = [];
      for (const cityRef of cityRefs) {
        const months = await cityRef.collection('months').get();
        months.forEach((m) => {
          const md = m.data() || {};
          if (md.coordsDone === true) return;
          candidates.push({ city: cityRef.id, monthId: m.id, uploadedAt: md.uploadedAt?.toMillis?.() ?? 0, ref: m.ref });
        });
      }
      if (!candidates.length) return;
      candidates.sort((a, b) => a.uploadedAt - b.uploadedAt); // 업로드 오래된 순
      const job = candidates[0];

      const recsRef = db.collection('cloud_lists').doc(job.city).collection('months').doc(job.monthId).collection('records');
      // ★예전엔 3분마다 그 달 **전건**을 읽었다(3,000건이면 하루 약 144만 읽기 · 2026-08-23 점검).
      //   좌표가 빈 건만 색인으로 집어온다. 색인 경로가 비면(옛 스키마 등) 예전처럼 전건 조회로 폴백한다.
      const processable = (x) => x.주소 && (x.lat == null || x.lng == null) && x.coordFailed !== true;
      let missing = [];
      let snap = null;
      try {
        let cursor = null;
        for (let page = 0; page < 6 && missing.length < 100; page++) {
          let q = recsRef.where('lat', '==', null)
            .orderBy(admin.firestore.FieldPath.documentId()).limit(400);
          if (cursor) q = q.startAfter(cursor);
          const pageSnap = await q.get();
          if (pageSnap.empty) break;
          cursor = pageSnap.docs[pageSnap.docs.length - 1].id;
          missing.push(...pageSnap.docs.filter((d) => processable(d.data())));
        }
      } catch (e) {
        console.warn('[geocodeAuto] 색인 조회 실패 → 전건 조회로 폴백:', e.message);
      }
      if (!missing.length) {
        // 색인으로 못 찾았을 때만 전건 조회(완료 판정을 위해서도 필요)
        snap = await recsRef.get();
        missing = snap.docs.filter((d) => processable(d.data()));
      }

      if (!missing.length) {
        if (!snap) snap = await recsRef.get();
        // 이 월 좌표 처리 완료 → 완료 표시 + 담당자 알림
        const errorCount = snap.docs.filter((d) => d.data().coordFailed === true).length;
        await job.ref.set({ coordsDone: true, coordErrorCount: errorCount, coordDoneAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await db.collection('notifications').add({
          type: 'geocode_done', city: job.city, monthId: job.monthId, errorCount,
          message: `${job.city} ${job.monthId} 좌표 자동매칭 완료 — 실패(확인필요) ${errorCount}건`,
          read: false, createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[geocodeAuto] ${job.city} ${job.monthId} 완료, 실패 ${errorCount}건`);
        return;
      }

      // 2) 배치 지오코딩 (천천히 — 한 번에 100건, 동시성 4)
      const parts = job.city.split(/\s+/);
      const sido = parts[0] || '';
      const sigungu = parts.slice(1).join(' ');
      const cacheCol = db.collection('coordinate_cache').doc(job.city).collection('addresses');
      const batch = missing.slice(0, 100);
      let idx = 0, success = 0, failed = 0, fromStore = 0;

      // ① 좌표 저장소를 **먼저 통째로** 묻는다(HTTP 1회·외부 API 0). 여기서 나온 건은
      //    아래 캐시·지오코딩을 아예 타지 않는다 — 이미 확보한 좌표를 다시 살 이유가 없다.
      const storeMap = await storeCoordsFor(batch, sigungu);

      const worker = async () => {
        while (idx < batch.length) {
          const docSnap = batch[idx++];
          const r = docSnap.data();
          const key = coordCacheKey(r);
          let coord = storeMap.get(docSnap.id) || null;
          const viaStore = Boolean(coord);
          if (viaStore) fromStore++;
          if (!coord && key) {
            try { const c = await cacheCol.doc(key).get(); if (c.exists) { const cd = c.data(); if (cd.lat && cd.lng) coord = { lat: cd.lat, lng: cd.lng }; } } catch { /* ignore */ }
          }
          if (!coord) {
            coord = await apiGeocode(r, sido, sigungu) || await kakaoGeocode(r.주소, sido, sigungu);
            if (coord && key) { try { await cacheCol.doc(key).set({ address: extractRoadAddress(r.주소), lat: coord.lat, lng: coord.lng, fetchedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); } catch { /* ignore */ } }
          }
          if (coord) {
            success++;
            // 출처를 나눠 적는다 — 나중에 "저장소가 실제로 몇 %를 대주는가"를 셀 수 있어야
            // 배관이 다시 끊겼을 때 알아챈다(이번 사고가 정확히 그 종류였다).
            await docSnap.ref.update({ lat: coord.lat, lng: coord.lng, 좌표상태: '좌표확인', 좌표출처: viaStore ? 'coord-store' : 'cloud-auto', 좌표수정일시: admin.firestore.FieldValue.serverTimestamp() });
          } else {
            failed++;
            await docSnap.ref.update({
              coordFailed: true, 좌표상태: '좌표없음',
              // ★확인필요만 되돌리면 배송상태·작업상태와 어긋나 같은 사람이 화면마다 다르게 집계된다(2026-08-23 점검).
              //   담당자가 이미 확인 처리한 건(확인완료=true)은 서버가 되돌리지 않는다.
              ...(docSnap.get('확인완료') === true ? {} : { 확인필요: true, 작업상태: '확인필요', 배송상태: '확인필요', 확인사유: docSnap.get('확인사유') || '좌표를 찾지 못했습니다(주소 확인 필요)' }),
            });
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      console.log(`[geocodeAuto] ${job.city} ${job.monthId} 진행 — 성공 ${success}`
        + ` (저장소 ${fromStore} · 지오코딩 ${success - fromStore}) 실패 ${failed} (남은 월 ${candidates.length})`);
      // coordsDone는 아직 false → 다음 실행에서 이 월의 나머지를 계속 처리
    } catch (e) {
      console.error('[geocodeAuto] 오류:', e);
    }
  }
);

// ══════════════════════════════════════════════════════════════════
//  개인정보 열람 감시 알림 (계획 Phase 5-b · 2026-08-13)
//
//  ★기록만 남기면 아무도 안 본다 — 사고는 로그를 뒤지는 사람이 없을 때 커진다.
//    그래서 기록이 들어오는 **즉시** 규칙을 돌리고 사람에게 보낸다.
//  ★개정 개인정보보호법(2026-09-11)의 72시간 통지는 '인지'가 전제다.
//    이 함수가 그 '인지'를 만든다.
//
//  설정(없으면 서버 로그에만 남는다 — 그래도 죽지 않는다):
//    TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID
//  판정 규칙·임계값은 `./leakWatch.js`(회귀 scripts/leak-watch.test.mjs) 참조.
// ══════════════════════════════════════════════════════════════════
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { detectAnomalies, formatAlert, DEFAULTS } = require('./leakWatch');

// ★v2 는 `secrets:` 로 선언한 것만 process.env 에 주입한다.
//   선언 없이 시크릿만 설정하면 값이 영영 안 들어와 계속 `(미발송)` 이 찍힌다 —
//   배포는 성공하고 로그도 남으니 "됐다"고 착각하기 딱 좋은 자리다.


exports.leakAlert = onDocumentCreated(
  {
    document: 'share_access_logs/{logId}',
    region: 'asia-northeast3',
    memory: '256MiB',
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
  },
  async (event) => {
    const cur = event.data?.data();
    if (!cur) return;
    try {
      // 같은 행위자의 최근 기록만 모은다. 신원이 없으면(인증 전) 공유 단위로 본다 —
      // ★"누구인지 모른다"고 감시를 건너뛰면 인증 붙기 전 기간이 통째로 사각이 된다.
      const key = cur.phone || cur.uid || '';
      const sinceIso = new Date(Date.now() - DEFAULTS.windowMin * 60 * 1000).toISOString();
      let q = db.collection('share_access_logs').where('at', '>=', sinceIso);
      q = key ? q.where('phone', '==', cur.phone || '') : q.where('shareId', '==', cur.shareId || '');
      const snap = await q.limit(500).get();
      const rows = snap.docs.map((d) => d.data());

      const findings = detectAnomalies(rows, {});
      if (!findings.length) return;

      const actor = { name: cur.driverName, phone: cur.phone, uid: cur.uid };
      const text = formatAlert(actor, findings)
        + `\n공유: ${cur.shareId || '?'}${cur.driverName ? ` · 기사: ${cur.driverName}` : ''}`;
      const sent = await sendTelegram(text);
      // 채널이 없어도 최소한 서버 로그엔 남는다(형이 나중에라도 볼 수 있게).
      console.warn(`[leakAlert]${sent ? '' : '(미발송)'} ${text.replace(/\n/g, ' | ')}`);
    } catch (e) {
      console.error('[leakAlert] 판정 실패:', e);
    }
  },
);

// ══════════════════════════════════════════════════════════════════
//  공유링크 비밀번호 입장 (2026-08-23 · 형 지시 "지도 생성할 때 비밀번호 숫자 6자리")
// ══════════════════════════════════════════════════════════════════
//   기사 화면이 보낸 비밀번호를 **여기서만** 검증한다 — 해시·솔트는 `route_share_secrets/{shareId}`(클라가 못 읽는 문서).
//   맞으면 그 공유 하나에만 통하는 커스텀 토큰(claims.shareId)을 발급하고, Firestore 규칙(`hasShareToken`)이
//   토큰 없는 읽기를 막는다. 화면에서 비교하면 장식이다(개발자도구로 원본을 그대로 본다).
//   · 비밀번호 없이 만든 옛 링크(secrets 문서 없음)는 그대로 토큰 발급 — 만료(≤7일)까지 현장이 서지 않게(이행기)
//   · 잠금: 공유+IP 5회→10분 + 공유 전체 20회/h→30분 — 6자리는 무제한 시도면 한 시간 안에 뚫린다
//   · ⚠️커스텀 토큰 서명엔 실행 서비스계정(…-compute@)에 `roles/iam.serviceAccountTokenCreator`(자기 자신)가 필요하다.
//     없으면 배포는 되고 **호출만 죽는다** — 배포 절차에 IAM 1줄이 들어가는 이유. 배포 후 반드시 실호출로 확인할 것.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const nodeCrypto = require('crypto');
const { verifyPasscode, isValidPasscode, hashPasscode, DEFAULT_SHARE_PASSCODE } = require('./sharePasscode');
// ★비밀번호 문서가 없는 공유(옛 링크 · 담당자가 안 정한 경우)는 **기본번호로 연다**(형 지시 2026-08-25).
//   예전엔 빈 비밀번호로 그냥 열렸다(SH-5 이행기) — 링크만 알면 누구나 들어왔다는 뜻이다.
//   저장된 솔트가 없으니 여기서 고정 솔트로 같은 규격의 해시를 만들어, 아래 검증·잠금 코드를 **그대로** 태운다.
const DEFAULT_SECRET_SALT = 'nexus-default-share-salt';
const DEFAULT_SECRET_HASH = hashPasscode(DEFAULT_SHARE_PASSCODE, DEFAULT_SECRET_SALT);
const SHARE_ID_RE = /^sr_[A-Za-z0-9_-]{8,64}$/;     // 옛 형식(접두사 뒤 14자)도 받는다 · 길이 상한
const DRIVER_ID_RE = /^[A-Za-z0-9_-]{0,40}$/;
// 잠금 정책(검사 지적 반영): ① 공유+IP 단위 5회 → 10분(틀린 사람만 잠긴다 — 링크 아는 사람이 전 기사를 잠그지 못하게)
//                        ② 공유 전체 시간당 20회 실패 → 30분(분산 대입 차단 — 최악 ≈40회/h, 30일 안에 뚫릴 확률 3% 미만)
//   ★실질 방어선은 ②다. ①의 IP 는 위조 가능(XFF)해 보조 수단으로만 본다.
const LOCK_AFTER_FAILS = 5;
const LOCK_MINUTES = 10;
const SHARE_HOUR_CAP = 20;
const SHARE_CAP_LOCK_MINUTES = 30;
const ATTEMPT_TTL_MS = 60 * 60 * 1000;   // 시도 문서 expiresAt — Firestore TTL 정책(선택)으로 정리
const ipKeyOf = (req) => {
  // ★IP 판정은 `usageEvent.extractClientIp` **하나**만 쓴다(2026-08-23 점검: 두 곳이 서로 반대로 구현돼 있었다).
  //   뒤에서부터 구글 LB·사설 대역을 걷어내고 남는 마지막 값 = 실제 접속 IP.
  const raw = extractClientIp(req.rawRequest?.headers || {}, req.rawRequest?.ip || '');
  return nodeCrypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 24);   // 원IP 는 저장하지 않는다
};
const toMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);

exports.openShare = onCall(
  { region: 'asia-northeast3', memory: '256MiB', cors: true, maxInstances: 5 },
  async (req) => {
    const shareId = String(req.data?.shareId || '').trim();
    const passcode = String(req.data?.passcode || '').trim();
    const rawDriver = String(req.data?.driverId || '').trim();
    const driverId = DRIVER_ID_RE.test(rawDriver) ? rawDriver : '';
    if (!SHARE_ID_RE.test(shareId)) throw new HttpsError('invalid-argument', '공유 ID 형식이 아닙니다.');

    const shareSnap = await db.collection('route_shares').doc(shareId).get();
    const share = shareSnap.exists ? shareSnap.data() : null;
    // ★만료일 없는 옛 문서는 "영원히 유효"가 아니라 "만료"다 — 검사 지적(옛 링크로 무기한 토큰 발급 차단)
    if (!share || !share.expiresAt || isShareExpired(share)) {
      throw new HttpsError('not-found', '공유 링크가 없거나 만료되었습니다.');
    }

    // ★driverId 는 호출자가 보낸 값이다 — **그 공유에 실재하는 기사인지** 확인하지 않으면
    //   비밀번호를 아는 사람이 부모 문서의 drivers[] 를 읽어 기사 id 를 하나씩 넣어 토큰을 받아
    //   그 지도 전 기사의 명단(이름·주소·휴대폰)을 모을 수 있다(2026-08-23 점검 실측).
    //   규칙(`resource.data.driverId == tokenDriverId()`)은 이 값을 그대로 믿으므로 여기서 막는다.
    const knownDriver = Array.isArray(share.drivers) && share.drivers.some((d) => String(d && d.id || '') === driverId);
    if (!driverId || !knownDriver) {
      throw new HttpsError('invalid-argument', '이 지도에 없는 기사 링크입니다. 담당자에게 받은 링크를 그대로 열어 주세요.');
    }

    const secretRef = db.collection('route_share_secrets').doc(shareId);
    const attemptRef = db.collection('route_share_attempts').doc(`${shareId}_${ipKeyOf(req)}`);
    const nowMs = Date.now();
    // ★검증·실패 집계·잠금을 **한 트랜잭션**에서 — 동시요청이 같은 카운트를 읽고 지나가는 경합을 막는다(검사 지적)
    const outcome = await db.runTransaction(async (tx) => {
      const [secSnap, attSnap] = await Promise.all([tx.get(secretRef), tx.get(attemptRef)]);
      // 문서가 없으면 기본번호를 쓴다 — 아래 로직은 있을 때와 완전히 같은 길을 탄다.
      const usingDefault = !secSnap.exists || !secSnap.get('passcodeHash');
      const sec = usingDefault
        ? { ...(secSnap.data() || {}), passcodeSalt: DEFAULT_SECRET_SALT, passcodeHash: DEFAULT_SECRET_HASH, ver: 0 }
        : (secSnap.data() || {});
      const att = attSnap.exists ? (attSnap.data() || {}) : {};
      const ipLock = toMs(att.lockUntil), shareLock = toMs(sec.lockUntil);
      if (ipLock > nowMs) return { kind: 'locked', minutes: Math.ceil((ipLock - nowMs) / 60000) };
      if (shareLock > nowMs) return { kind: 'locked', minutes: Math.ceil((shareLock - nowMs) / 60000) };
      if (!passcode) return { kind: 'required' };
      if (!isValidPasscode(passcode)) return { kind: 'invalid' };
      if (verifyPasscode(passcode, sec.passcodeSalt, sec.passcodeHash)) {
        if (attSnap.exists) tx.delete(attemptRef);
        // ★기본번호로 열렸으면 그 자리에서 문서로 굳힌다 — 상태가 데이터에 드러나야
        //   담당자가 [변경]으로 바꿀 수 있고, 규칙의 세대(ver) 대조도 어긋나지 않는다.
        if (usingDefault) {
          tx.set(secretRef, {
            passcodeSalt: DEFAULT_SECRET_SALT, passcodeHash: DEFAULT_SECRET_HASH, ver: 0,
            // ⛔`isDefault` 같은 표식은 두지 않는다 — 담당자가 [변경]으로 번호를 바꿔도
            //   규칙이 그 키의 수정을 막아 **거짓으로 남는다**(허용 키는 hash·salt·updatedAt·ver 뿐).
            createdBy: 'system:default', updatedAt: admin.firestore.Timestamp.fromMillis(nowMs),
          }, { merge: true });
        }
        // ★비밀번호 세대(ver) — 담당자가 번호를 바꾸면 이 값이 오르고, 규칙이 옛 토큰을 끊는다.
        return { kind: 'ok', ver: Number(sec.ver || 0) };
      }
      const fails = (att.failCount || 0) + 1;
      const attPatch = {
        shareId, failCount: fails, lastFailAt: admin.firestore.Timestamp.fromMillis(nowMs),
        expiresAt: admin.firestore.Timestamp.fromMillis(nowMs + ATTEMPT_TTL_MS),
      };
      if (fails >= LOCK_AFTER_FAILS) {
        attPatch.lockUntil = admin.firestore.Timestamp.fromMillis(nowMs + LOCK_MINUTES * 60000);
        attPatch.failCount = 0;
      }
      tx.set(attemptRef, attPatch, { merge: true });
      const hourStart = toMs(sec.hourStart);
      const inWindow = hourStart > 0 && nowMs - hourStart < 3600000;
      const hourFails = (inWindow ? (sec.hourFails || 0) : 0) + 1;
      const secPatch = { hourFails, hourStart: inWindow ? sec.hourStart : admin.firestore.Timestamp.fromMillis(nowMs) };
      // ★틀린 시도로 문서가 처음 만들어질 때 해시를 같이 넣는다 — 안 넣으면 `passcodeHash` 없는
      //   반쪽 문서가 남아 그 지도는 **아무 번호로도 못 열린다**(기본번호 경로까지 막힌다).
      if (usingDefault) Object.assign(secPatch, { passcodeSalt: DEFAULT_SECRET_SALT, passcodeHash: DEFAULT_SECRET_HASH, ver: 0 });
      if (hourFails >= SHARE_HOUR_CAP) {
        secPatch.lockUntil = admin.firestore.Timestamp.fromMillis(nowMs + SHARE_CAP_LOCK_MINUTES * 60000);
        secPatch.hourFails = 0;
      }
      tx.set(secretRef, secPatch, { merge: true });
      return { kind: 'wrong', fails };
    });

    // uid 는 공유+기사로 고정 — 열람기록(share_access_logs)의 uid 로 같은 기사의 행동이 이어져 보이게(leakWatch 집계).
    // 규칙은 claims.shareId 로 공유를, claims.driverId 로 건별 문서를 가른다.
    const mint = async (legacy, ver = 0) => {
      const uid = `share_${shareId}_${driverId}`.slice(0, 128);
      // ★`ver` 는 비밀번호 세대다 — 규칙이 secrets 문서의 ver 와 대조해 **옛 번호로 받은 토큰을 끊는다**.
      const token = await admin.auth().createCustomToken(uid, { shareId, driverId, role: 'driver', ver });
      return { token, legacy, expiresAt: toMs(share.expiresAt) };
    };
    switch (outcome.kind) {
      // ⛔`legacy`(비밀번호 없이 그냥 열어 주던 옛 경로)는 2026-08-25 에 없앴다 — 이제 비밀번호 문서가 없으면 기본번호를 요구한다.
      case 'ok': return mint(false, outcome.ver || 0);
      case 'locked': throw new HttpsError('resource-exhausted', '여러 번 틀려 잠시 잠겼습니다.', { minutes: outcome.minutes });
      case 'required': throw new HttpsError('failed-precondition', 'PASSCODE_REQUIRED');
      case 'invalid': throw new HttpsError('invalid-argument', '숫자 6자리를 입력해 주세요.');
      default:
        console.warn(`[openShare] 비밀번호 불일치 share=${shareId} driver=${driverId || '-'} fails=${outcome.fails}`);
        throw new HttpsError('permission-denied', '비밀번호가 맞지 않습니다.');
    }
  },
);
