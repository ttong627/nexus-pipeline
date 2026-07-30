# 세션 핸드오프 — nexus 주소 서비스 (2026-07-31 P7 Phase2 ⓒ-1 선행 완료)

> 새 세션에서 **"이어서"** 하면 이 문서부터 읽는다.
> 관련 메모리: `project_nexus_address_format_rules`(★match 인시던트·진단 인프라·서버이관 로드맵) · `project_nexus_self_learning`

---

## ✅ 이번 세션 완료 (2026-07-31, 커밋 `bbb2b1b` — 로컬 커밋, **push 대기**)

**Phase2 본체(서버 `/v1/address/purify`) 착수 → 안전 분할 1단계(순수 헬퍼 shared 이관) 완료.**

| 작업 | 결과 | 커밋 |
|---|---|---|
| ⓒ-1 선행: 순수 헬퍼 → `shared/purifyHelpers.js` | 지역매칭·공통상수·Kakao순수변환·generateCenterKeyword·appendCheckReason·normalizePlaceKey·구분자. addressEngine은 import 대체(**로직 무변경**) | `bbb2b1b` |

- **검증(증거)**: 골든 3/3 · 전체 유닛 159/159 pass 0 fail · eslint 0err · `npx vite build` 그린 · **서버측 `node import` 성공**(exports 23종·firebase/env 무의존 증명). 클라 출력 100% 불변(골든).
- **B1(공용 코어) 확정**(형 승인): purifyCore 하나를 클라·서버 공용. 복제→분기 안티패턴 배격.
- **★parseOfficialRoadAddressText 이번 제외**: 유니코드 이스케이프(`지하`=지하·`호`=호) 리터럴이 Edit 문자열매칭을 막음 → 다음 코어 추출 때 본체와 함께 이동.

### 📚 직전 아카이브 — ⓑ 순수 이관 (커밋 `50499d6`·`8cb68bb`, push 완료)

**Phase 2 목표**: 클라 순수 규격화 로직을 `services/address-service/src/shared/`로 이관(SSOT) → 다음 세션 `/v1/address/purify`가 서버에서 클라와 동일 규격화 수행 + 대량 백필 서버화.

**형 확정 범위 = ⓑ+ⓓ(순수 이관 + 골든 게이트)**. ⓐ(firebase-admin 사전로더)·ⓒ(purify 엔드포인트)는 다음 세션.

| 작업 | 결과 | 커밋 |
|---|---|---|
| ⓑ-1 순수 파일 4종 → shared + 재수출 스텁 | dongHoFormat·addressFormat·normalizeVariant·applyNoteNormalize. 참조 17곳 무변경 | `50499d6` |
| ⓑ-2 상세·도로명 정규화 순수 유닛 → shared/detailNormalize.js | A-17·18·19·23잔여 8 export + 내부상수. addressEngine import 정리 | `8cb68bb` |

- **검증(증거)**: 골든 3/3(offline·replay·시크릿) · **전체 유닛 159/159 pass 0 fail** · eslint 0 error · vite build 그린. **클라 출력 100% 불변(골든 증명), 회귀 0.**
- **이관 방식**: `git mv`(히스토리 보존) + 원위치 재수출 스텁(`export * from '.../shared/...'`) → 기존 클라 참조 경로 무변경, 서버는 shared 직접 import 가능. roadTokens/textNormalize 선례와 동일 원리.
- **현재 shared 모듈 6종**: roadTokens · textNormalize · dongHoFormat · addressFormat · normalizeVariant · applyNoteNormalize · **detailNormalize**(신규).

---

## ▶ 새 세션에서 할 일

### 1️⃣ purifyCore 코어 추출 (다음 대작업 · Task #1 본체 · B1 확정)
**순수 헬퍼가 이미 shared(`purifyHelpers`)에 있으니 본체 이동만 남음. 로직 무변경·위치만 이동.**
- processAddress 본문(`src/engine/addressEngine.js` 약 713~1492)을 `services/address-service/src/shared/purifyCore.js`로 이동 + IO/SIDE/DICT를 **`deps` 주입**:
  - `deps.io` = lookupAddr · searchKakaoFull · fetchKakaoLegalDong · fetchKakaoCoord · fetchDongCoord
  - `deps.side` = addSpecialChar (서버 no-op/큐)
  - `deps.dicts` = typoDict · nameTypoDict · specialChars · buildingAliasDict(+VariantIndex) · noteNormalizeDict(+VariantIndex) · _typoRegex · _specialCharRegex · ready(=typoDictReady)
- 클라 processAddress = 실제 deps 주입 **래퍼로 축소**(Firestore·Kakao·좌표는 클라 잔류). 서버는 matchAddress in-process·서버 dicts 주입.
- **parseOfficialRoadAddressText도 이때 함께 shared로**(⚠️`지하`/`호` 유니코드 이스케이프 리터럴 → Edit 대신 PowerShell 라인삭제 또는 JSON `\\u` 이스케이프).
- **게이트(필수)**: `node --test scripts/address-golden.test.mjs` offline 35 deepEqual PASS = 클라 출력 불변 증명. 통과 전 커밋 금지.

**그 다음 순서**(확정): ⓓ 파리티 → ⓒ-2 purify 라우트+배포 → ⓐ dictStore/firebase-admin/IAM. (아래 ⓐ/ⓒ/ⓓ 상세 유지)

**ⓐ firebase-admin + 학습사전 로더**(신규 `services/address-service/src/dictStore.js`):
- `firebase-admin` 추가 + `admin.credential.applicationDefault()`(ADC, 키파일 불요) + Cloud Run 런타임 SA에 `roles/datastore.viewer`.
- 5컬렉션(typo_dict·special_chars·name_typo_dict·building_alias·note_normalize_dict) TTL 캐시 로드. `buildVariantIndex`(shared) 재사용.

**ⓒ `/v1/address/purify` 엔드포인트**(`server.js` 468행 `return 404` 직전 블록 추가):
- body `{ records:[{addr,name,adminDong,cityLabel,note}], options }` 배치.
- 각 레코드: normalizeCore(shared) → `matchAddress`(server.js:293, in-process 직접호출·HTTP 불요) → 법정동/건물명 보강(config.kakaoRestKey) → dongHoFormat/A-11 조립(shared) → applyVariant/applyNoteNormalize(dictStore) → **processAddress와 동일 키 반환**.
- **배치 동시성 ≤3~8**(PGPOOL_MAX=8·커넥션 풀 경합 재발 방지).
- `includeCoords` 미지원(좌표 범위 밖).

**ⓓ 골든 서버 대조**: `cases.json`(offline) 재사용 → 서버 purify in-process 실행 → `golden-offline.json` deepEqual. 신규 `scripts/golden/server-parity.test.mjs`.

### 2️⃣ 형 실동작 확인 (지난 세션부터 대기)
`logis-op.web.app` → Ctrl+Shift+R → 명단 정제 → ①층 위치 ②대시 동호 ③건물명 맨뒤 ④괄호 잡값 없음 + 자가학습 '학습 검토' 탭. **이번 이관은 클라 출력 불변이라 결과 동일해야 함**.

### 3️⃣ 남은 표기 갈림 276건 (자동 처리 불가) — 유지
동률·근소차 28그룹·괄호 층정보·도로명 부번차. 형 현장 지식 필요.

---

## 🔑 이어가기 전 필수 지식 (함정)

| 상황 | 반드시 |
|---|---|
| **소스 `\uXXXX` 이스케이프** | addressEngine 등은 한글이 `지하`처럼 `지하` 이스케이프로 저장 → Edit old_string 안 맞음. PowerShell 라인삭제 or JSON `\\u`로 이스케이프해 매칭 |
| **안전 분할 순서** | 순수 잎(헬퍼)부터 shared → 마지막에 코어 본체 deps 주입. 각 단계 골든 게이트 |
| `gcloud` 실행 | 매 호출 `--account=ttong627@gmail.com`. 프로젝트=**logis-op** |
| `git push` | `gh auth switch --user ttong627` 먼저 |
| 클라 빌드 검증 | **`npx vite build` 직접**(그린). `npm run build`는 prebuild `tsc --noEmit` 게이트에 **기존 tsc 에러 13건**(무관)으로 막힘 — 회귀 아님 |
| **서버 배포** | `cd services/address-service && gcloud run deploy nexus-address-api --source=. --region=asia-northeast3 --project=logis-op --account=ttong627@gmail.com` |
| **shared 모듈 위치** | 반드시 `services/address-service/src/shared/`. Docker `COPY src ./src`에 포함 + 클라 상대 import(`../../services/...`). 루트 `src/`에 두면 서버 이미지 누락 |
| 순수 파일 이관 패턴 | `git mv` + 원위치 재수출 스텁(`export * from`). 기존 참조 무변경 |
| **한글 POST 테스트** | ★curl -d 금지(본문 깨짐). python urllib(UTF-8) |
| 주소DB 직접 진단 | Secret `ADDRESS_DATABASE_URL`(소켓형)→공인IP `34.158.197.192`(requireSsl=False)에 내IP authorized-networks 임시추가→node pg EXPLAIN→끝나면 `--clear-authorized-networks` 원복 |
| 골든 갱신/검증 | `node scripts/golden/record.mjs [--mode record]` / `node --test scripts/address-golden.test.mjs`. 전체 유닛=`node --test scripts/*.test.mjs` |

### 현재 기준선
골든 offline+replay 3/3 · 전체 유닛 159/159 · shared 모듈 7종 · match 실존주소 200·0.1~0.16s(리비전 00049) · 인덱스 `building_core_roadbld_trgm` 운영 반영.

---

## 📌 재착수 금지 (형 확정)
- **column_map 자동화** — 서버 3중 매핑 존재. 충돌>실익.
- **정본 문자열 그대로 저장** — 정본 100% 보유, 갈림 1%<.
- **road_key btree 인덱스** — equality 이미 7~14ms로 빠름. 불필요.
- 기존 저장 명단 소급 미적용 — 새 정제 명단만 새 규칙(형 지시 시 백필 별도).

---

## 📚 이전 세션 핸드오프 (아카이브)

### 2026-07-31 마감 (커밋 `5b3a957`~`5b612de`)
- 골든 회귀 안전망(vite SSR 로더+fetch 카세트) offline+api 2단.
- 순수 규격화 프리앰블 A-3·4·6·15·16·21 → shared SSOT(`78d272e`).
- **buildingMatch 28s seq scan 수정** — 함수 GIN 인덱스 `building_core_roadbld_trgm`+불변식(`083261e`). 서버 리비전 `00049-p76`.
- match "장애" 3원인: ①buildingMatch 무인덱스 seq scan ②Cloud SQL 재시작 후 통계 낡음(ANALYZE) ③Windows Git Bash curl -d 한글 본문 깨짐(테스트 아티팩트).
