// 주소 품질 정기 모니터링 — 읽기 전용. 새 오염을 조기 발견해 텔레그램으로 알린다.
//   측정 4종을 이전 스냅샷과 비교해 **악화됐을 때만** 알림(조용한 운영).
//     ① 괄호 구조 붕괴(P0)  ② 괄호 잡값(P1-b)  ③ 표기 갈림  ④ 식별자 보유율
//
//   형 방침: 읽기 전용(쓰기 0) · PII 미조회·미출력 · 정상이면 침묵.
//
//   사용:
//     node scripts/monitor-address-quality.mjs            # 측정·비교(악화 시에만 텔레그램)
//     node scripts/monitor-address-quality.mjs --always   # 결과와 무관하게 항상 전송
//     node scripts/monitor-address-quality.mjs --no-send  # 전송 없이 콘솔만
import admin from 'firebase-admin';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { parseDisplayedAddress, splitParenInner, cleanAddressPiece } from '../src/utils/addressFormat.js';
import { classifyParenParts } from '../src/utils/parenCleanup.js';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const args = process.argv.slice(2);
const ALWAYS = args.includes('--always');
const NO_SEND = args.includes('--no-send');
const SNAPSHOT = new URL('../.address-quality-snapshot.json', import.meta.url);
const TG = 'D:\\Gemma4\\_tools\\tg_send.py';

const norm = (v) => cleanAddressPiece(v);
const REF_BLOCK_RE = /\[참고:[^\]]*\]/g;

const main = async () => {
  const m = {
    total: 0, withAddr: 0,
    brokenParen: 0,      // ① 괄호 짝 붕괴·상세 잔재
    parenJunk: 0,        // ② 괄호에 건물명 아닌 값
    hasStdRoad: 0, hasMgtNo: 0, hasAptKey: 0,
  };
  const shapes = new Map();   // mgtNo -> Set(도로명|괄호)

  const cities = await db.collection('cloud_lists').listDocuments();
  for (const cityRef of cities) {
    for (const monthRef of await cityRef.collection('months').listDocuments()) {
      const snap = await monthRef.collection('records').get();
      for (const doc of snap.docs) {
        const r = doc.data();
        m.total++;
        const addr = norm(r.주소);
        if (!addr) continue;
        m.withAddr++;

        const legalDong = norm(r.legalDong || r.법정동);
        const std = norm(r.standardRoadAddress);
        const mgt = norm(r.buildingMgtNo);
        if (std) m.hasStdRoad++;
        if (mgt) m.hasMgtNo++;
        if (norm(r.routeHints?.apartmentGroupKey)) m.hasAptKey++;

        const p = parseDisplayedAddress(addr);
        // ① 괄호 구조 붕괴 — 상세에 괄호 잔재 또는 전체 짝 불균형
        const detailNoRef = p.detail.replace(REF_BLOCK_RE, ' ');
        const open = (addr.match(/\(/g) || []).length;
        const close = (addr.match(/\)/g) || []).length;
        if (/[()]/.test(detailNoRef) || open !== close) m.brokenParen++;
        // ② 괄호 잡값
        else if (legalDong && classifyParenParts(p.paren, legalDong).changed) m.parenJunk++;

        // ③ 표기 갈림(건물관리번호 기준)
        if (mgt) {
          if (!shapes.has(mgt)) shapes.set(mgt, new Set());
          shapes.get(mgt).add(`${norm(p.road)}|${norm(p.paren)}`);
        }
      }
    }
  }
  let splitGroups = 0;
  for (const s of shapes.values()) if (s.size > 1) splitGroups++;

  const cur = {
    at: new Date().toISOString(),
    total: m.total,
    brokenParen: m.brokenParen,
    parenJunk: m.parenJunk,
    splitGroups,
    mgtNoRate: m.withAddr ? Number((m.hasMgtNo / m.withAddr * 100).toFixed(1)) : 0,
    stdRoadRate: m.withAddr ? Number((m.hasStdRoad / m.withAddr * 100).toFixed(1)) : 0,
  };

  const prev = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : null;
  const d = (k) => (prev ? cur[k] - prev[k] : 0);
  const worse =
    d('brokenParen') > 0 || d('parenJunk') > 0 || d('splitGroups') > 0 ||
    (prev && cur.mgtNoRate < prev.mgtNoRate - 0.5) ||
    (prev && cur.stdRoadRate < prev.stdRoadRate - 0.5);

  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
  const lines = [
    `[nexus 주소품질] ${cur.total.toLocaleString()}건`,
    `괄호붕괴 ${cur.brokenParen}${prev ? ` (${sign(d('brokenParen'))})` : ''}`,
    `괄호잡값 ${cur.parenJunk}${prev ? ` (${sign(d('parenJunk'))})` : ''}`,
    `표기갈림 ${cur.splitGroups}그룹${prev ? ` (${sign(d('splitGroups'))})` : ''}`,
    `건물관리번호 ${cur.mgtNoRate}% · 정본 ${cur.stdRoadRate}%`,
  ];
  const body = lines.join('\n');
  console.log(`\n${body}\n`);
  console.log(prev ? (worse ? '판정: ⚠️ 악화 — 알림 전송' : '판정: 정상(악화 없음)') : '판정: 최초 실행 — 기준선 저장');

  writeFileSync(SNAPSHOT, JSON.stringify(cur, null, 2), 'utf8');

  if (!NO_SEND && (worse || ALWAYS)) {
    const head = worse ? '⚠️ 주소품질 악화 감지\n' : '주소품질 정기점검\n';
    const tip = worse ? '\n\n조치: node scripts/repair-nested-paren.mjs / cleanup-paren-junk.mjs (기본 dry-run)' : '';
    // tg_send.py는 완료 출력에 이모지를 쓰는데 Windows 기본 cp949로는 인코딩이 깨져
    // **전송에 성공하고도** 마지막 print에서 예외로 죽는다. 형 도구는 건드리지 않고
    // 자식 프로세스 표준출력 인코딩만 UTF-8로 지정해 회피한다.
    const res = spawnSync('python', [TG, '--text', head + body + tip], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    console.log(res.status === 0 ? '텔레그램 전송 완료' : `텔레그램 전송 실패: ${(res.stderr || '').trim().slice(0, 200)}`);
  }
  process.exit(0);
};

main().catch(e => { console.error('모니터링 실패:', e.message); process.exit(1); });
