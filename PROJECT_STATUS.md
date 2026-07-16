# 📋 PROJECT STATUS — nexus-pipeline
> 자동 생성: /확인 스킬 · 갱신 2026-07-16 15:24 KST

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
| CLAUDE.md | 프로젝트 전체 운영규칙 — 주소정제 A-1~A-30·동명이인 안전매칭 **S-1~S-6**·**무손실 원칙 M-1~M-6**·DB저장 B-1~B-16·루트맵 R-0~R-N·배송순번 DS·업로드/버전관리 |
| CLAUDE.md §1-5 무손실 원칙(M-1~M-6) | ★2026-07-16 신설 절대규칙 — 대상자·포수 누락 금지·완전중복 자동삭제 금지·내보내기 전건·다중시트·정합성 가드·명+포 병기 |
| DELIVERY_SEQUENCE_RULES.md | 배송순번 독립 규칙 상세 |
| 동명이인_주소오염_재발방지_설계.md | 2026-07-10 동대문 김옥순 사고 재발방지 — S-1~S-6 |
| CLAUDE_FORGE_PRINCIPLES.md | 코딩 황금원칙 |

## 마지막 작업 (2026-07-16) — 무손실 원칙 세션 · V6.81~V6.83
- **저장 사라짐 근본수정**: 이번달 명단 저장 후 화면이 월 목록을 캐시(getDocs)로 읽어 새 저장분이 안 보이던 문제 → CloudListManager `fetchMonths`·카드열기 조회를 `getDocsFromServer`로 전환
- **대상자·포수 누락 차단 (안양시 동안구 포수증발 사고 9명 10포)**: ① 정제 후 완전중복 **자동삭제 차단**(전건 유지 + `_중복의심` 표시) ② 내보내기를 `filteredData`→**`gridData` 전건**으로 ③ 다운로드 **[정제결과]+[확인필요]+[중복확인] 다중시트**
- **정합성 가드**: 파싱 건수 ≠ 정제 결과 건수 시 즉시 경고
- **명+포 표시**: 정제화면·기본명단·이번달명단 카운트에 포수 병기(포수 확인 최우선)
- **특이사항 이식 최신유지**: DbImportModal·CloudBaseModal `getDocsFromServer` + `updatedAt` 최신 우선
- **CLAUDE.md §1-5 무손실 원칙(M-1~M-6) 박제** — 절대규칙, 되돌리기 금지
- 커밋: `a7c77ae`(코드) · `b5aec12`(규칙) · V6.83 추가 커밋 예정

## 직전 작업 (2026-07-11)
- 외부 시스템(정부양곡 정산 SYSTEM) 명단 가져오기 — importUrl/import2Url · address-service 매칭 hang 근본 수정

## 작업환경
- node v24.15.0 / npm 11.12.1 · gh OK · gcloud OK · firebase OK
- 현재 앱 버전: **V6.83** · 무손실 원칙 적용본
- 의존성: **루트 node_modules 설치됨**. 하위앱 3곳 미설치 → 해당 서비스 작업 시에만 `cd <폴더> && npm install`
- 시크릿: `.env`·`.env.example` 존재 (gitignore, 값 비노출)
- 검증 게이트: `prebuild`=eslint --quiet && tsc --noEmit. 별도: `npm run typecheck`, `npm run test:e2e`

## 동기화
- 상태: 커밋·푸시 완료 (main = origin/main)
- 마지막 fetch: 2026-07-16 15:24 KST
- gh active 계정: ttong627 (repo owner와 일치 ✅)

## 리스크
- 🟢 동기화·계정·환경·배포: 정상 (최신·계정일치·루트 의존성 설치됨)
- 🟢 데이터 무결성: 무손실 원칙(M-1~M-6) 적용 — 대상자·포수 누락 차단, 완전중복 자동삭제 금지
- 🟡 하위앱 3곳(functions·address-service×2) node_modules 미설치 — 해당 서비스 작업 시 npm install 필요
- 🟡 VITE_ADDRESS_MATCH_API_URL 운영 연결 상태 재확인 권장(저하 모드 방지)
