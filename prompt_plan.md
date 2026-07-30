# 세션 핸드오프 (재부팅 후 이어서 — /sync로 불러오기)

> 2026-07-30 갱신. **P0 완료·배포·백필45건** · **P1 완료·반영30건** · **주소DB 장애 해결**.
> 다음 후보 = **P1-b 괄호 정화**(형 승인 대기).

## ✅ 주소DB API 장애 해결 (원인: 배치 자원 경합)
- 원인: `D:/Gemma4/govt_delivery_analysis/batch/batch_nexus_building.py` 가 `max_workers=8`로
  API를 계속 호출 → 서버 `pg.Pool` max=8(`PGPOOL_MAX` 미설정)을 **100% 점유** →
  앱·타 요청은 커넥션 획득 실패(10초 timeout) → 500. 배치도 500받고 재시도하며 재점유.
- 해결: 배치 종료 → **응답 10,000ms → 44~215ms**, 매칭 6/6. 현재 리비전 `00039-j2h`.
- ⚠️ 배치 재실행 시 **`max_workers`를 3 이하로** 낮출 것(캐시로 이어서 재개 가능).
- ★교훈: `db-status`는 200인데 특정 API만 timeout이면 **DB 장애가 아니라 커넥션 풀 경합**부터 의심.
  로그의 `httpRequest.userAgent`·`remoteIp`로 누가 호출 중인지 먼저 확인.
- gcloud는 **매 호출에 `--account=ttong627@gmail.com` 명시**(config set이 자꾸 되돌아감).

## ✅ P1 건물명 통일 — 완료·반영(30건)
- 통일 11그룹/30건(`addressMatchSource='building-name-unify'`) + `building_alias` 7개 학습.
- **표기 갈림 73그룹/318건 → 69그룹/274건**. 재실행 대상 0건.
- dry-run이 위험 2건 추가 차단: ①같은 도로명 다른 건물 이름 유입 → **응답 buildingMgtNo 일치 검증**(5그룹 폐기)
  ②DB가 용도명(`다세대주택`) 반환 → `isGenericUseName` 배제.

## ✅ P1-b 괄호 정화 — 완료·반영(73건, 커밋 `a18e865`)
- `src/utils/parenCleanup.js`(`classifyParenParts`, 테스트 14) + `scripts/cleanup-paren-junk.mjs`(기본 dry-run).
  `addressMatchSource='paren-junk-cleanup'`. 재실행 대상 0건.
- 예: `(상동, ◆상동, 상동대우마이빌)`→`(상동, 상동대우마이빌)`+`◆상동` ·
  `(신설동, 8652 (신설동))`→`(신설동)`+`8652` · `(장안동, 5층 식당보관, E (장안동))`→`(장안동)`+`5층 식당보관`
- **★dry-run이 사고 1건 차단**: `보성,유원아파트`(한 단지 이름)가 콤마로 쪼개져 `보성`이 잡값 분류 →
  건물명 훼손 직전. 판정을 **잡값 화이트리스트**로 전환(특수문자◆★·순수숫자·1글자파편·배송힌트
  키워드만 이관, 그 외 한글 고유명사는 건물명 일부로 보고 미개입). 정화대상 126→73건(오판 53 제거).

## ✅ 다수결 통일 — 완료·반영(48건)
`unify-building-name.mjs --allow-majority --write --learn` 실행. 30그룹/48건 반영, 보류 12그룹.
- **47건이 빈 건물명 채우기**(정보 추가·삭제 없음). 유일한 이름 교체는 용도명 `다세대주택`→실제 이름 `영신빌라`(올바른 방향).
- 재실행 대상 0건.

## 📊 최종 지표 (세션 종료 시점)
표기 갈림 **73그룹/318건 → 45그룹/133건**(185건·58% 개선).
소스: `paren-repair`74 · `paren-junk-cleanup`73 · `building-name-unify`78 · `nested-paren-repair`45.
**남은 133건 대부분은 `buildingMgtNo`가 없어 그룹핑 자체가 안 되는 레코드**(`화인빌↔파인빌`·
`유희주택↔숭의유희주택`·`태지빌라↔태지아트빌라`·`시그니처오피스텔↔시그니처아파트` 등).
→ **P2(buildingMgtNo 미보유 41.9% 보강)가 선행돼야 처리 가능.** 나머지 12그룹은 동률·근소차 보류.

## ▶ 다음 (형 승인 대기) — P2
`buildingMgtNo` 미보유 41.9%를 DB 재조회로 보강 → 동일성 판정 키 강화 → 남은 별칭·오타 처리 가능해짐.

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
