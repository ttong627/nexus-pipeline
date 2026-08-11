#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  주소 1건 좌표 정밀 진단 (읽기 전용)
//
//  왜: 여월휴먼시아2단지(부천 여월로 65)의 동 좌표가 2단계 BBOX 확장을 거쳐도
//  전부 centroid 로 떨어졌다. 가설이 둘인데 눈으로 갈라야 한다.
//    ① 지오코딩 대표점이 단지를 벗어나 있다  → 좌표 문제
//    ② VWorld LT_C_SPBD 에 그 단지가 없다     → 데이터 소스 한계
//
//  결정적 검사: **저장된 동 좌표 위치에서 BBOX 를 다시 본다.**
//    거기서 단지가 나오면 ①(대표점이 틀림), 안 나오면 ②(소스에 없음).
//  같은 자리를 Kakao 로도 지오코딩해 세 점(저장중심·VWorld·Kakao)을 나란히 잰다.
// ══════════════════════════════════════════════════════════════════
import { config } from '../src/config.js';
import { closePool, withClient } from '../src/db.js';
import { geocodeRoad, getBuildingsNear } from '../src/vworld.js';
import { BBOX_NARROW_DEG, BBOX_WIDE_DEG } from '../src/coords/coordFill.js';

const arg = (n, d = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const ADDR = arg('address', '경기도 부천시 오정구 여월로 65');
const S = config.dbSchema;
const nameKeyLocal = (v) => String(v ?? '').replace(/\s+/g, '');
const out = (l, v) => console.log(`${String(l).padEnd(34)} ${v}`);

// 두 좌표 사이 거리(m)
const distM = (a, b) => {
  if (!a || !b) return null;
  const R = 6371000; const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

const kakaoGeocode = async (addr) => {
  if (!config.kakaoRestKey) return null;
  const url = new URL('https://dapi.kakao.com/v2/local/search/address.json');
  url.searchParams.set('query', addr);
  url.searchParams.set('size', '1');
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${config.kakaoRestKey}` } });
  const doc = res.ok ? (await res.json()).documents?.[0] : null;
  return doc?.y ? { lat: Number.parseFloat(doc.y), lng: Number.parseFloat(doc.x) } : null;
};

const showNear = async (label, pt, radius) => {
  const near = await getBuildingsNear(pt.lng, pt.lat, radius);
  const named = near.filter((b) => b.buildName);
  const hit = named.filter((b) => (b.buildName || '').replace(/\s+/g, '').includes('여월휴먼시아'));
  out(`  ${label} 건물 수`, `${near.length} (이름 있는 것 ${named.length})`);
  out('  ★여월휴먼시아 포함?', hit.length ? `있음 ${hit.length}건` : '없음');
  const names = [...new Set(named.map((b) => b.buildName).filter(Boolean))].slice(0, 10);
  console.log(`  ▸ 이름 표본: ${names.join(' / ') || '(없음)'}`);
  return hit;
};

await withClient(async (c) => {
  await c.query(`SET search_path TO ${S}, public`);
  console.log(`══ 좌표 진단: ${ADDR} ══`);

  const { rows } = await c.query(`
    SELECT coord_key, building_name, center_lat, center_lng, center_source
    FROM ${S}.building_coord WHERE road_address = $1 LIMIT 1`, [ADDR]);
  if (!rows[0]) { console.log('building_coord 에 없음'); return; }
  const b = rows[0];
  const stored = b.center_lat != null ? { lat: Number(b.center_lat), lng: Number(b.center_lng) } : null;
  out('건물명', b.building_name || '-');
  out('저장된 중심', stored ? `${stored.lat},${stored.lng} (${b.center_source})` : '없음');

  const vw = await geocodeRoad(ADDR);
  const kk = await kakaoGeocode(ADDR);
  out('VWorld 지오코딩', vw ? `${vw.lat},${vw.lng}` : '실패');
  out('Kakao 지오코딩', kk ? `${kk.lat},${kk.lng}` : '실패');
  out('저장중심 ↔ VWorld', `${distM(stored, vw) ?? '-'} m`);
  out('저장중심 ↔ Kakao', `${distM(stored, kk) ?? '-'} m`);
  out('VWorld ↔ Kakao', `${distM(vw, kk) ?? '-'} m`);

  const { rows: dr } = await c.query(`
    SELECT dong_no, lat, lng, matched FROM ${S}.building_dong_coord
    WHERE coord_key = $1 ORDER BY dong_no LIMIT 4`, [b.coord_key]);
  console.log('\n── 저장된 동 좌표(구 캐시 이관분) ──');
  for (const d of dr) {
    out(`  동 ${d.dong_no} (${d.matched})`, `${d.lat},${d.lng} · 중심에서 ${distM(stored, { lat: Number(d.lat), lng: Number(d.lng) })} m`);
  }

  console.log('\n── ① 저장 중심에서 본 BBOX ──');
  if (stored) {
    await showNear('좁게(±250m)', stored, BBOX_NARROW_DEG);
    await showNear('넓게(±700m)', stored, BBOX_WIDE_DEG);
  }

  // ★결정적 검사 — 저장된 동 좌표 위치에서 보면 단지가 보이는가
  if (dr[0]) {
    const at = { lat: Number(dr[0].lat), lng: Number(dr[0].lng) };
    console.log(`\n── ② ★동 ${dr[0].dong_no} 좌표 위치에서 본 BBOX (결정적) ──`);
    await showNear('좁게(±250m)', at, BBOX_NARROW_DEG);
  }

  // ★결정적 2 — VWorld 가 그 단지 건물에 **동 번호를 실어 주는가**.
  //   이름은 맞는데 동 번호가 비어 있으면 byDong 필터에서 전부 빠진다(채택 이전 문제).
  const at = vw || stored;
  if (at) {
    console.log('\n── ③ ★여월휴먼시아 건물의 원본 필드 (동 번호가 있는가) ──');
    for (const radius of [BBOX_NARROW_DEG, BBOX_WIDE_DEG]) {
      const near = await getBuildingsNear(at.lng, at.lat, radius);
      const mine = near.filter((x) => nameKeyLocal(x.buildName).includes('여월휴먼시아'));
      out(`  반경 ${radius}`, `여월휴먼시아 ${mine.length}건 · 동번호 있는 것 ${mine.filter((x) => x.dongNo).length}건`);
      for (const m of mine.slice(0, 6)) {
        console.log(`    buld_nm='${m.buildName}' | buld_nm_dc='${m.name}' | 파싱동='${m.dongNo}' | ${m.floors ?? '-'}층 | sigungu='${m.sigungu}'`);
      }
    }
  }

  console.log('\n══ 판정 ══');
  console.log('  ②에서 여월휴먼시아가 보이면  → 지오코딩 대표점이 단지를 벗어난 것(좌표 문제)');
  console.log('  ②에서도 안 보이면           → VWorld LT_C_SPBD 에 그 단지가 없는 것(소스 한계)');
}).finally(closePool);
