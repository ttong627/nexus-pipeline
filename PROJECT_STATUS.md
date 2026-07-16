# 📋 PROJECT STATUS — nexus-pipeline
> 자동 생성: /확인 스킬 · 갱신 2026-07-16 13:58 KST

## 식별
- GitHub: ttong627/nexus-pipeline (계정 세트: **ttong627**)
- Firebase 프로젝트: **logis-op**
- 로컬 경로: I:/ttong_project/nexus-pipeline-clean (★I:=정본)
- 브랜치: main

## 배포 환경
- 접속 URL: https://logis-op.web.app · https://logis-op.firebaseapp.com
- 호스팅: Firebase Hosting (public=`dist`)
- 빌드: `npm run build` (vite build) · 게이트: `prebuild`=eslint --quiet && tsc --noEmit
- 릴리스: `node scripts/bump-version.cjs [minor|patch|major] "항목..."` → 버전+CHANGELOG 단일 관리
- 배포: `npm run deploy` = `firebase deploy --only hosting --account ttong627@gmail.com` (predeploy=build만)
- ⚠️ 배포 전제: firebase CLI에 **ttong627@gmail.com** 로그인 필요
- 커밋·푸시: main 기준 / 계정 ttong627

## 앱 구성
| 앱/패키지 | 경로 | 역할 | 스택 |
|---|---|---|---|
| nexus-pipeline | / (루트) | 메인 프론트엔드 (주소정제·명단·루트맵·동별 배송지도) | React 19.2 + Vite 8 + Tailwind 4 + Firebase 12 |
| nexus-pipeline-functions | /functions | Firebase Cloud Functions | Node (firebase-admin, firebase-functions) |
| nexus-address-service | /address-service | 주소 매칭 API (express) | Node |
| nexus-address-service | /services/address-service | 주소 매칭 API (Docker+Cloud SQL, PostgreSQL 매칭) | Node |

## 규칙 문서 (SSOT — 메뉴·기능 처리 방식의 기록, 작업 전 필독)
| 문서 | 내용 |
|---|---|
| CLAUDE.md | 프로젝트 전체 운영규칙 — 주소정제 A-1~A-30·동명이인 안전매칭 S-1~S-6·DB저장 B-1~B-16·루트맵 R-0~R-N·배송순번 DS-1~DS-14·업로드/버전관리 |
| DELIVERY_SEQUENCE_RULES.md | 배송순번 독립 규칙(roadAwareTSP·nearestNeighborTSP·품질분석) 상세 |
| 동명이인_주소오염_재발방지_설계.md | 2026-07-10 동대문 김옥순 사고 재발방지 설계 — S-1~S-6 강키 매칭·guard 모듈 |
| CLAUDE_FORGE_PRINCIPLES.md | 코딩 황금원칙(불변성·TDD·외과적 수정 등) |
| AI_GLOBAL_RULES.md / AI_TEAM_SKILLS.md | 드림팀 운영·스킬 규칙 |
| implementation_plan.md / prompt_plan.md | 기능 구현 계획 이력 |

## 마지막 작업 (2026-07-11)
- **외부 시스템(정부양곡 정산 SYSTEM) 명단 가져오기** — importUrl/import2Url 쿼리 지원
  - 8564052 feat: 외부 가져오기 **2개 파일 합치기** 지원(import2Url) — src/App.jsx
  - 90e4387 feat: 외부 시스템(정부양곡 정산 SYSTEM) 명단 가져오기 — importUrl 쿼리 지원
- **address-service 매칭 hang 근본 수정** (37초 hang → 해결)
  - 7a76284 fix: road_name 인덱스·ANALYZE·search_path
  - 7e01176 fix: 적재 후 ANALYZE 추가

## 직전 작업 (2026-07-10)
- **동명이인 주소 오염 사고 해결**: 6/24 repair-address-tampering --write가 동대문 6월 김옥순(주민센터 수령자) 주소를 동명이인 집주소로 덮어씀 → 원인 6중 결함 확정, S-1~S-6 안전매칭 규칙(CLAUDE.md §1-4)·guard 모듈+테스트 9/9·수리 v2·특이사항 이식 우회로 봉쇄. 전수감사(동대문53+중원32) 피해 2건 → 복구 완료(2cb5b6b, 형 승인 후 실행·재조회 검증). 설계서: 동명이인_주소오염_재발방지_설계.md
- ⚠️ **CRITICAL(추적 필요)**: 운영 배포 번들 VITE_ADDRESS_MATCH_API_URL 값 확인 필요 → 비었으면 앱 정제가 저하 모드(캐시+카카오POI만). 7/11 address-service hang 수정 이후 서비스 URL 연결 상태 재확인 권장

## 직전 작업 (2026-06-30)
- **V6.80** feat: 클라이언트 오류 자동추적 + lint 게이트 + 관리자 오류로그 (errorTracker.js, error_logs 컬렉션, prebuild lint 게이트)
- **V6.79.3** fix: 주소정제 즉시 중단(T is not a constructor) — lucide `Map` import가 전역 Map 생성자 가림 → `Map as MapIcon` 별칭
- **V6.79.1** fix: 주소정제 무한로딩 — Kakao 타임아웃 + 핸들러 예외 안전망

## 작업환경
- node v24.15.0 / npm 11.12.1 · gh OK · gcloud OK · firebase OK
- 현재 앱 버전: **V6.80** · APP_BUILD 2026.06.30 13:03 (version.js)
- 의존성: **루트 node_modules 설치됨**(프론트 작업 즉시 가능). 하위앱 3곳 미설치 → 해당 서비스 작업 시에만 설치
  - `cd functions && npm install` / `cd address-service && npm install` / `cd services/address-service && npm install`
- 시크릿: `.env`·`.env.example` 존재 (gitignore, 값 비노출)
- 검증 게이트: `prebuild`=eslint --quiet && tsc --noEmit (배포 전 자동). 별도: `npm run typecheck`, `npm run test:e2e`(Playwright 스모크)

## 동기화
- 상태: **이미 최신** (origin/main...HEAD = behind 0 / ahead 0, 워킹트리 clean)
- 마지막 fetch: 2026-07-16 13:58 KST
- gh active 계정: ttong627 (repo owner와 일치 ✅)

## 검토 완료 메모
- **쉬운 정제 매칭 엔진**: 이미 100% 구현·배포 완료 → 추가 작업 불필요.
- **TypeScript 점진 도입**: errorTracker·addressFormat·columnRules·parsers 4개 순수 모듈에 `// @ts-check` + JSDoc. `tsc --noEmit`이 prebuild 게이트. 거대/IndexedDB 모듈은 다음 차수.
- **E2E 스모크**: Playwright 1개(`tests/smoke.spec.js`) — 배포 전 런타임 크래시 검증. `npm run test:e2e`.

## 리스크
- 🟢 동기화·계정·환경·배포: 정상 (최신·계정일치·루트 의존성 설치됨)
- 🟢 에러 가시성: 전역 추적 + 관리자 패널 오류로그 완비(V6.80)
- 🟡 하위앱 3곳(functions·address-service×2) node_modules 미설치 — 해당 서비스 작업 시 npm install 필요(위 명령)
- 🟡 VITE_ADDRESS_MATCH_API_URL 운영 연결 상태 재확인 권장(저하 모드 방지)
