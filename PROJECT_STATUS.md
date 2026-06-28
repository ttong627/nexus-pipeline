# 📋 PROJECT STATUS — nexus-pipeline
> 자동 생성: /확인 스킬 · 갱신 2026-06-28 18:56 (Sunday)

## 식별
- GitHub: ttong627/nexus-pipeline (계정 세트: **ttong627**)
- Firebase 프로젝트: **logis-op**
- 로컬 경로: F:/Projects/nexus-pipeline-clean
- 브랜치: main

## 배포 환경
- 접속 URL: https://logis-op.web.app (HTTP 200 ✅) · https://logis-op.firebaseapp.com (200 ✅)
- 호스팅: Firebase Hosting (public=`dist`)
- 빌드: `npm run build` (vite build) — predeploy로 `version:bump` + `build` 자동 실행
- 배포: `npm run deploy` = `firebase deploy --only hosting --account ttong627@gmail.com`
- 릴리스: `node scripts/bump-version.cjs [minor|patch|major] "항목..."` (CLAUDE.md §22)
- 커밋·푸시: main 기준 / 계정 ttong627

## 앱 구성
| 앱/패키지 | 경로 | 역할 | 스택 |
|---|---|---|---|
| nexus-pipeline | / (루트) | 메인 프론트엔드 (주소정제·명단·루트맵) | React 19.2 + Vite 8 + Tailwind 4 + Firebase 12 |
| nexus-pipeline-functions | /functions | Firebase Cloud Functions (index.js) | Node |
| nexus-address-service | /address-service | 주소 정제 서비스 | Node |
| (address-service 사본) | /services/address-service | 주소 서비스 | Node |

## 마지막 작업
- debf7ba 2026-06-26 18:27 chore: 배포 버전 동기 (경과 2일)
- 직전 흐름: 기사 지도공유 **배송순번 미발행 시 순번·이동경로 숨김** + 공유지도 순번 미발행 시 이름·포수 라벨 유지 + 배송순번 도로 우선(corridor) 순회로 도로 재방문 차단
- 요약: 루트맵/기사 공유지도의 배송순번 표시 로직 + 버전관리 자동화 마무리

## 작업환경
- node v24.18.0 / npm 11.16.0
- 도구: gh OK · gcloud OK · firebase OK
- 의존성: node_modules 설치됨 (루트)
- 시크릿: `.env` 존재 ✅ · `.firebaserc` 존재 ✅ (값 비노출)
- 현재 앱 버전: 6.78.0

## 동기화
- 상태: **이미 최신** (origin/main 대비 behind=0, ahead=0, 워킹트리 clean)
- 마지막 fetch: 2026-06-28 18:56

## 리스크
- 🟢 동기화: 최신·clean
- 🟢 계정: active 계정 ttong0627 → **ttong627로 전환 완료** (repo owner 일치)
- 🟢 환경: node/npm/도구 정상, 의존성 설치됨
- 🟢 배포: 운영 URL 200 정상
- 🟡 git safe.directory: F드라이브 소유권 경고 발생 → 예외 등록으로 해결(이번 세션 처리)
- 🟡 멀티 address-service: `/address-service`와 `/services/address-service` 2벌 존재 → 중복 여부 확인 권장
