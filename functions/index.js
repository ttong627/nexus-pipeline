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
