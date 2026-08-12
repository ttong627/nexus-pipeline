# 🔁 HANDOFF — nexus-pipeline (2026-08-12 23:00 KST)

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
| 명단 좌표 커버리지 | **99.9%** (16개 명단 98,020건 · 미보유 **56**) |
| 이상치 표시 | 4건(C-6 ⑥이 첫 정기 실행에서 검출) |

**입구 ↔ 중심 거리: 평균 9.5m · 최대 883.7m · 50m 초과 889건.**
그 889건이 이번 작업의 값어치다 — 지금까지 건물 중심을 목적지로 받던 곳들이다.

### 운영 구성

Cloud Run 서비스 `nexus-address-api` 리비전 **`00072-hwf`**(롤백 지점 `00071-qr2`).
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

1. **✅완료 — 동대문구 `no_anchor` 266건 해소**(설계서 **§5-8**)
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
   - ⚠️ **첫 채움 실행이 통째로 죽었다** — `probedDong` TDZ(`baf32ea`·`b9a96f3`).
     선언이 ②출입구 return **아래**에 있어 `Cannot access 'probedDong' before initialization`.
     **코드는 그대로인데 데이터가 바뀌자 터진 것**이다 — C-7(642만 행) 전에는 `findEntrance`
     가 늘 null 이라 그 경로를 한 번도 안 탔다. 회귀 2건으로 잠갔다(출입구 주입 케이스).
     → 재배포 서비스 **`00073-frq`** · Job 4개(`deploy-jobs.sh`).
   - ✅ **채움 완료 실측**(Job `nexus-address-listfill-kgfft`, 15분, exit 0):

     | 명단 | 채움 전 | **채움 후** |
     |---|---|---|
     | 서울특별시 동대문구 2026-07 | 98.3%(미보유 대부분 `no_anchor`) | **100.0%** (미보유 1) |
     | 서울특별시 동대문구 2026-06 | 98.3% | **100.0%** (미보유 0) |
     | 16개 명단 합계 98,020건 | 99.7% · 미보유 316 | **99.9% · 미보유 56** |

     쿼터는 vworld 32 / kakao 28 만 썼다(나머지는 전부 `cached`).
     `/v1/coords/resolve` 최종 실측 — 한천로58길 6개 주소 **전부 입구 좌표까지 확보(6/6)**,
     앵커는 설계서가 예측한 `112304115640#0#…` 그대로.

     ⚠️ **`--apply` 는 로컬에서 안 된다** — 서버판은 in-process 로 DB 에 직접 붙는데
     Cloud SQL 은 로컬에서 접근 불가다(`필수 환경변수가 없습니다: databaseUrl`).
     `--list`·조회만 로컬 가능. **채움은 반드시 Job 으로**:
     ```
     gcloud run jobs execute nexus-address-listfill --region asia-northeast3 --project logis-op --account ttong627@gmail.com --wait
     ```
   - **남은 것**: 미보유 **56건**은 좌표 문제가 아니라 **주소 문제**다(A-36 — 주소를 지어내지
     않는다). `no_anchor` 잔여는 `장곡길319번길 285`·`천태리 131`(지번) 같은 형태.
     정제 화면에서 주소를 고쳐야 풀린다.
   - ✅ **56건 전량 목록 확보**(2026-08-12 21:40 KST) — `바탕화면\nexus_좌표미보유_56건_2026-08-12.txt`.
     사유 분포 = `no_anchor` **21** · `none` **28** · `outlier` **7**(합 56, 검산 완료).
     ⚠️**PII 인접이라 리포에 커밋하지 않는다.**
     - 14개 명단 36건 = Job `nexus-address-listfill-kgfft` **로그에서 재구성**(재실행 없이).
     - 시흥 2개 명단 20건 = **운영 API `/v1/coords/resolve`(`mode:'cache'`) 직접 조회**.
       ★**배포가 필요 없었다** — 서비스는 이미 떠 있고 명단은 서비스 계정 키로 읽힌다.
       Job 을 고쳐 다시 돌리는 것만 길이 아니다.
     - 상한 문제 자체는 `--miss-limit` 로 해결(기본 5 불변, `0`=전량, 잘리면 **잘렸다고 로그에 남긴다**).
   - ★★**`outlier` 의 진짜 원인 규명·수정 완료(2026-08-12)** — 아래 5번 항목 참조.
     한 줄 요약: **정제가 실패한 주소를 도로명 조각 그대로 지오코딩해 전국에서 아무 데나 맞았다.**

2. ~~`parseAptDong` 오탐~~ ✅ **완료·머지됨**(2026-08-12, 별도 워크트리 → main).
   전 명단 **98,020건 전수 실측** 후 `호` 필수화(규칙 **DS-18** · 근거 §5-3-B).
   오탐 4,357건 제거(도로 부번 4,229 · 전화번호 117 · 괄호 지번 11) + **578건은 오탐에
   가려져 있던 진짜 동을 회복**(`중앙로 265-36, 106-1305호 우방아파트` → 265동 ❌ → 106동 ✅).
   `호` 없는 정상 동호 표기는 **0건**이라 퇴행 없음. `RouteMapModal` 복제본도 SSOT import 로 제거.
   회귀 `scripts/apt-dong-parse.test.mjs` 19 PASS · 실측 도구 `scripts/measure-dong-parse.mjs`(읽기 전용).
   - ✅ **배포 완료 — 실측 확인**(2026-08-12 21:10 KST). 앞선 "아직 배포 안 됨" 기록은 낡은 것이었다.
     Firebase Hosting `live` 최종 릴리스 **2026-08-12 20:47:28**(머지 `801f0de` 20:25 이후).
     **라이브 번들을 직접 열어 확인**했다 — `logis-op.web.app/assets/index-fiTcEt_a.js` 안에
     `(\d{3,4})\s*[-]\s*\d{1,4}\s*호/` 가 있고 구버전의 `호?`(optional)는 **번들 전체에 0건**이다.
     ★"배포했다"는 릴리스 시각이 아니라 **번들 내용**으로 확인한다(시각만으로는 무엇이 담겼는지 모른다).

3. ~~좌표 선택 규칙이 두 벌~~ ✅ **완료**(2026-08-12 · 설계서 **§6-1** 에 위치표).
   호출부를 세어 보니 **두 벌이 아니라 네 벌이었고, 그중 두 벌이 죽어 있었다.**
   - 살아있음: `deliveryBrief.pickCoordinate`(내비, `server.js` `/v1/delivery/resolve`) ·
     `functions/index.js` `storeCoordsFor`(명단 lat/lng, `geocodeAuto` 3분마다)
   - 죽어있음: `coordStore.pickDeliveryCoord`(호출부 0) ·
     `src/utils/coordStoreApi.js` **모듈 전체**(유일 호출부 `App.jsx` `runSavedListBackgroundCoords`
     도 호출부 0 → 딸린 진행 패널 `bgSaveCoordState` 도 영영 안 뜬다)
   - ★그리고 `functions/index.js` 주석이 **죽은 `pickStoreCoord` 를 SSOT 로 지목**하고 있었다.
     고쳐도 운영이 안 바뀌는데 고친 사람은 고쳤다고 믿는다 — C-5 의 원형.
   - **조치**: `pickDeliveryCoord` 삭제 / 운영 규칙을 `functions/storeCoordPick.js` 로 승격
     (회귀 `scripts/store-coord-pick.test.mjs` 8건) / `coordStoreApi.js` 에 **휴면 배너** /
     죽은 함수를 근거로 삼던 주석 3곳 정정. **두 살아있는 규칙이 다른 것은 설계다**(F2) —
     합치지 말 것, 회귀가 그 분리를 잠근다.
   - ★**DS-15(outlier 차단)가 이 이관으로 처음 운영 경로에 잠겼다.** 기존 잠금은 죽은 함수에만
     붙어 있어서, 회귀는 초록인데 운영은 그 규칙을 안 지켜도 아무도 몰랐다.
   - Red-Green 실측: outlier 가드 제거 → 2건 FAIL, 복원 → 8/8 PASS.
   - ⚠️ **아직 배포 안 됨**(아래 "배포 대기" 참조). 동작은 불변이라 급하진 않다.

4. (관찰) C-6 **2026-08-12 04:23 실행 정상**(`nexus-address-sync-qw887`, exit 0).
   채움 대상 0건 · 이상치 4건 표시 유지. **단 이 "0건"은 저장소에 행이 있는 건만 센 값이다**
   — 1번의 `no_anchor` 는 여기 안 잡힌다(§5-3-A 모집단 함정). 배포 후 다시 볼 것.
   - ✅ **시각 확정**(2026-08-12 21:00 KST 실측): 그 실행은 `2026-08-11 19:23 UTC` = **08-12 04:23 KST**,
     `00073-frq` 배포는 `2026-08-12 11:13 UTC` = **08-12 20:13 KST**. 즉 **오늘 04:23 은 수정 이전 이미지**다.
     → **2026-08-13 04:23 실행이 `probedDong` TDZ 수정 이후 첫 정기 실행**이다. 그걸 봐야 판정된다.
   - 볼 것: 요약 로그의 **`★다음으로 이월`**(이틀 연속 안 줄면 막힌 것) + ⑤채움이 실제로
     대상을 잡는지(1번 앵커 수정으로 `no_anchor` → `unknown` 이 됐으니 이제 대상이어야 한다).
   - ⚠️ **그 관찰 전에는 Job 을 재배포하지 말 것** — 4개 Job 이 같은 이미지라 무엇을 관찰 중인지가
     바뀐다. 1번의 `--miss-limit` 옵션화도 그래서 미뤘다.

5. ★★**명단에 최대 201km 떨어진 좌표가 저장되고 있었다 — 원인 규명·수정**(2026-08-12).
   `outlier` 를 파고들다 나온 **실제 배송 영향** 결함이다.
   - **원인**: 정제가 주소를 확정 못 하면(`standardRoadAddress` 없음) `apiGeocode` 가 원문에서 뽑은
     **도로명 조각**(`매화로 53`)을 그대로 지오코더에 보냈다. 조각엔 시도·시군구가 없으니
     **전국에서 아무 데나 맞는다.** `sigungu` 를 인자로 받아놓고 일반 지오코딩엔 **안 넘기고 있었다.**
     저장될 때 `좌표상태='좌표확인'` 이 붙어 **화면에선 정상으로 보인다** — 에러가 안 난다.
   - **전 명단 98,020건 전수 스캔**(명단별 좌표 중앙값에서 20km 초과):
     54건 중 **진짜 오염은 시흥 2026-07 의 5건**. 나머지는 오탐이다 —
     여주 42건(전부 `산북면`)·천안 7건(전부 `동면`)은 **정제주소가 정상인 외곽 면지역**으로,
     그 지자체가 넓어서 중앙값에서 20km를 넘는 것뿐이다. ★거리 규칙만으로 판정하면 안 된다는 표본.
   - **수정**: `functions/geocodeQuery.js` `buildGeocodeQuery` — 조각이면 `시도 시군구` 를 앞에 붙이고,
     이미 온전한 주소(시도명으로 시작)면 그대로 둔다. 지자체를 모르면 **빈 문자열로 조회를 건너뛴다**
     (사유는 로그로 남긴다). 회귀 `scripts/geocode-query.test.mjs` 8건 · Red-Green 확인.
   - **왜 "결과 걸러내기"가 아니라 "질문 온전하게 하기"인가**: VWorld `getCoord` 는 **좌표만 주고
     매칭된 주소를 안 돌려준다** → A-36 의 `sameAddressAsQuery` 같은 사후 대조가 불가능하다.
     반면 질의에 지자체를 붙이면 그 시에 없는 도로는 **NOT_FOUND** 가 된다.
   - **운영 지오코더 실측 검증**(읽기 전용, 수정 전/후 같은 엔드포인트에 실제 질의):

     | 조각 | 수정 전 | 수정 후 |
     |---|---|---|
     | `매화로 53` | 성남 분당 **29km** | **NOT_FOUND**(그 번지가 없음 = 정직한 실패) |
     | `봉우재로 36` · `37` | 서울 중랑구 **34km** | 시흥 **5km** |
     | `신천로 1-1` | **64km** | 시흥 **7km** |
     | `1길 17` | 강원 **200km** | 시흥 **13km** |

     ⚠️ `1길 17` 은 **원본 주소 자체가 잘려 있다**(도로명 앞부분 소실). 지자체 제약으로 시흥 안으로는
     들어왔지만 **그 도로가 맞는지는 보증 못 한다** — 이건 정제 화면에서 주소를 고쳐야 하는 건이다.

6. ★★**정제주소를 못 만든 50건 — 행안부 원본DB로 전수 규명**(2026-08-12).
   대조 기준 = `D:\Gemma4\govt_delivery_analysis\data\juso_db\juso.sqlite`(2026-06판 전국 640만 행).
   결과 = 바탕화면 `nexus_정제주소_50건_규명_2026-08-12.txt`(PII 인접 → 리포에 커밋 안 함).
   판정: ✅주소 실재 1 · ⚠️도로는 있으나 번지 없음 33 · ❌그 시군구에 도로 없음 15 · 🏠건물명으로 확인 6.
   - **【원인1】 도로명 파싱 결함 — 도로명 꼬리가 건물명 칸으로 떨어진다.** 원본 도로명이
     실재함을 원본DB로 확인했다(괄호=시흥 실재 행수):
     `봉우재로36번길`(7)·`봉우재로37번길`(20)·`정왕대로233번안길`(47) → 명단엔 `… 36, (정왕동, 번길)` 꼴 /
     `매화마을1길`(13) → 명단엔 `1길 17, 매화마을 …`(**앞부분이 잘림**) /
     `신천로25번길`(5) → 명단엔 `신천로 1-1`(**25번길 통째 소실**).
     ★**건물명 칸의 `번길`·`번안길` 은 건물이 아니라 잘려나간 도로명 꼬리다.** 이걸 신호로 쓰면 찾을 수 있다.
   - **【원인2】 번지 오타**: `매화로 53, 301호 (매화동, 화영주택)` → 매화로에 53번지는 없고
     (50·52·54·57-x·58) **54번지가 화영주택**이다. 건물명이 정확히 일치.
     ⚠️**`매화로` 자체는 시흥에 분명히 존재한다**(출입구 95개, 매화동) — 형이 지적해 바로잡았다.
     앞서 "시흥에 없는 주소"라고 적은 것은 **부정확**했다. 정확히는 "도로는 있고 그 번지가 없다".
   - ⛔**A-36 — 이 규명으로 주소를 자동 치환하지 않는다.** 건물명으로 주소를 찾아 붙이는 것은 금지다.
     담당자가 정제 화면에서 확인·수정할 **근거**로만 쓴다.
   - **⛔남은 것 — 이미 저장된 5건**: 명단 레코드에 잘못된 `lat`/`lng` 가 `좌표상태='좌표확인'` 으로
     그대로 있다. 수정은 **새로 채우는 것만** 막는다. 정정하려면 그 5건의 좌표를 비우고
     다시 채우게 해야 하는데, **운영 데이터 수정이라 형 확인 후**에 한다(dry-run 먼저).

---

## ⚠️ 배포 대기 (2026-08-12 작업분 — 코드는 main, 운영은 아직 옛 이미지)

★**하나는 동작이 바뀐다** — 위 5번(지오코딩 질의에 지자체 부착)은 **오작동을 고치는 변경**이라
배포해야 효과가 난다. 나머지(죽은 코드 삭제·규칙 파일 분리·옵션 추가·주석)는 동작 불변이다.
**리포와 운영이 갈라져 있다는 사실 자체를 기록해 둔다** — 이 문서가 "배포됐다"고 잘못 적어 둔 탓에
헛짚은 적이 있다.

| 대상 | 무엇이 바뀌었나 | 명령 |
|---|---|---|
| Cloud Function `geocodeAuto` ★ | ①인라인 규칙 → `storeCoordPick.js` ②**지오코딩 질의에 지자체 부착**(`geocodeQuery.js`) | `firebase deploy --only functions --account ttong627@gmail.com` |
| Cloud Run 서비스·Job 4개 | `coordStore.pickDeliveryCoord` 삭제 · `fill-list-coords --miss-limit` | `bash scripts/deploy-jobs.sh` (+ 서비스 재배포) |
| Hosting(클라) | 주석뿐 — **기능 변화 0**, 배포 불필요 | — |

⚠️ **`nexus-address-sync` 는 2026-08-13 04:23 관찰 대상이다.** 그 전에 이미지를 갈면
무엇을 관찰 중인지가 바뀐다 → **관찰 뒤에 배포할 것.** (형 확인 후 실행)

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
- address-service **275/275** · 루트 **308/308** · eslint **0** · `tsc --noEmit` **0** · `npx vite build` **EXIT=0**
  (루트가 281→308 인 것은 `store-coord-pick.test.mjs` 8건 신설 + 그간 증설분)
- Red-Green 실측: 이상치 최소표본·중복표시 가드·동 재조회 억제(dongCount 가드·주기) 전부 양방향 확인
- 미커밋 없음 · origin/main 동기
- ✅ **브랜치 정리 완료**(2026-08-12 21:0x KST) — `feat/coord-fill-c3`·`feat/juso-entrc-loader`
  둘 다 `main` 에 전부 반영(`git log main..<브랜치>` 0건) 확인 후 로컬·원격 삭제.
  되살릴 일이 생기면 SHA 로 복구된다:
  `git push origin 0142068…:refs/heads/feat/coord-fill-c3` (c3) ·
  `git push origin 54355d9…:refs/heads/feat/juso-entrc-loader` (entrc)
  → 남은 브랜치는 `main` 하나. ⚠️ 이 리포의 기본 브랜치는 **`main`**(`master` 아님).

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
  ★로그는 **다시 돌리지 않아도 되는 자료다** — 미보유 56건 목록도 재실행 없이 이 로그에서 뽑았다.
- ⚠️ **KST 함정(2026-08-12 실제로 헛짚음)**: 이 PC 의 Git Bash 에는 tzdata 가 없어
  `TZ=Asia/Seoul date` 가 조용히 **UTC 를 그대로 뱉는다**(에러 없음). 그 값으로 계산하면
  9시간이 틀어져 "배포가 미래에 일어났다" 같은 결론이 나온다.
  **이 PC 는 로컬 시각이 곧 KST 다 → 그냥 `date`** 를 쓰고, UTC 비교가 필요하면 `date -u` 와 나란히 볼 것.
  gcloud 가 주는 시각(`CREATED`·`creationTimestamp`)은 전부 **UTC** 다.
