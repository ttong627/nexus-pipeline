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

1. **✅규명·수정 완료 / ⏳배포 대기 — 동대문구 `no_anchor`**(설계서 **§5-8**)
   원인은 **같은 시군구에 같은 도로명 코드가 둘**(`한천로58길` → `112304115640`·`112304121702`).
   `pickRoadCode` 가 A-30대로 비웠고 앵커가 없으니 저장소에 **행 자체가 안 생겨** C-6 이
   영영 못 보는 상태였다. 두 코드는 **번지 구간이 갈리므로**(22~209 / 240) 본번·부번으로
   유일하게 결정된다 → `pickRoadCodeByBuilding` 신설(`address_building_links` 근거).
   덤: **세종시는 원본 시군구 칸이 빈 값**(2,647행)이라 세종 명단이 오면 전량 `no_anchor` 였다.
   - 코드: `src/coords/coordStore.js` · `coordQuery.js` / 회귀 `scripts/coord-store.test.mjs` +3
   - 검증: address-service 278/278 · 루트 281/281 · eslint 0 · Red-Green 확인
   - ✅ **배포·검증 완료**(2026-08-12): 서비스 `00072-hwf`(롤백 `00071-qr2`) · Job 4개 재배포.
     `/v1/coords/resolve` 실측 — 한천로58길 **6개 주소 전부 앵커 생성**(`112304115640#0#…`,
     설계서가 예측한 그 코드) + 세종 한누리대로도 생성(`361102000002#0#2130-0`). **7/7**.
     `no_anchor` → `unknown` 으로 바뀌었다 = 이제 채움 대상이 된다.
   - **남은 것**: 명단 채움 실행 → 동대문 커버리지 재측정.

     ⚠️ **`--apply` 는 로컬에서 안 된다** — 서버판은 in-process 로 DB 에 직접 붙는데
     Cloud SQL 은 로컬에서 접근 불가다(`필수 환경변수가 없습니다: databaseUrl`).
     `--list`·조회만 로컬 가능. **채움은 반드시 Job 으로**:
     ```
     gcloud run jobs execute nexus-address-listfill --region asia-northeast3 --project logis-op --account ttong627@gmail.com --wait
     ```
     `--all --apply` 라 16개 명단을 전부 돈다. 이미 채운 건은 `cached` 로 빠르게 지나가고
     **앵커가 새로 생긴 건만** 채운다(동대문 266건 + 다른 지자체의 같은 유형 52종 중 해당분).

2. ~~`parseAptDong` 오탐~~ ✅ **완료·머지됨**(2026-08-12, 별도 워크트리 → main).
   전 명단 **98,020건 전수 실측** 후 `호` 필수화(규칙 **DS-18** · 근거 §5-3-B).
   오탐 4,357건 제거(도로 부번 4,229 · 전화번호 117 · 괄호 지번 11) + **578건은 오탐에
   가려져 있던 진짜 동을 회복**(`중앙로 265-36, 106-1305호 우방아파트` → 265동 ❌ → 106동 ✅).
   `호` 없는 정상 동호 표기는 **0건**이라 퇴행 없음. `RouteMapModal` 복제본도 SSOT import 로 제거.
   회귀 `scripts/apt-dong-parse.test.mjs` 19 PASS · 실측 도구 `scripts/measure-dong-parse.mjs`(읽기 전용).
   ⚠️ **아직 배포 안 됨** — 순번은 클라(Firebase Hosting)라 `npm run build && firebase deploy` 필요.

3. **내비 링크는 이미 입구를 쓴다 — 확인 완료.** `/v1/delivery/resolve` → `deliveryBrief.pickCoordinate`
   가 `juso_entrance`(측량) 를 1순위로 고르고 `navigationFromBrief` 가 그 좌표로 링크를 만든다.
   ⚠️ 다만 **좌표 선택 규칙이 두 벌**이다 — `coordStore.pickDeliveryCoord`(building_coord 기반)는
   **호출부 0건**(정의·테스트뿐). 죽은 규칙이 살아 있는 규칙과 갈리면 C-5 사고가 반복된다.
   → 통합하거나 지울 것(§6 "호출부를 세라").

4. (관찰) C-6 **2026-08-12 04:23 실행 정상**(`nexus-address-sync-qw887`, exit 0).
   채움 대상 0건 · 이상치 4건 표시 유지. **단 이 "0건"은 저장소에 행이 있는 건만 센 값이다**
   — 1번의 `no_anchor` 는 여기 안 잡힌다(§5-3-A 모집단 함정). 배포 후 다시 볼 것.

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
