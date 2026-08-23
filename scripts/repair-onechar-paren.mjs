// A-38 저장분 복구 — 괄호에 떨어진 한 글자 파편을 상세주소 앞에 되돌린다. 기본 DRY-RUN(쓰기 없음), 반영은 --write.
//
//   배경(2026-08-23): 품질모니터 08-17 `괄호잡값 +19` = 동대문구 2026-08 명단 19건.
//   `반지층 1호`가 괄호 `(제기동, 반)` + 상세 `지층 1호`로 갈려 저장됐다(A-38 규칙으로 엔진은 고쳤지만
//   이미 저장된 명단은 자동 복구되지 않는다). 원주소가 저장돼 있지 않으므로 **파편 + 상세를 이어 붙여**
//   원형을 복원한다(`반`+`지층 1호` → `반지층 1호`, `비`+`02호` → `비02호`). 이것은 분리의 정확한 역연산이다.
//
//   형 방침(엄수):
//     · 파편만 있고 상세가 비면 복원 근거가 없으므로 **보류**(원본 보존)
//     · 괄호의 법정동은 그대로 두고 파편만 걷어낸다. 이름·전화 등 PII 미조회·미출력
//     · 변경 전 문서 전체를 바탕화면 JSON으로 백업(되돌릴 수 있게) — 리포에는 남기지 않는다
//
//   사용:
//     node scripts/repair-onechar-paren.mjs                        # 전체 dry-run
//     node scripts/repair-onechar-paren.mjs "서울특별시 동대문구" 2026-08   # 특정 지자체/월 dry-run
//     node scripts/repair-onechar-paren.mjs "서울특별시 동대문구" 2026-08 --write   # 반영(형 확인 후)
import admin from 'firebase-admin';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { parseDisplayedAddress, cleanAddressPiece } from '../src/utils/addressFormat.js';
import { LEGAL_DONG_RE } from '../services/address-service/src/shared/purifyHelpers.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const positional = args.filter((a) => !a.startsWith('--'));
const ONLY_CITY = positional[0] || '';
const ONLY_MONTH = positional[1] || '';

const norm = (v) => cleanAddressPiece(v);
const ONE_HANGUL = /^[가-힣]$/;

/** 괄호 `법정동, 파편` → { legalParts, frag } — 파편이 정확히 한 글자 한글 1개일 때만 */
const splitParen = (paren) => {
  const parts = String(paren || '').split(',').map((s) => s.trim()).filter(Boolean);
  const frags = parts.filter((p) => ONE_HANGUL.test(p));
  const rest = parts.filter((p) => !ONE_HANGUL.test(p));
  if (frags.length !== 1) return null;
  if (rest.length && !rest.every((p) => LEGAL_DONG_RE.test(p))) return null;   // 건물명 후보가 있으면 손대지 않는다
  return { legalParts: rest, frag: frags[0] };
};

const plan = [];
let scanned = 0;
for (const cityRef of await db.collection('cloud_lists').listDocuments()) {
  if (ONLY_CITY && cityRef.id !== ONLY_CITY) continue;
  for (const monthRef of await cityRef.collection('months').listDocuments()) {
    if (ONLY_MONTH && monthRef.id !== ONLY_MONTH) continue;
    const snap = await monthRef.collection('records').get();
    for (const doc of snap.docs) {
      const r = doc.data();
      scanned++;
      const addr = norm(r.주소);
      if (!addr) continue;
      const p = parseDisplayedAddress(addr);
      const sp = splitParen(p.paren);
      if (!sp) continue;
      const detail = String(p.detail || '').trim();
      if (!detail) { plan.push({ ref: doc.ref, city: cityRef.id, month: monthRef.id, before: addr, hold: '상세 없음(복원 근거 없음)' }); continue; }
      // 복원은 분리의 역연산이 **확실한 형태만**: 파편이 숫자 마커에 붙었던 경우(비|02호·지|01호·나|1층·좌|1층) 또는
      // `반`+지하/지층(반지하·반지층). 그 외(`지`+`지층3호`→`지지층3호`)는 원형을 알 수 없으므로 보류(형 원칙: 애매하면 보존).
      const glued = /^\d/.test(detail) || (sp.frag === '반' && /^(지하|지층)/.test(detail));
      if (!glued) { plan.push({ ref: doc.ref, city: cityRef.id, month: monthRef.id, before: addr, hold: `파편 '${sp.frag}' + 상세 '${detail.slice(0, 8)}' — 원형 불확실` }); continue; }
      const newDetail = `${sp.frag}${detail}`;
      const parenStr = sp.legalParts.length ? ` (${sp.legalParts.join(', ')})` : '';
      const after = `${p.road}, ${newDetail}${parenStr}`;
      const patch = { 주소: after };
      if (r.상세주소 !== undefined) patch.상세주소 = newDetail;
      if (r.괄호정보 !== undefined) patch.괄호정보 = sp.legalParts.join(', ');
      if (r.buildingName === sp.frag) patch.buildingName = '';
      if (r.건물명 === sp.frag) patch.건물명 = '';
      plan.push({ ref: doc.ref, city: cityRef.id, month: monthRef.id, before: addr, after, patch, data: r });
    }
  }
}

const todo = plan.filter((x) => !x.hold);
const held = plan.filter((x) => x.hold);
console.log(`스캔 ${scanned}건 · 복구 대상 ${todo.length}건 · 보류 ${held.length}건 · 모드 ${WRITE ? '★WRITE' : 'dry-run'}`);
for (const x of todo) console.log(`  [${x.city} ${x.month}]\n    전: ${x.before}\n    후: ${x.after}`);
for (const x of held) console.log(`  보류 [${x.city} ${x.month}] ${x.before} — ${x.hold}`);

if (WRITE && todo.length) {
  const stamp = new Date().toISOString().slice(0, 10);
  const dir = path.join(os.homedir(), 'Desktop');
  mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `nexus_A38_괄호파편_복구백업_${stamp}.json`);
  writeFileSync(backup, JSON.stringify(todo.map((x) => ({ path: x.ref.path, data: x.data })), null, 2), 'utf8');
  console.log(`백업: ${backup}`);
  const batch = db.batch();
  for (const x of todo) batch.set(x.ref, { ...x.patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  await db.collection('audit_logs').add({
    action: 'repair-onechar-paren', rule: 'A-38', count: todo.length,
    cities: [...new Set(todo.map((x) => `${x.city} ${x.month}`))], at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`반영 완료 ${todo.length}건 (audit_logs 기록)`);
}
process.exit(0);
