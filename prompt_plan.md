# 세션 핸드오프 (재부팅 후 이어서 — /sync로 불러오기)

> 2026-07-30 갱신. **P0 완료·배포·백필 반영**(`d971b97`). **P1 도구 완료·실행 보류**(`ae951f1`).
> 🔴 **차단**: 전국 주소DB(nexus-address-api) 장애 — 복구가 P1 선행 조건.

## 🔴 최우선 — 전국 주소DB API 장애 (2026-07-30 발견, 미해결)
- 증상: `/v1/address/match` **전부 500**, `/v1/address/db-status` → `timeout exceeded when trying to connect`.
  Cloud Run 로그 = 요청마다 **latency 10.0초 후 500**(DB 연결 timeout).
- 배제된 원인: Cloud SQL `nexus-address-pg` **RUNNABLE** / cloudsql-instances 주석 정상 부착 /
  트래픽 **100% 최신 리비전 `00037-b5q`**(`00021-nof`는 canary 태그 별도 URL).
- 남은 후보: 커넥션 풀 소진 · DB 과부하 · Cloud SQL 커넥터 소켓 · Cloud Run SA 권한.
- **영향**: 명단 정제 시 DB 매칭 전부 실패 → JUSO/Kakao 폴백(법정동·건물명 품질 저하). P1 실행 불가.
- 조사 도구: `gcloud config set account ttong627@gmail.com` 후 logis-op 조회 가능(ttong0627 권한 없음).

## ▶ P1 건물명 통일 — 도구 완료, DB 복구 후 실행
`src/utils/buildingUnify.js`(순수함수 `pickCanonicalBuilding`·`rebuildParen`, 테스트 23건) +
`scripts/unify-building-name.mjs`(기본 dry-run). 현재 dry-run = 표기 갈린 56그룹 **전부 보류**(정본 부재).

### ★dry-run이 막은 사고 2건 → 안전 기본값으로 확정
1) 같은 도로명주소를 같은 건물로 보면 다세대 밀집지에서 **다른 건물을 합침**
   (실측 시도: `영안아파트`→`태림홈타운`, `명성다세대`→`중동빌라`)
2) 오염 표기를 정답으로 채택 — `◆상동, 상동대우마이빌`(A-9 특수문자 + 법정동 혼입)

### 확정 안전 기본값 (되돌리지 말 것)
- 그룹키 = **건물관리번호만** (도로명주소 기준은 `--include-road` 명시)
- 정답 = **DB 정본 건물명만** (최다표기는 `--allow-majority` 명시)
- 정답 후보 위생 검사: `◆★` 등 A-9 잔재 · 콤마로 뭉친 값 · 법정동 혼입 배제
- 빈 건물명으로 통일 금지 · 동률·근소차 보류 · 비건물명 값은 특이사항 이관
- 상세주소·A-22 참고블록·건물명 속 괄호 보존

### DB 복구 후 순서
① `node scripts/unify-building-name.mjs` dry-run → 형 확인 ② `--write --learn` 반영
③ `node scripts/diag-address-consistency.mjs` 로 표기 변이 감소 확인

## ▶ P2 (대기)
`buildingMgtNo` 미보유 41.9% 보강 조회 → 동일성 판정 키 강화. DB 복구 선행.

## ✅ 완료된 작업 — P0 괄호 중첩 근본수리 + 45건 백필

### 측정 근거 (2026-07-30 전수 실측, `scripts/diag-address-consistency.mjs`)
- 88,463건 / 15명단. DB 매칭 99.8%, **정본(standardRoadAddress) 보유 100%**
- 표기 갈림: 건물관리번호 기준 73그룹/**318건(0.36%)** · 정본 기준 174그룹/**743건(0.84%)**
- `buildingMgtNo` 58.1% · `apartmentGroupKey` 32.6%
- → 형 원안(정본 문자열 그대로 저장) **불채택**: 정본은 이미 100%, 갈림은 1% 미만인데 8.8만건 형식 변경 리스크가 과도

### 근본 원인 (확정)
**건물명에 괄호가 포함되면 조립·파싱이 붕괴하고, 재정제마다 잔재가 누적된다.**
- 실측 예: 건물명 `호매실 엔루체(NLUCE)` → 저장값 `호매실로166번길 70, 2001-1704호 ) 호매실 엔루체(NLUCE (호매실동, 호매실 엔루체(NLUCE))`
- 건물명 `경희연립(마)` → `이문로9길 84, 302호 동 (이문동, 경희연립(마))` (`동`만 잔재)
- `왕산로2길 34, 312호 (신설동, 8652 (신설동))` — 법정동 2회·숫자 혼입
- 메커니즘: ①A-11이 `(법정동, 건물명)`으로 감싸 **괄호 짝 깨짐** ②`parseDisplayedAddress`의 괄호 추출이 `/\(([^)]*)\)/` = **중첩 미처리** ③재정제 경로(App.jsx 1630·1680·1752·1792가 저장된 `주소`를 다시 processAddress에 투입)에서 잔재 누적 ④`addressEngine.js:929` 괄호 보호가 non-greedy → A-28이 `)` 무조건 제거(증상처리·정보손실)

### 구현 단계 (TDD)
- **Phase 0** `src/utils/addressFormat.js`에 depth 인식 순수함수 추가 + 테스트
  `extractTopLevelParen` · `splitParenInner`(depth 인식 콤마) · `balanceParens` · `protectParenBlocks`
- **Phase 1** `parseDisplayedAddress`를 depth 인식으로 교체 (건물명 훼손 0 — 괄호 유지하며 정상 파싱)
- **Phase 2** `src/App.jsx` 중복 3함수(`findTopLevelSeparator`·`cleanAddressPiece`·`parseDisplayedAddress`) 제거 → addressFormat.js import (**SSOT**)
- **Phase 3** `addressEngine.js:929` 괄호 보호를 depth 인식으로 교체 + A-28 `)` 제거를 **짝 없는 것만**으로 정밀화 + 조립 전 buildingName 괄호 짝 균형화 방어
- **Phase 4** 회귀 그린 → 빌드 → 배포(predeploy 임시제거·계정 ttong627)
- **Phase 5** 기존 743건 수리 백필 `scripts/repair-nested-paren.mjs` — **dry-run 결과 형 확인 후에만 --write**

### 안전장치 (형 방침)
건물명 훼손 금지(괄호 유지·파서만 수정) · 명단 원문 삭제 금지(괄호 안 비건물명 값은 상세주소로 **이관**) · 매칭 실패 행 미변경 · 백필은 dry-run 선행 + 짝 균형 실패분은 원본 보존(억지 재조립 금지) · 멱등성 회귀 필수

### 후속 (형 승인 대기)
- **P1** 같은 건물관리번호 그룹 건물명을 DB 정본으로 통일 + 차이를 `building_alias` 학습 (실측 별칭: 화인빌↔파인빌·유희주택↔숭의유희주택·태지빌라↔태지아트빌라·시그니처오피스텔↔시그니처아파트·오스카빌↔꿈꾸는오스카빌)
- **P2** `buildingMgtNo` 미보유 41.9% 보강 조회
- **보류** 규격화 서버 이관(Phase 1~3 설계안 존재) — 측정 결과 시급성 낮음

관련 메모리: project_nexus_address_format_rules · project_nexus_legaldong_backfill · project_nexus_self_learning

---

## 이전 계획 (2026-07-30 A-10/A-11 주소 규격 — ✅완료·배포)
A-10 층 이동은 숫자 동만 + 비숫자 동 층 위치 보존 + 대시 동호(`101-203호`) 인식·규격화(커밋 `6d5c9fa`), A-11 건물명 맨 뒤 SSOT 정정(커밋 `1fadbfe`). `src/engine/dongHoFormat.js` 신규 17테스트. 상세=메모리 project_nexus_address_format_rules.

## 이전 계획 (2026-07-30 #5-A/B/D 자가학습 — ✅완료·배포)
특이사항 학습 재적용(`dad4f3f`) · 학습효과 측정 대시보드(`ee27ce9`) · 표기변이 정규화(`c3548a3`). 상세=메모리 project_nexus_self_learning.

## 이전 계획 (2026-07-26 자가학습 Phase 0~4 — ✅완료·배포)
명단정제 자가학습 정제규칙(캡처→후보→검토/승인→재적용) 구축. 저위험 자동+고위험 검토, 학습 4종(이름/주소 오타·건물명별칭·특이사항·컬럼), 동명이인 안전 최우선. Phase 0~4 완료·배포(logis-op), 테스트 19/19. 상세=메모리 project_nexus_self_learning.
