# 작업 이어서: 화면 그리드 칼럼 재정렬 (ResultGrid)

> 새 세션에서 "그리드 칼럼 재정렬 이어서 해줘"라고 하면 이 문서대로 바로 실행.
> ⚠️ ResultGrid는 매일 쓰는 핵심 화면 → 격리 워크트리에서 단계별 빌드 검증 권장.

## 목표
이번달/정제 결과 그리드(ResultGrid)의 **화면 칼럼 순서·표시**를 사용자가 바꾼 대로 보이게.
(엑셀 다운로드 순서는 이미 `exportColOrder`로 적용됨 — 화면도 같은 소스로 구동)

## 이미 완료된 토대 (현재 main, 배포됨)
- `exportColOrder`(App.jsx): localStorage `nexus_export_cols_v2`에 **순서·on 영구 저장**(리셋 버그 수정 완료)
- DEFAULT_EXPORT_COLS 키: NO, 구분, 행정동, **리**, 이름(성명), **품명**, 생년월일, 포수, 휴대폰, 유선전화, 문자수신, 주소, 특이사항, 기사, 배송순번, 사유
- "칼럼" 패널(ColOrderPanel, ResultGrid.jsx:7)에서 드래그 순서+on/off+기본복원 → 저장됨 → 엑셀 반영
- 옛 "컬럼 설정"(localColVis) 버튼 제거됨
- 검색창 강조 + "표준 명단 패키징"→"명단 다운로드" 완료

## 구현 방법 (switch 렌더, 동작 보존)
1. ResultGrid 컴포넌트 안에 두 함수 추가:
   - `renderHeaderCell(key)` — 각 칼럼 `<th>` (기존 JSX를 case로 이동, handleSort 유지)
   - `renderBodyCell(key, row, idx)` — 각 칼럼 `<td>` (기존 JSX를 case로 이동)
     - 복잡 셀: 주소(편집 input+handleAddressKeyDown), 특이사항(편집), 기사(편집+datalist), 사유(추정뱃지+업데이트버튼). 배송순번은 신규 단순 셀(row.배송순번) 추가.
2. 고정 칼럼: **체크박스 + NO**는 sticky라 그대로 두고 reorder 제외.
3. `visibleCols = exportColOrder.filter(c => c.on && c.key!=='NO').map(c=>c.key)`
4. 헤더 `<tr>`: 체크박스 th + NO th + `{visibleCols.map(renderHeaderCell)}`
5. 본문 `<tr>`: 체크박스 td + NO td + `{visibleCols.map(k=>renderBodyCell(k,row,idx))}`
6. 기존 `localColVis.X &&` 인라인 가드 제거(이제 exportColOrder on이 표시 제어). localColVis state 삭제.
7. key→record필드 매핑: 이름→row.이름, 사유→오류사유, 나머지 동일.

## 검증
- 빌드 성공 후에만 배포(운영 안전). 칼럼 드래그→순서 반영, 숨김→화면+엑셀 동시 숨김 확인.

## 절대 보존
주소 편집 input·Enter 재정제(handleAddressKeyDown), Ctrl+D 복사, 오류 하이라이트(row._에러), 👑 이식표시, sticky 체크박스/NO.
