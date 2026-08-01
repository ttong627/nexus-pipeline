# Address Service

전국 주소 기준정보를 브라우저가 아닌 Cloud SQL에서 조회하기 위한 온라인 주소 서비스다.
웹앱은 `VITE_ADDRESS_MATCH_API_URL` 로 이 API를 먼저 호출하고, DB에서 확정하지 못한 입력만 JUSO fallback 으로 보낸다.

## 구성

| 구성 | 역할 |
|---|---|
| Cloud SQL PostgreSQL | 주소/건물/상세주소 기준 테이블, 검색 인덱스, JUSO fallback cache, Kakao 좌표 cache |
| Cloud Storage | JUSO 전체분 원천 파일 버전 보관 |
| Cloud Run Job | 원천 파일을 읽어 스키마 생성, 전국 기준 테이블 적재, 검색키 재생성, 버전 publish |
| Cloud Run Service | `/v1/address/match`, `/v1/address/geocode`, `/v1/address/db-status` 제공 |

## Cloud Storage 원천 구조

원천 폴더명은 JUSO 다운로드 폴더명을 그대로 유지한다. `ADDRESS_SOURCE_PREFIX=address-source/202604` 기준 구조는 아래와 같다.

```text
gs://BUCKET/address-source/202604/
  202604_주소DB_전체분/
    개선_도로명코드_전체분.txt
    주소_*.txt
  202604_도로명주소 한글_전체분/
    jibun_rnaddrkor_*.txt
  202604_건물DB_전체분/
    build_*.txt
  202604_상세주소 동 표시_전체분/
    rnspbd_dong_*.txt
  202604_상세주소DB_전체분/
    adrdc_*.txt
  202604_상세주소 표시_전체분/
    rnspbd_adrdc_*.txt
    rnspbt_adrdc_*.txt
```

`202604` 원천 텍스트는 기본적으로 `cp949` 로 디코딩한다. 다음 달 자료의 인코딩이 바뀌면 Job 환경변수 `ADDRESS_SOURCE_ENCODING` 만 검증 후 변경한다.

업로드 예시:

```powershell
gcloud storage cp --recursive "202604_주소DB_전체분" "gs://BUCKET/address-source/202604/"
gcloud storage cp --recursive "202604_도로명주소 한글_전체분" "gs://BUCKET/address-source/202604/"
gcloud storage cp --recursive "202604_건물DB_전체분" "gs://BUCKET/address-source/202604/"
gcloud storage cp --recursive "202604_상세주소 동 표시_전체분" "gs://BUCKET/address-source/202604/"
gcloud storage cp --recursive "202604_상세주소DB_전체분" "gs://BUCKET/address-source/202604/"
gcloud storage cp --recursive "202604_상세주소 표시_전체분" "gs://BUCKET/address-source/202604/"
```

## Cloud SQL 스키마

스키마 원본은 [schema.sql](./sql/schema.sql) 이다. Job이 시작할 때 반복 실행 가능한 형태로 적용한다.

주요 테이블:

| 테이블 | 역할 |
|---|---|
| `address_db_versions` | 기준월, 적재 건수, 오류, publish 상태 |
| `road_codes` | 도로명코드와 도로명 |
| `address_core` | 주소관리번호 기준 도로명주소/지번 검색 코어 |
| `address_building_links` | 주소DB의 건물관리번호-도로번호 연결 |
| `building_core` | 건물관리번호 기준 건물명/도로명주소/우편번호 |
| `detail_core` | 동/층/호 상세주소 연결 |
| `address_search_keys` | 검색용 정규 키 |
| `address_fallback_cache` | DB 미매칭 JUSO 확정 결과 |
| `address_geocode_cache` | 표준주소/건물관리번호 기준 Kakao 좌표 |

`pg_trgm` 확장을 사용하므로 Cloud SQL 데이터베이스에서 확장 생성 권한을 가진 계정으로 최초 Job을 실행한다.

## 로컬 검사

```powershell
cd services/address-service
npm install
npm run check
```

## Cloud Run 이미지

```powershell
gcloud builds submit services/address-service --tag REGION-docker.pkg.dev/PROJECT/nexus/address-service:202604
```

## Cloud Run 적재 Job

Cloud SQL 연결은 Cloud Run Job에 인스턴스를 연결하고 `DATABASE_URL` 의 host 를 `/cloudsql/PROJECT:REGION:INSTANCE` 로 둔다.
DB 비밀번호, JUSO 키, Kakao REST 키는 Secret Manager에서 주입한다.

```powershell
gcloud run jobs deploy nexus-address-import `
  --image REGION-docker.pkg.dev/PROJECT/nexus/address-service:202604 `
  --region REGION `
  --command node `
  --args src/import-job.js `
  --add-cloudsql-instances PROJECT:REGION:INSTANCE `
  --set-env-vars ADDRESS_DB_VERSION=202604,ADDRESS_REFERENCE_DATE=2026-04-30,ADDRESS_SOURCE_BUCKET=BUCKET,ADDRESS_SOURCE_PREFIX=address-source/202604,ADDRESS_SOURCE_ENCODING=cp949,PGSSL=disable `
  --set-secrets DATABASE_URL=ADDRESS_DATABASE_URL:latest

gcloud run jobs execute nexus-address-import --region REGION --wait
```

적재 후 `address_db_versions.status` 가 `published` 인지, 주소/건물/상세주소 건수가 원천 건수와 크게 어긋나지 않는지 먼저 확인한다.

## Cloud Run Address Matching API

```powershell
gcloud run deploy nexus-address-api `
  --image REGION-docker.pkg.dev/PROJECT/nexus/address-service:202604 `
  --region REGION `
  --allow-unauthenticated `
  --add-cloudsql-instances PROJECT:REGION:INSTANCE `
  --set-env-vars ADDRESS_DB_VERSION=202604,ADDRESS_ALLOWED_ORIGINS=https://YOUR_FIREBASE_HOSTING_DOMAIN,PGSSL=disable `
  --set-secrets DATABASE_URL=ADDRESS_DATABASE_URL:latest,JUSO_API_KEYS=ADDRESS_JUSO_KEYS:latest,KAKAO_REST_KEY=ADDRESS_KAKAO_REST_KEY:latest
```

프론트 배포 환경에는 API URL만 노출한다.

```powershell
$env:VITE_ADDRESS_MATCH_API_URL="https://ADDRESS_API_URL"
npm run build
firebase deploy --only hosting
```

## API 계약

```text
POST /v1/address/match
body: { "query": "경기 안양시 동안구 관악대로 287", "cityLabel": "안양시", "allowJusoFallback": true }

POST /v1/address/geocode
body: { "standardRoadAddress": "경기도 안양시 동안구 관악대로 287", "buildingMgtNo": "..." }

GET /v1/address/db-status
GET /healthz
```

매칭 응답은 기존 JUSO 호환 필드에 `_addressMgtNo`, `bdMgtSn`, `_matchSource`, `_matchConfidence`, `_routeHints` 를 추가한다.
기사배정은 `_routeHints.apartmentGroupKey`, `_routeHints.buildingGroupKey`, `_routeHints.roadSideKey` 를 보조 근거로 보존할 수 있다.

웹 주소 열은 DB 확정 건에서 `도로명주소, 상세주소` 만 표시한다.
법정동, 건물명, 주소관리번호, 건물관리번호, 단지키, 도로 측면키는 매칭과 기사배정을 위한 메타데이터로 보존하고 주소 문자열에 억지로 되붙이지 않는다.
DB 표준 표현을 확정하지 못한 건은 프론트 주소 정제 fallback 표현을 유지한다.

## 운영 갱신

1. 새 기준월 원천을 새 Cloud Storage prefix에 업로드한다.
2. 같은 이미지 또는 새 이미지로 Job의 `ADDRESS_DB_VERSION`, `ADDRESS_REFERENCE_DATE`, `ADDRESS_SOURCE_PREFIX` 를 바꿔 staging 적재한다.
3. 샘플 검색과 건수 검증 뒤 API의 `ADDRESS_DB_VERSION` 을 새 버전으로 전환한다.
4. 이전 버전 테이블 행은 즉시 삭제하지 않고 롤백 기간 동안 보존한다.
5. Cloud Scheduler 알림은 매월 기준일 확인 작업과 `db-status` 노후 버전 점검을 담당자 알림 흐름에 연결한다.

## 보안 기준

- JUSO 키와 Kakao REST 키는 브라우저 fallback 제거가 끝나는 시점에 프론트 환경변수에서 빼고 Secret Manager로만 관리한다.
- 공개 API로 운영할 때는 Cloud Armor 또는 API Gateway/인증 프록시에서 호출량 제한을 둔다.
- `ADDRESS_ALLOWED_ORIGINS=*` 는 개발용 기본값이다. 운영 서비스는 Firebase Hosting 도메인만 허용한다.

## 행안부 출입구 적재 (entrance_core · 버전 독립)

국가 원본 출입구 좌표를 `entrance_core` 에 적재한다. 기존 월 재적재(`import-job.js`)와 **완전히 분리된 버전 독립 테이블**이다 — `resetVersionData` 대상에 절대 넣지 말 것(넣으면 매달 증발한다).

```bash
npm run juso:test                                  # 유닛(파서·리더·좌표변환·격리기)
npm run juso:scan  -- "<자료폴더>"                  # 읽기 전용 전수 스캔
npm run juso:load  -- "<자료폴더>"                  # 예행(dry-run) — DB 접근 없음
npm run juso:load  -- "<자료폴더>" --apply          # 실제 적재(DATABASE_URL 필요)
npm run juso:load  -- "<자료폴더>" --only daily     # 일변동만
```

- **기본이 예행이다.** 쓰기는 `--apply` 를 명시했을 때만 일어난다.
- **적용 순서**는 스크립트가 강제한다: 전체분 요약(`entrc_*`) → 전체분 연계(`RNENTDATA_*`) → 일변동(`AlterD.JUSUEC.*` 날짜 오름차순). 순서가 바뀌면 폐지된 주소가 되살아난다.
- **이상좌표 격리**: 자기 도로명코드의 좌표 중앙값에서 100km 넘게 떨어진 좌표는 `entrance_core` 에 넣지 않고 `entrance_coord_quarantine` 에 증거만 남긴다. 전국 실측 12,848,027행 중 82건(0.0006%)이 걸린다 — 전부 바다 위 좌표다. 주소 행 자체는 남고 좌표만 비운다.
- **폐지(이동사유 63) 반영**: 일변동의 63 은 `is_retired=true` 로 표시한다(하드 삭제 아님). 전체분은 폐지를 해제하지 않는다 — 해제는 일변동 31·34 만 할 수 있다.
- 미지원 자료(동 도형 SHP 세트·`*.Deletion.TXT`)는 조용히 넘어가지 않고 "미처리 N개 — 사유" 로 출력한다.
