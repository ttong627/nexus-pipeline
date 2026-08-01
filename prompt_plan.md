# 세션 핸드오프 — nexus 주소 서비스 (2026-08-01 P7 Phase2 ⓒ-1 **본체 완료**)

> 새 세션에서 **"이어서"** 하면 이 문서부터 읽는다.
> 관련 메모리: `project_nexus_address_format_rules`(★match 인시던트·진단 인프라·서버이관 로드맵) · `project_nexus_self_learning`

---

## ✅ 이번 세션 완료 (2026-08-01, 커밋 `ccae3b8`) — purifyCore 코어 추출

**정제 본체가 클라를 떠났다. 이제 코어는 `services/address-service/src/shared/purifyCore.js` 하나다(B1).**

| 작업 | 결과 | 커밋 |
|---|---|---|
| ⓒ-1 본체: processAddress(780줄)+parseOfficialRoadAddressText → `shared/purifyCore.js` | `createProcessAddress(deps)` 팩토리. 로직 무변경(스크립트로 원문 이동 후 deps 참조만 치환) | `ccae3b8` |
| 클라 addressEngine.js = 어댑터로 축소 | **1334줄 → 501줄**. IO·부수효과·학습사전 주입만 담당 | 〃 |
| 잠금장치 3종 | road-regex-parity에 '어댑터가 코어에 위임' 추가 · text-normalize 잠금 코어 기준 갱신 · 신규 `scripts/purify-core-deps.test.mjs` 4건 | 〃 |

- **deps 계약(서버가 그대로 쓰면 됨)**:
  - `deps.io` = lookupAddr · searchKakaoFull · fetchKakaoLegalDong · fetchKakaoCoord · fetchDongCoord · **parseAptDong**
  - `deps.side` = addSpecialChar (서버 no-op)
  - `deps.dicts` = ready · typoDict · typoRegex · nameTypoDict · specialCharRegex · buildingAliasDict(+VariantIndex) · noteNormalizeDict(+VariantIndex)
- **★★함정(가장 중요)**: `deps.dicts`는 반드시 **getter 객체**로 주입한다. 값으로 주입하면 사전 로드 이전의 **빈 사전이 영구 고정**되고, 화면은 정상처럼 보이는데 학습 오타·별칭이 조용히 죽는다. `purify-core-deps.test.mjs` ③이 이걸 잡는다(값 주입으로 바꾸면 실패하는 것 RED 실측 확인).
- **검증(증거)**: 골든 **3/3**(offline·replay·시크릿) · 전체 유닛 **164/164 pass 0 fail** · eslint **0 error** · `npx vite build` **EXIT=0** · 서버측 `node import` OK(코어가 firebase·Kakao·import.meta.env 무참조). **클라 출력 100% 불변(골든 증명)**.
- eslint: services 블록에 `no-useless-assignment: warn` 추가 — src/ 블록에선 warn이던 규칙이 이관 후 error가 돼 **검증된 로직을 규칙 때문에 손대야 하는 상황**을 막음(정책 일치, 로직 무변경).

### 📚 직전 아카이브 — ⓒ-1 선행 (커밋 `bbb2b1b`, push 완료)

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

### 1️⃣ ⓐ dictStore(firebase-admin 학습사전 로더) — **다음 1순위**
**코어는 끝났다. 남은 건 서버가 코어에 넣어줄 deps 3종을 만드는 일뿐이다.**
`deps.dicts`를 서버에서 채우려면 Firestore 5컬렉션을 서버가 읽어야 한다 → 신규 `services/address-service/src/dictStore.js`:
- `firebase-admin` 추가 + `admin.credential.applicationDefault()`(ADC, 키파일 불요) + Cloud Run 런타임 SA에 `roles/datastore.viewer`.
- 5컬렉션(typo_dict·special_chars·name_typo_dict·building_alias·note_normalize_dict) TTL 캐시 로드. `buildVariantIndex`(shared) 재사용 + `typoRegex`·`specialCharRegex` 조립(클라 `_buildTypoRegex`·`_buildSpecialCharRegex`와 **같은 규칙**).
- ★반드시 **getter 객체**로 넘길 것(값 주입 금지 — `scripts/purify-core-deps.test.mjs` ③ 참조).
- 사전이 없어도(권한 미부여 등) 코어는 동작해야 한다 → 빈 사전 + `ready=Promise.resolve()` 폴백.

### 2️⃣ ⓒ-2 `/v1/address/purify` 라우트 + ⓓ 파리티
- 서버 `deps.io`: `lookupAddr`=`matchAddress` in-process 래핑(HTTP 불요) · `fetchKakaoLegalDong`/`searchKakaoFull`=config.kakaoRestKey · 좌표 2종은 **null 반환 스텁**(`includeCoords:false`라 미사용) · `parseAptDong`은 좌표용이라 no-op 가능.
- `deps.side.addSpecialChar` = no-op(또는 제안 큐 적재).
- **ⓓ 파리티**: `scripts/golden/cases.json`(offline) 재사용 → 서버 deps로 `createProcessAddress` 실행 → `golden-offline.json` deepEqual. 신규 `scripts/golden/server-parity.test.mjs`. **이게 통과해야 서버 정제를 신뢰할 수 있다.**
- 라우트는 `server.js` 468행 `return 404` 직전 블록. 배치 동시성 ≤3~8(PGPOOL 경합 재발 방지).

- 요청 형식: body `{ records:[{addr,name,adminDong,cityLabel,note}], options }` 배치, `includeCoords:false` 고정(좌표는 클라 잔류). 응답은 **processAddress와 동일 키**.
- ※ 예전 계획의 "normalizeCore→조립을 서버에 새로 짠다"는 **이제 불필요**하다. 코어가 통째로 공유되므로 서버가 할 일은 deps 3종 조립뿐이다.

### 3️⃣ 형 실동작 확인 (지난 세션부터 대기)
`logis-op.web.app` → Ctrl+Shift+R → 명단 정제 → ①층 위치 ②대시 동호 ③건물명 맨뒤 ④괄호 잡값 없음 + 자가학습 '학습 검토' 탭. **이번 이관은 클라 출력 불변이라 결과 동일해야 함**.

### 4️⃣ 남은 표기 갈림 276건 (자동 처리 불가) — 유지
동률·근소차 28그룹·괄호 층정보·도로명 부번차. 형 현장 지식 필요.

---

## 🔑 이어가기 전 필수 지식 (함정)

| 상황 | 반드시 |
|---|---|
| **소스 `\uXXXX` 이스케이프** | purifyCore 등은 한글이 `지하`처럼 `지하` 이스케이프로 저장 → Edit old_string 안 맞음. PowerShell 라인삭제 or JSON `\\u`로 이스케이프해 매칭 |
| **★deps.dicts 주입** | 반드시 **getter 객체**. 값으로 주입하면 로드 전 빈 사전이 영구 고정 → 학습 오타·별칭이 조용히 죽는다(화면은 정상). `scripts/purify-core-deps.test.mjs` ③이 잡는다 |
| **대량 코드 이동** | 손으로 옮겨 적지 말 것. 스크립트로 원문 추출 → 참조만 치환 → 골든 게이트. 이번 780줄 이관을 이 방식으로 회귀 0 달성 |
| **이관 후 eslint 블록 변경** | `src/`와 `services/`는 eslint 규칙 세트가 다르다. 코드를 옮기면 warn이 error로 바뀔 수 있음(이번 `no-useless-assignment`) → **로직을 고치지 말고 정책을 맞출 것** |
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
골든 offline+replay 3/3 · 전체 유닛 **164/164** · **shared 모듈 9종**(roadTokens·textNormalize·dongHoFormat·addressFormat·normalizeVariant·applyNoteNormalize·detailNormalize·purifyHelpers·**purifyCore**) · 클라 addressEngine.js **501줄**(어댑터) · match 실존주소 200·0.1~0.16s(리비전 00049) · 인덱스 `building_core_roadbld_trgm` 운영 반영.

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
