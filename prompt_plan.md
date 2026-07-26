# 세션 핸드오프 (재부팅 후 이어서 — /sync로 불러오기)

> 2026-07-26 갱신. **명단정제 자가학습 정제규칙** 계획 확정(형 승인). Phase 0부터 TDD.

## ▶ 진행 중 작업 (승인된 계획 — 구현 중)
**명단정제 자가학습 정제규칙** — 사용자가 그리드·지도에서 직접 고친 정제 결과를 캡처해 규칙 후보화→검토/승인→재적용하는 관리 루프 구축.

### 확정된 정책 (형 승인 2026-07-26)
- **적용 방식 = 저위험 자동 + 고위험 검토.** 오타·건물명별칭·특이사항·컬럼매핑 같은 저위험은 자동 축적·적용, 주소 도로명/본번 변경·이름 교체 같은 고위험은 관리자 검토 큐 경유.
- **학습 대상 = 4종 전부**: 이름/주소 오타 교정, 건물명 별칭 표준화, 특이사항/배송힌트 패턴, 컬럼 매핑 규칙.
- **동명이인 안전 최우선**: 이름 약키 매칭 영구 금지, 주소 본번 불변 검증(변조 차단 재사용). S-1~S-6 불변.

### 위험도 게이트
| 유형 | 위험 | 처리 |
|------|------|------|
| 이름/주소 오타(글자 유사·본번 불변) | 저 | 자동 축적·적용 |
| 건물명 별칭(같은 도로명+본번 안) | 저 | 자동 |
| 특이사항/배송힌트 이동(주소→특이사항, "이동≠삭제") | 저 | 자동 |
| 컬럼 매핑(가구·세대 오염 방어 재사용) | 저 | 자동 |
| 주소 도로명·본번 변경, 이름 자체 교체 | 고 | 검토 큐, 이름 약키 매칭 영구 금지 |

### 재료 (조사 완료 — Explore)
- 엑셀 파싱: `src/App.jsx:730` handleFileUpload, `src/excelWorker.js`(1619줄) parseSheet, 컬럼규칙 `src/columnRules.js`
- 주소엔진: `src/engine/addressEngine.js`(1545줄) processAddress(A-1~A-34 인라인). 서버매칭 lookupAddr→fetchAddressMatchAPI(POST /v1/address/match)
- 기존 자가학습: `typo_dict`(addTypoRecord/loadTypoDict 읽기·쓰기 작동, 호출은 재정제 시 App.jsx:1646뿐), `special_chars`(addSpecialChar), `ai_rules`(읽기만 App.jsx:627), 쓰기만 슬롯 `typo_suggestions`·`special_char_suggestions`·`nexus_ai_logs`(소비자 없음)
- 특이사항 SSOT: `src/utils/noteSanitizer.js`("이동≠삭제"), 가드 `src/utils/addressFormat.js:72` guardAddressDetail
- 수정 캡처 지점(현재): 그리드 `src/components/ResultGrid.jsx`, `CloudListManager.jsx`(2500줄), 지도 오버라이드 `RouteMapModal.jsx:5647`(errorAddrOverrides)
- 관리 UI: `src/components/AdminPanel.jsx`
- 동명이인 가드: `scripts/doppelganger-guard.mjs`(순수함수+테스트 9/9)

### 구현 단계 (각 Phase 커밋·형 확인 후 진행)
- **Phase 0 — 안전 기반**: 위험분류 순수함수 `src/learn/classifyCorrection.js`(before,after,field,context→{type,risk,ruleKey}) + `scripts/classify-correction.test.mjs`(동명이인·본번불변 픽스처). Firestore 모델 확정(`learn_candidates`·`building_alias`·`note_rules`·`learn_blocklist`).
- **Phase 1 — 캡처**: 그리드·지도 수정 훅 → `captureCorrection(...)` → 위험게이트 → 저위험 사전 직접반영+후보기록 / 고위험 pending 후보만. App.jsx:1646 재정제 캡처와 통합.
- **Phase 2 — 후보화·집계**: `learn_candidates` 반복빈도 집계·유형그룹핑. 저위험 임계 자동승격, 고위험 pending 유지.
- **Phase 3 — 검토·승인 UI**: `AdminPanel.jsx` "학습 대기 규칙" 탭(before→after·유형·빈도·위험, 승인/거부/수정). 승인=승격, 거부=blocklist.
- **Phase 4 — 재적용**: loadTypoDict 패턴 확장(building_alias·note_rules·ai_rules 앱시작 로드→addressEngine·워커 주입, dynamicRules:aiRules 경로 존재). 다음 정제부터 자동반영.

### 안전장치 (전 단계 공통)
- 이름 약키 매칭 영구 금지, 주소 본번 불변 검증. 저위험만 자동, 고위험 검토 전 절대 미적용.
- 승격 감사기록(누가·언제·무슨규칙) + 규칙 비활성 토글 롤백 + 승인 시 "N건 영향" dry-run 미리보기.

### 절대 보존
- 저장 스키마 미변경(규칙은 별도 컬렉션). 기존 typo_dict 루프 회귀 금지. S-1~S-6 안전매칭 불변.

### 테스트 방식
- 순수함수는 `scripts/*.test.mjs`(node 내장 test), 기존 doppelganger-guard·note-sanitizer 패턴 따름. `node scripts/classify-correction.test.mjs`로 실행.

---

## 이전 계획 (2026-07-25 · 완료·아카이브)
- ⑥ 전월 작업내역 승계 매칭 + 신규 대상자 NEW 배지 (Phase 1~3, 커밋 4b87430·556ff75). `src/utils/prevMonthCarryover.js` + `scripts/prev-month-carryover.test.mjs`. 승계=참고표시+버튼확인(자동확정 금지), 강키=birthKey+양측유일, S-1~S-6 안전.
- (2026-06-05·완료) 쉬운 정제(형식 기반 칼럼매칭 + 지자체 정확도 + 초보 마법사) Phase 1~3.
