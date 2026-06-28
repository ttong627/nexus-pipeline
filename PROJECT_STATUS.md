# 📋 PROJECT STATUS — nexus-pipeline
> 자동 생성: /확인 스킬 · 갱신 2026-06-28 20:51 (Sunday)

## 식별
- GitHub: ttong627/nexus-pipeline (계정 세트: **ttong627**)
- Firebase 프로젝트: **logis-op**
- 로컬 경로: F:/Projects/nexus-pipeline-clean
- 브랜치: main

## 배포 환경
- 접속 URL: https://logis-op.web.app · https://logis-op.firebaseapp.com
- 호스팅: Firebase Hosting (public=`dist`)
- 빌드: `npm run build` (vite build)
- 릴리스: `node scripts/bump-version.cjs [minor|patch|major] "항목..."` → 버전+CHANGELOG 단일 관리
- 배포: `npm run deploy` = `firebase deploy --only hosting --account ttong627@gmail.com` (predeploy=build만, version:bump 제거됨)
- ⚠️ 배포 전제: firebase CLI에 **ttong627@gmail.com** 로그인 필요 → [[firebase-deploy-account]]
- 커밋·푸시: main 기준 / 계정 ttong627

## 앱 구성
| 앱/패키지 | 경로 | 역할 | 스택 |
|---|---|---|---|
| nexus-pipeline | / (루트) | 메인 프론트엔드 (주소정제·명단·루트맵·**동별 배송지도**) | React 19.2 + Vite 8 + Tailwind 4 + Firebase 12 |
| nexus-pipeline-functions | /functions | Firebase Cloud Functions | Node |
| nexus-address-service | /address-service | 주소 정제 서비스 | Node |
| (address-service 사본) | /services/address-service | 주소 서비스 | Node |

## 마지막 작업 (2026-06-28)
- b4f56cc feat: 동별 배송지도 메뉴 + 배송순번 반영 온/오프 토글 (V6.79)
- **동별 배송지도** 신규 메뉴(DongSelectModal): 동 선택→그 동만 명단·순번·기사배정·기사별 원클릭 공유 (RouteMapModal/RouteSetupModal 재사용, 무수정)
- **순번 반영 온/오프 토글**(ShareRouteView): 반영됨 재클릭=취소(deleteField)
- **순번 알고리즘 실거리 검증**: baseline(roadAwareTSP)이 Kakao 실거리 최적 입증(3라운드) → [[route-sequence-verification]]. 검증자산 routeSequenceEngine.js·scripts/sim-*.mjs(운영 미import)
- predeploy 이중 version:bump 제거 → APP_VERSION↔CHANGELOG 어긋남 해소

## 작업환경
- node v24.18.0 / npm 11.16.0 · gh OK · firebase OK
- 현재 앱 버전: **6.79.0 (V6.79)**
- 시크릿: `.env`·`serviceAccountKey.json`·`.firebaserc` 존재 (gitignore, 값 비노출)

## 동기화
- 상태: 커밋·푸시·**배포 완료** (b4f56cc → origin/main, V6.79 운영 라이브)
- 배포: https://logis-op.web.app (200 ✅) · https://logis-op.firebaseapp.com (200 ✅) · firebase는 ttong627 계정으로 배포

## 리스크
- 🟢 **배포 완료**: V6.79 운영 라이브 (web.app/firebaseapp.com 200, dist에 V6.79 반영)
- 🟢 코드/커밋/푸시/빌드: 전부 완료, RouteMapModal 무변경, 빌드 그린, 버전↔CHANGELOG 정합
- 🟡 멀티 address-service: `/address-service`와 `/services/address-service` 2벌 → 중복 정리 권장(미처리)
