# 📋 PROJECT STATUS — nexus-pipeline
> 자동 생성: /확인 스킬 · 갱신 2026-06-30 11:51 (Tuesday)

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
| nexus-address-service | /address-service | 주소 정제 서비스 (express + pg) | Node |
| nexus-address-service (사본) | /services/address-service | 주소 서비스 (@google-cloud/storage, pg) | Node |

## 마지막 작업 (2026-06-30)
- 705df47 fix: 주소정제 무한로딩 해결 — Kakao 호출 타임아웃 + 핸들러 예외 안전망 (V6.79.1)
- 변경 파일: src/App.jsx, src/engine/addressEngine.js, src/version.js, package.json, package-lock.json
- 요약: 주소정제 시 Kakao 호출이 응답 없으면 무한로딩에 빠지던 문제를 타임아웃 + 핸들러 예외 안전망으로 차단
- 직전(V6.79): 동별 배송지도 메뉴 + 배송순번 반영 온/오프 토글 운영 라이브

## 작업환경
- node v24.18.0 / npm 11.16.0 · gh OK · gcloud OK · firebase OK
- 현재 앱 버전: **6.79.1 (V6.79.1)** · APP_BUILD 2026.06.30 11:31
- 의존성: 루트 node_modules 설치됨 (자동설치 불필요)
- 시크릿: `.env`·`.env.example` 존재 (gitignore, 값 비노출)

## 동기화
- 상태: **이미 최신** (origin/main...HEAD = behind 0 / ahead 0, 워킹트리 clean)
- 마지막 fetch: 2026-06-30 11:50
- gh active 계정: ttong627 (repo owner와 일치 ✅)

## 리스크
- 🟢 동기화: origin/main과 완전 일치, 미커밋 변경 없음
- 🟢 계정: gh active=ttong627, repo owner=ttong627 일치
- 🟢 배포: https://logis-op.web.app 헬스체크 200 OK
- 🟢 환경: node/npm/도구·의존성·시크릿 모두 정상
- 🟡 멀티 address-service: `/address-service`와 `/services/address-service` 2벌 → 중복 정리 권장(미처리)
