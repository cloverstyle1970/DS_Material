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
