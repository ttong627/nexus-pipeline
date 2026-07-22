// ══════════════════════════════════════════════════════════════════════════
//  특이사항(note) 정제 — 본명/법정동/건물명 컬럼 이동 + 찌꺼기 삭제
//  형 승인(2026-07-22): 5개 그룹 전부 실행. 실제 배송메모는 전량 보존(무손실 M-1).
//
//  실행: node scripts/clean-special-notes.mjs             (dry-run · 기본)
//        node scripts/clean-special-notes.mjs --write     (실제 반영)
//        node scripts/clean-special-notes.mjs --verify    (정제 후 재조사만)
//
//  · 쓰기 전 대상 레코드 전수를 _tmp_backup_notes_<ts>.json 으로 백업(되돌리기용)
//  · 배치 커밋 499건(B-6) · 스키마 혼재(B-8) 대응: 레코드가 쓰는 키에 맞춰 기록
//  · audit_logs 기록(B-11)
// ══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import admin from 'firebase-admin';

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const VERIFY_ONLY = ARGS.includes('--verify');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();

const S = (v) => String(v ?? '').trim();
const nospace = (v) => S(v).replace(/\s/g, '');
const getNote = (r) => S(r.note || r['특이사항'] || r['비고']);
const getReal = (r) => S(r.realName || r['본명']);
const getLegal = (r) => S(r.legalDong || r['법정동']);
const getBld = (r) => S(r.buildingName || r['건물명']);
const getAddr = (r) => S(r.address || r['주소'] || r.standardRoadAddress);
const getDong = (r) => S(r.dong || r['행정동']);

// ── 판정 규칙 (survey3 확정본과 동일) ──────────────────────────────
const SYMBOL_ONLY = /^[^가-힣A-Za-z0-9]+$/;
const REPEAT_DIGIT = /^(\d)\1{1,}$/;
const MEANINGLESS_WORD = /^(나|여|남|무|미|없음|없다|해당없음|없|x|X|-|없슴)$/;
const BLD_TAIL = /(아파트|빌라|맨션|타워|하이츠|캐슬|파크|힐스|자이|푸르지오|래미안|편한세상|오피스텔|연립|빌딩|하우스|팰리스|플라자|원룸텔|빌|타운)$/;

/** 특이사항의 `(본명:XXX)` 추출 — 중첩 괄호 `(본명:인순이(김병기))` 대응 */
export function extractRealName(note) {
  const i = note.search(/\(\s*본명\s*[:：]/);
  if (i < 0) return null;
  let depth = 0, end = -1;
  for (let k = i; k < note.length; k++) {
    if (note[k] === '(') depth++;
    else if (note[k] === ')') { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) end = note.length - 1;
  const real = S(note.slice(i, end + 1).replace(/^\(\s*본명\s*[:：]\s*/, '').replace(/\)$/, ''));
  const rest = S((note.slice(0, i) + ' ' + note.slice(end + 1)).replace(/\s+/g, ' '));
  return { real, rest };
}

/**
 * 레코드 1건의 정제 계획을 만든다(순수함수 · 쓰기 없음).
 * @returns {null | {note:string, realName?:string, legalDong?:string, buildingName?:string, reasons:string[]}}
 */
export function planRecord(rec, dongDict) {
  const note0 = getNote(rec);
  if (!note0) return null;
  const plan = { note: note0, reasons: [] };
  let note = note0;

  const ex = extractRealName(note);
  if (ex && ex.real) {
    if (!getReal(rec)) plan.realName = ex.real;
    note = ex.rest;
    plan.reasons.push('본명→본명컬럼');
  }

  const n = nospace(note);
  if (n) {
    if (SYMBOL_ONLY.test(n) || REPEAT_DIGIT.test(n) || MEANINGLESS_WORD.test(n)) {
      note = ''; plan.reasons.push('삭제(무의미)');
    } else if (dongDict.has(n) && /(동|가|읍|면|리)$/.test(n)) {
      if (!getLegal(rec)) plan.legalDong = S(note);
      note = ''; plan.reasons.push(plan.legalDong ? '법정동→법정동컬럼' : '삭제(법정동 이미 있음)');
    } else if (n.length >= 3 && nospace(getAddr(rec)).includes(n)) {
      note = ''; plan.reasons.push('삭제(주소중복)');
    } else if (BLD_TAIL.test(n) && n.length <= 12) {
      if (!getBld(rec)) {
        // `내동, 성진그린타운` 형태 = 법정동, 건물명 → 각 컬럼으로 분리
        const parts = S(note).split(',').map(S).filter(Boolean);
        if (parts.length === 2 && dongDict.has(nospace(parts[0]))) {
          if (!getLegal(rec)) plan.legalDong = parts[0];
          plan.buildingName = parts[1];
        } else {
          plan.buildingName = S(note);
        }
      }
      note = ''; plan.reasons.push(plan.buildingName ? '건물명→건물명컬럼' : '삭제(건물명 이미 있음)');
    }
  }

  if (note === note0 && !plan.realName) return null;   // 변경 없음 = 보존
  plan.note = note;
  return plan;
}

/** 레코드가 쓰는 스키마(B-8)에 맞춰 실제 기록할 필드맵 생성 */
function payloadFor(rec, plan) {
  const ko = Object.prototype.hasOwnProperty.call(rec, '특이사항');
  const p = {};
  p[ko ? '특이사항' : 'note'] = plan.note;
  if (plan.realName) p[ko ? '본명' : 'realName'] = plan.realName;
  if (plan.legalDong) p[ko ? '법정동' : 'legalDong'] = plan.legalDong;
  if (plan.buildingName) p[ko ? '건물명' : 'buildingName'] = plan.buildingName;
  return p;
}

// ── 전수 스캔 ──────────────────────────────────────────────────────
async function eachRecord(cb) {
  for (const [coll, nested] of [['base_lists', false], ['cloud_lists', true], ['delivery_history', true]]) {
    for (const c of await db.collection(coll).listDocuments()) {
      const monthRefs = nested ? await c.collection('months').listDocuments() : [c];
      for (const m of monthRefs) {
        const snap = await m.collection('records').get();
        snap.forEach(d => cb(d.data(), d.ref, `${coll}/${c.id}${nested ? '/' + m.id : ''}`));
      }
    }
  }
}

async function main() {
  console.log(`[모드] ${VERIFY_ONLY ? '재조사(verify)' : WRITE ? '★실제 반영(--write)' : 'dry-run(기본·쓰기 없음)'}`);

  // 1패스: 동 사전 + 대상 수집
  const dongDict = new Set();
  const all = [];
  await eachRecord((rec, ref, path) => {
    [getLegal(rec), getDong(rec)].forEach(d => { if (d) dongDict.add(nospace(d)); });
    all.push({ rec, ref, path });
  });
  console.log(`전체 레코드 ${all.length.toLocaleString()} · 동 사전 ${dongDict.size.toLocaleString()}`);

  const targets = [];
  let keep = 0, withNote = 0;
  for (const t of all) {
    if (getNote(t.rec)) withNote++;
    const plan = planRecord(t.rec, dongDict);
    if (plan) targets.push({ ...t, plan });
    else if (getNote(t.rec)) keep++;
  }

  const tally = {};
  targets.forEach(t => t.plan.reasons.forEach(r => { tally[r] = (tally[r] || 0) + 1; }));
  console.log(`특이사항 보유 ${withNote.toLocaleString()} · 정제대상 ${targets.length.toLocaleString()} · 보존 ${keep.toLocaleString()}`);
  console.log('조치별:', JSON.stringify(tally, null, 0));

  if (VERIFY_ONLY) {
    console.log(targets.length === 0 ? '✅ 검증 통과: 잔여 정제대상 0건' : `⚠️ 잔여 정제대상 ${targets.length}건`);
    return;
  }
  if (!WRITE) {
    console.log('\n(dry-run) 실제 반영하려면 --write 를 붙여 실행하세요. 쓰기는 한 건도 하지 않았습니다.');
    return;
  }

  // 백업 (되돌리기용 — 대상 레코드 원본 전체)
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `_tmp_backup_notes_${ts}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(targets.map(t => ({ path: t.ref.path, before: t.rec })), null, 0), 'utf8');
  console.log(`백업 저장: ${backupPath} (${targets.length.toLocaleString()}건 원본 전체)`);

  // 배치 커밋 499건 (B-6)
  let done = 0;
  for (let i = 0; i < targets.length; i += 499) {
    const chunk = targets.slice(i, i + 499);
    const batch = db.batch();
    chunk.forEach(t => batch.update(t.ref, payloadFor(t.rec, t.plan)));
    await batch.commit();
    done += chunk.length;
    console.log(`  커밋 ${done.toLocaleString()}/${targets.length.toLocaleString()}`);
  }

  await db.collection('audit_logs').add({
    action: 'clean-special-notes',
    updateCount: targets.length,
    tally,
    backup: backupPath,
    adminEmail: 'script:clean-special-notes',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✅ 정제 완료 ${targets.length.toLocaleString()}건 · 배송메모 ${keep.toLocaleString()}건 보존`);
}

main().then(() => process.exit(0)).catch(e => { console.error('ERR', e); process.exit(1); });
