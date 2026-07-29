# 세션 핸드오프 (재부팅 후 이어서 — /sync로 불러오기)

> 2026-07-30 갱신. **#5-A 특이사항(note) 학습 재적용 루프 완성** 계획 확정(형 승인 "고"). Phase 0부터 TDD.

## ▶ 진행 중 작업 (승인된 계획 — 구현 중)
**특이사항(note) 학습 재적용 완성** — 승인된 특이사항 학습이 저장·승인만 되고 정제 엔진이 소비 안 하는 미완결 결함을 닫는다. 이름·건물명과 동일한 **완전일치 dict 치환** 패턴, **주소 파싱 무개입·특이사항 필드만** 표준화.

### 핵심 설계 결정 (안토니 최적안 확정)
현재 note 학습은 `{hint}` 문자열만 저장 → 재적용할 매핑(무엇→무엇)이 없음. 두 갈래로 분리:
| 케이스 | 조건 | 동작 | 재적용 |
|---|---|---|---|
| 정규화 매핑 | before≠after 둘 다 있음 | `{wrong→correct}` note_normalize_dict | ✅ 완전일치 치환 |
| 힌트 축적(기존) | before 빈값(새로 추가) | `{hint}` note_hints 목록 | ❌ (참고 목록) |
→ 주소 무개입·완전일치만 = 형 안전방침(오적용 차단) 준수. 특이사항은 좌표·동선 무관해 오적용 피해 0.

### 구현 단계 (TDD)
- **Phase 0** classifyCorrection.js note 분기(before≠after→note_normalize, 빈값→note_move 유지) + 테스트
- **Phase 1** src/learn/applyNoteNormalize.js 신규(완전일치 치환) + apply-note-normalize.test.mjs
- **Phase 2-3** learnStore.saveNoteNormalize(note_normalize_dict/_suggestions) + captureCorrection 배선
- **Phase 4** addressEngine loadTypoDict에 note_normalize_dict 로드 + processAddress return 직전 특이사항 정규화
- **Phase 5** firestore.rules(note_normalize_dict/_suggestions) + AdminPanel LEARN_SUG_DEFS 제안 1종
- **Phase 6** node --test 그린→빌드→배포(predeploy 임시제거·계정 ttong627)→claude-in-chrome 시각검증

### 안전장치
완전일치만·특이사항 필드만 개입(주소·좌표·이름 무영향)·캡처 실패 비차단·기존 note_hints 무변경(퇴행0). firestore.rules 배포 시 nexus predeploy(npm run build eslint 게이트) 손상 함정 → 임시제거→배포→git checkout 복원.

### 변경 파일
classifyCorrection.js · learnStore.js · captureCorrection.js · addressEngine.js · firestore.rules · AdminPanel.jsx (+신규 applyNoteNormalize.js·2 테스트)

관련 메모리: project_nexus_self_learning · project_nexus_legaldong_backfill

---

## 이전 계획 (2026-07-26 자가학습 Phase 0~4 — ✅완료·배포)
명단정제 자가학습 정제규칙(캡처→후보→검토/승인→재적용) 구축. 저위험 자동+고위험 검토, 학습 4종(이름/주소 오타·건물명별칭·특이사항·컬럼), 동명이인 안전 최우선. Phase 0~4 완료·배포(logis-op), 테스트 19/19. 상세=메모리 project_nexus_self_learning.
