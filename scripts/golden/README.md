# 주소 엔진 골든 회귀 (P7 Phase2 안전망)

규격화 로직을 서버로 이관할 때 **클라이언트의 현재 출력이 그대로 유지되는지**를 기계적으로 증명한다.
지금까지는 "테스트는 통과했는데 실제 정제 결과가 같은지"를 형이 화면에서 눈으로 볼 수밖에 없었다 —
이 골든이 그 격차를 메운다.

## 왜 vite-node가 아니라 vite SSR 인가
클라 엔진(`src/engine/addressEngine.js`)은 `import.meta.env`(Vite 전용)를 쓴다. 그래서 `node`로 바로 못 돈다.
핸드오프엔 "엔진 리팩터 or 브라우저 덤프 중 택일"로 적혀 있었으나, **이미 devDependency인 `vite`의
`ssrLoadModule`** 로 같은 일을 할 수 있다 → 새 의존성 0개·프로덕션 코드 변경 0. 로더는 `engineLoader.mjs`.

## 2단 골든
| 파일 | 모드 | 외부 호출 | 성격 |
|---|---|---|---|
| `golden-offline.json` | offline | 없음 | **상시 게이트.** A-1~A-29 규격화 규칙. 어디서 돌려도 결정적 |
| `golden-api.json` + `cassette.json` | replay | 녹화 재생 | 법정동·건물명까지 포함한 전체 파이프라인. 있으면 검증, 없으면 skip |

이관 대상은 **클라의 순수 규격화 로직**이고 그건 offline이 전부 커버한다. API 응답 기반 보강
(법정동·건물명)은 이미 서버(`address-service`)가 담당해 이관 범위 밖이라, api 골든은 보너스 통합 검증이다.

## 명령
```bash
node --test scripts/address-golden.test.mjs          # 검증 (offline 필수 + replay 있으면)
node scripts/golden/record.mjs                       # offline 골든 갱신(외부 호출 0)
node scripts/golden/record.mjs --mode record         # 실제 API 녹화 → cassette + golden-api
```

## api 골든을 뜰 때 (서버 정상일 때만)
`--mode record`는 운영 주소 API를 **순차·읽기전용**으로 호출한다(데이터 미변경).
- ⚠️ **`/v1/address/match`가 15초+ timeout인데 `/v1/address/db-status`는 정상**이면 **커넥션 풀 경합**이다
  (형 PC 배치 `batch_nexus_building.py`가 점유). 배치 종료 후 녹화할 것. 이 상태로 녹화하면 건물명 보강이
  붙었다 떨어졌다 하는 불안정 골든이 굳는다 — 실제로 그래서 초기 녹화본을 폐기했다.
- 녹화는 엔진 abort(3초)를 떼고 25초 상한으로 실제 응답을 기다린다(서버 속도가 아니라 응답 내용을 잡기 위함).
- 녹화 결과가 바뀌면 = 엔진 동작이 바뀐 것. 의도한 변경인지 확인하고 커밋한다.

## PII·시크릿
- `cases.json`의 이름은 전부 **합성**, 주소는 규칙 재현용 표본만. 실제 수령자·실제 배송지 금지.
- 카세트는 인증 헤더를 저장하지 않고, 쿼리 키는 마스킹, 배포 URL은 `{ADDRESS_API}` 토큰으로 치환한다.
- 테스트가 `.env` 값 유출을 매번 검사한다(`골든 산출물에 시크릿·배포 URL이 없다`).
