-- ══════════════════════════════════════════════════════════════════
--  학습 주소(address_learned) — 형 지시 2026-08-11
--  "명단에 있는데 DB에 없는 경우는 API로 검색해서 DB업데이트까지 해주던지."
--
--  주소DB는 월 전체분이라 그달 이후 신축이 없다. 지금까지는 JUSO 폴백 결과를
--  address_fallback_cache(질의문자열 키)에만 넣어, 표기가 조금만 달라도 다시
--  외부 API를 두드렸고 **DB 자체는 영원히 신축을 모르는 상태**였다.
--
--  ★버전독립 테이블이다. schema.sql 이 아니라 이 파일에 두는 이유:
--    schema.sql 의 테이블은 resetVersionData()가 월 재적재 때 통째로 지운다
--    (import-job.js:294 경고 참조). 학습분은 몇 달에 걸쳐 쌓이므로 지워지면 안 된다.
--  ★정식 DB에 편입되면 promoted_version_id 로 표시만 하고 즉시 지우지 않는다 —
--    어느 버전에서 편입됐는지 추적할 수 있어야 학습이 옳았는지 사후 검증이 된다.
-- ══════════════════════════════════════════════════════════════════
SET search_path TO nexus_address, public;

CREATE TABLE IF NOT EXISTS address_learned (
  -- 도로명+본번-부번을 정규화한 키(normalizeSearchKey). 표기 흔들림을 흡수한다.
  road_key text PRIMARY KEY,
  road_address text NOT NULL,
  road_name text,
  building_main_no integer,
  building_sub_no integer NOT NULL DEFAULT 0,
  underground_yn text NOT NULL DEFAULT '0',
  road_code text,
  sido text,
  sigungu text,
  legal_emd text,
  legal_dong_code text,
  building_name text,
  building_mgt_no text,
  address_mgt_no text,
  zip_no text,
  is_apartment boolean NOT NULL DEFAULT false,
  -- juso | kakao | manual — 어디서 배웠는지. 사후에 출처별로 신뢰도를 재평가한다.
  source text NOT NULL DEFAULT 'juso',
  confidence numeric(4, 3) NOT NULL DEFAULT 0.720,
  hit_count integer NOT NULL DEFAULT 1,
  learned_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  -- 월 전체분에 편입 확인된 버전. NULL 이면 아직 정식 DB에 없는 주소(=신축 유력).
  promoted_version_id text
);

-- 건물명으로도 찾을 수 있어야 한다(건물번호 없는 질의 경로).
CREATE INDEX IF NOT EXISTS address_learned_name
  ON address_learned (building_name)
  WHERE building_name IS NOT NULL AND building_name <> '';

-- 미편입(신축 유력) 목록을 뽑아 운영 리포트로 쓴다.
CREATE INDEX IF NOT EXISTS address_learned_pending
  ON address_learned (learned_at DESC)
  WHERE promoted_version_id IS NULL;
