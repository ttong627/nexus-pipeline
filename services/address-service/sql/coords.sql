-- ══════════════════════════════════════════════════════════════════
--  좌표 저장소 — 입구 좌표 / 동(棟) 좌표 2종 구분 관리 (형 지시 2026-08-11)
--  설계서: 좌표관리_설계.md
--
--  ★버전독립 테이블이다. schema.sql 이 아니라 이 파일에 두는 이유:
--    schema.sql 의 테이블은 resetVersionData()가 월 재적재 때 통째로 지운다
--    (import-job.js 경고 참조). 좌표는 몇 달에 걸쳐 쌓이므로 지워지면 안 된다.
--
--  ★앵커가 address_mgt_no 가 아닌 이유(2026-08-11 실측):
--    address_core 986,737 vs building_core 10,722,592 — 831만 건(77.5%)이
--    address_core 에 없다. address_mgt_no 는 address_core 에만 있으므로
--    그 키로 좌표를 매달면 대부분의 건물이 좌표를 가질 수 없다.
--    → (road_code, 지하여부, 본번, 부번) 은 양쪽 테이블에 모두 있다.
-- ══════════════════════════════════════════════════════════════════
SET search_path TO nexus_address, public;

CREATE TABLE IF NOT EXISTS building_coord (
  -- {road_code}#{underground_yn}#{main}-{sub}
  coord_key        text PRIMARY KEY,
  road_code        text NOT NULL,
  underground_yn   text NOT NULL DEFAULT '0',
  building_main_no integer NOT NULL,
  building_sub_no  integer NOT NULL DEFAULT 0,
  -- 사람이 읽는 확인용(디버깅·리포트). 매칭 키로 쓰지 않는다.
  road_address     text NOT NULL,
  sigungu          text,
  legal_emd        text,
  building_name    text,
  is_apartment     boolean NOT NULL DEFAULT false,

  -- ① 입구 좌표 — 차량이 실제로 진입하는 지점.
  --    ★행안부 출입구 자료(entrance_core)·수동 확인만 이 칸을 채울 수 있다.
  --      지오코딩 결과(vworld·kakao)를 여기 넣으면 "건물 중심"이 "입구"로 둔갑해
  --      차가 못 들어가는 지점을 목적지로 주게 된다(설계서 F1).
  entrance_lat     double precision,
  entrance_lng     double precision,
  entrance_source  text,    -- juso_entrc | manual
  entrance_at      timestamptz,

  -- ② 중심 좌표 — 건물·단지 대표점. 지도 표시·거리계산 폴백.
  center_lat       double precision,
  center_lng       double precision,
  center_source    text,    -- vworld | kakao | juso
  center_at        timestamptz,

  -- ok=검증 통과 · outlier=이상치(DS-15) · unverified=미검증 · none=좌표 못 구함
  --   ★none 행도 만든다. "아직 안 해봤다"와 "해봤는데 없다"가 구분돼야 한다.
  quality          text NOT NULL DEFAULT 'unverified',
  quality_note     text,
  attempt_count    integer NOT NULL DEFAULT 0,
  -- 동(棟) 목록을 마지막으로 VWorld 에 물어본 시각 = **"물어봤는데 없더라"를 적는 자리**.
  --   ★없으면 답이 영영 안 나오는 단지에 매번 BBOX 를 태운다. 실측(2026-08-11 시흥):
  --     **103개 단지**가 VWorld LT_C_SPBD 에 동 정보가 아예 없는데(dongCount=0),
  --     명단을 돌릴 때마다 단지당 1~2콜씩 반복 조회됐다.
  --   ★NULL = 아직 안 물어봄. 값이 있는데 동이 여전히 없으면 주기 전까지 다시 묻지 않는다.
  --     영구 차단이 아니라 **주기 대기**다 — VWorld 자료는 갱신되므로 언젠가 생길 수 있다.
  dong_probed_at   timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 이미 만들어진 테이블에도 붙인다. CREATE TABLE IF NOT EXISTS 는 **컬럼을 추가하지 않는다** —
-- 이 줄이 없으면 운영 DB 에는 영영 안 생기고, 코드만 새 컬럼을 읽다가 조용히 undefined 를 본다.
ALTER TABLE building_coord ADD COLUMN IF NOT EXISTS dong_probed_at timestamptz;

-- 동(棟) 좌표 — 건물 1 : 동 N 관계라 별도 테이블.
--   컬럼으로 만들면 동이 늘 때마다 스키마가 바뀐다.
--   ★아파트(단지형)에만 존재한다. 단독·상가는 입구/중심 좌표뿐이다(형 지시 R4).
CREATE TABLE IF NOT EXISTS building_dong_coord (
  coord_key    text NOT NULL,
  -- 정규화된 동 표기: '101' · '가' · 'B'
  dong_no      text NOT NULL,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  -- 지상층수(VWorld gro_flo_co) — R-H 유효부담 층수 가중치에 직접 쓴다.
  floors       integer,
  -- VWorld buld_nm_dc 원문. 무엇을 보고 이 동이라 판단했는지 흔적을 남긴다.
  build_name   text,
  source       text NOT NULL DEFAULT 'vworld',
  -- dong=동번호 일치 · complex=단지만 일치 · centroid=대표점 폴백
  --   matched='dong' 이 아닌 것을 동 좌표로 신뢰하면 엉뚱한 동을 찍는다.
  matched      text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coord_key, dong_no)
);

-- 좌표 미보유 건물을 뽑아 배치로 채운다.
CREATE INDEX IF NOT EXISTS building_coord_pending
  ON building_coord (updated_at)
  WHERE center_lat IS NULL AND entrance_lat IS NULL;

-- 지자체별 현황 리포트.
CREATE INDEX IF NOT EXISTS building_coord_sigungu
  ON building_coord (sigungu);

CREATE INDEX IF NOT EXISTS building_dong_coord_key
  ON building_dong_coord (coord_key);
