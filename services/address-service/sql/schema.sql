CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS nexus_address;
SET search_path TO nexus_address, public;

CREATE TABLE IF NOT EXISTS address_db_versions (
  version_id text PRIMARY KEY,
  reference_date date,
  storage_prefix text NOT NULL,
  imported_at timestamptz,
  published_at timestamptz,
  status text NOT NULL DEFAULT 'staging',
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS road_codes (
  version_id text NOT NULL,
  road_code text NOT NULL,
  emd_seq text NOT NULL,
  road_name text NOT NULL,
  sido text,
  sigungu text,
  emd text,
  road_name_key text NOT NULL,
  use_yn text,
  PRIMARY KEY (version_id, road_code, emd_seq)
);

CREATE TABLE IF NOT EXISTS address_core (
  version_id text NOT NULL,
  address_mgt_no text NOT NULL,
  legal_dong_code text,
  sido text,
  sigungu text,
  legal_emd text,
  legal_ri text,
  jibun_san_yn text,
  jibun_main_no integer,
  jibun_sub_no integer,
  road_code text,
  underground_yn text,
  building_main_no integer,
  building_sub_no integer,
  building_name text,
  road_name text,
  road_address text NOT NULL,
  road_key text NOT NULL,
  full_key text NOT NULL,
  PRIMARY KEY (version_id, address_mgt_no)
);

CREATE TABLE IF NOT EXISTS address_building_links (
  version_id text NOT NULL,
  building_mgt_no text NOT NULL,
  road_code text,
  emd_seq text,
  underground_yn text,
  building_main_no integer,
  building_sub_no integer,
  zip_no text,
  PRIMARY KEY (version_id, building_mgt_no)
);

CREATE TABLE IF NOT EXISTS building_core (
  version_id text NOT NULL,
  building_mgt_no text NOT NULL,
  legal_dong_code text,
  sido text,
  sigungu text,
  legal_emd text,
  legal_ri text,
  road_code text,
  road_name text,
  underground_yn text,
  building_main_no integer,
  building_sub_no integer,
  zip_no text,
  building_name text,
  building_name_key text,
  road_address text NOT NULL,
  road_key text NOT NULL,
  is_apartment boolean NOT NULL DEFAULT false,
  PRIMARY KEY (version_id, building_mgt_no)
);

CREATE TABLE IF NOT EXISTS detail_core (
  version_id text NOT NULL,
  detail_id text NOT NULL,
  address_mgt_no text,
  building_mgt_no text,
  legal_dong_code text,
  road_code text,
  underground_yn text,
  building_main_no integer,
  building_sub_no integer,
  dong_name text,
  floor_name text,
  ho_name text,
  detail_text text,
  PRIMARY KEY (version_id, detail_id)
);

CREATE TABLE IF NOT EXISTS address_fallback_cache (
  normalized_query text PRIMARY KEY,
  raw_query text NOT NULL,
  result jsonb NOT NULL,
  provider text NOT NULL DEFAULT 'juso',
  confidence numeric(4, 3) NOT NULL DEFAULT 0.700,
  hit_count integer NOT NULL DEFAULT 1,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS address_geocode_cache (
  cache_key text PRIMARY KEY,
  standard_road_address text NOT NULL,
  building_mgt_no text,
  provider text NOT NULL DEFAULT 'kakao',
  provider_query text NOT NULL,
  lat double precision,
  lng double precision,
  failure_count integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS address_search_keys (
  version_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  road_key text,
  jibun_key text,
  building_key text,
  full_key text NOT NULL,
  weight integer NOT NULL DEFAULT 100,
  PRIMARY KEY (version_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS road_codes_road_name_trgm
  ON road_codes USING gin (road_name_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS address_core_road_key_trgm
  ON address_core USING gin (road_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS address_core_full_key_trgm
  ON address_core USING gin (full_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS address_core_road_exact
  ON address_core (version_id, road_code, underground_yn, building_main_no, building_sub_no);
CREATE INDEX IF NOT EXISTS address_core_jibun_exact
  ON address_core (version_id, legal_dong_code, jibun_san_yn, jibun_main_no, jibun_sub_no);
CREATE INDEX IF NOT EXISTS address_links_road_exact
  ON address_building_links (version_id, road_code, underground_yn, building_main_no, building_sub_no);
CREATE INDEX IF NOT EXISTS building_core_name_trgm
  ON building_core USING gin (building_name_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS building_core_road_key_trgm
  ON building_core USING gin (road_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS building_core_road_exact
  ON building_core (version_id, road_code, underground_yn, building_main_no, building_sub_no);
CREATE INDEX IF NOT EXISTS search_keys_road_trgm
  ON address_search_keys USING gin (road_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS search_keys_building_trgm
  ON address_search_keys USING gin (building_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS detail_core_address
  ON detail_core (version_id, address_mgt_no);
CREATE INDEX IF NOT EXISTS detail_core_building
  ON detail_core (version_id, building_mgt_no);
