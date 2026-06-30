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
| nexus-address-service | /address-service | 주소 매칭 API (express, 6/24 최신) | Node |
| nexus-address-service | /services/address-service | 주소 매칭 API (Docker+Cloud SQL, README 본체) | Node |
| ⚠️ 위 2벌은 동일 API — 운영본 미확정, 둘 다 보존(리스크 참조) | | | |

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

## 동기화
- 상태: **이미 최신** (origin/main...HEAD = behind 0 / ahead 0, 워킹트리 clean)
- gh active 계정: ttong627 (repo owner와 일치 ✅)

## 검토 완료 메모 (2026-06-30 점검 후속)
- **쉬운 정제 매칭 엔진**: 이미 100% 구현·배포 완료(excelWorker.js 형식점수+colConfidence+ambiguousKeys, App.jsx 지자체 autoConfirm, EasyCleanConfirm.jsx 마법사). 6/5 prompt_plan의 Phase1·2·3 모두 완성됨 → 추가 작업 불필요.
- **ESLint 경고 100건**: 대부분 react-hooks(deps/static/refs, 일부 오탐)·주소정제 정규식·미사용변수 → 정리 시 퇴행 위험 > 가치라 **의도적 미처리**(에러 0, 빌드 통과, 핵심 에러차단은 lint 게이트로 달성).

## 리스크
- 🟢 동기화·계정·환경·배포(200): 정상
- 🟢 에러 가시성: 전역 추적 + 관리자 패널 오류로그 완비(V6.80)
- 🟡 **address-service 2벌**: `/address-service`(index.js, 6/24 최신)와 `/services/address-service`(Docker+Cloud SQL, README 본체) — 둘 다 동일 API 제공. **운영 Cloud Run이 어느 소스인지 GCP 콘솔 확인 필요. 확인 전까지 둘 다 보존**(형 결정 2026-06-30). 삭제 금지.
