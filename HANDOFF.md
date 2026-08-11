# 🔁 HANDOFF — nexus-pipeline (2026-08-11 23:20)

> 새 세션에서 **"이어서"** 라고 하면 이 문서 → `좌표관리_설계.md` → `PROJECT_STATUS.md` 순으로 읽고 재개.
> 상세 근거·실측 수치는 전부 **`좌표관리_설계.md` §5-2 ~ §5-5** 에 박제돼 있다. 여기는 요약과 다음 단계만.

## 지금 하는 일
- **좌표 관리(C 시리즈)** — 입구/중심/동 좌표 3종 구분 관리.
- 진행: **C-1~C-6 전부 완료 · C-7 형 확인 대기.**
- 오늘 main `4ffff61 → 973b6ce`.

## 완료 (2026-08-11)

| 항목 | 결과 |
|---|---|
| **C-3 채움 파이프라인** | 중심 좌표 **1,543 / 1,543 (100%)** · 출처 vworld 396 + kakao 947 · `quality='none'` 0 |
| **C-4-b 구 캐시 오염 격리** | `address_geocode_cache` dong:* **356행** suspect · 잔여 0 |
| **C-4-c 같은 좌표 공유 동 격리** | 두 테이블 **각 18행** suspect · 잔여 0 |
| **C-5 클라 연동 + 명단 채움** ✅ | 배치 조회 전환 · 미보유 경고 · **시흥 2026-07 실측: 내비 좌표 48.0% → 99.9%(9,550/9,557) · 미보유 4,971 → 7 · 동 좌표 59.0% → 87.5%**. `building_coord` 1,543 → 3,854 |
| **C-6 정기 배치 편입** ✅ | `sync-address-data.mjs` 에 ⑤좌표 채움 · ⑥이상치 검증. 예행 실측 = 채움 대상 0(이미 100%) · 이상치 **조회 1,543 / 검사 1,536 / 후보 0** |
| **VWorld 실패율 70% → 0%** | 초당 2건 제한 + 502 재시도. 실측 800/800 |
| **단방향 이름매칭 수정** | VWorld 가 단지명을 줄여 줌(`여월휴먼시아` vs `여월휴먼시아2단지아파트`) |
| **동 표기 파싱 통일** | `toDongNo` — 값이면 정규화, 이름이면 추출 |

**운영 반영**: Cloud Run 서비스 `nexus-address-api` 리비전 **`00071-qr2`** (롤백 지점 `00066-znm`).
Job **`nexus-address-sync`**(매일 04:23·--apply·타임아웃 3600초) **C-6 코드로 재배포 완료**.
Job **`nexus-address-fill`**(진단·예행용 — `--args` 를 갈아 끼워 쓴다).

### C-6 에서 새로 막은 것 (에러 없이 조용히 망가지는 것들)
1. **무한루프** — 앵커 못 만든 건은 `updated_at` 이 안 밀려 배치가 같은 200건을 하루 종일 다시 꺼낸다. 에러도 쿼터 소모도 없어 로그상 정상으로 보인다 → `touchCoordRows` 로 "봤다"를 찍는다.
2. **시간 예산 부재** — VWorld 초당 2건 × 20,000건 = 2.8시간 > Job 3600초. 잘린 실행은 요약 로그를 안 남긴다 → ⑤에 1,200초 상한.
3. **최소 표본 3** — 3건짜리 지자체는 그 3건 위치가 중심이 돼 정상 좌표를 무더기로 outlier 로 만든다(순번 엔진은 좌표 없음 취급) → 기본 20.
4. **시군구 없는 행** — 전국을 한 덩어리로 묶으면 서울과 부산이 서로를 이상치로 만든다 → 판정 제외.
5. **요약이 `undefined`** — 대상 0건 경로가 통계 없는 객체를 반환. "0건이라 안 돈 것"과 "고장 나서 안 돈 것"의 구분이 사라진다 → 첫 예행이 잡아 `f36f37a` 로 수리.
6. **Docker 컨텍스트** — `coordValidator.js` 가 루트 `src/` 에 있어 서버 이미지에 안 들어간다. 그냥 import 했으면 Job 에서 죽는다 → shared 이관(`git mv` + 재수출 스텁).

## 다음 단계 (이어서 할 일)

1. **전 명단 좌표 채우기** — 🔄 **2026-08-11 밤 실행 중**(`--all --apply`).
   16개 명단 98,020건 순차. 명단당 **약 15분**(부천 오정구 4,356건=897초 실측) → 총 4~5시간.
   중단돼도 채운 건 저장소에 남아 **재실행하면 캐시로 빨리 지나간다**. 한 명단이 실패해도
   나머지는 계속 돌고 끝에 명단별 표로 요약된다.
   ```
   node scripts/fill-list-coords.mjs --all --apply     # 전체
   node scripts/fill-list-coords.mjs --list            # 목록
   node scripts/fill-list-coords.mjs --city "<지자체>" --month <YYYY-MM>   # 하나만 실측
   ```
   ⚠️ **끝났는지 먼저 확인할 것** — 안 끝났으면 겹쳐 돌리지 말 것(같은 주소를 두 번 산다).

2. **`parseAptDong` 오탐 24건** — 도로명 부번을 동으로 읽는다(`동서로 895-24 → 895동`).
   **순번이 단독주택 24채를 한 동으로 묶는다.** 순번 엔진 핵심이라 손대지 않았다 — §5-3-A 참조.
   고치려면 전 명단에서 `호` 없는 정상 동호 표기가 있는지 먼저 실측할 것.

3. **동 좌표 미보유 ~606건** — VWorld 에 그 동이 없거나(`matched='complex'`) 후보 다수로
   안전 기각된 것. 규칙대로 동작한 결과지만, 어느 쪽인지 세어 두면 대응이 갈린다.

4. **C-7 출입구 자료 적재** — ✅ **자료 찾음**(아래). 남은 건 적재 범위 결정과 GCS 경로.

   **자료 위치**: `D:\Gemma4\govt_delivery_analysis\data\juso_db\`
   전국 16개 시도 `entrc_*.txt` · **6,420,581행** · 876MB · 2026-07-03 자료 ·
   `[레이아웃]위치정보요약DB.pdf` 동봉. ①위치정보요약DB(18필드) 포맷 — 파서가 기대하는 그것.
   `sql/entrance.sql` 주석의 "실측 6,407,110 좌표행·키 중복 0" 이 **바로 이 파일들**이다.

   **검증 완료**(`scan-juso-entrc.mjs --sample 3000`, 읽기 전용):
   파싱 100%(48,000/48,000) · 폐기 0 · cp949 깨짐 0 · 좌표변환 실패 0 · **시도이탈 0** ·
   무좌표 59(0.12%, 비공개 건물=정상).

   **⚠️ VWorld·카카오는 대안이 아니다** — 둘 다 주는 건 건물 **중심점**이고, 지오코딩 결과를
   입구 칸에 넣는 것은 F1 이 금지한다(차가 못 들어가는 곳을 목적지로 준다).

   **✅ 막혀 있던 곳 해결**(`2192ee4`): 적재기가 `gs://버킷/접두어` 를 받는다.
   파일별로 `/tmp` 에 받아 처리하고 **즉시 지운다** — 전체분은 2-pass(`buildClusters` →
   `processFile`)라 같은 파일을 두 번 읽으므로 스트림은 못 쓴다(재사용 불가·전송량 2배).
   이 방식은 **리더·로더·파서 무변경**이라 회귀 위험이 0이고, 상주 용량도 가장 큰 파일
   하나(경기 140MB)로 묶인다. 검증: 로컬 예행 16파일 80,000행 파싱 100%·폐기 0·격리 0.
   ⚠️ Job 메모리 **2Gi 이상** 필요(`/tmp` 가 tmpfs=메모리).

   **✅ 업로드·Job·전수 예행까지 끝났다**(2026-08-11).
   - GCS: `gs://logis-op-address-source/entrc/` — 16개 파일 876MB 업로드 완료
   - Job: **`nexus-address-entrc`**(메모리 2Gi · task-timeout 7200s · cloudsql · DATABASE_URL)
   - **전수 예행 실측**(`nexus-address-entrc-fgsws`, DB 무접촉):
     **6,420,581행 전량 파싱 · 폐기 0** · 무좌표 13,471(0.21%) · 격리 36(0.0006%) · 판정보류 34 ·
     변환실패 0. 경기 103만행 24.9초 · 16파일 약 180초.

   **남은 것은 `--apply` 하나뿐** — 형이 범위를 정하면 args 를 바꿔 실행한다:
   ```
   gcloud run jobs update nexus-address-entrc --args='^|^scripts/load-juso-entrc.mjs|gs://logis-op-address-source/entrc|--apply' --region asia-northeast3 --project logis-op --account ttong627@gmail.com
   gcloud run jobs execute nexus-address-entrc --region asia-northeast3 --project logis-op --account ttong627@gmail.com --wait
   ```
   범위를 좁히려면 GCS 접두어를 나누거나(`entrc/gyunggi/`) `--only` 를 쓴다.
   ⚠️ **좌표 채움(`--all`)이 도는 동안은 실행하지 말 것** — 같은 Cloud SQL(1 vCPU)에
   642만 행 INSERT 를 겹치면 채움이 500 으로 죽는다(2026-07-30·08-01 같은 패턴).

   **적재 범위 = 형 답 대기**. 명단이 있는 지자체는 경기·서울·인천·충남 4곳뿐이다.
   | 안 | 행수 | 비고 |
   |---|---|---|
   | 경기도 먼저(권장) | 1,032,284 | 시흥 명단이 이미 좌표 100% 라 **조인 성공률을 바로 실측**할 수 있다 |
   | 명단 4개 시도 | 2,237,815 | 현재 16개 명단 전부 커버 |
   | 전국 16개 시도 | 6,420,581 | 신규 지자체 즉시 대응. Cloud SQL 1 vCPU 적재 시간이 가장 김 |

5. (선택) `matched='complex'` 캐시 정책 재검토 — 시화5차평안마을건영처럼 VWorld 에
   동이 없는 단지는 매번 complex 를 캐시한다. 지금은 무해(클라가 `'dong'` 만 채택)하나,
   "동이 원래 없는 단지"를 표시해 두면 재조회를 줄일 수 있다. 위 3번과 함께 하면 좋다.

6. (관찰) C-6 이 매일 04:23 에 돈다. **요약 로그의 `★다음으로 이월` 이 이틀 연속 안 줄면**
   무언가 막힌 것이다(F7). 확인: 아래 로그 명령.

## 열린 결정 (형 답 대기)
- **C-7 적재 범위** — 경기도만(103만) / 명단 4개 시도(224만) / 전국(642만). 위 4번 표 참조.
  ~~자료 위치를 모른다~~ → **찾았다**(2026-08-11). `D:\Gemma4\govt_delivery_analysis\data\juso_db\`.
  형에게 물을 것은 이제 "어디 있나"가 아니라 "얼마나 넣을까"뿐이다.
- 시흥·부천 외 **다른 지자체 명단도 지금 좌표를 채울지** — 하루 한도(VWorld 20,000)는 여유가 크다.
  ⑥ 실측에서 지자체 5곳 중 **3곳이 표본부족(합 7건)** 으로 판정 보류였다. 명단이 들어오면 판정이 켜진다.

## 검증 상태
- address-service **269/269 pass**(C-6 신규 19) · 루트 **281/281 pass** · eslint **0 error** · `npx vite build` **EXIT=0**
- Red-Green 실측: 최소표본 20→3 으로 낮추면 2건 실패 · 중복표시 가드 제거 시 1건 실패 → 원복 후 16/16
- Job 예행 실측(`nexus-address-fill-l4j9k`): 요약 4줄 정상 · DB 무변경

## 참고
- **설계·실측 SSOT**: `좌표관리_설계.md` (§5-2 C-3 / §5-3 C-5 / §5-4 C-4-c / **§5-5 C-6** / §6 완료판정)
- C-6 핵심 코드: `src/coords/coordOutlier.js`(순수 판정) · `coordQuery.js`(`loadFillTargets`·`countFillTargets`·`loadCoordRowsForCheck`) ·
  `coordWrite.js`(`markOutlierRows`·`touchCoordRows`) · `shared/coordValidator.js`(화면과 공용)
- C-6 손잡이(전부 env 또는 `--플래그`): `--skip-coords` · `--coord-limit` · `--coord-retry-days`(기본 30) ·
  `--coord-budget-sec`(기본 1200) · `--coord-sigungu`
- 진단 도구(읽기 전용, `nexus-address-fill` Job 으로 실행):
  `scripts/diag-coords.mjs` · `diag-vworld.mjs` · `probe-dong.mjs` · `probe-address.mjs`
- 격리·채움(기본 dry-run, 쓰기는 `--apply`):
  `scripts/fill-coords.mjs` · `quarantine-dong-cache.mjs` · `quarantine-dong-samecoord.mjs`
- 회귀 잠금: `services/address-service/scripts/{coord-fill,coord-store,coord-outlier,vworld-retry}.test.mjs` ·
  루트 `scripts/{db-guard,coord-store-api}.test.mjs`
- **운영 명령 규칙**: gcloud 는 매 호출 `--account ttong627@gmail.com`.
  git push 는 전역 계정 전환 없이 토큰 주입:
  `GH_TOKEN=$(gh auth token --user ttong627) git -c credential.helper='!gh auth git-credential' push origin main`
  Job `--args` 에 쉼표가 들어가면 커스텀 구분자를 쓸 것(gcloud 가 쉼표를 인자 구분자로 먹는다).
  ⚠️ **구분자는 값에 없는 문자로 고를 것** — `^:^` 를 쓰다가 `gs://버킷/…` 의 `://` 가 쪼개져
  Job 이 `scandir 'gs'` 로 죽었다(2026-08-11 실측). GCS 경로가 인자면 `^|^` 를 쓴다:
  `--args='^|^scripts/load-juso-entrc.mjs|gs://logis-op-address-source/entrc'`
  args 는 재배포 없이 `gcloud run jobs update --args=…` 로 바꿀 수 있고, 바꾼 뒤
  `describe --format="value(...containers[0].args.list())"` 로 **눈으로 확인**할 것.
- **정기배치 로그 확인**:
  `gcloud run jobs executions list --job nexus-address-sync --region asia-northeast3 --project logis-op --account ttong627@gmail.com --limit 3`
  → 실행 이름을 잡아
  `gcloud logging read 'resource.type="cloud_run_job" AND labels."run.googleapis.com/execution_name"="<이름>"' --project logis-op --account ttong627@gmail.com --format="value(textPayload)" --order asc`
