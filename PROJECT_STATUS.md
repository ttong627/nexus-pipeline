# 📋 PROJECT STATUS — nexus-pipeline
> 자동 생성: /확인 스킬 · 갱신 2026-07-16 22:02 KST

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
- ⚠️ 배포 전제: firebase CLI에 **ttong627@gmail.com** 로그인 필요. push 전 `gh auth switch --user ttong627` 확인(배포 중 ttong0627로 전환되는 사례 있었음)
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
| CLAUDE.md | 프로젝트 전체 운영규칙 — 주소정제 A-1~A-30·동명이인 **S-1~S-6**·**무손실 M-1~M-6**·컬럼매핑 §5(**CM-병합1·2**)·DB저장 B-1~B-16·루트맵 R·배송순번 DS·버전관리 |
| CLAUDE.md §1-5 무손실 원칙(M-1~M-7) | ★2026-07-16 절대규칙 — 대상자·포수 누락 금지·완전중복 자동삭제 금지·내보내기 전건·다중시트·건수/**포수 정합성 가드**·명+포 병기 |
| CLAUDE.md §5 CM-병합1·2·이름1 | ★2026-07-16 파싱 규칙 — 주소 서브헤더 라벨 데이터 오판 금지(컬럼밀림)·유령 후행 빈열 제거·**면/읍 이름 보호(정태면 누락 방지)** |
| DELIVERY_SEQUENCE_RULES.md | 배송순번 독립 규칙 상세 |
| 동명이인_주소오염_재발방지_설계.md | 2026-07-10 동대문 김옥순 사고 재발방지 — S-1~S-6 |

## 마지막 작업 (2026-07-16) — 무손실·파싱·표시·주소변환 대개편 · V6.81~V6.91
- **V6.91 주민센터 주소 자동변환(A-30④)**: 주민센터 84건이 확인필요로 빠지던 근본원인 = 지역검증 게이트(`getMunicipalityMatch`)가 cityLabel 정규명 **"서울특별시"**와 Kakao 결과 축약 **"서울"**을 `normalizePlaceKey`(공백제거만)로 비교 → `서울특별시≠서울` → 게이트 차단 → Kakao가 찾은 도로명주소 폐기. **`normalizeSido`+`SIDO_ALIAS`로 시도 축약 정규화**(서울특별시↔서울·경기도↔경기). 시군구 비교 유지(진짜 타지역 오매칭 계속 차단). `addressEngine.js`. 검증: 신설동/용두동 통과, 서울vs경기 차단
- **V6.90 A열 빈칸 밀림 해결 + 업로드 이상감지(M-8)**: ① `fixSheetRange` 시작열을 실제 데이터열(`minC`)부터 — A열이 빈 서식(차상위 양곡)에서 헤더/데이터 한 칸씩 밀리던 문제 차단(CM-범위1 보강) ② **업로드 직후 자동 이상감지(M-8)** — 핵심컬럼 미인식·데이터0건·원본 소계 대비 급감 시 정제 전 즉시 경고+자동확정 해제. `App.jsx uploadAnomalies`
- **V6.89 유령 시트범위 정정(CM-범위1)**: 정부양곡 서식 중 `!ref`가 `XFC892`(16000+열)로 과도하게 넓어 34MB로 비대해진 파일에서 sheet_to_json 오작동→헤더·컬럼 밀림 → **파싱 전 실제 셀 기준 범위 재계산**(`excelWorker.js fixSheetRange`, XLSX.read 직후 전 시트). 검증: 차상위 양곡 XFC892→L892, colIndices 정상(이름3·주소6·수량9)
- **V6.88 이번 업로드 포수 표시**: 지자체·월 확인 모달 '이번 업로드' 배지에 명 옆 포수 병기(M-6 확장). `uploadCounts`에 기초수급자Qty·차상위Qty 추가
- **V6.87 포수 정합성 가드(M-7)**: 원본 명단이 명시한 **소계 포수**(수급자 4785+차상위 1190=5975)와 정제 결과 포수를 대조해 다르면 즉시 경고. M-5(건수·파싱 이후만) 사각 보완 — **파싱 단계 누락(정태면류)까지 조기 감지**. 구현: `excelWorker.js` declaredQty/declaredHead/declaredPpl 추출(헤더 근처 "N포/N세대/N명") + `App.jsx` 정제 후 대조
- **V6.86 면/읍 이름 보호**: 이름이 '면/읍'으로 끝나는 대상자(**정태면**)가 파싱 본문 필터에서 행정구역(갈산면·광천읍)으로 오인돼 누락되던 문제 → 전화·포수·주소 등 개인 데이터 있으면 사람으로 보존. `excelWorker.js parseSheet` `/^[가-힣]{1,6}(면|읍)$/`. Red-Green 검증(수급자 4206→4207, 정태면 복구). 규칙 §5 CM-이름1 박제
- **V6.85 표시순번**: 엑셀 내보내기 첫 컬럼 `NO`→**`표시순번`** 라벨. 값은 화면 정렬순서(행정동→리→주소→이름) 그대로 숫자. 엑셀에서 주소 정렬 시 "10번길"<"7번길"(텍스트 사전순) 문제 → **표시순번 정렬로 화면 순서 재현**. key='NO' 유지(값 로직 보존), label만 변경(refreshSavedCols가 기존 사용자 자동 반영)
- **V6.84 컬럼 밀림 해결**: 정부양곡 서식(중원구) 차상위 시트가 밀리던 문제 → 원인 ① 병합 주소 서브헤더 "번지, 층, 호수(상세)"가 공백차로 13자→'긴 한글=데이터' 오판→서브헤더 통합 실패 ② 유령 후행 빈열(!ref 과잉). `excelWorker.js parseSheet`에 HEADER_LABEL_RE 서브헤더 보호 + 후행 빈열 trim. 규칙 §5 CM-병합1·2 박제
- **V6.81~6.83 무손실 원칙**: 저장 사라짐(월목록 getDocsFromServer)·대상자/포수 누락 차단(dedup 자동삭제 금지+전건 유지)·내보내기 전건+[정제결과]/[확인필요]/[중복확인] 다중시트·정합성 가드·명+포 표시. CLAUDE.md §1-5 박제
- 커밋: a7c77ae·b5aec12·3c6a2a3(무손실) · 2bb8c8f(컬럼밀림) · 07480d5(표시순번)

## 직전 작업 (2026-07-11)
- 외부 시스템(정부양곡 정산 SYSTEM) 명단 가져오기 — importUrl/import2Url · address-service 매칭 hang 근본 수정

## 작업환경
- node v24.15.0 / npm 11.12.1 · gh OK · gcloud OK · firebase OK
- 현재 앱 버전: **V6.91** · 무손실 M-1~M-8 + 파싱 견고성 CM-0~범위1 + 주민센터 자동변환(A-30④) 적용본
- 의존성: **루트 node_modules 설치됨**. 하위앱 3곳 미설치 → 해당 서비스 작업 시에만 `cd <폴더> && npm install`
- 시크릿: `.env`·`.env.example` 존재 (gitignore, 값 비노출)
- 검증 게이트: `prebuild`=eslint --quiet && tsc --noEmit. 별도: `npm run typecheck`, `npm run test:e2e`

## 동기화
- 상태: 커밋·푸시 완료 (main = origin/main)
- 마지막 fetch: 2026-07-16 18:25 KST
- gh active 계정: ttong627 (repo owner와 일치 ✅)

## 리스크
- 🟢 동기화·계정·환경·배포: 정상 (최신·계정일치·루트 의존성 설치됨)
- 🟢 데이터 무결성: 무손실 원칙(M-1~M-7) 적용 — 대상자·포수 누락 차단 + 원본 소계 포수 자동 대조
- 🟢 서식 견고성: 병합 헤더·유령 빈열 서식(정부양곡 차상위 등) 정상 파싱(§5 CM-병합1·2)
- 🟡 하위앱 3곳(functions·address-service×2) node_modules 미설치 — 해당 서비스 작업 시 npm install 필요
- 🟡 VITE_ADDRESS_MATCH_API_URL 운영 연결 상태 재확인 권장(저하 모드 방지)
