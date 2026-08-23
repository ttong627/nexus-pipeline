// 월 명단 재정제 — 서버 purify(/v1/address/purify, 클라와 같은 코어)로 저장된 주소를 다시 돌려 **주소DB 식별자를 채운다**.
// 기본 DRY-RUN(쓰기 없음), 반영은 --write.
//
//   배경(2026-08-23): 동대문구 2026-08 명단 7,712건이 주소DB 없이 정제돼 저장됐다(addressMatchSource 빈값 ·
//   buildingMgtNo/standardRoadAddress 0% · 확인필요 0). 좌표는 있어 배송은 되지만 DB 검증(A-12)·식별자가 없다.
//
//   ★보수 원칙(A-36 · M-1 — 주소를 임의로 바꾸지 않는다):
//     · 도로명(콤마 앞)이 달라지면 **보류**(주소 미변경 · 식별자도 안 씀 → 담당자 확인 목록)
//     · 상세가 달라지면 보류 — 단 새 상세가 옛 상세로 끝나고 앞에 붙은 토큰이 옛 괄호에서 온 것(에이동·반 같은 A-37/A-38 이동)이면 허용
//     · 괄호(법정동·건물명)는 DB가 확인한 값으로 갱신(A-24·A-25 취지). 옛 괄호 건물명이 DB명과 다르면 특이사항에 보존(M-1)
//     · 좌표(lat/lng/좌표*)·이름·연락처·기사·순번·특이사항 원문은 손대지 않는다(특이사항은 보존분 추가만)
//     · DB 미매칭이면 주소는 그대로 두고 확인필요/확인사유만 기록(A-12 — 정제 화면과 같은 동작)
//     · 요청은 순차 50건(서버 상한·2026-07-30 커넥션 경합 사고 규칙) · 변경 문서 전체 백업(바탕화면) · audit_logs
//
//   사용:
//     node scripts/repurify-month.mjs "서울특별시 동대문구" 2026-08            # dry-run
//     node scripts/repurify-month.mjs "서울특별시 동대문구" 2026-08 --write    # 반영 — ★형 확인("고") 후에만. dry-run 수치를 먼저 보고할 것
//     옵션 --limit N (앞 N건만 · 표본용)
//   원복: 바탕화면 백업 JSON → node scripts/restore-from-backup.mjs <백업.json> --write
import admin from 'firebase-admin';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { parseDisplayedAddress } from '../src/utils/addressFormat.js';
import { appendUniqueNote } from '../services/address-service/src/shared/detailNormalize.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const API = (env.match(/^VITE_ADDRESS_MATCH_API_URL=(.*)$/m)?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
if (!API) throw new Error('VITE_ADDRESS_MATCH_API_URL 없음(.env)');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 0;
const positional = args.filter((a, i) => !a.startsWith('--') && (limitIdx < 0 || i !== limitIdx + 1));
const [CITY, MONTH] = positional;
if (!CITY || !MONTH) throw new Error('사용: node scripts/repurify-month.mjs "<지자체>" <YYYY-MM> [--write] [--limit N]');
const BATCH = 50;
const S = (v) => String(v ?? '').trim();
const tokens = (s) => S(s).split(/[,\s]+/).filter(Boolean);

const col = db.collection('cloud_lists').doc(CITY).collection('months').doc(MONTH).collection('records');
const snap = await col.get();
let docs = snap.docs;
if (LIMIT) docs = docs.slice(0, LIMIT);
console.log(`${CITY} ${MONTH}: ${snap.size}건 (대상 ${docs.length}) · 모드 ${WRITE ? '★WRITE' : 'dry-run'}`);

const purify = async (records) => {
  const res = await fetch(`${API}/v1/address/purify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ records }),
  });
  if (!res.ok) throw new Error(`purify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  if (!j.ok || !Array.isArray(j.data)) throw new Error('purify 응답 이상');
  return j.data;
};

const stat = { matched: 0, unmatched: 0, same: 0, paren: 0, detailMove: 0, bldgMove: 0, holdRoad: 0, holdDetail: 0, flag: 0, err: 0 };
const plan = []; const holds = [];
const samples = { paren: [], detailMove: [], bldgMove: [], holdRoad: [], holdDetail: [], unmatched: [] };
const push = (k, s) => { if (samples[k].length < 6) samples[k].push(s); };

// 새 상세가 옛 상세로 끝나고, 앞에 붙은 토큰이 전부 옛 괄호에서 온 것이면 '건물동 이동'(A-37/A-38)으로 허용
const isDetailMove = (oldP, newP) => {
  if (!newP.detail.endsWith(oldP.detail)) return false;
  const pre = newP.detail.slice(0, newP.detail.length - oldP.detail.length).trim();
  const pt = tokens(pre);
  const parenToks = tokens(oldP.paren);
  return pt.length > 0 && pt.every((t) => parenToks.includes(t));
};
// 역방향: 옛 상세 앞에 있던 건물명 토큰이 DB 확인으로 새 괄호로 옮겨간 경우(`서울미니텔 316호 (청량리동)` → `316호 (청량리동, 서울미니텔)`)
//   — 정보 손실 없이 A-11 형식(건물명은 괄호)으로 교정되는 것이라 허용
//   ★단, 옮겨가는 문구가 **DB가 확인한 건물명**(응답 buildingName)과 같거나 **건물 유형어로 끝날 때만** — `주차장 앞 1층`의
//   `주차장 앞`처럼 배송 메모가 건물명 자리로 승격되는 것은 막는다(그 경우는 주소 보존 · 식별자만).
const BLDG_TAIL_RE = /(아파트|빌라|빌딩|맨션|타워|하우스|오피스텔|원룸|주택|상가|센터|플라자|캐슬|파크|힐스|자이|래미안|푸르지오|고시텔|고시원|리빙텔|미니텔|텔|빌|타운|연립|다세대|호텔|모텔|회관|교회|성당|학교|병원|의원|시장|마트|타운하우스|팰리스|하이츠|베르디움|에코빌|힐)$/;
const isBldgMove = (oldP, newP, dbBuildingName) => {
  if (!newP.detail || !oldP.detail.endsWith(newP.detail)) return false;
  const pre = oldP.detail.slice(0, oldP.detail.length - newP.detail.length).trim();
  const pt = tokens(pre);
  const newParen = S(newP.paren).replace(/\s+/g, '');
  if (!(pt.length > 0 && pt.every((t) => newParen.includes(t.replace(/\s+/g, ''))))) return false;
  const preKey = pre.replace(/\s+/g, '');
  const dbKey = S(dbBuildingName).replace(/\s+/g, '');
  return (dbKey && dbKey === preKey) || BLDG_TAIL_RE.test(preKey);
};

for (let i = 0; i < docs.length; i += BATCH) {
  const chunk = docs.slice(i, i + BATCH);
  let out;
  try {
    out = await purify(chunk.map((d) => ({ addr: S(d.data().주소), name: '', adminDong: S(d.data().행정동), cityLabel: CITY, note: '' })));
  } catch (e) { stat.err += chunk.length; console.log(`  ✖ ${i}~${i + chunk.length}: ${e.message}`); continue; }
  chunk.forEach((d, k) => {
    const r = d.data(); const n = out[k];
    if (!n) { stat.err++; return; }
    const oldP = parseDisplayedAddress(S(r.주소)), newP = parseDisplayedAddress(S(n.주소));
    const matched = Boolean(n.matchSource);
    if (!matched) {
      stat.unmatched++; push('unmatched', `${r.주소} → ${n.확인사유 || '(사유 없음)'}`);
      if (n.확인필요 && !r.확인필요) {
        stat.flag++;
        plan.push({ ref: d.ref, patch: { 확인필요: true, 확인사유: S(n.확인사유) }, data: r, kind: 'flag', before: r.주소, after: r.주소 });
      }
      return;
    }
    stat.matched++;
    // 도로명이 달라지면 식별자도 다른 도로의 것일 수 있다 → 아무것도 쓰지 않는다
    if (oldP.road !== newP.road) { stat.holdRoad++; push('holdRoad', `${r.주소}  ⇒  ${n.주소}`); holds.push({ before: r.주소, after: n.주소, why: '도로명 변경' }); return; }
    // ★주소 텍스트를 바꾸는 것은 detailMove(괄호→상세 건물동)·bldgMove(상세→괄호 건물명)뿐.
    //   그 외 상세 변경·괄호 변경은 주소를 두고 **식별자만** 채운다(2026-08-23 전량 dry-run에서 `3- 302호`→`302호`(1~2자리 대시동 소실)·
    //   `준203호`→괄호 `준`(콤마 경로 A-38 미적용) 같은 엔진 결함이 보여 주소 재작성은 안전한 형태로만 제한).
    let kind = 'same'; let addrChange = false;
    if (oldP.detail !== newP.detail) {
      if (isDetailMove(oldP, newP)) { kind = 'detailMove'; addrChange = true; }
      else if (isBldgMove(oldP, newP, n.buildingName)) { kind = 'bldgMove'; addrChange = true; }
      else { kind = 'holdDetail'; stat.holdDetail++; push('holdDetail', `${r.주소}  ⇒  ${n.주소}`); holds.push({ before: r.주소, after: n.주소, why: '상세 변경(식별자만 기록)' }); }
    } else if (oldP.paren !== newP.paren) {
      kind = 'paren'; stat.paren++; push('paren', `${r.주소}  ⇒  ${n.주소}`); holds.push({ before: r.주소, after: n.주소, why: '괄호 변경(식별자만 기록 · 검토)' });
    }
    if (kind === 'same' || kind === 'detailMove' || kind === 'bldgMove') stat[kind]++;
    if (addrChange) push(kind, `${r.주소}  ⇒  ${n.주소}`);
    const patch = {
      standardRoadAddress: S(n.standardRoadAddress), addressMgtNo: S(n.addressMgtNo), buildingMgtNo: S(n.buildingMgtNo),
      roadName: S(n.roadName), buildingMainNo: n.buildingMainNo ?? null, buildingSubNo: n.buildingSubNo ?? null,
      matchedSido: S(n.matchedSido), matchedSigungu: S(n.matchedSigungu),
      addressMatchSource: S(n.matchSource), addressMatchConfidence: n.matchConfidence ?? null,
      isApt: Boolean(n.isApt), 확인필요: Boolean(n.확인필요), 확인사유: S(n.확인사유),
    };
    if (n.routeHints && typeof n.routeHints === 'object') patch.routeHints = n.routeHints;
    if (addrChange) {
      Object.assign(patch, {
        주소: S(n.주소), legalDong: S(n.legalDong), 법정동: S(n.법정동 || n.legalDong), 리: S(n.리),
        buildingName: S(n.buildingName), 건물명: S(n.buildingName), detailAddress: S(n.detailAddress || n.상세주소),
      });
      const keep = S(n.특이사항);   // M-1: 옛 괄호 건물명이 DB명과 달라 엔진이 보존용으로 돌려준 문구
      if (keep) { const merged = appendUniqueNote(S(r.특이사항), keep); if (merged !== S(r.특이사항)) patch.특이사항 = merged; }
    } else {
      // 주소 동일 — 식별자와 함께 DB 확정 법정동/건물명이 비어 있을 때만 채운다
      if (!S(r.legalDong) && S(n.legalDong)) { patch.legalDong = S(n.legalDong); patch.법정동 = S(n.legalDong); }
      if (!S(r.buildingName) && S(n.buildingName)) { patch.buildingName = S(n.buildingName); patch.건물명 = S(n.buildingName); }
    }
    plan.push({ ref: d.ref, patch, data: r, kind, before: r.주소, after: n.주소 });
  });
  if ((i / BATCH) % 20 === 0) console.log(`  … ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
}

console.log(`\n결과: 매칭 ${stat.matched} · 미매칭 ${stat.unmatched}(확인필요 표시 ${stat.flag}) · 오류 ${stat.err}`);
console.log(`  주소 동일(식별자만) ${stat.same} · 주소 변경 허용: 건물동 이동 ${stat.detailMove} · 건물명→괄호 ${stat.bldgMove} · 식별자만(주소 보존): 상세 변경 ${stat.holdDetail} · 괄호 변경 ${stat.paren} · 미기록: 도로명 변경 ${stat.holdRoad}`);
for (const k of ['paren', 'detailMove', 'bldgMove', 'holdRoad', 'holdDetail', 'unmatched']) {
  if (!samples[k].length) continue;
  console.log(`  [${k}] 예시:`);
  for (const s of samples[k]) console.log(`     ${s}`);
}
const stamp = new Date().toISOString().slice(0, 10);
const dir = path.join(os.homedir(), 'Desktop'); mkdirSync(dir, { recursive: true });
const tag = CITY.replace(/\s+/g, '_');
const holdPath = path.join(dir, `nexus_재정제_보류_${tag}_${MONTH}_${stamp}${WRITE ? '' : '_dryrun'}.txt`);
writeFileSync(holdPath, holds.map((h) => `${h.why}\t${h.before}\t⇒\t${h.after}`).join('\n'), 'utf8');
console.log(`보류(주소 보존) 목록 ${holds.length}건: ${holdPath}`);

if (WRITE && plan.length) {
  writeFileSync(path.join(dir, `nexus_재정제_백업_${tag}_${MONTH}_${stamp}.json`), JSON.stringify(plan.map((x) => ({ path: x.ref.path, data: x.data })), null, 2), 'utf8');
  for (let i = 0; i < plan.length; i += 499) {
    const batch = db.batch();
    for (const x of plan.slice(i, i + 499)) batch.set(x.ref, { ...x.patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
    console.log(`  반영 ${Math.min(i + 499, plan.length)}/${plan.length}`);
  }
  await db.collection('audit_logs').add({ action: 'repurify-month', city: CITY, monthId: MONTH, count: plan.length, stat, at: admin.firestore.FieldValue.serverTimestamp() });
  console.log(`반영 완료 ${plan.length}건 · 백업/보류 목록 바탕화면 · audit_logs 기록`);
}
process.exit(0);
