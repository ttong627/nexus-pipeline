// 2026-06-24 동명이인 주소 오염 복구 — 동대문구 2026-06 확정 피해 2건.
//   근거: 동명이인_주소오염_재발방지_설계.md §5 (전수감사: 동대문 53·중원 32건 중 본번상이 2건)
//   복구 기준: base_lists 강키(이름+전화끝8) 값 + 3자 대조(저번달 이력·실존주소 확인 완료)
//     · 김옥순(1069): 이력 2026-06 "천호대로 26" 일치 · 주민센터 수령 요청자 → 특이사항에 명시
//     · 심광흠(0020): 현재 "제기로 26"은 카카오 주소검색 미실존, base "제기로2가길 26" 실존 확인
//   안전: 현재값이 감사 시점과 다르면 스킵(드리프트 가드). 좌표는 카카오로 재지오코딩(실패 시 좌표만 보류).
//   실행: node scripts/restore-doppelganger-damage.mjs           # dry-run
//         node scripts/restore-doppelganger-damage.mjs --write   # 실제 복구
import fs from 'node:fs';
import admin from 'firebase-admin';

const WRITE = process.argv.includes('--write');
const CITY = '서울특별시 동대문구';
const MONTH = '2026-06';

// 카카오 키(좌표 재지오코딩용) — .env에서 읽기만, 값 출력 금지
const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const KAKAO = (env.match(/VITE_KAKAO_REST_KEY=(.+)/) || [])[1]?.trim() || '';

// 복구 대상 (전수감사 확정분 — 드리프트 가드용 expectCurrent 포함)
const TARGETS = [
  {
    id: '5c64ce98-4b48-42d5-8d9d-7fb49e527992',
    name: '김옥순', phone: '010-9923-1069',
    expectCurrent: '천호대로 55-3, 지층 오른쪽 (신설동)',
    restore: {
      주소: '천호대로 26, (신설동, 신설동역자이르네)',
      roadAddr: '천호대로 26', detailAddr: '', parenInfo: '신설동, 신설동역자이르네',
    },
    geocodeQuery: '서울특별시 동대문구 천호대로 26',
    appendNote: '주민센터 수령 요청(구청 명단: 신설동주민센터 — 천호대로 26)',
  },
  {
    id: '6a20eec1-81ac-4193-8a46-015436722e76',
    name: '심광흠', phone: '010-5190-0020',
    expectCurrent: '제기로 26, 흥릉동아파트 105- 605호 (길)',
    restore: {
      주소: '제기로2가길 26, 흥릉동아파트 105- 605호 (청량리동, 길)',
      roadAddr: '제기로2가길 26', detailAddr: '흥릉동아파트 105- 605호', parenInfo: '청량리동, 길',
    },
    geocodeQuery: '서울특별시 동대문구 제기로2가길 26',
    appendNote: '',
  },
];

const geocode = async (q) => {
  if (!KAKAO) return null;
  try {
    const r = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}&size=1`,
      { headers: { Authorization: `KakaoAK ${KAKAO}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const d = (await r.json()).documents?.[0];
    return d?.x && d?.y ? { lat: parseFloat(d.y), lng: parseFloat(d.x) } : null;
  } catch { return null; }
};

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'))) });
const db = admin.firestore();
const col = db.collection('cloud_lists').doc(CITY).collection('months').doc(MONTH).collection('records');

console.log(`동명이인 오염 복구 — ${CITY} ${MONTH} · ${WRITE ? '★WRITE★' : 'dry-run'}\n`);
let done = 0, skip = 0;
for (const t of TARGETS) {
  const doc = await col.doc(t.id).get();
  if (!doc.exists) { console.log(`✗ ${t.name}: 문서 없음(${t.id}) — 스킵`); skip++; continue; }
  const cur = doc.data();
  if ((cur.휴대폰 || '') !== t.phone) { console.log(`✗ ${t.name}: 전화 불일치(${cur.휴대폰}) — 스킵`); skip++; continue; }
  if ((cur.주소 || '').trim() !== t.expectCurrent) {
    console.log(`✗ ${t.name}: 현재 주소가 감사 시점과 다름 — 드리프트 가드 스킵\n    현재: ${cur.주소}\n    예상: ${t.expectCurrent}`);
    skip++; continue;
  }
  const coord = await geocode(t.geocodeQuery);
  const newNote = t.appendNote
    ? [String(cur.특이사항 || '').trim(), t.appendNote].filter(Boolean).join(' ')
    : null;
  console.log(`◆ ${t.name}(${t.phone})\n    이전: ${cur.주소}\n    복구: ${t.restore.주소}` +
    (coord ? `\n    좌표: ${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)} (기존 ${Number(cur.lat).toFixed(6)}, ${Number(cur.lng).toFixed(6)})` : '\n    좌표: 지오코딩 실패 — 좌표는 보류') +
    (newNote !== null ? `\n    특이사항: "${newNote}"` : ''));
  if (!WRITE) { done++; continue; }
  const upd = {
    ...t.restore,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    repairTool: 'restore-doppelganger-damage@2026-07-10',
    ...(coord ? { lat: coord.lat, lng: coord.lng, 좌표출처: 'kakao', 좌표수정일시: new Date().toISOString() } : {}),
    ...(newNote !== null ? { 특이사항: newNote } : {}),
  };
  await col.doc(t.id).update(upd);
  console.log('    ✅ 기록 완료');
  done++;
}
console.log(`\n완료 — 처리 ${done}건 · 스킵 ${skip}건 ${WRITE ? '' : '(dry-run)'}`);
await admin.app().delete().catch(() => {});
process.exit(0);
