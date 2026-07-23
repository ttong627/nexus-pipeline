// ══════════════════════════════════════════════════════════════════════════
//  기본명단(base_lists) → 이번달 명단(cloud_lists/{city}/months/{YYYY-MM})
//  특이사항 + 상세주소 일괄 이식
//
//  형 지시(2026-07-22): "이번달 명단에 특이사항 상세주소 다 이식해줘"
//
//  규칙 준수
//   · D-1 3순위 매칭: 이름+생년월일 → 이름+휴대폰끝8 → 이름+유선끝8 (S-1 강키만)
//   · B-15 동일인 중복 시 updatedAt 최신 레코드 사용
//   · D-4 이식 특이사항에 `◆` 접두사, 기존 `◆…`·`[기본]`·`(본명:…)` 제거 후 병합
//   · D-6 상세주소는 **이번달 주소에 상세가 없을 때만** 채운다(원본 우선·무손실 M-1)
//   · A-33 이식 문구도 sanitizeNote 로 검증(시스템 찌꺼기 유입 차단)
//
//  실행: node scripts/import-base-to-month.mjs 2026-07            (dry-run)
//        node scripts/import-base-to-month.mjs 2026-07 --write
//        node scripts/import-base-to-month.mjs 2026-07 --write --city "서울특별시 동대문구"
// ══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import admin from 'firebase-admin';
import { sanitizeNote, mergeNotes } from '../src/utils/noteSanitizer.js';

const ARGS = process.argv.slice(2);
const WRITE = ARGS.includes('--write');
const MONTH = ARGS.find(a => /^\d{4}-\d{2}$/.test(a));
const ONLY_CITY = (() => { const i = ARGS.indexOf('--city'); return i >= 0 ? ARGS[i + 1] : null; })();
if (!MONTH) { console.error('사용법: node scripts/import-base-to-month.mjs <YYYY-MM> [--write] [--city "지자체"]'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'))) });
const db = admin.firestore();

const S = (v) => String(v ?? '').trim();
const nospace = (v) => S(v).replace(/\s/g, '');
const dig = (v) => S(v).replace(/[^0-9]/g, '');
const tail8 = (v) => { const d = dig(v); return d.length >= 8 ? d.slice(-8) : ''; };
const birthKey = (v) => { const d = dig(v); return d.length >= 6 ? d.slice(-6) : ''; };

const gName = (r) => S(r.name || r['이름']);
const gNote = (r) => S(r.note || r['특이사항'] || r['비고']);
const gAddr = (r) => S(r.address || r['주소'] || r.standardRoadAddress);
const gDetail = (r) => S(r.detailAddr || r.detailAddress || r['상세주소']);
const gMobile = (r) => S(r.mobile || r['휴대폰']);
const gLand = (r) => S(r.landline || r['유선전화']);
const gBirth = (r) => S(r.birthKey || r['생년월일']);

/** 표시 주소를 도로명 / 상세 / 괄호로 3분할 (addressFormat.parseDisplayedAddress 규칙과 동일) */
function splitAddress(address) {
  const text = S(address);
  if (!text) return { road: '', detail: '', paren: '' };
  // 괄호 밖 첫 쉼표가 구분자
  let depth = 0, sep = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { sep = i; break; }
  }
  const road = sep >= 0 ? S(text.slice(0, sep)) : text;
  const rest = sep >= 0 ? S(text.slice(sep + 1)) : '';
  const pm = rest.match(/\(([^)]*)\)/);
  const paren = pm ? S(pm[1]) : '';
  const detail = pm ? S((rest.slice(0, pm.index) + ' ' + rest.slice(pm.index + pm[0].length)).replace(/\s+/g, ' ')) : rest;
  return { road, detail, paren };
}

/** 기본명단 특이사항 정리 — 이식 흔적·본명 제거(D-4) */
const cleanBaseNote = (v) => S(v).replace(/^\[기본\]\s*/g, '').replace(/\s*◆[^◆]*/g, '').replace(/\(본명:[^)]*\)/g, '').replace(/\s+/g, ' ').trim();

const tsMs = (r) => { const u = r?.updatedAt; if (!u) return 0; if (typeof u.toMillis === 'function') return u.toMillis(); if (typeof u.seconds === 'number') return u.seconds * 1000; return 0; };

/** 네트워크 순단(ECONNRESET 등)에 견디도록 3회까지 재시도 */
async function withRetry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt >= 4) throw e;
      console.log(`   ⟳ ${label} 재시도 ${attempt}/3 (${e.code || e.message})`);
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

async function run() {
  console.log(`[모드] ${WRITE ? '★실제 반영' : 'dry-run(쓰기 없음)'} · 대상 월 ${MONTH}${ONLY_CITY ? ` · ${ONLY_CITY}` : ''}`);
  const cityRefs = await db.collection('cloud_lists').listDocuments();
  const totals = { cities: 0, records: 0, matched: 0, noteAdded: 0, detailAdded: 0, updated: 0, skippedNoMonth: [] };
  const allPlans = [];

  for (const cityRef of cityRefs) {
    const city = cityRef.id;
    if (ONLY_CITY && city !== ONLY_CITY) continue;
    const monthRef = cityRef.collection('months').doc(MONTH);
    const snap = await withRetry(`${city} 명단 읽기`, () => monthRef.collection('records').get());
    if (snap.empty) { totals.skippedNoMonth.push(city); continue; }

    // 기본명단 인덱스 (D-1 · B-15 최신 우선)
    const baseSnap = await withRetry(`${city} 기본명단 읽기`, () => db.collection('base_lists').doc(city).collection('records').get());
    const idx = new Map();
    const dongDict = new Set();
    const put = (k, r) => { if (!k) return; const p = idx.get(k); if (!p || tsMs(r) >= tsMs(p)) idx.set(k, r); };
    baseSnap.forEach(d => {
      const r = d.data();
      const n = gName(r); if (!n) return;
      [r.legalDong, r['법정동'], r.dong, r['행정동']].forEach(v => { if (S(v)) dongDict.add(nospace(v)); });
      const b = birthKey(gBirth(r));
      if (b) put(`b|${n}|${b}`, r);
      const m = tail8(gMobile(r)); if (m) put(`p|${n}|${m}`, r);
      const l = tail8(gLand(r));   if (l) put(`l|${n}|${l}`, r);
    });

    let cMatched = 0, cNote = 0, cDetail = 0;
    const plans = [];
    snap.forEach(d => {
      const r = d.data();
      totals.records++;
      const n = gName(r); if (!n) return;
      const base =
        idx.get(`b|${n}|${birthKey(gBirth(r))}`) ||
        idx.get(`p|${n}|${tail8(gMobile(r))}`) ||
        idx.get(`l|${n}|${tail8(gLand(r))}`) || null;
      if (!base) return;
      cMatched++;

      const upd = {};
      const parts = splitAddress(gAddr(r));

      // ── 특이사항 이식 (D-4 · A-33 검증) ─────────────────────────
      const baseNote = cleanBaseNote(gNote(base));
      if (baseNote) {
        const checked = sanitizeNote(baseNote, {
          address: gAddr(r), detailAddr: parts.detail,
          buildingName: S(r['건물명'] || r.buildingName), legalDong: S(r['법정동'] || r.legalDong),
          realName: S(r['본명'] || r.realName), dong: S(r['행정동'] || r.dong), dongDict,
        });
        const cur = gNote(r);
        const curKept = cur.replace(/\s*◆[^◆]*/g, '').trim();      // 기존 이식분은 걷어내고 새로 붙인다
        if (checked.note) {
          const merged = mergeNotes(curKept, `◆${checked.note}`);
          if (nospace(merged) !== nospace(cur)) { upd['특이사항'] = merged; cNote++; }
        }
        // 기본명단 특이사항에서 상세주소로 승격된 호수도 활용
        if (checked.detailAddr && !parts.detail) parts.detail = checked.detailAddr;
      }

      // ── 상세주소 이식 (D-6) — 이번달에 상세가 없을 때만 ──────────
      const curDetail = parts.detail || gDetail(r);
      if (!curDetail) {
        const bd = gDetail(base);
        if (bd) {
          const rebuilt = [[parts.road, bd].filter(Boolean).join(', '), parts.paren ? `(${parts.paren})` : ''].filter(Boolean).join(' ');
          upd['주소'] = rebuilt;
          upd['detailAddress'] = bd;
          cDetail++;
        }
      }

      if (Object.keys(upd).length) plans.push({ ref: d.ref, upd, before: { 주소: gAddr(r), 특이사항: gNote(r) } });
    });

    totals.cities++; totals.matched += cMatched; totals.noteAdded += cNote; totals.detailAdded += cDetail; totals.updated += plans.length;
    console.log(`  ${city.padEnd(20)} 레코드 ${String(snap.size).padStart(6)} · 매칭 ${String(cMatched).padStart(6)} · 특이사항 ${String(cNote).padStart(5)} · 상세주소 ${String(cDetail).padStart(5)} · 갱신 ${plans.length}`);
    plans.slice(0, 2).forEach(p => console.log(`       예) "${p.before.특이사항}" → "${p.upd['특이사항'] ?? p.before.특이사항}"${p.upd['주소'] ? ` | 주소 "${p.before.주소}" → "${p.upd['주소']}"` : ''}`));
    allPlans.push(...plans.map(p => ({ path: p.ref.path, before: p.before })));

    // ── 지자체별 즉시 커밋 (네트워크 순단에 견디도록 · 재실행 안전) ──────
    if (WRITE && plans.length) {
      for (let i = 0; i < plans.length; i += 499) {
        const chunk = plans.slice(i, i + 499);
        await withRetry(`${city} 커밋`, async () => {
          const batch = db.batch();
          chunk.forEach(p => batch.update(p.ref, p.upd));
          await batch.commit();
        });
      }
      console.log(`     ✅ ${city} ${plans.length}건 저장`);
    }
  }

  console.log(`\n합계 — 지자체 ${totals.cities} · 레코드 ${totals.records.toLocaleString()} · 매칭 ${totals.matched.toLocaleString()} · 특이사항 ${totals.noteAdded.toLocaleString()} · 상세주소 ${totals.detailAdded.toLocaleString()} · 갱신대상 ${totals.updated.toLocaleString()}`);
  if (totals.skippedNoMonth.length) console.log(`${MONTH} 명단 없음(건너뜀): ${totals.skippedNoMonth.join(' / ')}`);

  if (!WRITE) { console.log('\n(dry-run) 반영하려면 --write'); return; }

  fs.writeFileSync(`_tmp_backup_import_${MONTH}_${Date.now()}.json`, JSON.stringify(allPlans, null, 0), 'utf8');
  await withRetry('audit_logs', () => db.collection('audit_logs').add({
    action: 'import-base-to-month', month: MONTH, updateCount: allPlans.length,
    noteAdded: totals.noteAdded, detailAdded: totals.detailAdded,
    adminEmail: 'script:import-base-to-month', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }));
  console.log(`✅ 이식 완료 ${allPlans.length.toLocaleString()}건 (지자체별 저장 완료)`);
}

run().then(() => process.exit(0)).catch(e => { console.error('ERR', e); process.exit(1); });
