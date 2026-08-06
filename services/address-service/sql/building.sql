-- 건축물대장 부가정보 — **버전 독립** 테이블 (설계서 P7 · C1 대응).
--
-- ★왜 building_core 에 컬럼을 붙이지 않는가 (C1, Gemini 발견·코드검증)
--   `import-job.js resetVersionData` 는 월 재적재 때
--   `DELETE FROM building_core WHERE version_id = $1` 을 돈다. PK 가 (version_id, building_mgt_no) 라
--   **다음 달 = 새 행 = 확장 컬럼 전부 NULL**. 건축물대장은 일 한도가 있어 몇 달에 걸쳐 모으는
--   데이터인데, 거기 넣으면 매달 증발해 영원히 완성되지 않는다.
--   → PK 에서 version_id 를 빼고 `building_mgt_no` 단독으로 둔다. 국가 테이블과는 조인으로 결합한다.
--   ⚠️ resetVersionData 목록에 이 테이블을 절대 넣지 말 것.
--
-- ★왜 지번이 아니라 건물 단위인가
--   형 PC 배치(govt_delivery_analysis/batch/batch_building.py)는 지번당 1행으로
--   `{floor: max(층수), elev: max(승강기)}` 를 저장한다. 읍면동 평균을 내는 배송난이도 분석엔
--   충분하지만, 한 지번에 건축물대장이 22건인 사례(전남 나주 빛가람동 118)에서 보듯
--   **22채를 max 하나로 누르면 어느 동에 엘베가 있는지 알 수 없다**.
--   기사에게 "이 건물 엘베 없음 3층"이라고 말하려면 건물 1채가 1행이어야 한다.
--
-- ★월 갱신 무결성
--   국가 테이블이 새 버전으로 교체돼도 이 테이블은 building_mgt_no 로 조인이 유지된다.
--   단 building_mgt_no 가 소멸·변경된 건물은 고아가 되므로 orphan 탐지 대상이다(설계서 C6).

CREATE SCHEMA IF NOT EXISTS nexus_address;
SET search_path TO nexus_address, public;

CREATE TABLE IF NOT EXISTS building_ext (
  -- 행안부 건물관리번호(25자). 국가 building_core 와의 유일한 접점.
  building_mgt_no text PRIMARY KEY,

  -- 건물관리번호를 분해해 얻은 건축물대장 조회 좌표(재조회·검증용으로 보존)
  sigungu_cd text,
  bjdong_cd text,
  bun text,
  ji text,

  -- ── 배송에 직접 쓰이는 값 ──────────────────────────────
  -- 계단노동의 근거. elevator_count = 0 이면 "엘베 없음"이고, 그때 ground_floors 가 곧 노동량이다.
  ground_floors integer,
  basement_floors integer,
  elevator_count integer,        -- 승용승강기(rideUseElvtCnt)
  emergency_elevator_count integer,
  household_count integer,       -- 세대수(hhldCnt)
  family_count integer,          -- 가구수(fmlyCnt)
  main_purpose text,             -- 주용도(mainPurpsCdNm) — 공동주택/단독주택/근린생활시설 …
  etc_purpose text,
  structure text,                -- 구조(strctCdNm)
  building_name text,            -- 건물명(bldNm)
  dong_name text,                -- 동명(dongNm) — 한 지번 여러 동일 때 이 값이 구분자
  approval_date text,            -- 사용승인일(useAprDay) — 노후도 추정

  -- ── 출처 추적 (설계서 §데이터모델: sourced_at·source 기록) ──
  mgm_bldrgst_pk text,           -- 건축물대장 원본 PK — 국토부 쪽 재조회 키
  source text NOT NULL DEFAULT 'bldrgst-api',
  sourced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 지번으로 되짚기(한 지번의 모든 동을 한 번에)
CREATE INDEX IF NOT EXISTS building_ext_jibun
  ON building_ext (sigungu_cd, bjdong_cd, bun, ji);
-- 엘베 없는 고층 = 계단노동 최상위. 배송난이도·기사 배정의 핵심 조회.
CREATE INDEX IF NOT EXISTS building_ext_noelev_high
  ON building_ext (ground_floors DESC) WHERE elevator_count = 0;
-- 노후 갱신 대상 선별(오래된 것부터 재수집)
CREATE INDEX IF NOT EXISTS building_ext_sourced
  ON building_ext (sourced_at);

-- 조회했지만 결과가 없거나 실패한 건 — **재시도 폭주 방지의 핵심**.
--
-- ★왜 실패도 저장하는가 (설계서 P7: "재시도 폭주·miss storm 방지")
--   기록하지 않으면 매 실행마다 같은 건물을 다시 조회한다. 일 한도가 있는 API 에서
--   이건 곧 "영원히 진도가 안 나감"을 뜻한다. 단 **실패 사유를 구분해서** 저장한다 —
--   '건물 없음'(재시도 무의미)과 '한도초과·네트워크'(재시도 필요)는 완전히 다르다.
--   어제 출입구 작업에서 배운 것과 같은 원리다: 실패를 성공처럼 캐시하면 영구 오답이 된다.
CREATE TABLE IF NOT EXISTS building_ext_miss (
  building_mgt_no text PRIMARY KEY,
  reason text NOT NULL,          -- not_found | decode_failed | quota | error
  detail text,
  attempts integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_tried_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS building_ext_miss_reason
  ON building_ext_miss (reason, last_tried_at);

-- 수집 실행 로그 — 일 한도를 얼마나 썼고 몇 건이 들어갔는지.
-- "왜 오늘은 3만 건밖에 안 들어갔지?"에 답할 수 있는 유일한 근거.
CREATE TABLE IF NOT EXISTS building_ext_runs (
  run_id text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  mode text,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);
