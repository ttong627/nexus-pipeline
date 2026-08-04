/**
 * 카카오맵 즐겨찾기 API 미들웨어
 * Firebase Cloud Functions v2 (gen2) — asia-northeast3 (서울)
 *
 * 엔드포인트:
 *   GET /api/fav/kml?shareId={id}&driverId={id}
 *     → 기사별 배송루트 KML 반환 (카카오맵 나만의 지도 가져오기용)
 *
 *   GET /api/fav/locations?shareId={id}&driverId={id}
 *     → 기사별 배송지 JSON 반환 (카카오맵 URL 생성용)
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

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
exports.api = onRequest(
  {
    cors: true,
    region: 'asia-northeast3',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    const path = req.path || '';

    // ── GET /api/fav/kml ─────────────────────────────────────────────────
    if (path.includes('/fav/kml')) {
      const { shareId, driverId } = req.query;
      if (!shareId || !driverId) {
        return res.status(400).json({ error: 'shareId와 driverId가 필요합니다.' });
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

        const records = (data.records || []).filter(
          (r) => r.driverId === driverId && r.lat && r.lng
        );

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
        const records = (data.records || [])
          .filter((r) => r.driverId === driverId)
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

    return res.status(404).json({ error: '존재하지 않는 엔드포인트입니다.' });
  }
);

// ── 서버 좌표 지오코딩 배치 (클라우드에서 직접 좌표 채우기) ───────────────────
//   POST body: { city, monthId, limit?=200 }  + Authorization: Bearer <Firebase ID token>
//   좌표 없는 레코드를 coordinate_cache → Kakao 다단계 검색으로 채우고 cloud_lists에 저장.
//   실패(에러) 건은 그대로 남는다. 브라우저 부하 0 — 카카오 호출은 전부 서버에서.
const KAKAO_REST_KEY = process.env.KAKAO_REST_KEY || '';
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
  if (!KAKAO_REST_KEY || !주소) return null;
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
      const r = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } });
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

const apiGeocode = async (r, sido, sigungu) => {
  const road = r.standardRoadAddress || extractRoadAddress(r.주소);
  if (!road) return null;
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
  { cors: true, region: 'asia-northeast3', timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(token); }
    catch { return res.status(401).json({ error: '유효하지 않은 토큰입니다.' }); }
    if (!KAKAO_REST_KEY) return res.status(500).json({ error: '서버에 카카오 키가 설정되지 않았습니다.' });

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
  { schedule: 'every 3 minutes', region: 'asia-northeast3', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    if (!KAKAO_REST_KEY) { console.warn('[geocodeAuto] KAKAO 키 없음'); return; }
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
      const snap = await recsRef.get();
      const missing = snap.docs.filter((d) => { const x = d.data(); return x.주소 && (x.lat == null || x.lng == null) && x.coordFailed !== true; });

      if (!missing.length) {
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
      let idx = 0, success = 0, failed = 0;

      const worker = async () => {
        while (idx < batch.length) {
          const docSnap = batch[idx++];
          const r = docSnap.data();
          const key = coordCacheKey(r);
          let coord = null;
          if (key) {
            try { const c = await cacheCol.doc(key).get(); if (c.exists) { const cd = c.data(); if (cd.lat && cd.lng) coord = { lat: cd.lat, lng: cd.lng }; } } catch { /* ignore */ }
          }
          if (!coord) {
            coord = await apiGeocode(r, sido, sigungu) || await kakaoGeocode(r.주소, sido, sigungu);
            if (coord && key) { try { await cacheCol.doc(key).set({ address: extractRoadAddress(r.주소), lat: coord.lat, lng: coord.lng, fetchedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); } catch { /* ignore */ } }
          }
          if (coord) {
            success++;
            await docSnap.ref.update({ lat: coord.lat, lng: coord.lng, 좌표상태: '좌표확인', 좌표출처: 'cloud-auto', 좌표수정일시: admin.firestore.FieldValue.serverTimestamp() });
          } else {
            failed++;
            await docSnap.ref.update({ coordFailed: true, 확인필요: true, 좌표상태: '좌표없음' });
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      console.log(`[geocodeAuto] ${job.city} ${job.monthId} 진행 — 성공 ${success} 실패 ${failed} (남은 월 ${candidates.length})`);
      // coordsDone는 아직 false → 다음 실행에서 이 월의 나머지를 계속 처리
    } catch (e) {
      console.error('[geocodeAuto] 오류:', e);
    }
  }
);
