SET client_encoding = 'UTF8';
-- ============================================================
-- 통합 마이그레이션 — 모든 migration-*.sql 을 한 번에 실행
-- ------------------------------------------------------------
-- 자동 생성: scripts/build-migration-all.mjs
-- 모든 마이그레이션은 idempotent (IF NOT EXISTS) — 재실행 안전.
-- Supabase Dashboard → SQL Editor 에 통째 붙여넣고 Run.
-- ============================================================

-- ============================================================
-- migration-fix-users-id-sequence.sql
-- ============================================================
-- ============================================================
-- users.id 자동 채번 복구
-- ------------------------------------------------------------
-- 증상: INSERT INTO users(...) 실행 시
--   "null value in column \"id\" of relation \"users\" violates not-null constraint"
-- 원인: users.id 컬럼에 SERIAL/IDENTITY 시퀀스가 연결돼 있지 않음
-- 처리: users_id_seq 시퀀스를 만들고 DEFAULT nextval(...)로 연결,
--       기존 MAX(id)+1 부터 채번하도록 setval로 동기화
-- 안전성: 시퀀스가 이미 있으면 건너뜀 (DO 블록 내 IF 체크)
-- ============================================================

DO $$
DECLARE
  has_seq      BOOLEAN;
  has_default  BOOLEAN;
  cur_max      BIGINT;
BEGIN
  -- 1) users.id 에 연결된 시퀀스가 이미 있는지 확인
  has_seq := pg_get_serial_sequence('public.users', 'id') IS NOT NULL;

  -- 2) DEFAULT 절이 설정돼 있는지 확인
  SELECT (column_default IS NOT NULL) INTO has_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='users' AND column_name='id';

  IF has_seq AND has_default THEN
    RAISE NOTICE '✅ users.id 에 이미 시퀀스(%)와 DEFAULT가 연결돼 있습니다.',
      pg_get_serial_sequence('public.users', 'id');
  ELSE
    -- 3) 시퀀스 생성 (이미 있으면 IF NOT EXISTS로 무시)
    CREATE SEQUENCE IF NOT EXISTS users_id_seq;

    -- 4) 시퀀스 소유권 → users.id (DROP COLUMN 시 자동 삭제)
    ALTER SEQUENCE users_id_seq OWNED BY public.users.id;

    -- 5) DEFAULT nextval 연결
    ALTER TABLE public.users
      ALTER COLUMN id SET DEFAULT nextval('users_id_seq');

    -- 6) 기존 MAX(id) + 1 로 시퀀스 동기화 (다음 INSERT 시 충돌 방지)
    SELECT COALESCE(MAX(id), 0) INTO cur_max FROM public.users;
    PERFORM setval('users_id_seq', cur_max + 1, false);

    RAISE NOTICE '🛠️  users_id_seq 생성·연결 완료. 다음 id = %', cur_max + 1;
  END IF;
END $$;

-- ============================================================
-- 검증
-- ============================================================
SELECT
  column_name,
  data_type,
  column_default,
  pg_get_serial_sequence('public.users', column_name) AS sequence
FROM information_schema.columns
WHERE table_schema='public' AND table_name='users' AND column_name='id';

-- 시퀀스 현재값
SELECT 'users_id_seq next value' AS chk, last_value, is_called
FROM users_id_seq;

-- ============================================================
-- migration-add-dept-rank.sql
-- ============================================================
-- ============================================================
-- 부서/직급 마스터 테이블
-- ------------------------------------------------------------
-- 사원등록·수정 시 사용할 부서·직급 코드 마스터
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ranks (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS (앱 내부 접근만 허용)
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranks       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_departments" ON departments;
DROP POLICY IF EXISTS "allow_all_ranks"       ON ranks;

CREATE POLICY "allow_all_departments" ON departments FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_ranks"       ON ranks       FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 시드 데이터: 기존 users.dept / users.rank에서 추출
INSERT INTO departments (name, sort_order)
SELECT DISTINCT dept, ROW_NUMBER() OVER (ORDER BY dept) * 10
FROM users
WHERE dept IS NOT NULL AND TRIM(dept) <> ''
ON CONFLICT (name) DO NOTHING;

INSERT INTO ranks (name, sort_order)
SELECT name, sort_order FROM (VALUES
  ('대표',    10),
  ('상무',    20),
  ('전무',    30),
  ('이사',    40),
  ('부장',    50),
  ('차장',    60),
  ('과장',    70),
  ('대리',    80),
  ('사원',    90)
) AS t(name, sort_order)
ON CONFLICT (name) DO NOTHING;

-- 검증
SELECT 'departments' AS tbl, COUNT(*) AS cnt FROM departments
UNION ALL SELECT 'ranks', COUNT(*) FROM ranks;

-- ============================================================
-- migration-add-user-family.sql
-- ============================================================
-- ============================================================
-- 사원 가족정보 테이블
-- ------------------------------------------------------------
-- 사원등록·수정 시 입력하는 가족 정보 (1:N)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_family_members (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship  TEXT NOT NULL,            -- 배우자/장남/장녀/부/모 등
  name          TEXT NOT NULL,
  birth_date    DATE,
  occupation    TEXT,
  cohabiting    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_family_user_id ON user_family_members(user_id);

ALTER TABLE user_family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_user_family_members" ON user_family_members;
CREATE POLICY "allow_all_user_family_members" ON user_family_members FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT 'user_family_members' AS tbl, COUNT(*) FROM user_family_members;

-- ============================================================
-- migration-add-user-vehicles.sql
-- ============================================================
-- ============================================================
-- 사원 차량정보 테이블 + Storage 버킷
-- ============================================================

CREATE TABLE IF NOT EXISTS user_vehicles (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type          TEXT NOT NULL CHECK (vehicle_type IN ('자차','렌트','회사차량','기타')),
  plate_number          TEXT NOT NULL,
  model                 TEXT NOT NULL,
  year_made             TEXT,
  fuel_type             TEXT NOT NULL CHECK (fuel_type IN ('가솔린','디젤','가스','전기','기타')),
  registration_date     DATE,
  registration_doc_url  TEXT,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_vehicles_user_id ON user_vehicles(user_id);

ALTER TABLE user_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_user_vehicles" ON user_vehicles;
CREATE POLICY "allow_all_user_vehicles" ON user_vehicles FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- 차량등록증 첨부파일용 Storage 버킷 (이미지·PDF 허용)
-- ------------------------------------------------------------
-- 권한 문제로 실패 시 Dashboard → Storage → New bucket:
--   Name: vehicle-docs
--   Public: ✓
--   Size limit: 10MB
--   MIME: image/jpeg, image/png, image/webp, application/pdf
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-docs',
  'vehicle-docs',
  TRUE,
  10485760,   -- 10MB
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "vehicle_docs_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "vehicle_docs_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "vehicle_docs_authenticated_delete" ON storage.objects;

CREATE POLICY "vehicle_docs_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'vehicle-docs');

CREATE POLICY "vehicle_docs_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'vehicle-docs');

CREATE POLICY "vehicle_docs_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'vehicle-docs');

SELECT 'user_vehicles' AS tbl, COUNT(*) FROM user_vehicles;

-- ============================================================
-- migration-add-user-certifications.sql
-- ============================================================
-- ============================================================
-- 사원 자격정보 테이블 + Storage 버킷
-- ============================================================

CREATE TABLE IF NOT EXISTS user_certifications (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cert_name           TEXT NOT NULL,
  cert_number         TEXT,
  edu_completed_date  DATE,
  edu_next_date       DATE,
  cert_doc_url        TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_cert_user_id ON user_certifications(user_id);

ALTER TABLE user_certifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_user_certifications" ON user_certifications;
CREATE POLICY "allow_all_user_certifications" ON user_certifications FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- 자격증 사본 첨부파일용 Storage 버킷 (이미지·PDF 허용)
-- ------------------------------------------------------------
-- 권한 문제로 실패 시 Dashboard → Storage → New bucket:
--   Name: cert-docs
--   Public: ✓
--   Size limit: 10MB
--   MIME: image/jpeg, image/png, image/webp, application/pdf
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cert-docs',
  'cert-docs',
  TRUE,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "cert_docs_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "cert_docs_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "cert_docs_authenticated_delete" ON storage.objects;

CREATE POLICY "cert_docs_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'cert-docs');

CREATE POLICY "cert_docs_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'cert-docs');

CREATE POLICY "cert_docs_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'cert-docs');

SELECT 'user_certifications' AS tbl, COUNT(*) FROM user_certifications;

-- ============================================================
-- migration-add-tbm.sql
-- ============================================================
-- ============================================================
-- TBM (Tool Box Meeting) 시스템 마이그레이션
-- ------------------------------------------------------------
-- 9개 테이블 (마스터 4 + 트랜잭션 5) + 시드 + RLS 정책
-- 사용자/현장은 기존 users, sites, construction_schedules 재사용
-- 사진은 Supabase Storage 'tbm-photos' 버킷 사용 (별도 생성 필요)
-- ============================================================

-- ============================================================
-- [1] 마스터 테이블
-- ============================================================

-- 안전수칙 마스터
CREATE TABLE IF NOT EXISTS tbm_safety_rules_master (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  text        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'all'
                CHECK (category IN ('all','electric','repair','maintain','rescue','weld')),
  season      TEXT NOT NULL DEFAULT 'all'
                CHECK (season IN ('all','spring','summer','fall','winter')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 공사구분 마스터
CREATE TABLE IF NOT EXISTS tbm_repair_types (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 고장증상 마스터
CREATE TABLE IF NOT EXISTS tbm_fault_types (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 체크리스트 항목 마스터 (수리·자체점검 통합)
CREATE TABLE IF NOT EXISTS tbm_checklist_items (
  id          SERIAL PRIMARY KEY,
  list_type   TEXT NOT NULL CHECK (list_type IN ('repair','inspect')),
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (list_type, label)
);

-- ============================================================
-- [2] 트랜잭션 테이블
-- ============================================================

-- TBM 메인 기록
CREATE TABLE IF NOT EXISTS tbm_records (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  user_name           TEXT NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('repair','maintain')),
  sub_type            TEXT CHECK (sub_type IN ('inspect','parts','fault')),

  site_name           TEXT NOT NULL,
  elevator_name       TEXT NOT NULL DEFAULT '',
  schedule_id         INTEGER REFERENCES construction_schedules(id) ON DELETE SET NULL,

  repair_type_id      INTEGER REFERENCES tbm_repair_types(id) ON DELETE SET NULL,
  fault_type_id       INTEGER REFERENCES tbm_fault_types(id) ON DELETE SET NULL,

  parts_name          TEXT NOT NULL DEFAULT '',
  passenger_trapped   BOOLEAN NOT NULL DEFAULT FALSE,

  work_content        TEXT NOT NULL,
  risk_assessment     TEXT NOT NULL DEFAULT '',
  signature_url       TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tbm_records_user_id    ON tbm_records(user_id);
CREATE INDEX IF NOT EXISTS idx_tbm_records_created_at ON tbm_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tbm_records_site_name  ON tbm_records(site_name);
CREATE INDEX IF NOT EXISTS idx_tbm_records_mode       ON tbm_records(mode);

-- 참가자
CREATE TABLE IF NOT EXISTS tbm_participants (
  tbm_id      INTEGER NOT NULL REFERENCES tbm_records(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  user_name   TEXT NOT NULL,
  PRIMARY KEY (tbm_id, user_id)
);

-- 선택된 안전수칙 (스냅샷 텍스트 보존)
CREATE TABLE IF NOT EXISTS tbm_record_safety_rules (
  tbm_id      INTEGER NOT NULL REFERENCES tbm_records(id) ON DELETE CASCADE,
  rule_id     INTEGER NOT NULL REFERENCES tbm_safety_rules_master(id) ON DELETE RESTRICT,
  rule_text   TEXT NOT NULL,
  PRIMARY KEY (tbm_id, rule_id)
);

-- 체크리스트 응답
CREATE TABLE IF NOT EXISTS tbm_checklist_results (
  tbm_id      INTEGER NOT NULL REFERENCES tbm_records(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES tbm_checklist_items(id) ON DELETE RESTRICT,
  item_label  TEXT NOT NULL,
  is_checked  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tbm_id, item_id)
);

-- 사진 (Storage URL 저장)
CREATE TABLE IF NOT EXISTS tbm_photos (
  id          SERIAL PRIMARY KEY,
  tbm_id      INTEGER NOT NULL REFERENCES tbm_records(id) ON DELETE CASCADE,
  photo_url   TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tbm_photos_tbm_id ON tbm_photos(tbm_id);

-- ============================================================
-- [3] RLS 정책 (본 앱 패턴 — 내부 접근 전체 허용)
-- ============================================================

ALTER TABLE tbm_safety_rules_master  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_repair_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_fault_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_checklist_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_records              ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_participants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_record_safety_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_checklist_results    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_photos               ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_tbm_safety_rules_master" ON tbm_safety_rules_master;
CREATE POLICY "allow_all_tbm_safety_rules_master" ON tbm_safety_rules_master FOR ALL USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "allow_all_tbm_repair_types" ON tbm_repair_types;
CREATE POLICY "allow_all_tbm_repair_types" ON tbm_repair_types        FOR ALL USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "allow_all_tbm_fault_types" ON tbm_fault_types;
CREATE POLICY "allow_all_tbm_fault_types" ON tbm_fault_types         FOR ALL USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "allow_all_tbm_checklist_items" ON tbm_checklist_items;
CREATE POLICY "allow_all_tbm_checklist_items" ON tbm_checklist_items     FOR ALL USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "allow_all_tbm_records" ON tbm_records;
CREATE POLICY "allow_all_tbm_records" ON tbm_records             FOR ALL USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "allow_all_tbm_participants" ON tbm_participants;
CREATE POLICY "allow_all_tbm_participants" ON tbm_participants        FOR ALL USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "allow_all_tbm_record_safety_rules" ON tbm_record_safety_rules;
CREATE POLICY "allow_all_tbm_record_safety_rules" ON tbm_record_safety_rules FOR ALL USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "allow_all_tbm_checklist_results" ON tbm_checklist_results;
CREATE POLICY "allow_all_tbm_checklist_results" ON tbm_checklist_results   FOR ALL USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "allow_all_tbm_photos" ON tbm_photos;
CREATE POLICY "allow_all_tbm_photos" ON tbm_photos              FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- [4] 시드 데이터
-- ============================================================

-- 안전수칙 20건 (HTML R01~R20)
INSERT INTO tbm_safety_rules_master (code, text, category, season, sort_order) VALUES
  ('R01','작업 전 개인보호장비(안전모·안전화·절연장갑) 착용 확인','all','all',1),
  ('R02','메인 전원 차단 및 LOTO(잠금·표지) 시행 후 작업 개시','electric','all',2),
  ('R03','임시 전원 사용 시 누전차단기 설치 및 접지 확인','electric','all',3),
  ('R04','운행 정지 안내문 출입구 모두 부착 후 작업 시작','repair','all',4),
  ('R05','카 고정 세이프티 블록 체결 확인 후 카 내부 진입','repair','all',5),
  ('R06','용접·절단 시 화기 감시자 배치 및 소화기(2kg 이상) 비치','weld','all',6),
  ('R07','용접 불꽃 비산 방지 차단막 설치 후 작업','weld','all',7),
  ('R08','피트 진입 전 환기 실시 및 밀폐공간 산소농도 측정','repair','all',8),
  ('R09','2인 1조 원칙 — 피트·기계실 단독 진입 금지','all','all',9),
  ('R10','카 내부 작업 시 도어 열림 고정장치 설치 필수','maintain','all',10),
  ('R11','기계실 진입 시 환기 실시 및 유해가스 측정','maintain','all',11),
  ('R12','승객 갇힘 구출 시 수동 구출 절차 준수 (전원 확인 선행)','rescue','all',12),
  ('R13','구출 시 카 이동 전 관리자 및 이용자에게 사전 고지','rescue','all',13),
  ('R14','고장 출동 시 안전조치 완료 전 임의 수리 금지','rescue','all',14),
  ('R15','혹서기 기계실 온도 40°C 이상 시 냉각 조치 후 작업','all','summer',15),
  ('R16','하절기 우기 시 피트 침수 확인 후 진입 (감전 방지)','maintain','summer',16),
  ('R17','동절기 기계실 결로 감전 예방 — 절연 상태 점검','all','winter',17),
  ('R18','동절기 결빙 구간 작업 전 염화칼슘 살포','repair','winter',18),
  ('R19','봄철 황사 시 정밀부품 오염 방지 덮개 사용','all','spring',19),
  ('R20','가을 낙엽·빗물 미끄럼 방지 통로 정비 선행','all','fall',20)
ON CONFLICT (code) DO NOTHING;

-- 공사구분 7건 (HTML RT01~RT07)
INSERT INTO tbm_repair_types (code, label, sort_order) VALUES
  ('RT01','로프 교체',1),
  ('RT02','도어 수리',2),
  ('RT03','브레이크 교체',3),
  ('RT04','제어반 교체',4),
  ('RT05','카 내부 수리',5),
  ('RT06','모터 교체',6),
  ('RT07','기타 수리',7)
ON CONFLICT (code) DO NOTHING;

-- 고장증상 7건 (HTML FT01~FT07)
INSERT INTO tbm_fault_types (code, label, sort_order) VALUES
  ('FT01','도어 불량',1),
  ('FT02','층간 정지',2),
  ('FT03','이상 소음·진동',3),
  ('FT04','속도 이상',4),
  ('FT05','전기·제어 이상',5),
  ('FT06','비상정지 작동',6),
  ('FT07','기타',7)
ON CONFLICT (code) DO NOTHING;

-- 체크리스트 12건 (수리 6 + 자체점검 6)
INSERT INTO tbm_checklist_items (list_type, label, sort_order) VALUES
  -- 수리공사 작업 전 안전조치
  ('repair','메인 전원 차단 및 LOTO 시행 확인',1),
  ('repair','운행 정지 안내문 출입구 부착 완료',2),
  ('repair','카 고정 세이프티 블록 체결 확인',3),
  ('repair','기계실·피트 환기 상태 확인',4),
  ('repair','개인보호장비 착용 완료',5),
  ('repair','소화기 비치 및 화기 감시자 지정 (용접 시)',6),
  -- 보수 자체점검
  ('inspect','도어 개폐 및 인터록 동작',1),
  ('inspect','브레이크 작동 상태',2),
  ('inspect','로프 마모·장력 상태',3),
  ('inspect','완충기 및 안전장치',4),
  ('inspect','조명·비상연락 장치',5),
  ('inspect','각층 도어 닫힘·간격 상태',6)
ON CONFLICT (list_type, label) DO NOTHING;

-- ============================================================
-- [5] 검증 쿼리
-- ============================================================

SELECT 'tbm_safety_rules_master' AS tbl, COUNT(*) AS cnt FROM tbm_safety_rules_master
UNION ALL SELECT 'tbm_repair_types',     COUNT(*) FROM tbm_repair_types
UNION ALL SELECT 'tbm_fault_types',      COUNT(*) FROM tbm_fault_types
UNION ALL SELECT 'tbm_checklist_items',  COUNT(*) FROM tbm_checklist_items
UNION ALL SELECT 'tbm_records',          COUNT(*) FROM tbm_records;

-- 예상 결과:
--   tbm_safety_rules_master  20
--   tbm_repair_types          7
--   tbm_fault_types           7
--   tbm_checklist_items      12
--   tbm_records               0

-- ============================================================
-- migration-add-tbm-storage.sql
-- ============================================================
-- ============================================================
-- TBM 사진 저장용 Supabase Storage 버킷 생성
-- ------------------------------------------------------------
-- 본 SQL은 Supabase SQL Editor에서 실행하면 storage.buckets에
-- 'tbm-photos' 버킷을 추가합니다 (public read).
--
-- 만약 권한 문제로 실행이 실패하면, 대신 Supabase 대시보드 UI에서
-- 수동 생성하세요:
--   Dashboard → Storage → New bucket
--     - Name:   tbm-photos
--     - Public: ✓ (체크)
--     - File size limit: 5MB
--     - Allowed MIME types: image/jpeg, image/png, image/webp
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tbm-photos',
  'tbm-photos',
  TRUE,
  5242880,                                                      -- 5MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 업로드 정책 (인증된 모든 사용자 업로드 가능)
DROP POLICY IF EXISTS "tbm_photos_authenticated_upload" ON storage.objects;
CREATE POLICY "tbm_photos_authenticated_upload" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'tbm-photos');

-- 공개 읽기 정책 (URL을 알면 누구나 조회 가능)
DROP POLICY IF EXISTS "tbm_photos_public_read" ON storage.objects;
CREATE POLICY "tbm_photos_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'tbm-photos');

-- 삭제 정책 (앱 내부에서 TBM 삭제 시 사진도 함께 삭제)
DROP POLICY IF EXISTS "tbm_photos_authenticated_delete" ON storage.objects;
CREATE POLICY "tbm_photos_authenticated_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'tbm-photos');

-- 검증
SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'tbm-photos';

-- ============================================================
-- migration-add-tbm-participant-attestation.sql
-- ============================================================
-- ============================================================
-- TBM 참가자 확인(attestation) 기능 추가
-- ------------------------------------------------------------
-- 작업참가자가 TBM 내용(체크리스트·안전수칙)을 확인하고
-- 서명·사진을 추가할 수 있도록 다음을 추가:
--   1. tbm_participants: signature_url, confirmed_at 컬럼 추가
--   2. tbm_participant_checklist (참가자별 체크리스트 확인)
--   3. tbm_participant_safety   (참가자별 안전수칙 확인)
--   4. tbm_participant_photos   (참가자별 사진)
-- ============================================================

-- [1] 참가자 본인의 서명·확인일시
ALTER TABLE tbm_participants
  ADD COLUMN IF NOT EXISTS signature_url TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_at  TIMESTAMPTZ;

-- [2] 참가자별 체크리스트 확인 결과
CREATE TABLE IF NOT EXISTS tbm_participant_checklist (
  tbm_id      INTEGER NOT NULL REFERENCES tbm_records(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  item_id     INTEGER NOT NULL REFERENCES tbm_checklist_items(id) ON DELETE RESTRICT,
  is_checked  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tbm_id, user_id, item_id)
);

-- [3] 참가자별 안전수칙 확인 (acknowledged = 확인함)
CREATE TABLE IF NOT EXISTS tbm_participant_safety (
  tbm_id        INTEGER NOT NULL REFERENCES tbm_records(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rule_id       INTEGER NOT NULL REFERENCES tbm_safety_rules_master(id) ON DELETE RESTRICT,
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tbm_id, user_id, rule_id)
);

-- [4] 참가자별 사진
CREATE TABLE IF NOT EXISTS tbm_participant_photos (
  id          SERIAL PRIMARY KEY,
  tbm_id      INTEGER NOT NULL REFERENCES tbm_records(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  photo_url   TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tbm_participant_photos_tbm_id  ON tbm_participant_photos(tbm_id);
CREATE INDEX IF NOT EXISTS idx_tbm_participant_photos_user_id ON tbm_participant_photos(user_id);

-- [5] RLS (앱 내부 접근만 허용 — DROP 후 재생성으로 멱등 보장)
ALTER TABLE tbm_participant_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_participant_safety    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tbm_participant_photos    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_tbm_participant_checklist" ON tbm_participant_checklist;
DROP POLICY IF EXISTS "allow_all_tbm_participant_safety"    ON tbm_participant_safety;
DROP POLICY IF EXISTS "allow_all_tbm_participant_photos"    ON tbm_participant_photos;

CREATE POLICY "allow_all_tbm_participant_checklist" ON tbm_participant_checklist FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_participant_safety"    ON tbm_participant_safety    FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_participant_photos"    ON tbm_participant_photos    FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT 'tbm_participants(new cols)' AS tbl,
       COUNT(*) FILTER (WHERE column_name IN ('signature_url','confirmed_at')) AS cnt
FROM information_schema.columns
WHERE table_name = 'tbm_participants'
UNION ALL SELECT 'tbm_participant_checklist',
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'tbm_participant_checklist')
UNION ALL SELECT 'tbm_participant_safety',
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'tbm_participant_safety')
UNION ALL SELECT 'tbm_participant_photos',
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'tbm_participant_photos');

-- 예상 결과:
--   tbm_participants(new cols)   2
--   tbm_participant_checklist    1
--   tbm_participant_safety       1
--   tbm_participant_photos       1

-- ============================================================
-- migration-add-quotes.sql
-- ============================================================
-- ============================================================
-- 견적서 시스템 (Phase 1)
-- ------------------------------------------------------------
-- · quote_settings    : 회사 견적 기본값 (직접인건비/간접%/일반관리%/이윤%)
-- · quotes            : 견적서 헤더
-- · quote_items       : 자재비 라인
-- · materials.opinion_text / opinion_image_url : 자재별 1:1 소견서
-- · labor_rates       : 공정별 공임 단가표 (Phase 2 사전 준비)
-- ============================================================

-- 1) 견적 기본값 (단일 행으로 운영, id=1 고정)
CREATE TABLE IF NOT EXISTS quote_settings (
  id                       SMALLINT PRIMARY KEY DEFAULT 1
                           CHECK (id = 1),
  default_direct_labor     INTEGER NOT NULL DEFAULT 0,    -- 기본 직접인건비(원)
  indirect_labor_rate      NUMERIC(5,2) NOT NULL DEFAULT 8.0,  -- 간접인건비율(%)
  overhead_rate            NUMERIC(5,2) NOT NULL DEFAULT 10.0, -- 일반관리비율(%)
  profit_rate              NUMERIC(5,2) NOT NULL DEFAULT 8.0,  -- 이윤율(%)
  company_name             TEXT,
  company_biz_no           TEXT,
  company_address          TEXT,
  company_phone            TEXT,
  company_email            TEXT,
  company_ceo              TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 초기 행 삽입 (이미 있으면 유지)
INSERT INTO quote_settings (id, default_direct_labor, indirect_labor_rate, overhead_rate, profit_rate,
                            company_name, company_biz_no, company_address, company_phone, company_email, company_ceo)
VALUES (1, 0, 8.0, 10.0, 8.0,
        '주식회사 대솔이엘', '128-86-58162',
        '경기 고양 일산동구 숲속마을로 48 702(풍동 신성프라자)',
        '031-938-0257',
        'daesol0257@gmail.com',
        '송영권')
ON CONFLICT (id) DO NOTHING;

-- 2) 자재 소견서 (1:1)
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS opinion_text       TEXT,
  ADD COLUMN IF NOT EXISTS opinion_image_url  TEXT;

-- 3) 견적서 헤더
CREATE TABLE IF NOT EXISTS quotes (
  id                  SERIAL PRIMARY KEY,
  quote_no            TEXT NOT NULL UNIQUE,        -- 예: Q-2026-0001
  quote_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  site_name           TEXT,                         -- 현장명
  elevator_name       TEXT,                         -- 호기
  work_title          TEXT,                         -- 작업명
  customer_name       TEXT,                         -- 고객명
  customer_phone      TEXT,
  -- 금액 스냅샷 (자동계산 결과 보존)
  material_subtotal   INTEGER NOT NULL DEFAULT 0,   -- 자재비 합계
  direct_labor        INTEGER NOT NULL DEFAULT 0,   -- 직접인건비
  indirect_labor      INTEGER NOT NULL DEFAULT 0,   -- 간접인건비
  overhead            INTEGER NOT NULL DEFAULT 0,   -- 일반관리비
  profit              INTEGER NOT NULL DEFAULT 0,   -- 이윤
  truncate_amount     INTEGER NOT NULL DEFAULT 0,   -- 절사금액 (-)
  total_amount        INTEGER NOT NULL DEFAULT 0,   -- 공급가액 (총합)
  -- 사용된 비율(%) 스냅샷
  indirect_labor_rate NUMERIC(5,2) NOT NULL DEFAULT 8.0,
  overhead_rate       NUMERIC(5,2) NOT NULL DEFAULT 10.0,
  profit_rate         NUMERIC(5,2) NOT NULL DEFAULT 8.0,
  -- 메타
  note                TEXT,                          -- 특기사항
  status              TEXT NOT NULL DEFAULT '작성중'
                       CHECK (status IN ('작성중','발행','승인','취소')),
  created_by_id       INTEGER,
  created_by_name     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_date ON quotes(quote_date DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_site ON quotes(site_name);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);

-- 4) 견적서 라인 (자재비)
CREATE TABLE IF NOT EXISTS quote_items (
  id              SERIAL PRIMARY KEY,
  quote_id        INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  material_id     TEXT REFERENCES materials(id),     -- NULL 가능 (수기 입력)
  material_name   TEXT NOT NULL,                     -- 스냅샷
  spec            TEXT,                              -- 규격(modelNo) 스냅샷
  unit            TEXT,                              -- EA, SET 등
  qty             INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price      INTEGER NOT NULL DEFAULT 0,        -- 단가
  amount          INTEGER NOT NULL DEFAULT 0,        -- = qty * unit_price (저장 시 갱신)
  remark          TEXT,                              -- 비고
  -- 소견서 스냅샷 (저장 시점의 자재 소견서 복사)
  opinion_text       TEXT,
  opinion_image_url  TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote    ON quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_material ON quote_items(material_id);

-- 5) 공정별 공임 단가표 (Phase 2 — DB만 사전 준비)
CREATE TABLE IF NOT EXISTS labor_rates (
  id              SERIAL PRIMARY KEY,
  process_code    TEXT NOT NULL UNIQUE,    -- 예: ELEC-001
  process_name    TEXT NOT NULL,           -- 공정명
  category        TEXT,                    -- 분류 (전기/기계 등)
  unit            TEXT,                    -- '인공'/'시간' 등
  unit_price      INTEGER NOT NULL DEFAULT 0,
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labor_rates_active ON labor_rates(is_active) WHERE is_active = TRUE;

-- 6) RLS
ALTER TABLE quote_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_rates    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_quote_settings" ON quote_settings;
DROP POLICY IF EXISTS "allow_all_quotes"         ON quotes;
DROP POLICY IF EXISTS "allow_all_quote_items"    ON quote_items;
DROP POLICY IF EXISTS "allow_all_labor_rates"    ON labor_rates;

CREATE POLICY "allow_all_quote_settings" ON quote_settings FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_quotes"         ON quotes         FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_quote_items"    ON quote_items    FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_labor_rates"    ON labor_rates    FOR ALL USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT 'quote_settings' AS tbl, (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='quote_settings') AS exists
UNION ALL SELECT 'quotes',         (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='quotes')
UNION ALL SELECT 'quote_items',    (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='quote_items')
UNION ALL SELECT 'labor_rates',    (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='labor_rates')
UNION ALL SELECT 'materials.opinion_text', (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='materials' AND column_name='opinion_text');

-- ============================================================
-- migration-add-quote-opinion-bucket.sql
-- ============================================================
-- ============================================================
-- 자재 소견서 이미지용 Storage 버킷
-- ------------------------------------------------------------
-- 자재품목 관리 → 자재 수정 → 소견서 이미지 업로드 시 사용
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'material-opinions',
  'material-opinions',
  TRUE,
  10485760,   -- 10MB
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "material_opinions_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "material_opinions_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "material_opinions_authenticated_delete" ON storage.objects;

CREATE POLICY "material_opinions_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'material-opinions');

CREATE POLICY "material_opinions_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'material-opinions');

CREATE POLICY "material_opinions_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'material-opinions');

-- 검증
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'material-opinions';

-- ============================================================
-- migration-material-reference-images.sql
-- ============================================================
-- ============================================================
-- 자재 참조 사진 — 자재당 최대 2장
-- ------------------------------------------------------------
-- 자재 상세 화면에서 참조 자료로 첨부하는 사진 URL 2개.
-- 기존 소견서 이미지(opinion_image_url, 견적서 자동 첨부용)와 별개.
--
-- 추가
--   · materials.reference_image_url1 : 참조 사진 1
--   · materials.reference_image_url2 : 참조 사진 2
--   · Storage 버킷 "material-references" + RLS 정책
--     (기존 "material-opinions" 와 동일한 운영 정책)
--
-- idempotent: ALTER ... IF NOT EXISTS / INSERT ... ON CONFLICT / DROP POLICY IF EXISTS
-- ============================================================

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS reference_image_url1 TEXT,
  ADD COLUMN IF NOT EXISTS reference_image_url2 TEXT;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Storage 버킷 + RLS 정책
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'material-references',
  'material-references',
  TRUE,
  10485760,   -- 10MB
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "material_references_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "material_references_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "material_references_authenticated_delete" ON storage.objects;

CREATE POLICY "material_references_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'material-references');

CREATE POLICY "material_references_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'material-references');

CREATE POLICY "material_references_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'material-references');

-- ============================================================
-- 검증
-- ============================================================
SELECT
  'materials.reference_image_url1' AS chk,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='materials' AND column_name='reference_image_url1') AS cnt
UNION ALL SELECT
  'materials.reference_image_url2',
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='materials' AND column_name='reference_image_url2')
UNION ALL SELECT
  'bucket material-references',
  (SELECT COUNT(*) FROM storage.buckets WHERE id='material-references');

-- ============================================================
-- migration-add-uniform-safety-requests.sql
-- ============================================================
-- ============================================================
-- 근무복 및 개인안전장구 신청 시스템
-- ------------------------------------------------------------
-- · 신청 → 처리중 → 수령완료 / 취소
-- · 근무복: 대분류 99 / 중분류 02 (D9902%) — 상의/하의/안전화
--   슬롯에 사이즈 포함, 수령완료 시 users.uniform_top_size /
--   uniform_bottom_size / safety_shoes_size 자동 갱신
-- · 안전장구: 대분류 99 / 중분류 03 (D9903%)
-- · 자재 필터는 대분류·중분류 prefix 만으로 적용 (소분류 무관)
-- ============================================================

-- 1. 신청 헤더
CREATE TABLE IF NOT EXISTS uniform_safety_requests (
  id              SERIAL PRIMARY KEY,
  request_type    TEXT        NOT NULL CHECK (request_type IN ('근무복','안전장구')),
  status          TEXT        NOT NULL DEFAULT '신청'
                              CHECK (status IN ('신청','처리중','수령완료','취소')),
  user_id         INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name       TEXT        NOT NULL,
  user_dept       TEXT,
  note            TEXT,                                 -- 비고(신청 사유)
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,                          -- 출고 처리 시각
  processor_id    INTEGER,
  processor_name  TEXT,
  received_at     TIMESTAMPTZ,                          -- 수령완료 시각
  cancel_reason   TEXT
);

CREATE INDEX IF NOT EXISTS idx_usr_user      ON uniform_safety_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_usr_status    ON uniform_safety_requests(status);
CREATE INDEX IF NOT EXISTS idx_usr_requested ON uniform_safety_requests(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_usr_received  ON uniform_safety_requests(received_at DESC);

-- 2. 신청 라인
CREATE TABLE IF NOT EXISTS uniform_safety_request_items (
  id              SERIAL PRIMARY KEY,
  request_id      INTEGER NOT NULL REFERENCES uniform_safety_requests(id) ON DELETE CASCADE,
  material_id     TEXT    NOT NULL REFERENCES materials(id),
  material_name   TEXT    NOT NULL,
  category_label  TEXT,                                 -- '상의' | '하의' | '안전화' | '안전모' 등
  size            TEXT,                                 -- 근무복일 때만 사용
  qty             INTEGER NOT NULL CHECK (qty > 0) DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_usri_request  ON uniform_safety_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_usri_material ON uniform_safety_request_items(material_id);

-- 3. RLS
ALTER TABLE uniform_safety_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE uniform_safety_request_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_usr"  ON uniform_safety_requests;
DROP POLICY IF EXISTS "allow_all_usri" ON uniform_safety_request_items;

CREATE POLICY "allow_all_usr"  ON uniform_safety_requests      FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_usri" ON uniform_safety_request_items FOR ALL USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT 'uniform_safety_requests'      AS tbl, (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='uniform_safety_requests')      AS exists
UNION ALL
SELECT 'uniform_safety_request_items', (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='uniform_safety_request_items');

-- ============================================================
-- migration-add-password.sql
-- ============================================================
-- users 테이블에 password_hash 컬럼 추가
-- SHA-256("1234") = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

-- 실행 확인
SELECT id, name, LEFT(password_hash, 8) || '...' AS pw_preview
FROM users
LIMIT 5;

-- ============================================================
-- migration-add-employee-fields.sql
-- ============================================================
-- ============================================================
-- 사원등록 페이지용 신규 컬럼 추가
-- ------------------------------------------------------------
-- users 테이블에 다음 컬럼 추가:
--   photo_url, emergency_contact, postal_code,
--   uniform_top_size, uniform_bottom_size, safety_shoes_size
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS photo_url            TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact    TEXT,
  ADD COLUMN IF NOT EXISTS postal_code          TEXT,
  ADD COLUMN IF NOT EXISTS uniform_top_size     TEXT,
  ADD COLUMN IF NOT EXISTS uniform_bottom_size  TEXT,
  ADD COLUMN IF NOT EXISTS safety_shoes_size    TEXT;

-- 검증
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN (
    'photo_url','emergency_contact','postal_code',
    'uniform_top_size','uniform_bottom_size','safety_shoes_size'
  );

-- ============================================================
-- 사원 사진 저장용 Storage 버킷 (대시보드 UI에서 수동 생성도 가능)
-- ------------------------------------------------------------
-- INSERT가 권한 문제로 실패하면 Supabase Dashboard에서 수동 생성:
--   Storage → New bucket
--     - Name: employee-photos
--     - Public: ✓
--     - File size limit: 3MB
--     - MIME: image/jpeg, image/png, image/webp
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-photos',
  'employee-photos',
  TRUE,
  3145728,   -- 3MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 정책 (idempotent)
DROP POLICY IF EXISTS "employee_photos_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "employee_photos_authenticated_delete" ON storage.objects;

CREATE POLICY "employee_photos_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'employee-photos');

CREATE POLICY "employee_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'employee-photos');

CREATE POLICY "employee_photos_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'employee-photos');

-- ============================================================
-- migration-add-user-email.sql
-- ============================================================
-- ============================================================
-- users 테이블에 email 컬럼 추가
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT;

-- 검증
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'email';

-- ============================================================
-- migration-add-theme.sql
-- ============================================================
-- users 테이블에 theme 컬럼 추가
-- 사용자별 화면 테마(라이트/다크) 저장
-- 'light' | 'dark' 두 값만 사용

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'light'
  CHECK (theme IN ('light', 'dark'));

-- 실행 확인
SELECT id, name, theme
FROM users
LIMIT 5;

-- ============================================================
-- migration-add-user-family-gender.sql
-- ============================================================
-- ============================================================
-- user_family_members에 성별 컬럼 추가
-- ============================================================

ALTER TABLE user_family_members
  ADD COLUMN IF NOT EXISTS gender TEXT
  CHECK (gender IS NULL OR gender IN ('M', 'F'));

-- 검증
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'user_family_members' AND column_name = 'gender';

-- ============================================================
-- migration-add-vehicle-insurance.sql
-- ============================================================
-- ============================================================
-- user_vehicles에 차량보험 정보 컬럼 추가
-- ============================================================

ALTER TABLE user_vehicles
  ADD COLUMN IF NOT EXISTS insurance_company    TEXT,
  ADD COLUMN IF NOT EXISTS insurance_start_date DATE,
  ADD COLUMN IF NOT EXISTS insurance_end_date   DATE;

-- 검증
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'user_vehicles'
  AND column_name IN ('insurance_company','insurance_start_date','insurance_end_date');

-- ============================================================
-- migration-add-vehicle-insurance-extra.sql
-- ============================================================
-- ============================================================
-- user_vehicles에 운전자범위 + 보험증권 컬럼 추가
-- ============================================================

ALTER TABLE user_vehicles
  ADD COLUMN IF NOT EXISTS driver_age_range  TEXT,
  ADD COLUMN IF NOT EXISTS driver_scope      TEXT,
  ADD COLUMN IF NOT EXISTS insurance_doc_url TEXT;

-- 검증
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'user_vehicles'
  AND column_name IN ('driver_age_range','driver_scope','insurance_doc_url');

-- ============================================================
-- migration-add-vehicle-history.sql
-- ============================================================
-- ============================================================
-- 회사차량 수정 이력 + 폐차 상태 관리
-- ============================================================

-- 1. user_vehicles에 폐차 상태 컬럼 추가
ALTER TABLE user_vehicles
  ADD COLUMN IF NOT EXISTS status            TEXT    NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','scrapped')),
  ADD COLUMN IF NOT EXISTS scrapped_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scrapped_by_id    INTEGER,
  ADD COLUMN IF NOT EXISTS scrapped_by_name  TEXT,
  ADD COLUMN IF NOT EXISTS scrapped_note     TEXT;

-- 2. 사용자 변경 이력
CREATE TABLE IF NOT EXISTS vehicle_user_history (
  id              SERIAL PRIMARY KEY,
  vehicle_id      INTEGER NOT NULL REFERENCES user_vehicles(id) ON DELETE CASCADE,
  prev_user_id    INTEGER,
  prev_user_name  TEXT,
  new_user_id     INTEGER,
  new_user_name   TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_id   INTEGER,
  changed_by_name TEXT,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_history_vehicle ON vehicle_user_history(vehicle_id);

-- 3. 보험정보 변경 이력
CREATE TABLE IF NOT EXISTS vehicle_insurance_history (
  id              SERIAL PRIMARY KEY,
  vehicle_id      INTEGER NOT NULL REFERENCES user_vehicles(id) ON DELETE CASCADE,
  prev_company    TEXT,
  prev_start_date DATE,
  prev_end_date   DATE,
  prev_age_range  TEXT,
  prev_scope      TEXT,
  prev_doc_url    TEXT,
  new_company     TEXT,
  new_start_date  DATE,
  new_end_date    DATE,
  new_age_range   TEXT,
  new_scope       TEXT,
  new_doc_url     TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_id   INTEGER,
  changed_by_name TEXT,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_vehicle_insurance_history_vehicle ON vehicle_insurance_history(vehicle_id);

-- RLS
ALTER TABLE vehicle_user_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_insurance_history  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_vehicle_user_history"      ON vehicle_user_history;
DROP POLICY IF EXISTS "allow_all_vehicle_insurance_history" ON vehicle_insurance_history;

CREATE POLICY "allow_all_vehicle_user_history"      ON vehicle_user_history      FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_vehicle_insurance_history" ON vehicle_insurance_history FOR ALL USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT 'user_vehicles status' AS check, COUNT(*) AS cnt FROM information_schema.columns
WHERE table_name='user_vehicles' AND column_name IN ('status','scrapped_at','scrapped_by_id','scrapped_by_name','scrapped_note')
UNION ALL SELECT 'vehicle_user_history',      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='vehicle_user_history')
UNION ALL SELECT 'vehicle_insurance_history', (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='vehicle_insurance_history');

-- ============================================================
-- migration-add-shared-vehicle.sql
-- ============================================================
-- ============================================================
-- 공용 차량(사용자 미지정) 지원
--   user_vehicles.user_id 를 NULL 허용으로 변경
--   → 회사차량관리에서 사용자를 "공용 차량"으로 등록할 수 있도록 함
-- ============================================================

ALTER TABLE user_vehicles
  ALTER COLUMN user_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'user_vehicles' AND column_name = 'user_id';

-- ============================================================
-- migration-add-permission-groups.sql
-- ============================================================
-- ============================================================
-- 사용자 권한 그룹 (Permission Group) 시스템
-- ------------------------------------------------------------
-- 1) permission_groups 테이블
-- 2) users.permission_group_id FK 컬럼
-- 3) 7개 기본 그룹 시드 (시스템관리자만 admin 권한 사전 적용)
-- ============================================================

CREATE TABLE IF NOT EXISTS permission_groups (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  color           TEXT NOT NULL DEFAULT 'slate',    -- Tailwind 색상 키
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_system_role  BOOLEAN NOT NULL DEFAULT FALSE,   -- 시스템관리자는 삭제·이름변경 금지
  permissions     TEXT[] NOT NULL DEFAULT '{}',     -- ["admin"] 또는 ["menu:/path:read", ...]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permission_groups_sort ON permission_groups(sort_order);

ALTER TABLE permission_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_permission_groups" ON permission_groups;
CREATE POLICY "allow_all_permission_groups" ON permission_groups FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION trg_permission_groups_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS permission_groups_updated_at ON permission_groups;
CREATE TRIGGER permission_groups_updated_at
  BEFORE UPDATE ON permission_groups
  FOR EACH ROW EXECUTE FUNCTION trg_permission_groups_updated_at();

-- users.permission_group_id
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permission_group_id INTEGER REFERENCES permission_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_permission_group_id ON users(permission_group_id);

-- ============================================================
-- 기본 7개 그룹 시드 (이미 존재하면 건너뜀)
-- ------------------------------------------------------------
-- 시스템관리자만 ["admin"] 권한 사전 적용. 나머지는 UI에서 관리자가 채워 넣는다.
-- ============================================================

INSERT INTO permission_groups (name, description, color, sort_order, is_system_role, permissions) VALUES
  ('보수일반',      '보수팀 일반 사원 (자재 신청·회수·자기 정보 등)',          'sky',     10, FALSE, '{}'),
  ('보수관리자',    '보수팀 관리자 (자재 발주·입출고·재고실사·통계)',          'blue',    20, FALSE, '{}'),
  ('공사일반',      '공사팀 일반 사원 (현장·공사일정·견적 조회)',              'emerald', 30, FALSE, '{}'),
  ('공사관리자',    '공사팀 관리자 (견적 작성·현장 관리)',                     'green',   40, FALSE, '{}'),
  ('관리일반',      '관리부 일반 사원 (조회 중심)',                            'amber',   50, FALSE, '{}'),
  ('관리관리자',    '관리부 관리자 (사원·거래처·회사정보 관리)',                'orange',  60, FALSE, '{}'),
  ('시스템관리자',  '전체 권한 (admin) — 삭제 불가',                           'rose',    99, TRUE,  ARRAY['admin'])
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 검증
-- ============================================================
SELECT 'permission_groups' AS chk, id, name, color, is_system_role, array_length(permissions, 1) AS perm_count
  FROM permission_groups ORDER BY sort_order;

SELECT 'users.permission_group_id' AS chk, column_name FROM information_schema.columns
  WHERE table_name='users' AND column_name='permission_group_id';

-- ============================================================
-- migration-add-employee-tabs.sql
-- ============================================================
-- ============================================================
-- 사원등록 페이지 탭 개편용 마이그레이션
-- ------------------------------------------------------------
-- 1) users 테이블: gender, blood_type 컬럼 추가
-- 2) user_certifications: self_check, acquired_date, expiry_date, issuer 컬럼 추가
-- 3) user_family_members: is_emergency, phone 컬럼 추가 (긴급연락처 지정)
-- 4) user_career_history 신규 테이블 (경력)
-- 5) user_rewards_punishments 신규 테이블 (상벌사항)
-- ============================================================

-- 1) users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gender      TEXT CHECK (gender IS NULL OR gender IN ('M','F')),
  ADD COLUMN IF NOT EXISTS blood_type  TEXT CHECK (blood_type IS NULL OR blood_type IN ('A+','A-','B+','B-','O+','O-','AB+','AB-','A','B','O','AB'));

-- 2) user_certifications
ALTER TABLE user_certifications
  ADD COLUMN IF NOT EXISTS self_check     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS acquired_date  DATE,
  ADD COLUMN IF NOT EXISTS expiry_date    DATE,
  ADD COLUMN IF NOT EXISTS issuer         TEXT;

-- 3) user_family_members — 긴급연락처 지정 + 연락처
ALTER TABLE user_family_members
  ADD COLUMN IF NOT EXISTS is_emergency  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS phone         TEXT;

-- 사원당 긴급연락처는 1명만 (부분 unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_family_emergency
  ON user_family_members(user_id)
  WHERE is_emergency = TRUE;

-- 4) 경력
CREATE TABLE IF NOT EXISTS user_career_history (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name  TEXT NOT NULL,
  joined_date   DATE,
  left_date     DATE,
  dept          TEXT,
  rank          TEXT,
  duty          TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_career_user_id ON user_career_history(user_id);
ALTER TABLE user_career_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_user_career_history" ON user_career_history;
CREATE POLICY "allow_all_user_career_history" ON user_career_history FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 5) 상벌사항
CREATE TABLE IF NOT EXISTS user_rewards_punishments (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('상','벌')),
  content      TEXT NOT NULL,
  occurred_on  DATE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_rp_user_id ON user_rewards_punishments(user_id);
ALTER TABLE user_rewards_punishments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_user_rewards_punishments" ON user_rewards_punishments;
CREATE POLICY "allow_all_user_rewards_punishments" ON user_rewards_punishments FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- 검증
-- ============================================================
SELECT 'users gender/blood_type' AS chk, column_name FROM information_schema.columns
  WHERE table_name='users' AND column_name IN ('gender','blood_type');

SELECT 'user_certifications new cols' AS chk, column_name FROM information_schema.columns
  WHERE table_name='user_certifications' AND column_name IN ('self_check','acquired_date','expiry_date','issuer');

SELECT 'user_family_members new cols' AS chk, column_name FROM information_schema.columns
  WHERE table_name='user_family_members' AND column_name IN ('is_emergency','phone');

SELECT 'user_career_history' AS chk, COUNT(*) FROM user_career_history;
SELECT 'user_rewards_punishments' AS chk, COUNT(*) FROM user_rewards_punishments;

-- ============================================================
-- migration-add-user-status-history.sql
-- ============================================================
-- ============================================================
-- 사원 발령 및 재직상태 이력 관리용 테이블 추가
-- ------------------------------------------------------------
-- users 테이블의 재직 상태(재직, 퇴직, 휴직) 변경 이력을 기록하고
-- 재입사, 복직 등의 세부 이력을 사원별로 타임라인 관리하기 위함
-- ============================================================

CREATE TABLE IF NOT EXISTS user_status_history (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status_type   TEXT NOT NULL CHECK (status_type IN ('입사', '퇴직', '휴직', '복직', '재입사')),
  event_date    DATE NOT NULL,
  reason        TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 인덱스 추가 (사원별/일자순 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_user_status_history_user_id ON user_status_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_status_history_event_date ON user_status_history(event_date);

-- RLS 활성화 및 정책 추가
ALTER TABLE user_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_user_status_history" ON user_status_history;
CREATE POLICY "allow_all_user_status_history" 
  ON user_status_history FOR ALL 
  USING (TRUE) 
  WITH CHECK (TRUE);

-- 검증 쿼리
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'user_status_history';

-- ============================================================
-- migration-add-manuals.sql
-- ============================================================
SET client_encoding = 'UTF8';
-- ============================================================
-- 매뉴얼 센터(Manual Center) 데이터 관리용 테이블 추가
-- ------------------------------------------------------------
-- 사원 및 사용자들이 기능별 사용법을 볼 수 있는 매뉴얼 보관함.
-- 마크다운 형식으로 도움말 본문을 저장합니다.
-- ============================================================

CREATE TABLE IF NOT EXISTS manuals (
  id            SERIAL PRIMARY KEY,
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    TEXT
);

-- 인덱스 추가 (카테고리별/순서별 정렬 최적화)
CREATE INDEX IF NOT EXISTS idx_manuals_category ON manuals(category);
CREATE INDEX IF NOT EXISTS idx_manuals_sort ON manuals(sort_order);

-- RLS 활성화 및 일관성 있는 정책 추가
ALTER TABLE manuals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_manuals" ON manuals;
CREATE POLICY "allow_all_manuals" 
  ON manuals FOR ALL 
  USING (TRUE) 
  WITH CHECK (TRUE);

-- 초기 시드 데이터 삽입 (기존에 작성된 개인정보수정 설명서)
INSERT INTO manuals (category, title, content, sort_order, updated_by) VALUES
  (
    '인적자원/사원',
    '사원용 개인정보수정 사용 설명서',
    '# 사원용 개인정보수정 사용 설명서

본 설명서는 시스템을 이용하는 **대솔이엘 임직원 여러분**이 본인의 인적 사항을 최신화하고 관리할 수 있도록 지원하는 **개인정보수정(마이프로필)** 메뉴의 이용 안내서입니다.

사원 여러분의 소중한 정보(연락처, 주소, 비상연락망, 자격 취득 등)가 누락 없이 관리될 수 있도록 수시로 확인하시고 변경 사항이 있을 시 아래 가이드에 따라 업데이트해 주시기 바랍니다.

---

## 1. 개인정보수정 페이지 접속 방법

1. 시스템 로그인 후 좌측 사이드바 또는 상단 메뉴에서 **[개인정보수정]** 탭을 클릭하여 접속합니다.
2. 상단에 본인의 이름과 사원번호가 올바르게 표시되는지 확인합니다.

![개인정보수정 화면 가이드](/images/manual/personal_info.png)

---

## 2. 탭별 상세 작성 및 변경 가이드

개인정보수정 메뉴는 총 **7개의 탭**으로 구성되어 있습니다. 각 탭의 입력 표준 규격은 아래와 같습니다.

```
[기본정보] ➔ [가족정보] ➔ [경력] ➔ [차량등록] ➔ [교육 및 자격] ➔ [상벌사항] ➔ [발령/재직상태 이력]
```

### 👤 2.1. 기본정보 탭
임직원의 기본적인 신상 명세와 근무복 사이즈, 비밀번호 등을 관리합니다.

* **📷 프로필 사진**: 3:4 증명사진 규격의 이미지 파일(`jpg`, `png`, `webp`)을 업로드합니다.
* **🔒 잠금 항목 (사원 수정 불가)**: **성명, 주민등록번호, 입사일, 부서, 직급, 재직상태**는 정보의 무결성을 위해 **사원이 직접 수정할 수 없도록 잠금 처리**되어 있습니다. 해당 정보에 정정이 필요한 경우 관리팀 담당자에게 직접 수정을 요청하십시오.
* **📍 주소 입력**: `[우편번호]` 버튼을 눌러 도로명 주소 검색을 통해 기본 주소를 입력한 뒤, 아파트 동·호수 등 상세 주소를 하단 칸에 명확히 입력합니다.
* **👕 근무복/안전화 사이즈**: 제공되는 단복 및 안전장구 지급을 위해 상의(예: 100, XL), 하의(예: 32), 안전화(예: 265) 사이즈를 정확히 입력합니다.
* **🔐 비밀번호 변경**: 본인의 현재 비밀번호를 입력하고, 새 비밀번호(4자 이상)를 두 번 입력한 뒤 `[비밀번호 변경]` 버튼을 누르면 즉시 적용됩니다.

> [!TIP]
> **주민등록번호 마스킹 안내**:
> 주민등록번호는 개인정보 보호를 위해 화면상에서 **`900101-1******`**과 같이 뒷자리 첫 번째 숫자(성별 구분)를 제외하고 안전하게 마스킹 처리되어 노출되므로 안심하셔도 됩니다.

---

### 👨‍👩‍👧 2.2. 가족정보 탭
가족 구성원의 신상 정보와 비상시 연락할 수 있는 **긴급연락망**을 등록합니다.

* **➕ 가족 추가**: 우측 상단의 `[+ 가족 추가]` 버튼을 눌러 구성원을 등록합니다.
* **🚨 긴급연락처 지정 (필수)**: 
  * 등록한 가족 구성원 중 **최소 1명**에게 반드시 **`[긴급연락처 지정]` 체크박스를 활성화**해 주십시오.
  * 긴급연락처로 지정된 가족은 **관계, 성명, 연락처가 모두 필수 입력**사항이 됩니다.
  * 지정된 연락처는 기본정보의 ''긴급연락망''에 자동으로 연동되어 긴급 상황 발생 시 회사가 신속하게 대처하는 데 활용됩니다.

---

### 💼 2.3. 경력 탭
입사 전 수행했던 과거 근무 이력을 등록합니다.

* 회사명(필수), 근무부서, 직급, 입사일, 퇴사일 및 구체적인 담당 업무를 작성하여 이력을 누적 관리합니다.
* 현재 재직 중인 대솔이엘 이전의 모든 경력 사항이 인사 정보로 활용됩니다.

---

### 🚗 2.4. 차량등록 탭
업무 또는 출퇴근 시 사용하는 차량을 등록하고 보험 및 유류 지원 등을 위해 관리합니다.

* **자차 / 렌트 / 기타** 차량 등록 시 **구분, 차량번호, 차종, 유종**을 빠짐없이 입력해야 저장됩니다.
* **회사차량 지정**: 본인에게 배정된 회사차량이 있는 경우, 목록에 **`🔒 회사차량 (관리자 관리)`** 배지가 표시되며 차량정보와 보험 정보는 관리자에 의해서만 자동 동기화 및 관리(사원 수정 불가)됩니다.

---

### 📜 2.5. 교육 및 자격 탭
승강기 자체점검인력 등록 및 각종 기술 자격증 이력을 관리합니다.

* **자체점검인력 여부**: 본인이 승강기 중급/고급 등 자체점검 자격을 갖추어 기술 업무를 수행하는 경우, **`[✅ 자체점검여부]`** 체크박스에 필히 체크해 주셔야 자재 출고 및 점검 승인 등의 시스템 권한이 원활하게 유지됩니다.
* **📂 자격증 사본 첨부**: 취득한 자격의 사본 파일(이미지 또는 PDF)을 `[📁 파일 선택]`을 통해 첨부할 수 있으며, 기존 첨부 파일을 웹상에서 즉시 클릭하여 열람해 볼 수 있습니다.

---

### 🏅 2.6. 상벌사항 탭 (읽기 전용)
회사에서 수여받은 우수사원 표창 등의 **포상 이력** 및 규정 위반 등의 **징계 이력**이 표시됩니다.
* 본 탭은 인사 정보 관리에 해당하여 사원이 직접 추가하거나 수정할 수 없으며 **조회만 가능**합니다.

---

### 📅 2.7. 발령/재직상태 이력 탭 (읽기 전용)
회사의 인사 발령에 따른 **입사, 퇴직, 휴직, 복직, 재입사**의 모든 상태 변동 흐름을 타임라인으로 보여줍니다.
* 사원의 근속 기간과 고용 형태 변화를 추적하는 화면으로, 사원은 **조회만 가능**하며 발령 사항 발생 시 관리자에 의해 정식 등록/업데이트됩니다.

---

## 3. 정보 저장 및 최종 검증

1. 정보를 입력하거나 정정한 후에는 화면 맨 아래에 위치한 **[저장]** 버튼을 반드시 클릭해야 데이터베이스에 반영됩니다.
2. 저장 실패 시 화면 하단에 **빨간색 경고 메세지**로 누락된 필드가 표시됩니다. (예: "가족정보 긴급연락처 지정 시 연락처는 필수입니다.") 안내 문구에 따라 해당 탭으로 이동하여 보완 후 다시 저장하십시오.
3. 저장이 정상 완료되면 **"개인정보가 저장되었습니다."**라는 **초록색 알림 문구**가 출력됩니다.

---

> [!IMPORTANT]
> **인사 정보의 최신성 유지 협조 요청**:
> 휴대전화 번호 변경, 이사로 인한 주소지 변경, 비상연락처 변동, 신규 기술 자격 취득 시 지체 없이 본 개인정보수정 페이지를 통해 정보를 변경하여 대내외 행정 업무 및 긴급 대처 시 임직원 간의 연락망 유실이 발생하지 않도록 적극적인 협조 부탁드립니다.',
    10,
    '시스템'
  ),
  (
    '안전/TBM',
    '작업자용 TBM 등록 및 서명 설명서',
    '# 작업자용 TBM(Toolbox Meeting) 등록 및 서명 설명서

본 설명서는 현장에서 작업을 수행하기 전, 안전을 확보하고 작업 절차를 공유하기 위해 작성하는 **TBM(Toolbox Meeting) 일지 등록 및 서명** 기능의 이용 안내서입니다.

대솔이엘의 모든 기술 임직원은 산업안전보건법 및 사내 안전 관리 규정에 따라 **작업 시작 전 반드시 본 시스템을 통해 TBM을 작성하고 서명**을 완료해야 합니다.

---

## 1. TBM 등록 페이지 접속 방법

1. 모바일 또는 PC 시스템 로그인 후 좌측 메뉴에서 **[TBM]** 또는 **[TBM 등록]** 메뉴를 선택합니다.
2. 상단에 본인의 이름이 작성자로 올바르게 지정되었는지 확인합니다.

---

## 2. 단계별 상세 작성 가이드

TBM 등록 양식은 총 **8가지 핵심 영역**으로 구성되어 있습니다. 각 항목의 입력 방법은 아래와 같습니다.

![TBM 등록 화면 가이드](/images/manual/tbm_register.png)

### 🔌 2.1. 업무 구분 (업무 성격 지정)
오늘 진행할 작업의 성격에 맞춰 버튼을 터치하여 지정합니다.

* **🛠️ 공사**: 엘리베이터 설치, 교체, 주요 의장 공사 등 공사 작업을 수행할 때 선택합니다.
* **🔧 보수**: 예방 점검 및 부품 교체, 고장 대처 작업을 수행할 때 선택합니다. 보수 선택 시 아래 **3가지 세부 유형** 중 하나를 필히 지정해야 합니다:
  * **점검**: 정기 예방 점검 또는 자체 점검 시 선택합니다.
  * **부품교체**: 도어 슈, 로프, 쉬브, 제어반 부품 등 자재 교체 시 선택하며, 아래 ''교체 부품명'' 입력란에 대상 부품을 직접 입력합니다.
  * **고장처리**: 고장 신고 접수 후 현장 출동 시 선택하며, 제공되는 ''고장 증상'' 목록(예: 브레이크 이상, 도어 오작동 등)을 선택하고 ''승객 갇힘 여부''를 반드시 체크(갇힘 없음 / 승객 갇힘)합니다.

---

### 📍 2.2. 현장 정보 입력
작업을 수행하는 빌딩 및 아파트 현장과 해당 엘리베이터의 호기를 지정합니다.

* **📅 공사일정에서 가져오기 (권장)**:
  * 본인에게 배정된 공사 및 점검 일정이 있는 경우, 최상단의 **일정 선택 셀렉트 박스**에 오늘 날짜 전후의 일정 목록이 나타납니다.
  * 해당 일정을 선택하면 **현장명, 호기명, 작업 내용이 자동으로 기입**되므로 더욱 빠르고 편리하게 등록할 수 있습니다.
* **✍️ 직접 입력**:
  * 배정된 일정이 없는 경우, ''현장명'' 입력란에 현장 이름의 일부를 입력한 뒤 아래로 나오는 자동완성 목록에서 선택하거나 직접 입력합니다.
  * 현장이 선택되면 해당 현장에 등록된 전체 호기 목록이 ''호기 선택'' 셀렉트 박스에 노출되므로, 실제 작업하는 호기(예: 1호기)를 선택합니다.

---

### 📝 2.3. 작업 내용 및 위험요소 기록
* **작업 내용 (필수)**: 당일 수행할 구체적인 기술적 작업 행위를 육하원칙에 의거하여 간결하고 명확하게 기록합니다. (예: "3호기 도어 인버터 및 세이프티 슈 마모로 인한 교체 작업")
* **위험요소 / 특이사항 (선택)**: 해당 작업 중 발생할 수 있는 주요 위험 요인(예: 감전 위험, 낙하 위험, 개구부 추락 등)과 작업 시 주의해야 할 특이사항을 기록합니다.

---

### ✅ 2.4. 작업 전 안전조치 체크리스트
* 선택한 업무 구분이 **공사**이거나 보수의 **점검**인 경우, 해당 작업 유형에 맞는 필수 사전 안전 점검 항목들이 노출됩니다.
* 안전화/안전모 등 개인 보호구 착용 상태, 제어반 주전원 차단 여부, 작업 표지판 설치 등 현장 상황을 육안으로 확인한 뒤 **모든 항목을 하나씩 터치하여 체크(✓)**합니다.

---

### ⚠️ 2.5. 핵심 안전수칙 지정
* 작업 종류별 핵심 안전 가이드를 확인하고 준수를 다짐하는 영역입니다.
* 상단의 태그 필터(''전체'', ''전기'', ''공사'', ''보수'', ''구출'', ''용접'')를 터치하여 오늘 작업에 적합한 안전수칙 카테고리를 엽니다.
* 노출되는 안전수칙 리스트 중 오늘 철저히 준수해야 할 **수칙들의 체크박스를 선택**합니다. (복수 선택 가능)

---

### 👷 2.6. 동료 참가자 추가 (2인 1조 작업 등)
* 혼자 작업하는 단독 작업이 아닌, 동료와 함께 협동 작업을 수행할 때 사용합니다.
* ''이름 또는 부서 검색'' 란에 동료 사원의 이름(예: 홍길동)을 입력한 뒤, 검색 목록에서 대상을 선택하여 추가합니다.
* **TBM 기록 동기화**: 동료를 참가자로 등록하고 완료하면, 해당 동료 사원의 계정 내 [내 TBM 일지] 목록에도 본 TBM 기록이 동일하게 자동 등록되어 이중 기재의 번거로움이 사라집니다.

---

### 📸 2.7. 현장 사진 첨부
* 모바일 기기로 현장 사진을 직접 촬영하거나 저장된 이미지를 첨부합니다.
* ''📸 사진'' 영역의 카메라 아이콘이 있는 영역을 탭하면 **카메라 촬영 모드가 즉시 실행**되어 작업 전 전경이나 점검 대상 부품을 빠르게 촬영하여 등록할 수 있습니다. (최대 3장 권장)

---

### ✍ 2.8. 작업책임자 서명 및 등록
* 화면 가장 아래에 있는 서명 패드 영역에 **작업책임자(본인)의 서명**을 정자로 직접 서명합니다.
* 서명이 잘못된 경우 ''초기화'' 또는 ''Clear'' 버튼을 누르고 다시 작성할 수 있습니다.
* 모든 필수 항목 작성이 완료되었다면 화면 최하단의 **[📤 TBM 작성 완료]** 버튼을 클릭하여 안전 일지 등록을 마칩니다.

---

## 3. TBM 작성 시 핵심 유의 사항

> [!IMPORTANT]
> **1. 법적 증빙 자산으로서의 신뢰성**:
> 작성된 TBM 일지와 본인 서명은 향후 중대재해처벌법 및 산업안전보건법 관련 검증 시 **회사의 안전조치 이행 및 작업자 안전 교육을 증명하는 강력한 법적 효력**을 가집니다. 성실하고 사실에 입각하여 작성해 주십시오.
> 
> **2. 현장 동료의 참여 서명**:
> 2인 이상 작업 시 동료 참가자를 빠뜨리지 말고 입력하여 팀원 전체가 안전수칙을 공유했음을 누락 없이 증명하십시오.',
    20,
    '시스템'
  ),
  (
    '현장/호기',
    '공사일정 등록 및 공사요청 사용 설명서',
    '# 공사일정 등록 및 공사요청 사용 설명서

본 설명서는 대솔이엘 시스템에서 공사 현장의 일정을 효율적으로 수립하고 협업하기 위해 제공되는 **공사 요청 및 공사일정(캘린더) 관리** 메뉴의 이용 안내서입니다.

현장의 원활한 자재 수급과 공사 진행, 안전 관리(TBM 연동)를 위해 공사 요청자 및 관리팀 담당자는 본 가이드에 따라 일정을 관리해 주시기 바랍니다.

---

## 1. 메뉴 접속 및 권한 안내

1. **공사 요청 페이지**: 로그인 후 좌측 사이드바에서 **[공사 요청]** 메뉴를 통해 진입합니다.
   * *대상*: 전 임직원 (현장 담당자, 관리자 모두 공사를 요청할 수 있습니다.)
2. **공사 일정 페이지**: 로그인 후 좌측 사이드바에서 **[공사 일정]** 메뉴를 통해 진입합니다.
   * *대상*: 전 임직원 조회 가능, **일정 등록/수정 권한 보유자(관리팀 및 관리자)**만 일정 및 연간 일정을 등록할 수 있습니다.

---

## 2. 공사 요청 가이드 (현장 담당자용)

신규 공사 건이 발생했거나 일정이 수립되어 공사 개시가 필요할 때 일정을 요청하는 단계입니다.

### 📝 2.1. 공사 요청 등록 방법
1. **[공사 요청]** 메뉴 우측 상단의 **[+ 공사 요청 등록]** 버튼을 클릭합니다.
2. 팝업 창에 아래 항목들을 정확히 입력합니다:
   * **현장명 (필수)**: 요청할 현장의 이름을 입력합니다. 입력 시 기존 등록된 현장 목록의 자동완성(`Datalist`)이 노출되므로 이를 선택하면 편리합니다.
   * **현장구분 (회사 구분)**: 해당 현장이 **TK(티케이엘리베이터)** 계약 현장인지, **DS(대솔이엘)** 자사 현장인지 선택합니다. **TK 현장 지정 시 블루 컬러 테두리**로 시인성이 향상됩니다.
   * **호기 정보**: 호기를 선택하거나 직접 기입합니다. (예: 101호기, 1~3호기)
   * **담당자 / 연락처**: 현장의 고객 측 담당자 성명 및 휴대전화 번호를 입력합니다. (연락처 입력 시 하이픈이 자동 입력됩니다.)
   * **공사내용 및 전달사항 (필수)**: 수행할 공사의 종류 및 세부 내용(예: "기계실 권상기 및 제어반 교체 공사")을 상세히 작성합니다.
3. **[등록하기]**를 눌러 제출합니다.

### 🔄 2.2. 요청 상태값 흐름
* **요청 (Red)**: 최초 등록된 상태이며, 담당자 본인은 수정/삭제가 가능합니다.
* **접수 (Gray)**: 관리팀에서 내용을 확인하고 내부 수용 상태로 변경한 상태입니다.
* **일정등록됨 (Blue)**: 관리자가 해당 요청을 기반으로 실제 캘린더에 일정을 조율하여 등록한 상태입니다. (이후 수정/삭제 불가)
* **완료 (Gray)**: 해당 현장의 공사가 모두 성공적으로 끝나 종료된 상태입니다.

---

## 3. 공사 일정 등록 및 조율 가이드 (관리팀 및 관리자용)

공사 요청을 접수하여 실제 공사 캘린더에 일정을 편제하고 배정하는 프로세스입니다.

![공사 일정 캘린더 화면 가이드](/images/manual/construction_calendar.png)

### 🔗 3.1. 공사 요청을 일정으로 전환하기 (연동)
1. **[공사 요청]** 메뉴에서 대기 중인 카드를 확인합니다.
2. 상태가 **`요청`**인 카드의 우측 하단에 있는 **[일정으로 등록 →]** 링크를 클릭합니다.
3. 클릭 시 **[공사 일정(캘린더)]** 메뉴로 자동 이동하며, **현장명, 호기명, 공사 상세 내용, 담당자 정보가 입력 폼에 자동으로 기입**되어 중복 기재 없이 즉시 일정 등록이 가능합니다.

### 📅 3.2. 캘린더에서 직접 일정 등록하기
1. **[공사 일정]** 메뉴 우측 상단의 **[+ 일정 등록]** 버튼을 누르거나, 달력 화면에서 **원하는 날짜 칸을 더블클릭/터치**합니다.
2. 입력창에서 아래 세부 필드를 작성합니다:
   * **시작일 / 종료일**: 공사가 진행될 기간을 지정합니다.
   * **작업시작시간 (24h)**: 현장 출근 및 작업 개시 예정 시간을 4자리 숫자로 입력하면 자동으로 시간 포맷이 적용됩니다. (예: `0830` 입력 시 `08:30` 자동 변환)
   * **현장명 / 현장구분 / 호기**: 공사가 수행될 공간 정보를 지정합니다.
   * **작업자**: 해당 공사에 투입될 현장 작업자(예: "홍길동, 김철수")를 지정합니다. 본 정보는 **TBM 안전 일지 작성의 기초 데이터**가 됩니다.
   * **공사내용 및 전달사항**: 상세 공사 가이드라인과 주의사항을 기입합니다.
3. **[저장]** 버튼을 누르면 달력에 공사 바(Bar)가 등록됩니다.

### 🛑 3.3. 공사휴무 기능
* 설날/추석 연휴나 회사 단체 휴무 등 전 현장 공사가 중단되는 날에는, 모달 하단 좌측의 **[공사휴무]** 버튼을 누릅니다.
* 현장명이 **`공사휴무`**로 일괄 자동 채워지며, 캘린더 상에 그린(Green) 컬러로 표기되어 전 직원이 휴무 일정을 한눈에 공유할 수 있습니다.

---

## 4. 캘린더 고급 활용법

* **🏢 계약처별 필터 기능**:
  * 상단 필터바의 **[전체 / TK / DS]** 버튼을 터치하여 원하는 계약처의 공사만 추려낼 수 있습니다.
* **🔍 현장명 실시간 검색**:
  * 상단 검색창에 키워드(예: "파크")를 입력하고 **[검색]**을 누르면, 달력 상에 해당 현장명이 포함된 공사 일정만 필터링되어 복잡한 일정 속에서 원하는 정보를 빠르게 서치할 수 있습니다.
* **🏖️ 연간일정 관리 (관리자 전용)**:
  * **[연간일정 관리]** 버튼을 누르면 단체 연차, 정기 휴무, 사내 행사 등을 달력 배경색 및 띠 배너로 등록할 수 있어 임직원의 근무 편의성을 높일 수 있습니다. (연차는 캘린더 배경이 **소프트한 레드**로 강조됩니다.)

---

## 5. TBM(안전 가이드)과의 상호 연동 안내

> [!IMPORTANT]
> **공사 일정 등록과 TBM 작성의 필수 고리**:
> 1. 본 메뉴를 통해 **공사 일정이 등록되면**, 해당 날짜의 작업자는 현장 모바일 기기에서 **[TBM 등록]** 시 **"공사일정에서 가져오기"**를 통해 해당 일정을 터치 한 번으로 즉시 연동할 수 있습니다.
> 2. 캘린더 상에서 **TBM이 미작성된 공사는 블랙 테두리**, **TBM 작성이 완료된 공사는 블루/화이트 테두리**로 실시간 연동 표출되므로 관리팀은 당일 현장 안전수칙 이행 현황을 달력에서 실시간 모니터링할 수 있습니다.',
    30,
    '시스템'
  )
ON CONFLICT DO NOTHING;

-- 검증 쿼리
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'manuals';

-- ============================================================
-- migration-add-manual-pdf.sql
-- ============================================================
SET client_encoding = 'UTF8';
-- ============================================================
-- 도움말센터(Manual Center) PDF 매뉴얼 등록 지원
-- ------------------------------------------------------------
-- 기존 마크다운 본문 외에 PDF 파일을 업로드하여 매뉴얼로
-- 등록할 수 있도록 manuals 테이블에 pdf_url 컬럼을 추가하고,
-- PDF 보관용 Storage 버킷(manual-docs)을 생성합니다.
-- (migration-add-manuals.sql 실행 이후 적용)
-- ============================================================

-- 1) manuals 테이블 컬럼 추가
ALTER TABLE manuals ADD COLUMN IF NOT EXISTS pdf_url TEXT;

-- PDF 매뉴얼은 마크다운 본문이 없을 수 있으므로 content NOT NULL 해제
ALTER TABLE manuals ALTER COLUMN content DROP NOT NULL;

-- 2) PDF 보관용 Storage 버킷
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'manual-docs',
  'manual-docs',
  TRUE,
  52428800,   -- 50MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "manual_docs_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "manual_docs_public_read"          ON storage.objects;
DROP POLICY IF EXISTS "manual_docs_authenticated_delete" ON storage.objects;

CREATE POLICY "manual_docs_authenticated_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'manual-docs');

CREATE POLICY "manual_docs_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'manual-docs');

CREATE POLICY "manual_docs_authenticated_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'manual-docs');

-- 검증
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_name = 'manuals' AND column_name IN ('content', 'pdf_url');
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'manual-docs';

-- ============================================================
-- migration-add-manual-claim.sql
-- ============================================================
SET client_encoding = 'UTF8';
-- ============================================================
-- 도움말 센터(Manual Center) 견적 및 자재청구 등록 매뉴얼 등록
-- ------------------------------------------------------------
-- 사원 및 사용자들이 자재 청구 및 견적 발행 등록 사용법을
-- 도움말 센터(/manual)에서 쉽게 확인하고 활용할 수 있도록 등록합니다.
-- ============================================================

-- 중복 삽입 방지 (동일 제목 매뉴얼 사전 삭제)
DELETE FROM manuals WHERE title = '견적 및 자재청구 등록 사용자 매뉴얼';

INSERT INTO manuals (category, title, content, sort_order, updated_by) VALUES
  (
    '자재/입출고',
    '견적 및 자재청구 등록 사용자 매뉴얼',
    '# 견적 및 자재청구 등록 사용 설명서

본 설명서는 시스템을 이용하는 **대솔이엘 임직원 여러분**이 현장 작업에 필요한 자재를 신청하거나, 유상 보수 공사를 위해 견적을 요청하는 **견적 및 자재청구 등록** 메뉴의 이용 안내서입니다.

현장의 원활한 자재 수급과 정확한 원가/출고 관리, 그리고 안전한 이력 추적을 위해 아래 가이드에 따라 청구 업무를 신속하게 진행해 주시기 바랍니다.

---

## 1. 메뉴 접속 및 권한 안내

1. 시스템 로그인 후 좌측 사이드바의 **[자재관리]** 그룹에서 **[견적 및 자재청구 등록]** 메뉴를 클릭하여 접속합니다.
2. 본 메뉴는 현장 자재 청구를 수행하는 기술 사원부터 자재 출고 및 발주를 처리하는 관리자까지 전 임직원이 사용할 수 있습니다.

![견적 및 자재청구 등록 화면 가이드](/images/manual/claim_entry.png)

---

## 2. 청구 구분 (3대 모드) 선택

화면 최상단의 **[청구 구분]** 영역에서 현장 상황과 자재 성격에 맞는 알맞은 청구 모드를 선택해야 합니다.

* **💰 유상 (견적요청)**:
  * **설명**: 빌딩이나 아파트 등 관리 현장의 **유상 보수/공사**를 진행하기 위해 필요한 자재의 견적 작성을 요청하는 모드입니다.
  * **프로세스**: 저장 완료 시 견적요청 번호(`QR-YYYY-NNNN`)가 신설되며, 견적 담당자가 이를 확인하여 즉시 원가 계산(공임, 일반관리비, 이윤 등)이 포함된 공식 견적서를 작성·발행합니다.
* **🆓 무상 (자재신청)**:
  * **설명**: **FM(Full Maintenance, 종합유지보수)** 계약 현장이나 하자 보증 기간 내의 현장 등 자재 대금이 청구되지 않는 무상 자재를 신청하는 모드입니다.
  * **프로세스**: 자재 신청 목록으로 즉시 접수되며, 관리자가 재고 확인 후 출고 및 출고 처리를 진행합니다.
* **🌙 당직 (선출고)**:
  * **설명**: 야간 당직이나 주말 비상 출동 중 급박하게 자재를 즉시 출고해 간 뒤, **사후에 행정 처리 및 견적요청**을 매칭하기 위해 사용하는 모드입니다.
  * **프로세스**: 저장 즉시 당직 선출고로 접수되어 자재 담당자가 즉각적인 재고 출고 처리를 도우며, 차후에 견적 매핑 절차를 거치게 됩니다.

> 💡 **FM 현장 자동 모드 추천 기능**:
> 입력한 **현장명**이 데이터베이스에 등록된 FM 계약 현장(`TK-FM`, `대솔FM`, `DS-FM`)일 경우, 시스템이 계약 유형을 감지하여 **자동으로 청구 구분을 [무상신청] 모드로 전환**하며 안내 배지를 노출합니다. 유상 견적서 작성에 앞서 계약 구분을 먼저 확인하시기 바랍니다.

---

## 3. 청구 기본 정보 기입

현장명과 작업의 성격을 규정하는 기본 정보를 입력하는 단계입니다.

* **📍 현장명 (필수)**:
  * 입력란에 검색어(예: 현장명 일부 또는 별칭)를 입력하면 매칭되는 현장 자동완성 목록(최대 12개)이 표시됩니다.
  * 키보드 방향키(`↓`/`↑`)와 `Enter` 키를 사용하여 현장을 즉시 선택할 수 있으며, 신규 현장 등 목록에 없는 경우는 직접 입력도 가능합니다.
  * 현장명이 지정되면 우측 하단의 **[호기]** 입력란에서 해당 현장의 전체 호기 목록을 자동완성으로 불러옵니다.
* **✍️ 작업명**:
  * 수행할 작업의 제목을 간결하고 명확히 적습니다. (예: "3호기 카 도어 슈 및 세이프티 슈 마모 교체 건")
* **📝 신청사유 / 고장 증상**:
  * 자재를 신청하게 된 구체적인 경위나 고장 상태를 기입합니다. (예: "점검 중 도어 마모 확인, 도어 오작동 발생으로 긴급 교체 요망")

---

## 4. 자재 목록 및 세부 정보 기입

현장에 투입될 자재 품목과 수량을 정교하게 기재하는 영역입니다.

* **📋 자재 검색 및 입력 방법**:
  * **[품목]** 입력칸에 자재명이나 자재 코드를 입력하면 연동되는 자재 마스터 DB에서 실시간 검색 목록이 나타납니다.
  * 원하는 자재를 선택하면 **품목명, 규격, 단위, 기본 단가**가 자동으로 채워집니다.
  * **[자재 제조사 필터]**: 테이블 우측 상단에서 자재의 성격에 따라 필터(`DS` 자사 자재, `TK` 티케이엘리베이터 계약용 자재, `ALL` 전체 자재)를 지정하여 정확한 자재를 선별할 수 있습니다.
* **🏢 호기 지정**:
  * 실제 자재가 설치 및 교체될 엘리베이터의 호기를 지정합니다. 해당 입력칸을 누르면 현장 마스터에 기반한 호기 번호가 자동완성 팝업으로 노출되어 오기입을 방지합니다.
* **🔢 수량 및 비고**:
  * 필요한 자재의 정확한 수량을 입력합니다. (단위는 기본 EA로 세팅되며 변경 가능합니다.)
  * 비고란에는 현장 특이사항(예: "긴급 배송 요청", "1층 현관 보관")을 입력하여 물류 담당자에게 전달할 수 있습니다.
* **➕ 행 추가 및 삭제**:
  * 추가 자재가 있는 경우 우측 상단의 **[+ 행 추가]** 버튼을 눌러 라인을 늘릴 수 있으며, 불필요한 행은 맨 우측의 빨간색 **`×`** 버튼을 눌러 즉시 삭제할 수 있습니다.

---

## 5. 팀 청구 이력 및 실시간 진행 상태 추적

화면 하단에서는 로그인한 사원의 소속 팀/부서원들이 최근 청구한 **최근 20건의 이력**이 실시간 타임라인으로 표시됩니다.

* **👥 협업 및 중복 청구 방지**:
  * 동일한 현장에 다른 동료가 이미 자재를 신청했는지 여부를 미리 모니터링하여 중복 청구로 인한 자재 낭비와 출고 혼선을 예방할 수 있습니다.
* **🔍 이력 필터링 및 새로고침**:
  * 상단 분류 버튼(`전체`, `유상견적요청`, `무상신청`, `당직선출고`)을 통해 보고 싶은 청구만 신속히 추려내고, 우측의 새로고침(`🔄`) 버튼으로 최신 상태를 불러옵니다.
* **🟢 실시간 상태값 확인**:
  * **신청/접수 (Gray)**: 자재 담당자의 검토 대기 단계입니다.
  * **처리중/견적작성중 (Yellow)**: 원가 계산 및 견적서 편집이 활발하게 진행 중인 단계입니다.
  * **완료/견적발행 (Green)**: 자재 출고가 끝났거나 견적서가 발행 완료된 상태입니다.
* **🔗 연계 견적서 즉시 열람**:
  *  유상 견적요청건의 상태가 `견적발행`으로 변경되면, 번호 옆에 **`📄 견적서`** 링크가 생성됩니다.
  * 이를 클릭하면 발행된 견적서 상세 보기 화면으로 원터치 이동하여 인쇄 및 고객 전달 업무를 바로 진행할 수 있습니다.

---

    > ⚠️ **청구 작성 시 필수 유의 사항**:
    > 1. **최소 1개 이상의 유효한 자재**가 입력되어야만 청구서 저장이 완료됩니다. 자재 라인이 완전히 비어 있으면 에러가 발생합니다.
    > 2. **무상 신청 오남용 제한**: 유상으로 처리해야 할 빌딩 공사를 임의로 무상으로 신청할 경우 재고 정합성이 무너질 수 있으므로, 반드시 계약 구분을 재확인하시고 불분명한 보수 건은 사전에 견적 담당자 및 관리부서와 협의 후 진행하시기 바랍니다.',
    40,
    '시스템'
  );

-- ============================================================
-- migration-add-serial-tracking.sql
-- ============================================================
-- S/N 단위 자재 인스턴스 추적 도입
--
-- 1) materials.track_serial 플래그 (default false). true면 S/N 추적 자재.
-- 2) material_units 테이블: track_serial=true 자재의 인스턴스 1행씩.
-- 3) transactions.material_unit_id FK: 추적 자재 트랜잭션에 unit 연결.
-- 4) add_transaction RPC 재작성: serial_nos 배열 받아서 unit 자동 생성/갱신.
-- 5) mark_return_completed: unit status='반납완료'로 동기 갱신.

-- ── 1) materials.track_serial ──────────────────────────────────────
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS track_serial boolean DEFAULT false NOT NULL;

-- ── 2) material_units ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS material_units (
  id                 serial      PRIMARY KEY,
  material_id        text        NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  serial_no          text        NOT NULL,
  status             text        NOT NULL DEFAULT '재고',
  current_site       text,
  current_elevator   text,
  inbound_at         timestamptz NOT NULL DEFAULT now(),
  last_event_at      timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_units_serial_unique UNIQUE (material_id, serial_no),
  CONSTRAINT material_units_status_check
    CHECK (status IN ('재고', '출고', '반납대기', '반납완료', '폐기'))
);

CREATE INDEX IF NOT EXISTS idx_material_units_material_id ON material_units(material_id);
CREATE INDEX IF NOT EXISTS idx_material_units_serial_no   ON material_units(serial_no);
CREATE INDEX IF NOT EXISTS idx_material_units_status      ON material_units(status);

-- ── 3) transactions.material_unit_id ───────────────────────────────
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS material_unit_id integer
    REFERENCES material_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_material_unit_id ON transactions(material_unit_id);

-- ── 4) add_transaction RPC 재작성 ──────────────────────────────────
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text);
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text, boolean);
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean);

CREATE OR REPLACE FUNCTION add_transaction(
  p_type            text,
  p_material_id     text,
  p_material_name   text,
  p_qty             integer,
  p_site_name       text,
  p_note            text,
  p_user_id         integer,
  p_user_name       text,
  p_elevator_name   text DEFAULT NULL,
  p_serial_nos      text[] DEFAULT NULL,
  p_requires_return boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_track_serial   boolean;
  v_prev_stock     integer;
  v_running_stock  integer;
  v_local_prev     integer;
  v_unit_id        integer;
  v_serial         text;
  v_records        json[] := ARRAY[]::json[];
  v_record         record;
  v_return_status  text;
  v_serial_count   integer;
BEGIN
  -- 자재 정보
  SELECT stock_qty, track_serial INTO v_prev_stock, v_track_serial
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_serial_count  := COALESCE(array_length(p_serial_nos, 1), 0);
  v_return_status := CASE WHEN p_requires_return AND p_type = '출고' THEN 'pending' ELSE NULL END;

  -- ── 추적 자재: S/N 갯수 == 수량 검증 ─────────────────────────
  IF v_track_serial THEN
    IF v_serial_count <> p_qty THEN
      RETURN json_build_object('error', 'S/N 추적 자재는 수량(' || p_qty || ')만큼 시리얼 번호 입력 필요. 현재 ' || v_serial_count || '개');
    END IF;

    v_running_stock := v_prev_stock;

    FOREACH v_serial IN ARRAY p_serial_nos LOOP
      v_local_prev := v_running_stock;

      IF p_type = '입고' THEN
        -- 신규 unit 생성 (중복 S/N이면 unique 제약으로 에러)
        BEGIN
          INSERT INTO material_units (material_id, serial_no, status, inbound_at, last_event_at)
          VALUES (p_material_id, v_serial, '재고', now(), now())
          RETURNING id INTO v_unit_id;
        EXCEPTION WHEN unique_violation THEN
          RETURN json_build_object('error', '이미 등록된 S/N: ' || v_serial);
        END;

        v_running_stock := v_running_stock + 1;

      ELSIF p_type = '출고' THEN
        SELECT id INTO v_unit_id FROM material_units
         WHERE material_id = p_material_id AND serial_no = v_serial AND status = '재고'
         FOR UPDATE;

        IF v_unit_id IS NULL THEN
          RETURN json_build_object('error', 'S/N ' || v_serial || ' 가(이) 재고 상태 unit이 아닙니다.');
        END IF;

        UPDATE material_units
           SET status           = CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END,
               current_site     = p_site_name,
               current_elevator = p_elevator_name,
               last_event_at    = now()
         WHERE id = v_unit_id;

        v_running_stock := v_running_stock - 1;
      ELSE
        RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
      END IF;

      INSERT INTO transactions (
        type, material_id, material_name, qty, prev_stock, after_stock,
        site_name, note, user_id, user_name,
        elevator_name, serial_no, requires_return, return_status,
        material_unit_id
      ) VALUES (
        p_type, p_material_id, p_material_name, 1, v_local_prev, v_running_stock,
        p_site_name, p_note, p_user_id, p_user_name,
        p_elevator_name, v_serial, p_requires_return, v_return_status,
        v_unit_id
      ) RETURNING * INTO v_record;

      v_records := array_append(v_records, row_to_json(v_record)::json);
    END LOOP;

    UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;
    RETURN json_build_object('records', array_to_json(v_records));
  END IF;

  -- ── 비추적 자재: 단일 트랜잭션 ───────────────────────────────
  IF v_serial_count > 1 THEN
    RETURN json_build_object('error', '비추적 자재에는 S/N을 1개까지만 기록할 수 있습니다.');
  END IF;

  IF p_type = '입고' THEN
    v_running_stock := v_prev_stock + p_qty;
  ELSIF p_type = '출고' THEN
    v_running_stock := v_prev_stock - p_qty;
    IF v_running_stock < 0 THEN
      RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
    END IF;
  ELSE
    RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
  END IF;

  UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;

  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status,
    material_unit_id
  ) VALUES (
    p_type, p_material_id, p_material_name, p_qty, v_prev_stock, v_running_stock,
    p_site_name, p_note, p_user_id, p_user_name,
    p_elevator_name,
    CASE WHEN v_serial_count = 1 THEN p_serial_nos[1] ELSE NULL END,
    p_requires_return, v_return_status,
    NULL
  ) RETURNING * INTO v_record;

  RETURN json_build_object('records', json_build_array(row_to_json(v_record)));
END;
$$;

-- ── 5) mark_return_completed: unit 상태 동기화 ─────────────────────
CREATE OR REPLACE FUNCTION mark_return_completed(
  p_transaction_id integer,
  p_user_id        integer,
  p_user_name      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_record record;
BEGIN
  UPDATE transactions
     SET return_status         = 'returned',
         returned_at           = now(),
         returned_by_user_id   = p_user_id,
         returned_by_user_name = p_user_name
   WHERE id              = p_transaction_id
     AND requires_return = true
     AND return_status   = 'pending'
   RETURNING * INTO v_record;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('error', '대상 트랜잭션을 찾을 수 없거나 이미 반납 처리됨');
  END IF;

  -- 추적 자재면 unit 상태도 반납완료로
  IF v_record.material_unit_id IS NOT NULL THEN
    UPDATE material_units
       SET status        = '반납완료',
           last_event_at = now()
     WHERE id = v_record.material_unit_id;
  END IF;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;

-- 확인
SELECT 'materials.track_serial' AS check, count(*) AS rows
FROM information_schema.columns
WHERE table_name = 'materials' AND column_name = 'track_serial'
UNION ALL
SELECT 'material_units 테이블', count(*) FROM information_schema.tables WHERE table_name = 'material_units'
UNION ALL
SELECT 'transactions.material_unit_id', count(*) FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'material_unit_id';

-- ============================================================
-- migration-serial-optional.sql
-- ============================================================
-- S/N 추적을 자재 단위 플래그(track_serial)에서 트랜잭션 단위 옵션으로 전환.
-- add_transaction은 이제 호출 시 serial_nos 배열의 유무로 분기:
--   serial_nos 0개          → 비추적 단일 트랜잭션 (qty 자유)
--   serial_nos == qty       → 추적: N개 unit 생성/갱신 + N개 트랜잭션
--   그 외                   → 에러 (partial 미지원)
-- materials.track_serial 컬럼은 유지하되 RPC에서 더 이상 참조하지 않음.

DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean);

CREATE OR REPLACE FUNCTION add_transaction(
  p_type            text,
  p_material_id     text,
  p_material_name   text,
  p_qty             integer,
  p_site_name       text,
  p_note            text,
  p_user_id         integer,
  p_user_name       text,
  p_elevator_name   text DEFAULT NULL,
  p_serial_nos      text[] DEFAULT NULL,
  p_requires_return boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_stock     integer;
  v_running_stock  integer;
  v_local_prev     integer;
  v_unit_id        integer;
  v_serial         text;
  v_records        json[] := ARRAY[]::json[];
  v_record         record;
  v_return_status  text;
  v_serial_count   integer;
  v_tracked        boolean;
BEGIN
  SELECT stock_qty INTO v_prev_stock
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_serial_count  := COALESCE(array_length(p_serial_nos, 1), 0);
  v_tracked       := v_serial_count > 0;
  v_return_status := CASE WHEN p_requires_return AND p_type = '출고' THEN 'pending' ELSE NULL END;

  -- 추적 모드: serial_nos 배열 길이가 수량과 일치해야 함
  IF v_tracked THEN
    IF v_serial_count <> p_qty THEN
      RETURN json_build_object('error', 'S/N 입력 갯수(' || v_serial_count || ')가 수량(' || p_qty || ')과 일치하지 않습니다.');
    END IF;

    v_running_stock := v_prev_stock;

    FOREACH v_serial IN ARRAY p_serial_nos LOOP
      v_local_prev := v_running_stock;

      IF p_type = '입고' THEN
        BEGIN
          INSERT INTO material_units (material_id, serial_no, status, inbound_at, last_event_at)
          VALUES (p_material_id, v_serial, '재고', now(), now())
          RETURNING id INTO v_unit_id;
        EXCEPTION WHEN unique_violation THEN
          RETURN json_build_object('error', '이미 등록된 S/N: ' || v_serial);
        END;
        v_running_stock := v_running_stock + 1;

      ELSIF p_type = '출고' THEN
        SELECT id INTO v_unit_id FROM material_units
         WHERE material_id = p_material_id AND serial_no = v_serial AND status = '재고'
         FOR UPDATE;

        IF v_unit_id IS NULL THEN
          RETURN json_build_object('error', 'S/N ' || v_serial || ' 가(이) 재고 상태 unit이 아닙니다.');
        END IF;

        UPDATE material_units
           SET status           = CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END,
               current_site     = p_site_name,
               current_elevator = p_elevator_name,
               last_event_at    = now()
         WHERE id = v_unit_id;

        v_running_stock := v_running_stock - 1;
      ELSE
        RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
      END IF;

      INSERT INTO transactions (
        type, material_id, material_name, qty, prev_stock, after_stock,
        site_name, note, user_id, user_name,
        elevator_name, serial_no, requires_return, return_status,
        material_unit_id
      ) VALUES (
        p_type, p_material_id, p_material_name, 1, v_local_prev, v_running_stock,
        p_site_name, p_note, p_user_id, p_user_name,
        p_elevator_name, v_serial, p_requires_return, v_return_status,
        v_unit_id
      ) RETURNING * INTO v_record;

      v_records := array_append(v_records, row_to_json(v_record)::json);
    END LOOP;

    UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;
    RETURN json_build_object('records', array_to_json(v_records));
  END IF;

  -- 비추적 모드: 단일 트랜잭션
  IF p_type = '입고' THEN
    v_running_stock := v_prev_stock + p_qty;
  ELSIF p_type = '출고' THEN
    v_running_stock := v_prev_stock - p_qty;
    IF v_running_stock < 0 THEN
      RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
    END IF;
  ELSE
    RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
  END IF;

  UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;

  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status,
    material_unit_id
  ) VALUES (
    p_type, p_material_id, p_material_name, p_qty, v_prev_stock, v_running_stock,
    p_site_name, p_note, p_user_id, p_user_name,
    p_elevator_name, NULL, p_requires_return, v_return_status,
    NULL
  ) RETURNING * INTO v_record;

  RETURN json_build_object('records', json_build_array(row_to_json(v_record)));
END;
$$;

-- ============================================================
-- migration-serial-partial.sql
-- ============================================================
-- S/N 부분 추적 지원: serial_nos 배열 길이가 수량보다 적어도 허용.
-- 입력된 S/N 수만큼 unit + 트랜잭션 생성, 잔여 수량은 단일 비추적 트랜잭션.
-- 예: 입고 qty=10에 S/N 3건 입력 → 3개 unit(tracked) + 1개 비추적(qty=7) = 총 4 트랜잭션, 재고 +10
--
-- 변경: serial_count > qty 면 에러, 그 외엔 모두 허용.

DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean);

CREATE OR REPLACE FUNCTION add_transaction(
  p_type            text,
  p_material_id     text,
  p_material_name   text,
  p_qty             integer,
  p_site_name       text,
  p_note            text,
  p_user_id         integer,
  p_user_name       text,
  p_elevator_name   text DEFAULT NULL,
  p_serial_nos      text[] DEFAULT NULL,
  p_requires_return boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_stock     integer;
  v_running_stock  integer;
  v_local_prev     integer;
  v_unit_id        integer;
  v_serial         text;
  v_records        json[] := ARRAY[]::json[];
  v_record         record;
  v_return_status  text;
  v_serial_count   integer;
  v_remaining      integer;
BEGIN
  SELECT stock_qty INTO v_prev_stock
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_serial_count  := COALESCE(array_length(p_serial_nos, 1), 0);
  v_return_status := CASE WHEN p_requires_return AND p_type = '출고' THEN 'pending' ELSE NULL END;

  IF p_type NOT IN ('입고', '출고') THEN
    RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
  END IF;

  IF v_serial_count > p_qty THEN
    RETURN json_build_object('error', 'S/N 갯수(' || v_serial_count || ')가 수량(' || p_qty || ')보다 많습니다.');
  END IF;

  -- 출고 시 사전 재고 검증 (tracked + untracked 합산)
  IF p_type = '출고' AND v_prev_stock < p_qty THEN
    RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
  END IF;

  v_running_stock := v_prev_stock;

  -- ── (1) 추적분: S/N 1건당 unit + 트랜잭션 ────────────────────
  IF v_serial_count > 0 THEN
    FOREACH v_serial IN ARRAY p_serial_nos LOOP
      v_local_prev := v_running_stock;

      IF p_type = '입고' THEN
        BEGIN
          INSERT INTO material_units (material_id, serial_no, status, inbound_at, last_event_at)
          VALUES (p_material_id, v_serial, '재고', now(), now())
          RETURNING id INTO v_unit_id;
        EXCEPTION WHEN unique_violation THEN
          RETURN json_build_object('error', '이미 등록된 S/N: ' || v_serial);
        END;
        v_running_stock := v_running_stock + 1;

      ELSE -- 출고
        SELECT id INTO v_unit_id FROM material_units
         WHERE material_id = p_material_id AND serial_no = v_serial AND status = '재고'
         FOR UPDATE;

        IF v_unit_id IS NULL THEN
          RETURN json_build_object('error', 'S/N ' || v_serial || ' 가(이) 재고 상태 unit이 아닙니다.');
        END IF;

        UPDATE material_units
           SET status           = CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END,
               current_site     = p_site_name,
               current_elevator = p_elevator_name,
               last_event_at    = now()
         WHERE id = v_unit_id;

        v_running_stock := v_running_stock - 1;
      END IF;

      INSERT INTO transactions (
        type, material_id, material_name, qty, prev_stock, after_stock,
        site_name, note, user_id, user_name,
        elevator_name, serial_no, requires_return, return_status,
        material_unit_id
      ) VALUES (
        p_type, p_material_id, p_material_name, 1, v_local_prev, v_running_stock,
        p_site_name, p_note, p_user_id, p_user_name,
        p_elevator_name, v_serial, p_requires_return, v_return_status,
        v_unit_id
      ) RETURNING * INTO v_record;

      v_records := array_append(v_records, row_to_json(v_record)::json);
    END LOOP;
  END IF;

  -- ── (2) 잔여 비추적분: 단일 트랜잭션 ────────────────────────
  v_remaining := p_qty - v_serial_count;
  IF v_remaining > 0 THEN
    v_local_prev := v_running_stock;
    IF p_type = '입고' THEN
      v_running_stock := v_running_stock + v_remaining;
    ELSE
      v_running_stock := v_running_stock - v_remaining;
    END IF;

    INSERT INTO transactions (
      type, material_id, material_name, qty, prev_stock, after_stock,
      site_name, note, user_id, user_name,
      elevator_name, serial_no, requires_return, return_status,
      material_unit_id
    ) VALUES (
      p_type, p_material_id, p_material_name, v_remaining, v_local_prev, v_running_stock,
      p_site_name, p_note, p_user_id, p_user_name,
      p_elevator_name, NULL, p_requires_return, v_return_status,
      NULL
    ) RETURNING * INTO v_record;

    v_records := array_append(v_records, row_to_json(v_record)::json);
  END IF;

  UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;
  RETURN json_build_object('records', array_to_json(v_records));
END;
$$;

-- ============================================================
-- migration-add-return-tracking.sql
-- ============================================================
-- 출고 시 회수 자재 추적 + 자재담당자 반납 등록 기능 지원
-- 1) transactions 테이블에 회수 관련 컬럼 추가
-- 2) add_transaction RPC가 신규 컬럼들을 받도록 시그니처 확장

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS elevator_name           text,
  ADD COLUMN IF NOT EXISTS serial_no               text,
  ADD COLUMN IF NOT EXISTS requires_return         boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS return_status           text,
  ADD COLUMN IF NOT EXISTS returned_at             timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by_user_id     integer,
  ADD COLUMN IF NOT EXISTS returned_by_user_name   text;

CREATE INDEX IF NOT EXISTS idx_transactions_return_status
  ON transactions(return_status)
  WHERE requires_return = true;

-- 기존 함수 삭제 후 재작성 (시그니처 변경)
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text);
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text, boolean);

CREATE OR REPLACE FUNCTION add_transaction(
  p_type            text,
  p_material_id     text,
  p_material_name   text,
  p_qty             integer,
  p_site_name       text,
  p_note            text,
  p_user_id         integer,
  p_user_name       text,
  p_elevator_name   text DEFAULT NULL,
  p_serial_no       text DEFAULT NULL,
  p_requires_return boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_stock  integer;
  v_after_stock integer;
  v_delta       integer;
  v_record      record;
BEGIN
  v_delta := CASE WHEN p_type = '입고' THEN p_qty ELSE -p_qty END;

  SELECT stock_qty INTO v_prev_stock
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_after_stock := v_prev_stock + v_delta;
  IF v_after_stock < 0 THEN
    RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
  END IF;

  UPDATE materials SET stock_qty = v_after_stock WHERE id = p_material_id;

  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status
  ) VALUES (
    p_type, p_material_id, p_material_name, p_qty, v_prev_stock, v_after_stock,
    p_site_name, p_note, p_user_id, p_user_name,
    p_elevator_name, p_serial_no, p_requires_return,
    CASE
      WHEN p_requires_return AND p_type = '출고' THEN 'pending'
      ELSE NULL
    END
  ) RETURNING * INTO v_record;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;

-- 반납 등록용 RPC: 자재담당자가 회수 자재 수령 후 호출
CREATE OR REPLACE FUNCTION mark_return_completed(
  p_transaction_id integer,
  p_user_id        integer,
  p_user_name      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_record record;
BEGIN
  UPDATE transactions
     SET return_status         = 'returned',
         returned_at           = now(),
         returned_by_user_id   = p_user_id,
         returned_by_user_name = p_user_name
   WHERE id              = p_transaction_id
     AND requires_return = true
     AND return_status   = 'pending'
   RETURNING * INTO v_record;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('error', '대상 트랜잭션을 찾을 수 없거나 이미 반납 처리됨');
  END IF;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;

-- 확인
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name IN ('elevator_name', 'serial_no', 'requires_return', 'return_status', 'returned_at', 'returned_by_user_id', 'returned_by_user_name')
ORDER BY column_name;

-- ============================================================
-- migration-add-unused-return.sql
-- ============================================================
-- ============================================================
-- 미사용 반납 기능 (재입고 처리 자동화)
-- ------------------------------------------------------------
-- · 출고 자재의 반납을 두 가지로 구분:
--   - scrap : 폐자재 회수 (FM/하자보증, requires_return=true)
--             → 반납 완료 처리만 (재고 변동 없음)
--   - unused: 미사용 반납 (requires_return=false)
--             → 반납 완료 + 자동 재입고 (재고 +qty, S/N '재고' 복원)
-- · 미사용 반납은 회수체크 안 된 일반 출고만 대상
-- ============================================================

-- 1) return_type 컬럼 추가
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS return_type text
    CHECK (return_type IS NULL OR return_type IN ('scrap', 'unused'));

-- 2) 기존 반납 완료된 폐자재회수 데이터 정리 (return_type='scrap'으로 마킹)
UPDATE transactions
   SET return_type = 'scrap'
 WHERE requires_return = true
   AND return_status = 'returned'
   AND return_type IS NULL;

-- 3) 기존 mark_return_completed 함수에서 return_type='scrap' 설정하도록 갱신
CREATE OR REPLACE FUNCTION mark_return_completed(
  p_transaction_id integer,
  p_user_id        integer,
  p_user_name      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_record record;
BEGIN
  UPDATE transactions
     SET return_status         = 'returned',
         return_type           = 'scrap',
         returned_at           = now(),
         returned_by_user_id   = p_user_id,
         returned_by_user_name = p_user_name
   WHERE id              = p_transaction_id
     AND requires_return = true
     AND return_status   = 'pending'
   RETURNING * INTO v_record;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('error', '대상 트랜잭션을 찾을 수 없거나 이미 반납 처리됨');
  END IF;

  -- S/N 추적 자재: unit 상태 '반납완료'로
  IF v_record.material_unit_id IS NOT NULL THEN
    UPDATE material_units
       SET status        = '반납완료',
           last_event_at = now()
     WHERE id = v_record.material_unit_id;
  END IF;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;

-- 4) 신규 RPC: mark_unused_return (미사용 반납 + 자동 재입고)
CREATE OR REPLACE FUNCTION mark_unused_return(
  p_transaction_id integer,
  p_user_id        integer,
  p_user_name      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx        record;
  v_new_stock integer;
BEGIN
  -- 대상 출고 트랜잭션 잠금
  SELECT * INTO v_tx
    FROM transactions
   WHERE id = p_transaction_id
   FOR UPDATE;

  IF v_tx.id IS NULL THEN
    RETURN json_build_object('error', '대상 트랜잭션을 찾을 수 없습니다.');
  END IF;
  IF v_tx.type <> '출고' THEN
    RETURN json_build_object('error', '출고 트랜잭션만 미사용 반납이 가능합니다.');
  END IF;
  IF v_tx.requires_return = true THEN
    RETURN json_build_object('error', '회수체크된 출고는 미사용 반납이 불가합니다 (폐자재회수 처리).');
  END IF;
  IF v_tx.return_status IS NOT NULL THEN
    RETURN json_build_object('error', '이미 반납 처리된 출고입니다.');
  END IF;

  -- 트랜잭션 상태 갱신
  UPDATE transactions
     SET return_status         = 'returned',
         return_type           = 'unused',
         returned_at           = now(),
         returned_by_user_id   = p_user_id,
         returned_by_user_name = p_user_name
   WHERE id = p_transaction_id;

  -- 재고 복원
  UPDATE materials
     SET stock_qty = stock_qty + v_tx.qty
   WHERE id = v_tx.material_id
   RETURNING stock_qty INTO v_new_stock;

  -- S/N 추적 자재: unit 상태 '재고'로 복원
  IF v_tx.material_unit_id IS NOT NULL THEN
    UPDATE material_units
       SET status           = '재고',
           current_site     = NULL,
           current_elevator = NULL,
           last_event_at    = now()
     WHERE id = v_tx.material_unit_id;
  END IF;

  -- 감사용 입고 트랜잭션 자동 생성 (note에 원출고 ID 표기)
  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status, return_type,
    material_unit_id
  ) VALUES (
    '입고', v_tx.material_id, v_tx.material_name, v_tx.qty,
    v_new_stock - v_tx.qty, v_new_stock,
    v_tx.site_name,
    '[미사용 반납 재입고] 원출고 #' || v_tx.id ||
      CASE WHEN v_tx.serial_no IS NOT NULL THEN ' / S/N ' || v_tx.serial_no ELSE '' END,
    p_user_id, p_user_name,
    v_tx.elevator_name, v_tx.serial_no, false, NULL, NULL,
    v_tx.material_unit_id
  );

  RETURN json_build_object('ok', true, 'restored_stock', v_new_stock);
END;
$$;

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT 'return_type column' AS check,
       count(*) AS exists
  FROM information_schema.columns
 WHERE table_name = 'transactions' AND column_name = 'return_type'
UNION ALL
SELECT 'mark_unused_return function',
       count(*)
  FROM information_schema.routines
 WHERE routine_name = 'mark_unused_return';

-- ============================================================
-- migration-scrap-unit-rpc.sql
-- ============================================================
-- 자재실사 S/N 폐기 처리용 RPC
-- 재고 상태인 unit을 '폐기'로 마킹 + 출고 트랜잭션 기록 + 자재 stock_qty -1
-- 재고가 아닌 unit은 거부 (출고/반납대기/반납완료/폐기 unit은 실사 폐기 불가)

CREATE OR REPLACE FUNCTION scrap_material_unit(
  p_unit_id   integer,
  p_user_id   integer,
  p_user_name text,
  p_note      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_unit         material_units%ROWTYPE;
  v_prev_stock   integer;
  v_after_stock  integer;
  v_material_name text;
  v_record       record;
BEGIN
  SELECT * INTO v_unit FROM material_units WHERE id = p_unit_id FOR UPDATE;
  IF v_unit.id IS NULL THEN
    RETURN json_build_object('error', 'unit을 찾을 수 없습니다.');
  END IF;

  IF v_unit.status <> '재고' THEN
    RETURN json_build_object('error', '재고 상태가 아닌 unit은 실사 폐기 불가 (현재: ' || v_unit.status || ')');
  END IF;

  -- 자재 재고 -1
  SELECT stock_qty, name INTO v_prev_stock, v_material_name
  FROM materials WHERE id = v_unit.material_id FOR UPDATE;
  v_after_stock := v_prev_stock - 1;
  UPDATE materials SET stock_qty = v_after_stock WHERE id = v_unit.material_id;

  -- unit 상태 → 폐기
  UPDATE material_units
     SET status        = '폐기',
         last_event_at = now()
   WHERE id = p_unit_id;

  -- 출고 트랜잭션 기록
  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status,
    material_unit_id
  ) VALUES (
    '출고', v_unit.material_id, v_material_name, 1, v_prev_stock, v_after_stock,
    NULL, COALESCE(p_note, '재고실사 손실'), p_user_id, p_user_name,
    NULL, v_unit.serial_no, false, NULL,
    v_unit.id
  ) RETURNING * INTO v_record;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;

-- ============================================================
-- migration-fix-company-type.sql
-- ============================================================
-- sites.company_type "자사" → "DS" 통일
-- 실행 전: SELECT company_type, count(*) FROM sites GROUP BY company_type;
-- 기대값: TKE=627, 자사=310, null=3

UPDATE sites
SET company_type = 'DS'
WHERE company_type = '자사';

-- 확인
SELECT company_type, COUNT(*) FROM sites GROUP BY company_type ORDER BY company_type;

-- ============================================================
-- migration-add-po-ship-info.sql
-- ============================================================
SET client_encoding = 'UTF8';
-- purchase_orders 발송지/납품 기록란 (발주서 인쇄용)
-- 발주서 하단 기록란(발송지·납기 희망일·인수자·연락처·담당자·특기사항)을
-- 발주 데이터에 저장. 같은 batch_id 행에 동일 값이 중복 저장되며,
-- 발주서 수정 시 첫 행(head)에서 로드된다.
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS ship_to        TEXT,
  ADD COLUMN IF NOT EXISTS ship_due_date  TEXT,
  ADD COLUMN IF NOT EXISTS ship_receiver  TEXT,
  ADD COLUMN IF NOT EXISTS ship_contact   TEXT,
  ADD COLUMN IF NOT EXISTS ship_manager   TEXT,
  ADD COLUMN IF NOT EXISTS ship_note      TEXT;

-- 검증
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'purchase_orders'
  AND column_name IN ('ship_to','ship_due_date','ship_receiver','ship_contact','ship_manager','ship_note')
ORDER BY column_name;

-- ============================================================
-- migration-add-transaction-batch.sql
-- ============================================================
-- 1. transactions 테이블에 batch_id 추가
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS batch_id uuid;

-- 2. 기존 add_transaction 함수 제거 및 batch_id 추가하여 재생성
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean);
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean, uuid);

CREATE OR REPLACE FUNCTION add_transaction(
  p_type            text,
  p_material_id     text,
  p_material_name   text,
  p_qty             integer,
  p_site_name       text,
  p_note            text,
  p_user_id         integer,
  p_user_name       text,
  p_elevator_name   text DEFAULT NULL,
  p_serial_nos      text[] DEFAULT NULL,
  p_requires_return boolean DEFAULT false,
  p_batch_id        uuid DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_stock     integer;
  v_running_stock  integer;
  v_local_prev     integer;
  v_unit_id        integer;
  v_serial         text;
  v_records        json[] := ARRAY[]::json[];
  v_record         record;
  v_return_status  text;
  v_serial_count   integer;
  v_remaining      integer;
BEGIN
  SELECT stock_qty INTO v_prev_stock
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_serial_count  := COALESCE(array_length(p_serial_nos, 1), 0);
  v_return_status := CASE WHEN p_requires_return AND p_type = '출고' THEN 'pending' ELSE NULL END;

  IF p_type NOT IN ('입고', '출고') THEN
    RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
  END IF;

  IF v_serial_count > p_qty THEN
    RETURN json_build_object('error', 'S/N 갯수(' || v_serial_count || ')가 수량(' || p_qty || ')보다 많습니다.');
  END IF;

  -- 출고 시 사전 재고 검증 (tracked + untracked 합산)
  IF p_type = '출고' AND v_prev_stock < p_qty THEN
    RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
  END IF;

  v_running_stock := v_prev_stock;

  -- ── (1) 추적분: S/N 1건당 unit + 트랜잭션 ────────────────────
  IF v_serial_count > 0 THEN
    FOREACH v_serial IN ARRAY p_serial_nos LOOP
      v_local_prev := v_running_stock;

      IF p_type = '입고' THEN
        BEGIN
          INSERT INTO material_units (material_id, serial_no, status, inbound_at, last_event_at)
          VALUES (p_material_id, v_serial, '재고', now(), now())
          RETURNING id INTO v_unit_id;
        EXCEPTION WHEN unique_violation THEN
          RETURN json_build_object('error', '이미 등록된 S/N: ' || v_serial);
        END;
        v_running_stock := v_running_stock + 1;

      ELSE -- 출고
        SELECT id INTO v_unit_id FROM material_units
         WHERE material_id = p_material_id AND serial_no = v_serial AND status = '재고'
         FOR UPDATE;

        IF v_unit_id IS NULL THEN
          RETURN json_build_object('error', 'S/N ' || v_serial || ' 가(이) 재고 상태 unit이 아닙니다.');
        END IF;

        UPDATE material_units
           SET status           = CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END,
               current_site     = p_site_name,
               current_elevator = p_elevator_name,
               last_event_at    = now()
         WHERE id = v_unit_id;

        v_running_stock := v_running_stock - 1;
      END IF;

      INSERT INTO transactions (
        type, material_id, material_name, qty, prev_stock, after_stock,
        site_name, note, user_id, user_name,
        elevator_name, serial_no, requires_return, return_status,
        material_unit_id, batch_id
      ) VALUES (
        p_type, p_material_id, p_material_name, 1, v_local_prev, v_running_stock,
        p_site_name, p_note, p_user_id, p_user_name,
        p_elevator_name, v_serial, p_requires_return, v_return_status,
        v_unit_id, p_batch_id
      ) RETURNING * INTO v_record;

      v_records := array_append(v_records, row_to_json(v_record)::json);
    END LOOP;
  END IF;

  -- ── (2) 잔여 비추적분: 단일 트랜잭션 ────────────────────────
  v_remaining := p_qty - v_serial_count;
  IF v_remaining > 0 THEN
    v_local_prev := v_running_stock;
    IF p_type = '입고' THEN
      v_running_stock := v_running_stock + v_remaining;
    ELSE
      v_running_stock := v_running_stock - v_remaining;
    END IF;

    INSERT INTO transactions (
      type, material_id, material_name, qty, prev_stock, after_stock,
      site_name, note, user_id, user_name,
      elevator_name, serial_no, requires_return, return_status,
      material_unit_id, batch_id
    ) VALUES (
      p_type, p_material_id, p_material_name, v_remaining, v_local_prev, v_running_stock,
      p_site_name, p_note, p_user_id, p_user_name,
      p_elevator_name, NULL, p_requires_return, v_return_status,
      NULL, p_batch_id
    ) RETURNING * INTO v_record;

    v_records := array_append(v_records, row_to_json(v_record)::json);
  END IF;

  UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;
  RETURN json_build_object('records', array_to_json(v_records));
END;
$$;

-- 3. 특정 batch_id에 속한 모든 트랜잭션 롤백 및 삭제 함수 생성
CREATE OR REPLACE FUNCTION delete_transaction_batch(
  p_batch_id uuid
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  tx record;
  v_running_stock integer;
BEGIN
  -- 안전 장치: batch_id가 없는 경우 롤백 불가
  IF p_batch_id IS NULL THEN
    RETURN json_build_object('error', 'batch_id가 필요합니다.');
  END IF;

  -- batch_id에 해당하는 트랜잭션들을 최근 생성된 것부터 역순으로 처리
  FOR tx IN SELECT * FROM transactions WHERE batch_id = p_batch_id ORDER BY id DESC LOOP
    -- 현재 재고 가져오기
    SELECT stock_qty INTO v_running_stock FROM materials WHERE id = tx.material_id FOR UPDATE;

    IF tx.type = '입고' THEN
      -- 입고 취소: 재고 감소
      v_running_stock := v_running_stock - tx.qty;
      -- 시리얼 추적 장비였다면 material_units에서 해당 S/N 데이터 삭제
      IF tx.material_unit_id IS NOT NULL THEN
        DELETE FROM material_units WHERE id = tx.material_unit_id;
      END IF;
    ELSE
      -- 출고 취소: 재고 증가
      v_running_stock := v_running_stock + tx.qty;
      -- 시리얼 추적 장비였다면 material_units를 원래 '재고' 상태로 복원
      IF tx.material_unit_id IS NOT NULL THEN
        UPDATE material_units 
           SET status = '재고', current_site = NULL, current_elevator = NULL, last_event_at = now()
         WHERE id = tx.material_unit_id;
      END IF;
    END IF;

    -- 재고량 업데이트
    UPDATE materials SET stock_qty = v_running_stock WHERE id = tx.material_id;
    -- 트랜잭션 삭제
    DELETE FROM transactions WHERE id = tx.id;
  END LOOP;

  RETURN json_build_object('ok', true);
END;
$$;

-- ============================================================
-- migration-add-transaction-price.sql
-- ============================================================
-- ============================================================
-- migration-add-transaction-price.sql
-- ============================================================
-- 입출고 전표 발생 당시의 자재 단가(unit_price) 기록 기능 도입
-- 1) transactions 테이블에 unit_price 컬럼 추가
-- 2) 기존 거래 데이터의 단가를 당사 자재마스터 기준(입고: buy_price, 출고: sell_price)으로 소급 반영
-- 3) add_transaction, mark_unused_return, scrap_material_unit RPC 함수 고도화

-- 1. unit_price 컬럼 추가
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS unit_price INTEGER DEFAULT 0;

-- 2. 기존 입출고 이력 데이터 단가 소급 보정
UPDATE public.transactions t
   SET unit_price = COALESCE(
       CASE WHEN t.type = '입고' THEN m.buy_price ELSE m.sell_price END, 
       0
   )
  FROM public.materials m
 WHERE t.material_id = m.id
   AND (t.unit_price IS NULL OR t.unit_price = 0);

-- 3. add_transaction RPC 함수 고도화 (단가 자동 기록)
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean, uuid);

CREATE OR REPLACE FUNCTION add_transaction(
  p_type            text,
  p_material_id     text,
  p_material_name   text,
  p_qty             integer,
  p_site_name       text,
  p_note            text,
  p_user_id         integer,
  p_user_name       text,
  p_elevator_name   text DEFAULT NULL,
  p_serial_nos      text[] DEFAULT NULL,
  p_requires_return boolean DEFAULT false,
  p_batch_id        uuid DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_stock     integer;
  v_running_stock  integer;
  v_local_prev     integer;
  v_unit_id        integer;
  v_serial         text;
  v_records        json[] := ARRAY[]::json[];
  v_record         record;
  v_return_status  text;
  v_serial_count   integer;
  v_remaining      integer;
  v_unit_price     integer;
BEGIN
  -- 자재 재고 잠금 및 당시 단가(입고: buy_price, 출고: sell_price) 동시 조회
  SELECT stock_qty, CASE WHEN p_type = '입고' THEN buy_price ELSE sell_price END INTO v_prev_stock, v_unit_price
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_unit_price    := COALESCE(v_unit_price, 0);
  v_serial_count  := COALESCE(array_length(p_serial_nos, 1), 0);
  v_return_status := CASE WHEN p_requires_return AND p_type = '출고' THEN 'pending' ELSE NULL END;

  IF p_type NOT IN ('입고', '출고') THEN
    RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
  END IF;

  IF v_serial_count > p_qty THEN
    RETURN json_build_object('error', 'S/N 갯수(' || v_serial_count || ')가 수량(' || p_qty || ')보다 많습니다.');
  END IF;

  -- 출고 시 사전 재고 검증 (tracked + untracked 합산)
  IF p_type = '출고' AND v_prev_stock < p_qty THEN
    RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
  END IF;

  v_running_stock := v_prev_stock;

  -- ── (1) 추적분: S/N 1건당 unit + 트랜잭션 ────────────────────
  IF v_serial_count > 0 THEN
    FOREACH v_serial IN ARRAY p_serial_nos LOOP
      v_local_prev := v_running_stock;

      IF p_type = '입고' THEN
        BEGIN
          INSERT INTO material_units (material_id, serial_no, status, inbound_at, last_event_at)
          VALUES (p_material_id, v_serial, '재고', now(), now())
          RETURNING id INTO v_unit_id;
        EXCEPTION WHEN unique_violation THEN
          RETURN json_build_object('error', '이미 등록된 S/N: ' || v_serial);
        END;
        v_running_stock := v_running_stock + 1;

      ELSE -- 출고
        SELECT id INTO v_unit_id FROM material_units
         WHERE material_id = p_material_id AND serial_no = v_serial AND status = '재고'
         FOR UPDATE;

        IF v_unit_id IS NULL THEN
          RETURN json_build_object('error', 'S/N ' || v_serial || ' 가(이) 재고 상태 unit이 아닙니다.');
        END IF;

        UPDATE material_units
           SET status           = CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END,
               current_site     = p_site_name,
               current_elevator = p_elevator_name,
               last_event_at    = now()
         WHERE id = v_unit_id;

        v_running_stock := v_running_stock - 1;
      END IF;

      INSERT INTO transactions (
        type, material_id, material_name, qty, prev_stock, after_stock,
        site_name, note, user_id, user_name,
        elevator_name, serial_no, requires_return, return_status,
        material_unit_id, batch_id, unit_price
      ) VALUES (
        p_type, p_material_id, p_material_name, 1, v_local_prev, v_running_stock,
        p_site_name, p_note, p_user_id, p_user_name,
        p_elevator_name, v_serial, p_requires_return, v_return_status,
        v_unit_id, p_batch_id, v_unit_price
      ) RETURNING * INTO v_record;

      v_records := array_append(v_records, row_to_json(v_record)::json);
    END LOOP;
  END IF;

  -- ── (2) 잔여 비추적분: 단일 트랜잭션 ────────────────────────
  v_remaining := p_qty - v_serial_count;
  IF v_remaining > 0 THEN
    v_local_prev := v_running_stock;
    IF p_type = '입고' THEN
      v_running_stock := v_running_stock + v_remaining;
    ELSE
      v_running_stock := v_running_stock - v_remaining;
    END IF;

    INSERT INTO transactions (
      type, material_id, material_name, qty, prev_stock, after_stock,
      site_name, note, user_id, user_name,
      elevator_name, serial_no, requires_return, return_status,
      material_unit_id, batch_id, unit_price
    ) VALUES (
      p_type, p_material_id, p_material_name, v_remaining, v_local_prev, v_running_stock,
      p_site_name, p_note, p_user_id, p_user_name,
      p_elevator_name, NULL, p_requires_return, v_return_status,
      NULL, p_batch_id, v_unit_price
    ) RETURNING * INTO v_record;

    v_records := array_append(v_records, row_to_json(v_record)::json);
  END IF;

  UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;
  RETURN json_build_object('records', array_to_json(v_records));
END;
$$;


-- 4. mark_unused_return RPC 함수 고도화 (반납 입고 시 원출고 단가 상속)
CREATE OR REPLACE FUNCTION mark_unused_return(
  p_transaction_id integer,
  p_user_id        integer,
  p_user_name      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx        record;
  v_new_stock integer;
BEGIN
  -- 대상 출고 트랜잭션 잠금
  SELECT * INTO v_tx
    FROM transactions
   WHERE id = p_transaction_id
   FOR UPDATE;

  IF v_tx.id IS NULL THEN
    RETURN json_build_object('error', '대상 트랜잭션을 찾을 수 없습니다.');
  END IF;
  IF v_tx.type <> '출고' THEN
    RETURN json_build_object('error', '출고 트랜잭션만 미사용 반납이 가능합니다.');
  END IF;
  IF v_tx.requires_return = true THEN
    RETURN json_build_object('error', '회수체크된 출고는 미사용 반납이 불가합니다 (폐자재회수 처리).');
  END IF;
  IF v_tx.return_status IS NOT NULL THEN
    RETURN json_build_object('error', '이미 반납 처리된 출고입니다.');
  END IF;

  -- 트랜잭션 상태 갱신
  UPDATE transactions
     SET return_status         = 'returned',
         return_type           = 'unused',
         returned_at           = now(),
         returned_by_user_id   = p_user_id,
         returned_by_user_name = p_user_name
    WHERE id = p_transaction_id;

  -- 재고 복원
  UPDATE materials
     SET stock_qty = stock_qty + v_tx.qty
   WHERE id = v_tx.material_id
   RETURNING stock_qty INTO v_new_stock;

  -- S/N 추적 자재: unit 상태 '재고'로 복원
  IF v_tx.material_unit_id IS NOT NULL THEN
    UPDATE material_units
       SET status           = '재고',
           current_site     = NULL,
           current_elevator = NULL,
           last_event_at    = now()
     WHERE id = v_tx.material_unit_id;
  END IF;

  -- 감사용 입고 트랜잭션 자동 생성 (원 출고 시점의 단가 unit_price 기입)
  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status, return_type,
    material_unit_id, unit_price
  ) VALUES (
    '입고', v_tx.material_id, v_tx.material_name, v_tx.qty,
    v_new_stock - v_tx.qty, v_new_stock,
    v_tx.site_name,
    '[미사용 반납 재입고] 원출고 #' || v_tx.id ||
      CASE WHEN v_tx.serial_no IS NOT NULL THEN ' / S/N ' || v_tx.serial_no ELSE '' END,
    p_user_id, p_user_name,
    v_tx.elevator_name, v_tx.serial_no, false, NULL, NULL,
    v_tx.material_unit_id, COALESCE(v_tx.unit_price, 0)
  );

  RETURN json_build_object('ok', true, 'restored_stock', v_new_stock);
END;
$$;


-- 5. scrap_material_unit RPC 함수 고도화 (실사 폐기 출고 시 당시 출고 단가 기록)
CREATE OR REPLACE FUNCTION scrap_material_unit(
  p_unit_id   integer,
  p_user_id   integer,
  p_user_name text,
  p_note      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_unit         material_units%ROWTYPE;
  v_prev_stock   integer;
  v_after_stock  integer;
  v_material_name text;
  v_record       record;
  v_sell_price   integer;
BEGIN
  SELECT * INTO v_unit FROM material_units WHERE id = p_unit_id FOR UPDATE;
  IF v_unit.id IS NULL THEN
    RETURN json_build_object('error', 'unit을 찾을 수 없습니다.');
  END IF;

  IF v_unit.status <> '재고' THEN
    RETURN json_build_object('error', '재고 상태가 아닌 unit은 실사 폐기 불가 (현재: ' || v_unit.status || ')');
  END IF;

  -- 자재 재고 -1 및 당시 출고단가 조회
  SELECT stock_qty, name, sell_price INTO v_prev_stock, v_material_name, v_sell_price
  FROM materials WHERE id = v_unit.material_id FOR UPDATE;
  
  v_after_stock := v_prev_stock - 1;
  UPDATE materials SET stock_qty = v_after_stock WHERE id = v_unit.material_id;

  -- unit 상태 → 폐기
  UPDATE material_units
     SET status        = '폐기',
         last_event_at = now()
   WHERE id = p_unit_id;

  -- 출고 트랜잭션 기록 (단가 함께 기록)
  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status,
    material_unit_id, unit_price
  ) VALUES (
    '출고', v_unit.material_id, v_material_name, 1, v_prev_stock, v_after_stock,
    NULL, COALESCE(p_note, '재고실사 손실'), p_user_id, p_user_name,
    NULL, v_unit.serial_no, false, NULL,
    v_unit.id, COALESCE(v_sell_price, 0)
  ) RETURNING * INTO v_record;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;

-- ============================================================
-- migration-disable-rls-material-units.sql
-- ============================================================
-- material_units 테이블 RLS 비활성화
-- 신규 테이블 생성 시 자동 켜지는 RLS가 anon/publishable 키로의 INSERT를 막아
-- "new row violates row-level security policy" 오류가 발생.
-- 이 프로젝트의 다른 테이블(materials, transactions 등)과 일관되게 RLS 끄기.

ALTER TABLE material_units DISABLE ROW LEVEL SECURITY;

-- 확인
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('materials', 'transactions', 'material_units', 'sites', 'elevators', 'vendors', 'users');

-- ============================================================
-- migration-material-units-rls-policies.sql
-- ============================================================
-- material_units RLS 재활성화 + 정책 부여 (다른 테이블과 일관성)
--
-- 1) 먼저 기존 transactions 테이블 정책 패턴 확인 (참고용)
-- 2) material_units에 동일한 형태의 개방형(또는 anon 허용) 정책 추가
-- 3) RLS 재활성화
--
-- 대부분의 Supabase 프로젝트가 publishable/anon 키만 사용하면서 정책은
-- 'FOR ALL USING (true)' 같이 사실상 개방으로 두므로 동일 패턴 적용.
-- 정확한 매칭이 필요하면 SELECT 결과를 보고 수정하세요.

-- ── (참고) transactions 테이블의 현재 정책 확인
SELECT policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'transactions';

-- ── material_units 정책 정리 + 재활성화 ─────────────────────────
-- 기존 정책이 있다면 모두 제거 (멱등성 확보)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'material_units'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON material_units', r.policyname);
  END LOOP;
END $$;

-- 개방형 정책 (다른 테이블과 일관성 위해 4종 분리; 한 줄 'FOR ALL'로도 가능)
DROP POLICY IF EXISTS "Enable read access for all users" ON material_units;
CREATE POLICY "Enable read access for all users" ON material_units
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Enable insert access for all users" ON material_units;
CREATE POLICY "Enable insert access for all users" ON material_units
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Enable update access for all users" ON material_units;
CREATE POLICY "Enable update access for all users" ON material_units
  FOR UPDATE USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Enable delete access for all users" ON material_units;
CREATE POLICY "Enable delete access for all users" ON material_units
  FOR DELETE USING (true);

ALTER TABLE material_units ENABLE ROW LEVEL SECURITY;

-- ── 검증 ────────────────────────────────────────────────────────
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'material_units';

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'material_units'
ORDER BY policyname;
