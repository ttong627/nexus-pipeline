-- 행안부 출입구(주출입구) 좌표 — **버전 독립** 테이블.
--
-- ★왜 version_id 가 없는가 (C1 교훈, 2026-08-01)
--   기존 적재기(import-job.js)의 resetVersionData 는 월 재적재 때
--   `DELETE FROM building_core WHERE version_id = $1` 을 돈다. PK 가 (version_id, ...) 라서
--   그 테이블에 뭘 덧붙이든 **매달 통째로 증발**한다. 건축물대장(일 1만 한도)처럼 몇 달에 걸쳐
--   모으는 데이터를 거기 넣으면 영원히 완성되지 않는다.
--   출입구 좌표도 같은 성질이다(일변동 누적 반영·폐지 이력 보존). 그래서 PK 에서 version_id 를
--   빼고 **자료 자체의 키**만 쓴다. resetVersionData 대상 목록에 이 테이블을 절대 넣지 말 것.
--
-- PK = 위치정보요약DB 명세의 PK1~PK5
--      도로명코드 | 지하여부 | 건물본번 | 건물부번 | 법정동코드
--   실측(2026-08-01): 전체분 16개 시도 파일 6,407,110 좌표행에서 이 키 **중복 0건**.
--   출입구일련번호를 키에 넣지 않은 이유가 여기 있다 — 넣으면 없는 다중성을 만들어
--   같은 지점이 두 행으로 갈린다.

CREATE SCHEMA IF NOT EXISTS nexus_address;
SET search_path TO nexus_address, public;

CREATE TABLE IF NOT EXISTS entrance_core (
  entrance_key text PRIMARY KEY,
  road_code text NOT NULL,
  underground_yn text NOT NULL DEFAULT '0',
  building_main_no integer NOT NULL,
  building_sub_no integer NOT NULL DEFAULT 0,
  legal_dong_code text,
  -- 연계자료(RNENTDATA·AlterD)에만 있다. address_core.address_mgt_no 와 직접 조인되는 열쇠.
  address_mgt_no text,
  entrance_no text,
  sido text,
  sigungu text,
  emd text,
  admin_dong text,
  road_name text,
  zip_code text,
  -- 위치정보요약DB(entrc_*)에만 있다. 건물군여부=1 이 300002 동 도형 연결 대상.
  building_name text,
  building_use text,
  building_group_yn text,
  -- 원본 좌표(EPSG:5179). 변환 결과를 나중에 재검증하려면 원본이 있어야 한다.
  x double precision,
  y double precision,
  -- WGS84. 격리된 좌표는 여기 절대 들어오지 않는다(아래 coord_status 참조).
  lat double precision,
  lng double precision,
  -- ok=검증 통과 · none=원본 무좌표(비공개 건물, 명세상 정상) ·
  -- quarantined=이상좌표로 격리(좌표 NULL) · unverified=대조군 표본 부족으로 판정 보류
  coord_status text NOT NULL DEFAULT 'none',
  coord_distance_m double precision,
  coord_ref_kind text,
  -- 폐지(이동사유 63) 반영. 하드 삭제하지 않는 이유: 기존 명단이 폐지 주소를 들고 있을 때
  -- "없는 주소"가 아니라 "폐지된 주소"라고 말해줘야 현장에서 정정할 수 있다.
  is_retired boolean NOT NULL DEFAULT false,
  retired_at date,
  retired_source text,
  source_file text,
  source_kind text,
  source_date date,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 도로명+본번/부번 정확일치 — 주소→출입구좌표 조회의 주 경로
CREATE INDEX IF NOT EXISTS entrance_core_road_exact
  ON entrance_core (road_code, underground_yn, building_main_no, building_sub_no);
-- 관리번호 조인(연계자료 보유분)
CREATE INDEX IF NOT EXISTS entrance_core_mgt_no
  ON entrance_core (address_mgt_no) WHERE address_mgt_no IS NOT NULL;
-- 법정동 단위 스캔(동별 좌표·배송권역)
CREATE INDEX IF NOT EXISTS entrance_core_legal_dong
  ON entrance_core (legal_dong_code);
-- 건물군(아파트 단지) 추출 — 300002 동 도형 연결 대상
CREATE INDEX IF NOT EXISTS entrance_core_group
  ON entrance_core (legal_dong_code) WHERE building_group_yn = '1';
-- 도로 단위 좌표 대조(이상탐지 기준점 계산)
CREATE INDEX IF NOT EXISTS entrance_core_road_coord
  ON entrance_core (road_code) WHERE lat IS NOT NULL;

-- 격리된 이상좌표 — 지우지 않고 남긴다. 원본이 고쳐졌는지 다음 달에 대조해야 하고,
-- 이 목록 자체가 "국가 원본도 틀린다"는 증거다(적재 전 반드시 봐야 하는 자료).
CREATE TABLE IF NOT EXISTS entrance_coord_quarantine (
  entrance_key text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  x double precision,
  y double precision,
  lat double precision,
  lng double precision,
  ref_kind text,
  ref_lat double precision,
  ref_lng double precision,
  ref_count integer,
  distance_m double precision,
  sido text,
  sigungu text,
  emd text,
  road_name text,
  source_file text,
  PRIMARY KEY (entrance_key, detected_at)
);

CREATE INDEX IF NOT EXISTS entrance_quarantine_recent
  ON entrance_coord_quarantine (detected_at DESC);

-- 적재 실행 로그 — 몇 건이 들어가고 몇 건이 격리·폐지됐는지 남긴다.
-- 다음 달 재적재 때 "이번엔 왜 줄었지?"를 답할 수 있는 유일한 근거.
CREATE TABLE IF NOT EXISTS entrance_load_runs (
  run_id text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  source_dir text,
  mode text,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);
