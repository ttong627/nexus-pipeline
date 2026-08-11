#!/usr/bin/env node
// 동 좌표 채움 검증용 프로브 (읽기 전용).
// "동 0건"이 규칙이 정상 기각한 것인지, 내가 넣은 동 번호가 실재하지 않아서인지 가른다.
// 실제 존재하는 동 번호와 VWorld BBOX 가 그 자리에서 무엇을 보는지 함께 찍는다.
import { config } from '../src/config.js';
import { closePool, withClient } from '../src/db.js';
import { geocodeRoad, getBuildingsNear } from '../src/vworld.js';
import { acceptDongCandidate } from '../src/coords/coordFill.js';

const S = config.dbSchema;
const out = (l, v) => console.log(`${String(l).padEnd(34)} ${v}`);

await withClient(async (c) => {
  await c.query(`SET search_path TO ${S}, public`);
  // 동 행이 있는 아파트 3곳
  const { rows } = await c.query(`
    SELECT b.coord_key, b.road_address, b.building_name, b.center_lat, b.center_lng,
           array_agg(d.dong_no ORDER BY d.dong_no) AS dongs,
           array_agg(DISTINCT d.matched) AS matched
    FROM ${S}.building_coord b JOIN ${S}.building_dong_coord d USING (coord_key)
    GROUP BY b.coord_key, b.road_address, b.building_name, b.center_lat, b.center_lng
    ORDER BY count(*) DESC LIMIT 3`);

  for (const r of rows) {
    console.log(`\n══ ${r.road_address} | ${r.building_name || '-'} ══`);
    out('  저장된 동 번호', (r.dongs || []).join(', '));
    out('  matched 상태', (r.matched || []).join(', '));

    const center = (r.center_lat != null)
      ? { lat: Number(r.center_lat), lng: Number(r.center_lng) }
      : await geocodeRoad(r.road_address);
    if (!center) { out('  중심 좌표', '없음 — BBOX 불가'); continue; }

    const near = await getBuildingsNear(center.lng, center.lat);
    out('  BBOX 건물 수', near.length);
    const withDong = near.filter((b) => b.dongNo);
    out('  동 번호가 읽힌 건물', withDong.length);
    console.log('  ▸ VWorld 가 본 것(최대 8):');
    for (const b of withDong.slice(0, 8)) {
      console.log(`      동 '${b.dongNo}' | ${b.buildName || '-'} | ${b.floors ?? '-'}층`);
    }
    // 실제 저장된 동 번호로 채택을 시도해 본다 — 규칙이 기각하는지, 후보가 없는지 가른다.
    for (const want of (r.dongs || []).slice(0, 3)) {
      const hit = acceptDongCandidate(near, { wantDong: want, complexName: r.building_name || '' });
      const cands = near.filter((b) => String(b.dongNo) === String(want)).length;
      console.log(`  ▸ 동 '${want}' → 후보 ${cands}개 · 채택 ${hit ? '성공' : '기각'}`);
    }
  }
}).finally(closePool);
