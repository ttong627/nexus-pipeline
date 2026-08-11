# 🔁 HANDOFF — nexus-pipeline (2026-08-11 21:48)

> 새 세션에서 **"이어서"** 라고 하면 이 문서 → `좌표관리_설계.md` → `PROJECT_STATUS.md` 순으로 읽고 재개.
> 상세 근거·실측 수치는 전부 **`좌표관리_설계.md` §5-2 ~ §5-4** 에 박제돼 있다. 여기는 요약과 다음 단계만.

## 지금 하는 일
- **좌표 관리(C 시리즈)** — 입구/중심/동 좌표 3종 구분 관리.
- 진행: **C-1·C-2·C-3·C-4·C-4-b·C-4-c 완료 · C-5 대부분 완료 · C-6·C-7 미착수.**
- 오늘 main `4ffff61 → 9160d18` (커밋 12개, 전부 push 완료).

## 완료 (2026-08-11)

| 항목 | 결과 |
|---|---|
| **C-3 채움 파이프라인** | 중심 좌표 **1,543 / 1,543 (100%)** · 출처 vworld 396 + kakao 947 · `quality='none'` 0 |
| **C-4-b 구 캐시 오염 격리** | `address_geocode_cache` dong:* **356행** suspect · 잔여 0 |
| **C-4-c 같은 좌표 공유 동 격리** | 두 테이블 **각 18행** suspect · 잔여 0 |
| **C-5 클라 연동** | 배치 조회(`mode:'cache'`) 전환 · 미보유 경고 노출 · 동 좌표 채움 개통 |
| **VWorld 실패율 70% → 0%** | 초당 2건 제한 + 502 재시도. 실측 800/800 |
| **단방향 이름매칭 수정** | VWorld 가 단지명을 줄여 줌(`여월휴먼시아` vs `여월휴먼시아2단지아파트`) — **모든 단지에 영향** |
| **동 표기 파싱 통일** | `toDongNo` — 값이면 정규화, 이름이면 추출. `'201'` 이 살아났다 |

**운영 반영**: Cloud Run 서비스 `nexus-address-api` 리비전 **`00071-qr2`** (롤백 지점 `00066-znm`).
신규 Job **`nexus-address-fill`**(진단·채움·격리 스크립트를 `--args` 로 갈아 끼워 쓴다).

### 오늘 잡은 "조용한 결함" 목록 (전부 에러 없이 틀렸던 것들)
1. `pickDong` 의 `|| byDong[0]` 폴백 — 단지명 검증 실패해도 아무 건물이나 채택(오염 원인)
2. 키 없는 출처가 쿼터를 차감 — 호출 0회인데 "100건 사용" 보고
3. 맞출 동이 없는데 BBOX 호출 — 100회 낭비
4. 속도제한기 동시성 경합 — 설정 0.7/초가 실효 2.1/초(정확히 3배)
5. 중심이 있으면 동 좌표를 영영 안 채움 — 명단 4건 전부 skip
6. 대단지 2차 BBOX 확장 누락 — `matchDongCoord` 에만 있고 새 경로엔 없었다
7. 단방향 이름 매칭 — BBOX 에 22건 있는데 전부 기각
8. 동 파싱이 경로마다 다름 — `'201'` 이 한쪽에선 빈 값

## 다음 단계 (이어서 할 일)

1. **C-6 정기 배치 편입** ← 다음 1순위
   `scripts/sync-address-data.mjs`(매일 04:23 Job `nexus-address-sync`)에 두 단계 추가:
   - ⑤ 좌표 미보유 건물 채우기 — 일일 상한 내(`COORD_FILL_VWORLD_LIMIT` 기본 20,000)
   - ⑥ 좌표 이상치 검증 — `src/engine/coordValidator.js` 의 `detectCoordOutliers`(중앙값 25km) 재사용,
     `quality='outlier'` 로 **표시만** 하고 좌표는 지우지 않는다(DS-15)
   ⚠️ VWorld 는 **초당 2건**이 상한이다. 대량이면 시간이 걸리니 Job 타임아웃(현재 1800초) 확인할 것.

2. **C-5 잔여 — 명단 전체로 동 좌표 채우기**
   지금은 개통만 확인했다(단건 실측). 실제 명단 1건을 `mode:'fill'` 로 돌려
   **미보유 0 달성**을 확인해야 §5 검증 기준을 채운다.

3. **C-7 출입구 자료 적재** — 🚫 **형 확인 대기**(아래 열린 결정)

4. (선택) `matched='complex'` 캐시 정책 재검토 — 시화5차평안마을건영처럼 VWorld 에
   동이 없는 단지는 매번 complex 를 캐시한다. 지금은 무해(클라가 `'dong'` 만 채택)하나,
   "동이 원래 없는 단지"를 표시해 두면 재조회를 줄일 수 있다.

## 열린 결정 (형 답 대기)
- **C-7 행안부 출입구 자료(`RNENTDATA`·`AlterD.JUSUEC`) 파일이 어디 있는가?**
  계정 인증으로 내려받는 파일이라 위치를 알려주셔야 `load-juso-entrc.mjs` 를 돌린다.
  이게 있어야 **입구 좌표**(현재 0건)가 채워진다. C-1~C-6 은 없어도 전부 진행 가능.
- 시흥·부천 외 **다른 지자체 명단도 지금 좌표를 채울지** — 하루 한도(VWorld 20,000)는 여유가 크다.

## 검증 상태
- address-service **250/250 pass** · 루트 **281/281 pass** · eslint **0 error** · `npx vite build` **EXIT=0**
- **미커밋 변경 없음** (`git status -s` 비어 있음) · origin/main 과 동기 (`9160d18`)
- 운영 스모크: `/v1/address/match` 0.1~0.28초 · `/v1/coords/status` total 1,543 / center 1,543 / 전무 0 · dict typo 23건

## 참고
- **설계·실측 SSOT**: `좌표관리_설계.md` (§5-2 C-3 / §5-3 C-5 / §5-4 C-4-c / §6 완료판정)
- 진단 도구(전부 읽기 전용, `nexus-address-fill` Job 으로 실행):
  `scripts/diag-coords.mjs` · `diag-vworld.mjs` · `probe-dong.mjs` · `probe-address.mjs`
- 격리·채움(기본 dry-run, 쓰기는 `--apply`):
  `scripts/fill-coords.mjs` · `quarantine-dong-cache.mjs` · `quarantine-dong-samecoord.mjs`
- 핵심 코드: `src/coords/{coordStore,coordFill,coordQuery,coordWrite}.js` · `src/vworld.js` ·
  클라 `src/utils/coordStoreApi.js`
- 회귀 잠금: `services/address-service/scripts/{coord-fill,coord-store,vworld-retry}.test.mjs` ·
  루트 `scripts/{db-guard,coord-store-api}.test.mjs`
- **운영 명령 규칙**: gcloud 는 매 호출 `--account ttong627@gmail.com`.
  git push 는 전역 계정 전환 없이 토큰 주입:
  `GH_TOKEN=$(gh auth token --user ttong627) git -c credential.helper='!gh auth git-credential' push origin main`
  Job `--args` 에 쉼표가 들어가면 `--args="^|^a|b|c"` 구분자를 쓸 것(gcloud 가 쉼표를 인자 구분자로 먹는다).
