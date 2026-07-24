# 세션 핸드오프 (재부팅 후 이어서 — /sync로 불러오기)

> 2026-07-25 갱신. V7.2 배포 완료(logis-op.web.app). 아래 "진행 중 작업"부터 이어가면 됨.

## ▶ 진행 중 작업 (승인된 계획 — 구현 중)
**⑥ 전월 작업내역 승계 매칭 + 신규 대상자 NEW 배지** (HANDOFF_배정저장_일정.md ⑥)

### 확정된 설계 결정 (형 승인 2026-07-25)
- **승계 적용 = 참고표시 + 버튼 확인** (자동 확정 금지). NEW·승계값을 흐리게 보여주고 `[전월 승계 적용]` 버튼 누를 때만 빈 칸 채움.
- **범위 = Phase 1~3 (지도까지)**.
- **승계 강키 = 생년월일(birthKey) 기준만** — delivery_history record에 전화번호가 저장되지 않음(App.jsx 2179~2190: name·birthKey·dong·address·lat·lng·driver·seqNo·sms·gubun만). 생년월일 없으면 승계 불가(`_carryAmbiguous`).
- **동명이인 안전(S-1~S-6)**: 강키 + **양측유일**(전월·이번달 각 1건)일 때만 승계. 약키(이름 단독)·중복키 승계 금지.

### 재료 (조사 완료)
- 전월 저장: `delivery_history/{city}/months/{monthId}/records` — driver·seqNo·birthKey·lat·lng (App.jsx 2161~2197 저장, 1436 로드)
- 전월 신규판정: App.jsx 1439~1500 (`type:'new'`) — 이미 있으나 경고/게이트용, 승계·배지 미사용
- 기사·순번 컬럼: CloudListManager.jsx 83~84행 (②로 이미 구현)
- 지도 "지난달 배정 불러오기": RouteMapModal.jsx 2595행

### 구현 단계
- **Phase 1** — `src/utils/prevMonthCarryover.js`(순수함수: prev·cur records → 각 cur에 `_isNew`·`_prevDriver`·`_prevSeqNo`·`_carryAmbiguous` 부착, 강키+양측유일만) + `scripts/prev-month-carryover.test.mjs`(동명이인 픽스처 회귀)
- **Phase 2** — CloudListManager.jsx: 진입 시 전월 delivery_history 로드→유틸 적용, NEW 배지·승계 참고표시·`[전월 승계 적용]` 버튼(빈 칸만·약키/동명이인 제외)
- **Phase 3** — RouteMapModal.jsx: 지도에도 NEW·승계 표시, 2595행 기존 기능과 통합

### 절대 보존
- 저장 스키마 미변경(승계는 조회 시 동적 계산). 자동 주소·기사 채움 금지(버튼 확인만). S-1~S-6 안전매칭 불변.

---

## 이전 계획 (2026-06-05 · 완료·아카이브)
- 쉬운 정제(형식 기반 칼럼매칭 엔진 + 지자체 정확도 + 초보 마법사) Phase 1~3 — 상세는 git 이력 참조(`~/.claude/plans/glimmering-herding-thunder.md`).
- 완료분: 칼럼 편집모드·설정 동기화·주소없음 담당자확인·변동감지 오탐제거·PWA 설치버튼·SW 자동reload 제거.
