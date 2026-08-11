# 🔁 HANDOFF — nexus-pipeline (2026-08-12 05:10 KST)

> 새 세션에서 **"이어서"** 라고 하면 이 문서 → `좌표관리_설계.md` → `PROJECT_STATUS.md` 순으로 읽고 재개.
> 상세 근거·실측은 전부 **`좌표관리_설계.md` §5-2 ~ §5-7** 에 박제돼 있다. 여기는 현재 상태와 다음 할 일만.

## 현재 상태 — 좌표 관리 C 시리즈 **전 단계 완료**

입구 / 중심 / 동(棟) 3종이 모두 채워졌다.

| 지표 | 값 |
|---|---|
| `building_coord` | **37,064건물** (하루 전 1,543 → 24배) |
| ├ **입구 좌표**(행안부 출입구 자료) | **37,028 (99.9%)** · 출처 전부 `juso_entrc` |
| ├ 중심 좌표 | 37,040 |
| └ 좌표 전무 | 24 |
| 동 좌표 | 4,873행 / 2,478건물 |
| `entrance_core` | **6,420,581행**(전국 16개 시도) |
| 명단 좌표 커버리지 | **99.7%** (16개 명단 98,020건 · 미보유 316) |
| 이상치 표시 | 4건(C-6 ⑥이 첫 정기 실행에서 검출) |

**입구 ↔ 중심 거리: 평균 9.5m · 최대 883.7m · 50m 초과 889건.**
그 889건이 이번 작업의 값어치다 — 지금까지 건물 중심을 목적지로 받던 곳들이다.

### 운영 구성

Cloud Run 서비스 `nexus-address-api` 리비전 **`00071-qr2`**(롤백 지점 `00066-znm`).
Cloud Function **`geocodeAuto`**(3분마다) — 명단 `lat/lng` 를 채운다. **좌표 저장소를 먼저 본다**(아래 ⚠️).

| Job | 하는 일 | 스케줄 | 메모리/타임아웃 |
|---|---|---|---|
| `nexus-address-sync` | ①~⑥ 정기 동기화(C-6 ⑤채움·⑥이상치 포함) | 매일 **04:23** | 1Gi / 3600s |
| `nexus-address-listfill` | **명단 → 좌표저장소 행 만들기**(C-6 이 못 메우는 구멍) | 매주 **월 05:00** | 1Gi / 7200s |
| `nexus-address-entrc` | C-7 출입구 자료 적재(기본 예행) | 수동 | 2Gi / 14400s |
| `nexus-address-fill` | 진단·격리·백필(=`--args` 갈아 끼우는 자리) | 수동 | 1Gi / 1800s |

⚠️ **Job 4개가 같은 소스를 쓴다.** 코드를 고치고 하나만 재배포하면 나머지는 옛 이미지로
**에러 없이 다른 동작**을 한다 → 배포는 `bash scripts/deploy-jobs.sh` 로 한 번에.

---

## 다음 할 일

1. **⚠️ 서울 동대문구 `no_anchor` 268건(2개월)** ← 다음 1순위 · 미조사
   전 명단 채움에서 동대문만 98.3%(다른 곳 99.8~100%). 미보유가 **전부 `no_anchor`** 이고
   주소가 **`한천로58길`** 에 몰려 있다. `/v1/address/match` 는 200 을 주는데
   `/v1/coords/resolve` 만 `no_anchor` → 앵커(`road_codes` 조회·`pickRoadCode`) 쪽으로
   **보이지만 단정하지 말 것**. `scripts/probe-address.mjs` 로 후보를 실제로 확인하고 판단하라.
   같은 도로에 몰려 있어 원인 하나로 268건이 풀릴 가능성이 있다.

2. **`parseAptDong` 오탐 24건** — 도로명 부번을 동으로 읽는다(`동서로 895-24 → 895동`).
   좌표만의 문제가 아니다: 같은 함수를 순번 엔진이 쓰므로 **단독주택 24채가 한 동으로 묶인다**.
   순번 핵심이라 손대지 않았다. 고치려면 **전 명단에서 `호` 없는 정상 동호 표기가 쓰이는지
   먼저 실측**할 것(있으면 `호` 필수화는 퇴행이다). 설계서 §5-3-A.
   ※ 별도 세션에서 진행 중일 수 있음 — 중복 작업 주의.

3. (선택) **입구 좌표를 기사 화면·순번에 실제로 쓰기**
   저장소에는 채워졌고 `pickStoreCoord('navigation')` 이 입구를 우선하지만,
   명단 `lat/lng` 를 채우는 `geocodeAuto` 는 **동 → 입구 → 중심** 순이라 단지형은 동 좌표를 쓴다
   (지도·순번용으로는 그게 맞다). 내비 링크가 입구를 쓰는지는 `buildNavigationLinks` 확인 필요.

4. (관찰) C-6 이 매일 04:23 에 돈다. **요약의 `★다음으로 이월` 이 이틀 연속 안 줄면** 막힌 것이다(F7).

---

## ⚠️ 다음 명단 업로드 때 반드시 볼 것

`geocodeAuto` 가 이제 카카오·지오코딩 **전에** 좌표 저장소를 본다. 지금은 16개 월이 전부
`coordsDone=true` 라 **일감이 없어 조용히 return** 한다 — 실동작은 새 명단이 올라올 때 드러난다.
```
gcloud logging read 'resource.labels.service_name="geocodeauto" AND textPayload:"[geocodeAuto]"' --project logis-op --account ttong627@gmail.com --limit 5 --format="value(textPayload)"
```
`성공 N (저장소 X · 지오코딩 Y)` 에서 **X 가 대부분이어야 정상**이다. Y 가 대부분이면 배관이
또 끊긴 것(주소 API 장애·규칙 불일치·저장소 미채움).
사전 실측(명단 100건 같은 규칙 적용): 저장소가 **100% 대줌**(동 29·중심 71), 외부 호출 0.

---

## 이번 세션에서 막은 것 (에러 없이 조용히 망가지는 것들)

1. **무한루프** — 앵커 못 만든 건은 `updated_at` 이 안 밀려 배치가 같은 200건을 하루 종일 다시 꺼낸다. 에러도 쿼터 소모도 없어 로그상 정상으로 보인다 → `touchCoordRows`.
2. **시간 예산 부재** — VWorld 초당 2건 × 20,000건 = 2.8시간 > Job 3600초. 잘린 실행은 요약 로그를 안 남긴다 → ⑤에 1,200초 상한.
3. **최소 표본 3** — 3건짜리 지자체는 그 3건 위치가 중심이 돼 정상 좌표를 무더기로 outlier 로 만든다 → 기본 20.
4. **요약이 `undefined`** — 대상 0건 경로가 통계 없는 객체 반환. "0건이라 안 돈 것"과 "고장 나서 안 돈 것"의 구분이 사라진다.
5. **Docker 컨텍스트** — 루트 `src/` 파일은 서버 이미지에 안 들어간다 → shared 이관(`git mv` + 재수출 스텁).
6. **★C-5 "완료"가 거짓이었다** — 2026-06-06 에 무력화된 함수 안에 코드를 넣고 완료로 기록했다. **호출부를 세지 않았다.** → §6 완료 판정에 "호출부 확인" 추가.
7. **★재이관이 격리를 되살린다** — `apply-coords-schema` 의 이관 쿼리가 `match_type` 을 안 봐서, 다시 돌리면 C-4-b·C-4-c 격리(374행)가 `matched='dong'` 으로 부활한다 → `IS DISTINCT FROM 'suspect'` 추가 + `--schema-only` 분리. **예행이 잡았다.**
8. **동 정보 없는 단지 반복 조회** — VWorld 에 동이 없는 **103개 단지**를 매번 다시 물었다 → `dong_probed_at` 으로 주기 대기(기본 30일).
9. **gcloud `--args` 구분자** — `^:^` 가 `gs://` 의 `://` 를 쪼개 Job 이 `scandir 'gs'` 로 즉사. **구분자는 값에 없는 문자로**(GCS 경로면 `^|^`).

---

## 검증 상태
- address-service **275/275** · 루트 **281/281** · eslint **0 error** · `npx vite build` **EXIT=0**
- Red-Green 실측: 이상치 최소표본·중복표시 가드·동 재조회 억제(dongCount 가드·주기) 전부 양방향 확인
- 미커밋 없음 · origin/main 동기

## 참고
- **설계·실측 SSOT**: `좌표관리_설계.md`
  (§5-2 C-3 / §5-3 C-5+정정 / §5-3-A 명단채움 / §5-4 C-4-c / §5-5 C-6 / **§5-6 C-7** / **§5-7 C-6 첫 정기실행** / §6 완료판정)
- 핵심 코드: `src/coords/{coordStore,coordFill,coordQuery,coordWrite,coordOutlier}.js` ·
  `src/vworld.js` · `src/shared/coordValidator.js`(화면과 공용) · 클라 `src/utils/coordStoreApi.js` ·
  `functions/index.js` `geocodeAuto`
- 도구(전부 기본 dry-run, 쓰기는 `--apply`):
  `fill-list-coords.mjs`(명단 채움·`--all`) · `fill-coords.mjs` · `backfill-entrance-coords.mjs` ·
  `load-juso-entrc.mjs`(`gs://` 지원) · `apply-coords-schema.mjs`(`--schema-only`) ·
  `quarantine-dong-{cache,samecoord}.mjs` · 진단 `diag-coords/diag-vworld/probe-dong/probe-address`
- 회귀 잠금: `services/address-service/scripts/{coord-fill,coord-store,coord-outlier,vworld-retry}.test.mjs` ·
  루트 `scripts/{db-guard,coord-store-api}.test.mjs`
- **C-7 자료 원본**: `D:\Gemma4\govt_delivery_analysis\data\juso_db\` (전국 16개 시도 876MB) ·
  GCS 사본 `gs://logis-op-address-source/entrc/`

## 운영 명령 규칙
- gcloud 는 **매 호출** `--account ttong627@gmail.com`.
- git push 는 전역 계정 전환 없이 토큰 주입:
  `GH_TOKEN=$(gh auth token --user ttong627) git -c credential.helper='!gh auth git-credential' push origin main`
- Job `--args` 에 쉼표가 있으면 커스텀 구분자를 쓰되 **값에 없는 문자**로 고를 것.
  GCS 경로가 인자면 `^|^`: `--args='^|^scripts/load-juso-entrc.mjs|gs://…|--apply'`
  바꾼 뒤 `describe --format="value(...containers[0].args.list())"` 로 **눈으로 확인**.
- 정기배치 로그:
  `gcloud run jobs executions list --job nexus-address-sync --region asia-northeast3 --project logis-op --account ttong627@gmail.com --limit 3`
  → 실행 이름으로
  `gcloud logging read 'resource.type="cloud_run_job" AND labels."run.googleapis.com/execution_name"="<이름>"' --project logis-op --account ttong627@gmail.com --format="value(textPayload)" --order asc`
