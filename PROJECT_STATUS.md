# 📋 PROJECT STATUS — nexus-pipeline
> 자동 생성: /확인 스킬 · 갱신 2026-07-22 13:54 KST

## ⚠️ 클론 분기 해소 기록 (2026-07-21)
- **문제**: `D:/TTong_newproject/nexus-pipeline` 클론에 7/15 작업(특이사항 보존·본명/건물명 컬럼·PII 제거)이 **커밋되지 않은 채** 남아 있었고, 그 사이 I: 정본에서 7/16에 V6.81~V6.94(17커밋)를 올려 **버전번호 V6.81이 양쪽에서 다른 내용으로 중복**됐다. 운영 배포본은 V6.94(origin 계열)이라 **7/15 기능이 운영에서 빠진 상태**였다.
- **해소**: ①로컬 미커밋 작업을 `rescue/v681-d-clone`(62bde54)에 통째로 커밋 보존 → ②main을 origin/main으로 FF → ③소스 7파일만 3-way 재적용(충돌 0) → ④빌드 게이트 통과 → ⑤**V6.95** 재부여·커밋(552d135). **양쪽 작업 모두 살아있음.**
- **교훈**: 이 저장소는 **I: 정본 / D: 작업본 2개 클론**이 동시에 쓰인다. 작업 시작 전 반드시 `/확인`으로 fetch·분기 점검하고, 하루 작업은 반드시 커밋·푸시로 마감할 것.

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

## 마지막 작업 (2026-07-22) — V6.99 명단 직접수정 UX·성능 개선
- **버벅거림 근본원인**: 기본명단관리의 입력값(`editValue`)이 **부모 상태**여서 글자 하나 칠 때마다 1,479줄 컴포넌트 + 12,584행 가상표가 통째로 재계산됐다. 이번달 배송명단은 이미 자체관리 구조였고, 두 화면 체감 차이의 원인이었다
- **수정**: 공용 `src/components/CellInput.jsx` 신설 — 입력값은 셀이 자체 `useState`로만 관리하고 **편집 종료 시 단 한 번만** `onCommit`. 두 명단 화면이 같은 컴포넌트를 쓴다
- **칼럼 수정모드(✏️)**: 헤더 볼펜 버튼 → 그 칼럼 전 셀이 입력창. `Enter`/`Tab` 다음 행, `Shift+`는 이전 행으로 이동해 **마우스 없이 연속 입력**(특이사항 대량 입력용)
- **더블클릭 진입**: 단일 클릭 진입 제거 — 스크롤 중 오진입으로 입력창이 열리던 방해 차단
- **셀 단위 즉시 자동저장**: 셀에서 빠져나오면 그 칸만 `setDoc(merge:true)` 저장, 실패 시 화면 값 원복 후 알림(낙관적 갱신). 저장 버튼 대기 없음
- **규칙 UI-1 박제** — 다시는 입력값을 부모 상태로 되돌리지 않도록 CLAUDE.md에 고정
- **A-34 전 지자체 소급 완료**: 용산구 70건 + 타 지자체 32건(동대문구 등) = **102건** 이름·생년월일 분리. 재검증 잔여 0건. **41건은 본명 컬럼이 없어 복구 불가**(원본 정보 자체가 소실 — `이름[김진홍(전]` 형태, 다음 명단 업로드 때 A-34로 정상 처리됨)
- **검증**: `npm run build` EXIT=0 · dev 서버 실구동 확인(앱 로드 · **콘솔 에러 0건**) · 두 명단 모듈 200 · 단일클릭 편집 진입 잔존 0건

## 이전 작업 (2026-07-22) — V6.98 특이사항 정제·검증 + 누락 근본원인 수정 (배포 완료)
- **DB 전수 정제 (형 승인 후 실행)**: 레코드 333,683건 중 특이사항 31,129건을 전수 분석 → **찌꺼기 1,895건만 정제**, 실제 배송메모 29,362건 전량 보존. 조치: 주소중복삭제 878 · 본명→본명컬럼 398 · 건물명→건물명컬럼 337 · 건물명중복삭제 208 · 무의미삭제 76(`☆`·`0000`·`나`) · 법정동이동 1. 도구 `scripts/clean-special-notes.mjs`(dry-run 기본·`--write`·`--verify`), 원본 백업 `_tmp_backup_notes_*.json`, `audit_logs` 기록
- **호수→상세주소 우선 보정(형 지시)**: 값이 주소 문자열에만 있고 전용 컬럼이 비어 있는 채로 지워진 **141건 복원**(호수→상세주소 5·건물명 135·법정동+건물명 1). 삭제 0건. `scripts/fix-note-column-restore.mjs`
- **★M-9 누락 근본원인 규명·수정**: 월 명단이 이식받은 `◆내용`을 저장 시 B-9가 제거 → `note=''` → **그 빈값이 기존 기본명단 특이사항을 덮어씀**. 저장할수록 특이사항이 사라지는 구조였고 동대문구 **3,074건**이 공란화됨. `updData()`로 빈값 덮어쓰기 차단(신규·인플라이트 경로 모두). `App.jsx` 기본명단 저장부
- **기준명단 대조 복원**: `기준명단.xlsx`(동대문구 66,183행·고유 17,750명) vs base_lists(12,584건) 대조 → **3,055건 복원**(공란→채움 2,582 · 병합 473). 시스템 찌꺼기(`[주소추정]`)는 A-33으로 걸러내고, 내용이 다른 건은 `mergeNotes`로 합집합 병합(무손실). `scripts/restore-notes-from-baseline.mjs`
- **A-33 특이사항 검증 단일규칙**: `src/utils/noteSanitizer.js` 신설(앱·스크립트 공용 SSOT). 이동이 기본·삭제는 2가지만·애매하면 보존. 회귀 테스트 `scripts/note-sanitizer.test.mjs` **38 PASS / 0 FAIL** — 테스트가 실제 버그 2건 검출(`계단위 201호 정면`을 통째로 상세주소로 보내던 문제, 병합 시 기호만 다른 중복 문구가 두 번 남던 문제)
- **A-34 이름칸 (생년월일) 분리**: `홍길동(750315)` → 이름·생년월일 분리. A-1(5자 절단)보다 먼저 실행. 6/8자리 숫자일 때만 분리하고 `최정호(박주령)` 같은 본명 괄호는 보존
- **검증**: `npm run build` EXIT=0 (prebuild 게이트 eslint+tsc 통과) · 회귀 38/38 PASS · 정제 재검증 `--verify` 잔여 0건
- **A-33 적용 지점 2곳 연결(형 지시 1~5 ②)**: ①정제 단계 `App.jsx` 행 조립부 — 검증 후 **특이사항의 호수를 주소 상세부로 승격**해 주소 재조립 (★다음 달 명단 상세주소에 호수가 없어도 특이사항에 있으면 자동으로 채워진다 — 형 질문 답) ②저장 단계 base_lists 저장부 — 정제를 안 거치는 경로의 마지막 방어선(`detailAddr` 공란이면 승격값 사용)
- **A-34 DB 소급 적용 — 용산구 70건**: `이정숙(6` + 본명 `이정숙(601128)` → 이름 `이정숙` + 생년월일 `60.11.28`, 본명 비움. A-1 5자 절단으로 잘린 원본을 본명 컬럼에서 복구. `양현숙(조관순)` 같은 진짜 본명은 건드리지 않음. 재검증 잔여 0건. 도구 `scripts/split-name-birth-db.mjs`(dry-run 기본·`--all` 전 지자체 스캔)
- **🟡 남은 동종 건 32건**: 동대문구 등 타 지자체에도 같은 형태(`이재섭
(760524)`) 존재 — 형 지시가 용산구 한정이라 보류. 적용하려면 `node scripts/split-name-birth-db.mjs --all --write`
- **★배포 완료**: `npm run deploy` → https://logis-op.web.app **HTTP 200** · 번들 `index-hl4FAZYW.js` · V6.98 3회 확인 · 신규 로직 문자열 실측(`반지하|옥탑` 1 · `원룸텔` 1 · `없슴` 1 = A-33 검증기 탑재 확인, 함수명은 minify로 치환됨)
- **⚠️ 미커밋·미푸시**: 로컬 변경분이 origin에 없음 → **7/21 클론 분기 사고 재발 조건**. 형 승인 후 즉시 커밋·푸시 필요
- **⚠️ 런타임 미검증**: 실제 명단 업로드→정제→저장 사이클은 아직 안 돌려봄. 동대문구 월 명단 1건으로 특이사항 유지 여부 확인 권장

## 이전 작업 (2026-07-21) — V6.97 법정동·건물명 빠짐 0 정밀화 (푸시·배포 완료)
- **a8bcdb5 · 배포 검증**: 번들 `index-XBnQRIdO.js` — V6.97 · `region_3depth_name`(법정동) 사용 · `region_3depth_h_name`(행정동) **0회**
- **실측 방법**: 실재 주소 200곳(동대문구·시흥시·수원 팔달구·홍성군·중랑구)을 **도로명+동호수 / 지번 / 건물명만** 3형태로 투입해 **599건** 측정 → 빠지는 경로를 하나씩 제거
- **채움률 57.9% → 89.0% → 98.5% → 99.2%** (도로명 77.4→99.0 / 지번 76.5→100 / 건물명만 20.0→98.5)
- **잔여 5건은 결함 아님**: 4건은 실제 **장안구** 소재를 팔달구로 조회 → A-30 지역검증이 올바르게 거부(채웠다면 오매칭 버그), 1건은 미준공(주소 미부여)
- **A-32로 규칙 박제** — ①`LEGAL_DONG_RE` 법정동 형태 확장(`매산로2가`·`홍북읍 신경리`·읍/면/리) ②읍면은 법정리까지 보강+`리` 백필 ③지번주소는 API 없이 법정동 확정 ④건물명 전용 매칭 확장(행정동 없어도·유형어 없어도, 이름 포함관계 검증) ⑤`숫자+동/층/호` 뒤 한글이면 동호수 아님(`장안2동우체국`이 `장안`으로 잘리던 문제) ⑥건물명 컬럼=괄호 표시값 ⑦무손실(M-1) 입력 문구 보존
- **검증**: 회귀 10/10 PASS · `npm run build` EXIT=0

## 이전 작업 (2026-07-21) — V6.96 괄호 법정동 정정 + 법정동 컬럼 (푸시·배포 완료)
- **b258371 · 배포 검증**: 번들 `index-CBRoAdiK.js` — V6.96 · 법정동 컬럼 · Kakao `region_3depth_name` 사용 · `region_3depth_h_name`(행정동) **0회**(사용 안 함) 확인
- **증상**: 정제 후 괄호가 `(법정동, 건물명)`이 아니라 **행정동**으로 표기되고 주소 API 데이터도 반영 안 됨
- **근본원인 3가지**
  1. **A-24 우선순위**: 도로명주소(`roadAddrPart1`)에는 동 토큰이 없는 경우가 대부분인데 폴백이 `adminDong`(행정동 컬럼) → `emdNm`(법정동) 순서 → 사실상 **행정동이 괄호에 들어감**
  2. **Kakao 폴백이 법정동을 안 채움**(`kakaoDocToApiResult`). 전국 주소DB가 콜드스타트에서 **20초+** 걸려 클라이언트 3초 타임아웃에 걸리면 정제는 전부 이 경로 → 법정동 항상 공란
  3. 저하 모드 시절 **캐시(법정동 없음)를 그대로 재사용** → 영구적으로 공란
- **수정**: A-24 개정(법정동 최우선) + A-31 신설(캐시 품질 게이트 · Kakao `region_3depth_name` 보강 · POI 지번에서 법정동 추출 · 타지역 폐기 시 법정동도 폐기) + **법정동 컬럼**(그리드·엑셀 최종명단/배송표·`cloud_lists.법정동`·`base_lists.legalDong`, 기존 레코드는 괄호 첫 토큰 파생, 엑셀 컬럼 v4)
- **검증(실엔진 6건)**: GREEN 6/6 — 왕산로 72→`(용두동…)`, 천호대로 145→`(용두동, 동대문구청)`, 사가정로 230-1→`(장안동…)`, 효원로 241→`(인계동, 수원시청)`. **RED(수정 되돌림) 3/6 FAIL** — 왕산로 72→`(전농동)`, 천호대로 145→`(용신동)` = 지적된 증상 그대로 재현
- **🟠 남은 과제(서버)**: `nexus-address-api`(Cloud Run) **콜드스타트 매칭 20~23초** — db-status는 0.14s 정상, DB도 published(주소 98.7만·건물 1072만). 매칭 쿼리/콜드스타트가 느려 클라이언트 3초 타임아웃에 걸린다. 현재는 Kakao로 우회 중. 근본 해결은 **min-instances≥1 또는 매칭 쿼리 인덱스 점검** 필요

## 이전 작업 (2026-07-21) — V6.95 특이사항 보존·본명/건물명 컬럼 복원 (푸시·배포 완료)
- **배포 검증**: https://logis-op.web.app **200** · 번들 `index-BGwJiEA-.js`에 V6.95·건물명 컬럼·블랙리스트·주소매칭 URL·7/16 무손실(중복확인 시트) 전부 확인
- **🔴 배포 직전 차단한 회귀**: D: `.env`의 `VITE_KAKAO_REST_KEY`·`VITE_ADDRESS_MATCH_API_URL`이 공란이라 그대로 배포하면 **운영 주소매칭 서비스(`nexus-address-api-31783407891.asia-northeast3.run.app`)가 끊길 뻔했다.** 운영 번들에서 두 값을 복구해 `.env`에 기록 후 재빌드(백업 `.env.bak.20260721`, gitignore 확인). **앞으로 D:에서 배포 전 반드시 이 2키 확인.**
- **552d135 / 830dd42 (origin/main 반영)**: 7/15 D: 클론 유일본 작업을 origin/main 위에 재적용
  - **특이사항 화이트리스트→블랙리스트 반전**(`App.jsx NOTE_JUNK_RE`): 도어락·현관비번(#9999)·열쇠 위치·"건물 뒤편" 등 키워드 없는 자유 배송문구가 통째로 삭제되던 문제 차단. 세그먼트→**토큰 단위** 필터로 "경비실맡김 자부담" → "경비실맡김" 보존
  - **본명·건물명 전용 컬럼**(`colOrder.js realName/buildingName`, 엑셀 컬럼 v3 병합): 표시·base_lists 저장·엑셀 출력. 사용자 표시/폭/순서는 보존하고 새 컬럼만 추가(리셋 금지)
  - **주민등록번호(PII) 자동 제거**(`NOTE_PII_RE`) — 전화번호는 배송 연락처라 보존
  - 기본명단 이식 note에서 레거시 `(본명:XXX)` 제거(이중오염 차단), 전체합본 시트 열너비를 `deliveryCols.length` 기준 산출
  - 검증: `npm run build` EXIT=0 (prebuild=eslint --quiet && tsc --noEmit 통과) · 충돌 0 · origin 7/16 17커밋 전량 잔존 확인(uploadAnomalies·declaredQty·fixSheetRange·normalizeSido·표시순번·소속사요약)
- 보존 브랜치: **`rescue/v681-d-clone`(62bde54)** — 재적용 검증 끝날 때까지 삭제 금지

## 이전 작업 (2026-07-16) — 무손실·파싱·표시·주소변환 대개편 · V6.81~V6.94
- **V6.92 소속사요약 시트**: 소속사 보고서 다운로드 **맨 앞에 '소속사요약' 시트** 추가 — 소속사별 동별 포수 + 소속사 소계 + 전체 합계(행정동요약 형식). `orgReport.js downloadOrgReport`
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

## 작업환경 (2026-07-22 13:54 KST 실측 · I: 정본 기준)
- node v24.15.0 / npm 11.12.1 · gh OK · gcloud OK · firebase OK
- 현재 앱 버전: **V6.97** · 무손실 M-1~M-8 + 파싱 견고성 CM-0~범위1 + 주민센터 자동변환(A-30④) + 소속사요약 + 특이사항 보존·본명/건물명 컬럼 + **법정동 정밀화(A-32, 채움률 99.2%)**
- 의존성: **루트 node_modules 재설치 완료**(2026-07-22 · `npm install` exit 0 · 669 packages). 하위앱 3곳(functions·address-service·services/address-service) 미설치 → 해당 서비스 작업 시에만 `cd <폴더> && npm install`
- 시크릿: `.env`(키 12개)·`.env.example` 존재 (gitignore, 값 비노출). **I: 정본은 `VITE_KAKAO_REST_KEY`·`VITE_ADDRESS_MATCH_API_URL`·`VITE_FIREBASE_API_KEY` 모두 설정됨 ✅** (D: 클론은 공란이었음 — 빌드는 I:에서)
- 배포 URL 헬스체크: https://logis-op.web.app → **HTTP 200 ✅**
- 검증 게이트: `prebuild`=eslint --quiet && tsc --noEmit. 별도: `npm run typecheck`, `npm run test:e2e`

## 동기화 (2026-07-22 13:51 KST)
- 상태: **FF 최신화 완료** — I: 정본이 origin/main보다 7커밋 behind(V6.94 정지, 7/21 D: 작업 미반영)였음 → `git merge --ff-only origin/main` 실행 → **7cd97ca(V6.97)**, 현재 behind 0 / ahead 0
- 미커밋 2건 보존: `claude-forge/hooks/output-secret-filter.sh`(삭제) · `claude-forge/skills/security-compliance/reference/threat-modeling-risk.md`(수정) — 앱 코드 무관, 인커밍과 겹침 0
- 마지막 fetch: 2026-07-22 13:51 KST
- gh active 계정: **ttong0627**(전역) ≠ repo owner **ttong627** → 전역 전환 없이 `GH_TOKEN=$(gh auth token -u ttong627)` 주입 방식으로 fetch/merge 수행. **push·배포 시 동일 주입 또는 `gh auth switch --user ttong627` 필요**

## 리스크
- 🟢 배포·환경·시크릿: 정상 (운영 200 OK · .env 3대 키 설정 · 루트 의존성 설치 완료)
- 🟢 데이터 무결성: 무손실 원칙(M-1~M-8) 적용 — 대상자·포수 누락 차단 + 원본 소계 포수 자동 대조
- 🟢 서식 견고성: 병합 헤더·유령 빈열 서식(정부양곡 차상위 등) 정상 파싱(§5 CM-병합1·2)
- 🟡 **2클론 분기 재발 위험** — I: 정본 / D: 작업본이 동시 사용됨(7/21 사고). 오늘 FF로 해소했으나, **작업 시작 = /확인, 작업 종료 = 커밋·푸시**를 반드시 지킬 것
- 🟡 gh 전역 active가 `ttong0627` — 이 repo(ttong627) push 전 계정 확인 필수
- 🟡 하위앱 3곳(functions·address-service×2) node_modules 미설치 — 해당 서비스 작업 시 npm install 필요
- 🟡 `npm audit` 18건(critical 1·high 7) — critical=`websocket-driver`(dev 경유). **주의 대상: `xlsx@^0.18.5` Prototype Pollution(HIGH)** — 사용자 업로드 엑셀을 파싱하는 앱 특성상 실사용 경로. npm 레지스트리판이 갱신 안 되는 패키지라 교체 검토 필요(형 승인 후 별건 처리)
- 🟠 `nexus-address-api`(Cloud Run) 콜드스타트 매칭 20~23초 — 클라이언트 3초 타임아웃 → Kakao 우회 중. min-instances≥1 또는 매칭 쿼리 인덱스 점검 필요(V6.96에서 식별된 미해결 과제)
