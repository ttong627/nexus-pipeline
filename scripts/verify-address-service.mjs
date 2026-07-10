// 주소매칭 서비스 복구 검증 — 배포 직후 실행 (읽기 전용)
//   ① 서비스 응답 ② 실측 매칭 3종(사고 관련 주소 포함) ③ DB 상태
//   사용: node scripts/verify-address-service.mjs [URL]
const URL_ARG = process.argv[2];
const envUrl = (await import('node:fs')).readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .match(/VITE_ADDRESS_MATCH_API_URL=(.+)/)?.[1]?.trim();
const BASE = (URL_ARG || envUrl || '').replace(/\/+$/, '');
if (!BASE) { console.error('URL 없음 (.env VITE_ADDRESS_MATCH_API_URL 또는 인자)'); process.exit(1); }
console.log(`대상: ${BASE}\n`);

const post = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

let fail = 0;
// 1) DB 상태
try {
  const r = await fetch(`${BASE}/v1/address/db-status`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => null);
  console.log(`① db-status: HTTP ${r.status} — ${JSON.stringify(j)?.slice(0, 160)}`);
  if (!r.ok) fail++;
} catch (e) { console.log(`① db-status 실패: ${e.message}`); fail++; }

// 2) 매칭 3종 — 사고 케이스 주소 포함
const cases = [
  { q: '서울특별시 동대문구 천호대로 26', city: '서울특별시 동대문구', expect: '천호대로 26' },
  { q: '동대문구 제기로2가길 26', city: '서울특별시 동대문구', expect: '제기로2가길 26' },
  { q: '경기 안양시 동안구 관악대로 287', city: '안양시', expect: '관악대로 287' },
];
for (const c of cases) {
  try {
    const { status, json } = await post('/v1/address/match', { query: c.q, cityLabel: c.city, allowJusoFallback: false });
    const road = json?.data?.roadAddrPart1 || json?.data?.roadAddr || '(null)';
    const ok = status === 200 && road.includes(c.expect);
    console.log(`② ${ok ? '✓' : '✗'} match "${c.q}" → ${road} (HTTP ${status}, source=${json?.data?._matchSource || '?'})`);
    if (!ok) fail++;
  } catch (e) { console.log(`② ✗ match "${c.q}" 오류: ${e.message}`); fail++; }
}

console.log(`\n${fail === 0 ? '✅ 전건 통과 — 서비스 정상' : `❌ 실패 ${fail}건`}`);
process.exit(fail === 0 ? 0 : 1);
