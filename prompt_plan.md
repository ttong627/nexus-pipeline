# 작업 완료: 정제 정확도 강화 (주소 없음 담당자 확인 + 변동감지 오탐 제거)

> ✅ 2026-06-05 완료·배포. /plan 확정안.

## 작업 A — 주소 없음 → 담당자 확인 (정제 단계)
- **정제는 이번달 주소 기준**으로 완료. 저번달/기본명단 주소로 **자동 채움 안 함**.
- ResultGrid 툴바 **`주소 확인 N건`**(amber) — 오류이며 전화확인 안 된 건 수.
- `AddressConfirmModal`(카드 1건씩): 담당자가 이번달 실제 주소 입력 → `handleConfirmAddress`로 단건 재정제(통과 시 오류 해제) / **[전화확인]** → `_전화확인=true`(미해결 명시) / [건너뛰기]. 열 때 목록 snapshot 고정.
- 완료 게이트: `handleExport`·`handleSaveMonthlyList` 진입 시 미확인(`_에러 && !_전화확인`)>0이면 confirm 경고.
- 핸들러: `handleConfirmAddress`(App.jsx, handleRepurifyErrors 단건판), `handleMarkPhoneCheck`. 모두 pushHistory 경유.

## 작업 B — 저번달 변동감지 오탐 제거 (CloudListManager)
- `normalizeRoadAddressCompareKey` 견고화: 괄호·번지 제거, **번길 띄어쓰기 통일**(`사가정로 2길`=`사가정로2길`), 쉼표 앞(도로+번)만, 도로명+본번(-부번) 추출.
- `addressCompareCore` 신규: 도로+번 영역 글자만(상세·동호수·층·공백 제거) — 유사값 비교용.
- `hasRoadAddressChanged`: 도로명+번 **같으면 변동 아님**, 도로키 추출 애매/유사하면 **변동 아님**, 명확히 다를 때만 '이사'. (이사 과탐 최소화)

## 변경 파일
App.jsx, components/AddressConfirmModal.jsx(신규), components/ResultGrid.jsx, components/CloudListManager.jsx

## 절대 보존
이번달 기준 정제·엔진·3순위 매칭·getDocsFromServer·배치499·pushHistory 불변. CL-4 changeType 구조 유지(비교 함수만 개선). 자동 주소 채움 금지(담당자 확정만).

---

## 이전 계획 (아카이브)

### 화면 그리드 칼럼 재정렬 (ResultGrid) — 완료
exportColOrder(엑셀 소스) 순서·표시를 화면도 따르게. renderHeaderCell/renderBodyCell + visibleCols, 배송순번 셀 추가, localColVis 제거. (이후 칼럼 편집 모드·기기간 동기화·디폴트순서 등으로 확장 완료.)
