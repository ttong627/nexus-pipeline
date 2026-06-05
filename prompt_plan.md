# 세션 핸드오프 (재부팅 후 이어서 — /sync로 불러오기)

> 2026-06-05 저장. 모든 코드 커밋·푸시 완료(main=origin/main). 아래 "다음 작업"부터 이어가면 됨.

## ✅ 방금 완료 (배포됨)
- **칼럼 편집모드**: 헤더 직접 드래그로 순서변경 + 폭조절 + 👁표시/숨김 + 완료/취소/기본값 바. 4개 명단 공통. (useColumnEditor, ColumnEditBar, ColHeaderEditControls, ColResizeHandle)
- **칼럼 설정 기기간 동기화**(Firestore users/{uid}.exportColOrder) + **디폴트 순서 버전게이트**(NO·구분·읍면동·리·이름·주소·휴대폰·유선전화·포수·특이사항·문자수신·생년월일·기사·배송순번·오류사유, 품명 숨김).
- **주소 없음 → 담당자 확인**(AddressConfirmModal, 카드 1건씩) + 완료 게이트. 정제는 이번달 기준, 자동채움 없음.
- **저번달 변동감지 오탐 제거**(CloudListManager hasRoadAddressChanged/normalizeRoadAddressCompareKey + addressCompareCore): 도로명+번 같으면 변동 아님, 애매하면 변동 아님.
- **바로가기(PWA 설치) 버튼**(InstallButton, 헤더) + **앱 아이콘**(public/app-icon.svg, 정사각 SVG). manifest/파비콘 적용.
- **SW 자동 reload 제거**(main.jsx registerSW) — 반복 새로고침/크래시 방지.

## ▶ 다음 작업 (승인된 계획 — 미구현)
**쉬운 정제: 형식 기반 칼럼매칭 엔진 + 지자체 정확도 + 초보 마법사** (상세: `~/.claude/plans/glimmering-herding-thunder.md`)
- **Phase 1** — `src/excelWorker.js` `parseSheet`(:43)에 **데이터 형식 점수**(mobileRatio·landlineRatio·dateRatio·ynoxRatio·smallIntRatio·koreanNameRatio·dongRatio·roadAddrRatio·gubunRatio) 추가 → 휴대/유선 분리·포수(가구원제외)·문자수신·생년월일·구분 확정 + `colConfidence`/`ambiguousKeys` 출력. (규칙: CLAUDE.md §5-1)
- **Phase 2** — `extractCityName`(:1237) 시·군·구 후보 반환 + App에서 **userCities 대조**로 정확한 지자체 확정. (§5-2)
- **Phase 3** — 신규 `EasyCleanConfirm.jsx` + Dashboard **[쉬운 정제]** 진입(처음 사용자에게 **눈에 띄게**). 확인카드는 **노랑(애매)만** 표시 → 기존 `handleAnalyzeAll`·ResultGrid·AddressConfirmModal 재사용. 신뢰도 임계값 기본 90%(상수).
- 권장순서: Phase1(엔진, 고급에도 이득) → 2 → 3.

## ⚠ 크롬 크래시(모든 창 닫힘) 복구
- 원인 추정: 짧은 시간 **반복 배포** → PWA SW 자동 새로고침 churn + 큰 데이터 재처리 → 메모리 폭증 → 렌더러 크래시.
- 복구: F12 → Application → Service Workers **Unregister** + **Clear site data** → 크롬 재시작 → (설치한 PWA면 제거 후 재설치). 지속 시 크롬 하드웨어 가속 끄기.
- **교훈**: 수정은 묶어서 **1회 배포**. 연속 배포 금지.

## 절대 보존
이번달 기준 정제·엔진·3순위 매칭·getDocsFromServer·배치499·pushHistory·CL-4 changeType 구조 불변. 자동 주소채움 금지(담당자 확정만).
