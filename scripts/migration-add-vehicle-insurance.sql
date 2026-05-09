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
