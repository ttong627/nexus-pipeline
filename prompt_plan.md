# 세션 핸드오프 — nexus 주소 서비스 (2026-07-31 마감)

> 새 세션에서 **"이어서"** 하면 이 문서부터 읽는다.
> 관련 메모리: `project_nexus_address_format_rules`(★match 인시던트 3원인·진단 인프라 접근법) · `project_nexus_self_learning`

---

## ✅ 이번 세션 완료 (2026-07-31, 커밋 `5b3a957`~`5b612de`, origin push 완료)

| 작업 | 결과 | 커밋 |
|---|---|---|
| 골든 회귀 안전망(vite SSR 로더+fetch 카세트) | offline+api 2단 | `5b3a957` |
| 순수 규격화 프리앰블 A-3·4·6·15·16·21 → shared SSOT | 클라 출력 불변(골든 증명) | `78d272e` |
| slow-query 로그 connect/searchpath/query 분리 계측 | 관측성 개선 | `87b2410` |
| **buildingMatch 28s seq scan 수정** | 함수 GIN 인덱스+불변식 | `083261e` |
| api 골든 녹화(match 정상화 후) | 41건·재녹화 변경0 | `5b612de` |

**서버 배포**: `nexus-address-api` 리비전 `00049-p76`(logis-op, asia-northeast3). 클라 hosting 변경 없음.

### ★ match "장애" 실제 원인 3가지 (전부 해결)
1. **buildingMatch `concat_ws('',road_key,building_name_key) % $2`가 무인덱스** → building_core 21M행 seq scan(28.8s). → `(coalesce(road_key,'')||coalesce(building_name_key,''))` 불변식 교체 + 함수 GIN 인덱스 `building_core_roadbld_trgm`(운영 CREATE INDEX CONCURRENTLY 완료·비잠금·schema.sql+applySchema 반영).
2. **06:18 Cloud SQL 재시작 후 플래너 통계 낡음** → `ANALYZE building_core, address_core`로 해결.
3. **★Windows Git Bash `curl -d`가 한글 POST 본문을 깨뜨림** → "404·슬로우 관측 상당수가 테스트 아티팩트". **한글 POST 테스트는 python `urllib`(UTF-8)로**. 실측: python POST 전부 200·0.1~0.16s.
- road_key equality는 이미 빠름(7~14ms) → btree 불필요(형이 승인했으나 실측으로 불요 판명).

---

## ▶ 새 세션에서 할 일

### 1️⃣ Phase 2 본체 — 서버 `/v1/address/purify` 엔드포인트 (다음 대작업)
**목표**: 규격화+매칭+상세규격화를 서버에서 배치 수행(대량 백필 서버화 + 브라우저 Kakao 키 제거 발판).
**이제 가능**: offline+api 골든 둘 다 있어 "서버 출력 = 클라 출력" 대조 가능.
**걸림돌**: 학습사전 4종(`typo_dict`·`name_typo_dict`·`building_alias`·`note_normalize_dict`)이 **클라 전용** → 서버에 `firebase-admin` 추가 + IAM(서버 SA에 Firestore read) 필요.
**착수 순서 제안**:
- ⓐ 서버에 firebase-admin 추가 + 학습사전 로더(캐시).
- ⓑ shared로 A-5·A-9 등 나머지 순수화 가능분 추가 이관(지금은 A-3·4·6·15·16·21만 SSOT).
- ⓒ `/v1/address/purify` 엔드포인트: normalize(shared) → match(기존) → 상세규격화(dongHoFormat 등).
- ⓓ 골든으로 서버=클라 대조.

### 2️⃣ 형 실동작 확인 (지난 세션부터 대기)
`logis-op.web.app` → Ctrl+Shift+R → 명단 정제 → ①층 위치(가동 3층 101호 유지/101동 3층 203호→101- 203호 3층) ②대시 동호 ③건물명 맨뒤 ④괄호 잡값 없음. + 자가학습 '학습 검토' 탭.

### 3️⃣ 남은 표기 갈림 276건 (자동 처리 불가) — 지난 세션 기록 유지
동률·근소차 28그룹·괄호 층정보·도로명 부번차. 형 현장 지식 필요.

---

## 🔑 이어가기 전 필수 지식 (함정)

| 상황 | 반드시 |
|---|---|
| `gcloud` 실행 | 매 호출 `--account=ttong627@gmail.com`. 프로젝트=**logis-op** |
| `git push` | `gh auth switch --user ttong627` 먼저 |
| 클라 배포 | `npm run build` 후 firebase hosting. tsc 게이트 기존 에러 13건(무관·vite build는 그린) |
| **서버 배포** | `cd services/address-service && gcloud run deploy nexus-address-api --source=. --region=asia-northeast3 --project=logis-op --account=ttong627@gmail.com` |
| **한글 POST 테스트** | ★curl -d 금지(본문 깨짐). python urllib(UTF-8) 사용 |
| 주소DB 직접 진단 | Secret `ADDRESS_DATABASE_URL`(소켓형)→공인IP `34.158.197.192`(requireSsl=False)에 내IP authorized-networks 임시추가→node pg EXPLAIN→**끝나면 `--clear-authorized-networks` 원복** |
| 느린 쿼리 식별 | 80자 로그 truncation이 다른 쿼리를 같게 보이게 함 → **EXPLAIN 플랜으로 식별** |
| 골든 갱신 | `node scripts/golden/record.mjs [--mode record]`. 테스트 `node --test scripts/address-golden.test.mjs` |
| 규격화 정규식 수정 | `services/address-service/src/shared/`(roadTokens·textNormalize) 한 곳. 클라·서버 공용 |

### 현재 기준선
match 실존주소 200·0.1~0.16s(리비전 00049) · 골든 offline+api 3/3 · 인덱스 `building_core_roadbld_trgm` 운영 반영.

---

## 📌 재착수 금지 (형 확정)
- **column_map 자동화** — 서버 3중 매핑 존재. 충돌>실익.
- **정본 문자열 그대로 저장** — 정본 100% 보유, 갈림 1%<.
- **road_key btree 인덱스** — equality 이미 7~14ms로 빠름. 불필요.
- 기존 저장 명단 소급 미적용 — 새 정제 명단만 새 규칙(형 지시 시 백필 별도).
