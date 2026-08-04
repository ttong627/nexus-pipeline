/**
 * 배송지도 내보내기 (모듈 ⑩) — 순수 함수, 의존 0.
 *
 * ★무엇을 코어로 올리는가
 *   지도 화면(RouteMapModal 6,415줄)은 React UI 라 코어에 올릴 수 없다. 올릴 것은
 *   **지도 데이터**다 — 경로를 KML/GeoJSON 으로 내보내면 카카오맵·구글어스·다른 프로그램이
 *   그대로 열 수 있다. 화면은 앱마다 달라도 데이터 규격은 하나여야 한다.
 *
 * ★★PII 경고 — 이 모듈이 존재하는 가장 큰 이유
 *   기존 KML 생성기(`functions/index.js buildKml`)는 **수령인 이름·휴대폰·특이사항을
 *   그대로 지도 파일에 넣는다**. KML 은 카카오맵 "나만의 지도"에 업로드되고 링크로 공유된다.
 *   즉 파일 하나가 새면 명단이 통째로 샌다.
 *   → 여기서는 **기본이 비식별**이다. 이름·전화는 `includeContact: true` 를 **명시**해야만
 *     들어가고, 그때도 응답이 `piiIncluded: true` 로 알려준다. 조용히 새지 않게 한다.
 */

/** XML 특수문자 이스케이프 — 주소에 &·<가 들어오면 KML 이 깨진다. */
const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 좌표가 있는 건만 지도에 찍을 수 있다. */
const pickPoints = (records) => (Array.isArray(records) ? records : [])
  .map((r) => {
    const lat = num(r.lat ?? r._lat ?? r['위도']);
    const lng = num(r.lng ?? r._lng ?? r['경도']);
    if (lat === null || lng === null) return null;
    const seq = num(r.seq ?? r['배송순번'] ?? r['순번']);
    return {
      lat,
      lng,
      seq,
      address: String(r.address ?? r['주소'] ?? '').trim(),
      qty: num(r.qty ?? r['포수'] ?? r['수량']) || null,
      // ★PII 후보 — 기본적으로 출력하지 않는다.
      name: String(r.name ?? r['이름'] ?? '').trim(),
      phone: String(r.phone ?? r['휴대폰'] ?? r['전화번호'] ?? '').trim(),
      note: String(r.note ?? r['특이사항'] ?? '').trim(),
    };
  })
  .filter(Boolean)
  .sort((a, b) => (a.seq ?? 9999) - (b.seq ?? 9999));

/**
 * 지도 표시용 라벨.
 * 기본은 "순번. 주소" — 수령인이 누구인지는 지도에 필요 없다.
 * 기사는 순번과 주소로 찾아간다.
 */
const labelOf = (p, includeContact) => {
  const head = p.seq !== null ? `${p.seq}. ` : '';
  if (includeContact && p.name) return `${head}${p.name}`;
  return `${head}${p.address || '배송지'}`;
};

const descOf = (p, includeContact) => {
  const parts = [p.address];
  if (p.qty && p.qty > 1) parts.push(`${p.qty}포`);
  if (includeContact) {
    if (p.note) parts.push(`⚠ ${p.note}`);
    if (p.phone) parts.push(`📞 ${p.phone}`);
  }
  return parts.filter(Boolean).join(' / ');
};

/**
 * KML 생성 — 카카오맵 "나만의 지도"·구글어스에서 열린다.
 *
 * @param {object} input
 *  - records: 배송건(좌표 필요)
 *  - title: 지도 이름
 *  - color: 경로선 색(#RRGGBB)
 *  - includeContact: ★true 여야 이름·전화·특이사항이 들어간다(기본 false)
 * @returns {{ok, kml?, points, skipped, piiIncluded, warnings}}
 */
export function buildKml({ records = [], title = '배송경로', color = '#3b82f6', includeContact = false } = {}) {
  const points = pickPoints(records);
  const skipped = (Array.isArray(records) ? records.length : 0) - points.length;
  const warnings = [];

  if (!points.length) {
    return {
      ok: false, reason: 'no_coordinates', points: 0, skipped,
      piiIncluded: false,
      warnings: ['좌표가 있는 배송건이 없어 지도를 만들 수 없습니다.'],
    };
  }
  if (skipped > 0) {
    // 조용히 빠뜨리지 않는다 — 지도에 없는 건이 있다는 걸 알아야 한다.
    warnings.push(`좌표가 없어 ${skipped}건이 지도에서 빠졌습니다.`);
  }
  if (includeContact) {
    warnings.push('★수령인 이름·연락처가 포함된 파일입니다. 공유 시 개인정보가 함께 나갑니다.');
  }

  const placemarks = points.map((p) => `
  <Placemark>
    <name>${esc(labelOf(p, includeContact))}</name>
    <description>${esc(descOf(p, includeContact))}</description>
    <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
  </Placemark>`).join('');

  const line = points.length >= 2 ? `
  <Placemark>
    <name>${esc(title)} 경로</name>
    <Style><LineStyle><color>ff${String(color).replace('#', '') || '3b82f6'}</color><width>3</width></LineStyle></Style>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>${points.map((p) => `${p.lng},${p.lat},0`).join('\n        ')}</coordinates>
    </LineString>
  </Placemark>` : '';

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${esc(title)}</name>${placemarks}${line}
</Document>
</kml>
`;

  return { ok: true, kml, points: points.length, skipped, piiIncluded: Boolean(includeContact), warnings };
}

/**
 * GeoJSON 생성 — 다른 프로그램이 지도를 그릴 때 쓰는 표준 규격.
 * KML 과 같은 PII 원칙을 따른다.
 */
export function buildGeoJson({ records = [], title = '배송경로', includeContact = false } = {}) {
  const points = pickPoints(records);
  const skipped = (Array.isArray(records) ? records.length : 0) - points.length;

  const features = points.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: {
      seq: p.seq,
      label: labelOf(p, includeContact),
      address: p.address,
      qty: p.qty,
      ...(includeContact ? { name: p.name, phone: p.phone, note: p.note } : {}),
    },
  }));

  if (points.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
      properties: { label: `${title} 경로`, kind: 'route' },
    });
  }

  return {
    ok: points.length > 0,
    geojson: { type: 'FeatureCollection', features },
    points: points.length,
    skipped,
    piiIncluded: Boolean(includeContact),
  };
}

/**
 * 지도 공유 페이로드 — 앱이 지도를 그릴 때 필요한 최소 데이터.
 * 화면은 앱마다 달라도 이 규격은 하나다.
 */
export function buildMapPayload({ records = [], title = '배송경로', includeContact = false } = {}) {
  const points = pickPoints(records);
  if (!points.length) return { ok: false, reason: 'no_coordinates', bounds: null, points: [] };

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    ok: true,
    title,
    // 지도 초기 화면을 맞출 범위 — 앱이 매번 계산하면 제각각이 된다.
    bounds: {
      south: Math.min(...lats), north: Math.max(...lats),
      west: Math.min(...lngs), east: Math.max(...lngs),
    },
    center: {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    },
    points: points.map((p) => ({
      seq: p.seq, lat: p.lat, lng: p.lng,
      label: labelOf(p, includeContact),
      address: p.address, qty: p.qty,
      ...(includeContact ? { name: p.name, phone: p.phone, note: p.note } : {}),
    })),
    piiIncluded: Boolean(includeContact),
  };
}
