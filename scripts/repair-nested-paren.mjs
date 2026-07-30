// 괄호 중첩 오염 주소 수리 — 기본 DRY-RUN(쓰기 없음). 실제 반영은 --write.
//   배경(2026-07-30 실측): 건물명에 괄호가 포함되면 A-11 조립·파싱이 깨져 재정제마다 잔재가
//   누적됐다. 엔진은 P0에서 depth 인식으로 근본수리했고, 이 스크립트는 이미 오염된 저장값을 고친다.
//
//   형 방침(엄수):
//     · 명단 원문 삭제 금지 — 괄호·상세에서 빠지는 의미있는 텍스트는 특이사항으로 **이관**
//     · 동·호수 손실 금지 — guardAddressDetail 통과 필수
//     · 억지 재조립 금지 — 법정동·건물명을 확정할 수 없으면 그 레코드는 건드리지 않음
//     · 이름·전화 등 PII는 읽지도 출력하지도 않음
//
//   사용:
//     node scripts/repair-nested-paren.mjs                      # 전체 dry-run
//     node scripts/repair-nested-paren.mjs "서울특별시 동대문구"   # 특정 시군구 dry-run
//     node scripts/repair-nested-paren.mjs --write               # 실제 반영(형 확인 후)
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import {
  parseDisplayedAddress,
  splitParenInner,
  balanceParens,
  protectParenBlocks,
  guardAddressDetail,
  cleanAddressPiece,
} from '../src/utils/addressFormat.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const ONLY_CITY = args.find(a => !a.startsWith('--')) || '';
const SAMPLE_LIMIT = 25;

const norm = (v) => cleanAddressPiece(v);
// 중복 판정용 비교키 — 공백뿐 아니라 괄호·기호까지 제거해야 `DH(디에이치)주상복합빌딩` ⊇ `DH디에이치` 를 잡는다.
// (이 정규화를 빼면 건물명 조각이 특이사항으로 중복 이관돼 값이 누적된다)
const cmpKey = (v) => String(v || '').replace(/[\s()[\]·,./\\-]/g, '');
// A-22 참고주소 블록 — 통째로 보존해야 하는 원문(삭제 금지)
const REF_BLOCK_RE = /\[참고:[^\]]*\]/g;
// 상세주소로 무조건 지켜야 하는 토큰 — 동(棟)·호·층. 건물명이 '동'으로 끝나도(행복드림가동) 여기서 보호된다.
const DETAIL_TOKEN_RE = /^(?:지하|지층|옥탑)?(?:\d+(?:-\d+)?|[A-Za-z]|[가나다라마바사아자차카타파하])?\s*(?:동|호|층)$|\d+\s*(?:동|호|층)$|^\d+-$/;

// 오염 판정 — **좁게** 본다(오판이 정상 주소를 훼손하므로).
//   ① 상세부에 괄호 기호 잔재  ② 전체 괄호 짝 불균형  ③ 괄호 안에 같은 법정동이 2회 이상
//   ※ '괄호 요소가 3개' / '동으로 끝나는 토큰이 2개' 같은 판정은 오판(건물명 '행복드림가동'·
//     '진양리더빌1동'을 법정동으로 오인)이므로 쓰지 않는다.
const diagnose = (addr, legalDongField = '') => {
  const p = parseDisplayedAddress(addr);
  const reasons = [];
  const detailNoRef = p.detail.replace(REF_BLOCK_RE, ' ');
  if (/[()]/.test(detailNoRef)) reasons.push('상세에 괄호 잔재');
  const open = (addr.match(/\(/g) || []).length;
  const close = (addr.match(/\)/g) || []).length;
  if (open !== close) reasons.push(`괄호 짝 불균형(${open}:${close})`);
  const parts = splitParenInner(p.paren);
  const ld = norm(legalDongField);
  if (ld && parts.filter(t => norm(t) === ld).length > 1) reasons.push('괄호에 법정동 중복');
  return { parsed: p, parts, reasons };
};

// 건물명 후보 판별 — 정식 건물명 키워드(백필 기존 패턴 재사용)
const BLDG_KW = /(아파트|빌라|빌리지|빌딩|타워|타운|하우스|힐스|캐슬|팰리스|자이|푸르지오|래미안|더샵|편한세상|e편한|아이파크|센트럴|리버|파크|맨션|연립|주택|센터|프라자|플라자|오피스텔|스테이트|시티|카운티|스카이|가든|테라스|하임|에코빌|현대|삼성|롯데|대우|한신|우성|주공|고시텔|빌$|빌\b)/;

const repairOne = (r) => {
  const oldAddr = norm(r.주소);
  if (!oldAddr) return null;
  const fieldDong = norm(r.legalDong || r.법정동);
  const { parsed, parts, reasons } = diagnose(oldAddr, fieldDong);
  if (!reasons.length) return null;
  if (!parsed.road) return { skip: '도로명 없음', oldAddr };

  // ① 법정동 — DB 백필로 정식화된 필드 우선. 없으면 괄호 토큰 중 필드와 무관해 확정 불가 → 보류.
  const legalDong = fieldDong || (parts.length === 1 ? parts[0] : '');
  if (!legalDong) return { skip: '법정동 확정 불가', oldAddr };

  // ② 건물명 — 필드 우선, 없으면 괄호에서 법정동 아닌 토큰 중 건물명 키워드 매칭.
  //    건물명 필드 자체에 법정동이 섞인 경우(예 '성정동, 소나무빌')는 접두 법정동을 떼낸다.
  const stripDong = (v) => norm(String(v || '').replace(new RegExp(`^${legalDong}\\s*,\\s*`), ''));
  const fieldBldg = stripDong(r.buildingName || r.건물명);
  const others = parts.filter(t => norm(t) !== legalDong);
  const guessBldg = others.find(t => BLDG_KW.test(t)) || '';
  const buildingName = balanceParens(fieldBldg || guessBldg);
  const bldgKey = cmpKey(buildingName);
  const inBuilding = (v) => Boolean(bldgKey && cmpKey(v) && bldgKey.includes(cmpKey(v)));

  // ③ 상세 재구성 — A-22 참고블록은 원형 보존, 동·호·층 토큰은 무조건 유지.
  //    제거되는 것 중 건물명·법정동 조각이 아닌 값만 특이사항으로 이관(원문 삭제 금지).
  const refBlocks = parsed.detail.match(REF_BLOCK_RE) || [];
  const detailBody = parsed.detail.replace(REF_BLOCK_RE, ' ');
  const kept = [];
  const moved = [];
  for (const tok of detailBody.split(/\s+/).filter(Boolean)) {
    const bare = tok.replace(/[()]/g, '').trim();
    if (!bare) continue;                                   // 괄호 기호만 → 버림(원문 아님)
    if (DETAIL_TOKEN_RE.test(bare)) { kept.push(bare); continue; }   // 동·호·층 → 상세 유지
    if (inBuilding(bare)) continue;                        // 건물명 조각 잔재 → 버림(건물명에 이미 있음)
    if (cmpKey(bare) === cmpKey(legalDong)) continue;     // 법정동 중복 → 버림
    if (/^\d+-$/.test(bare)) { kept.push(bare); continue; } // A-10 패딩 잔여("1-") 유지
    if (bare.length >= 2) moved.push(bare);                // 그 외 의미값 → 특이사항 이관
  }

  // ④ 괄호에서 빠지는 값도 이관 대상(예 '5층 식당보관', '8652').
  //    ★오염 레코드는 괄호 짝이 깨져 파싱 결과를 그대로 믿을 수 없다(중첩 블록이 통째로 한 토큰이 됨).
  //      그래서 괄호 블록을 걷어낸 '알맹이'만 후보로 삼는다. 그 알맹이가 건물명·법정동에 포함되면 버린다.
  //      예 '디에이치 (고강동, DH(디에이치)주상복합빌딩)' → 알맹이 '디에이치' → 건물명에 포함 → 이관 안 함
  //         '8652 (신설동)' → 알맹이 '8652' → 이관 / '5층 식당보관' → 그대로 이관
  const stripParenBlocks = (v) => norm(protectParenBlocks(v).text.replace(/__P\d+__/g, ' '));
  for (const t of others) {
    const core = stripParenBlocks(t).replace(/[()]/g, '').trim();
    if (!core || core === buildingName || inBuilding(core)) continue;
    if (cmpKey(core) === cmpKey(legalDong)) continue;
    moved.push(core);
  }

  const newDetail = norm([...kept, ...refBlocks].join(' '));
  const paren = [legalDong, buildingName].filter(Boolean).join(', ');
  let next = parsed.road;
  if (newDetail && paren) next = `${parsed.road}, ${newDetail} (${paren})`;
  else if (newDetail) next = `${parsed.road}, ${newDetail}`;
  else next = `${parsed.road}, (${paren})`;
  next = guardAddressDetail(oldAddr, norm(next));

  // 수리 결과가 여전히 오염이면 포기(원본 보존 — 억지 재조립 금지)
  const after = diagnose(next, legalDong);
  if (after.reasons.length) return { skip: `수리 후에도 오염: ${after.reasons.join('/')}`, oldAddr, attempted: next };
  if (next === oldAddr) return null;

  // 특이사항 이관 — 부분 중복까지 검사해 append(누적 방지)
  const oldNote = String(r.특이사항 || '');
  let newNote = oldNote;
  for (const m of moved) {
    const t = m.trim();
    if (!t || t.length < 2) continue;
    if (cmpKey(newNote).includes(cmpKey(t))) continue;
    newNote = newNote ? `${newNote} ${t}` : t;
  }
  return { oldAddr, newAddr: next, oldNote, newNote, reasons, moved };
};

const main = async () => {
  console.log(`\n${'='.repeat(72)}\n${WRITE ? '★ WRITE 모드 (실제 반영)' : 'DRY-RUN (쓰기 없음)'}${ONLY_CITY ? ` — ${ONLY_CITY}` : ' — 전체'}\n${'='.repeat(72)}`);
  const stat = { total: 0, polluted: 0, repaired: 0, noteMoved: 0, written: 0 };
  const skips = new Map();
  const samples = [];
  const skipSamples = [];
  const pending = [];

  const cities = await db.collection('cloud_lists').listDocuments();
  for (const cityRef of cities) {
    if (ONLY_CITY && !cityRef.id.includes(ONLY_CITY)) continue;
    for (const monthRef of await cityRef.collection('months').listDocuments()) {
      const snap = await monthRef.collection('records').get();
      for (const doc of snap.docs) {
        const r = doc.data();
        stat.total++;
        const out = repairOne(r);
        if (!out) continue;
        if (out.skip) {
          stat.polluted++;
          skips.set(out.skip, (skips.get(out.skip) || 0) + 1);
          if (skipSamples.length < 8 && out.oldAddr) {
            skipSamples.push({ reason: out.skip, oldAddr: out.oldAddr, attempted: out.attempted || '' });
          }
          continue;
        }
        stat.polluted++;
        stat.repaired++;
        if (out.newNote !== out.oldNote) stat.noteMoved++;
        if (samples.length < SAMPLE_LIMIT) samples.push({ city: cityRef.id, month: monthRef.id, ...out });
        pending.push({ ref: doc.ref, ...out });
      }
    }
  }

  console.log(`\n[집계] 전체 ${stat.total}건 / 오염 ${stat.polluted}건 / 수리가능 ${stat.repaired}건 / 특이사항 이관 ${stat.noteMoved}건`);
  if (skips.size) {
    console.log(`\n[수리 보류(원본 보존)]`);
    for (const [k, v] of [...skips.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}건`);
    console.log(`\n[보류 표본 ${skipSamples.length}건]`);
    for (const s of skipSamples) {
      console.log(`\n  · [${s.reason}]`);
      console.log(`    원본: ${s.oldAddr}`);
      if (s.attempted) console.log(`    시도: ${s.attempted}`);
    }
  }

  console.log(`\n[수리 표본 ${samples.length}건]`);
  for (const s of samples) {
    console.log(`\n  · ${s.city} ${s.month}  [${s.reasons.join(' / ')}]`);
    console.log(`    이전: ${s.oldAddr}`);
    console.log(`    이후: ${s.newAddr}`);
    if (s.newNote !== s.oldNote) console.log(`    특이사항: "${s.oldNote}" → "${s.newNote}"`);
  }

  if (!WRITE) {
    console.log(`\n※ DRY-RUN 입니다. 위 결과를 확인한 뒤 --write 로 반영하세요.\n`);
    process.exit(0);
  }

  console.log(`\n반영 시작 — ${pending.length}건...`);
  let batch = db.batch();
  let n = 0;
  for (const p of pending) {
    const patch = { 주소: p.newAddr, addressMatchSource: 'nested-paren-repair' };
    if (p.newNote !== p.oldNote) patch.특이사항 = p.newNote;
    batch.update(p.ref, patch);
    n++;
    stat.written++;
    if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; console.log(`  ${stat.written}건 반영...`); }
  }
  if (n > 0) await batch.commit();
  console.log(`\n✅ 반영 완료: ${stat.written}건\n`);
  process.exit(0);
};

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
