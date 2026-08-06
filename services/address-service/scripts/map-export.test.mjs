/**
 * 배송지도 내보내기 검증 (모듈 ⑩).
 *
 * ★★이 테스트의 최우선 목적은 **PII 유출 차단**이다.
 *   기존 KML 생성기(`functions/index.js buildKml`)는 수령인 이름·휴대폰·특이사항을
 *   그대로 지도 파일에 넣었다. KML 은 카카오맵 "나만의 지도"에 업로드되고 **링크로 공유**된다.
 *   파일 하나가 새면 명단이 통째로 샌다.
 *   여기서는 **기본이 비식별**이고, 포함하려면 명시해야 하며, 포함하면 그 사실을 알린다.
 *
 * 실행: node --test scripts/map-export.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildGeoJson, buildKml, buildMapPayload } from '../src/routing/mapExport.js';

/** PII 가 들어간 배송건(실제 명단 모양). */
const RECORDS = [
  { id: 1, seq: 2, 이름: '홍길동', 주소: '경기 부천시 중동로 100', 포수: 3,
    휴대폰: '010-1234-5678', 특이사항: '문앞', lat: 37.5030, lng: 126.7660 },
  { id: 2, seq: 1, 이름: '김철수', 주소: '경기 부천시 소사로 77', 포수: 1,
    휴대폰: '010-9999-8888', 특이사항: '경비실', lat: 37.4820, lng: 126.7955 },
  { id: 3, seq: 3, 이름: '이영희', 주소: '좌표없는집', 포수: 1 },
];

/* ── ★PII 차단 ─────────────────────────────────── */

test('★기본은 비식별 — 이름·전화·특이사항이 KML 에 없다', () => {
  const out = buildKml({ records: RECORDS });
  assert.equal(out.ok, true);
  assert.equal(out.piiIncluded, false);
  for (const pii of ['홍길동', '김철수', '010-1234-5678', '010-9999-8888', '문앞', '경비실']) {
    assert.equal(out.kml.includes(pii), false,
      `KML 에 개인정보가 들어갔다: ${pii} — 이 파일은 링크로 공유된다`);
  }
  // 주소·순번은 들어가야 한다(기사가 찾아가야 하므로)
  assert.ok(out.kml.includes('경기 부천시 중동로 100'));
  assert.ok(out.kml.includes('1. '), '순번이 없으면 기사가 순서를 모른다');
});

test('★includeContact 를 명시해야만 들어가고, 들어가면 알려준다', () => {
  const out = buildKml({ records: RECORDS, includeContact: true });
  assert.equal(out.piiIncluded, true, '포함 사실을 숨기면 안 된다');
  assert.ok(out.kml.includes('홍길동'));
  assert.ok(out.kml.includes('010-1234-5678'));
  assert.ok(out.warnings.some((w) => w.includes('개인정보')),
    '개인정보가 든 파일임을 경고하지 않으면 무심코 공유한다');
});

test('★GeoJSON 도 같은 원칙을 따른다', () => {
  const off = buildGeoJson({ records: RECORDS });
  const json = JSON.stringify(off.geojson);
  assert.equal(off.piiIncluded, false);
  for (const pii of ['홍길동', '010-1234-5678', '문앞']) {
    assert.equal(json.includes(pii), false, `GeoJSON 에 개인정보: ${pii}`);
  }
  const on = buildGeoJson({ records: RECORDS, includeContact: true });
  assert.ok(JSON.stringify(on.geojson).includes('홍길동'));
  assert.equal(on.piiIncluded, true);
});

test('★지도 페이로드도 마찬가지', () => {
  const out = buildMapPayload({ records: RECORDS });
  assert.equal(out.piiIncluded, false);
  assert.equal(JSON.stringify(out.points).includes('홍길동'), false);
});

/* ── KML 구조 ──────────────────────────────────── */

test('순번대로 정렬된다 — 지도 경로선이 방문 순서를 따라야 한다', () => {
  const out = buildKml({ records: RECORDS });
  // seq 1(소사로) 이 seq 2(중동로) 보다 먼저 나와야 한다
  assert.ok(out.kml.indexOf('소사로 77') < out.kml.indexOf('중동로 100'));
});

test('2건 이상이면 경로선(LineString)이 생긴다', () => {
  const out = buildKml({ records: RECORDS });
  assert.ok(out.kml.includes('<LineString>'));
  const single = buildKml({ records: [RECORDS[0]] });
  assert.equal(single.kml.includes('<LineString>'), false, '1건에 경로선은 의미가 없다');
});

test('★XML 특수문자를 이스케이프한다 — 주소에 & 가 있으면 KML 이 깨진다', () => {
  const out = buildKml({
    records: [{ seq: 1, 주소: 'A&B <상가> "1층"', lat: 37.5, lng: 127.0 }],
  });
  assert.ok(out.kml.includes('&amp;'), '& 가 이스케이프되지 않았다');
  assert.ok(out.kml.includes('&lt;'), '< 가 이스케이프되지 않았다');
  // 깨지지 않은 XML 인지 대략 확인(태그 균형)
  assert.equal((out.kml.match(/<Placemark>/g) || []).length,
    (out.kml.match(/<\/Placemark>/g) || []).length);
});

test('좌표 단위는 경도,위도 순서다(KML 규격) — 뒤집으면 아프리카로 간다', () => {
  const out = buildKml({ records: [{ seq: 1, 주소: 'x', lat: 37.5030, lng: 126.7660 }] });
  assert.ok(out.kml.includes('<coordinates>126.766,37.503,0</coordinates>'), out.kml);
});

/* ── 빠진 건을 숨기지 않는다 ────────────────────── */

test('★좌표 없는 건은 지도에서 빠지고, 그 사실을 말한다', () => {
  const out = buildKml({ records: RECORDS });
  assert.equal(out.points, 2);
  assert.equal(out.skipped, 1);
  assert.ok(out.warnings.some((w) => w.includes('1건')),
    '지도에 없는 건이 있다는 걸 모르면 그 집은 배송에서 누락된다');
});

test('좌표가 하나도 없으면 지도를 만들지 않는다', () => {
  const out = buildKml({ records: [{ 주소: '좌표없음' }] });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no_coordinates');
  assert.equal(out.kml, undefined, '빈 지도를 만들어 주면 안 된다');
});

test('빈 입력에도 터지지 않는다', () => {
  assert.equal(buildKml({}).ok, false);
  assert.equal(buildGeoJson({}).ok, false);
  assert.equal(buildMapPayload({}).ok, false);
});

/* ── 지도 페이로드 ─────────────────────────────── */

test('지도 범위(bounds)와 중심을 계산한다 — 앱마다 따로 계산하면 제각각이 된다', () => {
  const out = buildMapPayload({ records: RECORDS });
  assert.equal(out.ok, true);
  assert.ok(out.bounds.south <= out.bounds.north);
  assert.ok(out.bounds.west <= out.bounds.east);
  assert.ok(out.center.lat > out.bounds.south && out.center.lat < out.bounds.north);
});

test('영문 키 명단도 처리한다', () => {
  const out = buildKml({
    records: [{ seq: 1, address: '경기 부천시 중동로 100', qty: 2, lat: 37.5, lng: 127.0 }],
  });
  assert.equal(out.ok, true);
  assert.ok(out.kml.includes('경기 부천시 중동로 100'));
});
