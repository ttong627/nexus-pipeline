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

// 기사별 배송루트 KML 생성
const buildKml = (driver, records, city, monthId) => {
  const sorted = [...records].sort(
    (a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999)
  );

  const placemarks = sorted
    .map(
      (r) => `
  <Placemark>
    <name>${esc((r.배송순번 ? r.배송순번 + '. ' : '') + (r.이름 || ''))}</name>
    <description>${esc(r.주소 || '')}${(r.포수 || 1) > 1 ? ` / ${r.포수}포` : ''}${r.특이사항 ? '\n⚠ ' + r.특이사항 : ''}${r.휴대폰 ? '\n📞 ' + r.휴대폰 : ''}</description>
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
        const driver = data.drivers?.find((d) => d.id === driverId);
        const records = (data.records || [])
          .filter((r) => r.driverId === driverId)
          .sort(
            (a, b) => (parseInt(a.배송순번) || 9999) - (parseInt(b.배송순번) || 9999)
          )
          .map((r) => ({
            seq: r.배송순번,
            name: r.이름,
            address: r.주소,
            dong: r.행정동,
            note: r.특이사항,
            phone: r.휴대폰,
            qty: r.포수,
            lat: r.lat,
            lng: r.lng,
            kakaoMapUrl: r.lat && r.lng
              ? `https://map.kakao.com/link/map/${encodeURIComponent((r.이름 || '배송지') + ' ' + (r.주소 || ''))},${r.lat},${r.lng}`
              : null,
            kakaoNaviUrl: r.lat && r.lng
              ? `https://map.kakao.com/link/to/${encodeURIComponent((r.이름 || '배송지') + ' ' + (r.주소 || ''))},${r.lat},${r.lng}`
              : null,
          }));

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

exports.geocode = onRequest(
  { cors: true, region: 'asia-northeast3', timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
    try { await admin.auth().verifyIdToken(token); }
    catch { return res.status(401).json({ error: '유효하지 않은 토큰입니다.' }); }
    if (!KAKAO_REST_KEY) return res.status(500).json({ error: '서버에 카카오 키가 설정되지 않았습니다.' });

    const { city, monthId, limit = 200 } = req.body || {};
    if (!city || !monthId) return res.status(400).json({ error: 'city, monthId가 필요합니다.' });
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
        const key = addrToDocId(extractRoadAddress(r.주소));
        let coord = null;
        if (key) {
          try { const c = await cacheCol.doc(key).get(); if (c.exists) { const cd = c.data(); if (cd.lat && cd.lng) coord = { lat: cd.lat, lng: cd.lng }; } } catch { /* ignore */ }
        }
        if (!coord) {
          coord = await kakaoGeocode(r.주소, sido, sigungu);
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
