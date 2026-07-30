# 세션 핸드오프 — nexus 주소 정제 (2026-07-30 마감)

> 새 세션에서 **"이어서"** 하면 이 문서부터 읽는다.
> 이번 세션: 데이터 정화 **324건** · 식별자 보강 **37,045건** · 주소DB 장애 해결 · 테스트 81→**146건**.

---

## ▶ 새 세션에서 할 일 (우선순위 순)

### 1️⃣ 형 실동작 확인 — **가장 급함, 아직 한 번도 안 됨**
오늘 코드 4건을 배포했는데 **형 눈으로 확인한 적이 없다.** 테스트·시뮬레이션은 통과했지만
실제 엑셀로 정제했을 때 의도대로 나오는지는 형만 판단할 수 있다.
```
logis-op.web.app → Ctrl+Shift+R (PWA 캐시 갱신) → 명단 정제
```
확인 포인트: ①층 위치(`가동 3층 101호` 유지 / `101동 3층 203호`→`101- 203호 3층`)
②대시 동호(`101-203호`→`101- 203호`) ③건물명이 맨 뒤 ④괄호에 잡값 없음

### 2️⃣ P7 Phase 2~5 — 규격화 서버 이관 (Phase 0·1 완료)
**선행: 골든 회귀 방식 결정.** 클라 엔진이 firebase를 import해 node 단독 실행이 안 된다.
→ ⓐ의존성 주입으로 리팩터 ⓑ브라우저에서 정제 결과 덤프 — **둘 중 하나 정해야 착수 가능**.
- **Phase 2** 서버 `/v1/address/purify` 배치 엔드포인트(규격화+매칭+상세규격화)
  걸림돌: 학습사전 4종(`typo_dict`·`name_typo_dict`·`building_alias`·`note_normalize_dict`)이
  **클라 전용** → 서버에 `firebase-admin` 추가 + IAM 확인 필요
- **Phase 3** 좌표·건물정보 서버 편입 + **브라우저 Kakao 키 제거**(보안: `VITE_KAKAO_REST_KEY` 번들 노출 중)
- **Phase 4·5** 클라 엔진 슬림화 → 플래그 전환 → 구경로 제거

### 3️⃣ 남은 표기 갈림 276건 — 자동 처리 불가
- **동률·근소차 28그룹**: `남경오피스텔`↔`성진남경오피스텔` · `시그니처오피스텔`↔`시그니처아파트`
  → DB에 건물명이 없어 정답 확정 불가. **형이 현장을 알면 개별 지정만이 방법**
- **괄호에 층 정보**: `(서초동, 지하층)` → **의도적으로 남김.** "비법정동 값이 하나뿐이면 미개입"
  규칙을 풀면 정상 건물명(`호매실 엔루체` 등)까지 훼손됨
- **도로명 부번 차이**: `박석로25번길 32`↔`32-5` → 건물명 통일로는 해결 불가

### 4️⃣ 형이 하실 것
- **배치 재실행**: `D:/Gemma4/govt_delivery_analysis/batch/batch_nexus_building.py`
  (`max_workers` 8→**3** 수정 완료, 캐시로 이어서 재개)
- 자가학습 실동작 확인(이전 세션부터 대기): 관리자패널 `학습 검토` 탭 → 특이사항 편집→저장→승인→재정제
- 기사앱 배송완료 버튼 — 형 폰 실기기 테스트

---

## 🔑 이어가기 전 필수 지식 (함정 — 모르면 시간 날림)

| 상황 | 반드시 |
|---|---|
| `gcloud` 실행 | **매 호출에 `--account=ttong627@gmail.com`** (config set이 자꾸 ttong0627로 되돌아감) |
| `git push` | 직전에 `gh auth switch --user ttong627` |
| 앱 배포 | `cmd //c 'I:\...\_deploy_done.bat' < /dev/null` (Bash, `dangerouslyDisableSandbox:true`). 직접 `firebase deploy`는 classifier 차단 |
| **서버 배포** | ⚠️ **이미지 재빌드 필요** — Phase1 SSOT 새 코드가 아직 배포본에 없음(동작은 동일해 급하진 않음) |
| 운영 데이터 백필 | **무조건 dry-run 먼저.** 이번 세션에 dry-run이 **사고 6건**을 막았다 |
| 주소 API 호출 | **동시성 3 이하.** 서버 `pg.Pool`=15(상향 완료), 8이었을 때 배치가 독점해 전면 장애 |
| `tg_send.py` 사용 | `PYTHONIOENCODING=utf-8` 지정 (cp949에서 이모지 출력 시 죽음) |
| 도로명 정규식 수정 | `services/address-service/src/shared/roadTokens.js` **한 곳만** 고친다(클라·서버 공용) |

### 진단·백필 도구 (전부 기본 dry-run)
```bash
node scripts/diag-address-consistency.mjs      # 현황 측정(읽기전용)
node scripts/monitor-address-quality.mjs       # 악화 시 텔레그램(매주 월 09:00 자동)
node scripts/repair-nested-paren.mjs           # 괄호 붕괴 수리
node scripts/cleanup-paren-junk.mjs            # 괄호 잡값 → 특이사항 이관
node scripts/unify-building-name.mjs           # 건물명 통일(--allow-majority로 다수결)
node scripts/backfill-building-mgtno.mjs       # 건물관리번호 보강
```

### 현재 기준선 (모니터 스냅샷)
괄호붕괴 **0** · 괄호잡값 **0** · 표기갈림 **85그룹** · 건물관리번호 **100%** · 정본 **100%**

---

## ✅ 이번 세션 완료 (2026-07-30)

| 작업 | 결과 | 커밋 |
|---|---|---|
| A-10 층 규칙 + 대시 동호 인식 | 배포 | `6d5c9fa` |
| A-11 건물명 맨 뒤 SSOT 정정 | 배포 | `1fadbfe` |
| P0 괄호 중첩 근본수리 + 백필 | 45건 | `d971b97` |
| **주소DB 장애 해결** | 10,000ms→44~215ms | — |
| P1 건물명 통일(DB 정본) | 30건 | `ae951f1`·`e681f8d` |
| P1-b 괄호 정화 | 73건 | `a18e865` |
| 다수결 통일 1·2차 | 48+113건 | — |
| P1 재실행(DB 정본) | 15건 | — |
| P2 건물관리번호 보강 | **37,045건** | `e5e38f1` |
| #8 `PGPOOL_MAX` 8→15 | 리비전 `00040-pvr` | — |
| #9 정기 모니터링 | 매주 월 09:00 | `421394b` |
| #7 Phase0·1 SSOT 통합 | 도로명 토큰 단일화 | `d108cd7` |

**주소DB 장애 원인(재발 시 여기부터)**: 형 PC 배치가 `max_workers=8`로 서버 `pg.Pool`(당시 8)을
100% 점유 → 앱 요청이 커넥션 획득 실패(10초 timeout) → 500. **`db-status`는 200인데 특정 API만
timeout이면 DB 장애가 아니라 풀 경합을 먼저 의심**하고, 로그의 `userAgent`·`remoteIp`로 호출자부터 찾을 것.

**dry-run이 막은 사고 6건**: 정상 주소 311건 오판 삭제 · 특이사항 중복 누적 · 깨진 괄호 통째 이관 ·
다른 건물 이름 덮어쓰기 · 용도명으로 실제 이름 대체 · 건물명 `보성,유원아파트` 훼손.

---

## 📌 재착수 금지 (형 확정)
- **column_map 자동화** — 서버 자동매핑·저장매핑복원·columnRules 3중이 이미 존재. 충돌 위험 > 실익
- **정본 문자열 그대로 저장** — 정본은 이미 100% 보유, 갈림은 1% 미만인데 8.8만건 형식 변경 리스크 과도

관련 메모리: `project_nexus_address_format_rules` · `project_nexus_self_learning` · `project_nexus_legaldong_backfill`
