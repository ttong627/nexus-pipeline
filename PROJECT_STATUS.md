# 📋 PROJECT STATUS — nexus-pipeline
> 자동 생성: /확인 스킬 · 갱신 2026-06-30 13:42 (Tuesday)

## 식별
- GitHub: ttong627/nexus-pipeline (계정 세트: **ttong627**)
- Firebase 프로젝트: **logis-op**
- 로컬 경로: f:/TTong_newproject/nexus-pipeline-clean
- 브랜치: main

## 배포 환경
- 접속 URL: https://logis-op.web.app · https://logis-op.firebaseapp.com
- 호스팅: Firebase Hosting (public=`dist`)
- 빌드: `npm run build` (vite build)
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
| nexus-address-service | /services/address-service | 주소 매칭 API (Docker+Cloud SQL) | Node |

## 마지막 작업 (2026-06-30)
- **V6.80** 8da329b feat: 클라이언트 오류 자동추적 + lint 게이트 + 관리자 오류로그
  - errorTracker.js(신규): window.onerror·unhandledrejection → Firestore `error_logs` 기록(throttle·TTL30일)
  - 관리자 패널 운영현황 탭에 '최근 오류 로그' 섹션
  - eslint no-restricted-syntax: lucide 아이콘이 전역 생성자(Map/Image/Set) 별칭없이 가리는 import 차단
  - package.json prebuild=eslint --quiet → 배포 전 lint 게이트(에러 시 빌드 중단)
  - firestore.rules: error_logs 컬렉션 규칙 (배포됨)
- **V6.79.3** 3f36671 fix: 주소정제 즉시 중단(T is not a constructor) 근본 해결
  - lucide `Map` 아이콘 import가 전역 Map 생성자를 가려 `new Map()`이 죽던 사고 → `Map as MapIcon` 별칭
  - asyncPool 워커 행 단위 예외 격리(한 행 오류가 전체 배치를 죽이지 않게)
- **V6.79.1** 705df47 fix: 주소정제 무한로딩 — Kakao 타임아웃 + 핸들러 예외 안전망

## 작업환경
- node v24.18.0 / npm 11.16.0 · gh OK · gcloud OK · firebase OK
- 현재 앱 버전: **6.80.0 (V6.80)** · APP_BUILD 2026.06.30 13:03
- 의존성: 루트 node_modules 설치됨 (자동설치 불필요)
- 시크릿: `.env`·`.env.example` 존재 (gitignore, 값 비노출)
- 검증 게이트: `prebuild` = eslint --quiet && tsc --noEmit (배포 전 자동). 별도: `npm run typecheck`, `npm run test:e2e`(Playwright 스모크)

## 동기화
- 상태: **이미 최신** (origin/main...HEAD = behind 0 / ahead 0, 워킹트리 clean)
- gh active 계정: ttong627 (repo owner와 일치 ✅)

## 검토 완료 메모 (2026-06-30 점검 후속)
- **쉬운 정제 매칭 엔진**: 이미 100% 구현·배포 완료 → 추가 작업 불필요.
- **TypeScript 점진 도입**: errorTracker·addressFormat·columnRules·parsers 4개 순수 모듈에 `// @ts-check` + JSDoc 적용. `tsc --noEmit`을 prebuild 게이트에 추가(타입오류 시 빌드 중단). 거대/IndexedDB 모듈(addressEngine·dbCache 등)은 다음 차수.
- **E2E 스모크**: Playwright 1개(`tests/smoke.spec.js`) — 빌드된 앱이 런타임 크래시(예: V6.79.3 사고) 없이 셸 렌더되는지 배포 전 검증. `npm run test:e2e`.

## 리스크
- 🟢 동기화·계정·환경·배포(200): 정상
- 🟢 에러 가시성: 전역 추적 + 관리자 패널 오류로그 완비(V6.80)
