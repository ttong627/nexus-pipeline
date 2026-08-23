// 동 조각(`3-`·`1-`·`◆2-`·`A-`) 복구 — 특이사항(note)에 샌 것 + 괄호(건물명 자리)에 떨어진 것. 기본 DRY-RUN, 반영은 --write.
//
//   배경(2026-08-23 · 형 지시 "동 '-' 특이사항 이동 결함 완전 해소"): `3-302호`·`1-2호`·`A-302호`가 정제될 때 마커 앞 `3-`·`1-`·`A-`가
//   건물명 슬롯으로 떨어지고, 주소DB 건물명과 달라 M-1 보존 경로로 **특이사항에 조각만 남거나**(note형) 건물명이 없으면
//   **괄호에 그대로 남았다**(`(답십리동, 2-)` 괄호형 · 검사① 실측 18건). 뿌리는 **기본명단(base_lists)** — 거기 남은 조각이 D-4 이식으로
//   월 명단에 `◆N-`로 매달 다시 들어온다. 엔진은 A-10 ③ 정정으로 고쳤지만 저장분은 자동 복구되지 않는다.
//
//   조각 토큰 = `X-` (X: 숫자 1~2자 · 영문 1~2자 · 한글 1자, `◆` 접두 허용). ★숫자 3~4자리 동은 원래부터 인식됐으므로 샌 적이 없다 —
//   `010-`·`1234-`·`2026-`를 동으로 보지 않기 위해 1~2자리로 제한(검사②). `호·동·층`이 든 것(`201호-`)은 조각이 아니다(2차 실행 오복원 1건 → 원복).
//   note형은 note **전체 / 맨 앞 / 맨 끝 토큰**만(M-1 보존은 끝에, D-4 이식은 `◆`로 앞에 붙이므로). 문장 한가운데는 손대지 않는다.
//
//   규칙(보수 · 판단이 애매하면 보류 = 원본 보존):
//     A 복원(note형): 상세가 호수로 시작하고 동 토큰이 없으면 → 상세 앞에 동을 되돌리고 note에서 조각만 제거
//            (숫자 동: 호 3~4자리면 A-10 형식 `N- NNN호`(공백은 1칸으로 접힘), 동·호 모두 1~2자리는 다가구 원형 `1-2호`; 영문·한글 동: 원형 `A-302호`)
//     B 정리(note형): 상세에 **같은 동**이 이미 있으면(`7-1405호` + `◆7-`) → note에서 조각만 제거
//     C 괄호형: 괄호 토큰 중 조각이 정확히 1개이고 상세가 호수로 시작(동 없음)하면 → 상세 앞에 되돌리고 괄호에서 제거 · 같은 동이 이미 있으면 괄호에서만 제거
//     그 외(다른 동·호수로 시작하지 않는 상세·조각 2개 이상)는 보류
//     이름·전화·좌표·기사·순번 미조회·불변 · 배치 499 · 백업(바탕화면) · audit_logs(adminEmail·backup·paths)
//
//   사용:  node scripts/repair-dash-dong-note.mjs [--target cloud|base|all] [--write]
//   원복:  node scripts/restore-from-backup.mjs "<백업.json>" --write
import admin from 'firebase-admin';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { parseDisplayedAddress, cleanAddressPiece } from '../src/utils/addressFormat.js';
import { normalizeDongHoDetail } from '../services/address-service/src/shared/dongHoFormat.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const tIdx = args.indexOf('--target');
const TARGET = tIdx >= 0 ? String(args[tIdx + 1] || '') : 'all';
if (!['cloud', 'base', 'all'].includes(TARGET)) {
  console.error(`--target 은 cloud|base|all 중 하나여야 합니다(받은 값: '${TARGET}')`);
  process.exit(2);
}
const S = (v) => String(v ?? '').trim();
const FRAG_TOKEN = '◆?\\s*((?:\\d{1,2}|[A-Za-z]{1,2}|(?![호동층])[가-힣]))\\s*-';
const FRAG_WHOLE_RE = new RegExp(`^${FRAG_TOKEN}$`);
const FRAG_HEAD_RE = new RegExp(`^${FRAG_TOKEN}(?=\\s)`);
const FRAG_TAIL_RE = new RegExp(`(?<=\\s)${FRAG_TOKEN}$`);
const PAREN_FRAG_RE = new RegExp(`^${FRAG_TOKEN}$`);
const HO_START_RE = /^(\d{1,4})\s*호(?=\s|$|,)/;
const HAS_DONG_RE = /[\d가-힣A-Za-z]동(?=\s|\d|호|,|$)|[A-Za-z가-힣\d]{1,4}\s*-\s*\d{1,4}\s*호/;

/** note에서 조각을 찾는다 — 전체 / 맨 앞 / 맨 끝만. { dong, rest } 또는 null */
const findFrag = (note) => {
  let m = note.match(FRAG_WHOLE_RE); if (m) return { dong: m[1], rest: '' };
  m = note.match(FRAG_HEAD_RE); if (m) return { dong: m[1], rest: note.slice(m[0].length).trim() };
  m = note.match(FRAG_TAIL_RE); if (m) return { dong: m[1], rest: note.slice(0, note.length - m[0].length).trim() };
  return null;
};
const sameDongAhead = (det, dong) => new RegExp(`^${dong}\\s*-\\s*(?:\\d{1,4}\\s*호|\\s)`, 'i').test(det);
const restoreHead = (dong, ho) => {
  if (!/^\d+$/.test(dong)) return `${dong}-${ho}호`;                                   // 영문·한글 동: 원형
  if (ho.length >= 3) return normalizeDongHoDetail(`${dong}동 ${ho}호`).replace(/\s+/g, ' ');   // A-10 숫자 동 형식
  return `${dong}-${ho}호`;                                                               // 동·호 모두 1~2자리 = 다가구 원형
};

const plan = []; const held = []; let scanned = 0;
const push = (kind, ref, r, label, before, after, note, newNote, patch) => plan.push({ ref, kind, label, before, after, note, newNote, patch, data: r });

const consider = (ref, r, label, keys) => {
  scanned++;
  const { noteKey, addrKey, detailKeys, parenKeys, bldgKeys } = keys;
  const p = parseDisplayedAddress(cleanAddressPiece(r[addrKey]));
  const det = S(p.detail);

  // ── note형 ──
  const note = S(r[noteKey]);
  const fr = note ? findFrag(note) : null;
  if (fr) {
    const { dong, rest } = fr;
    if (HAS_DONG_RE.test(det)) {
      if (sameDongAhead(det, dong)) push('B정리', ref, r, label, r[addrKey], r[addrKey], note, rest, { [noteKey]: rest });
      else held.push({ label, before: r[addrKey], note, why: `상세 '${det}'에 다른 동이 있음` });
      return;
    }
    const hm = det.match(HO_START_RE);
    if (!hm) { held.push({ label, before: r[addrKey], note, why: `상세 '${det}' — 호수로 시작하지 않음` }); return; }
    const newDetail = `${restoreHead(dong, hm[1])}${det.slice(hm[0].length)}`.replace(/\s+/g, ' ').trim();
    const after = `${p.road}, ${newDetail}${p.paren ? ` (${p.paren})` : ''}`;
    const patch = { [addrKey]: after, [noteKey]: rest };
    for (const k of detailKeys) if (r[k] !== undefined) patch[k] = newDetail;
    push('A복원', ref, r, label, r[addrKey], after, note, rest, patch);
    return;
  }

  // ── 괄호형 ──
  const ptoks = S(p.paren).split(/\s*,\s*/).filter(Boolean);
  const pfr = ptoks.filter((t) => PAREN_FRAG_RE.test(t));
  if (pfr.length !== 1) { if (pfr.length > 1) held.push({ label, before: r[addrKey], note: `괄호 ${p.paren}`, why: '괄호 조각 2개 이상' }); return; }
  const dong = pfr[0].match(PAREN_FRAG_RE)[1];
  const newParen = ptoks.filter((t) => t !== pfr[0]).join(', ');
  let newDetail = det;
  if (HAS_DONG_RE.test(det)) {
    if (!sameDongAhead(det, dong)) { held.push({ label, before: r[addrKey], note: `괄호 ${p.paren}`, why: `상세 '${det}'에 다른 동이 있음` }); return; }
  } else {
    const hm = det.match(HO_START_RE);
    if (!hm) { held.push({ label, before: r[addrKey], note: `괄호 ${p.paren}`, why: `상세 '${det}' — 호수로 시작하지 않음` }); return; }
    newDetail = `${restoreHead(dong, hm[1])}${det.slice(hm[0].length)}`.replace(/\s+/g, ' ').trim();
  }
  const after = `${p.road}, ${newDetail}${newParen ? ` (${newParen})` : ''}`;
  const patch = { [addrKey]: after };
  for (const k of detailKeys) if (r[k] !== undefined) patch[k] = newDetail;
  for (const k of parenKeys) if (r[k] !== undefined) patch[k] = newParen;
  for (const k of bldgKeys) if (S(r[k]) === pfr[0] || S(r[k]) === dong) patch[k] = '';
  push('C괄호', ref, r, label, r[addrKey], after, `괄호 ${p.paren}`, newParen, patch);
};

if (TARGET === 'cloud' || TARGET === 'all') {
  for (const cityRef of await db.collection('cloud_lists').listDocuments()) {
    for (const monthRef of await cityRef.collection('months').listDocuments()) {
      const snap = await monthRef.collection('records').get();
      for (const d of snap.docs) consider(d.ref, d.data(), `cloud ${cityRef.id} ${monthRef.id}`, {
        noteKey: '특이사항', addrKey: '주소', detailKeys: ['상세주소', 'detailAddress'], parenKeys: ['괄호정보'], bldgKeys: ['buildingName', '건물명'],
      });
    }
  }
}
if (TARGET === 'base' || TARGET === 'all') {
  for (const cityRef of await db.collection('base_lists').listDocuments()) {
    for (const sub of await cityRef.listCollections()) {
      const snap = await sub.get();
      for (const d of snap.docs) {
        const r = d.data();
        consider(d.ref, r, `base ${cityRef.id}`, {
          noteKey: r.note !== undefined ? 'note' : '특이사항', addrKey: r.address !== undefined ? 'address' : '주소',
          detailKeys: ['detailAddr', '상세주소'], parenKeys: ['parenInfo'], bldgKeys: ['buildingName', '건물명'],
        });
      }
    }
  }
}

const A = plan.filter((x) => x.kind === 'A복원'), B = plan.filter((x) => x.kind === 'B정리'), C = plan.filter((x) => x.kind === 'C괄호');
const byLabel = {}; for (const x of plan) byLabel[`${x.label} ${x.kind}`] = (byLabel[`${x.label} ${x.kind}`] || 0) + 1;
console.log(`스캔 ${scanned}건 · A복원 ${A.length} · B정리 ${B.length} · C괄호 ${C.length} · 보류 ${held.length} · 모드 ${WRITE ? '★WRITE' : 'dry-run'} · 대상 ${TARGET}`);
console.log('분포:', JSON.stringify(byLabel));
for (const x of [...A, ...C]) console.log(`  [${x.kind} ${x.label}] ${x.note} → '${x.newNote}'\n    전: ${x.before}\n    후: ${x.after}`);
for (const x of B.slice(0, 12)) console.log(`  [B ${x.label}] note='${x.note}' → '${x.newNote}' — 주소 그대로: ${x.before}`);
if (B.length > 12) console.log(`  … B정리 ${B.length - 12}건 더`);
for (const h of held) console.log(`  보류 [${h.label}] ${h.note} ${h.before} — ${h.why}`);

if (WRITE && plan.length) {
  const stamp = new Date().toISOString().slice(0, 10);
  const dir = path.join(os.homedir(), 'Desktop'); mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `nexus_대시동조각_복구백업_${TARGET}_${stamp}_${Date.now()}.json`);
  writeFileSync(backup, JSON.stringify(plan.map((x) => ({ path: x.ref.path, kind: x.kind, data: x.data })), null, 2), 'utf8');
  console.log(`백업: ${backup}`);
  for (let i = 0; i < plan.length; i += 499) {
    const batch = db.batch();
    for (const x of plan.slice(i, i + 499)) batch.set(x.ref, { ...x.patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
  }
  // B-11 관행: 누가(스크립트)·무엇을(path 목록)·되돌릴 근거(백업 경로). paths 는 문서 1MiB 상한 때문에 5,000건까지만 — 전체는 백업 JSON 에 있다
  const paths = plan.map((x) => `${x.kind}:${x.ref.path}`);
  await db.collection('audit_logs').add({
    action: 'repair-dash-dong-note', rule: 'A-10 ③', adminEmail: 'script:repair-dash-dong-note', target: TARGET,
    restored: A.length, cleared: B.length, paren: C.length, held: held.length, backup,
    paths: paths.length <= 5000 ? paths : paths.slice(0, 5000), pathsTruncated: paths.length > 5000,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`반영 완료 — 복원 ${A.length} · 정리 ${B.length} · 괄호 ${C.length} (audit_logs 기록)`);
}
process.exit(0);
