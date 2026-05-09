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

CREATE POLICY "allow_all_tbm_safety_rules_master" ON tbm_safety_rules_master FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_repair_types"        ON tbm_repair_types        FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_fault_types"         ON tbm_fault_types         FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_checklist_items"     ON tbm_checklist_items     FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_records"             ON tbm_records             FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_participants"        ON tbm_participants        FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_record_safety_rules" ON tbm_record_safety_rules FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_checklist_results"   ON tbm_checklist_results   FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_tbm_photos"              ON tbm_photos              FOR ALL USING (TRUE) WITH CHECK (TRUE);

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
