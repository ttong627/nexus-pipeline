#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  C-2 조회 API 실측 검증 (읽기 전용) — 설계서 좌표관리_설계.md §6
//
//  ★검증하는 것: 조회 경로가 만드는 coord_key 가 이관(C-4)이 만든 coord_key 와
//    **실제로 같은가**. 둘은 서로 다른 출처로 앵커를 구한다 —
//      이관: address_core / building_core 의 road_code
//      조회: road_codes 의 road_code (address_core 는 77.5% 결손이라 못 쓴다)
//    여기서 어긋나면 조회는 **영원히 빈손**이면서 에러도 안 난다. A-35 에서 겪은
//    "키가 어긋나 학습분이 안 걸리던" 사고와 같은 종류다. 그래서 배포 전에 센다.
//
//  ★서버와 같은 코드(src/coords/coordQuery.js)를 부른다. 베껴 쓰면
//    "검증 통과 · 운영 실패"가 난다.
// ══════════════════════════════════════════════════════════════════
import { config } from '../src/config.js';
import { closePool, query } from '../src/db.js';
import { resolveCoords, coordStatus } from '../src/coords/coordQuery.js';

const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || 300);
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const out = (l, v) => console.log(`${String(l).padEnd(46)} ${v}`);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

try {
  console.log(`══════ ① 앵커 왕복 검증 (표본 ${num(LIMIT)}건) ══════`);
  // 이관이 만든 행을 그대로 되읽어 조회 경로에 넣는다.
  const { rows: samples } = await query(`
    SELECT coord_key, road_address, sigungu, building_name, is_apartment
    FROM ${config.dbSchema}.building_coord
    ORDER BY updated_at DESC LIMIT $1`, [LIMIT]);
  out('저장소에서 뽑은 표본', num(samples.length));
  if (!samples.length) {
    console.log('building_coord 가 비어 있습니다. C-1·C-4 를 먼저 적용하세요.');
  } else {
    const resolved = await resolveCoords(
      samples.map((s) => ({ roadAddress: s.road_address, sigungu: s.sigungu })),
    );
    let same = 0; let diff = 0; let noAnchor = 0;
    const mismatches = [];
    resolved.forEach((r, i) => {
      if (r.quality === 'no_anchor') { noAnchor++; mismatches.push(['앵커실패', samples[i], r]); return; }
      if (r.coordKey === samples[i].coord_key) { same++; return; }
      diff++; mismatches.push(['키불일치', samples[i], r]);
    });
    out('✅ 이관 키와 동일', `${num(same)}  (${pct(same, samples.length)})`);
    out('❌ 키 불일치', num(diff));
    out('❌ 앵커 생성 실패(도로 특정 불가)', num(noAnchor));
    if (mismatches.length) {
      console.log('\n  불일치 표본(최대 10):');
      for (const [why, s, r] of mismatches.slice(0, 10)) {
        console.log(`    [${why}] ${s.road_address} | ${s.sigungu}`);
        console.log(`        이관=${s.coord_key}  조회=${r.coordKey || '(없음)'}`);
      }
    }

    console.log('\n══════ ② 실제 조회 결과 — 동(棟) 좌표가 나오는가 ══════');
    // 동이 가장 많은 단지로 조회해 본다(아파트 경로 실검증).
    const { rows: apt } = await query(`
      SELECT b.road_address, b.sigungu, b.building_name, d.dong_no
      FROM ${config.dbSchema}.building_coord b
      JOIN ${config.dbSchema}.building_dong_coord d USING (coord_key)
      WHERE d.matched = 'dong'
      ORDER BY b.updated_at DESC LIMIT 5`);
    const aptRes = await resolveCoords(
      apt.map((a) => ({ roadAddress: a.road_address, sigungu: a.sigungu, dongNo: a.dong_no })),
    );
    aptRes.forEach((r, i) => {
      const d = r.dong;
      console.log(`  ${apt[i].road_address} | ${apt[i].dong_no}동`);
      console.log(`     → ${d ? `${d.lat},${d.lng} (${d.floors ?? '?'}층, ${d.source})` : '동 좌표 없음'}`
        + ` | 보유동 ${r.dongCount}개 | quality=${r.quality}`);
    });
    const gotDong = aptRes.filter((r) => r.dong).length;
    out('동 좌표 회수', `${num(gotDong)}/${num(aptRes.length)}`);

    console.log('\n══════ ③ 존재하지 않는 주소는 조용히 지어내지 않는가 (A-36) ══════');
    const guard = await resolveCoords([
      { roadAddress: '경기도 시흥시 없는길 9999', sigungu: '시흥시' },      // 없는 도로
      { roadAddress: '삼작로256번길 16' },                                  // 지자체 없음 → 스킵돼야
      { roadAddress: '아무말대잔치', sigungu: '시흥시' },                    // 파싱 불가
    ]);
    for (const g of guard) {
      out(`  "${g.roadAddress}"`, `quality=${g.quality} · key=${g.coordKey || '(없음)'} · center=${g.center ? '있음' : '없음'}`);
    }
  }

  console.log('\n══════ ④ 좌표 현황 (/v1/coords/status) ══════');
  const st = await coordStatus('');
  if (!st) { out('  status', '좌표 테이블 없음'); } else {
    out('  건물 총', num(st.total));
    out('   ├ 입구좌표 보유', num(st.with_entrance));
    out('   ├ 중심좌표 보유', `${num(st.with_center)}  ← C-3 채움 전이라 0 이 정상`);
    out('   ├ 동좌표 보유 건물 / 동 행', `${num(st.with_dong)} / ${num(st.dong_rows)}`);
    out('   ├ 내비용 점(입구·중심) 없음', num(st.no_point));
    out('   └ 좌표 전무(동까지 없음)', num(st.noCoordAtAll));
    if (st.pendingSample?.length) console.log(`  미보유 표본: ${st.pendingSample.slice(0, 3).join(' · ')}`);
  }
  console.log('\n검증 끝.');
} finally {
  await closePool();
}
