# 구현 계획 — 후속 4과제 (2026-08-23 전체 점검 후속 · 형 "전부 고" 승인)

> `/plan` 산출물. 근거 = 2026-08-23 전체 점검(독립 검사단 5팀) + 직접 실측.
> **원칙**: 기능 퇴행 금지(CLAUDE.md 7장·19장) · 회귀 루트 447 + 규칙 55 항상 그린 · 배포는 형 승인 후.

## 점검에서 드러난 사실 (계획을 바꾼 3가지)

| 발견 | 실측 근거 |
|---|---|
| 지도의 진짜 통증은 "핀이 많다"가 아니라 **1건 바꿔도 전량 재생성** | 마커 effect deps 가 전건 시그니처(`RouteMapModal.jsx:1341,1477`) → 우클릭 1회에도 오버레이 N개 파괴+생성, DOM 6~9N개 |
| `displayRecords` useMemo 가 **절반만 작동** | `filteredRecords`(`:619`)가 매 렌더 새 배열 → 동 큐가 잡힌 상시 경로에서 메모가 매번 깨짐 |
| **UI 안전망이 사실상 없음** | 컴포넌트를 지키는 테스트 2개는 텍스트 grep · `checkJs:false` · 스모크 28줄은 로그인을 안 해 루트맵 도달 0 · eslint 여유 13(107/120) |

## 실측 수치 (계획의 근거)

- 좌표캐시: 건당 `getDoc` **27.8ms** → 7,402건 **약 206초** vs 도시 1회 로드 **637ms · 255KB** = **323배**
- 좌표캐시 규모: 13개 지자체 · 41,694주소(최대 도시 7,402) · 월 명단 4,000~7,400건
- RouteMapModal: 5,850줄 · useState **88** · useRef 22 · useEffect 27 · useCallback 44
- 건별 문서 `completion` 필드: 규칙은 이미 허용(`firestore.rules:426`)인데 **사용처 0** — 착지점이 이미 있다

---

## Phase 0 — 안전망 (선행 필수)

0-1 순수함수 특성화 테스트 5종(`buildMapInsights`·`buildAssignedRouteUnits`·`getMixedRouteUnitIssues`·`getRouteUnitKey`·`assessKakaoAreaMatch`)
0-2 복제 금지 가드 2개를 **디렉터리 글롭**으로 승격(분할 후에도 계속 검사받게)
0-3 eslint 경고 기준선 **107** 기록 · 단계마다 확인(여유 13)
0-4 수동 체크리스트 8항목 문서화(핀 색·브러시·자동분할·순번·공유·세션복원·동큐·Escape)

## Phase 1 — 좌표캐시 N+1 제거 ⭐

1-1 `loadCityCoordCache(db, city)` — `.select('lat','lng')` 1회 로드 → Map + `idbCache` 세션 간 재사용
1-2 호출부 3곳 교체(`App.jsx:2012` · `CloudListManager.jsx:1162` · `RouteMapModal.jsx:3172`), 미스만 개별 조회
1-3 RouteMapModal 안의 캐시 사본(`:2255-2271`) 제거 → SSOT 통합
  ⚠️시그니처 상이(유틸 `(db,city,주소)`+내부 `extractRoadAddress` ↔ 모달 `(city, 추출된 road)`) → **키 동일성 회귀 선행**. 어긋나면 좌표 전량 재구매

## Phase 3-1·3-2 — 지도 저비용 개선(먼저)

3-1 `filteredRecords` 메모화(1줄) — 무력화된 메모 회수
3-2 마커 effect 에서 `overlapCount` 계산 분리(`:1471-1476`)

## Phase 2 — 완료기록 건별 문서 이전

2-1 기사 화면 완료 토글 → `records/{id}.completion`(자기 건만 · 규칙 이미 허용)
2-2 읽기 3곳 건별 우선 + 부모 `completions` 폴백(옛 공유 호환)
2-3 담당자 수집부(`RouteMapModal.jsx:2687`) 건별 우선
2-4 완료비교 오버레이 **건수 상한**(현재 없음 · 1건당 오버레이 3개)
2-5 이행기(옛 공유 만료 ≤30일) 후 부모 쓰기 제거

## Phase 4 — 초대형 파일 분할(되돌리기 쉬운 순서)

4-1 RouteMapModal 순수 헬퍼·상수 `:44-412` → `src/components/routeMap/mapHelpers.js` (**-369**)
4-2 UtilsModal `filemerge` 탭 (**-430**, 탭 간 공유 상태 0)
4-3 CloudListManager 주소변경 확인 모달 (**-185**)
4-4 AdminPanel `learn` 탭 (**-90**)
4-5 RouteMapModal 리프 모달 6종 (**-300**)
4-6 UtilsModal 나머지 9탭 (**-1,500** → UtilsModal 800줄 달성 가능)
⛔ 헤더 툴바·좌측 패널(deps 74·67)은 **분할 금지** — prop 74개가 되어 퇴행 위험이 이득보다 크다

## Phase 3-3~3-5 — 지도 대공사(마지막)

3-3 `id → overlay` 맵으로 **변경분만 갱신**(색·순번은 DOM 직접 갱신)
3-4 `idle` 리스너 + 뷰포트 컬링(bounds + 여유 30~50%)
3-5 (선택) 저줌=점 / 고줌=상세 하이브리드 — 핀 템플릿 SSOT 1벌 유지

### ⛔ 지도 작업에서 반드시 지킬 불변식 (회귀로 잠근다)
1. `setBounds` 전체맞춤은 **컬링 이전 전건 기준**(아니면 줌이 계속 조여드는 되먹임)
2. 경로선(Polyline)은 전건 기준 — 화면 밖 구간이 잘리지 않을 것
3. 브러시는 **화면 밖 레코드도 배정**한다(`applyPaint` 가 전건을 훑는 성질 보존)
4. 선택 하이라이트는 재생성·컬링 후에도 살아 있을 것
5. ×N 동일좌표 카운트·팝업 목록은 **전건 기준**
6. 핀 시각 규칙(포수 5단계 크기·glow·뱃지·이름/포수/동 라벨·zIndex 우선순위) 유지
7. 핀 템플릿 SSOT 1벌
8. 완료비교 오버레이 건수 상한

### 왜 MarkerClusterer 가 아닌가
`kakao.maps.Marker` 는 이미지 마커만 받는다 → 이름·포수·동 라벨, 순번 배지, 포수별 크기·glow, ×N 뱃지, zIndex 규칙이 전부 사라진다.
저줌에서 순번·색·×N 이 사라지면 이 화면의 본업(혼재 확인·순번 확인)이 불가능해진다. 그래서 **디자인을 지키는 컬링 경로**를 택한다.

## ✅ 진행 현황 (2026-08-23 23:07 KST 기준 · 형 "전부 고")

| Phase | 상태 | 결과 |
|---|---|---|
| 0 안전망 | ✅ | 특성화 회귀 16 · 복제가드 디렉터리 확대(Red-Green 실측) · `docs/MANUAL_CHECKLIST.md` |
| 1 좌표캐시 N+1 | ✅ | 일괄 로드 API + 호출부 3곳 + 모달 사본 제거 · 키 회귀 5 (**206초 → 0.6초** 근거) |
| 2 완료기록 건별 이전 | ✅ | 건별 `completion` 쓰기·읽기(옛 공유 폴백) · 오버레이 상한 500 · 규칙 회귀 58 |
| 3-1·3-2 | ✅ | `filteredRecords` 메모화(무력화 회수) · 혼재 계산 분리 |
| 3-3 변경분만 갱신 | ✅ | 구조 시그니처 기반 · 핀 시각 규칙 순수함수 + 회귀 10 |
| 3-4 뷰포트 컬링 | ✅ | 1,200건↑에서만 · 붙였다 떼기(재생성 0) · 컬링 회귀 5 |
| 3-5 저줌 하이브리드 | ⏸️ **보류 권고** | 핀 템플릿이 두 벌이 된다 = 이 프로젝트가 반복해서 당한 복제 함정. 3-3·3-4 로 성능 목표는 달성 |
| 4-1 루트맵 순수 헬퍼 | ✅ | `routeMap/mapHelpers.js` (−369) |
| 4-2 UtilsModal 합치기 탭 | ✅ | `utils/FileMergeTab.jsx` (3,124 → 2,864) |
| 4-3 주소변경 모달 | ✅ | `cloudList/AddrChangeModal.jsx` (2,500 → 2,331) |
| 4-4 자가학습 탭 | ✅ | `admin/AdminLearnTab.jsx` (2,545 → 2,462) |
| 4-5 루트맵 리프 모달 | ✅ | 동 이동 확인 · 자동 핀 확인 (5,563 → 5,517) |
| 4-6 UtilsModal 나머지 9탭 | ✅ | 10개 컴포넌트로 분리(**2,865 → 1,692줄**) · props 는 eslint 자기교정으로 배선 · 배선 회귀 신설 |

**4-6 에서 배운 것**: prop 을 빠뜨려도 **빌드·eslint 가 통과하고 그 버튼만 조용히 죽는다** — 실제로 FileMergeTab 의 시트 전환 2개가 그랬다.
그래서 `scripts/component-wiring.test.mjs`(배선 회귀)를 만들어 앞으로는 자동으로 잡히게 했다(Red-Green 실측).

**누적 검증**: 루트 회귀 447 → **483** · 규칙 55 → **58** · eslint 0 errors · tsc 0 · vite build 0 (매 커밋 확인)

## 실행 순서

**0 → 1 → 3-1·3-2 → 2 → 4 → 3-3~3-5**  (효과 크고 위험 낮은 것부터, 지도 대공사는 마지막)

## 리스크

| 등급 | 항목 |
|---|---|
| 🔴 | 좌표캐시 키 불일치 시 좌표 전량 재구매 · 컬링 bounds 되먹임 |
| 🟠 | 완료기록 이전 중 현장 기사 사용 · 분할 시 stale closure(억제된 deps 경고 19건) |
| 🟡 | eslint 예산 여유 13 — 파일을 한꺼번에 여러 개 뽑으면 빌드 게이트가 깨짐 |

## 단계별 검증(매 단계 · 커밋 1개)

`node --test scripts/*.test.mjs`(447) · `npm run test:rules`(55) · `npx eslint .`(경고 ≤120) · `npx tsc --noEmit` · `npx vite build` · 수동 체크리스트 8항목

---

## 이전 계획

# 구현 계획 — nexus 배송지도 접근통제 재설계 (2026-08-13 형 확정)

> `/plan` 산출물. **형 확정**: A=Firebase Phone Auth · B=자기 것만 · C=마감일까지만 갱신
> ★**2026-08-23 형 결정 — A(SMS 휴대폰 인증)는 보류, 공유 비밀번호(숫자 6자리)로 대체.** Console 설정·문자 과금·기사 번호가 전혀 필요 없다.
>   구현·규칙 = CLAUDE.md **§14-1 SH-1~SH-6** · Function `openShare` · `route_share_secrets` · 기사 화면 입장 게이트. 아래 Phase 2 절은 원안 기록으로만 남긴다.
> 배경: 2026-09-11 시행 개정 개인정보보호법(72시간 유출통지·대표자 최종책임) 대응 겸함.

## 왜 하는가 — 지금 상태

`route_shares` 는 **인증 없이 읽힌다**(`allow read: if isShareWithinTTL()`).
문서 하나에 **이름·주소·휴대폰·특이사항**이 통째로 담기고, 링크를 아는 사람은 누구나 연다.

- 2026-08-13 실측: 살아있는 링크 1건(동대문 1,524건, **2026-08-18 마감**). 나머지는 전부 마감 처리함.
- TTL 은 45일 → **7일**로 줄였고, `shareId` 는 `crypto.randomUUID()` 로 바꿨다(추측 차단).
- 그래도 **링크를 아는 사람은 여전히 그냥 열 수 있다.** 그걸 이 계획이 닫는다.

## 착수 전에 드러난 전제 결함 2가지 (실측)

1. ~~등록된 기사 명부가 없다~~ → **⛔이 진술은 틀렸다(2026-08-13 안토니 정정).**
   `drivers` 컬렉션 0건만 보고 단정한 것이 잘못이었다. **명부는 다른 이름으로 이미 있다:**

   | 저장소 | 기사 | 전화 보유 | 휴대폰 형식 정상 |
   |---|---|---|---|
   | `org_presets/{city}` | 7명 | **0** | 0 |
   | `user_driver_presets/{uid}/cities/{city}` | 23명 | **7** | **7** |

   `RouteSetupModal.jsx` 의 기사 입력에 **`phone` 필드가 이미 있다**(`{name:'', phone:'', capacity:100}`).
   → Phase 0 은 "새 명부 구축"이 아니라 **"기존 명부를 인증 가능한 상태로 만들기"** 다.
   → ★**진짜 병목은 코드가 아니라 데이터다** — 30명 중 **23명이 번호가 없다.**
      지금 Phase 2 를 켜면 그 23명이 지도에 못 들어간다.
   → `src/utils/phone.js`·`driverRoster.js`(판정 로직)는 저장소와 무관하게 그대로 쓴다.
   ⚠️`firestore.rules` 의 `drivers` 규칙은 **지금 안 쓰이는 컬렉션**을 잠근 것이다.
      실제 저장소(`user_driver_presets`·`org_presets`) 규칙을 따로 확인해야 한다.
   ★교훈: **"없다"는 부재 단정은 이름 하나로 판정하지 말 것.** 같은 것이 다른 이름으로 있다.
2. **동대문 링크가 2026-08-18 까지 살아 있다.** 그 전에 전환을 배포하면 **현장 기사가 못 들어간다.**
   → 배포는 8/18 이후. 그 전에 해야 하면 구·신 병행(이행기간)을 따로 설계한다.

## 형 확정 사항

| | 확정 | 뜻 |
|---|---|---|
| A 인증 수단 | **Firebase Phone Auth(SMS)** | 건당 과금 · Console 활성화 · reCAPTCHA 설정 필요 |
| B 기사가 보는 범위 | **자기 것만** | 문서 구조를 바꾼다(아래 Phase 1) |
| C 갱신 상한 | **담당자가 지정한 마감일까지만** | 접속해도 그 날짜를 넘겨 연장되지 않는다 |

## 데이터 구조 변경 (B 확정에 따른 핵심)

지금은 문서 하나(`route_shares/{shareId}`)에 `records[1524]` 가 통째로 들어 있다.
**배열은 부분 권한을 줄 수 없다** — 읽으면 전부 읽힌다. 그래서 나눈다.

```
route_shares/{shareId}                     ← 메타만: city·monthId·expiresAt·deadline·drivers[]·driverPhones[]
route_shares/{shareId}/records/{recordId}  ← 건별. driverPhone 필드로 소유 기사 표시
```

규칙(핵심):
```
match /route_shares/{shareId} {
  allow read: if isShareWithinTTL()
              && request.auth != null
              && request.auth.token.phone_number in resource.data.driverPhones;
}
match /route_shares/{shareId}/records/{recId} {
  allow read: if isShareWithinTTL()
              && request.auth != null
              && resource.data.driverPhone == request.auth.token.phone_number;
}
```
★기사는 **DB 차원에서** 남의 건을 못 읽는다. 화면에서 거르는 게 아니다 — 화면 필터는 우회된다.

## 단계

### Phase 0 — 기사 명부 (선행 필수)
- `drivers/{driverId}`: `{ name, phone, active, createdBy, createdAt, updatedAt }`
- **휴대폰은 E.164 정규화 저장**(`+8210…`). Phone Auth 의 `token.phone_number` 와 대조할 키라
  표기가 흔들리면 영영 안 맞는다. 정규화 유틸 + 회귀 필수.
- 담당자 관리 화면(추가·수정·비활성). 기존 화면 임시 기사에 `driverId` 연결.
- 규칙: `drivers` 는 인증 + 지자체 권한자만. 기사 본인은 자기 문서만 읽기.

### Phase 1 — 공유 문서 구조 변경 + 규칙 전환
- 생성 시 records 를 **서브컬렉션에 배치 쓰기**(500건/배치 → 1,524건이면 4배치)
- 부모 문서에 `driverPhones[]`(정규화) · `deadline`(담당자 지정 마감) 심기
- `firestore.rules` 위 규칙으로 교체 — **여기서 무인증 접근이 닫힌다**

### Phase 2 — 기사 휴대폰 인증 화면 (`ShareRouteView.jsx`)
- 번호 입력 → SMS 코드 → `signInWithPhoneNumber` → 서브컬렉션 조회
- ⚠️`ShareRouteView` 는 지금 `shareData.records` 배열을 쓴다 → 서브컬렉션 구독으로 재작성
- 이미 있는 완료버튼·GPS·순번 기능은 **동작 보존**(퇴행 금지)

### Phase 3 — 담당자 사용일정 지정 (`RouteMapModal.jsx`)
- 공유 생성 시 마감일 선택(기본 오늘+7일, 상한 30일)
- `deadline` = 담당자가 정한 진짜 상한. `expiresAt` 은 그 안에서 움직인다.

### Phase 4 — 접속 시 갱신 (Cloud Function)
- ⛔**클라가 `expiresAt` 을 직접 쓰게 하지 않는다.** 기사가 자기 만료일을 늘릴 수 있으면 그게 구멍이다.
- Function `touchShare(shareId)`: 인증 확인 → `expiresAt = min(now + 7일, deadline)` 으로만 갱신
- 규칙에서 `expiresAt` 클라 쓰기는 **금지**(Function 은 Admin SDK 라 규칙 우회)

### Phase 5 — 열람 기록 + 실시간 감시
- `share_access_logs`: 누가(전화)·언제·어느 공유·몇 건
- 규칙: create 만 허용, update·delete 금지(**append-only** — yyplus `auditLogs` 방식)
- 대량 열람·비정상 시간대 → 텔레그램 알림(팩토리에 넣은 규칙과 동일 계열)

## ★현장 폴백 (이게 없으면 배송이 선다)

**기사가 현장에서 SMS 를 못 받으면 배송이 멈춘다.** 지하주차장·통신 음영·요금 미납·폰 교체 —
전부 실제로 일어난다. **보안을 조이다 배송을 세우면 그게 더 큰 사고다.**

→ 담당자가 관리 화면에서 **임시 접근 승인**(해당 기사 1회·유효 몇 시간·**기록 남김**).
   사람이 판단하고 흔적이 남는 방식. Phase 2 와 함께 만든다(나중으로 미루지 않는다).

## 리스크

| 리스크 | 대응 |
|---|---|
| 전환 배포로 현장 기사 접근 불가 | **8/18 이후 배포**. 그 전이면 구·신 병행 |
| Phone Auth 미설정(Console·reCAPTCHA) | Phase 2 착수 전 형이 Console 에서 활성화 |
| SMS 미수신 → 배송 중단 | 위 현장 폴백(필수) |
| 폰 교체·번호 변경 | 담당자가 명부에서 수정 |
| 서브컬렉션 전환 중 기존 화면 퇴행 | 완료버튼·GPS·순번 회귀 테스트 먼저 |
| SMS 비용 | 기사 수 × 접속 횟수. 갱신이 잦으면 비용↑ → 세션 유지 기간 조정 |

## 복잡도: HIGH
Phase 0~2 가 필수 묶음(이것만으로 인증 성립) · 3~5 는 그 위에 얹는다.

## 진행 순서
`Phase 0` → `Phase 1` → `Phase 2`(+폴백) → `Phase 3` → `Phase 4` → `Phase 5`
각 Phase 는 `/tdd`(RED→GREEN→회귀 잠금)로. 운영 배포는 형 확인 후.

---
---

## 이전 계획 (아카이브)

# 세션 핸드오프 — nexus 주소 서비스 (2026-08-01 P7 Phase2 **ⓐ+ⓒ+ⓓ 완료 · 서버 정제 가동**)

> 새 세션에서 **"이어서"** 하면 이 문서부터 읽는다.
> 관련 메모리: `project_nexus_address_format_rules`(★match 인시던트·진단 인프라·서버이관 로드맵) · `project_nexus_self_learning`

---

## ✅ 이번 세션 완료 ②(2026-08-01, 커밋 `116fcd7`) — 서버 정제 `/v1/address/purify`

**서버가 클라와 같은 코어로 정제한다. "같은가?"를 눈이 아니라 테스트가 답한다 — 파리티 35/35.**

| 작업 | 결과 |
|---|---|
| ⓐ `src/dictStore.js` | firebase-admin **ADC**(키파일 불요) 학습사전 5종 로더. **지연 import**·TTL 5분·in-flight 합류. 컬렉션·필드·폴백은 클라 `loadTypoDict`와 동일 |
| ⓒ-2 `src/purify.js` + 라우트 | `POST /v1/address/purify`(배치) · `GET /v1/address/dict-status`. lookupAddr=`matchAddress` **in-process**(자기 HTTP 금지)+A-30 게이트+1000건 캐시. 동시성 3·최대 500건 |
| ⓓ `scripts/server-parity.test.mjs` | 서버 출력 == 클라 `golden-offline.json` **35/35 deepEqual** |
| SSOT 2종 신설 | `shared/dictRegex.js`(A-2·A-9 정규식 조립) · `shared/kakaoQueries.js`(검색어·A-30/A-31 법정동 채택). 클라도 같은 파일 사용 |

### ★파리티·스모크가 잡은 실제 결함 2건 (되돌리지 말 것)
1. **특수문자 사전이 비면 상세주소가 통째로 사라진다** — `buildSpecialCharRegex([])`가 `()(.*)`를 만들어 모든 문자열 0번 위치에서 매칭. A-9 2차(상세)에는 위치 가드가 없어 `201호`가 특이사항으로 넘어가고 상세가 빈다(35케이스 중 **28건**에서 검출). → 빈 목록이면 **null 반환** + dictStore는 기본값 폴백. 잠금=`scripts/dict-regex.test.mjs`.
2. **ADC 미설정 시 API 프로세스가 죽는다** — google-gax가 gRPC stub 생성 중 **try/catch 밖에서** unhandledRejection을 던짐(실측: 프로세스 종료). → Firestore 클라이언트 만들기 **전에** `credential.getAccessToken()`으로 선검사(잡히는 실패로 전환) + `server.js` 2차 방어선(기록 후 서비스 계속).

- **검증(증거)**: 파리티 35/35 · 전체 유닛 **174/174** · 골든 3/3 · eslint 0 error · vite build EXIT=0 · **HTTP 실측**(ADC·DB 둘 다 없는 상태) 200/400/413 정상 + A-9·A-10 적용 확인 + 사전 로드 실패에도 **서버 생존**.
- firebase-admin이 새로 추가한 취약점 **0건**(기존 audit 6건은 전부 `@google-cloud/storage` 경로).

### ✅ 배포 완료 (2026-08-01) — 리비전 **`00054-t5m`** 100% 트래픽
- IAM 추가 부여 **불필요**: 런타임 SA(`31783407891-compute@`)에 이미 `roles/editor` → Firestore 읽기 포함. `dict-status`에서 **typo 23건** 로드 확인.
- 배포 URL: `https://nexus-address-api-31783407891.asia-northeast3.run.app` (= 클라 `VITE_ADDRESS_MATCH_API_URL`).
- `/healthz`가 GFE 404인 것은 **구 리비전(canary=00021)도 동일** — 이번 배포와 무관한 기존 동작.

### 🔴 배포 후 실측으로 잡은 결함 3건 (전부 수정·재배포)
| # | 증상 | 원인 | 수정 |
|---|---|---|---|
| 1 | 배포 직후 `왕산로 72`가 법정동·건물명 **없이** 정제. 웜(0.09초)에도 반복 | 커넥션 콜드스타트 실패를 **null로 캐시** → 인스턴스가 살아있는 한 영구 미매칭(브라우저와 달리 새로고침이 없다) | "결과 없음"만 캐시, **"조회 실패"는 미캐시** (`2b65561`) |
| 2 | 배치 중 운영 `/v1/address/match`가 10초 뒤 **500** | purify가 match와 커넥션 풀·DB를 공유 | 인스턴스당 **배치 직렬화** + 동시성↓ (`6ebd897`) |
| 3 | 그래도 없는 주소 60건에서 **504(300초 초과)** + match 9건 실패 | 병목은 커넥션이 아니라 **Cloud SQL CPU(1 vCPU)** | 기본값을 실측 안전선 **동시성 1 · 1회 50건**으로 고정 (`4e80a86`) |

### 📊 용량 실측 (운영 리비전 · match 병행 호출)
| 배치 | 소요 | 운영 match |
|---|---|---|
| **실존** 주소 48건 | **0.6초** | 6/6 정상(중앙 0.58초) |
| **실존** 주소 30건 | 6.3초 | 10/10 정상(중앙 0.47초) |
| **없는** 주소 30건 | 133초 | 3/53 실패(500) |
| **없는** 주소 60건(동시성3) | 300초 초과 504 | 9/56 실패 |

→ **정상 명단은 건당 0.01~0.2초로 무해**하다. 없는 주소가 많은 명단이 위험하다.

### ✅ 해결됨 — `statement_timeout` 도입 (2026-08-01 · 커밋 `48b7577`/main `27e9462` · 리비전 `00054-t5m`)
기존 문제였다(purify가 만든 게 아님): `buildingMatch` 트리그램이 **60~76초** 실행되며 커넥션 점유.
**클라는 3초에 abort하는데 서버 쿼리는 끝까지 돈다** → 아무도 안 기다리는 시간에 다른 요청이 500.
- **선행 확인 통과**: `server.js`는 `query`만, `import-job`은 `withClient`만 쓴다 → `query()`에만 상한을 걸면
  **대량 적재·CREATE INDEX·ANALYZE는 무영향**. `scripts/db-guard.test.mjs`가 이 분리를 소스 수준으로 잠근다.
- 상한 **15초**(env `ADDRESS_STATEMENT_TIMEOUT_MS`). 근거: 정상 0.01~1초, 부하 중 관측 최대 11.4초.
- 폴백(fuzzy·building)은 상한 초과(57014)를 **미매칭**으로 처리 — 안 그러면 폴백 실패가 500으로 둔갑한다.
  exact 매칭은 감싸지 않는다(7~14ms짜리가 걸리면 진짜 이상 신호).

**운영 로그 증거**: `buildingMatch 쿼리 상한 초과 — 미매칭 처리` 다수 · slow-query 최대치 **65,999ms → 15,179ms**.

**동일 조건 전후 비교**(없는 주소 30건 배치 + match 1초 간격 병행 · 형 배치가 도는 중에 측정)

| 지표 | 수정 전 | 수정 후 |
|---|---|---|
| purify 소요 | 133초 | **26.3초** |
| 운영 match | **3/53 실패(500)** | **27/27 성공 · 0 실패** |
| match 중앙 응답 | 3~10초로 열화 | **0.23초**(최대 0.75초) |

→ 남은 선택지(필요 시): Cloud SQL 증설(현재 `db-custom-1-3840` = 1 vCPU).

---

## ✅ 이번 세션 완료 (2026-08-01, 커밋 `ccae3b8`) — purifyCore 코어 추출

**정제 본체가 클라를 떠났다. 이제 코어는 `services/address-service/src/shared/purifyCore.js` 하나다(B1).**

| 작업 | 결과 | 커밋 |
|---|---|---|
| ⓒ-1 본체: processAddress(780줄)+parseOfficialRoadAddressText → `shared/purifyCore.js` | `createProcessAddress(deps)` 팩토리. 로직 무변경(스크립트로 원문 이동 후 deps 참조만 치환) | `ccae3b8` |
| 클라 addressEngine.js = 어댑터로 축소 | **1334줄 → 501줄**. IO·부수효과·학습사전 주입만 담당 | 〃 |
| 잠금장치 3종 | road-regex-parity에 '어댑터가 코어에 위임' 추가 · text-normalize 잠금 코어 기준 갱신 · 신규 `scripts/purify-core-deps.test.mjs` 4건 | 〃 |

- **deps 계약(서버가 그대로 쓰면 됨)**:
  - `deps.io` = lookupAddr · searchKakaoFull · fetchKakaoLegalDong · fetchKakaoCoord · fetchDongCoord · **parseAptDong**
  - `deps.side` = addSpecialChar (서버 no-op)
  - `deps.dicts` = ready · typoDict · typoRegex · nameTypoDict · specialCharRegex · buildingAliasDict(+VariantIndex) · noteNormalizeDict(+VariantIndex)
- **★★함정(가장 중요)**: `deps.dicts`는 반드시 **getter 객체**로 주입한다. 값으로 주입하면 사전 로드 이전의 **빈 사전이 영구 고정**되고, 화면은 정상처럼 보이는데 학습 오타·별칭이 조용히 죽는다. `purify-core-deps.test.mjs` ③이 이걸 잡는다(값 주입으로 바꾸면 실패하는 것 RED 실측 확인).
- **검증(증거)**: 골든 **3/3**(offline·replay·시크릿) · 전체 유닛 **164/164 pass 0 fail** · eslint **0 error** · `npx vite build` **EXIT=0** · 서버측 `node import` OK(코어가 firebase·Kakao·import.meta.env 무참조). **클라 출력 100% 불변(골든 증명)**.
- eslint: services 블록에 `no-useless-assignment: warn` 추가 — src/ 블록에선 warn이던 규칙이 이관 후 error가 돼 **검증된 로직을 규칙 때문에 손대야 하는 상황**을 막음(정책 일치, 로직 무변경).

### 📚 직전 아카이브 — ⓒ-1 선행 (커밋 `bbb2b1b`, push 완료)

**Phase2 본체(서버 `/v1/address/purify`) 착수 → 안전 분할 1단계(순수 헬퍼 shared 이관) 완료.**

| 작업 | 결과 | 커밋 |
|---|---|---|
| ⓒ-1 선행: 순수 헬퍼 → `shared/purifyHelpers.js` | 지역매칭·공통상수·Kakao순수변환·generateCenterKeyword·appendCheckReason·normalizePlaceKey·구분자. addressEngine은 import 대체(**로직 무변경**) | `bbb2b1b` |

- **검증(증거)**: 골든 3/3 · 전체 유닛 159/159 pass 0 fail · eslint 0err · `npx vite build` 그린 · **서버측 `node import` 성공**(exports 23종·firebase/env 무의존 증명). 클라 출력 100% 불변(골든).
- **B1(공용 코어) 확정**(형 승인): purifyCore 하나를 클라·서버 공용. 복제→분기 안티패턴 배격.
- **★parseOfficialRoadAddressText 이번 제외**: 유니코드 이스케이프(`지하`=지하·`호`=호) 리터럴이 Edit 문자열매칭을 막음 → 다음 코어 추출 때 본체와 함께 이동.

### 📚 직전 아카이브 — ⓑ 순수 이관 (커밋 `50499d6`·`8cb68bb`, push 완료)

**Phase 2 목표**: 클라 순수 규격화 로직을 `services/address-service/src/shared/`로 이관(SSOT) → 다음 세션 `/v1/address/purify`가 서버에서 클라와 동일 규격화 수행 + 대량 백필 서버화.

**형 확정 범위 = ⓑ+ⓓ(순수 이관 + 골든 게이트)**. ⓐ(firebase-admin 사전로더)·ⓒ(purify 엔드포인트)는 다음 세션.

| 작업 | 결과 | 커밋 |
|---|---|---|
| ⓑ-1 순수 파일 4종 → shared + 재수출 스텁 | dongHoFormat·addressFormat·normalizeVariant·applyNoteNormalize. 참조 17곳 무변경 | `50499d6` |
| ⓑ-2 상세·도로명 정규화 순수 유닛 → shared/detailNormalize.js | A-17·18·19·23잔여 8 export + 내부상수. addressEngine import 정리 | `8cb68bb` |

- **검증(증거)**: 골든 3/3(offline·replay·시크릿) · **전체 유닛 159/159 pass 0 fail** · eslint 0 error · vite build 그린. **클라 출력 100% 불변(골든 증명), 회귀 0.**
- **이관 방식**: `git mv`(히스토리 보존) + 원위치 재수출 스텁(`export * from '.../shared/...'`) → 기존 클라 참조 경로 무변경, 서버는 shared 직접 import 가능. roadTokens/textNormalize 선례와 동일 원리.
- **현재 shared 모듈 6종**: roadTokens · textNormalize · dongHoFormat · addressFormat · normalizeVariant · applyNoteNormalize · **detailNormalize**(신규).

---

## ▶ 새 세션에서 할 일

### 1️⃣ 형 PC 배치 `batch_nexus_building.py` 정리 — **다음 1순위**(형 판단 필요)
`watchdog.log`가 10:52·11:03·11:14·11:25·11:36 "로그 정체 62x초 — 강제종료 후 재시작"을 반복하고,
진행 로그는 매번 `읍면동 3340개, 고유주소 조회 시작`에서 멈춘다 = **진척 0인데 API만 계속 두드린다.**
- statement_timeout 도입으로 이 배치가 API를 망가뜨리진 못하게 됐지만(match 0.23초 유지),
  **배치 자체는 여전히 아무 일도 못 하고 있다.** 원인 규명 or 정지 필요.
- 정지 시 **watchdog을 먼저** 죽여야 배치가 되살아나지 않는다.

### 2️⃣ purify 배치 상한 재조정 (선택)
statement_timeout으로 폭주가 끊기므로 `ADDRESS_PURIFY_MAX_RECORDS`(현재 50)를 올릴 여지가 생겼다.
올리기 전 위 "동일 조건 전후 비교" 방식으로 **match 병행 측정**을 다시 할 것.

### 3️⃣ 클라를 서버 정제로 전환 (Phase3 — 미착수·형 승인 필요)
지금은 **서버 정제가 준비만 된 상태**다. 클라는 여전히 브라우저에서 정제한다.
- 전환 시 이득: 대량 백필 서버화 · **브라우저 Kakao 키 제거**(현재 `VITE_KAKAO_REST_KEY` 번들 노출) · 클라 슬림화.
- 전환 시 주의: 좌표는 여전히 클라(purify는 includeCoords 미지원) → 서버 정제 후 클라가 좌표만 붙이는 2단 구성이 필요.
- **전환 전 반드시**: 배포된 서버로 파리티를 한 번 더(실DB·실Kakao 조건). 지금 파리티는 offline 조건이다.

### 4️⃣ 형 실동작 확인 (지난 세션부터 대기)
`logis-op.web.app` → Ctrl+Shift+R → 명단 정제 → ①층 위치 ②대시 동호 ③건물명 맨뒤 ④괄호 잡값 없음 + 자가학습 '학습 검토' 탭. **이번 이관은 클라 출력 불변이라 결과 동일해야 함**.

### 5️⃣ 남은 표기 갈림 276건 (자동 처리 불가) — 유지
동률·근소차 28그룹·괄호 층정보·도로명 부번차. 형 현장 지식 필요.

---

## 🔑 이어가기 전 필수 지식 (함정)

| 상황 | 반드시 |
|---|---|
| **소스 `\uXXXX` 이스케이프** | purifyCore 등은 한글이 `지하`처럼 `지하` 이스케이프로 저장 → Edit old_string 안 맞음. PowerShell 라인삭제 or JSON `\\u`로 이스케이프해 매칭 |
| **★deps.dicts 주입** | 반드시 **getter 객체**. 값으로 주입하면 로드 전 빈 사전이 영구 고정 → 학습 오타·별칭이 조용히 죽는다(화면은 정상). `scripts/purify-core-deps.test.mjs` ③이 잡는다 |
| **대량 코드 이동** | 손으로 옮겨 적지 말 것. 스크립트로 원문 추출 → 참조만 치환 → 골든 게이트. 이번 780줄 이관을 이 방식으로 회귀 0 달성 |
| **이관 후 eslint 블록 변경** | `src/`와 `services/`는 eslint 규칙 세트가 다르다. 코드를 옮기면 warn이 error로 바뀔 수 있음(이번 `no-useless-assignment`) → **로직을 고치지 말고 정책을 맞출 것** |
| **안전 분할 순서** | 순수 잎(헬퍼)부터 shared → 마지막에 코어 본체 deps 주입. 각 단계 골든 게이트 |
| **★빈 사전 = 상세주소 소멸** | `buildSpecialCharRegex([])`는 반드시 null. `()(.*)`는 모든 문자열을 0번에서 매칭해 A-9 2차가 상세를 통째로 삼킨다(28/35 실측) |
| **firebase-admin ADC** | Firestore 클라이언트 만들기 **전에** `credential.getAccessToken()`로 선검사. 안 그러면 google-gax가 try/catch 밖에서 터져 **프로세스가 죽는다** |
| **서버 스모크** | DB·ADC 없이도 돌려볼 것 — `PORT=8791 DATABASE_URL=postgres://u:p@127.0.0.1:1/none node src/server.js` 후 python urllib로 POST. 이 조건이 장애 시나리오 그 자체다 |
| **★서버 캐시에 실패 금지** | 서버 인스턴스는 오래 산다 — 일시 실패를 null로 캐시하면 **영구 오염**. "없음"만 캐시할 것 |
| **★배치는 운영과 DB를 나눠 쓴다** | purify·백필은 반드시 직렬화+저동시성. 병목은 커넥션이 아니라 **Cloud SQL 1 vCPU**. 없는 주소 30건이 match를 500으로 만든다(실측) |
| **배포 후 부하 실측 필수** | "테스트 통과 = 운영 안전"이 아니다. 배치를 돌리며 **동시에 운영 엔드포인트를 호출**해 무중단인지 볼 것(`load_guard` 패턴) |
| `gcloud` 실행 | 매 호출 `--account=ttong627@gmail.com`. 프로젝트=**logis-op** |
| `git push` | `gh auth switch --user ttong627` 먼저 |
| 클라 빌드 검증 | **`npx vite build` 직접**(그린). `npm run build`는 prebuild `tsc --noEmit` 게이트에 **기존 tsc 에러 13건**(무관)으로 막힘 — 회귀 아님 |
| **서버 배포** | `cd services/address-service && gcloud run deploy nexus-address-api --source=. --region=asia-northeast3 --project=logis-op --account=ttong627@gmail.com` |
| **shared 모듈 위치** | 반드시 `services/address-service/src/shared/`. Docker `COPY src ./src`에 포함 + 클라 상대 import(`../../services/...`). 루트 `src/`에 두면 서버 이미지 누락 |
| 순수 파일 이관 패턴 | `git mv` + 원위치 재수출 스텁(`export * from`). 기존 참조 무변경 |
| **한글 POST 테스트** | ★curl -d 금지(본문 깨짐). python urllib(UTF-8) |
| 주소DB 직접 진단 | Secret `ADDRESS_DATABASE_URL`(소켓형)→공인IP `34.158.197.192`(requireSsl=False)에 내IP authorized-networks 임시추가→node pg EXPLAIN→끝나면 `--clear-authorized-networks` 원복 |
| 골든 갱신/검증 | `node scripts/golden/record.mjs [--mode record]` / `node --test scripts/address-golden.test.mjs`. 전체 유닛=`node --test scripts/*.test.mjs` |

### 현재 기준선
골든 3/3 · **서버 파리티 35/35** · 전체 유닛 **181/181** · **shared 모듈 11종**(roadTokens·textNormalize·dongHoFormat·addressFormat·normalizeVariant·applyNoteNormalize·detailNormalize·purifyHelpers·purifyCore·**dictRegex**·**kakaoQueries**) · 클라 addressEngine.js **501줄**(어댑터) · match 실존주소 200·0.1~0.4s(리비전 00054-t5m · statement_timeout 15초) · 인덱스 `building_core_roadbld_trgm` 운영 반영.
검증 명령: `node --test scripts/*.test.mjs`(파리티 포함) · `node --test scripts/address-golden.test.mjs` · `npx eslint .` · `npx vite build`.

---

## 📌 재착수 금지 (형 확정)
- **column_map 자동화** — 서버 3중 매핑 존재. 충돌>실익.
- **정본 문자열 그대로 저장** — 정본 100% 보유, 갈림 1%<.
- **road_key btree 인덱스** — equality 이미 7~14ms로 빠름. 불필요.
- 기존 저장 명단 소급 미적용 — 새 정제 명단만 새 규칙(형 지시 시 백필 별도).

---

## 📚 이전 세션 핸드오프 (아카이브)

### 2026-07-31 마감 (커밋 `5b3a957`~`5b612de`)
- 골든 회귀 안전망(vite SSR 로더+fetch 카세트) offline+api 2단.
- 순수 규격화 프리앰블 A-3·4·6·15·16·21 → shared SSOT(`78d272e`).
- **buildingMatch 28s seq scan 수정** — 함수 GIN 인덱스 `building_core_roadbld_trgm`+불변식(`083261e`). 서버 리비전 `00049-p76`.
- match "장애" 3원인: ①buildingMatch 무인덱스 seq scan ②Cloud SQL 재시작 후 통계 낡음(ANALYZE) ③Windows Git Bash curl -d 한글 본문 깨짐(테스트 아티팩트).
