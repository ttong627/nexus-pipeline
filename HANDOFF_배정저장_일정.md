# HANDOFF — 기사배정 저장/로드 + 작업일정 분할 (2026-07-24)

> 새 세션은 이 파일을 읽고 아래 5개 이슈를 작업한다. 형이 "저장하고 새 세션에서 작업" 요청.
> (v월드/배송완료 비교는 별도 `HANDOFF_vworld.md` 참조)

## 배경 진단 (이미 완료 — 저장은 되고 있음)
- 기사배정 = records의 **`기사`(기사명 문자열)**, 순번 = **`배송순번`**. cloud_lists에 저장.
- 세션메타 = **`route_sessions/{city}/months/{monthId}`**(drivers·assignedCount·status·completedDongs), 동매핑 = **`driver_assignments/{city}/orgs/{orgId}`**(dongDriverMap·drivers).
- 실제 저장 현황(2026-07-24 스캔): 시흥시 2026-06 **8568 완전저장(final)**, 동대문구 2026-07 **세션1524 vs records1136(388 누락)**, 인천 미추홀 2026-07 672, 천안서북 2026-05 1882 등.

## 5개 이슈 (형 요청 = 전부)

### ① 지도 재진입 시 배정·순번 복원 안 됨 (가장 급함)
- **원인**: `RouteMapModal.jsx` 1297~1317 복원 로직은 저장된 `기사`명 → `allKnownDrivers`에서 id 찾아 `_driverId` 복원. **재진입 시 저장된 기사구성이 자동 로드 안 되면 매칭 실패** → 배정 안 뜸. 현재는 "이어서 작업"(2755행, `route_sessions` getDoc)을 **수동**으로 눌러야 복원.
- **수정**: 지도 열 때(App.jsx 3407~3439 진입점, `initialCloudCity/MonthId`) **`route_sessions`가 있으면 기사구성+배정을 자동 복원**. 2755의 세션 불러오기를 진입 시 자동 실행. allKnownDrivers에 저장본 기사 항상 포함.

### ② 이번달 명단 화면에 기사·순번 컬럼 노출
- records에 `기사`·`배송순번` 저장돼 있으나 이번달 명단 화면(`CloudListManager.jsx`)에서 안 보임.
- **수정**: CloudListManager에 기사·배송순번 컬럼 표시(정렬 포함). App.jsx 컬럼설정 344~345 참고.

### ③ 기사별 순번 목록 뷰 (신규)
- "김기사 → 1번 홍길동, 2번 …" 기사별 담당 가구+순번 리스트. records를 기사별 그룹핑, 배송순번 정렬. 지도/명단 어디서든 열리게.

### ④ 동대문 388건 저장 누락 버그
- **원인**: `RouteMapModal.jsx` 2660행 `if (!r._cloudDocId) return` — DB에서 안 불러온(승계분·추가분) 레코드는 배정해도 저장 스킵. `_cloudDocId`는 로드 시에만 부여(1598·2924행).
- **수정**: 저장 시 `_cloudDocId || r.id`로 폴백해 **배정된 레코드는 하나도 안 빠지게**. 2319·3020행 등 동일 조건 전부 점검.
- ⚠️ 이미 누락된 388건 배정정보는 DB에 없어 **복구 불가**(route_sessions엔 개별배정 없이 assignedCount만) → 형이 재배정 필요.

### ⑤ 작업 일정 분할 편리화 + 순번·지형 단계적 구분
- **현재**: `src/engine/deliveryDaySplit.js`(수량 기반, 하루최대물량/날짜개수). UI = `RouteMapModal.jsx` 1147~1151(`daySplitOpen`·`daySplitMode`·`daySplitVal`·`daySplitSummary`).
- **형 요구**: 일정 나누는 방식을 편리하게 + **순번·지형(지리 위치) 기반 단계적 일정 구분**. 예) 배송순번 구간별/지리적 클러스터별로 1일차·2일차… 단계 배정. deliveryDaySplit.js에 순번·좌표 클러스터 분할 옵션 추가 + UI 개선(단계별 미리보기·저장).

### ⑥ 전월 작업내역 이번달 매칭 표시 + 신규 대상자 NEW 배지
- **요구**: 먼저 달(전월) 작업 내역(기사배정·순번 등)을 이번 달 명단에 **매칭해서 표현**(승계 표시), 전월에 없던 **신규 대상자는 `NEW` 표시**.
- **기존 활용**: `RouteMapModal.jsx` 2595행 "지난달 배정 불러오기", `delivery_history`(App.jsx 2161·2186행 — driver/seqNo/좌표 복원 기반 저장), 전월비교(신규/탈퇴/주소변경, `src/utils/prevMonthGuard.js`·`isRealAddrChange`).
- **매칭 키**: 이름+생년월일 또는 전화 — **동명이인 주의**(CLAUDE.md S-1~S-6 안전매칭 준수, 약키 단독 매칭 금지). 전월 대응자 없으면 `isNew=true`.
- **표시**: 이번달 명단·지도에 전월 기사/순번 승계값 표시 + 신규는 `NEW` 배지. 승계는 참고표시(자동 확정은 형 확인).

## 참고
- 저장 함수 핵심: `RouteMapModal.jsx` 2632~2700(route_sessions + cloud_lists records 동기화 + driver_assignments).
- 초기화(주의): 2302행 "기사배치·순번 전부 초기화"(클라우드 저장본까지 비움).
- 진단 도구: `node -e`로 firebase-admin(serviceAccountKey.json) 조회 — route_sessions/driver_assignments/records 기사·배송순번 현황.
- ⚠️ I: 정본 + 다중 PC 클론 → 하루 작업은 반드시 커밋·푸시 마감.
